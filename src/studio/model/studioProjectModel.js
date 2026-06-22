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
  return {
    id: String(region.id || makeId('region')),
    trackId: String(region.trackId || 'demo-track'),
    type,
    startBeat: num(region.startBeat, 0),
    durationBeats: Math.max(0.0001, num(region.durationBeats, 4)),
    sourceHash: region.sourceHash ?? null,
    audioClip: type === 'audio' && region.audioClip && typeof region.audioClip === 'object'
      ? { ...region.audioClip, sessionOnly: region.audioClip.sessionOnly !== false, missingAfterReload: region.audioClip.missingAfterReload !== false }
      : null,
    waveform: type === 'audio' && region.waveform && typeof region.waveform === 'object'
      ? { ...region.waveform, peaks: Array.isArray(region.waveform.peaks) ? region.waveform.peaks.map((peak) => clamp(num(peak, 0), 0, 1)) : [] }
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
