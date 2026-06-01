import './styles/base.css'
import './styles/community.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { createCriticalAssetPreloader, renderPagePreloaderMarkup } from './components/pagePreloader'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { createReport } from './data/productService'
import {
  createCommunityPost,
  getCommunityPost,
  getCommunityPostViewerState,
  listCommunityPosts,
  normalizeCommunityPost,
  recordCommunityPostShare,
  toggleCommunityPostLike,
  toggleCommunityPostSave
} from './data/communityService'
import { ROUTES, authRoute, communityPostRoute, productRoute, publicProfileRoute } from './utils/routes'
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

const state = {
  currentUser: null,
  activeTab: 'for-you',
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
    tags: '',
    submitting: false,
    error: ''
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
        ${post.official ? '<span class="community-badge">Official</span>' : ''}
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

async function loadCommunity() {
  state.loading = true
  state.error = ''
  render()
  try {
    if (state.detailPostId) {
      const post = await getCommunityPost(state.detailPostId)
      state.posts = post ? [post] : []
    } else if (state.activeTab === 'following') {
      state.posts = []
    } else {
      state.posts = await listCommunityPosts({ tab: state.activeTab, limitCount: 25 })
    }
    await loadViewerState()
  } catch (error) {
    console.warn('[community] load failed', { code: error?.code, message: error?.message, details: error?.details })
    state.error = error?.message || 'Community posts could not be loaded.'
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
  const tags = String(formData.get('tags') || '').trim()

  state.composer = { ...state.composer, title, body, linkedProductId, tags, error: '' }
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
    const result = await createCommunityPost({ type: state.composer.type, title, body, linkedProductId, tags: tags.split(/[,\s]+/).filter(Boolean) })
    const post = normalizeCommunityPost(result.post || {}, result.postId)
    state.posts = state.activeTab === 'following' ? [post] : [post, ...state.posts.filter((item) => item.postId !== post.postId)]
    state.viewerState[post.postId] = { liked: false, saved: false }
    state.composer = { type: 'text', title: '', body: '', linkedProductId: '', tags: '', submitting: false, error: '' }
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
