import { collectScoreEvents, normalizeRegionScore, normalizeScoreSettings, scoreEligibility } from './scoreModel.js'
import { interpretScore } from './scoreInterpretation.js'

export const SCORE_DOCUMENT_VERSION = 2
export const copyScoreData = value => value == null ? value : JSON.parse(JSON.stringify(value))
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {}
export function normalizeScoreDocument(input = {}) {
  const data = copyScoreData(object(input)), metadata = object(data.metadata), layout = object(data.layout)
  return { ...data, version: Math.max(SCORE_DOCUMENT_VERSION, Number(data.version) || 1),
    metadata: { ...metadata, ...Object.fromEntries(['title','subtitle','composer','arranger','lyricist','copyright','movementTitle','movementNumber','notes'].map(k => [k,String(metadata[k] ?? '')])) },
    source: { mode:'region',trackIds:[],...object(data.source) },
    parts: object(data.parts), symbols: Array.isArray(data.symbols) ? data.symbols : [],
    layout: { type:'continuous',paper:'A4',orientation:'portrait',margin:48,systemSpacing:44,pageSpacing:24,breaks:[],...layout },
  }
}
export function resolveScoreSources({ regions, tracks, selectedRegionId, selectedRegionIds = [], selectedTrackId, document }) {
  const { source, parts } = normalizeScoreDocument(document)
  const chosen = regions.filter(r => {
    if (source.mode === 'region') return r.id === selectedRegionId
    if (source.mode === 'regions') return selectedRegionIds.includes(r.id)
    if (source.mode === 'track') return r.trackId === selectedTrackId && r.type !== 'audio'
    if (source.mode === 'tracks') return source.trackIds.includes(r.trackId) && r.type !== 'audio'
    return r.type !== 'audio'
  })
  if (!chosen.length && source.mode === 'region' && !selectedRegionId) chosen.push(...regions.filter(r=>r.trackId===selectedTrackId&&r.type!=='audio'))
  return tracks.map((track,index) => {
    const own = chosen.filter(r => r.trackId === track.id && scoreEligibility(r).eligible)
    const part = object(parts[track.id])
    return { id:track.id,trackId:track.id,regionIds:own.map(r=>r.id),name:part.name||track.name||'Instrument',abbreviation:part.abbreviation||track.name||'Inst.',
      order: Number.isFinite(part.order)?part.order:index, visible:part.visible!==false,
      settings:normalizeScoreSettings({ ...(own.length===1?own[0].score?.settings:{}), ...part.settings }), regions:own }
  }).filter(p=>p.regions.length).sort((a,b)=>a.order-b.order)
}

/** Immutable interpretation, derived from live regions; each staff has stable identity. */
export function interpretDocument(parts, { document, timeSignatures, keySignatures, tempoEvents, secondsToProjectBeat }) {
  const visible=parts.filter(p=>p.visible)
  const regions=visible.flatMap(p=>p.regions)
  const startBeat=Math.min(0,...regions.map(r=>Number(r.startBeat)||0))
  const endBeat=Math.max(4,...regions.map(r=>Number(r.endBeat)||Number(r.startBeat)+Number(r.durationBeats)||4))
  const models=visible.map(part=>{
    const events=collectScoreEvents(part.regions,{secondsToProjectBeat,showMuted:part.settings.showMuted})
    const symbols=[...part.regions.flatMap(r=>normalizeRegionScore(r.score).symbols.map(s=>({...s,regionId:r.id,trackId:part.id}))),...document.symbols.filter(s=>s.trackId===part.id||!s.trackId)]
    const staffChanges=part.regions.flatMap(r=>normalizeRegionScore(r.score).staffChanges)
    const model=interpretScore(events,{startBeat,endBeat,settings:part.settings,timeSignatures,keySignatures,staffChanges,symbols,tempoEvents})
    return {part,model}
  })
  const definitions=[]
  for (const {part,model} of models) {
    if(part.settings.mode!=='tab') for(const staff of model.staffIds) definitions.push({id:`${part.id}/${staff}`,localId:staff,trackId:part.id,name:part.name,abbreviation:part.abbreviation,clef:staff,settings:part.settings,isTab:false})
    if(['tab','combined'].includes(part.settings.mode)) definitions.push({id:`${part.id}/tab`,localId:model.staffIds[0],trackId:part.id,name:part.name,abbreviation:part.abbreviation,clef:model.staffIds[0],settings:part.settings,isTab:true})
  }
  const measures=(models[0]?.model.measures||[]).map((measure,i)=>{
    const staffs={},staffKeys={},staffClefs={},symbols=[]
    for(const {part,model} of models) for(const def of definitions.filter(d=>d.trackId===part.id)) {
      const m=model.measures[i]
      staffs[def.id]=def.isTab?Object.values(m.staffs).flat():m.staffs[def.localId]
      staffKeys[def.id]=m.key;staffClefs[def.id]=m.clefs?.[def.localId]||def.clef
      if(!def.isTab) symbols.push(...(m.symbols||[]).filter(s=>!s.staff||s.staff===def.localId).map(s=>({...s,staffId:def.id})))
    }
    return {...measure,staffs,staffKeys,staffClefs,symbols,width:Math.max(...models.map(m=>m.model.measures[i].width))}
  })
  const tab=new Map(models.flatMap(({model})=>[...model.tab]))
  const events=models.flatMap(({model})=>model.events)
  return {measures,staffDefinitions:definitions,staffIds:definitions.map(d=>d.id),parts:models,events,tab,quantum:Math.min(...models.map(m=>m.model.quantum),.25),height:definitions.length*180+90,startBeat,endBeat,tempoEvents:tempoEvents||[],document}
}
