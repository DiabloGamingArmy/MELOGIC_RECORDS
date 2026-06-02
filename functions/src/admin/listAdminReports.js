const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString } = require('./adminAuth')
const { db, normalizeLimit, orderSummary, productSummary, profileSummary, reportSummary, safeListCollection } = require('./adminListShared')

function matchesFilter(report = {}, filter = '') {
  if (!filter || filter === 'all') return true
  if (filter === 'open') return !report.status || report.status === 'open'
  if (filter === 'in_review') return report.status === 'in_review'
  if (filter === 'resolved') return report.status === 'resolved'
  if (filter === 'dismissed') return report.status === 'dismissed'
  if (filter === 'product') return report.targetType === 'product' || report.type === 'product'
  if (filter === 'user') return ['user', 'profile'].includes(report.targetType) || ['user', 'profile'].includes(report.type)
  if (filter === 'order') return report.targetType === 'order' || report.type === 'order'
  if (filter === 'community') return report.targetType === 'community' || report.type === 'community'
  if (filter === 'community_post') return report.targetType === 'community_post' || report.type === 'community_post'
  if (filter === 'community_comment') return report.targetType === 'community_comment' || report.type === 'community_comment'
  if (filter === 'community_story') return report.targetType === 'community_story' || report.type === 'community_story'
  return true
}

async function loadProfileSummary(uid = '') {
  if (!uid) return null
  const [profileSnap, userSnap, adminSnap] = await Promise.all([
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).get(),
    db().collection('adminUsers').doc(uid).get()
  ])
  if (!profileSnap.exists && !userSnap.exists && !adminSnap.exists) return null
  return profileSummary(
    profileSnap.exists ? profileSnap : { id: uid, data: () => ({ uid }) },
    adminSnap.exists ? adminSnap.data() || {} : null,
    userSnap.exists ? userSnap.data() || {} : {}
  )
}

async function enrichReport(report = {}) {
  const [reporter, target] = await Promise.all([
    loadProfileSummary(report.reporterUid).catch(() => null),
    (async () => {
      if (report.targetType === 'product' && report.targetId) {
        const productSnap = await db().collection('products').doc(report.targetId).get()
        return productSnap.exists ? productSummary(productSnap) : null
      }
      if (['profile', 'user'].includes(report.targetType) && report.targetId) {
        return loadProfileSummary(report.targetId)
      }
      if (report.targetType === 'order' && report.targetId) {
        const orderSnap = await db().collection('orders').doc(report.targetId).get()
        return orderSnap.exists ? orderSummary(orderSnap) : null
      }
      if (report.targetType === 'community_post' && report.targetId) {
        const postSnap = await db().collection('communityPosts').doc(report.targetId).get()
        if (!postSnap.exists) return null
        const post = postSnap.data() || {}
        return {
          id: postSnap.id,
          title: cleanString(post.title || post.body || 'Community post', 180),
          authorUid: cleanString(post.authorUid || '', 180),
          status: cleanString(post.status || '', 80),
          visibility: cleanString(post.visibility || '', 80),
          type: cleanString(post.type || 'community_post', 80)
        }
      }
      if (report.targetType === 'community_comment' && report.targetId) {
        const postId = cleanString(report.metadata?.postId || String(report.sourcePath || '').split('/community/post/')[1]?.split('/')[0] || '', 180)
        if (!postId || postId.includes('/')) return null
        const commentSnap = await db().collection('communityPosts').doc(postId).collection('comments').doc(report.targetId).get()
        if (!commentSnap.exists) return null
        const comment = commentSnap.data() || {}
        return {
          id: commentSnap.id,
          postId,
          title: cleanString(comment.body || 'Community comment', 180),
          authorUid: cleanString(comment.authorUid || '', 180),
          status: cleanString(comment.status || '', 80),
          type: 'community_comment'
        }
      }
      if (report.targetType === 'community_story' && report.targetId) {
        const storySnap = await db().collection('communityStories').doc(report.targetId).get()
        if (!storySnap.exists) return null
        const story = storySnap.data() || {}
        return {
          id: storySnap.id,
          title: cleanString(story.text || `${story.mediaType || 'Story'} story`, 180),
          authorUid: cleanString(story.authorUid || '', 180),
          status: cleanString(story.status || '', 80),
          visibility: cleanString(story.visibility || '', 80),
          type: 'community_story'
        }
      }
      if (report.targetType === 'community' && report.targetId) {
        const communitySnap = await db().collection('communities').doc(report.targetId).get()
        if (!communitySnap.exists) return null
        const community = communitySnap.data() || {}
        return {
          id: communitySnap.id,
          title: cleanString(community.name || community.slug || 'Community', 180),
          slug: cleanString(community.slug || communitySnap.id, 80),
          ownerUid: cleanString(community.ownerUid || '', 180),
          status: cleanString(community.status || '', 80),
          visibility: cleanString(community.visibility || '', 80),
          type: 'community'
        }
      }
      return null
    })().catch(() => null)
  ])
  return { reporter, target }
}

const listAdminReports = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAnyPermission(request, ['userModerate', 'productReview', 'orderSupport'])
  const limit = normalizeLimit(request.data?.limit ?? request.data?.limitCount ?? 50)
  const reportId = cleanString(request.data?.reportId || '', 180)
  const filter = cleanString(request.data?.filter || '', 80)

  if (reportId) {
    if (reportId.includes('/')) throw new HttpsError('invalid-argument', 'A valid report id is required.')
    const snap = await db().collection('reports').doc(reportId).get()
    if (!snap.exists) throw new HttpsError('not-found', 'Report not found.')
    const report = reportSummary(snap)
    const detail = await enrichReport(report)
    return {
      ok: true,
      report,
      reports: [report],
      total: 1,
      ...detail,
      requester: { uid: claims.uid, role: claims.adminRole }
    }
  }

  const snapshot = await safeListCollection('reports', { orderBy: 'createdAt', direction: 'desc', limit })
  const reports = snapshot.docs.map(reportSummary).filter((report) => matchesFilter(report, filter))
  return {
    ok: true,
    reports,
    total: reports.length,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  listAdminReports
}
