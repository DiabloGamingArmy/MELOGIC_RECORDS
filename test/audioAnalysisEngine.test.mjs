import test from 'node:test'
import assert from 'node:assert/strict'

import { AudioAnalysisCache, MemoryAnalysisStore, createAnalysisCacheKey } from '../src/studio/audio/analysis/AudioAnalysisCache.js'
import { NativeAnalysisProvider } from '../src/studio/audio/analysis/NativeAnalysisProvider.js'
import { WebAnalysisProvider } from '../src/studio/audio/analysis/WebAnalysisProvider.js'
import { AudioAnalysisService } from '../src/studio/audio/analysis/AudioAnalysisService.js'
import { analyzePcmSource, deriveIntervalAnalysis } from '../src/studio/audio/analysis/audioAnalysisCore.js'
import { analyzeProjectContext, compareRegionAnalyses, findSimilarFrames } from '../src/studio/audio/analysis/contextAnalysis.js'

function sine({ frequency = 440, amplitude = 0.5, seconds = 1, sampleRate = 8000, phase = 0 } = {}) {
  const output = new Float32Array(Math.max(1, Math.round(seconds * sampleRate)))
  for (let index = 0; index < output.length; index += 1) output[index] = amplitude * Math.sin((2 * Math.PI * frequency * index / sampleRate) + phase)
  return output
}

function analyze(channels, overrides = {}) {
  return analyzePcmSource({
    source: { id: overrides.id || 'fixture', revision: '1', name: 'Fixture' },
    channels,
    sampleRate: overrides.sampleRate || 8000,
    profile: overrides.profile || 'quick',
    scope: overrides.scope || 'track',
    mode: overrides.mode || 'independent'
  })
}

test('silent, mono, stereo, very short, and clipped fixtures normalize safely', () => {
  const silence = analyze([new Float32Array(8000)])
  assert.equal(silence.measurements.levels.samplePeakDbfs, -120)
  assert.equal(silence.source.channelCount, 1)
  assert.ok(Number.isFinite(silence.measurements.levels.rmsDbfs))

  const mono = analyze([sine()])
  assert.equal(mono.measurements.stereo.channelCount, 1)
  assert.equal(mono.measurements.stereo.monoCompatible, true)

  const left = sine()
  const inPhase = analyze([left, left.slice()])
  assert.ok(inPhase.measurements.stereo.correlation > 0.99)
  const outOfPhase = analyze([left, sine({ phase: Math.PI })])
  assert.ok(outOfPhase.measurements.stereo.correlation < -0.99)
  assert.equal(outOfPhase.measurements.stereo.monoCompatible, false)

  const veryShort = analyze([new Float32Array([0, 0.25, -0.25, 0])])
  assert.equal(veryShort.metadata.framesProcessed, 1)
  assert.ok(Number.isFinite(veryShort.measurements.levels.crestFactorDb))

  const clippedSamples = new Float32Array(2048).fill(1)
  const clipped = analyze([clippedSamples])
  assert.ok(clipped.measurements.levels.clippingSamples > 0)
  assert.ok(clipped.detections.some((finding) => finding.type === 'probable-clipping'))
})

test('region interval derivation respects source trim and playback rate', () => {
  const sampleRate = 8000
  const quiet = sine({ amplitude: 0.1, seconds: 1, sampleRate })
  const loud = sine({ amplitude: 0.8, seconds: 1, sampleRate })
  const source = new Float32Array(quiet.length + loud.length)
  source.set(quiet)
  source.set(loud, quiet.length)
  const full = analyze([source], { sampleRate, profile: 'standard' })
  const first = deriveIntervalAnalysis(full, { startSeconds: 0, endSeconds: 1, playbackRate: 1, name: 'Quiet' })
  const second = deriveIntervalAnalysis(full, { startSeconds: 1, endSeconds: 2, playbackRate: 2, name: 'Loud fast' })
  assert.ok(second.measurements.levels.rmsDbfs - first.measurements.levels.rmsDbfs > 12)
  assert.ok(Math.abs(second.source.durationSeconds - 0.5) < 0.001)
  assert.equal(second.metadata.cache, 'derived')
})

