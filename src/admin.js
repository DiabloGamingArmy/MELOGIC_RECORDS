import './styles/base.css'
import './styles/admin.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { listMarketplaceReviewQueue, reviewProductDecision, setAdminUserRole } from './data/productService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, adminReviewRoute, authRoute, productRoute, publicProfileRoute } from './utils/routes'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')

const SECTIONS = [
  { key: 'dashboard', route: ROUTES.admin, label: 'Overview', icon: 'barChart', permission: 'admin' },
  { key: 'reviews', route: ROUTES.adminReviews, label: 'Reviews', icon: 'checkCircle', permission: 'productReview' },
  { key: 'products', route: ROUTES.adminProducts, label: 'Products', icon: 'package', permission: 'listingEdit' },
  { key: 'users', route: ROUTES.adminUsers, label: 'Users', icon: 'messageCircle', permission: 'userRead' },
  { key: 'reports', route: ROUTES.adminReports, label: 'Reports', icon: 'alertCircle', permission: 'admin' },
  { key: 'orders', route: ROUTES.adminOrders, label: 'Orders', icon: 'shoppingCart', permission: 'orderSupport' },
  { key: 'team', route: ROUTES.adminTeam, label: 'Team', icon: 'folderPlus', permission: 'roleManage' },
  { key: 'logs', route: ROUTES.adminLogs, label: 'Logs', icon: 'fileText', permission: 'auditRead' },
  { key: 'settings', route: ROUTES.adminSettings, label: 'Settings', icon: 'edit', permission: 'admin' }
]

const REVIEW_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'manual', label: 'Manual' },
  { key: 'ai-passed', label: 'AI Passed' },
  { key: 'ai-error', label: 'AI Error' },
  { key: 'needs-changes', label: 'Needs Changes' }
]

const DECISION_LABELS = {
  approve: 'Pass',
  reject: 'Reject',
  request_changes: 'Return',
  keep_pending: 'Keep Pending'
}

const state = {
  currentUser: null,
  claims: {},
  section: 'dashboard',
  products: [],
  selectedId: '',
  reviewedProduct: null,
  loadingQueue: false,
  queueLoaded: false,
  actionProductId: '',
  filter: 'all',
  sort: 'newest',
  message: '',
  error: '',
  dialog: {
    open: false,
    decision: '',
    productId: ''
  }
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

function can(permission = 'admin') {
  if (permission === 'admin') return state.claims.admin === true
  return state.claims[permission] === true
}

function isReviewPath(path = window.location.pathname) {
  const cleanPath = path.replace(/\/+$/, '') || ROUTES.admin
  return cleanPath === ROUTES.adminReviews || cleanPath.startsWith(`${ROUTES.adminReviews}/`) || cleanPath === '/admin/marketplace-review'
}

function reviewDetailProductId() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminReviews}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminReviews}/`.length).split('/')[0] || '').trim()
}

function currentSectionKey() {
  const path = window.location.pathname.replace(/\/+$/, '') || ROUTES.admin
  if (isReviewPath(path)) return 'reviews'
  const section = SECTIONS.find((item) => item.route.replace(/\/+$/, '') === path)
  return section?.key || 'dashboard'
}

function productForId(productId = '') {
  const id = String(productId || '').trim()
  if (!id) return null
  if (state.reviewedProduct?.id === id) return state.reviewedProduct
  return state.products.find((product) => product.id === id) || null
}

function selectedProduct() {
  const detailId = reviewDetailProductId()
  if (detailId) return productForId(detailId)
  return filteredProducts().find((product) => product.id === state.selectedId) || filteredProducts()[0] || state.products[0] || null
}

function filteredProducts() {
  const products = state.products.filter((product) => {
    if (state.filter === 'manual') {
      return product.status === 'review_pending' || product.reviewJobStatus === 'pending_manual_review'
    }
    if (state.filter === 'ai-passed') return product.moderationAISucceeded === true
    if (state.filter === 'ai-error') {
      return ['ai_failed', 'failed_ai_auth'].includes(product.reviewJobStatus) || product.moderationStatus === 'ai_error'
    }
    if (state.filter === 'needs-changes') return product.status === 'needs_changes' || product.moderationStatus === 'needs_changes'
    return true
  })
  return products.sort((a, b) => {
    const aStamp = new Date(a.reviewRequestedAt || a.updatedAt || a.createdAt || 0).getTime() || 0
    const bStamp = new Date(b.reviewRequestedAt || b.updatedAt || b.createdAt || 0).getTime() || 0
    return state.sort === 'oldest' ? aStamp - bStamp : bStamp - aStamp
  })
}

function safeImageUrl(product = {}) {
  const candidates = [
    product.thumbnailURL,
    product.coverURL,
    product.thumbnailPath,
    product.coverPath
  ].map((value) => String(value || '').trim())
  return candidates.find((value) => /^https?:\/\//i.test(value) || value.startsWith('data:image/')) || ''
}

function compactText(value = '', max = 150) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`
}

