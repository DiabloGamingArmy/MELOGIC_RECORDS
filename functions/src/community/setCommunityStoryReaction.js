const { onCall, HttpsError } = require('firebase-functions/v2/https')
const {
  admin,
  cleanString,
  db,
  storyIsActive,
  storyRefFor
} = require('./communityStoryShared')

const ALLOWED_STORY_REACTIONS = new Set(['like', 'fire', 'laugh', 'mindblown', 'clap', 'dead'])

const setCommunityStoryReaction = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to react to Stories.')

  const storyRef = storyRefFor(request.data?.storyId || '')
  const requestedReaction = cleanString(request.data?.reaction || '', 32).toLowerCase()
  const reaction = requestedReaction === 'none' ? '' : requestedReaction
  if (reaction && !ALLOWED_STORY_REACTIONS.has(reaction)) {
    throw new HttpsError('invalid-argument', 'Unsupported Story reaction.')
  }

  const firestore = db()
  const reactionRef = storyRef.collection('reactions').doc(uid)
  const now = admin.firestore.FieldValue.serverTimestamp()

  const result = await firestore.runTransaction(async (tx) => {
    const [storySnap, reactionSnap] = await Promise.all([tx.get(storyRef), tx.get(reactionRef)])
    if (!storySnap.exists) throw new HttpsError('not-found', 'Story not found.')
    const story = storySnap.data() || {}
    if (!storyIsActive(story)) throw new HttpsError('not-found', 'Story not found.')

    const previousReaction = cleanString(reactionSnap.data()?.reaction || '', 32).toLowerCase()
    const nextReaction = reaction && reaction !== previousReaction ? reaction : ''

    if (nextReaction) {
      tx.set(reactionRef, { storyId: storyRef.id, uid, reaction: nextReaction, updatedAt: now }, { merge: true })
    } else {
      tx.delete(reactionRef)
    }

    const updates = { updatedAt: now }
    if (previousReaction) updates[`reactionCounts.${previousReaction}`] = admin.firestore.FieldValue.increment(-1)
    if (nextReaction) updates[`reactionCounts.${nextReaction}`] = admin.firestore.FieldValue.increment(1)
    if (!previousReaction && nextReaction) updates.reactionCount = admin.firestore.FieldValue.increment(1)
    if (previousReaction && !nextReaction) updates.reactionCount = admin.firestore.FieldValue.increment(-1)
    tx.set(storyRef, updates, { merge: true })

    return { previousReaction, reaction: nextReaction }
  })

  return { ok: true, storyId: storyRef.id, ...result }
})

module.exports = { setCommunityStoryReaction }
