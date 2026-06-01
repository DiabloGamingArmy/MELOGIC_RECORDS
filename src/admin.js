import './styles/base.css'
import './styles/admin.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import {
  getAdminSettings,
  getAdminOrder,
  getAdminLog,
  getAdminReport,
  getAdminUserProfile,
  listActiveStaffPresence,
  listAdminLogs,
  listAdminOrders,
  listAdminProducts,
  listAdminReports,
  listAdminTeam,
  listAdminUsers,
  listMarketplaceReviewQueue,
  reviewProductDecision,
  addAdminUserNote,
  setAdminUserRole,
  setUserSuspension,
  updateReportDecision,
  updateAdminSettings,
  uploadSellerAgreementMarkdown
} from './data/productService'
import { waitForInitialAuthState } from './firebase/auth'
import { getStorageAssetUrl } from './firebase/storageAssets'
import { formatUsername } from './utils/format'
import { formatActionLabel as sharedActionLabel } from './utils/displayFormat'
import { ROUTES, adminReviewRoute, authRoute, productRoute, publicProfileRoute } from './utils/routes'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')
const ADMIN_THEME_KEY = 'melogic-admin-theme'

const SECTIONS = [
  { key: 'dashboard', route: ROUTES.admin, label: 'Overview', icon: 'barChart', permission: 'admin' },
  { key: 'reviews', route: ROUTES.adminReviews, label: 'Audits', icon: 'checkCircle', permission: 'productReview' },
  { key: 'products', route: ROUTES.adminProducts, label: 'Products', icon: 'package', permission: 'listingEdit' },
  { key: 'users', route: ROUTES.adminUsers, label: 'Users', icon: 'user', permission: 'userRead' },
  { key: 'reports', route: ROUTES.adminReports, label: 'Reports', icon: 'alertCircle', permission: 'admin' },
  { key: 'orders', route: ROUTES.adminOrders, label: 'Orders', icon: 'shoppingCart', permission: 'orderSupport' },
  { key: 'team', route: ROUTES.adminTeam, label: 'Roles', icon: 'folderPlus', permission: 'roleManage' },
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

const AUDIT_TABS = [
  { key: 'listing', label: 'Listing Content' },
  { key: 'pricing', label: 'Pricing & Agreement' },
  { key: 'creator', label: 'Creator Context' },
  { key: 'metrics', label: 'Marketplace Metrics' },
  { key: 'moderation', label: 'AI Moderation' },
  { key: 'history', label: 'Admin History' },
  { key: 'technical', label: 'Technical Data' }
]

const PRODUCT_ADMIN_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'published', label: 'Published' },
  { key: 'review_pending', label: 'Review Pending' },
  { key: 'needs_changes', label: 'Needs Changes' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'draft', label: 'Draft' },
  { key: 'archived', label: 'Suspended/Archived' },
  { key: 'ai_failed', label: 'AI Failed' },
  { key: 'free', label: 'Free' },
  { key: 'paid', label: 'Paid' }
]

const USER_ADMIN_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'admins', label: 'Admins' },
  { key: 'creators', label: 'Creators' },
  { key: 'suspended', label: 'Suspended' },
  { key: 'verified', label: 'Verified' },
  { key: 'has_products', label: 'Has Products' },
  { key: 'has_reports', label: 'Has Reports' }
]

const REPORT_ADMIN_FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'in_review', label: 'In Review' },
  { key: 'product', label: 'Product Reports' },
  { key: 'user', label: 'User Reports' },
  { key: 'order', label: 'Order Reports' },
  { key: 'community', label: 'Communities' },
  { key: 'community_post', label: 'Community Posts' },
  { key: 'community_comment', label: 'Community Comments' },
  { key: 'resolved', label: 'Resolved' },
  { key: 'dismissed', label: 'Dismissed' }
]

const ORDER_ADMIN_FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'paid', label: 'Paid' },
  { key: 'free', label: 'Free Claims' },
  { key: 'refund_requested', label: 'Refund Requested' },
  { key: 'refunded', label: 'Refunded' },
  { key: 'failed', label: 'Failed' },
  { key: 'recent', label: 'Last 30 Days' }
]

const SETTINGS_SECTIONS = [
  {
    key: 'marketplace',
    title: 'Marketplace',
    fields: [
      ['marketplaceEnabled', 'Marketplace Enabled', 'boolean'],
      ['manualReviewRequired', 'Manual Review Required', 'boolean']
    ]
  },
  {
    key: 'aiModeration',
    title: 'AI Moderation',
    fields: [
      ['productModerationModel', 'Moderation Model', 'string'],
      ['fallbackModels', 'Fallback Models', 'array'],
      ['autoApproveProducts', 'Auto Approve Products', 'boolean'],
      ['aiModerationEnabled', 'AI Moderation Enabled', 'boolean'],
      ['productModerationInstructions', 'Product Moderation Instructions', 'textarea']
    ]
  },
  {
    key: 'uploadLimits',
    title: 'Upload Limits',
    fields: [
      ['coverMaxMb', 'Cover Max MB', 'number'],
      ['galleryMaxMb', 'Gallery Max MB', 'number'],
      ['audioPreviewMaxMb', 'Audio Preview Max MB', 'number'],
      ['videoPreviewMaxMb', 'Video Preview Max MB', 'number'],
      ['downloadsMaxMb', 'Downloads Max MB', 'number']
    ]
  },
  {
    key: 'agreements',
    title: 'Agreements',
    fields: [
      ['sellerAgreementId', 'Seller Agreement ID', 'string'],
      ['sellerAgreementVersion', 'Seller Agreement Version', 'string'],
      ['sellerAgreementPath', 'Seller Agreement Path', 'string'],
      ['sellerAgreementUpdatedAt', 'Updated At', 'string'],
      ['sellerAgreementUpdatedBy', 'Updated By', 'string']
    ]
  },
  {
    key: 'reviewPolicy',
    title: 'Review Policy',
    fields: [
      ['passBehavior', 'Pass Behavior', 'textarea'],
      ['rejectBehavior', 'Reject Behavior', 'textarea'],
      ['returnBehavior', 'Return Behavior', 'textarea']
    ]
  }
]

const DECISION_LABELS = {
  approve: 'Pass',
  reject: 'Reject',
  request_changes: 'Return',
  keep_pending: 'Keep Pending'
}

const ROLE_RANKS = {
  owner: 100,
  admin: 80,
  marketplaceReviewer: 50,
  listingEditor: 45,
  support: 40,
  auditor: 20,
  remove: 0,
  user: 0,
  '': 0
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
  auditTab: 'listing',
  overview: {
    loading: false,
    loaded: false,
    error: '',
    products: [],
    orders: [],
    reports: [],
    logs: [],
    activeStaff: []
  },
  adminData: {
    products: { items: [], loading: false, loaded: false, error: '', filter: 'all', search: '' },
    users: { items: [], profile: null, adminUser: null, recentProducts: [], accountEvents: [], adminNotes: [], loading: false, loaded: false, error: '', filter: 'all', search: '', actioning: '' },
    reports: { items: [], detail: null, reporter: null, target: null, loading: false, loaded: false, error: '', filter: 'open', actioning: '' },
    orders: { items: [], detail: null, logs: [], entitlements: [], libraryItems: [], mismatchWarnings: [], loading: false, loaded: false, error: '', filter: 'all' },
    team: { items: [], profile: null, adminUser: null, recentProducts: [], loading: false, loaded: false, error: '' },
    logs: { items: [], detail: null, detailId: '', loading: false, loaded: false, error: '', filter: 'all', search: '' }
  },
  settings: {
    data: {},
    loading: false,
    loaded: false,
    error: '',
    saving: false,
    updatedAt: null,
    updatedBy: '',
    dialog: { open: false, section: '' }
  },
  dialog: {
    open: false,
    decision: '',
    productId: ''
  },
  userActionDialog: {
    open: false,
    type: '',
    uid: ''
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

function humanLabel(value = '') {
  const text = String(value || '').trim()
  if (!text) return ''
  const known = {
    review_pending: 'Review Pending',
    pending_manual_review: 'Manual Review',
    pending_ai_review: 'AI Review',
    needs_changes: 'Needs Changes',
    rejected: 'Rejected',
    published: 'Published',
    draft: 'Draft',
    archived: 'Archived',
    ai_error: 'AI Error',
    ai_failed: 'AI Error',
    failed_ai_auth: 'AI Auth Error',
    marketplaceReviewer: 'Marketplace Reviewer',
    listingEditor: 'Listing Editor'
  }
  if (known[text]) return known[text]
  return sharedActionLabel(text)
}

function roleRank(role = '') {
  return ROLE_RANKS[role] ?? ROLE_RANKS[humanLabel(role).replace(/\s+/g, '')] ?? 0
}

function currentRoleRank() {
  return roleRank(state.claims.adminRole || '')
}

function canAssignRole(role = '') {
  if ((state.claims.adminRole || '') === 'owner') return true
  const rank = roleRank(role)
  return rank > 0 && rank < currentRoleRank()
}

function canManageTargetRole(role = '', uid = '') {
  if ((state.claims.adminRole || '') === 'owner') return true
  if (uid && state.currentUser?.uid === uid) return false
  return roleRank(role) < currentRoleRank()
}

function auditTabFromHash() {
  const raw = String(window.location.hash || '').replace(/^#/, '')
  const normalized = raw.startsWith('tab=') ? raw.slice(4) : raw
  return AUDIT_TABS.some((tab) => tab.key === normalized) ? normalized : 'listing'
}

function setAuditTab(tabKey = 'listing') {
  state.auditTab = AUDIT_TABS.some((tab) => tab.key === tabKey) ? tabKey : 'listing'
  const current = window.location.pathname + window.location.search
  window.history.replaceState({}, '', `${current}#${state.auditTab}`)
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
  if (path.startsWith(`${ROUTES.adminUsers}/`)) return 'users'
  if (path.startsWith(`${ROUTES.adminReports}/`)) return 'reports'
  if (path.startsWith(`${ROUTES.adminOrders}/`)) return 'orders'
  if (path.startsWith(`${ROUTES.adminTeam}/`)) return 'team'
  if (path.startsWith(`${ROUTES.adminLogs}/`)) return 'logs'
  const section = SECTIONS.find((item) => item.route.replace(/\/+$/, '') === path)
  return section?.key || 'dashboard'
}

function adminUserDetailUid() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminUsers}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminUsers}/`.length).split('/')[0] || '').trim()
}

function adminOrderDetailId() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminOrders}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminOrders}/`.length).split('/')[0] || '').trim()
}

function adminReportDetailId() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminReports}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminReports}/`.length).split('/')[0] || '').trim()
}

function adminTeamDetailUid() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminTeam}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminTeam}/`.length).split('/')[0] || '').trim()
}

function adminLogDetailId() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminLogs}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminLogs}/`.length).split('/')[0] || '').trim()
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

function isActionableReviewProduct(product = {}) {
  return product.status === 'review_pending'
    || product.status === 'needs_changes'
    || product.reviewJobStatus === 'pending_manual_review'
    || product.reviewJobStatus === 'needs_changes'
    || product.moderationStatus === 'pending'
    || product.moderationStatus === 'review_pending'
    || product.moderationStatus === 'needs_changes'
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
    <section class="admin-main ${reviewDetailProductId() || adminUserDetailUid() || adminReportDetailId() || adminOrderDetailId() || adminTeamDetailUid() || adminLogDetailId() ? 'admin-main-detail' : ''}">
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
  const overview = state.overview
  const overviewProducts = overview.products || []
  const overviewOrders = overview.orders || []
  const overviewReports = overview.reports || []
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Console</p>
        <h1>Overview</h1>
      </div>
      <button type="button" class="admin-icon-button" data-refresh-queue title="Refresh audit queue">${iconSvg('barChart')}</button>
    </header>
    <section class="admin-metric-grid">
      <article class="admin-metric"><span>Role</span><strong>${escapeHtml(state.claims.adminRole || 'admin')}</strong></article>
      <article class="admin-metric"><span>Audit Queue</span><strong>${state.queueLoaded ? state.products.length : '...'}</strong></article>
      <article class="admin-metric"><span>Permissions</span><strong>${permissionCount}</strong></article>
      <article class="admin-metric"><span>Products Loaded</span><strong>${overview.loaded ? overviewProducts.length : '...'}</strong></article>
      <article class="admin-metric"><span>Published Products</span><strong>${overview.loaded ? overviewProducts.filter((product) => product.status === 'published').length : '...'}</strong></article>
      <article class="admin-metric"><span>Active Staff</span><strong>${overview.loaded ? overview.activeStaff.length : '...'}</strong></article>
      <article class="admin-metric"><span>Orders</span><strong>${overview.loaded ? overviewOrders.length : '...'}</strong></article>
      <article class="admin-metric"><span>Reports</span><strong>${overview.loaded ? overviewReports.length : '...'}</strong></article>
    </section>
    ${overview.error ? `<p class="admin-status is-error">${escapeHtml(overview.error)}</p>` : ''}
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <h2>Active Staff</h2>
        <span class="admin-muted">${overview.loading ? 'Loading...' : `${overview.activeStaff.length} active`}</span>
      </div>
      ${activeStaffStrip(overview.activeStaff)}
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <h2>Audit Snapshot</h2>
        <a href="${ROUTES.adminReviews}">View all</a>
      </div>
      ${can('productReview') ? reviewQueueGrid(true) : permissionState('productReview')}
    </section>
    <section class="admin-overview-grid">
      ${overviewSnapshotTable('Products Snapshot', ROUTES.adminProducts, ['Product', 'Creator', 'Status', 'Updated', 'Action'], overviewProducts.slice(0, 5).map((product) => [
        htmlCell(`<strong>${escapeHtml(product.title || 'Untitled')}</strong><small>${escapeHtml(product.id || '')}</small>`),
        product.artistName || product.artistDisplayName || product.artistId,
        htmlCell(renderBadge(humanLabel(product.status || 'unknown'), statusClass(product.status))),
        formatDate(product.updatedAt || product.createdAt),
        htmlCell(`<a class="admin-row-action-button" href="${adminReviewRoute(product.id)}">Audit/View</a>`)
      ]), 'No recent products loaded.')}
      ${overviewSnapshotTable('Orders Snapshot', ROUTES.adminOrders, ['Order', 'Buyer', 'Amount', 'Status', 'Action'], overviewOrders.slice(0, 5).map((order) => [
        htmlCell(`<span class="admin-code-value">${escapeHtml(order.id || '')}</span>`),
        order.buyerEmail || order.buyerUid || order.uid,
        formatMoney(order.amountCents, order.currency),
        humanLabel(order.paymentStatus),
        htmlCell(`<a class="admin-row-action-button" href="${ROUTES.adminOrders}/${encodeURIComponent(order.id)}">Audit/View</a>`)
      ]), 'No recent orders loaded.')}
      ${overviewSnapshotTable('Reports Snapshot', ROUTES.adminReports, ['Type', 'Target', 'Reason', 'Status', 'Created'], overviewReports.slice(0, 5).map((report) => [
        humanLabel(report.type),
        `${report.targetType || 'target'} ${report.targetId || ''}`.trim(),
        report.reason,
        humanLabel(report.status),
        formatDate(report.createdAt)
      ]), 'No active reports.')}
      ${overviewSnapshotTable('Logs Snapshot', ROUTES.adminLogs, ['Actor', 'Action', 'Target', 'Time', 'Details'], overview.logs.slice(0, 5).map((log) => [
        htmlCell(adminLogActorCell(log).html),
        humanLabel(log.action),
        htmlCell(adminLogTargetCell(log).html),
        formatDate(log.createdAt),
        htmlCell(`<a class="admin-row-action-button" href="${ROUTES.adminLogs}/${encodeURIComponent(log.id)}">View</a>`)
      ]), 'No admin logs loaded.')}
    </section>
  `
}

