import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'support' === 'community' ? 'community' : 'support',
  pageId: 'support',
  eyebrow: 'Melogic Support',
  title: 'Support',
  description: 'Melogic support systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#support-hero-video'), {
  webmPath: 'assets/site/backgrounds/support-hero.webm',
  mp4Path: 'assets/site/backgrounds/support-hero.mp4',
  warningKey: 'support'
})
