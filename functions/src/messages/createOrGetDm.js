const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { getFirestore } = require('firebase-admin/firestore')
const {
  assertString,
  buildInboxSummaryPayload,
  buildParticipantPayload,
  buildThreadPayload,
  makeDmKey
} = require('./helpers')

const db = getFirestore()

exports.createOrGetDm = onCall(async (request) => {
  const callerUid = request.auth?.uid
  if (!callerUid) {
    throw new HttpsError('unauthenticated', 'Authentication is required.')
  }

  const targetUid = assertString(request.data?.targetUid)
  if (!targetUid) {
    throw new HttpsError('invalid-argument', 'targetUid is required.')
  }
  if (targetUid === callerUid) {
    throw new HttpsError('invalid-argument', 'Cannot create a DM with yourself.')
  }

  const dmKey = makeDmKey(callerUid, targetUid)
  const participantIds = [callerUid, targetUid]

  const result = await db.runTransaction(async (transaction) => {
    const existingQuery = db
      .collection('threads')
      .where('type', '==', 'dm')
      .where('dmKey', '==', dmKey)
      .limit(1)

    const existingSnap = await transaction.get(existingQuery)
    if (!existingSnap.empty) {
      const existingDoc = existingSnap.docs[0]
      return {
        threadId: existingDoc.id,
        thread: { id: existingDoc.id, ...existingDoc.data() }
      }
    }

    const threadRef = db.collection('threads').doc()
    const threadPayload = buildThreadPayload({
      type: 'dm',
      createdBy: callerUid,
      participantIds,
      dmKey
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
      thread: {
        id: threadRef.id,
        ...threadPayload,
        participantIds,
        participantCount: participantIds.length
      }
    }
  })

  return result
})
