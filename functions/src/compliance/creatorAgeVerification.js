const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertAnyPermission, cleanString } = require('../admin/adminAuth')
const { mergeSettings } = require('../admin/adminSettingsShared')
const { writeAdminAuditLog } = require('../admin/auditLog')

const VALID_STATUSES = new Set(['not_started', 'attested', 'pending_review', 'approved', 'rejected', 'provider_required'])
const LEGACY_STATUSES = new Set(['pending', 'verified', 'expired'])
const REQUIRED_FOR = ['marketplace_product_creation']
const ELIGIBILITY_TERMS_VERSION = 'creator-eligibility-v1'
const ELIGIBILITY_STATEMENT = 'I confirm I am at least 18 years old and eligible to publish marketplace products on Melogic Records.'

function db() {
  return admin.firestore()
}

function ageVerificationRef(uid = '') {
  return db().collection('users').doc(uid).collection('creatorCompliance').doc('ageVerification')
}

function eligibilityRef(uid = '') {
  return db().collection('users').doc(uid).collection('creatorCompliance').doc('eligibility')
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

function normalizedEligibilityStatus(rawStatus = '') {
  const status = cleanString(rawStatus || '', 40)
  if (VALID_STATUSES.has(status)) return status
  if (status === 'verified') return 'approved'
  if (status === 'expired') return 'provider_required'
  if (LEGACY_STATUSES.has(status)) return 'not_started'
  return 'not_started'
}

function eligibilityProvider(raw = {}) {
  const provider = raw.provider && typeof raw.provider === 'object' && !Array.isArray(raw.provider)
    ? raw.provider
    : { type: raw.provider || 'native_attestation', sessionId: raw.providerSessionId || null, status: null }
  return {
    type: cleanString(provider.type || 'native_attestation', 80),
    sessionId: provider.sessionId ? cleanString(provider.sessionId, 180) : null,
    status: provider.status ? cleanString(provider.status, 80) : null,
    verifiedAt: serializeDate(provider.verifiedAt),
    lastError: cleanString(provider.lastError || '', 600)
  }
}

function serializeVerification(raw = {}, required = true) {
  const status = normalizedEligibilityStatus(raw.status)
  const attestation = raw.attestation && typeof raw.attestation === 'object' && !Array.isArray(raw.attestation)
    ? raw.attestation
    : {}
  const provider = eligibilityProvider(raw)
  const enforcement = raw.enforcement && typeof raw.enforcement === 'object' && !Array.isArray(raw.enforcement)
    ? raw.enforcement
    : {}
  return {
    required: required !== false,
    status,
    minimumAge: Number(raw.minimumAge || 18),
    attestation: {
      accepted: attestation.accepted === true || raw.attestationAccepted === true,
      acceptedAt: serializeDate(attestation.acceptedAt || raw.acceptedAt),
      termsVersion: cleanString(attestation.termsVersion || '', 80),
      statement: cleanString(attestation.statement || '', 400)
    },
    provider,
    providerType: provider.type,
    requiredFor: Array.isArray(raw.requiredFor) ? raw.requiredFor.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 8) : REQUIRED_FOR,
    enforcement: {
      canCreateDrafts: enforcement.canCreateDrafts !== false,
      canSubmitForReview: enforcement.canSubmitForReview === true || status === 'attested' || status === 'approved',
      canPublish: enforcement.canPublish === true || status === 'attested' || status === 'approved'
    },
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    startedAt: serializeDate(raw.startedAt),
    verifiedAt: serializeDate(raw.verifiedAt),
    rejectedAt: serializeDate(raw.rejectedAt),
    expiredAt: serializeDate(raw.expiredAt),
    reviewedBy: cleanString(raw.reviewedBy || '', 180),
    reviewedAt: serializeDate(raw.reviewedAt),
    rejectionReason: cleanString(raw.rejectionReason || '', 600),
    placeholder: false
  }
}

async function loadCreatorAgeVerification(uid = '') {
  const cleanUid = cleanString(uid, 180)
  if (!cleanUid || cleanUid.includes('/')) return serializeVerification({}, true)
  const [required, eligibilitySnap, legacySnap] = await Promise.all([
    isCreatorAgeVerificationRequired(),
    eligibilityRef(cleanUid).get().catch(() => ({ exists: false, data: () => ({}) })),
    ageVerificationRef(cleanUid).get().catch(() => ({ exists: false, data: () => ({}) }))
  ])
  if (eligibilitySnap.exists) return serializeVerification(eligibilitySnap.data() || {}, required)
  const legacy = legacySnap.exists ? legacySnap.data() || {} : {}
  if (legacy.status === 'verified') {
    return serializeVerification({
      status: 'approved',
      minimumAge: 18,
      provider: { type: 'manual_foundation', sessionId: legacy.providerSessionId || null, status: 'verified' },
      enforcement: { canCreateDrafts: true, canSubmitForReview: true, canPublish: true },
      reviewedBy: legacy.reviewedBy || '',
      reviewedAt: legacy.verifiedAt || legacy.updatedAt || null,
      updatedAt: legacy.updatedAt || legacy.verifiedAt || null,
      createdAt: legacy.startedAt || legacy.updatedAt || null
    }, required)
  }
  if (legacy.status === 'rejected') {
    return serializeVerification({
      status: 'rejected',
      minimumAge: 18,
      provider: { type: 'manual_foundation', sessionId: legacy.providerSessionId || null, status: 'rejected' },
      enforcement: { canCreateDrafts: true, canSubmitForReview: false, canPublish: false },
      reviewedBy: legacy.reviewedBy || '',
      rejectionReason: legacy.rejectionReason || '',
      reviewedAt: legacy.rejectedAt || legacy.updatedAt || null,
      updatedAt: legacy.updatedAt || legacy.rejectedAt || null,
      createdAt: legacy.startedAt || legacy.updatedAt || null
    }, required)
  }
  return serializeVerification({}, required)
}

