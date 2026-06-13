const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const firestore = admin.firestore()

function cleanString(value = '', max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

function requireAuth(request) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function validUid(value = '') {
  const uid = cleanString(value, 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid profile id is required.')
  return uid
}

function profileSummary(uid, profile = {}, user = {}) {
  return {
    uid,
    displayName: cleanString(profile.displayName || user.displayName || user.name || 'Melogic Creator', 120),
    username: cleanString(profile.username || user.username || '', 80),
    photoURL: cleanString(
      profile.avatarURL
      || profile.photoURL
      || user.avatarURL
      || user.photoURL
      || '',
      900
    )
  }
}

function followNotificationsEnabled(user = {}) {
  const settings = user.settings && typeof user.settings === 'object' ? user.settings : {}
  const preferences = settings.notificationPreferences && typeof settings.notificationPreferences === 'object'
    ? settings.notificationPreferences
    : {}
  return preferences.delivery?.inApp !== false && preferences.content?.follows !== false
}

function isCallableError(error) {
  return error instanceof HttpsError || [
    'unauthenticated',
    'invalid-argument',
    'not-found',
    'failed-precondition',
    'permission-denied'
  ].includes(String(error?.code || ''))
}

function safeErrorDetails(error) {
  return {
    code: cleanString(error?.code || 'unknown', 80),
    message: cleanString(error?.message || 'Unknown error', 300)
  }
}

function calculateFollowTransition({
  followerExists = false,
  followingExists = false,
  requestedState = null,
  followersCount = 0,
  followingCount = 0
} = {}) {
  const wasFollowing = Boolean(followerExists || followingExists)
  const following = typeof requestedState === 'boolean' ? requestedState : !wasFollowing
  const targetDelta = following ? (followerExists ? 0 : 1) : (followerExists ? -1 : 0)
  const viewerDelta = following ? (followingExists ? 0 : 1) : (followingExists ? -1 : 0)
  return {
    wasFollowing,
    following,
    mirrorsMatch: Boolean(followerExists) === Boolean(followingExists),
    followersCount: Math.max(0, Number(followersCount || 0) + targetDelta),
    followingCount: Math.max(0, Number(followingCount || 0) + viewerDelta)
  }
}

async function aggregateCount(query) {
  const snapshot = await query.count().get()
  return Math.max(0, Number(snapshot.data().count || 0))
}

async function sumPublishedProductDownloads(uid) {
  const snapshot = await firestore.collection('products')
    .where('artistId', '==', uid)
    .where('status', '==', 'published')
    .where('visibility', '==', 'public')
    .get()
  return snapshot.docs.reduce((total, entry) => {
    const product = entry.data() || {}
    return total + Math.max(0, Number(product.downloadCount ?? product.counts?.downloads ?? 0))
  }, 0)
}

async function countPublicCommunities(uid) {
  const communities = firestore.collection('communities')
  const [owned, moderated] = await Promise.all([
    communities
      .where('ownerUid', '==', uid)
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .get(),
    communities
      .where('moderatorIds', 'array-contains', uid)
      .where('status', '==', 'active')
      .where('visibility', '==', 'public')
      .get()
  ])
  return new Set([...owned.docs, ...moderated.docs].map((entry) => entry.id)).size
}

async function toggleProfileFollowHandler(request) {
  const viewerUid = requireAuth(request)
  const targetUid = validUid(request.data?.targetUid)
  if (viewerUid === targetUid) throw new HttpsError('failed-precondition', 'You cannot follow your own profile.')
  const requestedState = typeof request.data?.follow === 'boolean' ? request.data.follow : null

  try {
    const viewerProfileRef = firestore.collection('profiles').doc(viewerUid)
    const viewerUserRef = firestore.collection('users').doc(viewerUid)
    const targetProfileRef = firestore.collection('profiles').doc(targetUid)
    const targetUserRef = firestore.collection('users').doc(targetUid)
    const followerRef = targetUserRef.collection('followers').doc(viewerUid)
    const followingRef = viewerUserRef.collection('following').doc(targetUid)
    const notificationRef = targetUserRef.collection('systemNotifications').doc()

    const transactionResult = await firestore.runTransaction(async (transaction) => {
      const [viewerProfileSnap, viewerUserSnap, targetProfileSnap, targetUserSnap, followerSnap, followingSnap] = await Promise.all([
        transaction.get(viewerProfileRef),
        transaction.get(viewerUserRef),
        transaction.get(targetProfileRef),
        transaction.get(targetUserRef),
        transaction.get(followerRef),
        transaction.get(followingRef)
      ])
      if (!targetProfileSnap.exists && !targetUserSnap.exists) {
        throw new HttpsError('not-found', 'Profile not found.')
      }

      const targetProfile = targetProfileSnap.exists ? targetProfileSnap.data() || {} : {}
      const viewerProfile = viewerProfileSnap.exists ? viewerProfileSnap.data() || {} : {}
      const targetUser = targetUserSnap.exists ? targetUserSnap.data() || {} : {}
      const viewerUser = viewerUserSnap.exists ? viewerUserSnap.data() || {} : {}
      const targetCounterSource = targetProfileSnap.exists ? targetProfile : targetUser
      const viewerCounterSource = viewerProfileSnap.exists ? viewerProfile : viewerUser
      const transition = calculateFollowTransition({
        followerExists: followerSnap.exists,
        followingExists: followingSnap.exists,
        requestedState,
        followersCount: targetCounterSource.followerCount ?? targetCounterSource.followersCount ?? 0,
        followingCount: viewerCounterSource.followingCount || 0
      })
      const { wasFollowing, following, followersCount, followingCount, mirrorsMatch } = transition

      if (following === wasFollowing && mirrorsMatch) {
        return {
          ok: true,
          targetUid,
          following,
          followersCount,
          followingCount,
          changed: false,
          shouldNotify: false
        }
      }

      const now = admin.firestore.FieldValue.serverTimestamp()
      const viewer = profileSummary(viewerUid, viewerProfile, viewerUser)
      const target = profileSummary(targetUid, targetProfile, targetUser)

      if (following) {
        transaction.set(followerRef, { ...viewer, followedAt: now, updatedAt: now })
        transaction.set(followingRef, { ...target, followedAt: now, updatedAt: now })
      } else {
        transaction.delete(followerRef)
        transaction.delete(followingRef)
      }

      transaction.set(targetProfileSnap.exists ? targetProfileRef : targetUserRef, {
        followerCount: followersCount,
        followersCount,
        updatedAt: now
      }, { merge: true })
      transaction.set(viewerProfileSnap.exists ? viewerProfileRef : viewerUserRef, {
        followingCount,
        updatedAt: now
      }, { merge: true })

      return {
        ok: true,
        targetUid,
        following,
        followersCount,
        followingCount,
        changed: true,
        shouldNotify: following && !wasFollowing && followNotificationsEnabled(targetUser),
        notificationActor: viewer
      }
    })

    let notificationCreated = false
    if (transactionResult.shouldNotify && transactionResult.notificationActor) {
      const viewer = transactionResult.notificationActor
      try {
        await notificationRef.set({
          type: 'follow',
          category: 'content',
          recipientUid: targetUid,
          actorUid: viewerUid,
          actorDisplayName: viewer.displayName,
          actorUsername: viewer.username,
          actorPhotoURL: viewer.photoURL,
          title: 'New follower',
          body: `${viewer.displayName || 'A Melogic creator'} followed your profile.`,
          targetType: 'profile',
          targetId: viewerUid,
          actionHref: `/profiles/${encodeURIComponent(viewerUid)}`,
          severity: 'info',
          readAt: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          metadata: {
            actorUid: viewerUid,
            targetType: 'profile',
            targetId: viewerUid
          }
        })
        notificationCreated = true
      } catch (error) {
        console.warn('[profile-follow] notification write failed', {
          targetUid,
          viewerUid,
          ...safeErrorDetails(error)
        })
      }
    }

    const { shouldNotify, notificationActor, ...publicResult } = transactionResult
    return { ...publicResult, notificationCreated }
  } catch (error) {
    if (isCallableError(error)) throw error
    console.error('[profile-follow] toggle failed', {
      targetUid,
      viewerUid,
      requestedState,
      ...safeErrorDetails(error)
    })
    throw new HttpsError('internal', 'Could not update this follow.', {
      reason: 'follow-write-failed'
    })
  }
}

const toggleProfileFollow = onCall({ timeoutSeconds: 60, memory: '256MiB' }, toggleProfileFollowHandler)

const getPublicProfileStats = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const profileUid = validUid(request.data?.uid)
  const viewerUid = cleanString(request.auth?.uid || '', 180)
  const profileRef = firestore.collection('profiles').doc(profileUid)
  const profileSnap = await profileRef.get()
  if (!profileSnap.exists) throw new HttpsError('not-found', 'Profile not found.')

  const failures = []
  const safeCount = async (key, loader) => {
    try {
      return await loader()
    } catch (error) {
      console.warn('[profile-stats] query failed', { key, profileUid, code: error?.code || '', message: error?.message || '' })
      failures.push(key)
      return 0
    }
  }

  const [followers, following, posts, products, downloads, focused, communities, stagePlans, viewerFollowSnap] = await Promise.all([
    safeCount('followers', () => aggregateCount(firestore.collection('users').doc(profileUid).collection('followers'))),
    safeCount('following', () => aggregateCount(firestore.collection('users').doc(profileUid).collection('following'))),
    safeCount('posts', () => aggregateCount(
      firestore.collection('communityPosts')
        .where('authorUid', '==', profileUid)
        .where('status', '==', 'published')
        .where('visibility', '==', 'public')
    )),
    safeCount('products', () => aggregateCount(
      firestore.collection('products')
        .where('artistId', '==', profileUid)
        .where('status', '==', 'published')
        .where('visibility', '==', 'public')
    )),
    safeCount('downloads', () => sumPublishedProductDownloads(profileUid)),
    safeCount('focused', () => aggregateCount(firestore.collection('users').doc(profileUid).collection('focusedCommunities'))),
    safeCount('communities', () => countPublicCommunities(profileUid)),
    safeCount('stagePlans', () => aggregateCount(
      firestore.collection('stageProjects')
        .where('ownerId', '==', profileUid)
        .where('visibility', '==', 'public')
    )),
    viewerUid && viewerUid !== profileUid
      ? firestore.collection('users').doc(profileUid).collection('followers').doc(viewerUid).get().catch(() => null)
      : Promise.resolve(null)
  ])

  return {
    ok: true,
    uid: profileUid,
    stats: { followers, following, posts, products, downloads, focused, communities, stagePlans },
    isFollowing: Boolean(viewerFollowSnap?.exists),
    failedStatQueries: failures
  }
})

module.exports = {
  calculateFollowTransition,
  followNotificationsEnabled,
  getPublicProfileStats,
  isCallableError,
  safeErrorDetails,
  toggleProfileFollowHandler,
  toggleProfileFollow
}
