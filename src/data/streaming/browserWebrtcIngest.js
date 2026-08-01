import { buildHlsPlaybackUrl as buildEdgePlaybackUrl, sanitizeHlsStreamKey } from './hlsEdgePlayer'

const DEFAULT_BROWSER_WHIP_INGEST_URL = 'https://ingest.melogicrecords.studio/mtx/ingest/{streamKey}/whip'
const CONNECTION_TIMEOUT_MS = 15000
const FETCH_TIMEOUT_MS = 15000
const CONNECTION_FAILURE_GRACE_MS = 30000
const OUTBOUND_STATS_INTERVAL_MS = 5000
const OUTBOUND_STALL_SAMPLE_LIMIT = 3
const MUSIC_AUDIO_MAX_BITRATE = 256000
const PROGRAM_VIDEO_KEYFRAME_INTERVAL_MS = 2000
// 1080p30 browser publishing is intentionally bounded to the same practical
// range used by major broadcast services. WebRTC congestion control still has
// final authority; these values are preferences, not a promise of bandwidth.
const PROGRAM_VIDEO_MAX_BITRATE = 12000000
const PROGRAM_VIDEO_MAX_FRAMERATE = 30
const MIN_PROGRAM_VIDEO_BITRATE = 1000000
const MAX_PROGRAM_VIDEO_BITRATE = 20000000
const MAX_PROGRAM_VIDEO_FRAMERATE = 60
const DEGRADATION_PREFERENCES = new Set(['maintain-resolution', 'balanced', 'maintain-framerate'])

let activeSession = null

function clampNumber(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback
}

function normalizeEncoderSettings(settings = {}, mediaStream = null) {
  const videoTrack = mediaStream?.getVideoTracks?.()[0] || null
  const trackSettings = videoTrack?.getSettings?.() || {}
  const width = Math.round(clampNumber(settings.width || trackSettings.width, 320, 3840, 1920))
  const height = Math.round(clampNumber(settings.height || trackSettings.height, 180, 2160, 1080))
  const maxBitrate = Math.round(clampNumber(settings.videoBitrate, MIN_PROGRAM_VIDEO_BITRATE, MAX_PROGRAM_VIDEO_BITRATE, PROGRAM_VIDEO_MAX_BITRATE))
  const maxFramerate = clampNumber(settings.framerate || trackSettings.frameRate, 1, MAX_PROGRAM_VIDEO_FRAMERATE, PROGRAM_VIDEO_MAX_FRAMERATE)
  const degradationPreference = DEGRADATION_PREFERENCES.has(settings.degradationPreference)
    ? settings.degradationPreference
    : 'maintain-resolution'
  return {
    width,
    height,
    maxBitrate,
    maxFramerate,
    startBitrate: Math.round(clampNumber(settings.startBitrate, MIN_PROGRAM_VIDEO_BITRATE, maxBitrate, Math.min(maxBitrate, maxBitrate * 0.72))),
    minBitrate: Math.round(clampNumber(settings.minBitrate, 500000, maxBitrate, Math.min(maxBitrate, Math.max(1500000, maxBitrate * 0.38)))),
    keyFrameIntervalMs: Math.round(clampNumber(settings.keyFrameIntervalMs, 1000, 5000, PROGRAM_VIDEO_KEYFRAME_INTERVAL_MS)),
    degradationPreference,
    autoAdjustOutput: settings.autoAdjustOutput !== false
  }
}

export async function probeBrowserEncodingCapabilities(settings = {}) {
  const normalized = normalizeEncoderSettings(settings)
  const result = {
    checked: true,
    webCodecsAvailable: typeof VideoEncoder === 'function',
    webCodecsH264Supported: null,
    webCodecsHardwarePreferenceSupported: null,
    mediaCapabilitiesAvailable: Boolean(navigator.mediaCapabilities?.encodingInfo),
    webrtcEncodingSupported: null,
    webrtcEncodingSmooth: null,
    webrtcEncodingPowerEfficient: null,
    requestedWidth: normalized.width,
    requestedHeight: normalized.height,
    requestedFramerate: normalized.maxFramerate,
    requestedBitrate: normalized.maxBitrate
  }

  if (result.webCodecsAvailable && typeof VideoEncoder.isConfigSupported === 'function') {
    try {
      const support = await VideoEncoder.isConfigSupported({
        // Constrained Baseline, level 4.2 covers the selectable 1080p60 ceiling.
        // A level 3.1 probe would incorrectly reject some valid hardware paths.
        codec: 'avc1.42e02a',
        width: normalized.width,
        height: normalized.height,
        bitrate: normalized.maxBitrate,
        framerate: normalized.maxFramerate,
        hardwareAcceleration: 'prefer-hardware',
        latencyMode: 'realtime'
      })
      result.webCodecsH264Supported = support.supported === true
      result.webCodecsHardwarePreferenceSupported = support.supported === true
    } catch {
      result.webCodecsH264Supported = false
      result.webCodecsHardwarePreferenceSupported = false
    }
  }

  if (result.mediaCapabilitiesAvailable) {
    try {
      const support = await navigator.mediaCapabilities.encodingInfo({
        type: 'webrtc',
        video: {
          contentType: 'video/H264;level-asymmetry-allowed=1;packetization-mode=1;profile-level-id=42e02a',
          width: normalized.width,
          height: normalized.height,
          bitrate: normalized.maxBitrate,
          framerate: normalized.maxFramerate
        }
      })
      result.webrtcEncodingSupported = support.supported === true
      result.webrtcEncodingSmooth = support.smooth === true
      result.webrtcEncodingPowerEfficient = support.powerEfficient === true
    } catch {
      result.webrtcEncodingSupported = null
    }
  }
  return result
}

function configuredEndpoint() {
  return String(import.meta.env?.VITE_BROWSER_WEBRTC_INGEST_URL || DEFAULT_BROWSER_WHIP_INGEST_URL).trim()
}

function stripEndpointSecrets(value = '') {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const [name] of url.searchParams) {
      if (/(token|secret|signature|authorization|auth|key)/i.test(name)) url.searchParams.set(name, '[redacted]')
    }
    return url.toString()
  } catch {
    return ''
  }
}

