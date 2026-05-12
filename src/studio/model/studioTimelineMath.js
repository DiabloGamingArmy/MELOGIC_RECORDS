const safe = (n, d = 0) => (Number.isFinite(Number(n)) ? Number(n) : d)
export function beatWidth(pixelsPerBeat) { return Math.max(0.0001, safe(pixelsPerBeat, 30)) }
export function beatsToPixels(beats, pixelsPerBeat) { return safe(beats, 0) * beatWidth(pixelsPerBeat) }
export function pixelsToBeats(pixels, pixelsPerBeat) { return safe(pixels, 0) / beatWidth(pixelsPerBeat) }
export function snapBeat(beat, gridBeats) { const grid = Math.max(0.0001, safe(gridBeats, 1)); return Math.round(safe(beat,0)/grid)*grid }
export function clampBeat(beat, minBeat, maxBeat) { const v=safe(beat,0), min=safe(minBeat,v), max=safe(maxBeat,v); return Math.min(Math.max(v, Math.min(min,max)), Math.max(min,max)) }
export function barBeatToBeat(bar, beat, beatsPerBar) { const bpb=Math.max(1,safe(beatsPerBar,4)); return safe(bar,0)*bpb + safe(beat,0) }
export function beatToBarBeat(totalBeat, beatsPerBar) { const bpb=Math.max(1,safe(beatsPerBar,4)); const tb=safe(totalBeat,0); const bar=Math.floor(tb/bpb); return { bar, beat: tb - (bar*bpb) } }
export function getVisibleBeatRange({ scrollLeft, viewportWidth, pixelsPerBeat, originX }) { const left=safe(scrollLeft,0)-safe(originX,0); const right=left+Math.max(0,safe(viewportWidth,0)); return { minBeat:pixelsToBeats(left,pixelsPerBeat), maxBeat:pixelsToBeats(right,pixelsPerBeat) } }
export function getGridLines({ minBeat, maxBeat, beatsPerBar, gridBeats }) { const start=safe(minBeat,0), end=safe(maxBeat,0), step=Math.max(0.0001,safe(gridBeats,1)), bpb=Math.max(1,safe(beatsPerBar,4)); const from=Math.floor(Math.min(start,end)/step)*step, to=Math.max(start,end); const lines=[]; for(let beat=from; beat<=to+step*0.5; beat+=step){ const isBar=Math.abs((beat/bpb)-Math.round(beat/bpb))<1e-6; lines.push({beat,isBar}) } return lines }
