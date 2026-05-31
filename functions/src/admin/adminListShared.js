const admin = require('firebase-admin')
const { cleanString } = require('./adminAuth')
const { sanitizeProductForQueue, serializeDate } = require('./marketplaceReviewShared')

function db() {
  return admin.firestore()
}

function toNumber(value = 0) {
  const number = Number(value || 0)
  return Number.isFinite(number) ? number : 0
}

function normalizeLimit(value = 50, max = 100) {
  return Math.max(1, Math.min(Math.round(toNumber(value || 50)), max))
}

async function safeListCollection(collectionName = '', { orderBy = 'updatedAt', direction = 'desc', limit = 50 } = {}) {
  const ref = db().collection(collectionName)
  try {
    return await ref.orderBy(orderBy, direction).limit(normalizeLimit(limit)).get()
  } catch (error) {
    return ref.limit(normalizeLimit(limit)).get()
  }
}

function safeSummaryValue(value, depth = 0) {
  if (value === null || value === undefined) return value === undefined ? null : value
  if (typeof value?.toDate === 'function') return serializeDate(value)
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return cleanString(value, 1200)
  if (Array.isArray(value)) {
    if (depth >= 3) return `[array:${value.length}]`
    return value.slice(0, 30).map((item) => safeSummaryValue(item, depth + 1))
  }
  if (typeof value === 'object') {
    if (depth >= 3) return '[object]'
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, child]) => [cleanString(key, 120), safeSummaryValue(child, depth + 1)])
        .filter(([key]) => Boolean(key))
    )
  }
  return cleanString(String(value), 500)
}

function cleanStringList(value = [], maxItems = 20) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => cleanString(item, 80))
    .filter(Boolean)
    .slice(0, maxItems)
}

function productSummary(docSnap) {
  const raw = docSnap.data() || {}
  return sanitizeProductForQueue(docSnap.id, raw)
}

function profileSummary(docSnap, adminUser = null, accountData = {}) {
  const raw = docSnap.data() || {}
  const stats = raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats) ? raw.stats : {}
  const adminData = adminUser || {}
  const account = accountData && typeof accountData === 'object' && !Array.isArray(accountData) ? accountData : {}
  const roles = cleanStringList(account.roles || raw.roles)
  const badges = cleanStringList(raw.badges || account.badges)
  const verified = raw.verified === true || roles.includes('verified') || badges.includes('verified')
  return {
    uid: cleanString(raw.uid || docSnap.id, 180),
    displayName: cleanString(raw.displayName || raw.name || adminData.displayName || 'User', 180),
    username: cleanString(raw.username || raw.usernameLower || '', 120),
    usernameLower: cleanString(raw.usernameLower || raw.username || '', 120),
    email: cleanString(raw.email || account.email || adminData.email || '', 320),
    avatarURL: cleanString(raw.avatarURL || raw.photoURL || account.photoURL || adminData.photoURL || '', 900),
    photoURL: cleanString(raw.photoURL || raw.avatarURL || account.photoURL || adminData.photoURL || '', 900),
    role: cleanString(raw.role || raw.accountType || adminData.role || 'user', 80),
    roleLabel: cleanString(raw.roleLabel || adminData.role || 'User', 120),
    adminRole: cleanString(adminData.role || '', 80),
    adminActive: adminData.active === true,
    roles,
    badges,
    verified,
    suspended: raw.suspended === true,
    productCount: Math.max(0, Math.round(toNumber(stats.products || raw.productCount))),
    reportCount: Math.max(0, Math.round(toNumber(stats.reports || raw.reportCount))),
    createdAt: serializeDate(raw.createdAt || adminData.createdAt),
    updatedAt: serializeDate(raw.updatedAt || adminData.updatedAt),
    lastActiveAt: serializeDate(raw.lastActiveAt || raw.lastSeenAt)
  }
}

