import './styles/base.css'
import './styles/profilePublic.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { getPublicProfile, getUidForUsername } from './firebase/firestore'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, cleanRedirectTarget, getCurrentPath } from './utils/routes'

const app = document.querySelector('#app')

app.innerHTML = `
  ${renderPagePreloaderMarkup()}
  ${navShell({ currentPage: 'profile-public' })}
  <main>
    <section class="section">
      <div class="section-inner" data-public-profile-root>
        <article class="public-profile-card"><p>Loading profile...</p></article>
      </div>
    </section>
  </main>
`

const logoReadyPromise = initShellChrome()
createCriticalAssetPreloader({ logoReadyPromise })

const profileRoot = document.querySelector('[data-public-profile-root]')

const CATEGORY_CONFIG = [
  { key: 'products', label: 'Products', placeholder: 'Product module coming soon', defaultCount: 0 },
  { key: 'savedItems', label: 'Saved Items', placeholder: 'Saved item', defaultCount: 12 },
  { key: 'comments', label: 'Comments', placeholder: 'Comment preview', defaultCount: 4 },
  { key: 'likes', label: 'Likes', placeholder: 'Liked item', defaultCount: 18 },
  { key: 'downloads', label: 'Downloads', placeholder: 'Download', defaultCount: 3 }
]

const uiState = {
  activeCategory: 'products',
  visibleCount: 6,
  profile: null,
  currentUser: null,
  previewMode: false
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
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

function getCategoryItems(categoryKey, displayName) {
  const config = CATEGORY_CONFIG.find((item) => item.key === categoryKey) || CATEGORY_CONFIG[0]
  return Array.from({ length: 18 }).map((_, index) => ({
    title: `${config.label} ${index + 1}`,
    body: `${config.placeholder} • ${displayName}`
  }))
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

function renderCategorySection(profile) {
  const displayName = profile.displayName || 'Melogic Creator'
  const items = getCategoryItems(uiState.activeCategory, displayName)
  const visibleItems = items.slice(0, uiState.visibleCount)

  return `
    <section class="public-content-section">
      <div class="public-content-grid" data-category-content>
        ${visibleItems.map((item) => `
          <article class="public-content-card">
            <h4>${escapeHtml(item.title)}</h4>
            <p>${escapeHtml(item.body)}</p>
          </article>
        `).join('')}
      </div>
      ${uiState.visibleCount < items.length ? '<div class="public-load-more-wrap"><button type="button" class="button button-muted" data-load-more>Load more</button></div>' : ''}
    </section>
  `
}

function renderPublicProfile(profile, currentUser, previewMode = false) {
  const uid = profile.uid || ''
  const displayName = profile.displayName || 'Melogic Creator'
  const username = profile.username || profile.usernameLower || 'unknown'
  const bio = profile.bio || 'No bio has been added yet.'
  const avatarURL = profile.avatarURL || profile.photoURL || ''
  const bannerURL = profile.bannerURL || ''
  const roleLabel = profile.roleLabel || 'Creator'
  const stats = getStats(profile)

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
    <section class="public-hero" style="${bannerURL ? `background-image:url('${escapeHtml(bannerURL)}')` : ''}">
      <div class="public-hero-overlay"></div>
      <div class="public-hero-inner">
        ${previewMode ? `
          <aside class="public-preview-notice" role="status">
            <p>You are previewing your public profile.</p>
            <a class="button button-muted" href="${ROUTES.profile}">Back to Private Profile</a>
          </aside>
        ` : ''}
        <div class="public-hero-identity">
          ${avatarURL ? `<img src="${escapeHtml(avatarURL)}" alt="${escapeHtml(displayName)} avatar" class="public-avatar" />` : '<div class="public-avatar public-avatar-fallback">MR</div>'}
          <div class="public-hero-copy">
            <h1>${escapeHtml(displayName)}</h1>
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
    button.addEventListener('click', () => {
      const nextCategory = button.getAttribute('data-category')
      if (!nextCategory || nextCategory === uiState.activeCategory) return
      uiState.activeCategory = nextCategory
      uiState.visibleCount = 6
      renderPublicProfile(uiState.profile, uiState.currentUser, uiState.previewMode)
    })
  })

  profileRoot.querySelector('[data-load-more]')?.addEventListener('click', () => {
    uiState.visibleCount += 6
    renderPublicProfile(uiState.profile, uiState.currentUser, uiState.previewMode)
  })
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
