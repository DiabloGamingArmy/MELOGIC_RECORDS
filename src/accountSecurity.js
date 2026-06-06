import './styles/base.css'
import './styles/accountSecurity.css'
import QRCode from 'qrcode'
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  TotpMultiFactorGenerator,
  getIdTokenResult,
  multiFactor,
  reauthenticateWithCredential,
  reauthenticateWithPopup
} from 'firebase/auth'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { auth, sendEmailVerificationRequest, sendPasswordReset, waitForInitialAuthState } from './firebase/auth'
import { markAccountEventRead, markAllAccountEventsRead, recordAccountSecurityEvent, subscribeToAccountEvents } from './services/accountEvents'
import { generateRecoveryCodes, getRecoveryCodeStatus } from './services/recoveryCodes'
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
  recovery: {
    loading: false,
    generating: false,
    generated: false,
    remaining: 0,
    generatedAt: '',
    status: '',
    statusType: 'info',
    modalCodes: []
  },
  totp: {
    stage: 'idle',
    qrDataUrl: '',
    manualKey: '',
    code: '',
    status: '',
    statusType: 'info',
    statusCode: '',
    showKey: false,
    enrolling: false,
    disabling: false,
    confirmDisable: false,
    firebaseUnavailable: false
  },
  reauth: {
    visible: false,
    title: '',
    message: '',
    password: '',
    error: '',
    busy: false
  },
  claims: {},
  unsubscribeEvents: () => {}
}

let pendingTotpSecret = null
let pendingReauthAction = null

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

function getTotpFactors(user = state.user) {
  return getMfaFactors(user).filter((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID)
}

function hasPasswordProvider(user = state.user) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === 'password'))
}

function hasGoogleProvider(user = state.user) {
  return Boolean(user?.providerData?.some((provider) => provider.providerId === 'google.com'))
}

function sanitizeOtp(value = '') {
  return String(value || '').replace(/\D/g, '').slice(0, 6)
}

function friendlyMfaError(error) {
  const code = String(error?.code || '')
  const message = String(error?.message || '')
  if (code === 'auth/requires-recent-login') return 'Please reauthenticate to continue.'
  if (code === 'auth/unverified-email') return 'Verify your email before enabling authenticator-app 2FA.'
  if (code === 'auth/invalid-verification-code' || code === 'auth/invalid-code') return 'That code was not accepted. Check the six digits and try again.'
  if (code === 'auth/code-expired') return 'That setup session expired. Start setup again.'
  if (code === 'auth/missing-verification-code') return 'Enter the six-digit code from your authenticator app.'
  if (code === 'auth/unsupported-first-factor' || code === 'auth/operation-not-allowed' || message.includes('TOTP')) {
    return 'Authenticator app 2FA is not configured for this Firebase project yet.'
  }
  if (code === 'auth/network-request-failed') return 'Network request failed. Check your connection and try again.'
  return 'We could not complete that security action. Please try again.'
}

function resetTotpSetup({ keepStatus = false } = {}) {
  pendingTotpSecret = null
  state.totp = {
    ...state.totp,
    stage: 'idle',
    qrDataUrl: '',
    manualKey: '',
    code: '',
    showKey: false,
    enrolling: false,
    confirmDisable: false,
    firebaseUnavailable: keepStatus ? state.totp.firebaseUnavailable : false,
    status: keepStatus ? state.totp.status : '',
    statusType: keepStatus ? state.totp.statusType : 'info',
    statusCode: keepStatus ? state.totp.statusCode : ''
  }
}

function setTotpStatus(status = '', statusType = 'info', statusCode = '') {
  state.totp.status = status
  state.totp.statusType = statusType
  state.totp.statusCode = statusCode
}

