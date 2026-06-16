const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { getStorage } = require('firebase-admin/storage')
const { assertAdmin, assertPermission } = require('../admin/adminAuth')
const { DEFAULT_SETTINGS, mergeSettings } = require('../admin/adminSettingsShared')
const {
  SUPPORT_AI_API_KEY,
  SUPPORT_AI_MODEL,
  DEFAULT_SUPPORT_KNOWLEDGE,
  detectEscalationNeed,
  generateSupportReply
} = require('./aiSupportAgent')
const { createGuidanceOverlayFromIntent, loadActiveGuidanceContext } = require('./siteGuidance')
const {
  assertString,
  buildInboxSummaryPayload,
  buildParticipantPayload,
  getThreadParticipantUids
} = require('../messages/helpers')

const db = getFirestore()
const RESONA_AGENT_ID = 'resona'
const RESONA_AVATAR_PATH = 'assets/profilePictures/aiSupport/resona.png'
const MAX_BODY_LENGTH = 1200
const AI_IMAGE_ATTACHMENT_LIMIT = 4
const AI_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const AI_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const CALLABLE_OPTIONS = {
  timeoutSeconds: 30,
  memory: '256MiB',
  cors: true,
  invoker: 'public'
}

function resonaThreadIdFor(uid = '') {
  return `resona_${uid}`
}

function assertSignedIn(request = {}) {
  const uid = assertString(request.auth?.uid || request.context?.auth?.uid || '')
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function cleanBody(value = '', max = MAX_BODY_LENGTH) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .trim()
    .slice(0, max)
}

function cleanPromptText(value = '', max = 4000) {
  return cleanBody(value, max)
}

function serializeDate(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function serializeThread(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: docSnap.id,
    type: data.type || 'agent',
    agentId: data.agentId || RESONA_AGENT_ID,
    requesterUid: data.requesterUid || '',
    participantUids: getThreadParticipantUids(data),
    assignedAgentUid: data.assignedAgentUid || null,
    status: data.status || 'ai_active',
    mode: data.mode || 'general',
    source: data.source || 'inbox_resona',
    title: data.title || 'Resona',
    imagePath: data.imagePath || RESONA_AVATAR_PATH,
    imageURL: data.imageURL || '',
    lastMessageText: data.lastMessageText || '',
    lastMessagePreview: data.lastMessagePreview || data.lastMessageText || '',
    lastMessageAt: serializeDate(data.lastMessageAt),
    updatedAt: serializeDate(data.updatedAt),
    createdAt: serializeDate(data.createdAt),
    clearedAt: serializeDate(data.clearedAt),
    clearedBy: data.clearedBy || '',
    aiEscalationReason: data.aiEscalationReason || '',
    aiSuggestedCategory: data.aiSuggestedCategory || '',
    agentParticipants: data.agentParticipants || {}
  }
}

