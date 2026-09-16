import './styles/base.css'
import { navShell } from './components/navShell'
import { renderPagePreloaderMarkup } from './components/pagePreloader'
import { initShellChrome } from './appBoot'
import { attachHeroVideo } from './components/heroVideo'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { getPageHeroVideoPaths } from './firebase/pageHeroVideos'
import { submitSupportForm } from './data/supportFormService'
import { createOrGetResonaThread } from './data/inboxService'
import { waitForInitialAuthState } from './firebase/auth'
import { openChatDock } from './components/chatDock'
import { ROUTES, authRoute } from './utils/routes'

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
            <h1>Contact Support</h1>
            <p>
              Get help with marketplace purchases, account access, product submissions,
              downloads, creator tools, and Melogic platform questions.
            </p>
            <div class="hero-actions">
              <button type="button" class="button button-accent" data-open-support-chat>Start Live Chat</button>
              <a class="button button-accent" href="#support-form">Use Native Form</a>
              <a class="button button-muted" href="mailto:support@melogicrecords.studio">Email Us</a>
            </div>
          </div>
        </div>
      </section>

    <section class="section support-section" id="support-form">
  <div class="section-inner">
    <div class="support-contact-layout">
      <div class="support-contact-copy">
        <p class="eyebrow">Native support form</p>
        <h2>Send a request directly to Melogic.</h2>
        <p>
          Use this form for account issues, marketplace questions, product problems,
          creator support, order help, or general platform questions.
        </p>
        <p>
          Your message will be sent directly into the Melogic admin panel.
        </p>
      </div>

      <form class="support-form" data-support-form>
        <div class="support-form-grid">
          <label>
            <span>Name</span>
            <input name="name" type="text" autocomplete="name" required maxlength="120" />
          </label>

          <label>
            <span>Email</span>
            <input name="email" type="email" autocomplete="email" required maxlength="254" />
          </label>

          <label>
            <span>Username</span>
            <input name="username" type="text" autocomplete="username" maxlength="80" placeholder="Optional" />
          </label>

          <label>
            <span>Subject</span>
            <input name="subject" type="text" required maxlength="180" />
          </label>
        </div>

        <label>
          <span>Message</span>
          <textarea name="message" rows="7" required maxlength="5000"></textarea>
        </label>

        <div class="support-form-actions">
          <button type="submit" class="button button-accent" data-support-submit>Send Support Request</button>
          <a class="button button-muted" href="mailto:support@melogicrecords.studio">Email Us Instead</a>
        </div>

        <p class="support-form-status" data-support-form-status aria-live="polite"></p>
      </form>
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

const supportForm = document.querySelector('[data-support-form]')
const supportFormStatus = document.querySelector('[data-support-form-status]')
const supportSubmitButton = document.querySelector('[data-support-submit]')

supportForm?.addEventListener('submit', async (event) => {
  event.preventDefault()

  const formData = new FormData(supportForm)

  if (supportFormStatus) {
    supportFormStatus.textContent = 'Sending support request...'
    supportFormStatus.dataset.status = 'loading'
  }

  if (supportSubmitButton) {
    supportSubmitButton.disabled = true
    supportSubmitButton.textContent = 'Sending...'
  }

  try {
    await submitSupportForm({
      name: formData.get('name'),
      email: formData.get('email'),
      username: formData.get('username'),
      subject: formData.get('subject'),
      message: formData.get('message')
    })

    supportForm.reset()

    if (supportFormStatus) {
      supportFormStatus.textContent = 'Support request sent. Melogic Support will contact you soon.'
      supportFormStatus.dataset.status = 'success'
    }
  } catch (error) {
    console.warn('[support] form submission failed', error)

    if (supportFormStatus) {
      supportFormStatus.textContent = error?.message || 'Could not send support request. Please email support@melogicrecords.studio instead.'
      supportFormStatus.dataset.status = 'error'
    }
  } finally {
    if (supportSubmitButton) {
      supportSubmitButton.disabled = false
      supportSubmitButton.textContent = 'Send Support Request'
    }
  }
})

document.querySelectorAll('[data-open-support-chat]').forEach((button) => {
  button.addEventListener('click', async (event) => {
    event.preventDefault()
    if (button.disabled) return

    button.disabled = true
    const originalLabel = button.textContent
    button.textContent = 'Opening chat...'
    try {
      const user = await waitForInitialAuthState()
      if (!user?.uid) {
        window.location.href = authRoute({ redirect: ROUTES.support })
        return
      }
      const thread = await createOrGetResonaThread()
      if (thread?.id) {
        openChatDock({
          mode: 'thread',
          threadId: thread.id,
          title: 'Resona'
        })
      }
    } catch (error) {
      console.warn('[support] live support chat failed', error)
      if (supportFormStatus) {
        supportFormStatus.textContent = error?.message || 'Could not open live support. Please use the support form.'
        supportFormStatus.dataset.status = 'error'
      }
    } finally {
      button.disabled = false
      button.textContent = originalLabel || 'Start Live Chat'
    }
  })
})

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
