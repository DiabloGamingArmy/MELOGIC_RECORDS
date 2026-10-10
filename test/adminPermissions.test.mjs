import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { runInNewContext } from 'node:vm'
import { hasAdminPermission, permissionDeniedMarkup } from '../src/utils/adminPermissions.js'
const require = createRequire(import.meta.url)
const registry = require('../functions/src/admin/adminPermissions.json')
const { getRequesterClaims, buildAdminClaims, mergeAdminClaims, assertPermission } = require('../functions/src/admin/adminAuth')
test('canonical frontend/backend parity, owner implicit capabilities and claim lifecycle', () => {
  const tokens = [{ admin: true, adminRole: 'owner' }, { admin: true, adminRole: 'admin' }, ...['support','listingEditor','auditor','marketplaceReviewer'].map(adminRole => ({ admin: true, adminRole })), { admin: true, adminRole: 'support', licensesManage: true }, { admin: true, adminRole: 'support', settingsManage: true }, {}, { adminRole: 'owner' }, { licensesManage: true }]
  for (const token of tokens) {
    const backend = getRequesterClaims({ auth: { uid: 'fixture', token } })
    for (const permission of registry.permissions) assert.equal(hasAdminPermission(token, permission), backend.admin === true && backend[permission] === true, `${JSON.stringify(token)} ${permission}`)
  }
  for (const permission of registry.permissions) assert.equal(hasAdminPermission({ admin: true, adminRole: 'owner' }, permission), true)
  assert.equal(buildAdminClaims('owner').licensesManage, true)
  assert.equal(buildAdminClaims('admin').licensesManage, true)
  assert.equal(buildAdminClaims('support').licensesManage, false)
  assert.equal(hasAdminPermission({ admin: true, adminRole: 'support', settingsManage: true }, 'licensesManage'), false)
  assert.equal(hasAdminPermission({ admin: true, adminRole: 'support', licensesManage: true }, 'licensesManage'), true)
  assert.equal(Object.hasOwn(mergeAdminClaims({ ...buildAdminClaims('owner') }, 'remove'), 'licensesManage'), false)
  assert.throws(() => assertPermission({ auth: { uid: 'user', token: {} } }, 'licensesManage'), { code: 'permission-denied' })
})
test('actual frontend route guard resolves legacy owner token and denies restricted identities', async () => {
  const source = await readFile(new URL('../src/admin.js', import.meta.url), 'utf8')
  const canSource = source.slice(source.indexOf("function can(permission = 'admin')"), source.indexOf('\nfunction isReviewPath'))
  for (const [claims, expected] of [[{admin:true,adminRole:'owner'},true],[{admin:true,adminRole:'admin'},true],[{admin:true,adminRole:'support',licensesManage:true},true],[{admin:true,adminRole:'support'},false],[{},false],[{admin:false,adminRole:'owner'},false]]) {
    const can = runInNewContext(`${canSource}; can`, { state: { claims }, hasAdminPermission })
    assert.equal(can('licensesManage'), expected)
  }
  assert.match(source, /key: 'licenseKeys'.*permission: 'licensesManage'/)
  assert.match(source, /renderLayout\(can\('licensesManage'\)/)
  assert.match(source, /data-admin-manage-products=.*can\('licensesManage'\)/)
  assert.match(source, /allowed: can\('licensesManage'\)/)
})
test('generic denied message separates heading and human explanation without internal permission IDs', () => {
  const html = permissionDeniedMarkup('licensesManage')
  assert.match(html, /<strong>Permission required<\/strong><p>You do not have permission to manage licenses and product access\.<\/p>/)
  assert.equal(html.includes('licensesManage'), false)
  assert.equal(permissionDeniedMarkup('<script>').includes('<script>'), false)
})
