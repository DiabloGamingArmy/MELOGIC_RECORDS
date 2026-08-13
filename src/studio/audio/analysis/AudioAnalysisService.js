import { AudioAnalysisCache } from './AudioAnalysisCache.js'
import { NativeAnalysisProvider } from './NativeAnalysisProvider.js'
import { WebAnalysisProvider } from './WebAnalysisProvider.js'
import { deriveIntervalAnalysis } from './audioAnalysisCore.js'
import { applyRegionGain } from './contextAnalysis.js'
import { buildRecommendations } from './recommendationEngine.js'

export class AudioAnalysisService {
  constructor({ cache = new AudioAnalysisCache(), webProvider = new WebAnalysisProvider(), nativeProvider } = {}) {
    this.cache = cache
    this.webProvider = webProvider
    this.nativeProvider = nativeProvider || new NativeAnalysisProvider({ fallbackProvider: webProvider })
    this.activeController = null
    this.activeJobId = ''
  }

  getProvider() {
    return this.nativeProvider.isAvailable() ? this.nativeProvider : this.webProvider
  }

  cancel() {
    this.activeController?.abort()
    this.activeController = null
    this.activeJobId = ''
  }

  async analyzeSource({ source, profile = 'standard', loadPcm, scope = 'track', mode = 'independent', sourceType = 'auto', onProgress, signal } = {}) {
    const cached = await this.cache.get(source, profile)
    if (cached) return { ...cached, scope, mode, recommendations: buildRecommendations({ ...cached, scope, mode }, { sourceType }) }
    const loaded = await loadPcm()
    const request = {
      jobId: `analysis:${source.id}:${Date.now()}`,
      source: { ...source, sampleRate: loaded.sampleRate, channelCount: loaded.channels.length },
      sampleRate: loaded.sampleRate,
      channels: loaded.channels,
      profile,
      scope,
      mode
    }
    const result = await this.getProvider().analyze(request, { onProgress, signal })
    await this.cache.put(request.source, profile, result)
    result.recommendations = buildRecommendations(result, { sourceType })
    return result
  }

  async analyzeRegion({ source, interval, gainDb = 0, ...options } = {}) {
    const sourceResult = await this.analyzeSource({ source, ...options, scope: 'region', mode: 'single-region' })
    const regionResult = applyRegionGain(deriveIntervalAnalysis(sourceResult, interval), gainDb)
    regionResult.recommendations = buildRecommendations(regionResult, { sourceType: options.sourceType })
    return regionResult
  }

  createJob() {
    this.cancel()
    const controller = new AbortController()
    const jobId = `smart-controls:${Date.now()}:${Math.random().toString(36).slice(2)}`
    this.activeController = controller
    this.activeJobId = jobId
    return { jobId, signal: controller.signal, isCurrent: () => this.activeJobId === jobId && !controller.signal.aborted }
  }
}

export default AudioAnalysisService
