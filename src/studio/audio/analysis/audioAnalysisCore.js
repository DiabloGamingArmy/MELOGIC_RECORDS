import {
  AUDIO_ANALYSIS_VERSION,
  SPECTRAL_BANDS,
  getAnalysisProfile
} from './audioAnalysisConstants.js'

const EPSILON = 1e-12
const PITCH_CLASSES = ['C', 'C♯/D♭', 'D', 'D♯/E♭', 'E', 'F', 'F♯/G♭', 'G', 'G♯/A♭', 'A', 'A♯/B♭', 'B']

export function linearToDb(value) {
  return value > EPSILON ? 20 * Math.log10(value) : -120
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value))
}

function mean(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function percentile(values = [], amount = 0.5) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = clamp(amount, 0, 1) * (sorted.length - 1)
  const low = Math.floor(index)
  const high = Math.ceil(index)
  return sorted[low] + ((sorted[high] - sorted[low]) * (index - low))
}

function abortError() {
  const error = new Error('Audio analysis was cancelled.')
  error.name = 'AbortError'
  return error
}

function assertNotCancelled(isCancelled) {
  if (isCancelled?.()) throw abortError()
}

function nextPowerOfTwo(value) {
  let size = 1
  while (size < value) size <<= 1
  return size
}

function fftPowerSpectrum(samples, size) {
  const fftSize = nextPowerOfTwo(size)
  const real = new Float64Array(fftSize)
  const imag = new Float64Array(fftSize)
  for (let index = 0; index < size; index += 1) {
    const window = 0.5 - (0.5 * Math.cos((2 * Math.PI * index) / Math.max(1, size - 1)))
    real[index] = (samples[index] || 0) * window
  }
  for (let index = 1, swap = 0; index < fftSize; index += 1) {
    let bit = fftSize >> 1
    for (; swap & bit; bit >>= 1) swap ^= bit
    swap ^= bit
    if (index < swap) {
      const tempReal = real[index]
      const tempImag = imag[index]
      real[index] = real[swap]
      imag[index] = imag[swap]
      real[swap] = tempReal
      imag[swap] = tempImag
    }
  }
  for (let length = 2; length <= fftSize; length <<= 1) {
    const angle = (-2 * Math.PI) / length
    const wLengthReal = Math.cos(angle)
    const wLengthImag = Math.sin(angle)
    for (let offset = 0; offset < fftSize; offset += length) {
      let wReal = 1
      let wImag = 0
      for (let index = 0; index < length / 2; index += 1) {
        const even = offset + index
        const odd = even + (length / 2)
        const oddReal = (real[odd] * wReal) - (imag[odd] * wImag)
        const oddImag = (real[odd] * wImag) + (imag[odd] * wReal)
        real[odd] = real[even] - oddReal
        imag[odd] = imag[even] - oddImag
        real[even] += oddReal
        imag[even] += oddImag
        const nextWReal = (wReal * wLengthReal) - (wImag * wLengthImag)
        wImag = (wReal * wLengthImag) + (wImag * wLengthReal)
        wReal = nextWReal
      }
    }
  }
  const spectrum = new Float64Array(fftSize / 2)
  for (let index = 0; index < spectrum.length; index += 1) {
    spectrum[index] = ((real[index] * real[index]) + (imag[index] * imag[index])) / (fftSize * fftSize)
  }
  return spectrum
}

function estimateInterpolatedPeak(channel) {
  let peak = 0
  for (let index = 1; index < channel.length - 2; index += 1) {
    const y0 = channel[index - 1]
    const y1 = channel[index]
    const y2 = channel[index + 1]
    const y3 = channel[index + 2]
    peak = Math.max(peak, Math.abs(y1))
    for (let step = 1; step < 4; step += 1) {
      const t = step / 4
      const a0 = (-0.5 * y0) + (1.5 * y1) - (1.5 * y2) + (0.5 * y3)
      const a1 = y0 - (2.5 * y1) + (2 * y2) - (0.5 * y3)
      const a2 = (-0.5 * y0) + (0.5 * y2)
      const value = ((a0 * t + a1) * t + a2) * t + y1
      peak = Math.max(peak, Math.abs(value))
    }
  }
  return peak
}

