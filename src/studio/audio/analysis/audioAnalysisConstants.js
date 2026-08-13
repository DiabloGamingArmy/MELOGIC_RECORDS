export const AUDIO_ANALYSIS_VERSION = 'soura-analysis-1.0.0'
export const AUDIO_ANALYSIS_CACHE_DB = 'soura-audio-analysis-v1'
export const AUDIO_ANALYSIS_CACHE_STORE = 'source-domains'

export const ANALYSIS_DOMAIN_VERSIONS = Object.freeze({
  levels: 1,
  dynamics: 1,
  spectral: 1,
  stereo: 1,
  transient: 1,
  musical: 1,
  timeline: 1
})

export const ANALYSIS_PROFILES = Object.freeze({
  quick: Object.freeze({ frameSize: 1024, hopSize: 1024, spectralStride: 4, musical: false, resonanceLimit: 3 }),
  standard: Object.freeze({ frameSize: 2048, hopSize: 1024, spectralStride: 2, musical: true, resonanceLimit: 6 }),
  deep: Object.freeze({ frameSize: 4096, hopSize: 1024, spectralStride: 1, musical: true, resonanceLimit: 10 })
})

export const SPECTRAL_BANDS = Object.freeze([
  Object.freeze({ id: 'sub', label: '20–60 Hz', lowHz: 20, highHz: 60 }),
  Object.freeze({ id: 'bass', label: '60–200 Hz', lowHz: 60, highHz: 200 }),
  Object.freeze({ id: 'lowMid', label: '200–500 Hz', lowHz: 200, highHz: 500 }),
  Object.freeze({ id: 'mid', label: '500 Hz–2 kHz', lowHz: 500, highHz: 2000 }),
  Object.freeze({ id: 'upperMid', label: '2–5 kHz', lowHz: 2000, highHz: 5000 }),
  Object.freeze({ id: 'presence', label: '5–10 kHz', lowHz: 5000, highHz: 10000 }),
  Object.freeze({ id: 'air', label: '10 kHz+', lowHz: 10000, highHz: 24000 })
])

export const SOURCE_TYPES = Object.freeze([
  ['auto', 'Auto'], ['vocal', 'Vocal'], ['drums', 'Drums'], ['bass', 'Bass'], ['guitar', 'Guitar'],
  ['keys', 'Keys'], ['synth', 'Synth'], ['fx', 'FX'], ['full-mix', 'Full Mix'], ['other', 'Other']
])

export const RECOMMENDATION_THRESHOLDS = Object.freeze({
  clippingSamples: 2,
  hotSamplePeakDbfs: -0.5,
  lowCrestDb: 4.5,
  highDcOffset: 0.01,
  lowCorrelation: 0.15,
  negativeCorrelation: -0.1,
  lowFrequencyStereoRatio: 0.32,
  resonanceConfidence: 0.68,
  maskingSeverity: 0.58
})

export function getAnalysisProfile(profile = 'standard') {
  return ANALYSIS_PROFILES[profile] || ANALYSIS_PROFILES.standard
}

export function getDomainVersionFingerprint() {
  return Object.entries(ANALYSIS_DOMAIN_VERSIONS).map(([key, value]) => `${key}:${value}`).join('|')
}
