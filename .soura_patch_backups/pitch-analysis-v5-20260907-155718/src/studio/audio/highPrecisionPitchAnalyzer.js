const NOTE_NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const clamp=(v,min,max)=>Math.min(max,Math.max(min,Number(v)||0))
const midiToFrequency=(m)=>440*(2**((m-69)/12))
const frequencyToMidi=(f)=>69+12*Math.log2(Math.max(1e-9,f)/440)
const midiToName=(m)=>{const n=Math.round(m),pc=((n%12)+12)%12,oct=Math.floor(n/12)-1;return `${NOTE_NAMES[pc]}${oct}`}
const median=(values=[])=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return 0;const i=Math.floor(v.length/2);return v.length%2?v[i]:(v[i-1]+v[i])/2}
const percentile=(values,p)=>{const v=values.filter(Number.isFinite).sort((a,b)=>a-b);if(!v.length)return 0;const x=clamp(p,0,1)*(v.length-1),a=Math.floor(x),b=Math.ceil(x);return a===b?v[a]:v[a]+(v[b]-v[a])*(x-a)}

function chooseConfig(sampleRate,mode='vocal',sensitivity=.72,quality='deep'){
  const deep=quality!=='fast'
  const minFrequency=mode==='full-mix'?38:mode==='instrument'?42:55
  const maxFrequency=mode==='full-mix'?1800:mode==='instrument'?2200:1900
  const targetWindow=mode==='full-mix'?(deep?.14:.10):mode==='instrument'?(deep?.12:.09):(deep?.095:.075)
  let frameSize=2048
  const needed=Math.max(sampleRate*targetWindow,(sampleRate/minFrequency)*(deep?3.2:2.5))
  while(frameSize<needed&&frameSize<32768)frameSize*=2
  const hopSeconds=deep?clamp(.009-((sensitivity-.5)*.0035),.005,.011):clamp(.016-((sensitivity-.5)*.006),.009,.021)
  return{
    quality,minFrequency,maxFrequency,frameSize,
    hopSize:Math.max(96,Math.round(sampleRate*hopSeconds)),
    rmsFloor:mode==='full-mix'?.0045:.0032,
    yinThreshold:deep?clamp(.18-sensitivity*.055,.09,.18):clamp(.24-sensitivity*.08,.12,.24),
    fallbackThreshold:deep?clamp(.43-sensitivity*.08,.29,.43):clamp(.58-sensitivity*.12,.38,.58),
    continuityWeight:mode==='full-mix'?.18:.34,
    octavePenalty:mode==='full-mix'?.13:.25,
    curvePointLimit:deep?96:48,
    sampleRate
  }
}

function rms(samples,start,size){
  let sum=0,count=Math.max(1,Math.min(size,samples.length-start))
  for(let i=0;i<count;i++){const v=samples[start+i]||0;sum+=v*v}
  return Math.sqrt(sum/count)
}
function windowFrame(samples,start,size,target){
  const end=Math.min(samples.length,start+size),count=Math.max(1,end-start)
  let mean=0
  for(let i=start;i<end;i++)mean+=samples[i]||0
  mean/=count
  for(let i=0;i<size;i++){
    const s=start+i<samples.length?(samples[start+i]||0)-mean:0
    const w=.5-.5*Math.cos((2*Math.PI*i)/Math.max(1,size-1))
    target[i]=s*w
  }
}
function parabolic(values,index){
  const a=values[index-1]??values[index],b=values[index],c=values[index+1]??values[index]
  const d=a-2*b+c
  return Math.abs(d)<1e-12?index:index+.5*(a-c)/d
}
function nsdf(frame,tau){
  let acf=0,energy=0
  for(let i=0;i<frame.length-tau;i++){const a=frame[i],b=frame[i+tau];acf+=a*b;energy+=a*a+b*b}
  return energy>0?2*acf/energy:0
}
function normalizedCorrelation(frame, tau, stride = 1) {
  let acf = 0
  let energyA = 0
  let energyB = 0

  for (let index = 0; index < frame.length - tau; index += stride) {
    const a = frame[index]
    const b = frame[index + tau]
    acf += a * b
    energyA += a * a
    energyB += b * b
  }

  const denominator = Math.sqrt(energyA * energyB)
  return denominator > 1e-12 ? acf / denominator : 0
}