function scanLevels(channels, sampleRate, isCancelled) {
  const length = channels[0]?.length || 0
  let sumSquares = 0
  let sum = 0
  let samplePeak = 0
  let clippingSamples = 0
  let leftSquares = 0
  let rightSquares = 0
  let cross = 0
  let sideSquares = 0
  let midSquares = 0
  let lowLeft = 0
  let lowRight = 0
  let lowMidSquares = 0
  let lowSideSquares = 0
  const lowPassPole = Math.exp((-2 * Math.PI * 200) / Math.max(1, sampleRate))
  for (let index = 0; index < length; index += 1) {
    if ((index & 131071) === 0) assertNotCancelled(isCancelled)
    let mono = 0
    for (const channel of channels) {
      const value = Number(channel[index]) || 0
      mono += value / channels.length
      samplePeak = Math.max(samplePeak, Math.abs(value))
      if (Math.abs(value) >= 0.999) clippingSamples += 1
    }
    sum += mono
    sumSquares += mono * mono
    if (channels.length > 1) {
      const left = channels[0][index] || 0
      const right = channels[1][index] || 0
      leftSquares += left * left
      rightSquares += right * right
      cross += left * right
      const mid = (left + right) * 0.5
      const side = (left - right) * 0.5
      midSquares += mid * mid
      sideSquares += side * side
      lowLeft = ((1 - lowPassPole) * left) + (lowPassPole * lowLeft)
      lowRight = ((1 - lowPassPole) * right) + (lowPassPole * lowRight)
      const lowMid = (lowLeft + lowRight) * 0.5
      const lowSide = (lowLeft - lowRight) * 0.5
      lowMidSquares += lowMid * lowMid
      lowSideSquares += lowSide * lowSide
    }
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, length))
  const leftRms = Math.sqrt(leftSquares / Math.max(1, length))
  const rightRms = channels.length > 1 ? Math.sqrt(rightSquares / Math.max(1, length)) : leftRms
  const correlationDenominator = Math.sqrt(leftSquares * rightSquares)
  const truePeak = Math.max(...channels.map(estimateInterpolatedPeak), samplePeak)
  return {
    length,
    durationSeconds: length / Math.max(1, sampleRate),
    samplePeak,
    truePeak,
    rms,
    dcOffset: sum / Math.max(1, length),
    clippingSamples,
    leftRms,
    rightRms,
    correlation: channels.length > 1 && correlationDenominator > EPSILON ? clamp(cross / correlationDenominator, -1, 1) : null,
    sideMidRatio: channels.length > 1 ? Math.sqrt(sideSquares / Math.max(EPSILON, midSquares)) : 0,
    lowFrequencySideRatio: channels.length > 1 ? Math.sqrt(lowSideSquares / Math.max(EPSILON, lowMidSquares)) : 0
  }
}

function getFrameBandEnergy(spectrum, sampleRate, fftSize) {
  const bandEnergy = {}
  let total = 0
  for (const band of SPECTRAL_BANDS) {
    const lowBin = Math.max(1, Math.floor((band.lowHz * fftSize) / sampleRate))
    const highBin = Math.min(spectrum.length - 1, Math.ceil((Math.min(band.highHz, sampleRate / 2) * fftSize) / sampleRate))
    let energy = 0
    for (let bin = lowBin; bin <= highBin; bin += 1) energy += spectrum[bin]
    bandEnergy[band.id] = energy
    total += energy
  }
  if (total > EPSILON) Object.keys(bandEnergy).forEach((key) => { bandEnergy[key] /= total })
  return bandEnergy
}

function spectralSummary(spectrum, sampleRate, fftSize) {
  let sumPower = 0
  let weighted = 0
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    sumPower += spectrum[bin]
    weighted += spectrum[bin] * frequency
  }
  const centroid = sumPower > EPSILON ? weighted / sumPower : 0
  const rolloffTarget = sumPower * 0.85
  let cumulative = 0
  let rolloff = 0
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    cumulative += spectrum[bin]
    if (cumulative >= rolloffTarget) {
      rolloff = (bin * sampleRate) / fftSize
      break
    }
  }
  const chroma = Array(12).fill(0)
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    if (frequency < 55 || frequency > 5000) continue
    const midi = Math.round(69 + (12 * Math.log2(frequency / 440)))
    chroma[((midi % 12) + 12) % 12] += spectrum[bin]
  }
  const chromaSum = chroma.reduce((sum, value) => sum + value, 0)
  if (chromaSum > EPSILON) chroma.forEach((value, index) => { chroma[index] = value / chromaSum })
  return { centroid, rolloff, chroma, sumPower }
}

