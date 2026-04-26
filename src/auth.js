import './styles/base.css'
import './styles/auth.css'
import { httpsCallable } from 'firebase/functions'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import { functions } from './firebase/functions'
import {
  createAccountWithEmail,
  signInWithEmail,
  signInWithGoogle,
  subscribeToAuthState,
  authPersistenceReady,
  auth,
  waitForInitialAuthState,
  updateCurrentUserProfile
} from './firebase/auth'
import { executeRecaptchaAction, getRecaptchaSiteKey, isRecaptchaAuthEnabled } from './security/recaptchaEnterprise'
import { ROUTES, cleanRedirectTarget } from './utils/routes'

const app = document.querySelector('#app')

app.innerHTML = `
  ${renderPagePreloaderMarkup()}
  ${navShell({ currentPage: 'auth' })}

  <main>
    <section class="standard-hero section" id="auth-top">
      <div class="hero-media" aria-hidden="true">
        <video
          id="auth-hero-video"
          class="hero-bg-video"
          muted
          loop
          autoplay
          playsinline
          preload="metadata"
        ></video>
        <div class="hero-media-overlay"></div>
      </div>

      <div class="section-inner hero-inner hero-content-layer">
        <div class="hero-copy">
          <p class="eyebrow">Melogic Account</p>
          <h1>Sign In / Sign Up</h1>
          <p>Access products, community spaces, carts, creator tools, and your personalized Melogic profile experience.</p>
        </div>
      </div>
    </section>

    <section class="section auth-shell">
      <div class="section-inner auth-grid">
        <article class="auth-card" aria-labelledby="auth-card-title">
          <div class="auth-toggle" role="tablist" aria-label="Authentication mode">
            <button type="button" class="auth-tab is-active" data-tab="signin" role="tab" aria-selected="true">Sign In</button>
            <button type="button" class="auth-tab" data-tab="signup" role="tab" aria-selected="false">Create Account</button>
          </div>

          <h2 id="auth-card-title" class="auth-card-title">Welcome back to Melogic.</h2>
          <p class="auth-status-message" data-auth-feedback role="status" aria-live="polite"></p>

          <form class="auth-form" data-panel="signin">
            <label>
              <span>Email</span>
              <input type="email" name="signin-email" placeholder="you@melogicrecords.com" autocomplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <div class="password-field">
                <input type="password" name="signin-password" placeholder="••••••••" autocomplete="current-password" required />
                <button type="button" class="password-toggle" data-password-toggle data-target="signin-password" aria-label="Show password" aria-pressed="false">Show</button>
              </div>
            </label>
            <div class="auth-recaptcha-status" data-recaptcha-status data-state="idle">
              <span class="auth-recaptcha-check" aria-hidden="true">✓</span>
              <span class="auth-recaptcha-copy">
                <strong>Protected by reCAPTCHA Enterprise</strong>
                <small data-recaptcha-status-text>Verification runs when you submit.</small>
              </span>
            </div>
            <button type="submit" class="button button-accent auth-submit" data-signin-btn>Sign In</button>
            <a class="auth-link" href="#" aria-label="Forgot password">Forgot password?</a>
          </form>

          <form class="auth-form is-hidden" data-panel="signup">
            <label>
              <span>Display Name</span>
              <input type="text" name="display-name" placeholder="Your artist or producer name" autocomplete="name" required />
            </label>
            <label>
              <span>Username</span>
              <input type="text" name="username" placeholder="melogic_username" autocomplete="username" required />
            </label>
            <label>
              <span>Email</span>
              <input type="email" name="signup-email" placeholder="you@melogicrecords.com" autocomplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <div class="password-field">
                <input type="password" name="signup-password" placeholder="Create a secure password" autocomplete="new-password" required />
                <button type="button" class="password-toggle" data-password-toggle data-target="signup-password" aria-label="Show password" aria-pressed="false">Show</button>
              </div>
            </label>
            <div class="auth-recaptcha-status" data-recaptcha-status data-state="idle">
              <span class="auth-recaptcha-check" aria-hidden="true">✓</span>
              <span class="auth-recaptcha-copy">
                <strong>Protected by reCAPTCHA Enterprise</strong>
                <small data-recaptcha-status-text>Verification runs when you submit.</small>
              </span>
            </div>
            <button type="submit" class="button button-accent auth-submit" data-signup-btn>Create Account</button>
          </form>

          <div class="auth-divider"><span>or continue with</span></div>

          <div class="social-auth-actions" aria-label="Social sign in options">
            <button type="button" class="button button-muted social-auth-btn" data-google-btn>Continue with Google</button>
            <button type="button" class="button button-muted social-auth-btn" disabled>Continue with Apple</button>
          </div>
        </article>

        <aside class="auth-benefits" aria-label="Account benefits">
          <p class="eyebrow">Why create an account</p>
          <h3>Build your identity across the Melogic platform.</h3>
          <ul>
            <li>Save products and quickly access your toolkit.</li>
            <li>Join community discussions and feedback threads.</li>
            <li>Build a creator profile with releases and links.</li>
            <li>Track purchases and download history in one place.</li>
          </ul>
        </aside>
      </div>
    </section>
  </main>
`

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('auth')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#auth-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'auth'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })

const tabButtons = document.querySelectorAll('.auth-tab')
const panels = document.querySelectorAll('.auth-form')
const signinForm = document.querySelector('[data-panel="signin"]')
const signupForm = document.querySelector('[data-panel="signup"]')
const googleButton = document.querySelector('[data-google-btn]')
const signinButton = document.querySelector('[data-signin-btn]')
const signupButton = document.querySelector('[data-signup-btn]')
const feedback = document.querySelector('[data-auth-feedback]')
const authCardTitle = document.querySelector('#auth-card-title')
const actionButtons = [signinButton, signupButton, googleButton].filter(Boolean)
let isSubmitting = false

function setRecaptchaStatus(form, state = 'idle', message = 'Verification runs when you submit.') {
  if (!form) return
  const statusRoot = form.querySelector('[data-recaptcha-status]')
  const statusText = form.querySelector('[data-recaptcha-status-text]')
  if (!statusRoot || !statusText) return
  statusRoot.dataset.state = state
  statusText.textContent = message
}

function initPasswordToggles() {
  const toggles = document.querySelectorAll('[data-password-toggle]')
  if (!toggles.length) return

  toggles.forEach((toggle) => {
    const targetName = toggle.dataset.target
    if (!targetName) return

    const input = document.querySelector(`input[name="${targetName}"]`)
    if (!input) return

    toggle.addEventListener('click', () => {
      const showPassword = input.type === 'password'
      input.type = showPassword ? 'text' : 'password'
      toggle.textContent = showPassword ? 'Hide' : 'Show'
      toggle.setAttribute('aria-pressed', String(showPassword))
      toggle.setAttribute('aria-label', `${showPassword ? 'Hide' : 'Show'} password`)
    })
  })
}

function waitForAuthenticatedUser(timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (auth.currentUser) {
      resolve(auth.currentUser)
      return
    }

    let settled = false
    const timeout = window.setTimeout(() => {
      if (settled) return
      settled = true
      unsubscribe()
      resolve(null)
    }, timeoutMs)

    const unsubscribe = subscribeToAuthState((user) => {
      if (!user || settled) return
      settled = true
      window.clearTimeout(timeout)
      unsubscribe()
      resolve(user)
    })
  })
}

async function redirectToProfile() {
  await waitForInitialAuthState()
  await waitForAuthenticatedUser()
  window.location.assign(getSafeRedirectTarget())
}

