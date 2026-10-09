import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { mountLicensingPanel } from '../src/admin/licensingPanel.js'
const tick = () => new Promise(resolve => setTimeout(resolve, 0))
function fixture(targetUid = '', allowed = true, products = [{ productId: 'origami', name: 'Origami', status: 'beta', editions: ['beta'] }]) {
  const dom = new JSDOM('<main></main>', { url: 'https://test.invalid/admin/license-keys' })
  // FormData must use this DOM's form implementation.
  const saved = globalThis.FormData; globalThis.FormData = dom.window.FormData
  let entitlement = null, keys = [], copies = [], calls = [], failNext = false
  Object.defineProperty(dom.window.navigator, 'clipboard', { value: { writeText: async text => copies.push(text) } })
  const request = async (name, data = {}) => {
    calls.push({ name, data })
    if (failNext) { failNext = false; throw Error('Backend unavailable') }
    if (name === 'listLicensingProducts') return products
    if (name === 'getAdminProductAccess') return { products, entitlements: entitlement ? [entitlement] : [] }
    if (name === 'listLicenseKeys') return { keys, cursor: '' }
    if (name === 'grantProductEntitlement') entitlement = { productId: data.productId, edition: data.edition, status: 'active', source: 'admin', grantedAt: '2026-10-09' }
    if (name === 'revokeProductEntitlement') entitlement = { ...entitlement, status: 'revoked', revocationReason: data.reason }
    if (name === 'generateLicenseKeys') { keys = [{ managementId: 'safe-id', maskedKey: '••••-MASK', productId: 'origami', edition: 'beta', status: 'available', redemptionCount: 0, maxRedemptions: 1 }]; return { keys: ['synthetic-key-for-ui-only'] } }
    if (name === 'revokeLicenseKey') keys = keys.map(k => ({ ...k, status: 'revoked' }))
    return { ok: true }
  }
  const root = dom.window.document.querySelector('main'), panel = mountLicensingPanel(root, { request, allowed, targetUid })
  const click = action => dom.window.document.querySelector(`[data-license-action="${action}"]`).click()
  const submit = () => { const form = dom.window.document.querySelector('dialog form'); form.dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })) }
  return { dom, root, panel, calls, copies, click, submit, fail: () => { failNext = true }, close: () => { panel.dispose(); dom.window.close(); globalThis.FormData = saved } }
}
test('Manage Products grants, confirms revocation, preserves errors and re-grants', async () => {
  const f = fixture('user-a')
  try {
    await f.panel.ready
    assert.match(f.root.textContent, /NO ACCESS/)
    f.click('grant')
    assert.equal(f.dom.window.document.querySelector('[name="edition"]').value, 'beta')
    f.dom.window.document.querySelector('[name="reason"]').value = 'Beta tester'
    f.submit(); await tick(); await tick()
    assert.match(f.root.textContent, /active/)
    f.click('revoke-access')
    assert.match(f.dom.window.document.querySelector('dialog').textContent, /up to 15 minutes/)
    assert.equal(f.calls.filter(c => c.name === 'revokeProductEntitlement').length, 0)
    f.click('cancel')
    assert.equal(f.calls.filter(c => c.name === 'revokeProductEntitlement').length, 0)
    f.click('revoke-access'); f.dom.window.document.querySelector('[name="reason"]').value = 'End of test'
    f.fail(); f.submit(); await tick()
    assert.match(f.dom.window.document.querySelector('[data-license-error]').textContent, /Backend unavailable/)
    f.submit(); await tick(); await tick()
    assert.match(f.root.textContent, /revoked/)
    f.click('grant'); f.dom.window.document.querySelector('[name="reason"]').value = 'Re-grant'
    f.submit(); await tick(); await tick()
    assert.match(f.root.textContent, /active/)
  } finally { f.close() }
})
test('License Keys generation displays once, Copy All, masked history and confirmed revoke', async () => {
  const f = fixture()
  try {
    await f.panel.ready
    f.click('generate')
    assert.equal(f.dom.window.document.querySelector('[name="quantity"]').max, '100')
    f.submit(); await tick(); await tick()
    assert.match(f.dom.window.document.querySelector('dialog').textContent, /only be shown once/)
    f.click('copy'); await tick()
    assert.deepEqual(f.copies, ['synthetic-key-for-ui-only'])
    f.click('cancel')
    assert.equal(f.dom.window.document.querySelector('textarea'), null)
    assert.equal(f.root.textContent.includes('synthetic-key-for-ui-only'), false)
    assert.match(f.root.textContent, /MASK/)
    f.click('revoke-key')
    assert.equal(f.calls.filter(c => c.name === 'revokeLicenseKey').length, 0)
    f.dom.window.document.querySelector('[name="reason"]').value = 'Cancel invitation'
    f.submit(); await tick(); await tick()
    assert.match(f.root.textContent, /revoked/)
    f.click('product')
    f.dom.window.document.querySelector('[name="name"]').value = 'Origami'
    f.submit(); await tick(); await tick()
    assert.equal(f.calls.filter(c => c.name === 'saveLicensingProduct').length, 1)
  } finally { f.close() }
})
test('unauthorized admin panel makes no API calls; backend errors are visible', async () => {
  const f = fixture('', false)
  try { await f.panel.ready; assert.match(f.root.textContent, /permission required/); assert.equal(f.calls.length, 0) } finally { f.close() }
  const g = fixture()
  try { await g.panel.ready; g.fail(); g.click('refresh'); await tick(); assert.match(g.root.textContent, /Backend unavailable/) } finally { g.close() }
})