function spectralPeakSummary(spectrum, sampleRate, fftSize) {
  const peaks = []
  for (let bin = 3; bin < spectrum.length - 3; bin += 1) {
    const frequencyHz = (bin * sampleRate) / fftSize
    if (frequencyHz < 60 || frequencyHz > Math.min(18000, sampleRate / 2)) continue
    const local = (spectrum[bin - 3] + spectrum[bin - 2] + spectrum[bin - 1] + spectrum[bin + 1] + spectrum[bin + 2] + spectrum[bin + 3]) / 6
    const prominence = spectrum[bin] / Math.max(EPSILON, local)
    if (prominence > 1.7 && spectrum[bin] >= spectrum[bin - 1] && spectrum[bin] >= spectrum[bin + 1]) peaks.push({ frequencyHz, prominence, power: spectrum[bin] })
  }
  return peaks.sort((a, b) => (b.prominence * b.power) - (a.prominence * a.power)).slice(0, 12).map(({ frequencyHz, prominence }) => ({ frequencyHz, prominence }))
}

function frameStereo(channels, start, end) {
  if (channels.length < 2) return { leftRms: 0, rightRms: 0, correlation: null }
  let leftSquares = 0
  let rightSquares = 0
  let cross = 0
  for (let index = start; index < end; index += 1) {
    const left = channels[0][index] || 0
    const right = channels[1][index] || 0
    leftSquares += left * left
    rightSquares += right * right
    cross += left * right
  }
  const count = Math.max(1, end - start)
  const denominator = Math.sqrt(leftSquares * rightSquares)
  return {
    leftRms: Math.sqrt(leftSquares / count),
    rightRms: Math.sqrt(rightSquares / count),
    correlation: denominator > EPSILON ? clamp(cross / denominator, -1, 1) : null
  }
}

function buildFrames(channels, sampleRate, profile, { isCancelled, onProgress } = {}) {
  const config = getAnalysisProfile(profile)
  const length = channels[0]?.length || 0
  const frameCount = length <= config.frameSize
    ? 1
    : Math.ceil((length - config.frameSize) / config.hopSize) + 1
  const frames = []
  const aggregateSpectrum = new Float64Array(config.frameSize / 2)
  let previousRms = 0
  for (let frameIndex = 0; frameIndex < frameCount; frameIndex += 1) {
    assertNotCancelled(isCancelled)
    const start = frameIndex * config.hopSize
    const end = Math.min(length, start + config.frameSize)
    const mono = new Float64Array(config.frameSize)
    let sumSquares = 0
    let sum = 0
    let peak = 0
    let clippingSamples = 0
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
      let value = 0
      for (const channel of channels) value += (Number(channel[sampleIndex]) || 0) / channels.length
      const localIndex = sampleIndex - start
      mono[localIndex] = value
      sum += value
      sumSquares += value * value
      peak = Math.max(peak, Math.abs(value))
      if (Math.abs(value) >= 0.999) clippingSamples += 1
    }
    const count = Math.max(1, end - start)
    const rms = Math.sqrt(sumSquares / count)
    const spectrum = fftPowerSpectrum(mono, config.frameSize)
    for (let bin = 0; bin < spectrum.length; bin += config.spectralStride) aggregateSpectrum[bin] += spectrum[bin]
    const spectral = spectralSummary(spectrum, sampleRate, config.frameSize)
    const stereo = frameStereo(channels, start, end)
    frames.push({
      startSeconds: start / sampleRate,
      endSeconds: end / sampleRate,
      peak,
      rms,
      dcOffset: sum / count,
      clippingSamples,
      leftRms: stereo.leftRms,
      rightRms: stereo.rightRms,
      correlation: stereo.correlation,
      spectralCentroidHz: spectral.centroid,
      spectralRolloffHz: spectral.rolloff,
      bandEnergy: getFrameBandEnergy(spectrum, sampleRate, config.frameSize),
      chroma: spectral.chroma,
      onsetStrength: Math.max(0, rms - previousRms),
      spectralPeaks: spectralPeakSummary(spectrum, sampleRate, config.frameSize)
    })
    previousRms = (previousRms * 0.55) + (rms * 0.45)
    if (frameIndex % 8 === 0 || frameIndex === frameCount - 1) {
      onProgress?.({ phase: 'Spectral analysis', progress: 0.15 + (0.68 * ((frameIndex + 1) / frameCount)) })
    }
  }
  return { frames, aggregateSpectrum, config }
}

