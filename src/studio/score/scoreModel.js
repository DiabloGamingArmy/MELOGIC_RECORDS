// MIDI events remain the source. This schema contains presentation only.
export const SCORE_SCHEMA_VERSION = 1
export const DISPLAY_QUANTA = { auto: 0, '1/4': 1, '1/8': 0.5, '1/8T': 1 / 3, '1/16': 0.25, '1/16T': 1 / 6, '1/32': 0.125 }
export const DEFAULT_TUNING = [64, 59, 55, 50, 45, 40] // string 1 first
const clamp = (n, a, b) => Math.max(a, Math.min(b, Number(n)))
const choice = (value, values, fallback) => values.includes(value) ? value : fallback
const jsonCopy = value => JSON.parse(JSON.stringify(value))

export function normalizeScoreSettings(input = {}) {
  const tuning = Array.isArray(input.tuning) && input.tuning.length >= 1 && input.tuning.length <= 12 && input.tuning.every(n => Number.isInteger(n) && n >= 0 && n <= 127) ? [...input.tuning] : [...DEFAULT_TUNING]
  return {
    mode: choice(input.mode, ['standard', 'grand', 'tab', 'combined'], 'grand'),
    clef: choice(input.clef, ['auto', 'treble', 'bass', 'alto', 'tenor'], 'auto'),
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
  const result = {}
  if (input.spelling && /^[A-G]$/.test(input.spelling.step) && Number.isInteger(input.spelling.alter) && Math.abs(input.spelling.alter) <= 2) result.spelling = { step: input.spelling.step, alter: input.spelling.alter }
  if (['treble', 'bass'].includes(input.staff)) result.staff = input.staff
  if (Number.isInteger(input.voice) && input.voice >= 0 && input.voice < 16) result.voice = input.voice
  if (Number.isInteger(input.tabString) && input.tabString >= 1 && input.tabString <= 12) result.tabString = input.tabString
  for (const key of ['articulations', 'lyrics', 'ornaments']) if (Array.isArray(input[key])) result[key] = jsonCopy(input[key])
  return result
}

export function normalizeRegionScore(input = {}) {
  return { version: SCORE_SCHEMA_VERSION, settings: normalizeScoreSettings(input.settings),
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
      if (note.muted && !showMuted) return
      const pitch = Number(analysis ? note.editedMidiNote ?? note.midiNote : note.note ?? note.pitch)
      const startBeat = analysis ? secondsToProjectBeat?.(region, Number(note.startSeconds) || 0) : Number(note.startBeat)
      const endBeat = analysis ? secondsToProjectBeat?.(region, (Number(note.startSeconds) || 0) + Number(note.durationSeconds)) : startBeat + Number(note.durationBeats)
      if (!Number.isFinite(pitch) || !Number.isFinite(startBeat) || !(endBeat > startBeat)) return
      events.push({ id: `${region.id}:${note.id || index}`, regionId: region.id, noteId: note.id || null, index,
        pitch: Math.round(clamp(pitch, 0, 127)), startBeat, durationBeats: endBeat - startBeat,
        velocity: Number(note.velocity) || 0.8, muted: !!note.muted,
        confidence: analysis ? Number(note.confidence) || 0 : 1,
        origin: eligibility.kind, notation: normalizeNoteNotation(note.notation) })
    })
  }
  return events.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}
