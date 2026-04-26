import './styles/base.css'
import './styles/product.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { addToCart } from './data/cartService'
import { getProductById } from './data/productService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, publicProfileRoute } from './utils/routes'

const app = document.querySelector('#app')

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function parseProductIdFromLocation() {
  const pathname = String(window.location.pathname || '')
  const params = new URLSearchParams(window.location.search)

  if (pathname.startsWith('/products/')) {
    const rawSegment = pathname.slice('/products/'.length).split('/')[0]
    const decodedSegment = decodeURIComponent(rawSegment || '').trim()
    if (decodedSegment) {
      const markerIndex = decodedSegment.lastIndexOf('--')
      if (markerIndex >= 0) {
        const extracted = decodedSegment.slice(markerIndex + 2).trim()
        if (extracted) return extracted
      }
      return decodedSegment
    }
  }

  const queryId = String(params.get('id') || '').trim()
  return queryId || ''
}

function formatPrice(product) {
  if (product.isFree) return 'Free'
  if (product.priceLabel) return product.priceLabel
  const amount = Number(product.priceCents || 0) / 100
  return `$${amount.toFixed(2)}`
}

function normalizeChips(product) {
  return [
    product.productType,
    ...(product.categories || []),
    ...(product.genres || [])
  ].filter(Boolean).slice(0, 8)
}

function renderState(title, body, { actionLabel = 'Back to Products', actionHref = ROUTES.products } = {}) {
  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-detail-shell">
        <div class="section-inner">
          <article class="product-detail-card product-detail-empty">
            <h1>${escapeHtml(title)}</h1>
            <p>${escapeHtml(body)}</p>
            <a class="button button-muted" href="${actionHref}">${escapeHtml(actionLabel)}</a>
          </article>
        </div>
      </section>
    </main>
  `
  const logoReadyPromise = initShellChrome()
  createCriticalAssetPreloader({ logoReadyPromise })
}

function renderProduct(product, { isOwnerPreview = false } = {}) {
  const title = product.title || 'Untitled product'
  const cover = product.coverURL || product.thumbnailURL || ''
  const chips = normalizeChips(product)
  const creatorName = product.artistDisplayName || product.artistName || 'Creator'
  const creatorHandle = product.artistUsername ? `@${product.artistUsername}` : ''
  const creatorAvatar = product.artistAvatarURL || product.artistPhotoURL || ''
  const creatorHref = publicProfileRoute({ uid: product.artistId })

  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-detail-shell">
        <div class="section-inner product-detail-layout">
          <article class="product-detail-card product-detail-main">
            <p class="eyebrow">Melogic Product</p>
            <h1>${escapeHtml(title)}</h1>
            ${isOwnerPreview ? '<p class="product-owner-notice">Private owner preview · this product is not publicly listed yet.</p>' : ''}
            <div class="product-chip-row">
              ${chips.length ? chips.map((chip) => `<span class="product-chip">${escapeHtml(chip)}</span>`).join('') : '<span class="product-chip">Product</span>'}
            </div>

            <div class="product-creator-row">
              ${creatorAvatar ? `<img class="product-creator-avatar" src="${escapeHtml(creatorAvatar)}" alt="${escapeHtml(creatorName)} avatar" loading="lazy" />` : '<span class="product-creator-avatar product-creator-fallback">MR</span>'}
              <div>
                <strong>${escapeHtml(creatorName)}</strong>
                <p>${escapeHtml(creatorHandle)}</p>
              </div>
              <a class="button button-muted" href="${creatorHref}">View Creator</a>
            </div>

            <div class="product-action-row">
              <button type="button" class="button button-accent" data-add-product-cart>Add to Cart</button>
              <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
            </div>
          </article>

          <aside class="product-detail-card product-detail-media">
            ${cover
              ? `<img class="product-cover-art" src="${escapeHtml(cover)}" alt="${escapeHtml(title)} cover art" loading="eager" />`
              : '<div class="product-cover-fallback">No cover image uploaded.</div>'}
            <p class="product-price">${escapeHtml(formatPrice(product))}</p>
            <p class="product-short">${escapeHtml(product.shortDescription || 'No short description available.')}</p>
          </aside>
        </div>

        <div class="section-inner">
          <section class="product-detail-card">
            <h2>Description</h2>
            <p>${escapeHtml(product.description || product.shortDescription || 'No full description has been added yet.')}</p>
          </section>

          <section class="product-detail-card">
            <h2>Metadata</h2>
            <div class="product-meta-grid">
              <article><h3>Categories</h3><p>${escapeHtml((product.categories || []).join(', ') || 'Not specified')}</p></article>
              <article><h3>Genres</h3><p>${escapeHtml((product.genres || []).join(', ') || 'Not specified')}</p></article>
              <article><h3>Tags</h3><p>${escapeHtml((product.tags || []).join(', ') || 'Not specified')}</p></article>
            </div>
          </section>
        </div>
      </section>
    </main>
  `

  const logoReadyPromise = initShellChrome()
  createCriticalAssetPreloader({ logoReadyPromise })

  app.querySelector('[data-add-product-cart]')?.addEventListener('click', (event) => {
    event.preventDefault()
    addToCart(product)
    const button = event.currentTarget
    if (button instanceof HTMLButtonElement) {
      button.textContent = 'Added to Cart'
      window.setTimeout(() => {
        button.textContent = 'Add to Cart'
      }, 900)
    }
    document.querySelector('[data-cart-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })
}

async function initProductPage() {
  const productId = parseProductIdFromLocation()
  if (!productId) {
    renderState('Product not found.', 'We could not determine which product to load from this URL.')
    return
  }

  const currentUser = await waitForInitialAuthState()
  const product = await getProductById(productId)
  if (!product) {
    renderState('Product not found.', 'This product may have been removed or the link is invalid.')
    return
  }

  const isOwner = Boolean(currentUser?.uid && product.artistId && currentUser.uid === product.artistId)
  const isPublicProduct = product.status === 'published' && product.visibility === 'public'

  if (!isPublicProduct && !isOwner) {
    renderState('Product not available.', 'This product is not currently available to the public.')
    return
  }

  renderProduct(product, { isOwnerPreview: !isPublicProduct && isOwner })
}

initProductPage().catch(() => {
  renderState('Product could not be loaded.', 'Please refresh and try again.')
})