function activeStaffStrip(staff = []) {
  if (!staff.length) return '<article class="admin-empty-state">No staff currently active.</article>'
  return `
    <div class="admin-presence-strip" role="list" aria-label="Active staff">
      ${staff.map((person) => `
        <a class="admin-presence-person" href="${ROUTES.adminUsers}/${encodeURIComponent(person.uid)}" role="listitem">
          <span class="admin-presence-avatar">
            ${person.avatarURL || person.photoURL
              ? `<img src="${escapeHtml(person.avatarURL || person.photoURL)}" alt="" loading="lazy" decoding="async" />`
              : `<span>${escapeHtml(initialsFor(person.displayName || person.username || person.uid))}</span>`}
            <span class="admin-presence-dot" aria-hidden="true"></span>
          </span>
          <strong>${escapeHtml(formatUsername(person.username) || person.displayName || 'Staff')}</strong>
          <small>${escapeHtml(humanLabel(person.adminRole || person.roles?.[0] || 'staff'))}</small>
        </a>
      `).join('')}
    </div>
  `
}

function overviewSnapshotTable(title = '', href = '', headers = [], rows = [], empty = 'No data loaded.') {
  return `
    <section class="admin-section-slab admin-overview-snapshot">
      <div class="admin-slab-heading">
        <h2>${escapeHtml(title)}</h2>
        ${href ? `<a href="${href}">View all</a>` : ''}
      </div>
      ${adminSimpleTable(title, headers, rows, {
        className: 'is-overview',
        emptyTitle: empty,
        emptyBody: 'This section will fill in as platform data is available.'
      })}
    </section>
  `
}

function permissionState(permission) {
  return `<div class="admin-empty-state"><strong>Permission required</strong><span>${escapeHtml(permission)}</span></div>`
}

function reviewQueueGrid(compact = false) {
  const products = compact ? filteredProducts().slice(0, 6) : filteredProducts()
  if (state.loadingQueue) return '<article class="admin-empty-state">Loading audit queue...</article>'
  if (!products.length) return '<article class="admin-empty-state">No products match this queue.</article>'
  return `<section class="review-grid ${compact ? 'is-compact' : ''}" aria-label="Marketplace audit queue">${products.map(productCard).join('')}</section>`
}

