import { SPECTRAL_BANDS } from './audioAnalysisConstants.js'

const EPSILON = 1e-12

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value))
}

function mean(values = []) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0
}

function dbToLinear(db) {
  return 10 ** ((Number(db) || -120) / 20)
}

function frameProjectRange(entry, frame) {
  const offset = Number(entry.projectStartSeconds) || 0
  return { start: offset + frame.startSeconds, end: offset + frame.endSeconds }
}

function overlapSeconds(a, b) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start))
}

function spectralOverlap(targetBands, otherBands) {
  let intersection = 0
  let targetTotal = 0
  let otherTotal = 0
  for (const band of SPECTRAL_BANDS) {
    const target = Math.max(0, Number(targetBands?.[band.id]) || 0)
    const other = Math.max(0, Number(otherBands?.[band.id]) || 0)
    intersection += Math.min(target, other)
    targetTotal += target
    otherTotal += other
  }
  return intersection / Math.max(EPSILON, Math.min(targetTotal, otherTotal))
}

function strongestSharedBand(targetBands, otherBands) {
  return SPECTRAL_BANDS.map((band) => ({ band, score: Math.min(targetBands?.[band.id] || 0, otherBands?.[band.id] || 0) })).sort((a, b) => b.score - a.score)[0]
}

function coalesceMaskingFrames(frames) {
  const sorted = [...frames].sort((a, b) => a.startSeconds - b.startSeconds)
  const groups = []
  for (const finding of sorted) {
    const previous = groups.at(-1)
    if (previous && previous.relatedSourceId === finding.relatedSourceId && previous.details.bandId === finding.details.bandId && finding.startSeconds - previous.endSeconds < 0.16) {
      previous.endSeconds = Math.max(previous.endSeconds, finding.endSeconds)
      previous.severity = Math.max(previous.severity, finding.severity)
      previous.confidence = Math.max(previous.confidence, finding.confidence)
      previous.details.frameCount += 1
    } else groups.push({ ...finding, details: { ...finding.details, frameCount: 1 } })
  }
  return groups.map((finding, index) => ({ ...finding, id: `masking-${index}` }))
}

export function analyzeProjectContext(targetEntries = [], otherEntries = []) {
  const candidates = []
  for (const targetEntry of targetEntries) {
    for (const otherEntry of otherEntries) {
      const otherFrames = otherEntry.result?.frameFeatures || []
      let otherIndex = 0
      for (const targetFrame of targetEntry.result?.frameFeatures || []) {
        const targetRange = frameProjectRange(targetEntry, targetFrame)
        if (targetFrame.rms < 0.0001) continue
        while (otherIndex < otherFrames.length && frameProjectRange(otherEntry, otherFrames[otherIndex]).end <= targetRange.start) otherIndex += 1
        for (let scanIndex = otherIndex; scanIndex < otherFrames.length; scanIndex += 1) {
          const otherFrame = otherFrames[scanIndex]
          const otherRange = frameProjectRange(otherEntry, otherFrame)
          if (otherRange.start >= targetRange.end) break
          const temporalSeconds = overlapSeconds(targetRange, otherRange)
          if (temporalSeconds <= 0 || otherFrame.rms < 0.0001) continue
          const temporalRatio = temporalSeconds / Math.max(EPSILON, targetRange.end - targetRange.start)
          const overlap = spectralOverlap(targetFrame.bandEnergy, otherFrame.bandEnergy)
          const relativeDb = 20 * Math.log10(Math.max(EPSILON, otherFrame.rms) / Math.max(EPSILON, targetFrame.rms))
          const perceptualCompetition = clamp(1 - (Math.abs(relativeDb) / 24))
          const transientCoincidence = targetFrame.onsetStrength > 0.002 && otherFrame.onsetStrength > 0.002 ? 1 : 0
          const score = (overlap * 0.46) + (temporalRatio * 0.24) + (perceptualCompetition * 0.22) + (transientCoincidence * 0.08)
          if (score < 0.55) continue
          const shared = strongestSharedBand(targetFrame.bandEnergy, otherFrame.bandEnergy)
          candidates.push({
            id: '',
            type: 'potential-masking',
            label: `Potential masking with ${otherEntry.name || otherEntry.result?.source?.name || 'another source'}`,
            startSeconds: Math.max(targetRange.start, otherRange.start),
            endSeconds: Math.min(targetRange.end, otherRange.end),
            frequencyRangeHz: [shared.band.lowHz, shared.band.highHz],
            severity: clamp(score),
            confidence: clamp(0.45 + (score * 0.48)),
            relatedSourceId: otherEntry.result?.source?.id,
            details: {
              bandId: shared.band.id,
              otherName: otherEntry.name || otherEntry.result?.source?.name,
              spectralOverlap: overlap,
              temporalCoincidence: temporalRatio,
              relativeLevelDb: relativeDb,
              transientCoincidence: Boolean(transientCoincidence),
              signalStage: 'source'
            }
          })
        }
      }
    }
  }
  return coalesceMaskingFrames(candidates)
}

