import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { canPublishCommunityPost, hasMeaningfulPostText, hasValidImageDraft } from '../src/community/postContentValidation.js'

const require = createRequire(import.meta.url)
const { hasSufficientPostContent } = require('../functions/src/community/communityPostContent.js')

const readyImage = { type: 'image', file: { name: 'cover.jpg' }, status: 'ready' }

test('client post content accepts text, ready images, and text with images', () => {
  assert.equal(canPublishCommunityPost({ body: 'Just finished this track.' }), true)
  assert.equal(canPublishCommunityPost({ fileAttachments: [readyImage] }), true)
  assert.equal(canPublishCommunityPost({ body: 'New mix', fileAttachments: [readyImage] }), true)
})

test('client post content rejects empty, whitespace, removed, uploading, failed, and unsupported-only drafts', () => {
  assert.equal(hasMeaningfulPostText({ body: '   ' }), false)
  assert.equal(hasValidImageDraft([]), false)
  assert.equal(canPublishCommunityPost({}), false)
  assert.equal(canPublishCommunityPost({ body: '   ' }), false)
  assert.equal(canPublishCommunityPost({ fileAttachments: [{ ...readyImage, status: 'uploading' }] }), false)
  assert.equal(canPublishCommunityPost({ fileAttachments: [{ ...readyImage, status: 'failed' }] }), false)
  assert.equal(canPublishCommunityPost({ fileAttachments: [{ type: 'video', file: {}, status: 'ready' }] }), false)
})

test('callable content rule accepts meaningful text or a normalized image only', () => {
  assert.equal(hasSufficientPostContent({ body: 'Text only' }), true)
  assert.equal(hasSufficientPostContent({ attachments: [{ type: 'image', path: 'community/posts/x/image.jpg' }] }), true)
  assert.equal(hasSufficientPostContent({ body: 'Text', attachments: [{ type: 'video' }] }), true)
  assert.equal(hasSufficientPostContent({ body: '   ', attachments: [{ type: 'video' }] }), false)
  assert.equal(hasSufficientPostContent({ attachments: [{ type: 'audio' }, { type: 'file' }] }), false)
})
