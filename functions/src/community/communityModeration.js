const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertAnyPermission, cleanString } = require('../admin/adminAuth')
const { reportSummary, serializeDate } = require('../admin/adminListShared')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { canManageCommunity } = require('./communityShared')

function db() {
  return admin.firestore()
}

function requireUid(request = {}) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function safeId(value = '', label = 'id') {
  const id = cleanString(value, 180)
  if (!id || id.includes('/')) throw new HttpsError('invalid-argument', `A valid ${label} is required.`)
  return id
}

function cleanReason(value = '') {
  return cleanString(value || 'Community moderation action', 1200)
}

function isPlatformModerator(request = {}) {
  const token = request.auth?.token || {}
  return token.admin === true || token.userModerate === true
}

async function loadCommunityForPost(post = {}) {
  const communityId = cleanString(post.communityId || post.communitySlug || '', 180)
  if (!communityId || communityId.includes('/')) return null
  const snap = await db().collection('communities').doc(communityId).get()
  return snap.exists ? { id: snap.id, data: snap.data() || {} } : null
}

function canModerateCommunityTarget(request = {}, community = null) {
  if (isPlatformModerator(request)) return true
  return community ? canManageCommunity(request.auth, community.data || {}) : false
}

async function assertPostModerator(request = {}, post = {}) {
  const community = await loadCommunityForPost(post)
  if (!canModerateCommunityTarget(request, community)) {
    throw new HttpsError('permission-denied', 'Community moderation permission is required.')
  }
  return community
}

