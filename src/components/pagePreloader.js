export function renderPagePreloaderMarkup() {
  return `
    <div class="page-preloader" id="page-preloader" role="status" aria-live="polite" aria-label="Loading page">
      <div class="preloader-core">
        <span class="preloader-ring" aria-hidden="true"></span>
        <p>Loading</p>
      </div>
    </div>
  `
}

export function initPagePreloader(promises = [], options = {}) {
  const preloader = document.querySelector(options.selector || '#page-preloader')
  if (!preloader) return

  const fallbackMs = Number(options.fallbackMs || 3800)
  const fadeDurationMs = Number(options.fadeDurationMs || 500)
  const waitFor = Array.isArray(promises) ? promises.filter(Boolean) : []
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
