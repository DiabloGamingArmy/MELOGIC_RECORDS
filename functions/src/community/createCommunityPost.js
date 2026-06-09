const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')
const { cleanSlug } = require('./communityShared')

const POST_TYPES = new Set(['post', 'text', 'product_share'])
const ATTACHMENT_TYPES = new Set(['product', 'music', 'stage_plan', 'studio_project'])
const FEEDBACK_CATEGORIES = new Set(['Mix', 'Master', 'Songwriting', 'Sound Design', 'Vocal Performance', 'Stage Layout', 'Product Listing', 'Other'])
const COLLABORATION_ROLES = new Set(['Vocalist', 'Producer', 'Songwriter', 'Guitarist', 'Drummer', 'Mixing Engineer', 'Mastering Engineer', 'Sound Designer', 'Stage Designer', 'Lighting Designer', 'Camera Operator', 'Other'])
const COMPENSATION_TYPES = new Set(['Paid', 'Unpaid', 'Revenue Share', 'Discuss'])
const LOCATION_MODES = new Set(['Remote', 'Local', 'Either'])

function db() {
  return admin.firestore()
}

function cleanTag(value = '') {
  return cleanString(value, 40)
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function normalizeTags(value = []) {
  const raw = Array.isArray(value)
    ? value
    : String(value || '').split(/[,\s]+/)
  return Array.from(new Set(raw.map(cleanTag).filter(Boolean))).slice(0, 5)
}

function tokenizeForSearch(...values) {
  const tokens = new Set()
  values.forEach((value) => {
    String(value || '')
      .toLowerCase()
      .replace(/[^a-z0-9@\s_-]+/g, ' ')
      .split(/[\s,_-]+/)
      .map((part) => part.replace(/^@+/, '').trim())
      .filter((part) => part.length >= 2)
      .slice(0, 30)
      .forEach((part) => tokens.add(part.slice(0, 40)))
  })
  return Array.from(tokens).slice(0, 50)
}

async function loadAuthorSnapshot(uid = '') {
  const [profileSnap, userSnap] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get()
  ])
  const profile = profileSnap.exists ? profileSnap.data() || {} : {}
  const user = userSnap.exists ? userSnap.data() || {} : {}
  return {
    authorDisplayName: cleanString(profile.displayName || user.displayName || user.name || 'Melogic Creator', 120),
    authorUsername: cleanString(profile.username || user.username || '', 60),
    authorAvatarURL: cleanString(profile.avatarURL || profile.photoURL || user.avatarURL || user.photoURL || '', 900)
  }
}

async function buildProductSnapshot(productId = '') {
  const id = cleanString(productId, 180)
  if (!id) return { linkedProductId: '', linkedProductSnapshot: {} }
  if (id.includes('/')) throw new HttpsError('invalid-argument', 'A valid product id is required.')

  const snap = await db().collection('products').doc(id).get()
  if (!snap.exists) throw new HttpsError('not-found', 'The shared product could not be found.')
  const product = snap.data() || {}
  if (product.status !== 'published' || product.visibility !== 'public') {
    throw new HttpsError('failed-precondition', 'Only public published products can be shared.')
  }

  return {
    linkedProductId: id,
    linkedProductSnapshot: {
      productId: id,
      title: cleanString(product.title || 'Untitled product', 180),
      slug: cleanString(product.slug || '', 180),
      artistId: cleanString(product.artistId || '', 180),
      artistName: cleanString(product.artistDisplayName || product.artistName || '', 120),
      thumbnailURL: cleanString(product.thumbnailURL || product.coverURL || '', 900),
      priceCents: Math.max(0, Math.round(Number(product.priceCents || 0))),
      isFree: Boolean(product.isFree) || Number(product.priceCents || 0) <= 0,
      currency: cleanString(product.currency || 'USD', 12)
    }
  }
}

