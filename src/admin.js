import './styles/base.css'
import './styles/admin.css'
import { multiFactor } from 'firebase/auth'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import {
  getAdminSettings,
  getResonaAiStats,
  getAdminOrder,
  getEmailAdminStatus,
  getAdminLog,
  getAdminReport,
  getAdminUserProfile,
  grantAdminProducts,
  listActiveStaffPresence,
  listAdminEmailLogs,
  listAdminLogs,
  listAdminOrders,
  listAdminProducts,
  listAdminReports,
  listAdminTeam,
  listAdminUsers,
  listMarketplaceReviewQueue,
  repairAdminCheckoutOrder,
  reviewProductDecision,
  searchAdminGrantProducts,
  addAdminUserNote,
  forcePasswordReset,
  revokeRecoveryCodes,
  setAdminUserRole,
  sendAdminAuthEmail,
  sendAdminEmail,
  sendAdminSystemMessage,
  setTemporaryPassword,
  setUserSuspension,
  updateReportDecision,
  updateAdminSettings,
  uploadSellerAgreementMarkdown
  ,adminHideProduct
  ,adminUnhideProduct
  ,adminRemoveProduct
} from './data/productService'
import {
  createCommunity,
  hideCommunityPost,
  hideCommunityComment,
  listAdminCommunityModeration,
  lockCommunityPostComments,
  moderateCommunity,
  pinCommunityPost,
  restoreCommunityComment,
  restoreCommunityPost,
  unpinCommunityPost,
  uploadCommunityImage
} from './data/communityService'
import { waitForInitialAuthState } from './firebase/auth'
import { getStorageAssetUrl } from './firebase/storageAssets'
import { formatUsername } from './utils/format'
import { formatActionLabel as sharedActionLabel } from './utils/displayFormat'
import { isPaidMoneyOrder, orderAmountAvailable, orderLifecycleLabel } from './utils/commerce'
import { ROUTES, adminReviewRoute, authRoute, productRoute, publicProfileRoute } from './utils/routes'
import { iconSvg } from './utils/icons'
import './styles/base.css'
import './styles/admin.css'
import { Room, RoomEvent } from 'livekit-client'
import { createLiveKitCallToken } from './livekit/livekitCallService'
import {
  createManualSupportCall,
  endSupportCall,
  markSupportCallHumanJoined,
  requestSupportCallTakeover,
  watchActiveSupportCalls
} from './livekit/adminCallService'
import {
  listSupportFormsPage,
  listUnresolvedSupportForms,
  updateSupportFormAdminNote,
  updateSupportFormStatus
} from './data/supportFormService'
import {
  claimSupportThread,
  getSupportMessages,
  listSupportThreads,
  resolveSupportThread,
  sendSupportMessage
} from './data/supportThreadService'
import {
  arrayToLines,
  getBannerAlertSettings,
  getMarketplacePricingSettings,
  getPrivateBetaSettings,
  updateBannerAlertSettings,
  updateMarketplacePricingSettings,
  updatePrivateBetaSettings
} from './data/operationsService'
import {
  STUDIO_LIBRARY_ENGINE_TYPES,
  STUDIO_SAMPLE_STRATEGIES,
  STUDIO_LIBRARY_SOURCE_ROOTS,
  STUDIO_LIBRARY_STORAGE_ROOT,
  addLibraryFolder,
  addDefaultInstrumentToLibrary,
  buildSamplesFromFiles,
  defaultSamplePlaybackMode,
  deleteLibraryFolder,
  findFolderById,
  findFolderByPath,
  flattenLibraryFolders,
  getDefaultLibraryContent,
  getInstrumentsForFolder,
  getSampleStrategyWarnings,
  initializeDefaultLibraryContent,
  moveLibraryFolder,
  moveLibraryFolderToParent,
  parseDefaultInstrumentArchive,
  removeDefaultInstrumentFromLibrary,
  renameLibraryFolder,
  samplePlaybackModeLabel,
  saveDefaultLibraryContent,
  studioLibrarySlug,
  updateLibraryFolder,
  updateDefaultInstrument,
  uploadDefaultInstrumentArtwork,
  uploadDefaultInstrumentHtmlSource,
  uploadDefaultInstrumentSample
} from './data/studioLibraryService'

const app = document.querySelector('#app')
const ADMIN_THEME_KEY = 'melogic-admin-theme-v2'

const SECTIONS = [
  { key: 'dashboard', route: ROUTES.admin, label: 'Overview', icon: 'barChart', permission: 'admin' },
  { key: 'reviews', route: ROUTES.adminReviews, label: 'Audits', icon: 'checkCircle', permission: 'productReview' },
  { key: 'products', route: ROUTES.adminProducts, label: 'Products', icon: 'package', permission: 'listingEdit' },
  { key: 'users', route: ROUTES.adminUsers, label: 'Users', icon: 'user', permission: 'userRead' },
  { key: 'reports', route: ROUTES.adminReports, label: 'Reports', icon: 'alertCircle', permission: 'admin' },
  { key: 'community', route: ROUTES.adminCommunity, label: 'Community', icon: 'messageCircle', permission: 'userModerate' },
  { key: 'orders', route: ROUTES.adminOrders, label: 'Orders', icon: 'shoppingCart', permission: 'orderSupport' },
  { key: 'team', route: ROUTES.adminTeam, label: 'Roles', icon: 'folderPlus', permission: 'roleManage' },
  { key: 'logs', route: ROUTES.adminLogs, label: 'Logs', icon: 'fileText', permission: 'auditRead' },
  { key: 'contact', route: ROUTES.adminContact, label: 'Support Queue', icon: 'mailSend', permission: 'emailSend' },
  { key: 'tools', route: ROUTES.adminTools, label: 'Tools', icon: 'folderPlus', permission: 'admin' },
  { key: 'operations', route: ROUTES.adminOperations, label: 'Operations', icon: 'fileText', permission: 'admin' },
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
  { key: 'community_story', label: 'Community Stories' },
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
    title: 'Product AI Moderation',
    fields: [
      ['productModerationModel', 'Moderation Model', 'string'],
      ['fallbackModels', 'Fallback Models', 'array'],
      ['autoApproveProducts', 'Auto Approve Products', 'boolean'],
      ['aiModerationEnabled', 'AI Moderation Enabled', 'boolean'],
      ['productModerationInstructions', 'Product Moderation Instructions', 'textarea']
    ]
  },
  {
    key: 'supportAi',
    title: 'Resona AI Instructions',
    fields: [
      ['systemBehavior', 'Core Instructions', 'textarea'],
      ['siteOverview', 'Site / Product Context', 'textarea'],
      ['escalationRules', 'Escalation Rules', 'textarea'],
      ['restrictedActions', 'Restricted Actions', 'textarea'],
      ['toneGuidelines', 'Tone Guidelines', 'textarea'],
      ['updatedAt', 'Updated At', 'string'],
      ['updatedBy', 'Updated By', 'string']
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
  currentUserMfaEnabled: false,
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
  theme: 'dark',
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
    supportForms: [],
    activeStaff: []
  },
  adminData: {
    products: { items: [], loading: false, loadingMore: false, loaded: false, error: '', filter: 'all', search: '', cursor: '', hasMore: false, pageSize: 15 },
    users: { items: [], profile: null, adminUser: null, recentProducts: [], libraryItems: [], orders: [], commerceSummary: null, payoutConnect: null, earningsSummary: null, creatorLedgerEntries: [], accountEvents: [], adminNotes: [], loading: false, loadingMore: false, loaded: false, error: '', filter: 'all', search: '', cursor: '', hasMore: false, pageSize: 15, actioning: '' },
    reports: { items: [], detail: null, reporter: null, target: null, loading: false, loadingMore: false, loaded: false, error: '', filter: 'open', cursor: '', hasMore: false, pageSize: 15, actioning: '' },
    community: {
      posts: [],
      communities: [],
      reports: [],
      reportedPosts: [],
      reportedComments: [],
      hiddenPosts: [],
      loading: false,
      loaded: false,
      error: '',
      filter: 'reported',
      actioning: '',
      auditOpen: false,
      auditLoading: false,
      auditError: '',
      audit: null,
      createOpen: false,
      createSaving: false,
      createError: '',
      createMessage: ''
    },
    orders: { items: [], detail: null, logs: [], entitlements: [], libraryItems: [], mismatchWarnings: [], loading: false, loadingMore: false, loaded: false, error: '', filter: 'all', cursor: '', hasMore: false, pageSize: 15, repairing: '' },
    team: { items: [], profile: null, adminUser: null, recentProducts: [], loading: false, loaded: false, error: '' },
    logs: { items: [], detail: null, detailId: '', loading: false, loadingMore: false, loaded: false, error: '', filter: 'all', search: '', cursor: '', hasMore: false, pageSize: 15 }
  },
  settings: {
    data: {},
    loading: false,
    loaded: false,
    error: '',
    saving: false,
    updatedAt: null,
    updatedBy: '',
    dialog: { open: false, section: '' },
    emailStatus: null,
    resonaStats: null
  },
  operations: {
    loading: false,
    loaded: false,
    error: '',
    message: '',
    saving: '',
    banner: {},
    beta: {},
    pricing: {},
    studio: {
      library: null,
      loading: false,
      initializing: false,
      parsing: false,
      saving: false,
      progress: 0,
      parsedSamples: [],
      zipFile: null,
      htmlSourceFile: null,
      artworkFile: null,
      editingId: '',
      selectedFolderId: '',
      selectedInstrumentId: '',
      samplePlaybackModeTouched: false,
      expandedFolderIds: new Set(),
      addFolderOpen: false,
      folderPicker: {
        open: false,
        mode: '',
        targetId: '',
        selectedId: '',
        engineOnly: false,
        title: ''
      },
      form: {},
      error: '',
      message: ''
    },
    agreement: {
      agreementId: 'marketplace-product-seller-agreement',
      version: 'v1',
      uploading: false,
      message: '',
      error: '',
      storagePath: ''
    }
  },
  contact: {
    loading: false,
    loaded: false,
    error: '',
    emailStatus: null,
    emailForm: { to: '', cc: '', replyTo: '', subject: '', body: '', category: 'support', templateType: 'support', ctaLabel: '', ctaUrl: '', relatedUid: '', relatedProductId: '', relatedOrderId: '', relatedReportId: '' },
    emailSending: false,
    emailMessage: '',
    emailLogTab: 'sent',
    emailLogDetailId: '',
    emailLogDetailView: 'preview',
    emailLogSearch: '',
    emailLogSearchInput: '',
    emailLogs: {
      sent: { items: [], loading: false, loadingMore: false, loaded: false, error: '', cursor: '', hasMore: false },
      failed: { items: [], loading: false, loadingMore: false, loaded: false, error: '', cursor: '', hasMore: false },
      draft: { items: [], loading: false, loadingMore: false, loaded: false, error: '', cursor: '', hasMore: false }
    },
    systemForm: { recipientUid: '', recipientLabel: '', category: 'support', priority: 'normal', subject: '', body: '', actionLabel: '', actionUrl: '', internalNote: '' },
systemSending: false,
systemMessage: '',
supportForms: {

  items: [],

  loading: false,

  loadingMore: false,

  loaded: false,

  error: '',

  selectedId: '',

  savingId: '',

  cursor: null,

  hasMore: false,

  filter: 'unresolved'

},
supportThreads: {
  items: [],
  messages: [],
  loading: false,
  messagesLoading: false,
  loaded: false,
  error: '',
  selectedId: '',
  savingId: '',
  filter: 'active',
  replyDraft: '',
  message: ''
},
call: {
  roomName: 'melogic-phone-test',
  status: 'idle',
  message: '',
  error: '',
  muted: false,
  participants: 0,
  localIdentity: '',
  remoteParticipants: [],
  activeCalls: [],
  activeCallsLoading: false,
  activeCallsLoaded: false,
  activeCallsError: '',
  selectedCallId: '',
  manualCallCreating: false
}
  },
  dialog: {
    open: false,
    decision: '',
    productId: ''
  },
  productModerationDialog: {
    open: false,
    action: '',
    productId: '',
    submitting: false,
    error: ''
  },
  userActionDialog: {
    open: false,
    type: '',
    uid: ''
  },
  productGrantDialog: {
    open: false,
    uid: '',
    search: '',
    products: [],
    selectedProductIds: [],
    searching: false,
    submitting: false,
    error: ''
  }
}

let adminContactCallRoom = null
let adminContactCallAudioElements = []
let unsubscribeActiveSupportCalls = null
let unsubscribeSupportForms = null

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
    return value === 'light' ? 'light' : 'dark'
  } catch {
    return 'dark'
  }
}

function applyAdminTheme(theme = 'dark') {
  const nextTheme = theme === 'light' ? 'light' : 'dark'
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

function formatCount(value = 0) {
  const count = Math.max(0, Number(value || 0))
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return String(count)
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
    ai_active: 'AI Active',
    waiting_for_agent: 'Waiting for Agent',
    assigned: 'Assigned',
    resolved: 'Resolved',
    human_requested: 'Human Requested',
    refund_or_payment: 'Refund or Payment',
    missing_paid_purchase: 'Missing Paid Purchase',
    library_entitlement_issue: 'Library Access Issue',
    account_or_security_change: 'Account or Security Change',
    legal_tax_financial: 'Legal/Tax/Financial',
    product_grant_request: 'Product Grant Request',
    ai_unavailable: 'AI Unavailable',
    low_confidence: 'Low Confidence',
    marketplaceReviewer: 'Marketplace Reviewer',
    listingEditor: 'Listing Editor',
    emailSend: 'Email Send'
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
  if (permission === 'emailSend' && ['owner', 'admin'].includes(state.claims.adminRole || '')) return true
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
  if (path === ROUTES.adminCommunity || path.startsWith(`${ROUTES.adminCommunity}/`)) return 'community'
  if (path.startsWith(`${ROUTES.adminOrders}/`)) return 'orders'
  if (path.startsWith(`${ROUTES.adminTeam}/`)) return 'team'
  if (path.startsWith(`${ROUTES.adminLogs}/`)) return 'logs'
  if (path === ROUTES.adminTools || path.startsWith(`${ROUTES.adminTools}/`)) return 'tools'
  const section = SECTIONS.find((item) => item.route.replace(/\/+$/, '') === path)
  return section?.key || 'dashboard'
}

function adminUserDetailUid() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminUsers}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminUsers}/`.length).split('/')[0] || '').trim()
}

function adminCommunityDetailId() {
  const cleanPath = window.location.pathname.replace(/\/+$/, '')
  if (!cleanPath.startsWith(`${ROUTES.adminCommunity}/`)) return ''
  return decodeURIComponent(cleanPath.slice(`${ROUTES.adminCommunity}/`.length).split('/')[0] || '').trim()
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

function adminMfaRecommendation() {
  if (state.currentUserMfaEnabled) return ''
  if (!can('admin') && !['owner', 'admin'].includes(String(state.claims.adminRole || ''))) return ''
  return `
    <section class="admin-security-warning">
      <div>
        <strong>Admin accounts should enable two-factor authentication.</strong>
        <p>Authenticator-app 2FA is available in Account Security and will be required for sensitive admin actions in a later hardening phase.</p>
      </div>
      <a class="admin-secondary-link" href="${ROUTES.accountSecurity}">Open Security</a>
    </section>
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
      ${adminMfaRecommendation()}
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
  const overviewSupportForms = overview.supportForms || []
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
      <article class="admin-metric"><span>Unresolved Support</span><strong>${overview.loaded ? overviewSupportForms.length : '...'}</strong></article>
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
        adminOrderAmount(order),
        orderLifecycleLabel(order),
        htmlCell(`<a class="admin-row-action-button" href="${ROUTES.adminOrders}/${encodeURIComponent(order.id)}">Audit/View</a>`)
      ]), 'No recent orders loaded.')}
      ${overviewSnapshotTable('Support Queue Snapshot', `${ROUTES.adminContact}?mode=support`, ['Subject', 'Sender', 'Status', 'Created', 'Action'], overviewSupportForms.slice(0, 5).map((form) => [
        htmlCell(`<strong>${escapeHtml(form.subject || 'Untitled request')}</strong><small>${escapeHtml(supportFormPreview(form, 72))}</small>`),
        supportFormSender(form),
        htmlCell(renderBadge(humanLabel(form.status || 'new'), statusClass(form.status || 'new'))),
        formatDate(form.createdAt),
        htmlCell(`<a class="admin-row-action-button" href="${ROUTES.adminContact}?mode=support&support=${encodeURIComponent(form.id)}">Review</a>`)
      ]), 'No unresolved support forms.')}
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
  const primary = formatUsername(actor.username) || actor.displayName || actor.label || actor.name || log.actorEmail || 'System'
  const secondaryParts = [actor.role || log.actorRole, log.actorUid ? `UID ${shortIdentifier(log.actorUid)}` : ''].filter(Boolean)
  const secondary = secondaryParts.join(' · ')
  return htmlCell(`<strong>${escapeHtml(primary)}</strong>${secondary ? `<small class="admin-code-value">${escapeHtml(secondary)}</small>` : ''}`)
}

