import { signatureDisplay } from './scoreSignatures.js'
import { ARTICULATIONS, ORNAMENTS } from './scoreSymbols.js'
import { planAccidentals } from './scoreAccidentals.js'
// Single-font build: glyph paths render sharply in SVG without OS font loading.
import { Renderer, Stave, StaveNote, Voice, Formatter, Beam, Fraction, Accidental, Dot, Tuplet, StaveTie, StaveConnector, TabStave, TabNote, GhostNote, Articulation, Ornament } from 'vexflow/bravura'
import { spellPitch } from './scoreTheory.js'

const accidental = alter => ({ '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' }[alter])
const svgNode = (doc, type, attributes) => {
  const node = doc.createElementNS('http://www.w3.org/2000/svg', type)
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value))
  return node
}

export function engraveMeasure(container, measure, model, settings, { isSystemStart = true, previousMeasure = null } = {}) {
  const tabOnly = settings.mode === 'tab', combined = settings.mode === 'combined'
  const definitions = model.staffDefinitions || (tabOnly ? [{id:model.staffIds[0],clef:model.staffIds[0],isTab:true,settings}] : model.staffIds.map(id=>({id,clef:id,settings})))
  const notationStaffs = definitions.filter(d=>!d.isTab)
  const height = model.height || (definitions.length * 180 + 90)
  const renderer = new Renderer(container, Renderer.Backends.SVG)
  renderer.resize(measure.width, height)
  const context = renderer.getContext()
  context.setFillStyle('#202633').setStrokeStyle('#202633')
  const staves = [], allVoices = [], groups = [], beams = [], tuplets = [], hits = [], timing = []
  const makeStaff = (definition, y) => {
    const {id, isTab=false} = definition, settings=definition.settings
    const clef = measure.staffClefs?.[id] || definition.clef
    const key = clef === 'percussion' ? 'C' : measure.staffKeys?.[id] || measure.key
    const stave = isTab ? new TabStave(0, y, measure.width, { num_lines: settings.tuning.length }) : new Stave(0, y, measure.width)
    const signatures = signatureDisplay(measure, previousMeasure, definition, isSystemStart)
    // Keep the stave's active clef even when its glyph is not printed.
    stave.setClefLines(isTab ? 'tab' : clef)
    if (signatures.showClef) stave.addClef(signatures.clef, signatures.smallClef ? 'small' : 'default')
    if (signatures.showKey) stave.addKeySignature(key, signatures.cancelKey)
    if (signatures.showTime) stave.addTimeSignature(`${measure.numerator}/${measure.denominator}`)
    stave.setContext(context)
    staves.push({ stave, clef, isTab, id, definition })
    const voices = measure.staffs[id] || []
    const accidentals = planAccidentals(voices,key)
    for (const { voice: voiceId, tokens } of voices) {
      const items = tokens.map(token => {
        const rest = !token.events.length
        let note
        if (isTab) {
          note = rest ? new GhostNote({ duration: token.duration }) : new TabNote({ positions: token.events.map(event => {
            const position = model.tab.get(event.id)
            return { str: position?.string || 1, fret: position?.fret ?? 'X' }
          }), duration: token.duration }, true)
        } else {
          const spellings = token.events.map(e => spellPitch(e.pitch, key, e.notation.spelling))
          note = new StaveNote({ clef, keys: rest ? [clef === 'bass' ? 'd/3' : 'b/4'] : spellings.map(p => `${p.step.toLowerCase()}/${p.octave}${(token.events[spellings.indexOf(p)].notehead || token.events[spellings.indexOf(p)].notation.notehead)==='x'?'/x':(token.events[spellings.indexOf(p)].notation.notehead==='diamond'?'/d':'')}`),
            duration: token.duration + (rest ? 'r' : ''), auto_stem: voices.length === 1, stem_direction: voiceId % 2 ? -1 : 1 })
          ;(accidentals.get(token)||[]).forEach((mark,index)=>{if(mark.show&&clef!=='percussion')note.addModifier(new Accidental(accidental(mark.alter)),index)})
          const articulations=new Set(token.events.filter(e=>!e.tieIn).flatMap(e=>e.notation.articulations||[]))
          for(const name of articulations)if(ARTICULATIONS[name])note.addModifier(new Articulation(ARTICULATIONS[name]).setPosition(3),0)
          const ornaments=new Set(token.events.filter(e=>!e.tieIn).flatMap(e=>e.notation.ornaments||[]))
          for(const name of ornaments)if(ORNAMENTS[name])note.addModifier(new Ornament(ORNAMENTS[name]).setPosition(3),0)
        }
        for (let dot = 0; dot < token.dots; dot++) Dot.buildAndAttach([note], { all: true })
        note.setStave(stave)
        return { note, token }
      })
      let run = []
      // soura-score-editor-hardening-v1
      const flush = () => {
        if (run.length === 3) tuplets.push(new Tuplet(run, { num_notes: 3, notes_occupied: 2, bracketed: true }))
        else run.forEach(note=>note.applyTickMultiplier(2,3))
        run = []
      }
      for (const item of items) {
        if (item.token.triplet) {
          run.push(item.note)
          if (run.length === 3) flush()
        } else {
          flush()
        }
      }
      flush()
      const voice = new Voice({ num_beats: measure.numerator, beat_value: measure.denominator }).setMode(Voice.Mode.SOFT).addTickables(items.map(i => i.note))
      allVoices.push(voice)
      groups.push({ voice, items, stave, clef, isTab, id, key })
      if (!isTab) beams.push(...Beam.generateBeams(items.map(i => i.note), { groups: [new Fraction(measure.denominator === 8 && measure.numerator % 3 === 0 ? 3 : 1, measure.denominator === 8 && measure.numerator % 3 === 0 ? 8 : 4)], maintain_stem_directions: true }))
    }
    return stave
  }
  definitions.forEach((definition,index)=>makeStaff(definition,65+index*180))
  const startX = Math.max(...staves.map(s => s.stave.getNoteStartX()))
  staves.forEach(({ stave }) => { stave.setNoteStartX(startX); stave.draw() })
  for(let i=1;i<staves.length;i++)if(isSystemStart&&staves[i].definition.trackId===staves[i-1].definition.trackId&&!staves[i].isTab&&!staves[i-1].isTab)new StaveConnector(staves[i-1].stave, staves[i].stave).setType(StaveConnector.type.BRACE).setContext(context).draw()
  const formatter = new Formatter()
  for (const staff of staves) formatter.joinVoices(groups.filter(g => g.stave === staff.stave).map(g => g.voice))
  formatter.format(allVoices, Math.max(60, measure.width - startX - 25))
  for (const { voice, items, stave, clef, isTab, id, key } of groups) {
    voice.draw(context, stave)
    const previous = new Map()
    for (const { note, token } of items) {
      timing.push({ beat: token.startBeat, x: note.getAbsoluteX() })
      token.events.forEach((event, index) => {
        const y = note.getYs()[index]
        const x = isTab ? note.getAbsoluteX() : note.getNoteHeadBeginX() + 6
        const hit = svgNode(container.ownerDocument, 'ellipse', { cx: x, cy: y, rx: isTab ? 12 : 10, ry: 8, class: 'soura-score-hit', 'data-score-note': event.id, 'data-source-index': event.index, 'data-score-staff': id, tabindex: '-1', role: 'button', 'aria-label': `MIDI ${event.pitch}, beat ${event.startBeat.toFixed(3)}, ${event.durationBeats.toFixed(3)} beats` })
        context.svg.append(hit)
        hits.push({ event, x, y, node: hit, clef, isTab, staffId:id, tokenStart:token.startBeat, tokenEnd:token.startBeat+token.beats })
        if(!isTab && !event.tieIn) for(const lyric of event.notation.lyrics||[]) {
          const text=svgNode(container.ownerDocument,'text',{x,y:stave.getYForLine(4)+48+(Math.max(1,Number(lyric.verse)||1)-1)*17,class:'soura-score-lyric','text-anchor':'middle'})
          text.textContent=String(lyric.text||'')+(['begin','middle'].includes(lyric.syllabic)?' -':'')+(lyric.extend?' __':'')
          context.svg.append(text)
        }
        if (settings.showNames) {
          const spelling = spellPitch(event.pitch, key, event.notation.spelling)
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
  drawDirections(context.svg, measure, unique, staves, container.ownerDocument)
  return { height, hits, points: unique, staves: staves.map(s => ({ id:s.id, trackId:s.definition.trackId, clef: s.clef, isTab: s.isTab, bottom: s.stave.getYForLine(s.isTab ? s.definition.settings.tuning.length - 1 : 4), top: s.stave.getYForLine(0) })) }
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

function drawDirections(svg,measure,points,staves,doc) {
  const drawText=(text,x,y,attributes={})=>{const node=svgNode(doc,'text',{x,y,'font-family':'serif','font-size':16,fill:'#202633',...attributes});node.textContent=text;svg.append(node);return node}
  for(const tempo of measure.tempoEvents||[])drawText(`♩ = ${Number(tempo.bpm).toFixed(0)}`,interpolateScorePosition(points,tempo.beat),38,{'font-size':13})
  for(const symbol of measure.symbols||[]) {
    const staff=staves.find(s=>s.id===symbol.staffId)||staves[0]
    if(!staff||symbol.type==='slur')continue
    const x=interpolateScorePosition(points,symbol.beat),y=staff.stave.getYForLine(symbol.placement==='below'||symbol.type==='dynamic'?4:0)+(symbol.placement==='below'||symbol.type==='dynamic'?30:-36)
    let node
    if(['crescendo','diminuendo'].includes(symbol.type)){
      const end=interpolateScorePosition(points,symbol.endBeat),range=Math.max(.001,symbol.endBeat-symbol.beat)
      const a=Math.max(0,(measure.startBeat-symbol.beat)/range),b=Math.min(1,(measure.endBeat-symbol.beat)/range)
      const startOpening=(symbol.type==='crescendo'?a:1-a)*6,endOpening=(symbol.type==='crescendo'?b:1-b)*6
      const below=staff.stave.getYForLine(4)+32
      node=svgNode(doc,'path',{d:`M${x} ${below-startOpening} L${end} ${below-endOpening} M${x} ${below+startOpening} L${end} ${below+endOpening}`,stroke:'#202633',fill:'none','stroke-width':1.5})
      svg.append(node)
    }else if(symbol.beat>=measure.startBeat){node=drawText(symbol.text,x,y,{'font-style':symbol.type==='dynamic'?'italic':'normal','font-weight':['dynamic','rehearsal'].includes(symbol.type)?'bold':'normal'})}
    if(node){node.dataset.scoreSymbol=symbol.id;node.setAttribute('role','button');node.setAttribute('aria-label',`${symbol.type} ${symbol.text}, beat ${symbol.beat}`);node.classList.add('soura-score-symbol')}
  }
}
