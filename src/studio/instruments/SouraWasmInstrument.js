import workletUrl from './SouraWasmInstrumentProcessor.js?url'
import { getPackageIdFromPluginType, getSouraPluginPackage } from '../plugins/souraWasmPluginPackage.js'

export class SouraWasmInstrument {
  constructor({ id, type, trackId, audioContext, destination, params = {} } = {}) {
    if (!audioContext) throw new Error('AudioContext is required for SouraWasmInstrument.')
    this.id = id
    this.type = type
    this.trackId = trackId
    this.audioContext = audioContext
    this.destination = destination || audioContext.destination
    this.params = { ...(params || {}) }
    this.packageId = getPackageIdFromPluginType(type)
    this.node = null
    this.manifest = null
    this.paramIndexById = new Map()
    this.readyPromise = this.initialize()
  }

  async initialize() {
    const record = await getSouraPluginPackage(this.packageId)
    if (!record) throw new Error(`Soura plugin package "${this.packageId}" is not installed on this device.`)
    this.manifest = record.manifest
    this.paramIndexById = new Map((record.manifest.parameters || []).map((parameter) => [parameter.id, parameter.index]))
    await this.audioContext.audioWorklet.addModule(workletUrl)
    const initialParameters = (record.manifest.parameters || []).map((parameter) => ({
      index: parameter.index,
      value: Number.isFinite(Number(this.params[parameter.id])) ? Number(this.params[parameter.id]) : parameter.default
    }))
    this.node = new AudioWorkletNode(this.audioContext, 'soura-wasm-instrument-v1', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      processorOptions: {
        wasmBytes: record.wasmBytes,
        parameters: initialParameters
      }
    })
    this.node.connect(this.destination)
    return this
  }

  async ensureRunning() {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()
    await this.readyPromise
  }

  noteOn(note, velocity = 0.85, { startTime = null, stopTime = null, onScheduled = null, onTriggered = null } = {}) {
    const at = Number.isFinite(Number(startTime)) ? Number(startTime) : this.audioContext.currentTime
    this.readyPromise.then(() => {
      this.node?.port.postMessage({ type: 'noteOn', note: Number(note), velocity: Number(velocity), time: at })
      onScheduled?.({ note: Number(note), scheduledAudioTime: at, audioContextCurrentTime: this.audioContext.currentTime })
      onTriggered?.({ note: Number(note), scheduledAudioTime: at, audioContextCurrentTime: this.audioContext.currentTime })
      if (Number.isFinite(Number(stopTime)) && Number(stopTime) > at) this.noteOff(note, { stopTime: Number(stopTime) })
    }).catch((error) => console.warn('[SouraWasmInstrument] noteOn failed', error))
  }

  noteOff(note, { stopTime = null } = {}) {
    const at = Number.isFinite(Number(stopTime)) ? Number(stopTime) : this.audioContext.currentTime
    this.readyPromise.then(() => this.node?.port.postMessage({ type: 'noteOff', note: Number(note), time: at })).catch(() => {})
  }

  setParam(name, value) {
    this.params[name] = value
    const index = this.paramIndexById.get(name)
    if (index == null) return
    this.readyPromise.then(() => this.node?.port.postMessage({ type: 'param', index, value: Number(value) || 0 })).catch(() => {})
  }

  setManifest() {}

  dispose() {
    this.readyPromise.then(() => {
      this.node?.port.postMessage({ type: 'dispose' })
      try { this.node?.disconnect() } catch {}
      this.node = null
    }).catch(() => {})
  }
}
