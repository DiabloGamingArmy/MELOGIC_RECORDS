import './styles/base.css'
import './styles/profilePublic.css'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { addToCart } from './data/cartService'
import { createReport } from './data/productService'
import { getPublicProfile, getUidForUsername, db } from './firebase/firestore'
import { waitForInitialAuthState } from './firebase/auth'
import { storage } from './firebase/storage'
import { ROUTES, authRoute, cleanRedirectTarget, getCurrentPath, productRoute } from './utils/routes'
import { formatUsername } from './utils/format'

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


const BADGE_CONFIG = {
  moderator: { label: 'Moderator', fileName: 'moderatorBadge.png', className: 'public-role-badge-icon' },
  founder: { label: 'Founder', fileName: 'founderBadge.png', className: 'public-role-badge-icon' },
  beta: { label: 'Beta Tester', fileName: 'betaBadge.png', className: 'public-role-badge-icon' },
  pro: { label: 'Melogic Pro', fileName: 'proBadge.png', className: 'public-role-badge-icon' },
  verified: { label: 'Verified', fileName: 'verifiedBadge.png', className: 'public-verified-badge-icon' }
}

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
  visibleCount: 8,
  profile: null,
  currentUser: null,
  previewMode: false,
  productsByUid: new Map(),
  parallaxBound: false,
  marqueeTicker: null,
  badgeUrls: {},
  report: { open: false, submitting: false, error: '', message: '' }
}

const PROFILE_REPORT_REASONS = [
  'Impersonation',
  'Harassment or abuse',
  'Spam',
  'Misleading profile',
  'Inappropriate content',
  'Other'
]

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


function getProfileRoles(profile = {}) {
  const values = [
    ...(Array.isArray(profile.roles) ? profile.roles : []),
    ...(Array.isArray(profile.publicRoles) ? profile.publicRoles : []),
    ...(Array.isArray(profile.badges) ? profile.badges : []),
    ...(Array.isArray(profile.publicBadges) ? profile.publicBadges : [])
  ]

  return Array.from(new Set(values.map((value) => String(value || '').toLowerCase().trim()).filter(Boolean)))
}

async function loadBadgeAssetUrls() {
  if (!storage) return {}

  const entries = await Promise.all(Object.entries(BADGE_CONFIG).map(async ([key, config]) => {
    try {
      const url = await getDownloadURL(ref(storage, `assets/badges/${config.fileName}`))
      return [key, url]
    } catch (error) {
      console.warn('[profilePublic] badge asset failed to load', { key, fileName: config.fileName, code: error?.code, message: error?.message })
      return [key, '']
    }
  }))

  return Object.fromEntries(entries)
}

