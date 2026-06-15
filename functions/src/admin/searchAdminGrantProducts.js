const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { db, productSummary } = require('./adminListShared')

function matchesSearch(product = {}, search = '') {
  if (!search) return true
  return [
    product.id,
    product.title,
    product.slug,
    product.artistId,
    product.artistName,
    product.artistDisplayName,
    product.artistUsername
  ].join(' ').toLowerCase().includes(search)
}

const searchAdminGrantProducts = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['orderSupport', 'listingEdit', 'productReview'])
  const uid = cleanString(request.data?.uid || '', 180)
  const searchInput = cleanString(request.data?.search || '', 180)
  const search = searchInput.toLowerCase()
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid target uid is required.')
  if (!search) return { ok: true, products: [], requester: { uid: claims.uid, role: claims.adminRole } }

  const exactRef = !searchInput.includes('/') ? db().collection('products').doc(searchInput) : null
  const [exactSnap, recentSnap] = await Promise.all([
    exactRef ? exactRef.get().catch(() => null) : Promise.resolve(null),
    db().collection('products').limit(500).get()
  ])
  const candidates = new Map()
  if (exactSnap?.exists) candidates.set(exactSnap.id, productSummary(exactSnap))
  recentSnap.docs.forEach((docSnap) => {
    const product = productSummary(docSnap)
    if (matchesSearch(product, search)) candidates.set(product.id, product)
  })
  const products = [...candidates.values()].slice(0, 25)
  if (!products.length) return { ok: true, products: [], requester: { uid: claims.uid, role: claims.adminRole } }

  const entitlementRefs = products.map((product) => db().doc(`users/${uid}/entitlements/${product.id}`))
  const libraryRefs = products.map((product) => db().doc(`users/${uid}/libraryItems/${product.id}`))
  const snapshots = await db().getAll(...entitlementRefs, ...libraryRefs)
  const entitlementOffset = 0
  const libraryOffset = products.length
  const results = products.map((product, index) => {
    const entitlement = snapshots[entitlementOffset + index]
    const library = snapshots[libraryOffset + index]
    const alreadyOwned = [entitlement, library].some((snap) => snap.exists && (snap.data()?.status || 'active') === 'active')
    return { ...product, alreadyOwned }
  })

  return {
    ok: true,
    products: results,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  searchAdminGrantProducts,
  __test: { matchesSearch }
}
