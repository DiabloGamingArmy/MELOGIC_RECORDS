import { getStorageAssetUrl } from '../firebase/storageAssets'

export function syncNavOffset() {
  const nav = document.querySelector('.nav-shell')
  if (!nav) return
  document.documentElement.style.setProperty('--nav-offset', `${nav.offsetHeight}px`)
}

export async function initNavBrandLogo() {
  const brandLogo = document.querySelector('[data-brand-logo]')
  if (!brandLogo) return false

  const logoUrl = await getStorageAssetUrl('assets/brand/melogic-logo-mark-glow.png', { warnOnFail: false })
  if (!logoUrl) {
    brandLogo.remove()
    return false
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      if (!ok) brandLogo.remove()
      resolve(ok)
    }

    brandLogo.addEventListener(
      'load',
      () => {
        brandLogo.dataset.loaded = 'true'
        finish(true)
      },
      { once: true }
    )

    brandLogo.addEventListener('error', () => finish(false), { once: true })
    brandLogo.src = logoUrl
  })
}

export function initShellChrome() {
  syncNavOffset()
  window.addEventListener('resize', syncNavOffset, { passive: true })
  return initNavBrandLogo()
}
