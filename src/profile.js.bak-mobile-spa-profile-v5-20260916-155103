import './styles/base.css'
import './styles/profile.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { subscribeToAuthState, signOutUser, waitForInitialAuthState } from './firebase/auth'
import { getEffectiveProfile } from './firebase/firestore'
import { loadPrivateProfileDashboard } from './data/privateProfileDashboardService'
import { formatUsername } from './utils/format'
import {
  ROUTES,
  communityPostRoute,
  communityRoute,
  productRoute,
  publicProfileRoute
} from './utils/routes'

const PRIVATE_PROFILE_DEBUG = false
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
        <div class="profile-loading-shell" aria-label="Loading your account">
          <div class="profile-skeleton profile-skeleton-wide"></div>
          <div class="profile-skeleton profile-skeleton-side"></div>
          <div class="profile-skeleton profile-skeleton-stat"></div>
          <div class="profile-skeleton profile-skeleton-stat"></div>
          <div class="profile-skeleton profile-skeleton-stat"></div>
          <div class="profile-skeleton profile-skeleton-stat"></div>
          <div class="profile-skeleton profile-skeleton-stat"></div>
        </div>
      </div>
    </section>
  </main>
`

initShellChrome()

const profileRoot = document.querySelector('[data-profile-root]')
let hasWarnedProfileFallback = false
let hasWarnedNoAuthUser = false
let hasInitializedProfile = false
let activeProfileUid = ''

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]))
}

function safeHref(value = '', fallback = '#') {
  const path = String(value || '').trim()
  return path.startsWith('/') && !path.startsWith('//') ? escapeHtml(path) : fallback
}

function fallbackInitials(nameOrEmail) {
  if (!nameOrEmail) return 'MR'
  const parts = String(nameOrEmail).trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function normalizeRole(value) {
  const role = String(value || 'user').trim().toLowerCase()
  if (role === 'founder') return 'Founder'
  if (role === 'artist') return 'Artist'
  if (role === 'creator') return 'Creator'
  if (role === 'admin') return 'Admin'
  return 'User'
}

function formatFriendlyDate(value, fallback = 'Not available') {
  if (!value) return fallback
  const parsed = value?.toDate ? value.toDate() : new Date(value)
  if (Number.isNaN(parsed.getTime())) return fallback
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(parsed)
}

function calculateProfileCompleteness({ displayName, username, bio, photoURL, emailVerified }) {
  const checks = [displayName, username, bio, photoURL, emailVerified]
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

function renderSignedOutState() {
  profileRoot.innerHTML = `
    <article class="profile-card profile-empty">
      <p class="eyebrow">Private account</p>
      <h2>Sign in required</h2>
      <p>You need an account to view private profile details, purchases, and creator activity.</p>
      <a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a>
    </article>
  `
}

function emptyState(title, body, action = '') {
  return `
    <div class="profile-empty-state">
      <strong>${escapeHtml(title)}</strong>
      <p>${escapeHtml(body)}</p>
      ${action}
    </div>
  `
}

function metricMarkup(metric) {
  const target = metric.tab ? `data-profile-tab-target="${metric.tab}"` : ''
  const note = metric.note ? `<span>${escapeHtml(metric.note)}</span>` : ''
  return `
    <button type="button" class="profile-stat-card" ${target} ${metric.title ? `title="${escapeHtml(metric.title)}"` : ''}>
      <p>${escapeHtml(metric.label)}</p>
      <strong>${Number(metric.value || 0).toLocaleString()}</strong>
      ${note}
    </button>
  `
}

function quickLinksMarkup(user) {
  return `
    <div class="profile-quick-links">
      <a href="${ROUTES.editProfile}">Edit Profile</a>
      <a href="${publicProfileRoute({ uid: user.uid, preview: true })}">View Public Profile</a>
      <a href="${ROUTES.orders}">Orders</a>
      <a href="${ROUTES.library}">Library</a>
      <a href="${ROUTES.billingPayouts}">Billing &amp; Payouts</a>
      <a href="${ROUTES.accountSecurity}">Security</a>
    </div>
  `
}

function activityMarkup(events = []) {
  if (!events.length) {
    return emptyState('No recent activity yet.', 'Account, marketplace, and community updates will appear here.')
  }
  return `
    <div class="profile-list">
      ${events.map((event) => `
        <article class="profile-list-row">
          <div>
            <strong>${escapeHtml(event.title || 'Account update')}</strong>
            <p>${escapeHtml(event.summary || event.message || 'Your account was updated.')}</p>
          </div>
          <div class="profile-list-meta">
            <time>${escapeHtml(formatFriendlyDate(event.createdAt, 'Recent'))}</time>
            ${event.path ? `<a href="${safeHref(event.path)}">Open</a>` : ''}
          </div>
        </article>
      `).join('')}
    </div>
  `
}

function libraryMarkup(items = [], orders = []) {
  if (!items.length) {
    return emptyState(
      'Your library is ready.',
      'Products you purchase or add for free will appear here.',
      `<a class="button button-muted" href="${ROUTES.library}">Open Library</a>`
    )
  }
  return `
    <div class="profile-summary-header">
      <p>${items.length} recent library item${items.length === 1 ? '' : 's'} · ${orders.length} recent order${orders.length === 1 ? '' : 's'}</p>
      <a class="button button-muted" href="${ROUTES.library}">Open Full Library</a>
    </div>
    <div class="profile-list">
      ${items.map((item) => {
        const product = item.product || {}
        const snapshot = item.productSnapshot || {}
        const title = product.title || snapshot.title || 'Marketplace product'
        const creator = product.artistDisplayName || product.artistName || snapshot.creatorName || 'Melogic creator'
        return `
          <article class="profile-list-row">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <p>${escapeHtml(creator)} · ${escapeHtml(item.source === 'saved' ? 'Saved item' : item.license || 'Library item')}</p>
            </div>
            <a href="${item.productId ? productRoute(item.productId) : ROUTES.library}">Open</a>
          </article>
        `
      }).join('')}
    </div>
  `
}

function communitiesMarkup(focused = [], managed = [], posts = []) {
  const rows = [...managed.map((community) => ({ ...community, relationship: 'Managed' }))]
  focused.forEach((community) => {
    if (!rows.some((row) => (row.communityId || row.id) === community.communityId)) {
      rows.push({ ...community, relationship: 'Focused' })
    }
  })
  if (!rows.length && !posts.length) {
    return emptyState(
      'No communities yet.',
      'Join or create communities to see them here.',
      `<a class="button button-muted" href="${ROUTES.communityCommunities}">Browse Communities</a>`
    )
  }
  return `
    <div class="profile-section-grid">
      <section>
        <div class="profile-summary-header"><h4>Your communities</h4><a href="${ROUTES.communityCommunities}">Browse</a></div>
        ${rows.length ? `
          <div class="profile-list">
            ${rows.slice(0, 8).map((community) => `
              <a class="profile-list-row profile-list-link" href="${communityRoute(community.slug || community.communityId || community.id)}">
                <div><strong>${escapeHtml(community.name || community.title || 'Community')}</strong><p>${escapeHtml(community.relationship)}</p></div>
                <span>Open</span>
              </a>
            `).join('')}
          </div>
        ` : emptyState('No community memberships yet.', 'Focused and managed communities will appear here.')}
      </section>
      <section>
        <div class="profile-summary-header"><h4>Recent posts</h4><span>${posts.length} shown</span></div>
        ${posts.length ? `
          <div class="profile-list">
            ${posts.slice(0, 5).map((post) => `
              <a class="profile-list-row profile-list-link" href="${communityPostRoute(post.id || post.postId)}">
                <div><strong>${escapeHtml(post.title || 'Community post')}</strong><p>${escapeHtml(post.communityName || 'Melogic Community')}</p></div>
                <span>${escapeHtml(formatFriendlyDate(post.createdAt, 'Recent'))}</span>
              </a>
            `).join('')}
          </div>
        ` : emptyState('No public posts yet.', 'Your published community posts will appear here.')}
      </section>
    </div>
  `
}

function creatorMarkup(dashboard, role) {
  const stats = dashboard.stats
  const products = dashboard.products || []
  return `
    <div class="profile-creator-header">
      <div>
        <p class="eyebrow">Creator status</p>
        <h3>${escapeHtml(role === 'User' ? 'Creator tools available' : `${role} workspace`)}</h3>
        <p>Your creator dashboard reflects real marketplace, community, and Studio activity.</p>
      </div>
      <span class="creator-status">${role === 'User' ? 'Standard account' : 'Creator access'}</span>
    </div>
    <div class="profile-highlight-grid">
      <article><span>Products</span><strong>${stats.products}</strong></article>
      <article><span>Product downloads</span><strong>${stats.downloads}</strong></article>
      <article><span>Followers</span><strong>${stats.followers}</strong></article>
      <article><span>DAW projects</span><strong>${stats.studioProjects}</strong></article>
      <article><span>Stage plans</span><strong>${stats.stagePlans}</strong></article>
      <article><span>Public posts</span><strong>${stats.communityPosts}</strong></article>
    </div>
    <div class="profile-quick-links">
      <a href="${ROUTES.newProduct}">New Product</a>
      <a href="${ROUTES.productDashboard}">Product Dashboard</a>
      <a href="${ROUTES.studio}">Studio</a>
      <a href="${ROUTES.editProfile}">Creator Settings</a>
    </div>
    ${products.length ? `
      <div class="profile-list profile-creator-products">
        ${products.slice(0, 5).map((product) => `
          <article class="profile-list-row">
            <div>
              <strong>${escapeHtml(product.title || 'Untitled product')}</strong>
              <p>${escapeHtml(product.status || 'draft')} · ${escapeHtml(product.visibility || 'private')}</p>
            </div>
            <a href="${ROUTES.editProduct}?id=${encodeURIComponent(product.id)}">Manage</a>
          </article>
        `).join('')}
      </div>
    ` : emptyState('No products created yet.', 'Start a marketplace product when you are ready to publish.')}
  `
}

function renderSignedInState(user, storedProfile = null, dashboard = null) {
  const profile = storedProfile || {}
  const data = dashboard || {
    stats: {},
    recentActivity: [],
    libraryItems: [],
    orders: [],
    communities: [],
    managedCommunities: [],
    communityPosts: [],
    products: [],
    failedStats: []
  }
  const stats = {
    products: 0,
    savedItems: 0,
    comments: 0,
    commentsAvailable: false,
    likesReceived: 0,
    likesReceivedAvailable: false,
    downloads: 0,
    studioProjects: 0,
    stagePlans: 0,
    communityPosts: 0,
    communities: 0,
    managedCommunities: 0,
    orders: 0,
    libraryItems: 0,
    followers: 0,
    following: 0,
    ...(data.stats || {})
  }
  const displayName = profile.displayName || user.displayName || 'Melogic User'
  const rawUsername = String(profile.username || '')
  const username = formatUsername(rawUsername)
  const email = profile.email || user.email || 'No email available'
  const bio = profile.bio || 'No bio yet. Add context about your sound, tools, or creator direction.'
  const photoURL = profile.avatarURL || profile.photoURL || user.photoURL || ''
  const role = normalizeRole(
    profile.publicProfile?.roleLabel
    || profile.privateProfile?.roleLabel
    || profile.privateProfile?.role
    || profile.roleLabel
    || profile.role
  )
  const createdAt = formatFriendlyDate(profile.createdAt || user.metadata?.creationTime)
  const completeness = calculateProfileCompleteness({
    displayName,
    username: rawUsername,
    bio: profile.bio,
    photoURL,
    emailVerified: user.emailVerified
  })
  const metrics = [
    { label: 'Products', value: stats.products, tab: 'creator', note: 'Owned' },
    { label: 'Saved Items', value: stats.savedItems, tab: 'library', note: 'Bookmarked' },
    {
      label: 'Comments',
      value: stats.comments,
      tab: 'activity',
      note: stats.commentsAvailable ? 'Authored' : 'Index pending',
      title: stats.commentsAvailable ? 'Comments authored' : 'A safe authored-comment index is not available yet.'
    },
    {
      label: 'Likes Received',
      value: stats.likesReceived,
      tab: 'activity',
      note: stats.likesReceivedAvailable ? 'On public content' : 'Index pending',
      title: stats.likesReceivedAvailable ? 'Likes received on public content' : 'A scalable received-likes index is not available yet.'
    },
    { label: 'Downloads', value: stats.downloads, tab: 'creator', note: 'Product files' }
  ]

  profileRoot.innerHTML = `
    <div class="profile-grid">
      <article class="profile-card profile-header-card">
        <div class="profile-header-main">
          <div class="profile-photo-frame">
            ${photoURL
              ? `<img class="profile-photo" src="${escapeHtml(photoURL)}" alt="${escapeHtml(displayName)} profile photo" />`
              : `<div class="profile-photo profile-photo-fallback">${escapeHtml(fallbackInitials(displayName || email))}</div>`}
            <span class="profile-presence" title="Account active"></span>
          </div>
          <div class="profile-identity">
            <p class="profile-role">${escapeHtml(role)}</p>
            <h2>${escapeHtml(displayName)}</h2>
            <p class="profile-handle">${escapeHtml(username || 'No username set')}</p>
            <p class="profile-bio-preview">${escapeHtml(bio)}</p>
          </div>
        </div>
        <div class="profile-actions">
          <a class="button button-muted" href="${ROUTES.editProfile}">Edit Profile</a>
          <a class="button button-muted" href="${ROUTES.accountSecurity}">Security</a>
          <a class="button button-muted" href="${publicProfileRoute({ uid: user.uid, preview: true })}">View Public Profile</a>
          <a class="button button-muted" href="${ROUTES.library}">Library</a>
          <a class="button button-muted" href="${ROUTES.orders}">Orders</a>
          <a class="button button-muted" href="${ROUTES.billingPayouts}">Billing &amp; Payouts</a>
          <button type="button" class="button button-accent" data-signout-profile>Sign Out</button>
        </div>
      </article>

      <aside class="profile-card profile-side">
        <div class="profile-snapshot-heading">
          <div><p class="eyebrow">Account Snapshot</p><h3>Identity + status</h3></div>
          <span class="profile-verification ${user.emailVerified ? 'is-verified' : ''}">${user.emailVerified ? 'Email verified' : 'Verification pending'}</span>
        </div>
        <dl class="profile-meta compact">
          <div><dt>Email</dt><dd>${escapeHtml(email)}</dd></div>
          <div><dt>Role</dt><dd>${escapeHtml(role)}</dd></div>
          <div><dt>Joined</dt><dd>${escapeHtml(createdAt)}</dd></div>
          <div><dt>Profile</dt><dd>${completeness}% complete</dd></div>
          <div><dt>Account ID</dt><dd class="profile-account-id" title="${escapeHtml(user.uid)}">${escapeHtml(user.uid)}</dd></div>
        </dl>
      </aside>
    </div>

    ${data.failedStats?.length ? `
      <div class="profile-data-notice" role="status">
        Some account data could not be loaded. Available sections remain usable.
      </div>
    ` : ''}

    <section class="profile-stats" aria-label="Private account metrics">
      ${metrics.map(metricMarkup).join('')}
    </section>

    <section class="profile-card profile-tabs-shell">
      <div class="profile-tabs" role="tablist" aria-label="Profile sections">
        ${['Overview', 'Activity', 'Library', 'Communities', 'Creator'].map((label, index) => `
          <button type="button" class="profile-tab ${index === 0 ? 'is-active' : ''}" data-tab="${label.toLowerCase()}" role="tab" aria-selected="${index === 0}">${label}</button>
        `).join('')}
      </div>

      <div class="profile-tab-content is-active" data-panel="overview">
        <div class="profile-panel-heading"><div><p class="eyebrow">Private dashboard</p><h3>Account overview</h3></div><span>${completeness}% profile complete</span></div>
        <p class="profile-overview-bio">${escapeHtml(bio)}</p>
        <div class="profile-highlight-grid">
          <article><span>Products</span><strong>${stats.products}</strong></article>
          <article><span>Community posts</span><strong>${stats.communityPosts}</strong></article>
          <article><span>DAW projects</span><strong>${stats.studioProjects}</strong></article>
          <article><span>Stage plans</span><strong>${stats.stagePlans}</strong></article>
          <article><span>Recent events</span><strong>${data.recentActivity.length}</strong></article>
          <article><span>Following</span><strong>${stats.following}</strong></article>
        </div>
        ${quickLinksMarkup(user)}
      </div>

      <div class="profile-tab-content" data-panel="activity">
        <div class="profile-panel-heading"><div><p class="eyebrow">Account timeline</p><h3>Recent activity</h3></div><span>${data.recentActivity.length} events</span></div>
        ${activityMarkup(data.recentActivity)}
      </div>

      <div class="profile-tab-content" data-panel="library">
        <div class="profile-panel-heading"><div><p class="eyebrow">Your collection</p><h3>Library</h3></div><span>${stats.libraryItems} owned · ${stats.savedItems} saved</span></div>
        ${libraryMarkup(data.libraryItems, data.orders)}
      </div>

      <div class="profile-tab-content" data-panel="communities">
        <div class="profile-panel-heading"><div><p class="eyebrow">Network</p><h3>Communities</h3></div><span>${stats.communities} focused · ${stats.managedCommunities} managed</span></div>
        ${communitiesMarkup(data.communities, data.managedCommunities, data.communityPosts)}
      </div>

      <div class="profile-tab-content" data-panel="creator">
        ${creatorMarkup(data, role)}
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

  const tabButtons = [...profileRoot.querySelectorAll('.profile-tab')]
  const tabPanels = [...profileRoot.querySelectorAll('.profile-tab-content')]
  const activateTab = (tabKey) => {
    tabButtons.forEach((tab) => {
      const isActive = tab.dataset.tab === tabKey
      tab.classList.toggle('is-active', isActive)
      tab.setAttribute('aria-selected', String(isActive))
    })
    tabPanels.forEach((panel) => panel.classList.toggle('is-active', panel.dataset.panel === tabKey))
  }
  tabButtons.forEach((button) => button.addEventListener('click', () => activateTab(button.dataset.tab)))
  profileRoot.querySelectorAll('[data-profile-tab-target]').forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.profileTabTarget)
      profileRoot.querySelector('.profile-tabs-shell')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  })
}

