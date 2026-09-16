export function communityScrollViewport(root = document) {
  const main = root.querySelector('.community-main')
  if (main && /auto|scroll/.test(getComputedStyle(main).overflowY)) return main
  return document.scrollingElement || document.documentElement
}
export function setCommunityScroll(top, root = document) {
  communityScrollViewport(root).scrollTop = Math.max(0, Number(top) || 0)
}
export function syncCommunityMobileHeader(detail, root = document) {
  const header = root.querySelector('[data-community-mobile-header]')
  if (!header) return
  header.classList.toggle('is-post-view', Boolean(detail))
  const back = header.querySelector('[data-community-back-to-feed]')
  if (back) { back.hidden = !detail; back.tabIndex = detail ? 0 : -1 }
  const actions = header.querySelector('.mobile-app-actions')
  if (actions) { actions.inert = Boolean(detail); actions.setAttribute('aria-hidden', String(Boolean(detail))) }
}
