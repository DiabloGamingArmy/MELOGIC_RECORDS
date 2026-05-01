import './styles/base.css'
import './styles/productDashboard.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { addToCart } from './data/cartService'
import { getProductById, listProductFiles, listRecommendedProducts } from './data/productService'
import { claimFreeProduct, userOwnsProduct } from './data/entitlementService'
import { getUserProductEngagementState, setProductReaction, setProductSaved } from './data/productEngagementService'
import { createProductReview, listProductReviews } from './data/productReviewService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, productRoute, publicProfileRoute } from './utils/routes'

const app = document.querySelector('#app')

const state = {
  mediaItems: [],
  selectedMediaIndex: 0,
  currentUser: null,
  isDraftPreview: false,
  interaction: { reaction: null, saved: false },
  engagementCounts: { likeCount: 0, dislikeCount: 0, saveCount: 0 },
  engagementProductId: '',
  reviews: []
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

  return String(params.get('id') || '').trim()
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
          <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
        </div>
      </section>
    </main>
  `
  initShellChrome()
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
  initShellChrome()
}

function recommendationCardMarkup(product) {
  const art = product.thumbnailURL || product.coverURL
  const badge = product.genres?.[0] || product.productType || 'Product'
  return `
    <a class="dashboard-recommend-card" href="${productRoute(product)}" aria-label="Open ${escapeHtml(product.title)}">
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


function formatReviewTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function reviewInitials(name) {
  return creatorInitials(name || 'User')
}

function creatorInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'CR'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('')
}

