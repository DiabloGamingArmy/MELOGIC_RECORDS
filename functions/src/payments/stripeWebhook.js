const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const Stripe = require('stripe')
const admin = require('firebase-admin')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const STRIPE_WEBHOOK_SECRET = defineSecret('STRIPE_WEBHOOK_SECRET')

const db = admin.firestore()

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
      res.status(400).send('Missing Stripe signature.')
      return
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value())
    let event

    try {
      event = stripe.webhooks.constructEvent(req.rawBody, signature, STRIPE_WEBHOOK_SECRET.value())
    } catch (error) {
      console.error('Stripe webhook signature verification failed.', error?.message)
      res.status(400).send('Invalid signature.')
      return
    }

    if (event.type !== 'checkout.session.completed') {
      res.status(200).json({ received: true, ignored: true })
      return
    }

    const session = event.data.object
    const uid = session?.metadata?.uid
    const orderId = session?.metadata?.orderId
    const stripeSessionId = session?.id

    let productIds = []
    try {
      productIds = JSON.parse(session?.metadata?.productIds || '[]')
      if (!Array.isArray(productIds)) productIds = []
    } catch {
      productIds = []
    }

    if (!uid || !orderId || !stripeSessionId || !productIds.length) {
      res.status(400).send('Missing checkout metadata.')
      return
    }

    if (session.payment_status !== 'paid') {
      res.status(200).json({ received: true, skipped: 'payment_not_paid' })
      return
    }

    try {
      const orderRef = db.collection('orders').doc(orderId)
      await db.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef)
        if (!orderSnap.exists) {
          throw new Error('Order not found.')
        }

        const order = orderSnap.data() || {}
        if (order.status === 'paid') return

        const now = admin.firestore.FieldValue.serverTimestamp()
        for (const productId of productIds) {
          const entitlementRef = db.doc(`users/${uid}/entitlements/${productId}`)
          tx.set(entitlementRef, {
            uid,
            productId,
            source: 'stripe-checkout',
            orderId,
            stripeSessionId,
            createdAt: now,
            updatedAt: now
          }, { merge: true })
        }

        tx.update(orderRef, {
          status: 'paid',
          paidAt: now,
          stripeSessionId,
          paymentIntentId: session.payment_intent || null,
          updatedAt: now
        })
      })

      res.status(200).json({ received: true })
    } catch (error) {
      console.error('Failed to process Stripe webhook.', error?.message)
      res.status(500).send('Webhook handling failed.')
    }
  }
)
