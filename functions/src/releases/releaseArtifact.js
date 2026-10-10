// Trusted Storage adapter. Never accept a bucket/path/generation from download callers.
const { createHash } = require('node:crypto')
const { HttpsError } = require('firebase-functions/v2/https')
const MAX_ARTIFACT_BYTES = 1024 * 1024 * 1024
const DOWNLOAD_TTL_MS = 10 * 60000
const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v)
const artifactPath = r => `software-releases/origami/${r.releaseId}/macos/${r.architecture}/${r.artifact.artifactId}.pkg`
function validArtifact(r) {
  const a = r?.artifact
  return a && Object.keys(a).length === 6 && Object.keys(a).every(k => ['artifactId', 'kind', 'storagePath', 'objectGeneration', 'sizeBytes', 'sha256'].includes(k))
    && idOK(r.releaseId) && ['arm64', 'x86_64', 'universal'].includes(r.architecture) && idOK(a.artifactId) && a.kind === 'pkg'
    && a.storagePath === artifactPath(r) && typeof a.objectGeneration === 'string' && /^[1-9][0-9]{0,15}$/.test(a.objectGeneration) && Number.isSafeInteger(Number(a.objectGeneration))
    && Number.isSafeInteger(a.sizeBytes) && a.sizeBytes > 0 && a.sizeBytes <= MAX_ARTIFACT_BYTES
    && typeof a.sha256 === 'string' && /^[0-9a-f]{64}$/.test(a.sha256)
}
const unavailable = () => new HttpsError('failed-precondition', 'Release artifact unavailable.')
function storageArtifacts(bucket) {
  const exactFile = r => bucket.file(artifactPath(r), { generation: r.artifact.objectGeneration })
  async function inspect(r, hash = false) {
    if (!validArtifact(r)) throw unavailable()
    try {
      const file = exactFile(r)
      const [m] = await file.getMetadata()
      // Reject transparent decompression: the hash and signed GET must describe identical bytes.
      if (String(m.generation) !== r.artifact.objectGeneration || Number(m.size) !== r.artifact.sizeBytes || m.contentEncoding) throw unavailable()
      if (hash && await hashObject(file, r.artifact.sizeBytes) !== r.artifact.sha256) throw unavailable()
      return { objectGeneration: String(m.generation), sizeBytes: Number(m.size) }
    } catch { throw unavailable() } // SDK errors may contain request URLs; never propagate them.
  }
  async function hashObject(file, size) {
    const digest = createHash('sha256'); let count = 0
    const stream = file.createReadStream({ decompress: false, validation: 'crc32c' })
    const timer = setTimeout(() => stream.destroy(new Error('deadline')), 120000)
    try {
      for await (const chunk of stream) {
        count += chunk.length
        if (count > size) { stream.destroy(); throw unavailable() }
        digest.update(chunk)
      }
      if (count !== size) throw unavailable()
      return digest.digest('hex')
    } finally { clearTimeout(timer); stream.destroy() }
  }
  return {
    inspect,
    // Trusted publisher tooling: derive generation/size/hash from the uploaded object.
    // No endpoint exposes this capability. writeRelease re-verifies it before publication.
    async prepare(release, artifactId) {
      if (!idOK(release?.releaseId) || !idOK(artifactId) || !['arm64', 'x86_64', 'universal'].includes(release?.architecture)) throw unavailable()
      try {
        const r = { ...release, artifact: { artifactId } }
        const [metadata] = await bucket.file(artifactPath(r)).getMetadata()
        r.artifact = { artifactId, kind: 'pkg', storagePath: artifactPath(r), objectGeneration: String(metadata.generation), sizeBytes: Number(metadata.size), sha256: '0'.repeat(64) }
        if (!validArtifact(r) || metadata.contentEncoding) throw unavailable()
        await inspect(r)
        r.artifact.sha256 = await hashObject(exactFile(r), r.artifact.sizeBytes)
        return r.artifact
      } catch { throw unavailable() }
    },
    async sign(r, expiresAt) {
      try {
        // File.getSignedUrl adds this File's exact generation to the signed query.
        const [url] = await exactFile(r).getSignedUrl({ version: 'v4', action: 'read', expires: expiresAt })
        const u = new URL(url)
        if (url.length > 8192 || u.protocol !== 'https:' || u.hostname !== 'storage.googleapis.com' || u.username || u.password || u.hash || u.searchParams.get('generation') !== r.artifact.objectGeneration) throw unavailable()
        return url
      } catch { throw unavailable() }
    }
  }
}
module.exports = { MAX_ARTIFACT_BYTES, DOWNLOAD_TTL_MS, idOK, artifactPath, validArtifact, storageArtifacts }
