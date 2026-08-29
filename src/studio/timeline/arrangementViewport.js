export function clampArrangementViewport({ scrollLeft = 0, scrollTop = 0, maxScrollLeft = Infinity, maxScrollTop = Infinity } = {}) {
  const clamp = (value, max) => Math.max(0, Math.min(Number.isFinite(Number(max)) ? Number(max) : Infinity, Number(value) || 0))
  return { scrollLeft: clamp(scrollLeft, maxScrollLeft), scrollTop: clamp(scrollTop, maxScrollTop) }
}

export function arrangementViewportTransforms(viewport = {}) {
  const { scrollLeft, scrollTop } = clampArrangementViewport(viewport)
  return {
    horizontal: `translate3d(${-scrollLeft}px,0,0)`,
    vertical: `translate3d(0,${-scrollTop}px,0)`
  }
}

const finiteNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

export function normalizeWheelDeltaPixels({ delta = 0, deltaMode = 0, pageSize = 800, lineSize = 16 } = {}) {
  const unit = Number(deltaMode) === 1
    ? Math.max(1, finiteNumber(lineSize, 16))
    : Number(deltaMode) === 2
      ? Math.max(1, finiteNumber(pageSize, 800))
      : 1
  return finiteNumber(delta) * unit
}

export function timelineZoomFactorFromWheel({
  deltaY = 0,
  deltaMode = 0,
  pageSize = 800,
  sensitivity = 0.002,
  maxExponent = 0.28
} = {}) {
  const pixels = normalizeWheelDeltaPixels({ delta: deltaY, deltaMode, pageSize })
  const limit = Math.max(0.01, Math.abs(finiteNumber(maxExponent, 0.28)))
  const exponent = Math.max(-limit, Math.min(limit, -pixels * Math.max(0, finiteNumber(sensitivity, 0.002))))
  return Math.exp(exponent)
}

export function timelineXForBeat({ beat = 0, originX = 0, pixelsPerBeat = 1 } = {}) {
  return finiteNumber(originX) + (finiteNumber(beat) * Math.max(0.000001, finiteNumber(pixelsPerBeat, 1)))
}

export function beatForTimelineX({ x = 0, originX = 0, pixelsPerBeat = 1 } = {}) {
  return (finiteNumber(x) - finiteNumber(originX)) / Math.max(0.000001, finiteNumber(pixelsPerBeat, 1))
}

export function planTimelineZoomViewport({
  targetPixelsPerBeat = 1,
  originX = 0,
  maxBeat = 0,
  trailingBeats = 1,
  contentWidth: authoritativeContentWidth = null,
  viewportWidth = 0,
  pointerViewportX = 0,
  pointerBeat = 0,
  playheadBeat = 0,
  followPlayhead = false,
  playing = false
} = {}) {
  const pixelsPerBeat = Math.max(0.000001, finiteNumber(targetPixelsPerBeat, 1))
  const width = Math.max(0, finiteNumber(viewportWidth))
  const anchorMode = followPlayhead && playing ? 'playhead' : 'pointer'
  const anchorBeat = anchorMode === 'playhead' ? finiteNumber(playheadBeat) : finiteNumber(pointerBeat)
  const anchorViewportX = anchorMode === 'playhead' ? width * 0.5 : finiteNumber(pointerViewportX)
  const contentWidth = authoritativeContentWidth == null
    ? timelineXForBeat({ beat: Math.max(0, finiteNumber(maxBeat)) + Math.max(0, finiteNumber(trailingBeats, 1)), originX, pixelsPerBeat })
    : Math.max(0, finiteNumber(authoritativeContentWidth))
  const maxScrollLeft = Math.max(0, contentWidth - width)
  const desiredScrollLeft = timelineXForBeat({ beat: anchorBeat, originX, pixelsPerBeat }) - anchorViewportX
  const { scrollLeft } = clampArrangementViewport({ scrollLeft: desiredScrollLeft, maxScrollLeft })

  return {
    anchorBeat,
    anchorMode,
    anchorViewportX,
    contentWidth,
    maxScrollLeft,
    pixelsPerBeat,
    scrollLeft
  }
}

export function collectTimelineGeometryInvariantErrors({
  originX = 0,
  pixelsPerBeat = 1,
  expectedContentWidth = null,
  surfaces = [],
  positions = [],
  roundTripBeats = [],
  tolerance = 0.05
} = {}) {
  const errors = []
  const epsilon = Math.max(0.000001, finiteNumber(tolerance, 0.05))

  for (const beat of roundTripBeats) {
    const x = timelineXForBeat({ beat, originX, pixelsPerBeat })
    const restored = beatForTimelineX({ x, originX, pixelsPerBeat })
    if (Math.abs(restored - finiteNumber(beat)) > epsilon) errors.push({ kind: 'round-trip', beat, x, restored })
  }

  for (const surface of surfaces) {
    if (expectedContentWidth == null) break
    if (Math.abs(finiteNumber(surface.width) - finiteNumber(expectedContentWidth)) > epsilon) {
      errors.push({ kind: 'surface-width', surface: surface.name || 'unknown', expected: finiteNumber(expectedContentWidth), actual: finiteNumber(surface.width) })
    }
  }

  for (const position of positions) {
    const expected = timelineXForBeat({ beat: position.beat, originX, pixelsPerBeat })
    if (Math.abs(finiteNumber(position.x) - expected) > epsilon) {
      errors.push({ kind: 'beat-position', surface: position.surface || 'unknown', beat: finiteNumber(position.beat), expected, actual: finiteNumber(position.x) })
    }
  }

  return errors
}
