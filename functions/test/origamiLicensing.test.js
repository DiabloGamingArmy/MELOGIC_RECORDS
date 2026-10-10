const { test } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { origamiLicensingCore, keyDigest } = require('../src/desktop/origamiLicensingCore')

test('license input is opaque, bounded and trimmed without changing identity', () => {
  const key = randomBytes(32).toString('hex')
  assert.equal(keyDigest(`  ${key}\n`), keyDigest(key))
  assert.notEqual(keyDigest(key.toUpperCase()), keyDigest(key))
  for (const raw of ['', 'short', null, 'x'.repeat(257), 'x'.repeat(32) + '\ninside']) assert.throws(() => keyDigest(raw), { code: 'invalid-argument' })
})
test('L01.1 entitlement and redemption transactions', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'melogic-records-license-test' }, 'l011-license-tests')
  const db = getFirestore(app)
  let time = Date.now()
  const core = origamiLicensingCore({ db, now: () => time })
  const seed = async overrides => {
    const key = randomBytes(32).toString('hex')
    const ref = db.doc(`licenseKeys/${keyDigest(key)}`)
    await ref.set({ productId: 'origami', edition: 'beta', status: 'active', maxRedemptions: 1, redemptionCount: 0, ...overrides })
    return { key, ref }
  }
  try {
    await t.test('authentication alone does not authorize; no anonymous key grant', async () => {
      assert.equal((await core.authorization('unlicensed')).authorized, false)
      await assert.rejects(core.authorization(''), { code: 'unauthenticated' })
      await assert.rejects(core.redeem({ key: randomBytes(32).toString('hex') }, ''), { code: 'unauthenticated' })
    })
    await t.test('invalid, wrong product/edition, expired, revoked, corrupt capacity fail closed', async () => {
      await assert.rejects(core.redeem({ key: randomBytes(32).toString('hex') }, 'invalid'), { code: 'not-found' })
      for (const [value, code] of [[{ productId: 'soura' }, 'failed-precondition'], [{ edition: 'commercial-unknown' }, 'failed-precondition'], [{ expiresAt: new Date(time - 1) }, 'deadline-exceeded'], [{ status: 'revoked' }, 'permission-denied'], [{ redemptionCount: -1 }, 'failed-precondition'], [{ entitlementExpiresAt: new Date(time - 1) }, 'failed-precondition']]) {
        const { key, ref } = await seed(value)
        await assert.rejects(core.redeem({ key }, 'rejected'), { code })
        assert.equal((await ref.get()).data().redemptionCount, value.redemptionCount ?? 0)
      }
    })
    await t.test('concurrent redemption admits one UID; retry idempotent; no raw key stored', async () => {
      const { key, ref } = await seed()
      const results = await Promise.allSettled(['owner-a', 'owner-b'].map(uid => core.redeem({ key }, uid)))
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.equal(results.find(r => r.status === 'rejected').reason.code, 'resource-exhausted')
      const owner = results[0].status === 'fulfilled' ? 'owner-a' : 'owner-b'
      assert.equal((await core.redeem({ key }, owner)).authorized, true)
      assert.equal((await ref.get()).data().redemptionCount, 1)
      const doc = (await ref.get()).data()
      assert.equal(Object.hasOwn(doc, 'key'), false)
      assert.equal((await core.authorization(owner)).edition, 'beta')
      await db.doc(`users/${owner}/entitlements/origami`).update({ status: 'revoked' })
      await assert.rejects(core.redeem({ key }, owner), { code: 'permission-denied' })
      assert.equal((await core.authorization(owner)).authorized, false)
    })
    await t.test('expiry, wrong product and absent edition close authorization', async () => {
      const ref = db.doc('users/expiry/entitlements/origami')
      await ref.set({ productId: 'origami', edition: 'beta', status: 'active', expiresAt: new Date(time + 1000) })
      assert.equal((await core.authorization('expiry')).validUntil, time + 1000)
      time += 1001
      assert.equal((await core.authorization('expiry')).authorized, false)
      await ref.set({ productId: 'origami', status: 'active' })
      assert.equal((await core.authorization('expiry')).authorized, false)
      await ref.set({ productId: 'soura', edition: 'beta', status: 'active' })
      assert.equal((await core.authorization('expiry')).authorized, false)
    })
  } finally { await db.terminate(); await deleteApp(app) }
})
