import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

import {
  getCachedStorageUrl,
  getPageMediaCacheSnapshot,
  invalidateCachedStoragePath
} from '../src/services/pageMediaCache.js'

test('Storage URL reads deduplicate and explicit invalidation permits refresh', async () => {
  const path = 'users/test/avatar/current.webp'
  const scopeKey = 'storage-cache-test'
  let calls = 0
  const reads = Array.from({ length: 10 }, () => getCachedStorageUrl(path, async () => {
    calls += 1
    await Promise.resolve()
    return 'https://storage.test/avatar.webp'
  }, { scopeKey }))

  assert.equal(new Set(await Promise.all(reads)).size, 1)
  assert.equal(calls, 1)
  invalidateCachedStoragePath(path, { scopeKey })
  assert.equal(await getCachedStorageUrl(path, async () => 'https://storage.test/new.webp', { scopeKey }), 'https://storage.test/new.webp')
})

test('only genuine missing Storage objects enter the negative cache', async () => {
  const path = 'missing.webp'
  const scopeKey = 'storage-negative-test'
  let calls = 0
  const missing = Object.assign(new Error('missing'), { code: 'storage/object-not-found' })
  assert.equal(await getCachedStorageUrl(path, async () => { calls += 1; throw missing }, { scopeKey }), '')
  assert.equal(await getCachedStorageUrl(path, async () => { calls += 1; return 'unused' }, { scopeKey }), '')
  assert.equal(calls, 1)
  assert.equal(getPageMediaCacheSnapshot(scopeKey)[0]?.status, 'missing')
})

test('public profile post query stays author-scoped and has its composite index', async () => {
  const source = await fs.readFile(new URL('../src/profilePublic.js', import.meta.url), 'utf8')
  const functionBody = source.slice(source.indexOf('async function loadPublicCommunityPostsForAuthor'), source.indexOf('async function loadPublicStagePlansForOwner'))
  assert.match(functionBody, /where\('authorUid',\s*'==',\s*uid\)/)
  assert.doesNotMatch(functionBody, /limit\(80\)|filter\(\(post\) => post\.authorUid/)

  const indexes = JSON.parse(await fs.readFile(new URL('../firestore.indexes.json', import.meta.url)))
  const match = indexes.indexes.find((index) => index.collectionGroup === 'communityPosts' &&
    ['authorUid', 'status', 'visibility', 'createdAt'].every((field) => index.fields.some((entry) => entry.fieldPath === field)))
  assert.ok(match)
  assert.equal(match.fields.find((field) => field.fieldPath === 'createdAt')?.order, 'DESCENDING')
})

test('main Firestore uses the persistent local-cache API and pagehide only prunes media metadata', async () => {
  const firestoreSource = await fs.readFile(new URL('../src/firebase/firestore.js', import.meta.url), 'utf8')
  const mediaSource = await fs.readFile(new URL('../src/services/pageMediaCache.js', import.meta.url), 'utf8')
  assert.match(firestoreSource, /initializeFirestore\(app/)
  assert.match(firestoreSource, /persistentLocalCache/)
  assert.match(firestoreSource, /persistentMultipleTabManager/)
  assert.match(mediaSource, /pagehide[^\n]+cache\.prune/)
  assert.doesNotMatch(mediaSource, /pagehide[^\n]+clearPageMediaCache/)
})
