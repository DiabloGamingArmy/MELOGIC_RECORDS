import './styles/base.css'
import './styles/profilePublic.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { getPublicProfile, getUidForUsername } from './firebase/firestore'
import { waitForInitialAuthState } from './firebase/auth'

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

function getSignInRedirect(uid) {
  const target = `/profile-public.html?uid=${encodeURIComponent(uid)}`
  return `/auth.html?redirect=${encodeURIComponent(target)}`
}

function renderNotFound() {
  profileRoot.innerHTML = `
    <article class="public-profile-card public-profile-empty">
      <h1>Profile not found</h1>
      <p>We could not find that profile. Please check the link and try again.</p>
      <a class="button button-accent" href="/products.html">Browse Products</a>
    </article>
  `
}

function renderPublicProfile(profile, currentUser) {
  const uid = profile.uid || ''
  const displayName = profile.displayName || 'Melogic Creator'
  const username = profile.username || profile.usernameLower || 'unknown'
  const bio = profile.bio || 'No bio has been added yet.'
  const avatarURL = profile.avatarURL || profile.photoURL || ''
  const bannerURL = profile.bannerURL || ''
  const roleLabel = profile.roleLabel || 'Creator'
  const stats = getStats(profile)

  const signedInElsewhere = currentUser && currentUser.uid !== uid
  const actionsMarkup = signedInElsewhere
    ? `
      <a class="button button-accent" href="/inbox.html?start=${encodeURIComponent(uid)}">Message</a>
      <button class="button button-muted" type="button" disabled aria-disabled="true" title="Follow is coming soon">Follow</button>
    `
    : `
      <a class="button button-accent" href="${getSignInRedirect(uid)}">Sign in to interact</a>
    `

  profileRoot.innerHTML = `
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

async function resolveUidFromQuery(params) {
  const uid = String(params.get('uid') || '').trim()
  if (uid) return uid
  const username = String(params.get('username') || '').trim()
  if (!username) return ''
  return (await getUidForUsername(username)) || ''
}

async function initPublicProfile() {
  const currentUser = await waitForInitialAuthState()
  const params = new URLSearchParams(window.location.search)
  const uid = await resolveUidFromQuery(params)

  if (!uid) {
    renderNotFound()
    return
  }

  if (currentUser?.uid === uid) {
    window.location.assign('/profile.html')
    return
  }

  const profile = await getPublicProfile(uid)
  if (!profile) {
    renderNotFound()
    return
  }

  renderPublicProfile(profile, currentUser)
}

initPublicProfile().catch(() => {
  renderNotFound()
})
