// Melogic mobile SPA persistent-shell foundation.
//
// Patch 2 separates the shared mobile chrome from the page-owned #app tree.
// It deliberately does not intercept route navigation yet. Migrated SPA views
// in later patches can replace the outlet without destroying/recreating the
// header and bottom navigation.

import { getMobileSpaPageDepth, isMobileSpaRuntime, onMobileSpaNavigation, resolveMobileSpaRoute } from './mobileSpaRouter'

const HOST_ID = 'melogic-mobile-spa-shell-host'
const OUTLET_ATTR = 'data-melogic-mobile-spa-outlet'
const SHELL_SELECTOR = '.mobile-app-shell'
const HEADER_SELECTOR = '.mobile-app-header'
const NAV_SELECTOR = '.mobile-bottom-nav'

let initialized = false
let observer = null
let persistentShell = null
let outlet = null
let harvesting = false
const routeHeaderPresentations = new Map() // melogic-community-header-ownership-v8b

function routeTitle(routeId) {
  switch (routeId) {
    case 'community': return 'Community'
    case 'streaming': return 'Streaming'
    case 'inbox': return 'Inbox'
    case 'profile':
    case 'profile-edit': return 'Profile'
    case 'products': return 'Products'
    case 'cart': return 'Cart'
    case 'support': return 'Support'
    case 'camera': return 'Camera'
    default: return 'Melogic'
  }
}

function currentPath() {
  return location.pathname.replace(/\/+$/, '') || '/'
}

function ensureHost() {
  let host = document.getElementById(HOST_ID)
  if (!host) {
    host = document.createElement('div')
    host.id = HOST_ID
    host.dataset.melogicMobileSpaShellHost = 'true'
    const app = document.querySelector('#app')
    if (app?.parentNode) app.parentNode.insertBefore(host, app)
    else document.body.prepend(host)
  }
  return host
}

function ensureOutlet() {
  const app = document.querySelector('#app')
  if (!app) return null
  app.setAttribute(OUTLET_ATTR, '')
  app.dataset.melogicMobileSpaOutletState = 'active'
  return app
}

function copyHeaderPresentation(source, target) {
  if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) return
  // Header contents are page-specific (Community actions/back affordances).
  // Replace only the header interior; the persistent shell/header node survives.
  target.className = source.className
  for (const attr of [...target.attributes]) {
    if (attr.name === 'class') continue
    if (!source.hasAttribute(attr.name)) target.removeAttribute(attr.name)
  }
  for (const attr of [...source.attributes]) {
    if (attr.name === 'class') continue
    target.setAttribute(attr.name, attr.value)
  }
  target.innerHTML = source.innerHTML
}

// melogic-route-header-presentations-v8c
// Every primary route gets its own presentation snapshot. Community remains
// identifiable from its specialized header; generic headers are keyed by the
// route that owned the shell when it was harvested.
function presentationRouteId(header, routeId = null) {
  if (!(header instanceof HTMLElement)) return null
  if (header.matches('[data-community-mobile-header], .community-app-header')) return 'community'
  return routeId || null
}

function rememberHeaderPresentation(header, routeId = null) {
  const ownerId = presentationRouteId(header, routeId)
  if (!ownerId) return false

  // melogic-community-canonical-header-v8d
  // Community has specialized controls. Once its real navShell header has been
  // captured, a generic/stale persistent header must never overwrite it.
  if (ownerId === 'community') {
    const isCommunityHeader = header.matches('[data-community-mobile-header], .community-app-header')
    const existing = routeHeaderPresentations.get('community')
    if (!isCommunityHeader && existing instanceof HTMLElement) return false
    if (!isCommunityHeader) return false
  }

  routeHeaderPresentations.set(ownerId, header.cloneNode(true))
  return true
}

function restoreRememberedHeaderPresentation(routeId, target) {
  const source = routeHeaderPresentations.get(routeId)
  if (!(source instanceof HTMLElement) || !(target instanceof HTMLElement)) return false
  copyHeaderPresentation(source, target)
  return true
}

