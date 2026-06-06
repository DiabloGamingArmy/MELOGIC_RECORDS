const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('node:crypto')
const { writeAccountEvent } = require('./accountEvents')

const CODE_COUNT = 5

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function recoveryRef(uid = '') {
  return admin.firestore().collection('users').doc(uid).collection('security').doc('recoveryCodes')
}

function assertUid(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

async function assertMfaEnabled(uid = '') {
  const user = await admin.auth().getUser(uid)
  const factors = user.multiFactor?.enrolledFactors || []
  if (!factors.length) {
    throw new HttpsError('failed-precondition', 'Enable authenticator-app 2FA before generating recovery codes.')
  }
  return user
}

function randomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  const bytes = crypto.randomBytes(8)
  let raw = ''
  for (let index = 0; index < 8; index += 1) raw += alphabet[bytes[index] % alphabet.length]
  return `MLG-${raw.slice(0, 4)}-${raw.slice(4)}`
}

function hashCode(uid = '', code = '', salt = '') {
  return crypto.createHash('sha256').update(`${uid}:${salt}:${String(code || '').toUpperCase()}`).digest('hex')
}

function serializeStatus(snap) {
  const data = snap.exists ? snap.data() || {} : {}
  const hashes = Array.isArray(data.codeHashes) ? data.codeHashes : []
  const remaining = hashes.filter((item) => item && item.used !== true).length
  return {
    ok: true,
    generated: data.enabled === true && hashes.length > 0,
    count: hashes.length,
    remaining,
    generatedAt: data.generatedAt?.toDate ? data.generatedAt.toDate().toISOString() : '',
    updatedAt: data.updatedAt?.toDate ? data.updatedAt.toDate().toISOString() : ''
  }
}

const getRecoveryCodeStatus = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = assertUid(request)
  const snap = await recoveryRef(uid).get()
  return serializeStatus(snap)
})

const generateRecoveryCodes = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = assertUid(request)
  await assertMfaEnabled(uid)
  const codes = Array.from({ length: CODE_COUNT }, () => randomCode())
  const codeHashes = codes.map((code) => {
    const salt = crypto.randomBytes(16).toString('hex')
    return {
      id: crypto.randomUUID(),
      salt,
      hash: hashCode(uid, code, salt),
      used: false,
      usedAt: null
    }
  })
  await recoveryRef(uid).set({
    enabled: true,
    count: CODE_COUNT,
    remaining: CODE_COUNT,
    codeHashes,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: false })
  await writeAccountEvent(admin.firestore(), uid, {
    type: 'recovery_codes_generated',
    severity: 'warning',
    title: 'Recovery codes generated',
    message: 'New recovery codes were generated for your account.',
    actorUid: uid,
    actorType: 'user',
    source: 'account-security',
    path: '/account/security',
    metadata: { count: CODE_COUNT }
  }).catch(() => {})
  return {
    ok: true,
    codes,
    count: CODE_COUNT,
    remaining: CODE_COUNT
  }
})

const useRecoveryCode = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = assertUid(request)
  const code = cleanString(request.data?.code || '', 40).toUpperCase()
  if (!/^MLG-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    throw new HttpsError('invalid-argument', 'Recovery code format is invalid.')
  }
  const ref = recoveryRef(uid)
  let accepted = false
  let remaining = 0
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('failed-precondition', 'No recovery codes have been generated.')
    const data = snap.data() || {}
    const codeHashes = Array.isArray(data.codeHashes) ? data.codeHashes : []
    const index = codeHashes.findIndex((item) => item?.used !== true && item.hash === hashCode(uid, code, item.salt || ''))
    if (index < 0) throw new HttpsError('permission-denied', 'Recovery code was not accepted.')
    codeHashes[index] = {
      ...codeHashes[index],
      used: true,
      usedAt: admin.firestore.Timestamp.now()
    }
    remaining = codeHashes.filter((item) => item?.used !== true).length
    tx.set(ref, {
      codeHashes,
      remaining,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
    accepted = true
  })
  return { ok: accepted, remaining }
})

module.exports = {
  generateRecoveryCodes,
  getRecoveryCodeStatus,
  useRecoveryCode
}
