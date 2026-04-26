const PAGE_HERO_VIDEO_PATHS = {
  home: {
    webm: 'assets/site/home/backgrounds/hero-loop.webm',
    mp4: 'assets/site/home/backgrounds/hero-loop.mp4'
  },
  products: {
    webm: 'assets/site/products/backgrounds/hero-loop.webm',
    mp4: 'assets/site/products/backgrounds/hero-loop.mp4'
  },
  community: {
    webm: 'assets/site/community/backgrounds/hero-loop.webm',
    mp4: 'assets/site/community/backgrounds/hero-loop.mp4'
  },
  live: {
    webm: 'assets/site/live/backgrounds/hero-loop.webm',
    mp4: 'assets/site/live/backgrounds/hero-loop.mp4'
  },
  forms: {
    webm: 'assets/site/forms/backgrounds/hero-loop.webm',
    mp4: 'assets/site/forms/backgrounds/hero-loop.mp4'
  },
  faq: {
    webm: 'assets/site/faq/backgrounds/hero-loop.webm',
    mp4: 'assets/site/faq/backgrounds/hero-loop.mp4'
  },
  support: {
    webm: 'assets/site/support/backgrounds/hero-loop.webm',
    mp4: 'assets/site/support/backgrounds/hero-loop.mp4'
  },
  cart: {
    webm: 'assets/site/cart/backgrounds/hero-loop.webm',
    mp4: 'assets/site/cart/backgrounds/hero-loop.mp4'
  },
  auth: {
    webm: 'assets/site/auth/backgrounds/hero-loop.webm',
    mp4: 'assets/site/auth/backgrounds/hero-loop.mp4'
  },
  'product-detail': {
    webm: 'assets/site/product-detail/backgrounds/hero-loop.webm',
    mp4: 'assets/site/product-detail/backgrounds/hero-loop.mp4'
  }
}

// Enable video paths only for pages with confirmed uploaded assets.
// Keep "home" disabled until hero-loop files are uploaded to Storage.
const ENABLED_PAGE_HERO_VIDEOS = new Set([
  'products',
  'community',
  'live',
  'forms',
  'faq',
  'support',
  'cart',
  'auth',
  'product-detail'
])

export function getPageHeroVideoPaths(pageKey) {
  if (!ENABLED_PAGE_HERO_VIDEOS.has(pageKey)) return null
  return PAGE_HERO_VIDEO_PATHS[pageKey] || null
}
