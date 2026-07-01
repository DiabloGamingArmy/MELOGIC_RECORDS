const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Stripe = require('stripe')
const { fulfillPaidCheckout, resolveCheckoutContext } = require('./checkoutFulfillment')
const { writeAccountEvent } = require('../account/accountEvents')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')

const reconcileCheckoutSession = onCall({
  secrets: [STRIPE_SECRET_KEY],
  timeoutSeconds: 60,
  memory: '256MiB',
  cors: true
}, async (request) => {
  const uid = String(request.auth?.uid || '').trim()
  const sessionId = String(request.data?.sessionId || '').trim()
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to reconcile checkout access.')
  if (!sessionId || sessionId.includes('/') || !sessionId.startsWith('cs_')) {
    throw new HttpsError('invalid-argument', 'A valid Stripe checkout session ID is required.')
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY.value())
  let session
  try {
    session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['payment_intent.latest_charge.balance_transaction']
    })
  } catch (error) {
    logger.error('[checkout-reconcile] Stripe session lookup failed', {
      sessionId,
      uid,
      code: error?.code || '',
      message: error?.message || ''
    })
    throw new HttpsError('not-found', 'Checkout session could not be verified.')
  }

  if (session.payment_status !== 'paid') {
    logger.warn('[checkout-reconcile] unpaid checkout rejected', {
      sessionId,
      uid,
      payment_status: session.payment_status || '',
      paymentStatus: session.payment_status || '',
      orderId: session.metadata?.orderId || '',
      buyerUid: session.metadata?.buyerUid || session.metadata?.uid || '',
      fulfillmentResult: 'skipped_payment_not_paid',
      orderMarkedPaid: false
    })
    throw new HttpsError('failed-precondition', 'Checkout payment is not confirmed.')
  }

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
      fulfillmentResult: 'failed',
      orderMarkedPaid: false,
      code: error?.code || '',
      message: error?.message || ''
    })
    throw new HttpsError('internal', 'Paid checkout access could not be reconciled.')
  }
})

module.exports = {
  reconcileCheckoutSession
}
