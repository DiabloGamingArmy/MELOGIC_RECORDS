import './styles/base.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import { getStorageAssetUrl } from './firebase/storageAssets'
import { ROUTES } from './utils/routes'
import { installLiveKitDebugTest } from './livekit/livekitDebugTest'

const app = document.querySelector('#app')
const HOME_SCROLL_BANNER_VIDEO_PATH = 'assets/site/home/backgrounds/scroll-banner.mp4'

installLiveKitDebugTest()
document.documentElement.classList.add('home-page-root')
document.body.classList.add('home-page-body')

app.innerHTML = `
  ${renderPagePreloaderMarkup()}

  ${navShell({ currentPage: 'home' })}

  <main class="home-main">
    <section class="hero" id="explore">
      <div class="hero-media" aria-hidden="true">
        <video
          id="hero-bg-video"
          class="hero-bg-video"
          muted
          loop
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <div class="hero-media-overlay"></div>
      </div>

      <div class="section-inner hero-inner">
        <div class="hero-copy">
          <h1>From Marketplace to Masterpiece...</h1>
          <p>
            Melogic Records builds tools, sample libraries, creator infrastructure, and collaborative
            spaces for artists across every genre shaping the next era of music.
          </p>
          <div class="hero-actions">
            <a class="button button-accent" href="${ROUTES.products}">Explore the Catalog</a>
            <a class="button button-muted" href="${ROUTES.support}">Connect with us</a>
          </div>
        </div>
      </div>
    </section>

    <section class="home-scroll-cinematic" data-home-scroll-cinematic aria-label="Melogic Studio cinematic preview">
      <div class="home-scroll-cinematic-sticky">
        <video
          class="home-scroll-cinematic-video"
          data-home-scroll-cinematic-video
          muted
          playsinline
          preload="metadata"
        ></video>
        <div class="home-scroll-hint" data-home-scroll-hint aria-hidden="true">
          <span>Scroll to see more</span>
        </div>
        <p class="home-scroll-cinematic-fallback" data-home-scroll-cinematic-fallback hidden>Studio preview is being prepared.</p>
      </div>
    </section>

    <section class="section home-studio-cta">
      <div class="section-inner closing-inner">
        <p class="home-studio-cta-eyebrow">Melogic Studio</p>
        <h2>Ready to dive in?</h2>
        <p>Step into Melogic Studio and start building directly in your browser.</p>
        <div class="hero-actions">
          <a class="button button-accent" href="${ROUTES.studio}">Open Studio</a>
        </div>
      </div>
    </section>
  </main>
`

async function initHeroBackgroundVideo() {
  const heroVideo = document.querySelector('#hero-bg-video')
  const heroPaths = getPageHeroVideoPaths('home')
  if (!heroPaths) return false
  return attachHeroVideo(heroVideo, {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'home'
  })
}

async function initHomeScrollCinematicVideo() {
  const section = document.querySelector('[data-home-scroll-cinematic]')
  const video = document.querySelector('[data-home-scroll-cinematic-video]')
  const fallback = document.querySelector('[data-home-scroll-cinematic-fallback]')
  const hint = document.querySelector('[data-home-scroll-hint]')
  if (!section || !video) return false
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const SEEK_EPSILON = 0.04
  const scrollPixelsPerSecond = 850
  const minScrollLength = 3200
  const maxScrollLength = 10000
  let duration = 0
  let sectionTop = 0
  let scrollDistance = 1
  let viewportHeight = window.innerHeight
  let raf = 0
  let lastAppliedTime = -1
  let pendingTime = null
  let isSeeking = false
  let failed = false

  const showFallback = () => {
    failed = true
    if (raf) window.cancelAnimationFrame(raf)
    raf = 0
    video.remove()
    if (fallback) fallback.hidden = false
  }

  const measure = () => {
    viewportHeight = window.innerHeight
    sectionTop = section.getBoundingClientRect().top + window.scrollY
    scrollDistance = Math.max(1, section.offsetHeight - viewportHeight)
  }

  const getProgress = () => Math.min(1, Math.max(0, (window.scrollY - sectionTop) / scrollDistance))

  const updateHint = (progress) => {
    if (hint) {
      const hintOpacity = Math.max(0, 1 - progress / 0.04)
      hint.style.opacity = hintOpacity.toFixed(3)
      hint.style.transform = `translate(-50%, calc(-50% + ${progress * -24}px))`
      hint.style.pointerEvents = hintOpacity > 0.05 ? 'auto' : 'none'
    }
  }

  const applyScrubTime = (nextTime) => {
    if (failed || reducedMotion || !duration || video.readyState < 1) return
    const maxTime = Math.max(0, duration - SEEK_EPSILON)
    const clampedTime = Math.min(maxTime, Math.max(0, nextTime))
    if (
      Math.abs(clampedTime - lastAppliedTime) < SEEK_EPSILON
      && Math.abs(clampedTime - video.currentTime) < SEEK_EPSILON
    ) return
    if (isSeeking || video.seeking) {
      pendingTime = clampedTime
      return
    }
    try {
      pendingTime = null
      lastAppliedTime = clampedTime
      video.currentTime = clampedTime
    } catch {
      // Some mobile browsers temporarily reject seeks while buffering.
      pendingTime = clampedTime
    }
  }

  const updateScrub = () => {
    raf = 0
    if (failed) return
    const progress = getProgress()
    updateHint(progress)
    if (!reducedMotion) applyScrubTime(progress * duration)
  }

  const scheduleScrub = () => {
    if (failed || raf) return
    raf = window.requestAnimationFrame(updateScrub)
  }

  const url = await getStorageAssetUrl(HOME_SCROLL_BANNER_VIDEO_PATH, {
    warnOnFail: false,
    scopeKey: 'home-scroll-cinematic-video',
    type: 'video'
  })
  if (!url) {
    showFallback()
    return false
  }

  video.src = url
  video.pause()
  video.addEventListener('error', showFallback, { once: true })
  video.addEventListener('seeking', () => {
    isSeeking = true
  })
  video.addEventListener('seeked', () => {
    isSeeking = false
    if (pendingTime === null) return
    const nextTime = pendingTime
    pendingTime = null
    if (Math.abs(nextTime - video.currentTime) >= SEEK_EPSILON) {
      applyScrubTime(nextTime)
    }
  })
  video.addEventListener('loadedmetadata', () => {
    duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration > 0) {
      const scrollLength = Math.min(maxScrollLength, Math.max(minScrollLength, Math.round(duration * scrollPixelsPerSecond)))
      section.style.setProperty('--home-scroll-length', `${scrollLength}px`)
    }
    measure()
    const progress = getProgress()
    updateHint(progress)
    if (reducedMotion) {
      // Reduced motion keeps the cinematic on a static first frame.
      video.pause()
      if (hint) {
        hint.style.opacity = '0'
        hint.style.pointerEvents = 'none'
      }
    } else {
      // For smooth MP4 scroll scrubbing, encode the source with frequent keyframes.
      // Normal keyframe spacing can cause Safari and other browsers to seek with visible jitter.
      applyScrubTime(progress * duration)
    }
  }, { once: true })
  window.addEventListener('scroll', scheduleScrub, { passive: true })
  window.addEventListener('resize', () => {
    measure()
    scheduleScrub()
  }, { passive: true })
  window.addEventListener('orientationchange', () => {
    measure()
    scheduleScrub()
  }, { passive: true })
  document.addEventListener('visibilitychange', () => {
    video.pause()
    if (!document.hidden) scheduleScrub()
  })
  measure()
  video.load()
  return true
}

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initHeroBackgroundVideo()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
initHomeScrollCinematicVideo()
