const { grantRecord, validateProduct } = require('../licensing/entitlements')
const { FieldValue } = require('firebase-admin/firestore')
const { buildAdminAuditLogEntry } = require('../admin/auditLog')
const { createHash } = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')
const fail = (code, message) => { throw new HttpsError(code, message) }
const milliseconds = value => value?.toMillis?.() ?? (value instanceof Date ? value.getTime() : NaN)
// Keys are case-sensitive opaque ASCII credentials. Only surrounding whitespace
// is removed; separators/case are never rewritten. Issuers use >=256 random bits.
function keyDigest(raw) {
  if (typeof raw !== 'string') fail('invalid-argument', 'Invalid license key.')
  const key = raw.trim()
  if (key.length < 32 || key.length > 256 || !/^[\x21-\x7e]+$/.test(key)) fail('invalid-argument', 'Invalid license key.')
  return createHash('sha256').update(key, 'utf8').digest('hex')
}
function origamiLicensingCore({ db, now = Date.now }) {
  function result(entitlement) {
    const expires = entitlement?.expiresAt == null ? Infinity : milliseconds(entitlement.expiresAt)
    if (entitlement?.productId !== 'origami' || entitlement.status !== 'active' || entitlement.edition !== 'beta' || !(expires > now()))
      return { authorized: false, edition: '', validUntil: 0 }
    // A short in-memory server validation lease, NOT a signed offline license.
    return { authorized: true, edition: 'beta', validUntil: Math.min(now() + 900000, expires) }
  }
  const owner = uid => { if (!uid) fail('unauthenticated', 'Sign in to Melogic before activating a key.'); return db.doc(`users/${uid}/entitlements/origami`) }
  return {
    async authorization(uid) {
      const [entitlement, product] = await Promise.all([owner(uid).get(), db.doc('products/origami').get()])
      if (product.exists) {
        try { validateProduct(product.data(), 'beta') } catch { return { authorized: false, edition: '', validUntil: 0 } }
      }
      return result(entitlement.data())
    },
    async redeem(data, uid) {
      const entitlementRef = owner(uid)
      const digest = keyDigest(data?.key)
      const keyRef = db.doc(`licenseKeys/${digest}`)
      const receiptRef = keyRef.collection('redemptions').doc(uid)
      return db.runTransaction(async tx => {
        const [keySnap, receipt, existing, product] = await Promise.all([tx.get(keyRef), tx.get(receiptRef), tx.get(entitlementRef), tx.get(db.doc('products/origami'))])
        const key = keySnap.data()
        if (!keySnap.exists) fail('not-found', 'Invalid license key.')
        if (product.exists) validateProduct(product.data(), 'beta')
        if (key.status !== 'active') fail('permission-denied', 'This license key is unavailable.')
        if (key.productId !== 'origami' || key.edition !== 'beta') fail('failed-precondition', 'This license is not valid for Origami beta.')
        if (key.expiresAt != null && !(milliseconds(key.expiresAt) > now())) fail('deadline-exceeded', 'This license key has expired.')
        const count = key.redemptionCount ?? 0
        if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(key.maxRedemptions) || key.maxRedemptions < 1)
          fail('failed-precondition', 'This license key is unavailable.')
        // A repeated request from the same UID is idempotent. It may not revive
        // an entitlement subsequently revoked by an administrator.
        if (receipt.exists) {
          const answer = result(existing.data())
          if (!answer.authorized) fail('permission-denied', 'This account entitlement is unavailable.')
          return answer
        }
        if (existing.exists && existing.data().status === 'revoked') fail('permission-denied', 'This account entitlement is unavailable.')
        if (count >= key.maxRedemptions) fail('resource-exhausted', 'This license key has already been redeemed.')
        const entitlement = grantRecord({ previous: existing.data(), uid, productId: 'origami', edition: 'beta', source: 'license_key', actorUid: uid, timestamp: new Date(now()), expiresAt: key.entitlementExpiresAt ?? null, reference: { redeemedKeyId: key.managementId || 'legacy', maskedKey: key.maskedKey || '' } })
        if (!result(entitlement).authorized) fail('failed-precondition', 'This license key is unavailable.')
        // Do not shorten an already valid ownership grant when another key is used.
        if (!result(existing.data()).authorized) tx.set(entitlementRef, entitlement)
        tx.create(receiptRef, { uid, productId: 'origami', redeemedAt: new Date(now()) })
        tx.update(keyRef, { redemptionCount: count + 1, updatedAt: FieldValue.serverTimestamp() })
        const auditRef = db.collection('adminLogs').doc()
        tx.create(auditRef, { id: auditRef.id, ...buildAdminAuditLogEntry({ actorUid: uid, action: 'license_key_redeemed', targetType: 'user', targetId: uid, metadata: { productId: 'origami', keyId: key.managementId || 'legacy', maskedKey: key.maskedKey || '', ownershipChanged: !result(existing.data()).authorized } }) })
        return result(result(existing.data()).authorized ? existing.data() : entitlement)
      })
    }
  }
}
module.exports = { origamiLicensingCore, keyDigest }
