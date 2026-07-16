const admin = require('firebase-admin')
const crypto = require('crypto')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { onSchedule } = require('firebase-functions/v2/scheduler')
const { defineSecret } = require('firebase-functions/params')
const { AccessToken } = require('livekit-server-sdk')
const { resolvePermissionsForUid } = require('../account/accountPermissions')

const LIVEKIT_URL = defineSecret('LIVEKIT_URL')
const LIVEKIT_API_KEY = defineSecret('LIVEKIT_API_KEY')
const LIVEKIT_API_SECRET = defineSecret('LIVEKIT_API_SECRET')

const ALLOWED_CATEGORIES = new Set(['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other'])
const ALLOWED_VISIBILITIES = new Set(['public', 'unlisted', 'private'])
const ALLOWED_ACCESS_MODES = new Set(['public', 'unlisted', 'private', 'password'])
const ALLOWED_AUDIO_MODES = new Set(['music', 'voice'])
const ALLOWED_PROVIDERS = new Set(['hlsEdge', 'bufferedBroadcast', 'nativeWeb', 'webrtc', 'firebaseSegments', 'nativeStreaming', 'livekit'])
const ALLOWED_INGEST_METHODS = new Set(['browserWebrtc', 'obsRtmp'])
const ALLOWED_INGEST_MODES = new Set(['browser-media-recorder', 'livekit-webrtc', 'browser-webrtc', 'obs-rtmp', 'rtmp-obs', 'rtmp', 'srt', 'none'])
const ALLOWED_PLAYBACK_MODES = new Set(['firebaseSegments', 'webrtc', 'hls', 'llhls', 'none'])
const ALLOWED_REACTIONS = new Set(['like', 'dislike', 'none'])
const ELIGIBLE_ROLES = new Set(['creator', 'artist', 'founder', 'staff', 'admin', 'owner'])
const STARTING_TIMEOUT_MS = 5 * 60 * 1000
const HOST_HEARTBEAT_STALE_MS = 90 * 1000
const LISTENER_PRESENCE_STALE_MS = 60 * 1000
const CHAT_TEXT_MAX_LENGTH = 500
const MAX_ACTIVE_LIVE_STREAMS_PER_HOST = 3
const STAFF_ACTIVE_LIVE_STREAMS_PER_HOST = 10
const MAX_CONFIGURED_LIVE_STREAMS_PER_HOST = 25
const HLS_EDGE_BASE_URL = 'https://stream.melogicrecords.studio/live'
const RTMP_INGEST_SERVER = 'rtmp://104.197.179.248/live'
const BROWSER_WHIP_INGEST_BASE_URL = 'https://ingest.melogicrecords.studio/rtc/v1/whip/'
const HLS_WARMUP_WINDOW_MS = 30 * 1000
const HLS_RECENT_OK_WINDOW_MS = 90 * 1000
const HLS_HEALTH_TIMEOUT_MS = 8000
const STREAM_KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

function db() {
  return admin.firestore()
}

function cleanString(value, max = 240) {
  return String(value || '').trim().slice(0, max)
}

function cleanRoomName(value) {
  return cleanString(value, 96).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
}

function cleanId(value, max = 160) {
  return cleanString(value, max).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max)
}

function sanitizeStreamKey(value = '') {
  return cleanString(value, 160)
    .replace(/[^A-Za-z0-9_-]/g, '')
}

function createRandomStreamKey(length = 25) {
  const bytes = crypto.randomBytes(length)
  return Array.from(bytes, (byte) => STREAM_KEY_ALPHABET[byte % STREAM_KEY_ALPHABET.length]).join('')
}

function isValidGeneratedStreamKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9]{25}$/.test(value)
}

function ensureSessionStreamKey(existingKey, { forceNew = false } = {}) {
  if (!forceNew && isValidGeneratedStreamKey(existingKey)) return existingKey
  return createRandomStreamKey(25)
}

function buildHlsPlaybackUrl(streamKey = '') {
  const cleanKey = sanitizeStreamKey(streamKey)
  return cleanKey ? `${HLS_EDGE_BASE_URL}/${cleanKey}.m3u8` : ''
}

function buildBrowserWhipIngestUrl(streamKey = '') {
  const cleanKey = sanitizeStreamKey(streamKey)
  if (!cleanKey) return ''
  const url = new URL(BROWSER_WHIP_INGEST_BASE_URL)
  url.searchParams.set('app', 'live')
  url.searchParams.set('stream', cleanKey)
  url.searchParams.set('eip', '104.197.179.248')
  return url.toString()
}

function isObsHlsEdgeStream(stream = {}) {
  const provider = normalizeProvider(stream.provider)
  const protocol = cleanString(stream.streamingProtocol || (provider === 'hlsEdge' ? 'hls' : ''), 40)
  const method = cleanString(stream.ingestMethod || stream.ingestMode || '', 60)
  return provider === 'hlsEdge'
    && protocol === 'hls'
    && (method === 'obsRtmp' || method === 'obs-rtmp' || method === 'rtmp-obs' || method === 'rtmp')
}

function isHlsEdgeStream(stream = {}) {
  const provider = normalizeProvider(stream.provider)
  const protocol = cleanString(stream.streamingProtocol || (provider === 'hlsEdge' ? 'hls' : ''), 40)
  return provider === 'hlsEdge' && protocol === 'hls'
}

function parseHlsManifest(manifest = '') {
  const text = String(manifest || '')
  const sequenceMatch = text.match(/^#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)/mi)
  const mediaLines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/\.m3u8(?:[?#]|$)/i.test(line))
  const hasMediaSegment = /(^|[/?])[^\s?#]+\.(?:ts|m4s|mp4|aac|mp3)(?:[?#]|$)/im.test(text)
    || /#EXTINF\s*:/i.test(text)
    || mediaLines.length > 0
  return {
    valid: /#EXTM3U/i.test(text) && hasMediaSegment,
    hasMediaSegment,
    sequence: sequenceMatch ? Number(sequenceMatch[1]) : null
  }
}

async function checkHlsStreamHealth(streamId = '', stream = {}) {
  const checkedAtMs = Date.now()
  const previousLastOkMs = timestampMillis(stream.hlsLastOkAt)
  const startedAtMs = timestampMillis(stream.hlsStartedAt || stream.startedAt || stream.createdAt) || checkedAtMs
  const configuredUrl = sanitizeHlsPlaybackUrl(stream.hlsPlaybackUrl || stream.hlsUrl || '')
  const streamKeyUrl = buildHlsPlaybackUrl(stream.streamKey || '')
  const hlsUrl = streamKeyUrl || configuredUrl
  let responseCode = 0
  let sequence = null
  let hasMediaSegment = false
  let error = ''
  let healthy = false
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), HLS_HEALTH_TIMEOUT_MS)
  try {
    if (!hlsUrl) throw new Error('Missing HLS manifest URL.')
    const requestUrl = new URL(hlsUrl)
    requestUrl.searchParams.set('_', String(checkedAtMs))
    const response = await fetch(requestUrl, {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain' },
      signal: controller.signal
    })
    responseCode = response.status
    const manifest = await response.text()
    const parsed = parseHlsManifest(manifest)
    sequence = parsed.sequence
    hasMediaSegment = parsed.hasMediaSegment === true
    healthy = response.ok && parsed.valid
    if (!response.ok) error = `HTTP ${response.status}`
    else if (!parsed.valid) error = 'Playlist has no media segments yet.'
  } catch (fetchError) {
    error = fetchError?.name === 'AbortError' ? 'HLS health check timed out.' : fetchError?.message || String(fetchError)
  } finally {
    clearTimeout(timeout)
  }
  const manifestHealthy = healthy
  const previousSequence = stream.hlsLastManifestSequence == null || stream.hlsLastManifestSequence === ''
    ? null
    : Number.isFinite(Number(stream.hlsLastManifestSequence)) ? Number(stream.hlsLastManifestSequence) : null
  const sequenceChanged = sequence == null || previousSequence == null || sequence !== previousSequence
  const sequenceFresh = sequenceChanged || Boolean(previousLastOkMs && checkedAtMs - previousLastOkMs <= HLS_RECENT_OK_WINDOW_MS)
  healthy = manifestHealthy && sequenceFresh
  if (manifestHealthy && !sequenceFresh) error = 'HLS media sequence has not advanced within the freshness window.'
  const lastOkMs = healthy && sequenceChanged ? checkedAtMs : previousLastOkMs
  const withinWarmup = checkedAtMs - startedAtMs <= HLS_WARMUP_WINDOW_MS
  const secondsSinceStart = Math.max(0, Math.floor((checkedAtMs - startedAtMs) / 1000))
  const recentlyHealthy = Boolean(lastOkMs && checkedAtMs - lastOkMs <= HLS_RECENT_OK_WINDOW_MS)
  const health = healthy ? 'healthy' : withinWarmup && !lastOkMs ? 'warming' : recentlyHealthy ? 'stale' : 'offline'
  const result = {
    hlsHealth: health,
    hlsLastCheckedAt: admin.firestore.Timestamp.fromMillis(checkedAtMs),
    hlsLastManifestSequence: sequence,
    hlsLastError: healthy ? '' : cleanString(error, 300),
    hlsResponseCode: responseCode,
    hlsHasMediaSegments: hasMediaSegment,
    hlsStartedAt: admin.firestore.Timestamp.fromMillis(startedAtMs),
    secondsSinceStart,
    hlsLastOkAt: lastOkMs ? admin.firestore.Timestamp.fromMillis(lastOkMs) : null,
    healthy
  }
  console.log('[HLS Health] check', {
    streamId,
    hlsUrl,
    responseCode,
    healthy,
    sequence,
    lastOkAt: lastOkMs ? new Date(lastOkMs).toISOString() : '',
    secondsSinceStart,
    health,
    error: result.hlsLastError
  })
  return result
}

async function refreshHlsHealth(docSnap, stream = docSnap.data() || {}) {
  const health = await checkHlsStreamHealth(docSnap.id, stream)
  const update = {
    hlsHealth: health.hlsHealth,
    hlsLastCheckedAt: health.hlsLastCheckedAt,
    hlsLastManifestSequence: health.hlsLastManifestSequence,
    hlsLastError: health.hlsLastError,
    hlsResponseCode: health.hlsResponseCode,
    hlsHasMediaSegments: health.hlsHasMediaSegments === true,
    hlsStartedAt: health.hlsStartedAt,
    hlsSecondsSinceStart: health.secondsSinceStart
  }
  if (health.hlsLastOkAt) update.hlsLastOkAt = health.hlsLastOkAt
  await docSnap.ref.set(update, { merge: true })
  return health
}

function sanitizeHlsPlaybackUrl(value = '') {
  const candidate = cleanString(value, 1000)
  if (!candidate) return ''
  try {
    const parsed = new URL(candidate)
    const valid = parsed.protocol === 'https:'
      && parsed.hostname === 'stream.melogicrecords.studio'
      && parsed.port === ''
      && /^\/live\/[A-Za-z0-9_-]+\.m3u8$/.test(parsed.pathname)
      && parsed.search === ''
      && parsed.hash === ''
    return valid ? parsed.toString() : ''
  } catch {
    return ''
  }
}

function bufferedBroadcastFields(data = {}, existing = {}) {
  const streamKey = sanitizeStreamKey(data.streamKey || existing.streamKey || '')
  const impliedLegacyMethod = (data.provider || existing.provider) === 'bufferedBroadcast' ? 'obsRtmp' : 'browserWebrtc'
  const ingestMethod = normalizeIngestMethod(data.ingestMethod || data.ingestMode || existing.ingestMethod || existing.ingestMode || impliedLegacyMethod)
  return {
    provider: 'hlsEdge',
    providerLabel: 'Melogic Edge',
    streamingProtocol: 'hls',
    transportProvider: 'hls-edge',
    ingestMethod,
    ingestProtocol: ingestMethod === 'browserWebrtc' ? 'webrtc' : 'rtmp',
    ingestMode: ingestMethod === 'browserWebrtc' ? 'browser-webrtc' : 'obs-rtmp',
    playbackMode: 'hls',
    latencyProfile: 'buffered',
    streamKey,
    hlsPlaybackUrl: buildHlsPlaybackUrl(streamKey),
    hlsUrl: buildHlsPlaybackUrl(streamKey),
    llhlsUrl: '',
    rtmpIngestServer: ingestMethod === 'obsRtmp' ? RTMP_INGEST_SERVER : '',
    browserWhipIngestUrl: ingestMethod === 'browserWebrtc' ? buildBrowserWhipIngestUrl(streamKey) : '',
    nativeStreaming: { ...nativeStreamingDefaults(existing.nativeStreaming || {}), enabled: false, status: 'disabled' },
    archiveNote: 'HLS Edge streams publish through the Melogic streaming server and play through the HLS edge.'
  }
}

function toTags(value) {
  if (Array.isArray(value)) return value.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 12)
  return String(value || '').split(',').map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 12)
}

