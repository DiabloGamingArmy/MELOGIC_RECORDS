const { HttpsError } = require('firebase-functions/v2/https')
const fail = (code, message) => { throw new HttpsError(code, message) }
const millis = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN)
function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('invalid-argument', 'Invalid identifier.')
  return value
}
function expiry(value, now) {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.getTime() <= now) fail('invalid-argument', 'Expiration must be in the future.')
  return date
}
function validateProduct(product, edition) {
  if (!product?.licensing?.enabled || !['beta', 'active'].includes(product.status)) fail('failed-precondition', 'Product licensing is unavailable.')
  if (!product.licensing.editions?.includes(edition)) fail('invalid-argument', 'Select an allowed product edition.')
}
function isActive(entitlement, now) {
  return entitlement?.status === 'active' && (entitlement.expiresAt == null || millis(entitlement.expiresAt) > now)
}
// Trusted server callers (admin, redemption, future verified purchase) share this
// record transition. Callers validate identity/product and commit with their audit.
function grantRecord({ previous = {}, uid, productId, edition, source, actorUid, reason = '', expiresAt = null, timestamp, reference = {} }) {
  if (!['admin', 'license_key', 'purchase', 'migration'].includes(source)) fail('invalid-argument', 'Invalid grant source.')
  return {
    ...previous, uid, productId, edition, status: 'active', source, expiresAt,
    createdAt: previous.createdAt || previous.grantedAt || timestamp,
    updatedAt: timestamp, grantedAt: timestamp, grantedByUid: actorUid,
    reason, generation: (previous.generation || 0) + 1, ...reference
  }
}
function assertMarketplaceProduct(productId, product = {}) {
  if (productId === 'origami' || product.licensing?.enabled) fail('permission-denied', 'Licensing products require the trusted licensing administration service.')
}
module.exports = { assertMarketplaceProduct, id, expiry, validateProduct, isActive, grantRecord, fail }
