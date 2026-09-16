// Melogic mobile SPA persistent-shell foundation.
//
// Patch 2 separates the shared mobile chrome from the page-owned #app tree.
// It deliberately does not intercept route navigation yet. Migrated SPA views
// in later patches can replace the outlet without destroying/recreating the
// header and bottom navigation.

import { isMobileSpaRuntime, onMobileSpaNavigation, resolveMobileSpaRoute } from './mobileSpaRouter'

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

function harvestShell(candidate) {
  if (!(candidate instanceof HTMLElement) || candidate === persistentShell || harvesting) return
  const host = ensureHost()

  harvesting = true
  try {
    if (!persistentShell) {
      persistentShell = candidate
      persistentShell.dataset.melogicPersistentMobileShell = 'true'
      host.replaceChildren(persistentShell)
    } else {
      const sourceHeader = candidate.querySelector(HEADER_SELECTOR)
      const targetHeader = persistentShell.querySelector(HEADER_SELECTOR)
      copyHeaderPresentation(sourceHeader, targetHeader)

      // Keep the original bottom-nav DOM node alive so touch state, avatar
      // rendering, unread badges, and future SPA listeners are not reset.
      candidate.remove()
    }
    syncBottomNavigation()
    syncGenericHeaderTitle()
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

  // Keep persistent chrome accurate as Patch 1 history state changes. Future
  // patches will emit the same event after same-document view transitions.
  onMobileSpaNavigation(() => {
    syncBottomNavigation()
    syncGenericHeaderTitle()
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
