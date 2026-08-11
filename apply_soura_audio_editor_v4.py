#!/usr/bin/env python3
from pathlib import Path
import shutil

ROOT=Path.cwd()
PROJECT=ROOT/"src/studioProject.js"
MODEL=ROOT/"src/studio/model/studioProjectModel.js"
DSP=ROOT/"src/studio/audio/dsp/audioDspRenderService.js"

def fail(message):
    raise SystemExit(f"\nERROR: {message}\n")

def backup(path,suffix):
    target=path.with_suffix(path.suffix+suffix)
    if not target.exists():
        shutil.copy2(path,target)
        print("backup:",target)

def ensure_import(text,line):
    if line in text:
        return text
    lines=text.splitlines(True)
    insert_at=-1
    in_import=False
    for i,current in enumerate(lines[:200]):
        s=current.strip()
        if s.startswith("import "):
            in_import=True
        if in_import:
            insert_at=i+1
            if s.endswith("'") or s.endswith('";') or s.endswith("';"):
                in_import=False
    if insert_at<0:
        fail("Could not locate the import block.")
    lines.insert(insert_at,line)
    print("added import:",line.strip())
    return "".join(lines)

def replace_function(text,start_signature,next_signature,replacement,label):
    start=text.find(start_signature)
    end=text.find(next_signature,start+len(start_signature))
    if start<0 or end<0:
        fail(f"Could not safely locate {label}.")
    print("patched:",label)
    return text[:start]+replacement.rstrip()+"\n"+text[end:]

if not PROJECT.exists():
    fail("Run this script from the MELOGIC_RECORDS repository root.")
if not MODEL.exists():
    fail("src/studio/model/studioProjectModel.js is missing.")
if not DSP.exists():
    fail("src/studio/audio/dsp/audioDspRenderService.js is missing.")

project=PROJECT.read_text(encoding="utf-8")
model=MODEL.read_text(encoding="utf-8")
dsp=DSP.read_text(encoding="utf-8")

project=ensure_import(project,"import './studio/audio/PitchTraceViewport.js'\n")
project=ensure_import(project,"import { createSouraRealtimeRegionProcessor, destroySouraRealtimeRegionProcessor, isSouraRealtimeDesktopRuntime, shouldUseRealtimeRegionProcessing } from './studio/audio/SouraRealtimeDsp.js'\n")