function normalizeAudioMode(value) {
  return ALLOWED_AUDIO_MODES.has(value) ? value : 'music'
}

function normalizeInputSource(value) {
  return value === 'sequence' ? 'sequence' : 'browser'
}

function normalizeProvider(value) {
  if (value === 'hlsEdge' || value === 'bufferedBroadcast') return 'hlsEdge'
  if (value === 'nativeWeb' || value === 'webrtc' || value === 'livekit') return 'nativeWeb'
  if (value === 'firebaseSegments' || value === 'nativeStreaming') return 'firebaseSegments'
  return 'hlsEdge'
}

function normalizeIngestMethod(value) {
  if (value === 'browserWebrtc' || value === 'browser-webrtc' || value === 'livekit-webrtc') return 'browserWebrtc'
  if (value === 'obsRtmp' || value === 'obs-rtmp' || value === 'rtmp-obs' || value === 'rtmp') return 'obsRtmp'
  return ALLOWED_INGEST_METHODS.has(value) ? value : 'browserWebrtc'
}

function normalizeIngestMode(value) {
  return ALLOWED_INGEST_MODES.has(value) ? value : 'browser-webrtc'
}

function normalizePlaybackMode(value, provider = 'hlsEdge') {
  if (provider === 'firebaseSegments') return 'firebaseSegments'
  if (provider === 'nativeWeb') return 'webrtc'
  if (provider === 'hlsEdge') return 'hls'
  if (ALLOWED_PLAYBACK_MODES.has(value)) return value
  return 'hls'
}

function providerLabel(provider = 'hlsEdge') {
  if (provider === 'nativeWeb') return 'Website Live'
  if (provider === 'firebaseSegments' || provider === 'nativeStreaming') return 'Native Streaming'
  return 'Melogic Edge'
}

function normalizeIngestModeForProvider(value, provider = 'hlsEdge', ingestMethod = 'obsRtmp') {
  if (provider === 'nativeWeb') return 'browser-webrtc'
  if (provider === 'firebaseSegments') return 'browser-media-recorder'
  return ingestMethod === 'browserWebrtc' ? 'browser-webrtc' : 'obs-rtmp'
}

function normalizeStreamingProtocol(data = {}, existing = {}) {
  const requested = cleanString(data.streamingProtocol || '', 40)
  if (requested === 'nativeStreaming') return 'nativeStreaming'
  if (requested === 'hls') return 'hls'
  const existingProtocol = cleanString(existing.streamingProtocol || '', 40)
  if (existingProtocol === 'nativeStreaming' || existingProtocol === 'hls') return existingProtocol
  return 'hls'
}

function nullableNumber(value) {
  if (value === null || typeof value === 'undefined') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function cleanProgramTransform(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  const number = (key, fallback = null, min = -10000, max = 10000) => {
    const parsed = Number(input[key])
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
  }
  return {
    x: number('x', 0), y: number('y', 0), width: number('width', null, 1, 10000), height: number('height', null, 1, 10000),
    scale: number('scale', 1, .05, 8), rotation: number('rotation', 0, -360, 360)
  }
}

function cleanProgramSource(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    sourceId: cleanId(input.sourceId, 120), type: cleanString(input.type, 80), label: cleanString(input.label, 120),
    enabled: input.enabled !== false, muted: input.muted === true, visible: input.visible !== false, locked: input.locked === true,
    programEnabled: input.programEnabled !== false, monitorEnabled: input.monitorEnabled === true,
    gain: Math.max(0, Math.min(1.5, Number(input.gain ?? 1) || 0)), opacity: Math.max(0, Math.min(1, Number(input.opacity ?? 1) || 0)),
    zIndex: Math.max(-100, Math.min(100, Number(input.zIndex || 0) || 0)), objectFit: input.objectFit === 'contain' ? 'contain' : 'cover',
    transform: cleanProgramTransform(input.transform)
  }
}

function cleanProgramScene(value = {}) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    sceneId: cleanId(input.sceneId, 120), name: cleanString(input.name || 'Untitled Scene', 120),
    transitionPreference: input.transitionPreference === 'cut' ? 'cut' : 'fade',
    sources: Array.isArray(input.sources) ? input.sources.map((id) => cleanId(id, 120)).filter(Boolean).slice(0, 80) : []
  }
}

function cleanProgramState(input = {}, existing = {}) {
  const source = input && typeof input === 'object' ? input : {}
  const old = existing && typeof existing === 'object' ? existing : {}
  const scenes = Array.isArray(source.scenes) ? source.scenes.map(cleanProgramScene).filter((scene) => scene.sceneId).slice(0, 40) : Array.isArray(old.scenes) ? old.scenes : []
  const sources = Array.isArray(source.sources) ? source.sources.map(cleanProgramSource).filter((entry) => entry.sourceId).slice(0, 80) : Array.isArray(old.sources) ? old.sources : []
  const snapshotInput = source.programSnapshot && typeof source.programSnapshot === 'object' ? source.programSnapshot : old.programSnapshot || {}
  const snapshotScene = snapshotInput.scene ? cleanProgramScene(snapshotInput.scene) : null
  return {
    mixerVersion: Math.max(1, Math.min(2, Number(source.mixerVersion || old.mixerVersion || 2))),
    previewSceneId: cleanId(source.previewSceneId || old.previewSceneId || '', 120),
    programSceneId: cleanId(source.programSceneId || snapshotScene?.sceneId || old.programSceneId || 'audio-only', 120),
    activeSceneId: cleanId(source.activeSceneId || old.activeSceneId || 'audio-only', 120),
    selectedSourceId: cleanId(source.selectedSourceId || old.selectedSourceId || '', 120),
    outputResolution: cleanString(source.outputResolution || old.outputResolution || '1280x720', 40),
    fps: Math.max(1, Math.min(60, Number(source.fps || old.fps || 30))),
    transitionDurationMs: Math.max(0, Math.min(5000, Number(source.transitionDurationMs || old.transitionDurationMs || 400))),
    mode: source.mode === 'preview' ? 'preview' : 'program', scenes, sources,
    programSnapshot: snapshotScene ? {
      sceneId: cleanId(snapshotInput.sceneId || snapshotScene.sceneId, 120), scene: snapshotScene,
      sources: Array.isArray(snapshotInput.sources) ? snapshotInput.sources.map(cleanProgramSource).filter((entry) => entry.sourceId).slice(0, 80) : [],
      version: cleanString(snapshotInput.version, 120)
    } : null
  }
}

function nativeStreamingDefaults(existing = {}) {
  return {
    enabled: existing.enabled === true,
    targetLatencyMs: Number(existing.targetLatencyMs || 30000),
    segmentDurationMs: Number(existing.segmentDurationMs || 4000),
    audioFirst: existing.audioFirst !== false,
    videoEnabled: existing.videoEnabled === true,
    idleWhenNoListeners: existing.idleWhenNoListeners !== false,
    minPlaybackBufferMs: Number(existing.minPlaybackBufferMs || 20000),
    maxPlaybackBufferMs: Number(existing.maxPlaybackBufferMs || 60000),
    rollingRetentionMs: Number(existing.rollingRetentionMs || 300000),
    status: cleanString(existing.status || 'idleNoListeners', 40),
    hasPlayableSegments: existing.hasPlayableSegments === true,
    oldestAvailableSegmentIndex: nullableNumber(existing.oldestAvailableSegmentIndex),
    newestAvailableSegmentIndex: nullableNumber(existing.newestAvailableSegmentIndex),
    currentSegmentIndex: nullableNumber(existing.currentSegmentIndex),
    lastSegmentAt: existing.lastSegmentAt || null
  }
}

function isStreamPublishing(stream = {}) {
  return normalizeProvider(stream.provider) === 'hlsEdge'
    || stream.audioPublished === true
    || stream.videoPublished === true
    || stream.programHasAudio === true
    || stream.programHasVideo === true
}

