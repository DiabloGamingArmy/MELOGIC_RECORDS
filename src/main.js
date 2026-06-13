import './styles/base.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
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

    <section class="home-video-showcase" aria-label="Melogic Studio cinematic preview">
      <div class="home-video-showcase-inner">
        <video
          class="home-video-showcase-video"
          data-home-video-showcase
          muted
          loop
          autoplay
          playsinline
          preload="auto"
        ></video>
        <p class="home-video-showcase-fallback" data-home-video-showcase-fallback hidden>Studio preview is being prepared.</p>
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

async function initHomeVideoShowcase() {
  const video = document.querySelector('[data-home-video-showcase]')
  const fallback = document.querySelector('[data-home-video-showcase-fallback]')
  if (!video) return false
  const showFallback = () => {
    video.remove()
    if (fallback) fallback.hidden = false
  }

  const url = await getStorageAssetUrl(HOME_SCROLL_BANNER_VIDEO_PATH, {
    warnOnFail: false,
    scopeKey: 'home-video-showcase',
    type: 'video'
  })
  if (!url) {
    showFallback()
    return false
  }

  // For true 60fps playback, upload a 60fps MP4 at the configured Storage path.
  video.src = url
  video.addEventListener('error', showFallback, { once: true })
  video.load()
  video.play().catch(() => {
    // Muted autoplay may still be blocked by an explicit browser preference.
  })
  return true
}

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initHeroBackgroundVideo()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
initHomeVideoShowcase()
