const test = require('node:test')
const assert = require('node:assert/strict')
const {
  storyViewDecision,
  validateStoryStorageObject
} = require('../src/community/communityStoryShared')

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