function cleanProgramOutputState(data = {}, { existing = {}, selectedInputSource = 'browser', defaultAudioPublished = false } = {}) {
  const streamingProtocol = normalizeStreamingProtocol(data, existing)
  const nativeProtocol = streamingProtocol === 'nativeStreaming'
  const provider = nativeProtocol ? 'nativeStreaming' : 'hlsEdge'
  const ingestMethod = nativeProtocol
    ? 'browserMediaRecorder'
    : normalizeIngestMethod(data.ingestMethod || data.ingestMode || existing.ingestMethod || existing.ingestMode || 'browserWebrtc')
  const streamKey = nativeProtocol ? '' : sanitizeStreamKey(data.streamKey || existing.streamKey || '')
  const hlsPlaybackUrl = nativeProtocol ? '' : buildHlsPlaybackUrl(streamKey)
  const audioEnabled = data.audioEnabled === false ? false : data.audioEnabled === true ? true : existing.audioEnabled !== false
  const videoEnabled = data.videoEnabled === true ? true : data.videoEnabled === false ? false : existing.videoEnabled === true
  const canPublishEdgeMedia = !nativeProtocol && ['browserWebrtc', 'obsRtmp'].includes(ingestMethod)
  const audioPublished = Boolean(canPublishEdgeMedia && audioEnabled && (data.audioPublished === true || (defaultAudioPublished && data.audioPublished !== false)))
  const videoPublished = Boolean(canPublishEdgeMedia && videoEnabled && (data.videoPublished === true || (defaultAudioPublished && data.videoPublished !== false)))
  const programHasAudio = Boolean(audioEnabled && (data.programHasAudio === true || (data.programHasAudio !== false && audioPublished)))
  const programHasVideo = Boolean(videoEnabled && (data.programHasVideo === true || videoPublished))
  const activeAudioSources = data.activeAudioSources && typeof data.activeAudioSources === 'object'
    ? {
        browser: data.activeAudioSources.browser !== false,
        sequence: data.activeAudioSources.sequence === true
      }
    : {
        browser: selectedInputSource !== 'sequence',
        sequence: selectedInputSource === 'sequence'
      }
  const programState = cleanProgramState(data.programState, existing.programState)
  const providerDiagnostics = data.providerDiagnostics && typeof data.providerDiagnostics === 'object'
    ? {
        connectionState: cleanString(data.providerDiagnostics.connectionState, 80),
        roomName: cleanString(data.providerDiagnostics.roomName, 120),
        roomId: cleanString(data.providerDiagnostics.roomId, 120),
        audioTrackId: cleanString(data.providerDiagnostics.audioTrackId, 120),
        videoTrackId: cleanString(data.providerDiagnostics.videoTrackId, 120),
        lastMediaEvent: cleanString(data.providerDiagnostics.lastMediaEvent, 160),
        recorderState: cleanString(data.providerDiagnostics.recorderState, 80),
        selectedMimeType: cleanString(data.providerDiagnostics.selectedMimeType, 120),
        segmentIndex: Number.isFinite(Number(data.providerDiagnostics.segmentIndex)) ? Number(data.providerDiagnostics.segmentIndex) : null,
        lastBlobSize: Number.isFinite(Number(data.providerDiagnostics.lastBlobSize)) ? Number(data.providerDiagnostics.lastBlobSize) : null,
        lastUploadPath: cleanString(data.providerDiagnostics.lastUploadPath, 300),
        lastUploadError: cleanString(data.providerDiagnostics.lastUploadError, 240),
        newestAvailableSegmentIndex: Number.isFinite(Number(data.providerDiagnostics.newestAvailableSegmentIndex)) ? Number(data.providerDiagnostics.newestAvailableSegmentIndex) : null,
        hasPlayableSegments: data.providerDiagnostics.hasPlayableSegments === true,
        demandCount: Number.isFinite(Number(data.providerDiagnostics.demandCount)) ? Number(data.providerDiagnostics.demandCount) : 0,
        demandPath: cleanString(data.providerDiagnostics.demandPath, 220),
        lastDemandChangeAt: cleanString(data.providerDiagnostics.lastDemandChangeAt, 80),
        lastDemandError: cleanString(data.providerDiagnostics.lastDemandError, 240),
        trackCount: Number.isFinite(Number(data.providerDiagnostics.trackCount)) ? Number(data.providerDiagnostics.trackCount) : null,
        recorderStartReason: cleanString(data.providerDiagnostics.recorderStartReason, 120),
        recorderStopReason: cleanString(data.providerDiagnostics.recorderStopReason, 120)
      }
    : existing.providerDiagnostics || {}
  return {
    provider,
    providerLabel: nativeProtocol ? 'Native Streaming' : providerLabel(provider),
    streamingProtocol,
    transportProvider: nativeProtocol ? 'firebase' : 'hls-edge',
    ingestMethod,
    ingestProtocol: nativeProtocol ? 'firebase' : ingestMethod === 'browserWebrtc' ? 'webrtc' : 'rtmp',
    ingestMode: nativeProtocol ? 'browser-media-recorder' : normalizeIngestModeForProvider(data.ingestMode || existing.ingestMode, provider, ingestMethod),
    playbackMode: nativeProtocol ? 'firebaseSegments' : 'hls',
    latencyProfile: nativeProtocol ? 'buffered-native' : 'buffered',
    streamKey,
    hlsPlaybackUrl,
    rtmpIngestServer: !nativeProtocol && ingestMethod === 'obsRtmp' ? RTMP_INGEST_SERVER : '',
    browserWhipIngestUrl: !nativeProtocol && ingestMethod === 'browserWebrtc' ? buildBrowserWhipIngestUrl(streamKey) : '',
    antMediaStreamId: cleanId(data.antMediaStreamId || existing.antMediaStreamId || '', 160),
    antMediaAppName: cleanString(data.antMediaAppName || existing.antMediaAppName || '', 120).replace(/^\/+|\/+$/g, ''),
    antMediaBaseUrl: sanitizeCoverArtURL(data.antMediaBaseUrl || existing.antMediaBaseUrl || ''),
    hlsUrl: hlsPlaybackUrl,
    llhlsUrl: '',
    webRtcPlaybackUrl: sanitizeCoverArtURL(data.webRtcPlaybackUrl || existing.webRtcPlaybackUrl || ''),
    audioEnabled,
    videoEnabled,
    activeAudioSources,
    activeVideoSource: videoEnabled ? normalizeInputSource(data.activeVideoSource || existing.activeVideoSource || 'browser') : '',
    programHasAudio,
    programHasVideo,
    audioPublished,
    videoPublished,
    audioOnly: !programHasVideo,
    chatEnabled: data.chatEnabled === false ? false : data.chatEnabled === true ? true : existing.chatEnabled !== false,
    hostActive: data.hostActive === true || existing.hostActive === true,
    hostSessionId: cleanString(data.hostSessionId || existing.hostSessionId || '', 120),
    nativeStreaming: nativeProtocol
      ? { ...nativeStreamingDefaults(existing.nativeStreaming || {}), ...(data.nativeStreaming || {}), enabled: true, status: cleanString(data.nativeStreaming?.status || existing.nativeStreaming?.status || 'idleNoListeners', 40) }
      : { ...nativeStreamingDefaults(existing.nativeStreaming || {}), enabled: false, status: 'disabled' },
    archiveNote: nativeProtocol
      ? cleanString(data.archiveNote || existing.archiveNote || 'Native Streaming legacy/debug transport.', 300)
      : 'HLS Edge streams publish through the Melogic streaming server and play through the HLS edge.',
    programState,
    providerDiagnostics
  }
}

function normalizeAccessMode(data = {}) {
  const requested = cleanString(data.accessMode || '', 40)
  if (ALLOWED_ACCESS_MODES.has(requested)) return requested
  const visibility = ALLOWED_VISIBILITIES.has(data.visibility) ? data.visibility : 'public'
  return visibility
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function isHeartbeatFresh(stream = {}) {
  const lastHeartbeat = timestampMillis(stream.lastHostHeartbeatAt || stream.startedAt || stream.updatedAt)
  return Boolean(lastHeartbeat) && Date.now() - lastHeartbeat < HOST_HEARTBEAT_STALE_MS
}

function isAdminAuth(auth = null) {
  return auth?.token?.admin === true || ['owner', 'admin'].includes(cleanString(auth?.token?.adminRole, 40))
}

function markLiveValidationDetails({ streamId = '', provider = 'hlsEdge', stream = {}, requestData = {}, targetStatus = 'live' } = {}) {
  const validationBranch = provider
  const broadcastState = cleanString(requestData.broadcastState || (validationBranch === 'firebaseSegments' ? 'liveIdleNoListeners' : stream.broadcastState) || '', 80)
  const nativeStatus = cleanString(requestData.nativeStreaming?.status || (validationBranch === 'firebaseSegments' ? 'idleNoListeners' : stream.nativeStreaming?.status) || '', 80)
  const currentStatus = cleanString(stream.status || '', 80)
  const safeTitle = cleanString(requestData.title || stream.title || 'Untitled live stream', 90)
  const safeVisibility = cleanString(requestData.visibility || stream.visibility || 'public', 40)
  const hostSessionId = cleanString(requestData.hostSessionId || stream.hostSessionId || '', 120)
  const missingRequiredFields = []
  const failedConditions = []
  if (!streamId) missingRequiredFields.push('streamId')
  if (!stream.hostUid) missingRequiredFields.push('hostUid')
  if (!['hlsEdge', 'nativeWeb', 'firebaseSegments'].includes(provider)) failedConditions.push(`unsupported provider: ${provider}`)
  if (targetStatus !== 'live') failedConditions.push(`targetStatus must be live, got ${targetStatus}`)
  if (validationBranch === 'firebaseSegments') {
    if (!hostSessionId) missingRequiredFields.push('hostSessionId')
    if (broadcastState && broadcastState !== 'liveIdleNoListeners') failedConditions.push(`native broadcastState must be liveIdleNoListeners, got ${broadcastState}`)
    if (nativeStatus && nativeStatus !== 'idleNoListeners') failedConditions.push(`nativeStreaming.status must be idleNoListeners, got ${nativeStatus}`)
  }
  if (validationBranch === 'nativeWeb' && !cleanString(stream.livekitRoomName || stream.roomName, 120)) missingRequiredFields.push('livekitRoomName')
  if (validationBranch === 'hlsEdge') {
    const streamKey = sanitizeStreamKey(requestData.streamKey || stream.streamKey || '')
    const hlsPlaybackUrl = buildHlsPlaybackUrl(streamKey)
    if (!isValidGeneratedStreamKey(streamKey)) missingRequiredFields.push('validGeneratedStreamKey')
    if (!hlsPlaybackUrl) missingRequiredFields.push('hlsPlaybackUrl')
  }
  return {
    functionName: 'markMusicLiveStreamOnAir',
    functionFile: 'functions/src/music/musicLiveStreams.js',
    streamId,
    provider,
    currentStatus,
    targetStatus,
    broadcastState,
    nativeStreamingStatus: nativeStatus,
    safeTitle,
    safeVisibility,
    hostSessionId,
    missingRequiredFields,
    failedConditions,
    validationBranch
  }
}

function accountRole(user = {}, profile = {}) {
  return cleanString(user.role || user.accountType || user.roleLabel || profile.role || profile.roleLabel || profile.accountType || '', 40).toLowerCase()
}

function liveStreamLimitForHost({ user = {}, profile = {}, accountPermissions = null, auth = null } = {}) {
  const rawLimit = accountPermissions?.permissions?.musicLiveMaxStreams
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
    return Math.max(0, Math.min(MAX_CONFIGURED_LIVE_STREAMS_PER_HOST, Math.floor(rawLimit)))
  }
  const role = accountRole(user, profile)
  if (isAdminAuth(auth) || ['owner', 'admin', 'staff'].includes(role)) return STAFF_ACTIVE_LIVE_STREAMS_PER_HOST
  return MAX_ACTIVE_LIVE_STREAMS_PER_HOST
}

function cleanStreamMetadata(data = {}) {
  const title = cleanString(data.title, 90)
  const description = cleanString(data.description, 1200)
  const category = ALLOWED_CATEGORIES.has(data.category) ? data.category : 'music'
  const visibility = ALLOWED_VISIBILITIES.has(data.visibility) ? data.visibility : 'public'
  const accessMode = normalizeAccessMode({ ...data, visibility })
  const coverArtURL = sanitizeCoverArtURL(data.coverArtURL)
  const coverArtPath = cleanString(data.coverArtPath, 500)
  const coverArtSource = ['url', 'upload', 'fallback'].includes(data.coverArtSource) ? data.coverArtSource : (coverArtURL ? 'url' : 'fallback')
  const tags = toTags(data.tags)
  return {
    title,
    description,
    category,
    visibility,
    accessMode,
    passwordProtected: accessMode === 'password',
    coverArtURL,
    coverImageURL: coverArtURL,
    coverArtPath,
    coverStoragePath: coverArtPath,
    coverArtSource,
    tags
  }
}

function nowPlayingPayload(item = {}, itemId = '', now = admin.firestore.FieldValue.serverTimestamp()) {
  return {
    ...item,
    sequenceItemId: itemId,
    sourceType: itemId ? 'sequenceItem' : cleanString(item.sourceType || 'manual', 40),
    sourceId: itemId || cleanId(item.sourceId || '', 120),
    startedAt: now,
    updatedAt: now,
    durationMs: Math.max(0, Number(item.durationMs || 0))
  }
}

