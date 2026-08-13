export type AnalysisProfile = 'quick' | 'standard' | 'deep'
export type AnalysisScope = 'track' | 'region'
export type AnalysisMode = 'independent' | 'project-context' | 'single-region' | 'compare-regions'
export type AnalysisProviderKind = 'web-worker' | 'web-fallback' | 'native'
export type SourceType = 'auto' | 'vocal' | 'drums' | 'bass' | 'guitar' | 'keys' | 'synth' | 'fx' | 'full-mix' | 'other'

export interface AnalysisSourceIdentity {
  id: string
  revision: string
  name: string
  sampleRate: number
  channelCount: number
  durationSeconds: number
}

export interface AnalysisValue<T = number> {
  value: T
  unit?: string
  standard?: string
  estimated?: boolean
}

export interface AnalysisDetection {
  id: string
  type: string
  label: string
  confidence: number
  severity?: number
  startSeconds?: number
  endSeconds?: number
  frequencyHz?: number
  frequencyRangeHz?: [number, number]
  relatedSourceId?: string
  details?: Record<string, unknown>
}

export interface AnalysisRecommendation {
  id: string
  category: string
  title: string
  message: string
  confidence: number
  relatedDetectionIds: string[]
}

export interface AnalysisFrameFeature {
  startSeconds: number
  endSeconds: number
  peak: number
  rms: number
  dcOffset: number
  clippingSamples: number
  leftRms: number
  rightRms: number
  correlation: number | null
  spectralCentroidHz: number
  spectralRolloffHz: number
  bandEnergy: Record<string, number>
  chroma: number[]
  onsetStrength: number
  spectralPeaks?: Array<{ frequencyHz: number; prominence: number }>
}

export interface NormalizedAnalysisResult {
  version: string
  mode: AnalysisMode
  scope: AnalysisScope
  profile: AnalysisProfile
  source: AnalysisSourceIdentity
  measurements: Record<string, unknown>
  detections: AnalysisDetection[]
  recommendations: AnalysisRecommendation[]
  timelineFindings: AnalysisDetection[]
  confidence: Record<string, number>
  metadata: {
    provider: AnalysisProviderKind
    signalStage: 'source' | 'post-fx'
    cache: 'hit' | 'miss' | 'derived'
    analyzedAt: string
    analysisMs: number
    framesProcessed: number
    decodeMs?: number
    standards: Record<string, string>
    warnings: string[]
  }
  frameFeatures: AnalysisFrameFeature[]
}

export interface AudioAnalysisProvider {
  readonly kind: AnalysisProviderKind | 'native'
  analyze(request: Record<string, unknown>, options?: {
    onProgress?: (update: { progress: number; phase: string }) => void
    signal?: AbortSignal
  }): Promise<NormalizedAnalysisResult>
}
