const warmedHrefs = new Set()
let installed = false

function connectionAllowsPrewarm() {
  const connection = navigator.connection
  return !connection?.saveData && !['slow-2g', '2g'].includes(String(connection?.effectiveType || ''))
}

async function prewarmHref(href = '') {
  if (!connectionAllowsPrewarm()) return
  let url
  try { url = new URL(href, location.href) } catch { return }
  if (url.origin !== location.origin) return
  const key = `${url.pathname}${url.search}`
  if (warmedHrefs.has(key)) return
  warmedHrefs.add(key)
  if (warmedHrefs.size > 200) warmedHrefs.delete(warmedHrefs.values().next().value)
  const { getUidForUsername, prewarmPublicProfile } = await import('../firebase/firestore.js')

  let uid = String(url.searchParams.get('uid') || '').trim()
  if (!uid && url.pathname.startsWith('/profiles/')) {
    const identifier = decodeURIComponent(url.pathname.slice('/profiles/'.length).split('/')[0] || '').trim()
    uid = await getUidForUsername(identifier).catch(() => null) || identifier
  } else if (!uid && url.pathname.startsWith('/u/')) {
    const username = decodeURIComponent(url.pathname.slice(3).split('/')[0] || '').trim()
    uid = await getUidForUsername(username).catch(() => null) || ''
  }
  if (uid) await prewarmPublicProfile(uid)
}

function handleIntent(event) {
  const link = event.target?.closest?.('a[href]')
  if (!link || !link.matches('a[href^="/profiles/"],a[href^="/u/"],a[href*="/profile/public?"]')) return
  void prewarmHref(link.href)
}

export function installProfilePrewarming() {
  if (installed || typeof document === 'undefined') return
  installed = true
  document.addEventListener('pointerover', handleIntent, { passive: true, capture: true })
  document.addEventListener('focusin', handleIntent, { passive: true, capture: true })
  document.addEventListener('touchstart', handleIntent, { passive: true, capture: true })
}

installProfilePrewarming()
