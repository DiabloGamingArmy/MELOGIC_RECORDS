import './styles/base.css'
import './styles/productDashboard.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { addToCart } from './data/cartService'
import { createReport, getProductShellById, listProductFiles, listRecommendedProducts, normalizeProduct, resolveProductMedia } from './data/productService'
import { claimFreeProduct, createProductDownloadLink, createProductDownloadUrl, userOwnsProduct } from './data/entitlementService'
import { sendProductGift } from './data/productGiftService'
import { searchProfilesByUsername } from './data/profileSearchService'
import { beginProductDownloads, productDownloadDialogMarkup } from './components/productDownloadDialog'
import { getProductEngagementState, setProductEngagement } from './data/productEngagementService'
import { createMarketplaceReviewReport, createProductReview, createProductReviewReply, deleteProductReview, deleteProductReviewReply, getReviewReactionStates, listProductReviewReplies, listProductReviews, setProductReviewReaction } from './data/productReviewService'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, productRoute, publicProfileRoute } from './utils/routes'
import { formatUsername } from './utils/format'
import { getProductGiftSendUiState } from './utils/productGiftState'
import { renderSafeRichDescription } from './utils/richDescription'
import { iconSvg } from './utils/icons'

const app = document.querySelector('#app')

const PRODUCT_FILE_VIEWER_DEBUG = false
const PRODUCT_REVIEW_DEBUG = false
const PRODUCT_DOWNLOAD_DEBUG = false
const PRODUCT_GIFT_DEBUG = false

const state = {
  mediaItems: [],
  selectedMediaIndex: 0,
  currentUser: null,
  isDraftPreview: false,
  productEngagement: { productId: '', reaction: null, saved: false, likeCount: 0, dislikeCount: 0, saveCount: 0, loading: false, error: '' },
  reviews: [],
  fileBrowserProductId: '',
  fileBrowserPath: '',
  fileBrowserMessage: ''
  ,reviewReactions: {}
  ,reviewReplies: {}
  ,openReplyComposerFor: ''
  ,replyDrafts: {}
  ,reviewActionErrors: {}
  ,replyLoadErrors: {}
  ,openReviewMenuId: ''
  ,openReplyMenuKey: ''
  ,productReport: { open: false, submitting: false, error: '', message: '' }
  ,downloadDialog: { open: false, loading: false, error: '', productId: '', title: '', sizeBytes: 0 }
  ,giftFlow: {
    query: '',
    results: [],
    selected: [],
    searching: false,
    sending: false,
    error: '',
    success: '',
    draftMessage: '',
    sentCount: 0,
    status: 'idle'
  }
  ,pageData: { product: null, recommendations: [], productFiles: [], ownsProduct: false, ownerPreview: false, recommendationsLoading: false, reviewsLoading: false }
}

let giftSearchTimer = null

function productDownloadBytes(product = {}, productFiles = []) {
  const explicit = Number(product.assetSummary?.totalBytes || product.assetSummary?.downloadBytes || product.primaryDownloadBytes || 0)
  if (explicit > 0) return explicit
  return (Array.isArray(productFiles) ? productFiles : []).reduce((total, file) => {
    const role = [file.role, file.category, file.type, file.kind].join(' ').toLowerCase()
    return /\b(deliverable|download|package)\b/.test(role) || file.isDeliverable === true
      ? total + Number(file.sizeBytes || file.size || 0)
      : total
  }, 0)
}

function giftUserMarkup(user = {}, selected = false) {
  const name = user.displayName || user.username || 'Melogic member'
  return `
    <button type="button" class="product-gift-user ${selected ? 'is-selected' : ''}" data-gift-user="${escapeHtml(user.uid)}">
      ${user.avatarURL || user.photoURL ? `<img src="${escapeHtml(user.avatarURL || user.photoURL)}" alt="" />` : `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`}
      <span><strong>${escapeHtml(name)}</strong><small>${escapeHtml(formatUsername(user.username) || 'Melogic member')}</small></span>
      <em>${selected ? 'Selected' : 'Select'}</em>
    </button>
  `
}

function giftErrorMessage(error = {}) {
  const code = String(error?.code || '').replace(/^functions\//, '')
  if (code === 'unauthenticated') return 'Sign in again before sending this gift.'
  if (code === 'permission-denied') return 'Only the product owner can send this gift.'
  if (code === 'invalid-argument') return error?.message || 'Choose between 1 and 10 valid recipients.'
  if (code === 'not-found') return 'The product or one of the selected recipients is no longer available.'
  if (code === 'already-exists') return error?.message || 'A pending or accepted gift already exists for this user.'
  if (['unavailable', 'deadline-exceeded', 'internal'].includes(code)) return 'The gift service is temporarily unavailable. Try again.'
  return error?.message || 'Could not send this gift. Try again.'
}

function updateGiftSendState() {
  const button = app.querySelector('[data-send-product-gift]')
  const status = app.querySelector('[data-gift-send-status]')
  const uiState = getProductGiftSendUiState({
    recipientCount: state.giftFlow.selected.length,
    sending: state.giftFlow.sending,
    error: state.giftFlow.error,
    success: state.giftFlow.success
  })
  if (button) {
    button.disabled = uiState.disabled
    button.textContent = uiState.label
  }
  if (!status) return
  status.className = `product-gift-send-status ${uiState.tone}`.trim()
  status.innerHTML = `<strong>${escapeHtml(uiState.title)}</strong><span>${escapeHtml(uiState.detail)}</span>`
}

function updateGiftResults() {
  const root = app.querySelector('[data-gift-results]')
  if (!root) return
  if (state.giftFlow.searching) {
    root.innerHTML = '<p class="product-gift-status">Searching...</p>'
    return
  }
  if (state.giftFlow.query.trim().length < 2) {
    root.innerHTML = '<p class="product-gift-status">Type at least two characters to search usernames.</p>'
    return
  }
  const rows = state.giftFlow.results.filter((user) => user.uid !== state.currentUser?.uid)
  root.innerHTML = rows.length
    ? rows.map((user) => giftUserMarkup(user, state.giftFlow.selected.some((selected) => selected.uid === user.uid))).join('')
    : '<p class="product-gift-status">No matching users found.</p>'
  bindGiftResultButtons()
}

function updateGiftSelections() {
  const root = app.querySelector('[data-gift-selected]')
  if (!root) return
  root.innerHTML = state.giftFlow.selected.length
    ? state.giftFlow.selected.map((user) => `<button type="button" class="product-gift-chip" data-remove-gift-user="${escapeHtml(user.uid)}">${escapeHtml(user.displayName || user.username || 'User')} <span aria-hidden="true">×</span></button>`).join('')
    : '<span class="product-gift-status">No recipients selected.</span>'
  root.querySelectorAll('[data-remove-gift-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.getAttribute('data-remove-gift-user') || ''
      state.giftFlow.selected = state.giftFlow.selected.filter((user) => user.uid !== uid)
      state.giftFlow.error = ''
      state.giftFlow.success = ''
      state.giftFlow.status = 'idle'
      updateGiftSelections()
      updateGiftResults()
      updateGiftSendState()
    })
  })
}

function bindGiftResultButtons() {
  app.querySelectorAll('[data-gift-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.getAttribute('data-gift-user') || ''
      const user = state.giftFlow.results.find((row) => row.uid === uid)
      if (!user) return
      const selected = state.giftFlow.selected.some((row) => row.uid === uid)
      state.giftFlow.selected = selected
        ? state.giftFlow.selected.filter((row) => row.uid !== uid)
        : [...state.giftFlow.selected, user].slice(0, 10)
      state.giftFlow.error = ''
      state.giftFlow.success = ''
      state.giftFlow.status = 'idle'
      updateGiftSelections()
      updateGiftResults()
      updateGiftSendState()
    })
  })
}

function renderGiftAccessDenied(product = {}) {
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main class="product-gift-page">
      <section class="section">
        <div class="section-inner product-gift-shell">
          <header class="product-gift-header">
            <div>
              <p class="eyebrow">Product Gifting</p>
              <h1>Gift unavailable</h1>
              <p>Only the product owner can send this product as a gift.</p>
            </div>
            <a class="button button-muted" href="${productRoute(product)}">Back to Product</a>
          </header>
        </div>
      </section>
    </main>
  `
  initShellChrome()
}

function renderGiftFlow(product = {}) {
  const cover = product.thumbnailURL || product.coverURL || product.galleryURLs?.[0] || ''
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main class="product-gift-page">
      <section class="section">
        <div class="section-inner product-gift-shell">
          <header class="product-gift-header">
            <div>
              <p class="eyebrow">Product Gifting</p>
              <h1>Send as Gift</h1>
              <p>Choose up to 10 Melogic users. They will receive the product after accepting the gift.</p>
            </div>
            <a class="button button-muted" href="${productRoute(product)}">Back to Product</a>
          </header>
          <article class="product-gift-summary">
            ${cover ? `<img src="${escapeHtml(cover)}" alt="" />` : '<span class="product-gift-cover-fallback"></span>'}
            <div><strong>${escapeHtml(product.title)}</strong><span>By ${escapeHtml(product.artistName || product.artistDisplayName || 'Creator')}</span></div>
          </article>
          <section class="product-gift-workspace">
            <label class="product-gift-search">
              <span>Search users</span>
              <input data-gift-search value="${escapeHtml(state.giftFlow.query)}" placeholder="Search users to gift this product to..." autocomplete="off" />
            </label>
            <div class="product-gift-results" data-gift-results></div>
            <div>
              <h2>Recipients</h2>
              <div class="product-gift-selected" data-gift-selected></div>
            </div>
            <label class="product-gift-message">
              <span>Message (optional)</span>
              <textarea data-gift-message maxlength="1000" rows="4" placeholder="Add an optional message...">${escapeHtml(state.giftFlow.draftMessage)}</textarea>
            </label>
            <div class="product-gift-send-status" data-gift-send-status aria-live="polite"></div>
            ${state.giftFlow.success ? `<a class="button button-muted product-gift-back-action" href="${productRoute(product)}">Back to Product</a>` : ''}
            <button type="button" class="button button-accent" data-send-product-gift ${!state.giftFlow.selected.length || state.giftFlow.sending ? 'disabled' : ''}>${state.giftFlow.sending ? 'Sending...' : 'Send Gift'}</button>
          </section>
        </div>
      </section>
    </main>
  `
  initShellChrome()
  updateGiftSelections()
  updateGiftResults()
  updateGiftSendState()
  const input = app.querySelector('[data-gift-search]')
  input?.addEventListener('input', () => {
    state.giftFlow.query = input.value || ''
    state.giftFlow.error = ''
    if (giftSearchTimer) window.clearTimeout(giftSearchTimer)
    state.giftFlow.searching = state.giftFlow.query.trim().length >= 2
    updateGiftResults()
    giftSearchTimer = window.setTimeout(async () => {
      const requestedQuery = state.giftFlow.query
      try {
        state.giftFlow.results = await searchProfilesByUsername(requestedQuery)
      } catch (error) {
        state.giftFlow.results = []
        state.giftFlow.error = error?.message || 'User search is unavailable.'
      }
      if (requestedQuery !== state.giftFlow.query) return
      state.giftFlow.searching = false
      updateGiftResults()
    }, 280)
  })
  app.querySelector('[data-gift-message]')?.addEventListener('input', (event) => {
    state.giftFlow.draftMessage = event.currentTarget?.value || ''
  })
  app.querySelector('[data-send-product-gift]')?.addEventListener('click', async (event) => {
    event.preventDefault()
    if (!state.giftFlow.selected.length || state.giftFlow.sending) return
    const recipientUids = state.giftFlow.selected.map((user) => String(user.uid || '').trim()).filter(Boolean)
    if (!recipientUids.length) {
      state.giftFlow.error = 'Select at least one valid recipient.'
      updateGiftSendState()
      return
    }
    state.giftFlow.sending = true
    state.giftFlow.status = 'sending'
    state.giftFlow.error = ''
    state.giftFlow.success = ''
    updateGiftSendState()
    const payload = {
      productId: product.id,
      recipientUids,
      message: state.giftFlow.draftMessage
    }
    if (PRODUCT_GIFT_DEBUG) {
      console.info('[product-gift] send requested', {
        action: 'send-gift',
        functionName: 'sendProductGift',
        productId: product.id,
        productTitle: product.title || '',
        currentUserUid: state.currentUser?.uid || '',
        selectedRecipients: state.giftFlow.selected.map((user) => ({
          uid: user.uid,
          username: user.username || '',
          displayName: user.displayName || ''
        })),
        selectedRecipientUids: recipientUids,
        recipientUids,
        recipientCount: recipientUids.length,
        messageLength: state.giftFlow.draftMessage.length,
        payload: {
          productId: payload.productId,
          recipientUids: payload.recipientUids,
          messageLength: payload.message.length
        }
      })
    }
    try {
      const result = await sendProductGift(payload)
      const sentCount = Number(result.sentCount ?? result.recipientCount ?? recipientUids.length)
      state.giftFlow.sentCount = sentCount
      state.giftFlow.status = 'success'
      state.giftFlow.success = `Sent to ${sentCount} recipient${sentCount === 1 ? '' : 's'}.${result.notificationFailureCount ? ' The gift is available in Inbox, but one or more notifications may be delayed.' : ''}`
      state.giftFlow.selected = []
      state.giftFlow.draftMessage = ''
      if (PRODUCT_GIFT_DEBUG) {
        console.info('[product-gift] send confirmed', {
          productId: product.id,
          giftIds: result.giftIds,
          sentCount,
          notificationFailureCount: Number(result.notificationFailureCount || 0)
        })
      }
    } catch (error) {
      state.giftFlow.status = 'error'
      state.giftFlow.error = giftErrorMessage(error)
      if (PRODUCT_GIFT_DEBUG) {
        console.warn('[product-gift] send failed', {
          action: 'send-gift',
          functionName: 'sendProductGift',
          productId: product.id,
          productTitle: product.title || '',
          currentUserUid: state.currentUser?.uid || '',
          selectedRecipientUids: recipientUids,
          errorCode: error?.code || '',
          errorMessage: error?.message || '',
          errorDetails: error?.details || null
        })
      }
    } finally {
      state.giftFlow.sending = false
      renderGiftFlow(product)
    }
  })
}