function detectCandidates(frame, sampleRate, config) {
  const minTau = Math.max(2, Math.floor(sampleRate / config.maxFrequency))
  const maxTau = Math.min(frame.length - 3, Math.ceil(sampleRate / config.minFrequency))

  // Two-stage detector: inexpensive coarse correlation first, then full
  // resolution refinement only around the strongest lag neighborhoods.
  // This keeps deep analysis practical on multi-minute regions.
  const lagStride = config.quality === 'deep' ? 3 : 5
  const sampleStride = config.quality === 'deep' ? 2 : 3
  const coarse = []

  for (let tau = minTau; tau <= maxTau; tau += lagStride) {
    const score = normalizedCorrelation(frame, tau, sampleStride)
    if (score > 0.28) coarse.push({ tau, score })
  }

  coarse.sort((a, b) => b.score - a.score)
  const seeds = coarse.slice(0, config.quality === 'deep' ? 7 : 4)
  const refined = new Map()

  for (const seed of seeds) {
    const from = Math.max(minTau, seed.tau - lagStride - 1)
    const to = Math.min(maxTau, seed.tau + lagStride + 1)

    for (let tau = from; tau <= to; tau += 1) {
      if (refined.has(tau)) continue
      refined.set(tau, normalizedCorrelation(frame, tau, 1))
    }
  }

  const ordered = [...refined.entries()]
    .map(([tau, score]) => ({ tau, score }))
    .sort((a, b) => b.score - a.score)

  const result = []

  for (const item of ordered.slice(0, config.quality === 'deep' ? 8 : 5)) {
    const left = refined.get(item.tau - 1) ?? item.score
    const center = item.score
    const right = refined.get(item.tau + 1) ?? item.score
    const denominator = left - (2 * center) + right
    const offset = Math.abs(denominator) > 1e-12
      ? 0.5 * (left - right) / denominator
      : 0
    const refinedTau = item.tau + clamp(offset, -1, 1)
    const frequencyHz = sampleRate / Math.max(1, refinedTau)

    if (!Number.isFinite(frequencyHz)) continue
    if (frequencyHz < config.minFrequency || frequencyHz > config.maxFrequency) continue

    const midi = frequencyToMidi(frequencyHz)
    const confidence = clamp((center - 0.18) / 0.82, 0, 1)

    // Reject duplicate/harmonic-equivalent candidates that land within a few cents.
    if (result.some((candidate) => Math.abs(candidate.midi - midi) < 0.08)) continue

    result.push({
      frequencyHz,
      midi,
      confidence,
      nsdf: center
    })
  }

  return result
}
function chooseCandidate(candidates,previousMidi,config){
  let best=null,bestScore=-Infinity
  for(const c of candidates){
    const distance=Number.isFinite(previousMidi)?Math.min(24,Math.abs(c.midi-previousMidi)):0
    const continuity=Number.isFinite(previousMidi)?1-distance/24:.5
    const delta=Number.isFinite(previousMidi)?Math.abs(c.midi-previousMidi):0
    const octaveLike=Math.min(Math.abs(delta-12),Math.abs(delta-24))<.75?1:0
    const score=c.confidence+continuity*config.continuityWeight-octaveLike*config.octavePenalty
    if(score>bestScore){bestScore=score;best=c}
  }
  return best
}
function smoothFrames(frames){
  const out=frames.map(f=>({...f}))
  for(let i=0;i<out.length;i++){
    if(!out[i].voiced)continue
    const nearby=out.slice(Math.max(0,i-3),Math.min(out.length,i+4)).filter(f=>f.voiced).map(f=>f.midi)
    if(!nearby.length)continue
    const med=median(nearby)
    if(Math.abs(out[i].midi-med)>.65&&out[i].confidence<.86){out[i].midi=med;out[i].frequencyHz=midiToFrequency(med);out[i].confidence=clamp(out[i].confidence+.05,0,1)}
  }
  for(let i=1;i<out.length-1;i++){
    const a=out[i-1],b=out[i],c=out[i+1]
    if(!a.voiced||!b.voiced||!c.voiced)continue
    const center=(a.midi+c.midi)/2
    if(Math.abs(b.midi-center)>7&&Math.abs(a.midi-c.midi)<1&&b.confidence<Math.max(a.confidence,c.confidence)){
      b.midi=center;b.frequencyHz=midiToFrequency(center);b.confidence=Math.min(b.confidence,.55);b.correctedOctave=true
    }
  }
  return out
}
function fillShortGaps(frames,maxGap=3){
  const out=frames.map(f=>({...f}))
  for(let i=0;i<out.length;i++){
    if(out[i].voiced)continue
    let end=i
    while(end<out.length&&!out[end].voiced)end++
    const gap=end-i,prev=out[i-1],next=out[end]
    if(gap<=maxGap&&prev?.voiced&&next?.voiced&&Math.abs(prev.midi-next.midi)<.85){
      for(let g=0;g<gap;g++){
        const t=(g+1)/(gap+1),m=prev.midi+(next.midi-prev.midi)*t
        out[i+g]={...out[i+g],voiced:true,midi:m,frequencyHz:midiToFrequency(m),confidence:Math.min(prev.confidence,next.confidence)*.72,interpolated:true}
      }
    }
    i=Math.max(i,end-1)
  }
  return out
}
function downsample(points,limit){
  if(points.length<=limit)return points
  const out=[points[0]],step=(points.length-1)/(limit-1)
  for(let i=1;i<limit-1;i++)out.push(points[Math.round(i*step)])
  out.push(points[points.length-1]);return out
}
function curveSummary(noteFrames,noteMidi,limit){
  const voiced=noteFrames.filter(f=>f.voiced)
  if(!voiced.length)return{pitchCurve:[],centsOffset:0,pitchDriftStartCents:0,pitchDriftEndCents:0,vibratoAmount:0,pitchStability:0,voicedRatio:0}
  const first=voiced[0].startSeconds
  const curve=voiced.map(f=>({timeSeconds:+f.startSeconds.toFixed(5),relativeSeconds:+(f.startSeconds-first).toFixed(5),frequencyHz:+f.frequencyHz.toFixed(3),midi:+f.midi.toFixed(5),cents:+((f.midi-noteMidi)*100).toFixed(2),confidence:+f.confidence.toFixed(4)}))
  const cents=curve.map(p=>p.cents),center=median(cents),norm=cents.map(v=>v-center)
  const start=norm.slice(0,Math.max(1,Math.ceil(norm.length*.2))),end=norm.slice(Math.max(0,Math.floor(norm.length*.8)))
  const spread=Math.max(0,percentile(norm,.9)-percentile(norm,.1))
  return{
    pitchCurve:downsample(curve,limit),
    centsOffset:+center.toFixed(2),
    pitchDriftStartCents:+median(start).toFixed(2),
    pitchDriftEndCents:+median(end).toFixed(2),
    vibratoAmount:+clamp(spread/100,0,1).toFixed(4),
    pitchStability:+clamp(1-median(norm.map(v=>Math.abs(v)))/50,0,1).toFixed(4),
    voicedRatio:+(voiced.length/Math.max(1,noteFrames.length)).toFixed(4)
  }
}
function segment(frames,{bpm,regionStartBeat,stretchRatio,confidenceThreshold,minNoteSeconds,mode,config}){
  const notes=[],hopSeconds=config.hopSize/config.sampleRate
  const gapTolerance=hopSeconds*(config.quality==='deep'?3.25:2.6)
  const pitchTolerance=mode==='full-mix'?1.35:mode==='instrument'?.95:.72
  let current=null
  const flush=()=>{
    if(!current)return
    const voiced=current.frames.filter(f=>f.voiced)
    if(!voiced.length){current=null;return}
    const start=voiced[0].startSeconds,end=voiced[voiced.length-1].endSeconds,duration=Math.max(0,end-start)
    const confidence=median(voiced.map(f=>f.confidence)),medianMidi=median(voiced.map(f=>f.midi)),midiNote=clamp(Math.round(medianMidi),0,127)
    if(duration>=minNoteSeconds&&confidence>=confidenceThreshold){
      const summary=curveSummary(current.frames,midiNote,config.curvePointLimit),visibleStart=start*stretchRatio,visibleDuration=duration*stretchRatio
      notes.push({
        id:`pt-${notes.length+1}`,startSeconds:+visibleStart.toFixed(5),durationSeconds:+visibleDuration.toFixed(5),
        startBeat:+(regionStartBeat+visibleStart*bpm/60).toFixed(5),durationBeats:+(visibleDuration*bpm/60).toFixed(5),
        originalMidiNote:midiNote,editedMidiNote:midiNote,midiNote,noteName:midiToName(midiNote),
        originalFrequencyHz:+median(voiced.map(f=>f.frequencyHz)).toFixed(3),editedFrequencyHz:+median(voiced.map(f=>f.frequencyHz)).toFixed(3),frequencyHz:+median(voiced.map(f=>f.frequencyHz)).toFixed(3),
        confidence:+confidence.toFixed(4),centsOffset:summary.centsOffset,pitchDriftStartCents:summary.pitchDriftStartCents,pitchDriftEndCents:summary.pitchDriftEndCents,
        vibratoAmount:summary.vibratoAmount,pitchStability:summary.pitchStability,voicedRatio:summary.voicedRatio,
        pitchCurve:summary.pitchCurve.map(p=>({...p,timeSeconds:+(p.timeSeconds*stretchRatio).toFixed(5),relativeSeconds:+(p.relativeSeconds*stretchRatio).toFixed(5)})),
        editedFineTuneCents:0,gainDb:0,source:'analysis',analysisMethod:'yin+nsdf+continuity-v4',lockedToAnalysis:false,muted:false,renderStatus:'idle'
      })
    }
    current=null
  }
  for(const frame of frames){
    if(!frame.voiced){
      if(current&&frame.startSeconds-current.lastVoicedEnd<=gapTolerance)current.frames.push(frame);else flush()
      continue
    }
    if(!current){current={frames:[frame],midiCenter:frame.midi,lastVoicedEnd:frame.endSeconds};continue}
    const gap=frame.startSeconds-current.lastVoicedEnd,distance=Math.abs(frame.midi-current.midiCenter)
    if(gap>gapTolerance||distance>pitchTolerance){flush();current={frames:[frame],midiCenter:frame.midi,lastVoicedEnd:frame.endSeconds};continue}
    current.frames.push(frame);current.lastVoicedEnd=frame.endSeconds
    current.midiCenter=median(current.frames.filter(f=>f.voiced).slice(-9).map(f=>f.midi))
  }
  flush()
  return notes.slice(0,1024)
}

