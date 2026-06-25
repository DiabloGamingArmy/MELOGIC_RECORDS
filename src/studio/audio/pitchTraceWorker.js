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

function median(values = []) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b)
  if (!sorted.length) return 0
  return sorted[Math.floor(sorted.length / 2)]
}

function rmsForWindow(samples, start, size) {
  let sum = 0
  for (let index = 0; index < size; index += 1) {
    const sample = samples[start + index] || 0
    sum += sample * sample
  }
  return Math.sqrt(sum / Math.max(1, size))
}

function meanAbsForWindow(samples, start, size) {
  let sum = 0
  for (let index = 0; index < size; index += 1) sum += Math.abs(samples[start + index] || 0)
  return sum / Math.max(1, size)
}

function chooseAnalysisConfig(sampleRate, mode = 'vocal', sensitivity = 0.7) {
  const lowFrequency = mode === 'full-mix' ? 45 : mode === 'instrument' ? 50 : 65
  const targetWindowSeconds = mode === 'full-mix' ? 0.11 : mode === 'instrument' ? 0.095 : 0.075
  const minFrameSize = Math.ceil(sampleRate / lowFrequency * 2.5)
  const targetFrameSize = Math.ceil(sampleRate * targetWindowSeconds)
  let frameSize = 2048
  while (frameSize < Math.max(minFrameSize, targetFrameSize) && frameSize < 16384) frameSize *= 2
  const hopSeconds = clamp(0.018 - ((clamp(sensitivity, 0, 1) - 0.5) * 0.008), 0.01, 0.024)
  return {
    minFrequency: lowFrequency,
    maxFrequency: mode === 'full-mix' ? 1400 : 1800,
    frameSize,
    hopSize: Math.max(128, Math.round(sampleRate * hopSeconds)),
    rmsFloor: mode === 'full-mix' ? 0.006 : 0.0045,
    yinThreshold: clamp(0.24 - (sensitivity * 0.08), 0.12, 0.24),
    fallbackThreshold: clamp(0.58 - (sensitivity * 0.12), 0.38, 0.58)
  }
}

function parabolicInterpolate(values, index) {
  const prev = values[index - 1] ?? values[index]
  const value = values[index]
  const next = values[index + 1] ?? values[index]
  const denom = (2 * ((2 * value) - prev - next))
  return denom ? index + ((next - prev) / denom) : index
}

function detectPitchYin(samples, start, size, sampleRate, config) {
  const minTau = Math.max(2, Math.floor(sampleRate / config.maxFrequency))
  const maxTau = Math.min(size - 2, Math.ceil(sampleRate / config.minFrequency))
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
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cmnd[tau] < config.yinThreshold) {
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
    tauEstimate = bestValue < config.fallbackThreshold ? bestTau : -1
  }
  if (tauEstimate < 0) return null

  const betterTau = parabolicInterpolate(cmnd, tauEstimate)
  const frequencyHz = sampleRate / Math.max(1, betterTau)
  if (!Number.isFinite(frequencyHz) || frequencyHz < config.minFrequency || frequencyHz > config.maxFrequency) return null
  return {
    frequencyHz,
    confidence: clamp(1 - cmnd[tauEstimate], 0, 1),
    method: 'yin'
  }
}

function detectPitchNsdf(samples, start, size, sampleRate, config) {
  const minTau = Math.max(2, Math.floor(sampleRate / config.maxFrequency))
  const maxTau = Math.min(size - 2, Math.ceil(sampleRate / config.minFrequency))
  let bestTau = -1
  let bestScore = -1
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    let acf = 0
    let energy = 0
    for (let index = 0; index < size - tau; index += 1) {
      const a = samples[start + index] || 0
      const b = samples[start + index + tau] || 0
      acf += a * b
      energy += (a * a) + (b * b)
    }
    const score = energy > 0 ? (2 * acf) / energy : 0
    if (score > bestScore) {
      bestScore = score
      bestTau = tau
    }
  }
  if (bestTau < 0 || bestScore < 0.54) return null
  const frequencyHz = sampleRate / bestTau
  if (!Number.isFinite(frequencyHz) || frequencyHz < config.minFrequency || frequencyHz > config.maxFrequency) return null
  return {
    frequencyHz,
    confidence: clamp((bestScore - 0.35) / 0.65, 0, 1),
    method: 'nsdf'
  }
}

