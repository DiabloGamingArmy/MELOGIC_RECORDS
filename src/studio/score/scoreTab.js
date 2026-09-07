export function tabCandidates(pitch, { tuning, capo = 0, maxFret = 24 }, manualString) {
  return tuning.flatMap((open, index) => {
    const fret = pitch - open - capo, string = index + 1
    return Number.isInteger(fret) && fret >= 0 && fret <= maxFret && (!manualString || manualString === string) ? [{ string, fret }] : []
  })
}
// Bounded beam search keeps chords playable (one sounding note per string),
// considers hand position and repeated notes, and reports impossible notes.
export function assignTab(events, settings) {
  const result = new Map(), previous = new Map(), active = new Map()
  const ordered = [...events].sort((a,b) => a.startBeat - b.startBeat || b.pitch - a.pitch)
  let hand = 3
  for (let i = 0; i < ordered.length;) {
    const chord = [], time = ordered[i].startBeat
    while (i < ordered.length && Math.abs(ordered[i].startBeat - time) < 1e-6) chord.push(ordered[i++])
    for (const [string, end] of active) if (end <= time + 1e-6) active.delete(string)
    let states = [{ cost: 0, used: new Set(active.keys()), picks: [] }]
    for (const event of chord) {
      const options = tabCandidates(event.pitch, settings, event.notation?.tabString)
      const next = []
      for (const state of states) {
        for (const option of options) {
          if (state.used.has(option.string)) continue
          const frets = [...state.picks.map(p => p?.fret || 0), option.fret].filter(Boolean)
          const span = frets.length ? Math.max(...frets) - Math.min(...frets) : 0
          const cost = Math.abs(option.fret - hand) * 0.7 + (option.fret === 0 ? -1 : 0) + Math.max(0, span - 4) * 12 + (previous.get(event.pitch)?.string === option.string ? -2 : 0)
          next.push({ cost: state.cost + cost, used: new Set([...state.used, option.string]), picks: [...state.picks, option] })
        }
        next.push({ cost: state.cost + 1000, used: state.used, picks: [...state.picks, null] })
      }
      states = next.sort((a,b) => a.cost - b.cost).slice(0, 32)
    }
    const best = states[0]
    best.picks.forEach((pick, index) => {
      const event = chord[index]
      result.set(event.id, pick)
      if (pick) { previous.set(event.pitch, pick); active.set(pick.string, event.startBeat + event.durationBeats) }
    })
    const frets = best.picks.filter(p => p?.fret > 0).map(p => p.fret).sort((a,b) => a-b)
    if (frets.length) hand = frets[Math.floor(frets.length / 2)]
  }
  return result
}