render_pitch_trace = r"""function renderPitchTraceView(region, track) {
  const edit=normalizeAudioEdit(region.audioEdit)
  const trace=edit.pitchTrace
  const visibleDuration=Math.max(minAudioRegionSeconds,getAudioRegionVisibleDurationSeconds(region))
  const notes=trace.showLowConfidence?(trace.notes||[]):(trace.notes||[]).filter((note)=>note.confidence>=trace.confidenceThreshold)
  const values=notes.map((note)=>Number(note.editedMidiNote??note.midiNote)).filter(Number.isFinite)
  const minDetected=values.length?Math.min(...values):48
  const maxDetected=values.length?Math.max(...values):72
  const minNote=Math.max(0,Math.floor(Math.min(48,minDetected-5)))
  const maxNote=Math.min(127,Math.ceil(Math.max(72,maxDetected+5)))
  const rowCount=Math.max(1,maxNote-minNote+1)
  const startBeat=Number(region.startBeat)||0
  const endBeat=Math.max(startBeat+.25,Number(region.endBeat)||startBeat+1)
  const lengthBeats=endBeat-startBeat
  const width=Math.max(420,lengthBeats*beatWidth())
  const color=getReadableWaveformColor(region.color||track?.color||'#58d4ff')
  const selected=notes.find((note)=>note.id===pitchTraceSelectedNoteId)||null
  const selectedPitch=selected?Math.round(Number(selected.editedMidiNote??selected.midiNote)||60):null
  const black=new Set([1,3,6,8,10])

  const keyboard=Array.from({length:rowCount},(_,index)=>{
    const midi=maxNote-index
    const pc=((midi%12)+12)%12
    return `<button type="button" tabindex="-1" class="${black.has(pc)?'is-black':'is-white'} ${pc===0?'is-root':''} ${selectedPitch===midi?'is-selected-pitch':''}" aria-label="${esc(formatMidiNoteName(midi))}">${esc(formatMidiNoteName(midi))}</button>`
  }).join('')

  const curvePath=(note)=>{
    const curve=Array.isArray(note.pitchCurve)?note.pitchCurve.filter((point)=>Number.isFinite(Number(point?.relativeSeconds))&&Number.isFinite(Number(point?.cents))):[]
    if(curve.length>=2){
      const duration=Math.max(.001,Number(note.durationSeconds)||.001)
      return curve.map((point,index)=>{
        const x=clamp((Number(point.relativeSeconds)/duration)*100,0,100)
        const y=50-((clamp(Number(point.cents)||0,-100,100)/100)*38)
        return `${index===0?'M':'L'} ${x.toFixed(3)} ${y.toFixed(3)}`
      }).join(' ')
    }
    const a=clamp(Number(note.pitchDriftStartCents)||Number(note.centsOffset)||0,-100,100)
    const b=clamp(Number(note.pitchDriftEndCents)||Number(note.centsOffset)||0,-100,100)
    const vibrato=clamp(Number(note.vibratoAmount)||0,0,1)
    const commands=[]
    for(let i=0;i<24;i+=1){
      const t=i/23
      const cents=clamp(a+((b-a)*t)+(Math.sin(t*Math.PI*7)*vibrato*16),-100,100)
      commands.push(`${i===0?'M':'L'} ${(t*100).toFixed(3)} ${(50-((cents/100)*38)).toFixed(3)}`)
    }
    return commands.join(' ')
  }

  const blocks=notes.map((note)=>{
    const left=clamp((Number(note.startSeconds)||0)/visibleDuration,0,1)*100
    const noteWidth=clamp((Number(note.durationSeconds)||.01)/visibleDuration,.0015,1)*100
    const edited=clamp(Math.round(Number(note.editedMidiNote??note.midiNote)||60),minNote,maxNote)
    const original=clamp(Math.round(Number(note.originalMidiNote)||edited),minNote,maxNote)
    const row=maxNote-edited
    const top=(row/rowCount)*100
    const height=Math.max(1.2,(1/rowCount)*100)
    const cls=[pitchTraceSelectedNoteId===note.id?'is-selected':'',edited!==original||Math.abs(Number(note.editedFineTuneCents)||0)>.001?'is-edited':'',note.muted?'is-muted':'',note.confidence<trace.confidenceThreshold?'is-low-confidence':''].filter(Boolean).join(' ')
    return `<button type="button" class="studio-pitch-trace-note ${cls}" data-pitch-trace-note="${esc(note.id)}" style="left:${left.toFixed(4)}%;width:${noteWidth.toFixed(4)}%;top:${top.toFixed(4)}%;height:${height.toFixed(4)}%;--pitch-note-color:${esc(color)}" title="${esc(formatMidiNoteName(edited))} · ${Math.round((Number(note.confidence)||0)*100)}% confidence · ${Math.round((Number(note.pitchStability)||0)*100)}% stability"><span class="studio-pitch-trace-intended" aria-hidden="true"></span><span class="studio-pitch-trace-note-center" aria-hidden="true"></span><svg class="studio-pitch-trace-note-curve" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path d="${curvePath(note)}"></path></svg><span data-pitch-trace-note-handle="left"></span><b>${esc(formatMidiNoteName(edited))}</b><span data-pitch-trace-note-handle="right"></span></button>`
  }).join('')

  const division=getTimelineDivisionForZoom(beatWidth())
  const step=1/Math.max(1,division)
  const beatsPerBar=Math.max(1,Number(timelineState.beatsPerBar)||4)
  const lines=[]
  const first=Math.floor(startBeat/step)*step
  for(let beat=first;beat<=endBeat+step;beat+=step){
    if(beat<startBeat-1e-6)continue
    const left=((beat-startBeat)/Math.max(.0001,lengthBeats))*100
    const whole=Math.abs(beat-Math.round(beat))<1e-6
    const bar=whole&&Math.abs(Math.round(beat)%beatsPerBar)<1e-6
    lines.push(`<i class="${bar?'is-bar':whole?'is-beat':'is-subdivision'}" style="left:${left.toFixed(4)}%"></i>`)
  }

  const labels=[]
  for(let beat=Math.ceil(startBeat);beat<=endBeat+1e-6;beat+=1){
    const left=((beat-startBeat)/Math.max(.0001,lengthBeats))*100
    const bar=Math.floor(beat/beatsPerBar)+1
    const beatInBar=((Math.round(beat)%beatsPerBar)+beatsPerBar)%beatsPerBar+1
    labels.push(`<span style="left:${left.toFixed(4)}%">${bar}.${beatInBar}</span>`)
  }

  const octaveLines=Array.from({length:rowCount},(_,index)=>{const midi=maxNote-index;return midi%12===0?`<i style="top:${((index/rowCount)*100).toFixed(4)}%"></i>`:''}).join('')
  const status=trace.status==='analyzing'?`Analyzing ${Math.round((trace.progress||0)*100)}%`:trace.status==='ready'?`Ready · ${notes.length} notes`:trace.status==='failed'?`Failed · ${trace.error||'Try again'}`:'Idle'
  const base=getPitchTraceBaseSummary(region,edit)
  const empty=trace.status==='analyzing'?'<p class="studio-pitch-trace-empty">Deep pitch analysis is running…</p>':trace.status==='failed'?`<p class="studio-pitch-trace-empty">${esc(trace.error||'Pitch analysis failed.')}</p>`:'<p class="studio-pitch-trace-empty">Analyze Audio to map detected pitch onto MIDI rows.</p>'

  return `<div class="studio-pitch-trace-view" data-pitch-trace-view data-pitch-trace-region-id="${esc(region.id)}" data-pitch-min="${minNote}" data-pitch-max="${maxNote}" data-pitch-duration="${visibleDuration}" style="--pitch-row-count:${rowCount};--pitch-trace-canvas-width:${width}px"><div class="studio-pitch-trace-scroll" data-pitch-trace-scroll><div class="studio-midi-roll-keys studio-pitch-trace-keyboard">${keyboard}</div><div class="studio-pitch-trace-canvas"><div class="studio-pitch-trace-waveform">${renderAudioWaveform(region,{editor:true,maxPeaks:1600})}</div><div class="studio-pitch-trace-octave-lines">${octaveLines}</div><div class="studio-pitch-trace-grid">${lines.join('')}</div><div class="studio-pitch-trace-time-ruler">${labels.join('')}</div><div class="studio-pitch-trace-notes" data-pitch-trace-grid>${blocks||empty}</div></div></div><footer class="studio-pitch-trace-status"><span>${esc(status)} · ${esc(base.label)}</span><kbd>Horizontal scale follows DAW · Option-scroll changes pitch height</kbd></footer></div>`
}"""