function smoothFrames(frames = []) {
  return frames.map((frame, index) => {
    const nearby = frames.slice(Math.max(0, index - 2), Math.min(frames.length, index + 3))
    const midi = frequencyToMidi(frame.frequencyHz)
    const nearbyMidi = nearby.map((item) => frequencyToMidi(item.frequencyHz))
    const smoothedMidi = median(nearbyMidi)
    const jump = Math.abs(smoothedMidi - midi)
    const useSmoothed = jump <= 3 || frame.confidence < 0.72
    return {
      ...frame,
      frequencyHz: useSmoothed ? 440 * (2 ** ((smoothedMidi - 69) / 12)) : frame.frequencyHz,
      confidence: clamp(frame.confidence + (nearby.length >= 3 ? 0.04 : 0), 0, 1)
    }
  })
}

function pushNote(notes, current, { bpm, regionStartBeat, stretchRatio, minNoteSeconds, confidenceThreshold }) {
  if (!current) return
  const durationSeconds = Math.max(0, current.endSeconds - current.startSeconds)
  if (durationSeconds < minNoteSeconds || current.confidence < confidenceThreshold) return
  const visibleStartSeconds = current.startSeconds * stretchRatio
  const visibleDurationSeconds = durationSeconds * stretchRatio
  const durationBeats = visibleDurationSeconds * (bpm / 60)
  const frequencyHz = Number((current.frequencySum / Math.max(1, current.count)).toFixed(2))
  notes.push({
    id: `pt-${notes.length + 1}`,
    startSeconds: Number(visibleStartSeconds.toFixed(4)),
    durationSeconds: Number(visibleDurationSeconds.toFixed(4)),
    startBeat: Number((regionStartBeat + (visibleStartSeconds * bpm / 60)).toFixed(4)),
    durationBeats: Number(durationBeats.toFixed(4)),
    originalMidiNote: current.midiNote,
    editedMidiNote: current.midiNote,
    midiNote: current.midiNote,
    noteName: midiToName(current.midiNote),
    originalFrequencyHz: frequencyHz,
    editedFrequencyHz: frequencyHz,
    frequencyHz,
    confidence: Number(current.confidence.toFixed(3)),
    centsOffset: Number(current.centsOffset.toFixed(1)),
    gainDb: 0,
    pitchDriftStartCents: 0,
    pitchDriftEndCents: 0,
    vibratoAmount: 0,
    source: 'analysis',
    lockedToAnalysis: false,
    muted: false,
    renderStatus: 'idle'
  })
}

