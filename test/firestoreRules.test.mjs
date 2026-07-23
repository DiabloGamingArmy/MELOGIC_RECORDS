import test, { after, before, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore'

const projectId = 'melogic-records-rules-test'
let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: await readFile(new URL('../firestore.rules', import.meta.url), 'utf8')
    }
  })
})

beforeEach(async () => {
  await testEnv.clearFirestore()
})

after(async () => {
  await testEnv?.cleanup()
})

async function seed(path, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), path), data)
  })
}

test('Streaming history and saved music are private to the account owner', async () => {
  await seed('users/owner/recentlyPlayedMusic/release-1', {
    releaseId: 'release-1',
    playedAt: new Date('2026-07-22T12:00:00Z')
  })
  await seed('users/owner/savedMusicReleases/release-1', {
    releaseId: 'release-1',
    createdAt: new Date('2026-07-22T12:00:00Z')
  })

  const ownerDb = testEnv.authenticatedContext('owner').firestore()
  const outsiderDb = testEnv.authenticatedContext('outsider').firestore()

  await assertSucceeds(getDocs(query(collection(ownerDb, 'users/owner/recentlyPlayedMusic'), orderBy('playedAt', 'desc'))))
  await assertSucceeds(getDocs(query(collection(ownerDb, 'users/owner/savedMusicReleases'), orderBy('createdAt', 'desc'))))
  await assertFails(getDocs(collection(outsiderDb, 'users/owner/recentlyPlayedMusic')))
  await assertFails(getDoc(doc(outsiderDb, 'users/owner/savedMusicReleases/release-1')))
})

test('featured artist discovery remains publicly queryable', async () => {
  await seed('profiles/artist-1', {
    uid: 'artist-1',
    featuredMusicArtist: true,
    featuredMusicRank: 1
  })

  const publicDb = testEnv.unauthenticatedContext().firestore()
  const snapshot = await assertSucceeds(getDocs(query(
    collection(publicDb, 'profiles'),
    where('featuredMusicArtist', '==', true),
    orderBy('featuredMusicRank', 'asc')
  )))
  assert.equal(snapshot.size, 1)
})

test('Soura collaborators can discover and edit a shared project without changing access control', async () => {
  await seed('studioProjects/shared-project', {
    title: 'Shared Project',
    ownerId: 'owner',
    collaboratorIds: ['collaborator'],
    bpm: 140,
    key: 'C minor',
    type: 'song',
    visibility: 'private',
    createdAt: new Date('2026-07-22T12:00:00Z'),
    updatedAt: new Date('2026-07-22T12:00:00Z'),
    lastOpenedAt: new Date('2026-07-22T12:00:00Z'),
    version: 1
  })

  const collaboratorDb = testEnv.authenticatedContext('collaborator').firestore()
  const outsiderDb = testEnv.authenticatedContext('outsider').firestore()

  const sharedQuery = query(
    collection(collaboratorDb, 'studioProjects'),
    where('collaboratorIds', 'array-contains', 'collaborator')
  )
  const sharedSnapshot = await assertSucceeds(getDocs(sharedQuery))
  assert.equal(sharedSnapshot.size, 1)

  const projectRef = doc(collaboratorDb, 'studioProjects/shared-project')
  await assertSucceeds(updateDoc(projectRef, { title: 'Collaborator Edit' }))
  await assertFails(updateDoc(projectRef, { ownerId: 'collaborator' }))
  await assertFails(updateDoc(projectRef, { collaboratorIds: [] }))
  await assertFails(getDoc(doc(outsiderDb, 'studioProjects/shared-project')))
})