function safeIdPart(value = '') {
  return assertString(value)
    .replace(/[/.#[\]\s]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 140) || 'item'
}

function serializeMessage(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: docSnap.id,
    senderUid: data.senderUid || data.senderId || '',
    senderId: data.senderId || data.senderUid || '',
    senderType: data.senderType || 'system',
    agentId: data.agentId || '',
    body: data.body || '',
    type: data.type || 'text',
    createdAt: serializeDate(data.createdAt),
    attachments: Array.isArray(data.attachments) ? data.attachments : [],
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {}
  }
}

function safeAttachmentName(value = '') {
  return assertString(value || 'Attachment').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Attachment'
}

function normalizeAttachmentForAi(raw = {}, threadId = '', messageId = '') {
  const storagePath = assertString(raw.storagePath || '')
  const mimeType = assertString(raw.mimeType || '').toLowerCase().slice(0, 120)
  const size = Math.max(0, Number(raw.size || 0))
  const expectedPrefix = `threads/${threadId}/messages/${messageId}/attachments/`
  const base = {
    name: safeAttachmentName(raw.name || ''),
    type: assertString(raw.type || '').slice(0, 24) || (mimeType.split('/')[0] || 'file'),
    mimeType,
    size,
    storagePath: storagePath.slice(0, 600),
    aiReadable: false,
    aiLimitation: 'metadata only'
  }
  if (!storagePath || !storagePath.startsWith(expectedPrefix) || storagePath.includes('../')) {
    return { ...base, storagePath: '', aiLimitation: 'storage path unavailable or invalid' }
  }
  if (!AI_IMAGE_MIME_TYPES.has(mimeType)) {
    return { ...base, aiLimitation: mimeType.startsWith('image/') ? 'unsupported image type' : 'metadata only for this file type' }
  }
  if (size > AI_IMAGE_ATTACHMENT_MAX_BYTES) {
    return { ...base, aiLimitation: 'image is too large for AI inspection' }
  }
  return { ...base, aiReadable: true, aiLimitation: '' }
}

async function buildAiAttachmentInputs({ threadId = '', messageId = '', attachments = [] } = {}) {
  const normalized = Array.isArray(attachments)
    ? attachments.slice(0, 8).map((attachment) => normalizeAttachmentForAi(attachment, threadId, messageId))
    : []
  const imageCandidates = normalized.filter((attachment) => attachment.aiReadable).slice(0, AI_IMAGE_ATTACHMENT_LIMIT)
  const imageParts = []
  for (const attachment of imageCandidates) {
    try {
      const [buffer] = await getStorage().bucket().file(attachment.storagePath).download()
      if (!buffer?.length || buffer.length > AI_IMAGE_ATTACHMENT_MAX_BYTES) continue
      imageParts.push({
        inline_data: {
          mime_type: attachment.mimeType,
          data: buffer.toString('base64')
        }
      })
    } catch (error) {
      attachment.aiReadable = false
      attachment.aiLimitation = `image download failed: ${assertString(error?.message || 'unknown').slice(0, 120)}`
    }
  }
  return {
    attachmentContext: normalized,
    attachmentImageParts: imageParts
  }
}

async function addSystemMessage(transaction, threadRef, body = '', metadata = {}) {
  transaction.set(threadRef.collection('messages').doc(), {
    senderId: 'system',
    senderUid: '',
    senderType: 'system',
    body: cleanBody(body),
    type: 'system',
    attachments: [],
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    deleted: false,
    edited: false,
    metadata
  })
}

async function loadProfileSummary(uid = '') {
  if (!uid) return null
  const [profileSnap, userSnap] = await Promise.all([
    db.collection('profiles').doc(uid).get().catch(() => null),
    db.collection('users').doc(uid).get().catch(() => null)
  ])
  const profile = profileSnap?.exists ? profileSnap.data() || {} : {}
  const user = userSnap?.exists ? userSnap.data() || {} : {}
  return {
    uid,
    displayName: assertString(profile.displayName || user.displayName || profile.name || user.name || '').slice(0, 160),
    username: assertString(profile.username || user.username || '').slice(0, 120),
    role: assertString(user.role || profile.role || user.accountType || 'user').slice(0, 80),
    avatarURL: assertString(profile.avatarURL || profile.photoURL || user.photoURL || '').slice(0, 2000)
  }
}

async function loadSupportKnowledgeSnippets() {
  try {
    const snapshot = await db.collection('supportKnowledge')
      .where('active', '==', true)
      .where('visibility', '==', 'public')
      .limit(12)
      .get()
    const docs = snapshot.docs.map((docSnap) => {
      const data = docSnap.data() || {}
      return {
        id: docSnap.id,
        title: assertString(data.title || '').slice(0, 180),
        category: assertString(data.category || '').slice(0, 80),
        body: assertString(data.body || '').slice(0, 1200),
        tags: Array.isArray(data.tags) ? data.tags.map((tag) => assertString(tag).slice(0, 60)).filter(Boolean).slice(0, 12) : []
      }
    }).filter((item) => item.title && item.body)
    return docs.length ? docs : DEFAULT_SUPPORT_KNOWLEDGE
  } catch {
    return DEFAULT_SUPPORT_KNOWLEDGE
  }
}

async function loadResonaInstructions() {
  try {
    const snap = await db.collection('platformConfig').doc('current').get()
    const settings = mergeSettings(snap.exists ? snap.data() || {} : {})
    const supportAi = settings.supportAi || DEFAULT_SETTINGS.supportAi || {}
    return {
      systemBehavior: cleanPromptText(supportAi.systemBehavior || DEFAULT_SETTINGS.supportAi.systemBehavior, 8000),
      siteOverview: cleanPromptText(supportAi.siteOverview || DEFAULT_SETTINGS.supportAi.siteOverview, 4000),
      escalationRules: cleanPromptText(supportAi.escalationRules || DEFAULT_SETTINGS.supportAi.escalationRules, 4000),
      restrictedActions: cleanPromptText(supportAi.restrictedActions || DEFAULT_SETTINGS.supportAi.restrictedActions, 4000),
      toneGuidelines: cleanPromptText(supportAi.toneGuidelines || DEFAULT_SETTINGS.supportAi.toneGuidelines, 4000),
      resonaWebGroundingEnabled: supportAi.resonaWebGroundingEnabled !== false,
      resonaWebGroundingBehavior: assertString(supportAi.resonaWebGroundingBehavior || DEFAULT_SETTINGS.supportAi.resonaWebGroundingBehavior || 'auto').slice(0, 40)
    }
  } catch {
    return DEFAULT_SETTINGS.supportAi
  }
}

async function loadRecentMessages(threadRef, clearedAt = null) {
  let query = threadRef.collection('messages').orderBy('createdAt', 'desc').limit(24)
  const snapshot = await query.get()
  const clearedMillis = clearedAt?.toMillis?.() || (clearedAt ? new Date(clearedAt).getTime() : 0)
  return snapshot.docs
    .map(serializeMessage)
    .filter((message) => {
      if (!clearedMillis) return true
      const created = message.createdAt ? new Date(message.createdAt).getTime() : 0
      return created > clearedMillis
    })
    .slice(0, 12)
    .reverse()
}

function shouldInvokeResona(thread = {}, message = {}) {
  const body = cleanBody(message.body || '')
  const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
  const isResonaThread = thread.type === 'agent' && thread.agentId === RESONA_AGENT_ID
  if (isResonaThread) return true
  const resonaParticipant = thread.agentParticipants?.resona || {}
  if (resonaParticipant.active !== true) return false
  if (metadata.invokeAgent === RESONA_AGENT_ID) return true
  return /(^|\s)@resona\b/i.test(body)
}

async function setResonaTyping(threadRef, active = false) {
  const typingRef = threadRef.collection('typing').doc(RESONA_AGENT_ID)
  if (active) {
    await typingRef.set({
      uid: RESONA_AGENT_ID,
      displayName: 'Resona',
      username: 'AI',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    return
  }
  await typingRef.delete().catch(() => {})
}

async function loadReadableResonaMessage({ uid = '', threadId = '', messageId = '' } = {}) {
  if (!uid || !threadId || !messageId) throw new HttpsError('invalid-argument', 'Message is required.')
  const threadRef = db.collection('threads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc(messageId)
  const [threadSnap, messageSnap] = await Promise.all([threadRef.get(), messageRef.get()])
  if (!threadSnap.exists || !messageSnap.exists) throw new HttpsError('not-found', 'Message not found.')
  const thread = threadSnap.data() || {}
  if (!getThreadParticipantUids(thread).includes(uid)) throw new HttpsError('permission-denied', 'You do not have access to this conversation.')
  const message = messageSnap.data() || {}
  if (message.senderType !== 'ai' || message.agentId !== RESONA_AGENT_ID) {
    throw new HttpsError('failed-precondition', 'Only Resona messages can use this action.')
  }
  return { thread, message }
}

async function lockAiMessage(threadRef, messageId = '') {
  const messageRef = threadRef.collection('messages').doc(messageId)
  return db.runTransaction(async (transaction) => {
    const [threadSnap, messageSnap] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(messageRef)
    ])
    if (!threadSnap.exists || !messageSnap.exists) {
      return { locked: false, reason: 'missing' }
    }
    const thread = threadSnap.data() || {}
    const message = messageSnap.data() || {}
    const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
    if (metadata.resonaHandledAt || metadata.resonaHandlingStartedAt) {
      return { locked: false, reason: 'already_handled', thread, message }
    }
    if ((message.senderType || 'user') !== 'user' || !cleanBody(message.body || '')) {
      return { locked: false, reason: 'not_user_message', thread, message }
    }
    if (!shouldInvokeResona(thread, message)) {
      return { locked: false, reason: 'not_invoked', thread, message }
    }
    if (thread.status === 'assigned' || thread.assignedAgentUid) {
      return { locked: false, reason: 'live_agent_assigned', thread, message }
    }
    if (thread.status === 'waiting_for_agent') {
      return { locked: false, reason: 'waiting_for_agent', thread, message }
    }
    transaction.set(messageRef, {
      metadata: {
        ...metadata,
        resonaHandlingStartedAt: FieldValue.serverTimestamp()
      }
    }, { merge: true })
    transaction.set(threadRef, {
      updatedAt: FieldValue.serverTimestamp(),
      ...(thread.type === 'agent' ? { status: 'ai_active' } : {})
    }, { merge: true })
    return { locked: true, thread, message }
  })
}

async function writeResonaReply({ threadRef, threadId = '', messageId, thread, userMessage, aiResult }) {
  const replyText = cleanBody(aiResult.replyText || 'I’m routing this to a live Melogic support agent so they can review the details safely.')
  const aiMessageRef = threadRef.collection('messages').doc()
  const shouldEscalate = aiResult.shouldEscalate === true
  const statusBefore = cleanBody(thread.status || 'ai_active', 80)
  let statusAfter = statusBefore
  await db.runTransaction(async (transaction) => {
    transaction.set(aiMessageRef, {
      senderId: RESONA_AGENT_ID,
      senderUid: RESONA_AGENT_ID,
      senderType: 'ai',
      agentId: RESONA_AGENT_ID,
      body: replyText,
      type: 'text',
      attachments: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
      edited: false,
      metadata: {
        confidence: Number(aiResult.confidence || 0),
        modelUsed: aiResult.modelUsed || '',
        shouldEscalate,
        escalationReason: aiResult.escalationReason || '',
        webGrounding: aiResult.webGrounding && typeof aiResult.webGrounding === 'object' ? aiResult.webGrounding : null,
        source: 'resona_inbox'
      }
    })
    transaction.set(threadRef.collection('messages').doc(messageId), {
      metadata: {
        ...(userMessage.metadata && typeof userMessage.metadata === 'object' ? userMessage.metadata : {}),
        resonaHandledAt: FieldValue.serverTimestamp()
      }
    }, { merge: true })
    const threadUpdate = {
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: replyText,
      lastMessagePreview: replyText,
      lastMessageSenderId: RESONA_AGENT_ID,
      lastMessageType: 'text',
      lastMessageAttachmentCount: 0,
      aiEscalationReason: shouldEscalate ? (aiResult.escalationReason || 'support_needed') : '',
      aiSuggestedCategory: aiResult.suggestedCategory || ''
    }
    if (shouldEscalate) {
      threadUpdate.status = 'waiting_for_agent'
      statusAfter = 'waiting_for_agent'
      threadUpdate.mode = 'support'
      threadUpdate.assignedAgentUid = null
      threadUpdate.requesterUid = thread.requesterUid || getThreadParticipantUids(thread)[0] || ''
      addSystemMessage(transaction, threadRef, 'Resona requested a live support agent.', {
        event: 'resona_requested_live_agent',
        reason: aiResult.escalationReason || ''
      })
    } else if (thread.type === 'agent') {
      threadUpdate.status = 'ai_active'
      statusAfter = 'ai_active'
      threadUpdate.mode = 'general'
      threadUpdate.assignedAgentUid = null
    }
    transaction.set(threadRef, threadUpdate, { merge: true })
  })
  console.log('[resona-ai]', {
    threadId,
    userMessageId: messageId,
    escalationDecision: aiResult.escalationDecision || {
      shouldEscalate,
      escalationReason: aiResult.escalationReason || '',
      confidence: Number(aiResult.confidence || 0)
    },
    escalationReason: aiResult.escalationReason || '',
    statusBefore,
    statusAfter
  })
}

const createOrGetResonaThread = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = resonaThreadIdFor(uid)
  const threadRef = db.collection('threads').doc(threadId)

  const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (snap.exists) {
      const current = snap.data() || {}
      const participantUids = Array.from(new Set([...getThreadParticipantUids(current), uid].filter(Boolean)))
      const repaired = {
        type: 'agent',
        agentId: RESONA_AGENT_ID,
        title: 'Resona',
        imagePath: current.imagePath || RESONA_AVATAR_PATH,
        participantIds: participantUids,
        participantUids,
        memberUids: participantUids,
        participantCount: participantUids.length,
        requesterUid: current.requesterUid || uid,
        status: current.status || 'ai_active',
        mode: current.mode || 'general',
        source: current.source || 'inbox_resona',
        updatedAt: FieldValue.serverTimestamp()
      }
      transaction.set(threadRef, repaired, { merge: true })
      transaction.set(threadRef.collection('participants').doc(uid), buildParticipantPayload({ uid, role: 'owner' }), { merge: true })
      transaction.set(db.collection('users').doc(uid).collection('inboxThreads').doc(threadId), buildInboxSummaryPayload({
        threadId,
        thread: { ...current, ...repaired },
        recipientUid: uid
      }), { merge: true })
      transaction.set(db.collection('users').doc(uid).collection('inboxThreads').doc(threadId), {
        deleted: false,
        deletedAt: null,
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
      return { threadId, existing: true }
    }

    const participantUids = [uid]
    const payload = {
      type: 'agent',
      agentId: RESONA_AGENT_ID,
      createdBy: uid,
      ownerUid: uid,
      requesterUid: uid,
      assignedAgentUid: null,
      status: 'ai_active',
      mode: 'general',
      source: 'inbox_resona',
      title: 'Resona',
      imagePath: RESONA_AVATAR_PATH,
      imageURL: '',
      participantIds: participantUids,
      participantUids,
      memberUids: participantUids,
      participantCount: 1,
      lastMessageText: '',
      lastMessagePreview: '',
      lastMessageAt: null,
      lastMessageSenderId: '',
      lastMessageType: 'text',
      lastMessageAttachmentCount: 0,
      agentParticipants: {},
      aiEscalationReason: '',
      aiSuggestedCategory: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }
    transaction.set(threadRef, payload)
    transaction.set(threadRef.collection('participants').doc(uid), buildParticipantPayload({ uid, role: 'owner' }))
    transaction.set(db.collection('users').doc(uid).collection('inboxThreads').doc(threadId), buildInboxSummaryPayload({
      threadId,
      thread: payload,
      recipientUid: uid
    }))
    return { threadId, existing: false }
  })

  const snap = await threadRef.get()
  return { ok: true, ...result, thread: serializeThread(snap) }
})

