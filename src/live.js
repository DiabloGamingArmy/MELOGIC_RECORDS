import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'live' === 'community' ? 'community' : 'live',
  pageId: 'live',
  eyebrow: 'Melogic Live',
  title: 'Live',
  description: 'Melogic live systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#live-hero-video'), {
  webmPath: 'assets/site/backgrounds/live-hero.webm',
  mp4Path: 'assets/site/backgrounds/live-hero.mp4',
  warningKey: 'live'
})
