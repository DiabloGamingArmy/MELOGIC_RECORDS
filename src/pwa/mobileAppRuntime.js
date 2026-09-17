// Unified Melogic mobile application runtime foundation.
// melogic-mobile-unified-runtime-v1
//
// Patch 1 is deliberately non-intercepting. Existing entry modules continue to
// own their current pages until later patches migrate them onto this contract.

import {
  canHandleMobileSpaUrl,
  emitMobileSpaNavigation,
  isMobileSpaRuntime,
  resolveMobileSpaRoute
} from './mobileSpaRouter'
import { getMobileSpaOutlet } from './mobileSpaShell'
import { readMobileRuntimeMetadata, writeMobileRuntimeMetadata } from './mobileSpaDataCache'

const RUNTIME_EVENT = 'melogic:mobile-runtime-state'
const VIEW_IDS = new Set(['community', 'inbox', 'profile', 'profile-edit', 'profile-public', 'camera', 'streaming'])
const registry = new Map()
const instances = new Map()

let initialized = false
let activeViewId = null
let transitionId = 0
let warmupGeneration = 0
const runtimeWarmViews = new Set()
const RUNTIME_WARM_ORDER = ['community', 'inbox', 'profile', 'camera', 'streaming']
let runtimeSuspended = false
let lastCompletedUrl = location.href

// melogic-mobile-runtime-core-hardening-v4a
// Foundation only; cross-document interception remains disabled.
const runtimeScroll = new Map()
let transitionController = null
function runtimeScrollKey(viewId, url = location.href) {
  let pathname = '/'
  try { pathname = new URL(String(url), location.href).pathname.replace(/\/+$/, '') || '/' } catch {}
  return `${String(viewId || '')}:${pathname}`
}
function captureRuntimeScroll(viewId = activeViewId, url = location.href) {
  if (!viewId) return
  runtimeScroll.set(runtimeScrollKey(viewId, url), { x: Math.max(0, Math.round(window.scrollX || 0)), y: Math.max(0, Math.round(window.scrollY || 0)) })
}
function restoreRuntimeScroll(viewId, url = location.href) {
  const saved = runtimeScroll.get(runtimeScrollKey(viewId, url))
  if (!saved) return false

  // melogic-mobile-instant-scroll-restore-v4d2
  // Runtime view restoration is state restoration, not user navigation.
  // Force a single-frame jump even when global/root CSS enables smooth scroll.
  try {
    window.scrollTo({ left: saved.x, top: saved.y, behavior: 'instant' })
  } catch {
    // Older WebKit fallback: temporarily neutralize CSS smooth scrolling.
    const root = document.documentElement
    const previous = root.style.scrollBehavior
    root.style.scrollBehavior = 'auto'
    window.scrollTo(saved.x, saved.y)
    root.style.scrollBehavior = previous
  }
  return true
}
function beginRuntimeTransition() {
  transitionController?.abort()
  transitionController = typeof AbortController === 'function' ? new AbortController() : null
  return { id: ++transitionId, signal: transitionController?.signal || null }
}
function runtimeHistoryState(route, url = location.href) {
  let pathname = normalizedPath()
  try { pathname = normalizedPath(new URL(String(url), location.href).pathname) } catch {}
  return { ...(history.state && typeof history.state === "object" ? history.state : {}), melogicMobileSpa: true, melogicMobileRuntime: true, routeId: route?.id || null, pathname }
}
function runtimeFallback(url, reason = 'runtime-fallback') {
  let target
  try { target = url instanceof URL ? url : new URL(String(url), location.href) } catch { return false }
  publish(reason, { target: target.pathname })
  location.assign(target.href)
  return true
}
export function getMobileRuntimeDiagnostics() {
  return Object.freeze({ ...snapshot(), mode: document.documentElement.dataset.melogicMobileRuntimeMode || 'foundation-non-intercepting', suspended: runtimeSuspended, lastCompletedUrl, scrollKeys: [...runtimeScroll.keys()], historyState: history.state && typeof history.state === 'object' ? { ...history.state } : history.state })
}

function normalizedPath(value = location.pathname) {
  const path = String(value || '/').replace(/\/+$/, '')
  return path || '/'
}

function snapshot(extra = {}) {
  return Object.freeze({
    activeViewId,
    pathname: normalizedPath(),
    routeId: resolveMobileSpaRoute()?.id || null,
    registeredViews: [...registry.keys()],
    mountedViews: [...instances.keys()],
    transitionId,
    ...extra
  })
}

function publish(type, extra = {}) {
  const detail = snapshot({ type, ...extra })
  window.__melogicMobileRuntime = detail
  window.dispatchEvent(new CustomEvent(RUNTIME_EVENT, { detail }))
  return detail
}