function connectionDiagnostics(peerConnection, mediaStream, extra = {}, settings = {}) {
  const audioTrack = mediaStream?.getAudioTracks?.()[0] || null
  const videoTrack = mediaStream?.getVideoTracks?.()[0] || null
  const encoderSettings = normalizeEncoderSettings(settings, mediaStream)
  const programTrackCount = mediaStream?.getTracks?.().length || 0
  const audioTrackCount = mediaStream?.getAudioTracks?.().length || 0
  const videoTrackCount = mediaStream?.getVideoTracks?.().length || 0
  return {
    peerConnectionState: peerConnection?.connectionState || 'closed',
    iceConnectionState: peerConnection?.iceConnectionState || 'closed',
    iceGatheringState: peerConnection?.iceGatheringState || 'complete',
    signalingState: peerConnection?.signalingState || 'closed',
    programTrackCount,
    mediaStreamTrackCount: programTrackCount,
    audioTrackCount,
    videoTrackCount,
    audioTrackReadyState: audioTrack?.readyState || 'none',
    videoTrackReadyState: videoTrack?.readyState || 'none',
    audioTrackSettings: audioTrack?.getSettings?.() || {},
    audioTrackConstraints: audioTrack?.getConstraints?.() || {},
    videoContentHint: videoTrack?.contentHint || '',
    audioTargetBitrate: MUSIC_AUDIO_MAX_BITRATE,
    videoTargetBitrate: videoTrack ? encoderSettings.maxBitrate : 0,
    videoTargetFramerate: videoTrack ? encoderSettings.maxFramerate : 0,
    videoTargetWidth: videoTrack ? encoderSettings.width : 0,
    videoTargetHeight: videoTrack ? encoderSettings.height : 0,
    videoDegradationPreference: encoderSettings.degradationPreference,
    videoTrackSettings: videoTrack?.getSettings?.() || {},
    ...extra
  }
}

function waitForIceGathering(peerConnection) {
  if (peerConnection.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 8000)
    function done() {
      window.clearTimeout(timeout)
      peerConnection.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    function onChange() {
      if (peerConnection.iceGatheringState === 'complete') done()
    }
    peerConnection.addEventListener('icegatheringstatechange', onChange)
  })
}

function whipTransportReady(peerConnection) {
  return peerConnection.connectionState === 'connected'
    || ['checking', 'connected', 'completed'].includes(peerConnection.iceConnectionState)
}

function waitForConnection(peerConnection, mediaStream, emitStatus) {
  if (whipTransportReady(peerConnection)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Browser WebRTC ingest connection timed out.')), CONNECTION_TIMEOUT_MS)
    function finish(error) {
      window.clearTimeout(timeout)
      peerConnection.removeEventListener('connectionstatechange', onChange)
      peerConnection.removeEventListener('iceconnectionstatechange', onChange)
      if (error) reject(error)
      else resolve()
    }
    function onChange() {
      emitStatus(peerConnection.connectionState)
      if (whipTransportReady(peerConnection)) finish()
      else if (['failed', 'closed'].includes(peerConnection.connectionState) || peerConnection.iceConnectionState === 'failed') {
        finish(new Error(`Browser WebRTC ingest connection ${peerConnection.connectionState}.`))
      }
    }
    peerConnection.addEventListener('connectionstatechange', onChange)
    peerConnection.addEventListener('iceconnectionstatechange', onChange)
  })
}

async function applyMusicAudioSenderParameters(peerConnection, mediaStream, phase = 'after-add-track') {
  const audioTrack = mediaStream?.getAudioTracks?.()[0] || null
  const audioSender = peerConnection?.getSenders?.().find((sender) => sender.track?.kind === 'audio') || null
  if (!audioTrack || !audioSender?.getParameters) return false
  let applied = false
  let errorMessage = ''
  try {
    const params = audioSender.getParameters() || {}
    params.encodings = params.encodings?.length ? params.encodings : [{}]
    params.encodings[0] = {
      ...(params.encodings[0] || {}),
      maxBitrate: MUSIC_AUDIO_MAX_BITRATE
    }
    if (audioSender.setParameters) {
      await audioSender.setParameters(params)
      applied = true
    }
  } catch (error) {
    errorMessage = error?.message || String(error)
    console.warn('[Browser WHIP] audio sender parameter update failed', { phase, error: errorMessage })
  }
  console.log('[Browser WHIP] audio sender parameters', {
    phase,
    applied,
    targetMaxBitrate: MUSIC_AUDIO_MAX_BITRATE,
    trackId: audioTrack.id,
    trackLabel: audioTrack.label,
    settings: audioTrack.getSettings?.(),
    constraints: audioTrack.getConstraints?.(),
    params: audioSender.getParameters?.(),
    error: errorMessage
  })
  return applied
}

function preferH264VideoCodec(peerConnection) {
  const transceiver = peerConnection?.getTransceivers?.().find((entry) => entry.sender?.track?.kind === 'video') || null
  const capabilities = typeof RTCRtpSender !== 'undefined' ? RTCRtpSender.getCapabilities?.('video') : null
  if (!transceiver?.setCodecPreferences || !Array.isArray(capabilities?.codecs)) return false
  const profileScore = (codec) => {
    const profile = String(codec?.sdpFmtpLine || '').match(/profile-level-id=([0-9a-f]{6})/i)?.[1]?.toLowerCase() || ''
    // Constrained Baseline is the common browser hardware path and the most
    // dependable profile for a WebRTC -> RTSP -> HLS bridge. High/Main can
    // push some browsers onto a software encoder without improving a screen
    // share once WebRTC congestion control is involved.
    if (profile.startsWith('42e0')) return 4
    if (profile.startsWith('42')) return 3
    if (profile.startsWith('4d')) return 2
    if (profile.startsWith('64')) return 1
    return 0
  }
  const h264 = capabilities.codecs
    .filter((codec) => /video\/h264/i.test(codec.mimeType || ''))
    .sort((left, right) => profileScore(right) - profileScore(left))
  if (!h264.length) return false
  try {
    transceiver.setCodecPreferences([...h264, ...capabilities.codecs.filter((codec) => !/video\/h264/i.test(codec.mimeType || ''))])
    return true
  } catch (error) {
    console.warn('[Browser WHIP] H.264 preference could not be applied', error)
    return false
  }
}

async function applyProgramVideoSenderParameters(peerConnection, mediaStream, phase = 'after-add-track', settings = {}) {
  const videoTrack = mediaStream?.getVideoTracks?.()[0] || null
  const videoSender = peerConnection?.getSenders?.().find((sender) => sender.track?.kind === 'video') || null
  if (!videoTrack || !videoSender?.getParameters) return false
  const encoderSettings = normalizeEncoderSettings(settings, mediaStream)
  let applied = false
  let errorMessage = ''
  try {
    if ('contentHint' in videoTrack) videoTrack.contentHint = 'detail'
    const params = videoSender.getParameters() || {}
    params.encodings = params.encodings?.length ? params.encodings : [{}]
    params.encodings[0] = {
      ...(params.encodings[0] || {}),
      maxBitrate: encoderSettings.maxBitrate,
      maxFramerate: encoderSettings.maxFramerate,
      scaleResolutionDownBy: 1
    }
    // The HLS buffer can absorb a lower instantaneous frame rate, but it
    // cannot restore detail after WebRTC has reduced a 1080p screen share to
    // 360p. Preserve source resolution and let the browser drop frames first.
    params.degradationPreference = encoderSettings.degradationPreference
    if (videoSender.setParameters) {
      await videoSender.setParameters(params)
      applied = true
    }
  } catch (error) {
    errorMessage = error?.message || String(error)
    console.warn('[Browser WHIP] video sender parameter update failed', { phase, error: errorMessage })
  }
  console.log('[Browser WHIP] video sender parameters', {
    phase,
    applied,
    targetMaxBitrate: encoderSettings.maxBitrate,
    targetMaxFramerate: encoderSettings.maxFramerate,
    targetWidth: encoderSettings.width,
    targetHeight: encoderSettings.height,
    degradationPreference: encoderSettings.degradationPreference,
    trackId: videoTrack.id,
    settings: videoTrack.getSettings?.(),
    params: videoSender.getParameters?.(),
    error: errorMessage
  })
  return applied
}

function startPeriodicVideoKeyFrames(session) {
  const videoSender = session?.peerConnection?.getSenders?.().find((sender) => sender.track?.kind === 'video') || null
  if (!videoSender) return
  const keyFrameIntervalMs = session.encoderSettings?.keyFrameIntervalMs || PROGRAM_VIDEO_KEYFRAME_INTERVAL_MS

  // Safari and Firefox expose key-frame generation through an encoded
  // transform worker. The worker is a transparent pass-through; its only job
  // is to ask the browser encoder for an IDR frame every two seconds.
  if (typeof Worker === 'function' && typeof RTCRtpScriptTransform === 'function' && 'transform' in videoSender) {
    try {
      session.keyFrameWorker = new Worker('/workers/streamKeyframeWorker.js')
      videoSender.transform = new RTCRtpScriptTransform(session.keyFrameWorker, {
        keyFrameIntervalMs
      })
      session.periodicKeyFrameTransform = true
      session.periodicKeyFrameRequestSupported = true
    } catch (error) {
      session.keyFrameWorker?.terminate?.()
      session.keyFrameWorker = null
      console.warn('[Browser WHIP] encoded key-frame transform unavailable', error)
    }
  }

  // RTCRtpSender.setParameters() accepts a single parameters object. Passing
  // a second, non-standard key-frame options argument was ignored by some
  // engines and destabilized others. Encoded Transform is the standards-based
  // request path; browsers without it rely on normal RTCP/key-frame cadence.
}

function stopPeriodicVideoKeyFrames(session) {
  if (!session) return
  if (session.keyFrameTimer) window.clearInterval(session.keyFrameTimer)
  session.keyFrameTimer = 0
  session.keyFrameWorker?.terminate?.()
  session.keyFrameWorker = null
}

function adaptiveVideoTierSettings(session, tier = 0) {
  const requested = session.encoderSettings || normalizeEncoderSettings({}, session.mediaStream)
  const normalizedTier = Math.max(0, Math.min(3, Number(tier || 0)))
  const tiers = [
    { bitrateFactor: 1, frameRate: requested.maxFramerate, scale: 1 },
    { bitrateFactor: 0.78, frameRate: Math.min(requested.maxFramerate, 30), scale: 1 },
    { bitrateFactor: 0.58, frameRate: Math.min(requested.maxFramerate, 24), scale: 1.25 },
    { bitrateFactor: 0.42, frameRate: Math.min(requested.maxFramerate, 20), scale: 1.5 }
  ]
  const selected = tiers[normalizedTier]
  return {
    tier: normalizedTier,
    maxBitrate: Math.max(MIN_PROGRAM_VIDEO_BITRATE, Math.round(requested.maxBitrate * selected.bitrateFactor)),
    maxFramerate: selected.frameRate,
    scaleResolutionDownBy: selected.scale
  }
}

async function applyAdaptiveVideoTier(session, requestedTier, reason = '') {
  if (!session?.encoderSettings?.autoAdjustOutput || session.stopped) return false
  const next = adaptiveVideoTierSettings(session, requestedTier)
  if (next.tier === Number(session.adaptiveVideoTier || 0)) return false
  const sender = session.peerConnection?.getSenders?.().find((entry) => entry.track?.kind === 'video') || null
  if (!sender?.getParameters || !sender?.setParameters) return false
  try {
    const params = sender.getParameters() || {}
    params.encodings = params.encodings?.length ? params.encodings : [{}]
    params.encodings[0] = {
      ...(params.encodings[0] || {}),
      maxBitrate: next.maxBitrate,
      maxFramerate: next.maxFramerate,
      scaleResolutionDownBy: next.scaleResolutionDownBy
    }
    params.degradationPreference = next.tier >= 2 ? 'balanced' : session.encoderSettings.degradationPreference
    await sender.setParameters(params)
    session.adaptiveVideoTier = next.tier
    session.adaptiveLastChangedAt = Date.now()
    session.adaptiveConstrainedSamples = 0
    session.adaptiveHealthySamples = 0
    session.adaptiveReason = reason
    console.info('[Browser WHIP] adaptive video tier changed', { ...next, reason })
    return true
  } catch (error) {
    console.warn('[Browser WHIP] adaptive video tier update failed', error)
    return false
  }
}

function applyProgramVideoSdp(sdp = '', settings = {}) {
  const text = String(sdp || '')
  if (!text.includes('m=video')) return text
  const encoderSettings = normalizeEncoderSettings(settings)
  const lineBreak = text.includes('\r\n') ? '\r\n' : '\n'
  const sections = text.split(`${lineBreak}m=`)
  const videoIndex = sections.findIndex((section, index) => index > 0 && section.startsWith('video '))
  if (videoIndex < 0) return text

  let videoSection = `m=${sections[videoIndex]}`
  videoSection = videoSection
    .replace(new RegExp(`^b=AS:\\d+${lineBreak}`, 'gm'), '')
    .replace(new RegExp(`^b=TIAS:\\d+${lineBreak}`, 'gm'), '')

  const bandwidthLines = `b=AS:${Math.round(encoderSettings.maxBitrate / 1000)}${lineBreak}b=TIAS:${encoderSettings.maxBitrate}`
  if (/^c=/m.test(videoSection)) {
    videoSection = videoSection.replace(/^c=.*$/m, (line) => `${line}${lineBreak}${bandwidthLines}`)
  }

  const h264PayloadTypes = Array.from(videoSection.matchAll(/^a=rtpmap:(\d+)\s+H264\/90000\s*$/gmi))
    .map((match) => match[1])
  h264PayloadTypes.forEach((payloadType) => {
    const fmtpPattern = new RegExp(`^a=fmtp:${payloadType}\\s+(.+)$`, 'mi')
    const fmtpMatch = videoSection.match(fmtpPattern)
    const bitrateParameters = {
      'x-google-start-bitrate': String(Math.round(encoderSettings.startBitrate / 1000)),
      'x-google-min-bitrate': String(Math.round(encoderSettings.minBitrate / 1000)),
      'x-google-max-bitrate': String(Math.round(encoderSettings.maxBitrate / 1000))
    }
    if (!fmtpMatch) {
      const rtpmapPattern = new RegExp(`^a=rtpmap:${payloadType}.*$`, 'mi')
      videoSection = videoSection.replace(rtpmapPattern, (line) => `${line}${lineBreak}a=fmtp:${payloadType} ${Object.entries(bitrateParameters).map(([key, value]) => `${key}=${value}`).join(';')}`)
      return
    }
    const parameters = new Map(
      fmtpMatch[1]
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => {
          const [key, ...rest] = entry.split('=')
          return [key, rest.join('=')]
        })
    )
    Object.entries(bitrateParameters).forEach(([key, value]) => parameters.set(key, value))
    videoSection = videoSection.replace(
      fmtpPattern,
      `a=fmtp:${payloadType} ${Array.from(parameters.entries()).map(([key, value]) => value ? `${key}=${value}` : key).join(';')}`
    )
  })

  sections[videoIndex] = videoSection.replace(/^m=/, '')
  return sections.join(`${lineBreak}m=`)
}

