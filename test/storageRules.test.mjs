import test, { after, before } from 'node:test'
import { readFile } from 'node:fs/promises'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing'
import {
  deleteObject,
  ref,
  uploadBytes
} from 'firebase/storage'

const projectId = 'melogic-records-storage-rules-test'
let testEnv

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    storage: {
      rules: await readFile(new URL('../storage.rules', import.meta.url), 'utf8')
    }
  })
})

after(async () => {
  await testEnv?.cleanup()
})

function coverRef(context, uid = 'host', streamId = 'stream-1') {
  return ref(context.storage(), `users/${uid}/liveStudio/${streamId}/cover/cover-1080.jpg`)
}

function coverMetadata(uid = 'host', streamId = 'stream-1') {
  return {
    contentType: 'image/jpeg',
    customMetadata: {
      ownerUid: uid,
      streamId,
      type: 'music-live-cover'
    }
  }
}

test('Live Studio host can upload and delete a validated stream cover', async () => {
  const host = testEnv.authenticatedContext('host')
  const image = new Uint8Array([255, 216, 255, 217])
  const objectRef = coverRef(host)

  await assertSucceeds(uploadBytes(objectRef, image, coverMetadata()))
  await assertSucceeds(deleteObject(objectRef))
})

test('Live Studio cover uploads reject another user and invalid metadata', async () => {
  const outsider = testEnv.authenticatedContext('outsider')
  const host = testEnv.authenticatedContext('host')
  const image = new Uint8Array([255, 216, 255, 217])

  await assertFails(uploadBytes(coverRef(outsider), image, coverMetadata()))
  await assertFails(uploadBytes(
    coverRef(host, 'host', 'stream-invalid'),
    image,
    coverMetadata('host', 'another-stream')
  ))
})

test('Community Story uploads enforce owner path and allowed media type', async () => {
  const owner = testEnv.authenticatedContext('story-owner')
  const outsider = testEnv.authenticatedContext('outsider')
  const bytes = new Uint8Array([0, 0, 0, 0])
  const storyPath = 'communityStories/story-owner/story-1/normalized.mp4'
  const metadata = {
    contentType: 'video/mp4',
    customMetadata: {
      authorUid: 'story-owner',
      storyId: 'story-1',
      mediaType: 'video',
      storyUploadVersion: '2'
    }
  }

  await assertSucceeds(uploadBytes(ref(owner.storage(), storyPath), bytes, metadata))
  await assertFails(uploadBytes(ref(outsider.storage(), storyPath.replace('normalized', 'outsider')), bytes, metadata))
  await assertFails(uploadBytes(ref(owner.storage(), storyPath.replace('normalized', 'invalid')), bytes, {
    contentType: 'text/plain',
    customMetadata: metadata.customMetadata
  }))
})