const refreshResonaThread = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const requestedThreadId = assertString(request.data?.threadId || '')
  const threadId = requestedThreadId || resonaThreadIdFor(uid)
  if (threadId !== resonaThreadIdFor(uid)) throw new HttpsError('permission-denied', 'You can only refresh your Resona chat.')
  const threadRef = db.collection('threads').doc(threadId)

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona chat not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID || thread.requesterUid !== uid) {
      throw new HttpsError('permission-denied', 'You can only refresh your Resona chat.')
    }
    transaction.set(threadRef, {
      status: 'ai_active',
      mode: 'general',
      assignedAgentUid: null,
      aiEscalationReason: '',
      aiSuggestedCategory: '',
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: 'Resona chat refreshed.',
      lastMessagePreview: 'Resona chat refreshed.',
      lastMessageSenderId: 'system',
      lastMessageType: 'system',
      lastMessageAttachmentCount: 0
    }, { merge: true })
    addSystemMessage(transaction, threadRef, 'Resona chat refreshed.', { event: 'resona_refreshed', actorUid: uid })
  })
  await setResonaTyping(threadRef, false)
  return { ok: true, threadId }
})

const clearResonaChatHistory = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = cleanBody(request.data?.threadId || resonaThreadIdFor(uid), 180)
  if (threadId !== resonaThreadIdFor(uid)) throw new HttpsError('permission-denied', 'You can only clear your own Resona history.')
  const threadRef = db.collection('threads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('failed-precondition', 'Only Resona history can be cleared here.')
    if (!getThreadParticipantUids(thread).includes(uid)) throw new HttpsError('permission-denied', 'You do not have access to this Resona thread.')
    transaction.set(threadRef, {
      clearedAt: FieldValue.serverTimestamp(),
      clearedBy: uid,
      mode: 'general',
      status: 'ai_active',
      assignedAgentUid: null,
      aiEscalationReason: '',
      aiSuggestedCategory: '',
      lastMessageText: '',
      lastMessagePreview: 'Ask Resona anything.',
      lastMessageSenderId: '',
      lastMessageType: 'text',
      lastMessageAttachmentCount: 0,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
  })
  await setResonaTyping(threadRef, false)
  return { ok: true, threadId }
})

