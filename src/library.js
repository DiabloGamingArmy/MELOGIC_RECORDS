import './styles/base.css'
import './styles/account.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { authRoute, ROUTES } from './utils/routes'
import { accountDateIso, listUserLibraryItems } from './data/accountCommerceService'
import { clearCart } from './data/cartService'
import { createProductDownloadLink } from './data/entitlementService'
import { reconcileCheckoutSession } from './data/checkoutService'
import { beginProductDownloads, productDownloadDialogMarkup } from './components/productDownloadDialog'

const app = document.querySelector('#app')
const params = new URLSearchParams(window.location.search)
const initialPurchaseSuccess = params.get('purchase') === 'success' || params.get('checkout') === 'success'
const initialCheckoutSessionId = params.get('session_id') || ''
const state = {
  user: null,
  loading: true,
  error: '',
  items: [],
  filter: 'all',
  search: '',
  purchaseSuccess: initialPurchaseSuccess,
  showPurchaseBanner: initialPurchaseSuccess,
  reconciliationAttempted: false,
  downloadDialog: { open: false, loading: false, ready: false, error: '', productId: '', title: '', sizeBytes: 0, fileCount: 0 }
}

if (initialPurchaseSuccess) clearCart()

const filters = [
  { key: 'all', label: 'All' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'free', label: 'Free Adds' },
  { key: 'gift', label: 'Gifts' },
  { key: 'active', label: 'Active' },
  { key: 'inactive', label: 'Refunded/Revoked' },
  { key: 'saved', label: 'Saved' }
]

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatDate(value) {
  const iso = accountDateIso(value)
  if (!iso) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

function itemKind(item) {
  if (item.source === 'saved') return 'saved'
  if (item.source === 'gift' || item.acquisitionType === 'gift') return 'gift'
  if (['free-claim', 'free_claim'].includes(item.source) || item.product?.isFree) return 'free'
  return 'purchased'
}

function visibleItems() {
  const search = String(state.search || '').trim().toLowerCase()
  return state.items.filter((item) => {
    if (state.filter === 'active' && (item.status || 'active') !== 'active') return false
    if (state.filter === 'inactive' && !['revoked', 'refunded', 'pending'].includes(item.status || 'active')) return false
    if (!['all', 'active', 'inactive'].includes(state.filter) && itemKind(item) !== state.filter) return false
    if (!search) return true
    const product = item.product || {}
    const snapshot = item.productSnapshot || {}
    return [
      product.title,
      snapshot.title,
      product.artistName,
      snapshot.creatorName,
      item.productId,
      item.orderId
    ].join(' ').toLowerCase().includes(search)
  })
}

function renderSignedOut() {
  return `
    <section class="account-panel account-empty">
      <p class="eyebrow">Account Library</p>
      <h1>Sign in to view your library.</h1>
      <p>Products you purchase or add for free will appear here once you are signed in.</p>
      <a class="button button-accent" href="${authRoute({ redirect: ROUTES.library })}">Sign In / Sign Up</a>
    </section>
  `
}

function renderRows() {
  const rows = visibleItems()
  if (state.loading) return '<div class="account-empty-inline">Loading library...</div>'
  if (state.error) return `<div class="account-empty-inline">${escapeHtml(state.error)}</div>`
  if (!rows.length) {
    if (state.purchaseSuccess) {
      return '<div class="account-empty-inline">Your purchase is processing. Your item should appear shortly.</div>'
    }
    return '<div class="account-empty-inline">Products you purchase or add for free will appear here.</div>'
  }

  return `
    <div class="account-list">
      ${rows.map((item) => {
        const product = item.product || {}
        const snapshot = item.productSnapshot || {}
        const title = product.title || snapshot.title || item.productId || 'Untitled product'
        const creator = product.artistName || product.artistDisplayName || snapshot.creatorName || 'Creator'
        const kind = itemKind(item)
        const cover = product.coverURL || product.thumbnailURL || snapshot.coverURL || ''
        return `
          <article class="account-row">
            <span class="account-cover">${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy" decoding="async" />` : ''}</span>
            <div>
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(creator)} - ${escapeHtml(kind === 'free' ? 'Free add' : kind === 'gift' ? 'Gift' : kind === 'saved' ? 'Saved' : 'Purchased')} - ${escapeHtml(item.status || 'active')}</span>
            </div>
            <div><span class="account-label">License</span><span>${escapeHtml(item.license || product.usageLicense || 'Available after purchase')}</span></div>
            <div><span class="account-label">Acquired</span><span>${escapeHtml(formatDate(item.acquiredAt || item.createdAt || item.updatedAt))}</span></div>
            <div><span class="account-label">Order / Source</span><span>${escapeHtml(item.orderId || item.source || 'Library')}</span></div>
            <button
              type="button"
              class="account-row-action account-download-action"
              data-library-download="${escapeHtml(item.productId)}"
              data-library-download-title="${escapeHtml(title)}"
              data-library-download-size="${Number(product.primaryDownloadBytes || product.assetSummary?.totalBytes || snapshot.sizeBytes || 0)}"
              data-library-download-file-count="${Number(product.assetSummary?.downloadableCount || product.assetSummary?.fileCount || snapshot.fileCount || 0)}"
              ${item.source === 'saved' || (item.status || 'active') !== 'active' ? 'disabled' : ''}
            >${item.source === 'saved' ? 'Saved' : 'Download Content'}</button>
          </article>
        `
      }).join('')}
    </div>
  `
}

function renderLibrary() {
  return `
    <section class="account-panel">
      ${state.showPurchaseBanner ? '<div class="account-success-banner" data-purchase-banner>Thank you for your purchase!</div>' : ''}
      <div class="account-heading">
        <div>
          <p class="eyebrow">Melogic Account</p>
          <h1>Library</h1>
          <p>Products you purchase, claim for free, save, or download are organized here.</p>
        </div>
        <a class="button button-muted" href="${ROUTES.products}">Browse Products</a>
      </div>
      <div class="account-filter-row" role="tablist" aria-label="Library filters">
        ${filters.map((filter) => `<button type="button" class="${state.filter === filter.key ? 'is-active' : ''}" data-library-filter="${filter.key}" aria-selected="${state.filter === filter.key}">${filter.label}</button>`).join('')}
      </div>
      <label class="account-search"><span>Search library</span><input data-library-search value="${escapeHtml(state.search || '')}" placeholder="Search title or creator" /></label>
      ${renderRows()}
    </section>
  `
}

function render() {
  document.title = 'Melogic | Library'
  app.innerHTML = `${navShell({ currentPage: 'profile' })}<main class="account-page"><div class="account-shell">${state.user ? renderLibrary() : renderSignedOut()}</div></main>${productDownloadDialogMarkup(state.downloadDialog)}`
  initShellChrome()
  app.querySelectorAll('[data-library-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.getAttribute('data-library-filter') || 'all'
      render()
    })
  })
  app.querySelector('[data-library-search]')?.addEventListener('input', (event) => {
    state.search = event.target.value || ''
    render()
    app.querySelector('[data-library-search]')?.focus()
  })
  app.querySelectorAll('[data-library-download]').forEach((button) => {
    button.addEventListener('click', () => {
      state.downloadDialog = {
        open: true,
        loading: false,
        ready: false,
        error: '',
        productId: button.getAttribute('data-library-download') || '',
        title: button.getAttribute('data-library-download-title') || 'this product',
        sizeBytes: Number(button.getAttribute('data-library-download-size') || 0),
        fileCount: Number(button.getAttribute('data-library-download-file-count') || 0)
      }
      render()
    })
  })
  app.querySelectorAll('[data-close-product-download]').forEach((element) => {
    element.addEventListener('click', (event) => {
      if (event.target !== element && !element.matches('button')) return
      state.downloadDialog = { ...state.downloadDialog, open: false, loading: false, ready: false, error: '' }
      render()
    })
  })
  app.querySelector('[data-confirm-product-download]')?.addEventListener('click', async () => {
    if (state.downloadDialog.loading) return
    state.downloadDialog = { ...state.downloadDialog, loading: true, ready: false, error: '' }
    render()
    try {
      const result = await createProductDownloadLink(state.downloadDialog.productId, { source: 'library' })
      if (!result?.downloadUrl) throw new Error('No product download is available.')
      beginProductDownloads(result)
      state.downloadDialog = {
        ...state.downloadDialog,
        loading: false,
        ready: true,
        error: '',
        fileCount: Number(result.fileCount || state.downloadDialog.fileCount || 0),
        sizeBytes: Number(result.sizeBytes || state.downloadDialog.sizeBytes || 0)
      }
      window.setTimeout(() => {
        if (!state.downloadDialog.ready) return
        state.downloadDialog = { ...state.downloadDialog, open: false, ready: false }
        render()
      }, 1400)
    } catch (error) {
      const errorCode = String(error?.code || '').replace(/^functions\//, '')
      const errorMessage = errorCode === 'permission-denied'
        ? 'You do not have access to download this product.'
        : errorCode === 'failed-precondition'
          ? (String(error?.message || '').includes('signing')
              ? 'Secure downloads are temporarily unavailable. Server signing permission needs configuration.'
              : 'This product does not have downloadable content configured yet.')
          : errorCode === 'resource-exhausted'
            ? 'This product is too large to package automatically. Please contact support.'
            : errorCode === 'not-found'
              ? 'The product download files could not be found.'
              : ['unavailable', 'deadline-exceeded'].includes(errorCode)
                ? 'Could not prepare the download package. Please try again.'
                : (error?.message || 'Could not prepare this download.')
      state.downloadDialog = {
        ...state.downloadDialog,
        loading: false,
        ready: false,
        error: errorMessage
      }
    }
    render()
  })
}

