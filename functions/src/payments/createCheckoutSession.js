const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret, defineString } = require('firebase-functions/params')
const Stripe = require('stripe')
const admin = require('firebase-admin')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const PUBLIC_SITE_URL = defineString('PUBLIC_SITE_URL', {
  default: 'https://melogic-records.web.app'
})

const db = admin.firestore()

exports.createCheckoutSession = onCall(
  {
    secrets: [STRIPE_SECRET_KEY],
    timeoutSeconds: 60,
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) {
      throw new HttpsError('unauthenticated', 'You must be signed in to checkout.')
    }

    const inputIds = request.data?.productIds
    if (!Array.isArray(inputIds) || inputIds.length === 0) {
      throw new HttpsError('invalid-argument', 'productIds must be a non-empty array.')
    }
    if (inputIds.length > 25) {
      throw new HttpsError('invalid-argument', 'You can checkout up to 25 products at a time.')
    }

    const productIds = [...new Set(inputIds.map((id) => String(id || '').trim()).filter(Boolean))]
    if (!productIds.length) {
      throw new HttpsError('invalid-argument', 'No valid product IDs were provided.')
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY.value())
    const now = admin.firestore.FieldValue.serverTimestamp()

    const productDocs = await Promise.all(productIds.map((productId) => db.collection('products').doc(productId).get()))

    const paidProducts = []
    const freeProducts = []

    for (let i = 0; i < productDocs.length; i += 1) {
      const doc = productDocs[i]
      const productId = productIds[i]
      if (!doc.exists) {
        throw new HttpsError('not-found', `Product not found: ${productId}`)
      }

      const product = doc.data() || {}
      const canAccess = (product.status === 'published' && product.visibility === 'public') || product.artistId === uid
      if (!canAccess) {
        throw new HttpsError('permission-denied', `Product is not available for purchase: ${productId}`)
      }
      if (product.artistId === uid) continue

      const [entitlementDoc, libraryDoc] = await Promise.all([
        db.doc(`users/${uid}/entitlements/${productId}`).get(),
        db.doc(`users/${uid}/libraryItems/${productId}`).get()
      ])
      if (entitlementDoc.exists || libraryDoc.exists) continue

      const priceCents = Number(product.priceCents || 0)
      const isFree = Boolean(product.isFree) || priceCents <= 0

      if (isFree) {
        freeProducts.push({ productId, product })
      } else {
        if (!Number.isInteger(priceCents) || priceCents <= 0) {
          throw new HttpsError('failed-precondition', `Invalid paid product price for ${productId}.`)
        }
        paidProducts.push({ productId, product, priceCents })
      }
    }

    if (!paidProducts.length && freeProducts.length) {
      throw new HttpsError('failed-precondition', 'This cart only has free products. Use the free-claim flow for free items.')
    }

    if (!paidProducts.length) {
      throw new HttpsError('already-exists', 'All selected products are already in your library.')
    }

    const currencies = [...new Set(paidProducts.map(({ product }) => String(product.currency || 'usd').toLowerCase()))]
    if (currencies.length > 1) {
      throw new HttpsError('failed-precondition', 'All paid products in one checkout must use the same currency.')
    }

    const currency = currencies[0] || 'usd'
    const amountTotalCents = paidProducts.reduce((sum, item) => sum + item.priceCents, 0)
    const paidProductIds = paidProducts.map((item) => item.productId)

    const orderRef = db.collection('orders').doc()
    const serializedProductIds = JSON.stringify(paidProductIds)
    const checkoutMetadata = {
      uid,
      buyerUid: uid,
      orderId: orderRef.id,
      ...(serializedProductIds.length <= 450 ? { productIds: serializedProductIds } : {})
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      client_reference_id: uid,
      success_url: `${PUBLIC_SITE_URL.value()}/account/library?purchase=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${PUBLIC_SITE_URL.value()}/cart?checkout=cancelled`,
      line_items: paidProducts.map(({ productId, product, priceCents }) => ({
        quantity: 1,
        price_data: {
          currency,
          unit_amount: priceCents,
          product_data: {
            name: String(product.title || 'Untitled product'),
            metadata: {
              productId
            }
          }
        }
      })),
      metadata: checkoutMetadata,
      payment_intent_data: {
        metadata: checkoutMetadata
      }
      // TODO: Stripe Connect marketplace payouts (seller stripeAccountId, application_fee_amount, transfer_data.destination).
    })

    await orderRef.set({
      uid,
      buyerUid: uid,
      productIds: paidProductIds,
      orderId: orderRef.id,
      items: paidProducts.map(({ productId, product, priceCents }) => ({
        productId,
        title: String(product.title || productId),
        creatorUid: String(product.artistId || ''),
        amountCents: priceCents,
        currency: String(product.currency || currency).toUpperCase(),
        entitlementStatus: 'pending',
        productSnapshot: {
          title: String(product.title || productId),
          slug: String(product.slug || ''),
          creatorName: String(product.artistName || product.artistDisplayName || 'Creator'),
          creatorUid: String(product.artistId || ''),
          coverPath: String(product.coverPath || product.thumbnailPath || ''),
          coverURL: String(product.coverURL || product.thumbnailURL || ''),
          productType: String(product.productType || product.productKind || 'Product'),
          usageLicense: String(product.usageLicense || 'Standard License'),
          sizeBytes: Math.max(0, Math.round(Number(product.primaryDownloadBytes || product.assetSummary?.totalBytes || 0)))
        }
      })),
      status: 'checkout_created',
      paymentStatus: 'checkout_created',
      stripeSessionId: session.id,
      checkoutSessionId: session.id,
      amountTotalCents,
      amountCents: amountTotalCents,
      currency,
      livemode: session.livemode === true,
      paymentSource: session.livemode === true ? 'stripe_live' : 'stripe_test',
      createdAt: now,
      updatedAt: now
    })

    return {
      url: session.url,
      sessionId: session.id
    }
  }
)
