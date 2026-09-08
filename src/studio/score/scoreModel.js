// MIDI events remain the source. This schema contains presentation only.
export const SCORE_SCHEMA_VERSION = 2
export const DISPLAY_QUANTA = { auto: 0, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125 }
export const DEFAULT_TUNING = [64, 59, 55, 50, 45, 40] // string 1 first
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n)))
const choice = (value, values, fallback) => values.includes(value) ? value : fallback
const jsonCopy = value => JSON.parse(JSON.stringify(value))

export function normalizeScoreSettings(input = {}) {
  input = input && typeof input === 'object' ? input : {}
  const tuning = Array.isArray(input.tuning) && input.tuning.length >= 1 && input.tuning.length <= 12 && input.tuning.every(n => Number.isInteger(n) && n >= 0 && n <= 127) ? [...input.tuning] : [...DEFAULT_TUNING]
  input = input && typeof input === 'object' ? input : {}
  return {
    ...jsonCopy(input),
    mode: choice(input.mode, ['standard', 'grand', 'tab', 'combined'], 'grand'),
    clef: choice(input.clef, ['auto', 'treble', 'bass', 'alto', 'tenor', 'percussion'], 'auto'),
    quantization: choice(input.quantization, Object.keys(DISPLAY_QUANTA), 'auto'),
    key: choice(input.key, ['project', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#', 'F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m', 'D#m', 'A#m', 'Dm', 'Gm', 'Cm', 'Fm', 'Bbm', 'Ebm', 'Abm'], 'project'),
    splitPitch: Number.isFinite(input.splitPitch) ? Math.round(clamp(input.splitPitch, 0, 127)) : 60,
    zoom: Number.isFinite(input.zoom) ? clamp(input.zoom, 0.5, 2) : 1,
    tuning, capo: Number.isFinite(input.capo) ? Math.round(clamp(input.capo, 0, 12)) : 0,
    maxFret: Number.isFinite(input.maxFret) ? Math.round(clamp(input.maxFret, 1, 36)) : 24,
    showNames: !!input.showNames, showMuted: !!input.showMuted,
    follow: !!input.follow,
    // Reserved structured layout, not a second set of note timing/pitch values.
    layout: { type: 'continuous', ...(input.layout || {}) },
    concertPitch: input.concertPitch !== false,
    instrumentTranspose: Number.isFinite(input.instrumentTranspose) ? input.instrumentTranspose : 0
  }
}

export function normalizeNoteNotation(input = {}) {
  input = input && typeof input === 'object' ? input : {}
  const result = jsonCopy(input)
  if (input.spelling && /^[A-G]$/.test(input.spelling.step) && Number.isInteger(input.spelling.alter) && Math.abs(input.spelling.alter) <= 2) result.spelling = { step: input.spelling.step, alter: input.spelling.alter }
  if (['treble', 'bass'].includes(input.staff)) result.staff = input.staff
  if (Number.isInteger(input.voice) && input.voice >= 0 && input.voice < 16) result.voice = input.voice
  if (Number.isInteger(input.tabString) && input.tabString >= 1 && input.tabString <= 12) result.tabString = input.tabString
  for (const key of ['articulations', 'lyrics', 'ornaments']) if (Array.isArray(input[key])) result[key] = jsonCopy(input[key])
  for (const key of Object.keys(result)) if (input[key] === undefined) delete result[key]
  return result
}

export function normalizeRegionScore(input = {}) {
  input = input && typeof input === 'object' ? input : {}
  // V1 -> V2 adds typed semantics without dropping extensions from future versions.
  return { ...jsonCopy(input), version: Math.max(SCORE_SCHEMA_VERSION, Number(input.version) || 1), settings: normalizeScoreSettings(input.settings),
    // Position/event anchored directions, slurs (distinct from inferred ties),
    // lyrics and breaks can be serialized to MusicXML without copying MIDI.
    symbols: Array.isArray(input.symbols) ? jsonCopy(input.symbols) : [],
    staffChanges: Array.isArray(input.staffChanges) ? jsonCopy(input.staffChanges) : [] }
}

export function scoreEligibility(region) {
  if (!region) return { eligible: false, reason: 'Select a MIDI region or a track containing MIDI.' }
  if (region.type !== 'audio') return { eligible: true, editable: true, kind: 'midi' }
  const trace = region.audioEdit?.pitchTrace
  const valid = trace?.status === 'ready' && trace.notes?.some(n => Number.isFinite(Number(n.editedMidiNote ?? n.midiNote)) && Number(n.durationSeconds) > 0)
  return valid ? { eligible: true, editable: false, kind: 'analysis', reason: 'Analyzed pitch interpretation · edit these notes in Pitch Trace.' }
    : { eligible: false, kind: 'audio', reason: 'Raw audio has no score. Analyze discrete notes in Pitch Trace first.' }
}

// The adapter accepts multiple regions now; the initial UI selects one region.
export function collectScoreEvents(regions, { secondsToProjectBeat, showMuted = false } = {}) {
  const events = []
  for (const region of regions) {
    const eligibility = scoreEligibility(region)
    if (!eligibility.eligible) continue
    const analysis = eligibility.kind === 'analysis'
    const notes = analysis ? region.audioEdit.pitchTrace.notes : region.notes || []
    notes.forEach((note, index) => {
      if (!note || typeof note !== 'object') return
      if (note.muted && !showMuted) return
      const pitch = Number(analysis ? note.editedMidiNote ?? note.midiNote : note.note ?? note.pitch)
      const startBeat = analysis ? secondsToProjectBeat?.(region, Number(note.startSeconds) || 0) : Number(note.startBeat)
      const endBeat = analysis ? secondsToProjectBeat?.(region, (Number(note.startSeconds) || 0) + Number(note.durationSeconds)) : startBeat + Number(note.durationBeats)
      if (!Number.isFinite(pitch) || !Number.isFinite(startBeat) || !(endBeat > startBeat)) return
      // soura-score-editor-hardening-v1
      const rawVelocity = Number(note.velocity)
      const velocity = Number.isFinite(rawVelocity) ? clamp(rawVelocity, 0, 1) : 0.8
      const sourceId = note.id ?? index
      events.push({ id: `${region.id}:${sourceId}`, regionId: region.id, trackId: region.trackId, noteId: note.id ?? null, index,
        pitch: Math.round(clamp(pitch, 0, 127)), startBeat, durationBeats: endBeat - startBeat,
        velocity, muted: !!note.muted,
        confidence: analysis ? (Number.isFinite(Number(note.confidence)) ? clamp(Number(note.confidence), 0, 1) : 0) : 1,
        origin: eligibility.kind, notation: normalizeNoteNotation(note.notation) })
    })
  }
  return events.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}
