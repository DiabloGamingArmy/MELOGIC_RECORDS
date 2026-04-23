import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'live',
  pageId: 'live',
  eyebrow: 'Melogic Live',
  title: 'Live',
  description: 'Melogic live systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

const heroPaths = getPageHeroVideoPaths('live')
if (heroPaths) {
  attachHeroVideo(document.querySelector('#live-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'live'
  })
}
