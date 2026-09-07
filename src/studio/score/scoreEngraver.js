// Single-font build: glyph paths render sharply in SVG without OS font loading.
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Fraction, Accidental, Dot, Tuplet, StaveTie, StaveConnector, TabStave, TabNote, GhostNote } from 'vexflow/bravura'
import { keyAlterations, spellPitch } from './scoreTheory.js'

const accidental = alter => ({ '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' }[alter])
const svgNode = (doc, type, attributes) => {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', type)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
  return node
}

export function engraveMeasure(container, measure, model, settings) {
  const tabOnly = settings.mode === 'tab', combined = settings.mode === 'combined'
  const notationStaffs = tabOnly ? [] : model.staffIds
  const height = tabOnly ? 210 : notationStaffs.length * 150 + (combined ? 150 : 0) + 60
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(measure.width, height)
  const context = renderer.getContext()
  context.setFillStyle('#202633').setStrokeStyle('#202633')
  const staves = [], allVoices = [], groups = [], beams = [], tuplets = [], hits = [], timing = []
  const makeStaff = (clef, y, isTab = false) => {
    const stave = isTab ? new TabStave(0, y, measure.width, { num_lines: settings.tuning.length }) : new Stave(0, y, measure.width)
    stave.addClef(isTab ? 'tab' : clef)
    if (!isTab) { stave.addKeySignature(measure.key); stave.addTimeSignature(`${measure.numerator}/${measure.denominator}`) }
    stave.setContext(context)
    staves.push({ stave, clef, isTab })
    const voices = isTab ? Object.values(measure.staffs).flat() : measure.staffs[clef]
    for (const { voice: voiceId, tokens } of voices) {
      const signature = keyAlterations(measure.key), accidentalState = new Map()
      const items = tokens.map(token => {
        const rest = !token.events.length
        let note
        if (isTab) {
          note = rest ? new GhostNote({ duration: token.duration }) : new TabNote({ positions: token.events.map(event => {
            const position = model.tab.get(event.id)
            return { str: position?.string || 1, fret: position?.fret ?? 'X' }
          }), duration: token.duration }, true)
        } else {
          const spellings = token.events.map(e => spellPitch(e.pitch, measure.key, e.notation.spelling))
          note = new StaveNote({ clef, keys: rest ? [clef === 'bass' ? 'd/3' : 'b/4'] : spellings.map(p => `${p.step.toLowerCase()}/${p.octave}`),
            duration: token.duration + (rest ? 'r' : ''), auto_stem: voices.length === 1, stem_direction: voiceId % 2 ? -1 : 1 })
          spellings.forEach((p, index) => {
            const key = `${p.step}${p.octave}`, current = accidentalState.has(key) ? accidentalState.get(key) : signature[p.step] || 0
            if (p.alter !== current && !token.tieIn) note.addModifier(new Accidental(accidental(p.alter)), index)
            accidentalState.set(key, p.alter)
          })
        }
        for (let dot = 0; dot < token.dots; dot++) Dot.buildAndAttach([note], { all: true })
        note.setStave(stave)
        return { note, token }
      })
      let run = []
      const flush = () => { if (run.length) tuplets.push(new Tuplet(run, { num_notes: 3, notes_occupied: 2, bracketed: true })); run = [] }
      for (const item of items) { if (item.token.triplet) { run.push(item.note); if (run.length === 3) flush() } else flush() }
      flush()
      const voice = new Voice({ num_beats: measure.numerator, beat_value: measure.denominator }).setMode(Voice.Mode.SOFT).addTickables(items.map(i => i.note))
      allVoices.push(voice)
      groups.push({ voice, items, stave, clef, isTab })
      if (!isTab) beams.push(...Beam.generateBeams(items.map(i => i.note), { groups: [new Fraction(measure.denominator === 8 && measure.numerator % 3 === 0 ? 3 : 1, measure.denominator === 8 && measure.numerator % 3 === 0 ? 8 : 4)], maintain_stem_directions: true }))
    }
    return stave
  }
  notationStaffs.forEach((clef, index) => makeStaff(clef, 25 + index * 150))
  if (tabOnly || combined) makeStaff(model.staffIds[0], tabOnly ? 25 : 175, true)
  const startX = Math.max(...staves.map(s => s.stave.getNoteStartX()))
  staves.forEach(({ stave }) => { stave.setNoteStartX(startX); stave.draw() })
  if (notationStaffs.length === 2) new StaveConnector(staves[0].stave, staves[1].stave).setType(StaveConnector.type.BRACE).setContext(context).draw()
  const formatter = new Formatter()
  for (const staff of staves) formatter.joinVoices(groups.filter(g => g.stave === staff.stave).map(g => g.voice))
  formatter.format(allVoices, Math.max(60, measure.width - startX - 25))
  for (const { voice, items, stave, clef, isTab } of groups) {
    voice.draw(context, stave)
    const previous = new Map()
    for (const { note, token } of items) {
      timing.push({ beat: token.startBeat, x: note.getAbsoluteX() })
      token.events.forEach((event, index) => {
        const y = note.getYs()[index]
        const x = isTab ? note.getAbsoluteX() : note.getNoteHeadBeginX() + 6
        const hit = svgNode(container.ownerDocument, 'ellipse', { cx: x, cy: y, rx: isTab ? 12 : 10, ry: 8, class: 'soura-score-hit', 'data-score-note': event.id, 'data-source-index': event.index, 'data-score-staff': clef, tabindex: '-1', role: 'button', 'aria-label': `MIDI ${event.pitch}, beat ${event.startBeat.toFixed(3)}, ${event.durationBeats.toFixed(3)} beats` })
        context.svg.append(hit)
        hits.push({ event, x, y, node: hit, clef, isTab })
        if (!isTab && token.tieIn) new StaveTie({ first_note: previous.get(event.id)?.note || null, last_note: note, first_indices: [previous.get(event.id)?.index || 0], last_indices: [index] }).setContext(context).draw()
        if (!isTab && token.tieOut) {
          previous.set(event.id, { note, index })
          if (token.startBeat + token.beats >= measure.endBeat - 1e-6) new StaveTie({ first_note: note, last_note: null, first_indices: [index], last_indices: [index] }).setContext(context).draw()
        }
        if (settings.showNames) {
          const spelling = spellPitch(event.pitch, measure.key, event.notation.spelling)
          const text = svgNode(container.ownerDocument, 'text', { x, y: y + 22, class: 'soura-score-note-name', 'text-anchor': 'middle' })
          text.textContent = `${spelling.step}${spelling.alter ? accidental(spelling.alter) : ''}${spelling.octave}`
          context.svg.append(text)
        }
        if (event.confidence < 0.65) hit.classList.add('is-uncertain')
      })
    }
  }
  beams.forEach(b => b.setContext(context).draw())
  tuplets.forEach(t => t.setContext(context).draw())
  // Hit targets remain above notation without replacing engraving paths.
  hits.forEach(h => context.svg.append(h.node))
  const label = svgNode(container.ownerDocument, 'text', { x: 12, y: 18, class: 'soura-score-measure-number' })
  label.textContent = String(measure.number)
  context.svg.append(label)
  const points = [{ beat: measure.startBeat, x: startX }, ...timing, { beat: measure.endBeat, x: measure.width - 5 }].sort((a,b) => a.beat - b.beat)
  const unique = [...new Map(points.map(p => [p.beat, p])).values()]
  return { height, hits, points: unique, staves: staves.map(s => ({ clef: s.clef, isTab: s.isTab, bottom: s.stave.getYForLine(s.isTab ? settings.tuning.length - 1 : 4), top: s.stave.getYForLine(0) })) }
}

export function interpolateScorePosition(points, value, from = 'beat', to = 'x') {
  if (!points.length) return 0
  if (value <= points[0][from]) return points[0][to]
  for (let i = 1; i < points.length; i++) if (value <= points[i][from]) {
    const a = points[i-1], b = points[i]
    return a[to] + (b[to] - a[to]) * (value - a[from]) / Math.max(1e-9, b[from] - a[from])
  }
  return points.at(-1)[to]
}
