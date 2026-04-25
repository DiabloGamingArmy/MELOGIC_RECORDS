import './styles/base.css'
import './styles/productDashboard.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { addToCart } from './data/cartService'
import { getProductById, listRecommendedProducts } from './data/productService'

const app = document.querySelector('#app')

const state = {
  mediaItems: [],
  selectedMediaIndex: 0
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-')
}

function getProductIdFromQuery() {
  return new URLSearchParams(window.location.search).get('id') || ''
}

function formatReleaseDate(value) {
  const stamp = new Date(value || 0)
  if (Number.isNaN(stamp.getTime())) return 'Unreleased'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(stamp)
}

function buildMediaItems(product) {
  const leadImage = [product.coverURL, product.thumbnailURL].find(Boolean) || ''
  const media = [
    ...(leadImage ? [{ type: 'image', url: leadImage, label: `${product.title} cover` }] : []),
    ...(product.galleryURLs || []).map((url, index) => ({ type: 'image', url, label: `${product.title} gallery ${index + 1}` })),
    ...(product.previewVideoURLs || []).map((url, index) => ({ type: 'video', url, label: `${product.title} video ${index + 1}` }))
  ]

  const seen = new Set()
  return media.filter((item) => {
    const key = `${item.type}:${item.url}`
    if (!item.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function renderMainMedia() {
  const mainMediaRoot = app.querySelector('[data-dashboard-main-media]')
  if (!mainMediaRoot) return

  const selected = state.mediaItems[state.selectedMediaIndex]
  if (!selected) {
    mainMediaRoot.innerHTML = `
      <div class="dashboard-media-fallback">
        <p class="eyebrow">Melogic Visual</p>
        <h3>No media uploaded yet</h3>
        <p>Creators can add cover art, gallery images, and preview videos.</p>
      </div>
    `
    return
  }

  mainMediaRoot.innerHTML = selected.type === 'video'
    ? `<video src="${escapeHtml(selected.url)}" controls preload="metadata" aria-label="${escapeHtml(selected.label)}"></video>`
    : `<img src="${escapeHtml(selected.url)}" alt="${escapeHtml(selected.label)}" loading="eager" />`

  app.querySelectorAll('[data-media-index]').forEach((button) => {
    const index = Number(button.getAttribute('data-media-index'))
    button.classList.toggle('is-active', index === state.selectedMediaIndex)
    button.setAttribute('aria-pressed', String(index === state.selectedMediaIndex))
  })
}

function renderState(title, body) {
  document.title = 'Melogic | Product'
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
        <div class="section-inner product-dashboard-layout">
          <div class="dashboard-skeleton dashboard-skeleton-media"></div>
          <div class="dashboard-skeleton dashboard-skeleton-overview"></div>
          <div class="dashboard-skeleton dashboard-skeleton-content"></div>
          <div class="dashboard-skeleton dashboard-skeleton-sidebar"></div>
        </div>
      </section>
    </main>
  `
}

function recommendationCardMarkup(product) {
  const art = product.thumbnailURL || product.coverURL
  const badge = product.genres?.[0] || product.productType || 'Product'
  return `
    <a class="dashboard-recommend-card" href="/product-dashboard.html?id=${encodeURIComponent(product.id)}" aria-label="Open ${escapeHtml(product.title)}">
      <div class="dashboard-recommend-thumb">
        ${art
          ? `<img src="${escapeHtml(art)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />`
          : '<div class="dashboard-recommend-fallback" aria-hidden="true"></div>'}
      </div>
      <div class="dashboard-recommend-body">
        <h4>${escapeHtml(product.title)}</h4>
        <p class="dashboard-recommend-creator">${escapeHtml(product.artistName)}</p>
        <div class="dashboard-recommend-meta">
          <span>${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</span>
          <span>${escapeHtml(badge)}</span>
        </div>
      </div>
    </a>
  `
}

function creatorInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'CR'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('')
}

function renderProduct(product, recommendations = []) {
  const mediaItems = buildMediaItems(product)
  state.mediaItems = mediaItems
  state.selectedMediaIndex = 0

  const listingThumbnailURL = product.thumbnailURL || product.coverURL || ''
  const typeLabel = product.productType || 'Product'
  const creatorHref = product.artistUsername ? `/profile.html?u=${encodeURIComponent(product.artistUsername)}` : '/profile.html'
  const likeCount = product.likeCount ?? product.counts?.likes ?? 0
  const dislikeCount = product.counts?.dislikes ?? 0
  const artistDisplayName = product.artistDisplayName || product.artistName || 'Creator'
  const artistHandle = product.artistUsername ? `@${product.artistUsername}` : '@creator'
  const creatorAvatar = product.artistAvatarURL || product.artistPhotoURL || ''

  const thumbMarkup = mediaItems.map((item, index) => `
    <button type="button" class="dashboard-thumb" data-media-index="${index}" aria-label="Show media ${index + 1}" aria-pressed="${index === 0 ? 'true' : 'false'}">
      ${item.type === 'video'
        ? '<span class="dashboard-thumb-video">Video preview</span>'
        : `<img src="${escapeHtml(item.url)}" alt="" loading="lazy" />`}
    </button>
  `).join('')

  const tags = (product.tags || []).slice(0, 12)
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-layout">
          <section class="dashboard-media-area panel-surface" aria-label="Product media gallery">
            <div class="dashboard-main-media" data-dashboard-main-media></div>
            ${thumbMarkup ? `
              <div class="dashboard-thumb-toolbar">
                <button type="button" class="dashboard-nav-btn" data-media-prev aria-label="Previous media">◀</button>
                <div class="dashboard-thumb-row">${thumbMarkup}</div>
                <button type="button" class="dashboard-nav-btn" data-media-next aria-label="Next media">▶</button>
              </div>
            ` : ''}
            ${(product.previewAudioURLs || []).length ? `
              <section class="dashboard-audio-panel">
                <h3>Audio previews</h3>
                <div class="dashboard-audio-row" data-dashboard-audio-row>
                  ${product.previewAudioURLs.map((url, index) => `<audio controls src="${escapeHtml(url)}" aria-label="Audio preview ${index + 1}"></audio>`).join('')}
                </div>
              </section>
            ` : ''}
          </section>

          <section class="dashboard-main-sections panel-surface">
            <article class="dashboard-section-card dashboard-section-about">
              <h2>About this product</h2>
              <p>${escapeHtml(product.description || product.shortDescription || 'No full description has been provided yet.')}</p>
            </article>
            <article class="dashboard-section-card">
              <h2>What’s included</h2>
              <p>${escapeHtml((product.categories || []).join(', ') || 'Details were not provided.')}</p>
            </article>
            <article class="dashboard-section-card">
              <h2>Compatibility</h2>
              <p>${escapeHtml((product.dawCompatibility || []).join(', ') || 'Compatibility details are based on creator-provided metadata.')}</p>
            </article>
            <article class="dashboard-section-card">
              <h2>License / usage</h2>
              <p>${product.licensePath ? 'License included.' : 'License details were not uploaded yet.'}</p>
            </article>
            <article class="dashboard-section-card">
              <h2>Creator notes</h2>
              <p>${escapeHtml(product.shortDescription || 'Creator notes will appear here when provided.')}</p>
            </article>
            <article class="dashboard-section-card">
              <h2>Tags</h2>
              <div class="dashboard-tag-row">
                ${tags.length ? tags.map((tag) => `<span class="dashboard-pill">${escapeHtml(tag)}</span>`).join('') : '<span class="dashboard-pill">No tags yet</span>'}
              </div>
            </article>
            <article class="dashboard-section-card">
              <h2>Stats</h2>
              <p>👍 ${likeCount} · 👎 ${dislikeCount} · Saves ${product.saveCount ?? product.counts?.saves ?? 0} · Downloads ${product.downloadCount ?? product.counts?.downloads ?? 0}</p>
            </article>
            <article class="dashboard-section-card">
              <h2>Reviews</h2>
              <p>Reviews are coming soon.</p>
            </article>
          </section>

          <aside class="dashboard-lower-sidebar">
            <article class="panel-surface dashboard-overview">
              <p class="dashboard-breadcrumbs"><a href="/products.html">Products</a> <span>&gt;</span> <span>${escapeHtml((product.categories || [])[0] || 'Catalog')}</span> <span>&gt;</span> <span>${escapeHtml(typeLabel)}</span></p>
              ${listingThumbnailURL ? `<img class="dashboard-cover-banner" src="${escapeHtml(listingThumbnailURL)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />` : ''}
              <h2>${escapeHtml(product.title)}</h2>
              <p class="dashboard-short-description">${escapeHtml(product.shortDescription || product.description || 'No description has been shared yet.')}</p>
              <div class="dashboard-top-badges">
                <span class="dashboard-pill">${escapeHtml(typeLabel)}</span>
                ${(product.genres || []).slice(0, 3).map((genre) => `<span class="dashboard-pill">${escapeHtml(genre)}</span>`).join('')}
              </div>
              <dl class="dashboard-overview-grid">
                <div><dt>Type</dt><dd>${escapeHtml(typeLabel)}</dd></div>
                <div><dt>Release date</dt><dd>${escapeHtml(formatReleaseDate(product.releasedAt || product.createdAt))}</dd></div>
                <div><dt>Creator</dt><dd>${escapeHtml(product.artistName)}</dd></div>
                <div><dt>Categories</dt><dd>${escapeHtml((product.categories || []).join(', ') || 'Unspecified')}</dd></div>
                <div><dt>Genres</dt><dd>${escapeHtml((product.genres || []).join(', ') || 'Unspecified')}</dd></div>
                <div><dt>DAW compatibility</dt><dd>${escapeHtml((product.dawCompatibility || []).join(', ') || 'Creator has not listed DAWs')}</dd></div>
                <div><dt>Formats</dt><dd>${escapeHtml((product.formatKeys || []).join(', ') || 'Creator has not listed formats')}</dd></div>
              </dl>
              <div class="dashboard-tag-row">
                ${tags.length ? tags.map((tag) => `<span class="dashboard-pill">${escapeHtml(tag)}</span>`).join('') : '<span class="dashboard-pill">No tags yet</span>'}
              </div>
              <p class="dashboard-engagement">👍 ${likeCount} · 👎 ${dislikeCount}</p>

              <div class="dashboard-creator-block">
                ${creatorAvatar
                  ? `<img src="${escapeHtml(creatorAvatar)}" alt="${escapeHtml(artistDisplayName)} avatar" class="dashboard-creator-avatar" loading="lazy" />`
                  : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(creatorInitials(artistDisplayName))}</span>`}
                <div>
                  <p class="dashboard-creator-name">${escapeHtml(artistDisplayName)}</p>
                  <p class="dashboard-creator-handle">${escapeHtml(artistHandle)}</p>
                </div>
                <a class="button button-muted" href="${creatorHref}">View Creator</a>
              </div>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Get ${escapeHtml(product.title)}</h3>
              <p class="dashboard-price">${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</p>
              <button type="button" class="button button-accent" data-add-dashboard-cart>Add to Cart</button>
              ${(product.previewAudioURLs || []).length ? '<button type="button" class="button button-muted" data-play-dashboard-preview>Preview</button>' : ''}
              <p class="dashboard-mini-note">Instant digital download</p>
              <p class="dashboard-mini-note">${product.licensePath ? 'License included' : 'License details available from creator on request'}</p>
              <p class="dashboard-mini-note">Created by ${escapeHtml(product.artistName)}</p>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Compatibility</h3>
              <p>DAW: ${escapeHtml((product.dawCompatibility || []).join(', ') || 'Not listed')}</p>
              <p>Formats: ${escapeHtml((product.formatKeys || []).join(', ') || 'Not listed')}</p>
              <p class="dashboard-mini-note">Compatibility details are based on creator-provided metadata.</p>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Community activity</h3>
              <p>👍 ${likeCount} · 👎 ${dislikeCount}</p>
              <p>Saves: ${product.saveCount ?? product.counts?.saves ?? 0}</p>
              <p>Downloads: ${product.downloadCount ?? product.counts?.downloads ?? 0}</p>
              <p>Comments: ${product.commentCount ?? product.counts?.comments ?? 0}</p>
            </article>

            ${recommendations.length
              ? `
                <article class="panel-surface dashboard-side-card">
                  <h3>Recommended products</h3>
                  <div class="dashboard-recommend-list">${recommendations.map((item) => recommendationCardMarkup(item)).join('')}</div>
                </article>
              `
              : ''}
          </aside>
        </div>
      </section>
    </main>
  `

  document.title = `Melogic | ${product.title}`
  renderMainMedia()

  app.querySelector('[data-add-dashboard-cart]')?.addEventListener('click', (event) => {
    event.preventDefault()
    addToCart(product)
    const button = event.currentTarget
    if (button instanceof HTMLButtonElement) {
      button.textContent = 'Added to cart'
      setTimeout(() => {
        button.textContent = 'Add to Cart'
      }, 1200)
    }
    document.querySelector('[data-cart-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  app.querySelector('[data-play-dashboard-preview]')?.addEventListener('click', () => {
    const firstAudio = app.querySelector('[data-dashboard-audio-row] audio')
    if (!(firstAudio instanceof HTMLAudioElement)) return
    firstAudio.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    firstAudio.play().catch(() => {})
  })

  app.querySelectorAll('[data-media-index]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedMediaIndex = Number(button.getAttribute('data-media-index')) || 0
      renderMainMedia()
    })
  })

  app.querySelectorAll('[data-media-prev], [data-media-next]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.mediaItems.length) return
      const delta = button.hasAttribute('data-media-prev') ? -1 : 1
      state.selectedMediaIndex = (state.selectedMediaIndex + delta + state.mediaItems.length) % state.mediaItems.length
      renderMainMedia()
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

    const recommendations = await listRecommendedProducts({ product, pageSize: 8 })
    renderProduct(product, recommendations.filter((item) => normalizeKey(item.id) !== normalizeKey(product.id)))
    initShellChrome()
  } catch {
    renderState('Product could not be loaded right now.', 'Please try again in a moment.')
    initShellChrome()
  }
}

init()