function aiStatus(product = {}) {
  const reviewJobStatus = String(product.reviewJobStatus || '').toLowerCase()
  const moderationStatus = String(product.moderationStatus || '').toLowerCase()
  if (reviewJobStatus === 'ai_failed' || reviewJobStatus === 'failed_ai_auth' || moderationStatus === 'ai_error') {
    return { label: 'AI Failed', tone: 'bad' }
  }
  if (product.moderationAISucceeded === true) return { label: 'AI Succeeded', tone: 'good' }
  if (product.moderationAIAttempted === true) return { label: 'AI Pending', tone: 'pending' }
  return { label: 'Pending', tone: 'pending' }
}

function renderShell() {
  if (app.querySelector('[data-admin-root]')) return
  app.innerHTML = `
    ${navShell({ currentPage: 'admin' })}
    <main class="admin-console-page">
      <div class="admin-console-shell" data-admin-root></div>
    </main>
  `
  initShellChrome()
}

function renderSignedOut() {
  renderShell()
  app.querySelector('[data-admin-root]').innerHTML = `
    <section class="admin-access-state">
      <h1>Admin Console</h1>
      <p>Sign in with an admin account.</p>
      <a class="admin-primary-link" href="${authRoute({ redirect: ROUTES.admin })}">Sign In</a>
    </section>
  `
}

function renderAccessDenied() {
  renderShell()
  app.querySelector('[data-admin-root]').innerHTML = `
    <section class="admin-access-state">
      <h1>Admin Console</h1>
      <p>This account does not have the admin claim.</p>
      <a class="admin-primary-link" href="${ROUTES.home}">Home</a>
    </section>
  `
}

function sidebar() {
  return `
    <aside class="admin-sidebar" aria-label="Admin sections">
      <div class="admin-sidebar-header">
        <span class="admin-sidebar-kicker">Admin</span>
        <strong>${escapeHtml(state.claims.adminRole || 'staff')}</strong>
      </div>
      <nav class="admin-sidebar-nav">
        ${SECTIONS.map((section) => {
          const active = state.section === section.key
          const allowed = can(section.permission)
          return `<a class="${active ? 'is-active' : ''} ${allowed ? '' : 'is-locked'}" href="${section.route}" ${active ? 'aria-current="page"' : ''} title="${allowed ? section.label : 'Permission required'}">${iconSvg(section.icon)}<span>${section.label}</span></a>`
        }).join('')}
      </nav>
    </aside>
  `
}

function statusMessage() {
  return `
    ${state.message ? `<p class="admin-status is-success">${escapeHtml(state.message)}</p>` : ''}
    ${state.error ? `<p class="admin-status is-error">${escapeHtml(state.error)}</p>` : ''}
  `
}

function renderLayout(content) {
  renderShell()
  app.querySelector('[data-admin-root]').innerHTML = `
    ${sidebar()}
    <section class="admin-main ${reviewDetailProductId() ? 'admin-main-detail' : ''}">
      ${statusMessage()}
      ${content}
    </section>
  `
  bindEvents()
}