project=replace_function(project,"function renderPitchTraceView(region, track) {","function getPitchTraceEditedNoteCount(trace = {}) {",render_pitch_trace,"renderPitchTraceView")

render_pitch_tools = r"""function renderPitchTraceToolPane(region, missing = false) {
  const edit=normalizeAudioEdit(region.audioEdit)
  const trace=edit.pitchTrace
  const selectedPitchNote=getSelectedPitchTraceNote(region)
  const editedPitchNoteCount=getPitchTraceEditedNoteCount(trace)
  const base=getPitchTraceBaseSummary(region,edit)
  const desktopRealtime=isSouraRealtimeDesktopRuntime()

  return `<aside class="studio-midi-roll-tools studio-pitch-trace-tools-pane" data-pitch-trace-tools-scroll><h3>Pitch Tools</h3><div class="studio-editor-tool-toggle" role="toolbar" aria-label="Pitch Trace tools"><button type="button" data-pitch-trace-tool="cursor" class="${pitchTraceTool==='cursor'?'is-active':''}">Cursor</button><button type="button" data-pitch-trace-tool="pencil" class="${pitchTraceTool==='pencil'?'is-active':''}">Pencil</button></div><div class="studio-pitch-trace-local-zoom"><button type="button" data-pitch-trace-zoom="out">V−</button><button type="button" data-pitch-trace-zoom="fit">V Fit</button><button type="button" data-pitch-trace-zoom="in">V+</button></div><p class="studio-pitch-trace-realtime-note">${desktopRealtime?'<strong>Desktop realtime:</strong> pitch and stretch preview live. High-quality rendering is optional.':'<strong>Web:</strong> complex pitch/stretch playback uses the browser-safe render path when required.'}</p><p class="studio-pitch-trace-base">Editing: <strong>${esc(base.label)}</strong></p>
    <label><input type="checkbox" data-pitch-trace-enabled ${trace.enabled?'checked':''}> Pitch Trace enabled</label>
    <label>Analysis Mode<select data-pitch-trace-mode><option value="vocal" ${trace.analysisMode==='vocal'?'selected':''}>Vocal / Mono</option><option value="instrument" ${trace.analysisMode==='instrument'?'selected':''}>Instrument / Mono</option><option value="full-mix" ${trace.analysisMode==='full-mix'?'selected':''}>Full Mix Best Effort</option></select></label>
    <label>Sensitivity<input type="range" min="0" max="1" step="0.025" data-pitch-trace-sensitivity value="${trace.sensitivity}"><small>${Math.round(trace.sensitivity*100)}%</small></label>
    <label>Minimum Note<input type="range" min="0.025" max="0.2" step="0.005" data-pitch-trace-min-note value="${trace.minNoteSeconds}"><small>${Math.round(trace.minNoteSeconds*1000)} ms</small></label>
    <label>Confidence<input type="range" min="0.2" max="0.95" step="0.025" data-pitch-trace-threshold value="${trace.confidenceThreshold}"><small>${Math.round(trace.confidenceThreshold*100)}%</small></label>
    <label><input type="checkbox" data-pitch-trace-show-low-confidence ${trace.showLowConfidence?'checked':''}> Show low-confidence notes</label>
    <button type="button" data-pitch-trace-analyze ${missing||trace.status==='analyzing'?'disabled':''}>${trace.notes.length?'Deep Re-analyze Audio':'Deep Analyze Audio'}</button>
    <button type="button" data-pitch-trace-clear ${trace.notes.length||trace.status==='failed'?'':'disabled'}>Clear Analysis</button>
    <button type="button" class="${desktopRealtime?'studio-render-hq-button':''}" data-pitch-trace-render ${trace.enabled&&trace.notes.length&&!missing&&trace.renderStatus!=='rendering'?'':'disabled'}>${desktopRealtime?'Render Higher Quality':'Render Pitch Trace'}</button>
    ${selectedPitchNote?`<div class="studio-pitch-trace-note-tools"><strong>${esc(formatMidiNoteName(selectedPitchNote.editedMidiNote))}</strong><span>Original ${esc(formatMidiNoteName(selectedPitchNote.originalMidiNote))} · ${Math.round((Number(selectedPitchNote.confidence)||0)*100)}% confidence · ${Math.round((Number(selectedPitchNote.pitchStability)||0)*100)}% stability</span><label>Start<input type="number" min="0" step="0.01" data-pitch-trace-note-field="startSeconds" value="${Number(selectedPitchNote.startSeconds||0).toFixed(2)}"></label><label>Length<input type="number" min="0.02" step="0.01" data-pitch-trace-note-field="durationSeconds" value="${Number(selectedPitchNote.durationSeconds||.03).toFixed(2)}"></label><label>Edited Note<input type="number" min="0" max="127" step="1" data-pitch-trace-note-field="editedMidiNote" value="${Number(selectedPitchNote.editedMidiNote||60)}"><small>${esc(formatMidiNoteName(selectedPitchNote.editedMidiNote))}</small></label><label>Fine Pitch<input type="number" min="-100" max="100" step="1" data-pitch-trace-note-field="editedFineTuneCents" value="${Number(selectedPitchNote.editedFineTuneCents||0)}"><small>cents</small></label><button type="button" data-pitch-trace-note-reset="${esc(selectedPitchNote.id)}">Reset Note</button><button type="button" data-pitch-trace-note-mute="${esc(selectedPitchNote.id)}">${selectedPitchNote.muted?'Unmute Note':'Mute Note'}</button><button type="button" data-pitch-trace-note-delete="${esc(selectedPitchNote.id)}">Delete Note</button></div>`:'<small>Select or draw a note to edit Pitch Trace data.</small>'}
    <small>Analysis: ${esc(trace.status==='analyzing'?'Analyzing…':trace.status)} · Playback: ${esc(desktopRealtime?'realtime':trace.renderStatus||'idle')}${editedPitchNoteCount?` · ${editedPitchNoteCount} edits`:''}</small></aside>`
}"""

