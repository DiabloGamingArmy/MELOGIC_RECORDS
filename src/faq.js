import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'faq',
  pageId: 'faq',
  eyebrow: 'Melogic Faq',
  title: 'Faq',
  description: 'Melogic faq systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

const heroPaths = getPageHeroVideoPaths('faq')
if (heroPaths) {
  attachHeroVideo(document.querySelector('#faq-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'faq'
  })
}