function reviewsView() {
  const productId = reviewDetailProductId()
  if (productId) return reviewDetailView(productId)
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Marketplace</p>
        <h1>Audits</h1>
      </div>
      <button type="button" class="admin-icon-button" data-refresh-queue title="Refresh audit queue">${iconSvg('barChart')}</button>
    </header>
    ${can('productReview') ? `
      <section class="admin-review-tools">
        <div class="admin-segmented" role="group" aria-label="Audit filter">
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
  const exceptionBadges = [
    product.status === 'needs_changes' ? ['Needs Changes', 'needs-changes'] : null,
    product.status === 'rejected' ? ['Rejected', 'rejected'] : null,
    status.tone === 'bad' ? ['AI Error', 'ai-error'] : null
  ].filter(Boolean)
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
        ${exceptionBadges.length ? `<div class="review-card-badges">${exceptionBadges.map(([label, tone]) => `<span class="review-badge is-${escapeHtml(tone)}">${escapeHtml(label)}</span>`).join('')}</div>` : ''}
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

function shortIdentifier(value = '') {
  const raw = String(value || '').trim()
  if (raw.length <= 14) return raw
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

function adminLogActorCell(log = {}) {
  const actor = log.actorSummary || {}
  const primary = formatUsername(actor.username) || actor.displayName || actor.label || actor.name || shortIdentifier(log.actorUid) || log.actorEmail || 'System'
  const secondary = actor.role || log.actorRole || shortIdentifier(log.actorUid) || (primary === log.actorEmail ? '' : log.actorEmail)
  return htmlCell(`<strong>${escapeHtml(primary)}</strong>${secondary ? `<small class="admin-code-value">${escapeHtml(secondary)}</small>` : ''}`)
}

function adminLogTargetCell(log = {}) {
  const target = log.targetSummary || {}
  const primary = target.label || target.title || target.username || shortIdentifier(log.targetId) || 'Target'
  const secondary = target.secondary || target.slug || ''
  return htmlCell(`<strong>${escapeHtml(primary)}</strong>${secondary ? `<small class="admin-code-value">${escapeHtml(secondary)}</small>` : ''}`)
}

function initialsFor(name = '') {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('') || '?'
}

function adminAvatar(entity = {}, size = 'md') {
  const src = String(entity.avatarURL || entity.photoURL || entity.artistAvatarURL || entity.artistPhotoURL || '').trim()
  const name = entity.displayName || entity.artistDisplayName || entity.artistName || entity.username || entity.email || entity.uid || 'User'
  return `
    <span class="admin-avatar is-${escapeHtml(size)}" aria-hidden="true">
      ${src && /^https?:\/\//i.test(src)
        ? `<img src="${escapeHtml(src)}" alt="" loading="lazy" decoding="async" />`
        : `<span>${escapeHtml(initialsFor(name))}</span>`}
    </span>
  `
}

function adminPersonCell(entity = {}, primary = '', secondary = '', tertiary = '') {
  return `
    <span class="admin-person-cell">
      ${adminAvatar(entity)}
      <span>
        <strong>${escapeHtml(primary || entity.displayName || entity.artistName || entity.email || entity.uid || 'User')}</strong>
        ${secondary ? `<small>${escapeHtml(secondary)}</small>` : ''}
        ${tertiary ? `<small class="admin-code-value">${escapeHtml(tertiary)}</small>` : ''}
      </span>
    </span>
  `
}

function renderKeyValueGrid(fields = [], options = {}) {
  const rows = fields.filter(Boolean)
  if (!rows.length) return `<p class="admin-muted">${escapeHtml(options.empty || 'No values recorded.')}</p>`
  return `<dl class="admin-field-grid ${options.compact ? 'is-compact' : ''}">${rows.join('')}</dl>`
}

function accountEventsList(events = []) {
  if (!events.length) return '<article class="admin-empty-state">No account events loaded for this user.</article>'
  return `
    <div class="admin-account-event-list">
      ${events.map((event) => `
        <article class="admin-account-event">
          <div>
            <strong>${escapeHtml(event.title || humanLabel(event.type))}</strong>
            <p>${escapeHtml(event.message || '')}</p>
            <small>${escapeHtml(formatDate(event.createdAt))} · ${escapeHtml(humanLabel(event.severity || 'info'))} · ${escapeHtml(event.source || 'system')}</small>
          </div>
          ${event.path ? `<a class="admin-secondary-link" href="${escapeHtml(event.path)}">Open</a>` : ''}
        </article>
      `).join('')}
    </div>
  `
}

function adminNotesList(notes = []) {
  if (!notes.length) return '<article class="admin-empty-state">No admin notes for this account.</article>'
  return `
    <div class="admin-account-event-list">
      ${notes.map((note) => `
        <article class="admin-account-event">
          <div>
            <strong>${escapeHtml(humanLabel(note.category || 'account'))} · ${escapeHtml(humanLabel(note.severity || 'info'))}</strong>
            <p>${escapeHtml(note.note || '')}</p>
            <small>${escapeHtml(formatDate(note.createdAt))} · ${escapeHtml(note.createdByEmail || note.createdBy || 'Admin')}</small>
          </div>
        </article>
      `).join('')}
    </div>
  `
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
        renderField('Artist username', formatUsername(product.artistUsername)),
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
        renderField('Username', formatUsername(product.artistUsername)),
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

function technicalDataContent(product = {}) {
  const assignment = product.previewAssignment || {}
  return `
    <div class="admin-tab-content-grid">
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
      ${mediaDiagnostics(product)}
      ${additionalProductFieldsContent(product)}
      <details class="admin-technical-details">
        <summary>View Raw Product JSON</summary>
        <pre class="admin-json-block">${escapeHtml(JSON.stringify(product, null, 2))}</pre>
      </details>
    </div>
  `
}

function additionalProductFieldsContent(product = {}) {
  const backendExtras = product.additionalProductFields && typeof product.additionalProductFields === 'object'
    ? Object.entries(product.additionalProductFields)
    : []
  const localExtras = Object.entries(product).filter(([key]) => !DISPLAYED_PRODUCT_KEYS.has(key))
  const merged = new Map()
  backendExtras.forEach(([key, value]) => merged.set(key, value))
  localExtras.forEach(([key, value]) => merged.set(key, value))
  const entries = Array.from(merged.entries()).filter(([key]) => key && key !== 'additionalProductFields')
  return `
    <details class="admin-technical-details">
      <summary>Additional Product Fields (${entries.length})</summary>
      ${entries.length ? `
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
      ` : '<p class="admin-muted">No additional fields in the current review payload.</p>'}
    </details>
  `
}

function auditTabContent(product = {}) {
  if (state.auditTab === 'pricing') {
    const agreement = product.sellerAgreement || {}
    return renderKeyValueGrid([
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
    ])
  }
  if (state.auditTab === 'creator') {
    return `
      ${renderKeyValueGrid([
        renderField('Artist ID', product.artistId, { code: true }),
        renderField('Artist name', product.artistName),
        renderField('Display name', product.artistDisplayName),
        renderField('Username', formatUsername(product.artistUsername)),
        renderField('Profile path', product.artistProfilePath, { code: true }),
        renderField('Contributor count', Number(product.contributorCount || 0)),
        renderField('Contributor requests', Number(product.contributorRequestCount || 0))
      ])}
      <div class="admin-listing-taxonomy">
        <div><h3>Contributor IDs</h3>${renderBadgeList(product.contributorIds)}</div>
        <div><h3>Contributor names</h3>${renderBadgeList(product.contributorNames)}</div>
        <div><h3>Pending contributor IDs</h3>${renderBadgeList(product.pendingContributorIds)}</div>
      </div>
      <div class="admin-detail-actions">
        ${product.artistId ? `<a class="admin-secondary-link" href="${publicProfileRoute({ uid: product.artistId, preview: true })}" target="_blank" rel="noreferrer">${iconSvg('eye')}<span>View Creator Profile</span></a>` : ''}
        ${product.artistId ? `<a class="admin-secondary-link" href="${ROUTES.adminUsers}/${encodeURIComponent(product.artistId)}">${iconSvg('messageCircle')}<span>Creator History Tools</span></a>` : ''}
      </div>
    `
  }
  if (state.auditTab === 'metrics') {
    const counts = product.counts || {}
    return `
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
    `
  }
  if (state.auditTab === 'moderation') {
    return `
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
      <div class="admin-summary-block is-emphasized">
        <h3>Moderation summary</h3>
        <p>${escapeHtml(product.moderationSummary || 'No moderation summary recorded.')}</p>
      </div>
      <div>
        <h3>Moderation reasons</h3>
        ${renderBadgeList(product.moderationReasons, 'No reasons')}
      </div>
    `
  }
  if (state.auditTab === 'history') {
    return `
      ${renderKeyValueGrid([
        renderField('Prior decision', product.priorDecision || product.reviewDecision),
        renderField('Latest decision', product.reviewDecision),
        renderDateField('Reviewed at', product.reviewedAt),
        renderField('Reviewed by', product.reviewedBy, { code: true }),
        renderField('Review reason', product.reviewReason, { wide: true }),
        renderField('Review notes', product.reviewNotes, { wide: true })
      ])}
      <p class="admin-muted">Full audit log browsing is available in Logs. New decisions write adminLogs and productModeration events.</p>
      <a class="admin-secondary-link" href="${ROUTES.adminLogs}">${iconSvg('fileText')}<span>Full Logs</span></a>
    `
  }
  if (state.auditTab === 'technical') return technicalDataContent(product)

  return `
    ${renderKeyValueGrid([
      renderField('Title', product.title),
      renderField('Slug', product.slug),
      renderField('Product type', product.productType),
      renderField('Product kind', product.productKind),
      renderField('Version', product.version),
      renderField('Usage license', product.usageLicense)
    ])}
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
  `
}

function contentViewerSection(product = {}) {
  return `
    <section class="admin-audit-section admin-content-viewer">
      <header class="admin-audit-section-header">
        <div>
          <p class="eyebrow">Section 1</p>
          <h2>Content Viewer</h2>
        </div>
      </header>
      <div class="admin-audit-section-scroll is-viewer">
        <div class="admin-content-viewer-grid">
          ${mediaPanel(product)}
          ${filesPanel(product)}
        </div>
      </div>
    </section>
  `
}

function contentTextSection(product = {}) {
  return `
    <section class="admin-audit-section admin-content-text">
      <header class="admin-audit-section-header">
        <div>
          <p class="eyebrow">Section 2</p>
          <h2>Content Text</h2>
        </div>
      </header>
      <div class="admin-audit-tabs" role="tablist" aria-label="Product audit content sections">
        ${AUDIT_TABS.map((tab) => `
          <button type="button" role="tab" data-audit-tab="${tab.key}" aria-selected="${state.auditTab === tab.key}" tabindex="${state.auditTab === tab.key ? '0' : '-1'}">${escapeHtml(tab.label)}</button>
        `).join('')}
      </div>
      <div class="admin-audit-tab-panel admin-audit-section-scroll is-text" role="tabpanel" data-audit-tab-panel>
        ${auditTabContent(product)}
      </div>
    </section>
  `
}

function detailDecisionBar(product = {}) {
  if (!can('productReview') || !isActionableReviewProduct(product)) return ''
  const busy = state.actionProductId === product.id
  return `
    <section class="admin-decision-bar" aria-label="Review decision actions">
      <div>
        <strong>${escapeHtml(product.title || 'Product')}</strong>
        <span>${escapeHtml(product.status || 'unknown')} / ${escapeHtml(product.visibility || 'unknown')} · ${escapeHtml(product.reviewJobStatus || product.moderationStatus || 'review')}</span>
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
  if (!can('productReview') && !can('listingEdit')) return permissionState('productReview')
  const product = productForId(productId)
  if (!state.queueLoaded || state.loadingQueue) {
    return '<article class="admin-empty-state">Loading product review data...</article>'
  }
  if (!product) {
    return `
      <article class="admin-empty-state">
        <strong>Product could not be loaded.</strong>
        <span>${escapeHtml(productId)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminReviews}">Back to Audits</a>
      </article>
    `
  }
  const isPublic = product.status === 'published' && product.visibility === 'public'
  const isActionable = isActionableReviewProduct(product)
  const isReturnedForChanges = product.status === 'needs_changes' || product.moderationStatus === 'needs_changes'
  ensureDetailMedia(product.id)
  state.auditTab = auditTabFromHash()
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
    ${isReturnedForChanges ? `
      <article class="admin-status is-info admin-readonly-audit">
        <strong>Product returned for changes.</strong>
        <span>This product was returned for changes and can be reviewed again.</span>
      </article>
    ` : isActionable ? '' : `
      <article class="admin-status is-info admin-readonly-audit">
        <strong>Read-only product audit.</strong>
        <span>This product is not currently pending review. Current state: ${escapeHtml(humanLabel(product.status || 'unknown'))} / ${escapeHtml(humanLabel(product.visibility || 'unknown'))}.</span>
      </article>
    `}
    ${contentViewerSection(product)}
    ${contentTextSection(product)}
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
  const detailUid = adminTeamDetailUid()
  if (detailUid) return roleDetailView(detailUid)
  const data = state.adminData.team
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">Access</p>
        <h1>Roles</h1>
      </div>
      <button type="button" class="admin-icon-button" data-refresh-admin-section title="Refresh roles">${iconSvg('barChart')}</button>
    </header>
    <section class="admin-section-slab admin-role-panel">
      <div>
        <h2>Add / Update Admin User</h2>
        <p class="admin-muted">You can only assign roles below your own authority. Custom claims update after the user signs out and signs back in.</p>
      </div>
      <form class="admin-role-form" data-admin-role-form>
        <label>
          <span>User UID</span>
          <input data-role-uid autocomplete="off" required />
        </label>
        <label>
          <span>Role</span>
          <select data-role-select>
            ${adminRoleOptions()}
          </select>
        </label>
        <label>
          <span>Reason</span>
          <input data-role-reason autocomplete="off" maxlength="1200" />
        </label>
        <button type="submit" class="admin-primary-button">${iconSvg('checkCircle')}<span>Save Role</span></button>
      </form>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <h2>Admin Roles</h2>
        <span class="admin-muted">${data.loading ? 'Loading...' : `${data.items.length} shown`}</span>
      </div>
      ${adminTeamTable(data.items)}
    </section>
  `
}

function adminRoleOptions() {
  const options = [
    ['owner', 'Owner'],
    ['admin', 'Admin'],
    ['marketplaceReviewer', 'Marketplace Reviewer'],
    ['listingEditor', 'Listing Editor'],
    ['support', 'Support'],
    ['auditor', 'Auditor'],
    ['remove', 'Remove']
  ]
  return options.map(([value, label]) => {
    const assignable = value === 'remove' || canAssignRole(value)
    const title = assignable ? '' : 'You cannot assign a role equal to or higher than your own.'
    return `<option value="${escapeHtml(value)}" ${assignable ? '' : 'disabled'} title="${escapeHtml(title)}">${escapeHtml(label)}</option>`
  }).join('')
}

function adminData(key = '') {
  return state.adminData[key] || { items: [], loading: false, loaded: false, error: '', filter: 'all', search: '' }
}

function adminPageHeader({ eyebrow = 'Admin', title = '', refreshLabel = 'Refresh' } = {}) {
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <button type="button" class="admin-icon-button" data-refresh-admin-section title="${escapeHtml(refreshLabel)}">${iconSvg('barChart')}</button>
    </header>
  `
}

function adminFilterControls(collection, filters = []) {
  const data = adminData(collection)
  return `
    <div class="admin-segmented" role="group" aria-label="${escapeHtml(collection)} filters">
      ${filters.map((filter) => `<button type="button" data-admin-collection="${collection}" data-admin-filter="${filter.key}" aria-pressed="${data.filter === filter.key}">${escapeHtml(filter.label)}</button>`).join('')}
    </div>
  `
}

function adminSearchForm(collection, placeholder = 'Search') {
  const data = adminData(collection)
  return `
    <form class="admin-search-form" data-admin-search-form="${collection}">
      <input data-admin-search="${collection}" value="${escapeHtml(data.search || '')}" placeholder="${escapeHtml(placeholder)}" autocomplete="off" />
      <button type="submit" class="admin-secondary-button">Search</button>
    </form>
  `
}

function adminLoadingState(data, empty = 'No rows found.') {
  if (data.loading) return '<article class="admin-empty-state">Loading admin data...</article>'
  if (data.error) return `<article class="admin-empty-state"><strong>Could not load data.</strong><span>${escapeHtml(data.error)}</span></article>`
  if (!data.loaded) return '<article class="admin-empty-state">Loading admin data...</article>'
  if (!data.items?.length) return `<article class="admin-empty-state">${escapeHtml(empty)}</article>`
  return ''
}

function adminBusyState(data) {
  if (data.loading) return '<article class="admin-empty-state">Loading admin data...</article>'
  if (data.error) return `<article class="admin-empty-state"><strong>Could not load data.</strong><span>${escapeHtml(data.error)}</span></article>`
  if (!data.loaded) return '<article class="admin-empty-state">Loading admin data...</article>'
  return ''
}

function filterAdminProducts(products = []) {
  const data = adminData('products')
  const search = String(data.search || '').trim().toLowerCase()
  return products.filter((product) => {
    if (search) {
      const haystack = [product.id, product.title, product.artistName, product.artistId, product.productType, product.status].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (data.filter === 'published') return product.status === 'published'
    if (data.filter === 'review_pending') return product.status === 'review_pending' || product.reviewJobStatus === 'pending_manual_review'
    if (data.filter === 'needs_changes') return product.status === 'needs_changes'
    if (data.filter === 'rejected') return product.status === 'rejected'
    if (data.filter === 'draft') return product.status === 'draft'
    if (data.filter === 'archived') return ['archived', 'suspended'].includes(product.status)
    if (data.filter === 'ai_failed') return ['ai_failed', 'failed_ai_auth'].includes(product.reviewJobStatus) || product.moderationStatus === 'ai_error'
    if (data.filter === 'free') return product.isFree === true || Number(product.priceCents || 0) === 0
    if (data.filter === 'paid') return Number(product.priceCents || 0) > 0
    return true
  })
}

function productAdminTable(products = []) {
  if (!products.length) return '<article class="admin-empty-state">No products match this view.</article>'
  return `
    <div class="admin-data-table is-products" role="table" aria-label="Products">
      <div class="admin-data-row is-header" role="row">
        <span>Product</span><span>Creator</span><span>Status</span><span>Visibility</span><span>Type</span><span>Price</span><span>AI Status</span><span>Files</span><span>Updated</span><span>Actions</span>
      </div>
      ${products.map((product) => `
        <article class="admin-data-row" role="row">
          <span class="admin-product-cell">
            <span class="admin-product-thumb">
              ${safeImageUrl(product)
                ? `<img src="${escapeHtml(safeImageUrl(product))}" alt="" loading="lazy" decoding="async" />`
                : iconSvg('image')}
            </span>
            <span><strong>${escapeHtml(product.title || 'Untitled')}</strong><small>${escapeHtml(product.slug || product.id || '')}</small></span>
          </span>
          <span>${escapeHtml(product.artistName || product.artistDisplayName || product.artistId || 'Creator')}</span>
          <span>${renderBadge(humanLabel(product.status || 'unknown'), statusClass(product.status))}</span>
          <span>${escapeHtml(humanLabel(product.visibility || ''))}</span>
          <span>${escapeHtml(product.productType || product.productKind || '')}</span>
          <span>${escapeHtml(formatMoney(product.priceCents, product.currency))}</span>
          <span>${escapeHtml(aiStatus(product).label)}</span>
          <span>${Number(product.assetSummary?.totalFiles || 0)} · ${escapeHtml(formatBytes(product.assetSummary?.totalBytes || 0))}</span>
          <span>${escapeHtml(formatDate(product.updatedAt || product.createdAt))}</span>
          <span class="admin-row-actions">
            <a class="admin-row-action-button admin-product-action admin-table-action-main" href="${adminReviewRoute(product.id)}">Audit/View</a>
          </span>
        </article>
      `).join('')}
    </div>
  `
}

function productSummaryCards(products = []) {
  const counts = {
    total: products.length,
    published: products.filter((product) => product.status === 'published').length,
    review: products.filter((product) => product.status === 'review_pending' || product.reviewJobStatus === 'pending_manual_review').length,
    changes: products.filter((product) => product.status === 'needs_changes').length,
    rejected: products.filter((product) => product.status === 'rejected').length
  }
  return `
    <section class="admin-metric-grid is-compact">
      <article class="admin-metric"><span>Total loaded</span><strong>${counts.total}</strong></article>
      <article class="admin-metric"><span>Published</span><strong>${counts.published}</strong></article>
      <article class="admin-metric"><span>Review pending</span><strong>${counts.review}</strong></article>
      <article class="admin-metric"><span>Needs changes</span><strong>${counts.changes}</strong></article>
      <article class="admin-metric"><span>Rejected</span><strong>${counts.rejected}</strong></article>
    </section>
  `
}

function productsView() {
  if (!can('listingEdit') && !can('productReview')) return permissionState('listingEdit')
  const data = adminData('products')
  const loading = adminLoadingState(data, 'No products found.')
  const products = filterAdminProducts(data.items)
  return `
    ${adminPageHeader({ eyebrow: 'Catalog', title: 'Products', refreshLabel: 'Refresh products' })}
    ${productSummaryCards(data.items)}
    <section class="admin-review-tools">
      ${adminSearchForm('products', 'Search product, creator, status')}
      ${adminFilterControls('products', PRODUCT_ADMIN_FILTERS)}
    </section>
    ${loading || productAdminTable(products)}
  `
}

function filterAdminUsers(users = []) {
  const data = adminData('users')
  const search = String(data.search || '').trim().toLowerCase()
  return users.filter((user) => {
    if (search) {
      const haystack = [user.uid, user.displayName, user.username, user.email, user.role, user.adminRole].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    if (data.filter === 'admins') return user.adminActive || Boolean(user.adminRole)
    if (data.filter === 'creators') return Number(user.productCount || 0) > 0
    if (data.filter === 'suspended') return user.suspended === true
    if (data.filter === 'verified') return user.verified === true
    if (data.filter === 'has_products') return Number(user.productCount || 0) > 0
    if (data.filter === 'has_reports') return Number(user.reportCount || 0) > 0
    return true
  })
}

function usersTable(users = []) {
  if (!users.length) return '<article class="admin-empty-state">No users match this view.</article>'
  return `
    <div class="admin-data-table is-users" role="table" aria-label="Users">
      <div class="admin-data-row is-header" role="row">
        <span>User</span><span>UID</span><span>Username</span><span>Role</span><span>Products</span><span>Reports</span><span>Created / Active</span><span>Actions</span>
      </div>
      ${users.map((user) => `
        <article class="admin-data-row" role="row">
          ${htmlCell(adminPersonCell(user, user.displayName || 'User', user.email || formatUsername(user.username) || '', user.uid)).html}
          <span class="admin-code-value">${escapeHtml(user.uid)}</span>
          <span>${escapeHtml(formatUsername(user.username))}</span>
          <span>${escapeHtml(user.adminRole || user.role || '')}</span>
          <span>${Number(user.productCount || 0)}</span>
          <span>${Number(user.reportCount || 0)}</span>
          <span>${escapeHtml(formatDate(user.createdAt || user.updatedAt))}${user.lastActiveAt ? `<small>${escapeHtml(formatDate(user.lastActiveAt))}</small>` : ''}</span>
          <span class="admin-row-actions">
            <a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminUsers}/${encodeURIComponent(user.uid)}">View</a>
          </span>
        </article>
      `).join('')}
    </div>
  `
}

function selectedUserPanel() {
  const uid = adminUserDetailUid()
  const data = adminData('users')
  if (!uid) return ''
  if (data.loading || !data.loaded) return '<section class="admin-section-slab"><h2>Account Hub</h2><p class="admin-muted">Loading user profile...</p></section>'
  const user = data.profile || data.items.find((item) => item.uid === uid)
  const adminUser = data.adminUser || {}
  const publicProfile = publicProfileRoute({ uid, preview: true })
  const isSelf = state.currentUser?.uid === uid
  const canNote = can('userModerate') || can('orderSupport')
  const canSuspend = can('userModerate')
  const actioning = data.actioning || ''
  return `
    <header class="admin-page-header admin-hub-header">
      <div class="admin-hub-title">
        ${adminAvatar(user || { uid }, 'lg')}
        <div>
          <p class="eyebrow">Account</p>
          <h1>Account Hub</h1>
          <p>${escapeHtml(user?.displayName || formatUsername(user?.username) || user?.email || uid)}</p>
          <small class="admin-code-value">${escapeHtml(uid)}</small>
        </div>
      </div>
      <div class="admin-header-actions">
        <button type="button" class="admin-secondary-button" data-admin-message-user="${escapeHtml(uid)}" ${isSelf ? 'disabled title="You cannot open a direct message with yourself."' : ''}>Message</button>
        <button type="button" class="admin-secondary-button ${user?.suspended ? '' : 'is-danger'}" data-admin-suspension-user="${escapeHtml(uid)}" ${!canSuspend || isSelf || actioning ? `disabled title="${escapeHtml(isSelf ? 'You cannot suspend your own account.' : canSuspend ? 'Account action in progress.' : 'User moderation permission is required.')}"` : ''}>${actioning === 'suspension' ? 'Saving...' : user?.suspended ? 'Unsuspend' : 'Suspend'}</button>
        <button type="button" class="admin-secondary-button" data-admin-note-user="${escapeHtml(uid)}" ${!canNote || actioning ? `disabled title="${escapeHtml(canNote ? 'Account action in progress.' : 'User moderation or order support permission is required.')}"` : ''}>Add Note</button>
        <a class="admin-secondary-link" href="${publicProfile}" target="_blank" rel="noreferrer">Public Profile</a>
        <button type="button" class="admin-icon-button" data-refresh-admin-section title="Refresh account">${iconSvg('barChart')}</button>
      </div>
    </header>
    <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminUsers}">${iconSvg('arrowLeft')}<span>Back to Users</span></a>
    ${user ? `
      <section class="admin-metric-grid is-compact">
        <article class="admin-metric"><span>Products</span><strong>${Number(user.productCount || data.recentProducts?.length || 0)}</strong></article>
        <article class="admin-metric"><span>Reports</span><strong>${Number(user.reportCount || 0)}</strong></article>
        <article class="admin-metric"><span>Orders</span><strong>${Number(user.orderCount || 0)}</strong></article>
        <article class="admin-metric"><span>Role</span><strong>${escapeHtml(humanLabel(user.adminRole || user.role || 'user'))}</strong></article>
        <article class="admin-metric"><span>Status</span><strong>${escapeHtml(user.suspended ? 'Suspended' : user.adminActive ? 'Admin Active' : 'Active')}</strong></article>
      </section>
      <section class="admin-hub-grid">
        <article class="admin-section-slab">
          <div class="admin-slab-heading"><h2>Overview</h2>${renderBadge(user.suspended ? 'Suspended' : 'Active', user.suspended ? 'rejected' : 'published')}</div>
          ${renderKeyValueGrid([
            renderField('UID', user.uid, { code: true }),
            renderField('Display name', user.displayName),
            renderField('Username', formatUsername(user.username)),
            renderField('Email', user.email),
            renderField('Role', humanLabel(user.role)),
            renderField('Admin role', humanLabel(user.adminRole || adminUser.role)),
            renderField('Account status', humanLabel(user.accountStatus || (user.suspended ? 'suspended' : 'active'))),
            renderField('Suspension reason', user.suspensionReason, { wide: true }),
            renderDateField('Suspension until', user.suspensionUntil),
            renderBooleanField('Verified', user.verified),
            renderDateField('Created at', user.createdAt),
            renderDateField('Last active', user.lastActiveAt)
          ])}
          <div class="admin-listing-taxonomy">
            <div><h3>Account Roles</h3>${renderBadgeList((user.roles || []).map(humanLabel), 'No account roles')}</div>
            <div><h3>Profile Badges</h3>${renderBadgeList((user.badges || []).map(humanLabel), 'No profile badges')}</div>
          </div>
        </article>
        <article class="admin-section-slab">
          <div class="admin-slab-heading"><h2>Security / Activity</h2><span class="admin-muted">Read only</span></div>
          ${renderKeyValueGrid([
            renderBooleanField('Admin active', user.adminActive || adminUser.active),
            renderField('Admin role', humanLabel(adminUser.role || user.adminRole)),
            renderField('Updated by', adminUser.updatedBy, { code: true }),
            renderDateField('Role updated', adminUser.updatedAt),
            renderDateField('Last sign-in', user.lastActiveAt)
          ])}
          ${accountEventsList(data.accountEvents || [])}
        </article>
      </section>
      <section class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Products</h2><span class="admin-muted">${data.recentProducts?.length || 0} loaded</span></div>
        ${data.recentProducts?.length ? productAdminTable(data.recentProducts) : '<article class="admin-empty-state">No recent products loaded for this creator.</article>'}
      </section>
      <section class="admin-hub-grid">
        <article class="admin-section-slab"><div class="admin-slab-heading"><h2>Reports</h2></div><article class="admin-empty-state">No report detail data is loaded for this account yet.</article></article>
        <article class="admin-section-slab"><div class="admin-slab-heading"><h2>Orders / Library</h2></div><article class="admin-empty-state">No order or entitlement detail data is loaded for this account yet.</article></article>
        <article class="admin-section-slab"><div class="admin-slab-heading"><h2>Admin Notes</h2><button type="button" class="admin-secondary-button" data-admin-note-user="${escapeHtml(uid)}" ${!canNote ? 'disabled title="User moderation or order support permission is required."' : ''}>Add Note</button></div>${adminNotesList(data.adminNotes || [])}</article>
        <article class="admin-section-slab"><div class="admin-slab-heading"><h2>Timeline / Logs</h2><a href="${ROUTES.adminLogs}" class="admin-secondary-link">Open Logs</a></div><article class="admin-empty-state">Role changes and admin actions are available in Logs.</article></article>
      </section>
      ${userActionDialog()}
    ` : `<article class="admin-empty-state">No profile found for ${escapeHtml(uid)}.</article>${userActionDialog()}`}
  `
}

function usersView() {
  if (!can('userRead') && !can('roleManage')) return permissionState('userRead')
  const data = adminData('users')
  const loading = adminLoadingState(data, 'No users found.')
  const users = filterAdminUsers(data.items)
  if (adminUserDetailUid()) return `
    ${selectedUserPanel()}
  `
  return `
    ${adminPageHeader({ eyebrow: 'Accounts', title: 'Users', refreshLabel: 'Refresh users' })}
    ${selectedUserPanel()}
    <section class="admin-review-tools">
      ${adminSearchForm('users', 'Search UID, username, name, email')}
      ${adminFilterControls('users', USER_ADMIN_FILTERS)}
    </section>
    ${loading || usersTable(users)}
  `
}

function reportsView() {
  if (!can('admin') && !can('userModerate') && !can('productReview') && !can('orderSupport')) return permissionState('userModerate')
  const data = adminData('reports')
  const reportId = adminReportDetailId()
  if (reportId) return reportDetailView(reportId)
  const loading = adminBusyState(data)
  const reports = data.items.filter((report) => {
    if (data.filter === 'open') return !report.status || report.status === 'open'
    if (data.filter === 'in_review') return report.status === 'in_review'
    if (data.filter === 'resolved') return report.status === 'resolved'
    if (data.filter === 'dismissed') return report.status === 'dismissed'
    return report.type === data.filter || report.targetType === data.filter
  })
  const summary = {
    open: data.items.filter((report) => !report.status || report.status === 'open').length,
    inReview: data.items.filter((report) => report.status === 'in_review').length,
    product: data.items.filter((report) => report.targetType === 'product' || report.type === 'product').length,
    user: data.items.filter((report) => ['user', 'profile'].includes(report.targetType) || ['user', 'profile'].includes(report.type)).length,
    resolved: data.items.filter((report) => report.status === 'resolved').length
  }
  return `
    ${adminPageHeader({ eyebrow: 'Trust', title: 'Reports', refreshLabel: 'Refresh reports' })}
    <section class="admin-metric-grid is-compact">
      <article class="admin-metric"><span>Open</span><strong>${summary.open}</strong></article>
      <article class="admin-metric"><span>In Review</span><strong>${summary.inReview}</strong></article>
      <article class="admin-metric"><span>Product</span><strong>${summary.product}</strong></article>
      <article class="admin-metric"><span>User/Profile</span><strong>${summary.user}</strong></article>
      <article class="admin-metric"><span>Resolved</span><strong>${summary.resolved}</strong></article>
    </section>
    <section class="admin-review-tools">${adminFilterControls('reports', REPORT_ADMIN_FILTERS)}</section>
    ${loading || adminSimpleTable('Reports', ['Type', 'Target', 'Reporter', 'Reason', 'Priority', 'Status', 'Created', 'Assigned', 'Actions'], reports.map((report) => [
      humanLabel(report.type),
      `${report.targetType || 'target'} ${report.targetId || ''}`.trim(),
      report.reporterUid,
      report.reason,
      humanLabel(report.priority),
      humanLabel(report.status),
      formatDate(report.createdAt),
      report.assignedTo,
      htmlCell(`<a class="admin-row-action-button" href="${ROUTES.adminReports}/${encodeURIComponent(report.id)}">View</a>`)
    ]), {
      className: 'is-reports',
      emptyTitle: 'No active reports.',
      emptyBody: 'Reports from users, products, and orders will appear here.'
    })}
  `
}

function reportTargetLink(report = {}, target = null) {
  const targetType = report.targetType || report.type
  const targetId = report.targetId || ''
  if (targetType === 'product' && targetId) return `<a class="admin-secondary-link" href="${adminReviewRoute(targetId)}">Audit/View Product</a>`
  if (['profile', 'user'].includes(targetType) && targetId) return `<a class="admin-secondary-link" href="${ROUTES.adminUsers}/${encodeURIComponent(targetId)}">Open Account Hub</a>`
  if (targetType === 'order' && targetId) return `<a class="admin-secondary-link" href="${ROUTES.adminOrders}/${encodeURIComponent(targetId)}">Open Order Audit</a>`
  if (targetType === 'community' && targetId) return `<a class="admin-secondary-link" href="${ROUTES.communitySlug}/${encodeURIComponent(target?.slug || targetId)}" target="_blank" rel="noreferrer">Open Community</a>`
  if (targetType === 'community_post' && targetId) return `<a class="admin-secondary-link" href="${ROUTES.communityPost}/${encodeURIComponent(targetId)}" target="_blank" rel="noreferrer">Open Community Post</a>`
  if (targetType === 'community_comment' && targetId) {
    const postId = target?.postId || report.metadata?.postId || ''
    if (postId) return `<a class="admin-secondary-link" href="${ROUTES.communityPost}/${encodeURIComponent(postId)}" target="_blank" rel="noreferrer">Open Comment Thread</a>`
  }
  if (target?.id) return `<span class="admin-muted">${escapeHtml(target.id)}</span>`
  return '<span class="admin-muted">No target route available.</span>'
}

function reportDetailView(reportId = '') {
  const data = adminData('reports')
  if (data.loading) return '<article class="admin-empty-state">Loading report...</article>'
  if (data.error) {
    return `
      <article class="admin-empty-state">
        <strong>Could not load report.</strong>
        <span>${escapeHtml(data.error)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminReports}">Back to Reports</a>
      </article>
    `
  }
  if (!data.loaded) return '<article class="admin-empty-state">Loading report...</article>'
  const report = data.detail || data.items.find((item) => item.id === reportId)
  if (!report) {
    return `
      <article class="admin-empty-state">
        <strong>Report not found.</strong>
        <span>${escapeHtml(reportId)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminReports}">Back to Reports</a>
      </article>
    `
  }
  const reporter = data.reporter || {}
  const target = data.target || {}
  const busy = Boolean(data.actioning)
  return `
    <header class="admin-page-header admin-hub-header">
      <div>
        <p class="eyebrow">Report Detail</p>
        <h1>${escapeHtml(report.id || reportId)}</h1>
        <p>${escapeHtml(humanLabel(report.targetType || report.type))} · ${escapeHtml(report.reason || 'No reason')}</p>
        <div class="admin-heading-badges">
          ${renderBadge(humanLabel(report.status || 'open'), statusClass(report.status || 'open'))}
          ${renderBadge(humanLabel(report.priority || 'normal'))}
          ${renderBadge(humanLabel(report.targetType || report.type || 'report'))}
        </div>
      </div>
      <div class="admin-header-actions">
        <button type="button" class="admin-secondary-button" data-report-action="assign_self" ${busy ? 'disabled' : ''}>Assign to Me</button>
        <button type="button" class="admin-secondary-button" data-report-action="in_review" ${busy ? 'disabled' : ''}>Mark In Review</button>
        <button type="button" class="admin-secondary-button" data-report-action="dismiss" ${busy ? 'disabled' : ''}>Dismiss</button>
        <button type="button" class="admin-secondary-button" data-report-action="resolve" ${busy ? 'disabled' : ''}>Resolve</button>
        <button type="button" class="admin-secondary-button" data-report-action="action_taken" ${busy ? 'disabled' : ''}>Action Taken</button>
        ${reportTargetLink(report, target)}
        <button type="button" class="admin-icon-button" data-refresh-admin-section title="Refresh report">${iconSvg('barChart')}</button>
      </div>
    </header>
    <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminReports}">${iconSvg('arrowLeft')}<span>Back to Reports</span></a>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Report Overview</h2>${renderBadge(humanLabel(report.status || 'open'))}</div>
        ${renderKeyValueGrid([
          renderField('Type', humanLabel(report.type)),
          renderField('Target type', humanLabel(report.targetType)),
          renderField('Target ID', report.targetId, { code: true }),
          renderField('Target owner UID', report.targetOwnerUid, { code: true }),
          renderField('Reporter UID', report.reporterUid, { code: true }),
          renderField('Reason', report.reason),
          renderField('Description', report.description, { wide: true }),
          renderField('Source path', report.sourcePath, { code: true }),
          renderField('Status', humanLabel(report.status)),
          renderField('Priority', humanLabel(report.priority)),
          renderField('Assigned to', report.assignedTo, { code: true }),
          renderDateField('Created at', report.createdAt),
          renderDateField('Updated at', report.updatedAt)
        ])}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Reporter</h2>${reporter?.uid ? `<a href="${ROUTES.adminUsers}/${encodeURIComponent(reporter.uid)}">Account Hub</a>` : ''}</div>
        ${reporter?.uid ? renderKeyValueGrid([
          renderField('Display name', reporter.displayName),
          renderField('Username', formatUsername(reporter.username)),
          renderField('Email', reporter.email),
          renderField('UID', reporter.uid, { code: true })
        ]) : '<article class="admin-empty-state">Reporter profile summary is unavailable.</article>'}
      </article>
    </section>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Target</h2>${reportTargetLink(report, target)}</div>
        ${target ? `<pre class="admin-json-block">${escapeHtml(JSON.stringify(target, null, 2))}</pre>` : '<article class="admin-empty-state">Target summary is unavailable.</article>'}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Resolution</h2></div>
        ${renderKeyValueGrid([
          renderField('Resolution', report.resolution, { wide: true }),
          renderDateField('Resolved at', report.resolvedAt),
          renderField('Resolved by', report.resolvedBy, { code: true }),
          renderField('Admin notes', report.adminNotes, { wide: true })
        ])}
      </article>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading"><h2>Timeline / Logs</h2><a href="${ROUTES.adminLogs}" class="admin-secondary-link">Open Logs</a></div>
      <article class="admin-empty-state">Report decision events are written to admin logs after action buttons are used.</article>
    </section>
  `
}

function orderDetailView(orderId = '') {
  const data = adminData('orders')
  const order = data.detail || data.items.find((item) => item.id === orderId)
  const logs = Array.isArray(data.logs) ? data.logs : []
  const entitlements = Array.isArray(data.entitlements) ? data.entitlements : []
  const libraryItems = Array.isArray(data.libraryItems) ? data.libraryItems : []
  const mismatchWarnings = Array.isArray(data.mismatchWarnings) ? data.mismatchWarnings : []
  if (data.loading) return '<article class="admin-empty-state">Loading order...</article>'
  if (data.error) {
    return `
      <article class="admin-empty-state">
        <strong>Could not load order.</strong>
        <span>${escapeHtml(data.error)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminOrders}">Back to Orders</a>
      </article>
    `
  }
  if (!data.loaded) return '<article class="admin-empty-state">Loading order...</article>'
  if (!order) {
    return `
      <article class="admin-empty-state">
        <strong>Order not found.</strong>
        <span>${escapeHtml(orderId)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminOrders}">Back to Orders</a>
      </article>
    `
  }
  const items = Array.isArray(order.items) ? order.items : []
  return `
    <header class="admin-page-header admin-hub-header">
      <div>
        <p class="eyebrow">Commerce</p>
        <h1>Order Hub</h1>
        <p>${escapeHtml(order.buyerEmail || order.buyerUid || order.uid || 'Unknown buyer')} · ${escapeHtml(formatMoney(order.amountCents, order.currency))} · ${escapeHtml(humanLabel(order.paymentStatus) || 'Unknown payment')}</p>
        <p class="admin-code-value">${escapeHtml(order.id)} · ${escapeHtml(humanLabel(order.refundStatus) || 'No refund')} · ${escapeHtml(formatDate(order.createdAt))}</p>
        <div class="admin-heading-badges">
          ${renderBadge(order.livemode ? 'Stripe Live Mode' : 'Stripe Test Mode', order.livemode ? 'pending' : 'published')}
          ${renderBadge(humanLabel(order.paymentSource || 'stripe_checkout'))}
        </div>
      </div>
      <div class="admin-header-actions">
        <button type="button" class="admin-secondary-button" disabled title="Stripe dashboard links are not wired yet.">Open Stripe</button>
        <button type="button" class="admin-secondary-button" disabled title="Refund callable is not implemented yet.">Refund</button>
        <button type="button" class="admin-secondary-button" disabled title="Manual entitlement grant is not implemented yet.">Grant Entitlement</button>
        <button type="button" class="admin-secondary-button" disabled title="Manual entitlement revoke is not implemented yet.">Revoke Entitlement</button>
        ${order.buyerUid ? `<a class="admin-secondary-link" href="${ROUTES.inbox}?start=${encodeURIComponent(order.buyerUid)}">Message Buyer</a>` : '<button type="button" class="admin-secondary-button" disabled title="No buyer UID is attached to this order.">Message Buyer</button>'}
        <button type="button" class="admin-icon-button" data-refresh-admin-section title="Refresh order">${iconSvg('barChart')}</button>
      </div>
    </header>
    <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminOrders}">${iconSvg('arrowLeft')}<span>Back to Orders</span></a>
    <section class="admin-metric-grid is-compact">
      <article class="admin-metric"><span>Amount</span><strong>${escapeHtml(formatMoney(order.amountCents, order.currency))}</strong></article>
      <article class="admin-metric"><span>Payment</span><strong>${escapeHtml(humanLabel(order.paymentStatus) || 'Unknown')}</strong></article>
      <article class="admin-metric"><span>Refund</span><strong>${escapeHtml(humanLabel(order.refundStatus) || 'None')}</strong></article>
      <article class="admin-metric"><span>Items</span><strong>${Number(order.productCount || items.length || 0)}</strong></article>
      <article class="admin-metric"><span>Created</span><strong>${escapeHtml(formatDate(order.createdAt))}</strong></article>
    </section>
    ${mismatchWarnings.length ? `<section class="admin-section-slab"><div class="admin-slab-heading"><h2>Order Warnings</h2>${renderBadge('Needs Review', 'pending')}</div><ul class="admin-warning-list">${mismatchWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Overview</h2>${renderBadge(humanLabel(order.paymentStatus) || 'Unknown')}</div>
        ${renderKeyValueGrid([
          renderField('Order ID', order.id, { code: true }),
          renderField('Buyer UID', order.buyerUid || order.uid, { code: true }),
          renderField('Buyer email', order.buyerEmail),
          renderMoneyField('Amount', order.amountCents, order.currency),
          renderField('Currency', order.currency),
          renderField('Payment status', humanLabel(order.paymentStatus)),
          renderField('Payment source', order.livemode ? 'Stripe Live Mode' : 'Stripe Test Mode'),
          renderField('Order status', humanLabel(order.status)),
          renderField('Refund status', humanLabel(order.refundStatus)),
          renderDateField('Paid at', order.paidAt),
          renderDateField('Created at', order.createdAt),
          renderDateField('Updated at', order.updatedAt)
        ])}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Payment</h2><span class="admin-muted">No secrets shown</span></div>
        ${renderKeyValueGrid([
          renderField('Checkout session', order.checkoutSessionId, { code: true }),
          renderField('Payment intent', order.paymentIntentId, { code: true }),
          renderField('Stripe customer', order.stripeCustomerId, { code: true }),
          renderField('Payment status', humanLabel(order.paymentStatus)),
          renderField('Livemode', order.livemode ? 'Live' : 'Test'),
          renderMoneyField('Amount', order.amountCents, order.currency)
        ])}
      </article>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading"><h2>Products / Items</h2><span class="admin-muted">${items.length || order.productCount || 0} item(s)</span></div>
      ${items.length ? adminSimpleTable('Order Items', ['Product', 'Creator', 'Amount', 'Entitlement', 'Actions'], items.map((item) => [
        htmlCell(`<strong>${escapeHtml(item.title || item.productId || 'Product')}</strong><small class="admin-code-value">${escapeHtml(item.productId || '')}</small>`),
        item.creatorUid,
        formatMoney(item.amountCents, order.currency),
        humanLabel(item.entitlementStatus) || item.entitlementId || 'Not set',
        htmlCell(item.productId ? `<a class="admin-secondary-link" href="${adminReviewRoute(item.productId)}">Audit/View</a>` : '<button type="button" class="admin-secondary-button" disabled>Audit/View</button>')
      ]), { className: 'is-order-items', emptyTitle: 'No item details.', emptyBody: 'Order item metadata is not available.' }) : '<article class="admin-empty-state">No order item metadata is available.</article>'}
    </section>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Entitlements</h2><span class="admin-muted">${entitlements.filter((row) => row.exists).length} found</span></div>
        ${adminSimpleTable('Entitlements', ['Product', 'Status', 'Source', 'Granted', 'Revoked'], entitlements.map((row) => [
          htmlCell(`<strong>${escapeHtml(row.productSnapshot?.title || row.productId)}</strong><small class="admin-code-value">${escapeHtml(row.productId || '')}</small>`),
          humanLabel(row.exists ? row.status : 'missing'),
          humanLabel(row.source),
          formatDate(row.createdAt),
          formatDate(row.revokedAt)
        ]), { className: 'is-order-items', emptyTitle: 'No entitlement rows.', emptyBody: 'No buyer entitlement records were found for the products on this order.' })}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Library Access</h2><span class="admin-muted">${libraryItems.filter((row) => row.exists).length} found</span></div>
        ${adminSimpleTable('Library Items', ['Product', 'Status', 'Source', 'Acquired', 'Order'], libraryItems.map((row) => [
          htmlCell(`<strong>${escapeHtml(row.productSnapshot?.title || row.productId)}</strong><small class="admin-code-value">${escapeHtml(row.productId || '')}</small>`),
          humanLabel(row.exists ? row.status : 'missing'),
          humanLabel(row.source),
          formatDate(row.createdAt),
          row.orderId
        ]), { className: 'is-order-items', emptyTitle: 'No library rows.', emptyBody: 'No buyer library item records were found for the products on this order.' })}
      </article>
    </section>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Refund / Support</h2><span class="admin-muted">Scaffolded</span></div>
        ${renderKeyValueGrid([
          renderField('Refund status', humanLabel(order.refundStatus)),
          renderField('Refund reason', order.refundReason, { wide: true }),
          renderField('Support notes', order.supportNotes, { wide: true }),
          renderField('Refund action', 'Not connected yet. Do not issue Stripe refunds from this page.', { wide: true }),
          renderField('Grant/Revoke action', 'Manual entitlement grant/revoke callables are pending.', { wide: true })
        ])}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Timeline / Logs</h2><a href="${ROUTES.adminLogs}" class="admin-secondary-link">Open Logs</a></div>
        ${logs.length ? adminSimpleTable('Order Logs', ['Time', 'Actor', 'Action', 'Reason'], logs.slice(0, 10).map((log) => [
          formatDate(log.createdAt),
          log.actorEmail || log.actorUid || 'Admin',
          humanLabel(log.action),
          log.reason || log.summary || ''
        ]), { className: 'is-logs', emptyTitle: 'No order logs.', emptyBody: 'Order-specific logs are not available.' }) : '<article class="admin-empty-state">No order-specific timeline is loaded here yet.</article>'}
      </article>
    </section>
  `
}

function ordersView() {
  if (!can('orderSupport')) return permissionState('orderSupport')
  const data = adminData('orders')
  const orderId = adminOrderDetailId()
  if (orderId) return orderDetailView(orderId)
  const loading = adminBusyState(data)
  const orders = data.items.filter((order) => {
    if (data.filter === 'paid') return order.paymentStatus === 'paid' || Number(order.amountCents || 0) > 0
    if (data.filter === 'free') return Number(order.amountCents || 0) === 0
    if (data.filter === 'refund_requested') return order.refundStatus === 'requested'
    if (data.filter === 'refunded') return order.refundStatus === 'refunded'
    if (data.filter === 'failed') return ['failed', 'canceled'].includes(order.paymentStatus)
    if (data.filter === 'recent') return (Date.now() - new Date(order.createdAt || 0).getTime()) <= 30 * 24 * 60 * 60 * 1000
    return true
  })
  const revenue = orders.reduce((sum, order) => sum + Number(order.amountCents || 0), 0)
  return `
    ${adminPageHeader({ eyebrow: 'Commerce', title: 'Orders', refreshLabel: 'Refresh orders' })}
    <section class="admin-metric-grid">
      <article class="admin-metric"><span>Total Revenue</span><strong>${escapeHtml(formatMoney(revenue, 'USD'))}</strong></article>
      <article class="admin-metric"><span>Orders</span><strong>${orders.length}</strong></article>
      <article class="admin-metric"><span>Refund / Failed</span><strong>${orders.filter((order) => order.refundStatus || order.paymentStatus === 'failed').length}</strong></article>
    </section>
    <section class="admin-review-tools">${adminFilterControls('orders', ORDER_ADMIN_FILTERS)}</section>
    ${loading || adminSimpleTable('Orders', ['Order ID', 'Buyer', 'Products', 'Amount', 'Payment', 'Refund', 'Created', 'Actions'], orders.map((order) => [
      order.id,
      order.buyerUid || order.uid,
      order.productTitles?.join(', ') || `${order.productCount || 0} product(s)`,
      formatMoney(order.amountCents, order.currency),
      humanLabel(order.paymentStatus),
      humanLabel(order.refundStatus),
      formatDate(order.createdAt),
      htmlCell(`<a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminOrders}/${encodeURIComponent(order.id)}">Audit/View</a>`)
    ]), {
      className: 'is-orders',
      emptyTitle: 'No orders yet.',
      emptyBody: 'Paid purchases, free claims, refunds, and entitlement issues will appear here.'
    })}
  `
}

function adminTeamTable(team = []) {
  if (!team.length) return '<article class="admin-empty-state">No admin users loaded yet.</article>'
  return `
    <div class="admin-data-table is-team" role="table" aria-label="Roles">
      <div class="admin-data-row is-header" role="row">
        <span>User</span><span>UID</span><span>Role</span><span>Permissions</span><span>Active</span><span>Added By</span><span>Updated</span><span>Actions</span>
      </div>
      ${team.map((member) => `
        <article class="admin-data-row" role="row">
          ${adminPersonCell(member, member.displayName || member.email || member.uid, member.email || '', member.uid)}
          <span class="admin-code-value">${escapeHtml(member.uid)}</span>
          <span>${renderBadge(humanLabel(member.role || 'admin'))}</span>
          <span>${renderBadgeList(Object.entries(member.permissions || {}).filter(([, value]) => value === true).map(([key]) => key), 'No permissions')}</span>
          <span>${renderBadge(member.active ? 'Active' : 'Disabled', member.active ? 'published' : 'rejected')}</span>
          <span class="admin-code-value">${escapeHtml(member.addedBy || member.updatedBy || '')}</span>
          <span>${escapeHtml(formatDate(member.updatedAt || member.createdAt))}</span>
          <span class="admin-row-actions">
            <a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminTeam}/${encodeURIComponent(member.uid)}">Audit/View</a>
          </span>
        </article>
      `).join('')}
    </div>
  `
}

function permissionMatrixMarkup(permissions = {}) {
  const keys = ['admin', 'productReview', 'listingEdit', 'userRead', 'userModerate', 'orderSupport', 'roleManage', 'auditRead', 'settingsManage']
  return `
    <div class="admin-permission-matrix">
      ${keys.map((key) => {
        const enabled = key === 'admin' ? true : permissions[key] === true
        return `<span class="${enabled ? 'is-enabled' : ''}"><strong>${escapeHtml(humanLabel(key))}</strong><em>${enabled ? 'Allowed' : 'No access'}</em></span>`
      }).join('')}
    </div>
  `
}

function roleDetailView(uid = '') {
  const data = adminData('team')
  if (data.loading || !data.loaded) return '<article class="admin-empty-state">Loading role detail...</article>'
  if (data.error) return `<article class="admin-empty-state"><strong>Could not load role detail.</strong><span>${escapeHtml(data.error)}</span></article>`
  const member = data.items.find((item) => item.uid === uid) || data.adminUser || {}
  const user = data.profile || {}
  if (!member.uid && !user.uid) {
    return `<article class="admin-empty-state"><strong>Role not found.</strong><span>${escapeHtml(uid)}</span><a class="admin-primary-link" href="${ROUTES.adminTeam}">Back to Roles</a></article>`
  }
  const manageable = canManageTargetRole(member.role || user.adminRole, uid)
  return `
    <header class="admin-page-header admin-hub-header">
      <div class="admin-hub-title">
        ${adminAvatar(user.uid ? user : member, 'lg')}
        <div>
          <p class="eyebrow">Role Audit</p>
          <h1>${escapeHtml(user.displayName || member.displayName || member.email || uid)}</h1>
          <p>${escapeHtml(formatUsername(user.username) || member.email || '')} · ${escapeHtml(humanLabel(member.role || user.adminRole || 'admin'))} · ${escapeHtml(member.active === false ? 'Disabled' : 'Active')}</p>
          <small class="admin-code-value">${escapeHtml(uid)}</small>
        </div>
      </div>
      <div class="admin-header-actions">
        <button type="button" class="admin-secondary-button" disabled title="${manageable ? 'Use the role form on the Roles page to change this role.' : 'You cannot manage a role equal to or higher than your own.'}">Change Role</button>
        <button type="button" class="admin-secondary-button" disabled title="${manageable ? 'Disable action is not wired yet.' : 'You cannot manage a role equal to or higher than your own.'}">Disable Admin</button>
        <a class="admin-secondary-link" href="${ROUTES.adminLogs}">Activity</a>
        <a class="admin-secondary-link" href="${ROUTES.adminUsers}/${encodeURIComponent(uid)}">Open Account Hub</a>
        <button type="button" class="admin-icon-button" data-refresh-admin-section title="Refresh role">${iconSvg('barChart')}</button>
      </div>
    </header>
    <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminTeam}">${iconSvg('arrowLeft')}<span>Back to Roles</span></a>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Role Overview</h2>${renderBadge(member.active ? 'Active' : 'Disabled', member.active ? 'published' : 'rejected')}</div>
        ${renderKeyValueGrid([
          renderField('Admin role', humanLabel(member.role || user.adminRole)),
          renderBooleanField('Active', member.active),
          renderField('Added by', member.addedBy || member.updatedBy, { code: true }),
          renderField('Updated by', member.updatedBy, { code: true }),
          renderDateField('Created at', member.createdAt),
          renderDateField('Updated at', member.updatedAt)
        ])}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Permission Matrix</h2></div>
        ${permissionMatrixMarkup(member.permissions || {})}
      </article>
    </section>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>User Context</h2><a href="${ROUTES.adminUsers}/${encodeURIComponent(uid)}">Account Hub</a></div>
        ${renderKeyValueGrid([
          renderField('Display name', user.displayName || member.displayName),
          renderField('Username', formatUsername(user.username)),
          renderField('Email', user.email || member.email),
          renderField('UID', uid, { code: true })
        ])}
        <div class="admin-listing-taxonomy">
          <div><h3>Account Roles</h3>${renderBadgeList((user.roles || []).map(humanLabel), 'No account roles')}</div>
          <div><h3>Profile Badges</h3>${renderBadgeList((user.badges || []).map(humanLabel), 'No profile badges')}</div>
        </div>
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Role Change History</h2><a href="${ROUTES.adminLogs}">Open Logs</a></div>
        <article class="admin-empty-state">Role changes are recorded in admin logs.</article>
      </article>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading"><h2>Danger Zone</h2></div>
      <div class="admin-detail-actions">
        <button type="button" class="admin-secondary-button" disabled title="${manageable ? 'Disable action is not wired yet.' : 'Hierarchy rules block this action.'}">Disable Admin</button>
        <button type="button" class="admin-secondary-button" disabled title="${manageable ? 'Use the remove role option in the role form.' : 'Hierarchy rules block this action.'}">Remove Role</button>
      </div>
    </section>
  `
}

function logsView() {
  if (!can('auditRead')) return permissionState('auditRead')
  const data = adminData('logs')
  const loading = adminBusyState(data)
  const detailId = adminLogDetailId() || data.detailId
  if (detailId) return logDetailView(detailId)
  return `
    ${adminPageHeader({ eyebrow: 'Audit', title: 'Logs', refreshLabel: 'Refresh logs' })}
    <section class="admin-section-slab">
      <div class="admin-review-tools">
        <input class="admin-inline-input" data-admin-log-search placeholder="Filter by action, actor, target" value="${escapeHtml(data.search || '')}" />
        <span class="admin-muted">Newest admin actions. Date range and target filters are scaffolded for the next pass.</span>
      </div>
    </section>
    ${loading || logsTable(data.items)}
  `
}

function logsTable(logs = []) {
  const search = String(state.adminData.logs.search || '').trim().toLowerCase()
  const rows = logs.filter((log) => {
    if (!search) return true
    return [log.actorEmail, log.actorUid, log.action, log.targetType, log.targetId, log.reason, log.targetPath].join(' ').toLowerCase().includes(search)
  })
  return adminSimpleTable('Logs', ['Time', 'Actor', 'Action', 'Target Type', 'Target', 'Reason', 'Details'], rows.map((log) => [
      formatDate(log.createdAt),
      adminLogActorCell(log),
      htmlCell(renderBadge(humanLabel(log.action || 'action'))),
      humanLabel(log.targetType),
      adminLogTargetCell(log),
      log.reason,
      htmlCell(`<a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminLogs}/${encodeURIComponent(log.id)}">View Details</a>`)
    ]), {
      className: 'is-logs',
      emptyTitle: 'No admin logs found.',
      emptyBody: 'Admin role changes, review decisions, and settings changes will appear here.'
    })
}