function findOnsets(frames) {
  const strengths = frames.map((frame) => frame.onsetStrength)
  const threshold = Math.max(percentile(strengths, 0.78), mean(strengths) * 1.35, 0.0005)
  const onsets = []
  for (let index = 1; index < frames.length - 1; index += 1) {
    if (strengths[index] >= threshold && strengths[index] >= strengths[index - 1] && strengths[index] >= strengths[index + 1]) {
      onsets.push({ seconds: frames[index].startSeconds, strength: strengths[index] })
    }
  }
  return onsets
}

function estimateTempo(frames, onsets) {
  if (frames.length < 8 || onsets.length < 4) return { bpm: null, confidence: 0, beats: [] }
  const hopSeconds = Math.max(0.001, frames[1].startSeconds - frames[0].startSeconds)
  const envelope = frames.map((frame) => frame.onsetStrength)
  let bestLag = 0
  let bestScore = 0
  let totalEnergy = envelope.reduce((sum, value) => sum + (value * value), 0)
  const minLag = Math.max(1, Math.floor((60 / 200) / hopSeconds))
  const maxLag = Math.min(envelope.length - 2, Math.ceil((60 / 55) / hopSeconds))
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0
    for (let index = lag; index < envelope.length; index += 1) score += envelope[index] * envelope[index - lag]
    if (score > bestScore) { bestScore = score; bestLag = lag }
  }
  if (!bestLag || totalEnergy <= EPSILON) return { bpm: null, confidence: 0, beats: [] }
  const bpm = 60 / (bestLag * hopSeconds)
  const confidence = clamp(bestScore / totalEnergy, 0, 1)
  const start = onsets[0]?.seconds || 0
  const beatSeconds = 60 / bpm
  const duration = frames.at(-1)?.endSeconds || 0
  const beats = []
  for (let seconds = start; seconds <= duration && beats.length < 10000; seconds += beatSeconds) beats.push(seconds)
  return { bpm, confidence, beats }
}

function estimateKey(frames) {
  const chroma = Array(12).fill(0)
  frames.forEach((frame) => frame.chroma.forEach((value, index) => { chroma[index] += value }))
  const major = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
  const minor = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
  const scores = []
  for (let root = 0; root < 12; root += 1) {
    scores.push({ root, scale: 'major', score: major.reduce((sum, weight, index) => sum + weight * chroma[(index + root) % 12], 0) })
    scores.push({ root, scale: 'minor', score: minor.reduce((sum, weight, index) => sum + weight * chroma[(index + root) % 12], 0) })
  }
  scores.sort((a, b) => b.score - a.score)
  const best = scores[0]
  const runnerUp = scores[1]
  const confidence = best?.score > EPSILON ? clamp((best.score - runnerUp.score) / best.score * 4, 0, 1) : 0
  return best ? { key: PITCH_CLASSES[best.root], scale: best.scale, confidence, chroma } : { key: null, scale: null, confidence: 0, chroma }
}

