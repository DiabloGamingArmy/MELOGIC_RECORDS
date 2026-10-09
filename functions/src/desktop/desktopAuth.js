const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')
const { getAuth } = require('firebase-admin/auth')
const { desktopAuthCore } = require('./desktopAuthCore')

const core = desktopAuthCore({ db: getFirestore(), auth: getAuth() })
// Native clients have no reCAPTCHA App Check token. Authenticated browser
// approval plus possession of a one-time S256 proof protect token issuance.
const options = { region: 'us-central1', maxInstances: 10, timeoutSeconds: 15 }
exports.beginDesktopLogin = onCall(options, r => core.begin(r.data, r.rawRequest.ip))
exports.approveDesktopLogin = onCall(options, async r => {
  const bearer = String(r.rawRequest.headers.authorization || '').match(/^Bearer (.+)$/)
  if (!r.auth || !bearer) throw new HttpsError('unauthenticated', 'Sign in to Melogic first.')
  try {
    const verified = await getAuth().verifyIdToken(bearer[1], true)
    if (verified.uid !== r.auth.uid) throw new Error('identity mismatch')
  } catch {
    throw new HttpsError('unauthenticated', 'Your session is unavailable. Sign in again.')
  }
  return core.approve(r.data, r.auth.uid)
})
exports.pollDesktopLogin = onCall(options, r => core.poll(r.data, r.rawRequest.ip))
