import './pwa.css'
import { initMobileSpaFoundation } from './mobileSpaRouter'
import { initPersistentMobileSpaShell } from './mobileSpaShell'
import './mobileSpaDataCache' // melogic-mobile-spa-cache-v7b
import { initMobileSpaLifecycleAudit } from './mobileSpaLifecycleAudit'
import { initMobileAppRuntime } from './mobileAppRuntime'


// melogic-mobile-physical-screen-nav-v7
const updateMelogicPhysicalScreenGeometry = () => {
  if (!window.matchMedia('(max-width: 760px)').matches) return
  const root = document.documentElement
  const sw = Number(window.screen?.width || 0)
  const sh = Number(window.screen?.height || 0)
  if (!(sw > 0 && sh > 0)) return
  const landscape = window.matchMedia('(orientation: landscape)').matches
  const physicalWidth = landscape ? Math.max(sw, sh) : Math.min(sw, sh)
  const physicalHeight = landscape ? Math.min(sw, sh) : Math.max(sw, sh)
  root.style.setProperty('--melogic-physical-screen-w', `${physicalWidth}px`)
  root.style.setProperty('--melogic-physical-screen-h', `${physicalHeight}px`)
}
let melogicPhysicalScreenRaf = 0
const scheduleMelogicPhysicalScreenGeometry = () => {
  cancelAnimationFrame(melogicPhysicalScreenRaf)
  melogicPhysicalScreenRaf = requestAnimationFrame(updateMelogicPhysicalScreenGeometry)
}
window.addEventListener('resize', scheduleMelogicPhysicalScreenGeometry, { passive:true })
window.addEventListener('orientationchange', () => {
  scheduleMelogicPhysicalScreenGeometry()
  setTimeout(scheduleMelogicPhysicalScreenGeometry, 250)
  setTimeout(scheduleMelogicPhysicalScreenGeometry, 700)
}, { passive:true })
window.addEventListener('pageshow', scheduleMelogicPhysicalScreenGeometry, { passive:true })
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleMelogicPhysicalScreenGeometry()
})
scheduleMelogicPhysicalScreenGeometry()

// melogic-pwa-viewport-final-hardening-v6
const melogicMobileViewportRoutes = new Set(['/community','/inbox','/inbox/messages','/inbox/calls','/inbox/activity','/profile','/streaming','/camera'])
const isMelogicMobileViewportRoute = () => {
  const path = location.pathname.replace(/\/+$/, '') || '/'
  return melogicMobileViewportRoutes.has(path)
}
const updateMelogicVisualViewportState = () => {
  if (!isMelogicMobileViewportRoute() || !window.matchMedia('(max-width: 760px)').matches) {
    document.documentElement.classList.remove('melogic-visual-viewport-shrunken')
    return
  }
  const vv = window.visualViewport
  if (!vv) return
  const layoutHeight = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0)
  const keyboardLikeShrink = layoutHeight > 0 && vv.height < layoutHeight - 120
  document.documentElement.classList.toggle('melogic-visual-viewport-shrunken', keyboardLikeShrink)
}
let melogicViewportRaf = 0
const scheduleMelogicViewportUpdate = () => {
  cancelAnimationFrame(melogicViewportRaf)
  melogicViewportRaf = requestAnimationFrame(updateMelogicVisualViewportState)
}
window.visualViewport?.addEventListener('resize', scheduleMelogicViewportUpdate, { passive:true })
window.visualViewport?.addEventListener('scroll', scheduleMelogicViewportUpdate, { passive:true })
window.addEventListener('orientationchange', () => {
  scheduleMelogicViewportUpdate()
  setTimeout(scheduleMelogicViewportUpdate, 250)
  setTimeout(scheduleMelogicViewportUpdate, 700)
}, { passive:true })
window.addEventListener('resize', scheduleMelogicViewportUpdate, { passive:true })
document.addEventListener('focusin', scheduleMelogicViewportUpdate)
document.addEventListener('focusout', () => setTimeout(scheduleMelogicViewportUpdate, 80))
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    scheduleMelogicViewportUpdate()
    setTimeout(scheduleMelogicViewportUpdate, 250)
  }
})
window.addEventListener('pageshow', () => {
  scheduleMelogicViewportUpdate()
  setTimeout(scheduleMelogicViewportUpdate, 250)
})
scheduleMelogicViewportUpdate()

