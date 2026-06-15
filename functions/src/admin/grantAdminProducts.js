const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { logger } = require('firebase-functions')
const { cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { buildAdminAuditLogEntry } = require('./auditLog')
const { writeAccountEvent } = require('../account/accountEvents')
const { productSnapshot } = require('../payments/checkoutFulfillment')

function db() {
  return admin.firestore()
}

function normalizeProductIds(value = []) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => cleanString(item, 180)).filter((item) => item && !item.includes('/')))].slice(0, 25)
}

function activeSnapshot(snapshot) {
  return Boolean(snapshot?.exists && (snapshot.data()?.status || 'active') === 'active')
}

function systemGrantPayload({ uid = '', productId = '', product = {}, claims = {}, orderId = '', now } = {}) {
  const snapshot = productSnapshot(productId, product)
  return {
    uid,
    userId: uid,
    buyerUid: uid,
    ownerUid: uid,
    productId,
    productTitle: snapshot.title,
    artistId: snapshot.creatorUid,
    artistName: snapshot.creatorName,
    productSlug: snapshot.slug,
    productType: snapshot.productType,
    priceCents: 0,
    pricePaid: 0,
    currency: cleanString(product.currency || 'USD', 12).toUpperCase(),
    acquisitionType: 'System Given',
    source: 'admin_give_product',
    status: 'active',
    license: snapshot.usageLicense,
    entitlementId: `${uid}_${productId}`,
    orderId,
    grantedBy: claims.uid,
    grantedAt: now,
    acquiredAt: now,
    productSnapshot: snapshot,
    createdAt: now,
    updatedAt: now
  }
}

