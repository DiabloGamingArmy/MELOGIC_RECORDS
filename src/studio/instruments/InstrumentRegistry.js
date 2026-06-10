import { DAW_PLUGIN_TYPES } from '../plugins/pluginCatalog.js'
import { BasicSynthInstrument } from './BasicSynthInstrument.js'
import { LibrarySamplerInstrument } from './LibrarySamplerInstrument.js'

export class InstrumentRegistry {
  constructor({ getAudioContext, getDestination, resolveLibraryInstrument } = {}) {
    this.getAudioContext = getAudioContext
    this.getDestination = getDestination
    this.resolveLibraryInstrument = resolveLibraryInstrument
    this.instances = new Map()
    this.factories = new Map([
      [DAW_PLUGIN_TYPES.melogicWavetable, (options) => new BasicSynthInstrument(options)],
      [DAW_PLUGIN_TYPES.librarySampler, (options) => new LibrarySamplerInstrument(options)]
    ])
  }

  createOrGet({ id, type, trackId, params, manifest } = {}) {
    if (!id) return null
    const existing = this.instances.get(id)
    if (existing) {
      Object.entries(params || {}).forEach(([name, value]) => existing.setParam(name, value))
      existing.setManifest?.(manifest)
      return existing
    }
    const factory = this.factories.get(type)
    if (!factory) return null
    const audioContext = this.getAudioContext?.()
    const instrument = factory({
      id,
      type,
      trackId,
      params,
      manifest,
      resolveManifest: this.resolveLibraryInstrument,
      audioContext,
      destination: this.getDestination?.(trackId, id) || audioContext.destination
    })
    this.instances.set(id, instrument)
    return instrument
  }

  get(id = '') {
    return this.instances.get(id) || null
  }

  noteOn(id, note, velocity = 0.85) {
    const instrument = this.get(id)
    Promise.resolve(instrument?.ensureRunning?.()).then(() => instrument?.noteOn(note, velocity)).catch((error) => {
      console.warn('[InstrumentRegistry] noteOn failed', { id, message: error?.message })
    })
  }

  noteOff(id, note) {
    this.get(id)?.noteOff(note)
  }

  setParam(id, name, value) {
    this.get(id)?.setParam(name, value)
  }

  dispose(id) {
    const instrument = this.instances.get(id)
    if (!instrument) return
    instrument.dispose()
    this.instances.delete(id)
  }

  disposeAll() {
    Array.from(this.instances.keys()).forEach((id) => this.dispose(id))
  }
}
