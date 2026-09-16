// Melogic mobile SPA migration foundation.
//
// Patch 1 intentionally DOES NOT intercept navigation yet. It establishes the
// route registry, lifecycle/event contract, safe same-origin classification,
// and bounded idle prewarming needed by later patches without changing current
// page behavior. This lets individual surfaces migrate incrementally.

import { ROUTES } from '../utils/routes'

const MOBILE_QUERY = '(max-width: 760px)'
const SPA_EVENT = 'melogic:mobile-spa-navigation'
const PREWARM_LIMIT = 3
const PREWARM_DELAY_MS = 900

const ROUTE_DEFINITIONS = Object.freeze([
  { id: 'community', path: ROUTES.community, module: () => import('../community.js') },
  { id: 'streaming', path: ROUTES.music, module: () => import('../music.js') },
  { id: 'camera', path: '/camera', module: () => import('../camera.js') },
  { id: 'inbox', path: ROUTES.inbox, prefix: '/inbox/', module: () => import('../inbox.js') },
  { id: 'profile-public', path: ROUTES.profilePublic, prefixes: ['/profiles/', '/u/'], module: () => import('../profilePublic.js') }, // melogic-mobile-spa-profile-v5
  { id: 'profile-edit', path: ROUTES.editProfile, module: () => import('../editProfile.js') },
  { id: 'profile', path: ROUTES.profile, module: () => import('../profile.js') },
  { id: 'products', path: ROUTES.products, module: () => import('../products.js') },
  { id: 'cart', path: ROUTES.cart, module: () => import('../cart.js') },
  { id: 'support', path: ROUTES.support, prefix: '/support/', module: () => import('../support.js') }
])

const warmedRoutes = new Set()
const ACTIVE_SPA_ROUTE_IDS = new Set(['inbox', 'community', 'profile', 'profile-edit', 'profile-public']) // melogic-mobile-spa-inbox-intercept-v3 // melogic-mobile-spa-community-v4 // melogic-mobile-spa-profile-v5
let initialized = false
let prewarmTimer = 0

function normalizedPath(value = location.pathname) {
  const path = String(value || '/').replace(/\/+$/, '')
  return path || '/'
}

export function isMobileSpaRuntime() {
  if (window.__TAURI_INTERNALS__ || window.__TAURI__) return false
  return window.matchMedia(MOBILE_QUERY).matches ||
    window.matchMedia('(display-mode: standalone)').matches ||
    navigator.standalone === true
}

export function resolveMobileSpaRoute(value = location.pathname) {
  const path = normalizedPath(value)
  return MOBILE_SPA_ROUTES.find(route =>
    path === route.path ||
    (route.prefix && path.startsWith(route.prefix)) ||
    (Array.isArray(route.prefixes) && route.prefixes.some(prefix => path.startsWith(prefix)))
  ) || null
}

export const MOBILE_SPA_ROUTES = ROUTE_DEFINITIONS.map(({ module, ...route }) => Object.freeze(route))

export function canHandleMobileSpaUrl(value) {
  if (!isMobileSpaRuntime()) return false
  let url
  try { url = value instanceof URL ? value : new URL(String(value), location.href) } catch { return false }
  if (url.origin !== location.origin) return false
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return Boolean(resolveMobileSpaRoute(url.pathname))
}

export function isActivatedMobileSpaRoute(value = location.pathname) {
  const route = resolveMobileSpaRoute(value)
  return Boolean(route && ACTIVE_SPA_ROUTE_IDS.has(route.id))
}

export function emitMobileSpaNavigation(detail = {}) {
  window.dispatchEvent(new CustomEvent(SPA_EVENT, {
    detail: {
      pathname: normalizedPath(),
      route: resolveMobileSpaRoute(),
      ...detail
    }
  }))
}

export function onMobileSpaNavigation(listener) {
  if (typeof listener !== 'function') return () => {}
  window.addEventListener(SPA_EVENT, listener)
  return () => window.removeEventListener(SPA_EVENT, listener)
}

export async function prewarmMobileSpaRoute(path) {
  const route = ROUTE_DEFINITIONS.find(candidate => {
    const normalized = normalizedPath(path)
    return normalized === candidate.path ||
      (candidate.prefix && normalized.startsWith(candidate.prefix)) ||
      (Array.isArray(candidate.prefixes) && candidate.prefixes.some(prefix => normalized.startsWith(prefix)))
  })
  if (!route || warmedRoutes.has(route.id)) return false
  warmedRoutes.add(route.id)
  try {
    // Module prewarming downloads/parses the existing page implementation but
    // does not mount another DOM tree. Existing entry modules may have side
    // effects, so Patch 1 only prewarms route documents; module activation is
    // reserved for lifecycle-aware migrations in later patches.
    await fetch(route.path, {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'force-cache',
      headers: { 'X-Melogic-Prewarm': 'mobile-spa-v1' }
    })
    return true
  } catch {
    warmedRoutes.delete(route.id)
    return false
  }
}

function scheduleConservativePrewarm() {
  if (!isMobileSpaRuntime() || !navigator.onLine) return
  if (navigator.connection?.saveData) return
  const connection = String(navigator.connection?.effectiveType || '')
  if (connection === 'slow-2g' || connection === '2g') return

  const current = resolveMobileSpaRoute()
  const candidates = ROUTE_DEFINITIONS
    .filter(route => route.id !== current?.id)
    .slice(0, PREWARM_LIMIT)

  const run = async () => {
    for (const route of candidates) {
      if (document.visibilityState !== 'visible') break
      await prewarmMobileSpaRoute(route.path)
    }
  }

  if ('requestIdleCallback' in window) {
    requestIdleCallback(() => void run(), { timeout: 2500 })
  } else {
    prewarmTimer = window.setTimeout(() => void run(), PREWARM_DELAY_MS)
  }
}

export function initMobileSpaFoundation() {
  if (initialized) return
  initialized = true
  if (!isMobileSpaRuntime()) return

  // Seed a serializable history state now. Later patches can use the same
  // contract for pushState/popstate without replacing the current document.
  const current = resolveMobileSpaRoute()
  const existing = history.state && typeof history.state === 'object' ? history.state : {}
  history.replaceState({
    ...existing,
    melogicMobileSpa: true,
    routeId: current?.id || null,
    pathname: normalizedPath()
  }, '', location.href)

  // Patch 1 observes traversal only. It does not prevent default navigation.
  window.addEventListener('popstate', () => emitMobileSpaNavigation({ type: 'popstate' }))
  window.addEventListener('online', scheduleConservativePrewarm)
  window.addEventListener('pagehide', () => {
    if (prewarmTimer) window.clearTimeout(prewarmTimer)
  }, { once: true })

  scheduleConservativePrewarm()
  emitMobileSpaNavigation({ type: 'init' })
}
