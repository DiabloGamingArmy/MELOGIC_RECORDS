const DEFAULT_BPM = 140
const DEFAULT_POSITION_BEATS = 0

export class StudioAudioEngine {
  constructor({ audioContext = null, useTransportWorklet = true } = {}) {
    this.audioContext = audioContext
    this.ownsAudioContext = !audioContext
    this.useTransportWorklet = useTransportWorklet !== false
    this.workletNode = null
    this.isWorkletLoaded = false
    this.initPromise = null
    this.workletLoadPromise = null
    // Keep the AudioWorklet same-origin and CSP-safe. Vite can inline small `new URL()`
    // assets as data: URLs, which breaks stricter CSP policies for worklets.
    this.workletModuleUrl = '/worklets/melogic-audio-processor.js'
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
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      if (!this.audioContext) {
        const Ctx = window.AudioContext || window.webkitAudioContext
        if (!Ctx) throw new Error('Web Audio API is not supported in this browser.')
        try {
          this.audioContext = new Ctx({ latencyHint: 'interactive' })
        } catch {
          this.audioContext = new Ctx()
        }
      }
      this.state.sampleRate = this.audioContext.sampleRate || this.state.sampleRate
      if (this.useTransportWorklet) await this.loadWorklet()
      this.state.isReady = true
      return this.getState()
    })()

    try {
      return await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  async resume() {
    await this.init()
    if (this.audioContext?.state === 'suspended') await this.audioContext.resume()
    return this.getState()
  }

  async loadWorklet() {
    if (!this.audioContext || this.isWorkletLoaded) return
    if (this.workletLoadPromise) return this.workletLoadPromise

    this.workletLoadPromise = (async () => {
      console.info('[worklet] loading from', this.workletModuleUrl)
      await this.audioContext.audioWorklet.addModule(this.workletModuleUrl)
      if (this.isWorkletLoaded) return
      this.workletNode = new AudioWorkletNode(this.audioContext, 'melogic-audio-processor', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      })
      this.workletNode.connect(this.audioContext.destination)
      this.isWorkletLoaded = true
    })()

    try {
      return await this.workletLoadPromise
    } finally {
      this.workletLoadPromise = null
    }
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
    const nextBpm = Math.max(1, Number(bpm))
    if (Math.abs(nextBpm - this.state.bpm) < 0.0001) return this.getState()
    this.state.bpm = nextBpm
    // While stopped, startTransport() sends the complete authoritative state.
    // Avoid flooding the AudioWorklet MessagePort during timeline edits/scrubbing.
    if (this.state.isRunning) {
      this.workletNode?.port.postMessage({ type: 'transport:set-bpm', bpm: this.state.bpm })
    }
    return this.getState()
  }

  setPositionBeats(beats) {
    if (!Number.isFinite(beats)) return this.getState()
    const nextPosition = Number(beats)
    if (Math.abs(nextPosition - this.state.positionBeats) < 0.000001) return this.getState()
    this.state.positionBeats = nextPosition
    // Scrubbing can call this at pointer-event frequency. The stopped worklet does
    // not need every intermediate position because startTransport() resynchronizes it.
    if (this.state.isRunning) {
      this.workletNode?.port.postMessage({ type: 'transport:set-position', positionBeats: this.state.positionBeats })
    }
    return this.getState()
  }

  getState() {
    return { ...this.state }
  }

  destroy() {
    this.state.isRunning = false
    this.state.isReady = false
    this.initPromise = null
    this.workletLoadPromise = null
    try { this.workletNode?.disconnect() } catch (_) {}
    this.workletNode = null
    this.isWorkletLoaded = false
    if (this.audioContext && this.ownsAudioContext) {
      this.audioContext.close().catch(() => {})
    }
    this.audioContext = null
  }
}

export default StudioAudioEngine