function detectResonances(aggregateSpectrum, frames, sampleRate, fftSize, frameCount, limit) {
  const bins = []
  const normalized = Array.from(aggregateSpectrum, (value) => value / Math.max(1, frameCount))
  for (let bin = 3; bin < normalized.length - 3; bin += 1) {
    const frequency = (bin * sampleRate) / fftSize
    if (frequency < 80 || frequency > Math.min(16000, sampleRate / 2)) continue
    const local = (normalized[bin - 3] + normalized[bin - 2] + normalized[bin - 1] + normalized[bin + 1] + normalized[bin + 2] + normalized[bin + 3]) / 6
    const prominence = normalized[bin] / Math.max(EPSILON, local)
    if (prominence > 2.2 && normalized[bin] > EPSILON) bins.push({ bin, frequency, prominence, power: normalized[bin] })
  }
  bins.sort((a, b) => (b.prominence * b.power) - (a.prominence * a.power))
  const picked = []
  for (const candidate of bins) {
    if (picked.some((item) => Math.abs(Math.log2(item.frequency / candidate.frequency)) < 0.045)) continue
    picked.push(candidate)
    if (picked.length >= limit) break
  }
  const maximumProminence = Math.max(3, ...picked.map((item) => item.prominence))
  return picked.map((item, index) => {
    const persistentFrames = frames.filter((frame) => frame.spectralPeaks?.some((peak) => Math.abs(Math.log2(peak.frequencyHz / item.frequency)) < 0.035 && peak.prominence > 1.8)).length
    const persistence = persistentFrames / Math.max(1, frames.length)
    return {
    id: `resonance-${index}`,
    type: 'resonance-candidate',
    label: `Persistent spectral concentration near ${Math.round(item.frequency)} Hz`,
    frequencyHz: item.frequency,
    frequencyRangeHz: [item.frequency * 0.94, item.frequency * 1.06],
    severity: clamp((item.prominence - 2) / 6, 0, 1),
    confidence: clamp(0.34 + (0.34 * item.prominence / maximumProminence) + (0.36 * Math.sqrt(persistence)), 0, 0.96),
    details: { relativeProminence: item.prominence, timePersistence: persistence }
  }})
}

function rollingMaximumLoudness(frames, windowSeconds) {
  if (!frames.length) return -120
  const hop = Math.max(0.001, frames[1]?.startSeconds - frames[0].startSeconds || frames[0].endSeconds)
  const count = Math.max(1, Math.round(windowSeconds / hop))
  let sumSquares = 0
  let maximum = 0
  for (let index = 0; index < frames.length; index += 1) {
    sumSquares += frames[index].rms ** 2
    if (index >= count) sumSquares -= frames[index - count].rms ** 2
    maximum = Math.max(maximum, Math.sqrt(sumSquares / Math.min(count, index + 1)))
  }
  return linearToDb(maximum)
}

