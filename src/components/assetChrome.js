import { getStorageAssetUrl } from '../firebase/storageAssets'
import { signOutUser, subscribeToAuthState, waitForInitialAuthState } from '../firebase/auth'
import { getCartItems, removeFromCart, subscribeToCart } from '../data/cartService'
import { getAccessGateConfig, getBannerAlertConfig } from '../firebase/firestore'
import { startPresenceTracking } from '../services/presenceService'
import { applyCachedPreviewImage, loadCachedPreviewImage } from '../services/imagePreviewCache'
import { ROUTES, authRoute } from '../utils/routes'

const ACCESS_GATE_STORAGE_KEY = 'melogic_access_gate'
const BANNER_ALERT_STORAGE_KEY = 'melogic_banner_alert'
let navAuthCleanup = null

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

  const tryLoad = async (url) => new Promise(async (resolve) => {
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
    if (/^https?:\/\//i.test(url)) {
      const cached = await loadCachedPreviewImage({
        cacheKey: 'nav-brand-logo',
        sourceUrl: url,
        versionKey: url,
        maxSize: 64
      })
      brandLogo.src = cached.previewUrl || url
      cached.refresh.then((freshPreviewUrl) => {
        if (freshPreviewUrl && brandLogo.isConnected) brandLogo.src = freshPreviewUrl
      }).catch(() => {})
    } else {
      brandLogo.src = url
    }
  })

  for (const logoUrl of logoCandidates) {
    // eslint-disable-next-line no-await-in-loop
    const loaded = await tryLoad(logoUrl)
    if (loaded) return true
  }

  brandLogo.remove()
  return false
}

function readAccessGateGrant() {
  try {
    const parsed = JSON.parse(localStorage.getItem(ACCESS_GATE_STORAGE_KEY) || 'null')
    if (!parsed || parsed.granted !== true || !Number.isFinite(Number(parsed.keyVersion))) return null
    return { granted: true, keyVersion: Number(parsed.keyVersion), grantedAt: Number(parsed.grantedAt || 0) }
  } catch {
    localStorage.removeItem(ACCESS_GATE_STORAGE_KEY)
    return null
  }
}

function writeAccessGateGrant(keyVersion = 1) {
  localStorage.setItem(ACCESS_GATE_STORAGE_KEY, JSON.stringify({ granted: true, keyVersion, grantedAt: Date.now() }))
}

function normalizePath(path) {
  const value = String(path || '/').trim()
  if (!value.startsWith('/')) return `/${value}`
  return value
}

