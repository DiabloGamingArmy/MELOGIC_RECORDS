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
    const register = () => navigator.serviceWorker.register('/melogic-push-sw.js', { scope: '/', updateViaCache: 'none' })
      .catch(error => console.warn('[Melogic offline] Registration failed; online browsing remains available.', error))
    if (document.readyState === 'complete') void register()
    else window.addEventListener('load', register, { once: true })
  }
}
