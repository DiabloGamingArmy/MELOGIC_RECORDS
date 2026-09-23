/* Melogic service worker: Web Push and a bounded, public offline shell. */
self.addEventListener('push', (event) => {
  // Declarative Web Push with mutable:false is already a complete user-visible
  // notification. Modern WebKit owns its presentation; creating another
  // showNotification() here can replace/duplicate the declarative content.
  if (event.notification) {
    console.log('[MELOGIC PUSH TRACE 4.3] declarative notification accepted by browser', {
      title: event.notification.title,
      body: event.notification.body,
      navigate: event.notification.navigate || null
    })
    return
  }

  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  // Modern WebKit may parse Declarative Web Push before this handler runs.
  // For engines using the imperative service-worker path, unwrap the same
  // standardized notification so both paths render identical content.
  const declarative = payload?.web_push === 8030 && payload?.notification && typeof payload.notification === 'object'
    ? payload.notification
    : null
  const title = String(declarative?.title || payload.title || 'Melogic')
  const icon = new URL(payload.icon || '/branding/icons/pwa-192.png', self.location.origin).href
  const badge = new URL(payload.badge || '/branding/icons/favicon-48.png', self.location.origin).href
  const navigate = declarative?.navigate || payload.url || '/'
  const options = {
    body: String(declarative?.body || payload.body || 'You have a new Melogic notification.'),
    icon,
    badge,
    tag: declarative?.tag || payload.tag || undefined,
    renotify: Boolean(payload.renotify),
    silent: declarative?.silent === true || payload.silent === true,
    data: {
      url: navigate,
      ...(payload.data && typeof payload.data === 'object' ? payload.data : {})
    }
  }

  console.log('[MELOGIC PUSH TRACE 4.3] legacy service-worker render', {
    title,
    body: options.body,
    url: options.data?.url || null,
    traceId: options.data?.__melogicPushTraceId || null
  })
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification?.data?.url || '/', self.location.origin).href

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of windows) {
      if ('focus' in client) {
        try { await client.navigate(target) } catch {}
        return client.focus()
      }
    }
    return clients.openWindow ? clients.openWindow(target) : undefined
  })())
})


// Log subscription invalidation for future diagnostics. Re-subscription requires
// the application server key and authenticated persistence, so the foreground
// app performs enrollment rather than silently creating an untracked endpoint.
self.addEventListener('pushsubscriptionchange', (event) => {
  console.warn('[melogic-push-sw] pushsubscriptionchange', {
    hadOldSubscription: Boolean(event.oldSubscription),
    hasNewSubscription: Boolean(event.newSubscription)
  })
})

// Navigation fallback shares the existing root registration and push subscription.
// New builds wait for existing clients to close: never reload an active editor.
const SHELL_CACHE_PREFIX = 'melogic-shell-'
const SHELL_CACHE = `${SHELL_CACHE_PREFIX}__MELOGIC_PWA_BUILD__`
const ROUTE_CACHE_PREFIX = 'melogic-mobile-routes-'
const ROUTE_CACHE = `${ROUTE_CACHE_PREFIX}__MELOGIC_PWA_BUILD__`
const CURRENT_BUILD = '__MELOGIC_PWA_BUILD__'
const ROUTE_FRESH_MS = 30_000
const SHELL_FILES = ['/offline.html', '/manifest.webmanifest', '/branding/icons/pwa-192.png', '/branding/icons/pwa-512.png', '/branding/icons/pwa-maskable-512.png', '/branding/icons/apple-touch-icon.png']

// Patch 1 foundation only: these are public HTML route documents. Their JS/CSS
// remains fingerprinted and is cached by the existing static-asset policy.
// Dynamic Firebase/user data is deliberately NOT stored in Cache Storage.
const MELOGIC_WARM_MOBILE_ROUTES = new Set([
  '/community',
  '/streaming',
  '/streaming/live',
  '/streaming/sequence',
  '/camera',
  '/inbox',
  '/inbox/messages',
  '/inbox/calls',
  '/inbox/content/all',
  '/profile',
  '/profile/edit',
  '/profile/public',
  '/products',
  '/cart',
  '/support',
  '/support/faq',
  '/support/about',
  '/support/contact',
  '/support/privacy',
  '/support/terms'
])

/* melogic-pwa-forced-release-v2 */
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    await caches.open(SHELL_CACHE).then(cache => cache.addAll(SHELL_FILES))
    // This worker file is build-versioned. If it changed, promote it immediately
    // rather than leaving an installed PWA pinned to the previous worker.
    await self.skipWaiting()
  })())
})
self.addEventListener('message', event => {
  if (event.data?.type === 'MELOGIC_SKIP_WAITING') {
    event.waitUntil(self.skipWaiting())
  }
})

