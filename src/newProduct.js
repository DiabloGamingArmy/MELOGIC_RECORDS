import './styles/base.css'
import './styles/newProduct.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import {
  addProductContributorRequest,
  buildProductPayload,
  getProductById,
  isPlaceholderProductId,
  recalculateAcceptedContributors,
  removeProductContributorRequest,
  requestProductReview,
  saveProductDraft
} from './data/productService'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from './firebase/firestore'
import { ROUTES, productRoute } from './utils/routes'
import { searchProfilesByUsername } from './data/profileSearchService'
import { getMarketplacePricingSettings } from './data/marketplaceSettingsService'
import { getAgreementMarkdown, getMarketplaceSellerAgreementConfig } from './data/legalAgreementService'

const PRODUCT_SECTIONS = [
  { key: 'product-info', label: 'Product Info' },
  { key: 'media-upload', label: 'Media & Upload' },
  { key: 'contributors', label: 'Contributors' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'agreements', label: 'Agreements' },
  { key: 'publish', label: 'Publish' }
]

const PRODUCT_TYPE_OPTIONS = [
  'Single Sample', 'Sample Pack', 'Drum Kit', 'Vocal Pack', 'Preset Bank', 'Wavetable Pack',
  'MIDI Pack', 'Project File', 'Plugin / VST', 'Course / Tutorial', 'Release', 'Other'
]

const USAGE_LICENSE_OPTIONS = ['Standard License', 'Royalty Free', 'Custom License', 'Exclusive License']

const app = document.querySelector('#app')
app.innerHTML = `
  ${navShell({ currentPage: 'products' })}
  <main>
    <section class="section product-editor-shell">
      <div class="section-inner" data-product-editor-root>
        <article class="product-editor-card"><p>Loading creator workspace...</p></article>
      </div>
    </section>
  </main>
`

initShellChrome()

const editorRoot = document.querySelector('[data-product-editor-root]')
let editorState = {
  user: null,
  slugLocked: false,
  mediaFiles: {
    cover: null,
    thumbnail: null,
    gallery: [],
    previewAudio: [],
    previewVideo: [],
    deliverables: [],
    folderDeliverables: []
  },
  mediaPreview: {
    cover: '',
    gallery: []
  },
  contributorUI: {
    search: '',
    role: '',
    filter: 'all',
    results: [],
    rows: []
  },
  marketplacePricingSettings: null,
  agreement: {
    config: null,
    markdown: '',
    loading: false,
    error: '',
    signedName: '',
    accepting: false
  },
  status: { message: '', state: 'info' },
  creatorProfile: null,
  draft: null,
  requestedProductId: new URLSearchParams(window.location.search).get('id') || ''
}

function getCreatorIdentity(user = null, profile = null, draft = {}) {
  const profileDisplayName = String(profile?.displayName || '').trim()
  const profileUsername = String(profile?.username || profile?.handle || '').trim()
  const authDisplayName = String(user?.displayName || '').trim()
  const draftDisplayName = String(draft?.artistName || '').trim()
  const draftUsername = String(draft?.artistUsername || '').trim()
  const artistId = user?.uid || String(draft?.artistId || '')
  return {
    artistId,
    artistName: profileDisplayName || authDisplayName || draftDisplayName || 'Creator',
    artistUsername: profileUsername || draftUsername,
    artistProfilePath: artistId ? String(draft?.artistProfilePath || `profiles/${artistId}`) : String(draft?.artistProfilePath || '')
  }
}

function applyCreatorIdentity(draft = {}, user = null, profile = null) {
  return { ...(draft || {}), ...getCreatorIdentity(user, profile, draft) }
}

async function fetchPublicCreatorProfile(uid = '') {
  if (!db || !uid) return null
  try {
    const snapshot = await getDoc(doc(db, 'profiles', uid))
    return snapshot.exists() ? (snapshot.data() || null) : null
  } catch {
    return null
  }
}

function createEmptyProductDraft(user = null, profile = null) {
  const creator = getCreatorIdentity(user, profile)
  return {
    id: '',
    title: '',
    slug: '',
    shortDescription: '',
    description: '',
    productType: 'Single Sample',
    artistId: creator.artistId,
    artistName: creator.artistName,
    artistUsername: creator.artistUsername,
    artistProfilePath: creator.artistProfilePath,
    status: 'draft',
    visibility: 'private',
    price: '0',
    currency: 'USD',
    isFree: true,
    featured: false,
    saleEnabled: false,
    usageLicense: 'Standard License',
    version: '',
    licensePath: '',
    categories: '',
    genres: '',
    tags: '',
    formatNotes: '',
    compatibilityNotes: '',
    includedFiles: '',
    contributorNames: '',
    contributorIds: '',
    pendingContributorIds: [],
    contributorRequestCount: 0,
    sellerAgreement: null,
    sellerAgreementAccepted: false,
    sellerAgreementVersion: '',
    downloadPath: '',
    previewAudioPaths: '',
    previewVideoPaths: '',
    releasedAt: '',
    storefrontVisible: true,
    galleryPaths: '',
    coverPath: '',
    thumbnailPath: '',
    coverURL: '',
    thumbnailURL: '',
    updatedAt: ''
  }
}