function renderProduct(product, recommendations = [], ownerPreview = false, productFiles = [], ownsProduct = false) {
  const mediaItems = buildMediaItems(product)
  state.mediaItems = mediaItems
  state.selectedMediaIndex = 0

  const listingThumbnailURL = product.thumbnailURL || product.coverURL || ''
  const typeLabel = product.productType || 'Product'
  const creatorHref = product.artistId ? publicProfileRoute({ uid: product.artistId }) : ROUTES.profilePublic
  if (state.engagementProductId !== product.id) {
    state.engagementCounts = {
      likeCount: Number(product.likeCount ?? product.counts?.likes ?? 0),
      dislikeCount: Number(product.dislikeCount ?? product.counts?.dislikes ?? 0),
      saveCount: Number(product.saveCount ?? product.counts?.saves ?? 0)
    }
    state.engagementProductId = product.id
  }
  const likeCount = state.engagementCounts.likeCount
  const dislikeCount = state.engagementCounts.dislikeCount
  const artistDisplayName = product.artistDisplayName || product.artistName || 'Creator'
  const artistHandle = product.artistUsername ? `@${product.artistUsername}` : '@creator'
  const creatorAvatar = product.artistAvatarURL || product.artistPhotoURL || ''
  const isOwner = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)

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
      ${state.isDraftPreview ? '<section class=\"section\"><div class=\"section-inner\"><article class=\"panel-surface draft-preview-banner\">Marketplace Preview — actions are disabled.</article></div></section>' : ''}
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-layout">
          <section class="dashboard-media-area panel-surface" aria-label="Product media gallery">
            ${isOwner ? `
              <article class="dashboard-owner-header-card">
                <p class="eyebrow">Your listing</p>
                <h3>${ownerPreview ? 'Private owner preview' : 'Manage this product'}</h3>
                <p>Status: ${escapeHtml(product.status || 'draft')} · Visibility: ${escapeHtml(product.visibility || 'private')}</p>
                <p>Created: ${escapeHtml(formatReleaseDate(product.createdAt))} · Updated: ${escapeHtml(formatReleaseDate(product.updatedAt || product.createdAt))}</p>
                <p>Moderation: ${escapeHtml(product.moderationStatus || 'pending')}</p>
                <a class="button button-muted" href="${ROUTES.newProduct}?id=${encodeURIComponent(product.id)}">Edit listing</a>
              </article>
            ` : ''}
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
              <h2>File browser</h2>
              <p>${ownsProduct ? 'Owned: private downloads available when backend signed URLs are implemented.' : 'Preview manifest only until product is owned.'}</p>
              <ul>
                ${productFiles.length
                  ? productFiles.map((file) => `<li>${escapeHtml(file.displayPath || file.name)} · ${Math.max(0, Number(file.sizeBytes || 0) / 1024).toFixed(1)} KB ${file.canPreview ? '· previewable' : ''}</li>`).join('')
                  : '<li>No included files listed yet.</li>'}
              </ul>
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
            <article class="dashboard-section-card dashboard-section-recommendations">
              <div class="dashboard-section-heading-row">
                <h2>Recommended products</h2>
                <a href="${ROUTES.products}">Browse all</a>
              </div>
              ${recommendations.length
                ? `<div class="dashboard-recommend-carousel" aria-label="Recommended products">${recommendations.map((item) => recommendationCardMarkup(item)).join('')}</div>`
                : '<p>No recommendations yet.</p>'}
            </article>
            <article class="dashboard-section-card dashboard-section-reviews">
              <h2>Reviews (${product.reviewCount ?? product.commentCount ?? state.reviews.length})</h2>
              <p class="dashboard-review-rating">${product.averageRating ? `Average rating ${Number(product.averageRating).toFixed(1)} / 5` : 'No ratings yet.'}</p>
              ${state.currentUser?.uid ? `
                <form class="dashboard-review-composer" data-review-form>
                  <label for="review-body">Write a review</label>
                  <select name="rating" aria-label="Rating">
                    <option value="">No rating</option><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option>
                  </select>
                  <textarea id="review-body" name="body" maxlength="5000" placeholder="Share your thoughts about this product..."></textarea>
                  <button class="button button-accent" type="submit">Submit review</button>
                </form>` : '<p class="dashboard-mini-note">Sign in to review this product.</p>'}
              <div class="dashboard-review-list">
                ${state.reviews.length ? state.reviews.map((review) => `
                  <article class="dashboard-review-card">
                    <div class="dashboard-creator-block">
                      ${review.avatarURL ? `<img class="dashboard-creator-avatar" src="${escapeHtml(review.avatarURL)}" alt="${escapeHtml(review.displayName || 'User')} avatar" loading="lazy" />` : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(reviewInitials(review.displayName || 'User'))}</span>`}
                      <div><p class="dashboard-creator-name">${escapeHtml(review.displayName || 'User')}</p><p class="dashboard-mini-note">${escapeHtml(formatReviewTime(review.createdAt))}</p></div>
                    </div>
                    <p class="dashboard-review-rating">${review.rating ? '★'.repeat(Math.max(1, Math.min(5, Number(review.rating)))) : 'No star rating'}</p>
                    <p>${escapeHtml(review.body || '')}</p>
                    <p class="dashboard-mini-note">Like · Reply</p>
                  </article>`).join('') : '<p>No reviews yet. Be the first to review this product.</p>'}
              </div>
            </article>
          </section>

          <aside class="dashboard-lower-sidebar">
            <article class="panel-surface dashboard-overview">
              <p class="dashboard-breadcrumbs"><a href="${ROUTES.products}">Products</a> <span>&gt;</span> <span>${escapeHtml((product.categories || [])[0] || 'Catalog')}</span> <span>&gt;</span> <span>${escapeHtml(typeLabel)}</span></p>
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
              <div class="dashboard-action-stack">
                <button type="button" class="button button-accent ${state.isDraftPreview ? 'preview-mode-disabled' : ''}" data-add-dashboard-cart ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}>${product.isFree ? 'Add to Library' : 'Add to Cart'}</button>
                <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
                <div class="dashboard-action-row">
                  <button type="button" class="button button-muted" data-product-like aria-label="Like this product" aria-pressed="${state.interaction.reaction === 'like'}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}>Like ${likeCount}</button>
                  <button type="button" class="button button-muted" data-product-dislike aria-label="Dislike this product" aria-pressed="${state.interaction.reaction === 'dislike'}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}>Dislike ${dislikeCount}</button>
                </div>
                <div class="dashboard-action-row">
                  <button type="button" class="button button-muted" data-product-save aria-label="Save this product" aria-pressed="${state.interaction.saved}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}>${state.interaction.saved ? 'Saved' : 'Save'} ${state.engagementCounts.saveCount}</button>
                  <button type="button" class="button button-muted" data-product-share aria-label="Share this product">Share</button>
                </div>
                ${product.isFree ? `<button type="button" class="button button-muted ${state.isDraftPreview ? 'preview-mode-disabled' : ''}" data-claim-free-product ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}>Claim Free Product</button>` : ''}
                ${(product.previewAudioURLs || []).length ? `<button type="button" class="button button-muted" data-play-dashboard-preview>Preview</button>` : ''}
              </div>
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
              <p>Saves: ${state.engagementCounts.saveCount}</p>
              <p>Downloads: ${product.downloadCount ?? product.counts?.downloads ?? 0}</p>
              <p>Comments: ${product.commentCount ?? product.counts?.comments ?? 0}</p>
            </article>
          </aside>
        </div>
      </section>
    </main>
  `

  document.title = `Melogic | ${product.title}`
  renderMainMedia()
  initShellChrome()

  app.querySelector('[data-add-dashboard-cart]')?.addEventListener('click', (event) => {
    if (state.isDraftPreview) return
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
    firstAudio.play().catch((error) => {
      console.warn('[product] preview playback failed', error?.message || error)
    })
  })

  app.querySelector('[data-claim-free-product]')?.addEventListener('click', async (event) => {
    if (state.isDraftPreview) return
    if (!state.currentUser?.uid || !product?.id) return
    const button = event.currentTarget
    if (!(button instanceof HTMLButtonElement)) return
    button.disabled = true
    try {
      await claimFreeProduct(state.currentUser.uid, product.id)
      button.textContent = 'Claimed'
    } catch {
      button.disabled = false
      button.textContent = 'Claim failed'
    }
  })


  const showActionMessage = (message) => {
    const note = app.querySelector('.dashboard-mini-note')
    if (note) note.textContent = message
  }

  const requireAuth = () => {
    if (state.currentUser?.uid) return true
    showActionMessage('Sign in to interact with products.')
    return false
  }

  app.querySelector('[data-product-like]')?.addEventListener('click', async () => {
    if (state.isDraftPreview || !requireAuth()) return
    const prev = state.interaction.reaction
    const previousCounts = { ...state.engagementCounts }
    const next = prev === 'like' ? null : 'like'
    if (prev === 'like') state.engagementCounts.likeCount = Math.max(0, state.engagementCounts.likeCount - 1)
    if (prev === 'dislike') state.engagementCounts.dislikeCount = Math.max(0, state.engagementCounts.dislikeCount - 1)
    if (next === 'like') state.engagementCounts.likeCount += 1
    if (next === 'dislike') state.engagementCounts.dislikeCount += 1
    state.interaction.reaction = next
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    try { await setProductReaction(product.id, next) } catch (error) {
      state.interaction.reaction = prev
      state.engagementCounts = previousCounts
      console.warn('[product] engagement update failed', {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      showActionMessage('Could not update reaction')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-product-dislike]')?.addEventListener('click', async () => {
    if (state.isDraftPreview || !requireAuth()) return
    const next = state.interaction.reaction === 'dislike' ? null : 'dislike'
    state.interaction.reaction = next
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    try { await setProductReaction(product.id, next) } catch (error) {
      state.interaction.reaction = prev
      state.engagementCounts = previousCounts
      console.warn('[product] engagement update failed', {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      showActionMessage('Could not update reaction')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-product-save]')?.addEventListener('click', async () => {
    if (state.isDraftPreview || !requireAuth()) return
    const previousSaved = state.interaction.saved
    const previousCounts = { ...state.engagementCounts }
    const next = !previousSaved
    state.interaction.saved = next
    state.engagementCounts.saveCount = Math.max(0, state.engagementCounts.saveCount + (next ? 1 : -1))
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    showActionMessage(next ? 'Saved' : 'Removed from saved')
    try { await setProductSaved(product.id, next) } catch (error) {
      state.interaction.saved = previousSaved
      state.engagementCounts = previousCounts
      console.warn('[product] engagement update failed', {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      showActionMessage('Could not update save state')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-product-share]')?.addEventListener('click', async () => {
    const shareData = { title: product.title, text: product.shortDescription || 'Check this product', url: window.location.href }
    try {
      if (navigator.share) await navigator.share(shareData)
      else if (navigator.clipboard) await navigator.clipboard.writeText(window.location.href)
      showActionMessage('Copied link')
    } catch {}
  })

  app.querySelector('[data-review-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.currentUser?.uid) return
    const form = event.currentTarget
    const data = new FormData(form)
    const body = String(data.get('body') || '').trim()
    const rating = data.get('rating') ? Number(data.get('rating')) : null
    if (!body) return
    await createProductReview(product.id, state.currentUser, {}, { body, rating })
    state.reviews = await listProductReviews(product.id, { limitCount: 20 })
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
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
  state.currentUser = await waitForInitialAuthState()
  state.isDraftPreview = new URLSearchParams(window.location.search).get('preview') === 'draft'

  const id = parseProductIdFromLocation()
  if (!id) {
    renderState('Product not found.', 'Please choose a product from the marketplace.')
    return
  }

  try {
    const product = await getProductById(id)
    if (!product) {
      renderState('This product could not be found.', 'It may have been removed or is not public yet.')
      return
    }

    const isOwner = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)
    const isPublic = product.status === 'published' && product.visibility === 'public'
    if (!isPublic && !isOwner && !state.isDraftPreview) {
      renderState('Product not available.', 'This product is not currently available to the public.')
      return
    }
    if (state.isDraftPreview && !isOwner) {
      renderState('Preview unavailable.', 'Only the product owner can open draft marketplace preview mode.')
      return
    }

    const safe = async (label, fallback, task) => {
      try {
        return await task()
      } catch (error) {
        console.warn(`[product] optional ${label} load failed`, error?.message || error)
        return fallback
      }
    }

    const recommendations = await safe('recommendations', [], () => listRecommendedProducts({ product, pageSize: 8 }))
    const productFiles = await safe('files', [], () => listProductFiles(product.id))
    const ownsProduct = await safe('ownership', false, () => userOwnsProduct(state.currentUser?.uid || '', product.id))
    const reviews = await safe('reviews', [], () => listProductReviews(product.id, { limitCount: 20 }))
    const engagement = await safe('engagement', { reaction: null, saved: false }, () => state.currentUser?.uid
      ? getUserProductEngagementState(product.id, state.currentUser.uid)
      : Promise.resolve({ reaction: null, saved: false }))
    state.reviews = reviews
    state.interaction = engagement
    renderProduct(product, recommendations.filter((item) => normalizeKey(item.id) !== normalizeKey(product.id)), !isPublic && isOwner, productFiles, ownsProduct || Boolean(isOwner))
  } catch (error) {
    console.error('[product] failed to load product page', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    })
    renderState('Product could not be loaded right now.', 'Please try again in a moment.')
  }
}

init()
