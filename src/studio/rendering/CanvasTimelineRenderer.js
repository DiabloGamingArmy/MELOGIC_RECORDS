import { beatsToPixels, getGridLines } from '../model/studioTimelineMath.js'
export class CanvasTimelineRenderer {
  constructor(canvas, options = {}) { this.canvas = canvas; this.ctx = canvas?.getContext?.('2d') || null; this.options = options; this.viewport = { width: canvas?.width || 0, height: canvas?.height || 0, scrollLeft: 0, originX: 0 }; this.timeline = { pixelsPerBeat: 30, beatsPerBar: 4, minBeat: -16, maxBeat: 64, gridBeats: 1 }; this.tracks = []; this.regions = [] }
  setViewport(viewport = {}) { this.viewport = { ...this.viewport, ...viewport } }
  setTimeline(timeline = {}) { this.timeline = { ...this.timeline, ...timeline } }
  setTracks(tracks = []) { this.tracks = Array.isArray(tracks) ? tracks : [] }
  setRegions(regions = []) { this.regions = Array.isArray(regions) ? regions : [] }
  render() { if (!this.ctx || !this.canvas) return; const dpr = globalThis.devicePixelRatio || 1; const width = this.viewport.width || this.canvas.clientWidth || 0; const height = this.viewport.height || this.canvas.clientHeight || 0; this.canvas.width = Math.max(1, Math.floor(width * dpr)); this.canvas.height = Math.max(1, Math.floor(height * dpr)); this.ctx.setTransform(dpr,0,0,dpr,0,0); this.ctx.clearRect(0,0,width,height); const lines = getGridLines(this.timeline); const originScreenX = this.viewport.originX - this.viewport.scrollLeft; this.ctx.fillStyle='rgba(0,0,0,0.08)'; if(originScreenX>0) this.ctx.fillRect(0,0,originScreenX,height); for(const line of lines){ const x = originScreenX + beatsToPixels(line.beat, this.timeline.pixelsPerBeat); if(x<-1||x>width+1) continue; this.ctx.strokeStyle = line.isBar ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.1)'; this.ctx.beginPath(); this.ctx.moveTo(x+0.5,0); this.ctx.lineTo(x+0.5,height); this.ctx.stroke(); if(line.isBar){ this.ctx.fillStyle='rgba(255,255,255,0.55)'; this.ctx.font='11px sans-serif'; this.ctx.fillText(String(Math.round(line.beat / this.timeline.beatsPerBar)), x+4, 12) } } }
  destroy() { this.ctx = null; this.canvas = null; this.tracks = []; this.regions = [] }
}
export default CanvasTimelineRenderer
