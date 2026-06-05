const { onCall } = require('firebase-functions/v2/https')
const { assertAdmin, cleanString } = require('./adminAuth')
const { db, normalizeLimit, serializeDate } = require('./adminListShared')

const ACTIVE_WINDOW_MS = 90 * 1000

function asMillis(value) {
  if (!value) return 0
  if (value.toMillis) return value.toMillis()
  if (value.toDate) return value.toDate().getTime()
  return new Date(value).getTime() || 0
}

function cleanList(value = []) {
  return Array.isArray(value) ? value.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 20) : []
}

async function loadSessionSummary(uid = '') {
  if (!uid) return null
  const snapshot = await db()
    .collection('presence')
    .doc(uid)
    .collection('sessions')
    .orderBy('activeUntil', 'desc')
    .limit(5)
    .get()
    .catch(() => ({ docs: [] }))
  const now = Date.now()
  const sessions = snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }))
  const active = sessions.find((session) => {
    const activeUntilMs = asMillis(session.activeUntil)
    const lastSeenMs = asMillis(session.lastSeenAt)
    return session.hidden !== true && (activeUntilMs > now || lastSeenMs > now - ACTIVE_WINDOW_MS)
  })
  return active || sessions[0] || null
}

async function presenceSummary(docSnap) {
  const parent = docSnap.data() || {}
  const session = await loadSessionSummary(cleanString(parent.uid || docSnap.id, 180))
  const raw = session || parent
  const activeUntilMs = asMillis(raw.activeUntil)
  const lastSeenMs = asMillis(raw.lastSeenAt)
  const now = Date.now()
  return {
    uid: cleanString(raw.uid || docSnap.id, 180),
    displayName: cleanString(raw.displayName || 'User', 180),
    username: cleanString(raw.username || '', 120),
    photoURL: cleanString(raw.photoURL || raw.avatarURL || '', 900),
    avatarURL: cleanString(raw.avatarURL || raw.photoURL || '', 900),
    roles: cleanList(raw.roles),
    badges: cleanList(raw.badges),
    adminRole: cleanString(raw.adminRole || '', 80),
    isAdmin: raw.isAdmin === true,
    isModerator: raw.isModerator === true,
    staffVisible: raw.staffVisible === true,
    active: (activeUntilMs > now || lastSeenMs > now - ACTIVE_WINDOW_MS) && raw.hidden !== true,
    activeUntil: serializeDate(raw.activeUntil),
    lastSeenAt: serializeDate(raw.lastSeenAt),
    path: cleanString(raw.path || '', 240),
    pageTitle: cleanString(raw.pageTitle || '', 180)
  }
}

const listActiveStaffPresence = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAdmin(request)
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 30, 50)
  const snapshot = await db().collection('presence').orderBy('updatedAt', 'desc').limit(100).get()
  const rows = await Promise.all(snapshot.docs.map(presenceSummary))
  const staff = rows
    .filter((row) => row.staffVisible && row.active)
    .slice(0, limit)
  return {
    ok: true,
    staff,
    total: staff.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listActiveStaffPresence
}