test('multiple-region comparison reports measured level and spectral differences', () => {
  const quiet = analyze([sine({ amplitude: 0.1, frequency: 120 })], { id: 'quiet' })
  const loudBright = analyze([sine({ amplitude: 0.7, frequency: 2200 })], { id: 'bright' })
  const comparison = compareRegionAnalyses([
    { id: 'a', name: 'Verse', result: quiet },
    { id: 'b', name: 'Chorus', result: loudBright }
  ])
  assert.ok(comparison.differences.some((finding) => finding.type === 'relative-loudness'))
  assert.ok(comparison.differences.some((finding) => finding.type === 'spectral-balance'))
})

test('project context requires spectral, temporal, and relative-level coincidence', () => {
  const target = analyze([sine({ amplitude: 0.4, frequency: 1000, seconds: 2 })], { id: 'target', profile: 'standard' })
  const competing = analyze([sine({ amplitude: 0.35, frequency: 1000, seconds: 2 })], { id: 'other', profile: 'standard' })
  const findings = analyzeProjectContext(
    [{ name: 'Vocal', projectStartSeconds: 4, result: target }],
    [{ name: 'Guitar', projectStartSeconds: 4.2, result: competing }]
  )
  assert.ok(findings.length > 0)
  assert.ok(findings[0].startSeconds >= 4.2)
  assert.equal(findings[0].details.signalStage, 'source')
  const noOverlap = analyzeProjectContext(
    [{ projectStartSeconds: 0, result: target }],
    [{ projectStartSeconds: 10, result: competing }]
  )
  assert.equal(noOverlap.length, 0)
})

test('cached frame descriptors support deterministic find-similar indexing', () => {
  const source = analyze([sine({ frequency: 800, seconds: 2 })], { id: 'similar', profile: 'standard' })
  const query = source.frameFeatures[0]
  const matches = findSimilarFrames(query, [{ name: 'Cached source', projectStartSeconds: 7, result: source }], { minimumSimilarity: 0.9 })
  assert.ok(matches.length > 0)
  assert.equal(matches[0].sourceName, 'Cached source')
  assert.ok(matches[0].startSeconds >= 7)
})

test('cache reuses identical source and version changes invalidate identity', async () => {
  const store = new MemoryAnalysisStore()
  const cache = new AudioAnalysisCache({ store })
  const source = { id: 'asset-1', revision: 'etag-1', sampleRate: 8000, channelCount: 1 }
  const result = analyze([sine()], { id: source.id })
  await cache.put(source, 'quick', result)
  const hit = await cache.get(source, 'quick')
  assert.equal(hit.metadata.cache, 'hit')
  assert.equal(await cache.get({ ...source, revision: 'etag-2' }, 'quick'), null)
  assert.notEqual(createAnalysisCacheKey(source, 'quick', { levels: 1 }), createAnalysisCacheKey(source, 'quick', { levels: 2 }))
})

test('service cache hit avoids loading or analyzing PCM again', async () => {
  let providerCalls = 0
  let loaderCalls = 0
  const result = analyze([sine()], { id: 'cache-service' })
  const provider = { kind: 'web-worker', analyze: async () => { providerCalls += 1; return structuredClone(result) } }
  const cache = new AudioAnalysisCache({ store: new MemoryAnalysisStore() })
  const nativeProvider = { isAvailable: () => false }
  const service = new AudioAnalysisService({ cache, webProvider: provider, nativeProvider })
  const source = { id: 'cache-service', revision: '1', sampleRate: 8000, channelCount: 1 }
  const loadPcm = async () => { loaderCalls += 1; return { channels: [sine()], sampleRate: 8000 } }
  await service.analyzeSource({ source, profile: 'quick', loadPcm })
  await service.analyzeSource({ source, profile: 'quick', loadPcm })
  assert.equal(providerCalls, 1)
  assert.equal(loaderCalls, 1)
})

