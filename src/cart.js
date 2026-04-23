import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'cart' === 'community' ? 'community' : 'cart',
  pageId: 'cart',
  eyebrow: 'Melogic Cart',
  title: 'Cart',
  description: 'Melogic cart systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#cart-hero-video'), {
  webmPath: 'assets/site/backgrounds/cart-hero.webm',
  mp4Path: 'assets/site/backgrounds/cart-hero.mp4',
  warningKey: 'cart'
})