function logDetailView(logId = '') {
  const data = adminData('logs')
  if (data.loading) return '<article class="admin-empty-state">Loading log detail...</article>'
  if (data.error) {
    return `
      <article class="admin-empty-state">
        <strong>Could not load log.</strong>
        <span>${escapeHtml(data.error)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminLogs}">Back to Logs</a>
      </article>
    `
  }
  if (!data.loaded) return '<article class="admin-empty-state">Loading log detail...</article>'
  const log = data.detail || data.items.find((item) => item.id === logId)
  if (!log) {
    return `
      <article class="admin-empty-state">
        <strong>Log not found.</strong>
        <span>${escapeHtml(logId)}</span>
        <a class="admin-primary-link" href="${ROUTES.adminLogs}">Back to Logs</a>
      </article>
    `
  }
  const targetHref = logTargetLink(log)
  return `
    <header class="admin-page-header admin-hub-header">
      <div>
        <p class="eyebrow">Audit</p>
        <h1>Log Detail</h1>
        <p>${escapeHtml(humanLabel(log.action || 'action'))} · ${escapeHtml(formatDate(log.createdAt))}</p>
        <small class="admin-code-value">${escapeHtml(log.id)}</small>
      </div>
      <div class="admin-header-actions">
        ${targetHref ? `<a class="admin-secondary-link" href="${targetHref}">Open Target</a>` : '<button type="button" class="admin-secondary-button" disabled title="No target route is known for this log.">Open Target</button>'}
        <button type="button" class="admin-secondary-button" data-copy-value="${escapeHtml(log.id)}">Copy Log ID</button>
        <button type="button" class="admin-icon-button" data-refresh-admin-section title="Refresh log">${iconSvg('barChart')}</button>
      </div>
    </header>
    <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminLogs}">${iconSvg('arrowLeft')}<span>Back to Logs</span></a>
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Summary</h2>${renderBadge(humanLabel(log.action || 'action'))}</div>
        ${renderKeyValueGrid([
          renderField('Log ID', log.id, { code: true }),
          renderDateField('Created at', log.createdAt),
          renderField('Action', humanLabel(log.action)),
          renderField('Actor', log.actorEmail || log.actorUid),
          renderField('Actor UID', log.actorUid, { code: true }),
          renderField('Actor role', humanLabel(log.actorRole)),
          renderField('Target type', humanLabel(log.targetType)),
          renderField('Target ID', log.targetId, { code: true }),
          renderField('Target path', log.targetPath, { code: true }),
          renderField('Reason', log.reason, { wide: true }),
          renderField('Summary', log.summary, { wide: true })
        ])}
      </article>
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Actor</h2>${log.actorUid ? `<a href="${ROUTES.adminUsers}/${encodeURIComponent(log.actorUid)}">Account Hub</a>` : ''}</div>
        ${renderKeyValueGrid([
          renderField('Actor email/name', log.actorEmail),
          renderField('Actor UID', log.actorUid, { code: true }),
          renderField('Actor role', humanLabel(log.actorRole))
        ])}
      </article>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading"><h2>Target</h2>${targetHref ? `<a href="${targetHref}">Open Target</a>` : '<span class="admin-muted">No route available</span>'}</div>
      ${renderKeyValueGrid([
        renderField('Target type', humanLabel(log.targetType)),
        renderField('Target ID', log.targetId, { code: true }),
        renderField('Target path', log.targetPath, { code: true })
      ])}
    </section>
    <section class="admin-hub-grid">
      <details class="admin-section-slab admin-technical-details"><summary>Before</summary><pre class="admin-json-block">${escapeHtml(JSON.stringify(log.before || null, null, 2))}</pre></details>
      <details class="admin-section-slab admin-technical-details"><summary>After</summary><pre class="admin-json-block">${escapeHtml(JSON.stringify(log.after || null, null, 2))}</pre></details>
    </section>
    <details class="admin-section-slab admin-technical-details">
      <summary>Raw Log JSON</summary>
      <button type="button" class="admin-secondary-button" data-copy-value="${escapeHtml(JSON.stringify(log, null, 2))}">Copy Raw JSON</button>
      <pre class="admin-json-block">${escapeHtml(JSON.stringify(log, null, 2))}</pre>
    </details>
  `
}

