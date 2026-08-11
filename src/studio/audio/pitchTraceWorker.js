import { analyzePitchHighPrecision } from './highPrecisionPitchAnalyzer.js'

self.onmessage = (event) => {
  const message = event.data || {}
  if (message.type !== 'analyze') return

  const requestId = message.requestId

  try {
    const samples = new Float32Array(message.samples)

    const result = analyzePitchHighPrecision({
      samples,
      sampleRate: Number(message.sampleRate) || 44100,
      bpm: Number(message.bpm) || 140,
      regionStartBeat: Number(message.regionStartBeat) || 0,
      stretchRatio: Math.max(0.05, Number(message.stretchRatio) || 1),
      analysisMode: ['vocal', 'instrument', 'full-mix'].includes(message.analysisMode)
        ? message.analysisMode
        : 'vocal',
      sensitivity: Number(message.sensitivity ?? 0.72),
      minNoteSeconds: Number(message.minNoteSeconds ?? 0.06),
      confidenceThreshold: Number(message.confidenceThreshold ?? 0.48),
      quality: message.quality === 'fast' ? 'fast' : 'deep',
      onProgress: (progress) => {
        self.postMessage({
          type: 'progress',
          requestId,
          progress
        })
      }
    })

    self.postMessage({
      type: 'complete',
      requestId,
      ...result
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId,
      error: error?.message || 'Pitch analysis failed.'
    })
  }
}
