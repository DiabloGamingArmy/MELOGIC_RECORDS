const admin = require('firebase-admin')

function cleanString(value = '', max = 900) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function normalizeProductIds(value = []) {
  let rows = value
  if (typeof rows === 'string') {
    try {
      rows = JSON.parse(rows)
    } catch {
      rows = rows.split(',')
    }
  }
  if (!Array.isArray(rows)) return []
  return [...new Set(rows.map((item) => cleanString(item, 180)).filter((item) => item && !item.includes('/')))].slice(0, 25)
}

function paymentIntentId(session = {}) {
  return cleanString(typeof session.payment_intent === 'object' ? session.payment_intent?.id : session.payment_intent, 180)
}

function productSnapshot(productId = '', product = {}, orderItem = {}) {
  const itemSnapshot = orderItem.productSnapshot && typeof orderItem.productSnapshot === 'object'
    ? orderItem.productSnapshot
    : {}
  return {
    title: cleanString(product.title || orderItem.title || itemSnapshot.title || productId, 180),
    slug: cleanString(product.slug || orderItem.slug || itemSnapshot.slug || '', 180),
    creatorName: cleanString(
      product.artistName
      || product.artistDisplayName
      || orderItem.artistName
      || itemSnapshot.creatorName
      || 'Creator',
      180
    ),
    creatorUid: cleanString(product.artistId || orderItem.creatorUid || orderItem.artistId || itemSnapshot.creatorUid || '', 180),
    coverPath: cleanString(product.coverPath || product.thumbnailPath || itemSnapshot.coverPath || '', 900),
    coverURL: cleanString(product.coverURL || product.thumbnailURL || itemSnapshot.coverURL || '', 900),
    productType: cleanString(product.productType || product.productKind || itemSnapshot.productType || 'Product', 120),
    usageLicense: cleanString(product.usageLicense || itemSnapshot.usageLicense || 'Standard License', 160),
    sizeBytes: Math.max(0, Math.round(Number(
      product.primaryDownloadBytes
      || product.assetSummary?.totalBytes
      || itemSnapshot.sizeBytes
      || 0
    )))
  }
}

function isActiveAccess(snapshot) {
  return Boolean(snapshot?.exists && (snapshot.data()?.status || 'active') === 'active')
}

function accessWriteNeeded(snapshot, { orderId = '', stripeSessionId = '' } = {}) {
  if (!snapshot?.exists) return true
  const data = snapshot.data() || {}
  return (data.status || 'active') !== 'active'
    || cleanString(data.orderId || '', 180) !== orderId
    || cleanString(data.stripeCheckoutSessionId || data.stripeSessionId || '', 180) !== stripeSessionId
    || cleanString(data.acquisitionType || '', 80).toLowerCase() !== 'purchase'
}

async function findOrderForSession(database, session = {}) {
  const stripeSessionId = cleanString(session.id || '', 180)
  const metadataOrderId = cleanString(session.metadata?.orderId || '', 180)
  let orderRef = metadataOrderId && !metadataOrderId.includes('/')
    ? database.collection('orders').doc(metadataOrderId)
    : null
  let orderSnap = orderRef ? await orderRef.get() : null

  if (!orderSnap?.exists && stripeSessionId) {
    for (const field of ['stripeSessionId', 'checkoutSessionId']) {
      const snapshot = await database.collection('orders').where(field, '==', stripeSessionId).limit(1).get()
      if (snapshot.docs[0]) {
        orderSnap = snapshot.docs[0]
        orderRef = orderSnap.ref
        break
      }
    }
  }

  if (!orderSnap?.exists || !orderRef) {
    const error = new Error('Checkout order was not found.')
    error.code = 'order-not-found'
    throw error
  }

  return { orderRef, orderSnap }
}

