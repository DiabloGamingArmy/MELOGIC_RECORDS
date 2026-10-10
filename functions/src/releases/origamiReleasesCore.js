const { HttpsError } = require('firebase-functions/v2/https')
const { isActive, validateProduct } = require('../licensing/entitlements')
const semver = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const versionOK = v => typeof v === 'string' && v.length <= 96 && semver.test(v)
const buildOK = v => Number.isSafeInteger(v) && v > 0 && v <= 2147483647
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)
const millis = v => typeof v?.toMillis === 'function' ? v.toMillis() : (v instanceof Date ? v.getTime() : NaN)
function validRelease(r, id) {
  return r && Object.keys(r).every(k => ['schemaVersion', 'productId', 'releaseId', 'version', 'buildNumber', 'sourceRevision', 'channel', 'platform', 'architecture', 'status', 'publishedAt', 'releaseNotes', 'minimumOS'].includes(k)) && r.schemaVersion === 1 && r.productId === 'origami' && r.releaseId === id && idOK(id)
    && versionOK(r.version) && buildOK(r.buildNumber)
    && typeof r.sourceRevision === 'string' && /^[a-zA-Z0-9._-]{1,96}$/.test(r.sourceRevision)
    && ['internal', 'beta', 'stable'].includes(r.channel) && r.platform === 'macos'
    && ['arm64', 'x86_64', 'universal'].includes(r.architecture)
    && ['draft', 'published', 'unpublished'].includes(r.status)
    && Number.isFinite(millis(r.publishedAt)) && millis(r.publishedAt) > 0
    && typeof r.releaseNotes === 'string' && Buffer.byteLength(r.releaseNotes, 'utf8') <= 8192
    && typeof r.minimumOS === 'string' && /^(0|[1-9][0-9]{0,2})\.(0|[1-9][0-9]{0,2})(?:\.(0|[1-9][0-9]{0,2}))?$/.test(r.minimumOS)
}
function validateInput(d) {
  if (!d || Object.keys(d).some(k => !['installedVersion', 'installedBuildNumber', 'installedChannel', 'platform', 'architecture'].includes(k))
    || !versionOK(d.installedVersion) || !buildOK(d.installedBuildNumber)
    || !['internal', 'beta', 'stable'].includes(d.installedChannel) || d.platform !== 'macos'
    || !['arm64', 'x86_64'].includes(d.architecture)) throw new HttpsError('invalid-argument', 'Invalid installation identity.')
}
function origamiReleasesCore({ db, now = Date.now }) {
  return { async check(data, uid) {
    validateInput(data)
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to check private releases.')
    const time = now()
    const answer = status => ({ schemaVersion: 1, status, checkedAt: new Date(time).toISOString(), expiresAt: new Date(time + 6 * 3600000).toISOString() })
    // Internal and stable ownership policies are deliberately not enabled in U02.
    if (data.installedChannel !== 'beta') return answer('no_eligible_release')
    const [access, product] = await Promise.all([db.doc(`users/${uid}/entitlements/origami`).get(), db.doc('products/origami').get()])
    const e = access.data()
    let active = false
    try { active = isActive(e, time) } catch {}
    if (!active || e.productId !== 'origami' || e.edition !== 'beta' || !product.exists) return answer('no_eligible_release')
    try { validateProduct(product.data(), 'beta') } catch { return answer('no_eligible_release') }
    // Bounded fail-closed catalog window. Publication tooling must keep this active window <= 100.
    const rows = await db.collection('products/origami/releases').where('channel', '==', 'beta').where('status', '==', 'published').limit(101).get()
    if (rows.docs.length > 100) throw new HttpsError('resource-exhausted', 'Release catalog unavailable.')
    const eligible = rows.docs.filter(d => validRelease(d.data(), d.id)).map(d => d.data()).filter(r => validRelease(r, r.releaseId) && r.channel === 'beta' && r.status === 'published' && r.platform === data.platform && [data.architecture, 'universal'].includes(r.architecture) && millis(r.publishedAt) <= time)
    eligible.sort((a, b) => b.buildNumber - a.buildNumber || a.releaseId.localeCompare(b.releaseId))
    if (!eligible.length) return answer('no_eligible_release')
    const r = eligible[0]
    if (r.buildNumber <= data.installedBuildNumber) return answer('up_to_date')
    return { ...answer('update_available'), release: { releaseId: r.releaseId, version: r.version, buildNumber: r.buildNumber, channel: r.channel, releaseNotes: r.releaseNotes, minimumOS: r.minimumOS } }
  } }
}
async function verifiedReleaseIdentity(r, auth) {
  const bearer = String(r.rawRequest?.headers?.authorization || '').match(/^Bearer (.+)$/)
  if (!r.auth || !bearer) throw new HttpsError('unauthenticated', 'Sign in to check private releases.')
  let identity
  try { identity = await auth.verifyIdToken(bearer[1], true) } catch { throw new HttpsError('unauthenticated', 'Account unavailable.') }
  if (identity.uid !== r.auth.uid) throw new HttpsError('unauthenticated', 'Account unavailable.')
  return identity.uid
}
module.exports = { verifiedReleaseIdentity, origamiReleasesCore, validRelease, validateInput, versionOK, buildOK }
