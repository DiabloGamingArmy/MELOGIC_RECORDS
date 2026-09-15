/* Melogic Web Push service worker.
   Push/notification only: intentionally does not intercept fetch requests. */
self.addEventListener('push', (event) => {
  let payload = {}
  try { payload = event.data ? event.data.json() : {} } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = String(payload.title || 'Melogic')
  const options = {
    body: String(payload.body || 'You have a new Melogic notification.'),
    icon: payload.icon || '/branding/icons/pwa-192.png',
    badge: payload.badge || '/branding/icons/favicon-48.png',
    tag: payload.tag || undefined,
    renotify: Boolean(payload.renotify),
    data: {
      url: payload.url || '/',
      ...(payload.data && typeof payload.data === 'object' ? payload.data : {})
    }
  }

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