function hashPassword(password = '', salt = crypto.randomBytes(16).toString('hex')) {
  const cleanPassword = cleanString(password, 200)
  if (!cleanPassword) return null
  const hash = crypto.pbkdf2Sync(cleanPassword, salt, 120000, 32, 'sha256').toString('hex')
  return { salt, hash, algorithm: 'pbkdf2_sha256', iterations: 120000 }
}

function verifyPassword(password = '', secret = {}) {
  if (!secret?.passwordHash || !secret?.passwordSalt) return false
  const next = hashPassword(password, secret.passwordSalt)
  if (!next?.hash) return false
  try {
    return crypto.timingSafeEqual(Buffer.from(next.hash, 'hex'), Buffer.from(secret.passwordHash, 'hex'))
  } catch {
    return false
  }
}

function isPubliclyJoinable(stream = {}) {
  const accessMode = stream.accessMode || stream.visibility || 'private'
  const externalEncoder = isObsHlsEdgeStream(stream)
  return stream.status === 'live'
    && ['public', 'unlisted', 'password'].includes(accessMode)
    && stream.visibility !== 'private'
    && (externalEncoder || stream.hostConnected === true)
    && (normalizeProvider(stream.provider) === 'firebaseSegments' || isStreamPublishing(stream))
    && (externalEncoder || isHeartbeatFresh(stream))
}

async function recomputeListenerCount(streamRef) {
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - LISTENER_PRESENCE_STALE_MS)
  const presenceSnap = await streamRef.collection('presence').where('lastSeenAt', '>=', cutoff).limit(1000).get()
  const listenerCount = presenceSnap.size
  await streamRef.set({
    listenerCount,
    peakListenerCount: admin.firestore.FieldValue.increment(0),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  const streamSnap = await streamRef.get()
  const stream = streamSnap.data() || {}
  if (listenerCount > Number(stream.peakListenerCount || 0)) {
    await streamRef.set({ peakListenerCount: listenerCount }, { merge: true })
  }
  return listenerCount
}

function liveLog(stage, extra = {}) {
  console.log('[musicLiveStreams]', {
    stage,
    ...extra
  })
}

function liveWarn(stage, extra = {}) {
  console.warn('[musicLiveStreams]', {
    stage,
    ...extra
  })
}

function liveWriterLog(streamId = '', payload = {}) {
  console.log('[Music Live Writer] normalized transport payload', {
    provider: payload.provider || '',
    providerLabel: payload.providerLabel || '',
    streamingProtocol: payload.streamingProtocol || '',
    transportProvider: payload.transportProvider || '',
    playbackMode: payload.playbackMode || '',
    ingestMethod: payload.ingestMethod || '',
    ingestProtocol: payload.ingestProtocol || '',
    streamKey: payload.streamKey || '',
    hlsPlaybackUrl: payload.hlsPlaybackUrl || '',
    hlsUrl: payload.hlsUrl || '',
    nativeStreamingEnabled: payload.nativeStreaming?.enabled === true,
    streamId
  })
  console.log('[Stream Key Consistency]', {
    streamId,
    firestoreStreamKey: payload.firestoreStreamKey || payload.streamKey || '',
    writerStreamKey: payload.streamKey || '',
    whipStreamKey: payload.ingestMethod === 'browserWebrtc' ? payload.streamKey || '' : '',
    hlsHealthStreamKey: payload.streamKey || '',
    hlsUrl: payload.hlsUrl || buildHlsPlaybackUrl(payload.streamKey || ''),
    hlsPlaybackUrl: payload.hlsPlaybackUrl || buildHlsPlaybackUrl(payload.streamKey || '')
  })
}

function livekitConfig(stage = 'livekit config check') {
  const url = cleanString(LIVEKIT_URL.value(), 1000)
  const apiKey = cleanString(LIVEKIT_API_KEY.value(), 240)
  const apiSecret = cleanString(LIVEKIT_API_SECRET.value(), 240)
  liveLog(stage, {
    livekitUrlPresent: Boolean(url),
    livekitApiKeyPresent: Boolean(apiKey),
    livekitApiSecretPresent: Boolean(apiSecret)
  })
  const urlValid = /^wss?:\/\//i.test(url)
  if (!urlValid || !apiKey || !apiSecret) {
    const listenerRequest = String(stage || '').toLowerCase().includes('listener')
    throw new HttpsError('failed-precondition', listenerRequest
      ? 'This website-native stream requires WebRTC playback, which is not configured yet.'
      : 'Website Live requires WebRTC/LiveKit configuration. Use Buffered Broadcast with OBS for now.', {
      stage,
      livekitUrlPresent: Boolean(url),
      livekitUrlValid: urlValid,
      livekitApiKeyPresent: Boolean(apiKey),
      livekitApiSecretPresent: Boolean(apiSecret),
      suggestion: 'Use Buffered Broadcast for OBS/HLS streaming.'
    })
  }
  return { url, apiKey, apiSecret }
}

function sanitizeCoverArtURL(value = '') {
  const url = cleanString(value, 1000)
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

async function loadAccount(uid) {
  const [userSnap, profileSnap, accountPermissions] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('profiles').doc(uid).get(),
    resolvePermissionsForUid(uid).catch(() => null)
  ])
  return {
    user: userSnap.exists ? userSnap.data() || {} : null,
    profile: profileSnap.exists ? profileSnap.data() || {} : null,
    accountPermissions
  }
}

function assertEligible({ auth, user, profile, accountPermissions }) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to go live.')
  if (auth.token.email && auth.token.email_verified === false) {
    throw new HttpsError('failed-precondition', 'Verify your email before going live.')
  }
  if (!user || !profile) throw new HttpsError('failed-precondition', 'Complete your Melogic profile before going live.')
  if (user.suspended === true || profile.suspended === true || user.accountStatus === 'suspended' || profile.accountStatus === 'suspended') {
    throw new HttpsError('permission-denied', 'This account cannot start live streams.')
  }
  if (user.liveStreamingStatus === 'suspended' || user.liveStreamingStatus === 'disabled') {
    throw new HttpsError('permission-denied', 'Live streaming is disabled for this account.')
  }
  if (accountPermissions?.restrictions?.liveSuspended === true || accountPermissions?.restrictions?.musicRestricted === true || accountPermissions?.restrictions?.suspended === true) {
    throw new HttpsError('permission-denied', 'Live streaming is disabled for this account.')
  }
  const role = accountRole(user, profile)
  const roleLabel = cleanString(user.roleLabel || profile.roleLabel || '', 40).toLowerCase()
  const eligible = accountPermissions?.permissions?.musicLive === true || user.musicLiveEnabled === true || profile.musicLiveEnabled === true || ELIGIBLE_ROLES.has(role) || ELIGIBLE_ROLES.has(roleLabel)
  if (!eligible) throw new HttpsError('permission-denied', 'Live streaming is currently limited to eligible creators.')
}

function assertCanChat({ auth, user, profile, accountPermissions }) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to join live chat.')
  if (auth.token.email && auth.token.email_verified === false) {
    throw new HttpsError('failed-precondition', 'Verify your email before joining live chat.')
  }
  if (user?.suspended === true || profile?.suspended === true || user?.accountStatus === 'suspended' || profile?.accountStatus === 'suspended') {
    throw new HttpsError('permission-denied', 'This account cannot use live chat.')
  }
  const permissions = accountPermissions?.permissions || {}
  const restrictions = accountPermissions?.restrictions || {}
  if (accountPermissions?.suspended === true || restrictions.suspended === true || restrictions.communityRestricted === true || restrictions.musicRestricted === true) {
    throw new HttpsError('permission-denied', 'Live chat is restricted for this account.')
  }
  if (permissions.musicLiveChat === false || permissions.communityMessage === false) {
    throw new HttpsError('permission-denied', 'Live chat is restricted for this account.')
  }
}

function assertCanInteract({ auth, user, profile, accountPermissions }) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to interact with live streams.')
  if (user?.suspended === true || profile?.suspended === true || user?.accountStatus === 'suspended' || profile?.accountStatus === 'suspended') {
    throw new HttpsError('permission-denied', 'This account cannot interact with live streams.')
  }
  const restrictions = accountPermissions?.restrictions || {}
  const permissions = accountPermissions?.permissions || {}
  if (accountPermissions?.suspended === true || restrictions.suspended === true || restrictions.communityRestricted === true || restrictions.musicRestricted === true) {
    throw new HttpsError('permission-denied', 'Live stream interactions are restricted for this account.')
  }
  if (permissions.communityReact === false) {
    throw new HttpsError('permission-denied', 'Live stream interactions are restricted for this account.')
  }
}

async function createLiveKitJwt({ identity, name, roomName, role, canPublish, config }) {
  const token = new AccessToken(
    config.apiKey,
    config.apiSecret,
    {
      identity,
      name,
      metadata: safeJson({ source: 'melogic-music-live', role })
    }
  )

  const grant = {
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: canPublish === true,
    canUpdateOwnMetadata: canPublish === true
  }
  if (canPublish === false) grant.canPublishSources = []

  token.addGrant(grant)

  liveLog('LiveKit token grant prepared', {
    role,
    roomName,
    canPublish: canPublish === true,
    canSubscribe: true,
    canPublishData: canPublish === true,
    sourceRestricted: canPublish === false ? 'none' : 'unrestricted_audio_host'
  })

  return token.toJwt()
}

