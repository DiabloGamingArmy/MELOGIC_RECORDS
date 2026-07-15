import { createAntMediaProvider } from './antMediaProvider'
import { createBufferedBroadcastProvider } from './bufferedBroadcastProvider'
import { createLiveKitProvider } from './livekitProvider'
import { createNativeStreamingProvider } from './nativeStreamingProvider'
import { firebaseSegmentStreamingEnabled, normalizeProviderId, STREAM_PROVIDERS } from './streamingProviderTypes'

const providerFactories = {
  [STREAM_PROVIDERS.bufferedBroadcast]: createBufferedBroadcastProvider,
  [STREAM_PROVIDERS.firebaseSegments]: createNativeStreamingProvider,
  [STREAM_PROVIDERS.webrtc]: createLiveKitProvider,
  [STREAM_PROVIDERS.antMedia]: createAntMediaProvider
}

let providerCache = null

export function preferredStreamingProviderId() {
  return STREAM_PROVIDERS.bufferedBroadcast
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
  return providers[normalizeProviderId(id)] || providers[STREAM_PROVIDERS.bufferedBroadcast]
}

export function listStreamingProviderOptions() {
  const ids = firebaseSegmentStreamingEnabled()
    ? [STREAM_PROVIDERS.bufferedBroadcast, STREAM_PROVIDERS.webrtc, STREAM_PROVIDERS.firebaseSegments]
    : [STREAM_PROVIDERS.bufferedBroadcast, STREAM_PROVIDERS.webrtc]
  return ids.map((id) => {
    const provider = getStreamingProviders()[id]
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description || '',
      transportProvider: provider.transportProvider || provider.capabilities?.transportProvider || '',
      ingestMode: provider.ingestMode || provider.capabilities?.ingestMode || '',
      playbackMode: provider.playbackMode || provider.capabilities?.playbackMode || '',
      latencyProfile: provider.latencyProfile || provider.capabilities?.latencyProfile || '',
      defaultPublicPlayback: provider.defaultPublicPlayback === true,
      experimental: provider.experimental === true,
      configured: provider.configured !== false,
      capabilities: provider.capabilities
    }
  })
}
