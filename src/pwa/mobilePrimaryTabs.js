/*
 * melogic-mobile-primary-tabs-foundation-v1
 *
 * Narrow foundation for the two high-frequency consumer tabs:
 *   /community <-> /streaming
 *
 * IMPORTANT: this module does NOT intercept clicks or perform same-document
 * transitions yet. Patch 3 can do that only after both surfaces satisfy this
 * contract. Direct document navigation remains the fallback and source of truth.
 */

const MOBILE_QUERY = '(max-width: 760px)'
const TAB_EVENT = 'melogic:mobile-primary-tab-state'
const SCROLL_PREFIX = 'melogic:mobile-primary-tab-scroll:'

export const MOBILE_PRIMARY_TABS = Object.freeze({
  community: Object.freeze({ id: 'community', path: '/community' }),
  streaming: Object.freeze({ id: 'streaming', path: '/streaming' })
})

let initialized = false

function normalizedPath(value = location.pathname) {
  const path = String(value || '/').replace(/\/+$/, '')
  return path || '/'
}

export function isMobilePrimaryTabEnvironment() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return false
  return window.matchMedia(MOBILE_QUERY).matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true
}

export function resolveMobilePrimaryTab(value = location.pathname) {
  const path = normalizedPath(value)
  if (path === MOBILE_PRIMARY_TABS.community.path) return MOBILE_PRIMARY_TABS.community
  if (path === MOBILE_PRIMARY_TABS.streaming.path) return MOBILE_PRIMARY_TABS.streaming
  return null
}

export function isMobilePrimaryTabUrl(value) {
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  return url.origin === location.origin && Boolean(resolveMobilePrimaryTab(url.pathname))
}

function scrollKey(tabId) {
  return `${SCROLL_PREFIX}${tabId}`
}

export function saveMobilePrimaryTabScroll(tabId, value = window.scrollY) {
  if (!MOBILE_PRIMARY_TABS[tabId]) return
  try { sessionStorage.setItem(scrollKey(tabId), String(Math.max(0, Number(value) || 0))) } catch {}
}

export function readMobilePrimaryTabScroll(tabId) {
  if (!MOBILE_PRIMARY_TABS[tabId]) return 0
  try { return Math.max(0, Number(sessionStorage.getItem(scrollKey(tabId))) || 0) } catch { return 0 }
}

export function restoreMobilePrimaryTabScroll(tabId, { behavior = 'instant' } = {}) {
  const top = readMobilePrimaryTabScroll(tabId)
  requestAnimationFrame(() => window.scrollTo({ top, left: 0, behavior }))
}

function publish(type, extra = {}) {
  const active = resolveMobilePrimaryTab()
  const detail = Object.freeze({
    type,
    activeTabId: active?.id || null,
    pathname: normalizedPath(),
    ...extra
  })
  window.__melogicMobilePrimaryTabs = detail
  window.dispatchEvent(new CustomEvent(TAB_EVENT, { detail }))
  return detail
}

export function onMobilePrimaryTabState(listener) {
  if (typeof listener !== 'function') return () => {}
  window.addEventListener(TAB_EVENT, listener)
  return () => window.removeEventListener(TAB_EVENT, listener)
}

function classifyPrimaryTabAnchors() {
  document.querySelectorAll('a[href]').forEach(anchor => {
    let url
    try { url = new URL(anchor.href, location.href) } catch { return }
    const tab = url.origin === location.origin ? resolveMobilePrimaryTab(url.pathname) : null
    if (!tab) {
      anchor.removeAttribute('data-melogic-primary-tab')
      return
    }
    anchor.dataset.melogicPrimaryTab = tab.id
    // Contract marker only. Native navigation remains untouched in Patch 2.
    anchor.dataset.nativeTouchNavigation = 'true'
  })
}

function snapshotCurrentScroll() {
  const active = resolveMobilePrimaryTab()
  if (active) saveMobilePrimaryTabScroll(active.id)
}

