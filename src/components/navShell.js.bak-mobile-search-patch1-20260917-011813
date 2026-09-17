import { iconSvg } from '../utils/icons'
import { ROUTES } from '../utils/routes'
import brandLogoUrl from '../assets/brand/melogic-logo-mark-white-transparent.png'
export function navShell(options = {}) {
  const currentPage = options.currentPage || ''
  const isHome = currentPage === 'home'
  const isMusic = currentPage === 'music'
  const isProducts = currentPage === 'products'
  const isProfile = currentPage === 'profile'
  const isInbox = currentPage === 'inbox'
  const isStudio = currentPage === 'studio'
  const isDistribution = currentPage === 'distribution'
  const isCommunity = currentPage === 'community'
  const isCommunitySearch = currentPage === 'communitySearch'
  const isCommunitySection = isCommunity || isCommunitySearch
  const isCamera = currentPage === 'camera'
  const isSupport = currentPage === 'support'
  const isAdmin = currentPage === 'admin'

  return `
    <div class="mobile-app-shell">
      <header class="mobile-app-header ${isCommunitySection ? 'community-app-header' : ''}" ${isCommunity ? 'data-community-mobile-header' : ''}>
        ${isCommunity ? `<a class="community-mobile-back mobile-icon-button" href="${ROUTES.community}" data-community-back-to-feed aria-label="Back to Community" hidden>${iconSvg('arrowLeft')}</a>` : ''}
        ${isCommunitySearch ? `<a class="community-search-back mobile-icon-button" href="${ROUTES.community}" aria-label="Back to Community">${iconSvg('arrowLeft')}</a>` : ''}
        <h1 class="mobile-app-title">${isCommunity ? `<span class="community-title-lockup"><img class="community-title-logo" src="${brandLogoUrl}" alt="" aria-hidden="true"><span>Community</span></span>` : isCommunitySearch ? 'Search' : isMusic ? 'Streaming' : isProducts ? 'Products' : isInbox ? 'Inbox' : isProfile ? 'Profile' : isCamera ? 'Camera' : 'Melogic'}</h1>
        <div class="mobile-app-actions">${isCommunity ? `<a class="mobile-icon-button community-header-action" href="${ROUTES.communitySearch}" aria-label="Search Community">${iconSvg('search')}</a><a class="mobile-icon-button mobile-create-button community-header-action" href="${ROUTES.communityCreate}" aria-label="Create post">${iconSvg('plus')}</a>` : ''}</div>
      </header>
      <nav class="mobile-bottom-nav" aria-label="Mobile primary navigation" style="grid-template-columns:repeat(5,minmax(0,1fr))">
        <a href="${ROUTES.community}" ${isCommunity ? 'aria-current="page"' : ''}><span class="mobile-nav-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M3.5 10.8 12 3.8l8.5 7v9.4a.8.8 0 0 1-.8.8h-5.2v-6.2h-5V21H4.3a.8.8 0 0 1-.8-.8v-9.4Z"/></svg></span><span>Community</span></a>
        <a href="${ROUTES.music}" ${isMusic ? 'aria-current="page"' : ''}><span class="mobile-nav-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 5.2v13.6L19 12 8 5.2Z"/></svg></span><span>Streaming</span></a>
        <a class="mobile-camera-nav" href="/camera.html" ${isCamera ? 'aria-current="page"' : ''} aria-label="Open Camera"><span class="mobile-nav-glyph mobile-camera-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 7.5h3l1.4-2h7.2l1.4 2h3v11H4v-11Z"/><circle cx="12" cy="13" r="3.4"/></svg></span><span>Camera</span></a>
        <a href="${ROUTES.inbox}" ${isInbox ? 'aria-current="page"' : ''}><span class="mobile-nav-glyph" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 6.2h16v11.6H4V6.2Z"/><path d="m4.6 7 7.4 5.2L19.4 7"/></svg></span><span>Inbox</span></a>
        <a href="${ROUTES.profile}" ${isProfile ? 'aria-current="page"' : ''}><span class="mobile-profile-nav-avatar" data-profile-avatar aria-hidden="true"></span><span>Profile</span></a>
      </nav>
    </div>
    <header class="nav-shell"><div class="nav-inner">
      <a class="brand" href="${ROUTES.home}" aria-label="Melogic Records home" data-guide-id="global-nav-brand" data-guide-label="Melogic Records home" data-guide-role="global-nav-link"><span class="brand-logo-shell" aria-hidden="true"><img alt="Melogic logo mark" class="brand-logo" data-brand-logo data-loaded="true" src="${brandLogoUrl}" loading="eager" decoding="async" width="38" height="38" /></span><span class="brand-text">MELOGIC RECORDS</span></a>
      <nav class="main-nav" aria-label="Primary"><a href="${ROUTES.home}" data-guide-id="global-nav-home" data-guide-label="Home" data-guide-role="global-nav-link" ${isHome ? 'aria-current="page"' : ''}>Home</a><a href="${ROUTES.music}" data-guide-id="global-nav-streaming" data-guide-label="Streaming" data-guide-role="global-nav-link" ${isMusic ? 'aria-current="page"' : ''}>Streaming</a><a href="${ROUTES.products}" data-guide-id="global-nav-products" data-guide-label="Products" data-guide-role="global-nav-link" ${isProducts ? 'aria-current="page"' : ''}>Products</a><a href="${ROUTES.studio}" data-guide-id="global-nav-studio" data-guide-label="Studio" data-guide-role="global-nav-link" ${isStudio ? 'aria-current="page"' : ''}>Studio</a><a href="${ROUTES.distribution}" data-guide-id="global-nav-distribution" data-guide-label="Distribution" data-guide-role="global-nav-link" ${isDistribution ? 'aria-current="page"' : ''}>Distribution</a><a href="${ROUTES.community}" data-guide-id="global-nav-community" data-guide-label="Community" data-guide-role="global-nav-link" ${isCommunity ? 'aria-current="page"' : ''}>Community</a><a href="${ROUTES.support}" data-guide-id="global-nav-support" data-guide-label="Support" data-guide-role="global-nav-link" ${isSupport ? 'aria-current="page"' : ''}>Support</a></nav>
      <div class="nav-actions" aria-label="Account and cart actions"><a class="button button-muted nav-inbox ${isInbox ? 'is-active' : ''}" data-nav-inbox href="${ROUTES.inbox}" aria-label="Open inbox" data-guide-id="global-nav-inbox" data-guide-label="Inbox" data-guide-role="global-nav-button" ${isInbox ? 'aria-current="page"' : ''}><span class="inbox-icon" aria-hidden="true"><svg viewBox="0 0 24 24" focusable="false" aria-hidden="true"><path d="M4 5.5h16A1.5 1.5 0 0 1 21.5 7v10A1.5 1.5 0 0 1 20 18.5H4A1.5 1.5 0 0 1 2.5 17V7A1.5 1.5 0 0 1 4 5.5Zm0 1a.5.5 0 0 0-.5.5v.42l8.5 5.1 8.5-5.1V7a.5.5 0 0 0-.5-.5H4Zm16.5 2.08-6.94 4.16a2.98 2.98 0 0 1-3.12 0L3.5 8.58V17c0 .28.22.5.5.5h16a.5.5 0 0 0 .5-.5V8.58Z" /></svg></span><span class="inbox-label">Inbox</span><span class="inbox-badge" data-nav-inbox-badge aria-label="No unread inbox items"></span></a><div class="profile-menu" data-profile-menu><button type="button" class="profile-button ${isProfile ? 'is-active' : ''}" data-nav-profile-trigger data-guide-id="global-nav-profile" data-guide-label="Account profile menu" data-guide-role="global-nav-button" aria-label="Account menu" aria-haspopup="menu" aria-expanded="false" aria-controls="nav-profile-dropdown" ${isProfile ? 'aria-current="page"' : ''}><span class="profile-avatar" data-profile-avatar aria-hidden="true"></span></button><div class="profile-dropdown" id="nav-profile-dropdown" data-nav-profile-dropdown role="menu" hidden><a href="${ROUTES.admin}" data-nav-menu-admin role="menuitem" ${isAdmin ? 'aria-current="page"' : ''} hidden>Admin</a><a href="${ROUTES.profile}" data-nav-menu-view role="menuitem">View Profile</a><a href="${ROUTES.editProfile}" data-nav-menu-edit role="menuitem">Edit Profile</a><a href="${ROUTES.library}" data-nav-menu-library role="menuitem">Library</a><a href="${ROUTES.orders}" data-nav-menu-orders role="menuitem">Orders</a><a href="${ROUTES.billingPayouts}" data-nav-menu-payouts role="menuitem">Billing &amp; Payouts</a><a href="${ROUTES.accountSecurity}" data-nav-menu-security role="menuitem">Security</a><button type="button" data-install-melogic role="menuitem" hidden>Install Melogic</button><button type="button" data-nav-menu-signout role="menuitem">Log Out</button><a href="${ROUTES.auth}" data-nav-menu-auth role="menuitem">Sign In / Sign Up</a></div></div><a class="button button-cart" data-cart-trigger href="${ROUTES.cart}" aria-label="Open cart" data-guide-id="global-nav-cart" data-guide-label="Cart" data-guide-role="global-nav-button"><span class="cart-icon" aria-hidden="true">🛒</span><span>Cart</span><span class="cart-badge" data-cart-badge aria-label="0 items in cart">0</span></a></div>
    </div></header>
  `
}
