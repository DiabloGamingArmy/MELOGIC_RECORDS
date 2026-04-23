import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'community',
  pageId: 'community',
  eyebrow: 'Melogic Community',
  title: 'Community',
  description: 'Melogic community systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

const heroPaths = getPageHeroVideoPaths('community')
if (heroPaths) {
  attachHeroVideo(document.querySelector('#community-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'community'
  })
}
