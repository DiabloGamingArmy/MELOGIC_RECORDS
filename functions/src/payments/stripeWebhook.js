const { onRequest } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const Stripe = require('stripe')
const admin = require('firebase-admin')
const { writeAccountEvent } = require('../account/accountEvents')
const { writeAdminAuditLog } = require('../admin/auditLog')

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
    const uid = session?.metadata?.buyerUid || session?.metadata?.uid
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
      let processedCheckout = false
      await db.runTransaction(async (tx) => {
        const orderSnap = await tx.get(orderRef)
        if (!orderSnap.exists) {
          throw new Error('Order not found.')
        }

        const order = orderSnap.data() || {}
        if (order.status === 'paid' || order.paymentStatus === 'paid') return

        const now = admin.firestore.FieldValue.serverTimestamp()
        const productSnaps = await Promise.all(productIds.map((productId) => tx.get(db.collection('products').doc(productId))))
        productIds.forEach((productId, index) => {
          const productSnap = productSnaps[index]
          const product = productSnap.exists ? productSnap.data() || {} : {}
          const productSnapshot = {
            title: String(product.title || productId).slice(0, 180),
            slug: String(product.slug || '').slice(0, 180),
            creatorName: String(product.artistName || product.artistDisplayName || '').slice(0, 180),
            creatorUid: String(product.artistId || '').slice(0, 180),
            coverPath: String(product.coverPath || product.thumbnailPath || '').slice(0, 900),
            coverURL: String(product.coverURL || product.thumbnailURL || '').slice(0, 900),
            productType: String(product.productType || product.productKind || '').slice(0, 120),
            usageLicense: String(product.usageLicense || 'Standard License').slice(0, 160)
          }
          const entitlementRef = db.doc(`users/${uid}/entitlements/${productId}`)
          tx.set(entitlementRef, {
            uid,
            productId,
            source: 'stripe-checkout',
            status: 'active',
            orderId,
            stripeSessionId,
            license: productSnapshot.usageLicense,
            productSnapshot,
            createdAt: now,
            updatedAt: now
          }, { merge: true })
          const libraryRef = db.doc(`users/${uid}/libraryItems/${productId}`)
          tx.set(libraryRef, {
            uid,
            productId,
            source: 'purchase',
            status: 'active',
            orderId,
            stripeSessionId,
            license: productSnapshot.usageLicense,
            productSnapshot,
            acquiredAt: now,
            createdAt: now,
            updatedAt: now
          }, { merge: true })
        })

        tx.update(orderRef, {
          buyerUid: uid,
          status: 'paid',
          paymentStatus: 'paid',
          paidAt: now,
          stripeSessionId,
          paymentIntentId: session.payment_intent || null,
          amountCents: Number(session.amount_total || order.amountCents || order.amountTotalCents || 0),
          amountTotalCents: Number(session.amount_total || order.amountTotalCents || order.amountCents || 0),
          currency: String(session.currency || order.currency || 'usd').toUpperCase(),
          livemode: session.livemode === true,
          paymentSource: session.livemode === true ? 'stripe_live' : 'stripe_test',
          updatedAt: now
        })
        processedCheckout = true
      })

      if (processedCheckout) {
        await Promise.all([
          writeAccountEvent(db, uid, {
            type: 'order_created',
            severity: 'success',
            title: 'Order completed',
            message: 'Your purchase is complete and your library access is being prepared.',
            actorType: 'system',
            source: 'stripe_webhook',
            path: '/account/orders',
            metadata: {
              orderId,
              stripeSessionId,
              productIds
            }
          }),
          writeAdminAuditLog({
            actorUid: 'stripe',
            actorEmail: '',
            actorRole: 'system',
            action: 'order_paid',
            targetType: 'order',
            targetId: orderId,
            targetPath: `orders/${orderId}`,
            reason: 'Stripe checkout.session.completed',
            after: {
              buyerUid: uid,
              stripeSessionId,
              productIds,
              livemode: session.livemode === true,
              amountTotal: session.amount_total || 0,
              currency: session.currency || ''
            }
          })
        ])
      }

      res.status(200).json({ received: true, processed: processedCheckout })
    } catch (error) {
      console.error('Failed to process Stripe webhook.', error?.message)
      res.status(500).send('Webhook handling failed.')
    }
  }
)
