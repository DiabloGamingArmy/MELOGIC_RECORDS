const admin = require('firebase-admin')
const { logger } = require('firebase-functions')
const { defineInt } = require('firebase-functions/params')

const DEFAULT_PLATFORM_FEE_BPS = 1500
const DEFAULT_HOLD_DAYS = 7
const CREATOR_EARNINGS_HOLD_DAYS = defineInt('CREATOR_EARNINGS_HOLD_DAYS', {
  default: DEFAULT_HOLD_DAYS
})

function cleanString(value = '', max = 180) {
  return String(value ?? '').trim().slice(0, max)
}

function nonNegativeInt(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback
  const amount = Number(value)
  return Number.isInteger(amount) && amount >= 0 ? amount : fallback
}

function configuredInt(value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed)) return fallback
  return Math.min(max, Math.max(min, parsed))
}

function earningsHoldDays() {
  return configuredInt(CREATOR_EARNINGS_HOLD_DAYS.value(), DEFAULT_HOLD_DAYS, { min: 0, max: 90 })
}

async function loadCreatorEarningsConfig(database) {
  const snapshot = await database.doc('platformSettings/marketplacePricing').get()
  const data = snapshot.exists ? snapshot.data() || {} : {}
  return {
    platformFeeBps: configuredInt(data.platformFeeBps, DEFAULT_PLATFORM_FEE_BPS, { min: 0, max: 5000 }),
    feeMode: cleanString(data.feeMode || 'seller_absorbs', 80),
    version: configuredInt(data.version, 1, { min: 1, max: 100000 }),
    source: snapshot.exists ? 'platformSettings/marketplacePricing' : 'marketplace_pricing_fallback'
  }
}

function ledgerEntryId(orderId = '', productId = '') {
  return `${cleanString(orderId, 500)}_${cleanString(productId, 500)}`
    .replaceAll('/', '_')
    .slice(0, 1200)
}

function orderItemAmount(item = {}) {
  const direct = nonNegativeInt(item.amountTotalCents ?? item.amountCents ?? item.priceCents, null)
  if (direct !== null) return direct
  const unit = nonNegativeInt(item.unitAmountCents, null)
  const quantity = Math.max(1, nonNegativeInt(item.quantity, 1))
  return unit === null ? null : unit * quantity
}

function allocateGrossAmounts({ order = {}, productIds = [], amountTotalCents = null } = {}) {
  const items = Array.isArray(order.items) ? order.items : []
  const sourceAmounts = productIds.map((productId) => {
    const item = items.find((row) => cleanString(row?.productId || row?.id || '', 180) === productId) || {}
    return orderItemAmount(item) ?? 0
  })
  const trustedTotal = nonNegativeInt(amountTotalCents, null)
  const sourceTotal = sourceAmounts.reduce((sum, amount) => sum + amount, 0)
  if (trustedTotal === null || trustedTotal === sourceTotal) return sourceAmounts
  if (sourceTotal <= 0) return productIds.length === 1 ? [trustedTotal] : sourceAmounts

  let allocated = 0
  return sourceAmounts.map((amount, index) => {
    if (index === sourceAmounts.length - 1) return Math.max(0, trustedTotal - allocated)
    const share = Math.max(0, Math.round((trustedTotal * amount) / sourceTotal))
    allocated += share
    return share
  })
}

function allocateAmountByWeights(totalAmount = null, weights = []) {
  const total = nonNegativeInt(totalAmount, null)
  if (total === null) return weights.map(() => null)
  const safeWeights = weights.map((weight) => nonNegativeInt(weight, 0))
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0)
  if (weightTotal <= 0) return safeWeights.length === 1 ? [total] : safeWeights.map(() => 0)

  let allocated = 0
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) return Math.max(0, total - allocated)
    const share = Math.max(0, Math.round((total * weight) / weightTotal))
    allocated += share
    return share
  })
}

function creatorLedgerPayload({
  creatorUid = '',
  buyerUid = '',
  productId = '',
  orderId = '',
  stripeCheckoutSessionId = '',
  grossAmount = 0,
  currency = 'USD',
  feeBps = DEFAULT_PLATFORM_FEE_BPS,
  feeConfigSource = '',
  feeConfigVersion = 1,
  feeMode = 'seller_absorbs',
  stripeFeeAmount = null,
  availableAt = null,
  now = null
} = {}) {
  const gross = nonNegativeInt(grossAmount, 0)
  const safeFeeBps = Math.min(10000, Math.max(0, nonNegativeInt(feeBps, DEFAULT_PLATFORM_FEE_BPS)))
  const platformFeeAmount = Math.min(gross, Math.round((gross * safeFeeBps) / 10000))
  const safeStripeFee = nonNegativeInt(stripeFeeAmount, null)
  const creatorAbsorbsStripeFee = cleanString(feeMode || 'seller_absorbs', 80) === 'seller_absorbs'
  const netBeforeStripeFee = Math.max(0, gross - platformFeeAmount)
  const creatorNetAmount = Math.max(0, netBeforeStripeFee - (creatorAbsorbsStripeFee ? safeStripeFee || 0 : 0))
  return {
    creatorUid: cleanString(creatorUid, 180),
    buyerUid: cleanString(buyerUid, 180),
    productId: cleanString(productId, 180),
    orderId: cleanString(orderId, 180),
    stripeCheckoutSessionId: cleanString(stripeCheckoutSessionId, 180),
    grossAmount: gross,
    platformFeeAmount,
    platformFeeBps: safeFeeBps,
    platformFeeSource: cleanString(feeConfigSource, 180),
    platformFeeConfigVersion: configuredInt(feeConfigVersion, 1, { min: 1, max: 100000 }),
    feeMode: cleanString(feeMode || 'seller_absorbs', 80),
    stripeFeeAmount: safeStripeFee,
    stripeFeeStatus: safeStripeFee === null ? 'not_available_at_checkout_confirmation' : 'stripe_balance_transaction',
    creatorNetAmount,
    creatorNetStatus: creatorAbsorbsStripeFee && safeStripeFee === null
      ? 'before_stripe_fee'
      : 'finalized_for_ledger',
    currency: cleanString(currency || 'USD', 12).toUpperCase(),
    status: 'pending',
    availableAt,
    createdAt: now,
    updatedAt: now
  }
}

