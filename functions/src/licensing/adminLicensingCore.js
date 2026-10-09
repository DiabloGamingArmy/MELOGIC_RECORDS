const { randomBytes, randomUUID } = require('node:crypto')
const { FieldValue } = require('firebase-admin/firestore')
const { buildAdminAuditLogEntry } = require('../admin/auditLog')
const { keyDigest } = require('../desktop/origamiLicensingCore')
const { id, expiry, validateProduct, grantRecord, isActive, fail } = require('./entitlements')
const text = (v, max = 500) => typeof v === 'string' ? v.trim().slice(0, max) : ''
function keyState(k, now = Date.now()) {
  if (k.status === 'revoked') return 'revoked'
  if (k.status !== 'active' || !Number.isInteger(k.maxRedemptions) || !Number.isInteger(k.redemptionCount)) return 'unavailable'
  if (k.expiresAt != null && !(k.expiresAt.toMillis() > now)) return 'expired'
  if (k.redemptionCount >= k.maxRedemptions) return 'redeemed'
  return k.redemptionCount > 0 ? 'partially_redeemed' : 'available'
}
function adminLicensingCore({ db, auth, now = Date.now }) {
  const stamp = () => FieldValue.serverTimestamp()
  const audit = (tx, actor, action, targetId, productId, reason, before = null, after = null) => {
    const ref = db.collection('adminLogs').doc()
    tx.create(ref, { id: ref.id, ...buildAdminAuditLogEntry({ actorUid: actor.uid, actorRole: actor.adminRole, action, targetType: 'licensing', targetId, reason, before, after, metadata: { productId } }) })
  }
  return {
    async catalog() {
      const snap = await db.collection('products').where('licensing.enabled', '==', true).get()
      return snap.docs.map(d => ({ productId: d.id, name: d.data().name, status: d.data().status, editions: d.data().licensing.editions }))
    },
    async saveProduct(data, actor) {
      const productId = id(data.productId), name = text(data.name, 120)
      const editions = Array.isArray(data.editions) ? [...new Set(data.editions.map(id))] : []
      if (!name || !editions.length || editions.length > 20 || !['beta', 'active', 'disabled'].includes(data.status)) fail('invalid-argument', 'Invalid product configuration.')
      if (productId === 'origami' && !editions.includes('beta')) fail('invalid-argument', 'Origami must retain its beta edition.')
      return db.runTransaction(async tx => {
        const ref = db.doc(`products/${productId}`), before = await tx.get(ref)
        if (before.exists && !before.data().licensing?.enabled && (productId !== 'origami' || before.data().artistId)) fail('failed-precondition', 'Cannot replace an existing marketplace product with a licensing product.')
        const record = { name, status: data.status, licensing: { enabled: true, editions }, updatedAt: stamp(), ...(before.exists ? {} : { createdAt: stamp() }) }
        tx.set(ref, record, { merge: true })
        audit(tx, actor, before.exists ? 'licensing_product_updated' : 'licensing_product_created', productId, productId, text(data.reason), before.data() || null, { name, status: data.status, editions })
        return { ok: true }
      })
    },
    async access(uid) {
      id(uid)
      await auth.getUser(uid)
      const [products, snap] = await Promise.all([this.catalog(), db.collection(`users/${uid}/entitlements`).get()])
      return { products, entitlements: snap.docs.map(d => {
        const e = d.data()
        return { productId: d.id, edition: e.edition || '', status: e.status === 'active' && !isActive(e, now()) ? 'expired' : e.status, source: e.source, grantedAt: e.grantedAt?.toDate?.().toISOString() || '', expiresAt: e.expiresAt?.toDate?.().toISOString() || '', revokedAt: e.revokedAt?.toDate?.().toISOString() || '', revocationReason: e.revocationReason || '', maskedKey: e.maskedKey || '' }
      }) }
    },
    async changeAccess(data, actor, revoke = false) {
      const uid = id(data.targetUid), productId = id(data.productId), reason = text(data.reason)
      if (!reason) fail('invalid-argument', 'A reason is required.')
      await auth.getUser(uid).catch(() => fail('not-found', 'Target user was not found.'))
      const expiresAt = revoke ? null : expiry(data.expiresAt, now())
      return db.runTransaction(async tx => {
        const ref = db.doc(`users/${uid}/entitlements/${productId}`)
        const [product, before] = await Promise.all([tx.get(db.doc(`products/${productId}`)), tx.get(ref)])
        if (!product.exists || !product.data().licensing?.enabled) fail('not-found', 'Licensable product not found.')
        const previous = before.data() || {}
        if (revoke) {
          if (!before.exists) fail('not-found', 'Entitlement not found.')
          if (previous.status === 'revoked') return { ok: true, unchanged: true }
          tx.update(ref, { status: 'revoked', revokedAt: stamp(), updatedAt: stamp(), revokedByUid: actor.uid, revocationReason: reason })
        } else {
          validateProduct(product.data(), data.edition)
          const previousExpiry = previous.expiresAt?.toMillis?.() ?? null
          if (isActive(previous, now()) && previous.source === 'admin' && previous.edition === data.edition && previous.reason === reason && previousExpiry === (expiresAt?.getTime() ?? null)) return { ok: true, unchanged: true }
          const record = grantRecord({ previous, uid, productId, edition: data.edition, source: 'admin', actorUid: actor.uid, reason, expiresAt, timestamp: stamp() })
          tx.set(ref, record)
        }
        audit(tx, actor, revoke ? 'entitlement_revoked' : previous.status === 'revoked' ? 'entitlement_regranted' : 'entitlement_granted', uid, productId, reason, previous, { status: revoke ? 'revoked' : 'active', edition: data.edition || previous.edition })
        return { ok: true }
      })
    },
    async generate(data, actor) {
      const productId = id(data.productId), quantity = data.quantity, maxRedemptions = data.maxRedemptions
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100 || !Number.isInteger(maxRedemptions) || maxRedemptions < 1 || maxRedemptions > 1000) fail('invalid-argument', 'Use 1–100 keys and 1–1000 redemptions per key.')
      const expiresAt = expiry(data.expiresAt, now()), campaign = text(data.campaign)
      // 32 CSPRNG bytes = 256 bits, unchanged case-sensitive opaque L01.1 input.
      const keys = Array.from({ length: quantity }, () => `MELOGIC-${randomBytes(32).toString('hex')}`)
      await db.runTransaction(async tx => {
        const product = await tx.get(db.doc(`products/${productId}`))
        validateProduct(product.data(), data.edition)
        for (const key of keys) {
          const digest = keyDigest(key)
          tx.create(db.doc(`licenseKeys/${digest}`), { managementId: randomUUID(), maskedKey: `••••-${key.slice(-8)}`, productId, edition: data.edition, status: 'active', createdAt: stamp(), createdByUid: actor.uid, expiresAt, maxRedemptions, redemptionCount: 0, campaign })
        }
        audit(tx, actor, 'license_keys_generated', productId, productId, campaign, null, { quantity, maxRedemptions, edition: data.edition })
      })
      return { keys }
    },
    async listKeys(data = {}) {
      let query = db.collection('licenseKeys').orderBy('managementId')
      if (data.cursor) query = query.startAfter(id(data.cursor))
      const snap = await query.limit(50).get()
      return { keys: snap.docs.map(d => { const k = d.data(); return { managementId: k.managementId || '', maskedKey: k.maskedKey || 'Legacy key', productId: k.productId, edition: k.edition, status: keyState(k, now()), createdAt: k.createdAt?.toDate?.().toISOString() || '', expiresAt: k.expiresAt?.toDate?.().toISOString() || '', campaign: k.campaign || '', maxRedemptions: k.maxRedemptions, redemptionCount: k.redemptionCount } }), cursor: snap.size === 50 ? snap.docs.at(-1).data().managementId : '' }
    },
    async revokeKey(data, actor) {
      const managementId = id(data.managementId), reason = text(data.reason)
      if (!reason) fail('invalid-argument', 'A reason is required.')
      const match = await db.collection('licenseKeys').where('managementId', '==', managementId).limit(1).get()
      if (match.empty) fail('not-found', 'Key not found.')
      return db.runTransaction(async tx => {
        const ref = match.docs[0].ref, snap = await tx.get(ref), key = snap.data()
        if (key.status === 'revoked') return { ok: true, unchanged: true }
        tx.update(ref, { status: 'revoked', revokedAt: stamp(), revokedByUid: actor.uid, reason })
        audit(tx, actor, 'license_key_revoked', managementId, key.productId, reason, null, { redemptionCount: key.redemptionCount })
        return { ok: true }
      })
    }
  }
}
module.exports = { adminLicensingCore, keyState }
