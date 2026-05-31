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

function countMap(raw = {}) {
  const counts = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return Object.fromEntries(
    Object.entries(counts)
      .slice(0, 20)
      .map(([key, value]) => [cleanString(key, 80), Math.max(0, Math.round(toNumber(value)))])
      .filter(([key]) => Boolean(key))
  )
}

function productSummary(docSnap) {
  const raw = docSnap.data() || {}
  return sanitizeProductForQueue(docSnap.id, raw)
}

function profileSummary(docSnap, adminUser = null) {
  const raw = docSnap.data() || {}
  const stats = raw.stats && typeof raw.stats === 'object' && !Array.isArray(raw.stats) ? raw.stats : {}
  const adminData = adminUser || {}
  return {
    uid: cleanString(raw.uid || docSnap.id, 180),
    displayName: cleanString(raw.displayName || raw.name || adminData.displayName || 'User', 180),
    username: cleanString(raw.username || raw.usernameLower || '', 120),
    usernameLower: cleanString(raw.usernameLower || raw.username || '', 120),
    email: cleanString(raw.email || adminData.email || '', 320),
    avatarURL: cleanString(raw.avatarURL || raw.photoURL || adminData.photoURL || '', 900),
    photoURL: cleanString(raw.photoURL || raw.avatarURL || adminData.photoURL || '', 900),
    role: cleanString(raw.role || raw.accountType || adminData.role || 'user', 80),
    roleLabel: cleanString(raw.roleLabel || adminData.role || 'User', 120),
    adminRole: cleanString(adminData.role || '', 80),
    adminActive: adminData.active === true,
    verified: raw.verified === true,
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
    type: cleanString(raw.type || raw.reportType || raw.targetType || 'report', 80),
    targetType: cleanString(raw.targetType || '', 80),
    targetId: cleanString(raw.targetId || raw.productId || raw.uid || '', 180),
    reporterUid: cleanString(raw.reporterUid || raw.createdBy || raw.uid || '', 180),
    reason: cleanString(raw.reason || raw.summary || raw.description || '', 600),
    priority: cleanString(raw.priority || 'normal', 80),
    status: cleanString(raw.status || 'open', 80),
    assignedTo: cleanString(raw.assignedTo || '', 180),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

function orderSummary(docSnap) {
  const raw = docSnap.data() || {}
  const lineItems = Array.isArray(raw.items) ? raw.items : Array.isArray(raw.products) ? raw.products : []
  return {
    id: docSnap.id,
    uid: cleanString(raw.uid || raw.buyerUid || raw.userId || '', 180),
    buyerUid: cleanString(raw.buyerUid || raw.uid || raw.userId || '', 180),
    productCount: lineItems.length || Math.max(0, Math.round(toNumber(raw.productCount))),
    productTitles: lineItems.map((item) => cleanString(item?.title || item?.productTitle || item?.productId || '', 180)).filter(Boolean).slice(0, 5),
    amountCents: Math.max(0, Math.round(toNumber(raw.amountCents || raw.totalCents || raw.total || raw.amount_total))),
    currency: cleanString(raw.currency || 'USD', 12),
    paymentStatus: cleanString(raw.paymentStatus || raw.status || '', 80),
    refundStatus: cleanString(raw.refundStatus || '', 80),
    checkoutSessionId: cleanString(raw.checkoutSessionId || raw.sessionId || '', 180),
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
    metadata: countMap(raw.metadata),
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
  safeListCollection
}
