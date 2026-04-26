import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'live',
  pageId: 'live',
  eyebrow: 'Melogic Live',
  title: 'Live',
  description: 'Melogic live systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('live')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#live-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'live'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
