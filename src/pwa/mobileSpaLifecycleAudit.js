// Mobile SPA final lifecycle diagnostics.
// melogic-mobile-spa-final-v8
//
// This intentionally does not monkey-patch browser/Firebase APIs. It exposes
// cheap runtime signals for regression testing without changing application
// semantics or retaining page objects.

import { isMobileSpaRuntime, resolveMobileSpaRoute } from './mobileSpaRouter'

const STATE_KEY = '__melogicMobileSpaDiagnostics'

function snapshot() {
  if (!isMobileSpaRuntime()) return null
  const state = {
    routeId: resolveMobileSpaRoute()?.id || null,
    pathname: location.pathname,
    visibility: document.visibilityState,
    online: navigator.onLine,
    shellCount: document.querySelectorAll('#melogic-mobile-spa-shell-host').length,
    appOutletCount: document.querySelectorAll('[data-melogic-mobile-spa-outlet]').length,
    preloaderCount: document.querySelectorAll('#page-preloader').length,
    updatedAt: Date.now()
  }
  window[STATE_KEY] = state
  return state
}

export function initMobileSpaLifecycleAudit() {
  if (!isMobileSpaRuntime()) return
  snapshot()
  window.addEventListener('popstate', snapshot)
  window.addEventListener('online', snapshot)
  window.addEventListener('offline', snapshot)
  window.addEventListener('pageshow', snapshot)
  document.addEventListener('visibilitychange', snapshot)

  const observer = new MutationObserver(() => snapshot())
  observer.observe(document.body, { childList: true, subtree: false })
  window.addEventListener('pagehide', event => {
    if (!event.persisted) observer.disconnect()
  })
}
