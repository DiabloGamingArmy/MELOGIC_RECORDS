const RETRY_DELAYS_MS = [350, 1_000, 2_500]
const imageState = new WeakMap()
const waitingForOnline = new Set()
let installed = false

function retryUrl(source, attempt) {
  try {
    const url = new URL(source, globalThis.location?.href)
    if (!/^https?:$/.test(url.protocol)) return source
    url.searchParams.set('__melogic_image_retry', String(attempt))
    return url.href
  } catch {
    return source
  }
}

function baseImageUrl(source = '') {
  try {
    const url = new URL(source, globalThis.location?.href)
    url.searchParams.delete('__melogic_image_retry')
    return url.href
  } catch {
    return source
  }
}

function dispatchExhausted(image) {
  image.dispatchEvent(new CustomEvent('melogic:image-exhausted', { bubbles: false }))
}

function retryImage(image) {
  if (!image?.isConnected || image.dataset.imageMissing === 'true') {
    if (image?.dataset.imageMissing === 'true') dispatchExhausted(image)
    return
  }
  const state = imageState.get(image) || {
    source: baseImageUrl(image.currentSrc || image.src),
    attempts: 0,
    lastGood: ''
  }
  const currentSource = baseImageUrl(image.currentSrc || image.src)
  if (currentSource && currentSource !== state.lastGood) state.source = currentSource
  if (!state.source || state.source.startsWith('data:') || state.source.startsWith('blob:')) return
  if (state.attempts >= RETRY_DELAYS_MS.length) {
    if (!navigator.onLine && !state.onlineRetryUsed) waitingForOnline.add(image)
    else {
      if (state.lastGood && image.src !== state.lastGood) image.src = state.lastGood
      dispatchExhausted(image)
    }
    imageState.set(image, state)
    return
  }
  const attempt = state.attempts + 1
  state.attempts = attempt
  clearTimeout(state.timer)
  state.timer = setTimeout(() => {
    if (!image.isConnected) return
    image.src = retryUrl(state.source, attempt)
  }, RETRY_DELAYS_MS[attempt - 1])
  imageState.set(image, state)
}

export function installRemoteImageReliability() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('load', (event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement) || !image.matches('[data-reliable-image]')) return
    const state = imageState.get(image) || { source: baseImageUrl(image.currentSrc || image.src), attempts: 0, lastGood: '' }
    state.lastGood = state.source || baseImageUrl(image.currentSrc || image.src) || state.lastGood
    state.attempts = 0
    clearTimeout(state.timer)
    waitingForOnline.delete(image)
    imageState.set(image, state)
  }, true)
  document.addEventListener('error', (event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement) || !image.matches('[data-reliable-image]')) return
    retryImage(image)
  }, true)
  globalThis.addEventListener?.('online', () => {
    for (const image of waitingForOnline) {
      waitingForOnline.delete(image)
      const state = imageState.get(image)
      if (!state || state.onlineRetryUsed) continue
      state.onlineRetryUsed = true
      state.attempts = Math.max(0, RETRY_DELAYS_MS.length - 1)
      imageState.set(image, state)
      retryImage(image)
    }
  })
}

installRemoteImageReliability()