/* melogic-pwa-auto-update-worker-v1 */
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // melogic-mobile-spa-cache-v7b
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.enable() } catch {}
    }
    const keys = await caches.keys()
    await Promise.all(keys.filter(key =>
      (key.startsWith(SHELL_CACHE_PREFIX) && key !== SHELL_CACHE) ||
      (key.startsWith(ROUTE_CACHE_PREFIX) && key !== ROUTE_CACHE)
    ).map(key => caches.delete(key)))
    await clients.claim()
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true })
    await Promise.all(windows.map(client => client.postMessage({
      type: 'MELOGIC_PWA_UPDATED',
      build: SHELL_CACHE.slice(SHELL_CACHE_PREFIX.length)
    })))
  })())
})
self.addEventListener('fetch', event => {
  const request = event.request
  const url = new URL(request.url)
  // Never cache APIs, uploads, account data, media, Range responses or third parties.
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Range') || request.headers.has('Authorization')) return
  if (request.mode === 'navigate') {
    const routeKey = url.pathname.replace(/\/+$/, '') || '/'
    if (MELOGIC_WARM_MOBILE_ROUTES.has(routeKey)) {
      // melogic-stale-asset-404-recovery-v1
      // NETWORK-FIRST for route HTML. Never serve a cached HTML document before
      // checking the current deployment: its fingerprinted asset references may
      // belong to an older Firebase release whose files no longer exist.
      event.respondWith((async () => {
        const routeCache = await caches.open(ROUTE_CACHE)
        const cachedRoute = await routeCache.match(routeKey)
        const cachedAt = Number(cachedRoute?.headers.get('X-Melogic-Cached-At') || 0)
        const cachedBuild = String(cachedRoute?.headers.get('X-Melogic-Build') || '')
        const networkRoute = Promise.resolve(event.preloadResponse).then((preloaded) => preloaded || fetch(request, { cache: 'no-store' }))

        // A warm HTML response is only eligible after the deployment manifest
        // confirms this worker's fingerprint set is still the active release.
        if (cachedRoute && cachedBuild === CURRENT_BUILD && Date.now() - cachedAt < ROUTE_FRESH_MS) {
          try {
            const manifestResponse = await fetch(`/melogic-build.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })
            const serverBuild = manifestResponse.ok ? String((await manifestResponse.json())?.build || '') : ''
            if (serverBuild === CURRENT_BUILD) {
              event.waitUntil(networkRoute.then(async (response) => {
                if (!response?.ok || !String(response.headers.get('Content-Type') || '').includes('text/html')) return
                const headers = new Headers(response.headers)
                headers.set('X-Melogic-Build', CURRENT_BUILD)
                headers.set('X-Melogic-Cached-At', String(Date.now()))
                await routeCache.put(routeKey, new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers }))
              }).catch(() => {}))
              return cachedRoute
            }
          } catch {}
        }

        try {
          const response = await networkRoute
          if (response?.ok) {
            if (String(response.headers.get('Content-Type') || '').includes('text/html') && !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
              const headers = new Headers(response.headers)
              headers.set('X-Melogic-Build', CURRENT_BUILD)
              headers.set('X-Melogic-Cached-At', String(Date.now()))
              try { await routeCache.put(routeKey, new Response(await response.clone().blob(), { status: response.status, statusText: response.statusText, headers })) } catch {}
            }
            return response
          }
        } catch {}

        // Offline-only fallback may use the most recently cached route document.
        // It is never used while the network succeeds.
        if (cachedRoute) return cachedRoute

        const offline = await caches.open(SHELL_CACHE).then(shell => shell.match('/offline.html'))
        return offline || new Response('Melogic is offline. Reconnect and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
      })())
      return
    }
    event.respondWith(fetch(request).catch(async () => {
      const cached = await caches.open(SHELL_CACHE).then(cache => cache.match('/offline.html'))
      return cached || new Response('Melogic is offline. Reconnect and try again.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }))
    return
  }
  // Only build-fingerprinted static resources and the explicit offline shell.
  const staticAsset = !url.search && /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.(js|css|woff2?)$/.test(url.pathname)
  if (!staticAsset && !SHELL_FILES.includes(url.pathname)) return
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE)
    const cached = await cache.match(request)
    if (cached) return cached
    const response = await fetch(request)
    if (response.ok && response.type === 'basic' && !/no-store|private/i.test(response.headers.get('Cache-Control') || '')) {
      // Caching failure must not turn a successful network response into a failure.
      try {
        await cache.put(request, response.clone())
        const keys = await cache.keys()
        const runtime = keys.filter(key => !SHELL_FILES.includes(new URL(key.url).pathname))
        await Promise.all(runtime.slice(0, Math.max(0, runtime.length - 80)).map(key => cache.delete(key)))
      } catch {}
    }
    return response
  })())
})