async function collectOutboundQualityStats(session) {
  const peerConnection = session?.peerConnection
  if (!peerConnection?.getStats || session?.stopped) return
  try {
    const stats = await peerConnection.getStats()
    const reports = Array.from(stats.values())
    const video = reports.find((report) => report.type === 'outbound-rtp' && !report.isRemote && (report.kind === 'video' || report.mediaType === 'video'))
    const audio = reports.find((report) => report.type === 'outbound-rtp' && !report.isRemote && (report.kind === 'audio' || report.mediaType === 'audio'))
    const transport = reports.find((report) => report.type === 'transport' && (
      report.id === video?.transportId || report.id === audio?.transportId
    )) || reports.find((report) => report.type === 'transport')
    const candidatePair = reports.find((report) => report.id === transport?.selectedCandidatePairId)
      || reports.find((report) => report.type === 'candidate-pair' && report.selected === true)
      || reports.find((report) => report.type === 'candidate-pair' && report.nominated === true && report.state === 'succeeded')
    const localCandidate = reports.find((report) => report.id === candidatePair?.localCandidateId)
    const remoteCandidate = reports.find((report) => report.id === candidatePair?.remoteCandidateId)
    const remoteVideo = reports.find((report) => report.type === 'remote-inbound-rtp' && (
      report.localId === video?.id || report.kind === 'video' || report.mediaType === 'video'
    ))
    const remoteAudio = reports.find((report) => report.type === 'remote-inbound-rtp' && (
      report.localId === audio?.id || report.kind === 'audio' || report.mediaType === 'audio'
    ))
    const now = performance.now()
    const previous = session.lastOutboundStats || {}
    const elapsedMs = Math.max(1, now - Number(previous.at || now))
    const toKbps = (bytes, previousBytes) => previousBytes == null ? null : Math.round(Math.max(0, Number(bytes || 0) - Number(previousBytes || 0)) * 8 / elapsedMs)
    const videoBitrateKbps = video ? toKbps(video.bytesSent, previous.videoBytes) : null
    const audioBitrateKbps = audio ? toKbps(audio.bytesSent, previous.audioBytes) : null
    const framesPerSecond = video && previous.videoFrames != null
      ? Number(((Math.max(0, Number(video.framesEncoded || 0) - Number(previous.videoFrames || 0)) * 1000) / elapsedMs).toFixed(1))
      : Number(video?.framesPerSecond || 0) || null
    const hasPreviousSample = previous.at != null
    const audioTrackLive = session.mediaStream?.getAudioTracks?.().some((track) => track.readyState === 'live') === true
    const videoTrackLive = session.mediaStream?.getVideoTracks?.().some((track) => track.readyState === 'live') === true
    const audioAdvanced = audio && previous.audioBytes != null && Number(audio.bytesSent || 0) > Number(previous.audioBytes || 0)
    const videoAdvanced = video && previous.videoBytes != null && Number(video.bytesSent || 0) > Number(previous.videoBytes || 0)
    const outboundAdvanced = Boolean(audioAdvanced || videoAdvanced)
    if (!hasPreviousSample || outboundAdvanced || (!audioTrackLive && !videoTrackLive)) {
      session.outboundStallSamples = 0
      if (outboundAdvanced || !hasPreviousSample) session.lastOutboundProgressAt = Date.now()
    } else {
      session.outboundStallSamples = Number(session.outboundStallSamples || 0) + 1
    }
    session.audioStallSamples = !hasPreviousSample || !audioTrackLive || audioAdvanced
      ? 0
      : Number(session.audioStallSamples || 0) + 1
    session.videoStallSamples = !hasPreviousSample || !videoTrackLive || videoAdvanced
      ? 0
      : Number(session.videoStallSamples || 0) + 1
    const selectedProtocol = String(localCandidate?.protocol || remoteCandidate?.protocol || '').toLowerCase()
    const availableOutgoingBitrateKbps = Number.isFinite(Number(candidatePair?.availableOutgoingBitrate))
      ? Math.round(Number(candidatePair.availableOutgoingBitrate) / 1000)
      : null
    const videoWidth = Number(video?.frameWidth || 0) || null
    const videoHeight = Number(video?.frameHeight || 0) || null
    const qualityLimitationReason = String(video?.qualityLimitationReason || 'none').toLowerCase()
    const encoderSettings = session.encoderSettings || normalizeEncoderSettings({}, session.mediaStream)
    const currentAdaptive = adaptiveVideoTierSettings(session, session.adaptiveVideoTier || 0)
    const resolutionReduced = Boolean(videoWidth && videoHeight && (
      videoWidth < encoderSettings.width * 0.84 || videoHeight < encoderSettings.height * 0.84
    ))
    const frameRateReduced = Number.isFinite(framesPerSecond) && framesPerSecond < Math.min(20, encoderSettings.maxFramerate * 0.66)
    const bandwidthEstimateLow = availableOutgoingBitrateKbps != null
      && availableOutgoingBitrateKbps < (currentAdaptive.maxBitrate / 1000) * 0.82
    const bandwidthConstrained = qualityLimitationReason === 'bandwidth'
      || bandwidthEstimateLow
    const cpuConstrained = qualityLimitationReason === 'cpu'
    const transportLoss = Number(remoteVideo?.packetsLost || 0) + Number(remoteAudio?.packetsLost || 0)
    const previousTransportLoss = Number(previous.remotePacketsLost || 0)
    const newlyLostPackets = hasPreviousSample ? Math.max(0, transportLoss - previousTransportLoss) : 0
    const transportConstrained = newlyLostPackets >= 8
    const severeTransportLoss = newlyLostPackets >= 50
    const adaptationConstrained = bandwidthConstrained || cpuConstrained || transportConstrained
    if (encoderSettings.autoAdjustOutput && videoTrackLive && hasPreviousSample) {
      if (adaptationConstrained) {
        session.adaptiveConstrainedSamples = Number(session.adaptiveConstrainedSamples || 0) + 1
        session.adaptiveHealthySamples = 0
      } else if (videoAdvanced && Number(framesPerSecond || 0) >= Math.min(18, currentAdaptive.maxFramerate * 0.72)) {
        session.adaptiveHealthySamples = Number(session.adaptiveHealthySamples || 0) + 1
        session.adaptiveConstrainedSamples = 0
      }
      const sinceChange = Date.now() - Number(session.adaptiveLastChangedAt || 0)
      if ((severeTransportLoss || session.adaptiveConstrainedSamples >= 2) && sinceChange >= 10000) {
        void applyAdaptiveVideoTier(session, Math.min(3, Number(session.adaptiveVideoTier || 0) + 1),
          cpuConstrained ? 'cpu' : transportConstrained ? 'packet-loss' : 'bandwidth')
      } else if (session.adaptiveHealthySamples >= 12 && sinceChange >= 60000) {
        void applyAdaptiveVideoTier(session, Math.max(0, Number(session.adaptiveVideoTier || 0) - 1), 'sustained-recovery')
      }
    }
    const outboundQualityWarning = bandwidthConstrained
      ? `Available upload bandwidth is constraining the ${encoderSettings.height}p program. Close other uploads or use Ethernet; Melogic will preserve resolution where possible.`
      : cpuConstrained
        ? 'Browser encoding load is high. Close other intensive tabs or use an external encoder for more headroom.'
        : ''
    const diagnostics = {
      outboundVideoBitrateKbps: videoBitrateKbps,
      outboundAudioBitrateKbps: audioBitrateKbps,
      outboundVideoFramesPerSecond: framesPerSecond,
      outboundVideoWidth: videoWidth,
      outboundVideoHeight: videoHeight,
      outboundVideoQualityLimitation: qualityLimitationReason,
      outboundBandwidthEstimateLow: bandwidthEstimateLow,
      outboundEncoderImplementation: String(video?.encoderImplementation || ''),
      outboundPowerEfficientEncoder: typeof video?.powerEfficientEncoder === 'boolean' ? video.powerEfficientEncoder : null,
      outboundVideoNackCount: Number(video?.nackCount || 0),
      outboundVideoPliCount: Number(video?.pliCount || 0),
      outboundVideoKeyFramesEncoded: Number(video?.keyFramesEncoded || 0),
      periodicKeyFrameTransform: session.periodicKeyFrameTransform === true,
      periodicKeyFrameRequestSupported: session.periodicKeyFrameRequestSupported,
      periodicKeyFrameRequests: Number(session.periodicKeyFrameRequests || 0),
      remotePacketsLost: transportLoss,
      outboundNewPacketsLost: newlyLostPackets,
      outboundSeverePacketLoss: severeTransportLoss,
      remoteRoundTripTimeMs: Number.isFinite(Number(remoteVideo?.roundTripTime))
        ? Math.round(Number(remoteVideo.roundTripTime) * 1000)
        : null,
      selectedCandidateProtocol: selectedProtocol || 'unknown',
      selectedCandidatePairState: String(candidatePair?.state || ''),
      selectedLocalCandidateType: String(localCandidate?.candidateType || ''),
      selectedRemoteCandidateType: String(remoteCandidate?.candidateType || ''),
      selectedRemoteAddress: String(remoteCandidate?.address || remoteCandidate?.ip || ''),
      selectedRemotePort: Number(remoteCandidate?.port || 0) || null,
      availableOutgoingBitrateKbps,
      candidatePairCurrentRoundTripTimeMs: Number.isFinite(Number(candidatePair?.currentRoundTripTime))
        ? Math.round(Number(candidatePair.currentRoundTripTime) * 1000)
        : null,
      outboundStallSamples: session.outboundStallSamples,
      outboundAudioStallSamples: session.audioStallSamples,
      outboundVideoStallSamples: session.videoStallSamples,
      adaptiveOutputEnabled: encoderSettings.autoAdjustOutput,
      adaptiveVideoTier: Number(session.adaptiveVideoTier || 0),
      adaptiveVideoBitrate: currentAdaptive.maxBitrate,
      adaptiveVideoFramerate: currentAdaptive.maxFramerate,
      adaptiveScaleResolutionDownBy: currentAdaptive.scaleResolutionDownBy,
      adaptiveReason: session.adaptiveReason || '',
      outboundLastProgressAt: session.lastOutboundProgressAt ? new Date(session.lastOutboundProgressAt).toISOString() : '',
      outboundQualityWarning
    }
    session.lastOutboundStats = {
      at: now,
      videoBytes: video?.bytesSent,
      audioBytes: audio?.bytesSent,
      videoFrames: video?.framesEncoded,
      remotePacketsLost: transportLoss
    }
    session.emitStatus?.('connected', diagnostics)
    const requiredTrackStalled = (audioTrackLive && session.audioStallSamples >= OUTBOUND_STALL_SAMPLE_LIMIT)
      || (videoTrackLive && session.videoStallSamples >= OUTBOUND_STALL_SAMPLE_LIMIT)
    if (session.outboundStallSamples >= OUTBOUND_STALL_SAMPLE_LIMIT || requiredTrackStalled) {
      const stalledTrack = videoTrackLive && session.videoStallSamples >= OUTBOUND_STALL_SAMPLE_LIMIT ? 'video' : audioTrackLive && session.audioStallSamples >= OUTBOUND_STALL_SAMPLE_LIMIT ? 'audio' : 'media'
      const error = new Error(`Browser encoder stopped sending ${stalledTrack} while WebRTC still appeared connected.`)
      session.reportFailure?.(error, {
        ...diagnostics,
        outboundMediaStalled: true,
        outboundStallThresholdMs: OUTBOUND_STATS_INTERVAL_MS * OUTBOUND_STALL_SAMPLE_LIMIT
      })
    }
  } catch (error) {
    console.warn('[Browser WHIP] outbound quality stats unavailable', error)
  }
}

