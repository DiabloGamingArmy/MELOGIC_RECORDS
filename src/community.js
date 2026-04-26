import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'community',
  pageId: 'community',
  eyebrow: 'Melogic Community',
  title: 'Community',
  description: 'Melogic community systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('community')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#community-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'community'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