function providerReauthCopy() {
  if (hasPasswordProvider()) return 'Enter your password to confirm this security-sensitive change.'
  if (hasGoogleProvider()) return 'Confirm your identity with Google to continue.'
  return 'Sign in again from your provider to continue this security-sensitive change.'
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

function renderTotpPanel(factors = []) {
  const totpFactors = factors.filter((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID)
  const enabled = totpFactors.length > 0
  const statusMessage = state.totp.status
    ? `<p class="security-status" data-state="${escapeHtml(state.totp.statusType)}">${escapeHtml(state.totp.status)}</p>`
    : ''
  const verificationCta = state.totp.statusCode === 'auth/unverified-email' && state.user?.email && !state.user?.emailVerified
    ? `<button type="button" class="button button-accent" data-send-verification-email ${state.sendingVerification ? 'disabled' : ''}>${state.sendingVerification ? 'Sending...' : 'Send Verification Email'}</button>`
    : ''

  if (state.totp.stage === 'setup') {
    return `
      <article class="security-panel security-totp-panel">
        <div class="security-heading">
          <div>
            <p class="eyebrow">2FA</p>
            <h2>Set up authenticator app</h2>
          </div>
          <span class="security-pill is-warning">Setup</span>
        </div>
        <p class="security-copy">Scan the QR code with an authenticator app, then enter the six-digit code it shows.</p>
        ${statusMessage}
        ${verificationCta}
        ${state.totp.qrDataUrl ? `<img class="security-qr-code" src="${escapeHtml(state.totp.qrDataUrl)}" alt="Authenticator app setup QR code" />` : ''}
        <div class="security-key-row">
          <button type="button" class="button button-muted" data-toggle-totp-key>${state.totp.showKey ? 'Hide Setup Key' : 'Show Setup Key'}</button>
          ${state.totp.showKey ? `<code>${escapeHtml(state.totp.manualKey)}</code>` : ''}
        </div>
        <label class="security-code-field">
          <span>Authenticator code</span>
          <input type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" value="${escapeHtml(state.totp.code)}" placeholder="123456" data-totp-code />
        </label>
        <div class="security-actions">
          <button type="button" class="button button-accent" data-confirm-totp-setup ${state.totp.enrolling ? 'disabled' : ''}>${state.totp.enrolling ? 'Verifying...' : 'Verify and Enable 2FA'}</button>
          <button type="button" class="button button-muted" data-cancel-totp-setup ${state.totp.enrolling ? 'disabled' : ''}>Cancel</button>
        </div>
      </article>
    `
  }

  return `
    <article class="security-panel security-totp-panel">
      <div class="security-heading">
        <div>
          <p class="eyebrow">2FA</p>
          <h2>Authenticator app</h2>
        </div>
        <span class="security-pill ${enabled ? 'is-good' : 'is-warning'}">${enabled ? 'Enabled' : 'Off'}</span>
      </div>
      <p class="security-copy">${enabled
        ? `Authenticator-app 2FA is enabled with ${totpFactors.length} enrolled factor${totpFactors.length === 1 ? '' : 's'}.`
        : 'Add a six-digit authenticator-app challenge to email/password sign-in.'}</p>
      ${statusMessage}
      ${verificationCta}
      ${state.totp.firebaseUnavailable ? '<p class="security-status" data-state="error">Enable TOTP multi-factor authentication in Firebase Authentication settings before users can enroll.</p>' : ''}
      <div class="security-actions">
        ${enabled
          ? `<button type="button" class="button button-muted is-danger" data-open-disable-totp ${state.totp.disabling ? 'disabled' : ''}>${state.totp.disabling ? 'Disabling...' : 'Disable 2FA'}</button>`
          : `<button type="button" class="button button-accent" data-start-totp-setup>Set Up Authenticator App</button>`}
      </div>
    </article>
  `
}

function renderDisableTotpDialog(isAdminAccount = false) {
  if (!state.totp.confirmDisable) return ''
  return `
    <div class="security-modal-backdrop" role="presentation">
      <section class="security-modal" role="dialog" aria-modal="true" aria-labelledby="disable-totp-title">
        <h2 id="disable-totp-title">Disable two-factor authentication?</h2>
        <p>${isAdminAccount ? 'Admin accounts should keep 2FA enabled. ' : ''}Your next email/password sign-in will no longer require an authenticator code.</p>
        ${state.totp.status ? `<p class="security-status" data-state="${escapeHtml(state.totp.statusType)}">${escapeHtml(state.totp.status)}</p>` : ''}
        <div class="security-actions">
          <button type="button" class="button button-muted is-danger" data-confirm-disable-totp ${state.totp.disabling ? 'disabled' : ''}>${state.totp.disabling ? 'Disabling...' : 'Disable 2FA'}</button>
          <button type="button" class="button button-muted" data-cancel-disable-totp ${state.totp.disabling ? 'disabled' : ''}>Keep 2FA Enabled</button>
        </div>
      </section>
    </div>
  `
}

function renderRecoveryCodesPanel(factors = []) {
  const enabled = factors.some((factor) => factor.factorId === TotpMultiFactorGenerator.FACTOR_ID)
  const generated = state.recovery.generated === true
  const badge = !enabled ? '2FA required' : generated ? 'Generated' : 'Not generated'
  const badgeClass = generated ? 'is-good' : 'is-warning'
  const copy = !enabled
    ? 'Enable authenticator-app 2FA before generating recovery codes.'
    : generated
      ? `${state.recovery.remaining} recovery code${state.recovery.remaining === 1 ? '' : 's'} remaining. Regenerating invalidates old codes.`
      : 'Generate backup codes you can save for account recovery if your authenticator app is unavailable.'
  return `
    <article class="security-panel security-recovery-panel">
      <div class="security-heading">
        <div>
          <p class="eyebrow">Recovery</p>
          <h2>Recovery codes</h2>
        </div>
        <span class="security-pill ${badgeClass}">${escapeHtml(badge)}</span>
      </div>
      <p class="security-copy">${escapeHtml(copy)}</p>
      ${state.recovery.status ? `<p class="security-status" data-state="${escapeHtml(state.recovery.statusType)}">${escapeHtml(state.recovery.status)}</p>` : ''}
      <button type="button" class="button ${generated ? 'button-muted' : 'button-accent'}" data-generate-recovery-codes ${enabled && !state.recovery.generating ? '' : 'disabled'}>
        ${state.recovery.generating ? 'Generating...' : generated ? 'Regenerate Codes' : 'Generate Recovery Codes'}
      </button>
    </article>
  `
}

function renderRecoveryCodesDialog() {
  if (!state.recovery.modalCodes.length) return ''
  return `
    <div class="security-modal-backdrop" role="presentation">
      <section class="security-modal security-recovery-modal" role="dialog" aria-modal="true" aria-labelledby="recovery-codes-title">
        <h2 id="recovery-codes-title">Save these recovery codes now</h2>
        <p>You will not be able to view these codes again after closing this window.</p>
        <div class="security-recovery-code-list">
          ${state.recovery.modalCodes.map((code) => `<code>${escapeHtml(code)}</code>`).join('')}
        </div>
        <div class="security-actions">
          <button type="button" class="button button-muted" data-copy-recovery-codes>Copy Codes</button>
          <button type="button" class="button button-accent" data-close-recovery-codes>I Saved These Codes</button>
        </div>
      </section>
    </div>
  `
}

function renderReauthDialog() {
  if (!state.reauth.visible) return ''
  return `
    <div class="security-modal-backdrop" role="presentation">
      <section class="security-modal" role="dialog" aria-modal="true" aria-labelledby="reauth-title">
        <h2 id="reauth-title">${escapeHtml(state.reauth.title || 'Confirm your identity')}</h2>
        <p>${escapeHtml(state.reauth.message || providerReauthCopy())}</p>
        ${state.reauth.error ? `<p class="security-status" data-state="error">${escapeHtml(state.reauth.error)}</p>` : ''}
        ${hasPasswordProvider() ? `
          <label class="security-code-field">
            <span>Password</span>
            <input type="password" autocomplete="current-password" value="${escapeHtml(state.reauth.password)}" data-reauth-password />
          </label>
        ` : ''}
        <div class="security-actions">
          <button type="button" class="button button-accent" data-submit-reauth ${state.reauth.busy ? 'disabled' : ''}>${state.reauth.busy ? 'Confirming...' : hasGoogleProvider() && !hasPasswordProvider() ? 'Continue with Google' : 'Confirm'}</button>
          <button type="button" class="button button-muted" data-cancel-reauth ${state.reauth.busy ? 'disabled' : ''}>Cancel</button>
        </div>
      </section>
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
        <div><dt>2FA</dt><dd>${getTotpFactors(user).length ? 'Authenticator app enabled' : 'Not enrolled'}</dd></div>
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
        <p class="security-copy">A reset link will be sent from Melogic Records Support to your account email.</p>
        ${resetMessage}
        <button type="button" class="button button-accent" data-send-security-reset ${state.sendingReset || !user.email ? 'disabled' : ''}>
          ${state.sendingReset ? 'Sending...' : 'Send Password Reset Email'}
        </button>
      </article>

      ${renderTotpPanel(factors)}

      ${renderRecoveryCodesPanel(factors)}

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
    ${renderDisableTotpDialog(isAdminAccount)}
    ${renderRecoveryCodesDialog()}
    ${renderReauthDialog()}
  `
  bindActions()
}

function bindActions() {
  root.querySelector('[data-send-security-reset]')?.addEventListener('click', handlePasswordReset)
  root.querySelectorAll('[data-send-verification-email]').forEach((button) => {
    button.addEventListener('click', handleEmailVerification)
  })
  root.querySelector('[data-start-totp-setup]')?.addEventListener('click', startTotpSetup)
  root.querySelector('[data-confirm-totp-setup]')?.addEventListener('click', confirmTotpSetup)
  root.querySelector('[data-cancel-totp-setup]')?.addEventListener('click', () => {
    resetTotpSetup()
    render()
  })
  root.querySelector('[data-toggle-totp-key]')?.addEventListener('click', () => {
    state.totp.showKey = !state.totp.showKey
    render()
  })
  root.querySelector('[data-totp-code]')?.addEventListener('input', (event) => {
    state.totp.code = sanitizeOtp(event.currentTarget.value)
    event.currentTarget.value = state.totp.code
  })
  root.querySelector('[data-open-disable-totp]')?.addEventListener('click', () => {
    state.totp.confirmDisable = true
    setTotpStatus('', 'info')
    render()
  })
  root.querySelector('[data-cancel-disable-totp]')?.addEventListener('click', () => {
    state.totp.confirmDisable = false
    setTotpStatus('', 'info')
    render()
  })
  root.querySelector('[data-confirm-disable-totp]')?.addEventListener('click', disableTotp)
  root.querySelector('[data-generate-recovery-codes]')?.addEventListener('click', handleGenerateRecoveryCodes)
  root.querySelector('[data-copy-recovery-codes]')?.addEventListener('click', copyRecoveryCodes)
  root.querySelector('[data-close-recovery-codes]')?.addEventListener('click', () => {
    state.recovery.modalCodes = []
    render()
  })
  root.querySelector('[data-reauth-password]')?.addEventListener('input', (event) => {
    state.reauth.password = event.currentTarget.value
  })
  root.querySelector('[data-submit-reauth]')?.addEventListener('click', submitReauth)
  root.querySelector('[data-cancel-reauth]')?.addEventListener('click', () => {
    pendingReauthAction = null
    state.reauth = { visible: false, title: '', message: '', password: '', error: '', busy: false }
    state.totp.enrolling = false
    state.totp.disabling = false
    setTotpStatus('Security action cancelled.', 'error')
    render()
  })
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

async function runWithReauthRetry(action, { title = 'Confirm your identity', message = providerReauthCopy() } = {}) {
  try {
    return await action()
  } catch (error) {
    if (error?.code !== 'auth/requires-recent-login') throw error
    pendingReauthAction = async () => {
      await action()
    }
    state.reauth = { visible: true, title, message, password: '', error: '', busy: false }
    render()
    return null
  }
}

async function submitReauth() {
  if (!state.user || state.reauth.busy) return
  state.reauth.busy = true
  state.reauth.error = ''
  render()
  try {
    if (hasPasswordProvider()) {
      if (!state.user.email || !state.reauth.password) throw new Error('Enter your password to continue.')
      const credential = EmailAuthProvider.credential(state.user.email, state.reauth.password)
      await reauthenticateWithCredential(state.user, credential)
    } else if (hasGoogleProvider()) {
      await reauthenticateWithPopup(state.user, new GoogleAuthProvider())
    } else {
      throw new Error('This sign-in provider requires signing in again before changing security settings.')
    }
    const retry = pendingReauthAction
    pendingReauthAction = null
    state.reauth = { visible: false, title: '', message: '', password: '', error: '', busy: false }
    render()
    if (retry) await retry()
  } catch (error) {
    console.warn('[account-security] reauth failed', error?.code || error?.message || error)
    state.reauth.busy = false
    state.reauth.error = error?.message || 'Could not confirm your identity.'
    render()
  }
}

async function refreshCurrentUser() {
  if (auth.currentUser) {
    await auth.currentUser.reload().catch(() => {})
    await auth.currentUser.getIdToken(true).catch(() => {})
    state.user = auth.currentUser
  }
}

async function loadRecoveryStatus({ silent = false } = {}) {
  if (!state.user) return
  if (!silent) state.recovery.loading = true
  try {
    const status = await getRecoveryCodeStatus()
    state.recovery.generated = status.generated === true
    state.recovery.remaining = Number(status.remaining || 0)
    state.recovery.generatedAt = status.generatedAt || ''
    state.recovery.status = ''
    state.recovery.statusType = 'info'
  } catch (error) {
    console.warn('[account-security] recovery status failed', error?.code || error?.message || error)
    state.recovery.status = 'Recovery code status could not be loaded.'
    state.recovery.statusType = 'error'
  } finally {
    state.recovery.loading = false
  }
}

async function handleGenerateRecoveryCodes() {
  if (!state.user || state.recovery.generating) return
  state.recovery.generating = true
  state.recovery.status = state.recovery.generated ? 'Regenerating recovery codes will invalidate old codes...' : 'Generating recovery codes...'
  state.recovery.statusType = 'info'
  render()
  try {
    const result = await generateRecoveryCodes()
    state.recovery.generated = true
    state.recovery.remaining = Number(result.remaining || result.codes?.length || 0)
    state.recovery.modalCodes = Array.isArray(result.codes) ? result.codes : []
    state.recovery.status = 'Recovery codes generated. Save them before closing the modal.'
    state.recovery.statusType = 'success'
  } catch (error) {
    console.warn('[account-security] recovery code generation failed', error?.code || error?.message || error)
    state.recovery.status = error?.message || 'Recovery codes could not be generated.'
    state.recovery.statusType = 'error'
  } finally {
    state.recovery.generating = false
    render()
  }
}

async function copyRecoveryCodes() {
  const codes = state.recovery.modalCodes || []
  if (!codes.length) return
  try {
    await navigator.clipboard.writeText(codes.join('\n'))
    state.recovery.status = 'Recovery codes copied.'
    state.recovery.statusType = 'success'
  } catch {
    state.recovery.status = 'Copy failed. Select the codes and save them manually.'
    state.recovery.statusType = 'error'
  }
  render()
}

async function startTotpSetup() {
  if (!state.user || state.totp.stage === 'setup') return
  setTotpStatus('Preparing authenticator app setup...', 'info')
  state.totp.firebaseUnavailable = false
  render()

  try {
    await runWithReauthRetry(async () => {
      const session = await multiFactor(state.user).getSession()
      const secret = await TotpMultiFactorGenerator.generateSecret(session)
      const accountName = state.user.email || state.user.uid
      const qrUrl = secret.generateQrCodeUrl(accountName, 'Melogic Records')
      pendingTotpSecret = secret
      state.totp = {
        ...state.totp,
        stage: 'setup',
        qrDataUrl: await QRCode.toDataURL(qrUrl, {
          width: 220,
          margin: 1,
          color: { dark: '#07101f', light: '#ffffff' }
        }),
        manualKey: secret.secretKey || '',
        code: '',
        showKey: false,
        status: 'Scan the QR code, then enter the six-digit code.',
        statusType: 'info',
        statusCode: '',
        firebaseUnavailable: false
      }
      render()
    }, {
      title: 'Confirm setup',
      message: 'Confirm your identity before enabling authenticator-app 2FA.'
    })
  } catch (error) {
    console.warn('[account-security] TOTP setup failed', error?.code || error?.message || error)
    state.totp.firebaseUnavailable = String(error?.code || '').includes('operation-not-allowed')
    setTotpStatus(friendlyMfaError(error), 'error', String(error?.code || ''))
    render()
  }
}

async function confirmTotpSetup() {
  if (!state.user || !pendingTotpSecret || state.totp.enrolling) return
  const code = sanitizeOtp(state.totp.code)
  if (!/^\d{6}$/.test(code)) {
    setTotpStatus('Enter the six-digit code from your authenticator app.', 'error')
    render()
    return
  }

  state.totp.enrolling = true
  setTotpStatus('Verifying code...', 'info')
  render()

  try {
    await runWithReauthRetry(async () => {
      const assertion = TotpMultiFactorGenerator.assertionForEnrollment(pendingTotpSecret, code)
      await multiFactor(state.user).enroll(assertion, 'Authenticator app')
      await refreshCurrentUser()
      resetTotpSetup()
      setTotpStatus('Two-factor authentication is enabled.', 'success')
      await recordAccountSecurityEvent('two_factor_enabled', {
        path: ROUTES.accountSecurity,
        factorId: TotpMultiFactorGenerator.FACTOR_ID,
        displayName: 'Authenticator app'
      }).catch((error) => {
        console.warn('[account-security] 2FA enabled event failed', error?.code || error?.message || error)
      })
      render()
    }, {
      title: 'Confirm setup',
      message: 'Confirm your identity before enabling authenticator-app 2FA.'
    })
  } catch (error) {
    console.warn('[account-security] TOTP enrollment failed', error?.code || error?.message || error)
    state.totp.enrolling = false
    setTotpStatus(friendlyMfaError(error), 'error', String(error?.code || ''))
    render()
  }
}

async function disableTotp() {
  if (!state.user || state.totp.disabling) return
  const factor = getTotpFactors()[0]
  if (!factor) {
    state.totp.confirmDisable = false
    setTotpStatus('Authenticator-app 2FA is not currently enabled.', 'info')
    render()
    return
  }

  state.totp.disabling = true
  setTotpStatus('Disabling two-factor authentication...', 'info')
  render()

  try {
    await runWithReauthRetry(async () => {
      await multiFactor(state.user).unenroll(factor)
      await refreshCurrentUser()
      resetTotpSetup()
      setTotpStatus('Two-factor authentication is disabled.', 'success')
      await recordAccountSecurityEvent('two_factor_disabled', {
        path: ROUTES.accountSecurity,
        factorId: factor.factorId || TotpMultiFactorGenerator.FACTOR_ID,
        displayName: factor.displayName || 'Authenticator app'
      }).catch((error) => {
        console.warn('[account-security] 2FA disabled event failed', error?.code || error?.message || error)
      })
      render()
    }, {
      title: 'Confirm disable',
      message: 'Confirm your identity before disabling two-factor authentication.'
    })
  } catch (error) {
    console.warn('[account-security] disable TOTP failed', error?.code || error?.message || error)
    state.totp.disabling = false
    setTotpStatus(friendlyMfaError(error), 'error', String(error?.code || ''))
    render()
  }
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
    const code = String(error?.code || '')
    const message = String(error?.message || '')
    state.verificationStatus = code === 'functions/internal' || message === 'internal'
      ? 'Verification email could not be sent right now. Please try again.'
      : message || 'Verification email could not be sent right now. Please try again.'
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

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible' || !auth.currentUser) return
  await refreshCurrentUser()
  await loadRecoveryStatus({ silent: true })
  render()
})

waitForInitialAuthState().then(async (user) => {
  state.user = user || auth.currentUser || null
  if (!state.user) {
    window.location.assign(authRoute({ redirect: ROUTES.accountSecurity }))
    return
  }
  await refreshCurrentUser()
  await loadRecoveryStatus({ silent: true })
  try {
    const token = await getIdTokenResult(state.user, true)
    state.claims = token.claims || {}
  } catch {
    state.claims = {}
  }
  render()
  startAccountEventsSubscription()
})