function summarizeFrames(frames, levels, sampleRate, channelCount, musical = true) {
  const rmsValues = frames.map((frame) => frame.rms)
  const loudnessValues = rmsValues.map(linearToDb).filter((value) => value > -70)
  const bandEnergy = {}
  SPECTRAL_BANDS.forEach((band) => { bandEnergy[band.id] = mean(frames.map((frame) => frame.bandEnergy[band.id] || 0)) })
  const onsets = findOnsets(frames)
  const tempo = musical ? estimateTempo(frames, onsets) : { bpm: null, confidence: 0, beats: [] }
  const key = musical ? estimateKey(frames) : { key: null, scale: null, confidence: 0, chroma: Array(12).fill(0) }
  const leftRms = levels?.leftRms ?? Math.sqrt(mean(frames.map((frame) => frame.leftRms ** 2)))
  const rightRms = levels?.rightRms ?? Math.sqrt(mean(frames.map((frame) => frame.rightRms ** 2)))
  const correlationValues = frames.map((frame) => frame.correlation).filter(Number.isFinite)
  const rms = levels?.rms ?? Math.sqrt(mean(rmsValues.map((value) => value ** 2)))
  const samplePeak = levels?.samplePeak ?? Math.max(0, ...frames.map((frame) => frame.peak))
  const durationSeconds = levels?.durationSeconds ?? Math.max(0, (frames.at(-1)?.endSeconds || 0) - (frames[0]?.startSeconds || 0))
  const clippingSamples = levels?.clippingSamples ?? frames.reduce((sum, frame) => sum + frame.clippingSamples, 0)
  const dcOffset = levels?.dcOffset ?? mean(frames.map((frame) => frame.dcOffset))
  const correlation = levels?.correlation ?? (correlationValues.length ? mean(correlationValues) : null)
  return {
    levels: {
      samplePeakDbfs: linearToDb(samplePeak),
      estimatedTruePeakDbtp: linearToDb(levels?.truePeak ?? samplePeak),
      rmsDbfs: linearToDb(rms),
      estimatedIntegratedLufs: linearToDb(rms) - 0.691,
      maximumShortTermLufs: rollingMaximumLoudness(frames, 3) - 0.691,
      maximumMomentaryLufs: rollingMaximumLoudness(frames, 0.4) - 0.691,
      loudnessRangeLu: Math.max(0, percentile(loudnessValues, 0.95) - percentile(loudnessValues, 0.1)),
      crestFactorDb: linearToDb(samplePeak) - linearToDb(rms),
      dcOffset,
      clippingSamples,
      durationSeconds
    },
    dynamics: {
      transientDensityPerSecond: onsets.length / Math.max(0.001, durationSeconds),
      macroVariationDb: Math.max(0, percentile(loudnessValues, 0.9) - percentile(loudnessValues, 0.1)),
      microVariationDb: Math.max(0, percentile(loudnessValues, 0.75) - percentile(loudnessValues, 0.25)),
      noiseFloorEstimateDbfs: percentile(loudnessValues, 0.1) || -120
    },
    spectral: {
      bands: bandEnergy,
      centroidHz: mean(frames.map((frame) => frame.spectralCentroidHz)),
      rolloffHz: mean(frames.map((frame) => frame.spectralRolloffHz))
    },
    stereo: {
      channelCount,
      leftRmsDbfs: linearToDb(leftRms),
      rightRmsDbfs: linearToDb(rightRms),
      balanceDb: channelCount > 1 ? linearToDb(rightRms) - linearToDb(leftRms) : 0,
      correlation,
      widthSideMidRatio: levels?.sideMidRatio ?? 0,
      lowFrequencyStereoRatio: levels?.lowFrequencySideRatio ?? 0,
      monoCompatible: correlation == null ? true : correlation >= -0.1
    },
    musical: {
      bpm: tempo.bpm,
      bpmConfidence: tempo.confidence,
      beatsSeconds: tempo.beats,
      onsetsSeconds: onsets.map((onset) => onset.seconds),
      key: key.key,
      scale: key.scale,
      keyConfidence: key.confidence,
      tuningHz: 440,
      tuningConfidence: 0,
      chroma: key.chroma
    },
    waveform: frames.map((frame) => ({ startSeconds: frame.startSeconds, peak: frame.peak, rms: frame.rms }))
  }
}

function buildTimelineFindings(frames) {
  const findings = []
  let silenceStart = null
  frames.forEach((frame, index) => {
    if (frame.clippingSamples > 0) {
      findings.push({ id: `clip-${index}`, type: 'probable-clipping', label: 'Probable clipping', startSeconds: frame.startSeconds, endSeconds: frame.endSeconds, severity: clamp(frame.clippingSamples / 8, 0.35, 1), confidence: 0.98 })
    }
    if (linearToDb(frame.rms) < -70) {
      if (silenceStart == null) silenceStart = frame.startSeconds
    } else if (silenceStart != null) {
      if (frame.startSeconds - silenceStart >= 0.2) findings.push({ id: `silence-${index}`, type: 'silence', label: 'Silence or near-silence', startSeconds: silenceStart, endSeconds: frame.startSeconds, severity: 0.2, confidence: 0.95 })
      silenceStart = null
    }
  })
  if (silenceStart != null) findings.push({ id: 'silence-tail', type: 'silence', label: 'Silence or near-silence', startSeconds: silenceStart, endSeconds: frames.at(-1)?.endSeconds || silenceStart, severity: 0.2, confidence: 0.95 })
  return findings
}

