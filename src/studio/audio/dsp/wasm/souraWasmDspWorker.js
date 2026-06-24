import { SOURA_AUDIO_DSP_OPERATIONS, SOURA_AUDIO_DSP_REQUIRED_ERROR } from '../audioDspTypes.js'
import { loadSouraWasmDspEngine } from './souraWasmDspLoader.js'

let loadedEngine = null

function qualityToMode(quality = 'high') {
  const value = String(quality || '').toLowerCase()
  if (value === 'fast') return 0
  if (value === 'studio') return 2
  return 1
}

function ensureMemory(memory, bytesNeeded = 0) {
  const pagesNeeded = Math.ceil(Math.max(0, bytesNeeded + 4096) / 65536)
  const currentPages = Math.floor(memory.buffer.byteLength / 65536)
  if (pagesNeeded > currentPages) memory.grow(pagesNeeded - currentPages)
}

async function getEngine() {
  loadedEngine ||= await loadSouraWasmDspEngine()
  return loadedEngine
}

async function render(payload = {}) {
  const engine = await getEngine()
  const exports = engine.exports
  const memory = engine.memory
  const inputFrames = Math.max(1, Number(payload.inputFrames) || 1)
  const channels = Math.max(1, Number(payload.channels) || 1)
  const outputFrames = Math.max(1, Number(payload.outputFrames) || inputFrames)
  const inputSamples = inputFrames * channels
  const outputSamples = outputFrames * channels
  const inputBytes = inputSamples * 4
  const outputBytes = outputSamples * 4
  ensureMemory(memory, inputBytes + outputBytes + 8192)
  exports.soura_reset_heap?.()
  const inputPtr = exports.soura_malloc(inputBytes)
  const outputPtr = exports.soura_malloc(outputBytes)
  const heap = new Float32Array(memory.buffer)
  heap.set(new Float32Array(payload.inputBuffer), inputPtr / 4)
  const qualityMode = qualityToMode(payload.quality)
  let resultCode = -99
  if (payload.operation === SOURA_AUDIO_DSP_OPERATIONS.timeStretch) {
    resultCode = exports.soura_render_time_stretch(
      inputPtr,
      inputFrames,
      channels,
      Math.max(1, Number(payload.sampleRate) || 44100),
      Number(payload.stretchRatio) || 1,
      outputPtr,
      outputFrames,
      qualityMode
    )
  } else if (payload.operation === SOURA_AUDIO_DSP_OPERATIONS.pitchShift) {
    resultCode = exports.soura_render_pitch_shift(
      inputPtr,
      inputFrames,
      channels,
      Math.max(1, Number(payload.sampleRate) || 44100),
      Number(payload.semitones) || 0,
      Number(payload.cents) || 0,
      outputPtr,
      outputFrames,
      qualityMode
    )
  } else if (payload.operation === SOURA_AUDIO_DSP_OPERATIONS.pitchTrace) {
    resultCode = exports.soura_render_pitch_shift(
      inputPtr,
      inputFrames,
      channels,
      Math.max(1, Number(payload.sampleRate) || 44100),
      Number(payload.semitones) || 0,
      Number(payload.cents) || 0,
      outputPtr,
      outputFrames,
      qualityMode
    )
  } else {
    throw new Error(`Unsupported Soura WASM DSP operation: ${payload.operation}`)
  }
  if (resultCode !== 0) throw new Error(`Soura WASM DSP render failed with code ${resultCode}.`)
  const rendered = new Float32Array(memory.buffer, outputPtr, outputSamples).slice()
  exports.soura_free?.(inputPtr)
  exports.soura_free?.(outputPtr)
  return {
    outputBuffer: rendered.buffer,
    outputFrames,
    channels,
    sampleRate: Math.max(1, Number(payload.sampleRate) || 44100),
    engineId: engine.engineId,
    engineLabel: engine.engineLabel,
    engineType: engine.engineType,
    engineVersion: engine.engineVersion
  }
}

self.onmessage = async (event) => {
  const { id, type, payload } = event.data || {}
  try {
    if (type === 'init') {
      const engine = await getEngine()
      self.postMessage({ id, ok: true, result: {
        engineId: engine.engineId,
        engineLabel: engine.engineLabel,
        engineType: engine.engineType,
        engineVersion: engine.engineVersion
      } })
      return
    }
    if (type === 'render') {
      const result = await render(payload)
      self.postMessage({ id, ok: true, result }, [result.outputBuffer])
      return
    }
    throw new Error(`Unknown Soura WASM DSP worker message: ${type}`)
  } catch (err) {
    self.postMessage({ id, ok: false, error: err?.message || SOURA_AUDIO_DSP_REQUIRED_ERROR })
  }
}