function descriptorDistance(query, candidate) {
  let bandDistance = 0
  for (const band of SPECTRAL_BANDS) bandDistance += Math.abs((query.bandEnergy?.[band.id] || 0) - (candidate.bandEnergy?.[band.id] || 0))
  const levelDistance = Math.min(1, Math.abs(20 * Math.log10(Math.max(EPSILON, query.rms) / Math.max(EPSILON, candidate.rms))) / 24)
  const onsetDistance = Math.min(1, Math.abs((query.onsetStrength || 0) - (candidate.onsetStrength || 0)) / Math.max(0.001, query.onsetStrength || 0.001))
  const centroidDistance = Math.min(1, Math.abs((query.spectralCentroidHz || 0) - (candidate.spectralCentroidHz || 0)) / 6000)
  return (bandDistance * 0.46) + (levelDistance * 0.22) + (onsetDistance * 0.18) + (centroidDistance * 0.14)
}

export function findSimilarFrames(queryFrame, cachedEntries = [], { limit = 20, minimumSimilarity = 0.78 } = {}) {
  if (!queryFrame) return []
  return cachedEntries.flatMap((entry) => (entry.result?.frameFeatures || []).map((frame) => ({
    sourceId: entry.result?.source?.id,
    sourceName: entry.name || entry.result?.source?.name,
    startSeconds: (Number(entry.projectStartSeconds) || 0) + frame.startSeconds,
    endSeconds: (Number(entry.projectStartSeconds) || 0) + frame.endSeconds,
    similarity: clamp(1 - descriptorDistance(queryFrame, frame)),
    frame
  }))).filter((match) => match.similarity >= minimumSimilarity).sort((a, b) => b.similarity - a.similarity).slice(0, limit)
}

function weightedAverage(results, getter, fallback = 0) {
  const usable = results.map((result) => ({ value: getter(result), weight: Math.max(0.001, result.source?.durationSeconds || 0) })).filter((item) => Number.isFinite(item.value))
  const weight = usable.reduce((sum, item) => sum + item.weight, 0)
  return weight ? usable.reduce((sum, item) => sum + (item.value * item.weight), 0) / weight : fallback
}

export function combineAnalysisResults(results = [], source = {}) {
  const usable = results.filter(Boolean)
  if (!usable.length) return null
  if (usable.length === 1) return { ...usable[0], source: { ...usable[0].source, ...source } }
  const base = usable[0]
  const durationSeconds = usable.reduce((sum, result) => sum + (result.source?.durationSeconds || 0), 0)
  const measurements = structuredClone(base.measurements)
  const levelKeys = ['samplePeakDbfs', 'estimatedTruePeakDbtp']
  levelKeys.forEach((key) => { measurements.levels[key] = Math.max(...usable.map((result) => result.measurements.levels[key] ?? -120)) })
  ;['rmsDbfs', 'estimatedIntegratedLufs', 'maximumShortTermLufs', 'maximumMomentaryLufs', 'loudnessRangeLu', 'crestFactorDb', 'dcOffset'].forEach((key) => {
    measurements.levels[key] = weightedAverage(usable, (result) => result.measurements.levels[key])
  })
  measurements.levels.clippingSamples = usable.reduce((sum, result) => sum + (result.measurements.levels.clippingSamples || 0), 0)
  measurements.levels.durationSeconds = durationSeconds
  Object.keys(measurements.dynamics || {}).forEach((key) => { measurements.dynamics[key] = weightedAverage(usable, (result) => result.measurements.dynamics[key]) })
  Object.keys(measurements.spectral.bands || {}).forEach((key) => { measurements.spectral.bands[key] = weightedAverage(usable, (result) => result.measurements.spectral.bands[key]) })
  measurements.spectral.centroidHz = weightedAverage(usable, (result) => result.measurements.spectral.centroidHz)
  measurements.spectral.rolloffHz = weightedAverage(usable, (result) => result.measurements.spectral.rolloffHz)
  measurements.spectral.resonanceCandidates = usable.flatMap((result) => result.measurements.spectral.resonanceCandidates || []).sort((a, b) => b.confidence - a.confidence).slice(0, 10)
  measurements.stereo.balanceDb = weightedAverage(usable, (result) => result.measurements.stereo.balanceDb)
  measurements.stereo.correlation = weightedAverage(usable, (result) => result.measurements.stereo.correlation, null)
  measurements.musical = { ...measurements.musical, bpm: null, bpmConfidence: 0, key: null, scale: null, keyConfidence: 0, beatsSeconds: [], onsetsSeconds: [] }
  let timelineOffset = 0
  const frameFeatures = []
  const timelineFindings = []
  usable.forEach((result) => {
    result.frameFeatures.forEach((frame) => frameFeatures.push({ ...frame, startSeconds: frame.startSeconds + timelineOffset, endSeconds: frame.endSeconds + timelineOffset }))
    result.timelineFindings.forEach((finding) => timelineFindings.push({ ...finding, startSeconds: (finding.startSeconds || 0) + timelineOffset, endSeconds: (finding.endSeconds || finding.startSeconds || 0) + timelineOffset }))
    timelineOffset += result.source?.durationSeconds || 0
  })
  return {
    ...base,
    source: { ...base.source, ...source, durationSeconds },
    measurements,
    detections: [...measurements.spectral.resonanceCandidates, ...timelineFindings],
    recommendations: [],
    timelineFindings,
    confidence: { ...base.confidence, musical: 0 },
    metadata: { ...base.metadata, cache: usable.every((result) => result.metadata.cache === 'hit') ? 'hit' : 'derived', analysisMs: usable.reduce((sum, result) => sum + (result.metadata.analysisMs || 0), 0), framesProcessed: frameFeatures.length },
    frameFeatures
  }
}

