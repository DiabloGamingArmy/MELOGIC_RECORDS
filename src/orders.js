import './styles/base.css'
import './styles/account.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { authRoute, ROUTES } from './utils/routes'
import { accountDateIso, listUserOrders } from './data/accountCommerceService'

const app = document.querySelector('#app')
const state = { user: null, loading: true, error: '', orders: [], filter: 'lifetime' }

const filters = [
  { key: '7', label: '7 days', days: 7 },
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '12 months', days: 365 },
  { key: 'lifetime', label: 'Lifetime', days: 0 }
]

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function orderStamp(order) {
  const iso = accountDateIso(order.paidAt || order.updatedAt || order.createdAt)
  return iso ? new Date(iso).getTime() : 0
}

function formatDate(value) {
  const iso = accountDateIso(value)
  if (!iso) return 'Not recorded'
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso))
}

function money(cents = 0, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100)
  } catch {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`
  }
}

function withinDays(order, days) {
  if (!days) return true
  const stamp = orderStamp(order)
  if (!stamp) return false
  return Date.now() - stamp <= days * 24 * 60 * 60 * 1000
}

function visibleOrders() {
  const filter = filters.find((item) => item.key === state.filter) || filters[4]
  return state.orders.filter((order) => withinDays(order, filter.days))
}

function spentInDays(days) {
  return state.orders
    .filter((order) => order.status === 'paid' && withinDays(order, days))
    .reduce((sum, order) => sum + Number(order.amountTotalCents || 0), 0)
}

function renderSignedOut() {
  return `
    <section class="account-panel account-empty">
      <p class="eyebrow">Account Orders</p>
      <h1>Sign in to view orders.</h1>
      <p>Your purchase receipts, spending history, and support actions are private to your account.</p>
      <a class="button button-accent" href="${authRoute({ redirect: ROUTES.orders })}">Sign In / Sign Up</a>
    </section>
  `
}

function renderSummary() {
  const lifetime = spentInDays(0)
  const last30 = spentInDays(30)
  const last365 = spentInDays(365)
  const currency = state.orders.find((order) => order.currency)?.currency || 'USD'
  return `
    <div class="account-summary-grid">
      <article><span>Total spent</span><strong>${money(lifetime, currency)}</strong></article>
      <article><span>Last 30 days</span><strong>${money(last30, currency)}</strong></article>
      <article><span>Last 12 months</span><strong>${money(last365, currency)}</strong></article>
      <article><span>Lifetime orders</span><strong>${state.orders.length}</strong></article>
    </div>
  `
}

function renderOrdersTable() {
  const orders = visibleOrders()
  if (state.loading) return '<div class="account-empty-inline">Loading orders...</div>'
  if (state.error) return `<div class="account-empty-inline">${escapeHtml(state.error)}</div>`
  if (!orders.length) return '<div class="account-empty-inline">Order history will appear here after checkout.</div>'

  return `
    <div class="account-table" role="table" aria-label="Order history">
      <div class="account-table-head" role="row">
        <span>Order</span><span>Date</span><span>Products</span><span>Amount</span><span>Status</span><span>Actions</span>
      </div>
      ${orders.map((order) => {
        const productNames = order.products.length
          ? order.products.map((product) => product.title).join(', ')
          : order.productIds.join(', ') || 'Products unavailable'
        const creatorNames = order.products.map((product) => product.artistName).filter(Boolean).join(', ')
        return `
          <div class="account-table-row" role="row">
            <span title="${escapeHtml(order.id)}">${escapeHtml(order.id.slice(0, 10) || 'Order')}</span>
            <span>${escapeHtml(formatDate(order.paidAt || order.createdAt))}</span>
            <span><strong>${escapeHtml(productNames)}</strong><small>${escapeHtml(creatorNames || 'Seller details on product pages')}</small></span>
            <span>${money(order.amountTotalCents, order.currency)}</span>
            <span>${escapeHtml(order.paymentStatus || order.status)}</span>
            <span class="account-action-links">
              <a href="${ROUTES.support}?topic=download-problem&order=${encodeURIComponent(order.id)}">Download problem</a>
              <a href="${ROUTES.support}?topic=refund&order=${encodeURIComponent(order.id)}">Refund</a>
            </span>
          </div>
        `
      }).join('')}
    </div>
  `
}

function renderOrders() {
  return `
    <section class="account-panel">
      <div class="account-heading">
        <div>
          <p class="eyebrow">Melogic Account</p>
          <h1>Orders</h1>
          <p>Review spending, receipts, payment status, and purchase support options.</p>
        </div>
        <a class="button button-muted" href="${ROUTES.library}">Open Library</a>
      </div>
      ${renderSummary()}
      <div class="account-filter-row" role="tablist" aria-label="Order date filters">
        ${filters.map((filter) => `<button type="button" class="${state.filter === filter.key ? 'is-active' : ''}" data-order-filter="${filter.key}" aria-selected="${state.filter === filter.key}">${filter.label}</button>`).join('')}
      </div>
      ${renderOrdersTable()}
      <section class="account-support-panel">
        <h2>Need help with a purchase?</h2>
        <div>
          <a href="${ROUTES.support}?topic=refund">Request refund</a>
          <a href="${ROUTES.forms}?type=fraudulent-product">Report fraudulent product</a>
          <a href="${ROUTES.support}?topic=download-problem">Did not receive item / download problem</a>
          <a href="${ROUTES.forms}?type=not-as-described">Product not as described</a>
          <a href="${ROUTES.support}?topic=orders">Contact support</a>
        </div>
      </section>
    </section>
  `
}

function render() {
  document.title = 'Melogic | Orders'
  app.innerHTML = `${navShell({ currentPage: 'profile' })}<main class="account-page"><div class="account-shell">${state.user ? renderOrders() : renderSignedOut()}</div></main>`
  initShellChrome()
  app.querySelectorAll('[data-order-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.filter = button.getAttribute('data-order-filter') || 'lifetime'
      render()
    })
  })
}

async function loadOrders(user) {
  state.user = user
  state.error = ''
  if (!user?.uid) {
    state.loading = false
    state.orders = []
    render()
    return
  }
  state.loading = true
  render()
  try {
    state.orders = await listUserOrders(user.uid)
  } catch (error) {
    console.error('[orders] load failed', error)
    state.error = 'Orders could not be loaded right now.'
    state.orders = []
  }
  state.loading = false
  render()
}

waitForInitialAuthState().then(loadOrders)
subscribeToAuthState((user) => { loadOrders(user).catch(() => {}) })
