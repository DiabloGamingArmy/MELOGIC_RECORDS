import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { STREAM_PROVIDERS } from './streaming/streamingProviderTypes'
import { selectPublicPlaybackPlayer } from './streaming/publicPlaybackService'
import { buildHlsPlaybackUrl } from './streaming/hlsEdgePlayer'
import { isRecentHlsHealth } from './streaming/hlsHealth'
import { isValidGeneratedStreamKey } from './streaming/streamSessionKey'

const LIVE_CATEGORIES = ['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other']
const LIVE_HEARTBEAT_STALE_MS = 90 * 1000
export const HLS_EDGE_PROVIDER = 'hlsEdge'
export const HLS_EDGE_TRANSPORT = 'hls-edge'
export const HLS_PLAYBACK_MODE = 'hls'
export const HLS_STREAMING_PROTOCOL = 'hls'
export const NATIVE_STREAMING_PROTOCOL = 'nativeStreaming'
export const DEFAULT_HLS_EDGE_BASE_URL = 'https://stream.melogicrecords.studio/live'
export const DEFAULT_RTMP_INGEST_SERVER = 'rtmp://104.197.179.248/live'
export const DEFAULT_BROWSER_WHIP_INGEST_URL = 'https://ingest.melogicrecords.studio/rtc/v1/whip/?app=live&stream={streamKey}&eip=104.197.179.248'
export const HLS_EDGE_ARCHIVE_NOTE = 'HLS Edge streams publish through the Melogic streaming server and play through the HLS edge.'

export function sanitizeMusicLiveStreamKey(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]/g, '')
}

export function buildMusicLiveHlsUrl(streamKey = '') {
  const base = String(import.meta.env?.VITE_STREAM_EDGE_BASE_URL || DEFAULT_HLS_EDGE_BASE_URL).replace(/\/+$/, '')
  const cleanKey = sanitizeMusicLiveStreamKey(streamKey)
  return cleanKey ? `${base}/${cleanKey}.m3u8` : ''
}

export function buildMusicLiveWhipUrl(streamKey = '') {
  const template = String(import.meta.env?.VITE_BROWSER_WEBRTC_INGEST_URL || DEFAULT_BROWSER_WHIP_INGEST_URL)
  const cleanKey = sanitizeMusicLiveStreamKey(streamKey)
  if (!cleanKey) return ''
  const expanded = template.includes('{streamKey}') ? template.replaceAll('{streamKey}', encodeURIComponent(cleanKey)) : template
  try {
    const url = new URL(expanded)
    if (!template.includes('{streamKey}')) url.searchParams.set('stream', cleanKey)
    if (!url.searchParams.get('app')) url.searchParams.set('app', 'live')
    if (!url.searchParams.get('eip')) url.searchParams.set('eip', '104.197.179.248')
    return url.toString()
  } catch {
    return ''
  }
}

