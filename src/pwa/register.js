import './pwa.css'

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
    /* melogic-pwa-auto-update-v1
       Check the worker on every app launch/resume. A newly installed worker
       claims clients and sends MELOGIC_PWA_UPDATED. Reload at most once per
       build, and never while the document has unsaved/editing guards. */
    let registration = null
    let updateCheck = null

    const pageLooksUnsafeToReload = () =>
      document.documentElement.dataset.preventPwaReload === 'true' ||
      document.body?.dataset.preventPwaReload === 'true' ||
      Boolean(document.querySelector(
        '[data-unsaved-changes="true"], [data-recording="true"], [data-exporting="true"], [data-uploading="true"]'
      ))

    const reloadForBuild = build => {
      const key = `melogic-pwa-reloaded:${build || 'unknown'}`
      if (sessionStorage.getItem(key) === '1') return
      if (pageLooksUnsafeToReload()) {
        console.info('[Melogic PWA] Update ready; reload deferred because active work is in progress.')
        return
      }
      sessionStorage.setItem(key, '1')
      window.location.reload()
    }

    navigator.serviceWorker.addEventListener('message', event => {
      if (event.data?.type !== 'MELOGIC_PWA_UPDATED') return
      reloadForBuild(String(event.data.build || 'unknown'))
    })

    const checkForUpdate = async () => {
      if (!registration || !navigator.onLine || updateCheck) return updateCheck
      updateCheck = registration.update()
        .catch(error => console.warn('[Melogic PWA] Update check failed; current app remains usable.', error))
        .finally(() => { updateCheck = null })
      return updateCheck
    }

    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/melogic-push-sw.js', {
          scope: '/',
          updateViaCache: 'none'
        })
        await checkForUpdate()
      } catch (error) {
        console.warn('[Melogic offline] Registration failed; online browsing remains available.', error)
      }
    }

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkForUpdate()
    })
    window.addEventListener('online', () => void checkForUpdate())

    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })
  }
}