project=replace_function(project,"function renderPitchTraceToolPane(region, missing = false) {","function midiRollPitchRows(region = getMidiRollRegion()) {",render_pitch_tools,"renderPitchTraceToolPane")

needle="      confidenceThreshold: currentEdit.pitchTrace.confidenceThreshold"
if needle in project and "quality: 'deep'" not in project[project.find(needle):project.find(needle)+220]:
    project=project.replace(needle,needle+",\n      quality: 'deep'",1)
    print("patched: deep analyzer request")

realtime_choice = r"""function getAudioPlaybackRenderChoice(region, edit, stretch) {
  const bypassEdits=audioEditPlaybackBypassRegionIds.has(region.id)
  const desktop=isSouraRealtimeDesktopRuntime()
  const trace=edit.pitchTrace||{}
  const pitchShift=edit.pitchShift||{}
  const reverse=edit.reverse||{}
  const pitchActive=Math.abs(Number(pitchShift.totalSemitones)||0)>.001
  const traceEdited=trace.enabled&&Array.isArray(trace.notes)&&getPitchTraceEditedNoteCount(trace)>0
  const stretchRuntimeId=stretch.renderedRuntimeId||`${region.id}:stretch:persisted`
  const combined=stretch.algorithm==='signalsmith_wasm_pitch_time_v1'||stretch.renderedAudio?.operation==='combined_pitch_time'

  if(!bypassEdits&&desktop){
    if(pitchActive&&stretch.enabled&&stretch.renderStatus==='ready'&&combined&&audioClipRuntime.has(stretchRuntimeId))return{runtimeId:stretchRuntimeId,mode:'combinedPitchTime'}
    if(traceEdited&&trace.renderStatus==='ready'&&trace.renderedRuntimeId&&audioClipRuntime.has(trace.renderedRuntimeId))return{runtimeId:trace.renderedRuntimeId,mode:'pitchTrace'}
    if(pitchActive&&!stretch.enabled&&pitchShift.renderStatus==='ready'&&pitchShift.renderedRuntimeId&&audioClipRuntime.has(pitchShift.renderedRuntimeId))return{runtimeId:pitchShift.renderedRuntimeId,mode:'pitchShift'}
    if(stretch.enabled&&stretch.renderStatus==='ready'&&audioClipRuntime.has(stretchRuntimeId))return{runtimeId:stretchRuntimeId,mode:combined?'combinedPitchTime':'stretch'}
    if(reverse.enabled&&reverse.renderStatus==='ready'&&reverse.renderedRuntimeId&&audioClipRuntime.has(reverse.renderedRuntimeId))return{runtimeId:reverse.renderedRuntimeId,mode:'reverse'}
    if(reverse.enabled)return{needsRender:true,promptMode:'reverse',message:'Reverse requires an explicit render. Pitch and stretch do not.'}
    if(shouldUseRealtimeRegionProcessing(edit,stretch))return{runtimeId:region.audioClip?.runtimeId||region.id,mode:'desktopRealtime',realtime:true}
    return{runtimeId:region.audioClip?.runtimeId||region.id,mode:'original'}
  }

  if(!bypassEdits&&pitchActive&&stretch.enabled){
    if(stretch.renderStatus==='ready'&&combined&&audioClipRuntime.has(stretchRuntimeId))return{runtimeId:stretchRuntimeId,mode:'combinedPitchTime'}
    return{needsStretchRender:true,message:'Pitch + Stretch must be rendered before browser playback.'}
  }
  if(!bypassEdits&&traceEdited){
    if(trace.renderStatus==='ready'&&trace.renderedRuntimeId&&audioClipRuntime.has(trace.renderedRuntimeId))return{runtimeId:trace.renderedRuntimeId,mode:'pitchTrace'}
    return{needsRender:true,promptMode:'trace',message:'Pitch Trace edits must be rendered before browser playback.'}
  }
  if(!bypassEdits&&pitchActive){
    if(pitchShift.renderStatus==='ready'&&pitchShift.renderedRuntimeId&&audioClipRuntime.has(pitchShift.renderedRuntimeId))return{runtimeId:pitchShift.renderedRuntimeId,mode:'pitchShift'}
    return{needsRender:true,promptMode:'pitchShift',message:'Pitch Shift must be rendered before browser playback.'}
  }
  if(!bypassEdits&&stretch.enabled){
    if(stretch.renderStatus==='ready'&&audioClipRuntime.has(stretchRuntimeId))return{runtimeId:stretchRuntimeId,mode:combined?'combinedPitchTime':'stretch'}
    return{needsStretchRender:true,message:'This stretched audio region must render before browser playback.'}
  }
  if(!bypassEdits&&reverse.enabled){
    if(reverse.renderStatus==='ready'&&reverse.renderedRuntimeId&&audioClipRuntime.has(reverse.renderedRuntimeId))return{runtimeId:reverse.renderedRuntimeId,mode:'reverse'}
    return{needsRender:true,promptMode:'reverse',message:'Reverse must be rendered before playback.'}
  }
  return{runtimeId:region.audioClip?.runtimeId||region.id,mode:'original'}
}"""

