import './styles/base.css'
import './styles/admin.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { listMarketplaceReviewQueue, reviewProductDecision, setAdminUserRole } from './data/productService'
import { waitForInitialAuthState } from './firebase/auth'
import { getStorageAssetUrl } from './firebase/storageAssets'
import { ROUTES, adminReviewRoute, authRoute, productRoute, publicProfileRoute } from './utils/routes'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')
const ADMIN_THEME_KEY = 'melogic-admin-theme'

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

const DISPLAYED_PRODUCT_KEYS = new Set([
  'id', 'slug', 'title', 'artistId', 'artistName', 'artistDisplayName', 'artistUsername', 'artistProfilePath',
  'status', 'visibility', 'productType', 'productKind', 'version', 'usageLicense', 'createdAt', 'updatedAt',
  'reviewRequestedAt', 'reviewRequestedBy', 'reviewedAt', 'reviewedBy', 'publishedAt', 'releasedAt',
  'shortDescription', 'description', 'includedFiles', 'compatibilityNotes', 'formatNotes', 'categories',
  'categoryKeys', 'genres', 'genreKeys', 'tags', 'tagKeys', 'searchKeywords', 'dawCompatibility',
  'formatKeys', 'coverPath', 'thumbnailPath', 'coverURL', 'thumbnailURL', 'galleryPaths', 'previewAudioPaths',
  'previewVideoPaths', 'previewAssignment', 'downloadPath', 'primaryDownloadPath', 'primaryDownloadBytes',
  'licensePath', 'assetSummary', 'deliverableFiles', 'priceCents', 'payoutTargetCents', 'currency', 'isFree',
  'sellerAgreementAccepted', 'sellerAgreementVersion', 'sellerAgreement', 'moderationAIAttempted',
  'moderationAISucceeded', 'moderationAIConfigured', 'moderationAIEnabled', 'moderationAIModel',
  'moderationStatus', 'moderationRiskLevel', 'moderationSummary', 'moderationReasons', 'moderationAIError',
  'moderationAIErrorCode', 'moderationAIErrorCategory', 'moderationAICompletedAt', 'moderationAIFailedAt',
  'reviewJobStatus', 'contributorIds', 'contributorNames', 'contributorCount', 'pendingContributorIds',
  'contributorRequestCount', 'likeCount', 'dislikeCount', 'saveCount', 'shareCount', 'commentCount',
  'downloadCount', 'followCount', 'salesCount', 'revenue', 'entitlementCount', 'counts', 'reviewDecision',
  'priorDecision', 'reviewReason', 'reviewNotes', 'additionalProductFields', 'distributionMode', 'previewMode'
])

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
  theme: 'light',
  mediaByProductId: {},
  mediaRequests: {},
  dialog: {
    open: false,
    decision: '',
    productId: ''
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function readAdminTheme() {
  try {
    const value = window.localStorage?.getItem(ADMIN_THEME_KEY)
    return value === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function applyAdminTheme(theme = 'light') {
  const nextTheme = theme === 'dark' ? 'dark' : 'light'
  state.theme = nextTheme
  document.documentElement.dataset.adminTheme = nextTheme
  try {
    window.localStorage?.setItem(ADMIN_THEME_KEY, nextTheme)
  } catch {
    // localStorage can be unavailable in private contexts; the attribute still applies for this session.
  }
}

applyAdminTheme(readAdminTheme())

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

function isDirectUrl(value = '') {
  const text = String(value || '').trim()
  return /^https?:\/\//i.test(text) || text.startsWith('data:')
}

function normalizeList(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean) : []
}

function isResolvablePreviewPath(path = '') {
  const value = String(path || '').trim()
  if (!value || isDirectUrl(value)) return false
  if (value.includes('..')) return false
  if (/\/(downloads|files|licenses)\//i.test(value)) return false
  return /^products\/[^/]+\/(thumbnails|cover|gallery|audio-previews|video-previews)\//i.test(value)
}

function mediaForProduct(product = {}) {
  return state.mediaByProductId[String(product.id || '')] || {}
}

function safeImageUrl(product = {}) {
  const media = mediaForProduct(product)
  const candidates = [
    media.thumbnailUrl,
    media.coverUrl,
    product.thumbnailURL,
    product.coverURL
  ].map((value) => String(value || '').trim())
  return candidates.find((value) => /^https?:\/\//i.test(value) || value.startsWith('data:image/')) || ''
}

async function resolveAdminMediaUrl({ url = '', path = '', label = '', warnings = [] } = {}) {
  const directUrl = String(url || '').trim()
  if (isDirectUrl(directUrl)) return directUrl
  const cleanPath = String(path || '').trim()
  if (!cleanPath) return ''
  if (isDirectUrl(cleanPath)) return cleanPath
  if (!isResolvablePreviewPath(cleanPath)) {
    warnings.push(`${label || 'Media'} path is not a public preview path.`)
    return ''
  }
  const resolved = await getStorageAssetUrl(cleanPath, { warnOnFail: false })
  if (!resolved) warnings.push(`${label || 'Media'} could not be resolved from Storage.`)
  return resolved || ''
}

async function resolveProductMediaForAdmin(product = {}, { detail = false } = {}) {
  if (!product?.id) return
  const existing = state.mediaByProductId[product.id] || {}
  if (existing.detailReady && detail) return
  if (existing.queueReady && !detail) return

  const warnings = []
  const coverUrl = await resolveAdminMediaUrl({
    url: product.coverURL,
    path: product.coverPath,
    label: 'Cover',
    warnings
  })
  const thumbnailUrl = await resolveAdminMediaUrl({
    url: product.thumbnailURL,
    path: product.thumbnailPath || product.coverPath,
    label: 'Thumbnail',
    warnings
  }) || coverUrl

  const next = {
    ...existing,
    coverUrl,
    thumbnailUrl,
    queueReady: true,
    warnings
  }

  if (detail) {
    const previewAssignment = product.previewAssignment || {}
    const galleryPaths = normalizeList(product.galleryPaths)
    const audioPaths = [
      ...normalizeList(product.previewAudioPaths),
      previewAssignment.hoverAudioPath
    ].filter(Boolean)
    const videoPaths = [
      ...normalizeList(product.previewVideoPaths),
      previewAssignment.hoverVideoPath,
      previewAssignment.demoReelPath,
      previewAssignment.detailHeroPreviewPath
    ].filter(Boolean)
    const galleryUrls = await Promise.all(galleryPaths.map((path, index) => resolveAdminMediaUrl({ path, label: `Gallery ${index + 1}`, warnings })))
    const audioUrls = await Promise.all(audioPaths.map((path, index) => resolveAdminMediaUrl({ path, label: `Audio preview ${index + 1}`, warnings })))
    const videoUrls = await Promise.all(videoPaths.map((path, index) => resolveAdminMediaUrl({ path, label: `Video preview ${index + 1}`, warnings })))
    next.gallery = galleryPaths.map((path, index) => ({ path, url: galleryUrls[index] || '' }))
    next.audio = audioPaths.map((path, index) => ({ path, url: audioUrls[index] || '' }))
    next.video = videoPaths.map((path, index) => ({ path, url: videoUrls[index] || '' }))
    next.detailReady = true
  }

  state.mediaByProductId = {
    ...state.mediaByProductId,
    [product.id]: next
  }
}

async function hydrateReviewMedia(products = [], { detailProductId = '' } = {}) {
  await Promise.all(products.map((product) => resolveProductMediaForAdmin(product)))
  const detailProduct = detailProductId ? products.find((product) => product.id === detailProductId) : null
  if (detailProduct) await resolveProductMediaForAdmin(detailProduct, { detail: true })
}

function ensureDetailMedia(productId = '') {
  const product = productForId(productId)
  if (!product?.id) return
  const media = mediaForProduct(product)
  if (media.detailReady || state.mediaRequests[product.id]) return
  state.mediaRequests = { ...state.mediaRequests, [product.id]: true }
  resolveProductMediaForAdmin(product, { detail: true })
    .catch((error) => {
      console.warn('[admin] media resolution failed', { productId: product.id, message: error?.message || error })
    })
    .finally(() => {
      const requests = { ...state.mediaRequests }
      delete requests[product.id]
      state.mediaRequests = requests
      render()
    })
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

function themeToggleButton() {
  const isDark = state.theme === 'dark'
  return `
    <div class="admin-top-toolbar">
      <button type="button" class="admin-theme-toggle" data-admin-theme-toggle aria-label="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}" title="${isDark ? 'Switch to light mode' : 'Switch to dark mode'}">
        ${iconSvg(isDark ? 'sun' : 'moon')}
      </button>
    </div>
  `
}

function renderLayout(content) {
  renderShell()
  app.querySelector('[data-admin-root]').innerHTML = `
    ${sidebar()}
    <section class="admin-main ${reviewDetailProductId() ? 'admin-main-detail' : ''}">
      ${themeToggleButton()}
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

function valueMarkup(value, { preserveLines = false } = {}) {
  if (value === true) return '<span class="admin-value-true">true</span>'
  if (value === false) return '<span class="admin-value-false">false</span>'
  if (value === null || value === undefined || value === '') return '<span class="admin-muted">Not set</span>'
  if (Array.isArray(value)) return value.length ? escapeHtml(value.join(', ')) : '<span class="admin-muted">None</span>'
  if (typeof value === 'object') return `<code class="admin-code-value">${escapeHtml(JSON.stringify(value))}</code>`
  const escaped = escapeHtml(value)
  return preserveLines ? escaped.replace(/\n/g, '<br>') : escaped
}

function renderField(label, value, options = {}) {
  return `
    <div class="admin-field ${options.wide ? 'is-wide' : ''}">
      <dt>${escapeHtml(label)}</dt>
      <dd class="admin-field-value ${options.code ? 'is-code' : ''}">${valueMarkup(value, options)}</dd>
    </div>
  `
}

function renderBooleanField(label, value) {
  return renderField(label, Boolean(value))
}

function renderDateField(label, value) {
  return renderField(label, value ? formatDate(value) : '')
}

function renderMoneyField(label, cents = 0, currency = 'USD') {
  return renderField(label, formatMoney(cents, currency))
}

function renderBadge(value, tone = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  return `<span class="review-badge ${tone ? `is-${escapeHtml(tone)}` : ''}">${escapeHtml(text)}</span>`
}

function renderBadgeList(items = [], empty = 'None') {
  const values = normalizeList(items)
  if (!values.length) return `<p class="admin-muted">${escapeHtml(empty)}</p>`
  return `<div class="admin-badge-list">${values.map((item) => renderBadge(item)).join('')}</div>`
}

function renderKeyValueGrid(fields = [], options = {}) {
  const rows = fields.filter(Boolean)
  if (!rows.length) return `<p class="admin-muted">${escapeHtml(options.empty || 'No values recorded.')}</p>`
  return `<dl class="admin-field-grid ${options.compact ? 'is-compact' : ''}">${rows.join('')}</dl>`
}

function stripUnsafeHtml(value = '') {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderTextBlock(title, value = '', empty = 'Not set') {
  const text = stripUnsafeHtml(value)
  return `
    <div class="admin-text-block">
      <h3>${escapeHtml(title)}</h3>
      <p>${text ? escapeHtml(text) : `<span class="admin-muted">${escapeHtml(empty)}</span>`}</p>
    </div>
  `
}

function renderPathField(label, value) {
  const text = String(value || '').trim()
  if (!text) return ''
  return `
    <div class="admin-path-row">
      <span>${escapeHtml(label)}</span>
      <code class="admin-code-value">${escapeHtml(text)}</code>
      <button type="button" class="admin-copy-button" data-copy-value="${escapeHtml(text)}">Copy</button>
    </div>
  `
}

function renderPathList(label, values = [], empty = '') {
  const paths = normalizeList(values)
  if (!paths.length) {
    return empty ? `<p class="admin-muted">${escapeHtml(empty)}</p>` : ''
  }
  return `
    <div class="admin-path-group">
      <h4>${escapeHtml(label)}</h4>
      ${paths.map((path, index) => renderPathField(`${label} ${paths.length > 1 ? index + 1 : ''}`.trim(), path)).join('')}
    </div>
  `
}

function assetSummaryGrid(product = {}) {
  const summary = product.assetSummary || {}
  return renderKeyValueGrid([
    renderField('Total files', Number(summary.totalFiles || 0)),
    renderField('Downloadable', Number(summary.downloadableCount || 0)),
    renderField('Previewable', Number(summary.previewableCount || 0)),
    renderField('Total bytes', formatBytes(summary.totalBytes || 0))
  ], { compact: true })
}

function mediaDiagnostics(product = {}) {
  const media = mediaForProduct(product)
  const warnings = [
    ...(media.warnings || []),
    ((product.coverPath || product.thumbnailPath) && !safeImageUrl(product)) ? 'Cover or thumbnail path exists, but no preview URL is currently available.' : ''
  ].filter(Boolean)
  if (!warnings.length) return ''
  return `
    <details class="admin-technical-details">
      <summary>Media diagnostics</summary>
      <ul class="admin-diagnostic-list">${warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul>
    </details>
  `
}

function mediaPanel(product = {}) {
  const media = mediaForProduct(product)
  const imageUrl = safeImageUrl(product)
  const hasImagePath = Boolean(product.coverPath || product.thumbnailPath)
  const gallery = media.gallery || []
  const audio = media.audio || []
  const video = media.video || []
  return `
    <section class="admin-audit-panel admin-media-panel">
      <div class="admin-panel-heading">
        <h2>Media Preview</h2>
        ${state.mediaRequests[product.id] ? '<span class="admin-muted">Resolving media...</span>' : ''}
      </div>
      <div class="admin-media-preview">
        ${imageUrl
          ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(product.title)} cover" loading="lazy" decoding="async" />`
          : `<div class="admin-media-placeholder">${iconSvg('image')}<span>${hasImagePath ? (media.queueReady ? 'Cover unavailable' : 'Resolving cover image') : 'No cover image'}</span></div>`}
      </div>
      ${media.thumbnailUrl && media.thumbnailUrl !== imageUrl ? `
        <div class="admin-thumbnail-strip">
          <img src="${escapeHtml(media.thumbnailUrl)}" alt="${escapeHtml(product.title)} thumbnail" loading="lazy" decoding="async" />
          <span>Thumbnail</span>
        </div>
      ` : ''}
      <div class="admin-media-subsection">
        <h3>Gallery</h3>
        ${gallery.some((item) => item.url)
          ? `<div class="admin-gallery-grid">${gallery.filter((item) => item.url).map((item, index) => `<img src="${escapeHtml(item.url)}" alt="Gallery preview ${index + 1}" loading="lazy" decoding="async" />`).join('')}</div>`
          : '<p class="admin-muted">No gallery previews.</p>'}
      </div>
      <div class="admin-media-subsection">
        <h3>Audio previews</h3>
        ${audio.some((item) => item.url)
          ? audio.filter((item) => item.url).map((item, index) => `<audio controls preload="none" src="${escapeHtml(item.url)}" aria-label="Audio preview ${index + 1}"></audio>`).join('')
          : '<p class="admin-muted">No resolvable audio previews.</p>'}
      </div>
      <div class="admin-media-subsection">
        <h3>Video previews</h3>
        ${video.some((item) => item.url)
          ? video.filter((item) => item.url).map((item, index) => `<video controls preload="metadata" src="${escapeHtml(item.url)}" aria-label="Video preview ${index + 1}"></video>`).join('')
          : '<p class="admin-muted">No resolvable video previews.</p>'}
      </div>
      ${mediaDiagnostics(product)}
    </section>
  `
}

function identityPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>Product Identity</h2>
      ${renderKeyValueGrid([
        renderField('Title', product.title),
        renderField('Slug', product.slug),
        renderField('Product ID', product.id, { code: true }),
        renderField('Artist ID', product.artistId, { code: true }),
        renderField('Artist name', product.artistName),
        renderField('Artist display name', product.artistDisplayName),
        renderField('Artist username', product.artistUsername),
        renderField('Artist profile path', product.artistProfilePath, { code: true }),
        renderField('Status', product.status),
        renderField('Visibility', product.visibility),
        renderField('Product type', product.productType),
        renderField('Product kind', product.productKind),
        renderField('Version', product.version),
        renderField('Usage license', product.usageLicense),
        renderDateField('Created at', product.createdAt),
        renderDateField('Updated at', product.updatedAt),
        renderDateField('Review requested at', product.reviewRequestedAt),
        renderField('Review requested by', product.reviewRequestedBy, { code: true }),
        renderDateField('Reviewed at', product.reviewedAt),
        renderField('Reviewed by', product.reviewedBy, { code: true }),
        renderDateField('Published at', product.publishedAt),
        renderDateField('Released at', product.releasedAt)
      ])}
    </section>
  `
}

function listingContentPanel(product = {}) {
  return `
    <section class="admin-audit-panel is-wide">
      <h2>Listing Content</h2>
      ${renderTextBlock('Short description', product.shortDescription)}
      ${renderTextBlock('Full description', product.description)}
      ${renderTextBlock('Included files', product.includedFiles)}
      ${renderTextBlock('Compatibility notes', product.compatibilityNotes)}
      ${renderTextBlock('Format notes', product.formatNotes)}
      <div class="admin-listing-taxonomy">
        <div><h3>Categories</h3>${renderBadgeList(product.categories)}</div>
        <div><h3>Category keys</h3>${renderBadgeList(product.categoryKeys)}</div>
        <div><h3>Genres</h3>${renderBadgeList(product.genres)}</div>
        <div><h3>Genre keys</h3>${renderBadgeList(product.genreKeys)}</div>
        <div><h3>Tags</h3>${renderBadgeList(product.tags)}</div>
        <div><h3>Tag keys</h3>${renderBadgeList(product.tagKeys)}</div>
        <div><h3>Search keywords</h3>${renderBadgeList(product.searchKeywords)}</div>
        <div><h3>DAW compatibility</h3>${renderBadgeList(product.dawCompatibility)}</div>
        <div><h3>Format keys</h3>${renderBadgeList(product.formatKeys)}</div>
      </div>
    </section>
  `
}

function filesPanel(product = {}) {
  const files = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  return `
    <section class="admin-audit-panel is-wide">
      <h2>Files / File Structure</h2>
      ${assetSummaryGrid(product)}
      <div class="admin-file-table">
        ${files.length ? files.map((file) => {
          const storagePath = file.storagePath || file.path || ''
          return `
            <article class="admin-file-row">
              <div class="admin-file-main">
                <strong>${escapeHtml(file.displayPath || file.name || 'File')}</strong>
                <span>${escapeHtml(file.name || file.displayPath || 'Unnamed file')}</span>
              </div>
              <div class="admin-file-meta">
                ${renderBadge(file.role || 'file')}
                ${renderBadge(file.category || 'deliverable')}
                ${renderBadge(file.extension || 'no extension')}
                ${renderBadge(file.contentType || file.type || 'Unknown type')}
              </div>
              <dl class="admin-file-facts">
                ${renderField('Size', formatBytes(file.sizeBytes || 0))}
                ${renderBooleanField('Deliverable', file.isDeliverable !== false)}
                ${renderBooleanField('Downloadable', file.isDownloadable ?? file.downloadable)}
                ${renderBooleanField('Previewable', file.canPreview ?? file.previewable)}
              </dl>
              ${storagePath ? `
                <details class="admin-technical-details">
                  <summary>Storage path</summary>
                  ${renderPathField('storagePath', storagePath)}
                </details>
              ` : ''}
            </article>
          `
        }).join('') : '<p class="admin-muted">No deliverable file rows. Check asset summary and manifest.</p>'}
      </div>
      <details class="admin-technical-details">
        <summary>Primary download technical fields</summary>
        ${renderKeyValueGrid([
          renderField('Primary download bytes', formatBytes(product.primaryDownloadBytes || 0)),
          renderField('Distribution mode', product.distributionMode),
          renderField('Preview mode', product.previewMode)
        ], { compact: true })}
        ${renderPathField('primaryDownloadPath', product.primaryDownloadPath)}
        ${renderPathField('downloadPath', product.downloadPath)}
        ${renderPathField('licensePath', product.licensePath)}
      </details>
    </section>
  `
}

function sellerPanel(product = {}) {
  const agreement = product.sellerAgreement || {}
  return `
    <section class="admin-audit-panel">
      <h2>Pricing and Seller Agreement</h2>
      ${renderKeyValueGrid([
        renderMoneyField('Price', product.priceCents, product.currency),
        renderField('priceCents', Number(product.priceCents || 0)),
        renderMoneyField('Payout target', product.payoutTargetCents, product.currency),
        renderField('payoutTargetCents', Number(product.payoutTargetCents || 0)),
        renderField('Currency', product.currency),
        renderBooleanField('Free', product.isFree),
        renderBooleanField('Seller agreement accepted', product.sellerAgreementAccepted || agreement.accepted),
        renderField('Seller agreement version', product.sellerAgreementVersion),
        renderBooleanField('sellerAgreement.accepted', agreement.accepted),
        renderDateField('sellerAgreement.acceptedAt', agreement.acceptedAt),
        renderField('sellerAgreement.agreementId', agreement.agreementId),
        renderField('sellerAgreement.version', agreement.version)
      ])}
    </section>
  `
}

function moderationPanel(product = {}) {
  return `
    <section class="admin-audit-panel is-wide">
      <h2>AI Moderation</h2>
      ${renderKeyValueGrid([
        renderBooleanField('AI attempted', product.moderationAIAttempted),
        renderBooleanField('AI succeeded', product.moderationAISucceeded),
        renderBooleanField('AI configured', product.moderationAIConfigured),
        renderBooleanField('AI enabled', product.moderationAIEnabled),
        renderField('AI model', product.moderationAIModel),
        renderField('Moderation status', product.moderationStatus),
        renderField('Risk level', product.moderationRiskLevel),
        renderField('Review job status', product.reviewJobStatus),
        renderDateField('AI completed at', product.moderationAICompletedAt),
        renderDateField('AI failed at', product.moderationAIFailedAt),
        renderField('AI error code', product.moderationAIErrorCode),
        renderField('AI error category', product.moderationAIErrorCategory),
        renderField('AI error', product.moderationAIError, { wide: true })
      ])}
      <div class="admin-summary-block">
        <h3>Moderation summary</h3>
        <p>${escapeHtml(product.moderationSummary || 'No moderation summary recorded.')}</p>
      </div>
      <div>
        <h3>Moderation reasons</h3>
        ${renderBadgeList(product.moderationReasons, 'No reasons')}
      </div>
    </section>
  `
}

function creatorContextPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>Creator Context</h2>
      ${renderKeyValueGrid([
        renderField('Artist ID', product.artistId, { code: true }),
        renderField('Artist name', product.artistName),
        renderField('Display name', product.artistDisplayName),
        renderField('Username', product.artistUsername),
        renderField('Profile path', product.artistProfilePath, { code: true }),
        renderField('Contributor count', Number(product.contributorCount || 0)),
        renderField('Contributor requests', Number(product.contributorRequestCount || 0))
      ])}
      <div>
        <h3>Contributor IDs</h3>
        ${renderBadgeList(product.contributorIds)}
      </div>
      <div>
        <h3>Contributor names</h3>
        ${renderBadgeList(product.contributorNames)}
      </div>
      <div>
        <h3>Pending contributor IDs</h3>
        ${renderBadgeList(product.pendingContributorIds)}
      </div>
      <div class="admin-detail-actions">
        ${product.artistId ? `<a class="admin-secondary-link" href="${publicProfileRoute({ uid: product.artistId, preview: true })}" target="_blank" rel="noreferrer">${iconSvg('eye')}<span>View Creator Profile</span></a>` : ''}
        <a class="admin-secondary-link" href="${ROUTES.adminUsers}">${iconSvg('messageCircle')}<span>Creator History Tools</span></a>
      </div>
    </section>
  `
}

function metricsPanel(product = {}) {
  const counts = product.counts || {}
  return `
    <section class="admin-audit-panel">
      <h2>Marketplace Metrics</h2>
      ${renderKeyValueGrid([
        renderField('Likes', Number(product.likeCount || 0)),
        renderField('Dislikes', Number(product.dislikeCount || 0)),
        renderField('Saves', Number(product.saveCount || 0)),
        renderField('Shares', Number(product.shareCount || 0)),
        renderField('Comments', Number(product.commentCount || 0)),
        renderField('Downloads', Number(product.downloadCount || 0)),
        renderField('Follows', Number(product.followCount || 0)),
        renderField('Sales', Number(product.salesCount || 0)),
        renderMoneyField('Revenue', product.revenue || 0, product.currency),
        renderField('Entitlements', Number(product.entitlementCount || 0))
      ], { compact: true })}
      <details class="admin-technical-details">
        <summary>Counts map</summary>
        ${renderKeyValueGrid(Object.entries(counts).map(([key, value]) => renderField(key, Number(value || 0))), { compact: true })}
      </details>
    </section>
  `
}

function adminHistoryPanel(product = {}) {
  return `
    <section class="admin-audit-panel">
      <h2>Admin History</h2>
      ${renderKeyValueGrid([
        renderField('Prior decision', product.priorDecision || product.reviewDecision),
        renderDateField('Reviewed at', product.reviewedAt),
        renderField('Reviewed by', product.reviewedBy, { code: true }),
        renderField('Review reason', product.reviewReason, { wide: true }),
        renderField('Review notes', product.reviewNotes, { wide: true })
      ])}
      <p class="admin-muted">Full audit log browsing is reserved for the Logs section. New decisions write adminLogs and productModeration events.</p>
    </section>
  `
}

function technicalDataPanel(product = {}) {
  const assignment = product.previewAssignment || {}
  return `
    <section class="admin-audit-panel is-wide">
      <h2>Technical Data</h2>
      <details class="admin-technical-details">
        <summary>Technical media paths</summary>
        ${renderPathField('coverPath', product.coverPath)}
        ${renderPathField('thumbnailPath', product.thumbnailPath)}
        ${renderPathList('galleryPaths', product.galleryPaths)}
        ${renderPathList('previewAudioPaths', product.previewAudioPaths)}
        ${renderPathList('previewVideoPaths', product.previewVideoPaths)}
        ${renderPathField('previewAssignment.hoverAudioPath', assignment.hoverAudioPath)}
        ${renderPathField('previewAssignment.hoverVideoPath', assignment.hoverVideoPath)}
        ${renderPathField('previewAssignment.demoReelPath', assignment.demoReelPath)}
        ${renderPathField('previewAssignment.detailHeroPreviewPath', assignment.detailHeroPreviewPath)}
        ${renderPathField('downloadPath', product.downloadPath)}
        ${renderPathField('primaryDownloadPath', product.primaryDownloadPath)}
        ${renderPathField('licensePath', product.licensePath)}
      </details>
      <details class="admin-technical-details">
        <summary>Raw IDs</summary>
        ${renderPathField('productId', product.id)}
        ${renderPathField('artistId', product.artistId)}
        ${renderPathField('reviewRequestedBy', product.reviewRequestedBy)}
        ${renderPathField('reviewedBy', product.reviewedBy)}
      </details>
      <details class="admin-technical-details">
        <summary>View Raw Product JSON</summary>
        <pre class="admin-json-block">${escapeHtml(JSON.stringify(product, null, 2))}</pre>
      </details>
    </section>
  `
}

function valueType(value) {
  if (Array.isArray(value)) return 'array'
  if (value === null) return 'null'
  return typeof value
}

function valueSummary(value) {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? '' : 's'}`
  if (value && typeof value === 'object') return `${Object.keys(value).length} field${Object.keys(value).length === 1 ? '' : 's'}`
  return compactText(String(value ?? ''), 180) || 'Not set'
}

function additionalProductFieldsPanel(product = {}) {
  const backendExtras = product.additionalProductFields && typeof product.additionalProductFields === 'object'
    ? Object.entries(product.additionalProductFields)
    : []
  const localExtras = Object.entries(product).filter(([key]) => !DISPLAYED_PRODUCT_KEYS.has(key))
  const merged = new Map()
  backendExtras.forEach(([key, value]) => merged.set(key, value))
  localExtras.forEach(([key, value]) => merged.set(key, value))
  const entries = Array.from(merged.entries()).filter(([key]) => key && key !== 'additionalProductFields')
  return `
    <section class="admin-audit-panel is-wide">
      <h2>Additional Product Fields</h2>
      ${entries.length ? `
        <details class="admin-technical-details">
          <summary>${entries.length} additional field${entries.length === 1 ? '' : 's'}</summary>
          <div class="admin-extra-field-list">
            ${entries.map(([key, value]) => `
              <article>
                <div>
                  <strong>${escapeHtml(key)}</strong>
                  <span>${escapeHtml(valueType(value))} · ${escapeHtml(valueSummary(value))}</span>
                </div>
                <pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>
              </article>
            `).join('')}
          </div>
        </details>
      ` : '<p class="admin-muted">No additional fields in the current review payload.</p>'}
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
  ensureDetailMedia(product.id)
  return `
    <header class="admin-page-header admin-detail-header">
      <div>
        <p class="eyebrow">Product Audit</p>
        <h1>${escapeHtml(product.title)}</h1>
        <p>${escapeHtml(product.id)} · ${escapeHtml(product.artistName || product.artistDisplayName || 'Creator')}</p>
        <div class="admin-heading-badges">
          ${renderBadge(product.status || 'unknown', statusClass(product.status))}
          ${renderBadge(product.visibility || 'unknown')}
          ${renderBadge(product.reviewJobStatus || product.moderationStatus || 'review')}
        </div>
      </div>
      <div class="admin-detail-actions">
        <a class="admin-secondary-link" href="${ROUTES.adminReviews}">${iconSvg('arrowLeft')}<span>Back</span></a>
        ${isPublic ? `<a class="admin-secondary-link" href="${productRoute(product)}" target="_blank" rel="noreferrer">${iconSvg('eye')}<span>Public Route</span></a>` : ''}
      </div>
    </header>
    <section class="admin-detail-grid">
      <div class="admin-detail-column">
        ${mediaPanel(product)}
        ${sellerPanel(product)}
        ${creatorContextPanel(product)}
        ${metricsPanel(product)}
      </div>
      <div class="admin-detail-column">
        ${identityPanel(product)}
        ${listingContentPanel(product)}
        ${filesPanel(product)}
        ${moderationPanel(product)}
        ${adminHistoryPanel(product)}
        ${technicalDataPanel(product)}
        ${additionalProductFieldsPanel(product)}
      </div>
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
    await hydrateReviewMedia(state.products, { detailProductId: reviewDetailProductId() })
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
  app.querySelector('[data-admin-theme-toggle]')?.addEventListener('click', () => {
    applyAdminTheme(state.theme === 'dark' ? 'light' : 'dark')
    render()
  })
  app.querySelector('[data-refresh-queue]')?.addEventListener('click', () => loadQueue())
  app.querySelectorAll('[data-copy-value]').forEach((button) => {
    button.addEventListener('click', async () => {
      const value = button.getAttribute('data-copy-value') || ''
      if (!value) return
      try {
        await navigator.clipboard?.writeText(value)
        state.message = 'Copied technical value.'
        state.error = ''
      } catch {
        state.error = 'Could not copy the value from this browser context.'
      }
      render()
    })
  })
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