async function resolveCheckoutContext(database, session = {}) {
  const stripeSessionId = cleanString(session.id || '', 180)
  if (!stripeSessionId) {
    const error = new Error('Stripe checkout session ID is missing.')
    error.code = 'session-id-missing'
    throw error
  }

  const { orderRef, orderSnap } = await findOrderForSession(database, session)
  const order = orderSnap.data() || {}
  const metadataUid = cleanString(session.metadata?.buyerUid || session.metadata?.uid || session.client_reference_id || '', 180)
  const orderUid = cleanString(order.buyerUid || order.uid || order.userId || '', 180)
  const uid = metadataUid || orderUid
  if (!uid || uid.includes('/')) {
    const error = new Error('Checkout buyer UID is missing.')
    error.code = 'buyer-uid-missing'
    throw error
  }
  if (metadataUid && orderUid && metadataUid !== orderUid) {
    const error = new Error('Checkout buyer UID does not match the order.')
    error.code = 'buyer-uid-mismatch'
    throw error
  }

  const orderSessionId = cleanString(order.stripeSessionId || order.checkoutSessionId || '', 180)
  if (orderSessionId && orderSessionId !== stripeSessionId) {
    const error = new Error('Stripe checkout session does not match the order.')
    error.code = 'checkout-session-mismatch'
    throw error
  }

  const metadataProductIds = normalizeProductIds(session.metadata?.productIds || [])
  const orderProductIds = normalizeProductIds(order.productIds || (order.items || []).map((item) => item?.productId))
  const productIds = metadataProductIds.length ? metadataProductIds : orderProductIds
  if (!productIds.length) {
    const error = new Error('Checkout product IDs are missing.')
    error.code = 'product-ids-missing'
    throw error
  }

  return {
    uid,
    order,
    orderId: orderRef.id,
    orderRef,
    productIds,
    stripeSessionId
  }
}

function orderItemForProduct(order = {}, productId = '') {
  return (Array.isArray(order.items) ? order.items : []).find((item) => cleanString(item?.productId || '', 180) === productId) || {}
}

function purchaseAccessPayload({
  uid = '',
  productId = '',
  product = {},
  orderItem = {},
  orderId = '',
  session = {},
  now
} = {}) {
  const snapshot = productSnapshot(productId, product, orderItem)
  const amountCents = Math.max(0, Math.round(Number(orderItem.amountCents || orderItem.priceCents || product.priceCents || 0)))
  const currency = cleanString(session.currency || orderItem.currency || product.currency || 'usd', 12).toUpperCase()
  const stripeSessionId = cleanString(session.id || '', 180)
  return {
    uid,
    userId: uid,
    buyerUid: uid,
    ownerUid: uid,
    productId,
    productTitle: snapshot.title,
    artistId: snapshot.creatorUid,
    artistName: snapshot.creatorName,
    productSlug: snapshot.slug,
    productType: snapshot.productType,
    priceCents: amountCents,
    pricePaid: amountCents,
    currency,
    acquisitionType: 'Purchase',
    source: 'stripe_checkout',
    status: 'active',
    license: snapshot.usageLicense,
    orderId,
    stripeSessionId,
    stripeCheckoutSessionId: stripeSessionId,
    stripePaymentIntentId: paymentIntentId(session),
    paymentIntentId: paymentIntentId(session),
    productSnapshot: snapshot,
    updatedAt: now
  }
}

