const admin = require('firebase-admin')

function cleanString(value = '', max = 180) {
  return String(value ?? '').trim().slice(0, max)
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function paidOrderAmount(order = {}) {
  const paymentStatus = cleanString(order.paymentStatus || '', 80).toLowerCase()
  if (paymentStatus !== 'paid') return null
  const rawAmount = order.amountTotalCents ?? order.amountCents ?? order.totalCents
  const amount = Number(rawAmount)
  if (!Number.isInteger(amount) || amount < 0) return null
  return {
    amount,
    currency: cleanString(order.currency || 'USD', 12).toUpperCase()
  }
}

function buildCommerceSummary({ orders = [], accessRows = [] } = {}) {
  const spendByCurrency = {}
  let paidOrderCount = 0
  let lastOrderMillis = 0
  let lastPurchaseMillis = 0
  const ownedProductIds = new Set()

  orders.forEach((order = {}) => {
    lastOrderMillis = Math.max(
      lastOrderMillis,
      timestampMillis(order.updatedAt || order.paidAt || order.createdAt)
    )
    const paid = paidOrderAmount(order)
    if (!paid) return
    paidOrderCount += 1
    spendByCurrency[paid.currency] = (spendByCurrency[paid.currency] || 0) + paid.amount
    lastPurchaseMillis = Math.max(
      lastPurchaseMillis,
      timestampMillis(order.paidAt || order.updatedAt || order.createdAt)
    )
  })

  accessRows.forEach((row = {}) => {
    const productId = cleanString(row.productId || row.id || '', 180)
    if (productId && cleanString(row.status || 'active', 80).toLowerCase() === 'active') {
      ownedProductIds.add(productId)
    }
  })

  const currencies = Object.keys(spendByCurrency).sort()
  return {
    spendByCurrency,
    paidOrderCount,
    ownedProductCount: ownedProductIds.size,
    totalSpentAmount: currencies.length === 1 ? spendByCurrency[currencies[0]] : null,
    totalSpentCurrency: currencies.length === 1 ? currencies[0] : '',
    lastOrderMillis,
    lastPurchaseMillis
  }
}

async function rebuildCommerceSummary(database, uid = '') {
  const userId = cleanString(uid, 180)
  if (!userId || userId.includes('/')) throw new Error('A valid user ID is required.')

  const [uidOrders, buyerOrders, librarySnap, entitlementSnap] = await Promise.all([
    database.collection('orders').where('uid', '==', userId).limit(500).get(),
    database.collection('orders').where('buyerUid', '==', userId).limit(500).get(),
    database.collection('users').doc(userId).collection('libraryItems').limit(500).get(),
    database.collection('users').doc(userId).collection('entitlements').limit(500).get()
  ])
  const orderMap = new Map()
  ;[...uidOrders.docs, ...buyerOrders.docs].forEach((docSnap) => {
    orderMap.set(docSnap.id, { id: docSnap.id, ...(docSnap.data() || {}) })
  })
  const accessMap = new Map()
  ;[...entitlementSnap.docs, ...librarySnap.docs].forEach((docSnap) => {
    const data = docSnap.data() || {}
    const productId = cleanString(data.productId || docSnap.id, 180)
    if (productId) accessMap.set(productId, { id: docSnap.id, ...data, productId })
  })

  const summary = buildCommerceSummary({
    orders: [...orderMap.values()],
    accessRows: [...accessMap.values()]
  })
  const payload = {
    uid: userId,
    spendByCurrency: summary.spendByCurrency,
    paidOrderCount: summary.paidOrderCount,
    ownedProductCount: summary.ownedProductCount,
    totalSpentAmount: summary.totalSpentAmount,
    totalSpentCurrency: summary.totalSpentCurrency,
    lastOrderAt: summary.lastOrderMillis ? admin.firestore.Timestamp.fromMillis(summary.lastOrderMillis) : null,
    lastPurchaseAt: summary.lastPurchaseMillis ? admin.firestore.Timestamp.fromMillis(summary.lastPurchaseMillis) : null,
    source: 'rebuilt_from_orders_and_access',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
  await database.doc(`users/${userId}/commerceSummary/current`).set(payload, { merge: true })
  return payload
}

module.exports = {
  rebuildCommerceSummary,
  __test: {
    buildCommerceSummary,
    paidOrderAmount,
    timestampMillis
  }
}
