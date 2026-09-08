import {normalizeScoreDocument,resolveScoreSources} from './scoreDocument.js'
import {collectScoreEvents} from './scoreModel.js'
import {editScoreNotes,insertScoreNote} from './scoreCommands.js'
import {upsertScoreSymbol} from './scoreSymbols.js'

/** The host provides Soura state, history and clipboard; this module owns none. */
export function createScoreHost(api) {
  const all=()=>collectScoreEvents(api.state().regions,{secondsToProjectBeat:api.secondsToProjectBeat,showMuted:true})
  const selected=()=>all().filter(e=>api.selection().includes(e.id)&&e.origin==='midi')
  const regionFor=e=>api.state().regions.find(r=>r.id===e.regionId)
  const mutate=(name,fn)=>api.commit(name,fn)
  const host={
    tracks:()=>api.state().tracks, title:api.title, refresh:api.refresh, selectTrack:api.selectTrack,
    toggleMark:(key,value)=>mutate('score-note-markings',()=>{for(const e of selected()){const values=e.notation[key]||[];editScoreNotes(regionFor(e),[e.index],{notation:{[key]:values.includes(value)?values.filter(v=>v!==value):[...values,value]}})}}),
    region:()=>api.state().regions.find(r=>r.id===api.state().selectedRegionId),
    document:()=>normalizeScoreDocument(api.document()),
    sources:()=>resolveScoreSources({...api.state(),document:api.document()}),
    context:()=>({...api.context(),document:host.document()}),
    secondsToProjectBeat:api.secondsToProjectBeat,playhead:api.playhead,
    selection:api.selection,
    select:(id,additive=false)=>{const next=id==null?[]:additive?(api.selection().includes(id)?api.selection().filter(v=>v!==id):[...api.selection(),id]):[id];api.select(next,all())},
    selectMany:ids=>api.select([...new Set(ids)],all()),
    selectAll:()=>api.select(collectScoreEvents(host.sources().filter(p=>p.visible).flatMap(p=>p.regions),{secondsToProjectBeat:api.secondsToProjectBeat}).filter(e=>e.origin==='midi').map(e=>e.id),all()),
    edit:patch=>mutate('score-edit-notes',()=>{for(const e of selected())editScoreNotes(regionFor(e),[e.index],patch)}),
    move:(deltaBeat,deltaPitch)=>mutate('score-move-notes',()=>{
      const events=selected();if(!events.length)return
      const beat=Math.max(deltaBeat,...events.map(e=>(Number(regionFor(e).startBeat)||0)-e.startBeat))
      const pitch=Math.max(-Math.min(...events.map(e=>e.pitch)),Math.min(deltaPitch,127-Math.max(...events.map(e=>e.pitch))))
      for(const e of events)editScoreNotes(regionFor(e),[e.index],{pitch:e.pitch+pitch,startBeat:e.startBeat+beat})
    }),
    insert:(note,trackId)=>mutate('score-insert-note',()=>{
      const parts=host.sources(),part=parts.find(p=>p.id===trackId)||parts[0]
      const region=part?.regions.find(r=>r.type!=='audio'&&note.startBeat>=r.startBeat&&note.startBeat<r.endBeat)||part?.regions.find(r=>r.type!=='audio')
      if(!region)return
      const id=api.id('note');insertScoreNote(region,note,id);api.select([`${region.id}:${id}`],all())
    }),
    delete:()=>mutate('score-delete-notes',()=>{const events=selected();for(const r of api.state().regions){const indices=new Set(events.filter(e=>e.regionId===r.id).map(e=>e.index));if(indices.size)r.notes=r.notes.filter((_,i)=>!indices.has(i))}api.select([],all())}),
    copy:()=>{const events=selected();if(!events.length)return;const start=Math.min(...events.map(e=>e.startBeat));api.clipboard({type:'midi-notes',earliestStartBeat:start,notes:events.map(e=>({note:structuredClone(regionFor(e).notes[e.index]),relativeStartBeat:e.startBeat-start}))})},
    paste:api.paste,cut:()=>{host.copy();host.delete()},undo:api.undo,redo:api.redo,openSource:api.openSource,
    updateDocument:patch=>mutate('score-document',()=>api.setDocument(normalizeScoreDocument({...api.document(),...patch}))),
    settings:(settings,trackId)=>mutate('score-staff-settings',()=>{const doc=host.document();doc.parts[trackId]={...doc.parts[trackId],settings};api.setDocument(doc)}),
    symbol:symbol=>mutate('score-symbol',()=>{
      const doc=host.document(),events=all()
      if(symbol.type==='slur')for(const anchor of ['startNote','endNote']){
        const e=events.find(e=>e.id===symbol[anchor]);if(!e||e.origin!=='midi')return
        const note=regionFor(e).notes[e.index];note.id??=api.id('note');symbol={...symbol,[anchor]:`${e.regionId}:${note.id}`}
      }
      if(upsertScoreSymbol(doc,symbol,api.id('symbol')))api.setDocument(doc)
    }),
    deleteSymbol:id=>mutate('score-delete-symbol',()=>{const doc=host.document();doc.symbols=doc.symbols.filter(s=>s.id!==id);api.setDocument(doc)}),
  }
  return host
}