const setThreadResonaAgent = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = assertString(request.data?.threadId || '')
  const active = request.data?.active === true
  if (!threadId) throw new HttpsError('invalid-argument', 'Conversation is required.')
  const threadRef = db.collection('threads').doc(threadId)

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Conversation not found.')
    const thread = snap.data() || {}
    if (thread.type === 'agent') throw new HttpsError('failed-precondition', 'Resona is already this conversation.')
    if (!getThreadParticipantUids(thread).includes(uid)) {
      throw new HttpsError('permission-denied', 'Only participants can update Resona for this conversation.')
    }
    const currentAgents = thread.agentParticipants && typeof thread.agentParticipants === 'object' ? thread.agentParticipants : {}
    const nextAgents = {
      ...currentAgents,
      resona: {
        active,
        addedBy: active ? uid : (currentAgents.resona?.addedBy || uid),
        addedAt: active ? FieldValue.serverTimestamp() : (currentAgents.resona?.addedAt || null),
        mode: 'mention_only'
      }
    }
    transaction.set(threadRef, {
      agentParticipants: nextAgents,
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    addSystemMessage(transaction, threadRef, active ? 'Resona was added to this chat.' : 'Resona was removed from this chat.', {
      event: active ? 'resona_added_to_thread' : 'resona_removed_from_thread',
      actorUid: uid
    })
  })

  return { ok: true, threadId, active }
})

