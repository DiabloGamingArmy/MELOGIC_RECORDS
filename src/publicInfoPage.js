import './styles/base.css'
import { navShell } from './components/navShell'
import { renderPagePreloaderMarkup } from './components/pagePreloader'
import { renderSiteFooter } from './components/siteFooter'
import { initShellChrome } from './appBoot'
import { createCriticalAssetPreloader } from './components/pagePreloader'
import { ROUTES } from './utils/routes'

function paragraph(text) {
  return `<p>${text}</p>`
}

function list(items = []) {
  return `<ul>${items.map((item) => `<li>${item}</li>`).join('')}</ul>`
}

const PAGES = {
  about: {
    currentPage: 'about',
    eyebrow: 'About Melogic Records',
    title: 'Melogic Records helps producers buy, sell, and build with original audio tools.',
    description: 'Melogic Records is a creator-focused marketplace and production platform for digital audio products, browser-based studio tools, and music community workflows.',
    cta: { label: 'Browse the Marketplace', href: ROUTES.products },
    sections: [
      {
        title: 'What Melogic Records is',
        body: [
          paragraph('Melogic Records is a digital music marketplace and creative platform for producers, artists, sound designers, and independent audio creators. The public marketplace focuses on downloadable products such as sample packs, presets, loops, wavetables, drum kits, project files, tutorials, and production tools.'),
          paragraph('The platform also includes Melogic Studio and Soura, browser-based production tools that support composition, arrangement, audio editing, MIDI editing, and creator workflows. The marketplace and studio tools are connected by a simple idea: help musicians move from discovering useful sounds to finishing original work.')
        ]
      },
      {
        title: 'How the marketplace works',
        body: [
          paragraph('Creators publish products with descriptions, categories, previews, pricing, and delivery files. Buyers can browse public listings, preview available media, add paid items to cart, claim free items, and access purchased digital products from their library after checkout succeeds.'),
          paragraph('Melogic reviews products and account activity to reduce misleading listings, missing files, prohibited content, and copyright problems. Public product pages are designed to describe what is included before a buyer commits.')
        ]
      },
      {
        title: 'For buyers and creators',
        body: [
          list([
            'Buyers access eligible digital purchases through their Melogic library and order history.',
            'Creators can prepare audio products, manage submissions, and track marketplace activity from creator tools.',
            'Creator payouts are handled through supported payment infrastructure after a creator is eligible and configured.',
            'Support is available for account issues, product access, order questions, and creator publishing questions.'
          ])
        ]
      },
      {
        title: 'Safety and moderation',
        body: [
          paragraph('Melogic does not allow stolen packs, unauthorized copyrighted material, deceptive product descriptions, malware, hateful content, or products that exist mainly to mislead buyers. Reports and support requests help the team review issues when a listing, account, or download needs attention.')
        ]
      }
    ]
  },
  contact: {
    currentPage: 'contact',
    eyebrow: 'Contact',
    title: 'Contact Melogic Records',
    description: 'Reach Melogic Records for marketplace support, creator questions, product access issues, business inquiries, and policy requests.',
    cta: { label: 'Open Support', href: ROUTES.support },
    sections: [
      {
        title: 'Support and marketplace help',
        body: [
          paragraph('For order questions, missing downloads, account access, product problems, or creator submission questions, use the support page so the request includes the right context. You can also email support@melogicrecords.studio for direct help.'),
          paragraph('When contacting support about a purchase, include the account email used at checkout, the product name, the approximate purchase time, and a short description of what happened. Do not send passwords or payment card numbers.')
        ]
      },
      {
        title: 'Creator and business inquiries',
        body: [
          paragraph('Creators can contact Melogic about product reviews, payout setup, marketplace requirements, collaboration releases, and content policy questions. Business or partnership requests should describe the project, the organization or artist involved, and the preferred reply address.')
        ]
      },
      {
        title: 'Privacy and data requests',
        body: [
          paragraph(`For account data, deletion, privacy, or advertising cookie questions, start with the <a href="${ROUTES.privacy}">Privacy Policy</a> and contact support@melogicrecords.studio with the subject line "Privacy Request".`)
        ]
      }
    ]
  },
  privacy: {
    currentPage: 'privacy',
    eyebrow: 'Privacy',
    title: 'Privacy Policy',
    description: 'How Melogic Records handles account data, marketplace purchases, creator payouts, analytics, cookies, advertising, user content, and support communications.',
    cta: { label: 'Contact Support', href: ROUTES.support },
    sections: [
      {
        title: 'Information we collect',
        body: [
          paragraph('Melogic Records collects account data such as your name, username, email address, profile details, authentication identifiers, security settings, and preferences. If you buy or sell on the marketplace, we process order records, product access records, cart activity, download eligibility, creator profile details, payout status, and support history related to those transactions.'),
          paragraph('Creators may provide product descriptions, previews, downloadable files, prices, licenses, tags, media, and payout onboarding information. Payment providers may collect and process additional payment or identity information under their own terms.')
        ]
      },
      {
        title: 'Marketplace purchases and creator payouts',
        body: [
          paragraph('Purchase and fulfillment records are used to deliver digital products, prevent duplicate fulfillment failures, help with order support, detect abuse, and maintain accurate buyer and seller histories. Creator payout data is used to confirm eligibility, connect creators to payment infrastructure, and support tax, compliance, fraud prevention, and dispute workflows handled by Melogic or payment partners.')
        ]
      },
      {
        title: 'Analytics, cookies, and advertising',
        body: [
          paragraph('Melogic may use analytics and operational logs to understand site performance, product browsing, broken flows, checkout reliability, and security events. Cookies or similar storage may be used for login sessions, cart state, preferences, security checks, and product experience features.'),
          paragraph('Public marketplace or content pages may use advertising cookies or requests from Google AdSense. Google and its partners may use cookies to personalize or measure ads depending on your settings and applicable law. Ads are not intended for private checkout, account billing, library, admin, inbox, or private support communication pages.')
        ]
      },
      {
        title: 'User-generated content and support communications',
        body: [
          paragraph('Product listings, profile text, comments, community posts, previews, and uploaded media may be user-generated content. Public submissions can be viewed by other users and may be indexed or shared depending on the page. Support communications, reports, and admin messages are used to answer requests, enforce policies, improve product safety, and document decisions.')
        ]
      },
      {
        title: 'Data deletion and contact process',
        body: [
          paragraph('You can request help updating or deleting account data by contacting support@melogicrecords.studio. Some records may need to be retained for security, fraud prevention, legal compliance, tax, payment, dispute, or marketplace integrity reasons. Include the account email and a clear description of the request, but do not include passwords or full payment details.')
        ]
      }
    ]
  },
  terms: {
    currentPage: 'terms',
    eyebrow: 'Terms',
    title: 'Terms of Service',
    description: 'Terms for Melogic Records accounts, marketplace buying and selling, creator responsibilities, digital products, payments, refunds, moderation, and intellectual property.',
    cta: { label: 'Creator Guidelines', href: ROUTES.creatorGuidelines },
    sections: [
      {
        title: 'Accounts and platform use',
        body: [
          paragraph('You are responsible for keeping your account credentials secure and for activity that occurs through your account. Melogic may limit, suspend, or remove accounts that abuse the platform, violate policies, attempt fraud, interfere with security, or harm other users.'),
          paragraph('Melogic may change platform features, product review processes, marketplace tools, studio features, fees, policies, or availability over time as the service develops.')
        ]
      },
      {
        title: 'Marketplace buying and selling',
        body: [
          paragraph('Buyers purchase or claim digital products based on the listing information available at the time of checkout. Creators are responsible for accurate product descriptions, lawful files, working previews when provided, proper category selection, and delivery files that match the listing.'),
          paragraph('Digital products may include sample packs, presets, wavetables, loops, project files, MIDI packs, tutorials, plugins, tools, and related audio resources. Unless a listing clearly says otherwise, buying a product does not transfer ownership of the creator brand, source intellectual property, or platform technology.')
        ]
      },
      {
        title: 'Payments, refunds, and payouts',
        body: [
          paragraph('Payments may be processed by third-party payment providers. Melogic does not ask users to send full card details through support. Refund handling is described in the Refund Policy and may depend on whether the issue involves failed access, duplicate purchase, incorrect files, or a creator/vendor issue.'),
          paragraph('Creators must meet payout eligibility and payment-provider requirements before receiving payouts. Melogic may delay or withhold payout activity when fraud, policy violations, disputes, missing configuration, or legal requirements require review.')
        ]
      },
      {
        title: 'Prohibited content and intellectual property',
        body: [
          paragraph('Users may not upload stolen samples, unauthorized copyrighted works, misleading products, malware, hateful content, illegal content, private data they do not have permission to share, or files designed to deceive buyers. Creators must have the rights needed to sell or distribute every product they publish.'),
          paragraph('Melogic respects intellectual property rights and may remove listings, restrict accounts, or request proof of rights when ownership or licensing is disputed.')
        ]
      },
      {
        title: 'Moderation and enforcement',
        body: [
          paragraph('Melogic may review listings, reports, support requests, payment events, and account behavior to enforce policies. Enforcement can include content edits, product removal, access limits, payout holds, account suspension, or other actions needed to protect buyers, creators, and the platform.')
        ]
      }
    ]
  },
  'refund-policy': {
    currentPage: 'refund-policy',
    eyebrow: 'Refund Policy',
    title: 'Refund Policy for Digital Products',
    description: 'How Melogic Records handles digital product refund requests, failed delivery, access problems, duplicate purchases, and creator or vendor issues.',
    cta: { label: 'Contact Support', href: ROUTES.support },
    sections: [
      {
        title: 'Digital product refund rules',
        body: [
          paragraph('Most marketplace items are digital products delivered through account access, download permissions, or library fulfillment. Because digital files can be accessed quickly, refund requests are reviewed based on the reason for the request, product status, access history, and applicable consumer protection requirements.'),
          paragraph('A change of mind after successful access may not always qualify for a refund. Melogic will still review support requests when a listing was materially misleading, files were missing, or the buyer could not access what was purchased.')
        ]
      },
      {
        title: 'Failed delivery, access issues, and duplicate purchases',
        body: [
          paragraph('If checkout succeeds but the product does not appear in your library, the download cannot be opened, or access fails, contact support with the order details. Melogic will first try to repair access or redeliver the product. If access cannot be repaired, a refund or other resolution may be offered.'),
          paragraph('Duplicate purchase requests are reviewed when the same account or buyer accidentally buys the same digital product more than once. Include both order times or receipts if available.')
        ]
      },
      {
        title: 'Creator or vendor issues',
        body: [
          paragraph('If a product appears to contain incorrect files, infringing material, broken packages, or content that does not match the listing, Melogic may contact the creator, remove or pause the listing, repair the deliverable, issue a refund, or take enforcement action depending on the situation.')
        ]
      },
      {
        title: 'How to request help',
        body: [
          paragraph('Use the support page or email support@melogicrecords.studio. Include your account email, product name, order date, and a concise explanation of the issue. Do not include passwords or full payment card numbers.')
        ]
      }
    ]
  },
  'creator-guidelines': {
    currentPage: 'creator-guidelines',
    eyebrow: 'Creator Guidelines',
    title: 'Creator Guidelines for Selling on Melogic Records',
    description: 'Guidelines for allowed audio products, original content, accurate descriptions, pricing, payout eligibility, review, moderation, and legal requirements.',
    cta: { label: 'Create a Product', href: ROUTES.newProduct },
    sections: [
      {
        title: 'Allowed digital audio products',
        body: [
          paragraph('Creators may sell or distribute original digital audio products such as sample packs, drum kits, loops, one-shots, presets, wavetable packs, MIDI packs, project files, tutorials, production templates, software tools, and related resources for music creation.'),
          paragraph('Listings should clearly explain what is included, the file formats, required software where relevant, license notes, preview limitations, and any compatibility details a buyer needs before purchase.')
        ]
      },
      {
        title: 'Originality, rights, and prohibited content',
        body: [
          paragraph('Do not upload stolen packs, unauthorized copyrighted samples, leaked presets, ripped project files, uncleared artist material, malware, private personal data, or content that you do not have legal permission to sell or distribute.'),
          paragraph('Creators are responsible for making sure their product descriptions, artwork, previews, pricing, and deliverables are accurate. Do not use misleading claims, fake scarcity, impersonation, or product pages that hide important requirements.')
        ]
      },
      {
        title: 'Pricing, review, and moderation',
        body: [
          paragraph('Creators choose pricing within available platform controls. Melogic may review products before or after publication for quality, safety, legal risk, and marketplace accuracy. Products can be edited, paused, rejected, removed, or escalated when they violate guidelines.'),
          paragraph('Creators must meet age, legal, tax, payment-provider, and payout eligibility requirements that apply to their location and account. Payout access may require identity or business verification through supported providers.')
        ]
      },
      {
        title: 'Support expectations',
        body: [
          paragraph('Creators should respond in good faith when Melogic asks for missing files, ownership proof, corrected descriptions, or buyer issue details. Repeated unresolved complaints, deceptive listings, or rights violations may affect product visibility or account status.')
        ]
      }
    ]
  },
  'ad-policy': {
    currentPage: 'ad-policy',
    eyebrow: 'Ad Policy',
    title: 'Advertising Policy',
    description: 'Where Melogic Records may show ads, how ads are labeled, where ads are not shown, and how advertising cookies connect to the privacy policy.',
    cta: { label: 'Privacy Policy', href: ROUTES.privacy },
    sections: [
      {
        title: 'Where ads may appear',
        body: [
          paragraph('Melogic may show ads on public marketplace or content pages that are designed for browsing. Marketplace ad areas are separated from product cards, clearly labeled as Advertisement or Sponsored Links, and should not be presented as creator products or purchase buttons.'),
          paragraph('Ads are not intended to appear on private messaging, checkout, account billing, library, orders, admin, or private support communication pages.')
        ]
      },
      {
        title: 'User safety and accidental clicks',
        body: [
          paragraph('Users should not click ads just to support Melogic Records. Ads should only be clicked when the user is genuinely interested in the advertiser. Ad placements should not block navigation, hide content, imitate product actions, or sit so close to buy/download buttons that accidental clicks become likely.')
        ]
      },
      {
        title: 'Personalization and cookies',
        body: [
          paragraph(`Google AdSense or other ad providers may use cookies or similar technologies for measurement, fraud prevention, and personalization depending on user settings and applicable law. See the <a href="${ROUTES.privacy}">Privacy Policy</a> for more detail about analytics, cookies, and advertising cookies.`)
        ]
      }
    ]
  },
  faq: {
    currentPage: 'faq',
    eyebrow: 'Support FAQ',
    title: 'Frequently Asked Questions',
    description: 'Answers about Melogic Records marketplace purchases, digital downloads, creator selling, payout setup, support, moderation, and advertising.',
    cta: { label: 'Contact Support', href: ROUTES.support },
    sections: [
      {
        title: 'Buying and product access',
        body: [
          paragraph('Melogic marketplace products can include sample packs, drum kits, loops, one-shots, presets, wavetable packs, MIDI packs, project files, tutorials, and creative production tools. Paid checkout and free claims add eligible products to your Melogic library.'),
          paragraph('If checkout succeeds but a product does not appear in your library, contact support with the product name, account email, and order time so Melogic can repair access or investigate fulfillment.')
        ]
      },
      {
        title: 'Creator selling and payouts',
        body: [
          paragraph('Creators can prepare product listings, upload deliverables and preview media, set pricing, and submit products for marketplace review. Creators must own or have permission to distribute every file they upload.'),
          paragraph('Creator payouts require supported payment setup and eligibility review. Payment infrastructure handles payout delivery after account configuration, fraud checks, and any required compliance steps.')
        ]
      },
      {
        title: 'Reports, moderation, and ads',
        body: [
          paragraph('Use support to report missing downloads, incorrect files, inaccurate descriptions, or suspected copyright issues. Melogic may repair access, contact the creator, pause a listing, issue a refund when appropriate, or take moderation action.'),
          paragraph('Ads may appear on public marketplace or content pages and should be labeled as advertisements. Ads are not intended for checkout, account billing, library, admin, inbox, or private support communication pages.')
        ]
      }
    ]
  }
}

