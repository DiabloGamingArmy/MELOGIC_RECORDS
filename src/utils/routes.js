export const ROUTES = {
  home: '/home',
  products: '/products',
  productDetail: '/product',
  cart: '/cart',
  auth: '/auth',
  profile: '/profile',
  profilePublic: '/profile/public',
  inbox: '/inbox',
  editProfile: '/profile/edit',
  newProduct: '/products/new',
  productDashboard: '/products/dashboard',
  community: '/community',
  live: '/live',
  forms: '/forms',
  faq: '/faq',
  support: '/support'
}

const LEGACY_ROUTE_MAP = {
  '/': ROUTES.home,
  '/index.html': ROUTES.home,
  '/products.html': ROUTES.products,
  '/product.html': ROUTES.productDetail,
  '/product-dashboard.html': ROUTES.productDashboard,
  '/new-product.html': ROUTES.newProduct,
  '/cart.html': ROUTES.cart,
  '/auth.html': ROUTES.auth,
  '/profile.html': ROUTES.profile,
  '/edit-profile.html': ROUTES.editProfile,
  '/profile-public.html': ROUTES.profilePublic,
  '/inbox.html': ROUTES.inbox,
  '/community.html': ROUTES.community,
  '/live.html': ROUTES.live,
  '/forms.html': ROUTES.forms,
  '/faq.html': ROUTES.faq,
  '/support.html': ROUTES.support
}

function asRelativePath(path = '') {
  if (typeof path !== 'string') return ''
  const trimmed = path.trim()
  if (!trimmed || trimmed.startsWith('//') || /^([a-z]+:)/i.test(trimmed)) return ''
  if (!trimmed.startsWith('/')) return ''
  return trimmed
}

export function cleanRedirectTarget(path, fallback = ROUTES.profile) {
  const relative = asRelativePath(path)
  if (!relative) return fallback

  try {
    const parsed = new URL(relative, window.location.origin)
    if (parsed.origin !== window.location.origin) return fallback
    const mappedPath = LEGACY_ROUTE_MAP[parsed.pathname] || parsed.pathname
    return `${mappedPath}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function authRoute({ redirect } = {}) {
  if (!redirect) return ROUTES.auth
  const safeTarget = cleanRedirectTarget(redirect, ROUTES.profile)
  return `${ROUTES.auth}?redirect=${encodeURIComponent(safeTarget)}`
}

export function publicProfileRoute({ uid, username, preview } = {}) {
  const params = new URLSearchParams()
  if (uid) params.set('uid', String(uid))
  else if (username) params.set('username', String(username))
  if (preview && uid) params.set('preview', 'public')
  const query = params.toString()
  return query ? `${ROUTES.profilePublic}?${query}` : ROUTES.profilePublic
}

export function usernameProfileRoute(username = '') {
  return `/u/${encodeURIComponent(String(username || '').trim())}`
}

export function productRoute(productId = '') {
  return `/products/${encodeURIComponent(String(productId || '').trim())}`
}

export function getCurrentPath() {
  return cleanRedirectTarget(`${window.location.pathname}${window.location.search}${window.location.hash}`, ROUTES.home)
}
