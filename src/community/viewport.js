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
  const isPostView = Boolean(detail)
  header.classList.toggle('is-post-view', isPostView)

  const back = header.querySelector('[data-community-back-to-feed]')
  if (back) {
    back.hidden = !isPostView
    back.tabIndex = isPostView ? 0 : -1
  }

  const title = header.querySelector('.mobile-app-title')
  if (title) {
    const lockup = title.querySelector('.community-title-lockup')
    if (lockup) {
      lockup.hidden = isPostView
      lockup.setAttribute('aria-hidden', String(isPostView))
    }

    let postTitle = title.querySelector('.community-post-header-title')
    if (!postTitle) {
      postTitle = document.createElement('span')
      postTitle.className = 'community-post-header-title'
      postTitle.textContent = 'POST'
      postTitle.hidden = true
      title.append(postTitle)
    }
    postTitle.hidden = !isPostView
    postTitle.setAttribute('aria-hidden', String(!isPostView))
  }

  const actions = header.querySelector('.mobile-app-actions')
  if (actions) {
    actions.inert = isPostView
    actions.setAttribute('aria-hidden', String(isPostView))
  }
}