project=replace_function(project,"function getAudioPlaybackRenderChoice(region, edit, stretch) {","function updateAudioClipPlayback(currentBeat = getTransportClockProjectBeat()) {",realtime_choice,"desktop/web playback policy")

helper = r"""const realtimeAudioRegionPending=new Set()

async function scheduleDesktopRealtimeAudioRegion({region,runtime,track,edit,stretch,clipStartSeconds,clipEndSeconds,visibleDurationSeconds}){
  if(!region||!runtime?.audioBuffer||realtimeAudioRegionPending.has(region.id)||activeAudioClipSources.has(region.id))return
  realtimeAudioRegionPending.add(region.id)
  let processor=null
  try{
    const ctx=getAudioContext()
    const current=getTransportClockProjectSeconds()
    if(current>=clipEndSeconds)return
    const elapsed=Math.max(0,current-clipStartSeconds)
    if(elapsed>=visibleDurationSeconds)return
    const source=ctx.createBufferSource()
    source.buffer=runtime.audioBuffer
    const realtime=await createSouraRealtimeRegionProcessor(ctx,{channels:runtime.audioBuffer.numberOfChannels||2,edit,stretch,clipOffsetSeconds:elapsed,quality:'realtime-high'})
    processor=realtime.node
    const refreshed=getTransportClockProjectSeconds()
    const refreshedElapsed=Math.max(0,refreshed-clipStartSeconds)
    if(!isPlaying||refreshed>=clipEndSeconds||activeAudioClipSources.has(region.id)){destroySouraRealtimeRegionProcessor(processor);processor=null;return}
    const offset=Math.min(runtime.audioBuffer.duration-.01,getAudioTrimStartSeconds(region)+refreshedElapsed)
    const remainingVisible=Math.max(.01,visibleDurationSeconds-refreshedElapsed)
    const remainingSource=Math.max(.01,getAudioTrimEndSeconds(region)-offset)
    const sourceDuration=Math.max(.01,Math.min(remainingSource,remainingVisible*Math.max(.05,realtime.rate||1)))
    const channel=getTrackAudioChannel(track?.id||region.trackId)
    const gainNode=ctx.createGain()
    const baseGain=dbToGain(edit.gainDb)
    const nominal=Math.max(ctx.currentTime,getTransportScheduleTimeForProjectSeconds(refreshed))
    const startTime=Math.max(ctx.currentTime,nominal-Math.min(.25,realtime.latencySeconds||0))
    gainNode.gain.setValueAtTime(baseGain,startTime)
    source.connect(processor);processor.connect(gainNode);gainNode.connect(channel.input)
    source.onended=()=>{destroySouraRealtimeRegionProcessor(processor);activeAudioClipSources.delete(region.id)}
    source.start(startTime,Math.max(0,offset),sourceDuration)
    activeAudioClipSources.set(region.id,{source,gainNode,realtimeProcessor:processor,trackId:track?.id||region.trackId,scheduleTime:startTime,clipStartSeconds,clipEndSeconds,realtime:true})
    startTrackMeterLoop()
  }catch(error){
    if(processor)destroySouraRealtimeRegionProcessor(processor)
    console.warn('[soura-realtime] live processing failed',{regionId:region?.id,message:error?.message})
    recordingStatus='Realtime processing could not start. Use Render Higher Quality or retry playback.'
    updateEditorTitleStatus()
  }finally{
    realtimeAudioRegionPending.delete(region.id)
  }
}

"""

