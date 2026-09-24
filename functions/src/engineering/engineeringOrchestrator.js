const crypto = require('crypto')
const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { cleanString, requireAdminActionSecurity } = require('../admin/adminAuth')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { normalizeJob } = require('./engineeringJobs')

const COLLECTION = 'engineeringJobs'
const LOCK_TTL_MS = 5 * 60 * 1000
const TRANSITIONS = Object.freeze({
  submitted: new Set(['triaging', 'rejected', 'failed']),
  triaging: new Set(['submitted', 'auditing', 'rejected', 'failed']),
  auditing: new Set(['fixing', 'rejected', 'failed']),
  fixing: new Set(['reviewing', 'failed']),
  reviewing: new Set(['fixing', 'awaiting_approval', 'rejected', 'failed']),
  awaiting_approval: new Set(['approved', 'rejected', 'fixing']),
  approved: new Set(['deploying', 'rejected']),
  deploying: new Set(['deployed', 'failed']),
  deployed: new Set([]),
  rejected: new Set([]),
  failed: new Set(['submitted'])
})

function db() { return admin.firestore() }

async function requireOwner(request = {}) {
  const claims = await requireAdminActionSecurity(request)
  if (claims.adminRole !== 'owner') throw new HttpsError('permission-denied', 'Owner access is required for Engineering.')
  return claims
}

function canTransition(from = '', to = '') {
  return TRANSITIONS[from]?.has(to) === true
}

function normalizeClassification(value = {}) {
  const allowedCategories = new Set(['bug', 'feature_request', 'support_question', 'security_report', 'duplicate', 'spam_abuse', 'uncertain'])
  const category = allowedCategories.has(value.category) ? value.category : 'uncertain'
  const confidence = Number(value.confidence)
  return {
    status: value.status === 'complete' ? 'complete' : 'pending',
    category,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : null,
    reason: cleanString(value.reason || '', 1200),
    sanitizedIssue: value.sanitizedIssue && typeof value.sanitizedIssue === 'object' ? value.sanitizedIssue : null,
    classifiedBy: cleanString(value.classifiedBy || '', 80)
  }
}

async function claimJob(jobId, ownerUid) {
  const ref = db().collection(COLLECTION).doc(jobId)
  return db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) throw new HttpsError('not-found', 'Engineering job not found.')
    const raw = snap.data() || {}
    if (raw.status !== 'submitted') throw new HttpsError('failed-precondition', `Only Submitted jobs can enter triage. Current state: ${raw.status || 'unknown'}.`)
    const existingExpiry = raw.orchestration?.lockExpiresAt?.toMillis?.() || 0
    if (existingExpiry > Date.now()) throw new HttpsError('aborted', 'This engineering job is already being processed.')

    const token = crypto.randomUUID()
    const now = admin.firestore.Timestamp.now()
    const expiresAt = admin.firestore.Timestamp.fromMillis(Date.now() + LOCK_TTL_MS)
    tx.update(ref, {
      status: 'triaging',
      stage: 'triaging',
      'classification.status': 'pending',
      'orchestration.lockToken': token,
      'orchestration.lockOwnerUid': ownerUid,
      'orchestration.lockedAt': now,
      'orchestration.lockExpiresAt': expiresAt,
      'orchestration.lastError': '',
      updatedAt: now,
      revision: admin.firestore.FieldValue.increment(1)
    })
    return { ref, token }
  })
}

async function releaseJobLock(ref, token, patch = {}) {
  await db().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    if (!snap.exists) return
    const raw = snap.data() || {}
    if (raw.orchestration?.lockToken !== token) return
    tx.update(ref, {
      ...patch,
      'orchestration.lockToken': admin.firestore.FieldValue.delete(),
      'orchestration.lockOwnerUid': admin.firestore.FieldValue.delete(),
      'orchestration.lockedAt': admin.firestore.FieldValue.delete(),
      'orchestration.lockExpiresAt': admin.firestore.FieldValue.delete(),
      updatedAt: admin.firestore.Timestamp.now(),
      revision: admin.firestore.FieldValue.increment(1)
    })
  })
}

const startEngineeringTriage = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = await requireOwner(request)
  const jobId = cleanString(request.data?.jobId || '', 180)
  if (!jobId || jobId.includes('/')) throw new HttpsError('invalid-argument', 'A valid engineering job ID is required.')

  const { ref, token } = await claimJob(jobId, claims.uid)
  try {
    // Phase 2A deliberately stops here. The next patch supplies the AI classifier.
    // Keeping the state transition and lock real lets us prove orchestration safety
    // before an external model is permitted to influence the job.
    await releaseJobLock(ref, token, {
      status: 'submitted',
      stage: 'awaiting_triage_model',
      'orchestration.lastRunAt': admin.firestore.Timestamp.now(),
      'orchestration.lastRunResult': 'classifier_not_connected'
    })
    await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'engineering_triage_requested',
      targetType: 'engineering_job',
      targetId: jobId,
      targetPath: `${COLLECTION}/${jobId}`,
      reason: 'Engineering orchestrator validated the job and is awaiting the triage model.',
      after: { status: 'submitted', stage: 'awaiting_triage_model' }
    })
  } catch (error) {
    await releaseJobLock(ref, token, {
      status: 'failed',
      stage: 'triage_failed',
      'orchestration.lastError': cleanString(error?.message || 'Triage orchestration failed.', 1200)
    }).catch(() => null)
    throw error
  }
  const snapshot = await ref.get()
  return { ok: true, job: normalizeJob(snapshot.id, snapshot.data() || {}) }
})

module.exports = {
  startEngineeringTriage,
  __test: { TRANSITIONS, canTransition, normalizeClassification }
}
