const { onCall } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { db, normalizeLimit, productSummary, safeListCollection } = require('./adminListShared')

function matchesSearch(product = {}, search = '') {
  if (!search) return true
  const haystack = [
    product.id,
    product.title,
    product.slug,
    product.artistId,
    product.artistName,
    product.artistUsername,
    product.productType,
    product.status
  ].join(' ').toLowerCase()
  return haystack.includes(search)
}

const listAdminProducts = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['listingEdit', 'productReview'])
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const search = cleanString(request.data?.search || '', 120).toLowerCase()
  const productId = cleanString(request.data?.productId || '', 180)

  if (productId && !productId.includes('/')) {
    const snap = await db().collection('products').doc(productId).get()
    const products = snap.exists ? [productSummary(snap)] : []
    return { ok: true, products, total: products.length, requester: { uid: claims.uid, role: claims.adminRole } }
  }

  const snapshot = await safeListCollection('products', { orderBy: 'updatedAt', direction: 'desc', limit })
  const products = snapshot.docs
    .map(productSummary)
    .filter((product) => matchesSearch(product, search))
    .slice(0, limit)

  return {
    ok: true,
    products,
    total: products.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminProducts
}
