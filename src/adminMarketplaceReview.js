import './styles/base.css'
import './styles/adminMarketplaceReview.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { listMarketplaceReviewQueue, reviewProductDecision } from './data/productService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, productRoute } from './utils/routes'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')

const state = {
  currentUser: null,
  products: [],
  selectedId: '',
  loading: true,
  actionProductId: '',
  message: '',
  error: ''
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDate(value) {
  const date = new Date(value || 0)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function formatMoney(cents = 0, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100)
  } catch {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`
  }
}

function formatBytes(size = 0) {
  const bytes = Math.max(0, Number(size || 0))
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / (1024 ** index)
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function statusClass(value = '') {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '-')
}

function selectedProduct() {
  return state.products.find((product) => product.id === state.selectedId) || state.products[0] || null
}

function productCard(product) {
  const selected = selectedProduct()?.id === product.id
  const reasons = product.moderationReasons?.length ? product.moderationReasons.join(', ') : 'No reasons returned'
  return `
    <article class="review-row ${selected ? 'is-selected' : ''}" data-review-product="${escapeHtml(product.id)}">
      <button type="button" class="review-row-main" data-select-product="${escapeHtml(product.id)}" aria-pressed="${selected}">
        <span class="review-row-title">${escapeHtml(product.title)}</span>
        <span class="review-row-artist">${escapeHtml(product.artistName)}</span>
        <span class="review-row-meta">${escapeHtml(product.productType)} · ${escapeHtml(formatMoney(product.priceCents, product.currency))}</span>
      </button>
      <div class="review-row-status">
        <span class="review-badge is-${escapeHtml(statusClass(product.status))}">${escapeHtml(product.status || 'unknown')}</span>
        <span class="review-badge">${escapeHtml(product.reviewJobStatus || 'review')}</span>
      </div>
      <dl class="review-row-facts">
        <div><dt>Requested</dt><dd>${escapeHtml(formatDate(product.reviewRequestedAt || product.updatedAt || product.createdAt))}</dd></div>
        <div><dt>AI Model</dt><dd>${escapeHtml(product.moderationAIModel || 'Not recorded')}</dd></div>
        <div><dt>AI</dt><dd>${product.moderationAISucceeded ? 'Succeeded' : 'Not complete'}</dd></div>
        <div><dt>Risk</dt><dd>${escapeHtml(product.moderationRiskLevel || 'unknown')}</dd></div>
        <div><dt>Files</dt><dd>${Number(product.assetSummary?.totalFiles || 0)} · ${escapeHtml(formatBytes(product.assetSummary?.totalBytes || 0))}</dd></div>
      </dl>
      <p class="review-row-summary">${escapeHtml(product.moderationSummary || reasons)}</p>
      <label class="review-field">
        <span>Reason</span>
        <input data-review-reason="${escapeHtml(product.id)}" maxlength="1200" placeholder="Decision reason" />
      </label>
      <label class="review-field">
        <span>Notes</span>
        <textarea data-review-notes="${escapeHtml(product.id)}" maxlength="2400" rows="2" placeholder="Internal notes"></textarea>
      </label>
      <div class="review-actions">
        <button type="button" class="review-action is-approve" data-review-decision="${escapeHtml(product.id)}:approve" title="Approve and publish">${iconSvg('checkCircle')}<span>Approve</span></button>
        <button type="button" class="review-action" data-review-decision="${escapeHtml(product.id)}:request_changes" title="Request changes">${iconSvg('edit')}<span>Changes</span></button>
        <button type="button" class="review-action is-danger" data-review-decision="${escapeHtml(product.id)}:reject" title="Reject">${iconSvg('x')}<span>Reject</span></button>
        <button type="button" class="review-action" data-review-decision="${escapeHtml(product.id)}:keep_pending" title="Keep pending">${iconSvg('alertCircle')}<span>Pending</span></button>
      </div>
    </article>
  `
}

function previewPanel(product) {
  if (!product) {
    return '<section class="review-preview-panel"><p>No products are waiting for review.</p></section>'
  }
  const deliverables = product.deliverableFiles?.length
    ? product.deliverableFiles.map((file) => `<li><strong>${escapeHtml(file.displayPath || file.name || 'File')}</strong><span>${escapeHtml(formatBytes(file.sizeBytes || 0))}</span><small>${escapeHtml(file.storagePath || '')}</small></li>`).join('')
    : '<li><strong>No deliverable file rows</strong><span>Check asset summary and manifest.</span></li>'
  const previewPaths = [
    product.coverPath,
    product.thumbnailPath,
    ...(product.galleryPaths || []),
    ...(product.previewAudioPaths || []),
    ...(product.previewVideoPaths || [])
  ].filter(Boolean)
  const isPublic = product.status === 'published' && product.visibility === 'public'
  return `
    <section class="review-preview-panel">
      <div class="review-preview-header">
        <div>
          <p class="eyebrow">Product Preview</p>
          <h2>${escapeHtml(product.title)}</h2>
          <p>${escapeHtml(product.shortDescription || product.description || 'No description provided.')}</p>
        </div>
        ${isPublic
          ? `<a class="review-link-button" href="${productRoute(product)}" target="_blank" rel="noreferrer">${iconSvg('eye')}<span>Public Route</span></a>`
          : `<span class="review-private-note">${iconSvg('lock')}<span>Private admin preview</span></span>`}
      </div>
      <div class="review-preview-grid">
        <dl>
          <div><dt>Product ID</dt><dd>${escapeHtml(product.id)}</dd></div>
          <div><dt>Artist</dt><dd>${escapeHtml(product.artistName)} · ${escapeHtml(product.artistId)}</dd></div>
          <div><dt>Status</dt><dd>${escapeHtml(product.status)} / ${escapeHtml(product.visibility)}</dd></div>
          <div><dt>Moderation</dt><dd>${escapeHtml(product.moderationStatus || 'pending')} · ${escapeHtml(product.moderationRiskLevel || 'unknown')}</dd></div>
          <div><dt>Price</dt><dd>${escapeHtml(formatMoney(product.priceCents, product.currency))}</dd></div>
          <div><dt>Seller Agreement</dt><dd>${product.sellerAgreementAccepted ? 'Accepted' : 'Missing'}</dd></div>
        </dl>
        <article class="review-summary-card">
          <h3>AI Summary</h3>
          <p>${escapeHtml(product.moderationSummary || 'No AI summary recorded.')}</p>
          <p class="review-muted">Model: ${escapeHtml(product.moderationAIModel || 'Not recorded')} · AI ${product.moderationAISucceeded ? 'succeeded' : 'did not succeed'}</p>
          <div class="review-reason-list">${(product.moderationReasons || []).map((reason) => `<span>${escapeHtml(reason)}</span>`).join('') || '<span>No reasons</span>'}</div>
        </article>
      </div>
      <section class="review-preview-section">
        <h3>Files</h3>
        <ul class="review-file-list">${deliverables}</ul>
      </section>
      <section class="review-preview-section">
        <h3>Preview and media paths</h3>
        <div class="review-path-list">${previewPaths.length ? previewPaths.map((path) => `<code>${escapeHtml(path)}</code>`).join('') : '<span>No preview media paths</span>'}</div>
      </section>
      <section class="review-preview-section">
        <h3>Description</h3>
        <p>${escapeHtml(product.description || product.shortDescription || 'No full description provided.')}</p>
      </section>
    </section>
  `
}

function render() {
  const product = selectedProduct()
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main class="admin-review-page">
      <section class="admin-review-shell">
        <header class="admin-review-header">
          <div>
            <p class="eyebrow">Admin</p>
            <h1>Marketplace Review</h1>
            <p>${state.loading ? 'Loading review queue...' : `${state.products.length} products need review.`}</p>
          </div>
          <button type="button" class="review-refresh" data-refresh-queue>${iconSvg('barChart')}<span>Refresh</span></button>
        </header>
        ${state.message ? `<p class="review-status is-success">${escapeHtml(state.message)}</p>` : ''}
        ${state.error ? `<p class="review-status is-error">${escapeHtml(state.error)}</p>` : ''}
        <div class="admin-review-layout">
          <section class="review-queue" aria-label="Marketplace review queue">
            ${state.loading ? '<article class="review-empty">Loading review queue...</article>' : state.products.length ? state.products.map(productCard).join('') : '<article class="review-empty">No products are waiting for manual review.</article>'}
          </section>
          ${previewPanel(product)}
        </div>
      </section>
    </main>
  `
  bindEvents()
}

async function loadQueue() {
  state.loading = true
  state.error = ''
  render()
  try {
    const result = await listMarketplaceReviewQueue({ limitCount: 80 })
    state.products = result.products || []
    if (!state.products.some((product) => product.id === state.selectedId)) {
      state.selectedId = state.products[0]?.id || ''
    }
  } catch (error) {
    console.warn('[admin-review] queue load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.code === 'functions/permission-denied'
      ? 'This account is not authorized for marketplace review.'
      : 'Could not load the marketplace review queue.'
  } finally {
    state.loading = false
    render()
  }
}

async function submitDecision(productId, decision) {
  const reason = app.querySelector(`[data-review-reason="${CSS.escape(productId)}"]`)?.value || ''
  const notes = app.querySelector(`[data-review-notes="${CSS.escape(productId)}"]`)?.value || ''
  state.actionProductId = productId
  state.message = ''
  state.error = ''
  render()
  try {
    const result = await reviewProductDecision({ productId, decision, reason, notes })
    state.message = `${result.status || 'Product'} saved for ${productId}.`
    await loadQueue()
  } catch (error) {
    console.warn('[admin-review] decision failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not apply the review decision.'
    state.actionProductId = ''
    render()
  }
}

function bindEvents() {
  app.querySelector('[data-refresh-queue]')?.addEventListener('click', () => loadQueue())
  app.querySelectorAll('[data-select-product]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedId = button.getAttribute('data-select-product') || ''
      render()
    })
  })
  app.querySelectorAll('[data-review-decision]').forEach((button) => {
    button.addEventListener('click', () => {
      const [productId, decision] = String(button.getAttribute('data-review-decision') || '').split(':')
      if (!productId || !decision || state.actionProductId) return
      submitDecision(productId, decision)
    })
  })
}

async function init() {
  state.currentUser = await waitForInitialAuthState()
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: `${ROUTES.adminMarketplaceReview}` }))
    return
  }
  render()
  initShellChrome()
  await loadQueue()
}

init()
