const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Stripe = require('stripe')
const { fulfillPaidCheckout, resolveCheckoutContext } = require('./checkoutFulfillment')
const { writeAccountEvent } = require('../account/accountEvents')
const { getRequesterClaims } = require('../admin/adminAuth')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')

function cleanString(value = '', max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

async function orderSessionId(database, orderId = '') {
  const safeOrderId = cleanString(orderId, 180)
  if (!safeOrderId || safeOrderId.includes('/')) return ''
  const snap = await database.collection('orders').doc(safeOrderId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Checkout order was not found.')
  const order = snap.data() || {}
  return cleanString(order.stripeSessionId || order.checkoutSessionId || '', 180)
}

async function retrievePaidSession({ stripe, database, sessionId = '', orderId = '', uid = '', stage = 'checkout_repair' } = {}) {
  const safeSessionId = cleanString(sessionId || await orderSessionId(database, orderId), 180)
  if (!safeSessionId || safeSessionId.includes('/') || !safeSessionId.startsWith('cs_')) {
    throw new HttpsError('invalid-argument', 'A valid Stripe checkout session ID is required.')
  }
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(safeSessionId, {
      expand: ['payment_intent.latest_charge.balance_transaction']
    })
  } catch (error) {
    logger.error('[checkout-repair] Stripe session lookup failed', {
      stage,
      sessionId: safeSessionId,
      orderId,
      uid,
      code: error?.code || '',
      message: error?.message || ''
    })
    throw new HttpsError('not-found', 'Checkout session could not be verified.')
  }
  if (session.payment_status !== 'paid') {
    logger.warn('[checkout-repair] unpaid checkout rejected', {
      stage,
      sessionId: safeSessionId,
      orderId: session.metadata?.orderId || orderId || '',
      uid,
      payment_status: session.payment_status || '',
      productIds: session.metadata?.productIds || ''
    })
    throw new HttpsError('failed-precondition', 'Checkout payment is not confirmed.')
  }
  return session
}

const reconcileCheckoutSession = onCall({
  secrets: [STRIPE_SECRET_KEY],
  timeoutSeconds: 60,
  memory: '256MiB',
  cors: true
}, async (request) => {
  const uid = String(request.auth?.uid || '').trim()
  const sessionId = cleanString(request.data?.sessionId || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to reconcile checkout access.')
  if (!sessionId || sessionId.includes('/') || !sessionId.startsWith('cs_')) {
    throw new HttpsError('invalid-argument', 'A valid Stripe checkout session ID is required.')
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY.value())
  const session = await retrievePaidSession({
    stripe,
    database: admin.firestore(),
    sessionId,
    uid,
    stage: 'checkout_reconcile'
  })

  const context = await resolveCheckoutContext(admin.firestore(), session)
  logger.info('[checkout-reconcile] paid checkout reconciliation started', {
    eventId: `reconcile_${session.id}`,
    eventType: 'checkout.session.reconciled',
    sessionId,
    stripeSessionId: sessionId,
    payment_status: session.payment_status || '',
    orderId: context.orderId,
    buyerUid: context.uid,
    requesterUid: uid,
    productIdsCount: context.productIds.length
  })
  if (context.uid !== uid) {
    logger.warn('[checkout-reconcile] buyer mismatch rejected', {
      sessionId,
      requesterUid: uid,
      buyerUid: context.uid
    })
    throw new HttpsError('permission-denied', 'This checkout belongs to another account.')
  }

  try {
    const result = await fulfillPaidCheckout({
      session,
      eventId: `reconcile_${session.id}`,
      eventType: 'checkout.session.reconciled',
      source: 'buyer_checkout_reconcile'
    })
    if (result.customerLifecycleChanged) {
      await writeAccountEvent(admin.firestore(), uid, {
        type: 'order_placed',
        severity: 'success',
        title: 'Order Placed',
        message: 'Your purchase is complete and available in your library.',
        actorType: 'system',
        source: 'buyer_checkout_reconcile',
        path: `/account/orders/${encodeURIComponent(result.orderId)}`,
        metadata: {
          orderId: result.orderId,
          stripeSessionId: result.stripeSessionId,
          productIds: result.productIds,
          sellerSaleIds: result.sellerSaleIds,
          ledgerEntryIds: result.ledgerEntryIds,
          platformRevenueEntryIds: result.platformRevenueEntryIds,
          amountTotalCents: session.amount_total ?? null,
          currency: session.currency || ''
        }
      })
    }
    logger.info('[checkout-reconcile] access verified', {
      eventId: `reconcile_${session.id}`,
      eventType: 'checkout.session.reconciled',
      sessionId,
      stripeSessionId: result.stripeSessionId,
      payment_status: session.payment_status || '',
      uid,
      buyerUid: result.uid,
      orderId: result.orderId,
      productIdsCount: result.productIds.length,
      fulfillmentResult: result.changed ? 'processed' : 'duplicate_noop',
      grantedProductIds: result.grantedProductIds,
      repairedProductIds: result.repairedProductIds,
      duplicateProductIds: result.duplicateProductIds,
      libraryWriteCount: result.libraryWriteCount,
      entitlementWriteCount: result.entitlementWriteCount,
      ledgerEntryIds: result.ledgerEntryIds,
      repairedLedgerEntryIds: result.repairedLedgerEntryIds,
      sellerSaleIds: result.sellerSaleIds,
      repairedSellerSaleIds: result.repairedSellerSaleIds,
      platformRevenueEntryIds: result.platformRevenueEntryIds,
      missingCreatorProductIds: result.missingCreatorProductIds,
      buyerOrderMirrorWritten: result.buyerOrderMirrorWritten === true,
      skippedReasons: result.skippedReasons,
      orderMarkedPaid: result.orderMarkedPaid === true
    })
    return { ok: true, ...result }
  } catch (error) {
    logger.error('[checkout-reconcile] fulfillment failed', {
      eventId: `reconcile_${session.id}`,
      eventType: 'checkout.session.reconciled',
      sessionId,
      stripeSessionId: sessionId,
      payment_status: session.payment_status || '',
      uid,
      buyerUid: session.metadata?.buyerUid || session.metadata?.uid || '',
      orderId: session.metadata?.orderId || '',
      productIds: session.metadata?.productIds || '',
      stage: 'fulfillment',
      fulfillmentResult: 'failed',
      orderMarkedPaid: false,
      code: error?.code || '',
      message: error?.message || ''
    })
    throw new HttpsError('internal', 'Paid checkout access could not be reconciled.')
  }
})

const repairPaidCheckoutAccess = onCall({
  secrets: [STRIPE_SECRET_KEY],
  timeoutSeconds: 60,
  memory: '256MiB',
  cors: true
}, async (request) => {
  const claims = getRequesterClaims(request)
  const uid = claims.uid
  const sessionId = cleanString(request.data?.sessionId || '', 180)
  const orderId = cleanString(request.data?.orderId || '', 180)
  if (!sessionId && !orderId) {
    throw new HttpsError('invalid-argument', 'A checkout session ID or order ID is required.')
  }
  const database = admin.firestore()
  const stripe = new Stripe(STRIPE_SECRET_KEY.value())
  const session = await retrievePaidSession({
    stripe,
    database,
    sessionId,
    orderId,
    uid,
    stage: 'emergency_access_repair'
  })
  const context = await resolveCheckoutContext(database, session)
  const isAdminRepair = claims.admin === true || claims.orderSupport === true || claims.auditRead === true
  if (context.uid !== uid && !isAdminRepair) {
    logger.warn('[checkout-repair] buyer mismatch rejected', {
      stage: 'authorization',
      sessionId: session.id || sessionId,
      orderId: context.orderId,
      requesterUid: uid,
      buyerUid: context.uid
    })
    throw new HttpsError('permission-denied', 'This checkout belongs to another account.')
  }
  try {
    const result = await fulfillPaidCheckout({
      session,
      eventId: `repair_${session.id}`,
      eventType: 'checkout.session.access_repair',
      source: isAdminRepair ? 'admin_checkout_access_repair' : 'buyer_checkout_access_repair'
    })
    logger.info('[checkout-repair] paid checkout access repaired', {
      stage: 'fulfillment',
      sessionId: session.id || '',
      orderId: result.orderId,
      buyerUid: result.uid,
      requesterUid: uid,
      isAdminRepair,
      productIds: result.productIds,
      libraryWriteCount: result.libraryWriteCount,
      entitlementWriteCount: result.entitlementWriteCount,
      grantedProductIds: result.grantedProductIds,
      repairedProductIds: result.repairedProductIds,
      duplicateProductIds: result.duplicateProductIds,
      ledgerEntryIds: result.ledgerEntryIds,
      missingCreatorProductIds: result.missingCreatorProductIds
    })
    return { ok: true, ...result }
  } catch (error) {
    logger.error('[checkout-repair] paid checkout access repair failed', {
      stage: 'fulfillment',
      sessionId: session.id || sessionId,
      orderId: context.orderId,
      buyerUid: context.uid,
      requesterUid: uid,
      productIds: context.productIds,
      code: error?.code || '',
      message: error?.message || ''
    })
    throw new HttpsError('internal', 'Paid checkout access could not be repaired.')
  }
})

module.exports = {
  reconcileCheckoutSession,
  repairPaidCheckoutAccess,
  __test: {
    cleanString
  }
}
