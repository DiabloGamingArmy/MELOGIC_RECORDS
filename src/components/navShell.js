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
          <a href="/community.html">Community</a>
          <a href="/live.html">Live</a>
          <a href="/forms.html">Forms</a>
          <a href="/faq.html">FAQ</a>
          <a href="/support.html">Support</a>
        </nav>

        <div class="nav-actions" aria-label="Account and cart actions">
          <a class="button button-muted nav-auth" data-nav-auth href="/auth.html">Sign In / Sign Up</a>
          <a class="profile-button" data-nav-profile href="/auth.html" aria-label="Account" title="Account">
            <span class="profile-avatar" data-profile-avatar aria-hidden="true"></span>
          </a>
          <a class="button button-cart" href="/cart.html" aria-label="Open cart">
            <span class="cart-icon" aria-hidden="true">🛒</span>
            <span>Cart</span>
            <span class="cart-badge" aria-label="0 items in cart">0</span>
          </a>
        </div>
      </div>
    </header>
  `
}
