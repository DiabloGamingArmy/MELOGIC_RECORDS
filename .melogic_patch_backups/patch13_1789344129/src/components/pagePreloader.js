import fallbackBrandLogoUrl from '../assets/brand/melogic-logo-mark-white-transparent.png'
import { getStorageAssetUrl } from '../firebase/storageAssets'

const BRAND_LOADER_LOGO_PATH = 'assets/brand/melogic-logo-mark-glow.png'
let brandLoaderLogoPromise = null

function cssUrl(value = '') {
  return `url("${String(value).replace(/"/g, '\\"')}")`
}

function preloadImage(url = '') {
  return new Promise((resolve, reject) => {
    if (!url || typeof Image === 'undefined') {
      reject(new Error('Image preload unavailable.'))
      return
    }
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(url)
    image.onerror = () => reject(new Error('Image preload failed.'))
    image.src = url
  })
}

export function renderPagePreloaderMarkup() {
  return `
    <div class="page-preloader" id="page-preloader" role="status" aria-live="polite" aria-label="Preparing Melogic Records">
      <div class="preloader-core">
        <div class="brand-loader-mark" style="--brand-loader-mask: ${cssUrl(fallbackBrandLogoUrl)}">
          <span class="brand-loader-fallback" aria-hidden="true">M</span>
          <img class="brand-loader-logo" src="${fallbackBrandLogoUrl}" alt="" aria-hidden="true" decoding="async" />
        </div>
      </div>
    </div>
  `
}

export async function loadBrandLoaderLogo(preloader = document.querySelector('#page-preloader')) {
  if (!preloader) return fallbackBrandLogoUrl
  const logo = preloader.querySelector('.brand-loader-logo')
  const mark = preloader.querySelector('.brand-loader-mark')
  if (!logo || !mark) return fallbackBrandLogoUrl

  logo.addEventListener('error', () => {
    preloader.classList.add('is-text-fallback')
  }, { once: true })

  if (!brandLoaderLogoPromise) {
    brandLoaderLogoPromise = getStorageAssetUrl(BRAND_LOADER_LOGO_PATH, {
      scopeKey: 'global-brand-loader',
      type: 'brand-loader',
      warnOnFail: false
    })
      .then((url) => url ? preloadImage(url) : '')
      .catch(() => '')
  }

  const storageLogoUrl = await brandLoaderLogoPromise
  if (storageLogoUrl && preloader.isConnected) {
    logo.src = storageLogoUrl
    mark.style.setProperty('--brand-loader-mask', cssUrl(storageLogoUrl))
    preloader.classList.remove('is-text-fallback')
    return storageLogoUrl
  }

  return fallbackBrandLogoUrl
}

export function initPagePreloader(promises = [], options = {}) {
  const preloader = document.querySelector(options.selector || '#page-preloader')
  if (!preloader) return

  const fallbackMs = Number(options.fallbackMs || 3800)
  const fadeDurationMs = Number(options.fadeDurationMs || 200)
  const waitFor = Array.isArray(promises) ? promises.filter(Boolean) : []
  waitFor.push(loadBrandLoaderLogo(preloader))
  let hidden = false

  const hidePreloader = () => {
    if (hidden) return
    hidden = true
    preloader.classList.add('is-hidden')
    window.setTimeout(() => preloader.remove(), fadeDurationMs + 40)
  }

  Promise.allSettled(waitFor).then(hidePreloader)
  window.setTimeout(hidePreloader, fallbackMs)
}

export function createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise } = {}) {
  const promises = [logoReadyPromise]
  if (heroReadyPromise) promises.push(heroReadyPromise)
  initPagePreloader(promises)
}
