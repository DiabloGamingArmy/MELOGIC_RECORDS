const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAdmin, cleanString, requireAdminActionSecurity } = require('../admin/adminAuth')
const { writeAdminAuditLog } = require('../admin/auditLog')

const COLLECTION = 'engineeringJobs'
const REPOSITORY = 'DiabloGamingArmy/MELOGIC_RECORDS'
const DEFAULT_BRANCH = 'main'
const ALLOWED_SOURCES = new Set(['admin', 'public_support', 'system'])
const ALLOWED_STATUSES = new Set(['submitted','triaging','auditing','fixing','reviewing','awaiting_approval','approved','deploying','deployed','rejected','failed'])

function db() { return admin.firestore() }

function requireOwner(request = {}, { stepUp = false } = {}) {
  if (!stepUp) {
    const claims = assertAdmin(request)
    if (claims.adminRole !== 'owner') throw new HttpsError('permission-denied', 'Owner access is required for Engineering.')
    return claims
  }
  return requireAdminActionSecurity(request).then((claims) => {
    if (claims.adminRole !== 'owner') throw new HttpsError('permission-denied', 'Owner access is required for Engineering.')
    return claims
  })
}

function cleanMultiline(value = '', max = 12000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max)
}
function timestampIso(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return null
}
function normalizeJob(id, raw = {}) {
  return {
    id,
    title: cleanString(raw.title || '', 180),
    report: cleanMultiline(raw.report || '', 12000),
    source: ALLOWED_SOURCES.has(raw.source) ? raw.source : 'admin',
    status: ALLOWED_STATUSES.has(raw.status) ? raw.status : 'submitted',
    stage: cleanString(raw.stage || raw.status || 'submitted', 80),
    repository: cleanString(raw.repository || REPOSITORY, 240),
    targetBranch: cleanString(raw.targetBranch || DEFAULT_BRANCH, 120),
    createdByUid: cleanString(raw.createdByUid || '', 180),
    createdByEmail: cleanString(raw.createdByEmail || '', 320),
    classification: raw.classification && typeof raw.classification === 'object' ? raw.classification : { status: 'pending' },
    audit: raw.audit && typeof raw.audit === 'object' ? raw.audit : { status: 'pending' },
    implementation: raw.implementation && typeof raw.implementation === 'object' ? raw.implementation : { status: 'blocked' },
    review: raw.review && typeof raw.review === 'object' ? raw.review : { status: 'blocked' },
    approval: raw.approval && typeof raw.approval === 'object' ? raw.approval : { status: 'not_requested' },
    deployment: raw.deployment && typeof raw.deployment === 'object' ? raw.deployment : { status: 'blocked' },
    createdAt: timestampIso(raw.createdAt),
    updatedAt: timestampIso(raw.updatedAt)
  }
}

const createEngineeringJob = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = await requireOwner(request, { stepUp: true })
  const report = cleanMultiline(request.data?.report || '', 12000)
  const requestedTitle = cleanString(request.data?.title || '', 180)
  if (report.length < 10) throw new HttpsError('invalid-argument', 'Describe the engineering issue in at least 10 characters.')
  const source = ALLOWED_SOURCES.has(request.data?.source) ? request.data.source : 'admin'
  if (source !== 'admin') throw new HttpsError('invalid-argument', 'This endpoint currently accepts admin-originated jobs only.')

  const ref = db().collection(COLLECTION).doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const title = requestedTitle || report.split(/\n/)[0].slice(0, 120) || 'Engineering job'
  const payload = {
    id: ref.id, title, report, source, status: 'submitted', stage: 'submitted',
    repository: REPOSITORY, targetBranch: DEFAULT_BRANCH,
    createdByUid: claims.uid, createdByEmail: claims.email || '',
    classification: { status: 'pending', category: '', confidence: null, reason: '', sanitizedIssue: null },
    audit: { status: 'pending', passes: [] },
    implementation: { status: 'blocked', branch: '', baseCommitSha: '', headCommitSha: '', changedFiles: [] },
    review: { status: 'blocked', passes: [], testSummary: null },
    approval: { status: 'not_requested', approvedCommitSha: '', approvedByUid: '', approvedAt: null },
    deployment: { status: 'blocked', commitSha: '', deployedAt: null },
    safety: { publicPromptTrusted: false, directMainWriteAllowed: false, automaticDeploymentAllowed: false },
    revision: 1, createdAt: now, updatedAt: now
  }
  await ref.set(payload)
  await writeAdminAuditLog({
    actorUid: claims.uid, actorEmail: claims.email, actorRole: claims.adminRole,
    action: 'engineering_job_created', targetType: 'engineering_job', targetId: ref.id,
    targetPath: `${COLLECTION}/${ref.id}`, reason: title,
    after: { status: 'submitted', source, repository: REPOSITORY, targetBranch: DEFAULT_BRANCH, automaticDeploymentAllowed: false }
  })
  const snapshot = await ref.get()
  return { ok: true, job: normalizeJob(ref.id, snapshot.data() || payload) }
})

const listEngineeringJobs = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  requireOwner(request)
  const requestedLimit = Number(request.data?.limit || 40)
  const limit = Math.max(1, Math.min(100, Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 40))
  const snapshot = await db().collection(COLLECTION).orderBy('createdAt', 'desc').limit(limit).get()
  return { ok: true, jobs: snapshot.docs.map((doc) => normalizeJob(doc.id, doc.data())) }
})

const getEngineeringJob = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  requireOwner(request)
  const jobId = cleanString(request.data?.jobId || '', 180)
  if (!jobId || jobId.includes('/')) throw new HttpsError('invalid-argument', 'A valid engineering job ID is required.')
  const snapshot = await db().collection(COLLECTION).doc(jobId).get()
  if (!snapshot.exists) throw new HttpsError('not-found', 'Engineering job not found.')
  return { ok: true, job: normalizeJob(snapshot.id, snapshot.data()) }
})

module.exports = { createEngineeringJob, getEngineeringJob, listEngineeringJobs, __test: { ALLOWED_STATUSES, normalizeJob } }
