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
  return [
    { label: 'Products', value: stats.products ?? profile.productsCount ?? 0 },
    { label: 'Followers', value: stats.followers ?? 0 },
    { label: 'Likes', value: stats.likes ?? profile.likesCount ?? 0 },
    { label: 'Downloads', value: stats.downloads ?? profile.downloadsCount ?? 0 }
  ]
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
      <a class="button button-muted" href="${ROUTES.profile}">Back to Private Profile</a>
      <a class="button button-accent" href="${ROUTES.editProfile}">Edit Profile</a>
    `
    : signedInElsewhere
      ? `
        <a class="button button-accent" href="${ROUTES.inbox}?start=${encodeURIComponent(uid)}">Message</a>
        <button class="button button-muted" type="button" disabled aria-disabled="true" title="Follow is coming soon">Follow</button>
      `
      : `
        <a class="button button-accent" href="${authRoute({ redirect: getCurrentPath() })}">Sign in to interact</a>
      `

  profileRoot.innerHTML = `
    ${previewMode ? `
      <section class="public-profile-card" style="margin-bottom:1rem; border:1px solid rgba(255,255,255,.14)">
        <p>You are previewing your public profile.</p>
        <a class="button button-muted" href="${ROUTES.profile}">Back to Private Profile</a>
      </section>
    ` : ''}

    <article class="public-profile-banner" style="${bannerURL ? `background-image:url('${escapeHtml(bannerURL)}')` : ''}"></article>

    <section class="public-profile-card public-profile-header">
      <div class="public-profile-identity">
        ${avatarURL ? `<img src="${escapeHtml(avatarURL)}" alt="${escapeHtml(displayName)} avatar" class="public-avatar" />` : '<div class="public-avatar public-avatar-fallback">MR</div>'}
        <div>
          <p class="public-role">${escapeHtml(roleLabel)}</p>
          <h1>${escapeHtml(displayName)}</h1>
          <p class="public-handle">@${escapeHtml(username)}</p>
          <p class="public-bio">${escapeHtml(bio)}</p>
        </div>
      </div>
      <div class="public-actions">${actionsMarkup}</div>
    </section>

    <section class="public-stats" aria-label="Public profile stats">
      ${stats.map((item) => `<article><p>${item.label}</p><strong>${item.value}</strong></article>`).join('')}
    </section>

    <section class="public-profile-card public-tabs-shell">
      <div class="public-tabs">
        <button type="button" class="is-active">Overview</button>
        <button type="button" disabled>Products</button>
        <button type="button" disabled>Activity</button>
        <button type="button" disabled>Links</button>
      </div>
      <div class="public-tab-panel">
        <p>Public profile content is live. Product/activity modules are next.</p>
      </div>
    </section>
  `
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

  renderPublicProfile(profile, currentUser, currentUser?.uid === uid && previewMode)
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
