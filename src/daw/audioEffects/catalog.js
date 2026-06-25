export const AUDIO_EFFECT_PLUGIN_PREFIX = 'soura-audio-effect'

export const AUDIO_EFFECT_PARAM_DEFAULTS = {
  eq: {
    hpEnabled: false,
    hpFrequency: 30,
    hpQ: 0.72,
    lowShelfEnabled: true,
    lowShelfFrequency: 120,
    lowShelfGain: 0,
    bell1Enabled: true,
    bell1Frequency: 420,
    bell1Gain: 0,
    bell1Q: 1,
    bell2Enabled: true,
    bell2Frequency: 1600,
    bell2Gain: 0,
    bell2Q: 1,
    bell3Enabled: true,
    bell3Frequency: 4200,
    bell3Gain: 0,
    bell3Q: 1,
    highShelfEnabled: true,
    highShelfFrequency: 8200,
    highShelfGain: 0,
    lpEnabled: false,
    lpFrequency: 18000,
    lpQ: 0.72,
    eqSelectedBand: 'bell1',
    outputGain: 0
  },
  reverb: {
    mix: 0.18,
    decay: 2.4,
    preDelay: 0.025,
    damping: 6800,
    size: 0.62,
    width: 0.72,
    outputGain: 0
  },
  delay: {
    mix: 0.22,
    time: 0.28,
    sync: false,
    noteDivision: '1/8',
    feedback: 0.32,
    lowCut: 120,
    highCut: 7200,
    pingPong: false,
    outputGain: 0
  },
  compressor: {
    threshold: -24,
    ratio: 3,
    attack: 0.012,
    release: 0.18,
    knee: 18,
    makeupGain: 0,
    outputGain: 0
  },
  limiter: {
    ceiling: -1,
    release: 0.08,
    inputGain: 0,
    outputGain: 0
  },
  distortion: {
    drive: 0.32,
    tone: 6800,
    mix: 0.55,
    outputGain: 0
  },
  chorus: {
    rate: 0.85,
    depth: 0.42,
    delay: 0.018,
    feedback: 0.12,
    mix: 0.36,
    outputGain: 0
  },
  phaser: {
    rate: 0.42,
    depth: 0.56,
    feedback: 0.18,
    stages: 4,
    mix: 0.42,
    outputGain: 0
  },
  flanger: {
    rate: 0.24,
    depth: 0.48,
    delay: 0.004,
    feedback: 0.28,
    mix: 0.32,
    outputGain: 0
  },
  tremolo: {
    rate: 4.2,
    depth: 0.48,
    mix: 0.7,
    outputGain: 0
  },
  filter: {
    type: 'lowpass',
    cutoff: 6800,
    resonance: 0.72,
    gain: 0,
    outputGain: 0
  },
  'stereo-imager': {
    width: 1,
    outputGain: 0
  }
}

export const AUDIO_EFFECT_MANIFESTS = [
  { id: 'eq', name: 'EQ', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:eq`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.eq },
  { id: 'reverb', name: 'Reverb', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:reverb`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.reverb },
  { id: 'delay', name: 'Delay', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:delay`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.delay },
  { id: 'compressor', name: 'Compressor', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:compressor`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.compressor },
  { id: 'limiter', name: 'Limiter', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:limiter`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.limiter },
  { id: 'distortion', name: 'Distortion', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:distortion`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.distortion },
  { id: 'chorus', name: 'Chorus', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:chorus`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.chorus },
  { id: 'phaser', name: 'Phaser', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:phaser`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.phaser },
  { id: 'flanger', name: 'Flanger', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:flanger`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.flanger },
  { id: 'tremolo', name: 'Tremolo', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:tremolo`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.tremolo },
  { id: 'filter', name: 'Filter', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:filter`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.filter },
  { id: 'stereo-imager', name: 'Stereo Imager', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:stereo-imager`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS['stereo-imager'] },
  { id: 'noise-gate', name: 'Noise Gate', category: 'audio-effect', implemented: false },
  { id: 'utility-gain', name: 'Utility / Gain', category: 'audio-effect', implemented: false }
]

export function getAudioEffectManifest(effectType = '') {
  return AUDIO_EFFECT_MANIFESTS.find((manifest) => manifest.id === effectType) || null
}

export function getAudioEffectDefaultParams(effectType = '') {
  return { ...(getAudioEffectManifest(effectType)?.defaultParams || {}) }
}

export function getAudioEffectPluginType(effectType = '') {
  return getAudioEffectManifest(effectType)?.pluginType || ''
}

export function getAudioEffectTypeFromPlugin(pluginType = '') {
  const type = String(pluginType || '').startsWith(`${AUDIO_EFFECT_PLUGIN_PREFIX}:`)
    ? String(pluginType).slice(AUDIO_EFFECT_PLUGIN_PREFIX.length + 1)
    : ''
  return getAudioEffectManifest(type)?.id || ''
}

export function isImplementedAudioEffect(effectType = '') {
  return getAudioEffectManifest(effectType)?.implemented === true
}
