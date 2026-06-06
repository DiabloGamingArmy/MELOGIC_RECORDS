const { onCall } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { adminUserSummary, db, normalizeLimit, paginationFromSnapshot, profileSummary, safeListCollection } = require('./adminListShared')

async function loadAdminUsersByUid() {
  const snapshot = await db().collection('adminUsers').limit(200).get()
  return new Map(snapshot.docs.map((docSnap) => [docSnap.id, adminUserSummary(docSnap)]))
}

function userMatchesSearch(user = {}, search = '') {
  if (!search) return true
  const haystack = [
    user.uid,
    user.displayName,
    user.username,
    user.email,
    user.role,
    user.adminRole
  ].join(' ').toLowerCase()
  return haystack.includes(search)
}

const listAdminUsers = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userRead', 'roleManage'])
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const search = cleanString(request.data?.search || '', 180).toLowerCase()
  const uid = cleanString(request.data?.uid || '', 180)
  const cursor = cleanString(request.data?.cursor || '', 180)
  const adminUsers = await loadAdminUsersByUid()

  if (uid && !uid.includes('/')) {
    const [profileSnap, userSnap] = await Promise.all([
      db().collection('profiles').doc(uid).get(),
      db().collection('users').doc(uid).get()
    ])
    const source = profileSnap.exists ? profileSnap : userSnap
    const users = source.exists ? [profileSummary(source, adminUsers.get(uid), userSnap.exists ? userSnap.data() || {} : {})] : []
    return { ok: true, users, total: users.length, requester: { uid: claims.uid, role: claims.adminRole } }
  }

  const snapshot = await safeListCollection('profiles', { orderBy: 'updatedAt', direction: 'desc', limit, cursor })
  const accountSnaps = await Promise.all(snapshot.docs.map((docSnap) => db().collection('users').doc(docSnap.id).get()))
  const accounts = new Map(accountSnaps.map((snap) => [snap.id, snap.exists ? snap.data() || {} : {}]))
  const users = snapshot.docs
    .map((docSnap) => profileSummary(docSnap, adminUsers.get(docSnap.id), accounts.get(docSnap.id) || {}))
    .filter((user) => userMatchesSearch(user, search))
    .slice(0, limit)
  const pagination = paginationFromSnapshot(snapshot, limit)

  return {
    ok: true,
    users,
    nextCursor: pagination.nextCursor,
    hasMore: pagination.hasMore,
    total: users.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminUsers
}
