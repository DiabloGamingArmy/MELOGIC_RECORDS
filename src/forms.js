import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'forms' === 'community' ? 'community' : 'forms',
  pageId: 'forms',
  eyebrow: 'Melogic Forms',
  title: 'Forms',
  description: 'Melogic forms systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#forms-hero-video'), {
  webmPath: 'assets/site/backgrounds/forms-hero.webm',
  mp4Path: 'assets/site/backgrounds/forms-hero.mp4',
  warningKey: 'forms'
})
