/* Melogic Web Push service worker.
   Push/notification only: intentionally does not intercept fetch requests. */
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
  const icon = new URL(payload.icon || '/icons/pwa-192.png', self.location.origin).href
  const badge = new URL(payload.badge || '/icons/favicon-48.png', self.location.origin).href
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
