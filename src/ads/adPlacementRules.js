const BLOCKED_AD_PATH_PREFIXES = [
  '/auth',
  '/cart',
  '/checkout',
  '/account',
  '/account/billing-payouts',
  '/account/orders',
  '/account/library',
  '/products/new',
  '/products/dashboard',
  '/admin',
  '/inbox',
  '/support'
]

const MARKETPLACE_RAIL_PATHS = new Set(['/products', '/products/'])

export function areAdsBlockedOnPath(pathname = window.location.pathname) {
  return BLOCKED_AD_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function canShowMarketplaceRails(pathname = window.location.pathname) {
  if (areAdsBlockedOnPath(pathname)) return false
  return MARKETPLACE_RAIL_PATHS.has(pathname)
}
