import './styles/base.css'
import './styles/editProfile.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { signOutUser, updateCurrentUserProfile, waitForInitialAuthState } from './firebase/auth'
import { getUserProfile, upsertUserProfile } from './firebase/firestore'

const SETTINGS_SECTIONS = [
  { key: 'public-profile', label: 'Public Profile' },
  { key: 'account', label: 'Account' },
  { key: 'appearance', label: 'Appearance' },
  { key: 'creator-settings', label: 'Creator Settings' },
  { key: 'security', label: 'Security' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'connections', label: 'Connections' },
  { key: 'danger-zone', label: 'Danger Zone' }
]

const app = document.querySelector('#app')
app.innerHTML = `
  ${navShell({ currentPage: 'profile' })}
  <main>
    <section class="standard-hero section">
      <div class="section-inner hero-inner hero-content-layer">
        <div class="hero-copy">
          <p class="eyebrow">Account Settings</p>
          <h1>Edit Profile</h1>
          <p>Manage your public identity, account preferences, creator controls, and security settings.</p>
        </div>
      </div>
    </section>

    <section class="section edit-shell">
      <div class="section-inner" data-edit-root>
        <article class="edit-card">
          <p>Loading settings...</p>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()

const editRoot = document.querySelector('[data-edit-root]')
let hasWarnedEditProfile = false

function fallbackInitials(nameOrEmail) {
  if (!nameOrEmail) return 'MR'
  const parts = nameOrEmail.trim().split(/\s+/)
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function readHashSection() {
  const hash = window.location.hash.replace('#', '')
  return SETTINGS_SECTIONS.some((item) => item.key === hash) ? hash : 'public-profile'
}

function renderSignedOutState() {
  editRoot.innerHTML = `
    <article class="edit-card signed-out">
      <h2>Sign in required</h2>
      <p>You must be signed in to edit profile and account settings.</p>
      <a class="button button-accent" href="/auth.html">Go to Sign In / Sign Up</a>
    </article>
  `
}

function renderSettingsPage(user, profileData = {}) {
  const profile = profileData || {}
  const displayName = profile.displayName || user.displayName || ''
  const username = profile.username || ''
  const bio = profile.bio || ''
  const role = profile.role || 'user'
  const photoURL = profile.photoURL || user.photoURL || ''
  const location = profile.location || ''
  const website = profile.website || ''
  const socials = profile.socials || {}
  const settings = profile.settings || {}
  const appearance = settings.appearance || {}
  const creator = settings.creator || {}
  const notifications = settings.notifications || {}
  const activeSection = readHashSection()
  const providerIds = user.providerData.map((provider) => provider.providerId)

  editRoot.innerHTML = `
    <div class="edit-layout">
      <aside class="settings-sidebar">
        <a class="back-link" href="/profile.html">← Back to Profile</a>
        <nav aria-label="Profile settings sections">
          ${SETTINGS_SECTIONS.map((section) => `
            <button type="button" class="settings-nav-btn ${section.key === activeSection ? 'is-active' : ''}" data-section-btn="${section.key}">${section.label}</button>
          `).join('')}
        </nav>
      </aside>

      <section class="settings-content edit-card">
        <p class="edit-feedback" data-edit-feedback role="status" aria-live="polite"></p>

        <div class="settings-panel ${activeSection === 'public-profile' ? 'is-active' : ''}" data-panel="public-profile">
          <h2>Public Profile</h2>
          <div class="avatar-row">
            ${photoURL ? `<img class="avatar-lg" src="${photoURL}" alt="${displayName || 'Profile'}" />` : `<div class="avatar-lg avatar-fallback">${fallbackInitials(displayName || user.email)}</div>`}
            <div>
              <p>Avatar uploads are coming soon.</p>
              <button type="button" class="button button-muted" disabled>Upload Avatar (Soon)</button>
            </div>
          </div>

          <form data-profile-form>
            <div class="field-grid">
              <label><span>Display Name</span><input name="displayName" value="${displayName}" /></label>
              <label><span>Username</span><input name="username" value="${username}" /></label>
            </div>
            <label><span>Bio</span><textarea name="bio" rows="3">${bio}</textarea></label>
            <div class="field-grid">
              <label><span>Role</span><input name="role" value="${role}" readonly /></label>
              <label><span>Location</span><input name="location" value="${location}" /></label>
            </div>
            <label><span>Website</span><input name="website" value="${website}" placeholder="https://" /></label>
            <h3>Social Links</h3>
            <div class="field-grid">
              <label><span>Instagram</span><input name="instagram" value="${socials.instagram || ''}" /></label>
              <label><span>SoundCloud</span><input name="soundcloud" value="${socials.soundcloud || ''}" /></label>
              <label><span>Spotify</span><input name="spotify" value="${socials.spotify || ''}" /></label>
              <label><span>YouTube</span><input name="youtube" value="${socials.youtube || ''}" /></label>
              <label><span>Discord</span><input name="discord" value="${socials.discord || ''}" /></label>
              <label><span>TikTok</span><input name="tiktok" value="${socials.tiktok || ''}" /></label>
            </div>
            <div class="actions-row">
              <button type="submit" class="button button-accent" data-save-profile>Save Changes</button>
              <button type="reset" class="button button-muted">Reset</button>
            </div>
          </form>
        </div>

        <div class="settings-panel ${activeSection === 'account' ? 'is-active' : ''}" data-panel="account">
          <h2>Account</h2>
          <dl class="settings-list">
            <div><dt>Email</dt><dd>${user.email || 'Unavailable'}</dd></div>
            <div><dt>Account ID</dt><dd>${user.uid}</dd></div>
            <div><dt>Created</dt><dd>${user.metadata?.creationTime || 'Unavailable'}</dd></div>
            <div><dt>Plan</dt><dd>Standard (expandable)</dd></div>
          </dl>
          <p class="muted">Email updates and advanced account controls are coming in a future release.</p>
        </div>

        <div class="settings-panel ${activeSection === 'appearance' ? 'is-active' : ''}" data-panel="appearance">
          <h2>Appearance</h2>
          <div class="toggle-list">
            <label><span>Theme</span><select><option>Dark (Default)</option><option>System</option></select></label>
            <label><span>Accent Intensity</span><input type="range" min="0" max="100" value="${appearance.accentIntensity ?? 65}" /></label>
            <label><input type="checkbox" ${appearance.reduceMotion ? 'checked' : ''} /> Reduce motion</label>
            <label><input type="checkbox" ${appearance.compactLayout ? 'checked' : ''} /> Compact layout</label>
          </div>
        </div>

        <div class="settings-panel ${activeSection === 'creator-settings' ? 'is-active' : ''}" data-panel="creator-settings">
          <h2>Creator Settings</h2>
          <div class="toggle-list">
            <label><input type="checkbox" ${creator.creatorMode ? 'checked' : ''} /> Creator display mode</label>
            <label><input type="checkbox" ${creator.publicProfile ?? true ? 'checked' : ''} /> Allow public creator profile</label>
            <label><input type="checkbox" ${creator.featuredReleases ?? true ? 'checked' : ''} /> Featured releases visibility</label>
            <label><input type="checkbox" ${creator.marketplaceParticipation ?? true ? 'checked' : ''} /> Marketplace participation</label>
          </div>
          <p class="muted">Storefront publishing tools and creator analytics are coming soon.</p>
        </div>

        <div class="settings-panel ${activeSection === 'security' ? 'is-active' : ''}" data-panel="security">
          <h2>Security</h2>
          <ul>
            <li>Password is managed via your current provider.</li>
            <li>Signed in providers: ${providerIds.join(', ') || 'email/password'}</li>
            <li>Session controls and multi-device sign-out are coming soon.</li>
          </ul>
          <button type="button" class="button button-muted" disabled>Change Password (Soon)</button>
        </div>

        <div class="settings-panel ${activeSection === 'notifications' ? 'is-active' : ''}" data-panel="notifications">
          <h2>Notifications</h2>
          <div class="toggle-list">
            <label><input type="checkbox" ${notifications.productUpdates ?? true ? 'checked' : ''} /> Product updates</label>
            <label><input type="checkbox" ${notifications.communityReplies ?? true ? 'checked' : ''} /> Community replies</label>
            <label><input type="checkbox" ${notifications.creatorNews ?? true ? 'checked' : ''} /> Creator news</label>
            <label><input type="checkbox" ${notifications.releaseAlerts ?? true ? 'checked' : ''} /> Release alerts</label>
            <label><input type="checkbox" ${notifications.marketing ?? false ? 'checked' : ''} /> Marketing updates</label>
          </div>
        </div>

        <div class="settings-panel ${activeSection === 'connections' ? 'is-active' : ''}" data-panel="connections">
          <h2>Connections</h2>
          <ul>
            <li>Google: ${providerIds.includes('google.com') ? 'Connected' : 'Not connected'}</li>
            <li>Email/Password: ${providerIds.includes('password') ? 'Connected' : 'Not connected'}</li>
            <li>Spotify / YouTube / Discord integrations are placeholder-only for now.</li>
          </ul>
        </div>

        <div class="settings-panel ${activeSection === 'danger-zone' ? 'is-active' : ''}" data-panel="danger-zone">
          <h2>Danger Zone</h2>
          <p class="danger-copy">Take care with account actions below. Destructive actions cannot be undone.</p>
          <div class="actions-row">
            <button type="button" class="button button-muted" data-signout>Sign Out</button>
            <button type="button" class="button button-danger" disabled>Delete Account (Soon)</button>
          </div>
        </div>
      </section>
    </div>
  `

  const feedback = editRoot.querySelector('[data-edit-feedback]')
  const saveButton = editRoot.querySelector('[data-save-profile]')
  const profileForm = editRoot.querySelector('[data-profile-form]')
  const navButtons = editRoot.querySelectorAll('[data-section-btn]')
  const signOutButton = editRoot.querySelector('[data-signout]')

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const section = button.dataset.sectionBtn
      window.location.hash = section
      renderSettingsPage(user, profile)
    })
  })

  signOutButton?.addEventListener('click', async () => {
    signOutButton.disabled = true
    signOutButton.textContent = 'Signing out...'
    try {
      await signOutUser()
      renderSignedOutState()
    } catch {
      signOutButton.disabled = false
      signOutButton.textContent = 'Sign Out'
    }
  })

  profileForm?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const formData = new FormData(profileForm)
    const nextProfile = {
      displayName: String(formData.get('displayName') || '').trim(),
      username: String(formData.get('username') || '').trim(),
      bio: String(formData.get('bio') || '').trim(),
      role,
      location: String(formData.get('location') || '').trim(),
      website: String(formData.get('website') || '').trim(),
      socials: {
        instagram: String(formData.get('instagram') || '').trim(),
        soundcloud: String(formData.get('soundcloud') || '').trim(),
        spotify: String(formData.get('spotify') || '').trim(),
        youtube: String(formData.get('youtube') || '').trim(),
        discord: String(formData.get('discord') || '').trim(),
        tiktok: String(formData.get('tiktok') || '').trim()
      },
      settings: {
        appearance,
        notifications,
        creator
      }
    }

    if (saveButton) {
      saveButton.disabled = true
      saveButton.textContent = 'Saving...'
    }

    try {
      await upsertUserProfile(user, nextProfile)
      if (nextProfile.displayName && nextProfile.displayName !== user.displayName) {
        await updateCurrentUserProfile({ displayName: nextProfile.displayName })
      }
      profile.displayName = nextProfile.displayName || profile.displayName
      profile.username = nextProfile.username
      profile.bio = nextProfile.bio
      profile.location = nextProfile.location
      profile.website = nextProfile.website
      profile.socials = nextProfile.socials
      if (feedback) {
        feedback.dataset.state = 'success'
        feedback.textContent = 'Profile changes saved.'
      }
    } catch (error) {
      if (feedback) {
        feedback.dataset.state = 'error'
        feedback.textContent = 'Could not save profile changes. Please try again.'
      }
      if (!hasWarnedEditProfile) {
        hasWarnedEditProfile = true
        console.warn('[edit-profile] Save failed.', error?.code || error?.message || error)
      }
    } finally {
      if (saveButton) {
        saveButton.disabled = false
        saveButton.textContent = 'Save Changes'
      }
    }
  })
}

async function initEditProfile() {
  const user = await waitForInitialAuthState()
  if (!user) {
    renderSignedOutState()
    return
  }

  let storedProfile = null
  try {
    storedProfile = await getUserProfile(user.uid)
  } catch (error) {
    if (!hasWarnedEditProfile) {
      hasWarnedEditProfile = true
      console.warn('[edit-profile] Profile read failed; using Auth fallback.', error?.code || error?.message || error)
    }
  }

  renderSettingsPage(user, storedProfile || {})
}

window.addEventListener('hashchange', () => {
  initEditProfile()
})

initEditProfile()