function dashboardView() {
  const permissionCount = ['productReview', 'listingEdit', 'userRead', 'userModerate', 'orderSupport', 'roleManage', 'auditRead']
    .filter((permission) => state.claims[permission] === true).length
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Console</p>
        <h1>Overview</h1>
      </div>
      <button type="button" class="admin-icon-button" data-refresh-queue title="Refresh review queue">${iconSvg('barChart')}</button>
    </header>
    <section class="admin-metric-grid">
      <article class="admin-metric"><span>Role</span><strong>${escapeHtml(state.claims.adminRole || 'admin')}</strong></article>
      <article class="admin-metric"><span>Review Queue</span><strong>${state.queueLoaded ? state.products.length : '...'}</strong></article>
      <article class="admin-metric"><span>Permissions</span><strong>${permissionCount}</strong></article>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <h2>Review Snapshot</h2>
        <a href="${ROUTES.adminReviews}">View all</a>
      </div>
      ${can('productReview') ? reviewQueueGrid(true) : permissionState('productReview')}
    </section>
  `
}

function permissionState(permission) {
  return `<div class="admin-empty-state"><strong>Permission required</strong><span>${escapeHtml(permission)}</span></div>`
}

function reviewQueueGrid(compact = false) {
  const products = compact ? filteredProducts().slice(0, 6) : filteredProducts()
  if (state.loadingQueue) return '<article class="admin-empty-state">Loading review queue...</article>'
  if (!products.length) return '<article class="admin-empty-state">No products match this queue.</article>'
  return `<section class="review-grid ${compact ? 'is-compact' : ''}" aria-label="Marketplace review queue">${products.map(productCard).join('')}</section>`
}

function reviewsView() {
  const productId = reviewDetailProductId()
  if (productId) return reviewDetailView(productId)
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Marketplace</p>
        <h1>Reviews</h1>
      </div>
      <button type="button" class="admin-icon-button" data-refresh-queue title="Refresh review queue">${iconSvg('barChart')}</button>
    </header>
    ${can('productReview') ? `
      <section class="admin-review-tools">
        <div class="admin-segmented" role="group" aria-label="Review filter">
          ${REVIEW_FILTERS.map((filter) => `<button type="button" data-review-filter="${filter.key}" aria-pressed="${state.filter === filter.key}">${filter.label}</button>`).join('')}
        </div>
        <select data-review-sort aria-label="Review sort">
          <option value="newest" ${state.sort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="oldest" ${state.sort === 'oldest' ? 'selected' : ''}>Oldest</option>
        </select>
      </section>
      ${reviewQueueGrid()}
    ` : permissionState('productReview')}
  `
}

function productCard(product) {
  const imageUrl = safeImageUrl(product)
  const status = aiStatus(product)
  const summary = compactText(product.moderationSummary || product.moderationReasons?.join(', ') || 'No AI notes recorded.', 145)
  return `
    <article class="review-card" data-review-product="${escapeHtml(product.id)}">
      <div class="review-card-media">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.title)} cover" loading="lazy" decoding="async" />`
          : `<span>${iconSvg('image')}</span>`}
      </div>
      <div class="review-card-body">
        <div class="review-card-title-row">
          <h3>${escapeHtml(product.title)}</h3>
          <span class="ai-pill is-${status.tone}">${escapeHtml(status.label)}</span>
        </div>
        <p class="review-card-creator">${escapeHtml(product.artistName || product.artistDisplayName || 'Creator')}</p>
        <p class="review-card-meta">${escapeHtml(product.productType || 'Product')} · ${escapeHtml(formatMoney(product.priceCents, product.currency))}</p>
        <div class="review-card-badges">
          <span class="review-badge is-${escapeHtml(statusClass(product.status))}">${escapeHtml(product.status || 'unknown')}</span>
          <span class="review-badge">${escapeHtml(product.reviewJobStatus || product.moderationStatus || 'review')}</span>
        </div>
        <p class="review-card-summary">${escapeHtml(summary)}</p>
        <dl class="review-card-facts">
          <div><dt>Requested</dt><dd>${escapeHtml(formatDate(product.reviewRequestedAt || product.updatedAt || product.createdAt))}</dd></div>
          <div><dt>Files</dt><dd>${Number(product.assetSummary?.totalFiles || 0)} · ${escapeHtml(formatBytes(product.assetSummary?.totalBytes || 0))}</dd></div>
        </dl>
        <a class="admin-primary-link review-audit-link" href="${adminReviewRoute(product.id)}" data-audit-product="${escapeHtml(product.id)}">${iconSvg('eye')}<span>Audit Product</span></a>
      </div>
    </article>
  `
}

function valueMarkup(value) {
  if (value === true) return '<span class="admin-value-true">true</span>'
  if (value === false) return '<span class="admin-value-false">false</span>'
  if (value === null || value === undefined || value === '') return '<span class="admin-muted">Not set</span>'
  return escapeHtml(value)
}

function detailList(rows = []) {
  return `
    <dl class="admin-detail-list">
      ${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${valueMarkup(value)}</dd></div>`).join('')}
    </dl>
  `
}

function codeList(items = [], empty = 'No paths recorded.') {
  const values = items.map((item) => String(item || '').trim()).filter(Boolean)
  if (!values.length) return `<p class="admin-muted">${escapeHtml(empty)}</p>`
  return `<div class="review-path-list">${values.map((item) => `<code>${escapeHtml(item)}</code>`).join('')}</div>`
}

function assetSummaryList(product = {}) {
  const summary = product.assetSummary || {}
  return detailList([
    ['Total files', Number(summary.totalFiles || 0)],
    ['Downloadable', Number(summary.downloadableCount || 0)],
    ['Previewable', Number(summary.previewableCount || 0)],
    ['Total bytes', formatBytes(summary.totalBytes || 0)]
  ])
}

function mediaPanel(product = {}) {
  const imageUrl = safeImageUrl(product)
  const gallery = product.galleryPaths || []
  const audio = [
    ...(product.previewAudioPaths || []),
    product.previewAssignment?.hoverAudioPath
  ].filter(Boolean)
  const video = [
    ...(product.previewVideoPaths || []),
    product.previewAssignment?.hoverVideoPath,
    product.previewAssignment?.demoReelPath,
    product.previewAssignment?.detailHeroPreviewPath
  ].filter(Boolean)
  return `
    <section class="admin-audit-panel admin-media-panel">
      <h2>Media</h2>
      <div class="admin-media-preview">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.title)} cover" loading="lazy" decoding="async" />`
          : `<div class="admin-media-placeholder">${iconSvg('image')}<span>No cover image</span></div>`}
      </div>
      <h3>Cover and thumbnail paths</h3>
      ${codeList([product.thumbnailPath, product.coverPath], 'No cover or thumbnail paths.')}
      <h3>Gallery image paths</h3>
      ${codeList(gallery, 'No gallery paths.')}
      <h3>Preview audio paths</h3>
      ${codeList(audio, 'No preview audio paths.')}
      <h3>Preview video paths</h3>
      ${codeList(video, 'No preview video paths.')}
    </section>
  `
}

function filesPanel(product = {}) {
  const files = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  return `
    <section class="admin-audit-panel">
      <h2>Files</h2>
      ${assetSummaryList(product)}
      <div class="admin-file-table">
        ${files.length ? files.map((file) => `
          <article class="admin-file-row">
            <strong>${escapeHtml(file.displayPath || file.name || 'File')}</strong>
            <span>${escapeHtml(formatBytes(file.sizeBytes || 0))}</span>
            <span>${escapeHtml(file.contentType || 'Unknown type')}</span>
            <span>${file.downloadable ? 'Downloadable' : 'Not downloadable'} · ${file.previewable ? 'Previewable' : 'Not previewable'}</span>
            <code>${escapeHtml(file.storagePath || '')}</code>
          </article>
        `).join('') : '<p class="admin-muted">No deliverable file rows. Check asset summary and manifest.</p>'}
      </div>
    </section>
  `
}

function moderationPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>AI Moderation</h2>
      ${detailList([
        ['Attempted', Boolean(product.moderationAIAttempted)],
        ['Succeeded', Boolean(product.moderationAISucceeded)],
        ['Configured', Boolean(product.moderationAIConfigured)],
        ['Enabled', Boolean(product.moderationAIEnabled)],
        ['Model', product.moderationAIModel],
        ['Moderation status', product.moderationStatus],
        ['Risk level', product.moderationRiskLevel],
        ['Review job status', product.reviewJobStatus],
        ['Completed at', product.moderationAICompletedAt],
        ['Failed at', product.moderationAIFailedAt],
        ['Error code', product.moderationAIErrorCode],
        ['Error category', product.moderationAIErrorCategory],
        ['Error', product.moderationAIError]
      ])}
      <h3>Summary</h3>
      <p>${escapeHtml(product.moderationSummary || 'No moderation summary recorded.')}</p>
      <h3>Reasons</h3>
      <div class="review-reason-list">${(product.moderationReasons || []).map((reason) => `<span>${escapeHtml(reason)}</span>`).join('') || '<span>No reasons</span>'}</div>
    </section>
  `
}