export function compareRegionAnalyses(entries = []) {
  const usable = entries.filter((entry) => entry?.result)
  if (usable.length < 2) return { regions: usable, commonCharacteristics: [], differences: [] }
  const loudness = usable.map((entry) => entry.result.measurements.levels.estimatedIntegratedLufs)
  const centroid = usable.map((entry) => entry.result.measurements.spectral.centroidHz)
  const crest = usable.map((entry) => entry.result.measurements.levels.crestFactorDb)
  const correlation = usable.map((entry) => entry.result.measurements.stereo.correlation).filter(Number.isFinite)
  const commonCharacteristics = []
  const differences = []
  if (Math.max(...loudness) - Math.min(...loudness) <= 1.5) commonCharacteristics.push({ type: 'common-loudness', label: 'Selections have broadly consistent estimated loudness.', confidence: 0.88 })
  if (Math.max(...centroid) - Math.min(...centroid) <= 350) commonCharacteristics.push({ type: 'common-spectrum', label: 'Selections have a similar overall spectral center.', confidence: 0.76 })
  if (correlation.length === usable.length && Math.max(...correlation) - Math.min(...correlation) <= 0.12) commonCharacteristics.push({ type: 'common-stereo', label: 'Selections have a similar stereo relationship.', confidence: 0.78 })
  const loudestIndex = loudness.indexOf(Math.max(...loudness))
  const quietestIndex = loudness.indexOf(Math.min(...loudness))
  const loudnessDifference = loudness[loudestIndex] - loudness[quietestIndex]
  if (loudnessDifference > 1.5) differences.push({ type: 'relative-loudness', label: `${usable[loudestIndex].name} is approximately ${loudnessDifference.toFixed(1)} dB louder than ${usable[quietestIndex].name}.`, confidence: 0.94, details: { louderId: usable[loudestIndex].id, quieterId: usable[quietestIndex].id, differenceDb: loudnessDifference } })
  const brightestIndex = centroid.indexOf(Math.max(...centroid))
  const darkestIndex = centroid.indexOf(Math.min(...centroid))
  if (centroid[brightestIndex] - centroid[darkestIndex] > 500) differences.push({ type: 'spectral-balance', label: `${usable[brightestIndex].name} contains proportionally more high-frequency energy than ${usable[darkestIndex].name}.`, confidence: 0.8, details: { brighterId: usable[brightestIndex].id, darkerId: usable[darkestIndex].id } })
  const mostDynamic = crest.indexOf(Math.max(...crest))
  const leastDynamic = crest.indexOf(Math.min(...crest))
  if (crest[mostDynamic] - crest[leastDynamic] > 2) differences.push({ type: 'dynamic-range', label: `${usable[mostDynamic].name} has a ${Number(crest[mostDynamic] - crest[leastDynamic]).toFixed(1)} dB greater crest factor than ${usable[leastDynamic].name}.`, confidence: 0.86 })
  return { regions: usable, commonCharacteristics, differences }
}

export function applyRegionGain(result, gainDb = 0) {
  const gain = dbToLinear(gainDb)
  if (!Number.isFinite(gainDb) || Math.abs(gainDb) < 0.001) return result
  const clone = structuredClone(result)
  ;['samplePeakDbfs', 'estimatedTruePeakDbtp', 'rmsDbfs', 'estimatedIntegratedLufs', 'maximumShortTermLufs', 'maximumMomentaryLufs'].forEach((key) => {
    if (Number.isFinite(clone.measurements.levels[key])) clone.measurements.levels[key] += gainDb
  })
  clone.frameFeatures.forEach((frame) => {
    frame.peak *= gain
    frame.rms *= gain
    frame.leftRms *= gain
    frame.rightRms *= gain
  })
  return clone
}
