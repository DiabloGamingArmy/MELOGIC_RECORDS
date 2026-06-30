import './styles/base.css'
import './styles/products.css'
import { mountMarketplaceAdRails } from './ads/MarketplaceAdRails'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import { addToCart } from './data/cartService'
import { claimFreeProduct } from './data/entitlementService'
import { listPublicProductsPage } from './data/productService'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, productRoute, publicProfileRoute, usernameProfileRoute } from './utils/routes'
import {
  fulfillmentTypeLabel,
  hasDigitalFulfillment,
  hasPhysicalFulfillment,
  isPhysicalSoldOut,
  normalizeProductFulfillment,
  physicalAvailableQuantity,
  shippingModeLabel
} from './utils/productFulfillment'

const PAGE_SIZE = 10
const SEARCH_DEBOUNCE_MS = 250

const app = document.querySelector('#app')

const categoryOptions = ['All categories', 'Single Sample', 'Sample Pack', 'Drum Kit', 'Vocal Pack', 'Preset Bank', 'Wavetable Pack', 'MIDI Pack', 'Project File', 'Plugin / VST', 'Course / Tutorial', 'Vinyl', 'CD', 'Cassette', 'Merch', 'Apparel', 'Hardware', 'Collectible', 'Signed Item', 'Bundle', 'Release', 'Other']
const genreOptions = ['All genres', 'Dubstep', 'Melodic Dubstep', 'Future Bass', 'Color Bass', 'Riddim', 'Trap', 'Drum & Bass', 'House', 'Techno', 'Metalcore', 'Rock', 'Cinematic', 'Pop', 'Hip-Hop', 'Other']
const sortOptions = [
  { label: 'Featured', value: 'featured' },
  { label: 'Newest', value: 'newest' },
  { label: 'Oldest', value: 'oldest' },
  { label: 'Price: Low to High', value: 'priceLow' },
  { label: 'Price: High to Low', value: 'priceHigh' },
  { label: 'Most Liked', value: 'mostLiked' },
  { label: 'Most Saved', value: 'mostSaved' },
  { label: 'Most Downloaded', value: 'mostDownloaded' },
  { label: 'Most Commented', value: 'mostCommented' }
]

const defaultFilters = {
  search: '',
  category: 'All categories',
  genre: 'All genres',
  sort: 'featured',
  advancedOpen: false,
  daw: 'Any DAW',
  priceType: 'Any price',
  minPrice: '',
  maxPrice: '',
  contributors: 'Any contributor count',
  tags: '',
  releaseWindow: 'Any time',
  format: 'Any format',
  productFormat: 'All formats',
  condition: 'Any condition',
  shippingMode: 'Any shipping'
}

const state = {
  filters: { ...defaultFilters },
  products: [],
  productIds: new Set(),
  cursor: null,
  hasMore: true,
  isLoadingInitial: false,
  isLoadingMore: false,
  hasFatalError: false,
  currentUser: null
}

let searchDebounceTimer = null
let observer = null
const previewController = {
  activeProductId: '',
  activeAudio: null,
  activeVideoCard: null,
  hoverTimer: null
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, '-')
}

function normalizeSearchTokens(value) {
  return String(value || '').toLowerCase().trim().split(/\s+/).filter((token) => token.length > 1)
}