function serializePost(docSnap) {
  const raw = docSnap.data() || {}
  const counts = raw.counts && typeof raw.counts === 'object' ? raw.counts : {}
  return {
    postId: docSnap.id,
    id: docSnap.id,
    title: cleanString(raw.title || raw.body || 'Community post', 180),
    body: cleanString(raw.body || '', 320),
    authorUid: cleanString(raw.authorUid || '', 180),
    authorDisplayName: cleanString(raw.authorDisplayName || '', 180),
    authorUsername: cleanString(raw.authorUsername || '', 80),
    communityId: cleanString(raw.communityId || '', 180),
    communitySlug: cleanString(raw.communitySlug || '', 80),
    communityName: cleanString(raw.communityName || '', 180),
    status: cleanString(raw.status || '', 80),
    visibility: cleanString(raw.visibility || '', 80),
    commentsLocked: raw.commentsLocked === true,
    pinnedInCommunity: raw.pinnedInCommunity === true,
    likeCount: Math.max(0, Number(raw.likeCount ?? counts.likes ?? 0)),
    commentCount: Math.max(0, Number(raw.commentCount ?? counts.comments ?? 0)),
    reportCount: Math.max(0, Number(raw.reportCount ?? counts.reports ?? 0)),
    score: Math.max(0, Number(raw.score || 0)),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

function serializeComment(docSnap, postId = '') {
  const raw = docSnap.data() || {}
  return {
    commentId: docSnap.id,
    id: docSnap.id,
    postId: cleanString(raw.postId || postId, 180),
    body: cleanString(raw.body || '', 320),
    authorUid: cleanString(raw.authorUid || '', 180),
    authorDisplayName: cleanString(raw.authorDisplayName || '', 180),
    authorUsername: cleanString(raw.authorUsername || '', 80),
    parentCommentId: cleanString(raw.parentCommentId || '', 180),
    status: cleanString(raw.status || '', 80),
    likeCount: Math.max(0, Number(raw.likeCount || 0)),
    replyCount: Math.max(0, Number(raw.replyCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

function serializeCommunity(docSnap) {
  const raw = docSnap.data() || {}
  return {
    communityId: docSnap.id,
    id: docSnap.id,
    slug: cleanString(raw.slug || docSnap.id, 80),
    name: cleanString(raw.name || raw.slug || 'Community', 180),
    description: cleanString(raw.description || '', 320),
    category: cleanString(raw.category || '', 80),
    ownerUid: cleanString(raw.ownerUid || '', 180),
    status: cleanString(raw.status || '', 80),
    visibility: cleanString(raw.visibility || '', 80),
    focusCount: Math.max(0, Number(raw.focusCount || 0)),
    postCount: Math.max(0, Number(raw.postCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    pinnedPostIds: Array.isArray(raw.pinnedPostIds) ? raw.pinnedPostIds.map((id) => cleanString(id, 180)).filter(Boolean).slice(0, 3) : [],
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

async function audit(request = {}, action = '', targetType = '', targetId = '', targetPath = '', reason = '', before = null, after = null, metadata = {}) {
  const token = request.auth?.token || {}
  await writeAdminAuditLog({
    actorUid: request.auth?.uid || '',
    actorEmail: token.email || '',
    actorRole: token.adminRole || '',
    action,
    targetType,
    targetId,
    targetPath,
    reason,
    before,
    after,
    metadata
  }).catch(() => null)
}

async function updatePostModeration(request, { action, status, visibility = 'private', extra = {} } = {}) {
  const uid = requireUid(request)
  const postId = safeId(request.data?.postId || '', 'post id')
  const reason = cleanReason(request.data?.reason || '')
  const ref = db().collection('communityPosts').doc(postId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Community post not found.')
  const post = snap.data() || {}
  await assertPostModerator(request, post)
  const now = admin.firestore.FieldValue.serverTimestamp()
  const update = {
    status,
    visibility,
    moderationStatus: status,
    moderationReason: reason,
    moderatedAt: now,
    moderatedBy: uid,
    updatedAt: now,
    ...extra
  }
  await ref.set(update, { merge: true })
  await audit(request, action, 'community_post', postId, `communityPosts/${postId}`, reason, post, update)
  return { ok: true, postId, status, visibility, commentsLocked: extra.commentsLocked === undefined ? post.commentsLocked === true : extra.commentsLocked }
}

const hideCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => updatePostModeration(request, {
  action: 'community_post_hidden',
  status: 'hidden_by_moderator',
  visibility: 'private'
}))

const restoreCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => updatePostModeration(request, {
  action: 'community_post_restored',
  status: 'published',
  visibility: 'public',
  extra: { moderationStatus: 'restored' }
}))

const lockCommunityPostComments = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const locked = request.data?.locked !== false
  return updatePostModeration(request, {
    action: locked ? 'community_post_comments_locked' : 'community_post_comments_unlocked',
    status: 'published',
    visibility: 'public',
    extra: {
      commentsLocked: locked,
      lockedAt: locked ? admin.firestore.FieldValue.serverTimestamp() : null,
      lockedBy: locked ? request.auth?.uid || '' : ''
    }
  })
})

const deleteOwnCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireUid(request)
  const postId = safeId(request.data?.postId || '', 'post id')
  const reason = cleanReason(request.data?.reason || 'Author hid their post.')
  const ref = db().collection('communityPosts').doc(postId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Community post not found.')
  const post = snap.data() || {}
  if (post.authorUid !== uid && !isPlatformModerator(request)) {
    throw new HttpsError('permission-denied', 'You can only delete your own post.')
  }
  const now = admin.firestore.FieldValue.serverTimestamp()
  const update = {
    status: post.authorUid === uid ? 'hidden_by_author' : 'hidden_by_moderator',
    visibility: 'private',
    deletedAt: now,
    deletedBy: uid,
    moderationReason: reason,
    updatedAt: now
  }
  await ref.set(update, { merge: true })
  if (post.authorUid !== uid) await audit(request, 'community_post_deleted_by_moderator', 'community_post', postId, `communityPosts/${postId}`, reason, post, update)
  return { ok: true, postId, status: update.status, visibility: update.visibility }
})

const pinCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireUid(request)
  const postId = safeId(request.data?.postId || '', 'post id')
  const reason = cleanReason(request.data?.reason || 'Pinned community post.')
  const firestore = db()
  const result = await firestore.runTransaction(async (tx) => {
    const postRef = firestore.collection('communityPosts').doc(postId)
    const postSnap = await tx.get(postRef)
    if (!postSnap.exists) throw new HttpsError('not-found', 'Community post not found.')
    const post = postSnap.data() || {}
    if (post.status !== 'published' || post.visibility !== 'public') {
      throw new HttpsError('failed-precondition', 'Only public published posts can be pinned.')
    }
    const communityId = cleanString(post.communityId || post.communitySlug || '', 180)
    if (!communityId || communityId.includes('/')) throw new HttpsError('failed-precondition', 'This post is not attached to a community.')
    const communityRef = firestore.collection('communities').doc(communityId)
    const communitySnap = await tx.get(communityRef)
    if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
    const community = communitySnap.data() || {}
    if (!canModerateCommunityTarget(request, { id: communitySnap.id, data: community })) {
      throw new HttpsError('permission-denied', 'Community moderation permission is required.')
    }
    const pinned = Array.isArray(community.pinnedPostIds) ? community.pinnedPostIds.filter(Boolean) : []
    const next = [postId, ...pinned.filter((id) => id !== postId)].slice(0, 3)
    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.set(communityRef, { pinnedPostIds: next, updatedAt: now }, { merge: true })
    tx.set(postRef, { pinnedInCommunity: true, pinnedAt: now, pinnedBy: uid, updatedAt: now }, { merge: true })
    return { communityId: communitySnap.id, pinnedPostIds: next, before: community, post }
  })
  await audit(request, 'community_post_pinned', 'community_post', postId, `communityPosts/${postId}`, reason, result.post, { pinnedInCommunity: true, communityId: result.communityId })
  return { ok: true, postId, communityId: result.communityId, pinnedPostIds: result.pinnedPostIds }
})

const unpinCommunityPost = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireUid(request)
  const postId = safeId(request.data?.postId || '', 'post id')
  const reason = cleanReason(request.data?.reason || 'Unpinned community post.')
  const firestore = db()
  const result = await firestore.runTransaction(async (tx) => {
    const postRef = firestore.collection('communityPosts').doc(postId)
    const postSnap = await tx.get(postRef)
    if (!postSnap.exists) throw new HttpsError('not-found', 'Community post not found.')
    const post = postSnap.data() || {}
    const communityId = cleanString(post.communityId || post.communitySlug || '', 180)
    if (!communityId || communityId.includes('/')) throw new HttpsError('failed-precondition', 'This post is not attached to a community.')
    const communityRef = firestore.collection('communities').doc(communityId)
    const communitySnap = await tx.get(communityRef)
    if (!communitySnap.exists) throw new HttpsError('not-found', 'Community not found.')
    const community = communitySnap.data() || {}
    if (!canModerateCommunityTarget(request, { id: communitySnap.id, data: community })) {
      throw new HttpsError('permission-denied', 'Community moderation permission is required.')
    }
    const pinned = Array.isArray(community.pinnedPostIds) ? community.pinnedPostIds.filter(Boolean) : []
    const next = pinned.filter((id) => id !== postId).slice(0, 3)
    const now = admin.firestore.FieldValue.serverTimestamp()
    tx.set(communityRef, { pinnedPostIds: next, updatedAt: now }, { merge: true })
    tx.set(postRef, { pinnedInCommunity: false, unpinnedAt: now, unpinnedBy: uid, updatedAt: now }, { merge: true })
    return { communityId: communitySnap.id, pinnedPostIds: next, post }
  })
  await audit(request, 'community_post_unpinned', 'community_post', postId, `communityPosts/${postId}`, reason, result.post, { pinnedInCommunity: false, communityId: result.communityId })
  return { ok: true, postId, communityId: result.communityId, pinnedPostIds: result.pinnedPostIds }
})

async function updateCommentModeration(request, status = 'hidden_by_moderator', action = 'community_comment_hidden') {
  requireUid(request)
  const postId = safeId(request.data?.postId || '', 'post id')
  const commentId = safeId(request.data?.commentId || '', 'comment id')
  const reason = cleanReason(request.data?.reason || '')
  const postRef = db().collection('communityPosts').doc(postId)
  const postSnap = await postRef.get()
  if (!postSnap.exists) throw new HttpsError('not-found', 'Community post not found.')
  const post = postSnap.data() || {}
  await assertPostModerator(request, post)
  const commentRef = postRef.collection('comments').doc(commentId)
  const commentSnap = await commentRef.get()
  if (!commentSnap.exists) throw new HttpsError('not-found', 'Community comment not found.')
  const comment = commentSnap.data() || {}
  const now = admin.firestore.FieldValue.serverTimestamp()
  const update = {
    status,
    moderationStatus: status,
    moderationReason: reason,
    moderatedAt: now,
    moderatedBy: request.auth?.uid || '',
    updatedAt: now
  }
  await commentRef.set(update, { merge: true })
  await audit(request, action, 'community_comment', commentId, `communityPosts/${postId}/comments/${commentId}`, reason, comment, update, { postId })
  return { ok: true, postId, commentId, status }
}

const hideCommunityComment = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => updateCommentModeration(request, 'hidden_by_moderator', 'community_comment_hidden'))
const restoreCommunityComment = onCall({ timeoutSeconds: 60, memory: '256MiB' }, (request) => updateCommentModeration(request, 'visible', 'community_comment_restored'))

const moderateCommunity = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  assertAnyPermission(request, ['userModerate'])
  const communityId = safeId(request.data?.communityId || '', 'community id')
  const action = cleanString(request.data?.action || '', 80)
  const reason = cleanReason(request.data?.reason || '')
  const allowed = new Set(['hide', 'restore', 'suspend'])
  if (!allowed.has(action)) throw new HttpsError('invalid-argument', 'A valid community moderation action is required.')
  const ref = db().collection('communities').doc(communityId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Community not found.')
  const before = snap.data() || {}
  const now = admin.firestore.FieldValue.serverTimestamp()
  const update = action === 'restore'
    ? { status: 'active', visibility: 'public', moderationStatus: 'restored', moderationReason: reason, moderatedAt: now, moderatedBy: request.auth?.uid || '', updatedAt: now }
    : { status: action === 'suspend' ? 'suspended' : 'hidden', visibility: 'private', moderationStatus: action, moderationReason: reason, moderatedAt: now, moderatedBy: request.auth?.uid || '', updatedAt: now }
  await ref.set(update, { merge: true })
  await audit(request, `community_${action}`, 'community', communityId, `communities/${communityId}`, reason, before, update)
  return { ok: true, communityId, status: update.status, visibility: update.visibility }
})

