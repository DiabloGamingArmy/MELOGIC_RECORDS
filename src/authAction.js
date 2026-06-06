import './styles/base.css'
import './styles/auth.css'
import {
  applyActionCode,
  confirmPasswordReset,
  reload,
  verifyPasswordResetCode
} from 'firebase/auth'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { auth, sendEmailVerificationRequest, sendPasswordReset, waitForInitialAuthState } from './firebase/auth'
import { recordAccountSecurityEvent } from './services/accountEvents'
import { ROUTES, authRoute } from './utils/routes'

const app = document.querySelector('#app')
const params = new URLSearchParams(window.location.search)
const mode = params.get('mode') || ''
const oobCode = params.get('oobCode') || ''

const state = {
  loading: true,
  mode,
  stage: 'loading',
  title: 'Account action',
  message: 'Checking your secure Melogic Records link...',
  tone: 'info',
  resetEmail: '',
  password: '',
  confirmPassword: '',
  formError: '',
  busy: false,
  user: null
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

function safeActionError(error, type = 'link') {
  const code = String(error?.code || '')
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') return `${type} has expired or was already used.`
  if (code === 'auth/user-disabled' || code === 'auth/user-not-found') return `${type} could not be used for this account.`
  return `${type} could not be completed.`
}

function actionButtons() {
  if (state.stage === 'reset-form') return ''
  const security = state.user
    ? `<a class="button button-accent" href="${ROUTES.accountSecurity}">Return to Account Security</a>`
    : `<a class="button button-accent" href="${authRoute({ redirect: ROUTES.accountSecurity })}">Sign In</a>`
  const home = `<a class="button button-muted" href="${ROUTES.home}">Return Home</a>`
  if (state.stage === 'verify-invalid') {
    return `
      <button type="button" class="button button-accent" data-request-verification ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending...' : 'Request New Verification Email'}</button>
      ${security}
      ${home}
    `
  }
  if (state.stage === 'reset-invalid') {
    return `
      <button type="button" class="button button-accent" data-open-reset-request>Request New Password Reset</button>
      ${home}
    `
  }
  if (state.stage === 'reset-request') {
    return home
  }
  if (state.stage === 'reset-success') {
    return `
      <a class="button button-accent" href="${ROUTES.auth}">Sign In</a>
      ${home}
    `
  }
  return `
    ${security}
    ${home}
  `
}

function renderResetForm() {
  if (state.stage !== 'reset-form') return ''
  return `
    <form class="auth-action-form" data-reset-form>
      <label>
        <span>New password</span>
        <input type="password" autocomplete="new-password" minlength="8" value="${escapeHtml(state.password)}" data-new-password />
      </label>
      <label>
        <span>Confirm password</span>
        <input type="password" autocomplete="new-password" minlength="8" value="${escapeHtml(state.confirmPassword)}" data-confirm-password />
      </label>
      <ul class="auth-action-requirements">
        <li>Use at least 8 characters.</li>
        <li>Avoid reused or common passwords.</li>
        <li>Choose something unique to Melogic Records.</li>
      </ul>
      ${state.formError ? `<p class="auth-action-status" data-state="error">${escapeHtml(state.formError)}</p>` : ''}
      <button type="submit" class="button button-accent" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Resetting...' : 'Reset Password'}</button>
    </form>
  `
}

function renderResetRequestForm() {
  if (state.stage !== 'reset-request') return ''
  return `
    <form class="auth-action-form" data-reset-request-form>
      <label>
        <span>Email address</span>
        <input type="email" autocomplete="email" value="${escapeHtml(state.resetEmail)}" data-reset-email />
      </label>
      ${state.formError ? `<p class="auth-action-status" data-state="error">${escapeHtml(state.formError)}</p>` : ''}
      <button type="submit" class="button button-accent" ${state.busy ? 'disabled' : ''}>${state.busy ? 'Sending...' : 'Send Reset Link'}</button>
    </form>
  `
}

function render() {
  app.innerHTML = `
    ${navShell({ currentPage: 'profile' })}
    <main class="auth-action-main">
      <section class="auth-action-shell">
        <article class="auth-action-card" data-state="${escapeHtml(state.tone)}">
          <p class="auth-action-wordmark">MELOGIC RECORDS</p>
          <span class="auth-action-pill">${state.mode === 'resetPassword' ? 'Password reset' : state.mode === 'verifyEmail' ? 'Email verification' : 'Account security'}</span>
          <h1>${escapeHtml(state.title)}</h1>
          <p>${escapeHtml(state.message)}</p>
          ${state.loading ? '<div class="auth-action-loader" aria-label="Loading"></div>' : ''}
          ${renderResetForm()}
          ${renderResetRequestForm()}
          <div class="auth-action-buttons">
            ${actionButtons()}
          </div>
        </article>
      </section>
    </main>
  `
  initShellChrome()
  bindActions()
}

function bindActions() {
  app.querySelector('[data-request-verification]')?.addEventListener('click', requestVerificationEmail)
  app.querySelector('[data-open-reset-request]')?.addEventListener('click', () => {
    state.stage = 'reset-request'
    state.title = 'Request a new password reset'
    state.message = 'Enter your account email. If an account exists, a new reset link will be sent.'
    state.tone = 'info'
    state.formError = ''
    render()
  })
  app.querySelector('[data-reset-form]')?.addEventListener('submit', submitPasswordReset)
  app.querySelector('[data-reset-request-form]')?.addEventListener('submit', requestPasswordReset)
  app.querySelector('[data-new-password]')?.addEventListener('input', (event) => {
    state.password = event.currentTarget.value
  })
  app.querySelector('[data-confirm-password]')?.addEventListener('input', (event) => {
    state.confirmPassword = event.currentTarget.value
  })
  app.querySelector('[data-reset-email]')?.addEventListener('input', (event) => {
    state.resetEmail = event.currentTarget.value
  })
}

async function recordEvent(type, payload = {}) {
  if (!auth.currentUser) return
  await recordAccountSecurityEvent(type, {
    path: ROUTES.accountSecurity,
    provider: 'firebase_auth',
    ...payload
  }).catch((error) => {
    console.warn('[auth-action] account event failed', type, error?.code || error?.message || error)
  })
}

async function handleVerifyEmail() {
  if (!oobCode) {
    state.loading = false
    state.stage = 'verify-invalid'
    state.tone = 'error'
    state.title = 'Verification link incomplete'
    state.message = 'This verification link is missing required information.'
    render()
    return
  }

  state.title = 'Verifying your email...'
  state.message = 'Hold on while Firebase confirms this secure account link.'
  render()

  try {
    await applyActionCode(auth, oobCode)
    if (auth.currentUser) {
      await reload(auth.currentUser).catch(() => {})
      await auth.currentUser.getIdToken(true).catch(() => {})
    }
    state.loading = false
    state.stage = 'verify-success'
    state.tone = 'success'
    state.title = 'Your email has been verified.'
    state.message = 'Your Melogic Records account is now more secure.'
    await recordEvent('email_verified')
  } catch (error) {
    console.warn('[auth-action] verifyEmail failed', error?.code || error?.message || error)
    state.loading = false
    state.stage = 'verify-invalid'
    state.tone = 'error'
    state.title = 'Verification link unavailable'
    state.message = safeActionError(error, 'This verification link')
    await recordEvent(error?.code === 'auth/expired-action-code' ? 'auth_action_link_expired' : 'auth_action_link_invalid', { mode: 'verifyEmail' })
  }
  render()
}

async function handleResetPassword() {
  if (!oobCode) {
    state.loading = false
    state.stage = 'reset-invalid'
    state.tone = 'error'
    state.title = 'Reset link incomplete'
    state.message = 'This reset link is missing required information.'
    render()
    return
  }

  state.title = 'Checking your reset link...'
  state.message = 'We are confirming this password reset link before showing the form.'
  render()

  try {
    const email = await verifyPasswordResetCode(auth, oobCode)
    state.resetEmail = email || ''
    state.loading = false
    state.stage = 'reset-form'
    state.tone = 'info'
    state.title = 'Reset your password'
    state.message = 'Enter a new password for your Melogic Records account.'
  } catch (error) {
    console.warn('[auth-action] resetPassword verify failed', error?.code || error?.message || error)
    state.loading = false
    state.stage = 'reset-invalid'
    state.tone = 'error'
    state.title = 'Reset link unavailable'
    state.message = safeActionError(error, 'This password reset link')
    await recordEvent(error?.code === 'auth/expired-action-code' ? 'auth_action_link_expired' : 'auth_action_link_invalid', { mode: 'resetPassword' })
  }
  render()
}

async function submitPasswordReset(event) {
  event.preventDefault()
  if (state.busy) return
  const password = state.password || ''
  const confirmPassword = state.confirmPassword || ''
  if (password.length < 8) {
    state.formError = 'Use at least 8 characters for your new password.'
    render()
    return
  }
  if (password !== confirmPassword) {
    state.formError = 'The passwords do not match.'
    render()
    return
  }
  state.busy = true
  state.formError = ''
  render()
  try {
    await confirmPasswordReset(auth, oobCode, password)
    state.busy = false
    state.loading = false
    state.stage = 'reset-success'
    state.tone = 'success'
    state.title = 'Your password has been reset.'
    state.message = 'You can now sign in with your new password.'
    state.password = ''
    state.confirmPassword = ''
    await recordEvent('password_reset_completed')
  } catch (error) {
    console.warn('[auth-action] confirmPasswordReset failed', error?.code || error?.message || error)
    state.busy = false
    state.stage = 'reset-invalid'
    state.tone = 'error'
    state.title = 'Reset link unavailable'
    state.message = safeActionError(error, 'This password reset link')
    await recordEvent(error?.code === 'auth/expired-action-code' ? 'auth_action_link_expired' : 'auth_action_link_invalid', { mode: 'resetPassword' })
  }
  render()
}

async function requestVerificationEmail() {
  if (!auth.currentUser) {
    state.message = 'Sign in, then request a new verification email from Account Security.'
    render()
    return
  }
  state.busy = true
  state.message = 'Sending a new verification email...'
  render()
  try {
    await sendEmailVerificationRequest()
    state.tone = 'success'
    state.title = 'Verification email sent'
    state.message = 'Check your inbox for a new Melogic Records verification link.'
  } catch (error) {
    console.warn('[auth-action] request verification failed', error?.code || error?.message || error)
    state.tone = 'error'
    state.message = 'A new verification email could not be sent right now. Return to Account Security and try again.'
  } finally {
    state.busy = false
    render()
  }
}

async function requestPasswordReset(event) {
  event.preventDefault()
  if (state.busy) return
  const email = String(state.resetEmail || '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    state.formError = 'Enter a valid email address.'
    render()
    return
  }
  state.busy = true
  state.formError = ''
  render()
  try {
    await sendPasswordReset(email)
    state.stage = 'reset-request'
    state.tone = 'success'
    state.title = 'Reset email requested'
    state.message = 'If an account exists for that email, a new reset link has been sent.'
  } catch (error) {
    console.warn('[auth-action] request password reset failed', error?.code || error?.message || error)
    state.stage = 'reset-request'
    state.tone = 'success'
    state.title = 'Reset email requested'
    state.message = 'If an account exists for that email, a new reset link has been sent.'
  } finally {
    state.busy = false
    render()
  }
}

async function init() {
  state.user = await waitForInitialAuthState()
  if (mode === 'verifyEmail') {
    await handleVerifyEmail()
    return
  }
  if (mode === 'resetPassword') {
    await handleResetPassword()
    return
  }
  state.loading = false
  state.stage = 'unsupported'
  state.tone = 'error'
  state.title = mode === 'recoverEmail' ? 'Email recovery is not available here' : 'Unsupported account action'
  state.message = mode === 'recoverEmail'
    ? 'Return to Account Security or contact support if you need help recovering an email change.'
    : 'This Melogic Records account action is not supported.'
  render()
}

render()
init()
