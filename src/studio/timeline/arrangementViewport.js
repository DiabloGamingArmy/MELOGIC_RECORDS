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
