const VALID_OSCILLATORS = new Set(['sine', 'sawtooth', 'square', 'triangle'])

function clamp(value, min, max) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : min
  return Math.min(max, Math.max(min, numeric))
}

function midiToFrequency(note) {
  return 440 * (2 ** ((Number(note) - 69) / 12))
}

export class BasicSynthInstrument {
  constructor({ id, type, trackId, audioContext, destination, params = {} } = {}) {
    if (!audioContext) throw new Error('AudioContext is required for BasicSynthInstrument.')
    this.id = id
    this.type = type
    this.trackId = trackId
    this.audioContext = audioContext
    this.outputNode = audioContext.createGain()
    this.outputNode.gain.value = clamp(params.volume ?? 0.45, 0, 1)
    this.outputNode.connect(destination || audioContext.destination)
    this.params = {
      oscillatorType: VALID_OSCILLATORS.has(params.oscillatorType) ? params.oscillatorType : 'sawtooth',
      volume: clamp(params.volume ?? 0.45, 0, 1),
      attack: clamp(params.attack ?? 0.02, 0.001, 4),
      decay: clamp(params.decay ?? 0.14, 0.001, 4),
      sustain: clamp(params.sustain ?? 0.62, 0, 1),
      release: clamp(params.release ?? 0.24, 0.01, 6)
    }
    this.voices = new Map()
  }

  async ensureRunning() {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()
  }

  noteOn(note, velocity = 0.8) {
    const midi = Number(note)
    if (!Number.isFinite(midi)) return
    this.noteOff(midi, { immediate: true })
    const now = this.audioContext.currentTime
    const oscillator = this.audioContext.createOscillator()
    const envelope = this.audioContext.createGain()
    const velocityGain = clamp(velocity, 0, 1)
    oscillator.type = this.params.oscillatorType
    oscillator.frequency.setValueAtTime(midiToFrequency(midi), now)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, velocityGain), now + this.params.attack)
    envelope.gain.linearRampToValueAtTime(Math.max(0.0001, this.params.sustain * velocityGain), now + this.params.attack + this.params.decay)
    oscillator.connect(envelope)
    envelope.connect(this.outputNode)
    oscillator.start(now)
    this.voices.set(midi, { oscillator, envelope })
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
    voice.oscillator.stop(now + release + 0.02)
    window.setTimeout(() => {
      try {
        voice.oscillator.disconnect()
        voice.envelope.disconnect()
      } catch {
        // Already disconnected or stopped.
      }
    }, Math.ceil((release + 0.05) * 1000))
    this.voices.delete(midi)
  }

  setParam(name, value) {
    if (name === 'oscillatorType') {
      const nextType = VALID_OSCILLATORS.has(value) ? value : this.params.oscillatorType
      this.params.oscillatorType = nextType
      this.voices.forEach((voice) => {
        voice.oscillator.type = nextType
      })
      return
    }
    if (name === 'volume') {
      this.params.volume = clamp(value, 0, 1)
      this.outputNode.gain.setTargetAtTime(this.params.volume, this.audioContext.currentTime, 0.015)
      return
    }
    if (name === 'attack') this.params.attack = clamp(value, 0.001, 4)
    if (name === 'decay') this.params.decay = clamp(value, 0.001, 4)
    if (name === 'sustain') this.params.sustain = clamp(value, 0, 1)
    if (name === 'release') this.params.release = clamp(value, 0.01, 6)
  }

  dispose() {
    Array.from(this.voices.keys()).forEach((note) => this.noteOff(note, { immediate: true }))
    try {
      this.outputNode.disconnect()
    } catch {
      // Already disconnected.
    }
    this.voices.clear()
  }
}