function validateLifecycle(viewId, lifecycle) {
  if (!VIEW_IDS.has(viewId)) throw new Error(`Unsupported mobile runtime view: ${viewId}`)
  if (!lifecycle || typeof lifecycle !== 'object') throw new TypeError(`Lifecycle required for ${viewId}`)
  for (const name of ['mount', 'activate', 'deactivate', 'unmount']) {
    if (typeof lifecycle[name] !== 'function') throw new TypeError(`${viewId}.${name}() is required`)
  }
}

export function registerMobileRuntimeView(viewId, lifecycle) {
  const id = String(viewId || '').trim()
  validateLifecycle(id, lifecycle)
  if (registry.has(id) && registry.get(id) !== lifecycle) {
    throw new Error(`Mobile runtime view already registered: ${id}`)
  }
  registry.set(id, lifecycle)
  runtimeWarmViews.add(id)
  const currentRoute = resolveMobileSpaRoute()
  if (!activeViewId && currentRoute?.id === id) {
    activeViewId = id
    instances.set(id, { fragment: null, adopted: true })
    publish('view-adopted', { viewId: id })
  } else {
    publish('view-registered', { viewId: id })
  }
  return () => {
    if (activeViewId === id || instances.has(id)) return false
    registry.delete(id)
    publish('view-unregistered', { viewId: id })
    return true
  }
}

export function getMobileRuntimeState() {
  return snapshot()
}

export function onMobileRuntimeState(listener) {
  if (typeof listener !== 'function') return () => {}
  window.addEventListener(RUNTIME_EVENT, listener)
  return () => window.removeEventListener(RUNTIME_EVENT, listener)
}

export function canActivateMobileRuntimeUrl(value) {
  if (!isMobileSpaRuntime() || !canHandleMobileSpaUrl(value)) return false
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  const route = resolveMobileSpaRoute(url.pathname)
  return Boolean(route && VIEW_IDS.has(route.id) && registry.has(route.id))
}

export async function activateMobileRuntimeUrl(value, { historyMode = 'push', source = 'runtime' } = {}) {
  if (!isMobileSpaRuntime() || runtimeSuspended) return false
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  if (url.origin !== location.origin) return false

  const route = resolveMobileSpaRoute(url.pathname)
  if (!route || !VIEW_IDS.has(route.id)) return false
  const lifecycle = registry.get(route.id)
  if (!lifecycle) return false
  const outlet = getMobileSpaOutlet()
  if (!(outlet instanceof HTMLElement)) return false

  const transition = beginRuntimeTransition()
  const currentTransition = transition.id
  const previousId = activeViewId
  const previous = previousId ? registry.get(previousId) : null
  const previousInstance = previousId ? instances.get(previousId) : null
  publish('transition-start', { from: previousId, to: route.id, source })
  if (previousId) captureRuntimeScroll(previousId, lastCompletedUrl)

  if (previousId && previousId !== route.id && previous && previousInstance) {
    await previous.deactivate({ outlet, instance: previousInstance, from: previousId, to: route.id, transitionId: currentTransition })
    if (currentTransition !== transitionId) return false
  }

  let instance = instances.get(route.id)
  if (!instance) {
    instance = await lifecycle.mount({ outlet, route, url, transitionId: currentTransition })
    if (currentTransition !== transitionId) {
      try { await lifecycle.unmount({ outlet, instance, route, transitionId: currentTransition }) } catch {}
      return false
    }
    instances.set(route.id, instance ?? {})
  }

  await lifecycle.activate({ outlet, instance: instances.get(route.id), route, url, transitionId: currentTransition })
  if (currentTransition !== transitionId) return false
  if (!outlet.isConnected) {
    publish('transition-outlet-lost', { from: previousId, to: route.id, source })
    return false
  }
  document.documentElement.dataset.melogicRuntimeRenderedView = route.id // melogic-runtime-boot-ownership-v4d1
  activeViewId = route.id
  restoreRuntimeScroll(route.id, url.href)

  const state = runtimeHistoryState(route, url.href)
  if (historyMode === 'replace') history.replaceState(state, '', url.href)
  else if (historyMode === 'push' && url.href !== location.href) history.pushState(state, '', url.href)

  emitMobileSpaNavigation({ type: 'runtime', source, route, pathname: normalizedPath(url.pathname) })
  lastCompletedUrl = url.href
  runtimeWarmViews.add(route.id)
  void writeMobileRuntimeMetadata({
    lastRouteId: route.id,
    lastPathname: normalizedPath(url.pathname),
    warmRouteIds: [...runtimeWarmViews]
  })
  publish('transition-complete', { from: previousId, to: route.id, source })
  return true
}