function getSafeRedirectTarget() {
  const defaultTarget = ROUTES.profile
  const redirectValue = new URLSearchParams(window.location.search).get('redirect')
  return cleanRedirectTarget(redirectValue || '', defaultTarget)
}

function setAuthTab(activeTab) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-selected', String(isActive))
  })

  panels.forEach((panel) => {
    panel.classList.toggle('is-hidden', panel.dataset.panel !== activeTab)
  })

  if (authCardTitle) {
    authCardTitle.textContent = activeTab === 'signup' ? 'Creativity Begins Here' : 'Welcome back to Melogic.'
  }

  const activeForm = activeTab === 'signup' ? signupForm : signinForm
  setRecaptchaStatus(activeForm, 'idle', 'Verification runs when you submit.')

  setFeedback('')
}

function setFeedback(message, type = 'info') {
  if (!feedback) return
  feedback.textContent = message
  feedback.dataset.state = type
}

function setLoadingState(enabled, buttonTextMap = {}) {
  isSubmitting = enabled
  actionButtons.forEach((button) => {
    if (enabled && !button.dataset.originalText) {
      button.dataset.originalText = button.textContent
    }
    button.disabled = enabled
  })

  if (enabled) {
    if (signinButton && buttonTextMap.signin) signinButton.textContent = buttonTextMap.signin
    if (signupButton && buttonTextMap.signup) signupButton.textContent = buttonTextMap.signup
    if (googleButton && buttonTextMap.google) googleButton.textContent = buttonTextMap.google
  } else {
    actionButtons.forEach((button) => {
      button.textContent = button.dataset.originalText
    })
  }
}

function friendlyAuthError(errorCode) {
  const map = {
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/user-not-found': 'No account exists with that email yet.',
    'auth/wrong-password': 'Incorrect password. Please try again.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/invalid-login-credentials': 'Email or password is incorrect.',
    'auth/api-key-not-valid': "Firebase Auth is rejecting this app's API key. Check Google Cloud API key restrictions.",
    'auth/app-not-authorized': "This app is not authorized to use Firebase Auth for this project.",
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled for this Firebase project.',
    'auth/too-many-requests': 'Too many attempts were made. Please wait a moment and try again.',
    'auth/network-request-failed': 'Network request failed. Check your connection and try again.',
    'auth/user-disabled': 'This account has been disabled. Contact support if you believe this is a mistake.',
    'auth/email-already-in-use': 'That email is already in use.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled before completion.',
    'auth/cancelled-popup-request': 'Another sign-in popup is already open.'
  }

  return map[errorCode] || 'We could not complete that auth request. Please try again.'
}

function logFirebaseAuthError(context, error) {
  const customData = error?.customData && typeof error.customData === 'object'
    ? {
        appName: error.customData.appName,
        _tokenResponse: error.customData._tokenResponse ? '[redacted]' : undefined,
        operationType: error.customData.operationType,
        email: error.customData.email
      }
    : undefined

  console.warn(`[auth] ${context} failed.`, {
    code: error?.code,
    message: error?.message,
    customData
  })
}

function friendlySubmitError(error) {
  const message = String(error?.message || '')
  if (
    message.includes('Security verification') ||
    message.includes('reCAPTCHA') ||
    message.includes('verification could not load')
  ) {
    return message
  }
  return friendlyAuthError(error?.code)
}

function friendlyProvisioningError(error) {
  const code = String(error?.code || '')
  if (code === 'functions/already-exists') return 'That username is already taken. Please choose another one.'
  if (code === 'functions/invalid-argument') return error?.message || 'Profile setup input is invalid.'
  if (code === 'functions/unauthenticated') return 'Account was created, but profile setup could not authenticate. Please sign in again.'
  if (code === 'functions/failed-precondition') return 'Profile setup could not complete. Please try again.'
  return 'Account created, but profile setup is incomplete. Please retry or finish setup in Edit Profile.'
}