function productCardMarkup(product) {
  const artistId = product.artistId || product.artistUid || product.uid || ''
  const artistHref = artistId
    ? publicProfileRoute({ uid: artistId })
    : (product.artistUsername ? usernameProfileRoute(product.artistUsername) : ROUTES.profilePublic)
  const tags = product.genres?.length
    ? product.genres.map((genre) => `#${escapeHtml(String(genre).replace(/\s+/g, ''))}`).join(' · ')
    : (product.tags || []).slice(0, 3).map((tag) => `#${escapeHtml(tag)}`).join(' · ')
  const likes = product.likeCount ?? product.counts?.likes ?? 0
  const dislikes = product.counts?.dislikes ?? 0
  const isFreeProduct = Boolean(product.isFree) || Number(product.priceCents || 0) <= 0
  const isOwnProduct = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)
  const fulfillment = normalizeProductFulfillment(product)
  const physicalSoldOut = isPhysicalSoldOut(product)
  const physicalSummary = hasPhysicalFulfillment(product)
    ? `${physicalSoldOut ? 'Sold out' : `${physicalAvailableQuantity(product)} available`} · ${shippingModeLabel(fulfillment.physical.shipping.mode)}`
    : 'Instant digital download'
  const actionLabel = isOwnProduct
    ? 'Your product'
    : physicalSoldOut
      ? 'Sold out'
      : isFreeProduct
        ? hasDigitalFulfillment(product) ? 'Add to Library' : 'Claim'
        : 'Add to cart'

  const mediaMarkup = product.thumbnailURL || product.coverURL
    ? `<img src="${escapeHtml(product.thumbnailURL || product.coverURL)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />`
    : '<div class="product-cover-fallback" aria-hidden="true"></div>'

  const hasHoverPreview = Boolean((product.previewVideoURLs?.[0] || product.previewAssignment?.hoverVideoURL || product.previewAudioURLs?.[0] || product.previewAssignment?.hoverAudioURL || product.primaryPreviewURL))
  return `
    <article class="product-card product-card-link" role="listitem" data-open-product data-product-id="${escapeHtml(product.id)}" tabindex="0" aria-label="Open ${escapeHtml(product.title)} details">
      <div class="product-cover" data-product-cover>
        ${mediaMarkup}
        <video class="product-preview-video" data-preview-video-el playsinline loop></video>
        <div class="product-preview-overlay" data-preview-overlay>${hasHoverPreview ? 'Preview on hover' : ''}</div>
      </div>
      <div class="product-content">
        <div class="product-meta-row">
          <p class="product-type"><span class="product-format-badge">${escapeHtml(fulfillmentTypeLabel(product))}</span> ${escapeHtml(product.productType || 'Release')}</p>
          <p class="product-price">${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</p>
        </div>
        <h3>${escapeHtml(product.title)}</h3>
        <p class="product-creator">by <a href="${artistHref}" data-artist-link>${escapeHtml(product.artistName)}</a></p>
        <p class="product-description">${escapeHtml(product.shortDescription || 'No description available yet.')}</p>
        <p class="product-tags">${tags || '#new'}</p>
        <p class="product-fulfillment-note">${escapeHtml(physicalSummary)}</p>

        <div class="product-stats" aria-label="Product engagement stats">
          <span>👍 ${likes}</span>
          <span>👎 ${dislikes}</span>
        </div>

        <div class="product-actions">
          <button type="button" class="preview-btn" ${(product.previewAssignment?.hoverAudioURL || product.previewAssignment?.hoverVideoURL || product.previewAudioURLs.length || product.primaryPreviewURL) ? '' : 'disabled'} aria-label="Preview ${escapeHtml(product.title)}">▶ Preview</button>
          <button type="button" class="add-btn" data-product-card-action data-product-id="${escapeHtml(product.id)}" ${isOwnProduct || physicalSoldOut ? 'disabled' : ''} aria-label="${escapeHtml(actionLabel)} ${escapeHtml(product.title)}">${escapeHtml(actionLabel)}</button>
        </div>
      </div>
    </article>
  `
}

function renderProductSkeletons(count = 6, loadingMore = false) {
  return Array.from({ length: count }).map(() => `
    <article class="product-card product-card-skeleton ${loadingMore ? 'is-loading-more' : ''}" aria-hidden="true">
      <div class="product-cover product-skeleton-block"></div>
      <div class="product-content">
        <div class="product-skeleton-line short"></div>
        <div class="product-skeleton-line medium"></div>
        <div class="product-skeleton-line tiny"></div>
        <div class="product-skeleton-line"></div>
        <div class="product-skeleton-line short"></div>
        <div class="product-skeleton-actions">
          <div class="product-skeleton-pill"></div>
          <div class="product-skeleton-pill"></div>
        </div>
      </div>
    </article>
  `).join('')
}

function toReleaseTimestamp(product) {
  return new Date(product.releasedAt || product.createdAt || 0).getTime() || 0
}

