const { test } = require('node:test')
const assert = require('node:assert/strict')
const { origamiReleasesCore, validRelease, validateInput, versionOK } = require('../src/releases/origamiReleasesCore')
const time = Date.parse('2026-10-10T12:00:00Z')
const input = { installedVersion: '0.1.0-beta.1', installedBuildNumber: 100, installedChannel: 'beta', platform: 'macos', architecture: 'arm64' }
const release = (n = 101, patch = {}) => ({ schemaVersion: 1, productId: 'origami', releaseId: `b${n}`, version: '0.1.0-beta.2', buildNumber: n, sourceRevision: 'abc123', channel: 'beta', platform: 'macos', architecture: 'arm64', status: 'published', publishedAt: new Date(time - 1000), releaseNotes: 'Notes', minimumOS: '12.0', artifact: { artifactId: 'installer', kind: 'pkg', storagePath: `software-releases/origami/${patch.releaseId || `b${n}`}/macos/${patch.architecture || 'arm64'}/installer.pkg`, objectGeneration: '123', sizeBytes: 3, sha256: 'a'.repeat(64) }, ...patch })
function fixture(rows = [], access = { productId: 'origami', status: 'active', edition: 'beta' }) {
  const paths = []
  const db = { doc: path => ({ get: async () => { paths.push(path); return { exists: true, data: () => path === 'products/origami' ? { status: 'beta', licensing: { enabled: true, editions: ['beta'] } } : access } } }), collection: () => { const filters = []; const q = { where: (k, op, v) => { filters.push([k, v]); return q }, limit: () => q, get: async () => ({ docs: rows.filter(r => filters.every(([k, v]) => r[k] === v)).map(r => ({ id: r.releaseId, data: () => r })) }) }; return q } }
  return { core: origamiReleasesCore({ db, now: () => time }), paths }
}
test('strict SemVer, bounded identities and spoofing input rejected', () => {
  for (const v of ['0.1.0', '0.1.0-beta.1', '1.2.3+build.abc', '1.2.3-1a']) assert.equal(versionOK(v), true)
  for (const v of ['01.2.3', '1.2', '1.2.3-01', 'v1.2.3', '1.2.3-', '1.2.3\n']) assert.equal(versionOK(v), false)
  for (const patch of [{ installedBuildNumber: 0 }, { installedBuildNumber: 1.1 }, { installedBuildNumber: '101' }, { installedVersion: 'bad' }, { uid: 'victim' }, { entitlement: { status: 'active' } }, { platform: 'other' }]) assert.throws(() => validateInput({ ...input, ...patch }))
})
test('selection, policy, response allowlist and build-only ordering', async () => {
  for (const [rows, status, build] of [
    [[], 'no_eligible_release'], [[release()], 'update_available', 101],
    [[release(102), release(104), release(103)], 'update_available', 104],
    [[release(100)], 'up_to_date'], [[release(99)], 'up_to_date'],
    [[release(101, { version: '0.0.1' })], 'update_available', 101],
    [[release(105, { status: 'draft' }), release(106, { status: 'unpublished' })], 'no_eligible_release'],
    [[release(110, { channel: 'internal' })], 'no_eligible_release'],
    [[release(110, { platform: 'windows' })], 'no_eligible_release'],
    [[release(110, { architecture: 'x86_64' })], 'no_eligible_release'],
    [[release(110, { architecture: 'universal' })], 'update_available', 110],
    [[release(110, { publishedAt: new Date(time + 1000) })], 'no_eligible_release']
  ]) {
    const answer = await fixture(rows).core.check(input, 'real-user')
    assert.equal(answer.status, status)
    assert.equal(answer.release?.buildNumber, build)
    if (answer.release) assert.deepEqual(Object.keys(answer.release).sort(), ['artifactId', 'buildNumber', 'channel', 'minimumOS', 'releaseId', 'releaseNotes', 'version'])
  }
  for (const access of [undefined, { status: 'revoked' }, { status: 'active', productId: 'origami', edition: 'beta', expiresAt: new Date(time - 1) }, { status: 'active', productId: 'origami', edition: 'stable' }]) {
    const f = fixture([release()], access === undefined ? null : access)
    assert.equal((await f.core.check(input, 'real-user')).status, 'no_eligible_release')
    assert.ok(f.paths.includes('users/real-user/entitlements/origami'))
  }
  for (const installedChannel of ['internal', 'stable']) assert.equal((await fixture([release()]).core.check({ ...input, installedChannel }, 'u')).status, 'no_eligible_release')
})
test('oversized active catalog fails closed', async () => {
  await assert.rejects(fixture(Array.from({ length: 101 }, (_, i) => release(101 + i))).core.check(input, 'u'), { code: 'resource-exhausted' })
})
test('malformed catalog rows ignored', async () => {
  for (const patch of [{ schemaVersion: 2 }, { productId: 'other' }, { version: 'bad' }, { buildNumber: -1 }, { buildNumber: 1.2 }, { buildNumber: '102' }, { sourceRevision: '../bad' }, { releaseNotes: 'x'.repeat(8193) }, { releaseNotes: '😀'.repeat(3000) }, { minimumOS: '../12' }, { publishedAt: null }, { publishedAt: { toMillis: 'bad' } }]) {
    const r = release(102, patch)
    assert.equal(Boolean(validRelease(r, r.releaseId)), false)
    assert.equal((await fixture([r]).core.check(input, 'u')).status, 'no_eligible_release')
  }
})
test('publication enforces immutable identity and monotonic build allocation', () => {
  const { assertTransition } = require('../src/releases/releasePublication')
  const r = release()
  assert.doesNotThrow(() => assertTransition(null, r, 100, '0.1.0-beta.1'))
  assert.throws(() => assertTransition(null, r, 101))
  assert.throws(() => assertTransition(null, { ...r, version: '0.0.9' }, 100, '0.1.0'))
  assert.doesNotThrow(() => assertTransition(r, { ...r, status: 'unpublished' }))
  for (const patch of [{ version: '0.1.1' }, { buildNumber: 102 }, { sourceRevision: 'def456' }, { releaseNotes: 'silently replaced' }, { status: 'draft' }]) assert.throws(() => assertTransition(r, { ...r, ...patch }))
})
test('Firestore emulator enforces release privacy and denies client publication', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing')
  const { readFileSync } = require('node:fs')
  const { doc, getDoc, setDoc, getDocs, collection } = require('firebase/firestore')
  const env = await initializeTestEnvironment({ projectId: 'demo-origami-u02-rules', firestore: { rules: readFileSync(require('node:path').resolve(__dirname, '../../firestore.rules'), 'utf8') } })
  try {
    await env.withSecurityRulesDisabled(async c => { await setDoc(doc(c.firestore(), 'products/origami'), { status: 'published', visibility: 'public' }); await setDoc(doc(c.firestore(), 'products/origami/releases/b101'), release()) })
    for (const c of [env.unauthenticatedContext(), env.authenticatedContext('beta'), env.authenticatedContext('owner', { admin: true, adminRole: 'owner' })]) {
      const db = c.firestore()
      await assertFails(getDoc(doc(db, 'products/origami/releases/b101')))
      await assertFails(getDocs(collection(db, 'products/origami/releases')))
      await assertFails(setDoc(doc(db, 'products/origami/releases/b102'), release(102)))
    }
  } finally { await env.cleanup() }
})
test('release selection uses real Firestore and canonical entitlement', { skip: !process.env.FIRESTORE_EMULATOR_HOST }, async () => {
  const { initializeApp, deleteApp } = require('firebase-admin/app')
  const { getFirestore } = require('firebase-admin/firestore')
  const app = initializeApp({ projectId: 'demo-u02-' + require('node:crypto').randomBytes(5).toString('hex') }, 'u02-core')
  const db = getFirestore(app)
  try {
    await db.doc('products/origami').set({ status: 'beta', licensing: { enabled: true, editions: ['beta'] } })
    await db.doc('users/tester/entitlements/origami').set({ productId: 'origami', status: 'active', edition: 'beta' })
    const core = origamiReleasesCore({ db, now: () => time })
    assert.equal((await core.check(input, 'tester')).status, 'no_eligible_release')
    for (const r of [release(101), release(105), release(106, { status: 'draft' }), release(107, { channel: 'internal' })]) await db.doc(`products/origami/releases/${r.releaseId}`).set(r)
    assert.equal((await core.check(input, 'tester')).release.buildNumber, 105)
    assert.equal((await core.check(input, 'outsider')).status, 'no_eligible_release')
    await db.doc('users/tester/entitlements/origami').update({ status: 'revoked' })
    assert.equal((await core.check(input, 'tester')).status, 'no_eligible_release')
    const artifacts = { inspect: async () => ({}) }
    const { writeRelease } = require('../src/releases/releasePublication')
    const published = release(120, { publishedAt: new Date(Date.now() - 1000) })
    await writeRelease(db, published, 'fixture-publisher', artifacts)
    assert.equal((await db.doc('products/origami').get()).data().releaseBuildNumber, 120)
    await writeRelease(db, { ...published, status: 'unpublished' }, 'fixture-publisher', artifacts)
    await assert.rejects(writeRelease(db, { ...published, sourceRevision: 'changed' }, 'fixture-publisher', artifacts))
    const concurrent = await Promise.allSettled([writeRelease(db, release(121, { publishedAt: published.publishedAt }), 'fixture-publisher', artifacts), writeRelease(db, release(121, { releaseId: 'another121', publishedAt: published.publishedAt }), 'fixture-publisher', artifacts)])
    assert.equal(concurrent.filter(r => r.status === 'fulfilled').length, 1)
  } finally { await db.terminate(); await deleteApp(app) }
})