const setResonaMessageFeedback = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = assertString(request.data?.threadId || '')
  const messageId = assertString(request.data?.messageId || '')
  const value = assertString(request.data?.value || '')
  if (!['like', 'dislike', 'clear'].includes(value)) throw new HttpsError('invalid-argument', 'Feedback value is invalid.')
  await loadReadableResonaMessage({ uid, threadId, messageId })
  const feedbackId = `${safeIdPart(threadId)}_${safeIdPart(messageId)}_${safeIdPart(uid)}`
  const feedbackRef = db.collection('aiMessageFeedback').doc(feedbackId)
  if (value === 'clear') {
    await feedbackRef.delete().catch(() => null)
    return { ok: true, threadId, messageId, value: '' }
  }
  await feedbackRef.set({
    feedbackId,
    threadId,
    messageId,
    userUid: uid,
    agentId: RESONA_AGENT_ID,
    value,
    source: 'resona_message',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })
  return { ok: true, threadId, messageId, value }
})

const reportResonaMessage = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = assertString(request.data?.threadId || '')
  const messageId = assertString(request.data?.messageId || '')
  const reason = assertString(request.data?.reason || 'Other').slice(0, 160) || 'Other'
  const description = assertString(request.data?.description || 'Reported Resona message').slice(0, 2000) || 'Reported Resona message'
  const { message } = await loadReadableResonaMessage({ uid, threadId, messageId })
  const reportId = `resona_message_${safeIdPart(threadId)}_${safeIdPart(messageId)}_${safeIdPart(uid)}`
  const reportRef = db.collection('reports').doc(reportId)
  const duplicateSnap = await reportRef.get()
  if (duplicateSnap.exists) return { ok: true, duplicate: true, reportId, status: duplicateSnap.data()?.status || 'open' }
  await reportRef.set({
    reportId,
    type: 'resona_message',
    targetType: 'resona_message',
    targetId: messageId,
    targetOwnerUid: RESONA_AGENT_ID,
    reporterUid: uid,
    reason,
    description,
    status: 'open',
    priority: 'normal',
    sourcePath: `/inbox/messages?thread=${encodeURIComponent(threadId)}`,
    metadata: {
      source: 'resona_message',
      threadId,
      messageId,
      agentId: RESONA_AGENT_ID,
      messagePreview: cleanBody(message.body || '', 500)
    },
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    assignedTo: '',
    resolvedAt: null,
    resolvedBy: '',
    resolution: '',
    adminNotes: ''
  })
  return { ok: true, duplicate: false, reportId, status: 'open' }
})