export function normalizeMusicLiveTransportPayload(payload = {}) {
  const streamingProtocol = String(payload.streamingProtocol || HLS_STREAMING_PROTOCOL)
  const rawMethod = String(payload.streamingMethod || payload.ingestMethod || payload.ingestMode || 'obsRtmp')
  const ingestMethod = /obs|rtmp|encoder/i.test(rawMethod) ? 'obsRtmp' : 'browserWebrtc'
  const streamKey = sanitizeMusicLiveStreamKey(payload.streamKey || payload.hlsStreamKey || payload.rtmpStreamKey || '')
  if (streamingProtocol === NATIVE_STREAMING_PROTOCOL) {
    return {
      ...payload,
      streamingProtocol: NATIVE_STREAMING_PROTOCOL,
      provider: STREAM_PROVIDERS.nativeStreaming,
      providerLabel: 'Native Streaming',
      transportProvider: 'firebase',
      playbackMode: 'firebaseSegments',
      ingestMethod: 'browserMediaRecorder',
      ingestProtocol: 'firebase',
      ingestMode: 'browser-media-recorder',
      streamingMethod: 'browserMediaRecorder',
      streamKey: '',
      hlsPlaybackUrl: '',
      hlsUrl: '',
      llhlsUrl: '',
      rtmpIngestServer: '',
      nativeStreaming: {
        ...(payload.nativeStreaming || {}),
        enabled: true,
        status: String(payload.nativeStreaming?.status || 'idleNoListeners')
      }
    }
  }
  const hlsUrl = buildMusicLiveHlsUrl(streamKey)
  return {
    ...payload,
    provider: HLS_EDGE_PROVIDER,
    providerLabel: 'Melogic Edge',
    transportProvider: HLS_EDGE_TRANSPORT,
    playbackMode: HLS_PLAYBACK_MODE,
    streamingProtocol: HLS_STREAMING_PROTOCOL,
    ingestMethod,
    ingestProtocol: ingestMethod === 'obsRtmp' ? 'rtmp' : 'webrtc',
    ingestMode: ingestMethod === 'obsRtmp' ? 'obs-rtmp' : 'browser-webrtc',
    streamingMethod: ingestMethod,
    latencyProfile: 'buffered',
    streamKey,
    hlsPlaybackUrl: hlsUrl,
    hlsUrl,
    llhlsUrl: '',
    rtmpIngestServer: ingestMethod === 'obsRtmp'
      ? String(import.meta.env?.VITE_STREAM_RTMP_INGEST_SERVER || DEFAULT_RTMP_INGEST_SERVER).replace(/\/+$/, '')
      : String(payload.rtmpIngestServer || '').trim(),
    browserWhipIngestUrl: ingestMethod === 'browserWebrtc' ? buildMusicLiveWhipUrl(streamKey) : '',
    nativeStreaming: {
      ...(payload.nativeStreaming || {}),
      enabled: false,
      status: 'disabled'
    },
    archiveNote: HLS_EDGE_ARCHIVE_NOTE
  }
}

export function normalizeLiveStreamTransport(payload = {}) {
  return normalizeMusicLiveTransportPayload(payload)
}

function liveWriterPayload(payload = {}) {
  const normalized = normalizeMusicLiveTransportPayload(payload)
  if (normalized.provider === HLS_EDGE_PROVIDER) {
    normalized.transportProvider = HLS_EDGE_TRANSPORT
    normalized.playbackMode = HLS_PLAYBACK_MODE
    if (!isValidGeneratedStreamKey(normalized.streamKey)) throw new Error('A valid 25-character stream key is required before save.')
    normalized.hlsPlaybackUrl = buildMusicLiveHlsUrl(normalized.streamKey)
    normalized.hlsUrl = normalized.hlsPlaybackUrl
  }
  console.log('[Music Live Writer] normalized transport payload', {
    provider: normalized.provider,
    providerLabel: normalized.providerLabel,
    streamingProtocol: normalized.streamingProtocol,
    transportProvider: normalized.transportProvider,
    playbackMode: normalized.playbackMode,
    ingestMethod: normalized.ingestMethod,
    ingestProtocol: normalized.ingestProtocol,
    ingestMode: normalized.ingestMode,
    streamKey: normalized.streamKey,
    hlsPlaybackUrl: normalized.hlsPlaybackUrl,
    hlsUrl: normalized.hlsUrl,
    nativeStreamingEnabled: normalized.nativeStreaming?.enabled
  })
  return normalized
}

function toIsoDate(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : fallback
}

function logMusicLiveReceiverTransport(stream = {}, selectedPlayer = '') {
  console.log('[Music Live Receiver] raw transport fields', {
    provider: stream.provider,
    providerLabel: stream.providerLabel,
    streamingProtocol: stream.streamingProtocol,
    transportProvider: stream.transportProvider,
    playbackMode: stream.playbackMode,
    ingestMethod: stream.ingestMethod,
    ingestProtocol: stream.ingestProtocol,
    ingestMode: stream.ingestMode,
    streamKey: stream.streamKey,
    hlsPlaybackUrl: stream.hlsPlaybackUrl,
    hlsUrl: stream.hlsUrl,
    nativeStreamingEnabled: stream.nativeStreaming?.enabled,
    selectedPlayer
  })
}

