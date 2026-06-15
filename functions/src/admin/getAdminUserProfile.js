const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { adminUserSummary, db, productSummary, profileSummary, safeSummaryValue, serializeDate } = require('./adminListShared')
const { loadUserCommerceAudit } = require('./userCommerceAudit')
const { loadUserPayoutAudit } = require('./userPayoutAudit')

function accountEventSummary(docSnap) {
  const raw = docSnap.data() || {}
  return {
    id: docSnap.id,
    eventId: raw.eventId || docSnap.id,
    type: cleanString(raw.type || 'security_notice', 80),
    severity: cleanString(raw.severity || 'info', 40),
    title: cleanString(raw.title || 'Account update', 160),
    summary: cleanString(raw.summary || raw.message || '', 1000),
    message: cleanString(raw.message || '', 1000),
    actorUid: cleanString(raw.actorUid || '', 180),
    actorUsername: cleanString(raw.actorUsername || '', 180),
    actorType: cleanString(raw.actorType || '', 80),
    source: cleanString(raw.source || '', 120),
    path: cleanString(raw.path || '', 900),
    emailSent: raw.emailSent === true,
    emailSentAt: cleanString(raw.emailSentAt || '', 80),
    emailSkipped: raw.emailSkipped === true,
    emailSkipReason: cleanString(raw.emailSkipReason || '', 240),
    emailError: cleanString(raw.emailError || '', 240),
    metadata: safeSummaryValue(raw.metadataSafe || raw.metadata || {}),
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

  const [profileSnap, userSnap, adminSnap, productsSnap, eventsSnap, notesSnap, recoverySnap, authUser, commerce, payouts] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get(),
    db().collection('adminUsers').doc(uid).get(),
    db().collection('products').where('artistId', '==', uid).limit(25).get(),
    db().collection('users').doc(uid).collection('accountEvents').orderBy('createdAt', 'desc').limit(12).get(),
    db().collection('users').doc(uid).collection('adminNotes').orderBy('createdAt', 'desc').limit(25).get().catch(() => ({ docs: [] })),
    db().collection('users').doc(uid).collection('security').doc('recoveryCodes').get().catch(() => ({ exists: false, data: () => ({}) })),
    admin.auth().getUser(uid).catch(() => null),
    loadUserCommerceAudit(uid),
    loadUserPayoutAudit(uid)
  ])

  const source = profileSnap.exists ? profileSnap : userSnap
  const account = userSnap.exists ? userSnap.data() || {} : {}
  const authFactors = Array.isArray(authUser?.multiFactor?.enrolledFactors) ? authUser.multiFactor.enrolledFactors : []
  const recovery = recoverySnap.exists ? recoverySnap.data() || {} : {}
  const recoveryHashes = Array.isArray(recovery.codeHashes) ? recovery.codeHashes : []
  const baseUser = source.exists ? profileSummary(source, adminSnap.exists ? adminUserSummary(adminSnap) : null, account) : null
  return {
    ok: true,
    user: baseUser
      ? {
          ...baseUser,
          emailVerified: authUser?.emailVerified === true,
          authDisabled: authUser?.disabled === true,
          mfaEnabled: authFactors.length > 0,
          mfaFactorCount: authFactors.length,
          recoveryCodesGenerated: recovery.enabled === true && recoveryHashes.length > 0,
          recoveryCodesRemaining: recoveryHashes.filter((item) => item?.used !== true).length,
          recoveryCodesGeneratedAt: serializeDate(recovery.generatedAt),
          mfaFactors: authFactors.map((factor) => ({
            uid: cleanString(factor.uid || '', 180),
            factorId: cleanString(factor.factorId || '', 80),
            displayName: cleanString(factor.displayName || '', 160),
            enrollmentTime: cleanString(factor.enrollmentTime || '', 80)
          })),
          authProviderIds: (authUser?.providerData || []).map((provider) => cleanString(provider.providerId || '', 80)).filter(Boolean).slice(0, 12),
          authCreatedAt: cleanString(authUser?.metadata?.creationTime || '', 80),
          authLastSignInAt: cleanString(authUser?.metadata?.lastSignInTime || '', 80),
          recentAccountEventCount: eventsSnap.docs.length,
          lastSecurityEventAt: eventsSnap.docs[0] ? serializeDate(eventsSnap.docs[0].data()?.createdAt) : ''
        }
      : null,
    adminUser: adminSnap.exists ? adminUserSummary(adminSnap) : null,
    recentProducts: productsSnap.docs.map(productSummary),
    libraryItems: commerce.libraryItems,
    orders: commerce.orders,
    commerceSummary: commerce.commerceSummary,
    payoutConnect: payouts.connect,
    earningsSummary: payouts.earningsSummary,
    creatorLedgerEntries: payouts.ledgerEntries,
    accountEvents: eventsSnap.docs.map(accountEventSummary),
    adminNotes: notesSnap.docs.map(adminNoteSummary),
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminUserProfile
}
