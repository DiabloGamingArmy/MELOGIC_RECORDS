import { getStorageAssetUrl } from '../firebase/storageAssets'

async function initStudioAppIcons() {
  const icons = Array.from(document.querySelectorAll('[data-studio-app-icon]'))
  await Promise.all(icons.map(async (icon) => {
    const storagePath = String(icon.dataset.studioAppIconPath || '').trim()
    if (!storagePath) return
    const fallback = icon.parentElement?.querySelector('[data-studio-app-icon-fallback]')
    const resolved = await getStorageAssetUrl(storagePath, {
      warnOnFail: false,
      scopeKey: 'studio-app-icons',
      type: 'studio-app-icon'
    })
    if (!resolved) return
    icon.src = resolved
    icon.hidden = false
    fallback?.setAttribute('hidden', 'hidden')
  }))
}

export async function initStudioBrandLogo() {
  const logos = Array.from(document.querySelectorAll('[data-studio-logo]'))
  const appIconsPromise = initStudioAppIcons()
  if (!logos.length) {
    await appIconsPromise
    return
  }
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
  await appIconsPromise
}
