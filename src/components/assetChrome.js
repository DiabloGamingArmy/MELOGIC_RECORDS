import { getStorageAssetUrl } from '../firebase/storageAssets'
import { signOutUser, subscribeToAuthState, waitForInitialAuthState } from '../firebase/auth'

export function syncNavOffset() {
  const nav = document.querySelector('.nav-shell')
  if (!nav) return
  document.documentElement.style.setProperty('--nav-offset', `${nav.offsetHeight}px`)
}

export async function initNavBrandLogo() {
  const brandLogo = document.querySelector('[data-brand-logo]')
  if (!brandLogo) return false

  const logoUrl = await getStorageAssetUrl('assets/brand/melogic-logo-mark-glow.png', { warnOnFail: false })
  if (!logoUrl) {
    brandLogo.remove()
    return false
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
      if (!ok) brandLogo.remove()
      resolve(ok)
    }

    brandLogo.addEventListener(
      'load',
      () => {
        brandLogo.dataset.loaded = 'true'
        finish(true)
      },
      { once: true }
    )

    brandLogo.addEventListener('error', () => finish(false), { once: true })
    brandLogo.src = logoUrl
  })
}

export function initShellChrome() {
  syncNavOffset()
  window.addEventListener('resize', syncNavOffset, { passive: true })
  initNavAuthState()
  return initNavBrandLogo()
}

function initNavAuthState() {
  const profileMenu = document.querySelector('[data-profile-menu]')
  const profileTrigger = document.querySelector('[data-nav-profile-trigger]')
  const profileDropdown = document.querySelector('[data-nav-profile-dropdown]')
  const profileAvatar = document.querySelector('[data-profile-avatar]')
  const viewProfileLink = document.querySelector('[data-nav-menu-view]')
  const editProfileLink = document.querySelector('[data-nav-menu-edit]')
  const signOutButton = document.querySelector('[data-nav-menu-signout]')
  const authEntryLink = document.querySelector('[data-nav-menu-auth]')
  if (!profileMenu || !profileTrigger || !profileDropdown || !profileAvatar || !authEntryLink || !signOutButton) return

  const setMenuOpen = (open) => {
    profileTrigger.setAttribute('aria-expanded', String(open))
    profileDropdown.hidden = !open
    profileMenu.classList.toggle('is-open', open)
  }

  const setSignedOutView = () => {
    profileAvatar.classList.remove('has-photo')
    profileAvatar.style.backgroundImage = ''
    profileAvatar.setAttribute('aria-label', 'Guest account icon')
    authEntryLink.hidden = false
    signOutButton.hidden = true
    if (viewProfileLink) viewProfileLink.hidden = true
    if (editProfileLink) editProfileLink.hidden = true
  }

  const setSignedInView = (user) => {
    signOutButton.textContent = 'Log Out'
    authEntryLink.hidden = true
    signOutButton.hidden = false
    if (viewProfileLink) viewProfileLink.hidden = false
    if (editProfileLink) editProfileLink.hidden = false

    if (user?.photoURL) {
      profileAvatar.classList.add('has-photo')
      profileAvatar.style.backgroundImage = `url(\"${user.photoURL}\")`
      profileAvatar.setAttribute('aria-label', `${user.displayName || 'User'} profile image`)
    } else {
      profileAvatar.classList.remove('has-photo')
      profileAvatar.style.backgroundImage = ''
      profileAvatar.setAttribute('aria-label', 'Default account icon')
    }
  }

  profileTrigger.addEventListener('click', () => {
    const isOpen = profileTrigger.getAttribute('aria-expanded') === 'true'
    setMenuOpen(!isOpen)
  })

  profileTrigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setMenuOpen(true)
  })

  profileDropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMenuOpen(false)
      profileTrigger.focus()
    }
  })

  document.addEventListener('click', (event) => {
    if (!profileMenu.contains(event.target)) {
      setMenuOpen(false)
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuOpen(false)
  })

  authEntryLink.addEventListener('click', () => {
    setMenuOpen(false)
  })

  if (viewProfileLink) {
    viewProfileLink.addEventListener('click', () => setMenuOpen(false))
  }
  if (editProfileLink) {
    editProfileLink.addEventListener('click', () => setMenuOpen(false))
  }

  signOutButton.addEventListener('click', async (event) => {
    event.preventDefault()
    signOutButton.textContent = 'Logging Out...'
    signOutButton.setAttribute('aria-busy', 'true')
    signOutButton.disabled = true
    try {
      await signOutUser()
      setMenuOpen(false)
    } catch {
      signOutButton.textContent = 'Log Out'
    } finally {
      signOutButton.removeAttribute('aria-busy')
      signOutButton.disabled = false
    }
  })

  setMenuOpen(false)

  waitForInitialAuthState().then((user) => {
    if (user) {
      setSignedInView(user)
    } else {
      setSignedOutView()
    }
  })

  subscribeToAuthState((user) => {
    if (user) {
      setSignedInView(user)
      return
    }
    setSignedOutView()
  })
}
