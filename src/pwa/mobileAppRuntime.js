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

const RUNTIME_EVENT = 'melogic:mobile-runtime-state'
const VIEW_IDS = new Set(['community', 'inbox', 'profile', 'profile-edit', 'profile-public', 'camera', 'streaming'])
const registry = new Map()
const instances = new Map()

let initialized = false
let activeViewId = null
let transitionId = 0

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
  publish('view-registered', { viewId: id })
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
  if (!isMobileSpaRuntime()) return false
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  if (url.origin !== location.origin) return false

  const route = resolveMobileSpaRoute(url.pathname)
  if (!route || !VIEW_IDS.has(route.id)) return false
  const lifecycle = registry.get(route.id)
  if (!lifecycle) return false
  const outlet = getMobileSpaOutlet()
  if (!(outlet instanceof HTMLElement)) return false

  const currentTransition = ++transitionId
  const previousId = activeViewId
  const previous = previousId ? registry.get(previousId) : null
  const previousInstance = previousId ? instances.get(previousId) : null
  publish('transition-start', { from: previousId, to: route.id, source })

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
  activeViewId = route.id

  const state = {
    ...(history.state && typeof history.state === 'object' ? history.state : {}),
    melogicMobileSpa: true,
    melogicMobileRuntime: true,
    routeId: route.id,
    pathname: normalizedPath(url.pathname)
  }
  if (historyMode === 'replace') history.replaceState(state, '', url.href)
  else if (historyMode === 'push' && url.href !== location.href) history.pushState(state, '', url.href)

  emitMobileSpaNavigation({ type: 'runtime', source, route, pathname: normalizedPath(url.pathname) })
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

export function initMobileAppRuntime() {
  if (initialized) return
  initialized = true
  if (!isMobileSpaRuntime()) return
  document.documentElement.dataset.melogicMobileRuntime = 'foundation'
  publish('init')
  window.addEventListener('pagehide', event => {
    if (!event.persisted) publish('pagehide')
  })
}
