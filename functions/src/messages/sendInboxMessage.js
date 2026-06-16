const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { assertString, getThreadParticipantUids } = require('./helpers')

const db = getFirestore()
const MAX_BODY_LENGTH = 1200
const MAX_ATTACHMENTS = 10

function sanitizeAttachment(raw = {}) {
  const storagePath = assertString(raw.storagePath)
  if (!storagePath.startsWith('threads/') || storagePath.includes('../')) {
    throw new HttpsError('invalid-argument', 'Attachment path is invalid.')
  }
  return {
    name: assertString(raw.name).slice(0, 240),
    type: assertString(raw.type).slice(0, 24) || 'file',
    mimeType: assertString(raw.mimeType).slice(0, 120) || 'application/octet-stream',
    size: Math.max(0, Number(raw.size || 0)),
    storagePath,
    url: assertString(raw.url).slice(0, 2000),
    ...(Number(raw.width) > 0 && Number(raw.height) > 0
      ? { width: Number(raw.width), height: Number(raw.height) }
      : {})
  }
}

function sanitizeReplyTo(raw) {
  if (!raw || typeof raw !== 'object') return null
  const messageId = assertString(raw.messageId)
  if (!messageId) return null
  return {
    messageId,
    senderId: assertString(raw.senderId),
    senderName: assertString(raw.senderName).slice(0, 160),
    bodyPreview: assertString(raw.bodyPreview).slice(0, 240),
    attachmentSummary: assertString(raw.attachmentSummary).slice(0, 120),
    type: assertString(raw.type).slice(0, 40) || 'text',
    createdAt: raw.createdAt || null
  }
}

const sendInboxMessage = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const threadId = assertString(request.data?.threadId)
  const messageId = assertString(request.data?.messageId)
  const body = assertString(request.data?.body)
  const clientMessageId = assertString(request.data?.clientMessageId).slice(0, 80)
  const rawAttachments = Array.isArray(request.data?.attachments) ? request.data.attachments : []
  if (!threadId || !messageId) throw new HttpsError('invalid-argument', 'Thread and message IDs are required.')
  if (body.length > MAX_BODY_LENGTH) throw new HttpsError('invalid-argument', 'Message is too long.')
  if (rawAttachments.length > MAX_ATTACHMENTS) throw new HttpsError('invalid-argument', 'Too many attachments.')
  if (!body && !rawAttachments.length) throw new HttpsError('invalid-argument', 'Message content is required.')

  const attachments = rawAttachments.map(sanitizeAttachment)
  attachments.forEach((attachment) => {
    const expectedPrefix = `threads/${threadId}/messages/${messageId}/attachments/`
    if (!attachment.storagePath.startsWith(expectedPrefix)) {
      throw new HttpsError('invalid-argument', 'Attachment does not belong to this message.')
    }
  })
  const replyTo = sanitizeReplyTo(request.data?.replyTo)
  const threadRef = db.collection('threads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc(messageId)
  const participantRef = threadRef.collection('participants').doc(uid)

  const result = await db.runTransaction(async (transaction) => {
    const [threadSnap, existingMessageSnap, participantSnap] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(messageRef),
      transaction.get(participantRef)
    ])
    if (!threadSnap.exists) throw new HttpsError('not-found', 'Conversation not found.')
    const thread = threadSnap.data() || {}
    const participantUids = getThreadParticipantUids(thread)
    if (!participantUids.includes(uid)) {
      throw new HttpsError('permission-denied', 'You are not a participant in this conversation.')
    }
    if (thread.status === 'archived') throw new HttpsError('failed-precondition', 'This conversation is archived.')
    if (thread.type === 'dm' && thread.dmBlockState) {
      throw new HttpsError('failed-precondition', 'This conversation is blocked.')
    }
    if (existingMessageSnap.exists) {
      const existing = existingMessageSnap.data() || {}
      if (existing.senderId !== uid || !clientMessageId || existing.clientMessageId !== clientMessageId) {
        throw new HttpsError('already-exists', 'Message ID is already in use.')
      }
      return { duplicate: true, participantUids }
    }

    const summary = body || (attachments.length === 1 ? `1 ${attachments[0].type || 'attachment'}` : `${attachments.length} attachments`)
    const type = attachments.length
      ? (attachments.length === 1 && !body ? ['image', 'video', 'audio'].includes(attachments[0].type) ? attachments[0].type : 'file' : 'attachment')
      : 'text'
    const message = {
      senderId: uid,
      senderUid: uid,
      senderType: 'user',
      body,
      type,
      metadata: {},
      attachments,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
      edited: false,
      ...(clientMessageId ? { clientMessageId } : {}),
      ...(replyTo ? { replyTo } : {})
    }
    transaction.set(messageRef, message)
    transaction.set(threadRef, {
      participantIds: participantUids,
      participantUids,
      memberUids: participantUids,
      participantCount: participantUids.length,
      ownerUid: thread.ownerUid || thread.createdBy || '',
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: summary,
      lastMessageSenderId: uid,
      lastMessageType: type,
      lastMessageAttachmentCount: attachments.length
    }, { merge: true })
    transaction.set(participantRef, {
      uid,
      role: (thread.ownerUid || thread.createdBy) === uid ? 'owner' : 'member',
      ...(participantSnap.exists ? {} : { joinedAt: FieldValue.serverTimestamp() }),
      lastDeliveredAt: FieldValue.serverTimestamp(),
      lastReadAt: FieldValue.serverTimestamp(),
      muted: false,
      archived: false
    }, { merge: true })
    return { duplicate: false, participantUids }
  })

  return {
    ok: true,
    threadId,
    messageId,
    clientMessageId,
    duplicate: result.duplicate
  }
})

module.exports = { sendInboxMessage }