const getResonaAiStats = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 60 }, async (request) => {
  assertAdmin(request)
  const threadLimit = 200
  const threadSnap = await db.collection('threads')
    .where('type', '==', 'agent')
    .where('agentId', '==', RESONA_AGENT_ID)
    .limit(threadLimit)
    .get()
  const threads = threadSnap.docs.map((docSnap) => ({ id: docSnap.id, data: docSnap.data() || {} }))
  let totalMessages = 0
  let totalUserMessages = 0
  let totalAiReplies = 0
  let lastActivityMillis = 0
  for (const row of threads) {
    const messagesSnap = await db.collection('threads').doc(row.id).collection('messages').limit(500).get()
    totalMessages += messagesSnap.size
    messagesSnap.docs.forEach((messageDoc) => {
      const message = messageDoc.data() || {}
      if (message.senderType === 'user') totalUserMessages += 1
      if (message.senderType === 'ai' && message.agentId === RESONA_AGENT_ID) totalAiReplies += 1
    })
    const updated = row.data.updatedAt?.toMillis?.() || row.data.lastMessageAt?.toMillis?.() || 0
    if (updated > lastActivityMillis) lastActivityMillis = updated
  }
  const waitingForAgent = threads.filter((row) => row.data.status === 'waiting_for_agent').length
  const assigned = threads.filter((row) => row.data.status === 'assigned').length
  const escalated = threads.filter((row) => row.data.aiEscalationReason || ['waiting_for_agent', 'assigned'].includes(row.data.status)).length
  const feedbackSnap = await db.collection('aiMessageFeedback').where('agentId', '==', RESONA_AGENT_ID).limit(500).get().catch(() => ({ size: 0 }))
  const reportsSnap = await db.collection('reports').where('targetType', '==', 'resona_message').limit(500).get().catch(() => ({ size: 0 }))
  return {
    ok: true,
    stats: {
      totalConversations: threads.length,
      totalMessages,
      totalUserMessages,
      totalAiReplies,
      waitingForAgent,
      assigned,
      escalated,
      feedbackCount: feedbackSnap.size || 0,
      reportCount: reportsSnap.size || 0,
      lastActivityAt: lastActivityMillis ? new Date(lastActivityMillis).toISOString() : null,
      model: SUPPORT_AI_MODEL.value(),
      aiEnabled: true,
      sampledThreadLimit: threadLimit,
      sampledMessageLimitPerThread: 500,
      truncated: threadSnap.size >= threadLimit
    }
  }
})