const grantAdminProducts = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = await requireAdminActionSecurity(request, ['orderSupport', 'listingEdit'])
  const uid = cleanString(request.data?.uid || '', 180)
  const productIds = normalizeProductIds(request.data?.productIds)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid target uid is required.')
  if (!productIds.length) throw new HttpsError('invalid-argument', 'Select at least one product.')

  const targetUser = await admin.auth().getUser(uid).catch(() => null)
  if (!targetUser) throw new HttpsError('not-found', 'Target user account was not found.')

  const productSnaps = await Promise.all(productIds.map((productId) => db().collection('products').doc(productId).get()))
  const missingProductIds = productIds.filter((productId, index) => !productSnaps[index].exists)
  if (missingProductIds.length) {
    throw new HttpsError('not-found', `Products not found: ${missingProductIds.join(', ')}`)
  }

  const orderRef = db().collection('orders').doc()
  const auditRef = db().collection('adminLogs').doc()
  const result = await db().runTransaction(async (transaction) => {
    const entitlementRefs = productIds.map((productId) => db().doc(`users/${uid}/entitlements/${productId}`))
    const libraryRefs = productIds.map((productId) => db().doc(`users/${uid}/libraryItems/${productId}`))
    const accessSnaps = await Promise.all([...entitlementRefs, ...libraryRefs].map((ref) => transaction.get(ref)))
    const now = admin.firestore.FieldValue.serverTimestamp()
    const grantedProductIds = []
    const repairedProductIds = []
    const skippedProductIds = []

    productIds.forEach((productId, index) => {
      const product = productSnaps[index].data() || {}
      const entitlementSnap = accessSnaps[index]
      const librarySnap = accessSnaps[productIds.length + index]
      const entitlementActive = activeSnapshot(entitlementSnap)
      const libraryActive = activeSnapshot(librarySnap)

      if (entitlementActive && libraryActive) {
        skippedProductIds.push(productId)
        return
      }

      if (entitlementActive || libraryActive) {
        const sourceData = entitlementActive ? entitlementSnap.data() || {} : librarySnap.data() || {}
        const snapshot = productSnapshot(productId, product)
        const repairPayload = {
          ...sourceData,
          uid,
          userId: uid,
          buyerUid: uid,
          ownerUid: uid,
          productId,
          status: 'active',
          productTitle: sourceData.productTitle || snapshot.title,
          productSnapshot: {
            ...snapshot,
            ...(sourceData.productSnapshot || {})
          },
          updatedAt: now
        }
        if (!entitlementActive) transaction.set(entitlementRefs[index], repairPayload, { merge: true })
        if (!libraryActive) {
          transaction.set(libraryRefs[index], {
            ...repairPayload,
            acquiredAt: sourceData.acquiredAt || sourceData.grantedAt || sourceData.createdAt || now
          }, { merge: true })
        }
        repairedProductIds.push(productId)
        return
      }

      const payload = systemGrantPayload({
        uid,
        productId,
        product,
        claims,
        orderId: orderRef.id,
        now
      })
      transaction.set(entitlementRefs[index], payload, { merge: true })
      transaction.set(libraryRefs[index], payload, { merge: true })
      grantedProductIds.push(productId)
    })

    if (grantedProductIds.length) {
      const grantedItems = grantedProductIds.map((productId) => {
        const index = productIds.indexOf(productId)
        const product = productSnaps[index].data() || {}
        const snapshot = productSnapshot(productId, product)
        return {
          productId,
          title: snapshot.title,
          creatorUid: snapshot.creatorUid,
          artistName: snapshot.creatorName,
          amountCents: 0,
          currency: cleanString(product.currency || 'USD', 12).toUpperCase(),
          entitlementStatus: 'active',
          acquisitionType: 'System Given',
          productSnapshot: snapshot
        }
      })
      transaction.set(orderRef, {
        orderId: orderRef.id,
        uid,
        buyerUid: uid,
        productIds: grantedProductIds,
        productCount: grantedProductIds.length,
        itemCount: grantedProductIds.length,
        items: grantedItems,
        source: 'admin_give_product',
        acquisitionType: 'System Given',
        status: 'paid',
        paymentStatus: 'system_given',
        refundStatus: '',
        amountTotalCents: 0,
        amountCents: 0,
        currency: grantedItems[0]?.currency || 'USD',
        livemode: false,
        paymentSource: 'admin_give_product',
        grantedBy: claims.uid,
        grantedAt: now,
        createdAt: now,
        paidAt: now,
        updatedAt: now
      })
    }

    transaction.set(auditRef, {
      id: auditRef.id,
      ...buildAdminAuditLogEntry({
        actorUid: claims.uid,
        actorEmail: claims.email,
        actorRole: claims.adminRole,
        action: 'admin_give_product',
        targetType: 'user',
        targetId: uid,
        targetPath: `users/${uid}/libraryItems`,
        reason: 'Admin emergency product grant',
        after: {
          userId: uid,
          orderId: grantedProductIds.length ? orderRef.id : '',
          acquisitionType: 'System Given',
          source: 'admin_give_product',
          productIds,
          grantedProductIds,
          repairedProductIds,
          skippedProductIds
        }
      })
    })

    return {
      orderId: grantedProductIds.length ? orderRef.id : '',
      grantedProductIds,
      repairedProductIds,
      skippedProductIds
    }
  })

  if (result.grantedProductIds.length) {
    await writeAccountEvent(db(), uid, {
      type: 'order_created',
      severity: 'success',
      title: 'Product access added',
      message: `${result.grantedProductIds.length} product${result.grantedProductIds.length === 1 ? '' : 's'} added to your library by Melogic Records.`,
      actorUid: claims.uid,
      actorType: 'admin',
      source: 'admin_give_product',
      path: '/account/library',
      metadata: {
        orderId: result.orderId,
        productIds: result.grantedProductIds
      }
    }).catch((error) => {
      logger.error('[admin-give-product] account event write failed', {
        uid,
        productIds: result.grantedProductIds,
        message: error?.message || ''
      })
    })
  }

  logger.info('[admin-give-product] grant completed', {
    actorUid: claims.uid,
    uid,
    ...result
  })
  return { ok: true, uid, ...result }
})

module.exports = {
  grantAdminProducts,
  __test: {
    normalizeProductIds,
    systemGrantPayload
  }
}
