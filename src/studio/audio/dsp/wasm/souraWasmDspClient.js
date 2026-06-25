import SignalsmithStretch from './vendor/SignalsmithStretch.mjs'
import {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  SOURA_AUDIO_DSP_ENGINE_TYPE,
  SOURA_AUDIO_DSP_MANIFEST_URL,
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

function interleave(audioBuffer, frames, channels) {
  const output = new Float32Array(frames * channels)
  for (let channel = 0; channel < channels; channel += 1) {
    const source = audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1))
    for (let frame = 0; frame < frames; frame += 1) {
      output[(frame * channels) + channel] = source[frame] || 0
    }
  }
  return output
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

function getPcmStats(input = []) {
  const samples = input instanceof Float32Array ? input : new Float32Array(input || [])
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
      if (firstNonZeroFrame < 0) firstNonZeroFrame = index
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
  const inputFrames = Math.max(1, Math.round(Number(payload.inputFrames) || 1))
  const outputFrames = Math.max(1, Math.round(Number(payload.outputFrames) || inputFrames))
  const channels = Math.max(1, Math.min(8, Math.round(Number(payload.channels) || 1)))
  const sampleRate = Math.max(8000, Math.round(Number(payload.sampleRate) || 44100))
  const input = payload.inputPcm instanceof Float32Array ? payload.inputPcm : new Float32Array(payload.inputPcm || [])
  const inputStats = getPcmStats(input)
  const inputChannels = deinterleave(input, inputFrames, channels)
  const ctx = createOfflineContext(channels, outputFrames, sampleRate)
  const stretchNode = await SignalsmithStretch(ctx, {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [channels]
  })
  await stretchNode.configure({ preset: qualityToPreset(payload.quality) })
  await stretchNode.dropBuffers()
  await stretchNode.addBuffers(inputChannels)
  stretchNode.connect(ctx.destination)

  const rate = Math.max(0.01, Math.min(100, inputFrames / outputFrames))
  const semitones = getPitchSemitones(payload)
  const latencySeconds = Math.max(0, Number(await stretchNode.latency?.()) || 0)
  await stretchNode.schedule({
    active: true,
    output: 0,
    input: -latencySeconds,
    rate,
    semitones
  })
  await stretchNode.schedule({
    active: false,
    output: (outputFrames / sampleRate) + latencySeconds,
    input: inputFrames / sampleRate,
    rate,
    semitones
  })
  const renderedBuffer = await ctx.startRendering()
  const outputPcm = interleave(renderedBuffer, outputFrames, channels)
  const outputStats = getPcmStats(outputPcm)
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
    independentPitchTime: true
  }
}
