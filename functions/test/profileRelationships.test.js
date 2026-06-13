const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp({ projectId: 'melogic-profile-test' })

const {
  calculateFollowTransition,
  followNotificationsEnabled,
  safeErrorDetails,
  toggleProfileFollowHandler
} = require('../src/profiles/profileRelationships')

assert.equal(followNotificationsEnabled({}), true, 'Follow notifications should default to enabled.')
assert.equal(followNotificationsEnabled({
  settings: { notificationPreferences: { content: { follows: false } } }
}), false, 'The content.follows preference should disable follow notifications.')
assert.equal(followNotificationsEnabled({
  settings: { notificationPreferences: { delivery: { inApp: false } } }
}), false, 'The global in-app preference should disable follow notifications.')
assert.equal(followNotificationsEnabled({
  settings: { notificationPreferences: { content: { follows: true }, delivery: { inApp: true } } }
}), true, 'Explicitly enabled follow notifications should remain enabled.')

assert.deepEqual(calculateFollowTransition({
  followerExists: false,
  followingExists: false,
  requestedState: true,
  followersCount: 4,
  followingCount: 2
}), {
  wasFollowing: false,
  following: true,
  mirrorsMatch: true,
  followersCount: 5,
  followingCount: 3
}, 'A new follow should increment both counters once.')

assert.deepEqual(calculateFollowTransition({
  followerExists: true,
  followingExists: true,
  requestedState: true,
  followersCount: 5,
  followingCount: 3
}), {
  wasFollowing: true,
  following: true,
  mirrorsMatch: true,
  followersCount: 5,
  followingCount: 3
}, 'A duplicate follow should be idempotent.')

assert.deepEqual(calculateFollowTransition({
  followerExists: true,
  followingExists: false,
  requestedState: true,
  followersCount: 5,
  followingCount: 2
}), {
  wasFollowing: true,
  following: true,
  mirrorsMatch: false,
  followersCount: 5,
  followingCount: 3
}, 'A partial relationship should repair only the missing mirror.')

assert.deepEqual(calculateFollowTransition({
  followerExists: true,
  followingExists: true,
  requestedState: false,
  followersCount: 0,
  followingCount: 0
}), {
  wasFollowing: true,
  following: false,
  mirrorsMatch: true,
  followersCount: 0,
  followingCount: 0
}, 'Unfollow counters must not become negative.')

assert.deepEqual(safeErrorDetails({
  code: 'permission-denied',
  message: 'Denied\u0000 with control characters.'
}), {
  code: 'permission-denied',
  message: 'Denied with control characters.'
}, 'Logged errors should be sanitized.')

;(async () => {
  await assert.rejects(
    () => toggleProfileFollowHandler({ auth: null, data: {} }),
    (error) => error?.code === 'unauthenticated'
  )
  await assert.rejects(
    () => toggleProfileFollowHandler({ auth: { uid: 'viewer-1' }, data: {} }),
    (error) => error?.code === 'invalid-argument'
  )
  await assert.rejects(
    () => toggleProfileFollowHandler({ auth: { uid: 'viewer-1' }, data: { targetUid: 'viewer-1', follow: true } }),
    (error) => error?.code === 'failed-precondition'
  )
  console.log('profileRelationships tests passed')
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
