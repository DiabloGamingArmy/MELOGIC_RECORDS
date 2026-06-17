const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { assertString, getThreadParticipantUids } = require('./helpers')

const db = getFirestore()
const MAX_BODY_LENGTH = 1200
const MAX_ATTACHMENTS = 10

function cleanString(value = '', max = 200) {
  return assertString(value).replace(/\s+/g, ' ').trim().slice(0, max)
}

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

function sanitizeRect(raw = {}) {
  return {
    x: Math.round(Number(raw.x || 0)),
    y: Math.round(Number(raw.y || 0)),
    width: Math.max(0, Math.round(Number(raw.width || 0))),
    height: Math.max(0, Math.round(Number(raw.height || 0)))
  }
}

function sanitizePageSnapshot(raw = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return {
    type: cleanString(raw.type || 'safe_dom_page_snapshot', 80),
    captureKind: cleanString(raw.captureKind || 'structured_layout', 80),
    screenshotAvailable: raw.screenshotAvailable === true,
    captureTarget: cleanString(raw.captureTarget || '', 80),
    excluded: Array.isArray(raw.excluded) ? raw.excluded.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 12) : [],
    viewport: raw.viewport && typeof raw.viewport === 'object' ? {
      width: Number(raw.viewport.width || 0),
      height: Number(raw.viewport.height || 0)
    } : null,
    regions: Array.isArray(raw.regions) ? raw.regions.map((item) => ({
      id: cleanString(item.id || '', 120),
      label: cleanString(item.label || '', 120),
      role: cleanString(item.role || '', 60),
      text: cleanString(item.text || '', 180),
      rect: item.rect && typeof item.rect === 'object' ? sanitizeRect(item.rect) : null
    })).filter((item) => item.id || item.label || item.text).slice(0, 50) : []
  }
}

function sanitizeGuideTarget(item = {}) {
  return {
    guideId: cleanString(item.guideId || item.id || '', 120),
    id: cleanString(item.id || item.guideId || '', 120),
    label: cleanString(item.label || item.guideId || item.id || '', 120),
    role: cleanString(item.role || '', 60),
    text: cleanString(item.text || '', 180),
    visible: item.visible !== false,
    rect: item.rect && typeof item.rect === 'object' ? sanitizeRect(item.rect) : null
  }
}

function sanitizeContextValue(value, depth = 0) {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return cleanString(value, 240)
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    return value.slice(0, 24).map((item) => sanitizeContextValue(item, depth + 1)).filter((item) => item !== null)
  }
  if (typeof value === 'object' && depth < 3) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 24)
        .map(([key, item]) => [cleanString(key, 80), sanitizeContextValue(item, depth + 1)])
        .filter(([key, item]) => key && item !== null)
    )
  }
  return null
}

function sanitizeSafePageContext(raw = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return {
    contextSource: cleanString(raw.contextSource || '', 80),
    contextType: cleanString(raw.contextType || '', 80),
    contextId: cleanString(raw.contextId || '', 180),
    contextLabel: cleanString(raw.contextLabel || '', 140),
    guidanceSessionActive: raw.guidanceSessionActive === true,
    guidanceSessionStatus: cleanString(raw.guidanceSessionStatus || '', 40),
    guidanceSessionId: cleanString(raw.guidanceSessionId || raw.sessionId || '', 180),
    sessionId: cleanString(raw.sessionId || raw.guidanceSessionId || '', 180),
    shareMode: cleanString(raw.shareMode || '', 40),
    route: cleanString(raw.route || raw.currentRoute || '', 240),
    currentRoute: cleanString(raw.currentRoute || raw.route || '', 240),
    routeLabel: cleanString(raw.routeLabel || '', 120),
    pageTitle: cleanString(raw.pageTitle || '', 200),
    featureArea: cleanString(raw.featureArea || '', 120),
    activeModal: cleanString(raw.activeModal || '', 120),
    clientTimeZone: cleanString(raw.clientTimeZone || raw.timeZone || '', 80),
    clientLocalTimeISO: cleanString(raw.clientLocalTimeISO || '', 80),
    utcTimeISO: cleanString(raw.utcTimeISO || '', 80),
    viewport: raw.viewport && typeof raw.viewport === 'object' ? {
      width: Number(raw.viewport.width || 0),
      height: Number(raw.viewport.height || 0)
    } : null,
    scroll: raw.scroll && typeof raw.scroll === 'object' ? {
      x: Number(raw.scroll.x || 0),
      y: Number(raw.scroll.y || 0)
    } : null,
    visibleGuideTargets: Array.isArray(raw.visibleGuideTargets) ? raw.visibleGuideTargets.map(sanitizeGuideTarget).slice(0, 120) : [],
    landmarks: Array.isArray(raw.landmarks) ? raw.landmarks.map(sanitizeGuideTarget).slice(0, 120) : [],
    pageSnapshot: sanitizePageSnapshot(raw.pageSnapshot),
    dawContext: sanitizeContextValue(raw.dawContext),
    stageContext: sanitizeContextValue(raw.stageContext),
    productId: cleanString(raw.productId || '', 180),
    productTitle: cleanString(raw.productTitle || '', 200)
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
  const safePageContext = sanitizeSafePageContext(request.data?.safePageContext)
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
      metadata: safePageContext ? { safePageContext } : {},
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