marker="function updateAudioClipPlayback(currentBeat = getTransportClockProjectBeat()) {"
if "const realtimeAudioRegionPending=new Set()" not in project:
    idx=project.find(marker)
    if idx<0:fail("Could not insert realtime scheduler.")
    project=project[:idx]+helper+project[idx:]
    print("patched: realtime scheduler")

cleanup_old="  try { active.source?.disconnect?.() } catch {}\n  try { active.gainNode?.disconnect?.() } catch {}"
if cleanup_old in project and "active.realtimeProcessor" not in project[project.find(cleanup_old)-100:project.find(cleanup_old)+300]:
    project=project.replace(cleanup_old,"  try { active.source?.disconnect?.() } catch {}\n  if (active.realtimeProcessor) destroySouraRealtimeRegionProcessor(active.realtimeProcessor)\n  try { active.gainNode?.disconnect?.() } catch {}",1)
    print("patched: realtime cleanup")

runtime_anchor="    const runtime = audioClipRuntime.get(playbackChoice.runtimeId)\n    const shouldPlay = runtime?.audioBuffer && isTrackOutputAudible(track) && lookaheadEndSeconds >= clipStartSeconds && currentProjectSeconds < clipEndSeconds"
if runtime_anchor not in project:
    fail("Could not locate audio runtime scheduling anchor.")
project=project.replace(runtime_anchor,"""    const runtime = audioClipRuntime.get(playbackChoice.runtimeId)

    if (
      playbackChoice.realtime
      && runtime?.audioBuffer
      && isTrackOutputAudible(track)
      && lookaheadEndSeconds >= clipStartSeconds
      && currentProjectSeconds < clipEndSeconds
    ) {
      void scheduleDesktopRealtimeAudioRegion({ region, runtime, track, edit, stretch, clipStartSeconds, clipEndSeconds, visibleDurationSeconds })
      return
    }

    const shouldPlay = runtime?.audioBuffer && isTrackOutputAudible(track) && lookaheadEndSeconds >= clipStartSeconds && currentProjectSeconds < clipEndSeconds""",1)
print("patched: realtime playback branch")

project=project.replace("const gridWidth = Math.max(420, regionLength * midiRollBeatWidth)","const gridWidth = Math.max(420, regionLength * beatWidth())")
project=project.replace("return (Number(beat || 0) - (Number(region?.startBeat) || 0)) * midiRollBeatWidth","return (Number(beat || 0) - (Number(region?.startBeat) || 0)) * beatWidth()")
project=project.replace("return (Number(region?.startBeat) || 0) + (Number(x || 0) / Math.max(1, midiRollBeatWidth))","return (Number(region?.startBeat) || 0) + (Number(x || 0) / Math.max(1, beatWidth()))")
print("patched: region timeline follows DAW zoom")

