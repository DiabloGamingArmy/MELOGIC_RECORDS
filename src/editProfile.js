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

const MEDIA_CONFIG = {
  avatar: {
    aspect: 1,
    outputWidth: 768,
    outputHeight: 768,
    previewClass: 'avatar-lg',
    changeLabel: 'Change Profile Picture',
    help: 'Recommended: square image, at least 768×768. JPG/PNG/WEBP up to 8MB.'
  },
  banner: {
    aspect: 3,
    outputWidth: 1800,
    outputHeight: 600,
    previewClass: 'banner-preview',
    changeLabel: 'Change Banner',
    help: 'Recommended: wide image, at least 1800×600. JPG/PNG/WEBP up to 8MB.'
  }
}

const app = document.querySelector('#app')
app.innerHTML = `
  ${navShell({ currentPage: 'profile' })}
  <main>
    <section class="standard-hero utility-hero section">
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

function setGlobalEditStatus(message = '', state = 'info') {
  if (!pageState) return
  pageState.feedback = {
    message,
    state
  }
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
    creatorSettings: userData.creatorSettings || {},
    pendingMedia: {
      avatarFile: null,
      bannerFile: null,
      avatarPreview: '',
      bannerPreview: '',
      avatarRemoved: false,
      bannerRemoved: false
    },
    feedback: {
      message: '',
      state: 'info'
    }
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

function dataUrlToFile(dataUrl, filename) {
  const [metadata, payload] = dataUrl.split(',')
  const mimeMatch = metadata.match(/data:(.*?);base64/)
  const mimeType = mimeMatch?.[1] || 'image/webp'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return new File([bytes], filename, { type: mimeType })
}

function loadImageFromSource(source) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Failed to load image source.'))
    image.src = source
  })
}

async function openImageCropModal(type, file) {
  const config = MEDIA_CONFIG[type]
  if (!config) throw new Error('Unsupported media type')

  const localUrl = URL.createObjectURL(file)
  const image = await loadImageFromSource(localUrl)

  return new Promise((resolve, reject) => {
    const modal = document.createElement('div')
    modal.className = 'media-modal-overlay'
    modal.innerHTML = `
      <div class="media-modal" role="dialog" aria-modal="true" aria-label="Image crop editor">
        <header>
          <h3>${type === 'avatar' ? 'Edit Profile Picture' : 'Edit Banner'}</h3>
          <button type="button" class="media-icon-btn" data-modal-cancel aria-label="Close">×</button>
        </header>
        <p class="modal-helper">Drag image to reposition. Use zoom slider for crop framing.</p>
        <div class="crop-preview-wrap ${type === 'avatar' ? 'is-avatar' : 'is-banner'}">
          <canvas data-crop-canvas width="640" height="360"></canvas>
        </div>
        <label class="media-zoom-label">
          <span>Zoom</span>
          <input data-crop-zoom type="range" min="1" max="3" value="1" step="0.01" />
        </label>
        <footer class="modal-actions">
          <button type="button" class="button button-muted" data-modal-cancel>Cancel</button>
          <button type="button" class="button button-accent" data-modal-confirm>Use Image</button>
        </footer>
      </div>
    `

    document.body.append(modal)

    const canvas = modal.querySelector('[data-crop-canvas]')
    const ctx = canvas.getContext('2d')
    const zoomInput = modal.querySelector('[data-crop-zoom]')
    const cancelButtons = modal.querySelectorAll('[data-modal-cancel]')
    const confirmButton = modal.querySelector('[data-modal-confirm]')

    const viewportAspect = config.aspect
    const canvasPadding = 40
    const availableWidth = canvas.width - (canvasPadding * 2)
    const availableHeight = canvas.height - (canvasPadding * 2)
    let cropWidth = availableWidth
    let cropHeight = cropWidth / viewportAspect

    if (cropHeight > availableHeight) {
      cropHeight = availableHeight
      cropWidth = cropHeight * viewportAspect
    }

    const cropX = (canvas.width - cropWidth) / 2
    const cropY = (canvas.height - cropHeight) / 2

    const baseScale = Math.max(cropWidth / image.naturalWidth, cropHeight / image.naturalHeight)
    let zoom = 1
    let scale = baseScale
    let posX = cropX + ((cropWidth - (image.naturalWidth * scale)) / 2)
    let posY = cropY + ((cropHeight - (image.naturalHeight * scale)) / 2)
    let dragging = false
    let dragStart = { x: 0, y: 0, posX: 0, posY: 0 }

    function clampPosition() {
      const renderWidth = image.naturalWidth * scale
      const renderHeight = image.naturalHeight * scale
      const minX = cropX + cropWidth - renderWidth
      const maxX = cropX
      const minY = cropY + cropHeight - renderHeight
      const maxY = cropY
      posX = Math.min(maxX, Math.max(minX, posX))
      posY = Math.min(maxY, Math.max(minY, posY))
    }

    function drawCropFrame() {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = 'rgba(3, 6, 11, 0.95)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      ctx.save()
      ctx.beginPath()
      if (type === 'avatar') {
        const radius = Math.min(cropWidth, cropHeight) / 2
        ctx.arc(cropX + (cropWidth / 2), cropY + (cropHeight / 2), radius, 0, Math.PI * 2)
      } else {
        ctx.rect(cropX, cropY, cropWidth, cropHeight)
      }
      ctx.clip()
      ctx.drawImage(image, posX, posY, image.naturalWidth * scale, image.naturalHeight * scale)
      ctx.restore()

      ctx.strokeStyle = 'rgba(232, 241, 255, 0.78)'
      ctx.lineWidth = 2
      if (type === 'avatar') {
        const radius = Math.min(cropWidth, cropHeight) / 2
        ctx.beginPath()
        ctx.arc(cropX + (cropWidth / 2), cropY + (cropHeight / 2), radius, 0, Math.PI * 2)
        ctx.stroke()
      } else {
        ctx.strokeRect(cropX, cropY, cropWidth, cropHeight)
      }
    }

    function updateScale(newZoom) {
      const oldScale = scale
      const nextZoom = Number(newZoom)
      zoom = Number.isNaN(nextZoom) ? 1 : nextZoom
      scale = baseScale * zoom
      const anchorX = cropX + (cropWidth / 2)
      const anchorY = cropY + (cropHeight / 2)
      const ratio = scale / oldScale
      posX = anchorX - ((anchorX - posX) * ratio)
      posY = anchorY - ((anchorY - posY) * ratio)
      clampPosition()
      drawCropFrame()
    }

    function closeModal() {
      URL.revokeObjectURL(localUrl)
      modal.remove()
    }

    function getClientPos(event) {
      if (event.touches?.[0]) {
        return {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY
        }
      }
      return {
        x: event.clientX,
        y: event.clientY
      }
    }

    function startDrag(event) {
      dragging = true
      const clientPos = getClientPos(event)
      dragStart = { x: clientPos.x, y: clientPos.y, posX, posY }
      canvas.classList.add('is-dragging')
    }

    function dragMove(event) {
      if (!dragging) return
      event.preventDefault()
      const clientPos = getClientPos(event)
      posX = dragStart.posX + (clientPos.x - dragStart.x)
      posY = dragStart.posY + (clientPos.y - dragStart.y)
      clampPosition()
      drawCropFrame()
    }

    function endDrag() {
      dragging = false
      canvas.classList.remove('is-dragging')
    }

    canvas.addEventListener('mousedown', startDrag)
    window.addEventListener('mousemove', dragMove)
    window.addEventListener('mouseup', endDrag)
    canvas.addEventListener('touchstart', startDrag, { passive: true })
    window.addEventListener('touchmove', dragMove, { passive: false })
    window.addEventListener('touchend', endDrag)

    zoomInput.addEventListener('input', () => updateScale(zoomInput.value))

    cancelButtons.forEach((button) => {
      button.addEventListener('click', () => {
        window.removeEventListener('mousemove', dragMove)
        window.removeEventListener('mouseup', endDrag)
        window.removeEventListener('touchmove', dragMove)
        window.removeEventListener('touchend', endDrag)
        closeModal()
        reject(new Error('Crop cancelled'))
      })
    })

    confirmButton.addEventListener('click', () => {
      const outputCanvas = document.createElement('canvas')
      outputCanvas.width = config.outputWidth
      outputCanvas.height = config.outputHeight
      const outputCtx = outputCanvas.getContext('2d')

      const sourceX = (cropX - posX) / scale
      const sourceY = (cropY - posY) / scale
      const sourceWidth = cropWidth / scale
      const sourceHeight = cropHeight / scale

      outputCtx.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        config.outputWidth,
        config.outputHeight
      )

      const previewDataUrl = outputCanvas.toDataURL('image/webp', 0.92)
      const croppedFile = dataUrlToFile(previewDataUrl, `${type}.webp`)

      window.removeEventListener('mousemove', dragMove)
      window.removeEventListener('mouseup', endDrag)
      window.removeEventListener('touchmove', dragMove)
      window.removeEventListener('touchend', endDrag)
      closeModal()

      resolve({
        file: croppedFile,
        previewUrl: previewDataUrl
      })
    })

    updateScale(1)
  })
}

async function openMediaChoiceModal(type) {
  const config = MEDIA_CONFIG[type]
  if (!config) return

  const modal = document.createElement('div')
  modal.className = 'media-modal-overlay'
  modal.innerHTML = `
    <div class="media-modal media-choice" role="dialog" aria-modal="true" aria-label="Media options">
      <header>
        <h3>${config.changeLabel}</h3>
        <button type="button" class="media-icon-btn" data-choice-close aria-label="Close">×</button>
      </header>
      <p class="modal-helper">Choose how you want to update your ${type === 'avatar' ? 'profile picture' : 'banner'}.</p>
      <div class="choice-grid">
        <button type="button" class="button button-accent" data-choice-upload>Upload File</button>
        <button type="button" class="button button-muted" data-choice-link>Use Image Link</button>
      </div>
      <p class="modal-footnote">Tip: upload high-resolution images for best quality.</p>
    </div>
  `
  document.body.append(modal)

  return new Promise((resolve) => {
    function closeChoice() {
      modal.remove()
      resolve()
    }

    modal.querySelector('[data-choice-close]')?.addEventListener('click', closeChoice)
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeChoice()
    })

    modal.querySelector('[data-choice-upload]')?.addEventListener('click', () => {
      const hiddenInput = editRoot.querySelector(type === 'avatar' ? '[data-avatar-input]' : '[data-banner-input]')
      hiddenInput?.click()
      closeChoice()
    })

    modal.querySelector('[data-choice-link]')?.addEventListener('click', async () => {
      closeChoice()
      const link = window.prompt('Paste a direct image URL')
      if (!link) return
      try {
        const response = await fetch(link)
        if (!response.ok) throw new Error('Image URL request failed')
        const blob = await response.blob()
        const extension = blob.type.includes('png') ? 'png' : blob.type.includes('jpeg') ? 'jpg' : 'webp'
        const file = new File([blob], `${type}-link.${extension}`, { type: blob.type || 'image/webp' })
        const cropResult = await openImageCropModal(type, file)
        applyPreviewMedia(type, cropResult)
      } catch {
        setGlobalEditStatus(`Could not load ${type === 'avatar' ? 'profile picture' : 'banner'} from link. Try upload file.`, 'error')
        renderSettingsPage()
      }
    })
  })
}

function applyPreviewMedia(type, cropResult) {
  if (!pageState || !cropResult) return
  if (type === 'avatar') {
    pageState.pendingMedia.avatarFile = cropResult.file
    pageState.pendingMedia.avatarPreview = cropResult.previewUrl
    pageState.pendingMedia.avatarRemoved = false
    setGlobalEditStatus('Profile picture preview updated. Save changes to publish it.', 'info')
  } else {
    pageState.pendingMedia.bannerFile = cropResult.file
    pageState.pendingMedia.bannerPreview = cropResult.previewUrl
    pageState.pendingMedia.bannerRemoved = false
    setGlobalEditStatus('Banner preview updated. Save changes to publish it.', 'info')
  }
  renderSettingsPage()
}

function clearPreviewMedia(type) {
  if (!pageState) return
  if (type === 'avatar') {
    pageState.pendingMedia.avatarFile = null
    pageState.pendingMedia.avatarPreview = ''
    pageState.pendingMedia.avatarRemoved = true
    pageState.photoURL = ''
    setGlobalEditStatus('Profile picture removed from preview. Save changes to confirm.', 'info')
  } else {
    pageState.pendingMedia.bannerFile = null
    pageState.pendingMedia.bannerPreview = ''
    pageState.pendingMedia.bannerRemoved = true
    pageState.bannerURL = ''
    setGlobalEditStatus('Banner removed from preview. Save changes to confirm.', 'info')
  }
  renderSettingsPage()
}

function renderSettingsPage() {
  const state = pageState
  if (!state) return

  const activeSection = readHashSection()
  const providerIds = state.user.providerData.map((provider) => provider.providerId)
  const appearance = state.settings.appearance || {}
  const notifications = state.settings.notifications || {}
  const creatorSettings = state.creatorSettings || {}
  const avatarPreview = state.pendingMedia.avatarPreview || state.photoURL
  const bannerPreview = state.pendingMedia.bannerPreview || state.bannerURL

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
        <div class="edit-global-status ${state.feedback.message ? 'is-visible' : ''} ${state.feedback.state ? `is-${state.feedback.state}` : ''}" data-edit-feedback role="status" aria-live="polite">
          ${state.feedback.message || ''}
        </div>

        <div class="settings-panel ${activeSection === 'public-profile' ? 'is-active' : ''}" data-panel="public-profile">
          <h2>Public Profile</h2>
          <p class="section-copy">Update your public-facing profile identity and media.</p>

          <div class="media-section">
            <article class="media-card">
              <h3>Profile Picture</h3>
              <div class="media-preview-wrap">
                ${avatarPreview ? `<img class="avatar-lg" src="${avatarPreview}" alt="${state.displayName || 'Profile'}" />` : `<div class="avatar-lg avatar-fallback">${fallbackInitials(state.displayName || state.user.email)}</div>`}
              </div>
              <div class="media-actions">
                <button type="button" class="button button-accent" data-change-media="avatar">Change Profile Picture</button>
                <button type="button" class="button button-muted" data-remove-media="avatar">Remove Photo</button>
              </div>
              <p class="media-help">${MEDIA_CONFIG.avatar.help}</p>
            </article>

            <article class="media-card media-card-banner">
              <h3>Profile Banner</h3>
              <div class="media-preview-wrap banner-wrap">
                ${bannerPreview ? `<img class="banner-preview" src="${bannerPreview}" alt="Banner preview" />` : `<div class="banner-preview banner-fallback">No banner selected</div>`}
              </div>
              <div class="media-actions">
                <button type="button" class="button button-accent" data-change-media="banner">Change Banner</button>
                <button type="button" class="button button-muted" data-remove-media="banner">Remove Banner</button>
              </div>
              <p class="media-help">${MEDIA_CONFIG.banner.help}</p>
            </article>
          </div>

          <input class="hidden-file-input" type="file" accept="image/*" name="avatarFile" data-avatar-input />
          <input class="hidden-file-input" type="file" accept="image/*" name="bannerFile" data-banner-input />

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
          <div class="actions-row account-actions">
            <button type="button" class="button button-muted" data-signout>Sign Out</button>
          </div>
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
  const avatarInput = editRoot.querySelector('[data-avatar-input]')
  const bannerInput = editRoot.querySelector('[data-banner-input]')
  const changeMediaButtons = editRoot.querySelectorAll('[data-change-media]')
  const removeMediaButtons = editRoot.querySelectorAll('[data-remove-media]')

  if (!state.feedback.message && feedback) {
    feedback.textContent = ''
  }

  navButtons.forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = button.dataset.sectionBtn
      renderSettingsPage()
    })
  })

  changeMediaButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const mediaType = button.dataset.changeMedia
      await openMediaChoiceModal(mediaType)
    })
  })

  removeMediaButtons.forEach((button) => {
    button.addEventListener('click', () => {
      clearPreviewMedia(button.dataset.removeMedia)
    })
  })

  avatarInput?.addEventListener('change', async () => {
    const file = avatarInput.files?.[0]
    if (!file) return
    try {
      const cropResult = await openImageCropModal('avatar', file)
      applyPreviewMedia('avatar', cropResult)
    } catch {
      // user cancelled
    }
    avatarInput.value = ''
  })

  bannerInput?.addEventListener('change', async () => {
    const file = bannerInput.files?.[0]
    if (!file) return
    try {
      const cropResult = await openImageCropModal('banner', file)
      applyPreviewMedia('banner', cropResult)
    } catch {
      // user cancelled
    }
    bannerInput.value = ''
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
        avatar: state.pendingMedia.avatarFile,
        banner: state.pendingMedia.bannerFile
      })

      const nextAvatarURL = state.pendingMedia.avatarRemoved ? '' : (mediaResult.avatarURL || state.pendingMedia.avatarPreview || state.photoURL)
      const nextBannerURL = state.pendingMedia.bannerRemoved ? '' : (mediaResult.bannerURL || state.pendingMedia.bannerPreview || state.bannerURL)

      Object.assign(nextPayload, {
        avatarPath: state.pendingMedia.avatarRemoved ? '' : (mediaResult.avatarPath || state.avatarPath),
        avatarURL: nextAvatarURL,
        photoURL: nextAvatarURL,
        bannerPath: state.pendingMedia.bannerRemoved ? '' : (mediaResult.bannerPath || state.bannerPath),
        bannerURL: nextBannerURL
      })

      await saveProfileChanges(state.user, nextPayload)

      if (nextPayload.displayName && nextPayload.displayName !== state.user.displayName) {
        await updateCurrentUserProfile({ displayName: nextPayload.displayName })
      }
      if (nextPayload.avatarURL !== state.user.photoURL) {
        await updateCurrentUserProfile({ photoURL: nextPayload.avatarURL || null })
      }

      const mediaMessages = []
      if (state.pendingMedia.avatarFile || state.pendingMedia.avatarRemoved) mediaMessages.push('Profile picture updated successfully.')
      if (state.pendingMedia.bannerFile || state.pendingMedia.bannerRemoved) mediaMessages.push('Banner updated successfully.')
      setGlobalEditStatus(mediaMessages.length ? `${mediaMessages.join(' ')} Profile changes saved.` : 'Profile changes saved.', 'success')

      pageState = {
        ...state,
        ...nextPayload,
        photoURL: nextPayload.avatarURL,
        bannerURL: nextPayload.bannerURL,
        pendingMedia: {
          avatarFile: null,
          bannerFile: null,
          avatarPreview: '',
          bannerPreview: '',
          avatarRemoved: false,
          bannerRemoved: false
        }
      }
      renderSettingsPage()
    } catch (error) {
      setGlobalEditStatus(
        error?.code === 'profile/username-taken'
          ? 'That username is already taken. Please choose another.'
          : 'Could not save profile changes. Please try again.',
        'error'
      )
      renderSettingsPage()
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