export function normalizeMusicLiveStream(dataOrSnap = {}, explicitId = '') {
  const raw = typeof dataOrSnap.data === 'function' ? dataOrSnap.data() || {} : dataOrSnap || {}
  const id = explicitId || dataOrSnap.id || raw.streamId || ''
  const category = LIVE_CATEGORIES.includes(raw.category) ? raw.category : 'music'
  const selectedPlayer = selectPublicPlaybackPlayer(raw)
  const provider = selectedPlayer === 'hls'
    ? HLS_EDGE_PROVIDER
    : selectedPlayer === 'firebaseSegments'
      ? STREAM_PROVIDERS.firebaseSegments
      : selectedPlayer === 'antMedia'
        ? STREAM_PROVIDERS.antMedia
        : HLS_EDGE_PROVIDER
  const rawProvider = String(raw.provider || '')
  const rawTransportProvider = String(raw.transportProvider || '')
  const rawPlaybackMode = String(raw.playbackMode || '')
  const rawStreamingProtocol = String(raw.streamingProtocol || '')
  const rawStreamKey = String(raw.streamKey || '')
  const rawHlsPlaybackUrl = String(raw.hlsPlaybackUrl || raw.hlsUrl || '')
  const explicitFirebasePlaybackMode = selectedPlayer === 'firebaseSegments' ? selectedPlayer : ''
  const hlsIngestMethod = raw.ingestMethod
    || (raw.ingestMode === 'browser-webrtc' ? 'browserWebrtc' : ['rtmp-obs', 'obs-rtmp'].includes(raw.ingestMode) ? 'obsRtmp' : '')
    || (raw.ingestProtocol === 'rtmp' ? 'obsRtmp' : raw.ingestProtocol === 'webrtc' ? 'browserWebrtc' : '')
    || 'obsRtmp'
  const normalizedStreamKey = provider === HLS_EDGE_PROVIDER && rawStreamKey ? sanitizeMusicLiveStreamKey(rawStreamKey) : rawStreamKey
  const streamKeyHlsUrl = provider === HLS_EDGE_PROVIDER ? buildHlsPlaybackUrl(normalizedStreamKey) : ''
  const normalizedHlsPlaybackUrl = provider === HLS_EDGE_PROVIDER
    ? streamKeyHlsUrl || rawHlsPlaybackUrl
    : rawHlsPlaybackUrl
  const normalizationApplied = provider === HLS_EDGE_PROVIDER && (
    rawProvider !== HLS_EDGE_PROVIDER
    || raw.transportProvider !== HLS_EDGE_TRANSPORT
    || rawPlaybackMode !== HLS_PLAYBACK_MODE
    || raw.ingestMethod !== hlsIngestMethod
    || rawStreamKey !== normalizedStreamKey
    || rawHlsPlaybackUrl !== normalizedHlsPlaybackUrl
  )
  const providerDefaults = provider === HLS_EDGE_PROVIDER
    ? { label: 'Melogic Edge', ingestMode: hlsIngestMethod === 'browserWebrtc' ? 'browser-webrtc' : 'obs-rtmp', playbackMode: HLS_PLAYBACK_MODE, transportProvider: HLS_EDGE_TRANSPORT }
    : provider === STREAM_PROVIDERS.firebaseSegments
      ? { label: 'Firebase Segments', ingestMode: 'browser-media-recorder', playbackMode: explicitFirebasePlaybackMode, transportProvider: 'firebase' }
      : { label: 'Ant Media', ingestMode: String(raw.ingestMode || ''), playbackMode: String(raw.playbackMode || 'webrtc'), transportProvider: String(raw.transportProvider || 'antmedia') }
  return {
    id,
    streamId: id,
    hostUid: String(raw.hostUid || ''),
    hostDisplayName: String(raw.hostDisplayName || 'Melogic Creator'),
    hostUsername: String(raw.hostUsername || raw.hostHandle || ''),
    hostPhotoURL: String(raw.hostPhotoURL || raw.hostAvatarURL || ''),
    hostAvatarURL: String(raw.hostAvatarURL || raw.hostPhotoURL || ''),
    title: String(raw.title || 'Untitled live stream'),
    description: String(raw.description || ''),
    category,
    tags: toStringArray(raw.tags),
    coverArtPath: String(raw.coverArtPath || raw.coverStoragePath || ''),
    coverStoragePath: String(raw.coverStoragePath || raw.coverArtPath || ''),
    coverArtURL: String(raw.coverArtURL || raw.coverImageURL || raw.coverURL || ''),
    coverImageURL: String(raw.coverImageURL || raw.coverArtURL || raw.coverURL || ''),
    coverArtSource: String(raw.coverArtSource || (raw.coverArtURL ? 'url' : 'fallback')),
    status: String(raw.status || 'draft'),
    isLive: raw.isLive === true || raw.status === 'live',
    visibility: String(raw.visibility || 'private'),
    accessMode: String(raw.accessMode || raw.visibility || 'private'),
    passwordProtected: raw.passwordProtected === true || raw.accessMode === 'password',
    audioMode: String(raw.audioMode || 'music'),
    selectedInputSource: raw.selectedInputSource === 'sequence' ? 'sequence' : 'browser',
    selectedSequenceId: String(raw.selectedSequenceId || ''),
    audioProfile: String(raw.audioProfile || ''),
    audioOnly: raw.audioOnly !== false,
    chatEnabled: raw.chatEnabled !== false,
    provider,
    rawProvider,
    rawTransportProvider,
    rawPlaybackMode,
    rawStreamingProtocol,
    rawStreamKey,
    rawHlsPlaybackUrl,
    normalizationApplied,
    providerLabel: String(provider === HLS_EDGE_PROVIDER ? 'Melogic Edge' : provider === STREAM_PROVIDERS.firebaseSegments ? 'Native Streaming' : raw.providerLabel || providerDefaults.label),
    streamingProtocol: String(provider === HLS_EDGE_PROVIDER ? HLS_STREAMING_PROTOCOL : provider === STREAM_PROVIDERS.firebaseSegments ? NATIVE_STREAMING_PROTOCOL : rawStreamingProtocol),
    transportProvider: String(provider === HLS_EDGE_PROVIDER ? HLS_EDGE_TRANSPORT : raw.transportProvider || providerDefaults.transportProvider),
    ingestMode: String(provider === HLS_EDGE_PROVIDER ? (hlsIngestMethod === 'obsRtmp' ? 'obs-rtmp' : 'browser-webrtc') : raw.ingestMode || providerDefaults.ingestMode),
    playbackMode: String(provider === HLS_EDGE_PROVIDER ? HLS_PLAYBACK_MODE : raw.playbackMode || providerDefaults.playbackMode),
    latencyProfile: String(raw.latencyProfile || (provider === HLS_EDGE_PROVIDER ? 'buffered' : 'realtime')),
    ingestMethod: String(provider === HLS_EDGE_PROVIDER ? hlsIngestMethod : raw.ingestMethod || ''),
    ingestProtocol: String(provider === HLS_EDGE_PROVIDER
      ? hlsIngestMethod === 'obsRtmp' ? 'rtmp' : 'webrtc'
      : raw.ingestProtocol || ''),
    streamKey: normalizedStreamKey,
    hlsPlaybackUrl: normalizedHlsPlaybackUrl,
    rtmpIngestServer: String(provider === HLS_EDGE_PROVIDER && hlsIngestMethod === 'obsRtmp'
      ? raw.rtmpIngestServer || import.meta.env?.VITE_STREAM_RTMP_INGEST_SERVER || DEFAULT_RTMP_INGEST_SERVER
      : raw.rtmpIngestServer || ''),
    audioOnlyHlsUrl: String(raw.audioOnlyHlsUrl || ''),
    nativeStreaming: provider === HLS_EDGE_PROVIDER
      ? { ...(raw.nativeStreaming && typeof raw.nativeStreaming === 'object' ? raw.nativeStreaming : {}), enabled: false, status: 'disabled' }
      : raw.nativeStreaming && typeof raw.nativeStreaming === 'object' ? raw.nativeStreaming : {},
    antMediaStreamId: String(raw.antMediaStreamId || ''),
    antMediaAppName: String(raw.antMediaAppName || ''),
    antMediaBaseUrl: String(raw.antMediaBaseUrl || raw.publicPlaybackBaseUrl || ''),
    hlsUrl: String(provider === HLS_EDGE_PROVIDER ? normalizedHlsPlaybackUrl : raw.hlsUrl || ''),
    llhlsUrl: String(raw.llhlsUrl || ''),
    browserWhipIngestUrl: String(raw.browserWhipIngestUrl || (hlsIngestMethod === 'browserWebrtc' ? buildMusicLiveWhipUrl(normalizedStreamKey) : '')),
    hlsHealth: String(raw.hlsHealth || ''),
    hlsStartedAt: toIsoDate(raw.hlsStartedAt),
    hlsSecondsSinceStart: toNumber(raw.hlsSecondsSinceStart),
    hlsLastOkAt: toIsoDate(raw.hlsLastOkAt),
    hlsLastCheckedAt: toIsoDate(raw.hlsLastCheckedAt),
    hlsLastManifestSequence: raw.hlsLastManifestSequence == null || raw.hlsLastManifestSequence === ''
      ? null
      : Number.isFinite(Number(raw.hlsLastManifestSequence)) ? Number(raw.hlsLastManifestSequence) : null,
    hlsLastError: String(raw.hlsLastError || ''),
    hlsResponseCode: Number(raw.hlsResponseCode || 0),
    hlsHasMediaSegments: raw.hlsHasMediaSegments === true,
    webRtcPlaybackUrl: String(raw.webRtcPlaybackUrl || ''),
    videoEnabled: raw.videoEnabled === true,
    audioEnabled: raw.audioEnabled !== false,
    hostConnected: raw.hostConnected === true,
    hostActive: raw.hostActive === true,
    hostSessionId: String(raw.hostSessionId || ''),
    audioPublished: raw.audioPublished === true,
    videoPublished: raw.videoPublished === true,
    programHasAudio: raw.programHasAudio === true,
    programHasVideo: raw.programHasVideo === true,
    activeVideoSource: String(raw.activeVideoSource || ''),
    activeAudioSources: raw.activeAudioSources && typeof raw.activeAudioSources === 'object'
      ? {
          browser: raw.activeAudioSources.browser !== false,
          sequence: raw.activeAudioSources.sequence === true
        }
      : {
          browser: raw.selectedInputSource !== 'sequence',
          sequence: raw.selectedInputSource === 'sequence'
        },
    programState: raw.programState && typeof raw.programState === 'object' ? raw.programState : {},
    providerDiagnostics: raw.providerDiagnostics && typeof raw.providerDiagnostics === 'object' ? raw.providerDiagnostics : {},
    connectionStatus: String(raw.connectionStatus || raw.status || ''),
    roomName: String(raw.roomName || raw.livekitRoomName || ''),
    livekitRoomName: String(raw.livekitRoomName || raw.roomName || ''),
    livekitRoomSid: String(raw.livekitRoomSid || ''),
    startedAt: toIsoDate(raw.startedAt),
    endedAt: toIsoDate(raw.endedAt),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    lastHostHeartbeatAt: toIsoDate(raw.lastHostHeartbeatAt),
    lastMetadataUpdateAt: toIsoDate(raw.lastMetadataUpdateAt),
    listenerCount: toNumber(raw.listenerCount),
    peakListenerCount: toNumber(raw.peakListenerCount),
    likeCount: toNumber(raw.likeCount),
    dislikeCount: toNumber(raw.dislikeCount),
    saveCount: toNumber(raw.saveCount),
    currentNowPlaying: raw.currentNowPlaying && typeof raw.currentNowPlaying === 'object'
      ? {
          title: String(raw.currentNowPlaying.title || ''),
          artist: String(raw.currentNowPlaying.artist || ''),
          album: String(raw.currentNowPlaying.album || ''),
          artworkURL: String(raw.currentNowPlaying.artworkURL || ''),
          sequenceItemId: String(raw.currentNowPlaying.sequenceItemId || ''),
          sourceType: String(raw.currentNowPlaying.sourceType || (raw.currentNowPlaying.sequenceItemId ? 'sequenceItem' : 'manual')),
          sourceId: String(raw.currentNowPlaying.sourceId || raw.currentNowPlaying.sequenceItemId || ''),
          startedAt: toIsoDate(raw.currentNowPlaying.startedAt),
          durationMs: toNumber(raw.currentNowPlaying.durationMs),
          updatedAt: toIsoDate(raw.currentNowPlaying.updatedAt)
        }
      : null,
    isRecordable: raw.isRecordable === true,
    archiveRequested: raw.archiveRequested === true,
    archiveStatus: String(raw.archiveStatus || 'none'),
    archiveTrackPath: String(raw.archiveTrackPath || ''),
    archiveTrackURL: String(raw.archiveTrackURL || ''),
    moderationStatus: String(raw.moderationStatus || 'clear'),
    reportCount: toNumber(raw.reportCount)
  }
}