function validateSignupFields(displayName, username) {
  const normalizedDisplayName = String(displayName || '').trim()
  const normalizedUsername = String(username || '').trim().toLowerCase()

  if (!normalizedDisplayName) return { valid: false, message: 'Display name is required.' }
  if (normalizedDisplayName.length > 80) return { valid: false, message: 'Display name must be 80 characters or less.' }
  if (!normalizedUsername) return { valid: false, message: 'Username is required.' }
  if (/\s/.test(normalizedUsername)) return { valid: false, message: 'Username cannot contain spaces.' }
  if (!/^[a-z0-9_-]+$/.test(normalizedUsername)) {
    return { valid: false, message: 'Username can only contain lowercase letters, numbers, underscores, and hyphens.' }
  }
  if (normalizedUsername.length < 3) return { valid: false, message: 'Username must be at least 3 characters.' }
  if (normalizedUsername.length > 30) return { valid: false, message: 'Username must be 30 characters or less.' }

  return { valid: true, displayName: normalizedDisplayName, username: normalizedUsername }
}

async function verifyAuthHuman(action) {
  const authRecaptchaEnabled = isRecaptchaAuthEnabled()
  if (!authRecaptchaEnabled) {
    if (import.meta.env.PROD) {
      throw new Error('Security verification is not configured.')
    }
    return true
  }

  if (!getRecaptchaSiteKey()) {
    throw new Error('Security verification is not configured.')
  }

  if (import.meta.env.DEV) {
    console.debug(`[auth] executeRecaptchaAction start: ${action}`)
  }

  const token = await executeRecaptchaAction(action).catch((error) => {
    console.warn('[auth] executeRecaptchaAction failed.', {
      code: error?.code,
      message: error?.message
    })
    throw new Error('Security verification could not load. Please refresh and try again.')
  })

  if (import.meta.env.DEV) {
    console.debug(`[auth] verifyRecaptchaEnterprise start: ${action}`)
  }

  const verifyCallable = httpsCallable(functions, 'verifyRecaptchaEnterprise')
  const verification = await verifyCallable({ token, action }).catch((error) => {
    console.warn('[auth] verifyRecaptchaEnterprise failed.', {
      code: error?.code,
      message: error?.message
    })
    throw new Error('Security verification failed. Please try again.')
  })
  if (!verification?.data?.ok) {
    throw new Error('Security verification failed. Please try again.')
  }
  return true
}

async function handleSignInSubmit(event) {
  event.preventDefault()
  if (isSubmitting) return

  const email = signinForm.querySelector('[name="signin-email"]').value.trim()
  const password = signinForm.querySelector('[name="signin-password"]').value

  setFeedback('Checking security verification...', 'info')
  setLoadingState(true, { signin: 'Signing In...' })

  try {
    setRecaptchaStatus(signinForm, 'checking', 'Checking security verification...')
    await verifyAuthHuman('LOGIN')
    setRecaptchaStatus(signinForm, 'verified', 'Verified for this request.')
    setFeedback('Signing in...', 'info')
    await authPersistenceReady
    await signInWithEmail(email, password)
    setFeedback('Signed in successfully. Redirecting to your profile...', 'success')
    await redirectToProfile()
  } catch (error) {
    setRecaptchaStatus(signinForm, 'error', 'Verification failed. Please try again.')
    logFirebaseAuthError('signInWithEmail', error)
    setFeedback(friendlySubmitError(error), 'error')
  } finally {
    setLoadingState(false)
  }
}

