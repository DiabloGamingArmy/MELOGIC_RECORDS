import { DISPLAY_QUANTA } from './scoreModel.js'
const NATURAL = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const LETTERS = Object.keys(NATURAL)
const FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, 'F#': 6, 'C#': 7, F: -1, Bb: -2, Eb: -3, Ab: -4, Db: -5, Gb: -6, Cb: -7 }
const MINOR = { A: 'C', E: 'G', B: 'D', 'F#': 'A', 'C#': 'E', 'G#': 'B', 'D#': 'F#', 'A#': 'C#', D: 'F', G: 'Bb', C: 'Eb', F: 'Ab', Bb: 'Db', Eb: 'Gb', Ab: 'Cb' }
export function keyName(key) {
  const name = (typeof key === 'string' ? key : `${key?.root || 'C'}${key?.scale === 'minor' ? 'm' : ''}`).replaceAll('♭','b').replaceAll('♯','#')
  return ({'D#':'Eb','G#':'Ab','A#':'Bb','Dbm':'C#m','Gbm':'F#m','Cbm':'Bm'}[name]) || name
}
export function keyAlterations(key = 'C') {
  const name = keyName(key).replaceAll('♭', 'b').replaceAll('♯', '#')
  const root = name.endsWith('m') ? MINOR[name.slice(0, -1)] || 'C' : name
  const count = FIFTHS[root] || 0
  return Object.fromEntries((count < 0 ? ['B', 'E', 'A', 'D', 'G', 'C', 'F'] : ['F', 'C', 'G', 'D', 'A', 'E', 'B']).slice(0, Math.abs(count)).map(step => [step, Math.sign(count)]))
}
export function spellPitch(pitch, key = 'C', override = null) {
  const signature = keyAlterations(key)
  const candidates = []
  for (const step of LETTERS) for (let alter = -2; alter <= 2; alter++) {
    const octave = (pitch - NATURAL[step] - alter) / 12 - 1
    if (!Number.isInteger(octave)) continue
    const preferred = signature[step] || 0
    const flatKey = Object.values(signature).some(a => a < 0)
    const cost = (alter === preferred ? 0 : 3) + Math.abs(alter) + (alter && Math.sign(alter) !== (flatKey ? -1 : 1) ? 0.5 : 0)
    candidates.push({ step, alter, octave, cost: override?.step === step && override.alter === alter ? -100 : cost })
  }
  const best = candidates.sort((a, b) => a.cost - b.cost)[0]
  return { step: best.step, alter: best.alter, octave: best.octave }
}
export const diatonicPosition = spelling => spelling.octave * 7 + LETTERS.indexOf(spelling.step)
export const clefBottom = clef => ({ treble: 4 * 7 + 2, bass: 2 * 7 + 4, alto: 3 * 7 + 3, tenor: 3 * 7 + 1 }[clef] ?? 30)
export function pitchToStaffPosition(pitch, clef = 'treble', key = 'C', override) { return diatonicPosition(spellPitch(pitch, key, override)) - clefBottom(clef) }
export function staffPositionToPitch(position, clef = 'treble', key = 'C') {
  const value = clefBottom(clef) + Math.round(position)
  const octave = Math.floor(value / 7), step = LETTERS[((value % 7) + 7) % 7]
  return Math.max(0, Math.min(127, (octave + 1) * 12 + NATURAL[step] + (keyAlterations(key)[step] || 0)))
}
export function displayQuantum(events, setting = 'auto') {
  if (DISPLAY_QUANTA[setting]) return DISPLAY_QUANTA[setting]
  const candidates = [1, 0.5, 1 / 3, 0.25, 1 / 6, 0.125]
  return candidates.find(q => events.every(e => Math.abs(Math.round(e.startBeat / q) * q - e.startBeat) < 0.035 && Math.abs(Math.round(e.durationBeats / q) * q - e.durationBeats) < 0.04)) || 0.125
}
export function quantizeForDisplay(event, quantum) {
  const startBeat = Math.round(event.startBeat / quantum) * quantum
  return { ...event, startBeat, durationBeats: Math.max(quantum, Math.round(event.durationBeats / quantum) * quantum) }
}
export function buildMeasures(endBeat, signatures = [{ beat: 0, numerator: 4, denominator: 4 }]) {
  const map = [...signatures].filter(s => Number.isFinite(s.beat) && s.beat >= 0 && s.numerator > 0 && [1,2,4,8,16,32,64].includes(s.denominator)).sort((a,b) => a.beat - b.beat)
  if (!map.length || map[0].beat > 0) map.unshift({ beat: 0, numerator: 4, denominator: 4 })
  const result = []
  let beat = 0, index = 0
  while (beat < endBeat - 1e-7) {
    while (map[index + 1]?.beat <= beat + 1e-7) index++
    const signature = map[index]
    const length = Math.max(0.125, Number(signature.numerator) * 4 / Number(signature.denominator))
    const end = Math.min(beat + length, map[index + 1]?.beat ?? Infinity)
    result.push({ index: result.length, number: result.length + 1, startBeat: beat, endBeat: end, numerator: signature.numerator, denominator: signature.denominator })
    beat = end
  }
  return result
}
export function measureAtBeat(measures, beat) {
  let low = 0, high = measures.length - 1
  while (low < high) { const mid = Math.floor((low + high + 1) / 2); if (measures[mid].startBeat <= beat) low = mid; else high = mid - 1 }
  return measures[low]
}
const VALUES = [ ['w',4],['h',2],['q',1],['8',0.5],['16',0.25],['32',0.125],['64',0.0625] ]
export function decomposeDuration(beats, { triplet = false } = {}) {
  const choices = VALUES.flatMap(([duration, value]) => triplet
    ? [{ duration, beats: value * 2 / 3, dots: 0, triplet: true }]
    : [{ duration, beats: value * 1.5, dots: 1, triplet: false }, { duration, beats: value, dots: 0, triplet: false }]).sort((a,b) => b.beats - a.beats)
  const result = []
  let remaining = beats
  while (remaining > 1e-6 && result.length < 128) {
    const value = choices.find(c => c.beats <= remaining + 1e-6)
    if (!value) break
    result.push({ ...value }); remaining -= value.beats
  }
  return result
}
export const assignStaff = (event, settings) => settings.mode === 'grand' ? event.notation?.staff || (event.pitch < settings.splitPitch ? 'bass' : 'treble') : settings.clef === 'auto' ? 'treble' : settings.clef

export function assignVoices(events) {
  const voices = []
  return [...events].sort((a,b) => a.startBeat - b.startBeat || b.pitch - a.pitch).map(event => {
    const end = event.startBeat + event.durationBeats
    let voice = event.notation?.voice
    if (voice == null) {
      voice = voices.findIndex(v => v && Math.abs(v.start - event.startBeat) < 1e-6 && Math.abs(v.end - end) < 1e-6)
      if (voice < 0) voice = voices.findIndex(v => !v || v.end <= event.startBeat + 1e-6)
      if (voice < 0) voice = voices.length
    }
    // A manual voice with overlapping unequal durations still needs a separate
    // rhythmic stream; never flatten the shorter event into a longer chord.
    if (voices[voice] && voices[voice].end > event.startBeat + 1e-6 && !(Math.abs(voices[voice].start - event.startBeat) < 1e-6 && Math.abs(voices[voice].end - end) < 1e-6)) voice = voices.length
    voices[voice] = { start: event.startBeat, end }
    return { ...event, voice }
  })
}
