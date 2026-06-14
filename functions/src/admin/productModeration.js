const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { buildAdminAuditLogEntry } = require('./auditLog')

const db = admin.firestore()

async function moderate(request, action) {
  const actor = await requireAdminActionSecurity(request, ['listingEdit', 'productReview'])
  const productId = cleanString(request.data?.productId || '', 180)
  const reason = cleanString(request.data?.reason || '', 1200)
  if (!productId || productId.includes('/')) throw new HttpsError('invalid-argument', 'A valid productId is required.')
  if (action === 'remove' && request.data?.confirmation !== 'REMOVE') {
    throw new HttpsError('failed-precondition', 'Type REMOVE to confirm product removal.')
  }
  const productRef = db.doc(`products/${productId}`)
  const moderationRef = db.doc(`productModeration/${productId}`)
  const eventRef = moderationRef.collection('events').doc()
  const auditRef = db.collection('adminLogs').doc()
  let result = {}
  await db.runTransaction(async (transaction) => {
    const [productSnap, moderationSnap] = await Promise.all([
      transaction.get(productRef),
      transaction.get(moderationRef)
    ])
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
    const product = productSnap.data() || {}
    const moderation = moderationSnap.exists ? moderationSnap.data() || {} : {}
    const now = admin.firestore.FieldValue.serverTimestamp()
    if (action === 'hide') {
      result = { status: 'hidden', visibility: 'private', moderationStatus: 'hidden' }
      transaction.set(moderationRef, {
        productId,
        previousStatus: product.status || 'draft',
        previousVisibility: product.visibility || 'private',
        hiddenAt: now,
        hiddenBy: actor.uid,
        updatedAt: now
      }, { merge: true })
    } else if (action === 'unhide') {
      const priorStatus = cleanString(moderation.previousStatus || '', 80)
      const priorVisibility = cleanString(moderation.previousVisibility || '', 80)
      result = {
        status: priorStatus === 'published' ? 'published' : (priorStatus || 'draft'),
        visibility: priorStatus === 'published' && priorVisibility === 'public' ? 'public' : (priorVisibility === 'unlisted' ? 'unlisted' : 'private'),
        moderationStatus: priorStatus === 'published' ? 'approved' : 'pending'
      }
    } else {
      result = { status: 'removed', visibility: 'private', moderationStatus: 'removed', storefrontVisible: false }
      transaction.set(moderationRef, {
        productId,
        removedAt: now,
        removedBy: actor.uid,
        removalReason: reason,
        cleanupStatus: 'quarantined',
        updatedAt: now
      }, { merge: true })
    }
    transaction.set(productRef, { ...result, updatedAt: now }, { merge: true })
    transaction.set(eventRef, {
      id: eventRef.id,
      productId,
      action,
      reason,
      actorUid: actor.uid,
      actorRole: actor.adminRole,
      previousStatus: product.status || '',
      previousVisibility: product.visibility || '',
      nextStatus: result.status,
      nextVisibility: result.visibility,
      createdAt: now
    })
    transaction.set(auditRef, {
      id: auditRef.id,
      ...buildAdminAuditLogEntry({
        actorUid: actor.uid,
        actorEmail: actor.email,
        actorRole: actor.adminRole,
        action: `product_${action}`,
        targetType: 'product',
        targetId: productId,
        targetPath: `products/${productId}`,
        reason,
        before: product,
        after: { ...product, ...result },
        metadata: { softRemoval: action === 'remove' }
      })
    })
  })
  return { ok: true, productId, action, auditLogId: auditRef.id, ...result }
}

const adminHideProduct = onCall({ timeoutSeconds: 30, memory: '256MiB' }, (request) => moderate(request, 'hide'))
const adminUnhideProduct = onCall({ timeoutSeconds: 30, memory: '256MiB' }, (request) => moderate(request, 'unhide'))
const adminRemoveProduct = onCall({ timeoutSeconds: 30, memory: '256MiB' }, (request) => moderate(request, 'remove'))

module.exports = { adminHideProduct, adminUnhideProduct, adminRemoveProduct }
