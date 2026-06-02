const { onCall, HttpsError } = require('firebase-functions/v2/https')
const {
  admin,
  cleanString,
  db,
  storyIsActive,
  storyRefFor
} = require('./communityStoryShared')

const recordCommunityStoryView = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const storyRef = storyRefFor(request.data?.storyId || '')
  const viewerUid = cleanString(request.auth?.uid || '', 180)
  const firestore = db()
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await firestore.runTransaction(async (tx) => {
    const snap = await tx.get(storyRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Story not found.')
    const story = snap.data() || {}
    if (!storyIsActive(story)) throw new HttpsError('not-found', 'Story not found.')

    const currentCount = Math.max(0, Number(story.viewCount || 0))
    if (viewerUid && viewerUid === story.authorUid) {
      return { viewCount: currentCount, incremented: false }
    }

    if (viewerUid) {
      const viewRef = storyRef.collection('views').doc(viewerUid)
      const viewSnap = await tx.get(viewRef)
      if (viewSnap.exists) return { viewCount: currentCount, incremented: false }
      tx.set(viewRef, {
        storyId: storyRef.id,
        viewerUid,
        viewedAt: now
      })
    }

    tx.set(storyRef, {
      viewCount: admin.firestore.FieldValue.increment(1),
      updatedAt: now
    }, { merge: true })
    return { viewCount: currentCount + 1, incremented: true }
  })

  return {
    ok: true,
    storyId: storyRef.id,
    viewCount: result.viewCount,
    incremented: result.incremented
  }
})

module.exports = {
  recordCommunityStoryView
}