const startMusicLiveStream = onCall(
  {
    region: 'us-central1',
    secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET],
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    let stage = 'auth received'
    let streamRef = null
    try {
      const uid = request.auth?.uid
      liveLog(stage, { uidPresent: Boolean(uid) })
      if (!uid) throw new HttpsError('unauthenticated', 'Sign in to go live.', { stage })

      stage = 'eligibility loaded'
      const { user, profile, accountPermissions } = await loadAccount(uid)
      liveLog(stage, { uid, permissionsSource: accountPermissions?.source || 'unknown' })

      stage = 'eligibility check'
      assertEligible({ auth: request.auth, user, profile, accountPermissions })
      liveLog('eligibility passed', { uid })

      stage = 'payload validated'
      const title = cleanString(request.data?.title, 90)
      const description = cleanString(request.data?.description, 1200)
      const metadata = cleanStreamMetadata(request.data || {})
      const { category, visibility, accessMode, coverArtPath, coverArtURL, coverArtSource, tags } = metadata
      const audioMode = normalizeAudioMode(request.data?.audioMode)
      const selectedInputSource = normalizeInputSource(request.data?.inputSource || request.data?.selectedInputSource)
      const selectedSequenceId = cleanId(request.data?.sequenceId || request.data?.selectedSequenceId, 160)
      let programOutputState = cleanProgramOutputState(request.data || {}, { selectedInputSource })
      if (title.length < 3) throw new HttpsError('invalid-argument', 'Stream title must be at least 3 characters.', { stage })
      if (request.data?.rightsAccepted !== true) throw new HttpsError('failed-precondition', 'You must accept the live stream rules before going live.', { stage })
      if (accessMode === 'password' && !cleanString(request.data?.password, 200)) {
        throw new HttpsError('invalid-argument', 'Add a listener password before starting a password-protected stream.', { stage })
      }
      liveLog(stage, { uid, category, visibility, accessMode, audioMode, hasCoverArtURL: Boolean(coverArtURL) })

      stage = 'active stream check started'
      const maxActiveStreams = liveStreamLimitForHost({ user, profile, accountPermissions, auth: request.auth })
      const [liveActive, startingActive] = await Promise.all([
        db().collection('musicLiveStreams').where('hostUid', '==', uid).where('status', '==', 'live').limit(maxActiveStreams + 5).get(),
        db().collection('musicLiveStreams').where('hostUid', '==', uid).where('status', '==', 'starting').limit(maxActiveStreams + 5).get()
      ])
      const freshLive = liveActive.docs.filter((docSnap) => {
        const stream = docSnap.data() || {}
        return isObsHlsEdgeStream(stream)
          || (stream.hostConnected === true && isStreamPublishing(stream) && isHeartbeatFresh(stream))
      })
      const staleLive = liveActive.docs.filter((docSnap) => !freshLive.includes(docSnap))
      const freshStarting = startingActive.docs.filter((docSnap) => {
        const started = docSnap.data()?.createdAt?.toMillis?.() || docSnap.data()?.updatedAt?.toMillis?.() || 0
        return started && Date.now() - started < STARTING_TIMEOUT_MS
      })
      const staleStarting = startingActive.docs.filter((docSnap) => !freshStarting.includes(docSnap))
      const cleanupNow = admin.firestore.FieldValue.serverTimestamp()
      await Promise.all([
        ...staleLive.map((docSnap) => docSnap.ref.set({
          status: 'ended',
          isLive: false,
          connectionStatus: 'stale',
          hostConnected: false,
          audioPublished: false,
          videoPublished: false,
          programHasAudio: false,
          programHasVideo: false,
          endedAt: cleanupNow,
          endReason: 'heartbeat_stale',
          cleanupSource: 'start_stream_guard',
          updatedAt: cleanupNow,
          listenerCount: 0
        }, { merge: true })),
        ...staleStarting.map((docSnap) => docSnap.ref.set({
          status: 'error',
          isLive: false,
          connectionStatus: 'error',
          errorReason: 'starting_timeout',
          updatedAt: cleanupNow
        }, { merge: true }))
      ])
      const activeStreamCount = freshLive.length + freshStarting.length
      liveLog('active stream check completed', {
        uid,
        maxActiveStreams,
        activeStreamCount,
        freshLiveCount: freshLive.length,
        freshStartingCount: freshStarting.length,
        staleLiveCount: staleLive.length,
        staleStartingCount: staleStarting.length
      })
      if (activeStreamCount >= maxActiveStreams) {
        throw new HttpsError('resource-exhausted', 'You have reached your active live stream limit. End one stream before starting another.', {
          stage,
          activeStreamCount,
          maxActiveStreams
        })
      }

      const selectedProvider = programOutputState.provider
      let config = null
      if (selectedProvider === 'nativeWeb') {
        stage = 'LiveKit config validated'
        config = livekitConfig(stage)
      } else {
        stage = `${providerLabel(selectedProvider)} config prepared`
        liveLog(stage, { uid, provider: selectedProvider, playbackMode: programOutputState.playbackMode })
      }

      stage = 'stream doc id generated'
      const requestedStreamId = cleanId(request.data?.streamId, 120)
      streamRef = requestedStreamId ? db().collection('musicLiveStreams').doc(requestedStreamId) : db().collection('musicLiveStreams').doc()
      if (requestedStreamId) {
        const existingStream = await streamRef.get()
        if (existingStream.exists) {
          const stream = existingStream.data() || {}
          if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can start this draft stream.', { stage })
          if (!['draft', 'setup', 'error'].includes(stream.status || 'draft')) {
            throw new HttpsError('failed-precondition', 'This stream is already active or ended.', { stage })
          }
        }
      }
      const streamId = streamRef.id
      const roomName = selectedProvider === 'nativeWeb' ? cleanRoomName(`music-live-${streamId}`) : ''
      liveLog(stage, { uid, streamId, roomName })

      const hostDisplayName = cleanString(profile.displayName || user.displayName || request.auth.token.name || 'Melogic Creator', 80)
      const hostPhotoURL = cleanString(profile.avatarURL || user.photoURL || request.auth.token.picture || '', 1000)
      const hostUsername = cleanString(profile.username || profile.handle || user.username || user.handle || request.auth.token.username || '', 80)

      let hostToken = ''
      if (selectedProvider === 'nativeWeb') {
        stage = 'host token creation started'
        hostToken = await createLiveKitJwt({
          identity: `host-${uid}`,
          name: hostDisplayName,
          roomName,
          role: 'host',
          canPublish: true,
          config
        })
        liveLog('host token creation completed', { uid, streamId, tokenPresent: Boolean(hostToken) })
      }

      stage = 'Firestore stream document created'
      const now = admin.firestore.FieldValue.serverTimestamp()
      const previousSnap = await streamRef.get()
      const previousStream = previousSnap.exists ? previousSnap.data() || {} : {}
      const previousKey = sanitizeStreamKey(request.data?.streamKey || previousStream.streamKey || '')
      const nextKey = selectedProvider === 'hlsEdge'
        ? ensureSessionStreamKey(previousKey, { forceNew: true })
        : ''
      const sessionData = selectedProvider === 'hlsEdge'
        ? { ...(request.data || {}), streamKey: nextKey }
        : request.data || {}
      programOutputState = cleanProgramOutputState(sessionData, { existing: previousStream, selectedInputSource })
      console.log('[Stream Key] ensured', {
        streamId,
        previousKey,
        nextKey,
        forceNew: selectedProvider === 'hlsEdge',
        status: previousStream.status || 'new',
        ingestMethod: programOutputState.ingestMethod,
        hlsUrl: buildHlsPlaybackUrl(nextKey)
      })
      liveWriterLog(streamId, programOutputState)
      await streamRef.set({
        streamId,
        hostUid: uid,
        hostDisplayName,
        hostUsername,
        hostPhotoURL,
        hostAvatarURL: hostPhotoURL,
        title,
        description,
        category,
        tags,
        coverArtPath,
        coverArtURL,
        coverImageURL: coverArtURL,
        coverStoragePath: coverArtPath,
        coverArtSource,
        status: 'starting',
        isLive: false,
        connectionStatus: selectedProvider === 'hlsEdge'
          ? programOutputState.ingestMethod === 'browserWebrtc' ? 'connectingIngest' : 'waitingForIngest'
          : 'starting',
        broadcastState: 'connecting',
        visibility,
        accessMode,
        passwordProtected: accessMode === 'password',
        audioMode,
        selectedInputSource,
        selectedSequenceId,
        audioProfile: audioMode === 'music' ? 'high_quality_music' : 'podcast_voice',
        ...programOutputState,
        ...(selectedProvider === 'hlsEdge' ? bufferedBroadcastFields(sessionData, previousStream) : {}),
        audioPublished: false,
        videoPublished: false,
        programHasAudio: programOutputState.audioEnabled && programOutputState.programHasAudio,
        programHasVideo: programOutputState.videoEnabled && programOutputState.programHasVideo,
        hostConnected: false,
        roomName,
        livekitRoomName: roomName,
        livekitRoomSid: '',
        startedAt: null,
        endedAt: null,
        createdAt: previousStream.createdAt || now,
        updatedAt: now,
        lastHostHeartbeatAt: null,
        listenerCount: 0,
        peakListenerCount: 0,
        isRecordable: false,
        archiveRequested: false,
        archiveStatus: 'none',
        streamMethodLockedAtStart: true,
        selectedProviderUpdatedAt: now,
        selectedProviderUpdatedBy: uid,
        archiveNote: programOutputState.archiveNote,
        archiveTrackPath: '',
        archiveTrackURL: '',
        moderationStatus: 'clear',
        reportCount: 0
      })
      if (accessMode === 'password') {
        const secret = hashPassword(request.data?.password)
        await db().collection('musicLiveStreamSecrets').doc(streamId).set({
          streamId,
          hostUid: uid,
          passwordHash: secret.hash,
          passwordSalt: secret.salt,
          passwordAlgorithm: secret.algorithm,
          passwordIterations: secret.iterations,
          createdAt: now,
          updatedAt: now
        })
      }
      liveLog(stage, { uid, streamId, status: 'starting' })

      liveLog('response returned', { uid, streamId })
      return {
        ok: true,
        streamId,
        roomName,
        livekitRoomName: roomName,
        hostToken,
        url: config?.url || '',
        streamKey: selectedProvider === 'hlsEdge' ? programOutputState.streamKey : '',
        hlsPlaybackUrl: selectedProvider === 'hlsEdge' ? programOutputState.hlsPlaybackUrl : '',
        listenerURL: `/music/live/${streamId}`
      }
    } catch (error) {
      liveWarn('error stage', {
        stage,
        code: error?.code || 'internal',
        message: error?.message || 'Unknown live stream error',
        hasStreamRef: Boolean(streamRef)
      })
      if (streamRef) {
        await streamRef.set({
          status: 'error',
          isLive: false,
          connectionStatus: 'error',
          errorStage: stage,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch((writeError) => liveWarn('error cleanup failed', { message: writeError?.message || String(writeError) }))
      }
      if (error instanceof HttpsError) throw error
      throw new HttpsError('internal', 'Unable to start stream. Please try again. If this keeps happening, contact support.', { stage })
    }
  }
)

const prepareMusicLiveStreamDraft = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to prepare a live stream.')
  const { user, profile, accountPermissions } = await loadAccount(uid)
  assertEligible({ auth: request.auth, user, profile, accountPermissions })

  const requestedStreamId = cleanId(request.data?.streamId, 120)
  const streamRef = requestedStreamId ? db().collection('musicLiveStreams').doc(requestedStreamId) : db().collection('musicLiveStreams').doc()
  const streamId = streamRef.id
  const snap = await streamRef.get()
  const existingStream = snap.exists ? snap.data() || {} : {}
  if (snap.exists) {
    const stream = existingStream
    if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can update this draft stream.')
    if (!['draft', 'setup', 'error'].includes(stream.status || 'draft')) {
      return { ok: true, streamId, status: stream.status || 'live' }
    }
  }

  const metadata = cleanStreamMetadata(request.data || {})
  const audioMode = normalizeAudioMode(request.data?.audioMode)
  const selectedInputSource = normalizeInputSource(request.data?.inputSource || request.data?.selectedInputSource)
  const selectedSequenceId = cleanId(request.data?.sequenceId || request.data?.selectedSequenceId, 160)
  const draftProtocol = normalizeStreamingProtocol(request.data || {}, existingStream)
  const previousKey = sanitizeStreamKey(request.data?.streamKey || existingStream.streamKey || '')
  const nextKey = draftProtocol === 'hls'
    ? ensureSessionStreamKey(previousKey)
    : ''
  const draftData = draftProtocol === 'hls'
    ? { ...(request.data || {}), streamKey: nextKey }
    : request.data || {}
  const programOutputState = cleanProgramOutputState(draftData, { existing: existingStream, selectedInputSource })
  const now = admin.firestore.FieldValue.serverTimestamp()
  const hostDisplayName = cleanString(profile.displayName || user.displayName || request.auth.token.name || 'Melogic Creator', 80)
  const hostPhotoURL = cleanString(profile.avatarURL || user.photoURL || request.auth.token.picture || '', 1000)
  const hostUsername = cleanString(profile.username || profile.handle || user.username || user.handle || request.auth.token.username || '', 80)
  const title = cleanString(request.data?.title, 90) || 'Untitled live stream'
  const roomName = programOutputState.provider === 'nativeWeb' ? cleanRoomName(`music-live-${streamId}`) : ''

  liveWriterLog(streamId, programOutputState)
  await streamRef.set({
    streamId,
    hostUid: uid,
    hostDisplayName,
    hostUsername,
    hostPhotoURL,
    hostAvatarURL: hostPhotoURL,
    title,
    description: metadata.description,
    category: metadata.category,
    tags: metadata.tags,
    coverArtPath: metadata.coverArtPath,
    coverArtURL: metadata.coverArtURL,
    coverImageURL: metadata.coverImageURL,
    coverStoragePath: metadata.coverStoragePath,
    coverArtSource: metadata.coverArtSource,
    status: 'draft',
    isLive: false,
    connectionStatus: 'draft',
    broadcastState: 'draft',
    visibility: metadata.visibility,
    accessMode: metadata.accessMode,
    passwordProtected: metadata.accessMode === 'password',
    audioMode,
    selectedInputSource,
    selectedSequenceId,
    audioProfile: audioMode === 'music' ? 'high_quality_music' : 'podcast_voice',
    ...programOutputState,
    ...(programOutputState.provider === 'hlsEdge' ? bufferedBroadcastFields(draftData, existingStream) : {}),
    audioPublished: false,
    videoPublished: false,
    programHasAudio: programOutputState.audioEnabled && programOutputState.programHasAudio,
    programHasVideo: programOutputState.videoEnabled && programOutputState.programHasVideo,
    hostConnected: false,
    roomName,
    livekitRoomName: roomName,
    livekitRoomSid: '',
    selectedProviderUpdatedAt: now,
    selectedProviderUpdatedBy: uid,
    startedAt: null,
    endedAt: null,
    createdAt: existingStream.createdAt || now,
    updatedAt: now,
    lastHostHeartbeatAt: null,
    listenerCount: 0,
    peakListenerCount: 0,
    isRecordable: false,
    archiveRequested: false,
    archiveStatus: 'none',
    moderationStatus: 'clear',
    reportCount: 0
  })

  if (metadata.accessMode === 'password' && cleanString(request.data?.password, 200)) {
    const secret = hashPassword(request.data?.password)
    await db().collection('musicLiveStreamSecrets').doc(streamId).set({
      streamId,
      hostUid: uid,
      passwordHash: secret.hash,
      passwordSalt: secret.salt,
      passwordAlgorithm: secret.algorithm,
      passwordIterations: secret.iterations,
      createdAt: now,
      updatedAt: now
    }, { merge: true })
  }

  console.log('[Stream Key] ensured', {
    streamId,
    previousKey,
    nextKey,
    forceNew: false,
    status: existingStream.status || 'new',
    ingestMethod: programOutputState.ingestMethod,
    hlsUrl: buildHlsPlaybackUrl(nextKey)
  })
  return {
    ok: true,
    streamId,
    status: 'draft',
    streamKey: programOutputState.streamKey,
    hlsPlaybackUrl: programOutputState.hlsPlaybackUrl
  }
})