function schedulePurchaseBannerCleanup() {
  if (!state.purchaseSuccess) return
  if (window.location.search.includes('purchase=success') || window.location.search.includes('checkout=success')) {
    window.history.replaceState({}, '', ROUTES.library)
  }
  window.setTimeout(() => {
    state.showPurchaseBanner = false
    render()
  }, 4500)
}

async function loadLibrary(user) {
  state.user = user
  state.error = ''
  if (!user?.uid) {
    state.loading = false
    state.items = []
    render()
    return
  }
  state.loading = true
  render()
  try {
    if (initialPurchaseSuccess && initialCheckoutSessionId && !state.reconciliationAttempted) {
      state.reconciliationAttempted = true
      try {
        await reconcileCheckoutSession(initialCheckoutSessionId)
        clearCart()
      } catch (error) {
        console.error('[library] checkout reconciliation failed', {
          code: error?.code,
          message: error?.message
        })
      }
    }
    state.items = await listUserLibraryItems(user.uid)
  } catch (error) {
    console.error('[library] load failed', error)
    state.error = 'Library could not be loaded right now.'
    state.items = []
  }
  state.loading = false
  render()
}

waitForInitialAuthState().then(loadLibrary)
subscribeToAuthState((user) => { loadLibrary(user).catch(() => {}) })
schedulePurchaseBannerCleanup()
