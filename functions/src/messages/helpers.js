const { FieldValue } = require('firebase-admin/firestore')

function assertString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function makeDmKey(uidA, uidB) {
  return [uidA, uidB].filter(Boolean).sort().join('_')
}

function sanitizeParticipantIds(participantIds = [], callerUid = '') {
  const source = Array.isArray(participantIds) ? participantIds : []
  return Array.from(
    new Set(
      source
        .map((uid) => assertString(uid))
        .concat(assertString(callerUid))
        .filter(Boolean)
    )
  )
}

function buildThreadPayload({ type, createdBy, title = '', participantIds = [], imagePath = '', imageURL = '', dmKey = '' }) {
  return {
    type,
    createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    title: title || '',
    imagePath: imagePath || '',
    imageURL: imageURL || '',
    participantIds,
    participantCount: participantIds.length,
    lastMessageText: '',
    lastMessageAt: null,
    lastMessageSenderId: '',
    lastMessageType: 'text',
    status: 'active',
    dmKey: dmKey || ''
  }
}

function buildParticipantPayload({ uid, role = 'member' }) {
  return {
    uid,
    role,
    joinedAt: FieldValue.serverTimestamp(),
    lastReadAt: null,
    muted: false,
    archived: false
  }
}

function buildInboxSummaryPayload({ threadId, thread, recipientUid }) {
  const participantIds = Array.isArray(thread.participantIds) ? thread.participantIds : []
  const otherParticipantIds = participantIds.filter((uid) => uid && uid !== recipientUid)
  return {
    threadId,
    type: thread.type,
    title: thread.title || '',
    imageURL: thread.imageURL || '',
    imagePath: thread.imagePath || '',
    participantIds,
    participantCount: Number(thread.participantCount || participantIds.length || 0),
    otherParticipantIds,
    lastMessageText: thread.lastMessageText || '',
    lastMessageAt: thread.lastMessageAt || null,
    lastMessageSenderId: thread.lastMessageSenderId || '',
    lastMessageType: thread.lastMessageType || 'text',
    createdBy: thread.createdBy || '',
    createdAt: thread.createdAt || FieldValue.serverTimestamp(),
    status: thread.status || 'active',
    unreadCount: 0,
    updatedAt: thread.updatedAt || FieldValue.serverTimestamp()
  }
}

module.exports = {
  assertString,
  makeDmKey,
  sanitizeParticipantIds,
  buildThreadPayload,
  buildParticipantPayload,
  buildInboxSummaryPayload
}
