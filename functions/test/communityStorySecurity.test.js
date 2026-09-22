const test = require('node:test')
const assert = require('node:assert/strict')
const {
  storyViewDecision,
  validateStoryStorageObject
} = require('../src/community/communityStoryShared')
const { verifyStoryStorageObject } = require('../src/community/createCommunityStory')

const mediaPath = 'communityStories/owner/story-1/normalized-1.mp4'

test('Story Storage validation requires path, type, size, owner, story, and upload version', () => {
  const valid = validateStoryStorageObject({
    size: String(2 * 1024 * 1024),
    contentType: 'video/mp4',
    metadata: {
      authorUid: 'owner',
      storyId: 'story-1',
      mediaType: 'video',
      storyUploadVersion: '2'
    }
  }, { uid: 'owner', storyId: 'story-1', mediaPath, mediaType: 'video' })
  assert.equal(valid.ok, true)

  assert.equal(validateStoryStorageObject({
    size: '1024',
    contentType: 'video/mp4',
    metadata: { authorUid: 'outsider', storyId: 'story-1', mediaType: 'video', storyUploadVersion: '2' }
  }, { uid: 'owner', storyId: 'story-1', mediaPath, mediaType: 'video' }).reason, 'metadata')
})

test('Story views increment once per authenticated non-owner viewer', () => {
  assert.equal(storyViewDecision({ authorUid: 'owner', viewerUid: '' }).incremented, false)
  assert.equal(storyViewDecision({ authorUid: 'owner', viewerUid: 'owner' }).incremented, false)
  assert.equal(storyViewDecision({ authorUid: 'owner', viewerUid: 'viewer' }).incremented, true)
  assert.equal(storyViewDecision({ authorUid: 'owner', viewerUid: 'viewer', alreadyViewed: true }).incremented, false)
})

test('callable Story creation Storage gate accepts a legitimate first-party upload', async () => {
  const bucket = {
    file(path) {
      assert.equal(path, mediaPath)
      return {
        async getMetadata() {
          return [{
            size: String(2 * 1024 * 1024),
            contentType: 'video/mp4',
            metadata: {
              authorUid: 'owner',
              storyId: 'story-1',
              mediaType: 'video',
              storyUploadVersion: '2'
            }
          }]
        }
      }
    }
  }

  await assert.doesNotReject(verifyStoryStorageObject({
    uid: 'owner', storyId: 'story-1', mediaPath, mediaType: 'video'
  }, bucket))
})

test('callable keeps a bounded legacy window while v2 requires metadata', () => {
  const legacyObject = { size: '1024', contentType: 'video/mp4', metadata: {} }
  assert.equal(validateStoryStorageObject(legacyObject, {
    uid: 'owner', storyId: 'story-1', mediaPath, mediaType: 'video', requireMetadata: false
  }).ok, true)
  assert.equal(validateStoryStorageObject(legacyObject, {
    uid: 'owner', storyId: 'story-1', mediaPath, mediaType: 'video', requireMetadata: true
  }).reason, 'metadata')
})