function syncBottomNavigation(nav = persistentShell?.querySelector(NAV_SELECTOR)) {
  if (!(nav instanceof HTMLElement)) return
  const path = currentPath()
  nav.querySelectorAll('a[href]').forEach(anchor => {
    let targetPath = ''
    try { targetPath = new URL(anchor.href, location.href).pathname.replace(/\/+$/, '') || '/' } catch {}
    const inboxMatch = targetPath === '/inbox' && (path === '/inbox' || path.startsWith('/inbox/'))
    const profileMatch = targetPath === '/profile' && (path === '/profile' || path.startsWith('/profile/'))
    const communityMatch = targetPath === '/community' && (path === '/community' || path.startsWith('/community/'))
    const streamingMatch = targetPath === '/streaming' && (path === '/streaming' || path.startsWith('/streaming/'))
    const cameraMatch = (targetPath === '/camera' || targetPath === '/camera.html') && (path === '/camera' || path === '/camera.html')
    const active = inboxMatch || profileMatch || communityMatch || streamingMatch || cameraMatch
    if (active) anchor.setAttribute('aria-current', 'page')
    else anchor.removeAttribute('aria-current')
  })
}

// melogic-mobile-subpage-contract-v11a
function syncMobilePageDepth() {
  const depth = getMobileSpaPageDepth()
  document.documentElement.dataset.melogicMobilePageDepth = depth
  if (persistentShell instanceof HTMLElement) persistentShell.dataset.melogicMobilePageDepth = depth
  const currentOutlet = getMobileSpaOutlet()
  if (currentOutlet instanceof HTMLElement) currentOutlet.dataset.melogicMobilePageDepth = depth
  return depth
}

function syncGenericHeaderTitle() {
  const header = persistentShell?.querySelector(HEADER_SELECTOR)
  const title = header?.querySelector('.mobile-app-title')
  if (!(title instanceof HTMLElement)) return
  // Do not destroy richer Community lockup/actions. Those are harvested from
  // the page's own shell when that route is mounted.
  if (header.classList.contains('community-app-header')) return
  const route = resolveMobileSpaRoute()
  title.textContent = routeTitle(route?.id)
}

// melogic-restore-existing-community-chrome-v8
// SPA transitions keep one persistent shell. When returning to Community, restore
// the already-existing Community header presentation from Community's parked/live
// page shell rather than synthesizing/re-coding its controls.
function restoreRouteHeaderPresentation() {
  const route = resolveMobileSpaRoute()
  const target = persistentShell?.querySelector(HEADER_SELECTOR)
  if (!(target instanceof HTMLElement) || !route?.id) return false

  if (route.id === 'community') {
    const source = document.querySelector(
      '#app [data-community-mobile-header], #app .community-app-header'
    )
    if (source instanceof HTMLElement && source !== target) {
      rememberHeaderPresentation(source, 'community')
      copyHeaderPresentation(source, target)
      return true
    }
  }

  // Critical 8C correction: restore the DESTINATION route's own existing header
  // on every activation, not just Community. This prevents Community chrome from
  // remaining in the persistent shell on the second+ trip to Inbox/Streaming/etc.
  if (restoreRememberedHeaderPresentation(route.id, target)) return true

  // Cold/first activation can use the currently harvested header as source.
  if (route.id === 'community' && target.matches('[data-community-mobile-header], .community-app-header')) {
    rememberHeaderPresentation(target, 'community')
    return true
  }
  return false
}

