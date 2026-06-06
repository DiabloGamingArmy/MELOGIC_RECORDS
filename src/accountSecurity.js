import './styles/base.css'
import './styles/accountSecurity.css'
import { getIdTokenResult, multiFactor } from 'firebase/auth'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { auth, sendEmailVerificationRequest, sendPasswordReset, waitForInitialAuthState } from './firebase/auth'
import { markAccountEventRead, markAllAccountEventsRead, recordAccountSecurityEvent, subscribeToAccountEvents } from './services/accountEvents'
import { ROUTES, authRoute } from './utils/routes'

const app = document.querySelector('#app')

app.innerHTML = `
  ${navShell({ currentPage: 'profile' })}
  <main class="account-security-main">
    <section class="standard-hero section">
      <div class="section-inner hero-inner hero-content-layer">
        <div class="hero-copy">
          <p class="eyebrow">Account Security</p>
          <h1>Security</h1>
          <p>Review recovery, sign-in methods, and account activity tied to your Melogic account.</p>
        </div>
      </div>
    </section>
    <section class="section account-security-shell">
      <div class="section-inner" data-security-root>
        <article class="security-panel">
          <p>Loading account security...</p>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()

const root = document.querySelector('[data-security-root]')
let state = {
  user: null,
  events: [],
  eventsError: '',
  resetStatus: '',
  resetStatusType: 'info',
  sendingReset: false,
  verificationStatus: '',
  verificationStatusType: 'info',
  sendingVerification: false,
  claims: {},
  unsubscribeEvents: () => {}
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char])
}

function formatDate(value) {
  if (!value) return 'Not recorded'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return 'Not recorded'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(parsed)
}

function providerLabel(providerId = '') {
  const known = {
    password: 'Email and password',
    'google.com': 'Google',
    'apple.com': 'Apple'
  }
  return known[providerId] || providerId || 'Email and password'
}

function getMfaFactors(user) {
  try {
    return multiFactor(user).enrolledFactors || []
  } catch {
    return []
  }
}

function renderEventList() {
  if (state.eventsError) {
    return `<article class="security-empty"><strong>Activity unavailable.</strong><span>${escapeHtml(state.eventsError)}</span></article>`
  }
  if (!state.events.length) {
    return '<article class="security-empty">No account events have been recorded yet.</article>'
  }
  return `
    <div class="security-event-list">
      ${state.events.map((event) => `
        <article class="security-event ${event.readAt ? '' : 'is-unread'}" data-account-event-id="${escapeHtml(event.id)}">
          <div>
            <strong>${escapeHtml(event.title)}</strong>
            <p>${escapeHtml(event.message)}</p>
            <small>${escapeHtml(formatDate(event.createdAt))} · ${escapeHtml(event.severity)}</small>
          </div>
          ${event.path ? `<a class="button button-muted" href="${escapeHtml(event.path)}">Open</a>` : ''}
        </article>
      `).join('')}
    </div>
  `
}

function renderSignedOut() {
  root.innerHTML = `
    <article class="security-panel security-empty">
      <h2>Sign in required</h2>
      <p>Sign in to manage account recovery and security activity.</p>
      <a class="button button-accent" href="${authRoute({ redirect: ROUTES.accountSecurity })}">Sign In</a>
    </article>
  `
}

function render() {
  const user = state.user
  if (!user) {
    renderSignedOut()
    return
  }

  const providers = user.providerData?.length ? user.providerData : [{ providerId: 'password' }]
  const factors = getMfaFactors(user)
  const isAdminAccount = state.claims.admin === true
  const unreadCount = state.events.filter((event) => !event.readAt).length
  const resetMessage = state.resetStatus
    ? `<p class="security-status" data-state="${escapeHtml(state.resetStatusType)}">${escapeHtml(state.resetStatus)}</p>`
    : ''
  const verificationMessage = state.verificationStatus
    ? `<p class="security-status" data-state="${escapeHtml(state.verificationStatusType)}">${escapeHtml(state.verificationStatus)}</p>`
    : ''

  root.innerHTML = `
    <div class="security-layout">
      <article class="security-panel security-overview">
        <div class="security-heading">
          <div>
            <p class="eyebrow">Overview</p>
            <h2>${escapeHtml(user.email || user.displayName || 'Your account')}</h2>
          </div>
          <span class="security-pill ${user.emailVerified ? 'is-good' : 'is-warning'}">${user.emailVerified ? 'Email verified' : 'Email unverified'}</span>
        </div>
        <dl class="security-meta">
          <div><dt>User ID</dt><dd title="${escapeHtml(user.uid)}">${escapeHtml(user.uid)}</dd></div>
          <div><dt>Created</dt><dd>${escapeHtml(formatDate(user.metadata?.creationTime))}</dd></div>
          <div><dt>Last sign-in</dt><dd>${escapeHtml(formatDate(user.metadata?.lastSignInTime))}</dd></div>
          <div><dt>2FA</dt><dd>${factors.length ? `${factors.length} factor enrolled` : 'Not enrolled'}</dd></div>
        </dl>
        ${isAdminAccount && !factors.length ? '<p class="security-status" data-state="error">Admin accounts should enroll 2FA when authenticator-app support is enabled.</p>' : ''}
      </article>

      <article class="security-panel">
        <div class="security-heading">
          <div>
            <p class="eyebrow">Email</p>
            <h2>Email verification</h2>
          </div>
        </div>
        <p class="security-copy">Verification links are sent from Melogic Records Support to your current account email.</p>
        ${verificationMessage}
        <button type="button" class="button button-accent" data-send-verification-email ${state.sendingVerification || !user.email || user.emailVerified ? 'disabled' : ''}>
          ${user.emailVerified ? 'Email Verified' : state.sendingVerification ? 'Sending...' : 'Send Verification Email'}
        </button>
      </article>

      <article class="security-panel">
        <div class="security-heading">
          <div>
            <p class="eyebrow">Password</p>
            <h2>Password reset</h2>
          </div>
        </div>
        <p class="security-copy">A reset link will be sent through Firebase Authentication to your account email.</p>
        ${resetMessage}
        <button type="button" class="button button-accent" data-send-security-reset ${state.sendingReset || !user.email ? 'disabled' : ''}>
          ${state.sendingReset ? 'Sending...' : 'Send Password Reset Email'}
        </button>
      </article>

      <article class="security-panel">
        <div class="security-heading">
          <div>
            <p class="eyebrow">2FA</p>
            <h2>Authenticator app</h2>
          </div>
          <span class="security-pill is-warning">Foundation</span>
        </div>
        <p class="security-copy">Authenticator-app enrollment is being prepared for this Firebase project.</p>
        <button type="button" class="button button-muted" disabled>Enable Authenticator App</button>
      </article>

      <article class="security-panel">
        <div class="security-heading">
          <div>
            <p class="eyebrow">Recovery</p>
            <h2>Recovery codes</h2>
          </div>
          <span class="security-pill">Planned</span>
        </div>
        <p class="security-copy">Recovery codes will be available after authenticator-app 2FA enrollment is enabled.</p>
        <button type="button" class="button button-muted" disabled>Generate Recovery Codes</button>
      </article>

      <article class="security-panel">
        <div class="security-heading">
          <div>
            <p class="eyebrow">Sign-in Methods</p>
            <h2>Connected providers</h2>
          </div>
        </div>
        <div class="provider-list">
          ${providers.map((provider) => `<span>${escapeHtml(providerLabel(provider.providerId))}</span>`).join('')}
        </div>
      </article>

      <article class="security-panel security-activity">
        <div class="security-heading">
          <div>
            <p class="eyebrow">Activity</p>
            <h2>Recent account events</h2>
          </div>
          <div class="security-actions">
            <a class="button button-muted" href="${ROUTES.inbox}?system=account">Inbox</a>
            <button type="button" class="button button-muted" data-mark-all-account-events ${unreadCount ? '' : 'disabled'}>Mark All Read</button>
          </div>
        </div>
        ${renderEventList()}
      </article>
    </div>
  `
  bindActions()
}

function bindActions() {
  root.querySelector('[data-send-security-reset]')?.addEventListener('click', handlePasswordReset)
  root.querySelector('[data-send-verification-email]')?.addEventListener('click', handleEmailVerification)
  root.querySelector('[data-mark-all-account-events]')?.addEventListener('click', async () => {
    await markAllAccountEventsRead(state.user.uid, state.events).catch((error) => {
      console.warn('[account-security] mark all read failed', error?.code || error?.message || error)
    })
  })
  root.querySelectorAll('[data-account-event-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      await markAccountEventRead(state.user.uid, card.dataset.accountEventId).catch(() => {})
    })
  })
}

async function handleEmailVerification() {
  if (!state.user?.email || state.user.emailVerified || state.sendingVerification) return
  state.sendingVerification = true
  state.verificationStatus = 'Sending verification email...'
  state.verificationStatusType = 'info'
  render()

  try {
    const result = await sendEmailVerificationRequest()
    state.verificationStatus = result?.message || 'Verification email sent.'
    state.verificationStatusType = 'success'
  } catch (error) {
    console.warn('[account-security] verification email failed', error?.code || error?.message || error)
    state.verificationStatus = 'Verification email could not be sent. Please try again.'
    state.verificationStatusType = 'error'
  } finally {
    state.sendingVerification = false
    render()
  }
}

async function handlePasswordReset() {
  if (!state.user?.email || state.sendingReset) return
  state.sendingReset = true
  state.resetStatus = 'Sending password reset email...'
  state.resetStatusType = 'info'
  render()

  try {
    await sendPasswordReset(state.user.email)
    await recordAccountSecurityEvent('password_reset_requested', { path: ROUTES.accountSecurity }).catch((error) => {
      console.warn('[account-security] account event record failed', error?.code || error?.message || error)
    })
    state.resetStatus = 'If an account exists for that email, a password reset link has been sent.'
    state.resetStatusType = 'success'
  } catch (error) {
    console.warn('[account-security] password reset failed', error?.code || error?.message || error)
    state.resetStatus = error?.code === 'auth/invalid-email'
      ? 'Please confirm your account email is valid.'
      : 'Password reset could not be requested. Please try again.'
    state.resetStatusType = 'error'
  } finally {
    state.sendingReset = false
    render()
  }
}

function startAccountEventsSubscription() {
  state.unsubscribeEvents()
  if (!state.user?.uid) return
  state.unsubscribeEvents = subscribeToAccountEvents(
    state.user.uid,
    (events) => {
      state.events = events
      state.eventsError = ''
      render()
    },
    (error) => {
      state.eventsError = error?.message || 'Account activity could not be loaded.'
      render()
    },
    { limitCount: 12 }
  )
}

waitForInitialAuthState().then(async (user) => {
  state.user = user || auth.currentUser || null
  if (!state.user) {
    window.location.assign(authRoute({ redirect: ROUTES.accountSecurity }))
    return
  }
  try {
    const token = await getIdTokenResult(state.user, true)
    state.claims = token.claims || {}
  } catch {
    state.claims = {}
  }
  render()
  startAccountEventsSubscription()
})
