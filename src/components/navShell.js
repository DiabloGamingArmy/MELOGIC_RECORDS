export function navShell() {
  return `
    <header class="nav-shell">
      <div class="nav-inner">
        <a class="brand" href="/index.html" aria-label="Melogic Records home">
          <span class="brand-logo-shell" aria-hidden="true">
            <img alt="Melogic logo mark" class="brand-logo" data-brand-logo loading="eager" decoding="async" />
          </span>
          <span class="brand-text">MELOGIC RECORDS</span>
        </a>

        <nav class="main-nav" aria-label="Primary">
          <a href="#explore">Home</a>
          <a href="#products">Products</a>
          <a href="#community">Community</a>
          <a href="#live">Live</a>
          <a href="#forms">Forms</a>
          <a href="#faq">FAQ</a>
          <a href="#support">Support</a>
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
