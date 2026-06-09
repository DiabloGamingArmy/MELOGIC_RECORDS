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

app.innerHTML = `
  ${renderPagePreloaderMarkup()}

  ${navShell({ currentPage: 'home' })}

  <main>
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

    <section class="section home-cinematic-section" aria-labelledby="home-cinematic-title">
      <div class="section-inner home-cinematic-shell">
        <div class="section-head">
          <p class="eyebrow">Melogic Studio</p>
          <h2 id="home-cinematic-title">A cinematic look inside the creative room.</h2>
          <p class="section-description">Preview the Studio experience where projects, instruments, and ideas start taking shape directly in your browser.</p>
        </div>
        <div class="home-cinematic-video-frame">
          <video
            class="home-cinematic-video"
            data-home-cinematic-video
            muted
            loop
            autoplay
            playsinline
            preload="metadata"
          ></video>
          <p class="home-cinematic-fallback" data-home-cinematic-fallback hidden>Studio preview is being prepared.</p>
        </div>
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

async function initHomeCinematicVideo() {
  const video = document.querySelector('[data-home-cinematic-video]')
  const fallback = document.querySelector('[data-home-cinematic-fallback]')
  if (!video) return false
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.remove()
    if (fallback) fallback.hidden = false
    return true
  }
  const url = await getStorageAssetUrl(HOME_SCROLL_BANNER_VIDEO_PATH, {
    warnOnFail: false,
    scopeKey: 'home-cinematic-video',
    type: 'video'
  })
  if (!url) {
    video.remove()
    if (fallback) fallback.hidden = false
    return false
  }
  video.src = url
  video.addEventListener('error', () => {
    video.remove()
    if (fallback) fallback.hidden = false
  }, { once: true })
  const playPromise = video.play()
  if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {})
  return true
}

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initHeroBackgroundVideo()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
initHomeCinematicVideo()