function sellerPanel(product = {}) {
  const agreement = product.sellerAgreement || {}
  return `
    <section class="admin-audit-panel">
      <h2>Pricing and Seller Agreement</h2>
      ${detailList([
        ['Price', formatMoney(product.priceCents, product.currency)],
        ['priceCents', Number(product.priceCents || 0)],
        ['payoutTargetCents', Number(product.payoutTargetCents || 0)],
        ['Currency', product.currency],
        ['Free', Boolean(product.isFree)],
        ['Agreement accepted', Boolean(product.sellerAgreementAccepted || agreement.accepted)],
        ['Agreement version', product.sellerAgreementVersion || agreement.version],
        ['Agreement id', agreement.agreementId],
        ['Accepted at', agreement.acceptedAt]
      ])}
    </section>
  `
}

function identityPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>Product Identity</h2>
      ${detailList([
        ['Title', product.title],
        ['Slug', product.slug],
        ['Product ID', product.id],
        ['Artist ID', product.artistId],
        ['Artist name', product.artistName || product.artistDisplayName],
        ['Artist username', product.artistUsername],
        ['Artist profile path', product.artistProfilePath],
        ['Status', product.status],
        ['Visibility', product.visibility],
        ['Product type', product.productType],
        ['Product kind', product.productKind],
        ['Usage license', product.usageLicense],
        ['Version', product.version],
        ['Created at', product.createdAt],
        ['Updated at', product.updatedAt],
        ['Review requested at', product.reviewRequestedAt],
        ['Review requested by', product.reviewRequestedBy]
      ])}
    </section>
  `
}

function adminHistoryPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>Admin History</h2>
      ${detailList([
        ['Prior decision', product.reviewDecision],
        ['Reviewed at', product.reviewedAt],
        ['Reviewed by', product.reviewedBy],
        ['Review reason', product.reviewReason],
        ['Review notes', product.reviewNotes]
      ])}
      <p class="admin-muted">Full audit log browsing is reserved for the Logs section. New decisions write adminLogs and productModeration events.</p>
    </section>
  `
}

function creatorContextPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>Creator Context</h2>
      ${detailList([
        ['Artist ID', product.artistId],
        ['Artist name', product.artistName || product.artistDisplayName],
        ['Username', product.artistUsername],
        ['Profile path', product.artistProfilePath]
      ])}
      <div class="admin-detail-actions">
        ${product.artistId ? `<a class="admin-secondary-link" href="${publicProfileRoute({ uid: product.artistId, preview: true })}" target="_blank" rel="noreferrer">${iconSvg('eye')}<span>View Creator Profile</span></a>` : ''}
        <a class="admin-secondary-link" href="${ROUTES.adminUsers}">${iconSvg('messageCircle')}<span>Creator History Tools</span></a>
      </div>
    </section>
  `
}

function detailDecisionBar(product = {}) {
  const busy = state.actionProductId === product.id
  return `
    <section class="admin-decision-bar" aria-label="Review decision actions">
      <div>
        <strong>${escapeHtml(product.title || 'Product')}</strong>
        <span>${escapeHtml(product.status || 'unknown')} / ${escapeHtml(product.visibility || 'unknown')}</span>
      </div>
      <div class="admin-decision-actions">
        <button type="button" class="admin-decision-button is-pass" data-detail-decision="approve" ${busy ? 'disabled aria-busy="true"' : ''}>Pass</button>
        <button type="button" class="admin-decision-button is-reject" data-detail-decision="reject" ${busy ? 'disabled aria-busy="true"' : ''}>Reject</button>
        <button type="button" class="admin-decision-button is-return" data-detail-decision="request_changes" ${busy ? 'disabled aria-busy="true"' : ''}>Return</button>
      </div>
    </section>
  `
}

function decisionDialog(product = {}) {
  if (!state.dialog.open) return ''
  const decision = state.dialog.decision
  const isReturn = decision === 'request_changes'
  const label = DECISION_LABELS[decision] || 'Decision'
  return `
    <div class="admin-modal-backdrop" role="presentation">
      <section class="admin-decision-modal" role="dialog" aria-modal="true" aria-labelledby="decision-modal-title">
        <header>
          <h2 id="decision-modal-title">${escapeHtml(label)} ${escapeHtml(product.title || 'Product')}</h2>
          <button type="button" class="admin-icon-button" data-close-decision-dialog title="Close">${iconSvg('x')}</button>
        </header>
        <form data-decision-form>
          <label>
            <span>${isReturn ? 'Creator-facing reason' : 'Reject reason'}</span>
            <textarea data-decision-reason required maxlength="1200" rows="4" placeholder="${isReturn ? 'It seems like this description does not pertain to the product listing. Try changing it to make it match the actual product.' : 'Explain why this product is rejected.'}"></textarea>
          </label>
          <label>
            <span>${isReturn ? 'Creator notes' : 'Internal notes'}</span>
            <textarea data-decision-notes ${isReturn ? 'required' : ''} maxlength="2400" rows="4" placeholder="${isReturn ? 'These notes will be sent to the creator.' : 'Optional internal context.'}"></textarea>
          </label>
          <div class="admin-modal-actions">
            <button type="button" class="admin-secondary-button" data-close-decision-dialog>Cancel</button>
            <button type="submit" class="admin-primary-button">${escapeHtml(label)}</button>
          </div>
        </form>
      </section>
    </div>
  `
}

function reviewDetailView(productId) {
  if (!can('productReview')) return permissionState('productReview')
  const product = productForId(productId)
  if (!state.queueLoaded || state.loadingQueue) {
    return '<article class="admin-empty-state">Loading product review data...</article>'
  }
  if (!product) {
    return `
      <article class="admin-empty-state">
        <strong>Product is not in the current review queue.</strong>
        <span>${escapeHtml(productId)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminReviews}">Back to Reviews</a>
      </article>
    `
  }
  const isPublic = product.status === 'published' && product.visibility === 'public'
  return `
    <header class="admin-page-header admin-detail-header">
      <div>
        <p class="eyebrow">Product Audit</p>
        <h1>${escapeHtml(product.title)}</h1>
        <p>${escapeHtml(product.id)} · ${escapeHtml(product.artistName || 'Creator')}</p>
      </div>
      <div class="admin-detail-actions">
        <a class="admin-secondary-link" href="${ROUTES.adminReviews}">${iconSvg('arrowLeft')}<span>Back</span></a>
        ${isPublic ? `<a class="admin-secondary-link" href="${productRoute(product)}" target="_blank" rel="noreferrer">${iconSvg('eye')}<span>Public Route</span></a>` : ''}
      </div>
    </header>
    <section class="admin-audit-layout">
      ${mediaPanel(product)}
      ${identityPanel(product)}
      ${filesPanel(product)}
      ${sellerPanel(product)}
      ${moderationPanel(product)}
      ${adminHistoryPanel(product)}
      ${creatorContextPanel(product)}
    </section>
    ${detailDecisionBar(product)}
    ${decisionDialog(product)}
  `
}

function placeholderView(sectionKey) {
  const section = SECTIONS.find((item) => item.key === sectionKey) || SECTIONS[0]
  if (!can(section.permission)) return permissionState(section.permission)
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Admin</p>
        <h1>${escapeHtml(section.label)}</h1>
      </div>
    </header>
    <section class="admin-section-slab">
      <h2>${escapeHtml(section.label)}</h2>
      <p class="admin-muted">Reserved for the next admin phase.</p>
    </section>
  `
}