function addCurrencyAmount(target, currency, amount) {
  target[currency] = (target[currency] || 0) + amount
}

function buildEarningsSummary(entries = []) {
  const pendingByCurrency = {}
  const availableByCurrency = {}
  const withdrawnByCurrency = {}
  const lifetimeGrossByCurrency = {}
  const lifetimeNetByCurrency = {}
  let lastEarningMillis = 0
  let unfinalizedEntryCount = 0

  entries.forEach((entry = {}) => {
    const status = cleanString(entry.status || 'pending', 40).toLowerCase()
    const currency = cleanString(entry.currency || 'USD', 12).toUpperCase()
    const gross = nonNegativeInt(entry.grossAmount, 0)
    const net = nonNegativeInt(entry.creatorNetAmount, 0)
    if (['reversed', 'refunded'].includes(status)) return
    if (entry.creatorNetStatus === 'before_stripe_fee') unfinalizedEntryCount += 1

    addCurrencyAmount(lifetimeGrossByCurrency, currency, gross)
    addCurrencyAmount(lifetimeNetByCurrency, currency, net)
    if (status === 'pending') addCurrencyAmount(pendingByCurrency, currency, net)
    if (status === 'available') addCurrencyAmount(availableByCurrency, currency, net)
    if (status === 'withdrawn') addCurrencyAmount(withdrawnByCurrency, currency, net)

    const value = entry.updatedAt || entry.createdAt
    const millis = typeof value?.toMillis === 'function'
      ? value.toMillis()
      : new Date(value || 0).getTime()
    if (Number.isFinite(millis)) lastEarningMillis = Math.max(lastEarningMillis, millis)
  })

  const currencies = [...new Set([
    ...Object.keys(lifetimeGrossByCurrency),
    ...Object.keys(lifetimeNetByCurrency)
  ])].sort()
  const singleCurrency = currencies.length === 1 ? currencies[0] : ''
  return {
    pendingByCurrency,
    availableByCurrency,
    withdrawnByCurrency,
    lifetimeGrossByCurrency,
    lifetimeNetByCurrency,
    pendingAmount: singleCurrency ? pendingByCurrency[singleCurrency] || 0 : null,
    availableAmount: singleCurrency ? availableByCurrency[singleCurrency] || 0 : null,
    withdrawnAmount: singleCurrency ? withdrawnByCurrency[singleCurrency] || 0 : null,
    lifetimeGrossAmount: singleCurrency ? lifetimeGrossByCurrency[singleCurrency] || 0 : null,
    lifetimeNetAmount: singleCurrency ? lifetimeNetByCurrency[singleCurrency] || 0 : null,
    currency: singleCurrency,
    entryCount: entries.length,
    unfinalizedEntryCount,
    lastEarningMillis
  }
}

async function rebuildCreatorEarningsSummary(database, creatorUid = '') {
  const uid = cleanString(creatorUid, 180)
  if (!uid || uid.includes('/')) throw new Error('A valid creator UID is required.')
  const snapshot = await database.collection('creatorLedger').where('creatorUid', '==', uid).limit(1000).get()
  const summary = buildEarningsSummary(snapshot.docs.map((docSnap) => docSnap.data() || {}))
  const payload = {
    uid,
    ...summary,
    lastEarningAt: summary.lastEarningMillis
      ? admin.firestore.Timestamp.fromMillis(summary.lastEarningMillis)
      : null,
    source: 'rebuilt_from_creator_ledger',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
  delete payload.lastEarningMillis
  await database.doc(`users/${uid}/earningsSummary/current`).set(payload, { merge: true })
  return payload
}

async function rebuildCreatorEarningsSummaries(database, creatorUids = []) {
  const uniqueUids = [...new Set(creatorUids.map((uid) => cleanString(uid, 180)).filter(Boolean))]
  const results = await Promise.allSettled(uniqueUids.map((uid) => rebuildCreatorEarningsSummary(database, uid)))
  results.forEach((result, index) => {
    if (result.status === 'rejected') {
      logger.error('[creator-earnings] summary rebuild failed', {
        creatorUid: uniqueUids[index],
        message: result.reason?.message || ''
      })
    }
  })
}

module.exports = {
  allocateAmountByWeights,
  allocateGrossAmounts,
  buildEarningsSummary,
  creatorLedgerPayload,
  earningsHoldDays,
  ledgerEntryId,
  loadCreatorEarningsConfig,
  rebuildCreatorEarningsSummaries,
  rebuildCreatorEarningsSummary,
  __test: {
    allocateAmountByWeights,
    allocateGrossAmounts,
    buildEarningsSummary,
    creatorLedgerPayload,
    ledgerEntryId,
    orderItemAmount
  }
}
