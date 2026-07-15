import { createAntMediaProvider } from './antMediaProvider'
import { createBufferedBroadcastProvider } from './bufferedBroadcastProvider'
import { createLiveKitProvider } from './livekitProvider'
import { createNativeStreamingProvider } from './nativeStreamingProvider'
import { normalizeProviderId, STREAM_INGEST_METHODS, STREAM_PROVIDERS } from './streamingProviderTypes'

const providerFactories = {
  [STREAM_PROVIDERS.hlsEdge]: createBufferedBroadcastProvider,
  [STREAM_PROVIDERS.firebaseSegments]: createNativeStreamingProvider,
  [STREAM_PROVIDERS.nativeWeb]: createLiveKitProvider,
  [STREAM_PROVIDERS.antMedia]: createAntMediaProvider
}

let providerCache = null

export function preferredStreamingProviderId() {
  return STREAM_PROVIDERS.hlsEdge
}

export function getStreamingProviders() {
  if (!providerCache) {
    providerCache = Object.fromEntries(
      Object.entries(providerFactories).map(([id, factory]) => [id, factory()])
    )
  }
  return providerCache
}

export function getStreamingProvider(id = preferredStreamingProviderId()) {
  const providers = getStreamingProviders()
  return providers[normalizeProviderId(id)] || providers[STREAM_PROVIDERS.hlsEdge]
}

export function listStreamingProviderOptions() {
  return [
    {
      id: STREAM_INGEST_METHODS.browserWebrtc,
      label: 'Stream From Browser',
      description: "Use Melogic Studio's built-in audio/video engine. Viewers watch through buffered HLS.",
      ingestMethod: STREAM_INGEST_METHODS.browserWebrtc,
      ingestProtocol: 'webrtc',
      transportProvider: 'hls-edge',
      playbackMode: 'hls'
    },
    {
      id: STREAM_INGEST_METHODS.obsRtmp,
      label: 'Stream From OBS / Encoder',
      description: 'Use OBS, hardware encoder, or another RTMP app. Viewers watch through buffered HLS.',
      ingestMethod: STREAM_INGEST_METHODS.obsRtmp,
      ingestProtocol: 'rtmp',
      transportProvider: 'hls-edge',
      playbackMode: 'hls'
    }
  ]
}
