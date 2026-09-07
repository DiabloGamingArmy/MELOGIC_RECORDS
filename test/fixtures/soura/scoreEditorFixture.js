export function createScoreFixture(trackId) {
  return [
    { id:'score-midi',name:'Score study',type:'midi',trackId,startBeat:0,endBeat:24,notes:[
      ...[60,64,67].map((note,i)=>({id:`chord-${i}`,note,startBeat:0,durationBeats:1,velocity:.8})),
      {id:'bass',note:48,startBeat:0,durationBeats:4,velocity:.7},
      ...[62,63,65,67].map((note,i)=>({id:`eighth-${i}`,note,startBeat:1+i*.5,durationBeats:.5,velocity:.8})),
      {id:'tie',note:69,startBeat:3,durationBeats:3,velocity:.8},
      ...[60,62,64].map((note,i)=>({id:`triplet-${i}`,note,startBeat:8+i/3,durationBeats:1/3,velocity:.8})),
      {id:'ledger',note:84,startBeat:12,durationBeats:1.5,velocity:.7},
      {id:'low',note:28,startBeat:14,durationBeats:.25,velocity:.7}
    ] },
    {id:'score-raw',type:'audio',name:'Raw audio',trackId,startBeat:28,endBeat:36,durationBeats:8,fileDurationSeconds:4,trimStartSeconds:0,trimEndSeconds:4},
    {id:'score-analysis',type:'audio',name:'Analyzed audio',trackId,startBeat:40,endBeat:48,durationBeats:8,fileDurationSeconds:4,trimStartSeconds:0,trimEndSeconds:4,audioEdit:{pitchTrace:{enabled:true,status:'ready',notes:[{id:'analyzed',midiNote:62,editedMidiNote:62,startSeconds:.5,durationSeconds:.5,confidence:.5}]}}}
  ]
}
export function mountScoreFixture(host) {
  const panel=document.createElement('div')
  panel.style.cssText='position:fixed;top:0;right:0;z-index:10000;background:#fff;color:#000;font:11px monospace;padding:4px'
  for (const [label,action] of [ ['MIDI',()=>host.select('score-midi')],['Raw audio',()=>host.select('score-raw')],['Analysis',()=>host.select('score-analysis')],['Save/reload',()=>host.roundtrip()],['Dense',()=>host.dense()] ]) {
    const b=document.createElement('button');b.textContent=label;b.onclick=()=>{action();refresh()};panel.append(b)
  }
  const output=document.createElement('output');output.hidden=true;output.dataset.scoreFixtureState='';panel.append(output)
  function refresh(){output.textContent=JSON.stringify(host.state())}
  document.body.append(panel);refresh();setInterval(refresh,300)
}
