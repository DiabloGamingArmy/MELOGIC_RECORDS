const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { adminUserSummary, db, productSummary, profileSummary, safeSummaryValue, serializeDate } = require('./adminListShared')

function accountEventSummary(docSnap) {
  const raw = docSnap.data() || {}
  return {
    id: docSnap.id,
    eventId: raw.eventId || docSnap.id,
    type: cleanString(raw.type || 'security_notice', 80),
    severity: cleanString(raw.severity || 'info', 40),
    title: cleanString(raw.title || 'Account update', 160),
    message: cleanString(raw.message || '', 1000),
    actorUid: cleanString(raw.actorUid || '', 180),
    actorType: cleanString(raw.actorType || '', 80),
    source: cleanString(raw.source || '', 120),
    path: cleanString(raw.path || '', 900),
    metadata: safeSummaryValue(raw.metadata || {}),
    createdAt: serializeDate(raw.createdAt),
    readAt: serializeDate(raw.readAt)
  }
}

function adminNoteSummary(docSnap) {
  const raw = docSnap.data() || {}
  return {
    noteId: cleanString(raw.noteId || docSnap.id, 180),
    id: cleanString(raw.noteId || docSnap.id, 180),
    uid: cleanString(raw.uid || '', 180),
    note: cleanString(raw.note || '', 2400),
    severity: cleanString(raw.severity || 'info', 40),
    category: cleanString(raw.category || 'account', 80),
    createdBy: cleanString(raw.createdBy || '', 180),
    createdByEmail: cleanString(raw.createdByEmail || '', 320),
    visibility: cleanString(raw.visibility || 'admin_only', 80),
    createdAt: serializeDate(raw.createdAt)
  }
}

const getAdminUserProfile = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userRead', 'roleManage', 'productReview'])
  const uid = cleanString(request.data?.uid || '', 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')

  const [profileSnap, userSnap, adminSnap, productsSnap, eventsSnap, notesSnap] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get(),
    db().collection('adminUsers').doc(uid).get(),
    db().collection('products').where('artistId', '==', uid).limit(25).get(),
    db().collection('users').doc(uid).collection('accountEvents').orderBy('createdAt', 'desc').limit(12).get(),
    db().collection('users').doc(uid).collection('adminNotes').orderBy('createdAt', 'desc').limit(25).get().catch(() => ({ docs: [] }))
  ])

  const source = profileSnap.exists ? profileSnap : userSnap
  const account = userSnap.exists ? userSnap.data() || {} : {}
  return {
    ok: true,
    user: source.exists ? profileSummary(source, adminSnap.exists ? adminUserSummary(adminSnap) : null, account) : null,
    adminUser: adminSnap.exists ? adminUserSummary(adminSnap) : null,
    recentProducts: productsSnap.docs.map(productSummary),
    accountEvents: eventsSnap.docs.map(accountEventSummary),
    adminNotes: notesSnap.docs.map(adminNoteSummary),
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminUserProfile
}
