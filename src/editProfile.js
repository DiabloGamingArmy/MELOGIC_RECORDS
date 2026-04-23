import './styles/base.css'
import './styles/editProfile.css'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { signOutUser, updateCurrentUserProfile, waitForInitialAuthState } from './firebase/auth'
import { getEffectiveProfile, saveProfileChanges } from './firebase/firestore'
import { storage } from './firebase/storage'

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
let pageState = null

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

function getMergedState(user, profileResult) {
  const profileData = profileResult?.publicProfile || {}
  const userData = profileResult?.privateProfile || {}
  const effective = profileResult?.effectiveProfile || {}

  return {
    user,
    profileData,
    userData,
    displayName: effective.displayName || user.displayName || '',
    username: effective.username || '',
    bio: effective.bio || '',
    roleLabel: profileData.roleLabel || userData.role || 'User',
    photoURL: effective.photoURL || user.photoURL || '',
    avatarPath: profileData.avatarPath || '',
    bannerPath: profileData.bannerPath || '',
    bannerURL: profileData.bannerURL || '',
    location: profileData.location || userData.location || '',
    website: profileData.website || userData.website || '',
    socials: profileData.socials || userData.socials || {},
    settings: userData.settings || {
      appearance: {},
      notifications: {},
      privacy: {}
    },
    creatorSettings: userData.creatorSettings || {}
  }
}

async function uploadProfileMedia(uid, files) {
  if (!storage) return {}
  const result = {}

  if (files.avatar instanceof File && files.avatar.size > 0) {
    const avatarPath = `users/${uid}/avatar/current.webp`
    await uploadBytes(ref(storage, avatarPath), files.avatar, { contentType: files.avatar.type || 'image/webp' })
    result.avatarPath = avatarPath
    result.avatarURL = await getDownloadURL(ref(storage, avatarPath))
  }

  if (files.banner instanceof File && files.banner.size > 0) {
    const bannerPath = `users/${uid}/banner/current.webp`
    await uploadBytes(ref(storage, bannerPath), files.banner, { contentType: files.banner.type || 'image/webp' })
    result.bannerPath = bannerPath
    result.bannerURL = await getDownloadURL(ref(storage, bannerPath))
  }

  return result
}

