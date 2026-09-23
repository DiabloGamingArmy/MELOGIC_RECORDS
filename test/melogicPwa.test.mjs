import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import vm from 'node:vm'
import { melogicPwaPlugin } from '../scripts/pwaPlugin.mjs'
const source = await fs.readFile(new URL('../public/melogic-push-sw.js', import.meta.url), 'utf8')
function worker({ offline = false, cacheFailure = false } = {}) {
  const handlers = {}, deleted = [], stored = new Map(), requests = [], lifecycleCalls = []
  const cache = {
    addAll: async files => files.forEach(file => stored.set(file, new Response(file === '/offline.html' ? 'Reconnect' : file))),
    match: async key => stored.get(typeof key === 'string' ? key : new URL(key.url).pathname)?.clone(),
    put: async (key, response) => { if (cacheFailure) throw Error('quota'); stored.set(new URL(key.url).pathname, response) },
    keys: async () => [...stored.keys()].map(key => new Request('https://melogic.test' + key)),
    delete: async key => stored.delete(new URL(key.url).pathname)
  }
  const context = {
    URL, Response, Headers, console, self: {
      location: { origin: 'https://melogic.test' },
      registration: { navigationPreload: { enable: async () => lifecycleCalls.push('navigation-preload') } },
      skipWaiting: async () => lifecycleCalls.push('skip-waiting'),
      addEventListener: (type, callback) => handlers[type] = callback
    },
    clients: { claim: async () => lifecycleCalls.push('claim'), matchAll: async () => [] },
    caches: { open: async () => cache, keys: async () => ['melogic-shell-old', 'unrelated-cache'], delete: async key => deleted.push(key) },
    fetch: async request => { requests.push(request); if (offline) throw Error('offline'); const response = new Response('asset'); Object.defineProperty(response, 'type', { value: 'basic' }); return response }
  }
  vm.runInNewContext(source, context)
  const lifecycle = async type => { let pending; handlers[type]({ waitUntil: p => pending = p }); await pending }
  const fetch = async (path, options = {}) => {
    let result
    const request = { url: path.startsWith('https:') ? path : 'https://melogic.test' + path, method: 'GET', mode: 'cors', headers: new Headers(), ...options }
    handlers.fetch({ request, respondWith: p => result = p })
    return result ? await result : null
  }
  return { lifecycle, fetch, stored, requests, deleted, handlers, lifecycleCalls }
}
test('offline shell installs and unavailable deep links receive fallback', async () => {
  const w = worker({ offline: true }); await w.lifecycle('install')
  const result = await w.fetch('/studio/soura/project/example', { mode: 'navigate' })
  assert.equal(await result.text(), 'Reconnect')
  assert.ok(w.handlers.push && w.handlers.notificationclick)
})
test('activation removes older Melogic caches and promotes the versioned worker', async () => {
  const w = worker(); await w.lifecycle('activate')
  assert.deepEqual(w.deleted, ['melogic-shell-old'])
  assert.ok(w.lifecycleCalls.includes('claim'))
  assert.match(source, /skipWaiting\(|clients\.claim\(/)
})
test('authenticated data, audio, uploads, ranges and third-party requests bypass worker', async () => {
  const w = worker()
  for (const [path, options] of [
    ['/api/account', {}], ['/audio/take.wav', {}], ['/assets/file-abcdefgh.js', { method: 'POST' }],
    ['/assets/file-abcdefgh.js', { headers: new Headers({ Range: 'bytes=0-10' }) }],
    ['/assets/file-abcdefgh.js', { headers: new Headers({ Authorization: 'Bearer example' }) }],
    ['https://other.test/assets/file-abcdefgh.js', {}]
  ]) assert.equal(await w.fetch(path, options), null)
  assert.equal(w.requests.length, 0)
})
test('fingerprinted static files are cached; cache quota failure preserves response', async () => {
  const w = worker(); await w.fetch('/assets/app-abcdefgh.js'); await w.fetch('/assets/app-abcdefgh.js')
  assert.equal(w.requests.length, 1)
  const full = worker({ cacheFailure: true })
  assert.equal(await (await full.fetch('/assets/app-abcdefgh.js')).text(), 'asset')
})
test('every Vite HTML entry receives viewport and Apple tags without duplicate viewport', () => {
  const result = melogicPwaPlugin().transformIndexHtml.handler('<head><meta name="viewport" content="width=device-width, initial-scale=1"></head>')
  assert.match(result.html, /viewport-fit=cover/)
  assert.equal((result.html.match(/name="viewport"/g) || []).length, 1)
  assert.ok(result.tags.some(tag => tag.attrs.src === '/src/pwa/register.js'))
  assert.ok(result.tags.some(tag => tag.attrs.name === 'apple-mobile-web-app-capable'))
})
test('manifest assets exist with correct PNG dimensions and working shortcut routes', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../public/manifest.webmanifest', import.meta.url)))
  assert.equal(manifest.id, '/'); assert.equal(manifest.display, 'standalone'); assert.equal(manifest.orientation, undefined)
  for (const icon of manifest.icons) {
    const bytes = await fs.readFile(new URL('../public' + icon.src, import.meta.url))
    assert.equal(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`, icon.sizes)
  }
  const config = JSON.parse(await fs.readFile(new URL('../firebase.json', import.meta.url)))
  for (const shortcut of manifest.shortcuts) assert.ok(config.hosting.rewrites.some(route => route.source === shortcut.url))
})
