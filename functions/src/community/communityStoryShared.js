const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { db, loadAuthorSnapshot, requireAuth } = require('./communityCommentShared')

const STORY_COLLECTION = 'communityStories'
const STORY_ACTIVE_MS = 24 * 60 * 60 * 1000
const STORY_BACKGROUND_VALUES = new Set(['aurora', 'midnight', 'sunset', 'stage', 'mono'])
const STORY_MEDIA_TYPES = new Set(['text', 'image'])

function storyRefFor(storyId = '') {
  const id = cleanString(storyId, 180)
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'A valid story id is required.')
  return db().collection(STORY_COLLECTION).doc(id)
}

function sanitizeStoryId(storyId = '') {
  const id = cleanString(storyId, 180)
  if (id && !id.includes('/')) return id
  return ''
}

function sanitizeStoryText(value = '') {
  return cleanString(value, 500)
}

function sanitizeBackground(value = '') {
  const clean = cleanString(value || 'aurora', 40)
  return STORY_BACKGROUND_VALUES.has(clean) ? clean : 'aurora'
}

function sanitizeLinkedId(value = '') {
  const clean = cleanString(value, 180)
  return clean.includes('/') ? '' : clean
}

function validStoryMediaPath(mediaPath = '', uid = '', storyId = '') {
  const clean = cleanString(mediaPath, 900)
  if (!clean) return false
  if (clean.includes('../') || clean.includes('users/')) return false
  return clean.startsWith(`communityStories/${uid}/${storyId}/`)
}

function isStoryAdmin(request) {
  const token = request.auth?.token || {}
  return token.admin === true && (
    token.adminRole === 'owner'
    || token.adminRole === 'admin'
    || token.userModerate === true
  )
}

function serializeDate(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return String(value || '')
}

function serializeStory(story = {}, id = '') {
  return {
    storyId: id || story.storyId || '',
    id: id || story.storyId || '',
    authorUid: story.authorUid || '',
    authorDisplayName: story.authorDisplayName || 'Melogic Creator',
    authorUsername: story.authorUsername || '',
    authorAvatarURL: story.authorAvatarURL || '',
    mediaType: STORY_MEDIA_TYPES.has(story.mediaType) ? story.mediaType : 'text',
    text: story.text || '',
    mediaPath: story.mediaPath || '',
    background: story.background || 'aurora',
    linkedPostId: story.linkedPostId || '',
    linkedProductId: story.linkedProductId || '',
    expiresAt: serializeDate(story.expiresAt),
    createdAt: serializeDate(story.createdAt),
    updatedAt: serializeDate(story.updatedAt),
    viewCount: Math.max(0, Number(story.viewCount || 0)),
    reportCount: Math.max(0, Number(story.reportCount || 0)),
    status: story.status || 'active',
    visibility: story.visibility || 'public'
  }
}

function storyIsActive(story = {}) {
  const expiresAt = story.expiresAt
  const expiresMs = typeof expiresAt?.toMillis === 'function'
    ? expiresAt.toMillis()
    : new Date(expiresAt || 0).getTime()
  return story.status === 'active'
    && story.visibility === 'public'
    && Number.isFinite(expiresMs)
    && expiresMs > Date.now()
}

module.exports = {
  STORY_ACTIVE_MS,
  STORY_BACKGROUND_VALUES,
  STORY_COLLECTION,
  STORY_MEDIA_TYPES,
  admin,
  cleanString,
  db,
  isStoryAdmin,
  loadAuthorSnapshot,
  requireAuth,
  sanitizeBackground,
  sanitizeLinkedId,
  sanitizeStoryId,
  sanitizeStoryText,
  serializeStory,
  storyIsActive,
  storyRefFor,
  validStoryMediaPath
}