function renderSettingsPage() {
  const state = pageState
  if (!state) return

  const activeSection = readHashSection()
  const providerIds = state.user.providerData.map((provider) => provider.providerId)
  const appearance = state.settings.appearance || {}
  const notifications = state.settings.notifications || {}
  const creatorSettings = state.creatorSettings || {}

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
            ${state.photoURL ? `<img class="avatar-lg" src="${state.photoURL}" alt="${state.displayName || 'Profile'}" />` : `<div class="avatar-lg avatar-fallback">${fallbackInitials(state.displayName || state.user.email)}</div>`}
            <div>
              <label><span>Avatar</span><input type="file" accept="image/*" name="avatarFile" data-avatar-input /></label>
              <label><span>Banner</span><input type="file" accept="image/*" name="bannerFile" data-banner-input /></label>
            </div>
          </div>

          <form data-profile-form>
            <div class="field-grid">
              <label><span>Display Name</span><input name="displayName" value="${state.displayName}" /></label>
              <label><span>Username</span><input name="username" value="${state.username}" /></label>
            </div>
            <label><span>Bio</span><textarea name="bio" rows="3">${state.bio}</textarea></label>
            <div class="field-grid">
              <label><span>Role Label</span><input name="roleLabel" value="${state.roleLabel}" /></label>
              <label><span>Location</span><input name="location" value="${state.location}" /></label>
            </div>
            <label><span>Website</span><input name="website" value="${state.website}" placeholder="https://" /></label>
            <h3>Social Links</h3>
            <div class="field-grid">
              <label><span>Instagram</span><input name="instagram" value="${state.socials.instagram || ''}" /></label>
              <label><span>SoundCloud</span><input name="soundcloud" value="${state.socials.soundcloud || ''}" /></label>
              <label><span>Spotify</span><input name="spotify" value="${state.socials.spotify || ''}" /></label>
              <label><span>YouTube</span><input name="youtube" value="${state.socials.youtube || ''}" /></label>
              <label><span>Discord</span><input name="discord" value="${state.socials.discord || ''}" /></label>
              <label><span>TikTok</span><input name="tiktok" value="${state.socials.tiktok || ''}" /></label>
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
            <div><dt>Email</dt><dd>${state.user.email || 'Unavailable'}</dd></div>
            <div><dt>Account ID</dt><dd>${state.user.uid}</dd></div>
            <div><dt>Created</dt><dd>${state.user.metadata?.creationTime || 'Unavailable'}</dd></div>
            <div><dt>Role</dt><dd>${state.userData.role || 'user'}</dd></div>
          </dl>
          <p class="muted">Email updates are view-only for now.</p>
        </div>

        <div class="settings-panel ${activeSection === 'appearance' ? 'is-active' : ''}" data-panel="appearance">
          <h2>Appearance</h2>
          <div class="toggle-list">
            <label><span>Theme</span><select name="theme"><option ${appearance.theme === 'dark' ? 'selected' : ''}>dark</option><option ${appearance.theme === 'system' ? 'selected' : ''}>system</option></select></label>
            <label><input type="checkbox" name="compactMode" ${appearance.compactMode ? 'checked' : ''} /> Compact mode</label>
            <label><input type="checkbox" name="reducedMotion" ${appearance.reducedMotion ? 'checked' : ''} /> Reduced motion</label>
          </div>
        </div>

        <div class="settings-panel ${activeSection === 'creator-settings' ? 'is-active' : ''}" data-panel="creator-settings">
          <h2>Creator Settings</h2>
          <div class="toggle-list">
            <label><input type="checkbox" name="creatorMode" ${creatorSettings.creatorMode ? 'checked' : ''} /> Creator mode</label>
            <label><input type="checkbox" name="publicCreatorProfile" ${creatorSettings.publicCreatorProfile ?? true ? 'checked' : ''} /> Public creator profile</label>
            <label><input type="checkbox" name="storefrontVisible" ${creatorSettings.storefrontVisible ?? false ? 'checked' : ''} /> Storefront visibility</label>
            <label><span>Submission preferences</span><input name="submissionPreferences" value="${creatorSettings.submissionPreferences || ''}" /></label>
          </div>
        </div>

        <div class="settings-panel ${activeSection === 'security' ? 'is-active' : ''}" data-panel="security">
          <h2>Security</h2>
          <ul>
            <li>Password status is managed by your auth provider.</li>
            <li>Signed in providers: ${providerIds.join(', ') || 'email/password'}</li>
            <li>Sign out all devices is coming soon.</li>
          </ul>
          <button type="button" class="button button-muted" disabled>Change Password (Soon)</button>
        </div>

        <div class="settings-panel ${activeSection === 'notifications' ? 'is-active' : ''}" data-panel="notifications">
          <h2>Notifications</h2>
          <div class="toggle-list">
            <label><input type="checkbox" name="productUpdates" ${notifications.productUpdates ?? true ? 'checked' : ''} /> Product updates</label>
            <label><input type="checkbox" name="replies" ${notifications.replies ?? true ? 'checked' : ''} /> Replies</label>
            <label><input type="checkbox" name="creatorNews" ${notifications.creatorNews ?? true ? 'checked' : ''} /> Creator news</label>
            <label><input type="checkbox" name="releaseAlerts" ${notifications.releaseAlerts ?? true ? 'checked' : ''} /> Release alerts</label>
            <label><input type="checkbox" name="marketing" ${notifications.marketing ?? false ? 'checked' : ''} /> Marketing</label>
          </div>
        </div>

        <div class="settings-panel ${activeSection === 'connections' ? 'is-active' : ''}" data-panel="connections">
          <h2>Connections</h2>
          <ul>
            <li>Google: ${providerIds.includes('google.com') ? 'Connected' : 'Not connected'}</li>
            <li>Email/Password: ${providerIds.includes('password') ? 'Connected' : 'Not connected'}</li>
            <li>Spotify / YouTube / Discord links are managed in Public Profile for now.</li>
          </ul>
        </div>

        <div class="settings-panel ${activeSection === 'danger-zone' ? 'is-active' : ''}" data-panel="danger-zone">
          <h2>Danger Zone</h2>
          <p class="danger-copy">Destructive account actions are intentionally restricted for safety.</p>
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
      window.location.hash = button.dataset.sectionBtn
      renderSettingsPage()
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
    const avatarInput = editRoot.querySelector('[data-avatar-input]')
    const bannerInput = editRoot.querySelector('[data-banner-input]')

    const nextPayload = {
      displayName: String(formData.get('displayName') || '').trim(),
      username: String(formData.get('username') || '').trim(),
      bio: String(formData.get('bio') || '').trim(),
      role: state.userData.role || 'user',
      roleLabel: String(formData.get('roleLabel') || '').trim() || 'User',
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
        appearance: {
          theme: String(formData.get('theme') || 'dark'),
          compactMode: formData.get('compactMode') === 'on',
          reducedMotion: formData.get('reducedMotion') === 'on'
        },
        notifications: {
          productUpdates: formData.get('productUpdates') === 'on',
          replies: formData.get('replies') === 'on',
          creatorNews: formData.get('creatorNews') === 'on',
          releaseAlerts: formData.get('releaseAlerts') === 'on',
          marketing: formData.get('marketing') === 'on'
        },
        privacy: {
          profileVisibility: 'public'
        }
      },
      creatorSettings: {
        creatorMode: formData.get('creatorMode') === 'on',
        publicCreatorProfile: formData.get('publicCreatorProfile') === 'on',
        storefrontVisible: formData.get('storefrontVisible') === 'on',
        submissionPreferences: String(formData.get('submissionPreferences') || '').trim()
      }
    }

    if (saveButton) {
      saveButton.disabled = true
      saveButton.textContent = 'Saving...'
    }

    try {
      const mediaResult = await uploadProfileMedia(state.user.uid, {
        avatar: avatarInput?.files?.[0],
        banner: bannerInput?.files?.[0]
      })

      Object.assign(nextPayload, {
        avatarPath: mediaResult.avatarPath || state.avatarPath,
        avatarURL: mediaResult.avatarURL || state.photoURL,
        photoURL: mediaResult.avatarURL || state.photoURL,
        bannerPath: mediaResult.bannerPath || state.bannerPath,
        bannerURL: mediaResult.bannerURL || state.bannerURL
      })

      await saveProfileChanges(state.user, nextPayload)

      if (nextPayload.displayName && nextPayload.displayName !== state.user.displayName) {
        await updateCurrentUserProfile({ displayName: nextPayload.displayName })
      }
      if (nextPayload.avatarURL && nextPayload.avatarURL !== state.user.photoURL) {
        await updateCurrentUserProfile({ photoURL: nextPayload.avatarURL })
      }

      if (feedback) {
        feedback.dataset.state = 'success'
        feedback.textContent = 'Profile changes saved.'
      }

      pageState = { ...state, ...nextPayload, photoURL: nextPayload.avatarURL }
      renderSettingsPage()
    } catch (error) {
      if (feedback) {
        feedback.dataset.state = 'error'
        feedback.textContent = error?.code === 'profile/username-taken'
          ? 'That username is already taken. Please choose another.'
          : 'Could not save profile changes. Please try again.'
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

  const profileResult = await getEffectiveProfile(user.uid, user)
  pageState = getMergedState(user, profileResult)
  renderSettingsPage()
}

window.addEventListener('hashchange', () => {
  if (!pageState) return
  renderSettingsPage()
})

initEditProfile()
