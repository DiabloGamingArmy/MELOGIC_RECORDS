import { SOURA_AUDIO_DSP_REQUIRED_ERROR } from './dsp/audioDspTypes.js'

export async function renderPitchShiftedAudio() {
  throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} Legacy non-WASM pitch rendering is disabled in production.`)
}

export async function renderPitchTraceEdits() {
  throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} Legacy non-WASM Pitch Trace rendering is disabled in production.`)
}