function logTargetLink(log = {}) {
  const type = String(log.targetType || '').toLowerCase()
  const id = String(log.targetId || '').trim()
  if (!id) return ''
  if (type === 'product') return adminReviewRoute(id)
  if (['user', 'profile', 'adminuser'].includes(type)) return `${ROUTES.adminUsers}/${encodeURIComponent(id)}`
  if (type === 'order') return `${ROUTES.adminOrders}/${encodeURIComponent(id)}`
  if (type === 'report') return `${ROUTES.adminReports}/${encodeURIComponent(id)}`
  return ''
}

function logDetailModal(logId = '') {
  if (!logId) return ''
  const log = state.adminData.logs.items.find((item) => item.id === logId)
  if (!log) return ''
  const targetHref = logTargetLink(log)
  return `
    <div class="admin-modal-backdrop" role="presentation">
      <section class="admin-decision-modal admin-log-detail-modal" role="dialog" aria-modal="true" aria-labelledby="log-detail-title">
        <header>
          <h2 id="log-detail-title">Log Details</h2>
          <button type="button" class="admin-icon-button" data-close-log-detail title="Close">${iconSvg('x')}</button>
        </header>
        ${renderKeyValueGrid([
          renderField('Log ID', log.id, { code: true }),
          renderDateField('Time', log.createdAt),
          renderField('Actor UID', log.actorUid, { code: true }),
          renderField('Actor email/name', log.actorEmail),
          renderField('Actor role', humanLabel(log.actorRole)),
          renderField('Action', humanLabel(log.action)),
          renderField('Target type', humanLabel(log.targetType)),
          renderField('Target ID', log.targetId, { code: true }),
          renderField('Target path', log.targetPath, { code: true }),
          renderField('Reason', log.reason, { wide: true }),
          renderField('Summary', log.summary, { wide: true })
        ])}
        <details class="admin-technical-details">
          <summary>Before summary</summary>
          <pre class="admin-json-block">${escapeHtml(JSON.stringify(log.before || null, null, 2))}</pre>
        </details>
        <details class="admin-technical-details">
          <summary>After summary</summary>
          <pre class="admin-json-block">${escapeHtml(JSON.stringify(log.after || null, null, 2))}</pre>
        </details>
        <details class="admin-technical-details">
          <summary>Metadata</summary>
          <pre class="admin-json-block">${escapeHtml(JSON.stringify(log.metadata || {}, null, 2))}</pre>
        </details>
        <details class="admin-technical-details">
          <summary>Raw JSON</summary>
          <pre class="admin-json-block">${escapeHtml(JSON.stringify(log, null, 2))}</pre>
        </details>
        <div class="admin-modal-actions">
          <button type="button" class="admin-secondary-button" data-close-log-detail>Close</button>
          ${targetHref ? `<a class="admin-primary-link" href="${targetHref}">Open Target</a>` : '<button type="button" class="admin-secondary-button" disabled title="No target route is known for this log.">Open Target</button>'}
        </div>
      </section>
    </div>
  `
}

