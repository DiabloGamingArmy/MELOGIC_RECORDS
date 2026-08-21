const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value))
  ? Number(value)
  : fallback

export function getTimelineViewportBeatRange({
  scrollLeft = 0,
  viewportWidth = 0,
  originX = 0,
  pixelsPerBeat = 1,
  minBeat = 0,
  maxBeat = Infinity,
  bufferViewports = 0
} = {}) {
  const safePixelsPerBeat = Math.max(0.0001, finiteNumber(pixelsPerBeat, 1))
  const safeViewportWidth = Math.max(1, finiteNumber(viewportWidth, 1))
  const safeScrollLeft = Math.max(0, finiteNumber(scrollLeft, 0))
  const safeOriginX = finiteNumber(originX, 0)
  const safeBuffer = Math.max(0, finiteNumber(bufferViewports, 0)) * safeViewportWidth
  const lowerBound = finiteNumber(minBeat, 0)
  const upperBound = Number.isFinite(Number(maxBeat)) ? Number(maxBeat) : Infinity
  const startBeat = (safeScrollLeft - safeBuffer - safeOriginX) / safePixelsPerBeat
  const endBeat = (safeScrollLeft + safeViewportWidth + safeBuffer - safeOriginX) / safePixelsPerBeat

  return {
    startBeat: Math.max(lowerBound, Math.min(upperBound, startBeat)),
    endBeat: Math.max(lowerBound, Math.min(upperBound, endBeat))
  }
}

export function timelineBeatRangesOverlap(startBeat, endBeat, range = {}) {
  const start = finiteNumber(startBeat, 0)
  const end = Math.max(start, finiteNumber(endBeat, start))
  const rangeStart = finiteNumber(range.startBeat, 0)
  const rangeEnd = Math.max(rangeStart, finiteNumber(range.endBeat, rangeStart))
  return end >= rangeStart && start <= rangeEnd
}

export function timelineViewportNeedsRefresh(renderedRange = null, visibleRange = null) {
  if (!renderedRange || !visibleRange) return true
  const renderedStart = finiteNumber(renderedRange.startBeat, 0)
  const renderedEnd = finiteNumber(renderedRange.endBeat, renderedStart)
  const visibleStart = finiteNumber(visibleRange.startBeat, 0)
  const visibleEnd = finiteNumber(visibleRange.endBeat, visibleStart)
  return visibleStart < renderedStart || visibleEnd > renderedEnd
}
