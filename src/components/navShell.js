export function navShell(options = {}) {
  const currentPage = options.currentPage || ''
  const isHome = currentPage === 'home'
  const isProducts = currentPage === 'products'

  return `
    <header class="nav-shell">
      <div class="nav-inner">
        <a class="brand" href="/index.html" aria-label="Melogic Records home">
          <span class="brand-logo-shell" aria-hidden="true">
            <img alt="Melogic logo mark" class="brand-logo" data-brand-logo loading="eager" decoding="async" width="38" height="38" />
          </span>
          <span class="brand-text">MELOGIC RECORDS</span>
        </a>

        <nav class="main-nav" aria-label="Primary">
          <a href="/index.html" ${isHome ? 'aria-current="page"' : ''}>Home</a>
          <a href="/products.html" ${isProducts ? 'aria-current="page"' : ''}>Products</a>
          <a href="/index.html#community">Community</a>
          <a href="/index.html#live">Live</a>
          <a href="/index.html#forms">Forms</a>
          <a href="/index.html#faq">FAQ</a>
          <a href="/index.html#support">Support</a>
        </nav>

        <div class="nav-actions" aria-label="Account and cart actions">
          <a class="button button-muted nav-auth" href="#forms">Sign In / Sign Up</a>
          <button class="button button-cart" type="button" aria-label="Open cart">
            <span class="cart-icon" aria-hidden="true">🛒</span>
            <span>Cart</span>
            <span class="cart-badge" aria-label="0 items in cart">0</span>
          </button>
        </div>
      </div>
    </header>
  `
}
