const { test, after } = require('node:test')
const assert = require('node:assert/strict')
const { randomBytes } = require('node:crypto')
const { desktopAuthCore, hashProof } = require('../src/desktop/desktopAuthCore')

test('S256 challenge uses the RFC 7636 vector', () => {
  assert.equal(hashProof('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'), 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
})
test('desktop grants reject malformed requests before IO', async () => {
  const c = desktopAuthCore({ db: {}, auth: {} })
  await assert.rejects(c.begin({ requestId: '../invalid' }), { code: 'invalid-argument' })
  await assert.rejects(c.approve({}, ''), { code: 'unauthenticated' })
  await assert.rejects(c.poll({ requestId: 'a'.repeat(64), verifier: 'bad' }), { code: 'invalid-argument' })
})

test('Firestore transactions bind proof, UID, expiry and one-time issuance', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'melogic-records-desktop-test' }, 'l01-desktop-tests')
  const db = getFirestore(app)
  let time = Date.now(), disabled = false, revokedAfter = null, issued = 0
  const auth = {
    async getUser(uid) { return { uid, disabled, tokensValidAfterTime: revokedAfter } },
    async createCustomToken(uid) { issued++; return `fixture-only-custom-token-${uid}` }
  }
  const c = desktopAuthCore({ db, auth, now: () => time })
  const begin = async () => {
    const requestId = randomBytes(32).toString('hex')
    const verifier = randomBytes(32).toString('base64url')
    await c.begin({ requestId, challenge: hashProof(verifier) }, 'test-client')
    return { requestId, verifier }
  }
  try {
    const req = await begin()
    assert.equal((await c.poll(req, 'test-client')).status, 'pending')
    await assert.rejects(c.poll({ ...req, verifier: 'b'.repeat(43) }, 'test-client'), { code: 'permission-denied' })
    await c.approve({ requestId: req.requestId, approve: true, uid: 'injected' }, 'verified-uid')
    await assert.rejects(c.approve({ requestId: req.requestId, approve: true }, 'other'), { code: 'failed-precondition' })
    const responses = await Promise.all([c.poll(req, 'test-client'), c.poll(req, 'test-client')])
    assert.equal(responses.filter(r => r.customToken).length, 1)
    assert.equal(responses.find(r => r.customToken).customToken, 'fixture-only-custom-token-verified-uid')
    assert.equal(issued, 1)
    assert.equal((await c.poll(req, 'test-client')).status, 'consumed')
    const expired = await begin();time += 300001
    await assert.rejects(c.poll(expired, 'test-client'), { code: 'deadline-exceeded' })
    const denied = await begin();await c.approve({ requestId: denied.requestId, approve: false }, 'verified-uid')
    assert.equal((await c.poll(denied, 'test-client')).status, 'cancelled')
    const revoked = await begin();disabled = true
    await assert.rejects(c.approve({ requestId: revoked.requestId, approve: true }, 'verified-uid'), { code: 'permission-denied' })
    disabled = false;await c.approve({ requestId: revoked.requestId, approve: true }, 'verified-uid');disabled = true
    await assert.rejects(c.poll(revoked, 'test-client'), { code: 'permission-denied' })
    assert.equal(issued, 1)
    disabled = false
    const revokedGrant = await begin()
    await c.approve({ requestId: revokedGrant.requestId, approve: true }, 'verified-uid', Math.floor(time / 1000) - 10)
    revokedAfter = new Date(time).toISOString()
    await assert.rejects(c.poll(revokedGrant, 'test-client'), { code: 'permission-denied' })
    assert.equal(issued, 1)
    revokedAfter = null
    const settled = []
    for (let i = 0; i < 21; i++) {
      try { await c.begin({ requestId: randomBytes(32).toString('hex'), challenge: hashProof('x'.repeat(43)) }, 'rate-limit-client'); settled.push({ status: 'fulfilled' }) }
      catch (reason) { settled.push({ status: 'rejected', reason }) }
    }
    assert.equal(settled.filter(r => r.status === 'fulfilled').length, 20)
    assert.equal(settled.find(r => r.status === 'rejected').reason.code, 'resource-exhausted')
    for (let i = 0; i < 20; i++) await c.throttle('redeem-limit-client', 'redeem')
    await assert.rejects(c.throttle('redeem-limit-client', 'redeem'), { code: 'aborted' }) // never misreported as an already-used key
  } finally {
    await db.terminate();await deleteApp(app)
  }
})
