const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { logger } = require('firebase-functions')
const admin = require('firebase-admin')
const Stripe = require('stripe')
const { writeAccountEvent } = require('../account/accountEvents')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { fulfillPaidCheckout } = require('./checkoutFulfillment')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')
const FULFILLMENT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded'
])

exports.stripeWebhook = onRequest(
  {
    secrets: [STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET],
    cors: false
  },
  async (req, res) => {
    if (req.method !== 'POST') {
      res.status(405).send('Method Not Allowed')
      return
    }

    const signature = req.headers['stripe-signature']
    if (!signature) {
      logger.warn('[stripe-webhook] request missing Stripe signature')
      res.status(400).send('Missing Stripe signature.')
      return
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value())
    let event
    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value())
    } catch (error) {
      logger.error('[stripe-webhook] signature verification failed', {
        message: error?.message || ''
      })
      res.status(400).send('Invalid signature.')
      return
    }

    if (!FULFILLMENT_EVENTS.has(event.type)) {
      logger.info('[stripe-webhook] event ignored', {
        eventId: event.id || '',
        eventType: event.type || ''
      })
      res.status(200).json({ received: true, ignored: true })
      return
    }

    let session = event.data.object
    logger.info('[stripe-webhook] checkout event received', {
      eventId: event.id || '',
      eventType: event.type || '',
      sessionId: session?.id || '',
      stripeSessionId: session?.id || '',
      payment_status: session?.payment_status || '',
      paymentStatus: session?.payment_status || '',
      orderId: session?.metadata?.orderId || '',
      buyerUid: session?.metadata?.buyerUid || session?.metadata?.uid || '',
      productIdsCount: (() => {
        try {
          const parsed = JSON.parse(session?.metadata?.productIds || '[]')
          return Array.isArray(parsed) ? parsed.length : 0
        } catch {
          return 0
        }
      })(),
      livemode: session?.livemode === true
    })

    if (session?.payment_status !== 'paid') {
      logger.warn('[stripe-webhook] checkout not paid; fulfillment skipped', {
        eventId: event.id || '',
        eventType: event.type || '',
        sessionId: session?.id || '',
        stripeSessionId: session?.id || '',
        payment_status: session?.payment_status || '',
        paymentStatus: session?.payment_status || '',
        orderId: session?.metadata?.orderId || '',
        buyerUid: session?.metadata?.buyerUid || session?.metadata?.uid || '',
        fulfillmentResult: 'skipped_payment_not_paid',
        orderMarkedPaid: false
      })
      res.status(200).json({ received: true, skipped: 'payment_not_paid' })
      return
    }

    try {
      session = await stripe.checkout.sessions.retrieve(session.id, {
        expand: ['payment_intent.latest_charge.balance_transaction']
      }).catch((error) => {
        logger.warn('[stripe-webhook] expanded payment fee lookup failed', {
          eventId: event.id || '',
          stripeSessionId: session?.id || '',
          code: error?.code || '',
          message: error?.message || ''
        })
        return session
      })
      const result = await fulfillPaidCheckout({
        session,
        eventId: event.id,
        eventType: event.type,
        source: 'stripe_webhook'
      })

      if (result.changed) {
        const auditWrites = [
          writeAdminAuditLog({
            actorUid: 'stripe',
            actorEmail: '',
            actorRole: 'system',
            action: result.customerLifecycleChanged
              ? (result.repairedProductIds.length ? 'order_entitlements_repaired' : 'order_paid')
              : 'creator_ledger_recorded',
            targetType: 'order',
            targetId: result.orderId,
            targetPath: `orders/${result.orderId}`,
            reason: event.type,
            after: {
              buyerUid: result.uid,
              stripeSessionId: result.stripeSessionId,
              productIds: result.productIds,
              grantedProductIds: result.grantedProductIds,
              repairedProductIds: result.repairedProductIds,
              ledgerEntryIds: result.ledgerEntryIds,
              repairedLedgerEntryIds: result.repairedLedgerEntryIds,
              livemode: session.livemode === true,
              amountTotal: session.amount_total || 0,
              currency: session.currency || ''
            }
          })
        ]
        if (result.customerLifecycleChanged) {
          auditWrites.push(writeAccountEvent(admin.firestore(), result.uid, {
            type: 'order_placed',
            severity: 'success',
            title: 'Order Placed',
            message: 'Your purchase is complete and available in your library.',
            actorType: 'system',
            source: 'stripe_webhook',
            path: '/account/library',
            metadata: {
              orderId: result.orderId,
              stripeSessionId: result.stripeSessionId,
              productIds: result.productIds,
              repairedProductIds: result.repairedProductIds,
              amountTotalCents: session.amount_total ?? null,
              currency: session.currency || ''
            }
          }))
        }
        await Promise.all(auditWrites)
      }

      logger.info(result.changed
        ? '[stripe-webhook] checkout fulfillment completed'
        : '[stripe-webhook] duplicate checkout event was a safe no-op', {
        eventId: event.id || '',
        eventType: event.type || '',
        sessionId: result.stripeSessionId,
        stripeSessionId: result.stripeSessionId,
        payment_status: session?.payment_status || '',
        orderId: result.orderId,
        buyerUid: result.uid,
        uid: result.uid,
        productIdsCount: result.productIds.length,
        fulfillmentResult: result.changed ? 'processed' : 'duplicate_noop',
        grantedProductIds: result.grantedProductIds,
        repairedProductIds: result.repairedProductIds,
        duplicateProductIds: result.duplicateProductIds,
        ledgerEntryIds: result.ledgerEntryIds,
        repairedLedgerEntryIds: result.repairedLedgerEntryIds,
        missingCreatorProductIds: result.missingCreatorProductIds,
        orderMarkedPaid: result.orderMarkedPaid === true
      })
      res.status(200).json({ received: true, processed: result.changed, ...result })
    } catch (error) {
      logger.error('[stripe-webhook] checkout fulfillment failed', {
        eventId: event.id || '',
        eventType: event.type || '',
        sessionId: session?.id || '',
        stripeSessionId: session?.id || '',
        payment_status: session?.payment_status || '',
        orderId: session?.metadata?.orderId || '',
        buyerUid: session?.metadata?.buyerUid || session?.metadata?.uid || '',
        fulfillmentResult: 'failed',
        orderMarkedPaid: false,
        code: error?.code || '',
        message: error?.message || '',
        metadata: {
          buyerUid: session?.metadata?.buyerUid || session?.metadata?.uid || '',
          orderId: session?.metadata?.orderId || '',
          hasProductIds: Boolean(session?.metadata?.productIds)
        }
      })
      res.status(500).send('Webhook handling failed.')
    }
  }
)

exports.__test = {
  FULFILLMENT_EVENTS
}
