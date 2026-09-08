import { normalizeNoteNotation } from './scoreModel.js'

const bounded = (value, min, max) => Math.max(min, Math.min(max, value))
export function editScoreNotes(region, indices, patch = {}) {
  if (!region || region.type === 'audio') return
  for (const index of new Set(indices)) {
    const note = region.notes?.[index]
    if (!note) continue
    if (Number.isFinite(patch.pitch)) {
      note.note = Math.round(bounded(patch.pitch, 0, 127))
      if ('pitch' in note) note.pitch = note.note
    }
    if (Number.isFinite(patch.startBeat)) note.startBeat = Math.max(Number(region.startBeat) || 0, patch.startBeat)
    if (Number.isFinite(patch.durationBeats)) note.durationBeats = Math.max(1 / 64, patch.durationBeats)
    if (Number.isFinite(patch.velocity)) note.velocity = bounded(patch.velocity, 0, 1)
    if (patch.notation) note.notation = normalizeNoteNotation({ ...note.notation, ...patch.notation })
  }
  extendScoreRegion(region)
}

export function moveScoreNotes(region, indices, deltaBeat = 0, deltaPitch = 0) {
  if (!region || region.type === 'audio') return
  const valid = [...new Set(indices)].filter(i => region.notes?.[i])
  if (!valid.length) return
  // soura-score-editor-hardening-v1
  // Clamp the group as a whole so chord intervals and relative timing survive.
  // Ignore malformed legacy pitches instead of poisoning the whole operation
  // with NaN; valid notes remain editable and retain their relationships.
  const notes = valid.map(i => region.notes[i])
  const finiteStarts = notes.map(n => Number(n.startBeat)).filter(Number.isFinite)
  const finitePitches = notes.map(n => Number(n.note ?? n.pitch)).filter(Number.isFinite)
  if (!finiteStarts.length || !finitePitches.length) return
  const requestedBeat = Number.isFinite(Number(deltaBeat)) ? Number(deltaBeat) : 0
  const requestedPitch = Number.isFinite(Number(deltaPitch)) ? Number(deltaPitch) : 0
  const beat = Math.max(requestedBeat, (Number(region.startBeat) || 0) - Math.min(...finiteStarts))
  const pitch = bounded(requestedPitch, -Math.min(...finitePitches), 127 - Math.max(...finitePitches))
  valid.forEach(index => {
    const note = region.notes[index]
    const start = Number(note.startBeat)
    const midi = Number(note.note ?? note.pitch)
    if (!Number.isFinite(start) || !Number.isFinite(midi)) return
    editScoreNotes(region, [index], { startBeat: start + beat, pitch: midi + pitch })
  })
}

export function insertScoreNote(region, note, id) {
  if (!region || region.type === 'audio') return -1
  region.notes ||= []
  const index = region.notes.length
  region.notes.push({ id, note: 60, startBeat: Number(region.startBeat) || 0, durationBeats: 1, velocity: 0.8 })
  editScoreNotes(region, [index], note)
  return index
}

function extendScoreRegion(region) {
  region.endBeat = Math.max(Number(region.endBeat) || 0, ...(region.notes || []).filter(Boolean).map(n => Number(n.startBeat) + Number(n.durationBeats)).filter(Number.isFinite))
  region.durationBeats = region.endBeat - (Number(region.startBeat) || 0)
}