function readSectionHash() {
  const hash = window.location.hash.replace('#', '')
  if (hash === 'preview') {
    window.location.hash = 'media-upload'
    return 'media-upload'
  }
  return PRODUCT_SECTIONS.some((item) => item.key === hash) ? hash : 'media-upload'
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function getDraftStorageKey(user) {
  return `melogic:new-product-draft:${user?.uid || 'anonymous'}:v2`
}

function saveDraftState() {
  if (!editorState.user || !editorState.draft) return
  try {
    sessionStorage.setItem(getDraftStorageKey(editorState.user), JSON.stringify({ draft: editorState.draft, slugLocked: editorState.slugLocked, updatedAt: Date.now() }))
  } catch {
    // ignore
  }
}

function loadDraftState(user) {
  const empty = createEmptyProductDraft(user, editorState.creatorProfile)
  if (!user) return empty
  try {
    const raw = sessionStorage.getItem(getDraftStorageKey(user))
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    editorState.slugLocked = Boolean(parsed?.slugLocked)
    const hydrated = applyCreatorIdentity({ ...empty, ...(parsed?.draft || {}) }, user, editorState.creatorProfile)
    if (isPlaceholderProductId(hydrated.id)) hydrated.id = ''
    return hydrated
  } catch {
    return empty
  }
}

function setStatus(message, state = 'info') {
  editorState.status = { message, state }
}

function updateDraftField(key, value) {
  if (!editorState.draft) return
  editorState.draft[key] = value
  saveDraftState()
}

function formatBytes(size = 0) {
  const kb = Number(size || 0) / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(2)} MB`
}

function gatherFileEntries() {
  const rows = []
  const pushRows = (files, category, isPublicPreview, isDeliverable) => {
    Array.from(files || []).forEach((file, index) => {
      rows.push({
        id: `${category}-${index}-${file.name}`,
        name: file.name,
        displayPath: file.webkitRelativePath || file.name,
        sizeBytes: file.size || 0,
        kind: file.type || 'file',
        category,
        isPublicPreview,
        isDeliverable,
        role: ''
      })
    })
  }
  pushRows(editorState.mediaFiles.gallery, 'Listing Media', true, false)
  pushRows(editorState.mediaFiles.previewAudio, 'Preview Media', true, false)
  pushRows(editorState.mediaFiles.previewVideo, 'Preview Media', true, false)
  pushRows(editorState.mediaFiles.deliverables, 'Deliverables', false, true)
  pushRows(editorState.mediaFiles.folderDeliverables, 'Deliverables', false, true)
  return rows
}

function tagValuesFor(field) {
  return String(editorState.draft?.[field] || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function setTagValues(field, values = []) {
  updateDraftField(field, values.filter(Boolean).join(', '))
}

function tagEditorMarkup(field, label, placeholder) {
  const values = tagValuesFor(field)
  return `
    <div class="product-info-field">
      <label>${label}</label>
      <div class="tag-editor" data-tag-editor="${field}">
        <div class="tag-pill-row">
          ${values.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}<button type="button" data-remove-tag="${escapeHtml(tag)}" data-tag-field="${field}">×</button></span>`).join('')}
        </div>
        <input type="text" data-tag-input="${field}" placeholder="${escapeHtml(placeholder)}" />
      </div>
    </div>
  `
}

function formattedEditDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
}

function normalizePriceToCents(value) {
  const raw = String(value ?? '').replace(/[^\d.]/g, '')
  if (!raw) return 0
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.max(0, Math.round(parsed * 100))
}

function centsToPriceInput(cents = 0) {
  const normalized = Math.max(0, Number(cents || 0))
  return (normalized / 100).toFixed(2)
}

function moneyFormatter(currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 })
  } catch {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
}

function getPricingSettings() {
  return editorState.marketplacePricingSettings || {
    defaultCurrency: 'USD',
    supportedCurrencies: ['USD'],
    platformFeeLabel: 'Melogic Records Fee',
    platformFeeBps: 1500,
    processorFeeLabel: 'Stripe Fee',
    processorPercentBps: 290,
    processorFixedFeeCents: 30,
    salesMilestones: [100, 1000, 100000],
    transactionNotice: {
      title: 'Transactions Notice:',
      commission: 'Commission: Our platform applies a standard 15% commission on all digital product sales.',
      processingFees: 'Processing Fees: Transactions are subject to standard third-party processing fees, which are deducted prior to payout.',
      supportedMethods: 'Supported Methods: Buyers can purchase via Credit Card, Apple Pay, and PayPal. Sellers can receive payouts via Direct Deposit or PayPal.'
    }
  }
}

function renderPricingPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  const settings = getPricingSettings()
  const currency = String(draft.currency || settings.defaultCurrency || 'USD').toUpperCase()
  const supportedCurrencies = Array.isArray(settings.supportedCurrencies) && settings.supportedCurrencies.length ? settings.supportedCurrencies : [currency]
  const formatter = moneyFormatter(currency)
  const priceCents = normalizePriceToCents(draft.price)
  const platformFeeCents = priceCents <= 0 ? 0 : Math.round((priceCents * Number(settings.platformFeeBps || 0)) / 10000)
  const processorFeeCents = priceCents <= 0 ? 0 : Math.round((priceCents * Number(settings.processorPercentBps || 0)) / 10000) + Number(settings.processorFixedFeeCents || 0)
  const sellerNetPerSaleCentsRaw = priceCents - platformFeeCents - processorFeeCents
  const sellerNetPerSaleCents = Math.max(0, sellerNetPerSaleCentsRaw)
  const warning = priceCents > 0 && sellerNetPerSaleCentsRaw < 0
  const salesMilestones = Array.isArray(settings.salesMilestones) && settings.salesMilestones.length ? settings.salesMilestones : [100, 1000, 100000]
  const currencyControlDisabled = supportedCurrencies.length <= 1 ? 'disabled' : ''

  // TODO: frontend pricing calculator is informational only; backend payout and checkout logic must remain the source of truth.
  return `
    <section class="pricing-workspace">
      <div class="pricing-main-grid">
        <article class="pricing-input-column">
          <div class="pricing-price-field">
            <div class="pricing-field-header">
              <label for="pricing-product-price">Product Price (${escapeHtml(currency)})</label>
              <select class="pricing-currency-action" data-pricing-currency ${currencyControlDisabled}>
                ${supportedCurrencies.map((code) => `<option value="${escapeHtml(code)}" ${code === currency ? 'selected' : ''}>Change Currency · ${escapeHtml(code)}</option>`).join('')}
              </select>
            </div>
            <input id="pricing-product-price" type="number" min="0" step="0.01" inputmode="decimal" name="price" value="${escapeHtml(centsToPriceInput(priceCents))}" data-pricing-price-input />
            <label class="pricing-free-toggle"><input type="checkbox" data-pricing-free-toggle ${priceCents === 0 || draft.isFree ? 'checked' : ''} /> Free product</label>
          </div>
          <div class="pricing-fee-row">
            <span>${escapeHtml(settings.platformFeeLabel)}: ${(Number(settings.platformFeeBps || 0) / 100).toFixed(2)}%</span>
            <strong>${formatter.format(platformFeeCents / 100)}</strong>
          </div>
          <div class="pricing-fee-row">
            <span>${escapeHtml(settings.processorFeeLabel)}: ${(Number(settings.processorPercentBps || 0) / 100).toFixed(2)}% + ${formatter.format(Number(settings.processorFixedFeeCents || 0) / 100)}</span>
            <strong>${formatter.format(processorFeeCents / 100)}</strong>
          </div>
          <div class="pricing-price-field">
            <div class="pricing-field-header">
              <label>Final Listing Price (${escapeHtml(currency)})</label>
              <button type="button" class="pricing-currency-action" disabled>Change Currency</button>
            </div>
            <input type="text" readonly value="${escapeHtml(centsToPriceInput(priceCents))}" />
          </div>
          ${warning ? '<p class="pricing-warning">Fees exceed listing price. Seller net is clamped to $0.00 for calculator display.</p>' : ''}
        </article>

        <article class="pricing-calculator-column">
          <div class="pricing-calculator">
            <h3>Profit Calculator:</h3>
            ${salesMilestones.map((milestone) => `
              <div class="pricing-calculator-row">
                <p>${Number(milestone).toLocaleString('en-US')} Sales:</p>
                <strong>${formatter.format((sellerNetPerSaleCents * Number(milestone || 0)) / 100)}</strong>
              </div>
            `).join('')}
          </div>
        </article>

        <aside class="pricing-notice">
          <h4>${escapeHtml(settings.transactionNotice?.title || 'Transactions Notice:')}</h4>
          <p>${escapeHtml(settings.transactionNotice?.commission || '')}</p>
          <p>${escapeHtml(settings.transactionNotice?.processingFees || '')}</p>
          <p>${escapeHtml(settings.transactionNotice?.supportedMethods || '')}</p>
        </aside>
      </div>
    </section>
  `
}