export function isLiveStreamFresh(stream = {}) {
  const heartbeat = stream.lastHostHeartbeatAt || stream.startedAt || stream.updatedAt
  const timestamp = heartbeat ? new Date(heartbeat).getTime() : 0
  return Boolean(timestamp) && Number.isFinite(timestamp) && Date.now() - timestamp < LIVE_HEARTBEAT_STALE_MS
}

export function isPublicLiveStreamVisible(stream = {}) {
  const externalEncoderHls = stream.provider === HLS_EDGE_PROVIDER
    && stream.streamingProtocol === HLS_STREAMING_PROTOCOL
    && (stream.ingestMethod === 'obsRtmp' || ['obs-rtmp', 'rtmp-obs', 'rtmp'].includes(stream.ingestMode))
  const hlsVisible = externalEncoderHls && (
    stream.status === 'live'
    || stream.hlsHealth === 'healthy'
    || isRecentHlsHealth(stream)
  )
  return (stream.status === 'live' || hlsVisible)
    && (stream.visibility === 'public' || stream.accessMode === 'password')
    && (externalEncoderHls || stream.hostConnected === true)
    && (externalEncoderHls || isLiveStreamFresh(stream))
    && !['removed', 'blocked'].includes(stream.moderationStatus)
}

export async function listPublicLiveStreams({ category = '', limitCount = 20 } = {}) {
  if (!db) return []
  const constraints = [
    where('status', '==', 'live'),
    where('visibility', '==', 'public')
  ]
  if (category && LIVE_CATEGORIES.includes(category)) constraints.push(where('category', '==', category))
  constraints.push(orderBy('startedAt', 'desc'), limit(Math.max(1, Math.min(30, Number(limitCount) || 20))))

  try {
    const snapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams), ...constraints))
    return snapshot.docs
      .map((docSnap) => normalizeMusicLiveStream(docSnap))
      .filter(isPublicLiveStreamVisible)
  } catch (error) {
    console.warn('[musicLiveService] Public live streams could not be loaded.', error?.message || error)
    return []
  }
}