const markMusicLiveStreamOnAir = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to mark a stream live.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can mark this stream live.')
  const requestedProtocol = normalizeStreamingProtocol(request.data || {}, stream)
  const requestedProvider = requestedProtocol === 'nativeStreaming' ? 'firebaseSegments' : 'hlsEdge'
  const persistedStreamKey = sanitizeStreamKey(stream.streamKey || '')
  const requestedStreamKey = sanitizeStreamKey(request.data?.streamKey || '')
  if (requestedProvider === 'hlsEdge' && (
    !isValidGeneratedStreamKey(persistedStreamKey)
    || (requestedStreamKey && requestedStreamKey !== persistedStreamKey)
  )) {
    throw new HttpsError('failed-precondition', 'The stream key changed after the stream session was created.', {
      streamId,
      persistedStreamKey,
      requestedStreamKey
    })
  }
  const lockedRequestData = requestedProvider === 'hlsEdge'
    ? { ...(request.data || {}), streamKey: persistedStreamKey }
    : request.data || {}
  const diagnostics = markLiveValidationDetails({ streamId, provider: requestedProvider, stream, requestData: lockedRequestData })
  const allowedBufferedStatuses = new Set(['draft', 'setup', 'starting', 'error', 'live'])
  const canMarkLive = allowedBufferedStatuses.has(stream.status || '')
    && diagnostics.missingRequiredFields.length === 0
    && diagnostics.failedConditions.length === 0
  if (!canMarkLive) {
    const rejectionDiagnostics = {
      ...diagnostics,
      uid,
      streamHostUid: cleanString(stream.hostUid || '', 120),
      streamStatus: cleanString(stream.status || '', 80),
      requestedProvider,
      requestHostSessionId: cleanString(request.data?.hostSessionId || '', 120),
      requestBroadcastState: cleanString(request.data?.broadcastState || '', 80),
      requestNativeStreamingStatus: cleanString(request.data?.nativeStreaming?.status || '', 80),
      canMarkLive
    }
    liveWarn('mark live validation failed', rejectionDiagnostics)
    throw new HttpsError('failed-precondition', 'This stream cannot be marked live.', rejectionDiagnostics)
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const programOutputState = cleanProgramOutputState(lockedRequestData, {
    existing: stream,
    selectedInputSource: stream.selectedInputSource || 'browser',
    defaultAudioPublished: true
  })
  const bufferedState = requestedProtocol === 'hls'
    ? bufferedBroadcastFields(lockedRequestData, stream)
    : {}
  const hlsEdgeStream = requestedProtocol === 'hls'
  const safeLiveTitle = cleanString(request.data?.title || stream.title || 'Untitled live stream', 90)
  const safeLiveVisibility = ALLOWED_VISIBILITIES.has(request.data?.visibility)
    ? request.data.visibility
    : ALLOWED_VISIBILITIES.has(stream.visibility) ? stream.visibility : 'public'
  const safeLiveAccessMode = ALLOWED_ACCESS_MODES.has(request.data?.accessMode)
    ? request.data.accessMode
    : ALLOWED_ACCESS_MODES.has(stream.accessMode) ? stream.accessMode : safeLiveVisibility
  liveWriterLog(streamId, { ...programOutputState, ...bufferedState })
  await streamRef.set({
    status: 'live',
    isLive: true,
    title: safeLiveTitle,
    visibility: safeLiveVisibility,
    accessMode: safeLiveAccessMode,
    passwordProtected: safeLiveAccessMode === 'password',
    ...programOutputState,
    ...bufferedState,
    connectionStatus: 'live',
    broadcastState: requestedProtocol === 'nativeStreaming' ? 'liveIdleNoListeners' : 'liveBroadcasting',
    hostConnected: true,
    provider: programOutputState.provider,
    ingestMode: programOutputState.ingestMode,
    playbackMode: programOutputState.playbackMode,
    hostActive: true,
    hostSessionId: cleanString(request.data?.hostSessionId || programOutputState.hostSessionId || '', 120),
    listenerCount: Number.isFinite(Number(stream.listenerCount)) ? Number(stream.listenerCount) : 0,
    startedAt: now,
    endedAt: null,
    endReason: '',
    cleanupSource: '',
    ...(hlsEdgeStream ? {
      hlsHealth: 'warming',
      hlsLastOkAt: null,
      hlsLastCheckedAt: null,
      hlsLastManifestSequence: null,
      hlsLastError: '',
      hlsResponseCode: 0,
      hlsStartedAt: now,
      hlsSecondsSinceStart: 0
    } : {}),
    updatedAt: now,
    lastHostHeartbeatAt: now
  }, { merge: true })

  liveLog('stream marked live', { uid, streamId, provider: programOutputState.provider, streamingProtocol: requestedProtocol, validationBranch: diagnostics.validationBranch, broadcastState: requestedProtocol === 'nativeStreaming' ? 'liveIdleNoListeners' : 'liveBroadcasting' })
  return {
    ok: true,
    streamId,
    status: 'live',
    ...(requestedProtocol === 'hls' ? bufferedState : {})
  }
})

const heartbeatMusicLiveStream = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to heartbeat a stream.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can heartbeat this stream.')
  if (!['starting', 'live'].includes(stream.status)) throw new HttpsError('failed-precondition', 'This stream is no longer active.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  const heartbeatData = isHlsEdgeStream(stream)
    ? { ...(request.data || {}), streamKey: stream.streamKey || '' }
    : request.data || {}
  const programOutputState = cleanProgramOutputState(heartbeatData, {
    existing: stream,
    selectedInputSource: stream.selectedInputSource || 'browser',
    defaultAudioPublished: true
  })
  const bufferedState = programOutputState.provider === 'hlsEdge'
    ? bufferedBroadcastFields(heartbeatData, stream)
    : {}
  const requestedConnectionStatus = cleanString(request.data?.connectionStatus || stream.connectionStatus || '', 80)
  liveWriterLog(streamId, { ...programOutputState, ...bufferedState })
  await streamRef.set({
    connectionStatus: requestedConnectionStatus === 'reconnecting' ? 'reconnecting' : 'live',
    broadcastState: programOutputState.streamingProtocol === 'nativeStreaming'
      ? cleanString(request.data?.broadcastState || stream.broadcastState || 'liveIdleNoListeners', 80)
      : 'liveBroadcasting',
    hostActive: true,
    hostSessionId: cleanString(request.data?.hostSessionId || programOutputState.hostSessionId || stream.hostSessionId || '', 120),
    hostConnected: true,
    ...programOutputState,
    ...bufferedState,
    lastHostHeartbeatAt: now,
    updatedAt: now
  }, { merge: true })

  return { ok: true, streamId }
})

const updateMusicLiveStreamInfo = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update live stream info.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  const adminAuth = isAdminAuth(request.auth)
  if (stream.hostUid !== uid && !adminAuth) throw new HttpsError('permission-denied', 'Only the host can update this stream.')
  if (stream.status === 'ended' && !adminAuth) throw new HttpsError('failed-precondition', 'Ended streams cannot be edited.')

  const metadata = cleanStreamMetadata(request.data || {})
  if (metadata.title.length < 3) throw new HttpsError('invalid-argument', 'Stream title must be at least 3 characters.')
  const now = admin.firestore.FieldValue.serverTimestamp()
  const secretRef = db().collection('musicLiveStreamSecrets').doc(streamId)
  if (metadata.accessMode === 'password') {
    const password = cleanString(request.data?.password, 200)
    const existingSecret = await secretRef.get()
    if (!existingSecret.exists && !password) throw new HttpsError('invalid-argument', 'Add a listener password before making this stream password-protected.')
    if (password) {
      const secret = hashPassword(password)
      await secretRef.set({
        streamId,
        hostUid: stream.hostUid,
        passwordHash: secret.hash,
        passwordSalt: secret.salt,
        passwordAlgorithm: secret.algorithm,
        passwordIterations: secret.iterations,
        updatedAt: now,
        createdAt: existingSecret.exists ? existingSecret.data()?.createdAt || now : now
      }, { merge: true })
    }
  } else {
    await secretRef.delete().catch(() => {})
  }
  const requestedDraftKey = sanitizeStreamKey(request.data?.streamKey || stream.streamKey || '')
  const updateStreamKey = isHlsEdgeStream(stream)
    ? stream.status === 'live'
      ? sanitizeStreamKey(stream.streamKey || '')
      : ensureSessionStreamKey(requestedDraftKey)
    : ''
  const updateData = isHlsEdgeStream(stream)
    ? { ...(request.data || {}), streamKey: updateStreamKey }
    : request.data || {}
  const programOutputState = cleanProgramOutputState(updateData, {
    existing: stream,
    selectedInputSource: normalizeInputSource(request.data?.inputSource || request.data?.selectedInputSource || stream.selectedInputSource)
  })
  const bufferedState = programOutputState.streamingProtocol === 'hls' ? bufferedBroadcastFields(updateData, stream) : {}
  liveWriterLog(streamId, { ...programOutputState, ...bufferedState })
  await streamRef.set({
    ...metadata,
    selectedInputSource: normalizeInputSource(request.data?.inputSource || request.data?.selectedInputSource || stream.selectedInputSource),
    selectedSequenceId: cleanId(request.data?.sequenceId || request.data?.selectedSequenceId || stream.selectedSequenceId, 160),
    ...programOutputState,
    ...bufferedState,
    selectedProviderUpdatedAt: now,
    selectedProviderUpdatedBy: uid,
    updatedAt: now,
    lastMetadataUpdateAt: now
  }, { merge: true })

  return {
    ok: true,
    streamId,
    ...metadata,
    streamKey: programOutputState.streamKey,
    hlsPlaybackUrl: programOutputState.hlsPlaybackUrl
  }
})