const handleResonaInboxReply = onDocumentCreated({
  document: 'threads/{threadId}/messages/{messageId}',
  secrets: [SUPPORT_AI_API_KEY],
  timeoutSeconds: 90,
  memory: '256MiB'
}, async (event) => {
  const message = event.data?.data() || {}
  if ((message.senderType || 'user') !== 'user') return
  const threadId = assertString(event.params?.threadId || '')
  const messageId = assertString(event.params?.messageId || '')
  if (!threadId || !messageId) return
  const threadRef = db.collection('threads').doc(threadId)
  const lock = await lockAiMessage(threadRef, messageId)
  if (!lock.locked) return

  await setResonaTyping(threadRef, true)
  try {
    const [recentMessages, knowledgeSnippets, resonaInstructions, requester] = await Promise.all([
      loadRecentMessages(threadRef, lock.thread.clearedAt),
      loadSupportKnowledgeSnippets(),
      loadResonaInstructions(),
      loadProfileSummary(lock.thread.requesterUid || message.senderId || message.senderUid || '')
    ])
    const guidanceContext = await loadActiveGuidanceContext({
      threadId,
      userUid: lock.thread.requesterUid || message.senderId || message.senderUid || ''
    })
    const inlinePageContext = message.metadata?.safePageContext || {}
    const safePageContext = {
      ...(guidanceContext || {}),
      ...(inlinePageContext || {}),
      visibleGuideTargets: inlinePageContext.visibleGuideTargets || guidanceContext?.visibleGuideTargets || guidanceContext?.landmarks || [],
      landmarks: inlinePageContext.landmarks || inlinePageContext.visibleGuideTargets || guidanceContext?.landmarks || guidanceContext?.visibleGuideTargets || [],
      pageSnapshot: inlinePageContext.pageSnapshot || guidanceContext?.pageSnapshot || null
    }
    const aiAttachmentInputs = await buildAiAttachmentInputs({
      threadId,
      messageId,
      attachments: Array.isArray(message.attachments) ? message.attachments : []
    })
    const explicitEscalation = detectEscalationNeed(message.body || '')
    const aiResult = explicitEscalation.shouldEscalate
      ? {
          replyText: 'I’m routing this to a live Melogic support agent so they can review the details safely.',
          confidence: 1,
          shouldEscalate: true,
          escalationReason: explicitEscalation.reason,
          escalationDecision: {
            shouldEscalate: true,
            escalationReason: explicitEscalation.reason,
            confidence: 1
          },
          suggestedCategory: explicitEscalation.reason
        }
      : await generateSupportReply({
          apiKey: SUPPORT_AI_API_KEY.value(),
          model: SUPPORT_AI_MODEL.value(),
          thread: lock.thread,
          userMessage: message.body || '',
          recentMessages,
          knowledgeSnippets,
          resonaInstructions,
          safeUserContext: requester || {},
          safePageContext,
          attachmentContext: aiAttachmentInputs.attachmentContext,
          attachmentImageParts: aiAttachmentInputs.attachmentImageParts
        })
    await writeResonaReply({
      threadRef,
      threadId,
      messageId,
      thread: lock.thread,
      userMessage: message,
      aiResult
    })
    if (aiResult?.highlightIntent && safePageContext?.sessionId) {
      await createGuidanceOverlayFromIntent({
        sessionId: safePageContext.sessionId,
        intent: aiResult.highlightIntent,
        landmarks: safePageContext.visibleGuideTargets || safePageContext.landmarks || [],
        threadId,
        sourceUserMessageId: messageId,
        actionIndex: 0
      }).catch((error) => {
        console.warn('[resona-guidance] highlight failed', {
          threadId,
          messageId,
          message: error?.message || 'unknown'
        })
      })
    }
  } finally {
    await setResonaTyping(threadRef, false)
  }
})

async function listEscalatedResonaThreads({ status = 'active', limitCount = 50 } = {}) {
  let query = db.collection('threads')
  if (status === 'active') query = query.where('status', 'in', ['waiting_for_agent', 'assigned'])
  else if (status === 'all') query = query.where('status', 'in', ['ai_active', 'waiting_for_agent', 'assigned', 'resolved'])
  else query = query.where('status', '==', status)
  const snapshot = await query.limit(Math.max(1, Math.min(Number(limitCount || 50), 100))).get()
  const rows = await Promise.all(snapshot.docs.map(async (docSnap) => {
    const thread = serializeThread(docSnap)
    const requester = await loadProfileSummary(thread.requesterUid)
    return {
      ...thread,
      type: 'resona',
      subject: 'Resona',
      priority: 'normal',
      requester,
      requesterUid: thread.requesterUid,
      humanRequested: ['waiting_for_agent', 'assigned'].includes(thread.status),
      lastMessagePreview: thread.lastMessagePreview || thread.lastMessageText,
      aiRoutedToAgent: ['waiting_for_agent', 'assigned'].includes(thread.status)
    }
  }))
  return rows
    .filter((thread) => thread.id.startsWith('resona_'))
    .filter((thread) => {
      if (status === 'all') return true
      if (status === 'active') return ['waiting_for_agent', 'assigned'].includes(thread.status)
      return thread.status === status
    })
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
}