export async function unmountMobileRuntimeView(viewId) {
  const id = String(viewId || '').trim()
  if (!instances.has(id) || activeViewId === id) return false
  const lifecycle = registry.get(id)
  const instance = instances.get(id)
  if (!lifecycle) return false
  await lifecycle.unmount({ outlet: getMobileSpaOutlet(), instance, route: resolveMobileSpaRoute(), transitionId: ++transitionId })
  instances.delete(id)
  publish('view-unmounted', { viewId: id })
  return true
}

// melogic-mobile-unified-runtime-v5
function runtimeCanWarm() {
  if (!isMobileSpaRuntime() || document.visibilityState !== 'visible') return false
  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection
  if (connection?.saveData) return false
  const effectiveType = String(connection?.effectiveType || '')
  if (/^(slow-)?2g$/i.test(effectiveType)) return false
  return true
}

async function warmRuntimeViewModule(routeId, generation) {
  // melogic-urgent-stop-runtime-route-spam-v1
  // EMERGENCY STABILIZATION: never evaluate page entry modules speculatively.
  // The legacy entries still own top-level DOM/auth/navigation side effects.
  // Network/document prewarming remains handled by mobileSpaRouter.
  return false
}

async function warmRuntimeViews() {
  if (!runtimeCanWarm()) return
  const generation = ++warmupGeneration
  const metadata = await readMobileRuntimeMetadata().catch(() => null)
  const remembered = Array.isArray(metadata?.warmRouteIds) ? metadata.warmRouteIds : []
  const order = [...new Set([...remembered, ...RUNTIME_WARM_ORDER])]
  for (const routeId of order) {
    if (generation !== warmupGeneration || !runtimeCanWarm()) return
    await warmRuntimeViewModule(routeId, generation)
    // Yield between heavy entry chunks so first paint/input stays responsive.
    await new Promise(resolve => window.setTimeout(resolve, 80))
  }
  void writeMobileRuntimeMetadata({
    lastRouteId: resolveMobileSpaRoute()?.id || '',
    lastPathname: normalizedPath(),
    warmRouteIds: [...runtimeWarmViews]
  })
  publish('warmup-complete', { warmRouteIds: [...runtimeWarmViews] })
}

function scheduleRuntimeWarmup() {
  if (!runtimeCanWarm()) return
  const run = () => void warmRuntimeViews()
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1800 })
  } else {
    window.setTimeout(run, 900)
  }
}

export function initMobileAppRuntime() {
  if (initialized) return
  initialized = true
  if (!isMobileSpaRuntime()) return
  document.documentElement.dataset.melogicMobileRuntime = 'foundation'
  document.documentElement.dataset.melogicMobileRuntimeMode = 'non-intercepting'
  const initialRoute = resolveMobileSpaRoute()
  if (initialRoute && VIEW_IDS.has(initialRoute.id)) {
    try { history.replaceState(runtimeHistoryState(initialRoute, location.href), '', location.href) } catch {}
  }
  publish('init', { mode: 'non-intercepting' })
  // melogic-urgent-stop-runtime-route-spam-v1
  // Runtime module warmup disabled; router document prewarm remains safe.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      warmupGeneration += 1
      return
    }
    // Runtime module warmup intentionally disabled.
  })
  queueMicrotask(() => initCommunityInboxRuntimeBridge())
  window.addEventListener('pagehide', event => {
    runtimeSuspended = true
    warmupGeneration += 1
    captureRuntimeScroll(activeViewId, location.href)
    transitionController?.abort()
    transitionId += 1
    publish(event.persisted ? 'pagehide-persisted' : 'pagehide')
  })

  window.addEventListener('pageshow', event => {
    runtimeSuspended = false
    const route = resolveMobileSpaRoute()
    const needsRepair = route && VIEW_IDS.has(route.id) && registry.has(route.id) && activeViewId !== route.id
    if (needsRepair) {
      void activateMobileRuntimeUrl(location.href, {
        historyMode: 'replace',
        source: event.persisted ? 'bfcache-restore' : 'pageshow-repair'
      })
    }
    // Runtime module warmup intentionally disabled.
    publish(event.persisted ? 'pageshow-persisted' : 'pageshow')
  })

  window.addEventListener('online', () => {
    if (document.visibilityState === 'visible') scheduleRuntimeWarmup()
    publish('online')
  })
  window.addEventListener('offline', () => publish('offline'))

  window.addEventListener('error', event => {
    const message = String(event?.message || '')
    if (/dynamically imported module|importing a module script|module script/i.test(message)) {
      publish('module-load-error', { message })
    }
  })
}


// melogic-mobile-unified-runtime-v2
const PHASE2_ROUTE_IDS = new Set(['community', 'inbox', 'profile', 'camera', 'streaming']) // melogic-mobile-unified-runtime-v4
let phase2NavigationPending = false

