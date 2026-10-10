// Trusted release automation only. No callable/export in functions/index.js.
// The caller must possess publisher IAM. Ordinary clients cannot use Admin SDK.
const { validRelease } = require('./origamiReleasesCore')
const { HttpsError } = require('firebase-functions/v2/https')
const millis = v => typeof v?.toMillis === 'function' ? v.toMillis() : (v instanceof Date ? v.getTime() : NaN)
const same = (a, b) => Number.isFinite(millis(a)) || Number.isFinite(millis(b)) ? millis(a) === millis(b) : JSON.stringify(a) === JSON.stringify(b)
function assertTransition(previous, next, highWater = 0, previousVersion = '0.0.0') {
  if (!validRelease(next, next?.releaseId)) throw new HttpsError('invalid-argument', 'Invalid release record.')
  if (previous && ['published', 'unpublished'].includes(previous.status)) {
    for (const key of Object.keys(previous)) if (key !== 'status' && !same(previous[key], next[key])) throw new HttpsError('failed-precondition', 'Published release metadata is immutable.')
    for (const key of Object.keys(next)) if (key !== 'status' && !same(previous[key], next[key])) throw new HttpsError('failed-precondition', 'Published release metadata is immutable.')
    if (next.status === 'draft') throw new HttpsError('failed-precondition', 'Published releases cannot become drafts.')
    return
  }
  if (next.status === 'unpublished') throw new HttpsError('failed-precondition', 'Only a published release can be unpublished.')
  if (next.status === 'published') {
    if (next.buildNumber <= highWater) throw new HttpsError('failed-precondition', 'Release build number must increase.')
    const core = v => v.split(/[+-]/)[0].split('.').map(BigInt)
    const a = core(next.version), b = core(previousVersion)
    for (let i = 0; i < 3; i++) { if (a[i] > b[i]) break; if (a[i] < b[i]) throw new HttpsError('failed-precondition', 'Version contradicts the published build sequence.') }
  }
}
async function writeRelease(db, next, actorUid, artifacts) {
  if (!validRelease(next, next?.releaseId) || (next.status === 'published' && (next.publishedAt.toMillis?.() ?? next.publishedAt.getTime()) > Date.now())) throw new HttpsError('invalid-argument', 'Invalid release record.')
  if (next.status === 'published') {
    if (!artifacts) throw new HttpsError('failed-precondition', 'Trusted Storage verification required.')
    await artifacts.inspect(next, true)
  }
  const product = db.doc('products/origami'), release = product.collection('releases').doc(next.releaseId)
  return db.runTransaction(async tx => {
    const [p, r] = await Promise.all([tx.get(product), tx.get(release)])
    if (!p.exists) throw new HttpsError('failed-precondition', 'Configure Origami first.')
    assertTransition(r.data(), next, p.data().releaseBuildNumber || 0, p.data().releaseVersion || '0.0.0')
    if (next.status === 'published' && r.data()?.status !== 'published') {
      const window = await tx.get(db.collection('products/origami/releases').where('channel', '==', next.channel).where('status', '==', 'published').limit(100))
      if (window.size >= 100) throw new HttpsError('resource-exhausted', 'Unpublish an older release before publishing another.')
    }
    tx.set(release, next)
    if (next.status === 'published' && !['published', 'unpublished'].includes(r.data()?.status)) tx.update(product, { releaseBuildNumber: next.buildNumber, releaseVersion: next.version })
    tx.create(db.collection('adminLogs').doc(), { action: 'origami_release_written', actorUid, releaseId: next.releaseId, status: next.status, buildNumber: next.buildNumber, createdAt: new Date() })
  })
}
module.exports = { assertTransition, writeRelease }
