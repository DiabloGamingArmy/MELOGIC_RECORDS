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
  // Clamp the group as a whole so chord intervals and relative timing survive.
  const notes = valid.map(i => region.notes[i])
  const beat = Math.max(deltaBeat, (Number(region.startBeat) || 0) - Math.min(...notes.map(n => n.startBeat)))
  const pitch = bounded(deltaPitch, -Math.min(...notes.map(n => n.note ?? n.pitch)), 127 - Math.max(...notes.map(n => n.note ?? n.pitch)))
  valid.forEach(index => editScoreNotes(region, [index], { startBeat: region.notes[index].startBeat + beat, pitch: (region.notes[index].note ?? region.notes[index].pitch) + pitch }))
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
  region.endBeat = Math.max(Number(region.endBeat) || 0, ...(region.notes || []).map(n => Number(n.startBeat) + Number(n.durationBeats)))
  region.durationBeats = region.endBeat - (Number(region.startBeat) || 0)
}
