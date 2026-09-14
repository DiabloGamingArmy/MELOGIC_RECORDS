import {
  disposeNativeVst3Host,
  ensureNativeVst3Host,
  nativeVst3NoteOff,
  nativeVst3NoteOn
} from '../audio/native/NativeVst3HostService.js'
import { resolveNativeVst3RuntimePath } from '../audio/native/NativeVst3Service.js'

export class NativeVst3Instrument {
  constructor({ id, type, trackId, audioContext, params = {} } = {}) {
    this.id = id
    this.type = type
    this.trackId = trackId
    this.audioContext = audioContext
    this.params = { ...(params || {}) }
    this.readyPromise = null
    this.disposed = false
    this.disposePromise = null
  }

  async ensureRunning() {
    if (this.disposed) throw new Error('Native VST3 instrument is disposed.')
    if (this.readyPromise) return this.readyPromise

    this.readyPromise = resolveNativeVst3RuntimePath(this.params).then((path) => {
      if (this.disposed) throw new Error('Native VST3 instrument is disposed.')
      if (!path) throw new Error('The required VST3 instrument is not installed on this computer.')
      return ensureNativeVst3Host({
        instanceId: this.id,
        path,
        sampleRate: this.audioContext?.sampleRate || 48000,
        maxBlockSize: 512
      })
    }).catch((error) => {
      this.readyPromise = null
      throw error
    })

    return this.readyPromise
  }

  async noteOn(note, velocity = 0.85) {
    await this.ensureRunning()
    if (this.disposed) return
    return nativeVst3NoteOn(this.id, note, velocity, 0)
  }

  async noteOff(note) {
    if (this.disposed || !this.readyPromise) return
    try {
      await this.readyPromise
      if (this.disposed) return
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

  dispose() {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    const pendingCreation = this.readyPromise
    this.disposePromise = (async () => {
      // Serialize teardown after an in-flight native create. A late create must
      // not leave a plugin/stream running after its track has been removed.
      try { await pendingCreation } catch { /* creation failure still needs cleanup */ }
      try {
        await disposeNativeVst3Host(this.id)
      } catch (error) {
        console.warn('[NativeVst3Instrument] disposal failed', error)
      }
      this.readyPromise = null
    })()
    return this.disposePromise
  }
}
