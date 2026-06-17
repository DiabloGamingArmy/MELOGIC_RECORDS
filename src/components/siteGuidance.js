import { getChatDockState, openChatDock } from './chatDock'
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
const CONTEXT_REFRESH_EVENT = 'melogic:site-guidance-refresh-context'
const GUIDANCE_STATE_EVENT = 'melogic:site-guidance-state'
const EMBEDDED_CONTEXT_TYPES = new Set(['studio_daw', 'stagemaker'])

let initialized = false
let root = null
let getShellState = () => ({ authReady: false, user: null, profile: null })
let unsubscribeShellState = () => {}
let unsubscribeSession = () => {}
let unsubscribeOverlays = () => {}
let updateThrottleTimer = null
let mutationObserver = null
let routeHooksInstalled = false
let overlayHideTimers = new Map()
let overlaySeenAt = new Map()
let dismissedOverlayIds = new Set()
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
      viewer: parsed.viewer === 'agent' ? 'agent' : 'resona',
      contextType: String(parsed.contextType || '').trim(),
      contextId: String(parsed.contextId || '').trim(),
      contextLabel: String(parsed.contextLabel || '').trim()
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
      viewer: session.viewer,
      contextType: session.contextType || '',
      contextId: session.contextId || '',
      contextLabel: session.contextLabel || ''
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