async function sha256Hex(input) {
  const bytes = new TextEncoder().encode(String(input || ''))
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function verifyAccessKey(input, config) {
  const typed = String(input || '').trim()
  if (!typed) return false
  // Plaintext keyValue is temporary beta gating only; prefer keyHash and move server-side later.
  if (config.keyHash) return (await sha256Hex(typed)) === config.keyHash
  return typed === config.keyValue
}

async function initAccessGate() {
  const isLocalhost = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  let config = null
  let loadFailed = false
  try {
    config = await getAccessGateConfig()
  } catch {
    loadFailed = true
    config = { isKeyRequired: !isLocalhost, keyVersion: 1, title: 'Private Beta', message: 'Unable to load access requirements. Retry to continue.', supportEmail: '', brandName: 'Melogic Records', keyValue: '', keyHash: '', allowedPublicPaths: [] }
  }
  const currentPath = normalizePath(window.location.pathname)
  if (Array.isArray(config.allowedPublicPaths) && config.allowedPublicPaths.map(normalizePath).includes(currentPath)) return
  if (!config.isKeyRequired) return
  const grant = readAccessGateGrant()
  if (grant?.granted && Number(grant.keyVersion) === Number(config.keyVersion || 1)) return

  await new Promise((resolve) => {
    const gate = document.createElement('div')
    gate.className = 'access-gate'
    gate.innerHTML = `<div class="access-gate-card"><p class="access-gate-brand">${escapeHtml(config.brandName || 'Melogic Records')}</p><h1 class="access-gate-title">${escapeHtml(config.title || 'Private Beta')}</h1><p class="access-gate-message">${escapeHtml(config.message || 'Enter your access key to continue.')}</p><form data-access-gate-form><input class="access-gate-input" data-access-gate-input type="password" autocomplete="off" placeholder="Access key" required /><button class="access-gate-button" data-access-gate-submit type="submit">${loadFailed ? 'Retry' : 'Continue'}</button><p class="access-gate-error" data-access-gate-error>${loadFailed ? 'Access settings failed to load.' : ''}</p>${config.supportEmail ? `<p class="access-gate-support">Need help? <a href="mailto:${escapeHtml(config.supportEmail)}">${escapeHtml(config.supportEmail)}</a></p>` : ''}</form></div>`
    document.body.append(gate)
    const form = gate.querySelector('[data-access-gate-form]')
    const input = gate.querySelector('[data-access-gate-input]')
    const submit = gate.querySelector('[data-access-gate-submit]')
    const error = gate.querySelector('[data-access-gate-error]')
    input?.focus()
    form?.addEventListener('submit', async (event) => {
      event.preventDefault()
      if (loadFailed) { window.location.reload(); return }
      submit.disabled = true
      submit.textContent = 'Checking…'
      error.textContent = ''
      const ok = await verifyAccessKey(input.value, config)
      if (ok) {
        writeAccessGateGrant(Number(config.keyVersion || 1))
        gate.remove()
        resolve()
        return
      }
      submit.disabled = false
      submit.textContent = 'Continue'
      error.textContent = 'Invalid access key.'
      input.focus()
      input.select()
    })
  })
}

export async function initShellChrome() {
  await initAccessGate()
  await initBannerAlerts()
  syncNavOffset()
  window.addEventListener('resize', syncNavOffset, { passive: true })
  initNavAuthState()
  startPresenceTracking()
  initCartDrawer()
  return initNavBrandLogo()
}

function hexToRgb(hex) {
  const raw = String(hex || '').replace('#', '').trim()
  const safe = raw.length === 3 ? raw.split('').map((x) => x + x).join('') : raw
  const value = Number.parseInt(safe, 16)
  if (!Number.isFinite(value) || safe.length !== 6) return { r: 32, g: 216, b: 255 }
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

function readBannerDismissState() {
  try { return JSON.parse(localStorage.getItem(BANNER_ALERT_STORAGE_KEY) || 'null') } catch { localStorage.removeItem(BANNER_ALERT_STORAGE_KEY); return null }
}

function writeBannerDismissState(version) {
  localStorage.setItem(BANNER_ALERT_STORAGE_KEY, JSON.stringify({ dismissed: true, bannerVersion: Number(version || 1), dismissedAt: Date.now() }))
}

function resolveBannerIcon(iconType) {
  const icons = {
    1: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 10v6"/><path d="M12 7h.01"/></svg>',
    2: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 8a6 6 0 1 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>',
    3: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3 2 21h20L12 3z"/><path d="M12 9v5"/><path d="M12 17h.01"/></svg>',
    4: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="m8 12 2.5 2.5L16 9"/></svg>',
    5: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14.7 6.3a4 4 0 1 0 3 3l3.3 3.3-2 2-3.3-3.3a4 4 0 0 0-3-3z"/><path d="m2 22 8-8"/></svg>'
  }
  return icons[iconType] || icons[1]
}

function matchesPathRule(rule, currentPath) {
  const normalized = normalizePath(rule)
  if (normalized.endsWith('/**')) return currentPath.startsWith(normalized.slice(0, -3))
  return normalized === currentPath
}

async function initBannerAlerts() {
  try {
    const config = await getBannerAlertConfig()
    if (!config.bannerActive) return
    const currentPath = normalizePath(window.location.pathname)
    if (config.bannerBlockedPaths.some((x) => matchesPathRule(x, currentPath))) return
    if (config.bannerAllowedPaths.length && !config.bannerAllowedPaths.some((x) => matchesPathRule(x, currentPath))) return
    const now = Date.now()
    const startsAt = config.bannerStartsAt?.toMillis?.() || Date.parse(config.bannerStartsAt || '')
    const expiresAt = config.bannerExpiresAt?.toMillis?.() || Date.parse(config.bannerExpiresAt || '')
    if (Number.isFinite(startsAt) && now < startsAt) return
    if (Number.isFinite(expiresAt) && now > expiresAt) return
    const user = await waitForInitialAuthState().catch(() => null)
    if (config.bannerAudience === 'signedIn' && !user) return
    if (config.bannerAudience === 'signedOut' && user) return
    const dismissed = readBannerDismissState()
    if (dismissed?.dismissed && Number(dismissed.bannerVersion) === Number(config.bannerVersion)) return

    const { r, g, b } = hexToRgb(config.bannerColor)
    const el = document.createElement('section')
    el.className = `banner-alert ${config.bannerType === 2 ? 'banner-alert--fullscreen' : 'banner-alert--bottom'}`
    el.style.setProperty('--banner-color', config.bannerColor)
    el.style.setProperty('--banner-color-soft', `rgba(${r}, ${g}, ${b}, 0.18)`)
    el.style.setProperty('--banner-color-glow', `rgba(${r}, ${g}, ${b}, 0.42)`)
    const title = config.bannerContent[0]
    const message = config.bannerContent[1]
    el.innerHTML = `${config.bannerType === 2 ? '<div class="banner-alert-backdrop"></div>' : ''}<div class="${config.bannerType === 2 ? 'banner-alert-modal' : 'banner-alert-card'}"><div class="banner-alert-icon">${resolveBannerIcon(config.bannerIcon)}</div><div class="banner-alert-content">${title ? `<strong class="banner-alert-title">${escapeHtml(title)}</strong>` : ''}<p class="banner-alert-message">${escapeHtml(message)}</p>${config.bannerButtonText && config.bannerButtonUrl ? `<a class="banner-alert-action" href="${escapeHtml(config.bannerButtonUrl)}">${escapeHtml(config.bannerButtonText)}</a>` : ''}</div>${config.bannerDismissible ? '<button class="banner-alert-close" type="button" aria-label="Dismiss banner">×</button>' : ''}</div>`
    document.body.append(el)
    el.querySelector('.banner-alert-close')?.addEventListener('click', () => {
      writeBannerDismissState(config.bannerVersion)
      el.remove()
    })
  } catch {
    // Fail open for announcement system.
  }
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
  if (typeof navAuthCleanup === 'function') {
    navAuthCleanup()
    navAuthCleanup = null
  }
  const profileMenu = document.querySelector('[data-profile-menu]')
  const profileTrigger = document.querySelector('[data-nav-profile-trigger]')
  const profileDropdown = document.querySelector('[data-nav-profile-dropdown]')
  const profileAvatar = document.querySelector('[data-profile-avatar]')
  const viewProfileLink = document.querySelector('[data-nav-menu-view]')
  const editProfileLink = document.querySelector('[data-nav-menu-edit]')
  const libraryLink = document.querySelector('[data-nav-menu-library]')
  const ordersLink = document.querySelector('[data-nav-menu-orders]')
  const securityLink = document.querySelector('[data-nav-menu-security]')
  const adminLink = document.querySelector('[data-nav-menu-admin]')
  const signOutButton = document.querySelector('[data-nav-menu-signout]')
  const authEntryLink = document.querySelector('[data-nav-menu-auth]')
  const inboxLink = document.querySelector('[data-nav-inbox]')
  if (!profileMenu || !profileTrigger || !profileDropdown || !profileAvatar || !authEntryLink || !signOutButton) return
  let currentUser = null
  const controller = new AbortController()
  const { signal } = controller

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
    if (libraryLink) libraryLink.hidden = true
    if (ordersLink) ordersLink.hidden = true
    if (securityLink) securityLink.hidden = true
    if (adminLink) adminLink.hidden = true
  }

  const setSignedInView = (user) => {
    signOutButton.textContent = 'Log Out'
    authEntryLink.hidden = true
    signOutButton.hidden = false
    if (viewProfileLink) viewProfileLink.hidden = false
    if (editProfileLink) editProfileLink.hidden = false
    if (libraryLink) libraryLink.hidden = false
    if (ordersLink) ordersLink.hidden = false
    if (securityLink) securityLink.hidden = false
    if (adminLink) {
      adminLink.hidden = true
      user.getIdTokenResult?.().then((tokenResult) => {
        if (currentUser?.uid === user.uid) adminLink.hidden = tokenResult?.claims?.admin !== true
      }).catch(() => {
        if (currentUser?.uid === user.uid) adminLink.hidden = true
      })
    }

    if (user?.photoURL) {
      profileAvatar.classList.add('has-photo')
      profileAvatar.style.backgroundImage = `url(\"${user.photoURL}\")`
      applyCachedPreviewImage(profileAvatar, {
        cacheKey: `nav-avatar:${user.uid}`,
        sourceUrl: user.photoURL,
        versionKey: user.photoURL,
        maxSize: 64,
        asBackground: true
      }).catch(() => {})
      profileAvatar.setAttribute('aria-label', `${user.displayName || 'User'} profile image`)
    } else {
      profileAvatar.classList.remove('has-photo')
      profileAvatar.style.backgroundImage = ''
      profileAvatar.setAttribute('aria-label', 'Default account icon')
    }
  }

  profileTrigger.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const isOpen = profileTrigger.getAttribute('aria-expanded') === 'true'
    setMenuOpen(!isOpen)
  }, { signal })

  profileTrigger.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    setMenuOpen(true)
  }, { signal })

  profileDropdown.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setMenuOpen(false)
      profileTrigger.focus()
    }
  }, { signal })

  profileDropdown.addEventListener('click', (event) => {
    event.stopPropagation()
  }, { signal })

  document.addEventListener('pointerdown', (event) => {
    if (!profileMenu.contains(event.target)) {
      setMenuOpen(false)
    }
  }, { capture: true, signal })

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') setMenuOpen(false)
  }, { signal })

  authEntryLink.addEventListener('click', () => {
    setMenuOpen(false)
  }, { signal })

  if (viewProfileLink) {
    viewProfileLink.addEventListener('click', () => setMenuOpen(false), { signal })
  }
  if (editProfileLink) {
    editProfileLink.addEventListener('click', () => setMenuOpen(false), { signal })
  }
  if (adminLink) {
    adminLink.addEventListener('click', () => setMenuOpen(false), { signal })
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
  }, { signal })

  setMenuOpen(false)

  waitForInitialAuthState().then((user) => {
    currentUser = user || null
    if (user) {
      setSignedInView(user)
    } else {
      setSignedOutView()
    }
  })

  const unsubscribeAuth = subscribeToAuthState((user) => {
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
  }, { signal })

  navAuthCleanup = () => {
    controller.abort()
    if (typeof unsubscribeAuth === 'function') unsubscribeAuth()
  }
}
