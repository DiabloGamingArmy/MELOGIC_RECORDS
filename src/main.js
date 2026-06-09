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
        <div class="home-scroll-cinematic-overlay" aria-hidden="true">
          <p>Melogic Studio</p>
          <span>Scroll to explore the session.</span>
        </div>
        <p class="home-scroll-cinematic-fallback" data-home-scroll-cinematic-fallback hidden>Studio preview is being prepared.</p>
      </div>
    </section>

    <section class="section home-studio-cta">
      <div class="section-inner closing-inner">
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
  if (!section || !video) return false
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const scrollPixelsPerSecond = 850
  const minScrollLength = 3200
  const maxScrollLength = 10000
  let duration = 0
  let sectionTop = 0
  let scrollDistance = 1
  let raf = 0
  let lastTime = -1

  const showFallback = () => {
    video.remove()
    if (fallback) fallback.hidden = false
  }

  const measure = () => {
    sectionTop = section.offsetTop
    scrollDistance = Math.max(1, section.offsetHeight - window.innerHeight)
  }

  const updateVideoTime = () => {
    raf = 0
    if (!duration || reducedMotion) return
    const progress = Math.min(1, Math.max(0, (window.scrollY - sectionTop) / scrollDistance))
    const nextTime = progress * duration
    if (Math.abs(nextTime - lastTime) < 0.035) return
    try {
      video.currentTime = nextTime
      lastTime = nextTime
    } catch {
      // Some mobile browsers temporarily reject seeks while buffering.
    }
  }

  const requestScrub = () => {
    if (raf || reducedMotion) return
    raf = window.requestAnimationFrame(updateVideoTime)
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
  video.addEventListener('loadedmetadata', () => {
    duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration > 0) {
      const scrollLength = Math.min(maxScrollLength, Math.max(minScrollLength, Math.round(duration * scrollPixelsPerSecond)))
      section.style.setProperty('--home-scroll-length', `${scrollLength}px`)
    }
    video.pause()
    measure()
    if (!reducedMotion) requestScrub()
  }, { once: true })
  window.addEventListener('scroll', requestScrub, { passive: true })
  window.addEventListener('resize', () => {
    measure()
    requestScrub()
  }, { passive: true })
  measure()
  video.load()
  return true
}

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initHeroBackgroundVideo()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
initHomeScrollCinematicVideo()
