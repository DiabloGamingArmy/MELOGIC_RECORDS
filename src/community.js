import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'community' === 'community' ? 'community' : 'community',
  pageId: 'community',
  eyebrow: 'Melogic Community',
  title: 'Community',
  description: 'Melogic community systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#community-hero-video'), {
  webmPath: 'assets/site/backgrounds/community-hero.webm',
  mp4Path: 'assets/site/backgrounds/community-hero.mp4',
  warningKey: 'community'
})
