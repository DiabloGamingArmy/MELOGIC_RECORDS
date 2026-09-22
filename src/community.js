import './styles/base.css'
import './styles/community.css'
import './styles/communityMobile.css'
import { communityScrollViewport, setCommunityScroll, syncCommunityMobileHeader } from './community/viewport.js'
import { createCommunityAuthScope, createMonotonicRequestOwner, releaseOwnedOperation, restorePreservedCommunitySurface, suspendCommunityMediaResources } from './community/lifecycleState.js'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { createReport } from './data/productService'
import {
  createCommunityComment,
  createCommunityPost,
  createCommunityStory,
  deleteCommunityCommentAttachments,
  deleteCommunityPostAttachments,
  deleteCommunityStory,
  deleteCommunityComment,
  deleteOwnCommunityPost,
  getCommunityComment,
  getCommunityCommentViewerState,
  getCommunityBySlug,
  getCommunityMembership,
  getCommunityPost,
  hydrateCommunityPostCommunities,
  getCommunityPostViewerState,
  getCommunityTopComment,
  listCommunityCommentsPage,
  listCommunities,
  listFocusedCommunityIds,
  listFollowedCreatorPosts,
  listCommunityPosts,
  listCommunityStories,
  listSelectableCommunities,
  listShareableCommunityMusicPreviews,
  listShareableCommunityProducts,
  listShareableCommunityStagePlans,
  listShareableCommunityStudioProjects,
  joinCommunity,
  leaveCommunity,
  newCommunityStoryId,
  newCommunityCommentId,
  newCommunityPostId,
  normalizeCommunityComment,
  normalizeCommunityPost,
  normalizeCommunityStory,
  resolveCommunityAttachmentMediaUrls,
  recordCommunityPostShare,
  recordCommunityStoryView,
  setCommunityStoryReaction,
  toggleCommunityCommentLike,
  toggleCommunityCommentDislike,
  toggleCommunityFocus,
  toggleCommunityPostDislike,
  toggleCommunityPostLike,
  toggleCommunityPostSave,
  updateCommunityPost,
  uploadCommunityCommentAttachments,
  uploadCommunityPostAttachments,
  uploadCommunityStoryMedia,
  validateCommunityCommentAttachment,
  validateCommunityPostAttachment,
  validateCommunityStoryMedia
} from './data/communityService'
import { getCachedPublicProfileIdentityByUid, getPublicProfileIdentityStateByUid, searchProfilesByUsername } from './data/profileSearchService'
import { createOrGetDm } from './data/threadService'
import { sendMessage } from './data/messageService'
import { ROUTES, authRoute, communityPostRoute, communityRoute, productRoute, publicProfileRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import { emitMobileSpaNavigation, isMobileSpaRuntime } from './pwa/mobileSpaRouter'
import { navigateMobileRuntimeUrl, registerMobileRuntimeView } from './pwa/mobileAppRuntime'
import { formatUsername } from './utils/format'
import { iconSvg } from './utils/icons'
import { getStorageAssetUrl } from './firebase/storageAssets'
import communityLoadingLogoUrl from './assets/brand/melogic-logo-mark-white-transparent.png'

const app = document.querySelector('#app')
// melogic-community-lifecycle-contract-v4b
// Page ownership is established by bootstrap/activate, not module evaluation.
let communityBootstrapped = false
let communityBootstrapPromise = null // melogic-runtime-boot-ownership-v4d1
let communityAuthUnsubscribe = null
let communityPopstateBound = false
let communityGlobalUiBound = false
const COMMUNITY_PAGE_SIZE = 4
const COMMUNITY_FOLLOWING_CACHE_SIZE = 24
const COMPOSER_DRAFT_KEY = 'melogic-community-composer-draft-v2'
const COMMUNITY_COMPOSER_PROMPTS = [
  "What's happening?",
  "What's on your mind?",
  'Anything new today?',
  'Share your latest.',
  'Spill the tea.',
  'What are you creating?',
  'Drop an update.',
  'How is it going?',
  'Share a creative win.',
  'What are you building?',
  'Tell the community.',
  'What is inspiring you?',
  'Show us your progress.',
  'Start a conversation.',
  'What did you make?',
  'Need some feedback?',
  'Share your sound.',
  'What are you exploring?',
  'Post something fresh.',
  'What is the vibe?',
  'Bring us backstage.',
  'Share today’s highlight.',
  'Got something to share?',
  'What are you learning?',
  'Let creators know.',
  'What is cooking?',
  'Share the process.',
  'Any studio updates?'
]
const communityComposerPrompt = COMMUNITY_COMPOSER_PROMPTS[Math.floor(Math.random() * COMMUNITY_COMPOSER_PROMPTS.length)]
const QUICK_EMOJIS = ['🔥', '🎧', '🎹', '🥁', '🎚️', '✨', '🙌', '💡', '🚀', '❤️', '🤘', '✅']
const FEEDBACK_CATEGORIES = ['Mix', 'Master', 'Songwriting', 'Sound Design', 'Vocal Performance', 'Stage Layout', 'Product Listing', 'Other']
const COLLABORATION_ROLES = ['Vocalist', 'Producer', 'Songwriter', 'Guitarist', 'Drummer', 'Mixing Engineer', 'Mastering Engineer', 'Sound Designer', 'Stage Designer', 'Lighting Designer', 'Camera Operator', 'Other']
const COMPENSATION_TYPES = ['Paid', 'Unpaid', 'Revenue Share', 'Discuss']
const LOCATION_MODES = ['Remote', 'Local', 'Either']
const REPORT_REASONS = [
  'Spam',
  'Harassment or abuse',
  'Misleading content',
  'Stolen/copyrighted content',
  'Inappropriate content',
  'Other'
]
const STORY_BACKGROUNDS = [
  { id: 'aurora', label: 'Aurora' },
  { id: 'midnight', label: 'Midnight' },
  { id: 'sunset', label: 'Sunset' },
  { id: 'stage', label: 'Stage' },
  { id: 'mono', label: 'Mono' }
]
const STORY_LIFETIME_OPTIONS = [6, 12, 24, 48]
const STORY_MAX_RECORD_SECONDS = 60
const recordedStoryViews = new Set()
const COMMUNITY_DEBUG = Boolean(import.meta.env?.DEV) || new URLSearchParams(window.location.search).has('debugCommunity')

const initialRequestedFeed = new URLSearchParams(window.location.search).get('feed')
const initialActiveTab = initialRequestedFeed === 'following' ? 'following' : 'for-you'

const state = {
  currentUser: null,
  activeTab: initialActiveTab,
  activeCommunityId: '',
  activeCommunitySlug: '',
  activeTopicLabel: initialActiveTab === 'following' ? 'Following' : 'For You',
  selectedCommunityFilters: [],
  discoveryTab: 'suggested',
  activeTag: normalizeTagKey(parseFeedParam('tag')),
  feedSearch: parseFeedParam('search'),
  feedSort: ['new', 'top-today', 'top-week', 'most-discussed'].includes(parseFeedParam('sort')) ? parseFeedParam('sort') : 'new',
  view: parseCommunityView(),
  community: null,
  communities: [],
  communityFocus: {},
  communityMembership: {},
  communityFilters: {
    search: '',
    category: 'all',
    loading: false,
    error: ''
  },
  communitySearchTimer: null,
  stories: [],
  storiesLoading: false,
  storiesError: '',
  pendingStoryUpload: null,
  storyComposer: {
    open: false,
    mode: 'upload',
    mediaType: 'video',
    text: '',
    background: 'aurora',
    file: null,
    previewURL: '',
    lifetimeHours: 24,
    visibility: 'public',
    storyType: 'moment',
    layers: [],
    selectedLayerId: '',
    remixOfStoryId: '',
    remixPermission: false,
    uploadProgress: 0,
    recording: false,
    recordingSeconds: 0,
    recordingSupported: true,
    submitting: false,
    error: '',
    message: ''
  },
  storyViewer: {
    open: false,
    storyId: '',
    loading: false,
    error: ''
  },
  imageViewer: {
    open: false,
    url: '',
    name: '',
    scale: 1,
    translateX: 0,
    translateY: 0
  },
  posts: [],
  attachmentMediaUrls: {},
  attachmentMediaFailures: {},
  viewerState: {},
  loading: true,
  initialHomeHydration: true,
  feedInitialLoading: false,
  feedLoadingMore: false,
  feedHasMore: true,
  feedCursor: null,
  feedError: '',
  feedStillLoading: false,
  feedRequestId: 0,
  activeFeedQueryKey: '',
  followingFeedCache: {
    uid: '',
    key: '',
    posts: []
  },
  openPostMenuId: '',
  openCommentMenuKey: '',
  topCommentPreviews: {},
  topCommentPreviewLoading: {},
  history: {
    loading: false,
    loaded: false,
    error: '',
    events: [],
    index: 0,
    dateLabel: ''
  },
  error: '',
  message: '',
  composer: {
    open: false,
    title: '',
    body: '',
    linkedProductId: '',
    communityId: '',
    destinationPickerOpen: false,
    destinationSearch: '',
    destinationSearchDraft: '',
    destinationLoading: false,
    destinationError: '',
    destinationItems: [],
    destinationVisibleCount: 10,
    tags: '',
    visibility: 'public',
    attachments: [],
    fileAttachments: [],
    uploadProgress: 0,
    emojiOpen: false,
    mentionQuery: '',
    mentionResults: [],
    mentionSearchLoading: false,
    mentionSearchError: '',
    mentionedUsers: [],
    productPickerOpen: false,
    productPickerLoading: false,
    productPickerError: '',
    products: [],
    musicPickerOpen: false,
    musicPickerLoading: false,
    musicPickerError: '',
    musicPreviews: [],
    stagePickerOpen: false,
    stagePickerLoading: false,
    stagePickerError: '',
    stagePlans: [],
    studioPickerOpen: false,
    studioPickerLoading: false,
    studioPickerError: '',
    studioProjects: [],
    intent: '',
    intentData: {
      feedbackCategory: 'Mix',
      feedbackQuestion: '',
      feedbackDeadlineAt: '',
      collaborationRoleNeeded: 'Producer',
      collaborationGenre: '',
      collaborationCompensationType: 'Discuss',
      collaborationLocationMode: 'Remote',
      collaborationLocationText: '',
      collaborationDeadlineAt: ''
    },
    submitting: false,
    error: ''
  },
  editPost: {
    open: false,
    postId: '',
    title: '',
    body: '',
    tags: '',
    visibility: 'public',
    submitting: false,
    error: ''
  },
  report: {
    open: false,
    targetType: 'community_post',
    postId: '',
    commentId: '',
    storyId: '',
    reason: REPORT_REASONS[0],
    description: '',
    submitting: false,
    error: '',
    message: ''
  },
  comments: [],
  commentsByPostId: {},
  commentViewerState: {},
  commentsLoading: false,
  commentsLoadingMore: false,
  commentsCursor: null,
  commentsHasMore: false,
  commentsError: '',
  detailPostLoading: false,
  repliesByCommentId: {},
  expandedReplies: {},
  repliesByParent: {},
  repliesLoadingFor: '',
  repliesLoadingMoreFor: '',
  replyPagination: {},
  commentDraft: '',
  replyDrafts: {},
  replySubmittingFor: '',
  replyErrors: {},
  replyComposerFor: '',
  commentAttachmentDrafts: {},
  commentAttachmentErrors: {},
  commentAttachmentProgress: {},
  commentSubmitting: false,
  commentActionError: '',
  detailPostId: parseDetailPostId(),
  focusedCommentId: parseFeedParam('comment'),
  focusedReplyId: parseFeedParam('reply'),
  focusedCommentScrolled: false
}

let feedPaginationObserver = null
let communityKeyboardReady = false
let communityOutsideClickReady = false
let communityBeforeUnloadReady = false
let communityInternalNavigationPending = false
let communityRailResizeReady = false
let communityShellMounted = false
let communityShellChromeInitialized = false
let communityPagePreloaderInitialized = false
let feedNavigationSnapshot = null
const desktopCommunitySurfaceCache = new Map()
const mobileCommunitySurfaceCache = new Map()
let mobileCommunitySurfaceKey = ''
let desktopCommunitySurfaceKey = ''
let storyHydrationGeneration = 0
let desktopCommunityHydrationGeneration = 0
const communityAuthScope = createCommunityAuthScope()
const communityFeedRequestOwner = createMonotonicRequestOwner()
let mobileDiscoverScrollTop = 0
let mobileDiscoverScrollRestorePending = false
const communityPendingActions = new Map()
const communityPostReactionVersions = new Map()
const communityPostSaveVersions = new Map()
const communityCommentReactionVersions = new Map()
const communityFocusVersions = new Map()
const communityPostHoverTimers = new WeakMap()

// melogic-community-verified-badge-v1
// Live profiles/{uid}.badges[] is authoritative; Community snapshots may be stale.
const communityAuthorIdentityCache = new Map()
const communityAuthorIdentityRequests = new Map()
let communityIdentityRenderQueued = false

// melogic-community-identity-dom-hydration-v1
// Identity lookups are asynchronous enrichment. They must never trigger the
// page-level render(), because render() replaces communityRoot.innerHTML and
// destroys every mounted feed image/video/audio element.
function hydrateCommunityIdentityDom(root = app) {
  if (!root) return

  root.querySelectorAll('[data-community-author-uid]').forEach((node) => {
    const uid = String(node.getAttribute('data-community-author-uid') || '').trim()
    if (!uid) return
    const identity = communityAuthorIdentityCache.get(uid)
    if (!identity) return

    const fallback = node.getAttribute('data-community-display-fallback') || 'Melogic Creator'
    const displayName = String(identity.displayName || identity.authorDisplayName || fallback).trim() || fallback
    const verified = Array.isArray(identity.badges) && identity.badges.includes('verified')

    // Preserve the <strong> node itself. Only text/badge children change, so
    // post cards and all media descendants elsewhere in the card stay mounted.
    let textNode = [...node.childNodes].find((child) => child.nodeType === Node.TEXT_NODE)
    if (!textNode) {
      textNode = document.createTextNode('')
      node.prepend(textNode)
    }
    textNode.nodeValue = displayName

    const badge = node.querySelector(':scope > .community-verified-badge')
    node.classList.toggle('is-verified', verified)
    if (verified && communityVerifiedBadgeUrl) {
      if (!badge) {
        const img = document.createElement('img')
        img.className = 'community-verified-badge'
        img.src = communityVerifiedBadgeUrl
        img.alt = 'Verified'
        img.title = 'Verified'
        img.loading = 'eager'
        img.decoding = 'async'
        node.append(img)
      } else if (badge.getAttribute('src') !== communityVerifiedBadgeUrl) {
        badge.setAttribute('src', communityVerifiedBadgeUrl)
      }
    } else {
      badge?.remove()
    }
  })
}

function queueCommunityIdentityRender() {
  if (communityIdentityRenderQueued) return
  communityIdentityRenderQueued = true
  window.requestAnimationFrame(() => {
    communityIdentityRenderQueued = false
    if (communityBootstrapped) hydrateCommunityIdentityDom()
  })
}
function ensureCommunityAuthorIdentity(uid = '') {
  const cleanUid = String(uid || '').trim()
  if (!cleanUid || communityAuthorIdentityCache.has(cleanUid)) return Promise.resolve(communityAuthorIdentityCache.get(cleanUid) || null)
  const cached = getCachedPublicProfileIdentityByUid(cleanUid)
  if (cached) {
    communityAuthorIdentityCache.set(cleanUid, cached)
    return Promise.resolve(cached)
  }
  if (communityAuthorIdentityRequests.has(cleanUid)) return communityAuthorIdentityRequests.get(cleanUid)
  const request = getPublicProfileIdentityStateByUid(cleanUid).then((identityState) => {
    if (identityState.status === 'known') communityAuthorIdentityCache.set(cleanUid, identityState.identity)
    else if (identityState.status === 'missing') communityAuthorIdentityCache.set(cleanUid, { uid: cleanUid, badges: [] })
    communityAuthorIdentityRequests.delete(cleanUid)
    if (identityState.status === 'known' || identityState.status === 'missing') queueCommunityIdentityRender()
    return identityState.identity || null
  }).catch(() => {
    communityAuthorIdentityRequests.delete(cleanUid)
    return null
  })
  communityAuthorIdentityRequests.set(cleanUid, request)
  return request
}
function communityAuthorIsVerified(author = {}) {
  const uid = String(author.authorUid || author.uid || '').trim()
  if (uid) {
    void ensureCommunityAuthorIdentity(uid)
    const live = communityAuthorIdentityCache.get(uid)
    if (live) return Array.isArray(live.badges) && live.badges.includes('verified')
  }
  const badges = Array.isArray(author.authorBadges) ? author.authorBadges : (Array.isArray(author.badges) ? author.badges : [])
  return badges.map((v) => String(v || '').toLowerCase().trim()).includes('verified')
}
let communityVerifiedBadgeUrl = ''
void getStorageAssetUrl('assets/badges/verifiedBadge.png', {
  warnOnFail: false,
  scopeKey: 'community-badges',
  type: 'badge'
}).then((url) => {
  communityVerifiedBadgeUrl = String(url || '')
  queueCommunityIdentityRender()
}).catch(() => {})

function communityVerifiedBadgeMarkup(author = {}) {
  return communityAuthorIsVerified(author) && communityVerifiedBadgeUrl
    ? `<img class="community-verified-badge" src="${escapeHtml(communityVerifiedBadgeUrl)}" alt="Verified" title="Verified" loading="eager" decoding="async" />`
    : ''
}
function communityDisplayNameMarkup(author = {}, fallback = 'Melogic Creator', id = '') {
  const displayName = String(author.authorDisplayName || author.displayName || fallback).trim() || fallback
  const uid = String(author.authorUid || author.uid || '').trim()
  const verified = communityAuthorIsVerified(author)
  const idAttr = id ? ` id="${escapeHtml(id)}"` : ''
  const identityAttrs = uid
    ? ` data-community-author-uid="${escapeHtml(uid)}" data-community-display-fallback="${escapeHtml(displayName)}"`
    : ''
  return `<strong${idAttr} class="community-display-name ${verified ? 'is-verified' : ''}"${identityAttrs}>${escapeHtml(displayName)}${communityVerifiedBadgeMarkup(author)}</strong>`
}
let storyMediaRecorder = null
let storyRecordingStream = null
let storyRecordingChunks = []
let storyRecordingTimer = null

function interactionVersion(versions, id = '') {
  return versions.get(String(id || '')) || 0
}

function markInteractionMutation(versions, id = '') {
  const key = String(id || '')
  const version = interactionVersion(versions, key) + 1
  versions.set(key, version)
  return version
}

function logCommunityPerf(label, data = {}) {
  if (!COMMUNITY_DEBUG) return
  console.debug('[community:perf]', label, data)
}

function reconcileCommunityMobileRouteHeader() {
  const sync = () => syncCommunityMobileHeader(Boolean(parseDetailPostId()), document)
  sync()
  window.requestAnimationFrame(() => {
    sync()
    window.requestAnimationFrame(sync)
  })
  window.setTimeout(sync, 0)
  window.setTimeout(sync, 60)
  window.setTimeout(sync, 180)
}

function observeCommunityMobileHeaderLifecycle() {
  if (document.documentElement.dataset.communityHeaderLifecycleReady === 'true') return
  document.documentElement.dataset.communityHeaderLifecycleReady = 'true'
  const observer = new MutationObserver((mutations) => {
    if (!mutations.some((mutation) => mutation.type === 'childList' && (mutation.addedNodes.length || mutation.removedNodes.length))) return
    reconcileCommunityMobileRouteHeader()
  })
  observer.observe(document.body, { childList: true, subtree: true })
}

window.addEventListener('popstate', reconcileCommunityMobileRouteHeader)
window.addEventListener('pageshow', reconcileCommunityMobileRouteHeader)
document.addEventListener('melogic:mobile-spa-navigation', reconcileCommunityMobileRouteHeader)
observeCommunityMobileHeaderLifecycle()

function dispatchCommunityPendingActionsChanged() {
  window.dispatchEvent(new CustomEvent('community:pending-actions-changed', {
    detail: { pendingCount: communityPendingActions.size }
  }))
}

function trackCommunityAction(actionId, promise) {
  const id = String(actionId || '').trim()
  if (!id) return promise
  const authToken = communityAuthScope.current()
  const entry = { startedAt: Date.now(), promise, authToken }
  communityPendingActions.set(id, entry)
  dispatchCommunityPendingActionsChanged()
  return promise.then((result) => {
    assertCommunityAuthToken(authToken)
    return result
  }, (error) => {
    assertCommunityAuthToken(authToken)
    throw error
  }).finally(() => {
    releaseOwnedOperation(communityPendingActions, id, entry)
    dispatchCommunityPendingActionsChanged()
  })
}

function assertCommunityAuthToken(token) {
  if (communityAuthScope.isCurrent(token)) return
  const error = new Error('Community authentication scope changed while the operation was pending.')
  error.code = 'community/auth-scope-changed'
  throw error
}

function isCommunityAuthScopeError(error) {
  return error?.code === 'community/auth-scope-changed'
}

function transitionCommunityAuth(nextUser) {
  const nextUid = String(nextUser?.uid || '').trim()
  const previousUid = String(state.currentUser?.uid || '').trim()
  state.currentUser = nextUser || null
  if (nextUid === previousUid && communityAuthScope.current().uid === nextUid) return false

  communityAuthScope.transition(nextUid)
  storyHydrationGeneration += 1
  desktopCommunityHydrationGeneration += 1
  state.feedRequestId = communityFeedRequestOwner.invalidate()
  state.activeFeedQueryKey = ''
  state.feedInitialLoading = false
  state.feedLoadingMore = false
  state.feedStillLoading = false
  state.viewerState = {}
  state.commentViewerState = {}
  state.openPostMenuId = ''
  state.openCommentMenuKey = ''
  state.message = ''
  state.error = ''
  state.communityFocus = {}
  state.communityMembership = {}
  state.followingFeedCache = { uid: nextUid, key: '', posts: [] }
  if (state.activeTab === 'following') {
    state.posts = []
    state.feedCursor = null
    state.feedHasMore = true
  }

  recordedStoryViews.clear()
  communityPendingActions.clear()
  communityPostReactionVersions.clear()
  communityPostSaveVersions.clear()
  communityCommentReactionVersions.clear()
  communityFocusVersions.clear()
  dispatchCommunityPendingActionsChanged()

  desktopCommunitySurfaceCache.clear()
  mobileCommunitySurfaceCache.clear()
  feedNavigationSnapshot = null
  desktopCommunitySurfaceKey = ''
  mobileCommunitySurfaceKey = ''

  resetStoryRecording()
  if (state.pendingStoryUpload?.previewURL) URL.revokeObjectURL(state.pendingStoryUpload.previewURL)
  state.pendingStoryUpload = null
  if (state.storyComposer.previewURL) URL.revokeObjectURL(state.storyComposer.previewURL)
  state.storyComposer = {
    ...state.storyComposer,
    open: false,
    file: null,
    previewURL: '',
    submitting: false,
    recording: false,
    recordingSeconds: 0,
    uploadProgress: 0,
    error: '',
    message: ''
  }
  clearComposerFileAttachments()
  state.composer = {
    ...state.composer,
    open: false,
    attachments: [],
    fileAttachments: [],
    submitting: false,
    uploadProgress: 0,
    error: ''
  }
  state.editPost = { ...state.editPost, open: false, submitting: false, error: '' }
  state.report = { ...state.report, open: false, submitting: false, error: '', message: '' }
  state.commentDraft = ''
  state.replyDrafts = {}
  state.commentAttachmentDrafts = {}
  state.commentAttachmentErrors = {}
  state.commentAttachmentProgress = {}
  state.commentSubmitting = false
  state.replySubmittingFor = ''
  return true
}

async function rehydrateCommunityAuthState() {
  const token = communityAuthScope.current()
  await Promise.allSettled([
    loadViewerState(),
    loadCommentViewerState(),
    loadCommunityFocusState(),
    state.activeCommunityId ? loadActiveCommunityMembership(state.activeCommunityId) : Promise.resolve(),
    !state.detailPostId ? loadStories({ renderAfter: false, hydrateIdentity: true }) : Promise.resolve(),
    state.activeTab === 'following' && state.view.type === 'feed'
      ? loadFeedPage({ reset: true })
      : Promise.resolve()
  ])
  if (!communityAuthScope.isCurrent(token)) return
  render()
}

function hasPendingCommunityActions() {
  return communityPendingActions.size > 0
}

function isCommunityNavigationTarget(target = '') {
  try {
    const destination = new URL(target, window.location.origin)
    return destination.origin === window.location.origin
      && (destination.pathname === ROUTES.community || destination.pathname.startsWith(`${ROUTES.community}/`))
  } catch {
    return false
  }
}

/* melogic-community-mobile-surface-js-patch4 */
function setupMobileCommunitySurfaceBehavior() {
  if (document.documentElement.dataset.mobileCommunitySurfaceReady === 'true') return
  document.documentElement.dataset.mobileCommunitySurfaceReady = 'true'
  const isMobile = () => window.matchMedia('(max-width: 760px)').matches
  document.addEventListener('focusin', (event) => {
    if (!isMobile()) return
    const field = event.target instanceof Element ? event.target.closest('.community-comment-composer textarea, .community-reply-composer textarea, .community-detail-composer textarea') : null
    if (field instanceof HTMLElement) window.setTimeout(() => field.scrollIntoView({ block:'nearest', behavior:'smooth' }), 120)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !isMobile()) return
    const close = document.querySelector('.community-share-modal [data-close], .community-report-modal [data-close], .community-options-modal [data-close], .community-modal [data-close], .community-dialog [data-close]')
    if (close instanceof HTMLElement) close.click()
  })
}

/* melogic-community-mobile-interactions-patch3 */
/* melogic-mobile-community-plus-direct-composer-v2b */
function setupMobileCommunityShellActions() {
  if (document.documentElement.dataset.mobileCommunityActionsReady === 'true') return
  document.documentElement.dataset.mobileCommunityActionsReady = 'true'

  // melogic-community-canonical-plus-bridge-v2c
  // The canonical navShell header may be harvested/cloned by the warm SPA shell.
  // This action marker survives cloning and remains an in-page action.
  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null
    const createButton = target?.closest('[data-mobile-community-create]')
    if (!createButton) return
    event.preventDefault()
    event.stopPropagation()
    openCommunityComposer()
  }, true)
}

function bindCommunityGlobalUiOnce() {
  if (communityGlobalUiBound) return
  communityGlobalUiBound = true

  window.addEventListener('melogic:public-profile-identity', (event) => {
    const uid = String(event.detail?.uid || '').trim()
    const identity = event.detail?.identity || null
    if (!uid || !identity) return
    communityAuthorIdentityCache.set(uid, identity)
    queueCommunityIdentityRender()
    desktopCommunitySurfaceCache.forEach((cached) => hydrateCommunityIdentityDom(cached?.fragment))
    mobileCommunitySurfaceCache.forEach((cached) => hydrateCommunityIdentityDom(cached?.fragment))
  })

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      if (state.storyViewer.open) suspendStoryViewerResources({ releaseMedia: true })
      return
    }
    if (!document.body.classList.contains('is-community-page')) return
    resumeStoryViewerResources()
    if (isMobileSpaRuntime()) {
      void hydrateMobileCommunitySharedState({ directory: state.view.type === 'communities' })
      if (state.activeCommunityId) void loadActiveCommunityMembership(state.activeCommunityId)
      return
    }
    const key = desktopCommunitySurfaceKeyFor()
    if (['for-you', 'following', 'discover'].includes(key)) refreshDesktopCommunitySharedContent(key)
  })
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted || !document.body.classList.contains('is-community-page')) return
    resumeStoryViewerResources()
    if (isMobileSpaRuntime()) void hydrateMobileCommunitySharedState({ directory: state.view.type === 'communities' })
    else refreshDesktopCommunitySharedContent(desktopCommunitySurfaceKeyFor())
  })
  setupMobileCommunityShellActions()
  setupMobileCommunitySurfaceBehavior()
}

// melogic-community-firestore-reliability-v1
function setupCommunityFeedTabs() {
  if (document.documentElement.dataset.communityFeedTabsReady === 'true') return
  document.documentElement.dataset.communityFeedTabsReady = 'true'

  document.addEventListener('click', (event) => {
    const button = event.target instanceof Element
      ? event.target.closest('[data-community-tab]')
      : null
    if (!(button instanceof HTMLButtonElement)) return

    const nextTab = String(button.dataset.communityTab || '').trim()
    if (!['for-you', 'following'].includes(nextTab)) return
    event.preventDefault()

    // Mobile surface routing owns BOTH state mutation and DOM caching.
    // Do not change activeTab before it captures the currently mounted surface:
    // doing so mislabels the outgoing DOM and rotates Discover/Following/For You.
    if (isMobileSpaRuntime()) {
      event.stopImmediatePropagation()
      navigateMobileCommunitySurface(nextTab)
      return
    }

    // A tab can already be the remembered feed selection while Discover is
    // mounted. In that case it is still a navigation action: leave Discover.
    // Only short-circuit when that feed is already the visible surface.
    if (state.view.type === 'feed' && state.activeTab === nextTab && !state.feedError) return

    state.activeTab = nextTab
    state.activeTopicLabel = nextTab === 'following' ? 'Following' : 'For You'

    // Desktop left-rail feed controls are also visible while Discover is open.
    // Switching feed must therefore leave the Discover route/view, not merely
    // mutate activeTab behind the still-mounted discovery screen.
    if (!isMobileSpaRuntime() && state.view.type !== 'feed') {
      state.view = { type: 'feed' }
      state.activeCommunityId = ''
      state.activeCommunitySlug = ''
      window.history.pushState({}, '', ROUTES.community)
    }

    state.feedError = ''
    state.feedStillLoading = false
    state.followingFeedCache = nextTab === 'following'
      ? state.followingFeedCache
      : { uid: '', key: '', posts: [] }

    // Render the selected state synchronously so a network request can never
    // make the tab appear dead. The loader owns pagination/error state.
    render()
    void loadFeedPage({ reset: true }).catch((error) => {
      console.warn('[community] feed tab load failed', error)
      state.feedError = error?.message || 'Community feed could not be loaded.'
      state.feedInitialLoading = false
      state.feedLoadingMore = false
      state.feedStillLoading = false
      render()
    })
    if (isMobileSpaRuntime()) void hydrateMobileCommunitySharedState({ directory: false })
  })
}

async function hydrateMobileCommunitySharedState({ directory = false } = {}) {
  if (!isMobileSpaRuntime()) return
  const results = await Promise.allSettled([
    loadStories({ renderAfter: true, hydrateIdentity: true }),
    loadCommunities({ renderOnStart: false, renderAfter: false, bootstrap: !directory })
  ])
  if (state.view.type === 'feed') updateCommunityAncillaryDom()
  if (state.view.type === 'communities') {
    render()
  }
  results.forEach((result) => {
    if (result.status === 'rejected') console.warn('[community] mobile shared hydration failed', result.reason)
  })
}

setupCommunityFeedTabs()

if (!window.__melogicMobileCommunityDiscoverRouterV1) {
  window.__melogicMobileCommunityDiscoverRouterV1 = true
  document.addEventListener('click', (event) => {
    if (!isMobileSpaRuntime() || event.defaultPrevented || event.button !== 0) return
    const link = event.target instanceof Element
      ? event.target.closest('a[data-community-mobile-discover]')
      : null
    if (!(link instanceof HTMLAnchorElement)) return
    event.preventDefault()
    if (state.view.type === 'communities') return
    navigateMobileCommunitySurface('discover')
  })
}

// Desktop Network rail SPA: For You / Following / Discover retain mounted DOM,
 // loaded media/entities, feed state, and independent scroll positions.
if (!window.__melogicDesktopCommunitySurfaceRouterV1) {
  window.__melogicDesktopCommunitySurfaceRouterV1 = true
  document.addEventListener('click', (event) => {
    if (isMobileSpaRuntime() || event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element
      ? event.target.closest('a[data-community-desktop-surface]')
      : null
    if (!(link instanceof HTMLAnchorElement)) return
    const nextKey = String(link.dataset.communityDesktopSurface || '').trim()
    if (!['for-you', 'following', 'discover'].includes(nextKey)) return
    event.preventDefault()
    navigateDesktopCommunitySurface(nextKey)
  })
}

// melogic-community-spa-lifecycle-v4
function installCommunitySpaLifecycle() {
  if (!isMobileSpaRuntime() || window.__melogicCommunitySpaLifecycleV4) return
  window.__melogicCommunitySpaLifecycleV4 = true

  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!(anchor instanceof HTMLAnchorElement)) return
    if (anchor.target && anchor.target !== '_self') return
    if (anchor.hasAttribute('download')) return

    let url
    try { url = new URL(anchor.href, location.href) } catch { return }
    if (url.origin !== location.origin) return
    if (!(url.pathname === ROUTES.community || url.pathname.startsWith(`${ROUTES.community}/`))) return
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return
    if (!confirmCommunityNavigation(url.href)) return

    const postMatch = url.pathname.match(/^\/community\/post\/([^/]+)\/?$/)
    if (postMatch) {
      let postId = ''
      try { postId = decodeURIComponent(postMatch[1] || '') } catch {}
      if (!postId) return
      event.preventDefault()
      openPostDetail(postId, url.hash || '')
      return
    }

    // melogic-community-search-document-boundary-v1
    // /community/search is a separate Vite document (community-search.html),
    // not a Community feed/community-slug/query state. It must be allowed to
    // use the anchor's native document navigation. Intercepting it here with
    // preventDefault() + pushState() changes only the URL and leaves the
    // Community document mounted.
    if (url.pathname === '/community/search') return

    // Community feed/community-slug/query routes already have a substantial
    // state machine. Let the existing popstate route-restoration path own them:
    // push the URL, then dispatch popstate exactly once.
    event.preventDefault()
    const existingState = history.state && typeof history.state === 'object' ? history.state : {}
    history.pushState({
      ...existingState,
      melogicMobileSpa: true,
      routeId: 'community',
      pathname: url.pathname
    }, '', `${url.pathname}${url.search}${url.hash}`)
    window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
    emitMobileSpaNavigation({ type: 'push', routeId: 'community' })
  }, { capture: true })
}

installCommunitySpaLifecycle()

function setupCommunityPendingLeaveWarning() {
  if (communityBeforeUnloadReady) return
  communityBeforeUnloadReady = true
  document.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    const link = event.target instanceof Element ? event.target.closest('a[href]') : null
    if (!link || link.target === '_blank' || link.hasAttribute('download') || !isCommunityNavigationTarget(link.href)) return
    communityInternalNavigationPending = true
    window.setTimeout(() => {
      communityInternalNavigationPending = false
    }, 0)
  }, true)
  window.addEventListener('beforeunload', (event) => {
    if (!hasPendingCommunityActions() || communityInternalNavigationPending) return
    event.preventDefault()
    event.returnValue = ''
  })
}

function confirmCommunityNavigation(destination = '') {
  if (!hasPendingCommunityActions() || isCommunityNavigationTarget(destination)) return true
  return window.confirm('Community actions are still saving. Leave anyway?')
}

function clearFeedPostPointerHoverForCard(card) {
  if (!card) return
  const timers = communityPostHoverTimers.get(card)
  if (timers) {
    window.clearTimeout(timers.hold)
    window.clearTimeout(timers.fade)
    communityPostHoverTimers.delete(card)
  }
  card.classList.remove('is-pointer-hovered', 'is-pointer-hover-fading')
}

function clearFeedPostPointerHover(root = app) {
  if (root?.matches?.('.community-post-card.is-pointer-hovered')) clearFeedPostPointerHoverForCard(root)
  root?.querySelectorAll('.community-post-card.is-pointer-hovered').forEach(clearFeedPostPointerHoverForCard)
}

function setFeedPostPointerHover(card) {
  if (!card || card.classList.contains('is-detail')) return
  if (card.classList.contains('is-pointer-hovered')) return
  clearFeedPostPointerHover()
  card.classList.add('is-pointer-hovered')
  if (state.view.type !== 'feed' || state.activeTab !== 'for-you') return

  const hold = window.setTimeout(() => {
    if (!card.classList.contains('is-pointer-hovered')) return
    card.classList.add('is-pointer-hover-fading')
    const fade = window.setTimeout(() => clearFeedPostPointerHoverForCard(card), 5000)
    communityPostHoverTimers.set(card, { hold: 0, fade })
  }, 3000)
  communityPostHoverTimers.set(card, { hold, fade: 0 })
}

function stopCommunityActionEvent(event) {
  event?.preventDefault?.()
  event?.stopPropagation?.()
}

function communityCssEscape(value = '') {
  const clean = String(value || '')
  return window.CSS?.escape ? window.CSS.escape(clean) : clean.replace(/["\\]/g, '\\$&')
}

function feedQueryOptions() {
  return {
    tab: state.activeTab,
    communityId: state.view.type === 'community' && state.community ? state.community.communityId : '',
    communitySlug: state.view.type === 'community' && state.community ? state.community.slug : state.activeCommunitySlug,
    communityIds: state.view.type === 'feed' ? state.selectedCommunityFilters.slice(0, 10) : [],
    limitCount: COMMUNITY_PAGE_SIZE,
    tag: state.activeTag,
    search: state.feedSearch,
    sort: state.feedSort
  }
}

function feedQueryKey() {
  const options = feedQueryOptions()
  return JSON.stringify({
    view: state.view.type,
    communityId: options.communityId,
    slug: options.communitySlug,
    mode: state.activeTab,
    communityIds: [...options.communityIds].sort(),
    tag: options.tag,
    search: String(options.search || '').trim().toLowerCase(),
    sort: options.sort
  })
}

function resetFeedPagination() {
  state.feedCursor = null
  state.feedHasMore = true
  state.feedError = ''
  state.feedStillLoading = false
}

function slugifyCommunity(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function displayedCommunities() {
  return state.communities.filter((community) => community.status === 'active' && community.visibility === 'public')
}

function directoryCategoryOptions() {
  const categories = new Set(displayedCommunities().map((community) => community.category).filter(Boolean))
  return ['all', ...[...categories].sort((a, b) => a.localeCompare(b))]
}

function directoryCommunities() {
  const category = state.communityFilters.category || 'all'
  const search = String(state.communityFilters.search || '').trim().toLowerCase()
  return displayedCommunities()
    .filter((community) => category === 'all' || community.category === category)
    .filter((community) => {
      if (!search) return true
      return [community.name, community.slug, community.description, community.category]
        .some((value) => String(value || '').toLowerCase().includes(search))
    })
}

function defaultComposerState(patch = {}) {
  return {
    open: false,
    title: '',
    body: '',
    linkedProductId: '',
    communityId: '',
    destinationPickerOpen: false,
    destinationSearch: '',
    destinationLoading: false,
    destinationError: '',
    destinationItems: [],
    tags: '',
    visibility: 'public',
    attachments: [],
    fileAttachments: [],
    uploadProgress: 0,
    emojiOpen: false,
    mentionQuery: '',
    mentionResults: [],
    mentionSearchLoading: false,
    mentionSearchError: '',
    mentionedUsers: [],
    productPickerOpen: false,
    productPickerLoading: false,
    productPickerError: '',
    products: [],
    musicPickerOpen: false,
    musicPickerLoading: false,
    musicPickerError: '',
    musicPreviews: [],
    stagePickerOpen: false,
    stagePickerLoading: false,
    stagePickerError: '',
    stagePlans: [],
    studioPickerOpen: false,
    studioPickerLoading: false,
    studioPickerError: '',
    studioProjects: [],
    intent: '',
    intentData: {
      feedbackCategory: 'Mix',
      feedbackQuestion: '',
      feedbackDeadlineAt: '',
      collaborationRoleNeeded: 'Producer',
      collaborationGenre: '',
      collaborationCompensationType: 'Discuss',
      collaborationLocationMode: 'Remote',
      collaborationLocationText: '',
      collaborationDeadlineAt: ''
    },
    submitting: false,
    error: '',
    ...patch
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function restoreComposerDraft() {
  try {
    const raw = window.sessionStorage?.getItem(COMPOSER_DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      title: String(parsed.title || '').slice(0, 120),
      body: String(parsed.body || '').slice(0, 2000),
      tags: String(parsed.tags || '').slice(0, 160),
      communityId: String(parsed.communityId || '').slice(0, 180),
      visibility: parsed.visibility === 'public' ? 'public' : 'public',
      attachments: Array.isArray(parsed.attachments) ? parsed.attachments.filter((item) => item?.type && (item.targetId || item.productId || item.projectId || item.storagePath)).slice(0, 4) : [],
      mentionedUsers: Array.isArray(parsed.mentionedUsers) ? parsed.mentionedUsers.filter((item) => item?.uid).slice(0, 10) : [],
      intent: ['feedback_request', 'collaboration_request'].includes(parsed.intent) ? parsed.intent : '',
      intentData: parsed.intentData && typeof parsed.intentData === 'object' ? parsed.intentData : defaultComposerState().intentData
    }
  } catch {
    return null
  }
}

function persistComposerDraft() {
  try {
    const draft = {
      title: state.composer.title,
      body: state.composer.body,
      tags: state.composer.tags,
      communityId: state.composer.communityId,
      visibility: state.composer.visibility,
      attachments: state.composer.attachments,
      mentionedUsers: state.composer.mentionedUsers,
      intent: state.composer.intent,
      intentData: state.composer.intentData
    }
    const hasDraft = draft.title || draft.body || draft.tags || draft.communityId || draft.attachments.length || draft.mentionedUsers.length || draft.intent
    if (hasDraft) window.sessionStorage?.setItem(COMPOSER_DRAFT_KEY, JSON.stringify(draft))
    else window.sessionStorage?.removeItem(COMPOSER_DRAFT_KEY)
  } catch {
    // Draft persistence should never block posting.
  }
}

function clearComposerDraft() {
  try {
    window.sessionStorage?.removeItem(COMPOSER_DRAFT_KEY)
  } catch {
    // Ignore storage cleanup failures.
  }
}

function composerHasDraft() {
  return Boolean(state.composer.title || state.composer.body || state.composer.tags || state.composer.attachments.length || state.composer.fileAttachments.length || state.composer.mentionedUsers.length || state.composer.intent)
}

function parseDetailPostId() {
  const match = window.location.pathname.match(/^\/community\/post\/([^/]+)/)
  return match ? decodeURIComponent(match[1] || '') : ''
}

function parseFeedParam(key = '') {
  return new URLSearchParams(window.location.search).get(key) || ''
}

function parseCommunityView() {
  const path = window.location.pathname
  const communityMatch = path.match(/^\/community\/c\/([^/]+)/)
  if (communityMatch) return { type: 'community', slug: decodeURIComponent(communityMatch[1] || '') }
  if (path.startsWith('/community/communities')) return { type: 'communities' }
  if (path.startsWith('/community/create')) return { type: 'communities' }
  return { type: 'feed' }
}

function formatCount(value = 0) {
  const count = Math.max(0, Number(value || 0))
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`
  if (count >= 1000) return `${(count / 1000).toFixed(1)}K`
  return String(count)
}

function formatTime(value = '') {
  if (!value) return 'Just now'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Recently'
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })
}

function postAvatar(post) {
  const name = post.authorDisplayName || post.authorUsername || 'M'
  if (post.authorAvatarURL) return `<img src="${escapeHtml(post.authorAvatarURL)}" alt="${escapeHtml(name)} avatar" width="48" height="48" loading="lazy" decoding="async" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

function currentUserAvatar() {
  const user = state.currentUser || {}
  const name = user.displayName || user.email || 'M'
  const photoURL = user.photoURL || user.avatarURL || ''
  if (photoURL) return `<img src="${escapeHtml(photoURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

function currentUserStoryAvatar() {
  const user = state.currentUser || {}
  const name = user.displayName || user.email || 'M'
  const photoURL = user.photoURL || user.avatarURL || ''
  return `
    <span class="community-own-story-avatar ${photoURL ? 'has-photo' : 'has-fallback'}">
      ${photoURL
        ? `<img src="${escapeHtml(photoURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
        : `<span class="community-own-story-fallback">${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
      }
      <span class="community-own-story-dim" aria-hidden="true"></span>
      <span class="community-own-story-plus" aria-hidden="true">${iconSvg('plus')}</span>
    </span>
  `
}

function storyExpiresLabel(value = '') {
  const expiresMs = new Date(value || 0).getTime()
  if (!Number.isFinite(expiresMs)) return '24h'
  const diffMs = expiresMs - Date.now()
  if (diffMs <= 0) return 'Expired'
  const minutes = Math.ceil(diffMs / 60000)
  if (minutes < 60) return `${minutes}m left`
  return `${Math.ceil(minutes / 60)}h left`
}

function resetStoryPreviewURL() {
  if (state.storyComposer.previewURL) URL.revokeObjectURL(state.storyComposer.previewURL)
}

function cleanStoryComposerState(overrides = {}) {
  return {
    open: false,
    mode: 'upload',
    mediaType: 'video',
    text: '',
    background: 'aurora',
    file: null,
    previewURL: '',
    lifetimeHours: 24,
    visibility: 'public',
    storyType: 'moment',
    layers: [],
    selectedLayerId: '',
    remixOfStoryId: '',
    remixPermission: false,
    remixSourcePreviewURL: '',
    remixSourceMediaType: '',
    remixSourceAuthorDisplayName: '',
    uploadProgress: 0,
    recording: false,
    recordingSeconds: 0,
    recordingSupported: true,
    submitting: false,
    error: '',
    message: '',
    ...overrides
  }
}

function storyFileLabel(file = null) {
  if (!file) return ''
  const size = Number(file.size || 0)
  const mb = size ? `${(size / (1024 * 1024)).toFixed(size > 9 * 1024 * 1024 ? 0 : 1)} MB` : ''
  return [file.name || 'Story media selected', mb].filter(Boolean).join(' · ')
}

function storyById(storyId = '') {
  return state.stories.find((story) => story.storyId === storyId) || null
}

function pruneExpiredCommunityStories(now = Date.now()) {
  const activeStories = state.stories.filter((story) => {
    const expiresAt = new Date(story.expiresAt || 0).getTime()
    return !Number.isFinite(expiresAt) || expiresAt > now
  })
  if (activeStories.length === state.stories.length) return false
  const activeStoryExpired = state.storyViewer.open && !activeStories.some((story) => story.storyId === state.storyViewer.storyId)
  state.stories = activeStories
  if (activeStoryExpired) {
    suspendStoryViewerResources({ releaseMedia: true })
    state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
  }
  return true
}

function scheduleCommunityStoryExpiry() {
  if (storyExpiryTimer) window.clearTimeout(storyExpiryTimer)
  storyExpiryTimer = 0
  const now = Date.now()
  const nearest = state.stories
    .map((story) => new Date(story.expiresAt || 0).getTime())
    .filter((expiresAt) => Number.isFinite(expiresAt) && expiresAt > now)
    .sort((a, b) => a - b)[0]
  if (!nearest) return
  storyExpiryTimer = window.setTimeout(() => {
    storyExpiryTimer = 0
    if (pruneExpiredCommunityStories()) {
      updateStoryRegionsOnly()
      reconcileCommunitySharedRegions()
    }
    scheduleCommunityStoryExpiry()
  }, Math.min(2_147_000_000, Math.max(25, nearest - now + 25)))
}

function safeStoryTargetURL(value = '') {
  const clean = String(value || '').trim()
  if (!clean) return ''
  if (clean.startsWith('/') && !clean.startsWith('//')) return clean
  try {
    const parsed = new URL(clean, window.location.origin)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''
  } catch {
    return ''
  }
}

function storyProvenance(story = {}) {
  const nativeLayer = (story.layers || []).find((layer) => layer.type === 'project' && layer.metadata?.source === 'melogic')
  const kind = String(nativeLayer?.metadata?.melogicKind || '')
  const nativeLabels = { soura: 'Made with Soura', vertix: 'Made with Vertix', preset: 'Melogic Preset', sample: 'Melogic Sample', stage: 'Melogic Stage Plan' }
  const items = []
  if (story.remixOfStoryId) {
    items.push({
      kind: 'remix',
      label: `Remixed from ${story.remixSourceAuthorDisplayName || 'original creator'}`,
      detail: story.remixSourceCreatedAt ? formatTime(story.remixSourceCreatedAt) : '',
      targetId: story.remixOfStoryId
    })
  }
  if (nativeLayer) {
    items.push({
      kind: kind || 'melogic',
      label: nativeLabels[kind] || 'Made in Melogic',
      detail: nativeLayer.content || '',
      url: nativeLayer.targetURL || ''
    })
  }
  if (story.linkedProductId) items.push({ kind: 'product', label: 'Linked Melogic product', url: productRoute({ productId: story.linkedProductId }) })
  if (story.linkedPostId) items.push({ kind: 'post', label: 'Linked Community post', url: communityPostRoute({ postId: story.linkedPostId }) })
  return items
}

// melogic-story-author-groups-v1
// Stories are grouped by creator in the rail/viewer. Progress segments belong
// only to the creator currently being viewed, never to the global story list.
function storyAuthorKey(story = {}) {
  return String(story.authorUid || story.authorUsername || story.authorDisplayName || story.storyId || '').trim()
}

function storyGroups() {
  const groups = []
  const byAuthor = new Map()
  state.stories.forEach((story) => {
    const key = storyAuthorKey(story)
    let group = byAuthor.get(key)
    if (!group) {
      group = { key, stories: [] }
      byAuthor.set(key, group)
      groups.push(group)
    }
    group.stories.push(story)
  })
  return groups
}

function currentStoryGroup() {
  const current = storyById(state.storyViewer.storyId)
  if (!current) return null
  return storyGroups().find((group) => group.key === storyAuthorKey(current)) || null
}

function currentStoryIndex() {
  const group = currentStoryGroup()
  if (!group) return 0
  const index = group.stories.findIndex((story) => story.storyId === state.storyViewer.storyId)
  return index >= 0 ? index : 0
}

function storyAvatar(story) {
  const name = story.authorDisplayName || story.authorUsername || 'M'
  if (story.authorAvatarURL || story.authorPhotoURL) return `<img src="${escapeHtml(story.authorAvatarURL || story.authorPhotoURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

const COMMUNITY_FORM_LINKS = [
  {
    title: 'Support Forms',
    description: 'Send account, marketplace, and platform requests to the Melogic team.',
    href: ROUTES.support || '/support'
  },
  {
    title: 'Creator Forms',
    description: 'Find request workflows and creator intake forms as they move into Community.',
    href: ROUTES.forms || '/forms'
  }
]

function activeFeedTitle() {
  if (state.activeTab === 'forms') return 'Forms'
  if (state.activeTab === 'music') return 'Music'
  if (state.activeTab === 'products') return 'Products'
  if (state.activeTab === 'stage-plans') return 'Stagemaker Projects'
  if (state.activeTab === 'studio-projects') return 'DAW Projects'
  if (state.activeTab === 'live') return 'Live'
  if (state.activeTab === 'saved') return 'Saved'
  if (state.activeTab === 'my-content') return 'My Content'
  if (state.activeTab === 'my-account') return 'My Account'
  if (state.activeTab === 'feedback') return 'Feedback'
  if (state.activeTab === 'collaboration') return 'Collaboration'
  if (state.activeTab === 'following') return 'Following'
  if (state.activeTab === 'community') return state.activeTopicLabel || 'Community'
  if (state.activeTab === 'official') return 'Official'
  if (state.activeTab === 'new') return 'New'
  return 'For You'
}

function filterPostsForActiveTab(posts = []) {
  if (state.activeTab === 'music') return posts.filter((post) => post.attachmentTypes?.includes('music'))
  if (state.activeTab === 'products') return posts.filter((post) => post.attachmentTypes?.includes('product') || post.linkedProductId)
  if (state.activeTab === 'stage-plans') return posts.filter((post) => post.attachmentTypes?.includes('stage_plan'))
  if (state.activeTab === 'studio-projects') return posts.filter((post) => post.attachmentTypes?.includes('studio_project'))
  if (state.activeTab === 'feedback') return posts.filter((post) => post.intent === 'feedback_request')
  if (state.activeTab === 'collaboration') return posts.filter((post) => post.intent === 'collaboration_request')
  return posts
}

function updateFeedUrlParams() {
  if (state.view.type !== 'feed') return
  const params = new URLSearchParams(window.location.search)
  if (state.activeTag) params.set('tag', state.activeTag)
  else params.delete('tag')
  if (state.feedSearch) params.set('search', state.feedSearch)
  else params.delete('search')
  if (state.feedSort && state.feedSort !== 'new') params.set('sort', state.feedSort)
  else params.delete('sort')
  const query = params.toString()
  window.history.replaceState({}, '', `${ROUTES.community}${query ? `?${query}` : ''}`)
}

function normalizeTagKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function pinnedPostIds() {
  return new Set(Array.isArray(state.community?.pinnedPostIds) ? state.community.pinnedPostIds : [])
}

function sortPinnedPosts(posts = []) {
  const pinned = pinnedPostIds()
  if (!pinned.size) return posts
  return [...posts].sort((a, b) => {
    const aPinned = pinned.has(a.postId) || a.pinnedInCommunity
    const bPinned = pinned.has(b.postId) || b.pinnedInCommunity
    return Number(bPinned) - Number(aPinned)
  })
}

function visibleTopicCommunities() {
  return displayedCommunities().slice(0, 18)
}

function renderMobileCommunityTabs({ active = '' } = {}) {
  return `
    <div class="community-master-tabs community-mobile-primary-tabs" role="tablist" aria-label="Community navigation">
      <button type="button" role="tab" aria-selected="${active === 'for-you' ? 'true' : 'false'}" class="community-mobile-feed-tab ${active === 'for-you' ? 'is-active' : ''}" data-community-tab="for-you">For You</button>
      <button type="button" role="tab" aria-selected="${active === 'following' ? 'true' : 'false'}" class="community-following-feed-tab ${active === 'following' ? 'is-active' : ''}" data-community-tab="following">Following</button>
      <a class="community-mobile-discover-tab ${active === 'discover' ? 'is-active' : ''}" role="tab" aria-selected="${active === 'discover' ? 'true' : 'false'}" href="${ROUTES.communityCommunities}" data-community-mobile-discover>Discover</a>
    </div>
  `
}

function renderTopicBar() {
  // melogic-network-topics-p2
  // The current backend still filters these values by communityId. On desktop
  // they are now presented as Topics so the UI no longer teaches users that
  // every subject/category is a community. A later schema patch can replace
  // the compatibility IDs with canonical topic IDs without changing this UI.
  const topics = visibleTopicCommunities()
  const topicPills = topics.map((topic) => `
      <button type="button" class="community-topic-pill ${state.selectedCommunityFilters.includes(topic.communityId) ? 'is-active' : ''}" data-topic-community-id="${escapeHtml(topic.communityId)}" aria-pressed="${state.selectedCommunityFilters.includes(topic.communityId) ? 'true' : 'false'}">
        ${escapeHtml(topic.name)}
      </button>
    `).join('')

  return `
    <section class="community-feed-header community-network-home-header" aria-label="Home feed navigation and topics">
      <div class="community-network-home-title">
        <span>Network</span>
        <strong>Home</strong>
      </div>
      <div class="community-feed-mobile-tabs">
        ${renderMobileCommunityTabs({ active: state.activeTab })}
      </div>
      <label class="community-sort-control" title="Sort feed">
          <span class="sr-only">Sort feed</span>
          ${iconSvg('barChart')}
          <select data-community-feed-sort aria-label="Sort feed">
            <option value="new" ${state.feedSort === 'new' ? 'selected' : ''}>Latest</option>
            <option value="top-today" ${state.feedSort === 'top-today' ? 'selected' : ''}>Top Today</option>
            <option value="top-week" ${state.feedSort === 'top-week' ? 'selected' : ''}>Top Week</option>
            <option value="most-discussed" ${state.feedSort === 'most-discussed' ? 'selected' : ''}>Most Discussed</option>
          </select>
        </label>
      <div class="community-topic-context">
        <span class="community-topic-context-label">Topics</span>
        <div class="community-filter-shell">
          <div class="community-filter-strip" data-community-topic-scroll aria-label="Filter Home by topic">
            <button type="button" class="community-topic-pill ${state.selectedCommunityFilters.length ? '' : 'is-active'}" data-clear-community-filters aria-pressed="${state.selectedCommunityFilters.length ? 'false' : 'true'}">All</button>
            ${topicPills}
          </div>
          <button type="button" class="community-filter-arrow is-left" data-topic-scroll="-1" aria-label="Scroll topics left">${iconSvg('chevronRight')}</button>
          <button type="button" class="community-filter-arrow is-right" data-topic-scroll="1" aria-label="Scroll topics right">${iconSvg('chevronRight')}</button>
        </div>
      </div>
    </section>
  `
}

function renderStoriesRow() {
  const pendingStory = state.pendingStoryUpload
  const hasOwnActiveStory = Boolean(pendingStory || (state.currentUser?.uid && state.stories.some((story) => story.authorUid === state.currentUser.uid)))
  const pendingStoryItem = pendingStory ? `
    <button type="button" class="community-story-item is-pending-story ${pendingStory.status === 'failed' ? 'is-failed' : 'is-uploading'}" data-pending-story-action="${pendingStory.status === 'failed' ? 'retry' : ''}" ${pendingStory.status === 'failed' ? '' : 'disabled'}>
      <span class="community-story-ring community-story-upload-ring">
        <span class="community-story-avatar">
          ${pendingStory.previewURL ? `<img src="${escapeHtml(pendingStory.previewURL)}" alt="" />` : iconSvg('upload')}
        </span>
      </span>
      <strong>${pendingStory.status === 'failed' ? 'Retry Story' : 'Uploading…'}</strong>
    </button>
  ` : ''
  const realStoryItems = storyGroups().slice(0, 12).map((group) => {
    const story = group.stories[0]
    return `
      <button type="button" class="community-story-item ${communityAuthorIsVerified(story) ? 'is-verified-story' : ''}" data-open-story="${escapeHtml(story.storyId)}">
        <span class="community-story-ring"><span class="community-story-avatar ${story.mediaType === 'text' ? `story-bg-${escapeHtml(story.background)}` : ''} ${story.mediaType === 'video' ? 'has-video' : ''}">
          ${storyAvatar(story)}
        </span>${communityAuthorIsVerified(story) && communityVerifiedBadgeUrl ? `
          <span class="community-story-avatar-verified" aria-label="Verified" title="Verified">
            <img class="community-story-avatar-verified-shadow" src="${escapeHtml(communityVerifiedBadgeUrl)}" alt="" aria-hidden="true" />
            <img class="community-story-avatar-verified-icon" src="${escapeHtml(communityVerifiedBadgeUrl)}" alt="" aria-hidden="true" />
          </span>` : ''}</span>
        ${communityDisplayNameMarkup({ ...story, authorBadges: [] }, story.authorDisplayName || story.authorUsername || 'Creator')}
      </button>
    `
  }).join('')

  return `
    <section class="community-stories-row" aria-label="Community stories" data-community-stories-scroll>
      <div class="community-stories-label" aria-hidden="true">
        <strong>Stories</strong>
        <span>Creator updates</span>
      </div>
      ${pendingStoryItem}
      <button type="button" class="community-story-item is-create ${hasOwnActiveStory ? 'has-active-story' : ''}" data-open-story-composer>
        <span class="community-story-ring"><span class="community-story-avatar is-create">${currentUserStoryAvatar()}</span></span>
        <strong>${hasOwnActiveStory ? 'Add Story' : 'Your Story'}</strong>
      </button>
      ${realStoryItems}
      ${!state.storiesLoading && !state.storiesError && !state.stories.length ? `
        <div class="community-story-empty-state">
          <span>No Stories Yet</span>
          <button type="button" data-open-story-composer>Be the first</button>
        </div>
      ` : ''}
      ${state.storiesLoading ? '<span class="community-story-empty">Loading stories...</span>' : ''}
      ${state.storiesError ? `<span class="community-story-empty">${escapeHtml(state.storiesError)}</span>` : ''}
    </section>
  `
}

function renderStoryComposerModal() {
  if (!state.storyComposer.open) return ''
  const isRecordMode = state.storyComposer.mode === 'record'
  const isVideo = state.storyComposer.mediaType === 'video'
  const hasPreview = Boolean(state.storyComposer.previewURL || state.storyComposer.remixSourcePreviewURL)
  const previewURL = state.storyComposer.previewURL || state.storyComposer.remixSourcePreviewURL
  const previewMediaType = state.storyComposer.previewURL ? state.storyComposer.mediaType : state.storyComposer.remixSourceMediaType
  const isSourceOnlyPreview = Boolean(!state.storyComposer.previewURL && state.storyComposer.remixSourcePreviewURL)
  const progress = Math.max(0, Math.min(100, Number(state.storyComposer.uploadProgress || 0)))
  return `
    <div class="community-modal-backdrop">
      <section class="community-story-modal" role="dialog" aria-modal="true" aria-labelledby="community-story-composer-title">
        <header>
          <div>
            <p class="eyebrow">Story</p>
            <h2 id="community-story-composer-title">Create Story</h2>
            <p>Share a short update with the Melogic community.</p>
          </div>
          <button type="button" data-close-story-composer aria-label="Close story composer" ${state.storyComposer.submitting ? 'disabled' : ''}>${iconSvg('x')}</button>
        </header>
        ${state.storyComposer.message ? `<p class="community-success">${escapeHtml(state.storyComposer.message)}</p>` : `
          <form data-story-composer-form>
            ${state.storyComposer.remixOfStoryId ? `<div class="community-story-remix-banner"><span>REMIX</span><strong>From ${escapeHtml(state.storyComposer.remixSourceAuthorDisplayName || 'original creator')}</strong><small>Original attribution remains attached to your Story.</small></div>` : ''}
            <div class="community-story-type-switch" role="group" aria-label="Story type">
              ${[
                ['moment','Moment'], ['sound','Sound'], ['thought','Thought'], ['drop','Drop'],
                ['ask','Ask'], ['live','Live'], ['project','Project']
              ].map(([value,label]) => `<button type="button" data-story-type="${value}" class="${state.storyComposer.storyType === value ? 'is-active' : ''}" aria-pressed="${state.storyComposer.storyType === value ? 'true' : 'false'}">${label}</button>`).join('')}
            </div>
            <div class="community-story-mode-switch" role="group" aria-label="Story media source">
              <button type="button" data-story-mode="upload" class="${state.storyComposer.mode === 'upload' ? 'is-active' : ''}" aria-pressed="${state.storyComposer.mode === 'upload' ? 'true' : 'false'}" ${state.storyComposer.submitting ? 'disabled' : ''}>${iconSvg('upload')} <span>Upload</span></button>
              <button type="button" data-story-mode="record" class="${isRecordMode ? 'is-active' : ''}" aria-pressed="${isRecordMode ? 'true' : 'false'}" ${state.storyComposer.submitting ? 'disabled' : ''}>${iconSvg('play')} <span>Record</span></button>
            </div>
            <div class="community-story-composer-layout">
              <div class="community-story-media-column">
                <div class="community-story-preview ${hasPreview || state.storyComposer.recording ? 'has-media' : ''}" data-story-dropzone>
                  ${hasPreview
                    ? previewMediaType === 'video'
                      ? `<video src="${escapeHtml(previewURL)}" controls playsinline preload="metadata"></video>`
                      : `<img src="${escapeHtml(previewURL)}" alt="Story preview" />`
                    : isRecordMode
                      ? `<video data-story-record-preview autoplay muted playsinline></video>`
                      : `
                        <label class="community-story-dropzone ${state.storyComposer.submitting ? 'is-disabled' : ''}">
                          ${iconSvg('upload')}
                          <strong>Drop media here or choose a file</strong>
                          <span>Images and videos · optimized automatically before upload</span>
                          <em>Stories can be up to 60 seconds.</em>
                          <input name="storyMedia" type="file" accept="image/*,video/*,.heic,.heif,.avif,.mov,.m4v,.avi,.mkv,.3gp,.3g2,.mpeg,.mpg,.ogv" data-story-file ${state.storyComposer.submitting ? 'disabled' : ''} />
                        </label>
                      `
                  }
                  ${hasPreview ? `
                    <div class="community-story-layer-canvas" data-story-layer-canvas aria-label="Story layer editor">
                      ${(state.storyComposer.layers || []).map((layer) => `
                        <button type="button" class="community-story-layer-node ${state.storyComposer.selectedLayerId === layer.id ? 'is-selected' : ''}" data-story-layer-id="${escapeHtml(layer.id)}" style="--layer-x:${layer.x};--layer-y:${layer.y};--layer-w:${layer.width};--layer-scale:${layer.scale || 1};--layer-rotation:${layer.rotation || 0}deg;--layer-z:${layer.zIndex || 0}" aria-label="Edit text layer">
                          <span>${escapeHtml(layer.content || 'Text')}</span>
                        </button>
                      `).join('')}
                    </div>
                  ` : ''}
                </div>
                ${hasPreview ? `
                  <div class="community-story-layer-toolbar" aria-label="Story layers">
                    <button type="button" data-story-add-text-layer>${iconSvg('plus')} <span>Text</span></button>
                    <button type="button" data-story-add-object="person"><span>@</span><span>Person</span></button>
                    <button type="button" data-story-add-object="link">${iconSvg('link')}<span>Link</span></button>
                    <button type="button" data-story-add-object="location"><span>⌖</span><span>Location</span></button>
                    <button type="button" data-story-add-object="community"><span>◎</span><span>Community</span></button>
                    <button type="button" data-story-add-object="audio">${iconSvg('play')}<span>Song</span></button>
                    <button type="button" data-story-add-object="product"><span>◇</span><span>Product</span></button>
                    <button type="button" data-story-add-object="event"><span>◫</span><span>Event</span></button>
                    <button type="button" data-story-add-object="poll"><span>▥</span><span>Poll</span></button>
                    <button type="button" data-story-add-object="project" data-story-native-kind="soura"><span>◈</span><span>Soura</span></button>
                    <button type="button" data-story-add-object="project" data-story-native-kind="vertix"><span>⬡</span><span>Vertix</span></button>
                    <button type="button" data-story-add-object="project" data-story-native-kind="preset"><span>≋</span><span>Preset</span></button>
                    <button type="button" data-story-add-object="project" data-story-native-kind="sample"><span>⌁</span><span>Sample</span></button>
                    <button type="button" data-story-add-object="project" data-story-native-kind="stage"><span>▦</span><span>Stage Plan</span></button>
                    ${state.storyComposer.selectedLayerId ? `
                      <button type="button" data-story-layer-scale-down aria-label="Make layer smaller">−</button>
                      <button type="button" data-story-layer-scale-up aria-label="Make layer larger">+</button>
                      <button type="button" data-story-layer-forward aria-label="Bring layer forward">↑</button>
                      <button type="button" data-story-layer-delete aria-label="Delete layer">${iconSvg('trash')}</button>
                    ` : ''}
                  </div>
                ` : ''}
                ${isRecordMode ? `
                  <div class="community-story-record-controls">
                    <div>
                      <strong>${state.storyComposer.recording ? 'Recording story' : hasPreview ? 'Recording ready' : 'Camera and microphone'}</strong>
                      <span data-story-record-timer>${state.storyComposer.recording ? `${state.storyComposer.recordingSeconds}s / ${STORY_MAX_RECORD_SECONDS}s` : hasPreview ? storyFileLabel(state.storyComposer.file) : 'Record up to 60 seconds in this browser.'}</span>
                    </div>
                    ${state.storyComposer.recording
                      ? `<button type="button" class="button button-accent" data-stop-story-recording>Stop Recording</button>`
                      : `<button type="button" class="button button-accent" data-start-story-recording ${state.storyComposer.submitting ? 'disabled' : ''}>${hasPreview ? 'Record Again' : 'Start Recording'}</button>`
                    }
                  </div>
                  <p class="community-muted-note">Your browser will ask for camera and microphone access. You can switch back to Upload at any time.</p>
                ` : `
                  ${hasPreview ? `
                    <div class="community-story-selected-file">
                      <span>${isVideo ? iconSvg('play') : iconSvg('image')}</span>
                      <div><strong>${escapeHtml(state.storyComposer.file?.name || 'Story media')}</strong><small>${escapeHtml(storyFileLabel(state.storyComposer.file).split(' · ').slice(1).join(' · ') || (isVideo ? 'Video' : 'Image'))}</small></div>
                      <label class="button button-muted ${state.storyComposer.submitting ? 'is-disabled' : ''}">
                        Replace
                        <input name="storyMedia" type="file" accept="image/*,video/*,.heic,.heif,.avif,.mov,.m4v,.avi,.mkv,.3gp,.3g2,.mpeg,.mpg,.ogv" data-story-file ${state.storyComposer.submitting ? 'disabled' : ''} />
                      </label>
                      ${!isSourceOnlyPreview ? `<button type="button" class="community-story-remove-file" data-remove-story-file aria-label="Remove selected story media" ${state.storyComposer.submitting ? 'disabled' : ''}>${iconSvg('x')}</button>` : ''}
                      ${isSourceOnlyPreview ? `<div class="community-story-remix-media-notice"><strong>Original media preview</strong><span>Choose your own photo/video before publishing. The source stays attributed.</span></div>` : ''}
                    </div>
                  ` : ''}
                `}
              </div>
              <aside class="community-story-settings">
                <div class="community-story-settings-heading">
                  <span>Story Details</span>
                  <small>Keep it short and easy to scan.</small>
                </div>
                <label class="community-story-remix-permission">
                  <input type="checkbox" data-story-remix-permission ${state.storyComposer.remixPermission ? 'checked' : ''} />
                  <span>Allow others to remix this Story</span>
                </label>
                ${state.storyComposer.remixOfStoryId ? `<p class="community-story-remix-source">Remix · original Story attribution will be preserved</p>` : ''}
                <label>
                  <span>Caption</span>
                  <textarea name="text" maxlength="500" rows="5" placeholder="What would you like to share?" ${state.storyComposer.submitting ? 'disabled' : ''}>${escapeHtml(state.storyComposer.text)}</textarea>
                  <small>${Math.max(0, 500 - state.storyComposer.text.length)} characters remaining</small>
                </label>
                <div class="community-story-options-grid">
                  <label>
                    <span>Lifetime</span>
                    <select name="lifetimeHours" data-story-lifetime ${state.storyComposer.submitting ? 'disabled' : ''}>
                      ${STORY_LIFETIME_OPTIONS.map((hours) => `<option value="${hours}" ${Number(state.storyComposer.lifetimeHours) === hours ? 'selected' : ''}>${hours} hours</option>`).join('')}
                    </select>
                    <small>Automatically disappears.</small>
                  </label>
                  <label>
                    <span>Visibility</span>
                    <select name="visibility" data-story-visibility ${state.storyComposer.submitting ? 'disabled' : ''}>
                      <option value="public" selected>Public</option>
                      <option value="focused" disabled>Focused coming soon</option>
                      <option value="followers" disabled>Followers coming soon</option>
                    </select>
                    <small>Visible across Community.</small>
                  </label>
                </div>
                <div class="community-story-publish-summary">
                  ${iconSvg('eye')}
                  <span><strong>Public Story</strong><small>Expires after ${formatCount(state.storyComposer.lifetimeHours)} hours.</small></span>
                </div>
              </aside>
            </div>
            ${state.storyComposer.submitting ? `
              <div class="community-story-progress-block" aria-live="polite">
                <div><strong>${progress >= 100 ? 'Finishing your story...' : 'Uploading story...'}</strong><span>${formatCount(progress)}%</span></div>
                <div class="community-story-progress" aria-label="Story upload progress">
                  <span style="width: ${progress}%"></span>
                  <em>${formatCount(progress)}%</em>
                </div>
              </div>
            ` : ''}
            ${state.storyComposer.error ? `<p class="community-error">${escapeHtml(state.storyComposer.error)}</p>` : ''}
            <div class="community-form-actions community-story-actions">
              <span>${state.storyComposer.file ? 'Your selected media is ready to publish.' : 'Add media before publishing your Story.'}</span>
              <button type="button" class="button button-muted" data-close-story-composer ${state.storyComposer.submitting ? 'disabled' : ''}>Cancel</button>
              <button type="submit" class="button button-accent" ${state.storyComposer.submitting ? 'disabled' : ''}>${state.storyComposer.submitting ? 'Publishing...' : 'Publish Story'}</button>
            </div>
          </form>
        `}
      </section>
    </div>
  `
}

function renderStoryViewerModal() {
  if (!state.storyViewer.open) return ''
  const story = storyById(state.storyViewer.storyId)
  if (!story) return ''
  const group = currentStoryGroup()
  const groupStories = group?.stories || [story]
  const index = currentStoryIndex()
  const isOwn = state.currentUser?.uid && state.currentUser.uid === story.authorUid
  const profileHref = story.authorUid ? publicProfileRoute({ uid: story.authorUid }) : ROUTES.profilePublic
  const provenance = storyProvenance(story)
  const contextItems = (story.layers || []).filter((layer) => ['person','location','community','audio','product','event','poll','project'].includes(layer.type))
  const contextLabels = { person:'Person', location:'Location', community:'Community', audio:'Sound', product:'Product', event:'Event', poll:'Poll', project:'Project' }
  return `
    <div class="community-modal-backdrop${isMobileSpaRuntime() || window.matchMedia?.('(max-width: 760px)').matches ? '' : ' community-story-mobile-desktop-host'}">
      <section class="community-story-viewer" role="dialog" aria-modal="true" aria-labelledby="community-story-viewer-title">
        <header class="community-story-viewer-hud">
          <div class="community-story-progress-rail" aria-label="Story ${formatCount(index + 1)} of ${formatCount(groupStories.length)}">
            ${groupStories.map((groupStory, storyIndex) => {
              const signalValues = storySignalCache.get(groupStory.storyId) || storySignalFallback(groupStory.storyId)
              const signalBars = signalValues.map((value, barIndex) => `<b style="--signal-bar:${barIndex};--signal-height:${Math.round(value * 100)}%" data-story-signal-index="${barIndex}"></b>`).join('')
              return `<span class="${storyIndex < index ? 'is-complete' : storyIndex === index ? 'is-active' : ''} ${groupStory.mediaType === 'video' ? 'has-story-signal' : ''}"><span class="community-story-signal-bars" aria-hidden="true">${signalBars}</span><i></i></span>`
            }).join('')}
          </div>
          <div class="community-story-viewer-hud-row">
            <a class="community-author" href="${profileHref}">
              <span class="community-avatar">${storyAvatar(story)}</span>
              <span class="community-story-viewer-identity">
                ${communityDisplayNameMarkup(story, 'Melogic Creator', 'community-story-viewer-title')}
                <button type="button" class="community-story-time-toggle" data-story-time-toggle data-story-posted-label="${escapeHtml(formatTime(story.createdAt))}" data-story-left-label="${escapeHtml(storyExpiresLabel(story.expiresAt))}" aria-label="Show time remaining">${escapeHtml(formatTime(story.createdAt))}</button>
              </span>
            </a>
            <div class="community-story-viewer-hud-actions">
              <button type="button" class="community-story-viewer-more" data-story-actions-toggle aria-label="More Story options" aria-expanded="false">${iconSvg('moreHorizontal')}</button>
              <button type="button" class="community-story-viewer-close" data-close-story-viewer aria-label="Close story viewer">${iconSvg('x')}</button>
            </div>
          </div>
        </header>
        <div class="community-story-action-rail" data-story-action-rail hidden>
          <button type="button" data-story-action="remix">${iconSvg('refreshCw')}<span>Remix</span></button>
          <button type="button" data-story-action="save">${iconSvg('bookmark')}<span>Save</span></button>
          <button type="button" data-story-action="collection">${iconSvg('plus')}<span>Collection</span></button>
          <button type="button" data-story-action="context">${iconSvg('info')}<span>Context</span></button>
          <button type="button" data-story-action="source">${iconSvg('link')}<span>Source</span></button>
          <button type="button" data-story-action="report">${iconSvg('alertCircle')}<span>Report</span></button>
        </div>
        ${provenance.length ? `<div class="community-story-provenance" data-story-provenance>
          ${provenance.map((item) => `<button type="button" data-story-provenance-kind="${escapeHtml(item.kind)}" data-story-provenance-url="${escapeHtml(safeStoryTargetURL(item.url) || '')}" data-story-provenance-id="${escapeHtml(item.targetId || '')}"><span>${iconSvg(item.kind === 'remix' ? 'refreshCw' : item.kind === 'product' ? 'shoppingBag' : 'link')}</span><span><strong>${escapeHtml(item.label)}</strong>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</span></button>`).join('')}
        </div>` : ''}
        <aside class="community-story-context-drawer" data-story-context-drawer aria-hidden="true">
          <header><div><small>STORY CONTEXT</small><strong>${escapeHtml(story.authorDisplayName || story.authorUsername || 'Melogic Creator')}</strong></div><button type="button" data-close-story-context aria-label="Close Story context">${iconSvg('x')}</button></header>
          <div class="community-story-context-summary">
            <span>${escapeHtml((story.storyType || 'moment').toUpperCase())}</span>
            <span>${escapeHtml(story.mediaType || 'story')}</span>
            <span>${escapeHtml(storyExpiresLabel(story.expiresAt))}</span>
          </div>
          ${story.caption || story.text ? `<p class="community-story-context-caption">${escapeHtml(story.caption || story.text)}</p>` : ''}
          ${contextItems.length ? `<section><h3>In this Story</h3>${contextItems.map((layer) => `<button type="button" data-story-context-url="${escapeHtml(safeStoryTargetURL(layer.targetURL) || '')}"><small>${escapeHtml(contextLabels[layer.type] || 'Item')}</small><strong>${escapeHtml(layer.content || contextLabels[layer.type] || 'Story item')}</strong></button>`).join('')}</section>` : ''}
          ${provenance.length ? `<section><h3>Sources</h3>${provenance.map((item) => `<button type="button" data-story-context-url="${escapeHtml(safeStoryTargetURL(item.url) || '')}" data-story-context-story-id="${escapeHtml(item.targetId || '')}"><small>${escapeHtml(item.kind || 'source')}</small><strong>${escapeHtml(item.label)}</strong></button>`).join('')}</section>` : ''}
        </aside>
        <div class="community-story-type-badge is-${escapeHtml(story.storyType || 'moment')}">${escapeHtml((story.storyType || 'moment').toUpperCase())}</div>
        <div class="community-story-surface story-bg-${escapeHtml(story.background || 'aurora')} ${story.mediaType === 'image' || story.mediaType === 'video' ? 'has-image' : ''}">
          ${story.mediaType === 'video' && story.mediaURL
            ? `<video src="${escapeHtml(story.mediaURL)}" autoplay muted playsinline preload="auto" controlslist="nodownload nofullscreen noremoteplayback" disablepictureinpicture></video>`
            : story.mediaType === 'image' && story.mediaURL
              ? `<img src="${escapeHtml(story.mediaURL)}" alt="" loading="eager" decoding="async" />`
              : `<p>${escapeHtml(story.text)}</p>`
          }
          ${(story.mediaType === 'image' || story.mediaType === 'video') && (story.caption || story.text) ? `<p class="community-story-caption">${escapeHtml(story.caption || story.text)}</p>` : ''}
          ${(story.layers || []).length ? `<div class="community-story-viewer-layers">
            ${story.layers.map((layer) => {
              const style = `--layer-x:${layer.x};--layer-y:${layer.y};--layer-w:${layer.width};--layer-scale:${layer.scale || 1};--layer-rotation:${layer.rotation || 0}deg;--layer-z:${layer.zIndex || 0}`
              if (layer.type === 'person') return `<a class="community-story-object is-person" style="${style}" href="${escapeHtml(safeStoryTargetURL(layer.targetURL) || (layer.targetId ? publicProfileRoute({ uid: layer.targetId }) : '#'))}"><span>@</span><strong>${escapeHtml(layer.content || 'Person')}</strong></a>`
              if (layer.type === 'link') return `<a class="community-story-object is-link" style="${style}" href="${escapeHtml(safeStoryTargetURL(layer.targetURL) || '#')}" target="_blank" rel="noopener noreferrer">${iconSvg('link')}<strong>${escapeHtml(layer.content || 'Open link')}</strong></a>`
              if (layer.type === 'location') return `<a class="community-story-object is-location" style="${style}" href="${escapeHtml(safeStoryTargetURL(layer.targetURL) || '#')}" target="_blank" rel="noopener noreferrer"><span>⌖</span><strong>${escapeHtml(layer.content || 'Location')}</strong></a>`
              if (layer.type === 'community') return `<a class="community-story-object is-community" style="${style}" href="${escapeHtml(layer.targetURL || (layer.targetId ? `/community/${encodeURIComponent(layer.targetId)}` : '#'))}"><span>◎</span><strong>${escapeHtml(layer.content || 'Community')}</strong></a>`
              if (layer.type === 'audio') return `<a class="community-story-object is-audio" style="${style}" href="${escapeHtml(safeStoryTargetURL(layer.targetURL) || '#')}" target="_blank" rel="noopener noreferrer">${iconSvg('play')}<span><small>LISTEN</small><strong>${escapeHtml(layer.content || 'Song')}</strong></span></a>`
              if (layer.type === 'product') return `<a class="community-story-object is-product" style="${style}" href="${escapeHtml(layer.targetURL || (layer.targetId ? productRoute({ productId: layer.targetId }) : '#'))}"><span>◇</span><span><small>PRODUCT</small><strong>${escapeHtml(layer.content || 'View product')}</strong></span></a>`
              if (layer.type === 'event') return `<a class="community-story-object is-event" style="${style}" href="${escapeHtml(safeStoryTargetURL(layer.targetURL) || '#')}"><span>◫</span><span><small>EVENT</small><strong>${escapeHtml(layer.content || 'View event')}</strong></span></a>`
              if (layer.type === 'poll') {
                const options = String(layer.metadata?.options || '').split('|').filter(Boolean)
                return `<div class="community-story-object is-poll" style="${style}" data-story-poll><strong>${escapeHtml(layer.content || 'Poll')}</strong><div>${options.map((option, optionIndex) => `<button type="button" data-story-poll-option="${optionIndex}">${escapeHtml(option)}</button>`).join('')}</div></div>`
              }
              if (layer.type === 'project') {
                const kind = String(layer.metadata?.melogicKind || 'project')
                const labels = { soura: 'SOURA PROJECT', vertix: 'VERTIX SCENE', preset: 'PRESET', sample: 'SAMPLE', stage: 'STAGE PLAN', project: 'MELOGIC' }
                const glyphs = { soura: '◈', vertix: '⬡', preset: '≋', sample: '⌁', stage: '▦', project: '◆' }
                return `<a class="community-story-object is-melogic-native is-${escapeHtml(kind)}" style="${style}" href="${escapeHtml(safeStoryTargetURL(layer.targetURL) || '#')}"><span class="community-story-native-glyph">${glyphs[kind] || '◆'}</span><span><small>${labels[kind] || 'MELOGIC'}</small><strong>${escapeHtml(layer.content || 'Open in Melogic')}</strong></span><em>Open</em></a>`
              }
              if (layer.type === 'text') return `<span class="community-story-object is-text" style="${style}"><strong>${escapeHtml(layer.content || '')}</strong></span>`
              return ''
            }).join('')}
          </div>` : ''}
        </div>
        <div class="community-story-mobile-interactions">
          <form class="community-story-reply-shell" data-story-reply-form aria-label="Reply to Story">
            <input type="text" data-story-reply-input aria-label="Reply to ${escapeHtml(story.authorDisplayName || story.username || 'creator')}" placeholder="${escapeHtml((story.layers || []).some((layer) => layer.type === 'audio') ? 'Ask about this track…' : `Reply to ${story.authorDisplayName || story.username || 'creator'}…`)}" maxlength="240" autocomplete="off" />
            <button type="submit" data-story-reply-send aria-label="Send Story reply">${iconSvg('send')}</button>
          </form>
          <div class="community-story-reaction-anchor">
            <div class="community-story-reaction-orbit" data-story-reaction-orbit aria-hidden="true">
              <button type="button" data-story-quick-reaction="fire" aria-label="React fire"><span>🔥</span></button>
              <button type="button" data-story-quick-reaction="laugh" aria-label="React laugh"><span>😂</span></button>
              <button type="button" data-story-quick-reaction="mindblown" aria-label="React mind blown"><span>🤯</span></button>
              <button type="button" data-story-quick-reaction="clap" aria-label="React applause"><span>👏</span></button>
              <button type="button" data-story-quick-reaction="dead" aria-label="React dead"><span>💀</span></button>
            </div>
            <button type="button" class="community-story-mobile-like" data-story-reaction="like:${escapeHtml(story.storyId)}" aria-label="Like story" aria-expanded="false">${iconSvg('heart')}</button>
          </div>
          <button type="button" class="community-story-mobile-share" data-story-mobile-share="${escapeHtml(story.storyId)}" aria-label="Share story">${iconSvg('send')}</button>
        </div>
        <div class="community-story-desktop-controls">
          <div class="community-story-discussion">
            <div class="community-story-reactions" aria-label="Story reactions">
              <button type="button" data-story-reaction="like:${escapeHtml(story.storyId)}">${iconSvg('thumbsUp')} <span>Like</span></button>
              <button type="button" data-story-reaction="dislike:${escapeHtml(story.storyId)}">${iconSvg('thumbsDown')} <span>Dislike</span></button>
            </div>
            <form data-story-comment-form="${escapeHtml(story.storyId)}">
              <label for="story-comment-${escapeHtml(story.storyId)}">Comment</label>
              <div>
                <input id="story-comment-${escapeHtml(story.storyId)}" name="storyComment" type="text" maxlength="240" placeholder="Story comments are coming soon." disabled />
                <button type="submit" disabled aria-label="Send story comment">${iconSvg('send')}</button>
              </div>
            </form>
          </div>
          <footer class="community-story-viewer-actions">
            <button type="button" data-story-prev ${storyGroups().length <= 1 && groupStories.length <= 1 ? 'disabled' : ''}>${iconSvg('arrowLeft')} <span>Prev</span></button>
            <span>${formatCount(index + 1)} / ${formatCount(groupStories.length)} · ${iconSvg('eye')} ${formatCount(story.viewCount)}</span>
            <button type="button" data-story-next ${storyGroups().length <= 1 && groupStories.length <= 1 ? 'disabled' : ''}><span>Next</span> ${iconSvg('chevronRight')}</button>
            <button type="button" data-story-report="${escapeHtml(story.storyId)}">${iconSvg('alertCircle')} <span>Report</span></button>
            ${isOwn ? `<button type="button" data-story-delete="${escapeHtml(story.storyId)}">${iconSvg('trash')} <span>Delete</span></button>` : ''}
          </footer>
        </div>
        ${state.storyViewer.error ? `<p class="community-error">${escapeHtml(state.storyViewer.error)}</p>` : ''}
      </section>
    </div>
  `
}

function currentComposerCommunity() {
  const communityId = String(state.composer.communityId || '').trim()
  if (!communityId) return null
  return [...state.composer.destinationItems, ...state.communities, state.community]
    .find((community) => community?.communityId === communityId) || null
}

function selectedProductAttachment() {
  return state.composer.attachments.find((attachment) => attachment.type === 'product') || null
}

function selectedAttachment(type = '') {
  return state.composer.attachments.find((attachment) => attachment.type === type) || null
}

function selectedAttachments(type = '') {
  return state.composer.attachments.filter((attachment) => attachment.type === type)
}

function attachmentKey(attachment = {}) {
  return attachment.targetId || attachment.productId || attachment.projectId || attachment.storagePath || attachment.sourceId || ''
}

function canAddAttachment(type = '') {
  const count = selectedAttachments(type).length
  if (type === 'music') return count < 2 && state.composer.attachments.length < 4
  return count < 1 && state.composer.attachments.length < 4
}

function productAttachmentFromProduct(product = {}) {
  return {
    type: 'product',
    targetId: product.productId || product.id || '',
    productId: product.productId || product.id || '',
    snapshot: {
      title: product.title || 'Untitled product',
      slug: product.slug || '',
      thumbnailURL: product.thumbnailURL || product.coverURL || '',
      creatorName: product.creatorName || '',
      priceCents: Math.max(0, Number(product.priceCents || 0)),
      isFree: Boolean(product.isFree) || Number(product.priceCents || 0) <= 0,
      currency: product.currency || 'USD'
    }
  }
}

function productAttachmentPreview(attachment = {}) {
  if (!attachment?.productId && !attachment?.targetId) return ''
  const snapshot = attachment.snapshot || {}
  const productId = attachment.productId || attachment.targetId || ''
  const href = productRoute({ id: productId, slug: snapshot.slug || snapshot.title || '' })
  const price = snapshot.isFree ? 'Free' : Number(snapshot.priceCents || 0) ? `$${(Number(snapshot.priceCents || 0) / 100).toFixed(2)}` : ''
  return `
    <article class="community-composer-attachment">
      <a href="${href}" target="_blank" rel="noopener">
        ${snapshot.thumbnailURL ? `<img src="${escapeHtml(snapshot.thumbnailURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('package')}</span>`}
        <span>
          <strong>${escapeHtml(snapshot.title || 'Product')}</strong>
          <em>${escapeHtml([snapshot.creatorName, price].filter(Boolean).join(' · '))}</em>
        </span>
      </a>
      <button type="button" data-remove-composer-attachment="product" aria-label="Remove product attachment">${iconSvg('x')}</button>
    </article>
  `
}

function musicAttachmentFromPreview(preview = {}) {
  return {
    type: 'music',
    targetId: preview.targetId || preview.storagePath || '',
    sourceType: preview.sourceType || 'product_preview',
    sourceId: preview.sourceId || '',
    storagePath: preview.storagePath || '',
    audioURL: preview.audioURL || '',
    snapshot: preview.snapshot || {}
  }
}

function stagePlanAttachmentFromProject(project = {}) {
  return {
    type: 'stage_plan',
    targetId: project.projectId || project.id || '',
    projectId: project.projectId || project.id || '',
    snapshot: {
      title: project.title || 'Untitled Stage Plan',
      templateName: project.stageType || 'Stage Plan',
      stageWidth: Number(project.stageWidth || 0),
      stageDepth: Number(project.stageDepth || 0),
      units: project.units || 'ft',
      objectCount: Number(project.objectCount || 0),
      previewImageURL: '',
      ownerDisplayName: state.currentUser?.displayName || '',
      ownerUsername: '',
      visibility: project.visibility || 'private',
      sharePath: project.visibility === 'public' ? stageProjectRoute(project.projectId || project.id || '') : ''
    }
  }
}

function studioProjectAttachmentFromProject(project = {}) {
  return {
    type: 'studio_project',
    targetId: project.projectId || project.id || '',
    projectId: project.projectId || project.id || '',
    snapshot: {
      title: project.title || 'Untitled Studio Project',
      bpm: Number(project.bpm || 0),
      key: project.key || '',
      durationSeconds: 0,
      trackCount: Number(project.trackCount || 0),
      coverURL: '',
      previewAudioPath: '',
      creatorDisplayName: state.currentUser?.displayName || '',
      creatorUsername: '',
      visibility: project.visibility || 'private',
      sharePath: ''
    }
  }
}

function attachmentTitle(attachment = {}) {
  const snapshot = attachment.snapshot || {}
  if (attachment.type === 'product') return snapshot.title || 'Product'
  if (attachment.type === 'music') return snapshot.title || 'Music preview'
  if (attachment.type === 'stage_plan') return snapshot.title || 'Stage Plan'
  if (attachment.type === 'studio_project') return snapshot.title || 'Studio Project'
  return 'Attachment'
}

function formatAttachmentSize(bytes = 0) {
  const value = Math.max(0, Number(bytes || 0))
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / 1024 / 1024).toFixed(value < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

function composerFileAttachmentPreview(attachment = {}) {
  const preview = attachment.previewURL || ''
  const media = attachment.type === 'image' && preview
    ? `<img src="${escapeHtml(preview)}" alt="" />`
    : attachment.type === 'video' && preview
      ? `<video src="${escapeHtml(preview)}" muted controls preload="metadata"></video>`
      : attachment.type === 'audio'
        ? `<span class="community-attachment-fallback">${iconSvg('music')}</span>`
        : `<span class="community-attachment-fallback">${iconSvg('file')}</span>`
  return `
    <article class="community-composer-attachment is-file">
      ${media}
      <span>
        <strong>${escapeHtml(attachment.file?.name || 'Attachment')}</strong>
        <em>${escapeHtml([attachment.type, formatAttachmentSize(attachment.file?.size)].filter(Boolean).join(' · '))}</em>
      </span>
      <button type="button" data-remove-composer-file="${escapeHtml(attachment.id)}" aria-label="Remove ${escapeHtml(attachment.file?.name || 'attachment')}">${iconSvg('x')}</button>
      ${attachment.type === 'audio' && preview ? `<audio class="community-composer-audio-preview" src="${escapeHtml(preview)}" controls preload="metadata"></audio>` : ''}
    </article>
  `
}

function composerAttachmentPreview(attachment = {}) {
  if (attachment.type === 'product') return productAttachmentPreview(attachment)
  const key = attachmentKey(attachment)
  const snapshot = attachment.snapshot || {}
  const meta = attachment.type === 'music'
    ? [snapshot.creatorName, 'Audio preview'].filter(Boolean).join(' · ')
    : attachment.type === 'stage_plan'
      ? [`${Number(snapshot.stageWidth || 0)} x ${Number(snapshot.stageDepth || 0)} ${snapshot.units || 'ft'}`, `${Number(snapshot.objectCount || 0)} objects`].join(' · ')
      : attachment.type === 'studio_project'
        ? [`${Number(snapshot.bpm || 0) || '--'} BPM`, snapshot.key, `${Number(snapshot.trackCount || 0)} tracks`].filter(Boolean).join(' · ')
        : ''
  const icon = attachment.type === 'stage_plan' ? 'cube' : attachment.type === 'studio_project' ? 'music' : 'music'
  return `
    <article class="community-composer-attachment">
      <span class="community-attachment-fallback">${iconSvg(icon)}</span>
      <span>
        <strong>${escapeHtml(attachmentTitle(attachment))}</strong>
        <em>${escapeHtml(meta)}</em>
      </span>
      <button type="button" data-remove-composer-attachment-key="${escapeHtml(key)}" aria-label="Remove ${escapeHtml(attachmentTitle(attachment))}">${iconSvg('x')}</button>
    </article>
  `
}

function renderComposerAttachments() {
  const linked = state.composer.attachments.map(composerAttachmentPreview)
  const files = state.composer.fileAttachments.map(composerFileAttachmentPreview)
  if (!linked.length && !files.length) return ''
  return `<div class="community-composer-attachments">${[...linked, ...files].join('')}</div>`
}

function renderComposerProductPicker() {
  if (!state.composer.productPickerOpen) return ''
  const rows = state.composer.products.map((product) => `
    <button type="button" class="community-product-picker-row" data-select-composer-product="${escapeHtml(product.productId)}">
      ${product.thumbnailURL ? `<img src="${escapeHtml(product.thumbnailURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('package')}</span>`}
      <span>
        <strong>${escapeHtml(product.title)}</strong>
        <em>${escapeHtml(product.isFree ? 'Free' : `$${(Number(product.priceCents || 0) / 100).toFixed(2)}`)}</em>
      </span>
    </button>
  `).join('')
  return `
    <section class="community-product-picker" aria-label="Product picker">
      <div class="community-mini-panel-heading">
        <strong>Select a published product</strong>
        <button type="button" data-close-product-picker>${iconSvg('x')}</button>
      </div>
      ${state.composer.productPickerLoading ? '<p>Loading your published products...</p>' : state.composer.productPickerError ? `<p class="community-error">${escapeHtml(state.composer.productPickerError)}</p>` : rows || '<p>No public published products are available to attach yet.</p>'}
    </section>
  `
}

function renderComposerMusicPicker() {
  if (!state.composer.musicPickerOpen) return ''
  const rows = state.composer.musicPreviews.map((preview) => `
    <button type="button" class="community-product-picker-row" data-select-composer-music="${escapeHtml(preview.storagePath)}">
      ${preview.snapshot?.coverURL ? `<img src="${escapeHtml(preview.snapshot.coverURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('music')}</span>`}
      <span>
        <strong>${escapeHtml(preview.snapshot?.title || 'Music preview')}</strong>
        <em>${escapeHtml([preview.snapshot?.creatorName, 'Product preview'].filter(Boolean).join(' · '))}</em>
      </span>
    </button>
  `).join('')
  return `
    <section class="community-product-picker" aria-label="Music picker">
      <div class="community-mini-panel-heading">
        <strong>Select a public audio preview</strong>
        <button type="button" data-close-music-picker>${iconSvg('x')}</button>
      </div>
      ${state.composer.musicPickerLoading ? '<p>Loading public audio previews...</p>' : state.composer.musicPickerError ? `<p class="community-error">${escapeHtml(state.composer.musicPickerError)}</p>` : rows || '<p>No public product audio previews are available to attach yet.</p>'}
    </section>
  `
}

function renderComposerStagePicker() {
  if (!state.composer.stagePickerOpen) return ''
  const rows = state.composer.stagePlans.map((project) => `
    <button type="button" class="community-product-picker-row" data-select-composer-stage="${escapeHtml(project.projectId)}" data-project-visibility="${escapeHtml(project.visibility)}">
      <span class="community-product-fallback">${iconSvg('cube')}</span>
      <span>
        <strong>${escapeHtml(project.title)}</strong>
        <em>${escapeHtml([project.stageType, `${Number(project.stageWidth || 0)} x ${Number(project.stageDepth || 0)} ${project.units || 'ft'}`, project.visibility === 'public' ? 'Public' : 'Private'].filter(Boolean).join(' · '))}</em>
      </span>
    </button>
  `).join('')
  return `
    <section class="community-product-picker" aria-label="Stage Plan picker">
      <div class="community-mini-panel-heading">
        <strong>Select a Stage Plan</strong>
        <button type="button" data-close-stage-picker>${iconSvg('x')}</button>
      </div>
      ${state.composer.stagePickerLoading ? '<p>Loading StageMaker plans...</p>' : state.composer.stagePickerError ? `<p class="community-error">${escapeHtml(state.composer.stagePickerError)}</p>` : rows || '<p>No owned or shared StageMaker plans are available.</p>'}
      <p class="community-picker-note">Private plans are shared as safe snapshot cards only. The editable project stays protected.</p>
    </section>
  `
}

function renderComposerStudioPicker() {
  if (!state.composer.studioPickerOpen) return ''
  const rows = state.composer.studioProjects.map((project) => `
    <button type="button" class="community-product-picker-row" data-select-composer-studio="${escapeHtml(project.projectId)}" data-project-visibility="${escapeHtml(project.visibility)}">
      <span class="community-product-fallback">${iconSvg('music')}</span>
      <span>
        <strong>${escapeHtml(project.title)}</strong>
        <em>${escapeHtml([project.type, `${Number(project.bpm || 0) || '--'} BPM`, project.key, project.visibility === 'public' ? 'Public' : 'Private'].filter(Boolean).join(' · '))}</em>
      </span>
    </button>
  `).join('')
  return `
    <section class="community-product-picker" aria-label="Studio Project picker">
      <div class="community-mini-panel-heading">
        <strong>Select a Studio Project</strong>
        <button type="button" data-close-studio-picker>${iconSvg('x')}</button>
      </div>
      ${state.composer.studioPickerLoading ? '<p>Loading Studio projects...</p>' : state.composer.studioPickerError ? `<p class="community-error">${escapeHtml(state.composer.studioPickerError)}</p>` : rows || '<p>No owned or shared Studio projects are available.</p>'}
      <p class="community-picker-note">Studio projects are shared as safe metadata cards only. Stems and project files stay private.</p>
    </section>
  `
}

function renderMentionPickerContent() {
  if (!state.composer.mentionQuery && !state.composer.mentionedUsers.length) return ''
  return `
    <section class="community-mention-picker" aria-label="Mention people">
      <div class="community-selected-mentions">
        ${state.composer.mentionedUsers.map((user) => `
          <span>@${escapeHtml(user.username || user.displayName || 'creator')} <button type="button" data-remove-mentioned-user="${escapeHtml(user.uid)}" aria-label="Remove mention">${iconSvg('x')}</button></span>
        `).join('')}
      </div>
      ${state.composer.mentionSearchLoading ? '<p>Searching creators...</p>' : state.composer.mentionSearchError ? `<p class="community-error">${escapeHtml(state.composer.mentionSearchError)}</p>` : state.composer.mentionResults.length ? `
        <div class="community-mention-results">
          ${state.composer.mentionResults.map((user) => `
            <button type="button" data-select-mentioned-user="${escapeHtml(user.uid)}">
              <span class="community-avatar">${user.avatarURL || user.photoURL ? `<img src="${escapeHtml(user.avatarURL || user.photoURL)}" alt="" loading="lazy" />` : `<span>${escapeHtml((user.displayName || user.username || 'M').slice(0, 1).toUpperCase())}</span>`}</span>
              <span><strong>${escapeHtml(user.displayName || user.username || 'Creator')}</strong><em>${escapeHtml(formatUsername(user.username) || '')}</em></span>
            </button>
          `).join('')}
        </div>
      ` : state.composer.mentionQuery.length >= 2 ? '<p>No creators found.</p>' : ''}
    </section>
  `
}

function renderMentionPicker() {
  return `<div data-mention-picker-region>${renderMentionPickerContent()}</div>`
}

function renderEmojiPanel() {
  if (!state.composer.emojiOpen) return ''
  return `
    <div class="community-emoji-panel" aria-label="Emoji picker">
      ${QUICK_EMOJIS.map((emoji) => `<button type="button" data-insert-emoji="${escapeHtml(emoji)}">${escapeHtml(emoji)}</button>`).join('')}
    </div>
  `
}

function renderAttachmentToolbar() {
  const disabledActions = [
    ['Schedule', 'calendar'],
    ['Add Poll', 'barChart']
  ]
  return `
    <div class="community-attachment-toolbar" aria-label="Post additions">
      <span class="community-toolbar-group-label">Attachments</span>
      <button type="button" data-open-music-picker class="${selectedAttachments('music').length ? 'is-active' : ''}" title="Add Music">${iconSvg('music')} <span>Add Music</span></button>
      <button type="button" data-open-product-picker class="${selectedProductAttachment() ? 'is-active' : ''}" title="Add Product">${iconSvg('package')} <span>Add Product</span></button>
      <button type="button" data-open-stage-picker class="${selectedAttachment('stage_plan') ? 'is-active' : ''}" title="Add Stage Plan">${iconSvg('cube')} <span>Add Stage Plan</span></button>
      <button type="button" data-open-studio-picker class="${selectedAttachment('studio_project') ? 'is-active' : ''}" title="Add Studio Project">${iconSvg('music')} <span>Add Studio Project</span></button>
      <button type="button" data-open-post-attachment-picker class="${state.composer.fileAttachments.length ? 'is-active' : ''}" title="Add Attachment" ${state.composer.submitting ? 'disabled' : ''}>${iconSvg('file')} <span>Add Attachment</span></button>
      <input class="community-hidden-file-input" type="file" multiple hidden data-post-attachment-input accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/webm,audio/mp4,audio/aac,audio/ogg,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/json" />
      <span class="community-toolbar-group-label">Enhance</span>
      <label class="community-mention-control" title="Tag People">
        ${iconSvg('at')} <span>Tag People</span>
        <input type="search" value="${escapeHtml(state.composer.mentionQuery)}" placeholder="@username" data-mention-search />
      </label>
      <button type="button" data-toggle-emoji-panel class="${state.composer.emojiOpen ? 'is-active' : ''}" title="Emoji">${iconSvg('smile')} <span>Emoji</span></button>
      ${disabledActions.map(([label, icon]) => `<button type="button" disabled title="Coming soon">${iconSvg(icon)} <span>${escapeHtml(label)}</span><em>Coming soon</em></button>`).join('')}
      <span class="community-toolbar-group-label">Intent</span>
      <button type="button" data-set-composer-intent="feedback_request" class="${state.composer.intent === 'feedback_request' ? 'is-active' : ''}" title="Request Feedback">${iconSvg('messageCircle')} <span>Request Feedback</span></button>
      <button type="button" data-set-composer-intent="collaboration_request" class="${state.composer.intent === 'collaboration_request' ? 'is-active' : ''}" title="Find Collaborators">${iconSvg('user')} <span>Find Collaborators</span></button>
      ${state.composer.intent ? `<button type="button" data-clear-composer-intent title="Clear intent">${iconSvg('x')} <span>Clear Intent</span></button>` : ''}
    </div>
  `
}

function renderComposerIntentFields() {
  const data = state.composer.intentData || {}
  if (state.composer.intent === 'feedback_request') {
    return `
      <section class="community-intent-panel" aria-label="Feedback request">
        <div class="community-mini-panel-heading">
          <strong>Feedback Request</strong>
          <button type="button" data-clear-composer-intent aria-label="Clear feedback request">${iconSvg('x')}</button>
        </div>
        <label>
          <span>Feedback category</span>
          <select name="feedbackCategory">${FEEDBACK_CATEGORIES.map((category) => `<option value="${escapeHtml(category)}" ${data.feedbackCategory === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select>
        </label>
        <label>
          <span>Specific question</span>
          <input name="feedbackQuestion" maxlength="300" value="${escapeHtml(data.feedbackQuestion || '')}" placeholder="What should people listen for or evaluate?" />
        </label>
        <label>
          <span>Deadline optional</span>
          <input name="feedbackDeadlineAt" type="date" value="${escapeHtml(data.feedbackDeadlineAt || '')}" />
        </label>
      </section>
    `
  }
  if (state.composer.intent === 'collaboration_request') {
    return `
      <section class="community-intent-panel" aria-label="Collaboration request">
        <div class="community-mini-panel-heading">
          <strong>Collaboration Request</strong>
          <button type="button" data-clear-composer-intent aria-label="Clear collaboration request">${iconSvg('x')}</button>
        </div>
        <div class="community-intent-grid">
          <label>
            <span>Looking for</span>
            <select name="collaborationRoleNeeded">${COLLABORATION_ROLES.map((role) => `<option value="${escapeHtml(role)}" ${data.collaborationRoleNeeded === role ? 'selected' : ''}>${escapeHtml(role)}</option>`).join('')}</select>
          </label>
          <label>
            <span>Genre</span>
            <input name="collaborationGenre" maxlength="80" value="${escapeHtml(data.collaborationGenre || '')}" placeholder="Optional genre" />
          </label>
          <label>
            <span>Compensation</span>
            <select name="collaborationCompensationType">${COMPENSATION_TYPES.map((type) => `<option value="${escapeHtml(type)}" ${data.collaborationCompensationType === type ? 'selected' : ''}>${escapeHtml(type)}</option>`).join('')}</select>
          </label>
          <label>
            <span>Location</span>
            <select name="collaborationLocationMode">${LOCATION_MODES.map((mode) => `<option value="${escapeHtml(mode)}" ${data.collaborationLocationMode === mode ? 'selected' : ''}>${escapeHtml(mode)}</option>`).join('')}</select>
          </label>
          <label>
            <span>Location text optional</span>
            <input name="collaborationLocationText" maxlength="120" value="${escapeHtml(data.collaborationLocationText || '')}" placeholder="City, region, or timezone" />
          </label>
          <label>
            <span>Deadline optional</span>
            <input name="collaborationDeadlineAt" type="date" value="${escapeHtml(data.collaborationDeadlineAt || '')}" />
          </label>
        </div>
      </section>
    `
  }
  return ''
}

function composerDestinationCommunities() {
  const byId = new Map()
  ;[...state.composer.destinationItems, ...state.communities, state.community].forEach((community) => {
    if (community?.communityId && community.status === 'active' && community.visibility === 'public' && community.hidden !== true) {
      byId.set(community.communityId, community)
    }
  })
  return [...byId.values()]
}

function composerDestinationMatches() {
  const needle = String(state.composer.destinationSearch || '').trim().toLowerCase()
  const rows = composerDestinationCommunities()
  if (!needle) return rows
  return rows.filter((community) => [
    community.name,
    community.slug,
    community.description,
    community.category
  ].some((value) => String(value || '').toLowerCase().includes(needle)))
}

function renderCommunityDestinationAvatar(community = {}, { large = false } = {}) {
  const imageURL = community.imageUrl || community.imageURL || community.iconURL || ''
  return `
    <span class="community-destination-avatar ${large ? 'is-large' : ''}">
      ${imageURL
        ? `<img src="${escapeHtml(imageURL)}" alt="" loading="lazy" />`
        : `<span>${escapeHtml((community.name || community.slug || 'M').slice(0, 1).toUpperCase())}</span>`
      }
    </span>
  `
}

function renderComposerDestinationButton() {
  const community = currentComposerCommunity()
  return `
    <section class="community-destination-picker" aria-labelledby="community-destination-label">
      <div>
        <span id="community-destination-label">Community Selection</span>
        <small>Choose a community or publish to the General feed.</small>
      </div>
      <input type="hidden" name="communityId" value="${escapeHtml(state.composer.communityId)}" />
      <button type="button" class="community-destination-button" data-open-community-destination ${state.composer.submitting ? 'disabled' : ''}>
        ${community
          ? renderCommunityDestinationAvatar(community, { large: true })
          : `<span class="community-destination-avatar is-large is-general">${iconSvg('user')}</span>`
        }
        <span class="community-destination-button-copy">
          <strong>${escapeHtml(community?.name || 'Choose where to post')}</strong>
          <small>${community ? `c/${escapeHtml(community.slug)} · ${escapeHtml(community.category || 'Community')}` : 'No community selected · General feed'}</small>
        </span>
        ${iconSvg('chevronRight')}
      </button>
    </section>
  `
}

function renderCommunityDestinationResults() {
  if (state.composer.destinationLoading) {
    return `
      <div class="community-destination-state" role="status">
        <span class="community-destination-loader" aria-hidden="true"></span>
        <strong>Loading communities...</strong>
        <small>Finding active public spaces.</small>
      </div>
    `
  }
  if (state.composer.destinationError) {
    return `
      <div class="community-destination-state is-error">
        <strong>Communities could not be loaded.</strong>
        <small>${escapeHtml(state.composer.destinationError)}</small>
        <button type="button" class="button button-muted" data-retry-community-destination>Try again</button>
      </div>
    `
  }
  const rows = composerDestinationMatches()
  const generalMatches = !state.composer.destinationSearch
    || 'general feed'.includes(String(state.composer.destinationSearch || '').trim().toLowerCase())
  return `
    <div class="community-destination-list" role="listbox" aria-label="Post destination">
      ${generalMatches ? `
        <button type="button" class="community-destination-result ${state.composer.communityId ? '' : 'is-selected'}" data-select-community-destination="" role="option" aria-selected="${state.composer.communityId ? 'false' : 'true'}">
          <span class="community-destination-avatar is-general">${iconSvg('home')}</span>
          <span class="community-destination-meta">
            <strong>General feed</strong>
            <small>Share with the wider Melogic community without choosing a specific space.</small>
            <em>Default destination</em>
          </span>
          <span class="community-destination-check">${state.composer.communityId ? iconSvg('chevronRight') : iconSvg('checkCircle')}</span>
        </button>
      ` : ''}
      ${rows.map((community) => `
        <button type="button" class="community-destination-result ${state.composer.communityId === community.communityId ? 'is-selected' : ''}" data-select-community-destination="${escapeHtml(community.communityId)}" role="option" aria-selected="${state.composer.communityId === community.communityId ? 'true' : 'false'}">
          ${renderCommunityDestinationAvatar(community)}
          <span class="community-destination-meta">
            <strong>${escapeHtml(community.name)}</strong>
            <small>${escapeHtml(String(community.description || 'A Melogic creator community.').slice(0, 100))}</small>
            <em>c/${escapeHtml(community.slug)} · ${formatCount(community.focusCount || community.followerCount)} focused · ${formatCount(community.postCount)} posts</em>
          </span>
          <span class="community-destination-check">${state.composer.communityId === community.communityId ? iconSvg('checkCircle') : iconSvg('chevronRight')}</span>
        </button>
      `).join('')}
      ${!generalMatches && !rows.length ? `
        <div class="community-destination-state">
          ${iconSvg('search')}
          <strong>No communities found</strong>
          <small>Try a community name, category, or c/slug.</small>
        </div>
      ` : ''}
    </div>
  `
}

function renderCommunityDestinationPickerModal() {
  if (!state.composer.destinationPickerOpen) return ''
  if (useNativeMobileCommunityComposer()) {
    const matches = composerDestinationMatches()
    const visible = matches.slice(0, Math.max(10, Number(state.composer.destinationVisibleCount || 10)))
    return `
      <div class="community-mobile-destination-screen" data-community-mobile-destination-screen>
        <section class="community-mobile-destination" role="dialog" aria-modal="true">
          <header class="community-mobile-destination-header">
            <button type="button" data-close-community-destination aria-label="Back to post">${iconSvg('arrowLeft')}</button>
            <h2>Community Search</h2>
            <button type="button" data-mobile-create-community aria-label="Create community">${iconSvg('plus')}</button>
          </header>
          <label class="community-mobile-destination-search">${iconSvg('search')}<input type="search" value="${escapeHtml(state.composer.destinationSearchDraft ?? state.composer.destinationSearch)}" placeholder="Search communities" data-community-destination-search autocomplete="off" /></label>
          <div class="community-mobile-destination-scroll" data-community-destination-scroll>
            <button type="button" class="community-mobile-destination-row ${state.composer.communityId ? '' : 'is-selected'}" data-select-community-destination="">
              <span class="community-destination-avatar is-general">${iconSvg('home')}</span><span><strong>General</strong><small>Main Melogic Community feed</small></span><span class="community-mobile-destination-trailing">${state.composer.communityId ? iconSvg('chevronRight') : iconSvg('checkCircle')}</span>
            </button>
            ${state.composer.destinationLoading ? `<div class="community-mobile-destination-loading" role="status"><span class="community-destination-loader" aria-hidden="true"></span><span>Loading communities...</span></div>` : state.composer.destinationError ? `<div class="community-mobile-destination-state"><strong>Could not load communities</strong><small>${escapeHtml(state.composer.destinationError)}</small></div>` : visible.map((community) => `
              <button type="button" class="community-mobile-destination-row ${state.composer.communityId === community.communityId ? 'is-selected' : ''}" data-select-community-destination="${escapeHtml(community.communityId)}">
                ${renderCommunityDestinationAvatar(community)}<span><strong>${escapeHtml(community.name)}</strong><small>${escapeHtml([`c/${community.slug || ''}`, community.category || '', `${formatCount(community.focusCount || community.followerCount)} focused`].filter(Boolean).join(' · '))}</small></span><span class="community-mobile-destination-trailing">${state.composer.communityId === community.communityId ? iconSvg('checkCircle') : iconSvg('chevronRight')}</span>
              </button>`).join('')}
            ${!state.composer.destinationLoading && !state.composer.destinationError && !visible.length ? `<div class="community-mobile-destination-state"><strong>No communities found</strong><small>Try another search.</small></div>` : ''}
            ${visible.length < matches.length ? `<div class="community-mobile-destination-sentinel" aria-hidden="true"></div>` : ''}
          </div>
        </section>
      </div>`
  }
  return `
    <div class="community-modal-backdrop community-destination-backdrop" data-community-destination-backdrop>
      <section class="community-destination-modal" role="dialog" aria-modal="true" data-community-destination-modal>
        <header><div><p class="eyebrow">Post Destination</p><h2>Choose a Community</h2><p>Search active public communities and choose where this post belongs.</p></div><button type="button" class="community-close-button" data-close-community-destination>${iconSvg('x')}</button></header>
        <label class="community-destination-search">${iconSvg('search')}<input type="search" value="${escapeHtml(state.composer.destinationSearch)}" placeholder="Search communities" data-community-destination-search /></label>
        <div data-community-destination-results>${renderCommunityDestinationResults()}</div>
      </section>
    </div>`
}
// melogic-mobile-community-destination-search-v5b

// melogic-mobile-native-community-composer-v1b
function useNativeMobileCommunityComposer() {
  return window.matchMedia('(max-width: 760px)').matches
}

function useUnifiedCommunityComposer() {
  return Boolean(state.currentUser)
}
function renderNativeMobileComposerShell() {
  if (!state.composer.open || !state.currentUser) return ''
  const community = currentComposerCommunity()
  const canPost = Boolean(String(state.composer.body || '').trim()) && !state.composer.submitting
  const currentIdentity = communityAuthorIdentityCache.get(state.currentUser.uid)
  void ensureCommunityAuthorIdentity(state.currentUser.uid).then((identity) => {
    if (!identity || !state.composer.open) return
    const nameNode = app?.querySelector('[data-mobile-composer-display-name]')
    const usernameNode = app?.querySelector('[data-mobile-composer-username]')
    if (nameNode) nameNode.textContent = identity.displayName || state.currentUser?.displayName || 'You'
    if (usernameNode) usernameNode.textContent = formatUsername(identity.username || '') || '@user'
  })
  const displayName = String(currentIdentity?.displayName || state.currentUser?.displayName || state.currentUser?.email?.split('@')[0] || 'You').trim()
  const username = formatUsername(currentIdentity?.username || '') || '@user'
  return `
    <div class="community-mobile-composer-screen" data-community-mobile-composer-screen>
      <section class="community-mobile-composer" role="dialog" aria-modal="true" aria-labelledby="community-mobile-composer-title">
        <form class="community-mobile-composer-form" data-community-composer-form>
          <header class="community-mobile-composer-header">
            <button type="button" class="community-mobile-composer-close" data-close-community-composer aria-label="Close composer">${iconSvg('x')}</button>
            <h2 id="community-mobile-composer-title">New post</h2>
            <button type="button" class="community-mobile-composer-more" aria-label="Post options">&#8226;&#8226;&#8226;</button>
          </header>

          <div class="community-mobile-composer-destination-row">
            <button type="button" class="community-mobile-composer-destination" data-open-community-destination ${state.composer.submitting ? 'disabled' : ''}>
              ${community
                ? renderCommunityDestinationAvatar(community, { large: true })
                : `<span class="community-destination-avatar is-large is-general">${iconSvg('home')}</span>`
              }
              <span>
                <strong>${escapeHtml(community?.name || 'General')}</strong>
                <small>${community ? `c/${escapeHtml(community.slug || '')}` : 'Community'}</small>
              </span>
              ${iconSvg('chevronDown')}
            </button>
            <input type="hidden" name="communityId" value="${escapeHtml(state.composer.communityId)}" />
            <button type="submit" class="community-mobile-composer-post" ${canPost ? '' : 'disabled'}>
              ${state.composer.submitting ? 'POSTING...' : 'POST'}
            </button>
          </div>

          <div class="community-mobile-composer-content">
            <div class="community-mobile-composer-author-avatar">${currentUserAvatar()}</div>
            <div class="community-mobile-composer-writing">
              <div class="community-mobile-composer-identity">
                <strong class="community-mobile-composer-display-name" data-mobile-composer-display-name>${escapeHtml(displayName)}</strong>
                <small class="community-mobile-composer-username" data-mobile-composer-username>${escapeHtml(username)}</small>
              </div>
              <textarea name="body" maxlength="2000" rows="8" placeholder="${escapeHtml(communityComposerPrompt)}" data-composer-body>${escapeHtml(state.composer.body)}</textarea>
            </div>
          </div>

          ${renderComposerAttachments()}
          ${renderComposerProductPicker()}
          ${renderComposerMusicPicker()}
          ${renderComposerStagePicker()}
          ${renderComposerStudioPicker()}
          ${renderComposerIntentFields()}
          <div class="community-mobile-composer-bottom">
            <div class="community-mobile-composer-tools" aria-label="Add to post">
              <button type="button" data-open-post-attachment-picker aria-label="Add photo, video, or file" title="Photo, video, or file">${iconSvg('image')}</button>
              <button type="button" data-open-post-attachment-picker aria-label="Add document" title="Document">${iconSvg('file')}</button>
              <button type="button" data-open-music-picker aria-label="Add music" title="Music">${iconSvg('music')}</button>
              <button type="button" data-toggle-emoji-panel aria-label="Add emoji" title="Emoji">${iconSvg('smile')}</button>
              <button type="button" data-mobile-composer-more-actions aria-label="More post options" title="More options">&#8226;&#8226;&#8226;</button>
            </div>
            <input class="community-hidden-file-input" type="file" multiple hidden data-post-attachment-input accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/webm,audio/mp4,audio/aac,audio/ogg,application/pdf,text/plain,application/zip,application/x-zip-compressed,application/json" />
            ${renderEmojiPanel()}
            <div class="community-mobile-composer-more-sheet" data-mobile-composer-more-sheet hidden>
              <button type="button" data-open-product-picker>${iconSvg('package')}<span>Add product</span></button>
              <button type="button" data-open-stage-picker>${iconSvg('cube')}<span>Add Stage Plan</span></button>
              <button type="button" data-open-studio-picker>${iconSvg('music')}<span>Add Studio project</span></button>
              <button type="button" data-set-composer-intent="feedback_request">${iconSvg('messageCircle')}<span>Request feedback</span></button>
              <button type="button" data-set-composer-intent="collaboration_request">${iconSvg('user')}<span>Find collaborators</span></button>
            </div>
            <span class="community-mobile-composer-count">${Math.max(0, 2000 - state.composer.body.length)}</span>
            ${state.composer.error ? `<p class="community-error">${escapeHtml(state.composer.error)}</p>` : ''}
          </div>
          <!-- melogic-mobile-community-composer-attachments-v3 -->
        </form>
        ${renderCommunityDestinationPickerModal()}
      </section>
    </div>
  `
}
// melogic-mobile-native-community-composer-v2

function renderComposerModal() {
  if (!state.composer.open) return ''
  if (useUnifiedCommunityComposer()) return renderNativeMobileComposerShell()
  if (!state.currentUser) {
    return `
      <div class="community-modal-backdrop">
        <section class="community-composer-modal" role="dialog" aria-modal="true" aria-labelledby="community-composer-title">
          <header>
            <div>
              <p class="eyebrow">Post</p>
              <h2 id="community-composer-title">Sign in to post</h2>
            </div>
            <button type="button" data-close-community-composer aria-label="Close composer">${iconSvg('x')}</button>
          </header>
          <p class="community-modal-copy">Join Melogic to post in the community, focus spaces, and reply to creators.</p>
          <div class="community-form-actions">
            <button type="button" class="button button-muted" data-close-community-composer>Cancel</button>
            <a class="button button-accent" href="${authRoute({ redirect: window.location.pathname })}">Sign In</a>
          </div>
        </section>
      </div>
    `
  }

  return `
    <div class="community-modal-backdrop">
      <section class="community-composer-modal" role="dialog" aria-modal="true" aria-labelledby="community-composer-title">
        <header>
          <div>
            <p class="eyebrow">Create</p>
            <h2 id="community-composer-title">New Post</h2>
            <p>Share an update, ask for feedback, or bring collaborators into your work.</p>
          </div>
          <button type="button" data-close-community-composer aria-label="Close composer">${iconSvg('x')}</button>
        </header>
        <form data-community-composer-form>
          ${renderComposerDestinationButton()}
          <div class="community-composer-primary">
            <label class="community-composer-title-field">
              <span>Title</span>
              <input name="title" maxlength="120" value="${escapeHtml(state.composer.title)}" placeholder="Optional headline" />
            </label>
            <label class="community-composer-body-field">
              <span>Body</span>
              <textarea name="body" maxlength="2000" rows="8" placeholder="Share an update, question, idea, product note, or creative win." data-composer-body>${escapeHtml(state.composer.body)}</textarea>
            </label>
          </div>
          <div class="community-composer-tools">
            ${renderAttachmentToolbar()}
            ${renderEmojiPanel()}
            ${renderComposerProductPicker()}
            ${renderComposerMusicPicker()}
            ${renderComposerStagePicker()}
            ${renderComposerStudioPicker()}
            ${renderComposerAttachments()}
            ${renderMentionPicker()}
            ${renderComposerIntentFields()}
          </div>
          <div class="community-composer-meta-grid">
            <label>
              <span>Visibility</span>
              <select name="visibility" disabled title="Public posts only in this phase">
                <option value="public" selected>Public</option>
              </select>
            </label>
            <label>
              <span>Tags</span>
              <input name="tags" maxlength="160" value="${escapeHtml(state.composer.tags)}" placeholder="beats, feedback, release" />
            </label>
          </div>
          ${state.composer.error ? `<p class="community-error">${escapeHtml(state.composer.error)}</p>` : ''}
          ${state.composer.submitting && state.composer.fileAttachments.length ? `
            <div class="community-post-upload-progress" data-community-post-upload-progress role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${state.composer.uploadProgress}">
              Uploading attachments ${state.composer.uploadProgress}%
            </div>
          ` : ''}
          <div class="community-form-actions">
            <span>${Math.max(0, 2000 - state.composer.body.length)} characters left</span>
            <button type="button" class="button button-muted" data-close-community-composer ${state.composer.submitting ? 'disabled' : ''}>Cancel</button>
            <button type="submit" class="button button-accent" ${state.composer.submitting ? 'disabled' : ''}>${state.composer.submitting ? 'Publishing...' : 'Publish'}</button>
          </div>
        </form>
      </section>
    </div>
    ${renderCommunityDestinationPickerModal()}
  `
}

function renderComposerLayer() {
  return `<div data-community-composer-layer>${renderComposerModal()}</div>`
}

// melogic-mobile-community-destination-hardening-v5c
let communityMobileOverlayTouchGuardReady = false
function ensureCommunityMobileOverlayTouchGuard() {
  if (communityMobileOverlayTouchGuardReady) return
  communityMobileOverlayTouchGuardReady = true
  document.addEventListener('touchmove', (event) => {
    if (!document.documentElement.classList.contains('community-mobile-overlay-open')) return
    const target = event.target instanceof Element ? event.target : null
    if (target?.closest('[data-community-destination-scroll], .community-mobile-composer-content, textarea, input, [data-mobile-composer-more-sheet]')) return
    event.preventDefault()
  }, { passive: false, capture: true })
}
ensureCommunityMobileOverlayTouchGuard()

// melogic-mobile-community-release-overlay-lock-v6b
function releaseCommunityMobileOverlayLock() {
  document.documentElement.classList.remove('community-mobile-overlay-open')
  document.body.classList.remove('community-mobile-overlay-open')
  document.body.classList.remove('community-mobile-composer-open')
  document.documentElement.classList.remove('community-mobile-composer-visual-underlay')
  document.body.classList.remove('community-mobile-composer-visual-underlay')
  // community-modal-open is derived from modal state; after successful publish
  // the composer is already reset/closed, so release that lock too.
  document.body.classList.remove('community-modal-open')
}

function updateCommunityComposerLayer() {
  const layer = app?.querySelector('[data-community-composer-layer]')
  if (!layer) {
    render()
    return
  }
  document.body.classList.toggle('community-modal-open', communityModalIsOpen())
  document.body.classList.toggle('community-mobile-composer-open', Boolean(state.composer.open && state.currentUser && useNativeMobileCommunityComposer()))
  const mobileOverlayOpen = Boolean(useNativeMobileCommunityComposer() && (state.composer.open || state.composer.destinationPickerOpen))
  document.body.classList.toggle('community-mobile-overlay-open', mobileOverlayOpen)
  document.documentElement.classList.toggle('community-mobile-overlay-open', mobileOverlayOpen)
  layer.innerHTML = renderComposerModal()
  bindCommunityComposerEvents(layer)
  ensureCommunityComposerVisualViewportTracking()
  syncCommunityComposerToVisualViewport()
}

function linkedProductMarkup(post) {
  const attachment = (post.attachments || []).find((item) => item.type === 'product' && (item.productId || item.targetId))
  const productId = attachment?.productId || attachment?.targetId || post.linkedProductId || ''
  const product = attachment?.snapshot || post.linkedProductSnapshot || {}
  if (!productId) return ''
  const href = productRoute({ id: productId, slug: product.slug || product.title || '' })
  const creator = product.creatorName || product.artistName || ''
  const price = product.isFree ? 'Free' : product.priceCents ? `$${(Number(product.priceCents) / 100).toFixed(2)}` : ''
  return `
    <a class="community-linked-product" href="${href}">
      ${product.thumbnailURL ? `<img src="${escapeHtml(product.thumbnailURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('package')}</span>`}
      <span>
        <strong>${escapeHtml(product.title || 'Shared product')}</strong>
        <em>${escapeHtml([creator, price].filter(Boolean).join(' · '))}</em>
      </span>
    </a>
  `
}

function renderMusicAttachment(attachment = {}) {
  const snapshot = attachment.snapshot || {}
  const audioURL = attachment.audioURL || state.attachmentMediaUrls[attachment.storagePath] || ''
  return `
    <article class="community-linked-product community-attachment-card is-music" data-stop-card-nav>
      ${snapshot.coverURL ? `<img src="${escapeHtml(snapshot.coverURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('music')}</span>`}
      <span>
        <strong>${escapeHtml(snapshot.title || 'Music preview')}</strong>
        <em>${escapeHtml([snapshot.creatorName, attachment.sourceType === 'product_preview' ? 'Product preview' : 'Audio preview'].filter(Boolean).join(' · '))}</em>
        ${audioURL ? `<audio controls preload="none" src="${escapeHtml(audioURL)}"></audio>` : '<small>Audio preview metadata attached.</small>'}
      </span>
    </article>
  `
}

function renderStagePlanAttachment(attachment = {}) {
  const snapshot = attachment.snapshot || {}
  const dimensions = Number(snapshot.stageWidth || 0) && Number(snapshot.stageDepth || 0)
    ? `${Number(snapshot.stageWidth || 0)} x ${Number(snapshot.stageDepth || 0)} ${snapshot.units || 'ft'}`
    : ''
  const href = snapshot.sharePath || ''
  return `
    <article class="community-linked-product community-attachment-card is-stage-plan" data-stop-card-nav>
      ${snapshot.previewImageURL ? `<img src="${escapeHtml(snapshot.previewImageURL)}" alt="" loading="lazy" />` : `<span class="community-blueprint-fallback">${iconSvg('cube')}</span>`}
      <span>
        <strong>${escapeHtml(snapshot.title || 'Stage Plan')}</strong>
        <em>${escapeHtml([snapshot.templateName, dimensions, `${Number(snapshot.objectCount || 0)} objects`].filter(Boolean).join(' · '))}</em>
        ${href ? `<a class="community-attachment-link" href="${escapeHtml(href)}">View Stage Plan</a>` : '<small>Shared as a public snapshot. Editable plan remains private.</small>'}
      </span>
    </article>
  `
}

function renderStudioProjectAttachment(attachment = {}) {
  const snapshot = attachment.snapshot || {}
  const href = snapshot.sharePath || ''
  const audioURL = snapshot.previewAudioPath ? state.attachmentMediaUrls[snapshot.previewAudioPath] || '' : ''
  return `
    <article class="community-linked-product community-attachment-card is-studio-project" data-stop-card-nav>
      ${snapshot.coverURL ? `<img src="${escapeHtml(snapshot.coverURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('music')}</span>`}
      <span>
        <strong>${escapeHtml(snapshot.title || 'Studio Project')}</strong>
        <em>${escapeHtml([Number(snapshot.bpm || 0) ? `${Number(snapshot.bpm)} BPM` : '', snapshot.key, `${Number(snapshot.trackCount || 0)} tracks`].filter(Boolean).join(' · '))}</em>
        ${audioURL ? `<audio controls preload="none" src="${escapeHtml(audioURL)}"></audio>` : ''}
        ${href ? `<a class="community-attachment-link" href="${escapeHtml(href)}">View Project</a>` : '<small>Project files and stems remain private.</small>'}
      </span>
    </article>
  `
}

const COMMUNITY_IMAGE_RETRY_DELAYS = [900, 2200, 5000, 10000]
const communityImageRetryTimers = new Map()

function communityImageFailureState(path = '') {
  return state.attachmentMediaFailures[path] || { attempts: 0, exhausted: false }
}

function clearCommunityImageRetry(path = '') {
  const timer = communityImageRetryTimers.get(path)
  if (timer) window.clearTimeout(timer)
  communityImageRetryTimers.delete(path)
}

function markCommunityImageLoaded(image) {
  const path = image?.getAttribute?.('data-community-storage-path') || ''
  if (!path) return
  clearCommunityImageRetry(path)
  delete state.attachmentMediaFailures[path]
  const shell = image.closest('[data-community-image-shell]')
  shell?.classList.remove('is-loading', 'is-retrying', 'is-failed')
  shell?.querySelector('[data-community-image-status]')?.remove()
}

function retryCommunityImageElement(image, { immediate = false } = {}) {
  const path = image?.getAttribute?.('data-community-storage-path') || ''
  const url = state.attachmentMediaUrls[path] || image?.getAttribute?.('src') || ''
  if (!path || !url) return
  const previous = communityImageFailureState(path)
  const attempts = immediate ? 0 : Number(previous.attempts || 0)
  if (!immediate && attempts >= COMMUNITY_IMAGE_RETRY_DELAYS.length) {
    state.attachmentMediaFailures[path] = { attempts, exhausted: true }
    const shell = image.closest('[data-community-image-shell]')
    shell?.classList.remove('is-loading', 'is-retrying')
    shell?.classList.add('is-failed')
    const status = shell?.querySelector('[data-community-image-status]')
    if (status) status.innerHTML = `<span>Image is taking longer than expected.</span><button type="button" data-community-image-retry="${escapeHtml(path)}">Retry image</button>`
    bindCommunityImageReliability(shell)
    return
  }

  clearCommunityImageRetry(path)
  const nextAttempts = immediate ? 0 : attempts + 1
  state.attachmentMediaFailures[path] = { attempts: nextAttempts, exhausted: false }
  const shell = image.closest('[data-community-image-shell]')
  shell?.classList.add('is-retrying')
  shell?.classList.remove('is-failed')
  const status = shell?.querySelector('[data-community-image-status]')
  if (status) status.textContent = nextAttempts > 1 ? 'Still loading image…' : 'Loading image…'
  const delay = immediate ? 0 : COMMUNITY_IMAGE_RETRY_DELAYS[Math.min(attempts, COMMUNITY_IMAGE_RETRY_DELAYS.length - 1)]
  const timer = window.setTimeout(() => {
    communityImageRetryTimers.delete(path)
    // Reassigning a cache-busted Firebase download URL forces WebKit/browser
    // transfer recovery without tearing down the post card or feed surface.
    const separator = url.includes('?') ? '&' : '?'
    image.src = `${url}${separator}melogic_media_retry=${Date.now()}`
  }, delay)
  communityImageRetryTimers.set(path, timer)
}

function bindCommunityImageReliability(root = app) {
  if (!root) return
  root.querySelectorAll('img[data-community-storage-path]').forEach((image) => {
    if (image.dataset.mediaReliabilityBound === 'true') return
    image.dataset.mediaReliabilityBound = 'true'
    image.addEventListener('load', () => markCommunityImageLoaded(image))
    image.addEventListener('error', () => retryCommunityImageElement(image))
    if (image.complete && image.naturalWidth > 0) markCommunityImageLoaded(image)
  })
  root.querySelectorAll('[data-community-image-retry]').forEach((button) => {
    if (button.dataset.mediaRetryBound === 'true') return
    button.dataset.mediaRetryBound = 'true'
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      const path = button.getAttribute('data-community-image-retry') || ''
      const shell = button.closest('[data-community-image-shell]')
      const image = shell?.querySelector('img[data-community-storage-path]')
      if (!image || !path) return
      state.attachmentMediaFailures[path] = { attempts: 0, exhausted: false }
      retryCommunityImageElement(image, { immediate: true })
    })
  })
}

function renderUploadedPostAttachment(attachment = {}) {
  const path = attachment.path || attachment.storagePath || ''
  const url = attachment.url || state.attachmentMediaUrls[path] || ''
  const name = attachment.name || 'Attachment'
  const dimensions = attachment.width && attachment.height
    ? ` width="${Math.round(attachment.width)}" height="${Math.round(attachment.height)}" style="aspect-ratio:${Math.round(attachment.width)}/${Math.round(attachment.height)}"`
    : ''
  if (attachment.type === 'image') {
    return `
      <button type="button" class="community-post-file-attachment is-image ${url ? 'is-loading' : 'is-resolving'}" data-community-image-shell data-open-community-image="${escapeHtml(url)}" data-community-image-name="${escapeHtml(name)}" data-stop-card-nav ${url ? '' : 'disabled'}>
        ${url
          ? `<img src="${escapeHtml(url)}" data-community-storage-path="${escapeHtml(path)}" alt="${escapeHtml(name)}" loading="lazy" decoding="async"${dimensions} /><span class="community-attachment-load-state" data-community-image-status>Loading image…</span>`
          : `<span class="community-attachment-load-state" data-community-image-status>Loading image…</span>`
        }
      </button>
    `
  }
  if (attachment.type === 'video') {
    return `
      <article class="community-post-file-attachment is-video" data-stop-card-nav>
        ${url ? `<video src="${escapeHtml(url)}" data-community-storage-path="${escapeHtml(path)}" controls preload="metadata"${dimensions}></video>` : '<span class="community-attachment-load-state">Video unavailable</span>'}
        <small>${escapeHtml(name)}</small>
      </article>
    `
  }
  if (attachment.type === 'audio') {
    return `
      <article class="community-post-file-attachment is-audio" data-stop-card-nav>
        <span>${iconSvg('music')} <strong>${escapeHtml(name)}</strong></span>
        ${url ? `<audio src="${escapeHtml(url)}" controls preload="none"></audio>` : '<small>Audio unavailable</small>'}
      </article>
    `
  }
  return `
    <a class="community-post-file-attachment is-file" href="${escapeHtml(url || '#')}" target="_blank" rel="noopener" data-stop-card-nav>
      <span class="community-attachment-fallback">${iconSvg('file')}</span>
      <span>
        <strong>${escapeHtml(name)}</strong>
        <small>${escapeHtml([attachment.contentType || 'File', formatAttachmentSize(attachment.size)].filter(Boolean).join(' · '))}</small>
      </span>
    </a>
  `
}

function renderPostAttachments(post) {
  const attachments = Array.isArray(post.attachments) ? post.attachments : []
  if (!attachments.length) return linkedProductMarkup(post)
  return `
    <div class="community-post-attachments">
      ${attachments.map((attachment) => {
        if (attachment.type === 'product') return linkedProductMarkup({ ...post, attachments: [attachment], linkedProductId: '', linkedProductSnapshot: {} })
        if (attachment.type === 'music') return renderMusicAttachment(attachment)
        if (attachment.type === 'stage_plan') return renderStagePlanAttachment(attachment)
        if (attachment.type === 'studio_project') return renderStudioProjectAttachment(attachment)
        if (['image', 'video', 'audio', 'file'].includes(attachment.type)) return renderUploadedPostAttachment(attachment)
        return ''
      }).join('')}
    </div>
  `
}

function renderPostIntent(post = {}) {
  const data = post.intentData || {}
  if (post.intent === 'feedback_request') {
    return `
      <section class="community-intent-summary is-feedback">
        <strong>Feedback Requested</strong>
        <span>${escapeHtml(data.category || 'Feedback')}</span>
        <p>${escapeHtml(data.question || 'Give useful feedback in the comments.')}</p>
        ${data.deadlineAt ? `<em>Deadline ${escapeHtml(formatTime(data.deadlineAt))}</em>` : ''}
      </section>
    `
  }
  if (post.intent === 'collaboration_request') {
    return `
      <section class="community-intent-summary is-collaboration">
        <strong>Looking for Collaborators</strong>
        <span>${escapeHtml([data.roleNeeded, data.genre, data.compensationType, data.locationMode].filter(Boolean).join(' · '))}</span>
        ${data.locationText ? `<p>${escapeHtml(data.locationText)}</p>` : ''}
        ${data.deadlineAt ? `<em>Deadline ${escapeHtml(formatTime(data.deadlineAt))}</em>` : ''}
      </section>
    `
  }
  return ''
}

function renderPostOptionsMenu(post = {}, { isOwn = false } = {}) {
  const open = state.openPostMenuId === post.postId
  return `
    <div class="community-post-options" data-post-options-root>
      <button type="button" class="community-post-options-button" data-toggle-post-menu="${escapeHtml(post.postId)}" aria-label="Post options" aria-haspopup="menu" aria-expanded="${open ? 'true' : 'false'}">
        ${iconSvg('moreVertical')}
      </button>
      ${open ? postMenuItemsMarkup(post, { isOwn }) : ''}
    </div>
  `
}

function commentMenuKey(postId = '', commentId = '') {
  return `${String(postId || '').trim()}:${String(commentId || '').trim()}`
}

function commentMenuItemsMarkup(comment = {}, { postId = '', isOwn = false } = {}) {
  return `
    <div class="community-post-options-menu community-comment-options-menu" role="menu">
      <button type="button" role="menuitem" data-copy-comment-link="${escapeHtml(comment.commentId)}" data-comment-post-id="${escapeHtml(postId)}">Copy Link</button>
      ${isOwn
        ? `<button type="button" role="menuitem" class="is-danger" data-community-comment-delete="${escapeHtml(comment.commentId)}" data-comment-post-id="${escapeHtml(postId)}">Delete Comment</button>`
        : `<button type="button" role="menuitem" data-community-comment-report="${escapeHtml(comment.commentId)}" data-comment-post-id="${escapeHtml(postId)}">Report Comment</button>`
      }
    </div>
  `
}

function renderCommentOptionsMenu(comment = {}, { postId = '' } = {}) {
  const key = commentMenuKey(postId, comment.commentId)
  const open = state.openCommentMenuKey === key
  const isOwn = Boolean(state.currentUser?.uid && state.currentUser.uid === comment.authorUid)
  return `
    <div class="community-post-options community-comment-options" data-comment-options-root data-comment-menu-key="${escapeHtml(key)}">
      <button type="button" class="community-post-options-button" data-toggle-comment-menu="${escapeHtml(comment.commentId)}" data-comment-post-id="${escapeHtml(postId)}" aria-label="Comment options" aria-haspopup="menu" aria-expanded="${open ? 'true' : 'false'}">
        ${iconSvg('moreVertical')}
      </button>
      ${open ? commentMenuItemsMarkup(comment, { postId, isOwn }) : ''}
    </div>
  `
}

function renderTopCommentPreview(post = {}) {
  if (!Object.prototype.hasOwnProperty.call(state.topCommentPreviews, post.postId)) return ''
  const comment = state.topCommentPreviews[post.postId]
  if (!comment) return ''
  const authorHref = comment.authorUid ? publicProfileRoute({ uid: comment.authorUid }) : ROUTES.profilePublic
  return `
    <section class="community-top-comment-preview" aria-label="Comment preview">
      <header class="community-comment-header">
        <a class="community-author" href="${authorHref}">
          <span class="community-avatar community-top-comment-avatar">${postAvatar(comment)}</span>
          <span>
            ${communityDisplayNameMarkup(comment)}
            <em>${escapeHtml(formatUsername(comment.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(comment.createdAt))}</em>
          </span>
        </a>
        ${renderCommentOptionsMenu(comment, { postId: post.postId })}
      </header>
      ${comment.body ? `<p class="community-comment-body">${escapeHtml(comment.body)}</p>` : ''}
      ${renderCommentAttachments(comment, { compact: true })}
      <div class="community-top-comment-meta" aria-label="Comment engagement">
        <span>${iconSvg('thumbsUp')} ${formatCount(comment.likeCount)}</span>
        <span>${iconSvg('thumbsDown')} ${formatCount(comment.dislikeCount)}</span>
      </div>
    </section>
  `
}

function postAttachmentRenderKey(post = {}) {
  return (post.attachments || []).map((attachment) => {
    const path = attachment.storagePath || attachment.snapshot?.previewAudioPath || ''
    return `${attachment.type || ''}:${path}:${attachment.url || attachment.audioURL || state.attachmentMediaUrls[path] || ''}`
  }).join('|')
}


function postCard(post, { detail = false } = {}) {
  const viewer = state.viewerState[post.postId] || {}
  const liveCommunity = post.community && post.community.communityId === post.communityId ? post.community : null
  const communitySlug = liveCommunity?.slug || post.communitySlug || ''
  const body = detail ? post.body : post.body.slice(0, 640)
  const authorHref = post.authorUid ? publicProfileRoute({ uid: post.authorUid }) : ROUTES.profilePublic
  const isOwn = state.currentUser?.uid && state.currentUser.uid === post.authorUid
  const pinned = pinnedPostIds().has(post.postId) || post.pinnedInCommunity
  const articleAttrs = detail
    ? `class="community-post-card community-post-detail-card is-detail" data-post-id="${escapeHtml(post.postId)}"`
    : `class="community-post-card" data-post-id="${escapeHtml(post.postId)}" data-post-href="${communityPostRoute(post.postId)}" role="link" tabindex="0" aria-label="Open post ${escapeHtml(post.title || 'detail')}"`
  return `
    <article ${articleAttrs}>
      <header class="community-post-header">
        <a class="community-author" href="${authorHref}">
          <span class="community-avatar">${postAvatar(post)}</span>
          <span>
            ${communityDisplayNameMarkup(post)}
            <em>${escapeHtml(formatUsername(post.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(post.createdAt))}${post.edited ? ' · edited' : ''}</em>
          </span>
        </a>
        <div class="community-post-header-actions">
          <div class="community-post-badges">
            ${pinned ? `<span class="community-badge is-pinned">${iconSvg('star')} Pinned</span>` : ''}
            ${communitySlug ? `<a class="community-badge" href="${communityRoute(communitySlug)}">c/${escapeHtml(communitySlug)}</a>` : ''}
            ${post.official ? '<span class="community-badge">Official</span>' : ''}
            ${post.intent === 'feedback_request' ? '<span class="community-badge">Feedback Requested</span>' : ''}
            ${post.intent === 'collaboration_request' ? '<span class="community-badge">Looking for Collaborators</span>' : ''}
          </div>
          ${renderPostOptionsMenu(post, { isOwn })}
        </div>
      </header>
      ${post.title ? `<h2>${escapeHtml(post.title)}</h2>` : ''}
      <p class="community-post-body">${escapeHtml(body)}${!detail && post.body.length > body.length ? '...' : ''}</p>
      ${renderPostIntent(post)}
      <div data-post-attachments-region data-attachment-render-key="${escapeHtml(postAttachmentRenderKey(post))}">
        ${renderPostAttachments(post)}
      </div>
      ${post.tags.length ? `<div class="community-tags">${post.tags.map((tag) => `<button type="button" data-community-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div>` : ''}
      <footer class="community-post-actions">
        <button type="button" class="${viewer.liked ? 'is-active' : ''}" data-community-like="${escapeHtml(post.postId)}">${iconSvg('thumbsUp')} <span>Like</span><em>${formatCount(post.counts.likes)}</em></button>
        <button type="button" class="${viewer.disliked ? 'is-active' : ''}" data-community-dislike="${escapeHtml(post.postId)}">${iconSvg('thumbsDown')} <span>Dislike</span><em>${formatCount(post.counts.dislikes)}</em></button>
        ${detail
          ? `<button type="button" data-scroll-comments>${iconSvg('messageCircle')} <span>${post.intent === 'feedback_request' ? 'Give Feedback' : 'Comment'}</span><em>${formatCount(post.counts.comments)}</em></button>`
          : `<a href="${communityPostRoute(post.postId)}#comments">${iconSvg('messageCircle')} <span>${post.intent === 'feedback_request' ? 'Give Feedback' : 'Comment'}</span><em>${formatCount(post.counts.comments)}</em></a>`}
        <button type="button" class="${viewer.saved ? 'is-active' : ''}" data-community-save="${escapeHtml(post.postId)}">${iconSvg('bookmark')} <span>Save</span><em>${formatCount(post.counts.saves)}</em></button>
        <button type="button" data-community-share="${escapeHtml(post.postId)}">${iconSvg('share2')} <span>Share</span><em>${formatCount(post.counts.shares)}</em></button>
      </footer>
      ${detail ? renderComments(post) : renderTopCommentPreview(post)}
    </article>
  `
}

function commentComposerKey(parentCommentId = '') {
  return String(parentCommentId || '').trim() || 'root'
}

function commentAttachmentDrafts(parentCommentId = '') {
  return state.commentAttachmentDrafts[commentComposerKey(parentCommentId)] || []
}

function renderCommentAttachmentDrafts(parentCommentId = '') {
  const items = commentAttachmentDrafts(parentCommentId)
  if (!items.length) return ''
  return `
    <div class="community-comment-attachment-drafts">
      ${items.map((item) => `
        <article>
          ${item.type === 'image' && item.previewURL ? `<img src="${escapeHtml(item.previewURL)}" alt="" />` : `<span>${iconSvg(item.type === 'audio' ? 'music' : 'fileText')}</span>`}
          <div>
            <strong>${escapeHtml(item.file?.name || 'Attachment')}</strong>
            <small>${escapeHtml(item.type)} · ${formatCount(Math.ceil(Number(item.file?.size || 0) / 1024))} KB</small>
          </div>
          <button type="button" data-remove-comment-attachment="${escapeHtml(item.id)}" data-comment-parent-id="${escapeHtml(parentCommentId)}" aria-label="Remove attachment">${iconSvg('x')}</button>
        </article>
      `).join('')}
    </div>
  `
}

function renderCommentAttachments(comment = {}, { compact = false } = {}) {
  const attachments = Array.isArray(comment.attachments) ? comment.attachments : []
  if (!attachments.length) return ''
  return `
    <div class="community-comment-attachments ${compact ? 'is-compact' : ''}">
      ${attachments.map((attachment) => {
        if (attachment.type === 'image' && attachment.url) {
          return `<button type="button" class="community-comment-image" data-open-community-image="${escapeHtml(attachment.url)}" data-community-image-name="${escapeHtml(attachment.name || 'Comment image')}"><img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name || 'Comment image')}" loading="lazy" /></button>`
        }
        if (attachment.type === 'audio' && attachment.url) {
          return `<div class="community-comment-audio"><strong>${escapeHtml(attachment.name || 'Audio attachment')}</strong><audio controls preload="none" src="${escapeHtml(attachment.url)}"></audio></div>`
        }
        return attachment.url
          ? `<a class="community-comment-file" href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener noreferrer">${iconSvg('fileText')}<span><strong>${escapeHtml(attachment.name || 'Project attachment')}</strong><small>Open project file</small></span></a>`
          : `<div class="community-comment-file is-unavailable">${iconSvg('fileText')}<span><strong>${escapeHtml(attachment.name || 'Attachment')}</strong><small>Attachment unavailable</small></span></div>`
      }).join('')}
    </div>
  `
}

function renderCommentComposer({ parentCommentId = '' } = {}) {
  if (!state.currentUser) {
    return `
      <section class="community-comment-composer">
        <p>Sign in to join the conversation.</p>
        <a class="button button-accent" href="${authRoute({ redirect: window.location.pathname })}">Sign In</a>
      </section>
    `
  }
  const isReply = Boolean(parentCommentId)
  const body = isReply ? state.replyDrafts[parentCommentId] || '' : state.commentDraft
  const isSubmitting = isReply ? state.replySubmittingFor === parentCommentId : state.commentSubmitting
  const composerKey = commentComposerKey(parentCommentId)
  const localError = (isReply ? state.replyErrors[parentCommentId] || '' : state.commentActionError || '') || state.commentAttachmentErrors[composerKey] || ''
  const progress = Number(state.commentAttachmentProgress[composerKey] || 0)
  return `
    <form class="community-comment-composer" ${isReply ? `data-community-reply-form="${escapeHtml(parentCommentId)}"` : 'data-community-comment-form'}>
      <div class="community-comment-composer-row">
        <span class="community-avatar community-comment-composer-avatar">${currentUserAvatar()}</span>
        <label>
          <span class="sr-only">${isReply ? 'Reply' : 'Comment'}</span>
          <textarea name="body" maxlength="2000" rows="${isReply ? '2' : '3'}" placeholder="${isReply ? 'Write a reply...' : 'Start the conversation...'}">${escapeHtml(body)}</textarea>
        </label>
      </div>
      ${renderCommentAttachmentDrafts(parentCommentId)}
      ${localError ? `<p class="community-error">${escapeHtml(localError)}</p>` : ''}
      ${isSubmitting && commentAttachmentDrafts(parentCommentId).length ? `<p class="community-comment-upload-state">Uploading attachments ${Math.round(progress)}%</p>` : ''}
      <div class="community-comment-tool-row" aria-label="Comment attachments">
        <button type="button" data-add-comment-attachment="image" data-comment-parent-id="${escapeHtml(parentCommentId)}" ${isSubmitting ? 'disabled' : ''}>${iconSvg('image')} <span>Image</span></button>
        <button type="button" data-add-comment-attachment="audio" data-comment-parent-id="${escapeHtml(parentCommentId)}" ${isSubmitting ? 'disabled' : ''}>${iconSvg('music')} <span>Music</span></button>
        <button type="button" data-add-comment-attachment="project" data-comment-parent-id="${escapeHtml(parentCommentId)}" ${isSubmitting ? 'disabled' : ''}>${iconSvg('cube')} <span>Project</span></button>
        <button type="button" disabled title="Comment emoji picker is coming soon.">${iconSvg('smile')} <span>Emoji</span></button>
        <input type="file" hidden data-comment-attachment-input="image" data-comment-parent-id="${escapeHtml(parentCommentId)}" accept="image/*" multiple />
        <input type="file" hidden data-comment-attachment-input="audio" data-comment-parent-id="${escapeHtml(parentCommentId)}" accept="audio/*" multiple />
        <input type="file" hidden data-comment-attachment-input="project" data-comment-parent-id="${escapeHtml(parentCommentId)}" accept=".json,.zip,.mid,.midi,.als,.flp,.logicx,.ptx,application/json,application/zip,application/octet-stream,audio/midi,audio/x-midi" multiple />
      </div>
      <div class="community-comment-form-actions is-quiet">
        <span>${Math.max(0, 2000 - body.length)} characters left</span>
        ${isReply ? `<button type="button" class="button button-muted" data-cancel-reply-composer="${escapeHtml(parentCommentId)}">Cancel</button>` : ''}
        <button type="submit" class="button button-accent" ${isSubmitting ? 'disabled' : ''}>${isSubmitting ? 'Posting...' : isReply ? 'Reply' : 'Post'}</button>
      </div>
    </form>
  `
}

function mergeCommentsById(existing = [], incoming = []) {
  const map = new Map()
  existing.forEach((comment) => {
    if (comment?.commentId) map.set(comment.commentId, comment)
  })
  incoming.forEach((comment) => {
    if (comment?.commentId) map.set(comment.commentId, comment)
  })
  return Array.from(map.values()).sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
}

function resetCommentPaginationState() {
  state.comments = []
  state.commentViewerState = {}
  state.commentsCursor = null
  state.commentsHasMore = false
  state.commentsLoading = false
  state.commentsLoadingMore = false
  state.commentsError = ''
  state.expandedReplies = {}
  state.repliesByParent = {}
  state.repliesLoadingFor = ''
  state.repliesLoadingMoreFor = ''
  state.replyPagination = {}
  state.replyComposerFor = ''
}

function defaultCommentsPage() {
  return { items: [], loading: false, loadingMore: false, loaded: false, error: '', cursor: null, hasMore: false }
}

function defaultRepliesPage() {
  return { items: [], loading: false, loadingMore: false, loaded: false, error: '', cursor: null, hasMore: false, expanded: false }
}

function commentsPageFor(postId = state.detailPostId) {
  const id = String(postId || '').trim()
  if (!id) return defaultCommentsPage()
  if (!state.commentsByPostId[id]) state.commentsByPostId[id] = defaultCommentsPage()
  return state.commentsByPostId[id]
}

function repliesPageFor(commentId = '') {
  const id = String(commentId || '').trim()
  if (!id) return defaultRepliesPage()
  if (!state.repliesByCommentId[id]) state.repliesByCommentId[id] = defaultRepliesPage()
  return state.repliesByCommentId[id]
}

function syncActiveCommentState(postId = state.detailPostId) {
  const page = commentsPageFor(postId)
  state.comments = page.items || []
  state.commentsLoading = Boolean(page.loading)
  state.commentsLoadingMore = Boolean(page.loadingMore)
  state.commentsLoaded = Boolean(page.loaded)
  state.commentsError = page.error || ''
  state.commentsCursor = page.cursor || null
  state.commentsHasMore = Boolean(page.hasMore)
  state.repliesByParent = Object.fromEntries(Object.entries(state.repliesByCommentId || {}).map(([commentId, pageState]) => [
    commentId,
    pageState.items || []
  ]))
  state.expandedReplies = Object.fromEntries(Object.entries(state.repliesByCommentId || {}).map(([commentId, pageState]) => [
    commentId,
    Boolean(pageState.expanded)
  ]))
  state.replyPagination = Object.fromEntries(Object.entries(state.repliesByCommentId || {}).map(([commentId, pageState]) => [
    commentId,
    { cursor: pageState.cursor || null, hasMore: Boolean(pageState.hasMore) }
  ]))
  const loadingReply = Object.entries(state.repliesByCommentId || {}).find(([, pageState]) => pageState.loading)
  const loadingMoreReply = Object.entries(state.repliesByCommentId || {}).find(([, pageState]) => pageState.loadingMore)
  state.repliesLoadingFor = loadingReply?.[0] || ''
  state.repliesLoadingMoreFor = loadingMoreReply?.[0] || ''
}

function resetActivePostComments(postId = state.detailPostId) {
  const id = String(postId || '').trim()
  if (id) state.commentsByPostId[id] = defaultCommentsPage()
  Object.keys(state.repliesByCommentId || {}).forEach((commentId) => {
    delete state.repliesByCommentId[commentId]
  })
  Object.values(state.commentAttachmentDrafts || {}).flat().forEach((item) => {
    if (item?.previewURL) URL.revokeObjectURL(item.previewURL)
  })
  state.commentAttachmentDrafts = {}
  state.commentAttachmentErrors = {}
  state.commentAttachmentProgress = {}
  resetCommentPaginationState()
}

function allLoadedComments() {
  syncActiveCommentState()
  return mergeCommentsById(state.comments, Object.values(state.repliesByParent || {}).flat())
}

function findLoadedComment(commentId = '') {
  return allLoadedComments().find((comment) => comment.commentId === commentId) || null
}

function commentCard(comment, replies = []) {
  const viewer = state.commentViewerState[comment.commentId] || {}
  const authorHref = comment.authorUid ? publicProfileRoute({ uid: comment.authorUid }) : ROUTES.profilePublic
  const canReply = !comment.parentCommentId
  const replyPage = repliesPageFor(comment.commentId)
  const repliesExpanded = Boolean(replyPage.expanded)
  const repliesLoading = Boolean(replyPage.loading)
  const repliesLoadingMore = Boolean(replyPage.loadingMore)
  return `
    <article class="community-comment-card ${comment.parentCommentId ? 'is-reply' : ''} ${[state.focusedCommentId, state.focusedReplyId].includes(comment.commentId) ? 'is-notification-target' : ''}" id="comment-${escapeHtml(comment.commentId)}" data-comment-id="${escapeHtml(comment.commentId)}">
      <header class="community-comment-header">
        <a class="community-author" href="${authorHref}">
          <span class="community-avatar">${postAvatar(comment)}</span>
          <span>
            ${communityDisplayNameMarkup(comment)}
            <em>${escapeHtml(formatUsername(comment.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(comment.createdAt))}</em>
          </span>
        </a>
        ${renderCommentOptionsMenu(comment, { postId: state.detailPostId })}
      </header>
      ${comment.body ? `<p class="community-comment-body">${escapeHtml(comment.body)}</p>` : ''}
      ${renderCommentAttachments(comment)}
      <footer class="community-comment-actions">
        <button type="button" class="${viewer.liked ? 'is-active' : ''}" data-community-comment-like="${escapeHtml(comment.commentId)}">${iconSvg('thumbsUp')} <span>${formatCount(comment.likeCount)}</span></button>
        <button type="button" class="${viewer.disliked ? 'is-active' : ''}" data-community-comment-dislike="${escapeHtml(comment.commentId)}">${iconSvg('thumbsDown')} <span>${formatCount(comment.dislikeCount)}</span></button>
        ${canReply ? `<button type="button" data-toggle-reply-composer="${escapeHtml(comment.commentId)}">${iconSvg('messageCircle')} <span>Reply</span></button>` : ''}
      </footer>
      ${state.replyComposerFor === comment.commentId ? renderCommentComposer({ parentCommentId: comment.commentId }) : ''}
      ${canReply && Number(comment.replyCount || 0) > 0 ? `
        <div class="community-comment-reply-toggle">
          <button type="button" class="button button-muted" data-toggle-comment-replies="${escapeHtml(comment.commentId)}" ${repliesLoading ? 'disabled' : ''}>
            ${repliesExpanded ? 'Hide replies' : `View ${formatCount(comment.replyCount)} repl${Number(comment.replyCount) === 1 ? 'y' : 'ies'}`}
          </button>
          ${repliesLoading ? '<span>Loading replies...</span>' : ''}
        </div>
      ` : ''}
      ${repliesExpanded ? `
        <div class="community-comment-replies community-replies-panel">
          ${replyPage.error ? `<p class="community-error">${escapeHtml(replyPage.error)}</p>` : ''}
          ${replies.length ? replies.map((reply) => commentCard(reply)).join('') : repliesLoading ? '<p class="community-comments-state community-replies-loading">Loading replies...</p>' : '<p class="community-comments-empty">No replies loaded yet.</p>'}
          ${replyPage.hasMore ? `<div class="community-load-more-row"><button type="button" class="button button-muted community-load-more-replies" data-load-more-comment-replies="${escapeHtml(comment.commentId)}" ${repliesLoadingMore ? 'disabled' : ''}>${repliesLoadingMore ? 'Loading replies...' : 'Load more replies'}</button></div>` : ''}
        </div>
      ` : ''}
    </article>
  `
}

function renderComments(post) {
  syncActiveCommentState(post.postId)
  const page = commentsPageFor(post.postId)
  const topLevel = state.comments.filter((comment) => !comment.parentCommentId)
  return `
    <section class="community-comments" id="comments" aria-labelledby="community-comments-title">
      <div class="community-comments-heading">
        <div>
          <h3 id="community-comments-title">Comments</h3>
          <p>${formatCount(post.counts.comments)} comment${Number(post.counts.comments) === 1 ? '' : 's'}</p>
        </div>
      </div>
      ${state.commentActionError ? `<p class="community-error">${escapeHtml(state.commentActionError)}</p>` : ''}
      ${post.commentsLocked ? '<p class="community-comments-state">Comments are locked for this post.</p>' : renderCommentComposer()}
      ${page.loading ? '<p class="community-comments-state community-comments-loading">Loading comments...</p>' : page.error ? `<p class="community-error">${escapeHtml(page.error)}</p>` : topLevel.length ? `
        <div class="community-comment-list">
          ${topLevel.map((comment) => commentCard(comment, state.repliesByParent[comment.commentId] || [])).join('')}
        </div>
        ${page.hasMore ? `<div class="community-load-more-row"><button type="button" class="button button-muted community-load-more-comments" data-load-more-comments ${page.loadingMore ? 'disabled' : ''}>${page.loadingMore ? 'Loading comments...' : 'Load more comments'}</button></div>` : ''}
      ` : '<p class="community-comments-empty">No comments yet. Start the conversation.</p>'}
    </section>
  `
}

function emptyCopy() {
  if (state.activeTab === 'following') return state.currentUser ? 'No posts from people you follow yet.' : 'Sign in to see people you follow.'
  if (state.activeTab === 'community') return `No posts in ${state.activeTopicLabel || 'this community'} yet.`
  if (state.activeTab === 'forms') return 'Community forms are being organized here.'
  if (['live', 'saved', 'my-content', 'my-account'].includes(state.activeTab)) return `${activeFeedTitle()} is coming soon.`
  if (state.activeTab === 'official') return 'No official posts yet.'
  if (['music', 'products', 'stage-plans', 'studio-projects', 'feedback', 'collaboration'].includes(state.activeTab)) return `No ${activeFeedTitle().toLowerCase()} posts yet.`
  return 'No posts yet. Be the first to share something.'
}

function renderFeedSkeletons() {
  return `
    <section class="community-feed is-loading" aria-label="Loading community posts">
      <div class="community-feed-state community-panel">
        <strong>${state.feedStillLoading ? 'Still loading posts...' : 'Loading posts...'}</strong>
        <span>${state.feedStillLoading ? 'The feed is taking longer than usual. The rest of Community is still available.' : 'Fetching the latest creator posts.'}</span>
      </div>
      ${Array.from({ length: 4 }).map(() => `
        <article class="community-post-card community-post-skeleton" aria-hidden="true">
          <div class="community-skeleton-line is-author"></div>
          <div class="community-skeleton-line is-title"></div>
          <div class="community-skeleton-line"></div>
          <div class="community-skeleton-line is-short"></div>
        </article>
      `).join('')}
    </section>
  `
}

function renderDetailSkeleton() {
  return `
    <section class="community-post-card community-post-detail-card is-detail community-post-skeleton" aria-label="Loading post">
      <div class="community-skeleton-line is-author"></div>
      <div class="community-skeleton-line is-title"></div>
      <div class="community-skeleton-line"></div>
      <div class="community-skeleton-line"></div>
      <div class="community-skeleton-line is-short"></div>
    </section>
  `
}

function renderFeed() {
  if (state.feedInitialLoading && !state.posts.length) return renderFeedSkeletons()
  if (state.error) return `<section class="community-feed-state community-panel"><strong>Could not load community.</strong><span>${escapeHtml(state.error)}</span><button type="button" class="button button-muted" data-reload-community>Retry</button></section>`
  if (state.feedError && !state.posts.length) return `<section class="community-feed-state community-panel"><strong>Could not load posts.</strong><span>${escapeHtml(state.feedError)}</span><button type="button" class="button button-muted" data-reload-community>Retry</button></section>`
  if (!state.posts.length) {
    return `
      <section class="community-feed-state community-panel">
        <strong>${escapeHtml(emptyCopy())}</strong>
        <button type="button" class="button button-accent" data-open-community-composer>Create Post</button>
      </section>
    `
  }
  return `
    <section class="community-feed" aria-label="Community posts">
      ${state.posts.map((post) => postCard(post)).join('')}
      ${state.feedError ? `<div class="community-feed-state community-panel"><strong>Could not load more posts.</strong><span>${escapeHtml(state.feedError)}</span></div>` : ''}
      <div class="community-feed-sentinel" data-community-feed-sentinel aria-hidden="true"></div>
      ${state.feedLoadingMore ? '<div class="community-feed-more-state">Loading more posts...</div>' : state.feedHasMore ? '<button type="button" class="community-load-more button button-muted" data-load-more-posts>Load more</button>' : '<div class="community-feed-more-state">You are caught up.</div>'}
    </section>
  `
}

function renderCommunityFormsSection({ standalone = false } = {}) {
  return `
    <section class="community-panel community-framework-section ${standalone ? 'is-standalone' : ''}">
      <div class="community-panel-heading">
        <div>
          <p class="eyebrow">Forms</p>
          <h2>Forms & Requests</h2>
          <p>Common request workflows now live inside Community so creators do not have to hunt through the global nav.</p>
        </div>
      </div>
      <div class="community-framework-grid">
        ${COMMUNITY_FORM_LINKS.map((item) => `
          <a class="community-framework-card" href="${escapeHtml(item.href)}">
            <span class="community-framework-icon">${iconSvg('fileText')}</span>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(item.description)}</p>
            <span class="community-framework-meta">Open form</span>
          </a>
        `).join('')}
      </div>
    </section>
  `
}

function renderFormsPage() {
  return `
    <section class="community-framework-page">
      <header class="community-feed-toolbar community-framework-hero">
        <div>
          <p class="eyebrow">Community</p>
          <h1>Forms</h1>
          <p>Find Melogic request workflows, support forms, and creator intake paths from inside Community.</p>
        </div>
      </header>
      ${renderCommunityFormsSection({ standalone: true })}
    </section>
  `
}

function renderCommunityPlaceholderPage({ title = '', description = '', eyebrow = 'Community' } = {}) {
  return `
    <section class="community-framework-page">
      <header class="community-feed-toolbar community-framework-hero">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(description)}</p>
        </div>
      </header>
      <section class="community-feed-state community-panel">
        <strong>Coming soon</strong>
        <span>This area is being shaped into a real Community surface. Nothing is broken; it just is not live yet.</span>
      </section>
    </section>
  `
}

function renderCommunityInitialFeedLoader() {
  return `
    <section class="community-initial-feed-loader" role="status" aria-live="polite" aria-label="Loading Community">
      <span class="community-initial-feed-loader-mark" aria-hidden="true">
        <img src="${communityLoadingLogoUrl}" alt="" />
      </span>
    </section>
  `
}

function renderActiveCommunityTabContent() {
  if (state.activeTab === 'forms') return renderFormsPage()
  if (state.activeTab === 'live') {
    return renderCommunityPlaceholderPage({
      title: 'Live',
      description: 'Live sessions, streams, listening rooms, and real-time creator events will live here.'
    })
  }
  if (state.activeTab === 'saved') {
    return renderCommunityPlaceholderPage({
      title: 'Saved',
      description: 'Saved posts and community references will be organized here.'
    })
  }
  if (state.activeTab === 'my-content') {
    return renderCommunityPlaceholderPage({
      title: 'My Content',
      description: 'Your posts, replies, shared music, StageMaker posts, and DAW project shares will collect here.'
    })
  }
  if (state.activeTab === 'my-account') {
    return renderCommunityPlaceholderPage({
      title: 'My Account',
      description: 'Community account preferences and identity controls will be collected here.'
    })
  }
  if (state.view.type === 'feed' && state.initialHomeHydration) return `<div data-community-feed-region>${renderCommunityInitialFeedLoader()}</div>`
  return `<div data-community-feed-region>${renderFeed()}</div>`
}

function renderCommunityCard(community) {
  const focused = Boolean(state.communityFocus[community.communityId])
  const focusDisabled = false
  return `
    <article class="community-community-card">
      <a class="community-community-main" href="${communityRoute(community.slug)}">
        <span class="community-community-icon">${community.iconURL ? `<img src="${escapeHtml(community.iconURL)}" alt="" loading="lazy" />` : escapeHtml(community.name.slice(0, 1).toUpperCase())}</span>
        <span>
          <strong>${escapeHtml(community.name)}</strong>
          <em>c/${escapeHtml(community.slug)} · ${escapeHtml(community.category)}</em>
        </span>
      </a>
      <p>${escapeHtml(community.description || 'A Melogic creator community.')}</p>
      <div class="community-community-stats">
        <span>${formatCount(community.focusCount)} focused</span>
        <span>${formatCount(community.postCount)} posts</span>
        <span>${escapeHtml(community.postingMode.replace(/_/g, ' '))}</span>
      </div>
      <div class="community-card-actions">
        <button type="button" class="button ${focused ? 'button-muted' : 'button-accent'}" ${focusDisabled ? 'disabled title="Focus is available once this community is active."' : `data-toggle-community-focus="${escapeHtml(community.communityId)}"`}>${focusDisabled ? 'Focus soon' : focused ? 'Focused' : 'Focus'}</button>
        <a class="button button-muted" href="${communityRoute(community.slug)}">Open</a>
      </div>
    </article>
  `
}

function renderCommunitiesView() {
  const categories = directoryCategoryOptions()
  const focusedCount = state.communities.filter((community) => community?.communityId && state.communityFocus[community.communityId]).length
  return `
    <div class="community-layout is-home is-directory community-network-directory">
      ${renderLeftNav()}
      <div class="community-main community-route-main">
        <div class="community-mobile-stories community-mobile-discover-stories">${renderStoriesRow()}</div>
        <div class="community-mobile-discover-navigation">${renderMobileCommunityTabs({ active: 'discover' })}</div>
        <section class="community-hero compact community-network-discover-hero">
          <div>
            <p class="eyebrow">Network</p>
            <h1>Discover Communities</h1>
            <p>Find groups built around people, organizations, institutions, places, and shared creative work.</p>
          </div>
          <div class="community-network-directory-summary" aria-label="Community summary">
            <strong>${formatCount(focusedCount)}</strong>
            <span>in your navigator</span>
          </div>
        </section>
        <section class="community-panel community-community-tools" aria-label="Discover community filters">
          <label>
            <span>Search</span>
            <input name="communitySearch" value="${escapeHtml(state.communityFilters.search)}" placeholder="Search communities" data-community-search />
          </label>
          <label>
            <span>Category</span>
            <select data-community-category>
              ${categories.map((category) => `<option value="${escapeHtml(category)}" ${state.communityFilters.category === category ? 'selected' : ''}>${category === 'all' ? 'All categories' : escapeHtml(category)}</option>`).join('')}
            </select>
          </label>
          <a class="button button-muted community-network-create-community" href="${ROUTES.communityCreate}">${iconSvg('plus')} <span>Create Community</span></a>
        </section>
        ${state.communityFilters.loading ? '<section class="community-feed-state community-panel">Loading communities...</section>' : state.communityFilters.error ? `<section class="community-feed-state community-panel"><strong>Could not load communities.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>` : `<section class="community-community-grid">${directoryCommunities().map(renderCommunityCard).join('') || '<div class="community-feed-state community-panel"><strong>No communities are live yet.</strong><span>Communities will appear here once active and discoverable.</span></div>'}</section>`}
      </div>
      ${renderSidebar()}
    </div>
  `
}

function renderReportModal() {
  if (!state.report.open) return ''
  const isCommentReport = state.report.targetType === 'community_comment'
  const isStoryReport = state.report.targetType === 'community_story'
  const reportLabel = isStoryReport ? 'Story' : isCommentReport ? 'Comment' : 'Post'
  return `
    <div class="community-modal-backdrop">
      <section class="community-report-modal" role="dialog" aria-modal="true" aria-labelledby="community-report-title">
        <header>
          <h2 id="community-report-title">Report ${reportLabel}</h2>
          <button type="button" data-close-community-report aria-label="Close report modal">${iconSvg('x')}</button>
        </header>
        ${state.report.message ? `<p class="community-success">${escapeHtml(state.report.message)}</p>` : `
          <form data-community-report-form>
            <label>
              <span>Reason</span>
              <select name="reason">${REPORT_REASONS.map((reason) => `<option value="${escapeHtml(reason)}" ${state.report.reason === reason ? 'selected' : ''}>${escapeHtml(reason)}</option>`).join('')}</select>
            </label>
            <label>
              <span>Description</span>
              <textarea name="description" maxlength="2000" rows="5" placeholder="Add details for the moderation team.">${escapeHtml(state.report.description)}</textarea>
            </label>
            ${state.report.error ? `<p class="community-error">${escapeHtml(state.report.error)}</p>` : ''}
            <div class="community-form-actions">
              <button type="button" class="button button-muted" data-close-community-report ${state.report.submitting ? 'disabled' : ''}>Cancel</button>
              <button type="submit" class="button button-accent" ${state.report.submitting ? 'disabled' : ''}>${state.report.submitting ? 'Submitting...' : 'Submit Report'}</button>
            </div>
          </form>
        `}
      </section>
    </div>
  `
}

function renderEditPostModal() {
  if (!state.editPost.open) return ''
  const post = postById(state.editPost.postId) || {}
  const hasAttachments = Array.isArray(post.attachments) && post.attachments.length > 0
  return `
    <div class="community-modal-backdrop">
      <section class="community-report-modal community-edit-post-modal" role="dialog" aria-modal="true" aria-labelledby="community-edit-post-title">
        <header>
          <h2 id="community-edit-post-title">Edit Post</h2>
          <button type="button" data-close-edit-post aria-label="Close edit post modal">${iconSvg('x')}</button>
        </header>
        <form data-community-edit-post-form>
          <label>
            <span>Title</span>
            <input name="title" maxlength="120" value="${escapeHtml(state.editPost.title)}" placeholder="Optional title" />
          </label>
          <label>
            <span>Post</span>
            <textarea name="body" maxlength="4000" rows="7" placeholder="What do you want to share?">${escapeHtml(state.editPost.body)}</textarea>
          </label>
          <label>
            <span>Tags</span>
            <input name="tags" maxlength="180" value="${escapeHtml(state.editPost.tags)}" placeholder="mixing, feedback, stage" />
          </label>
          <label>
            <span>Visibility</span>
            <select name="visibility">
              <option value="public" ${state.editPost.visibility === 'public' ? 'selected' : ''}>Public</option>
            </select>
          </label>
          ${hasAttachments ? '<p class="community-muted-note">Attachment editing is coming soon.</p>' : ''}
          ${state.editPost.error ? `<p class="community-error">${escapeHtml(state.editPost.error)}</p>` : ''}
          <div class="community-form-actions">
            <button type="button" class="button button-muted" data-close-edit-post ${state.editPost.submitting ? 'disabled' : ''}>Cancel</button>
            <button type="submit" class="button button-accent" ${state.editPost.submitting ? 'disabled' : ''}>${state.editPost.submitting ? 'Saving...' : 'Save Changes'}</button>
          </div>
        </form>
      </section>
    </div>
  `
}

/* melogic-community-image-zoom-mobile-hover-v2 */
function bindCommunityImageViewerZoom() {
  const stage=app?.querySelector('[data-community-image-zoom-stage]')
  const image=stage?.querySelector('[data-community-image-zoom-target]')
  if(!stage||!image)return
  let scale=1,x=0,y=0,startDistance=0,startScale=1,startMidpoint=null,panStart=null
  const clamp=(v,min,max)=>Math.min(max,Math.max(min,v))
  const midpoint=(a,b)=>({x:(a.clientX+b.clientX)/2,y:(a.clientY+b.clientY)/2})
  const distance=(a,b)=>Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY)
  const apply=()=>{if(scale<=1){scale=1;x=0;y=0} image.style.transform=`translate3d(${x}px,${y}px,0) scale(${scale})`;image.classList.toggle('is-zoomed',scale>1.01)}
  const reset=()=>{scale=1;x=0;y=0;apply()}
  stage.addEventListener('touchstart',(event)=>{
    if(event.touches.length===2){event.preventDefault();startDistance=distance(event.touches[0],event.touches[1]);startScale=scale;startMidpoint=midpoint(event.touches[0],event.touches[1]);panStart=null}
    else if(event.touches.length===1&&scale>1)panStart={clientX:event.touches[0].clientX,clientY:event.touches[0].clientY,x,y}
  },{passive:false})
  stage.addEventListener('touchmove',(event)=>{
    if(event.touches.length===2&&startDistance>0){event.preventDefault();const nextMid=midpoint(event.touches[0],event.touches[1]);scale=clamp(startScale*(distance(event.touches[0],event.touches[1])/startDistance),1,5);if(startMidpoint){x+=nextMid.x-startMidpoint.x;y+=nextMid.y-startMidpoint.y;startMidpoint=nextMid}apply()}
    else if(event.touches.length===1&&scale>1&&panStart){event.preventDefault();x=panStart.x+(event.touches[0].clientX-panStart.clientX);y=panStart.y+(event.touches[0].clientY-panStart.clientY);apply()}
  },{passive:false})
  stage.addEventListener('touchend',(event)=>{if(event.touches.length<2){startDistance=0;startMidpoint=null}if(event.touches.length===0)panStart=null;if(scale<1.02)reset()},{passive:false})
  let lastTap=0
  stage.addEventListener('touchend',(event)=>{if(event.changedTouches.length!==1)return;const now=Date.now();if(now-lastTap<280){event.preventDefault();scale=scale>1?1:2;x=0;y=0;apply();lastTap=0}else lastTap=now},{passive:false})
  image.addEventListener('dblclick',(event)=>{event.preventDefault();scale=scale>1?1:2;x=0;y=0;apply()})
}

function renderCommunityImageViewer() {
  if (!state.imageViewer.open || !state.imageViewer.url) return ''
  return `
    <div class="community-image-viewer-backdrop" data-community-image-viewer-backdrop>
      <section class="community-image-viewer" role="dialog" aria-modal="true" aria-label="${escapeHtml(state.imageViewer.name || 'Image attachment')}">
        <header>
          <span>${escapeHtml(state.imageViewer.name || 'Image attachment')}</span>
          <button type="button" data-close-community-image-viewer aria-label="Close image viewer">${iconSvg('x')}</button>
        </header>
        <div class="community-image-viewer-stage" data-community-image-zoom-stage>
          <img src="${escapeHtml(state.imageViewer.url)}" alt="${escapeHtml(state.imageViewer.name || 'Community attachment')}" data-community-image-zoom-target draggable="false" />
        </div>
        <footer>
          <a class="button button-muted" href="${escapeHtml(state.imageViewer.url)}" target="_blank" rel="noopener noreferrer">Open original</a>
        </footer>
      </section>
    </div>
  `
}

function renderLeftNav() {
  // melogic-community-navigator-p3
  // Focus is still the compatibility source until canonical membership lands,
  // but the navigation now treats focused communities as persistent places
  // rather than generic feed filters.
  const focusedCommunities = state.communities
    .filter((community) => community?.communityId && state.communityFocus[community.communityId])
    .slice(0, 7)

  const communityLink = (community) => {
    const isCurrent = state.view.type === 'community'
      && (state.activeCommunityId === community.communityId || state.activeCommunitySlug === community.slug)
    return `
      <a class="community-network-place ${isCurrent ? 'is-active' : ''}"
        href="${communityRoute(community.slug)}"
        data-network-community-id="${escapeHtml(community.communityId)}"
        aria-current="${isCurrent ? 'page' : 'false'}">
        <span class="community-network-place-avatar" aria-hidden="true">
          ${community.iconURL
            ? `<img src="${escapeHtml(community.iconURL)}" alt="" loading="lazy" />`
            : escapeHtml((community.name || 'M').slice(0, 1).toUpperCase())
          }
        </span>
        <span class="community-network-place-copy">
          <strong>${escapeHtml(community.name || 'Community')}</strong>
          <small>${community.official ? 'Official community' : 'Community'}</small>
        </span>
      </a>
    `
  }

  return `
    <aside class="community-left-nav community-network-nav" aria-label="Melogic network navigation">
      <a class="community-side-brand" href="${ROUTES.community}" aria-label="Network home">NETWORK</a>

      <nav>
        <section class="community-network-nav-section" aria-label="Network">
          <a class="${state.view.type === 'feed' && state.activeTab === 'for-you' ? 'is-active' : ''}" href="${ROUTES.community}?feed=for-you" aria-current="${state.view.type === 'feed' && state.activeTab === 'for-you' ? 'page' : 'false'}" data-community-desktop-feed-link="for-you" data-community-desktop-surface="for-you">
            <span class="community-network-home-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 10.8 12 3.8l8.5 7v9.4a.8.8 0 0 1-.8.8h-5.2v-6.2h-5V21H4.3a.8.8 0 0 1-.8-.8v-9.4Z"/></svg></span> <span>For You</span>
          </a>
          <a class="${state.view.type === 'feed' && state.activeTab === 'following' ? 'is-active' : ''}" href="${ROUTES.community}?feed=following" aria-current="${state.view.type === 'feed' && state.activeTab === 'following' ? 'page' : 'false'}" data-community-desktop-feed-link="following" data-community-desktop-surface="following">
            ${iconSvg('users')} <span>Following</span>
          </a>
          <a class="${state.view.type === 'communities' ? 'is-active' : ''}" href="${ROUTES.communityCommunities}" aria-current="${state.view.type === 'communities' ? 'page' : 'false'}" data-community-desktop-surface="discover">
            ${iconSvg('search')} <span>Discover</span>
          </a>
        </section>

        <section class="community-network-nav-section community-network-places" aria-labelledby="community-network-places-heading">
          <div class="community-network-section-heading" id="community-network-places-heading">
            <span>Your Communities</span>
            <span class="community-network-place-count">${focusedCommunities.length || ''}</span>
          </div>
          <div class="community-network-place-list">
            ${focusedCommunities.length
              ? focusedCommunities.map(communityLink).join('')
              : `<div class="community-network-empty-state">
                  <strong>No communities yet</strong>
                  <span>Focus a community to keep it here while membership is being built.</span>
                </div>`
            }
          </div>
        </section>

        <section class="community-network-nav-section community-network-left-discovery" aria-label="Suggested communities">
          <div data-community-discovery-widget>
            ${renderCommunityDiscoveryBody()}
          </div>
        </section>
      </nav>
    </aside>
  `
}

function trendingCommunities() {
  return [...displayedCommunities()]
    .sort((a, b) => {
      const scoreA = Number(a.focusCount || 0) + Number(a.postCount || 0)
      const scoreB = Number(b.focusCount || 0) + Number(b.postCount || 0)
      return scoreB - scoreA
    })
    .slice(0, 6)
}

function suggestedCommunities() {
  return displayedCommunities()
    .filter((community) => !state.communityFocus[community.communityId])
    .slice(0, 8)
}

function renderCommunityDiscoveryBody() {
  const isTrending = state.discoveryTab === 'trending'
  const communities = isTrending ? trendingCommunities().slice(0, 8) : suggestedCommunities()
  return `
    <div class="community-discovery-heading">
      <h2>Discover Communities</h2>
      <a href="${ROUTES.communityCommunities}">View all</a>
    </div>
    <div class="community-discovery-tabs" role="tablist" aria-label="Community discovery">
      <button type="button" role="tab" aria-selected="${isTrending ? 'false' : 'true'}" class="${isTrending ? '' : 'is-active'}" data-community-discovery-tab="suggested">Suggested</button>
      <button type="button" role="tab" aria-selected="${isTrending ? 'true' : 'false'}" class="${isTrending ? 'is-active' : ''}" data-community-discovery-tab="trending">Trending</button>
    </div>
    ${communities.length ? `
      <div class="community-suggested-list">
        ${communities.map((community) => `
          <article>
            <a href="${communityRoute(community.slug)}" title="${escapeHtml(`${formatCount(community.focusCount)} focused · ${formatCount(community.postCount)} posts`)}">
              <span>${escapeHtml(community.name.slice(0, 1).toUpperCase())}</span>
              <strong>${escapeHtml(community.name)}</strong>
            </a>
            ${isTrending ? '' : `<button type="button" data-toggle-community-focus="${escapeHtml(community.communityId)}">${state.communityFocus[community.communityId] ? 'Focused' : 'Focus'}</button>`}
          </article>
        `).join('')}
      </div>
    ` : `<p>${isTrending ? 'Communities will trend here as creators focus and post.' : 'Communities will appear here as creators focus spaces.'}</p>`}
  `
}

function renderNetworkActivityCard() {
  const focusedCount = state.communities.filter((community) => community?.communityId && state.communityFocus[community.communityId]).length
  const visiblePosts = state.posts.length
  return `
    <section class="community-rail-card community-network-context-card">
      <div class="community-network-rail-heading">
        <span>Network</span>
        <strong>Relevant to You</strong>
      </div>
      <div class="community-network-signal-grid">
        <div><strong>${formatCount(focusedCount)}</strong><span>Communities</span></div>
        <div><strong>${formatCount(visiblePosts)}</strong><span>Feed items</span></div>
      </div>
      <p>As Melogic learns your projects, collaborators, skills, and communities, useful people and work will surface here.</p>
      <a href="${ROUTES.communityCommunities}">Explore the network</a>
    </section>
  `
}

function renderCommunityContextRail() {
  const community = state.community
  if (!community) return renderNetworkActivityCard()
  const focused = Boolean(state.communityFocus[community.communityId])
  const membershipState = state.communityMembership[community.communityId] || {}
  const membershipStatus = membershipState.membership?.status || ''
  const relationship = membershipStatus === 'member'
    ? 'Member'
    : membershipStatus === 'pending'
      ? 'Join pending'
      : focused
        ? 'Focused'
        : 'Discovering'
  return `
    <section class="community-rail-card community-network-context-card is-community community-workspace-inspector">
      <div class="community-network-rail-heading">
        <span>Current Community</span>
        <strong>${escapeHtml(community.name)}</strong>
      </div>
      <div class="community-workspace-presence">
        <span class="community-workspace-presence-dot" aria-hidden="true"></span>
        <strong>Community workspace</strong>
        <small>Shared activity and collaboration</small>
      </div>
      <div class="community-network-context-list">
        <span><strong>Relationship</strong><em>${relationship}</em></span>
        <span><strong>Members</strong><em>${formatCount(community.memberCount)}</em></span>
        <span><strong>Focused</strong><em>${formatCount(community.focusCount)}</em></span>
        <span><strong>Posts</strong><em>${formatCount(community.postCount)}</em></span>
        <span><strong>Category</strong><em>${escapeHtml(community.category || 'Community')}</em></span>
      </div>
      <a href="${ROUTES.communityCommunities}">Discover more communities</a>
    </section>
  `
}

function renderNetworkNextCard() {
  const isCommunity = state.view.type === 'community' && state.community
  return `
    <section class="community-rail-card community-network-next-card">
      <div class="community-network-rail-heading">
        <span>Next</span>
        <strong>${isCommunity ? 'Inside this community' : 'Across your network'}</strong>
      </div>
      <div class="community-network-next-list">
        ${isCommunity ? `
          <button type="button" data-community-workspace-tab="community-projects">${iconSvg('cube')}<span><strong>Projects</strong><small>Shared work connected here</small></span></button>
          <button type="button" data-community-workspace-tab="community-people">${iconSvg('user')}<span><strong>People</strong><small>Members and collaborators</small></span></button>
          <button type="button" data-community-workspace-tab="community-opportunities">${iconSvg('search')}<span><strong>Opportunities</strong><small>Open roles and requests</small></span></button>
        ` : `
          <a href="${ROUTES.communityCommunities}">${iconSvg('search')}<span><strong>Find communities</strong><small>Discover relevant groups</small></span></a>
          <a href="${ROUTES.communityCreate}">${iconSvg('plus')}<span><strong>Create a community</strong><small>Build a place for your people</small></span></a>
        `}
      </div>
    </section>
  `
}

const COMMUNITY_TDIH_ENDPOINT = 'https://en.wikipedia.org/api/rest_v1/feed/onthisday/events'

function communityHistoryEvent() {
  return state.history.events[state.history.index] || null
}

function communityHistoryPageUrl(event = communityHistoryEvent()) {
  const page = event?.pages?.[0]
  return page?.content_urls?.desktop?.page || page?.content_urls?.mobile?.page || ''
}

function renderCommunityHistoryBody() {
  if (state.history.loading && !state.history.loaded) {
    return '<p class="community-history-state">Fetching today’s history from Wikipedia…</p>'
  }
  if (state.history.error && !state.history.events.length) {
    return `<p class="community-history-state is-error">${escapeHtml(state.history.error)}</p>
      <div class="community-history-actions"><button type="button" class="button" data-community-history-retry>Try again</button></div>`
  }
  const event = communityHistoryEvent()
  if (!event) return '<p class="community-history-state">No historical events were found for today.</p>'
  const url = communityHistoryPageUrl(event)
  return `
    <div class="community-history-event">
      <strong>${escapeHtml(String(event.year || ''))}</strong>
      <p>${escapeHtml(event.text || '')}</p>
    </div>
    <div class="community-history-actions">
      ${url ? `<a class="button community-history-learn" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Learn more</a>` : ''}
      <button type="button" class="button community-history-new" data-community-history-new ${state.history.events.length < 2 ? 'disabled' : ''}>New one</button>
    </div>
    <a class="community-history-attribution" href="https://en.wikipedia.org/" target="_blank" rel="noopener noreferrer">From Wikipedia</a>
  `
}

function updateCommunityHistoryRegions(root = app, { bind = true } = {}) {
  root?.querySelectorAll?.('[data-community-history-body]').forEach((region) => {
    region.innerHTML = renderCommunityHistoryBody()
    if (bind) bindCommunityHistoryEvents(region)
  })
}

function pickNextCommunityHistoryEvent() {
  const total = state.history.events.length
  if (total < 2) return
  let next = state.history.index
  while (next === state.history.index) next = Math.floor(Math.random() * total)
  state.history.index = next
  updateCommunityHistoryRegions(app)
}

function bindCommunityHistoryEvents(root = app) {
  root?.querySelectorAll?.('[data-community-history-new]').forEach((button) => {
    button.addEventListener('click', pickNextCommunityHistoryEvent)
  })
  root?.querySelectorAll?.('[data-community-history-retry]').forEach((button) => {
    button.addEventListener('click', () => void loadCommunityHistory({ force: true }))
  })
}

async function loadCommunityHistory({ force = false } = {}) {
  if (isMobileSpaRuntime()) return
  if (!force && (state.history.loading || state.history.loaded)) {
    updateCommunityHistoryRegions(app)
    return
  }
  const today = new Date()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  state.history.loading = true
  state.history.error = ''
  updateCommunityHistoryRegions(app)
  try {
    const response = await fetch(`${COMMUNITY_TDIH_ENDPOINT}/${month}/${day}`, {
      headers: { accept: 'application/json' }
    })
    if (!response.ok) throw new Error(`Wikipedia returned ${response.status}.`)
    const payload = await response.json()
    const events = Array.isArray(payload?.events)
      ? payload.events.filter((event) => event?.text && Number.isFinite(Number(event?.year)))
      : []
    state.history.events = events
    state.history.index = events.length ? Math.floor(Math.random() * events.length) : 0
    state.history.loaded = true
    state.history.dateLabel = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(today)
    if (!events.length) state.history.error = 'No historical events were found for today.'
  } catch (error) {
    console.warn('[community] Wikipedia history load failed', error)
    state.history.error = 'History could not be loaded from Wikipedia.'
  } finally {
    state.history.loading = false
    updateCommunityHistoryRegions(app)
  }
}

function renderSidebar() {
  const inCommunity = state.view.type === 'community'
  return `
    <aside class="community-right-rail community-sidebar community-network-right-rail">
      <form class="community-rail-search" data-community-feed-search>
        ${iconSvg('search')}
        <input type="search" name="communityFeedSearch" value="${escapeHtml(state.feedSearch)}" placeholder="Search the network" aria-label="Search the network" />
        <button type="submit" aria-label="Search">Search</button>
      </form>
      ${inCommunity ? renderCommunityContextRail() : `
        <div class="community-right-stories">
          ${renderStoriesRow()}
        </div>
        ${renderNetworkActivityCard()}
      `}
      ${renderNetworkNextCard()}
      ${!inCommunity ? `
        <section class="community-rail-card community-history-card" aria-label="This Day in History">
          <div class="community-history-heading">
            <div>
              <span class="community-network-kicker">History</span>
              <h2>This Day in History</h2>
            </div>
            <time datetime="${new Date().toISOString().slice(0, 10)}">${new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date())}</time>
          </div>
          <div data-community-history-body>
            ${renderCommunityHistoryBody()}
          </div>
        </section>
      ` : ''}
      ${renderCommunityRailFooter()}
    </aside>
  `
}

function bindStoryRailEvents(root = app) {
  root?.querySelectorAll('[data-open-story-composer]').forEach((button) => button.addEventListener('click', openStoryComposer))
  root?.querySelectorAll('[data-open-story]').forEach((button) => button.addEventListener('click', () => openStoryViewer(button.getAttribute('data-open-story') || '')))
  root?.querySelectorAll('[data-pending-story-action="retry"]').forEach((button) => button.addEventListener('click', () => void publishPendingCameraStory()))
}

function updateStoryRegionsInRoot(root, { bind = false } = {}) {
  root?.querySelectorAll?.('.community-right-stories, .community-mobile-stories').forEach((region) => {
    region.innerHTML = renderStoriesRow()
    if (bind) bindStoryRailEvents(region)
  })
}

function updateStoryRegionsOnly() {
  updateStoryRegionsInRoot(app, { bind: true })

  // Detached desktop SPA surfaces are live caches, not historical snapshots.
  // Reconcile their Story rails now so restoring one cannot resurrect expired
  // Stories or stale verification badges.
  desktopCommunitySurfaceCache.forEach((cached) => updateStoryRegionsInRoot(cached?.fragment, { bind: false }))
  mobileCommunitySurfaceCache.forEach((cached) => updateStoryRegionsInRoot(cached?.fragment, { bind: false }))
  updateCommunityRailFadeState()
}

function bindTopicRailEvents(root = app) {
  root?.querySelectorAll('[data-topic-community-id]').forEach((button) => {
    button.addEventListener('click', () => selectTopicCommunity({
      communityId: button.getAttribute('data-topic-community-id') || ''
    }))
  })
  syncCommunityFilterControls(root)
  root?.querySelector('[data-clear-community-filters]')?.addEventListener('click', () => {
    void applyCommunityFilterSelection([])
  })
  root?.querySelectorAll('[data-topic-scroll]').forEach((button) => {
    button.addEventListener('click', () => {
      const scroller = app.querySelector('[data-community-topic-scroll]')
      if (!scroller) return
      const direction = Number(button.getAttribute('data-topic-scroll') || 1)
      scroller.scrollBy({ left: direction * Math.max(220, scroller.clientWidth * .65), behavior: 'smooth' })
      window.setTimeout(updateTopicArrowState, 260)
    })
  })
  root?.querySelector('[data-community-topic-scroll]')?.addEventListener('scroll', updateTopicArrowState, { passive: true })
  updateTopicArrowState()
}

function updateCommunitySharedRegionsInRoot(root, { bind = false } = {}) {
  if (!root?.querySelectorAll) return

  root.querySelectorAll('.community-left-nav').forEach((currentNav) => {
    const holder = document.createElement('div')
    holder.innerHTML = renderLeftNav().trim()
    const nextNav = holder.firstElementChild
    if (nextNav) currentNav.replaceWith(nextNav)
  })

  root.querySelectorAll('[data-community-discovery-widget]').forEach((discovery) => {
    discovery.innerHTML = renderCommunityDiscoveryBody()
    if (bind) {
      bindCommunityDiscoveryWidgetEvents(discovery)
      bindCommunityFocusButtons(discovery)
    }
  })

  root.querySelectorAll('.community-network-directory-summary').forEach((summary) => {
    const focusedCount = state.communities.filter((community) =>
      community?.communityId && state.communityFocus[community.communityId]
    ).length
    summary.innerHTML = `<strong>${formatCount(focusedCount)}</strong><span>in your navigator</span>`
  })
}

function reconcileCommunitySharedRegions() {
  updateCommunitySharedRegionsInRoot(app, { bind: true })
  desktopCommunitySurfaceCache.forEach((cached) => updateCommunitySharedRegionsInRoot(cached?.fragment, { bind: false }))
  mobileCommunitySurfaceCache.forEach((cached) => updateCommunitySharedRegionsInRoot(cached?.fragment, { bind: false }))
  updateCommunityRailFadeState()
}

async function hydrateDesktopCommunitySharedState({ fullDirectory = false } = {}) {
  if (isMobileSpaRuntime()) return false
  const generation = ++desktopCommunityHydrationGeneration
  state.communityFilters.loading = true
  state.communityFilters.error = ''
  try {
    const communities = await listCommunities({
      category: fullDirectory ? state.communityFilters.category : 'all',
      search: fullDirectory ? state.communityFilters.search : '',
      limitCount: fullDirectory ? 50 : 16
    })
    if (generation !== desktopCommunityHydrationGeneration) return false
    state.communities = communities
    await loadCommunityFocusState()
    if (generation !== desktopCommunityHydrationGeneration) return false
    reconcileCommunitySharedRegions()
    return true
  } catch (error) {
    if (generation !== desktopCommunityHydrationGeneration) return false
    console.warn('[community] shared community hydration failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details
    })
    state.communityFilters.error = error?.message || 'Communities could not be loaded.'
    return false
  } finally {
    if (generation === desktopCommunityHydrationGeneration) state.communityFilters.loading = false
  }
}

function updateCommunityAncillaryDom() {
  const currentHeader = app?.querySelector('.community-feed-header')
  if (currentHeader) {
    const holder = document.createElement('div')
    holder.innerHTML = renderTopicBar().trim()
    const nextHeader = holder.firstElementChild
    if (nextHeader) {
      currentHeader.replaceWith(nextHeader)
      bindTopicRailEvents(nextHeader)
    }
  }
  const discovery = app?.querySelector('[data-community-discovery-widget]')
  if (discovery) {
    discovery.innerHTML = renderCommunityDiscoveryBody()
    bindCommunityDiscoveryWidgetEvents(discovery)
    bindCommunityFocusButtons(discovery)
  }
}

function renderCommunityRailFooter() {
  const links = [
    ['About', ROUTES.about],
    ['Contact', ROUTES.contact],
    ['Support', ROUTES.support],
    ['FAQ', ROUTES.faq],
    ['Privacy', ROUTES.privacy],
    ['Terms', ROUTES.terms],
    ['Refund Policy', ROUTES.refundPolicy],
    ['Creator Guidelines', ROUTES.creatorGuidelines],
    ['Ad Policy', ROUTES.adPolicy]
  ]
  return `
    <footer class="community-rail-footer">
      <nav aria-label="Site information">
        ${links.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}
      </nav>
      <p>© ${new Date().getFullYear()} Melogic Records</p>
    </footer>
  `
}

function bindCommunityFocusButtons(root = app) {
  root?.querySelectorAll('[data-toggle-community-focus]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleToggleFocus(button.getAttribute('data-toggle-community-focus'))
  }))
}

function bindCommunityDiscoveryWidgetEvents(root = app) {
  root?.querySelectorAll('[data-community-discovery-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextTab = button.getAttribute('data-community-discovery-tab') === 'trending' ? 'trending' : 'suggested'
      if (nextTab === state.discoveryTab) return
      state.discoveryTab = nextTab
      const widget = app?.querySelector('[data-community-discovery-widget]')
      if (!widget) return
      widget.innerHTML = renderCommunityDiscoveryBody()
      bindCommunityDiscoveryWidgetEvents(widget)
      bindCommunityFocusButtons(widget)
    })
  })
}

function renderDetail() {
  const post = state.posts[0]
  const postLoading = state.detailPostLoading && !post
  return `
    <div class="community-layout is-home is-post-detail">
      ${renderLeftNav()}
      <div class="community-main community-route-main">
        <section class="community-detail-topbar community-detail-topbar-desktop">
          <div class="community-detail-title-track" aria-label="Post title">
            <h1>${post ? escapeHtml(post.title || 'Post') : 'Post'}</h1>
          </div>
          <a class="button button-muted" href="${ROUTES.community}" data-community-back-to-feed>${iconSvg('arrowLeft')} <span>Back</span></a>
        </section>
        ${postLoading ? renderDetailSkeleton() : state.error ? `<section class="community-feed-state community-panel"><strong>Could not load post.</strong><span>${escapeHtml(state.error)}</span></section>` : post ? postCard(post, { detail: true }) : '<section class="community-feed-state community-panel">This post is not available.</section>'}
      </div>
      ${renderSidebar()}
    </div>
    ${renderStoryComposerModal()}
    ${renderStoryViewerModal()}
    ${renderEditPostModal()}
    ${renderReportModal()}
  `
}

function renderCommunityWorkspacePlaceholder({ title = '', description = '', icon = 'cube' } = {}) {
  return `
    <section class="community-workspace-placeholder">
      <span class="community-workspace-placeholder-icon">${iconSvg(icon)}</span>
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(description)}</p>
      </div>
      <span class="community-workspace-coming-soon">Foundation ready</span>
    </section>
  `
}

function renderCommunityWorkspaceContent() {
  if (state.activeTab === 'community-projects') {
    return renderCommunityWorkspacePlaceholder({
      title: 'Projects',
      description: 'Projects connected to this community will live here as the canonical project graph comes online.',
      icon: 'cube'
    })
  }
  if (state.activeTab === 'community-people') {
    return renderCommunityWorkspacePlaceholder({
      title: 'People',
      description: 'Members, roles, verified affiliations, and collaborators will live here when membership lands.',
      icon: 'user'
    })
  }
  if (state.activeTab === 'community-opportunities') {
    return renderCommunityWorkspacePlaceholder({
      title: 'Opportunities',
      description: 'Collaboration requests, open roles, calls for creators, and other actionable opportunities will collect here.',
      icon: 'search'
    })
  }
  if (state.activeTab === 'community-events') {
    return renderCommunityWorkspacePlaceholder({
      title: 'Events',
      description: 'Community events, sessions, performances, deadlines, and live activity will collect here.',
      icon: 'calendar'
    })
  }
  return `
    ${renderInlineComposer()}
    <div data-community-feed-region>${renderFeed()}</div>
  `
}

function renderCommunityDetail() {
  const community = state.community
  const focused = community ? Boolean(state.communityFocus[community.communityId]) : false
  const membershipState = community ? state.communityMembership[community.communityId] || {} : {}
  const membership = membershipState.membership || null
  const membershipStatus = membership?.status || ''
  const membershipPolicy = membershipState.policy || community?.membershipPolicy || (community?.visibility === 'public' ? 'open' : 'approval')
  const workspaceTabs = [
    ['community-feed', 'Feed'],
    ['community-projects', 'Projects'],
    ['community-people', 'People'],
    ['community-opportunities', 'Opportunities'],
    ['community-events', 'Events']
  ]
  const workspaceTab = workspaceTabs.some(([id]) => id === state.activeTab) ? state.activeTab : 'community-feed'

  return `
    <div class="community-layout is-home is-community-detail community-workspace">
      ${renderLeftNav()}
      <div class="community-main community-route-main">
        <section class="community-workspace-header">
          <div class="community-workspace-identity">
            <span class="community-workspace-avatar" aria-hidden="true">
              ${community?.iconURL
                ? `<img src="${escapeHtml(community.iconURL)}" alt="" loading="lazy" />`
                : escapeHtml((community?.name || 'M').slice(0, 1).toUpperCase())
              }
            </span>
            <div class="community-workspace-copy">
              <div class="community-workspace-kicker">
                <span>Community</span>
                ${community?.official ? '<span class="community-workspace-verified">Official</span>' : ''}
              </div>
              <div class="community-workspace-title-row">
                <h1>${community ? escapeHtml(community.name) : 'Community'}</h1>
                ${community ? `<span class="community-workspace-type">${escapeHtml(community.category || 'Community')}</span>` : ''}
              </div>
              <p>${community ? escapeHtml(community.description || 'A Melogic community.') : 'Loading community...'}</p>
              ${community ? `<div class="community-workspace-statusline">
                <span class="community-workspace-status-dot" aria-hidden="true"></span>
                <span>Workspace</span>
                <strong>${formatCount(community.memberCount)} members</strong>
                <span>${formatCount(community.postCount)} posts</span>
              </div>` : ''}
              ${community ? `<div class="community-workspace-meta">
                <span>c/${escapeHtml(community.slug)}</span>
                <span>${formatCount(community.memberCount)} members</span>
                <span>${formatCount(community.focusCount)} focused</span>
                <span>${formatCount(community.postCount)} posts</span>
                ${community.category ? `<span>${escapeHtml(community.category)}</span>` : ''}
              </div>` : ''}
            </div>
            <div class="community-workspace-actions">
              ${community ? `
                <button type="button" class="button ${focused ? 'button-muted' : 'button-accent'}" data-toggle-community-focus="${escapeHtml(community.communityId)}">${focused ? 'Focused' : 'Focus'}</button>
                ${membershipState.loading
                  ? '<button type="button" class="button button-muted" disabled>Checking...</button>'
                  : membershipStatus === 'member'
                    ? `<button type="button" class="button button-muted community-membership-button" data-community-membership-action="leave" data-community-membership-id="${escapeHtml(community.communityId)}">Member</button>`
                    : membershipStatus === 'pending'
                      ? '<button type="button" class="button button-muted community-membership-button" disabled>Request pending</button>'
                      : `<button type="button" class="button button-muted community-membership-button" data-community-membership-action="join" data-community-membership-id="${escapeHtml(community.communityId)}">${membershipPolicy === 'approval' ? 'Request to Join' : membershipPolicy === 'open' ? 'Join' : 'Verify to Join'}</button>`
                }
              ` : ''}
            </div>
          </div>

          <nav class="community-workspace-tabs" aria-label="${escapeHtml(community?.name || 'Community')} workspace">
            ${workspaceTabs.map(([id, label]) => `<button type="button" class="${workspaceTab === id ? 'is-active' : ''}" data-community-workspace-tab="${id}" aria-current="${workspaceTab === id ? 'page' : 'false'}">${label}</button>`).join('')}
          </nav>
        </section>

        ${state.communityFilters.loading
          ? '<section class="community-feed-state community-panel">Loading community...</section>'
          : state.communityFilters.error
            ? `<section class="community-feed-state community-panel"><strong>Could not load community.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>`
            : community
              ? renderCommunityWorkspaceContent()
              : '<section class="community-feed-state community-panel">This community is not available.</section>'
        }
      </div>
      ${renderSidebar()}
    </div>
    ${renderStoryComposerModal()}
    ${renderStoryViewerModal()}
    ${renderEditPostModal()}
    ${renderReportModal()}
  `
}

function renderCommunityPagePreloaderMarkup() {
  return communityPagePreloaderInitialized ? '' : renderPagePreloaderMarkup()
}

function hydrateShell() {
  if (communityShellChromeInitialized) return
  communityShellChromeInitialized = true
  const logoReadyPromise = initShellChrome().catch((error) => {
    console.warn('[community] shell init failed', { message: error?.message })
    return false
  })
  if (!communityPagePreloaderInitialized) {
    communityPagePreloaderInitialized = true
    createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise: Promise.resolve(true) })
  }
}

function renderCommunityShellOnce() {
  const existingRoot = app?.querySelector('[data-community-root]')
  if (communityShellMounted && existingRoot) return existingRoot
  if (!app) return null
  app.innerHTML = `
    ${renderCommunityPagePreloaderMarkup()}
    ${navShell({ currentPage: 'community' })}
    <main class="community-page" data-community-page>
      <div class="community-root" data-community-root></div>
    </main>
  `
  communityShellMounted = true
  hydrateShell()
  return app.querySelector('[data-community-root]')
}

function renderCommunityHomeView() {
  return `
    ${state.message ? `<p class="community-toast">${escapeHtml(state.message)}</p>` : ''}
    <div class="community-layout is-home">
      ${renderLeftNav()}
      <div class="community-main">
        <!-- melogic-mobile-stories-before-feed-controls-v1
             Visual order only: on mobile/tablet this region is visible above
             the two-way feed tabs. Desktop keeps using the right-rail Stories
             instance because .community-mobile-stories remains hidden there. -->
        <div class="community-mobile-stories">${renderStoriesRow()}</div>
        ${renderTopicBar()}
        ${renderActiveCommunityTabContent()}
      </div>
      ${renderSidebar()}
    </div>
    ${state.view.type === 'feed' && !state.detailPostId && ['for-you', 'following'].includes(state.activeTab) ? `
      <button type="button" class="community-desktop-compose-fab" data-open-community-composer aria-label="Create post" title="Create post">
        ${iconSvg('plus')}
      </button>
    ` : ''}
    ${renderStoryComposerModal()}
    ${renderStoryViewerModal()}
    ${renderEditPostModal()}
    ${renderReportModal()}
  `
}

function renderInlineComposer() {
  const user = state.currentUser
  const name = String(user?.displayName || user?.email || 'Melogic Creator').trim()
  const avatar = user?.photoURL
    ? `<img src="${escapeHtml(user.photoURL)}" alt="" loading="lazy" />`
    : `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
  return `
    <section class="community-inline-composer" aria-label="Create a post">
      <span class="community-inline-avatar">${avatar}</span>
      <button type="button" class="community-inline-prompt" data-open-community-composer>${escapeHtml(communityComposerPrompt)}</button>
      <button type="button" class="community-inline-post" data-open-community-composer>Post</button>
    </section>
  `
}

function renderCommunityViewContent() {
  let content = ''
  if (state.detailPostId) content = renderDetail()
  else if (state.view.type === 'communities') content = renderCommunitiesView()
  else if (state.view.type === 'community') content = renderCommunityDetail()
  else content = renderCommunityHomeView()
  return `${content}${renderComposerLayer()}${renderCommunityImageViewer()}`
}

function renderFeedToolbar() {
  const title = state.view.type === 'community' && state.community ? state.community.name : activeFeedTitle()
  const postDisabled = false
  const subtitle = state.view.type === 'community' && state.community
    ? `Posts in c/${state.community.slug}.`
    : state.activeTab === 'following'
    ? 'Posts from creators you follow.'
    : state.activeTab === 'community'
      ? 'Posts from this community.'
      : 'Fresh creator updates from across Melogic.'
  return `
    <section class="community-feed-toolbar" aria-label="Feed controls">
      <div>
        <p class="eyebrow">Community</p>
        <h1 data-community-feed-title>${escapeHtml(title)}</h1>
        <p data-community-feed-subtitle>${escapeHtml(subtitle)}</p>
        ${(state.activeTag || state.feedSearch) ? `<div class="community-active-filters">
          ${state.activeTag ? `<button type="button" data-clear-community-tag>#${escapeHtml(state.activeTag)} ${iconSvg('x')}</button>` : ''}
          ${state.feedSearch ? `<button type="button" data-clear-community-search>${escapeHtml(state.feedSearch)} ${iconSvg('x')}</button>` : ''}
        </div>` : ''}
      </div>
      <div class="community-feed-controls" aria-label="Search, sort, and posting actions">
        <form data-community-feed-search>
          <input type="search" name="communityFeedSearch" value="${escapeHtml(state.feedSearch)}" placeholder="Search posts, tags, creators" />
          <button type="submit" title="Search">${iconSvg('search')}</button>
        </form>
        <select data-community-feed-sort aria-label="Feed sort">
          <option value="new" ${state.feedSort === 'new' ? 'selected' : ''}>New</option>
          <option value="top-today" ${state.feedSort === 'top-today' ? 'selected' : ''}>Top Today</option>
          <option value="top-week" ${state.feedSort === 'top-week' ? 'selected' : ''}>Top Week</option>
          <option value="most-discussed" ${state.feedSort === 'most-discussed' ? 'selected' : ''}>Most Discussed</option>
        </select>
        ${postDisabled
          ? `<button type="button" class="button button-muted" disabled title="Posting is available once this community is active.">${iconSvg('plus')} <span>Post soon</span></button>`
          : `<button type="button" class="button button-accent" data-open-community-composer>${iconSvg('plus')} <span>Post</span></button>`
        }
      </div>
    </section>
  `
}

function updateFeedToolbarText() {
  const title = app?.querySelector('[data-community-feed-title]')
  const subtitle = app?.querySelector('[data-community-feed-subtitle]')
  if (title) title.textContent = activeFeedTitle()
  if (subtitle) subtitle.textContent = state.activeTab === 'following'
    ? 'Posts from creators you follow.'
    : 'Fresh creator updates from across Melogic.'
}

// melogic-community-desktop-scroll-stability-v2
function captureCommunityDesktopScrollAnchor() {
  if (window.matchMedia('(max-width: 760px)').matches) return null
  const root = app?.querySelector('[data-community-root]')
  const main = root?.querySelector('.community-main')
  if (!main) return null

  const ownsScroll = /auto|scroll/.test(window.getComputedStyle(main).overflowY)
  return {
    top: Number(ownsScroll ? main.scrollTop : window.scrollY) || 0,
    ownsScroll,
    pathname: window.location.pathname,
    viewType: state.view?.type || '',
    detailPostId: state.detailPostId || '',
    activeTab: state.activeTab || ''
  }
}

function restoreCommunityDesktopScrollAnchor(anchor) {
  if (!anchor || window.matchMedia('(max-width: 760px)').matches) return
  if (anchor.pathname !== window.location.pathname) return
  if (anchor.viewType !== (state.view?.type || '')) return
  if (anchor.detailPostId !== (state.detailPostId || '')) return
  if (anchor.activeTab !== (state.activeTab || '')) return

  const root = app?.querySelector('[data-community-root]')
  const main = root?.querySelector('.community-main')
  if (!main) return

  if (anchor.ownsScroll && /auto|scroll/.test(window.getComputedStyle(main).overflowY)) {
    main.scrollTop = anchor.top
  } else {
    window.scrollTo({ top: anchor.top, left: window.scrollX, behavior: 'auto' })
  }
}

function render() {
  if (!app) return
  if (!isMobileSpaRuntime()) desktopCommunitySurfaceKey = desktopCommunitySurfaceKeyFor()
  const desktopScrollAnchor = captureCommunityDesktopScrollAnchor()
  document.body.classList.toggle('community-modal-open', communityModalIsOpen())
  const communityRoot = renderCommunityShellOnce()
  if (!communityRoot) return
  syncCommunityMobileHeader(Boolean(state.detailPostId), app)
  communityRoot.innerHTML = renderCommunityViewContent()
  bindEvents()
  restoreCommunityDesktopScrollAnchor(desktopScrollAnchor)
  if (isMobileSpaRuntime() && state.view.type === 'communities') {
    const main = communityRoot.querySelector('.community-main')
    if (main) {
      const restore = () => {
        main.scrollTop = mobileDiscoverScrollTop
        mobileDiscoverScrollRestorePending = false
      }
      mobileDiscoverScrollRestorePending = true
      window.requestAnimationFrame(restore)
    }
  }
}

/* melogic-community-touch-media-stability-v1 */
function renderPostViewerStateOnly(){
  state.posts.forEach((post)=>{
    const viewer=state.viewerState[post.postId]||{}
    const selector=`[data-post-id="${String(post.postId||'').replaceAll('"','\\\"')}"]`
    const card=app?.querySelector(selector)
    if(!card)return
    card.querySelectorAll('[data-community-post-like]').forEach((el)=>{el.classList.toggle('is-active',Boolean(viewer.liked));el.setAttribute('aria-pressed',String(Boolean(viewer.liked)))})
    card.querySelectorAll('[data-community-post-dislike]').forEach((el)=>{el.classList.toggle('is-active',Boolean(viewer.disliked));el.setAttribute('aria-pressed',String(Boolean(viewer.disliked)))})
    card.querySelectorAll('[data-community-post-save]').forEach((el)=>{el.classList.toggle('is-active',Boolean(viewer.saved));el.setAttribute('aria-pressed',String(Boolean(viewer.saved)))})
  })
}
function renderPostMediaOnly(){
  app?.querySelectorAll('[data-community-storage-path]').forEach((node)=>{
    const path=node.getAttribute('data-community-storage-path')||''
    const url=state.attachmentMediaUrls[path]||''
    if(url && !node.getAttribute('src')) node.setAttribute('src',url)
  })
  bindCommunityImageReliability(app)
}
/*
 * melogic-mobile-native-activation-v1
 *
 * Do not install document-level touch/gesture preventDefault handlers here.
 * On touch browsers (especially iOS Safari / standalone WebKit), cancelling a
 * touch sequence at document scope can suppress the compatibility click that
 * activates native <a> and <button> controls. That makes the UI visibly react
 * to a press while navigation/action never completes.
 *
 * Gesture cancellation belongs only on the custom surface that owns the
 * gesture (for example the open image-viewer stage or camera canvas). The
 * Community image viewer already owns its touchstart/touchmove handling on its
 * stage, so normal page controls and the global mobile nav stay browser-native.
 */

async function loadViewerState() {
  if (!state.currentUser?.uid || !state.posts.length) {
    state.viewerState = {}
    return
  }
  // Counts are part of the post document, but a user's own reaction state is
  // stored in private child documents. Always refresh that state on load so
  // active reaction buttons cannot be left behind by a stale in-memory map.
  const viewerUid = state.currentUser.uid
  const requests = state.posts.map((post) => ({
    postId: post.postId,
    reactionVersion: interactionVersion(communityPostReactionVersions, post.postId),
    saveVersion: interactionVersion(communityPostSaveVersions, post.postId)
  }))
  const entries = await Promise.all(requests.map(async (request) => ({
    ...request,
    viewer: await getCommunityPostViewerState(request.postId, viewerUid)
  })))
  if (state.currentUser?.uid !== viewerUid) return
  const loadedPostIds = new Set(state.posts.map((post) => post.postId))
  const nextViewerState = { ...state.viewerState }
  entries.forEach(({ postId, reactionVersion, saveVersion, viewer }) => {
    if (!loadedPostIds.has(postId)) return
    const current = { ...(nextViewerState[postId] || {}) }
    if (interactionVersion(communityPostReactionVersions, postId) === reactionVersion) {
      current.liked = Boolean(viewer.liked)
      current.disliked = Boolean(viewer.disliked)
    }
    if (interactionVersion(communityPostSaveVersions, postId) === saveVersion) current.saved = Boolean(viewer.saved)
    nextViewerState[postId] = current
  })
  state.viewerState = nextViewerState
}

async function loadCommentViewerState() {
  const replyComments = Object.values(state.repliesByParent || {}).flat()
  const allComments = mergeCommentsById(state.comments, replyComments)
  if (!state.currentUser?.uid || !state.detailPostId || !allComments.length) {
    state.commentViewerState = {}
    return
  }
  const viewerUid = state.currentUser.uid
  const postId = state.detailPostId
  const requests = allComments.map((comment) => ({
    commentId: comment.commentId,
    version: interactionVersion(communityCommentReactionVersions, `${postId}:${comment.commentId}`)
  }))
  const entries = await Promise.all(requests.map(async (request) => ({
    ...request,
    viewer: await getCommunityCommentViewerState(postId, request.commentId, viewerUid)
  })))
  if (state.currentUser?.uid !== viewerUid || state.detailPostId !== postId) return
  const nextViewerState = { ...state.commentViewerState }
  entries.forEach(({ commentId, version, viewer }) => {
    if (interactionVersion(communityCommentReactionVersions, `${postId}:${commentId}`) !== version) return
    nextViewerState[commentId] = { liked: Boolean(viewer.liked), disliked: Boolean(viewer.disliked) }
  })
  state.commentViewerState = nextViewerState
}

async function loadAttachmentMediaUrls() {
  try {
    // melogic-community-pagination-media-stability-v1
    // Pagination appends posts to a persistent feed. Existing attachment URLs
    // are already live DOM state and must remain stable: resolving every path
    // again can change the attachment render key and make updatePostCardDom()
    // rebuild an existing attachment region, which reloads its img/video/audio.
    //
    // Resolve ONLY media paths that are not already cached for this Community
    // session, then preserve every previously resolved URL verbatim.
    const unresolvedPosts = state.posts.map((post) => ({
      ...post,
      attachments: (post.attachments || []).filter((attachment) => {
        const path = attachment.path || attachment.storagePath || attachment.snapshot?.previewAudioPath || ''
        if (!path) return false
        if (attachment.url || attachment.audioURL) return false
        return !state.attachmentMediaUrls[path]
      })
    })).filter((post) => post.attachments.length)

    if (!unresolvedPosts.length) return

    const resolved = await resolveCommunityAttachmentMediaUrls(unresolvedPosts)
    const additions = Object.fromEntries(
      Object.entries(resolved).filter(([path, url]) => path && url && !state.attachmentMediaUrls[path])
    )

    // Existing entries win deliberately. Once an image/video/audio element has
    // a URL, infinite-scroll enrichment is not allowed to replace that URL.
    state.attachmentMediaUrls = { ...additions, ...state.attachmentMediaUrls }
  } catch (error) {
    console.warn('[community] attachment media url load failed', { code: error?.code, message: error?.message })
  }
}

async function loadTopCommentPreviews() {
  const candidates = state.posts
    .filter((post) => Number(post.counts?.comments || 0) > 0)
    .filter((post) => !Object.prototype.hasOwnProperty.call(state.topCommentPreviews, post.postId))
    .filter((post) => !state.topCommentPreviewLoading[post.postId])
    .slice(0, COMMUNITY_PAGE_SIZE)
  if (!candidates.length) return
  candidates.forEach((post) => {
    state.topCommentPreviewLoading[post.postId] = true
  })
  await Promise.all(candidates.map(async (post) => {
    try {
      const comment = await getCommunityTopComment(post.postId)
      state.topCommentPreviews[post.postId] = comment ? { ...comment, postId: post.postId } : null
    } catch (error) {
      console.warn('[community] top comment preview load failed', { postId: post.postId, code: error?.code, message: error?.message })
      state.topCommentPreviews[post.postId] = null
    } finally {
      delete state.topCommentPreviewLoading[post.postId]
    }
  }))
}

async function loadFeedCommunityMetadata(requestId = state.feedRequestId) {
  const sourcePosts = state.posts.slice()
  if (!sourcePosts.length) return
  try {
    const hydrated = await hydrateCommunityPostCommunities(sourcePosts)
    if (!communityFeedRequestOwner.isCurrent(requestId)) return
    const hydratedById = new Map(hydrated.map((post) => [post.postId, post]))
    state.posts = state.posts.map((post) => hydratedById.get(post.postId) || post)
  } catch (error) {
    // Community metadata is non-critical enrichment. Keep the already-rendered
    // denormalized post snapshot if canonical lookup is temporarily unavailable.
    console.warn('[community] post community metadata enrichment failed', {
      code: error?.code,
      message: error?.message
    })
  }
}

async function loadFeedEnrichment(requestId = state.feedRequestId, { localOnly = false } = {}) {
  const startedAt = performance.now()
  await Promise.allSettled([
    loadViewerState(),
    loadAttachmentMediaUrls(),
    loadTopCommentPreviews(),
    loadFeedCommunityMetadata(requestId)
  ])
  if (!communityFeedRequestOwner.isCurrent(requestId)) return
  logCommunityPerf('feed enrichment complete', { durationMs: Math.round(performance.now() - startedAt), posts: state.posts.length })
  renderFeedRegionOnly({ reset: false })
}

async function loadStories({ renderAfter = false, hydrateIdentity = true } = {}) {
  const generation = ++storyHydrationGeneration
  state.storiesLoading = true
  state.storiesError = ''
  if (renderAfter) updateStoryRegionsOnly()
  try {
    const nextStories = await listCommunityStories({ limitCount: 30 })
    if (generation !== storyHydrationGeneration) return

    state.stories = nextStories
    pruneExpiredCommunityStories()
    scheduleCommunityStoryExpiry()

    // Story snapshots can carry stale badge metadata. On desktop surface entry,
    // resolve every visible author's canonical public identity before repainting
    // the rail so verified status is consistent across For You/Following/Discover.
    if (hydrateIdentity) {
      const authorUids = [...new Set(nextStories
        .map((story) => String(story.authorUid || '').trim())
        .filter(Boolean))]
      await Promise.allSettled(authorUids.map((uid) => ensureCommunityAuthorIdentity(uid)))
      if (generation !== storyHydrationGeneration) return
    }

    const requestedStoryId = new URLSearchParams(window.location.search).get('story') || ''
    if (requestedStoryId && state.stories.some((story) => story.storyId === requestedStoryId)) {
      state.storyViewer = { ...state.storyViewer, open: true, storyId: requestedStoryId, error: '' }
      if (state.currentUser?.uid) {
        const authToken = communityAuthScope.current()
        recordedStoryViews.add(requestedStoryId)
        recordCommunityStoryView(requestedStoryId).then((result) => {
          if (!communityAuthScope.isCurrent(authToken)) return
          if (Number.isFinite(Number(result.viewCount))) {
            state.stories = state.stories.map((story) => story.storyId === requestedStoryId ? { ...story, viewCount: Number(result.viewCount) } : story)
          }
        }).catch(() => {
          if (communityAuthScope.isCurrent(authToken)) recordedStoryViews.delete(requestedStoryId)
        })
      }
    }
  } catch (error) {
    if (generation !== storyHydrationGeneration) return
    console.warn('[community] stories load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.storiesError = error?.message || 'Stories could not be loaded.'
  } finally {
    if (generation !== storyHydrationGeneration) return
    state.storiesLoading = false
    if (renderAfter) updateStoryRegionsOnly()
  }
}

async function loadCommentViewerStateFor(comments = []) {
  if (!state.currentUser?.uid || !state.detailPostId || !comments.length) return
  const viewerUid = state.currentUser.uid
  const postId = state.detailPostId
  const requests = comments.map((comment) => ({
    commentId: comment.commentId,
    version: interactionVersion(communityCommentReactionVersions, `${postId}:${comment.commentId}`)
  }))
  const entries = await Promise.all(requests.map(async (request) => ({
    ...request,
    viewer: await getCommunityCommentViewerState(postId, request.commentId, viewerUid)
  })))
  if (state.currentUser?.uid !== viewerUid || state.detailPostId !== postId) return
  const nextViewerState = { ...state.commentViewerState }
  entries.forEach(({ commentId, version, viewer }) => {
    if (interactionVersion(communityCommentReactionVersions, `${postId}:${commentId}`) !== version) return
    nextViewerState[commentId] = { liked: Boolean(viewer.liked), disliked: Boolean(viewer.disliked) }
  })
  state.commentViewerState = nextViewerState
}

function scrollFocusedCommentIntoView() {
  const targetId = state.focusedReplyId || state.focusedCommentId
  if (!targetId || state.focusedCommentScrolled) return
  window.requestAnimationFrame(() => {
    const target = document.getElementById(`comment-${targetId}`)
    if (!target) return
    state.focusedCommentScrolled = true
    target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  })
}

async function loadFocusedComment({ renderAfter = true } = {}) {
  const targetId = state.focusedReplyId || state.focusedCommentId
  if (!state.detailPostId || !targetId) return null
  try {
    const target = await getCommunityComment(state.detailPostId, targetId)
    if (!target) return null
    const page = commentsPageFor(state.detailPostId)
    if (target.parentCommentId) {
      const parent = await getCommunityComment(state.detailPostId, target.parentCommentId)
      if (parent) page.items = mergeCommentsById(page.items || [], [parent])
      const replyPage = repliesPageFor(target.parentCommentId)
      replyPage.items = mergeCommentsById(replyPage.items || [], [target])
      replyPage.expanded = true
    } else {
      page.items = mergeCommentsById(page.items || [], [target])
    }
    syncActiveCommentState()
    await loadCommentViewerStateFor([target])
    if (renderAfter) renderCommentState()
    scrollFocusedCommentIntoView()
    return target
  } catch (error) {
    console.warn('[community] focused comment load failed', {
      postId: state.detailPostId,
      commentId: targetId,
      code: error?.code,
      message: error?.message
    })
    return null
  }
}

async function loadComments({ renderAfter = true, append = false } = {}) {
  if (!state.detailPostId) return
  const page = commentsPageFor(state.detailPostId)
  if (append && (!page.hasMore || page.loadingMore || page.loading)) return
  if (!append && (page.loading || page.loaded)) {
    syncActiveCommentState()
    if (renderAfter) renderCommentState()
    return
  }
  if (append) page.loadingMore = true
  else page.loading = true
  page.error = ''
  syncActiveCommentState()
  if (renderAfter) renderCommentState()
  try {
    const result = await listCommunityCommentsPage({
      postId: state.detailPostId,
      parentCommentId: '',
      limitCount: 10,
      cursor: append ? page.cursor : null
    })
    page.items = mergeCommentsById(page.items || [], result.comments)
    page.cursor = result.cursor || null
    page.hasMore = Boolean(result.hasMore)
    page.loaded = true
    if (!append) {
      state.repliesByCommentId = {}
    }
    syncActiveCommentState()
    await loadCommentViewerStateFor(result.comments)
  } catch (error) {
    console.warn('[community] comments load failed', { code: error?.code, message: error?.message, details: error?.details })
    page.error = error?.message || 'Comments could not be loaded.'
  } finally {
    page.loading = false
    page.loadingMore = false
    syncActiveCommentState()
    if (renderAfter) renderCommentState()
    scrollFocusedCommentIntoView()
  }
}

async function loadReplies(parentCommentId = '', { append = false, renderAfter = true } = {}) {
  if (!state.detailPostId || !parentCommentId) return
  const page = repliesPageFor(parentCommentId)
  if (append && (!page.hasMore || page.loadingMore || page.loading)) return
  if (!append && (page.loading || page.loaded)) {
    page.expanded = true
    syncActiveCommentState()
    if (renderAfter) renderCommentState()
    return
  }
  page.expanded = true
  if (append) page.loadingMore = true
  else page.loading = true
  page.error = ''
  syncActiveCommentState()
  if (renderAfter) renderCommentState()
  try {
    const result = await listCommunityCommentsPage({
      postId: state.detailPostId,
      parentCommentId,
      limitCount: 5,
      cursor: append ? page.cursor : null
    })
    page.items = append ? mergeCommentsById(page.items || [], result.comments) : result.comments
    page.cursor = result.cursor || null
    page.hasMore = Boolean(result.hasMore)
    page.loaded = true
    syncActiveCommentState()
    await loadCommentViewerStateFor(result.comments)
  } catch (error) {
    console.warn('[community] replies load failed', { code: error?.code, message: error?.message, details: error?.details })
    page.error = error?.message || 'Replies could not be loaded.'
  } finally {
    page.loading = false
    page.loadingMore = false
    syncActiveCommentState()
    if (renderAfter) renderCommentState()
  }
}

async function loadPostDetail({ postId = state.detailPostId, seedPost = null, replaceUrl = false } = {}) {
  const id = String(postId || '').trim()
  if (!id) return
  const previousPostId = state.detailPostId
  if (previousPostId !== id) window.requestAnimationFrame(() => setCommunityScroll(0, app))
  state.detailPostId = id
  state.view = { type: 'feed' }
  state.error = ''
  state.feedError = ''
  state.loading = false

  if (replaceUrl) {
    state.focusedCommentId = ''
    state.focusedReplyId = ''
    state.focusedCommentScrolled = false
    const existingHistoryState = history.state && typeof history.state === 'object' ? history.state : {}
    window.history.pushState({
      ...existingHistoryState,
      melogicMobileSpa: isMobileSpaRuntime(),
      routeId: 'community',
      pathname: communityPostRoute(id)
    }, '', communityPostRoute(id))
    if (isMobileSpaRuntime()) emitMobileSpaNavigation({ type: 'push', routeId: 'community' })
  }

  const cachedPost = seedPost || state.posts.find((post) => post.postId === id) || null
  if (cachedPost) {
    state.posts = [cachedPost]
    state.detailPostLoading = false
    if (previousPostId !== id && !state.commentsByPostId[id]?.loaded) resetActivePostComments(id)
    syncActiveCommentState(id)
    render()
    loadViewerState().then(() => renderPostViewerStateOnly()).catch(() => null)
    loadFocusedComment({ renderAfter: true })
      .then(() => loadComments({ renderAfter: true }))
      .catch(() => loadComments({ renderAfter: true }))
    if (!state.communities.length) {
      loadCommunities({ renderOnStart: false, renderAfter: false, bootstrap: true })
        .then(updateCommunityAncillaryDom)
        .catch(() => null)
    }
    return
  }

  state.posts = []
  state.detailPostLoading = true
  if (!state.commentsByPostId[id]?.loaded) resetActivePostComments(id)
  state.attachmentMediaUrls = {}
  render()
  const startedAt = performance.now()
  try {
    const post = await getCommunityPost(id)
    state.posts = post ? [post] : []
    state.detailPostLoading = false
    logCommunityPerf('detail post loaded', { durationMs: Math.round(performance.now() - startedAt), postId: id, found: Boolean(post) })
    render()
    if (post) {
      Promise.allSettled([
        loadFocusedComment({ renderAfter: true }).then(() => loadComments({ renderAfter: true })),
        loadViewerState().then(() => renderPostViewerStateOnly()),
        loadAttachmentMediaUrls().then(() => renderPostMediaOnly()),
        !state.communities.length ? loadCommunities({ renderOnStart: false, renderAfter: true, bootstrap: true }) : Promise.resolve()
      ]).then(() => {
        logCommunityPerf('detail enrichment complete', { postId: id })
      }).catch(() => null)
    }
  } catch (error) {
    console.warn('[community] detail load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'This post could not be loaded.'
    state.detailPostLoading = false
    render()
  }
}

async function loadCommunityFocusState() {
  if (!state.currentUser?.uid || !state.communities.length) {
    state.communityFocus = {}
    return
  }
  const viewerUid = state.currentUser.uid
  const requests = state.communities.map((community) => ({
    communityId: community.communityId,
    version: interactionVersion(communityFocusVersions, community.communityId)
  }))
  const focusedIds = new Set(await listFocusedCommunityIds(viewerUid, 50))
  if (state.currentUser?.uid !== viewerUid) return
  const nextFocusState = { ...state.communityFocus }
  requests.forEach(({ communityId, version }) => {
    if (interactionVersion(communityFocusVersions, communityId) !== version) return
    nextFocusState[communityId] = focusedIds.has(communityId)
  })
  state.communityFocus = nextFocusState
}

async function loadCommunities({ renderOnStart = true, renderAfter = true, bootstrap = false } = {}) {
  state.communityFilters.loading = true
  state.communityFilters.error = ''
  if (renderOnStart) render()
  try {
    // melogic-community-bootstrap-query-budget-v1
    // Home/post bootstrap only needs enough communities to populate the compact
    // navigator + discovery rail. The full directory keeps its 50-document
    // budget when users explicitly open/search Discover.
    const bootstrapLimit = 16
    const limitCount = bootstrap ? bootstrapLimit : 50
    state.communities = await listCommunities({
      category: bootstrap ? 'all' : state.communityFilters.category,
      search: bootstrap ? '' : state.communityFilters.search,
      limitCount
    })
    await loadCommunityFocusState()
  } catch (error) {
    console.warn('[community] communities load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.communityFilters.error = error?.message || 'Communities could not be loaded.'
  } finally {
    state.communityFilters.loading = false
    if (renderAfter) render()
  }
}

function mergeUniquePosts(existing = [], incoming = []) {
  const byId = new Map(existing.map((post) => [post.postId, post]))
  incoming.forEach((post) => {
    if (post.postId && !byId.has(post.postId)) byId.set(post.postId, post)
  })
  return [...byId.values()]
}

function firebaseIndexUrl(error) {
  return String(error?.message || error?.details || '').match(/https:\/\/console\.firebase\.google\.com\/\S+/)?.[0] || ''
}

function isFirestoreIndexError(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return detail.includes('failed-precondition') || detail.includes('requires an index') || detail.includes('query requires an index')
}

function withFeedTimeout(promise, timeoutMs = 15000) {
  let timeoutId = 0
  const timeout = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error('Community feed request timed out.')
      error.code = 'feed-timeout'
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId))
}

function updatePostCardDom(card, post) {
  const viewer = state.viewerState[post.postId] || {}
  const actionStates = [
    ['like', viewer.liked, post.counts.likes],
    ['dislike', viewer.disliked, post.counts.dislikes],
    ['save', viewer.saved, post.counts.saves],
    ['share', false, post.counts.shares]
  ]
  actionStates.forEach(([action, active, count]) => {
    const control = card.querySelector(`[data-community-${action}="${communityCssEscape(post.postId)}"]`)
    if (!control) return
    if (action !== 'share') control.classList.toggle('is-active', Boolean(active))
    const countNode = control.querySelector('em')
    if (countNode) countNode.textContent = formatCount(count)
  })
  const commentCount = card.querySelector('a[href$="#comments"] em')
  if (commentCount) commentCount.textContent = formatCount(post.counts.comments)

  const attachments = card.querySelector('[data-post-attachments-region]')
  const nextAttachmentKey = postAttachmentRenderKey(post)
  if (attachments && attachments.dataset.attachmentRenderKey !== nextAttachmentKey) {
    attachments.dataset.attachmentRenderKey = nextAttachmentKey
    attachments.innerHTML = renderPostAttachments(post)
    bindFeedRegionEvents(attachments)
  }

  if (!card.querySelector('.community-top-comment-preview')) {
    const previewMarkup = renderTopCommentPreview(post)
    if (previewMarkup) {
      const holder = document.createElement('div')
      holder.innerHTML = previewMarkup.trim()
      bindFeedRegionEvents(holder)
      card.querySelector('.community-post-actions')?.after(holder.firstElementChild)
    }
  }
}

function createBoundPostCard(post) {
  const holder = document.createElement('div')
  holder.innerHTML = postCard(post).trim()
  bindFeedRegionEvents(holder)
  return holder.firstElementChild
}

function renderFeedRegionOnly({ reset = false } = {}) {
  const region = app?.querySelector('[data-community-feed-region]')
  if (!region) {
    render()
    return
  }
  closePostMenusDom()
  closeCommentMenusDom()
  // A feed refresh can move a card beneath an idle pointer. Remove any prior
  // pointer-driven state so the new position is highlighted only after a real
  // pointer move.
  clearFeedPostPointerHover(region)

  const feed = region.querySelector('.community-feed')
  if (reset || !feed || !state.posts.length) {
    region.innerHTML = renderFeed()
    bindFeedRegionEvents(region)
    setupFeedPaginationObserver()
    return
  }

  const sentinel = feed.querySelector('[data-community-feed-sentinel]')
  const existingIds = new Set([...feed.querySelectorAll('.community-post-card[data-post-id]')]
    .map((card) => card.getAttribute('data-post-id') || ''))
  state.posts.forEach((post) => {
    if (existingIds.has(post.postId)) return
    const card = createBoundPostCard(post)
    if (card) feed.insertBefore(card, sentinel || null)
  })
  state.posts.forEach((post) => {
    const card = feed.querySelector(`.community-post-card[data-post-id="${communityCssEscape(post.postId)}"]`)
    if (card) updatePostCardDom(card, post)
  })

  feed.querySelector('[data-feed-more-error]')?.remove()
  if (state.feedError) {
    const holder = document.createElement('div')
    holder.innerHTML = `<div class="community-feed-state community-panel" data-feed-more-error><strong>Could not load more posts.</strong><span>${escapeHtml(state.feedError)}</span></div>`
    feed.insertBefore(holder.firstElementChild, sentinel || null)
  }
  feed.querySelector('.community-feed-more-state, .community-load-more')?.remove()
  const footerHolder = document.createElement('div')
  footerHolder.innerHTML = state.feedLoadingMore
    ? '<div class="community-feed-more-state">Loading more posts...</div>'
    : state.feedHasMore
      ? '<button type="button" class="community-load-more button button-muted" data-load-more-posts>Load more</button>'
      : '<div class="community-feed-more-state">You are caught up.</div>'
  bindFeedRegionEvents(footerHolder)
  feed.append(footerHolder.firstElementChild)
  setupFeedPaginationObserver()
}

async function loadFeedPage({ reset = false, localOnly = false } = {}) {
  const queryKey = feedQueryKey()
  if (reset && state.feedInitialLoading && state.activeFeedQueryKey === queryKey) return
  if (reset) resetFeedPagination()
  if (!reset && (!state.feedHasMore || state.feedLoadingMore || state.feedInitialLoading)) return
  const requestId = communityFeedRequestOwner.next()
  state.feedRequestId = requestId
  if (reset) state.activeFeedQueryKey = queryKey
  state.feedError = ''
  if (reset) {
    state.posts = []
    state.viewerState = {}
    state.attachmentMediaUrls = {}
    state.feedInitialLoading = true
    state.feedStillLoading = false
  } else {
    state.feedLoadingMore = true
  }
  state.loading = false
  if (localOnly) renderFeedRegionOnly()
  else render()

  let stillLoadingTimer = null
  if (reset) {
    stillLoadingTimer = window.setTimeout(() => {
      if (communityFeedRequestOwner.isCurrent(requestId) && state.feedInitialLoading) {
        state.feedStillLoading = true
        if (localOnly) renderFeedRegionOnly({ reset: true })
        else render()
      }
    }, 5000)
  }

  const startedAt = performance.now()
  try {
    let posts = []
    let cursor = null
    let hasMore = false
    if (state.activeTab === 'following') {
      if (state.currentUser?.uid) {
        const viewerUid = state.currentUser.uid
        if (reset || state.followingFeedCache.uid !== viewerUid || state.followingFeedCache.key !== queryKey) {
          const followedPosts = await withFeedTimeout(listFollowedCreatorPosts(viewerUid, {
            limitCount: COMMUNITY_FOLLOWING_CACHE_SIZE,
            selectedCommunityIds: state.selectedCommunityFilters,
            tag: state.activeTag,
            search: state.feedSearch
          }))
          state.followingFeedCache = {
            uid: viewerUid,
            key: queryKey,
            posts: filterPostsForActiveTab(followedPosts)
          }
        }
        const start = reset ? 0 : state.posts.length
        const end = start + COMMUNITY_PAGE_SIZE
        posts = state.followingFeedCache.posts.slice(start, end)
        hasMore = end < state.followingFeedCache.posts.length
      }
    } else {
      const result = await withFeedTimeout(listCommunityPosts({
        ...feedQueryOptions(),
        pageMode: true,
        cursor: reset ? null : state.feedCursor
      }))
      posts = filterPostsForActiveTab(result.posts || [])
      cursor = result.cursor || null
      hasMore = Boolean(result.hasMore)
    }
    if (!communityFeedRequestOwner.isCurrent(requestId) || queryKey !== state.activeFeedQueryKey) return

    // melogic-community-progressive-community-metadata-v1
    // Feed documents already carry denormalized communitySlug/communityName,
    // which is sufficient for first paint. Do not block visible posts behind
    // N additional communities/{id} reads. Canonical mutable community metadata
    // is reconciled after paint as progressive enrichment.
    state.posts = reset ? sortPinnedPosts(posts) : sortPinnedPosts(mergeUniquePosts(state.posts, posts))
    state.feedCursor = cursor || state.feedCursor
    state.feedHasMore = hasMore
    logCommunityPerf(reset ? 'first feed page loaded' : 'next feed page loaded', {
      durationMs: Math.round(performance.now() - startedAt),
      posts: posts.length,
      hasMore
    })
  } catch (error) {
    if (!communityFeedRequestOwner.isCurrent(requestId) || queryKey !== state.activeFeedQueryKey) return
    console.warn('[community] feed page load failed', { code: error?.code, message: error?.message, details: error?.details })
    if (isFirestoreIndexError(error)) {
      const indexUrl = firebaseIndexUrl(error)
      if (indexUrl) console.warn('[community] feed index creation URL', indexUrl)
      state.feedError = 'Feed index required. Check console for Firebase index link.'
    } else if (error?.code === 'feed-timeout') {
      state.feedError = 'The feed took too long to respond. Try again.'
    } else {
      state.feedError = error?.message || 'Community posts could not be loaded.'
    }
  } finally {
    if (stillLoadingTimer) window.clearTimeout(stillLoadingTimer)
    if (!communityFeedRequestOwner.isCurrent(requestId) || queryKey !== state.activeFeedQueryKey) return
    state.feedInitialLoading = false
    state.feedLoadingMore = false
    state.feedStillLoading = false
    if (localOnly) renderFeedRegionOnly({ reset })
    else render()
    loadFeedEnrichment(requestId, { localOnly }).catch(() => null)
  }
}

async function loadCommunity() {
  state.error = ''
  state.feedError = ''
  const isInitialHomeHydration = state.view.type === 'feed' && state.initialHomeHydration
  if (state.detailPostId) {
    await loadPostDetail({ postId: state.detailPostId })
    return
  }

  if (state.view.type === 'communities') {
    state.loading = false
    const storiesPromise = loadStories({
      renderAfter: true,
      hydrateIdentity: true
    }).catch(() => null)
    if (isMobileSpaRuntime()) {
      await loadCommunities()
    } else {
      await hydrateDesktopCommunitySharedState({ fullDirectory: true })
      render()
    }
    await storiesPromise
    return
  }

  // melogic-community-parallel-cold-start-v1
  // Stories, Home feed, and Community navigation data are independent reads.
  // Start them together; ancillary navigation data must never sit in front of
  // first-feed paint on the critical path.
  loadStories({
    renderAfter: true,
    hydrateIdentity: true
  }).catch(() => null)

  let homeCommunitiesPromise = null
  if (state.view.type === 'feed') {
    homeCommunitiesPromise = (isMobileSpaRuntime()
      ? loadCommunities({ renderOnStart: false, renderAfter: false, bootstrap: true }).then(() => {
          updateCommunityAncillaryDom()
          return true
        })
      : hydrateDesktopCommunitySharedState({ fullDirectory: false }))
      .catch(() => false)
  } else if (!state.communities.length && state.view.type !== 'community') {
    loadCommunities({ renderOnStart: false, renderAfter: false, bootstrap: true })
      .then(updateCommunityAncillaryDom)
      .catch(() => null)
  }

  if (['forms', 'live', 'saved', 'my-content', 'my-account'].includes(state.activeTab)) {
    state.loading = false
    state.feedInitialLoading = false
    state.feedLoadingMore = false
    state.feedHasMore = false
    state.posts = []
    state.viewerState = {}
    state.attachmentMediaUrls = {}
    render()
    return
  }

  if (state.view.type === 'community') {
    state.loading = false
    state.communityFilters.loading = true
    state.communityFilters.error = ''
    resetFeedPagination()
    state.posts = []
    state.viewerState = {}
    state.attachmentMediaUrls = {}
    render()
    try {
      const community = await getCommunityBySlug(state.view.slug)
      state.community = community
      state.communities = community ? [community] : state.communities
      state.communityFilters.loading = false
      render()
      if (community) {
        loadCommunityFocusState().then(render).catch(() => null)
        loadActiveCommunityMembership(community.communityId).then(render).catch(() => null)
        await loadFeedPage({ reset: true })
      }
    } catch (error) {
      console.warn('[community] community detail load failed', { code: error?.code, message: error?.message, details: error?.details })
      state.communityFilters.error = error?.message || 'Community could not be loaded.'
      state.communityFilters.loading = false
      render()
    }
    return
  }

  state.loading = false
  await loadFeedPage({ reset: true })
  if (isInitialHomeHydration) {
    // The branded loader is feed-scoped. Release it as soon as the first feed
    // request settles; do not wait for communities/focus or Stories.
    state.initialHomeHydration = false
    render()
  }
  // Keep the ancillary request alive for this boot cycle without serializing
  // first-feed paint behind it. Its completion updates only the surrounding
  // Community navigation/rail DOM.
  if (homeCommunitiesPromise) void homeCommunitiesPromise
}

function updatePostCounts(postId, patch = {}) {
  const flatPatch = {}
  if (Object.prototype.hasOwnProperty.call(patch, 'likes')) flatPatch.likeCount = patch.likes
  if (Object.prototype.hasOwnProperty.call(patch, 'dislikes')) flatPatch.dislikeCount = patch.dislikes
  if (Object.prototype.hasOwnProperty.call(patch, 'comments')) flatPatch.commentCount = patch.comments
  if (Object.prototype.hasOwnProperty.call(patch, 'saves')) flatPatch.saveCount = patch.saves
  if (Object.prototype.hasOwnProperty.call(patch, 'shares')) flatPatch.shareCount = patch.shares
  if (Object.prototype.hasOwnProperty.call(patch, 'reports')) flatPatch.reportCount = patch.reports
  state.posts = state.posts.map((post) => post.postId === postId
    ? normalizeCommunityPost({ ...post, ...flatPatch, counts: { ...post.counts, ...patch } }, postId)
    : post)
}

function postById(postId = '') {
  return state.posts.find((post) => post.postId === postId) || null
}

function setPostCount(postId = '', key = '', value = 0) {
  const nextValue = Math.max(0, Number(value) || 0)
  updatePostCounts(postId, { [key]: nextValue })
}

function adjustPostCount(postId = '', key = '', delta = 0) {
  const post = postById(postId)
  const current = Number(post?.counts?.[key] || 0)
  setPostCount(postId, key, current + delta)
}

function setPostViewerFlag(postId = '', key = '', value = false) {
  state.viewerState[postId] = { ...(state.viewerState[postId] || {}), [key]: Boolean(value) }
}

function updatePostActionDom(postId = '') {
  const post = postById(postId)
  if (!post) return
  const viewer = state.viewerState[postId] || {}
  const escapedPostId = communityCssEscape(postId)
  app?.querySelectorAll(`.community-post-card[data-post-id="${escapedPostId}"]`).forEach((card) => {
    const likeButton = card.querySelector(`[data-community-like="${escapedPostId}"]`)
    const dislikeButton = card.querySelector(`[data-community-dislike="${escapedPostId}"]`)
    const saveButton = card.querySelector(`[data-community-save="${escapedPostId}"]`)
    const shareButton = card.querySelector(`[data-community-share="${escapedPostId}"]`)
    likeButton?.classList.toggle('is-active', Boolean(viewer.liked))
    dislikeButton?.classList.toggle('is-active', Boolean(viewer.disliked))
    saveButton?.classList.toggle('is-active', Boolean(viewer.saved))
    const likeCount = likeButton?.querySelector('em')
    const dislikeCount = dislikeButton?.querySelector('em')
    const saveCount = saveButton?.querySelector('em')
    const shareCount = shareButton?.querySelector('em')
    if (likeCount) likeCount.textContent = formatCount(post.counts.likes)
    if (dislikeCount) dislikeCount.textContent = formatCount(post.counts.dislikes)
    if (saveCount) saveCount.textContent = formatCount(post.counts.saves)
    if (shareCount) shareCount.textContent = formatCount(post.counts.shares)
  })
}

function postMenuItemsMarkup(post = {}, { isOwn = false } = {}) {
  return `
    <div class="community-post-options-menu" role="menu">
      ${isOwn ? `<button type="button" role="menuitem" data-community-edit-post="${escapeHtml(post.postId)}">Edit Post</button>` : ''}
      <button type="button" role="menuitem" data-copy-post-link="${escapeHtml(post.postId)}">Copy Link</button>
      ${isOwn ? `
        <button type="button" role="menuitem" class="is-danger" data-community-delete-post="${escapeHtml(post.postId)}">Delete Post</button>
      ` : `
        <button type="button" role="menuitem" data-community-report="${escapeHtml(post.postId)}">Report Post</button>
        <button type="button" role="menuitem" disabled title="Hide/Not Interested is coming soon.">Hide / Not Interested <em>Coming soon</em></button>
      `}
    </div>
  `
}

function closePostMenusDom() {
  state.openPostMenuId = ''
  app?.querySelectorAll('[data-toggle-post-menu]').forEach((button) => button.setAttribute('aria-expanded', 'false'))
  app?.querySelectorAll('[data-post-options-root] > .community-post-options-menu').forEach((menu) => menu.remove())
}

function findCommentForPost(postId = '', commentId = '') {
  const preview = state.topCommentPreviews[postId]
  if (preview?.commentId === commentId) return preview
  return findLoadedComment(commentId)
}

function closeCommentMenusDom() {
  state.openCommentMenuKey = ''
  app?.querySelectorAll('[data-toggle-comment-menu]').forEach((button) => button.setAttribute('aria-expanded', 'false'))
  app?.querySelectorAll('.community-comment-options-menu').forEach((menu) => menu.remove())
}

async function copyCommentLink(postId = '', commentId = '') {
  const url = `${window.location.origin}${communityPostRoute(postId)}#comment-${encodeURIComponent(commentId)}`
  await navigator.clipboard?.writeText(url).catch(() => null)
  closeCommentMenusDom()
  showCommunityToast('Comment link copied.')
}

function bindCommentMenuEvents(root = app) {
  root?.querySelectorAll('[data-copy-comment-link]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      copyCommentLink(button.getAttribute('data-comment-post-id') || '', button.getAttribute('data-copy-comment-link') || '')
    })
  })
  root?.querySelectorAll('[data-community-comment-report]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      closeCommentMenusDom()
      openCommentReport(button.getAttribute('data-community-comment-report') || '', button.getAttribute('data-comment-post-id') || '')
    })
  })
  root?.querySelectorAll('[data-community-comment-delete]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      closeCommentMenusDom()
      handleCommentDelete(button.getAttribute('data-community-comment-delete') || '', button.getAttribute('data-comment-post-id') || '')
    })
  })
}

function toggleCommentMenuDom(postId = '', commentId = '') {
  const cleanPostId = String(postId || '').trim()
  const cleanCommentId = String(commentId || '').trim()
  const comment = findCommentForPost(cleanPostId, cleanCommentId)
  if (!comment) return
  const key = commentMenuKey(cleanPostId, cleanCommentId)
  const shouldOpen = state.openCommentMenuKey !== key
  closePostMenusDom()
  closeCommentMenusDom()
  if (!shouldOpen) return
  state.openCommentMenuKey = key
  const isOwn = Boolean(state.currentUser?.uid && state.currentUser.uid === comment.authorUid)
  app?.querySelectorAll(`[data-comment-options-root][data-comment-menu-key="${communityCssEscape(key)}"]`).forEach((root) => {
    root.querySelector('[data-toggle-comment-menu]')?.setAttribute('aria-expanded', 'true')
    root.insertAdjacentHTML('beforeend', commentMenuItemsMarkup(comment, { postId: cleanPostId, isOwn }))
    bindCommentMenuEvents(root)
  })
}

function bindPostMenuEvents(root = app) {
  root?.querySelectorAll('[data-copy-post-link]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      copyPostLink(button.getAttribute('data-copy-post-link') || '')
    })
  })
  root?.querySelectorAll('[data-community-report]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      openReport(button.getAttribute('data-community-report') || '')
    })
  })
  root?.querySelectorAll('[data-community-delete-post]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      handleDeleteOwnPost(button.getAttribute('data-community-delete-post') || '')
    })
  })
  root?.querySelectorAll('[data-community-edit-post]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      openEditPost(button.getAttribute('data-community-edit-post') || '')
    })
  })
}

function togglePostMenuDom(postId = '') {
  const cleanPostId = String(postId || '').trim()
  const post = postById(cleanPostId)
  if (!post) return
  const shouldOpen = state.openPostMenuId !== cleanPostId
  closeCommentMenusDom()
  closePostMenusDom()
  if (!shouldOpen) return
  state.openPostMenuId = cleanPostId
  const isOwn = Boolean(state.currentUser?.uid && state.currentUser.uid === post.authorUid)
  app?.querySelectorAll(`.community-post-card[data-post-id="${communityCssEscape(cleanPostId)}"] [data-post-options-root]`).forEach((root) => {
    root.querySelector('[data-toggle-post-menu]')?.setAttribute('aria-expanded', 'true')
    root.insertAdjacentHTML('beforeend', postMenuItemsMarkup(post, { isOwn }))
    bindPostMenuEvents(root)
  })
}

async function handleComposerSubmit(event) {
  event.preventDefault()
  const form = event.currentTarget
  const formData = new FormData(form)
  const title = String(formData.get('title') || '').trim()
  const body = String(formData.get('body') || '').trim()
  const communityId = String(formData.get('communityId') || '').trim()
  const tags = String(formData.get('tags') || '').trim()

  state.composer = { ...state.composer, title, body, communityId, tags, error: '' }
  updateComposerFromForm()
  persistComposerDraft()
  if (!body && !title && !state.composer.attachments.length && !state.composer.fileAttachments.length) {
    state.composer.error = 'Add text, a title, or an attachment before publishing.'
    render()
    return
  }
  if (state.composer.attachments.length + state.composer.fileAttachments.length > 8) {
    state.composer.error = 'Posts can include up to 8 attachments.'
    render()
    return
  }
  if (state.composer.intent === 'feedback_request' && !state.composer.intentData.feedbackQuestion?.trim()) {
    state.composer.error = 'Add a specific feedback question.'
    render()
    return
  }
  const authToken = communityAuthScope.current()
  const authorUid = authToken.uid
  if (!authorUid) return

  state.composer.submitting = true
  state.composer.uploadProgress = state.composer.fileAttachments.length ? 0 : 100
  // melogic-mobile-community-publish-transition-v6
  // Preserve the mounted mobile composer while publishing so its entrance animation cannot replay.
  if (useNativeMobileCommunityComposer()) {
    const composerLayer = app?.querySelector('[data-community-composer-layer]')
    const submitButton = composerLayer?.querySelector('.community-mobile-composer-post')
    if (submitButton) {
      submitButton.disabled = true
      submitButton.textContent = 'POSTING...'
    }
    composerLayer?.querySelector('[data-community-composer-form]')?.setAttribute('aria-busy', 'true')
  } else {
    render()
  }
  let uploadedAttachments = []
  let postCreated = false
  try {
    const community = currentComposerCommunity()
    const postId = newCommunityPostId()
    if (state.composer.fileAttachments.length) {
      uploadedAttachments = await uploadCommunityPostAttachments({
        uid: authorUid,
        postId,
        files: state.composer.fileAttachments,
        metadataById: Object.fromEntries(state.composer.fileAttachments.map((attachment) => [attachment.id, attachment.metadata || {}])),
        onProgress: (progress) => {
          if (!communityAuthScope.isCurrent(authToken)) return
          state.composer.uploadProgress = Math.round(progress)
          const status = app?.querySelector('[data-community-post-upload-progress]')
          if (status) {
            status.textContent = `Uploading attachments ${state.composer.uploadProgress}%`
            status.setAttribute('aria-valuenow', String(state.composer.uploadProgress))
          }
        }
      })
      assertCommunityAuthToken(authToken)
    }
    const result = await trackCommunityAction(`create-post:${postId}`, createCommunityPost({
      postId,
      type: 'post',
      title,
      body,
      attachments: [
        ...state.composer.attachments.map((attachment) => ({
          type: attachment.type,
          targetId: attachment.targetId || attachment.productId || attachment.projectId || attachment.storagePath || '',
          productId: attachment.productId || '',
          projectId: attachment.projectId || '',
          sourceType: attachment.sourceType || '',
          sourceId: attachment.sourceId || '',
          storagePath: attachment.storagePath || ''
        })),
        ...uploadedAttachments.map(({ id, type, name, path, storagePath, size, contentType, width, height, duration }) => ({
          id, type, name, path, storagePath, size, contentType, width, height, duration
        }))
      ],
      intent: state.composer.intent,
      intentData: state.composer.intent === 'feedback_request'
        ? {
          category: state.composer.intentData.feedbackCategory,
          question: state.composer.intentData.feedbackQuestion,
          deadlineAt: state.composer.intentData.feedbackDeadlineAt
        }
        : state.composer.intent === 'collaboration_request'
          ? {
            roleNeeded: state.composer.intentData.collaborationRoleNeeded,
            genre: state.composer.intentData.collaborationGenre,
            compensationType: state.composer.intentData.collaborationCompensationType,
            locationMode: state.composer.intentData.collaborationLocationMode,
            locationText: state.composer.intentData.collaborationLocationText,
            deadlineAt: state.composer.intentData.collaborationDeadlineAt
          }
          : {},
      mentionedUserIds: state.composer.mentionedUsers.map((user) => user.uid).filter(Boolean),
      mentionedUsernames: state.composer.mentionedUsers.map((user) => user.username).filter(Boolean),
      communityId: community?.communityId || '',
      communitySlug: community?.slug || '',
      tags: tags.split(/[,\s]+/).filter(Boolean)
    }))
    postCreated = true
    const post = normalizeCommunityPost(result.post || {}, result.postId)
    post.attachments = post.attachments.map((attachment) => {
      const uploaded = uploadedAttachments.find((item) => (item.path || item.storagePath) === (attachment.path || attachment.storagePath))
      return uploaded ? { ...attachment, url: uploaded.url || '' } : attachment
    })
    if (state.activeTab === 'following') {
      state.posts = post.communityId && state.communityFocus[post.communityId]
        ? [post, ...state.posts.filter((item) => item.postId !== post.postId)]
        : state.posts
    } else {
      state.posts = [post, ...state.posts.filter((item) => item.postId !== post.postId)]
    }
    state.viewerState[post.postId] = { liked: false, disliked: false, saved: false }
    if (state.community?.communityId === post.communityId) {
      state.community = { ...state.community, postCount: state.community.postCount + 1 }
    }
    clearComposerFileAttachments()
    clearComposerDraft()
    state.composer = defaultComposerState({ communityId: state.view.type === 'community' ? state.community?.communityId || '' : '' })
    // The success path closes the composer without updateCommunityComposerLayer().
    // Explicitly release the mobile html/body scroll lock before rebuilding the feed.
    releaseCommunityMobileOverlayLock()
    state.message = 'Post published.'
    render()
    window.setTimeout(() => {
      state.message = ''
      render()
    }, 3000)
  } catch (error) {
    if (!postCreated && uploadedAttachments.length) await deleteCommunityPostAttachments(uploadedAttachments).catch(() => null)
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] create post failed', { code: error?.code, message: error?.message, details: error?.details })
    state.composer.submitting = false
    state.composer.uploadProgress = 0
    state.composer.error = error?.message || 'Could not publish this post.'
    render()
  }
}

async function handleLike(postId) {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `reaction:${postId}`
  if (communityPendingActions.has(actionId)) return
  const post = postById(postId)
  const previousLiked = Boolean(state.viewerState[postId]?.liked)
  const previousDisliked = Boolean(state.viewerState[postId]?.disliked)
  const previousLikes = Number(post?.counts?.likes || 0)
  const previousDislikes = Number(post?.counts?.dislikes || 0)
  const nextLiked = !previousLiked
  markInteractionMutation(communityPostReactionVersions, postId)
  setPostViewerFlag(postId, 'liked', nextLiked)
  if (nextLiked) setPostViewerFlag(postId, 'disliked', false)
  setPostCount(postId, 'likes', previousLikes + (nextLiked ? 1 : -1))
  if (nextLiked && previousDisliked) setPostCount(postId, 'dislikes', previousDislikes - 1)
  updatePostActionDom(postId)
  trackCommunityAction(actionId, toggleCommunityPostLike(postId, nextLiked))
    .then((result) => {
      setPostViewerFlag(postId, 'liked', Boolean(result.liked ?? result.active))
      setPostViewerFlag(postId, 'disliked', Boolean(result.disliked))
      if (Number.isFinite(Number(result.likesCount))) setPostCount(postId, 'likes', Number(result.likesCount))
      if (Number.isFinite(Number(result.dislikesCount))) setPostCount(postId, 'dislikes', Number(result.dislikesCount))
      updatePostActionDom(postId)
    })
    .catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] like failed', { code: error?.code, message: error?.message, details: error?.details })
      setPostViewerFlag(postId, 'liked', previousLiked)
      setPostViewerFlag(postId, 'disliked', previousDisliked)
      setPostCount(postId, 'likes', previousLikes)
      setPostCount(postId, 'dislikes', previousDislikes)
      updatePostActionDom(postId)
      showCommunityToast('Could not save like. Please try again.')
    })
}

async function handleDislike(postId) {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `reaction:${postId}`
  if (communityPendingActions.has(actionId)) return
  const post = postById(postId)
  const previousLiked = Boolean(state.viewerState[postId]?.liked)
  const previousDisliked = Boolean(state.viewerState[postId]?.disliked)
  const previousLikes = Number(post?.counts?.likes || 0)
  const previousDislikes = Number(post?.counts?.dislikes || 0)
  const nextDisliked = !previousDisliked
  markInteractionMutation(communityPostReactionVersions, postId)
  setPostViewerFlag(postId, 'disliked', nextDisliked)
  if (nextDisliked) setPostViewerFlag(postId, 'liked', false)
  setPostCount(postId, 'dislikes', previousDislikes + (nextDisliked ? 1 : -1))
  if (nextDisliked && previousLiked) setPostCount(postId, 'likes', previousLikes - 1)
  updatePostActionDom(postId)
  trackCommunityAction(actionId, toggleCommunityPostDislike(postId, nextDisliked))
    .then((result) => {
      setPostViewerFlag(postId, 'liked', Boolean(result.liked))
      setPostViewerFlag(postId, 'disliked', Boolean(result.disliked ?? result.active))
      if (Number.isFinite(Number(result.likesCount))) setPostCount(postId, 'likes', Number(result.likesCount))
      if (Number.isFinite(Number(result.dislikesCount))) setPostCount(postId, 'dislikes', Number(result.dislikesCount))
      updatePostActionDom(postId)
    })
    .catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] dislike failed', { code: error?.code, message: error?.message, details: error?.details })
      setPostViewerFlag(postId, 'liked', previousLiked)
      setPostViewerFlag(postId, 'disliked', previousDisliked)
      setPostCount(postId, 'likes', previousLikes)
      setPostCount(postId, 'dislikes', previousDislikes)
      updatePostActionDom(postId)
      showCommunityToast('Could not save dislike. Please try again.')
    })
}

async function handleSave(postId) {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `save:${postId}`
  if (communityPendingActions.has(actionId)) return
  const post = postById(postId)
  const previousSaved = Boolean(state.viewerState[postId]?.saved)
  const previousSaves = Number(post?.counts?.saves || 0)
  const nextSaved = !previousSaved
  markInteractionMutation(communityPostSaveVersions, postId)
  setPostViewerFlag(postId, 'saved', nextSaved)
  setPostCount(postId, 'saves', previousSaves + (nextSaved ? 1 : -1))
  updatePostActionDom(postId)
  trackCommunityAction(actionId, toggleCommunityPostSave(postId, nextSaved))
    .then((result) => {
      setPostViewerFlag(postId, 'saved', Boolean(result.active))
      if (Number.isFinite(Number(result.savesCount))) setPostCount(postId, 'saves', Number(result.savesCount))
      updatePostActionDom(postId)
    })
    .catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] save failed', { code: error?.code, message: error?.message, details: error?.details })
      setPostViewerFlag(postId, 'saved', previousSaved)
      setPostCount(postId, 'saves', previousSaves)
      updatePostActionDom(postId)
      showCommunityToast('Could not save this post. Please try again.')
    })
}

async function handleShare(postId) {
  const url = `${window.location.origin}${communityPostRoute(postId)}`
  const post = postById(postId)
  const previousShares = Number(post?.counts?.shares || 0)
  await (navigator.share
    ? navigator.share({ title: post?.title || 'Melogic Community post', url }).catch(() => navigator.clipboard?.writeText(url))
    : navigator.clipboard?.writeText(url)
  ).catch(() => null)
  showCommunityToast('Post link copied.')
  if (state.currentUser) {
    adjustPostCount(postId, 'shares', 1)
    updatePostActionDom(postId)
    trackCommunityAction(`share:${postId}`, recordCommunityPostShare(postId)).then((result) => {
      if (Number.isFinite(Number(result.sharesCount))) {
        setPostCount(postId, 'shares', Number(result.sharesCount))
        updatePostActionDom(postId)
      }
    }).catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] share count failed', { code: error?.code, message: error?.message })
      setPostCount(postId, 'shares', previousShares)
      updatePostActionDom(postId)
      showCommunityToast('Shared link copied, but the share count could not be saved.')
    })
  }
}

async function copyPostLink(postId) {
  const url = `${window.location.origin}${communityPostRoute(postId)}`
  await navigator.clipboard?.writeText(url).catch(() => null)
  closePostMenusDom()
  showCommunityToast('Post link copied.')
}

function openEditPost(postId = '') {
  const post = postById(postId)
  if (!post || !state.currentUser?.uid || post.authorUid !== state.currentUser.uid) return
  closePostMenusDom()
  state.editPost = {
    open: true,
    postId: post.postId,
    title: post.title || '',
    body: post.body || '',
    tags: Array.isArray(post.tags) ? post.tags.join(', ') : '',
    visibility: post.visibility || 'public',
    submitting: false,
    error: ''
  }
  render()
}

function closeEditPostModal() {
  state.editPost = {
    open: false,
    postId: '',
    title: '',
    body: '',
    tags: '',
    visibility: 'public',
    submitting: false,
    error: ''
  }
  render()
}

function parseEditTags(value = '') {
  return Array.from(new Set(String(value || '')
    .split(/[,\s]+/)
    .map((tag) => normalizeTagKey(tag))
    .filter(Boolean)))
    .slice(0, 5)
}

async function handleEditPostSubmit(event) {
  event.preventDefault()
  if (!state.currentUser) return
  const form = event.currentTarget
  const formData = new FormData(form)
  const postId = state.editPost.postId
  const post = postById(postId)
  if (!post) return
  const title = String(formData.get('title') || '').trim()
  const body = String(formData.get('body') || '').trim()
  const tags = parseEditTags(String(formData.get('tags') || ''))
  const visibility = String(formData.get('visibility') || 'public').trim()
  if (!title && !body && !(Array.isArray(post.attachments) && post.attachments.length)) {
    state.editPost = { ...state.editPost, title, body, tags: tags.join(', '), visibility, error: 'Add text, a title, or keep an attachment before saving.' }
    render()
    return
  }

  const actionId = `edit-post:${postId}`
  if (communityPendingActions.has(actionId)) return
  const previousPost = post
  const previousScrollY = window.scrollY || 0
  state.editPost = { ...state.editPost, title, body, tags: tags.join(', '), visibility, submitting: true, error: '' }
  render()

  const optimisticPost = normalizeCommunityPost({
    ...previousPost,
    title,
    titleLower: title.toLowerCase(),
    body,
    tags,
    tagKeys: tags,
    visibility: visibility === 'public' ? 'public' : previousPost.visibility,
    edited: true,
    editedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }, postId)

  state.posts = state.posts.map((item) => item.postId === postId ? optimisticPost : item)
  state.editPost = { open: false, postId: '', title: '', body: '', tags: '', visibility: 'public', submitting: false, error: '' }
  render()
  window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }))

  trackCommunityAction(actionId, updateCommunityPost({ postId, title, body, tags, visibility }))
    .then((result) => {
      if (result?.post) {
        state.posts = state.posts.map((item) => item.postId === postId
          ? normalizeCommunityPost({ ...item, ...result.post }, postId)
          : item)
        updatePostActionDom(postId)
      }
      showCommunityToast('Post updated.')
    })
    .catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] edit post failed', { code: error?.code, message: error?.message, details: error?.details })
      state.posts = state.posts.map((item) => item.postId === postId ? previousPost : item)
      render()
      window.requestAnimationFrame(() => window.scrollTo({ top: previousScrollY }))
      showCommunityToast('Could not update this post. Please try again.')
    })
}

function handleFeedSearch(event) {
  event.preventDefault()
  const form = event.currentTarget
  state.feedSearch = String(new FormData(form).get('communityFeedSearch') || '').trim().slice(0, 80)
  if (state.view.type !== 'feed') {
    const params = new URLSearchParams()
    if (state.feedSearch) params.set('search', state.feedSearch)
    window.location.assign(`${ROUTES.community}${params.toString() ? `?${params}` : ''}`)
    return
  }
  updateFeedUrlParams()
  loadCommunity()
}

function selectTagFilter(tag = '') {
  state.activeTag = normalizeTagKey(tag)
  updateFeedUrlParams()
  loadCommunity()
}

async function handleDeleteOwnPost(postId = '') {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `delete:${postId}`
  if (communityPendingActions.has(actionId)) return
  if (!window.confirm('Hide this post from the community?')) return
  const previousPosts = state.posts
  closePostMenusDom()
  state.posts = state.posts.filter((post) => post.postId !== postId)
  app?.querySelectorAll(`.community-post-card[data-post-id="${communityCssEscape(postId)}"]`).forEach((card) => card.remove())
  showCommunityToast('Post removed.')
  trackCommunityAction(actionId, deleteOwnCommunityPost({ postId, reason: 'Author removed post from community.' }))
    .catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] delete post failed', { code: error?.code, message: error?.message, details: error?.details })
      state.posts = previousPosts
      showCommunityToast('Could not delete post. Restored.')
      render()
    })
}

function updateCommentCount(commentId, patch = {}) {
  state.comments = state.comments.map((comment) => comment.commentId === commentId ? normalizeCommunityComment({ ...comment, ...patch }, commentId) : comment)
  if (state.detailPostId) {
    const page = commentsPageFor(state.detailPostId)
    page.items = (page.items || []).map((comment) => comment.commentId === commentId ? normalizeCommunityComment({ ...comment, ...patch }, commentId) : comment)
  }
  state.repliesByParent = Object.fromEntries(Object.entries(state.repliesByParent || {}).map(([parentId, replies]) => [
    parentId,
    (replies || []).map((comment) => comment.commentId === commentId ? normalizeCommunityComment({ ...comment, ...patch }, commentId) : comment)
  ]))
  Object.values(state.repliesByCommentId || {}).forEach((page) => {
    page.items = (page.items || []).map((comment) => comment.commentId === commentId ? normalizeCommunityComment({ ...comment, ...patch }, commentId) : comment)
  })
  syncActiveCommentState()
}

function updateCommentActionDom(commentId = '') {
  const comment = findLoadedComment(commentId)
  if (!comment) return
  const viewer = state.commentViewerState[commentId] || {}
  const escapedCommentId = communityCssEscape(commentId)
  app?.querySelectorAll(`.community-comment-card[data-comment-id="${escapedCommentId}"]`).forEach((card) => {
    const likeButton = card.querySelector(`[data-community-comment-like="${escapedCommentId}"]`)
    const dislikeButton = card.querySelector(`[data-community-comment-dislike="${escapedCommentId}"]`)
    likeButton?.classList.toggle('is-active', Boolean(viewer.liked))
    dislikeButton?.classList.toggle('is-active', Boolean(viewer.disliked))
    const likeCount = likeButton?.querySelector('span')
    const dislikeCount = dislikeButton?.querySelector('span')
    if (likeCount) likeCount.textContent = formatCount(comment.likeCount)
    if (dislikeCount) dislikeCount.textContent = formatCount(comment.dislikeCount)
  })
}

function updateDetailCommentCount(delta = 0, absoluteValue = null) {
  const post = state.posts[0]
  if (!post) return
  const current = Number(post.counts?.comments || 0)
  const next = absoluteValue === null ? Math.max(0, current + delta) : Math.max(0, Number(absoluteValue || 0))
  updatePostCounts(post.postId, { comments: next })
}

function addCommentAttachmentFiles(parentCommentId = '', files = []) {
  const key = commentComposerKey(parentCommentId)
  const existing = commentAttachmentDrafts(parentCommentId)
  const next = [...existing]
  state.commentAttachmentErrors[key] = ''
  for (const file of Array.from(files || [])) {
    if (next.length >= 3) {
      state.commentAttachmentErrors[key] = 'Comments can include up to 3 attachments.'
      break
    }
    try {
      const { type } = validateCommunityCommentAttachment(file)
      next.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type,
        file,
        previewURL: type === 'image' ? URL.createObjectURL(file) : ''
      })
    } catch (error) {
      state.commentAttachmentErrors[key] = error?.message || 'This attachment is not supported.'
    }
  }
  state.commentAttachmentDrafts[key] = next
  renderCommentState()
}

function removeCommentAttachment(parentCommentId = '', attachmentId = '') {
  const key = commentComposerKey(parentCommentId)
  const existing = commentAttachmentDrafts(parentCommentId)
  const removed = existing.find((item) => item.id === attachmentId)
  if (removed?.previewURL) URL.revokeObjectURL(removed.previewURL)
  state.commentAttachmentDrafts[key] = existing.filter((item) => item.id !== attachmentId)
  state.commentAttachmentErrors[key] = ''
  renderCommentState()
}

function clearCommentAttachmentDrafts(parentCommentId = '') {
  const key = commentComposerKey(parentCommentId)
  commentAttachmentDrafts(parentCommentId).forEach((item) => {
    if (item.previewURL) URL.revokeObjectURL(item.previewURL)
  })
  delete state.commentAttachmentDrafts[key]
  delete state.commentAttachmentErrors[key]
  delete state.commentAttachmentProgress[key]
}

async function uploadCommentDraftAttachments(parentCommentId = '', commentId = '') {
  const key = commentComposerKey(parentCommentId)
  const drafts = commentAttachmentDrafts(parentCommentId)
  if (!drafts.length) return []
  return uploadCommunityCommentAttachments({
    uid: state.currentUser?.uid || '',
    postId: state.detailPostId,
    commentId,
    files: drafts.map((item) => item.file),
    onProgress: (progress) => {
      state.commentAttachmentProgress[key] = progress
      const status = app?.querySelector(`[data-community-${parentCommentId ? 'reply' : 'comment'}-form${parentCommentId ? `="${communityCssEscape(parentCommentId)}"` : ''}] .community-comment-upload-state`)
      if (status) status.textContent = `Uploading attachments ${Math.round(progress)}%`
    }
  })
}

async function handleCommentSubmit(event) {
  event.preventDefault()
  if (state.commentSubmitting) return
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const formData = new FormData(event.currentTarget)
  const body = String(formData.get('body') || '').trim()
  const drafts = commentAttachmentDrafts()
  state.commentDraft = body
  state.commentActionError = ''
  if (!body && !drafts.length) {
    state.commentActionError = 'Add text or an attachment to this comment.'
    renderCommentState()
    return
  }
  state.commentSubmitting = true
  renderCommentState()
  let attachments = []
  try {
    const commentId = newCommunityCommentId(state.detailPostId)
    attachments = await uploadCommentDraftAttachments('', commentId)
    const actionId = `comment:${state.detailPostId}:${commentId}`
    const result = await trackCommunityAction(actionId, createCommunityComment({
      postId: state.detailPostId,
      commentId,
      body,
      attachments: attachments.map(({ type, name, path, size, contentType }) => ({ type, name, path, size, contentType }))
    }))
    const comment = normalizeCommunityComment({ ...(result.comment || {}), attachments }, result.commentId)
    const page = commentsPageFor(state.detailPostId)
    page.items = mergeCommentsById((page.items || []).filter((item) => item.commentId !== comment.commentId), [comment])
    page.loaded = true
    syncActiveCommentState()
    state.commentViewerState[comment.commentId] = { liked: false, disliked: false }
    state.commentDraft = ''
    state.commentSubmitting = false
    clearCommentAttachmentDrafts()
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Number(result.commentCount))
    else updateDetailCommentCount(1)
    renderCommentState()
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] create comment failed', { code: error?.code, message: error?.message, details: error?.details })
    await deleteCommunityCommentAttachments(attachments)
    state.commentSubmitting = false
    state.commentAttachmentProgress.root = 0
    state.commentActionError = error?.message || 'Could not post this comment.'
    renderCommentState()
  }
}

async function handleReplySubmit(event, parentCommentId = '') {
  event.preventDefault()
  if (state.replySubmittingFor === parentCommentId) return
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const formData = new FormData(event.currentTarget)
  const body = String(formData.get('body') || '').trim()
  const drafts = commentAttachmentDrafts(parentCommentId)
  state.replyDrafts = { ...state.replyDrafts, [parentCommentId]: body }
  state.replyErrors = { ...state.replyErrors, [parentCommentId]: '' }
  state.commentActionError = ''
  if (!body && !drafts.length) {
    state.replyErrors = { ...state.replyErrors, [parentCommentId]: 'Add text or an attachment to this reply.' }
    renderCommentState()
    return
  }
  state.replySubmittingFor = parentCommentId
  renderCommentState()
  let attachments = []
  try {
    const commentId = newCommunityCommentId(state.detailPostId)
    attachments = await uploadCommentDraftAttachments(parentCommentId, commentId)
    const actionId = `comment:${state.detailPostId}:${parentCommentId}:${commentId}`
    const result = await trackCommunityAction(actionId, createCommunityComment({
      postId: state.detailPostId,
      commentId,
      parentCommentId,
      body,
      attachments: attachments.map(({ type, name, path, size, contentType }) => ({ type, name, path, size, contentType }))
    }))
    const comment = normalizeCommunityComment({ ...(result.comment || {}), attachments }, result.commentId)
    const replyPage = repliesPageFor(parentCommentId)
    replyPage.expanded = true
    replyPage.loaded = true
    replyPage.items = mergeCommentsById(replyPage.items || [], [comment])
    syncActiveCommentState()
    state.commentViewerState[comment.commentId] = { liked: false, disliked: false }
    state.replyDrafts = { ...state.replyDrafts, [parentCommentId]: '' }
    state.replyErrors = { ...state.replyErrors, [parentCommentId]: '' }
    state.replyComposerFor = ''
    state.replySubmittingFor = ''
    clearCommentAttachmentDrafts(parentCommentId)
    updateCommentCount(parentCommentId, { replyCount: (findLoadedComment(parentCommentId)?.replyCount || 0) + 1 })
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Number(result.commentCount))
    else updateDetailCommentCount(1)
    renderCommentState()
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] create reply failed', { code: error?.code, message: error?.message, details: error?.details })
    await deleteCommunityCommentAttachments(attachments)
    state.replySubmittingFor = ''
    state.commentAttachmentProgress[commentComposerKey(parentCommentId)] = 0
    state.replyErrors = { ...state.replyErrors, [parentCommentId]: error?.message || 'Could not post this reply.' }
    renderCommentState()
  }
}

async function handleCommentLike(commentId = '') {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `comment-reaction:${state.detailPostId}:${commentId}`
  if (communityPendingActions.has(actionId)) return
  const comment = findLoadedComment(commentId)
  const previousLiked = Boolean(state.commentViewerState[commentId]?.liked)
  const previousDisliked = Boolean(state.commentViewerState[commentId]?.disliked)
  const previousLikeCount = Number(comment?.likeCount || 0)
  const previousDislikeCount = Number(comment?.dislikeCount || 0)
  const nextLiked = !previousLiked
  markInteractionMutation(communityCommentReactionVersions, `${state.detailPostId}:${commentId}`)
  state.commentViewerState[commentId] = { liked: nextLiked, disliked: nextLiked ? false : previousDisliked }
  updateCommentCount(commentId, { likeCount: Math.max(0, previousLikeCount + (nextLiked ? 1 : -1)) })
  if (nextLiked && previousDisliked) updateCommentCount(commentId, { dislikeCount: Math.max(0, previousDislikeCount - 1) })
  updateCommentActionDom(commentId)
  trackCommunityAction(actionId, toggleCommunityCommentLike({ postId: state.detailPostId, commentId, active: nextLiked })).then((result) => {
    state.commentViewerState[commentId] = { liked: Boolean(result.liked ?? result.active), disliked: Boolean(result.disliked) }
    if (Number.isFinite(Number(result.likeCount))) updateCommentCount(commentId, { likeCount: Number(result.likeCount) })
    if (Number.isFinite(Number(result.dislikeCount))) updateCommentCount(commentId, { dislikeCount: Number(result.dislikeCount) })
    updateCommentActionDom(commentId)
  }).catch((error) => {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] comment like failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentViewerState[commentId] = { liked: previousLiked, disliked: previousDisliked }
    updateCommentCount(commentId, { likeCount: previousLikeCount })
    updateCommentCount(commentId, { dislikeCount: previousDislikeCount })
    state.commentActionError = 'Could not update this comment.'
    updateCommentActionDom(commentId)
    renderCommentState()
  })
}

async function handleCommentDislike(commentId = '') {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `comment-reaction:${state.detailPostId}:${commentId}`
  if (communityPendingActions.has(actionId)) return
  const comment = findLoadedComment(commentId)
  const previousLiked = Boolean(state.commentViewerState[commentId]?.liked)
  const previousDisliked = Boolean(state.commentViewerState[commentId]?.disliked)
  const previousLikeCount = Number(comment?.likeCount || 0)
  const previousDislikeCount = Number(comment?.dislikeCount || 0)
  const nextDisliked = !previousDisliked
  markInteractionMutation(communityCommentReactionVersions, `${state.detailPostId}:${commentId}`)
  state.commentViewerState[commentId] = { liked: nextDisliked ? false : previousLiked, disliked: nextDisliked }
  updateCommentCount(commentId, { dislikeCount: Math.max(0, previousDislikeCount + (nextDisliked ? 1 : -1)) })
  if (nextDisliked && previousLiked) updateCommentCount(commentId, { likeCount: Math.max(0, previousLikeCount - 1) })
  updateCommentActionDom(commentId)
  trackCommunityAction(actionId, toggleCommunityCommentDislike({ postId: state.detailPostId, commentId, active: nextDisliked })).then((result) => {
    state.commentViewerState[commentId] = { liked: Boolean(result.liked), disliked: Boolean(result.disliked ?? result.active) }
    if (Number.isFinite(Number(result.likeCount))) updateCommentCount(commentId, { likeCount: Number(result.likeCount) })
    if (Number.isFinite(Number(result.dislikeCount))) updateCommentCount(commentId, { dislikeCount: Number(result.dislikeCount) })
    updateCommentActionDom(commentId)
  }).catch((error) => {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] comment dislike failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentViewerState[commentId] = { liked: previousLiked, disliked: previousDisliked }
    updateCommentCount(commentId, { likeCount: previousLikeCount })
    updateCommentCount(commentId, { dislikeCount: previousDislikeCount })
    state.commentActionError = 'Could not update this comment.'
    updateCommentActionDom(commentId)
    renderCommentState()
  })
}

function updateTopCommentPreviewDom(postId = '') {
  const escapedPostId = communityCssEscape(postId)
  app?.querySelectorAll(`.community-post-card[data-post-id="${escapedPostId}"]:not(.is-detail)`).forEach((card) => {
    card.querySelector('.community-top-comment-preview')?.remove()
    const post = postById(postId)
    const markup = post ? renderTopCommentPreview(post) : ''
    if (markup) {
      card.insertAdjacentHTML('beforeend', markup)
      bindCommentOptionTriggers(card)
    }
  })
}

async function handleFeedPreviewCommentDelete(commentId = '', postId = '') {
  const actionId = `comment-delete:${postId}:${commentId}`
  if (communityPendingActions.has(actionId)) return
  const previousPreview = state.topCommentPreviews[postId]
  const post = postById(postId)
  const previousCount = Number(post?.counts?.comments || 0)
  state.topCommentPreviews[postId] = null
  setPostCount(postId, 'comments', Math.max(0, previousCount - 1))
  updatePostActionDom(postId)
  updateTopCommentPreviewDom(postId)
  try {
    const result = await trackCommunityAction(actionId, deleteCommunityComment({ postId, commentId }))
    const nextCount = Number.isFinite(Number(result.commentCount)) ? Number(result.commentCount) : Math.max(0, previousCount - 1)
    setPostCount(postId, 'comments', nextCount)
    if (nextCount > 0) {
      const nextPreview = await getCommunityTopComment(postId)
      state.topCommentPreviews[postId] = nextPreview ? { ...nextPreview, postId } : null
    }
    updatePostActionDom(postId)
    updateTopCommentPreviewDom(postId)
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] feed preview comment delete failed', { postId, commentId, code: error?.code, message: error?.message })
    state.topCommentPreviews[postId] = previousPreview
    setPostCount(postId, 'comments', previousCount)
    updatePostActionDom(postId)
    updateTopCommentPreviewDom(postId)
    showCommunityToast('Could not delete this comment.')
  }
}

async function handleCommentDelete(commentId = '', postId = state.detailPostId) {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const cleanPostId = String(postId || state.detailPostId || '').trim()
  if (!cleanPostId) return
  if (cleanPostId !== state.detailPostId) {
    await handleFeedPreviewCommentDelete(commentId, cleanPostId)
    return
  }
  const actionId = `comment-delete:${cleanPostId}:${commentId}`
  if (communityPendingActions.has(actionId)) return
  const previousComments = state.comments
  const previousCommentsByPostId = Object.fromEntries(Object.entries(state.commentsByPostId || {}).map(([postId, page]) => [
    postId,
    { ...page, items: [...(page.items || [])] }
  ]))
  const previousReplies = state.repliesByParent
  const previousRepliesByCommentId = Object.fromEntries(Object.entries(state.repliesByCommentId || {}).map(([replyId, page]) => [
    replyId,
    { ...page, items: [...(page.items || [])] }
  ]))
  const previousPosts = state.posts
  const comment = findLoadedComment(commentId)
  state.comments = state.comments.filter((item) => item.commentId !== commentId && item.parentCommentId !== commentId)
  if (state.detailPostId) {
    const page = commentsPageFor(state.detailPostId)
    page.items = (page.items || []).filter((item) => item.commentId !== commentId && item.parentCommentId !== commentId)
  }
  state.repliesByParent = Object.fromEntries(Object.entries(state.repliesByParent || {}).map(([parentId, replies]) => [
    parentId,
    (replies || []).filter((item) => item.commentId !== commentId && item.parentCommentId !== commentId)
  ]))
  Object.values(state.repliesByCommentId || {}).forEach((page) => {
    page.items = (page.items || []).filter((item) => item.commentId !== commentId && item.parentCommentId !== commentId)
  })
  if (comment?.parentCommentId) {
    updateCommentCount(comment.parentCommentId, { replyCount: Math.max(0, (findLoadedComment(comment.parentCommentId)?.replyCount || 0) - 1) })
  }
  updateDetailCommentCount(-1)
  renderCommentState()
  trackCommunityAction(actionId, deleteCommunityComment({ postId: cleanPostId, commentId })).then((result) => {
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Number(result.commentCount))
    renderCommentState()
  }).catch((error) => {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] comment delete failed', { code: error?.code, message: error?.message, details: error?.details })
    state.comments = previousComments
    state.commentsByPostId = previousCommentsByPostId
    state.repliesByParent = previousReplies
    state.repliesByCommentId = previousRepliesByCommentId
    state.posts = previousPosts
    state.commentActionError = 'Could not delete this comment.'
    renderCommentState()
  })
}

async function loadActiveCommunityMembership(communityId = '') {
  const id = String(communityId || '').trim()
  if (!id || !state.currentUser?.uid) return
  const authToken = communityAuthScope.current()
  try {
    const result = await getCommunityMembership(id)
    if (!communityAuthScope.isCurrent(authToken)) return
    state.communityMembership[id] = {
      loading: false,
      policy: result?.policy || 'open',
      membership: result?.membership || null,
      error: ''
    }
  } catch (error) {
    if (!communityAuthScope.isCurrent(authToken)) return
    console.warn('[community] membership load failed', { code: error?.code, message: error?.message })
    state.communityMembership[id] = { loading: false, policy: 'open', membership: null, error: error?.message || 'Membership unavailable.' }
  }
}

async function handleCommunityMembership(communityId = '', action = 'join') {
  const id = String(communityId || '').trim()
  if (!id) return
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `membership:${action}:${id}`
  if (communityPendingActions.has(actionId)) return
  const previous = state.communityMembership[id] || null
  state.communityMembership[id] = { ...(previous || {}), loading: true, error: '' }
  render()
  try {
    const result = await trackCommunityAction(actionId, action === 'leave' ? leaveCommunity(id) : joinCommunity(id))
    await loadActiveCommunityMembership(id)
    if (result?.status === 'pending') showCommunityToast('Membership request submitted.')
    else if (action === 'leave') showCommunityToast('You left this community.')
    else showCommunityToast('You joined this community.')
    render()
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] membership action failed', { code: error?.code, message: error?.message })
    state.communityMembership[id] = { ...(previous || {}), loading: false, error: error?.message || 'Membership could not be updated.' }
    showCommunityToast(error?.message || 'Membership could not be updated.')
    render()
  }
}

async function handleToggleFocus(communityId) {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `focus:${communityId}`
  if (communityPendingActions.has(actionId)) return
  const previousFocused = Boolean(state.communityFocus[communityId])
  const previousCommunities = state.communities
  const previousCommunity = state.community
  const nextFocused = !previousFocused
  markInteractionMutation(communityFocusVersions, communityId)
  const delta = nextFocused ? 1 : -1
  state.communityFocus[communityId] = nextFocused
  state.communities = state.communities.map((community) => community.communityId === communityId
    ? { ...community, focusCount: Math.max(0, Number(community.focusCount || 0) + delta) }
    : community)
  if (state.community?.communityId === communityId) {
    state.community = { ...state.community, focusCount: Math.max(0, Number(state.community.focusCount || 0) + delta) }
  }
  if (isMobileSpaRuntime()) render()
  else reconcileCommunitySharedRegions()
  trackCommunityAction(actionId, toggleCommunityFocus(communityId, nextFocused))
    .then((result) => {
      state.communityFocus[communityId] = Boolean(result.focused)
      state.communities = state.communities.map((community) => community.communityId === communityId ? { ...community, focusCount: Number(result.focusCount ?? community.focusCount) } : community)
      if (state.community?.communityId === communityId) {
        state.community = { ...state.community, focusCount: Number(result.focusCount ?? state.community.focusCount) }
      }
      if (!isMobileSpaRuntime()) {
        reconcileCommunitySharedRegions()
        if (state.view.type === 'feed' && state.activeTab === 'following') {
          void loadFeedPage({ reset: true }).catch(() => null)
        }
        return
      }
      if (state.view.type === 'feed' && state.activeTab === 'following') {
        loadCommunity()
        return
      }
      render()
    })
    .catch((error) => {
      if (isCommunityAuthScopeError(error)) return
      console.warn('[community] focus failed', { code: error?.code, message: error?.message, details: error?.details })
      state.communityFocus[communityId] = previousFocused
      state.communities = previousCommunities
      state.community = previousCommunity
      showCommunityToast('Could not update focus. Please try again.')
      if (isMobileSpaRuntime()) render()
      else reconcileCommunitySharedRegions()
    })
}

// melogic-mobile-community-composer-polish-v4
let communityMobileComposerFocusToken = 0
function focusMobileCommunityComposerAfterEntrance() {
  if (!state.composer.open || !state.currentUser || !useNativeMobileCommunityComposer()) return
  const token = ++communityMobileComposerFocusToken
  const screen = app?.querySelector('[data-community-mobile-composer-screen]')
  const textarea = screen?.querySelector('[data-composer-body]')
  if (!(screen instanceof HTMLElement) || !(textarea instanceof HTMLTextAreaElement)) return
  let completed = false
  const focus = () => {
    if (completed || token !== communityMobileComposerFocusToken || !state.composer.open) return
    completed = true
    textarea.focus({ preventScroll: true })
    const end = textarea.value.length
    try { textarea.setSelectionRange(end, end) } catch {}
  }
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { requestAnimationFrame(focus); return }
  screen.addEventListener('animationend', (event) => {
    if (event.target === screen && event.animationName === 'communityMobileComposerEnter') focus()
  }, { once: true })
  window.setTimeout(focus, 420)
}
function openCommunityComposer() {
  const draft = restoreComposerDraft()
  state.composer = {
    ...state.composer,
    ...(draft || {}),
    open: true,
    communityId: state.view.type === 'community'
      ? state.community?.communityId || ''
      : state.activeTab === 'community'
        ? state.activeCommunityId
        : draft?.communityId || state.composer.communityId,
    destinationPickerOpen: false,
    destinationSearch: '',
    destinationLoading: false,
    destinationError: '',
    destinationItems: state.composer.destinationItems.length ? state.composer.destinationItems : state.communities,
    submitting: false,
    error: ''
  }
  updateCommunityComposerLayer()
  focusMobileCommunityComposerAfterEntrance()
}

function closeCommunityComposer() {
  communityMobileComposerFocusToken += 1
  releaseCommunityMobileOverlayLock()
  if (composerHasDraft()) {
    if (!window.confirm('Discard draft?')) return
    clearComposerFileAttachments()
    clearComposerDraft()
    state.composer = defaultComposerState({
      communityId: state.view.type === 'community' ? state.community?.communityId || '' : ''
    })
  } else {
    state.composer = { ...state.composer, open: false, submitting: false, error: '' }
  }
  updateCommunityComposerLayer()
}

function updateComposerFromForm() {
  const form = app?.querySelector('[data-community-composer-form]')
  if (!form) return
  const formData = new FormData(form)
  state.composer = {
    ...state.composer,
    title: String(formData.get('title') || '').trimStart().slice(0, 120),
    body: String(formData.get('body') || '').slice(0, 2000),
    communityId: String(formData.get('communityId') || '').trim(),
    tags: String(formData.get('tags') || '').trimStart().slice(0, 160),
    visibility: 'public',
    intentData: {
      ...state.composer.intentData,
      feedbackCategory: String(formData.get('feedbackCategory') || state.composer.intentData.feedbackCategory || 'Mix'),
      feedbackQuestion: String(formData.get('feedbackQuestion') || '').trimStart().slice(0, 300),
      feedbackDeadlineAt: String(formData.get('feedbackDeadlineAt') || ''),
      collaborationRoleNeeded: String(formData.get('collaborationRoleNeeded') || state.composer.intentData.collaborationRoleNeeded || 'Producer'),
      collaborationGenre: String(formData.get('collaborationGenre') || '').trimStart().slice(0, 80),
      collaborationCompensationType: String(formData.get('collaborationCompensationType') || state.composer.intentData.collaborationCompensationType || 'Discuss'),
      collaborationLocationMode: String(formData.get('collaborationLocationMode') || state.composer.intentData.collaborationLocationMode || 'Remote'),
      collaborationLocationText: String(formData.get('collaborationLocationText') || '').trimStart().slice(0, 120),
      collaborationDeadlineAt: String(formData.get('collaborationDeadlineAt') || '')
    }
  }
  persistComposerDraft()
}

function mergeCommunities(existing = [], incoming = []) {
  const byId = new Map()
  ;[...existing, ...incoming].forEach((community) => {
    if (community?.communityId) byId.set(community.communityId, community)
  })
  return [...byId.values()]
}

function bindCommunityDestinationResultEvents(root = app) {
  root?.querySelectorAll('[data-select-community-destination]').forEach((button) => {
    button.addEventListener('click', () => selectComposerCommunityDestination(button.getAttribute('data-select-community-destination') || ''))
  })
  root?.querySelector('[data-retry-community-destination]')?.addEventListener('click', () => loadComposerDestinationCommunities({ force: true }))
}

function updateCommunityDestinationResultsDom() {
  const target = app?.querySelector('[data-community-destination-results]')
  if (!target) return
  target.innerHTML = renderCommunityDestinationResults()
  bindCommunityDestinationResultEvents(target)
  const footerCount = app?.querySelector('.community-destination-modal footer span')
  if (footerCount) footerCount.textContent = `${composerDestinationCommunities().length} communities available`
}

// melogic-mobile-community-destination-loading-v5e
function refreshComposerDestinationSurface() {
  if (useNativeMobileCommunityComposer() && state.composer.destinationPickerOpen) {
    updateCommunityComposerLayer()
    return
  }
  updateCommunityDestinationResultsDom()
}

async function loadComposerDestinationCommunities({ force = false } = {}) {
  if (state.composer.destinationLoading && !force) return
  state.composer = {
    ...state.composer,
    destinationLoading: true,
    destinationError: ''
  }
  refreshComposerDestinationSurface()
  try {
    // Preserve the original destination picker's proven data source.
    // Only the presentation layer is different on mobile.
    const rows = await listSelectableCommunities({ limitCount: 80 })
    state.communities = mergeCommunities(state.communities, rows)
    state.composer = {
      ...state.composer,
      destinationItems: rows,
      destinationLoading: false,
      destinationError: ''
    }
  } catch (error) {
    console.warn('[community] destination communities failed', { code: error?.code, message: error?.message })
    state.composer = {
      ...state.composer,
      destinationLoading: false,
      destinationError: error?.message || 'Try again in a moment.'
    }
  }
  refreshComposerDestinationSurface()
}

function openCommunityDestinationPicker() {
  updateComposerFromForm()
  state.composer = {
    ...state.composer,
    destinationPickerOpen: true,
    destinationSearch: '',
    destinationSearchDraft: '',
    destinationVisibleCount: 10,
    destinationLoading: true,
    destinationError: ''
  }
  updateCommunityComposerLayer()
  window.requestAnimationFrame(() => app?.querySelector('[data-community-destination-search]')?.focus())
  loadComposerDestinationCommunities({ force: true }).catch(() => null)
}

function closeCommunityDestinationPicker() {
  window.clearTimeout(communityDestinationSearchTimer)
  state.composer = {
    ...state.composer,
    destinationPickerOpen: false,
    destinationSearch: '',
    destinationLoading: false,
    destinationError: ''
  }
  updateCommunityComposerLayer()
  window.requestAnimationFrame(() => app?.querySelector('[data-open-community-destination]')?.focus())
}

function selectComposerCommunityDestination(communityId = '') {
  window.clearTimeout(communityDestinationSearchTimer)
  const cleanId = String(communityId || '').trim()
  if (cleanId && !composerDestinationCommunities().some((community) => community.communityId === cleanId)) return
  state.composer = {
    ...state.composer,
    communityId: cleanId,
    destinationPickerOpen: false,
    destinationSearch: '',
    destinationLoading: false,
    destinationError: ''
  }
  persistComposerDraft()
  updateCommunityComposerLayer()
  window.requestAnimationFrame(() => app?.querySelector('[data-open-community-destination]')?.focus())
}

async function openProductPicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, productPickerOpen: true, productPickerLoading: true, productPickerError: '' }
  updateCommunityComposerLayer()
  try {
    const products = await listShareableCommunityProducts(state.currentUser.uid, 20)
    state.composer = { ...state.composer, products, productPickerLoading: false, productPickerError: '' }
    updateCommunityComposerLayer()
  } catch (error) {
    console.warn('[community] product picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, productPickerLoading: false, productPickerError: 'Published products could not be loaded.' }
    updateCommunityComposerLayer()
  }
}

function selectComposerProduct(productId = '') {
  const product = state.composer.products.find((item) => item.productId === productId)
  if (!product) return
  state.composer = {
    ...state.composer,
    attachments: [...state.composer.attachments.filter((attachment) => attachment.type !== 'product'), productAttachmentFromProduct(product)].slice(0, 4),
    linkedProductId: product.productId,
    productPickerOpen: false,
    productPickerError: ''
  }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

async function openMusicPicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, musicPickerOpen: true, musicPickerLoading: true, musicPickerError: '' }
  updateCommunityComposerLayer()
  try {
    const musicPreviews = await listShareableCommunityMusicPreviews(state.currentUser.uid, 20)
    state.composer = { ...state.composer, musicPreviews, musicPickerLoading: false, musicPickerError: '' }
    updateCommunityComposerLayer()
  } catch (error) {
    console.warn('[community] music picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, musicPickerLoading: false, musicPickerError: 'Audio previews could not be loaded.' }
    updateCommunityComposerLayer()
  }
}

async function openStagePicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, stagePickerOpen: true, stagePickerLoading: true, stagePickerError: '' }
  updateCommunityComposerLayer()
  try {
    const stagePlans = await listShareableCommunityStagePlans(state.currentUser.uid, 30)
    state.composer = { ...state.composer, stagePlans, stagePickerLoading: false, stagePickerError: '' }
    updateCommunityComposerLayer()
  } catch (error) {
    console.warn('[community] stage picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, stagePickerLoading: false, stagePickerError: 'StageMaker plans could not be loaded.' }
    updateCommunityComposerLayer()
  }
}

async function openStudioPicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, studioPickerOpen: true, studioPickerLoading: true, studioPickerError: '' }
  updateCommunityComposerLayer()
  try {
    const studioProjects = await listShareableCommunityStudioProjects(state.currentUser.uid, 30)
    state.composer = { ...state.composer, studioProjects, studioPickerLoading: false, studioPickerError: '' }
    updateCommunityComposerLayer()
  } catch (error) {
    console.warn('[community] studio picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, studioPickerLoading: false, studioPickerError: 'Studio projects could not be loaded.' }
    updateCommunityComposerLayer()
  }
}

function addComposerAttachment(attachment = {}) {
  const type = attachment.type || ''
  const next = [
    ...state.composer.attachments.filter((item) => type === 'music'
      ? attachmentKey(item) !== attachmentKey(attachment)
      : item.type !== type),
    attachment
  ].slice(0, 4)
  state.composer = {
    ...state.composer,
    attachments: next,
    musicPickerOpen: false,
    stagePickerOpen: false,
    studioPickerOpen: false,
    musicPickerError: '',
    stagePickerError: '',
    studioPickerError: ''
  }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function composerFileAttachmentId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function readComposerMediaMetadata(file = null, type = '') {
  if (!file || !['image', 'video', 'audio'].includes(type)) return Promise.resolve({})
  return new Promise((resolve) => {
    const previewURL = URL.createObjectURL(file)
    const media = type === 'image' ? new Image() : document.createElement(type)
    const finish = () => {
      const metadata = type === 'image'
        ? { width: media.naturalWidth || 0, height: media.naturalHeight || 0 }
        : {
            width: type === 'video' ? media.videoWidth || 0 : 0,
            height: type === 'video' ? media.videoHeight || 0 : 0,
            duration: Number.isFinite(media.duration) ? media.duration : 0
          }
      resolve({ previewURL, metadata })
    }
    media.addEventListener(type === 'image' ? 'load' : 'loadedmetadata', finish, { once: true })
    media.addEventListener('error', () => resolve({ previewURL, metadata: {} }), { once: true })
    media.src = previewURL
  })
}

async function addComposerFiles(files = []) {
  const selected = Array.from(files || [])
  if (!selected.length) return
  updateComposerFromForm()
  const available = Math.max(0, 8 - state.composer.attachments.length - state.composer.fileAttachments.length)
  if (!available) {
    state.composer = { ...state.composer, error: 'Posts can include up to 8 attachments.' }
    updateCommunityComposerLayer()
    return
  }
  const next = []
  try {
    for (const file of selected.slice(0, available)) {
      const { type } = validateCommunityPostAttachment(file)
      const id = composerFileAttachmentId()
      const media = await readComposerMediaMetadata(file, type)
      next.push({ id, file, type, previewURL: media.previewURL || '', metadata: media.metadata || {} })
    }
  } catch (error) {
    next.forEach((item) => item.previewURL && URL.revokeObjectURL(item.previewURL))
    state.composer = { ...state.composer, error: error?.message || 'This attachment is not supported.' }
    updateCommunityComposerLayer()
    return
  }
  state.composer = {
    ...state.composer,
    fileAttachments: [...state.composer.fileAttachments, ...next],
    error: selected.length > available ? `Only ${available} more attachment${available === 1 ? '' : 's'} could be added.` : ''
  }
  updateCommunityComposerLayer()
}

function removeComposerFileAttachment(id = '') {
  const removed = state.composer.fileAttachments.find((attachment) => attachment.id === id)
  if (removed?.previewURL) URL.revokeObjectURL(removed.previewURL)
  state.composer = {
    ...state.composer,
    fileAttachments: state.composer.fileAttachments.filter((attachment) => attachment.id !== id),
    error: ''
  }
  updateCommunityComposerLayer()
}

function clearComposerFileAttachments() {
  state.composer.fileAttachments.forEach((attachment) => {
    if (attachment.previewURL) URL.revokeObjectURL(attachment.previewURL)
  })
}

function selectComposerMusic(storagePath = '') {
  const preview = state.composer.musicPreviews.find((item) => item.storagePath === storagePath)
  if (!preview) return
  if (!canAddAttachment('music')) {
    state.composer = { ...state.composer, musicPickerError: 'You can attach up to two music previews.' }
    updateCommunityComposerLayer()
    return
  }
  addComposerAttachment(musicAttachmentFromPreview(preview))
}

function confirmPrivateShare(project, label = 'project') {
  if (project.visibility === 'public') return true
  return window.confirm(`Share this private ${label} as a public snapshot card? The editable project and files will stay private.`)
}

function selectComposerStage(projectId = '') {
  const project = state.composer.stagePlans.find((item) => item.projectId === projectId)
  if (!project) return
  if (!canAddAttachment('stage_plan')) {
    state.composer = { ...state.composer, stagePickerError: 'Only one Stage Plan can be attached.' }
    updateCommunityComposerLayer()
    return
  }
  if (!confirmPrivateShare(project, 'Stage Plan')) return
  addComposerAttachment(stagePlanAttachmentFromProject(project))
}

function selectComposerStudio(projectId = '') {
  const project = state.composer.studioProjects.find((item) => item.projectId === projectId)
  if (!project) return
  if (!canAddAttachment('studio_project')) {
    state.composer = { ...state.composer, studioPickerError: 'Only one Studio Project can be attached.' }
    updateCommunityComposerLayer()
    return
  }
  if (!confirmPrivateShare(project, 'Studio Project')) return
  addComposerAttachment(studioProjectAttachmentFromProject(project))
}

function removeComposerAttachment(type = '') {
  state.composer = {
    ...state.composer,
    attachments: state.composer.attachments.filter((attachment) => attachment.type !== type),
    linkedProductId: type === 'product' ? '' : state.composer.linkedProductId
  }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function removeComposerAttachmentByKey(key = '') {
  const cleanKey = String(key || '').trim()
  if (!cleanKey) return
  state.composer = {
    ...state.composer,
    attachments: state.composer.attachments.filter((attachment) => attachmentKey(attachment) !== cleanKey),
    linkedProductId: attachmentKey(selectedProductAttachment() || {}) === cleanKey ? '' : state.composer.linkedProductId
  }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function setComposerIntent(intent = '') {
  updateComposerFromForm()
  state.composer = { ...state.composer, intent: state.composer.intent === intent ? '' : intent, error: '' }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function clearComposerIntent() {
  state.composer = { ...state.composer, intent: '', error: '' }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function insertEmoji(emoji = '') {
  const textarea = app?.querySelector('[data-composer-body]')
  const current = state.composer.body || ''
  if (textarea) {
    const start = textarea.selectionStart ?? current.length
    const end = textarea.selectionEnd ?? current.length
    state.composer.body = `${current.slice(0, start)}${emoji}${current.slice(end)}`.slice(0, 2000)
  } else {
    state.composer.body = `${current}${emoji}`.slice(0, 2000)
  }
  state.composer.emojiOpen = false
  persistComposerDraft()
  updateCommunityComposerLayer()
}

let mentionSearchTimer = null

function bindMentionPickerEvents(root = app) {
  root?.querySelectorAll('[data-select-mentioned-user]').forEach((button) => {
    button.addEventListener('click', () => selectMentionedUser(button.getAttribute('data-select-mentioned-user') || ''))
  })
  root?.querySelectorAll('[data-remove-mentioned-user]').forEach((button) => {
    button.addEventListener('click', () => removeMentionedUser(button.getAttribute('data-remove-mentioned-user') || ''))
  })
}

function updateMentionPickerDom() {
  const region = app?.querySelector('[data-mention-picker-region]')
  if (!region) return
  region.innerHTML = renderMentionPickerContent()
  bindMentionPickerEvents(region)
}

function queueMentionSearch(value = '') {
  const mentionQuery = String(value || '').replace(/^@/, '').trim().toLowerCase()
  state.composer = { ...state.composer, mentionQuery, mentionSearchError: '', mentionResults: mentionQuery.length >= 2 ? state.composer.mentionResults : [] }
  persistComposerDraft()
  window.clearTimeout(mentionSearchTimer)
  if (mentionQuery.length < 2) {
    state.composer = { ...state.composer, mentionSearchLoading: false }
    updateMentionPickerDom()
    return
  }
  state.composer = { ...state.composer, mentionSearchLoading: true }
  updateMentionPickerDom()
  mentionSearchTimer = window.setTimeout(async () => {
    try {
      const rows = await searchProfilesByUsername(mentionQuery)
      if (state.composer.mentionQuery !== mentionQuery) return
      const existing = new Set(state.composer.mentionedUsers.map((user) => user.uid))
      state.composer = { ...state.composer, mentionResults: rows.filter((user) => !existing.has(user.uid)), mentionSearchLoading: false, mentionSearchError: '' }
      updateMentionPickerDom()
    } catch (error) {
      if (state.composer.mentionQuery !== mentionQuery) return
      state.composer = { ...state.composer, mentionSearchLoading: false, mentionSearchError: error?.message || 'Creator search is unavailable.' }
      updateMentionPickerDom()
    }
  }, 250)
}

function selectMentionedUser(uid = '') {
  const user = state.composer.mentionResults.find((item) => item.uid === uid)
  if (!user) return
  state.composer = {
    ...state.composer,
    mentionedUsers: [...state.composer.mentionedUsers.filter((item) => item.uid !== uid), user].slice(0, 10),
    mentionQuery: '',
    mentionResults: []
  }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function removeMentionedUser(uid = '') {
  state.composer = { ...state.composer, mentionedUsers: state.composer.mentionedUsers.filter((item) => item.uid !== uid) }
  persistComposerDraft()
  updateCommunityComposerLayer()
}

function openCommunityImageViewer(url = '', name = '') {
  const cleanUrl = String(url || '').trim()
  if (!cleanUrl) return
  state.imageViewer = { open: true, url: cleanUrl, name: String(name || 'Image attachment') }
  render()
}

function closeCommunityImageViewer() {
  if (!state.imageViewer.open) return
  state.imageViewer = { open: false, url: '', name: '' }
  render()
}

function showCommunityToast(message = '') {
  state.message = message
  let toast = app?.querySelector('.community-toast')
  const toastContainer = app?.querySelector('[data-community-root]') || app?.querySelector('.community-page')
  if (!toast && toastContainer) {
    toast = document.createElement('p')
    toast.className = 'community-toast'
    const anchor = toastContainer.querySelector('.community-layout, .community-detail-topbar, .community-hero')
    toastContainer.insertBefore(toast, anchor || toastContainer.firstChild)
  }
  if (toast) toast.textContent = message
  window.setTimeout(() => {
    if (state.message === message) {
      state.message = ''
      app?.querySelector('.community-toast')?.remove()
    }
  }, 2800)
}

function selectTopicTab(tab = 'for-you') {
  const supportedTabs = new Set(['following', 'new', 'official', 'music', 'products', 'stage-plans', 'studio-projects', 'feedback', 'collaboration', 'forms', 'for-you', 'live', 'saved', 'my-content', 'my-account'])
  state.activeTab = supportedTabs.has(tab) ? tab : 'for-you'
  state.activeCommunityId = ''
  state.activeCommunitySlug = ''
  if (['for-you', 'following'].includes(state.activeTab) && state.view.type === 'feed') {
    state.activeTopicLabel = activeFeedTitle()
    app?.querySelectorAll('[data-community-tab="for-you"], [data-community-tab="following"]').forEach((button) => {
      const active = button.getAttribute('data-community-tab') === state.activeTab
      button.classList.toggle('is-active', active)
      button.setAttribute('aria-selected', active ? 'true' : 'false')
    })
    updateFeedToolbarText()
    loadFeedPage({ reset: true, localOnly: true })
    return
  }
  state.activeTopicLabel = activeFeedTitle()
  loadCommunity()
}

/* melogic-community-filter-feed-fix-v1 */
async function applyCommunityFilterSelection(nextFilters = []) {
  const normalized=[...new Set((Array.isArray(nextFilters)?nextFilters:[]).map(value=>String(value||'').trim()).filter(Boolean))]
  const changed=JSON.stringify(normalized)!==JSON.stringify(state.selectedCommunityFilters)
  if(!changed){syncCommunityFilterControls();return}
  state.selectedCommunityFilters=normalized
  state.feedCursor=null;state.feedHasMore=true;state.feedError='';state.feedStillLoading=false
  state.activeFeedQueryKey=''
  state.followingFeedCache = { uid: '', key: '', posts: [] }
  syncCommunityFilterControls()
  await loadFeed({reset:true})
}
function syncCommunityFilterControls(root=app){
  if(!root)return
  root.querySelectorAll('[data-topic-community-id]').forEach(button=>{
    const id=String(button.getAttribute('data-topic-community-id')||'').trim()
    const active=state.selectedCommunityFilters.includes(id)
    button.classList.toggle('is-active',active)
    button.setAttribute('aria-pressed',String(active))
  })
  const all=root.querySelector('[data-clear-community-filters]')
  if(all){const active=state.selectedCommunityFilters.length===0;all.classList.toggle('is-active',active);all.setAttribute('aria-pressed',String(active))}
}
function selectTopicCommunity({ communityId = '' } = {}) {
  const cleanId=String(communityId||'').trim()
  if(!cleanId)return
  const selected=new Set(state.selectedCommunityFilters)
  if(selected.has(cleanId))selected.delete(cleanId);else selected.add(cleanId)
  void applyCommunityFilterSelection([...selected])
}

function updateTopicArrowState() {
  const scroller = app?.querySelector('[data-community-topic-scroll]')
  if (!scroller) return
  const left = app.querySelector('[data-topic-scroll="-1"]')
  const right = app.querySelector('[data-topic-scroll="1"]')
  const atStart = scroller.scrollLeft <= 4
  const atEnd = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4
  left?.toggleAttribute('disabled', atStart)
  right?.toggleAttribute('disabled', atEnd)
  updateHorizontalRailFadeState(scroller, app.querySelector('.community-filter-shell'))
}

function updateHorizontalRailFadeState(scroller, root = scroller) {
  if (!scroller || !root) return
  const canScroll = scroller.scrollWidth > scroller.clientWidth + 4
  const canScrollLeft = canScroll && scroller.scrollLeft > 4
  const canScrollRight = canScroll && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 4
  root.classList.toggle('can-scroll-left', canScrollLeft)
  root.classList.toggle('can-scroll-right', canScrollRight)
}

function updateCommunityRailFadeState() {
  const topicScroller = app?.querySelector('[data-community-topic-scroll]')
  const storiesScroller = app?.querySelector('[data-community-stories-scroll]')
  if (topicScroller) updateHorizontalRailFadeState(topicScroller, app.querySelector('.community-filter-shell'))
  if (storiesScroller) updateHorizontalRailFadeState(storiesScroller, storiesScroller)
}

function communityModalIsOpen() {
  return Boolean(state.composer.open || state.storyComposer.open || state.storyViewer.open || state.report.open || state.editPost.open || state.imageViewer.open)
}

function activeElementIsCommunityInput() {
  const active = document.activeElement
  return Boolean(active?.closest?.('.community-page input, .community-page textarea, .community-page select, .community-page [contenteditable="true"]'))
}

function setupCommunityKeyboardShortcuts() {
  if (communityKeyboardReady) return
  communityKeyboardReady = true
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    if (state.openPostMenuId) {
      closePostMenusDom()
      return
    }
    if (state.openCommentMenuKey) {
      closeCommentMenusDom()
      return
    }
    if (!communityModalIsOpen()) return
    if (state.imageViewer.open) {
      closeCommunityImageViewer()
      return
    }
    if (state.composer.destinationPickerOpen) {
      state.composer = {
        ...state.composer,
        destinationPickerOpen: false,
        destinationSearch: '',
        destinationLoading: false,
        destinationError: ''
      }
      updateCommunityComposerLayer()
      return
    }
    if (state.composer.open) {
      state.composer = { ...state.composer, open: false, submitting: false, error: '' }
      updateCommunityComposerLayer()
      return
    }
    if (state.storyComposer.open) {
      resetStoryRecording()
      resetStoryPreviewURL()
      state.storyComposer = cleanStoryComposerState()
    }
    if (state.storyViewer.open) state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
    if (state.report.open) state.report = { ...state.report, open: false, submitting: false, error: '' }
    if (state.editPost.open) state.editPost = { open: false, postId: '', title: '', body: '', tags: '', visibility: 'public', submitting: false, error: '' }
    render()
  })
}

function setupCommunityOutsideClick() {
  if (communityOutsideClickReady) return
  communityOutsideClickReady = true
  document.addEventListener('click', (event) => {
    if (state.openPostMenuId && !event.target.closest('[data-post-options-root]')) closePostMenusDom()
    if (state.openCommentMenuKey && !event.target.closest('[data-comment-options-root]')) closeCommentMenusDom()
  })
}

function setupCommunityRailResize() {
  if (communityRailResizeReady) return
  communityRailResizeReady = true
  window.addEventListener('resize', updateCommunityRailFadeState, { passive: true })
}

function setupFeedPaginationObserver() {
  if (feedPaginationObserver) {
    feedPaginationObserver.disconnect()
    feedPaginationObserver = null
  }
  const sentinel = app?.querySelector('[data-community-feed-sentinel]')
  if (!sentinel || !state.feedHasMore || state.feedInitialLoading || state.feedLoadingMore) return
  if (!('IntersectionObserver' in window)) return
  const viewport = communityScrollViewport(app)
  const scrollRoot = viewport === document.scrollingElement || viewport === document.documentElement ? null : viewport
  feedPaginationObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadFeedPage({ reset: false, localOnly: true })
  }, {
    root: scrollRoot || null,
    rootMargin: '0px 0px 420px 0px'
  })
  feedPaginationObserver.observe(sentinel)
}

// melogic-mobile-community-subpage-cache-v1
// For You / Following / Discover are persistent mobile surfaces. Switching
// among them detaches/reattaches the existing DOM instead of rebuilding posts,
// Stories, images or video elements.
function mobileCommunitySurfaceKeyFor(viewType = state.view?.type, activeTab = state.activeTab) {
  if (viewType === 'communities') return 'discover'
  if (viewType === 'feed' && activeTab === 'following') return 'following'
  if (viewType === 'feed') return 'for-you'
  return ''
}

function captureMobileCommunitySurface(key = mobileCommunitySurfaceKeyFor()) {
  if (!isMobileSpaRuntime() || !key || state.detailPostId) return false
  const root = app?.querySelector('[data-community-root]')
  if (!root) return false
  const viewport = communityScrollViewport(root)
  const fragment = document.createDocumentFragment()
  while (root.firstChild) fragment.append(root.firstChild)
  mobileCommunitySurfaceCache.set(key, {
    fragment,
    scrollTop: viewport?.scrollTop || 0,
    state: {
      activeTab: state.activeTab,
      activeCommunityId: state.activeCommunityId,
      activeCommunitySlug: state.activeCommunitySlug,
      activeTopicLabel: state.activeTopicLabel,
      selectedCommunityFilters: [...state.selectedCommunityFilters],
      activeTag: state.activeTag,
      feedSearch: state.feedSearch,
      feedSort: state.feedSort,
      view: { ...state.view },
      posts: state.posts,
      attachmentMediaUrls: state.attachmentMediaUrls,
      viewerState: state.viewerState,
      feedInitialLoading: state.feedInitialLoading,
      feedLoadingMore: state.feedLoadingMore,
      feedHasMore: state.feedHasMore,
      feedCursor: state.feedCursor,
      feedError: state.feedError,
      activeFeedQueryKey: state.activeFeedQueryKey,
      followingFeedCache: state.followingFeedCache,
      communityFilters: { ...state.communityFilters }
    }
  })
  return true
}

function restoreMobileCommunitySurface(key = mobileCommunitySurfaceKeyFor()) {
  if (!isMobileSpaRuntime() || !key) return false
  const cached = mobileCommunitySurfaceCache.get(key)
  const root = app?.querySelector('[data-community-root]')
  if (!cached?.fragment?.childNodes?.length || !root) return false
  // Keep the cache slot alive conceptually; the restored fragment is consumed
  // by the DOM, and the surface is re-captured into the same slot on departure.
  // Stories/community topology are shared live state. Surface-specific feed
  // data comes from the snapshot, but shared state must never roll backward.
  const sharedState = {
    currentUser: state.currentUser,
    stories: state.stories,
    storiesLoading: state.storiesLoading,
    storiesError: state.storiesError,
    communities: state.communities,
    communityFocus: state.communityFocus,
    communityMembership: state.communityMembership
  }
  Object.assign(state, cached.state, sharedState)
  restorePreservedCommunitySurface({
    root,
    fragment: cached.fragment,
    reconcile: (surface) => {
      updateStoryRegionsInRoot(surface, { bind: true })
      updateCommunitySharedRegionsInRoot(surface, { bind: true })
    }
  })
  mobileCommunitySurfaceKey = key
  syncCommunityMobileHeader(false, app)
  setCommunityScroll(cached.scrollTop, root)
  window.requestAnimationFrame(() => setCommunityScroll(cached.scrollTop, root))
  updateTopicArrowState()
  updateCommunityRailFadeState()
  setupFeedPaginationObserver()
  hydrateCommunityIdentityDom()
  return true
}

function navigateMobileCommunitySurface(nextKey) {
  if (!isMobileSpaRuntime() || !['for-you', 'following', 'discover'].includes(nextKey)) return false
  const currentKey = mobileCommunitySurfaceKey || mobileCommunitySurfaceKeyFor()
  if (currentKey === nextKey) return true
  if (currentKey) captureMobileCommunitySurface(currentKey)

  state.detailPostId = ''
  state.focusedCommentId = ''
  state.focusedReplyId = ''
  state.activeCommunityId = ''
  state.activeCommunitySlug = ''
  if (nextKey === 'discover') {
    state.view = { type: 'communities' }
    history.pushState({}, '', ROUTES.communityCommunities)
  } else {
    state.view = { type: 'feed' }
    state.activeTab = nextKey
    state.activeTopicLabel = nextKey === 'following' ? 'Following' : 'For You'
    history.pushState({}, '', `${ROUTES.community}?feed=${encodeURIComponent(nextKey)}`)
  }

  if (restoreMobileCommunitySurface(nextKey)) return true

  mobileCommunitySurfaceKey = nextKey
  render()
  if (nextKey === 'discover') {
    void loadCommunities({ renderOnStart: false, renderAfter: true, bootstrap: false }).catch(() => null)
  } else {
    void loadFeedPage({ reset: true }).catch(() => null)
  }
  return true
}

// melogic-desktop-community-surface-cache-v1
function desktopCommunitySurfaceKeyFor(viewType = state.view?.type, activeTab = state.activeTab) {
  if (viewType === 'communities') return 'discover'
  if (viewType === 'feed' && activeTab === 'following') return 'following'
  if (viewType === 'feed') return 'for-you'
  return ''
}

function captureDesktopCommunitySurface(key = desktopCommunitySurfaceKeyFor()) {
  if (isMobileSpaRuntime() || !key) return false
  const root = app?.querySelector('[data-community-root]')
  if (!root || state.detailPostId) return false
  const viewport = communityScrollViewport(root)
  const fragment = document.createDocumentFragment()
  while (root.firstChild) fragment.append(root.firstChild)
  desktopCommunitySurfaceCache.set(key, {
    fragment,
    scrollTop: viewport?.scrollTop || 0,
    state: {
      activeTab: state.activeTab,
      activeCommunityId: state.activeCommunityId,
      activeCommunitySlug: state.activeCommunitySlug,
      activeTopicLabel: state.activeTopicLabel,
      selectedCommunityFilters: [...state.selectedCommunityFilters],
      activeTag: state.activeTag,
      feedSearch: state.feedSearch,
      feedSort: state.feedSort,
      view: { ...state.view },
      posts: state.posts,
      attachmentMediaUrls: state.attachmentMediaUrls,
      viewerState: state.viewerState,
      feedInitialLoading: state.feedInitialLoading,
      feedLoadingMore: state.feedLoadingMore,
      feedHasMore: state.feedHasMore,
      feedCursor: state.feedCursor,
      feedError: state.feedError,
      activeFeedQueryKey: state.activeFeedQueryKey,
      followingFeedCache: state.followingFeedCache
    }
  })
  return true
}

function restoreDesktopCommunitySurface(key) {
  if (isMobileSpaRuntime() || !key) return false
  const cached = desktopCommunitySurfaceCache.get(key)
  const root = app?.querySelector('[data-community-root]')
  if (!cached || !root || !cached.fragment?.childNodes?.length) return false
  desktopCommunitySurfaceCache.delete(key)

  // Preserve authoritative cross-surface data while restoring only the
  // expensive surface-local feed/directory state.
  const sharedState = {
    currentUser: state.currentUser,
    communities: state.communities,
    communityFocus: state.communityFocus,
    communityMembership: state.communityMembership,
    stories: state.stories,
    storiesLoading: state.storiesLoading,
    storiesError: state.storiesError
  }
  Object.assign(state, cached.state, sharedState)
  restorePreservedCommunitySurface({
    root,
    fragment: cached.fragment,
    reconcile: (surface) => {
      updateStoryRegionsInRoot(surface, { bind: true })
      updateCommunitySharedRegionsInRoot(surface, { bind: true })
    }
  })
  desktopCommunitySurfaceKey = key
  const viewport = communityScrollViewport(root)
  if (viewport) viewport.scrollTop = cached.scrollTop
  window.requestAnimationFrame(() => {
    const nextViewport = communityScrollViewport(root)
    if (nextViewport) nextViewport.scrollTop = cached.scrollTop
  })
  updateTopicArrowState()
  updateCommunityRailFadeState()
  setupFeedPaginationObserver()
  hydrateCommunityIdentityDom()
  updateStoryRegionsOnly()
  reconcileCommunitySharedRegions()
  return true
}

function refreshDesktopCommunitySharedContent(nextKey) {
  if (isMobileSpaRuntime()) return
  void Promise.allSettled([
    loadStories({ renderAfter: true, hydrateIdentity: true }),
    hydrateDesktopCommunitySharedState({ fullDirectory: nextKey === 'discover' })
  ])
}

function navigateDesktopCommunitySurface(nextKey) {
  if (isMobileSpaRuntime() || !['for-you', 'following', 'discover'].includes(nextKey)) return false
  const currentKey = desktopCommunitySurfaceKey || desktopCommunitySurfaceKeyFor()
  if (currentKey === nextKey) return true
  captureDesktopCommunitySurface(currentKey)

  if (nextKey === 'discover') {
    state.view = { type: 'communities' }
    window.history.pushState({}, '', ROUTES.communityCommunities)
  } else {
    state.view = { type: 'feed' }
    state.activeTab = nextKey
    state.activeTopicLabel = nextKey === 'following' ? 'Following' : 'For You'
    state.activeCommunityId = ''
    state.activeCommunitySlug = ''
    window.history.pushState({}, '', `${ROUTES.community}?feed=${encodeURIComponent(nextKey)}`)
  }

  if (restoreDesktopCommunitySurface(nextKey)) {
    refreshDesktopCommunitySharedContent(nextKey)
    return true
  }
  desktopCommunitySurfaceKey = nextKey
  render()
  refreshDesktopCommunitySharedContent(nextKey)
  if (nextKey !== 'discover') {
    void loadFeedPage({ reset: true }).catch(() => null)
  }
  return true
}

function isPostCardInteractiveTarget(target) {
  return Boolean(target?.closest?.('a, button, input, textarea, select, label, [role="button"], [data-stop-card-nav]'))
}

function captureFeedNavigationSnapshot() {
  const root = app?.querySelector('[data-community-root]')
  const main = root?.querySelector('.community-main')
  if (!root || !main || state.detailPostId) return
  const scrollTop = communityScrollViewport(root).scrollTop
  if (root.contains(document.activeElement)) document.activeElement?.blur?.()
  const fragment = document.createDocumentFragment()
  while (root.firstChild) fragment.append(root.firstChild)
  feedNavigationSnapshot = {
    fragment,
    scrollTop,
    state: {
      activeTab: state.activeTab,
      activeCommunityId: state.activeCommunityId,
      activeCommunitySlug: state.activeCommunitySlug,
      activeTopicLabel: state.activeTopicLabel,
      selectedCommunityFilters: [...state.selectedCommunityFilters],
      activeTag: state.activeTag,
      feedSearch: state.feedSearch,
      feedSort: state.feedSort,
      view: { ...state.view },
      community: state.community,
      posts: state.posts,
      attachmentMediaUrls: state.attachmentMediaUrls,
      viewerState: state.viewerState,
      feedInitialLoading: state.feedInitialLoading,
      feedLoadingMore: state.feedLoadingMore,
      feedHasMore: state.feedHasMore,
      feedCursor: state.feedCursor,
      feedError: state.feedError,
      activeFeedQueryKey: state.activeFeedQueryKey,
      followingFeedCache: state.followingFeedCache
    }
  }
}

function restoreFeedNavigationSnapshot() {
  if (!feedNavigationSnapshot) return false
  const root = app?.querySelector('[data-community-root]')
  if (!root) return false
  const snapshot = feedNavigationSnapshot
  feedNavigationSnapshot = null
  Object.assign(state, snapshot.state, {
    detailPostId: '',
    focusedCommentId: '',
    focusedReplyId: '',
    focusedCommentScrolled: false,
    detailPostLoading: false,
    error: '',
    imageViewer: { open: false, url: '', name: '' }
  })
  restorePreservedCommunitySurface({
    root,
    fragment: snapshot.fragment,
    reconcile: (surface) => {
      updateStoryRegionsInRoot(surface, { bind: true })
      updateCommunitySharedRegionsInRoot(surface, { bind: true })
    }
  })
  root.querySelectorAll('.community-image-viewer-backdrop').forEach((overlay) => overlay.remove())
  document.body.classList.remove('community-modal-open')
  syncCommunityMobileHeader(false, app)
  setCommunityScroll(snapshot.scrollTop, root)
  window.requestAnimationFrame(() => setCommunityScroll(snapshot.scrollTop, root))
  updateTopicArrowState()
  updateCommunityRailFadeState()
  setupFeedPaginationObserver()
  return true
}

function openPostDetail(postId = '', hash = '') {
  const id = String(postId || '').trim()
  if (!id) return
  if (!confirmCommunityNavigation(communityPostRoute(id))) return
  const cachedPost = state.posts.find((post) => post.postId === id) || null
  captureFeedNavigationSnapshot()
  loadPostDetail({ postId: id, seedPost: cachedPost, replaceUrl: true }).then(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView?.({ block: 'start' })
  }).catch(() => null)
}

function renderCommentsOnly() {
  const post = state.posts[0]
  const target = app?.querySelector('#comments')
  if (!post || !target) {
    render()
    return
  }
  target.outerHTML = renderComments(post)
  bindCommentEvents(app?.querySelector('#comments') || app)
}

function renderCommentState() {
  if (state.detailPostId && app?.querySelector('#comments')) {
    renderCommentsOnly()
    return
  }
  render()
}

function stopStoryRecordingTracks() {
  if (storyRecordingTimer) {
    window.clearInterval(storyRecordingTimer)
    storyRecordingTimer = null
  }
  if (storyRecordingStream) {
    storyRecordingStream.getTracks().forEach((track) => track.stop())
    storyRecordingStream = null
  }
}

function resetStoryRecording() {
  if (storyMediaRecorder && storyMediaRecorder.state !== 'inactive') {
    try {
      storyMediaRecorder.stop()
    } catch {
      // Recorder may already be stopping.
    }
  }
  storyMediaRecorder = null
  storyRecordingChunks = []
  stopStoryRecordingTracks()
}

function bindStoryRecordingPreview() {
  const video = app?.querySelector('[data-story-record-preview]')
  if (video && storyRecordingStream) {
    video.srcObject = storyRecordingStream
    video.play?.().catch(() => {})
  }
}

function updateStoryComposerFromForm() {
  const form = app?.querySelector('[data-story-composer-form]')
  if (!form) return
  const formData = new FormData(form)
  state.storyComposer = {
    ...state.storyComposer,
    text: String(formData.get('text') || '').slice(0, 500),
    lifetimeHours: Math.min(48, Math.max(1, Number(formData.get('lifetimeHours') || state.storyComposer.lifetimeHours || 24))),
    visibility: String(formData.get('visibility') || 'public') === 'public' ? 'public' : 'public'
  }
}

function setStoryFile(file = null, mediaType = '') {
  resetStoryPreviewURL()
  const previewURL = file ? URL.createObjectURL(file) : ''
  state.storyComposer = {
    ...state.storyComposer,
    file,
    previewURL,
    mediaType: mediaType || (String(file?.type || '').startsWith('image/') ? 'image' : 'video'),
    error: '',
    uploadProgress: 0
  }
}

function selectStoryFile(file = null) {
  try {
    const { mediaType } = validateCommunityStoryMedia(file)
    setStoryFile(file, mediaType)
  } catch (error) {
    resetStoryPreviewURL()
    state.storyComposer = {
      ...state.storyComposer,
      file: null,
      previewURL: '',
      error: error?.message || 'Choose a supported story video or image.'
    }
  }
  render()
}

function removeStoryFile() {
  resetStoryPreviewURL()
  state.storyComposer = {
    ...state.storyComposer,
    file: null,
    previewURL: '',
    uploadProgress: 0,
    error: ''
  }
  render()
}

function closeStoryComposer() {
  if (state.storyComposer.submitting) return
  resetStoryRecording()
  resetStoryPreviewURL()
  state.storyComposer = cleanStoryComposerState()
  render()
}

async function startStoryRecording() {
  updateStoryComposerFromForm()
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    state.storyComposer = { ...state.storyComposer, mode: 'record', recordingSupported: false, error: 'Recording is not supported in this browser. Upload a video instead.' }
    render()
    return
  }
  try {
    resetStoryRecording()
    resetStoryPreviewURL()
    storyRecordingStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: true
    }).catch(() => navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' }, audio: false }))
    storyRecordingChunks = []
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp8,opus') ? 'video/webm;codecs=vp8,opus' : 'video/webm'
    storyMediaRecorder = new MediaRecorder(storyRecordingStream, { mimeType })
    storyMediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) storyRecordingChunks.push(event.data)
    })
    storyMediaRecorder.addEventListener('stop', () => {
      const blob = new Blob(storyRecordingChunks, { type: 'video/webm' })
      const file = typeof File === 'function'
        ? new File([blob], `story-recording-${Date.now()}.webm`, { type: 'video/webm' })
        : Object.assign(blob, { name: `story-recording-${Date.now()}.webm` })
      stopStoryRecordingTracks()
      setStoryFile(file, 'video')
      state.storyComposer = { ...state.storyComposer, recording: false, recordingSeconds: Math.min(STORY_MAX_RECORD_SECONDS, state.storyComposer.recordingSeconds || 0), error: '' }
      render()
    })
    state.storyComposer = {
      ...state.storyComposer,
      mode: 'record',
      mediaType: 'video',
      file: null,
      previewURL: '',
      recording: true,
      recordingSeconds: 0,
      recordingSupported: true,
      error: ''
    }
    storyMediaRecorder.start()
    render()
    bindStoryRecordingPreview()
    const startedAt = Date.now()
    storyRecordingTimer = window.setInterval(() => {
      const seconds = Math.min(STORY_MAX_RECORD_SECONDS, Math.floor((Date.now() - startedAt) / 1000))
      state.storyComposer.recordingSeconds = seconds
      const timer = app?.querySelector('[data-story-record-timer]')
      if (timer) timer.textContent = `${seconds}s / ${STORY_MAX_RECORD_SECONDS}s`
      if (seconds >= STORY_MAX_RECORD_SECONDS) stopStoryRecording()
    }, 500)
  } catch (error) {
    console.warn('[community] story recording failed', { name: error?.name, message: error?.message })
    resetStoryRecording()
    state.storyComposer = { ...state.storyComposer, mode: 'record', recording: false, error: error?.name === 'NotAllowedError' ? 'Camera permission was denied. Upload a video instead.' : 'Recording could not start. Upload a video instead.' }
    render()
  }
}

function stopStoryRecording() {
  if (storyMediaRecorder && storyMediaRecorder.state !== 'inactive') {
    storyMediaRecorder.stop()
    return
  }
  stopStoryRecordingTracks()
  state.storyComposer = { ...state.storyComposer, recording: false }
  render()
}

async function openStoryComposer() {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }

  // melogic-mobile-story-camera-spa-v1
  // Mobile Stories are captured through the existing persistent Camera runtime.
  // navigateMobileRuntimeUrl() prepares/activates Camera in-place, so this does
  // not perform a document load or bypass the established SPA lifecycle.
  if (isMobileSpaRuntime()) {
    const opened = await navigateMobileRuntimeUrl('/camera', {
      historyMode: 'push',
      source: 'community-add-story'
    })
    if (opened) return
    console.warn('[community] mobile Add Story could not activate Camera runtime')
    showCommunityToast('Camera could not be opened. Try the Camera tab.')
    return
  }

  resetStoryRecording()
  resetStoryPreviewURL()
  state.storyComposer = {
    ...cleanStoryComposerState({
    open: true,
    recordingSupported: typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
    })
  }
  render()
}

// melogic-mobile-story-optimistic-upload-v1
let cameraCommunityHandoffConsumedAt=0

async function publishPendingCameraStory(){
  const pending=state.pendingStoryUpload
  if(!pending?.file||pending.status==='uploading')return false
  const authToken=communityAuthScope.current()
  const authorUid=authToken.uid
  if(!authorUid)return false
  const token=pending.localId
  state.pendingStoryUpload={...pending,status:'uploading',progress:0,error:''}
  updateStoryRegionsOnly()
  try{
    validateCommunityStoryMedia(pending.file)
    const storyId=newCommunityStoryId()
    const uploaded=await uploadCommunityStoryMedia({
      uid:authorUid,
      storyId,
      file:pending.file,
      onProgress:(progress)=>{
        if(!communityAuthScope.isCurrent(authToken))return
        if(state.pendingStoryUpload?.localId!==token)return
        state.pendingStoryUpload={...state.pendingStoryUpload,progress}
        updateStoryRegionsOnly()
      }
    })
    assertCommunityAuthToken(authToken)
    const result=await trackCommunityAction(`create-story:${storyId}`,createCommunityStory({
      storyId,
      mediaType:uploaded.mediaType,
      text:'',
      caption:'',
      mediaPath:uploaded.mediaPath,
      lifetimeHours:24,
      visibility:'public',
      background:'aurora'
    }))
    if(state.pendingStoryUpload?.localId!==token)return false
    const story=normalizeCommunityStory({
      ...(result.story||{}),
      mediaURL:uploaded.mediaURL||result.story?.mediaURL||''
    },result.storyId)
    state.stories=[story,...state.stories.filter(item=>item.storyId!==story.storyId)]
    if(state.pendingStoryUpload?.previewURL)URL.revokeObjectURL(state.pendingStoryUpload.previewURL)
    state.pendingStoryUpload=null
    updateStoryRegionsOnly()
    return true
  }catch(error){
    if(isCommunityAuthScopeError(error))return false
    console.warn('[community] camera story publish failed',{code:error?.code,message:error?.message,details:error?.details})
    if(state.pendingStoryUpload?.localId===token){
      state.pendingStoryUpload={...state.pendingStoryUpload,status:'failed',error:error?.message||'Story upload failed.'}
      updateStoryRegionsOnly()
    }
    return false
  }
}

async function consumeCameraCommunityMediaHandoff(){
  const h=window.__melogicCommunityMediaHandoff
  if(!h?.file||!['story','feed'].includes(h.destination)||h.createdAt===cameraCommunityHandoffConsumedAt)return false
  if(Date.now()-Number(h.createdAt||0)>600000){delete window.__melogicCommunityMediaHandoff;sessionStorage.removeItem('melogicCommunityMediaHandoffDestination');return false}
  if(!state.currentUser)return false
  cameraCommunityHandoffConsumedAt=h.createdAt
  try{
    if(h.destination==='story'){
      validateCommunityStoryMedia(h.file)
      const previewURL=URL.createObjectURL(h.file)
      state.pendingStoryUpload={
        localId:`camera-story-${h.createdAt}`,
        file:h.file,
        mediaType:h.type==='photo'?'image':'video',
        previewURL,
        createdAt:h.createdAt,
        progress:0,
        status:'queued',
        error:''
      }
      // Mobile Camera shares publish directly. The desktop Story composer is
      // deliberately never opened for this path.
      updateStoryRegionsOnly()
      void publishPendingCameraStory()
    }else{
      const {type}=validateCommunityPostAttachment(h.file);clearComposerFileAttachments()
      const id=composerFileAttachmentId(),media=await readComposerMediaMetadata(h.file,type)
      state.composer=defaultComposerState({open:true,communityId:state.view.type==='community'?state.community?.communityId||'':'',fileAttachments:[{id,file:h.file,type,previewURL:media.previewURL||'',metadata:media.metadata||{}}],destinationItems:state.communities,error:''})
      updateCommunityComposerLayer();focusMobileCommunityComposerAfterEntrance()
    }
    delete window.__melogicCommunityMediaHandoff;sessionStorage.removeItem('melogicCommunityMediaHandoffDestination');return true
  }catch(error){
    console.warn('[community] camera media handoff failed',{code:error?.code,message:error?.message});state.message=error?.message||'Could not open the captured media.';delete window.__melogicCommunityMediaHandoff;sessionStorage.removeItem('melogicCommunityMediaHandoffDestination');render();return false
  }
}

async function handleStorySubmit(event) {
  event.preventDefault()
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const formData = new FormData(event.currentTarget)
  const text = String(formData.get('text') || '').trim()
  const lifetimeHours = Math.min(48, Math.max(1, Number(formData.get('lifetimeHours') || state.storyComposer.lifetimeHours || 24)))
  const visibility = String(formData.get('visibility') || 'public') === 'public' ? 'public' : 'public'
  const file = state.storyComposer.file || formData.get('storyMedia')
  const authToken = communityAuthScope.current()
  const authorUid = authToken.uid
  if (!authorUid) return

  state.storyComposer = { ...state.storyComposer, text, lifetimeHours, visibility, error: '', submitting: true, uploadProgress: 0 }
  try {
    if (!file && state.storyComposer.remixOfStoryId) throw new Error('Choose your own photo or video for this remix before publishing.')
    validateCommunityStoryMedia(file)
  } catch (error) {
    state.storyComposer = { ...state.storyComposer, submitting: false, error: error?.message || 'Choose a supported story video or image.' }
    render()
    return
  }

  render()
  try {
    const storyId = newCommunityStoryId()
    const uploaded = await uploadCommunityStoryMedia({
      uid: authorUid,
      storyId,
      file,
      onProgress: (progress) => {
        if (!communityAuthScope.isCurrent(authToken)) return
        state.storyComposer = { ...state.storyComposer, uploadProgress: progress }
        const bar = app?.querySelector('.community-story-progress span')
        const text = app?.querySelector('.community-story-progress em')
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, progress))}%`
        if (text) text.textContent = `${progress}%`
      }
    })
    assertCommunityAuthToken(authToken)
    const result = await trackCommunityAction(`create-story:${storyId}`, createCommunityStory({
      storyId,
      mediaType: uploaded.mediaType,
      text,
      caption: text,
      mediaPath: uploaded.mediaPath,
      lifetimeHours,
      visibility,
      background: state.storyComposer.background,
      storyType: state.storyComposer.storyType || 'moment',
      layers: state.storyComposer.layers || [],
      remixOfStoryId: state.storyComposer.remixOfStoryId || '',
      remixPermission: state.storyComposer.remixPermission === true
    }))
    const story = normalizeCommunityStory({
      ...(result.story || {}),
      mediaURL: uploaded.mediaURL || result.story?.mediaURL || ''
    }, result.storyId)
    state.stories = [story, ...state.stories.filter((item) => item.storyId !== story.storyId)]
    scheduleCommunityStoryExpiry()
    resetStoryRecording()
    resetStoryPreviewURL()
    state.storyComposer = cleanStoryComposerState()
    state.message = 'Story published.'
    render()
    window.setTimeout(() => {
      state.message = ''
      render()
    }, 3000)
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] create story failed', { code: error?.code, message: error?.message, details: error?.details })
    state.storyComposer = { ...state.storyComposer, submitting: false, error: error?.message || 'Could not publish this story.' }
    render()
  }
}

// melogic-story-signal-foundation-push-02
const STORY_IMAGE_DURATION_MS = 5000
let storyViewerAdvanceTimer = 0
let storyViewerHoldTimer = 0
let storyViewerProgressFrame = 0
let storyViewerProgressStartedAt = 0
let storyViewerProgressElapsedMs = 0
let storyViewerProgressDurationMs = STORY_IMAGE_DURATION_MS
let storyViewerPointerDownAt = 0
let storyViewerPointerStartX = 0
let storyViewerPointerStartY = 0
let storyViewerHeld = false
let storyExpiryTimer = 0
let storyViewerTransitionTimer = 0
let storyViewerPlaybackBindings = null
let storySignalAbortController = null
let storyViewerSuspendedPosition = null
const storyViewerResourceOwner = createMonotonicRequestOwner()

// melogic-mobile-story-lookahead-v1
// Keep only the next two media assets warm on mobile. Detached media elements
// let the browser fetch/decode/buffer without duplicating the Story viewer DOM.
const STORY_MOBILE_LOOKAHEAD_COUNT = 2
const storyMediaLookahead = new Map()

function mobileStoryLookaheadEnabled() {
  return isMobileSpaRuntime() || window.matchMedia?.('(max-width: 760px)').matches
}

function nextStoriesForLookahead(count = STORY_MOBILE_LOOKAHEAD_COUNT) {
  const group = currentStoryGroup()
  if (!group) return []
  const groups = storyGroups()
  const groupIndex = groups.findIndex((item) => item.key === group.key)
  const storyIndex = currentStoryIndex()
  const next = []

  // Match advanceStory(1): finish this creator before moving to the next one.
  for (let index = storyIndex + 1; index < group.stories.length && next.length < count; index += 1) {
    next.push(group.stories[index])
  }
  for (let index = groupIndex + 1; index < groups.length && next.length < count; index += 1) {
    for (const story of groups[index].stories) {
      next.push(story)
      if (next.length >= count) break
    }
  }
  return next
}

function releaseStoryLookaheadEntry(entry) {
  const media = entry?.media
  if (!media) return
  if (media instanceof HTMLVideoElement) {
    media.pause()
    media.removeAttribute('src')
    try { media.load() } catch {}
  } else if (media instanceof HTMLImageElement) {
    media.src = ''
  }
}

function clearStoryMediaLookahead() {
  storyMediaLookahead.forEach(releaseStoryLookaheadEntry)
  storyMediaLookahead.clear()
}

function warmStoryMediaLookahead() {
  if (!state.storyViewer.open || !mobileStoryLookaheadEnabled()) {
    clearStoryMediaLookahead()
    return
  }
  const targets = nextStoriesForLookahead()
    .filter((story) => story?.mediaURL && (story.mediaType === 'image' || story.mediaType === 'video'))
  const keep = new Set(targets.map((story) => story.storyId))

  for (const [storyId, entry] of storyMediaLookahead) {
    if (keep.has(storyId)) continue
    releaseStoryLookaheadEntry(entry)
    storyMediaLookahead.delete(storyId)
  }

  targets.forEach((story, priority) => {
    const existing = storyMediaLookahead.get(story.storyId)
    if (existing?.url === story.mediaURL) return
    if (existing) releaseStoryLookaheadEntry(existing)

    if (story.mediaType === 'image') {
      const image = new Image()
      image.decoding = 'async'
      image.fetchPriority = priority === 0 ? 'high' : 'auto'
      image.src = story.mediaURL
      // decode() is opportunistic; a failed decode must never affect viewing.
      image.decode?.().catch(() => {})
      storyMediaLookahead.set(story.storyId, { media: image, url: story.mediaURL, type: 'image' })
      return
    }

    const video = document.createElement('video')
    video.preload = 'auto'
    video.muted = true
    video.defaultMuted = true
    video.playsInline = true
    video.disablePictureInPicture = true
    video.src = story.mediaURL
    video.load()
    storyMediaLookahead.set(story.storyId, { media: video, url: story.mediaURL, type: 'video' })
  })
}

const STORY_SIGNAL_BAR_COUNT = 36
const storySignalCache = new Map()
let storySignalAnalysisToken = 0

function storySignalFallback(storyId = '', count = STORY_SIGNAL_BAR_COUNT) {
  let seed = 2166136261
  for (const char of String(storyId)) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619)
  return Array.from({ length: count }, (_, index) => {
    seed = Math.imul(seed ^ (index + 1), 16777619)
    return 0.18 + ((seed >>> 0) % 64) / 100
  })
}

function applyStorySignalBars(values = []) {
  const bars = app?.querySelectorAll('.community-story-progress-rail > span.is-active .community-story-signal-bars > b')
  if (!bars?.length) return
  bars.forEach((bar, index) => {
    const value = Math.max(.12, Math.min(1, Number(values[index]) || .18))
    bar.style.setProperty('--signal-height', `${Math.round(value * 100)}%`)
  })
}

async function analyzeStorySignal(story = {}, video = null) {
  if (!story?.storyId || story.mediaType !== 'video' || !story.mediaURL) return
  const cached = storySignalCache.get(story.storyId)
  if (cached) { applyStorySignalBars(cached); return }
  const token = ++storySignalAnalysisToken
  storySignalAbortController?.abort()
  storySignalAbortController = new AbortController()
  const signal = storySignalAbortController.signal
  try {
    const response = await fetch(story.mediaURL, { mode: 'cors', credentials: 'omit', signal })
    if (!response.ok) throw new Error('Story media unavailable for signal analysis.')
    const buffer = await response.arrayBuffer()
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext
    if (!AudioContextCtor) throw new Error('Web Audio unavailable.')
    const audioContext = new AudioContextCtor()
    try {
      const audio = await audioContext.decodeAudioData(buffer.slice(0))
      const channels = Array.from({ length: audio.numberOfChannels }, (_, index) => audio.getChannelData(index))
      const samplesPerBar = Math.max(1, Math.floor(audio.length / STORY_SIGNAL_BAR_COUNT))
      const values = Array.from({ length: STORY_SIGNAL_BAR_COUNT }, (_, barIndex) => {
        const start = barIndex * samplesPerBar
        const end = barIndex === STORY_SIGNAL_BAR_COUNT - 1 ? audio.length : Math.min(audio.length, start + samplesPerBar)
        let sum = 0
        let peak = 0
        let sampled = 0
        const stride = Math.max(1, Math.floor((end - start) / 900))
        for (let i = start; i < end; i += stride) {
          let sample = 0
          for (const channel of channels) sample += Math.abs(channel[i] || 0)
          sample /= Math.max(1, channels.length)
          sum += sample * sample
          peak = Math.max(peak, sample)
          sampled += 1
        }
        const rms = Math.sqrt(sum / Math.max(1, sampled))
        return Math.max(rms * 2.8, peak * .72)
      })
      const max = Math.max(...values, .001)
      const normalized = values.map((value) => .14 + .86 * Math.pow(Math.min(1, value / max), .72))
      if (signal.aborted || token !== storySignalAnalysisToken) return
      storySignalCache.set(story.storyId, normalized)
      if (state.storyViewer.open && state.storyViewer.storyId === story.storyId) applyStorySignalBars(normalized)
    } finally {
      audioContext.close().catch(() => {})
    }
  } catch (error) {
    if (error?.name === 'AbortError' || signal.aborted) return
    console.debug('[community] Story Signal audio analysis unavailable; using deterministic fallback.', { message: error?.message })
  } finally {
    if (storySignalAbortController?.signal === signal) storySignalAbortController = null
  }
}

function clearStoryViewerAdvanceTimer() {
  if (storyViewerAdvanceTimer) window.clearTimeout(storyViewerAdvanceTimer)
  storyViewerAdvanceTimer = 0
}

function clearStoryViewerProgressFrame() {
  if (storyViewerProgressFrame) window.cancelAnimationFrame(storyViewerProgressFrame)
  storyViewerProgressFrame = 0
}

function activeStoryProgressElement() {
  return app?.querySelector('.community-story-viewer .community-story-progress-rail > span.is-active > i') || null
}

function setStorySignalProgress(progress = 0) {
  const fill = activeStoryProgressElement()
  if (!fill) return
  const normalized = Math.max(0, Math.min(1, Number(progress) || 0))
  fill.style.setProperty('--story-signal-progress', String(normalized))
  fill.style.transform = `scaleX(${normalized})`
}

function storyViewerMedia() {
  return app?.querySelector('.community-story-viewer .community-story-surface video') || null
}

function suspendStoryViewerResources({ releaseMedia = true } = {}) {
  storyViewerResourceOwner.invalidate()
  const video = storyViewerMedia()
  if (video) {
    storyViewerSuspendedPosition = {
      storyId: state.storyViewer.storyId,
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      progressElapsedMs: storyViewerProgressElapsedMs
    }
  }
  suspendCommunityMediaResources({
    media: [video],
    abortControllers: [storyViewerPlaybackBindings, storySignalAbortController],
    timeoutIds: [storyViewerAdvanceTimer, storyViewerHoldTimer, storyViewerTransitionTimer],
    animationFrameIds: [storyViewerProgressFrame],
    clearTimeoutFn: window.clearTimeout.bind(window),
    cancelAnimationFrameFn: window.cancelAnimationFrame.bind(window),
    releaseMedia
  })
  storyViewerPlaybackBindings = null
  storySignalAbortController = null
  storySignalAnalysisToken += 1
  storyViewerAdvanceTimer = 0
  storyViewerHoldTimer = 0
  storyViewerTransitionTimer = 0
  storyViewerProgressFrame = 0
  clearStoryMediaLookahead()
}

function resumeStoryViewerResources() {
  if (!state.storyViewer.open) return
  const story = storyById(state.storyViewer.storyId)
  const video = storyViewerMedia()
  if (story?.mediaType === 'video' && video && !video.getAttribute('src') && story.mediaURL) {
    video.src = story.mediaURL
    const suspended = storyViewerSuspendedPosition?.storyId === story.storyId ? storyViewerSuspendedPosition : null
    if (suspended?.currentTime) {
      video.addEventListener('loadedmetadata', () => {
        video.currentTime = Math.min(suspended.currentTime, Math.max(0, Number(video.duration || 0) - .01))
      }, { once: true })
    }
    video.load()
  }
  bindStoryViewerPlayback({ preservePosition: true })
  warmStoryMediaLookahead()
}

function runImageStorySignal() {
  clearStoryViewerProgressFrame()
  const tick = (now) => {
    if (!state.storyViewer.open || app?.querySelector('.community-story-viewer')?.classList.contains('is-paused')) return
    if (!storyViewerProgressStartedAt) storyViewerProgressStartedAt = now
    const elapsed = storyViewerProgressElapsedMs + (now - storyViewerProgressStartedAt)
    const progress = elapsed / storyViewerProgressDurationMs
    setStorySignalProgress(progress)
    if (progress >= 1) {
      storyViewerProgressElapsedMs = storyViewerProgressDurationMs
      storyViewerProgressStartedAt = 0
      advanceStory(1)
      return
    }
    storyViewerProgressFrame = window.requestAnimationFrame(tick)
  }
  storyViewerProgressFrame = window.requestAnimationFrame(tick)
}

function pauseStoryViewerPlayback() {
  clearStoryViewerAdvanceTimer()
  clearStoryViewerProgressFrame()
  if (storyViewerProgressStartedAt) {
    storyViewerProgressElapsedMs += performance.now() - storyViewerProgressStartedAt
    storyViewerProgressStartedAt = 0
  }
  const video = storyViewerMedia()
  if (video && !video.paused) video.pause()
  app?.querySelector('.community-story-viewer')?.classList.add('is-paused')
}

function resumeStoryViewerPlayback() {
  app?.querySelector('.community-story-viewer')?.classList.remove('is-paused')
  const story = storyById(state.storyViewer.storyId)
  if (!story) return
  const video = storyViewerMedia()
  if (story.mediaType === 'video' && video) {
    video.play().catch(() => {})
    return
  }
  storyViewerProgressStartedAt = 0
  runImageStorySignal()
}

function closeStoryViewer() {
  suspendStoryViewerResources({ releaseMedia: true })
  storyViewerSuspendedPosition = null
  state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
  render()
}

function scheduleStoryViewerAdvance(delay = STORY_IMAGE_DURATION_MS) {
  // Compatibility shim for callers outside the viewer. The Story Signal owns
  // viewer advancement now rather than an independent CSS/timer clock.
  storyViewerProgressDurationMs = Math.max(250, Number(delay) || STORY_IMAGE_DURATION_MS)
  storyViewerProgressElapsedMs = 0
  storyViewerProgressStartedAt = 0
  setStorySignalProgress(0)
  runImageStorySignal()
}

function bindStoryViewerPlayback({ preservePosition = false } = {}) {
  clearStoryViewerAdvanceTimer()
  clearStoryViewerProgressFrame()
  storyViewerPlaybackBindings?.abort()
  storyViewerPlaybackBindings = new AbortController()
  const signal = storyViewerPlaybackBindings.signal
  const resourceToken = storyViewerResourceOwner.next()
  const viewer = app?.querySelector('.community-story-viewer')
  if (!viewer || !state.storyViewer.open) return
  const story = storyById(state.storyViewer.storyId)
  const video = storyViewerMedia()
  storyViewerProgressElapsedMs = preservePosition && storyViewerSuspendedPosition?.storyId === story?.storyId
    ? storyViewerSuspendedPosition.progressElapsedMs
    : 0
  storyViewerProgressStartedAt = 0
  storyViewerProgressDurationMs = STORY_IMAGE_DURATION_MS
  setStorySignalProgress(0)

  if (story?.mediaType === 'video' && video) {
    video.loop = false
    video.muted = false
    analyzeStorySignal(story, video)
    const syncVideoSignal = () => {
      const duration = Number(video.duration)
      const currentTime = Number(video.currentTime)
      if (!Number.isFinite(duration) || duration <= 0) return
      storyViewerProgressDurationMs = duration * 1000
      setStorySignalProgress(Number.isFinite(currentTime) ? currentTime / duration : 0)
    }
    const play = () => video.play().catch(() => {
      video.muted = true
      return video.play().catch(() => {})
    })
    if (video.readyState >= 1) syncVideoSignal()
    else video.addEventListener('loadedmetadata', syncVideoSignal, { once: true, signal })
    video.addEventListener('durationchange', syncVideoSignal, { signal })
    video.addEventListener('timeupdate', syncVideoSignal, { signal })
    video.addEventListener('seeking', syncVideoSignal, { signal })
    video.addEventListener('play', syncVideoSignal, { signal })
    video.addEventListener('pause', syncVideoSignal, { signal })
    if (video.readyState >= 2) play()
    else video.addEventListener('canplay', play, { once: true, signal })
    video.addEventListener('ended', () => {
      setStorySignalProgress(1)
      advanceStory(1)
    }, { once: true, signal })
  } else {
    scheduleStoryViewerAdvance(STORY_IMAGE_DURATION_MS)
  }

  viewer.querySelectorAll('.community-story-progress-rail > span.is-active .community-story-signal-bars > b').forEach((bar) => {
    bar.addEventListener('pointerdown', (event) => event.stopPropagation(), { signal })
    bar.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (!video || !Number.isFinite(video.duration) || video.duration <= 0) return
      const index = Number(bar.getAttribute('data-story-signal-index') || 0)
      const target = Math.max(0, Math.min(video.duration - .01, ((index + .5) / STORY_SIGNAL_BAR_COUNT) * video.duration))
      video.currentTime = target
      setStorySignalProgress(target / video.duration)
    }, { signal })
  })

    const surface = viewer.querySelector('.community-story-surface')
  if (!surface) return
  surface.addEventListener('pointerdown', (event) => {
    if (event.button != null && event.button !== 0) return
    storyViewerPointerDownAt = performance.now()
    storyViewerPointerStartX = event.clientX
    storyViewerPointerStartY = event.clientY
    storyViewerHeld = false
    if (storyViewerHoldTimer) window.clearTimeout(storyViewerHoldTimer)
    storyViewerHoldTimer = window.setTimeout(() => {
      storyViewerHeld = true
      pauseStoryViewerPlayback()
    }, 220)
  }, { signal })
  const finishPointer = (event) => {
    if (storyViewerHoldTimer) window.clearTimeout(storyViewerHoldTimer)
    storyViewerHoldTimer = 0
    const wasHeld = storyViewerHeld
    if (wasHeld) {
      storyViewerHeld = false
      resumeStoryViewerPlayback()
      return
    }
    const dx = event.clientX - storyViewerPointerStartX
    const dy = event.clientY - storyViewerPointerStartY
    if (Math.abs(dy) > 90 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      closeStoryViewer()
      return
    }
    if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.2) {
      advanceStory(dx < 0 ? 1 : -1)
      return
    }
    if (performance.now() - storyViewerPointerDownAt < 350) {
      const rect = surface.getBoundingClientRect()
      const localX = event.clientX - rect.left
      advanceStory(localX < rect.width * .35 ? -1 : 1)
    }
  }
  surface.addEventListener('pointerup', finishPointer, { signal })
  surface.addEventListener('pointercancel', () => {
    if (storyViewerHoldTimer) window.clearTimeout(storyViewerHoldTimer)
    storyViewerHoldTimer = 0
    if (storyViewerHeld) resumeStoryViewerPlayback()
    storyViewerHeld = false
  }, { signal })
  if (!storyViewerResourceOwner.isCurrent(resourceToken)) storyViewerPlaybackBindings?.abort()
}

async function shareStoryFromViewer(storyId = '') {
  const story = storyById(storyId)
  if (!story) return
  const url = new URL(window.location.href)
  url.searchParams.set('story', storyId)
  const shareData = {
    title: story.authorName ? `${story.authorName}'s Story on Melogic` : 'Story on Melogic',
    text: story.caption || story.text || 'View this Story on Melogic.',
    url: url.toString()
  }
  try {
    if (navigator.share) {
      await navigator.share(shareData)
      return
    }
    await navigator.clipboard?.writeText(shareData.url)
    showCommunityToast('Story link copied.')
  } catch (error) {
    if (error?.name !== 'AbortError') {
      console.warn('[community] story share failed', { name: error?.name, message: error?.message })
      showCommunityToast('Could not share this Story.')
    }
  }
}

function openStoryViewer(storyId = '') {
  const story = storyById(storyId)
  if (!story) return
  const alreadyOpen = state.storyViewer.open && state.storyViewer.storyId === storyId
  state.storyViewer = { open: true, storyId, loading: false, error: '' }
  if (!alreadyOpen) render()
  // Start warming the exact next two Story media assets after the active Story
  // has rendered. This never blocks current playback.
  if (!alreadyOpen) window.requestAnimationFrame(() => warmStoryMediaLookahead())
  if (!state.currentUser?.uid || recordedStoryViews.has(storyId)) return
  const authToken = communityAuthScope.current()
  recordedStoryViews.add(storyId)
  recordCommunityStoryView(storyId).then((result) => {
    if (!communityAuthScope.isCurrent(authToken)) return
    if (Number.isFinite(Number(result.viewCount))) {
      state.stories = state.stories.map((item) => item.storyId === storyId ? { ...item, viewCount: Number(result.viewCount) } : item)
    }
  }).catch((error) => {
    if (!communityAuthScope.isCurrent(authToken)) return
    console.warn('[community] story view count failed', { code: error?.code, message: error?.message, details: error?.details })
    recordedStoryViews.delete(storyId)
  })
}

function animateToStory(storyId = '', delta = 1) {
  const viewer = app?.querySelector('.community-story-viewer')
  if (!viewer) {
    openStoryViewer(storyId)
    return
  }
  clearStoryViewerAdvanceTimer()
  viewer.classList.remove('is-shifting-left', 'is-shifting-right')
  viewer.classList.add('is-creator-transition', delta > 0 ? 'is-shifting-left' : 'is-shifting-right')
  if (storyViewerTransitionTimer) window.clearTimeout(storyViewerTransitionTimer)
  storyViewerTransitionTimer = window.setTimeout(() => {
    storyViewerTransitionTimer = 0
    openStoryViewer(storyId)
  }, 260)
}

function advanceStory(delta = 1) {
  if (!state.stories.length) return
  clearStoryViewerAdvanceTimer()
  const group = currentStoryGroup()
  if (!group) return closeStoryViewer()
  const index = currentStoryIndex()
  const withinGroupIndex = index + delta

  // Continue through this creator's own Story sequence first.
  if (withinGroupIndex >= 0 && withinGroupIndex < group.stories.length) {
    openStoryViewer(group.stories[withinGroupIndex].storyId)
    return
  }

  // Creator exhausted: transition the entire viewer to the adjacent creator.
  const groups = storyGroups()
  const groupIndex = groups.findIndex((item) => item.key === group.key)
  const nextGroupIndex = groupIndex + (delta > 0 ? 1 : -1)
  if (nextGroupIndex < 0 || nextGroupIndex >= groups.length) {
    closeStoryViewer()
    return
  }
  const nextGroup = groups[nextGroupIndex]
  const targetStory = delta > 0 ? nextGroup.stories[0] : nextGroup.stories[nextGroup.stories.length - 1]
  animateToStory(targetStory.storyId, delta)
}

async function handleStoryDelete(storyId = '') {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const story = storyById(storyId)
  if (!story || story.authorUid !== state.currentUser.uid) return
  state.storyViewer = { ...state.storyViewer, error: '' }
  render()
  try {
    await trackCommunityAction(`delete-story:${storyId}`, deleteCommunityStory({ storyId }))
    state.stories = state.stories.filter((item) => item.storyId !== storyId)
    scheduleCommunityStoryExpiry()
    state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
    state.message = 'Story deleted.'
    render()
    window.setTimeout(() => {
      state.message = ''
      render()
    }, 3000)
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] delete story failed', { code: error?.code, message: error?.message, details: error?.details })
    state.storyViewer = { ...state.storyViewer, error: error?.message || 'Could not delete this story.' }
    render()
  }
}

function openReport(postId) {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.openPostMenuId = ''
  state.report = { open: true, targetType: 'community_post', postId, commentId: '', storyId: '', reason: REPORT_REASONS[0], description: '', submitting: false, error: '', message: '' }
  render()
}

function openCommentReport(commentId, postId = state.detailPostId) {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.report = { open: true, targetType: 'community_comment', postId, commentId, storyId: '', reason: REPORT_REASONS[0], description: '', submitting: false, error: '', message: '' }
  render()
}

function openStoryReport(storyId = '') {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.report = { open: true, targetType: 'community_story', postId: '', commentId: '', storyId, reason: REPORT_REASONS[0], description: '', submitting: false, error: '', message: '' }
  render()
}

async function handleReportSubmit(event) {
  event.preventDefault()
  const formData = new FormData(event.currentTarget)
  const post = state.posts.find((item) => item.postId === state.report.postId)
  const comment = findCommentForPost(state.report.postId, state.report.commentId)
  const story = storyById(state.report.storyId)
  const reason = String(formData.get('reason') || '').trim()
  const description = String(formData.get('description') || '').trim()
  if (state.report.targetType !== 'community_story' && !post) return
  if (state.report.targetType === 'community_comment' && !comment) return
  if (state.report.targetType === 'community_story' && !story) return
  if (reason === 'Other' && !description) {
    state.report.error = 'Description is required when reason is Other.'
    render()
    return
  }
  state.report = { ...state.report, reason, description, submitting: true, error: '' }
  render()
  try {
    const targetType = state.report.targetType === 'community_comment'
      ? 'community_comment'
      : state.report.targetType === 'community_story'
        ? 'community_story'
        : 'community_post'
    await trackCommunityAction(`report:${targetType}:${targetType === 'community_comment' ? comment.commentId : targetType === 'community_story' ? story.storyId : post.postId}`, createReport({
      targetType,
      targetId: targetType === 'community_comment' ? comment.commentId : targetType === 'community_story' ? story.storyId : post.postId,
      targetOwnerUid: targetType === 'community_comment' ? comment.authorUid : targetType === 'community_story' ? story.authorUid : post.authorUid,
      reason,
      description,
      sourcePath: targetType === 'community_comment' ? communityPostRoute(post.postId) : window.location.pathname,
      metadata: targetType === 'community_comment'
        ? { postId: post.postId, commentId: comment.commentId }
        : targetType === 'community_story'
          ? { storyId: story.storyId, mediaType: story.mediaType }
          : { postTitle: post.title, postType: post.type }
    }))
    state.report = { ...state.report, submitting: false, message: 'Thank you. Your report has been submitted.' }
    render()
  } catch (error) {
    if (isCommunityAuthScopeError(error)) return
    console.warn('[community] report failed', { code: error?.code, message: error?.message, details: error?.details })
    state.report = { ...state.report, submitting: false, error: error?.message || 'Could not submit this report.' }
    render()
  }
}

function bindCommentOptionTriggers(root = app) {
  if (!root) return
  root.querySelectorAll('[data-toggle-comment-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      toggleCommentMenuDom(
        button.getAttribute('data-comment-post-id') || '',
        button.getAttribute('data-toggle-comment-menu') || ''
      )
    })
  })
  bindCommentMenuEvents(root)
}

function bindCommentEvents(root = app) {
  if (!root) return
  bindCommentOptionTriggers(root)
  root.querySelectorAll('[data-add-comment-attachment]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    const type = button.getAttribute('data-add-comment-attachment') || ''
    const parentCommentId = button.getAttribute('data-comment-parent-id') || ''
    root.querySelector(`[data-comment-attachment-input="${communityCssEscape(type)}"][data-comment-parent-id="${communityCssEscape(parentCommentId)}"]`)?.click()
  }))
  root.querySelectorAll('[data-comment-attachment-input]').forEach((input) => input.addEventListener('change', () => {
    addCommentAttachmentFiles(input.getAttribute('data-comment-parent-id') || '', input.files || [])
  }))
  root.querySelectorAll('[data-remove-comment-attachment]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    removeCommentAttachment(
      button.getAttribute('data-comment-parent-id') || '',
      button.getAttribute('data-remove-comment-attachment') || ''
    )
  }))
  root.querySelector('[data-community-comment-form]')?.addEventListener('submit', handleCommentSubmit)
  root.querySelector('[data-load-more-comments]')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    loadComments({ append: true, renderAfter: true })
  })
  root.querySelectorAll('[data-community-reply-form]').forEach((form) => {
    form.addEventListener('submit', (event) => handleReplySubmit(event, form.getAttribute('data-community-reply-form') || ''))
  })
  root.querySelectorAll('[data-toggle-comment-replies]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const parentCommentId = button.getAttribute('data-toggle-comment-replies') || ''
    const page = repliesPageFor(parentCommentId)
    const nextExpanded = !page.expanded
    page.expanded = nextExpanded
    state.commentActionError = ''
    syncActiveCommentState()
    if (nextExpanded && !page.loaded && !page.loading) {
      loadReplies(parentCommentId, { append: false, renderAfter: true })
      return
    }
    renderCommentState()
  }))
  root.querySelectorAll('[data-load-more-comment-replies]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    loadReplies(button.getAttribute('data-load-more-comment-replies') || '', { append: true, renderAfter: true })
  }))
  root.querySelectorAll('[data-toggle-reply-composer]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    state.replyComposerFor = button.getAttribute('data-toggle-reply-composer') || ''
    state.commentActionError = ''
    renderCommentState()
  }))
  root.querySelectorAll('[data-cancel-reply-composer]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const parentCommentId = button.getAttribute('data-cancel-reply-composer') || ''
    state.replyComposerFor = state.replyComposerFor === parentCommentId ? '' : state.replyComposerFor
    renderCommentState()
  }))
  root.querySelectorAll('[data-community-comment-like]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleCommentLike(button.getAttribute('data-community-comment-like'))
  }))
  root.querySelectorAll('[data-community-comment-dislike]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleCommentDislike(button.getAttribute('data-community-comment-dislike'))
  }))
}

function bindFeedRegionEvents(root = app) {
  if (!root) return
  bindCommunityImageReliability(root)
  root.querySelectorAll('.community-post-card:not(.is-detail) .community-post-actions a[href$="#comments"]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const postId = link.closest('.community-post-card')?.getAttribute('data-post-id') || ''
      openPostDetail(postId, '#comments')
    })
  })
  /* melogic-community-image-detail-first-v1 */
  root.querySelectorAll('[data-open-community-image]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      const postCard = button.closest('.community-post-card[data-post-id]')
      const isPostDetail = Boolean(postCard?.classList.contains('is-detail') || state.view.type === 'post')
      if (postCard && !isPostDetail) {
        openPostDetail(postCard.getAttribute('data-post-id') || '')
        return
      }
      openCommunityImageViewer(
        button.getAttribute('data-open-community-image') || '',
        button.getAttribute('data-community-image-name') || ''
      )
    })
  })
  root.querySelectorAll('.community-post-card[data-post-id]:not(.is-detail)').forEach((card) => {
    if (!card.dataset.pointerHoverBound) {
      card.dataset.pointerHoverBound = 'true'
      card.addEventListener('pointermove', (event) => {
        if (event.pointerType === 'touch') return
        setFeedPostPointerHover(card)
      })
      card.addEventListener('pointerleave', () => clearFeedPostPointerHoverForCard(card))
    }
    card.addEventListener('click', (event) => {
      if (isPostCardInteractiveTarget(event.target)) return
      openPostDetail(card.getAttribute('data-post-id') || '')
    })
    card.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      if (isPostCardInteractiveTarget(event.target)) return
      event.preventDefault()
      openPostDetail(card.getAttribute('data-post-id') || '')
    })
  })
  root.querySelectorAll('.community-post-card a, .community-post-card button, .community-post-card input, .community-post-card textarea, .community-post-card select, .community-post-card label').forEach((element) => {
    element.addEventListener('click', (event) => event.stopPropagation())
  })
  root.querySelectorAll('[data-toggle-post-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      togglePostMenuDom(button.getAttribute('data-toggle-post-menu') || '')
    })
  })
  root.querySelectorAll('[data-copy-post-link]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      copyPostLink(button.getAttribute('data-copy-post-link') || '')
    })
  })
  root.querySelectorAll('[data-community-tag]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      selectTagFilter(button.getAttribute('data-community-tag') || '')
    })
  })
  root.querySelector('[data-load-more-posts]')?.addEventListener('click', () => loadFeedPage({ reset: false, localOnly: true }))
  root.querySelectorAll('[data-open-community-composer]').forEach((button) => button.addEventListener('click', openCommunityComposer))
  root.querySelector('[data-reload-community]')?.addEventListener('click', () => loadFeedPage({ reset: true, localOnly: true }))
  root.querySelectorAll('[data-community-like]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleLike(button.getAttribute('data-community-like'))
  }))
  root.querySelectorAll('[data-community-dislike]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleDislike(button.getAttribute('data-community-dislike'))
  }))
  root.querySelectorAll('[data-community-save]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleSave(button.getAttribute('data-community-save'))
  }))
  root.querySelectorAll('[data-community-share]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleShare(button.getAttribute('data-community-share'))
  }))
  root.querySelectorAll('[data-scroll-comments]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    app.querySelector('#comments')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }))
  root.querySelectorAll('[data-community-report]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    openReport(button.getAttribute('data-community-report'))
  }))
  root.querySelectorAll('[data-community-delete-post]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleDeleteOwnPost(button.getAttribute('data-community-delete-post') || '')
  }))
  root.querySelectorAll('[data-community-edit-post]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    openEditPost(button.getAttribute('data-community-edit-post') || '')
  }))
  bindCommentEvents(root)
}

// melogic-mobile-community-destination-debounce-v5f
let communityDestinationSearchTimer = 0

function updateMobileCommunityDestinationListDom(root = app) {
  const scroll = root?.querySelector('[data-community-destination-scroll]')
  if (!scroll || state.composer.destinationLoading || state.composer.destinationError) return
  const matches = composerDestinationMatches()
  const visible = matches.slice(0, Math.max(10, Number(state.composer.destinationVisibleCount || 10)))
  const generalMatches = !state.composer.destinationSearch
    || 'general feed'.includes(String(state.composer.destinationSearch || '').trim().toLowerCase())
  scroll.innerHTML = `
    ${generalMatches ? `
      <button type="button" class="community-mobile-destination-row ${state.composer.communityId ? '' : 'is-selected'}" data-select-community-destination="">
        <span class="community-destination-avatar is-general">${iconSvg('home')}</span>
        <span><strong>General</strong><small>Main Melogic Community feed</small></span>
        <span class="community-mobile-destination-trailing">${state.composer.communityId ? iconSvg('chevronRight') : iconSvg('checkCircle')}</span>
      </button>` : ''}
    ${visible.map((community) => `
      <button type="button" class="community-mobile-destination-row ${state.composer.communityId === community.communityId ? 'is-selected' : ''}" data-select-community-destination="${escapeHtml(community.communityId)}">
        ${renderCommunityDestinationAvatar(community)}
        <span><strong>${escapeHtml(community.name)}</strong><small>${escapeHtml([`c/${community.slug || ''}`, community.category || '', `${formatCount(community.focusCount || community.followerCount)} focused`].filter(Boolean).join(' · '))}</small></span>
        <span class="community-mobile-destination-trailing">${state.composer.communityId === community.communityId ? iconSvg('checkCircle') : iconSvg('chevronRight')}</span>
      </button>`).join('')}
    ${!generalMatches && !visible.length ? `<div class="community-mobile-destination-state"><strong>No communities found</strong><small>Try another search.</small></div>` : ''}
    ${visible.length < matches.length ? `<div class="community-mobile-destination-sentinel" aria-hidden="true"></div>` : ''}
  `
  bindCommunityDestinationResultEvents(scroll)
}

// melogic-mobile-community-keyboard-toolbar-v7
let communityComposerVisualViewportReady = false

function syncCommunityComposerToVisualViewport() {
  const screen = app?.querySelector('[data-community-mobile-composer-screen]')
  if (!(screen instanceof HTMLElement)) return
  const viewport = window.visualViewport
  if (!viewport) {
    screen.style.removeProperty('--community-visual-viewport-top')
    screen.style.removeProperty('--community-visual-viewport-height')
    return
  }
  screen.style.setProperty('--community-visual-viewport-top', `${Math.max(0, viewport.offsetTop)}px`)
  screen.style.setProperty('--community-visual-viewport-height', `${Math.max(1, viewport.height)}px`)
  // melogic-mobile-community-keyboard-underlay-v7b
  document.documentElement.classList.add('community-mobile-composer-visual-underlay')
  document.body.classList.add('community-mobile-composer-visual-underlay')
}

function ensureCommunityComposerVisualViewportTracking() {
  if (communityComposerVisualViewportReady || !window.visualViewport) return
  communityComposerVisualViewportReady = true
  const sync = () => window.requestAnimationFrame(syncCommunityComposerToVisualViewport)
  window.visualViewport.addEventListener('resize', sync, { passive: true })
  window.visualViewport.addEventListener('scroll', sync, { passive: true })
}

function bindCommunityComposerEvents(root = app) {
  root?.querySelectorAll('[data-close-community-composer]').forEach((button) => button.addEventListener('click', closeCommunityComposer))
  root?.querySelector('[data-open-community-destination]')?.addEventListener('click', openCommunityDestinationPicker)
  root?.querySelectorAll('[data-close-community-destination]').forEach((button) => button.addEventListener('click', closeCommunityDestinationPicker))
  root?.querySelector('[data-community-destination-backdrop]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeCommunityDestinationPicker()
  })
  root?.querySelector('[data-community-destination-search]')?.addEventListener('input', (event) => {
    const value = String(event.target.value || '').slice(0, 80)
    state.composer.destinationSearchDraft = value
    window.clearTimeout(communityDestinationSearchTimer)
    communityDestinationSearchTimer = window.setTimeout(() => {
      state.composer.destinationSearch = state.composer.destinationSearchDraft
      state.composer.destinationVisibleCount = 10
      if (useNativeMobileCommunityComposer()) updateMobileCommunityDestinationListDom(root)
      else updateCommunityDestinationResultsDom()
    }, 500)
  })
  bindCommunityDestinationResultEvents(root)
  const destinationScroll = root?.querySelector('[data-community-destination-scroll]')
  destinationScroll?.addEventListener('scroll', () => {
    if (destinationScroll.scrollTop + destinationScroll.clientHeight < destinationScroll.scrollHeight - 180) return
    const total = composerDestinationMatches().length
    const current = Math.max(10, Number(state.composer.destinationVisibleCount || 10))
    if (current >= total) return
    state.composer.destinationVisibleCount = Math.min(total, current + 10)
    updateCommunityComposerLayer()
  }, { passive: true })
  root?.querySelector('[data-community-composer-form]')?.addEventListener('submit', handleComposerSubmit)
  root?.querySelector('[data-community-composer-form]')?.addEventListener('input', (event) => {
    updateComposerFromForm()
    if (!useNativeMobileCommunityComposer()) return
    const form = event.currentTarget
    const post = form?.querySelector('.community-mobile-composer-post')
    const count = form?.querySelector('.community-mobile-composer-count')
    if (post instanceof HTMLButtonElement) post.disabled = !String(state.composer.body || '').trim() || state.composer.submitting
    if (count instanceof HTMLElement) count.textContent = String(Math.max(0, 2000 - state.composer.body.length))
  })
  root?.querySelector('[data-open-product-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openProductPicker()
  })
  root?.querySelector('[data-open-music-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openMusicPicker()
  })
  root?.querySelector('[data-open-stage-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openStagePicker()
  })
  root?.querySelector('[data-open-studio-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openStudioPicker()
  })
  root?.querySelectorAll('[data-open-post-attachment-picker]').forEach((button) => button.addEventListener('click', () => {
    updateComposerFromForm()
    root.querySelector('[data-post-attachment-input]')?.click()
  }))
  root?.querySelector('[data-mobile-composer-more-actions]')?.addEventListener('click', () => {
    updateComposerFromForm()
    const sheet = root.querySelector('[data-mobile-composer-more-sheet]')
    if (sheet) sheet.hidden = !sheet.hidden
  })
  root?.querySelector('[data-mobile-composer-more-sheet]')?.addEventListener('click', (event) => {
    if (event.target.closest('button')) event.currentTarget.hidden = true
  })
  root?.querySelector('[data-post-attachment-input]')?.addEventListener('change', async (event) => {
    await addComposerFiles(event.target.files)
  })
  root?.querySelector('[data-close-product-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, productPickerOpen: false, productPickerError: '' }
    updateCommunityComposerLayer()
  })
  root?.querySelector('[data-close-music-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, musicPickerOpen: false, musicPickerError: '' }
    updateCommunityComposerLayer()
  })
  root?.querySelector('[data-close-stage-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, stagePickerOpen: false, stagePickerError: '' }
    updateCommunityComposerLayer()
  })
  root?.querySelector('[data-close-studio-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, studioPickerOpen: false, studioPickerError: '' }
    updateCommunityComposerLayer()
  })
  root?.querySelectorAll('[data-select-composer-product]').forEach((button) => button.addEventListener('click', () => selectComposerProduct(button.getAttribute('data-select-composer-product') || '')))
  root?.querySelectorAll('[data-select-composer-music]').forEach((button) => button.addEventListener('click', () => selectComposerMusic(button.getAttribute('data-select-composer-music') || '')))
  root?.querySelectorAll('[data-select-composer-stage]').forEach((button) => button.addEventListener('click', () => selectComposerStage(button.getAttribute('data-select-composer-stage') || '')))
  root?.querySelectorAll('[data-select-composer-studio]').forEach((button) => button.addEventListener('click', () => selectComposerStudio(button.getAttribute('data-select-composer-studio') || '')))
  root?.querySelectorAll('[data-remove-composer-attachment]').forEach((button) => button.addEventListener('click', () => removeComposerAttachment(button.getAttribute('data-remove-composer-attachment') || '')))
  root?.querySelectorAll('[data-remove-composer-attachment-key]').forEach((button) => button.addEventListener('click', () => removeComposerAttachmentByKey(button.getAttribute('data-remove-composer-attachment-key') || '')))
  root?.querySelectorAll('[data-remove-composer-file]').forEach((button) => button.addEventListener('click', () => removeComposerFileAttachment(button.getAttribute('data-remove-composer-file') || '')))
  root?.querySelectorAll('[data-set-composer-intent]').forEach((button) => button.addEventListener('click', () => setComposerIntent(button.getAttribute('data-set-composer-intent') || '')))
  root?.querySelectorAll('[data-clear-composer-intent]').forEach((button) => button.addEventListener('click', clearComposerIntent))
  root?.querySelector('[data-toggle-emoji-panel]')?.addEventListener('click', () => {
    updateComposerFromForm()
    state.composer = { ...state.composer, emojiOpen: !state.composer.emojiOpen }
    updateCommunityComposerLayer()
  })
  root?.querySelectorAll('[data-insert-emoji]').forEach((button) => button.addEventListener('click', () => insertEmoji(button.getAttribute('data-insert-emoji') || '')))
  root?.querySelector('[data-mention-search]')?.addEventListener('input', (event) => queueMentionSearch(event.target.value))
  bindMentionPickerEvents(root)
}

function bindEvents() {
  setupCommunityPendingLeaveWarning()
  if (isMobileSpaRuntime() && state.view.type === 'communities') {
    const directoryMain = app.querySelector('.community-layout.is-directory > .community-main')
    directoryMain?.addEventListener('scroll', () => {
      if (!mobileDiscoverScrollRestorePending) mobileDiscoverScrollTop = directoryMain.scrollTop
    }, { passive: true })
  }
  app.querySelectorAll('[data-community-membership-action]').forEach((button) => {
    button.addEventListener('click', () => {
      handleCommunityMembership(
        button.getAttribute('data-community-membership-id') || '',
        button.getAttribute('data-community-membership-action') || 'join'
      )
    })
  })
  app.querySelectorAll('[data-community-workspace-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextTab = button.getAttribute('data-community-workspace-tab') || 'community-feed'
      if (!['community-feed', 'community-projects', 'community-people', 'community-opportunities', 'community-events'].includes(nextTab)) return
      state.activeTab = nextTab
      render()
    })
  })
  app.querySelectorAll('[data-community-back-to-feed]').forEach(link => {
    link.onclick = event => {
      if (!feedNavigationSnapshot) return
      event.preventDefault()
      window.history.back()
    }
  })
  bindFeedRegionEvents(app)
  bindCommunityDiscoveryWidgetEvents(app)
  bindCommunityHistoryEvents(app)
  if (!isMobileSpaRuntime() && !state.history.loaded && !state.history.loading) void loadCommunityHistory()
  setupCommunityOutsideClick()
  if (!isMobileSpaRuntime()) {
    app.querySelectorAll('[data-community-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        selectTopicTab(button.getAttribute('data-community-tab') || 'for-you')
      })
    })
  }
  app.querySelector('[data-community-feed-search]')?.addEventListener('submit', handleFeedSearch)
  app.querySelector('[data-community-feed-sort]')?.addEventListener('change', (event) => {
    state.feedSort = ['new', 'top-today', 'top-week', 'most-discussed'].includes(event.target.value) ? event.target.value : 'new'
    updateFeedUrlParams()
    loadCommunity()
  })
  app.querySelector('[data-clear-community-tag]')?.addEventListener('click', () => {
    state.activeTag = ''
    updateFeedUrlParams()
    loadCommunity()
  })
  app.querySelector('[data-clear-community-search]')?.addEventListener('click', () => {
    state.feedSearch = ''
    updateFeedUrlParams()
    loadCommunity()
  })
  app.querySelectorAll('[data-topic-community-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectTopicCommunity({
        communityId: button.getAttribute('data-topic-community-id') || ''
      })
    })
  })
  app.querySelector('[data-clear-community-filters]')?.addEventListener('click', () => {
    if (!state.selectedCommunityFilters.length) return
    state.selectedCommunityFilters = []
    app.querySelectorAll('[data-topic-community-id]').forEach((button) => {
      button.classList.remove('is-active')
      button.setAttribute('aria-pressed', 'false')
    })
    const allButton = app.querySelector('[data-clear-community-filters]')
    allButton?.classList.add('is-active')
    allButton?.setAttribute('aria-pressed', 'true')
    loadFeedPage({ reset: true, localOnly: true })
  })
  app.querySelectorAll('[data-topic-scroll]').forEach((button) => {
    button.addEventListener('click', () => {
      const scroller = app.querySelector('[data-community-topic-scroll]')
      if (!scroller) return
      const direction = Number(button.getAttribute('data-topic-scroll') || 1)
      scroller.scrollBy({ left: direction * Math.max(220, scroller.clientWidth * 0.65), behavior: 'smooth' })
      window.setTimeout(updateTopicArrowState, 260)
    })
  })
  app.querySelector('[data-community-topic-scroll]')?.addEventListener('scroll', updateTopicArrowState, { passive: true })
  app.querySelector('[data-community-stories-scroll]')?.addEventListener('scroll', updateCommunityRailFadeState, { passive: true })
  setupCommunityRailResize()
  updateTopicArrowState()
  updateCommunityRailFadeState()
  setupCommunityKeyboardShortcuts()
  setupFeedPaginationObserver()
  app.querySelectorAll('[data-close-community-composer]').forEach((button) => button.addEventListener('click', closeCommunityComposer))
  app.querySelector('[data-open-community-destination]')?.addEventListener('click', openCommunityDestinationPicker)
  app.querySelectorAll('[data-close-community-destination]').forEach((button) => button.addEventListener('click', closeCommunityDestinationPicker))
  app.querySelector('[data-community-destination-backdrop]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeCommunityDestinationPicker()
  })
  app.querySelector('[data-community-destination-search]')?.addEventListener('input', (event) => {
    state.composer.destinationSearch = String(event.target.value || '').slice(0, 80)
    updateCommunityDestinationResultsDom()
  })
  bindCommunityDestinationResultEvents(app)
  app.querySelectorAll('[data-open-story-composer]').forEach((button) => button.addEventListener('click', openStoryComposer))
  app.querySelectorAll('[data-community-nav-stub]').forEach((button) => {
    button.addEventListener('click', () => showCommunityToast(`${button.getAttribute('data-community-nav-stub')} is coming in a later community pass.`))
  })
  app.querySelectorAll('[data-story-media-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.storyComposer = {
        ...state.storyComposer,
        mediaType: button.getAttribute('data-story-media-type') === 'image' ? 'image' : 'text',
        error: ''
      }
      render()
    })
  })
  app.querySelectorAll('[data-story-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      updateStoryComposerFromForm()
      const mode = button.getAttribute('data-story-mode') === 'record' ? 'record' : 'upload'
      if (mode !== 'record') resetStoryRecording()
      state.storyComposer = {
        ...state.storyComposer,
        mode,
        mediaType: mode === 'record' ? 'video' : state.storyComposer.mediaType || 'video',
        error: ''
      }
      render()
      bindStoryRecordingPreview()
    })
  })
  app.querySelectorAll('[data-story-background]').forEach((button) => {
    button.addEventListener('click', () => {
      state.storyComposer = {
        ...state.storyComposer,
        background: button.getAttribute('data-story-background') || 'aurora',
        error: ''
      }
      render()
    })
  })
  app.querySelectorAll('[data-story-file]').forEach((input) => input.addEventListener('change', (event) => {
    updateStoryComposerFromForm()
    selectStoryFile(event.target.files?.[0] || null)
  }))
  app.querySelector('[data-remove-story-file]')?.addEventListener('click', removeStoryFile)
  app.querySelectorAll('[data-story-add-object]').forEach((button) => button.addEventListener('click', () => {
    const type = button.getAttribute('data-story-add-object') || ''
    const prompts = {
      person: ['Person', 'Enter a display name or @username:', 'Enter profile URL (optional):'],
      link: ['Open link', 'Enter a label for this link:', 'Enter the full URL:'],
      location: ['Location', 'Enter a location name:', 'Enter a map URL (optional):'],
      community: ['Community', 'Enter the Community name:', 'Enter the Community URL (optional):'],
      audio: ['Song', 'Enter the song or audio title:', 'Enter its Melogic or streaming URL:'],
      product: ['Product', 'Enter the product name:', 'Enter the product URL:'],
      event: ['Event', 'Enter the event name:', 'Enter the event URL (optional):'],
      poll: ['Poll', 'Enter the poll question:', 'Enter choices separated by commas:']
    }
    const nativeKind = button.getAttribute('data-story-native-kind') || ''
    const nativeConfig = {
      soura: ['Soura Project', 'Enter the Soura project name:', 'Enter the Soura project URL:'],
      vertix: ['Vertix Scene', 'Enter the Vertix scene name:', 'Enter the Vertix project URL:'],
      preset: ['Preset', 'Enter the preset name:', 'Enter its Melogic URL (optional):'],
      sample: ['Sample', 'Enter the sample name:', 'Enter its Melogic URL (optional):'],
      stage: ['Stage Plan', 'Enter the stage plan name:', 'Enter the Vertix/stage plan URL:']
    }
    const config = nativeKind ? nativeConfig[nativeKind] : prompts[type]
    if (!config) return
    const content = window.prompt(config[1], config[0])?.trim()
    if (!content) return
    let targetURL = window.prompt(config[2], '')?.trim() || ''
    let metadata = nativeKind ? { melogicKind: nativeKind, source: 'melogic' } : {}
    if (type === 'poll') {
      const options = targetURL.split(',').map((item) => item.trim()).filter(Boolean).slice(0, 6)
      if (options.length < 2) {
        showCommunityToast('Add at least two poll choices.')
        return
      }
      metadata = { options: options.join('|') }
      targetURL = ''
    }
    if (targetURL && !/^(https?:\/\/|\/)/i.test(targetURL)) {
      showCommunityToast('Use a full https:// URL or an internal / path.')
      return
    }
    const layers = [...(state.storyComposer.layers || [])]
    const id = `layer-${Date.now().toString(36)}`
    layers.push({ id, type, x: .5, y: .58, width: .48, height: .1, rotation: 0, scale: 1, opacity: 1, zIndex: layers.length + 1, startMs: 0, endMs: 0, content, targetId: '', targetURL, metadata })
    state.storyComposer = { ...state.storyComposer, layers, selectedLayerId: id }
    render()
  }))
  app.querySelectorAll('[data-story-type]').forEach((button) => button.addEventListener('click', () => {
    updateStoryComposerFromForm()
    state.storyComposer.storyType = button.getAttribute('data-story-type') || 'moment'
    render()
  }))
  app.querySelector('[data-story-remix-permission]')?.addEventListener('change', (event) => {
    state.storyComposer.remixPermission = event.currentTarget.checked === true
  })
  app.querySelector('[data-story-add-text-layer]')?.addEventListener('click', () => {
    const layers = [...(state.storyComposer.layers || [])]
    const id = `layer-${Date.now().toString(36)}`
    layers.push({ id, type: 'text', x: .5, y: .5, width: .42, height: .1, rotation: 0, scale: 1, opacity: 1, zIndex: layers.length + 1, startMs: 0, endMs: 0, content: 'Text', targetId: '', targetURL: '', metadata: {} })
    state.storyComposer = { ...state.storyComposer, layers, selectedLayerId: id }
    render()
  })
  app.querySelectorAll('[data-story-layer-id]').forEach((node) => {
    node.addEventListener('pointerdown', (event) => {
      event.stopPropagation()
      const id = node.getAttribute('data-story-layer-id') || ''
      state.storyComposer.selectedLayerId = id
      node.classList.add('is-selected')
      const canvas = app.querySelector('[data-story-layer-canvas]')
      const rect = canvas?.getBoundingClientRect()
      if (!rect) return
      const move = (moveEvent) => {
        const layer = (state.storyComposer.layers || []).find((item) => item.id === id)
        if (!layer) return
        layer.x = Math.max(0, Math.min(1, (moveEvent.clientX - rect.left) / rect.width))
        layer.y = Math.max(0, Math.min(1, (moveEvent.clientY - rect.top) / rect.height))
        node.style.setProperty('--layer-x', layer.x)
        node.style.setProperty('--layer-y', layer.y)
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up, { once: true })
    })
  })
  const mutateSelectedStoryLayer = (mutator) => {
    const layers = [...(state.storyComposer.layers || [])]
    const layer = layers.find((item) => item.id === state.storyComposer.selectedLayerId)
    if (!layer) return
    mutator(layer, layers)
    state.storyComposer = { ...state.storyComposer, layers }
    render()
  }
  app.querySelector('[data-story-layer-scale-down]')?.addEventListener('click', () => mutateSelectedStoryLayer((layer) => { layer.scale = Math.max(.25, Number(layer.scale || 1) - .1) }))
  app.querySelector('[data-story-layer-scale-up]')?.addEventListener('click', () => mutateSelectedStoryLayer((layer) => { layer.scale = Math.min(4, Number(layer.scale || 1) + .1) }))
  app.querySelector('[data-story-layer-forward]')?.addEventListener('click', () => mutateSelectedStoryLayer((layer, layers) => { layer.zIndex = Math.max(...layers.map((item) => Number(item.zIndex || 0)), 0) + 1 }))
  app.querySelector('[data-story-layer-delete]')?.addEventListener('click', () => {
    state.storyComposer = { ...state.storyComposer, layers: (state.storyComposer.layers || []).filter((item) => item.id !== state.storyComposer.selectedLayerId), selectedLayerId: '' }
    render()
  })
  const storyDropzone = app.querySelector('[data-story-dropzone]')
  if (storyDropzone && state.storyComposer.mode === 'upload') {
    ;['dragenter', 'dragover'].forEach((type) => storyDropzone.addEventListener(type, (event) => {
      event.preventDefault()
      event.stopPropagation()
      storyDropzone.classList.add('is-dragging')
    }))
    ;['dragleave', 'drop'].forEach((type) => storyDropzone.addEventListener(type, (event) => {
      event.preventDefault()
      event.stopPropagation()
      storyDropzone.classList.remove('is-dragging')
    }))
    storyDropzone.addEventListener('drop', (event) => {
      updateStoryComposerFromForm()
      selectStoryFile(event.dataTransfer?.files?.[0] || null)
    })
  }
  app.querySelector('[data-story-lifetime]')?.addEventListener('change', (event) => {
    state.storyComposer = { ...state.storyComposer, lifetimeHours: Math.min(48, Math.max(1, Number(event.target.value || 24))) }
    const summary = app.querySelector('.community-story-publish-summary small')
    if (summary) summary.textContent = `Expires after ${formatCount(state.storyComposer.lifetimeHours)} hours.`
  })
  app.querySelector('[data-story-composer-form] textarea[name="text"]')?.addEventListener('input', (event) => {
    state.storyComposer.text = String(event.target.value || '').slice(0, 500)
    const counter = event.target.closest('label')?.querySelector('small')
    if (counter) counter.textContent = `${Math.max(0, 500 - state.storyComposer.text.length)} characters remaining`
  })
  app.querySelector('[data-start-story-recording]')?.addEventListener('click', startStoryRecording)
  app.querySelector('[data-stop-story-recording]')?.addEventListener('click', stopStoryRecording)
  app.querySelector('[data-story-composer-form]')?.addEventListener('submit', handleStorySubmit)
  app.querySelectorAll('[data-close-story-composer]').forEach((button) => button.addEventListener('click', closeStoryComposer))
  bindStoryRecordingPreview()
  app.querySelectorAll('[data-open-story]').forEach((button) => button.addEventListener('click', () => openStoryViewer(button.getAttribute('data-open-story') || '')))
  app.querySelector('[data-close-story-viewer]')?.addEventListener('click', closeStoryViewer)
  app.querySelector('[data-story-time-toggle]')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const button = event.currentTarget
    const showingLeft = button.dataset.showingLeft === 'true'
    button.dataset.showingLeft = showingLeft ? 'false' : 'true'
    button.textContent = showingLeft ? button.dataset.storyPostedLabel : button.dataset.storyLeftLabel
    button.setAttribute('aria-label', showingLeft ? 'Show time remaining' : 'Show when Story was posted')
  })
  app.querySelector('[data-story-prev]')?.addEventListener('click', () => advanceStory(-1))
  app.querySelector('[data-story-next]')?.addEventListener('click', () => advanceStory(1))
  app.querySelectorAll('.community-story-object').forEach((object) => {
    object.addEventListener('pointerdown', (event) => event.stopPropagation())
    object.addEventListener('click', (event) => event.stopPropagation())
  })
  const storyReplyInput = app.querySelector('[data-story-reply-input]')
  storyReplyInput?.addEventListener('focus', pauseStoryViewerPlayback)
  storyReplyInput?.addEventListener('blur', () => {
    if (!app.querySelector('[data-story-context-drawer].is-open') && app.querySelector('[data-story-action-rail]')?.hidden !== false) resumeStoryViewerPlayback()
  })
  app.querySelector('[data-story-reply-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    event.stopPropagation()
    const story = storyById(state.storyViewer.storyId)
    const input = event.currentTarget.querySelector('[data-story-reply-input]')
    const button = event.currentTarget.querySelector('[data-story-reply-send]')
    const body = String(input?.value || '').trim()
    if (!story || !body) return
    if (!state.currentUser?.uid) {
      window.location.assign(authRoute({ redirect: window.location.pathname }))
      return
    }
    if (!story.authorUid || story.authorUid === state.currentUser.uid) {
      showCommunityToast('You cannot reply to your own Story.')
      return
    }
    if (button) button.disabled = true
    if (input) input.disabled = true
    try {
      const thread = await createOrGetDm({ creatorId: state.currentUser.uid, targetUid: story.authorUid })
      await sendMessage(thread.id, {
        senderId: state.currentUser.uid,
        body,
        type: 'story_reply',
        clientMessageId: `story-${story.storyId}-${Date.now().toString(36)}`,
        safePageContext: {
          contextSource: 'community_story',
          contextType: 'story_reply',
          contextId: story.storyId,
          contextLabel: story.caption || story.text || 'Story',
          route: window.location.pathname,
          storyAuthorUid: story.authorUid,
          storyMediaType: story.mediaType || '',
          storyMediaURL: story.mediaURL || ''
        }
      })
      if (input) input.value = ''
      showCommunityToast('Reply sent.')
    } catch (error) {
      showCommunityToast(error?.message || 'Could not send Story reply.')
    } finally {
      if (button) button.disabled = false
      if (input) {
        input.disabled = false
        input.focus()
      }
    }
  })
  app.querySelector('[data-story-reply-form]')?.addEventListener('pointerdown', (event) => event.stopPropagation())
  app.querySelectorAll('[data-story-poll-option]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const poll = button.closest('[data-story-poll]')
    poll?.querySelectorAll('[data-story-poll-option]').forEach((item) => item.classList.toggle('is-selected', item === button))
    showCommunityToast('Poll choice selected. Voting persistence arrives with Story interaction analytics.')
  }))
  bindStoryViewerPlayback()
  const storyLikeButton = app.querySelector('.community-story-mobile-like')
  const storyReactionOrbit = app.querySelector('[data-story-reaction-orbit]')
  let storyReactionHoldTimer = 0
  let storyReactionHoldOpened = false
  const closeStoryReactionOrbit = () => {
    storyReactionOrbit?.classList.remove('is-open')
    storyReactionOrbit?.setAttribute('aria-hidden', 'true')
    storyLikeButton?.setAttribute('aria-expanded', 'false')
  }
  const openStoryReactionOrbit = () => {
    storyReactionHoldOpened = true
    storyReactionOrbit?.classList.add('is-open')
    storyReactionOrbit?.setAttribute('aria-hidden', 'false')
    storyLikeButton?.setAttribute('aria-expanded', 'true')
    if (navigator.vibrate) navigator.vibrate(18)
  }
  storyLikeButton?.addEventListener('pointerdown', (event) => {
    event.stopPropagation()
    storyReactionHoldOpened = false
    window.clearTimeout(storyReactionHoldTimer)
    storyReactionHoldTimer = window.setTimeout(openStoryReactionOrbit, 360)
  })
  storyLikeButton?.addEventListener('pointerup', (event) => {
    event.stopPropagation()
    window.clearTimeout(storyReactionHoldTimer)
    if (!storyReactionHoldOpened) {
      const storyId = String(storyLikeButton.getAttribute('data-story-reaction') || '').split(':').slice(1).join(':')
      const wasReacted = storyLikeButton.classList.contains('is-reacted')
      storyLikeButton.classList.toggle('is-reacted', !wasReacted)
      setCommunityStoryReaction(storyId, wasReacted ? 'none' : 'like').then((result) => {
        storyLikeButton.classList.toggle('is-reacted', Boolean(result.reaction))
      }).catch((error) => {
        storyLikeButton.classList.toggle('is-reacted', wasReacted)
        showCommunityToast(error?.message || 'Could not save reaction.')
      })
    }
  })
  storyLikeButton?.addEventListener('pointercancel', () => window.clearTimeout(storyReactionHoldTimer))
  storyLikeButton?.addEventListener('click', (event) => event.stopPropagation())
  app.querySelectorAll('[data-story-quick-reaction]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const label = button.querySelector('span')?.textContent || 'Reaction'
    const reaction = button.getAttribute('data-story-quick-reaction') || ''
    const storyId = String(storyLikeButton?.getAttribute('data-story-reaction') || '').split(':').slice(1).join(':')
    storyLikeButton?.classList.add('is-reacted')
    closeStoryReactionOrbit()
    setCommunityStoryReaction(storyId, reaction).then((result) => {
      storyLikeButton?.classList.toggle('is-reacted', Boolean(result.reaction))
      showCommunityToast(result.reaction ? `${label} reaction sent.` : 'Reaction removed.')
    }).catch((error) => {
      storyLikeButton?.classList.remove('is-reacted')
      showCommunityToast(error?.message || 'Could not save reaction.')
    })
  }))
  app.querySelectorAll('.community-story-desktop-controls [data-story-reaction]').forEach((button) => button.addEventListener('click', () => {
    showCommunityToast('Story reactions are coming soon.')
  }))
  app.querySelector('[data-story-mobile-share]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    shareStoryFromViewer(event.currentTarget.getAttribute('data-story-mobile-share') || '')
  })
  app.querySelector('[data-story-comment-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    showCommunityToast('Story comments are coming soon.')
  })
  app.querySelector('[data-story-actions-toggle]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    const rail = app.querySelector('[data-story-action-rail]')
    if (!rail) return
    rail.hidden = !rail.hidden
    event.currentTarget.setAttribute('aria-expanded', rail.hidden ? 'false' : 'true')
    if (rail.hidden) resumeStoryViewerPlayback()
    else pauseStoryViewerPlayback()
  })
  app.querySelector('[data-story-action-rail]')?.addEventListener('pointerdown', (event) => event.stopPropagation())
  app.querySelectorAll('[data-story-action]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    const action = button.getAttribute('data-story-action') || ''
    const story = storyById(state.storyViewer.storyId)
    if (!story) return
    if (action === 'context') {
      const drawer = app.querySelector('[data-story-context-drawer]')
      if (drawer) {
        drawer.classList.add('is-open')
        drawer.setAttribute('aria-hidden', 'false')
        app.querySelector('[data-story-action-rail]')?.setAttribute('hidden', '')
        pauseStoryViewerPlayback()
      }
      return
    }
    if (action === 'report') {
      openStoryReport(story.storyId)
      return
    }
    if (action === 'source') {
      const panel = app.querySelector('[data-story-provenance]')
      if (panel) {
        panel.classList.toggle('is-open')
        return
      }
      showCommunityToast('This Story has no linked source.')
      return
    }
    if (action === 'remix') {
      if (!story.remixPermission && story.authorUid !== state.currentUser?.uid) {
        showCommunityToast('This creator has not enabled Story remixing.')
        return
      }
      state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
      state.storyComposer = {
        ...state.storyComposer, open: true,
        mode: story.mediaType === 'text' ? 'text' : 'upload',
        text: '', caption: '', file: null, previewURL: '',
        mediaType: story.mediaType || 'text',
        background: story.background || 'aurora',
        remixSourcePreviewURL: story.mediaURL || '',
        remixSourceMediaType: story.mediaType || '',
        remixSourceAuthorDisplayName: story.authorDisplayName || story.authorUsername || 'Creator',
        layers: (story.layers || []).map((layer, index) => ({ ...layer, id: `remix-${Date.now().toString(36)}-${index}`, metadata: { ...(layer.metadata || {}), remixedFromLayerId: layer.id || '' } })),
        selectedLayerId: '', remixOfStoryId: story.storyId
      }
      render()
      showCommunityToast(`Remixing ${story.authorDisplayName || story.authorUsername || 'this Story'}.`)
      return
    }
    if (action === 'save') {
      const key = `melogic:saved-story:${story.storyId}`
      const saved = window.localStorage.getItem(key) === '1'
      window.localStorage.setItem(key, saved ? '0' : '1')
      showCommunityToast(saved ? 'Story removed from saved.' : 'Story saved.')
      return
    }
    if (action === 'collection') {
      const collectionName = window.prompt('Collection name:', 'Stories')?.trim()
      if (!collectionName) return
      const key = `melogic:story-collection:${collectionName.toLowerCase()}`
      let ids = []
      try {
        const stored = JSON.parse(window.localStorage.getItem(key) || '[]')
        ids = Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : []
      } catch {
        ids = []
      }
      if (!ids.includes(story.storyId)) ids.push(story.storyId)
      window.localStorage.setItem(key, JSON.stringify(ids.slice(-250)))
      showCommunityToast(`Added to ${collectionName}.`)
    }
  }))
  app.querySelectorAll('[data-story-provenance-url], [data-story-provenance-id]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const url = safeStoryTargetURL(button.getAttribute('data-story-provenance-url') || '')
    const sourceId = button.getAttribute('data-story-provenance-id') || ''
    if (sourceId) {
      const sourceStory = storyById(sourceId)
      if (sourceStory) {
        state.storyViewer = { open: true, storyId: sourceId, loading: false, error: '' }
        render()
        return
      }
      showCommunityToast('The original Story is no longer active.')
      return
    }
    if (url && url !== '#') window.location.assign(url)
  }))
  app.querySelector('[data-close-story-context]')?.addEventListener('click', (event) => {
    event.stopPropagation()
    const drawer = app.querySelector('[data-story-context-drawer]')
    drawer?.classList.remove('is-open')
    drawer?.setAttribute('aria-hidden', 'true')
    resumeStoryViewerPlayback()
  })
  app.querySelector('[data-story-context-drawer]')?.addEventListener('pointerdown', (event) => event.stopPropagation())
  app.querySelectorAll('[data-story-context-url], [data-story-context-story-id]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const sourceStoryId = button.getAttribute('data-story-context-story-id') || ''
    const url = safeStoryTargetURL(button.getAttribute('data-story-context-url') || '')
    if (sourceStoryId) {
      const sourceStory = storyById(sourceStoryId)
      if (sourceStory) { state.storyViewer = { open:true, storyId:sourceStoryId, loading:false, error:'' }; render() }
      else showCommunityToast('The original Story is no longer active.')
      return
    }
    if (url && url !== '#') window.location.assign(url)
  }))
  app.querySelectorAll('[data-story-report]').forEach((button) => button.addEventListener('click', () => openStoryReport(button.getAttribute('data-story-report') || '')))
  app.querySelectorAll('[data-story-delete]').forEach((button) => button.addEventListener('click', () => handleStoryDelete(button.getAttribute('data-story-delete') || '')))
  app.querySelector('[data-community-composer-form]')?.addEventListener('submit', handleComposerSubmit)
  app.querySelector('[data-community-composer-form]')?.addEventListener('input', updateComposerFromForm)
  app.querySelector('[data-open-product-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openProductPicker()
  })
  app.querySelector('[data-open-music-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openMusicPicker()
  })
  app.querySelector('[data-open-stage-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openStagePicker()
  })
  app.querySelector('[data-open-studio-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    openStudioPicker()
  })
  app.querySelector('[data-open-post-attachment-picker]')?.addEventListener('click', () => {
    updateComposerFromForm()
    app.querySelector('[data-post-attachment-input]')?.click()
  })
  app.querySelector('[data-post-attachment-input]')?.addEventListener('change', async (event) => {
    await addComposerFiles(event.target.files)
  })
  app.querySelector('[data-close-product-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, productPickerOpen: false, productPickerError: '' }
    render()
  })
  app.querySelector('[data-close-music-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, musicPickerOpen: false, musicPickerError: '' }
    render()
  })
  app.querySelector('[data-close-stage-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, stagePickerOpen: false, stagePickerError: '' }
    render()
  })
  app.querySelector('[data-close-studio-picker]')?.addEventListener('click', () => {
    state.composer = { ...state.composer, studioPickerOpen: false, studioPickerError: '' }
    render()
  })
  app.querySelectorAll('[data-select-composer-product]').forEach((button) => button.addEventListener('click', () => selectComposerProduct(button.getAttribute('data-select-composer-product') || '')))
  app.querySelectorAll('[data-select-composer-music]').forEach((button) => button.addEventListener('click', () => selectComposerMusic(button.getAttribute('data-select-composer-music') || '')))
  app.querySelectorAll('[data-select-composer-stage]').forEach((button) => button.addEventListener('click', () => selectComposerStage(button.getAttribute('data-select-composer-stage') || '')))
  app.querySelectorAll('[data-select-composer-studio]').forEach((button) => button.addEventListener('click', () => selectComposerStudio(button.getAttribute('data-select-composer-studio') || '')))
  app.querySelectorAll('[data-remove-composer-attachment]').forEach((button) => button.addEventListener('click', () => removeComposerAttachment(button.getAttribute('data-remove-composer-attachment') || '')))
  app.querySelectorAll('[data-remove-composer-attachment-key]').forEach((button) => button.addEventListener('click', () => removeComposerAttachmentByKey(button.getAttribute('data-remove-composer-attachment-key') || '')))
  app.querySelectorAll('[data-remove-composer-file]').forEach((button) => button.addEventListener('click', () => removeComposerFileAttachment(button.getAttribute('data-remove-composer-file') || '')))
  app.querySelectorAll('[data-set-composer-intent]').forEach((button) => button.addEventListener('click', () => setComposerIntent(button.getAttribute('data-set-composer-intent') || '')))
  app.querySelectorAll('[data-clear-composer-intent]').forEach((button) => button.addEventListener('click', clearComposerIntent))
  app.querySelector('[data-toggle-emoji-panel]')?.addEventListener('click', () => {
    updateComposerFromForm()
    state.composer = { ...state.composer, emojiOpen: !state.composer.emojiOpen }
    render()
  })
  app.querySelectorAll('[data-insert-emoji]').forEach((button) => button.addEventListener('click', () => insertEmoji(button.getAttribute('data-insert-emoji') || '')))
  app.querySelector('[data-mention-search]')?.addEventListener('input', (event) => queueMentionSearch(event.target.value))
  bindMentionPickerEvents(app)
  app.querySelectorAll('[data-close-community-image-viewer]').forEach((button) => button.addEventListener('click', closeCommunityImageViewer))
  app.querySelector('[data-community-image-viewer-backdrop]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeCommunityImageViewer()
  })
  bindCommunityImageViewerZoom()
  app.querySelector('[data-community-search]')?.addEventListener('input', (event) => {
    state.communityFilters.search = event.target.value
    window.clearTimeout(state.communitySearchTimer)
    state.communitySearchTimer = window.setTimeout(loadCommunities, 250)
  })
  app.querySelector('[data-community-category]')?.addEventListener('change', (event) => {
    state.communityFilters.category = event.target.value
    loadCommunities()
  })
  bindCommunityFocusButtons(app)
  app.querySelector('[data-community-edit-post-form]')?.addEventListener('submit', handleEditPostSubmit)
  app.querySelectorAll('[data-close-edit-post]').forEach((button) => button.addEventListener('click', closeEditPostModal))
  app.querySelectorAll('[data-close-community-report]').forEach((button) => {
    button.addEventListener('click', () => {
      state.report = { ...state.report, open: false, submitting: false, error: '' }
      render()
    })
  })
  app.querySelector('[data-community-report-form]')?.addEventListener('submit', handleReportSubmit)
}

// melogic-mobile-unified-runtime-v2
// melogic-community-lifecycle-contract-v4b
function syncCommunityRouteStateFromLocation() {
  const requestedFeed = new URLSearchParams(window.location.search).get('feed')
  if (requestedFeed === 'for-you' || requestedFeed === 'following') {
    state.activeTab = requestedFeed
    state.activeTopicLabel = requestedFeed === 'following' ? 'Following' : 'For You'
  } else if (window.location.pathname === ROUTES.community) {
    state.activeTab = 'for-you'
    state.activeTopicLabel = 'For You'
  }
  state.detailPostId = parseDetailPostId()
  state.focusedCommentId = parseFeedParam('comment')
  state.focusedReplyId = parseFeedParam('reply')
  state.focusedCommentScrolled = false
  state.view = parseCommunityView()
  state.activeTag = normalizeTagKey(parseFeedParam('tag'))
  state.feedSearch = parseFeedParam('search').trim()
  state.feedSearchInput = state.feedSearch
  state.feedSort = ['new', 'top-today', 'top-week', 'most-discussed'].includes(parseFeedParam('sort')) ? parseFeedParam('sort') : 'new'
}

function handleCommunityPopstate() {
  const previousSurfaceKey = desktopCommunitySurfaceKey || desktopCommunitySurfaceKeyFor()
  syncCommunityRouteStateFromLocation()

  if (!isMobileSpaRuntime() && !state.detailPostId) {
    const nextSurfaceKey = desktopCommunitySurfaceKeyFor()
    if (['for-you', 'following', 'discover'].includes(nextSurfaceKey)) {
      if (previousSurfaceKey && previousSurfaceKey !== nextSurfaceKey) {
        captureDesktopCommunitySurface(previousSurfaceKey)
      }
      if (restoreDesktopCommunitySurface(nextSurfaceKey)) {
        refreshDesktopCommunitySharedContent(nextSurfaceKey)
        return
      }
      desktopCommunitySurfaceKey = nextSurfaceKey
      render()
      refreshDesktopCommunitySharedContent(nextSurfaceKey)
      if (nextSurfaceKey !== 'discover') void loadFeedPage({ reset: true }).catch(() => null)
      return
    }
  }

  if (isMobileSpaRuntime() && !state.detailPostId) {
    const nextKey = mobileCommunitySurfaceKeyFor()
    if (['for-you', 'following', 'discover'].includes(nextKey)) {
      const previousKey = mobileCommunitySurfaceKey
      if (previousKey && previousKey !== nextKey) captureMobileCommunitySurface(previousKey)
      if (restoreMobileCommunitySurface(nextKey)) return
      mobileCommunitySurfaceKey = nextKey
      render()
      if (nextKey === 'discover') {
        void loadCommunities({ renderOnStart: false, renderAfter: true, bootstrap: false }).catch(() => null)
      } else {
        void loadFeedPage({ reset: true }).catch(() => null)
      }
      return
    }
  }
  if (!state.detailPostId && restoreFeedNavigationSnapshot()) return
  loadCommunity()
}

async function bootstrapCommunityDocument() {
  if (communityBootstrapPromise) return communityBootstrapPromise
  communityBootstrapPromise = (async () => {
    if (communityBootstrapped) return
    communityBootstrapped = true
    document.body.classList.add('is-community-page')
    if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    bindCommunityGlobalUiOnce()

    const user = await waitForInitialAuthState()
    transitionCommunityAuth(user)
    render()
    await loadCommunity()
    if (isMobileSpaRuntime() && !state.detailPostId) mobileCommunitySurfaceKey = mobileCommunitySurfaceKeyFor()
    await consumeCameraCommunityMediaHandoff()

    if (!communityAuthUnsubscribe) {
      communityAuthUnsubscribe = subscribeToAuthState((nextUser) => {
        if (!transitionCommunityAuth(nextUser)) return
        render()
        void rehydrateCommunityAuthState()
      })
    }

    if (!communityPopstateBound) {
      communityPopstateBound = true
      window.addEventListener('popstate', handleCommunityPopstate)
    }
  })()
  try {
    await communityBootstrapPromise
  } catch (error) {
    communityBootstrapPromise = null
    communityBootstrapped = false
    throw error
  }
}

function detachCommunitySurface(instance) {
  if (!app || !instance) return
  const fragment = document.createDocumentFragment()
  while (app.firstChild) fragment.append(app.firstChild)
  instance.fragment = fragment
}

function attachCommunitySurface(instance) {
  if (!app || !instance?.fragment?.childNodes?.length) return false
  app.replaceChildren(instance.fragment)
  instance.fragment = null
  return true
}

if (isMobileSpaRuntime()) {
  registerMobileRuntimeView('community', {
    async mount() {
      await bootstrapCommunityDocument()
      return { fragment: null }
    },
    async activate({ instance }) {
      document.body.classList.add('is-community-page')
      bindCommunityGlobalUiOnce()
      syncCommunityRouteStateFromLocation()
      const restored = attachCommunitySurface(instance)
      if (!restored && !app?.querySelector('[data-community-root]')) {
        communityShellMounted = false
        render()
      }
      syncCommunityMobileHeader(Boolean(state.detailPostId), app)
      await consumeCameraCommunityMediaHandoff()
      if (!state.detailPostId) mobileCommunitySurfaceKey = mobileCommunitySurfaceKeyFor()
      resumeStoryViewerResources()
      void hydrateMobileCommunitySharedState({ directory: state.view.type === 'communities' })
      if (state.activeCommunityId) void loadActiveCommunityMembership(state.activeCommunityId)
    },
    async deactivate({ instance }) {
      document.body.classList.remove('community-modal-open')
      suspendStoryViewerResources({ releaseMedia: true })
      resetStoryRecording()
      detachCommunitySurface(instance)
    },
    async unmount({ instance }) {
      suspendStoryViewerResources({ releaseMedia: true })
      resetStoryRecording()
      instance.fragment = null
    }
  })
}

// melogic-runtime-boot-ownership-v4d1
// melogic-community-deep-route-cold-boot-v1
// Firebase Hosting serves community.html for the entire Community route family.
// Cold-boot every Community document/deep link, while speculative imports from
// another primary surface still only register the lifecycle and do not boot.
const communityColdBootPath = location.pathname.replace(/\/+$/, '') || '/'
const isCommunityDocumentRoute =
  communityColdBootPath === '/community' ||
  communityColdBootPath === '/community/communities' ||
  communityColdBootPath === '/community/create' ||
  communityColdBootPath.startsWith('/community/c/') ||
  communityColdBootPath.startsWith('/community/post/')

if (isCommunityDocumentRoute) {
  void bootstrapCommunityDocument()
}