// melogic-mobile-unified-runtime-v6
const MOBILE_CHUNK_RECOVERY_KEY = 'melogic:mobile-chunk-recovery'
const mobileRuntimeUnsafeToReload = () =>
  document.documentElement.dataset.preventPwaReload === 'true' ||
  document.body?.dataset.preventPwaReload === 'true' ||
  Boolean(document.querySelector('[data-unsaved-changes="true"],[data-recording="true"],[data-exporting="true"],[data-uploading="true"],[data-checkout-active="true"]'))

function recoverFromStaleDynamicChunk(event) {
  event?.preventDefault?.()
  const now = Date.now()
  const previous = Number(sessionStorage.getItem(MOBILE_CHUNK_RECOVERY_KEY) || 0)
  if (now - previous < 30000) return
  if (mobileRuntimeUnsafeToReload()) {
    console.warn('[Melogic PWA] A newer application build is available; reload deferred until active work is safe.')
    return
  }
  sessionStorage.setItem(MOBILE_CHUNK_RECOVERY_KEY, String(now))
  const url = new URL(location.href)
  url.searchParams.set('__melogic_chunk_recovery', String(now))
  location.replace(url.href)
}

window.addEventListener('vite:preloadError', recoverFromStaleDynamicChunk)

// melogic-mobile-spa-foundation-v1
initMobileSpaFoundation()

// melogic-mobile-spa-shell-v2
initPersistentMobileSpaShell()

// melogic-mobile-spa-final-v8
initMobileSpaLifecycleAudit()

// melogic-mobile-unified-runtime-v1
// melogic-deterministic-mobile-navigation-v1
// Unified cross-document runtime disabled until entry modules are lifecycle-pure.
// initMobileAppRuntime()

const desktop = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__ || /Tauri/i.test(navigator.userAgent))
const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
let installEvent = null

function refreshInstallControls() {
  document.querySelectorAll('[data-install-melogic]').forEach(button => {
    button.hidden = desktop || standalone() || (!installEvent && !ios)
  })
}

if (!desktop) {
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    installEvent = event
    refreshInstallControls()
  })
  window.addEventListener('appinstalled', () => { installEvent = null; refreshInstallControls() })
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-install-melogic]')
    if (!button) return
    if (installEvent) {
      const prompt = installEvent
      installEvent = null
      refreshInstallControls()
      try { await prompt.prompt(); await prompt.userChoice } catch (error) { console.warn('[Melogic install]', error) }
    } else if (ios && !standalone()) {
      const dialog = document.createElement('dialog')
      dialog.className = 'melogic-install-dialog'
      dialog.setAttribute('aria-labelledby', 'melogic-install-title')
      dialog.innerHTML = '<h2 id="melogic-install-title">Install Melogic</h2><p>Open Melogic in Safari, tap Share, then Add to Home Screen.</p><p>Projects and media still need an internet connection.</p><form method="dialog"><button autofocus>Done</button></form>'
      dialog.addEventListener('close', () => { dialog.remove(); button.focus() }, { once: true })
      document.body.append(dialog)
      dialog.showModal()
    }
  })
  // The shared navigation is rendered again when auth/account state changes.
  const observer = new MutationObserver(records => {
    if (records.some(record => Array.from(record.addedNodes).some(node =>
      node.nodeType === 1 && (node.matches('[data-install-melogic]') || node.querySelector('[data-install-melogic]'))
    ))) refreshInstallControls()
  })
  observer.observe(document.documentElement, { childList: true, subtree: true })
  refreshInstallControls()
  if (import.meta.env.PROD && window.isSecureContext && 'serviceWorker' in navigator) {
    /* melogic-pwa-release-integrity-v3 */
    let registration = null
    let updateCheck = null
    let buildCheck = null
    let pendingBuild = null
    let retryTimer = null
    const BUILD_URL = '/melogic-build.json'
    const CHECK_INTERVAL_MS = 60000
    const RELEASE_FETCH_TIMEOUT_MS = 8000 // melogic-mobile-spa-final-v8

    const unsafeToReload = mobileRuntimeUnsafeToReload

    const reloadForBuild = build => {
      if (!build) return
      pendingBuild = build
      if (unsafeToReload()) {
        if (!retryTimer) retryTimer = setTimeout(() => { retryTimer = null; reloadForBuild(pendingBuild) }, 5000)
        return
      }
      const key = `melogic-pwa-reloaded:${build}`
      if (sessionStorage.getItem(key) === '1') return
      sessionStorage.setItem(key, '1')
      sessionStorage.setItem('melogic-pwa-running-build', build)
      const url = new URL(location.href)
      url.searchParams.set('__melogic_release', build)
      location.replace(url.href)
    }

    const fetchServerBuild = async () => {
      if (!navigator.onLine || buildCheck) return buildCheck
      buildCheck = (async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null
        const timeout = controller ? setTimeout(() => controller.abort(), RELEASE_FETCH_TIMEOUT_MS) : 0
        let response
        try {
          response = await fetch(`${BUILD_URL}?t=${Date.now()}`, {
            cache: 'no-store',
            credentials: 'same-origin',
            signal: controller?.signal,
            headers: { 'Cache-Control': 'no-cache' }
          })
        } finally {
          if (timeout) clearTimeout(timeout)
        }
        if (!response.ok) throw new Error(`build manifest HTTP ${response.status}`)
        const build = String((await response.json())?.build || '').trim()
        if (!build) throw new Error('build manifest missing build')
        const running = sessionStorage.getItem('melogic-pwa-running-build')
        if (!running) { sessionStorage.setItem('melogic-pwa-running-build', build); return build }
        if (build !== running) {
          pendingBuild = build
          try { await registration?.update() } catch {}
          const worker = registration?.waiting || registration?.installing
          if (worker) worker.postMessage({ type: 'MELOGIC_SKIP_WAITING' })
          setTimeout(() => reloadForBuild(build), 1200)
        }
        return build
      })().catch(error => { console.warn('[Melogic PWA] Release check failed.', error); return null })
        .finally(() => { buildCheck = null })
      return buildCheck
    }

    const checkForUpdate = async () => {
      if (!registration || !navigator.onLine || updateCheck) return updateCheck
      updateCheck = registration.update().catch(error => console.warn('[Melogic PWA] Worker update failed.', error))
        .finally(() => { updateCheck = null })
      await updateCheck
      return fetchServerBuild()
    }

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type === 'MELOGIC_PWA_UPDATED') reloadForBuild(String(event.data.build || pendingBuild || ''))
    })
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (pendingBuild) reloadForBuild(pendingBuild)
      else void fetchServerBuild()
    })

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/melogic-push-sw.js', { scope: '/', updateViaCache: 'none' })
        if (registration.waiting) registration.waiting.postMessage({ type: 'MELOGIC_SKIP_WAITING' })
        await checkForUpdate()
      } catch (error) {
        console.warn('[Melogic offline] Registration failed; online browsing remains available.', error)
        await fetchServerBuild()
      }
    }

    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void checkForUpdate() })
    window.addEventListener('pageshow', () => void checkForUpdate())
    window.addEventListener('online', () => void checkForUpdate())
    const releaseInterval = setInterval(() => {
      if (document.visibilityState === 'visible') void fetchServerBuild()
    }, CHECK_INTERVAL_MS)
    window.addEventListener('pagehide', event => {
      if (!event.persisted) {
        clearInterval(releaseInterval)
        if (retryTimer) clearTimeout(retryTimer)
        observer.disconnect()
      }
    })
    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })
  }}