async function loadAndRenderProfile(user) {
  if (!user) {
    activeProfileUid = ''
    if (!hasWarnedNoAuthUser) {
      hasWarnedNoAuthUser = true
      console.warn('[profile] No authenticated user; showing sign-in required state.')
    }
    renderSignedOutState()
    return false
  }

  if (activeProfileUid === user.uid && profileRoot.querySelector('.profile-tabs-shell')) return true
  activeProfileUid = user.uid

  let storedProfile = null
  let dashboard = null
  const [profileResult, dashboardResult] = await Promise.allSettled([
    getEffectiveProfile(user.uid, user),
    loadPrivateProfileDashboard(user.uid)
  ])

  if (profileResult.status === 'fulfilled') {
    storedProfile = {
      ...(profileResult.value?.effectiveProfile || {}),
      publicProfile: profileResult.value?.publicProfile || null,
      privateProfile: profileResult.value?.privateProfile || null
    }
  } else if (!hasWarnedProfileFallback) {
    hasWarnedProfileFallback = true
    console.warn('[profile] Could not load Firestore profile; using Auth fallback.', profileResult.reason?.message || profileResult.reason)
  }

  if (dashboardResult.status === 'fulfilled') {
    dashboard = dashboardResult.value
  } else {
    console.warn('[profile] Private dashboard data unavailable.', dashboardResult.reason?.code || dashboardResult.reason?.message || dashboardResult.reason)
  }

  if (PRIVATE_PROFILE_DEBUG) {
    console.info('[private-profile]', {
      uid: user.uid,
      loadedStats: dashboard?.stats || {},
      failedStats: dashboard?.failedStats || ['dashboard'],
      profileDoc: storedProfile,
      dataSources: dashboard?.dataSources || {}
    })
  }

  renderSignedInState(user, storedProfile, dashboard)
  return true
}

waitForInitialAuthState().then((user) => {
  hasInitializedProfile = true
  loadAndRenderProfile(user)
})

subscribeToAuthState((user) => {
  if (!hasInitializedProfile) return
  if (user?.uid === activeProfileUid) return
  loadAndRenderProfile(user)
})
