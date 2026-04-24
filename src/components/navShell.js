export function navShell(options = {}) {
  const currentPage = options.currentPage || ''
  const isHome = currentPage === 'home'
  const isProducts = currentPage === 'products'
  const isProfile = currentPage === 'profile'
  const isInbox = currentPage === 'inbox'

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
          <a class="button button-muted nav-inbox ${isInbox ? 'is-active' : ''}" data-nav-inbox href="/inbox.html" aria-label="Open inbox" ${isInbox ? 'aria-current="page"' : ''}>
            <span class="inbox-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M4 5.5h16A1.5 1.5 0 0 1 21.5 7v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5Zm0 1a.5.5 0 0 0-.5.5v.42l8.5 5.1 8.5-5.1V7a.5.5 0 0 0-.5-.5H4Zm16.5 2.08-6.94 4.16a2.98 2.98 0 0 1-3.12 0L3.5 8.58V17c0 .28.22.5.5.5h16a.5.5 0 0 0 .5-.5V8.58Z" />
              </svg>
            </span>
            <span class="inbox-label">Inbox</span>
            <span class="inbox-badge" data-nav-inbox-badge aria-label="No unread inbox items"></span>
          </a>
          <div class="profile-menu" data-profile-menu>
            <button
              type="button"
              class="profile-button ${isProfile ? 'is-active' : ''}"
              data-nav-profile-trigger
              aria-label="Account menu"
              aria-haspopup="menu"
              aria-expanded="false"
              aria-controls="nav-profile-dropdown"
              ${isProfile ? 'aria-current="page"' : ''}
            >
              <span class="profile-avatar" data-profile-avatar aria-hidden="true"></span>
            </button>
            <div class="profile-dropdown" id="nav-profile-dropdown" data-nav-profile-dropdown role="menu" hidden>
              <a href="/profile.html" data-nav-menu-view role="menuitem">View Profile</a>
              <a href="/edit-profile.html" data-nav-menu-edit role="menuitem">Edit Profile</a>
              <button type="button" data-nav-menu-signout role="menuitem">Log Out</button>
              <a href="/auth.html" data-nav-menu-auth role="menuitem">Sign In / Sign Up</a>
            </div>
          </div>
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
