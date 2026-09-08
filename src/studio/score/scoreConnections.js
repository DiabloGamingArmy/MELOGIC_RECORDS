// Phrase slurs and inferred ties use one static overlay across measure SVGs.
// A system break intentionally creates matching continuation curves at its edges.
export function drawScoreConnections(svg,cells,layout,symbols=[]) {
  svg.replaceChildren()
  const ns='http://www.w3.org/2000/svg',anchors=[]
  for(const cell of cells.values())for(const hit of cell.hits)if(!hit.isTab)anchors.push({...hit,x:cell.layout.x+hit.x*cell.layout.scale,y:cell.layout.y+hit.y*cell.layout.scale,system:cell.layout.system})
  const curve=(a,b,id,below=false)=>{
    const path=svg.ownerDocument.createElementNS(ns,'path'),direction=below?1:-1,offset=direction*12
    path.setAttribute('d',`M${a.x+5} ${a.y+offset} C${a.x+(b.x-a.x)*.25} ${a.y+offset+direction*18},${b.x-(b.x-a.x)*.25} ${b.y+offset+direction*18},${b.x-5} ${b.y+offset}`)
    path.setAttribute('fill','none');path.setAttribute('stroke','#202633');path.setAttribute('stroke-width','1.4')
    if(id){path.dataset.scoreSymbol=id;path.classList.add('soura-score-symbol');path.setAttribute('role','button');path.setAttribute('aria-label','Phrase slur')}
    svg.append(path)
  }
  const connect=(a,b,id,below)=>{
    if(a.system===b.system)curve(a,b,id,below)
    else {
      const from=layout.systems[a.system],to=layout.systems[b.system]
      curve(a,{x:from.x+from.width-8,y:a.y},id,below)
      curve({x:to.x+90,y:b.y},b,id,below)
    }
  }
  for(const a of anchors)if(a.event.tieOut){
    const b=anchors.find(b=>b.event.id===a.event.id&&b.staffId===a.staffId&&Math.abs(b.tokenStart-a.tokenEnd)<1e-6)
    if(b)connect(a,b,null,true)
    else{const system=layout.systems[a.system];curve(a,{x:Math.min(system.x+system.width-8,a.x+60),y:a.y},null,true)}
  }
  for(const b of anchors)if(b.event.tieIn&&!anchors.some(a=>a.event.id===b.event.id&&a.staffId===b.staffId&&Math.abs(a.tokenEnd-b.tokenStart)<1e-6))curve({x:Math.max(layout.systems[b.system].x+90,b.x-60),y:b.y},b,null,true)
  for(const symbol of symbols.filter(s=>s.type==='slur')) {
    const a=anchors.find(h=>h.event.id===symbol.startNote&&!h.event.tieIn),b=anchors.find(h=>h.event.id===symbol.endNote&&!h.event.tieIn)
    if(a&&b)connect(a,b,symbol.id,symbol.placement==='below')
  }
}
