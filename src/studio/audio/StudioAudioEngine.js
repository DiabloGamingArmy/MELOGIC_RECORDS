const DEFAULT_BPM = 140
const DEFAULT_POSITION_BEATS = 0

export class StudioAudioEngine {
  constructor() {
    this.audioContext = null
    this.workletNode = null
    this.isWorkletLoaded = false
    // Vite resolves this URL for both dev and production builds, including hashed asset output.
    this.workletModuleUrl = new URL('./worklets/melogic-audio-processor.js', import.meta.url)
    this.state = {
      isReady: false,
      isRunning: false,
      bpm: DEFAULT_BPM,
      positionBeats: DEFAULT_POSITION_BEATS,
      sampleRate: 48000
    }
  }

  async init() {
    if (this.state.isReady) return this.getState()
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) throw new Error('Web Audio API is not supported in this browser.')
    if (!this.audioContext) {
      this.audioContext = new Ctx()
      this.state.sampleRate = this.audioContext.sampleRate || this.state.sampleRate
    }
    await this.loadWorklet()
    this.state.isReady = true
    return this.getState()
  }

  async resume() {
    await this.init()
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume()
    return this.getState()
  }

  async loadWorklet() {
    if (!this.audioContext || this.isWorkletLoaded) return
    await this.audioContext.audioWorklet.addModule(this.workletModuleUrl)
    this.workletNode = new AudioWorkletNode(this.audioContext, 'melogic-audio-processor', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    })
    this.workletNode.connect(this.audioContext.destination)
    this.isWorkletLoaded = true
  }

  startTransport({ bpm, positionBeats } = {}) {
    if (Number.isFinite(bpm)) this.setBpm(bpm)
    if (Number.isFinite(positionBeats)) this.setPositionBeats(positionBeats)
    this.state.isRunning = true
    this.workletNode?.port.postMessage({ type: 'transport:start', bpm: this.state.bpm, positionBeats: this.state.positionBeats })
    return this.getState()
  }

  pauseTransport() {
    this.state.isRunning = false
    this.workletNode?.port.postMessage({ type: 'transport:pause' })
    return this.getState()
  }

  stopTransport() {
    this.state.isRunning = false
    this.state.positionBeats = 0
    this.workletNode?.port.postMessage({ type: 'transport:stop', positionBeats: this.state.positionBeats })
    return this.getState()
  }

  setBpm(bpm) {
    if (!Number.isFinite(bpm)) return this.getState()
    this.state.bpm = Math.max(1, Number(bpm))
    this.workletNode?.port.postMessage({ type: 'transport:set-bpm', bpm: this.state.bpm })
    return this.getState()
  }

  setPositionBeats(beats) {
    if (!Number.isFinite(beats)) return this.getState()
    this.state.positionBeats = Number(beats)
    this.workletNode?.port.postMessage({ type: 'transport:set-position', positionBeats: this.state.positionBeats })
    return this.getState()
  }

  getState() {
    return { ...this.state }
  }

  destroy() {
    this.state.isRunning = false
    this.state.isReady = false
    try { this.workletNode?.disconnect() } catch (_) {}
    this.workletNode = null
    this.isWorkletLoaded = false
    if (this.audioContext) {
      this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
  }
}

export default StudioAudioEngine
