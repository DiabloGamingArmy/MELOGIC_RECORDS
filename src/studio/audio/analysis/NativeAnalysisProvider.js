import { isSouraNativeRuntime } from '../native/NativeSouraAudioBackend.js'
import { WebAnalysisProvider } from './WebAnalysisProvider.js'

let invokePromise = null

async function getInvoke() {
  if (!invokePromise) invokePromise = import('@tauri-apps/api/core').then((module) => module.invoke)
  return invokePromise
}

export class NativeAnalysisProvider {
  constructor({ invoke, fallbackProvider = new WebAnalysisProvider(), runtimeDetector = isSouraNativeRuntime } = {}) {
    this.kind = 'native'
    this.invoke = invoke
    this.fallbackProvider = fallbackProvider
    this.runtimeDetector = runtimeDetector
  }

  isAvailable() {
    return Boolean(this.runtimeDetector?.())
  }

  async analyze(request, options = {}) {
    if (!this.isAvailable()) return this.fallbackProvider.analyze(request, options)
    if (options.signal?.aborted) {
      const error = new Error('Audio analysis was cancelled.')
      error.name = 'AbortError'
      throw error
    }
    try {
      options.onProgress?.({ phase: 'Native analysis', progress: 0.08 })
      const invoke = this.invoke || await getInvoke()
      const nativeResult = await invoke('native_audio_analyze_pcm', {
        request: {
          ...request,
          channels: (request.channels || []).map((channel) => Array.from(channel))
        }
      })
      if (options.signal?.aborted) {
        const error = new Error('Audio analysis was cancelled.')
        error.name = 'AbortError'
        throw error
      }
      options.onProgress?.({ phase: 'Complete', progress: 1 })
      return nativeResult
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      const result = await this.fallbackProvider.analyze(request, options)
      result.metadata.warnings = [...(result.metadata.warnings || []), `Native analysis unavailable; web provider used: ${error?.message || 'unknown native error'}`]
      return result
    }
  }
}

export default NativeAnalysisProvider

