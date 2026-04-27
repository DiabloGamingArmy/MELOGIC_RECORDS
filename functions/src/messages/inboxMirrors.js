const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { getFirestore } = require('firebase-admin/firestore')
const { buildInboxSummaryPayload } = require('./helpers')

const db = getFirestore()

async function syncInboxMirrorsForThread(threadId, threadData, options = {}) {
  if (!threadId || !threadData) return { syncedCount: 0 }

  const participantIds = Array.from(
    new Set(
      (Array.isArray(options.participantIds) ? options.participantIds : threadData.participantIds || [])
        .filter(Boolean)
    )
  )

  if (!participantIds.length) return { syncedCount: 0 }

  const batch = db.batch()
  participantIds.forEach((uid) => {
    const mirrorRef = db.collection('users').doc(uid).collection('inboxThreads').doc(threadId)
    batch.set(mirrorRef, buildInboxSummaryPayload({
      threadId,
      thread: threadData,
      recipientUid: uid
    }), { merge: true })
  })

  await batch.commit()
  return { syncedCount: participantIds.length }
}

const syncInboxMirrorsOnThreadWrite = onDocumentWritten('threads/{threadId}', async (event) => {
  const afterData = event.data?.after?.data()
  if (!afterData) return

  const threadId = event.params?.threadId
  await syncInboxMirrorsForThread(threadId, afterData)
})

const repairMyInboxThreads = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Authentication is required.')
  }

  const snapshot = await db
    .collection('threads')
    .where('participantIds', 'array-contains', uid)
    .get()

  let repairedCount = 0
  for (const threadDoc of snapshot.docs) {
    const threadData = threadDoc.data() || {}
    const allParticipants = Array.isArray(threadData.participantIds) ? threadData.participantIds : [uid]
    await syncInboxMirrorsForThread(threadDoc.id, threadData, { participantIds: allParticipants })
    repairedCount += 1
  }

  return { repairedCount }
})

module.exports = {
  syncInboxMirrorsForThread,
  syncInboxMirrorsOnThreadWrite,
  repairMyInboxThreads
}
