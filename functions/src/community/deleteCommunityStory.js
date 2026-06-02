const { onCall, HttpsError } = require('firebase-functions/v2/https')
const {
  admin,
  db,
  isStoryAdmin,
  requireAuth,
  serializeStory,
  storyRefFor
} = require('./communityStoryShared')

const deleteCommunityStory = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = requireAuth(request)
  const storyRef = storyRefFor(request.data?.storyId || '')
  const firestore = db()
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(storyRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Story not found.')
    const story = snap.data() || {}
    const canDelete = story.authorUid === uid || isStoryAdmin(request)
    if (!canDelete) throw new HttpsError('permission-denied', 'You cannot delete this story.')
    const status = story.authorUid === uid ? 'deleted' : 'hidden'
    tx.set(storyRef, {
      status,
      deletedAt: now,
      deletedBy: uid,
      updatedAt: now
    }, { merge: true })
    return {
      story,
      status
    }
  })

  return {
    ok: true,
    storyId: storyRef.id,
    status: result.status,
    story: serializeStory({ ...result.story, status: result.status }, storyRef.id)
  }
})

module.exports = {
  deleteCommunityStory
}
