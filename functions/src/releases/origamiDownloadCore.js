const { HttpsError } = require('firebase-functions/v2/https')
const { validRelease } = require('./origamiReleasesCore')
const { validArtifact, idOK, DOWNLOAD_TTL_MS } = require('./releaseArtifact')
const { isActive, validateProduct } = require('../licensing/entitlements')
function origamiDownloadCore({ db, artifacts, now = Date.now }) {
  return { async get(data, uid) {
    if (!data || Object.keys(data).length !== 2 || Object.keys(data).some(k => !['releaseId', 'artifactId'].includes(k)) || !idOK(data.releaseId) || !idOK(data.artifactId)) throw new HttpsError('invalid-argument', 'Invalid release request.')
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to download private releases.')
    const eligible = async () => {
      const [p, e, d] = await Promise.all([db.doc('products/origami').get(), db.doc(`users/${uid}/entitlements/origami`).get(), db.doc(`products/origami/releases/${data.releaseId}`).get()])
      const r = d.data(), access = e.data()
      let allowed = false
      try { allowed = p.exists && isActive(access, now()) && access.productId === 'origami' && access.edition === 'beta'; validateProduct(p.data(), 'beta') } catch { allowed = false }
      const published = typeof r?.publishedAt?.toMillis === 'function' ? r.publishedAt.toMillis() : r?.publishedAt instanceof Date ? r.publishedAt.getTime() : NaN
      if (!allowed || !validRelease(r, data.releaseId) || !validArtifact(r) || r.status !== 'published' || r.channel !== 'beta' || published > now() || r.artifact.artifactId !== data.artifactId) throw new HttpsError('permission-denied', 'Release download unavailable.')
      return r
    }
    const release = await eligible()
    try {
      await artifacts.inspect(release)
      // Recheck after Storage IO; an earlier availability check never authorizes download.
      const current = await eligible()
      if (JSON.stringify(current.artifact) !== JSON.stringify(release.artifact)) throw new Error('changed')
      const expires = now() + DOWNLOAD_TTL_MS
      const downloadUrl = await artifacts.sign(release, expires)
      return { schemaVersion: 1, releaseId: release.releaseId, artifact: { artifactId: release.artifact.artifactId, sizeBytes: release.artifact.sizeBytes, sha256: release.artifact.sha256, downloadUrl, expiresAt: new Date(expires).toISOString() } }
    } catch (e) {
      if (e instanceof HttpsError && e.code === 'permission-denied') throw e
      throw new HttpsError('failed-precondition', 'Release artifact unavailable.')
    }
  } }
}
module.exports = { origamiDownloadCore }