async function endStreamByHost({ uid, streamId, reason = 'host_ended' }) {
  const cleanStreamId = cleanString(streamId, 120)
  if (!cleanStreamId || cleanStreamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(cleanStreamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can end this stream.')
  console.log('[Live End] ending stream', { streamId: cleanStreamId, uid, reason })

  if (isObsHlsEdgeStream(stream) && (reason === 'host_unload' || reason === 'host_pagehide')) {
    await streamRef.set({
      hostActive: false,
      hostConnected: false,
      connectionStatus: 'live',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
    liveLog('external encoder kept live after browser disconnect', { uid, streamId: cleanStreamId, reason })
    return { ok: true, streamId: cleanStreamId, status: 'live', externalEncoderActive: true }
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  await streamRef.set({
    status: 'ended',
    isLive: false,
    connectionStatus: reason === 'host_unload' || reason === 'host_pagehide' ? 'host_disconnected' : 'ended',
    broadcastState: 'ended',
    hostActive: false,
    hostSessionId: '',
    hostConnected: false,
    audioPublished: false,
    videoPublished: false,
    programHasAudio: false,
    programHasVideo: false,
    hlsHealth: 'ended',
    hlsLastError: '',
    endedAt: now,
    endReason: cleanString(reason, 80) || 'host_ended',
    cleanupSource: reason === 'host_unload' || reason === 'host_pagehide' ? 'heartbeat' : 'host_end',
    updatedAt: now,
    listenerCount: 0
  }, { merge: true })

  return { ok: true, streamId: cleanStreamId, status: 'ended' }
}

const joinMusicLiveStream = onCall(
  {
    region: 'us-central1',
    secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET],
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    const streamId = cleanString(request.data?.streamId, 120)
    if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
    const streamRef = db().collection('musicLiveStreams').doc(streamId)
    const snap = await streamRef.get()
    if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
    const stream = snap.data() || {}
    if (stream.status !== 'live') throw new HttpsError('failed-precondition', 'This stream is not live.')
    const accessMode = stream.accessMode || stream.visibility || 'private'
    if (accessMode === 'private' || stream.visibility === 'private') throw new HttpsError('permission-denied', 'This stream is private.')
    const provider = normalizeProvider(stream.provider)
    const isFirebaseSegments = provider === 'firebaseSegments'
    const isBufferedBroadcast = provider === 'hlsEdge'
    const externalEncoder = isObsHlsEdgeStream(stream)
    if (!externalEncoder && (stream.hostConnected !== true || (!isFirebaseSegments && !isBufferedBroadcast && !isStreamPublishing(stream)) || !isHeartbeatFresh(stream))) {
      await streamRef.set({
        status: 'ended',
        isLive: false,
        connectionStatus: 'stale',
        hostConnected: false,
        audioPublished: false,
        videoPublished: false,
        programHasAudio: false,
        programHasVideo: false,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endReason: 'heartbeat_stale',
        cleanupSource: 'join_guard',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        listenerCount: 0
      }, { merge: true })
      throw new HttpsError('failed-precondition', 'This stream has ended.')
    }
    if (accessMode === 'password' || stream.passwordProtected === true) {
      const secretSnap = await db().collection('musicLiveStreamSecrets').doc(streamId).get()
      if (!verifyPassword(request.data?.password, secretSnap.data() || {})) {
        throw new HttpsError('permission-denied', 'Incorrect stream password.')
      }
    }
    if (provider === 'nativeWeb' && !stream.livekitRoomName && !stream.roomName) throw new HttpsError('failed-precondition', 'This website-native stream is missing its LiveKit room.')

    const uid = request.auth?.uid || ''
    const anonId = cleanId(request.data?.anonId, 80) || cleanId(request.data?.presenceId, 80) || `${Date.now()}${Math.random().toString(36).slice(2, 8)}`
    const presenceId = cleanId(request.data?.presenceId, 120) || (uid ? `uid-${uid}` : `anon-${anonId}`)
    const identity = uid ? `listener-${uid}` : `listener-anon-${anonId}`
    const name = cleanString(request.auth?.token?.name || request.auth?.token?.email || 'Melogic Listener', 80)
    const roomName = provider === 'nativeWeb' ? cleanRoomName(stream.livekitRoomName || stream.roomName) : ''
    const listenerToken = provider !== 'nativeWeb' ? '' : await createLiveKitJwt({
      identity,
      name,
      roomName,
      role: 'listener',
      canPublish: false,
      config: livekitConfig('listener LiveKit config validated')
    })

    const now = admin.firestore.FieldValue.serverTimestamp()
    await streamRef.collection('presence').doc(presenceId).set({
      presenceId,
      streamId,
      uid: uid || null,
      anonId: uid ? null : anonId,
      displayName: uid ? name : 'Anonymous listener',
      joinedAt: now,
      lastSeenAt: now,
      userAgent: cleanString(request.rawRequest?.headers?.['user-agent'] || '', 180)
    }, { merge: true })
    const listenerCount = await recomputeListenerCount(streamRef)

    return {
      ok: true,
      streamId,
      roomName,
      provider,
      playbackMode: provider === 'firebaseSegments' ? 'firebaseSegments' : provider === 'hlsEdge' ? 'hls' : 'webrtc',
      streamKey: sanitizeStreamKey(stream.streamKey || ''),
      hlsPlaybackUrl: buildHlsPlaybackUrl(stream.streamKey || '') || sanitizeHlsPlaybackUrl(stream.hlsPlaybackUrl || ''),
      nativeStreaming: stream.nativeStreaming || nativeStreamingDefaults(),
      audioPublished: stream.audioPublished === true,
      videoPublished: stream.videoPublished === true,
      programHasAudio: stream.programHasAudio === true,
      programHasVideo: stream.programHasVideo === true,
      listenerToken,
      token: listenerToken,
      url: provider === 'nativeWeb' ? LIVEKIT_URL.value() : '',
      identity,
      presenceId,
      listenerCount
    }
  }
)

const endMusicLiveStream = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to end a live stream.')
  const streamId = cleanString(request.data?.streamId, 120)
  return endStreamByHost({ uid, streamId, reason: cleanString(request.data?.reason, 80) || 'host_ended' })
})

const updateMusicLiveListenerPresence = onCall({ region: 'us-central1' }, async (request) => {
  const streamId = cleanString(request.data?.streamId, 120)
  const presenceId = cleanId(request.data?.presenceId, 120)
  if (!streamId || streamId.includes('/') || !presenceId) throw new HttpsError('invalid-argument', 'A valid stream and listener presence id are required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const presenceRef = streamRef.collection('presence').doc(presenceId)
  const presenceSnap = await presenceRef.get()
  if (!presenceSnap.exists) throw new HttpsError('failed-precondition', 'Listener presence is not active.')
  const streamSnap = await streamRef.get()
  if (!streamSnap.exists || !isPubliclyJoinable(streamSnap.data() || {})) throw new HttpsError('failed-precondition', 'This stream is no longer live.')
  await presenceRef.set({ lastSeenAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  const listenerCount = await recomputeListenerCount(streamRef)
  return { ok: true, streamId, presenceId, listenerCount }
})

const leaveMusicLiveStream = onCall({ region: 'us-central1' }, async (request) => {
  const streamId = cleanString(request.data?.streamId, 120)
  const presenceId = cleanId(request.data?.presenceId, 120)
  if (!streamId || streamId.includes('/') || !presenceId) throw new HttpsError('invalid-argument', 'A valid stream and listener presence id are required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  await streamRef.collection('presence').doc(presenceId).delete().catch(() => {})
  const listenerCount = await recomputeListenerCount(streamRef).catch(() => 0)
  return { ok: true, streamId, presenceId, listenerCount }
})

const getMusicLiveViewerState = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  if (!uid) return { ok: true, reaction: 'none', saved: false }
  const [reactionSnap, savedSnap] = await Promise.all([
    db().collection('musicLiveStreams').doc(streamId).collection('reactions').doc(uid).get(),
    db().collection('users').doc(uid).collection('savedMusicLiveStreams').doc(streamId).get()
  ])
  return {
    ok: true,
    reaction: reactionSnap.exists ? cleanString(reactionSnap.data()?.reaction, 20) || 'none' : 'none',
    saved: savedSnap.exists
  }
})

const toggleMusicLiveReaction = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to react to live streams.')
  const streamId = cleanString(request.data?.streamId, 120)
  const nextReaction = ALLOWED_REACTIONS.has(request.data?.reaction) ? request.data.reaction : 'none'
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const account = await loadAccount(uid)
  assertCanInteract({ auth: request.auth, ...account })
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const reactionRef = streamRef.collection('reactions').doc(uid)
  const result = await db().runTransaction(async (transaction) => {
    const [streamSnap, reactionSnap] = await Promise.all([transaction.get(streamRef), transaction.get(reactionRef)])
    if (!streamSnap.exists) throw new HttpsError('not-found', 'Live stream not found.')
    const stream = streamSnap.data() || {}
    if (!['public', 'unlisted', 'password'].includes(stream.accessMode || stream.visibility || 'private')) throw new HttpsError('permission-denied', 'This stream is not available for reactions.')
    const previous = reactionSnap.exists ? cleanString(reactionSnap.data()?.reaction, 20) : 'none'
    const updates = { updatedAt: admin.firestore.FieldValue.serverTimestamp() }
    if (previous === 'like') updates.likeCount = admin.firestore.FieldValue.increment(-1)
    if (previous === 'dislike') updates.dislikeCount = admin.firestore.FieldValue.increment(-1)
    if (nextReaction === 'like') updates.likeCount = admin.firestore.FieldValue.increment(1)
    if (nextReaction === 'dislike') updates.dislikeCount = admin.firestore.FieldValue.increment(1)
    transaction.set(streamRef, updates, { merge: true })
    transaction.set(reactionRef, {
      uid,
      streamId,
      reaction: nextReaction,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
    return {
      reaction: nextReaction,
      likeCount: Math.max(0, Number(stream.likeCount || 0) + (previous === 'like' ? -1 : 0) + (nextReaction === 'like' ? 1 : 0)),
      dislikeCount: Math.max(0, Number(stream.dislikeCount || 0) + (previous === 'dislike' ? -1 : 0) + (nextReaction === 'dislike' ? 1 : 0))
    }
  })
  return { ok: true, streamId, ...result }
})

const toggleSaveMusicLiveStream = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to save live streams.')
  const streamId = cleanString(request.data?.streamId, 120)
  const saved = request.data?.saved === true
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const account = await loadAccount(uid)
  assertCanInteract({ auth: request.auth, ...account })
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const saveRef = db().collection('users').doc(uid).collection('savedMusicLiveStreams').doc(streamId)
  const result = await db().runTransaction(async (transaction) => {
    const [streamSnap, saveSnap] = await Promise.all([transaction.get(streamRef), transaction.get(saveRef)])
    if (!streamSnap.exists) throw new HttpsError('not-found', 'Live stream not found.')
    const stream = streamSnap.data() || {}
    if (saved && !saveSnap.exists) {
      transaction.set(saveRef, {
        streamId,
        savedAt: admin.firestore.FieldValue.serverTimestamp(),
        hostUid: stream.hostUid || '',
        title: stream.title || '',
        coverArtURL: stream.coverArtURL || '',
        status: stream.status || ''
      })
      transaction.set(streamRef, { saveCount: admin.firestore.FieldValue.increment(1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    } else if (!saved && saveSnap.exists) {
      transaction.delete(saveRef)
      transaction.set(streamRef, { saveCount: admin.firestore.FieldValue.increment(-1), updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    }
    return { saved, saveCount: Math.max(0, Number(stream.saveCount || 0) + (saved && !saveSnap.exists ? 1 : 0) - (!saved && saveSnap.exists ? 1 : 0)) }
  })
  return { ok: true, streamId, ...result }
})

async function assertStreamHost(streamId, uid) {
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can update this live stream.')
  return { streamRef, stream }
}

function cleanSequenceItem(data = {}) {
  return {
    title: cleanString(data.title, 120),
    artist: cleanString(data.artist, 120),
    album: cleanString(data.album, 120),
    artworkURL: sanitizeCoverArtURL(data.artworkURL),
    notes: cleanString(data.notes, 600)
  }
}

const upsertMusicLiveSequenceItem = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update now-playing items.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const { streamRef, stream } = await assertStreamHost(streamId, uid)
  const item = cleanSequenceItem(request.data || {})
  if (!item.title) throw new HttpsError('invalid-argument', 'Sequence item title is required.')
  const itemId = cleanId(request.data?.itemId, 120) || streamRef.collection('sequenceItems').doc().id
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    itemId,
    streamId,
    hostUid: uid,
    ...item,
    updatedAt: now
  }
  if (!request.data?.itemId) payload.createdAt = now
  await streamRef.collection('sequenceItems').doc(itemId).set(payload, { merge: true })
  if (stream.currentNowPlaying?.sequenceItemId === itemId) {
    await streamRef.set({
      currentNowPlaying: nowPlayingPayload(item, itemId, now),
      lastMetadataUpdateAt: now,
      updatedAt: now
    }, { merge: true })
  }
  return { ok: true, streamId, itemId, item }
})

const deleteMusicLiveSequenceItem = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update now-playing items.')
  const streamId = cleanString(request.data?.streamId, 120)
  const itemId = cleanId(request.data?.itemId, 120)
  if (!streamId || streamId.includes('/') || !itemId) throw new HttpsError('invalid-argument', 'A valid stream and item id are required.')
  const { streamRef, stream } = await assertStreamHost(streamId, uid)
  await streamRef.collection('sequenceItems').doc(itemId).delete()
  if (stream.currentNowPlaying?.sequenceItemId === itemId) {
    await streamRef.set({
      currentNowPlaying: admin.firestore.FieldValue.delete(),
      lastMetadataUpdateAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
  }
  return { ok: true, streamId, itemId }
})

const setMusicLiveNowPlaying = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update now-playing.')
  const streamId = cleanString(request.data?.streamId, 120)
  const itemId = cleanId(request.data?.itemId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const { streamRef } = await assertStreamHost(streamId, uid)
  const now = admin.firestore.FieldValue.serverTimestamp()
  if (!itemId) {
    await streamRef.set({
      currentNowPlaying: admin.firestore.FieldValue.delete(),
      lastMetadataUpdateAt: now,
      updatedAt: now
    }, { merge: true })
    return { ok: true, streamId, currentNowPlaying: null }
  }
  const itemSnap = await streamRef.collection('sequenceItems').doc(itemId).get()
  if (!itemSnap.exists) throw new HttpsError('not-found', 'Sequence item not found.')
  const item = cleanSequenceItem(itemSnap.data() || {})
  await streamRef.set({
    currentNowPlaying: nowPlayingPayload(item, itemId, now),
    lastMetadataUpdateAt: now,
    updatedAt: now
  }, { merge: true })
  return { ok: true, streamId, currentNowPlaying: nowPlayingPayload(item, itemId, new Date().toISOString()) }
})

function parseBeaconBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'))
    } catch {
      return {}
    }
  }
  if (req.body && typeof req.body === 'object') return req.body
  const raw = req.rawBody ? req.rawBody.toString('utf8') : ''
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const endMusicLiveStreamBeacon = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method-not-allowed' })
    return
  }
  try {
    const body = parseBeaconBody(req)
    const authHeader = cleanString(req.headers.authorization || '', 2000)
    const idToken = cleanString(authHeader.replace(/^Bearer\s+/i, '') || body.idToken, 2000)
    const decoded = await admin.auth().verifyIdToken(idToken)
    await endStreamByHost({
      uid: decoded.uid,
      streamId: body.streamId,
      reason: cleanString(body.reason, 80) || 'host_unload'
    })
    res.status(200).json({ ok: true })
  } catch (error) {
    liveWarn('beacon end failed', { code: error?.code || 'internal', message: error?.message || String(error) })
    res.status(200).json({ ok: false })
  }
})

