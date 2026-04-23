import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'faq' === 'community' ? 'community' : 'faq',
  pageId: 'faq',
  eyebrow: 'Melogic Faq',
  title: 'Faq',
  description: 'Melogic faq systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#faq-hero-video'), {
  webmPath: 'assets/site/backgrounds/faq-hero.webm',
  mp4Path: 'assets/site/backgrounds/faq-hero.mp4',
  warningKey: 'faq'
})
