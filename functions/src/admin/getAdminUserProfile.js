const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { adminUserSummary, db, productSummary, profileSummary } = require('./adminListShared')

const getAdminUserProfile = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userRead', 'roleManage', 'productReview'])
  const uid = cleanString(request.data?.uid || '', 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid uid is required.')

  const [profileSnap, userSnap, adminSnap, productsSnap] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get(),
    db().collection('adminUsers').doc(uid).get(),
    db().collection('products').where('artistId', '==', uid).limit(25).get()
  ])

  const source = profileSnap.exists ? profileSnap : userSnap
  const account = userSnap.exists ? userSnap.data() || {} : {}
  return {
    ok: true,
    user: source.exists ? profileSummary(source, adminSnap.exists ? adminUserSummary(adminSnap) : null, account) : null,
    adminUser: adminSnap.exists ? adminUserSummary(adminSnap) : null,
    recentProducts: productsSnap.docs.map(productSummary),
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminUserProfile
}
