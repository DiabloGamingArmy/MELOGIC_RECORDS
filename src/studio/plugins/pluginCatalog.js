export const DAW_PLUGIN_TYPES = {
  melogicWavetable: 'melogic-wavetable'
}

export const DAW_PLUGIN_DEFINITIONS = {
  [DAW_PLUGIN_TYPES.melogicWavetable]: {
    pluginType: DAW_PLUGIN_TYPES.melogicWavetable,
    title: 'Melogic Wavetable',
    status: 'Web Audio prototype',
    defaultSize: { width: 820, height: 560 },
    defaultParams: {
      preset: 'Init Patch',
      oscillatorType: 'sawtooth',
      volume: 0.45,
      attack: 0.02,
      decay: 0.14,
      sustain: 0.62,
      release: 0.24,
      filterCutoff: 0.62,
      lfoRate: 0.25
    }
  }
}

export function getDawPluginDefinition(pluginType = '') {
  return DAW_PLUGIN_DEFINITIONS[pluginType] || DAW_PLUGIN_DEFINITIONS[DAW_PLUGIN_TYPES.melogicWavetable]
}

export function createDawPluginInstance({ pluginType = DAW_PLUGIN_TYPES.melogicWavetable, trackId = 'demo-track', instanceId = '' } = {}) {
  const definition = getDawPluginDefinition(pluginType)
  const pluginInstanceId = instanceId || `${definition.pluginType}:${trackId || 'track'}`
  return {
    pluginInstanceId,
    pluginType: definition.pluginType,
    title: definition.title,
    trackId,
    detached: false,
    minimized: false,
    windowPosition: { x: 96, y: 92 },
    windowSize: { ...definition.defaultSize },
    params: { ...definition.defaultParams }
  }
}