test('callable identity checks revocation and cannot be spoofed', async () => {
  const { verifiedReleaseIdentity } = require('../src/releases/origamiReleasesCore')
  const request = { auth: { uid: 'real' }, data: { uid: 'victim' }, rawRequest: { headers: { authorization: 'Bearer fixture-only' } } }
  const auth = { verifyIdToken: async (token, revoked) => { assert.equal(token, 'fixture-only'); assert.equal(revoked, true); return { uid: 'real' } } }
  assert.equal(await verifiedReleaseIdentity(request, auth), 'real')
  for (const r of [{ ...request, auth: null }, { ...request, auth: { uid: 'victim' } }, { ...request, rawRequest: { headers: {} } }]) await assert.rejects(verifiedReleaseIdentity(r, auth), { code: 'unauthenticated' })
  await assert.rejects(verifiedReleaseIdentity(request, { verifyIdToken: async () => { throw new Error('revoked') } }), { code: 'unauthenticated' })
})
test('release build configuration rejects accidental public identity', () => {
  const { spawnSync } = require('node:child_process')
  const script = require('node:path').resolve(__dirname, '../../origami/cmake/ReleaseIdentity.cmake')
  for (const suffix of ['beta.1', 'rc.2', '1a']) assert.equal(spawnSync('cmake', ['-DPROJECT_VERSION=0.1.0', `-DORIGAMI_VERSION_PRERELEASE=${suffix}`, '-P', script]).status, 0)
  for (const suffix of ['01', 'beta..1', '../bad']) assert.notEqual(spawnSync('cmake', [`-DORIGAMI_VERSION_PRERELEASE=${suffix}`, '-P', script]).status, 0)
  for (const [channel, build, ok] of [['development', '0', true], ['DEVELOPMENT', '0', true], ['development', '100', false], ['beta', '0', false], ['beta', '100', true], ['internal', '101', true], ['stable', '102', true], ['beta', '1.5', false], ['beta', '-1', false], ['beta', '001', false], ['beta', '2147483648', false], ['unknown', '100', false]]) {
    const result = spawnSync('cmake', [`-DORIGAMI_BUILD_CHANNEL=${channel}`, `-DORIGAMI_BUILD_NUMBER=${build}`, '-P', script], { encoding: 'utf8' })
    assert.equal(result.status === 0, ok, `${channel}/${build}: ${result.stderr}`)
  }
})
