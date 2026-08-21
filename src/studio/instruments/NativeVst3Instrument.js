import {
  disposeNativeVst3Host,
  ensureNativeVst3Host,
  nativeVst3NoteOff,
  nativeVst3NoteOn
} from '../audio/native/NativeVst3HostService.js'

export class NativeVst3Instrument {
  constructor({ id, type, trackId, audioContext, params = {} } = {}) {
    this.id = id
    this.type = type
    this.trackId = trackId
    this.audioContext = audioContext
    this.params = { ...(params || {}) }
    this.readyPromise = null
    this.disposed = false
  }

  async ensureRunning() {
    if (this.disposed) throw new Error('Native VST3 instrument is disposed.')
    if (this.readyPromise) return this.readyPromise

    const path = this.params.nativePluginPath
    if (!path) throw new Error('Native VST3 path is missing from instrument state.')

    this.readyPromise = ensureNativeVst3Host({
      instanceId: this.id,
      path,
      sampleRate: this.audioContext?.sampleRate || 48000,
      maxBlockSize: 512
    }).catch((error) => {
      this.readyPromise = null
      throw error
    })

    return this.readyPromise
  }

  async noteOn(note, velocity = 0.85) {
    await this.ensureRunning()
    return nativeVst3NoteOn(this.id, note, velocity, 0)
  }

  async noteOff(note) {
    if (!this.readyPromise) return
    try {
      await nativeVst3NoteOff(this.id, note, 0, 0)
    } catch (error) {
      console.warn('[NativeVst3Instrument] noteOff failed', error)
    }
  }

  async setParam(name, value) {
    // Instrument parameter state stays local here.
    // Native track gain/pan/mute are synchronized by studioProject.js through
    // nativeVst3SetMix(), so this class must not reset those mix values.
    this.params[name] = value
  }

  async dispose() {
    this.disposed = true
    try {
      await disposeNativeVst3Host(this.id)
    } catch {}
    this.readyPromise = null
  }
}
