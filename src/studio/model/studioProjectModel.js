const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeTrackType(type) {
  return type === 'audio' ? 'audio' : 'software'
}

export function createTrackModel(input = {}) {
  return {
    id: String(input.id || makeId('track')),
    name: String(input.name || 'Track'),
    type: normalizeTrackType(input.type),
    muted: !!input.muted,
    soloed: !!input.soloed
  }
}

export function normalizeMidiNote(note = {}) {
  return {
    id: String(note.id || makeId('note')),
    pitch: clamp(Math.round(num(note.pitch, 60)), 0, 127),
    startBeat: num(note.startBeat, 0),
    durationBeats: Math.max(0.0001, num(note.durationBeats, 1)),
    velocity: clamp(num(note.velocity, 0.8), 0, 1)
  }
}

export function normalizeRegion(region = {}) {
  const type = region.type === 'audio' ? 'audio' : 'midi'
  const fileDurationSeconds = Math.max(0, num(region.fileDurationSeconds ?? region.audioClip?.fileDurationSeconds ?? region.durationSeconds, 0))
  const trimStartSeconds = clamp(num(region.trimStartSeconds, 0), 0, Math.max(0, fileDurationSeconds))
  const trimEndSeconds = region.trimEndSeconds == null ? null : clamp(num(region.trimEndSeconds, fileDurationSeconds), trimStartSeconds, Math.max(trimStartSeconds, fileDurationSeconds))
  const stretchRatio = Math.max(0.05, num(region.stretch?.ratio, 1))
  return {
    id: String(region.id || makeId('region')),
    trackId: String(region.trackId || 'demo-track'),
    type,
    startBeat: num(region.startBeat, 0),
    durationBeats: Math.max(0.0001, num(region.durationBeats, 4)),
    endBeat: Math.max(num(region.startBeat, 0), num(region.endBeat, num(region.startBeat, 0) + num(region.durationBeats, 4))),
    timelineStartBeats: num(region.timelineStartBeats, num(region.startBeat, 0)),
    timelineStartSeconds: num(region.timelineStartSeconds, 0),
    transportBpm: num(region.transportBpm, 140),
    projectSampleRate: num(region.projectSampleRate, 44100),
    audioContextSampleRate: num(region.audioContextSampleRate, 44100),
    recordingStartedAtAudioContextTime: num(region.recordingStartedAtAudioContextTime, 0),
    recordingStartedAtPerformanceTime: num(region.recordingStartedAtPerformanceTime, 0),
    mediaRecorderStartedAt: num(region.mediaRecorderStartedAt, 0),
    sourceLatencyCompensationSeconds: num(region.sourceLatencyCompensationSeconds, 0),
    durationSeconds: Math.max(0, num(region.durationSeconds, 0)),
    fileDurationSeconds,
    offsetSeconds: Math.max(0, num(region.offsetSeconds, 0)),
    trimStartSeconds,
    trimEndSeconds,
    visibleDurationSeconds: Math.max(0, num(region.visibleDurationSeconds, region.durationSeconds || 0)),
    playbackRate: Math.max(0.05, num(region.playbackRate, 1)),
    stretch: {
      enabled: !!region.stretch?.enabled,
      ratio: stretchRatio,
      mode: String(region.stretch?.mode || 'none'),
      algorithm: String(region.stretch?.algorithm || 'none'),
      preservesPitch: !!region.stretch?.preservesPitch,
      renderedAudioUrl: region.stretch?.renderedAudioUrl || null,
      renderedStoragePath: region.stretch?.renderedStoragePath || null
    },
    sourceHash: region.sourceHash ?? null,
    audioClip: type === 'audio' && region.audioClip && typeof region.audioClip === 'object'
      ? { ...region.audioClip, sessionOnly: region.audioClip.sessionOnly !== false, missingAfterReload: region.audioClip.missingAfterReload !== false }
      : null,
    waveform: type === 'audio' && region.waveform && typeof region.waveform === 'object'
      ? {
        ...region.waveform,
        peaks: Array.isArray(region.waveform.peaks)
          ? region.waveform.peaks.slice(0, 1200).map((peak) => peak && typeof peak === 'object'
            ? { min: clamp(num(peak.min, 0), -1, 1), max: clamp(num(peak.max, 0), -1, 1), rms: clamp(num(peak.rms, 0), 0, 1) }
            : clamp(num(peak, 0), 0, 1))
          : []
      }
      : null,
    gain: clamp(num(region.gain, 1), 0, 2),
    pan: clamp(num(region.pan, 0), -1, 1),
    muted: !!region.muted,
    notes: type === 'midi' ? (Array.isArray(region.notes) ? region.notes.map(normalizeMidiNote) : []) : []
  }
}

export function createAudioRegion(input = {}) { return normalizeRegion({ ...input, type: 'audio' }) }
export function createMidiRegion(input = {}) { return normalizeRegion({ ...input, type: 'midi' }) }
export function createMidiNote(input = {}) { return normalizeMidiNote(input) }

export function createEmptyStudioProjectModel() {
  return { version: 1, bpm: 140, beatsPerBar: 4, tracks: [], regions: [] }
}

export function normalizeStudioProjectModel(model = {}) {
  const base = model && typeof model === 'object' ? model : {}
  return {
    version: 1,
    bpm: Math.max(1, num(base.bpm, 140)),
    beatsPerBar: Math.max(1, Math.round(num(base.beatsPerBar, 4))),
    tracks: Array.isArray(base.tracks) ? base.tracks.map(createTrackModel) : [],
    regions: Array.isArray(base.regions) ? base.regions.map(normalizeRegion).sort((a, b) => a.startBeat - b.startBeat) : []
  }
}