const PRODUCT_REPORT_REASONS = [
  'Fraudulent or misleading',
  'Download does not work',
  'Product not as described',
  'Stolen/copyrighted content',
  'Unsafe or malicious file',
  'Spam',
  'Other'
]

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function normalizeKey(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/-+/g, '-')
}

function parseProductIdFromLocation() {
  const pathname = String(window.location.pathname || '')
  const params = new URLSearchParams(window.location.search)
  const reservedProductRoutes = new Set(['new', 'edit'])

  if (pathname.startsWith('/products/')) {
    const rawSegment = pathname.slice('/products/'.length).split('/')[0]
    const decodedSegment = decodeURIComponent(rawSegment || '').trim()
    if (reservedProductRoutes.has(decodedSegment.toLowerCase())) return ''
    if (decodedSegment) {
      const markerIndex = decodedSegment.lastIndexOf('--')
      if (markerIndex >= 0) {
        const extracted = decodedSegment.slice(markerIndex + 2).trim()
        if (extracted) return extracted
      }
      return decodedSegment
    }
  }

  return String(params.get('id') || '').trim()
}

function formatReleaseDate(value) {
  const stamp = new Date(value || 0)
  if (Number.isNaN(stamp.getTime())) return 'Unreleased'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(stamp)
}

function buildMediaItems(product) {
  const galleryItems = (product.galleryURLs || []).map((url, index) => ({ type: 'image', url, label: `${product.title} gallery ${index + 1}`, source: 'gallery' }))
  const leadImage = product.coverURL || product.thumbnailURL || ''
  const leadItem = leadImage ? [{ type: 'image', url: leadImage, label: `${product.title} cover`, source: product.coverURL ? 'cover' : 'thumbnail' }] : []
  const media = [
    ...galleryItems,
    ...leadItem,
    ...(product.previewVideoURLs || []).map((url, index) => ({ type: 'video', url, label: `${product.title} video ${index + 1}`, source: 'previewVideo' }))
  ]

  const seen = new Set()
  return media.filter((item) => {
    const key = `${item.type}:${item.url}`
    if (!item.url || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function renderMainMedia() {
  const mainMediaRoot = app.querySelector('[data-dashboard-main-media]')
  if (!mainMediaRoot) return

  const selected = state.mediaItems[state.selectedMediaIndex]
  if (!selected) {
    mainMediaRoot.innerHTML = `
      <div class="dashboard-media-fallback">
        <p class="eyebrow">Melogic Visual</p>
        <h3>No media uploaded yet</h3>
        <p>Creators can add cover art, gallery images, and preview videos.</p>
      </div>
    `
    return
  }
  if (PRODUCT_FILE_VIEWER_DEBUG) {
    console.info('[product] main media selected', {
      selectedMediaIndex: state.selectedMediaIndex,
      type: selected.type,
      source: selected.source || 'unknown',
      url: selected.url,
      label: selected.label,
      mediaItems: state.mediaItems
    })
  }

  mainMediaRoot.innerHTML = selected.type === 'video'
    ? `
      <div class="dashboard-main-media-viewport" data-dashboard-main-media-viewport>
        <div class="dashboard-main-media-fit-frame" data-dashboard-main-media-fit-frame>
          <video
            class="dashboard-main-media-fit-item"
            data-dashboard-main-media-item
            src="${escapeHtml(selected.url)}"
            controls
            preload="metadata"
            aria-label="${escapeHtml(selected.label)}"
          ></video>
        </div>
      </div>
    `
    : `
      <div class="dashboard-main-media-viewport" data-dashboard-main-media-viewport>
        <div class="dashboard-main-media-fit-frame" data-dashboard-main-media-fit-frame>
          <img
            class="dashboard-main-media-fit-item"
            data-dashboard-main-media-item
            src="${escapeHtml(selected.url)}"
            alt="${escapeHtml(selected.label)}"
            loading="eager"
          />
        </div>
      </div>
    `

  window.requestAnimationFrame(() => {
    const viewport = mainMediaRoot.querySelector('[data-dashboard-main-media-viewport]')
    const frame = mainMediaRoot.querySelector('[data-dashboard-main-media-fit-frame]')
    const item = mainMediaRoot.querySelector('[data-dashboard-main-media-item]')
    if (PRODUCT_FILE_VIEWER_DEBUG) {
      console.info('[product] main media layout debug', {
        source: selected.source || 'unknown',
        url: selected.url,
        rootRect: mainMediaRoot.getBoundingClientRect?.(),
        viewportRect: viewport?.getBoundingClientRect?.(),
        frameRect: frame?.getBoundingClientRect?.(),
        itemRect: item?.getBoundingClientRect?.(),
        objectFit: item ? window.getComputedStyle(item).objectFit : '',
        width: item ? window.getComputedStyle(item).width : '',
        height: item ? window.getComputedStyle(item).height : '',
        maxWidth: item ? window.getComputedStyle(item).maxWidth : '',
        maxHeight: item ? window.getComputedStyle(item).maxHeight : '',
        naturalWidth: item instanceof HTMLImageElement ? item.naturalWidth : null,
        naturalHeight: item instanceof HTMLImageElement ? item.naturalHeight : null
      })
    }
  })


  bindInteractiveRatingControl()
  app.querySelectorAll('[data-media-index]').forEach((button) => {
    const index = Number(button.getAttribute('data-media-index'))
    button.classList.toggle('is-active', index === state.selectedMediaIndex)
    button.setAttribute('aria-pressed', String(index === state.selectedMediaIndex))
  })
}

function renderState(title, body) {
  document.title = 'Melogic | Product'
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-empty">
          <h1>${escapeHtml(title)}</h1>
          <p>${escapeHtml(body)}</p>
          <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
        </div>
      </section>
    </main>
  `
  initShellChrome()
}

function productReportDialog(product = {}) {
  if (!state.productReport.open) return ''
  return `
    <div class="dashboard-modal-backdrop" role="presentation">
      <section class="dashboard-report-modal" role="dialog" aria-modal="true" aria-labelledby="product-report-title">
        <header>
          <h2 id="product-report-title">Report Product</h2>
          <button type="button" class="dashboard-report-close" data-close-product-report aria-label="Close report modal">${iconSvg('x')}</button>
        </header>
        ${state.productReport.message ? `<p class="dashboard-report-success">${escapeHtml(state.productReport.message)}</p>` : `
          <form data-product-report-form>
            <label>
              <span>Reason</span>
              <select name="reason" required>
                <option value="">Choose a reason</option>
                ${PRODUCT_REPORT_REASONS.map((reason) => `<option value="${escapeHtml(reason)}">${escapeHtml(reason)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Description</span>
              <textarea name="description" maxlength="2000" rows="5" placeholder="Add details that can help marketplace staff review this report."></textarea>
            </label>
            ${state.productReport.error ? `<p class="dashboard-report-error">${escapeHtml(state.productReport.error)}</p>` : ''}
            <div class="dashboard-report-actions">
              <button type="button" class="button button-muted" data-close-product-report ${state.productReport.submitting ? 'disabled' : ''}>Cancel</button>
              <button type="submit" class="button button-accent" ${state.productReport.submitting ? 'disabled' : ''}>${state.productReport.submitting ? 'Submitting...' : 'Submit Report'}</button>
            </div>
          </form>
        `}
      </section>
    </div>
  `
}

function renderSkeleton() {
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-layout">
          <div class="dashboard-skeleton dashboard-skeleton-media"></div>
          <div class="dashboard-skeleton dashboard-skeleton-overview"></div>
          <div class="dashboard-skeleton dashboard-skeleton-content"></div>
          <div class="dashboard-skeleton dashboard-skeleton-sidebar"></div>
        </div>
      </section>
    </main>
  `
  initShellChrome()
}

function recommendationCardMarkup(product) {
  const art = product.thumbnailURL || product.coverURL
  const badge = product.genres?.[0] || product.productType || 'Product'
  return `
    <a class="dashboard-recommend-card" href="${productRoute(product)}" aria-label="Open ${escapeHtml(product.title)}">
      <div class="dashboard-recommend-thumb">
        ${art
          ? `<img src="${escapeHtml(art)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />`
          : '<div class="dashboard-recommend-fallback" aria-hidden="true"></div>'}
      </div>
      <div class="dashboard-recommend-body">
        <h4>${escapeHtml(product.title)}</h4>
        <p class="dashboard-recommend-creator">${escapeHtml(product.artistName)}</p>
        <div class="dashboard-recommend-meta">
          <span>${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</span>
          <span>${escapeHtml(badge)}</span>
        </div>
      </div>
    </a>
  `
}


function formatReviewTime(value) {
  const date = typeof value?.toDate === 'function' ? value.toDate() : new Date(value || 0)
  if (Number.isNaN(date.getTime())) return 'Just now'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function reviewInitials(name) {
  return creatorInitials(name || 'User')
}


function getLikeRatio(likes = 0, dislikes = 0) {
  const safeLikes = Math.max(0, Number(likes || 0))
  const safeDislikes = Math.max(0, Number(dislikes || 0))
  const total = safeLikes + safeDislikes
  if (!total) return { likePercent: 50, dislikePercent: 50, total: 0 }
  return { likePercent: Math.round((safeLikes / total) * 100), dislikePercent: Math.round((safeDislikes / total) * 100), total }
}
function getProductLikeCount(product = {}) { return Math.max(0, Number(product.counts?.likes ?? product.likeCount ?? 0)) }
function getProductDislikeCount(product = {}) { return Math.max(0, Number(product.counts?.dislikes ?? product.dislikeCount ?? 0)) }

function creatorReviewStatusMarkup(product = {}) {
  const status = String(product.status || '').toLowerCase()
  const reviewJobStatus = String(product.reviewJobStatus || '').toLowerCase()
  const moderationStatus = String(product.moderationStatus || '').toLowerCase()
  if (status === 'published') {
    return '<p class="dashboard-owner-note is-success">Published</p>'
  }
  if (status === 'needs_changes') {
    return '<p class="dashboard-owner-note">Changes requested by marketplace review.</p>'
  }
  if (reviewJobStatus === 'ai_failed' || reviewJobStatus === 'failed_ai_auth' || moderationStatus === 'ai_error') {
    return '<p class="dashboard-owner-note">AI review failed. Product is waiting for manual review.</p>'
  }
  if (status === 'review_pending' && reviewJobStatus === 'pending_manual_review' && product.moderationAISucceeded === true) {
    return '<p class="dashboard-owner-note is-success">AI review complete. Waiting for manual marketplace approval.</p>'
  }
  if (status === 'review_pending') {
    return '<p class="dashboard-owner-note">Product is pending marketplace review and is not public yet.</p>'
  }
  return ''
}

function formatAudioTime(seconds) {
  const total = Math.max(0, Number(seconds || 0))
  const mins = Math.floor(total / 60)
  const secs = Math.floor(total % 60)
  return `${mins}:${String(secs).padStart(2, '0')}`
}

function renderRatingStars(value = 0) {
  const width = Math.max(0, Math.min(100, (Number(value || 0) / 5) * 100))
  return `<span class="dashboard-rating-stars" aria-hidden="true"><span class="dashboard-rating-stars-empty">★★★★★</span><span class="dashboard-rating-stars-fill" style="width:${width}%">★★★★★</span></span>`
}
function creatorInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return 'CR'
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase() || '').join('')
}

function buildContributorRows(product = {}) {
  const rows = []
  const seen = new Set()
  const ownerUid = String(product.artistId || '').trim()
  const ownerName = String(product.artistDisplayName || product.artistName || 'Creator').trim()
  const ownerUsername = String(product.artistUsername || '').replace(/^@+/, '').trim()
  const ownerAvatar = product.artistAvatarURL || product.artistPhotoURL || ''
  const ownerProfilePath = product.artistProfilePath || (ownerUid ? `profiles/${ownerUid}` : '')
  const addRow = (row = {}, isOwner = false) => {
    const uidKey = String(row.uid || '').trim().toLowerCase()
    const nameKey = String(row.displayName || '').trim().toLowerCase()
    const dedupe = uidKey || nameKey
    if (!dedupe || seen.has(dedupe)) return
    seen.add(dedupe)
    rows.push({ ...row, isOwner })
  }
  addRow({ uid: ownerUid, displayName: ownerName, username: ownerUsername, avatarURL: ownerAvatar, role: 'Distributor', profilePath: ownerProfilePath }, true)
  ;(Array.isArray(product.contributors) ? product.contributors : []).forEach((entry) => {
    addRow({ uid: entry.uid || '', displayName: entry.displayName || entry.username || 'Contributor', username: entry.username || '', avatarURL: entry.avatarURL || '', role: entry.role || 'Contributor', profilePath: entry.profilePath || '' })
  })
  const legacyNames = Array.isArray(product.contributorNames) ? product.contributorNames : String(product.contributorNames || '').split(',').map((v) => v.trim()).filter(Boolean)
  const legacyIds = Array.isArray(product.contributorIds) ? product.contributorIds : String(product.contributorIds || '').split(',').map((v) => v.trim()).filter(Boolean)
  const legacyRoles = Array.isArray(product.contributorRoles) ? product.contributorRoles : String(product.contributorRoles || '').split(',').map((v) => v.trim()).filter(Boolean)
  legacyNames.forEach((name, index) => addRow({ uid: legacyIds[index] || '', displayName: name, username: '', avatarURL: '', role: legacyRoles[index] || 'Contributor', profilePath: legacyIds[index] ? `profiles/${legacyIds[index]}` : '' }))
  ;(Array.isArray(product.acceptedContributors) ? product.acceptedContributors : []).forEach((entry) => {
    addRow({ uid: entry.uid || entry.id || '', displayName: entry.displayName || entry.name || 'Contributor', username: entry.username || '', avatarURL: entry.avatarURL || entry.photoURL || '', role: entry.role || 'Contributor', profilePath: entry.profilePath || '' })
  })
  return rows
}



function formatBytes(size = 0) {
  const bytes = Math.max(0, Number(size || 0))
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / (1024 ** index)
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function normalizePackagePath(value = '') {
  const raw = String(value || '').trim()
  if (!raw || /^https?:\/\//i.test(raw)) return ''
  const cleaned = raw.split('?')[0].replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
  const marker = cleaned.match(/(?:deliverables|downloads|packages|package)\/(.+)$/i)
  return (marker?.[1] || cleaned).split('/').filter(Boolean).join('/')
}

function getFilePathCandidates(file = {}) {
  return [file.displayPath, file.path, file.storagePath, file.fullPath, file.name].map(normalizePackagePath).filter(Boolean)
}

function pathMatchesAny(candidate, knownPaths) {
  return knownPaths.some((known) => candidate === known || candidate.endsWith(`/${known}`) || known.endsWith(`/${candidate}`))
}

function getKnownListingMediaPaths(product = {}) {
  return [product.coverPath, product.thumbnailPath, product.primaryPreviewPath, product.previewAssignment?.hoverAudioPath, product.previewAssignment?.hoverVideoPath, ...(product.galleryPaths || []), ...(product.previewAudioPaths || []), ...(product.previewVideoPaths || [])].map(normalizePackagePath).filter(Boolean)
}

function getProductViewerDeliverableFiles(product = {}, productFiles = []) {
  const mergedFiles = [...(Array.isArray(productFiles) ? productFiles : []), ...(Array.isArray(product?.deliverableFiles) ? product.deliverableFiles : [])]
  const seen = new Set()
  const knownListingPaths = getKnownListingMediaPaths(product)
  const downloadPaths = [product.downloadPath, product.primaryDownloadPath].map(normalizePackagePath).filter(Boolean)
  return Array.from(mergedFiles || []).filter((file) => {
    const key = String(file.id || file.storagePath || file.displayPath || file.path || file.name || '')
    if (key && seen.has(key)) return false
    if (key) seen.add(key)
    const candidates = getFilePathCandidates(file)
    const roleText = [file.role, file.category, file.type, file.kind, file.contentType, file.purpose].join(' ').toLowerCase()
    const explicitDeliverable = file.isDeliverable === true || /\b(deliverable|deliverables|package|download)\b/.test(roleText)
    const explicitListingMedia = file.isPublicPreview === true || /preview|cover|thumbnail|gallery|listing media|public preview|hover/.test(roleText)
    if (candidates.some((candidate) => pathMatchesAny(candidate, knownListingPaths)) && !explicitDeliverable) return false
    if (explicitListingMedia && !explicitDeliverable) return false
    if (file.isDownloadable === false && !explicitDeliverable) return false
    if (explicitDeliverable && file.isDownloadable !== false) return true
    if (candidates.some((candidate) => pathMatchesAny(candidate, downloadPaths))) return true
    return explicitDeliverable && candidates.length > 0
  })
}

function getViewerFilePath(file = {}) {
  return getFilePathCandidates(file)[0] || normalizePackagePath(file.name) || 'Unnamed file'
}

function getFileExtension(path = '') {
  const name = String(path || '').split('/').pop() || ''
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > -1 ? name.slice(dotIndex + 1).toLowerCase() : ''
}

function inferFileDescription(file = {}, name = '') {
  const explicit = file.description || file.note || file.summary || file.kind || file.contentType
  if (explicit) return String(explicit)
  const ext = getFileExtension(name)
  if (['wav', 'aiff', 'aif', 'mp3', 'flac', 'ogg'].includes(ext)) return 'Audio file'
  if (['mid', 'midi'].includes(ext)) return 'MIDI file'
  if (['fxp', 'fxb', 'vital', 'serum', 'nmsv', 'adg'].includes(ext)) return 'Preset file'
  if (['zip', 'rar', '7z'].includes(ext)) return 'Product archive'
  if (['txt', 'md', 'pdf', 'rtf'].includes(ext)) return 'Documentation'
  return 'Product file'
}

function iconForFile(name = '') {
  const ext = getFileExtension(name)
  if (['wav', 'aiff', 'aif', 'mp3', 'flac', 'ogg', 'mid', 'midi'].includes(ext)) return 'music'
  if (['zip', 'rar', '7z'].includes(ext)) return 'package'
  if (['txt', 'md', 'pdf', 'rtf'].includes(ext)) return 'fileText'
  return 'file'
}

function createFileTree(files = []) {
  const root = { name: '', path: '', folders: new Map(), files: [] }
  files.forEach((file) => {
    const path = getViewerFilePath(file)
    const segments = path.split('/').filter(Boolean)
    if (!segments.length) return
    let current = root
    segments.slice(0, -1).forEach((segment) => {
      const nextPath = [current.path, segment].filter(Boolean).join('/')
      if (!current.folders.has(segment)) current.folders.set(segment, { name: segment, path: nextPath, folders: new Map(), files: [] })
      current = current.folders.get(segment)
    })
    current.files.push({ ...file, viewerName: segments.at(-1), viewerPath: path })
  })
  return root
}

function summarizeTreeNode(node) {
  let fileCount = node.files.length
  let folderCount = node.folders.size
  let sizeBytes = node.files.reduce((sum, file) => sum + Number(file.sizeBytes || file.size || 0), 0)
  node.folders.forEach((folder) => {
    const summary = summarizeTreeNode(folder)
    fileCount += summary.fileCount
    folderCount += summary.folderCount
    sizeBytes += summary.sizeBytes
  })
  return { fileCount, folderCount, sizeBytes }
}

function getTreeNode(root, path = '') {
  return normalizePackagePath(path).split('/').filter(Boolean).reduce((node, segment) => node?.folders.get(segment), root) || null
}

function renderProductFileBrowser(product, productFiles, ownsProduct) {
  const deliverableFiles = getProductViewerDeliverableFiles(product, productFiles)
  const root = createFileTree(deliverableFiles)
  let currentPath = normalizePackagePath(state.fileBrowserPath)
  let currentNode = getTreeNode(root, currentPath)
  if (!currentNode) {
    currentPath = ''
    state.fileBrowserPath = ''
    currentNode = root
  }
  const rootSummary = summarizeTreeNode(root)
  const currentSummary = summarizeTreeNode(currentNode)
  const segments = currentPath.split('/').filter(Boolean)
  const crumbs = [`<button type="button" data-file-browser-path="" aria-label="Open package root"><span class="product-file-crumb-icon">${iconSvg('home')}</span>Root</button>`, ...segments.map((segment, index) => {
    const path = segments.slice(0, index + 1).join('/')
    return `<span class="product-file-crumb-separator">${iconSvg('chevronRight')}</span><button type="button" data-file-browser-path="${escapeHtml(path)}">${escapeHtml(segment)}</button>`
  })].join('')
  const parentPath = segments.slice(0, -1).join('/')
  const currentFolderName = segments.at(-1) || 'Root'
  const backRow = currentPath ? `<button type="button" class="product-file-row is-folder is-back-row" role="treeitem" data-file-browser-path="${escapeHtml(parentPath)}"><span class="product-file-icon">${iconSvg('arrowLeft')}</span><span class="product-file-name">Back</span><span class="product-file-current-folder">${escapeHtml(currentFolderName)}</span><span class="product-file-meta">..</span></button>` : ''
  const folderRows = Array.from(currentNode.folders.values()).sort((a, b) => a.name.localeCompare(b.name)).map((folder) => {
    const summary = summarizeTreeNode(folder)
    return `<button type="button" class="product-file-row is-folder" role="treeitem" data-file-browser-path="${escapeHtml(folder.path)}"><span class="product-file-icon">${iconSvg('folder')}</span><span class="product-file-name">${escapeHtml(folder.name)}</span><span class="product-file-description">Folder · ${summary.fileCount} files · ${summary.folderCount} folders</span><span class="product-file-meta">${formatBytes(summary.sizeBytes)}</span></button>`
  }).join('')
  const fileRows = currentNode.files.slice().sort((a, b) => a.viewerName.localeCompare(b.viewerName)).map((file) => {
    const description = inferFileDescription(file, file.viewerName)
    const status = ownsProduct ? 'Download' : 'Locked manifest'
    return `<button type="button" class="product-file-row is-file" role="treeitem" data-file-browser-file="${escapeHtml(file.viewerPath)}" data-file-browser-file-id="${escapeHtml(file.id || '')}" data-file-browser-storage-path="${escapeHtml(file.storagePath || '')}"><span class="product-file-icon">${iconSvg(iconForFile(file.viewerName))}</span><span class="product-file-name">${escapeHtml(file.viewerName)}</span><span class="product-file-description">${escapeHtml(description)}</span><span class="product-file-meta"><span class="product-file-status">${iconSvg(ownsProduct ? 'package' : 'lock')} ${escapeHtml(status)}</span><span>${formatBytes(file.sizeBytes || file.size || 0)}</span></span></button>`
  }).join('')
  const rows = `${backRow}${folderRows}${fileRows}` || '<div class="product-file-empty">No included files listed yet.</div>'
  return `<div class="product-file-browser" data-file-browser-root><div class="product-file-browser-header"><div><h2>File Viewer</h2><p>Product package manifest. File contents stay locked.</p></div><div class="product-file-browser-summary">${rootSummary.fileCount} files · ${rootSummary.folderCount} folders · ${formatBytes(rootSummary.sizeBytes)}</div></div><div class="product-file-browser-divider"></div><div class="product-file-browser-body"><div class="product-file-breadcrumbs" aria-label="File browser breadcrumbs">${crumbs}</div><div class="product-file-list-wrap"><div class="product-file-message ${state.fileBrowserMessage ? 'is-visible' : ''}" data-file-browser-message>${escapeHtml(state.fileBrowserMessage)}</div><div class="product-file-list" role="tree" aria-label="Product package files">${rows}</div></div></div><p class="product-file-footer">Viewing ${escapeHtml(currentPath || 'Root')} · ${currentSummary.fileCount} files · ${currentSummary.folderCount} folders</p></div>`
}


function bindInteractiveRatingControl() {
  const root = app.querySelector('[data-rating-interactive]')
  if (!root) return
  if (root.dataset.ratingBound === 'true') return
  root.dataset.ratingBound = 'true'

  const input = app.querySelector('[data-rating-slider]')
  const fill = app.querySelector('[data-rating-fill]')
  const valueLabel = app.querySelector('[data-rating-value]')

  const setRating = (rating) => {
    const safeRating = Math.max(0, Math.min(5, Math.round(Number(rating || 0) * 2) / 2))
    if (input) input.value = String(safeRating)
    if (fill) fill.style.width = `${(safeRating / 5) * 100}%`
    if (valueLabel) valueLabel.textContent = `${safeRating % 1 ? safeRating.toFixed(1) : safeRating.toFixed(0)} / 5`
    root.setAttribute('aria-valuenow', String(safeRating))
    root.setAttribute('aria-valuetext', `${safeRating} out of 5 stars`)
    if (PRODUCT_REVIEW_DEBUG) console.debug('[product-review] rating changed', { rating: safeRating })
  }

  const ratingFromPointer = (event) => {
    const rect = root.getBoundingClientRect()
    if (!rect.width) return 0.5
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left))
    return Math.max(0.5, Math.min(5, Math.ceil((x / rect.width) * 5 * 2) / 2))
  }

  let dragging = false

  root.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    dragging = true
    root.setPointerCapture?.(event.pointerId)
    setRating(ratingFromPointer(event))
  })

  root.addEventListener('pointermove', (event) => {
    if (!dragging) return
    setRating(ratingFromPointer(event))
  })

  root.addEventListener('pointerup', (event) => {
    if (!dragging) return
    setRating(ratingFromPointer(event))
    dragging = false
    root.releasePointerCapture?.(event.pointerId)
  })

  root.addEventListener('pointercancel', (event) => {
    dragging = false
    root.releasePointerCapture?.(event.pointerId)
  })

  root.addEventListener('click', (event) => {
    setRating(ratingFromPointer(event))
  })

  root.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const current = Number(input?.value || 0)
    if (event.key === 'Home') setRating(0.5)
    else if (event.key === 'End') setRating(5)
    else setRating(current + (event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -0.5 : 0.5))
  })

  setRating(input?.value || 0)
}

function bindProductFileBrowser(product, productFiles, ownsProduct) {
  const root = app.querySelector('[data-file-browser-root]')
  if (!root) return
  const renderIntoRoot = () => {
    const next = document.createElement('div')
    next.innerHTML = renderProductFileBrowser(product, productFiles, ownsProduct).trim()
    root.replaceWith(next.firstElementChild)
    bindProductFileBrowser(product, productFiles, ownsProduct)
  }
  root.addEventListener('click', async (event) => {
    const pathButton = event.target.closest('[data-file-browser-path]')
    if (pathButton) {
      event.preventDefault()
      state.fileBrowserPath = pathButton.getAttribute('data-file-browser-path') || ''
      state.fileBrowserMessage = ''
      renderIntoRoot()
      return
    }
    const fileButton = event.target.closest('[data-file-browser-file]')
    if (fileButton) {
      event.preventDefault()
      if (!ownsProduct) {
        state.fileBrowserMessage = 'File contents are available after purchase or free library claim.'
        renderIntoRoot()
        return
      }
      state.fileBrowserMessage = 'Creating secure download link...'
      renderIntoRoot()
      try {
        const result = await createProductDownloadUrl(product.id, {
          fileId: fileButton.getAttribute('data-file-browser-file-id') || '',
          filePath: fileButton.getAttribute('data-file-browser-storage-path') || '',
          path: fileButton.getAttribute('data-file-browser-file') || ''
        })
        if (!result?.url) throw new Error('Missing download URL.')
        window.open(result.url, '_blank', 'noopener')
        state.fileBrowserMessage = `Download link opened for ${result.fileName || 'file'}. It expires shortly.`
      } catch (error) {
        console.warn('[product] download link failed', { code: error?.code, message: error?.message })
        state.fileBrowserMessage = error?.code === 'functions/permission-denied'
          ? 'You do not have access to download this file.'
          : 'Could not create download link. Try again.'
      }
      renderIntoRoot()
    }
  })
}

function renderAudioPlayIcon(isPlaying) { return isPlaying ? iconSvg('pause') : iconSvg('play') }
function syncAudioUi(audio, index) {
  const range = app.querySelector(`[data-audio-range][data-audio-index="${index}"]`)
  const time = app.querySelector(`[data-audio-time][data-audio-index="${index}"]`)
  const btn = app.querySelector(`[data-audio-play][data-audio-index="${index}"]`)
  const duration = Number.isFinite(audio.duration) ? audio.duration : 0
  if (range) range.value = String(duration ? Math.round((audio.currentTime / duration) * 1000) : 0)
  if (time) time.textContent = `${formatAudioTime(audio.currentTime)} / ${formatAudioTime(duration)}`
  if (btn) { btn.classList.toggle('is-playing', !audio.paused); btn.setAttribute('aria-pressed', String(!audio.paused)); btn.setAttribute('aria-label', `${audio.paused ? 'Play' : 'Pause'} audio preview ${index + 1}`); const icon = btn.querySelector('[data-audio-icon]'); if (icon) icon.innerHTML = renderAudioPlayIcon(!audio.paused) }
}
function bindAudioPreviewControls() {
  const audios = Array.from(app.querySelectorAll('audio[data-dashboard-audio]'))
  audios.forEach((audio) => { const index = Number(audio.getAttribute('data-dashboard-audio') || -1); if (!String(audio.getAttribute('src') || '').trim()) console.warn('[product] audio preview URL missing', { index }); audio.addEventListener('loadedmetadata', () => syncAudioUi(audio, index)); audio.addEventListener('timeupdate', () => syncAudioUi(audio, index)); audio.addEventListener('ended', () => syncAudioUi(audio, index)) })
  app.querySelectorAll('[data-audio-play]').forEach((button) => button.addEventListener('click', async (event) => { event.preventDefault(); event.stopPropagation(); const index = Number(button.getAttribute('data-audio-index') || -1); const audio = app.querySelector(`audio[data-dashboard-audio="${index}"]`); if (!(audio instanceof HTMLAudioElement)) { console.warn('[product] audio element not found for preview', { index }); return } audios.forEach((other) => { if (other !== audio) { other.pause(); syncAudioUi(other, Number(other.getAttribute('data-dashboard-audio') || -1)) } }); if (audio.paused) { try { await audio.play() } catch (error) { console.warn('[product] audio preview playback failed', { index, src: audio.currentSrc || audio.src || '', message: error?.message }); return } } else audio.pause(); syncAudioUi(audio, index) }))
  app.querySelectorAll('[data-audio-range]').forEach((range) => range.addEventListener('input', () => { const index = Number(range.getAttribute('data-audio-index') || -1); const audio = app.querySelector(`audio[data-dashboard-audio="${index}"]`); if (!(audio instanceof HTMLAudioElement) || !Number.isFinite(audio.duration) || !audio.duration) return; audio.currentTime = (Number(range.value || 0) / 1000) * audio.duration; syncAudioUi(audio, index) }))
}


let productEngagementBound = false
let activeProductEngagementContext = null
let reactionMutationSeq = 0
let saveMutationSeq = 0
let reactionDebounceTimer = null
const REACTION_DEBOUNCE_MS = 160

function syncProductEngagementUi() {
  const engagement = state.productEngagement || {}
  const likeCount = Math.max(0, Number(engagement.likeCount || 0))
  const dislikeCount = Math.max(0, Number(engagement.dislikeCount || 0))
  const saveCount = Math.max(0, Number(engagement.saveCount || 0))
  const reaction = engagement.reaction === 'like' || engagement.reaction === 'dislike' ? engagement.reaction : null
  const saved = Boolean(engagement.saved)
  const total = likeCount + dislikeCount
  const ratio = getLikeRatio(likeCount, dislikeCount)

  const likeBtn = app.querySelector('[data-product-reaction="like"]')
  const dislikeBtn = app.querySelector('[data-product-reaction="dislike"]')
  const saveBtn = app.querySelector('[data-product-save]')
  likeBtn?.classList.toggle('is-active', reaction === 'like')
  dislikeBtn?.classList.toggle('is-active', reaction === 'dislike')
  saveBtn?.classList.toggle('is-active', saved)
  likeBtn?.setAttribute('aria-pressed', String(reaction === 'like'))
  dislikeBtn?.setAttribute('aria-pressed', String(reaction === 'dislike'))
  saveBtn?.setAttribute('aria-pressed', String(saved))

  app.querySelectorAll('[data-product-like-count]').forEach((el) => { el.textContent = String(likeCount) })
  app.querySelectorAll('[data-product-dislike-count]').forEach((el) => { el.textContent = String(dislikeCount) })
  app.querySelectorAll('[data-product-save-count]').forEach((el) => { el.textContent = String(saveCount) })
  app.querySelectorAll('[data-product-like-bar]').forEach((el) => { el.style.width = `${ratio.likePercent}%` })
  app.querySelectorAll('[data-product-dislike-bar]').forEach((el) => { el.style.width = `${ratio.dislikePercent}%` })
  app.querySelectorAll('[data-product-sentiment-meter]').forEach((el) => { el.classList.toggle('is-empty', total === 0) })
}

function bindProductEngagementHandlers(context) {
  activeProductEngagementContext = context
  if (productEngagementBound) return
  productEngagementBound = true

  const flushReactionUpdate = async (ctx, seq, previous) => {
    const latestReaction = state.productEngagement.reaction
    console.info('[product] engagement reaction write scheduled', { productId: ctx.product.id, reaction: latestReaction, seq })
    try {
      const result = await setProductEngagement(ctx.product.id, { reaction: latestReaction, updateReaction: true, updateSaved: false })
      if (seq !== reactionMutationSeq) {
        console.info('[product] ignored stale server result', { productId: ctx.product.id, action: 'reaction', seq, latestSeq: reactionMutationSeq })
        return
      }
      state.productEngagement = {
        ...state.productEngagement,
        productId: ctx.product.id,
        reaction: result?.reaction === 'like' || result?.reaction === 'dislike' ? result.reaction : null,
        likeCount: Math.max(0, Number(result?.likeCount ?? state.productEngagement.likeCount ?? 0)),
        dislikeCount: Math.max(0, Number(result?.dislikeCount ?? state.productEngagement.dislikeCount ?? 0)),
        saved: state.productEngagement.saved,
        saveCount: state.productEngagement.saveCount,
        loading: false,
        error: ''
      }
      console.info('[product] applied latest server result', { productId: ctx.product.id, action: 'reaction', reaction: state.productEngagement.reaction, likeCount: state.productEngagement.likeCount, dislikeCount: state.productEngagement.dislikeCount })
      syncProductEngagementUi()
    } catch (error) {
      if (seq !== reactionMutationSeq) return
      state.productEngagement = previous
      syncProductEngagementUi()
      ctx.showActionMessage('Could not update engagement')
      console.warn('[product] engagement update failed', { action: 'reaction', code: error?.code, message: error?.message, details: error?.details })
    }
  }

  app.addEventListener('click', async (event) => {
    const ctx = activeProductEngagementContext
    if (!ctx) return
    const reactionButton = event.target.closest('[data-product-reaction]')
    const saveButton = event.target.closest('[data-product-save]')
    if (!reactionButton && !saveButton) return
    if (ctx.product?.id !== state.productEngagement.productId || state.isDraftPreview) {
      console.warn('[product] engagement click ignored', { contextProductId: ctx.product?.id || '', stateProductId: state.productEngagement.productId || '', isDraftPreview: state.isDraftPreview })
      return
    }
    if (!ctx.requireAuth()) return

    if (reactionButton) {
      const previous = { ...state.productEngagement }
      const action = String(reactionButton.getAttribute('data-product-reaction') || '')
      const prevReaction = state.productEngagement.reaction
      const nextReaction = prevReaction === action ? null : action
      const likeDelta = (nextReaction === 'like' ? 1 : 0) - (prevReaction === 'like' ? 1 : 0)
      const dislikeDelta = (nextReaction === 'dislike' ? 1 : 0) - (prevReaction === 'dislike' ? 1 : 0)
      state.productEngagement.reaction = nextReaction
      state.productEngagement.likeCount = Math.max(0, state.productEngagement.likeCount + likeDelta)
      state.productEngagement.dislikeCount = Math.max(0, state.productEngagement.dislikeCount + dislikeDelta)
      console.info('[product] optimistic reaction', { productId: ctx.product.id, action, previousReaction: prevReaction, nextReaction })
      syncProductEngagementUi()

      const seq = ++reactionMutationSeq
      if (reactionDebounceTimer) clearTimeout(reactionDebounceTimer)
      reactionDebounceTimer = setTimeout(() => {
        reactionDebounceTimer = null
        void flushReactionUpdate(ctx, seq, previous)
      }, REACTION_DEBOUNCE_MS)
      return
    }

    if (saveButton) {
      const previous = { ...state.productEngagement }
      const seq = ++saveMutationSeq
      const nextSaved = !state.productEngagement.saved
      state.productEngagement.saved = nextSaved
      state.productEngagement.saveCount = Math.max(0, state.productEngagement.saveCount + (nextSaved ? 1 : -1))
      console.info('[product] optimistic save', { productId: ctx.product.id, saved: nextSaved, seq })
      syncProductEngagementUi()
      try {
        const result = await setProductEngagement(ctx.product.id, { saved: nextSaved, updateSaved: true, updateReaction: false })
        if (seq !== saveMutationSeq) {
          console.info('[product] ignored stale server result', { productId: ctx.product.id, action: 'save', seq, latestSeq: saveMutationSeq })
          return
        }
        state.productEngagement = {
        ...state.productEngagement,
        productId: ctx.product.id,
        reaction: result?.reaction === 'like' || result?.reaction === 'dislike' ? result.reaction : null,
        likeCount: Math.max(0, Number(result?.likeCount ?? state.productEngagement.likeCount ?? 0)),
        dislikeCount: Math.max(0, Number(result?.dislikeCount ?? state.productEngagement.dislikeCount ?? 0)),
        saved: state.productEngagement.saved,
        saveCount: state.productEngagement.saveCount,
        loading: false,
        error: ''
      }
        console.info('[product] applied latest server result', { productId: ctx.product.id, action: 'save', saved: state.productEngagement.saved, saveCount: state.productEngagement.saveCount })
        syncProductEngagementUi()
      } catch (error) {
        if (seq !== saveMutationSeq) return
        state.productEngagement = previous
        syncProductEngagementUi()
        ctx.showActionMessage('Could not update engagement')
        console.warn('[product] engagement update failed', { action: 'save', code: error?.code, message: error?.message, details: error?.details })
      }
    }
  })
}

function renderProduct(product, recommendations = [], ownerPreview = false, productFiles = [], ownsProduct = false) {
  const mediaItems = buildMediaItems(product)
  state.mediaItems = mediaItems
  state.selectedMediaIndex = 0

  const listingThumbnailURL = product.thumbnailURL || product.coverURL || ''
  const typeLabel = product.productType || 'Product'
  const creatorHref = product.artistId ? publicProfileRoute({ uid: product.artistId }) : ROUTES.profilePublic
  if (state.productEngagement.productId !== product.id) {
    state.productEngagement = {
      productId: product.id,
      reaction: null,
      saved: false,
      likeCount: getProductLikeCount(product),
      dislikeCount: getProductDislikeCount(product),
      saveCount: Number(product.counts?.saves ?? product.saveCount ?? 0),
      loading: false,
      error: ''
    }
  }
  if (state.fileBrowserProductId !== product.id) {
    state.fileBrowserProductId = product.id
    state.fileBrowserPath = ''
    state.fileBrowserMessage = ''
  }
  const likeCount = state.productEngagement.likeCount
  const dislikeCount = state.productEngagement.dislikeCount
  const artistDisplayName = product.artistDisplayName || product.artistName || 'Creator'
  const handleRaw = product.artistUsername || product.creatorUsername || product.username || product.artistHandle || product.creator?.username || product.artist?.username || ''
  const artistHandle = formatUsername(handleRaw)
  const creatorAvatar = product.artistAvatarURL || product.artistPhotoURL || ''
  const isOwner = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)
  const giftRequested = ['1', 'true'].includes(String(new URLSearchParams(window.location.search).get('sendgift') || new URLSearchParams(window.location.search).get('sendGift') || '').toLowerCase())
  if (giftRequested) {
    if (isOwner) renderGiftFlow(product)
    else renderGiftAccessDenied(product)
    return
  }
  const ratedReviews = (state.reviews || []).map((review) => Number(review.rating)).filter((rating) => Number.isFinite(rating) && rating >= 1 && rating <= 5)
  const fallbackAvg = ratedReviews.length ? (ratedReviews.reduce((sum, value) => sum + value, 0) / ratedReviews.length) : 0
  const aggregateAvg = Number(product.averageRating ?? product.ratingAverage ?? 0)
  const averageRating = Number.isFinite(aggregateAvg) && aggregateAvg > 0 ? aggregateAvg : fallbackAvg
  const aggregateCount = Number(product.ratingCount ?? product.reviewCount ?? ratedReviews.length)
  const ratingCount = Number.isFinite(aggregateCount) && aggregateCount > 0 ? aggregateCount : ratedReviews.length
  const moderationLabel = (() => {
    if (String(product.status || '').toLowerCase() === 'needs_changes') return 'Needs Changes'
    if (String(product.status || '').toLowerCase() === 'review_pending') return 'Pending Review'
    if (String(product.moderationStatus || '').toLowerCase() === 'approved') return 'Approved'
    if (String(product.status || '').toLowerCase() === 'published' && String(product.visibility || '').toLowerCase() === 'public') return 'Approved/Public'
    return product.moderationStatus || 'Pending'
  })()
  const contributorRows = buildContributorRows(product)
  const isFreeProduct = Boolean(product.isFree) || Number(product.priceCents || 0) <= 0
  const userHasAccess = Boolean(isOwner || ownsProduct)
  const primaryActionLabel = userHasAccess
    ? 'In Library'
    : isFreeProduct
      ? 'Add to Library'
      : 'Add to Cart'

  const thumbMarkup = mediaItems.map((item, index) => `
    <button type="button" class="dashboard-thumb" data-media-index="${index}" aria-label="Show media ${index + 1}" aria-pressed="${index === 0 ? 'true' : 'false'}">
      ${item.type === 'video'
        ? '<span class="dashboard-thumb-video">Video preview</span>'
        : `<img src="${escapeHtml(item.url)}" alt="" loading="lazy" />`}
    </button>
  `).join('')

  const tags = (product.tags || []).slice(0, 12)
  app.innerHTML = `
    ${navShell({ currentPage: 'products' })}
    <main>
      ${state.isDraftPreview ? '<section class=\"section\"><div class=\"section-inner\"><article class=\"panel-surface draft-preview-banner\">Marketplace Preview — actions are disabled.</article></div></section>' : ''}
      <section class="section product-dashboard-shell">
        <div class="section-inner product-dashboard-layout">
          <section class="dashboard-media-area panel-surface" aria-label="Product media gallery">
            ${isOwner ? `
              <article class="dashboard-owner-header-card">
                <p class="eyebrow">Your listing</p>
                <h3>${ownerPreview ? 'Private owner preview' : 'Manage this product'}</h3>
                <p>Status: ${escapeHtml(product.status || 'draft')} · Visibility: ${escapeHtml(product.visibility || 'private')}</p>
                <p>Created: ${escapeHtml(formatReleaseDate(product.createdAt))} · Updated: ${escapeHtml(formatReleaseDate(product.updatedAt || product.createdAt))}</p>
                <p>Moderation: ${escapeHtml(moderationLabel)}</p>
                ${creatorReviewStatusMarkup(product)}
                <a class="button button-muted" href="${ROUTES.newProduct}?id=${encodeURIComponent(product.id)}&mode=edit">Edit listing</a>
              </article>
            ` : ''}
            <div class="dashboard-main-media" data-dashboard-main-media></div>
            ${thumbMarkup ? `
              <div class="dashboard-thumb-toolbar">
                <button type="button" class="dashboard-nav-btn" data-media-prev aria-label="Previous media">◀</button>
                <div class="dashboard-thumb-row">${thumbMarkup}</div>
                <button type="button" class="dashboard-nav-btn" data-media-next aria-label="Next media">${iconSvg('play')}</button>
              </div>
            ` : ''}
            ${(product.previewAudioURLs || []).length ? `
              <section class="dashboard-audio-panel">
                <h3>Audio previews</h3>
                <div class="dashboard-audio-row" data-dashboard-audio-row>
                  ${product.previewAudioURLs.map((url, index) => `<div class="dashboard-audio-card" data-audio-card><button type="button" class="dashboard-audio-play" data-audio-play data-audio-index="${index}" aria-label="Play audio preview ${index + 1}" aria-pressed="false"><span data-audio-icon aria-hidden="true">${renderAudioPlayIcon(false)}</span></button><div class="dashboard-audio-meta"><p>Audio preview ${index + 1}</p><span data-audio-time data-audio-index="${index}">0:00 / 0:00</span><input class="dashboard-audio-range" type="range" min="0" max="1000" value="0" data-audio-range data-audio-index="${index}" aria-label="Audio preview ${index + 1} progress"></div><audio src="${escapeHtml(url)}" preload="metadata" data-dashboard-audio="${index}"></audio></div>`).join('')}
                </div>
              </section>
            ` : ''}
          </section>

          <section class="dashboard-main-sections panel-surface">
            <div class="dashboard-content-parent">
              <article class="dashboard-section-card dashboard-about-section">
                <h2>About this product</h2>
                <div class="dashboard-rich-description">${renderSafeRichDescription(product.description || product.shortDescription || '')}</div>
              </article>

              <div class="dashboard-details-split">
                <article class="dashboard-section-card dashboard-file-tree-viewer">
                  ${renderProductFileBrowser(product, productFiles, ownsProduct)}
                </article>

                <aside class="dashboard-metadata-panel">
                  <div class="dashboard-metadata-stack">
                    <article class="dashboard-section-card dashboard-metadata-card">
                      <h2>Compatibility</h2>
                      <p>${escapeHtml((product.dawCompatibility || []).join(', ') || (product.formatKeys || []).join(', ') || 'Compatibility details are based on creator-provided metadata.')}</p>
                    </article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>License / Usage</h2><p>${product.licensePath ? 'License included.' : 'License details were not uploaded yet.'}</p></article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>Creator Notes</h2><p>${escapeHtml(product.shortDescription || 'Creator notes will appear here when provided.')}</p></article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>Tags</h2><div class="dashboard-tag-row">${tags.length ? tags.map((tag) => `<span class="dashboard-pill">${escapeHtml(tag)}</span>`).join('') : '<span class="dashboard-pill">No tags yet</span>'}</div></article>
                    <article class="dashboard-section-card dashboard-metadata-card"><h2>Stats</h2><p>${Math.max(0, likeCount)} likes · ${Math.max(0, dislikeCount)} dislikes · Saves ${state.productEngagement.saveCount} · Downloads ${product.downloadCount ?? product.counts?.downloads ?? 0}</p></article>
                  </div>
                </aside>
              </div>

              
            </div>
          </section>
          <div class="dashboard-full-width-divider"></div>
              <article class="dashboard-section-card dashboard-recommendations-section dashboard-recommendations-fullwidth">
                <div class="dashboard-lower-section-header"><h2>Recommended products</h2><a href="${ROUTES.products}">Browse all</a></div>
                ${recommendations.length ? `<div class="dashboard-recommend-carousel" aria-label="Recommended products">${recommendations.map((item) => recommendationCardMarkup(item)).join('')}</div>` : `<p>${state.pageData.recommendationsLoading ? 'Loading recommendations...' : 'No recommendations yet.'}</p>`}
              </article>
              <div class="dashboard-lower-section-divider"></div>
              <article class="dashboard-section-card dashboard-reviews-section dashboard-reviews-fullwidth">
                <div class="dashboard-lower-section-header">
                  <div><h2>Reviews</h2><p class="dashboard-mini-note">${product.averageRating ? `${Number(product.averageRating).toFixed(1)} average · ${product.reviewCount ?? product.commentCount ?? state.reviews.length} reviews` : 'No ratings yet'}</p></div>
                  <span class="dashboard-review-count-badge">${product.reviewCount ?? product.commentCount ?? state.reviews.length} reviews</span>
                </div>
                ${state.currentUser?.uid ? `<form class="dashboard-review-composer" data-review-form><label for="review-body">Write a review</label><div class="dashboard-rating-control" data-rating-control><button type="button" class="dashboard-rating-stars-wrap dashboard-rating-interactive" data-rating-interactive role="slider" aria-label="Set rating out of 5 stars" aria-valuemin="0.5" aria-valuemax="5" aria-valuenow="0"><span class="dashboard-rating-stars" aria-hidden="true"><span class="dashboard-rating-stars-empty">★★★★★</span><span class="dashboard-rating-stars-fill" data-rating-fill style="width:0%">★★★★★</span></span></button><input type="range" name="rating" min="0" max="5" step="0.5" value="0" class="dashboard-rating-slider is-visually-hidden" data-rating-slider aria-label="Rating out of 5 stars" /><span class="dashboard-rating-value" data-rating-value>0 / 5</span></div><textarea id="review-body" name="body" maxlength="5000" placeholder="Share your thoughts about this product..."></textarea><div class="dashboard-review-submit-row"><button class="button button-accent" type="submit">Submit review</button></div></form>` : '<p class="dashboard-mini-note">Sign in to review this product.</p>'}
                <div class="dashboard-review-list">${state.reviews.length ? state.reviews.map((review) => `<article class="dashboard-review-card"><div class="dashboard-review-header"><div class="dashboard-review-author">${review.avatarURL ? `<img class="dashboard-creator-avatar" src="${escapeHtml(review.avatarURL)}" alt="${escapeHtml(review.displayName || 'User')} avatar" loading="lazy" />` : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(reviewInitials(review.displayName || 'User'))}</span>`}<div class="dashboard-review-author-meta"><p class="dashboard-creator-name">${escapeHtml(review.displayName || 'User')}</p><p class="dashboard-mini-note">${escapeHtml(formatReviewTime(review.createdAt))}</p></div></div><div class="dashboard-review-menu-wrap"><button type="button" aria-label="Review options" class="dashboard-review-menu-button" data-toggle-review-menu="${escapeHtml(review.id)}"><span class="icon">${iconSvg('moreVertical')}</span></button>${state.openReviewMenuId === review.id ? `<div class="dashboard-review-menu"><button type="button" class="dashboard-review-menu-item ${review.uid === state.currentUser?.uid ? 'danger' : 'warning'}" data-review-menu-action="${escapeHtml(review.id)}:${review.uid === state.currentUser?.uid ? 'delete' : 'report'}">${review.uid === state.currentUser?.uid ? `${iconSvg('trash')} Delete` : `${iconSvg('alertCircle')} Report`}</button></div>` : ''}</div></div><p class="dashboard-review-rating">${review.rating ? `${renderRatingStars(review.rating)} <span>${Number(review.rating).toFixed(review.rating % 1 ? 1 : 0)} / 5</span>` : 'No star rating'}</p><p>${escapeHtml(review.body || '')}</p><div class="dashboard-review-actions"><button type="button" class="dashboard-review-action ${state.reviewReactions[review.id] === 'like' ? 'is-active' : ''}" data-review-react="${escapeHtml(review.id)}:like"><span class="icon">${iconSvg('thumbsUp')}</span> <em>${Math.max(0, Number(review.likeCount || 0))}</em></button><button type="button" class="dashboard-review-action ${state.reviewReactions[review.id] === 'dislike' ? 'is-active' : ''}" data-review-react="${escapeHtml(review.id)}:dislike"><span class="icon">${iconSvg('thumbsDown')}</span> <em>${Math.max(0, Number(review.dislikeCount || 0))}</em></button><button type="button" class="dashboard-review-action" data-toggle-replies="${escapeHtml(review.id)}"><span class="icon">${iconSvg('messageCircleReply')}</span> <em>${Number(review.replyCount || 0)}</em></button></div>${state.reviewActionErrors[review.id] ? `<p class="dashboard-review-inline-error">${escapeHtml(state.reviewActionErrors[review.id])}</p>` : ''}${state.openReplyComposerFor === review.id ? `<form class="dashboard-review-reply-composer" data-review-reply-form="${escapeHtml(review.id)}"><textarea class="dashboard-review-reply-textarea" maxlength="1200" placeholder="Write a reply...">${escapeHtml(state.replyDrafts[review.id] || '')}</textarea><div class="dashboard-review-reply-submit-row"><button type="submit" class="button button-muted">Post reply</button></div></form>` : ''}${state.replyLoadErrors[review.id] ? `<p class="dashboard-review-inline-error">${escapeHtml(state.replyLoadErrors[review.id])}</p>` : ''}<div class="dashboard-review-replies">${(state.reviewReplies[review.id] || []).map((reply) => `<article class="dashboard-review-reply-card"><div class="dashboard-review-reply-header"><div class="dashboard-review-reply-author">${reply.avatarURL ? `<img class="dashboard-review-reply-avatar" src="${escapeHtml(reply.avatarURL)}" alt="${escapeHtml(reply.displayName || 'User')} avatar" loading="lazy" />` : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(reviewInitials(reply.displayName || 'User'))}</span>`}<div><p class="dashboard-review-reply-name">${escapeHtml(reply.displayName || 'User')}</p><p class="dashboard-review-reply-time">${escapeHtml(formatReviewTime(reply.createdAt))}</p></div></div><div class="dashboard-review-menu-wrap"><button type="button" aria-label="Reply options" class="dashboard-review-menu-button" data-toggle-reply-menu="${escapeHtml(review.id)}:${escapeHtml(reply.id)}"><span class="icon">${iconSvg('moreVertical')}</span></button>${state.openReplyMenuKey === `${review.id}:${reply.id}` ? `<div class="dashboard-review-menu"><button type="button" class="dashboard-review-menu-item ${reply.uid === state.currentUser?.uid ? 'danger' : 'warning'}" data-reply-menu-action="${escapeHtml(review.id)}:${escapeHtml(reply.id)}:${reply.uid === state.currentUser?.uid ? 'delete' : 'report'}">${reply.uid === state.currentUser?.uid ? `${iconSvg('trash')} Delete` : `${iconSvg('alertCircle')} Report`}</button></div>` : ''}</div></div><p class="dashboard-review-reply-body">${escapeHtml(reply.body || '')}</p></article>`).join('')}</div></article>`).join('') : `<p class="dashboard-review-empty">${state.pageData.reviewsLoading ? 'Loading reviews...' : 'No reviews yet. Be the first to review this product.'}</p>`}</div>
              </article>

          <aside class="dashboard-lower-sidebar">
            <article class="panel-surface dashboard-overview">
              <p class="dashboard-breadcrumbs"><a href="${ROUTES.products}">Products</a> <span>&gt;</span> <span>${escapeHtml((product.categories || [])[0] || 'Catalog')}</span> <span>&gt;</span> <span>${escapeHtml(typeLabel)}</span></p>
              ${listingThumbnailURL ? `<img class="dashboard-cover-banner" src="${escapeHtml(listingThumbnailURL)}" alt="${escapeHtml(product.title)} cover" loading="lazy" />` : ''}
              <h2>${escapeHtml(product.title)}</h2>
              <p class="dashboard-short-description">${escapeHtml(product.shortDescription || product.description || 'No description has been shared yet.')}</p>
              <div class="dashboard-top-badges">
                ${(product.genres || []).slice(0, 3).map((genre) => `<span class="dashboard-pill">${escapeHtml(genre)}</span>`).join('')}
              </div>
              <dl class="dashboard-overview-grid">
                <div><dt>Type</dt><dd>${escapeHtml(typeLabel)}</dd></div>
                <div><dt>Release date</dt><dd>${escapeHtml(formatReleaseDate(product.releasedAt || product.createdAt))}</dd></div>
                <div><dt>Creator</dt><dd>${escapeHtml(product.artistName)}</dd></div>
                <div><dt>Categories</dt><dd>${escapeHtml((product.categories || []).join(', ') || 'Unspecified')}</dd></div>
                <div><dt>Genres</dt><dd>${escapeHtml((product.genres || []).join(', ') || 'Unspecified')}</dd></div>
                <div><dt>DAW compatibility</dt><dd>${escapeHtml((product.dawCompatibility || []).join(', ') || 'Creator has not listed DAWs')}</dd></div>
                <div><dt>Formats</dt><dd>${escapeHtml((product.formatKeys || []).join(', ') || 'Creator has not listed formats')}</dd></div>
              </dl>
              <div class="dashboard-tag-row">
                ${tags.length ? tags.map((tag) => `<span class="dashboard-pill">${escapeHtml(tag)}</span>`).join('') : '<span class="dashboard-pill">No tags yet</span>'}
              </div>
              <section class="dashboard-ratings-panel">
                <div class="dashboard-ratings-divider"></div>
                <p class="dashboard-ratings-heading">Ratings</p>
                <div class="dashboard-rating-summary">
                  <span class="dashboard-rating-average-stars">${renderRatingStars(averageRating || 0)}</span>
                  <span class="dashboard-rating-average-value">${ratingCount ? `${Number(averageRating).toFixed(averageRating % 1 ? 1 : 0)} / 5` : 'No ratings yet'}</span>
                </div>
                <p class="dashboard-rating-review-label">Purchased User Reviews</p>
                <p class="dashboard-rating-review-count">${ratingCount ? `${ratingCount} reviews` : 'No ratings yet'}</p>
              </section>
              ${(() => { const ratio = getLikeRatio(likeCount, dislikeCount); return `<div class="dashboard-sentiment-meter ${ratio.total ? "" : "is-empty"}" data-product-sentiment-meter aria-label="Like dislike ratio"><div class="dashboard-sentiment-meter-track"><span class="dashboard-sentiment-like" data-product-like-bar style="width:${ratio.likePercent}%"></span><span class="dashboard-sentiment-dislike" data-product-dislike-bar style="width:${ratio.dislikePercent}%"></span></div><div class="dashboard-sentiment-labels"><span><span data-product-like-count>${likeCount}</span> likes</span><span><span data-product-dislike-count>${dislikeCount}</span> dislikes</span></div></div>` })()}

            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Get ${escapeHtml(product.title)}</h3>
              <p class="dashboard-price">${escapeHtml(product.priceLabel || (product.isFree ? 'Free' : '—'))}</p>
              <div class="dashboard-action-stack">
                <button type="button" class="button button-accent ${state.isDraftPreview ? 'preview-mode-disabled' : ''}" data-product-primary-action ${state.isDraftPreview || userHasAccess ? 'disabled' : ''} ${state.isDraftPreview ? 'title="Disabled in marketplace preview."' : ''}>${escapeHtml(primaryActionLabel)}</button>
                <a class="button button-muted" href="${ROUTES.products}">Back to Products</a>
                <button type="button" class="button button-muted" data-report-product ${state.isDraftPreview || isOwner ? 'disabled' : ''} title="${isOwner ? 'You cannot report your own product.' : 'Report this product'}">Report Product</button>
                ${userHasAccess && !state.isDraftPreview ? `
                  <div class="dashboard-download-divider"></div>
                  <button type="button" class="button dashboard-download-button" data-product-download>Download Content</button>
                  ${isOwner ? `<a class="button button-muted" href="${productRoute(product)}?sendgift=1">Send as Gift</a>` : ''}
                ` : ''}
                <div class="dashboard-action-icons-row">
                  <button type="button" class="dashboard-icon-action ${state.productEngagement.reaction === 'like' ? 'is-active' : ''}" data-product-reaction="like" aria-label="Like this product" title="Like" aria-pressed="${state.productEngagement.reaction === 'like'}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}><span class="icon">${iconSvg('thumbsUp')}</span><em data-product-like-count>${Math.max(0, likeCount)}</em></button>
                  <button type="button" class="dashboard-icon-action ${state.productEngagement.reaction === 'dislike' ? 'is-active' : ''}" data-product-reaction="dislike" aria-label="Dislike this product" title="Dislike" aria-pressed="${state.productEngagement.reaction === 'dislike'}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}><span class="icon">${iconSvg('thumbsDown')}</span><em data-product-dislike-count>${Math.max(0, dislikeCount)}</em></button>
                  <button type="button" class="dashboard-icon-action" data-product-share aria-label="Share this product" title="Share"><span class="icon">${iconSvg('share2')}</span></button>
                  <button type="button" class="dashboard-icon-action ${state.productEngagement.saved ? 'is-active' : ''}" data-product-save aria-label="Save this product" title="Save" aria-pressed="${state.productEngagement.saved}" ${state.isDraftPreview ? 'disabled title="Disabled in marketplace preview."' : ''}><span class="icon">${iconSvg('bookmark')}</span><em data-product-save-count>${state.productEngagement.saveCount}</em></button>
                </div>
                
              </div>
              <p class="dashboard-mini-note">Instant digital download</p>
              ${state.productReport.message ? `<p class="dashboard-mini-note">${escapeHtml(state.productReport.message)}</p>` : ''}
              <p class="dashboard-mini-note">${product.licensePath ? 'License included' : 'License details available from creator on request'}</p>
              <p class="dashboard-mini-note">Created by ${escapeHtml(product.artistName)}</p>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Contributors</h3>
              <div class="dashboard-contributor-list">
                ${contributorRows.map((row) => {
                  const name = row.displayName || 'Contributor'
                  const handle = formatUsername(row.username)
                  const route = row.profilePath || (row.uid ? publicProfileRoute({ uid: row.uid }) : '')
                  return `<div class="dashboard-contributor-row"><div class="dashboard-contributor-row-inner">${row.avatarURL ? `<img class="dashboard-contributor-avatar" src="${escapeHtml(row.avatarURL)}" alt="${escapeHtml(name)} avatar" loading="lazy" />` : `<span class="dashboard-creator-avatar-fallback">${escapeHtml(creatorInitials(name))}</span>`}<div class="dashboard-contributor-meta"><p class="dashboard-contributor-name">${escapeHtml(name)}</p><p class="dashboard-contributor-role">${escapeHtml(row.role || 'Contributor')}${handle ? ` · ${escapeHtml(handle)}` : ''}</p></div>${route ? `<a class="button button-muted dashboard-contributor-action" href="/${escapeHtml(String(route).replace(/^\/+/, ''))}">View</a>` : ''}</div></div>`
                }).join('')}
              </div>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Compatibility</h3>
              <p>DAW: ${escapeHtml((product.dawCompatibility || []).join(', ') || 'Not listed')}</p>
              <p>Formats: ${escapeHtml((product.formatKeys || []).join(', ') || 'Not listed')}</p>
              <p class="dashboard-mini-note">Compatibility details are based on creator-provided metadata.</p>
            </article>

            <article class="panel-surface dashboard-side-card">
              <h3>Community activity</h3>
              <p>${Math.max(0, likeCount)} likes · ${Math.max(0, dislikeCount)} dislikes</p>
              <p>Saves: ${state.productEngagement.saveCount}</p>
              <p>Downloads: ${product.downloadCount ?? product.counts?.downloads ?? 0}</p>
              <p>Comments: ${product.commentCount ?? product.counts?.comments ?? 0}</p>
            </article>
          </aside>
        </div>
      </section>
    </main>
    ${productReportDialog(product)}
    ${productDownloadDialogMarkup(state.downloadDialog)}
  `

  document.title = `Melogic | ${product.title}`
  renderMainMedia()
  bindAudioPreviewControls()
  bindProductFileBrowser(product, productFiles, ownsProduct)
  initShellChrome()

  app.querySelector('[data-product-download]')?.addEventListener('click', () => {
    state.downloadDialog = {
      open: true,
      loading: false,
      error: '',
      productId: product.id,
      title: product.title,
      sizeBytes: productDownloadBytes(product, productFiles)
    }
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
  })
  app.querySelectorAll('[data-close-product-download]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target !== element && !element.matches('button')) return
      state.downloadDialog = { ...state.downloadDialog, open: false, loading: false, error: '' }
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    })
  })
  app.querySelector('[data-confirm-product-download]')?.addEventListener('click', async () => {
    if (state.downloadDialog.loading) return
    state.downloadDialog = { ...state.downloadDialog, loading: true, error: '' }
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    const downloadPayload = { productId: product.id, source: 'product-detail' }
    if (PRODUCT_DOWNLOAD_DEBUG) {
      console.info('[product-download] create link requested', {
        action: 'create-download-link',
        productId: product.id,
        productTitle: product.title || '',
        currentUserUid: state.currentUser?.uid || '',
        isOwner,
        isInLibrary: Boolean(ownsProduct && !isOwner),
        payload: downloadPayload
      })
    }
    try {
      const result = await createProductDownloadLink(downloadPayload.productId, { source: downloadPayload.source })
      if (!result?.downloadUrl) throw new Error('No product download is available.')
      beginProductDownloads(result)
      state.downloadDialog = { ...state.downloadDialog, open: false, loading: false, error: '' }
      if (PRODUCT_DOWNLOAD_DEBUG) {
        console.info('[product-download] prepared', {
          action: 'create-download-link',
          productId: product.id,
          fileCount: result.files?.length || 1,
          sizeBytes: Number(result.sizeBytes || 0)
        })
      }
    } catch (error) {
      const errorCode = String(error?.code || '').replace(/^functions\//, '')
      const errorMessage = errorCode === 'permission-denied'
        ? 'You do not have access to download this product.'
        : errorCode === 'failed-precondition'
          ? (String(error?.message || '').includes('signing')
              ? 'Secure downloads are temporarily unavailable. The server signing permission needs configuration.'
              : 'This product does not have downloadable content configured yet.')
          : errorCode === 'not-found'
            ? 'The product download files could not be found.'
            : ['unavailable', 'deadline-exceeded'].includes(errorCode)
              ? 'Could not create a download link. Please try again.'
              : (error?.message || 'Could not prepare this download.')
      state.downloadDialog = {
        ...state.downloadDialog,
        loading: false,
        error: errorMessage
      }
      if (PRODUCT_DOWNLOAD_DEBUG) {
        console.warn('[product-download] failed', {
          action: 'create-download-link',
          productId: product.id,
          productTitle: product.title || '',
          currentUserUid: state.currentUser?.uid || '',
          isOwner,
          isInLibrary: Boolean(ownsProduct && !isOwner),
          payload: downloadPayload,
          errorCode: error?.code || '',
          errorMessage: error?.message || '',
          errorDetails: error?.details || null
        })
      }
    }
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
  })

  app.querySelector('[data-product-primary-action]')?.addEventListener('click', async (event) => {
    if (state.isDraftPreview) return
    event.preventDefault()
    const button = event.currentTarget
    if (!(button instanceof HTMLButtonElement)) return
    if (isFreeProduct) {
      if (!state.currentUser?.uid) {
        window.location.assign(authRoute({ redirect: productRoute(product) }))
        return
      }
      button.disabled = true
      button.textContent = 'Adding...'
      try {
        await claimFreeProduct(state.currentUser.uid, product.id)
        button.textContent = 'Added to Library'
        renderProduct(product, recommendations, ownerPreview, productFiles, true)
      } catch (error) {
        console.warn('[product] free claim failed', { code: error?.code, message: error?.message })
        showActionMessage(error?.code === 'functions/permission-denied' ? 'This product is not available for free claim.' : 'Could not add product to library.')
        button.disabled = false
        button.textContent = primaryActionLabel
      }
      return
    }
    addToCart(product)
    button.textContent = 'Added to cart'
      setTimeout(() => {
        button.textContent = 'Add to Cart'
      }, 1200)
    document.querySelector('[data-cart-trigger]')?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
  })

  const showActionMessage = (message) => {
    const note = app.querySelector('.dashboard-mini-note')
    if (note) note.textContent = message
  }

  const requireAuth = () => {
    if (state.currentUser?.uid) return true
    showActionMessage('Sign in to interact with products.')
    return false
  }

  bindProductEngagementHandlers({ product, requireAuth, showActionMessage })
  syncProductEngagementUi()

  app.querySelector('[data-product-share]')?.addEventListener('click', async () => {
    const shareData = { title: product.title, text: product.shortDescription || 'Check this product', url: window.location.href }
    try {
      if (navigator.share) await navigator.share(shareData)
      else if (navigator.clipboard) await navigator.clipboard.writeText(window.location.href)
      showActionMessage('Copied link')
    } catch {}
  })

  app.querySelector('[data-report-product]')?.addEventListener('click', () => {
    if (state.isDraftPreview) return
    if (!state.currentUser?.uid) {
      window.location.assign(authRoute({ redirect: productRoute(product) }))
      return
    }
    if (isOwner) {
      showActionMessage('You cannot report your own product.')
      return
    }
    state.productReport = { open: true, submitting: false, error: '', message: '' }
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
  })

  app.querySelectorAll('[data-close-product-report]').forEach((button) => {
    button.addEventListener('click', () => {
      state.productReport = { ...state.productReport, open: false, submitting: false, error: '' }
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    })
  })

  app.querySelector('[data-product-report-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const reason = String(formData.get('reason') || '').trim()
    const description = String(formData.get('description') || '').trim()
    if (!reason) {
      state.productReport.error = 'Choose a reason before submitting.'
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
      return
    }
    if (reason === 'Other' && !description) {
      state.productReport.error = 'Description is required when reason is Other.'
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
      return
    }
    state.productReport = { ...state.productReport, submitting: true, error: '' }
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    try {
      await createReport({
        targetType: 'product',
        targetId: product.id,
        targetOwnerUid: product.artistId || '',
        reason,
        description,
        sourcePath: window.location.pathname,
        metadata: {
          title: product.title || '',
          artistId: product.artistId || '',
          status: product.status || '',
          visibility: product.visibility || ''
        }
      })
      state.productReport = { open: true, submitting: false, error: '', message: 'Thank you. Your report has been submitted.' }
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
      window.setTimeout(() => {
        if (state.productReport.message) {
          state.productReport = { ...state.productReport, open: false }
          renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
        }
      }, 1200)
    } catch (error) {
      console.warn('[product] report failed', { code: error?.code, message: error?.message, details: error?.details })
      state.productReport = { ...state.productReport, submitting: false, error: error?.message || 'Could not submit this report.' }
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  })

  app.querySelector('[data-review-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.currentUser?.uid) return showActionMessage('Sign in to review this product.')
    const form = event.currentTarget
    const data = new FormData(form)
    const body = String(data.get('body') || '').trim()
    const rawRating = Number(data.get('rating') || 0)
    const rating = rawRating > 0 ? rawRating : null
    if (!body) return showActionMessage('Write a review before submitting.')
    try {
      await createProductReview(product.id, state.currentUser, {}, { body, rating })
      state.reviews = await listProductReviews(product.id, { limitCount: 20 })
      state.reviewReactions = await getReviewReactionStates(product.id, state.reviews.map((item) => item.id), state.currentUser)
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    } catch (error) {
      console.warn('[product] create review failed', { code: error?.code, message: error?.message })
      showActionMessage(error?.code === 'permission-denied' ? 'You do not have permission to post a review right now.' : 'Could not submit review.')
    }
  })
  app.querySelectorAll('[data-review-react]').forEach((button) => button.addEventListener('click', async () => {
    if (!state.currentUser?.uid) return showActionMessage('Sign in to react to reviews.')
    const [reviewId, reaction] = String(button.getAttribute('data-review-react') || '').split(':')
    const current = state.reviewReactions[reviewId] || null
    const next = current === reaction ? null : reaction
    try {
      await setProductReviewReaction(product.id, reviewId, state.currentUser, next)
      state.reviewActionErrors[reviewId] = ''
      state.reviews = await listProductReviews(product.id, { limitCount: 20 })
      state.reviewReactions = await getReviewReactionStates(product.id, state.reviews.map((item) => item.id), state.currentUser)
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    } catch (error) {
      console.warn('[product] review reaction failed', { code: error?.code, message: error?.message })
      state.reviewActionErrors[reviewId] = 'Could not update reaction.'
      showActionMessage('Could not update review reaction.')
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    }
  }))
  app.querySelectorAll('[data-toggle-replies]').forEach((button) => button.addEventListener('click', async () => {
    const reviewId = String(button.getAttribute('data-toggle-replies') || '')
    state.openReplyComposerFor = state.openReplyComposerFor === reviewId ? '' : reviewId
    if (state.openReplyComposerFor && !state.reviewReplies[reviewId]?.length) {
      try {
        state.reviewReplies[reviewId] = await listProductReviewReplies(product.id, reviewId, { limitCount: 10 })
        state.replyLoadErrors[reviewId] = ''
      } catch (error) {
        console.warn('[product] list replies failed', { code: error?.code, message: error?.message })
        state.replyLoadErrors[reviewId] = 'Could not load replies.'
        showActionMessage('Could not load replies.')
      }
    }
    renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
  }))
  app.querySelectorAll('[data-review-reply-form]').forEach((form) => form.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.currentUser?.uid) return showActionMessage('Sign in to reply.')
    const reviewId = form.getAttribute('data-review-reply-form') || ''
    const body = form.querySelector('textarea')?.value || ''
    try {
      await createProductReviewReply(product.id, reviewId, state.currentUser, {}, { body })
      state.replyDrafts[reviewId] = ''
      try {
        state.reviewReplies[reviewId] = await listProductReviewReplies(product.id, reviewId, { limitCount: 10 })
        state.replyLoadErrors[reviewId] = ''
      } catch (listError) {
        console.warn('[product] list replies failed', { code: listError?.code, message: listError?.message })
        state.replyLoadErrors[reviewId] = 'Could not load replies.'
      }
      state.reviews = await listProductReviews(product.id, { limitCount: 20 })
      renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct)
    } catch (error) {
      console.warn('[product] create reply failed', { code: error?.code, message: error?.message })
      showActionMessage('Could not post reply.')
    }
  }))
  app.querySelectorAll('[data-toggle-review-menu]').forEach((btn) => btn.addEventListener('click', (event) => { event.stopPropagation(); state.openReviewMenuId = state.openReviewMenuId === btn.getAttribute('data-toggle-review-menu') ? '' : (btn.getAttribute('data-toggle-review-menu') || ''); renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct) }))
  app.querySelectorAll('[data-toggle-reply-menu]').forEach((btn) => btn.addEventListener('click', (event) => { event.stopPropagation(); state.openReplyMenuKey = state.openReplyMenuKey === btn.getAttribute('data-toggle-reply-menu') ? '' : (btn.getAttribute('data-toggle-reply-menu') || ''); renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct) }))
  app.querySelectorAll('[data-review-menu-action]').forEach((btn) => btn.addEventListener('click', async () => { const [reviewId, action] = String(btn.getAttribute('data-review-menu-action') || '').split(':'); if (action === 'delete') await deleteProductReview(product.id, reviewId, state.currentUser); if (action === 'report') await createMarketplaceReviewReport({ product, review: state.reviews.find((r) => r.id === reviewId) || {}, reporter: state.currentUser, reason: window.prompt('Report reason') || 'No reason provided', contextType: 'review' }); state.reviews = await listProductReviews(product.id, { limitCount: 20 }); renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct) }))
  app.querySelectorAll('[data-reply-menu-action]').forEach((btn) => btn.addEventListener('click', async () => { const [reviewId, replyId, action] = String(btn.getAttribute('data-reply-menu-action') || '').split(':'); const reply = (state.reviewReplies[reviewId] || []).find((item) => item.id === replyId) || null; if (action === 'delete') await deleteProductReviewReply(product.id, reviewId, replyId, state.currentUser); if (action === 'report') await createMarketplaceReviewReport({ product, review: state.reviews.find((r) => r.id === reviewId) || {}, reply, reporter: state.currentUser, reason: window.prompt('Report reason') || 'No reason provided', contextType: 'reply' }); state.reviewReplies[reviewId] = await listProductReviewReplies(product.id, reviewId, { limitCount: 10 }); state.reviews = await listProductReviews(product.id, { limitCount: 20 }); renderProduct(product, recommendations, ownerPreview, productFiles, ownsProduct) }))



  bindInteractiveRatingControl()
  app.querySelectorAll('[data-media-index]').forEach((button) => {
    button.addEventListener('click', () => {
      state.selectedMediaIndex = Number(button.getAttribute('data-media-index')) || 0
      renderMainMedia()
    })
  })

  app.querySelectorAll('[data-media-prev], [data-media-next]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.mediaItems.length) return
      const delta = button.hasAttribute('data-media-prev') ? -1 : 1
      state.selectedMediaIndex = (state.selectedMediaIndex + delta + state.mediaItems.length) % state.mediaItems.length
      renderMainMedia()
    })
  })
}

async function init() {
  renderSkeleton()
  state.currentUser = await waitForInitialAuthState()
  state.isDraftPreview = new URLSearchParams(window.location.search).get('preview') === 'draft'

  const id = parseProductIdFromLocation()
  if (!id) {
    renderState('Product not found.', 'Please choose a product from the marketplace.')
    return
  }

  try {
    const product = await getProductShellById(id)
    if (!product) {
      renderState('This product could not be found.', 'It may have been removed or is not public yet.')
      return
    }

    const isOwner = Boolean(state.currentUser?.uid && product.artistId === state.currentUser.uid)
    const initialOwnership = isOwner ? true : await userOwnsProduct(state.currentUser?.uid || '', product.id).catch(() => false)
    const isPublic = product.status === 'published' && product.visibility === 'public'
    if (!isPublic && !isOwner && !initialOwnership && !state.isDraftPreview) {
      renderState('Product not available.', 'This product is not currently available to the public.')
      return
    }
    if (state.isDraftPreview && !isOwner) {
      renderState('Preview unavailable.', 'Only the product owner can open draft marketplace preview mode.')
      return
    }

    const giftRequested = ['1', 'true'].includes(String(new URLSearchParams(window.location.search).get('sendgift') || new URLSearchParams(window.location.search).get('sendGift') || '').toLowerCase())
    const initialProduct = giftRequested && isOwner
      ? normalizeProduct(product.id, product, await resolveProductMedia(product).catch(() => ({})))
      : product
    state.pageData = {
      product: initialProduct,
      recommendations: [],
      productFiles: [],
      ownsProduct: Boolean(initialOwnership),
      ownerPreview: !isPublic && isOwner,
      recommendationsLoading: true,
      reviewsLoading: true
    }
    state.productEngagement = {
      productId: product.id,
      reaction: null,
      saved: false,
      likeCount: getProductLikeCount(product),
      dislikeCount: getProductDislikeCount(product),
      saveCount: Number(product.saveCount ?? product.counts?.saves ?? 0),
      loading: true,
      error: ''
    }
    renderProduct(initialProduct, [], !isPublic && isOwner, [], Boolean(initialOwnership))
    if (giftRequested) return

    const safe = async (label, fallback, task) => {
      try {
        return await task()
      } catch (error) {
        console.warn(`[product] optional ${label} load failed`, error?.message || error)
        return fallback
      }
    }

    const renderCurrent = () => {
      if (!state.pageData.product) return
      renderProduct(
        state.pageData.product,
        state.pageData.recommendations.filter((item) => normalizeKey(item.id) !== normalizeKey(state.pageData.product.id)),
        state.pageData.ownerPreview,
        state.pageData.productFiles,
        state.pageData.ownsProduct
      )
      syncProductEngagementUi()
    }

    resolveProductMedia(product).then((media) => {
      if (state.pageData.product?.id !== product.id) return
      state.pageData.product = normalizeProduct(product.id, product, media)
      renderCurrent()
    }).catch((error) => console.warn('[product] optional media load failed', error?.message || error))

    listProductFiles(product.id).then((productFiles) => {
      if (state.pageData.product?.id !== product.id) return
      state.pageData.productFiles = productFiles || []
      renderCurrent()
    }).catch((error) => console.warn('[product] optional files load failed', error?.message || error))

    userOwnsProduct(state.currentUser?.uid || '', product.id).then((ownsProduct) => {
      if (state.pageData.product?.id !== product.id) return
      state.pageData.ownsProduct = Boolean(ownsProduct || isOwner)
      renderCurrent()
    }).catch((error) => console.warn('[product] optional ownership load failed', error?.message || error))

    listRecommendedProducts({ product, pageSize: 8 }).then((recommendations) => {
      if (state.pageData.product?.id !== product.id) return
      state.pageData.recommendations = recommendations || []
      state.pageData.recommendationsLoading = false
      renderCurrent()
    }).catch((error) => {
      console.warn('[product] optional recommendations load failed', error?.message || error)
      state.pageData.recommendationsLoading = false
      renderCurrent()
    })

    safe('engagement-state', { reaction: null, saved: false, likeCount: getProductLikeCount(product), dislikeCount: getProductDislikeCount(product), saveCount: Number(product.saveCount ?? product.counts?.saves ?? 0) }, () => getProductEngagementState(product.id, state.currentUser?.uid)).then((engagementState) => {
      if (state.pageData.product?.id !== product.id) return
      state.productEngagement = {
        ...state.productEngagement,
        ...engagementState,
        productId: product.id,
        reaction: engagementState.reaction,
        saved: engagementState.saved,
        likeCount: Math.max(0, Number(engagementState.likeCount || 0)),
        dislikeCount: Math.max(0, Number(engagementState.dislikeCount || 0)),
        saveCount: Math.max(0, Number(engagementState.saveCount || 0)),
        loading: false,
        error: ''
      }
      renderCurrent()
    })

    safe('reviews', [], () => listProductReviews(product.id, { limitCount: 20 })).then(async (reviews) => {
      if (state.pageData.product?.id !== product.id) return
      state.reviews = reviews
      state.reviewReactions = await safe('review-reactions', {}, () => getReviewReactionStates(product.id, (reviews || []).map((item) => item.id), state.currentUser))
      state.pageData.reviewsLoading = false
      renderCurrent()
    })
  } catch (error) {
    console.error('[product] failed to load product page', {
      message: error?.message,
      code: error?.code,
      stack: error?.stack
    })
    renderState('Product could not be loaded right now.', 'Please try again in a moment.')
  }
}

init()
