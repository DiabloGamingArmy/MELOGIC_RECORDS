const { test } = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

test('deployed callable handlers resolve owner/admin roles without migrated booleans; full licensing UI operations', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const app = admin.initializeApp({ projectId: 'melogic-licensing-owner-hotfix-test' })
  const db = admin.firestore()
  let staffClaims = { admin: true, adminRole: 'owner' }, disabled = false
  // Test-only Auth fixture. Real production handlers and MFA permission helper
  // run unchanged against a real Firestore emulator, never production accounts.
  Object.defineProperty(admin, 'auth', { configurable: true, value: () => ({ getUser: async uid => ({ uid, customClaims: uid === 'staff' ? staffClaims : {}, disabled, emailVerified: true, multiFactor: { enrolledFactors: [{ uid: 'fixture-factor', factorId: 'totp' }] } }) }) })
  const endpoints = require('../src/licensing/adminLicensing')
  const { origamiLicensingCore } = require('../src/desktop/origamiLicensingCore')
  const origami = origamiLicensingCore({ db })
  const run = (name, data = {}) => endpoints[name].run({ auth: { uid: 'staff', token: { ...staffClaims, auth_time: Math.floor(Date.now() / 1000) } }, data })
  try {
    assert.deepEqual(await run('listLicensingProducts'), [])
    for (const role of ['owner', 'admin', 'assigned-support']) {
      staffClaims = role === 'assigned-support' ? { admin: true, adminRole: 'support', licensesManage: true } : { admin: true, adminRole: role }
      await run('saveLicensingProduct', { productId: 'origami', name: 'Origami', status: 'beta', editions: ['beta'] })
      assert.equal((await run('listLicensingProducts'))[0].productId, 'origami')
      const uid = `tester-${role}`
      const data = { targetUid: uid, productId: 'origami', edition: 'beta', reason: 'Emulator-only grant' }
      await run('grantProductEntitlement', data)
      assert.equal((await run('getAdminProductAccess', { targetUid: uid })).entitlements[0].status, 'active')
      assert.equal((await origami.authorization(uid)).authorized, true)
      await run('revokeProductEntitlement', data)
      assert.equal((await origami.authorization(uid)).authorized, false)
      await run('grantProductEntitlement', data)
      assert.equal((await origami.authorization(uid)).authorized, true)
      const { keys: [key] } = await run('generateLicenseKeys', { productId: 'origami', edition: 'beta', quantity: 1, maxRedemptions: 1 })
      assert.equal((await origami.redeem({ key }, `redeemer-${role}`)).authorized, true)
      const page = await run('listLicenseKeys')
      const managed = page.keys.find(k => k.status === 'redeemed' && !k.done)
      await run('revokeLicenseKey', { managementId: managed.managementId, reason: 'Emulator revoke' })
      assert.equal((await origami.authorization(`redeemer-${role}`)).authorized, true)
    }
    for (const claims of [{ admin: true, adminRole: 'support' }, { admin: true, adminRole: 'support', settingsManage: true }, {}, { licensesManage: true }]) {
      staffClaims = claims
      for (const name of Object.keys(endpoints)) await assert.rejects(run(name), { code: 'permission-denied' })
    }
    staffClaims = { admin: true, adminRole: 'owner' }; disabled = true
    for (const name of Object.keys(endpoints)) await assert.rejects(run(name), { code: 'permission-denied' })
    disabled = false
    await db.doc('adminUsers/staff').set({ active: false })
    for (const name of Object.keys(endpoints)) await assert.rejects(run(name), { code: 'permission-denied' })
  } finally { delete admin.auth; await db.terminate(); await app.delete() }
})
