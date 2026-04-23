import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'product' === 'community' ? 'community' : 'product',
  pageId: 'product',
  eyebrow: 'Melogic Product',
  title: 'Product',
  description: 'Melogic product systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#product-hero-video'), {
  webmPath: 'assets/site/backgrounds/product-hero.webm',
  mp4Path: 'assets/site/backgrounds/product-hero.mp4',
  warningKey: 'product'
})