export function createEmptyAnalysisResult(request = {}, provider = 'web-fallback') {
  const sampleRate = Number(request.sampleRate) || 44100
  const channelCount = Math.max(1, Number(request.channels?.length || request.source?.channelCount) || 1)
  const source = {
    id: request.source?.id || 'unknown-source',
    revision: request.source?.revision || 'unknown',
    name: request.source?.name || 'Untitled audio',
    sampleRate,
    channelCount,
    durationSeconds: 0
  }
  return {
    version: AUDIO_ANALYSIS_VERSION,
    mode: request.mode || 'independent',
    scope: request.scope || 'track',
    profile: request.profile || 'standard',
    source,
    measurements: summarizeFrames([], { rms: 0, samplePeak: 0, truePeak: 0, durationSeconds: 0, clippingSamples: 0, dcOffset: 0, leftRms: 0, rightRms: 0, correlation: null, sideMidRatio: 0 }, sampleRate, channelCount, false),
    detections: [],
    recommendations: [],
    timelineFindings: [],
    confidence: { levels: 1, dynamics: 0, spectral: 0, stereo: channelCount > 1 ? 0 : 1, musical: 0 },
    metadata: {
      provider,
      signalStage: 'source',
      cache: 'miss',
      analyzedAt: new Date().toISOString(),
      analysisMs: 0,
      framesProcessed: 0,
      standards: { loudness: 'non-standard RMS-derived estimate', truePeak: '4x cubic interpolation estimate' },
      warnings: ['No audio samples were available.']
    },
    frameFeatures: []
  }
}

export function analyzePcmSource(request = {}, options = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now()
  const channels = (request.channels || []).filter((channel) => channel?.length != null)
  const sampleRate = Math.max(8000, Number(request.sampleRate) || 44100)
  if (!channels.length || !channels[0].length) return createEmptyAnalysisResult(request, options.provider || 'web-fallback')
  const length = Math.min(...channels.map((channel) => channel.length))
  const normalizedChannels = channels.map((channel) => channel.length === length ? channel : channel.subarray(0, length))
  options.onProgress?.({ phase: 'Level scan', progress: 0.04 })
  const levels = scanLevels(normalizedChannels, sampleRate, options.isCancelled)
  options.onProgress?.({ phase: 'Frame analysis', progress: 0.15 })
  const { frames, aggregateSpectrum, config } = buildFrames(normalizedChannels, sampleRate, request.profile, options)
  assertNotCancelled(options.isCancelled)
  options.onProgress?.({ phase: 'Musical analysis', progress: 0.86 })
  const measurements = summarizeFrames(frames, levels, sampleRate, normalizedChannels.length, getAnalysisProfile(request.profile).musical)
  const resonances = detectResonances(aggregateSpectrum, frames, sampleRate, config.frameSize, frames.length, config.resonanceLimit)
  measurements.spectral.resonanceCandidates = resonances
  const timelineFindings = buildTimelineFindings(frames)
  const detections = [...resonances, ...timelineFindings]
  if (measurements.levels.clippingSamples > 0) detections.push({ id: 'clipping-summary', type: 'probable-clipping', label: `${measurements.levels.clippingSamples} samples at or above the clipping threshold`, severity: clamp(measurements.levels.clippingSamples / 64, 0.3, 1), confidence: 0.99 })
  if (Math.abs(measurements.levels.dcOffset) > 0.01) detections.push({ id: 'dc-offset', type: 'dc-offset', label: 'Measurable DC offset', severity: clamp(Math.abs(measurements.levels.dcOffset) * 12, 0, 1), confidence: 0.95 })
  const analysisMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt
  options.onProgress?.({ phase: 'Complete', progress: 1 })
  return {
    version: AUDIO_ANALYSIS_VERSION,
    mode: request.mode || 'independent',
    scope: request.scope || 'track',
    profile: request.profile || 'standard',
    source: {
      id: request.source?.id || 'unknown-source',
      revision: request.source?.revision || 'unknown',
      name: request.source?.name || 'Untitled audio',
      sampleRate,
      channelCount: normalizedChannels.length,
      durationSeconds: levels.durationSeconds
    },
    measurements,
    detections,
    recommendations: [],
    timelineFindings,
    confidence: {
      levels: 1,
      dynamics: clamp(levels.durationSeconds / 5, 0.25, 1),
      spectral: clamp(levels.durationSeconds / 3, 0.25, 1),
      stereo: normalizedChannels.length > 1 ? clamp(levels.durationSeconds / 2, 0.4, 1) : 1,
      musical: measurements.musical.bpmConfidence || measurements.musical.keyConfidence || 0
    },
    metadata: {
      provider: options.provider || 'web-fallback',
      signalStage: 'source',
      cache: 'miss',
      analyzedAt: new Date().toISOString(),
      analysisMs,
      framesProcessed: frames.length,
      standards: { loudness: 'non-standard RMS-derived estimate', truePeak: '4x cubic interpolation estimate' },
      warnings: [
        'Web loudness values are engineering estimates, not ITU-R BS.1770/EBU R128 measurements.',
        'Estimated true peak is not a standards-certified dBTP measurement.'
      ]
    },
    frameFeatures: frames
  }
}