function startOutboundQualityMonitor(session) {
  if (session.qualityTimer) window.clearInterval(session.qualityTimer)
  void collectOutboundQualityStats(session)
  session.qualityTimer = window.setInterval(() => void collectOutboundQualityStats(session), OUTBOUND_STATS_INTERVAL_MS)
}

function applyMusicOpusSdp(sdp = '') {
  const text = String(sdp || '')
  const opusMatch = text.match(/^a=rtpmap:(\d+)\s+opus\/48000(?:\/2)?\s*$/mi)
  if (!opusMatch) return text
  const payloadType = opusMatch[1]
  const fmtpPattern = new RegExp(`^a=fmtp:${payloadType}\\s+(.+)$`, 'mi')
  const fmtpMatch = text.match(fmtpPattern)
  const desired = {
    stereo: '1',
    'sprop-stereo': '1',
    maxaveragebitrate: String(MUSIC_AUDIO_MAX_BITRATE),
    maxplaybackrate: '48000',
    useinbandfec: '1',
    usedtx: '0'
  }
  if (!fmtpMatch) {
    return text.replace(opusMatch[0], `${opusMatch[0]}\r\na=fmtp:${payloadType} ${Object.entries(desired).map(([key, value]) => `${key}=${value}`).join(';')}`)
  }
  const params = new Map(
    fmtpMatch[1]
      .split(';')
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, ...rest] = entry.split('=')
        return [key, rest.join('=')]
      })
  )
  Object.entries(desired).forEach(([key, value]) => params.set(key, value))
  const nextFmtp = `a=fmtp:${payloadType} ${Array.from(params.entries()).map(([key, value]) => value ? `${key}=${value}` : key).join(';')}`
  return text.replace(fmtpPattern, nextFmtp)
}

