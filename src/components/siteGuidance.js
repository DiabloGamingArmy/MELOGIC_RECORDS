import { openChatDock } from './chatDock'
import {
  setSiteGuidanceSessionStatus,
  startSiteGuidanceSession,
  subscribeToGuidanceOverlays,
  subscribeToGuidanceSession,
  updateSiteGuidanceSession
} from '../data/siteGuidanceService'
import '../styles/siteGuidance.css'

const STORAGE_KEY = 'melogic_site_guidance_session_v1'
const POSITION_KEY = 'melogic_site_guidance_position_v1'
const UPDATE_INTERVAL_MS = 3500

let initialized = false
let root = null
let getShellState = () => ({ authReady: false, user: null, profile: null })
let unsubscribeShellState = () => {}
let unsubscribeSession = () => {}
let unsubscribeOverlays = () => {}
let updateTimer = null
let updateThrottleTimer = null
let dragState = null

const state = {
  user: null,
  pendingStart: null,
  starting: false,
  error: '',
  session: null,
  overlays: [],
  position: readPosition()
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function readStoredSession() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    return {
      id: String(parsed.id || '').trim(),
      threadId: String(parsed.threadId || '').trim(),
      threadKind: parsed.threadKind === 'support' ? 'support' : 'thread',
      viewer: parsed.viewer === 'agent' ? 'agent' : 'resona'
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return null
  }
}

function storeSession(session = null) {
  try {
    if (!session?.id || session.status === 'stopped') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({
      id: session.id,
      threadId: session.threadId,
      threadKind: session.threadKind,
      viewer: session.viewer
    }))
  } catch {
    // Persistence failure should not break chat guidance.
  }
}

function readPosition() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return null
    const x = Number(parsed.x)
    const y = Number(parsed.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null
    return { x, y }
  } catch {
    localStorage.removeItem(POSITION_KEY)
    return null
  }
}

function storePosition(position = null) {
  try {
    if (!position) localStorage.removeItem(POSITION_KEY)
    else localStorage.setItem(POSITION_KEY, JSON.stringify(position))
  } catch {
    // Optional UI persistence.
  }
}

function pageRouteLabel(pathname = window.location.pathname || '/') {
  const segment = String(pathname || '/').split('/').filter(Boolean)[0] || 'home'
  return segment
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function safeElementLabel(element) {
  if (!element) return ''
  const label = element.getAttribute('data-guide-label')
    || element.getAttribute('aria-label')
    || element.getAttribute('title')
    || element.textContent
    || ''
  return String(label).replace(/\s+/g, ' ').trim().slice(0, 120)
}

function collectLandmarks() {
  const selectors = [
    '[data-guide-id]',
    'main h1',
    'main h2',
    'main nav[aria-label]',
    'main section[aria-label]',
    'main button[aria-label]',
    'main a[aria-label]'
  ].join(',')
  return Array.from(document.querySelectorAll(selectors))
    .filter((element) => {
      if (element.closest('input, textarea, [type="password"], [data-private], [data-no-guidance]')) return false
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && rect.bottom >= 0 && rect.top <= window.innerHeight
    })
    .slice(0, 24)
    .map((element, index) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.getAttribute('data-guide-id') || `landmark-${index + 1}`,
        label: safeElementLabel(element),
        role: element.getAttribute('role') || element.tagName.toLowerCase(),
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    })
    .filter((entry) => entry.label || entry.id)
}

function collectPageContext() {
  const heading = document.querySelector('main h1, main h2, [data-page-title]')
  const activeModal = document.querySelector('[role="dialog"][aria-modal="true"], .modal, .admin-modal-backdrop')
  return {
    currentRoute: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    routeLabel: pageRouteLabel(),
    pageTitle: document.title || heading?.textContent || '',
    featureArea: safeElementLabel(heading) || pageRouteLabel(),
    activeModal: activeModal ? safeElementLabel(activeModal) || 'Modal open' : '',
    viewport: {
      width: window.innerWidth || 0,
      height: window.innerHeight || 0
    },
    scroll: {
      x: window.scrollX || 0,
      y: window.scrollY || 0
    },
    landmarks: collectLandmarks()
  }
}

