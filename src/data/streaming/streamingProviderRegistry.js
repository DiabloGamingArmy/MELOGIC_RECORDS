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
      description: "Send Melogic Studio's program output to the streaming server. Viewers watch the buffered HLS feed.",
      ingestMethod: STREAM_INGEST_METHODS.browserWebrtc,
      ingestProtocol: 'webrtc',
      transportProvider: 'hls-edge',
      playbackMode: 'hls'
    },
    {
      id: STREAM_INGEST_METHODS.obsRtmp,
      label: 'Stream From OBS / Encoder',
      description: 'Use OBS or a hardware encoder with RTMP.',
      ingestMethod: STREAM_INGEST_METHODS.obsRtmp,
      ingestProtocol: 'rtmp',
      transportProvider: 'hls-edge',
      playbackMode: 'hls'
    }
  ]
}
