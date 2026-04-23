import './styles/base.css'
import './styles/auth.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import {
  createAccountWithEmail,
  signInWithEmail,
  signInWithGoogle,
  subscribeToAuthState,
  authPersistenceReady,
  updateCurrentUserProfile
} from './firebase/auth'
import { upsertUserProfile } from './firebase/firestore'

const app = document.querySelector('#app')

app.innerHTML = `
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
              <input type="password" name="signin-password" placeholder="••••••••" autocomplete="current-password" required />
            </label>
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
              <input type="password" name="signup-password" placeholder="Create a secure password" autocomplete="new-password" required />
            </label>
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

initShellChrome()

const heroPaths = getPageHeroVideoPaths('auth')
if (heroPaths) {
  attachHeroVideo(document.querySelector('#auth-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'auth'
  })
}

const tabButtons = document.querySelectorAll('.auth-tab')
const panels = document.querySelectorAll('.auth-form')
const signinForm = document.querySelector('[data-panel="signin"]')
const signupForm = document.querySelector('[data-panel="signup"]')
const googleButton = document.querySelector('[data-google-btn]')
const signinButton = document.querySelector('[data-signin-btn]')
const signupButton = document.querySelector('[data-signup-btn]')
const feedback = document.querySelector('[data-auth-feedback]')
const actionButtons = [signinButton, signupButton, googleButton].filter(Boolean)
let isSubmitting = false
let hasWarnedProfileWrite = false

function warnProfileWriteFailure(error, context) {
  if (hasWarnedProfileWrite) return
  hasWarnedProfileWrite = true
  console.warn(`[auth] Firestore profile ${context} failed.`, error?.code || error?.message || error)
}

function waitForAuthenticatedUser(timeoutMs = 2500) {
  return new Promise((resolve) => {
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
  await waitForAuthenticatedUser()
  window.location.assign('/profile.html')
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
    'auth/email-already-in-use': 'That email is already in use.',
    'auth/weak-password': 'Password should be at least 6 characters.',
    'auth/popup-closed-by-user': 'Google sign-in was cancelled before completion.',
    'auth/cancelled-popup-request': 'Another sign-in popup is already open.'
  }

  return map[errorCode] || 'We could not complete that auth request. Please try again.'
}

async function handleSignInSubmit(event) {
  event.preventDefault()
  if (isSubmitting) return

  const email = signinForm.querySelector('[name="signin-email"]').value.trim()
  const password = signinForm.querySelector('[name="signin-password"]').value

  setFeedback('Signing in...', 'info')
  setLoadingState(true, { signin: 'Signing In...' })

  try {
    await authPersistenceReady
    await signInWithEmail(email, password)
    setFeedback('Signed in successfully. Redirecting to your profile...', 'success')
    await redirectToProfile()
  } catch (error) {
    setFeedback(friendlyAuthError(error?.code), 'error')
  } finally {
    setLoadingState(false)
  }
}

async function handleSignUpSubmit(event) {
  event.preventDefault()
  if (isSubmitting) return

  const displayName = signupForm.querySelector('[name="display-name"]').value.trim()
  const username = signupForm.querySelector('[name="username"]').value.trim()
  const email = signupForm.querySelector('[name="signup-email"]').value.trim()
  const password = signupForm.querySelector('[name="signup-password"]').value

  setFeedback('Creating your account...', 'info')
  setLoadingState(true, { signup: 'Creating Account...' })

  try {
    await authPersistenceReady
    const credential = await createAccountWithEmail(email, password)

    if (displayName) {
      await updateCurrentUserProfile({ displayName })
    }

    try {
      await upsertUserProfile(credential.user, {
        displayName,
        username,
        email,
        isNewUser: true
      })
    } catch (error) {
      warnProfileWriteFailure(error, 'write')
    }

    setFeedback('Account created. Redirecting to your profile...', 'success')
    await redirectToProfile()
  } catch (error) {
    setFeedback(friendlyAuthError(error?.code), 'error')
  } finally {
    setLoadingState(false)
  }
}

async function handleGoogleSignIn() {
  if (isSubmitting) return

  setFeedback('Opening Google sign-in...', 'info')
  setLoadingState(true, { google: 'Connecting...' })

  try {
    await authPersistenceReady
    const credential = await signInWithGoogle()

    try {
      await upsertUserProfile(credential.user, {
        displayName: credential.user.displayName || '',
        email: credential.user.email || '',
        isNewUser: false
      })
    } catch (error) {
      warnProfileWriteFailure(error, 'upsert')
    }

    setFeedback('Signed in with Google. Redirecting...', 'success')
    await redirectToProfile()
  } catch (error) {
    setFeedback(friendlyAuthError(error?.code), 'error')
  } finally {
    setLoadingState(false)
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

let hasHandledInitialUser = false
subscribeToAuthState((user) => {
  if (hasHandledInitialUser) return
  hasHandledInitialUser = true
  if (!user) return
  setFeedback('You are already signed in. Redirecting to profile...', 'success')
  redirectToProfile()
})