function badgeIconMarkup(key, extraClass = '') {
  const config = BADGE_CONFIG[key]
  const url = uiState.badgeUrls?.[key]
  if (!config || !url) return ''
  const classes = [config.className, extraClass].filter(Boolean).join(' ')
  return `<img class="${escapeHtml(classes)}" src="${escapeHtml(url)}" alt="${escapeHtml(config.label)} badge" title="${escapeHtml(config.label)}" loading="lazy" />`
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

function normalizeFeaturedItems(raw = {}) {
  const productIds = Array.isArray(raw?.productIds)
    ? raw.productIds.map((id) => String(id || '').trim()).filter(Boolean)
    : []
  return {
    enabled: Boolean(raw?.enabled),
    productIds
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

function profileReportDialog(profile = {}) {
  if (!uiState.report.open) return ''
  return `
    <div class="public-report-backdrop" role="presentation">
      <section class="public-report-modal" role="dialog" aria-modal="true" aria-labelledby="profile-report-title">
        <header>
          <h2 id="profile-report-title">Report Profile</h2>
          <button type="button" class="public-report-close" data-close-profile-report aria-label="Close report modal">&times;</button>
        </header>
        ${uiState.report.message ? `<p class="public-report-success">${escapeHtml(uiState.report.message)}</p>` : `
          <form data-profile-report-form>
            <label>
              <span>Reason</span>
              <select name="reason" required>
                <option value="">Choose a reason</option>
                ${PROFILE_REPORT_REASONS.map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Description</span>
              <textarea name="description" rows="5" maxlength="2000" placeholder="Add details that can help marketplace staff review this profile."></textarea>
            </label>
            ${uiState.report.error ? `<p class="public-report-error">${escapeHtml(uiState.report.error)}</p>` : ''}
            <div class="public-report-actions">
              <button type="button" class="button button-muted" data-close-profile-report ${uiState.report.submitting ? 'disabled' : ''}>Cancel</button>
              <button type="submit" class="button button-accent" ${uiState.report.submitting ? 'disabled' : ''}>${uiState.report.submitting ? 'Submitting...' : 'Submit Report'}</button>
            </div>
          </form>
        `}
      </section>
    </div>
  `
}

function bindProfileReport(profile = {}) {
  profileRoot.querySelector('[data-report-profile]')?.addEventListener('click', () => {
    if (!uiState.currentUser?.uid) {
      window.location.assign(authRoute({ redirect: getCurrentPath() }))
      return
    }
    if (uiState.currentUser.uid === profile.uid) return
    uiState.report = { open: true, submitting: false, error: '', message: '' }
    renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
  })
  profileRoot.querySelectorAll('[data-close-profile-report]').forEach((button) => {
    button.addEventListener('click', () => {
      uiState.report = { ...uiState.report, open: false, submitting: false, error: '' }
      renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
    })
  })
  profileRoot.querySelector('[data-profile-report-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const reason = String(formData.get('reason') || '').trim()
    const description = String(formData.get('description') || '').trim()
    if (!reason) {
      uiState.report.error = 'Choose a reason before submitting.'
      renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
      return
    }
    if (reason === 'Other' && !description) {
      uiState.report.error = 'Description is required when reason is Other.'
      renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
      return
    }
    uiState.report = { ...uiState.report, submitting: true, error: '' }
    renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
    try {
      await createReport({
        targetType: 'profile',
        targetId: profile.uid,
        targetOwnerUid: profile.uid,
        reason,
        description,
        sourcePath: publicProfileRoute({ uid: profile.uid }),
        metadata: {
          displayName: profile.displayName || '',
          username: profile.username || profile.usernameLower || ''
        }
      })
      uiState.report = { open: true, submitting: false, error: '', message: 'Thank you. Your report has been submitted.' }
      renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
      window.setTimeout(() => {
        if (uiState.report.message) {
          uiState.report = { ...uiState.report, open: false }
          renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
        }
      }, 1200)
    } catch (error) {
      console.warn('[profilePublic] report failed', { code: error?.code, message: error?.message, details: error?.details })
      uiState.report = { ...uiState.report, submitting: false, error: error?.message || 'Could not submit this report.' }
      renderPublicProfile(profile, uiState.currentUser, uiState.previewMode)
    }
  })
}

// TODO: Add verified badge in additional username surfaces once role hydration is included in those payloads.
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
        <article class="public-content-empty"><p>No public products yet.</p></article>
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

function renderFeaturedSection(profile, displayName) {
  const featured = normalizeFeaturedItems(profile.featuredItems)
  if (!featured.enabled || !featured.productIds.length) {
    return { hasFeaturedItems: false, markup: '' }
  }

  const availableProducts = uiState.productsByUid.get(profile.uid || '') || []
  const byId = new Map(availableProducts.map((product) => [String(product.id), product]))
  const featuredProducts = featured.productIds
    .map((id) => byId.get(id))
    .filter(Boolean)
    .slice(0, 3)

  if (!featuredProducts.length) return { hasFeaturedItems: false, markup: '' }

  return {
    hasFeaturedItems: true,
    markup: `
      <article class="public-glass-panel public-featured-panel">
        <p class="public-panel-label">FEATURED ITEMS:</p>
        <div class="public-featured-scroll" role="list" aria-label="Featured items">
          ${featuredProducts.map((product) => `<div class="public-featured-item" role="listitem">${productCardMarkup(product, displayName)}</div>`).join('')}
        </div>
      </article>
    `
  }
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
    const offset = Math.min(52, y * 0.14)
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
  const username = formatUsername(profile.username || profile.usernameLower)
  const bio = profile.bio || 'No bio has been added yet.'
  const avatarURL = profile.avatarURL || profile.photoURL || ''
  const bannerURL = profile.bannerURL || ''
  const roleLabel = profile.roleLabel || 'User'
  const stats = getStats(profile)
  const isLongName = displayName.length > 16
  const featuredSection = renderFeaturedSection(profile, displayName)
  const roles = getProfileRoles(profile)
  const hasVerified = roles.includes('verified')
  const profileBadgeKeys = ['founder', 'moderator', 'beta', 'pro'].filter((key) => roles.includes(key))

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
        <button class="button button-muted public-hero-btn-outline" type="button" data-report-profile>Report This Profile</button>
      `
      : `
        <a class="button button-accent public-hero-btn-primary" href="${authRoute({ redirect: getCurrentPath() })}">Sign in to interact</a>
        <button class="button button-muted public-hero-btn-outline" type="button" data-report-profile>Report This Profile</button>
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
            <p class="public-handle"><span>${escapeHtml(username || 'No username')}</span>${hasVerified ? badgeIconMarkup('verified', 'is-inline-verified') : ''}</p>
            <p class="public-role">${escapeHtml(roleLabel)}</p>
            <div class="public-badge-row" aria-label="Profile badges">${profileBadgeKeys.map((key) => badgeIconMarkup(key)).join('') || '<span class="public-badge-empty">No badges yet</span>'}</div>
            <div class="public-actions">${actionsMarkup}</div>
          </div>
        </div>
      </div>
    </section>

    <section class="public-main-wrap">
      <div class="public-panels-grid ${featuredSection.hasFeaturedItems ? '' : 'is-single'}">
        ${featuredSection.markup}
        <article class="public-glass-panel">
          <p class="public-panel-label">ABOUT ${escapeHtml(displayName).toUpperCase()}:</p>
          <div class="public-panel-body">
            <p>${escapeHtml(bio)}</p>
          </div>
        </article>
      </div>

      <div class="public-content-divider" aria-hidden="true"><span>Content</span></div>

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
    ${profileReportDialog(profile)}
  `

  profileRoot.querySelectorAll('[data-category]').forEach((button) => {
    button.addEventListener('click', async () => {
      const nextCategory = button.getAttribute('data-category')
      if (!nextCategory || nextCategory === uiState.activeCategory) return
      uiState.activeCategory = nextCategory
      uiState.visibleCount = 8
      if (nextCategory === 'products') {
        await loadPublicProductsForArtist(profile.uid || '')
      }
      renderPublicProfile(uiState.profile, uiState.currentUser, uiState.previewMode)
    })
  })

  profileRoot.querySelector('[data-load-more]')?.addEventListener('click', () => {
    uiState.visibleCount += 8
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
  bindProfileReport(profile)
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

  if (pathname.startsWith('/profiles/')) {
    const encodedUid = pathname.slice('/profiles/'.length).split('/')[0]
    const decodedProfile = decodeURIComponent(encodedUid || '').trim()
    if (decodedProfile) return (await getUidForUsername(decodedProfile)) || decodedProfile
  }

  return ''
}

async function initPublicProfile() {
  const currentUser = await waitForInitialAuthState()
  const params = new URLSearchParams(window.location.search)
  const uid = await resolveUid(params)
  const previewMode = params.get('preview') === 'public'

  if (!uid) return renderNotFound()

  const pathname = String(window.location.pathname || '')
  const isCanonicalPublicPath = pathname.startsWith('/u/') || pathname.startsWith('/profiles/')
  if (currentUser?.uid === uid && !previewMode && !isCanonicalPublicPath) {
    window.location.assign(ROUTES.profile)
    return
  }

  const profile = await getPublicProfile(uid)
  if (!profile) return renderNotFound()

  await loadPublicProductsForArtist(uid)
  uiState.badgeUrls = await loadBadgeAssetUrls()

  uiState.profile = profile
  uiState.currentUser = currentUser
  uiState.previewMode = Boolean(currentUser?.uid === uid && previewMode)
  uiState.activeCategory = 'products'
  uiState.visibleCount = 8

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
