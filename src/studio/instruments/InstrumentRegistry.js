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

  noteOn(id, note, velocity = 0.85, options = {}) {
    const instrument = this.get(id)
    if (!instrument) return
    const runNoteOn = () => {
      const audioContext = instrument.audioContext
      const startOffsetSeconds = options.live ? Math.max(0, Math.min(0.005, Number(options.startOffsetSeconds) || 0)) : 0
      const startTime = options.live && audioContext
        ? audioContext.currentTime + startOffsetSeconds
        : options.startTime
      const liveOptions = options.live
        ? {
            ...options,
            startTime,
            onScheduled: ({ scheduledAudioTime, audioContextCurrentTime } = {}) => {
              console.info('[live-note] scheduled', {
                note,
                scheduledAudioTime,
                audioContextCurrentTime,
                scheduleDeltaMs: Math.round(((Number(scheduledAudioTime) || 0) - (Number(audioContextCurrentTime) || 0)) * 1000),
                selectedTrackId: options.selectedTrackId,
                instrumentId: id,
                source: options.source || 'live'
              })
            },
            onTriggered: ({ scheduledAudioTime, audioContextCurrentTime } = {}) => {
              console.info('[live-note] triggered', {
                note,
                scheduleDeltaMs: Math.round(((Number(scheduledAudioTime) || 0) - (Number(audioContextCurrentTime) || 0)) * 1000),
                instrumentId: id,
                source: options.source || 'live'
              })
            }
          }
        : options
      return instrument.noteOn(note, velocity, liveOptions)
    }
    const ensureRunning = instrument?.ensureRunning?.()
    Promise.resolve(ensureRunning).then(runNoteOn).catch((error) => {
      console.warn('[InstrumentRegistry] noteOn failed', { id, message: error?.message })
    })
  }

  noteOff(id, note, options = {}) {
    this.get(id)?.noteOff(note, options)
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