async function buildProductAttachment(productId = '') {
  const productLink = await buildProductSnapshot(productId)
  if (!productLink.linkedProductId) return null
  return {
    type: 'product',
    targetId: productLink.linkedProductId,
    productId: productLink.linkedProductId,
    snapshot: {
      title: productLink.linkedProductSnapshot.title || 'Untitled product',
      slug: productLink.linkedProductSnapshot.slug || '',
      thumbnailURL: productLink.linkedProductSnapshot.thumbnailURL || '',
      creatorName: productLink.linkedProductSnapshot.artistName || '',
      priceCents: productLink.linkedProductSnapshot.priceCents || 0,
      isFree: productLink.linkedProductSnapshot.isFree === true,
      currency: productLink.linkedProductSnapshot.currency || 'USD'
    }
  }
}

function isSafeId(id = '') {
  const clean = cleanString(id, 180)
  return clean && !clean.includes('/')
}

function safeProductPreviewPath(productId = '', path = '') {
  const cleanProductId = cleanString(productId, 180)
  const cleanPath = cleanString(path, 900)
  if (!cleanProductId || !cleanPath) return ''
  return cleanPath.startsWith(`products/${cleanProductId}/audio-previews/`) ? cleanPath : ''
}

function firstSafeProductAudioPreview(productId = '', product = {}, requestedPath = '') {
  const assignment = product.previewAssignment && typeof product.previewAssignment === 'object' ? product.previewAssignment : {}
  const candidates = [
    requestedPath,
    assignment.hoverAudioPath,
    product.primaryPreviewType === 'audio' ? product.primaryPreviewPath : '',
    ...(Array.isArray(product.previewAudioPaths) ? product.previewAudioPaths : [])
  ]
  return candidates.map((path) => safeProductPreviewPath(productId, path)).find(Boolean) || ''
}

async function buildMusicAttachment(attachment = {}, uid = '') {
  const sourceType = cleanString(attachment.sourceType || 'product_preview', 80)
  if (sourceType !== 'product_preview') {
    throw new HttpsError('failed-precondition', 'Only public product audio previews can be shared as music right now.')
  }
  const sourceId = cleanString(attachment.sourceId || attachment.productId || attachment.targetId || '', 180)
  if (!isSafeId(sourceId)) throw new HttpsError('invalid-argument', 'A valid music source is required.')
  const snap = await db().collection('products').doc(sourceId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'The music preview source could not be found.')
  const product = snap.data() || {}
  if (product.artistId !== uid) throw new HttpsError('permission-denied', 'You can only share music previews from your own products.')
  if (product.status !== 'published' || product.visibility !== 'public') {
    throw new HttpsError('failed-precondition', 'Only public published product previews can be shared.')
  }
  const storagePath = firstSafeProductAudioPreview(sourceId, product, attachment.storagePath || '')
  if (!storagePath) throw new HttpsError('failed-precondition', 'This product does not have a public audio preview to share.')
  return {
    type: 'music',
    targetId: storagePath,
    sourceType: 'product_preview',
    sourceId,
    storagePath,
    snapshot: {
      title: cleanString(product.title || 'Music preview', 180),
      creatorName: cleanString(product.artistDisplayName || product.artistName || '', 120),
      durationSeconds: Math.max(0, Math.round(Number(product.primaryPreviewDuration || 0))),
      waveformData: [],
      coverURL: cleanString(product.thumbnailURL || product.coverURL || '', 900),
      mimeType: 'audio/*'
    }
  }
}

function canShareProject(project = {}, uid = '') {
  return project.ownerId === uid || (Array.isArray(project.collaboratorIds) && project.collaboratorIds.includes(uid))
}

function stageDimensions(project = {}) {
  const dimensions = project.stageDimensions && typeof project.stageDimensions === 'object'
    ? project.stageDimensions
    : project.stage && typeof project.stage === 'object'
      ? { width: project.stage.width, depth: project.stage.depth, unit: project.stage.unit }
      : {}
  return {
    width: Math.max(0, Number(dimensions.width || 0)),
    depth: Math.max(0, Number(dimensions.depth || 0)),
    unit: cleanString(dimensions.unit || dimensions.units || 'ft', 12)
  }
}

