const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function midiToName(midi) {
  const note = Math.round(midi)
  const pitch = ((note % 12) + 12) % 12
  const octave = Math.floor(note / 12) - 1
  return `${NOTE_NAMES[pitch]}${octave}`
}

function frequencyToMidi(frequencyHz) {
  return 69 + (12 * Math.log2(frequencyHz / 440))
}

function rmsForWindow(samples, start, size) {
  let sum = 0
  for (let index = 0; index < size; index += 1) {
    const sample = samples[start + index] || 0
    sum += sample * sample
  }
  return Math.sqrt(sum / Math.max(1, size))
}

function detectPitchYin(samples, start, size, sampleRate) {
  const minFrequency = 55
  const maxFrequency = 1200
  const minTau = Math.max(2, Math.floor(sampleRate / maxFrequency))
  const maxTau = Math.min(size - 2, Math.ceil(sampleRate / minFrequency))
  const difference = new Float32Array(maxTau + 1)
  const cmnd = new Float32Array(maxTau + 1)

  for (let tau = minTau; tau <= maxTau; tau += 1) {
    let sum = 0
    for (let index = 0; index < size - tau; index += 1) {
      const delta = (samples[start + index] || 0) - (samples[start + index + tau] || 0)
      sum += delta * delta
    }
    difference[tau] = sum
  }

  let runningSum = 0
  cmnd[0] = 1
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau]
    cmnd[tau] = runningSum > 0 ? difference[tau] * tau / runningSum : 1
  }

  let tauEstimate = -1
  const yinThreshold = 0.16
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cmnd[tau] < yinThreshold) {
      while (tau + 1 <= maxTau && cmnd[tau + 1] < cmnd[tau]) tau += 1
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate < 0) {
    let bestTau = minTau
    let bestValue = cmnd[minTau]
    for (let tau = minTau + 1; tau <= maxTau; tau += 1) {
      if (cmnd[tau] < bestValue) {
        bestValue = cmnd[tau]
        bestTau = tau
      }
    }
    tauEstimate = bestValue < 0.38 ? bestTau : -1
  }
  if (tauEstimate < 0) return null

  const prev = cmnd[tauEstimate - 1] || cmnd[tauEstimate]
  const next = cmnd[tauEstimate + 1] || cmnd[tauEstimate]
  const denom = (2 * ((2 * cmnd[tauEstimate]) - prev - next))
  const betterTau = denom ? tauEstimate + ((next - prev) / denom) : tauEstimate
  const frequencyHz = sampleRate / Math.max(1, betterTau)
  if (!Number.isFinite(frequencyHz) || frequencyHz < minFrequency || frequencyHz > maxFrequency) return null
  return {
    frequencyHz,
    confidence: clamp(1 - cmnd[tauEstimate], 0, 1)
  }
}

function mergeFramesToNotes(frames, { bpm, regionStartBeat, stretchRatio, confidenceThreshold }) {
  const notes = []
  let current = null
  const closeCurrent = () => {
    if (!current) return
    const durationSeconds = Math.max(0, current.endSeconds - current.startSeconds)
    if (durationSeconds >= 0.08 && current.confidence >= confidenceThreshold) {
      const visibleStartSeconds = current.startSeconds * stretchRatio
      const visibleDurationSeconds = durationSeconds * stretchRatio
      const durationBeats = visibleDurationSeconds * (bpm / 60)
      notes.push({
        id: `pt-${notes.length + 1}`,
        startSeconds: Number(visibleStartSeconds.toFixed(4)),
        durationSeconds: Number(visibleDurationSeconds.toFixed(4)),
        startBeat: Number((regionStartBeat + (visibleStartSeconds * bpm / 60)).toFixed(4)),
        durationBeats: Number(durationBeats.toFixed(4)),
        midiNote: current.midiNote,
        noteName: midiToName(current.midiNote),
        frequencyHz: Number((current.frequencySum / Math.max(1, current.count)).toFixed(2)),
        confidence: Number(current.confidence.toFixed(3)),
        centsOffset: Number(current.centsOffset.toFixed(1))
      })
    }
    current = null
  }

  for (const frame of frames) {
    const midiFloat = frequencyToMidi(frame.frequencyHz)
    const midiNote = clamp(Math.round(midiFloat), 0, 127)
    const centsOffset = (midiFloat - midiNote) * 100
    if (!current || current.midiNote !== midiNote || frame.startSeconds - current.endSeconds > 0.09) {
      closeCurrent()
      current = {
        midiNote,
        startSeconds: frame.startSeconds,
        endSeconds: frame.endSeconds,
        frequencySum: frame.frequencyHz,
        confidence: frame.confidence,
        centsOffset,
        count: 1
      }
    } else {
      current.endSeconds = frame.endSeconds
      current.frequencySum += frame.frequencyHz
      current.confidence = Math.max(current.confidence, frame.confidence)
      current.centsOffset = ((current.centsOffset * current.count) + centsOffset) / (current.count + 1)
      current.count += 1
    }
  }
  closeCurrent()
  return notes.slice(0, 512)
}

self.onmessage = (event) => {
  const message = event.data || {}
  if (message.type !== 'analyze') return
  try {
    const samples = new Float32Array(message.samples)
    const sampleRate = Number(message.sampleRate) || 44100
    const bpm = Number(message.bpm) || 140
    const regionStartBeat = Number(message.regionStartBeat) || 0
    const stretchRatio = Math.max(0.05, Number(message.stretchRatio) || 1)
    const confidenceThreshold = clamp(Number(message.confidenceThreshold) || 0.65, 0.1, 0.98)
    const frameSize = sampleRate < 48000 ? 2048 : 4096
    const hopSize = Math.max(256, Math.floor(frameSize / 4))
    const frames = []
    const totalFrames = Math.max(1, Math.ceil(Math.max(0, samples.length - frameSize) / hopSize))

    for (let start = 0, frameIndex = 0; start + frameSize < samples.length; start += hopSize, frameIndex += 1) {
      if (frameIndex % 20 === 0) {
        self.postMessage({ type: 'progress', requestId: message.requestId, progress: clamp(frameIndex / totalFrames, 0, 0.98) })
      }
      const rms = rmsForWindow(samples, start, frameSize)
      if (rms < 0.012) continue
      const pitch = detectPitchYin(samples, start, frameSize, sampleRate)
      if (!pitch || pitch.confidence < Math.max(0.45, confidenceThreshold - 0.18)) continue
      frames.push({
        startSeconds: start / sampleRate,
        endSeconds: (start + hopSize) / sampleRate,
        frequencyHz: pitch.frequencyHz,
        confidence: pitch.confidence
      })
    }

    const notes = mergeFramesToNotes(frames, { bpm, regionStartBeat, stretchRatio, confidenceThreshold })
    self.postMessage({
      type: 'complete',
      requestId: message.requestId,
      notes,
      frameCount: frames.length,
      algorithm: 'yin-js-worker-v1'
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      error: error?.message || 'Pitch analysis failed.'
    })
  }
}
