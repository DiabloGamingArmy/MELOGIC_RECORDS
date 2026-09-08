import {DYNAMICS,ARTICULATIONS,ORNAMENTS} from './scoreSymbols.js'
export const esc = text => String(text ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
export const options=(values,current)=>values.map(v=>{const [id,label]=Array.isArray(v)?v:[v,v];return `<option value="${esc(id)}" ${String(id)===String(current)?'selected':''}>${esc(label)}</option>`}).join('')
export const field=(key,label,value,type='text',extra='')=>`<label>${label}<input data-field="${key}" aria-label="${label}" type="${type}" value="${esc(value)}" ${extra}></label>`
export const menu=(key,label,values,current,attribute='data-setting')=>`<label>${label}<select ${attribute}="${key}" aria-label="${label}">${options(values,current)}</select></label>`
// Kept as the existing UI entry point; event attributes and state stay unchanged.
export function scoreToolbar(parts,doc,session) {
  const part=parts.find(p=>p.id===session.part)||parts[0],s=part?.settings||{}
  return `<aside class="soura-score-sidebar" aria-label="Score controls and inspector" tabindex="0">
    <header class="soura-score-sidebar-heading"><strong>Score Inspector</strong><span data-caret-label></span></header>
    <details class="soura-score-section" data-score-section="source" ${(session.sections?.source ?? true) ? 'open' : ''}><summary>Document / Source</summary><div class="soura-score-section-body">
      ${menu('source','Source',[['region','Selected region'],['regions','Selected regions'],['track','Selected track'],['tracks','Chosen tracks'],['full','Full score']],doc.source.mode,'data-document-control')}
    ${menu('part','Staff',parts.map(p=>[p.id,p.name]),part?.id,'data-session')}
    ${menu('layout','Layout',[['continuous','Continuous'],['page','Pages']],doc.layout.type,'data-document-control')}
    <button data-action="source">${parts.some(p=>p.regions.some(r=>r.type==='audio'))?'Edit in Pitch Trace':'Piano Roll'}</button>
    <button data-action="print">Print / PDF</button><button data-action="xml">MusicXML</button>
    </div></details>
    <details class="soura-score-section" data-score-section="selection" ${(session.sections?.selection ?? true) ? 'open' : ''}><summary>Selection</summary><div class="soura-score-section-body">
      <div class="soura-score-inspector" data-score-inspector></div>
    </div></details>
    <details class="soura-score-section" data-score-section="notation" ${(session.sections?.notation ?? true) ? 'open' : ''}><summary>Notation</summary><div class="soura-score-section-body">
      ${menu('mode','Notation',[['standard','Standard'],['grand','Grand staff'],['tab','TAB'],['combined','Standard + TAB']],s.mode)}
    ${menu('clef','Clef',['auto','treble','bass','alto','tenor','percussion'],s.clef)}
    ${menu('quantization','Display grid',['auto','1/4','1/8','1/8T','1/16','1/16T','1/32'],s.quantization)}
    ${menu('zoom','Zoom',[[.5,'50%'],[.75,'75%'],[1,'100%'],[1.25,'125%'],[1.5,'150%'],[2,'200%']],session.zoom,'data-session')}
    ${menu('tool','Tool',[['select','Select / marquee'],['insert','Note entry']],session.tool,'data-session')}
    ${menu('duration','Entry duration',[[4,'Whole'],[2,'Half'],[1,'Quarter'],[.5,'Eighth'],[.25,'Sixteenth'],[1.5,'Dotted quarter'],[1/3,'Triplet eighth']],session.duration,'data-session')}
    </div></details>
    <details class="soura-score-section" data-score-section="editing" ${(session.sections?.editing ?? false) ? 'open' : ''}><summary>Editing</summary><div class="soura-score-section-body">
      <button data-action="undo">Undo</button><button data-action="redo">Redo</button><button data-action="delete">Delete</button>
<button data-action="measure">Select measure</button><button data-action="respell">Respell</button>
    </div></details>
    <details class="soura-score-section" data-score-section="instrument" ${(session.sections?.instrument ?? false) ? 'open' : ''}><summary>Instrument</summary><div class="soura-score-section-body">
      ${field('partName','Instrument name',part?.name)}${field('partAbbreviation','Abbreviation',part?.abbreviation)}<button data-action="part-name">Save names</button>
      ${menu('concertPitch','Pitch view',[[true,'Concert'],[false,'Written']],s.concertPitch)}
      ${menu('instrumentTranspose','Written pitch offset',[[0,'C (0)'],[2,'B♭ trumpet (+2)'],[9,'E♭ alto sax (+9)'],[7,'F horn (+7)'],[14,'B♭ tenor sax (+14)']],s.instrumentTranspose)}
      ${menu('key','Key',['project','C','G','D','A','E','B','F#','F','Bb','Eb','Ab','Db','Gb','Am','Em','Bm','Dm','Gm','Cm'],s.key)}
      <label>Tuning (high string first)<input data-setting="tuning" aria-label="TAB tuning" value="${s.tuning?.join(', ')}"></label>
      ${menu('capo','Capo',Array.from({length:13},(_,i)=>i),s.capo)}
      <label>Maximum fret<input type="number" data-setting="maxFret" aria-label="Maximum fret" value="${s.maxFret}" min="1" max="36"></label>
      <label>Grand staff split<input type="number" data-setting="splitPitch" aria-label="Grand staff split" value="${s.splitPitch}" min="0" max="127"></label>
      <label><input data-setting="showNames" type="checkbox" ${s.showNames?'checked':''}>Note names</label><label><input data-session="follow" type="checkbox" ${session.follow?'checked':''}>Follow playback</label>
    </div></details>
    <details class="soura-score-section" data-score-section="symbols" ${(session.sections?.symbols ?? false) ? 'open' : ''}><summary>Symbols</summary><div class="soura-score-section-body">
      <details class="soura-score-options"><summary>Articulations & ornaments</summary><div>${Object.keys(ARTICULATIONS).map(k=>`<button data-mark="articulations" data-value="${k}">${k}</button>`).join('')}${Object.keys(ORNAMENTS).map(k=>`<button data-mark="ornaments" data-value="${k}">${k}</button>`).join('')}<button data-action="clear-marks">Clear marks</button></div></details>
    <details class="soura-score-options"><summary>Dynamics</summary><div>${DYNAMICS.map(d=>`<button data-dynamic="${d}">${d}</button>`).join('')}<button data-line="crescendo">Crescendo</button><button data-line="diminuendo">Diminuendo</button></div></details>
    <details class="soura-score-options"><summary>Text & chords</summary><div>${menu('symbolType','Marking type',[['chord','Chord symbol'],['rehearsal','Rehearsal mark'],['text','Performance text']],session.symbolType||'chord','data-session')}${field('symbolText','Marking text','')}<button data-action="add-text">Add at caret / selection</button></div></details>
<button data-action="slur">Slur selection</button>
    </div></details>
    <details class="soura-score-section" data-score-section="layout" ${(session.sections?.layout ?? false) ? 'open' : ''}><summary>Layout / Clef changes</summary><div class="soura-score-section-body">
      <button data-break="system">System break before measure</button><button data-break="page">Page break before measure</button><button data-break="remove">Remove break</button>${menu('changeClef','New clef',['treble','bass','alto','tenor','percussion'],session.changeClef||'treble','data-session')}<button data-action="clef-change">Change at measure start</button>
    </div></details>
    <details class="soura-score-section" data-score-section="score" ${(session.sections?.score ?? false) ? 'open' : ''}><summary>Score metadata</summary><div class="soura-score-section-body">
      <div data-score-settings>
      ${['title','subtitle','composer','arranger','lyricist','copyright','movementTitle','movementNumber','notes'].map(k=>field(k,k.replace(/[A-Z]/g,c=>' '+c.toLowerCase()),doc.metadata[k])).join('')}
      ${menu('paper','Paper',['A4','Letter'],doc.layout.paper,'data-layout')}${menu('orientation','Orientation',['portrait','landscape'],doc.layout.orientation,'data-layout')}
      ${field('margin','Page margin',doc.layout.margin,'number','min="16" max="120"')}${field('systemSpacing','System spacing',doc.layout.systemSpacing,'number','min="10" max="200"')}
      <button data-action="metadata">Save score settings</button>
    </div>
    </div></details>
    <details class="soura-score-section" data-score-section="staffs" ${(session.sections?.staffs ?? false) ? 'open' : ''}><summary>Staff visibility / order</summary><div class="soura-score-section-body">
      ${parts.map(p=>`<label><input type="checkbox" data-visible="${esc(p.id)}" ${p.visible?'checked':''}>${esc(p.name)}<button data-order="${esc(p.id)}" data-direction="-1" aria-label="Move ${esc(p.name)} up">↑</button><button data-order="${esc(p.id)}" data-direction="1" aria-label="Move ${esc(p.name)} down">↓</button></label>`).join('')}
      <p>Chosen tracks: select the tracks to include.</p><div data-source-tracks></div>
    </div></details>
  </aside>`
}
