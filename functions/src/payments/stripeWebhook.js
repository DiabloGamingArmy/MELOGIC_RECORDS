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

    const session = event.data.object
    logger.info('[stripe-webhook] checkout event received', {
      eventId: event.id || '',
      eventType: event.type || '',
      stripeSessionId: session?.id || '',
      paymentStatus: session?.payment_status || '',
      livemode: session?.livemode === true
    })

    if (session?.payment_status !== 'paid') {
      logger.warn('[stripe-webhook] checkout not paid; fulfillment skipped', {
        eventId: event.id || '',
        stripeSessionId: session?.id || '',
        paymentStatus: session?.payment_status || ''
      })
      res.status(200).json({ received: true, skipped: 'payment_not_paid' })
      return
    }

    try {
      const result = await fulfillPaidCheckout({
        session,
        eventId: event.id,
        eventType: event.type,
        source: 'stripe_webhook'
      })

      if (result.changed) {
        await Promise.all([
          writeAccountEvent(admin.firestore(), result.uid, {
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
          }),
          writeAdminAuditLog({
            actorUid: 'stripe',
            actorEmail: '',
            actorRole: 'system',
            action: result.repairedProductIds.length ? 'order_entitlements_repaired' : 'order_paid',
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
              livemode: session.livemode === true,
              amountTotal: session.amount_total || 0,
              currency: session.currency || ''
            }
          })
        ])
      }

      logger.info(result.changed
        ? '[stripe-webhook] checkout fulfillment completed'
        : '[stripe-webhook] duplicate checkout event was a safe no-op', {
        eventId: event.id || '',
        orderId: result.orderId,
        uid: result.uid,
        stripeSessionId: result.stripeSessionId,
        grantedProductIds: result.grantedProductIds,
        repairedProductIds: result.repairedProductIds,
        duplicateProductIds: result.duplicateProductIds
      })
      res.status(200).json({ received: true, processed: result.changed, ...result })
    } catch (error) {
      logger.error('[stripe-webhook] checkout fulfillment failed', {
        eventId: event.id || '',
        eventType: event.type || '',
        stripeSessionId: session?.id || '',
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
