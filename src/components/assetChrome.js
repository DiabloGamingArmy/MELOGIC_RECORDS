import { getStorageAssetUrl } from '../firebase/storageAssets'
import { signOutUser, subscribeToAuthState, waitForInitialAuthState } from '../firebase/auth'
import { getCartItems, removeFromCart, subscribeToCart } from '../data/cartService'
import { ROUTES, authRoute } from '../utils/routes'

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function syncNavOffset() {
  const nav = document.querySelector('.nav-shell')
  if (!nav) return
  document.documentElement.style.setProperty('--nav-offset', `${nav.offsetHeight}px`)
}

export async function initNavBrandLogo() {
  const brandLogo = document.querySelector('[data-brand-logo]')
  if (!brandLogo) return false

  const storageLogoPrimaryPath = 'assets/brand/melogic-logo-mark-glow.png'
  const storageLogoFallbackPath = 'assets/brand/melogic-logo-mark-white-transparent.png'
  const storageLogoPrimaryUrl = await getStorageAssetUrl(storageLogoPrimaryPath, { warnOnFail: false })
  const storageLogoFallbackUrl = await getStorageAssetUrl(storageLogoFallbackPath, { warnOnFail: false })
  const logoCandidates = [
    storageLogoPrimaryUrl,
    storageLogoFallbackUrl,
    '/assets/brand/melogic-logo-mark-glow.png'
  ].filter(Boolean)

  const tryLoad = (url) => new Promise((resolve) => {
    let settled = false
    const finish = (ok) => {
      if (settled) return
      settled = true
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
    brandLogo.src = url
  })

  for (const logoUrl of logoCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const loaded = await tryLoad(logoUrl)
    if (loaded) return true
  }

  brandLogo.remove()
  return false
}

export function initShellChrome() {
  syncNavOffset()
  window.addEventListener('resize', syncNavOffset, { passive: true })
  initNavAuthState()
  initCartDrawer()
  return initNavBrandLogo()
}

function updateCartBadges(count) {
  document.querySelectorAll('[data-cart-badge]').forEach((badge) => {
    badge.textContent = String(count)
    badge.setAttribute('aria-label', `${count} item${count === 1 ? '' : 's'} in cart`)
  })
}

function renderCartDrawerItems(drawerRoot, items) {
  const list = drawerRoot.querySelector('[data-cart-drawer-list]')
  const subtitle = drawerRoot.querySelector('[data-cart-drawer-subtitle]')
  if (!list || !subtitle) return
  subtitle.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`

  if (!items.length) {
    list.innerHTML = `
      <article class="cart-drawer-empty">
        <h3>Your cart is empty.</h3>
        <p>Find sample packs, presets, and tools in Products.</p>
      </article>
    `
    return
  }

  list.innerHTML = items.map((item) => `
    <article class="cart-drawer-item">
      <div class="cart-drawer-thumb ${item.thumbnailURL ? 'has-image' : ''}">
        ${item.thumbnailURL ? `<img src="${escapeHtml(item.thumbnailURL)}" alt="" loading="lazy" />` : '<span>♪</span>'}
      </div>
      <div class="cart-drawer-meta">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.artistName)}</small>
      </div>
      <div class="cart-drawer-actions">
        <span>${escapeHtml(item.priceLabel || (item.isFree ? 'Free' : '—'))}</span>
        <button type="button" data-cart-remove="${escapeHtml(item.id)}" aria-label="Remove ${escapeHtml(item.title)}">Remove</button>
      </div>
    </article>
  `).join('')

  list.querySelectorAll('[data-cart-remove]').forEach((button) => {
    button.addEventListener('click', () => {
      const productId = button.getAttribute('data-cart-remove')
      removeFromCart(productId)
    })
  })
}

function initCartDrawer() {
  const triggers = Array.from(document.querySelectorAll('[data-cart-trigger]'))
  if (!triggers.length) return
  if (document.querySelector('.cart-drawer-root')) return

  const root = document.createElement('div')
  root.className = 'cart-drawer-root'
  root.innerHTML = `
    <div class="cart-drawer-backdrop" hidden>
      <aside class="cart-drawer" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title" tabindex="-1">
        <header class="cart-drawer-header">
          <div>
            <h2 id="cart-drawer-title">Cart</h2>
            <p data-cart-drawer-subtitle>0 items</p>
          </div>
          <button type="button" data-cart-drawer-close aria-label="Close cart drawer">×</button>
        </header>
        <section class="cart-drawer-list" data-cart-drawer-list></section>
        <footer class="cart-drawer-footer">
          <button type="button" class="button button-muted" data-cart-drawer-close>Close</button>
          <a href="${ROUTES.cart}" class="button button-accent">View Cart</a>
        </footer>
      </aside>
    </div>
  `
  document.body.append(root)

  const backdrop = root.querySelector('.cart-drawer-backdrop')
  const drawer = root.querySelector('.cart-drawer')
  const closeDrawer = () => {
    if (!backdrop) return
    backdrop.hidden = true
    document.documentElement.style.setProperty('--scrollbar-compensation', '0px')
    document.body.classList.remove('has-cart-drawer-open')
  }
  const openDrawer = () => {
    if (!backdrop) return
    const scrollbarWidth = Math.max(0, window.innerWidth - document.documentElement.clientWidth)
    document.documentElement.style.setProperty('--scrollbar-compensation', `${scrollbarWidth}px`)
    backdrop.hidden = false
    document.body.classList.add('has-cart-drawer-open')
    drawer?.focus()
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault()
      openDrawer()
    })
  })
  root.querySelectorAll('[data-cart-drawer-close]').forEach((button) => button.addEventListener('click', closeDrawer))
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeDrawer()
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop?.hidden) closeDrawer()
  })

  subscribeToCart((items) => {
    updateCartBadges(items.length)
    renderCartDrawerItems(root, items)
  })
  updateCartBadges(getCartItems().length)
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
  const inboxLink = document.querySelector('[data-nav-inbox]')
  if (!profileMenu || !profileTrigger || !profileDropdown || !profileAvatar || !authEntryLink || !signOutButton) return
  let currentUser = null

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
      window.location.assign(ROUTES.home)
    } catch {
      signOutButton.textContent = 'Log Out'
    } finally {
      signOutButton.removeAttribute('aria-busy')
      signOutButton.disabled = false
    }
  })

  setMenuOpen(false)

  waitForInitialAuthState().then((user) => {
    currentUser = user || null
    if (user) {
      setSignedInView(user)
    } else {
      setSignedOutView()
    }
  })

  subscribeToAuthState((user) => {
    currentUser = user || null
    if (user) {
      setSignedInView(user)
      return
    }
    setSignedOutView()
  })

  inboxLink?.addEventListener('click', async (event) => {
    if (currentUser) return
    const resolvedUser = await waitForInitialAuthState()
    if (resolvedUser) return
    event.preventDefault()
    window.location.assign(authRoute({ redirect: ROUTES.inbox }))
  })
}
