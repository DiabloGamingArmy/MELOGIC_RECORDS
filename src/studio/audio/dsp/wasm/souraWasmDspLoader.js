import {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_ENGINE_TYPE,
  SOURA_AUDIO_DSP_REQUIRED_ERROR,
  SOURA_AUDIO_DSP_WASM_URL
} from '../audioDspTypes.js'

let enginePromise = null

function readCString(memory, ptr = 0) {
  const bytes = new Uint8Array(memory.buffer)
  let end = ptr
  while (end < bytes.length && bytes[end] !== 0) end += 1
  return new TextDecoder().decode(bytes.slice(ptr, end))
}

async function instantiateWasm(url = SOURA_AUDIO_DSP_WASM_URL) {
  const imports = {
    env: {
      soura_pitch_ratio: (semitones = 0, cents = 0) => 2 ** (((Number(semitones) || 0) + ((Number(cents) || 0) / 100)) / 12)
    }
  }
  try {
    if (WebAssembly.instantiateStreaming) {
      const response = await fetch(url, { credentials: 'same-origin' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      try {
        return await WebAssembly.instantiateStreaming(response, imports)
      } catch {
        const buffer = await (await fetch(url, { credentials: 'same-origin' })).arrayBuffer()
        return WebAssembly.instantiate(buffer, imports)
      }
    }
    const response = await fetch(url, { credentials: 'same-origin' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return WebAssembly.instantiate(await response.arrayBuffer(), imports)
  } catch (err) {
    throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} ${err?.message || ''}`.trim())
  }
}

export async function loadSouraWasmDspEngine() {
  if (enginePromise) return enginePromise
  enginePromise = instantiateWasm().then(({ instance }) => {
    const exports = instance.exports || {}
    const memory = exports.memory
    if (!memory || typeof exports.soura_render_time_stretch !== 'function' || typeof exports.soura_render_pitch_shift !== 'function') {
      throw new Error('Soura WASM DSP engine is missing required exports.')
    }
    const engineId = readCString(memory, exports.soura_dsp_engine_id())
    const engineVersion = readCString(memory, exports.soura_dsp_engine_version())
    if (engineId !== SOURA_AUDIO_DSP_ENGINE_ID) {
      throw new Error(`Unexpected Soura WASM DSP engine id: ${engineId || 'unknown'}`)
    }
    console.info('[soura-dsp] loaded WASM engine signalsmith', { engineId, engineVersion })
    return {
      exports,
      memory,
      engineId,
      engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
      engineType: SOURA_AUDIO_DSP_ENGINE_TYPE,
      engineVersion
    }
  }).catch((err) => {
    enginePromise = null
    throw err
  })
  return enginePromise
}
