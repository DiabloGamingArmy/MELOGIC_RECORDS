export const DAW_PLUGIN_TYPES = {
  melogicWavetable: 'melogic-wavetable',
  librarySampler: 'library-sampler'
}

export const DAW_PLUGIN_DEFINITIONS = {
  [DAW_PLUGIN_TYPES.librarySampler]: {
    pluginType: DAW_PLUGIN_TYPES.librarySampler,
    title: 'Library',
    status: 'Track instrument',
    defaultSize: { width: 720, height: 480 },
    defaultParams: {
      libraryInstrumentId: '',
      libraryInstrumentName: '',
      libraryInstrumentVersion: 1,
      volume: 0.8,
      attack: 0.006,
      release: 0.16
    }
  },
  [DAW_PLUGIN_TYPES.melogicWavetable]: {
    pluginType: DAW_PLUGIN_TYPES.melogicWavetable,
    title: 'Melogic Wavetable',
    status: 'Web Audio prototype',
    defaultSize: { width: 1100, height: 762 },
    fixedFrame: { width: 1100, height: 720, minScale: 0.75, maxScale: 1.25, headerHeight: 42 },
    defaultParams: {
      mwtPage: 'osc',
      preset: 'init',
      wavetableId: 'builtin-saw',
      wavetablePosition: 0.35,
      oscEnabled: true,
      octave: 0,
      coarsePitch: 0,
      finePitch: 0,
      unisonVoices: 1,
      detune: 0.08,
      unisonBlend: 1,
      phase: 0,
      phaseRandom: 0.15,
      oscLevel: 0.85,
      oscPan: 0,
      oscCount: 1,
      selectedOsc: 1,
      fxRack: '',
      selectedFx: '',
      filterEnabled: false,
      filterType: 'lowpass',
      filterCutoff: 0.72,
      resonance: 0.18,
      attack: 0.02,
      decay: 0.16,
      sustain: 0.68,
      release: 0.24,
      lfoRate: 0.35,
      lfoShape: 'sine',
      lfoAmount: 0,
      lfoTarget: 'none',
      macro1: 0,
      macro2: 0,
      macro3: 0,
      macro4: 0,
      modulationMatrix: [
        { source: 'lfo1', target: 'filter.cutoff', amount: 0, bipolar: true, curve: 'linear', enabled: false },
        { source: 'macro1', target: 'filter.cutoff', amount: 0, bipolar: false, curve: 'linear', enabled: false }
      ],
      modSource: 'lfo1',
      assetBrowserType: 'wavetable',
      assetBrowserPack: '',
      assetBrowserTag: '',
      assetBrowserSearch: '',
      qualityMode: 'Balanced',
      oversampling: '1x',
      voiceMode: 'Poly',
      legato: false,
      velocityResponse: 0.65,
      cpuSafety: true,
      volume: 0.45
    }
  }
}

export function getDawPluginDefinition(pluginType = '') {
  return DAW_PLUGIN_DEFINITIONS[pluginType] || DAW_PLUGIN_DEFINITIONS[DAW_PLUGIN_TYPES.melogicWavetable]
}

export function createDawPluginInstance({ pluginType = DAW_PLUGIN_TYPES.melogicWavetable, trackId = 'demo-track', instanceId = '', params = {} } = {}) {
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
    params: { ...definition.defaultParams, ...(params || {}) }
  }
}