function applyClientFilters(products) {
  const tokens = normalizeSearchTokens(state.filters.search)
  const categoryKey = normalizeKey(state.filters.category)
  const genreKey = normalizeKey(state.filters.genre)
  const tagTokens = normalizeSearchTokens(state.filters.tags)
  const dawKey = normalizeKey(state.filters.daw)
  const formatKey = normalizeKey(state.filters.format)

  return products.filter((product) => {
    const fulfillment = normalizeProductFulfillment(product)
    const physical = fulfillment.physical
    const haystack = [
      product.title,
      product.artistName,
      product.artistUsername,
      ...(product.tags || []),
      ...(product.genres || []),
      ...(product.categories || []),
      ...(product.contributorNames || [])
    ].join(' ').toLowerCase()

    if (tokens.length && !tokens.every((token) => haystack.includes(token))) return false
    if (state.filters.productFormat !== 'All formats' && fulfillment.type !== normalizeKey(state.filters.productFormat)) return false
    if (state.filters.condition !== 'Any condition' && normalizeKey(physical.condition) !== normalizeKey(state.filters.condition)) return false
    if (state.filters.shippingMode !== 'Any shipping' && normalizeKey(shippingModeLabel(physical.shipping.mode)) !== normalizeKey(state.filters.shippingMode)) return false
    if (state.filters.category !== 'All categories' && !(product.categoryKeys || []).includes(categoryKey) && normalizeKey(product.productType) !== categoryKey) return false
    if (state.filters.genre !== 'All genres' && !(product.genreKeys || []).includes(genreKey)) return false
    if (state.filters.daw !== 'Any DAW' && !(product.dawCompatibility || []).includes(dawKey)) return false
    if (state.filters.format !== 'Any format' && !(product.formatKeys || []).includes(formatKey)) return false

    if (state.filters.priceType === 'Free only' && !product.isFree) return false
    if (state.filters.priceType === 'Paid only' && product.isFree) return false

    const minCents = Number(state.filters.minPrice) * 100
    const maxCents = Number(state.filters.maxPrice) * 100
    if (Number.isFinite(minCents) && state.filters.minPrice !== '' && product.priceCents < minCents) return false
    if (Number.isFinite(maxCents) && state.filters.maxPrice !== '' && product.priceCents > maxCents) return false

    if (state.filters.contributors === 'Solo creator' && Number(product.contributorCount || 0) !== 1) return false
    if (state.filters.contributors === '2+ contributors' && Number(product.contributorCount || 0) < 2) return false
    if (state.filters.contributors === '5+ contributors' && Number(product.contributorCount || 0) < 5) return false

    if (tagTokens.length && !tagTokens.every((token) => (product.tagKeys || []).some((tag) => tag.includes(token)))) return false

    const releaseTs = toReleaseTimestamp(product)
    const now = Date.now()
    if (state.filters.releaseWindow === 'Last 7 days' && releaseTs < now - (7 * 86400000)) return false
    if (state.filters.releaseWindow === 'Last 30 days' && releaseTs < now - (30 * 86400000)) return false
    if (state.filters.releaseWindow === 'Last 90 days' && releaseTs < now - (90 * 86400000)) return false
    if (state.filters.releaseWindow === 'This year' && new Date(releaseTs).getFullYear() !== new Date().getFullYear()) return false

    return true
  })
}

function renderProducts() {
  const grid = app.querySelector('[data-products-grid]')
  if (!grid) return

  if (state.isLoadingInitial) {
    grid.innerHTML = renderProductSkeletons(10)
    return
  }

  if (state.hasFatalError && !state.products.length) {
    grid.innerHTML = `
      <article class="product-empty-state">
        <h3>Could not load products</h3>
        <p>We couldn’t reach the catalog right now. Please refresh and try again.</p>
      </article>
    `
    return
  }

  const filtered = applyClientFilters(state.products)

  if (!filtered.length) {
    grid.innerHTML = `
      <article class="product-empty-state">
        <h3>No matching products found</h3>
        <p>Try adjusting your filters or clearing advanced options.</p>
      </article>
    `
  } else {
    const groups = [
      { type: 'digital', title: 'Digital Products' },
      { type: 'physical', title: 'Physical Products' },
      { type: 'hybrid', title: 'Hybrid Products' }
    ]
    grid.innerHTML = groups.map((group) => {
      const products = filtered.filter((product) => normalizeProductFulfillment(product).type === group.type)
      if (!products.length) return ''
      return `
        <section class="products-group" data-product-group="${group.type}">
          <div class="products-group-header"><h2>${escapeHtml(group.title)}</h2><span>${products.length}</span></div>
          <div class="products-group-grid">${products.map((product) => productCardMarkup(product)).join('')}</div>
        </section>
      `
    }).join('')
  }

  const loadingMore = app.querySelector('[data-products-loading-more]')
  if (loadingMore) {
    loadingMore.innerHTML = state.isLoadingMore ? renderProductSkeletons(3, true) : ''
  }

  bindProductActions(filtered)
}

