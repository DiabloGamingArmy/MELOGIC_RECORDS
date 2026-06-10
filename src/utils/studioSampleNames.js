const NOTE_OFFSETS = { C: 0, Cs: 1, Db: 1, D: 2, Ds: 3, Eb: 3, E: 4, F: 5, Fs: 6, Gb: 6, G: 7, Gs: 8, Ab: 8, A: 9, As: 10, Bb: 10, B: 11 }

export function noteNameToMidi(noteName = '') {
  const match = String(noteName || '').trim().slice(0, 12).match(/^([A-Ga-g])([s#b]?)(-?\d)$/)
  if (!match) return null
  const letter = match[1].toUpperCase()
  const rawAccidental = match[2].toLowerCase()
  const accidental = rawAccidental === '#' ? 's' : rawAccidental
  const offset = NOTE_OFFSETS[`${letter}${accidental}`]
  const octave = Number(match[3])
  if (!Number.isFinite(offset) || !Number.isFinite(octave)) return null
  const midi = ((octave + 1) * 12) + offset
  return midi >= 0 && midi <= 127 ? midi : null
}

export function parseSampleFileName(fileName = '') {
  const baseName = String(fileName || '').trim().slice(0, 240).replace(/\\/g, '/').split('/').pop() || ''
  const match = baseName.match(/^([A-Ga-g])([s#b]?)(-?\d)\.wav$/i)
  if (!match) return null
  const rawAccidental = match[2].toLowerCase()
  const accidental = rawAccidental === '#' ? 's' : rawAccidental
  const note = `${match[1].toUpperCase()}${accidental}${match[3]}`
  const rootMidi = noteNameToMidi(note)
  if (rootMidi == null) return null
  return { fileName: `${note}.wav`, note, rootMidi }
}