const sendMusicLiveChatMessage = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to join live chat.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const text = cleanString(request.data?.text, CHAT_TEXT_MAX_LENGTH)
  if (!text) throw new HttpsError('invalid-argument', 'Message text is required.')

  const [{ user, profile, accountPermissions }, streamSnap] = await Promise.all([
    loadAccount(uid),
    db().collection('musicLiveStreams').doc(streamId).get()
  ])
  assertCanChat({ auth: request.auth, user, profile, accountPermissions })
  if (!streamSnap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = streamSnap.data() || {}
  if (stream.chatEnabled === false) throw new HttpsError('failed-precondition', 'Live chat is disabled by the host.')
  if (stream.status !== 'live' || !['public', 'unlisted'].includes(stream.visibility)) {
    throw new HttpsError('failed-precondition', 'This live chat is closed.')
  }
  const isFirebaseSegments = normalizeProvider(stream.provider) === 'firebaseSegments'
  if (!isObsHlsEdgeStream(stream) && (stream.hostConnected !== true || (!isFirebaseSegments && !isStreamPublishing(stream)) || !isHeartbeatFresh(stream))) {
    throw new HttpsError('failed-precondition', 'This live chat is closed.')
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const messageRef = db().collection('musicLiveStreams').doc(streamId).collection('chatMessages').doc()
  const displayName = cleanString(profile?.displayName || user?.displayName || request.auth.token.name || 'Melogic Listener', 80)
  const photoURL = cleanString(profile?.avatarURL || user?.photoURL || request.auth.token.picture || '', 1000)
  const message = {
    messageId: messageRef.id,
    streamId,
    uid,
    displayName,
    photoURL,
    text,
    createdAt: now,
    status: 'visible',
    moderationFlags: []
  }
  await messageRef.set(message)
  return { ok: true, messageId: messageRef.id }
})

async function cleanupMusicLiveStreamSnapshot(docSnap, now) {
  const stream = docSnap.data() || {}
  if (stream.status === 'live') {
    if (isHlsEdgeStream(stream)) {
      const health = await refreshHlsHealth(docSnap, stream)
      if (health.hlsHealth !== 'offline') return false
      await docSnap.ref.set({
        status: 'ended',
        isLive: false,
        connectionStatus: 'offline',
        hostConnected: false,
        audioPublished: false,
        videoPublished: false,
        endedAt: now,
        endReason: 'hls_manifest_offline',
        cleanupSource: 'scheduled_hls_health',
        updatedAt: now,
        listenerCount: 0
      }, { merge: true })
      return true
    }
    const isFirebaseSegments = normalizeProvider(stream.provider) === 'firebaseSegments'
    const stale = stream.hostConnected !== true || (!isFirebaseSegments && !isStreamPublishing(stream)) || !isHeartbeatFresh(stream)
    if (!stale) return false
    await docSnap.ref.set({
      status: 'ended',
      isLive: false,
      connectionStatus: 'stale',
      hostConnected: false,
      audioPublished: false,
      videoPublished: false,
      programHasAudio: false,
      programHasVideo: false,
      endedAt: now,
      endReason: stream.lastHostHeartbeatAt ? 'heartbeat_timeout' : 'empty_room',
      cleanupSource: 'scheduled',
      updatedAt: now,
      listenerCount: 0
    }, { merge: true })
    return true
  }
  if (stream.status === 'starting') {
    const updatedAt = timestampMillis(stream.updatedAt || stream.createdAt)
    if (updatedAt && Date.now() - updatedAt < STARTING_TIMEOUT_MS) return false
    await docSnap.ref.set({
      status: 'error',
      isLive: false,
      connectionStatus: 'error',
      hostConnected: false,
      audioPublished: false,
      videoPublished: false,
      programHasAudio: false,
      programHasVideo: false,
      errorReason: 'starting_timeout',
      cleanupSource: 'scheduled',
      updatedAt: now
    }, { merge: true })
    return true
  }
  return false
}

const cleanupStaleMusicLiveStreams = onSchedule(
  {
    region: 'us-central1',
    schedule: 'every 1 minutes',
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async () => {
    const now = admin.firestore.FieldValue.serverTimestamp()
    const [liveSnap, startingSnap] = await Promise.all([
      db().collection('musicLiveStreams').where('status', '==', 'live').limit(80).get(),
      db().collection('musicLiveStreams').where('status', '==', 'starting').limit(40).get()
    ])
    const docs = [...liveSnap.docs, ...startingSnap.docs]
    const cleanupResults = await Promise.all(docs.map((docSnap) => cleanupMusicLiveStreamSnapshot(docSnap, now)))
    const cleaned = cleanupResults.filter(Boolean).length
    liveLog('scheduled cleanup completed', {
      liveChecked: liveSnap.size,
      startingChecked: startingSnap.size,
      cleaned
    })
  }
)

module.exports = {
  prepareMusicLiveStreamDraft,
  startMusicLiveStream,
  markMusicLiveStreamOnAir,
  heartbeatMusicLiveStream,
  updateMusicLiveStreamInfo,
  joinMusicLiveStream,
  endMusicLiveStream,
  updateMusicLiveListenerPresence,
  leaveMusicLiveStream,
  getMusicLiveViewerState,
  toggleMusicLiveReaction,
  toggleSaveMusicLiveStream,
  upsertMusicLiveSequenceItem,
  deleteMusicLiveSequenceItem,
  setMusicLiveNowPlaying,
  endMusicLiveStreamBeacon,
  sendMusicLiveChatMessage,
  cleanupStaleMusicLiveStreams
}
