import {DYNAMICS} from './scoreSymbols.js'
import {spellPitch,keyAlterations} from './scoreTheory.js'
const esc=text=>String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]))
const tag=(name,text)=>`<${name}>${esc(text)}</${name}>`
const DIVISIONS=10080,ticks=beats=>Math.round(beats*DIVISIONS)
const types={w:'whole',h:'half',q:'quarter',8:'eighth',16:'16th',32:'32nd',64:'64th'}
const clefXml=(clef,number)=>`<clef number="${number}">${clef==='percussion'?'<sign>percussion</sign>':`<sign>${({treble:'G',bass:'F',alto:'C',tenor:'C'})[clef]||'G'}</sign><line>${({treble:2,bass:4,alto:3,tenor:4})[clef]||2}</line>`}</clef>`
const direction=(body,beat,measure,staff=1,placement='above',sound='')=>`<direction placement="${placement}"><direction-type>${body}</direction-type><offset>${ticks(beat-measure.startBeat)}</offset><staff>${staff}</staff>${sound}</direction>`
export function chordMusicXML(text,offset=0) {
  const match=/^([A-G])([#b]?)(maj7|m7b5|m7|m|7|dim|aug|sus2|sus4)?(?:\/([A-G])([#b]?))?$/.exec(text)
  if(!match)return null
  const [,root,alter,quality='',bass,bassAlter]=match,kinds={'':'major',m:'minor','7':'dominant',maj7:'major-seventh',m7:'minor-seventh',m7b5:'half-diminished',dim:'diminished',aug:'augmented',sus2:'suspended-second',sus4:'suspended-fourth'}
  return `<harmony><root><root-step>${root}</root-step>${alter?tag('root-alter',alter==='#'?1:-1):''}</root><kind text="${esc(quality)}">${kinds[quality]}</kind>${bass?`<bass><bass-step>${bass}</bass-step>${bassAlter?tag('bass-alter',bassAlter==='#'?1:-1):''}</bass>`:''}<offset>${ticks(offset)}</offset></harmony>`
}
export function exportMusicXML(model,document,title='Untitled score') {
  const metadata=document.metadata||{},parts=model.parts||[]
  const identification=['composer','arranger','lyricist'].filter(k=>metadata[k]).map(k=>`<creator type="${k}">${esc(metadata[k])}</creator>`).join('')+(metadata.copyright?tag('rights',metadata.copyright):'')
  let xml=`<?xml version="1.0" encoding="UTF-8"?>\n<score-partwise version="4.0"><work>${tag('work-title',metadata.title||title)}</work>${metadata.movementNumber?tag('movement-number',metadata.movementNumber):''}${metadata.movementTitle?tag('movement-title',metadata.movementTitle):''}<identification>${identification}<encoding><software>Soura Score Editor</software></encoding></identification><part-list>`
  parts.forEach(({part},i)=>{xml+=`<score-part id="P${i+1}">${tag('part-name',part.name)}${tag('part-abbreviation',part.abbreviation)}</score-part>`})
  xml+='</part-list>'
  parts.forEach(({part,model:score},partIndex)=>{
    xml+=`<part id="P${partIndex+1}">`
    score.measures.forEach((measure,measureIndex)=>{
      const staffs=score.staffIds,fifths=Object.values(keyAlterations(measure.key)).reduce((a,b)=>a+b,0),length=measure.endBeat-measure.startBeat
      xml+=`<measure number="${measure.number}"${Math.abs(length-measure.numerator*4/measure.denominator)>1e-6?' implicit="yes"':''}>`
      const manual=document.layout?.breaks?.find(b=>b.measure===measure.index)
      if(manual)xml+=`<print ${manual.type==='page'?'new-page':'new-system'}="yes"/>`
      xml+=`<attributes><divisions>${DIVISIONS}</divisions><key><fifths>${fifths}</fifths><mode>${measure.key.endsWith('m')?'minor':'major'}</mode></key><time><beats>${measure.numerator}</beats><beat-type>${measure.denominator}</beat-type></time><staves>${staffs.length}</staves>${staffs.map((staff,i)=>clefXml(measure.clefs?.[staff]||staff,i+1)).join('')}${!part.settings.concertPitch&&part.settings.instrumentTranspose?`<transpose><chromatic>${-part.settings.instrumentTranspose}</chromatic></transpose>`:''}</attributes>`
      for(const tempo of measure.tempoEvents||[])xml+=direction(`<metronome><beat-unit>quarter</beat-unit><per-minute>${esc(tempo.bpm)}</per-minute></metronome>`,tempo.beat,measure,1,'above',`<sound tempo="${Number(tempo.bpm)}"/>`)
      for(const symbol of measure.symbols||[]) {
        const staff=Math.max(1,staffs.indexOf(symbol.staff)+1),placement=symbol.placement||'above'
        if(symbol.type==='slur')continue
        if(['crescendo','diminuendo'].includes(symbol.type)){
          if(symbol.beat>=measure.startBeat)xml+=direction(`<wedge type="${symbol.type}" number="1"/>`,symbol.beat,measure,staff,'below')
          if(symbol.endBeat<=measure.endBeat)xml+=direction('<wedge type="stop" number="1"/>',symbol.endBeat,measure,staff,'below')
        }else if(symbol.beat>=measure.startBeat){
          if(symbol.type==='chord'){xml+=chordMusicXML(symbol.text,symbol.beat-measure.startBeat)||direction(tag('words',symbol.text),symbol.beat,measure,staff);continue}
          const body=symbol.type==='dynamic'&&DYNAMICS.includes(symbol.text)?`<dynamics><${symbol.text}/></dynamics>`:tag(symbol.type==='rehearsal'?'rehearsal':'words',symbol.text)
          xml+=direction(body,symbol.beat,measure,staff,placement)
        }
      }
      let previousDuration=0,voiceNumber=0
      for(const [staffIndex,staff]of staffs.entries()) for(const voice of measure.staffs[staff]) {
        if(previousDuration)xml+=`<backup><duration>${previousDuration}</duration></backup>`
        previousDuration=0;voiceNumber++
        for(const token of voice.tokens){
          const events=token.events.length?token.events:[null]
          events.forEach((event,index)=>{
            const spelling=event?spellPitch(event.pitch,measure.key,event.notation.spelling):null
            const tieIn=event?.tieIn,tieOut=event?.tieOut,notation=event?.notation||{}
            const percussion=part.settings.clef==='percussion'
            xml+=`<note${event?` dynamics="${Math.round(event.velocity*127/90*100)}"`:''}>${index?'<chord/>':''}${!event?'<rest/>':percussion?`<unpitched><display-step>${spelling.step}</display-step><display-octave>${spelling.octave}</display-octave></unpitched>`:`<pitch><step>${spelling.step}</step>${spelling.alter?tag('alter',spelling.alter):''}<octave>${spelling.octave}</octave></pitch>`}<duration>${ticks(token.beats)}</duration>${tieIn?'<tie type="stop"/>':''}${tieOut?'<tie type="start"/>':''}<voice>${voiceNumber}</voice><type>${types[token.duration]}</type>${'<dot/>'.repeat(token.dots)}${token.triplet?'<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>':''}${notation.notehead&&notation.notehead!=='normal'?tag('notehead',notation.notehead):''}<staff>${staffIndex+1}</staff>`
            let marks=(tieIn?'<tied type="stop"/>':'')+(tieOut?'<tied type="start"/>':'')
            for(const [slurIndex,symbol]of (document.symbols||[]).filter(s=>s.type==='slur'&&s.trackId===part.id).entries())if(!tieIn){if(symbol.startNote===event?.id)marks+=`<slur type="start" number="${slurIndex%6+1}"/>`;if(symbol.endNote===event?.id)marks+=`<slur type="stop" number="${slurIndex%6+1}"/>`}
            if(!tieIn){
              const articulation=(notation.articulations||[]).filter(a=>['accent','marcato','staccato','staccatissimo','tenuto'].includes(a)).map(a=>a==='marcato'?'<strong-accent type="up"/>':`<${a}/>`).join('')
              if(articulation)marks+=`<articulations>${articulation}</articulations>`
              if(notation.articulations?.includes('fermata'))marks+='<fermata/>'
              const ornament=(notation.ornaments||[]).filter(a=>['trill','mordent','turn','inverted-turn'].includes(a)).map(a=>`<${a==='trill'?'trill-mark':a}/>`).join('')
              if(ornament)marks+=`<ornaments>${ornament}</ornaments>`
            }
            const tab=event&&score.tab.get(event.id)
            if(tab&&['tab','combined'].includes(part.settings.mode))marks+=`<technical><string>${tab.string}</string><fret>${tab.fret}</fret></technical>`
            if(marks)xml+=`<notations>${marks}</notations>`
            if(!tieIn)for(const lyric of notation.lyrics||[])xml+=`<lyric number="${Math.max(1,Number(lyric.verse)||1)}"><syllabic>${['single','begin','middle','end'].includes(lyric.syllabic)?lyric.syllabic:'single'}</syllabic><text>${esc(lyric.text)}</text>${lyric.extend?'<extend/>':''}</lyric>`
            xml+='</note>'
          })
          previousDuration+=ticks(token.beats)
        }
      }
      xml+='</measure>'
    })
    xml+='</part>'
  })
  return xml+'</score-partwise>'
}
