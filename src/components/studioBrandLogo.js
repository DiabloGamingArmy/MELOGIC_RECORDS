import { getStorageAssetUrl } from '../firebase/storageAssets'

export async function initStudioBrandLogo() {
  const logos = Array.from(document.querySelectorAll('[data-studio-logo]'))
  if (!logos.length) return
  const primary = await getStorageAssetUrl('assets/brand/melogic-logo-mark-glow.png', { warnOnFail: false })
  const secondary = await getStorageAssetUrl('assets/brand/melogic-logo-mark-white-transparent.png', { warnOnFail: false })
  const candidates = [primary, secondary, '/assets/brand/melogic-logo-mark-glow.png'].filter(Boolean)

  const load = (url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })

  let resolved = null
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await load(url)) { resolved = url; break }
  }

  logos.forEach((logo) => {
    const fallback = logo.parentElement?.querySelector('[data-studio-logo-fallback]')
    if (resolved) {
      logo.src = resolved
      logo.hidden = false
      fallback?.setAttribute('hidden', 'hidden')
    } else {
      logo.hidden = true
      fallback?.removeAttribute('hidden')
      logo.parentElement?.classList.add('is-logo-missing')
    }
  })
}