function mapFiltersForService() {
  const searchTokens = normalizeSearchTokens(state.filters.search)
  return {
    searchToken: searchTokens[0] || '',
    categoryKey: state.filters.category === 'All categories' ? '' : normalizeKey(state.filters.category),
    genreKey: state.filters.genre === 'All genres' ? '' : normalizeKey(state.filters.genre),
    priceType: state.filters.priceType === 'Free only' ? 'free' : state.filters.priceType === 'Paid only' ? 'paid' : '',
    minPriceCents: state.filters.minPrice === '' ? null : Math.round(Number(state.filters.minPrice) * 100),
    maxPriceCents: state.filters.maxPrice === '' ? null : Math.round(Number(state.filters.maxPrice) * 100),
    minContributorCount: state.filters.contributors === '2+ contributors' ? 2 : state.filters.contributors === '5+ contributors' ? 5 : state.filters.contributors === 'Solo creator' ? 1 : 0,
    daw: state.filters.daw === 'Any DAW' ? '' : normalizeKey(state.filters.daw),
    format: state.filters.format === 'Any format' ? '' : normalizeKey(state.filters.format),
    tagKey: normalizeSearchTokens(state.filters.tags)[0] || ''
  }
}

async function loadNextPage({ reset = false } = {}) {
  if (state.hasFatalError) return
  if (state.isLoadingInitial || state.isLoadingMore) return
  if (!state.hasMore && !reset) return

  if (reset) {
    state.products = []
    state.productIds = new Set()
    state.cursor = null
    state.hasMore = true
    state.isLoadingInitial = true
    renderProducts()
  } else {
    state.isLoadingMore = true
    renderProducts()
  }

  try {
    const { products, nextCursor, hasMore } = await listPublicProductsPage({
      filters: mapFiltersForService(),
      sort: state.filters.sort,
      pageSize: PAGE_SIZE,
      cursor: reset ? null : state.cursor
    })

    const unique = products.filter((product) => {
      if (state.productIds.has(product.id)) return false
      state.productIds.add(product.id)
      return true
    })

    state.products = [...state.products, ...unique]
    state.cursor = nextCursor
    state.hasMore = hasMore
    state.hasFatalError = false
  } catch (error) {
    console.warn('[products] Failed to load product page.', error?.message || error)
    state.hasFatalError = true
  } finally {
    state.isLoadingInitial = false
    state.isLoadingMore = false
    renderProducts()
  }
}

function bindProductActions(visibleProducts = []) {
  app.querySelectorAll('[data-open-product]').forEach((card) => {
    const openDashboard = () => {
      const productId = card.getAttribute('data-product-id')
      if (!productId) return
      const product = state.products.find((entry) => entry.id === productId)
      stopPreview()
      window.location.href = productRoute(product || productId)
    }

    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-product-card-action], .preview-btn, [data-artist-link]')) return
      openDashboard()
    })

    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (event.target.closest('[data-product-card-action], .preview-btn, [data-artist-link]')) return
      event.preventDefault()
      openDashboard()
    })
  })

  app.querySelectorAll('.preview-btn').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.stopPropagation()
      const card = button.closest('[data-open-product]')
      const productId = card?.getAttribute('data-product-id') || ''
      const product = visibleProducts.find((entry) => entry.id === productId)
      if (!product) return
      togglePreview(product, card, button)
    })
  })

  app.querySelectorAll('[data-product-card-action]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.stopPropagation()
      const id = button.getAttribute('data-product-id')
      const product = state.products.find((entry) => entry.id === id) || visibleProducts.find((entry) => entry.id === id)
      if (!product) return
      const isFreeProduct = Boolean(product.isFree) || Number(product.priceCents || 0) <= 0
      if (isFreeProduct) {
        const freeActionLabel = hasDigitalFulfillment(product) ? 'Add to Library' : 'Claim'
        if (!state.currentUser?.uid) {
          window.location.assign(authRoute({ redirect: productRoute(product) }))
          return
        }
        button.disabled = true
        button.textContent = 'Adding...'
        try {
          await claimFreeProduct(state.currentUser.uid, product.id)
          button.textContent = 'In Library'
        } catch (error) {
          console.warn('[products] free claim failed', { code: error?.code, message: error?.message })
          button.disabled = false
          button.textContent = freeActionLabel
        }
        return
      }
      addToCart(product)
      button.textContent = 'Added'
      setTimeout(() => {
        button.textContent = 'Add to cart'
      }, 900)
      document.querySelector('[data-cart-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
  })

  app.querySelectorAll('[data-open-product]').forEach((card) => {
    const productId = card.getAttribute('data-product-id') || ''
    const product = visibleProducts.find((entry) => entry.id === productId)
    if (!product) return
    const hasAssignedAudio = Boolean(product.previewAssignment?.hoverAudioURL || product.previewAudioURLs?.[0] || product.primaryPreviewURL)
    const hasAssignedVideo = Boolean(product.previewVideoURLs?.[0] || product.previewAssignment?.hoverVideoURL)
    const canHoverPreview = Boolean(product.previewAssignment?.hoverEnabled && (hasAssignedAudio || hasAssignedVideo))
    if (!canHoverPreview) return
    card.addEventListener('pointerenter', () => {
      clearTimeout(previewController.hoverTimer)
      card.classList.add('preview-arming')
      startPreview(product, card, false)
    })
    card.addEventListener('pointerleave', () => stopPreview(card))
    card.addEventListener('focusin', () => {
      clearTimeout(previewController.hoverTimer)
      startPreview(product, card, false)
    })
    card.addEventListener('focusout', () => stopPreview(card))
  })
}