export function sanitizeStreamKey(streamKey = '') {
  return sanitizeHlsStreamKey(streamKey)
}

export function buildHlsPlaybackUrl(streamKey = '') {
  return buildEdgePlaybackUrl(sanitizeStreamKey(streamKey), { ingestMethod: 'browserWebrtc' })
}

export function buildBrowserWebrtcIngestUrl(streamKey = '') {
  const configured = configuredEndpoint()
  const cleanKey = sanitizeStreamKey(streamKey)
  if (!configured || !cleanKey) return ''
  const hasPlaceholder = configured.includes('{streamKey}')
  const expanded = hasPlaceholder
    ? configured.replaceAll('{streamKey}', encodeURIComponent(cleanKey))
    : configured
  try {
    const url = new URL(expanded)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (!hasPlaceholder) url.searchParams.set('stream', cleanKey)
    // Legacy SRS WHIP used query parameters. Direct MediaMTX WHIP identifies
    // the stream by path and must not inherit SRS-specific routing metadata.
    if (url.pathname.includes('/rtc/v1/whip/')) {
      if (!url.searchParams.get('app')) url.searchParams.set('app', 'live')
      if (!url.searchParams.get('eip')) url.searchParams.set('eip', '104.197.179.248')
    }
    return url.toString()
  } catch {
    return ''
  }
}

export function isBrowserWebrtcIngestConfigured() {
  return Boolean(buildBrowserWebrtcIngestUrl('AbCdEfGhIjKlMnOpQrStUvWxY'))
}

