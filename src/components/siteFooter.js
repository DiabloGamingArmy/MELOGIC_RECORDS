import { ROUTES } from '../utils/routes'

const FOOTER_LINKS = [
  ['About', ROUTES.about],
  ['Contact', ROUTES.contact],
  ['Support', ROUTES.support],
  ['FAQ', ROUTES.faq],
  ['Privacy', ROUTES.privacy],
  ['Terms', ROUTES.terms],
  ['Refund Policy', ROUTES.refundPolicy],
  ['Creator Guidelines', ROUTES.creatorGuidelines],
  ['Ad Policy', ROUTES.adPolicy]
]

const PUBLIC_FOOTER_BLOCKED_PREFIXES = [
  '/auth',
  '/cart',
  '/checkout',
  '/account',
  '/admin',
  '/inbox',
  '/community',
  '/instrument-host',
  '/products/new',
  '/products/dashboard',
  '/studio/daw',
  '/studio/live',
  '/studio/stagemaker/project',
  '/stage'
]

export function shouldRenderSiteFooter(pathname = window.location.pathname) {
  return !PUBLIC_FOOTER_BLOCKED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

export function renderSiteFooter() {
  return `
    <footer class="site-footer" data-site-footer>
      <div class="site-footer-inner">
        <div class="site-footer-brand">
          <strong>Melogic Records</strong>
          <p>Digital audio marketplace, creator tools, and support for producers building original music products.</p>
        </div>
        <nav class="site-footer-links" aria-label="Site information">
          ${FOOTER_LINKS.map(([label, href]) => `<a href="${href}">${label}</a>`).join('')}
        </nav>
      </div>
    </footer>
  `
}

export function ensureSiteFooter({ pathname = window.location.pathname } = {}) {
  if (!shouldRenderSiteFooter(pathname)) {
    document.querySelector('[data-site-footer]')?.remove()
    return
  }
  if (document.querySelector('[data-site-footer]')) return
  const main = document.querySelector('main')
  if (!main) return
  main.insertAdjacentHTML('afterend', renderSiteFooter())
}