async function fulfillPaidCheckout({
  database = admin.firestore(),
  session = {},
  eventId = '',
  eventType = 'checkout.session.completed',
  source = 'stripe_webhook'
} = {}) {
  if (session.payment_status !== 'paid') {
    const error = new Error(`Checkout is not paid (${cleanString(session.payment_status || 'unknown', 80)}).`)
    error.code = 'payment-not-paid'
    throw error
  }

  const context = await resolveCheckoutContext(database, session)
  const safeEventId = cleanString(eventId || `session_${context.stripeSessionId}`, 180).replaceAll('/', '_')
  const eventRef = database.collection('stripeWebhookEvents').doc(safeEventId)

  return database.runTransaction(async (transaction) => {
    const productRefs = context.productIds.map((productId) => database.collection('products').doc(productId))
    const entitlementRefs = context.productIds.map((productId) => database.doc(`users/${context.uid}/entitlements/${productId}`))
    const libraryRefs = context.productIds.map((productId) => database.doc(`users/${context.uid}/libraryItems/${productId}`))
    const refs = [context.orderRef, eventRef, ...productRefs, ...entitlementRefs, ...libraryRefs]
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    const orderSnap = snapshots[0]
    if (!orderSnap.exists) throw new Error('Checkout order disappeared during fulfillment.')

    const productOffset = 2
    const entitlementOffset = productOffset + productRefs.length
    const libraryOffset = entitlementOffset + entitlementRefs.length
    const order = orderSnap.data() || {}
    const now = admin.firestore.FieldValue.serverTimestamp()
    const grantedProductIds = []
    const repairedProductIds = []
    const duplicateProductIds = []

    context.productIds.forEach((productId, index) => {
      const productSnap = snapshots[productOffset + index]
      const entitlementSnap = snapshots[entitlementOffset + index]
      const librarySnap = snapshots[libraryOffset + index]
      const entitlementActive = isActiveAccess(entitlementSnap)
      const libraryActive = isActiveAccess(librarySnap)
      const entitlementNeedsWrite = accessWriteNeeded(entitlementSnap, context)
      const libraryNeedsWrite = accessWriteNeeded(librarySnap, context)
      const product = productSnap.exists ? productSnap.data() || {} : {}
      const orderItem = orderItemForProduct(order, productId)
      const payload = purchaseAccessPayload({
        uid: context.uid,
        productId,
        product,
        orderItem,
        orderId: context.orderId,
        session,
        now
      })

      if (!entitlementNeedsWrite && !libraryNeedsWrite && entitlementActive && libraryActive) duplicateProductIds.push(productId)
      else if (entitlementSnap.exists || librarySnap.exists) repairedProductIds.push(productId)
      else grantedProductIds.push(productId)

      if (entitlementNeedsWrite) {
        const existing = entitlementSnap.exists ? entitlementSnap.data() || {} : {}
        transaction.set(entitlementRefs[index], {
          ...payload,
          entitlementId: cleanString(existing.entitlementId || `${context.uid}_${productId}`, 380),
          grantedAt: existing.grantedAt || existing.createdAt || now,
          createdAt: existing.createdAt || now
        }, { merge: true })
      }

      if (libraryNeedsWrite) {
        const existing = librarySnap.exists ? librarySnap.data() || {} : {}
        transaction.set(libraryRefs[index], {
          ...payload,
          entitlementId: cleanString(existing.entitlementId || `${context.uid}_${productId}`, 380),
          acquiredAt: existing.acquiredAt || existing.createdAt || now,
          createdAt: existing.createdAt || now
        }, { merge: true })
      }
    })

    const items = (Array.isArray(order.items) ? order.items : []).map((item) => ({
      ...item,
      entitlementStatus: context.productIds.includes(cleanString(item?.productId || '', 180))
        ? 'active'
        : item?.entitlementStatus
    }))
    transaction.set(context.orderRef, {
      uid: context.uid,
      buyerUid: context.uid,
      productIds: context.productIds,
      items,
      status: 'paid',
      paymentStatus: 'paid',
      paidAt: order.paidAt || now,
      stripeSessionId: context.stripeSessionId,
      checkoutSessionId: context.stripeSessionId,
      paymentIntentId: paymentIntentId(session) || cleanString(order.paymentIntentId || '', 180),
      amountCents: Number(session.amount_total || order.amountCents || order.amountTotalCents || 0),
      amountTotalCents: Number(session.amount_total || order.amountTotalCents || order.amountCents || 0),
      currency: cleanString(session.currency || order.currency || 'usd', 12).toUpperCase(),
      livemode: session.livemode === true,
      paymentSource: session.livemode === true ? 'stripe_live' : 'stripe_test',
      fulfillmentSource: source,
      entitlementStatus: 'active',
      updatedAt: now
    }, { merge: true })
    transaction.set(eventRef, {
      eventId: safeEventId,
      eventType,
      source,
      uid: context.uid,
      orderId: context.orderId,
      stripeSessionId: context.stripeSessionId,
      productIds: context.productIds,
      grantedProductIds,
      repairedProductIds,
      duplicateProductIds,
      processedAt: now,
      updatedAt: now
    }, { merge: true })

    return {
      uid: context.uid,
      orderId: context.orderId,
      stripeSessionId: context.stripeSessionId,
      productIds: context.productIds,
      grantedProductIds,
      repairedProductIds,
      duplicateProductIds,
      changed: grantedProductIds.length > 0 || repairedProductIds.length > 0
    }
  })
}

module.exports = {
  fulfillPaidCheckout,
  productSnapshot,
  resolveCheckoutContext,
  __test: {
    accessWriteNeeded,
    normalizeProductIds,
    paymentIntentId,
    productSnapshot,
    purchaseAccessPayload
  }
}
