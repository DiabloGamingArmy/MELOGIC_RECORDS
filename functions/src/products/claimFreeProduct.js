const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

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
    const payload = productLibraryPayload({ uid, productId, product })

    await db.runTransaction(async (tx) => {
      const [entitlementSnap, librarySnap] = await Promise.all([
        tx.get(entitlementRef),
        tx.get(libraryRef)
      ])

      tx.set(entitlementRef, {
        ...payload,
        source: entitlementSnap.exists ? (entitlementSnap.data()?.source || payload.source) : payload.source,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      tx.set(libraryRef, {
        ...payload,
        source: librarySnap.exists ? (librarySnap.data()?.source || payload.source) : payload.source,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
    })

    return {
      status: 'active',
      productId,
      alreadyOwned: false
    }
  }
)

exports.__test = {
  isFreeProduct,
  isPublishedPublicProduct,
  productLibraryPayload
}