project=project.replace("${renderRegionEditorToolStrip({ label: 'Audio region editor tools' })}","${pitchTrace.enabled ? '' : renderRegionEditorToolStrip({ label: 'Audio region editor tools' })}")
project=project.replace('class="studio-bottom-panel studio-midi-roll-editor studio-region-editor-audio ${motionClass}"','class="studio-bottom-panel studio-midi-roll-editor studio-region-editor-audio ${pitchTrace.enabled ? \'has-pitch-trace-mode\' : \'\'} ${motionClass}"')

panel_start=project.find("function renderAudioRegionEditorPanel(region, motionClass = '') {")
panel_end=project.find("\nfunction renderRegionEditorTimeline(region, gridWidth) {",panel_start)
if panel_start<0 or panel_end<0:
    fail("Could not locate renderAudioRegionEditorPanel.")
panel=project[panel_start:panel_end]
source="${renderAudioSourceInfo(region)}"
panel=panel.replace(source,"",1)
closing="      </aside>\n    </div>"
if closing not in panel:
    fail("Could not locate the region inspector closing tag.")
panel=panel.replace(closing,"        "+source+"\n"+closing,1)

if "const desktopRealtime = isSouraRealtimeDesktopRuntime()" not in panel:
    anchor="  const pitchShiftActive = Math.abs(Number(pitchShift.totalSemitones) || 0) > 0.001\n"
    panel=panel.replace(anchor,anchor+"  const desktopRealtime = isSouraRealtimeDesktopRuntime()\n",1)

panel=panel.replace(">${pitchShift.renderStatus === 'failed' ? 'Retry Pitch Shift' : 'Render Pitch Shift'}</button>"," class=\"${desktopRealtime ? 'studio-render-hq-button' : ''}\">${desktopRealtime ? 'Render Higher Quality' : (pitchShift.renderStatus === 'failed' ? 'Retry Pitch Shift' : 'Render Pitch Shift')}</button>")
panel=panel.replace(">${stretch.renderStatus === 'failed' ? 'Retry Render' : combinedPitchStretchActive ? 'Render Pitch + Stretch' : 'Render Stretch'}</button>"," class=\"${desktopRealtime ? 'studio-render-hq-button' : ''}\">${desktopRealtime ? 'Render Higher Quality' : (stretch.renderStatus === 'failed' ? 'Retry Render' : combinedPitchStretchActive ? 'Render Pitch + Stretch' : 'Render Stretch')}</button>")
project=project[:panel_start]+panel+project[panel_end:]
print("patched: Source Audio position + HQ labels")


# Fine-pitch-only edits count as Pitch Trace edits.
project=project.replace(
    "return (trace.notes || []).filter((note)=>note.muted === true || note.editedMidiNote !== note.originalMidiNote || Math.abs(Number(note.gainDb) || 0) > 0.001).length",
    "return (trace.notes || []).filter((note)=>note.muted === true || note.editedMidiNote !== note.originalMidiNote || Math.abs(Number(note.editedFineTuneCents) || 0) > 0.001 || Math.abs(Number(note.gainDb) || 0) > 0.001).length"
)

# Reset also clears per-note fine tuning.
project=project.replace(
    "note.editedMidiNote = note.originalMidiNote\\n      note.muted = false",
    "note.editedMidiNote = note.originalMidiNote\\n      note.editedFineTuneCents = 0\\n      note.muted = false"
)

needle="else if (field === 'editedMidiNote') {"
if needle in project and "field === 'editedFineTuneCents'" not in project:
    project=project.replace(needle,"""else if (field === 'editedFineTuneCents') {
      note.editedFineTuneCents = clamp(Number(rawValue) || 0, -100, 100)
      note.renderStatus = 'needs_render'
    }
    else if (field === 'editedMidiNote') {""",1)
    print("patched: note fine pitch field")

model_anchor="        vibratoAmount: clamp(num(note?.vibratoAmount, 0), 0, 1),\n        source: note?.source === 'manual' ? 'manual' : 'analysis',"
model_replacement="""        vibratoAmount: clamp(num(note?.vibratoAmount, 0), 0, 1),
        pitchStability: clamp(num(note?.pitchStability, 0), 0, 1),
        voicedRatio: clamp(num(note?.voicedRatio, 0), 0, 1),
        editedFineTuneCents: clamp(num(note?.editedFineTuneCents, 0), -100, 100),
        analysisMethod: String(note?.analysisMethod || ''),
        pitchCurve: Array.isArray(note?.pitchCurve)
          ? note.pitchCurve.slice(0, 128).map((point)=>({
              timeSeconds: Math.max(0, num(point?.timeSeconds, 0)),
              relativeSeconds: Math.max(0, num(point?.relativeSeconds, 0)),
              frequencyHz: Math.max(0, num(point?.frequencyHz, 0)),
              midi: num(point?.midi, originalMidiNote),
              cents: clamp(num(point?.cents, 0), -2400, 2400),
              confidence: clamp(num(point?.confidence, 0), 0, 1)
            }))
          : [],
        source: note?.source === 'manual' ? 'manual' : 'analysis',"""
