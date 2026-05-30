const { onCall } = require('firebase-functions/v2/https')
const { assertPermission } = require('./adminAuth')
const { loadReviewQueue } = require('./marketplaceReviewShared')

const listMarketplaceReviewQueue = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'productReview')
  const limit = request.data?.limit ?? request.data?.limitCount ?? 60
  const products = await loadReviewQueue(limit)
  return {
    ok: true,
    products,
    requester: {
      uid: claims.uid,
      role: claims.adminRole,
      productReview: claims.productReview === true
    }
  }
})

module.exports = {
  listMarketplaceReviewQueue
}