function safeGuideText(element) {
  if (!element) return ''
  if (element.closest('input, textarea, select, [contenteditable="true"], [data-private], [data-no-guidance]')) return ''
  return String(element.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

function isVisibleGuideElement(element) {
  if (!element || element.closest('[data-site-guidance-root], [data-private], [data-no-guidance]')) return false
  if (element.getAttribute('aria-hidden') === 'true' || element.closest('[aria-hidden="true"]')) return false
  if (element.closest('input[type="password"], [data-payment-field], [data-secret], [data-token]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  if (rect.bottom < 0 || rect.right < 0 || rect.top > window.innerHeight || rect.left > window.innerWidth) return false
  const styles = window.getComputedStyle(element)
  return styles.visibility !== 'hidden' && styles.display !== 'none' && Number(styles.opacity || 1) > 0
}

function collectVisibleGuideTargets() {
  const selectors = [
    '[data-guide-id]',
    'header nav a',
    'header nav button',
    'main h1',
    'main h2',
    'main nav[aria-label]',
    'main section[aria-label]',
    'main button[aria-label]',
    'main a[aria-label]'
  ].join(',')
  const domTargets = Array.from(document.querySelectorAll(selectors))
    .map((element, index) => {
      const rect = element.getBoundingClientRect()
      const guideId = element.getAttribute('data-guide-id') || `visible-target-${index + 1}`
      const role = element.getAttribute('data-guide-role')
        || element.getAttribute('role')
        || element.tagName.toLowerCase()
      const label = safeElementLabel(element) || guideId
      return {
        guideId,
        id: guideId,
        label,
        role,
        text: safeGuideText(element),
        visible: true,
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      }
    })
    .filter((entry) => entry.label || entry.guideId)
    .filter((entry) => entry.visible !== false)
  const registeredTargets = Array.isArray(globalThis.__MELOGIC_GUIDE_TARGETS__)
    ? globalThis.__MELOGIC_GUIDE_TARGETS__.map((entry = {}, index) => {
      const rect = entry.rect && typeof entry.rect === 'object' ? entry.rect : entry
      const guideId = String(entry.guideId || entry.id || `registered-target-${index + 1}`).trim()
      return {
        guideId,
        id: guideId,
        label: String(entry.label || guideId).replace(/\s+/g, ' ').trim().slice(0, 120),
        role: String(entry.role || 'registered-target').trim().slice(0, 80),
        text: String(entry.text || '').replace(/\s+/g, ' ').trim().slice(0, 180),
        entityId: String(entry.entityId || '').trim().slice(0, 120),
        visible: entry.visible !== false,
        rect: {
          x: Math.round(Number(rect.x || 0)),
          y: Math.round(Number(rect.y || 0)),
          width: Math.max(0, Math.round(Number(rect.width || 0))),
          height: Math.max(0, Math.round(Number(rect.height || 0)))
        },
        x: Math.round(Number(rect.x || 0)),
        y: Math.round(Number(rect.y || 0)),
        width: Math.max(0, Math.round(Number(rect.width || 0))),
        height: Math.max(0, Math.round(Number(rect.height || 0)))
      }
    }).filter((entry) => entry.visible && entry.guideId && entry.rect.width > 0 && entry.rect.height > 0)
    : []
  return [...domTargets, ...registeredTargets]
    .sort((a, b) => {
      const aInteractive = /\b(button|link|nav|card|filter|sidebar|conversation|composer|stage-entity)\b/i.test(a.role)
      const bInteractive = /\b(button|link|nav|card|filter|sidebar|conversation|composer|stage-entity)\b/i.test(b.role)
      if (aInteractive !== bInteractive) return aInteractive ? -1 : 1
      return (a.rect.y - b.rect.y) || (a.rect.x - b.rect.x)
    })
    .slice(0, 120)
}

function isSensitiveCaptureElement(element) {
  if (!element) return true
  return Boolean(element.closest([
    '[data-private]',
    '[data-no-guidance]',
    '[data-payment-field]',
    '[data-secret]',
    '[data-token]',
    '[data-chat-dock-root]',
    '[data-site-guidance-root]',
    'input[type="password"]',
    'input[type="hidden"]',
    'iframe[src*="stripe"]'
  ].join(',')))
}

function safeSnapshotText(element) {
  if (!element || isSensitiveCaptureElement(element)) return ''
  const tag = element.tagName.toLowerCase()
  const hasExplicitGuideId = element.hasAttribute('data-guide-id')
  if (!hasExplicitGuideId && ['section', 'article', 'nav', 'aside', 'main'].includes(tag)) return ''
  return safeGuideText(element)
}

function safeSnapshotLabel(element) {
  if (!element || isSensitiveCaptureElement(element)) return ''
  const metadataLabel = element.getAttribute('data-guide-label')
    || element.getAttribute('aria-label')
    || element.getAttribute('title')
    || ''
  if (metadataLabel) return String(metadataLabel).replace(/\s+/g, ' ').trim().slice(0, 120)
  const tag = element.tagName.toLowerCase()
  if (['section', 'article', 'nav', 'aside', 'main'].includes(tag)) return ''
  return safeElementLabel(element)
}

function collectVisiblePageSnapshot() {
  const appRoot = document.querySelector('#app, main, [data-app-root]') || document.body
  const viewport = {
    width: window.innerWidth || 0,
    height: window.innerHeight || 0
  }
  const selectors = [
    'main h1',
    'main h2',
    'main h3',
    'main [data-guide-id]',
    'main nav',
    'main aside',
    'main section',
    'main article',
    'main button',
    'main a',
    '[data-page-title]'
  ].join(',')
  const regions = Array.from(appRoot.querySelectorAll(selectors))
    .filter((element) => isVisibleGuideElement(element))
    .filter((element) => !isSensitiveCaptureElement(element))
    .map((element, index) => {
      const rect = element.getBoundingClientRect()
      return {
        id: element.getAttribute('data-guide-id') || `page-region-${index + 1}`,
        label: safeSnapshotLabel(element),
        role: element.getAttribute('data-guide-role') || element.getAttribute('role') || element.tagName.toLowerCase(),
        text: safeSnapshotText(element),
        rect: {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        }
      }
    })
    .filter((entry) => entry.label || entry.text || entry.id)
    .slice(0, 80)
  return {
    type: 'safe_dom_page_snapshot',
    captureKind: 'structured_layout',
    screenshotAvailable: false,
    screenshotTodo: 'Add vetted DOM-to-image capture with masking before sending bitmap page snapshots.',
    captureTarget: appRoot.id ? `#${appRoot.id}` : appRoot.tagName.toLowerCase(),
    excluded: ['chat dock', 'site guidance controls', 'password inputs', 'hidden fields', 'payment/secret/token fields', 'Stripe iframes'],
    viewport,
    regions
  }
}

function formatLocalIso(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

function collectPageContext(extraContext = state.session || state.pendingStart || {}) {
  const heading = document.querySelector('main h1, main h2, [data-page-title]')
  const activeModal = document.querySelector('[role="dialog"][aria-modal="true"], .modal, .admin-modal-backdrop')
  const visibleGuideTargets = collectVisibleGuideTargets()
  const pageSnapshot = collectVisiblePageSnapshot()
  const now = new Date()
  const clientTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  return {
    shareMode: 'site_only',
    route: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    pathname: window.location.pathname || '/',
    currentRoute: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    routeLabel: pageRouteLabel(),
    pageTitle: document.title || heading?.textContent || '',
    featureArea: safeElementLabel(heading) || pageRouteLabel(),
    contextType: String(extraContext?.contextType || '').trim(),
    contextId: String(extraContext?.contextId || '').trim(),
    contextLabel: String(extraContext?.contextLabel || '').trim(),
    activeModal: activeModal ? safeElementLabel(activeModal) || 'Modal open' : '',
    viewport: {
      width: window.innerWidth || 0,
      height: window.innerHeight || 0
    },
    scroll: {
      x: window.scrollX || 0,
      y: window.scrollY || 0
    },
    timestamp: now.toISOString(),
    clientTimeZone,
    clientLocalTimeISO: formatLocalIso(now),
    utcTimeISO: now.toISOString(),
    visibleGuideTargets,
    landmarks: visibleGuideTargets,
    pageSnapshot
  }
}

function normalizeMatchText(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function scoreGuideElementMatch(element, text = '') {
  if (!isVisibleGuideElement(element)) return 0
  const target = normalizeMatchText(text)
  if (!target) return 0
  const guideId = normalizeMatchText(element.getAttribute('data-guide-id') || '')
  const label = normalizeMatchText(safeElementLabel(element))
  const role = normalizeMatchText(element.getAttribute('data-guide-role') || element.getAttribute('role') || element.tagName.toLowerCase())
  const body = normalizeMatchText(safeGuideText(element))
  const combined = normalizeMatchText(`${label} ${body} ${guideId}`)
  const wantsSide = /\b(left|sidebar|side|nav|navigation|tab|button)\b/.test(target)
  let score = 0
  if (guideId === target) score += 1000
  if (label === target) score += 800
  if (`${label} ${role}`.trim() === target) score += 620
  if (label && target.includes(label)) score += 520
  if (label.includes(target)) score += 460
  if (combined.includes(target)) score += 260
  if (wantsSide && /\b(sidebar|nav|navigation|filter)\b/.test(role)) score += 180
  if (/\b(button|link|nav|card|filter|conversation|composer)\b/.test(role)) score += 50
  return score
}

function findVisibleGuideElementById(guideId = '') {
  const cleanId = String(guideId || '').trim()
  if (!cleanId) return null
  const escapedId = globalThis.CSS?.escape ? CSS.escape(cleanId) : cleanId.replace(/"/g, '\\"')
  const element = document.querySelector(`[data-guide-id="${escapedId}"]`)
  return isVisibleGuideElement(element) ? element : null
}

function findVisibleGuideElementByText(text = '') {
  return Array.from(document.querySelectorAll('[data-guide-id]'))
    .map((element) => ({ element, score: scoreGuideElementMatch(element, text) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.element || null
}

function resolveOverlayRect(overlay = {}) {
  const element = findVisibleGuideElementById(overlay.targetGuideId)
    || findVisibleGuideElementById(overlay.guideId)
    || findVisibleGuideElementByText(overlay.fallbackText || overlay.label)
  if (element) {
    const rect = element.getBoundingClientRect()
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height
    }
  }
  if (overlay.width > 0 && overlay.height > 0) {
    return {
      x: overlay.x,
      y: overlay.y,
      width: overlay.width,
      height: overlay.height
    }
  }
  return null
}

function isInboxPage() {
  return /^\/?inbox(?:\/|$)/.test(window.location.pathname.replace(/^\//, ''))
}

function openGuidanceDockIfNeeded(session = state.session) {
  if (!session || session.status === 'stopped' || isInboxPage()) return
  if (EMBEDDED_CONTEXT_TYPES.has(session.contextType || '')) return
  const dock = getChatDockState()
  const expectedMode = session.threadKind === 'support' ? 'support' : 'thread'
  if (dock.open && !dock.minimized && dock.mode === expectedMode && dock.activeThreadId === session.threadId) return
  openChatDock({
    mode: expectedMode,
    support: session.threadKind === 'support',
    threadId: session.threadId,
    title: session.viewer === 'agent' ? 'Melogic Support' : 'Resona'
  })
}

function dispatchGuidanceState() {
  const threadId = state.pendingStart?.threadId || state.session?.threadId || ''
  window.dispatchEvent(new CustomEvent(GUIDANCE_STATE_EVENT, {
    detail: {
      active: state.session?.status === 'active',
      paused: state.session?.status === 'paused',
      starting: state.starting === true,
      pending: Boolean(state.pendingStart),
      threadId,
      contextType: state.pendingStart?.contextType || state.session?.contextType || '',
      contextId: state.pendingStart?.contextId || state.session?.contextId || '',
      contextLabel: state.pendingStart?.contextLabel || state.session?.contextLabel || ''
    }
  }))
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
  overlayHideTimers.forEach((timer) => window.clearTimeout(timer))
  overlayHideTimers = new Map()
  overlaySeenAt = new Map()
  dismissedOverlayIds = new Set()
  unsubscribeOverlays = subscribeToGuidanceOverlays(sessionId, (overlays) => {
    const now = Date.now()
    overlayHideTimers.forEach((timer) => window.clearTimeout(timer))
    overlayHideTimers = new Map()
    state.overlays = overlays.filter((overlay) => {
      if (dismissedOverlayIds.has(overlay.id)) return false
      if (!overlay.expiresAt) return true
      const expires = new Date(overlay.expiresAt).getTime()
      if (!Number.isNaN(expires) && expires <= now) {
        dismissedOverlayIds.add(overlay.id)
        return false
      }
      if (!overlaySeenAt.has(overlay.id)) {
        const created = overlay.createdAt ? new Date(overlay.createdAt).getTime() : 0
        overlaySeenAt.set(overlay.id, Number.isNaN(created) || !created ? now : created)
      }
      const remaining = Number.isNaN(expires) ? Math.max(1200, Number(overlay.durationMs || 5000)) : Math.max(0, expires - now)
      overlayHideTimers.set(overlay.id, window.setTimeout(() => {
        dismissedOverlayIds.add(overlay.id)
        state.overlays = state.overlays.filter((entry) => entry.id !== overlay.id)
        render()
      }, remaining + 80))
      return true
    })
    render()
  }, () => {})
}

function stopUpdateTimer() {
  if (updateThrottleTimer) window.clearTimeout(updateThrottleTimer)
  overlayHideTimers.forEach((timer) => window.clearTimeout(timer))
  overlayHideTimers = new Map()
  updateThrottleTimer = null
}

function scheduleLocalRender(delayMs = 80) {
  if (updateThrottleTimer) return
  updateThrottleTimer = window.setTimeout(() => {
    updateThrottleTimer = null
    render()
  }, delayMs)
}

async function refreshPageContextForOutgoingMessage(reason = 'message-send') {
  if (!state.session?.id || state.session.status !== 'active') return null
  const pageContext = collectPageContext(state.session)
  const context = {
    ...pageContext,
    guidanceSessionActive: true,
    guidanceSessionStatus: state.session.status,
    guidanceSessionId: state.session.id
  }
  console.info('[guidance] context snapshot collected for outgoing message', {
    reason,
    route: context.currentRoute,
    targetCount: Array.isArray(context.visibleGuideTargets) ? context.visibleGuideTargets.length : 0
  })
  await updateSiteGuidanceSession({
    sessionId: state.session.id,
    pageContext
  })
  return context
}

function handleContextRefreshRequest(event) {
  const detail = event?.detail || {}
  const promise = refreshPageContextForOutgoingMessage(detail.reason || 'message-send')
    .then((context) => {
      if (context && Array.isArray(detail.contexts)) detail.contexts.push(context)
      return context
    })
    .catch((error) => {
      console.warn('[guidance] context snapshot failed', {
        code: error?.code || '',
        message: error?.message || ''
      })
      return null
    })
  if (Array.isArray(detail.promises)) detail.promises.push(promise)
}

function requestSiteGuidanceStart(detail = {}) {
  const threadId = String(detail.threadId || '').trim()
  if (!threadId) return
  if (state.starting) return
  if (state.session?.threadId === threadId && ['active', 'paused'].includes(state.session.status || '')) {
    state.pendingStart = null
    state.error = ''
    render()
    return
  }
  state.pendingStart = {
    threadId,
    threadKind: detail.threadKind === 'support' || detail.support === true || detail.mode === 'support' ? 'support' : 'thread',
    viewer: detail.viewer === 'agent' ? 'agent' : 'resona',
    contextType: String(detail.contextType || '').trim(),
    contextId: String(detail.contextId || '').trim(),
    contextLabel: String(detail.contextLabel || '').trim(),
    origin: String(detail.origin || '').trim()
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
      pageContext: collectPageContext(state.pendingStart)
    })
    state.pendingStart = null
    state.session = result.session
    storeSession(result.session)
    subscribeActiveSession(result.session)
    openGuidanceDockIfNeeded(result.session)
    console.info('[guidance] sharing started', {
      threadKind: result.session?.threadKind || '',
      route: window.location.pathname || '/'
    })
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
    console.info(`[guidance] sharing ${status}`, {
      route: window.location.pathname || '/'
    })
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
  const contextType = state.pendingStart.contextType || ''
  const noun = contextType === 'studio_daw'
    ? 'this Studio DAW project'
    : contextType === 'stagemaker'
      ? 'this StageMaker plan'
      : 'this Melogic page'
  const title = state.pendingStart.viewer === 'agent'
    ? `Share ${noun} with Melogic Support?`
    : `Share ${noun} with Resona?`
  const body = contextType === 'studio_daw'
    ? 'Resona will receive safe site-only context about the current Studio DAW layout, selected track, transport state, and visible controls. This does not share your full screen, other browser tabs, files, or apps.'
    : contextType === 'stagemaker'
      ? 'Resona will receive safe site-only context about the current StageMaker plan, selected entity readout, viewport controls, and visible interface areas. This does not share your full screen, other browser tabs, files, or apps.'
      : 'Resona will receive safe context about this website page, such as the current page, scroll position, and visible interface areas. This does not share your full screen, other browser tabs, or other apps.'
  return `
    <div class="site-guidance-modal-backdrop" data-site-guidance-cancel>
      <section class="site-guidance-modal" role="dialog" aria-modal="true" aria-labelledby="site-guidance-title">
        <h2 id="site-guidance-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(body)}</p>
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
  const boxes = state.overlays.map((overlay) => {
    const rect = resolveOverlayRect(overlay)
    if (!rect) return ''
    const durationMs = Math.max(1200, Number(overlay.durationMs || 5000))
    const elapsedMs = Math.max(0, Date.now() - (overlaySeenAt.get(overlay.id) || Date.now()))
    if (elapsedMs >= durationMs) return ''
    return `
      <div class="site-guidance-box" data-site-guidance-overlay-id="${escapeHtml(overlay.id)}" style="left:${Math.round(rect.x)}px;top:${Math.round(rect.y)}px;width:${Math.round(rect.width)}px;height:${Math.round(rect.height)}px;--site-guidance-overlay-duration:${durationMs}ms;animation-delay:-${Math.round(elapsedMs)}ms;">
        ${overlay.label ? `<span>${escapeHtml(overlay.label)}</span>` : ''}
      </div>
    `
  }).filter(Boolean).join('')
  if (!boxes) return ''
  return `
    <div class="site-guidance-overlay-layer" aria-hidden="true">
      ${boxes}
    </div>
  `
}

function render() {
  if (!root) return
  dispatchGuidanceState()
  document.body.classList.toggle('site-guidance-active', Boolean(state.session && state.session.status === 'active'))
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
        viewer: starter.getAttribute('data-site-guidance-viewer') || 'resona',
        contextType: starter.getAttribute('data-site-guidance-context-type') || '',
        contextId: starter.getAttribute('data-site-guidance-context-id') || '',
        contextLabel: starter.getAttribute('data-site-guidance-context-label') || '',
        origin: starter.getAttribute('data-site-guidance-origin') || ''
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
    scheduleLocalRender()
  }, { passive: true })
  window.addEventListener('resize', () => {
    scheduleLocalRender()
  }, { passive: true })
  window.addEventListener('popstate', () => {
    if (state.session?.id) console.info('[guidance] route changed, sharing remains active', { route: window.location.pathname || '/' })
    scheduleLocalRender(0)
  })
  if (!routeHooksInstalled) {
    routeHooksInstalled = true
    ;['pushState', 'replaceState'].forEach((method) => {
      const original = history[method]
      history[method] = function patchedHistoryMethod(...args) {
        const result = original.apply(this, args)
        window.dispatchEvent(new Event('melogic:route-change'))
        return result
      }
    })
  }
  window.addEventListener('melogic:route-change', () => {
    if (state.session?.id) console.info('[guidance] route changed, sharing remains active', { route: window.location.pathname || '/' })
    scheduleLocalRender(0)
  })
  window.addEventListener(CONTEXT_REFRESH_EVENT, handleContextRefreshRequest)
  mutationObserver = new MutationObserver((records = []) => {
    if (records.length && records.every((record) => record.target?.closest?.('[data-site-guidance-root]'))) return
    scheduleLocalRender()
  })
  mutationObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['data-guide-id', 'data-guide-label', 'data-guide-role', 'aria-label', 'hidden', 'class']
  })
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