function harvestShell(candidate) {
  if (!(candidate instanceof HTMLElement) || candidate === persistentShell || harvesting) return
  const host = ensureHost()
  const candidateHeader = candidate.querySelector(HEADER_SELECTOR)
  const candidateRoute = resolveMobileSpaRoute()
  rememberHeaderPresentation(candidateHeader, candidateRoute?.id || null)

  harvesting = true
  try {
    if (!persistentShell) {
      persistentShell = candidate
      persistentShell.dataset.melogicPersistentMobileShell = 'true'
      host.replaceChildren(persistentShell)
    } else {
      // melogic-profile-community-shell-ownership-v1
      // Each full document load owns its own page shell. The old implementation
      // preserved the first shell forever, so a Community shell could survive a
      // subsequent Profile document and visually cover/lock the Profile page.
      // Replace the persistent shell with the newly rendered page shell instead.
      const previousShell = persistentShell
      persistentShell = candidate
      persistentShell.dataset.melogicPersistentMobileShell = 'true'
      host.replaceChildren(persistentShell)
      if (previousShell && previousShell !== persistentShell && previousShell.isConnected) {
        previousShell.remove()
      }
    }
    syncBottomNavigation()
    syncGenericHeaderTitle()
    const activeRoute = resolveMobileSpaRoute()
    const activeHeader = persistentShell?.querySelector(HEADER_SELECTOR)
    if (activeRoute?.id === 'community' || !activeHeader?.classList.contains('community-app-header')) {
      rememberHeaderPresentation(activeHeader, activeRoute?.id || null)
    }
  } finally {
    harvesting = false
  }
}

function discoverShells(root = document) {
  if (!isMobileSpaRuntime()) return
  const shells = []
  if (root instanceof Element && root.matches(SHELL_SELECTOR)) shells.push(root)
  if (root.querySelectorAll) shells.push(...root.querySelectorAll(SHELL_SELECTOR))
  shells.forEach(harvestShell)
}

function bindOutletObserver() {
  if (observer || !document.documentElement) return
  observer = new MutationObserver(records => {
    if (harvesting) return
    let needsDiscovery = false
    for (const record of records) {
      if (record.type !== 'childList' || !record.addedNodes.length) continue
      for (const node of record.addedNodes) {
        if (!(node instanceof Element)) continue
        if (node.matches(SHELL_SELECTOR) || node.querySelector?.(SHELL_SELECTOR)) {
          needsDiscovery = true
          break
        }
      }
      if (needsDiscovery) break
    }
    if (needsDiscovery) discoverShells(document)
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
}

function boot() {
  if (!isMobileSpaRuntime()) return
  outlet = ensureOutlet()
  if (!outlet) return
  document.documentElement.dataset.melogicMobileSpaShell = 'ready'
  discoverShells(document)
  bindOutletObserver()
  syncMobilePageDepth()

  // Keep persistent chrome accurate as Patch 1 history state changes. Future
  // patches will emit the same event after same-document view transitions.
  onMobileSpaNavigation(() => {
    syncBottomNavigation()
    syncMobilePageDepth()
    const activeRoute = resolveMobileSpaRoute()
    const restored = restoreRouteHeaderPresentation()

    // Community's existing navShell + syncCommunityMobileHeader own its header.
    // Generic title sync must not run over that specialized presentation.
    if (activeRoute?.id !== 'community' || !restored) syncGenericHeaderTitle()

    requestAnimationFrame(() => {
      const settledRoute = resolveMobileSpaRoute()
      const activeHeader = persistentShell?.querySelector(HEADER_SELECTOR)
      if (settledRoute?.id === 'community') {
        rememberHeaderPresentation(activeHeader, 'community')
      } else if (!activeHeader?.classList.contains('community-app-header')) {
        rememberHeaderPresentation(activeHeader, settledRoute?.id || null)
      }
    })
  })
}

export function getPersistentMobileSpaShell() {
  return persistentShell
}

export function getMobileSpaOutlet() {
  return outlet || document.querySelector(`[${OUTLET_ATTR}]`)
}

export function initPersistentMobileSpaShell() {
  if (initialized) return
  initialized = true
  if (!isMobileSpaRuntime()) return

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true })
  } else {
    boot()
  }
}