function adminLogTargetCell(log = {}) {
  const target = log.targetSummary || {}
  const primary = target.label || target.title || formatUsername(target.username) || 'Target'
  const secondary = target.secondary || target.slug || (log.targetId ? `ID ${shortIdentifier(log.targetId)}` : '')
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
            ${event.emailSkipped ? `<p class="admin-muted">Email skipped: ${escapeHtml(event.emailSkipReason || 'not configured')}</p>` : ''}
            ${event.emailSent ? '<p class="admin-muted">Security email sent.</p>' : ''}
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
        ${product.status === 'hidden'
          ? `<button type="button" class="admin-secondary-button" data-admin-product-moderation="unhide:${escapeHtml(product.id)}">Unhide Product</button>`
          : product.status !== 'removed'
            ? `<button type="button" class="admin-secondary-button" data-admin-product-moderation="hide:${escapeHtml(product.id)}">Hide Product</button>`
            : ''}
        ${product.status !== 'removed' ? `<button type="button" class="admin-danger-button" data-admin-product-moderation="remove:${escapeHtml(product.id)}">Remove Product</button>` : ''}
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
    ${productModerationDialog(product)}
  `
}

function productModerationDialog(product = {}) {
  const dialog = state.productModerationDialog
  if (!dialog.open || dialog.productId !== product.id) return ''
  const isRemove = dialog.action === 'remove'
  const label = dialog.action === 'hide' ? 'Hide Product' : dialog.action === 'unhide' ? 'Unhide Product' : 'Remove Product'
  return `
    <div class="admin-modal-backdrop" data-close-product-moderation>
      <section class="admin-modal" role="dialog" aria-modal="true" aria-labelledby="admin-product-moderation-title">
        <h2 id="admin-product-moderation-title">${label}</h2>
        <p>${isRemove ? 'This immediately quarantines the product and disables marketplace access. Storage files are retained for audit.' : `${label} changes marketplace visibility without deleting product data.`}</p>
        <form data-product-moderation-form>
          <label><span>Reason</span><textarea data-product-moderation-reason maxlength="1200" rows="4" ${isRemove ? 'required' : ''}></textarea></label>
          ${isRemove ? '<label><span>Type REMOVE to confirm</span><input data-product-moderation-confirmation autocomplete="off" required /></label>' : ''}
          ${dialog.error ? `<p class="admin-form-error">${escapeHtml(dialog.error)}</p>` : ''}
          <div class="admin-modal-actions">
            <button type="button" class="admin-secondary-button" data-close-product-moderation ${dialog.submitting ? 'disabled' : ''}>Cancel</button>
            <button type="submit" class="${isRemove ? 'admin-danger-button' : 'admin-primary-button'}" ${dialog.submitting ? 'disabled' : ''}>${dialog.submitting ? 'Working...' : label}</button>
          </div>
        </form>
      </section>
    </div>
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

function adminPageHeader({ eyebrow = 'Admin', title = '', description = '', refreshLabel = 'Refresh' } = {}) {
  return `
    <header class="admin-page-header">
      <div>
        <p class="eyebrow">${escapeHtml(eyebrow)}</p>
        <h1>${escapeHtml(title)}</h1>
        ${description ? `<p>${escapeHtml(description)}</p>` : ''}
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

function mergePageItems(existing = [], incoming = []) {
  const seen = new Set()
  return [...existing, ...incoming].filter((item) => {
    const id = item?.id || item?.uid || item?.reportId || item?.emailId || ''
    if (!id) return true
    if (seen.has(id)) return false
    seen.add(id)
    return true
  })
}

function loadMoreControls(collection = '') {
  const data = adminData(collection)
  if (!data?.loaded || !data.hasMore) return ''
  return `
    <div class="admin-load-more-row">
      <button type="button" class="admin-secondary-button" data-admin-load-more="${escapeHtml(collection)}" ${data.loadingMore ? 'disabled' : ''}>${data.loadingMore ? 'Loading...' : 'Load more'}</button>
    </div>
  `
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
    ${loading || `${productAdminTable(products)}${loadMoreControls('products')}`}
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
            <a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminUsers}/${encodeURIComponent(user.uid)}">Audit/View</a>
          </span>
        </article>
      `).join('')}
    </div>
  `
}

function adminOrderAmount(order = {}) {
  return orderAmountAvailable(order)
    ? formatMoney(order.amountCents, order.currency)
    : 'Amount unavailable'
}

function adminUserLibraryTable(items = []) {
  return adminSimpleTable('Owned products and acquisitions', [
    'Product',
    'Acquisition',
    'Status',
    'Creator',
    'Amount',
    'Acquired',
    'Order / Stripe'
  ], items.map((item) => [
    htmlCell(`<strong>${escapeHtml(item.productTitle || 'Product metadata unavailable')}</strong><small class="admin-code-value">${escapeHtml(item.productId || '')}</small>${item.metadataAvailable === false ? '<small>Product metadata unavailable</small>' : ''}`),
    htmlCell(`<strong>${escapeHtml(humanLabel(item.acquisitionType || 'unknown'))}</strong><small>${escapeHtml((item.recordSources || []).join(' + ') || item.source || '')}</small>`),
    humanLabel(item.status || 'active'),
    htmlCell(`<strong>${escapeHtml(item.creatorName || 'Creator unavailable')}</strong>${item.creatorUid ? `<small class="admin-code-value">${escapeHtml(item.creatorUid)}</small>` : ''}`),
    item.pricePaid === null || item.pricePaid === undefined ? 'Amount unavailable' : formatMoney(item.pricePaid, item.currency),
    formatDate(item.acquiredAt || item.updatedAt || item.createdAt),
    htmlCell(`<strong>${escapeHtml(item.orderId || 'No order')}</strong>${item.stripeCheckoutSessionId ? `<small class="admin-code-value">${escapeHtml(item.stripeCheckoutSessionId)}</small>` : ''}`)
  ]), {
    className: 'is-user-commerce',
    emptyTitle: 'No owned products found.',
    emptyBody: 'No entitlement or library access records were found for this account.'
  })
}

function adminUserOrdersTable(orders = []) {
  return adminSimpleTable('User order history', [
    'Order',
    'State',
    'Amount',
    'Products',
    'Created / Paid',
    'Stripe',
    'Actions'
  ], orders.map((order) => [
    htmlCell(`<strong>${escapeHtml(order.id || 'Order')}</strong><small>${escapeHtml(order.paymentSource || '')}</small>`),
    orderLifecycleLabel(order),
    adminOrderAmount(order),
    htmlCell(`<strong>${Number(order.productCount || order.productIds?.length || 0)}</strong><small>${escapeHtml((order.productTitles || []).join(', ') || 'Product IDs available in order detail')}</small>`),
    htmlCell(`<strong>${escapeHtml(formatDate(order.paidAt || order.createdAt))}</strong>${order.paidAt ? `<small>Created ${escapeHtml(formatDate(order.createdAt))}</small>` : ''}`),
    htmlCell(order.checkoutSessionId ? `<span class="admin-code-value">${escapeHtml(order.checkoutSessionId)}</span>` : '<span>No Stripe session</span>'),
    htmlCell(`<a class="admin-secondary-link" href="${ROUTES.adminOrders}/${encodeURIComponent(order.id)}">Audit/View</a>`)
  ]), {
    className: 'is-user-orders',
    emptyTitle: 'No orders found.',
    emptyBody: 'No top-level order records were found for this account.'
  })
}

function adminCurrencyMap(value = {}) {
  const entries = Object.entries(value && typeof value === 'object' ? value : {})
  if (!entries.length) return formatMoney(0, 'USD')
  return entries.map(([currency, amount]) => formatMoney(amount, currency)).join(' + ')
}

function adminCreatorLedgerTable(entries = []) {
  return adminSimpleTable('Creator earnings ledger', [
    'Product / Order',
    'Gross',
    'Platform fee',
    'Stripe fee',
    'Creator net',
    'Status',
    'Available'
  ], entries.map((entry) => [
    htmlCell(`<strong>${escapeHtml(entry.productId || 'Product unavailable')}</strong><small class="admin-code-value">${escapeHtml(entry.orderId || '')}</small>`),
    entry.grossAmount === null ? 'Amount unavailable' : formatMoney(entry.grossAmount, entry.currency),
    entry.platformFeeAmount === null ? 'Amount unavailable' : formatMoney(entry.platformFeeAmount, entry.currency),
    entry.stripeFeeAmount === null ? 'Pending lookup' : formatMoney(entry.stripeFeeAmount, entry.currency),
    entry.creatorNetAmount === null ? 'Amount unavailable' : formatMoney(entry.creatorNetAmount, entry.currency),
    humanLabel(entry.status || 'pending'),
    formatDate(entry.availableAt)
  ]), {
    className: 'is-user-orders',
    emptyTitle: 'No creator earnings found.',
    emptyBody: 'No paid marketplace ledger entries were found for this creator.'
  })
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
  const canGrantProduct = can('orderSupport') || can('listingEdit')
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
        <button type="button" class="admin-secondary-button" data-admin-give-product="${escapeHtml(uid)}" ${canGrantProduct ? '' : 'disabled title="Order support or listing edit permission is required."'}>Give Product</button>
        <button type="button" class="admin-secondary-button" data-admin-message-user="${escapeHtml(uid)}" ${isSelf ? 'disabled title="You cannot open a direct message with yourself."' : ''}>Message</button>
        <button type="button" class="admin-secondary-button" data-admin-email-user="${escapeHtml(uid)}" ${can('emailSend') && user?.email ? '' : 'disabled title="emailSend permission and a user email are required."'}>Email User</button>
        <button type="button" class="admin-secondary-button" data-admin-auth-email="password_reset" data-admin-auth-email-uid="${escapeHtml(uid)}" ${can('emailSend') && user?.email ? '' : 'disabled title="emailSend permission and a user email are required."'}>Send Reset</button>
        <button type="button" class="admin-secondary-button" data-admin-force-reset="${escapeHtml(uid)}" ${can('userModerate') && user?.email ? '' : 'disabled title="User moderation permission and a user email are required."'}>Force Reset</button>
        <button type="button" class="admin-secondary-button" data-admin-temp-password="${escapeHtml(uid)}" ${can('roleManage') ? '' : 'disabled title="Owner role management permission is required."'}>Set Temporary Password</button>
        <button type="button" class="admin-secondary-button is-danger" data-admin-revoke-recovery="${escapeHtml(uid)}" ${can('roleManage') && user.recoveryCodesGenerated ? '' : 'disabled title="Owner role management permission and generated recovery codes are required."'}>Revoke Codes</button>
        <button type="button" class="admin-secondary-button" data-admin-auth-email="email_verification" data-admin-auth-email-uid="${escapeHtml(uid)}" ${can('emailSend') && user?.email && !user.emailVerified ? '' : 'disabled title="Only available for unverified email accounts with emailSend permission."'}>Send Verification</button>
        <button type="button" class="admin-secondary-button" data-admin-security-notice-user="${escapeHtml(uid)}" ${can('emailSend') ? '' : 'disabled title="emailSend permission is required."'}>Security Notice</button>
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
        <article class="admin-metric"><span>Owned</span><strong>${Number(data.libraryItems?.length || 0)}</strong></article>
        <article class="admin-metric"><span>Reports</span><strong>${Number(user.reportCount || 0)}</strong></article>
        <article class="admin-metric"><span>Orders</span><strong>${Number(data.orders?.length || 0)}</strong></article>
        <article class="admin-metric"><span>Role</span><strong>${escapeHtml(humanLabel(user.adminRole || user.role || 'user'))}</strong></article>
        <article class="admin-metric"><span>Status</span><strong>${escapeHtml(user.suspended ? 'Suspended' : user.adminActive ? 'Admin Active' : 'Active')}</strong></article>
        <article class="admin-metric"><span>Email</span><strong>${escapeHtml(user.emailVerified ? 'Verified' : 'Unverified')}</strong></article>
        <article class="admin-metric"><span>2FA</span><strong>${escapeHtml(user.mfaEnabled ? 'Enabled' : 'Off')}</strong></article>
      </section>
      <section class="admin-hub-grid">
        <article class="admin-section-slab admin-fixed-panel">
          <div class="admin-slab-heading"><h2>Overview</h2>${renderBadge(user.suspended ? 'Suspended' : 'Active', user.suspended ? 'rejected' : 'published')}</div>
          <div class="admin-panel-scroll">
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
          </div>
        </article>
        <article class="admin-section-slab admin-fixed-panel">
          <div class="admin-slab-heading"><h2>Security / Activity</h2><span class="admin-muted">Read only</span></div>
          <div class="admin-panel-scroll">
            ${renderKeyValueGrid([
              renderBooleanField('Admin active', user.adminActive || adminUser.active),
              renderBooleanField('Email verified', user.emailVerified),
              renderBooleanField('2FA enabled', user.mfaEnabled),
              renderField('2FA factors', String(Number(user.mfaFactorCount || 0))),
              renderBooleanField('Recovery codes generated', user.recoveryCodesGenerated),
              renderField('Recovery codes remaining', String(Number(user.recoveryCodesRemaining || 0))),
              renderDateField('Recovery codes generated at', user.recoveryCodesGeneratedAt),
              renderField('Auth providers', normalizeList(user.authProviderIds || []).join(', ') || 'Not recorded'),
              renderField('Admin role', humanLabel(adminUser.role || user.adminRole)),
              renderField('Updated by', adminUser.updatedBy, { code: true }),
              renderDateField('Role updated', adminUser.updatedAt),
              renderDateField('Last sign-in', user.authLastSignInAt || user.lastActiveAt),
              renderDateField('Last security event', user.lastSecurityEventAt),
              renderField('Recent account events', String(Number(user.recentAccountEventCount || 0)))
            ])}
            ${accountEventsList(data.accountEvents || [])}
          </div>
        </article>
      </section>
      <section class="admin-section-slab admin-fixed-panel is-products-panel">
        <div class="admin-slab-heading"><h2>Products</h2><span class="admin-muted">${data.recentProducts?.length || 0} loaded</span></div>
        <div class="admin-table-scroll">${data.recentProducts?.length ? productAdminTable(data.recentProducts) : '<article class="admin-empty-state">No recent products loaded for this creator.</article>'}</div>
      </section>
      <section class="admin-section-slab admin-fixed-panel is-products-panel">
        <div class="admin-slab-heading"><h2>Library / Acquisitions</h2><span class="admin-muted">${data.libraryItems?.length || 0} source-of-truth product(s)</span></div>
        <div class="admin-table-scroll">${adminUserLibraryTable(data.libraryItems || [])}</div>
      </section>
      <section class="admin-section-slab admin-fixed-panel is-products-panel">
        <div class="admin-slab-heading"><h2>Orders / Payments</h2><span class="admin-muted">${data.orders?.length || 0} source order(s)</span></div>
        <div class="admin-table-scroll">${adminUserOrdersTable(data.orders || [])}</div>
      </section>
      <section class="admin-section-slab admin-fixed-panel is-products-panel">
        <div class="admin-slab-heading"><h2>Billing &amp; Payouts</h2><span class="admin-muted">Safe Stripe Connect status</span></div>
        <div class="admin-panel-scroll">
          ${renderKeyValueGrid([
            renderBooleanField('Connected account', data.payoutConnect?.hasAccount),
            renderField('Account type', data.payoutConnect?.hasAccount ? humanLabel(data.payoutConnect?.accountType || 'express') : 'Not connected'),
            renderBooleanField('Details submitted', data.payoutConnect?.detailsSubmitted),
            renderBooleanField('Charges enabled', data.payoutConnect?.chargesEnabled),
            renderBooleanField('Payouts enabled', data.payoutConnect?.payoutsEnabled),
            renderField('Stripe mode', data.payoutConnect?.hasAccount ? (data.payoutConnect?.livemode ? 'Live' : 'Test') : 'Not connected'),
            renderField('Disabled reason', humanLabel(data.payoutConnect?.disabledReason || ''), { wide: true }),
            renderField('Currently due', (data.payoutConnect?.currentlyDue || []).map(humanLabel).join(', ') || 'None', { wide: true }),
            renderField('Pending earnings', adminCurrencyMap(data.earningsSummary?.pendingByCurrency), { wide: true }),
            renderField('Available earnings', adminCurrencyMap(data.earningsSummary?.availableByCurrency), { wide: true }),
            renderField('Lifetime creator net', adminCurrencyMap(data.earningsSummary?.lifetimeNetByCurrency), { wide: true }),
            renderField('Transferred earnings', adminCurrencyMap(data.earningsSummary?.withdrawnByCurrency), { wide: true }),
            renderField('Awaiting Stripe fee data', String(Number(data.earningsSummary?.unfinalizedEntryCount || 0)))
          ])}
        </div>
        <div class="admin-table-scroll">${adminCreatorLedgerTable(data.creatorLedgerEntries || [])}</div>
      </section>
      <section class="admin-hub-grid">
        <article class="admin-section-slab admin-fixed-panel is-short"><div class="admin-slab-heading"><h2>Reports</h2></div><div class="admin-panel-scroll"><article class="admin-empty-state">No report detail data is loaded for this account yet.</article></div></article>
        <article class="admin-section-slab admin-fixed-panel is-short"><div class="admin-slab-heading"><h2>Admin Notes</h2><button type="button" class="admin-secondary-button" data-admin-note-user="${escapeHtml(uid)}" ${!canNote ? 'disabled title="User moderation or order support permission is required."' : ''}>Add Note</button></div><div class="admin-panel-scroll">${adminNotesList(data.adminNotes || [])}</div></article>
        <article class="admin-section-slab admin-fixed-panel is-short"><div class="admin-slab-heading"><h2>Timeline / Logs</h2><a href="${ROUTES.adminLogs}" class="admin-secondary-link">Open Logs</a></div><div class="admin-panel-scroll"><article class="admin-empty-state">Role changes and admin actions are available in Logs.</article></div></article>
      </section>
      ${userActionDialog()}
      ${productGrantDialog()}
    ` : `<article class="admin-empty-state">No profile found for ${escapeHtml(uid)}.</article>${userActionDialog()}${productGrantDialog()}`}
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
    ${loading || `${usersTable(users)}${loadMoreControls('users')}`}
    ${productGrantDialog()}
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
  const reportsTable = adminSimpleTable('Reports', ['Type', 'Target', 'Reporter', 'Reason', 'Priority', 'Status', 'Created', 'Assigned', 'Actions'], reports.map((report) => [
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
  })
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
    ${loading || `${reportsTable}${loadMoreControls('reports')}`}
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
  if (targetType === 'community_story' && targetId) return `<a class="admin-secondary-link" href="${ROUTES.community}?story=${encodeURIComponent(targetId)}" target="_blank" rel="noreferrer">Open Community Stories</a>`
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
        <p>${escapeHtml(order.buyerEmail || order.buyerUid || order.uid || 'Unknown buyer')} · ${escapeHtml(adminOrderAmount(order))} · ${escapeHtml(orderLifecycleLabel(order))}</p>
        <p class="admin-code-value">${escapeHtml(order.id)} · ${escapeHtml(humanLabel(order.refundStatus) || 'No refund')} · ${escapeHtml(formatDate(order.createdAt))}</p>
        <div class="admin-heading-badges">
          ${renderBadge(order.livemode ? 'Stripe Live Mode' : 'Stripe Test Mode', order.livemode ? 'pending' : 'published')}
          ${renderBadge(humanLabel(order.paymentSource || 'stripe_checkout'))}
        </div>
      </div>
      <div class="admin-header-actions">
        <button type="button" class="admin-secondary-button" data-repair-admin-order="${escapeHtml(order.id)}" ${data.repairing ? 'disabled' : ''}>${data.repairing === order.id ? 'Checking Stripe...' : 'Repair from Stripe'}</button>
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
      <article class="admin-metric"><span>Amount</span><strong>${escapeHtml(adminOrderAmount(order))}</strong></article>
      <article class="admin-metric"><span>Payment</span><strong>${escapeHtml(orderLifecycleLabel(order))}</strong></article>
      <article class="admin-metric"><span>Refund</span><strong>${escapeHtml(humanLabel(order.refundStatus) || 'None')}</strong></article>
      <article class="admin-metric"><span>Items</span><strong>${Number(order.productCount || items.length || 0)}</strong></article>
      <article class="admin-metric"><span>Created</span><strong>${escapeHtml(formatDate(order.createdAt))}</strong></article>
    </section>
    ${mismatchWarnings.length ? `<section class="admin-section-slab"><div class="admin-slab-heading"><h2>Order Warnings</h2>${renderBadge('Needs Review', 'pending')}</div><ul class="admin-warning-list">${mismatchWarnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join('')}</ul></section>` : ''}
    <section class="admin-hub-grid">
      <article class="admin-section-slab">
        <div class="admin-slab-heading"><h2>Overview</h2>${renderBadge(orderLifecycleLabel(order))}</div>
        ${renderKeyValueGrid([
          renderField('Order ID', order.id, { code: true }),
          renderField('Buyer UID', order.buyerUid || order.uid, { code: true }),
          renderField('Buyer email', order.buyerEmail),
          renderField('Amount', adminOrderAmount(order)),
          renderField('Currency', order.currency),
          renderField('Payment status', orderLifecycleLabel(order)),
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
          renderField('Payment status', orderLifecycleLabel(order)),
          renderField('Livemode', order.livemode ? 'Live' : 'Test'),
          renderField('Amount', adminOrderAmount(order))
        ])}
      </article>
    </section>
    <section class="admin-section-slab">
      <div class="admin-slab-heading"><h2>Products / Items</h2><span class="admin-muted">${items.length || order.productCount || 0} item(s)</span></div>
      ${items.length ? adminSimpleTable('Order Items', ['Product', 'Creator', 'Amount', 'Entitlement', 'Actions'], items.map((item) => [
        htmlCell(`<strong>${escapeHtml(item.title || item.productId || 'Product')}</strong><small class="admin-code-value">${escapeHtml(item.productId || '')}</small>`),
        item.creatorUid,
        Number.isFinite(Number(item.amountCents)) ? formatMoney(item.amountCents, item.currency || order.currency) : 'Amount unavailable',
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
    if (data.filter === 'paid') return isPaidMoneyOrder(order)
    if (data.filter === 'free') return orderAmountAvailable(order) && Number(order.amountCents || 0) === 0
    if (data.filter === 'refund_requested') return order.refundStatus === 'requested'
    if (data.filter === 'refunded') return order.refundStatus === 'refunded'
    if (data.filter === 'failed') return ['failed', 'canceled'].includes(order.paymentStatus)
    if (data.filter === 'recent') return (Date.now() - new Date(order.createdAt || 0).getTime()) <= 30 * 24 * 60 * 60 * 1000
    return true
  })
  const revenue = orders.filter(isPaidMoneyOrder).reduce((sum, order) => sum + Number(order.amountCents || 0), 0)
  const ordersTable = adminSimpleTable('Orders', ['Order ID', 'Buyer', 'Products', 'Amount', 'Payment', 'Refund', 'Created', 'Actions'], orders.map((order) => [
    order.id,
    order.buyerUid || order.uid,
    order.productTitles?.join(', ') || `${order.productCount || 0} product(s)`,
    adminOrderAmount(order),
    orderLifecycleLabel(order),
    humanLabel(order.refundStatus),
    formatDate(order.createdAt),
    htmlCell(`<a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminOrders}/${encodeURIComponent(order.id)}">Audit/View</a>`)
  ]), {
    className: 'is-orders',
    emptyTitle: 'No orders yet.',
    emptyBody: 'Paid purchases, free claims, refunds, and entitlement issues will appear here.'
  })
  return `
    ${adminPageHeader({ eyebrow: 'Commerce', title: 'Orders', refreshLabel: 'Refresh orders' })}
    <section class="admin-metric-grid">
      <article class="admin-metric"><span>Total Revenue</span><strong>${escapeHtml(formatMoney(revenue, 'USD'))}</strong></article>
      <article class="admin-metric"><span>Orders</span><strong>${orders.length}</strong></article>
      <article class="admin-metric"><span>Refund / Failed</span><strong>${orders.filter((order) => order.refundStatus || order.paymentStatus === 'failed').length}</strong></article>
    </section>
    <section class="admin-review-tools">${adminFilterControls('orders', ORDER_ADMIN_FILTERS)}</section>
    ${loading || `${ordersTable}${loadMoreControls('orders')}`}
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
  const keys = ['admin', 'productReview', 'listingEdit', 'userRead', 'userModerate', 'orderSupport', 'roleManage', 'auditRead', 'settingsManage', 'emailSend']
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
    ${loading || `${logsTable(data.items)}${loadMoreControls('logs')}`}
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

function productGrantDialog() {
  const dialog = state.productGrantDialog || {}
  if (!dialog.open || !dialog.uid) return ''
  const selectedIds = new Set(dialog.selectedProductIds || [])
  const products = dialog.products || []
  return `
    <div class="admin-modal-backdrop" role="presentation">
      <section class="admin-decision-modal admin-product-grant-modal" role="dialog" aria-modal="true" aria-labelledby="admin-product-grant-title">
        <header>
          <div>
            <h2 id="admin-product-grant-title">Give Product</h2>
            <p class="admin-muted">Grant one or more Marketplace products to <span class="admin-code-value">${escapeHtml(dialog.uid)}</span>.</p>
          </div>
          <button type="button" class="admin-icon-button" data-close-product-grant title="Close">${iconSvg('x')}</button>
        </header>
        <form class="admin-product-grant-search" data-product-grant-search-form>
          <label>
            <span>Search products</span>
            <div class="admin-product-grant-search-row">
              <input name="search" value="${escapeHtml(dialog.search || '')}" maxlength="180" placeholder="Title, product ID, creator, or slug" autocomplete="off" />
              <button type="submit" class="admin-secondary-button" ${dialog.searching || dialog.submitting ? 'disabled' : ''}>${dialog.searching ? 'Searching...' : 'Search'}</button>
            </div>
          </label>
        </form>
        ${dialog.error ? `<p class="admin-error">${escapeHtml(dialog.error)}</p>` : ''}
        <form data-product-grant-form>
          <div class="admin-grant-product-results" aria-live="polite">
            ${dialog.searching
              ? '<article class="admin-empty-state">Searching Marketplace products...</article>'
              : products.length
                ? products.map((product) => {
                    const productId = String(product.id || product.productId || '')
                    const checked = selectedIds.has(productId)
                    return `
                      <label class="admin-grant-product-row ${product.alreadyOwned ? 'is-owned' : ''}">
                        <input
                          type="checkbox"
                          data-grant-product-id="${escapeHtml(productId)}"
                          ${checked ? 'checked' : ''}
                          ${product.alreadyOwned || dialog.submitting ? 'disabled' : ''}
                        />
                        <span class="admin-grant-product-copy">
                          <strong>${escapeHtml(product.title || productId || 'Untitled product')}</strong>
                          <small>${escapeHtml(product.artistName || product.artistDisplayName || 'Creator')} · ${escapeHtml(formatMoney(product.priceCents, product.currency))}</small>
                          <code>${escapeHtml(productId)}</code>
                        </span>
                        ${product.alreadyOwned ? '<span class="review-badge is-published">Already owned</span>' : ''}
                      </label>
                    `
                  }).join('')
                : dialog.search
                  ? '<article class="admin-empty-state">No matching products found.</article>'
                  : '<article class="admin-empty-state">Search for a product to begin.</article>'}
          </div>
          <div class="admin-modal-actions">
            <span class="admin-muted">${selectedIds.size} selected</span>
            <div class="admin-product-grant-actions">
              <button type="button" class="admin-secondary-button" data-close-product-grant ${dialog.submitting ? 'disabled' : ''}>Cancel</button>
              <button type="submit" class="admin-primary-link" ${!selectedIds.size || dialog.searching || dialog.submitting ? 'disabled' : ''}>${dialog.submitting ? 'Granting...' : 'Grant Selected'}</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  `
}

function operationsMode() {
  const params = new URLSearchParams(window.location.search)
  const mode = String(params.get('mode') || 'banner').toLowerCase()
  return ['banner', 'beta', 'pricing', 'agreement', 'studio'].includes(mode) ? mode : 'banner'
}

function operationsModeTabs(mode = operationsMode()) {
  const tabs = [
    ['banner', 'Banner Alerts'],
    ['beta', 'Private Beta'],
    ['pricing', 'Marketplace Pricing'],
    ['agreement', 'Seller Agreement'],
    ['studio', 'Studio']
  ]
  return `
    <nav class="admin-contact-tabs" aria-label="Operations modes">
      ${tabs.map(([key, label]) => `<a href="${ROUTES.adminOperations}?mode=${key}" class="${mode === key ? 'is-active' : ''}">${escapeHtml(label)}</a>`).join('')}
    </nav>
  `
}

function operationsSummaryCards() {
  const operations = state.operations
  const banner = operations.banner || {}
  const beta = operations.beta || {}
  const pricing = operations.pricing || {}
  return `
    <section class="admin-metric-grid is-compact">
      <article class="admin-metric"><span>Banner</span><strong>${banner.bannerActive ? 'Active' : 'Off'}</strong></article>
      <article class="admin-metric"><span>Private Beta</span><strong>${beta.isKeyRequired ? 'Required' : 'Open'}</strong></article>
      <article class="admin-metric"><span>Marketplace</span><strong>${pricing.enabled === false ? 'Disabled' : 'Enabled'}</strong></article>
      <article class="admin-metric"><span>Agreement</span><strong>${escapeHtml(operations.agreement?.version || 'v1')}</strong></article>
    </section>
  `
}

function formatDateTimeLocal(value) {
  if (!value) return ''
  const date = typeof value?.toDate === 'function' ? value.toDate() : value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

function operationTextInput({ name, label, value = '', type = 'text', helper = '', wide = false, required = false } = {}) {
  return `
    <label class="${wide ? 'is-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <input name="${escapeHtml(name)}" type="${escapeHtml(type)}" value="${escapeHtml(value ?? '')}" ${required ? 'required' : ''} />
      ${helper ? `<small>${escapeHtml(helper)}</small>` : ''}
    </label>
  `
}

function operationTextarea({ name, label, value = '', rows = 4, helper = '', wide = false } = {}) {
  return `
    <label class="${wide ? 'is-wide' : ''}">
      <span>${escapeHtml(label)}</span>
      <textarea name="${escapeHtml(name)}" rows="${rows}">${escapeHtml(value ?? '')}</textarea>
      ${helper ? `<small>${escapeHtml(helper)}</small>` : ''}
    </label>
  `
}

function operationCheckbox({ name, label, checked = false, helper = '' } = {}) {
  return `
    <label class="admin-checkbox-field">
      <input type="checkbox" name="${escapeHtml(name)}" ${checked ? 'checked' : ''} />
      <span>${escapeHtml(label)}</span>
      ${helper ? `<small>${escapeHtml(helper)}</small>` : ''}
    </label>
  `
}

function operationsView() {
  if (!can('admin')) return permissionState('admin')
  const mode = operationsMode()
  const operations = state.operations
  return `
    ${adminPageHeader({
      eyebrow: 'Platform',
      title: 'Operations',
      description: 'Manage platform-wide operational settings, private beta access, marketplace fees, and legal agreements.',
      refreshLabel: 'Refresh operations'
    })}
    ${operations.error ? `<p class="admin-status is-error">${escapeHtml(operations.error)}</p>` : ''}
    ${operations.message ? `<p class="admin-status is-success">${escapeHtml(operations.message)}</p>` : ''}
    ${operations.loading ? '<article class="admin-empty-state">Loading operations...</article>' : ''}
    ${operationsSummaryCards()}
    ${operationsModeTabs(mode)}
    ${mode === 'banner' ? operationsBannerPanel() : ''}
    ${mode === 'beta' ? operationsBetaPanel() : ''}
    ${mode === 'pricing' ? operationsPricingPanel() : ''}
    ${mode === 'agreement' ? operationsAgreementPanel() : ''}
    ${mode === 'studio' ? operationsStudioPanel() : ''}
  `
}

function operationsBannerPanel() {
  const banner = state.operations.banner || {}
  const saving = state.operations.saving === 'banner'
  return `
    <section class="admin-section-slab admin-operations-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>Banner Alerts</h2>
          <p class="admin-muted">Edit the public operational banner stored at <code class="admin-code-value">/operations/bannerAlerts</code>.</p>
        </div>
        <span class="review-badge ${banner.bannerActive ? 'is-approved' : ''}">${banner.bannerActive ? 'Active' : 'Inactive'}</span>
      </div>
      <form class="admin-email-form admin-operations-form" data-operations-form="banner">
        <div class="admin-form-grid">
          ${operationCheckbox({ name: 'bannerActive', label: 'Active', checked: banner.bannerActive })}
          ${operationCheckbox({ name: 'bannerDismissible', label: 'Dismissible', checked: banner.bannerDismissible !== false })}
          ${operationTextInput({ name: 'bannerAudience', label: 'Audience', value: banner.bannerAudience || 'all', helper: 'all, signedIn, or signedOut' })}
          ${operationTextInput({ name: 'bannerColor', label: 'Banner color', type: 'color', value: banner.bannerColor || '#20d8ff' })}
          ${operationTextInput({ name: 'bannerButtonText', label: 'Button text', value: banner.bannerButtonText || '' })}
          ${operationTextInput({ name: 'bannerButtonUrl', label: 'Button URL', value: banner.bannerButtonUrl || '' })}
          ${operationTextInput({ name: 'bannerPriority', label: 'Priority', type: 'number', value: banner.bannerPriority ?? 1 })}
          ${operationTextInput({ name: 'bannerVersion', label: 'Version', type: 'number', value: banner.bannerVersion ?? 1 })}
          ${operationTextInput({ name: 'bannerIcon', label: 'Icon number', type: 'number', value: banner.bannerIcon ?? 1 })}
          ${operationTextInput({ name: 'bannerType', label: 'Type number', type: 'number', value: banner.bannerType ?? 1 })}
          ${operationTextInput({ name: 'bannerStartsAt', label: 'Starts at', type: 'datetime-local', value: formatDateTimeLocal(banner.bannerStartsAt) })}
          ${operationTextInput({ name: 'bannerExpiresAt', label: 'Expires at', type: 'datetime-local', value: formatDateTimeLocal(banner.bannerExpiresAt) })}
          ${operationTextarea({ name: 'bannerContent', label: 'Banner content', value: arrayToLines(banner.bannerContent), rows: 4, helper: 'One banner line per row.', wide: true })}
          ${operationTextarea({ name: 'bannerAllowedPaths', label: 'Allowed paths', value: arrayToLines(banner.bannerAllowedPaths), rows: 4, helper: 'Optional. One path per row.', wide: true })}
          ${operationTextarea({ name: 'bannerBlockedPaths', label: 'Blocked paths', value: arrayToLines(banner.bannerBlockedPaths), rows: 4, helper: 'Optional. One path per row.', wide: true })}
        </div>
        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${saving ? 'disabled' : ''}>${saving ? 'Saving...' : 'Save Banner'}</button>
        </div>
      </form>
    </section>
  `
}

function operationsBetaPanel() {
  const beta = state.operations.beta || {}
  const saving = state.operations.saving === 'beta'
  return `
    <section class="admin-section-slab admin-operations-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>Private Beta</h2>
          <p class="admin-muted">Edit key-gate settings at <code class="admin-code-value">/operations/keyRequiredInfo</code>. Admin routes bypass this gate and still require admin auth.</p>
        </div>
        <span class="review-badge ${beta.isKeyRequired ? 'is-warning' : 'is-approved'}">${beta.isKeyRequired ? 'Key Required' : 'Open'}</span>
      </div>
      <form class="admin-email-form admin-operations-form" data-operations-form="beta">
        <div class="admin-form-grid">
          ${operationCheckbox({ name: 'isKeyRequired', label: 'Key required', checked: beta.isKeyRequired })}
          ${operationTextInput({ name: 'title', label: 'Title', value: beta.title || 'Private Beta' })}
          ${operationTextInput({ name: 'brandName', label: 'Brand name', value: beta.brandName || 'Melogic Records' })}
          ${operationTextInput({ name: 'supportEmail', label: 'Support email', type: 'email', value: beta.supportEmail || '' })}
          ${operationTextInput({ name: 'keyValue', label: 'Key value', value: beta.keyValue || '', helper: 'Temporary plaintext beta key. Prefer keyHash later.' })}
          ${operationTextInput({ name: 'keyHash', label: 'Key hash', value: beta.keyHash || '' })}
          ${operationTextInput({ name: 'keyVersion', label: 'Key version', type: 'number', value: beta.keyVersion ?? 1 })}
          ${operationTextInput({ name: 'bypassUntil', label: 'Bypass until', type: 'datetime-local', value: formatDateTimeLocal(beta.bypassUntil) })}
          ${operationTextarea({ name: 'message', label: 'Message', value: beta.message || '', rows: 5, wide: true })}
          ${operationTextarea({ name: 'allowedPublicPaths', label: 'Allowed public paths', value: arrayToLines(beta.allowedPublicPaths), rows: 5, helper: 'One public path per row. Admin routes are bypassed in code, not by this public list.', wide: true })}
        </div>
        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${saving ? 'disabled' : ''}>${saving ? 'Saving...' : 'Save Private Beta'}</button>
        </div>
      </form>
    </section>
  `
}

function operationsPricingPanel() {
  const pricing = state.operations.pricing || {}
  const notice = pricing.transactionNotice || {}
  const saving = state.operations.saving === 'pricing'
  return `
    <section class="admin-section-slab admin-operations-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>Marketplace Pricing</h2>
          <p class="admin-muted">Edit payment settings at <code class="admin-code-value">/platformSettings/marketplacePricing</code>.</p>
        </div>
        <span class="review-badge ${pricing.enabled === false ? 'is-warning' : 'is-approved'}">${pricing.enabled === false ? 'Disabled' : 'Enabled'}</span>
      </div>
      <form class="admin-email-form admin-operations-form" data-operations-form="pricing">
        <div class="admin-form-grid">
          ${operationCheckbox({ name: 'enabled', label: 'Enabled', checked: pricing.enabled !== false })}
          ${operationTextInput({ name: 'defaultCurrency', label: 'Default currency', value: pricing.defaultCurrency || 'USD' })}
          ${operationTextInput({ name: 'feeMode', label: 'Fee mode', value: pricing.feeMode || 'seller_absorbs' })}
          ${operationTextInput({ name: 'platformFeeBps', label: 'Platform fee BPS', type: 'number', value: pricing.platformFeeBps ?? 1100, helper: '1100 bps = 11%' })}
          ${operationTextInput({ name: 'platformFeeLabel', label: 'Platform fee label', value: pricing.platformFeeLabel || 'Melogic Records Fee' })}
          ${operationTextInput({ name: 'processorPercentBps', label: 'Processor percent BPS', type: 'number', value: pricing.processorPercentBps ?? 290, helper: '290 bps = 2.9%' })}
          ${operationTextInput({ name: 'processorFixedFeeCents', label: 'Processor fixed fee cents', type: 'number', value: pricing.processorFixedFeeCents ?? 30, helper: '30 cents = $0.30' })}
          ${operationTextInput({ name: 'professorFeeLabel', label: 'Processor fee label', value: pricing.professorFeeLabel || 'Stripe Fee', helper: 'Stored as existing professorFeeLabel key for compatibility.' })}
          ${operationTextInput({ name: 'version', label: 'Version', type: 'number', value: pricing.version ?? 1 })}
          ${operationTextarea({ name: 'supportedCurrencies', label: 'Supported currencies', value: arrayToLines(pricing.supportedCurrencies), rows: 4, wide: true })}
          ${operationTextarea({ name: 'salesMilestones', label: 'Sales milestones', value: arrayToLines(pricing.salesMilestones), rows: 4, helper: 'One numeric milestone per row.', wide: true })}
          ${operationTextInput({ name: 'transactionNotice.title', label: 'Transaction notice title', value: notice.title || '', wide: true })}
          ${operationTextarea({ name: 'transactionNotice.commission', label: 'Commission notice', value: notice.commission || '', rows: 4, wide: true })}
          ${operationTextarea({ name: 'transactionNotice.processingFees', label: 'Processing fees notice', value: notice.processingFees || '', rows: 4, wide: true })}
          ${operationTextarea({ name: 'transactionNotice.supportedMethods', label: 'Supported methods notice', value: notice.supportedMethods || '', rows: 4, wide: true })}
        </div>
        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${saving ? 'disabled' : ''}>${saving ? 'Saving...' : 'Save Marketplace Pricing'}</button>
        </div>
      </form>
    </section>
  `
}

function operationsAgreementPanel() {
  const agreement = state.operations.agreement || {}
  const uploading = agreement.uploading || state.operations.saving === 'agreement'
  const basePath = 'legal/agreements/marketplace-product-seller-agreement'
  return `
    <section class="admin-section-slab admin-operations-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>Seller Agreement</h2>
          <p class="admin-muted">Replace the Marketplace Product Seller Agreement Markdown in Firebase Storage.</p>
        </div>
        <span class="review-badge">Markdown</span>
      </div>
      <dl class="admin-field-grid is-compact">
        ${renderField('Base Storage path', basePath, { code: true, wide: true })}
        ${renderField('Last uploaded path', agreement.storagePath || '', { code: true, wide: true })}
      </dl>
      ${agreement.error ? `<p class="admin-status is-error">${escapeHtml(agreement.error)}</p>` : ''}
      ${agreement.message ? `<p class="admin-status is-success">${escapeHtml(agreement.message)}</p>` : ''}
      <form class="admin-email-form admin-operations-form" data-operations-form="agreement">
        <div class="admin-form-grid">
          ${operationTextInput({ name: 'agreementId', label: 'Agreement ID', value: agreement.agreementId || 'marketplace-product-seller-agreement', required: true })}
          ${operationTextInput({ name: 'version', label: 'Version', value: agreement.version || 'v1', helper: 'Use lowercase v plus a number, such as v2.', required: true })}
          <label class="is-wide">
            <span>Agreement Markdown file</span>
            <input type="file" name="agreementFile" accept=".md,text/markdown,text/plain" ${uploading ? 'disabled' : ''} />
            <small>Uses the existing uploadSellerAgreementMarkdown helper. Files are stored as legal/agreements/{agreementId}/{version}.md.</small>
          </label>
        </div>
        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${uploading ? 'disabled' : ''}>${uploading ? 'Uploading...' : 'Upload Seller Agreement'}</button>
        </div>
      </form>
    </section>
  `
}

function defaultStudioInstrumentForm() {
  return {
    name: '',
    id: '',
    destinationFolderId: '',
    folderPath: '',
    engineType: 'sample-based',
    description: '',
    sampleStrategy: 'thirds',
    samplePlaybackMode: 'pitch-modified',
    version: 1,
    licenseType: 'owned',
    sourceName: 'Melogic Records',
    sourceUrl: '',
    licenseUrl: '',
    attributionRequired: false,
    commercialAllowed: true,
    enabled: true,
    visibility: 'public',
    runtime: '',
    htmlSourcePath: '',
    overwrite: false
  }
}

function studioInstrumentFormState() {
  return { ...defaultStudioInstrumentForm(), ...(state.operations.studio.form || {}) }
}

function studioOperationsSubnav() {
  return `
    <nav class="admin-contact-tabs admin-operations-subtabs" aria-label="Studio operations">
      <a class="is-active" href="${ROUTES.adminOperations}?mode=studio&studioMode=daw">DAW</a>
    </nav>
  `
}

function renderAdminStudioFolderNode(folder, studio, instruments, depth = 0) {
  const children = folder.children || []
  const expanded = studio.expandedFolderIds.has(folder.id)
  const selected = studio.selectedFolderId === folder.id
  const folderCount = instruments.filter((item) => item.folderPath === folder.path).length
  return `<div class="admin-studio-folder-node" style="--admin-folder-depth:${depth}">
    <div class="admin-studio-folder-row ${selected ? 'is-selected' : ''}">
      <button type="button" class="admin-studio-folder-toggle" data-admin-studio-folder-toggle="${escapeHtml(folder.id)}" ${children.length ? '' : 'disabled'} aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(folder.label)}">${children.length ? (expanded ? '−' : '+') : ''}</button>
      <button type="button" class="admin-studio-folder-select" data-admin-studio-folder-select="${escapeHtml(folder.id)}">
        <strong>${escapeHtml(folder.label)}</strong>
        <small>${escapeHtml(folder.type)}${folder.engineType ? ` · ${escapeHtml(folder.engineType)}` : ''}</small>
      </button>
      ${folderCount ? `<span>${folderCount}</span>` : ''}
    </div>
    ${children.length && expanded ? `<div class="admin-studio-folder-children">${children.map((child) => renderAdminStudioFolderNode(child, studio, instruments, depth + 1)).join('')}</div>` : ''}
  </div>`
}

function adminStudioFolderBreadcrumb(folder) {
  return String(folder?.path || '').split('/').filter(Boolean).map((part) => `<span>${escapeHtml(part)}</span>`).join('<i>/</i>')
}

function isAdminStudioPickerDestinationAllowed(folder, picker, library) {
  if (!folder || !folder.path || folder.path.includes('..')) return false
  if (picker.mode === 'move-instrument' || picker.mode === 'instrument-form') return true
  if (picker.mode !== 'move-folder') return true
  const target = findFolderById(library.folders, picker.targetId)
  if (!target || target.type === 'source-root' || folder.type === 'engine-folder') return false
  if (target.id === folder.id) return false
  if (target.path && (folder.path === target.path || folder.path.startsWith(`${target.path}/`))) return false
  if (target.type === 'engine-folder' && folder.type === 'source-root') return false
  return !(folder.children || []).some((child) => child.id !== target.id && child.label.toLowerCase() === target.label.toLowerCase())
}

function renderAdminStudioPickerNode(folder, picker, library, depth = 0) {
  const allowed = isAdminStudioPickerDestinationAllowed(folder, picker, library)
  const selected = picker.selectedId === folder.id
  return `<div class="admin-daw-picker-node" style="--admin-picker-depth:${depth}">
    <button type="button" class="${selected ? 'is-selected' : ''}" data-admin-studio-picker-folder="${escapeHtml(folder.id)}" ${allowed ? '' : 'disabled'}>
      <span class="admin-daw-folder-glyph">${folder.type === 'engine-folder' ? 'E' : 'F'}</span>
      <span><strong>${escapeHtml(folder.label)}</strong><small>${escapeHtml(folder.path)}</small></span>
      <em>${escapeHtml(folder.engineType || folder.type)}</em>
    </button>
    ${(folder.children || []).map((child) => renderAdminStudioPickerNode(child, picker, library, depth + 1)).join('')}
  </div>`
}

function renderAdminStudioFolderPicker(library = {}) {
  const studio = state.operations.studio
  const picker = studio.folderPicker || {}
  if (!picker.open) return ''
  const selected = findFolderById(library.folders || [], picker.selectedId)
  const helper = picker.mode === 'move-instrument'
    ? 'Moving an instrument changes where it appears in the library. Existing sample file paths are preserved.'
    : picker.mode === 'move-folder'
      ? 'The folder and descendant manifest paths will be recalculated. Existing Storage objects are not moved.'
      : 'Choose any library folder. Engine folders are recommended, but organizational folders are also valid.'
  const unusualDestination = selected
    && (picker.mode === 'move-instrument' || picker.mode === 'instrument-form')
    && selected.type !== 'engine-folder'
  return `<div class="admin-modal-backdrop admin-daw-picker-backdrop" data-admin-studio-picker-close>
    <section class="admin-decision-modal admin-daw-folder-picker" role="dialog" aria-modal="true" aria-label="${escapeHtml(picker.title || 'Choose folder')}">
      <header><div><span class="eyebrow">Default DAW Library</span><h2>${escapeHtml(picker.title || 'Choose folder')}</h2></div><button type="button" class="admin-icon-button" data-admin-studio-picker-close aria-label="Close folder picker">×</button></header>
      <p class="admin-muted">${escapeHtml(helper)}</p>
      <div class="admin-daw-picker-tree">${(library.folders || []).map((folder) => renderAdminStudioPickerNode(folder, picker, library)).join('')}</div>
      <div class="admin-daw-picker-selection">
        <span>Destination</span>
        <strong>${escapeHtml(selected?.path || 'No folder selected')}</strong>
        ${selected ? `<small>${escapeHtml(selected.type)}${selected.engineType ? ` · ${escapeHtml(selected.engineType)}` : ' · no folder engine type'}</small>` : ''}
      </div>
      ${unusualDestination ? '<p class="admin-daw-picker-warning">This folder is not an engine folder. The instrument will keep its current engine type and appear directly inside this folder.</p>' : ''}
      <div class="admin-modal-actions">
        <button type="button" class="admin-secondary-button" data-admin-studio-picker-close>Cancel</button>
        <button type="button" class="admin-primary-button" data-admin-studio-picker-confirm ${selected && isAdminStudioPickerDestinationAllowed(selected, picker, library) ? '' : 'disabled'}>Confirm destination</button>
      </div>
    </section>
  </div>`
}

function renderAdminStudioLibraryTree(library = {}) {
  const studio = state.operations.studio
  const instruments = Array.isArray(library.instruments) ? library.instruments : []
  const folders = Array.isArray(library.folders) ? library.folders : []
  if (!folders.length) return '<article class="admin-empty-state">Default library folders have not been initialized.</article>'
  const selected = findFolderById(folders, studio.selectedFolderId) || folders[0]
  const selectedInstruments = selected ? getInstrumentsForFolder(library, selected.path) : []
  const selectedChildCount = selected?.children?.length || 0
  return `<div class="admin-studio-folder-manager">
    <div class="admin-studio-folder-tree" role="tree">${folders.map((root) => renderAdminStudioFolderNode(root, studio, instruments)).join('')}</div>
    <div class="admin-studio-folder-detail">
      ${selected ? `<form data-admin-studio-folder-edit>
        <header><div><span>Selected folder</span><div class="admin-daw-breadcrumb">${adminStudioFolderBreadcrumb(selected)}</div></div><span class="review-badge">${escapeHtml(selected.type)}</span></header>
        <input type="hidden" name="folderId" value="${escapeHtml(selected.id)}">
        <div class="admin-form-grid">
          <label><span>Label</span><input name="label" value="${escapeHtml(selected.label)}" required ${selected.type === 'source-root' ? 'readonly' : ''}></label>
          <label><span>Folder type</span><select name="type" ${selected.type === 'source-root' ? 'disabled' : ''}>${['source-root', 'category-folder', 'engine-folder', 'generic-folder'].map((type) => `<option value="${type}" ${selected.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select></label>
          <label><span>Engine type</span><select name="engineType" ${selected.type === 'engine-folder' ? '' : 'disabled'}>${STUDIO_LIBRARY_ENGINE_TYPES.map((engine) => `<option value="${engine.id}" ${selected.engineType === engine.id ? 'selected' : ''}>${escapeHtml(engine.label)}</option>`).join('')}</select></label>
          <div class="admin-studio-path-preview"><span>ID</span><strong>${escapeHtml(selected.id)}</strong><small>Sort order ${selected.sortOrder}</small></div>
        </div>
        <div class="admin-studio-folder-actions">
          <button type="submit" class="admin-primary-button">Save folder</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-folder-rename ${selected.type === 'source-root' ? 'disabled' : ''}>Rename folder</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-folder-add-open ${selected.type === 'engine-folder' ? 'disabled' : ''}>Add child folder</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-folder-move-open ${selected.type === 'source-root' ? 'disabled' : ''}>Move folder</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-folder-move="-1">Move up</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-folder-move="1">Move down</button>
          <button type="button" class="admin-danger-button" data-admin-studio-folder-delete ${selected.type === 'source-root' || selectedChildCount || selectedInstruments.length ? 'disabled title="Folders containing children or instruments cannot be deleted."' : ''}>Delete folder</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-use-destination>Use as instrument destination</button>
        </div>
      </form>
      ${studio.addFolderOpen && selected.type !== 'engine-folder' ? `<form data-admin-studio-folder-add class="admin-daw-add-folder-form">
        <header><div><span>Add child folder</span><strong>Inside ${escapeHtml(selected.label)}</strong></div></header>
        <input type="hidden" name="parentId" value="${escapeHtml(selected.id)}">
        <div class="admin-form-grid">
          <label><span>Label</span><input name="label" placeholder="Strings" required></label>
          <label><span>Folder type</span><select name="type"><option value="category-folder">category-folder</option><option value="engine-folder">engine-folder</option><option value="generic-folder">generic-folder</option></select></label>
          <label><span>Engine type</span><select name="engineType" disabled>${STUDIO_LIBRARY_ENGINE_TYPES.map((engine) => `<option value="${engine.id}">${escapeHtml(engine.label)}</option>`).join('')}</select></label>
        </div>
        <div class="admin-studio-folder-actions"><button type="submit" class="admin-primary-button">Create folder</button><button type="button" class="admin-secondary-button" data-admin-studio-folder-add-cancel>Cancel</button></div>
      </form>` : selected.type === 'engine-folder' ? '<div class="admin-studio-folder-terminal"><strong>Final engine folder</strong><p>Assign instruments here. Add sibling categories or engines from the parent folder.</p></div>' : ''}
      <section class="admin-studio-folder-instruments">
        <header><div><strong>Instruments in this exact folder</strong><small>${selectedChildCount} child folder${selectedChildCount === 1 ? '' : 's'}</small></div><span>${selectedInstruments.length}</span></header>
        ${studio.selectedInstrumentId && selectedInstruments.some((instrument) => instrument.id === studio.selectedInstrumentId) ? `<div class="admin-daw-selected-instrument-actions"><span>Selected instrument</span><button type="button" class="admin-secondary-button" data-admin-studio-instrument-move="${escapeHtml(studio.selectedInstrumentId)}">Move selected instrument</button></div>` : ''}
        ${selectedInstruments.length ? `<ul>${selectedInstruments.map((instrument) => `<li class="${studio.selectedInstrumentId === instrument.id ? 'is-selected' : ''}">
          <button type="button" class="admin-daw-instrument-select" data-admin-studio-instrument-select="${escapeHtml(instrument.id)}"><strong>${escapeHtml(instrument.name)}</strong><small>${escapeHtml(instrument.id)}</small></button>
          <div class="admin-daw-instrument-facts"><span>${escapeHtml(instrument.engineType)}</span><span>${escapeHtml(instrument.sampleStrategy || 'No strategy')}</span>${instrument.engineType === 'sample-based' ? `<span>${escapeHtml(samplePlaybackModeLabel(instrument.samplePlaybackMode))}</span>` : ''}<span>v${instrument.version || 1}</span><span class="${instrument.enabled === false ? 'is-disabled' : 'is-enabled'}">${instrument.enabled === false ? 'Disabled' : 'Enabled'}</span></div>
          <div class="admin-daw-instrument-actions">
            <button type="button" class="admin-secondary-button" data-studio-library-edit="${escapeHtml(instrument.id)}">Edit metadata</button>
            <button type="button" class="admin-secondary-button" data-admin-studio-instrument-move="${escapeHtml(instrument.id)}">Move instrument</button>
            <button type="button" class="admin-secondary-button" data-admin-studio-instrument-toggle="${escapeHtml(instrument.id)}">${instrument.enabled === false ? 'Enable' : 'Disable'}</button>
            <button type="button" class="admin-danger-button" data-admin-studio-instrument-remove="${escapeHtml(instrument.id)}">Remove reference</button>
          </div>
        </li>`).join('')}</ul>` : '<p class="admin-muted">This folder is empty.</p>'}
      </section>` : '<article class="admin-empty-state">Select a folder.</article>'}
    </div>
  </div>`
}

function operationsStudioPanel() {
  const studio = state.operations.studio
  const library = studio.library
  const form = studioInstrumentFormState()
  const flatFolders = flattenLibraryFolders(library?.folders || [])
  const destinationFolders = flatFolders.filter((folder) => folder.type === 'engine-folder')
  const selectedDestination = findFolderById(library?.folders || [], form.destinationFolderId)
    || findFolderByPath(library?.folders || [], form.folderPath)
    || destinationFolders[0]
  const folderPath = selectedDestination?.path || form.folderPath || ''
  const engineType = form.engineType || selectedDestination?.engineType || 'sample-based'
  const instrumentId = studioLibrarySlug(form.id || form.name)
  const version = Math.max(1, Math.round(Number(form.version) || 1))
  const basePath = `${STUDIO_LIBRARY_STORAGE_ROOT}/${folderPath}/${instrumentId || '{instrumentId}'}/v${version}`
  const editing = Boolean(studio.editingId)
  const isSampleBased = engineType === 'sample-based'
  const isVst = engineType === 'vst'
  const strategyWarnings = isSampleBased ? getSampleStrategyWarnings(form.sampleStrategy, studio.parsedSamples, form.samplePlaybackMode) : []
  return `
    ${studioOperationsSubnav()}
    <div class="admin-daw-library-manager">
    ${studio.error ? `<p class="admin-status is-error">${escapeHtml(studio.error)}</p>` : ''}
    ${studio.message ? `<p class="admin-status is-success">${escapeHtml(studio.message)}</p>` : ''}
    <section class="admin-section-slab admin-operations-panel admin-studio-library-overview">
      <div class="admin-slab-heading">
        <div>
          <h2>Default DAW Library</h2>
          <p class="admin-muted">Firestore manifest <code class="admin-code-value">/studioDawDefaults/libraryContent</code>. Audio remains in Firebase Storage.</p>
        </div>
        <div class="admin-daw-manager-toolbar">
          <button type="button" class="admin-secondary-button" data-admin-studio-add-folder>Add Folder</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-expand-all>Expand All</button>
          <button type="button" class="admin-secondary-button" data-admin-studio-collapse-all>Collapse All</button>
          <button type="button" class="admin-primary-button" data-studio-library-initialize ${studio.initializing ? 'disabled' : ''}>${studio.initializing ? 'Initializing...' : 'Initialize / Repair'}</button>
        </div>
      </div>
      ${studio.loading ? '<article class="admin-empty-state">Loading DAW library...</article>' : renderAdminStudioLibraryTree(library || {})}
    </section>
    <section class="admin-section-slab admin-operations-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>${editing ? `Edit ${escapeHtml(form.name || studio.editingId)}` : 'Add Default Instrument'}</h2>
          <p class="admin-muted">${editing ? 'Update instrument metadata or replace its engine source.' : 'Create a versioned instrument manifest and upload only the source required by its engine.'}</p>
        </div>
        ${editing ? '<button type="button" class="admin-secondary-button" data-studio-library-edit-cancel>Cancel edit</button>' : ''}
      </div>
      <form class="admin-studio-library-form" data-studio-library-form>
        <div class="admin-form-grid">
          ${operationTextInput({ name: 'name', label: 'Instrument name', value: form.name, required: true })}
          <label><span>Instrument ID / slug</span><input name="id" value="${escapeHtml(form.id)}" required ${editing ? 'readonly' : ''}><small>${editing ? 'Instrument IDs stay stable after creation.' : 'Lowercase letters, numbers, and hyphens.'}</small></label>
          <div class="admin-daw-destination-field is-wide"><span>Destination folder</span><input type="hidden" name="destinationFolderId" value="${escapeHtml(selectedDestination?.id || '')}" required><button type="button" class="admin-daw-destination-picker" data-admin-studio-form-destination><strong>${escapeHtml(folderPath || 'Choose a library folder')}</strong><small>${escapeHtml(selectedDestination ? `${selectedDestination.type}${selectedDestination.engineType ? ` · ${selectedDestination.engineType}` : ''}` : 'Select destination')}</small></button><small>Engine folders are recommended, but any valid library folder can contain instruments.</small></div>
          <label><span>Engine type</span><select name="engineType">${STUDIO_LIBRARY_ENGINE_TYPES.map((engine) => `<option value="${engine.id}" ${engineType === engine.id ? 'selected' : ''}>${escapeHtml(engine.label)}</option>`).join('')}</select><small>The instrument keeps this engine type regardless of its folder.</small></label>
          ${isSampleBased ? `<label><span>Sample strategy</span><select name="sampleStrategy">${STUDIO_SAMPLE_STRATEGIES.map((strategy) => `<option value="${strategy.id}" ${form.sampleStrategy === strategy.id ? 'selected' : ''}>${escapeHtml(strategy.label)}</option>`).join('')}</select><small>${escapeHtml(STUDIO_SAMPLE_STRATEGIES.find((strategy) => strategy.id === form.sampleStrategy)?.description || 'Arbitrary valid note + octave WAV roots')}</small></label>` : ''}
          ${isSampleBased ? `<label><span>Sample playback mode</span><select name="samplePlaybackMode"><option value="pitch-modified" ${form.samplePlaybackMode !== 'exact-position' ? 'selected' : ''}>Pitch Modified Samples</option><option value="exact-position" ${form.samplePlaybackMode === 'exact-position' ? 'selected' : ''}>Exact Position Samples</option></select><small>Pitch Modified uses the nearest available sample and pitch-shifts it. Exact Position only plays samples on their exact mapped notes.</small></label>` : ''}
          ${operationTextInput({ name: 'version', label: 'Version', type: 'number', value: version, required: true })}
          ${operationTextarea({ name: 'description', label: 'Description', value: form.description, rows: 4, wide: true })}
          <div class="admin-studio-path-preview is-wide"><span>Folder path</span><strong data-studio-folder-preview>${escapeHtml(folderPath)}</strong><small data-studio-storage-preview>${escapeHtml(basePath)}</small></div>
          <label><span>License type</span><select name="licenseType">${['owned', 'CC0', 'CC BY', 'custom'].map((value) => `<option value="${value}" ${form.licenseType === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label>
          ${operationTextInput({ name: 'sourceName', label: 'Source name', value: form.sourceName })}
          ${operationTextInput({ name: 'sourceUrl', label: 'Source URL', type: 'url', value: form.sourceUrl, wide: true })}
          ${operationTextInput({ name: 'licenseUrl', label: 'License URL', type: 'url', value: form.licenseUrl, wide: true })}
          ${operationCheckbox({ name: 'attributionRequired', label: 'Attribution required', checked: form.attributionRequired })}
          ${operationCheckbox({ name: 'commercialAllowed', label: 'Commercial use allowed', checked: form.commercialAllowed !== false })}
          ${operationCheckbox({ name: 'enabled', label: 'Instrument enabled', checked: form.enabled !== false })}
          <label><span>Visibility</span><select name="visibility"><option value="public" ${form.visibility !== 'private' ? 'selected' : ''}>Public</option><option value="private" ${form.visibility === 'private' ? 'selected' : ''}>Private</option></select></label>
          ${isSampleBased ? `<label class="is-wide admin-daw-file-field"><span>Audio ZIP</span><input type="file" name="audioZip" accept=".zip,application/zip,application/x-zip-compressed" ${studio.parsing || studio.saving ? 'disabled' : ''}><small>WAV roots use note + octave names such as C-1.wav, F#3.wav, Fs3.wav, or Bb4.wav. Strategy mismatches warn but do not block valid mappings.</small></label>` : ''}
          ${isVst ? `<label class="is-wide admin-daw-file-field"><span>HTML-based VST source</span><input type="file" name="htmlSource" accept=".html,text/html" ${studio.saving ? 'disabled' : ''}><small>Upload the HTML entry point for a future sandboxed web instrument that accepts MIDI and outputs audio. Source is stored only; runtime execution is coming soon.</small>${form.htmlSourcePath ? `<strong class="admin-studio-existing-source">${escapeHtml(form.htmlSourcePath)}</strong>` : ''}</label>` : ''}
          ${engineType === 'wavetable' ? '<div class="admin-studio-runtime-note is-wide"><strong>Wavetable runtime coming soon</strong><p>Save metadata now. Wavetable source and playback fields will be added with the dedicated runtime.</p></div>' : ''}
          <label class="is-wide admin-daw-file-field"><span>Artwork (optional WebP)</span><input type="file" name="artwork" accept="image/webp" ${studio.saving ? 'disabled' : ''}><small>Stored as artwork/cover.webp.</small></label>
          ${operationCheckbox({ name: 'overwrite', label: 'Replace an existing instrument with this ID', checked: editing || form.overwrite })}
        </div>
        ${isSampleBased ? `<section class="admin-studio-sample-preview">
          <header><div><strong>Parsed samples</strong><span>${studio.parsing ? 'Reading ZIP...' : `${studio.parsedSamples.length} valid WAV file${studio.parsedSamples.length === 1 ? '' : 's'}`}</span></div>${studio.zipFile ? `<small>${escapeHtml(studio.zipFile.name)}</small>` : ''}</header>
          ${strategyWarnings.length ? `<div class="admin-studio-strategy-warnings">${strategyWarnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join('')}</div>` : ''}
          ${studio.parsedSamples.length ? `<div>${studio.parsedSamples.slice(0, 36).map((sample) => `<span><strong>${escapeHtml(sample.note)}</strong><small>${escapeHtml(sample.fileName)} · MIDI ${sample.rootMidi}</small></span>`).join('')}</div>${studio.parsedSamples.length > 36 ? `<p class="admin-muted">Showing 36 of ${studio.parsedSamples.length} samples.</p>` : ''}` : '<p class="admin-muted">Choose a ZIP to validate its sample map before saving.</p>'}
        </section>` : isVst ? `<section class="admin-studio-runtime-note"><strong>HTML audio/MIDI runtime</strong><p>${studio.htmlSourceFile ? `${escapeHtml(studio.htmlSourceFile.name)} is ready to upload as plugin.html.` : 'No new HTML source selected.'} The DAW will show this instrument as coming soon and will not execute its source.</p></section>` : ''}
        ${studio.saving ? `<div class="admin-studio-upload-progress"><span style="width:${Math.round(studio.progress * 100)}%"></span><strong>${Math.round(studio.progress * 100)}%</strong></div>` : ''}
        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${studio.saving || studio.parsing ? 'disabled' : ''}>${studio.saving ? 'Uploading...' : editing ? 'Update Instrument' : 'Add Instrument'}</button>
        </div>
      </form>
    </section>
    ${renderAdminStudioFolderPicker(library || {})}
    </div>
  `
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
      ${resonaStatsCard()}
    </section>
    ${emailConfigurationCard()}
    ${settingsDialog()}
  `
}

function emailConfigurationCard() {
  const status = state.settings.emailStatus || state.contact.emailStatus || {}
  return `
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <div>
          <h2>Email Configuration</h2>
          <p class="admin-muted">SMTP status and sender settings. Compose messages in Contact.</p>
        </div>
        <a class="admin-secondary-link" href="${ROUTES.adminContact}?mode=email">Open Contact Center</a>
      </div>
      <dl class="admin-field-grid is-compact">
        ${renderField('Sender address', status.senderAddress || 'support@melogicrecords.studio')}
        ${renderField('Provider', status.provider || 'smtp')}
        ${renderBooleanField('Provider configured', status.providerConfigured)}
        ${renderBooleanField('Security notifications', status.securityNotificationsEnabled)}
      </dl>
    </section>
  `
}

function contactMode() {
  const params = new URLSearchParams(window.location.search)
  const mode = String(params.get('mode') || 'email').toLowerCase()
  return ['email', 'system', 'support', 'text', 'call'].includes(mode) ? mode : 'email'
}

function contactModeTabs(mode = contactMode()) {
  const tabs = [
    ['email', 'Email'],
    ['system', 'System Message'],
    ['support', 'Support Queue'],
    ['text', 'Text'],
    ['call', 'Calls']
  ]
  return `
    <nav class="admin-contact-tabs" aria-label="Contact modes">
      ${tabs.map(([key, label]) => `<a href="${ROUTES.adminContact}?mode=${key}" class="${mode === key ? 'is-active' : ''}">${escapeHtml(label)}${key === 'text' ? '<span>Coming soon</span>' : ''}</a>`).join('')}
    </nav>
  `
}

function contactSummaryCards() {
  const status = state.contact.emailStatus || {}
  const sentCount = (status.recent || []).filter((row) => row.status === 'sent').length
  const failedCount = Number(status.recentFailureCount || (status.failures || []).length || 0)
  return `
    <section class="admin-metric-grid is-compact">
      <article class="admin-metric"><span>Email provider</span><strong>${escapeHtml(status.providerConfigured ? 'Ready' : 'Check')}</strong></article>
      <article class="admin-metric"><span>Recent sent</span><strong>${sentCount}</strong></article>
      <article class="admin-metric"><span>Failed messages</span><strong>${failedCount}</strong></article>
      <article class="admin-metric"><span>System messages</span><strong>${escapeHtml(state.contact.systemMessage.startsWith('Sent') ? 'Sent' : 'Ready')}</strong></article>
    </section>
  `
}

function contactView() {
  if (!can('emailSend')) return permissionState('emailSend')
  const mode = contactMode()
  return `
    ${adminPageHeader({
      eyebrow: 'Communications',
      title: 'Contact',
      description: 'Send support, account, and platform messages from Melogic Records.',
      refreshLabel: 'Refresh contact'
    })}
    ${state.contact.error ? `<p class="admin-status is-error">${escapeHtml(state.contact.error)}</p>` : ''}
    ${contactSummaryCards()}
    ${contactModeTabs(mode)}
    ${mode === 'email' ? emailSettingsPanel() : ''}
    ${mode === 'system' ? systemMessagePanel() : ''}
    ${mode === 'support' ? contactSupportFormsPanel() : ''}
    ${mode === 'text' ? contactComingSoonPanel('Text', 'SMS support messaging is planned for a later phase. This will require a compliant SMS provider and opt-in rules.') : ''}
    ${mode === 'call' ? contactCallPanel() : ''}
  `
}

function contactSupportFormsPanel() {
  const formsState = state.contact.supportForms || {}
  const forms = formsState.items || []
  const selected = selectedSupportForm()

  return `
    ${contactSupportThreadsPanel()}
    <section class="admin-contact-grid">
      <section class="admin-section-slab admin-fixed-panel">
        <div class="admin-slab-heading">
          <div>
            <h2>Support Forms</h2>
            <p class="admin-muted">Native public support requests submitted from the Support page.</p>
          </div>
          <button type="button" class="admin-secondary-button" data-support-forms-refresh>
            Refresh
          </button>
        </div>

        <div class="admin-contact-tabs is-subtabs" aria-label="Support form filters">
          ${[
            ['unresolved', 'Unresolved'],
            ['resolved', 'Resolved'],
            ['archived', 'Archived'],
            ['all', 'All']
          ].map(([key, label]) => `
            <button type="button" class="${formsState.filter === key ? 'is-active' : ''}" data-support-form-filter="${key}">
              ${escapeHtml(label)}
            </button>
          `).join('')}
        </div>

        ${formsState.error ? `<p class="admin-status is-error">${escapeHtml(formsState.error)}</p>` : ''}

        <div class="admin-panel-scroll">
          ${formsState.loading ? '<article class="admin-empty-state">Loading support forms...</article>' : ''}
          ${!formsState.loading && !forms.length ? `
            <article class="admin-empty-state">
              <strong>No support forms yet</strong>
              <span>Public support form submissions will appear here.</span>
            </article>
          ` : ''}
          ${forms.map((form) => supportFormListCard(form)).join('')}
          ${formsState.hasMore ? `<div class="admin-load-more-row"><button type="button" class="admin-secondary-button" data-support-forms-load-more ${formsState.loadingMore ? 'disabled' : ''}>${formsState.loadingMore ? 'Loading older...' : 'Load older'}</button></div>` : ''}
        </div>
      </section>

      <section class="admin-section-slab admin-fixed-panel">
        <div class="admin-slab-heading">
          <div>
            <h2>Selected Request</h2>
            <p class="admin-muted">Review the support request and track internal handling.</p>
          </div>
        </div>

        ${selected ? supportFormDetail(selected) : `
          <article class="admin-empty-state">
            <strong>No request selected</strong>
            <span>Select a support form to review it.</span>
          </article>
        `}
      </section>
    </section>
  `
}

function contactSupportThreadsPanel() {
  const threadsState = state.contact.supportThreads || {}
  const threads = threadsState.items || []
  const selected = selectedSupportThread()

  return `
    <section class="admin-contact-grid admin-support-live-grid">
      <section class="admin-section-slab admin-fixed-panel">
        <div class="admin-slab-heading">
          <div>
            <h2>Live Support Queue</h2>
            <p class="admin-muted">Real support chats opened from Inbox and the Support page.</p>
          </div>
          <button type="button" class="admin-secondary-button" data-support-threads-refresh>
            Refresh
          </button>
        </div>

        <div class="admin-contact-tabs is-subtabs" aria-label="Support thread filters">
          ${[
            ['active', 'Active'],
            ['ai_active', 'AI Active'],
            ['waiting_for_agent', 'Waiting'],
            ['assigned', 'Assigned'],
            ['resolved', 'Resolved'],
            ['all', 'All']
          ].map(([key, label]) => `
            <button type="button" class="${threadsState.filter === key ? 'is-active' : ''}" data-support-thread-filter="${key}">
              ${escapeHtml(label)}
            </button>
          `).join('')}
        </div>

        ${threadsState.error ? `<p class="admin-status is-error">${escapeHtml(threadsState.error)}</p>` : ''}
        ${threadsState.message ? `<p class="admin-status is-success">${escapeHtml(threadsState.message)}</p>` : ''}

        <div class="admin-panel-scroll">
          ${threadsState.loading ? '<article class="admin-empty-state">Loading support threads...</article>' : ''}
          ${!threadsState.loading && !threads.length ? `
            <article class="admin-empty-state">
              <strong>No live support threads</strong>
              <span>New chat requests will appear here.</span>
            </article>
          ` : ''}
          ${threads.map((thread) => supportThreadListCard(thread)).join('')}
        </div>
      </section>

      <section class="admin-section-slab admin-fixed-panel">
        <div class="admin-slab-heading">
          <div>
            <h2>Selected Chat</h2>
            <p class="admin-muted">Claim, reply, and resolve live support conversations.</p>
          </div>
        </div>

        ${selected ? supportThreadDetail(selected) : `
          <article class="admin-empty-state">
            <strong>No chat selected</strong>
            <span>Select a live support thread to review it.</span>
          </article>
        `}
      </section>
    </section>
  `
}

function selectedSupportThread() {
  const selectedId = state.contact.supportThreads.selectedId
  return (state.contact.supportThreads.items || []).find((item) => item.id === selectedId)
    || state.contact.supportThreads.items?.[0]
    || null
}

function supportThreadRequesterLabel(thread = {}) {
  const requester = thread.requester || {}
  return requester.displayName || requester.username || requester.email || thread.requesterUid || 'Melogic user'
}

function supportThreadListCard(thread = {}) {
  const selected = state.contact.supportThreads.selectedId === thread.id
  const status = thread.status || 'open'
  const preview = thread.lastMessagePreview || 'No messages yet.'
  return `
    <button type="button" class="admin-list-card admin-support-form-card admin-support-thread-card ${selected ? 'is-selected' : ''}" data-support-thread-select="${escapeHtml(thread.id)}">
      <span class="admin-support-form-avatar" aria-hidden="true">${escapeHtml(supportThreadRequesterLabel(thread).slice(0, 1).toUpperCase())}</span>
      <span class="admin-support-form-card-main">
        <span class="admin-support-form-card-top">
          <strong>${escapeHtml(thread.subject || 'Support chat')}</strong>
          <span class="admin-pill status-${statusClass(status)}">${escapeHtml(humanLabel(status))}</span>
        </span>
        <small>${escapeHtml(supportThreadRequesterLabel(thread))}</small>
        ${thread.aiEscalationReason ? `<small>Escalation: ${escapeHtml(humanLabel(thread.aiEscalationReason))}</small>` : ''}
        <span class="admin-support-form-preview">${escapeHtml(preview)}</span>
        <span class="admin-support-form-time">${escapeHtml(thread.updatedAt ? formatDate(thread.updatedAt) : 'Not dated')}</span>
      </span>
    </button>
  `
}

function supportThreadDetail(thread = {}) {
  const threadsState = state.contact.supportThreads
  const saving = threadsState.savingId === thread.id
  const messages = threadsState.selectedId === thread.id ? threadsState.messages || [] : []
  const requester = thread.requester || {}
  const assigned = thread.assignedAgent || {}
  const resolved = thread.status === 'resolved'
  return `
    <article class="admin-detail-card admin-support-form-detail admin-support-thread-detail">
      <div class="admin-detail-header">
        <div>
          <p class="eyebrow">Live Support</p>
          <h3>${escapeHtml(thread.subject || 'Support chat')}</h3>
          <p class="admin-code-value">${escapeHtml(thread.id)}</p>
        </div>
        <span class="admin-pill status-${statusClass(thread.status)}">${escapeHtml(humanLabel(thread.status || 'open'))}</span>
      </div>

      <dl class="admin-field-grid admin-support-form-fields">
        <div class="admin-field"><dt>Requester</dt><dd>${escapeHtml(supportThreadRequesterLabel(thread))}</dd></div>
        <div class="admin-field"><dt>Email</dt><dd>${requester.email ? `<a href="mailto:${escapeHtml(requester.email)}">${escapeHtml(requester.email)}</a>` : '<span class="admin-muted">Not provided</span>'}</dd></div>
        <div class="admin-field"><dt>Assigned agent</dt><dd>${escapeHtml(assigned.displayName || assigned.username || thread.assignedAgentUid || 'Unassigned')}</dd></div>
        <div class="admin-field"><dt>AI escalation</dt><dd>${thread.aiEscalationReason ? escapeHtml(humanLabel(thread.aiEscalationReason)) : '<span class="admin-muted">None</span>'}</dd></div>
        <div class="admin-field"><dt>Updated</dt><dd>${escapeHtml(thread.updatedAt ? formatDate(thread.updatedAt) : 'Not set')}</dd></div>
      </dl>

      <div class="admin-support-thread-messages">
        ${threadsState.messagesLoading ? '<article class="admin-empty-state">Loading messages...</article>' : ''}
        ${!threadsState.messagesLoading && !messages.length ? '<article class="admin-empty-state">No messages yet.</article>' : ''}
        ${messages.map((message) => supportThreadMessageBubble(message)).join('')}
      </div>

      <form class="admin-support-thread-reply" data-support-thread-reply="${escapeHtml(thread.id)}">
        <label class="admin-field">
          <span>Reply as Melogic Support</span>
          <textarea rows="4" maxlength="1200" data-support-thread-reply-body ${resolved || saving ? 'disabled' : ''}>${escapeHtml(threadsState.replyDraft || '')}</textarea>
        </label>
        <div class="admin-support-form-actions">
          <button type="button" class="admin-secondary-button" data-support-thread-claim="${escapeHtml(thread.id)}" ${saving || resolved ? 'disabled' : ''}>
            ${thread.assignedAgentUid ? 'Reclaim' : 'Claim'}
          </button>
          <button type="submit" class="admin-primary-button" ${saving || resolved || !threadsState.replyDraft.trim() ? 'disabled' : ''}>
            ${saving ? 'Working...' : 'Send Reply'}
          </button>
          <button type="button" class="admin-secondary-button admin-support-resolve-button" data-support-thread-resolve="${escapeHtml(thread.id)}" ${saving || resolved ? 'disabled' : ''}>
            Resolve
          </button>
        </div>
      </form>
    </article>
  `
}

function supportThreadMessageBubble(message = {}) {
  const type = message.senderType || 'system'
  const label = type === 'agent'
    ? 'Melogic Support'
    : type === 'user'
      ? 'Requester'
      : type === 'ai'
        ? 'Melogic AI Support'
        : 'System'
  return `
    <div class="admin-support-thread-message is-${escapeHtml(type)}">
      <strong>${escapeHtml(label)}${type === 'ai' ? '<span class="admin-ai-label">AI</span>' : ''}</strong>
      <p>${escapeHtml(message.body || '')}</p>
      <small>${escapeHtml(message.createdAt ? formatDate(message.createdAt) : 'Not dated')}</small>
    </div>
  `
}

function supportFormSender(form = {}) {
  return [form.name || 'Unknown sender', form.email || 'No email'].filter(Boolean).join(' · ')
}

function supportFormPreview(form = {}, maxLength = 120) {
  const value = String(form.message || '').replace(/\s+/g, ' ').trim()
  if (!value) return 'No message preview.'
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value
}

function supportFormInitial(form = {}) {
  return String(form.name || form.email || 'S').slice(0, 1).toUpperCase()
}

function supportFormListCard(form = {}) {
  const selected = state.contact.supportForms.selectedId === form.id
  const status = form.status || 'new'

  return `
    <button type="button" class="admin-list-card admin-support-form-card ${selected ? 'is-selected' : ''}" data-support-form-select="${escapeHtml(form.id)}">
      <span class="admin-support-form-avatar" aria-hidden="true">${escapeHtml(supportFormInitial(form))}</span>
      <span class="admin-support-form-card-main">
        <span class="admin-support-form-card-top">
          <strong>${escapeHtml(form.subject || 'Untitled request')}</strong>
          <span class="admin-pill status-${statusClass(status)}">${humanLabel(status)}</span>
        </span>
        <small>${escapeHtml(supportFormSender(form))}</small>
        <span class="admin-support-form-preview">${escapeHtml(supportFormPreview(form))}</span>
        <span class="admin-support-form-time">${escapeHtml(form.createdAt ? formatDate(form.createdAt) : 'Not dated')}</span>
      </span>
    </button>
  `
}

function supportFormDetail(form = {}) {
  const saving = state.contact.supportForms.savingId === form.id
  const safeEmail = form.email || ''
  const mailtoHref = safeEmail
    ? `mailto:${encodeURIComponent(safeEmail)}?subject=${encodeURIComponent(`Re: ${form.subject || 'Melogic Support Request'}`)}`
    : 'mailto:support@melogicrecords.studio'

  return `
    <article class="admin-detail-card admin-support-form-detail">
      <div class="admin-detail-header">
        <div>
          <p class="eyebrow">Support Request</p>
          <h3>${escapeHtml(form.subject || 'Untitled request')}</h3>
        </div>
        <span class="admin-pill status-${statusClass(form.status)}">${humanLabel(form.status)}</span>
      </div>

      <dl class="admin-field-grid admin-support-form-fields">
        <div class="admin-field"><dt>Name</dt><dd>${escapeHtml(form.name || 'Not provided')}</dd></div>
        <div class="admin-field"><dt>Email</dt><dd>${safeEmail ? `<a href="mailto:${escapeHtml(safeEmail)}">${escapeHtml(safeEmail)}</a>` : '<span class="admin-muted">Not provided</span>'}</dd></div>
        <div class="admin-field"><dt>Username</dt><dd>${escapeHtml(form.username || 'Not provided')}</dd></div>
        <div class="admin-field"><dt>Created</dt><dd>${escapeHtml(form.createdAt ? formatDate(form.createdAt) : 'Not set')}</dd></div>
        <div class="admin-field"><dt>Source</dt><dd>${escapeHtml(humanLabel(form.source || 'support_page'))}</dd></div>
      </dl>

      <div class="admin-message-preview admin-support-form-message">
        <h4>Message</h4>
        <p>${escapeHtml(form.message || 'No message provided.')}</p>
      </div>

      <label class="admin-field">
        <span>Admin note</span>
        <textarea rows="5" data-support-form-note="${escapeHtml(form.id)}">${escapeHtml(form.adminNote || '')}</textarea>
      </label>

      <div class="admin-support-form-actions">
        <button type="button" class="admin-secondary-button" data-support-form-status="${escapeHtml(form.id)}" data-status-value="reviewing" ${saving ? 'disabled' : ''}>
          Mark Reviewing
        </button>
        <button type="button" class="admin-secondary-button" data-support-form-save-note="${escapeHtml(form.id)}" ${saving ? 'disabled' : ''}>
          ${saving ? 'Saving...' : 'Save Note'}
        </button>
        <a class="admin-secondary-button" href="${escapeHtml(mailtoHref)}">
          Reply by Email
        </a>
        <button type="button" class="admin-primary-button admin-support-resolve-button" data-support-form-status="${escapeHtml(form.id)}" data-status-value="resolved" ${saving ? 'disabled' : ''}>
          Resolve
        </button>
      </div>
    </article>
  `
}

function contactCallPanel() {
  const call = state.contact.call || {}
  const connected = call.status === 'connected'
  const connecting = call.status === 'connecting'
  const active = connected || connecting

  return `
    <section class="admin-section-slab admin-email-settings">
      <div class="admin-slab-heading">
        <div>
          <h2>Calls</h2>
          <p class="admin-muted">Join the LiveKit phone support room and answer inbound callers from the admin console.</p>
        </div>
        <span class="review-badge ${connected ? 'is-approved' : connecting ? 'is-warning' : ''}">
          ${escapeHtml(connected ? 'Connected' : connecting ? 'Connecting' : 'Ready')}
        </span>
      </div>

      <dl class="admin-field-grid is-compact">
        ${renderField('Support room', call.roomName || 'melogic-phone-test')}
        ${renderField('Status', humanLabel(call.status || 'idle'))}
        ${renderField('Participants', String(Number(call.participants || 0)))}
        ${renderField('Local identity', call.localIdentity || 'Not connected')}
        ${renderField('Mic', call.muted ? 'Muted' : connected ? 'Live' : 'Not connected')}
      </dl>

      ${call.error ? `<p class="admin-status is-error">${escapeHtml(call.error)}</p>` : ''}
      ${call.message ? `<p class="admin-status is-success">${escapeHtml(call.message)}</p>` : ''}

      <form class="admin-email-form" data-admin-call-form>
        <label>
          <span>Room name</span>
          <input data-admin-call-room value="${escapeHtml(call.roomName || 'melogic-phone-test')}" ${active ? 'disabled' : ''} />
        </label>

        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${active ? 'disabled' : ''}>
            ${connecting ? 'Joining...' : connected ? 'Connected' : 'Join Phone Room'}
          </button>
          <button type="button" class="admin-secondary-button" data-admin-call-mute ${connected ? '' : 'disabled'}>
            ${call.muted ? 'Unmute Mic' : 'Mute Mic'}
          </button>
          <button type="button" class="admin-secondary-button" data-admin-call-leave ${active ? '' : 'disabled'}>
            Leave Room
          </button>
        </div>
      </form>

      <section class="admin-section-slab admin-fixed-panel is-short">
        <div class="admin-slab-heading">
          <h2>Call monitor</h2>
          <span class="admin-muted">${connected ? 'Listening for phone caller' : 'Join before calling the number'}</span>
        </div>
        <div class="admin-panel-scroll">
          ${call.remoteParticipants?.length
            ? call.remoteParticipants.map((participant) => `
              <article class="admin-empty-state">
                <strong>${escapeHtml(participant.identity || 'Caller')}</strong>
                <span>${escapeHtml(participant.kind || 'remote participant')}</span>
              </article>
            `).join('')
            : `<article class="admin-empty-state">
                <strong>${connected ? 'Waiting for caller' : 'Not connected'}</strong>
                <span>${connected ? 'Call +1 484 964 9886 to test inbound routing.' : 'Join the room first, then dial the LiveKit number.'}</span>
              </article>`}
        </div>
      </section>

      ${activeSupportCallsPanel()}

    </section>
  `
}

function activeSupportCallsPanel() {
  const call = state.contact.call || {}
  const activeCalls = call.activeCalls || []

  return `
    <section class="admin-section-slab admin-fixed-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>Active Calls</h2>
          <p class="admin-muted">Live support call records from Firestore. Webhooks will feed this automatically later.</p>
        </div>
        <div class="admin-modal-actions">
          <button type="button" class="admin-secondary-button" data-admin-call-watch>
            ${call.activeCallsLoaded ? 'Refresh Watch' : 'Watch Active Calls'}
          </button>
          <button type="button" class="admin-secondary-button" data-admin-call-create-manual ${call.manualCallCreating ? 'disabled' : ''}>
            ${call.manualCallCreating ? 'Creating...' : 'Create Manual Test Call'}
          </button>
        </div>
      </div>

      ${call.activeCallsError ? `<p class="admin-status is-error">${escapeHtml(call.activeCallsError)}</p>` : ''}

      <div class="admin-panel-scroll">
        ${call.activeCallsLoading ? '<article class="admin-empty-state">Loading active calls...</article>' : ''}
        ${!call.activeCallsLoading && !activeCalls.length ? `
          <article class="admin-empty-state">
            <strong>No active calls yet</strong>
            <span>Create a manual test call now. Later, LiveKit webhooks will populate this automatically.</span>
          </article>
        ` : ''}
        ${activeCalls.map((supportCall) => activeSupportCallCard(supportCall)).join('')}
      </div>
    </section>
  `
}

function activeSupportCallCard(supportCall = {}) {
  const selected = state.contact.call.selectedCallId === supportCall.id
  const handlerLabel = supportCall.handledBy === 'ai'
    ? 'AI Assistant'
    : supportCall.handledBy === 'human'
      ? 'Human'
      : 'Unassigned'

  return `
    <article class="admin-empty-state ${selected ? 'is-selected' : ''}">
      <strong>${escapeHtml(supportCall.callerNumberMasked || 'Unknown caller')}</strong>
      <span>${escapeHtml(supportCall.roomName || 'No room assigned')}</span>
      <dl class="admin-field-grid is-compact">
        ${renderField('Status', humanLabel(supportCall.status || 'active'))}
        ${renderField('Direction', humanLabel(supportCall.direction || 'inbound'))}
        ${renderField('Handler', handlerLabel)}
        ${renderField('AI enabled', supportCall.aiEnabled ? 'Yes' : 'No')}
        ${renderField('Human joined', supportCall.humanJoined ? 'Yes' : 'No')}
        ${renderField('Started', supportCall.startedAt ? formatDate(supportCall.startedAt) : 'Not set')}
      </dl>
      <div class="admin-modal-actions">
        <button type="button" class="admin-primary-button" data-admin-call-join="${escapeHtml(supportCall.id)}">
          Join Call
        </button>
        <button type="button" class="admin-secondary-button" data-admin-call-force="${escapeHtml(supportCall.id)}">
          Force Connect
        </button>
        <button type="button" class="admin-secondary-button" data-admin-call-end="${escapeHtml(supportCall.id)}">
          Mark Ended
        </button>
      </div>
    </article>
  `
}

function toolsView() {
  if (!canLoadAdminSection('tools')) return permissionState('admin')
  return `
    ${adminPageHeader({
      eyebrow: 'Admin',
      title: 'Tools',
      description: 'Vital support, security, communication, and maintenance entry points. State-changing tools require verified email and 2FA.',
      refreshLabel: 'Refresh tools'
    })}
    <section class="admin-hub-grid">
      <article class="admin-section-slab admin-fixed-panel is-short">
        <div class="admin-slab-heading"><h2>User Tools</h2><span class="review-badge is-warning">2FA gated</span></div>
        <div class="admin-panel-scroll admin-tool-list">
          <a class="admin-secondary-link" href="${ROUTES.adminUsers}">Find user by email, username, or UID</a>
          <a class="admin-secondary-link" href="${ROUTES.adminContact}?mode=email">Email user</a>
          <a class="admin-secondary-link" href="${ROUTES.adminContact}?mode=system">Send system message</a>
          <p class="admin-muted">Open an Account Hub for password tools, suspension tools, recovery-code status, and admin notes.</p>
        </div>
      </article>
      <article class="admin-section-slab admin-fixed-panel is-short">
        <div class="admin-slab-heading"><h2>Product Tools</h2><span class="review-badge">Audits</span></div>
        <div class="admin-panel-scroll admin-tool-list">
          <a class="admin-secondary-link" href="${ROUTES.adminProducts}">Find product by title, ID, or creator</a>
          <a class="admin-secondary-link" href="${ROUTES.adminReviews}">Open marketplace review queue</a>
          <p class="admin-muted">Review decisions and moderation writes require verified email and 2FA.</p>
        </div>
      </article>
      <article class="admin-section-slab admin-fixed-panel is-short">
        <div class="admin-slab-heading"><h2>Communication Tools</h2><span class="review-badge">Contact</span></div>
        <div class="admin-panel-scroll admin-tool-list">
          <a class="admin-secondary-link" href="${ROUTES.adminContact}?mode=email">Email templates and activity</a>
          <a class="admin-secondary-link" href="${ROUTES.adminContact}?mode=system">System message templates</a>
          <a class="admin-secondary-link" href="${ROUTES.adminContact}?mode=email&activity=failed">Recent failed contact attempts</a>
        </div>
      </article>
      <article class="admin-section-slab admin-fixed-panel is-short">
        <div class="admin-slab-heading"><h2>Security Tools</h2><span class="review-badge is-approved">Read only</span></div>
        <div class="admin-panel-scroll admin-tool-list">
          <a class="admin-secondary-link" href="${ROUTES.adminLogs}">Recent admin actions</a>
          <a class="admin-secondary-link" href="${ROUTES.adminTeam}">Admin role audit</a>
          <p class="admin-muted">Admins without verified email or 2FA will be blocked by backend gates from write actions.</p>
        </div>
      </article>
      <article class="admin-section-slab admin-fixed-panel is-short">
        <div class="admin-slab-heading"><h2>Maintenance Tools</h2><span class="review-badge is-warning">Planned</span></div>
        <div class="admin-panel-scroll">
          <article class="admin-empty-state">Maintenance repair tools will use dry-run previews, confirmation phrases, and admin logs before rewriting data.</article>
        </div>
      </article>
    </section>
  `
}

function emailSettingsPanel() {
  const status = state.contact.emailStatus || {}
  const form = state.contact.emailForm || {}
  const canSend = can('emailSend')
  return `
    <section class="admin-section-slab admin-email-settings">
      <div class="admin-slab-heading">
        <div>
          <h2>Email</h2>
          <p class="admin-muted">Sender architecture for support, auth, security, and admin messages.</p>
        </div>
        <span class="review-badge ${status.providerConfigured ? 'is-approved' : 'is-warning'}">${status.providerConfigured ? 'Configured' : 'Secrets Required'}</span>
      </div>
      <dl class="admin-field-grid is-compact">
        ${renderField('Sender address', status.senderAddress || 'support@melogicrecords.studio')}
        ${renderField('Provider', status.provider || 'smtp')}
        ${renderBooleanField('Provider configured', status.providerConfigured)}
        ${renderBooleanField('Password reset custom sender', status.passwordResetCustomSenderEnabled)}
        ${renderBooleanField('Verification custom sender', status.verificationCustomSenderEnabled)}
        ${renderBooleanField('Security notifications', status.securityNotificationsEnabled)}
        ${renderDateField('Last success', status.lastSuccessAt)}
        ${renderDateField('Last failure', status.lastFailureAt)}
        ${renderField('Recent failures', String(Number(status.recentFailureCount || 0)))}
      </dl>
      ${canSend ? '' : '<article class="admin-empty-state">Not authorized. The emailSend permission is required to send support emails.</article>'}
      <form class="admin-email-form" data-admin-email-form>
        <div class="admin-form-grid">
          <label><span>Recipient email</span><input data-admin-email-field="to" type="email" value="${escapeHtml(form.to)}" ${canSend ? '' : 'disabled'} /></label>
          <label><span>CC emails</span><input data-admin-email-field="cc" value="${escapeHtml(form.cc || '')}" placeholder="Optional, comma-separated" ${canSend ? '' : 'disabled'} /></label>
          <label><span>Reply-To</span><input data-admin-email-field="replyTo" type="email" value="${escapeHtml(form.replyTo || '')}" placeholder="support@melogicrecords.studio" ${canSend ? '' : 'disabled'} /></label>
          <label><span>Category</span><select data-admin-email-field="category" ${canSend ? '' : 'disabled'}>
            ${['support', 'account', 'marketplace', 'moderation', 'order', 'security', 'payout', 'other'].map((category) => `<option value="${category}" ${form.category === category ? 'selected' : ''}>${escapeHtml(humanLabel(category))}</option>`).join('')}
          </select></label>
          <label><span>Template</span><select data-admin-email-field="templateType" ${canSend ? '' : 'disabled'}>
            ${[
              ['raw', 'Raw Text'],
              ['support', 'Melogic Support Template'],
              ['alert', 'Melogic Alert Template']
            ].map(([key, label]) => `<option value="${key}" ${(form.templateType || 'support') === key ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
          </select></label>
          <label><span>Button label</span><input data-admin-email-field="ctaLabel" value="${escapeHtml(form.ctaLabel || '')}" placeholder="Optional CTA" ${canSend ? '' : 'disabled'} /></label>
          <label><span>Button URL</span><input data-admin-email-field="ctaUrl" value="${escapeHtml(form.ctaUrl || '')}" placeholder="https://melogicrecords.studio/..." ${canSend ? '' : 'disabled'} /></label>
          <label><span>Related user UID</span><input data-admin-email-field="relatedUid" value="${escapeHtml(form.relatedUid)}" ${canSend ? '' : 'disabled'} /></label>
          <label><span>Related product ID</span><input data-admin-email-field="relatedProductId" value="${escapeHtml(form.relatedProductId)}" ${canSend ? '' : 'disabled'} /></label>
          <label><span>Related order ID</span><input data-admin-email-field="relatedOrderId" value="${escapeHtml(form.relatedOrderId)}" ${canSend ? '' : 'disabled'} /></label>
          <label><span>Related report ID</span><input data-admin-email-field="relatedReportId" value="${escapeHtml(form.relatedReportId || '')}" ${canSend ? '' : 'disabled'} /></label>
        </div>
        <label><span>Subject</span><input data-admin-email-field="subject" maxlength="180" value="${escapeHtml(form.subject)}" ${canSend ? '' : 'disabled'} /></label>
        <label><span>Message</span><textarea data-admin-email-field="body" rows="7" maxlength="5000" ${canSend ? '' : 'disabled'}>${escapeHtml(form.body)}</textarea></label>
        ${renderAdminEmailComposerPreview(form)}
        ${state.contact.emailMessage ? `<p class="admin-status ${state.contact.emailMessage.startsWith('Sent') ? 'is-success' : 'is-error'}">${escapeHtml(state.contact.emailMessage)}</p>` : ''}
        <div class="admin-modal-actions">
          <button type="button" class="admin-secondary-button" data-admin-email-self ${canSend && state.currentUser?.email ? '' : 'disabled'}>Send Test to Self</button>
          <button type="submit" class="admin-primary-button" ${canSend && !state.contact.emailSending ? '' : 'disabled'}>${state.contact.emailSending ? 'Sending...' : 'Send Email'}</button>
        </div>
      </form>
    </section>
    ${emailActivityPanel()}
  `
}

function adminEmailPreviewModel(form = {}) {
  const templateType = ['raw', 'support', 'alert'].includes(form.templateType) ? form.templateType : 'support'
  const subject = String(form.subject || 'No subject yet').trim()
  const finalSubject = templateType === 'alert' && !/^\[alert\]/i.test(subject) ? `[ALERT] ${subject}` : subject
  const body = String(form.body || 'No message yet')
  return { templateType, finalSubject, body, ctaLabel: form.ctaLabel || '', ctaUrl: form.ctaUrl || '' }
}

function renderAdminEmailComposerPreview(form = {}) {
  const preview = adminEmailPreviewModel(form)
  if (preview.templateType === 'raw') {
    return `
      <article class="admin-email-preview is-raw">
        <strong>Raw Text Preview</strong>
        <p>${escapeHtml(preview.finalSubject)}</p>
        <small>${escapeHtml(preview.body.slice(0, 700))}</small>
      </article>
    `
  }
  return `
    <article class="admin-email-preview ${preview.templateType === 'alert' ? 'is-alert' : 'is-support'}">
      <strong>${preview.templateType === 'alert' ? 'Melogic Alert Template' : 'Melogic Support Template'}</strong>
      <p>${escapeHtml(preview.finalSubject)}</p>
      <small>${escapeHtml(preview.body.slice(0, 700))}</small>
      ${preview.ctaUrl ? `<span class="admin-email-preview-cta">${escapeHtml(preview.ctaLabel || 'Open Melogic Records')}</span>` : ''}
    </article>
  `
}

function emailLogState(tab = state.contact.emailLogTab || 'sent') {
  return state.contact.emailLogs?.[tab] || { items: [], loading: false, loadingMore: false, loaded: false, error: '', cursor: '', hasMore: false }
}

function emailActivitySearchToolbar() {
  const active = state.contact.emailLogSearch || ''
  return `
    <form class="admin-email-search" data-email-log-search-form>
      <input data-email-log-search-input value="${escapeHtml(state.contact.emailLogSearchInput || active)}" placeholder="Search recipient, subject, sender, username, UID, role, or content" />
      <button type="submit" class="admin-secondary-button">Search</button>
      ${active ? '<button type="button" class="admin-secondary-button" data-email-log-search-clear>Clear</button>' : ''}
    </form>
  `
}

function emailActivityTabs(active = state.contact.emailLogTab || 'sent') {
  return `
    <div class="admin-contact-tabs is-subtabs" role="tablist" aria-label="Email activity">
      ${[
        ['sent', 'Sent'],
        ['failed', 'Failed'],
        ['draft', 'Draft']
      ].map(([key, label]) => `<a href="${ROUTES.adminContact}?mode=email&activity=${key}" class="${active === key ? 'is-active' : ''}" data-email-log-tab="${key}" aria-current="${active === key ? 'page' : 'false'}">${escapeHtml(label)}</a>`).join('')}
    </div>
  `
}

function emailLogRows(tab = 'sent', rows = []) {
  if (tab === 'draft') {
    return '<article class="admin-empty-state">Draft emails are coming soon.</article>'
  }
  if (!rows.length) {
    const copy = tab === 'failed'
      ? 'No recent email failures. Provider errors and rate-limited sends will appear here.'
      : 'No sent emails loaded yet.'
    return `<article class="admin-empty-state">${escapeHtml(copy)}</article>`
  }
  const headers = tab === 'failed'
    ? ['Recipient', 'Subject', 'Category', 'Status', 'Sent By', 'Created', 'Actions']
    : ['Recipient', 'Subject', 'Category', 'Status', 'Sent By', 'Created', 'Actions']
  const tableRows = rows.map((row) => {
    const viewButton = htmlCell(`<button type="button" class="admin-secondary-button" data-email-log-detail="${escapeHtml(row.emailId)}">View Details</button>`)
    if (tab === 'failed') {
      return [
        htmlCell(`<strong>${escapeHtml(row.toDomain || row.recipientDomain || 'Recipient')}</strong><small>${escapeHtml(row.to || '')}</small>`),
        htmlCell(`<span class="admin-email-two-line">${escapeHtml(compactText(row.subject || '', 120))}</span>`),
        htmlCell(`<span class="admin-email-two-line">${escapeHtml(humanLabel(row.category || ''))}</span>`),
        htmlCell(`<strong>${escapeHtml(row.errorCode || 'failed')}</strong><small>${escapeHtml(compactText(row.errorMessageRedacted || '', 80))}</small>`),
        htmlCell(`<strong>${escapeHtml(row.sentByUsername || row.sentByUid || 'System')}</strong>${row.sentByUid ? `<small>${escapeHtml(row.sentByUid)}</small>` : ''}`),
        formatDate(row.createdAt || row.failedAt),
        viewButton
      ]
    }
    return [
      htmlCell(`<strong>${escapeHtml(row.to || row.recipientDomain || 'Recipient')}</strong><small>${escapeHtml(row.recipientDomain || row.toDomain || '')}</small>`),
      htmlCell(`<span class="admin-email-two-line">${escapeHtml(compactText(row.subject || '', 120))}</span>`),
      htmlCell(`<span class="admin-email-two-line">${escapeHtml(humanLabel(row.category || ''))}</span>`),
      htmlCell(renderBadge(humanLabel(row.status || 'sent'), row.status === 'sent' ? 'approved' : 'pending')),
      htmlCell(`<strong>${escapeHtml(row.sentByUsername || row.sentByUid || 'System')}</strong>${row.sentByUid ? `<small>${escapeHtml(row.sentByUid)}</small>` : ''}`),
      formatDate(row.createdAt || row.sentAt),
      viewButton
    ]
  })
  return adminSimpleTable(tab === 'failed' ? 'Email Failures' : 'Sent Emails', headers, tableRows, {
    className: tab === 'failed' ? 'is-email-failures' : 'is-email-logs',
    emptyTitle: tab === 'failed' ? 'No recent email failures.' : 'No sent emails loaded.',
    emptyBody: tab === 'failed' ? 'Provider errors and rate-limited sends will appear here.' : 'Sent emails will appear here.'
  })
}

function emailLogDetail() {
  const tab = state.contact.emailLogTab || 'sent'
  const detailId = state.contact.emailLogDetailId || ''
  if (!detailId) return ''
  const row = emailLogState(tab).items.find((item) => item.emailId === detailId)
  if (!row) {
    return `
      <div class="admin-email-detail-backdrop" data-email-log-detail-backdrop>
        <article class="admin-email-detail-drawer" role="dialog" aria-modal="true" aria-label="Email details">
          <div class="admin-slab-heading">
            <h3>Email Details</h3>
            <button type="button" class="admin-icon-button" data-close-email-log-detail title="Close">${iconSvg('x')}</button>
          </div>
          <article class="admin-empty-state"><strong>Email log not loaded.</strong><span>Load the matching activity tab or clear search, then open details again.</span></article>
        </article>
      </div>
    `
  }
  const view = state.contact.emailLogDetailView || 'preview'
  const htmlPreview = row.renderedHtml || row.htmlPreview || ''
  const plainText = row.plainText || row.bodyPreview || ''
  const previewContent = view === 'html'
    ? `<pre class="admin-email-raw">${escapeHtml(htmlPreview || 'Full rendered preview was not stored for this email. Future emails will include preview data.')}</pre>`
    : view === 'text'
      ? `<pre class="admin-email-raw">${escapeHtml(plainText || 'Plaintext fallback was not stored for this email.')}</pre>`
      : htmlPreview
        ? `<iframe class="admin-email-preview-frame" sandbox srcdoc="${escapeHtml(htmlPreview)}" title="Email preview"></iframe>`
        : '<article class="admin-empty-state">Full rendered preview was not stored for this email. Future emails will include preview data.</article>'
  return `
    <div class="admin-email-detail-backdrop" data-email-log-detail-backdrop>
    <article class="admin-email-detail-drawer" role="dialog" aria-modal="true" aria-label="Email details">
      <div class="admin-slab-heading">
        <h3>Email Details</h3>
        <button type="button" class="admin-icon-button" data-close-email-log-detail title="Close">${iconSvg('x')}</button>
      </div>
      ${renderKeyValueGrid([
        renderField('Recipient', row.to || row.toDomain),
        renderField('CC domains', (row.ccDomains || []).join(', ') || 'None'),
        renderField('Reply-To', row.replyTo || 'Not set'),
        renderField('Subject', row.subject, { wide: true }),
        renderField('Final sent subject', row.finalSubject || row.subject, { wide: true }),
        renderField('Template type', row.templateType || row.templateName || 'Not stored'),
        renderField('Category', humanLabel(row.category)),
        renderField('Status', humanLabel(row.status)),
        renderField('Provider', row.provider || 'smtp'),
        renderField('Provider message ID', row.providerMessageId || 'Not set', { wide: true, code: true }),
        renderDateField('Created', row.createdAt),
        renderDateField('Sent', row.sentAt),
        renderDateField('Failed', row.failedAt),
        renderField('Sent by', row.sentByUsername || row.sentByUid || 'System'),
        renderField('Related user', row.relatedUid, { code: true }),
        renderField('Related product', row.relatedProductId, { code: true }),
        renderField('Related order', row.relatedOrderId, { code: true }),
        renderField('Related report', row.relatedReportId, { code: true }),
        renderField('Body preview', row.bodyPreview, { wide: true }),
        renderField('Internal note', row.internalNote, { wide: true }),
        renderField('Error', [row.errorCode, row.errorMessageRedacted].filter(Boolean).join(': '), { wide: true })
      ])}
      <div class="admin-email-detail-tabs">
        ${[
          ['preview', 'Preview'],
          ['html', 'Raw HTML'],
          ['text', 'Plain Text']
        ].map(([key, label]) => `<button type="button" class="admin-secondary-button ${view === key ? 'is-active' : ''}" data-email-log-detail-view="${key}">${escapeHtml(label)}</button>`).join('')}
      </div>
      ${previewContent}
    </article>
    </div>
  `
}

function emailActivityPanel() {
  const tab = state.contact.emailLogTab || 'sent'
  const data = emailLogState(tab)
  return `
    <section class="admin-section-slab admin-email-activity">
      <div class="admin-email-activity-header">
        <div>
          <h2>Email Activity</h2>
          <p class="admin-muted">Sent, failed, and draft activity is paginated separately from the composer.</p>
        </div>
        <span class="admin-muted">${data.items.length} loaded</span>
      </div>
      <div class="admin-email-activity-toolbar">
        ${emailActivityTabs(tab)}
        ${emailActivitySearchToolbar()}
      </div>
      ${state.contact.emailLogSearch ? `<p class="admin-email-search-note">Searching: ${escapeHtml(state.contact.emailLogSearch)}</p>` : ''}
      <div class="admin-table-scroll admin-email-activity-scroll">
        ${data.loading ? '<article class="admin-empty-state">Loading email activity...</article>' : data.error ? `<article class="admin-empty-state"><strong>Could not load email activity.</strong><span>${escapeHtml(data.error)}</span></article>` : emailLogRows(tab, data.items)}
        ${data.hasMore ? `<div class="admin-load-more-row"><button type="button" class="admin-secondary-button" data-email-log-load-more ${data.loadingMore ? 'disabled' : ''}>${data.loadingMore ? 'Loading...' : 'Load more'}</button></div>` : ''}
      </div>
      ${emailLogDetail()}
    </section>
  `
}

function systemMessagePanel() {
  const form = state.contact.systemForm || {}
  const recipientLabel = form.recipientLabel || form.recipientUid || ''
  const categories = ['support', 'account', 'security', 'product', 'marketplace', 'community', 'order', 'other']
  const priorities = ['normal', 'important', 'critical']
  return `
    <section class="admin-section-slab admin-contact-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>System Message</h2>
          <p class="admin-muted">Send a verified platform message to a user's Inbox → System.</p>
        </div>
        <span class="review-badge is-approved">Verified sender</span>
      </div>
      <form class="admin-email-form" data-admin-system-form>
        <div class="admin-form-grid">
          <label><span>Recipient user</span><input data-admin-system-field="recipientUid" value="${escapeHtml(form.recipientUid)}" placeholder="UID, username, display name, or email" /></label>
          <label><span>Category</span><select data-admin-system-field="category">
            ${categories.map((category) => `<option value="${category}" ${form.category === category ? 'selected' : ''}>${escapeHtml(humanLabel(category))}</option>`).join('')}
          </select></label>
          <label><span>Priority</span><select data-admin-system-field="priority">
            ${priorities.map((priority) => `<option value="${priority}" ${form.priority === priority ? 'selected' : ''}>${escapeHtml(humanLabel(priority))}</option>`).join('')}
          </select></label>
        </div>
        ${recipientLabel ? `<p class="admin-muted">Selected recipient: ${escapeHtml(recipientLabel)}</p>` : ''}
        <label><span>Subject</span><input data-admin-system-field="subject" maxlength="180" value="${escapeHtml(form.subject)}" /></label>
        <label><span>Message</span><textarea data-admin-system-field="body" rows="7" maxlength="5000">${escapeHtml(form.body)}</textarea></label>
        <div class="admin-form-grid">
          <label><span>Optional action label</span><input data-admin-system-field="actionLabel" maxlength="80" value="${escapeHtml(form.actionLabel)}" /></label>
          <label><span>Optional action URL</span><input data-admin-system-field="actionUrl" value="${escapeHtml(form.actionUrl)}" placeholder="/account/security" /></label>
          <label><span>Internal note</span><input data-admin-system-field="internalNote" maxlength="1200" value="${escapeHtml(form.internalNote)}" /></label>
        </div>
        <article class="admin-email-preview">
          <strong>Melogic Records Support ✓</strong>
          <p>${escapeHtml(form.subject || 'No subject yet')}</p>
          <small>${escapeHtml((form.body || 'No message yet').slice(0, 260))}</small>
          ${form.actionLabel ? `<small>Action: ${escapeHtml(form.actionLabel)} → ${escapeHtml(form.actionUrl || 'Missing URL')}</small>` : ''}
        </article>
        ${state.contact.systemMessage ? `<p class="admin-status ${state.contact.systemMessage.startsWith('Sent') ? 'is-success' : 'is-error'}">${escapeHtml(state.contact.systemMessage)}</p>` : ''}
        <div class="admin-modal-actions">
          <button type="submit" class="admin-primary-button" ${state.contact.systemSending ? 'disabled' : ''}>${state.contact.systemSending ? 'Sending...' : 'Send System Message'}</button>
        </div>
      </form>
    </section>
  `
}

function contactComingSoonPanel(title = '', body = '') {
  return `
    <section class="admin-section-slab admin-contact-panel">
      <div class="admin-slab-heading">
        <h2>${escapeHtml(title)}</h2>
        <span class="review-badge is-warning">Coming soon</span>
      </div>
      <p class="admin-muted">${escapeHtml(body)}</p>
      <div class="admin-form-grid is-disabled">
        <label><span>Recipient</span><input disabled value="" /></label>
        <label><span>Subject</span><input disabled value="" /></label>
        <label><span>Message</span><input disabled value="" /></label>
      </div>
    </section>
  `
}

function settingsCard(section, values = {}) {
  const editableFields = section.key === 'supportAi'
    ? section.fields.filter(([key]) => !['updatedAt', 'updatedBy'].includes(key))
    : section.fields
  return `
    <section class="admin-section-slab admin-settings-card admin-settings-card-${escapeHtml(section.key)}">
      <div class="admin-slab-heading">
        <h2>${escapeHtml(section.title)}</h2>
        <button type="button" class="admin-secondary-button" data-edit-settings="${escapeHtml(section.key)}" ${can('settingsManage') || can('roleManage') ? '' : 'disabled'}>Edit</button>
      </div>
      <div class="admin-settings-card-scroll">
        ${renderKeyValueGrid(editableFields.map(([key, label]) => renderField(label, formatSettingValue(values[key]))), { compact: true })}
        ${section.key === 'supportAi' && (values.updatedAt || values.updatedBy) ? `<p class="admin-muted">Last Resona edit ${escapeHtml(values.updatedAt || 'unknown')}${values.updatedBy ? ` by ${escapeHtml(values.updatedBy)}` : ''}.</p>` : ''}
      </div>
    </section>
  `
}

function resonaStatsCard() {
  const stats = state.settings.resonaStats || {}
  const unavailable = !state.settings.resonaStats
  const statRows = [
    ['Conversations', stats.totalConversations],
    ['Messages', stats.totalMessages],
    ['User messages', stats.totalUserMessages],
    ['AI replies', stats.totalAiReplies],
    ['Waiting for agent', stats.waitingForAgent],
    ['Assigned', stats.assigned],
    ['Escalated', stats.escalated],
    ['Feedback', stats.feedbackCount],
    ['Reports', stats.reportCount],
    ['Model', stats.model || 'Not tracked yet'],
    ['AI status', stats.aiEnabled === false ? 'Disabled' : 'Enabled'],
    ['Last activity', stats.lastActivityAt ? formatDate(stats.lastActivityAt) : 'Not tracked yet']
  ]
  return `
    <section class="admin-section-slab admin-settings-card admin-settings-card-resona-stats">
      <div class="admin-slab-heading">
        <div>
          <h2>Resona AI Stats</h2>
          <p class="admin-muted">Operational snapshot for Inbox Resona conversations.</p>
        </div>
      </div>
      <div class="admin-settings-card-scroll">
        ${state.settings.loading ? '<article class="admin-empty-state">Loading Resona stats...</article>' : ''}
        ${state.settings.error && unavailable ? `<p class="admin-status is-error">${escapeHtml(state.settings.error)}</p>` : ''}
        <dl class="admin-resona-stats-grid">
          ${statRows.map(([label, value]) => `
            <div>
              <dt>${escapeHtml(label)}</dt>
              <dd>${escapeHtml(value === null || value === undefined || value === '' ? 'Not tracked yet' : value)}</dd>
            </div>
          `).join('')}
        </dl>
        ${stats.truncated ? '<p class="admin-muted">Stats are sampled from the most recent tracked thread window.</p>' : ''}
      </div>
    </section>
  `
}

function formatSettingValue(value) {
  if (Array.isArray(value)) return value.join(', ')
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null || value === undefined || value === '') return 'Not set'
  return String(value).length > 420 ? `${String(value).slice(0, 420).trimEnd()}...` : value
}

function settingsDialog() {
  if (!state.settings.dialog.open) return ''
  const section = SETTINGS_SECTIONS.find((item) => item.key === state.settings.dialog.section)
  if (!section) return ''
  const values = state.settings.data?.[section.key] || {}
  const saving = state.settings.saving
  const editableFields = section.key === 'agreements'
    ? section.fields.filter(([key]) => !['sellerAgreementUpdatedAt', 'sellerAgreementUpdatedBy', 'sellerAgreementPath'].includes(key))
    : section.key === 'supportAi'
      ? section.fields.filter(([key]) => !['updatedAt', 'updatedBy'].includes(key))
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
          ${section.key === 'supportAi' ? '<p class="admin-muted">These instructions are loaded server-side by Resona for Inbox replies and support escalation decisions.</p>' : ''}
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
    const rows = key === 'productModerationInstructions' || key === 'systemBehavior' ? 8 : 5
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

function communityTargetRoute(type = '', id = '', row = {}) {
  if (type === 'community_post') return `/community/post/${encodeURIComponent(id)}`
  if (type === 'community_comment') return row.postId ? `/community/post/${encodeURIComponent(row.postId)}#comments` : ROUTES.adminCommunity
  if (type === 'community') return row.slug ? `/community/c/${encodeURIComponent(row.slug)}` : ROUTES.adminCommunity
  return ROUTES.adminCommunity
}

function adminCommunitySlug(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function renderAdminCommunityPeople(items = [], empty = 'None loaded') {
  return items.length ? `
    <div class="admin-community-person-list">
      ${items.map((item) => `
        <article>
          ${item.avatarURL ? `<img src="${escapeHtml(item.avatarURL)}" alt="" loading="lazy" />` : '<span></span>'}
          <div>
            <strong>${escapeHtml(item.displayName || item.uid || 'User')}</strong>
            <small>${escapeHtml(item.username ? `@${item.username}` : item.uid || '')}</small>
          </div>
        </article>
      `).join('')}
    </div>
  ` : `<p class="admin-muted">${escapeHtml(empty)}</p>`
}

function communityPostRows(posts = []) {
  return posts.map((post) => [
    htmlCell(`<strong>${escapeHtml(post.title || 'Community post')}</strong><small>${escapeHtml(post.postId || post.id || '')}</small>`),
    htmlCell(`<span>${escapeHtml(post.communityName || post.communitySlug || 'General')}</span><small>${escapeHtml(post.authorDisplayName || post.authorUid || '')}</small>`),
    htmlCell(renderBadge(humanLabel(post.status || 'unknown'), statusClass(post.status))),
    `${formatCount(post.likeCount)} likes / ${formatCount(post.commentCount)} comments`,
    `${formatCount(post.reportCount)} reports`,
    htmlCell(`
      <div class="admin-row-actions">
        <a class="admin-row-action-button" href="${communityTargetRoute('community_post', post.postId)}" target="_blank" rel="noreferrer">Open</a>
        <button type="button" class="admin-secondary-button" data-admin-community-action="hide-post" data-admin-community-post="${escapeHtml(post.postId)}">Hide</button>
        <button type="button" class="admin-secondary-button" data-admin-community-action="restore-post" data-admin-community-post="${escapeHtml(post.postId)}">Restore</button>
        <button type="button" class="admin-secondary-button" data-admin-community-action="${post.commentsLocked ? 'unlock-post' : 'lock-post'}" data-admin-community-post="${escapeHtml(post.postId)}">${post.commentsLocked ? 'Unlock' : 'Lock'}</button>
        <button type="button" class="admin-secondary-button" data-admin-community-action="${post.pinnedInCommunity ? 'unpin-post' : 'pin-post'}" data-admin-community-post="${escapeHtml(post.postId)}">${post.pinnedInCommunity ? 'Unpin' : 'Pin'}</button>
      </div>
    `)
  ])
}

function communityRows(communities = []) {
  return communities.map((community) => [
    htmlCell(`<strong>${escapeHtml(community.name || 'Community')}</strong><small>c/${escapeHtml(community.slug || community.communityId || '')}</small>`),
    htmlCell(renderBadge(humanLabel(community.status || 'active'), statusClass(community.status))),
    `${formatCount(community.focusCount)} focused / ${formatCount(community.postCount)} posts`,
    `${formatCount(community.reportCount)} reports`,
    htmlCell((community.pinnedPostIds || []).length ? (community.pinnedPostIds || []).map((id) => `<code class="admin-code-value">${escapeHtml(shortIdentifier(id))}</code>`).join(' ') : '<span class="admin-muted">None</span>'),
    htmlCell(`
      <div class="admin-row-actions">
        <a class="admin-row-action-button admin-table-action-main" href="${ROUTES.adminCommunity}/${encodeURIComponent(community.communityId)}">View / Audit</a>
      </div>
    `)
  ])
}

function communityReportRows(reports = []) {
  return reports.map((report) => [
    humanLabel(report.targetType || report.type),
    htmlCell(`<strong>${escapeHtml(shortIdentifier(report.targetId || ''))}</strong><small>${escapeHtml(report.sourcePath || '')}</small>`),
    report.reason,
    htmlCell(renderBadge(humanLabel(report.status || 'open'), statusClass(report.status))),
    formatDate(report.createdAt),
    htmlCell(`<a class="admin-row-action-button" href="${ROUTES.adminReports}/${encodeURIComponent(report.reportId || report.id)}">Review</a>`)
  ])
}

function renderAdminCommunityCreatePanel(data) {
  if (!data.createOpen) return ''
  return `
    <section class="admin-section-slab admin-community-create-panel">
      <div class="admin-slab-heading">
        <div>
          <h2>Create Community</h2>
          <p class="admin-muted">Official communities are admin-managed and appear publicly only when active and public.</p>
        </div>
        <button type="button" class="admin-secondary-button" data-admin-community-create-close>Close</button>
      </div>
      ${data.createMessage ? `<p class="admin-success">${escapeHtml(data.createMessage)}</p>` : ''}
      ${data.createError ? `<p class="admin-error">${escapeHtml(data.createError)}</p>` : ''}
      <form class="admin-community-create-form" data-admin-community-create-form>
        <label>
          <span>Title</span>
          <input name="title" maxlength="80" placeholder="StageMaker Designers" required />
        </label>
        <label>
          <span>Slug</span>
          <input name="slug" maxlength="48" placeholder="stagemaker-designers" />
        </label>
        <label>
          <span>Description</span>
          <textarea name="description" rows="4" maxlength="700" placeholder="What should creators use this community for?" required></textarea>
        </label>
        <label>
          <span>Rules</span>
          <textarea name="rules" rows="4" maxlength="1600" placeholder="One rule per line"></textarea>
        </label>
        <div class="admin-form-grid two">
          <label>
            <span>Category</span>
            <select name="category">
              ${['Genre', 'Production', 'Stage', 'Marketplace', 'Feedback', 'Creator Help'].map((category) => `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Posting mode</span>
            <select name="postingMode">
              ${[
                ['open', 'Open'],
                ['focused_only', 'Focused only'],
                ['members_only', 'Members only'],
                ['moderators_only', 'Moderators only']
              ].map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join('')}
            </select>
          </label>
          <label>
            <span>Visibility</span>
            <select name="visibility">
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select name="status">
              <option value="active">Active</option>
              <option value="hidden">Hidden</option>
              <option value="archived">Archived</option>
            </select>
          </label>
        </div>
        <label>
          <span>Moderator UIDs</span>
          <textarea name="moderatorUids" rows="3" maxlength="1800" placeholder="One UID per line. Your admin UID is added automatically."></textarea>
        </label>
        <div class="admin-form-grid two">
          <label>
            <span>Profile image</span>
            <input type="file" name="profileImage" accept="image/*" />
          </label>
          <label>
            <span>Banner image</span>
            <input type="file" name="bannerImage" accept="image/*" />
          </label>
        </div>
        <div class="admin-dialog-actions">
          <button type="submit" class="admin-primary-button" ${data.createSaving ? 'disabled' : ''}>${data.createSaving ? 'Creating...' : 'Create Community'}</button>
        </div>
      </form>
    </section>
  `
}

function renderCommunityEditForm(community = {}, data = {}) {
  return `
    <form class="admin-community-edit-form" data-admin-community-edit-form>
      <div class="admin-form-grid two">
        <label>
          <span>Title</span>
          <input name="title" maxlength="120" value="${escapeHtml(community.name || community.title || '')}" required />
        </label>
        <label>
          <span>Slug</span>
          <input name="slug" maxlength="80" value="${escapeHtml(community.slug || community.communityId || '')}" />
        </label>
      </div>
      <label>
        <span>Description</span>
        <textarea name="description" rows="4" maxlength="700">${escapeHtml(community.description || '')}</textarea>
      </label>
      <label>
        <span>Rules</span>
        <textarea name="rules" rows="5" maxlength="2400" placeholder="One rule per line">${escapeHtml((community.rules || []).join('\n'))}</textarea>
      </label>
      <div class="admin-form-grid two">
        <label>
          <span>Visibility</span>
          <select name="visibility">
            ${['public', 'private'].map((value) => `<option value="${value}" ${community.visibility === value ? 'selected' : ''}>${humanLabel(value)}</option>`).join('')}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select name="status">
            ${['active', 'hidden', 'archived', 'deleted'].map((value) => `<option value="${value}" ${(community.status || 'active') === value ? 'selected' : ''}>${humanLabel(value)}</option>`).join('')}
          </select>
        </label>
      </div>
      <label>
        <span>Moderator UIDs</span>
        <textarea name="moderatorUids" rows="4" maxlength="4000" placeholder="One UID per line">${escapeHtml([...(community.moderatorUids || []), ...(community.moderatorIds || [])].filter((value, index, list) => value && list.indexOf(value) === index).join('\n'))}</textarea>
      </label>
      <label>
        <span>Pinned post IDs</span>
        <textarea name="pinnedPostIds" rows="3" maxlength="2000" placeholder="One post ID per line">${escapeHtml((community.pinnedPostIds || []).join('\n'))}</textarea>
      </label>
      <div class="admin-form-grid two">
        <label>
          <span>Profile image</span>
          <input type="file" name="profileImage" accept="image/*" />
          ${community.imagePath ? `<small class="admin-code-value">${escapeHtml(community.imagePath)}</small>` : ''}
        </label>
        <label>
          <span>Banner image</span>
          <input type="file" name="bannerImage" accept="image/*" />
          ${community.bannerImagePath ? `<small class="admin-code-value">${escapeHtml(community.bannerImagePath)}</small>` : ''}
        </label>
      </div>
      <div class="admin-dialog-actions">
        <button type="submit" class="admin-primary-button" ${data.actioning === 'save-community' ? 'disabled' : ''}>${data.actioning === 'save-community' ? 'Saving...' : 'Save changes'}</button>
      </div>
    </form>
  `
}

function renderAdminCommunityAuditPage() {
  const data = adminData('community')
  const communityId = adminCommunityDetailId()
  const audit = data.audit || {}
  const community = audit.community || {}
  if (!communityId) return ''
  if (data.loading || data.auditLoading || !data.loaded) {
    return `
      <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminCommunity}">${iconSvg('arrowLeft')}<span>Back to Community Moderation</span></a>
      <section class="admin-section-slab admin-community-audit-page">
        <h2>Community Audit</h2>
        <p class="admin-muted">Loading community audit...</p>
      </section>
    `
  }
  if (data.auditError || !community.communityId) {
    return `
      <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminCommunity}">${iconSvg('arrowLeft')}<span>Back to Community Moderation</span></a>
      <article class="admin-empty-state">
        <strong>Community audit could not be loaded.</strong>
        <span>${escapeHtml(data.auditError || communityId)}</span>
      </article>
    `
  }
  return `
    <a class="admin-secondary-link admin-back-link" href="${ROUTES.adminCommunity}">${iconSvg('arrowLeft')}<span>Back to Community Moderation</span></a>
    <section class="admin-community-audit-page">
      <header class="admin-page-header admin-community-audit-header">
        <div>
          <p class="eyebrow">Community Audit</p>
          <h1>${escapeHtml(community.name || community.title || 'Community')}</h1>
          <p>c/${escapeHtml(community.slug || community.communityId || '')}</p>
          <small class="admin-code-value">${escapeHtml(community.communityId || '')}</small>
        </div>
        <div class="admin-header-actions admin-community-audit-actions">
          <a class="admin-secondary-link" href="${communityTargetRoute('community', community.communityId, community)}" target="_blank" rel="noreferrer">Go to public community page</a>
          <button type="button" class="admin-secondary-button" data-admin-community-focus-title>Rename community</button>
          <button type="button" class="admin-secondary-button" data-admin-community-action="hide-community" data-admin-community-id="${escapeHtml(community.communityId)}">Hide community</button>
          <button type="button" class="admin-secondary-button" data-admin-community-action="restore-community" data-admin-community-id="${escapeHtml(community.communityId)}">Restore community</button>
          <button type="button" class="admin-secondary-button" data-admin-community-action="archive-community" data-admin-community-id="${escapeHtml(community.communityId)}">Archive community</button>
          <button type="button" class="admin-secondary-button is-danger" data-admin-community-action="delete-community" data-admin-community-id="${escapeHtml(community.communityId)}">Delete community</button>
        </div>
      </header>
      ${state.error ? `<p class="admin-error">${escapeHtml(state.error)}</p>` : ''}
      ${state.message ? `<p class="admin-success">${escapeHtml(state.message)}</p>` : ''}
      <section class="admin-section-slab admin-community-audit-card">
        <div class="admin-slab-heading">
          <h2>Edit community</h2>
          <span class="admin-muted">Save existing community metadata, images, rules, and moderators.</span>
        </div>
        ${renderCommunityEditForm(community, data)}
      </section>
      <div class="admin-community-audit-grid">
        <article class="admin-section-slab admin-community-audit-card">
          <h3>Metadata / Stats</h3>
          <dl>
            ${renderField('Status', community.status || 'active')}
            ${renderField('Visibility', community.visibility || 'public')}
            ${renderField('Followers', formatCount(community.followerCount || community.focusCount))}
            ${renderField('Posts', formatCount(community.postCount))}
            ${renderField('Reports', formatCount(community.reportCount))}
            ${renderField('Created', formatDate(community.createdAt))}
            ${renderField('Updated', formatDate(community.updatedAt))}
            ${renderField('Created by', community.createdBy || community.ownerUid || '', { code: true })}
            ${renderField('Updated by', community.updatedBy || '', { code: true })}
            ${renderField('Image path', community.imagePath || '', { code: true, wide: true })}
            ${renderField('Banner path', community.bannerImagePath || '', { code: true, wide: true })}
          </dl>
        </article>
        <article class="admin-section-slab admin-community-audit-card">
          <h3>Rules</h3>
          ${renderBadgeList((community.rules || []).map((rule) => rule), 'No rules stored')}
        </article>
        <article class="admin-section-slab admin-community-audit-card">
          <h3>Moderating users</h3>
          ${renderAdminCommunityPeople(audit.moderators || [], 'No moderators loaded')}
        </article>
        <article class="admin-section-slab admin-community-audit-card">
          <h3>Following users</h3>
          ${renderAdminCommunityPeople(audit.followers || [], 'No focused users loaded')}
        </article>
        <article class="admin-section-slab admin-community-audit-card">
          <h3>Users who posted</h3>
          ${renderAdminCommunityPeople(audit.posters || [], 'No recent posters loaded')}
        </article>
      </div>
      <section class="admin-section-slab admin-community-audit-card">
        <div class="admin-slab-heading"><h2>Recent posts</h2><span class="admin-muted">${formatCount(audit.recentPosts?.length || 0)} loaded</span></div>
        ${adminSimpleTable('Recent posts', ['Post', 'Author', 'Status', 'Engagement', 'Reports', 'Actions'], communityPostRows(audit.recentPosts || []), { className: 'is-community', emptyTitle: 'No recent posts loaded.' })}
      </section>
      <section class="admin-section-slab admin-community-audit-card">
        <div class="admin-slab-heading"><h2>Reports</h2><span class="admin-muted">${formatCount(audit.reports?.length || 0)} loaded</span></div>
        ${adminSimpleTable('Community reports', ['Type', 'Target', 'Reason', 'Status', 'Created', 'Actions'], communityReportRows(audit.reports || []), { className: 'is-reports', emptyTitle: 'No community reports loaded.' })}
      </section>
    </section>
  `
}

function communityAdminView() {
  const data = adminData('community')
  if (adminCommunityDetailId()) return renderAdminCommunityAuditPage()
  const filter = data.filter || 'reported'
  const posts = filter === 'hidden' ? data.hiddenPosts : filter === 'reported' ? data.reportedPosts : data.posts
  const loading = adminBusyState(data)
  return `
    ${adminPageHeader({ eyebrow: 'Community', title: 'Community Moderation', refreshLabel: 'Refresh community moderation' })}
    <section class="admin-review-tools">
      <button type="button" class="admin-primary-button" data-admin-community-create-open>Create Community</button>
    </section>
    ${renderAdminCommunityCreatePanel(data)}
    <section class="admin-review-tools">${adminFilterControls('community', [
      { key: 'reported', label: 'Reported Posts' },
      { key: 'hidden', label: 'Hidden Posts' },
      { key: 'recent', label: 'Recent Posts' },
      { key: 'communities', label: 'Communities' },
      { key: 'reports', label: 'Reports' }
    ])}</section>
    ${loading || (filter === 'communities'
      ? adminSimpleTable('Communities', ['Community', 'Status', 'Activity', 'Reports', 'Pinned', 'Actions'], communityRows(data.communities), { className: 'is-community', emptyTitle: 'No communities loaded.' })
      : filter === 'reports'
        ? adminSimpleTable('Community Reports', ['Type', 'Target', 'Reason', 'Status', 'Created', 'Actions'], communityReportRows(data.reports), { className: 'is-reports', emptyTitle: 'No community reports.' })
        : adminSimpleTable('Community Posts', ['Post', 'Context', 'Status', 'Engagement', 'Reports', 'Actions'], communityPostRows(posts), { className: 'is-community', emptyTitle: 'No posts match this view.' })
    )}
    <section class="admin-section-slab">
      <div class="admin-slab-heading">
        <h2>Comment Reports</h2>
        <span class="admin-muted">${formatCount(data.reportedComments?.length || 0)} loaded</span>
      </div>
      ${adminSimpleTable('Reported Comments', ['Comment', 'Author', 'Status', 'Reports', 'Actions'], (data.reportedComments || []).map((comment) => [
        htmlCell(`<strong>${escapeHtml(compactText(comment.body || 'Comment', 90))}</strong><small>${escapeHtml(comment.commentId || '')}</small>`),
        comment.authorDisplayName || comment.authorUid,
        htmlCell(renderBadge(humanLabel(comment.status || 'visible'), statusClass(comment.status))),
        formatCount(comment.reportCount),
        htmlCell(`
          <div class="admin-row-actions">
            <a class="admin-row-action-button" href="${communityTargetRoute('community_comment', comment.commentId, comment)}" target="_blank" rel="noreferrer">Open</a>
            <button type="button" class="admin-secondary-button" data-admin-community-action="hide-comment" data-admin-community-post="${escapeHtml(comment.postId)}" data-admin-community-comment="${escapeHtml(comment.commentId)}">Hide</button>
            <button type="button" class="admin-secondary-button" data-admin-community-action="restore-comment" data-admin-community-post="${escapeHtml(comment.postId)}" data-admin-community-comment="${escapeHtml(comment.commentId)}">Restore</button>
          </div>
        `)
      ]), { className: 'is-community-comments', emptyTitle: 'No reported comments loaded.' })}
    </section>
  `
}

function render() {
  state.section = currentSectionKey()
  if (state.section === 'dashboard') return renderLayout(dashboardView())
  if (state.section === 'reviews') return renderLayout(reviewsView())
  if (state.section === 'products') return renderLayout(productsView())
  if (state.section === 'users') return renderLayout(usersView())
  if (state.section === 'reports') return renderLayout(reportsView())
  if (state.section === 'community') return renderLayout(communityAdminView())
  if (state.section === 'orders') return renderLayout(ordersView())
  if (state.section === 'team') return renderLayout(teamView())
  if (state.section === 'logs') return renderLayout(logsView())
  if (state.section === 'contact') return renderLayout(contactView())
  if (state.section === 'tools') return renderLayout(toolsView())
  if (state.section === 'operations') return renderLayout(operationsView())
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
    const [staffResult, productsResult, ordersResult, reportsResult, logsResult, supportFormsResult] = await Promise.all([
      listActiveStaffPresence({ limitCount: 30 }).catch((error) => ({ error })),
      (can('listingEdit') || can('productReview')) ? listAdminProducts({ limitCount: 6 }).catch((error) => ({ error })) : Promise.resolve({ products: [] }),
      can('orderSupport') ? listAdminOrders({ limitCount: 6 }).catch((error) => ({ error })) : Promise.resolve({ orders: [] }),
      (can('admin') || can('userModerate') || can('productReview') || can('orderSupport')) ? listAdminReports({ limitCount: 6 }).catch((error) => ({ error })) : Promise.resolve({ reports: [] }),
      can('auditRead') ? listAdminLogs({ limitCount: 6 }).catch((error) => ({ error })) : Promise.resolve({ logs: [] }),
      (can('emailSend') || can('orderSupport') || can('auditRead')) ? listUnresolvedSupportForms({ limitCount: 6 }).then((supportForms) => ({ supportForms })).catch((error) => ({ error })) : Promise.resolve({ supportForms: [] })
    ])
    const failures = [staffResult, productsResult, ordersResult, reportsResult, logsResult, supportFormsResult].filter((result) => result?.error)
    state.overview.activeStaff = staffResult.staff || []
    state.overview.products = productsResult.products || []
    state.overview.orders = ordersResult.orders || []
    state.overview.reports = reportsResult.reports || []
    state.overview.logs = logsResult.logs || []
    state.overview.supportForms = supportFormsResult.supportForms || []
    state.overview.loaded = true
    state.overview.error = failures.length ? 'Some overview sections could not be loaded.' : ''
  } catch (error) {
    console.warn('[admin] overview load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.overview.error = error?.message || 'Could not load admin overview.'
  } finally {
    state.overview.loading = false
    render()
  }
}

async function loadAdminSectionData(sectionKey = state.section, { silent = false, append = false } = {}) {
  const map = {
    products: async () => {
      const data = adminData('products')
      const result = await listAdminProducts({ limitCount: data.pageSize || 15, search: data.search, cursor: append ? data.cursor : '' })
      state.adminData.products.items = append ? mergePageItems(state.adminData.products.items, result.products || []) : (result.products || [])
      state.adminData.products.cursor = result.nextCursor || ''
      state.adminData.products.hasMore = result.hasMore === true
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
        state.adminData.users.libraryItems = result.libraryItems || []
        state.adminData.users.orders = result.orders || []
        state.adminData.users.commerceSummary = result.commerceSummary || null
        state.adminData.users.payoutConnect = result.payoutConnect || null
        state.adminData.users.earningsSummary = result.earningsSummary || null
        state.adminData.users.creatorLedgerEntries = result.creatorLedgerEntries || []
        state.adminData.users.accountEvents = result.accountEvents || []
        state.adminData.users.adminNotes = result.adminNotes || []
        await hydrateReviewMedia(state.adminData.users.recentProducts)
      } else {
        state.adminData.users.profile = null
        state.adminData.users.adminUser = null
        state.adminData.users.recentProducts = []
        state.adminData.users.libraryItems = []
        state.adminData.users.orders = []
        state.adminData.users.commerceSummary = null
        state.adminData.users.payoutConnect = null
        state.adminData.users.earningsSummary = null
        state.adminData.users.creatorLedgerEntries = []
        state.adminData.users.accountEvents = []
        state.adminData.users.adminNotes = []
      }
      const result = await listAdminUsers({ limitCount: data.pageSize || 15, search: data.search, uid: detailUid || '', cursor: append ? data.cursor : '' })
      state.adminData.users.items = append ? mergePageItems(state.adminData.users.items, result.users || []) : (result.users || [])
      state.adminData.users.cursor = result.nextCursor || ''
      state.adminData.users.hasMore = result.hasMore === true
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
        const data = adminData('reports')
        const result = await listAdminReports({ limitCount: data.pageSize || 15, cursor: append ? data.cursor : '' })
        state.adminData.reports.items = append ? mergePageItems(state.adminData.reports.items, result.reports || []) : (result.reports || [])
        state.adminData.reports.cursor = result.nextCursor || ''
        state.adminData.reports.hasMore = result.hasMore === true
        state.adminData.reports.detail = null
        state.adminData.reports.reporter = null
        state.adminData.reports.target = null
      }
    },
    community: async () => {
      const currentAuditId = adminCommunityDetailId()
      const result = await listAdminCommunityModeration({ limitCount: 60, communityId: currentAuditId })
      state.adminData.community.posts = result.posts || []
      state.adminData.community.communities = result.communities || []
      state.adminData.community.reports = result.reports || []
      state.adminData.community.reportedPosts = result.reportedPosts || []
      state.adminData.community.reportedComments = result.reportedComments || []
      state.adminData.community.hiddenPosts = result.hiddenPosts || []
      if (result.audit) {
        state.adminData.community.audit = result.audit
        state.adminData.community.auditError = ''
      } else if (!currentAuditId) {
        state.adminData.community.audit = null
        state.adminData.community.auditError = ''
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
        const data = adminData('orders')
        const result = await listAdminOrders({ limitCount: data.pageSize || 15, cursor: append ? data.cursor : '' })
        state.adminData.orders.items = append ? mergePageItems(state.adminData.orders.items, result.orders || []) : (result.orders || [])
        state.adminData.orders.cursor = result.nextCursor || ''
        state.adminData.orders.hasMore = result.hasMore === true
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
        const data = adminData('logs')
        const result = await listAdminLogs({ limitCount: data.pageSize || 15, cursor: append ? data.cursor : '' })
        state.adminData.logs.items = append ? mergePageItems(state.adminData.logs.items, result.logs || []) : (result.logs || [])
        state.adminData.logs.cursor = result.nextCursor || ''
        state.adminData.logs.hasMore = result.hasMore === true
        state.adminData.logs.detail = null
        state.adminData.logs.detailId = ''
      }
    },
    contact: async () => {
      const emailStatus = await getEmailAdminStatus().catch((error) => ({ ok: false, providerConfigured: false, recent: [], error: error?.message || 'Email status unavailable.' }))
      state.contact.emailStatus = emailStatus
      state.settings.emailStatus = emailStatus
      const params = new URLSearchParams(window.location.search)
      const uid = String(params.get('user') || '').trim()
      if (uid) prefillContactRecipient(uid)
      const category = String(params.get('category') || '').trim().toLowerCase()
      const priority = String(params.get('priority') || '').trim().toLowerCase()
      const activity = String(params.get('activity') || '').trim().toLowerCase()
      const emailLogId = String(params.get('email') || '').trim()
      if (category) state.contact.systemForm.category = category
      if (priority) state.contact.systemForm.priority = priority
      if (['sent', 'failed', 'draft'].includes(activity)) state.contact.emailLogTab = activity
      if (emailLogId) state.contact.emailLogDetailId = emailLogId
      const tab = state.contact.emailLogTab || 'sent'
      const logState = emailLogState(tab)
            if (!logState.loaded && tab !== 'draft') {
        logState.loading = true
        const result = await listAdminEmailLogs({ mode: tab, limitCount: 10, search: state.contact.emailLogSearch || '' }).catch((error) => ({ error, items: [], nextCursor: '', hasMore: false }))
        if (result.error) logState.error = result.error?.message || 'Email activity could not be loaded.'
        logState.items = result.items || []
        logState.cursor = result.nextCursor || ''
        logState.hasMore = result.hasMore === true
        logState.loaded = true
        logState.loading = false
      } else if (tab === 'draft') {
        state.contact.emailLogs.draft.loaded = true
      }

      if (contactMode() === 'call') {
        startActiveSupportCallWatch()
      }

      if (contactMode() === 'support') {
        await startSupportThreadsWatch()
        startSupportFormsWatch()
      }
    },
    settings: async () => {
      const [result, emailStatus, resonaStats] = await Promise.all([
        getAdminSettings(),
        getEmailAdminStatus().catch((error) => ({ ok: false, providerConfigured: false, recent: [], error: error?.message || 'Email status unavailable.' })),
        getResonaAiStats().catch((error) => ({ ok: false, stats: null, error: error?.message || 'Resona stats unavailable.' }))
      ])
      state.settings.data = result.settings || {}
      state.settings.updatedAt = result.updatedAt || null
      state.settings.updatedBy = result.updatedBy || ''
      state.settings.emailStatus = emailStatus
      state.settings.resonaStats = resonaStats?.stats || null
    },
    operations: async () => {
      const [banner, beta, pricing, studioLibrary] = await Promise.all([
        getBannerAlertSettings(),
        getPrivateBetaSettings(),
        getMarketplacePricingSettings(),
        operationsMode() === 'studio' ? getDefaultLibraryContent() : Promise.resolve(state.operations.studio.library)
      ])
      state.operations.banner = banner || {}
      state.operations.beta = beta || {}
      state.operations.pricing = pricing || {}
      state.operations.studio.library = studioLibrary || null
      if (studioLibrary?.folders?.length) {
        const studio = state.operations.studio
        studio.selectedFolderId = findFolderById(studioLibrary.folders, studio.selectedFolderId)?.id || studioLibrary.folders[0].id
        if (!studio.expandedFolderIds.size) studio.expandedFolderIds = new Set(studioLibrary.folders.map((folder) => folder.id))
      }
    }
  }
  if (!map[sectionKey]) return
  const data = sectionKey === 'settings' ? state.settings : sectionKey === 'contact' ? state.contact : sectionKey === 'operations' ? state.operations : adminData(sectionKey)
  if (!canLoadAdminSection(sectionKey)) return
  if (append && data.loadingMore) return
  if (append && !data.hasMore) return
  if (append) {
    data.loadingMore = true
  } else {
    data.loading = !silent
    if ('cursor' in data) data.cursor = ''
    if ('hasMore' in data) data.hasMore = false
  }
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
    data.loadingMore = false
    render()
  }
}

async function loadEmailLogs(tab = state.contact.emailLogTab || 'sent', { append = false, silent = false } = {}) {
  const cleanTab = ['sent', 'failed', 'draft'].includes(tab) ? tab : 'sent'
  const data = emailLogState(cleanTab)
  if (append && (data.loadingMore || !data.hasMore)) return
  if (cleanTab === 'draft') {
    state.contact.emailLogs.draft = { ...data, items: [], loading: false, loadingMore: false, loaded: true, error: '', cursor: '', hasMore: false }
    render()
    return
  }
  if (append) {
    data.loadingMore = true
  } else {
    data.loading = !silent
    data.cursor = ''
    data.hasMore = false
    state.contact.emailLogDetailId = ''
  }
  data.error = ''
  render()
  try {
    const result = await listAdminEmailLogs({ mode: cleanTab, limitCount: 10, cursor: append ? data.cursor : '', search: state.contact.emailLogSearch || '' })
    data.items = append ? mergePageItems(data.items, result.items || []) : (result.items || [])
    data.cursor = result.nextCursor || ''
    data.hasMore = result.hasMore === true
    data.loaded = true
  } catch (error) {
    console.warn('[admin] email logs load failed', { tab: cleanTab, code: error?.code, message: error?.message, details: error?.details })
    data.error = error?.message || 'Email activity could not be loaded.'
  } finally {
    data.loading = false
    data.loadingMore = false
    render()
  }
}

function canLoadAdminSection(sectionKey = '') {
  if (sectionKey === 'products') return can('listingEdit') || can('productReview')
  if (sectionKey === 'users') return can('userRead') || can('roleManage')
  if (sectionKey === 'reports') return can('admin') || can('userModerate') || can('productReview') || can('orderSupport')
  if (sectionKey === 'community') return can('userModerate') || can('admin')
  if (sectionKey === 'orders') return can('orderSupport')
  if (sectionKey === 'team') return can('roleManage')
  if (sectionKey === 'logs') return can('auditRead')
  if (sectionKey === 'contact') return can('emailSend')
  if (sectionKey === 'tools') return can('admin') || can('userRead') || can('emailSend') || can('auditRead')
  if (sectionKey === 'operations') return can('admin')
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

function openProductModerationDialog(productId = '', action = '') {
  state.productModerationDialog = { open: true, productId, action, submitting: false, error: '' }
  render()
  app.querySelector('[data-product-moderation-reason]')?.focus()
}

function closeProductModerationDialog() {
  if (state.productModerationDialog.submitting) return
  state.productModerationDialog = { open: false, productId: '', action: '', submitting: false, error: '' }
  render()
}

async function submitProductModeration(form) {
  const dialog = state.productModerationDialog
  const reason = form.querySelector('[data-product-moderation-reason]')?.value || ''
  const confirmation = form.querySelector('[data-product-moderation-confirmation]')?.value || ''
  if (dialog.action === 'remove' && confirmation !== 'REMOVE') {
    state.productModerationDialog.error = 'Type REMOVE exactly to confirm.'
    render()
    return
  }
  state.productModerationDialog.submitting = true
  state.productModerationDialog.error = ''
  render()
  try {
    const input = { productId: dialog.productId, reason, confirmation }
    const result = dialog.action === 'hide'
      ? await adminHideProduct(input)
      : dialog.action === 'unhide'
        ? await adminUnhideProduct(input)
        : await adminRemoveProduct(input)
    state.products = state.products.map((product) => product.id === dialog.productId ? { ...product, ...result } : product)
    if (state.reviewedProduct?.id === dialog.productId) state.reviewedProduct = { ...state.reviewedProduct, ...result }
    state.message = `${humanLabel(dialog.action)} product action completed.`
    state.productModerationDialog = { open: false, productId: '', action: '', submitting: false, error: '' }
  } catch (error) {
    state.productModerationDialog.submitting = false
    state.productModerationDialog.error = error?.message || 'Could not update this product.'
  }
  render()
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

function operationsFormValues(form) {
  const values = {}
  Array.from(form.elements || []).forEach((input) => {
    const name = input.name || ''
    if (!name || input.type === 'file' || input.type === 'submit' || input.type === 'button') return
    const value = input.type === 'checkbox' ? input.checked === true : input.value
    if (name.includes('.')) {
      const [parent, child] = name.split('.')
      values[parent] = { ...(values[parent] || {}), [child]: value }
      return
    }
    values[name] = value
  })
  return values
}

async function submitOperationsForm(form) {
  if (!can('admin') || state.operations.saving) return
  const mode = form.getAttribute('data-operations-form') || ''
  state.operations.saving = mode
  state.operations.error = ''
  state.operations.message = ''
  if (mode === 'agreement') {
    state.operations.agreement = { ...state.operations.agreement, uploading: true, error: '', message: '' }
  }
  render()
  try {
    if (mode === 'banner') {
      const result = await updateBannerAlertSettings(operationsFormValues(form))
      state.operations.banner = result
      state.operations.message = 'Banner alert settings saved.'
    } else if (mode === 'beta') {
      const result = await updatePrivateBetaSettings(operationsFormValues(form))
      state.operations.beta = result
      state.operations.message = 'Private beta settings saved.'
    } else if (mode === 'pricing') {
      const result = await updateMarketplacePricingSettings(operationsFormValues(form))
      state.operations.pricing = result
      state.operations.message = 'Marketplace pricing settings saved.'
    } else if (mode === 'agreement') {
      const agreementId = String(form.elements.agreementId?.value || 'marketplace-product-seller-agreement').trim() || 'marketplace-product-seller-agreement'
      const version = String(form.elements.version?.value || '').trim()
      const file = form.elements.agreementFile?.files?.[0] || null
      const uploadResult = await uploadSellerAgreementMarkdown({ file, version, agreementId })
      state.operations.agreement = {
        agreementId: uploadResult.agreementId,
        version: uploadResult.version,
        storagePath: uploadResult.storagePath,
        uploading: false,
        message: `Seller agreement uploaded to ${uploadResult.storagePath}.`,
        error: ''
      }
      state.operations.message = 'Seller agreement uploaded.'
    }
    state.operations.loaded = true
  } catch (error) {
    console.warn('[admin] operations update failed', { mode, code: error?.code, message: error?.message, details: error?.details })
    const message = error?.message || 'Could not save operations settings.'
    if (mode === 'agreement') state.operations.agreement = { ...state.operations.agreement, uploading: false, error: message, message: '' }
    else state.operations.error = message
  } finally {
    state.operations.saving = ''
    if (mode === 'agreement') state.operations.agreement = { ...state.operations.agreement, uploading: false }
    render()
  }
}

async function initializeAdminStudioLibrary() {
  const studio = state.operations.studio
  if (!can('admin') || studio.initializing) return
  studio.initializing = true
  studio.error = ''
  studio.message = ''
  render()
  try {
    studio.library = await initializeDefaultLibraryContent()
    const roots = studio.library?.folders || []
    studio.selectedFolderId = findFolderById(roots, studio.selectedFolderId)?.id || roots[0]?.id || ''
    studio.expandedFolderIds = new Set(roots.map((folder) => folder.id))
    studio.message = 'Default DAW library folders were initialized without removing existing instruments.'
  } catch (error) {
    console.warn('[admin] Studio library initialization failed', { code: error?.code, message: error?.message })
    studio.error = error?.message || 'Could not initialize the default DAW library.'
  } finally {
    studio.initializing = false
    render()
  }
}

function updateInstrumentFolderPaths(instruments = [], oldPath = '', newPath = '') {
  return instruments.map((instrument) => {
    if (instrument.folderPath !== oldPath && !instrument.folderPath.startsWith(`${oldPath}/`)) return instrument
    return { ...instrument, folderPath: `${newPath}${instrument.folderPath.slice(oldPath.length)}` }
  })
}

function openAdminStudioFolderPicker({ mode = '', targetId = '', selectedId = '', engineOnly = false, title = 'Choose folder' } = {}) {
  const studio = state.operations.studio
  studio.folderPicker = { open: true, mode, targetId, selectedId, engineOnly, title }
  studio.error = ''
  render()
}

function closeAdminStudioFolderPicker() {
  state.operations.studio.folderPicker = {
    open: false,
    mode: '',
    targetId: '',
    selectedId: '',
    engineOnly: false,
    title: ''
  }
  render()
}

async function confirmAdminStudioFolderPicker() {
  const studio = state.operations.studio
  const picker = studio.folderPicker
  const destination = findFolderById(studio.library?.folders || [], picker?.selectedId)
  if (!picker?.open || !destination || !isAdminStudioPickerDestinationAllowed(destination, picker, studio.library)) return
  if (picker.mode === 'instrument-form') {
    const previousEngineType = studio.form?.engineType || ''
    const nextEngineType = destination.engineType || previousEngineType || 'sample-based'
    studio.form = {
      ...studio.form,
      destinationFolderId: destination.id,
      folderPath: destination.path,
      engineType: nextEngineType
    }
    if (previousEngineType && previousEngineType !== nextEngineType) {
      studio.zipFile = null
      studio.parsedSamples = []
      studio.htmlSourceFile = null
    }
    studio.folderPicker.open = false
    studio.message = `${destination.path} selected as the instrument destination.`
    render()
    return
  }
  studio.saving = true
  studio.error = ''
  studio.message = ''
  render()
  try {
    if (picker.mode === 'move-folder') {
      const result = moveLibraryFolderToParent(studio.library.folders, picker.targetId, destination.id)
      const instruments = updateInstrumentFolderPaths(studio.library.instruments, result.oldPath, result.newPath)
      studio.library = await saveDefaultLibraryContent({ ...studio.library, folders: result.folders, instruments })
      studio.selectedFolderId = picker.targetId
      studio.expandedFolderIds.add(destination.id)
      studio.message = `Folder moved to ${destination.path}. Instrument library locations were updated; existing Storage paths were preserved.`
    } else if (picker.mode === 'move-instrument') {
      const instrument = studio.library.instruments?.find((item) => item.id === picker.targetId)
      if (!instrument) throw new Error('Instrument was not found.')
      const sourceRoot = STUDIO_LIBRARY_SOURCE_ROOTS.find((root) => destination.path === root.label || destination.path.startsWith(`${root.label}/`))?.id || instrument.sourceRoot
      await updateDefaultInstrument(instrument.id, {
        ...instrument,
        folderPath: destination.path,
        sourceRoot
      })
      studio.library = await getDefaultLibraryContent()
      studio.selectedFolderId = destination.id
      studio.selectedInstrumentId = instrument.id
      studio.message = `${instrument.name} moved to ${destination.path}. Existing sample and Storage paths were preserved.`
    }
    studio.folderPicker.open = false
  } catch (error) {
    studio.error = error?.message || 'Could not complete the move.'
  } finally {
    studio.saving = false
    render()
  }
}

async function saveAdminStudioFolderEdit(form) {
  const studio = state.operations.studio
  if (!can('admin') || studio.saving || !studio.library) return
  const values = operationsFormValues(form)
  const folder = findFolderById(studio.library.folders, values.folderId)
  if (!folder) return
  const exactFolderInstruments = getInstrumentsForFolder(studio.library, folder.path)
  studio.saving = true
  studio.error = ''
  studio.message = ''
  render()
  try {
    const nextType = values.type || folder.type
    const nextEngineType = values.engineType || folder.engineType || ''
    if (exactFolderInstruments.length && nextType !== 'engine-folder') {
      throw new Error('Move instruments out of this folder before changing it to a non-engine folder.')
    }
    if (exactFolderInstruments.length && folder.engineType && nextEngineType !== folder.engineType) {
      throw new Error(`Move instruments out of this folder before changing its engine type from ${folder.engineType}.`)
    }
    const renameResult = values.label !== folder.label
      ? renameLibraryFolder(studio.library.folders, folder.id, values.label)
      : { folders: studio.library.folders, oldPath: folder.path, newPath: folder.path }
    const folders = updateLibraryFolder(renameResult.folders, folder.id, {
      type: values.type,
      engineType: values.engineType
    })
    const previousInstruments = studio.library.instruments || []
    const instruments = updateInstrumentFolderPaths(previousInstruments, renameResult.oldPath, renameResult.newPath)
    const affected = instruments.filter((item, index) => item.folderPath !== previousInstruments[index]?.folderPath).length
    studio.library = await saveDefaultLibraryContent({ ...studio.library, folders, instruments })
    studio.message = `Folder saved${renameResult.oldPath !== renameResult.newPath ? `. Manifest paths were updated from ${renameResult.oldPath} to ${renameResult.newPath}; existing Storage objects were not moved.` : '.'}${affected ? ` ${affected} instrument path${affected === 1 ? '' : 's'} changed.` : ''}`
  } catch (error) {
    studio.error = error?.message || 'Could not save the folder.'
  } finally {
    studio.saving = false
    render()
  }
}

async function addAdminStudioFolder(form) {
  const studio = state.operations.studio
  if (!can('admin') || studio.saving || !studio.library) return
  const values = operationsFormValues(form)
  studio.saving = true
  studio.error = ''
  render()
  try {
    const folders = addLibraryFolder(studio.library.folders, values.parentId, {
      label: values.label,
      type: values.type,
      engineType: values.engineType
    })
    studio.library = await saveDefaultLibraryContent({ ...studio.library, folders })
    const created = flattenLibraryFolders(studio.library.folders).find((folder) => folder.path === `${findFolderById(studio.library.folders, values.parentId)?.path}/${String(values.label || '').trim().replaceAll('/', '-')}`)
    if (created) studio.selectedFolderId = created.id
    studio.expandedFolderIds.add(values.parentId)
    studio.addFolderOpen = false
    studio.message = `${values.label} was added.`
  } catch (error) {
    studio.error = error?.message || 'Could not add the folder.'
  } finally {
    studio.saving = false
    render()
  }
}

async function moveAdminStudioFolder(direction) {
  const studio = state.operations.studio
  if (!can('admin') || studio.saving || !studio.library || !studio.selectedFolderId) return
  studio.saving = true
  studio.error = ''
  render()
  try {
    const folders = moveLibraryFolder(studio.library.folders, studio.selectedFolderId, direction)
    studio.library = await saveDefaultLibraryContent({ ...studio.library, folders })
    studio.message = `Folder moved ${direction < 0 ? 'up' : 'down'}.`
  } catch (error) {
    studio.error = error?.message || 'Could not reorder the folder.'
  } finally {
    studio.saving = false
    render()
  }
}

async function deleteAdminStudioFolder() {
  const studio = state.operations.studio
  const folder = findFolderById(studio.library?.folders || [], studio.selectedFolderId)
  if (!can('admin') || studio.saving || !folder || folder.type === 'source-root') return
  if (folder.children?.length) {
    studio.error = 'This folder contains child folders. Move or delete them before deleting this folder.'
    render()
    return
  }
  const affected = (studio.library.instruments || []).filter((instrument) => instrument.folderPath === folder.path || instrument.folderPath.startsWith(`${folder.path}/`))
  if (affected.length) {
    studio.error = `Move ${affected.length} instrument${affected.length === 1 ? '' : 's'} out of this folder before deleting it.`
    render()
    return
  }
  if (!window.confirm(`Delete the empty folder "${folder.label}"?`)) return
  studio.saving = true
  studio.error = ''
  render()
  try {
    const flat = flattenLibraryFolders(studio.library.folders)
    const parent = flat.find((item) => (item.children || []).some((child) => child.id === folder.id))
    const folders = deleteLibraryFolder(studio.library.folders, folder.id)
    studio.library = await saveDefaultLibraryContent({ ...studio.library, folders })
    studio.selectedFolderId = parent?.id || folders[0]?.id || ''
    studio.message = `${folder.label} was deleted.`
  } catch (error) {
    studio.error = error?.message || 'Could not delete the folder.'
  } finally {
    studio.saving = false
    render()
  }
}

async function toggleAdminStudioInstrument(instrumentId = '') {
  const studio = state.operations.studio
  const instrument = studio.library?.instruments?.find((item) => item.id === instrumentId)
  if (!can('admin') || studio.saving || !instrument) return
  studio.saving = true
  studio.error = ''
  render()
  try {
    await updateDefaultInstrument(instrument.id, { ...instrument, enabled: instrument.enabled === false })
    studio.library = await getDefaultLibraryContent()
    studio.selectedInstrumentId = instrument.id
    studio.message = `${instrument.name} is now ${instrument.enabled === false ? 'enabled' : 'disabled'}.`
  } catch (error) {
    studio.error = error?.message || 'Could not update the instrument.'
  } finally {
    studio.saving = false
    render()
  }
}

async function removeAdminStudioInstrument(instrumentId = '') {
  const studio = state.operations.studio
  const instrument = studio.library?.instruments?.find((item) => item.id === instrumentId)
  if (!can('admin') || studio.saving || !instrument) return
  if (!window.confirm(`Remove "${instrument.name}" from the default library manifest? Storage files will not be deleted.`)) return
  studio.saving = true
  studio.error = ''
  render()
  try {
    await removeDefaultInstrumentFromLibrary(instrument.id)
    studio.library = await getDefaultLibraryContent()
    studio.selectedInstrumentId = ''
    if (studio.editingId === instrument.id) {
      studio.editingId = ''
      studio.form = defaultStudioInstrumentForm()
      studio.parsedSamples = []
      studio.zipFile = null
      studio.htmlSourceFile = null
      studio.artworkFile = null
      studio.samplePlaybackModeTouched = false
      studio.progress = 0
    }
    studio.message = `${instrument.name} was removed from the manifest. Storage files were preserved.`
  } catch (error) {
    studio.error = error?.message || 'Could not remove the instrument reference.'
  } finally {
    studio.saving = false
    render()
  }
}

async function parseAdminStudioArchive(file) {
  const studio = state.operations.studio
  studio.zipFile = file || null
  studio.parsedSamples = []
  studio.error = ''
  if (!file) {
    render()
    return
  }
  studio.parsing = true
  render()
  try {
    studio.parsedSamples = await parseDefaultInstrumentArchive(file)
    if (!studio.parsedSamples.length) {
      studio.error = 'No valid note+octave WAV files were found in this ZIP.'
    }
  } catch (error) {
    console.warn('[admin] Studio instrument ZIP parse failed', { name: error?.name, message: error?.message })
    studio.error = error?.message || 'The ZIP archive could not be read.'
  } finally {
    studio.parsing = false
    render()
  }
}

function setAdminStudioEditInstrument(instrumentId = '') {
  const studio = state.operations.studio
  const instrument = studio.library?.instruments?.find((item) => item.id === instrumentId)
  if (!instrument) return
  studio.editingId = instrument.id
  studio.form = {
    name: instrument.name,
    id: instrument.id,
    destinationFolderId: findFolderByPath(studio.library?.folders || [], instrument.folderPath)?.id || '',
    folderPath: instrument.folderPath,
    engineType: instrument.engineType,
    description: instrument.description,
    sampleStrategy: instrument.sampleStrategy,
    samplePlaybackMode: instrument.samplePlaybackMode || defaultSamplePlaybackMode(instrument.sampleStrategy),
    runtime: instrument.runtime || '',
    htmlSourcePath: instrument.htmlSourcePath || '',
    version: instrument.version,
    licenseType: instrument.license?.type || 'owned',
    sourceName: instrument.license?.sourceName || '',
    sourceUrl: instrument.license?.sourceUrl || '',
    licenseUrl: instrument.license?.licenseUrl || '',
    attributionRequired: instrument.license?.attributionRequired === true,
    commercialAllowed: instrument.license?.commercialAllowed !== false,
    enabled: instrument.enabled !== false,
    visibility: instrument.visibility || 'public',
    overwrite: true
  }
  studio.parsedSamples = []
  studio.zipFile = null
  studio.htmlSourceFile = null
  studio.artworkFile = null
  studio.samplePlaybackModeTouched = true
  studio.error = ''
  studio.message = ''
  render()
  requestAnimationFrame(() => app.querySelector('[data-studio-library-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
}

function resetAdminStudioInstrumentForm() {
  const studio = state.operations.studio
  studio.editingId = ''
  studio.form = defaultStudioInstrumentForm()
  studio.parsedSamples = []
  studio.zipFile = null
  studio.htmlSourceFile = null
  studio.artworkFile = null
  studio.samplePlaybackModeTouched = false
  studio.progress = 0
  studio.error = ''
  render()
}

function updateAdminStudioProgress(progress) {
  const studio = state.operations.studio
  studio.progress = Math.max(0, Math.min(1, Number(progress) || 0))
  const bar = app.querySelector('.admin-studio-upload-progress span')
  const label = app.querySelector('.admin-studio-upload-progress strong')
  if (bar) bar.style.width = `${Math.round(studio.progress * 100)}%`
  if (label) label.textContent = `${Math.round(studio.progress * 100)}%`
}

async function submitAdminStudioInstrument(form) {
  const studio = state.operations.studio
  if (!can('admin') || studio.saving || studio.parsing) return
  const values = operationsFormValues(form)
  const id = studioLibrarySlug(values.id || values.name)
  const destination = findFolderById(studio.library?.folders || [], values.destinationFolderId)
  const folderPath = destination?.path || ''
  const engineType = STUDIO_LIBRARY_ENGINE_TYPES.some((engine) => engine.id === values.engineType)
    ? values.engineType
    : destination?.engineType || 'sample-based'
  const sourceRoot = STUDIO_LIBRARY_SOURCE_ROOTS.find((root) => folderPath === root.label || folderPath.startsWith(`${root.label}/`))?.id || 'melogic-records'
  const version = Math.max(1, Math.round(Number(values.version) || 1))
  const existing = studio.library?.instruments?.find((item) => item.id === (studio.editingId || id))
  const proposedStorageBasePath = `${STUDIO_LIBRARY_STORAGE_ROOT}/${folderPath}/${id}/v${version}`
  const replacingEngineSource = Boolean(studio.parsedSamples.length || studio.htmlSourceFile)
  const storageBasePath = existing && !replacingEngineSource
    ? existing.storageBasePath || proposedStorageBasePath
    : proposedStorageBasePath
  const samplesPath = existing && engineType === 'sample-based' && !studio.parsedSamples.length
    ? existing.samplesPath || `${storageBasePath}/samples`
    : `${storageBasePath}/samples`
  studio.saving = true
  studio.progress = 0
  studio.error = ''
  studio.message = ''
  render()
  try {
    if (!values.name || !id) throw new Error('Instrument name and ID are required.')
    if (!studio.library) throw new Error('Initialize the default DAW library before adding instruments.')
    if (!destination || !destination.path || destination.path.includes('..')) throw new Error('Choose a valid library destination folder.')
    if (!engineType) throw new Error('Choose an instrument engine type.')
    if (existing?.engineType && existing.engineType !== engineType && !replacingEngineSource) throw new Error('Changing engine type requires a compatible replacement engine source.')
    if (!existing && engineType === 'sample-based' && !studio.parsedSamples.length) throw new Error('A new sample-based instrument requires a ZIP with at least one valid WAV sample.')
    const sampleRows = engineType === 'sample-based' && studio.parsedSamples.length
      ? buildSamplesFromFiles(studio.parsedSamples, samplesPath)
      : []
    if (engineType === 'vst' && !studio.htmlSourceFile && !existing?.htmlSourcePath) throw new Error('A VST instrument requires an HTML source file.')
    if (studio.htmlSourceFile) {
      const sourceName = String(studio.htmlSourceFile.name || '').toLowerCase()
      if (!sourceName.endsWith('.html') || (studio.htmlSourceFile.type && studio.htmlSourceFile.type !== 'text/html')) throw new Error('VST source must be an HTML file.')
      if (studio.htmlSourceFile.size > 5 * 1024 * 1024) throw new Error('HTML instrument source must be 5 MB or smaller.')
    }
    const totalUploads = sampleRows.length + (studio.htmlSourceFile ? 1 : 0) + (studio.artworkFile ? 1 : 0)
    for (let index = 0; index < sampleRows.length; index += 1) {
      const row = sampleRows[index]
      await uploadDefaultInstrumentSample(row.file, row.path, (fileProgress) => {
        updateAdminStudioProgress(totalUploads ? (index + fileProgress) / totalUploads : 0)
      })
    }
    let htmlSourcePath = engineType === 'vst' ? (existing?.htmlSourcePath || `${storageBasePath}/plugin.html`) : ''
    if (engineType === 'vst' && studio.htmlSourceFile) {
      htmlSourcePath = `${storageBasePath}/plugin.html`
      await uploadDefaultInstrumentHtmlSource(studio.htmlSourceFile, htmlSourcePath, (fileProgress) => {
        updateAdminStudioProgress(totalUploads ? (sampleRows.length + fileProgress) / totalUploads : 0)
      })
    }
    let artworkPath = existing?.artworkPath || ''
    if (studio.artworkFile) {
      if (studio.artworkFile.type && studio.artworkFile.type !== 'image/webp') throw new Error('Artwork must be a WebP image.')
      artworkPath = `${storageBasePath}/artwork/cover.webp`
      await uploadDefaultInstrumentArtwork(studio.artworkFile, artworkPath, (fileProgress) => {
        updateAdminStudioProgress(totalUploads ? (sampleRows.length + (studio.htmlSourceFile ? 1 : 0) + fileProgress) / totalUploads : 0)
      })
    }
    const payload = {
      ...(existing || {}),
      id,
      name: values.name,
      sourceRoot,
      engineType,
      folderPath,
      description: values.description || '',
      sampleStrategy: engineType === 'sample-based' ? values.sampleStrategy || 'custom' : '',
      samplePlaybackMode: engineType === 'sample-based'
        ? (values.samplePlaybackMode === 'exact-position' ? 'exact-position' : 'pitch-modified')
        : '',
      version,
      enabled: values.enabled === true,
      visibility: values.visibility === 'private' ? 'private' : 'public',
      storageBasePath,
      samplesPath: engineType === 'sample-based' ? samplesPath : '',
      artworkPath,
      samples: engineType === 'sample-based' && sampleRows.length
        ? sampleRows.map(({ file, ...sample }) => sample)
        : engineType === 'sample-based' ? (existing?.samples || []) : [],
      runtime: engineType === 'vst' ? 'html-audio-midi' : '',
      htmlSourcePath,
      acceptsMidi: engineType === 'vst',
      outputsAudio: engineType === 'vst',
      sandboxed: engineType === 'vst',
      license: {
        type: values.licenseType || 'owned',
        sourceName: values.sourceName || '',
        sourceUrl: values.sourceUrl || '',
        licenseUrl: values.licenseUrl || '',
        attributionRequired: values.attributionRequired === true,
        commercialAllowed: values.commercialAllowed === true
      }
    }
    const overwrite = values.overwrite === true || Boolean(studio.editingId)
    if (studio.editingId && studio.editingId === id && !sampleRows.length) {
      await updateDefaultInstrument(id, payload)
    } else {
      await addDefaultInstrumentToLibrary(payload, { overwrite })
    }
    updateAdminStudioProgress(1)
    studio.library = await getDefaultLibraryContent()
    studio.message = `${values.name} ${existing ? 'updated' : 'added'} in ${folderPath}.`
    studio.editingId = ''
    studio.form = defaultStudioInstrumentForm()
    studio.parsedSamples = []
    studio.zipFile = null
    studio.htmlSourceFile = null
    studio.artworkFile = null
    studio.samplePlaybackModeTouched = false
  } catch (error) {
    console.warn('[admin] Studio instrument save failed', { code: error?.code, message: error?.message })
    studio.error = error?.message || 'Could not save the default instrument.'
  } finally {
    studio.saving = false
    render()
  }
}

function updateEmailFormFromDom(form = app.querySelector('[data-admin-email-form]')) {
  if (!form) return
  const next = { ...(state.contact.emailForm || {}) }
  form.querySelectorAll('[data-admin-email-field]').forEach((input) => {
    const key = input.getAttribute('data-admin-email-field') || ''
    if (key) next[key] = input.value || ''
  })
  state.contact.emailForm = next
}

async function submitAdminEmailForm(form, { self = false } = {}) {
  if (!can('emailSend') || state.contact.emailSending) return
  updateEmailFormFromDom(form)
  const payload = {
    ...(state.contact.emailForm || {}),
    to: self ? (state.currentUser?.email || '') : (state.contact.emailForm?.to || '')
  }
  state.contact.emailSending = true
  state.contact.emailMessage = ''
  render()
  try {
    const result = await sendAdminEmail(payload)
    state.contact.emailMessage = `Sent email. Log ${result.emailLogId || ''}`.trim()
    state.contact.emailForm = { to: '', cc: '', replyTo: '', subject: '', body: '', category: 'support', templateType: 'support', ctaLabel: '', ctaUrl: '', relatedUid: '', relatedProductId: '', relatedOrderId: '', relatedReportId: '' }
    state.contact.emailStatus = await getEmailAdminStatus().catch(() => state.contact.emailStatus)
    state.settings.emailStatus = state.contact.emailStatus
    state.contact.emailLogs.sent.loaded = false
    if (state.contact.emailLogTab === 'sent') await loadEmailLogs('sent', { silent: true })
  } catch (error) {
    console.warn('[admin] email send failed', { code: error?.code, message: error?.message, details: error?.details })
    const safeCode = error?.details?.code || error?.code || ''
    const safeMessage = error?.details?.message || error?.message || 'Email could not be sent.'
    const internalMessage = String(safeMessage).toLowerCase() === 'internal'
      ? 'Email request failed before a clean response. Check Admin Email failures and Functions logs.'
      : safeMessage
    state.contact.emailMessage = `${internalMessage}${safeCode ? ` (${safeCode})` : ''} Check Admin Email failures/logs for details.`
  } finally {
    state.contact.emailSending = false
    render()
  }
}

function userForAdminEmail(uid = '') {
  const data = adminData('users')
  return data.profile || data.items.find((item) => item.uid === uid) || {}
}

function openAdminEmailComposerForUser(uid = '') {
  if (!can('emailSend')) return
  const user = userForAdminEmail(uid)
  if (!user?.email) {
    state.error = 'This user does not have an email address available.'
    render()
    return
  }
  state.contact.emailForm = {
    to: user.email || '',
    cc: '',
    replyTo: '',
    subject: '',
    body: '',
    category: 'account',
    relatedUid: uid,
    relatedProductId: '',
    relatedOrderId: '',
    relatedReportId: ''
  }
  state.contact.emailMessage = ''
  state.message = 'Email composer prefilled for this account.'
  state.error = ''
  const target = `${ROUTES.adminContact}?mode=email&user=${encodeURIComponent(uid)}`
  if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState({}, '', target)
  state.section = 'contact'
  render()
  loadAdminSectionData('contact', { silent: true })
}

async function submitAdminUserEmailAction(uid = '', type = '') {
  if (!can('emailSend') || !uid || !type) return
  const user = userForAdminEmail(uid)
  const subject = type === 'security_notice' ? window.prompt('Security notice subject', 'Melogic Records security notice') || '' : ''
  const body = type === 'security_notice' ? window.prompt('Security notice message', 'Please review your Melogic Records account security settings.') || '' : ''
  if (type === 'security_notice' && (!subject.trim() || !body.trim())) {
    state.error = 'Security notice subject and message are required.'
    render()
    return
  }
  state.adminData.users.actioning = 'email'
  state.error = ''
  state.message = ''
  render()
  try {
    await sendAdminAuthEmail({ uid, type, to: user?.email || '', subject, body })
    state.message = type === 'password_reset'
      ? 'Password reset email sent.'
      : type === 'email_verification'
        ? 'Verification email sent.'
        : 'Security notice sent.'
    const detailUid = adminUserDetailUid()
    if (detailUid) await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] admin user email action failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Account email could not be sent.'
  } finally {
    state.adminData.users.actioning = ''
    render()
  }
}

function adminActionBlockedMessage(error) {
  const code = error?.details?.code || error?.code || ''
  if (code === 'admin-email-not-verified') return 'Verify your email before performing admin actions. Open Account Security to continue.'
  if (code === 'admin-2fa-required') return 'Enable 2FA before performing admin actions. Open Account Security to continue.'
  return error?.message || 'Admin action failed.'
}

async function submitForcePasswordReset(uid = '') {
  if (!uid || !window.confirm('Force this user to reset their password?')) return
  state.adminData.users.actioning = 'force-reset'
  state.error = ''
  state.message = ''
  render()
  try {
    await forcePasswordReset({ uid })
    state.message = 'Force password reset email sent.'
    await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] force password reset failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = adminActionBlockedMessage(error)
  } finally {
    state.adminData.users.actioning = ''
    render()
  }
}

async function submitTemporaryPassword(uid = '') {
  if (!uid) return
  const confirmation = window.prompt('Type SET TEMPORARY PASSWORD to continue.')
  if (confirmation !== 'SET TEMPORARY PASSWORD') return
  const password = window.prompt('Optional: enter a temporary password, or leave blank to generate one.') || ''
  state.adminData.users.actioning = 'temp-password'
  state.error = ''
  state.message = ''
  render()
  try {
    const result = await setTemporaryPassword({ uid, password, confirmation })
    state.message = 'Temporary password set. The user must reset it after sign-in.'
    if (result.temporaryPassword) window.alert(`Temporary password shown once:\n\n${result.temporaryPassword}`)
    await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] temporary password failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = adminActionBlockedMessage(error)
  } finally {
    state.adminData.users.actioning = ''
    render()
  }
}

async function submitRevokeRecoveryCodes(uid = '') {
  if (!uid) return
  const confirmation = window.prompt('Type REVOKE CODES to invalidate all recovery codes.')
  if (confirmation !== 'REVOKE CODES') return
  state.adminData.users.actioning = 'revoke-codes'
  state.error = ''
  state.message = ''
  render()
  try {
    await revokeRecoveryCodes({ uid, confirmation })
    state.message = 'Recovery codes revoked.'
    await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] revoke recovery codes failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = adminActionBlockedMessage(error)
  } finally {
    state.adminData.users.actioning = ''
    render()
  }
}

async function submitAdminOrderRepair(orderId = '') {
  const data = adminData('orders')
  if (!orderId || data.repairing) return
  if (!window.confirm('Verify this order directly with Stripe and repair its trusted status, amount, entitlement, and account summary?')) return
  data.repairing = orderId
  state.error = ''
  state.message = ''
  render()
  try {
    const result = await repairAdminCheckoutOrder({ orderId })
    state.message = result.paymentStatus === 'paid'
      ? `Order repaired from Stripe: ${formatMoney(result.amountTotalCents, result.currency)} paid.`
      : `Order synced from Stripe: ${orderLifecycleLabel({
          orderState: result.checkoutStatus === 'expired' ? 'checkout_expired' : 'checkout_created',
          paymentStatus: result.paymentStatus
        })}.`
    await loadAdminSectionData('orders', { silent: true })
  } catch (error) {
    console.warn('[admin] Stripe order repair failed', {
      orderId,
      code: error?.code,
      message: error?.message,
      details: error?.details
    })
    state.error = adminActionBlockedMessage(error)
  } finally {
    data.repairing = ''
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

async function handleCommunityModerationAction(button) {
  const action = button.getAttribute('data-admin-community-action') || ''
  const postId = button.getAttribute('data-admin-community-post') || ''
  const commentId = button.getAttribute('data-admin-community-comment') || ''
  const communityId = button.getAttribute('data-admin-community-id') || ''
  if (!action) return
  if (action === 'delete-community') {
    const confirmed = window.confirm('Soft-delete this community? It will be hidden from public Community and marked deleted, but the document will remain for audit history.')
    if (!confirmed) return
  }
  const needsReason = !['pin-post', 'unpin-post', 'lock-post', 'unlock-post'].includes(action)
  const reason = needsReason ? window.prompt('Reason for this community moderation action') || '' : 'Community moderation update.'
  if (needsReason && !reason.trim()) {
    state.error = 'A reason is required for this community moderation action.'
    render()
    return
  }
  state.adminData.community.actioning = action
  state.error = ''
  state.message = ''
  render()
  try {
    if (action === 'hide-post') await hideCommunityPost({ postId, reason })
    else if (action === 'restore-post') await restoreCommunityPost({ postId, reason })
    else if (action === 'lock-post') await lockCommunityPostComments({ postId, locked: true, reason })
    else if (action === 'unlock-post') await lockCommunityPostComments({ postId, locked: false, reason })
    else if (action === 'pin-post') await pinCommunityPost({ postId, reason })
    else if (action === 'unpin-post') await unpinCommunityPost({ postId, reason })
    else if (action === 'hide-comment') await hideCommunityComment({ postId, commentId, reason })
    else if (action === 'restore-comment') await restoreCommunityComment({ postId, commentId, reason })
    else if (action === 'hide-community') await moderateCommunity({ communityId, action: 'hide', reason })
    else if (action === 'restore-community') await moderateCommunity({ communityId, action: 'restore', reason })
    else if (action === 'archive-community') await moderateCommunity({ communityId, action: 'archive', reason })
    else if (action === 'delete-community') await moderateCommunity({ communityId, action: 'delete', reason })
    state.message = 'Community moderation action saved.'
    await loadAdminSectionData('community', { silent: true })
  } catch (error) {
    console.warn('[admin] community moderation action failed', { action, code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not save community moderation action.'
  } finally {
    state.adminData.community.actioning = ''
    render()
  }
}

async function submitAdminCommunityCreate(form) {
  const data = state.adminData.community
  const formData = new FormData(form)
  const title = String(formData.get('title') || '').trim()
  const slug = adminCommunitySlug(formData.get('slug') || title)
  const description = String(formData.get('description') || '').trim()
  const rules = String(formData.get('rules') || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  const moderatorUids = String(formData.get('moderatorUids') || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  const profileImage = formData.get('profileImage') instanceof File ? formData.get('profileImage') : null
  const bannerImage = formData.get('bannerImage') instanceof File ? formData.get('bannerImage') : null
  if (!title || !slug || !description) {
    data.createError = 'Title, slug, and description are required.'
    render()
    return
  }
  data.createSaving = true
  data.createError = ''
  data.createMessage = ''
  render()
  try {
    let profileUpload = null
    let bannerUpload = null
    if (profileImage?.size) profileUpload = await uploadCommunityImage({ slug, kind: 'profile', file: profileImage })
    if (bannerImage?.size) bannerUpload = await uploadCommunityImage({ slug, kind: 'banner', file: bannerImage })
    await createCommunity({
      title,
      name: title,
      slug,
      description,
      rules,
      category: String(formData.get('category') || 'Creator Help'),
      postingMode: String(formData.get('postingMode') || 'open'),
      visibility: String(formData.get('visibility') || 'public'),
      status: String(formData.get('status') || 'active'),
      moderatorUids,
      imagePath: profileUpload?.storagePath || '',
      imageUrl: profileUpload?.downloadURL || '',
      bannerImagePath: bannerUpload?.storagePath || '',
      bannerImageUrl: bannerUpload?.downloadURL || ''
    })
    data.createSaving = false
    data.createMessage = 'Community created.'
    data.createOpen = false
    data.filter = 'communities'
    await loadAdminSectionData('community', { silent: true })
  } catch (error) {
    console.warn('[admin] community create failed', { code: error?.code, message: error?.message, details: error?.details })
    data.createSaving = false
    data.createError = error?.message || 'Could not create community.'
    render()
  }
}

async function submitAdminCommunityEdit(form) {
  const data = state.adminData.community
  const community = data.audit?.community || {}
  const communityId = adminCommunityDetailId() || community.communityId || ''
  if (!communityId) return
  const formData = new FormData(form)
  const title = String(formData.get('title') || '').trim()
  const slug = adminCommunitySlug(formData.get('slug') || title || community.slug || communityId)
  const description = String(formData.get('description') || '').trim()
  const rules = String(formData.get('rules') || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  const moderatorUids = String(formData.get('moderatorUids') || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  const pinnedPostIds = String(formData.get('pinnedPostIds') || '').split(/\r?\n/).map((row) => row.trim()).filter(Boolean)
  const profileImage = formData.get('profileImage') instanceof File ? formData.get('profileImage') : null
  const bannerImage = formData.get('bannerImage') instanceof File ? formData.get('bannerImage') : null
  if (!title || !slug) {
    state.error = 'Title and slug are required.'
    render()
    return
  }
  data.actioning = 'save-community'
  state.error = ''
  state.message = ''
  render()
  try {
    let profileUpload = null
    let bannerUpload = null
    if (profileImage?.size) profileUpload = await uploadCommunityImage({ slug, kind: 'profile', file: profileImage })
    if (bannerImage?.size) bannerUpload = await uploadCommunityImage({ slug, kind: 'banner', file: bannerImage })
    await moderateCommunity({
      communityId,
      action: 'update',
      title,
      name: title,
      slug,
      description,
      rules,
      visibility: String(formData.get('visibility') || community.visibility || 'public'),
      status: String(formData.get('status') || community.status || 'active'),
      moderatorUids,
      pinnedPostIds,
      imagePath: profileUpload?.storagePath || community.imagePath || community.iconPath || '',
      imageUrl: profileUpload?.downloadURL || community.imageUrl || community.imageURL || community.iconURL || '',
      bannerImagePath: bannerUpload?.storagePath || community.bannerImagePath || '',
      bannerImageUrl: bannerUpload?.downloadURL || community.bannerImageUrl || community.bannerURL || '',
      reason: 'Community metadata updated.'
    })
    state.message = 'Community changes saved.'
    await loadAdminSectionData('community', { silent: true })
  } catch (error) {
    console.warn('[admin] community edit failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Could not save community changes.'
  } finally {
    data.actioning = ''
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

function openProductGrantDialog(uid = '') {
  if (!uid || (!can('orderSupport') && !can('listingEdit'))) return
  state.productGrantDialog = {
    open: true,
    uid,
    search: '',
    products: [],
    selectedProductIds: [],
    searching: false,
    submitting: false,
    error: ''
  }
  state.error = ''
  state.message = ''
  render()
  app.querySelector('[data-product-grant-search-form] input[name="search"]')?.focus()
}

function closeProductGrantDialog() {
  if (state.productGrantDialog?.submitting) return
  state.productGrantDialog = {
    open: false,
    uid: '',
    search: '',
    products: [],
    selectedProductIds: [],
    searching: false,
    submitting: false,
    error: ''
  }
  render()
}

async function searchProductsForGrant(form) {
  const dialog = state.productGrantDialog
  if (!dialog?.open || dialog.searching || dialog.submitting) return
  const search = form.querySelector('input[name="search"]')?.value?.trim() || ''
  if (!search) {
    dialog.error = 'Enter a title, product ID, creator, or slug.'
    render()
    return
  }
  dialog.search = search
  dialog.searching = true
  dialog.error = ''
  render()
  try {
    const result = await searchAdminGrantProducts({ uid: dialog.uid, search })
    const selected = new Set(dialog.selectedProductIds || [])
    const retained = (dialog.products || []).filter((product) => selected.has(String(product.id || product.productId || '')))
    const merged = new Map(retained.map((product) => [String(product.id || product.productId || ''), product]))
    ;(result.products || []).forEach((product) => {
      const productId = String(product.id || product.productId || '')
      if (productId) merged.set(productId, product)
    })
    dialog.products = [...merged.values()]
  } catch (error) {
    console.warn('[admin] product grant search failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details
    })
    dialog.error = error?.message || 'Products could not be searched.'
  } finally {
    dialog.searching = false
    render()
  }
}

function toggleProductGrantSelection(productId = '', checked = false) {
  const dialog = state.productGrantDialog
  if (!dialog?.open || dialog.submitting || !productId) return
  const selected = new Set(dialog.selectedProductIds || [])
  if (checked) selected.add(productId)
  else selected.delete(productId)
  dialog.selectedProductIds = [...selected]
  render()
}

async function submitProductGrant() {
  const dialog = state.productGrantDialog
  if (!dialog?.open || dialog.submitting || !dialog.selectedProductIds?.length) return
  dialog.submitting = true
  dialog.error = ''
  render()
  try {
    const result = await grantAdminProducts({
      uid: dialog.uid,
      productIds: dialog.selectedProductIds
    })
    const counts = [
      `${result.grantedProductIds?.length || 0} granted`,
      `${result.repairedProductIds?.length || 0} repaired`,
      `${result.skippedProductIds?.length || 0} already owned`
    ]
    state.productGrantDialog = {
      open: false,
      uid: '',
      search: '',
      products: [],
      selectedProductIds: [],
      searching: false,
      submitting: false,
      error: ''
    }
    state.message = `Product access updated: ${counts.join(', ')}.`
    if (adminUserDetailUid()) await loadAdminSectionData('users', { silent: true })
  } catch (error) {
    console.warn('[admin] product grant failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details
    })
    dialog.error = adminActionBlockedMessage(error)
    dialog.submitting = false
  }
  render()
}

function prefillContactRecipient(uid = '') {
  const cleanUid = String(uid || '').trim()
  if (!cleanUid) return
  const user = userForAdminEmail(cleanUid)
  const label = user?.displayName || formatUsername(user?.username) || user?.email || cleanUid
  state.contact.systemForm = {
    ...(state.contact.systemForm || {}),
    recipientUid: cleanUid,
    recipientLabel: label
  }
}

function openAdminMessage(uid = '') {
  const targetUid = String(uid || '').trim()
  if (!targetUid) return
  prefillContactRecipient(targetUid)
  const target = `${ROUTES.adminContact}?mode=system&user=${encodeURIComponent(targetUid)}`
  if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState({}, '', target)
  state.section = 'contact'
  state.message = 'System message composer prefilled for this account.'
  state.error = ''
  render()
  loadAdminSectionData('contact', { silent: true })
}

function openAdminSecurityNotice(uid = '') {
  const targetUid = String(uid || '').trim()
  if (!targetUid) return
  prefillContactRecipient(targetUid)
  state.contact.systemForm = {
    ...(state.contact.systemForm || {}),
    category: 'security',
    priority: 'important',
    subject: 'Melogic Records security notice',
    body: ''
  }
  const target = `${ROUTES.adminContact}?mode=system&user=${encodeURIComponent(targetUid)}&category=security&priority=important`
  if (`${window.location.pathname}${window.location.search}` !== target) window.history.pushState({}, '', target)
  state.section = 'contact'
  state.message = 'Security notice composer prefilled for this account.'
  state.error = ''
  render()
  loadAdminSectionData('contact', { silent: true })
}

function updateSystemFormFromDom(form = app.querySelector('[data-admin-system-form]')) {
  if (!form) return
  const next = { ...(state.contact.systemForm || {}) }
  form.querySelectorAll('[data-admin-system-field]').forEach((input) => {
    const key = input.getAttribute('data-admin-system-field') || ''
    if (key) next[key] = input.value || ''
  })
  state.contact.systemForm = next
}

function resolveSystemRecipientUid(value = '') {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const lowered = raw.toLowerCase().replace(/^@/, '')
  const pools = [
    state.adminData.users.profile,
    ...(state.adminData.users.items || []),
    state.adminData.team.profile,
    ...(state.adminData.team.items || [])
  ].filter(Boolean)
  const match = pools.find((user) => {
    const candidates = [user.uid, user.username, user.usernameLower, user.displayName, user.email]
      .map((candidate) => String(candidate || '').trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean)
    return candidates.includes(lowered)
  })
  return match?.uid || raw
}

async function submitAdminSystemMessageForm(form) {
  if (!can('emailSend') || state.contact.systemSending) return
  updateSystemFormFromDom(form)
  const payload = {
    ...(state.contact.systemForm || {}),
    recipientUid: resolveSystemRecipientUid(state.contact.systemForm?.recipientUid || '')
  }
  state.contact.systemSending = true
  state.contact.systemMessage = ''
  render()
  try {
    const result = await sendAdminSystemMessage(payload)
    state.contact.systemMessage = `Sent system message. Notification ${result.notificationId || ''}`.trim()
    state.contact.systemForm = { recipientUid: '', recipientLabel: '', category: 'support', priority: 'normal', subject: '', body: '', actionLabel: '', actionUrl: '', internalNote: '' }
  } catch (error) {
    console.warn('[admin] system message failed', { code: error?.code, message: error?.message, details: error?.details })
    const safeCode = error?.details?.code || error?.code || ''
    const safeMessage = error?.details?.message || error?.message || 'System message could not be sent.'
    state.contact.systemMessage = `${safeMessage}${safeCode ? ` (${safeCode})` : ''}`
  } finally {
    state.contact.systemSending = false
    render()
  }
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

function resetAdminContactCallAudio() {
  adminContactCallAudioElements.forEach((element) => {
    try {
      element.pause()
      element.remove()
    } catch {
      // Ignore stale audio cleanup failures.
    }
  })
  adminContactCallAudioElements = []
}

function attachAdminContactRemoteAudio(track) {
  const element = track.attach()
  element.autoplay = true
  element.controls = true
  element.dataset.adminContactCallAudio = 'true'
  element.style.position = 'fixed'
  element.style.left = '-9999px'
  element.style.width = '1px'
  element.style.height = '1px'
  document.body.appendChild(element)
  adminContactCallAudioElements.push(element)

  element.play().catch((error) => {
    console.warn('[admin calls] remote audio autoplay blocked', error)
    state.contact.call.message = 'Remote caller joined. Click the page if browser audio is blocked.'
    render()
  })
}

function syncAdminContactCallParticipants(room) {
  const participants = Array.from(room?.remoteParticipants?.values?.() || []).map((participant) => ({
    identity: participant.identity,
    kind: participant.kind || 'remote'
  }))

  state.contact.call.participants = participants.length
  state.contact.call.remoteParticipants = participants
}

function mergeSupportForms(existing = [], incoming = []) {
  const map = new Map()
  existing.forEach((form) => {
    if (form?.id) map.set(form.id, form)
  })
  incoming.forEach((form) => {
    if (form?.id) map.set(form.id, form)
  })
  return Array.from(map.values())
}

async function loadSupportThreads({ silent = false } = {}) {
  const threadsState = state.contact.supportThreads
  threadsState.loading = !silent
  threadsState.error = ''
  if (!silent) render()

  try {
    const result = await listSupportThreads({
      status: threadsState.filter || 'active',
      limitCount: 75
    })
    threadsState.items = result.threads || []
    threadsState.loaded = true
    const requestedId = new URLSearchParams(window.location.search).get('thread') || ''
    if (requestedId && threadsState.items.some((thread) => thread.id === requestedId)) {
      await selectSupportThread(requestedId, { updateUrl: false, renderAfter: false })
    } else if (!threadsState.selectedId && threadsState.items[0]?.id) {
      await selectSupportThread(threadsState.items[0].id, { updateUrl: false, renderAfter: false })
    } else if (threadsState.selectedId && !threadsState.items.some((thread) => thread.id === threadsState.selectedId)) {
      await selectSupportThread(threadsState.items[0]?.id || '', { updateUrl: false, renderAfter: false })
    }
  } catch (error) {
    console.warn('[admin support threads] load failed', error)
    threadsState.error = error?.message || 'Could not load support threads.'
  } finally {
    threadsState.loading = false
    render()
  }
}

async function startSupportThreadsWatch() {
  const requestedFilter = new URLSearchParams(window.location.search).get('threadFilter') || ''
  if (['active', 'ai_active', 'waiting_for_agent', 'assigned', 'resolved', 'all'].includes(requestedFilter) && state.contact.supportThreads.filter !== requestedFilter) {
    state.contact.supportThreads.filter = requestedFilter
    state.contact.supportThreads.loaded = false
    state.contact.supportThreads.items = []
    state.contact.supportThreads.selectedId = ''
  }
  if (state.contact.supportThreads.loading || state.contact.supportThreads.loaded) return
  await loadSupportThreads({ silent: false })
}

async function selectSupportThread(threadId = '', { updateUrl = true, renderAfter = true } = {}) {
  const threadsState = state.contact.supportThreads
  threadsState.selectedId = threadId
  threadsState.messages = []
  threadsState.replyDraft = ''
  threadsState.message = ''
  if (updateUrl) {
    const params = new URLSearchParams(window.location.search)
    params.set('mode', 'support')
    if (threadId) params.set('thread', threadId)
    else params.delete('thread')
    params.set('threadFilter', threadsState.filter || 'active')
    window.history.replaceState({}, '', `${ROUTES.adminContact}?${params.toString()}`)
  }

  if (!threadId) {
    if (renderAfter) render()
    return
  }

  threadsState.messagesLoading = true
  if (renderAfter) render()
  try {
    threadsState.messages = await getSupportMessages(threadId)
  } catch (error) {
    console.warn('[admin support threads] messages failed', error)
    threadsState.error = error?.message || 'Could not load support messages.'
  } finally {
    threadsState.messagesLoading = false
    if (renderAfter) render()
  }
}

async function claimSelectedSupportThread(threadId = '') {
  if (!threadId) return
  const threadsState = state.contact.supportThreads
  threadsState.savingId = threadId
  threadsState.error = ''
  threadsState.message = ''
  render()
  try {
    await claimSupportThread({ threadId })
    threadsState.message = 'Support thread claimed.'
    await loadSupportThreads({ silent: true })
    await selectSupportThread(threadId, { renderAfter: false })
  } catch (error) {
    threadsState.error = error?.message || 'Could not claim support thread.'
  } finally {
    threadsState.savingId = ''
    render()
  }
}

async function resolveSelectedSupportThread(threadId = '') {
  if (!threadId) return
  const threadsState = state.contact.supportThreads
  threadsState.savingId = threadId
  threadsState.error = ''
  threadsState.message = ''
  render()
  try {
    await resolveSupportThread({ threadId })
    threadsState.message = 'Support thread resolved.'
    await loadSupportThreads({ silent: true })
    await selectSupportThread(threadId, { renderAfter: false })
  } catch (error) {
    threadsState.error = error?.message || 'Could not resolve support thread.'
  } finally {
    threadsState.savingId = ''
    render()
  }
}

async function replyToSupportThread(threadId = '') {
  const threadsState = state.contact.supportThreads
  const body = String(threadsState.replyDraft || '').trim()
  if (!threadId || !body) return
  threadsState.savingId = threadId
  threadsState.error = ''
  threadsState.message = ''
  render()
  try {
    await sendSupportMessage({ threadId, body, asAgent: true })
    threadsState.replyDraft = ''
    threadsState.message = 'Reply sent.'
    await loadSupportThreads({ silent: true })
    await selectSupportThread(threadId, { renderAfter: false })
  } catch (error) {
    threadsState.error = error?.message || 'Could not send support reply.'
  } finally {
    threadsState.savingId = ''
    render()
  }
}

async function loadSupportFormsPage({ append = false } = {}) {
  const formsState = state.contact.supportForms
  if (append && !formsState.hasMore) return

  if (append) formsState.loadingMore = true
  else formsState.loading = true
  formsState.error = ''
  render()

  try {
    const result = await listSupportFormsPage({
      statusGroup: formsState.filter || 'unresolved',
      limitCount: 25,
      cursor: append ? formsState.cursor : null
    })
    const forms = result.forms || []
    formsState.items = append ? mergeSupportForms(formsState.items || [], forms) : forms
    formsState.cursor = result.cursor || null
    formsState.hasMore = Boolean(result.hasMore)
    formsState.loaded = true
    const requestedId = new URLSearchParams(window.location.search).get('support') || ''
    if (!append && requestedId && formsState.items.some((form) => form.id === requestedId)) {
      formsState.selectedId = requestedId
    } else if (!formsState.selectedId && formsState.items[0]?.id) {
      formsState.selectedId = formsState.items[0].id
    } else if (formsState.selectedId && !formsState.items.some((form) => form.id === formsState.selectedId)) {
      formsState.selectedId = formsState.items[0]?.id || ''
    }
  } catch (error) {
    console.warn('[admin support forms] page load failed', { code: error?.code, message: error?.message, details: error?.details })
    formsState.error = error?.message || 'Could not load support forms.'
  } finally {
    formsState.loading = false
    formsState.loadingMore = false
    render()
  }
}

function startSupportFormsWatch() {
  const requestedFilter = new URLSearchParams(window.location.search).get('filter') || ''
  if (['unresolved', 'resolved', 'archived', 'all'].includes(requestedFilter) && state.contact.supportForms.filter !== requestedFilter) {
    state.contact.supportForms.filter = requestedFilter
    state.contact.supportForms.loaded = false
    state.contact.supportForms.cursor = null
    state.contact.supportForms.hasMore = false
    state.contact.supportForms.items = []
    state.contact.supportForms.selectedId = ''
  }
  if (state.contact.supportForms.loading || state.contact.supportForms.loaded) return
  loadSupportFormsPage({ append: false })
}

function stopSupportFormsWatch() {
  if (typeof unsubscribeSupportForms === 'function') {
    unsubscribeSupportForms()
  }
  unsubscribeSupportForms = null
}

function selectedSupportForm() {
  const selectedId = state.contact.supportForms.selectedId
  return (state.contact.supportForms.items || []).find((item) => item.id === selectedId)
    || state.contact.supportForms.items?.[0]
    || null
}

async function changeSupportFormStatus(formId = '', status = 'reviewing') {
  if (!formId) return

  state.contact.supportForms.savingId = formId
  state.contact.error = ''
  render()

  try {
    await updateSupportFormStatus(formId, status)
  } catch (error) {
    console.warn('[admin support forms] status update failed', error)
    state.contact.supportForms.error = error?.message || 'Could not update support form status.'
  } finally {
    state.contact.supportForms.savingId = ''
    render()
  }
}

async function saveSupportFormAdminNote(formId = '') {
  if (!formId) return

  const textarea = document.querySelector(`[data-support-form-note="${CSS.escape(formId)}"]`)
  const adminNote = textarea?.value || ''

  state.contact.supportForms.savingId = formId
  state.contact.supportForms.error = ''
  render()

  try {
    await updateSupportFormAdminNote(formId, adminNote)
  } catch (error) {
    console.warn('[admin support forms] note update failed', error)
    state.contact.supportForms.error = error?.message || 'Could not save admin note.'
  } finally {
    state.contact.supportForms.savingId = ''
    render()
  }
}

function startActiveSupportCallWatch() {
  if (unsubscribeActiveSupportCalls) return

  state.contact.call.activeCallsLoading = true
  state.contact.call.activeCallsError = ''
  render()

  unsubscribeActiveSupportCalls = watchActiveSupportCalls(
    (calls) => {
      state.contact.call.activeCalls = calls
      state.contact.call.activeCallsLoaded = true
      state.contact.call.activeCallsLoading = false
      state.contact.call.activeCallsError = ''
      render()
    },
    (error) => {
      state.contact.call.activeCallsLoading = false
      state.contact.call.activeCallsError = error?.message || 'Could not load active calls.'
      render()
    }
  )
}

function stopActiveSupportCallWatch() {
  if (typeof unsubscribeActiveSupportCalls === 'function') {
    unsubscribeActiveSupportCalls()
  }
  unsubscribeActiveSupportCalls = null
}

async function createManualSupportCallFromPanel() {
  if (state.contact.call.manualCallCreating) return

  const roomName = String(state.contact.call.roomName || 'melogic-phone-test').trim() || 'melogic-phone-test'
  const callerNumber = window.prompt('Optional caller phone number or label', 'Manual test caller') || ''

  state.contact.call.manualCallCreating = true
  state.contact.call.error = ''
  state.contact.call.message = 'Creating manual active call record...'
  render()

  try {
    const callId = await createManualSupportCall({
      roomName,
      callerNumber,
      notes: 'Created manually from Admin → Contact → Calls.'
    })

    state.contact.call.selectedCallId = callId
    state.contact.call.message = 'Manual active call record created.'
  } catch (error) {
    console.warn('[admin calls] manual call create failed', error)
    state.contact.call.error = error?.message || 'Could not create manual support call.'
  } finally {
    state.contact.call.manualCallCreating = false
    render()
  }
}

async function joinSupportCallFromPanel(callId = '') {
  const call = (state.contact.call.activeCalls || []).find((item) => item.id === callId)
  if (!call?.roomName) {
    state.contact.call.error = 'This call does not have a room name.'
    render()
    return
  }

  state.contact.call.selectedCallId = call.id

  try {
    await markSupportCallHumanJoined(call.id, state.currentUser?.uid || '')
  } catch (error) {
    console.warn('[admin calls] could not mark human joined before room join', error)
  }

  joinAdminContactCallRoom(call.roomName)
}

async function forceConnectSupportCall(callId = '') {
  const call = (state.contact.call.activeCalls || []).find((item) => item.id === callId)
  if (!call?.roomName) {
    state.contact.call.error = 'This call does not have a room name.'
    render()
    return
  }

  state.contact.call.selectedCallId = call.id
  state.contact.call.error = ''
  state.contact.call.message = 'Requesting human takeover...'
  render()

  try {
    await requestSupportCallTakeover(call.id, state.currentUser?.uid || '')
    await markSupportCallHumanJoined(call.id, state.currentUser?.uid || '')
    joinAdminContactCallRoom(call.roomName)
  } catch (error) {
    console.warn('[admin calls] force connect failed', error)
    state.contact.call.error = error?.message || 'Could not request takeover.'
    render()
  }
}

async function endSupportCallFromPanel(callId = '') {
  if (!callId) return
  if (!window.confirm('Mark this support call as ended?')) return

  try {
    await endSupportCall(callId)
    if (state.contact.call.selectedCallId === callId) state.contact.call.selectedCallId = ''
    state.contact.call.message = 'Support call marked ended.'
    render()
  } catch (error) {
    console.warn('[admin calls] end call failed', error)
    state.contact.call.error = error?.message || 'Could not end support call.'
    render()
  }
}

async function joinAdminContactCallRoom(roomName = 'melogic-phone-test') {
  if (adminContactCallRoom) {
    state.contact.call.error = 'Already connected to a call room. Leave the current room first.'
    render()
    return
  }

  const cleanRoomName = String(roomName || 'melogic-phone-test').trim() || 'melogic-phone-test'

  state.contact.call = {
    ...(state.contact.call || {}),
    roomName: cleanRoomName,
    status: 'connecting',
    message: 'Joining phone support room...',
    error: '',
    muted: false,
    participants: 0,
    localIdentity: '',
    remoteParticipants: []
  }
  render()

  try {
    const credentials = await createLiveKitCallToken({
      roomName: cleanRoomName,
      displayName: 'Melogic Admin Call Console',
      role: 'admin-call-console'
    })

    const room = new Room({
      adaptiveStream: true,
      dynacast: true
    })

    adminContactCallRoom = room

    room.on(RoomEvent.Connected, () => {
      state.contact.call.status = 'connected'
      state.contact.call.message = `Connected to ${room.name}.`
      state.contact.call.localIdentity = room.localParticipant?.identity || credentials.identity || ''
      syncAdminContactCallParticipants(room)
      render()
    })

    room.on(RoomEvent.Disconnected, (reason) => {
      resetAdminContactCallAudio()
      if (adminContactCallRoom === room) adminContactCallRoom = null
      state.contact.call.status = 'idle'
      state.contact.call.message = reason ? `Disconnected: ${reason}` : 'Left call room.'
      state.contact.call.localIdentity = ''
      state.contact.call.participants = 0
      state.contact.call.remoteParticipants = []
      render()
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      state.contact.call.message = `Participant connected: ${participant.identity || 'caller'}`
      syncAdminContactCallParticipants(room)
      render()
    })

    room.on(RoomEvent.ParticipantDisconnected, () => {
      syncAdminContactCallParticipants(room)
      state.contact.call.message = 'Participant left the room.'
      render()
    })

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === 'audio') {
        attachAdminContactRemoteAudio(track)
        state.contact.call.message = `Receiving audio from ${participant.identity || 'caller'}.`
        syncAdminContactCallParticipants(room)
        render()
      }
    })

    await room.connect(credentials.url, credentials.token)
    await room.localParticipant.setMicrophoneEnabled(true)

    state.contact.call.status = 'connected'
    state.contact.call.message = 'Microphone live. Waiting for caller.'
    state.contact.call.localIdentity = room.localParticipant.identity
    state.contact.call.muted = false
    syncAdminContactCallParticipants(room)
    render()
  } catch (error) {
    console.warn('[admin calls] join failed', error)
    resetAdminContactCallAudio()
    if (adminContactCallRoom) {
      try {
        adminContactCallRoom.disconnect()
      } catch {
        // Ignore disconnect cleanup failures.
      }
    }
    adminContactCallRoom = null
    state.contact.call.status = 'idle'
    state.contact.call.error = error?.message || 'Could not join LiveKit call room.'
    state.contact.call.message = ''
    render()
  }
}

async function toggleAdminContactCallMute() {
  if (!adminContactCallRoom) return

  const nextMuted = !state.contact.call.muted

  try {
    await adminContactCallRoom.localParticipant.setMicrophoneEnabled(!nextMuted)
    state.contact.call.muted = nextMuted
    state.contact.call.message = nextMuted ? 'Microphone muted.' : 'Microphone live.'
    render()
  } catch (error) {
    console.warn('[admin calls] mute toggle failed', error)
    state.contact.call.error = error?.message || 'Could not update microphone.'
    render()
  }
}

function leaveAdminContactCallRoom() {
  if (!adminContactCallRoom) {
    state.contact.call.status = 'idle'
    state.contact.call.message = 'No active call room.'
    render()
    return
  }

  try {
    adminContactCallRoom.disconnect()
  } catch {
    adminContactCallRoom = null
    resetAdminContactCallAudio()
    state.contact.call.status = 'idle'
    state.contact.call.message = 'Left call room.'
    state.contact.call.participants = 0
    state.contact.call.remoteParticipants = []
    render()
  }
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
  app.querySelectorAll('[data-admin-load-more]').forEach((button) => {
    button.addEventListener('click', () => {
      const collection = button.getAttribute('data-admin-load-more') || ''
      if (!collection) return
      loadAdminSectionData(collection, { silent: true, append: true })
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
  app.querySelectorAll('[data-admin-give-product]').forEach((button) => {
    button.addEventListener('click', () => openProductGrantDialog(button.getAttribute('data-admin-give-product') || ''))
  })
  app.querySelectorAll('[data-repair-admin-order]').forEach((button) => {
    button.addEventListener('click', () => submitAdminOrderRepair(button.getAttribute('data-repair-admin-order') || ''))
  })
  app.querySelectorAll('[data-close-product-grant]').forEach((button) => {
    button.addEventListener('click', closeProductGrantDialog)
  })
  app.querySelector('[data-product-grant-search-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    searchProductsForGrant(event.currentTarget)
  })
  app.querySelectorAll('[data-grant-product-id]').forEach((input) => {
    input.addEventListener('change', () => {
      toggleProductGrantSelection(input.getAttribute('data-grant-product-id') || '', input.checked)
    })
  })
  app.querySelector('[data-product-grant-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitProductGrant()
  })
  app.querySelectorAll('[data-admin-email-user]').forEach((button) => {
    button.addEventListener('click', () => openAdminEmailComposerForUser(button.getAttribute('data-admin-email-user') || ''))
  })
  app.querySelectorAll('[data-admin-auth-email]').forEach((button) => {
    button.addEventListener('click', () => submitAdminUserEmailAction(button.getAttribute('data-admin-auth-email-uid') || '', button.getAttribute('data-admin-auth-email') || ''))
  })
  app.querySelectorAll('[data-admin-force-reset]').forEach((button) => {
    button.addEventListener('click', () => submitForcePasswordReset(button.getAttribute('data-admin-force-reset') || ''))
  })
  app.querySelectorAll('[data-admin-temp-password]').forEach((button) => {
    button.addEventListener('click', () => submitTemporaryPassword(button.getAttribute('data-admin-temp-password') || ''))
  })
  app.querySelectorAll('[data-admin-revoke-recovery]').forEach((button) => {
    button.addEventListener('click', () => submitRevokeRecoveryCodes(button.getAttribute('data-admin-revoke-recovery') || ''))
  })
  app.querySelectorAll('[data-admin-security-notice-user]').forEach((button) => {
    button.addEventListener('click', () => openAdminSecurityNotice(button.getAttribute('data-admin-security-notice-user') || ''))
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
  app.querySelectorAll('[data-admin-community-action]').forEach((button) => {
    button.addEventListener('click', () => handleCommunityModerationAction(button))
  })
  app.querySelector('[data-admin-community-focus-title]')?.addEventListener('click', () => {
    const titleInput = app.querySelector('[data-admin-community-edit-form] input[name="title"]')
    titleInput?.focus()
    titleInput?.select?.()
  })
  app.querySelector('[data-admin-community-create-open]')?.addEventListener('click', () => {
    state.adminData.community.createOpen = true
    state.adminData.community.createError = ''
    state.adminData.community.createMessage = ''
    render()
  })
  app.querySelector('[data-admin-community-create-close]')?.addEventListener('click', () => {
    state.adminData.community.createOpen = false
    state.adminData.community.createSaving = false
    state.adminData.community.createError = ''
    render()
  })
  app.querySelector('[data-admin-community-create-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitAdminCommunityCreate(event.currentTarget)
  })
  app.querySelector('[data-admin-community-edit-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitAdminCommunityEdit(event.currentTarget)
  })
  app.querySelector('[data-admin-community-create-form] input[name="title"]')?.addEventListener('input', (event) => {
    const form = event.currentTarget.closest('form')
    const slugInput = form?.querySelector('input[name="slug"]')
    if (!slugInput || slugInput.dataset.userEdited === 'true') return
    slugInput.value = adminCommunitySlug(event.currentTarget.value)
  })
  app.querySelector('[data-admin-community-create-form] input[name="slug"]')?.addEventListener('input', (event) => {
    event.currentTarget.dataset.userEdited = 'true'
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
  app.querySelector('[data-operations-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitOperationsForm(event.currentTarget)
  })
  app.querySelector('[data-studio-library-initialize]')?.addEventListener('click', (event) => {
    event.preventDefault()
    initializeAdminStudioLibrary()
  })
  app.querySelector('[data-studio-library-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitAdminStudioInstrument(event.currentTarget)
  })
  app.querySelector('[data-admin-studio-add-folder]')?.addEventListener('click', () => {
    const studio = state.operations.studio
    const selected = findFolderById(studio.library?.folders || [], studio.selectedFolderId)
    if (!selected) {
      studio.error = 'Select a parent folder before adding a child folder.'
    } else if (selected.type === 'engine-folder') {
      studio.error = 'Engine folders are final destinations. Select their parent before adding a sibling folder.'
    } else {
      studio.addFolderOpen = true
      studio.error = ''
    }
    render()
  })
  app.querySelector('[data-admin-studio-expand-all]')?.addEventListener('click', () => {
    state.operations.studio.expandedFolderIds = new Set(flattenLibraryFolders(state.operations.studio.library?.folders || []).map((folder) => folder.id))
    render()
  })
  app.querySelector('[data-admin-studio-collapse-all]')?.addEventListener('click', () => {
    state.operations.studio.expandedFolderIds = new Set()
    render()
  })
  app.querySelectorAll('[data-admin-studio-folder-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset.adminStudioFolderToggle || ''
      const expanded = new Set(state.operations.studio.expandedFolderIds)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      state.operations.studio.expandedFolderIds = expanded
      render()
    })
  })
  app.querySelectorAll('[data-admin-studio-folder-select]').forEach((button) => {
    button.addEventListener('click', () => {
      state.operations.studio.selectedFolderId = button.dataset.adminStudioFolderSelect || ''
      state.operations.studio.selectedInstrumentId = ''
      state.operations.studio.addFolderOpen = false
      state.operations.studio.error = ''
      render()
    })
  })
  app.querySelector('[data-admin-studio-folder-edit]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    saveAdminStudioFolderEdit(event.currentTarget)
  })
  app.querySelector('[data-admin-studio-folder-add]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    addAdminStudioFolder(event.currentTarget)
  })
  app.querySelector('[data-admin-studio-folder-add-open]')?.addEventListener('click', () => {
    state.operations.studio.addFolderOpen = true
    render()
  })
  app.querySelector('[data-admin-studio-folder-add-cancel]')?.addEventListener('click', () => {
    state.operations.studio.addFolderOpen = false
    render()
  })
  app.querySelector('[data-admin-studio-folder-rename]')?.addEventListener('click', () => {
    const input = app.querySelector('[data-admin-studio-folder-edit] input[name="label"]')
    input?.focus()
    input?.select()
  })
  app.querySelector('[data-admin-studio-folder-move-open]')?.addEventListener('click', () => {
    const studio = state.operations.studio
    openAdminStudioFolderPicker({
      mode: 'move-folder',
      targetId: studio.selectedFolderId,
      selectedId: '',
      engineOnly: false,
      title: 'Move folder'
    })
  })
  app.querySelectorAll('[data-admin-studio-folder-move]').forEach((button) => {
    button.addEventListener('click', () => moveAdminStudioFolder(Number(button.dataset.adminStudioFolderMove) || 1))
  })
  app.querySelector('[data-admin-studio-folder-delete]')?.addEventListener('click', deleteAdminStudioFolder)
  app.querySelector('[data-admin-studio-use-destination]')?.addEventListener('click', () => {
    const folder = findFolderById(state.operations.studio.library?.folders || [], state.operations.studio.selectedFolderId)
    if (!folder?.path) return
    state.operations.studio.form = {
      ...state.operations.studio.form,
      destinationFolderId: folder.id,
      folderPath: folder.path,
      engineType: folder.engineType || state.operations.studio.form?.engineType || 'sample-based'
    }
    state.operations.studio.message = `${folder.path} selected as the instrument destination.`
    render()
    requestAnimationFrame(() => app.querySelector('[data-studio-library-form]')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  })
  app.querySelectorAll('[data-admin-studio-instrument-select]').forEach((button) => {
    button.addEventListener('click', () => {
      state.operations.studio.selectedInstrumentId = button.dataset.adminStudioInstrumentSelect || ''
      render()
    })
  })
  app.querySelectorAll('[data-admin-studio-instrument-move]').forEach((button) => {
    button.addEventListener('click', () => {
      const instrumentId = button.dataset.adminStudioInstrumentMove || ''
      const instrument = state.operations.studio.library?.instruments?.find((item) => item.id === instrumentId)
      openAdminStudioFolderPicker({
        mode: 'move-instrument',
        targetId: instrumentId,
        selectedId: findFolderByPath(state.operations.studio.library?.folders || [], instrument?.folderPath)?.id || '',
        engineOnly: false,
        title: `Move ${instrument?.name || 'instrument'}`
      })
    })
  })
  app.querySelectorAll('[data-admin-studio-instrument-toggle]').forEach((button) => {
    button.addEventListener('click', () => toggleAdminStudioInstrument(button.dataset.adminStudioInstrumentToggle || ''))
  })
  app.querySelectorAll('[data-admin-studio-instrument-remove]').forEach((button) => {
    button.addEventListener('click', () => removeAdminStudioInstrument(button.dataset.adminStudioInstrumentRemove || ''))
  })
  app.querySelector('[data-admin-studio-form-destination]')?.addEventListener('click', () => {
    const formElement = app.querySelector('[data-studio-library-form]')
    state.operations.studio.form = {
      ...state.operations.studio.form,
      ...(formElement ? operationsFormValues(formElement) : {})
    }
    const formState = studioInstrumentFormState()
    openAdminStudioFolderPicker({
      mode: 'instrument-form',
      selectedId: formState.destinationFolderId || '',
      engineOnly: false,
      title: 'Choose instrument destination'
    })
  })
  app.querySelectorAll('[data-admin-studio-picker-folder]').forEach((button) => {
    button.addEventListener('click', () => {
      state.operations.studio.folderPicker.selectedId = button.dataset.adminStudioPickerFolder || ''
      render()
    })
  })
  app.querySelectorAll('[data-admin-studio-picker-close]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (element.classList.contains('admin-daw-picker-backdrop') && event.target !== element) return
      closeAdminStudioFolderPicker()
    })
  })
  app.querySelector('[data-admin-studio-picker-confirm]')?.addEventListener('click', confirmAdminStudioFolderPicker)
  app.querySelector('[data-admin-studio-folder-edit] select[name="type"]')?.addEventListener('change', (event) => {
    const engine = event.currentTarget.form?.elements?.engineType
    if (engine) engine.disabled = event.currentTarget.value !== 'engine-folder'
  })
  app.querySelector('[data-admin-studio-folder-add] select[name="type"]')?.addEventListener('change', (event) => {
    const engine = event.currentTarget.form?.elements?.engineType
    if (engine) engine.disabled = event.currentTarget.value !== 'engine-folder'
  })
  app.querySelector('[data-studio-library-form] input[name="audioZip"]')?.addEventListener('change', (event) => {
    state.operations.studio.form = {
      ...state.operations.studio.form,
      ...operationsFormValues(event.currentTarget.form)
    }
    parseAdminStudioArchive(event.currentTarget.files?.[0] || null)
  })
  app.querySelector('[data-studio-library-form] input[name="artwork"]')?.addEventListener('change', (event) => {
    state.operations.studio.artworkFile = event.currentTarget.files?.[0] || null
  })
  app.querySelector('[data-studio-library-form] input[name="htmlSource"]')?.addEventListener('change', (event) => {
    state.operations.studio.form = {
      ...state.operations.studio.form,
      ...operationsFormValues(event.currentTarget.form)
    }
    state.operations.studio.htmlSourceFile = event.currentTarget.files?.[0] || null
    render()
  })
  const studioLibraryForm = app.querySelector('[data-studio-library-form]')
  const studioNameInput = studioLibraryForm?.elements?.name
  const studioIdInput = studioLibraryForm?.elements?.id
  studioNameInput?.addEventListener('input', () => {
    if (!studioIdInput || studioIdInput.readOnly || studioIdInput.dataset.userEdited === 'true') return
    studioIdInput.value = studioLibrarySlug(studioNameInput.value)
    studioIdInput.dispatchEvent(new Event('input'))
  })
  studioIdInput?.addEventListener('input', () => {
    if (document.activeElement === studioIdInput) studioIdInput.dataset.userEdited = 'true'
  })
  const updateStudioPathPreview = () => {
    if (!studioLibraryForm) return
    const destination = findFolderById(state.operations.studio.library?.folders || [], studioLibraryForm.elements.destinationFolderId?.value)
    const id = studioLibrarySlug(studioLibraryForm.elements.id?.value || studioLibraryForm.elements.name?.value) || '{instrumentId}'
    const version = Math.max(1, Math.round(Number(studioLibraryForm.elements.version?.value) || 1))
    const folderPath = destination?.path || ''
    const folder = studioLibraryForm.querySelector('[data-studio-folder-preview]')
    const storagePath = studioLibraryForm.querySelector('[data-studio-storage-preview]')
    if (folder) folder.textContent = folderPath
    if (storagePath) storagePath.textContent = `${STUDIO_LIBRARY_STORAGE_ROOT}/${folderPath}/${id}/v${version}`
  }
  studioLibraryForm?.querySelectorAll('input[name="id"],input[name="name"],input[name="version"]').forEach((input) => {
    input.addEventListener('input', updateStudioPathPreview)
    input.addEventListener('change', updateStudioPathPreview)
  })
  studioLibraryForm?.querySelector('select[name="engineType"]')?.addEventListener('change', (event) => {
    const previousEngineType = state.operations.studio.form?.engineType || ''
    const nextForm = operationsFormValues(event.currentTarget.form)
    state.operations.studio.form = {
      ...state.operations.studio.form,
      ...nextForm
    }
    if (previousEngineType && previousEngineType !== nextForm.engineType) {
      state.operations.studio.zipFile = null
      state.operations.studio.parsedSamples = []
      state.operations.studio.htmlSourceFile = null
    }
    render()
  })
  studioLibraryForm?.querySelector('select[name="sampleStrategy"]')?.addEventListener('change', (event) => {
    const nextForm = operationsFormValues(event.currentTarget.form)
    state.operations.studio.form = {
      ...state.operations.studio.form,
      ...nextForm,
      ...(!state.operations.studio.samplePlaybackModeTouched
        ? { samplePlaybackMode: defaultSamplePlaybackMode(nextForm.sampleStrategy) }
        : {})
    }
    render()
  })
  studioLibraryForm?.querySelector('select[name="samplePlaybackMode"]')?.addEventListener('change', (event) => {
    state.operations.studio.samplePlaybackModeTouched = true
    state.operations.studio.form = {
      ...state.operations.studio.form,
      ...operationsFormValues(event.currentTarget.form)
    }
  })
  app.querySelectorAll('[data-studio-library-edit]').forEach((button) => {
    button.addEventListener('click', () => setAdminStudioEditInstrument(button.getAttribute('data-studio-library-edit') || ''))
  })
  app.querySelector('[data-studio-library-edit-cancel]')?.addEventListener('click', (event) => {
    event.preventDefault()
    resetAdminStudioInstrumentForm()
  })
  app.querySelector('[data-admin-email-form]')?.addEventListener('input', (event) => {
    updateEmailFormFromDom(event.currentTarget)
  })
  app.querySelector('[data-admin-email-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitAdminEmailForm(event.currentTarget)
  })
  app.querySelector('[data-admin-email-self]')?.addEventListener('click', (event) => {
    event.preventDefault()
    submitAdminEmailForm(app.querySelector('[data-admin-email-form]'), { self: true })
  })
  app.querySelectorAll('[data-email-log-tab]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      const tab = button.getAttribute('data-email-log-tab') || 'sent'
      state.contact.emailLogTab = ['sent', 'failed', 'draft'].includes(tab) ? tab : 'sent'
      state.contact.emailLogDetailId = ''
      state.contact.emailLogDetailView = 'preview'
      window.history.pushState({}, '', `${ROUTES.adminContact}?mode=email&activity=${encodeURIComponent(state.contact.emailLogTab)}`)
      render()
      const data = emailLogState(state.contact.emailLogTab)
      if (!data.loaded) loadEmailLogs(state.contact.emailLogTab, { silent: false })
    })
  })
  app.querySelector('[data-email-log-load-more]')?.addEventListener('click', () => {
    loadEmailLogs(state.contact.emailLogTab || 'sent', { append: true, silent: true })
  })
  app.querySelector('[data-email-log-search-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const input = app.querySelector('[data-email-log-search-input]')
    state.contact.emailLogSearch = String(input?.value || '').trim()
    state.contact.emailLogSearchInput = state.contact.emailLogSearch
    const data = emailLogState(state.contact.emailLogTab || 'sent')
    data.loaded = false
    loadEmailLogs(state.contact.emailLogTab || 'sent', { silent: false })
  })
  app.querySelector('[data-email-log-search-input]')?.addEventListener('input', (event) => {
    state.contact.emailLogSearchInput = event.currentTarget.value || ''
  })
  app.querySelector('[data-email-log-search-clear]')?.addEventListener('click', () => {
    state.contact.emailLogSearch = ''
    state.contact.emailLogSearchInput = ''
    const data = emailLogState(state.contact.emailLogTab || 'sent')
    data.loaded = false
    loadEmailLogs(state.contact.emailLogTab || 'sent', { silent: false })
  })
  app.querySelectorAll('[data-email-log-detail]').forEach((button) => {
    button.addEventListener('click', () => {
      state.contact.emailLogDetailId = button.getAttribute('data-email-log-detail') || ''
      state.contact.emailLogDetailView = 'preview'
      const params = new URLSearchParams(window.location.search)
      params.set('mode', 'email')
      params.set('activity', state.contact.emailLogTab || 'sent')
      params.set('email', state.contact.emailLogDetailId)
      window.history.pushState({}, '', `${ROUTES.adminContact}?${params.toString()}`)
      render()
    })
  })
  app.querySelectorAll('[data-email-log-detail-view]').forEach((button) => {
    button.addEventListener('click', () => {
      state.contact.emailLogDetailView = button.getAttribute('data-email-log-detail-view') || 'preview'
      render()
    })
  })
  app.querySelector('[data-close-email-log-detail]')?.addEventListener('click', () => {
    state.contact.emailLogDetailId = ''
    window.history.pushState({}, '', `${ROUTES.adminContact}?mode=email&activity=${encodeURIComponent(state.contact.emailLogTab || 'sent')}`)
    render()
  })
  app.querySelector('[data-email-log-detail-backdrop]')?.addEventListener('click', (event) => {
    if (event.target !== event.currentTarget) return
    state.contact.emailLogDetailId = ''
    window.history.pushState({}, '', `${ROUTES.adminContact}?mode=email&activity=${encodeURIComponent(state.contact.emailLogTab || 'sent')}`)
    render()
  })
  app.querySelector('[data-admin-system-form]')?.addEventListener('input', (event) => {
    updateSystemFormFromDom(event.currentTarget)
  })
  app.querySelector('[data-admin-system-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitAdminSystemMessageForm(event.currentTarget)
  })
  app.querySelector('[data-admin-call-form]')?.addEventListener('submit', (event) => {
  event.preventDefault()
  const roomName = app.querySelector('[data-admin-call-room]')?.value || 'melogic-phone-test'
  joinAdminContactCallRoom(roomName)
})

app.querySelector('[data-admin-call-mute]')?.addEventListener('click', (event) => {
  event.preventDefault()
  toggleAdminContactCallMute()
})

app.querySelector('[data-admin-call-leave]')?.addEventListener('click', (event) => {
  event.preventDefault()
  leaveAdminContactCallRoom()
})

app.querySelector('[data-admin-call-watch]')?.addEventListener('click', (event) => {
  event.preventDefault()
  stopActiveSupportCallWatch()
  startActiveSupportCallWatch()
})

app.querySelector('[data-admin-call-create-manual]')?.addEventListener('click', (event) => {
  event.preventDefault()
  createManualSupportCallFromPanel()
})

app.querySelectorAll('[data-admin-call-join]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    joinSupportCallFromPanel(button.getAttribute('data-admin-call-join') || '')
  })
})

app.querySelectorAll('[data-admin-call-force]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    forceConnectSupportCall(button.getAttribute('data-admin-call-force') || '')
  })
})

app.querySelectorAll('[data-admin-call-end]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    endSupportCallFromPanel(button.getAttribute('data-admin-call-end') || '')
  })
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
  app.querySelectorAll('[data-admin-product-moderation]').forEach((button) => {
    button.addEventListener('click', () => {
      const [action, productId] = String(button.getAttribute('data-admin-product-moderation') || '').split(':')
      if (action && productId) openProductModerationDialog(productId, action)
    })
  })
  app.querySelectorAll('[data-close-product-moderation]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target !== element && !element.matches('button')) return
      closeProductModerationDialog()
    })
  })
  app.querySelector('[data-product-moderation-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    submitProductModeration(event.currentTarget)
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
  app.querySelector('[data-support-threads-refresh]')?.addEventListener('click', (event) => {
    event.preventDefault()
    state.contact.supportThreads.loaded = false
    state.contact.supportThreads.items = []
    state.contact.supportThreads.selectedId = ''
    loadSupportThreads({ silent: false })
  })

  app.querySelectorAll('[data-support-thread-filter]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      state.contact.supportThreads.filter = button.getAttribute('data-support-thread-filter') || 'active'
      state.contact.supportThreads.loaded = false
      state.contact.supportThreads.items = []
      state.contact.supportThreads.selectedId = ''
      state.contact.supportThreads.messages = []
      const params = new URLSearchParams(window.location.search)
      params.set('mode', 'support')
      params.set('threadFilter', state.contact.supportThreads.filter)
      params.delete('thread')
      window.history.replaceState({}, '', `${ROUTES.adminContact}?${params.toString()}`)
      loadSupportThreads({ silent: false })
    })
  })

  app.querySelectorAll('[data-support-thread-select]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      selectSupportThread(button.getAttribute('data-support-thread-select') || '')
    })
  })

  app.querySelector('[data-support-thread-reply-body]')?.addEventListener('input', (event) => {
    state.contact.supportThreads.replyDraft = event.currentTarget.value || ''
    const submit = event.currentTarget.closest('form')?.querySelector('button[type="submit"]')
    if (submit) submit.disabled = !state.contact.supportThreads.replyDraft.trim() || Boolean(state.contact.supportThreads.savingId)
  })

  app.querySelector('[data-support-thread-reply]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    replyToSupportThread(event.currentTarget.getAttribute('data-support-thread-reply') || '')
  })

  app.querySelectorAll('[data-support-thread-claim]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      claimSelectedSupportThread(button.getAttribute('data-support-thread-claim') || '')
    })
  })

  app.querySelectorAll('[data-support-thread-resolve]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      resolveSelectedSupportThread(button.getAttribute('data-support-thread-resolve') || '')
    })
  })

  app.querySelector('[data-support-forms-refresh]')?.addEventListener('click', (event) => {
  event.preventDefault()
  state.contact.supportForms.loaded = false
  state.contact.supportForms.cursor = null
  state.contact.supportForms.hasMore = false
  state.contact.supportForms.items = []
  stopSupportFormsWatch()
  loadSupportFormsPage({ append: false })
})

app.querySelectorAll('[data-support-form-filter]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    state.contact.supportForms.filter = button.getAttribute('data-support-form-filter') || 'unresolved'
    state.contact.supportForms.loaded = false
    state.contact.supportForms.cursor = null
    state.contact.supportForms.hasMore = false
    state.contact.supportForms.items = []
    state.contact.supportForms.selectedId = ''
    const params = new URLSearchParams(window.location.search)
    params.set('mode', 'support')
    params.set('filter', state.contact.supportForms.filter)
    params.delete('support')
    window.history.replaceState({}, '', `${ROUTES.adminContact}?${params.toString()}`)
    loadSupportFormsPage({ append: false })
  })
})

app.querySelector('[data-support-forms-load-more]')?.addEventListener('click', (event) => {
  event.preventDefault()
  loadSupportFormsPage({ append: true })
})

app.querySelectorAll('[data-support-form-select]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    state.contact.supportForms.selectedId = button.getAttribute('data-support-form-select') || ''
    const params = new URLSearchParams(window.location.search)
    params.set('mode', 'support')
    if (state.contact.supportForms.selectedId) params.set('support', state.contact.supportForms.selectedId)
    window.history.replaceState({}, '', `${ROUTES.adminContact}?${params.toString()}`)
    render()
  })
})

app.querySelectorAll('[data-support-form-status]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    changeSupportFormStatus(
      button.getAttribute('data-support-form-status') || '',
      button.getAttribute('data-status-value') || 'reviewing'
    )
  })
})

app.querySelectorAll('[data-support-form-save-note]').forEach((button) => {
  button.addEventListener('click', (event) => {
    event.preventDefault()
    saveSupportFormAdminNote(button.getAttribute('data-support-form-save-note') || '')
  })
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
  try {
    state.currentUserMfaEnabled = (multiFactor(state.currentUser).enrolledFactors || []).length > 0
  } catch {
    state.currentUserMfaEnabled = false
  }
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