function teamView() {
  if (!can('roleManage')) return permissionState('roleManage')
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Access</p>
        <h1>Team</h1>
      </div>
    </header>
    <section class="admin-section-slab">
      <form class="admin-role-form" data-admin-role-form>
        <label>
          <span>User UID</span>
          <input data-role-uid autocomplete="off" required />
        </label>
        <label>
          <span>Role</span>
          <select data-role-select>
            <option value="owner">Owner</option>
            <option value="admin">Admin</option>
            <option value="marketplaceReviewer">Marketplace Reviewer</option>
            <option value="support">Support</option>
            <option value="auditor">Auditor</option>
            <option value="remove">Remove</option>
          </select>
        </label>
        <label>
          <span>Reason</span>
          <input data-role-reason autocomplete="off" maxlength="1200" />
        </label>
        <button type="submit" class="admin-primary-button">${iconSvg('checkCircle')}<span>Save Role</span></button>
      </form>
    </section>
  `
}

function render() {
  state.section = currentSectionKey()
  if (state.section === 'dashboard') return renderLayout(dashboardView())
  if (state.section === 'reviews') return renderLayout(reviewsView())
  if (state.section === 'team') return renderLayout(teamView())
  return renderLayout(placeholderView(state.section))
}

async function loadQueue({ silent = false } = {}) {
  if (!can('productReview')) return
  state.loadingQueue = !silent
  state.error = ''
  render()
  try {
    const result = await listMarketplaceReviewQueue({ limitCount: 100 })
    state.products = result.products || []
    state.queueLoaded = true
    const visible = filteredProducts()
    const detailId = reviewDetailProductId()
    if (detailId) {
      state.selectedId = detailId
    } else if (!visible.some((product) => product.id === state.selectedId)) {
      state.selectedId = visible[0]?.id || state.products[0]?.id || ''
    }
  } catch (error) {
    console.warn('[admin] review queue load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.code === 'functions/permission-denied'
      ? 'This account is not authorized for marketplace review.'
      : 'Could not load the marketplace review queue.'
  } finally {
    state.loadingQueue = false
    render()
  }
}

function closeDecisionDialog() {
  state.dialog = { open: false, decision: '', productId: '' }
  render()
}

function openDecisionDialog(productId, decision) {
  state.dialog = { open: true, productId, decision }
  state.error = ''
  state.message = ''
  render()
  app.querySelector('[data-decision-reason]')?.focus()
}

function updateProductAfterDecision(productId, result, decision, reason, notes) {
  const existing = productForId(productId) || { id: productId }
  const updated = {
    ...existing,
    status: result.status || existing.status,
    visibility: result.visibility || existing.visibility,
    moderationStatus: result.moderationStatus || existing.moderationStatus,
    reviewJobStatus: result.reviewJobStatus || existing.reviewJobStatus,
    reviewDecision: decision,
    reviewReason: reason,
    reviewNotes: notes,
    reviewedBy: state.currentUser?.uid || existing.reviewedBy || '',
    reviewedAt: new Date().toISOString()
  }
  state.reviewedProduct = updated
  if (updated.status === 'published' || updated.status === 'rejected') {
    state.products = state.products.filter((product) => product.id !== productId)
    return
  }
  state.products = state.products.map((product) => product.id === productId ? updated : product)
}

async function submitDecision(productId, decision, { reason = '', notes = '' } = {}) {
  const cleanReason = String(reason || '').trim()
  const cleanNotes = String(notes || '').trim()
  if (['reject', 'request_changes'].includes(decision) && !cleanReason) {
    state.error = 'A reason is required for this review decision.'
    render()
    return
  }
  if (decision === 'request_changes' && !cleanNotes) {
    state.error = 'Creator notes are required when returning a product.'
    render()
    return
  }
  state.actionProductId = productId
  state.message = ''
  state.error = ''
  render()
  try {
    const result = await reviewProductDecision({ productId, decision, reason: cleanReason, notes: cleanNotes })
    updateProductAfterDecision(productId, result, decision, cleanReason, cleanNotes)
    state.message = `${DECISION_LABELS[decision] || 'Decision'} saved for ${productId}.`
    state.dialog = { open: false, decision: '', productId: '' }
  } catch (error) {
    console.warn('[admin] review decision failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not apply the review decision.'
  } finally {
    state.actionProductId = ''
    render()
  }
}

async function submitRoleForm(form) {
  const uid = form.querySelector('[data-role-uid]')?.value || ''
  const role = form.querySelector('[data-role-select]')?.value || ''
  const reason = form.querySelector('[data-role-reason]')?.value || ''
  state.message = ''
  state.error = ''
  render()
  try {
    const result = await setAdminUserRole({ uid, role, active: role !== 'remove', reason })
    state.message = result.active
      ? `Admin role ${result.role} saved for ${result.uid}.`
      : `Admin role removed for ${result.uid}.`
    render()
  } catch (error) {
    console.warn('[admin] role update failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not update admin role.'
    render()
  }
}

function navigateToReviewProduct(productId) {
  const target = adminReviewRoute(productId)
  if (window.location.pathname !== target) window.history.pushState({}, '', target)
  state.selectedId = productId
  state.dialog = { open: false, decision: '', productId: '' }
  render()
}

function bindEvents() {
  app.querySelector('[data-refresh-queue]')?.addEventListener('click', () => loadQueue())
  app.querySelectorAll('[data-audit-product]').forEach((link) => {
    link.addEventListener('click', (event) => {
      const productId = link.getAttribute('data-audit-product') || ''
      if (!productId) return
      event.preventDefault()
      navigateToReviewProduct(productId)
    })
  })
  app.querySelectorAll('[data-review-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.getAttribute('data-review-filter') || 'all'
      state.selectedId = filteredProducts()[0]?.id || ''
      render()
    })
  })
  app.querySelector('[data-review-sort]')?.addEventListener('change', (event) => {
    state.sort = event.target.value === 'oldest' ? 'oldest' : 'newest'
    render()
  })
  app.querySelectorAll('[data-detail-decision]').forEach((button) => {
    button.addEventListener('click', () => {
      const product = selectedProduct()
      const decision = button.getAttribute('data-detail-decision') || ''
      if (!product?.id || state.actionProductId) return
      if (decision === 'approve') {
        submitDecision(product.id, 'approve')
        return
      }
      openDecisionDialog(product.id, decision)
    })
  })
  app.querySelectorAll('[data-close-decision-dialog]').forEach((button) => {
    button.addEventListener('click', closeDecisionDialog)
  })
  app.querySelector('[data-decision-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const reason = form.querySelector('[data-decision-reason]')?.value || ''
    const notes = form.querySelector('[data-decision-notes]')?.value || ''
    submitDecision(state.dialog.productId, state.dialog.decision, { reason, notes })
  })
  app.querySelector('[data-admin-role-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitRoleForm(event.currentTarget)
  })
}

async function init() {
  renderShell()
  state.currentUser = await waitForInitialAuthState()
  if (!state.currentUser?.uid) {
    renderSignedOut()
    return
  }
  const tokenResult = await state.currentUser.getIdTokenResult(true)
  state.claims = tokenResult?.claims || {}
  if (state.claims.admin !== true) {
    renderAccessDenied()
    return
  }
  state.section = currentSectionKey()
  render()
  if (can('productReview') && ['dashboard', 'reviews'].includes(state.section)) {
    await loadQueue()
  }
}

window.addEventListener('popstate', () => {
  if (state.claims.admin === true) render()
})

init()
