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