export async function testBrowserWebrtcIngestReachability({ streamKey = '', timeoutMs = 8000 } = {}) {
  const endpoint = buildBrowserWebrtcIngestUrl(streamKey)
  if (!endpoint) {
    return {
      whipReachable: false,
      whipTestStatus: 'invalid-url',
      lastIngestError: 'Browser streaming could not build the Melogic WHIP ingest URL.'
    }
  }
  // The public proxy deliberately allows only the production site origin.
  // Do not turn that intentional restriction into a red error in a local
  // Studio build; production runs the same CORS-preflight probe below.
  if (['localhost', '127.0.0.1'].includes(window.location.hostname)) {
    return {
      whipReachable: null,
      whipTestStatus: 'production-origin-required',
      whipUrl: endpoint,
      ingestEndpointURL: stripEndpointSecrets(endpoint),
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: null,
      responseType: '',
      responseContentType: '',
      responseBodyPreview: '',
      corsPreflightStatus: 'The production proxy allows the Melogic site origin only. Run this check on melogicrecords.studio.',
      fetchErrorName: '',
      fetchErrorMessage: '',
      networkHint: 'Local Studio can prepare sources, but production is required for the browser-to-WHIP CORS check.',
      lastIngestError: ''
    }
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  console.log('[Browser WHIP] reachability test', {
    whipUrl: endpoint,
    origin: window.location.origin,
    method: 'OPTIONS',
    credentials: 'omit'
  })
  try {
    const response = await fetch(endpoint, {
      // WHIP accepts SDP offers via POST. A GET is not a valid probe and SRS
      // deliberately closes it, which a reverse proxy reports as a 502. An
      // OPTIONS request verifies the browser's CORS route without attempting
      // to create a publishing session or producing a false-negative warning.
      method: 'OPTIONS',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type'
      },
      signal: controller.signal
    })
    const responseText = await response.text().catch(() => '')
    const diagnostics = {
      whipReachable: response.ok,
      whipTestStatus: response.ok ? 'cors-ready' : `http-${response.status}`,
      whipUrl: endpoint,
      ingestEndpointURL: stripEndpointSecrets(endpoint),
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: response.status,
      responseType: response.type,
      responseContentType: response.headers.get('content-type') || '',
      responseBodyPreview: responseText.slice(0, 500),
      corsPreflightStatus: response.ok
        ? 'The browser CORS route is ready. A real WHIP session is negotiated only when Start Stream is pressed.'
        : `The WHIP CORS preflight returned HTTP ${response.status}.`,
      fetchErrorName: '',
      fetchErrorMessage: '',
      lastIngestError: response.ok ? '' : `Browser ingest CORS preflight returned HTTP ${response.status}.`
    }
    console.log('[Browser WHIP] reachability response', diagnostics)
    return diagnostics
  } catch (error) {
    const diagnostics = {
      whipReachable: false,
      whipTestStatus: 'fetch-failed',
      whipUrl: endpoint,
      ingestEndpointURL: stripEndpointSecrets(endpoint),
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: null,
      responseType: '',
      responseBodyPreview: '',
      corsPreflightStatus: 'No response was exposed. This may be CORS/preflight, TLS, DNS, proxy, or firewall failure.',
      fetchErrorName: error?.name || 'Error',
      fetchErrorMessage: error?.message || String(error),
      lastIngestError: error?.name === 'AbortError' ? 'Browser ingest reachability test timed out.' : error?.message || String(error)
    }
    console.warn('[Browser WHIP] reachability failed', diagnostics)
    return diagnostics
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function startBrowserWebrtcIngest({ streamId = '', streamKey, mediaStream, encodingSettings = {}, onStatus = () => {}, onError = () => {} } = {}) {
  const endpoint = buildBrowserWebrtcIngestUrl(streamKey)
  const hasProgramStream = typeof MediaStream !== 'undefined' && mediaStream instanceof MediaStream
  const trackCount = hasProgramStream ? mediaStream.getTracks().length : 0
  const normalizedEncodingSettings = normalizeEncoderSettings(encodingSettings, mediaStream)
  console.log('[Browser WHIP] config', {
    streamId,
    streamKey: sanitizeStreamKey(streamKey),
    whipUrl: endpoint,
    origin: window.location.origin,
    hasProgramStream,
    trackCount,
    audioTrackCount: hasProgramStream ? mediaStream.getAudioTracks().length : 0,
    videoTrackCount: hasProgramStream ? mediaStream.getVideoTracks().length : 0,
    encodingSettings: normalizedEncodingSettings
  })
  if (!configuredEndpoint() || !isBrowserWebrtcIngestConfigured() || !endpoint) {
    throw new Error('Browser streaming could not build the Melogic WHIP ingest URL.')
  }
  if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support WebRTC ingest.')
  if (!hasProgramStream || trackCount === 0) throw new Error('Browser WebRTC ingest requires the Studio Program media stream.')
  await stopBrowserWebrtcIngest()

  const safeEndpoint = stripEndpointSecrets(endpoint)
  const peerConnection = new RTCPeerConnection()
  const session = {
    peerConnection,
    mediaStream,
    resourceUrl: '',
    endpoint,
    stopped: false,
    connected: false,
    failureTimer: 0,
    failureStartedAt: 0,
    qualityTimer: 0,
    keyFrameTimer: 0,
    keyFrameWorker: null,
    periodicKeyFrameTransform: false,
    periodicKeyFrameRequestSupported: null,
    periodicKeyFrameRequests: 0,
    lastOutboundStats: null,
    outboundStallSamples: 0,
    audioStallSamples: 0,
    videoStallSamples: 0,
    lastOutboundProgressAt: 0,
    adaptiveVideoTier: 0,
    adaptiveLastChangedAt: 0,
    adaptiveConstrainedSamples: 0,
    adaptiveHealthySamples: 0,
    adaptiveReason: '',
    failureReported: false,
    encoderSettings: normalizedEncodingSettings
  }
  activeSession = session
  mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream))
  const h264Preferred = preferH264VideoCodec(peerConnection)
  await Promise.all([
    applyMusicAudioSenderParameters(peerConnection, mediaStream),
    applyProgramVideoSenderParameters(peerConnection, mediaStream, 'after-add-track', normalizedEncodingSettings)
  ])
  startPeriodicVideoKeyFrames(session)
  const emitStatus = (status, extra = {}) => onStatus({
    status,
    connectionState: peerConnection.connectionState,
    ingestEndpointURL: safeEndpoint,
    ...connectionDiagnostics(peerConnection, mediaStream, extra, normalizedEncodingSettings)
  })
  const reportFailure = (error, extra = {}) => {
    if (session.stopped || session.failureReported || activeSession !== session) return
    session.failureReported = true
    session.connected = false
    const diagnostics = connectionDiagnostics(peerConnection, mediaStream, {
      lastIngestError: error?.message || String(error),
      ...extra
    }, normalizedEncodingSettings)
    onError(error, diagnostics)
    void stopBrowserWebrtcIngest()
  }
  session.reportFailure = reportFailure
  const emitCurrentState = (event) => {
    const connectionState = peerConnection.connectionState
    const iceConnectionState = peerConnection.iceConnectionState
    const transportRecovered = connectionState === 'connected'
      || ['connected', 'completed'].includes(iceConnectionState)
    const transportInterrupted = ['disconnected', 'failed', 'closed'].includes(connectionState)
      || ['disconnected', 'failed', 'closed'].includes(iceConnectionState)
    console.log('[Browser WHIP] state', {
      event: event?.type || 'statechange',
      iceGatheringState: peerConnection.iceGatheringState,
      iceConnectionState,
      connectionState,
      signalingState: peerConnection.signalingState
    })
    emitStatus(connectionState)
    if (session.stopped || activeSession !== session) return
    if (transportRecovered) {
      if (session.failureTimer) {
        window.clearTimeout(session.failureTimer)
        session.failureTimer = 0
        console.log('[Live Lifecycle] browser WHIP recovered during grace period', {
          streamId,
          connectionState,
          iceConnectionState,
          graceMs: CONNECTION_FAILURE_GRACE_MS
        })
      }
      session.failureStartedAt = 0
      return
    }
    if (session.connected && transportInterrupted && !session.failureTimer) {
      session.failureStartedAt = Date.now()
      console.log('[Live Lifecycle] browser WHIP grace period started', {
        streamId,
        connectionState,
        iceConnectionState,
        graceMs: CONNECTION_FAILURE_GRACE_MS
      })
      session.failureTimer = window.setTimeout(() => {
        session.failureTimer = 0
        if (session.stopped || activeSession !== session || whipTransportReady(peerConnection)) return
        const error = new Error('Browser encoder connection is temporarily unavailable.')
        const diagnostics = connectionDiagnostics(peerConnection, mediaStream, {
          lastIngestError: error.message,
          whipFailureGraceExpired: true,
          whipFailureGraceMs: CONNECTION_FAILURE_GRACE_MS,
          whipFailureStartedAt: session.failureStartedAt ? new Date(session.failureStartedAt).toISOString() : ''
        }, normalizedEncodingSettings)
        console.log('[Live Lifecycle] browser WHIP unavailable after grace period', {
          streamId,
          connectionState: peerConnection.connectionState,
          iceConnectionState: peerConnection.iceConnectionState,
          graceMs: CONNECTION_FAILURE_GRACE_MS
        })
        reportFailure(error, diagnostics)
      }, CONNECTION_FAILURE_GRACE_MS)
    }
  }
  session.emitStatus = emitStatus
  peerConnection.addEventListener('connectionstatechange', emitCurrentState)
  peerConnection.addEventListener('iceconnectionstatechange', emitCurrentState)
  peerConnection.addEventListener('icegatheringstatechange', emitCurrentState)
  peerConnection.addEventListener('signalingstatechange', emitCurrentState)

  let offerSdpLength = 0
  let answerSdpLength = 0
  let responseStatus = null
  let responseType = ''
  let responseContentType = ''
  let responseBodyPreview = ''
  let corsPreflightStatus = 'Browser-managed; waiting for a fetch result.'
  let fetchErrorName = ''
  let fetchErrorMessage = ''
  try {
    emitStatus('new', { localOfferCreated: false, remoteAnswerSet: false })
    const offer = await peerConnection.createOffer()
    const musicOffer = {
      type: offer.type,
      sdp: applyProgramVideoSdp(applyMusicOpusSdp(offer.sdp), normalizedEncodingSettings)
    }
    console.log('[Browser WHIP] high-quality offer', {
      stereoRequested: /stereo=1/i.test(musicOffer.sdp || ''),
      maxAverageBitrate: MUSIC_AUDIO_MAX_BITRATE,
      videoStartBitrate: normalizedEncodingSettings.startBitrate,
      videoMinBitrate: normalizedEncodingSettings.minBitrate,
      videoTargetBitrate: normalizedEncodingSettings.maxBitrate,
      videoTargetFramerate: normalizedEncodingSettings.maxFramerate,
      videoTargetResolution: `${normalizedEncodingSettings.width}x${normalizedEncodingSettings.height}`,
      videoDegradationPreference: normalizedEncodingSettings.degradationPreference,
      h264Preferred,
      dtxDisabled: /usedtx=0/i.test(musicOffer.sdp || '')
    })
    await peerConnection.setLocalDescription(musicOffer)
    emitStatus('connecting', { localOfferCreated: true, remoteAnswerSet: false })
    await waitForIceGathering(peerConnection)
    const localOfferSdp = peerConnection.localDescription?.sdp || offer.sdp || ''
    offerSdpLength = localOfferSdp.length
    console.log('[Browser WHIP] local offer created', {
      sdpLength: offerSdpLength,
      iceGatheringState: peerConnection.iceGatheringState,
      signalingState: peerConnection.signalingState
    })
    let response
    const controller = new AbortController()
    const fetchTimeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: localOfferSdp,
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal
      })
    } catch (fetchError) {
      fetchErrorName = fetchError?.name || 'Error'
      fetchErrorMessage = fetchError?.message || String(fetchError)
      corsPreflightStatus = 'No response was exposed. This may be CORS/preflight, TLS, DNS, proxy, or firewall failure.'
      const error = new Error('Browser streaming could not connect to the Melogic ingest server.')
      error.cause = fetchError
      error.whipDiagnostics = connectionDiagnostics(peerConnection, mediaStream, {
        whipUrl: endpoint,
        ingestUrlHost: new URL(endpoint).host,
        responseStatus: null,
        responseType: '',
        responseBodyPreview: '',
        offerSdpLength,
        answerSdpLength: 0,
        fetchErrorName,
        fetchErrorMessage,
        corsPreflightStatus,
        networkHint: 'Check ingest TLS, CORS, firewall access, and the SRS WHIP listener.',
        lastIngestError: fetchErrorMessage
      }, normalizedEncodingSettings)
      throw error
    } finally {
      window.clearTimeout(fetchTimeout)
    }
    responseStatus = response.status
    responseType = response.type
    responseContentType = response.headers.get('content-type') || ''
    const answerSdp = await response.text()
    answerSdpLength = answerSdp.length
    responseBodyPreview = answerSdp.slice(0, 500)
    corsPreflightStatus = 'A POST response was exposed; CORS/preflight and HTTPS routing completed.'
    console.log('[Browser WHIP] fetch response', {
      status: response.status,
      ok: response.ok,
      type: response.type,
      contentType: response.headers.get('content-type')
    })
    if (!response.ok) {
      const error = new Error('Browser streaming could not connect to the Melogic ingest server.')
      error.whipDiagnostics = connectionDiagnostics(peerConnection, mediaStream, {
        whipUrl: endpoint,
        ingestUrlHost: new URL(endpoint).host,
        responseStatus: response.status,
        responseType,
        responseContentType,
        responseBodyPreview,
        offerSdpLength,
        answerSdpLength,
        fetchErrorName: '',
        fetchErrorMessage: '',
        corsPreflightStatus,
        lastIngestError: `WHIP negotiation returned HTTP ${response.status}: ${responseBodyPreview || 'empty response body'}`
      }, normalizedEncodingSettings)
      throw error
    }
    if (!answerSdp.trim()) {
      const error = new Error('Browser WebRTC ingest server returned an empty SDP answer.')
      error.whipDiagnostics = { responseStatus, responseType, responseContentType, responseBodyPreview, offerSdpLength, answerSdpLength, corsPreflightStatus }
      throw error
    }
    const location = response.headers.get('Location')
    session.resourceUrl = location ? new URL(location, endpoint).toString() : ''
    const answer = typeof RTCSessionDescription === 'function'
      ? new RTCSessionDescription({ type: 'answer', sdp: answerSdp })
      : { type: 'answer', sdp: answerSdp }
    await peerConnection.setRemoteDescription(answer)
    await Promise.all([
      applyMusicAudioSenderParameters(peerConnection, mediaStream, 'after-answer'),
      applyProgramVideoSenderParameters(peerConnection, mediaStream, 'after-answer', normalizedEncodingSettings)
    ])
    console.log('[Browser WHIP] remote answer applied', {
      answerLength: answerSdp.length,
      iceConnectionState: peerConnection.iceConnectionState,
      connectionState: peerConnection.connectionState,
      signalingState: peerConnection.signalingState
    })
    emitStatus('connecting', { localOfferCreated: true, remoteAnswerSet: true, offerSdpLength, answerSdpLength })
    await waitForConnection(peerConnection, mediaStream, emitStatus)
    if (session.stopped || activeSession !== session) throw new Error('Browser WebRTC ingest was stopped.')
    session.connected = true
    startOutboundQualityMonitor(session)
    const diagnostics = connectionDiagnostics(peerConnection, mediaStream, {
      localOfferCreated: true,
      remoteAnswerSet: true,
      whipUrl: endpoint,
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: response.status,
      responseType,
      responseContentType,
      responseBodyPreview: '',
      offerSdpLength,
      answerSdpLength,
      fetchErrorName: '',
      fetchErrorMessage: '',
      corsPreflightStatus,
      lastIngestError: ''
    }, normalizedEncodingSettings)
    emitStatus('connected', diagnostics)
    return {
      ok: true,
      endpoint,
      ingestEndpointURL: safeEndpoint,
      connectionState: peerConnection.connectionState,
      audioPublished: mediaStream.getAudioTracks().some((track) => track.readyState === 'live'),
      videoPublished: mediaStream.getVideoTracks().some((track) => track.readyState === 'live'),
      diagnostics,
      stop: stopBrowserWebrtcIngest
    }
  } catch (error) {
    const diagnostics = {
      ...connectionDiagnostics(peerConnection, mediaStream, {
        localOfferCreated: Boolean(peerConnection.localDescription?.sdp),
        remoteAnswerSet: Boolean(peerConnection.remoteDescription?.sdp),
        whipUrl: endpoint,
        ingestUrlHost: new URL(endpoint).host,
        responseStatus,
        responseType,
        responseContentType,
        responseBodyPreview,
        offerSdpLength,
        answerSdpLength,
        fetchErrorName,
        fetchErrorMessage,
        corsPreflightStatus,
        lastIngestError: error?.message || String(error)
      }, normalizedEncodingSettings),
      ...(error?.whipDiagnostics || {})
    }
    error.whipDiagnostics = diagnostics
    emitStatus('failed', diagnostics)
    onError(error, diagnostics)
    if (activeSession === session) activeSession = null
    session.stopped = true
    if (session.qualityTimer) window.clearInterval(session.qualityTimer)
    stopPeriodicVideoKeyFrames(session)
    peerConnection.close()
    throw error
  }
}

export async function stopBrowserWebrtcIngest() {
  const session = activeSession
  activeSession = null
  if (!session) return
  session.stopped = true
  if (session.failureTimer) window.clearTimeout(session.failureTimer)
  session.failureTimer = 0
  if (session.qualityTimer) window.clearInterval(session.qualityTimer)
  session.qualityTimer = 0
  stopPeriodicVideoKeyFrames(session)
  session.peerConnection.close()
  session.emitStatus?.('closed')
  if (session.resourceUrl) {
    try {
      await fetch(session.resourceUrl, { method: 'DELETE', keepalive: true })
    } catch (error) {
      console.warn('[browser-webrtc-ingest] resource cleanup failed', error)
    }
  }
}
