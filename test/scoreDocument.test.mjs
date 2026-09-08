import test from 'node:test'
import assert from 'node:assert/strict'
import {normalizeScoreDocument,resolveScoreSources,interpretDocument} from '../src/studio/score/scoreDocument.js'
import {normalizeScoreSettings,normalizeRegionScore,normalizeNoteNotation,collectScoreEvents} from '../src/studio/score/scoreModel.js'
import {interpretScore} from '../src/studio/score/scoreInterpretation.js'
import {spellPitch,buildMeasures,assignVoices,decomposeDuration,transposeKey,staffPositionToPitch,pitchToStaffPosition} from '../src/studio/score/scoreTheory.js'
import {planAccidentals} from '../src/studio/score/scoreAccidentals.js'
import {layoutScore,visibleLayoutCells} from '../src/studio/score/scoreLayout.js'
import {normalizeScoreSymbol} from '../src/studio/score/scoreSymbols.js'
import {exportMusicXML,chordMusicXML} from '../src/studio/score/scoreMusicXML.js'
import {createScoreHost} from '../src/studio/score/scoreHost.js'
const note=(id,pitch,startBeat,durationBeats,notation={})=>({id,note:pitch,startBeat,durationBeats,velocity:.8,notation})
const regions=[{id:'r1',trackId:'t1',type:'midi',startBeat:0,endBeat:12,notes:[note('a',60,0,1),note('b',64,0,1),note('c',67,3,3)]},{id:'r2',trackId:'t2',type:'midi',startBeat:0,endBeat:12,notes:[note('d',48,0,4)]}]
const tracks=[{id:'t1',name:'Piano'},{id:'t2',name:'Cello'}]
function documentModel(patch={},maps={}){const document=normalizeScoreDocument({source:{mode:'full'},...patch}),parts=resolveScoreSources({regions:structuredClone(regions),tracks,document});return interpretDocument(parts,{document,...maps})}
const event=(id,pitch,startBeat,durationBeats,notation={})=>({id,pitch,startBeat,durationBeats,notation})
test('key spelling and clef coordinates are musical rather than chromatic rows',()=>{
  assert.deepEqual(spellPitch(61,'Db'),{step:'D',alter:-1,octave:4})
  assert.deepEqual(spellPitch(66,'D'),{step:'F',alter:1,octave:4})
  assert.deepEqual(spellPitch(60,'C',{step:'B',alter:1}),{step:'B',alter:1,octave:3})
  for(const clef of ['treble','bass','alto','tenor'])for(const pitch of [48,50,52,53,55,57,59,60,62,64,65])assert.equal(staffPositionToPitch(pitchToStaffPosition(pitch,clef),clef),pitch)
})
test('accidentals share chronological state across independent voices and reset each measure',()=>{
  const a={startBeat:0,events:[event('a',61,0,1)]},b={startBeat:1,events:[event('b',61,1,1)]},c={startBeat:2,events:[event('c',60,2,1)]}
  const marks=planAccidentals([{tokens:[b,c]},{tokens:[a]}],'C')
  assert.equal(marks.get(a)[0].show,true);assert.equal(marks.get(b)[0].show,false);assert.equal(marks.get(c)[0].show,true)
  assert.equal(planAccidentals([{tokens:[b]}],'C').get(b)[0].show,true)
})
test('meter map reconstructs measures including a short opening measure',()=>{
  const bars=buildMeasures(12,[{beat:0,numerator:4,denominator:4},{beat:1,numerator:6,denominator:8},{beat:7,numerator:5,denominator:4}])
  assert.deepEqual(bars.map(m=>[m.startBeat,m.endBeat]),[[0,1],[1,4],[4,7],[7,12]])
})
test('voices retain equal-duration chords and split overlapping independent lengths',()=>{
  const v=assignVoices([event('a',60,0,1),event('b',64,0,1),event('c',48,0,4),event('d',70,1,1,{voice:15}),event('e',72,2,1)])
  assert.equal(v.find(e=>e.id==='a').voice,v.find(e=>e.id==='b').voice)
  assert.notEqual(v.find(e=>e.id==='a').voice,v.find(e=>e.id==='c').voice)
  assert.equal(v.find(e=>e.id==='d').voice,15)
})
test('mixed straight/triplet rhythm and double dots preserve source and complete voice duration',()=>{
  const events=[event('a',60,0,1),...Array.from({length:3},(_,i)=>event(`t${i}`,62+i,1+i/3,1/3))]
  const before=structuredClone(events),model=interpretScore(events,{settings:normalizeScoreSettings({mode:'standard'}),endBeat:4})
  const tokens=model.measures[0].staffs.treble[0].tokens
  assert.equal(tokens.filter(t=>t.triplet).length,3)
  assert.ok(Math.abs(tokens.reduce((n,t)=>n+t.beats,0)-4)<1e-8)
  assert.deepEqual(events,before);assert.equal(decomposeDuration(1.75)[0].dots,2)
})
test('ties belong to individual chord events, and cross-bar segmentation retains source identity',()=>{
  const events=[event('long',60,0,6),event('new',64,4,2)]
  const model=interpretScore(events,{settings:normalizeScoreSettings({mode:'standard'}),endBeat:8})
  const tied=model.measures.flatMap(m=>m.staffs.treble.flatMap(v=>v.tokens.flatMap(t=>t.events))).filter(e=>e.id==='long')
  assert.equal(tied[0].tieOut,true);assert.equal(tied.at(-1).tieIn,true)
  const fresh=model.measures[1].staffs.treble.flatMap(v=>v.tokens.flatMap(t=>t.events)).find(e=>e.id==='new')
  assert.equal(fresh.tieIn,false)
})
test('manual staff assignment, clef/key changes and transposition remain display only',()=>{
  const events=[event('a',60,0,1,{staff:'bass'})]
  const model=interpretScore(events,{settings:normalizeScoreSettings({mode:'grand',concertPitch:false,instrumentTranspose:2}),endBeat:8,staffChanges:[{beat:4,staff:'bass',clef:'tenor'}],keySignatures:[{beat:0,root:'C',scale:'major'},{beat:4,root:'F',scale:'major'}]})
  assert.equal(model.measures[0].key,'D');assert.equal(model.measures[1].key,'G');assert.equal(model.measures[1].clefs.bass,'tenor')
  assert.equal(model.measures[0].staffs.bass[0].tokens[0].events[0].pitch,62);assert.equal(events[0].pitch,60)
  assert.equal(transposeKey('Cm',2),'Dm')
})
test('source collection scopes regions and tracks without copying authoritative notes into document metadata',()=>{
  for(const [mode,expected]of [['region',1],['regions',2],['track',1],['tracks',1],['full',2]]){
    const document=normalizeScoreDocument({source:{mode,trackIds:['t2']}})
    const parts=resolveScoreSources({regions,tracks,document,selectedRegionId:'r1',selectedRegionIds:['r1','r2'],selectedTrackId:'t1'})
    assert.equal(parts.length,expected);assert.equal(parts[0].regions[0],regions[mode==='tracks'?1:0])
    assert.equal('notes' in document,false)
  }
})
test('schema V1 migration and future extensions survive lossless roundtrip',()=>{
  const old=normalizeRegionScore({version:1,settings:{zoom:1,customStyle:{value:'x'}},symbols:[{type:'future-symbol',data:12}],extension:{a:1}})
  assert.equal(old.version,2);assert.deepEqual(old.extension,{a:1});assert.equal(old.settings.customStyle.value,'x')
  const future=normalizeRegionScore({...old,version:99});assert.equal(future.version,99);assert.deepEqual(normalizeRegionScore(JSON.parse(JSON.stringify(future))),future)
  assert.equal(normalizeNoteNotation({future:{n:1},voice:2}).future.n,1)
  assert.equal(normalizeScoreDocument({version:99,metadata:{custom:'x'},future:1}).metadata.custom,'x')
})
test('malformed legacy notes do not crash collection or poison pitch/timing',()=>{
  const found=collectScoreEvents([{id:'r',type:'midi',notes:[null,{},note('a',60,0,1),{note:'bad',startBeat:1,durationBeats:1}]}])
  assert.equal(found.length,1);assert.equal(found[0].pitch,60)
})
test('page layout has real systems, manual page breaks and bounded visible cells',()=>{
  const model=documentModel(),layout=layoutScore(model,{type:'page',breaks:[{measure:1,type:'page'}]})
  assert.ok(layout.pages.length>=2);assert.equal(layout.cells[1].page,1)
  for(const cell of layout.cells){const page=layout.pages[cell.page];assert.ok(cell.x+cell.width*cell.scale<=page.width);assert.ok(cell.y+cell.height*cell.scale<=page.y+page.height)}
  const large={...model,measures:Array.from({length:500},(_,i)=>({...model.measures[0],index:i,width:350}))},continuous=layoutScore(large)
  assert.ok(visibleLayoutCells(continuous,{left:50000,top:0,width:1000,height:600}).length<8)
})
test('slurs are explicit symbols, independent of ties and MIDI timing',()=>{
  assert.equal(normalizeScoreSymbol({type:'slur',beat:0,startNote:'r:a',endNote:'r:b',endBeat:2},'slur').type,'slur')
  assert.equal(normalizeScoreSymbol({type:'slur',beat:0},'invalid'),null)
})
test('MusicXML exports written pitches, voices, ties, marks, lyrics, tempo and safe chord symbols',()=>{
  const model=documentModel({metadata:{title:'A & B'},symbols:[{id:'s',type:'dynamic',trackId:'t1',beat:0,text:'mf'},{id:'sl',type:'slur',trackId:'t1',beat:0,endBeat:3,startNote:'r1:a',endNote:'r1:c'}]},{tempoEvents:[{beat:0,bpm:120}]})
  const xml=exportMusicXML(model,model.document)
  for(const content of ['A &amp; B','<part id="P2">','<backup>','<tie type="start"/>','<tied type="stop"/>','<slur type="start"','<dynamics><mf/>','<sound tempo="120"'])assert.ok(xml.includes(content),content)
  assert.ok(chordMusicXML('C#m7b5').includes('half-diminished'));assert.ok(chordMusicXML('Bb/F').includes('<bass-step>F'))
  assert.equal(chordMusicXML('<script>'),null)
})
test('shared host edits multiple regions in one history transaction and keeps audio read-only',()=>{
  const state={regions:structuredClone(regions),tracks,selectedRegionId:'r1',selectedRegionIds:['r1','r2'],selectedTrackId:'t1'}
  let selection=['r1:a','r2:d'],commits=0,doc=normalizeScoreDocument({source:{mode:'full'}})
  const host=createScoreHost({state:()=>state,selection:()=>selection,select:ids=>selection=ids,document:()=>doc,setDocument:d=>doc=d,context:()=>({}),commit:(name,fn)=>{commits++;fn()},id:()=> 'new'})
  host.move(1,2);assert.equal(commits,1);assert.equal(state.regions[0].notes[0].note,62);assert.equal(state.regions[1].notes[0].note,50)
  host.toggleMark('articulations','accent');assert.equal(commits,2);assert.deepEqual(state.regions[0].notes[0].notation.articulations,['accent'])
  const before=structuredClone(state.regions);host.symbol({type:'dynamic',trackId:'t1',beat:0,text:'pp'});assert.deepEqual(state.regions,before)
})

