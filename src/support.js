import './styles/base.css'
import { navShell } from './components/navShell'
import { renderPagePreloaderMarkup } from './components/pagePreloader'
import { initShellChrome } from './components/assetChrome'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import { ROUTES } from './utils/routes'

function supportCard({ eyebrow, title, body, actions = [] }) {
  return `
    <article class="support-card">
      <p class="support-card-eyebrow">${eyebrow}</p>
      <h2>${title}</h2>
      <p>${body}</p>
      ${actions.length ? `
        <div class="support-card-actions">
          ${actions.map((action) => `
            <a class="button ${action.variant === 'muted' ? 'button-muted' : 'button-accent'}" href="${action.href}">
              ${action.label}
            </a>
          `).join('')}
        </div>
      ` : ''}
    </article>
  `
}

function mountSupportPage() {
  const app = document.querySelector('#app')
  if (!app) return

  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'support' })}

    <main>
      <section class="standard-hero section support-hero" id="support-top">
        <div class="hero-media" aria-hidden="true">
          <video
            id="support-hero-video"
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
            <p class="eyebrow">Melogic Support</p>
            <h1>Support for creators, customers, and collaborators.</h1>
            <p>
              Get help with marketplace purchases, account access, product submissions,
              downloads, creator tools, and Melogic platform questions.
            </p>
            <div class="hero-actions">
              <a class="button button-accent" href="${ROUTES.forms}">Submit a Support Request</a>
              <a class="button button-muted" href="${ROUTES.inbox}">Open Inbox</a>
            </div>
          </div>
        </div>
      </section>

      <section class="section support-section">
        <div class="section-inner">
          <div class="section-heading">
            <p class="eyebrow">Where to start</p>
            <h2>Choose the support path that matches your issue.</h2>
            <p>
              Melogic is still growing, so support is being organized around clear request
              types instead of scattered messages.
            </p>
          </div>

          <div class="support-grid">
            ${supportCard({
              eyebrow: 'Accounts',
              title: 'Login, security, and profile help',
              body: 'Use this for account access, password issues, profile problems, security concerns, or verification questions.',
              actions: [
                { label: 'Account Security', href: ROUTES.accountSecurity },
                { label: 'Edit Profile', href: ROUTES.editProfile, variant: 'muted' }
              ]
            })}

            ${supportCard({
              eyebrow: 'Marketplace',
              title: 'Orders, downloads, and product issues',
              body: 'Use this for missing downloads, order questions, product access, incorrect files, or marketplace purchase problems.',
              actions: [
                { label: 'View Orders', href: ROUTES.orders },
                { label: 'Open Library', href: ROUTES.library, variant: 'muted' }
              ]
            })}

            ${supportCard({
              eyebrow: 'Creators',
              title: 'Selling and product submission help',
              body: 'Use this for seller setup, product review questions, file requirements, pricing, collaboration products, and marketplace publishing.',
              actions: [
                { label: 'Product Dashboard', href: ROUTES.productDashboard },
                { label: 'Create Product', href: ROUTES.newProduct, variant: 'muted' }
              ]
            })}

            ${supportCard({
              eyebrow: 'Direct support',
              title: 'Need help from Melogic?',
              body: 'Submit a support form or send a message through your inbox. Phone support and AI-assisted call routing are being tested internally.',
              actions: [
                { label: 'Submit Form', href: ROUTES.forms },
                { label: 'Inbox', href: ROUTES.inbox, variant: 'muted' }
              ]
            })}
          </div>
        </div>
      </section>

      <section class="section support-section support-status-section">
        <div class="section-inner">
          <div class="support-status-panel">
            <div>
              <p class="eyebrow">Support status</p>
              <h2>Phone support is in active development.</h2>
              <p>
                Melogic is currently testing native browser-based call support for inbound
                conversations. For now, written requests are the most reliable way to reach support.
              </p>
            </div>
            <div class="support-status-list">
              <div>
                <strong>Marketplace support</strong>
                <span>Use forms or inbox for order and product issues.</span>
              </div>
              <div>
                <strong>Creator support</strong>
                <span>Use product dashboard tools for submissions and review status.</span>
              </div>
              <div>
                <strong>Phone support</strong>
                <span>Incoming call infrastructure is being tested before public rollout.</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  `
}

mountSupportPage()

const logoReadyPromise = initShellChrome()

const heroPaths = getPageHeroVideoPaths('support')
let heroReadyPromise = Promise.resolve(false)
if (heroPaths) {
  heroReadyPromise = attachHeroVideo(document.querySelector('#support-hero-video'), {
    webmPath: heroPaths.webm,
    mp4Path: heroPaths.mp4,
    warningKey: 'support'
  })
}
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise })