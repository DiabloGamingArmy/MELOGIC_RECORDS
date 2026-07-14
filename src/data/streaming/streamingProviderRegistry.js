import { createAntMediaProvider } from './antMediaProvider'
import { createLiveKitProvider } from './livekitProvider'
import { createNativeStreamingProvider } from './nativeStreamingProvider'
import { normalizeProviderId, STREAM_PROVIDERS } from './streamingProviderTypes'

const providerFactories = {
  [STREAM_PROVIDERS.nativeStreaming]: createNativeStreamingProvider,
  [STREAM_PROVIDERS.livekit]: createLiveKitProvider,
  [STREAM_PROVIDERS.antMedia]: createAntMediaProvider
}

let providerCache = null

export function preferredStreamingProviderId() {
  return normalizeProviderId(import.meta.env?.VITE_STREAM_PROVIDER || STREAM_PROVIDERS.nativeStreaming)
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
  return providers[normalizeProviderId(id)] || providers[STREAM_PROVIDERS.nativeStreaming]
}

export function listStreamingProviderOptions() {
  return [STREAM_PROVIDERS.nativeStreaming, STREAM_PROVIDERS.livekit].map((id) => {
    const provider = getStreamingProviders()[id]
    return {
      id: provider.id,
      label: provider.label,
      configured: provider.configured !== false,
      capabilities: provider.capabilities
    }
  })
}