async function buildStagePlanAttachment(attachment = {}, uid = '', author = {}) {
  const projectId = cleanString(attachment.targetId || attachment.projectId || '', 180)
  if (!isSafeId(projectId)) throw new HttpsError('invalid-argument', 'A valid Stage Plan id is required.')
  const snap = await db().collection('stageProjects').doc(projectId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'The Stage Plan could not be found.')
  const project = snap.data() || {}
  if (!canShareProject(project, uid)) throw new HttpsError('permission-denied', 'You can only share Stage Plans you own or collaborate on.')
  const dimensions = stageDimensions(project)
  const objectCount = Array.isArray(project.objects)
    ? project.objects.length
    : Array.isArray(project.plan?.objects)
      ? project.plan.objects.length
      : 0
  return {
    type: 'stage_plan',
    targetId: projectId,
    projectId,
    snapshot: {
      title: cleanString(project.title || project.name || 'Untitled Stage Plan', 120),
      templateName: cleanString(project.stageType || project.type || 'Stage Plan', 80),
      stageWidth: dimensions.width,
      stageDepth: dimensions.depth,
      units: dimensions.unit || 'ft',
      objectCount: Math.max(0, Math.round(Number(objectCount || 0))),
      previewImageURL: '',
      ownerDisplayName: author.authorDisplayName || 'Melogic Creator',
      ownerUsername: author.authorUsername || '',
      visibility: project.visibility === 'public' ? 'public' : 'private',
      sharePath: project.visibility === 'public' ? `/studio/stagemaker/project/${encodeURIComponent(projectId)}` : ''
    }
  }
}

async function buildStudioProjectAttachment(attachment = {}, uid = '', author = {}) {
  const projectId = cleanString(attachment.targetId || attachment.projectId || '', 180)
  if (!isSafeId(projectId)) throw new HttpsError('invalid-argument', 'A valid Studio Project id is required.')
  const snap = await db().collection('studioProjects').doc(projectId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'The Studio Project could not be found.')
  const project = snap.data() || {}
  if (!canShareProject(project, uid)) throw new HttpsError('permission-denied', 'You can only share Studio Projects you own or collaborate on.')
  const tracks = Array.isArray(project.tracks) ? project.tracks : []
  const previewAudioPath = ''
  return {
    type: 'studio_project',
    targetId: projectId,
    projectId,
    snapshot: {
      title: cleanString(project.title || 'Untitled Studio Project', 120),
      bpm: Math.max(0, Math.round(Number(project.bpm || 0))),
      key: cleanString(project.key || '', 40),
      durationSeconds: Math.max(0, Math.round(Number(project.durationSeconds || 0))),
      trackCount: Math.max(0, Math.round(Number(project.trackCount || tracks.length || 0))),
      coverURL: '',
      previewAudioPath,
      creatorDisplayName: author.authorDisplayName || 'Melogic Creator',
      creatorUsername: author.authorUsername || '',
      visibility: project.visibility === 'public' ? 'public' : 'private',
      sharePath: ''
    }
  }
}

async function normalizeAttachments(value = [], uid = '', author = {}) {
  const raw = Array.isArray(value) ? value.slice(0, 12) : []
  if (raw.length > 4) throw new HttpsError('invalid-argument', 'Posts can include up to 4 attachments.')

  const accepted = []
  const counts = { product: 0, music: 0, stage_plan: 0, studio_project: 0 }

  for (const attachment of raw) {
    if (!attachment || typeof attachment !== 'object') continue
    const type = cleanString(attachment.type || '', 40)
    if (!ATTACHMENT_TYPES.has(type)) throw new HttpsError('invalid-argument', 'Unsupported attachment type.')
    counts[type] += 1
    if (counts.product > 1 || counts.stage_plan > 1 || counts.studio_project > 1 || counts.music > 2) {
      throw new HttpsError('invalid-argument', 'Too many attachments of one type.')
    }
    if (type === 'product') {
      accepted.push(await buildProductAttachment(attachment.targetId || attachment.productId || ''))
    } else if (type === 'music') {
      accepted.push(await buildMusicAttachment(attachment, uid))
    } else if (type === 'stage_plan') {
      accepted.push(await buildStagePlanAttachment(attachment, uid, author))
    } else if (type === 'studio_project') {
      accepted.push(await buildStudioProjectAttachment(attachment, uid, author))
    }
  }

  return accepted.filter(Boolean).slice(0, 4)
}

