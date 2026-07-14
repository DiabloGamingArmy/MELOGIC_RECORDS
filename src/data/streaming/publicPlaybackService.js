import { antMediaPlaybackUrls } from './antMediaProvider'
import { PLAYBACK_MODES, STREAM_PROVIDERS } from './streamingProviderTypes'

export function getPublicPlaybackInfo(stream = {}) {
  const provider = stream.provider === STREAM_PROVIDERS.livekit
    ? STREAM_PROVIDERS.livekit
    : stream.provider === STREAM_PROVIDERS.antMedia
      ? STREAM_PROVIDERS.antMedia
      : STREAM_PROVIDERS.nativeStreaming
  if (provider === STREAM_PROVIDERS.nativeStreaming) {
    const native = stream.nativeStreaming || {}
    const status = native.status || stream.broadcastState || (native.hasPlayableSegments ? 'broadcasting' : 'idleNoListeners')
    return {
      provider,
      playbackMode: PLAYBACK_MODES.firebaseSegments,
      playable: Boolean(stream.status === 'live' && stream.hostConnected),
      hasPlayableSegments: native.hasPlayableSegments === true,
      targetLatencyMs: Number(native.targetLatencyMs || 30000),
      minPlaybackBufferMs: Number(native.minPlaybackBufferMs || 20000),
      status,
      url: '',
      message: native.hasPlayableSegments ? '' : 'Starting stream buffer...'
    }
  }
  if (provider === STREAM_PROVIDERS.antMedia) {
    const urls = antMediaPlaybackUrls({
      baseUrl: stream.antMediaBaseUrl || stream.publicPlaybackBaseUrl || '',
      appName: stream.antMediaAppName || 'live',
      streamId: stream.antMediaStreamId || ''
    })
    const resolvedUrls = {
      hlsUrl: stream.hlsUrl || urls.hlsUrl,
      llhlsUrl: stream.llhlsUrl || urls.llhlsUrl,
      webRtcPlaybackUrl: stream.webRtcPlaybackUrl || urls.webRtcPlaybackUrl
    }
    const playbackMode = stream.playbackMode || PLAYBACK_MODES.hls
    const url = playbackMode === PLAYBACK_MODES.llhls ? resolvedUrls.llhlsUrl : playbackMode === PLAYBACK_MODES.webrtc ? resolvedUrls.webRtcPlaybackUrl : resolvedUrls.hlsUrl
    return {
      provider,
      playbackMode,
      playable: Boolean(stream.status === 'live' && url),
      url,
      message: url ? '' : 'Ant Media is not configured.'
    }
  }
  return {
    provider: STREAM_PROVIDERS.livekit,
    playbackMode: PLAYBACK_MODES.webrtc,
    playable: Boolean(stream.status === 'live'
      && stream.hostConnected
      && (stream.audioPublished === true || stream.videoPublished === true || stream.programHasAudio === true || stream.programHasVideo === true)),
    url: '',
    message: ''
  }
}

export function isPublicStreamPlayable(stream = {}) {
  const info = getPublicPlaybackInfo(stream)
  return stream.status === 'live'
    && !['removed', 'blocked'].includes(stream.moderationStatus)
    && (stream.visibility === 'public' || stream.accessMode === 'password' || stream.accessMode === 'unlisted')
    && info.playable
    && (
      info.provider === STREAM_PROVIDERS.nativeStreaming
      || stream.programHasAudio === true
      || stream.programHasVideo === true
      || stream.audioPublished === true
      || stream.videoPublished === true
    )
}
