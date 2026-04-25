import './styles/base.css'
import './styles/productDashboard.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { addToCart } from './data/cartService'
import { getProductById } from './data/productService'

const app = document.querySelector('#app')

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getProductIdFromQuery() {
  return new URLSearchParams(window.location.search).get('id') || ''
}

function renderState(title, body) {
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-empty">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(body)}</p>
          <a class="button button-muted" href="/products.html">Back to Products</a>
        </div>
      </section>
    </main>
  `
}

function renderSkeleton() {
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-grid">
          <div class="dashboard-skeleton dashboard-skeleton-media"></div>
          <div class="dashboard-skeleton dashboard-skeleton-sidebar"></div>
          <div class="dashboard-skeleton dashboard-skeleton-content"></div>
        </div>
      </section>
    </main>
  `
}

function renderProduct(product) {
  const mediaItems = [
    ...(product.coverURL ? [{ type: 'image', url: product.coverURL, label: `${product.title} cover` }] : []),
    ...(product.galleryURLs || []).map((url, index) => ({ type: 'image', url, label: `${product.title} image ${index + 1}` })),
    ...(product.previewVideoURLs || []).map((url, index) => ({ type: 'video', url, label: `${product.title} video ${index + 1}` }))
  ]

  const mainMedia = mediaItems[0]
  const thumbMarkup = mediaItems.slice(0, 12).map((item, index) => `
    <button type="button" class="dashboard-thumb" data-media-index="${index}" aria-label="Open media ${index + 1}">
      ${item.type === 'video' ? '<span>Video</span>' : `<img src="${escapeHtml(item.url)}" alt="" loading="lazy" />`}
    </button>
  `).join('')

  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-grid">
          <div class="dashboard-media-panel">
            <div class="dashboard-main-media" data-main-media>
              ${mainMedia ? (mainMedia.type === 'video'
                ? `<video src="${escapeHtml(mainMedia.url)}" controls preload="metadata"></video>`
                : `<img src="${escapeHtml(mainMedia.url)}" alt="${escapeHtml(mainMedia.label)}" loading="eager" />`) : '<div class="dashboard-media-fallback">No media available</div>'}
            </div>
            ${thumbMarkup ? `<div class="dashboard-thumb-row">${thumbMarkup}</div>` : ''}
            ${(product.previewAudioURLs || []).length ? `<div class="dashboard-audio-list">${product.previewAudioURLs.map((url) => `<audio controls src="${escapeHtml(url)}"></audio>`).join('')}</div>` : ''}
          </div>

          <aside class="dashboard-purchase-card">
            <p class="eyebrow">${escapeHtml(product.productType || 'Product')}</p>
            <h1>${escapeHtml(product.title)}</h1>
            <p class="dashboard-artist">by ${escapeHtml(product.artistName)}</p>
            <p class="dashboard-price">${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</p>
            <button type="button" class="button button-accent" data-add-dashboard-cart>Add to Cart</button>
            <a class="button button-muted" href="/profile.html?u=${encodeURIComponent(product.artistUsername || '')}">View Creator</a>
            <ul class="dashboard-meta-list">
              <li><strong>Categories:</strong> ${escapeHtml((product.categories || []).join(', ') || '—')}</li>
              <li><strong>Genres:</strong> ${escapeHtml((product.genres || []).join(', ') || '—')}</li>
              <li><strong>DAW:</strong> ${escapeHtml((product.dawCompatibility || []).join(', ') || '—')}</li>
              <li><strong>Formats:</strong> ${escapeHtml((product.formatKeys || []).join(', ') || '—')}</li>
              <li><strong>Contributors:</strong> ${escapeHtml(String(product.contributorCount || 0))}</li>
            </ul>
          </aside>

          <section class="dashboard-details-panel">
            <h2>Description</h2>
            <p>${escapeHtml(product.description || product.shortDescription || 'No description provided.')}</p>
            <h3>Contributors</h3>
            <p>${escapeHtml((product.contributorNames || []).join(', ') || 'No contributors listed')}</p>
            <h3>Tags</h3>
            <p>${escapeHtml((product.tags || []).join(', ') || 'No tags')}</p>
            <h3>Stats</h3>
            <p>👍 ${product.likeCount ?? product.counts?.likes ?? 0} · 💾 ${product.saveCount ?? product.counts?.saves ?? 0} · ⬇️ ${product.downloadCount ?? product.counts?.downloads ?? 0} · 💬 ${product.commentCount ?? product.counts?.comments ?? 0}</p>
          </section>
        </div>
      </section>
    </main>
  `

  document.title = `Melogic | ${product.title}`

  app.querySelector('[data-add-dashboard-cart]')?.addEventListener('click', (event) => {
    event.preventDefault()
    addToCart(product)
    document.querySelector('[data-cart-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  const mainMediaRoot = app.querySelector('[data-main-media]')
  app.querySelectorAll('[data-media-index]').forEach((button) => {
    button.addEventListener('click', () => {
      const idx = Number(button.getAttribute('data-media-index'))
      const selected = mediaItems[idx]
      if (!selected || !mainMediaRoot) return
      mainMediaRoot.innerHTML = selected.type === 'video'
        ? `<video src="${escapeHtml(selected.url)}" controls preload="metadata"></video>`
        : `<img src="${escapeHtml(selected.url)}" alt="${escapeHtml(selected.label)}" loading="eager" />`
    })
  })
}

async function init() {
  renderSkeleton()
  initShellChrome()

  const id = getProductIdFromQuery()
  if (!id) {
    renderState('Product not found.', 'Please choose a product from the marketplace.')
    initShellChrome()
    return
  }

  try {
    const product = await getProductById(id)
    if (!product) {
      renderState('This product could not be found.', 'It may have been removed or is not public yet.')
      initShellChrome()
      return
    }

    renderProduct(product)
    initShellChrome()
  } catch {
    renderState('Product could not be loaded right now.', 'Please try again in a moment.')
    initShellChrome()
  }
}

init()
