const { createHash, timingSafeEqual } = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')

const hashProof = (proof) => createHash('sha256').update(proof).digest('base64url')
const fail = (code, message) => { throw new HttpsError(code, message) }
function requestId(data) {
  if (!/^[a-f0-9]{64}$/.test(data?.requestId || '')) fail('invalid-argument', 'Invalid login request.')
  return data.requestId
}

// Firebase remains the account authority. This is a one-time browser-to-desktop
// rendezvous, not another identity provider or entitlement issuer.
function desktopAuthCore({ db, auth, now = Date.now }) {
  async function throttle(ip, operation) {
    const bucket = Math.floor(now() / 60000)
    const digest = createHash('sha256').update(`${operation}:${bucket}:${String(ip || 'unknown').slice(0, 200)}`).digest('hex')
    const ref = db.doc(`desktopAuthRateLimits/${digest}`)
    await db.runTransaction(async tx => {
      const snap = await tx.get(ref)
      const count = Number(snap.data()?.count || 0)
      if (count >= (operation === 'begin' ? 20 : 240)) fail('resource-exhausted', 'Try again later.')
      tx.set(ref, { count: count + 1, expiresAt: new Date(now() + 120000) })
    })
  }
  function valid(snap) {
    const value = snap.data()
    if (!snap.exists || !value || value.expiresAt.toMillis() <= now()) fail('deadline-exceeded', 'Login expired. Start again in Origami.')
    return value
  }
  return {
    async begin(data, ip) {
      const id = requestId(data)
      if (!/^[A-Za-z0-9_-]{43}$/.test(data?.challenge || '')) fail('invalid-argument', 'Invalid login challenge.')
      await throttle(ip, 'begin')
      const ref = db.doc(`desktopAuthRequests/${id}`)
      const expiresAt = now() + 300000
      await db.runTransaction(async tx => {
        if ((await tx.get(ref)).exists) fail('already-exists', 'Start a new login request.')
        tx.create(ref, { challenge: data.challenge, status: 'pending', expiresAt: new Date(expiresAt) })
      })
      return { requestId: id, expiresAt }
    },
    async approve(data, uid) {
      if (!uid) fail('unauthenticated', 'Sign in to Melogic first.')
      const id = requestId(data)
      if (typeof data.approve !== 'boolean') fail('invalid-argument', 'Confirm or cancel this request.')
      const user = await auth.getUser(uid)
      if (user.disabled) fail('permission-denied', 'Account unavailable.')
      const ref = db.doc(`desktopAuthRequests/${id}`)
      await db.runTransaction(async tx => {
        const value = valid(await tx.get(ref))
        if (value.status !== 'pending') fail('failed-precondition', 'Login request already handled.')
        tx.update(ref, { status: data.approve ? 'approved' : 'cancelled', uid })
      })
      return { ok: true }
    },
    async poll(data, ip) {
      const id = requestId(data)
      if (!/^[A-Za-z0-9_-]{43,128}$/.test(data?.verifier || '')) fail('invalid-argument', 'Invalid login proof.')
      await throttle(ip, 'poll')
      const ref = db.doc(`desktopAuthRequests/${id}`)
      const result = await db.runTransaction(async tx => {
        const value = valid(await tx.get(ref))
        const actual = Buffer.from(hashProof(data.verifier))
        const expected = Buffer.from(value.challenge)
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) fail('permission-denied', 'Login proof mismatch.')
        if (value.status === 'approved') {
          // Claim before issuing. A lost response requires a new login; it can
          // never replay a previously issued Firebase custom token.
          tx.update(ref, { status: 'consumed' })
          return { status: 'approved', uid: value.uid }
        }
        return { status: value.status }
      })
      if (result.status !== 'approved') return { requestId: id, status: result.status }
      const user = await auth.getUser(result.uid)
      if (user.disabled) fail('permission-denied', 'Account unavailable.')
      return { requestId: id, status: 'approved', customToken: await auth.createCustomToken(user.uid) }
    }
  }
}
module.exports = { desktopAuthCore, hashProof }