function userActionDialog() {
  const dialog = state.userActionDialog || {}
  if (!dialog.open || !dialog.uid) return ''
  const user = state.adminData.users.profile || {}
  const suspended = user.suspended === true
  if (dialog.type === 'note') {
    return `
      <div class="admin-modal-backdrop" role="presentation">
        <section class="admin-decision-modal" role="dialog" aria-modal="true" aria-labelledby="admin-note-title">
          <header>
            <h2 id="admin-note-title">Add Admin Note</h2>
            <button type="button" class="admin-icon-button" data-close-user-action title="Close">${iconSvg('x')}</button>
          </header>
          <form data-admin-note-form>
            <input type="hidden" data-note-uid value="${escapeHtml(dialog.uid)}" />
            <label><span>Note</span><textarea data-note-body required maxlength="2400" placeholder="Write a concise internal note."></textarea></label>
            <label><span>Severity</span><select data-note-severity><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></label>
            <label><span>Category</span><select data-note-category><option value="account">Account</option><option value="support">Support</option><option value="moderation">Moderation</option><option value="security">Security</option><option value="marketplace">Marketplace</option></select></label>
            <div class="admin-modal-actions">
              <button type="button" class="admin-secondary-button" data-close-user-action>Cancel</button>
              <button type="submit" class="admin-primary-link" ${state.adminData.users.actioning ? 'disabled' : ''}>${state.adminData.users.actioning === 'note' ? 'Saving...' : 'Save Note'}</button>
            </div>
          </form>
        </section>
      </div>
    `
  }
  if (dialog.type === 'suspension') {
    return `
      <div class="admin-modal-backdrop" role="presentation">
        <section class="admin-decision-modal" role="dialog" aria-modal="true" aria-labelledby="admin-suspension-title">
          <header>
            <h2 id="admin-suspension-title">${suspended ? 'Unsuspend Account' : 'Suspend Account'}</h2>
            <button type="button" class="admin-icon-button" data-close-user-action title="Close">${iconSvg('x')}</button>
          </header>
          <form data-admin-suspension-form>
            <input type="hidden" data-suspension-uid value="${escapeHtml(dialog.uid)}" />
            <label><span>Reason</span><textarea data-suspension-reason required maxlength="1200" placeholder="Required reason for the account action."></textarea></label>
            ${suspended ? '' : '<label><span>Duration</span><select data-suspension-duration><option value="indefinite">Indefinite</option><option value="24h">24 hours</option><option value="7d">7 days</option><option value="30d">30 days</option></select></label>'}
            <label><span>Internal note</span><textarea data-suspension-note maxlength="1200" placeholder="Optional internal context."></textarea></label>
            ${suspended ? '' : '<label class="admin-checkbox-row"><input type="checkbox" data-suspension-confirm required /><span>I understand this may restrict this account.</span></label>'}
            <p class="admin-muted">Suspension status is stored now. Enforcement hooks for every product, report, and messaging edge remain a separate hardening item.</p>
            <div class="admin-modal-actions">
              <button type="button" class="admin-secondary-button" data-close-user-action>Cancel</button>
              <button type="submit" class="admin-primary-link ${suspended ? '' : 'is-danger'}" ${state.adminData.users.actioning ? 'disabled' : ''}>${state.adminData.users.actioning === 'suspension' ? 'Saving...' : suspended ? 'Unsuspend Account' : 'Suspend Account'}</button>
            </div>
          </form>
        </section>
      </div>
    `
  }
  return ''
}

