import { getBuiltInWavetable } from './wavetableAssets.js'

const FILTER_TYPES = new Set(['lowpass', 'highpass', 'bandpass'])
const LFO_SHAPES = new Set(['sine', 'triangle', 'square', 'sawtooth'])
const LFO_TARGETS = new Set(['none', 'wavetablePosition', 'filterCutoff', 'pitch'])

function clamp(value, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : min
  return Math.min(max, Math.max(min, numeric))
}

function midiToFrequency(note) {
  return 440 * (2 ** ((Number(note) - 69) / 12))
}

function cutoffToFrequency(value) {
  const normalized = clamp(value, 0, 1)
  return 40 * (2 ** (normalized * 9.2))
}

function pickFrame(frames, position = 0) {
  if (!frames?.length) return null
  const index = Math.round(clamp(position, 0, 1) * (frames.length - 1))
  return frames[index] || frames[0]
}

export class BasicSynthInstrument {
  constructor({ id, type, trackId, audioContext, destination, params = {} } = {}) {
    if (!audioContext) throw new Error('AudioContext is required for BasicSynthInstrument.')
    this.id = id
    this.type = type
    this.trackId = trackId
    this.audioContext = audioContext
    this.outputNode = audioContext.createGain()
    this.outputNode.connect(destination || audioContext.destination)
    this.periodicWaveCache = new Map()
    this.voices = new Map()
    this.params = this.normalizeParams(params)
    this.outputNode.gain.value = this.params.volume
  }

  normalizeParams(params = {}) {
    return {
      wavetableId: String(params.wavetableId || 'builtin-saw'),
      wavetablePosition: clamp(params.wavetablePosition ?? 0.35, 0, 1),
      coarsePitch: clamp(params.coarsePitch ?? 0, -24, 24),
      finePitch: clamp(params.finePitch ?? 0, -100, 100),
      unisonVoices: clamp(Math.round(Number(params.unisonVoices ?? 1)), 1, 5),
      detune: clamp(params.detune ?? 0.08, 0, 1),
      oscLevel: clamp(params.oscLevel ?? 0.85, 0, 1),
      filterEnabled: params.filterEnabled !== false && params.filterEnabled !== 'false',
      filterType: FILTER_TYPES.has(params.filterType) ? params.filterType : 'lowpass',
      filterCutoff: clamp(params.filterCutoff ?? 0.72, 0, 1),
      resonance: clamp(params.resonance ?? 0.18, 0, 1),
      attack: clamp(params.attack ?? 0.02, 0.001, 4),
      decay: clamp(params.decay ?? 0.16, 0.001, 4),
      sustain: clamp(params.sustain ?? 0.68, 0, 1),
      release: clamp(params.release ?? 0.24, 0.01, 6),
      lfoRate: clamp(params.lfoRate ?? 0.35, 0.01, 20),
      lfoShape: LFO_SHAPES.has(params.lfoShape) ? params.lfoShape : 'sine',
      lfoAmount: clamp(params.lfoAmount ?? 0, 0, 1),
      lfoTarget: LFO_TARGETS.has(params.lfoTarget) ? params.lfoTarget : 'none',
      volume: clamp(params.volume ?? 0.45, 0, 1)
    }
  }

  async ensureRunning() {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()
  }

  getPeriodicWave() {
    const wavetable = getBuiltInWavetable(this.params.wavetableId)
    const frameIndex = Math.round(this.params.wavetablePosition * Math.max(0, wavetable.frames.length - 1))
    const cacheKey = `${wavetable.assetId}:${frameIndex}`
    if (this.periodicWaveCache.has(cacheKey)) return this.periodicWaveCache.get(cacheKey)
    const frame = pickFrame(wavetable.frames, this.params.wavetablePosition)
    const wave = this.audioContext.createPeriodicWave(frame.real, frame.imag, { disableNormalization: false })
    this.periodicWaveCache.set(cacheKey, wave)
    return wave
  }

