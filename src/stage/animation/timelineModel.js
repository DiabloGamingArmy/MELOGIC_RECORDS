export const TIMELINE_ZOOM_MIN = 0.5
export const TIMELINE_ZOOM_MAX = 4
export const TIMELINE_BASE_PIXELS_PER_FRAME = 8

export function clampTimelineZoom(value) {
  return Math.max(TIMELINE_ZOOM_MIN, Math.min(TIMELINE_ZOOM_MAX, Number(value) || 1))
}

export function timelinePixelsPerFrame(zoom = 1) {
  return TIMELINE_BASE_PIXELS_PER_FRAME * clampTimelineZoom(zoom)
}

export function timelineFrameAtOffset(offset, { startFrame = 1, endFrame = 250, zoom = 1 } = {}) {
  const frame = Number(startFrame) + Math.round(Number(offset || 0) / timelinePixelsPerFrame(zoom))
  return Math.max(Number(startFrame), Math.min(Number(endFrame), frame))
}

export function timelineFrameFromPointer({ clientX, canvasLeft, scrollLeft = 0, trackWidth = 210, animation, zoom = 1 } = {}) {
  return timelineFrameAtOffset(Number(clientX) - Number(canvasLeft) + Number(scrollLeft) - Number(trackWidth), { ...animation, zoom })
}

export function timelineRulerStep({ startFrame = 1, endFrame = 250, zoom = 1 } = {}) {
  const pixelsPerFrame = timelinePixelsPerFrame(zoom)
  const candidates = [1, 2, 5, 10, 25, 50, 100, 250, 500]
  const target = candidates.find((step) => step * pixelsPerFrame >= 54) || candidates.at(-1)
  const span = Math.max(1, Number(endFrame) - Number(startFrame))
  return Math.min(target, span)
}

export function timelineGridStep({ startFrame = 1, endFrame = 250, zoom = 1, gridInterval = 5 } = {}) {
  // Grid subdivision is a user preference; ruler labels adapt independently
  // so changing zoom never silently changes the visual snap/grid cadence.
  return Math.max(1, Math.round(Number(gridInterval) || 1))
}

export function snapTimelineFrame(frame, { startFrame = 1, endFrame = 250, enabled = true, interval = 1 } = {}) {
  const bounded = Math.max(Number(startFrame), Math.min(Number(endFrame), Math.round(Number(frame) || 0)))
  if (!enabled) return bounded
  const step = Math.max(1, Math.round(Number(interval) || 1))
  return Math.max(Number(startFrame), Math.min(Number(endFrame), Number(startFrame) + Math.round((bounded - Number(startFrame)) / step) * step))
}

export function timelineTimeLabel(frame, frameRate = 30) {
  const seconds = Math.max(0, (Number(frame) || 0) / (Number(frameRate) || 30))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const wholeSeconds = Math.floor(seconds % 60)
  const milliseconds = Math.round((seconds - Math.floor(seconds)) * 1000)
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(wholeSeconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
}

export function normalizeTimelineLoopRange(range = {}, animationInput = {}) {
  const projectStart = Number(animationInput.startFrame || 0)
  const projectEnd = Math.max(projectStart, Number(animationInput.endFrame || projectStart))
  const startFrame = Math.max(projectStart, Math.min(projectEnd, Math.round(Number(range.startFrame ?? projectStart) || projectStart)))
  const endFrame = Math.max(startFrame, Math.min(projectEnd, Math.round(Number(range.endFrame ?? projectEnd) || projectEnd)))
  return Object.freeze({ startFrame, endFrame })
}

export function loopedTimelineFrame(frame, range = {}, animationInput = {}) {
  const normalized = normalizeTimelineLoopRange(range, animationInput)
  const span = Math.max(1, normalized.endFrame - normalized.startFrame + 1)
  if (frame <= normalized.endFrame) return Math.max(normalized.startFrame, frame)
  return normalized.startFrame + ((frame - normalized.startFrame) % span)
}

const propertyLabel = (path = '') => {
  const [, group = '', axis = ''] = String(path).match(/^transform\.(position|rotation|scale)\.(x|y|z)$/) || []
  if (!group) return path
  return `${group[0].toUpperCase()}${group.slice(1)} ${axis.toUpperCase()}`
}

export function buildTimelineTrackHierarchy(animation = {}, objects = [], expandedObjectIds = {}) {
  const objectById = new Map((objects || []).map((object) => [String(object?.id || object?.key || ''), object]))
  const grouped = new Map()
  ;(animation.tracks || []).forEach((track) => {
    const rows = grouped.get(track.targetObjectId) || []
    rows.push({ ...track, label: propertyLabel(track.propertyPath) })
    grouped.set(track.targetObjectId, rows)
  })
  return [...grouped.entries()].map(([objectId, tracks]) => ({
    objectId,
    label: objectById.get(objectId)?.label || objectById.get(objectId)?.name || objectId,
    expanded: expandedObjectIds[objectId] !== false,
    tracks: tracks.sort((left, right) => left.propertyPath.localeCompare(right.propertyPath))
  }))
}