function settingsView() {
  if (!can('admin')) return permissionState('admin')
  const settings = state.settings.data || {}
  const loading = state.settings.loading
  return `
    ${adminPageHeader({ eyebrow: 'Platform', title: 'Settings', refreshLabel: 'Refresh settings' })}
    ${state.settings.error ? `<p class="admin-status is-error">${escapeHtml(state.settings.error)}</p>` : ''}
    ${loading ? '<article class="admin-empty-state">Loading settings...</article>' : ''}
    ${state.settings.updatedAt ? `<p class="admin-muted">Last updated ${escapeHtml(formatDate(state.settings.updatedAt))}${state.settings.updatedBy ? ` by ${escapeHtml(state.settings.updatedBy)}` : ''}.</p>` : ''}
    <section class="admin-settings-grid">
      ${SETTINGS_SECTIONS.map((section) => settingsCard(section, settings[section.key] || {})).join('')}
    </section>
    ${settingsDialog()}
  `
}

function settingsCard(section, values = {}) {
  return `
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <h2>${escapeHtml(section.title)}</h2>
        <button type="button" class="admin-secondary-button" data-edit-settings="${escapeHtml(section.key)}" ${can('settingsManage') || can('roleManage') ? '' : 'disabled'}>Edit</button>
      </div>
      ${renderKeyValueGrid(section.fields.map(([key, label]) => renderField(label, formatSettingValue(values[key]))), { compact: true })}
    </section>
  `
}

function formatSettingValue(value) {
  if (Array.isArray(value)) return value.join(', ')
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null || value === undefined || value === '') return 'Not set'
  return value
}

function settingsDialog() {
  if (!state.settings.dialog.open) return ''
  const section = SETTINGS_SECTIONS.find((item) => item.key === state.settings.dialog.section)
  if (!section) return ''
  const values = state.settings.data?.[section.key] || {}
  const saving = state.settings.saving
  const editableFields = section.key === 'agreements'
    ? section.fields.filter(([key]) => !['sellerAgreementUpdatedAt', 'sellerAgreementUpdatedBy', 'sellerAgreementPath'].includes(key))
    : section.fields
  return `
    <div class="admin-modal-backdrop" role="presentation">
      <section class="admin-decision-modal" role="dialog" aria-modal="true" aria-labelledby="settings-modal-title">
        <header>
          <h2 id="settings-modal-title">Edit ${escapeHtml(section.title)}</h2>
          <button type="button" class="admin-icon-button" data-close-settings-dialog title="Close">${iconSvg('x')}</button>
        </header>
        <form data-settings-form="${escapeHtml(section.key)}">
          ${editableFields.map(([key, label, type]) => settingsInput(key, label, type, values[key])).join('')}
          ${section.key === 'agreements' ? `
            <label>
              <span>Agreement Markdown</span>
              <input type="file" data-agreement-md-file accept=".md,text/markdown,text/plain" ${saving ? 'disabled' : ''} />
            </label>
            <p class="admin-muted">Upload stores the file as legal/agreements/marketplace-product-seller-agreement/{version}.md using the version above.</p>
            ${values.sellerAgreementPath ? `<p class="admin-muted">Current path: <code class="admin-code-value">${escapeHtml(values.sellerAgreementPath)}</code></p>` : ''}
          ` : ''}
          ${section.key === 'aiModeration' ? '<p class="admin-muted">Describe what the AI should allow, flag, or reject when reviewing marketplace products.</p>' : ''}
          <label>
            <span>Reason</span>
            <input data-settings-reason maxlength="1200" placeholder="Why this setting changed" ${saving ? 'disabled' : ''} />
          </label>
          <div class="admin-modal-actions">
            <button type="button" class="admin-secondary-button" data-close-settings-dialog ${saving ? 'disabled' : ''}>Cancel</button>
            <button type="submit" class="admin-primary-button" ${saving ? 'disabled' : ''}>${saving ? 'Saving...' : 'Save Settings'}</button>
          </div>
        </form>
      </section>
    </div>
  `
}

function settingsInput(key, label, type, value) {
  if (type === 'boolean') {
    return `
      <label class="admin-checkbox-field">
        <input type="checkbox" data-settings-field="${escapeHtml(key)}" data-settings-type="${escapeHtml(type)}" ${value === true ? 'checked' : ''} />
        <span>${escapeHtml(label)}</span>
      </label>
    `
  }
  if (type === 'textarea') {
    const rows = key === 'productModerationInstructions' ? 8 : 4
    return `
      <label>
        <span>${escapeHtml(label)}</span>
        <textarea data-settings-field="${escapeHtml(key)}" data-settings-type="${escapeHtml(type)}" rows="${rows}">${escapeHtml(value || '')}</textarea>
      </label>
    `
  }
  return `
    <label>
      <span>${escapeHtml(label)}</span>
      <input data-settings-field="${escapeHtml(key)}" data-settings-type="${escapeHtml(type)}" value="${escapeHtml(Array.isArray(value) ? value.join(', ') : value ?? '')}" />
    </label>
  `
}

function adminSimpleTable(label = 'Rows', headers = [], rows = [], options = {}) {
  return `
    <div class="admin-data-table ${escapeHtml(options.className || '')}" role="table" aria-label="${escapeHtml(label)}">
      <div class="admin-data-row is-header" role="row">
        ${headers.map((header) => `<span>${escapeHtml(header)}</span>`).join('')}
      </div>
      ${rows.length ? rows.map((row) => `
        <article class="admin-data-row" role="row">
          ${row.map((cell) => `<span>${cell?.html ? cell.html : escapeHtml(cell)}</span>`).join('')}
        </article>
      `).join('') : `
        <article class="admin-empty-state admin-table-empty">
          <strong>${escapeHtml(options.emptyTitle || `No ${label.toLowerCase()} found.`)}</strong>
          <span>${escapeHtml(options.emptyBody || 'Rows will appear here when data is available.')}</span>
        </article>
      `}
    </div>
  `
}

function htmlCell(html = '') {
  return { html }
}

function render() {
  state.section = currentSectionKey()
  if (state.section === 'dashboard') return renderLayout(dashboardView())
  if (state.section === 'reviews') return renderLayout(reviewsView())
  if (state.section === 'products') return renderLayout(productsView())
  if (state.section === 'users') return renderLayout(usersView())
  if (state.section === 'reports') return renderLayout(reportsView())
  if (state.section === 'orders') return renderLayout(ordersView())
  if (state.section === 'team') return renderLayout(teamView())
  if (state.section === 'logs') return renderLayout(logsView())
  if (state.section === 'settings') return renderLayout(settingsView())
  return renderLayout(placeholderView(state.section))
}

