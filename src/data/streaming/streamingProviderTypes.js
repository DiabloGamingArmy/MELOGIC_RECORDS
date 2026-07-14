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

export function normalizeProviderId(value = '') {
  return value === STREAM_PROVIDERS.livekit ? STREAM_PROVIDERS.livekit : STREAM_PROVIDERS.nativeStreaming
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
    ingestMode: INGEST_MODES.livekitWebrtc,
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
    quality: String(base.quality || '')
  }
}
