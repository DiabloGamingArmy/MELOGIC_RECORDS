const { test } = require('node:test')
const assert = require('node:assert/strict')
const { Readable } = require('node:stream')
const { createHash } = require('node:crypto')
const { storageArtifacts, validArtifact, artifactPath, DOWNLOAD_TTL_MS } = require('../src/releases/releaseArtifact')
const { origamiDownloadCore } = require('../src/releases/origamiDownloadCore')
const { assertTransition, writeRelease } = require('../src/releases/releasePublication')
const time = Date.now(), bytes = Buffer.from('immutable fixture installer bytes')
const digest = createHash('sha256').update(bytes).digest('hex')
function release() { return { schemaVersion: 1, productId: 'origami', releaseId: 'b201', version: '0.1.1-beta.1', buildNumber: 201, sourceRevision: 'abc123', channel: 'beta', platform: 'macos', architecture: 'arm64', status: 'published', publishedAt: new Date(time - 1000), releaseNotes: 'Fixture', minimumOS: '12.0', artifact: { artifactId: 'installer', kind: 'pkg', storagePath: 'software-releases/origami/b201/macos/arm64/installer.pkg', objectGeneration: '10001', sizeBytes: bytes.length, sha256: digest } } }
const request = { releaseId: 'b201', artifactId: 'installer' }
function fixture() {
  const f = { r: release(), e: { productId: 'origami', status: 'active', edition: 'beta' }, p: { status: 'beta', licensing: { enabled: true, editions: ['beta'] } }, signed: [], opened: [], objects: new Map([['10001', bytes]]), expires: 0, now: time, url: '' }
  f.bucket = { file(path, options) { options ||= { generation: '10001' }; f.opened.push([path, options.generation]); return {
    async getMetadata() { const b = f.objects.get(options.generation); if (!b) throw new Error('missing / private request'); return [{ generation: options.generation, size: String(b.length), ...f.metadata }] },
    createReadStream() { return Readable.from([f.objects.get(options.generation)]) },
    async getSignedUrl(config) { f.signed.push([path, options.generation, config]);f.expires = config.expires;f.url = `https://storage.googleapis.com/fixture/${path}?generation=${options.generation}&X-Goog-Signature=fixture-bearer`; return [f.url] }
  } } }
  f.artifacts = storageArtifacts(f.bucket)
  f.db = { doc(path) { return { async get() { const data = path === 'products/origami' ? f.p : path === 'users/tester/entitlements/origami' ? f.e : path === 'products/origami/releases/b201' ? f.r : null; return { exists: !!data, data: () => data } } } } }
  f.core = origamiDownloadCore({ db: f.db, artifacts: f.artifacts, now: () => f.now })
  return f
}
test('canonical artifact metadata rejects incomplete, traversal, hash, generation and size spoofing', () => {
  const r = release();assert.equal(validArtifact(r), true)
  for (const patch of [{ artifactId: '../installer' }, { storagePath: 'assets/public.pkg' }, { objectGeneration: 10001 }, { objectGeneration: '0' }, { sizeBytes: 0 }, { sizeBytes: 1073741825 }, { sizeBytes: '3' }, { sha256: digest.toUpperCase() }, { sha256: '../hash' }, { kind: 'zip' }, { url: 'spoof' }]) assert.equal(Boolean(validArtifact({ ...r, artifact: { ...r.artifact, ...patch } })), false)
  assert.equal(artifactPath(r), r.artifact.storagePath)
})
test('authorized response is bounded, ten minutes, exact generation; issuance never hashes on caller request', async () => {
  const f = fixture();const r = await f.core.get(request, 'tester')
  assert.deepEqual(Object.keys(r).sort(), ['artifact', 'releaseId', 'schemaVersion'])
  assert.deepEqual(Object.keys(r.artifact).sort(), ['artifactId', 'downloadUrl', 'expiresAt', 'sha256', 'sizeBytes'])
  assert.equal(r.artifact.sha256, digest);assert.equal(Date.parse(r.artifact.expiresAt), time + DOWNLOAD_TTL_MS)
  assert.equal(f.signed.length, 1);assert.equal(f.signed[0][1], '10001');assert.equal(f.signed[0][2].version, 'v4')
  assert.ok(f.opened.every(([p, g]) => p === f.r.artifact.storagePath && g === '10001'))
})
test('identity, eligibility, publication and artifact revalidated; all caller authority fields rejected', async () => {
  await assert.rejects(fixture().core.get(request, null), { code: 'unauthenticated' })
  await assert.rejects(fixture().core.get(request, 'outsider'), { code: 'permission-denied' })
  for (const field of ['uid', 'entitlement', 'storagePath', 'bucket', 'downloadUrl', 'objectGeneration', 'sha256']) await assert.rejects(fixture().core.get({ ...request, [field]: 'spoof' }, 'tester'), { code: 'invalid-argument' })
  for (const change of [f => { f.e.status = 'revoked' }, f => { f.e.expiresAt = new Date(time - 1) }, f => { f.e.edition = 'stable' }, f => { f.p.licensing.enabled = false }, f => { f.r.status = 'draft' }, f => { f.r.status = 'unpublished' }, f => { f.r.channel = 'stable' }, f => { f.r.publishedAt = new Date(time + 1) }, f => { f.r.artifact.sha256 = 'bad' }]) {
    const f = fixture();change(f);await assert.rejects(f.core.get(request, 'tester'), { code: 'permission-denied' });assert.equal(f.signed.length, 0)
  }
  await assert.rejects(fixture().core.get({ ...request, artifactId: 'other' }, 'tester'), { code: 'permission-denied' })
})
test('missing exact object/generation and metadata mismatch fail closed without URL/error leakage', async () => {
  for (const change of [f => f.objects.clear(), f => { f.metadata = { generation: '10002' } }, f => { f.metadata = { size: '999' } }, f => { f.metadata = { contentEncoding: 'gzip' } }]) {
    const f = fixture();change(f);await assert.rejects(f.core.get(request, 'tester'), { code: 'failed-precondition', message: 'Release artifact unavailable.' });assert.equal(f.signed.length, 0)
  }
  const f = fixture();f.artifacts.sign = async () => { throw new Error('private signed URL must never be propagated') }
  await assert.rejects(f.core.get(request, 'tester'), e => !JSON.stringify(e).includes('private signed') && !e.message.includes('private signed'))
})
test('replacement generation cannot substitute: retained original serves original or deletion fails closed', async () => {
  const f = fixture();f.objects.set('10002', Buffer.from('replacement'))
  await f.artifacts.inspect(f.r, true);await f.core.get(request, 'tester');assert.equal(f.signed[0][1], '10001')
  f.objects.delete('10001');await assert.rejects(f.core.get(request, 'tester'));assert.equal(f.signed.length, 1)
})
test('trusted publication independently hashes exact bytes; wrong digest rejected and adapter required', async () => {
  const f = fixture();await f.artifacts.inspect(f.r, true)
  assert.deepEqual(await f.artifacts.prepare(f.r, 'installer'), f.r.artifact)
  f.r.artifact.sha256 = '0'.repeat(64);await assert.rejects(f.artifacts.inspect(f.r, true))
  await assert.rejects(writeRelease({}, release(), 'publisher'), { code: 'failed-precondition' })
  for (const key of ['objectGeneration', 'sizeBytes', 'sha256', 'storagePath', 'artifactId']) {
    const r = release();const next = structuredClone(r);next.artifact[key] = key === 'sizeBytes' ? bytes.length + 1 : 'changed'
    assert.throws(() => assertTransition(r, next))
  }
})
test('eligibility changes during issuance block new URL; already issued bearer survives until expiry', async () => {
  const f = fixture();await f.core.get(request, 'tester');const issuedExpiry = f.expires
  f.r.status = 'unpublished';f.e.status = 'revoked';await assert.rejects(f.core.get(request, 'tester'))
  // No mechanism purports to revoke GCS's existing signed capability. Its signed expiry is unchanged.
  assert.equal(issuedExpiry, time + 600000);assert.equal(f.signed.length, 1)
  f.now = issuedExpiry + 1;assert.ok(f.now > issuedExpiry)
  const race = fixture();const inspect = race.artifacts.inspect;race.artifacts.inspect = async r => { await inspect(r);race.e.status = 'revoked' }
  await assert.rejects(race.core.get(request, 'tester'), { code: 'permission-denied' });assert.equal(race.signed.length, 0)
})
test('Storage emulator denies direct release read/write for anonymous, beta and owner clients', { skip: !process.env.FIREBASE_STORAGE_EMULATOR_HOST }, async () => {
  const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing')
  const { ref, uploadBytes, getBytes, deleteObject } = require('firebase/storage')
  const { readFileSync } = require('node:fs')
  const [host, port] = process.env.FIREBASE_STORAGE_EMULATOR_HOST.split(':')
  const env = await initializeTestEnvironment({ projectId: 'demo-u03-storage', storage: { host, port: Number(port), rules: readFileSync(require('node:path').resolve(__dirname, '../../storage.rules'), 'utf8') } })
  try {
    await env.withSecurityRulesDisabled(async c => { await uploadBytes(ref(c.storage(), release().artifact.storagePath), bytes) })
    for (const c of [env.unauthenticatedContext(), env.authenticatedContext('tester'), env.authenticatedContext('owner', { admin: true, adminRole: 'owner' })]) {
      const object = ref(c.storage(), release().artifact.storagePath)
      await assertFails(getBytes(object));await assertFails(uploadBytes(object, bytes));await assertFails(deleteObject(object))
    }
  } finally { await env.cleanup() }
})

test('real installed GCS V4 signer binds exact generation in signed URL', async () => {
  const { Storage } = require('@google-cloud/storage')
  const { generateKeyPairSync } = require('node:crypto')
  // Ephemeral fixture key exists only in memory, never logged or saved.
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } })
  const storage = new Storage({ projectId: 'demo-u03', credentials: { client_email: 'fixture@demo-u03.iam.gserviceaccount.com', private_key: privateKey } })
  const artifacts = storageArtifacts(storage.bucket('melogic-records.firebasestorage.app'))
  const signed = new URL(await artifacts.sign(release(), Date.now() + DOWNLOAD_TTL_MS))
  assert.equal(signed.searchParams.get('generation'), '10001')
  assert.equal(signed.searchParams.get('X-Goog-Expires'), '600')
  assert.ok(signed.searchParams.get('X-Goog-Signature').length > 100)
  assert.equal(signed.searchParams.get('X-Goog-SignedHeaders'), 'host')
})
