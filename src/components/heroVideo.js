import { getStorageAssetUrl } from '../firebase/storageAssets'

const warningCache = new Set()

function warnOnce(key, message) {
  if (warningCache.has(key)) return
  warningCache.add(key)
  console.warn(message)
}

export async function attachHeroVideo(videoElement, { webmPath, mp4Path, warningKey }) {
  if (!videoElement) return false

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reducedMotion) {
    videoElement.remove()
    return true
  }

  const [webmUrl, mp4Url] = await Promise.all([
    getStorageAssetUrl(webmPath, { warnOnFail: false }),
    getStorageAssetUrl(mp4Path, { warnOnFail: false })
  ])

  if (!webmUrl && !mp4Url) {
    warnOnce(warningKey, `[hero-video] ${warningKey} video unavailable; using static background.`)
    videoElement.remove()
    return false
  }

  if (webmUrl) {
    const webmSource = document.createElement('source')
    webmSource.src = webmUrl
    webmSource.type = 'video/webm'
    videoElement.append(webmSource)
  }

  if (mp4Url) {
    const mp4Source = document.createElement('source')
    mp4Source.src = mp4Url
    mp4Source.type = 'video/mp4'
    videoElement.append(mp4Source)
  }

  const readiness = await new Promise((resolve) => {
    let settled = false
    const finish = (isReady) => {
      if (settled) return
      settled = true
      videoElement.removeEventListener('loadeddata', onReady)
      videoElement.removeEventListener('canplay', onReady)
      videoElement.removeEventListener('canplaythrough', onReady)
      videoElement.removeEventListener('error', onError)
      if (!isReady) {
        warnOnce(warningKey, `[hero-video] ${warningKey} video failed; using static background.`)
        videoElement.remove()
      }
      resolve(isReady)
    }

    const onReady = () => finish(true)
    const onError = () => finish(false)

    videoElement.addEventListener('loadeddata', onReady, { once: true })
    videoElement.addEventListener('canplay', onReady, { once: true })
    videoElement.addEventListener('canplaythrough', onReady, { once: true })
    videoElement.addEventListener('error', onError, { once: true })

    videoElement.load()
  })

  const playPromise = videoElement.play()
  if (playPromise && typeof playPromise.catch === 'function') {
    playPromise.catch(() => {})
  }

  return readiness
}
