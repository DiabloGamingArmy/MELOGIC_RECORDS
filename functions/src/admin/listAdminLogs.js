const { onCall } = require('firebase-functions/v2/https')
const { assertPermission } = require('./adminAuth')
const { db, logSummary, normalizeLimit, safeListCollection } = require('./adminListShared')

function clean(value = '', max = 180) {
  return String(value || '').trim().slice(0, max)
}

function shortId(value = '') {
  const raw = clean(value, 180)
  if (raw.length <= 14) return raw
  return `${raw.slice(0, 6)}...${raw.slice(-4)}`
}

async function userSummary(uid = '') {
  const cleanUid = clean(uid)
  if (!cleanUid) return null
  const [profileSnap, userSnap, adminSnap] = await Promise.all([
    db().collection('profiles').doc(cleanUid).get().catch(() => null),
    db().collection('users').doc(cleanUid).get().catch(() => null),
    db().collection('adminUsers').doc(cleanUid).get().catch(() => null)
  ])
  const profile = profileSnap?.exists ? profileSnap.data() || {} : {}
  const user = userSnap?.exists ? userSnap.data() || {} : {}
  const adminUser = adminSnap?.exists ? adminSnap.data() || {} : {}
  const username = clean(profile.username || profile.usernameLower || user.username || user.usernameLower || adminUser.username || '', 120).replace(/^@+/, '')
  const displayName = clean(profile.displayName || user.displayName || adminUser.displayName || profile.name || '', 180)
  return {
    uid: cleanUid,
    username,
    displayName,
    label: username ? `@${username}` : displayName || shortId(cleanUid),
    role: clean(adminUser.role || user.adminRole || profile.role || user.accountType || '', 80)
  }
}

async function targetSummary(log = {}) {
  const targetType = clean(log.targetType, 80).toLowerCase()
  const targetId = clean(log.targetId, 180)
  if (!targetId) return null
  if (targetType === 'product') {
    const snap = await db().collection('products').doc(targetId).get().catch(() => null)
    const product = snap?.exists ? snap.data() || {} : {}
    return { label: clean(product.title || product.slug || shortId(targetId), 180), secondary: clean(product.slug || targetId, 180) }
  }
  if (targetType === 'user' || targetType === 'profile' || targetType === 'admin_user' || targetType === 'adminuser') {
    const summary = await userSummary(targetId)
    return summary ? { label: summary.label, secondary: summary.role || shortId(targetId) } : { label: shortId(targetId), secondary: '' }
  }
  if (targetType === 'order') {
    const snap = await db().collection('orders').doc(targetId).get().catch(() => null)
    const order = snap?.exists ? snap.data() || {} : {}
    const buyer = clean(order.buyerUid || order.uid || '', 180)
    return { label: `Order ${shortId(targetId)}`, secondary: buyer ? `Buyer ${shortId(buyer)}` : '' }
  }
  if (targetType === 'report') return { label: `Report ${shortId(targetId)}`, secondary: '' }
  return { label: shortId(targetId), secondary: '' }
}

const listAdminLogs = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertPermission(request, 'auditRead')
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const snapshot = await safeListCollection('adminLogs', { orderBy: 'createdAt', direction: 'desc', limit })
  const logs = snapshot.docs.map(logSummary)
  const actorUids = Array.from(new Set(logs.map((log) => log.actorUid).filter(Boolean)))
  const actorEntries = await Promise.all(actorUids.map(async (uid) => [uid, await userSummary(uid)]))
  const actorMap = Object.fromEntries(actorEntries.filter(([, summary]) => Boolean(summary)))
  const targetEntries = await Promise.all(logs.map(async (log) => [log.id, await targetSummary(log)]))
  const targetMap = Object.fromEntries(targetEntries.filter(([, summary]) => Boolean(summary)))
  const hydratedLogs = logs.map((log) => ({
    ...log,
    actorSummary: actorMap[log.actorUid] || null,
    targetSummary: targetMap[log.id] || null
  }))
  return {
    ok: true,
    logs: hydratedLogs,
    total: hydratedLogs.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminLogs
}
