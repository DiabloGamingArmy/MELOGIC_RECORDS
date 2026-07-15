export const STREAM_PROVIDERS = Object.freeze({
  bufferedBroadcast: 'bufferedBroadcast',
  nativeWeb: 'nativeWeb',
  webrtc: 'webrtc',
  firebaseSegments: 'firebaseSegments',
  nativeStreaming: 'nativeStreaming',
  livekit: 'livekit',
  antMedia: 'antMedia'
})

export const INGEST_MODES = Object.freeze({
  browserMediaRecorder: 'browser-media-recorder',
  browserWebrtc: 'browser-webrtc',
  livekitWebrtc: 'livekit-webrtc',
  rtmpObs: 'rtmp-obs',
  rtmp: 'rtmp',
  srt: 'srt',
  none: 'none'
})

export const PLAYBACK_MODES = Object.freeze({
  firebaseSegments: 'firebaseSegments',
  webrtc: 'webrtc',
  hls: 'hls',
  llhls: 'llhls',
  none: 'none'
})

export function firebaseSegmentStreamingEnabled() {
  return import.meta.env?.VITE_ENABLE_FIREBASE_SEGMENT_STREAMING === 'true'
}

export function normalizeProviderId(value = '') {
  if (value === STREAM_PROVIDERS.bufferedBroadcast) return STREAM_PROVIDERS.bufferedBroadcast
  if ([STREAM_PROVIDERS.nativeWeb, STREAM_PROVIDERS.webrtc, STREAM_PROVIDERS.livekit].includes(value)) return STREAM_PROVIDERS.nativeWeb
  if ([STREAM_PROVIDERS.firebaseSegments, STREAM_PROVIDERS.nativeStreaming].includes(value)) {
    return STREAM_PROVIDERS.firebaseSegments
  }
  if (value === STREAM_PROVIDERS.antMedia) return STREAM_PROVIDERS.antMedia
  return STREAM_PROVIDERS.bufferedBroadcast
}

export function isBufferedBroadcastProvider(value = '') {
  return normalizeProviderId(value) === STREAM_PROVIDERS.bufferedBroadcast
}

export function isWebrtcProvider(value = '') {
  return normalizeProviderId(value) === STREAM_PROVIDERS.nativeWeb
}

export function isFirebaseSegmentProvider(value = '') {
  return normalizeProviderId(value) === STREAM_PROVIDERS.firebaseSegments
}

export function normalizePlaybackMode(value = '', fallback = PLAYBACK_MODES.webrtc) {
  return Object.values(PLAYBACK_MODES).includes(value) ? value : fallback
}

export function providerCapabilities(provider = STREAM_PROVIDERS.bufferedBroadcast) {
  const normalizedProvider = normalizeProviderId(provider)
  if (normalizedProvider === STREAM_PROVIDERS.firebaseSegments) {
    return {
      provider: normalizedProvider,
      ingestMode: INGEST_MODES.browserMediaRecorder,
      playbackMode: PLAYBACK_MODES.firebaseSegments,
      supportsAudio: true,
      supportsVideo: false,
      supportsTrackSwitching: false,
      supportsBufferedPlayback: true,
      supportsLowLatencyPlayback: false
    }
  }
  if (normalizedProvider === STREAM_PROVIDERS.bufferedBroadcast) {
    return {
      provider: normalizedProvider,
      transportProvider: 'hls-edge',
      ingestMode: INGEST_MODES.rtmpObs,
      playbackMode: PLAYBACK_MODES.hls,
      supportsAudio: true,
      supportsVideo: true,
      supportsTrackSwitching: false,
      supportsBufferedPlayback: true,
      supportsLowLatencyPlayback: false,
      latencyProfile: 'buffered'
    }
  }
  return {
    provider: normalizedProvider === STREAM_PROVIDERS.antMedia ? STREAM_PROVIDERS.antMedia : STREAM_PROVIDERS.nativeWeb,
    ingestMode: INGEST_MODES.browserWebrtc,
    playbackMode: PLAYBACK_MODES.webrtc,
    supportsAudio: true,
    supportsVideo: true,
    supportsTrackSwitching: true,
    supportsBufferedPlayback: false,
    supportsLowLatencyPlayback: true
  }
}

export function buildProviderDiagnostics(base = {}) {
  return {
    provider: normalizeProviderId(base.provider),
    roomId: String(base.roomId || base.roomName || ''),
    roomName: String(base.roomName || ''),
    connectionState: String(base.connectionState || 'idle'),
    audioTrackId: String(base.audioTrackId || ''),
    videoTrackId: String(base.videoTrackId || ''),
    reconnectCount: Number(base.reconnectCount || 0),
    lastMediaEvent: String(base.lastMediaEvent || ''),
    packetLoss: Number.isFinite(Number(base.packetLoss)) ? Number(base.packetLoss) : null,
    quality: String(base.quality || ''),
    recorderState: String(base.recorderState || ''),
    selectedMimeType: String(base.selectedMimeType || ''),
    segmentIndex: Number.isFinite(Number(base.segmentIndex)) ? Number(base.segmentIndex) : null,
    lastBlobSize: Number.isFinite(Number(base.lastBlobSize)) ? Number(base.lastBlobSize) : null,
    lastUploadPath: String(base.lastUploadPath || ''),
    lastUploadError: String(base.lastUploadError || ''),
    lastDataAvailableAt: String(base.lastDataAvailableAt || ''),
    newestAvailableSegmentIndex: Number.isFinite(Number(base.newestAvailableSegmentIndex)) ? Number(base.newestAvailableSegmentIndex) : null,
    hasPlayableSegments: base.hasPlayableSegments === true,
    demandCount: Number.isFinite(Number(base.demandCount)) ? Number(base.demandCount) : 0,
    demandPath: String(base.demandPath || ''),
    lastDemandChangeAt: String(base.lastDemandChangeAt || ''),
    lastDemandError: String(base.lastDemandError || ''),
    hostSessionId: String(base.hostSessionId || ''),
    hostHeartbeatFresh: base.hostHeartbeatFresh === true,
    trackCount: Number.isFinite(Number(base.trackCount)) ? Number(base.trackCount) : null,
    mediaStreamTrackCount: Number.isFinite(Number(base.mediaStreamTrackCount)) ? Number(base.mediaStreamTrackCount) : null,
    audioTrackReadyState: String(base.audioTrackReadyState || ''),
    segmentDurationMs: Number.isFinite(Number(base.segmentDurationMs)) ? Number(base.segmentDurationMs) : null,
    readySegmentWriteCount: Number.isFinite(Number(base.readySegmentWriteCount)) ? Number(base.readySegmentWriteCount) : 0,
    recorderStartReason: String(base.recorderStartReason || ''),
    recorderStopReason: String(base.recorderStopReason || '')
  }
}
