const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertAnyPermission, cleanString } = require('../admin/adminAuth')
const { mergeSettings } = require('../admin/adminSettingsShared')

const VALID_STATUSES = new Set(['not_started', 'pending', 'verified', 'rejected', 'expired'])
const REQUIRED_FOR = ['marketplace_product_creation']

function db() {
  return admin.firestore()
}

function ageVerificationRef(uid = '') {
  return db().collection('users').doc(uid).collection('creatorCompliance').doc('ageVerification')
}

function serializeDate(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

async function isCreatorAgeVerificationRequired() {
  try {
    const snap = await db().collection('platformConfig').doc('current').get()
    const settings = mergeSettings(snap.exists ? snap.data() || {} : {})
    return settings.marketplace?.marketplaceCreatorAgeVerificationRequired !== false
  } catch {
    return true
  }
}

function serializeVerification(raw = {}, required = true) {
  const status = VALID_STATUSES.has(cleanString(raw.status || '', 40)) ? cleanString(raw.status || '', 40) : 'not_started'
  return {
    required: required !== false,
    status,
    provider: cleanString(raw.provider || 'manual_foundation', 80),
    requiredFor: Array.isArray(raw.requiredFor) ? raw.requiredFor.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 8) : REQUIRED_FOR,
    startedAt: serializeDate(raw.startedAt),
    updatedAt: serializeDate(raw.updatedAt),
    verifiedAt: serializeDate(raw.verifiedAt),
    rejectedAt: serializeDate(raw.rejectedAt),
    expiredAt: serializeDate(raw.expiredAt),
    reviewedBy: cleanString(raw.reviewedBy || '', 180),
    rejectionReason: cleanString(raw.rejectionReason || '', 600),
    providerSessionId: cleanString(raw.providerSessionId || '', 180),
    placeholder: raw.placeholder !== false
  }
}

async function loadCreatorAgeVerification(uid = '') {
  const cleanUid = cleanString(uid, 180)
  if (!cleanUid || cleanUid.includes('/')) return serializeVerification({}, true)
  const [required, snap] = await Promise.all([
    isCreatorAgeVerificationRequired(),
    ageVerificationRef(cleanUid).get().catch(() => ({ exists: false, data: () => ({}) }))
  ])
  return serializeVerification(snap.exists ? snap.data() || {} : {}, required)
}

const getCreatorAgeVerificationStatus = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return {
    ok: true,
    ageVerification: await loadCreatorAgeVerification(uid)
  }
})

const startCreatorAgeVerification = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const attestationAccepted = request.data?.attestationAccepted === true
  const ref = ageVerificationRef(uid)
  const now = admin.firestore.FieldValue.serverTimestamp()
  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    const existing = snap.exists ? snap.data() || {} : {}
    if (existing.status === 'verified') return
    transaction.set(ref, {
      status: existing.status && existing.status !== 'not_started' ? existing.status : 'pending',
      provider: existing.provider || 'manual_foundation',
      providerSessionId: existing.providerSessionId || `placeholder_${Date.now()}`,
      placeholder: true,
      requiredFor: REQUIRED_FOR,
      attestationAccepted: attestationAccepted === true,
      startedAt: existing.startedAt || now,
      updatedAt: now
    }, { merge: true })
  })
  return {
    ok: true,
    ageVerification: await loadCreatorAgeVerification(uid),
    providerStatus: 'coming_soon'
  }
})

const setCreatorAgeVerificationStatus = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate', 'roleManage', 'listingEdit'])
  const uid = cleanString(request.data?.uid || '', 180)
  const status = cleanString(request.data?.status || '', 40)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  if (!VALID_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'A valid verification status is required.')
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    status,
    provider: 'manual_foundation',
    placeholder: true,
    requiredFor: REQUIRED_FOR,
    reviewedBy: claims.uid,
    updatedAt: now,
    rejectionReason: cleanString(request.data?.rejectionReason || '', 600)
  }
  if (status === 'verified') payload.verifiedAt = now
  if (status === 'rejected') payload.rejectedAt = now
  if (status === 'expired') payload.expiredAt = now
  await ageVerificationRef(uid).set(payload, { merge: true })
  return {
    ok: true,
    ageVerification: await loadCreatorAgeVerification(uid)
  }
})

module.exports = {
  getCreatorAgeVerificationStatus,
  loadCreatorAgeVerification,
  setCreatorAgeVerificationStatus,
  startCreatorAgeVerification
}