test('existing Users context menu adds Manage Products and preserves existing actions', async () => {
  const { readFile } = await import('node:fs/promises')
  const { runInNewContext } = await import('node:vm')
  const source = await readFile(new URL('../src/admin.js', import.meta.url), 'utf8')
  const start = source.indexOf('function renderAccountActionMenu(')
  const end = source.indexOf('\nfunction permissionToggle', start)
  const menu = runInNewContext(`${source.slice(start, end)}; renderAccountActionMenu`, { state: { accountActionsMenuUid: 'user-a' }, escapeHtml: String, iconSvg: () => '', can: () => true })
  const dom = new JSDOM(menu({ uid: 'user-a', user: {}, publicProfile: '/', canGrantProduct: true }))
  assert.equal(dom.window.document.querySelector('[data-admin-manage-products]').textContent, 'Manage Products')
  for (const selector of ['data-admin-give-product', 'data-admin-message-user', 'data-admin-account-permissions', 'data-admin-note-user']) assert.ok(dom.window.document.querySelector(`[${selector}]`))
  assert.equal(dom.window.document.querySelector('[role="menu"]').hidden, false)
  assert.match(source, /route: '\/admin\/license-keys', label: 'License Keys'/)
  dom.window.close()
})

test('empty canonical catalog is a setup state, independent of admin authorization', async () => {
  const f = fixture('', true, [])
  try {
    await f.panel.ready
    assert.match(f.root.textContent, /No products configured/)
    assert.equal(f.root.textContent.includes('Permission required'), false)
    assert.equal(f.dom.window.document.querySelector('[data-license-action="generate"]').disabled, true)
    f.click('product')
    assert.equal(f.dom.window.document.querySelector('[name="productId"]').value, 'origami')
    assert.equal(f.dom.window.document.querySelector('[name="editions"]').value, 'beta')
  } finally { f.close() }
})

test('legacy owner claims reach functional key generation and user access controls', async () => {
  const { hasAdminPermission } = await import('../src/utils/adminPermissions.js')
  const allowed = hasAdminPermission({ admin: true, adminRole: 'owner' }, 'licensesManage')
  const keys = fixture('', allowed)
  try {
    await keys.panel.ready
    keys.click('generate')
    for (const name of ['productId','edition','quantity','maxRedemptions','expiresAt','campaign']) assert.ok(keys.dom.window.document.querySelector(`[name="${name}"]`))
    keys.click('cancel')
  } finally { keys.close() }
  const access = fixture('fixture-user', allowed)
  try {
    await access.panel.ready
    access.click('grant')
    access.dom.window.document.querySelector('[name="reason"]').value = 'Owner regression'
    access.submit(); await tick(); await tick()
    assert.match(access.root.textContent, /active/)
    access.click('revoke-access')
    access.dom.window.document.querySelector('[name="reason"]').value = 'Owner revocation'
    access.submit(); await tick(); await tick()
    assert.match(access.root.textContent, /revoked/)
    access.click('grant')
    access.dom.window.document.querySelector('[name="reason"]').value = 'Owner re-grant'
    access.submit(); await tick(); await tick()
    assert.match(access.root.textContent, /active/)
  } finally { access.close() }
})
