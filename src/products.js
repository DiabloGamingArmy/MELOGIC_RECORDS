import './styles/base.css'
import './styles/products.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import { getPublicProducts } from './data/productService'

const app = document.querySelector('#app')

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function productCardMarkup(product) {
  const artistHref = product.artistUsername
    ? `/profile.html?u=${encodeURIComponent(product.artistUsername)}`
    : '/profile.html'
  const contributorList = product.contributorNames.length
    ? product.contributorNames.map((name) => `<span>${escapeHtml(name)}</span>`).join(' · ')
    : 'No contributors listed'
  const tags = product.genres?.length
    ? product.genres.map((genre) => `#${escapeHtml(String(genre).replace(/\s+/g, ''))}`).join(' · ')
    : (product.tags || []).slice(0, 3).map((tag) => `#${escapeHtml(tag)}`).join(' · ')

  const mediaMarkup = product.thumbnailURL || product.coverURL
    ? `<img src="${product.thumbnailURL || product.coverURL}" alt="${escapeHtml(product.title)} cover" loading="lazy" />`
    : '<div class="product-cover-fallback" aria-hidden="true"></div>'

  return `
    <article class="product-card" role="listitem" data-product-id="${escapeHtml(product.id)}">
      <div class="product-cover">
        ${mediaMarkup}
      </div>
      <div class="product-content">
        <div class="product-meta-row">
          <p class="product-type">${escapeHtml(product.productType || 'Release')}</p>
          <p class="product-price">${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</p>
        </div>
        <h3>${escapeHtml(product.title)}</h3>
        <p class="product-creator">by ${escapeHtml(product.artistName)}</p>
        <p class="product-description">${escapeHtml(product.shortDescription || 'No description available yet.')}</p>
        <p class="product-tags">${tags || '#new'}</p>

        <div class="product-stats" aria-label="Product engagement stats">
          <span>👍 ${product.counts.likes}</span>
          <span>👎 ${product.counts.dislikes}</span>
          <span>💾 ${product.counts.saves}</span>
          <span>🔁 ${product.counts.shares}</span>
          <span>💬 ${product.counts.comments}</span>
          <span>👥 ${product.counts.follows}</span>
        </div>

        <p class="product-contributors"><strong>Contributors:</strong> ${contributorList}</p>
        <p class="product-artist-link"><a href="${artistHref}">@${escapeHtml(product.artistUsername || 'artist')}</a></p>

        <div class="product-actions">
          <button type="button" class="preview-btn" ${product.previewAudioURLs.length ? '' : 'disabled'} aria-label="Preview ${escapeHtml(product.title)}">▶ Preview</button>
          <button type="button" class="add-btn" aria-label="Add ${escapeHtml(product.title)} to cart">Add to cart</button>
        </div>
      </div>
    </article>
  `
}

function updateCatalogStatus(message, state = 'info') {
  const statusEl = app.querySelector('[data-products-status]')
  if (!statusEl) return
  statusEl.textContent = message
  statusEl.dataset.state = state
}

function renderProducts(products) {
  const grid = app.querySelector('[data-products-grid]')
  if (!grid) return

  if (!products.length) {
    grid.innerHTML = `
      <article class="product-empty-state">
        <h3>No products available yet</h3>
        <p>Published catalog items will appear here when creators release them.</p>
      </article>
    `
    updateCatalogStatus('No published products found.', 'info')
    return
  }

  grid.innerHTML = products.map((product) => productCardMarkup(product)).join('')
  updateCatalogStatus(`Loaded ${products.length} product${products.length === 1 ? '' : 's'} from Firebase.`, 'success')
}

app.innerHTML = `
  ${navShell({ currentPage: 'products' })}

  <main>
    <section class="products-hero section" id="products-top">
      <div class="hero-media" aria-hidden="true">
        <video
          id="products-hero-video"
          class="hero-bg-video"
          muted
          loop
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <div class="hero-media-overlay"></div>
      </div>
      <div class="section-inner hero-content-layer">
        <p class="eyebrow">Marketplace</p>
        <h1>Products</h1>
        <p class="products-intro">
          Browse sample packs, presets, wavetables, tools, and creator-made releases across the Melogic catalog.
        </p>
      </div>
    </section>

    <section class="section products-catalog">
      <div class="section-inner">
        <div class="products-filter-row" aria-label="Catalog controls">
          <label class="filter-control">
            <span>Search</span>
            <input type="search" placeholder="Search products or creators" disabled />
          </label>
          <label class="filter-control">
            <span>Category</span>
            <select disabled>
              <option>All categories</option>
            </select>
          </label>
          <label class="filter-control">
            <span>Genre</span>
            <select disabled>
              <option>All genres</option>
            </select>
          </label>
          <label class="filter-control">
            <span>Sort</span>
            <select disabled>
              <option>Featured</option>
            </select>
          </label>
        </div>

        <p class="products-status" data-products-status data-state="info">Loading products from Firebase...</p>

        <div class="products-grid" role="list" aria-label="Product catalog" data-products-grid></div>
      </div>
    </section>

    <footer class="section products-footer">
      <div class="section-inner">
        <p class="eyebrow">Melogic Records</p>
        <p>Catalog-ready tools and creator releases built for the next wave of heavy electronic music.</p>
      </div>
    </footer>
  </main>
`

function initProductsHeroVideo() {
  const heroVideo = document.querySelector('#products-hero-video')
  const heroPaths = getPageHeroVideoPaths('products')
  if (!heroPaths) return false
  return attachHeroVideo(heroVideo, {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'products'
  })
}

async function initProductCatalog() {
  try {
    const products = await getPublicProducts()
    renderProducts(products)
  } catch (error) {
    console.warn('[products] Failed to initialize catalog.', error?.message || error)
    updateCatalogStatus('Could not load products right now. Please try again.', 'error')
  }
}

initShellChrome()
initProductsHeroVideo()
initProductCatalog()