test('web provider falls back when worker construction fails', async () => {
  const provider = new WebAnalysisProvider({ workerFactory: () => { throw new Error('worker blocked') } })
  const result = await provider.analyze({ source: { id: 'fallback', revision: '1', name: 'Fallback' }, channels: [sine()], sampleRate: 8000, profile: 'quick' })
  assert.equal(result.metadata.provider, 'web-fallback')
  assert.ok(result.metadata.warnings.some((warning) => warning.includes('worker blocked')))
})

test('worker failure after transferable handoff reports a recoverable error', async () => {
  class FailedWorker {
    postMessage() { queueMicrotask(() => this.onerror?.({ message: 'worker crashed' })) }
    terminate() {}
  }
  const provider = new WebAnalysisProvider({ workerFactory: () => new FailedWorker() })
  await assert.rejects(
    provider.analyze({ source: { id: 'crash', revision: '1', name: 'Crash' }, channels: [sine()], sampleRate: 8000, profile: 'quick' }),
    /worker crashed/
  )
})

test('worker-backed analysis cancellation rejects with AbortError', async () => {
  class WaitingWorker {
    postMessage() {}
    terminate() { this.terminated = true }
  }
  const worker = new WaitingWorker()
  const provider = new WebAnalysisProvider({ workerFactory: () => worker })
  const controller = new AbortController()
  const pending = provider.analyze({ source: { id: 'cancel', revision: '1' }, channels: [sine()], sampleRate: 8000 }, { signal: controller.signal })
  controller.abort()
  await assert.rejects(pending, (error) => error.name === 'AbortError')
  assert.equal(worker.terminated, true)
})

test('native provider detection selects native and native failure falls back', async () => {
  const fixture = analyze([sine()], { id: 'native' })
  const native = new NativeAnalysisProvider({
    runtimeDetector: () => true,
    invoke: async (command) => {
      assert.equal(command, 'native_audio_analyze_pcm')
      return { ...structuredClone(fixture), metadata: { ...fixture.metadata, provider: 'native' } }
    },
    fallbackProvider: { analyze: async () => { throw new Error('fallback should not run') } }
  })
  assert.equal(native.isAvailable(), true)
  const nativeResult = await native.analyze({ channels: [sine()] })
  assert.equal(nativeResult.metadata.provider, 'native')
  assert.deepEqual(Object.keys(nativeResult).sort(), Object.keys(fixture).sort())

  const fallback = new NativeAnalysisProvider({
    runtimeDetector: () => true,
    invoke: async () => { throw new Error('native unavailable') },
    fallbackProvider: { analyze: async () => structuredClone(fixture) }
  })
  const fallbackResult = await fallback.analyze({ channels: [sine()] })
  assert.equal(fallbackResult.metadata.provider, fixture.metadata.provider)
  assert.ok(fallbackResult.metadata.warnings.some((warning) => warning.includes('native unavailable')))
})

test('analysis job does not prevent unrelated playback work from continuing', async () => {
  class AsyncWorker {
    postMessage(message) {
      if (message.type !== 'analyze') return
      setTimeout(() => this.onmessage?.({ data: { type: 'complete', jobId: message.jobId, result: analyze([sine()]) } }), 15)
    }
    terminate() {}
  }
  const provider = new WebAnalysisProvider({ workerFactory: () => new AsyncWorker() })
  let transportTicks = 0
  const pending = provider.analyze({ source: { id: 'playback', revision: '1' }, channels: [sine()], sampleRate: 8000 })
  await new Promise((resolve) => setTimeout(() => { transportTicks += 1; resolve() }, 1))
  await pending
  assert.equal(transportTicks, 1)
})
