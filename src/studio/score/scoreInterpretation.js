import { assignStaff, assignVoices, buildMeasures, decomposeDuration, displayQuantum, keyName, measureAtBeat, quantizeForDisplay } from './scoreTheory.js'
import { assignTab } from './scoreTab.js'

export function interpretScore(events, { startBeat = 0, endBeat = 4, settings, timeSignatures, keySignatures = [] }) {
  const quantum = displayQuantum(events, settings.quantization)
  const displayed = events.map(e => quantizeForDisplay(e, settings.quantization === 'auto' ? displayQuantum([e]) : quantum))
  const allMeasures = buildMeasures(Math.max(endBeat, startBeat + 1), timeSignatures)
  const measures = allMeasures.filter(m => m.endBeat > startBeat + 1e-7)
  const byMeasure = new Map(measures.map(m => [m.index, m]))
  const staffIds = settings.mode === 'grand' ? ['treble', 'bass'] : [settings.clef === 'auto' ? (events.length && events.reduce((sum,e) => sum + e.pitch, 0) / events.length < 60 ? 'bass' : 'treble') : settings.clef]
  const assigned = staffIds.flatMap(staff => assignVoices(displayed.filter(e => settings.mode !== 'grand' || assignStaff(e, settings) === staff)).map(e => ({ ...e, staff })))
  const tab = assignTab(displayed, settings)
  for (const measure of measures) {
    const key = keySignatures.reduce((active, event) => event.beat <= measure.startBeat ? event : active, { root: 'C', scale: 'major' })
    measure.key = settings.key === 'project' ? keyName(key) : settings.key
    measure.staffs = Object.fromEntries(staffIds.map(staff => [staff, new Map()]))
  }
  for (const event of assigned) {
    let position = Math.max(startBeat, event.startBeat), end = Math.min(endBeat, event.startBeat + event.durationBeats)
    while (position < end - 1e-6) {
      const measure = measureAtBeat(allMeasures, position)
      if (!measure) break
      const stop = Math.min(end, measure.endBeat)
      const target = byMeasure.get(measure.index)
      if (target) {
        const voices = target.staffs[event.staff]
        if (!voices.has(event.voice)) voices.set(event.voice, [])
        voices.get(event.voice).push({ ...event, segmentStart: position, segmentEnd: stop,
          tieIn: position > event.startBeat + 1e-6, tieOut: stop < event.startBeat + event.durationBeats - 1e-6 })
      }
      position = stop
    }
  }
  let x = 20
  for (const measure of measures) {
    let complexity = 0
    for (const [staff, voices] of Object.entries(measure.staffs)) {
      if (!voices.size) voices.set(0, [])
      for (const [voice, segments] of voices) {
        const groups = new Map()
        for (const segment of segments) {
          const key = `${segment.segmentStart}:${segment.segmentEnd}`
          if (!groups.has(key)) groups.set(key, [])
          groups.get(key).push(segment)
        }
        const tokens = []
        const append = (start, end, chord = []) => {
          let cursor = start
          const triplet = Math.abs((end - start) * 16 - Math.round((end - start) * 16)) > 1e-5
          const pieces = decomposeDuration(end - start, { triplet })
          pieces.forEach((value, part) => {
            tokens.push({ ...value, startBeat: cursor, events: chord.sort((a,b) => a.pitch - b.pitch),
              tieIn: chord.length && (part > 0 || chord[0].tieIn), tieOut: chord.length && (part < pieces.length - 1 || chord[0].tieOut) })
            cursor += value.beats
          })
        }
        let cursor = measure.startBeat
        for (const chord of [...groups.values()].sort((a,b) => a[0].segmentStart - b[0].segmentStart)) {
          if (chord[0].segmentStart > cursor + 1e-6) append(cursor, chord[0].segmentStart)
          append(chord[0].segmentStart, chord[0].segmentEnd, chord)
          cursor = chord[0].segmentEnd
        }
        if (cursor < measure.endBeat - 1e-6) append(cursor, measure.endBeat)
        voices.set(voice, tokens)
        complexity = Math.max(complexity, tokens.length + segments.length * 0.5)
      }
      measure.staffs[staff] = [...voices.entries()].map(([voice, tokens]) => ({ voice, tokens }))
    }
    measure.x = x
    measure.width = Math.max(300, 140 + (measure.endBeat - measure.startBeat) * 38, 130 + complexity * 34)
    x += measure.width
  }
  return { measures, width: x + 20, quantum, tab, events, staffIds }
}
