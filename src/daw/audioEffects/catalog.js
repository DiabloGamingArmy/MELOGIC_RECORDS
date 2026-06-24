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
    highShelfEnabled: true,
    highShelfFrequency: 8200,
    highShelfGain: 0,
    lpEnabled: false,
    lpFrequency: 18000,
    lpQ: 0.72,
    outputGain: 0
  },
  reverb: {
    mix: 0.18,
    decay: 2.4,
    preDelay: 0.025,
    damping: 6800,
    size: 0.62,
    outputGain: 0
  },
  delay: {
    mix: 0.22,
    time: 0.28,
    feedback: 0.32,
    lowCut: 120,
    highCut: 7200,
    outputGain: 0
  }
}

export const AUDIO_EFFECT_MANIFESTS = [
  { id: 'eq', name: 'EQ', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:eq`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.eq },
  { id: 'reverb', name: 'Reverb', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:reverb`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.reverb },
  { id: 'delay', name: 'Delay', category: 'audio-effect', implemented: true, pluginType: `${AUDIO_EFFECT_PLUGIN_PREFIX}:delay`, defaultParams: AUDIO_EFFECT_PARAM_DEFAULTS.delay },
  { id: 'compressor', name: 'Compressor', category: 'audio-effect', implemented: false },
  { id: 'limiter', name: 'Limiter', category: 'audio-effect', implemented: false },
  { id: 'distortion', name: 'Distortion', category: 'audio-effect', implemented: false },
  { id: 'chorus', name: 'Chorus', category: 'audio-effect', implemented: false },
  { id: 'phaser', name: 'Phaser', category: 'audio-effect', implemented: false },
  { id: 'flanger', name: 'Flanger', category: 'audio-effect', implemented: false },
  { id: 'stereo-imager', name: 'Stereo Imager', category: 'audio-effect', implemented: false },
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
