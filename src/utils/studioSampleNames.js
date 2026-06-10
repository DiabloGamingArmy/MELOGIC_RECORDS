const NOTE_OFFSETS = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 }

function normalizeAccidental(value = '') {
  const accidental = String(value || '').toLowerCase()
  if (accidental === 's' || accidental === '#') return '#'
  return accidental === 'b' ? 'b' : ''
}

export function noteNameToMidi(noteName = '') {
  const match = String(noteName || '').trim().slice(0, 12).match(/^([A-Ga-g])([s#b]?)(-?\d)$/)
  if (!match) return null
  const letter = match[1].toUpperCase()
  const accidental = normalizeAccidental(match[2])
  const offset = NOTE_OFFSETS[`${letter}${accidental}`]
  const octave = Number(match[3])
  if (!Number.isFinite(offset) || !Number.isFinite(octave)) return null
  return ((octave + 1) * 12) + offset
}

export function parseSampleFileName(fileName = '') {
  const baseName = String(fileName || '').trim().slice(0, 240).replace(/\\/g, '/').split('/').pop() || ''
  const match = baseName.match(/^([A-Ga-g])([s#b]?)(-?\d)\.wav$/i)
  if (!match) return null
  const accidental = normalizeAccidental(match[2])
  const note = `${match[1].toUpperCase()}${accidental}${match[3]}`
  const rootMidi = noteNameToMidi(note)
  if (rootMidi == null) return null
  return { fileName: `${note}.wav`, note, rootMidi }
}
