const admin = require('firebase-admin')
const { logger } = require('firebase-functions')
const { rebuildCommerceSummary } = require('../account/commerceSummary')
const {
  allocateAmountByWeights,
  allocateGrossAmounts,
  creatorLedgerPayload,
  earningsHoldDays,
  getSellerPlatformFeeBps,
  ledgerEntryId,
  loadCreatorEarningsConfig,
  rebuildCreatorEarningsSummaries
} = require('./creatorEarnings')
const {
  hasDigitalFulfillment,
  hasPhysicalFulfillment,
  normalizeProductFulfillment
} = require('../products/productFulfillment')

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

function stripeCustomerId(session = {}) {
  return cleanString(typeof session.customer === 'object' ? session.customer?.id : session.customer, 180)
}

function stripeAmount(value, fallback = null) {
  const amount = Number(value)
  return Number.isInteger(amount) && amount >= 0 ? amount : fallback
}

function stripeOrderFields(session = {}, order = {}) {
  const amountTotalCents = stripeAmount(session.amount_total, stripeAmount(order.amountTotalCents ?? order.amountCents, null))
  const amountSubtotalCents = stripeAmount(session.amount_subtotal, stripeAmount(order.amountSubtotalCents, amountTotalCents))
  return {
    orderState: 'order_placed',
    checkoutStatus: cleanString(session.status || 'complete', 80),
    amountSubtotalCents,
    amountTotalCents,
    amountCents: amountTotalCents,
    amountSource: 'stripe_checkout_session',
    currency: cleanString(session.currency || order.currency || 'usd', 12).toUpperCase(),
    paymentIntentId: paymentIntentId(session) || cleanString(order.paymentIntentId || '', 180),
    stripePaymentIntentId: paymentIntentId(session) || cleanString(order.stripePaymentIntentId || order.paymentIntentId || '', 180),
    stripeCustomerId: stripeCustomerId(session) || cleanString(order.stripeCustomerId || '', 180),
    totalDetails: {
      amountDiscount: stripeAmount(session.total_details?.amount_discount, 0),
      amountShipping: stripeAmount(session.total_details?.amount_shipping, 0),
      amountTax: stripeAmount(session.total_details?.amount_tax, 0)
    }
  }
}

function stripeProcessingFee(session = {}) {
  const paymentIntent = typeof session.payment_intent === 'object' ? session.payment_intent : {}
  const latestCharge = typeof paymentIntent.latest_charge === 'object' ? paymentIntent.latest_charge : {}
  const balanceTransaction = typeof latestCharge.balance_transaction === 'object' ? latestCharge.balance_transaction : {}
  return stripeAmount(balanceTransaction.fee, null)
}

