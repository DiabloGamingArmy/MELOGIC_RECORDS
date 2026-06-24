export const SOURA_AUDIO_DSP_ENGINE_ID = 'soura-wasm-signalsmith-v1'
export const SOURA_AUDIO_DSP_ENGINE_LABEL = 'Soura WASM DSP: Signalsmith Stretch'
export const SOURA_AUDIO_DSP_ENGINE_TYPE = 'wasm'
export const SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM = true
export const SOURA_AUDIO_DSP_WASM_URL = '/wasm/soura-dsp/soura_signalsmith.wasm'
export const SOURA_AUDIO_DSP_MANIFEST_URL = '/wasm/soura-dsp/soura-dsp-engine.json'
export const SOURA_AUDIO_DSP_REQUIRED_ERROR = 'WASM DSP engine is required for pitch/stretch rendering and failed to load.'

export const SOURA_AUDIO_DSP_OPERATIONS = {
  timeStretch: 'time_stretch',
  pitchShift: 'pitch_shift',
  pitchAndStretch: 'combined_pitch_time',
  pitchTrace: 'pitch_trace'
}