async function safeQuery(collectionName, build, fallbackLimit = 30) {
  try {
    return await build(db().collection(collectionName)).get()
  } catch {
    return db().collection(collectionName).limit(fallbackLimit).get()
  }
}

const listAdminCommunityModeration = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate'])
  const limitCount = Math.max(1, Math.min(Math.round(Number(request.data?.limitCount || request.data?.limit || 30)), 100))
  const [postsSnap, communitiesSnap, reportsSnap] = await Promise.all([
    safeQuery('communityPosts', (ref) => ref.orderBy('createdAt', 'desc').limit(limitCount), limitCount),
    safeQuery('communities', (ref) => ref.orderBy('updatedAt', 'desc').limit(limitCount), limitCount),
    safeQuery('reports', (ref) => ref.orderBy('createdAt', 'desc').limit(limitCount), limitCount)
  ])
  const posts = postsSnap.docs.map(serializePost)
  const communities = communitiesSnap.docs.map(serializeCommunity)
  const reports = reportsSnap.docs
    .map(reportSummary)
    .filter((report) => ['community', 'community_post', 'community_comment', 'community_story'].includes(report.targetType || report.type))
  const commentReports = reports.filter((report) => report.targetType === 'community_comment')
  const comments = await Promise.all(commentReports.slice(0, 20).map(async (report) => {
    const postId = cleanString(report.metadata?.postId || '', 180)
    if (!postId || postId.includes('/')) return null
    const snap = await db().collection('communityPosts').doc(postId).collection('comments').doc(report.targetId).get().catch(() => null)
    return snap?.exists ? serializeComment(snap, postId) : null
  }))
  return {
    ok: true,
    requester: { uid: claims.uid, role: claims.adminRole },
    posts,
    communities,
    reports,
    reportedPosts: posts.filter((post) => post.reportCount > 0 || reports.some((report) => report.targetType === 'community_post' && report.targetId === post.postId)),
    reportedComments: comments.filter(Boolean),
    hiddenPosts: posts.filter((post) => ['hidden_by_author', 'hidden_by_moderator', 'removed'].includes(post.status)),
    total: { posts: posts.length, communities: communities.length, reports: reports.length }
  }
})

module.exports = {
  hideCommunityPost,
  restoreCommunityPost,
  lockCommunityPostComments,
  deleteOwnCommunityPost,
  pinCommunityPost,
  unpinCommunityPost,
  hideCommunityComment,
  restoreCommunityComment,
  moderateCommunity,
  listAdminCommunityModeration
}
