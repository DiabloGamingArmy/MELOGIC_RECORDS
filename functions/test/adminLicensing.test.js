const { test } = require('node:test')
const assert = require('node:assert/strict')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { adminLicensingCore } = require('../src/licensing/adminLicensingCore')
const { origamiLicensingCore, keyDigest } = require('../src/desktop/origamiLicensingCore')

test('A01 full licensing lifecycle and transaction safety', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async t => {
  const app = initializeApp({ projectId: 'melogic-a01-test' }, 'a01')
  const db = getFirestore(app), actor = { uid: 'staff', adminRole: 'admin' }
  let now = Date.now()
  const auth = { getUser: async uid => { if (uid === 'missing') throw Error('missing'); return { uid } } }
  const admin = adminLicensingCore({ db, auth, now: () => now }), origami = origamiLicensingCore({ db, now: () => now })
  const product = { productId: 'origami', name: 'Origami', status: 'beta', editions: ['beta'] }
  const grant = { targetUid: 'user-a', productId: 'origami', edition: 'beta', reason: 'Fixture grant' }
  const generate = { productId: 'origami', edition: 'beta', quantity: 1, maxRedemptions: 1, campaign: 'Emulator only' }
  try {
    await db.doc('products/origami').set({ name: 'Origami', status: 'beta' })
    await admin.saveProduct(product, actor)
    await t.test('generate → existing redeem → authorize → revoke → unauthorized → grant → authorize', async () => {
      const { keys } = await admin.generate(generate, actor), key = keys[0]
      assert.match(key, /^MELOGIC-[a-f0-9]{64}$/)
      const stored = (await db.doc(`licenseKeys/${keyDigest(key)}`).get()).data()
      assert.equal(stored.redemptionCount, 0)
      assert.equal(JSON.stringify(stored).includes(key), false)
      assert.equal((await origami.redeem({ key: ` ${key}\n` }, 'user-a')).authorized, true)
      assert.equal((await origami.redeem({ key }, 'user-a')).authorized, true)
      const ref = db.doc('users/user-a/entitlements/origami'), original = (await ref.get()).data()
      assert.equal(original.source, 'license_key')
      assert.equal(original.redeemedKeyId, stored.managementId)
      await admin.changeAccess(grant, actor, true)
      const revoked = (await ref.get()).data()
      assert.equal(revoked.status, 'revoked')
      assert.equal(revoked.source, original.source)
      assert.equal(revoked.createdAt.toMillis(), original.createdAt.toMillis())
      assert.equal((await origami.authorization('user-a')).authorized, false)
      await assert.rejects(origami.redeem({ key }, 'user-a'), { code: 'permission-denied' })
      assert.equal((await admin.changeAccess(grant, actor, true)).unchanged, true)
      await admin.changeAccess(grant, actor)
      assert.equal((await origami.authorization('user-a')).authorized, true)
      assert.equal((await ref.get()).data().generation, 2)
      const duplicates = await Promise.all([admin.changeAccess(grant, actor), admin.changeAccess(grant, actor)])
      assert.equal(duplicates.every(r => r.unchanged), true)
      assert.equal((await ref.get()).data().generation, 2)
      assert.equal((await db.collection('users/user-a/entitlements').get()).size, 1)
      await admin.revokeKey({ managementId: stored.managementId, reason: 'No further redemption' }, actor)
      assert.equal((await origami.authorization('user-a')).authorized, true)
    })
    await t.test('invalid product/edition/expiration, absent target and bounds', async () => {
      for (const value of [{ productId: 'missing-product' }, { edition: 'unsafe' }, { expiresAt: new Date(now - 1).toISOString() }, { targetUid: 'missing' }, { targetUid: '../bad' }]) await assert.rejects(admin.changeAccess({ ...grant, ...value }, actor))
      for (const value of [{ quantity: 101 }, { quantity: 0 }, { maxRedemptions: 0 }, { maxRedemptions: 1001 }, { edition: 'standard' }]) await assert.rejects(admin.generate({ ...generate, ...value }, actor))
    })
    await t.test('batch entropy/uniqueness, masked listing and no plaintext in database/audit', async () => {
      const { keys } = await admin.generate({ ...generate, quantity: 100 }, actor)
      assert.equal(new Set(keys).size, 100)
      for (const key of keys) assert.equal(Buffer.from(key.slice(8), 'hex').length, 32)
      const first = await admin.listKeys(), second = await admin.listKeys({ cursor: first.cursor })
      assert.equal(first.keys.length, 50)
      assert.equal(second.keys.length, 50)
      assert.equal(new Set([...first.keys, ...second.keys].map(k => k.managementId)).size, 100)
      assert.match(first.cursor, /^[a-f0-9-]{36}$/)
      const stored = JSON.stringify((await db.collection('licenseKeys').get()).docs.map(d => d.data()))
      const audit = JSON.stringify((await db.collection('adminLogs').get()).docs.map(d => d.data()))
      for (const key of keys) { assert.equal(stored.includes(key), false); assert.equal(audit.includes(key), false) }
      assert.equal(JSON.stringify(first).includes(keyDigest(keys[0])), false)
    })
    await t.test('two users, one capacity; same user retry; revocation race serializes', async () => {
      const { keys: [key] } = await admin.generate(generate, actor)
      const results = await Promise.allSettled(['race-a', 'race-b'].map(uid => origami.redeem({ key }, uid)))
      assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
      assert.equal((await db.doc(`licenseKeys/${keyDigest(key)}`).get()).data().redemptionCount, 1)
      const winner = results[0].status === 'fulfilled' ? 'race-a' : 'race-b'
      assert.equal((await origami.redeem({ key }, winner)).authorized, true)
      const { keys: [racing] } = await admin.generate(generate, actor)
      const stored = (await db.doc(`licenseKeys/${keyDigest(racing)}`).get()).data()
      await Promise.allSettled([origami.redeem({ key: racing }, 'race-revoked'), admin.revokeKey({ managementId: stored.managementId, reason: 'Concurrent revoke' }, actor)])
      assert.equal((await db.doc(`licenseKeys/${keyDigest(racing)}`).get()).data().status, 'revoked')
      await assert.rejects(origami.redeem({ key: racing }, 'future-user'), { code: 'permission-denied' })
      // Concurrent validation can see either serial ordering; every post-revoke
      // validation must close authorization. Existing RAM leases remain <=15m.
      await Promise.all([origami.authorization('user-a'), admin.changeAccess(grant, actor, true)])
      assert.equal((await origami.authorization('user-a')).authorized, false)
    })
    await t.test('expired/revoked/wrong product/edition keys and disabled product reject', async () => {
      await admin.changeAccess({ ...grant, targetUid: 'expiry-admin', expiresAt: new Date(now + 1000).toISOString() }, actor)
      assert.equal((await origami.authorization('expiry-admin')).authorized, true)
      now += 1001
      assert.equal((await origami.authorization('expiry-admin')).authorized, false)
      assert.equal((await admin.access('expiry-admin')).entitlements[0].status, 'expired')
      for (const patch of [{ expiresAt: new Date(now - 1) }, { status: 'revoked' }, { productId: 'soura' }, { edition: 'standard' }]) {
        const { keys: [key] } = await admin.generate(generate, actor)
        await db.doc(`licenseKeys/${keyDigest(key)}`).update(patch)
        await assert.rejects(origami.redeem({ key }, 'invalid-key-user'))
      }
      await admin.saveProduct({ ...product, status: 'disabled' }, actor)
      await assert.rejects(admin.generate(generate, actor))
      await admin.saveProduct(product, actor)
      const { keys: [key] } = await admin.generate({ ...generate, maxRedemptions: 2 }, actor)
      await origami.redeem({ key }, 'multi-a')
      const stored = (await db.doc(`licenseKeys/${keyDigest(key)}`).get()).data()
      const { keyState } = require('../src/licensing/adminLicensingCore')
      assert.equal(keyState(stored), 'partially_redeemed')
      await origami.redeem({ key }, 'multi-b')
      assert.equal(keyState((await db.doc(`licenseKeys/${keyDigest(key)}`).get()).data()), 'redeemed')
      await assert.rejects(origami.redeem({ key }, 'multi-c'), { code: 'resource-exhausted' })
    })
  } finally { await db.terminate(); await deleteApp(app) }
})
