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
    this.disposed = false
    this.runtimeError = null
    this.diagnostics = null
    this.diagnosticsTimer = null
    this.cancelInitialization = null
    this.node = null
    this.manifest = null
    this.paramIndexById = new Map()
    this.readyPromise = this.initialize().catch((error) => {
      this.runtimeError = error
      throw error
    })
    // Retain the rejection for ensureRunning/note scheduling, but avoid an
    // unhandled rejection while an instrument is still being attached.
    this.readyPromise.catch(() => {})
  }

  async initialize() {
    const record = await getSouraPluginPackage(this.packageId)
    if (this.disposed) throw new Error('Soura WASM instrument is disposed.')
    if (!record) throw new Error(`Soura plugin package "${this.packageId}" is not installed on this device.`)
    this.manifest = record.manifest
    this.paramIndexById = new Map((record.manifest.parameters || []).map((parameter) => [parameter.id, parameter.index]))
    await this.audioContext.audioWorklet.addModule(workletUrl)
    if (this.disposed) throw new Error('Soura WASM instrument is disposed.')
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
    const node = this.node
    await new Promise((resolve, reject) => {
      this.cancelInitialization = reject
      const fail = (error) => {
        if (!this.runtimeError) console.warn('[SouraWasmInstrument] processor stopped', error)
        this.runtimeError = error
        clearInterval(this.diagnosticsTimer)
        this.diagnosticsTimer = null
        node.port.postMessage({ type: 'dispose' })
        node.disconnect()
        reject(error)
      }
      node.onprocessorerror = () => fail(new Error('Soura WASM audio processor failed. Reload the instrument.'))
      node.port.onmessage = ({ data }) => {
        if (this.disposed) return
        if (data.type === 'error') fail(new Error(data.message || data.code))
        if (data.type === 'diagnostics') {
          this.diagnostics = data
          if (data.failure) fail(new Error(`Soura WASM processor stopped: ${data.failure}. Reload the instrument.`))
        }
        if (data.type === 'ready') resolve()
      }
      node.connect(this.destination)
    })
    this.cancelInitialization = null
    if (this.disposed) throw new Error('Soura WASM instrument is disposed.')
    // Only the control thread allocates diagnostics messages; process merely
    // updates fixed counters. No per-render-block port traffic.
    this.diagnosticsTimer = setInterval(() => node.port.postMessage({ type: 'diagnostics' }), 1000)
    return this
  }

  async ensureRunning() {
    if (this.disposed) throw new Error('Soura WASM instrument is disposed.')
    if (this.runtimeError) throw this.runtimeError
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()
    await this.readyPromise
  }

  noteOn(note, velocity = 0.85, { startTime = null, stopTime = null, onScheduled = null, onTriggered = null } = {}) {
    const at = Number.isFinite(Number(startTime)) ? Number(startTime) : this.audioContext.currentTime
    this.readyPromise.then(() => {
      if (this.disposed || this.runtimeError) return
      this.node?.port.postMessage({ type: 'noteOn', note: Number(note), velocity: Number(velocity), time: at })
      onScheduled?.({ note: Number(note), scheduledAudioTime: at, audioContextCurrentTime: this.audioContext.currentTime })
      onTriggered?.({ note: Number(note), scheduledAudioTime: at, audioContextCurrentTime: this.audioContext.currentTime })
      if (Number.isFinite(Number(stopTime)) && Number(stopTime) > at) this.noteOff(note, { stopTime: Number(stopTime) })
    }).catch((error) => console.warn('[SouraWasmInstrument] noteOn failed', error))
  }

  noteOff(note, { stopTime = null } = {}) {
    const at = Number.isFinite(Number(stopTime)) ? Number(stopTime) : this.audioContext.currentTime
    this.readyPromise.then(() => { if (!this.disposed && !this.runtimeError) this.node?.port.postMessage({ type: 'noteOff', note: Number(note), time: at }) }).catch((error) => console.warn('[SouraWasmInstrument] noteOff failed', error))
  }

  setParam(name, value) {
    this.params[name] = value
    const index = this.paramIndexById.get(name)
    if (index == null) return
    this.readyPromise.then(() => { if (!this.disposed && !this.runtimeError) this.node?.port.postMessage({ type: 'param', index, value: Number(value) || 0 }) }).catch((error) => console.warn('[SouraWasmInstrument] parameter update failed', error))
  }

  setManifest() {}

  dispose() {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.diagnosticsTimer)
    this.diagnosticsTimer = null
    this.cancelInitialization?.(new Error('Soura WASM instrument is disposed.'))
    this.cancelInitialization = null
    this.node?.port.postMessage({ type: 'dispose' })
    this.node?.disconnect()
    this.node = null
  }
}
