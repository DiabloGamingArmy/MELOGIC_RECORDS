const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

const TARGET_TYPES = new Set(['product', 'profile', 'user', 'order'])
const PRODUCT_REASONS = new Set([
  'Fraudulent or misleading',
  'Download does not work',
  'Product not as described',
  'Stolen/copyrighted content',
  'Unsafe or malicious file',
  'Spam',
  'Other'
])
const PROFILE_REASONS = new Set([
  'Impersonation',
  'Harassment or abuse',
  'Spam',
  'Misleading profile',
  'Inappropriate content',
  'Other'
])
const USER_REASONS = PROFILE_REASONS
const ORDER_REASONS = new Set([
  'Payment issue',
  'Refund issue',
  'Entitlement issue',
  'Fraudulent or misleading',
  'Other'
])

function db() {
  return admin.firestore()
}

function reasonSetForType(targetType = '') {
  if (targetType === 'product') return PRODUCT_REASONS
  if (targetType === 'profile') return PROFILE_REASONS
  if (targetType === 'user') return USER_REASONS
  if (targetType === 'order') return ORDER_REASONS
  return new Set()
}

function safeIdPart(value = '') {
  return cleanString(value, 180)
    .replace(/[/.#[\]\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120) || 'target'
}

function sanitizeMetadata(value = {}, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  if (depth > 2) return {}
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, child]) => {
        const cleanKey = cleanString(key, 80)
        if (!cleanKey) return null
        if (child === null || child === undefined) return [cleanKey, null]
        if (typeof child === 'boolean') return [cleanKey, child]
        if (typeof child === 'number') return [cleanKey, Number.isFinite(child) ? child : null]
        if (typeof child === 'string') return [cleanKey, cleanString(child, 500)]
        if (Array.isArray(child)) return [cleanKey, child.slice(0, 20).map((item) => cleanString(item, 180)).filter(Boolean)]
        if (typeof child === 'object') return [cleanKey, sanitizeMetadata(child, depth + 1)]
        return [cleanKey, cleanString(String(child), 240)]
      })
      .filter(Boolean)
  )
}

async function resolveTargetOwner(targetType = '', targetId = '', suppliedOwner = '') {
  const firestore = db()
  if (targetType === 'product') {
    const snap = await firestore.collection('products').doc(targetId).get()
    if (!snap.exists) throw new HttpsError('not-found', 'The reported product could not be found.')
    return cleanString(snap.data()?.artistId || suppliedOwner || '', 180)
  }
  if (targetType === 'profile' || targetType === 'user') {
    const snap = await firestore.collection('profiles').doc(targetId).get()
    return cleanString(snap.data()?.uid || targetId || suppliedOwner || '', 180)
  }
  if (targetType === 'order') {
    const snap = await firestore.collection('orders').doc(targetId).get()
    if (snap.exists) return cleanString(snap.data()?.buyerUid || snap.data()?.uid || suppliedOwner || '', 180)
  }
  return cleanString(suppliedOwner || '', 180)
}

const createReport = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const targetType = cleanString(request.data?.targetType || '', 40)
  const targetId = cleanString(request.data?.targetId || '', 180)
  const reason = cleanString(request.data?.reason || '', 160)
  const description = cleanString(request.data?.description || '', 2000)
  const sourcePath = cleanString(request.data?.sourcePath || '', 900)

  if (!TARGET_TYPES.has(targetType)) throw new HttpsError('invalid-argument', 'A valid report target type is required.')
  if (!targetId || targetId.includes('/')) throw new HttpsError('invalid-argument', 'A valid target id is required.')
  if (!reason) throw new HttpsError('invalid-argument', 'Report reason is required.')
  if (!reasonSetForType(targetType).has(reason)) throw new HttpsError('invalid-argument', 'Report reason is not valid for this target.')
  if (reason === 'Other' && !description) throw new HttpsError('invalid-argument', 'Description is required when reason is Other.')
  if ((targetType === 'profile' || targetType === 'user') && targetId === uid) {
    throw new HttpsError('failed-precondition', 'You cannot report your own profile.')
  }
  const targetOwnerUid = await resolveTargetOwner(targetType, targetId, request.data?.targetOwnerUid || '')

  const firestore = db()
  const duplicateId = `${safeIdPart(targetType)}_${safeIdPart(targetId)}_${safeIdPart(uid)}`
  const duplicateRef = firestore.collection('reports').doc(duplicateId)
  const duplicateSnap = await duplicateRef.get()
  if (duplicateSnap.exists) {
    const duplicate = duplicateSnap.data() || {}
    if (['open', 'in_review', 'action_taken'].includes(String(duplicate.status || ''))) {
      return {
        ok: true,
        duplicate: true,
        reportId: duplicateRef.id,
        status: duplicate.status || 'open'
      }
    }
  }

  const reportRef = duplicateSnap.exists
    ? firestore.collection('reports').doc(`${duplicateId}_${Date.now()}`)
    : duplicateRef
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    reportId: reportRef.id,
    type: targetType,
    targetType,
    targetId,
    targetOwnerUid,
    reporterUid: uid,
    reason,
    description,
    status: 'open',
    priority: 'normal',
    sourcePath,
    metadata: sanitizeMetadata(request.data?.metadata || {}),
    createdAt: now,
    updatedAt: now,
    assignedTo: '',
    resolvedAt: null,
    resolvedBy: '',
    resolution: '',
    adminNotes: ''
  }

  await reportRef.set(payload)
  await firestore.collection('users').doc(uid).collection('accountEvents').doc().set({
    title: 'Report submitted',
    message: 'Your report was submitted.',
    type: 'report_submitted',
    reportId: reportRef.id,
    targetType,
    targetId,
    createdAt: now
  }).catch(() => null)

  return {
    ok: true,
    reportId: reportRef.id,
    status: 'open'
  }
})

module.exports = {
  createReport
}
