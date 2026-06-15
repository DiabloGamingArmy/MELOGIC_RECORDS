import { signOutUser, subscribeToAuthState, waitForInitialAuthState } from '../firebase/auth'
import { getCartItems, removeFromCart, subscribeToCart } from '../data/cartService'
import { subscribeToInboxUnreadCount } from '../data/shellBadgeService'
import { getAccessGateConfig, getBannerAlertConfig, getEffectiveProfile } from '../firebase/firestore'
import { startPresenceTracking } from '../services/presenceService'
import { applyCachedPreviewImage } from '../services/imagePreviewCache'
import { ROUTES, authRoute } from '../utils/routes'
import brandLogoUrl from '../assets/brand/melogic-logo-mark-white-transparent.png'
import { initChatDock } from './chatDock'
import '../styles/chatDock.css'

const ACCESS_GATE_STORAGE_KEY = 'melogic_access_gate'
const BANNER_ALERT_STORAGE_KEY = 'melogic_banner_alert'
let navAuthCleanup = null
let cartDrawerCleanup = null
let shellBootPromise = null
let shellAuthUnsubscribe = null
let shellInboxUnsubscribe = null
let shellCurrentUser = null
let shellCoreStarted = false
let shellResizeBound = false
let shellGlobalInitPromise = null
let shellAuthGeneration = 0
let shellInboxRetryTimer = null
const shellStateListeners = new Set()
const APP_BOOT_DEBUG = false
const shellState = {
  booted: false,
  authReady: false,
  user: null,
  profile: null,
  isAdmin: false,
  cartCount: 0,
  inboxUnreadCount: 0,
  logoReady: true,
  errors: []
}

function debugBoot(phase, extra = {}) {
  if (!APP_BOOT_DEBUG) return
  console.info('[app-boot]', {
    page: window.location.pathname,
    phase,
    userUid: shellState.user?.uid || null,
    profileLoaded: Boolean(shellState.profile),
    avatarUrl: shellState.profile?.photoURL || '',
    logoPath: brandLogoUrl,
    ...extra
  })
}

function notifyShellState() {
  const snapshot = getCurrentShellState()
  shellStateListeners.forEach((callback) => {
    try {
      callback(snapshot)
    } catch {
      // Shell observers must not interrupt global boot.
    }
  })
}

function recordShellError(scope, error) {
  const code = String(error?.code || 'unknown-error')
  const message = String(error?.message || error || 'Unknown shell error')
  shellState.errors = [
    ...shellState.errors.filter((item) => item.scope !== scope),
    { scope, code, message }
  ]
  if (
    code.includes('permission-denied')
    || code.includes('resource-exhausted')
    || code.includes('quota')
    || code.includes('unavailable')
    || code.includes('object-not-found')
  ) {
    console.warn(`[app-boot] ${scope} failed`, { code, message })
  }
  debugBoot('error', { scope, errorCode: code, errorMessage: message })
}

function clearShellError(scope) {
  shellState.errors = shellState.errors.filter((item) => item.scope !== scope)
}

export function getCurrentShellState() {
  return {
    ...shellState,
    errors: shellState.errors.map((item) => ({ ...item }))
  }
}

export function onShellStateChange(callback) {
  if (typeof callback !== 'function') return () => {}
  shellStateListeners.add(callback)
  callback(getCurrentShellState())
  return () => shellStateListeners.delete(callback)
}

