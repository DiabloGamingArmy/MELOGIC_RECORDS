const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')
const {
  assertString,
  buildInboxSummaryPayload,
  buildParticipantPayload,
  buildThreadPayload,
  sanitizeParticipantIds
} = require('./helpers')

const db = getFirestore()

exports.createGroupThread = onCall(async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication is required.')
  }

  const title = assertString(request.data?.title)
  if (!title) {
    throw new HttpsError('invalid-argument', 'title is required.')
  }
  const imagePath = assertString(request.data?.imagePath)
  const imageURL = assertString(request.data?.imageURL)

  const participantIds = sanitizeParticipantIds(request.data?.participantIds, callerUid)
  if (participantIds.length < 2) {
    throw new HttpsError('invalid-argument', 'At least 2 participants are required including caller.')
  }

  const result = await db.runTransaction(async (transaction) => {
    const threadRef = db.collection('threads').doc()
    const threadPayload = buildThreadPayload({
      type: 'group',
      createdBy: callerUid,
      title,
      participantIds,
      imagePath,
      imageURL
    })

    transaction.set(threadRef, threadPayload)

    participantIds.forEach((uid) => {
      const participantRef = db.collection('threads').doc(threadRef.id).collection('participants').doc(uid)
      transaction.set(
        participantRef,
        buildParticipantPayload({
          uid,
          role: uid === callerUid ? 'owner' : 'member'
        })
      )

      const summaryRef = db.collection('users').doc(uid).collection('inboxThreads').doc(threadRef.id)
      transaction.set(
        summaryRef,
        buildInboxSummaryPayload({
          threadId: threadRef.id,
          thread: threadPayload,
          recipientUid: uid
        })
      )
    })

    return {
      threadId: threadRef.id,
      existing: false
    }
  })

  return result
})