function stopPreview(card = null) {
  clearTimeout(previewController.hoverTimer)
  if (previewController.activeAudio) {
    previewController.activeAudio.pause()
    previewController.activeAudio.currentTime = 0
  }
  if (previewController.activeVideoCard) previewController.activeVideoCard.classList.remove('is-preview-playing')
  app.querySelectorAll('.product-preview-video').forEach((video) => { video.pause(); video.removeAttribute('src'); video.load() })
  previewController.activeProductId = ''
  previewController.activeVideoCard = null
  app.querySelectorAll('.preview-btn').forEach((btn) => { btn.textContent = '▶ Preview' })
  app.querySelectorAll('.product-card').forEach((item) => item.classList.remove('preview-arming'))
  if (card) card.classList.remove('preview-arming')
}

function getAssignedAudio(product) {
  return product?.previewAssignment?.hoverAudioURL || product?.previewAudioURLs?.[0] || product?.primaryPreviewURL || ''
}

function getAssignedVideo(product) {
  return product?.previewVideoURLs?.[0] || product?.previewAssignment?.hoverVideoURL || ''
}

async function startPreview(product, card, explicitClick = false) {
  stopPreview()
  const audioSrc = getAssignedAudio(product)
  const videoSrc = getAssignedVideo(product)
  const shouldVideo = Boolean(videoSrc)
  const shouldAudio = Boolean(audioSrc)
  previewController.activeProductId = product.id

  const playPromises = []
  if (shouldVideo && videoSrc) {
    const video = card?.querySelector('[data-preview-video-el]')
    if (video) {
      video.src = videoSrc
      video.muted = true
      video.loop = true
      video.playsInline = true
      video.autoplay = true
      previewController.activeVideoCard = card
      card.classList.add('is-preview-playing')
      playPromises.push(video.play().catch(() => {}))
    }
  }

  if (shouldAudio && audioSrc) {
    if (!previewController.activeAudio) previewController.activeAudio = new Audio()
    previewController.activeAudio.src = audioSrc
    try {
      playPromises.push(previewController.activeAudio.play())
      card?.querySelector('.preview-btn')?.replaceChildren(document.createTextNode('⏸ Preview'))
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[products] hover audio autoplay blocked', error?.message)
      if (explicitClick) {
        // user click still may fail on browser policy edge cases
      }
    }
  }
  await Promise.allSettled(playPromises)
}

function togglePreview(product, card, button) {
  if (previewController.activeProductId === product.id && previewController.activeAudio && !previewController.activeAudio.paused) {
    stopPreview(card)
    return
  }
  startPreview(product, card, true)
  if (button) button.textContent = '⏸ Preview'
}

function setFilter(key, value) {
  state.filters[key] = value
  loadNextPage({ reset: true })
}

