#!/usr/bin/env python3
from pathlib import Path
import shutil

p=Path("src/studioProject.js")
if not p.exists(): raise SystemExit("Run from MELOGIC_RECORDS repo root.")
text=p.read_text(encoding="utf-8")
import_line="import './studio/audio/PitchTraceViewport.js'\n"
if import_line not in text:
    # Insert directly before the first top-level non-import constant/function.
    lines=text.splitlines(True)
    last=0
    in_import=False
    for i,line in enumerate(lines[:120]):
        stripped=line.strip()
        if stripped.startswith("import "):
            in_import=True
        if in_import:
            last=i+1
            if stripped.endswith("'") or stripped.endswith('";') or stripped.endswith("';"):
                in_import=False
    lines.insert(last,import_line)
    text=''.join(lines)

start=text.find("function renderPitchTraceView(region, track) {")
end=text.find("\nfunction getPitchTraceEditedNoteCount(trace = {}) {",start)
if start<0 or end<0: raise SystemExit("Could not locate renderPitchTraceView safely.")

new=r'''function renderPitchTraceView(region, track) {
  const edit=normalizeAudioEdit(region.audioEdit)
  const trace=edit.pitchTrace
  const visibleDuration=Math.max(minAudioRegionSeconds,getAudioRegionVisibleDurationSeconds(region))
  const visibleNotes=trace.showLowConfidence?(trace.notes||[]):(trace.notes||[]).filter((note)=>note.confidence>=trace.confidenceThreshold)
  const hiddenNoteCount=Math.max(0,(trace.notes||[]).length-visibleNotes.length)
  const notes=visibleNotes
  const values=notes.map((note)=>Number(note.editedMidiNote??note.midiNote)).filter(Number.isFinite)
  const minNote=Math.max(0,Math.floor(Math.min(48, ...(values.length?values:[48]))-5))
  const maxNote=Math.min(127,Math.ceil(Math.max(72, ...(values.length?values:[72]))+5))
  const rowCount=Math.max(1,maxNote-minNote+1)
  const beatCount=Math.max(1,Math.ceil(secondsToBeats(visibleDuration)))
  const beatsPerBar=Math.max(1,Number(timelineState.beatsPerBar)||4)
  const color=getReadableWaveformColor(region.color||track?.color||'#58d4ff')
  const selectedNote=notes.find((note)=>note.id===pitchTraceSelectedNoteId)||null
  const selectedPitch=selectedNote?Math.round(Number(selectedNote.editedMidiNote??selectedNote.midiNote)||60):null
  const black=new Set([1,3,6,8,10])

  const keyboard=Array.from({length:rowCount},(_,index)=>{
    const midi=maxNote-index
    const pc=((midi%12)+12)%12
    return `<button type="button" tabindex="-1" class="${black.has(pc)?'is-black':'is-white'} ${pc===0?'is-root':''} ${selectedPitch===midi?'is-selected-pitch':''}">${esc(formatMidiNoteName(midi))}</button>`
  }).join('')

  const makeCurve=(note)=>{
    const a=clamp(Number(note.pitchDriftStartCents)||Number(note.centsOffset)||0,-100,100)
    const b=clamp(Number(note.pitchDriftEndCents)||Number(note.centsOffset)||0,-100,100)
    const vib=clamp(Number(note.vibratoAmount)||0,0,1)
    const pts=[]
    for(let i=0;i<24;i+=1){const t=i/23;const cents=clamp(a+((b-a)*t)+(Math.sin(t*Math.PI*7)*vib*16),-100,100);pts.push(`${i===0?'M':'L'} ${(t*100).toFixed(2)} ${(50-((cents/100)*34)).toFixed(2)}`)}
    return pts.join(' ')
  }

  const blocks=notes.map((note)=>{
    const left=clamp((Number(note.startSeconds)||0)/visibleDuration,0,1)*100
    const width=clamp((Number(note.durationSeconds)||.01)/visibleDuration,.0015,1)*100
    const edited=clamp(Math.round(Number(note.editedMidiNote??note.midiNote)||60),minNote,maxNote)
    const original=clamp(Math.round(Number(note.originalMidiNote)||edited),minNote,maxNote)
    const row=maxNote-edited
    const top=(row/rowCount)*100
    const height=Math.max(1.2,(1/rowCount)*100)
    const delta=edited-original
    const cls=[pitchTraceSelectedNoteId===note.id?'is-selected':'',delta?'is-edited':'',note.muted?'is-muted':'',note.confidence<trace.confidenceThreshold?'is-low-confidence':''].filter(Boolean).join(' ')
    return `<button type="button" class="studio-pitch-trace-note ${cls}" data-pitch-trace-note="${esc(note.id)}" style="left:${left.toFixed(4)}%;width:${width.toFixed(4)}%;top:${top.toFixed(4)}%;height:${height.toFixed(4)}%;--pitch-note-color:${esc(color)}"><span class="studio-pitch-trace-intended" aria-hidden="true"></span><span class="studio-pitch-trace-note-center" aria-hidden="true"></span><svg class="studio-pitch-trace-note-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${makeCurve(note)}"></path></svg><span data-pitch-trace-note-handle="left"></span><b>${esc(formatMidiNoteName(edited))}</b><span data-pitch-trace-note-handle="right"></span></button>`
  }).join('')

  const beatLines=Array.from({length:beatCount+1},(_,i)=>`<i class="${i%beatsPerBar===0?'is-bar':'is-beat'}" style="left:${((i/beatCount)*100).toFixed(4)}%"></i>`).join('')
  const labels=Array.from({length:beatCount+1},(_,i)=>`<span style="left:${((i/beatCount)*100).toFixed(4)}%">${i+1}</span>`).join('')
  const octaveLines=Array.from({length:rowCount},(_,i)=>{const midi=maxNote-i;return midi%12===0?`<i style="top:${((i/rowCount)*100).toFixed(4)}%"></i>`:''}).join('')
  const status=trace.status==='analyzing'?`Analyzing ${Math.round((trace.progress||0)*100)}%`:trace.status==='ready'?`Ready · ${notes.length} notes${hiddenNoteCount?` · ${hiddenNoteCount} hidden`:''}`:trace.status==='failed'?`Failed · ${trace.error||'Try again'}`:'Idle'
  const base=getPitchTraceBaseSummary(region,edit)
  const empty=trace.status==='analyzing'?`<p class="studio-pitch-trace-empty">Analyzing audio...</p>`:trace.status==='failed'?`<p class="studio-pitch-trace-empty">${esc(trace.error||'Pitch analysis failed.')}</p>`:`<p class="studio-pitch-trace-empty">Analyze Audio to map detected pitch onto this editor.</p>`

  return `<div class="studio-pitch-trace-view" data-pitch-trace-view data-pitch-trace-region-id="${esc(region.id)}" data-pitch-min="${minNote}" data-pitch-max="${maxNote}" data-pitch-duration="${visibleDuration}" style="--pitch-row-count:${rowCount}">
    <header class="studio-pitch-trace-toolbar"><div class="studio-pitch-trace-toolbar-copy"><strong>Pitch Trace</strong><span>Audio pitch mapped to MIDI notes</span></div><div class="studio-pitch-trace-zoom-controls"><button type="button" data-pitch-trace-zoom="out" data-pitch-trace-axis="x">H−</button><button type="button" data-pitch-trace-zoom="fit" data-pitch-trace-axis="x">H Fit</button><button type="button" data-pitch-trace-zoom="in" data-pitch-trace-axis="x">H+</button><button type="button" data-pitch-trace-zoom="out" data-pitch-trace-axis="y">V−</button><button type="button" data-pitch-trace-zoom="fit" data-pitch-trace-axis="y">V Fit</button><button type="button" data-pitch-trace-zoom="in" data-pitch-trace-axis="y">V+</button></div></header>
    <div class="studio-pitch-trace-scroll" data-pitch-trace-scroll><div class="studio-midi-roll-keys studio-pitch-trace-keyboard">${keyboard}</div><div class="studio-pitch-trace-canvas" data-pitch-trace-grid><div class="studio-pitch-trace-waveform">${renderAudioWaveform(region,{editor:true,maxPeaks:1400})}</div><div class="studio-pitch-trace-octave-lines">${octaveLines}</div><div class="studio-pitch-trace-grid">${beatLines}</div><div class="studio-pitch-trace-time-ruler">${labels}</div><div class="studio-pitch-trace-notes">${blocks||empty}</div></div></div>
    <footer class="studio-pitch-trace-status"><span>Pitch Trace: ${esc(status)} · ${esc(base.label)}</span><kbd>Scroll · Shift-scroll horizontal · ⌘/Ctrl-scroll H zoom · Option-scroll V zoom</kbd></footer>
  </div>`
}'''

backup=p.with_suffix(".js.pitch-midi-editor-v3.bak")
if not backup.exists(): shutil.copy2(p,backup)
p.write_text(text[:start]+new+text[end:],encoding="utf-8")
print("Patched",p)
print("Backup",backup)
