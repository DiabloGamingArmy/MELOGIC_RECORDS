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

function getThreadParticipantUids(thread = {}) {
  const objectRows = [
    ...(Array.isArray(thread.participants) ? thread.participants : []),
    ...(Array.isArray(thread.members) ? thread.members : [])
  ]
  const ids = [
    ...(Array.isArray(thread.participantIds) ? thread.participantIds : []),
    ...(Array.isArray(thread.participantUids) ? thread.participantUids : []),
    ...(Array.isArray(thread.memberUids) ? thread.memberUids : []),
    ...objectRows.map((entry) => typeof entry === 'string' ? entry : entry?.uid),
    thread.ownerUid,
    thread.createdBy
  ]
  return Array.from(new Set(ids.map((uid) => assertString(uid)).filter(Boolean)))
}

function buildThreadPayload({ type, createdBy, title = '', participantIds = [], imagePath = '', imageURL = '', dmKey = '' }) {
  const canonicalParticipantIds = sanitizeParticipantIds(participantIds, createdBy)
  return {
    type,
    createdBy,
    ownerUid: createdBy,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    title: title || '',
    imagePath: imagePath || '',
    imageURL: imageURL || '',
    participantIds: canonicalParticipantIds,
    participantUids: canonicalParticipantIds,
    memberUids: canonicalParticipantIds,
    participantCount: canonicalParticipantIds.length,
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
    lastDeliveredAt: null,
    lastReadAt: null,
    muted: false,
    archived: false
  }
}

function buildInboxSummaryPayload({ threadId, thread, recipientUid }) {
  const participantIds = getThreadParticipantUids(thread)
  const otherParticipantIds = participantIds.filter((uid) => uid && uid !== recipientUid)
  return {
    threadId,
    type: thread.type,
    title: thread.title || '',
    imageURL: thread.imageURL || '',
    imagePath: thread.imagePath || '',
    participantIds,
    participantUids: participantIds,
    memberUids: participantIds,
    participantCount: Number(thread.participantCount || participantIds.length || 0),
    otherParticipantIds,
    lastMessageText: thread.lastMessageText || '',
    lastMessageAt: thread.lastMessageAt || null,
    lastMessageSenderId: thread.lastMessageSenderId || '',
    lastMessageType: thread.lastMessageType || 'text',
    lastMessageAttachmentCount: Number(thread.lastMessageAttachmentCount || 0),
    createdBy: thread.createdBy || '',
    ownerUid: thread.ownerUid || thread.createdBy || '',
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
  getThreadParticipantUids,
  buildThreadPayload,
  buildParticipantPayload,
  buildInboxSummaryPayload
}