export function initMobilePrimaryTabsFoundation() {
  if (initialized) return
  initialized = true
  if (!isMobilePrimaryTabEnvironment()) return

  document.documentElement.dataset.melogicPrimaryTabs = 'foundation'
  classifyPrimaryTabAnchors()

  // navShell can be re-rendered after auth/account changes.
  const observer = new MutationObserver(records => {
    if (records.some(record => record.addedNodes.length)) classifyPrimaryTabAnchors()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })

  // Save state for later same-document transitions without changing current
  // browser navigation semantics.
  window.addEventListener('pagehide', snapshotCurrentScroll)
  window.addEventListener('beforeunload', snapshotCurrentScroll)
  window.addEventListener('popstate', () => publish('popstate'))
  window.addEventListener('pageshow', event => {
    classifyPrimaryTabAnchors()
    publish(event.persisted ? 'pageshow-persisted' : 'pageshow')
  })

  publish('init')
}

// melogic-mobile-primary-tabs-seamless-v1
//
// Conservative seamless transition layer. Page entry modules are never
// dynamically cross-evaluated: Community and Streaming still own substantial
// top-level auth/media/listener side effects.
//
// First visit to either tab remains native document navigation. After both tabs
// have been visited, repeat switching may restore the previously rendered
// surface from same-session snapshots. Any unsafe/unknown state falls back to
// browser document navigation.

const SEAMLESS_SNAPSHOT_PREFIX = 'melogic:mobile-primary-tab-snapshot:'
const SEAMLESS_VERSION = 1
let seamlessTransitionPending = false

function seamlessSnapshotKey(tabId) {
  return `${SEAMLESS_SNAPSHOT_PREFIX}${SEAMLESS_VERSION}:${tabId}`
}

function runtimeUnsafeForSeamlessNavigation() {
  if (document.documentElement.dataset.preventPwaReload === 'true') return true
  if (document.body?.dataset.preventPwaReload === 'true') return true
  return Boolean(document.querySelector(
    '[data-unsaved-changes="true"],[data-recording="true"],[data-exporting="true"],' +
    '[data-uploading="true"],[data-checkout-active="true"],dialog[open]'
  ))
}