const SUPPORT_DOC_LINKS = [
  ['Support Home', ROUTES.support, 'support'],
  ['About Melogic', ROUTES.about, 'about'],
  ['Contact', ROUTES.contact, 'contact'],
  ['FAQ', ROUTES.faq, 'faq'],
  ['Privacy Policy', ROUTES.privacy, 'privacy'],
  ['Terms of Service', ROUTES.terms, 'terms'],
  ['Refund Policy', ROUTES.refundPolicy, 'refund-policy'],
  ['Creator Guidelines', ROUTES.creatorGuidelines, 'creator-guidelines'],
  ['Advertising Policy', ROUTES.adPolicy, 'ad-policy']
]

function normalizePageKey() {
  const fromDataset = document.body?.dataset?.page || ''
  if (PAGES[fromDataset]) return fromDataset
  const parts = window.location.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  const path = parts[0] === 'support' ? parts[1] : parts[0]
  return PAGES[path] ? path : 'about'
}

function renderSection(section) {
  return `
    <section class="support-doc-block">
      <h2>${section.title}</h2>
      <div class="support-doc-copy">${section.body.join('')}</div>
    </section>
  `
}

function renderSupportDocSidebar(activeKey) {
  return `
    <aside class="support-doc-sidebar" aria-label="Support documentation">
      <a class="support-doc-back-link" href="${ROUTES.support}">Support Center</a>
      <nav>
        ${SUPPORT_DOC_LINKS.map(([label, href, key]) => `<a class="support-doc-nav-link ${key === activeKey ? 'is-active' : ''}" href="${href}" ${key === activeKey ? 'aria-current="page"' : ''}>${label}</a>`).join('')}
      </nav>
    </aside>
  `
}

function mountPublicInfoPage() {
  const pageKey = normalizePageKey()
  const page = PAGES[pageKey]
  const app = document.querySelector('#app')
  if (!app) return

  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'support' })}
    <main class="support-doc-page">
      <section class="section support-doc-section">
        <div class="section-inner support-doc-layout">
          ${renderSupportDocSidebar(pageKey)}
          <article class="support-doc-article">
            <header class="support-doc-header">
              <p class="eyebrow">${page.eyebrow}</p>
              <h1>${page.title}</h1>
              <p>${page.description}</p>
            </header>
            ${page.sections.map(renderSection).join('')}
          </article>
        </div>
      </section>
    </main>
    ${renderSiteFooter()}
  `
}

mountPublicInfoPage()
const logoReadyPromise = initShellChrome()
createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise: Promise.resolve(true) })
