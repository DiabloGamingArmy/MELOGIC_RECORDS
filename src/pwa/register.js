import './pwa.css'
import { initMobileSpaFoundation } from './mobileSpaRouter'
import { initPersistentMobileSpaShell } from './mobileSpaShell'

// melogic-mobile-spa-foundation-v1
initMobileSpaFoundation()

// melogic-mobile-spa-shell-v2
initPersistentMobileSpaShell()

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

    const unsafeToReload = () =>
      document.documentElement.dataset.preventPwaReload === 'true' ||
      document.body?.dataset.preventPwaReload === 'true' ||
      Boolean(document.querySelector('[data-unsaved-changes="true"],[data-recording="true"],[data-exporting="true"],[data-uploading="true"],[data-checkout-active="true"]'))

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
        const response = await fetch(`${BUILD_URL}?t=${Date.now()}`, {
          cache: 'no-store', credentials: 'same-origin', headers: { 'Cache-Control': 'no-cache' }
        })
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
    setInterval(() => { if (document.visibilityState === 'visible') void fetchServerBuild() }, CHECK_INTERVAL_MS)
    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })
  }}
