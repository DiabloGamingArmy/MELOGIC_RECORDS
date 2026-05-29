import './styles/base.css'
import './styles/account.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { authRoute, ROUTES } from './utils/routes'
import { accountDateIso, listUserLibraryItems } from './data/accountCommerceService'

const app = document.querySelector('#app')
const state = { user: null, loading: true, error: '', items: [], filter: 'all' }

const filters = [
  { key: 'all', label: 'All' },
  { key: 'purchased', label: 'Purchased' },
  { key: 'free', label: 'Free Adds' },
  { key: 'downloads', label: 'Downloads' },
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
  if (item.source === 'free-claim' || item.product?.isFree) return 'free'
  return 'purchased'
}

function visibleItems() {
  if (state.filter === 'all') return state.items
  if (state.filter === 'downloads') return state.items.filter((item) => item.source !== 'saved')
  return state.items.filter((item) => itemKind(item) === state.filter)
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
    return '<div class="account-empty-inline">Products you purchase or add for free will appear here.</div>'
  }

  return `
    <div class="account-list">
      ${rows.map((item) => {
        const product = item.product || {}
        const title = product.title || item.productId || 'Untitled product'
        const creator = product.artistName || product.artistDisplayName || 'Creator'
        const kind = itemKind(item)
        return `
          <article class="account-row">
            <div>
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(creator)} - ${escapeHtml(kind === 'free' ? 'Free add' : kind === 'saved' ? 'Saved' : 'Purchased')}</span>
            </div>
            <div><span class="account-label">License</span><span>${escapeHtml(item.license || product.usageLicense || 'Available after purchase')}</span></div>
            <div><span class="account-label">Added</span><span>${escapeHtml(formatDate(item.createdAt || item.updatedAt))}</span></div>
            <div><span class="account-label">Version</span><span>${escapeHtml(product.version || 'Current')}</span></div>
            <button type="button" class="account-row-action" ${item.source === 'saved' ? 'disabled' : ''}>${item.source === 'saved' ? 'Saved' : 'Download'}</button>
          </article>
        `
      }).join('')}
    </div>
  `
}

function renderLibrary() {
  return `
    <section class="account-panel">
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
      ${renderRows()}
    </section>
  `
}

function render() {
  document.title = 'Melogic | Library'
  app.innerHTML = `${navShell({ currentPage: 'profile' })}<main class="account-page"><div class="account-shell">${state.user ? renderLibrary() : renderSignedOut()}</div></main>`
  initShellChrome()
  app.querySelectorAll('[data-library-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.getAttribute('data-library-filter') || 'all'
      render()
    })
  })
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
