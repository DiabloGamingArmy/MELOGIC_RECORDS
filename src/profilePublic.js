import './styles/base.css'
import './styles/profilePublic.css'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { addToCart } from './data/cartService'
import { getPublicProfile, getUidForUsername, db } from './firebase/firestore'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, cleanRedirectTarget, getCurrentPath, productRoute } from './utils/routes'

const app = document.querySelector('#app')

app.innerHTML = `
  ${renderPagePreloaderMarkup()}
  ${navShell({ currentPage: 'profile-public' })}
  <main class="public-profile-page" data-public-profile-root>
    <section class="public-profile-loading">
      <article class="public-profile-card"><p>Loading profile...</p></article>
    </section>
  </main>
`

const logoReadyPromise = initShellChrome()
createCriticalAssetPreloader({ logoReadyPromise })

const profileRoot = document.querySelector('[data-public-profile-root]')

const CATEGORY_CONFIG = [
  { key: 'products', label: 'Products', defaultCount: 0 },
  { key: 'savedItems', label: 'Saved Items', defaultCount: 12 },
  { key: 'comments', label: 'Comments', defaultCount: 4 },
  { key: 'likes', label: 'Likes', defaultCount: 18 },
  { key: 'downloads', label: 'Downloads', defaultCount: 3 }
]

const EMPTY_COPY = {
  savedItems: 'Saved items will appear here.',
  comments: 'Public comments will appear here.',
  likes: 'Liked items will appear here.',
  downloads: 'Public download stats will appear here.'
}

