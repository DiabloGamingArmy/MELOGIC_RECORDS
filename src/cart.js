import './styles/base.css'
import './styles/cart.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { clearCart, getCartItems, removeFromCart, subscribeToCart } from './data/cartService'
import { createCheckoutSession } from './data/checkoutService'
import { claimFreeProduct } from './data/entitlementService'
import { ROUTES, authRoute } from './utils/routes'

const app = document.querySelector('#app')
let activeUser = null

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function formatCurrencyFromCents(cents = 0) {
  const value = Number(cents || 0) / 100
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value)
}

function getSubtotal(items) {
  return items.reduce((sum, item) => sum + Number(item.priceCents || 0), 0)
}

function isFreeCartItem(item = {}) {
  return Boolean(item.isFree) || Number(item.priceCents || 0) <= 0
}

function getCheckoutStatus() {
  const params = new URLSearchParams(window.location.search)
  return params.get('checkout')
}

function checkoutMessageHtml() {
  const status = getCheckoutStatus()
  if (status === 'success') {
    return '<p class="cart-checkout-message cart-checkout-success">Payment complete. Your products are being added to your library.</p>'
  }
  if (status === 'cancelled') {
    return '<p class="cart-checkout-message cart-checkout-cancelled">Checkout was cancelled. Your cart is still here.</p>'
  }
  return ''
}

function setSummaryError(message) {
  const node = app.querySelector('[data-cart-checkout-message]')
  if (!node) return
  node.textContent = message || ''
}

async function handleCheckoutClick(checkoutButton) {
  if (!activeUser) {
    window.location.assign(authRoute({ redirect: ROUTES.cart }))
    return
  }

  const cartItems = getCartItems()
  if (!cartItems.map((item) => String(item.id || '')).filter(Boolean).length) {
    setSummaryError('Your cart is empty.')
    return
  }

  const defaultLabel = activeUser ? 'Checkout' : 'Sign in to Checkout'
  checkoutButton.disabled = true
  checkoutButton.textContent = 'Preparing...'
  setSummaryError('')

  try {
    const freeItems = cartItems.filter(isFreeCartItem)
    const paidItems = cartItems.filter((item) => !isFreeCartItem(item))

    if (freeItems.length) {
      checkoutButton.textContent = 'Adding free items...'
      for (const item of freeItems) {
        await claimFreeProduct(activeUser.uid, item.id)
        removeFromCart(item.id)
      }
    }

    if (!paidItems.length) {
      setSummaryError('Free products were added to your Library.')
      checkoutButton.textContent = 'Opening Library...'
      window.setTimeout(() => window.location.assign(ROUTES.library), 700)
      return
    }

    checkoutButton.textContent = 'Redirecting...'
    const result = await createCheckoutSession(paidItems.map((item) => item.id))
    if (!result?.url) {
      throw new Error('Missing checkout URL from server response.')
    }
    window.location.assign(result.url)
  } catch (error) {
    const fallback = 'Could not complete cart action. Please try again.'
    const message = error?.message || fallback
    setSummaryError(message)
    checkoutButton.disabled = false
    checkoutButton.textContent = defaultLabel
  }
}

function renderCart(items = []) {
  const list = app.querySelector('[data-cart-items]')
  const summary = app.querySelector('[data-cart-summary]')
  if (!list || !summary) return

  if (!items.length) {
    list.innerHTML = `
      <article class="cart-empty-state">
        <h2>Your cart is empty.</h2>
        <p>Find sample packs, presets, and tools in Products.</p>
        <a class="button button-accent" href="${ROUTES.products}">Browse Products</a>
      </article>
    `
    summary.innerHTML = `
      <h3>Order summary</h3>
      ${checkoutMessageHtml()}
      <p data-cart-checkout-message></p>
      <p>No items yet.</p>
      <a class="button button-muted" href="${ROUTES.products}">Continue Shopping</a>
    `
    return
  }

  list.innerHTML = items.map((item) => `
    <article class="cart-page-item">
      <div class="cart-page-thumb ${item.thumbnailURL ? 'has-image' : ''}">
        ${item.thumbnailURL ? `<img src="${escapeHtml(item.thumbnailURL)}" alt="" loading="lazy" />` : '<span>♪</span>'}
      </div>
      <div class="cart-page-meta">
        <h3>${escapeHtml(item.title)}</h3>
        <p>by ${escapeHtml(item.artistName || 'Unknown artist')}</p>
      </div>
      <div class="cart-page-actions">
        <strong>${escapeHtml(item.priceLabel || (item.isFree ? 'Free' : formatCurrencyFromCents(item.priceCents)))}</strong>
        <button type="button" data-remove-cart-item="${escapeHtml(item.id)}">Remove</button>
      </div>
    </article>
  `).join('')

  const subtotal = getSubtotal(items)
  summary.innerHTML = `
    <h3>Order summary</h3>
    ${checkoutMessageHtml()}
    <p data-cart-checkout-message></p>
    <div class="cart-summary-line">
      <span>Items</span>
      <span>${items.length}</span>
    </div>
    <div class="cart-summary-line">
      <span>Subtotal</span>
      <strong>${formatCurrencyFromCents(subtotal)}</strong>
    </div>
    <button class="button button-accent" type="button" data-checkout-trigger>${activeUser ? (items.every(isFreeCartItem) ? 'Add Free Items to Library' : 'Checkout') : 'Sign in to Checkout'}</button>
    <a class="button button-muted" href="${ROUTES.products}">Continue Shopping</a>
  `

  list.querySelectorAll('[data-remove-cart-item]').forEach((button) => {
    button.addEventListener('click', () => {
      removeFromCart(button.getAttribute('data-remove-cart-item'))
    })
  })

  const checkoutButton = summary.querySelector('[data-checkout-trigger]')
  checkoutButton?.addEventListener('click', () => handleCheckoutClick(checkoutButton))
}

app.innerHTML = `
  ${navShell({ currentPage: 'cart' })}
  <main>
    <section class="section cart-page-shell">
      <div class="section-inner cart-page-inner">
        <header class="cart-page-header">
          <p class="eyebrow">Marketplace</p>
          <h1>Cart</h1>
          <p>Review your selected releases, sample packs, presets, and tools before checkout.</p>
        </header>

        <section class="cart-page-layout">
          <div class="cart-page-items" data-cart-items></div>
          <aside class="cart-page-summary" data-cart-summary></aside>
        </section>
      </div>
    </section>
  </main>
`

initShellChrome()
if (getCheckoutStatus() === 'success') {
  clearCart()
}

waitForInitialAuthState().then((user) => {
  activeUser = user || null
  renderCart(getCartItems())
})

subscribeToAuthState((user) => {
  activeUser = user || null
  renderCart(getCartItems())
})

subscribeToCart((items) => {
  renderCart(items)
})
