import { antMediaPlaybackUrls } from './antMediaProvider'
import { buildHlsPlaybackUrl, isAllowedHlsPlaybackUrl } from './hlsEdgePlayer'
import { PLAYBACK_MODES, STREAM_PROVIDERS } from './streamingProviderTypes'

export function hasHlsPlaybackRoute(stream = {}) {
  const declaredProvider = String(stream.provider || '')
  return stream.streamingProtocol === 'hls'
    || declaredProvider === STREAM_PROVIDERS.hlsEdge
    || declaredProvider === STREAM_PROVIDERS.bufferedBroadcast
    || stream.transportProvider === 'hls-edge'
    || stream.playbackMode === PLAYBACK_MODES.hls
    || Boolean(String(stream.hlsPlaybackUrl || '').trim())
    || Boolean(String(stream.hlsUrl || '').trim())
    || (Boolean(String(stream.streamKey || '').trim()) && stream.transportProvider === 'hls-edge')
}

export function isExplicitFirebaseSegmentsPlayback(stream = {}) {
  const declaredProvider = String(stream.provider || '')
  return stream.streamingProtocol === 'nativeStreaming'
    || declaredProvider === STREAM_PROVIDERS.nativeStreaming
    || declaredProvider === STREAM_PROVIDERS.firebaseSegments
    || declaredProvider === 'firebase-segments'
    || stream.playbackMode === PLAYBACK_MODES.firebaseSegments
    || stream.transportProvider === 'firebase-segments'
}

export function selectPublicPlaybackPlayer(stream = {}) {
  const declaredProvider = String(stream.provider || '')
  if (stream.streamingProtocol === 'hls') return 'hls'
  if (isExplicitFirebaseSegmentsPlayback(stream)) return 'firebaseSegments'
  if (hasHlsPlaybackRoute(stream)) return 'hls'
  if (declaredProvider === STREAM_PROVIDERS.antMedia) return 'antMedia'
  return 'hls'
}

export function getPublicPlaybackInfo(stream = {}) {
  const selectedPlayer = selectPublicPlaybackPlayer(stream)
  if (selectedPlayer === 'hls') {
    const rawProvider = String(stream.rawProvider ?? stream.provider ?? '')
    const rawPlaybackMode = String(stream.rawPlaybackMode ?? stream.playbackMode ?? '')
    const rawStreamKey = String(stream.rawStreamKey ?? stream.streamKey ?? '')
    const rawHlsPlaybackUrl = String(stream.rawHlsPlaybackUrl ?? stream.hlsPlaybackUrl ?? '')
    const configuredUrl = String(stream.hlsPlaybackUrl || '').trim()
    const configuredUrlAllowed = isAllowedHlsPlaybackUrl(configuredUrl)
    const keyUrl = buildHlsPlaybackUrl(stream.streamKey)
    const url = configuredUrlAllowed ? configuredUrl : keyUrl
    const message = url
      ? ''
      : configuredUrl
        ? 'Invalid HLS playback URL. Streams must load from stream.melogicrecords.studio.'
        : String(stream.provider || '') === STREAM_PROVIDERS.hlsEdge
          ? 'This HLS stream is missing its stream key. Start a new stream from the updated Studio controls.'
          : 'This stream is missing an HLS stream key.'
    return {
      provider: STREAM_PROVIDERS.hlsEdge,
      selectedPlayer,
      computedHlsUrl: url,
      normalizationApplied: stream.normalizationApplied === true,
      rawProvider,
      rawPlaybackMode,
      rawStreamKey,
      rawHlsPlaybackUrl,
      transportProvider: 'hls-edge',
      playbackMode: PLAYBACK_MODES.hls,
      latencyProfile: 'buffered',
      playable: Boolean(stream.status === 'live' && url),
      url,
      message
    }
  }
  if (selectedPlayer === 'firebaseSegments') {
    const native = stream.nativeStreaming || {}
    const status = native.status || stream.broadcastState || (native.hasPlayableSegments ? 'broadcasting' : 'idleNoListeners')
    return {
      provider: STREAM_PROVIDERS.firebaseSegments,
      selectedPlayer,
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
  if (selectedPlayer === 'antMedia') {
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
      provider: STREAM_PROVIDERS.antMedia,
      selectedPlayer,
      playbackMode,
      playable: Boolean(stream.status === 'live' && url),
      url,
      message: url ? '' : 'Ant Media is not configured.'
    }
  }
  return {
    provider: STREAM_PROVIDERS.nativeWeb,
    selectedPlayer,
    playbackMode: PLAYBACK_MODES.webrtc,
    playable: Boolean(stream.status === 'live'
      && stream.hostConnected
      && (stream.audioPublished === true || stream.videoPublished === true || stream.programHasAudio === true || stream.programHasVideo === true)),
    url: '',
    message: stream.status === 'live' && !stream.hostConnected
      ? 'This website-native stream requires WebRTC playback, which is not configured yet.'
      : ''
  }
}

export function isPublicStreamPlayable(stream = {}) {
  const info = getPublicPlaybackInfo(stream)
  return stream.status === 'live'
    && !['removed', 'blocked'].includes(stream.moderationStatus)
    && (stream.visibility === 'public' || stream.accessMode === 'password' || stream.accessMode === 'unlisted')
    && info.playable
    && (
      info.provider === STREAM_PROVIDERS.firebaseSegments
      || info.provider === STREAM_PROVIDERS.hlsEdge
      || stream.programHasAudio === true
      || stream.programHasVideo === true
      || stream.audioPublished === true
      || stream.videoPublished === true
    )
}
