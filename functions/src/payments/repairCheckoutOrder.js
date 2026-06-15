const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const Stripe = require('stripe')
const { requireAdminActionSecurity, cleanString } = require('../admin/adminAuth')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { writeAccountEvent } = require('../account/accountEvents')
const { rebuildCommerceSummary } = require('../account/commerceSummary')
const { fulfillPaidCheckout, resolveCheckoutContext, __test: checkoutTest } = require('./checkoutFulfillment')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')

function unpaidOrderFields(session = {}, order = {}) {
  const amountTotalCents = checkoutTest.stripeAmount(session.amount_total, checkoutTest.stripeAmount(order.amountTotalCents ?? order.amountCents, null))
  const amountSubtotalCents = checkoutTest.stripeAmount(session.amount_subtotal, checkoutTest.stripeAmount(order.amountSubtotalCents, amountTotalCents))
  const expired = session.status === 'expired'
  return {
    status: expired ? 'checkout_expired' : 'checkout_created',
    paymentStatus: cleanString(session.payment_status || 'unpaid', 80),
    orderState: expired ? 'checkout_expired' : 'checkout_created',
    checkoutStatus: cleanString(session.status || '', 80),
    amountSubtotalCents,
    amountTotalCents,
    amountCents: amountTotalCents,
    amountSource: 'stripe_checkout_session',
    currency: cleanString(session.currency || order.currency || 'usd', 12).toUpperCase(),
    livemode: session.livemode === true,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
}

async function repairCheckoutOrder({
  database = admin.firestore(),
  stripe,
  orderId = '',
  actor = { uid: 'system', email: '', adminRole: 'system' }
} = {}) {
  const safeOrderId = cleanString(orderId, 180)
  if (!safeOrderId || safeOrderId.includes('/')) throw new Error('A valid order ID is required.')
  const orderRef = database.collection('orders').doc(safeOrderId)
  const orderSnap = await orderRef.get()
  if (!orderSnap.exists) {
    const error = new Error('Order not found.')
    error.code = 'order-not-found'
    throw error
  }
  const order = orderSnap.data() || {}
  const sessionId = cleanString(order.stripeSessionId || order.checkoutSessionId || '', 180)
  if (!sessionId) {
    const error = new Error('Order does not have a Stripe checkout session ID.')
    error.code = 'session-id-missing'
    throw error
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  const context = await resolveCheckoutContext(database, session)
  if (context.orderId !== safeOrderId) {
    const error = new Error('Stripe session resolves to a different order.')
    error.code = 'order-session-mismatch'
    throw error
  }

  let fulfillment = null
  if (session.payment_status === 'paid') {
    fulfillment = await fulfillPaidCheckout({
      database,
      session,
      eventId: `admin_repair_${session.id}`,
      eventType: 'checkout.session.admin_repaired',
      source: 'admin_order_repair'
    })
    if (fulfillment.changed) {
      await writeAccountEvent(database, context.uid, {
        type: 'order_placed',
        severity: 'success',
        title: 'Order Placed',
        message: 'Your completed purchase was verified and added to your order history.',
        actorUid: actor.uid,
        actorType: 'admin',
        source: 'admin_order_repair',
        path: `/account/orders/${encodeURIComponent(safeOrderId)}`,
        metadata: {
          orderId: safeOrderId,
          stripeSessionId: session.id,
          productIds: fulfillment.productIds,
          amountTotalCents: session.amount_total ?? null,
          currency: session.currency || ''
        }
      })
    }
  } else {
    await orderRef.set(unpaidOrderFields(session, order), { merge: true })
    await rebuildCommerceSummary(database, context.uid)
  }

  await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: session.payment_status === 'paid' ? 'order_repaired_from_stripe' : 'order_status_synced_from_stripe',
    targetType: 'order',
    targetId: safeOrderId,
    targetPath: `orders/${safeOrderId}`,
    reason: 'Trusted Stripe checkout session reconciliation',
    after: {
      buyerUid: context.uid,
      stripeSessionId: session.id,
      checkoutStatus: session.status || '',
      paymentStatus: session.payment_status || '',
      amountSubtotalCents: session.amount_subtotal ?? null,
      amountTotalCents: session.amount_total ?? null,
      currency: session.currency || '',
      paymentIntentId: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || '',
      fulfillment
    }
  })

  logger.info('[admin-order-repair] Stripe order repair completed', {
    actorUid: actor.uid,
    orderId: safeOrderId,
    uid: context.uid,
    stripeSessionId: session.id,
    checkoutStatus: session.status || '',
    paymentStatus: session.payment_status || '',
    amountTotalCents: session.amount_total ?? null
  })
  return {
    ok: true,
    orderId: safeOrderId,
    uid: context.uid,
    stripeSessionId: session.id,
    checkoutStatus: session.status || '',
    paymentStatus: session.payment_status || '',
    amountSubtotalCents: session.amount_subtotal ?? null,
    amountTotalCents: session.amount_total ?? null,
    currency: session.currency || '',
    fulfillment
  }
}

const repairAdminCheckoutOrder = onCall({
  secrets: [STRIPE_SECRET_KEY],
  timeoutSeconds: 60,
  memory: '256MiB'
}, async (request) => {
  const claims = await requireAdminActionSecurity(request, 'orderSupport')
  const orderId = cleanString(request.data?.orderId || '', 180)
  if (!orderId || orderId.includes('/')) throw new HttpsError('invalid-argument', 'A valid order ID is required.')
  try {
    return await repairCheckoutOrder({
      stripe: new Stripe(STRIPE_SECRET_KEY.value()),
      orderId,
      actor: claims
    })
  } catch (error) {
    logger.error('[admin-order-repair] repair failed', {
      actorUid: claims.uid,
      orderId,
      code: error?.code || '',
      message: error?.message || ''
    })
    const code = error?.code === 'order-not-found' ? 'not-found'
      : ['session-id-missing', 'order-session-mismatch'].includes(error?.code) ? 'failed-precondition'
        : 'internal'
    throw new HttpsError(code, error?.message || 'Order could not be repaired from Stripe.')
  }
})

module.exports = {
  repairAdminCheckoutOrder,
  repairCheckoutOrder,
  __test: {
    unpaidOrderFields
  }
}