export function analyzePitchHighPrecision({samples,sampleRate,bpm=140,regionStartBeat=0,stretchRatio=1,analysisMode='vocal',sensitivity=.72,minNoteSeconds=.06,confidenceThreshold=.48,quality='deep',onProgress=null}={}){
  if(!(samples instanceof Float32Array))throw new Error('Pitch analyzer expected Float32Array audio samples.')
  const config=chooseConfig(sampleRate,analysisMode,clamp(sensitivity,0,1),quality),frame=new Float32Array(config.frameSize),frames=[]
  let previousMidi=NaN
  const total=Math.max(1,Math.ceil(Math.max(0,samples.length-config.frameSize)/config.hopSize))
  for(let start=0,index=0;start+config.frameSize<=samples.length;start+=config.hopSize,index++){
    if(index%12===0)onProgress?.(clamp(index/total*.72,0,.72))
    const level=rms(samples,start,config.frameSize)
    if(level<config.rmsFloor){frames.push({voiced:false,startSeconds:start/sampleRate,endSeconds:(start+config.hopSize)/sampleRate,rms:level,confidence:0});continue}
    windowFrame(samples,start,config.frameSize,frame)
    const candidate=chooseCandidate(detectCandidates(frame,sampleRate,config),previousMidi,config)
    if(!candidate||candidate.confidence<Math.max(.26,confidenceThreshold-.22)){frames.push({voiced:false,startSeconds:start/sampleRate,endSeconds:(start+config.hopSize)/sampleRate,rms:level,confidence:candidate?.confidence||0});continue}
    previousMidi=candidate.midi
    frames.push({voiced:true,startSeconds:start/sampleRate,endSeconds:(start+config.hopSize)/sampleRate,frequencyHz:candidate.frequencyHz,midi:candidate.midi,confidence:candidate.confidence,rms:level})
  }
  onProgress?.(.78)
  const smoothed=fillShortGaps(smoothFrames(frames),quality==='deep'?3:2)
  onProgress?.(.86)
  const notes=segment(smoothed,{bpm:Number(bpm)||140,regionStartBeat:Number(regionStartBeat)||0,stretchRatio:Math.max(.05,Number(stretchRatio)||1),confidenceThreshold:clamp(confidenceThreshold,.1,.98),minNoteSeconds:clamp(minNoteSeconds,.025,.35),mode:analysisMode,config})
  onProgress?.(.98)
  const voiced=smoothed.filter(f=>f.voiced).length
  return{notes,frameCount:smoothed.length,voicedFrameCount:voiced,voicedRatio:smoothed.length?voiced/smoothed.length:0,algorithm:`soura-yin-nsdf-continuity-v4:${analysisMode}:${quality}`,analysis:{quality,analysisMode,sampleRate,frameSize:config.frameSize,hopSize:config.hopSize,hopSeconds:config.hopSize/sampleRate,minFrequency:config.minFrequency,maxFrequency:config.maxFrequency,sensitivity,minNoteSeconds,confidenceThreshold,curvePointLimit:config.curvePointLimit}}
}
