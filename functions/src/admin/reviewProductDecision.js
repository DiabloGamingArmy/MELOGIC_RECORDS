const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertPermission, cleanString } = require('./adminAuth')
const { buildAdminAuditLogEntry } = require('./auditLog')
const {
  buildDecisionUpdate,
  normalizeDecision,
  normalizeProductId,
  productIsInReviewQueue,
  validateProductForApproval
} = require('./marketplaceReviewShared')

function db() {
  return admin.firestore()
}

function productAuditSummary(product = {}) {
  return {
    status: cleanString(product.status || '', 80),
    visibility: cleanString(product.visibility || '', 80),
    moderationStatus: cleanString(product.moderationStatus || '', 80),
    reviewJobStatus: cleanString(product.reviewJobStatus || '', 120),
    title: cleanString(product.title || '', 180),
    artistId: cleanString(product.artistId || '', 180)
  }
}

const reviewProductDecision = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const reviewer = assertPermission(request, 'productReview')
  const productId = normalizeProductId(request.data?.productId)
  const decision = normalizeDecision(request.data?.decision)
  const reason = cleanString(request.data?.reason || '', 1200)
  const notes = cleanString(request.data?.notes || '', 2400)
  const productRef = db().collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
  const product = productSnap.data() || {}

  if (!productIsInReviewQueue(product) && decision === 'approve') {
    throw new HttpsError('failed-precondition', 'Only products in marketplace review can be approved.')
  }
  if (decision === 'approve') {
    const approvalProblems = validateProductForApproval(product)
    if (approvalProblems.length) {
      throw new HttpsError('failed-precondition', `Cannot approve product: ${approvalProblems.join(' ')}`, {
        productId,
        problems: approvalProblems
      })
    }
  }

  const productUpdate = buildDecisionUpdate(decision, { uid: reviewer.uid, reason, notes, existing: product })
  const eventRef = db().collection('productModeration').doc(productId).collection('events').doc()
  const auditRef = db().collection('adminLogs').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = db().batch()
  batch.set(productRef, productUpdate, { merge: true })
  batch.set(eventRef, {
    id: eventRef.id,
    productId,
    decision,
    reason,
    notes,
    actorUid: reviewer.uid,
    actorEmail: reviewer.email,
    actorRole: reviewer.adminRole,
    previousStatus: cleanString(product.status || '', 80),
    previousVisibility: cleanString(product.visibility || '', 80),
    previousModerationStatus: cleanString(product.moderationStatus || '', 80),
    createdAt: now
  })
  batch.set(auditRef, {
    id: auditRef.id,
    ...buildAdminAuditLogEntry({
      actorUid: reviewer.uid,
      actorEmail: reviewer.email,
      actorRole: reviewer.adminRole,
      action: `product_review_${decision}`,
      targetType: 'product',
      targetId: productId,
      targetPath: `products/${productId}`,
      reason,
      before: productAuditSummary(product),
      after: productAuditSummary({ ...product, ...productUpdate }),
      metadata: { decision, notes }
    })
  })
  await batch.commit()

  return {
    ok: true,
    productId,
    decision,
    status: productUpdate.status,
    visibility: productUpdate.visibility,
    moderationStatus: productUpdate.moderationStatus || product.moderationStatus || '',
    reviewJobStatus: productUpdate.reviewJobStatus || product.reviewJobStatus || '',
    auditLogId: auditRef.id
  }
})

module.exports = {
  reviewProductDecision,
  __test: {
    buildDecisionUpdate,
    normalizeDecision,
    productIsInReviewQueue,
    validateProductForApproval
  }
}