async function listResonaMessagesForSupport({ request, threadId = '' }) {
  const uid = assertSignedIn(request)
  const staff = (() => {
    try {
      assertPermission(request, 'orderSupport')
      return true
    } catch {
      return false
    }
  })()
  const threadRef = db.collection('threads').doc(threadId)
  const threadSnap = await threadRef.get()
  if (!threadSnap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
  const thread = threadSnap.data() || {}
  if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
  if (!staff && !getThreadParticipantUids(thread).includes(uid)) throw new HttpsError('permission-denied', 'You do not have access to this thread.')
  const snapshot = await threadRef.collection('messages').orderBy('createdAt', 'asc').limit(100).get()
  return { ok: true, messages: snapshot.docs.map(serializeMessage) }
}

async function claimResonaThread({ request, threadId = '' }) {
  const claims = assertPermission(request, 'orderSupport')
  const threadRef = db.collection('threads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
    transaction.set(threadRef, {
      assignedAgentUid: claims.uid,
      status: 'assigned',
      mode: 'live_agent_joined',
      participantIds: FieldValue.arrayUnion(claims.uid),
      participantUids: FieldValue.arrayUnion(claims.uid),
      memberUids: FieldValue.arrayUnion(claims.uid),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: 'A live agent joined the chat.',
      lastMessagePreview: 'A live agent joined the chat.',
      lastMessageSenderId: 'system',
      lastMessageType: 'system'
    }, { merge: true })
    transaction.set(threadRef.collection('participants').doc(claims.uid), buildParticipantPayload({ uid: claims.uid, role: 'support' }), { merge: true })
    addSystemMessage(transaction, threadRef, 'A live agent joined the chat.', { event: 'live_agent_joined', agentUid: claims.uid })
  })
  await setResonaTyping(threadRef, false)
  return { ok: true, threadId }
}

async function resolveResonaThread({ request, threadId = '' }) {
  const claims = assertPermission(request, 'orderSupport')
  const threadRef = db.collection('threads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
    transaction.set(threadRef, {
      assignedAgentUid: null,
      status: 'ai_active',
      mode: 'general',
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: claims.uid,
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: 'Live support session resolved. Resona is active again.',
      lastMessagePreview: 'Live support session resolved. Resona is active again.',
      lastMessageSenderId: 'system',
      lastMessageType: 'system',
      aiEscalationReason: ''
    }, { merge: true })
    addSystemMessage(transaction, threadRef, 'Live support session resolved. Resona is active again.', {
      event: 'live_support_resolved',
      agentUid: claims.uid
    })
  })
  return { ok: true, threadId }
}

async function sendResonaSupportMessage({ request, threadId = '', body = '' }) {
  const claims = assertPermission(request, 'orderSupport')
  const clean = cleanBody(body)
  if (!clean) throw new HttpsError('invalid-argument', 'Message content is required.')
  const threadRef = db.collection('threads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc()
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
    transaction.set(messageRef, {
      senderId: claims.uid,
      senderUid: claims.uid,
      senderType: 'agent',
      body: clean,
      type: 'text',
      attachments: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
      edited: false,
      metadata: { source: 'admin_support_queue' }
    })
    transaction.set(threadRef, {
      assignedAgentUid: thread.assignedAgentUid || claims.uid,
      status: 'assigned',
      mode: 'live_agent_joined',
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: clean,
      lastMessagePreview: clean,
      lastMessageSenderId: claims.uid,
      lastMessageType: 'text',
      lastMessageAttachmentCount: 0
    }, { merge: true })
  })
  return { ok: true, threadId, messageId: messageRef.id }
}

module.exports = {
  RESONA_AGENT_ID,
  createOrGetResonaThread,
  refreshResonaThread,
  clearResonaChatHistory,
  setThreadResonaAgent,
  setResonaMessageFeedback,
  reportResonaMessage,
  getResonaAiStats,
  handleResonaInboxReply,
  listEscalatedResonaThreads,
  listResonaMessagesForSupport,
  claimResonaThread,
  resolveResonaThread,
  sendResonaSupportMessage,
  __test: {
    resonaThreadIdFor,
    shouldInvokeResona
  }
}