async function handleSignUpSubmit(event) {
  event.preventDefault()
  if (isSubmitting) return

  const displayName = signupForm.querySelector('[name="display-name"]').value.trim()
  const username = signupForm.querySelector('[name="username"]').value.trim().toLowerCase()
  const email = signupForm.querySelector('[name="signup-email"]').value.trim()
  const password = signupForm.querySelector('[name="signup-password"]').value
  const signupValidation = validateSignupFields(displayName, username)

  if (!signupValidation.valid) {
    setFeedback(signupValidation.message, 'error')
    return
  }

  setFeedback('Creating your account...', 'info')
  setLoadingState(true, { signup: 'Creating Account...' })

  try {
    setFeedback('Checking security verification...', 'info')
    setRecaptchaStatus(signupForm, 'checking', 'Checking security verification...')
    await verifyAuthHuman('SIGNUP')
    setRecaptchaStatus(signupForm, 'verified', 'Verified for this request.')
    setFeedback('Creating your account...', 'info')
    await authPersistenceReady
    const credential = await createAccountWithEmail(email, password)

    if (displayName) {
      await updateCurrentUserProfile({ displayName })
    }

    const provisioning = await provisionUserAccount({
      displayName: signupValidation.displayName,
      username: signupValidation.username,
      email,
      photoURL: credential.user.photoURL || '',
      requireUsername: true
    })

    if (provisioning?.onboardingRequired) {
      setFeedback('Account created. Please finish profile setup.', 'info')
      window.location.assign(ROUTES.editProfile)
      return
    }

    setFeedback('Account created. Redirecting to your profile...', 'success')
    await redirectToProfile()
  } catch (error) {
    setRecaptchaStatus(signupForm, 'error', 'Verification failed. Please try again.')
    setFeedback(friendlyProvisioningError(error), 'error')
  } finally {
    setLoadingState(false)
  }
}

async function handleGoogleSignIn() {
  if (isSubmitting) return

  setFeedback('Opening Google sign-in...', 'info')
  setLoadingState(true, { google: 'Connecting...' })

  try {
    setRecaptchaStatus(signinForm, 'checking', 'Checking security verification...')
    await verifyAuthHuman('GOOGLE_LOGIN')
    setRecaptchaStatus(signinForm, 'verified', 'Verified for this request.')
    await authPersistenceReady
    const credential = await signInWithGoogle()

    const provisioning = await provisionUserAccount({
      displayName: credential.user.displayName || '',
      email: credential.user.email || ''
    })

    if (provisioning.onboardingRequired) {
      setFeedback('Signed in. Please choose a username to finish setup.', 'info')
      window.location.assign(ROUTES.editProfile)
      return
    }

    setFeedback('Signed in with Google. Redirecting...', 'success')
    await redirectToProfile()
  } catch (error) {
    setRecaptchaStatus(signinForm, 'error', 'Verification failed. Please try again.')
    setFeedback(friendlyProvisioningError(error), 'error')
  } finally {
    setLoadingState(false)
  }
}

async function provisionUserAccount(payload) {
  const provisionCallable = httpsCallable(functions, 'provisionUserAccount')
  try {
    const result = await provisionCallable(payload)
    return result?.data || { ok: false, onboardingRequired: true }
  } catch (error) {
    console.warn('[auth] provisionUserAccount failed', {
      code: error?.code,
      message: error?.message
    })
    throw error
  }
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setAuthTab(button.dataset.tab)
  })
})

signinForm?.addEventListener('submit', handleSignInSubmit)
signupForm?.addEventListener('submit', handleSignUpSubmit)
googleButton?.addEventListener('click', handleGoogleSignIn)
initPasswordToggles()
setRecaptchaStatus(signinForm, 'idle', 'Verification runs when you submit.')
setRecaptchaStatus(signupForm, 'idle', 'Verification runs when you submit.')

let hasHandledInitialUser = false
waitForInitialAuthState().then((user) => {
  if (!user || hasHandledInitialUser) return
  hasHandledInitialUser = true
  setFeedback('You are already signed in. Redirecting to profile...', 'success')
  redirectToProfile()
})

subscribeToAuthState((user) => {
  if (hasHandledInitialUser) return
  hasHandledInitialUser = true
  if (!user) return
  setFeedback('You are already signed in. Redirecting to profile...', 'success')
  redirectToProfile()
})