if model_anchor in model:
    model=model.replace(model_anchor,model_replacement,1)
    print("patched: model contour persistence")
elif "pitchCurve: Array.isArray(note?.pitchCurve)" not in model:
    fail("Could not locate Pitch Trace note normalization.")

model=model.replace("Math.abs(num(note.gainDb, 0)) > 0.001)","Math.abs(num(note.gainDb, 0)) > 0.001 || Math.abs(num(note.editedFineTuneCents, 0)) > 0.001)")

trace_anchor="    analysisVersion: source.analysisVersion || pitchTraceVersion,\n    analyzedAt:"
if trace_anchor in model and "analysisQuality:" not in model[model.find(trace_anchor):model.find(trace_anchor)+400]:
    model=model.replace(trace_anchor,"    analysisVersion: source.analysisVersion || pitchTraceVersion,\n    analysisQuality: source.analysisQuality || 'deep',\n    analysisFrameSize: source.analysisFrameSize == null ? null : num(source.analysisFrameSize, 0),\n    analysisHopSize: source.analysisHopSize == null ? null : num(source.analysisHopSize, 0),\n    analyzedAt:",1)

completion="            analysisVersion: PITCH_TRACE_VERSION,\n            analyzedAt: Date.now(),"
if completion in project:
    project=project.replace(completion,"            analysisVersion: PITCH_TRACE_VERSION,\n            analysisQuality: message.analysis?.quality || 'deep',\n            analysisFrameSize: message.analysis?.frameSize || null,\n            analysisHopSize: message.analysis?.hopSize || null,\n            analyzedAt: Date.now(),",1)


# High-quality Pitch Trace rendering must honor the per-note fine-pitch value.
dsp_old = """    .map((note) => ({
      ...note,
      delta: (Number(note.editedMidiNote ?? note.midiNote ?? note.originalMidiNote) || 0) - (Number(note.originalMidiNote ?? note.midiNote) || 0)
    }))
    .filter((note) => note.muted === true || Math.abs(Number(note.gainDb) || 0) > 0.001 || Math.abs(note.delta + Number(transposeSemitones || 0) + Number(fineTuneCents || 0) / 100) > 0.001)"""
dsp_new = """    .map((note) => ({
      ...note,
      delta: (Number(note.editedMidiNote ?? note.midiNote ?? note.originalMidiNote) || 0) - (Number(note.originalMidiNote ?? note.midiNote) || 0),
      fineDeltaCents: Number(note.editedFineTuneCents) || 0
    }))
    .filter((note) => note.muted === true || Math.abs(Number(note.gainDb) || 0) > 0.001 || Math.abs(note.delta + Number(transposeSemitones || 0) + (Number(fineTuneCents || 0) + note.fineDeltaCents) / 100) > 0.001)"""
if dsp_old in dsp:
    dsp=dsp.replace(dsp_old,dsp_new,1)
    print("patched: HQ Pitch Trace fine-pitch detection")
elif "fineDeltaCents: Number(note.editedFineTuneCents)" not in dsp:
    fail("Could not locate Pitch Trace DSP note mapping.")

dsp_cents_old = "    const cents = Number(fineTuneCents) || 0"
dsp_cents_new = "    const cents = (Number(fineTuneCents) || 0) + (Number(note.fineDeltaCents) || 0)"
if dsp_cents_old in dsp:
    # Only change the occurrence inside renderPitchTrace, not global pitch shift.
    trace_index=dsp.find("async function renderPitchTrace(options = {})")
    cents_index=dsp.find(dsp_cents_old,trace_index)
    if cents_index < 0:
        fail("Could not find Pitch Trace cents render line.")
    dsp=dsp[:cents_index]+dsp_cents_new+dsp[cents_index+len(dsp_cents_old):]
    print("patched: HQ Pitch Trace per-note fine cents")
elif "note.fineDeltaCents" not in dsp:
    fail("Could not update Pitch Trace fine cents.")

backup(PROJECT,".audio-editor-v4.bak")
backup(MODEL,".audio-editor-v4.bak")
backup(DSP,".audio-editor-v4.bak")
PROJECT.write_text(project,encoding="utf-8")
MODEL.write_text(model,encoding="utf-8")
DSP.write_text(dsp,encoding="utf-8")
print("wrote:",PROJECT)
print("wrote:",MODEL)
print("wrote:",DSP)
print("Next: npm run build && npx tauri dev")
