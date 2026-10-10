const { onCall } = require('firebase-functions/v2/https')
const { getAuth } = require('firebase-admin/auth')
const { getFirestore } = require('firebase-admin/firestore')
const { origamiReleasesCore, verifiedReleaseIdentity } = require('./origamiReleasesCore')
exports.checkOrigamiUpdate = onCall({ region: 'us-central1', maxInstances: 10, timeoutSeconds: 15 }, async r => {
  const uid = await verifiedReleaseIdentity(r, getAuth())
  return origamiReleasesCore({ db: getFirestore() }).check(r.data, uid)
})
