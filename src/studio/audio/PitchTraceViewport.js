
const stateByRegion = new Map()
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || min))

function getState(id = 'pitch-trace') {
  id = String(id)
  if (!stateByRegion.has(id)) stateByRegion.set(id, { rowHeight: 22, scrollLeft: 0, scrollTop: 0 })
  return stateByRegion.get(id)
}

function getViewId(view) { return view?.dataset?.pitchTraceRegionId || 'pitch-trace' }
function getScroll(view) { return view?.querySelector?.('[data-pitch-trace-scroll]') || null }

function applyVerticalState(view, preserve = false, anchorY = 0.5) {
  const state = getState(getViewId(view))
  const scroll = getScroll(view)
  if (!scroll) return

  const previousHeight = Math.max(1, scroll.scrollHeight)
  const scrollRatio = (scroll.scrollTop + (scroll.clientHeight * anchorY)) / previousHeight
  view.style.setProperty('--pt-row-height', `${state.rowHeight}px`)

  requestAnimationFrame(() => {
    scroll.scrollLeft = state.scrollLeft
    scroll.scrollTop = preserve
      ? Math.max(0, (scrollRatio * Math.max(1, scroll.scrollHeight)) - (scroll.clientHeight * anchorY))
      : state.scrollTop
  })
}

function zoom(view, axis, direction, clientX = null, anchorY = 0.5) {
  if (axis === 'x') {
    // studioProject.js owns Region Editor musical geometry. This request lets it
    // change the single visual scale shared by ruler, grid, notes, waveform and playhead.
    const detail = { direction }
    if (Number.isFinite(clientX)) detail.clientX = clientX
    view.dispatchEvent(new CustomEvent('soura:pitch-trace-horizontal-zoom', {
      bubbles: true,
      detail
    }))
    return
  }

  const state = getState(getViewId(view))
  state.rowHeight = direction === 'fit'
    ? 22
    : clamp(state.rowHeight * (direction === 'in' ? 1.16 : 0.86), 14, 58)
  applyVerticalState(view, true, anchorY)
}

function hydrate() {
  document.querySelectorAll('.studio-pitch-trace-view').forEach((view) => {
    if (view.dataset.ptReady === '1') return
    view.dataset.ptReady = '1'
    applyVerticalState(view)
  })
}

document.addEventListener('click', (event) => {
  const button = event.target.closest?.('[data-pitch-trace-zoom]')
  if (!button) return
  const view = button.closest('[data-audio-region-editor]')?.querySelector('.studio-pitch-trace-view')
  if (view) zoom(view, button.dataset.pitchTraceAxis === 'y' ? 'y' : 'x', button.dataset.pitchTraceZoom || 'fit')
})

document.addEventListener('wheel', (event) => {
  const scroll = event.target.closest?.('[data-pitch-trace-scroll]')
  if (!scroll) return
  const view = scroll.closest('.studio-pitch-trace-view')
  if (!view) return

  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    zoom(view, 'x', event.deltaY < 0 ? 'in' : 'out', event.clientX)
  } else if (event.altKey) {
    event.preventDefault()
    const rect = scroll.getBoundingClientRect()
    zoom(view, 'y', event.deltaY < 0 ? 'in' : 'out', 0.5, clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1))
  } else if (event.shiftKey && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
    event.preventDefault()
    scroll.scrollLeft += event.deltaY
  }
}, { passive: false })

document.addEventListener('scroll', (event) => {
  const scroll = event.target
  if (!(scroll instanceof Element) || !scroll.matches('[data-pitch-trace-scroll]')) return
  const view = scroll.closest('.studio-pitch-trace-view')
  if (!view) return
  const state = getState(getViewId(view))
  state.scrollLeft = scroll.scrollLeft
  state.scrollTop = scroll.scrollTop
  view.dispatchEvent(new CustomEvent('soura:pitch-trace-horizontal-scroll', {
    bubbles: true,
    detail: { scrollLeft: scroll.scrollLeft }
  }))
}, true)

if (!globalThis.__souraPitchTraceViewportInstalled) {
  globalThis.__souraPitchTraceViewportInstalled = true
  new MutationObserver(hydrate).observe(document.documentElement, { subtree: true, childList: true })
  hydrate()
}