function adminUserSummary(docSnap) {
  const raw = docSnap.data() || {}
  return {
    uid: cleanString(raw.uid || docSnap.id, 180),
    displayName: cleanString(raw.displayName || '', 180),
    email: cleanString(raw.email || '', 320),
    photoURL: cleanString(raw.photoURL || '', 900),
    role: cleanString(raw.role || '', 80),
    active: raw.active === true,
    permissions: raw.claims && typeof raw.claims === 'object' && !Array.isArray(raw.claims) ? raw.claims : {},
    addedBy: cleanString(raw.createdBy || raw.updatedBy || '', 180),
    updatedBy: cleanString(raw.updatedBy || '', 180),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

function reportSummary(docSnap) {
  const raw = docSnap.data() || {}
  return {
    id: docSnap.id,
    reportId: cleanString(raw.reportId || docSnap.id, 180),
    type: cleanString(raw.type || raw.reportType || raw.targetType || 'report', 80),
    targetType: cleanString(raw.targetType || '', 80),
    targetId: cleanString(raw.targetId || raw.productId || raw.uid || '', 180),
    targetOwnerUid: cleanString(raw.targetOwnerUid || raw.ownerUid || raw.artistId || '', 180),
    reporterUid: cleanString(raw.reporterUid || raw.createdBy || raw.uid || '', 180),
    reason: cleanString(raw.reason || raw.summary || raw.description || '', 600),
    description: cleanString(raw.description || '', 2000),
    priority: cleanString(raw.priority || 'normal', 80),
    status: cleanString(raw.status || 'open', 80),
    sourcePath: cleanString(raw.sourcePath || '', 900),
    metadata: safeSummaryValue(raw.metadata || {}),
    assignedTo: cleanString(raw.assignedTo || '', 180),
    resolvedBy: cleanString(raw.resolvedBy || '', 180),
    resolvedAt: serializeDate(raw.resolvedAt),
    resolution: cleanString(raw.resolution || '', 1200),
    adminNotes: cleanString(raw.adminNotes || raw.notes || '', 2400),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

function orderSummary(docSnap) {
  const raw = docSnap.data() || {}
  const lineItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.products) ? raw.products : []
  const cleanItems = lineItems.slice(0, 25).map((item) => ({
    productId: cleanString(item?.productId || item?.id || '', 180),
    title: cleanString(item?.title || item?.productTitle || item?.productId || '', 180),
    creatorUid: cleanString(item?.creatorUid || item?.artistId || item?.sellerUid || '', 180),
    entitlementId: cleanString(item?.entitlementId || '', 180),
    entitlementStatus: cleanString(item?.entitlementStatus || item?.status || '', 80),
    amountCents: Math.max(0, Math.round(toNumber(item?.amountCents || item?.priceCents || item?.amount)))
  }))
  return {
    id: docSnap.id,
    uid: cleanString(raw.uid || raw.buyerUid || raw.userId || '', 180),
    buyerUid: cleanString(raw.buyerUid || raw.uid || raw.userId || '', 180),
    buyerEmail: cleanString(raw.buyerEmail || raw.email || '', 320),
    productCount: lineItems.length || Math.max(0, Math.round(toNumber(raw.productCount))),
    productIds: cleanItems.map((item) => item.productId).filter(Boolean).slice(0, 25),
    productTitles: cleanItems.map((item) => item.title).filter(Boolean).slice(0, 5),
    items: cleanItems,
    amountCents: Math.max(0, Math.round(toNumber(raw.amountCents || raw.totalCents || raw.total || raw.amount_total))),
    currency: cleanString(raw.currency || 'USD', 12),
    paymentStatus: cleanString(raw.paymentStatus || raw.status || '', 80),
    refundStatus: cleanString(raw.refundStatus || '', 80),
    refundReason: cleanString(raw.refundReason || raw.refundNote || '', 600),
    checkoutSessionId: cleanString(raw.checkoutSessionId || raw.sessionId || '', 180),
    paymentIntentId: cleanString(raw.paymentIntentId || raw.stripePaymentIntentId || '', 180),
    stripeCustomerId: cleanString(raw.stripeCustomerId || raw.customerId || '', 180),
    supportNotes: cleanString(raw.supportNotes || raw.adminNotes || '', 900),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

function logSummary(docSnap) {
  const raw = docSnap.data() || {}
  return {
    id: docSnap.id,
    actorUid: cleanString(raw.actorUid || '', 180),
    actorEmail: cleanString(raw.actorEmail || '', 320),
    actorRole: cleanString(raw.actorRole || '', 80),
    action: cleanString(raw.action || '', 120),
    targetType: cleanString(raw.targetType || '', 80),
    targetId: cleanString(raw.targetId || '', 180),
    targetPath: cleanString(raw.targetPath || '', 360),
    reason: cleanString(raw.reason || '', 900),
    summary: cleanString(raw.summary || raw.message || '', 1200),
    before: safeSummaryValue(raw.before || null),
    after: safeSummaryValue(raw.after || null),
    metadata: safeSummaryValue(raw.metadata || {}),
    createdAt: serializeDate(raw.createdAt)
  }
}

module.exports = {
  adminUserSummary,
  db,
  logSummary,
  normalizeLimit,
  orderSummary,
  productSummary,
  profileSummary,
  reportSummary,
  safeListCollection,
  safeSummaryValue,
  serializeDate
}
