export const STREAM_PROVIDERS = Object.freeze({
  nativeStreaming: 'nativeStreaming',
  livekit: 'livekit',
  antMedia: 'antMedia'
})

export const INGEST_MODES = Object.freeze({
  browserMediaRecorder: 'browser-media-recorder',
  browserWebrtc: 'browser-webrtc',
  livekitWebrtc: 'livekit-webrtc',
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
  if (value === STREAM_PROVIDERS.nativeStreaming && firebaseSegmentStreamingEnabled()) return STREAM_PROVIDERS.nativeStreaming
  return STREAM_PROVIDERS.livekit
}

export function normalizePlaybackMode(value = '', fallback = PLAYBACK_MODES.webrtc) {
  return Object.values(PLAYBACK_MODES).includes(value) ? value : fallback
}

export function providerCapabilities(provider = STREAM_PROVIDERS.livekit) {
  if (provider === STREAM_PROVIDERS.nativeStreaming) {
    return {
      provider,
      ingestMode: INGEST_MODES.browserMediaRecorder,
      playbackMode: PLAYBACK_MODES.firebaseSegments,
      supportsAudio: true,
      supportsVideo: false,
      supportsTrackSwitching: false,
      supportsBufferedPlayback: true,
      supportsLowLatencyPlayback: false
    }
  }
  if (provider === STREAM_PROVIDERS.antMedia) {
    return {
      provider,
      ingestMode: INGEST_MODES.browserWebrtc,
      playbackMode: PLAYBACK_MODES.hls,
      supportsAudio: true,
      supportsVideo: true,
      supportsTrackSwitching: false,
      supportsBufferedPlayback: true,
      supportsLowLatencyPlayback: false
    }
  }
  return {
    provider: STREAM_PROVIDERS.livekit,
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