async function prepareMobileRuntimeRoute(url) {
  const route = resolveMobileSpaRoute(url.pathname)
  if (!route || !PRIMARY_TAB_ROUTE_IDS.has(route.id)) return false
  if (registry.has(route.id)) return true
  const { getMobileSpaRouteLoader } = await import('./mobileSpaRouter')
  const loader = getMobileSpaRouteLoader(url.pathname)
  if (typeof loader !== 'function') return false
  try {
    await loader()
    return registry.has(route.id)
  } catch (error) {
    console.error('[Melogic mobile runtime] Primary-tab module preparation failed.', route.id, error)
    return false
  }
}


// melogic-mobile-primary-tab-runtime-v4d
// Narrow activation only: Community <-> Streaming. Other mobile routes retain
// browser-owned document navigation until they receive lifecycle contracts.
const PRIMARY_TAB_ROUTE_IDS = new Set(['community', 'streaming'])
let primaryTabNavigationPending = false

function isPrimaryTabRuntimeUrl(value) {
  if (!isMobileSpaRuntime()) return false
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  if (url.origin !== location.origin) return false
  const route = resolveMobileSpaRoute(url.pathname)
  return Boolean(route && PRIMARY_TAB_ROUTE_IDS.has(route.id))
}

export async function navigateMobileRuntimeUrl(value, options = {}) {
  if (runtimeSuspended || primaryTabNavigationPending || !isPrimaryTabRuntimeUrl(value)) return false
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  const route = resolveMobileSpaRoute(url.pathname)
  if (!route) return false

  primaryTabNavigationPending = true
  document.documentElement.dataset.melogicMobileRuntimeMode = 'primary-tabs'
  try {
    const prepared = await prepareMobileRuntimeRoute(url)
    publish('primary-tab-prepared', { to: route.id, prepared, registeredViews: [...registry.keys()] })
    if (!prepared) return false
    const activated = await activateMobileRuntimeUrl(url, {
      historyMode: options.historyMode || 'push',
      source: options.source || 'primary-tab'
    })
    publish('primary-tab-activation-result', {
      to: route.id,
      activated,
      activeViewId,
      outletChildren: getMobileSpaOutlet()?.childElementCount ?? -1
    })
    return activated
    /* v4d1 old call retained below only as patch context:
    return await activateMobileRuntimeUrl(url, {
      historyMode: options.historyMode || 'push',
      source: options.source || 'primary-tab'
    }) */
  } catch (error) {
    console.error('[Melogic mobile runtime] Primary-tab transition failed.', error)
    return false
  } finally {
    primaryTabNavigationPending = false
  }
}

function primaryTabAnchorForEvent(event) {
  if (event.defaultPrevented || event.button !== 0) return null
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null
  const anchor = event.target?.closest?.('a[href]')
  if (!(anchor instanceof HTMLAnchorElement)) return null
  if (anchor.target && anchor.target !== '_self') return null
  if (anchor.hasAttribute('download')) return null
  if (!isPrimaryTabRuntimeUrl(anchor.href)) return null
  const current = resolveMobileSpaRoute()
  const destination = resolveMobileSpaRoute(new URL(anchor.href).pathname)
  if (!current || !PRIMARY_TAB_ROUTE_IDS.has(current.id) || !destination) return null
  if (current.id === destination.id) return null
  return anchor
}

async function handlePrimaryTabClick(event) {
  const anchor = primaryTabAnchorForEvent(event)
  if (!anchor) return

  // Claim the primary-tab click synchronously so the browser cannot begin a
  // document navigation while the destination module is being prepared.
  event.preventDefault()
  const target = new URL(anchor.href, location.href)
  const handled = await navigateMobileRuntimeUrl(target, { source: 'primary-tab-click' })
  if (!handled) runtimeFallback(target, 'primary-tab-hard-fallback')
}

async function handleRuntimePopstate() {
  const route = resolveMobileSpaRoute()
  if (!route || !PRIMARY_TAB_ROUTE_IDS.has(route.id)) return
  const handled = await navigateMobileRuntimeUrl(location.href, {
    historyMode: 'none',
    source: 'primary-tab-popstate'
  })
  if (!handled && activeViewId !== route.id) runtimeFallback(location.href, 'primary-tab-popstate-fallback')
}

export function initCommunityInboxRuntimeBridge() {
  if (!isMobileSpaRuntime()) return
  // Capture phase claims only exact Community/Streaming cross-tab anchors.
  // Search, post detail, profile, Inbox, Products, etc. are untouched.
  document.addEventListener('click', handlePrimaryTabClick, true)
  window.addEventListener('popstate', () => { void handleRuntimePopstate() })
  document.documentElement.dataset.melogicPrimaryTabRuntime = 'enabled'
  publish('primary-tab-runtime-enabled', { routeIds: [...PRIMARY_TAB_ROUTE_IDS] })
}