function serializeCurrentPrimaryTab() {
  const tab = resolveMobilePrimaryTab()
  const app = document.querySelector('#app')
  const shellHost = document.querySelector('#melogic-mobile-spa-shell-host')
  if (!tab || !(app instanceof HTMLElement)) return false

  saveMobilePrimaryTabScroll(tab.id)

  const payload = {
    version: SEAMLESS_VERSION,
    tabId: tab.id,
    title: document.title,
    bodyClass: document.body.className,
    appHTML: app.innerHTML,
    shellHTML: shellHost instanceof HTMLElement ? shellHost.innerHTML : '',
    scrollY: window.scrollY,
    savedAt: Date.now()
  }

  try {
    sessionStorage.setItem(seamlessSnapshotKey(tab.id), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

function readPrimaryTabSnapshot(tabId) {
  try {
    const raw = sessionStorage.getItem(seamlessSnapshotKey(tabId))
    if (!raw) return null
    const payload = JSON.parse(raw)
    if (payload?.version !== SEAMLESS_VERSION ||
        payload?.tabId !== tabId ||
        typeof payload?.appHTML !== 'string') return null
    return payload
  } catch {
    return null
  }
}

function sanitizeSnapshotFragment(html) {
  const template = document.createElement('template')
  template.innerHTML = String(html || '')
  template.content.querySelectorAll('script').forEach(node => node.remove())
  template.content.querySelectorAll('[autofocus]').forEach(node => node.removeAttribute('autofocus'))
  return template.content
}

function restorePrimaryTabSnapshot(tab, payload, url, historyMode) {
  const app = document.querySelector('#app')
  if (!(app instanceof HTMLElement)) return false

  try {
    app.inert = true
    document.body.classList.remove('is-community-page', 'is-streaming-page')
    document.body.className = payload.bodyClass || ''
    document.title = payload.title || (tab.id === 'community' ? 'Community' : 'Streaming')

    const shellHost = document.querySelector('#melogic-mobile-spa-shell-host')
    if (shellHost instanceof HTMLElement && payload.shellHTML) {
      shellHost.replaceChildren(sanitizeSnapshotFragment(payload.shellHTML))
    }

    app.replaceChildren(sanitizeSnapshotFragment(payload.appHTML))

    const state = {
      ...(history.state && typeof history.state === 'object' ? history.state : {}),
      melogicMobileSpa: true,
      melogicPrimaryTab: true,
      routeId: tab.id,
      pathname: normalizedPath(url.pathname)
    }
    if (historyMode === 'replace') history.replaceState(state, '', url.href)
    else if (historyMode === 'push' && url.href !== location.href) history.pushState(state, '', url.href)

    classifyPrimaryTabAnchors()
    app.inert = false
    requestAnimationFrame(() => {
      window.scrollTo({ top: Math.max(0, Number(payload.scrollY) || 0), left: 0, behavior: 'instant' })
    })
    publish('seamless-restored', { activeTabId: tab.id })
    return true
  } catch (error) {
    app.inert = false
    console.warn('[Melogic primary tabs] Snapshot restore failed; using document navigation.', error)
    return false
  }
}

function eligiblePrimaryTabAnchor(event) {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const target = event.target instanceof Element ? event.target : null
  const anchor = target?.closest('a[data-melogic-primary-tab][href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.hasAttribute('download')) return null
  if (anchor.target && anchor.target !== '_self') return null

  let url
  try { url = new URL(anchor.href, location.href) } catch { return null }
  if (url.origin !== location.origin) return null

  const destination = resolveMobilePrimaryTab(url.pathname)
  const current = resolveMobilePrimaryTab()
  if (!destination || !current || destination.id === current.id) return null
  return { anchor, url, destination, current }
}

function installSeamlessPrimaryTabNavigation() {
  if (!isMobilePrimaryTabEnvironment()) return
  if (document.documentElement.dataset.melogicPrimaryTabsSeamless === 'true') return
  document.documentElement.dataset.melogicPrimaryTabsSeamless = 'true'

  const saveSettled = () => {
    if (!runtimeUnsafeForSeamlessNavigation()) serializeCurrentPrimaryTab()
  }
  if (document.readyState === 'complete') setTimeout(saveSettled, 700)
  else window.addEventListener('load', () => setTimeout(saveSettled, 700), { once: true })

  let snapshotTimer = 0
  const scheduleSnapshot = () => {
    clearTimeout(snapshotTimer)
    snapshotTimer = window.setTimeout(saveSettled, 600)
  }
  document.addEventListener('input', scheduleSnapshot, { passive: true })
  document.addEventListener('change', scheduleSnapshot, { passive: true })
  window.addEventListener('scroll', scheduleSnapshot, { passive: true })

  document.addEventListener('click', event => {
    const match = eligiblePrimaryTabAnchor(event)
    if (!match || seamlessTransitionPending || runtimeUnsafeForSeamlessNavigation()) return

    serializeCurrentPrimaryTab()
    const destinationSnapshot = readPrimaryTabSnapshot(match.destination.id)

    // First visit to a tab stays a real document navigation.
    if (!destinationSnapshot) return

    event.preventDefault()
    seamlessTransitionPending = true
    const restored = restorePrimaryTabSnapshot(match.destination, destinationSnapshot, match.url, 'push')
    seamlessTransitionPending = false
    if (!restored) location.assign(match.url.href)
  }, { capture: true })

  window.addEventListener('popstate', () => {
    if (seamlessTransitionPending) return
    const tab = resolveMobilePrimaryTab()
    if (!tab || runtimeUnsafeForSeamlessNavigation()) return
    const payload = readPrimaryTabSnapshot(tab.id)
    if (!payload) return

    seamlessTransitionPending = true
    const restored = restorePrimaryTabSnapshot(tab, payload, new URL(location.href), 'none')
    seamlessTransitionPending = false
    if (!restored) location.reload()
  })

  window.addEventListener('pagehide', () => {
    if (!runtimeUnsafeForSeamlessNavigation()) serializeCurrentPrimaryTab()
  })
}

// melogic-mobile-primary-tabs-3b-live-surface-v1
// IMPORTANT: Patch 3's serialized-DOM restoration is intentionally disabled.
// Re-parsing #app HTML creates new nodes and cannot preserve page-owned listener,
// media, subscription, and closure identity. Until Community and Streaming are
// refactored into lifecycle-pure mount/activate/deactivate modules, the browser
// document lifecycle remains the only safe owner of those surfaces.
//
// Patch 2 still provides:
// - exact Community/Streaming tab classification
// - native-touch navigation markers
// - per-tab scroll snapshots/contracts
// - route-state events
//
// We explicitly advertise the corrected mode for diagnostics.
document.documentElement.dataset.melogicPrimaryTabsSeamless = 'native-safe'
document.documentElement.dataset.melogicPrimaryTabsLifecycle = 'document-owned'