async function confirmCreatorEligibilityForUid(uid = '') {
  const cleanUid = cleanString(uid, 180)
  if (!cleanUid || cleanUid.includes('/')) throw new HttpsError('invalid-argument', 'A valid user is required.')
  const ref = eligibilityRef(cleanUid)
  const now = admin.firestore.FieldValue.serverTimestamp()
  let previous = null
  let nextStatus = 'attested'

  await db().runTransaction(async (transaction) => {
    const snap = await transaction.get(ref)
    const existing = snap.exists ? snap.data() || {} : {}
    previous = existing
    nextStatus = existing.status === 'approved' ? 'approved' : 'attested'
    transaction.set(ref, {
      status: nextStatus,
      minimumAge: 18,
      attestation: {
        accepted: true,
        acceptedAt: now,
        termsVersion: ELIGIBILITY_TERMS_VERSION,
        statement: ELIGIBILITY_STATEMENT
      },
      provider: {
        type: 'native_attestation',
        sessionId: null,
        status: null
      },
      enforcement: {
        canCreateDrafts: true,
        canSubmitForReview: true,
        canPublish: true
      },
      reviewedBy: existing.reviewedBy || null,
      reviewedAt: existing.reviewedAt || null,
      rejectionReason: existing.rejectionReason || null,
      createdAt: existing.createdAt || now,
      updatedAt: now
      // Future provider integration: provider.type may become "stripe_identity" with
      // provider.sessionId/status/verifiedAt/lastError updated by Stripe Identity webhooks.
    }, { merge: true })
  })

  writeAdminAuditLog({
    actorUid: cleanUid,
    action: 'creator_eligibility_attested',
    targetType: 'creatorCompliance',
    targetId: cleanUid,
    targetPath: `users/${cleanUid}/creatorCompliance/eligibility`,
    reason: 'Creator confirmed native marketplace eligibility attestation.',
    before: previous,
    after: {
      status: nextStatus,
      minimumAge: 18,
      attestation: {
        accepted: true,
        termsVersion: ELIGIBILITY_TERMS_VERSION,
        statement: ELIGIBILITY_STATEMENT
      },
      provider: { type: 'native_attestation', sessionId: null, status: null }
    },
    metadata: { source: 'callable', termsVersion: ELIGIBILITY_TERMS_VERSION }
  }).catch((error) => {
    console.warn('[creatorEligibility] audit log write failed', error?.message || error)
  })

  return {
    status: nextStatus,
    creatorEligibility: await loadCreatorAgeVerification(cleanUid)
  }
}

const getCreatorAgeVerificationStatus = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return {
    ok: true,
    ageVerification: await loadCreatorAgeVerification(uid)
  }
})

const confirmCreatorEligibility = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const result = await confirmCreatorEligibilityForUid(uid)

  return {
    ok: true,
    status: result.status,
    creatorEligibility: result.creatorEligibility
  }
})

const startCreatorAgeVerification = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const result = await confirmCreatorEligibilityForUid(uid)
  return {
    ok: true,
    ageVerification: result.creatorEligibility,
    providerStatus: 'native_attestation'
  }
})

const setCreatorAgeVerificationStatus = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate', 'roleManage', 'listingEdit'])
  const uid = cleanString(request.data?.uid || '', 180)
  const requestedStatus = cleanString(request.data?.status || '', 40)
  const status = requestedStatus === 'verified' ? 'approved' : requestedStatus
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')
  if (!VALID_STATUSES.has(status)) throw new HttpsError('invalid-argument', 'A valid verification status is required.')
  const now = admin.firestore.FieldValue.serverTimestamp()
  const canSubmit = status === 'attested' || status === 'approved'
  const payload = {
    status,
    minimumAge: 18,
    provider: {
      type: status === 'provider_required' ? 'stripe_identity' : 'native_attestation',
      sessionId: null,
      status: null
    },
    enforcement: {
      canCreateDrafts: true,
      canSubmitForReview: canSubmit,
      canPublish: canSubmit
    },
    requiredFor: REQUIRED_FOR,
    reviewedBy: claims.uid,
    reviewedAt: now,
    updatedAt: now,
    rejectionReason: cleanString(request.data?.rejectionReason || '', 600)
  }
  if (status === 'approved') payload.provider.status = 'admin_approved'
  if (status === 'rejected') payload.rejectedAt = now
  await eligibilityRef(uid).set(payload, { merge: true })
  return {
    ok: true,
    ageVerification: await loadCreatorAgeVerification(uid)
  }
})

module.exports = {
  confirmCreatorEligibility,
  getCreatorAgeVerificationStatus,
  loadCreatorAgeVerification,
  setCreatorAgeVerificationStatus,
  startCreatorAgeVerification,
  __test: {
    ELIGIBILITY_STATEMENT,
    ELIGIBILITY_TERMS_VERSION,
    normalizedEligibilityStatus,
    serializeVerification
  }
}