export function subscribeMusicLiveStream(streamId = '', onNext = () => {}, onError = () => {}) {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return () => {}
  return onSnapshot(
    doc(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id),
    (snapshot) => {
      if (!snapshot.exists()) {
        onNext(null)
        return
      }
      const rawStream = { streamId: snapshot.id, ...(snapshot.data() || {}) }
      console.log('[Live Receiver] raw stream document', rawStream)
      const normalizedStream = normalizeMusicLiveStream(snapshot)
      logMusicLiveReceiverTransport(rawStream, selectPublicPlaybackPlayer(rawStream))
      const route = {
        provider: normalizedStream.provider,
        transportProvider: normalizedStream.transportProvider,
        playbackMode: normalizedStream.playbackMode,
        ingestMethod: normalizedStream.ingestMethod,
        ingestProtocol: normalizedStream.ingestProtocol,
        streamKey: normalizedStream.streamKey,
        hlsPlaybackUrl: normalizedStream.hlsPlaybackUrl,
        selectedPlayer: selectPublicPlaybackPlayer(rawStream)
      }
      console.log('[Live Receiver] selected playback route', route)
      onNext(normalizedStream)
    },
    (error) => {
      console.warn('[musicLiveService] Live stream subscription failed.', error?.message || error)
      onError(error)
    }
  )
}

