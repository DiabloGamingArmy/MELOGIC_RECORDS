export function navShell(logoSrc) {
  return `
    <header class="nav-shell">
      <div class="nav-inner">
        <a class="brand" href="/index.html" aria-label="Melogic Records home">
          <img src="${logoSrc}" alt="Melogic logo mark" class="brand-logo" />
          <span class="brand-text">MELOGIC RECORDS</span>
        </a>

        <nav class="main-nav" aria-label="Primary">
          <a href="#app">Home</a>
          <a href="#products">Products</a>
          <a href="#community">Community</a>
          <a href="#live">Live</a>
          <a href="#forms">Forms</a>
          <a href="#faq">FAQ</a>
          <a href="#support">Support</a>
        </nav>

        <div class="nav-actions">
          <button type="button" class="button button-muted nav-auth">Sign In / Sign Up</button>
          <button type="button" class="button nav-cart" aria-label="Open cart">
            <span class="cart-icon" aria-hidden="true">🛒</span>
            <span>Cart</span>
            <span class="cart-badge" aria-label="0 items in cart">0</span>
          </button>
        </div>
      </div>
    </header>
  `
}
