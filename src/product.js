import './styles/base.css'
import { mountStandardPage } from './components/standardPage'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

function getProductIdFromRoute() {
  const pathname = String(window.location.pathname || '')
  const params = new URLSearchParams(window.location.search)

  if (pathname.startsWith('/products/')) {
    const pathId = pathname.slice('/products/'.length).split('/')[0]
    if (pathId) return decodeURIComponent(pathId)
  }

  const queryId = String(params.get('id') || '').trim()
  if (queryId) return queryId

  return ''
}

const productId = getProductIdFromRoute()

mountStandardPage({
  currentPage: 'product',
  pageId: 'product',
  eyebrow: 'Melogic Product',
  title: productId ? `Loading product ${productId}...` : 'Product',
  description: productId
    ? `Product detail coming soon for ${productId}.`
    : 'Melogic product systems are being prepared with marketplace-grade tooling and creator-first workflows.'
})

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('product-detail')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#product-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'product'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
