export function planPortableRenderStrategy(capabilities = {}, { dependency = null } = {}) {
  if (dependency?.capability === 'native-vst3-host') {
    if (capabilities.nativeOfflinePluginRender) return { strategy: 'accelerated-native-offline', fallback: 'realtime-native' }
    if (capabilities.nativeVst3Host) return { strategy: 'realtime-native', fallback: null }
    return { strategy: 'unavailable', fallback: null }
  }
  if (capabilities.offlineAudio) return { strategy: 'offline-audio-context', fallback: 'realtime-web-audio' }
  if (capabilities.webAudio) return { strategy: 'realtime-web-audio', fallback: null }
  return { strategy: 'unavailable', fallback: null }
}

export class PortableRenderProviderRegistry {
  constructor() { this.providers = new Map() }
  register(strategy, provider) {
    if (!strategy || typeof provider?.render !== 'function') throw new Error('Portable render providers require a strategy and render() method.')
    this.providers.set(strategy, provider)
    return this
  }
  get(strategy) { return this.providers.get(strategy) || null }
  async render(plan, request) {
    const provider = this.get(plan?.strategy)
    if (!provider) throw new Error(`No portable render provider is registered for ${plan?.strategy || 'unknown'}.`)
    return provider.render(request)
  }
}