function bindCatalogControls() {
  const search = app.querySelector('[data-filter-search]')
  const category = app.querySelector('[data-filter-category]')
  const genre = app.querySelector('[data-filter-genre]')
  const sort = app.querySelector('[data-filter-sort]')
  const advancedToggle = app.querySelector('[data-toggle-advanced]')

  search?.addEventListener('input', (event) => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
    const value = event.target.value
    searchDebounceTimer = setTimeout(() => {
      state.filters.search = value
      loadNextPage({ reset: true })
    }, SEARCH_DEBOUNCE_MS)
  })

  category?.addEventListener('change', (event) => {
    setFilter('category', event.target.value)
    const sidebarCategory = app.querySelector('[data-sidebar-filter="category"]')
    if (sidebarCategory) sidebarCategory.value = event.target.value
  })
  genre?.addEventListener('change', (event) => setFilter('genre', event.target.value))
  sort?.addEventListener('change', (event) => setFilter('sort', event.target.value))

  advancedToggle?.addEventListener('click', () => {
    state.filters.advancedOpen = !state.filters.advancedOpen
    app.querySelector('[data-advanced-panel]')?.classList.toggle('is-open', state.filters.advancedOpen)
    advancedToggle.setAttribute('aria-expanded', String(state.filters.advancedOpen))
    advancedToggle.textContent = state.filters.advancedOpen ? 'Advanced ▲' : 'Advanced'
  })

  app.querySelectorAll('[data-advanced-field]').forEach((field) => {
    const key = field.getAttribute('data-advanced-field')
    field.addEventListener('change', (event) => setFilter(key, event.target.value))
    field.addEventListener('input', (event) => {
      if (field.tagName !== 'INPUT') return
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
      const value = event.target.value
      searchDebounceTimer = setTimeout(() => {
        setFilter(key, value)
      }, SEARCH_DEBOUNCE_MS)
    })
  })

  app.querySelectorAll('[data-sidebar-filter]').forEach((field) => {
    const key = field.getAttribute('data-sidebar-filter')
    field.addEventListener('change', (event) => {
      setFilter(key, event.target.value)
      if (key === 'category' && category) category.value = event.target.value
    })
  })

  app.querySelector('[data-reset-filters]')?.addEventListener('click', () => {
    state.filters = { ...defaultFilters }
    app.querySelectorAll('[data-filter], [data-advanced-field], [data-sidebar-filter]').forEach((field) => {
      if (field.tagName === 'SELECT') field.selectedIndex = 0
      if (field.tagName === 'INPUT') field.value = ''
    })
    app.querySelector('[data-advanced-panel]')?.classList.remove('is-open')
    app.querySelector('[data-toggle-advanced]')?.setAttribute('aria-expanded', 'false')
    app.querySelector('[data-toggle-advanced]').textContent = 'Advanced'
    loadNextPage({ reset: true })
  })
}

function setupInfiniteScroll() {
  const sentinel = app.querySelector('[data-products-sentinel]')
  if (!sentinel) return
  observer?.disconnect()
  observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return
      if (state.isLoadingInitial || state.isLoadingMore || !state.hasMore || state.hasFatalError) return
      loadNextPage({ reset: false })
    })
  }, { rootMargin: '260px 0px 260px 0px' })

  observer.observe(sentinel)
}

