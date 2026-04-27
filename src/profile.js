import './styles/base.css'
import './styles/profile.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, signOutUser, waitForInitialAuthState } from './firebase/auth'
import { getUserProfile } from './firebase/firestore'
import { ROUTES, publicProfileRoute } from './utils/routes'

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell({ currentPage: 'profile' })}

  <main>
    <section class="standard-hero section" id="profile-top">
      <div class="section-inner hero-inner hero-content-layer">
        <div class="hero-copy">
          <p class="eyebrow">Melogic Account</p>
          <h1>Your Profile</h1>
          <p>Manage your account, creator identity, and platform activity from a single profile workspace.</p>
        </div>
      </div>
    </section>

    <section class="section profile-shell">
      <div class="section-inner" data-profile-root>
        <article class="profile-card" data-profile-loading>
          <p>Loading your account...</p>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()

const profileRoot = document.querySelector('[data-profile-root]')
let hasWarnedProfileFallback = false
let hasWarnedNoAuthUser = false
let hasInitializedProfile = false

function fallbackInitials(nameOrEmail) {
  if (!nameOrEmail) return 'MR'
  const parts = nameOrEmail.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function normalizeRole(value) {
  const role = String(value || 'user').trim().toLowerCase()
  if (role === 'founder') return 'Founder'
  if (role === 'artist') return 'Artist'
  if (role === 'creator') return 'Creator'
  return 'User'
}

function renderSignedOutState() {
  profileRoot.innerHTML = `
    <article class="profile-card profile-empty">
      <h2>Sign in required</h2>
      <p>You need an account to view profile details, purchases, and creator activity.</p>
      <a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a>
    </article>
  `
}

function getMetrics(profile) {
  return [
    { label: 'Products', value: profile.productsCount ?? 0 },
    { label: 'Saved Items', value: profile.savedCount ?? 12 },
    { label: 'Comments', value: profile.commentsCount ?? 4 },
    { label: 'Likes', value: profile.likesCount ?? 18 },
    { label: 'Downloads', value: profile.downloadsCount ?? 3 }
  ]
}

function renderSignedInState(user, storedProfile = null) {
  const profile = storedProfile || {}
  const displayName = profile.displayName || user.displayName || 'Melogic User'
  const username = profile.username || 'not-set'
  const email = profile.email || user.email || 'No email available'
  const bio = profile.bio || 'No bio yet. Add context about your sound, tools, or creator direction.'
  const photoURL = profile.photoURL || user.photoURL || ''
  const role = normalizeRole(
    profile.roleLabel
    || profile.publicProfile?.roleLabel
    || profile.privateProfile?.roleLabel
    || profile.privateProfile?.role
    || profile.role
  )
  const metrics = getMetrics(profile)
  const createdAt = profile.createdAt?.toDate ? profile.createdAt.toDate().toLocaleDateString() : 'Recently'

  profileRoot.innerHTML = `
    <div class="profile-grid">
      <article class="profile-card profile-header-card">
        <div class="profile-header-main">
          ${photoURL ? `<img class="profile-photo" src="${photoURL}" alt="${displayName} profile photo" />` : `<div class="profile-photo profile-photo-fallback">${fallbackInitials(displayName || email)}</div>`}
          <div class="profile-identity">
            <p class="profile-role">${role}</p>
            <h2>${displayName}</h2>
            <p class="profile-handle">@${username}</p>
            <p class="profile-bio-preview">${bio}</p>
          </div>
        </div>

        <div class="profile-actions">
          <a class="button button-muted" href="${ROUTES.editProfile}">Edit Profile</a>
          <a class="button button-muted" href="${publicProfileRoute({ uid: user.uid, preview: true })}">View Public Profile</a>
          <button type="button" class="button button-accent" data-signout-profile>Sign Out</button>
        </div>
      </article>

      <aside class="profile-card profile-side">
        <p class="eyebrow">Account Snapshot</p>
        <h3>Identity + status</h3>
        <dl class="profile-meta compact">
          <div><dt>Email</dt><dd>${email}</dd></div>
          <div><dt>Account ID</dt><dd>${user.uid}</dd></div>
          <div><dt>Role</dt><dd>${role}</dd></div>
          <div><dt>Joined</dt><dd>${createdAt}</dd></div>
        </dl>
      </aside>
    </div>

    <section class="profile-stats" aria-label="Profile metrics">
      ${metrics
        .map(
          (metric) => `
            <article class="profile-stat-card">
              <p>${metric.label}</p>
              <strong>${metric.value}</strong>
            </article>
          `
        )
        .join('')}
    </section>

    <section class="profile-card profile-tabs-shell">
      <div class="profile-tabs" role="tablist" aria-label="Profile sections">
        <button type="button" class="profile-tab is-active" data-tab="overview" role="tab" aria-selected="true">Overview</button>
        <button type="button" class="profile-tab" data-tab="activity" role="tab" aria-selected="false">Activity</button>
        <button type="button" class="profile-tab" data-tab="library" role="tab" aria-selected="false">Library</button>
        <button type="button" class="profile-tab" data-tab="creator" role="tab" aria-selected="false">Creator</button>
      </div>

      <div class="profile-tab-content is-active" data-panel="overview">
        <h3>Account overview</h3>
        <p class="muted">${bio}</p>
        <ul>
          <li>Account email: ${email}</li>
          <li>Profile role: ${role}</li>
          <li>Creator tools access: ${role === 'User' ? 'Coming soon' : 'Enabled soon'}</li>
        </ul>
      </div>

      <div class="profile-tab-content" data-panel="activity">
        <h3>Recent activity</h3>
        <ul>
          <li>Liked “Aether Pulse Vol. 1”</li>
          <li>Saved “Fracture Grid” to library</li>
          <li>Commented on a community release thread</li>
        </ul>
      </div>

      <div class="profile-tab-content" data-panel="library">
        <h3>Library placeholders</h3>
        <div class="profile-mini-grid">
          <article><h4>Purchases</h4><p>Catalog receipts and downloads appear here.</p></article>
          <article><h4>Saved for later</h4><p>Bookmark packs and tools for later sessions.</p></article>
          <article><h4>Download history</h4><p>Track file versions and re-download links.</p></article>
        </div>
      </div>

      <div class="profile-tab-content" data-panel="creator">
        <h3>Creator workspace</h3>
        <p class="muted">Uploads, creator analytics, release submissions, and publishing tools will appear here.</p>
        <p class="creator-lock ${role === 'User' ? 'is-locked' : ''}">${role === 'User' ? 'Creator mode is locked until your creator profile is enabled.' : 'Creator mode ready for expansion.'}</p>
      </div>
    </section>

  `

  const signOutButton = profileRoot.querySelector('[data-signout-profile]')
  signOutButton?.addEventListener('click', async () => {
    signOutButton.disabled = true
    signOutButton.textContent = 'Signing Out...'
    try {
      await signOutUser()
      window.location.assign(ROUTES.home)
    } catch {
      signOutButton.disabled = false
      signOutButton.textContent = 'Sign Out'
    }
  })

  const tabButtons = profileRoot.querySelectorAll('.profile-tab')
  const tabPanels = profileRoot.querySelectorAll('.profile-tab-content')

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tabKey = button.dataset.tab
      tabButtons.forEach((tab) => {
        const isActive = tab === button
        tab.classList.toggle('is-active', isActive)
        tab.setAttribute('aria-selected', String(isActive))
      })
      tabPanels.forEach((panel) => {
        panel.classList.toggle('is-active', panel.dataset.panel === tabKey)
      })
    })
  })
}

async function loadAndRenderProfile(user) {
  if (!user) {
    if (!hasWarnedNoAuthUser) {
      hasWarnedNoAuthUser = true
      console.warn('[profile] No authenticated user; showing sign-in required state.')
    }
    renderSignedOutState()
    return false
  }

  let storedProfile = null
  try {
    storedProfile = await getUserProfile(user.uid)
  } catch (error) {
    if (!hasWarnedProfileFallback) {
      hasWarnedProfileFallback = true
      console.warn('[profile] Could not load Firestore profile; using Auth fallback.', error?.message || error)
    }
  }
  renderSignedInState(user, storedProfile)
  return true
}

waitForInitialAuthState().then((user) => {
  hasInitializedProfile = true
  loadAndRenderProfile(user)
})

subscribeToAuthState((user) => {
  if (!hasInitializedProfile) return
  loadAndRenderProfile(user)
})
