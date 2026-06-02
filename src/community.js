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
  newCommunityStoryId,
  normalizeCommunityComment,
  normalizeCommunityPost,
  normalizeCommunityStory,
  recordCommunityPostShare,
  recordCommunityStoryView,
  toggleCommunityCommentLike,
  toggleCommunityFocus,
  toggleCommunityPostLike,
  toggleCommunityPostSave,
  uploadCommunityStoryImage
} from './data/communityService'
import { ROUTES, authRoute, communityPostRoute, communityRoute, productRoute, publicProfileRoute } from './utils/routes'
import { formatUsername } from './utils/format'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')
const FEED_TABS = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Focused' },
  { id: 'new', label: 'New' },
  { id: 'official', label: 'Official' }
]
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

const state = {
  currentUser: null,
  activeTab: 'for-you',
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
  viewerState: {},
  loading: true,
  error: '',
  message: '',
  composer: {
    type: 'text',
    title: '',
    body: '',
    linkedProductId: '',
    communityId: '',
    tags: '',
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

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function parseDetailPostId() {
  const match = window.location.pathname.match(/^\/community\/post\/([^/]+)/)
  return match ? decodeURIComponent(match[1] || '') : ''
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

function renderStoryRail() {
  const createMarkup = state.currentUser ? `
    <button type="button" class="community-story-item is-create" data-open-story-composer>
      <span class="community-story-avatar is-create">${iconSvg('folderPlus')}</span>
      <strong>Your Story</strong>
      <small>Create</small>
    </button>
  ` : `
    <a class="community-story-item is-create" href="${authRoute({ redirect: window.location.pathname })}">
      <span class="community-story-avatar is-create">${iconSvg('folderPlus')}</span>
      <strong>Your Story</strong>
      <small>Sign in</small>
    </a>
  `
  const storyItems = state.stories.map((story) => `
    <button type="button" class="community-story-item" data-open-story="${escapeHtml(story.storyId)}">
      <span class="community-story-avatar ${story.mediaType === 'text' ? `story-bg-${escapeHtml(story.background)}` : ''}">
        ${story.mediaType === 'image' && story.mediaURL ? `<img src="${escapeHtml(story.mediaURL)}" alt="" loading="lazy" />` : storyAvatar(story)}
      </span>
      <strong>${escapeHtml(story.authorDisplayName || 'Creator')}</strong>
      <small>${escapeHtml(storyExpiresLabel(story.expiresAt))}</small>
    </button>
  `).join('')

  return `
    <section class="community-story-rail community-panel" aria-labelledby="community-stories-title">
      <div class="community-story-heading">
        <div>
          <p class="eyebrow">Stories</p>
          <h2 id="community-stories-title">Creator updates</h2>
        </div>
        <span>${state.storiesLoading ? 'Loading...' : `${formatCount(state.stories.length)} active`}</span>
      </div>
      ${state.storiesError ? `<p class="community-error">${escapeHtml(state.storiesError)}</p>` : ''}
      <div class="community-story-row" aria-label="Community stories">
        ${createMarkup}
        ${state.storiesLoading ? '<span class="community-story-empty">Loading stories...</span>' : storyItems || '<span class="community-story-empty">No stories yet.</span>'}
      </div>
    </section>
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
  if (state.composer.communityId) {
    return state.communities.find((community) => community.communityId === state.composer.communityId) || null
  }
  return null
}

function renderComposer() {
  if (!state.currentUser) {
    return `
      <section class="community-composer community-panel">
        <h2>Share with the community</h2>
        <p>Sign in to post.</p>
        <a class="button button-accent" href="${authRoute({ redirect: window.location.pathname })}">Sign In</a>
      </section>
    `
  }

  return `
    <section class="community-composer community-panel" aria-labelledby="community-composer-title">
      <div class="community-panel-heading">
        <div>
          <p class="eyebrow">Create</p>
          <h2 id="community-composer-title">Share something</h2>
        </div>
        <div class="community-type-toggle" role="group" aria-label="Post type">
          <button type="button" data-post-type="text" class="${state.composer.type === 'text' ? 'is-active' : ''}">Text Post</button>
          <button type="button" data-post-type="product_share" class="${state.composer.type === 'product_share' ? 'is-active' : ''}">Share Product</button>
        </div>
      </div>
      <form data-community-composer-form>
        <label>
          <span>Title</span>
          <input name="title" maxlength="120" value="${escapeHtml(state.composer.title)}" placeholder="Optional headline" />
        </label>
        <label>
          <span>Body</span>
          <textarea name="body" maxlength="2000" rows="5" placeholder="Share an update, question, or idea.">${escapeHtml(state.composer.body)}</textarea>
        </label>
        ${state.composer.type === 'product_share' ? `
          <label>
            <span>Product ID</span>
            <input name="linkedProductId" maxlength="180" value="${escapeHtml(state.composer.linkedProductId)}" placeholder="Paste a published product ID" />
          </label>
        ` : ''}
        ${state.view.type === 'community' && state.community ? `
          <input type="hidden" name="communityId" value="${escapeHtml(state.community.communityId)}" />
          <p class="community-context-note">Posting to <a href="${communityRoute(state.community.slug)}">c/${escapeHtml(state.community.slug)}</a></p>
        ` : `
          <label>
            <span>Community</span>
            <select name="communityId">
              <option value="">General feed</option>
              ${state.communities.map((community) => `<option value="${escapeHtml(community.communityId)}" ${state.composer.communityId === community.communityId ? 'selected' : ''}>c/${escapeHtml(community.slug)} · ${escapeHtml(community.name)}</option>`).join('')}
            </select>
          </label>
        `}
        <label>
          <span>Tags</span>
          <input name="tags" maxlength="160" value="${escapeHtml(state.composer.tags)}" placeholder="beats, feedback, release" />
        </label>
        ${state.composer.error ? `<p class="community-error">${escapeHtml(state.composer.error)}</p>` : ''}
        <div class="community-form-actions">
          <span>${Math.max(0, 2000 - state.composer.body.length)} characters left</span>
          <button type="submit" class="button button-accent" ${state.composer.submitting ? 'disabled' : ''}>${state.composer.submitting ? 'Publishing...' : 'Publish'}</button>
        </div>
      </form>
    </section>
  `
}

function linkedProductMarkup(post) {
  const product = post.linkedProductSnapshot || {}
  if (post.type !== 'product_share' || !post.linkedProductId) return ''
  const href = productRoute({ id: post.linkedProductId, slug: product.slug || product.title || '' })
  const price = product.isFree ? 'Free' : product.priceCents ? `$${(Number(product.priceCents) / 100).toFixed(2)}` : ''
  return `
    <a class="community-linked-product" href="${href}">
      ${product.thumbnailURL ? `<img src="${escapeHtml(product.thumbnailURL)}" alt="" loading="lazy" />` : `<span class="community-product-fallback">${iconSvg('package')}</span>`}
      <span>
        <strong>${escapeHtml(product.title || 'Shared product')}</strong>
        <em>${escapeHtml([product.artistName, price].filter(Boolean).join(' · '))}</em>
      </span>
    </a>
  `
}

function postCard(post, { detail = false } = {}) {
  const viewer = state.viewerState[post.postId] || {}
  const body = detail ? post.body : post.body.slice(0, 640)
  const authorHref = post.authorUid ? publicProfileRoute({ uid: post.authorUid }) : ROUTES.profilePublic
  return `
    <article class="community-post-card" data-post-id="${escapeHtml(post.postId)}">
      <header class="community-post-header">
        <a class="community-author" href="${authorHref}">
          <span class="community-avatar">${postAvatar(post)}</span>
          <span>
            <strong>${escapeHtml(post.authorDisplayName || 'Melogic Creator')}</strong>
            <em>${escapeHtml(formatUsername(post.authorUsername) || 'Creator')} · ${escapeHtml(formatTime(post.createdAt))}</em>
          </span>
        </a>
        <div class="community-post-badges">
          ${post.communitySlug ? `<a class="community-badge" href="${communityRoute(post.communitySlug)}">c/${escapeHtml(post.communitySlug)}</a>` : ''}
          ${post.official ? '<span class="community-badge">Official</span>' : ''}
        </div>
      </header>
      ${post.title ? `<h2>${escapeHtml(post.title)}</h2>` : ''}
      <p class="community-post-body">${escapeHtml(body)}${!detail && post.body.length > body.length ? '...' : ''}</p>
      ${linkedProductMarkup(post)}
      ${post.tags.length ? `<div class="community-tags">${post.tags.map((tag) => `<span>#${escapeHtml(tag)}</span>`).join('')}</div>` : ''}
      <footer class="community-post-actions">
        <button type="button" class="${viewer.liked ? 'is-active' : ''}" data-community-like="${escapeHtml(post.postId)}">${iconSvg('thumbsUp')} <span>${formatCount(post.counts.likes)}</span></button>
        <a href="${communityPostRoute(post.postId)}">${iconSvg('messageCircle')} <span>${formatCount(post.counts.comments)}</span></a>
        <button type="button" class="${viewer.saved ? 'is-active' : ''}" data-community-save="${escapeHtml(post.postId)}">${iconSvg('bookmark')} <span>${formatCount(post.counts.saves)}</span></button>
        <button type="button" data-community-share="${escapeHtml(post.postId)}">${iconSvg('share2')} <span>${formatCount(post.counts.shares)}</span></button>
        <button type="button" data-community-report="${escapeHtml(post.postId)}">${iconSvg('alertCircle')} <span>Report</span></button>
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
    <section class="community-comments" aria-labelledby="community-comments-title">
      <div class="community-comments-heading">
        <div>
          <h3 id="community-comments-title">Comments</h3>
          <p>${formatCount(post.counts.comments)} comment${Number(post.counts.comments) === 1 ? '' : 's'}</p>
        </div>
      </div>
      ${state.commentActionError ? `<p class="community-error">${escapeHtml(state.commentActionError)}</p>` : ''}
      ${renderCommentComposer()}
      ${state.commentsLoading ? '<p class="community-comments-state">Loading comments...</p>' : state.commentsError ? `<p class="community-error">${escapeHtml(state.commentsError)}</p>` : topLevel.length ? `<div class="community-comment-list">${topLevel.map((comment) => commentCard(comment, repliesByParent[comment.commentId] || [])).join('')}</div>` : '<p class="community-comments-empty">No comments yet. Start the conversation.</p>'}
    </section>
  `
}

function emptyCopy() {
  if (state.activeTab === 'following') return state.currentUser ? 'Focus communities to build this feed.' : 'Sign in to focus communities.'
  if (state.activeTab === 'official') return 'No official posts yet.'
  return 'No posts yet. Be the first to share something.'
}

function renderFeed() {
  if (state.loading) return '<section class="community-feed-state community-panel">Loading community posts...</section>'
  if (state.error) return `<section class="community-feed-state community-panel"><strong>Could not load community.</strong><span>${escapeHtml(state.error)}</span><button type="button" class="button button-muted" data-reload-community>Retry</button></section>`
  if (!state.posts.length) return `<section class="community-feed-state community-panel">${escapeHtml(emptyCopy())}</section>`
  return `<section class="community-feed" aria-label="Community posts">${state.posts.map((post) => postCard(post)).join('')}</section>`
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

function renderSidebar() {
  return `
    <aside class="community-sidebar">
      <section class="community-panel">
        <h2>Suggested Communities</h2>
        <p>Creator spaces are coming in a later phase.</p>
      </section>
      <section class="community-panel">
        <h2>Trending Tags</h2>
        <p>Tags will populate once posts start moving.</p>
      </section>
      <section class="community-panel">
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
          ${state.communityFilters.loading ? '<section class="community-feed-state community-panel">Loading community...</section>' : state.communityFilters.error ? `<section class="community-feed-state community-panel"><strong>Could not load community.</strong><span>${escapeHtml(state.communityFilters.error)}</span></section>` : community ? `${renderComposer()}${renderFeed()}` : '<section class="community-feed-state community-panel">This community is not available.</section>'}
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

function render() {
  if (!app) return
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
      <section class="community-hero">
        <div>
          <p class="eyebrow">Melogic Community</p>
          <h1>Community</h1>
          <p>Explore, create, share, distribute, and earn with creators building on Melogic.</p>
        </div>
        <a class="button button-accent" href="${ROUTES.communityCommunities}">Browse Communities</a>
      </section>
      <div class="community-layout">
        <div class="community-main">
          ${renderStoryRail()}
          ${renderComposer()}
          ${state.message ? `<p class="community-toast">${escapeHtml(state.message)}</p>` : ''}
          <nav class="community-tabs" aria-label="Community feed tabs">
            ${FEED_TABS.map((tab) => `<button type="button" data-community-tab="${tab.id}" class="${state.activeTab === tab.id ? 'is-active' : ''}">${tab.label}</button>`).join('')}
          </nav>
          ${renderFeed()}
        </div>
        ${renderSidebar()}
      </div>
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

async function loadCommunities() {
  state.communityFilters.loading = true
  state.communityFilters.error = ''
  render()
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
    render()
  }
}

async function loadCommunity() {
  state.loading = true
  state.error = ''
  render()
  try {
    if (state.detailPostId) {
      const post = await getCommunityPost(state.detailPostId)
      state.posts = post ? [post] : []
      state.comments = []
      state.commentViewerState = {}
      if (post) await loadComments({ renderAfter: false })
    } else if (state.view.type === 'communities') {
      state.loading = false
      await loadCommunities()
      return
    } else if (state.view.type === 'community') {
      state.communityFilters.loading = true
      state.communityFilters.error = ''
      const community = await getCommunityBySlug(state.view.slug)
      state.community = community
      state.posts = community
        ? await listCommunityPosts({ communitySlug: community.slug, limitCount: 25 })
        : []
      state.communities = community ? [community] : []
      await loadCommunityFocusState()
      state.communityFilters.loading = false
    } else if (state.activeTab === 'following') {
      if (!state.communities.length) {
        state.communities = await listCommunities({ limitCount: 50 }).catch(() => [])
        await loadCommunityFocusState()
      }
      const [posts] = await Promise.all([
        state.currentUser?.uid ? listFocusedCommunityPosts(state.currentUser.uid, 25) : Promise.resolve([]),
        loadStories()
      ])
      state.posts = posts
    } else {
      if (!state.communities.length) {
        state.communities = await listCommunities({ limitCount: 50 }).catch(() => [])
        await loadCommunityFocusState()
      }
      const [posts] = await Promise.all([
        listCommunityPosts({ tab: state.activeTab, limitCount: 25 }),
        loadStories()
      ])
      state.posts = posts
    }
    await loadViewerState()
  } catch (error) {
    console.warn('[community] load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Community posts could not be loaded.'
    state.communityFilters.loading = false
  } finally {
    state.loading = false
    render()
  }
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
  const linkedProductId = String(formData.get('linkedProductId') || '').trim()
  const communityId = String(formData.get('communityId') || '').trim()
  const tags = String(formData.get('tags') || '').trim()

  state.composer = { ...state.composer, title, body, linkedProductId, communityId, tags, error: '' }
  if (!body) {
    state.composer.error = 'Post body is required.'
    render()
    return
  }
  if (state.composer.type === 'product_share' && !linkedProductId) {
    state.composer.error = 'Paste a published product ID to share.'
    render()
    return
  }

  state.composer.submitting = true
  render()
  try {
    const community = currentComposerCommunity()
    const result = await createCommunityPost({
      type: state.composer.type,
      title,
      body,
      linkedProductId,
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
    state.composer = { type: 'text', title: '', body: '', linkedProductId: '', communityId: state.view.type === 'community' ? state.community?.communityId || '' : '', tags: '', submitting: false, error: '' }
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
  state.message = 'Link copied.'
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
  app.querySelectorAll('[data-community-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.getAttribute('data-community-tab') || 'for-you'
      loadCommunity()
    })
  })
  app.querySelectorAll('[data-post-type]').forEach((button) => {
    button.addEventListener('click', () => {
      state.composer.type = button.getAttribute('data-post-type') || 'text'
      render()
    })
  })
  app.querySelector('[data-open-story-composer]')?.addEventListener('click', openStoryComposer)
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
  app.querySelectorAll('[data-toggle-community-focus]').forEach((button) => button.addEventListener('click', () => handleToggleFocus(button.getAttribute('data-toggle-community-focus'))))
  app.querySelectorAll('[data-community-like]').forEach((button) => button.addEventListener('click', () => handleLike(button.getAttribute('data-community-like'))))
  app.querySelectorAll('[data-community-save]').forEach((button) => button.addEventListener('click', () => handleSave(button.getAttribute('data-community-save'))))
  app.querySelectorAll('[data-community-share]').forEach((button) => button.addEventListener('click', () => handleShare(button.getAttribute('data-community-share'))))
  app.querySelectorAll('[data-community-report]').forEach((button) => button.addEventListener('click', () => openReport(button.getAttribute('data-community-report'))))
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
