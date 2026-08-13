import { RECOMMENDATION_THRESHOLDS } from './audioAnalysisConstants.js'

const SOURCE_HINTS = Object.freeze({
  vocal: { focusBands: ['upperMid', 'presence'], lowBandCaution: true },
  drums: { focusBands: ['sub', 'bass', 'upperMid'], transientPriority: true },
  bass: { focusBands: ['sub', 'bass', 'lowMid'], lowBandCaution: false },
  guitar: { focusBands: ['lowMid', 'mid', 'upperMid'] },
  keys: { focusBands: ['lowMid', 'mid', 'presence'] },
  synth: { focusBands: ['bass', 'mid', 'presence'] },
  fx: { focusBands: [] },
  'full-mix': { focusBands: ['sub', 'bass', 'lowMid', 'mid', 'upperMid', 'presence', 'air'] },
  other: { focusBands: [] },
  auto: { focusBands: [] }
})

function recommendation(id, category, title, message, confidence, relatedDetectionIds = []) {
  return { id, category, title, message, confidence: Math.max(0, Math.min(1, confidence)), relatedDetectionIds }
}

export function buildRecommendations(result, { sourceType = 'auto', contextFindings = [] } = {}) {
  if (!result?.measurements) return []
  const output = []
  const levels = result.measurements.levels || {}
  const stereo = result.measurements.stereo || {}
  const spectral = result.measurements.spectral || {}
  const hint = SOURCE_HINTS[sourceType] || SOURCE_HINTS.auto

  if (levels.clippingSamples >= RECOMMENDATION_THRESHOLDS.clippingSamples) {
    output.push(recommendation('rec-clipping', 'levels', 'Potential clipping', 'Detected samples at or near full scale. Consider checking source gain and the located events before adding further level.', 0.98, ['clipping-summary']))
  } else if (levels.samplePeakDbfs > RECOMMENDATION_THRESHOLDS.hotSamplePeakDbfs) {
    output.push(recommendation('rec-headroom', 'levels', 'Limited peak headroom', 'Peak level is close to full scale. Consider preserving more headroom if later processing may add gain.', 0.88))
  }
  if (Math.abs(levels.dcOffset || 0) > RECOMMENDATION_THRESHOLDS.highDcOffset) {
    output.push(recommendation('rec-dc', 'technical', 'Potential DC offset', 'A measurable waveform offset was detected. Consider a DC-removal or high-pass stage if the offset is not intentional.', 0.91, ['dc-offset']))
  }
  if (Number.isFinite(levels.crestFactorDb) && levels.crestFactorDb < RECOMMENDATION_THRESHOLDS.lowCrestDb) {
    output.push(recommendation('rec-restriction', 'dynamics', 'Restricted peak-to-average range', 'The measured crest factor is low. This may be intentional; if the source feels flat, consider reviewing upstream limiting or compression.', 0.68))
  }
  if (stereo.channelCount > 1 && stereo.correlation < RECOMMENDATION_THRESHOLDS.negativeCorrelation) {
    output.push(recommendation('rec-polarity', 'stereo', 'Possible mono-compatibility issue', 'Negative stereo correlation was measured. Consider checking polarity and auditioning the source in mono.', 0.92))
  } else if (stereo.channelCount > 1 && stereo.correlation < RECOMMENDATION_THRESHOLDS.lowCorrelation) {
    output.push(recommendation('rec-width', 'stereo', 'Very wide stereo relationship', 'Low stereo correlation may reduce mono compatibility. Consider a mono check before changing the width.', 0.76))
  }
  if (stereo.channelCount > 1 && stereo.lowFrequencyStereoRatio > RECOMMENDATION_THRESHOLDS.lowFrequencyStereoRatio) {
    output.push(recommendation('rec-low-stereo', 'stereo', 'Wide low-frequency content', 'Sub-200 Hz energy has a substantial side component. Consider checking low-frequency translation in mono before narrowing it.', 0.78))
  }
  const resonances = (spectral.resonanceCandidates || []).filter((item) => item.confidence >= RECOMMENDATION_THRESHOLDS.resonanceConfidence)
  resonances.slice(0, 3).forEach((item, index) => {
    const inFocus = hint.focusBands.length === 0 || hint.focusBands.some((band) => (spectral.bands?.[band] || 0) > 0.08)
    output.push(recommendation(`rec-resonance-${index}`, 'spectrum', 'Persistent spectral concentration', `A narrow concentration was detected near ${Math.round(item.frequencyHz)} Hz. ${inFocus ? 'Consider auditioning a narrow dynamic attenuation there.' : 'Check whether it is musically intentional before making an EQ change.'}`, item.confidence, [item.id]))
  })
  contextFindings.filter((item) => item.severity >= RECOMMENDATION_THRESHOLDS.maskingSeverity).slice(0, 4).forEach((item, index) => {
    output.push(recommendation(`rec-context-${index}`, 'context', 'Potential masking', `Potential time-local competition with ${item.details?.otherName || 'another audible source'} around ${Math.round(item.frequencyRangeHz?.[0] || 0)}–${Math.round(item.frequencyRangeHz?.[1] || 0)} Hz. Consider arrangement, level, panning, or dynamic EQ only after auditioning the located passage.`, item.confidence, [item.id]))
  })
  if (!output.length) output.push(recommendation('rec-no-critical', 'overview', 'No high-confidence issue detected', 'The current scan did not identify a high-confidence technical concern. Treat the measurements as context, not a requirement to change the sound.', 0.72))
  return output
}
