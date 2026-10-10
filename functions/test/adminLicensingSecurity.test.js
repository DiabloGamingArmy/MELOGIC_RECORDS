const { test } = require('node:test')
const assert = require('node:assert/strict')
const { verifyLicensingAdmin } = require('../src/licensing/adminLicensingSecurity')
const { buildAdminClaims } = require('../src/admin/adminAuth')
test('A01 each privileged operation rejects normal, removed, disabled and stale administrators', async () => {
  const token = { ...buildAdminClaims('admin'), auth_time: Math.floor(Date.now() / 1000) }
  const request = { auth: { uid: 'staff', token }, data: { isAdmin: true, actorUid: 'owner' } }
  let user = { customClaims: token, disabled: false }, active = true, stepped = 0
  const deps = { auth: { getUser: async () => user }, db: { doc: () => ({ get: async () => ({ exists: true, data: () => ({ active }) }) }) }, requireStepUp: async r => { stepped++; return { uid: r.auth.uid } } }
  assert.equal((await verifyLicensingAdmin(request, false, deps)).uid, 'staff')
  await verifyLicensingAdmin(request, true, deps)
  assert.equal(stepped, 1)
  for (const mutate of [() => { user.disabled = true }, () => { user.customClaims = {} }, () => { active = false }, () => { user.tokensValidAfterTime = new Date(Date.now() + 2000).toISOString() }]) {
    user = { customClaims: token, disabled: false }; active = true; mutate()
    await assert.rejects(verifyLicensingAdmin(request, false, deps))
    await assert.rejects(verifyLicensingAdmin(request, true, deps))
  }
  await assert.rejects(verifyLicensingAdmin({ auth: { uid: 'user', token: {} }, data: { isAdmin: true } }, false, deps), { code: 'permission-denied' })
  await assert.rejects(verifyLicensingAdmin({}, false, deps), { code: 'unauthenticated' })
  deps.requireStepUp = async () => { throw Error('MFA required') }
  await assert.rejects(verifyLicensingAdmin(request, true, deps), /MFA required/)
})
