export const ROUTES = {
  home: '/home',
  products: '/products',
  productDetail: '/product',
  cart: '/cart',
  auth: '/auth',
  authAction: '/auth/action',
  profile: '/profile',
  accountSecurity: '/account/security',
  profilePublic: '/profile/public',
  library: '/account/library',
  orders: '/account/orders',
  inbox: '/inbox',
  inboxMessages: '/inbox/messages',
  inboxCalls: '/inbox/calls',
  inboxContent: '/inbox/content',
  inboxContentAll: '/inbox/content/all',
  inboxContentLikes: '/inbox/content/likes',
  inboxContentFollows: '/inbox/content/follows',
  inboxContentComments: '/inbox/content/comments',
  inboxContentMentions: '/inbox/content/mentions',
  inboxSystem: '/inbox/system',
  editProfile: '/profile/edit',
  newProduct: '/products/new',
  editProduct: '/products/edit',
  productDashboard: '/products/dashboard',
  admin: '/admin',
  adminReviews: '/admin/reviews',
  adminProducts: '/admin/products',
  adminUsers: '/admin/users',
  adminReports: '/admin/reports',
  adminCommunity: '/admin/community',
  adminOrders: '/admin/orders',
  adminTeam: '/admin/team',
  adminLogs: '/admin/logs',
  adminContact: '/admin/contact',
  adminTools: '/admin/tools',
  adminOperations: '/admin/operations',
  adminSettings: '/admin/settings',
  adminMarketplaceReview: '/admin/reviews',
  community: '/community',
  communityCommunities: '/community/communities',
  communityCreate: '/community/create',
  communitySlug: '/community/c',
  communityPost: '/community/post',
  live: '/live',
  forms: '/forms',
  faq: '/faq',
  support: '/support',
  studio: '/studio',
  studioDaw: '/studio/daw',
  studioStagemaker: '/studio/stagemaker',
  stage: '/stage',
  studioProject: '/studio/daw/project',
  studioInstrumentHost: '/instrument-host.html',
  stageProject: '/studio/stagemaker/project',
  studioDemos: '/studio/demos',
  studioTutorials: '/studio/tutorials',
  distribution: '/distribution'
}

const LEGACY_ROUTE_MAP = {
  '/': ROUTES.home,
  '/index.html': ROUTES.home,
  '/products.html': ROUTES.products,
  '/product.html': ROUTES.productDetail,
  '/product-dashboard.html': ROUTES.productDashboard,
  '/admin.html': ROUTES.admin,
  '/admin-marketplace-review.html': ROUTES.adminReviews,
  '/new-product.html': ROUTES.newProduct,
  '/cart.html': ROUTES.cart,
  '/auth.html': ROUTES.auth,
  '/auth-action.html': ROUTES.authAction,
  '/profile.html': ROUTES.profile,
  '/account-security.html': ROUTES.accountSecurity,
  '/edit-profile.html': ROUTES.editProfile,
  '/profile-public.html': ROUTES.profilePublic,
  '/library.html': ROUTES.library,
  '/orders.html': ROUTES.orders,
  '/library': ROUTES.library,
  '/orders': ROUTES.orders,
  '/inbox.html': ROUTES.inbox,
  '/community.html': ROUTES.community,
  '/live.html': ROUTES.live,
  '/forms.html': ROUTES.forms,
  '/faq.html': ROUTES.faq,
  '/support.html': ROUTES.support,
  '/studio.html': ROUTES.studio,
  '/stage.html': ROUTES.studioStagemaker,
  '/studio-project.html': ROUTES.studioDaw,
  '/studio-demos.html': ROUTES.studioDemos,
  '/studio-tutorials.html': ROUTES.studioTutorials,
  '/distribution.html': ROUTES.distribution
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
  const identifier = String(uid || username || '').trim()
  if (!identifier) return ROUTES.profilePublic

  const route = `/profiles/${encodeURIComponent(identifier)}`
  return preview && uid ? `${route}?preview=public` : route
}

export function usernameProfileRoute(username = '') {
  return `/u/${encodeURIComponent(String(username || '').trim())}`
}

function slugifyRouteSegment(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

export function productRoute(productOrId = '') {
  if (productOrId && typeof productOrId === 'object') {
    const id = String(productOrId.id || '').trim()
    if (!id) return '/products/'
    const slug = slugifyRouteSegment(productOrId.slug || productOrId.title || '')
    if (!slug) return `/products/${encodeURIComponent(id)}`
    return `/products/${encodeURIComponent(`${slug}--${id}`)}`
  }

  return `/products/${encodeURIComponent(String(productOrId || '').trim())}`
}

export function communityPostRoute(postId = '', { commentId = '', replyId = '' } = {}) {
  const id = String(postId || '').trim()
  if (!id) return ROUTES.community
  const params = new URLSearchParams()
  if (commentId) params.set('comment', String(commentId))
  if (replyId) params.set('reply', String(replyId))
  const query = params.toString()
  return `${ROUTES.communityPost}/${encodeURIComponent(id)}${query ? `?${query}` : ''}`
}

export function communityRoute(slug = '') {
  const clean = String(slug || '').trim()
  return clean ? `${ROUTES.communitySlug}/${encodeURIComponent(clean)}` : ROUTES.communityCommunities
}

export function inboxActiveCallRoute(targetId = '') {
  const id = String(targetId || '').trim()
  return id ? `${ROUTES.inboxCalls}/active/${encodeURIComponent(id)}` : ROUTES.inboxCalls
}

export function adminReviewRoute(productId = '') {
  const id = String(productId || '').trim()
  return id ? `${ROUTES.adminReviews}/${encodeURIComponent(id)}` : ROUTES.adminReviews
}

export function studioProjectRoute(projectId = '') {
  return `/studio/daw/project/${encodeURIComponent(String(projectId || '').trim())}`
}

export function stageProjectRoute(projectId = '') {
  return `/studio/stagemaker/project/${encodeURIComponent(String(projectId || '').trim())}`
}

export function getCurrentPath() {
  return cleanRedirectTarget(`${window.location.pathname}${window.location.search}${window.location.hash}`, ROUTES.home)
}