export function subscribeMusicLiveChat(streamId = '', onNext = () => {}, onError = () => {}) {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return () => {}
  const path = `${FIRESTORE_COLLECTIONS.musicLiveStreams}/${id}/chatMessages`
  console.log('[Live Chat] state', {
    streamId: id,
    chatEnabled: true,
    status: 'subscribing',
    isLive: true,
    path,
    canRead: true,
    canWrite: null,
    error: ''
  })
  const messagesQuery = query(
    collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id, 'chatMessages'),
    where('status', '==', 'visible'),
    orderBy('createdAt', 'desc'),
    limit(80)
  )
  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => {
        const raw = docSnap.data() || {}
        return {
          id: docSnap.id,
          messageId: String(raw.messageId || docSnap.id),
          streamId: String(raw.streamId || id),
          uid: String(raw.uid || ''),
          displayName: String(raw.displayName || 'Melogic Listener'),
          photoURL: String(raw.photoURL || ''),
          text: String(raw.text || ''),
          createdAt: toIsoDate(raw.createdAt),
          status: String(raw.status || 'visible')
        }
      }).reverse()
      console.log('[Live Chat] state', {
        streamId: id,
        chatEnabled: true,
        status: 'subscribed',
        isLive: true,
        path,
        canRead: true,
        canWrite: null,
        error: ''
      })
      onNext(messages)
    },
    (error) => {
      if (error?.code === 'permission-denied') {
        console.info('[musicLiveService] Live chat unavailable for this viewer.')
      } else {
        console.warn('[musicLiveService] Live chat subscription failed.', error?.message || error)
      }
      console.log('[Live Chat] state', {
        streamId: id,
        chatEnabled: true,
        status: 'error',
        isLive: true,
        path,
        canRead: false,
        canWrite: null,
        error: error?.message || String(error)
      })
      onError(error)
    }
  )
}