function getInitials(profile = {}, user = null) {
  const name = String(profile.displayName || profile.username || user?.displayName || user?.email || '').trim()
  if (!name) return '?'
  const parts = name.split(/\s+/).filter(Boolean)
  if (parts.length > 1) return `${parts[0][0]}${parts.at(-1)[0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

function normalizeShellProfile(user, result = null) {
  const profile = result?.effectiveProfile || {}
  const photoURL = String(
    profile.avatarURL
    || profile.photoURL
    || user?.photoURL
    || ''
  ).trim()
  const displayName = String(profile.displayName || user?.displayName || '').trim()
  const username = String(profile.username || '').trim()
  const normalized = {
    uid: user?.uid || '',
    displayName,
    username,
    photoURL,
    avatarURL: photoURL,
    email: String(profile.email || user?.email || '').trim(),
    role: String(profile.roleLabel || profile.role || '').trim(),
    labels: Array.isArray(profile.labels || profile.badges)
      ? (profile.labels || profile.badges).map((label) => String(label || '').trim()).filter(Boolean)
      : []
  }
  return {
    ...normalized,
    fallbackInitials: getInitials(normalized, user)
  }
}

function clearInboxSubscription() {
  if (typeof shellInboxUnsubscribe === 'function') shellInboxUnsubscribe()
  shellInboxUnsubscribe = null
  if (shellInboxRetryTimer) window.clearTimeout(shellInboxRetryTimer)
  shellInboxRetryTimer = null
}

function renderInboxBadges() {
  const count = Math.max(0, Number(shellState.inboxUnreadCount || 0))
  document.querySelectorAll('[data-nav-inbox-badge]').forEach((badge) => {
    badge.textContent = count > 99 ? '99+' : count > 0 ? String(count) : ''
    badge.dataset.hasUnread = String(count > 0)
    badge.setAttribute('aria-label', count ? `${count} unread inbox item${count === 1 ? '' : 's'}` : 'No unread inbox items')
  })
}

function renderProfileAvatar(profileAvatar, profileTrigger) {
  if (!profileAvatar) return
  const user = shellState.user
  const profile = shellState.profile || {}
  const photoURL = String(profile.photoURL || user?.photoURL || '').trim()
  const initials = profile.fallbackInitials || getInitials(profile, user)
  const avatarKey = `${user?.uid || 'guest'}:${photoURL}`
  const expectedState = photoURL ? 'photo' : user ? 'initials' : 'guest'
  if (
    profileAvatar.dataset.avatarKey === avatarKey
    && (
      profileAvatar.dataset.avatarState === expectedState
      || (expectedState === 'photo' && profileAvatar.dataset.avatarState === 'loading')
    )
  ) return

  profileAvatar.dataset.avatarKey = avatarKey
  profileAvatar.dataset.avatarState = photoURL ? 'loading' : expectedState
  profileAvatar.classList.remove('has-photo')
  profileAvatar.classList.toggle('has-initials', Boolean(user))
  profileAvatar.style.backgroundImage = ''
  profileAvatar.textContent = user ? initials : ''
  profileAvatar.setAttribute('aria-hidden', 'true')
  profileTrigger?.setAttribute('aria-label', user ? `${profile.displayName || profile.username || 'Account'} menu` : 'Account menu')
  if (!user || !photoURL) return

  const image = new Image()
  image.decoding = 'async'
  image.onload = () => {
    if (!profileAvatar.isConnected || profileAvatar.dataset.avatarKey !== avatarKey) return
    profileAvatar.textContent = ''
    profileAvatar.classList.remove('has-initials')
    profileAvatar.classList.add('has-photo')
    profileAvatar.dataset.avatarState = 'photo'
    profileAvatar.style.backgroundImage = `url("${photoURL}")`
    applyCachedPreviewImage(profileAvatar, {
      cacheKey: `nav-avatar:${user.uid}`,
      sourceUrl: photoURL,
      versionKey: photoURL,
      maxSize: 64,
      asBackground: true
    }).catch(() => {})
  }
  image.onerror = () => {
    if (!profileAvatar.isConnected || profileAvatar.dataset.avatarKey !== avatarKey) return
    profileAvatar.classList.remove('has-photo')
    profileAvatar.classList.add('has-initials')
    profileAvatar.dataset.avatarState = 'initials'
    profileAvatar.style.backgroundImage = ''
    profileAvatar.textContent = initials
  }
  image.src = photoURL
}

function renderShellState() {
  updateCartBadges(shellState.cartCount)
  renderInboxBadges()

  const profileAvatar = document.querySelector('[data-profile-avatar]')
  const profileTrigger = document.querySelector('[data-nav-profile-trigger]')
  const authEntryLink = document.querySelector('[data-nav-menu-auth]')
  const signOutButton = document.querySelector('[data-nav-menu-signout]')
  const privateLinks = [
    document.querySelector('[data-nav-menu-view]'),
    document.querySelector('[data-nav-menu-edit]'),
    document.querySelector('[data-nav-menu-library]'),
    document.querySelector('[data-nav-menu-orders]'),
    document.querySelector('[data-nav-menu-security]')
  ].filter(Boolean)
  const adminLink = document.querySelector('[data-nav-menu-admin]')
  if (!profileAvatar || !authEntryLink || !signOutButton) return

  const signedIn = shellState.authReady && Boolean(shellState.user)
  authEntryLink.hidden = signedIn
  authEntryLink.textContent = shellState.authReady ? 'Sign In / Sign Up' : 'Checking account...'
  signOutButton.hidden = !signedIn
  signOutButton.textContent = 'Log Out'
  privateLinks.forEach((link) => { link.hidden = !signedIn })
  if (adminLink) adminLink.hidden = !signedIn || !shellState.isAdmin
  renderProfileAvatar(profileAvatar, profileTrigger)
}

async function loadShellProfile(user, generation, retryAttempt = 0) {
  try {
    const result = await getEffectiveProfile(user.uid, user)
    if (result?.readError) throw result.readError
    if (generation !== shellAuthGeneration || shellCurrentUser?.uid !== user.uid) return
    shellState.profile = normalizeShellProfile(user, result)
    clearShellError('profile')
    debugBoot('profile-loaded')
  } catch (error) {
    if (generation !== shellAuthGeneration || shellCurrentUser?.uid !== user.uid) return
    shellState.profile = normalizeShellProfile(user)
    recordShellError('profile', error)
    const retryDelay = [500, 1500][retryAttempt]
    if (retryDelay) {
      await new Promise((resolve) => window.setTimeout(resolve, retryDelay))
      if (generation === shellAuthGeneration && shellCurrentUser?.uid === user.uid) {
        return loadShellProfile(user, generation, retryAttempt + 1)
      }
    }
  }
  renderShellState()
  notifyShellState()
}

function startShellInboxSubscription(user, generation, retryAttempt = 0) {
  clearInboxSubscription()
  const handleError = (error) => {
    if (generation !== shellAuthGeneration || shellCurrentUser?.uid !== user.uid) return
    recordShellError('inbox', error)
    shellState.inboxUnreadCount = 0
    renderInboxBadges()
    notifyShellState()
    if (shellInboxRetryTimer) return
    const retryDelay = [500, 1500][retryAttempt]
    if (!retryDelay) return
    shellInboxRetryTimer = window.setTimeout(() => {
      shellInboxRetryTimer = null
      startShellInboxSubscription(user, generation, retryAttempt + 1)
    }, retryDelay)
  }

  try {
    shellInboxUnsubscribe = subscribeToInboxUnreadCount(user.uid, (unreadCount) => {
      if (generation !== shellAuthGeneration || shellCurrentUser?.uid !== user.uid) return
      shellState.inboxUnreadCount = Math.max(0, Number(unreadCount || 0))
      clearShellError('inbox')
      debugBoot('inbox-loaded', { inboxUnreadCount: shellState.inboxUnreadCount })
      renderInboxBadges()
      notifyShellState()
    }, handleError)
  } catch (error) {
    handleError(error)
  }
}

function handleShellAuthState(user) {
  const nextUser = user || null
  if (shellState.authReady && shellCurrentUser?.uid === nextUser?.uid) {
    shellState.user = nextUser
    renderShellState()
    return
  }

  const generation = ++shellAuthGeneration
  shellCurrentUser = nextUser
  shellState.authReady = true
  shellState.booted = true
  shellState.user = nextUser
  shellState.profile = nextUser ? normalizeShellProfile(nextUser) : null
  shellState.isAdmin = false
  shellState.inboxUnreadCount = 0
  clearInboxSubscription()
  clearShellError('auth')
  renderShellState()
  notifyShellState()
  debugBoot('auth-ready')

  if (!nextUser) return
  loadShellProfile(nextUser, generation)
  startShellInboxSubscription(nextUser, generation)
  nextUser.getIdTokenResult?.().then((tokenResult) => {
    if (generation !== shellAuthGeneration || shellCurrentUser?.uid !== nextUser.uid) return
    shellState.isAdmin = tokenResult?.claims?.admin === true
    renderShellState()
    notifyShellState()
  }).catch((error) => {
    if (generation === shellAuthGeneration) recordShellError('admin-claim', error)
  })
}

function ensureShellCore() {
  if (shellCoreStarted) return shellBootPromise
  shellCoreStarted = true
  startPresenceTracking()
  shellAuthUnsubscribe = subscribeToAuthState(handleShellAuthState)
  shellBootPromise = waitForInitialAuthState()
    .then((user) => {
      handleShellAuthState(user)
      return getCurrentShellState()
    })
    .catch((error) => {
      shellState.authReady = true
      shellState.booted = true
      recordShellError('auth', error)
      renderShellState()
      notifyShellState()
      return getCurrentShellState()
    })
  return shellBootPromise
}

export async function refreshShellState() {
  ensureShellCore()
  const user = shellCurrentUser
  if (!user) {
    renderShellState()
    return getCurrentShellState()
  }
  const generation = shellAuthGeneration
  await loadShellProfile(user, generation)
  if (generation === shellAuthGeneration) startShellInboxSubscription(user, generation)
  return getCurrentShellState()
}

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
  if (!brandLogo.getAttribute('src')) brandLogo.src = brandLogoUrl
  brandLogo.dataset.loaded = 'true'
  shellState.logoReady = true
  debugBoot('header-rendered')
  return true
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
  const currentPath = normalizePath(window.location.pathname)
  if (currentPath === '/admin' || currentPath.startsWith('/admin/')) return
  let config = null
  let loadFailed = false
  try {
    config = await getAccessGateConfig()
  } catch {
    loadFailed = true
    config = { isKeyRequired: !isLocalhost, keyVersion: 1, title: 'Private Beta', message: 'Unable to load access requirements. Retry to continue.', supportEmail: '', brandName: 'Melogic Records', keyValue: '', keyHash: '', allowedPublicPaths: [] }
  }
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
  initNavBrandLogo()
  syncNavOffset()
  if (!shellResizeBound) {
    shellResizeBound = true
    window.addEventListener('resize', syncNavOffset, { passive: true })
  }
  if (!shellGlobalInitPromise) {
    shellGlobalInitPromise = Promise.allSettled([
      initAccessGate(),
      initBannerAlerts()
    ])
  }
  ensureShellCore()
  initNavAuthState()
  initCartDrawer()
  initChatDock({
    getShellState: getCurrentShellState,
    onShellStateChange
  })
  renderShellState()
  return shellBootPromise
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
  if (typeof cartDrawerCleanup === 'function') cartDrawerCleanup()
  document.querySelector('.cart-drawer-root')?.remove()
  const controller = new AbortController()
  const { signal } = controller

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
    }, { signal })
  })
  root.querySelectorAll('[data-cart-drawer-close]').forEach((button) => button.addEventListener('click', closeDrawer, { signal }))
  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeDrawer()
  }, { signal })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !backdrop?.hidden) closeDrawer()
  }, { signal })

  const unsubscribeCart = subscribeToCart((items) => {
    shellState.cartCount = items.length
    clearShellError('cart')
    debugBoot('cart-loaded', { cartCount: items.length })
    updateCartBadges(items.length)
    renderCartDrawerItems(root, items)
    notifyShellState()
  })
  updateCartBadges(getCartItems().length)
  cartDrawerCleanup = () => {
    controller.abort()
    unsubscribeCart()
    root.remove()
    cartDrawerCleanup = null
  }
}

function initNavAuthState() {
  if (typeof navAuthCleanup === 'function') {
    navAuthCleanup()
    navAuthCleanup = null
  }
  const profileMenu = document.querySelector('[data-profile-menu]')
  const profileTrigger = document.querySelector('[data-nav-profile-trigger]')
  const profileDropdown = document.querySelector('[data-nav-profile-dropdown]')
  const signOutButton = document.querySelector('[data-nav-menu-signout]')
  const authEntryLink = document.querySelector('[data-nav-menu-auth]')
  const inboxLink = document.querySelector('[data-nav-inbox]')
  if (!profileMenu || !profileTrigger || !profileDropdown || !authEntryLink || !signOutButton) return
  const controller = new AbortController()
  const { signal } = controller

  const setMenuOpen = (open) => {
    profileTrigger.setAttribute('aria-expanded', String(open))
    profileDropdown.hidden = !open
    profileMenu.classList.toggle('is-open', open)
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

  profileDropdown.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenuOpen(false), { signal })
  })

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
  renderShellState()

  inboxLink?.addEventListener('click', async (event) => {
    if (shellCurrentUser) return
    const resolvedUser = await waitForInitialAuthState()
    if (resolvedUser) return
    event.preventDefault()
    window.location.assign(authRoute({ redirect: ROUTES.inbox }))
  }, { signal })

  navAuthCleanup = () => {
    controller.abort()
  }
}