// System-start/signature regression contract shared by screen and print rendering.
import {signatureDisplay} from '../src/studio/score/scoreSignatures.js'
const trebleStaff={id:'t/treble',clef:'treble',isTab:false}
const signatureMeasure=(index,key='G',clef='treble',numerator=4,denominator=4)=>({index,width:240,numerator,denominator,key,staffKeys:{'t/treble':key},staffClefs:{'t/treble':clef}})
test('ordinary measures do not repeat clef, key or time; first score measure does',()=>{
  const first=signatureMeasure(0),second=signatureMeasure(1)
  const initial=signatureDisplay(first,null,trebleStaff,true),ordinary=signatureDisplay(second,first,trebleStaff,false)
  assert.deepEqual([initial.showClef,initial.showKey,initial.showTime],[true,true,true])
  assert.deepEqual([ordinary.showClef,ordinary.showKey,ordinary.showTime],[false,false,false])
})
test('new systems restore clef and key while unchanged meter is not repeated',()=>{
  const result=signatureDisplay(signatureMeasure(2),signatureMeasure(1),trebleStaff,true)
  assert.deepEqual([result.showClef,result.showKey,result.showTime],[true,true,false])
})
test('mid-system clef, key and time changes print independently; key cancellation uses previous key',()=>{
  const before=signatureMeasure(0)
  const clef=signatureDisplay(signatureMeasure(1,'G','bass'),before,trebleStaff,false)
  assert.deepEqual([clef.showClef,clef.showKey,clef.showTime,clef.smallClef],[true,false,false,true])
  const key=signatureDisplay(signatureMeasure(1,'C'),before,trebleStaff,false)
  assert.deepEqual([key.showClef,key.showKey,key.showTime,key.cancelKey],[false,true,false,'G'])
  const meter=signatureDisplay(signatureMeasure(1,'G','treble',6,8),before,trebleStaff,false)
  assert.deepEqual([meter.showClef,meter.showKey,meter.showTime],[false,false,true])
  assert.equal(signatureDisplay(signatureMeasure(1,'Em'),before,trebleStaff,false).showKey,false)
})
test('system starts come from continuous/page layout, including manual breaks and cropped scores',()=>{
  const model={height:250,measures:Array.from({length:6},(_,i)=>signatureMeasure(i+20))}
  const continuous=layoutScore(model)
  assert.deepEqual(continuous.cells.map(c=>c.isSystemStart),[true,false,false,false,false,false])
  assert.equal(continuous.cells[0].previousMeasure,null)
  const pages=layoutScore(model,{type:'page',breaks:[{measure:22,type:'system'},{measure:24,type:'page'}]})
  for(let i=0;i<pages.cells.length;i++){
    const cell=pages.cells[i]
    assert.equal(cell.isSystemStart,i===0||cell.system!==pages.cells[i-1].system)
    assert.equal(cell.previousMeasure,i===0?null:model.measures[i-1])
  }
  assert.equal(pages.cells.find(c=>c.measure.index===22).isSystemStart,true)
  assert.equal(pages.cells.find(c=>c.measure.index===24).isSystemStart,true)
})
test('grand staff and different instruments evaluate their own clef/key state at a shared system boundary',()=>{
  const before={...signatureMeasure(0),staffClefs:{a:'treble',b:'bass'},staffKeys:{a:'G',b:'Bb'}}
  const after={...before,index:1,staffKeys:{a:'G',b:'F'}}
  assert.equal(signatureDisplay(after,before,{id:'a',clef:'treble'},false).showKey,false)
  assert.equal(signatureDisplay(after,before,{id:'b',clef:'bass'},false).cancelKey,'Bb')
  for(const id of ['a','b'])assert.equal(signatureDisplay(after,before,{id,clef:before.staffClefs[id]},true).showClef,true)
})
test('TAB keeps system-start TAB clefs without pitched signatures; percussion retains meter',()=>{
  const first=signatureMeasure(0),next=signatureMeasure(1)
  const tab={id:'tab',clef:'treble',isTab:true}
  assert.deepEqual([signatureDisplay(first,null,tab,true).showClef,signatureDisplay(first,null,tab,true).showKey,signatureDisplay(first,null,tab,true).showTime],[true,false,false])
  assert.equal(signatureDisplay(next,first,tab,false).showClef,false)
  const percussion={id:'drums',clef:'percussion'}
  assert.equal(signatureDisplay(first,null,percussion,true).showKey,false)
  assert.equal(signatureDisplay(first,null,percussion,true).showTime,true)
})