function normalizeIntent(data = {}) {
  const rawIntent = cleanString(data.intent || '', 80)
  if (!rawIntent) return { intent: '', intentData: {} }
  if (!['feedback_request', 'collaboration_request'].includes(rawIntent)) {
    throw new HttpsError('invalid-argument', 'Unsupported post intent.')
  }
  const input = data.intentData && typeof data.intentData === 'object' ? data.intentData : {}
  const deadlineRaw = cleanString(input.deadlineAt || '', 80)
  let deadlineAt = ''
  if (deadlineRaw) {
    const deadlineMs = Date.parse(deadlineRaw)
    if (!Number.isFinite(deadlineMs) || deadlineMs <= Date.now()) {
      throw new HttpsError('invalid-argument', 'Deadline must be a future date.')
    }
    deadlineAt = new Date(deadlineMs).toISOString()
  }
  if (rawIntent === 'feedback_request') {
    const category = cleanString(input.category || '', 80)
    const question = cleanString(input.question || '', 300)
    if (!FEEDBACK_CATEGORIES.has(category)) throw new HttpsError('invalid-argument', 'Choose a valid feedback category.')
    if (!question) throw new HttpsError('invalid-argument', 'Feedback question is required.')
    return { intent: rawIntent, intentData: { category, question, deadlineAt } }
  }
  const roleNeeded = cleanString(input.roleNeeded || '', 80)
  const compensationType = cleanString(input.compensationType || '', 40)
  const locationMode = cleanString(input.locationMode || '', 40)
  if (!COLLABORATION_ROLES.has(roleNeeded)) throw new HttpsError('invalid-argument', 'Choose a valid collaborator role.')
  if (!COMPENSATION_TYPES.has(compensationType)) throw new HttpsError('invalid-argument', 'Choose a valid compensation type.')
  if (!LOCATION_MODES.has(locationMode)) throw new HttpsError('invalid-argument', 'Choose a valid location mode.')
  return {
    intent: rawIntent,
    intentData: {
      roleNeeded,
      genre: cleanString(input.genre || '', 80),
      compensationType,
      locationMode,
      locationText: cleanString(input.locationText || '', 120),
      deadlineAt
    }
  }
}

function normalizeMentions(ids = [], usernames = [], uid = '') {
  const mentionedUserIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
    .map((id) => cleanString(id, 180))
    .filter((id) => id && id !== uid && !id.includes('/')))).slice(0, 10)
  const mentionedUsernames = Array.from(new Set((Array.isArray(usernames) ? usernames : [])
    .map((username) => cleanString(username, 60).replace(/^@/, '').toLowerCase())
    .filter(Boolean))).slice(0, 10)
  return { mentionedUserIds, mentionedUsernames }
}

async function resolveCommunityForPost({ communityId = '', communitySlug = '', uid = '' } = {}) {
  const id = cleanString(communityId || cleanSlug(communitySlug), 180)
  if (!id) return { communityId: '', communitySlug: '' }
  if (id.includes('/')) throw new HttpsError('invalid-argument', 'A valid community id is required.')

  let communitySnap = await db().collection('communities').doc(id).get()
  if (!communitySnap.exists) {
    const slugSnap = await db().collection('communities')
      .where('slug', '==', id)
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .limit(1)
      .get()
    if (!slugSnap.empty) {
      communitySnap = slugSnap.docs[0]
    }
  }
  if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
  const community = communitySnap.data() || {}
  if (community.status !== 'active' || community.visibility !== 'public') {
    throw new HttpsError('failed-precondition', 'This community is not available for posting.')
  }

  const postingMode = cleanString(community.postingMode || 'open', 40)
  const isModerator = community.ownerUid === uid || (Array.isArray(community.moderatorIds) && community.moderatorIds.includes(uid))
  if (postingMode === 'moderators_only' && !isModerator) {
    throw new HttpsError('permission-denied', 'Only moderators can post in this community.')
  }
  if (postingMode === 'focused_only' || postingMode === 'members_only') {
    const focusSnap = await db().collection('users').doc(uid).collection('focusedCommunities').doc(communitySnap.id).get()
    if (!focusSnap.exists && !isModerator) {
      throw new HttpsError('permission-denied', 'Focus this community before posting.')
    }
  }

  return {
    communityId: communitySnap.id,
    communitySlug: cleanString(community.slug || communitySnap.id, 80),
    communityName: cleanString(community.name || community.slug || communitySnap.id, 120)
  }
}

const createCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const rawType = cleanString(request.data?.type || 'post', 40)
  const type = rawType === 'product_share' ? 'product_share' : rawType === 'text' ? 'text' : 'post'
  const title = cleanString(request.data?.title || '', 120)
  const body = cleanString(request.data?.body || '', 2000)
  const tags = normalizeTags(request.data?.tags || [])
  const mentions = normalizeMentions(request.data?.mentionedUserIds || [], request.data?.mentionedUsernames || [], uid)
  const intent = normalizeIntent(request.data || {})

  if (!POST_TYPES.has(type)) throw new HttpsError('invalid-argument', 'A valid post type is required.')
  if (type === 'product_share' && !cleanString(request.data?.linkedProductId || '', 180)) {
    throw new HttpsError('invalid-argument', 'Choose a product to share.')
  }

  const [author, productLink, community] = await Promise.all([
    loadAuthorSnapshot(uid),
    type === 'product_share'
      ? buildProductSnapshot(request.data?.linkedProductId || '')
      : Promise.resolve({ linkedProductId: '', linkedProductSnapshot: {} }),
    resolveCommunityForPost({
      communityId: request.data?.communityId || '',
      communitySlug: request.data?.communitySlug || '',
      uid
    })
  ])
  const attachments = type === 'product_share'
    ? []
    : await normalizeAttachments(request.data?.attachments || [], uid, author)
  if (!body && !title && !attachments.length && type !== 'product_share') {
    throw new HttpsError('invalid-argument', 'Add text, a title, or an attachment before publishing.')
  }
  if (intent.intent === 'feedback_request' && !body && !attachments.length) {
    throw new HttpsError('invalid-argument', 'Feedback requests need a body or an attachment.')
  }
  const attachmentTypes = Array.from(new Set(attachments.map((attachment) => attachment.type).filter(Boolean)))
  const authorDisplayNameLower = String(author.authorDisplayName || '').toLowerCase()
  const authorUsernameLower = String(author.authorUsername || '').replace(/^@+/, '').toLowerCase()
  const titleLower = title.toLowerCase()
  const tagKeys = tags
  const searchKeywords = tokenizeForSearch(
    title,
    body,
    tags.join(' '),
    community.communityName,
    community.communitySlug,
    author.authorDisplayName,
    author.authorUsername,
    mentions.mentionedUsernames.join(' '),
    intent.intent,
    intent.intentData?.category,
    intent.intentData?.roleNeeded,
    ...attachments.map((attachment) => attachment.snapshot?.title || '')
  )

  const postRef = db().collection('communityPosts').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const payload = {
    postId: postRef.id,
    authorUid: uid,
    ...author,
    authorDisplayNameLower,
    authorUsernameLower,
    type,
    title,
    titleLower,
    body,
    communityId: community.communityId,
    communitySlug: community.communitySlug,
    communityName: community.communityName || '',
    ...productLink,
    attachments,
    attachmentTypes,
    mediaPaths: [],
    mentionedUserIds: mentions.mentionedUserIds,
    mentionedUsernames: mentions.mentionedUsernames,
    intent: intent.intent,
    intentData: intent.intentData,
    scheduledAt: null,
    publishStatus: 'published',
    tags,
    tagKeys,
    searchKeywords,
    status: 'published',
    visibility: 'public',
    official: false,
    commentsLocked: false,
    pinnedInCommunity: false,
    counts: {
      likes: 0,
      dislikes: 0,
      comments: 0,
      saves: 0,
      shares: 0,
      reports: 0
    },
    likeCount: 0,
    dislikeCount: 0,
    commentCount: 0,
    saveCount: 0,
    shareCount: 0,
    reportCount: 0,
    score: 0,
    createdAt: now,
    updatedAt: now
  }

  const batch = db().batch()
  batch.set(postRef, payload)
  if (community.communityId) {
    batch.set(db().collection('communities').doc(community.communityId), {
      postCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now
    }, { merge: true })
  }
  await batch.commit()
  return { ok: true, postId: postRef.id, post: { ...payload, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } }
})

module.exports = {
  createCommunityPost
}
