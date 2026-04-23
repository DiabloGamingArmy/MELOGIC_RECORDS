import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

mountStandardPage({
  currentPage: 'cart',
  pageId: 'cart',
  eyebrow: 'Melogic Cart',
  title: 'Cart',
  description: 'Melogic cart systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

const heroPaths = getPageHeroVideoPaths('cart')
if (heroPaths) {
  attachHeroVideo(document.querySelector('#cart-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'cart'
  })
}
