import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'faq',
  pageId: 'faq',
  eyebrow: 'Melogic Faq',
  title: 'Faq',
  description: 'Melogic faq systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('faq')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#faq-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'faq'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
