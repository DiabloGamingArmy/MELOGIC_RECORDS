import './styles/base.css'
import './styles/community.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { createReport } from './data/productService'
import {
  createCommunityPost,
  createCommunity,
  getCommunityBySlug,
  getCommunityFocusState,
  getCommunityPost,
  getCommunityPostViewerState,
  listCommunities,
  listCommunityPosts,
  normalizeCommunityPost,
  recordCommunityPostShare,
  toggleCommunityFocus,
  toggleCommunityPostLike,
  toggleCommunityPostSave
} from './data/communityService'
import { ROUTES, authRoute, communityPostRoute, communityRoute, productRoute, publicProfileRoute } from './utils/routes'
import { formatUsername } from './utils/format'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')
const FEED_TABS = [
  { id: 'for-you', label: 'For You' },
  { id: 'following', label: 'Following' },
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
    postId: '',
    reason: REPORT_REASONS[0],
    description: '',
    submitting: false,
    error: '',
    message: ''
  },
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
      ${detail ? '<section class="community-comments-placeholder"><h3>Comments</h3><p>Comments are coming next.</p></section>' : ''}
    </article>
  `
}

function emptyCopy() {
  if (state.activeTab === 'following') return 'Follow creators to build your feed.'
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
  return `
    <div class="community-modal-backdrop">
      <section class="community-report-modal" role="dialog" aria-modal="true" aria-labelledby="community-report-title">
        <header>
          <h2 id="community-report-title">Report Post</h2>
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
          ${renderComposer()}
          ${state.message ? `<p class="community-toast">${escapeHtml(state.message)}</p>` : ''}
          <nav class="community-tabs" aria-label="Community feed tabs">
            ${FEED_TABS.map((tab) => `<button type="button" data-community-tab="${tab.id}" class="${state.activeTab === tab.id ? 'is-active' : ''}">${tab.label}</button>`).join('')}
          </nav>
          ${renderFeed()}
        </div>
        ${renderSidebar()}
      </div>
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
      state.posts = []
    } else {
      if (!state.communities.length) {
        state.communities = await listCommunities({ limitCount: 50 }).catch(() => [])
        await loadCommunityFocusState()
      }
      state.posts = await listCommunityPosts({ tab: state.activeTab, limitCount: 25 })
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
    state.posts = state.activeTab === 'following' ? [post] : [post, ...state.posts.filter((item) => item.postId !== post.postId)]
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

function openReport(postId) {
  if (!state.currentUser) {
    window.location.assign(authRoute({ redirect: window.location.pathname }))
    return
  }
  state.report = { open: true, postId, reason: REPORT_REASONS[0], description: '', submitting: false, error: '', message: '' }
  render()
}

async function handleReportSubmit(event) {
  event.preventDefault()
  const formData = new FormData(event.currentTarget)
  const post = state.posts.find((item) => item.postId === state.report.postId)
  const reason = String(formData.get('reason') || '').trim()
  const description = String(formData.get('description') || '').trim()
  if (!post) return
  if (reason === 'Other' && !description) {
    state.report.error = 'Description is required when reason is Other.'
    render()
    return
  }
  state.report = { ...state.report, reason, description, submitting: true, error: '' }
  render()
  try {
    await createReport({
      targetType: 'community_post',
      targetId: post.postId,
      targetOwnerUid: post.authorUid,
      reason,
      description,
      sourcePath: window.location.pathname,
      metadata: { postTitle: post.title, postType: post.type }
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
  loadViewerState().then(render).catch(() => render())
})