export function subscribeMusicLiveSequenceItems(streamId = '', onNext = () => {}, onError = () => {}) {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return () => {}
  const itemsQuery = query(
    collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id, 'sequenceItems'),
    orderBy('createdAt', 'asc'),
    limit(100)
  )
  return onSnapshot(
    itemsQuery,
    (snapshot) => onNext(snapshot.docs.map((docSnap) => {
      const raw = docSnap.data() || {}
      return {
        id: docSnap.id,
        itemId: String(raw.itemId || docSnap.id),
        title: String(raw.title || ''),
        artist: String(raw.artist || ''),
        album: String(raw.album || ''),
        artworkURL: String(raw.artworkURL || ''),
        notes: String(raw.notes || ''),
        createdAt: toIsoDate(raw.createdAt),
        updatedAt: toIsoDate(raw.updatedAt)
      }
    })),
    (error) => {
      console.warn('[musicLiveService] Live sequence subscription failed.', error?.message || error)
      onError(error)
    }
  )
}

export async function getMusicLiveStream(streamId = '') {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return null
  try {
    const snapshot = await getDoc(doc(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id))
    if (!snapshot.exists()) return null
    const rawStream = { streamId: snapshot.id, ...(snapshot.data() || {}) }
    console.log('[Live Receiver] raw stream document', rawStream)
    const normalizedStream = normalizeMusicLiveStream(snapshot)
    logMusicLiveReceiverTransport(rawStream, selectPublicPlaybackPlayer(rawStream))
    const route = {
      provider: normalizedStream.provider,
      transportProvider: normalizedStream.transportProvider,
      playbackMode: normalizedStream.playbackMode,
      ingestMethod: normalizedStream.ingestMethod,
      ingestProtocol: normalizedStream.ingestProtocol,
      streamKey: normalizedStream.streamKey,
      hlsPlaybackUrl: normalizedStream.hlsPlaybackUrl,
      selectedPlayer: selectPublicPlaybackPlayer(rawStream)
    }
    console.log('[Live Receiver] selected playback route', route)
    return normalizedStream
  } catch (error) {
    console.warn('[musicLiveService] Live stream could not be loaded.', error?.message || error)
    return null
  }
}

export async function listHostMusicLiveStreams(uid = '', { limitCount = 20 } = {}) {
  const hostUid = String(uid || '').trim()
  if (!db || !hostUid) return []
  try {
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams),
      where('hostUid', '==', hostUid),
      limit(Math.max(1, Math.min(30, Number(limitCount) || 20)))
    ))
    return snapshot.docs
      .map((docSnap) => normalizeMusicLiveStream(docSnap))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
  } catch (error) {
    console.warn('[musicLiveService] Host live streams could not be loaded.', error?.message || error)
    return []
  }
}

export async function startMusicLiveStream(payload = {}) {
  const callable = httpsCallable(functions, 'startMusicLiveStream')
  const result = await callable(liveWriterPayload(payload))
  return result?.data || { ok: false }
}