function mergeFramesToNotes(frames, options) {
  const notes = []
  let current = null
  const pitchTolerance = options.mode === 'full-mix' ? 1.25 : options.mode === 'instrument' ? 0.85 : 0.65
  const gapTolerance = options.hopSeconds * 2.75

  const closeCurrent = () => {
    pushNote(notes, current, options)
    current = null
  }

  for (const frame of smoothFrames(frames)) {
    const midiFloat = frequencyToMidi(frame.frequencyHz)
    const midiNote = clamp(Math.round(midiFloat), 0, 127)
    const centsOffset = (midiFloat - midiNote) * 100
    const gap = current ? frame.startSeconds - current.endSeconds : 0
    const samePitch = current && Math.abs(midiFloat - current.midiFloatAvg) <= pitchTolerance
    if (!current || !samePitch || gap > gapTolerance) {
      closeCurrent()
      current = {
        midiNote,
        midiFloatAvg: midiFloat,
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
      current.midiFloatAvg = ((current.midiFloatAvg * current.count) + midiFloat) / (current.count + 1)
      current.count += 1
      current.midiNote = clamp(Math.round(current.midiFloatAvg), 0, 127)
    }
  }
  closeCurrent()

  const merged = []
  for (const note of notes) {
    const prev = merged[merged.length - 1]
    if (prev && Math.abs(prev.editedMidiNote - note.editedMidiNote) <= 1 && note.startSeconds - (prev.startSeconds + prev.durationSeconds) <= 0.08) {
      const endSeconds = Math.max(prev.startSeconds + prev.durationSeconds, note.startSeconds + note.durationSeconds)
      prev.durationSeconds = Number((endSeconds - prev.startSeconds).toFixed(4))
      prev.durationBeats = Number((prev.durationSeconds * (options.bpm / 60)).toFixed(4))
      prev.confidence = Number(Math.max(prev.confidence, note.confidence).toFixed(3))
      continue
    }
    merged.push(note)
  }
  return merged.slice(0, 512)
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
    const mode = ['vocal', 'instrument', 'full-mix'].includes(message.analysisMode) ? message.analysisMode : 'vocal'
    const sensitivity = clamp(Number(message.sensitivity ?? 0.72), 0, 1)
    const minNoteSeconds = clamp(Number(message.minNoteSeconds ?? 0.08), 0.035, 0.35)
    const confidenceThreshold = clamp(Number(message.confidenceThreshold ?? 0.5), 0.1, 0.98)
    const config = chooseAnalysisConfig(sampleRate, mode, sensitivity)
    const hopSeconds = config.hopSize / sampleRate
    const frames = []
    const totalFrames = Math.max(1, Math.ceil(Math.max(0, samples.length - config.frameSize) / config.hopSize))

    for (let start = 0, frameIndex = 0; start + config.frameSize < samples.length; start += config.hopSize, frameIndex += 1) {
      if (frameIndex % 20 === 0) {
        self.postMessage({ type: 'progress', requestId: message.requestId, progress: clamp(frameIndex / totalFrames, 0, 0.98) })
      }
      const rms = rmsForWindow(samples, start, config.frameSize)
      const meanAbs = meanAbsForWindow(samples, start, config.frameSize)
      if (rms < config.rmsFloor && meanAbs < config.rmsFloor * 0.72) continue
      const yinPitch = detectPitchYin(samples, start, config.frameSize, sampleRate, config)
      const nsdfPitch = !yinPitch || yinPitch.confidence < 0.55
        ? detectPitchNsdf(samples, start, config.frameSize, sampleRate, config)
        : null
      const pitch = nsdfPitch && (!yinPitch || nsdfPitch.confidence > yinPitch.confidence) ? nsdfPitch : yinPitch
      if (!pitch || pitch.confidence < Math.max(0.28, confidenceThreshold - 0.22)) continue
      frames.push({
        startSeconds: start / sampleRate,
        endSeconds: (start + config.hopSize) / sampleRate,
        frequencyHz: pitch.frequencyHz,
        confidence: pitch.confidence,
        method: pitch.method
      })
    }

    const notes = mergeFramesToNotes(frames, {
      bpm,
      regionStartBeat,
      stretchRatio,
      confidenceThreshold,
      minNoteSeconds,
      mode,
      hopSeconds
    })
    self.postMessage({
      type: 'complete',
      requestId: message.requestId,
      notes,
      frameCount: frames.length,
      algorithm: `yin-nsdf-js-worker-v2:${mode}`,
      analysis: {
        frameSize: config.frameSize,
        hopSize: config.hopSize,
        sampleRate,
        minNoteSeconds,
        sensitivity,
        confidenceThreshold
      }
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      requestId: message.requestId,
      error: error?.message || 'Pitch analysis failed.'
    })
  }
}
