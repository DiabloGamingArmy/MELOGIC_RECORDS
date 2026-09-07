import { collectScoreEvents, DISPLAY_QUANTA, normalizeRegionScore, scoreEligibility } from './scoreModel.js'
import { interpretScore } from './scoreInterpretation.js'
import { engraveMeasure, interpolateScorePosition } from './scoreEngraver.js'
import { pitchToStaffPosition, staffPositionToPitch, spellPitch } from './scoreTheory.js'

const escape = text => String(text).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
const option = (value, label, current) => `<option value="${escape(value)}" ${String(current) === String(value) ? 'selected' : ''}>${escape(label)}</option>`
const select = (key, label, values, current) => `<label>${label}<select data-setting="${key}" aria-label="${label}">${values.map(v => option(Array.isArray(v) ? v[0] : v, Array.isArray(v) ? v[1] : v, current)).join('')}</select></label>`
const numeric = (key, label, value, min, max, step = 1) => `<label>${label}<input data-note-field="${key}" aria-label="${label}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`
const sessions = new Map()

/** A disposable view of the host's live region. No independent project or audio engine. */
export function mountScoreEditor(root, host) {
  const region = host.region(), eligibility = scoreEligibility(region)
  const abort = new AbortController(), signal = abort.signal
  let settings = normalizeRegionScore(region?.score).settings
  const session = sessions.get(region?.id) || { left: 0, top: 0, tool: 'select', duration: 1, focus: false }
  let model, frame = 0, observer, destroyed = false, drag = null, lastBeat = host.playhead().beat
  const cells = new Map()
  const on = (node, type, fn, options = {}) => node?.addEventListener(type, fn, { ...options, signal })
  root.innerHTML = `<div class="soura-score-toolbar"><strong data-score-title></strong><button data-action="piano">${region?.type === 'audio' ? 'Open Pitch Trace' : 'Piano Roll'}</button><span class="soura-score-origin">${eligibility.kind === 'analysis' ? 'Analyzed interpretation · read only' : 'MIDI · shared notes'}</span></div>${eligibility.eligible ? `
    <div class="soura-score-toolbar" data-score-controls>
    ${select('mode', 'View', [['standard','Standard'],['grand','Grand staff'],['tab','TAB'],['combined','Standard + TAB']], settings.mode)}
    ${select('clef', 'Clef', ['auto','treble','bass','alto','tenor'], settings.clef)}
    ${select('quantization', 'Display grid', Object.keys(DISPLAY_QUANTA), settings.quantization)}
    ${select('zoom', 'Zoom', [[.5,'50%'],[.75,'75%'],[1,'100%'],[1.25,'125%'],[1.5,'150%'],[2,'200%']], settings.zoom)}
    <label>Tool<select data-tool aria-label="Score tool" ${eligibility.editable ? '' : 'disabled'}>${option('select','Select / move',session.tool)}${option('insert','Insert note',session.tool)}</select></label>
    <label>Entry duration<select data-duration aria-label="Entry duration">${[[4,'Whole'],[2,'Half'],[1,'Quarter'],[.5,'Eighth'],[.25,'Sixteenth'],[1.5,'Dotted quarter'],[1/3,'Eighth triplet']].map(([v,l]) => option(v,l,session.duration)).join('')}</select></label>
    <button data-action="delete" ${eligibility.editable ? '' : 'disabled'}>Delete</button><button data-action="undo">Undo</button><button data-action="redo">Redo</button>
    <details class="soura-score-options"><summary>Notation & TAB</summary><div>
    ${select('key', 'Key', ['project','C','G','D','A','E','B','F#','F','Bb','Eb','Ab','Db','Gb','Am','Em','Bm','Dm','Gm','Cm'], settings.key)}
    <label>Grand staff split<input type="number" data-setting="splitPitch" aria-label="Grand staff split" value="${settings.splitPitch}" min="0" max="127"></label>
    <label>Tuning, MIDI (string 1 first)<input data-setting="tuning" aria-label="TAB tuning" value="${settings.tuning.join(', ')}"></label>
    <label>Capo<input type="number" data-setting="capo" aria-label="Capo" value="${settings.capo}" min="0" max="12"></label>
    <label>Maximum fret<input type="number" data-setting="maxFret" aria-label="Maximum fret" value="${settings.maxFret}" min="1" max="36"></label>
    <label><input type="checkbox" data-setting="showNames" ${settings.showNames ? 'checked' : ''}>Note names</label>
    <label><input type="checkbox" data-setting="showMuted" ${settings.showMuted ? 'checked' : ''}>Show muted notes</label>
    <label><input type="checkbox" data-setting="follow" ${settings.follow ? 'checked' : ''}>Follow playhead</label>
    </div></details></div>
    <div class="soura-score-inspector" data-score-inspector></div>
    <div class="soura-score-scroll" tabindex="0" role="region" aria-label="Score notation. Select notes; arrows move, shift arrows change duration, Delete removes. Command or Control C, V, X, Z edit. Space plays."><div class="soura-score-paper"><div class="soura-score-playhead" hidden></div></div></div>
    <div class="soura-score-status" role="status" data-score-status></div>` : `<div class="soura-score-empty">${escape(eligibility.reason)}</div>`}`
  root.querySelector('[data-score-title]').textContent = region?.name || region?.title || 'Selected region'
  const viewport = root.querySelector('.soura-score-scroll'), paper = root.querySelector('.soura-score-paper'), marker = root.querySelector('.soura-score-playhead'), status = root.querySelector('[data-score-status]')
  on(root, 'click', e => {
    const action = e.target.closest('[data-action]')?.dataset.action
    if (!action) return
    session.focus = true
    if (action === 'piano') host.openSource()
    else if (action === 'delete' && eligibility.editable) host.delete()
    else if (action === 'undo' || action === 'redo') host[action]()
  })
  if (!eligibility.eligible) return { destroy() { abort.abort() }, updatePlayhead() {} }

  function inspect() {
    const selection = host.selection(), event = model.events.find(e => selection.includes(e.index))
    cells.forEach(cell => cell.hits.forEach(hit => {
      hit.node.classList.toggle('is-selected', selection.includes(hit.event.index))
      hit.node.setAttribute('aria-pressed', String(selection.includes(hit.event.index)))
    }))
    const inspector = root.querySelector('[data-score-inspector]')
    if (!event || !eligibility.editable) { inspector.textContent = eligibility.editable ? 'Select a note to edit. Shift-click adds to selection. Insert tool adds a note on the staff.' : eligibility.reason; return }
    const spelling = spellPitch(event.pitch, 'C', event.notation.spelling)
    inspector.innerHTML = `<span>${selection.length} selected</span>${numeric('pitch','Pitch (MIDI)',event.pitch,0,127)}${numeric('startBeat','Start beat',event.startBeat,0,100000,.125)}${numeric('durationBeats','Duration (beats)',event.durationBeats,1/64,10000,.125)}${numeric('velocity','Velocity',event.velocity,0,1,.05)}
    <label>Spelling<select data-notation="spelling" aria-label="Enharmonic spelling">${option('', 'Automatic', event.notation.spelling ? JSON.stringify(event.notation.spelling) : '')}${['C','D','E','F','G','A','B'].flatMap(step => [-2,-1,0,1,2].map(alter => ({step,alter}))).filter(p => spellPitch(event.pitch,'C',p).step === p.step && spellPitch(event.pitch,'C',p).alter === p.alter).map(p => option(JSON.stringify(p),`${p.step}${['bb','b','','#','##'][p.alter+2]}${spellPitch(event.pitch,'C',p).octave}`, event.notation.spelling ? JSON.stringify(event.notation.spelling) : '')).join('')}</select></label>
    <label>Staff<select data-notation="staff" aria-label="Note staff">${['','treble','bass'].map(v => option(v,v || 'Automatic',event.notation.staff || '')).join('')}</select></label>
    <label>Voice<select data-notation="voice" aria-label="Note voice">${['',0,1,2,3].map(v => option(v,v === '' ? 'Automatic' : Number(v)+1,event.notation.voice ?? '')).join('')}</select></label>
    <label>TAB string<select data-notation="tabString" aria-label="TAB string">${['',...settings.tuning.map((_,i) => i+1)].map(v => option(v,v || 'Automatic',event.notation.tabString ?? '')).join('')}</select></label>`
  }
  function rebuild() {
    const context = host.context()
    model = interpretScore(collectScoreEvents([host.region()], { secondsToProjectBeat: host.secondsToProjectBeat, showMuted: settings.showMuted }), { ...context, settings })
    for (const cell of cells.values()) cell.node.remove()
    cells.clear()
    paper.style.width = `${model.width * settings.zoom}px`
    paper.style.height = `${(settings.mode === 'grand' || settings.mode === 'combined' ? 360 : 210) * settings.zoom}px`
    status.textContent = `${model.events.length} notes · ${model.measures.length} measures · display grid ${Number(model.quantum.toFixed(4))} beats (MIDI timing unchanged)${['tab','combined'].includes(settings.mode) ? ` · ${[...model.tab.values()].filter(v => !v).length} unplayable notes marked X` : ''}`
    drawVisible()
    inspect()
  }
  function drawVisible() {
    frame = 0
    if (destroyed) return
    const left = (viewport.scrollLeft - viewport.clientWidth * .5) / settings.zoom, right = (viewport.scrollLeft + viewport.clientWidth * 1.5) / settings.zoom
    const visible = model.measures.filter(m => m.x + m.width >= left && m.x <= right)
    const ids = new Set(visible.map(m => m.index))
    for (const [id, cell] of cells) if (!ids.has(id)) { cell.node.remove(); cells.delete(id) }
    for (const measure of visible) if (!cells.has(measure.index)) {
      const node = root.ownerDocument.createElement('div')
      node.className = 'soura-score-measure'
      node.dataset.measure = measure.index
      node.style.cssText = `left:${measure.x * settings.zoom}px;transform:scale(${settings.zoom});width:${measure.width}px`
      paper.append(node)
      try { cells.set(measure.index, { ...engraveMeasure(node, measure, model, settings), node, measure }) }
      catch (error) { node.textContent = `Measure ${measure.number} cannot be engraved.`; node.classList.add('has-error'); cells.set(measure.index,{node,measure,hits:[],points:[],staves:[]}); status.textContent = `Notation layout failed: ${error.message}`; console.error('Score engraving', error) }
    }
    const selected = host.selection()
    cells.forEach(cell => cell.hits.forEach(hit => hit.node.classList.toggle('is-selected',selected.includes(hit.event.index))))
    updatePlayhead(lastBeat, false)
  }
  function scheduleDraw() { if (!frame) frame = requestAnimationFrame(drawVisible) }
  function point(e) {
    const rect = paper.getBoundingClientRect(), x = (e.clientX - rect.left) / settings.zoom, y = (e.clientY - rect.top) / settings.zoom
    const measure = model.measures.find(m => x >= m.x && x <= m.x + m.width)
    const cell = measure && cells.get(measure.index)
    if (!cell?.points.length) return null
    return { x, y, measure, cell, beat: interpolateScorePosition(cell.points, x - measure.x, 'x', 'beat') }
  }
  const snapped = beat => Math.round(beat / model.quantum) * model.quantum
  on(root, 'change', e => {
    session.focus = true
    if (e.target.matches('[data-setting]')) {
      const key = e.target.dataset.setting
      let value = e.target.type === 'checkbox' ? e.target.checked : e.target.value
      if (['zoom','splitPitch','capo','maxFret'].includes(key)) value = Number(value)
      if (key === 'tuning') {
        value = value.split(',').map(v => Number(v.trim()))
        if (!value.length || value.length > 12 || !value.every(n => Number.isInteger(n) && n >= 0 && n <= 127)) { status.textContent = 'Tuning requires 1–12 MIDI pitches from 0 to 127, separated by commas.'; return }
      }
      const previousZoom = settings.zoom
      settings = normalizeRegionScore({ settings: { ...settings, [key]: value } }).settings
      host.settings(settings)
      if (key === 'zoom') viewport.scrollLeft *= settings.zoom / previousZoom
      rebuild()
    } else if (e.target.matches('[data-tool]')) session.tool = e.target.value
    else if (e.target.matches('[data-duration]')) session.duration = Number(e.target.value)
    else if (eligibility.editable && e.target.matches('[data-note-field]')) host.edit({ [e.target.dataset.noteField]: Number(e.target.value) })
    else if (eligibility.editable && e.target.matches('[data-notation]')) {
      const key = e.target.dataset.notation, raw = e.target.value
      host.edit({ notation: { [key]: raw === '' ? undefined : key === 'spelling' ? JSON.parse(raw) : key === 'staff' ? raw : Number(raw) } })
    }
  })
  on(viewport, 'pointerdown', e => {
    if (e.button !== 0) return
    viewport.focus({ preventScroll: true }); session.focus = true
    const target = e.target.closest('[data-score-note]'), p = point(e)
    if (!p) return
    if (target) {
      e.preventDefault()
      const index = Number(target.dataset.sourceIndex)
      if (e.shiftKey || !host.selection().includes(index)) host.select(index,e.shiftKey)
      inspect()
      if (eligibility.editable && !e.shiftKey) {
        const hit = p.cell.hits.find(h => h.node === target)
        drag = { x:e.clientX, y:e.clientY, beat:p.beat, hit, pointer:e.pointerId }
        viewport.setPointerCapture(e.pointerId)
      }
    } else if (session.tool === 'insert' && eligibility.editable) {
      const staff = [...p.cell.staves].sort((a,b) => Math.abs(p.y-(a.top+a.bottom)/2)-Math.abs(p.y-(b.top+b.bottom)/2))[0]
      if (!staff) return
      const string = Math.max(1,Math.min(settings.tuning.length,Math.round((p.y-staff.top)/13)+1))
      const pitch = staff.isTab ? settings.tuning[string-1]+settings.capo : staffPositionToPitch((staff.bottom-p.y)/5,staff.clef,p.measure.key)
      host.insert({ pitch,startBeat:Math.max(host.context().startBeat,snapped(p.beat)),durationBeats:session.duration,notation:staff.isTab?{tabString:string}:{staff:staff.clef} })
    } else { host.select(null,false); inspect() }
  })
  on(viewport,'pointermove',e => { if (drag) { const dx=e.clientX-drag.x,dy=e.clientY-drag.y; drag.hit.node.style.transform=`translate(${dx/settings.zoom}px,${dy/settings.zoom}px)` } })
  on(viewport,'pointerup',e => {
    if (!drag) return
    const current = drag; drag = null; current.hit.node.style.transform = ''
    if (Math.hypot(e.clientX-current.x,e.clientY-current.y)<4) return
    const p=point(e)
    if (!p) return
    const deltaBeat = snapped(p.beat-current.beat)
    const hit=current.hit
    const originalPosition = pitchToStaffPosition(hit.event.pitch,hit.clef,p.measure.key,hit.event.notation.spelling)
    const deltaPitch = hit.isTab ? 0 : staffPositionToPitch(originalPosition+Math.round((current.y-e.clientY)/(5*settings.zoom)),hit.clef,p.measure.key)-hit.event.pitch
    host.move(deltaBeat,deltaPitch)
  })
  on(viewport,'pointercancel',() => { if(drag) drag.hit.node.style.transform=''; drag=null })
  on(root,'keydown',e => {
    if (e.target.closest('input,select,textarea,[contenteditable="true"]')) return
    const mod=e.metaKey||e.ctrlKey, key=e.key.toLowerCase()
    let action=null
    if (mod && key==='z') action=()=>host[e.shiftKey?'redo':'undo']()
    else if (mod && key==='y') action=()=>host.redo()
    else if (mod && ['c','v','x','a'].includes(key)) action=()=>{ if(!eligibility.editable)return; if(key==='a'){host.selectAll();inspect()}else host[{c:'copy',v:'paste',x:'cut'}[key]]() }
    else if (['delete','backspace'].includes(key)) action=()=>{if(eligibility.editable)host.delete()}
    else if (key.startsWith('arrow')) action=()=>{
      if (!eligibility.editable) return
      const direction=['arrowleft','arrowdown'].includes(key)?-1:1
      if(e.shiftKey && ['arrowleft','arrowright'].includes(key)) { const event=model.events.find(n=>host.selection().includes(n.index));if(event)host.edit({durationBeats:event.durationBeats+direction*model.quantum}) }
      else host.move(['arrowleft','arrowright'].includes(key)?direction*model.quantum:0,['arrowup','arrowdown'].includes(key)?direction*(e.shiftKey?12:1):0)
    }
    else if(key==='escape') action=()=>{host.select(null,false);inspect()}
    if(action){e.preventDefault();e.stopPropagation();session.focus=true;action()}
    // Space bubbles to Soura's single transport handler.
  })
  function updatePlayhead(beat, playing) {
    lastBeat=beat
    const measure=model?.measures.find(m=>beat>=m.startBeat&&beat<m.endBeat)
    const cell=measure&&cells.get(measure.index)
    marker.hidden=!cell?.points.length
    if(cell?.points.length) marker.style.left=`${(measure.x+interpolateScorePosition(cell.points,beat))*settings.zoom}px`
    cells.forEach(c=>c.hits.forEach(h=>h.node.classList.toggle('is-playing',playing&&beat>=h.event.startBeat&&beat<h.event.startBeat+h.event.durationBeats)))
    if(playing&&settings.follow&&measure){const x=measure.x*settings.zoom;if(x<viewport.scrollLeft||x>viewport.scrollLeft+viewport.clientWidth*.85)viewport.scrollLeft=x}
  }
  on(viewport,'scroll',scheduleDraw,{passive:true})
  observer=new ResizeObserver(scheduleDraw);observer.observe(viewport)
  rebuild();viewport.scrollLeft=session.left;viewport.scrollTop=session.top;drawVisible()
  if(session.focus)viewport.focus({preventScroll:true})
  return { updatePlayhead, destroy(){ destroyed=true;session.left=viewport.scrollLeft;session.top=viewport.scrollTop;sessions.set(region.id,session);abort.abort();observer.disconnect();cancelAnimationFrame(frame) } }
}
