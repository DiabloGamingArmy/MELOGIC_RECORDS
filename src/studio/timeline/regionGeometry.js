import { timelineXForBeat } from './arrangementViewport.js'

const finite = value => value != null && Number.isFinite(Number(value))

// Committed musical endpoints own layout. Seconds/trim/stretch are reconciled
// by edit/load operations, never by a viewport or render operation.
export function getRegionTimelineRange(region = {}) {
  const startBeat = finite(region.startBeat) ? Number(region.startBeat)
    : finite(region.timelineStartBeats) ? Number(region.timelineStartBeats) : 0
  const endBeat = finite(region.endBeat) && Number(region.endBeat) > startBeat
    ? Number(region.endBeat)
    : startBeat + (finite(region.durationBeats) && Number(region.durationBeats) > 0 ? Number(region.durationBeats) : 0.05)
  return { startBeat, endBeat, durationBeats: endBeat - startBeat }
}

export function getTimelineRegionGeometry(region, geometry) {
  const range = getRegionTimelineRange(region)
  const left = timelineXForBeat({ ...geometry, beat: range.startBeat })
  const right = timelineXForBeat({ ...geometry, beat: range.endBeat })
  return { ...range, left, right, width: right - left, revision: geometry.revision }
}

export function getTimelineRegionLaneGeometry({ laneTop, trackHeight }) {
  const inset = Math.max(1, Math.round(trackHeight * 0.01))
  return { top: laneTop + inset, height: Math.max(28, trackHeight - inset * 2) }
}
