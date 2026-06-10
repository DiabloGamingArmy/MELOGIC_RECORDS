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
          loop
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
  const BASE_PLAYBACK_RATE = 0.45
  const MAX_PLAYBACK_RATE = 2.5
  const SCROLL_SPEED_MULTIPLIER = 8
  const RATE_EASE = 0.08
  const VELOCITY_DECAY = 0.88
  const SOFT_SYNC_THRESHOLD_SECONDS = 1.2
  const scrollPixelsPerSecond = 850
  const minScrollLength = 3200
  const maxScrollLength = 10000
  let duration = 0
  let sectionTop = 0
  let scrollDistance = 1
  let raf = 0
  let lastFrameTime = performance.now()
  let lastScrollTime = performance.now()
  let lastScrollY = window.scrollY
  let lastProgress = 0
  let scrollVelocity = 0
  let currentRate = BASE_PLAYBACK_RATE
  let pendingSoftSync = false
  let playPromise = null
  let failed = false

  const showFallback = () => {
    failed = true
    if (raf) window.cancelAnimationFrame(raf)
    raf = 0
    video.remove()
    if (fallback) fallback.hidden = false
  }

  const setPlaybackFallback = (visible) => {
    if (fallback) fallback.hidden = !visible
  }

  const measure = () => {
    sectionTop = section.offsetTop
    scrollDistance = Math.max(1, section.offsetHeight - window.innerHeight)
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

  const startVideo = () => {
    if (failed || playPromise || !video.paused || video.ended) return
    playPromise = video.play()
      .then(() => setPlaybackFallback(false))
      .catch(() => setPlaybackFallback(true))
      .finally(() => {
        playPromise = null
      })
  }

  const isSectionActive = () => (
    window.scrollY >= sectionTop - 1
    && window.scrollY <= sectionTop + scrollDistance + 1
  )

  const softSyncIfNeeded = (progress) => {
    if (!pendingSoftSync || !duration || video.readyState < 1) return
    pendingSoftSync = false
    const expectedTime = progress * duration
    if (Math.abs(expectedTime - video.currentTime) <= SOFT_SYNC_THRESHOLD_SECONDS) return
    try {
      video.currentTime = expectedTime
    } catch {
      // Some mobile browsers temporarily reject seeks while buffering.
    }
  }

  const animateVideoRate = (now) => {
    if (failed) return
    const elapsed = Math.min(64, Math.max(1, now - lastFrameTime))
    lastFrameTime = now
    const progress = getProgress()
    updateHint(progress)

    if (Math.abs(progress - lastProgress) > 0.12) pendingSoftSync = true
    lastProgress = progress

    if (duration && isSectionActive()) {
      startVideo()
      if (!reducedMotion) {
        const boost = Math.min(
          scrollVelocity * SCROLL_SPEED_MULTIPLIER,
          MAX_PLAYBACK_RATE - BASE_PLAYBACK_RATE
        )
        const targetRate = BASE_PLAYBACK_RATE + boost
        const ease = 1 - Math.pow(1 - RATE_EASE, elapsed / 16.67)
        currentRate += (targetRate - currentRate) * ease
        if (Math.abs(video.playbackRate - currentRate) > 0.01) {
          video.playbackRate = currentRate
        }
        scrollVelocity *= Math.pow(VELOCITY_DECAY, elapsed / 16.67)
        softSyncIfNeeded(progress)
      }
    } else if (!video.paused) {
      video.pause()
    }

    raf = window.requestAnimationFrame(animateVideoRate)
  }

  const recordScrollVelocity = () => {
    const now = performance.now()
    const nextScrollY = window.scrollY
    const deltaY = nextScrollY - lastScrollY
    const elapsed = Math.max(16, now - lastScrollTime)
    scrollVelocity = Math.max(scrollVelocity, Math.abs(deltaY / elapsed))
    if (Math.abs(deltaY) > Math.max(window.innerHeight * 0.75, scrollDistance * 0.08)) {
      pendingSoftSync = true
    }
    lastScrollY = nextScrollY
    lastScrollTime = now
    if (isSectionActive()) startVideo()
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
  video.defaultPlaybackRate = BASE_PLAYBACK_RATE
  video.playbackRate = BASE_PLAYBACK_RATE
  video.addEventListener('error', showFallback, { once: true })
  video.addEventListener('loadedmetadata', () => {
    duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration > 0) {
      const scrollLength = Math.min(maxScrollLength, Math.max(minScrollLength, Math.round(duration * scrollPixelsPerSecond)))
      section.style.setProperty('--home-scroll-length', `${scrollLength}px`)
    }
    measure()
    lastProgress = getProgress()
    updateHint(lastProgress)
    if (reducedMotion) {
      currentRate = BASE_PLAYBACK_RATE
      video.playbackRate = BASE_PLAYBACK_RATE
      if (hint) {
        hint.style.opacity = '0'
        hint.style.pointerEvents = 'none'
      }
    } else if (lastProgress > 0.08) {
      pendingSoftSync = true
    }
    if (!raf) raf = window.requestAnimationFrame(animateVideoRate)
  }, { once: true })
  window.addEventListener('scroll', recordScrollVelocity, { passive: true })
  window.addEventListener('resize', () => {
    measure()
  }, { passive: true })
  document.addEventListener('visibilitychange', () => {
    lastFrameTime = performance.now()
    lastScrollTime = lastFrameTime
    lastScrollY = window.scrollY
    if (document.hidden) video.pause()
    else if (isSectionActive()) startVideo()
  })
  measure()
  video.load()
  return true
}

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initHeroBackgroundVideo()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
initHomeScrollCinematicVideo()