app.innerHTML = `
  ${renderPagePreloaderMarkup()}
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
      <div class="section-inner hero-content-layer products-hero-shell">
        <div>
          <p class="eyebrow">Marketplace</p>
          <h1>Products</h1>
          <p class="products-intro">
            Browse sample packs, presets, wavetables, tools, and creator-made releases across the Melogic catalog.
          </p>
        </div>
        <a class="new-product-btn" href="${ROUTES.newProduct}" aria-label="Create a new product">+ Product</a>
      </div>
    </section>

    <section class="section products-catalog">
      <div class="section-inner" data-marketplace-root>
        <div class="products-filter-row" aria-label="Catalog controls">
          <label class="filter-control filter-search">
            <span>Search</span>
            <input data-filter data-filter-search type="search" placeholder="Search products or creators" />
          </label>
          <label class="filter-control">
            <span>Category</span>
            <select data-filter data-filter-category>
              ${categoryOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
            </select>
          </label>
          <label class="filter-control">
            <span>Genre</span>
            <select data-filter data-filter-genre>
              ${genreOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}
            </select>
          </label>
          <label class="filter-control">
            <span>Sort</span>
            <select data-filter data-filter-sort>
              ${sortOptions.map((option) => `<option value="${option.value}">${option.label}</option>`).join('')}
            </select>
          </label>
          <button type="button" class="advanced-toggle" data-toggle-advanced aria-expanded="false">Advanced</button>
        </div>

        <section class="products-advanced-panel" data-advanced-panel>
          <div class="products-advanced-grid">
            <label class="filter-control"><span>DAW compatibility</span><select data-advanced-field="daw"><option>Any DAW</option><option>Logic Pro</option><option>Ableton Live</option><option>FL Studio</option><option>Pro Tools</option><option>Cubase</option><option>Studio One</option><option>Reaper</option><option>Bitwig</option><option>GarageBand</option><option>Other</option></select></label>
            <label class="filter-control"><span>Price type</span><select data-advanced-field="priceType"><option>Any price</option><option>Free only</option><option>Paid only</option></select></label>
            <label class="filter-control"><span>Min price</span><input type="number" min="0" step="0.01" placeholder="0" data-advanced-field="minPrice" /></label>
            <label class="filter-control"><span>Max price</span><input type="number" min="0" step="0.01" placeholder="100" data-advanced-field="maxPrice" /></label>
            <label class="filter-control"><span>Contributors</span><select data-advanced-field="contributors"><option>Any contributor count</option><option>Solo creator</option><option>2+ contributors</option><option>5+ contributors</option></select></label>
            <label class="filter-control"><span>Tags</span><input type="search" placeholder="Tags, moods, tools…" data-advanced-field="tags" /></label>
            <label class="filter-control"><span>Release window</span><select data-advanced-field="releaseWindow"><option>Any time</option><option>Last 7 days</option><option>Last 30 days</option><option>Last 90 days</option><option>This year</option></select></label>
            <label class="filter-control"><span>Product format</span><select data-advanced-field="format"><option>Any format</option><option>Audio files</option><option>MIDI</option><option>Serum presets</option><option>Vital presets</option><option>Project files</option><option>Plugin installer</option><option>PDF / course files</option></select></label>
          </div>
          <div class="products-advanced-actions">
            <button type="button" class="button button-muted" data-reset-filters>Reset</button>
          </div>
        </section>

        <div class="products-catalog-layout">
          <aside class="products-sidebar" aria-label="Marketplace filters">
            <div class="products-sidebar-section">
              <h2>Product Type</h2>
              <label class="filter-control"><span>Format</span><select data-sidebar-filter="productFormat"><option>All formats</option><option>Digital</option><option>Physical</option><option>Hybrid</option></select></label>
            </div>
            <div class="products-sidebar-section">
              <h2>Physical Filters</h2>
              <label class="filter-control"><span>Condition</span><select data-sidebar-filter="condition"><option>Any condition</option><option>New</option><option>Like New</option><option>Good</option><option>Fair</option><option>Used / Vintage</option><option>Made to Order</option></select></label>
              <label class="filter-control"><span>Shipping</span><select data-sidebar-filter="shippingMode"><option>Any shipping</option><option>Flat-rate shipping</option><option>Free shipping</option><option>Seller will contact buyer</option><option>Local pickup</option></select></label>
            </div>
            <div class="products-sidebar-section">
              <h2>Categories</h2>
              <label class="filter-control"><span>Category</span><select data-sidebar-filter="category">${categoryOptions.map((option) => `<option>${escapeHtml(option)}</option>`).join('')}</select></label>
            </div>
          </aside>
          <div class="products-main-results">
            <div class="products-grid" role="list" aria-label="Product catalog" data-products-grid></div>
            <div class="products-loading-more" data-products-loading-more></div>
            <div class="products-sentinel" data-products-sentinel aria-hidden="true"></div>
          </div>
        </div>
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

const logoReadyPromise = initShellChrome()
const heroReadyPromise = initProductsHeroVideo()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })
mountMarketplaceAdRails()
bindCatalogControls()
setupInfiniteScroll()
loadNextPage({ reset: true })

waitForInitialAuthState().then((user) => {
  state.currentUser = user || null
  renderProducts()
})

subscribeToAuthState((user) => {
  state.currentUser = user || null
  renderProducts()
})