async function loadQueue({ silent = false } = {}) {
  const detailId = reviewDetailProductId()
  const canLoadQueue = can('productReview')
  const canLoadReadOnlyDetail = can('listingEdit') && Boolean(detailId)
  if (!canLoadQueue && !canLoadReadOnlyDetail) return
  state.loadingQueue = !silent
  state.error = ''
  render()
  try {
    if (canLoadQueue) {
      const result = await listMarketplaceReviewQueue({ limitCount: 100 })
      state.products = result.products || []
    } else {
      state.products = []
    }
    if (detailId && !state.products.some((product) => product.id === detailId)) {
      const detailResult = await listAdminProducts({ productId: detailId }).catch((error) => ({ error, products: [] }))
      const detailProduct = detailResult.products?.[0]
      if (detailProduct) state.products = [detailProduct, ...state.products]
    }
    state.queueLoaded = true
    await hydrateReviewMedia(state.products, { detailProductId: reviewDetailProductId() })
    const visible = filteredProducts()
    if (detailId) {
      state.selectedId = detailId
    } else if (!visible.some((product) => product.id === state.selectedId)) {
      state.selectedId = visible[0]?.id || state.products[0]?.id || ''
    }
  } catch (error) {
    console.warn('[admin] audit queue load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.code === 'functions/permission-denied'
      ? 'This account is not authorized for marketplace review.'
      : 'Could not load the marketplace audit queue.'
  } finally {
    state.loadingQueue = false
    render()
  }
}

async function loadAdminOverview({ silent = false } = {}) {
  if (!can('admin')) return
  state.overview.loading = !silent
  state.overview.error = ''
  render()
  try {
    const [staffResult, productsResult, ordersResult, reportsResult, logsResult] = await Promise.all([
      listActiveStaffPresence({ limitCount: 30 }).catch((error) => ({ error })),
      (can('listingEdit') || can('productReview')) ? listAdminProducts({ limitCount: 12 }).catch((error) => ({ error })) : Promise.resolve({ products: [] }),
      can('orderSupport') ? listAdminOrders({ limitCount: 8 }).catch((error) => ({ error })) : Promise.resolve({ orders: [] }),
      (can('admin') || can('userModerate') || can('productReview') || can('orderSupport')) ? listAdminReports({ limitCount: 8 }).catch((error) => ({ error })) : Promise.resolve({ reports: [] }),
      can('auditRead') ? listAdminLogs({ limitCount: 8 }).catch((error) => ({ error })) : Promise.resolve({ logs: [] })
    ])
    const failures = [staffResult, productsResult, ordersResult, reportsResult, logsResult].filter((result) => result?.error)
    state.overview.activeStaff = staffResult.staff || []
    state.overview.products = productsResult.products || []
    state.overview.orders = ordersResult.orders || []
    state.overview.reports = reportsResult.reports || []
    state.overview.logs = logsResult.logs || []
    state.overview.loaded = true
    state.overview.error = failures.length ? 'Some overview sections could not be loaded.' : ''
    if (state.overview.products.length) await hydrateReviewMedia(state.overview.products)
  } catch (error) {
    console.warn('[admin] overview load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.overview.error = error?.message || 'Could not load admin overview.'
  } finally {
    state.overview.loading = false
    render()
  }
}

async function loadAdminSectionData(sectionKey = state.section, { silent = false } = {}) {
  const map = {
    products: async () => {
      const data = adminData('products')
      const result = await listAdminProducts({ limitCount: 50, search: data.search })
      state.adminData.products.items = result.products || []
      await hydrateReviewMedia(state.adminData.products.items)
    },
    users: async () => {
      const data = adminData('users')
      const detailUid = adminUserDetailUid()
      if (detailUid) {
        const result = await getAdminUserProfile({ uid: detailUid })
        state.adminData.users.profile = result.user || null
        state.adminData.users.adminUser = result.adminUser || null
        state.adminData.users.recentProducts = result.recentProducts || []
        state.adminData.users.accountEvents = result.accountEvents || []
        state.adminData.users.adminNotes = result.adminNotes || []
        await hydrateReviewMedia(state.adminData.users.recentProducts)
      } else {
        state.adminData.users.profile = null
        state.adminData.users.adminUser = null
        state.adminData.users.recentProducts = []
        state.adminData.users.accountEvents = []
        state.adminData.users.adminNotes = []
      }
      const result = await listAdminUsers({ limitCount: 50, search: data.search, uid: detailUid || '' })
      state.adminData.users.items = result.users || []
    },
    reports: async () => {
      const reportId = adminReportDetailId()
      if (reportId) {
        const result = await getAdminReport({ reportId })
        state.adminData.reports.detail = result.report || null
        state.adminData.reports.reporter = result.reporter || null
        state.adminData.reports.target = result.target || null
        state.adminData.reports.items = result.reports || (result.report ? [result.report] : [])
      } else {
        const result = await listAdminReports({ limitCount: 50 })
        state.adminData.reports.items = result.reports || []
        state.adminData.reports.detail = null
        state.adminData.reports.reporter = null
        state.adminData.reports.target = null
      }
    },
    orders: async () => {
      const orderId = adminOrderDetailId()
      if (orderId) {
        const result = await getAdminOrder({ orderId })
        state.adminData.orders.detail = result.order || null
        state.adminData.orders.logs = result.logs || []
        state.adminData.orders.entitlements = result.entitlements || []
        state.adminData.orders.libraryItems = result.libraryItems || []
        state.adminData.orders.mismatchWarnings = result.mismatchWarnings || []
        state.adminData.orders.items = result.order ? [result.order] : []
      } else {
        const result = await listAdminOrders({ limitCount: 50 })
        state.adminData.orders.items = result.orders || []
        state.adminData.orders.detail = null
        state.adminData.orders.logs = []
        state.adminData.orders.entitlements = []
        state.adminData.orders.libraryItems = []
        state.adminData.orders.mismatchWarnings = []
      }
    },
    team: async () => {
      const detailUid = adminTeamDetailUid()
      const result = await listAdminTeam({ limitCount: 50 })
      state.adminData.team.items = result.team || []
      if (detailUid) {
        const profileResult = await getAdminUserProfile({ uid: detailUid })
        state.adminData.team.profile = profileResult.user || null
        state.adminData.team.adminUser = profileResult.adminUser || null
        state.adminData.team.recentProducts = profileResult.recentProducts || []
      } else {
        state.adminData.team.profile = null
        state.adminData.team.adminUser = null
        state.adminData.team.recentProducts = []
      }
    },
    logs: async () => {
      const logId = adminLogDetailId()
      if (logId) {
        const result = await getAdminLog({ logId })
        state.adminData.logs.detail = result.log || null
        state.adminData.logs.detailId = logId
        state.adminData.logs.items = result.log ? [result.log] : []
      } else {
        const result = await listAdminLogs({ limitCount: 50 })
        state.adminData.logs.items = result.logs || []
        state.adminData.logs.detail = null
        state.adminData.logs.detailId = ''
      }
    },
    settings: async () => {
      const result = await getAdminSettings()
      state.settings.data = result.settings || {}
      state.settings.updatedAt = result.updatedAt || null
      state.settings.updatedBy = result.updatedBy || ''
    }
  }
  if (!map[sectionKey]) return
  const data = sectionKey === 'settings' ? state.settings : adminData(sectionKey)
  if (!canLoadAdminSection(sectionKey)) return
  data.loading = !silent
  data.error = ''
  render()
  try {
    await map[sectionKey]()
    data.loaded = true
  } catch (error) {
    console.warn('[admin] section load failed', { sectionKey, code: error?.code, message: error?.message, details: error?.details })
    data.error = error?.message || `Could not load ${sectionKey}.`
  } finally {
    data.loading = false
    render()
  }
}

function canLoadAdminSection(sectionKey = '') {
  if (sectionKey === 'products') return can('listingEdit') || can('productReview')
  if (sectionKey === 'users') return can('userRead') || can('roleManage')
  if (sectionKey === 'reports') return can('admin') || can('userModerate') || can('productReview') || can('orderSupport')
  if (sectionKey === 'orders') return can('orderSupport')
  if (sectionKey === 'team') return can('roleManage')
  if (sectionKey === 'logs') return can('auditRead')
  if (sectionKey === 'settings') return can('admin')
  return false
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
    await loadAdminSectionData('team', { silent: true })
    render()
  } catch (error) {
    console.warn('[admin] role update failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not update admin role.'
    render()
  }
}

function closeSettingsDialog() {
  state.settings.dialog = { open: false, section: '' }
  state.settings.saving = false
  render()
}

function openSettingsDialog(sectionKey = '') {
  if (!can('settingsManage') && !can('roleManage')) return
  const section = SETTINGS_SECTIONS.find((item) => item.key === sectionKey)
  if (!section) return
  state.settings.dialog = { open: true, section: section.key }
  state.settings.error = ''
  state.message = ''
  render()
  app.querySelector('[data-settings-field]')?.focus()
}

function parseSettingsValue(input) {
  const type = input.getAttribute('data-settings-type') || 'string'
  if (type === 'boolean') return input.checked === true
  if (type === 'number') return Number(input.value || 0)
  if (type === 'array') {
    return String(input.value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  }
  return input.value || ''
}

async function submitSettingsForm(form) {
  const section = form.getAttribute('data-settings-form') || ''
  const values = {}
  form.querySelectorAll('[data-settings-field]').forEach((input) => {
    const key = input.getAttribute('data-settings-field') || ''
    if (key) values[key] = parseSettingsValue(input)
  })
  const agreementFile = form.querySelector('[data-agreement-md-file]')?.files?.[0] || null
  if (section === 'agreements') {
    const version = String(values.sellerAgreementVersion || '').trim()
    const agreementId = String(values.sellerAgreementId || 'marketplace-product-seller-agreement').trim() || 'marketplace-product-seller-agreement'
    if (!/^v[0-9]+$/.test(version)) {
      state.settings.error = 'Version must use lowercase v followed by a number, such as v2.'
      render()
      return
    }
    if (agreementFile) {
      const fileName = String(agreementFile.name || '').toLowerCase()
      const mime = String(agreementFile.type || '').toLowerCase()
      if (!fileName.endsWith('.md') || (mime && !['text/markdown', 'text/plain', 'application/octet-stream'].includes(mime))) {
        state.settings.error = 'Agreement upload must be a .md markdown file.'
        render()
        return
      }
    }
    values.sellerAgreementPath = `legal/agreements/${agreementId}/${version}.md`
  }
  state.settings.saving = true
  state.settings.error = ''
  state.message = ''
  render()
  try {
    if (section === 'agreements' && agreementFile) {
      const uploadResult = await uploadSellerAgreementMarkdown({
        file: agreementFile,
        version: values.sellerAgreementVersion,
        agreementId: values.sellerAgreementId || 'marketplace-product-seller-agreement'
      })
      values.sellerAgreementPath = uploadResult.storagePath
    }
    const result = await updateAdminSettings({
      section,
      values,
      reason: form.querySelector('[data-settings-reason]')?.value || ''
    })
    state.settings.data = result.settings || state.settings.data
    state.settings.loaded = true
    state.settings.updatedAt = new Date().toISOString()
    state.settings.updatedBy = state.currentUser?.uid || state.settings.updatedBy
    state.settings.dialog = { open: false, section: '' }
    state.message = `${SETTINGS_SECTIONS.find((item) => item.key === section)?.title || 'Settings'} saved.`
  } catch (error) {
    console.warn('[admin] settings update failed', { code: error?.code, message: error?.message, details: error?.details })
    state.settings.error = error?.message || 'Could not save settings.'
  } finally {
    state.settings.saving = false
    render()
  }
}

async function handleReportAction(action = '') {
  const reportId = adminReportDetailId()
  if (!reportId || !action) return
  let reason = ''
  let notes = ''
  if (['dismiss', 'resolve', 'action_taken'].includes(action)) {
    reason = window.prompt('Reason for this report action') || ''
    if (!reason.trim()) {
      state.error = 'A reason is required for this report action.'
      render()
      return
    }
    notes = window.prompt('Optional admin notes') || ''
  }
  state.adminData.reports.actioning = action
  state.error = ''
  state.message = ''
  render()
  try {
    const result = await updateReportDecision({ reportId, action, reason, notes })
    state.message = `Report ${result.status || action} saved.`
    await loadAdminSectionData('reports', { silent: true })
  } catch (error) {
    console.warn('[admin] report action failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not update this report.'
  } finally {
    state.adminData.reports.actioning = ''
    render()
  }
}

function openUserActionDialog(type = '', uid = '') {
  if (!uid || !['note', 'suspension'].includes(type)) return
  state.userActionDialog = { open: true, type, uid }
  state.error = ''
  state.message = ''
  render()
  app.querySelector(type === 'note' ? '[data-note-body]' : '[data-suspension-reason]')?.focus()
}

function closeUserActionDialog() {
  state.userActionDialog = { open: false, type: '', uid: '' }
  state.adminData.users.actioning = ''
  render()
}

function openAdminMessage(uid = '') {
  const targetUid = String(uid || '').trim()
  if (!targetUid) return
  if (targetUid === state.currentUser?.uid) {
    state.error = 'You cannot open a direct message with yourself.'
    render()
    return
  }
  window.location.assign(`${ROUTES.inbox}?start=${encodeURIComponent(targetUid)}`)
}

async function submitAdminNote(form) {
  const uid = form.querySelector('[data-note-uid]')?.value || ''
  const note = form.querySelector('[data-note-body]')?.value || ''
  const severity = form.querySelector('[data-note-severity]')?.value || 'info'
  const category = form.querySelector('[data-note-category]')?.value || 'account'
  if (!note.trim()) {
    state.error = 'Admin note is required.'
    render()
    return
  }
  state.adminData.users.actioning = 'note'
  state.error = ''
  state.message = ''
  render()
  try {
    const result = await addAdminUserNote({ uid, note, severity, category })
    state.adminData.users.adminNotes = [result.note, ...(state.adminData.users.adminNotes || [])].filter(Boolean)
    state.userActionDialog = { open: false, type: '', uid: '' }
    state.message = 'Admin note saved.'
    await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] add note failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not save admin note.'
  } finally {
    state.adminData.users.actioning = ''
    render()
  }
}

async function submitUserSuspension(form) {
  const uid = form.querySelector('[data-suspension-uid]')?.value || ''
  const reason = form.querySelector('[data-suspension-reason]')?.value || ''
  const duration = form.querySelector('[data-suspension-duration]')?.value || 'indefinite'
  const note = form.querySelector('[data-suspension-note]')?.value || ''
  const currentlySuspended = state.adminData.users.profile?.suspended === true
  if (!reason.trim()) {
    state.error = 'A reason is required.'
    render()
    return
  }
  state.adminData.users.actioning = 'suspension'
  state.error = ''
  state.message = ''
  render()
  try {
    const result = await setUserSuspension({ uid, suspended: !currentlySuspended, reason, duration, note })
    state.userActionDialog = { open: false, type: '', uid: '' }
    state.message = result.suspended ? 'Account suspended.' : 'Account unsuspended.'
    await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] suspension update failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not update suspension status.'
  } finally {
    state.adminData.users.actioning = ''
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
  app.querySelector('[data-refresh-queue]')?.addEventListener('click', () => {
    loadQueue()
    if (state.section === 'dashboard') loadAdminOverview({ silent: true })
  })
  app.querySelector('[data-refresh-admin-section]')?.addEventListener('click', () => loadAdminSectionData(state.section))
  app.querySelectorAll('[data-admin-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const collection = button.getAttribute('data-admin-collection') || ''
      const filter = button.getAttribute('data-admin-filter') || 'all'
      if (!state.adminData[collection]) return
      state.adminData[collection].filter = filter
      render()
    })
  })
  app.querySelectorAll('[data-admin-search-form]').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault()
      const collection = form.getAttribute('data-admin-search-form') || ''
      if (!state.adminData[collection]) return
      state.adminData[collection].search = form.querySelector(`[data-admin-search="${collection}"]`)?.value || ''
      loadAdminSectionData(collection)
    })
  })
  app.querySelector('[data-admin-log-search]')?.addEventListener('input', (event) => {
    state.adminData.logs.search = event.target.value || ''
    const cursor = event.target.selectionStart
    render()
    const nextInput = app.querySelector('[data-admin-log-search]')
    if (nextInput) {
      nextInput.focus()
      if (Number.isInteger(cursor)) nextInput.setSelectionRange(cursor, cursor)
    }
  })
  app.querySelectorAll('[data-open-log-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      const logId = button.getAttribute('data-open-log-detail') || ''
      if (!logId) return
      state.adminData.logs.detailId = logId
      const target = `${ROUTES.adminLogs}/${encodeURIComponent(logId)}`
      if (window.location.pathname !== target) window.history.pushState({}, '', target)
      render()
    })
  })
  app.querySelectorAll('[data-close-log-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      state.adminData.logs.detailId = ''
      if (window.location.pathname.startsWith(`${ROUTES.adminLogs}/`)) window.history.pushState({}, '', ROUTES.adminLogs)
      render()
    })
  })
  app.querySelectorAll('[data-admin-message-user]').forEach((button) => {
    button.addEventListener('click', () => openAdminMessage(button.getAttribute('data-admin-message-user') || ''))
  })
  app.querySelectorAll('[data-admin-note-user]').forEach((button) => {
    button.addEventListener('click', () => openUserActionDialog('note', button.getAttribute('data-admin-note-user') || ''))
  })
  app.querySelectorAll('[data-admin-suspension-user]').forEach((button) => {
    button.addEventListener('click', () => openUserActionDialog('suspension', button.getAttribute('data-admin-suspension-user') || ''))
  })
  app.querySelectorAll('[data-close-user-action]').forEach((button) => {
    button.addEventListener('click', closeUserActionDialog)
  })
  app.querySelector('[data-admin-note-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitAdminNote(event.currentTarget)
  })
  app.querySelector('[data-admin-suspension-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitUserSuspension(event.currentTarget)
  })
  app.querySelectorAll('[data-report-action]').forEach((button) => {
    button.addEventListener('click', () => handleReportAction(button.getAttribute('data-report-action') || ''))
  })
  app.querySelectorAll('[data-edit-settings]').forEach((button) => {
    button.addEventListener('click', () => openSettingsDialog(button.getAttribute('data-edit-settings') || ''))
  })
  app.querySelectorAll('[data-close-settings-dialog]').forEach((button) => {
    button.addEventListener('click', closeSettingsDialog)
  })
  app.querySelector('[data-settings-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitSettingsForm(event.currentTarget)
  })
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
  app.querySelectorAll('[data-audit-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      setAuditTab(button.getAttribute('data-audit-tab') || 'listing')
      app.querySelectorAll('[data-audit-tab]').forEach((tabButton) => {
        const selected = tabButton.getAttribute('data-audit-tab') === state.auditTab
        tabButton.setAttribute('aria-selected', String(selected))
        tabButton.setAttribute('tabindex', selected ? '0' : '-1')
      })
      const product = productForId(reviewDetailProductId())
      const panel = app.querySelector('[data-audit-tab-panel]')
      if (product && panel) panel.innerHTML = auditTabContent(product)
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
  if (state.section === 'dashboard') {
    if (can('productReview')) await loadQueue()
    await loadAdminOverview()
  } else if ((can('productReview') || can('listingEdit')) && state.section === 'reviews') {
    await loadQueue()
  } else {
    await loadAdminSectionData(state.section)
  }
}

window.addEventListener('popstate', () => {
  if (state.claims.admin === true) {
    render()
    if (currentSectionKey() === 'dashboard') {
      if (can('productReview') && !state.queueLoaded) loadQueue()
      if (!state.overview.loaded) loadAdminOverview({ silent: true })
    } else if (currentSectionKey() === 'reviews') {
      if ((can('productReview') || can('listingEdit')) && !state.queueLoaded) loadQueue()
    } else {
      loadAdminSectionData(currentSectionKey(), { silent: true })
    }
  }
})

init()