function formatAgreementAcceptedDate(value = '') {
  if (!value) return ''
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return ''
  return parsed.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

function renderSafeInlineMarkdown(text = '') {
  const escaped = escapeHtml(text)
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
}

function renderAgreementMarkdown(markdown = '') {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let paragraph = []
  let listType = ''

  const flushParagraph = () => {
    if (!paragraph.length) return
    html.push(`<p>${renderSafeInlineMarkdown(paragraph.join(' '))}</p>`)
    paragraph = []
  }

  const closeList = () => {
    if (!listType) return
    html.push(listType === 'ol' ? '</ol>' : '</ul>')
    listType = ''
  }

  lines.forEach((line) => {
    const trimmed = line.trim()
    const orderedMatch = trimmed.match(/^\d+\.\s+(.*)$/)
    const unorderedMatch = trimmed.match(/^[-*]\s+(.*)$/)
    if (!trimmed) {
      flushParagraph()
      closeList()
      return
    }
    if (/^---+$/.test(trimmed)) {
      flushParagraph()
      closeList()
      html.push('<hr />')
      return
    }
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.*)$/)
    if (headingMatch) {
      flushParagraph()
      closeList()
      const level = Math.min(4, headingMatch[1].length)
      html.push(`<h${level}>${renderSafeInlineMarkdown(headingMatch[2])}</h${level}>`)
      return
    }
    if (orderedMatch) {
      flushParagraph()
      if (listType !== 'ol') {
        closeList()
        html.push('<ol>')
        listType = 'ol'
      }
      html.push(`<li>${renderSafeInlineMarkdown(orderedMatch[1])}</li>`)
      return
    }
    if (unorderedMatch) {
      flushParagraph()
      if (listType !== 'ul') {
        closeList()
        html.push('<ul>')
        listType = 'ul'
      }
      html.push(`<li>${renderSafeInlineMarkdown(unorderedMatch[1])}</li>`)
      return
    }
    closeList()
    paragraph.push(trimmed)
  })

  flushParagraph()
  closeList()
  return html.join('')
}

function sellerAgreementState() {
  const config = editorState.agreement.config || {}
  const current = editorState.draft?.sellerAgreement || null
  const acceptedVersion = String(editorState.draft?.sellerAgreementVersion || current?.version || '')
  const activeVersion = String(config.activeVersion || '')
  const accepted = Boolean(editorState.draft?.sellerAgreementAccepted) && acceptedVersion === activeVersion
  const versionChanged = Boolean(editorState.draft?.sellerAgreementAccepted) && acceptedVersion && activeVersion && acceptedVersion !== activeVersion
  return { accepted, versionChanged, current }
}

function renderAgreementsPanel() {
  const agreementState = sellerAgreementState()
  const config = editorState.agreement.config || {}
  const signatureDisabled = agreementState.accepted || editorState.agreement.loading || Boolean(editorState.agreement.error)
  const canAccept = !signatureDisabled && !editorState.agreement.accepting && String(editorState.agreement.signedName || '').trim().length >= 3
  return `
    <section class="agreements-workspace">
      <div class="agreements-main-grid">
        <article class="agreement-viewer-panel">
          <h3>Agreement Form</h3>
          <div class="agreement-document">
            ${editorState.agreement.loading
              ? '<p class="agreement-loading">Loading agreement…</p>'
              : editorState.agreement.error
                ? '<p class="agreement-error">Could not load the seller agreement. Please try again later.</p>'
                : renderAgreementMarkdown(editorState.agreement.markdown)}
          </div>
          ${agreementState.versionChanged ? '<p class="pricing-warning">A newer agreement version is available and must be accepted before publishing.</p>' : ''}
          ${agreementState.accepted ? `<p class="agreement-accepted-status">Agreement accepted by ${escapeHtml(agreementState.current?.signedName || '')}${agreementState.current?.acceptedAt ? ` on ${escapeHtml(formatAgreementAcceptedDate(agreementState.current.acceptedAt))}` : ''}.</p>` : ''}
          <div class="agreement-signature-row">
            <div class="agreement-signature-field">
              <label>E-Signature (Your Full Legal Name):</label>
              <input type="text" value="${escapeHtml(editorState.agreement.signedName)}" data-agreement-signed-name ${signatureDisabled ? 'disabled' : ''} placeholder="Enter full legal name" />
            </div>
            <button type="button" class="agreement-accept-button" data-accept-agreement ${canAccept ? '' : 'disabled'}>
              ${agreementState.accepted ? 'Agreement Accepted' : editorState.agreement.accepting ? 'Saving…' : 'Accept Agreement'}
            </button>
          </div>
        </article>
        <aside class="agreement-notice">
          <h4>Modifications to Agreements:</h4>
          <p>We reserve the right to update or modify our agreements and policies at any time. If changes occur, you will be notified via email or an alert on your account dashboard. It is your responsibility to review and understand any updates, as all changes take effect immediately upon being posted.</p>
          ${config.title ? `<p>Current: ${escapeHtml(config.title)} ${escapeHtml(String(config.activeVersion || ''))}</p>` : ''}
        </aside>
      </div>
    </section>
  `
}

function renderProductInfoPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  return `
    <section class="product-info-grid">
      <div class="product-info-field"><label>Product Title</label><input name="title" value="${escapeHtml(draft.title)}" /></div>
      <div class="product-info-field"><label>Slug</label><input name="slug" value="${escapeHtml(draft.slug)}" /></div>
      <div class="product-info-field"><label>Product Type</label><select name="productType">${PRODUCT_TYPE_OPTIONS.map((option) => `<option ${draft.productType === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>

      <div class="product-info-field"><label>Artist / Primary Creator</label><input name="artistName" value="${escapeHtml(draft.artistName)}" readonly class="locked-input" /></div>
      <div class="product-info-field"><label>Version</label><input name="version" value="${escapeHtml(draft.version || '')}" placeholder="v1.0" /></div>
      ${tagEditorMarkup('compatibilityNotes', 'Compatibility', 'Ableton, FL Studio, Serum')}

      ${tagEditorMarkup('tags', 'Tags', 'Press Enter to add tags')}
      ${tagEditorMarkup('categories', 'Categories', 'Press Enter to add categories')}
      ${tagEditorMarkup('genres', 'Genres', 'Press Enter to add genres')}

      <div class="product-info-field"><label>Short Description</label><input name="shortDescription" value="${escapeHtml(draft.shortDescription)}" /></div>
      <div class="product-info-field"><label>Release Date</label><input type="date" name="releasedAt" value="${escapeHtml(draft.releasedAt)}" /></div>
      <div class="product-info-field"><label>Usage License</label><select name="usageLicense">${USAGE_LICENSE_OPTIONS.map((option) => `<option ${draft.usageLicense === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>

      <div class="product-info-field is-wide"><label>Long Description</label><textarea name="description" rows="10">${escapeHtml(draft.description)}</textarea></div>
      <div class="product-info-side-stack">
        <div class="product-info-field"><label>Visibility</label><select name="visibility"><option value="public" ${draft.visibility === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${draft.visibility === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${draft.visibility === 'private' ? 'selected' : ''}>Private</option></select></div>
        <div class="product-info-field"><label>Status</label><select name="status"><option value="draft" ${draft.status === 'draft' ? 'selected' : ''}>Draft</option><option value="review_pending" ${draft.status === 'review_pending' ? 'selected' : ''}>Review pending</option><option value="needs_changes" ${draft.status === 'needs_changes' ? 'selected' : ''}>Needs changes</option><option value="rejected" ${draft.status === 'rejected' ? 'selected' : ''}>Rejected</option><option value="archived" ${draft.status === 'archived' ? 'selected' : ''}>Archived</option></select></div>
        <div class="product-info-field"><label>Edit Date</label><input type="date" value="${escapeHtml(formattedEditDate(draft.updatedAt || draft.createdAt))}" readonly /></div>
      </div>
    </section>
  `
}

function renderPlaceholderPanel(section) {
  return `<section class="placeholder-panel"><h3>${escapeHtml(PRODUCT_SECTIONS.find((item) => item.key === section)?.label || 'Section')}</h3><p>This section will be redesigned in the next pass. Product Info is fully redesigned now.</p></section>`
}

function renderMediaUploadPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  const fileEntries = gatherFileEntries()
  const previewCount = fileEntries.filter((item) => item.isPublicPreview).length
  const deliverableCount = fileEntries.filter((item) => item.isDeliverable).length
  const totalBytes = fileEntries.reduce((sum, row) => sum + Number(row.sizeBytes || 0), 0)
  return `
    <section class="media-upload-workspace">
      <div class="media-upload-main-grid">
        <article class="listing-preview-panel">
          <h3>Listing Preview</h3>
          <article class="listing-preview-card">
            <div class="listing-preview-cover">${editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL ? `<img src="${escapeHtml(editorState.mediaPreview.cover || draft.coverURL || draft.thumbnailURL)}" alt="Listing preview cover" />` : '<div class="listing-preview-fallback">No cover yet</div>'}</div>
            <div class="listing-preview-content">
              <p class="listing-preview-type">${escapeHtml(draft.productType || 'Product')}</p>
              <h4>${escapeHtml(draft.title || 'Untitled product')}</h4>
              <p>by ${escapeHtml(draft.artistName || 'Creator')}</p>
              <p>${escapeHtml(draft.shortDescription || 'Short description preview appears here.')}</p>
              <p>${draft.isFree ? 'Free' : `${escapeHtml(draft.currency || 'USD')} ${Number(draft.price || 0).toFixed(2)}`}</p>
              <p>${(draft.previewAudioPaths || '').trim() || editorState.mediaFiles.previewAudio.length || editorState.mediaFiles.previewVideo.length ? 'Preview assigned' : 'No preview media assigned yet'}</p>
            </div>
          </article>
        </article>

        <article class="file-viewer-panel">
          <div class="file-viewer-toolbar">
            <h3>File Viewer</h3>
            <p>Total files: ${fileEntries.length} · Total size: ${formatBytes(totalBytes)} · Preview: ${previewCount} · Deliverables: ${deliverableCount}</p>
          </div>
          <div class="file-tree">
            ${fileEntries.length
              ? fileEntries.map((file, index) => `
                <div class="file-tree-row is-file">
                  <div><strong>${escapeHtml(file.name)}</strong><div class="path">${escapeHtml(file.displayPath)}</div></div>
                  <div>${escapeHtml(formatBytes(file.sizeBytes))}</div>
                  <div><span class="file-role-badge ${file.isPublicPreview ? 'is-public' : 'is-private'}">${file.isPublicPreview ? 'Public' : 'Private'}</span></div>
                  <div class="file-row-actions">
                    <button type="button" data-assign-role="${index}:hover-audio">Hover Audio</button>
                    <button type="button" data-assign-role="${index}:hover-video">Hover Video</button>
                    <button type="button" data-remove-file="${index}">Remove</button>
                  </div>
                </div>
              `).join('')
              : '<p class="muted">No files uploaded yet. Add product images, previews, or deliverables to build the product file tree.</p>'}
          </div>
        </article>

        <aside class="media-upload-actions">
          <button type="button" class="media-upload-action-btn" data-pick-file="cover">Upload Cover Image</button>
          <button type="button" class="media-upload-action-btn" data-pick-file="gallery">Upload Product Images</button>
          <button type="button" class="media-upload-action-btn" data-pick-file="preview-audio">Upload Audio Preview</button>
          <button type="button" class="media-upload-action-btn" data-pick-file="preview-video">Upload Video Preview</button>
          <button type="button" class="media-upload-action-btn marketplace-preview-btn" data-open-marketplace-preview>Marketplace Preview</button>
          <input class="hidden-file" type="file" accept="image/*" data-cover-input />
          <input class="hidden-file" type="file" accept="image/*" multiple data-gallery-input />
          <input class="hidden-file" type="file" accept="audio/*" multiple data-preview-audio-input />
          <input class="hidden-file" type="file" accept="video/*" multiple data-preview-video-input />
        </aside>
      </div>
    </section>
  `
}

function hydrateLegacyContributors() {
  if (!editorState.contributorUI.rows.length) {
    const names = String(editorState.draft?.contributorNames || '').split(',').map((item) => item.trim()).filter(Boolean)
    const ids = String(editorState.draft?.contributorIds || '').split(',').map((item) => item.trim()).filter(Boolean)
    editorState.contributorUI.rows = names.map((name, index) => ({
      uid: ids[index] || `legacy-${index}`,
      displayName: name,
      username: '',
      avatarURL: '',
      role: '',
      status: ids[index] ? 'accepted' : 'accepted',
      decision: 'accepted',
      requestedAt: new Date().toISOString(),
      decisionAt: new Date().toISOString(),
      legacy: !ids[index]
    }))
  }
}

function recalcContributorSummaryFromRows() {
  const accepted = editorState.contributorUI.rows.filter((row) => row.status === 'accepted')
  const pending = editorState.contributorUI.rows.filter((row) => row.status === 'pending')
  updateDraftField('contributorIds', accepted.filter((row) => row.uid && !row.legacy).map((row) => row.uid).join(', '))
  updateDraftField('contributorNames', accepted.map((row) => row.displayName).join(', '))
  updateDraftField('contributorCount', accepted.length)
  updateDraftField('pendingContributorIds', pending.map((row) => row.uid).filter(Boolean))
  updateDraftField('contributorRequestCount', editorState.contributorUI.rows.length)
}

function renderContributorsPanel() {
  hydrateLegacyContributors()
  const rows = editorState.contributorUI.rows
    .filter((row) => editorState.contributorUI.filter === 'all' ? true : row.status === editorState.contributorUI.filter)
  return `
    <section class=\"contributors-workspace\">
      <article class=\"contributors-main-panel\">
        <h3>Contributing Artists</h3>
        <div class=\"contributors-toolbar\">
          <input class=\"contributor-search\" type=\"search\" value=\"${escapeHtml(editorState.contributorUI.search)}\" placeholder=\"Search users by username or display name…\" data-contributor-search />
          <input type=\"text\" value=\"${escapeHtml(editorState.contributorUI.role)}\" placeholder=\"Contribution role (Producer, Vocalist...)\" data-contributor-role />
        </div>
        ${editorState.contributorUI.results.length ? `
          <div class=\"contributor-results\">
            ${editorState.contributorUI.results.map((profile) => `
              <button type=\"button\" data-add-contributor=\"${escapeHtml(profile.uid)}\">
                <img class=\"contributor-avatar\" src=\"${escapeHtml(profile.avatarURL || profile.photoURL || '')}\" alt=\"\" />
                <span>${escapeHtml(profile.displayName || 'User')} @${escapeHtml(profile.username || '')}</span>
              </button>
            `).join('')}
          </div>
        ` : ''}
        <div class=\"contributor-filter-row\">
          ${['all', 'pending', 'accepted', 'denied'].map((filter) => `<button type=\"button\" class=\"${editorState.contributorUI.filter === filter ? 'is-active' : ''}\" data-contributor-filter=\"${filter}\">${filter[0].toUpperCase()}${filter.slice(1)}</button>`).join('')}
        </div>
        <div class=\"contributor-table\">
          ${rows.length ? rows.map((row) => `
            <article class=\"contributor-row\">
              <img class=\"contributor-avatar\" src=\"${escapeHtml(row.avatarURL || '')}\" alt=\"\" />
              <div class=\"contributor-identity\">
                <strong>${escapeHtml(row.displayName || 'Unknown')}</strong>
                <p>@${escapeHtml(row.username || 'manual')}</p>
                <p>${escapeHtml(row.uid || '')}</p>
              </div>
              <div><input type=\"text\" value=\"${escapeHtml(row.role || '')}\" data-contributor-role-edit=\"${escapeHtml(row.uid)}\" placeholder=\"Role\"/></div>
              <div>${escapeHtml((row.requestedAt || '').slice(0, 10) || '—')}</div>
              <div>${escapeHtml((row.decisionAt || '').slice(0, 10) || '—')}</div>
              <div><span class=\"contributor-status-badge is-${escapeHtml(row.status || 'pending')}\">${escapeHtml(row.status || 'pending')}</span></div>
              <div class=\"contributor-actions\">
                <button type=\"button\" data-contributor-status=\"${escapeHtml(row.uid)}:accepted\">Accept</button>
                <button type=\"button\" data-contributor-status=\"${escapeHtml(row.uid)}:denied\">Deny</button>
                <button type=\"button\" data-contributor-remove=\"${escapeHtml(row.uid)}\">Remove</button>
              </div>
            </article>
          `).join('') : '<p class=\"contributor-empty-state\">No contributing artists added yet.</p>'}
        </div>
      </article>
      <aside class=\"contributors-notice\">
        <h4>Collaboration Notice:</h4>
        <p>To ensure accurate attribution, contributing artists are required to accept their collaboration request before being listed as credited additions to your product. Pending their acceptance, their names will not be visible on the product page.</p>
      </aside>
    </section>
  `
}

function renderEditor() {
  const section = readSectionHash()
  const statusClass = editorState.status.message ? `is-visible is-${editorState.status.state}` : ''

  editorRoot.innerHTML = `
    <div class="marketplace-editor-page">
      <header class="marketplace-editor-header">
        <p class="marketplace-editor-header-kicker">NEW MARKETPLACE ITEM</p>
        <p class="marketplace-editor-header-copy">Configure product metadata, media, pricing, and publish state for the Melogic marketplace.</p>
      </header>

      <section class="marketplace-editor-tabs-wrap">
        <p class="marketplace-editor-pages-label"><span></span>PAGES<span></span></p>
        <div class="marketplace-editor-tabs">
          ${PRODUCT_SECTIONS.map((item) => `<button type="button" class="marketplace-editor-tab ${item.key === section ? 'is-active' : ''}" data-section="${item.key}">${item.label}</button>`).join('')}
        </div>
      </section>

      <section class="marketplace-editor-workspace">
        <div class="product-status ${statusClass}">${editorState.status.message || ''}</div>
        <form data-product-form>
          ${section === 'product-info'
            ? renderProductInfoPanel()
            : section === 'media-upload'
              ? renderMediaUploadPanel()
              : section === 'contributors'
                ? renderContributorsPanel()
                : section === 'pricing'
                  ? renderPricingPanel()
                  : section === 'agreements'
                    ? renderAgreementsPanel()
                : renderPlaceholderPanel(section)}
          <div class="editor-actions">
            <button type="button" class="button button-muted" data-save-draft>Save Draft</button>
            <button type="button" class="button button-accent" data-publish-product>Publish Product</button>
          </div>
        </form>
      </section>
    </div>
  `

  editorRoot.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = button.getAttribute('data-section')
      renderEditor()
    })
  })

  const form = editorRoot.querySelector('[data-product-form]')

  form?.addEventListener('input', (event) => {
    const target = event.target
    if (!target?.name) return
    if (!(target.name in editorState.draft)) return
    if (['artistName', 'artistUsername', 'artistProfilePath', 'artistId'].includes(target.name)) return
    const value = target.type === 'checkbox' ? target.checked : target.value
    updateDraftField(target.name, value)
    if (target.name === 'slug') {
      editorState.slugLocked = Boolean(String(value || '').trim())
      saveDraftState()
      return
    }
    if (target.name === 'title' && !editorState.slugLocked) {
      const nextSlug = slugify(value)
      updateDraftField('slug', nextSlug)
      const slugInput = form.querySelector('input[name="slug"]')
      if (slugInput) slugInput.value = nextSlug
    }
  })

  form?.addEventListener('keydown', (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const field = input.getAttribute('data-tag-input')
    if (!field) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const value = input.value.trim()
      if (!value) return
      const values = [...tagValuesFor(field), value]
      setTagValues(field, Array.from(new Set(values)))
      input.value = ''
      renderEditor()
      return
    }
    if (event.key === 'Backspace' && !input.value.trim()) {
      const values = tagValuesFor(field)
      values.pop()
      setTagValues(field, values)
      renderEditor()
    }
  })

  editorRoot.querySelectorAll('[data-remove-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.getAttribute('data-tag-field') || ''
      const value = button.getAttribute('data-remove-tag') || ''
      setTagValues(field, tagValuesFor(field).filter((tag) => tag !== value))
      renderEditor()
    })
  })

  const pricingPriceInput = editorRoot.querySelector('[data-pricing-price-input]')
  pricingPriceInput?.addEventListener('input', () => {
    const priceCents = normalizePriceToCents(pricingPriceInput.value)
    updateDraftField('price', centsToPriceInput(priceCents))
    updateDraftField('isFree', priceCents === 0)
    renderEditor()
  })

  editorRoot.querySelector('[data-pricing-currency]')?.addEventListener('change', (event) => {
    const selectedCurrency = String(event.target.value || '').trim().toUpperCase()
    if (!selectedCurrency) return
    updateDraftField('currency', selectedCurrency)
    renderEditor()
  })

  editorRoot.querySelector('[data-pricing-free-toggle]')?.addEventListener('change', (event) => {
    const checked = Boolean(event.target.checked)
    updateDraftField('isFree', checked)
    if (checked) updateDraftField('price', '0.00')
    if (!checked && normalizePriceToCents(editorState.draft?.price || '') === 0) updateDraftField('price', '1.00')
    renderEditor()
  })

  editorRoot.querySelector('[data-agreement-signed-name]')?.addEventListener('input', (event) => {
    editorState.agreement.signedName = event.target.value
    renderEditor()
  })

  editorRoot.querySelector('[data-accept-agreement]')?.addEventListener('click', async () => {
    if (!editorState.user || !editorState.draft) return
    if (!editorState.agreement.config || editorState.agreement.loading || editorState.agreement.error) return
    const signedName = String(editorState.agreement.signedName || '').trim()
    if (signedName.length < 3) {
      setStatus('Please enter your full legal name before accepting the agreement.', 'error')
      renderEditor()
      return
    }
    if (!signedName.includes(' ') && signedName.length < 6) {
      setStatus('Please enter a full legal name (first and last preferred).', 'error')
      renderEditor()
      return
    }

    editorState.agreement.accepting = true
    renderEditor()
    try {
      let productId = editorState.draft.id
      if (!productId || isPlaceholderProductId(productId)) {
        const payload = buildProductPayload({ ...editorState.draft, profile: editorState.creatorProfile || {}, status: 'draft' }, editorState.user)
        const result = await saveProductDraft(editorState.user, payload, {
          productId: '',
          status: 'draft',
          isNew: true,
          mediaFiles: editorState.mediaFiles,
          galleryFiles: editorState.mediaFiles.gallery,
          previewAudioFiles: editorState.mediaFiles.previewAudio,
          previewVideoFiles: editorState.mediaFiles.previewVideo
        })
        productId = result.productId
        updateDraftField('id', productId)
      }
      const config = editorState.agreement.config
      const agreementPayload = {
        agreementId: config.agreementId,
        version: config.activeVersion,
        title: config.title,
        storagePath: config.storagePath,
        format: config.format || 'markdown',
        signedName,
        acceptedBy: editorState.user.uid,
        acceptedAt: serverTimestamp(),
        accepted: true
      }
      await setDoc(doc(db, 'products', productId), {
        sellerAgreement: agreementPayload,
        sellerAgreementAccepted: true,
        sellerAgreementVersion: config.activeVersion,
        updatedAt: serverTimestamp()
      }, { merge: true })
      await setDoc(doc(db, 'users', editorState.user.uid, 'agreementAcceptances', `${config.agreementId}_${config.activeVersion}`), {
        agreementId: config.agreementId,
        version: config.activeVersion,
        title: config.title,
        storagePath: config.storagePath,
        signedName,
        productId,
        acceptedAt: serverTimestamp(),
        accepted: true
      }, { merge: true })
      updateDraftField('sellerAgreement', { ...agreementPayload, acceptedAt: new Date().toISOString() })
      updateDraftField('sellerAgreementAccepted', true)
      updateDraftField('sellerAgreementVersion', config.activeVersion)
      setStatus('Agreement accepted.', 'success')
    } catch (error) {
      console.warn('[new-product] agreement acceptance failed', error?.code || error?.message || error)
      setStatus('Could not save agreement acceptance. Please try again.', 'error')
    } finally {
      editorState.agreement.accepting = false
      renderEditor()
    }
  })

  const coverInput = editorRoot.querySelector('[data-cover-input]')
  const galleryInput = editorRoot.querySelector('[data-gallery-input]')
  const previewAudioInput = editorRoot.querySelector('[data-preview-audio-input]')
  const previewVideoInput = editorRoot.querySelector('[data-preview-video-input]')
  editorRoot.querySelector('[data-pick-file="cover"]')?.addEventListener('click', () => coverInput?.click())
  editorRoot.querySelector('[data-pick-file="gallery"]')?.addEventListener('click', () => galleryInput?.click())
  editorRoot.querySelector('[data-pick-file="preview-audio"]')?.addEventListener('click', () => previewAudioInput?.click())
  editorRoot.querySelector('[data-pick-file="preview-video"]')?.addEventListener('click', () => previewVideoInput?.click())
  coverInput?.addEventListener('change', () => {
    const file = coverInput.files?.[0]
    if (!file) return
    editorState.mediaFiles.cover = file
    editorState.mediaPreview.cover = URL.createObjectURL(file)
    setStatus('Cover image selected. Save draft to upload.', 'info')
    renderEditor()
  })
  galleryInput?.addEventListener('change', () => {
    editorState.mediaFiles.gallery = Array.from(galleryInput.files || [])
    setStatus('Product images selected. Save draft to upload.', 'info')
    renderEditor()
  })
  previewAudioInput?.addEventListener('change', () => {
    editorState.mediaFiles.previewAudio = Array.from(previewAudioInput.files || [])
    setStatus('Audio previews selected. Save draft to upload.', 'info')
    renderEditor()
  })
  previewVideoInput?.addEventListener('change', () => {
    editorState.mediaFiles.previewVideo = Array.from(previewVideoInput.files || [])
    setStatus('Video previews selected. Save draft to upload.', 'info')
    renderEditor()
  })
  editorRoot.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = Number(button.getAttribute('data-remove-file'))
      const files = gatherFileEntries()
      const target = files[index]
      if (!target) return
      const map = {
        'Listing Media': 'gallery',
        'Preview Media': target.kind.startsWith('video/') ? 'previewVideo' : 'previewAudio',
        Deliverables: 'deliverables'
      }
      const key = map[target.category]
      if (!key) return
      editorState.mediaFiles[key] = (editorState.mediaFiles[key] || []).filter((row) => (row.webkitRelativePath || row.name) !== target.displayPath)
      setStatus('File removed from draft.', 'info')
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-assign-role]').forEach((button) => {
    button.addEventListener('click', () => {
      const [indexRaw, role] = String(button.getAttribute('data-assign-role') || '').split(':')
      const file = gatherFileEntries()[Number(indexRaw)]
      if (!file) return
      if (role === 'hover-audio') updateDraftField('previewAudioPaths', `products/${editorState.draft.id || '{id}'}/audio-previews/${file.name}`)
      if (role === 'hover-video') updateDraftField('previewVideoPaths', `products/${editorState.draft.id || '{id}'}/video-previews/${file.name}`)
      setStatus('Preview role assigned. Save draft to persist uploads.', 'info')
      renderEditor()
    })
  })
  editorRoot.querySelector('[data-open-marketplace-preview]')?.addEventListener('click', async () => {
    if (!editorState.user || !editorState.draft) return
    const wasNewDraft = !editorState.draft.id || isPlaceholderProductId(editorState.draft.id)
    const payload = buildProductPayload({ ...editorState.draft, profile: editorState.creatorProfile || {}, status: 'draft' }, editorState.user)
    const result = await saveProductDraft(editorState.user, payload, {
      productId: wasNewDraft ? '' : editorState.draft.id,
      status: 'draft',
      isNew: wasNewDraft,
      mediaFiles: editorState.mediaFiles,
      galleryFiles: editorState.mediaFiles.gallery,
      previewAudioFiles: editorState.mediaFiles.previewAudio,
      previewVideoFiles: editorState.mediaFiles.previewVideo
    })
    updateDraftField('id', result.productId)
    window.open(`${productRoute(result.productId)}?preview=draft`, '_blank', 'noopener,noreferrer')
  })

  const contributorSearchInput = editorRoot.querySelector('[data-contributor-search]')
  const contributorRoleInput = editorRoot.querySelector('[data-contributor-role]')
  contributorSearchInput?.addEventListener('input', async () => {
    editorState.contributorUI.search = contributorSearchInput.value
    if (editorState.contributorUI.search.trim().length < 2) {
      editorState.contributorUI.results = []
      renderEditor()
      return
    }
    try {
      editorState.contributorUI.results = await searchProfilesByUsername(editorState.contributorUI.search.trim())
    } catch {
      editorState.contributorUI.results = []
    }
    renderEditor()
  })
  contributorRoleInput?.addEventListener('input', () => {
    editorState.contributorUI.role = contributorRoleInput.value
  })
  editorRoot.querySelectorAll('[data-add-contributor]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.getAttribute('data-add-contributor') || ''
      const profile = editorState.contributorUI.results.find((row) => row.uid === uid)
      if (!profile || !editorState.user) return
      if (uid === editorState.user.uid) {
        setStatus('You cannot add yourself as a contributor.', 'error')
        renderEditor()
        return
      }
      if (editorState.contributorUI.rows.some((row) => row.uid === uid && row.status !== 'removed')) {
        setStatus('Contributor already added.', 'error')
        renderEditor()
        return
      }
      const row = {
        uid,
        displayName: profile.displayName || profile.username || 'Contributor',
        username: profile.username || '',
        avatarURL: profile.avatarURL || profile.photoURL || '',
        role: editorState.contributorUI.role || '',
        status: 'pending',
        decision: 'pending',
        requestedAt: new Date().toISOString(),
        decisionAt: '',
        legacy: false
      }
      editorState.contributorUI.rows = [row, ...editorState.contributorUI.rows]
      editorState.contributorUI.results = []
      editorState.contributorUI.search = ''
      recalcContributorSummaryFromRows()
      if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id)) {
        await addProductContributorRequest({ productId: editorState.draft.id, ownerUid: editorState.user.uid, targetProfile: profile, role: row.role })
      }
      setStatus('Contributor request added (pending).', 'success')
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      editorState.contributorUI.filter = button.getAttribute('data-contributor-filter') || 'all'
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-status]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [uid, status] = String(button.getAttribute('data-contributor-status') || '').split(':')
      editorState.contributorUI.rows = editorState.contributorUI.rows.map((row) => row.uid === uid ? { ...row, status, decision: status, decisionAt: new Date().toISOString() } : row)
      recalcContributorSummaryFromRows()
      if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id)) await recalculateAcceptedContributors(editorState.draft.id)
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-remove]').forEach((button) => {
    button.addEventListener('click', async () => {
      const uid = button.getAttribute('data-contributor-remove') || ''
      editorState.contributorUI.rows = editorState.contributorUI.rows.filter((row) => row.uid !== uid)
      recalcContributorSummaryFromRows()
      if (editorState.draft?.id && !isPlaceholderProductId(editorState.draft.id) && editorState.user) {
        await removeProductContributorRequest({ productId: editorState.draft.id, ownerUid: editorState.user.uid, targetUid: uid })
      }
      renderEditor()
    })
  })
  editorRoot.querySelectorAll('[data-contributor-role-edit]').forEach((input) => {
    input.addEventListener('input', (event) => {
      const uid = input.getAttribute('data-contributor-role-edit') || ''
      const value = event.target.value
      editorState.contributorUI.rows = editorState.contributorUI.rows.map((row) => row.uid === uid ? { ...row, role: value } : row)
    })
  })

  async function persistProduct(desiredStatus = 'draft') {
    if (!editorState.user || !editorState.draft) return
    if (desiredStatus === 'published') {
      const requiredVersion = String(editorState.agreement.config?.activeVersion || '')
      const acceptedVersion = String(editorState.draft.sellerAgreementVersion || '')
      const accepted = Boolean(editorState.draft.sellerAgreementAccepted) && acceptedVersion && acceptedVersion === requiredVersion
      if (!accepted) {
        setStatus('You must accept the Marketplace Product Seller Agreement before publishing.', 'error')
        renderEditor()
        return
      }
    }
    setStatus(desiredStatus === 'published' ? 'Submitting for review...' : 'Saving draft...', 'info')
    renderEditor()
    try {
      const wasNewDraft = !editorState.draft.id || isPlaceholderProductId(editorState.draft.id)
      const payload = buildProductPayload({ ...editorState.draft, profile: editorState.creatorProfile || {}, currentStatus: editorState.draft.status || 'draft', status: desiredStatus === 'published' ? 'review_pending' : desiredStatus }, editorState.user)
      const result = await saveProductDraft(editorState.user, payload, {
        productId: wasNewDraft ? '' : editorState.draft.id,
        status: desiredStatus === 'published' ? 'review_pending' : desiredStatus,
        isNew: wasNewDraft,
        mediaFiles: editorState.mediaFiles,
        galleryFiles: editorState.mediaFiles.gallery,
        previewAudioFiles: editorState.mediaFiles.previewAudio,
        previewVideoFiles: editorState.mediaFiles.previewVideo,
        onStatus: (message) => {
          setStatus(message, 'info')
          renderEditor()
        }
      })
      updateDraftField('id', result.productId)
      updateDraftField('status', result.payload?.status || editorState.draft.status)
      updateDraftField('slug', payload.slug)
      if (desiredStatus === 'published') {
        const reviewResult = await requestProductReview(result.productId)
        updateDraftField('status', reviewResult?.status || 'review_pending')
      }
      setStatus(desiredStatus === 'published' ? 'Submitted for review.' : 'Draft saved.', 'success')
      renderEditor()
    } catch (error) {
      console.warn('[new-product] save failed', error?.code || error?.message || error)
      setStatus(desiredStatus === 'published' ? 'Could not submit for review.' : 'Could not save draft.', 'error')
      renderEditor()
    }
  }

  editorRoot.querySelector('[data-save-draft]')?.addEventListener('click', () => persistProduct('draft'))
  editorRoot.querySelector('[data-publish-product]')?.addEventListener('click', () => persistProduct('published'))
}

async function initPage() {
  const user = await waitForInitialAuthState()
  if (!user) {
    editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Sign in required</h2><a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a></article>`
    return
  }

  editorState.user = user
  editorState.creatorProfile = await fetchPublicCreatorProfile(user.uid)
  editorState.marketplacePricingSettings = await getMarketplacePricingSettings()
  editorState.agreement.loading = true
  editorState.agreement.error = ''

  if (editorState.requestedProductId) {
    const existingProduct = await getProductById(editorState.requestedProductId)
    if (!existingProduct || existingProduct.artistId !== user.uid) {
      editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Listing access denied</h2><a class="button button-accent" href="${ROUTES.products}">Back to Products</a></article>`
      return
    }
    editorState.draft = applyCreatorIdentity({ ...createEmptyProductDraft(user, editorState.creatorProfile), ...existingProduct, id: existingProduct.id }, user, editorState.creatorProfile)
  } else {
    editorState.draft = applyCreatorIdentity(loadDraftState(user), user, editorState.creatorProfile)
  }

  if (!editorState.draft.currency) {
    updateDraftField('currency', editorState.marketplacePricingSettings?.defaultCurrency || 'USD')
  }

  editorState.agreement.signedName = String(editorState.draft.sellerAgreement?.signedName || '')
  try {
    const agreementConfig = await getMarketplaceSellerAgreementConfig()
    editorState.agreement.config = agreementConfig
    editorState.agreement.markdown = await getAgreementMarkdown(agreementConfig.storagePath)
    if (editorState.draft.sellerAgreementVersion && editorState.draft.sellerAgreementVersion !== agreementConfig.activeVersion) {
      updateDraftField('sellerAgreementAccepted', false)
    }
  } catch (error) {
    console.warn('[new-product] agreement load failed', error?.code || error?.message || error)
    editorState.agreement.error = 'Could not load seller agreement.'
  } finally {
    editorState.agreement.loading = false
  }

  renderEditor()
}

window.addEventListener('hashchange', () => {
  if (!editorState.user) return
  renderEditor()
})

initPage()
