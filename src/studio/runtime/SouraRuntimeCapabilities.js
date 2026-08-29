export function isSouraDesktopRuntime(scope = globalThis) {
  const navigatorRef = scope?.navigator
  return Boolean(
    scope?.__TAURI_INTERNALS__
    || scope?.__TAURI__
    || navigatorRef?.userAgent?.includes('Tauri')
  )
}

export function getSouraRuntimeCapabilities(scope = globalThis) {
  const desktop = isSouraDesktopRuntime(scope)
  const navigatorRef = scope?.navigator || null
  const windowRef = scope?.window || scope
  return Object.freeze({
    runtime: desktop ? 'desktop' : 'web',
    desktop,
    web: !desktop,
    webAudio: typeof windowRef?.AudioContext === 'function' || typeof windowRef?.webkitAudioContext === 'function',
    audioWorklet: typeof windowRef?.AudioWorkletNode === 'function',
    offlineAudio: typeof windowRef?.OfflineAudioContext === 'function' || typeof windowRef?.webkitOfflineAudioContext === 'function',
    webAssembly: typeof scope?.WebAssembly === 'object',
    workers: typeof windowRef?.Worker === 'function',
    sharedArrayBuffer: typeof scope?.SharedArrayBuffer === 'function' && Boolean(scope?.crossOriginIsolated),
    opfs: Boolean(navigatorRef?.storage?.getDirectory),
    nativeAudioControl: desktop,
    nativeVst3Host: desktop,
    nativePluginScan: desktop,
    nativeOfflinePluginRender: false,
    acceleratedOfflineRender: !desktop && (typeof windowRef?.OfflineAudioContext === 'function' || typeof windowRef?.webkitOfflineAudioContext === 'function')
  })
}
