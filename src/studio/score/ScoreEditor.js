import {interpretDocument} from './scoreDocument.js'
import {layoutScore,visibleLayoutCells} from './scoreLayout.js'
import {engraveMeasure,interpolateScorePosition} from './scoreEngraver.js'
import {drawScoreConnections} from './scoreConnections.js'
import {pitchToStaffPosition,staffPositionToPitch,spellPitch,measureAtBeat} from './scoreTheory.js'
import {scoreToolbar,esc,field,menu,options} from './scoreUI.js'
import {printScore,downloadMusicXML} from './scoreOutput.js'
const sessions=new Map()

export function mountScoreEditor(root,host) {
  const doc=host.document(),parts=host.sources()
  const session=sessions.get('score')||{left:0,top:0,zoom:1,tool:'select',duration:1,caret:0,pitch:60,part:parts[0]?.id,verse:1}
  if(!parts.some(p=>p.id===session.part))session.part=parts[0]?.id
  const abort=new AbortController(),signal=abort.signal,on=(node,type,fn,opts={})=>node?.addEventListener(type,fn,{...opts,signal})
  const owner=root.ownerDocument,win=owner.defaultView
  let model=interpretDocument(parts,{...host.context(),document:doc,secondsToProjectBeat:host.secondsToProjectBeat})
  let layout=layoutScore(model,doc.layout),frame=0,destroyed=false,drag=null,lastBeat=host.playhead().beat,lastPlaying=host.playhead().playing,symbolId=session.symbolId||null
  const cells=new Map()
  const activePart=()=>parts.find(p=>p.id===session.part)||parts[0]
  const selected=()=>model.events.filter(e=>host.selection().includes(e.id))
  const selectedEvent=()=>selected()[0]
  const editable=()=>activePart()?.regions.some(r=>r.type!=='audio')
  root.innerHTML=scoreToolbar(parts,doc,session)+`<div class="soura-score-scroll" tabindex="0" role="region" aria-label="Score notation"><div class="soura-score-paper"><svg class="soura-score-connections"></svg><div class="soura-score-playhead" hidden></div><div class="soura-score-caret" hidden></div><div class="soura-score-marquee" hidden></div></div></div><div class="soura-score-status" role="status" data-score-status></div>`
  const sidebar=root.querySelector('.soura-score-sidebar')
  on(root,'toggle',e=>{if(e.target.dataset.scoreSection){session.sections||={};session.sections[e.target.dataset.scoreSection]=e.target.open}},{capture:true})
  const viewport=root.querySelector('.soura-score-scroll'),paper=root.querySelector('.soura-score-paper'),overlay=root.querySelector('.soura-score-connections'),marker=root.querySelector('.soura-score-playhead'),caret=root.querySelector('.soura-score-caret'),marquee=root.querySelector('.soura-score-marquee'),status=root.querySelector('[data-score-status]')
  const say=text=>status.textContent=text
  const empty=()=>parts.length?'All staffs are hidden. Use Staffs to show an instrument.':'Select MIDI regions, choose a track, or analyze audio in Pitch Trace to see notation.'
  say(model.events.length?`${model.events.length} notes · ${model.measures.length} measures · ${parts.filter(p=>p.visible).length} parts · notation does not change MIDI timing${parts.some(p=>p.regions.some(r=>r.type==='audio'))?' · Analyzed audio: read only; uncertain notes have dashed outlines.':''}`:empty())
  if(!model.measures.length){const message=owner.createElement('p');message.className='soura-score-empty';message.textContent=empty();paper.append(message)}
  const tracks=root.querySelector('[data-source-tracks]')
  for(const track of host.tracks())tracks.insertAdjacentHTML('beforeend',`<label><input type="checkbox" data-source-track="${esc(track.id)}" ${doc.source.trackIds.includes(track.id)?'checked':''}>${esc(track.name)}</label>`)
  function updateOverlays(){
    const ids=host.selection()
    for(const cell of cells.values())for(const hit of cell.hits){const yes=ids.includes(hit.event.id);hit.node.classList.toggle('is-selected',yes);hit.node.setAttribute('aria-pressed',String(yes));hit.node.setAttribute('tabindex',yes?'0':'-1')}
    overlay.style.cssText=`width:${layout.width*session.zoom}px;height:${layout.height*session.zoom}px`
    overlay.setAttribute('viewBox',`0 0 ${layout.width} ${layout.height}`)
    drawScoreConnections(overlay,cells,layout,doc.symbols)
    root.querySelectorAll('[data-score-symbol]').forEach(n=>{n.classList.toggle('is-selected',n.dataset.scoreSymbol===symbolId);n.setAttribute('aria-pressed',String(n.dataset.scoreSymbol===symbolId))})
    const position=layout.cells.find(c=>session.caret>=c.measure.startBeat&&session.caret<c.measure.endBeat),cell=position&&cells.get(position.id)
    caret.hidden=session.tool!=='insert'||!cell
    if(cell){caret.style.left=`${(position.x+interpolateScorePosition(cell.points,session.caret)*position.scale)*session.zoom}px`;caret.style.top=`${position.y*session.zoom}px`;caret.style.height=`${position.height*position.scale*session.zoom}px`}
    root.querySelector('[data-caret-label]').textContent=`Beat ${session.caret.toFixed(3)}${session.tool==='insert'?' · A–G enter, R rest, Enter repeat':''}`
  }
  function inspect(){
    const box=root.querySelector('[data-score-inspector]'),events=selected(),event=events[0],symbol=doc.symbols.find(s=>s.id===symbolId)
    if(symbol){box.innerHTML=`<strong>${esc(symbol.type)}</strong>${field('symbolTextEdit','Symbol text',symbol.text)}${field('symbolBeat','Anchor beat',symbol.beat,'number','min="0" step="0.125"')}${field('symbolEnd','End beat',symbol.endBeat??symbol.beat+1,'number','min="0" step="0.125"')}${menu('placement','Placement',['above','below'],symbol.placement,'data-symbol-field')}<button data-action="apply-symbol">Apply symbol</button><button data-action="delete-symbol">Delete symbol</button>`;updateOverlays();return}
    if(!event){box.textContent='Click / Shift-click notes, drag a marquee, or use note entry. Arrows move notes; Shift ↑/↓ moves octaves; Shift ←/→ changes duration. [ / ] navigates.';updateOverlays();return}
    if(event.origin==='analysis'){box.textContent=`Analyzed pitch ${event.pitch} · confidence ${Math.round(event.confidence*100)}% · Read only. Edit in Pitch Trace.`;updateOverlays();return}
    const single=events.length===1,disabled=single?'':'disabled'
    const spellings=['C','D','E','F','G','A','B'].flatMap(step=>[-2,-1,0,1,2].map(alter=>({step,alter}))).filter(p=>{const n=spellPitch(event.pitch,'C',p);return n.step===p.step&&n.alter===p.alter})
    const verse=Number(session.verse)||1,lyric=event.notation.lyrics?.find(l=>Number(l.verse||1)===verse)||{}
    box.innerHTML=`<span>${events.length} selected</span>${field('pitch','Pitch (MIDI)',event.pitch,'number',`min="0" max="127" data-note-field ${disabled}`)}${field('startBeat','Start beat',event.startBeat,'number',`min="0" step="0.125" data-note-field ${disabled}`)}${field('durationBeats','Duration (beats)',event.durationBeats,'number','min="0.015625" step="0.125" data-note-field')}${field('velocity','Velocity',event.velocity,'number','min="0" max="1" step="0.05" data-note-field')}<button data-action="apply-note">Apply values</button>
      <details class="soura-score-options"><summary>Note notation</summary><div>
      ${menu('spelling','Spelling',[['','Automatic'],...spellings.map(p=>[JSON.stringify(p),`${p.step}${['bb','b','','#','##'][p.alter+2]}`])],event.notation.spelling?JSON.stringify(event.notation.spelling):'','data-notation')}
      ${menu('staff','Note staff',[['','Automatic'],'treble','bass'],event.notation.staff||'','data-notation')}${menu('voice','Voice',[['','Automatic'],[0,'1'],[1,'2'],[2,'3'],[3,'4']],event.notation.voice??'','data-notation')}
      ${menu('notehead','Notehead',['normal','x','diamond'],event.notation.notehead||'normal','data-notation')}${menu('tabString','TAB string',[['','Automatic'],...activePart().settings.tuning.map((_,i)=>i+1)],event.notation.tabString??'','data-notation')}
      <label><input type="checkbox" data-notation="courtesyAccidental" ${event.notation.courtesyAccidental?'checked':''}>Courtesy accidental</label>
      </div></details>
      <details class="soura-score-options" ${session.lyrics?'open':''}><summary>Lyrics</summary><div>
      ${field('verse','Verse',verse,'number','min="1" max="8"')}${field('lyric','Syllable',lyric.text||'')}${menu('syllabic','Syllabic',['single','begin','middle','end'],lyric.syllabic||'single','data-lyric')}
      <label><input data-lyric-extend type="checkbox" ${lyric.extend?'checked':''}>Melisma extension</label><button data-action="lyric">Apply lyric</button><button data-action="lyric-next">Apply & next</button>
      </div></details>`
    updateOverlays()
  }
  function renderPaper(){
    paper.style.width=`${layout.width*session.zoom}px`;paper.style.height=`${layout.height*session.zoom}px`
    for(const page of layout.pages){const n=owner.createElement('section');n.className='soura-score-page';n.style.cssText=`left:0;top:${page.y*session.zoom}px;width:${page.width*session.zoom}px;height:${page.height*session.zoom}px`;n.innerHTML=`<header style="transform:scale(${session.zoom})"><h2>${esc(page.index===0?doc.metadata.title||host.title():'')}</h2><p>${esc(page.index===0?doc.metadata.subtitle:'')}</p><span>${esc(page.index===0?doc.metadata.composer:'')}</span></header><footer>${page.index+1}</footer>`;paper.prepend(n)}
    for(const system of layout.systems){const label=owner.createElement('div');label.className='soura-score-staff-labels';label.style.cssText=`left:${system.x*session.zoom}px;top:${system.y*session.zoom}px;transform:scale(${session.zoom*system.scale});transform-origin:top left`;label.innerHTML=model.staffDefinitions.map((d,i)=>`<button data-staff="${esc(d.trackId)}" style="top:${110+i*180}px" aria-label="Select ${esc(d.name)}">${esc(system.index===0?d.name:d.abbreviation)}</button>`).join('');paper.append(label)}
  }
  function drawVisible(){
    frame=0;if(destroyed)return
    const visible=visibleLayoutCells(layout,{left:viewport.scrollLeft,top:viewport.scrollTop,width:viewport.clientWidth,height:viewport.clientHeight,zoom:session.zoom})
    const ids=new Set(visible.map(c=>c.id))
    for(const[id,cell]of cells)if(!ids.has(id)){cell.node.remove();cells.delete(id)}
    for(const position of visible)if(!cells.has(position.id)){
      const node=owner.createElement('div');node.className='soura-score-measure';node.dataset.measure=position.id;node.style.cssText=`left:${position.x*session.zoom}px;top:${position.y*session.zoom}px;width:${position.width}px;transform:scale(${session.zoom*position.scale})`;paper.append(node)
      try{const measure={...position.measure,width:position.width};cells.set(position.id,{...engraveMeasure(node,measure,model,{},position),node,measure,layout:position})}
      catch(error){if(import.meta.env.DEV)node.dataset.scoreError=error.stack;node.textContent=`Measure ${position.measure.number}: notation error`;console.error('Score engraving',error);say(error.message);cells.set(position.id,{node,layout:position,measure:position.measure,hits:[],points:[],staves:[]})}
    }
    updateOverlays();updatePlayhead(lastBeat,lastPlaying)
  }
  const schedule=()=>{if(!frame)frame=win.requestAnimationFrame(drawVisible)}
  function locate(e){
    const rect=paper.getBoundingClientRect(),x=(e.clientX-rect.left)/session.zoom,y=(e.clientY-rect.top)/session.zoom
    const p=layout.cells.find(c=>x>=c.x&&x<=c.x+c.width*c.scale&&y>=c.y&&y<=c.y+c.height*c.scale),cell=p&&cells.get(p.id)
    if(!cell?.points.length)return {x,y}
    const localY=(y-p.y)/p.scale,staff=[...cell.staves].sort((a,b)=>Math.abs(localY-(a.top+a.bottom)/2)-Math.abs(localY-(b.top+b.bottom)/2))[0]
    return {x,y,localY,cell,staff,beat:interpolateScorePosition(cell.points,(x-p.x)/p.scale,'x','beat')}
  }
  const snapped=beat=>Math.max(0,Math.round(beat/model.quantum)*model.quantum)
  const value=key=>root.querySelector(`[data-field="${key}"]`)?.value
  const anchor=()=>({trackId:selectedEvent()?.trackId||session.part,staff:session.staff||selectedEvent()?.notation.staff||model.staffDefinitions.find(d=>d.trackId===session.part)?.localId||'',beat:selectedEvent()?.startBeat??session.caret})
  const changeDocument=patch=>{session.symbolId=null;host.updateDocument(patch)}
  const applyNote=()=>{const patch={};root.querySelectorAll('[data-note-field][data-dirty]').forEach(n=>{if(n.value!==''&&Number.isFinite(Number(n.value)))patch[n.dataset.field]=Number(n.value)});if(Object.keys(patch).length)host.edit(patch)}
  on(root,'input',e=>{if(e.target.matches('[data-note-field]'))e.target.dataset.dirty='true'})
  on(root,'click',async e=>{
    // soura-score-codex-completion-v1: repaired Codex staff-order document update syntax; preserve shared score document/history flow.
    const button=e.target.closest('button'),action=button?.dataset.action
    if(button?.dataset.staff){session.part=button.dataset.staff;host.selectTrack(session.part);return}
    if(button?.dataset.order){const order=parts.map(p=>p.id),i=order.indexOf(button.dataset.order),j=i+Number(button.dataset.direction);if(j>=0&&j<order.length){[order[i],order[j]]=[order[j],order[i]];changeDocument({parts:{...doc.parts,...Object.fromEntries(order.map((id,n)=>[id,{...doc.parts[id],order:n}]))}})}return}
    if(button?.dataset.mark){host.toggleMark(button.dataset.mark,button.dataset.value);return}
    if(button?.dataset.dynamic){host.symbol({...anchor(),type:'dynamic',text:button.dataset.dynamic,placement:'below'});return}
    if(button?.dataset.line){host.symbol({...anchor(),type:button.dataset.line,endBeat:Math.max(...selected().map(n=>n.startBeat+n.durationBeats),anchor().beat+2),placement:'below'});return}
    if(button?.dataset.break){const m=measureAtBeat(model.measures,anchor().beat);if(m)changeDocument({layout:{...doc.layout,breaks:[...doc.layout.breaks.filter(b=>b.measure!==m.index),...(button.dataset.break==='remove'?[]:[{measure:m.index,type:button.dataset.break}])]}});return}
    if(!action)return
    if(['undo','redo','delete','source'].includes(action)){if(action==='delete'&&symbolId)host.deleteSymbol(symbolId);else host[action==='source'?'openSource':action]();return}
    if(action==='apply-note'){applyNote();return}
    if(action==='metadata'){changeDocument({metadata:{...doc.metadata,...Object.fromEntries(Object.keys(doc.metadata).map(k=>[k,value(k)??doc.metadata[k]]))},layout:{...doc.layout,margin:Number(value('margin')),systemSpacing:Number(value('systemSpacing'))}});return}
    if(action==='part-name'){changeDocument({parts:{...doc.parts,[session.part]:{...doc.parts[session.part],name:value('partName'),abbreviation:value('partAbbreviation')}}});return}
    if(action==='add-text'){host.symbol({...anchor(),type:session.symbolType||'chord',text:value('symbolText')});return}
    if(action==='slur'){const notes=selected().sort((a,b)=>a.startBeat-b.startBeat);if(notes.length<2){say('Select two or more notes for a phrase slur.');return}if(notes[0].trackId!==notes.at(-1).trackId){say('A phrase slur must stay on one instrument.');return}host.symbol({...anchor(),type:'slur',beat:notes[0].startBeat,endBeat:notes.at(-1).startBeat,startNote:notes[0].id,endNote:notes.at(-1).id});return}
    if(action==='apply-symbol'){const symbol=doc.symbols.find(s=>s.id===symbolId);host.symbol({...symbol,text:value('symbolTextEdit'),beat:Number(value('symbolBeat')),endBeat:Number(value('symbolEnd')),placement:root.querySelector('[data-symbol-field]').value});return}
    if(action==='delete-symbol'){host.deleteSymbol(symbolId);session.symbolId=null;return}
    if(action==='clef-change'){const m=measureAtBeat(model.measures,anchor().beat);if(m)host.symbol({...anchor(),type:'clef',beat:m.startBeat,text:session.changeClef||'treble'});return}
    if(action==='measure'){const m=measureAtBeat(model.measures,anchor().beat);host.selectMany(model.events.filter(n=>n.startBeat>=m.startBeat&&n.startBeat<m.endBeat&&n.trackId===session.part&&n.origin==='midi').map(n=>n.id));inspect();return}
    if(action==='respell'){const n=selectedEvent();if(!n)return;const current=spellPitch(n.pitch,'C',n.notation.spelling),next=spellPitch(n.pitch,'C',{step:current.alter>=0?String.fromCharCode(current.step.charCodeAt(0)+1).replace('H','A'):String.fromCharCode(current.step.charCodeAt(0)-1).replace('@','G'),alter:current.alter>=0?-1:1});host.edit({notation:{spelling:{step:next.step,alter:next.alter}}});return}
    if(action==='clear-marks'){host.edit({notation:{articulations:[],ornaments:[]}});return}
    if(action==='lyric'||action==='lyric-next'){
      const n=selectedEvent();if(!n)return;session.verse=Math.max(1,Number(value('verse'))||1);session.lyrics=true
      const lyrics=[...(n.notation.lyrics||[]).filter(l=>Number(l.verse||1)!==session.verse),{verse:session.verse,text:value('lyric'),syllabic:root.querySelector('[data-lyric]').value,extend:root.querySelector('[data-lyric-extend]').checked}]
      const next=model.events.filter(e=>e.trackId===n.trackId&&e.startBeat>n.startBeat).sort((a,b)=>a.startBeat-b.startBeat)[0]
      host.edit({notation:{lyrics}});if(action==='lyric-next'&&next){host.select(next.id);session.nextLyric=next.id}return
    }
    if(action==='print'){try{await printScore(model,doc,host.title(),owner)}catch(err){say(err.message)}return}
    if(action==='xml'){downloadMusicXML(model,doc,host.title(),owner);return}
  })
  on(root,'change',e=>{
    const n=e.target
    if(n.matches('[data-note-field]')){n.dataset.dirty='true';applyNote();return}
    if(n.dataset.session){const key=n.dataset.session;session[key]=n.type==='checkbox'?n.checked:['zoom','duration'].includes(key)?Number(n.value):n.value;if(key==='part')host.selectTrack(n.value);host.refresh();return}
    if(n.dataset.documentControl){const key=n.dataset.documentControl;session.left=0;session.top=0;viewport.scrollLeft=0;viewport.scrollTop=0;changeDocument(key==='source'?{source:{...doc.source,mode:n.value}}:{layout:{...doc.layout,type:n.value}});return}
    if(n.dataset.layout){changeDocument({layout:{...doc.layout,[n.dataset.layout]:n.value}});return}
    if(n.dataset.sourceTrack){const id=n.dataset.sourceTrack;changeDocument({source:{...doc.source,trackIds:n.checked?[...new Set([...doc.source.trackIds,id])]:doc.source.trackIds.filter(v=>v!==id)}});return}
    if(n.dataset.visible){const id=n.dataset.visible;changeDocument({parts:{...doc.parts,[id]:{...doc.parts[id],visible:n.checked}}});return}
    if(n.dataset.setting){const key=n.dataset.setting;let v=n.type==='checkbox'?n.checked:n.value;if(['splitPitch','capo','maxFret','instrumentTranspose'].includes(key))v=Number(v);if(key==='concertPitch')v=v==='true';if(key==='tuning'){v=v.split(',').map(Number);if(!v.length||!v.every(n=>Number.isInteger(n)&&n>=0&&n<=127)){say('Enter MIDI pitches separated by commas.');return}}host.settings({...activePart().settings,[key]:v},session.part);return}
    if(n.dataset.notation){const key=n.dataset.notation,raw=n.value;host.edit({notation:{[key]:n.type==='checkbox'?n.checked:raw===''?undefined:key==='spelling'?JSON.parse(raw):['voice','tabString'].includes(key)?Number(raw):raw}});return}
    if(n.dataset.field==='verse'){session.verse=Number(n.value);session.lyrics=true;inspect()}
  })
  on(viewport,'pointerdown',e=>{
    if(e.button!==0)return
    const symbol=e.target.closest('[data-score-symbol]');if(symbol){symbolId=symbol.dataset.scoreSymbol;session.symbolId=symbolId;host.select(null);inspect();return}
    symbolId=null;session.symbolId=null
    const p=locate(e),target=e.target.closest('[data-score-note]');viewport.focus({preventScroll:true})
    if(!p.cell)return
    session.caret=snapped(p.beat);session.part=p.staff.trackId;session.staff=model.staffDefinitions.find(d=>d.id===p.staff.id)?.localId
    if(target){const hit=p.cell.hits.find(h=>h.node===target);if(!hit)return;if(e.shiftKey||!host.selection().includes(hit.event.id))host.select(hit.event.id,e.shiftKey);inspect();if(hit.event.origin==='midi'&&!e.shiftKey)drag={type:'note',x:e.clientX,y:e.clientY,point:p,hit};}
    else if(session.tool==='insert'&&editable()){
      const part=activePart(),str=Math.max(1,Math.min(part.settings.tuning.length,Math.round((p.localY-p.staff.top)/13)+1)),def=model.staffDefinitions.find(d=>d.id===p.staff.id),key=p.cell.measure.staffKeys[p.staff.id]
      const written=staffPositionToPitch((p.staff.bottom-p.localY)/5,p.staff.clef,key),pitch=p.staff.isTab?part.settings.tuning[str-1]+part.settings.capo:written-(part.settings.concertPitch?0:part.settings.instrumentTranspose)
      if(p.staff.clef==='percussion'){say('Use MIDI pitch entry for drum notes; the staff uses the isolated GM drum map.');return}
      host.insert({pitch,startBeat:session.caret,durationBeats:session.duration,notation:p.staff.isTab?{tabString:str}:{staff:def.localId}},session.part);session.caret+=session.duration
    }else{drag={type:'marquee',point:p,x:e.clientX,y:e.clientY,additive:e.shiftKey,before:host.selection()};marquee.hidden=false;marquee.style.cssText=`left:${p.x*session.zoom}px;top:${p.y*session.zoom}px;width:0;height:0`}
    if(drag){e.preventDefault();viewport.setPointerCapture(e.pointerId)}updateOverlays()
  })
  on(viewport,'pointermove',e=>{if(!drag)return;const p=locate(e);if(drag.type==='marquee')marquee.style.cssText=`left:${Math.min(p.x,drag.point.x)*session.zoom}px;top:${Math.min(p.y,drag.point.y)*session.zoom}px;width:${Math.abs(p.x-drag.point.x)*session.zoom}px;height:${Math.abs(p.y-drag.point.y)*session.zoom}px`;else for(const cell of cells.values())for(const hit of cell.hits)if(host.selection().includes(hit.event.id))hit.node.style.transform=`translate(${(e.clientX-drag.x)/(session.zoom*cell.layout.scale)}px,${(e.clientY-drag.y)/(session.zoom*cell.layout.scale)}px)`})
  on(viewport,'pointerup',e=>{
    if(!drag)return;const start=drag;drag=null;marquee.hidden=true;for(const c of cells.values())for(const h of c.hits)h.node.style.transform=''
    const p=locate(e)
    if(start.type==='marquee'){const ids=[];for(const c of cells.values())for(const h of c.hits){const x=c.layout.x+h.x*c.layout.scale,y=c.layout.y+h.y*c.layout.scale;if(x>=Math.min(p.x,start.point.x)&&x<=Math.max(p.x,start.point.x)&&y>=Math.min(p.y,start.point.y)&&y<=Math.max(p.y,start.point.y)&&h.event.origin==='midi')ids.push(h.event.id)}host.selectMany([...new Set([...(start.additive?start.before:[]),...ids])]);inspect();return}
    if(Math.hypot(e.clientX-start.x,e.clientY-start.y)<4||!p.cell)return
    const hit=start.hit,part=parts.find(part=>part.id===hit.event.trackId),written=hit.event.pitch,key=start.point.cell.measure.staffKeys[hit.staffId]
    const steps=Math.round((start.y-e.clientY)/(5*session.zoom*start.point.cell.layout.scale))
    const deltaPitch=hit.isTab||hit.clef==='percussion'?0:staffPositionToPitch(pitchToStaffPosition(written,hit.clef,key,hit.event.notation.spelling)+steps,hit.clef,key)-written
    host.move(Math.round((p.beat-start.point.beat)/model.quantum)*model.quantum,deltaPitch)
  })
  on(viewport,'pointercancel',()=>{drag=null;marquee.hidden=true;for(const c of cells.values())for(const h of c.hits)h.node.style.transform=''})
  on(root,'keydown',e=>{
    if(e.target.closest('input,select,textarea')){if(e.key==='Enter'&&e.target.matches('[data-note-field]')){e.preventDefault();e.target.dataset.dirty='true';applyNote()}return}
    const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey
    let action
    if(mod&&['z','y','c','v','x','a'].includes(key))action=()=>{if(key==='a'){host.selectAll();inspect()}else host[{z:e.shiftKey?'redo':'undo',y:'redo',c:'copy',v:'paste',x:'cut'}[key]]()}
    else if(['delete','backspace'].includes(key))action=()=>symbolId?host.deleteSymbol(symbolId):host.delete()
    else if(key.startsWith('arrow'))action=()=>{const sign=['arrowleft','arrowdown'].includes(key)?-1:1;if(e.shiftKey&&['arrowleft','arrowright'].includes(key)){const n=selectedEvent();if(n)host.edit({durationBeats:Math.max(1/64,n.durationBeats+sign*model.quantum)})}else host.move(['arrowleft','arrowright'].includes(key)?sign*model.quantum:0,['arrowup','arrowdown'].includes(key)?sign*(e.shiftKey?12:1):0)}
    else if(key==='['||key===']')action=()=>{const notes=model.events.filter(n=>n.trackId===session.part).sort((a,b)=>a.startBeat-b.startBeat||a.pitch-b.pitch),index=notes.findIndex(n=>n.id===selectedEvent()?.id),next=notes[Math.max(0,Math.min(notes.length-1,index+(key===']'?1:-1)))];if(next){host.select(next.id);session.caret=next.startBeat;inspect()}}
    else if(session.tool==='insert'&&/^[a-g]$/.test(key))action=()=>{const pc={c:0,d:2,e:4,f:5,g:7,a:9,b:11}[key];session.pitch=60+pc+(e.shiftKey?12:0);host.insert({pitch:session.pitch,startBeat:session.caret,durationBeats:session.duration},session.part);session.caret+=session.duration}
    else if(session.tool==='insert'&&key==='r')action=()=>{session.caret+=session.duration;updateOverlays()}
    else if(session.tool==='insert'&&key==='enter')action=()=>{host.insert({pitch:session.pitch,startBeat:session.caret,durationBeats:session.duration},session.part);session.caret+=session.duration}
    else if(key==='escape')action=()=>{symbolId=null;session.symbolId=null;host.select(null);inspect()}
    if(action){e.preventDefault();e.stopPropagation();action()}
  })
  function updatePlayhead(beat,playing){
    lastBeat=beat;lastPlaying=playing
    const p=layout.cells.find(c=>beat>=c.measure.startBeat&&beat<c.measure.endBeat),cell=p&&cells.get(p.id)
    marker.hidden=!cell?.points.length
    if(cell?.points.length){marker.style.left=`${(p.x+interpolateScorePosition(cell.points,beat)*p.scale)*session.zoom}px`;marker.style.top=`${p.y*session.zoom}px`;marker.style.height=`${p.height*p.scale*session.zoom}px`}
    for(const c of cells.values())for(const h of c.hits)h.node.classList.toggle('is-playing',playing&&beat>=h.event.startBeat&&beat<h.event.startBeat+h.event.durationBeats)
    if(playing&&session.follow&&p){const x=p.x*session.zoom,y=p.y*session.zoom;if(x<viewport.scrollLeft||x>viewport.scrollLeft+viewport.clientWidth*.85)viewport.scrollLeft=x;if(y<viewport.scrollTop||y>viewport.scrollTop+viewport.clientHeight*.85)viewport.scrollTop=y}
  }
  sidebar.scrollTop=session.sidebarTop||0
  renderPaper();viewport.scrollLeft=session.left;viewport.scrollTop=session.top;drawVisible();inspect()
  on(viewport,'scroll',schedule,{passive:true});const observer=new win.ResizeObserver(schedule);observer.observe(viewport)
  if(session.focus)viewport.focus({preventScroll:true})
  return {updatePlayhead,destroy(){session.sidebarTop=sidebar.scrollTop;session.left=viewport.scrollLeft;session.top=viewport.scrollTop;session.focus=root.contains(owner.activeElement);sessions.set('score',session);destroyed=true;abort.abort();observer.disconnect();win.cancelAnimationFrame(frame)}}
}
