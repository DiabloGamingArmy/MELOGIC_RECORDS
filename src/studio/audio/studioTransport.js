const safeBpm = (bpm) => (Number.isFinite(Number(bpm)) && Number(bpm) > 0 ? Number(bpm) : 140)
const safeBeatsPerBar = (timelineState) => {
  const beatsPerBar = Number(timelineState?.beatsPerBar)
  return Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? beatsPerBar : 4
}
const safePixelsPerBar = (timelineState) => {
  const pixelsPerBar = Number(timelineState?.pixelsPerBar)
  return Number.isFinite(pixelsPerBar) && pixelsPerBar > 0 ? pixelsPerBar : 120
}
const safeBarZeroX = (timelineState) => {
  const preStartPixels = Number(timelineState?.preStartPixels)
  return Number.isFinite(preStartPixels) && preStartPixels >= 0 ? preStartPixels : 0
}

export function beatsToSeconds(beats, bpm) {
  return Number(beats || 0) * (60 / safeBpm(bpm))
}

export function secondsToBeats(seconds, bpm) {
  return Number(seconds || 0) * (safeBpm(bpm) / 60)
}

export function xToBeatsFromBarZero(x, timelineState) {
  const beatWidth = safePixelsPerBar(timelineState) / safeBeatsPerBar(timelineState)
  return (Number(x || 0) - safeBarZeroX(timelineState)) / beatWidth
}

export function beatsFromBarZeroToX(beats, timelineState) {
  const beatWidth = safePixelsPerBar(timelineState) / safeBeatsPerBar(timelineState)
  return safeBarZeroX(timelineState) + (Number(beats || 0) * beatWidth)
}

export function clampTransportBeats(beats, minBeats, maxBeats) {
  const value = Number(beats || 0)
  const min = Number.isFinite(Number(minBeats)) ? Number(minBeats) : value
  const max = Number.isFinite(Number(maxBeats)) ? Number(maxBeats) : value
  return Math.min(Math.max(value, Math.min(min, max)), Math.max(min, max))
}
