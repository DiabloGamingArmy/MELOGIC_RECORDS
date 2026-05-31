const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertPermission, cleanString } = require('./adminAuth')
const { buildAdminAuditLogEntry } = require('./auditLog')
const { writeAccountEventToBatch } = require('../account/accountEvents')
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

function buildCreatorChangeNotification({ notificationId = '', productId = '', product = {}, reason = '', notes = '' } = {}) {
  const productTitle = cleanString(product.title || 'your product', 180)
  const adminNotes = cleanString(notes || reason, 2400)
  return {
    id: notificationId,
    type: 'product_changes_requested',
    title: 'Product changes requested',
    body: `An admin reviewed ${productTitle} and requested changes: ${cleanString(reason, 900)}`,
    productId,
    productTitle,
    status: 'needs_changes',
    severity: 'warning',
    actionHref: `/products/edit?id=${encodeURIComponent(productId)}`,
    reviewDecision: 'request_changes',
    adminNotes,
    reason: cleanString(reason, 1200),
    readAt: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    data: {
      type: 'product_changes_requested',
      productId,
      productTitle,
      reviewDecision: 'request_changes',
      adminNotes
    }
  }
}

function buildCreatorReviewEvent({ decision = '', productId = '', product = {}, reason = '', reviewerUid = '' } = {}) {
  const productTitle = cleanString(product.title || 'Your product', 180)
  if (decision === 'approve') {
    return {
      type: 'product_approved',
      severity: 'success',
      title: 'Product approved',
      message: `${productTitle} was approved and published.`,
      actorUid: reviewerUid,
      actorType: 'admin',
      source: 'marketplace-review',
      path: `/products/${encodeURIComponent(product.slug || productId)}`,
      metadata: { productId, decision }
    }
  }
  if (decision === 'reject') {
    return {
      type: 'product_rejected',
      severity: 'warning',
      title: 'Product rejected',
      message: `${productTitle} was rejected after review.${reason ? ` ${cleanString(reason, 300)}` : ''}`,
      actorUid: reviewerUid,
      actorType: 'admin',
      source: 'marketplace-review',
      path: `/products/edit?id=${encodeURIComponent(productId)}`,
      metadata: { productId, decision, reason: cleanString(reason, 500) }
    }
  }
  return {
    type: 'product_returned',
    severity: 'warning',
    title: 'Product changes requested',
    message: `${productTitle} needs changes before it can be approved.${reason ? ` ${cleanString(reason, 300)}` : ''}`,
    actorUid: reviewerUid,
    actorType: 'admin',
    source: 'marketplace-review',
    path: `/products/edit?id=${encodeURIComponent(productId)}`,
    metadata: { productId, decision, reason: cleanString(reason, 500) }
  }
}

const reviewProductDecision = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const reviewer = assertPermission(request, 'productReview')
  const productId = normalizeProductId(request.data?.productId)
  const decision = normalizeDecision(request.data?.decision)
  const reason = cleanString(request.data?.reason || '', 1200)
  const notes = cleanString(request.data?.notes || '', 2400)
  if (['reject', 'request_changes'].includes(decision) && !reason) {
    throw new HttpsError('invalid-argument', 'A reason is required for this review decision.')
  }
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
  const notificationRef = decision === 'request_changes' && cleanString(product.artistId || '', 180)
    ? db().collection('users').doc(cleanString(product.artistId || '', 180)).collection('systemNotifications').doc()
    : null
  const creatorUid = cleanString(product.artistId || '', 180)
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
  if (notificationRef) {
    batch.set(notificationRef, buildCreatorChangeNotification({
      notificationId: notificationRef.id,
      productId,
      product,
      reason,
      notes
    }))
  }
  const accountEventId = creatorUid
    ? writeAccountEventToBatch(db(), batch, creatorUid, buildCreatorReviewEvent({
      decision,
      productId,
      product,
      reason,
      reviewerUid: reviewer.uid
    }))
    : ''
  await batch.commit()

  return {
    ok: true,
    productId,
    decision,
    status: productUpdate.status,
    visibility: productUpdate.visibility,
    moderationStatus: productUpdate.moderationStatus || product.moderationStatus || '',
    reviewJobStatus: productUpdate.reviewJobStatus || product.reviewJobStatus || '',
    auditLogId: auditRef.id,
    notificationId: notificationRef?.id || '',
    accountEventId
  }
})

module.exports = {
  reviewProductDecision,
  __test: {
    buildDecisionUpdate,
    buildCreatorChangeNotification,
    normalizeDecision,
    productIsInReviewQueue,
    validateProductForApproval
  }
}