export async function prepareMusicLiveStreamDraft(payload = {}) {
  const callable = httpsCallable(functions, 'prepareMusicLiveStreamDraft')
  const result = await callable(liveWriterPayload(payload))
  return result?.data || { ok: false }
}

export async function markMusicLiveStreamOnAir(streamId = '', options = {}) {
  const callable = httpsCallable(functions, 'markMusicLiveStreamOnAir')
  const result = await callable(liveWriterPayload({ streamId, ...options }))
  return result?.data || { ok: false }
}

export async function heartbeatMusicLiveStream(streamId = '', options = {}) {
  const callable = httpsCallable(functions, 'heartbeatMusicLiveStream')
  const result = await callable(liveWriterPayload({ streamId, ...options }))
  return result?.data || { ok: false }
}

export async function updateMusicLiveStreamInfo(payload = {}) {
  const callable = httpsCallable(functions, 'updateMusicLiveStreamInfo')
  const result = await callable(liveWriterPayload(payload))
  return result?.data || { ok: false }
}

export async function joinMusicLiveStream(streamId = '', options = {}) {
  const callable = httpsCallable(functions, 'joinMusicLiveStream')
  const result = await callable({ streamId, ...options })
  return result?.data || { ok: false }
}

export async function endMusicLiveStream(streamId = '') {
  const callable = httpsCallable(functions, 'endMusicLiveStream')
  const result = await callable({ streamId })
  return result?.data || { ok: false }
}

export async function sendMusicLiveChatMessage(streamId = '', text = '') {
  const callable = httpsCallable(functions, 'sendMusicLiveChatMessage')
  const result = await callable({ streamId, text })
  return result?.data || { ok: false }
}

export async function updateMusicLiveListenerPresence(streamId = '', presenceId = '') {
  const callable = httpsCallable(functions, 'updateMusicLiveListenerPresence')
  const result = await callable({ streamId, presenceId })
  return result?.data || { ok: false }
}

export async function leaveMusicLiveStream(streamId = '', presenceId = '') {
  const callable = httpsCallable(functions, 'leaveMusicLiveStream')
  const result = await callable({ streamId, presenceId })
  return result?.data || { ok: false }
}

export async function getMusicLiveViewerState(streamId = '') {
  const callable = httpsCallable(functions, 'getMusicLiveViewerState')
  const result = await callable({ streamId })
  return result?.data || { ok: false, reaction: 'none', saved: false }
}

export async function toggleMusicLiveReaction(streamId = '', reaction = 'none') {
  const callable = httpsCallable(functions, 'toggleMusicLiveReaction')
  const result = await callable({ streamId, reaction })
  return result?.data || { ok: false }
}

export async function toggleSaveMusicLiveStream(streamId = '', saved = true) {
  const callable = httpsCallable(functions, 'toggleSaveMusicLiveStream')
  const result = await callable({ streamId, saved })
  return result?.data || { ok: false }
}

export async function upsertMusicLiveSequenceItem(payload = {}) {
  const callable = httpsCallable(functions, 'upsertMusicLiveSequenceItem')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function deleteMusicLiveSequenceItem(streamId = '', itemId = '') {
  const callable = httpsCallable(functions, 'deleteMusicLiveSequenceItem')
  const result = await callable({ streamId, itemId })
  return result?.data || { ok: false }
}

export async function setMusicLiveNowPlaying(streamId = '', itemId = '') {
  const callable = httpsCallable(functions, 'setMusicLiveNowPlaying')
  const result = await callable({ streamId, itemId })
  return result?.data || { ok: false }
}

export function sendMusicLiveUnloadBeacon({ streamId = '', idToken = '', reason = 'host_unload' } = {}) {
  const cleanStreamId = String(streamId || '').trim()
  if (!cleanStreamId || !idToken) return false
  const payload = JSON.stringify({ streamId: cleanStreamId, idToken, reason })
  const url = 'https://us-central1-melogic-records.cloudfunctions.net/endMusicLiveStreamBeacon'
  if (navigator.sendBeacon) {
    return navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
  }
  fetch(url, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    keepalive: true
  }).catch(() => {})
  return true
}
