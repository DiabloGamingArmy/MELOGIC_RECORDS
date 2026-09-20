const { onCall, HttpsError } = require('firebase-functions/v2/https')
const {
  STORY_ACTIVE_MS,
  STORY_MEDIA_TYPES,
  admin,
  cleanString,
  db,
  loadAuthorSnapshot,
  requireAuth,
  normalizeLifetimeHours,
  sanitizeBackground,
  sanitizeLinkedId,
  sanitizeStoryLayers,
  sanitizeStoryId,
  sanitizeStoryText,
  serializeStory,
  storyIsActive,
  validStoryMediaPath
} = require('./communityStoryShared')

const createCommunityStory = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const firestore = db()
  const suppliedStoryId = sanitizeStoryId(request.data?.storyId || '')
  const storyRef = suppliedStoryId
    ? firestore.collection('communityStories').doc(suppliedStoryId)
    : firestore.collection('communityStories').doc()
  const storyId = storyRef.id
  const mediaType = cleanString(request.data?.mediaType || 'text', 20)
  const text = sanitizeStoryText(request.data?.text || '')
  const caption = sanitizeStoryText(request.data?.caption || text)
  const mediaPath = cleanString(request.data?.mediaPath || '', 900)
  const thumbnailPath = cleanString(request.data?.thumbnailPath || '', 900)
  const durationSeconds = Math.max(0, Math.round(Number(request.data?.durationSeconds || 0)))
  const lifetimeHours = normalizeLifetimeHours(request.data?.lifetimeHours || 24)
  const linkedPostId = sanitizeLinkedId(request.data?.linkedPostId || '')
  const linkedProductId = sanitizeLinkedId(request.data?.linkedProductId || '')
  const remixOfStoryId = sanitizeLinkedId(request.data?.remixOfStoryId || '')
  const remixPermission = request.data?.remixPermission === true
  const storyTypeRaw = cleanString(request.data?.storyType || 'moment', 24).toLowerCase()
  const storyTypes = new Set(['moment', 'sound', 'thought', 'drop', 'ask', 'live', 'project'])
  const storyType = storyTypes.has(storyTypeRaw) ? storyTypeRaw : 'moment'
  const layers = sanitizeStoryLayers(request.data?.layers || [])

  if (!STORY_MEDIA_TYPES.has(mediaType)) {
    throw new HttpsError('invalid-argument', 'Story media type must be text, image, or video.')
  }
  if (mediaType === 'text' && !text) {
    throw new HttpsError('invalid-argument', 'Story text is required.')
  }
  if ((mediaType === 'image' || mediaType === 'video') && !validStoryMediaPath(mediaPath, uid, storyId)) {
    throw new HttpsError('invalid-argument', 'Story media path is not valid for this account.')
  }
  if (thumbnailPath && !validStoryMediaPath(thumbnailPath, uid, storyId)) {
    throw new HttpsError('invalid-argument', 'Story thumbnail path is not valid for this account.')
  }

  const existing = await storyRef.get()
  if (existing.exists) throw new HttpsError('failed-precondition', 'This story already exists.')

  let remixSource = null
  if (remixOfStoryId) {
    const sourceSnap = await firestore.collection('communityStories').doc(remixOfStoryId).get()
    if (!sourceSnap.exists) throw new HttpsError('not-found', 'The original Story is no longer available.')
    remixSource = sourceSnap.data() || {}
    if (!storyIsActive(remixSource)) {
      throw new HttpsError('failed-precondition', 'This Story is expired or cannot be remixed.')
    }
    if (remixSource.authorUid !== uid && remixSource.remixPermission !== true) {
      throw new HttpsError('permission-denied', 'The creator has not enabled remixing for this Story.')
    }
  }

  const nowDate = new Date()
  const expiresDate = new Date(nowDate.getTime() + lifetimeHours * 60 * 60 * 1000)
  const author = await loadAuthorSnapshot(uid)
  const serverNow = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    storyId,
    authorUid: uid,
    authorDisplayName: author.authorDisplayName,
    authorUsername: author.authorUsername,
    authorAvatarURL: author.authorAvatarURL,
    authorPhotoURL: author.authorAvatarURL,
    mediaType,
    text,
    caption,
    mediaPath: mediaType === 'image' || mediaType === 'video' ? mediaPath : '',
    thumbnailPath,
    durationSeconds,
    background: mediaType === 'text' ? sanitizeBackground(request.data?.background || '') : '',
    linkedPostId,
    linkedProductId,
    storyType,
    remixPermission,
    remixOfStoryId,
    remixSourceAuthorUid: remixSource?.authorUid || '',
    remixSourceAuthorDisplayName: remixSource?.authorDisplayName || '',
    remixSourceCreatedAt: remixSource?.createdAt || null,
    layers,
    layerSchemaVersion: 1,
    expiresAt: admin.firestore.Timestamp.fromDate(expiresDate),
    lifetimeHours,
    createdAt: serverNow,
    updatedAt: serverNow,
    viewCount: 0,
    likeCount: 0,
    replyCount: 0,
    reportCount: 0,
    moderationStatus: 'not_submitted',
    status: 'active',
    visibility: 'public'
  }

  await storyRef.set(payload)

  return {
    ok: true,
    storyId,
    story: serializeStory({
      ...payload,
      createdAt: nowDate,
      updatedAt: nowDate,
      expiresAt: expiresDate
    }, storyId)
  }
})

module.exports = {
  createCommunityStory
}