  noteOn(note, velocity = 0.8) {
    const midi = Number(note)
    if (!Number.isFinite(midi)) return
    this.noteOff(midi, { immediate: true })
    const now = this.audioContext.currentTime
    const velocityGain = clamp(velocity, 0, 1)
    const envelope = this.audioContext.createGain()
    const filter = this.audioContext.createBiquadFilter()
    const voiceGain = this.audioContext.createGain()
    const lfo = this.createLfo()
    const oscillators = []
    const unison = this.params.unisonVoices
    const baseFrequency = midiToFrequency(midi + this.params.coarsePitch)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocityGain), now + this.params.attack)
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, this.params.sustain * velocityGain), now + this.params.attack + this.params.decay)
    filter.type = this.params.filterType
    filter.frequency.setValueAtTime(cutoffToFrequency(this.params.filterCutoff), now)
    filter.Q.setValueAtTime(clamp(this.params.resonance * 24, 0.0001, 24), now)
    voiceGain.gain.setValueAtTime(this.params.oscLevel / Math.max(1, unison), now)

    for (let index = 0; index < unison; index += 1) {
      const oscillator = this.audioContext.createOscillator()
      oscillator.setPeriodicWave(this.getPeriodicWave())
      const spread = unison === 1 ? 0 : index - ((unison - 1) / 2)
      oscillator.melogicSpread = spread
      oscillator.frequency.setValueAtTime(baseFrequency, now)
      oscillator.detune.setValueAtTime(this.params.finePitch + (spread * this.params.detune * 28), now)
      if (lfo && this.params.lfoTarget === 'pitch') lfo.gain.connect(oscillator.detune)
      oscillator.connect(voiceGain)
      oscillator.start(now)
      oscillators.push(oscillator)
    }

    if (lfo && this.params.lfoTarget === 'filterCutoff') lfo.gain.connect(filter.frequency)
    voiceGain.connect(envelope)
    if (this.params.filterEnabled) {
      envelope.connect(filter)
      filter.connect(this.outputNode)
    } else {
      envelope.connect(this.outputNode)
    }
    lfo?.oscillator.start(now)
    this.voices.set(midi, { midi, oscillators, envelope, filter, voiceGain, lfo })
  }

  createLfo() {
    if (this.params.lfoTarget === 'none' || this.params.lfoAmount <= 0) return null
    const oscillator = this.audioContext.createOscillator()
    const gain = this.audioContext.createGain()
    oscillator.type = this.params.lfoShape
    oscillator.frequency.value = this.params.lfoRate
    const depth = this.params.lfoTarget === 'pitch'
      ? this.params.lfoAmount * 40
      : this.params.lfoTarget === 'filterCutoff'
        ? this.params.lfoAmount * 1800
        : 0
    gain.gain.value = depth
    oscillator.connect(gain)
    return { oscillator, gain }
  }

  noteOff(note, { immediate = false } = {}) {
    const midi = Number(note)
    const voice = this.voices.get(midi)
    if (!voice) return
    const now = this.audioContext.currentTime
    const release = immediate ? 0.015 : this.params.release
    voice.envelope.gain.cancelScheduledValues(now)
    voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.envelope.gain.value), now)
    voice.envelope.gain.exponentialRampToValueAtTime(0.0001, now + release)
    voice.oscillators.forEach((oscillator) => oscillator.stop(now + release + 0.02))
    voice.lfo?.oscillator.stop(now + release + 0.02)
    window.setTimeout(() => {
      try {
        voice.oscillators.forEach((oscillator) => oscillator.disconnect())
        voice.envelope.disconnect()
        voice.filter.disconnect()
        voice.voiceGain.disconnect()
        voice.lfo?.oscillator.disconnect()
        voice.lfo?.gain.disconnect()
      } catch {
        // Voice may already be disconnected.
      }
    }, Math.ceil((release + 0.05) * 1000))
    this.voices.delete(midi)
  }

  setParam(name, value) {
    const nextParams = this.normalizeParams({ ...this.params, [name]: value })
    this.params = nextParams
    const now = this.audioContext.currentTime
    if (name === 'volume') this.outputNode.gain.setTargetAtTime(this.params.volume, now, 0.015)
    this.voices.forEach((voice) => {
      if (['wavetableId', 'wavetablePosition'].includes(name)) {
        voice.oscillators.forEach((oscillator) => oscillator.setPeriodicWave(this.getPeriodicWave()))
      }
      if (['coarsePitch', 'finePitch', 'detune'].includes(name)) {
        const baseFrequency = midiToFrequency((voice.midi ?? 60) + this.params.coarsePitch)
        voice.oscillators.forEach((oscillator) => {
          oscillator.frequency.setTargetAtTime(baseFrequency, now, 0.02)
          oscillator.detune.setTargetAtTime(this.params.finePitch + ((oscillator.melogicSpread || 0) * this.params.detune * 28), now, 0.02)
        })
      }
      if (name === 'oscLevel') voice.voiceGain.gain.setTargetAtTime(this.params.oscLevel / Math.max(1, this.params.unisonVoices), now, 0.015)
      if (name === 'filterType') voice.filter.type = this.params.filterType
      if (name === 'filterCutoff') voice.filter.frequency.setTargetAtTime(cutoffToFrequency(this.params.filterCutoff), now, 0.025)
      if (name === 'resonance') voice.filter.Q.setTargetAtTime(clamp(this.params.resonance * 24, 0.0001, 24), now, 0.025)
      if (name === 'filterEnabled') {
        // Routing changes are applied on the next note to avoid audible graph pops.
      }
    })
  }

  dispose() {
    Array.from(this.voices.keys()).forEach((note) => this.noteOff(note, { immediate: true }))
    try {
      this.outputNode.disconnect()
    } catch {
      // Already disconnected.
    }
    this.voices.clear()
    this.periodicWaveCache.clear()
  }
}
