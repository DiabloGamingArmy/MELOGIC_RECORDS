import './styles/base.css'
import './styles/auth.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'

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

          <form class="auth-form" data-panel="signin">
            <label>
              <span>Email</span>
              <input type="email" name="signin-email" placeholder="you@melogicrecords.com" autocomplete="email" required />
            </label>
            <label>
              <span>Password</span>
              <input type="password" name="signin-password" placeholder="••••••••" autocomplete="current-password" required />
            </label>
            <button type="submit" class="button button-accent auth-submit">Sign In</button>
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
            <button type="submit" class="button button-accent auth-submit">Create Account</button>
          </form>

          <div class="auth-divider"><span>or continue with</span></div>

          <div class="social-auth-actions" aria-label="Social sign in options">
            <button type="button" class="button button-muted social-auth-btn">Continue with Google</button>
            <button type="button" class="button button-muted social-auth-btn">Continue with Apple</button>
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

function setAuthTab(activeTab) {
  tabButtons.forEach((button) => {
    const isActive = button.dataset.tab === activeTab
    button.classList.toggle('is-active', isActive)
    button.setAttribute('aria-selected', String(isActive))
  })

  panels.forEach((panel) => {
    panel.classList.toggle('is-hidden', panel.dataset.panel !== activeTab)
  })
}

tabButtons.forEach((button) => {
  button.addEventListener('click', () => {
    setAuthTab(button.dataset.tab)
  })
})

panels.forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
  })
})
