const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { writeAccountEvent } = require('../account/accountEvents')
const { rebuildCommerceSummary } = require('../account/commerceSummary')

const db = admin.firestore()

function isPublishedPublicProduct(product = {}) {
  return product.status === 'published' && product.visibility === 'public'
}

function isFreeProduct(product = {}) {
  const priceCents = Number(product.priceCents || 0)
  return Boolean(product.isFree) || priceCents <= 0
}

function productLibraryPayload({ uid = '', productId = '', product = {}, source = 'free_claim' } = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  return {
    uid,
    userId: uid,
    ownerUid: uid,
    productId,
    productTitle: String(product.title || 'Untitled product'),
    artistId: String(product.artistId || ''),
    artistName: String(product.artistName || product.artistDisplayName || 'Creator'),
    productSlug: String(product.slug || ''),
    productType: String(product.productType || 'Product'),
    priceCents: 0,
    currency: String(product.currency || 'USD'),
    acquisitionType: 'free',
    source,
    status: 'active',
    license: String(product.usageLicense || 'Standard License'),
    claimedAt: now,
    createdAt: now,
    updatedAt: now
  }
}

exports.claimFreeProduct = onCall(
  {
    timeoutSeconds: 30,
    memory: '256MiB',
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to add this product to your library.')

    const productId = String(request.data?.productId || '').trim()
    if (!productId) throw new HttpsError('invalid-argument', 'productId is required.')

    const productRef = db.collection('products').doc(productId)
    const productSnap = await productRef.get()
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')

    const product = productSnap.data() || {}
    if (product.artistId === uid) {
      return { status: 'owner', productId, alreadyOwned: true }
    }
    if (!isPublishedPublicProduct(product)) {
      throw new HttpsError('permission-denied', 'This product is not available for library claims.')
    }
    if (!isFreeProduct(product)) {
      throw new HttpsError('failed-precondition', 'Paid products must be purchased through checkout.')
    }

    const entitlementRef = db.doc(`users/${uid}/entitlements/${productId}`)
    const libraryRef = db.doc(`users/${uid}/libraryItems/${productId}`)
    const orderRef = db.collection('orders').doc()
    const payload = productLibraryPayload({ uid, productId, product })
    let createdClaim = false

    await db.runTransaction(async (tx) => {
      const [entitlementSnap, librarySnap] = await Promise.all([
        tx.get(entitlementRef),
        tx.get(libraryRef)
      ])
      const alreadyActive = [entitlementSnap, librarySnap].some((snap) => snap.exists && (snap.data()?.status || 'active') === 'active')
      if (alreadyActive) return

      tx.set(entitlementRef, {
        ...payload,
        orderId: orderRef.id,
        entitlementId: `${uid}_${productId}`,
        source: entitlementSnap.exists ? (entitlementSnap.data()?.source || payload.source) : payload.source,
        grantedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      tx.set(libraryRef, {
        ...payload,
        orderId: orderRef.id,
        entitlementId: `${uid}_${productId}`,
        acquiredAt: admin.firestore.FieldValue.serverTimestamp(),
        source: librarySnap.exists ? (librarySnap.data()?.source || payload.source) : payload.source,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      tx.set(orderRef, {
        orderId: orderRef.id,
        uid,
        buyerUid: uid,
        productIds: [productId],
        productCount: 1,
        itemCount: 1,
        items: [{
          productId,
          slug: String(product.slug || ''),
          title: String(product.title || 'Untitled product'),
          artistId: String(product.artistId || ''),
          artistName: String(product.artistName || product.artistDisplayName || 'Creator'),
          priceCents: 0,
          currency: String(product.currency || 'USD'),
          quantity: 1,
          productSnapshot: {
            title: String(product.title || 'Untitled product'),
            slug: String(product.slug || ''),
            creatorName: String(product.artistName || product.artistDisplayName || 'Creator'),
            coverPath: String(product.coverPath || product.thumbnailPath || ''),
            coverURL: String(product.coverURL || product.thumbnailURL || ''),
            productType: String(product.productType || product.productKind || 'Product'),
            usageLicense: String(product.usageLicense || 'Standard License')
          }
        }],
        source: 'free_claim',
        status: 'paid',
        paymentStatus: 'free_claim',
        orderState: 'library_added',
        refundStatus: '',
        amountTotalCents: 0,
        amountCents: 0,
        amountSource: 'free_claim',
        currency: String(product.currency || 'USD'),
        livemode: false,
        paymentSource: 'free_claim',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      })
      createdClaim = true
    })

    if (createdClaim) {
      await writeAccountEvent(db, uid, {
        type: 'order_created',
        severity: 'success',
        title: 'Product added to library',
        message: `${String(product.title || 'Product')} was added to your library.`,
        actorType: 'system',
        source: 'free_claim',
        path: '/account/library',
        metadata: { orderId: orderRef.id, productId }
      })
      await rebuildCommerceSummary(db, uid).catch(() => {})
    }

    return {
      status: 'active',
      productId,
      orderId: createdClaim ? orderRef.id : '',
      alreadyOwned: !createdClaim
    }
  }
)

exports.__test = {
  isFreeProduct,
  isPublishedPublicProduct,
  productLibraryPayload
}
