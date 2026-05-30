import './styles/base.css'
import './styles/admin.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { listMarketplaceReviewQueue, reviewProductDecision, setAdminUserRole } from './data/productService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, productRoute } from './utils/routes'
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

const state = {
  currentUser: null,
  claims: {},
  section: 'dashboard',
  products: [],
  selectedId: '',
  loadingQueue: false,
  queueLoaded: false,
  actionProductId: '',
  filter: 'all',
  sort: 'newest',
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

function cssEscape(value = '') {
  return window.CSS?.escape ? window.CSS.escape(String(value)) : String(value).replace(/"/g, '\\"')
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

function currentSectionKey() {
  const path = window.location.pathname.replace(/\/+$/, '') || ROUTES.admin
  if (path === '/admin/marketplace-review') return 'reviews'
  const section = SECTIONS.find((item) => item.route.replace(/\/+$/, '') === path)
  return section?.key || 'dashboard'
}

function selectedProduct() {
  const visible = filteredProducts()
  return visible.find((product) => product.id === state.selectedId) || visible[0] || state.products[0] || null
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
  const root = app.querySelector('[data-admin-root]')
  root.innerHTML = `
    <section class="admin-access-state">
      <h1>Admin Console</h1>
      <p>Sign in with an admin account.</p>
      <a class="admin-primary-link" href="${authRoute({ redirect: ROUTES.admin })}">Sign In</a>
    </section>
  `
}

function renderAccessDenied() {
  renderShell()
  const root = app.querySelector('[data-admin-root]')
  root.innerHTML = `
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
  const root = app.querySelector('[data-admin-root]')
  root.innerHTML = `
    ${sidebar()}
    <section class="admin-main">
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
      <h2>Review Snapshot</h2>
      ${can('productReview') ? reviewQueueList(true) : permissionState('productReview')}
    </section>
  `
}

function permissionState(permission) {
  return `<div class="admin-empty-state"><strong>Permission required</strong><span>${escapeHtml(permission)}</span></div>`
}

function reviewQueueList(compact = false) {
  const products = compact ? filteredProducts().slice(0, 5) : filteredProducts()
  if (state.loadingQueue) return '<article class="admin-empty-state">Loading review queue...</article>'
  if (!products.length) return '<article class="admin-empty-state">No products match this queue.</article>'
  return `<section class="${compact ? 'review-queue is-compact' : 'review-queue'}">${products.map(productCard).join('')}</section>`
}

function reviewsView() {
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
      <div class="admin-review-layout">
        ${reviewQueueList()}
        ${previewPanel(selectedProduct())}
      </div>
    ` : permissionState('productReview')}
  `
}

function productCard(product) {
  const selected = selectedProduct()?.id === product.id
  const reasons = product.moderationReasons?.length ? product.moderationReasons.join(', ') : 'No reasons returned'
  const busy = state.actionProductId === product.id
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
        <button type="button" class="review-action is-approve" data-review-decision="${escapeHtml(product.id)}:approve" title="Approve and publish" ${busy ? 'disabled aria-busy="true"' : ''}>${iconSvg('checkCircle')}<span>Approve</span></button>
        <button type="button" class="review-action" data-review-decision="${escapeHtml(product.id)}:request_changes" title="Request changes" ${busy ? 'disabled aria-busy="true"' : ''}>${iconSvg('edit')}<span>Changes</span></button>
        <button type="button" class="review-action is-danger" data-review-decision="${escapeHtml(product.id)}:reject" title="Reject" ${busy ? 'disabled aria-busy="true"' : ''}>${iconSvg('x')}<span>Reject</span></button>
        <button type="button" class="review-action" data-review-decision="${escapeHtml(product.id)}:keep_pending" title="Keep pending" ${busy ? 'disabled aria-busy="true"' : ''}>${iconSvg('alertCircle')}<span>Pending</span></button>
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
    product.downloadPath,
    product.primaryDownloadPath,
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
          : `<span class="review-private-note">${iconSvg('lock')}<span>Private preview</span></span>`}
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
          <p class="review-muted">Model: ${escapeHtml(product.moderationAIModel || 'Not recorded')}</p>
          <div class="review-reason-list">${(product.moderationReasons || []).map((reason) => `<span>${escapeHtml(reason)}</span>`).join('') || '<span>No reasons</span>'}</div>
        </article>
      </div>
      <section class="review-preview-section">
        <h3>Files</h3>
        <ul class="review-file-list">${deliverables}</ul>
      </section>
      <section class="review-preview-section">
        <h3>Paths</h3>
        <div class="review-path-list">${previewPaths.length ? previewPaths.map((path) => `<code>${escapeHtml(path)}</code>`).join('') : '<span>No media paths</span>'}</div>
      </section>
      <section class="review-preview-section">
        <h3>Description</h3>
        <p>${escapeHtml(product.description || product.shortDescription || 'No full description provided.')}</p>
      </section>
    </section>
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
    if (!visible.some((product) => product.id === state.selectedId)) {
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

async function submitDecision(productId, decision) {
  const reason = app.querySelector(`[data-review-reason="${cssEscape(productId)}"]`)?.value || ''
  const notes = app.querySelector(`[data-review-notes="${cssEscape(productId)}"]`)?.value || ''
  state.actionProductId = productId
  state.message = ''
  state.error = ''
  render()
  try {
    const result = await reviewProductDecision({ productId, decision, reason, notes })
    state.message = `${result.status || 'Product'} saved for ${productId}.`
    state.actionProductId = ''
    await loadQueue({ silent: true })
  } catch (error) {
    console.warn('[admin] review decision failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not apply the review decision.'
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

init()