const uiState = {
  activeCategory: 'products',
  visibleCount: 6,
  profile: null,
  currentUser: null,
  previewMode: false,
  productsByUid: new Map(),
  parallaxBound: false,
  marqueeTicker: null
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function isReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function getStats(profile = {}) {
  const stats = profile.stats || {}
  return {
    products: stats.products ?? profile.productsCount ?? 0,
    savedItems: stats.savedItems ?? profile.savedCount ?? 12,
    comments: stats.comments ?? profile.commentsCount ?? 4,
    likes: stats.likes ?? profile.likesCount ?? 18,
    downloads: stats.downloads ?? profile.downloadsCount ?? 3
  }
}

async function loadPublicProductsForArtist(uid) {
  if (!uid || !db) return []
  if (uiState.productsByUid.has(uid)) return uiState.productsByUid.get(uid)

  const productsRef = collection(db, 'products')
  const productsQuery = query(
    productsRef,
    where('artistId', '==', uid),
    where('status', '==', 'published'),
    where('visibility', '==', 'public'),
    limit(40)
  )

  const snap = await getDocs(productsQuery)
  const rows = snap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
  uiState.productsByUid.set(uid, rows)
  return rows
}

function renderNotFound() {
  profileRoot.innerHTML = `
    <article class="public-profile-card public-profile-empty">
      <h1>Profile not found</h1>
      <p>We could not find that profile. Please check the link and try again.</p>
      <a class="button button-accent" href="${ROUTES.products}">Browse Products</a>
    </article>
  `
}

function productCardMarkup(product, displayName) {
  const title = product.title || 'Untitled product'
  const art = product.thumbnailURL || product.coverURL || ''
  const priceLabel = product.isFree ? 'Free' : (product.priceLabel || '—')
  const tags = (product.tags || []).slice(0, 3)
  return `
    <article class="public-product-card">
      <a class="public-product-link" href="${productRoute(product)}" aria-label="View ${escapeHtml(title)}">
        <div class="public-product-thumb ${art ? 'has-image' : ''}">
          ${art ? `<img src="${escapeHtml(art)}" alt="${escapeHtml(title)} cover" loading="lazy" />` : '<div class="public-product-fallback"></div>'}
        </div>
      </a>
      <div class="public-product-body">
        <p class="public-product-price">${escapeHtml(priceLabel)}</p>
        <h4>${escapeHtml(title)}</h4>
        <p class="public-product-artist">by ${escapeHtml(product.artistName || displayName)}</p>
        <p class="public-product-tags">${tags.length ? tags.map((tag) => `#${escapeHtml(tag)}`).join(' · ') : '#new'}</p>
        <div class="public-product-actions">
          <button type="button" class="button button-accent" data-add-public-cart="${escapeHtml(product.id)}">Add to Cart</button>
          <a class="button button-muted" href="${productRoute(product)}">View Product</a>
        </div>
      </div>
    </article>
  `
}

function renderCategorySection(profile) {
  const displayName = profile.displayName || 'Melogic Creator'
  if (uiState.activeCategory !== 'products') {
    return `
      <section class="public-content-section">
        <article class="public-content-empty"><p>${EMPTY_COPY[uiState.activeCategory]}</p></article>
      </section>
    `
  }

  const products = uiState.productsByUid.get(profile.uid || '') || []
  if (!products.length) {
    return `
      <section class="public-content-section">
        <article class="public-content-empty"><p>Product module coming soon</p></article>
      </section>
    `
  }

  const visible = products.slice(0, uiState.visibleCount)
  return `
    <section class="public-content-section">
      <div class="public-products-grid">
        ${visible.map((product) => productCardMarkup(product, displayName)).join('')}
      </div>
      ${uiState.visibleCount < products.length ? '<div class="public-load-more-wrap"><button type="button" class="button button-muted" data-load-more>Load more</button></div>' : ''}
    </section>
  `
}

function bindParallax() {
  if (uiState.parallaxBound) return
  uiState.parallaxBound = true

  if (isReducedMotion()) {
    document.documentElement.style.setProperty('--public-parallax-y', '0px')
    return
  }

  let ticking = false
  const update = () => {
    const y = window.scrollY || 0
    const offset = Math.max(-70, Math.min(0, -y * 0.18))
    document.documentElement.style.setProperty('--public-parallax-y', `${offset}px`)
    ticking = false
  }

  window.addEventListener('scroll', () => {
    if (ticking) return
    ticking = true
    window.requestAnimationFrame(update)
  }, { passive: true })
  update()
}

function bindMarquee() {
  if (uiState.marqueeTicker) {
    window.clearInterval(uiState.marqueeTicker)
    uiState.marqueeTicker = null
  }
  const track = profileRoot.querySelector('.public-name-track')
  if (!track || isReducedMotion()) return

  let offset = 0
  let paused = 0
  const maxShift = Math.max(0, track.scrollWidth - track.parentElement.clientWidth)
  if (!maxShift) return

  uiState.marqueeTicker = window.setInterval(() => {
    if (paused > 0) {
      paused -= 1
      return
    }
    offset += 1
    if (offset >= maxShift) {
      paused = 20
      offset = 0
    }
    track.style.transform = `translateX(${-offset}px)`
  }, 80)
}

function renderPublicProfile(profile, currentUser, previewMode = false) {
  const uid = profile.uid || ''
  const displayName = profile.displayName || 'Melogic Creator'
  const username = profile.username || profile.usernameLower || 'unknown'
  const bio = profile.bio || 'No bio has been added yet.'
  const avatarURL = profile.avatarURL || profile.photoURL || ''
  const bannerURL = profile.bannerURL || ''
  const roleLabel = profile.roleLabel || 'User'
  const stats = getStats(profile)
  const isLongName = displayName.length > 15

  const isSignedIn = Boolean(currentUser?.uid)
  const isSelfPreview = Boolean(previewMode && currentUser?.uid === uid)
  const signedInElsewhere = isSignedIn && currentUser.uid !== uid
  const actionsMarkup = isSelfPreview
    ? `
      <a class="button button-muted public-hero-btn-outline" href="${ROUTES.profile}">Back to Private Profile</a>
      <a class="button button-accent public-hero-btn-primary" href="${ROUTES.editProfile}">Edit Profile</a>
    `
    : signedInElsewhere
      ? `
        <a class="button button-accent public-hero-btn-primary" href="${ROUTES.inbox}?start=${encodeURIComponent(uid)}">Message</a>
        <button class="button button-muted public-hero-btn-outline" type="button" disabled aria-disabled="true" title="Follow is coming soon">Follow</button>
      `
      : `
        <a class="button button-accent public-hero-btn-primary" href="${authRoute({ redirect: getCurrentPath() })}">Sign in to interact</a>
      `

  profileRoot.innerHTML = `
    <section class="public-hero">
      <div class="public-hero-bg" style="${bannerURL ? `background-image:url('${escapeHtml(bannerURL)}')` : ''}"></div>
      <div class="public-hero-overlay"></div>
      <div class="public-hero-inner">
        <div class="public-hero-identity">
          ${avatarURL ? `<img src="${escapeHtml(avatarURL)}" alt="${escapeHtml(displayName)} avatar" class="public-avatar" />` : '<div class="public-avatar public-avatar-fallback">MR</div>'}
          <div class="public-hero-copy ${isLongName ? 'is-marquee-name' : ''}">
            <div class="public-name-mask"><h1 class="public-name-track">${escapeHtml(displayName)}</h1></div>
            <p class="public-handle">@${escapeHtml(username)}</p>
            <p class="public-role">${escapeHtml(roleLabel)}</p>
            <p class="public-badge-placeholder">Tiny badge icons go here</p>
            <div class="public-actions">${actionsMarkup}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="public-main-wrap">
      <div class="public-panels-grid">
        <article class="public-glass-panel">
          <p class="public-panel-label">FEATURED ITEM:</p>
          <div class="public-panel-body"></div>
        </article>
        <article class="public-glass-panel">
          <p class="public-panel-label">ABOUT ${escapeHtml(displayName).toUpperCase()}:</p>
          <div class="public-panel-body">
            <p>${escapeHtml(bio)}</p>
          </div>
        </article>
      </div>

      <section class="public-stat-grid" aria-label="Public profile categories">
        ${CATEGORY_CONFIG.map((item) => `
          <button type="button" class="public-stat-card ${uiState.activeCategory === item.key ? 'is-active' : ''}" data-category="${item.key}" aria-pressed="${uiState.activeCategory === item.key ? 'true' : 'false'}">
            <span class="public-stat-label">${item.label.toUpperCase()}</span>
            <strong>${stats[item.key] ?? item.defaultCount}</strong>
          </button>
        `).join('')}
      </section>

      ${renderCategorySection(profile)}
    </section>
  `

  profileRoot.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextCategory = button.getAttribute('data-category')
      if (!nextCategory || nextCategory === uiState.activeCategory) return
      uiState.activeCategory = nextCategory
      uiState.visibleCount = 6
      if (nextCategory === 'products') {
        await loadPublicProductsForArtist(profile.uid || '')
      }
      renderPublicProfile(uiState.profile, uiState.currentUser, uiState.previewMode)
    })
  })

  profileRoot.querySelector('[data-load-more]')?.addEventListener('click', () => {
    uiState.visibleCount += 6
    renderPublicProfile(uiState.profile, uiState.currentUser, uiState.previewMode)
  })

  profileRoot.querySelectorAll('[data-add-public-cart]').forEach((button) => {
    button.addEventListener('click', () => {
      const productId = button.getAttribute('data-add-public-cart')
      const products = uiState.productsByUid.get(profile.uid || '') || []
      const match = products.find((item) => String(item.id) === String(productId))
      if (!match) return
      addToCart(match)
      button.textContent = 'Added'
      window.setTimeout(() => {
        button.textContent = 'Add to Cart'
      }, 900)
    })
  })

  bindParallax()
  bindMarquee()
}

async function resolveUid(params) {
  const uid = String(params.get('uid') || '').trim()
  if (uid) return uid

  const queryUsername = String(params.get('username') || '').trim()
  if (queryUsername) return (await getUidForUsername(queryUsername)) || ''

  const pathname = String(window.location.pathname || '')
  if (pathname.startsWith('/u/')) {
    const encodedUsername = pathname.slice(3).split('/')[0]
    const decodedUsername = decodeURIComponent(encodedUsername || '').trim()
    if (decodedUsername) return (await getUidForUsername(decodedUsername)) || ''
  }

  return ''
}

async function initPublicProfile() {
  const currentUser = await waitForInitialAuthState()
  const params = new URLSearchParams(window.location.search)
  const uid = await resolveUid(params)
  const previewMode = params.get('preview') === 'public'

  if (!uid) return renderNotFound()

  if (currentUser?.uid === uid && !previewMode) {
    window.location.assign(ROUTES.profile)
    return
  }

  const profile = await getPublicProfile(uid)
  if (!profile) return renderNotFound()

  await loadPublicProductsForArtist(uid)

  uiState.profile = profile
  uiState.currentUser = currentUser
  uiState.previewMode = Boolean(currentUser?.uid === uid && previewMode)
  uiState.activeCategory = 'products'
  uiState.visibleCount = 6

  renderPublicProfile(profile, currentUser, uiState.previewMode)
}

if (window.location.pathname === '/profile-public.html') {
  const upgradedPath = cleanRedirectTarget(`${window.location.pathname}${window.location.search}${window.location.hash}`, ROUTES.profilePublic)
  if (upgradedPath.startsWith(ROUTES.profilePublic)) {
    window.history.replaceState({}, '', upgradedPath)
  }
}

initPublicProfile().catch(() => {
  renderNotFound()
})
