import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'support',
  pageId: 'support',
  eyebrow: 'Melogic Support',
  title: 'Support',
  description: 'Melogic support systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('support')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#support-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'support'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
