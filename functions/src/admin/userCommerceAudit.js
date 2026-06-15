const { cleanString } = require('./adminAuth')
const { db, orderSummary, safeSummaryValue, serializeDate } = require('./adminListShared')

function accessRow(docSnap, recordSource = '') {
  const raw = docSnap.data() || {}
  const snapshot = raw.productSnapshot && typeof raw.productSnapshot === 'object' ? raw.productSnapshot : {}
  return {
    id: docSnap.id,
    productId: cleanString(raw.productId || docSnap.id, 180),
    recordSources: [recordSource],
    acquisitionType: cleanString(raw.acquisitionType || '', 80),
    source: cleanString(raw.source || recordSource, 120),
    status: cleanString(raw.status || 'active', 80),
    orderId: cleanString(raw.orderId || '', 180),
    stripeCheckoutSessionId: cleanString(raw.stripeCheckoutSessionId || raw.stripeSessionId || '', 180),
    stripePaymentIntentId: cleanString(raw.stripePaymentIntentId || raw.paymentIntentId || '', 180),
    grantedBy: cleanString(raw.grantedBy || '', 180),
    pricePaid: Number.isFinite(Number(raw.pricePaid ?? raw.priceCents))
      ? Math.max(0, Math.round(Number(raw.pricePaid ?? raw.priceCents)))
      : null,
    currency: cleanString(raw.currency || 'USD', 12).toUpperCase(),
    acquiredAt: serializeDate(raw.acquiredAt || raw.grantedAt || raw.claimedAt || raw.addedAt || raw.createdAt),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    productSnapshot: {
      title: cleanString(snapshot.title || raw.productTitle || '', 180),
      creatorName: cleanString(snapshot.creatorName || raw.artistName || '', 180),
      creatorUid: cleanString(snapshot.creatorUid || raw.artistId || '', 180),
      slug: cleanString(snapshot.slug || raw.productSlug || '', 180),
      productType: cleanString(snapshot.productType || raw.productType || '', 120)
    }
  }
}

function mergeAccessRows(existing = {}, incoming = {}) {
  const preferred = incoming.recordSources?.includes('libraryItems') ? incoming : existing
  const fallback = preferred === incoming ? existing : incoming
  return {
    ...fallback,
    ...preferred,
    acquisitionType: preferred.acquisitionType || fallback.acquisitionType || '',
    source: preferred.source || fallback.source || '',
    orderId: preferred.orderId || fallback.orderId || '',
    stripeCheckoutSessionId: preferred.stripeCheckoutSessionId || fallback.stripeCheckoutSessionId || '',
    stripePaymentIntentId: preferred.stripePaymentIntentId || fallback.stripePaymentIntentId || '',
    grantedBy: preferred.grantedBy || fallback.grantedBy || '',
    pricePaid: preferred.pricePaid ?? fallback.pricePaid ?? null,
    acquiredAt: preferred.acquiredAt || fallback.acquiredAt || '',
    recordSources: [...new Set([...(existing.recordSources || []), ...(incoming.recordSources || [])])],
    productSnapshot: {
      title: preferred.productSnapshot?.title || fallback.productSnapshot?.title || '',
      creatorName: preferred.productSnapshot?.creatorName || fallback.productSnapshot?.creatorName || '',
      creatorUid: preferred.productSnapshot?.creatorUid || fallback.productSnapshot?.creatorUid || '',
      slug: preferred.productSnapshot?.slug || fallback.productSnapshot?.slug || '',
      productType: preferred.productSnapshot?.productType || fallback.productSnapshot?.productType || ''
    }
  }
}

async function loadUserCommerceAudit(uid = '') {
  const [entitlementsSnap, librarySnap, uidOrdersSnap, buyerOrdersSnap, summarySnap] = await Promise.all([
    db().collection('users').doc(uid).collection('entitlements').limit(250).get(),
    db().collection('users').doc(uid).collection('libraryItems').limit(250).get(),
    db().collection('orders').where('uid', '==', uid).limit(100).get(),
    db().collection('orders').where('buyerUid', '==', uid).limit(100).get(),
    db().doc(`users/${uid}/commerceSummary/current`).get()
  ])

  const accessMap = new Map()
  entitlementsSnap.docs.forEach((docSnap) => {
    const row = accessRow(docSnap, 'entitlements')
    accessMap.set(row.productId, row)
  })
  librarySnap.docs.forEach((docSnap) => {
    const row = accessRow(docSnap, 'libraryItems')
    accessMap.set(row.productId, mergeAccessRows(accessMap.get(row.productId), row))
  })

  const productIds = [...accessMap.keys()].filter(Boolean)
  const productSnaps = productIds.length
    ? await db().getAll(...productIds.map((productId) => db().collection('products').doc(productId)))
    : []
  const libraryItems = productIds.map((productId, index) => {
    const row = accessMap.get(productId)
    const productSnap = productSnaps[index]
    const product = productSnap?.exists ? productSnap.data() || {} : {}
    const snapshot = row.productSnapshot || {}
    return {
      ...row,
      productTitle: cleanString(product.title || snapshot.title || 'Product metadata unavailable', 180),
      creatorName: cleanString(product.artistName || product.artistDisplayName || snapshot.creatorName || 'Creator unavailable', 180),
      creatorUid: cleanString(product.artistId || snapshot.creatorUid || '', 180),
      metadataAvailable: productSnap?.exists === true,
      productSnapshot: safeSummaryValue(snapshot)
    }
  }).sort((a, b) => new Date(b.acquiredAt || b.updatedAt || 0).getTime() - new Date(a.acquiredAt || a.updatedAt || 0).getTime())

  const orderMap = new Map()
  ;[...uidOrdersSnap.docs, ...buyerOrdersSnap.docs].forEach((docSnap) => {
    orderMap.set(docSnap.id, orderSummary(docSnap))
  })
  const orders = [...orderMap.values()]
    .sort((a, b) => new Date(b.paidAt || b.updatedAt || b.createdAt || 0).getTime() - new Date(a.paidAt || a.updatedAt || a.createdAt || 0).getTime())

  return {
    libraryItems,
    orders,
    commerceSummary: summarySnap.exists ? safeSummaryValue(summarySnap.data() || {}) : null
  }
}

module.exports = {
  loadUserCommerceAudit,
  __test: {
    accessRow,
    mergeAccessRows
  }
}
