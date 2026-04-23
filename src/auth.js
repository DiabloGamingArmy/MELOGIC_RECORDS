import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'

mountStandardPage({
  currentPage: 'auth' === 'community' ? 'community' : 'auth',
  pageId: 'auth',
  eyebrow: 'Melogic Auth',
  title: 'Auth',
  description: 'Melogic auth systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

initShellChrome()

attachHeroVideo(document.querySelector('#auth-hero-video'), {
  webmPath: 'assets/site/backgrounds/auth-hero.webm',
  mp4Path: 'assets/site/backgrounds/auth-hero.mp4',
  warningKey: 'auth'
})
