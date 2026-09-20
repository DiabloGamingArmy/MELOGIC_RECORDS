const { HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { db, loadAuthorSnapshot, requireAuth } = require('./communityCommentShared')

const STORY_COLLECTION = 'communityStories'
const STORY_ACTIVE_MS = 24 * 60 * 60 * 1000
const STORY_MAX_LIFETIME_HOURS = 48
const STORY_BACKGROUND_VALUES = new Set(['aurora', 'midnight', 'sunset', 'stage', 'mono'])
const STORY_MEDIA_TYPES = new Set(['text', 'image', 'video'])

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

const STORY_LAYER_TYPES = new Set(['text', 'audio', 'link', 'person', 'product', 'project', 'poll', 'drawing'])
const STORY_LAYER_MAX_COUNT = 40

function clampStoryLayerNumber(value, fallback = 0, min = 0, max = 1) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function sanitizeStoryLayers(value = []) {
  if (!Array.isArray(value)) return []
  return value.slice(0, STORY_LAYER_MAX_COUNT).map((raw, index) => {
    const type = cleanString(raw?.type || '', 32).toLowerCase()
    if (!STORY_LAYER_TYPES.has(type)) return null
    const layer = {
      id: cleanString(raw?.id || `layer-${index + 1}`, 80),
      type,
      x: clampStoryLayerNumber(raw?.x, .5),
      y: clampStoryLayerNumber(raw?.y, .5),
      width: clampStoryLayerNumber(raw?.width, .25, .02, 1),
      height: clampStoryLayerNumber(raw?.height, .1, .02, 1),
      rotation: clampStoryLayerNumber(raw?.rotation, 0, -180, 180),
      scale: clampStoryLayerNumber(raw?.scale, 1, .1, 8),
      opacity: clampStoryLayerNumber(raw?.opacity, 1),
      zIndex: Math.max(0, Math.min(999, Math.round(Number(raw?.zIndex ?? index) || 0))),
      startMs: Math.max(0, Math.round(Number(raw?.startMs || 0))),
      endMs: Math.max(0, Math.round(Number(raw?.endMs || 0))),
      content: cleanString(raw?.content || '', 1000),
      targetId: sanitizeLinkedId(raw?.targetId || ''),
      targetURL: cleanString(raw?.targetURL || '', 1200),
      metadata: {}
    }
    const metadata = raw?.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {}
    for (const [key, item] of Object.entries(metadata).slice(0, 20)) {
      const safeKey = cleanString(key, 64)
      if (!safeKey) continue
      if (typeof item === 'string') layer.metadata[safeKey] = cleanString(item, 500)
      else if (typeof item === 'number' && Number.isFinite(item)) layer.metadata[safeKey] = item
      else if (typeof item === 'boolean') layer.metadata[safeKey] = item
    }
    return layer
  }).filter(Boolean)
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

function normalizeLifetimeHours(value = 24) {
  const hours = Math.round(Number(value || 24))
  if (!Number.isFinite(hours)) return 24
  return Math.min(STORY_MAX_LIFETIME_HOURS, Math.max(1, hours))
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
    authorPhotoURL: story.authorPhotoURL || story.authorAvatarURL || '',
    mediaType: STORY_MEDIA_TYPES.has(story.mediaType) ? story.mediaType : 'text',
    text: story.text || '',
    caption: story.caption || story.text || '',
    mediaPath: story.mediaPath || '',
    thumbnailPath: story.thumbnailPath || '',
    durationSeconds: Math.max(0, Number(story.durationSeconds || 0)),
    background: story.background || 'aurora',
    linkedPostId: story.linkedPostId || '',
    linkedProductId: story.linkedProductId || '',
    expiresAt: serializeDate(story.expiresAt),
    lifetimeHours: Math.max(1, Number(story.lifetimeHours || 24)),
    createdAt: serializeDate(story.createdAt),
    updatedAt: serializeDate(story.updatedAt),
    viewCount: Math.max(0, Number(story.viewCount || 0)),
    likeCount: Math.max(0, Number(story.likeCount || 0)),
    replyCount: Math.max(0, Number(story.replyCount || 0)),
    reportCount: Math.max(0, Number(story.reportCount || 0)),
    moderationStatus: story.moderationStatus || '',
    status: story.status || 'active',
    visibility: story.visibility || 'public',
    layers: sanitizeStoryLayers(story.layers || []),
    layerSchemaVersion: Math.max(1, Number(story.layerSchemaVersion || 1))
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
  STORY_MAX_LIFETIME_HOURS,
  STORY_MEDIA_TYPES,
  STORY_LAYER_TYPES,
  STORY_LAYER_MAX_COUNT,
  admin,
  cleanString,
  db,
  isStoryAdmin,
  loadAuthorSnapshot,
  normalizeLifetimeHours,
  requireAuth,
  sanitizeBackground,
  sanitizeLinkedId,
  sanitizeStoryLayers,
  sanitizeStoryId,
  sanitizeStoryText,
  serializeStory,
  storyIsActive,
  storyRefFor,
  validStoryMediaPath
}
