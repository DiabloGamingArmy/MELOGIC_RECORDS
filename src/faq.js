import './styles/base.css'
import { navShell } from './components/navShell'
import { renderPagePreloaderMarkup } from './components/pagePreloader'
import { initShellChrome } from './appBoot'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { ROUTES } from './utils/routes'

const faqs = [
  {
    title: 'What can I buy on Melogic Records?',
    body: 'The marketplace is built for digital audio products such as sample packs, drum kits, loops, one-shots, presets, wavetable packs, MIDI packs, project files, tutorials, and creative production tools. Some listings may include physical or limited items when clearly marked.'
  },
  {
    title: 'How do I access a purchased product?',
    body: 'After checkout succeeds, eligible digital purchases are added to your account library. If a purchase does not appear, contact support with the product name, account email, and order time so Melogic can repair access or investigate fulfillment.'
  },
  {
    title: 'Can creators sell their own sounds?',
    body: 'Yes. Creators can prepare product listings, upload deliverables and preview media, set pricing, and submit products for marketplace review. Every creator is responsible for having the rights needed to sell the files they upload.'
  },
  {
    title: 'How do creator payouts work?',
    body: 'Creator payouts require supported payment setup and eligibility review. At a high level, Melogic tracks marketplace orders and creator balances, then payment infrastructure handles payout delivery after account configuration, fraud checks, and any required compliance steps.'
  },
  {
    title: 'What if a product is missing files or seems misleading?',
    body: 'Use the support page to report missing downloads, incorrect files, inaccurate descriptions, or suspected copyright issues. Melogic may repair access, contact the creator, pause a listing, issue a refund when appropriate, or take moderation action.'
  },
  {
    title: 'Does Melogic show ads?',
    body: 'Ads may appear on public marketplace or content pages, and they should be labeled as advertisements. Ads are not intended for checkout, account billing, library, admin, inbox, or private support communication pages.'
  }
]

function mountFaqPage() {
  const app = document.querySelector('#app')
  if (!app) return

  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'faq' })}
    <main class="info-page">
      <section class="info-hero section">
        <div class="section-inner info-hero-inner">
          <p class="eyebrow">Melogic FAQ</p>
          <h1>Marketplace, downloads, creator tools, and support questions.</h1>
          <p>Find practical answers about buying digital audio products, selling original content, payout setup, product review, support, and safe ad placement on Melogic Records.</p>
          <div class="hero-actions">
            <a class="button button-accent" href="${ROUTES.products}">Browse Products</a>
            <a class="button button-muted" href="${ROUTES.support}">Contact Support</a>
          </div>
        </div>
      </section>
      <section class="info-section">
        <div class="section-inner info-section-inner">
          <h2>Common questions</h2>
          <div class="info-section-copy">
            ${faqs.map((faq) => `<article><h3>${faq.title}</h3><p>${faq.body}</p></article>`).join('')}
          </div>
        </div>
      </section>
    </main>
  `
}

mountFaqPage()
const logoReadyPromise = initShellChrome()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise: Promise.resolve(true) })
