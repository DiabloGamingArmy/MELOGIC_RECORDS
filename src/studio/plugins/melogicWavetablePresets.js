export const MELOGIC_WAVETABLE_PRESETS = [
  {
    id: 'init',
    instrumentType: 'melogic-wavetable',
    name: 'Init Patch',
    author: 'Melogic',
    version: 1,
    params: {
      wavetableId: 'builtin-saw',
      wavetablePosition: 0.35,
      coarsePitch: 0,
      finePitch: 0,
      unisonVoices: 1,
      detune: 0.08,
      oscLevel: 0.85,
      filterEnabled: true,
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
      volume: 0.45
    }
  },
  {
    id: 'bass-test',
    instrumentType: 'melogic-wavetable',
    name: 'Bass Test',
    author: 'Melogic',
    version: 1,
    params: {
      wavetableId: 'builtin-square',
      wavetablePosition: 0.2,
      coarsePitch: -12,
      finePitch: 0,
      unisonVoices: 1,
      detune: 0.04,
      oscLevel: 0.95,
      filterEnabled: true,
      filterType: 'lowpass',
      filterCutoff: 0.38,
      resonance: 0.34,
      attack: 0.008,
      decay: 0.12,
      sustain: 0.76,
      release: 0.18,
      lfoRate: 0.18,
      lfoShape: 'triangle',
      lfoAmount: 0.12,
      lfoTarget: 'filterCutoff',
      volume: 0.52
    }
  },
  {
    id: 'pluck-test',
    instrumentType: 'melogic-wavetable',
    name: 'Pluck Test',
    author: 'Melogic',
    version: 1,
    params: {
      wavetableId: 'builtin-digital-glass',
      wavetablePosition: 0.7,
      coarsePitch: 0,
      finePitch: 4,
      unisonVoices: 1,
      detune: 0.12,
      oscLevel: 0.78,
      filterEnabled: true,
      filterType: 'bandpass',
      filterCutoff: 0.58,
      resonance: 0.42,
      attack: 0.004,
      decay: 0.22,
      sustain: 0.12,
      release: 0.34,
      lfoRate: 0.52,
      lfoShape: 'sine',
      lfoAmount: 0.08,
      lfoTarget: 'wavetablePosition',
      volume: 0.46
    }
  },
  {
    id: 'pad-test',
    instrumentType: 'melogic-wavetable',
    name: 'Pad Test',
    author: 'Melogic',
    version: 1,
    params: {
      wavetableId: 'builtin-triangle',
      wavetablePosition: 0.55,
      coarsePitch: 0,
      finePitch: -3,
      unisonVoices: 3,
      detune: 0.2,
      oscLevel: 0.72,
      filterEnabled: true,
      filterType: 'lowpass',
      filterCutoff: 0.52,
      resonance: 0.12,
      attack: 0.42,
      decay: 0.8,
      sustain: 0.82,
      release: 1.4,
      lfoRate: 0.14,
      lfoShape: 'triangle',
      lfoAmount: 0.18,
      lfoTarget: 'pitch',
      volume: 0.4
    }
  }
]

export function getMelogicWavetablePreset(idOrName = '') {
  const clean = String(idOrName || '').trim().toLowerCase()
  return MELOGIC_WAVETABLE_PRESETS.find((preset) => preset.id.toLowerCase() === clean || preset.name.toLowerCase() === clean) || MELOGIC_WAVETABLE_PRESETS[0]
}