export function deriveIntervalAnalysis(sourceResult, interval = {}) {
  const startSeconds = clamp(Number(interval.startSeconds) || 0, 0, sourceResult.source.durationSeconds)
  const endSeconds = clamp(Number(interval.endSeconds) || sourceResult.source.durationSeconds, startSeconds, sourceResult.source.durationSeconds)
  const playbackRate = Math.max(0.05, Number(interval.playbackRate) || 1)
  let selectedFrames = sourceResult.frameFeatures.filter((frame) => {
    const centerSeconds = (frame.startSeconds + frame.endSeconds) * 0.5
    return centerSeconds >= startSeconds && centerSeconds < endSeconds
  })
  if (!selectedFrames.length && sourceResult.frameFeatures.length && endSeconds > startSeconds) {
    selectedFrames = [sourceResult.frameFeatures.reduce((closest, frame) => {
      const center = (frame.startSeconds + frame.endSeconds) * 0.5
      const distance = Math.abs(center - ((startSeconds + endSeconds) * 0.5))
      return !closest || distance < closest.distance ? { frame, distance } : closest
    }, null).frame]
  }
  const frames = selectedFrames.map((frame) => ({
    ...frame,
    startSeconds: Math.max(0, (frame.startSeconds - startSeconds) / playbackRate),
    endSeconds: Math.max(0, (Math.min(endSeconds, frame.endSeconds) - startSeconds) / playbackRate)
  }))
  const durationSeconds = Math.max(0, (endSeconds - startSeconds) / playbackRate)
  const measurements = summarizeFrames(frames, {
    rms: Math.sqrt(mean(frames.map((frame) => frame.rms ** 2))),
    samplePeak: Math.max(0, ...frames.map((frame) => frame.peak)),
    truePeak: Math.max(0, ...frames.map((frame) => frame.peak)),
    durationSeconds,
    clippingSamples: frames.reduce((sum, frame) => sum + frame.clippingSamples, 0),
    dcOffset: mean(frames.map((frame) => frame.dcOffset)),
    leftRms: Math.sqrt(mean(frames.map((frame) => frame.leftRms ** 2))),
    rightRms: Math.sqrt(mean(frames.map((frame) => frame.rightRms ** 2))),
    correlation: mean(frames.map((frame) => frame.correlation).filter(Number.isFinite)),
    sideMidRatio: sourceResult.measurements.stereo.widthSideMidRatio
  }, sourceResult.source.sampleRate, sourceResult.source.channelCount, sourceResult.profile !== 'quick')
  measurements.spectral.resonanceCandidates = (sourceResult.measurements.spectral.resonanceCandidates || []).map((item) => ({ ...item }))
  const timelineFindings = sourceResult.timelineFindings.filter((finding) => (finding.endSeconds ?? finding.startSeconds ?? 0) >= startSeconds && (finding.startSeconds ?? 0) <= endSeconds).map((finding) => ({
    ...finding,
    startSeconds: Math.max(0, ((finding.startSeconds ?? startSeconds) - startSeconds) / playbackRate),
    endSeconds: Math.max(0, ((finding.endSeconds ?? finding.startSeconds ?? startSeconds) - startSeconds) / playbackRate)
  }))
  return {
    ...sourceResult,
    mode: 'single-region',
    scope: 'region',
    source: { ...sourceResult.source, name: interval.name || sourceResult.source.name, durationSeconds },
    measurements,
    detections: [...(measurements.spectral.resonanceCandidates || []), ...timelineFindings],
    recommendations: [],
    timelineFindings,
    metadata: { ...sourceResult.metadata, cache: 'derived', framesProcessed: frames.length, analysisMs: 0 },
    frameFeatures: frames
  }
}
