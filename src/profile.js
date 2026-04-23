import './styles/base.css'
import './styles/profile.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, signOutUser } from './firebase/auth'
import { getUserProfile } from './firebase/firestore'

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell({ currentPage: 'profile' })}

  <main>
    <section class="standard-hero section" id="profile-top">
      <div class="section-inner hero-inner hero-content-layer">
        <div class="hero-copy">
          <p class="eyebrow">Melogic Account</p>
          <h1>Your Profile</h1>
          <p>Manage your account, review your creator identity, and track your activity across the Melogic platform.</p>
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

function fallbackInitials(nameOrEmail) {
  if (!nameOrEmail) return 'MR'
  const parts = nameOrEmail.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function renderSignedOutState() {
  profileRoot.innerHTML = `
    <article class="profile-card profile-empty">
      <h2>Sign in required</h2>
      <p>You need an account to view profile details, purchases, and creator activity.</p>
      <a class="button button-accent" href="/auth.html">Go to Sign In / Sign Up</a>
    </article>
  `
}

function renderSignedInState(user, storedProfile = null) {
  const profile = storedProfile || {}
  const displayName = profile.displayName || user.displayName || 'Melogic User'
  const username = profile.username || 'Not set'
  const email = profile.email || user.email || 'No email available'
  const bio = profile.bio || 'No bio yet. Update your profile details soon.'
  const photoURL = profile.photoURL || user.photoURL || ''

  profileRoot.innerHTML = `
    <div class="profile-grid">
      <article class="profile-card">
        <div class="profile-header">
          ${photoURL ? `<img class="profile-photo" src="${photoURL}" alt="${displayName} profile photo" />` : `<div class="profile-photo profile-photo-fallback">${fallbackInitials(displayName || email)}</div>`}
          <div>
            <h2>${displayName}</h2>
            <p class="profile-handle">@${username}</p>
          </div>
        </div>

        <dl class="profile-meta">
          <div><dt>Email</dt><dd>${email}</dd></div>
          <div><dt>Bio</dt><dd>${bio}</dd></div>
          <div><dt>Account ID</dt><dd>${user.uid}</dd></div>
          <div><dt>Status</dt><dd>Authenticated</dd></div>
        </dl>

        <div class="profile-actions">
          <button type="button" class="button button-muted" data-edit-profile>Edit Profile (Soon)</button>
          <button type="button" class="button button-accent" data-signout-profile>Sign Out</button>
        </div>
      </article>

      <aside class="profile-card profile-side">
        <p class="eyebrow">My Activity</p>
        <h3>Quick account snapshots</h3>
        <ul>
          <li>My Products (coming soon)</li>
          <li>My Downloads (coming soon)</li>
          <li>Community Responses (coming soon)</li>
        </ul>
      </aside>
    </div>
  `

  const signOutButton = profileRoot.querySelector('[data-signout-profile]')
  signOutButton?.addEventListener('click', async () => {
    signOutButton.disabled = true
    signOutButton.textContent = 'Signing Out...'
    try {
      await signOutUser()
      renderSignedOutState()
    } catch {
      signOutButton.disabled = false
      signOutButton.textContent = 'Sign Out'
    }
  })
}

subscribeToAuthState(async (user) => {
  if (!user) {
    renderSignedOutState()
    return
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
})
