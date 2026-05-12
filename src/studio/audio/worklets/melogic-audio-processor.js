class MelogicAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this.isRunning = false
    this.bpm = 140
    this.positionBeats = 0
    this.sampleCounter = 0
    this.instructions = null
    this.samplesPerBeat = this.computeSamplesPerBeat()
    this.lastPostedSampleCounter = 0
    this.postIntervalSamples = Math.max(1, Math.floor(sampleRate / 10))

    this.port.onmessage = (event) => {
      const msg = event?.data || {}
      switch (msg.type) {
        case 'transport:start':
          this.isRunning = true
          if (Number.isFinite(msg.bpm)) this.bpm = Math.max(1, Number(msg.bpm))
          if (Number.isFinite(msg.positionBeats)) this.positionBeats = Number(msg.positionBeats)
          this.samplesPerBeat = this.computeSamplesPerBeat()
          break
        case 'transport:pause':
          this.isRunning = false
          break
        case 'transport:stop':
          this.isRunning = false
          this.positionBeats = Number.isFinite(msg.positionBeats) ? Number(msg.positionBeats) : 0
          break
        case 'transport:set-bpm':
          if (Number.isFinite(msg.bpm)) {
            this.bpm = Math.max(1, Number(msg.bpm))
            this.samplesPerBeat = this.computeSamplesPerBeat()
          }
          break
        case 'transport:set-position':
          if (Number.isFinite(msg.positionBeats)) this.positionBeats = Number(msg.positionBeats)
          break
        case 'sequencer:set-instructions':
          this.instructions = msg.instructions || null
          break
        default:
          break
      }
    }
  }

  computeSamplesPerBeat() {
    return (sampleRate * 60) / this.bpm
  }

  process(_inputs, outputs) {
    const output = outputs[0]
    if (!output) return true

    const frameSize = output[0]?.length || 128
    for (let channel = 0; channel < output.length; channel += 1) {
      output[channel].fill(0)
    }

    if (this.isRunning) {
      this.sampleCounter += frameSize
      this.positionBeats += frameSize / this.samplesPerBeat
      if (this.sampleCounter - this.lastPostedSampleCounter >= this.postIntervalSamples) {
        this.lastPostedSampleCounter = this.sampleCounter
        this.port.postMessage({
          type: 'transport:position',
          positionBeats: this.positionBeats,
          sampleCounter: this.sampleCounter,
          isRunning: this.isRunning
        })
      }
    }

    return true
  }
}

registerProcessor('melogic-audio-processor', MelogicAudioProcessor)
