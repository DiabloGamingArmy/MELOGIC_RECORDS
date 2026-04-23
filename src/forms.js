import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'forms',
  pageId: 'forms',
  eyebrow: 'Melogic Forms',
  title: 'Forms',
  description: 'Melogic forms systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

const heroPaths = getPageHeroVideoPaths('forms')
if (heroPaths) {
  attachHeroVideo(document.querySelector('#forms-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'forms'
  })
}