function productSnapshot(productId = '', product = {}, orderItem = {}) {
  const itemSnapshot = orderItem.productSnapshot && typeof orderItem.productSnapshot === 'object'
    ? orderItem.productSnapshot
    : {}
  const fulfillment = normalizeProductFulfillment({
    ...(itemSnapshot || {}),
    ...(orderItem || {}),
    ...(product || {})
  })
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
    marketplaceProductType: fulfillment.type,
    fulfillment,
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

function grantBuyerLibraryAccess({
  transaction,
  database,
  buyerUid = '',
  productId = '',
  product = {},
  orderItem = {},
  orderId = '',
  session = {},
  now,
  entitlementSnap = null,
  librarySnap = null
} = {}) {
  const uid = cleanString(buyerUid, 180)
  const safeProductId = cleanString(productId, 180)
  if (!transaction || !database || !uid || uid.includes('/') || !safeProductId || safeProductId.includes('/')) {
    throw new Error('A valid buyer and product are required to grant checkout access.')
  }
  const entitlementRef = database.doc(`users/${uid}/entitlements/${safeProductId}`)
  const libraryRef = database.doc(`users/${uid}/libraryItems/${safeProductId}`)
  const payload = purchaseAccessPayload({
    uid,
    productId: safeProductId,
    product,
    orderItem,
    orderId,
    session,
    now
  })
  const existingEntitlement = entitlementSnap?.exists ? entitlementSnap.data() || {} : {}
  const existingLibrary = librarySnap?.exists ? librarySnap.data() || {} : {}
  transaction.set(entitlementRef, {
    ...payload,
    entitlementId: cleanString(existingEntitlement.entitlementId || `${uid}_${safeProductId}`, 380),
    grantedAt: existingEntitlement.grantedAt || existingEntitlement.createdAt || now,
    createdAt: existingEntitlement.createdAt || now
  }, { merge: true })
  transaction.set(libraryRef, {
    ...payload,
    entitlementId: cleanString(existingLibrary.entitlementId || existingEntitlement.entitlementId || `${uid}_${safeProductId}`, 380),
    acquiredAt: existingLibrary.acquiredAt || existingLibrary.createdAt || now,
    createdAt: existingLibrary.createdAt || now
  }, { merge: true })
  return {
    entitlementPath: entitlementRef.path,
    libraryItemPath: libraryRef.path,
    payload
  }
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

function truthy(value) {
  return value === true || value === 'true' || value === 1 || value === '1'
}

function productLooksDownloadable(product = {}, orderItem = {}) {
  const typeText = [
    product.productType,
    product.productKind,
    product.marketplaceProductType,
    orderItem.productType,
    orderItem.productKind,
    orderItem.productSnapshot?.productType,
    orderItem.productSnapshot?.marketplaceProductType
  ].map((value) => cleanString(value || '', 120).toLowerCase()).join(' ')
  const hasDownloadPath = Boolean(
    product.primaryDownloadPath
    || product.downloadPath
    || product.filePath
    || product.storagePath
    || orderItem.primaryDownloadPath
    || orderItem.downloadPath
    || orderItem.productSnapshot?.primaryDownloadPath
  )
  const assetSummary = product.assetSummary || orderItem.assetSummary || orderItem.productSnapshot?.assetSummary || {}
  const fileCount = Number(assetSummary.downloadableCount ?? assetSummary.fileCount ?? product.fileCount ?? product.downloadFileCount ?? 0)
  return truthy(orderItem.fulfillment?.digital?.required)
    || truthy(product.fulfillment?.digital?.enabled)
    || truthy(product.digital?.enabled)
    || hasDownloadPath
    || (Number.isFinite(fileCount) && fileCount > 0)
    || /\b(sample|pack|preset|tool|download|digital|loop|kit|plugin|instrument|template|sound|wav|midi)\b/.test(typeText)
}

function paidLineRequiresDigitalAccess(product = {}, orderItem = {}) {
  return hasDigitalFulfillment({ ...product, ...orderItem }) || productLooksDownloadable(product, orderItem)
}

function safeDocumentId(value = '', max = 180) {
  const id = cleanString(value, max)
  return id && !id.includes('/') ? id : ''
}

function platformRevenuePayload({
  creatorLedger = {},
  orderId = '',
  productId = '',
  stripeCheckoutSessionId = '',
  paymentIntentId = '',
  livemode = false,
  now
} = {}) {
  const grossAmount = Math.max(0, Math.round(Number(creatorLedger.grossAmount || 0)))
  const platformFeeAmount = Math.max(0, Math.round(Number(creatorLedger.platformFeeAmount || 0)))
  return {
    source: 'stripe_checkout',
    orderId: cleanString(orderId, 180),
    productId: cleanString(productId, 180),
    creatorUid: cleanString(creatorLedger.creatorUid || '', 180),
    sellerUid: cleanString(creatorLedger.sellerUid || creatorLedger.creatorUid || '', 180),
    buyerUid: cleanString(creatorLedger.buyerUid || '', 180),
    stripeCheckoutSessionId: cleanString(stripeCheckoutSessionId || creatorLedger.stripeCheckoutSessionId || '', 180),
    paymentIntentId: cleanString(paymentIntentId || creatorLedger.paymentIntentId || '', 180),
    stripePaymentIntentId: cleanString(paymentIntentId || creatorLedger.stripePaymentIntentId || creatorLedger.paymentIntentId || '', 180),
    grossAmount,
    grossAmountCents: grossAmount,
    platformFeeAmount,
    platformFeeAmountCents: platformFeeAmount,
    platformFeeBps: Math.max(0, Math.round(Number(creatorLedger.platformFeeBps || 0))),
    currency: cleanString(creatorLedger.currency || 'USD', 12).toUpperCase(),
    livemode: livemode === true,
    status: 'earned',
    createdAt: now,
    updatedAt: now
  }
}

function sellerSalePayload({
  creatorLedger = {},
  productSnapshot: snapshot = {},
  saleId = '',
  orderId = '',
  productId = '',
  session = {},
  now
} = {}) {
  return {
    saleId: cleanString(saleId, 180),
    sellerUid: cleanString(creatorLedger.creatorUid || creatorLedger.sellerUid || '', 180),
    creatorUid: cleanString(creatorLedger.creatorUid || creatorLedger.sellerUid || '', 180),
    buyerUid: cleanString(creatorLedger.buyerUid || '', 180),
    productId: cleanString(productId, 180),
    orderId: cleanString(orderId, 180),
    stripeCheckoutSessionId: cleanString(creatorLedger.stripeCheckoutSessionId || session.id || '', 180),
    paymentIntentId: paymentIntentId(session) || cleanString(creatorLedger.paymentIntentId || '', 180),
    stripePaymentIntentId: paymentIntentId(session) || cleanString(creatorLedger.stripePaymentIntentId || creatorLedger.paymentIntentId || '', 180),
    soldAt: now,
    createdAt: now,
    updatedAt: now,
    productSnapshot: {
      title: cleanString(snapshot.title || '', 180),
      slug: cleanString(snapshot.slug || '', 180),
      productType: cleanString(snapshot.productType || '', 120),
      coverURL: cleanString(snapshot.coverURL || '', 900),
      usageLicense: cleanString(snapshot.usageLicense || '', 160),
      fulfillment: snapshot.fulfillment || null,
      sizeBytes: Math.max(0, Math.round(Number(snapshot.sizeBytes || 0)))
    },
    grossAmountCents: Math.max(0, Math.round(Number(creatorLedger.grossAmount || 0))),
    currency: cleanString(creatorLedger.currency || 'USD', 12).toUpperCase(),
    platformFeeBps: Math.max(0, Math.round(Number(creatorLedger.platformFeeBps || 0))),
    platformFeeAmountCents: Math.max(0, Math.round(Number(creatorLedger.platformFeeAmount || 0))),
    stripeFeeAmountCents: creatorLedger.stripeFeeAmount == null ? null : Math.max(0, Math.round(Number(creatorLedger.stripeFeeAmount || 0))),
    stripeFeeStatus: cleanString(creatorLedger.stripeFeeStatus || '', 80),
    creatorNetAmountCents: Math.max(0, Math.round(Number(creatorLedger.creatorNetAmount || 0))),
    creatorNetStatus: cleanString(creatorLedger.creatorNetStatus || '', 80),
    feeMode: cleanString(creatorLedger.feeMode || 'seller_absorbs', 80),
    sellerPayoutStatus: 'pending',
    status: 'paid',
    livemode: session.livemode === true,
    paymentSource: session.livemode === true ? 'stripe_live' : 'stripe_test'
  }
}

function buyerOrderMirrorPayload({
  order = {},
  orderId = '',
  uid = '',
  productIds = [],
  items = [],
  orderFields = {},
  session = {},
  now
} = {}) {
  return {
    id: cleanString(orderId, 180),
    orderId: cleanString(orderId, 180),
    uid: cleanString(uid, 180),
    buyerUid: cleanString(uid, 180),
    productIds,
    items,
    status: 'paid',
    paymentStatus: 'paid',
    orderState: 'order_placed',
    checkoutStatus: orderFields.checkoutStatus,
    paidAt: order.paidAt || now,
    createdAt: order.createdAt || now,
    updatedAt: now,
    amountSubtotalCents: orderFields.amountSubtotalCents,
    amountTotalCents: orderFields.amountTotalCents,
    amountCents: orderFields.amountCents,
    currency: orderFields.currency,
    stripeSessionId: cleanString(session.id || '', 180),
    checkoutSessionId: cleanString(session.id || '', 180),
    paymentIntentId: orderFields.paymentIntentId,
    stripePaymentIntentId: orderFields.stripePaymentIntentId,
    paymentSource: session.livemode === true ? 'stripe_live' : 'stripe_test',
    livemode: session.livemode === true
  }
}

async function rebuildPlatformRevenueSummary(database = admin.firestore()) {
  const snapshot = await database.collection('platformRevenueLedger').limit(1000).get()
  const earnedByCurrency = {}
  let entryCount = 0
  snapshot.docs.forEach((docSnap) => {
    const data = docSnap.data() || {}
    if (cleanString(data.status || '', 40).toLowerCase() !== 'earned') return
    const currency = cleanString(data.currency || 'USD', 12).toUpperCase()
    const amount = Math.max(0, Math.round(Number(data.platformFeeAmountCents ?? data.platformFeeAmount ?? 0)))
    earnedByCurrency[currency] = (earnedByCurrency[currency] || 0) + amount
    entryCount += 1
  })
  await database.doc('platformRevenueSummary/current').set({
    earnedByCurrency,
    entryCount,
    source: 'rebuilt_from_platform_revenue_ledger',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  return { earnedByCurrency, entryCount }
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
    sellerUid: snapshot.creatorUid,
    creatorUid: snapshot.creatorUid,
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
    acquiredAt: now,
    grantedAt: now,
    createdAt: now,
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
  logger.info('[checkout-fulfillment] paid checkout fulfillment started', {
    eventId,
    eventType,
    source,
    sessionId: context.stripeSessionId,
    orderId: context.orderId,
    buyerUid: context.uid,
    productIds: context.productIds
  })
  const safeEventId = cleanString(eventId || `session_${context.stripeSessionId}`, 180).replaceAll('/', '_')
  const eventRef = database.collection('stripeWebhookEvents').doc(safeEventId)
  const earningsConfig = await loadCreatorEarningsConfig(database)
  const productLookup = await Promise.all(context.productIds.map((productId) => database.collection('products').doc(productId).get()))
  const productOwnerUids = productLookup.map((productSnap, index) => {
    const product = productSnap.exists ? productSnap.data() || {} : {}
    const orderItem = orderItemForProduct(context.order, context.productIds[index])
    return safeDocumentId(product.artistId || orderItem.creatorUid || orderItem.artistId || orderItem.productSnapshot?.creatorUid || '', 180)
  })
  const feeBpsByCreatorUid = new Map()
  await Promise.all([...new Set(productOwnerUids.filter(Boolean))].map(async (creatorUid) => {
    feeBpsByCreatorUid.set(creatorUid, await getSellerPlatformFeeBps(database, creatorUid, earningsConfig))
  }))
  const availableAt = admin.firestore.Timestamp.fromMillis(
    Date.now() + (earningsHoldDays() * 24 * 60 * 60 * 1000)
  )

  const result = await database.runTransaction(async (transaction) => {
    const productRefs = context.productIds.map((productId) => database.collection('products').doc(productId))
    const buyerOrderRef = database.doc(`users/${context.uid}/orders/${context.orderId}`)
    const entitlementRefs = context.productIds.map((productId) => database.doc(`users/${context.uid}/entitlements/${productId}`))
    const libraryRefs = context.productIds.map((productId) => database.doc(`users/${context.uid}/libraryItems/${productId}`))
    const ledgerRefs = context.productIds.map((productId) => (
      database.collection('creatorLedger').doc(ledgerEntryId(context.orderId, productId))
    ))
    const platformRevenueRefs = context.productIds.map((productId) => (
      database.collection('platformRevenueLedger').doc(ledgerEntryId(context.orderId, productId))
    ))
    const saleRefs = context.productIds.map((productId, index) => {
      const sellerUid = productOwnerUids[index] || ''
      return sellerUid && sellerUid !== context.uid
        ? database.doc(`users/${sellerUid}/sales/${ledgerEntryId(context.orderId, productId)}`)
        : null
    })
    const refs = [
      context.orderRef,
      eventRef,
      buyerOrderRef,
      ...productRefs,
      ...entitlementRefs,
      ...libraryRefs,
      ...ledgerRefs,
      ...platformRevenueRefs,
      ...saleRefs.filter(Boolean)
    ]
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)))
    const orderSnap = snapshots[0]
    if (!orderSnap.exists) throw new Error('Checkout order disappeared during fulfillment.')

    const buyerOrderSnap = snapshots[2]
    const productOffset = 3
    const entitlementOffset = productOffset + productRefs.length
    const libraryOffset = entitlementOffset + entitlementRefs.length
    const ledgerOffset = libraryOffset + libraryRefs.length
    const platformRevenueOffset = ledgerOffset + ledgerRefs.length
    const saleOffset = platformRevenueOffset + platformRevenueRefs.length
    const saleSnapshotByIndex = new Map()
    let saleSnapCursor = saleOffset
    saleRefs.forEach((ref, index) => {
      if (!ref) return
      saleSnapshotByIndex.set(index, snapshots[saleSnapCursor])
      saleSnapCursor += 1
    })
    const order = orderSnap.data() || {}
    const orderFields = stripeOrderFields(session, order)
    const grossAmounts = allocateGrossAmounts({
      order,
      productIds: context.productIds,
      amountTotalCents: orderFields.amountTotalCents
    })
    const stripeFeeAmounts = allocateAmountByWeights(stripeProcessingFee(session), grossAmounts)
    const orderChanged = cleanString(order.paymentStatus || '', 80).toLowerCase() !== 'paid'
      || cleanString(order.orderState || '', 80).toLowerCase() !== 'order_placed'
      || Number(order.amountTotalCents ?? order.amountCents ?? -1) !== orderFields.amountTotalCents
      || cleanString(order.paymentIntentId || order.stripePaymentIntentId || '', 180) !== orderFields.paymentIntentId
    const now = admin.firestore.FieldValue.serverTimestamp()
    const grantedProductIds = []
    const repairedProductIds = []
    const duplicateProductIds = []
    const ledgerEntryIds = []
    const duplicateLedgerEntryIds = []
    const repairedLedgerEntryIds = []
    const sellerSaleIds = []
    const duplicateSellerSaleIds = []
    const repairedSellerSaleIds = []
    const platformRevenueEntryIds = []
    const duplicatePlatformRevenueEntryIds = []
    const missingCreatorProductIds = []
    const skippedReasons = []
    let libraryWriteCount = 0
    let entitlementWriteCount = 0
    const creatorUids = new Set()

    context.productIds.forEach((productId, index) => {
      const productSnap = snapshots[productOffset + index]
      const entitlementSnap = snapshots[entitlementOffset + index]
      const librarySnap = snapshots[libraryOffset + index]
      const ledgerSnap = snapshots[ledgerOffset + index]
      const platformRevenueSnap = snapshots[platformRevenueOffset + index]
      const saleSnap = saleSnapshotByIndex.get(index)
      const entitlementActive = isActiveAccess(entitlementSnap)
      const libraryActive = isActiveAccess(librarySnap)
      const entitlementNeedsWrite = accessWriteNeeded(entitlementSnap, context)
      const libraryNeedsWrite = accessWriteNeeded(librarySnap, context)
      const product = productSnap.exists ? productSnap.data() || {} : {}
      const orderItem = orderItemForProduct(order, productId)
      const digitalRequired = paidLineRequiresDigitalAccess(product, orderItem)
      const physicalRequired = hasPhysicalFulfillment({ ...product, ...orderItem })
      const payload = purchaseAccessPayload({
        uid: context.uid,
        productId,
        product,
        orderItem,
        orderId: context.orderId,
        session,
        now
      })
      logger.info('[checkout-fulfillment] product fulfillment planned', {
        orderId: context.orderId,
        sessionId: context.stripeSessionId,
        buyerUid: context.uid,
        productId,
        productExists: productSnap.exists === true,
        fulfillmentType: normalizeProductFulfillment({ ...product, ...orderItem }).type,
        shouldGrantLibraryAccess: digitalRequired,
        entitlementPath: entitlementRefs[index].path,
        libraryItemPath: libraryRefs[index].path,
        digitalRequired,
        physicalRequired,
        creatorUid: payload.productSnapshot.creatorUid,
        grossAmount: grossAmounts[index] || 0
      })

      if (digitalRequired) {
        if (!entitlementNeedsWrite && !libraryNeedsWrite && entitlementActive && libraryActive) duplicateProductIds.push(productId)
        else if (entitlementSnap.exists || librarySnap.exists) repairedProductIds.push(productId)
        else grantedProductIds.push(productId)
      } else {
        skippedReasons.push({ productId, reason: 'digital_access_not_required' })
      }

      if (digitalRequired) {
        grantBuyerLibraryAccess({
          transaction,
          database,
          buyerUid: context.uid,
          productId,
          product,
          orderItem,
          orderId: context.orderId,
          session,
          now,
          entitlementSnap,
          librarySnap
        })
        if (entitlementNeedsWrite) entitlementWriteCount += 1
        if (libraryNeedsWrite) libraryWriteCount += 1
      }

      if (physicalRequired && orderChanged) {
        transaction.set(productRefs[index], {
          physical: { quantitySold: admin.firestore.FieldValue.increment(1) },
          updatedAt: now
        }, { merge: true })
      }

      const creatorUid = safeDocumentId(payload.productSnapshot.creatorUid, 180)
      if (!creatorUid || creatorUid === context.uid) {
        missingCreatorProductIds.push(productId)
        skippedReasons.push({ productId, reason: !creatorUid ? 'missing_creator_uid' : 'buyer_is_creator' })
      } else {
        const ledgerPayload = creatorLedgerPayload({
          creatorUid,
          buyerUid: context.uid,
          productId,
          orderId: context.orderId,
          stripeCheckoutSessionId: context.stripeSessionId,
          paymentIntentId: orderFields.paymentIntentId,
          grossAmount: grossAmounts[index] || 0,
          currency: orderFields.currency,
          feeBps: feeBpsByCreatorUid.get(creatorUid) ?? earningsConfig.defaultPlatformFeeBps,
          feeConfigSource: earningsConfig.source,
          feeConfigVersion: earningsConfig.version,
          feeMode: earningsConfig.feeMode,
          stripeFeeAmount: stripeFeeAmounts[index],
          productSnapshot: payload.productSnapshot,
          availableAt,
          now
        })
        logger.info('[checkout-fulfillment] seller accounting planned', {
          orderId: context.orderId,
          sessionId: context.stripeSessionId,
          buyerUid: context.uid,
          productId,
          sellerUid: creatorUid,
          grossAmount: ledgerPayload.grossAmount,
          platformFee: ledgerPayload.platformFeeAmount,
          creatorNet: ledgerPayload.creatorNetAmount,
          ledgerPath: ledgerRefs[index].path,
          salePath: saleRefs[index]?.path || '',
          platformRevenuePath: platformRevenueRefs[index].path
        })
        if (ledgerSnap.exists) {
          duplicateLedgerEntryIds.push(ledgerRefs[index].id)
          const existing = ledgerSnap.data() || {}
          const existingCreatorUid = cleanString(existing.creatorUid || '', 180)
          if (existingCreatorUid) creatorUids.add(existingCreatorUid)
          if (existing.stripeFeeAmount == null
            && Number.isInteger(ledgerPayload.stripeFeeAmount)) {
            repairedLedgerEntryIds.push(ledgerRefs[index].id)
            transaction.set(ledgerRefs[index], {
              stripeFeeAmount: ledgerPayload.stripeFeeAmount,
              stripeFeeStatus: ledgerPayload.stripeFeeStatus,
              creatorNetAmount: ledgerPayload.creatorNetAmount,
              creatorNetStatus: ledgerPayload.creatorNetStatus,
              productSnapshot: ledgerPayload.productSnapshot,
              productTitle: ledgerPayload.productTitle,
              productType: ledgerPayload.productType,
              source: ledgerPayload.source,
              updatedAt: now
            }, { merge: true })
          }
        } else {
          creatorUids.add(creatorUid)
          ledgerEntryIds.push(ledgerRefs[index].id)
          transaction.set(ledgerRefs[index], ledgerPayload)
        }

        const saleId = ledgerRefs[index].id
        const salePayload = sellerSalePayload({
          creatorLedger: ledgerPayload,
          productSnapshot: payload.productSnapshot,
          saleId,
          orderId: context.orderId,
          productId,
          session,
          now
        })
        if (saleSnap?.exists) {
          duplicateSellerSaleIds.push(saleId)
          const existing = saleSnap.data() || {}
          if (existing.stripeFeeAmountCents == null && Number.isInteger(salePayload.stripeFeeAmountCents)) {
            repairedSellerSaleIds.push(saleId)
            transaction.set(saleRefs[index], {
              stripeFeeAmountCents: salePayload.stripeFeeAmountCents,
              stripeFeeStatus: salePayload.stripeFeeStatus,
              creatorNetAmountCents: salePayload.creatorNetAmountCents,
              creatorNetStatus: salePayload.creatorNetStatus,
              updatedAt: now
            }, { merge: true })
          }
        } else if (saleRefs[index]) {
          sellerSaleIds.push(saleId)
          transaction.set(saleRefs[index], salePayload)
        }

        if (platformRevenueSnap.exists) {
          duplicatePlatformRevenueEntryIds.push(platformRevenueRefs[index].id)
        } else {
          platformRevenueEntryIds.push(platformRevenueRefs[index].id)
          transaction.set(platformRevenueRefs[index], platformRevenuePayload({
            creatorLedger: ledgerPayload,
            orderId: context.orderId,
            productId,
            stripeCheckoutSessionId: context.stripeSessionId,
            paymentIntentId: orderFields.paymentIntentId,
            livemode: session.livemode === true,
            now
          }))
        }
      }
    })

    const items = (Array.isArray(order.items) ? order.items : []).map((item) => {
      const productId = cleanString(item?.productId || '', 180)
      if (!context.productIds.includes(productId)) return item
      const productIndex = context.productIds.indexOf(productId)
      const productSnap = productIndex >= 0 ? snapshots[productOffset + productIndex] : null
      const product = productSnap?.exists ? productSnap.data() || {} : {}
      const physicalRequired = hasPhysicalFulfillment({ ...product, ...item })
      const digitalRequired = paidLineRequiresDigitalAccess(product, item)
      return {
        ...item,
        entitlementStatus: digitalRequired ? 'active' : 'not_applicable',
        fulfillment: {
          ...(item.fulfillment || {}),
          type: normalizeProductFulfillment({ ...product, ...item }).type,
          digital: { ...(item.fulfillment?.digital || {}), required: digitalRequired, status: digitalRequired ? 'active' : 'not_applicable' },
          physical: { ...(item.fulfillment?.physical || {}), required: physicalRequired, status: physicalRequired ? 'pending_seller_fulfillment' : 'not_applicable' }
        }
      }
    })
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
      ...orderFields,
      livemode: session.livemode === true,
      paymentSource: session.livemode === true ? 'stripe_live' : 'stripe_test',
      fulfillmentSource: source,
      entitlementStatus: grantedProductIds.length || repairedProductIds.length || duplicateProductIds.length ? 'active' : 'not_applicable',
      updatedAt: now
    }, { merge: true })
    transaction.set(buyerOrderRef, buyerOrderMirrorPayload({
      order,
      orderId: context.orderId,
      uid: context.uid,
      productIds: context.productIds,
      items,
      orderFields,
      session,
      now
    }), { merge: true })
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
      ledgerEntryIds,
      duplicateLedgerEntryIds,
      repairedLedgerEntryIds,
      sellerSaleIds,
      duplicateSellerSaleIds,
      repairedSellerSaleIds,
      platformRevenueEntryIds,
      duplicatePlatformRevenueEntryIds,
      missingCreatorProductIds,
      buyerOrderMirrorWritten: !buyerOrderSnap.exists || orderChanged,
      libraryWriteCount,
      entitlementWriteCount,
      skippedReasons,
      processedAt: now,
      updatedAt: now
    }, { merge: true })

    const customerLifecycleChanged = orderChanged
      || grantedProductIds.length > 0
      || repairedProductIds.length > 0
    const buyerOrderMirrorWritten = !buyerOrderSnap.exists || orderChanged
    const ledgerChanged = ledgerEntryIds.length > 0 || repairedLedgerEntryIds.length > 0 || sellerSaleIds.length > 0 || repairedSellerSaleIds.length > 0 || platformRevenueEntryIds.length > 0
    return {
      uid: context.uid,
      orderId: context.orderId,
      stripeSessionId: context.stripeSessionId,
      productIds: context.productIds,
      grantedProductIds,
      repairedProductIds,
      duplicateProductIds,
      ledgerEntryIds,
      duplicateLedgerEntryIds,
      repairedLedgerEntryIds,
      sellerSaleIds,
      duplicateSellerSaleIds,
      repairedSellerSaleIds,
      platformRevenueEntryIds,
      duplicatePlatformRevenueEntryIds,
      missingCreatorProductIds,
      buyerOrderMirrorWritten,
      libraryWriteCount,
      entitlementWriteCount,
      skippedReasons,
      creatorUids: [...creatorUids],
      orderMarkedPaid: true,
      orderChanged,
      customerLifecycleChanged,
      ledgerChanged,
      changed: customerLifecycleChanged || ledgerChanged || buyerOrderMirrorWritten
    }
  })
  await Promise.all([
    rebuildCommerceSummary(database, context.uid).catch((error) => {
      logger.error('[checkout-fulfillment] commerce summary rebuild failed', {
        uid: context.uid,
        orderId: context.orderId,
        message: error?.message || ''
      })
    }),
    rebuildCreatorEarningsSummaries(database, result.creatorUids),
    rebuildPlatformRevenueSummary(database).catch((error) => {
      logger.error('[checkout-fulfillment] platform revenue summary rebuild failed', {
        orderId: context.orderId,
        message: error?.message || ''
      })
    })
  ])
  if (result.missingCreatorProductIds.length) {
    logger.error('[checkout-fulfillment] creator earnings skipped because product ownership is missing', {
      orderId: context.orderId,
      productIds: result.missingCreatorProductIds
    })
  }
  logger.info('[checkout-fulfillment] paid checkout fulfillment finished', {
    orderId: result.orderId,
    sessionId: result.stripeSessionId,
    buyerUid: result.uid,
    productCount: result.productIds.length,
    grantedCount: result.grantedProductIds.length,
    repairedCount: result.repairedProductIds.length,
    duplicateCount: result.duplicateProductIds.length,
    libraryWriteCount: result.libraryWriteCount,
    entitlementWriteCount: result.entitlementWriteCount,
    sellerSaleCount: result.sellerSaleIds.length,
    ledgerCount: result.ledgerEntryIds.length,
    platformRevenueCount: result.platformRevenueEntryIds.length,
    missingCreatorCount: result.missingCreatorProductIds.length,
    orderMarkedPaid: result.orderMarkedPaid
  })
  return result
}

module.exports = {
  fulfillPaidCheckout,
  productSnapshot,
  resolveCheckoutContext,
  __test: {
    accessWriteNeeded,
    grantBuyerLibraryAccess,
    normalizeProductIds,
    paymentIntentId,
    buyerOrderMirrorPayload,
    paidLineRequiresDigitalAccess,
    platformRevenuePayload,
    productSnapshot,
    purchaseAccessPayload,
    rebuildPlatformRevenueSummary,
    sellerSalePayload,
    stripeAmount,
    stripeOrderFields,
    stripeProcessingFee
  }
}
