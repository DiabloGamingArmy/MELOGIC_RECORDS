import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { JSDOM } from 'jsdom'
const html = await readFile(new URL('../desktop-auth.html', import.meta.url), 'utf8')
const source = (await readFile(new URL('../src/desktopAuth.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '')
const transaction = 'a'.repeat(64)
async function fixture({ user = { displayName: '<b>Synthetic Account</b>', email: 'fixture@example.invalid' }, request = transaction, authFailure = false } = {}) {
  const dom = new JSDOM(html), document = dom.window.document
  let resolve, reject, redirect, calls = []
  const pending = new Promise((a, b) => { resolve = a; reject = b })
  const context = vm.createContext({ document, location: { search: '?request=' + request, replace: value => { redirect = value } }, URLSearchParams, functions: {}, waitForInitialAuthState: async () => { if (authFailure) throw Error('private backend details'); return user }, httpsCallable: (_, name) => { assert.equal(name, 'approveDesktopLogin'); return data => { calls.push(JSON.parse(JSON.stringify(data))); return pending } } })
  await vm.runInContext(`(async()=>{${source}\n})()`, context)
  return { dom, document, resolve, reject, calls, redirect: () => redirect, click: id => document.querySelector('#' + id).click(), text: () => document.querySelector('main').textContent, el: id => document.querySelector('#' + id) }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
test('minimal consent uses safe canonical identity, no code or engineering content', async () => {
  const f = await fixture(); assert.equal(f.el('consent').hidden, false)
  assert.equal(f.el('account-name').textContent, '<b>Synthetic Account</b>'); assert.equal(f.el('account-name').children.length, 0)
  assert.equal(f.el('account-email').textContent, 'fixture@example.invalid')
  assert.equal(f.document.querySelector('#verification'), null); assert.equal(f.document.querySelector('a'), null)
  assert.doesNotMatch(f.text(), /CODE|Firebase|PKCE|challenge|token|MELOGIC-[a-f0-9]{64}/)
})
for (const user of [{ email: 'fixture@example.invalid' }, { displayName: 'Fixture' }, {}]) test('identity gracefully renders available fields ' + Object.keys(user).join(','), async () => {
  const f = await fixture({ user }); assert.equal(f.el('consent').hidden, false)
  assert.ok(!f.el('account-name').hidden || !f.el('account-email').hidden)
})
for (const accepted of [true, false]) test((accepted ? 'Connect' : 'Decline') + ' submits exact transaction once, then removes consent controls', async () => {
  const f = await fixture(), action = accepted ? 'approve' : 'cancel'
  f.click(action); f.click(action); f.click(accepted ? 'cancel' : 'approve')
  assert.deepEqual(f.calls, [{ requestId: transaction, approve: accepted }])
  assert.match(f.el('status').textContent, accepted ? /Connecting/ : /Declining/)
  assert.equal(f.el('approve').disabled, true); assert.equal(f.el('cancel').disabled, true)
  f.resolve({ data: { ok: true } }); await tick()
  assert.equal(f.el('consent').hidden, true); assert.equal(f.el('completed').hidden, false)
  assert.equal(f.el('result-title').textContent, accepted ? 'Origami is connected' : 'Connection declined')
  assert.equal(f.el('success-icon').hidden, !accepted); assert.doesNotMatch(f.el('result-copy').textContent, /activated|redeemed/)
  f.click(action); assert.equal(f.calls.length, 1)
})
test('malformed successful response never claims connection', async () => {
  const f = await fixture(); f.click('approve'); f.resolve({ data: {} }); await tick()
  assert.match(f.el('result-copy').textContent, /not confirmed/); assert.equal(f.el('success-icon').hidden, true)
})
for (const code of ['deadline-exceeded', 'failed-precondition', 'invalid-argument', 'permission-denied', 'unauthenticated', 'internal']) test('safe terminal error: ' + code, async () => {
  const f = await fixture(); f.click('approve'); f.reject({ code: 'functions/' + code, message: 'private backend details' }); await tick()
  assert.equal(f.el('consent').hidden, true); assert.doesNotMatch(f.text(), /private backend details|Firebase/)
  assert.match(f.el('result-title').textContent, code === 'deadline-exceeded' ? /expired/ : /unavailable/)
})
test('malformed transaction cannot submit', async () => {
  const f = await fixture({ request: 'invalid' }); f.click('approve'); assert.equal(f.calls.length, 0); assert.equal(f.el('consent').hidden, true)
})
test('unauthenticated browser redirects to canonical sign-in with same transaction', async () => {
  const f = await fixture({ user: null }); assert.equal(f.redirect(), '/auth?redirect=' + encodeURIComponent('/auth/desktop?request=' + transaction)); f.click('approve'); assert.equal(f.calls.length, 0)
})
test('auth failure cannot reveal consent or submit', async () => {
  const f = await fixture({ authFailure: true }); assert.equal(f.el('consent').hidden, true); f.click('approve'); assert.equal(f.calls.length, 0)
})
test('refresh never replays approval; backend handles already-finished transaction', async () => {
  const first = await fixture(); first.click('approve'); first.resolve({ data: { ok: true } }); await tick()
  const refreshed = await fixture(); assert.equal(refreshed.calls.length, 0); refreshed.click('approve'); refreshed.reject({ code: 'functions/failed-precondition' }); await tick()
  assert.match(refreshed.el('result-copy').textContent, /no longer valid/); assert.equal(refreshed.el('consent').hidden, true)
})
