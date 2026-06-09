import './styles/base.css'
import './styles/community.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { createReport } from './data/productService'
import {
  createCommunityComment,
  createCommunityPost,
  createCommunityStory,
  createCommunity,
  deleteCommunityStory,
  deleteCommunityComment,
  deleteOwnCommunityPost,
  getCommunityCommentViewerState,
  getCommunityBySlug,
  getCommunityFocusState,
  getCommunityPost,
  getCommunityPostViewerState,
  listCommunityCommentsPage,
  listCommunities,
  listFocusedCommunityPosts,
  listCommunityPosts,
  listCommunityStories,
  listShareableCommunityMusicPreviews,
  listShareableCommunityProducts,
  listShareableCommunityStagePlans,
  listShareableCommunityStudioProjects,
  newCommunityStoryId,
  normalizeCommunityComment,
  normalizeCommunityPost,
  normalizeCommunityStory,
  resolveCommunityAttachmentMediaUrls,
  recordCommunityPostShare,
  recordCommunityStoryView,
  toggleCommunityCommentLike,
  toggleCommunityCommentDislike,
  toggleCommunityFocus,
  toggleCommunityPostDislike,
  toggleCommunityPostLike,
  toggleCommunityPostSave,
  updateCommunityPost,
  uploadCommunityStoryMedia,
  validateCommunityStoryMedia
} from './data/communityService'
import { searchProfilesByUsername } from './data/profileSearchService'
import { ROUTES, authRoute, communityPostRoute, communityRoute, productRoute, publicProfileRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import { formatUsername } from './utils/format'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')
const COMMUNITY_PAGE_SIZE = 12
const FALLBACK_COMMUNITY_DEFS = [
  ['StageMaker', 'Stage', 'Stage design, live rigs, venue plans, and show builds.'],
  ['Vocals', 'Production', 'Vocal production, performance, tuning, chains, and toplines.'],
  ['Sound Design', 'Production', 'Synthesis, resampling, textures, and creative sound building.'],
  ['Sample Packs', 'Marketplace', 'Loops, one-shots, kits, and creator pack discussion.'],
  ['Mixing & Mastering', 'Production', 'Mix critique, mastering notes, references, and release polish.'],
  ['Metalcore', 'Genre', 'Heavy guitars, drums, vocals, programming, and modern metalcore production.'],
  ['Live Production', 'Stage', 'Live playback, routing, stage plots, cues, and touring workflows.'],
  ['Feedback', 'Feedback', 'Ask for focused critique and give useful creator feedback.'],
  ['Dubstep', 'Genre', 'Bass design, drops, arrangement, and electronic production talk.'],
  ['Logic', 'Production', 'Logic Pro workflows, templates, plugins, and troubleshooting.'],
  ['Ableton', 'Production', 'Ableton Live workflows, racks, performance, and production systems.'],
  ['Serum', 'Production', 'Serum patches, wavetables, basses, leads, and sound design.'],
  ['Vital', 'Production', 'Vital presets, modulation, wavetables, and synthesis tips.']
]
const DUMMY_STORIES = [
  { id: 'test1', label: 'test1', initials: 'T1' },
  { id: 'test2', label: 'test2', initials: 'T2' },
  { id: 'test3', label: 'test3', initials: 'T3' }
]
const COMPOSER_DRAFT_KEY = 'melogic-community-composer-draft-v2'
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
const COMMUNITY_CATEGORIES = ['all', 'Genre', 'Production', 'Stage', 'Marketplace', 'Feedback', 'Creator Help']
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
const POSTING_MODES = [
  { value: 'open', label: 'Open' },
  { value: 'focused_only', label: 'Focused only' },
  { value: 'members_only', label: 'Members only' },
  { value: 'moderators_only', label: 'Moderators only' }
]
const COMMUNITY_DEBUG = Boolean(import.meta.env?.DEV) || new URLSearchParams(window.location.search).has('debugCommunity')

const state = {
  currentUser: null,
  activeTab: 'for-you',
  activeCommunityId: '',
  activeCommunitySlug: '',
  activeTopicLabel: 'For You',
  activeTag: normalizeTagKey(parseFeedParam('tag')),
  feedSearch: parseFeedParam('search'),
  feedSort: ['new', 'top-today', 'top-week', 'most-discussed'].includes(parseFeedParam('sort')) ? parseFeedParam('sort') : 'new',
  view: parseCommunityView(),
  community: null,
  communities: [],
  communityFocus: {},
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
  posts: [],
  attachmentMediaUrls: {},
  viewerState: {},
  loading: true,
  feedInitialLoading: false,
  feedLoadingMore: false,
  feedHasMore: true,
  feedCursor: null,
  feedError: '',
  feedStillLoading: false,
  feedRequestId: 0,
  openPostMenuId: '',
  error: '',
  message: '',
  composer: {
    open: false,
    title: '',
    body: '',
    linkedProductId: '',
    communityId: '',
    tags: '',
    visibility: 'public',
    attachments: [],
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
  createCommunity: {
    open: false,
    name: '',
    slug: '',
    description: '',
    category: 'Creator Help',
    postingMode: 'open',
    submitting: false,
    error: '',
    message: ''
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
  commentSubmitting: false,
  commentActionError: '',
  detailPostId: parseDetailPostId()
}

if (state.view.createOpen) state.createCommunity.open = true

let feedPaginationObserver = null
let communityScrollChromeReady = false
let communityScrollRaf = 0
let lastCommunityScrollY = window.scrollY || 0
let communityKeyboardReady = false
let communityOutsideClickReady = false
let communityBeforeUnloadReady = false
let communityRailResizeReady = false
let communityShellMounted = false
let communityShellChromeInitialized = false
let communityPagePreloaderInitialized = false
const communityPendingActions = new Map()
let storyMediaRecorder = null
let storyRecordingStream = null
let storyRecordingChunks = []
let storyRecordingTimer = null

function logCommunityPerf(label, data = {}) {
  if (!COMMUNITY_DEBUG) return
  console.debug('[community:perf]', label, data)
}

function dispatchCommunityPendingActionsChanged() {
  window.dispatchEvent(new CustomEvent('community:pending-actions-changed', {
    detail: { pendingCount: communityPendingActions.size }
  }))
}

function trackCommunityAction(actionId, promise) {
  const id = String(actionId || '').trim()
  if (!id) return promise
  communityPendingActions.set(id, { startedAt: Date.now(), promise })
  dispatchCommunityPendingActionsChanged()
  return promise.finally(() => {
    communityPendingActions.delete(id)
    dispatchCommunityPendingActionsChanged()
  })
}

function hasPendingCommunityActions() {
  return communityPendingActions.size > 0
}

function setupCommunityPendingLeaveWarning() {
  if (communityBeforeUnloadReady) return
  communityBeforeUnloadReady = true
  window.addEventListener('beforeunload', (event) => {
    if (!hasPendingCommunityActions()) return
    event.preventDefault()
    event.returnValue = ''
  })
}

function confirmCommunityNavigation() {
  if (!hasPendingCommunityActions()) return true
  return window.confirm('Community actions are still saving. Leave anyway?')
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
    communitySlug: state.view.type === 'community' && state.community ? state.community.slug : state.activeCommunitySlug,
    limitCount: COMMUNITY_PAGE_SIZE,
    tag: state.activeTag,
    search: state.feedSearch,
    sort: state.feedSort
  }
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

function fallbackCommunities() {
  return FALLBACK_COMMUNITY_DEFS.map(([name, category, description]) => {
    const slug = slugifyCommunity(name)
    return {
      communityId: slug,
      id: slug,
      slug,
      name,
      description,
      category,
      iconURL: '',
      bannerURL: '',
      createdBy: '',
      ownerUid: '',
      moderatorIds: [],
      memberCount: 0,
      focusCount: 0,
      postCount: 0,
      reportCount: 0,
      pinnedPostIds: [],
      visibility: 'public',
      postingMode: 'open',
      status: 'active',
      official: false,
      fallback: true,
      createdAt: '',
      updatedAt: ''
    }
  })
}

function fallbackCommunityBySlug(slug = '') {
  const clean = slugifyCommunity(slug)
  return fallbackCommunities().find((community) => community.slug === clean || community.communityId === clean) || null
}

function displayedCommunities() {
  const real = state.communities.filter((community) => community.status === 'active' && community.visibility === 'public')
  return real.length ? real : fallbackCommunities()
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
    tags: '',
    visibility: 'public',
    attachments: [],
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
  return Boolean(state.composer.title || state.composer.body || state.composer.tags || state.composer.attachments.length || state.composer.mentionedUsers.length || state.composer.intent)
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
  if (path.startsWith('/community/create')) return { type: 'communities', createOpen: true }
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
  if (post.authorAvatarURL) return `<img src="${escapeHtml(post.authorAvatarURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

function currentUserAvatar() {
  const user = state.currentUser || {}
  const name = user.displayName || user.email || 'M'
  const photoURL = user.photoURL || user.avatarURL || ''
  if (photoURL) return `<img src="${escapeHtml(photoURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
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

function currentStoryIndex() {
  const index = state.stories.findIndex((story) => story.storyId === state.storyViewer.storyId)
  return index >= 0 ? index : 0
}

function storyAvatar(story) {
  const name = story.authorDisplayName || story.authorUsername || 'M'
  if (story.authorAvatarURL || story.authorPhotoURL) return `<img src="${escapeHtml(story.authorAvatarURL || story.authorPhotoURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

const FORUM_CATEGORIES = [
  {
    title: 'General Discussion',
    description: 'Open conversation for creators, listeners, and platform questions.'
  },
  {
    title: 'Production Help',
    description: 'Ask about mixing, sound design, workflow problems, and creative blocks.'
  },
  {
    title: 'Marketplace & Products',
    description: 'Discuss product submissions, store pages, deliverables, and buyer feedback.'
  },
  {
    title: 'Collaborations',
    description: 'Find collaborators, remix partners, session players, and project support.'
  },
  {
    title: 'Releases & Feedback',
    description: 'Share release plans, early previews, and requests for constructive notes.'
  },
  {
    title: 'Melogic Platform',
    description: 'Talk through Melogic features, updates, Studio tools, and community workflows.'
  }
]

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
  if (state.activeTab === 'forums') return 'Forums'
  if (state.activeTab === 'forms') return 'Forms'
  if (state.activeTab === 'music') return 'Music'
  if (state.activeTab === 'products') return 'Products'
  if (state.activeTab === 'stage-plans') return 'Stage Plans'
  if (state.activeTab === 'studio-projects') return 'Studio Projects'
  if (state.activeTab === 'feedback') return 'Feedback'
  if (state.activeTab === 'collaboration') return 'Collaboration'
  if (state.activeTab === 'following') return 'Focused'
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

function renderTopicBar() {
  const communities = visibleTopicCommunities()
  const communityPills = communities.map((community) => `
      <button type="button" class="community-topic-pill ${state.activeTab === 'community' && state.activeCommunityId === community.communityId ? 'is-active' : ''}" data-topic-community-id="${escapeHtml(community.communityId)}" data-topic-community-slug="${escapeHtml(community.slug)}" data-topic-community-label="${escapeHtml(community.name)}">
        ${escapeHtml(community.name)}
      </button>
    `).join('')

  return `
    <section class="community-topic-bar" aria-label="Community topics">
      <button type="button" class="community-topic-arrow is-left" data-topic-scroll="-1" aria-label="Scroll topics left">${iconSvg('arrowLeft')}</button>
      <div class="community-topic-scroll" data-community-topic-scroll>
        <button type="button" class="community-topic-pill ${state.activeTab === 'for-you' ? 'is-active' : ''}" data-community-tab="for-you">For You</button>
        <button type="button" class="community-topic-pill ${state.activeTab === 'following' ? 'is-active' : ''}" data-community-tab="following">Focused</button>
        <span class="community-topic-divider" aria-hidden="true"></span>
        ${communityPills}
      </div>
      <button type="button" class="community-topic-arrow is-right" data-topic-scroll="1" aria-label="Scroll topics right">${iconSvg('chevronRight')}</button>
    </section>
  `
}

function renderStoriesRow() {
  const hasOwnActiveStory = Boolean(state.currentUser?.uid && state.stories.some((story) => story.authorUid === state.currentUser.uid))
  const placeholderItems = !state.stories.length ? DUMMY_STORIES.map((story) => `
    <button type="button" class="community-story-item is-placeholder" data-story-coming-soon="${escapeHtml(story.label)}">
      <span class="community-story-ring"><span class="community-story-avatar">${escapeHtml(story.initials)}</span></span>
      <strong>${escapeHtml(story.label)}</strong>
    </button>
  `).join('') : ''
  const realStoryItems = state.stories.slice(0, 12).map((story) => `
    <button type="button" class="community-story-item" data-open-story="${escapeHtml(story.storyId)}">
      <span class="community-story-ring"><span class="community-story-avatar ${story.mediaType === 'text' ? `story-bg-${escapeHtml(story.background)}` : ''} ${story.mediaType === 'video' ? 'has-video' : ''}">
        ${story.mediaType === 'image' && story.mediaURL ? `<img src="${escapeHtml(story.mediaURL)}" alt="" loading="lazy" />` : story.mediaType === 'video' ? iconSvg('play') : storyAvatar(story)}
      </span></span>
      <strong>${escapeHtml(story.authorDisplayName || story.authorUsername || 'Creator')}</strong>
    </button>
  `).join('')

  return `
    <section class="community-stories-row" aria-label="Community stories" data-community-stories-scroll>
      <button type="button" class="community-story-item is-create ${hasOwnActiveStory ? 'has-active-story' : ''}" data-open-story-composer>
        <span class="community-story-ring"><span class="community-story-avatar is-create">${iconSvg('folderPlus')}</span></span>
        <strong>${hasOwnActiveStory ? 'Add Story' : 'Your Story'}</strong>
      </button>
      ${placeholderItems}
      ${realStoryItems}
      ${state.storiesLoading ? '<span class="community-story-empty">Loading stories...</span>' : ''}
      ${state.storiesError ? `<span class="community-story-empty">${escapeHtml(state.storiesError)}</span>` : ''}
    </section>
  `
}

function renderCommunityScrollChrome() {
  return `
    <div class="community-scroll-chrome" data-community-scroll-chrome>
      ${renderTopicBar()}
      ${renderStoriesRow()}
      <div class="community-shell-divider" aria-hidden="true"></div>
    </div>
  `
}

function renderStoryComposerModal() {
  if (!state.storyComposer.open) return ''
  const isRecordMode = state.storyComposer.mode === 'record'
  const isVideo = state.storyComposer.mediaType === 'video'
  const hasPreview = Boolean(state.storyComposer.previewURL)
  return `
    <div class="community-modal-backdrop">
      <section class="community-story-modal" role="dialog" aria-modal="true" aria-labelledby="community-story-composer-title">
        <header>
          <div>
            <p class="eyebrow">Story</p>
            <h2 id="community-story-composer-title">Create Story</h2>
          </div>
          <button type="button" data-close-story-composer aria-label="Close story composer">${iconSvg('x')}</button>
        </header>
        ${state.storyComposer.message ? `<p class="community-success">${escapeHtml(state.storyComposer.message)}</p>` : `
          <form data-story-composer-form>
            <div class="community-type-toggle" role="group" aria-label="Story type">
              <button type="button" data-story-mode="upload" class="${state.storyComposer.mode === 'upload' ? 'is-active' : ''}">${iconSvg('image')} <span>Upload Video</span></button>
              <button type="button" data-story-mode="record" class="${isRecordMode ? 'is-active' : ''}">${iconSvg('play')} <span>Record Video</span></button>
            </div>
            <div class="community-story-preview ${hasPreview || state.storyComposer.recording ? 'has-media' : ''}">
              ${hasPreview
                ? isVideo
                  ? `<video src="${escapeHtml(state.storyComposer.previewURL)}" controls playsinline preload="metadata"></video>`
                  : `<img src="${escapeHtml(state.storyComposer.previewURL)}" alt="Story preview" />`
                : isRecordMode
                  ? `<video data-story-record-preview autoplay muted playsinline></video>`
                  : `<div>${iconSvg('play')}<span>Choose an MP4/WebM video or JPG/PNG/WebP image.</span></div>`
              }
            </div>
            ${isRecordMode ? `
              <div class="community-story-record-controls">
                <span data-story-record-timer>${state.storyComposer.recording ? `${state.storyComposer.recordingSeconds}s / ${STORY_MAX_RECORD_SECONDS}s` : 'Ready to record up to 60 seconds.'}</span>
                ${state.storyComposer.recording
                  ? `<button type="button" class="button button-accent" data-stop-story-recording>Stop Recording</button>`
                  : `<button type="button" class="button button-accent" data-start-story-recording ${state.storyComposer.submitting ? 'disabled' : ''}>Start Recording</button>`
                }
              </div>
              <p class="community-muted-note">Recording uses this browser's camera and microphone permissions. If recording is not supported, upload a video instead.</p>
            ` : `
              <label>
                <span>Story media</span>
                <input name="storyMedia" type="file" accept="video/mp4,video/webm,image/jpeg,image/png,image/webp" data-story-file />
              </label>
              ${state.storyComposer.file ? `<p class="community-story-file">${escapeHtml(storyFileLabel(state.storyComposer.file))}</p>` : ''}
            `}
            <label>
              <span>Caption</span>
              <textarea name="text" maxlength="500" rows="3" placeholder="Add a short caption...">${escapeHtml(state.storyComposer.text)}</textarea>
            </label>
            <div class="community-story-options-grid">
              <label>
                <span>Lifetime</span>
                <select name="lifetimeHours" data-story-lifetime>
                  ${STORY_LIFETIME_OPTIONS.map((hours) => `<option value="${hours}" ${Number(state.storyComposer.lifetimeHours) === hours ? 'selected' : ''}>${hours} hours</option>`).join('')}
                </select>
              </label>
              <label>
                <span>Visibility</span>
                <select name="visibility" data-story-visibility>
                  <option value="public" selected>Public</option>
                  <option value="focused" disabled>Focused coming soon</option>
                  <option value="followers" disabled>Followers coming soon</option>
                </select>
              </label>
            </div>
            ${state.storyComposer.submitting ? `
              <div class="community-story-progress" aria-label="Story upload progress">
                <span style="width: ${Math.max(0, Math.min(100, Number(state.storyComposer.uploadProgress || 0)))}%"></span>
                <em>${formatCount(state.storyComposer.uploadProgress || 0)}%</em>
              </div>
            ` : ''}
            ${state.storyComposer.error ? `<p class="community-error">${escapeHtml(state.storyComposer.error)}</p>` : ''}
            <div class="community-form-actions">
              <span>Stories can stay up for 1-48 hours.</span>
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
  const story = storyById(state.storyViewer.storyId) || state.stories[currentStoryIndex()]
  if (!story) return ''
  const index = currentStoryIndex()
  const isOwn = state.currentUser?.uid && state.currentUser.uid === story.authorUid
  const profileHref = story.authorUid ? publicProfileRoute({ uid: story.authorUid }) : ROUTES.profilePublic
  return `
    <div class="community-modal-backdrop">
      <section class="community-story-viewer" role="dialog" aria-modal="true" aria-labelledby="community-story-viewer-title">
        <header>
          <a class="community-author" href="${profileHref}">
            <span class="community-avatar">${storyAvatar(story)}</span>
            <span>
              <strong id="community-story-viewer-title">${escapeHtml(story.authorDisplayName || 'Melogic Creator')}</strong>
              <em>${escapeHtml(formatUsername(story.authorUsername) || 'Creator')} · ${escapeHtml(storyExpiresLabel(story.expiresAt))}</em>
            </span>
          </a>
          <button type="button" data-close-story-viewer aria-label="Close story viewer">${iconSvg('x')}</button>
        </header>
        <div class="community-story-surface story-bg-${escapeHtml(story.background || 'aurora')} ${story.mediaType === 'image' || story.mediaType === 'video' ? 'has-image' : ''}">
          ${story.mediaType === 'video' && story.mediaURL
            ? `<video src="${escapeHtml(story.mediaURL)}" autoplay muted loop playsinline preload="auto" controlslist="nodownload nofullscreen noremoteplayback" disablepictureinpicture></video>`
            : story.mediaType === 'image' && story.mediaURL
              ? `<img src="${escapeHtml(story.mediaURL)}" alt="" loading="eager" decoding="async" />`
              : `<p>${escapeHtml(story.text)}</p>`
          }
          ${(story.mediaType === 'image' || story.mediaType === 'video') && (story.caption || story.text) ? `<p class="community-story-caption">${escapeHtml(story.caption || story.text)}</p>` : ''}
        </div>
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
          <button type="button" data-story-prev ${state.stories.length <= 1 ? 'disabled' : ''}>${iconSvg('arrowLeft')} <span>Prev</span></button>
          <span>${formatCount(index + 1)} / ${formatCount(state.stories.length)} · ${iconSvg('eye')} ${formatCount(story.viewCount)}</span>
          <button type="button" data-story-next ${state.stories.length <= 1 ? 'disabled' : ''}><span>Next</span> ${iconSvg('chevronRight')}</button>
          <button type="button" data-story-report="${escapeHtml(story.storyId)}">${iconSvg('alertCircle')} <span>Report</span></button>
          ${isOwn ? `<button type="button" data-story-delete="${escapeHtml(story.storyId)}">${iconSvg('trash')} <span>Delete</span></button>` : ''}
        </footer>
        ${state.storyViewer.error ? `<p class="community-error">${escapeHtml(state.storyViewer.error)}</p>` : ''}
      </section>
    </div>
  `
}

function currentComposerCommunity() {
  if (state.view.type === 'community' && state.community?.communityId) return state.community
  if (state.activeTab === 'community' && state.activeCommunityId) {
    return state.communities.find((community) => community.communityId === state.activeCommunityId) || null
  }
  if (state.composer.communityId) {
    return state.communities.find((community) => community.communityId === state.composer.communityId) || null
  }
  return null
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
  if (!state.composer.attachments.length) return ''
  return `<div class="community-composer-attachments">${state.composer.attachments.map(composerAttachmentPreview).join('')}</div>`
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

function renderMentionPicker() {
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
    ['Add Attachment', 'file'],
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

function renderComposerModal() {
  if (!state.composer.open) return ''
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
          </div>
          <button type="button" data-close-community-composer aria-label="Close composer">${iconSvg('x')}</button>
        </header>
        <form data-community-composer-form>
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
            ${state.view.type === 'community' && state.community ? `
              <input type="hidden" name="communityId" value="${escapeHtml(state.community.communityId)}" />
              <p class="community-context-note">Posting to <a href="${communityRoute(state.community.slug)}">c/${escapeHtml(state.community.slug)}</a></p>
            ` : `
              <label>
                <span>Community destination</span>
                <select name="communityId">
                  <option value="">General feed</option>
                  ${state.communities.map((community) => `<option value="${escapeHtml(community.communityId)}" ${state.composer.communityId === community.communityId ? 'selected' : ''}>${escapeHtml(community.name)} · c/${escapeHtml(community.slug)}</option>`).join('')}
                </select>
              </label>
            `}
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
          <div class="community-form-actions">
            <span>${Math.max(0, 2000 - state.composer.body.length)} characters left</span>
            <button type="button" class="button button-muted" data-close-community-composer ${state.composer.submitting ? 'disabled' : ''}>Cancel</button>
            <button type="submit" class="button button-accent" ${state.composer.submitting ? 'disabled' : ''}>${state.composer.submitting ? 'Publishing...' : 'Publish'}</button>
          </div>
        </form>
      </section>
    </div>
  `
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

function postCard(post, { detail = false } = {}) {
  const viewer = state.viewerState[post.postId] || {}
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
            <strong>${escapeHtml(post.authorDisplayName || 'Melogic Creator')}</strong>
            <em>${escapeHtml(formatUsername(post.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(post.createdAt))}${post.edited ? ' · edited' : ''}</em>
          </span>
        </a>
        <div class="community-post-header-actions">
          <div class="community-post-badges">
            ${pinned ? `<span class="community-badge is-pinned">${iconSvg('star')} Pinned</span>` : ''}
            ${post.communitySlug ? `<a class="community-badge" href="${communityRoute(post.communitySlug)}">c/${escapeHtml(post.communitySlug)}</a>` : ''}
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
      ${renderPostAttachments(post)}
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
      ${detail ? renderComments(post) : ''}
    </article>
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
  const localError = isReply ? state.replyErrors[parentCommentId] || '' : ''
  return `
    <form class="community-comment-composer" ${isReply ? `data-community-reply-form="${escapeHtml(parentCommentId)}"` : 'data-community-comment-form'}>
      <div class="community-comment-composer-row">
        <span class="community-avatar community-comment-composer-avatar">${currentUserAvatar()}</span>
        <label>
          <span class="sr-only">${isReply ? 'Reply' : 'Comment'}</span>
          <textarea name="body" maxlength="2000" rows="${isReply ? '2' : '3'}" placeholder="${isReply ? 'Write a reply...' : 'Start the conversation...'}">${escapeHtml(body)}</textarea>
        </label>
        <button type="submit" class="button button-accent" ${isSubmitting ? 'disabled' : ''}>${isSubmitting ? 'Posting...' : isReply ? 'Reply' : 'Post'}</button>
      </div>
      ${localError ? `<p class="community-error">${escapeHtml(localError)}</p>` : ''}
      <div class="community-comment-tool-row" aria-label="Comment attachments">
        <button type="button" disabled title="Image comments are coming soon.">${iconSvg('image')} <span>Image</span></button>
        <button type="button" disabled title="Music comments are coming soon.">${iconSvg('music')} <span>Music</span></button>
        <button type="button" disabled title="Project comments are coming soon.">${iconSvg('cube')} <span>Project</span></button>
        <button type="button" disabled title="Comment emoji picker is coming soon.">${iconSvg('smile')} <span>Emoji</span></button>
      </div>
      <div class="community-comment-form-actions is-quiet">
        <span>${Math.max(0, 2000 - body.length)} characters left</span>
        ${isReply ? `<button type="button" class="button button-muted" data-cancel-reply-composer="${escapeHtml(parentCommentId)}">Cancel</button>` : ''}
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
  const isOwn = state.currentUser?.uid && state.currentUser.uid === comment.authorUid
  const authorHref = comment.authorUid ? publicProfileRoute({ uid: comment.authorUid }) : ROUTES.profilePublic
  const canReply = !comment.parentCommentId
  const replyPage = repliesPageFor(comment.commentId)
  const repliesExpanded = Boolean(replyPage.expanded)
  const repliesLoading = Boolean(replyPage.loading)
  const repliesLoadingMore = Boolean(replyPage.loadingMore)
  return `
    <article class="community-comment-card ${comment.parentCommentId ? 'is-reply' : ''}" data-comment-id="${escapeHtml(comment.commentId)}">
      <header class="community-comment-header">
        <a class="community-author" href="${authorHref}">
          <span class="community-avatar">${postAvatar(comment)}</span>
          <span>
            <strong>${escapeHtml(comment.authorDisplayName || 'Melogic Creator')}</strong>
            <em>${escapeHtml(formatUsername(comment.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(comment.createdAt))}</em>
          </span>
        </a>
      </header>
      <p class="community-comment-body">${escapeHtml(comment.body)}</p>
      <footer class="community-comment-actions">
        <button type="button" class="${viewer.liked ? 'is-active' : ''}" data-community-comment-like="${escapeHtml(comment.commentId)}">${iconSvg('thumbsUp')} <span>${formatCount(comment.likeCount)}</span></button>
        <button type="button" class="${viewer.disliked ? 'is-active' : ''}" data-community-comment-dislike="${escapeHtml(comment.commentId)}">${iconSvg('thumbsDown')} <span>${formatCount(comment.dislikeCount)}</span></button>
        ${canReply ? `<button type="button" data-toggle-reply-composer="${escapeHtml(comment.commentId)}">${iconSvg('messageCircle')} <span>Reply</span></button>` : ''}
        <button type="button" data-community-comment-report="${escapeHtml(comment.commentId)}">${iconSvg('alertCircle')} <span>Report</span></button>
        ${isOwn ? `<button type="button" data-community-comment-delete="${escapeHtml(comment.commentId)}">${iconSvg('trash')} <span>Delete</span></button>` : ''}
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
  if (state.activeTab === 'following') return state.currentUser ? 'Focus communities to build this feed.' : 'Sign in to focus communities.'
  if (state.activeTab === 'community') return `No posts in ${state.activeTopicLabel || 'this community'} yet.`
  if (state.activeTab === 'forums') return 'Forum threads are coming soon.'
  if (state.activeTab === 'forms') return 'Community forms are being organized here.'
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

function renderForumsPage() {
  return `
    <section class="community-framework-page">
      <header class="community-feed-toolbar community-framework-hero">
        <div>
          <p class="eyebrow">Community</p>
          <h1>Forums</h1>
          <p>Discuss production, releases, collaborations, marketplace tools, and Melogic platform updates.</p>
        </div>
        <button type="button" class="button button-accent" disabled title="Forum thread creation is coming soon.">
          ${iconSvg('messageCircle')} <span>Start a Forum Thread</span>
        </button>
      </header>
      <section class="community-framework-grid" aria-label="Forum categories">
        ${FORUM_CATEGORIES.map((category) => `
          <article class="community-framework-card">
            <span class="community-framework-icon">${iconSvg('messageCircle')}</span>
            <strong>${escapeHtml(category.title)}</strong>
            <p>${escapeHtml(category.description)}</p>
            <div class="community-framework-stats">
              <span>0 threads</span>
              <span>Coming soon</span>
            </div>
          </article>
        `).join('')}
      </section>
      ${renderCommunityFormsSection()}
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

function renderCommunityCard(community) {
  const focused = Boolean(state.communityFocus[community.communityId])
  const focusDisabled = community.fallback === true
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

function renderCreateCommunityForm() {
  if (!state.createCommunity.open) return ''
  return `
    <section class="community-panel community-create-panel" id="create-community">
      <div class="community-panel-heading">
        <div>
          <p class="eyebrow">Create</p>
          <h2>Create Community</h2>
        </div>
        <button type="button" class="community-close-button" data-close-create-community aria-label="Close create community">${iconSvg('x')}</button>
      </div>
      ${state.createCommunity.message ? `<p class="community-success">${escapeHtml(state.createCommunity.message)}</p>` : `
        <form data-create-community-form>
          <label>
            <span>Name</span>
            <input name="name" maxlength="80" value="${escapeHtml(state.createCommunity.name)}" placeholder="Stage designers" />
          </label>
          <label>
            <span>Slug</span>
            <input name="slug" maxlength="48" value="${escapeHtml(state.createCommunity.slug)}" placeholder="stage-designers" />
          </label>
          <label>
            <span>Description</span>
            <textarea name="description" maxlength="500" rows="4" placeholder="What should creators post here?">${escapeHtml(state.createCommunity.description)}</textarea>
          </label>
          <label>
            <span>Category</span>
            <select name="category">${COMMUNITY_CATEGORIES.filter((category) => category !== 'all').map((category) => `<option value="${escapeHtml(category)}" ${state.createCommunity.category === category ? 'selected' : ''}>${escapeHtml(category)}</option>`).join('')}</select>
          </label>
          <label>
            <span>Posting mode</span>
            <select name="postingMode">${POSTING_MODES.map((mode) => `<option value="${escapeHtml(mode.value)}" ${state.createCommunity.postingMode === mode.value ? 'selected' : ''}>${escapeHtml(mode.label)}</option>`).join('')}</select>
          </label>
          ${state.createCommunity.error ? `<p class="community-error">${escapeHtml(state.createCommunity.error)}</p>` : ''}
          <div class="community-form-actions">
            <span>Creation is limited during first launch.</span>
            <button type="submit" class="button button-accent" ${state.createCommunity.submitting ? 'disabled' : ''}>${state.createCommunity.submitting ? 'Creating...' : 'Create Community'}</button>
          </div>
        </form>
      `}
    </section>
  `
}

function renderCommunitiesView() {
  const categories = COMMUNITY_CATEGORIES
  return `
    <section class="community-hero compact">
      <div>
        <p class="eyebrow">Focused Communities</p>
        <h1>Communities</h1>
        <p>Find focused spaces for genres, production, StageMaker, feedback, and creator support.</p>
      </div>
      <div class="community-hero-actions">
        <button type="button" class="button button-accent" data-open-create-community>Create Community</button>
        <a class="button button-muted" href="${ROUTES.community}">${iconSvg('arrowLeft')} <span>Back</span></a>
      </div>
    </section>
    <div class="community-layout">
      <div class="community-main">
        ${renderCreateCommunityForm()}
        <section class="community-panel community-community-tools">
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
        </section>
        ${state.communityFilters.loading ? '<section class="community-feed-state community-panel">Loading communities...</section>' : state.communityFilters.error ? `<section class="community-feed-state community-panel"><strong>Could not load communities.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>` : `<section class="community-community-grid">${directoryCommunities().map(renderCommunityCard).join('') || '<div class="community-feed-state community-panel">No communities match those filters.</div>'}</section>`}
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

function renderLeftNav() {
  const navItems = [
    { label: 'Home', icon: 'home', href: ROUTES.community },
    { label: 'For You', icon: 'star', tab: 'for-you', active: state.activeTab === 'for-you' },
    { label: 'Focused', icon: 'eye', tab: 'following', active: state.activeTab === 'following' },
    { label: 'Forums', icon: 'messageCircle', tab: 'forums', active: state.activeTab === 'forums' },
    { label: 'Forms', icon: 'fileText', tab: 'forms', active: state.activeTab === 'forms' },
    { label: 'Communities', icon: 'folder', href: ROUTES.communityCommunities },
    { label: 'My Posts', icon: 'fileText', action: 'My Posts' },
    { label: 'Saved', icon: 'bookmark', action: 'Saved posts' },
    { label: 'Music', icon: 'music', tab: 'music', active: state.activeTab === 'music' },
    { label: 'Products', icon: 'package', tab: 'products', active: state.activeTab === 'products' },
    { label: 'Stage Plans', icon: 'cube', tab: 'stage-plans', active: state.activeTab === 'stage-plans' },
    { label: 'Studio Projects', icon: 'music', tab: 'studio-projects', active: state.activeTab === 'studio-projects' },
    { label: 'Feedback', icon: 'messageCircle', tab: 'feedback', active: state.activeTab === 'feedback' },
    { label: 'Collaboration', icon: 'user', tab: 'collaboration', active: state.activeTab === 'collaboration' }
  ]
  return `
    <aside class="community-left-nav" aria-label="Community navigation">
      <nav>
        ${navItems.map((item) => item.href ? `
          <a class="${item.active ? 'is-active' : ''}" href="${item.href}">${iconSvg(item.icon)} <span>${escapeHtml(item.label)}</span></a>
        ` : item.tab ? `
          <button type="button" class="${item.active ? 'is-active' : ''}" data-community-tab="${escapeHtml(item.tab)}">${iconSvg(item.icon)} <span>${escapeHtml(item.label)}</span></button>
        ` : `
          <button type="button" data-community-nav-stub="${escapeHtml(item.action)}">${iconSvg(item.icon)} <span>${escapeHtml(item.label)}</span></button>
        `).join('')}
      </nav>
    </aside>
  `
}

function trendingCommunities() {
  return displayedCommunities()
    .filter((community) => !community.fallback)
    .sort((a, b) => {
      const scoreA = Number(a.focusCount || 0) + Number(a.postCount || 0)
      const scoreB = Number(b.focusCount || 0) + Number(b.postCount || 0)
      return scoreB - scoreA
    })
    .slice(0, 6)
}

function renderSidebar() {
  const suggested = displayedCommunities()
    .filter((community) => !state.communityFocus[community.communityId])
    .slice(0, 5)
  const communities = trendingCommunities()
  return `
    <aside class="community-right-rail community-sidebar">
      <section class="community-rail-card">
        <h2>Suggested Communities</h2>
        ${suggested.length ? `
          <div class="community-suggested-list">
            ${suggested.map((community) => `
              <article>
                <a href="${communityRoute(community.slug)}">
                  <span>${escapeHtml(community.name.slice(0, 1).toUpperCase())}</span>
                  <strong>${escapeHtml(community.name)}</strong>
                  <em>${formatCount(community.focusCount)} focused · ${formatCount(community.postCount)} posts</em>
                </a>
                <button type="button" ${community.fallback ? 'disabled title="Focus is available once this community is active."' : `data-toggle-community-focus="${escapeHtml(community.communityId)}"`}>${community.fallback ? 'Soon' : state.communityFocus[community.communityId] ? 'Focused' : 'Focus'}</button>
              </article>
            `).join('')}
          </div>
        ` : '<p>Communities will appear here as creators focus spaces.</p>'}
      </section>
      <section class="community-rail-card">
        <h2>Trending Communities</h2>
        ${communities.length ? `
          <div class="community-suggested-list">
            ${communities.map((community) => `
              <article>
                <a href="${communityRoute(community.slug)}">
                  <span>${escapeHtml(community.name.slice(0, 1).toUpperCase())}</span>
                  <strong>${escapeHtml(community.name)}</strong>
                  <em>${formatCount(community.focusCount)} focused · ${formatCount(community.postCount)} posts</em>
                </a>
              </article>
            `).join('')}
          </div>
        ` : '<p>Communities will trend here as creators focus and post.</p>'}
      </section>
      <section class="community-rail-card">
        <h2>This Day in History</h2>
        <p>Powered by Wikipedia once connected.</p>
      </section>
      <section class="community-rail-card">
        <h2>Guidelines</h2>
        <p>Share work, give useful feedback, and respect creator ownership.</p>
      </section>
    </aside>
  `
}

function renderDetail() {
  const post = state.posts[0]
  const postLoading = state.detailPostLoading && !post
  return `
    <section class="community-detail-topbar">
      <div>
        <p class="eyebrow">Community</p>
        <h1>${post ? escapeHtml(post.title || 'Post') : 'Post'}</h1>
      </div>
      <a class="button button-muted" href="${ROUTES.community}">${iconSvg('arrowLeft')} <span>Back to Community</span></a>
    </section>
    <div class="community-layout is-detail">
      <div class="community-detail-main">
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

function renderCommunityDetail() {
  const community = state.community
  const focused = community ? Boolean(state.communityFocus[community.communityId]) : false
  const focusDisabled = community?.fallback === true
  return `
    <section class="community-hero compact community-community-hero">
      <div>
        <p class="eyebrow">Community</p>
        <h1>${community ? escapeHtml(community.name) : 'Community'}</h1>
        <p>${community ? escapeHtml(community.description) : 'Loading community...'}</p>
        ${community ? `<div class="community-community-stats hero-stats"><span>c/${escapeHtml(community.slug)}</span><span>${formatCount(community.focusCount)} focused</span><span>${formatCount(community.postCount)} posts</span></div>` : ''}
      </div>
      <div class="community-hero-actions">
        <a class="button button-muted" href="${ROUTES.community}">${iconSvg('arrowLeft')} <span>Back to Community</span></a>
        <a class="button button-muted" href="${ROUTES.communityCommunities}">All Communities</a>
        ${community ? `<button type="button" class="button ${focused ? 'button-muted' : 'button-accent'}" ${focusDisabled ? 'disabled title="Focus is available once this community is active."' : `data-toggle-community-focus="${escapeHtml(community.communityId)}"`}>${focusDisabled ? 'Focus soon' : focused ? 'Focused' : 'Focus'}</button>` : ''}
        ${community ? focusDisabled
          ? `<button type="button" class="button button-muted" disabled title="Posting is available once this community is active.">${iconSvg('plus')} <span>Post soon</span></button>`
          : `<button type="button" class="button button-accent" data-open-community-composer>${iconSvg('plus')} <span>Post</span></button>`
        : ''}
      </div>
    </section>
    <div class="community-layout">
      <div class="community-main">
        ${community ? renderFeedToolbar() : ''}
        ${state.communityFilters.loading ? '<section class="community-feed-state community-panel">Loading community...</section>' : state.communityFilters.error ? `<section class="community-feed-state community-panel"><strong>Could not load community.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>` : community ? renderFeed() : '<section class="community-feed-state community-panel">This community is not available.</section>'}
      </div>
      ${renderSidebar()}
    </div>
    ${renderComposerModal()}
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
    ${renderCommunityScrollChrome()}
    ${state.message ? `<p class="community-toast">${escapeHtml(state.message)}</p>` : ''}
    <div class="community-layout is-home">
      ${renderLeftNav()}
      <div class="community-main">
        ${state.activeTab === 'forums' ? renderForumsPage() : state.activeTab === 'forms' ? renderFormsPage() : `${renderFeedToolbar()}${renderFeed()}`}
      </div>
      ${renderSidebar()}
    </div>
    ${renderComposerModal()}
    ${renderStoryComposerModal()}
    ${renderStoryViewerModal()}
    ${renderEditPostModal()}
    ${renderReportModal()}
  `
}

function renderCommunityViewContent() {
  if (state.detailPostId) return renderDetail()
  if (state.view.type === 'communities') return renderCommunitiesView()
  if (state.view.type === 'community') return renderCommunityDetail()
  return renderCommunityHomeView()
}

function renderFeedToolbar() {
  const title = state.view.type === 'community' && state.community ? state.community.name : activeFeedTitle()
  const postDisabled = state.view.type === 'community' && state.community?.fallback === true
  const subtitle = state.view.type === 'community' && state.community
    ? `Posts in c/${state.community.slug}.`
    : state.activeTab === 'following'
    ? 'Posts from communities you focus.'
    : state.activeTab === 'community'
      ? 'Posts from this community.'
      : 'Fresh creator updates from across Melogic.'
  return `
    <section class="community-feed-toolbar" aria-label="Feed controls">
      <div>
        <p class="eyebrow">Community</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle)}</p>
        ${(state.activeTag || state.feedSearch) ? `<div class="community-active-filters">
          ${state.activeTag ? `<button type="button" data-clear-community-tag>#${escapeHtml(state.activeTag)} ${iconSvg('x')}</button>` : ''}
          ${state.feedSearch ? `<button type="button" data-clear-community-search>${escapeHtml(state.feedSearch)} ${iconSvg('x')}</button>` : ''}
        </div>` : ''}
      </div>
      <div class="community-feed-controls">
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

function render() {
  if (!app) return
  document.body.classList.toggle('community-modal-open', communityModalIsOpen())
  if (state.view.type !== 'feed' || communityModalIsOpen()) setCommunityChromeHidden(false)
  const communityRoot = renderCommunityShellOnce()
  if (!communityRoot) return
  communityRoot.innerHTML = renderCommunityViewContent()
  bindEvents()
}

async function loadViewerState() {
  if (!state.currentUser?.uid || !state.posts.length) {
    state.viewerState = {}
    return
  }
  const entries = await Promise.all(state.posts.map(async (post) => [post.postId, await getCommunityPostViewerState(post.postId, state.currentUser.uid)]))
  state.viewerState = Object.fromEntries(entries)
}

async function loadCommentViewerState() {
  const replyComments = Object.values(state.repliesByParent || {}).flat()
  const allComments = mergeCommentsById(state.comments, replyComments)
  if (!state.currentUser?.uid || !state.detailPostId || !allComments.length) {
    state.commentViewerState = {}
    return
  }
  const entries = await Promise.all(allComments.map(async (comment) => [
    comment.commentId,
    await getCommunityCommentViewerState(state.detailPostId, comment.commentId, state.currentUser.uid)
  ]))
  state.commentViewerState = Object.fromEntries(entries)
}

async function loadAttachmentMediaUrls() {
  try {
    state.attachmentMediaUrls = await resolveCommunityAttachmentMediaUrls(state.posts)
  } catch (error) {
    console.warn('[community] attachment media url load failed', { code: error?.code, message: error?.message })
    state.attachmentMediaUrls = {}
  }
}

async function loadFeedEnrichment(requestId = state.feedRequestId) {
  const startedAt = performance.now()
  await Promise.allSettled([
    loadViewerState(),
    loadAttachmentMediaUrls()
  ])
  if (requestId !== state.feedRequestId) return
  logCommunityPerf('feed enrichment complete', { durationMs: Math.round(performance.now() - startedAt), posts: state.posts.length })
  render()
}

async function loadStories({ renderAfter = false } = {}) {
  state.storiesLoading = true
  state.storiesError = ''
  if (renderAfter) render()
  try {
    state.stories = await listCommunityStories({ limitCount: 30 })
    const requestedStoryId = new URLSearchParams(window.location.search).get('story') || ''
    if (requestedStoryId && state.stories.some((story) => story.storyId === requestedStoryId)) {
      state.storyViewer = { ...state.storyViewer, open: true, storyId: requestedStoryId, error: '' }
      recordedStoryViews.add(requestedStoryId)
      recordCommunityStoryView(requestedStoryId).then((result) => {
        if (Number.isFinite(Number(result.viewCount))) {
          state.stories = state.stories.map((story) => story.storyId === requestedStoryId ? { ...story, viewCount: Number(result.viewCount) } : story)
        }
      }).catch(() => recordedStoryViews.delete(requestedStoryId))
    }
  } catch (error) {
    console.warn('[community] stories load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.storiesError = error?.message || 'Stories could not be loaded.'
  } finally {
    state.storiesLoading = false
    if (renderAfter) render()
  }
}

async function loadCommentViewerStateFor(comments = []) {
  if (!state.currentUser?.uid || !state.detailPostId || !comments.length) return
  const entries = await Promise.all(comments.map(async (comment) => [
    comment.commentId,
    await getCommunityCommentViewerState(state.detailPostId, comment.commentId, state.currentUser.uid)
  ]))
  state.commentViewerState = { ...state.commentViewerState, ...Object.fromEntries(entries) }
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
    page.items = append ? mergeCommentsById(page.items || [], result.comments) : result.comments
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
  state.detailPostId = id
  state.view = { type: 'feed' }
  state.error = ''
  state.feedError = ''
  state.loading = false

  if (replaceUrl) window.history.pushState({}, '', communityPostRoute(id))

  const cachedPost = seedPost || state.posts.find((post) => post.postId === id) || null
  if (cachedPost) {
    state.posts = [cachedPost]
    state.detailPostLoading = false
    if (previousPostId !== id && !state.commentsByPostId[id]?.loaded) resetActivePostComments(id)
    syncActiveCommentState(id)
    render()
    loadComments({ renderAfter: true }).catch(() => null)
    Promise.allSettled([
      loadViewerState(),
      loadAttachmentMediaUrls(),
      !state.communities.length ? loadCommunities({ renderOnStart: false, renderAfter: true }) : Promise.resolve()
    ]).then(() => render()).catch(() => render())
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
        loadComments({ renderAfter: true }),
        loadViewerState().then(render),
        loadAttachmentMediaUrls().then(render),
        !state.communities.length ? loadCommunities({ renderOnStart: false, renderAfter: true }) : Promise.resolve()
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
  const entries = await Promise.all(state.communities.map(async (community) => [
    community.communityId,
    await getCommunityFocusState(community.communityId, state.currentUser.uid)
  ]))
  state.communityFocus = Object.fromEntries(entries)
}

async function loadCommunities({ renderOnStart = true, renderAfter = true } = {}) {
  state.communityFilters.loading = true
  state.communityFilters.error = ''
  if (renderOnStart) render()
  try {
    state.communities = await listCommunities({
      category: state.communityFilters.category,
      search: state.communityFilters.search,
      limitCount: 50
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

async function loadFeedPage({ reset = false } = {}) {
  if (reset) resetFeedPagination()
  if (!reset && (!state.feedHasMore || state.feedLoadingMore || state.feedInitialLoading)) return
  const requestId = reset ? state.feedRequestId + 1 : state.feedRequestId
  state.feedRequestId = requestId
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
  render()

  let stillLoadingTimer = null
  if (reset) {
    stillLoadingTimer = window.setTimeout(() => {
      if (state.feedRequestId === requestId && state.feedInitialLoading) {
        state.feedStillLoading = true
        render()
      }
    }, 5000)
  }

  const startedAt = performance.now()
  try {
    let posts = []
    let cursor = null
    let hasMore = false
    if (state.activeTab === 'following') {
      if (reset && state.currentUser?.uid) {
        posts = await listFocusedCommunityPosts(state.currentUser.uid, COMMUNITY_PAGE_SIZE)
        posts = filterPostsForActiveTab(posts).filter((post) => (!state.activeTag || (post.tagKeys || post.tags || []).includes(state.activeTag)) && (!state.feedSearch || `${post.title} ${post.body} ${post.authorDisplayName} ${post.authorUsername} ${(post.tags || []).join(' ')}`.toLowerCase().includes(state.feedSearch.toLowerCase())))
      }
      hasMore = false
    } else {
      const result = await listCommunityPosts({
        ...feedQueryOptions(),
        pageMode: true,
        cursor: reset ? null : state.feedCursor
      })
      posts = filterPostsForActiveTab(result.posts || [])
      cursor = result.cursor || null
      hasMore = Boolean(result.hasMore)
    }
    if (requestId !== state.feedRequestId) return
    state.posts = reset ? sortPinnedPosts(posts) : sortPinnedPosts(mergeUniquePosts(state.posts, posts))
    state.feedCursor = cursor || state.feedCursor
    state.feedHasMore = hasMore
    logCommunityPerf(reset ? 'first feed page loaded' : 'next feed page loaded', {
      durationMs: Math.round(performance.now() - startedAt),
      posts: posts.length,
      hasMore
    })
  } catch (error) {
    if (requestId !== state.feedRequestId) return
    console.warn('[community] feed page load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.feedError = error?.message || 'Community posts could not be loaded.'
  } finally {
    if (stillLoadingTimer) window.clearTimeout(stillLoadingTimer)
    if (requestId !== state.feedRequestId) return
    state.feedInitialLoading = false
    state.feedLoadingMore = false
    state.feedStillLoading = false
    render()
    loadFeedEnrichment(requestId).catch(() => null)
  }
}

async function loadCommunity() {
  state.error = ''
  state.feedError = ''
  if (state.detailPostId) {
    await loadPostDetail({ postId: state.detailPostId })
    return
  }

  if (state.view.type === 'communities') {
    state.loading = false
    await loadCommunities()
    return
  }

  loadStories({ renderAfter: true }).catch(() => null)

  if (!state.communities.length && state.view.type !== 'community') {
    loadCommunities({ renderOnStart: false, renderAfter: true }).catch(() => null)
  }

  if (['forums', 'forms'].includes(state.activeTab)) {
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
      const community = await getCommunityBySlug(state.view.slug) || fallbackCommunityBySlug(state.view.slug)
      state.community = community
      state.communities = community && !community.fallback ? [community] : state.communities
      state.communityFilters.loading = false
      render()
      if (community) {
        loadCommunityFocusState().then(render).catch(() => null)
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
  app?.querySelectorAll('.community-post-options-menu').forEach((menu) => menu.remove())
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
  if (!body && !title && !state.composer.attachments.length) {
    state.composer.error = 'Add text, a title, or an attachment before publishing.'
    render()
    return
  }
  if (state.composer.intent === 'feedback_request' && !state.composer.intentData.feedbackQuestion?.trim()) {
    state.composer.error = 'Add a specific feedback question.'
    render()
    return
  }

  state.composer.submitting = true
  render()
  try {
    const community = currentComposerCommunity()
    const result = await createCommunityPost({
      type: 'post',
      title,
      body,
      attachments: state.composer.attachments.map((attachment) => ({
        type: attachment.type,
        targetId: attachment.targetId || attachment.productId || attachment.projectId || attachment.storagePath || '',
        productId: attachment.productId || '',
        projectId: attachment.projectId || '',
        sourceType: attachment.sourceType || '',
        sourceId: attachment.sourceId || '',
        storagePath: attachment.storagePath || ''
      })),
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
    })
    const post = normalizeCommunityPost(result.post || {}, result.postId)
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
    clearComposerDraft()
    state.composer = defaultComposerState({ communityId: state.view.type === 'community' ? state.community?.communityId || '' : '' })
    state.message = 'Post published.'
    render()
    window.setTimeout(() => {
      state.message = ''
      render()
    }, 3000)
  } catch (error) {
    console.warn('[community] create post failed', { code: error?.code, message: error?.message, details: error?.details })
    state.composer.submitting = false
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
  const actionId = `like:${postId}`
  if (communityPendingActions.has(actionId)) return
  const post = postById(postId)
  const previousLiked = Boolean(state.viewerState[postId]?.liked)
  const previousDisliked = Boolean(state.viewerState[postId]?.disliked)
  const previousLikes = Number(post?.counts?.likes || 0)
  const previousDislikes = Number(post?.counts?.dislikes || 0)
  const nextLiked = !previousLiked
  setPostViewerFlag(postId, 'liked', nextLiked)
  if (nextLiked) setPostViewerFlag(postId, 'disliked', false)
  setPostCount(postId, 'likes', previousLikes + (nextLiked ? 1 : -1))
  if (nextLiked && previousDisliked) setPostCount(postId, 'dislikes', previousDislikes - 1)
  updatePostActionDom(postId)
  trackCommunityAction(actionId, toggleCommunityPostLike(postId))
    .then((result) => {
      setPostViewerFlag(postId, 'liked', Boolean(result.liked ?? result.active))
      setPostViewerFlag(postId, 'disliked', Boolean(result.disliked))
      if (Number.isFinite(Number(result.likesCount))) setPostCount(postId, 'likes', Number(result.likesCount))
      if (Number.isFinite(Number(result.dislikesCount))) setPostCount(postId, 'dislikes', Number(result.dislikesCount))
      updatePostActionDom(postId)
    })
    .catch((error) => {
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
  const actionId = `dislike:${postId}`
  if (communityPendingActions.has(actionId)) return
  const post = postById(postId)
  const previousLiked = Boolean(state.viewerState[postId]?.liked)
  const previousDisliked = Boolean(state.viewerState[postId]?.disliked)
  const previousLikes = Number(post?.counts?.likes || 0)
  const previousDislikes = Number(post?.counts?.dislikes || 0)
  const nextDisliked = !previousDisliked
  setPostViewerFlag(postId, 'disliked', nextDisliked)
  if (nextDisliked) setPostViewerFlag(postId, 'liked', false)
  setPostCount(postId, 'dislikes', previousDislikes + (nextDisliked ? 1 : -1))
  if (nextDisliked && previousLiked) setPostCount(postId, 'likes', previousLikes - 1)
  updatePostActionDom(postId)
  trackCommunityAction(actionId, toggleCommunityPostDislike(postId))
    .then((result) => {
      setPostViewerFlag(postId, 'liked', Boolean(result.liked))
      setPostViewerFlag(postId, 'disliked', Boolean(result.disliked ?? result.active))
      if (Number.isFinite(Number(result.likesCount))) setPostCount(postId, 'likes', Number(result.likesCount))
      if (Number.isFinite(Number(result.dislikesCount))) setPostCount(postId, 'dislikes', Number(result.dislikesCount))
      updatePostActionDom(postId)
    })
    .catch((error) => {
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
  setPostViewerFlag(postId, 'saved', nextSaved)
  setPostCount(postId, 'saves', previousSaves + (nextSaved ? 1 : -1))
  updatePostActionDom(postId)
  trackCommunityAction(actionId, toggleCommunityPostSave(postId))
    .then((result) => {
      setPostViewerFlag(postId, 'saved', Boolean(result.active))
      if (Number.isFinite(Number(result.savesCount))) setPostCount(postId, 'saves', Number(result.savesCount))
      updatePostActionDom(postId)
    })
    .catch((error) => {
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
  state.commentDraft = body
  state.commentActionError = ''
  if (!body) {
    state.commentActionError = 'Comment body is required.'
    renderCommentState()
    return
  }
  state.commentSubmitting = true
  renderCommentState()
  try {
    const tempId = `comment:${state.detailPostId}:${Date.now()}`
    const result = await trackCommunityAction(tempId, createCommunityComment({ postId: state.detailPostId, body }))
    const comment = normalizeCommunityComment(result.comment || {}, result.commentId)
    const page = commentsPageFor(state.detailPostId)
    page.items = mergeCommentsById((page.items || []).filter((item) => item.commentId !== comment.commentId), [comment])
    page.loaded = true
    syncActiveCommentState()
    state.commentViewerState[comment.commentId] = { liked: false, disliked: false }
    state.commentDraft = ''
    state.commentSubmitting = false
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Number(result.commentCount))
    else updateDetailCommentCount(1)
    renderCommentState()
  } catch (error) {
    console.warn('[community] create comment failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentSubmitting = false
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
  state.replyDrafts = { ...state.replyDrafts, [parentCommentId]: body }
  state.replyErrors = { ...state.replyErrors, [parentCommentId]: '' }
  state.commentActionError = ''
  if (!body) {
    state.replyErrors = { ...state.replyErrors, [parentCommentId]: 'Reply body is required.' }
    renderCommentState()
    return
  }
  state.replySubmittingFor = parentCommentId
  renderCommentState()
  try {
    const tempId = `comment:${state.detailPostId}:${parentCommentId}:${Date.now()}`
    const result = await trackCommunityAction(tempId, createCommunityComment({ postId: state.detailPostId, parentCommentId, body }))
    const comment = normalizeCommunityComment(result.comment || {}, result.commentId)
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
    updateCommentCount(parentCommentId, { replyCount: (findLoadedComment(parentCommentId)?.replyCount || 0) + 1 })
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Number(result.commentCount))
    else updateDetailCommentCount(1)
    renderCommentState()
  } catch (error) {
    console.warn('[community] create reply failed', { code: error?.code, message: error?.message, details: error?.details })
    state.replySubmittingFor = ''
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
  const actionId = `comment-like:${state.detailPostId}:${commentId}`
  if (communityPendingActions.has(actionId)) return
  const comment = findLoadedComment(commentId)
  const previousLiked = Boolean(state.commentViewerState[commentId]?.liked)
  const previousDisliked = Boolean(state.commentViewerState[commentId]?.disliked)
  const previousLikeCount = Number(comment?.likeCount || 0)
  const previousDislikeCount = Number(comment?.dislikeCount || 0)
  const nextLiked = !previousLiked
  state.commentViewerState[commentId] = { liked: nextLiked, disliked: nextLiked ? false : previousDisliked }
  updateCommentCount(commentId, { likeCount: Math.max(0, previousLikeCount + (nextLiked ? 1 : -1)) })
  if (nextLiked && previousDisliked) updateCommentCount(commentId, { dislikeCount: Math.max(0, previousDislikeCount - 1) })
  updateCommentActionDom(commentId)
  trackCommunityAction(actionId, toggleCommunityCommentLike({ postId: state.detailPostId, commentId })).then((result) => {
    state.commentViewerState[commentId] = { liked: Boolean(result.liked ?? result.active), disliked: Boolean(result.disliked) }
    if (Number.isFinite(Number(result.likeCount))) updateCommentCount(commentId, { likeCount: Number(result.likeCount) })
    if (Number.isFinite(Number(result.dislikeCount))) updateCommentCount(commentId, { dislikeCount: Number(result.dislikeCount) })
    updateCommentActionDom(commentId)
  }).catch((error) => {
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
  const actionId = `comment-dislike:${state.detailPostId}:${commentId}`
  if (communityPendingActions.has(actionId)) return
  const comment = findLoadedComment(commentId)
  const previousLiked = Boolean(state.commentViewerState[commentId]?.liked)
  const previousDisliked = Boolean(state.commentViewerState[commentId]?.disliked)
  const previousLikeCount = Number(comment?.likeCount || 0)
  const previousDislikeCount = Number(comment?.dislikeCount || 0)
  const nextDisliked = !previousDisliked
  state.commentViewerState[commentId] = { liked: nextDisliked ? false : previousLiked, disliked: nextDisliked }
  updateCommentCount(commentId, { dislikeCount: Math.max(0, previousDislikeCount + (nextDisliked ? 1 : -1)) })
  if (nextDisliked && previousLiked) updateCommentCount(commentId, { likeCount: Math.max(0, previousLikeCount - 1) })
  updateCommentActionDom(commentId)
  trackCommunityAction(actionId, toggleCommunityCommentDislike({ postId: state.detailPostId, commentId })).then((result) => {
    state.commentViewerState[commentId] = { liked: Boolean(result.liked), disliked: Boolean(result.disliked ?? result.active) }
    if (Number.isFinite(Number(result.likeCount))) updateCommentCount(commentId, { likeCount: Number(result.likeCount) })
    if (Number.isFinite(Number(result.dislikeCount))) updateCommentCount(commentId, { dislikeCount: Number(result.dislikeCount) })
    updateCommentActionDom(commentId)
  }).catch((error) => {
    console.warn('[community] comment dislike failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentViewerState[commentId] = { liked: previousLiked, disliked: previousDisliked }
    updateCommentCount(commentId, { likeCount: previousLikeCount })
    updateCommentCount(commentId, { dislikeCount: previousDislikeCount })
    state.commentActionError = 'Could not update this comment.'
    updateCommentActionDom(commentId)
    renderCommentState()
  })
}

async function handleCommentDelete(commentId = '') {
  if (!state.currentUser) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const actionId = `comment-delete:${state.detailPostId}:${commentId}`
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
  trackCommunityAction(actionId, deleteCommunityComment({ postId: state.detailPostId, commentId })).then((result) => {
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Number(result.commentCount))
    renderCommentState()
  }).catch((error) => {
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
  const delta = nextFocused ? 1 : -1
  state.communityFocus[communityId] = nextFocused
  state.communities = state.communities.map((community) => community.communityId === communityId
    ? { ...community, focusCount: Math.max(0, Number(community.focusCount || 0) + delta) }
    : community)
  if (state.community?.communityId === communityId) {
    state.community = { ...state.community, focusCount: Math.max(0, Number(state.community.focusCount || 0) + delta) }
  }
  render()
  trackCommunityAction(actionId, toggleCommunityFocus(communityId))
    .then((result) => {
      state.communityFocus[communityId] = Boolean(result.focused)
      state.communities = state.communities.map((community) => community.communityId === communityId ? { ...community, focusCount: Number(result.focusCount ?? community.focusCount) } : community)
      if (state.community?.communityId === communityId) {
        state.community = { ...state.community, focusCount: Number(result.focusCount ?? state.community.focusCount) }
      }
      if (state.view.type === 'feed' && state.activeTab === 'following') {
        loadCommunity()
        return
      }
      render()
    })
    .catch((error) => {
      console.warn('[community] focus failed', { code: error?.code, message: error?.message, details: error?.details })
      state.communityFocus[communityId] = previousFocused
      state.communities = previousCommunities
      state.community = previousCommunity
      showCommunityToast('Could not update focus. Please try again.')
      render()
    })
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
    submitting: false,
    error: ''
  }
  render()
}

function closeCommunityComposer() {
  if (composerHasDraft()) {
    if (!window.confirm('Discard draft?')) return
    clearComposerDraft()
    state.composer = defaultComposerState({
      communityId: state.view.type === 'community' ? state.community?.communityId || '' : ''
    })
  } else {
    state.composer = { ...state.composer, open: false, submitting: false, error: '' }
  }
  render()
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

async function openProductPicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, productPickerOpen: true, productPickerLoading: true, productPickerError: '' }
  render()
  try {
    const products = await listShareableCommunityProducts(state.currentUser.uid, 20)
    state.composer = { ...state.composer, products, productPickerLoading: false, productPickerError: '' }
    render()
  } catch (error) {
    console.warn('[community] product picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, productPickerLoading: false, productPickerError: 'Published products could not be loaded.' }
    render()
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
  render()
}

async function openMusicPicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, musicPickerOpen: true, musicPickerLoading: true, musicPickerError: '' }
  render()
  try {
    const musicPreviews = await listShareableCommunityMusicPreviews(state.currentUser.uid, 20)
    state.composer = { ...state.composer, musicPreviews, musicPickerLoading: false, musicPickerError: '' }
    render()
  } catch (error) {
    console.warn('[community] music picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, musicPickerLoading: false, musicPickerError: 'Audio previews could not be loaded.' }
    render()
  }
}

async function openStagePicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, stagePickerOpen: true, stagePickerLoading: true, stagePickerError: '' }
  render()
  try {
    const stagePlans = await listShareableCommunityStagePlans(state.currentUser.uid, 30)
    state.composer = { ...state.composer, stagePlans, stagePickerLoading: false, stagePickerError: '' }
    render()
  } catch (error) {
    console.warn('[community] stage picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, stagePickerLoading: false, stagePickerError: 'StageMaker plans could not be loaded.' }
    render()
  }
}

async function openStudioPicker() {
  if (!state.currentUser?.uid) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.composer = { ...state.composer, studioPickerOpen: true, studioPickerLoading: true, studioPickerError: '' }
  render()
  try {
    const studioProjects = await listShareableCommunityStudioProjects(state.currentUser.uid, 30)
    state.composer = { ...state.composer, studioProjects, studioPickerLoading: false, studioPickerError: '' }
    render()
  } catch (error) {
    console.warn('[community] studio picker failed', { code: error?.code, message: error?.message })
    state.composer = { ...state.composer, studioPickerLoading: false, studioPickerError: 'Studio projects could not be loaded.' }
    render()
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
  render()
}

function selectComposerMusic(storagePath = '') {
  const preview = state.composer.musicPreviews.find((item) => item.storagePath === storagePath)
  if (!preview) return
  if (!canAddAttachment('music')) {
    state.composer = { ...state.composer, musicPickerError: 'You can attach up to two music previews.' }
    render()
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
    render()
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
    render()
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
  render()
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
  render()
}

function setComposerIntent(intent = '') {
  updateComposerFromForm()
  state.composer = { ...state.composer, intent: state.composer.intent === intent ? '' : intent, error: '' }
  persistComposerDraft()
  render()
}

function clearComposerIntent() {
  state.composer = { ...state.composer, intent: '', error: '' }
  persistComposerDraft()
  render()
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
  render()
}

let mentionSearchTimer = null

function queueMentionSearch(value = '') {
  const mentionQuery = String(value || '').replace(/^@/, '').trim().toLowerCase()
  state.composer = { ...state.composer, mentionQuery, mentionSearchError: '', mentionResults: mentionQuery.length >= 2 ? state.composer.mentionResults : [] }
  persistComposerDraft()
  window.clearTimeout(mentionSearchTimer)
  if (mentionQuery.length < 2) {
    render()
    return
  }
  state.composer = { ...state.composer, mentionSearchLoading: true }
  render()
  mentionSearchTimer = window.setTimeout(async () => {
    try {
      const rows = await searchProfilesByUsername(mentionQuery)
      const existing = new Set(state.composer.mentionedUsers.map((user) => user.uid))
      state.composer = { ...state.composer, mentionResults: rows.filter((user) => !existing.has(user.uid)), mentionSearchLoading: false, mentionSearchError: '' }
      render()
    } catch (error) {
      state.composer = { ...state.composer, mentionSearchLoading: false, mentionSearchError: error?.message || 'Creator search is unavailable.' }
      render()
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
  render()
}

function removeMentionedUser(uid = '') {
  state.composer = { ...state.composer, mentionedUsers: state.composer.mentionedUsers.filter((item) => item.uid !== uid) }
  persistComposerDraft()
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
  const supportedTabs = new Set(['following', 'new', 'official', 'music', 'products', 'stage-plans', 'studio-projects', 'feedback', 'collaboration', 'forums', 'forms', 'for-you'])
  state.activeTab = supportedTabs.has(tab) ? tab : 'for-you'
  state.activeCommunityId = ''
  state.activeCommunitySlug = ''
  state.activeTopicLabel = activeFeedTitle()
  loadCommunity()
}

function selectTopicCommunity({ communityId = '', slug = '', label = '' } = {}) {
  if (slug) {
    if (!confirmCommunityNavigation()) return
    window.location.assign(communityRoute(slug))
    return
  }
  state.activeTab = 'community'
  state.activeCommunityId = communityId
  state.activeCommunitySlug = slug
  state.activeTopicLabel = label || slug || 'Community'
  state.composer = { ...state.composer, communityId }
  loadCommunity()
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
  updateHorizontalRailFadeState(scroller, app.querySelector('.community-topic-bar'))
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
  if (topicScroller) updateHorizontalRailFadeState(topicScroller, app.querySelector('.community-topic-bar'))
  if (storiesScroller) updateHorizontalRailFadeState(storiesScroller, storiesScroller)
}

function communityModalIsOpen() {
  return Boolean(state.composer.open || state.storyComposer.open || state.storyViewer.open || state.report.open || state.editPost.open || state.createCommunity.open)
}

function activeElementIsCommunityInput() {
  const active = document.activeElement
  return Boolean(active?.closest?.('.community-page input, .community-page textarea, .community-page select, .community-page [contenteditable="true"]'))
}

function setCommunityChromeHidden(hidden = false) {
  document.body.classList.toggle('community-chrome-hidden', Boolean(hidden))
}

function handleCommunityChromeScroll() {
  communityScrollRaf = 0
  if (state.view.type !== 'feed' || communityModalIsOpen() || activeElementIsCommunityInput()) {
    setCommunityChromeHidden(false)
    lastCommunityScrollY = window.scrollY || 0
    return
  }
  const currentY = Math.max(0, window.scrollY || 0)
  const delta = currentY - lastCommunityScrollY
  if (currentY < 24) setCommunityChromeHidden(false)
  else if (delta > 12) setCommunityChromeHidden(true)
  else if (delta < -8) setCommunityChromeHidden(false)
  if (Math.abs(delta) >= 4) lastCommunityScrollY = currentY
}

function scheduleCommunityChromeScroll() {
  if (communityScrollRaf) return
  communityScrollRaf = window.requestAnimationFrame(handleCommunityChromeScroll)
}

function setupCommunityScrollChrome() {
  if (communityScrollChromeReady) return
  communityScrollChromeReady = true
  window.addEventListener('scroll', scheduleCommunityChromeScroll, { passive: true })
  window.addEventListener('focusin', () => setCommunityChromeHidden(false), { passive: true })
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
    if (!communityModalIsOpen()) return
    if (state.composer.open) state.composer = { ...state.composer, open: false, submitting: false, error: '' }
    if (state.storyComposer.open) {
      resetStoryRecording()
      resetStoryPreviewURL()
      state.storyComposer = cleanStoryComposerState()
    }
    if (state.storyViewer.open) state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
    if (state.report.open) state.report = { ...state.report, open: false, submitting: false, error: '' }
    if (state.editPost.open) state.editPost = { open: false, postId: '', title: '', body: '', tags: '', visibility: 'public', submitting: false, error: '' }
    if (state.createCommunity.open) state.createCommunity = { ...state.createCommunity, open: false, submitting: false, error: '' }
    render()
  })
}

function setupCommunityOutsideClick() {
  if (communityOutsideClickReady) return
  communityOutsideClickReady = true
  document.addEventListener('click', (event) => {
    if (!state.openPostMenuId || event.target.closest('[data-post-options-root]')) return
    closePostMenusDom()
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
  feedPaginationObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) loadFeedPage({ reset: false })
  }, { rootMargin: '640px 0px 640px 0px' })
  feedPaginationObserver.observe(sentinel)
}

function isPostCardInteractiveTarget(target) {
  return Boolean(target?.closest?.('a, button, input, textarea, select, label, [role="button"], [data-stop-card-nav]'))
}

function openPostDetail(postId = '', hash = '') {
  const id = String(postId || '').trim()
  if (!id) return
  if (!confirmCommunityNavigation()) return
  const cachedPost = state.posts.find((post) => post.postId === id) || null
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

async function handleCreateCommunitySubmit(event) {
  event.preventDefault()
  const formData = new FormData(event.currentTarget)
  const name = String(formData.get('name') || '').trim()
  const slug = String(formData.get('slug') || '').trim()
  const description = String(formData.get('description') || '').trim()
  const category = String(formData.get('category') || '').trim()
  const postingMode = String(formData.get('postingMode') || '').trim()
  state.createCommunity = { ...state.createCommunity, name, slug, description, category, postingMode, submitting: true, error: '', message: '' }
  render()
  try {
    const result = await createCommunity({ name, slug, description, category, postingMode })
    state.createCommunity = { ...state.createCommunity, submitting: false, message: 'Community created.' }
    await loadCommunities()
    if (result.slug) window.history.replaceState({}, '', communityRoute(result.slug))
    state.view = parseCommunityView()
    await loadCommunity()
  } catch (error) {
    console.warn('[community] create community failed', { code: error?.code, message: error?.message, details: error?.details })
    state.createCommunity = { ...state.createCommunity, submitting: false, error: error?.message || 'Could not create community.' }
    render()
  }
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

async function startStoryRecording() {
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

function openStoryComposer() {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
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

  state.storyComposer = { ...state.storyComposer, text, lifetimeHours, visibility, error: '', submitting: true, uploadProgress: 0 }
  try {
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
      uid: state.currentUser.uid,
      storyId,
      file,
      onProgress: (progress) => {
        state.storyComposer = { ...state.storyComposer, uploadProgress: progress }
        const bar = app?.querySelector('.community-story-progress span')
        const text = app?.querySelector('.community-story-progress em')
        if (bar) bar.style.width = `${Math.max(0, Math.min(100, progress))}%`
        if (text) text.textContent = `${progress}%`
      }
    })
    const result = await createCommunityStory({
      storyId,
      mediaType: uploaded.mediaType,
      text,
      caption: text,
      mediaPath: uploaded.mediaPath,
      lifetimeHours,
      visibility,
      background: state.storyComposer.background
    })
    const story = normalizeCommunityStory({
      ...(result.story || {}),
      mediaURL: uploaded.mediaURL || result.story?.mediaURL || ''
    }, result.storyId)
    state.stories = [story, ...state.stories.filter((item) => item.storyId !== story.storyId)]
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
    console.warn('[community] create story failed', { code: error?.code, message: error?.message, details: error?.details })
    state.storyComposer = { ...state.storyComposer, submitting: false, error: error?.message || 'Could not publish this story.' }
    render()
  }
}

function openStoryViewer(storyId = '') {
  const story = storyById(storyId)
  if (!story) return
  const alreadyOpen = state.storyViewer.open && state.storyViewer.storyId === storyId
  state.storyViewer = { open: true, storyId, loading: false, error: '' }
  if (!alreadyOpen) render()
  if (recordedStoryViews.has(storyId)) return
  recordedStoryViews.add(storyId)
  recordCommunityStoryView(storyId).then((result) => {
    if (Number.isFinite(Number(result.viewCount))) {
      state.stories = state.stories.map((item) => item.storyId === storyId ? { ...item, viewCount: Number(result.viewCount) } : item)
    }
  }).catch((error) => {
    console.warn('[community] story view count failed', { code: error?.code, message: error?.message, details: error?.details })
    recordedStoryViews.delete(storyId)
  })
}

function advanceStory(delta = 1) {
  if (!state.stories.length) return
  const nextIndex = (currentStoryIndex() + delta + state.stories.length) % state.stories.length
  openStoryViewer(state.stories[nextIndex].storyId)
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
    await deleteCommunityStory({ storyId })
    state.stories = state.stories.filter((item) => item.storyId !== storyId)
    state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
    state.message = 'Story deleted.'
    render()
    window.setTimeout(() => {
      state.message = ''
      render()
    }, 3000)
  } catch (error) {
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

function openCommentReport(commentId) {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.report = { open: true, targetType: 'community_comment', postId: state.detailPostId, commentId, storyId: '', reason: REPORT_REASONS[0], description: '', submitting: false, error: '', message: '' }
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
  const comment = findLoadedComment(state.report.commentId)
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
      sourcePath: window.location.pathname,
      metadata: targetType === 'community_comment'
        ? { postId: post.postId, commentId: comment.commentId }
        : targetType === 'community_story'
          ? { storyId: story.storyId, mediaType: story.mediaType }
          : { postTitle: post.title, postType: post.type }
    }))
    state.report = { ...state.report, submitting: false, message: 'Thank you. Your report has been submitted.' }
    render()
  } catch (error) {
    console.warn('[community] report failed', { code: error?.code, message: error?.message, details: error?.details })
    state.report = { ...state.report, submitting: false, error: error?.message || 'Could not submit this report.' }
    render()
  }
}

function bindCommentEvents(root = app) {
  if (!root) return
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
  root.querySelectorAll('[data-community-comment-delete]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleCommentDelete(button.getAttribute('data-community-comment-delete'))
  }))
  root.querySelectorAll('[data-community-comment-report]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    openCommentReport(button.getAttribute('data-community-comment-report'))
  }))
}

function bindEvents() {
  setupCommunityPendingLeaveWarning()
  app.querySelectorAll('.community-post-card[data-post-id]:not(.is-detail)').forEach((card) => {
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
  app.querySelectorAll('.community-post-card a, .community-post-card button, .community-post-card input, .community-post-card textarea, .community-post-card select, .community-post-card label').forEach((element) => {
    element.addEventListener('click', (event) => event.stopPropagation())
  })
  app.querySelectorAll('[data-toggle-post-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      togglePostMenuDom(button.getAttribute('data-toggle-post-menu') || '')
    })
  })
  app.querySelectorAll('[data-copy-post-link]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      copyPostLink(button.getAttribute('data-copy-post-link') || '')
    })
  })
  setupCommunityOutsideClick()
  app.querySelectorAll('[data-community-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      selectTopicTab(button.getAttribute('data-community-tab') || 'for-you')
    })
  })
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
  app.querySelectorAll('[data-community-tag]').forEach((button) => {
    button.addEventListener('click', (event) => {
      stopCommunityActionEvent(event)
      selectTagFilter(button.getAttribute('data-community-tag') || '')
    })
  })
  app.querySelectorAll('[data-topic-community-id]').forEach((button) => {
    button.addEventListener('click', () => {
      selectTopicCommunity({
        communityId: button.getAttribute('data-topic-community-id') || '',
        slug: button.getAttribute('data-topic-community-slug') || '',
        label: button.getAttribute('data-topic-community-label') || ''
      })
    })
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
  app.querySelector('[data-load-more-posts]')?.addEventListener('click', () => loadFeedPage({ reset: false }))
  setupCommunityScrollChrome()
  setupCommunityKeyboardShortcuts()
  setupFeedPaginationObserver()
  app.querySelectorAll('[data-open-community-composer]').forEach((button) => button.addEventListener('click', openCommunityComposer))
  app.querySelectorAll('[data-close-community-composer]').forEach((button) => button.addEventListener('click', closeCommunityComposer))
  app.querySelectorAll('[data-story-coming-soon]').forEach((button) => {
    button.addEventListener('click', () => showCommunityToast('Story placeholders will be replaced as creators publish.'))
  })
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
  app.querySelector('[data-story-file]')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null
    try {
      const { mediaType } = validateCommunityStoryMedia(file)
      setStoryFile(file, mediaType)
    } catch (error) {
      resetStoryPreviewURL()
      state.storyComposer = { ...state.storyComposer, file: null, previewURL: '', error: error?.message || 'Choose a supported story video or image.' }
    }
    render()
  })
  app.querySelector('[data-story-lifetime]')?.addEventListener('change', (event) => {
    state.storyComposer = { ...state.storyComposer, lifetimeHours: Math.min(48, Math.max(1, Number(event.target.value || 24))) }
  })
  app.querySelector('[data-start-story-recording]')?.addEventListener('click', startStoryRecording)
  app.querySelector('[data-stop-story-recording]')?.addEventListener('click', stopStoryRecording)
  app.querySelector('[data-story-composer-form]')?.addEventListener('submit', handleStorySubmit)
  app.querySelector('[data-close-story-composer]')?.addEventListener('click', () => {
    resetStoryRecording()
    resetStoryPreviewURL()
    state.storyComposer = cleanStoryComposerState()
    render()
  })
  bindStoryRecordingPreview()
  app.querySelectorAll('[data-open-story]').forEach((button) => button.addEventListener('click', () => openStoryViewer(button.getAttribute('data-open-story') || '')))
  app.querySelector('[data-close-story-viewer]')?.addEventListener('click', () => {
    state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
    render()
  })
  app.querySelector('[data-story-prev]')?.addEventListener('click', () => advanceStory(-1))
  app.querySelector('[data-story-next]')?.addEventListener('click', () => advanceStory(1))
  app.querySelectorAll('[data-story-reaction]').forEach((button) => button.addEventListener('click', () => {
    showCommunityToast('Story reactions are coming soon.')
  }))
  app.querySelector('[data-story-comment-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    showCommunityToast('Story comments are coming soon.')
  })
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
  app.querySelectorAll('[data-set-composer-intent]').forEach((button) => button.addEventListener('click', () => setComposerIntent(button.getAttribute('data-set-composer-intent') || '')))
  app.querySelectorAll('[data-clear-composer-intent]').forEach((button) => button.addEventListener('click', clearComposerIntent))
  app.querySelector('[data-toggle-emoji-panel]')?.addEventListener('click', () => {
    updateComposerFromForm()
    state.composer = { ...state.composer, emojiOpen: !state.composer.emojiOpen }
    render()
  })
  app.querySelectorAll('[data-insert-emoji]').forEach((button) => button.addEventListener('click', () => insertEmoji(button.getAttribute('data-insert-emoji') || '')))
  app.querySelector('[data-mention-search]')?.addEventListener('input', (event) => queueMentionSearch(event.target.value))
  app.querySelectorAll('[data-select-mentioned-user]').forEach((button) => button.addEventListener('click', () => selectMentionedUser(button.getAttribute('data-select-mentioned-user') || '')))
  app.querySelectorAll('[data-remove-mentioned-user]').forEach((button) => button.addEventListener('click', () => removeMentionedUser(button.getAttribute('data-remove-mentioned-user') || '')))
  app.querySelector('[data-reload-community]')?.addEventListener('click', loadCommunity)
  app.querySelector('[data-open-create-community]')?.addEventListener('click', () => {
    state.createCommunity = { ...state.createCommunity, open: true, error: '', message: '' }
    render()
  })
  app.querySelector('[data-close-create-community]')?.addEventListener('click', () => {
    state.createCommunity = { ...state.createCommunity, open: false, submitting: false, error: '' }
    render()
  })
  app.querySelector('[data-create-community-form]')?.addEventListener('submit', handleCreateCommunitySubmit)
  app.querySelector('[data-community-search]')?.addEventListener('input', (event) => {
    state.communityFilters.search = event.target.value
    window.clearTimeout(state.communitySearchTimer)
    state.communitySearchTimer = window.setTimeout(loadCommunities, 250)
  })
  app.querySelector('[data-community-category]')?.addEventListener('change', (event) => {
    state.communityFilters.category = event.target.value
    loadCommunities()
  })
  app.querySelectorAll('[data-toggle-community-focus]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleToggleFocus(button.getAttribute('data-toggle-community-focus'))
  }))
  app.querySelectorAll('[data-community-like]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleLike(button.getAttribute('data-community-like'))
  }))
  app.querySelectorAll('[data-community-dislike]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleDislike(button.getAttribute('data-community-dislike'))
  }))
  app.querySelectorAll('[data-community-save]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleSave(button.getAttribute('data-community-save'))
  }))
  app.querySelectorAll('[data-community-share]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleShare(button.getAttribute('data-community-share'))
  }))
  app.querySelectorAll('[data-scroll-comments]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    app.querySelector('#comments')?.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }))
  app.querySelectorAll('[data-community-report]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    openReport(button.getAttribute('data-community-report'))
  }))
  app.querySelectorAll('[data-community-delete-post]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    handleDeleteOwnPost(button.getAttribute('data-community-delete-post') || '')
  }))
  app.querySelectorAll('[data-community-edit-post]').forEach((button) => button.addEventListener('click', (event) => {
    stopCommunityActionEvent(event)
    openEditPost(button.getAttribute('data-community-edit-post') || '')
  }))
  app.querySelector('[data-community-edit-post-form]')?.addEventListener('submit', handleEditPostSubmit)
  app.querySelectorAll('[data-close-edit-post]').forEach((button) => button.addEventListener('click', closeEditPostModal))
  bindCommentEvents(app)
  app.querySelectorAll('[data-close-community-report]').forEach((button) => {
    button.addEventListener('click', () => {
      state.report = { ...state.report, open: false, submitting: false, error: '' }
      render()
    })
  })
  app.querySelector('[data-community-report-form]')?.addEventListener('submit', handleReportSubmit)
}

waitForInitialAuthState().then((user) => {
  state.currentUser = user
  render()
  return loadCommunity()
})
subscribeToAuthState((user) => {
  state.currentUser = user
  Promise.all([loadViewerState(), loadCommentViewerState()]).then(render).catch(() => render())
})

window.addEventListener('popstate', () => {
  state.detailPostId = parseDetailPostId()
  state.view = parseCommunityView()
  state.activeTag = normalizeTagKey(parseFeedParam('tag'))
  state.feedSearch = parseFeedParam('search').trim()
  state.feedSearchInput = state.feedSearch
  state.feedSort = ['new', 'top-today', 'top-week', 'most-discussed'].includes(parseFeedParam('sort')) ? parseFeedParam('sort') : 'new'
  loadCommunity()
})
