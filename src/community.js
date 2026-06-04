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
  listCommunityComments,
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
  toggleCommunityFocus,
  toggleCommunityPostLike,
  toggleCommunityPostSave,
  uploadCommunityStoryImage
} from './data/communityService'
import { searchProfilesByUsername } from './data/profileSearchService'
import { ROUTES, authRoute, communityPostRoute, communityRoute, productRoute, publicProfileRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import { formatUsername } from './utils/format'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')
const COMMUNITY_PAGE_SIZE = 12
const FALLBACK_TOPIC_LABELS = ['StageMaker', 'Vocals', 'Sound Design', 'Sample Packs', 'Mixing & Mastering', 'Metalcore', 'Live Production', 'Feedback', 'Dubstep', 'Logic', 'Ableton', 'Serum', 'Vital']
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
    mediaType: 'text',
    text: '',
    background: 'aurora',
    file: null,
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
  commentViewerState: {},
  commentsLoading: false,
  commentsError: '',
  commentDraft: '',
  replyDrafts: {},
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

function logCommunityPerf(label, data = {}) {
  if (!COMMUNITY_DEBUG) return
  console.debug('[community:perf]', label, data)
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

function storyExpiresLabel(value = '') {
  const expiresMs = new Date(value || 0).getTime()
  if (!Number.isFinite(expiresMs)) return '24h'
  const diffMs = expiresMs - Date.now()
  if (diffMs <= 0) return 'Expired'
  const minutes = Math.ceil(diffMs / 60000)
  if (minutes < 60) return `${minutes}m left`
  return `${Math.ceil(minutes / 60)}h left`
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
  if (story.authorAvatarURL) return `<img src="${escapeHtml(story.authorAvatarURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />`
  return `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

function activeFeedTitle() {
  if (state.activeTab === 'music') return 'Music'
  if (state.activeTab === 'products') return 'Products'
  if (state.activeTab === 'stage-plans') return 'Stage Plans'
  if (state.activeTab === 'studio-projects') return 'Studio Projects'
  if (state.activeTab === 'feedback') return 'Feedback'
  if (state.activeTab === 'collaboration') return 'Collaboration'
  if (state.activeTab === 'following') return 'Focused'
  if (state.activeTab === 'community') return state.activeTopicLabel || 'Community'
  if (state.activeTab === 'placeholder') return state.activeTopicLabel || 'Community'
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
  return state.communities
    .filter((community) => community.status === 'active' && community.visibility === 'public')
    .slice(0, 18)
}

function renderTopicBar() {
  const communities = visibleTopicCommunities()
  const communityPills = communities.length
    ? communities.map((community) => `
      <button type="button" class="community-topic-pill ${state.activeTab === 'community' && state.activeCommunityId === community.communityId ? 'is-active' : ''}" data-topic-community-id="${escapeHtml(community.communityId)}" data-topic-community-slug="${escapeHtml(community.slug)}" data-topic-community-label="${escapeHtml(community.name)}">
        ${escapeHtml(community.name)}
      </button>
    `).join('')
    : FALLBACK_TOPIC_LABELS.map((label) => `
      <button type="button" class="community-topic-pill is-placeholder ${state.activeTab === 'placeholder' && state.activeTopicLabel === label ? 'is-active' : ''}" data-topic-placeholder="${escapeHtml(label)}">
        ${escapeHtml(label)}
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
  const placeholderItems = DUMMY_STORIES.map((story) => `
    <button type="button" class="community-story-item is-placeholder" data-story-coming-soon="${escapeHtml(story.label)}">
      <span class="community-story-ring"><span class="community-story-avatar">${escapeHtml(story.initials)}</span></span>
      <strong>${escapeHtml(story.label)}</strong>
    </button>
  `).join('')
  const realStoryItems = state.stories.slice(0, 12).map((story) => `
    <button type="button" class="community-story-item" data-open-story="${escapeHtml(story.storyId)}">
      <span class="community-story-ring"><span class="community-story-avatar ${story.mediaType === 'text' ? `story-bg-${escapeHtml(story.background)}` : ''}">
        ${story.mediaType === 'image' && story.mediaURL ? `<img src="${escapeHtml(story.mediaURL)}" alt="" loading="lazy" />` : storyAvatar(story)}
      </span></span>
      <strong>${escapeHtml(story.authorDisplayName || story.authorUsername || 'Creator')}</strong>
    </button>
  `).join('')

  return `
    <section class="community-stories-row" aria-label="Community stories">
      <button type="button" class="community-story-item is-create" data-story-coming-soon="Your Story">
        <span class="community-story-ring"><span class="community-story-avatar is-create">${iconSvg('folderPlus')}</span></span>
        <strong>Your Story</strong>
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
  const textLabel = state.storyComposer.mediaType === 'image' ? 'Caption' : 'Story text'
  const textPlaceholder = state.storyComposer.mediaType === 'image' ? 'Optional caption...' : 'What are you sharing today?'
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
              <button type="button" data-story-media-type="text" class="${state.storyComposer.mediaType === 'text' ? 'is-active' : ''}">${iconSvg('fileText')} <span>Text</span></button>
              <button type="button" data-story-media-type="image" class="${state.storyComposer.mediaType === 'image' ? 'is-active' : ''}">${iconSvg('image')} <span>Image</span></button>
            </div>
            <label>
              <span>${textLabel}</span>
              <textarea name="text" maxlength="500" rows="5" placeholder="${textPlaceholder}">${escapeHtml(state.storyComposer.text)}</textarea>
            </label>
            ${state.storyComposer.mediaType === 'text' ? `
              <div class="community-story-backgrounds" role="group" aria-label="Story background">
                ${STORY_BACKGROUNDS.map((background) => `
                  <button type="button" data-story-background="${escapeHtml(background.id)}" class="story-bg-${escapeHtml(background.id)} ${state.storyComposer.background === background.id ? 'is-active' : ''}">
                    <span>${escapeHtml(background.label)}</span>
                  </button>
                `).join('')}
              </div>
            ` : `
              <label>
                <span>Image</span>
                <input name="storyImage" type="file" accept="image/*" data-story-file />
              </label>
              ${state.storyComposer.file ? `<p class="community-story-file">${escapeHtml(state.storyComposer.file.name || 'Image selected')}</p>` : ''}
            `}
            ${state.storyComposer.error ? `<p class="community-error">${escapeHtml(state.storyComposer.error)}</p>` : ''}
            <div class="community-form-actions">
              <span>Stories expire after 24 hours.</span>
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
        <div class="community-story-surface story-bg-${escapeHtml(story.background || 'aurora')} ${story.mediaType === 'image' ? 'has-image' : ''}">
          ${story.mediaType === 'image' && story.mediaURL ? `<img src="${escapeHtml(story.mediaURL)}" alt="" />` : `<p>${escapeHtml(story.text)}</p>`}
          ${story.mediaType === 'image' && story.text ? `<p class="community-story-caption">${escapeHtml(story.text)}</p>` : ''}
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
          <label class="community-composer-title-field">
            <span>Title</span>
            <input name="title" maxlength="120" value="${escapeHtml(state.composer.title)}" placeholder="Optional headline" />
          </label>
          <label class="community-composer-body-field">
            <span>Body</span>
            <textarea name="body" maxlength="2000" rows="8" placeholder="Share an update, question, idea, product note, or creative win." data-composer-body>${escapeHtml(state.composer.body)}</textarea>
          </label>
          ${renderAttachmentToolbar()}
          ${renderEmojiPanel()}
          ${renderComposerProductPicker()}
          ${renderComposerMusicPicker()}
          ${renderComposerStagePicker()}
          ${renderComposerStudioPicker()}
          ${renderComposerAttachments()}
          ${renderMentionPicker()}
          ${renderComposerIntentFields()}
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

function postCard(post, { detail = false } = {}) {
  const viewer = state.viewerState[post.postId] || {}
  const body = detail ? post.body : post.body.slice(0, 640)
  const authorHref = post.authorUid ? publicProfileRoute({ uid: post.authorUid }) : ROUTES.profilePublic
  const isOwn = state.currentUser?.uid && state.currentUser.uid === post.authorUid
  const pinned = pinnedPostIds().has(post.postId) || post.pinnedInCommunity
  return `
    <article class="community-post-card" data-post-id="${escapeHtml(post.postId)}" data-post-href="${communityPostRoute(post.postId)}" role="link" tabindex="0" aria-label="Open post ${escapeHtml(post.title || 'detail')}">
      <header class="community-post-header">
        <a class="community-author" href="${authorHref}">
          <span class="community-avatar">${postAvatar(post)}</span>
          <span>
            <strong>${escapeHtml(post.authorDisplayName || 'Melogic Creator')}</strong>
            <em>${escapeHtml(formatUsername(post.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(post.createdAt))}</em>
          </span>
        </a>
        <div class="community-post-badges">
          ${pinned ? `<span class="community-badge is-pinned">${iconSvg('star')} Pinned</span>` : ''}
          ${post.communitySlug ? `<a class="community-badge" href="${communityRoute(post.communitySlug)}">c/${escapeHtml(post.communitySlug)}</a>` : ''}
          ${post.official ? '<span class="community-badge">Official</span>' : ''}
          ${post.intent === 'feedback_request' ? '<span class="community-badge">Feedback Requested</span>' : ''}
          ${post.intent === 'collaboration_request' ? '<span class="community-badge">Looking for Collaborators</span>' : ''}
        </div>
      </header>
      ${post.title ? `<h2>${escapeHtml(post.title)}</h2>` : ''}
      <p class="community-post-body">${escapeHtml(body)}${!detail && post.body.length > body.length ? '...' : ''}</p>
      ${renderPostIntent(post)}
      ${renderPostAttachments(post)}
      ${post.tags.length ? `<div class="community-tags">${post.tags.map((tag) => `<button type="button" data-community-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</button>`).join('')}</div>` : ''}
      <footer class="community-post-actions">
        <button type="button" class="${viewer.liked ? 'is-active' : ''}" data-community-like="${escapeHtml(post.postId)}">${iconSvg('thumbsUp')} <span>Like</span><em>${formatCount(post.counts.likes)}</em></button>
        <a href="${communityPostRoute(post.postId)}#comments">${iconSvg('messageCircle')} <span>${post.intent === 'feedback_request' ? 'Give Feedback' : 'Comment'}</span><em>${formatCount(post.counts.comments)}</em></a>
        <button type="button" class="${viewer.saved ? 'is-active' : ''}" data-community-save="${escapeHtml(post.postId)}">${iconSvg('bookmark')} <span>Save</span><em>${formatCount(post.counts.saves)}</em></button>
        <button type="button" data-community-share="${escapeHtml(post.postId)}">${iconSvg('share2')} <span>Share</span><em>${formatCount(post.counts.shares)}</em></button>
        <button type="button" data-community-report="${escapeHtml(post.postId)}">${iconSvg('alertCircle')} <span>Report</span></button>
        ${isOwn ? `<button type="button" data-community-delete-post="${escapeHtml(post.postId)}">${iconSvg('trash')} <span>Delete</span></button>` : ''}
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
  return `
    <form class="community-comment-composer" ${isReply ? `data-community-reply-form="${escapeHtml(parentCommentId)}"` : 'data-community-comment-form'}>
      <label>
        <span>${isReply ? 'Reply' : 'Comment'}</span>
        <textarea name="body" maxlength="2000" rows="${isReply ? '3' : '4'}" placeholder="${isReply ? 'Write a reply...' : 'Start the conversation...'}">${escapeHtml(body)}</textarea>
      </label>
      <div class="community-comment-form-actions">
        <span>${Math.max(0, 2000 - body.length)} characters left</span>
        ${isReply ? `<button type="button" class="button button-muted" data-cancel-reply-composer="${escapeHtml(parentCommentId)}">Cancel</button>` : ''}
        <button type="submit" class="button button-accent" ${state.commentSubmitting ? 'disabled' : ''}>${state.commentSubmitting ? 'Posting...' : isReply ? 'Reply' : 'Post Comment'}</button>
      </div>
    </form>
  `
}

function commentCard(comment, replies = []) {
  const viewer = state.commentViewerState[comment.commentId] || {}
  const isOwn = state.currentUser?.uid && state.currentUser.uid === comment.authorUid
  const authorHref = comment.authorUid ? publicProfileRoute({ uid: comment.authorUid }) : ROUTES.profilePublic
  const canReply = !comment.parentCommentId
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
        ${canReply ? `<button type="button" data-toggle-reply-composer="${escapeHtml(comment.commentId)}">${iconSvg('messageCircle')} <span>Reply</span></button>` : ''}
        <button type="button" data-community-comment-report="${escapeHtml(comment.commentId)}">${iconSvg('alertCircle')} <span>Report</span></button>
        ${isOwn ? `<button type="button" data-community-comment-delete="${escapeHtml(comment.commentId)}">${iconSvg('trash')} <span>Delete</span></button>` : ''}
      </footer>
      ${state.replyComposerFor === comment.commentId ? renderCommentComposer({ parentCommentId: comment.commentId }) : ''}
      ${replies.length ? `<div class="community-comment-replies">${replies.map((reply) => commentCard(reply)).join('')}</div>` : ''}
    </article>
  `
}

function renderComments(post) {
  const topLevel = state.comments.filter((comment) => !comment.parentCommentId)
  const repliesByParent = state.comments.reduce((map, comment) => {
    if (!comment.parentCommentId) return map
    if (!map[comment.parentCommentId]) map[comment.parentCommentId] = []
    map[comment.parentCommentId].push(comment)
    return map
  }, {})
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
      ${state.commentsLoading ? '<p class="community-comments-state">Loading comments...</p>' : state.commentsError ? `<p class="community-error">${escapeHtml(state.commentsError)}</p>` : topLevel.length ? `<div class="community-comment-list">${topLevel.map((comment) => commentCard(comment, repliesByParent[comment.commentId] || [])).join('')}</div>` : '<p class="community-comments-empty">No comments yet. Start the conversation.</p>'}
    </section>
  `
}

function emptyCopy() {
  if (state.activeTab === 'following') return state.currentUser ? 'Focus communities to build this feed.' : 'Sign in to focus communities.'
  if (state.activeTab === 'community') return `No posts in ${state.activeTopicLabel || 'this community'} yet.`
  if (state.activeTab === 'placeholder') return `${state.activeTopicLabel || 'This topic'} is a placeholder space for now. Browse real communities or create a post in the general feed.`
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

function renderCommunityCard(community) {
  const focused = Boolean(state.communityFocus[community.communityId])
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
        <button type="button" class="button ${focused ? 'button-muted' : 'button-accent'}" data-toggle-community-focus="${escapeHtml(community.communityId)}">${focused ? 'Focused' : 'Focus'}</button>
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
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'community' })}
    <main class="community-page">
      <section class="community-hero compact">
        <div>
          <p class="eyebrow">Focused Communities</p>
          <h1>Communities</h1>
          <p>Find focused spaces for genres, production, StageMaker, feedback, and creator support.</p>
        </div>
        <button type="button" class="button button-accent" data-open-create-community>Create Community</button>
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
          ${state.communityFilters.loading ? '<section class="community-feed-state community-panel">Loading communities...</section>' : state.communityFilters.error ? `<section class="community-feed-state community-panel"><strong>Could not load communities.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>` : state.communities.length ? `<section class="community-community-grid">${state.communities.map(renderCommunityCard).join('')}</section>` : '<section class="community-feed-state community-panel">No communities yet.</section>'}
        </div>
        ${renderSidebar()}
      </div>
    </main>
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

function renderLeftNav() {
  const navItems = [
    { label: 'Home', icon: 'home', href: ROUTES.community },
    { label: 'For You', icon: 'star', tab: 'for-you', active: state.activeTab === 'for-you' },
    { label: 'Focused', icon: 'eye', tab: 'following', active: state.activeTab === 'following' },
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
      <button type="button" class="community-left-post-button" data-open-community-composer>${iconSvg('folderPlus')} <span>Post</span></button>
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

function trendingTags() {
  const counts = state.posts.reduce((map, post) => {
    ;(post.tags || []).forEach((tag) => {
      const clean = String(tag || '').replace(/^#/, '').trim().toLowerCase()
      if (clean) map.set(clean, (map.get(clean) || 0) + 1)
    })
    return map
  }, new Map())
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
}

function renderSidebar() {
  const suggested = visibleTopicCommunities().slice(0, 4)
  const tags = trendingTags()
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
                <button type="button" data-toggle-community-focus="${escapeHtml(community.communityId)}">${state.communityFocus[community.communityId] ? 'Focused' : 'Focus'}</button>
              </article>
            `).join('')}
          </div>
        ` : '<p>Communities will appear here as creators focus spaces.</p>'}
      </section>
      <section class="community-rail-card">
        <h2>Trending Tags</h2>
        ${tags.length ? `<div class="community-trending-tags">${tags.map(([tag, count]) => `<button type="button" data-community-tag="${escapeHtml(tag)}">#${escapeHtml(tag)} <em>${formatCount(count)}</em></button>`).join('')}</div>` : '<p>Tags will populate once posts start moving.</p>'}
      </section>
      <section class="community-rail-card">
        <h2>Creator History</h2>
        <p>This Day in History will connect to a richer music and creator-history source in a later phase.</p>
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
  return `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'community' })}
    <main class="community-page">
      <section class="community-hero compact">
        <div>
          <p class="eyebrow">Community</p>
          <h1>Post</h1>
          <p>Full community post view and action surface.</p>
        </div>
        <a class="button button-muted" href="${ROUTES.community}">Back to Community</a>
      </section>
      <div class="community-layout is-detail">
        <div>
          ${state.loading ? '<section class="community-feed-state community-panel">Loading post...</section>' : state.error ? `<section class="community-feed-state community-panel"><strong>Could not load post.</strong><span>${escapeHtml(state.error)}</span></section>` : post ? postCard(post, { detail: true }) : '<section class="community-feed-state community-panel">This post is not available.</section>'}
        </div>
        ${renderSidebar()}
      </div>
      ${renderStoryComposerModal()}
      ${renderStoryViewerModal()}
      ${renderReportModal()}
    </main>
  `
}

function renderCommunityDetail() {
  const community = state.community
  const focused = community ? Boolean(state.communityFocus[community.communityId]) : false
  return `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'community' })}
    <main class="community-page">
      <section class="community-hero compact community-community-hero">
        <div>
          <p class="eyebrow">Community</p>
          <h1>${community ? escapeHtml(community.name) : 'Community'}</h1>
          <p>${community ? escapeHtml(community.description) : 'Loading community...'}</p>
          ${community ? `<div class="community-community-stats hero-stats"><span>c/${escapeHtml(community.slug)}</span><span>${formatCount(community.focusCount)} focused</span><span>${formatCount(community.postCount)} posts</span></div>` : ''}
        </div>
        <div class="community-hero-actions">
          <a class="button button-muted" href="${ROUTES.communityCommunities}">All Communities</a>
          ${community ? `<button type="button" class="button ${focused ? 'button-muted' : 'button-accent'}" data-toggle-community-focus="${escapeHtml(community.communityId)}">${focused ? 'Focused' : 'Focus'}</button>` : ''}
        </div>
      </section>
      <div class="community-layout">
        <div class="community-main">
          ${community ? renderFeedToolbar() : ''}
          ${state.communityFilters.loading ? '<section class="community-feed-state community-panel">Loading community...</section>' : state.communityFilters.error ? `<section class="community-feed-state community-panel"><strong>Could not load community.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>` : community ? renderFeed() : '<section class="community-feed-state community-panel">This community is not available.</section>'}
        </div>
        <aside class="community-sidebar">
          <section class="community-panel">
            <h2>Rules</h2>
            <p>Community rules and moderator notes are coming next.</p>
          </section>
          <section class="community-panel">
            <h2>Moderators</h2>
            <p>${community?.moderatorIds?.length ? `${community.moderatorIds.length} moderator${community.moderatorIds.length === 1 ? '' : 's'}` : 'Moderator profiles will appear here.'}</p>
          </section>
          <section class="community-panel">
            <h2>Guidelines</h2>
            <p>Share work, give useful feedback, and respect creator ownership.</p>
          </section>
        </aside>
      </div>
      ${renderComposerModal()}
      ${renderStoryComposerModal()}
      ${renderStoryViewerModal()}
      ${renderReportModal()}
    </main>
  `
}

function hydrateShell() {
  const logoReadyPromise = initShellChrome().catch((error) => {
    console.warn('[community] shell init failed', { message: error?.message })
    return false
  })
  createCriticalAssetPreloader({ logoReadyPromise, heroReadyPromise: Promise.resolve(true) })
}

function renderFeedToolbar() {
  const title = state.view.type === 'community' && state.community ? state.community.name : activeFeedTitle()
  const subtitle = state.view.type === 'community' && state.community
    ? `Posts in c/${state.community.slug}.`
    : state.activeTab === 'following'
    ? 'Posts from communities you focus.'
    : state.activeTab === 'community'
      ? 'Posts from this community.'
      : state.activeTab === 'placeholder'
        ? 'This is a placeholder topic until the real community exists.'
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
        <button type="button" class="button button-accent" data-open-community-composer>${iconSvg('folderPlus')} <span>Post</span></button>
      </div>
    </section>
  `
}

function render() {
  if (!app) return
  if (state.view.type !== 'feed' || communityModalIsOpen()) setCommunityChromeHidden(false)
  if (state.detailPostId) {
    app.innerHTML = renderDetail()
    bindEvents()
    hydrateShell()
    return
  }
  if (state.view.type === 'communities') {
    app.innerHTML = renderCommunitiesView()
    bindEvents()
    hydrateShell()
    return
  }
  if (state.view.type === 'community') {
    app.innerHTML = renderCommunityDetail()
    bindEvents()
    hydrateShell()
    return
  }

  app.innerHTML = `
    ${renderPagePreloaderMarkup()}
    ${navShell({ currentPage: 'community' })}
    <main class="community-page">
      ${renderCommunityScrollChrome()}
      ${state.message ? `<p class="community-toast">${escapeHtml(state.message)}</p>` : ''}
      <div class="community-layout is-home">
        ${renderLeftNav()}
        <div class="community-main">
          ${renderFeedToolbar()}
          ${renderFeed()}
        </div>
        ${renderSidebar()}
      </div>
      ${renderComposerModal()}
      ${renderStoryComposerModal()}
      ${renderStoryViewerModal()}
      ${renderReportModal()}
    </main>
  `
  bindEvents()
  hydrateShell()
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
  if (!state.currentUser?.uid || !state.detailPostId || !state.comments.length) {
    state.commentViewerState = {}
    return
  }
  const entries = await Promise.all(state.comments.map(async (comment) => [
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
      recordCommunityStoryView(requestedStoryId).then((result) => {
        if (Number.isFinite(Number(result.viewCount))) {
          state.stories = state.stories.map((story) => story.storyId === requestedStoryId ? { ...story, viewCount: Number(result.viewCount) } : story)
          render()
        }
      }).catch(() => null)
    }
  } catch (error) {
    console.warn('[community] stories load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.storiesError = error?.message || 'Stories could not be loaded.'
  } finally {
    state.storiesLoading = false
    if (renderAfter) render()
  }
}

async function loadComments({ renderAfter = true } = {}) {
  if (!state.detailPostId) return
  state.commentsLoading = true
  state.commentsError = ''
  if (renderAfter) render()
  try {
    state.comments = await listCommunityComments(state.detailPostId)
    await loadCommentViewerState()
  } catch (error) {
    console.warn('[community] comments load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentsError = error?.message || 'Comments could not be loaded.'
  } finally {
    state.commentsLoading = false
    if (renderAfter) render()
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
    if (state.activeTab === 'placeholder') {
      posts = []
      hasMore = false
    } else if (state.activeTab === 'following') {
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
    state.loading = true
    render()
    try {
      const post = await getCommunityPost(state.detailPostId)
      state.posts = post ? [post] : []
      state.comments = []
      state.commentViewerState = {}
      if (post) await loadComments({ renderAfter: false })
      await loadViewerState()
      await loadAttachmentMediaUrls()
    } catch (error) {
      console.warn('[community] detail load failed', { code: error?.code, message: error?.message, details: error?.details })
      state.error = error?.message || 'This post could not be loaded.'
    } finally {
      state.loading = false
      render()
    }
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
      state.communities = community ? [community] : []
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
  state.posts = state.posts.map((post) => post.postId === postId ? normalizeCommunityPost({ ...post, counts: { ...post.counts, ...patch } }, postId) : post)
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
    state.viewerState[post.postId] = { liked: false, saved: false }
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
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const result = await toggleCommunityPostLike(postId)
  state.viewerState[postId] = { ...(state.viewerState[postId] || {}), liked: Boolean(result.active) }
  if (Number.isFinite(Number(result.likesCount))) updatePostCounts(postId, { likes: Number(result.likesCount) })
  render()
}

async function handleSave(postId) {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const result = await toggleCommunityPostSave(postId)
  state.viewerState[postId] = { ...(state.viewerState[postId] || {}), saved: Boolean(result.active) }
  if (Number.isFinite(Number(result.savesCount))) updatePostCounts(postId, { saves: Number(result.savesCount) })
  render()
}

async function handleShare(postId) {
  const url = `${window.location.origin}${communityPostRoute(postId)}`
  await navigator.clipboard?.writeText(url).catch(() => null)
  state.message = 'Post link copied.'
  if (state.currentUser) {
    recordCommunityPostShare(postId).then((result) => {
      if (Number.isFinite(Number(result.sharesCount))) {
        updatePostCounts(postId, { shares: Number(result.sharesCount) })
        render()
      }
    }).catch((error) => console.warn('[community] share count failed', { code: error?.code, message: error?.message }))
  }
  render()
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
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  if (!window.confirm('Hide this post from the community?')) return
  try {
    await deleteOwnCommunityPost({ postId, reason: 'Author removed post from community.' })
    state.posts = state.posts.filter((post) => post.postId !== postId)
    state.message = 'Post removed.'
    render()
  } catch (error) {
    console.warn('[community] delete post failed', { code: error?.code, message: error?.message, details: error?.details })
    state.message = error?.message || 'Could not remove this post.'
    render()
  }
}

function updateCommentCount(commentId, patch = {}) {
  state.comments = state.comments.map((comment) => comment.commentId === commentId ? normalizeCommunityComment({ ...comment, ...patch }, commentId) : comment)
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
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const formData = new FormData(event.currentTarget)
  const body = String(formData.get('body') || '').trim()
  state.commentDraft = body
  state.commentActionError = ''
  if (!body) {
    state.commentActionError = 'Comment body is required.'
    render()
    return
  }
  state.commentSubmitting = true
  render()
  try {
    const result = await createCommunityComment({ postId: state.detailPostId, body })
    const comment = normalizeCommunityComment(result.comment || {}, result.commentId)
    state.comments = [...state.comments.filter((item) => item.commentId !== comment.commentId), comment]
    state.commentViewerState[comment.commentId] = { liked: false }
    state.commentDraft = ''
    state.commentSubmitting = false
    updateDetailCommentCount(0, Math.max(state.comments.length, Number(result.commentCount || 0)))
    render()
  } catch (error) {
    console.warn('[community] create comment failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentSubmitting = false
    state.commentActionError = error?.message || 'Could not post this comment.'
    render()
  }
}

async function handleReplySubmit(event, parentCommentId = '') {
  event.preventDefault()
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  const formData = new FormData(event.currentTarget)
  const body = String(formData.get('body') || '').trim()
  state.replyDrafts = { ...state.replyDrafts, [parentCommentId]: body }
  state.commentActionError = ''
  if (!body) {
    state.commentActionError = 'Reply body is required.'
    render()
    return
  }
  state.commentSubmitting = true
  render()
  try {
    const result = await createCommunityComment({ postId: state.detailPostId, parentCommentId, body })
    const comment = normalizeCommunityComment(result.comment || {}, result.commentId)
    state.comments = [...state.comments.filter((item) => item.commentId !== comment.commentId), comment]
    state.commentViewerState[comment.commentId] = { liked: false }
    state.replyDrafts = { ...state.replyDrafts, [parentCommentId]: '' }
    state.replyComposerFor = ''
    state.commentSubmitting = false
    updateCommentCount(parentCommentId, { replyCount: (state.comments.find((item) => item.commentId === parentCommentId)?.replyCount || 0) + 1 })
    updateDetailCommentCount(0, Math.max(state.comments.length, Number(result.commentCount || 0)))
    render()
  } catch (error) {
    console.warn('[community] create reply failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentSubmitting = false
    state.commentActionError = error?.message || 'Could not post this reply.'
    render()
  }
}

async function handleCommentLike(commentId = '') {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  try {
    const result = await toggleCommunityCommentLike({ postId: state.detailPostId, commentId })
    state.commentViewerState[commentId] = { liked: Boolean(result.active) }
    if (Number.isFinite(Number(result.likeCount))) updateCommentCount(commentId, { likeCount: Number(result.likeCount) })
    render()
  } catch (error) {
    console.warn('[community] comment like failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentActionError = error?.message || 'Could not update this comment.'
    render()
  }
}

async function handleCommentDelete(commentId = '') {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  try {
    const comment = state.comments.find((item) => item.commentId === commentId)
    const result = await deleteCommunityComment({ postId: state.detailPostId, commentId })
    state.comments = state.comments.filter((item) => item.commentId !== commentId && item.parentCommentId !== commentId)
    if (comment?.parentCommentId) {
      updateCommentCount(comment.parentCommentId, { replyCount: Math.max(0, (state.comments.find((item) => item.commentId === comment.parentCommentId)?.replyCount || 0) - 1) })
    }
    if (Number.isFinite(Number(result.commentCount))) updateDetailCommentCount(0, Math.max(state.comments.length, Number(result.commentCount)))
    else updateDetailCommentCount(0, state.comments.length)
    render()
  } catch (error) {
    console.warn('[community] comment delete failed', { code: error?.code, message: error?.message, details: error?.details })
    state.commentActionError = error?.message || 'Could not delete this comment.'
    render()
  }
}

async function handleToggleFocus(communityId) {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  try {
    const result = await toggleCommunityFocus(communityId)
    state.communityFocus[communityId] = Boolean(result.focused)
    state.communities = state.communities.map((community) => community.communityId === communityId ? { ...community, focusCount: Number(result.focusCount ?? community.focusCount) } : community)
    if (state.community?.communityId === communityId) {
      state.community = { ...state.community, focusCount: Number(result.focusCount ?? state.community.focusCount) }
    }
    if (state.view.type === 'feed' && state.activeTab === 'following') {
      await loadCommunity()
      return
    }
    render()
  } catch (error) {
    console.warn('[community] focus failed', { code: error?.code, message: error?.message, details: error?.details })
    state.message = error?.message || 'Could not update focus.'
    render()
  }
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
  render()
  window.setTimeout(() => {
    if (state.message === message) {
      state.message = ''
      render()
    }
  }, 2800)
}

function selectTopicTab(tab = 'for-you') {
  const supportedTabs = new Set(['following', 'new', 'official', 'music', 'products', 'stage-plans', 'studio-projects', 'feedback', 'collaboration', 'for-you'])
  state.activeTab = supportedTabs.has(tab) ? tab : 'for-you'
  state.activeCommunityId = ''
  state.activeCommunitySlug = ''
  state.activeTopicLabel = activeFeedTitle()
  loadCommunity()
}

function selectTopicCommunity({ communityId = '', slug = '', label = '' } = {}) {
  state.activeTab = 'community'
  state.activeCommunityId = communityId
  state.activeCommunitySlug = slug
  state.activeTopicLabel = label || slug || 'Community'
  state.composer = { ...state.composer, communityId }
  loadCommunity()
}

function selectPlaceholderTopic(label = '') {
  state.activeTab = 'placeholder'
  state.activeCommunityId = ''
  state.activeCommunitySlug = ''
  state.activeTopicLabel = label || 'Community'
  state.posts = []
  showCommunityToast(`${state.activeTopicLabel} is a placeholder topic for now.`)
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
}

function communityModalIsOpen() {
  return Boolean(state.composer.open || state.storyComposer.open || state.storyViewer.open || state.report.open || state.createCommunity.open)
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
  window.location.assign(`${communityPostRoute(id)}${hash}`)
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

function openStoryComposer() {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.storyComposer = {
    ...state.storyComposer,
    open: true,
    submitting: false,
    error: '',
    message: ''
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
  const mediaType = state.storyComposer.mediaType === 'image' ? 'image' : 'text'
  const file = state.storyComposer.file || formData.get('storyImage')

  state.storyComposer = { ...state.storyComposer, text, error: '', submitting: true }
  if (mediaType === 'text' && !text) {
    state.storyComposer = { ...state.storyComposer, submitting: false, error: 'Story text is required.' }
    render()
    return
  }
  if (mediaType === 'image' && (!file || !String(file.type || '').startsWith('image/'))) {
    state.storyComposer = { ...state.storyComposer, submitting: false, error: 'Choose an image for this story.' }
    render()
    return
  }

  render()
  try {
    const storyId = newCommunityStoryId()
    let uploaded = { mediaPath: '', mediaURL: '' }
    if (mediaType === 'image') {
      uploaded = await uploadCommunityStoryImage({ uid: state.currentUser.uid, storyId, file })
    }
    const result = await createCommunityStory({
      storyId,
      mediaType,
      text,
      mediaPath: uploaded.mediaPath,
      background: state.storyComposer.background
    })
    const story = normalizeCommunityStory({
      ...(result.story || {}),
      mediaURL: uploaded.mediaURL || result.story?.mediaURL || ''
    }, result.storyId)
    state.stories = [story, ...state.stories.filter((item) => item.storyId !== story.storyId)]
    state.storyComposer = {
      open: false,
      mediaType: 'text',
      text: '',
      background: 'aurora',
      file: null,
      submitting: false,
      error: '',
      message: ''
    }
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
  state.storyViewer = { open: true, storyId, loading: false, error: '' }
  render()
  recordCommunityStoryView(storyId).then((result) => {
    if (Number.isFinite(Number(result.viewCount))) {
      state.stories = state.stories.map((item) => item.storyId === storyId ? { ...item, viewCount: Number(result.viewCount) } : item)
      render()
    }
  }).catch((error) => {
    console.warn('[community] story view count failed', { code: error?.code, message: error?.message, details: error?.details })
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
  const comment = state.comments.find((item) => item.commentId === state.report.commentId)
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
    await createReport({
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
    })
    state.report = { ...state.report, submitting: false, message: 'Thank you. Your report has been submitted.' }
    render()
  } catch (error) {
    console.warn('[community] report failed', { code: error?.code, message: error?.message, details: error?.details })
    state.report = { ...state.report, submitting: false, error: error?.message || 'Could not submit this report.' }
    render()
  }
}

function bindEvents() {
  app.querySelectorAll('.community-post-card[data-post-id]').forEach((card) => {
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
      event.stopPropagation()
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
  app.querySelectorAll('[data-topic-placeholder]').forEach((button) => {
    button.addEventListener('click', () => selectPlaceholderTopic(button.getAttribute('data-topic-placeholder') || 'Community'))
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
  updateTopicArrowState()
  app.querySelector('[data-load-more-posts]')?.addEventListener('click', () => loadFeedPage({ reset: false }))
  setupCommunityScrollChrome()
  setupFeedPaginationObserver()
  app.querySelectorAll('[data-open-community-composer]').forEach((button) => button.addEventListener('click', openCommunityComposer))
  app.querySelectorAll('[data-close-community-composer]').forEach((button) => button.addEventListener('click', closeCommunityComposer))
  app.querySelectorAll('[data-story-coming-soon]').forEach((button) => {
    button.addEventListener('click', () => showCommunityToast('Stories are coming soon.'))
  })
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
    state.storyComposer = { ...state.storyComposer, file: event.target.files?.[0] || null, error: '' }
    render()
  })
  app.querySelector('[data-story-composer-form]')?.addEventListener('submit', handleStorySubmit)
  app.querySelector('[data-close-story-composer]')?.addEventListener('click', () => {
    state.storyComposer = { ...state.storyComposer, open: false, submitting: false, error: '' }
    render()
  })
  app.querySelectorAll('[data-open-story]').forEach((button) => button.addEventListener('click', () => openStoryViewer(button.getAttribute('data-open-story') || '')))
  app.querySelector('[data-close-story-viewer]')?.addEventListener('click', () => {
    state.storyViewer = { open: false, storyId: '', loading: false, error: '' }
    render()
  })
  app.querySelector('[data-story-prev]')?.addEventListener('click', () => advanceStory(-1))
  app.querySelector('[data-story-next]')?.addEventListener('click', () => advanceStory(1))
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
    event.stopPropagation()
    handleToggleFocus(button.getAttribute('data-toggle-community-focus'))
  }))
  app.querySelectorAll('[data-community-like]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    handleLike(button.getAttribute('data-community-like'))
  }))
  app.querySelectorAll('[data-community-save]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    handleSave(button.getAttribute('data-community-save'))
  }))
  app.querySelectorAll('[data-community-share]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    handleShare(button.getAttribute('data-community-share'))
  }))
  app.querySelectorAll('[data-community-report]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    openReport(button.getAttribute('data-community-report'))
  }))
  app.querySelectorAll('[data-community-delete-post]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    handleDeleteOwnPost(button.getAttribute('data-community-delete-post') || '')
  }))
  app.querySelector('[data-community-comment-form]')?.addEventListener('submit', handleCommentSubmit)
  app.querySelectorAll('[data-community-reply-form]').forEach((form) => {
    form.addEventListener('submit', (event) => handleReplySubmit(event, form.getAttribute('data-community-reply-form') || ''))
  })
  app.querySelectorAll('[data-toggle-reply-composer]').forEach((button) => button.addEventListener('click', () => {
    state.replyComposerFor = button.getAttribute('data-toggle-reply-composer') || ''
    state.commentActionError = ''
    render()
  }))
  app.querySelectorAll('[data-cancel-reply-composer]').forEach((button) => button.addEventListener('click', () => {
    const parentCommentId = button.getAttribute('data-cancel-reply-composer') || ''
    state.replyComposerFor = state.replyComposerFor === parentCommentId ? '' : state.replyComposerFor
    render()
  }))
  app.querySelectorAll('[data-community-comment-like]').forEach((button) => button.addEventListener('click', () => handleCommentLike(button.getAttribute('data-community-comment-like'))))
  app.querySelectorAll('[data-community-comment-delete]').forEach((button) => button.addEventListener('click', () => handleCommentDelete(button.getAttribute('data-community-comment-delete'))))
  app.querySelectorAll('[data-community-comment-report]').forEach((button) => button.addEventListener('click', () => openCommentReport(button.getAttribute('data-community-comment-report'))))
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
