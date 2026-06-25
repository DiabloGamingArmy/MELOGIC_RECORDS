import SignalsmithStretch from './vendor/SignalsmithStretch.mjs'
import {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  SOURA_AUDIO_DSP_ENGINE_TYPE,
  SOURA_AUDIO_DSP_MANIFEST_URL,
  SOURA_AUDIO_DSP_OPERATIONS,
  SOURA_AUDIO_DSP_REQUIRED_ERROR,
  SOURA_AUDIO_DSP_WASM_URL
} from '../audioDspTypes.js'

const allowLegacyJsDspFallback = import.meta.env?.VITE_SOURA_ALLOW_LEGACY_JS_DSP === 'true'

let initPromise = null
let engineManifest = null
let status = {
  status: 'idle',
  engineId: SOURA_AUDIO_DSP_ENGINE_ID,
  engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
  engineType: SOURA_AUDIO_DSP_ENGINE_TYPE,
  requiresWasm: SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  quality: 'high',
  error: '',
  legacyFallbackEnabled: allowLegacyJsDspFallback
}

function setStatus(patch = {}) {
  status = { ...status, ...patch }
}

function getOfflineAudioContextCtor() {
  return globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext || null
}

function assertRuntimeSupport() {
  if (typeof WebAssembly === 'undefined') {
    throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} WebAssembly is unavailable.`)
  }
  if (!getOfflineAudioContextCtor()) {
    throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} OfflineAudioContext is unavailable.`)
  }
  if (!globalThis.AudioWorkletNode) {
    throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} AudioWorkletNode is unavailable.`)
  }
}

function readString(value = '') {
  return String(value || '').trim()
}

async function fetchRequiredWasmAsset() {
  const [manifestResponse, wasmResponse] = await Promise.all([
    fetch(SOURA_AUDIO_DSP_MANIFEST_URL, { credentials: 'same-origin', cache: 'no-store' }),
    fetch(SOURA_AUDIO_DSP_WASM_URL, { credentials: 'same-origin', cache: 'no-store' })
  ])
  if (!manifestResponse.ok) throw new Error(`manifest fetch failed (${manifestResponse.status})`)
  if (!wasmResponse.ok) throw new Error(`wasm fetch failed (${wasmResponse.status})`)
  const manifest = await manifestResponse.json()
  if (manifest?.engineId !== SOURA_AUDIO_DSP_ENGINE_ID || manifest?.engineType !== SOURA_AUDIO_DSP_ENGINE_TYPE || manifest?.requiresWasm !== true) {
    throw new Error('manifest does not match the required Soura WASM DSP engine')
  }
  const wasmBytes = await wasmResponse.arrayBuffer()
  await WebAssembly.compile(wasmBytes)
  return manifest
}

function deinterleave(inputPcm, frames, channels) {
  const output = Array.from({ length: channels }, () => new Float32Array(frames))
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      output[channel][frame] = inputPcm[(frame * channels) + channel] || 0
    }
  }
  return output
}

function interleave(audioBuffer, frames, channels, startFrame = 0) {
  const output = new Float32Array(frames * channels)
  const offset = Math.max(0, Math.round(Number(startFrame) || 0))
  for (let channel = 0; channel < channels; channel += 1) {
    const source = audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1))
    for (let frame = 0; frame < frames; frame += 1) {
      output[(frame * channels) + channel] = source[offset + frame] || 0
    }
  }
  return output
}

function copyInterleavedToAudioBuffer(ctx, inputPcm, frames, channels, sampleRate) {
  const buffer = ctx.createBuffer(channels, frames, sampleRate)
  for (let channel = 0; channel < channels; channel += 1) {
    const target = buffer.getChannelData(channel)
    for (let frame = 0; frame < frames; frame += 1) {
      target[frame] = inputPcm[(frame * channels) + channel] || 0
    }
  }
  return buffer
}

function createOfflineContext(channels, outputFrames, sampleRate) {
  const OfflineCtx = getOfflineAudioContextCtor()
  try {
    return new OfflineCtx({
      numberOfChannels: channels,
      length: outputFrames,
      sampleRate
    })
  } catch {
    return new OfflineCtx(channels, outputFrames, sampleRate)
  }
}

function qualityToPreset(quality = 'high') {
  return String(quality || '').toLowerCase() === 'fast' ? 'cheaper' : 'default'
}

function getPitchSemitones(payload = {}) {
  return (Number(payload.semitones) || 0) + ((Number(payload.cents) || 0) / 100)
}

function getPcmStats(input = [], channels = 1) {
  const samples = input instanceof Float32Array ? input : new Float32Array(input || [])
  const channelCount = Math.max(1, Math.round(Number(channels) || 1))
  let peak = 0
  let sumSquares = 0
  let firstNonZeroFrame = -1
  let nonZeroSamples = 0
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number(samples[index]) || 0
    const abs = Math.abs(value)
    if (abs > peak) peak = abs
    if (abs > 1e-7) {
      nonZeroSamples += 1
      if (firstNonZeroFrame < 0) firstNonZeroFrame = Math.floor(index / channelCount)
    }
    sumSquares += value * value
  }
  return {
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
    firstNonZeroFrame,
    nonZeroSamples
  }
}

function shouldUseLiveInputPath(payload = {}, inputFrames, outputFrames) {
  const operation = payload.operation
  const durationMatched = Math.abs(inputFrames - outputFrames) <= 1
  if (!durationMatched) return false
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchShift || operation === SOURA_AUDIO_DSP_OPERATIONS.pitchTrace || operation === SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch) return true
  const rate = inputFrames / Math.max(1, outputFrames)
  return operation === SOURA_AUDIO_DSP_OPERATIONS.timeStretch && Math.abs(rate - 1) < 0.000001 && Math.abs(getPitchSemitones(payload)) < 0.000001
}

async function createStretchNode(ctx, channels, { liveInput = false } = {}) {
  const stretchNode = await SignalsmithStretch(ctx, {
    numberOfInputs: liveInput ? 1 : 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels]
  })
  return stretchNode
}

async function scheduleRenderWindow(stretchNode, { rate, semitones }) {
  await stretchNode.schedule({
    active: true,
    outputTime: 0,
    output: 0,
    input: 0,
    rate,
    semitones
  })
}

async function renderBufferedInputWithSignalsmith({ input, inputFrames, outputFrames, channels, sampleRate, quality, semitones }) {
  const inputChannels = deinterleave(input, inputFrames, channels)
  const ctx = createOfflineContext(channels, outputFrames, sampleRate)
  const stretchNode = await createStretchNode(ctx, channels, { liveInput: false })
  await stretchNode.configure({ preset: qualityToPreset(quality) })
  await stretchNode.dropBuffers()
  await stretchNode.addBuffers(inputChannels)
  stretchNode.connect(ctx.destination)

  const rate = Math.max(0.01, Math.min(100, inputFrames / Math.max(1, outputFrames)))
  await scheduleRenderWindow(stretchNode, {
    rate,
    semitones
  })
  const renderedBuffer = await ctx.startRendering()
  return interleave(renderedBuffer, outputFrames, channels)
}

async function renderLiveInputWithSignalsmith({ input, inputFrames, outputFrames, channels, sampleRate, quality, semitones }) {
  const probeCtx = createOfflineContext(channels, 128, sampleRate)
  const probeNode = await createStretchNode(probeCtx, channels, { liveInput: true })
  await probeNode.configure({ preset: qualityToPreset(quality) })
  const latencySeconds = Math.max(0, Number(await probeNode.latency?.()) || 0)
  try {
    probeNode.disconnect()
  } catch {}

  const renderFrames = outputFrames + Math.ceil(latencySeconds * sampleRate) + 128
  const ctx = createOfflineContext(channels, renderFrames, sampleRate)
  const sourceBuffer = copyInterleavedToAudioBuffer(ctx, input, inputFrames, channels, sampleRate)
  const source = ctx.createBufferSource()
  source.buffer = sourceBuffer

  const stretchNode = await createStretchNode(ctx, channels, { liveInput: true })
  await stretchNode.configure({ preset: qualityToPreset(quality) })
  source.connect(stretchNode)
  stretchNode.connect(ctx.destination)
  await scheduleRenderWindow(stretchNode, {
    rate: 1,
    semitones
  })
  source.start(0)

  const renderedBuffer = await ctx.startRendering()
  return interleave(renderedBuffer, outputFrames, channels, Math.round(latencySeconds * sampleRate))
}

async function renderWithLoadedSouraWasmDsp(engine, payload = {}) {
  const inputFrames = Math.max(1, Math.round(Number(payload.inputFrames) || 1))
  const outputFrames = Math.max(1, Math.round(Number(payload.outputFrames) || inputFrames))
  const channels = Math.max(1, Math.min(8, Math.round(Number(payload.channels) || 1)))
  const sampleRate = Math.max(8000, Math.round(Number(payload.sampleRate) || 44100))
  const input = payload.inputPcm instanceof Float32Array ? payload.inputPcm : new Float32Array(payload.inputPcm || [])
  const inputStats = getPcmStats(input, channels)
  const semitones = getPitchSemitones(payload)
  const renderMode = shouldUseLiveInputPath(payload, inputFrames, outputFrames) ? 'live-input' : 'buffered-input'
  const outputPcm = renderMode === 'live-input'
    ? await renderLiveInputWithSignalsmith({ input, inputFrames, outputFrames, channels, sampleRate, quality: payload.quality, semitones })
    : await renderBufferedInputWithSignalsmith({ input, inputFrames, outputFrames, channels, sampleRate, quality: payload.quality, semitones })
  const outputStats = getPcmStats(outputPcm, channels)
  if (inputStats.rms > 0.0005 && outputStats.rms < 0.00001) {
    throw new Error('Soura WASM DSP returned silent PCM output.')
  }
  setStatus({ status: 'loaded', error: '', quality: payload.quality || status.quality || 'high', ...engine })

  return {
    returnCode: 0,
    outputBuffer: outputPcm.buffer,
    outputPcm,
    outputFrames,
    channels,
    sampleRate,
    engineId: engine.engineId,
    engineLabel: engine.engineLabel,
    engineType: engine.engineType,
    engineVersion: engineManifest?.version || engine.engineVersion,
    independentPitchTime: true,
    renderMode
  }
}

function createSmokeInput({ frames, channels, sampleRate }) {
  const pcm = new Float32Array(frames * channels)
  for (let frame = 0; frame < frames; frame += 1) {
    const sample = Math.sin((frame / sampleRate) * Math.PI * 2 * 440) * 0.28
    for (let channel = 0; channel < channels; channel += 1) {
      pcm[(frame * channels) + channel] = sample
    }
  }
  return pcm
}

export async function runSouraWasmDspSmokeTest({ sampleRate = 96000, durationSeconds = 0.16, channels = 2 } = {}) {
  const engine = await preloadSouraWasmDsp()
  const frames = Math.max(1024, Math.round(sampleRate * durationSeconds))
  const inputPcm = createSmokeInput({ frames, channels, sampleRate })
  const inputStats = getPcmStats(inputPcm, channels)
  const cases = [
    { label: 'pitch +0', operation: SOURA_AUDIO_DSP_OPERATIONS.pitchShift, outputFrames: frames, semitones: 0 },
    { label: 'pitch +12', operation: SOURA_AUDIO_DSP_OPERATIONS.pitchShift, outputFrames: frames, semitones: 12 },
    { label: 'stretch 1.0', operation: SOURA_AUDIO_DSP_OPERATIONS.timeStretch, outputFrames: frames, stretchRatio: 1, semitones: 0 }
  ]
  const results = []
  for (const testCase of cases) {
    const result = await renderWithLoadedSouraWasmDsp(engine, {
      operation: testCase.operation,
      inputPcm: inputPcm.slice(),
      inputFrames: frames,
      outputFrames: testCase.outputFrames,
      channels,
      sampleRate,
      stretchRatio: testCase.stretchRatio || 1,
      semitones: testCase.semitones || 0,
      cents: 0,
      quality: 'high'
    })
    const outputStats = getPcmStats(result.outputPcm, channels)
    if (inputStats.rms > 0.0005 && outputStats.rms < 0.00001) {
      throw new Error(`Soura WASM DSP smoke test failed for ${testCase.label}: silent PCM output.`)
    }
    if (testCase.label === 'pitch +0') {
      const rmsRatio = outputStats.rms / Math.max(0.000001, inputStats.rms)
      if (rmsRatio < 0.2 || rmsRatio > 3) {
        throw new Error(`Soura WASM DSP smoke test failed for pitch +0: unexpected RMS ratio ${rmsRatio.toFixed(3)}.`)
      }
    }
    results.push({ label: testCase.label, renderMode: result.renderMode, outputRms: outputStats.rms, outputPeak: outputStats.peak })
  }
  console.info('[soura-dsp] smoke test passed', results)
  return { passed: true, results }
}

if (import.meta.env?.DEV && typeof globalThis !== 'undefined') {
  globalThis.__souraWasmDspSmokeTest = runSouraWasmDspSmokeTest
}

export function getSouraWasmDspStatusSnapshot() {
  return { ...status }
}

export function isLegacyJsDspFallbackEnabled() {
  return allowLegacyJsDspFallback
}

export async function preloadSouraWasmDsp() {
  if (initPromise) return initPromise
  setStatus({ status: 'loading', error: '' })
  initPromise = Promise.resolve()
    .then(() => {
      assertRuntimeSupport()
      return fetchRequiredWasmAsset()
    })
    .then((manifest) => {
      engineManifest = manifest
      const engine = {
        engineId: SOURA_AUDIO_DSP_ENGINE_ID,
        engineLabel: readString(manifest.engineLabel) || SOURA_AUDIO_DSP_ENGINE_LABEL,
        engineType: SOURA_AUDIO_DSP_ENGINE_TYPE,
        engineVersion: readString(manifest.version) || 'signalsmith-stretch-1.3.2'
      }
      setStatus({ status: 'loaded', error: '', ...engine })
      console.info('[soura-dsp] loaded official Signalsmith WASM engine', engine)
      return engine
    })
    .catch((err) => {
      const message = `${SOURA_AUDIO_DSP_REQUIRED_ERROR} ${err?.message || ''}`.trim()
      setStatus({ status: 'failed', error: message })
      initPromise = null
      throw new Error(message)
    })
  return initPromise
}

export async function renderWithSouraWasmDsp(payload = {}) {
  const engine = await preloadSouraWasmDsp()
  return renderWithLoadedSouraWasmDsp(engine, payload)
}
