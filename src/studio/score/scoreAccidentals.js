import {keyAlterations,spellPitch} from './scoreTheory.js'
// All voices share one accidental state, ordered by musical time (not draw order).
export function planAccidentals(voices,key) {
  const result=new Map(),state=new Map(),signature=keyAlterations(key)
  const tokens=voices.flatMap(v=>v.tokens).sort((a,b)=>a.startBeat-b.startBeat)
  for(let i=0;i<tokens.length;) {
    const time=tokens[i].startBeat, simultaneous=[]
    while(i<tokens.length&&Math.abs(tokens[i].startBeat-time)<1e-7)simultaneous.push(tokens[i++])
    const changes=new Map()
    for(const token of simultaneous){
      const marks=token.events.map(event=>{
        const p=spellPitch(event.pitch,key,event.notation.spelling), id=`${p.step}${p.octave}`
        const previous=state.has(id)?state.get(id):(signature[p.step]||0)
        if(!changes.has(id))changes.set(id,new Set())
        changes.get(id).add(p.alter)
        return {id,alter:p.alter,show:!event.tieIn&&(previous!==p.alter||event.notation.courtesyAccidental===true)}
      })
      result.set(token,marks)
    }
    for(const token of simultaneous) for(const mark of result.get(token)) if(changes.get(mark.id).size>1)mark.show=true
    for(const [id,alters]of changes)state.set(id,alters.size===1?[...alters][0]:null)
  }
  return result
}