function isInboxPage() {
  return /^\/?inbox(?:\/|$)/.test(window.location.pathname.replace(/^\//, ''))
}

function openGuidanceDockIfNeeded(session = state.session) {
  if (!session || session.status === 'stopped' || isInboxPage()) return
  openChatDock({
    mode: session.threadKind === 'support' ? 'support' : 'thread',
    support: session.threadKind === 'support',
    threadId: session.threadId,
    title: session.viewer === 'agent' ? 'Melogic Support' : 'Resona'
  })
}

function subscribeActiveSession(sessionRef = readStoredSession()) {
  unsubscribeSession()
  unsubscribeOverlays()
  unsubscribeSession = () => {}
  unsubscribeOverlays = () => {}
  if (!sessionRef?.id) {
    state.session = null
    state.overlays = []
    render()
    return
  }
  unsubscribeSession = subscribeToGuidanceSession(sessionRef.id, (session) => {
    state.session = session
    state.error = ''
    storeSession(session)
    if (!session || session.status === 'stopped') {
      unsubscribeOverlays()
      unsubscribeOverlays = () => {}
      state.overlays = []
      stopUpdateTimer()
    } else {
      startUpdateTimer()
      openGuidanceDockIfNeeded(session)
    }
    render()
  }, (error) => {
    state.error = error?.message || 'Could not load site guidance.'
    render()
  })
  subscribeOverlayStream(sessionRef.id)
}

function subscribeOverlayStream(sessionId = '') {
  unsubscribeOverlays()
  unsubscribeOverlays = subscribeToGuidanceOverlays(sessionId, (overlays) => {
    const now = Date.now()
    state.overlays = overlays.filter((overlay) => {
      if (!overlay.expiresAt) return true
      const expires = new Date(overlay.expiresAt).getTime()
      return Number.isNaN(expires) || expires > now
    })
    render()
  }, () => {})
}

function stopUpdateTimer() {
  if (updateTimer) window.clearInterval(updateTimer)
  if (updateThrottleTimer) window.clearTimeout(updateThrottleTimer)
  updateTimer = null
  updateThrottleTimer = null
}

function startUpdateTimer() {
  if (updateTimer || !state.session?.id) return
  updateTimer = window.setInterval(sendPageContextUpdate, UPDATE_INTERVAL_MS)
}

function sendPageContextUpdate() {
  if (!state.session?.id || state.session.status !== 'active') return
  updateSiteGuidanceSession({
    sessionId: state.session.id,
    pageContext: collectPageContext()
  }).catch(() => {})
}

function schedulePageContextUpdate() {
  if (!state.session?.id || state.session.status !== 'active' || updateThrottleTimer) return
  updateThrottleTimer = window.setTimeout(() => {
    updateThrottleTimer = null
    sendPageContextUpdate()
  }, 900)
}

function requestSiteGuidanceStart(detail = {}) {
  const threadId = String(detail.threadId || '').trim()
  if (!threadId) return
  state.pendingStart = {
    threadId,
    threadKind: detail.threadKind === 'support' || detail.support === true || detail.mode === 'support' ? 'support' : 'thread',
    viewer: detail.viewer === 'agent' ? 'agent' : 'resona'
  }
  state.error = ''
  render()
}

async function confirmStart() {
  if (!state.pendingStart || state.starting) return
  state.starting = true
  state.error = ''
  render()
  try {
    const result = await startSiteGuidanceSession({
      ...state.pendingStart,
      pageContext: collectPageContext()
    })
    state.pendingStart = null
    state.session = result.session
    storeSession(result.session)
    subscribeActiveSession(result.session)
    sendPageContextUpdate()
    openGuidanceDockIfNeeded(result.session)
  } catch (error) {
    state.error = error?.message || 'Could not start site guidance.'
  } finally {
    state.starting = false
    render()
  }
}

function cancelStart() {
  state.pendingStart = null
  state.error = ''
  render()
}

async function setGuidanceStatus(status = '') {
  if (!state.session?.id) return
  const previous = state.session.status
  state.session = { ...state.session, status }
  render()
  try {
    await setSiteGuidanceSessionStatus({ sessionId: state.session.id, status })
    if (status === 'stopped') {
      storeSession(null)
      unsubscribeSession()
      unsubscribeOverlays()
      unsubscribeSession = () => {}
      unsubscribeOverlays = () => {}
      state.session = null
      state.overlays = []
      stopUpdateTimer()
    }
  } catch (error) {
    state.session = { ...state.session, status: previous }
    state.error = error?.message || 'Could not update site guidance.'
  }
  render()
}

function modalMarkup() {
  if (!state.pendingStart) return ''
  return `
    <div class="site-guidance-modal-backdrop" data-site-guidance-cancel>
      <section class="site-guidance-modal" role="dialog" aria-modal="true" aria-labelledby="site-guidance-title">
        <h2 id="site-guidance-title">Share this Melogic page with Resona?</h2>
        <p>Resona will receive safe context about this website page, such as the current page, scroll position, and visible interface areas. This does not share your full screen, other browser tabs, or other apps.</p>
        ${state.error ? `<p class="site-guidance-error">${escapeHtml(state.error)}</p>` : ''}
        <div class="site-guidance-modal-actions">
          <button type="button" class="site-guidance-secondary" data-site-guidance-cancel ${state.starting ? 'disabled' : ''}>Cancel</button>
          <button type="button" class="site-guidance-primary" data-site-guidance-confirm ${state.starting ? 'disabled' : ''}>${state.starting ? 'Starting...' : 'Start sharing this page'}</button>
        </div>
      </section>
    </div>
  `
}

function dockMarkup() {
  const session = state.session
  if (!session || session.status === 'stopped') return ''
  const paused = session.status === 'paused'
  const label = session.viewer === 'agent'
    ? 'Sharing this page with Melogic Support'
    : 'Sharing this page with Resona'
  const style = state.position ? ` style="left:${Math.round(state.position.x)}px;top:${Math.round(state.position.y)}px;"` : ''
  return `
    <section class="site-guidance-dock ${paused ? 'is-paused' : ''}" data-site-guidance-dock${style} aria-live="polite">
      <button type="button" class="site-guidance-drag-handle" data-site-guidance-drag aria-label="Move sharing controls"><span></span></button>
      <div>
        <strong>${escapeHtml(paused ? 'Site guidance paused' : label)}</strong>
        <small>${paused ? 'Page context updates are paused.' : 'Melogic page only. No full screen capture.'}</small>
      </div>
      <div class="site-guidance-dock-actions">
        <button type="button" data-site-guidance-status="${paused ? 'active' : 'paused'}">${paused ? 'Resume' : 'Pause'}</button>
        <button type="button" data-site-guidance-status="stopped">Stop</button>
      </div>
    </section>
  `
}

function overlaysMarkup() {
  if (!state.overlays.length) return ''
  return `
    <div class="site-guidance-overlay-layer" aria-hidden="true">
      ${state.overlays.map((overlay) => `
        <div class="site-guidance-box" style="left:${Math.round(overlay.x)}px;top:${Math.round(overlay.y)}px;width:${Math.round(overlay.width)}px;height:${Math.round(overlay.height)}px;">
          ${overlay.label ? `<span>${escapeHtml(overlay.label)}</span>` : ''}
        </div>
      `).join('')}
    </div>
  `
}

function render() {
  if (!root) return
  root.innerHTML = `
    ${modalMarkup()}
    ${dockMarkup()}
    ${overlaysMarkup()}
  `
}

function onPointerMove(event) {
  if (!dragState) return
  event.preventDefault()
  const x = Math.max(8, Math.min(window.innerWidth - dragState.width - 8, dragState.startLeft + (event.clientX - dragState.startX)))
  const y = Math.max(8, Math.min(window.innerHeight - dragState.height - 8, dragState.startTop + (event.clientY - dragState.startY)))
  state.position = { x, y }
  const dock = root?.querySelector('[data-site-guidance-dock]')
  if (dock) {
    dock.style.left = `${Math.round(x)}px`
    dock.style.top = `${Math.round(y)}px`
  }
}

function onPointerUp() {
  if (!dragState) return
  dragState = null
  storePosition(state.position)
  document.body.classList.remove('site-guidance-is-dragging')
  window.removeEventListener('pointermove', onPointerMove)
}

function bindEvents() {
  document.addEventListener('click', (event) => {
    const starter = event.target.closest('[data-site-guidance-start]')
    if (starter) {
      event.preventDefault()
      requestSiteGuidanceStart({
        threadId: starter.getAttribute('data-site-guidance-thread-id') || '',
        threadKind: starter.getAttribute('data-site-guidance-thread-kind') || 'thread',
        viewer: starter.getAttribute('data-site-guidance-viewer') || 'resona'
      })
      return
    }
    const confirm = event.target.closest('[data-site-guidance-confirm]')
    if (confirm) {
      event.preventDefault()
      confirmStart()
      return
    }
    const cancel = event.target.closest('[data-site-guidance-cancel]')
    if (cancel && (event.target.hasAttribute('data-site-guidance-cancel') || cancel.tagName === 'BUTTON')) {
      event.preventDefault()
      cancelStart()
      return
    }
    const status = event.target.closest('[data-site-guidance-status]')
    if (status) {
      event.preventDefault()
      setGuidanceStatus(status.getAttribute('data-site-guidance-status') || '')
    }
  })

  document.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-site-guidance-drag]')
    const dock = event.target.closest('[data-site-guidance-dock]')
    if (!handle || !dock) return
    event.preventDefault()
    const rect = dock.getBoundingClientRect()
    dragState = {
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      width: rect.width,
      height: rect.height
    }
    state.position = { x: rect.left, y: rect.top }
    document.body.classList.add('site-guidance-is-dragging')
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
    window.addEventListener('pointercancel', onPointerUp, { once: true })
  })

  window.addEventListener('scroll', () => {
    schedulePageContextUpdate()
  }, { passive: true })
  window.addEventListener('resize', () => {
    schedulePageContextUpdate()
  }, { passive: true })
}

export function initSiteGuidance(options = {}) {
  getShellState = typeof options.getShellState === 'function' ? options.getShellState : getShellState
  if (!initialized) {
    initialized = true
    root = document.querySelector('[data-site-guidance-root]')
    if (!root) {
      root = document.createElement('div')
      root.dataset.siteGuidanceRoot = ''
      document.body.appendChild(root)
    }
    bindEvents()
    const stored = readStoredSession()
    if (stored?.id && getShellState()?.user) subscribeActiveSession(stored)
  }
  state.user = getShellState()?.user || null
  if (typeof options.onShellStateChange === 'function') {
    unsubscribeShellState()
    unsubscribeShellState = options.onShellStateChange((snapshot) => {
      state.user = snapshot?.user || null
      if (!state.user) {
        unsubscribeSession()
        unsubscribeOverlays()
        storeSession(null)
        state.session = null
        state.overlays = []
        stopUpdateTimer()
      } else if (!state.session) {
        const stored = readStoredSession()
        if (stored?.id) subscribeActiveSession(stored)
      }
      render()
    })
  }
  render()
}
