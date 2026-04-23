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
  const authLink = document.querySelector('[data-nav-auth]')
  const profileLink = document.querySelector('[data-nav-profile]')
  const profileAvatar = document.querySelector('[data-profile-avatar]')
  if (!authLink || !profileLink || !profileAvatar) return

  const setSignedOutView = () => {
    authLink.textContent = 'Sign In / Sign Up'
    authLink.href = '/auth.html'
    authLink.dataset.mode = 'signin'
    profileLink.href = '/auth.html'
    profileAvatar.classList.remove('has-photo')
    profileAvatar.style.backgroundImage = ''
    profileAvatar.setAttribute('aria-label', 'Guest account icon')
  }

  const setSignedInView = (user) => {
    authLink.textContent = 'Sign Out'
    authLink.href = '#'
    authLink.dataset.mode = 'signout'
    profileLink.href = '/profile.html'

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

  authLink.addEventListener('click', async (event) => {
    if (authLink.dataset.mode !== 'signout') return
    event.preventDefault()
    authLink.textContent = 'Signing out...'
    authLink.setAttribute('aria-busy', 'true')
    try {
      await signOutUser()
    } catch {
      authLink.textContent = 'Sign Out'
    } finally {
      authLink.removeAttribute('aria-busy')
    }
  })

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
