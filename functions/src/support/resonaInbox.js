const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { getAuth } = require('firebase-admin/auth')
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore')
const { getDatabase } = require('firebase-admin/database')
const { getStorage } = require('firebase-admin/storage')
const { assertAdmin, assertPermission } = require('../admin/adminAuth')
const { DEFAULT_SETTINGS, mergeSettings } = require('../admin/adminSettingsShared')
const {
  SUPPORT_AI_API_KEY,
  SUPPORT_AI_MODEL,
  DEFAULT_SUPPORT_KNOWLEDGE,
  detectEscalationNeed,
  generateSupportReply,
  webGroundingDecision
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
const RESONA_SUPPORT_AVATAR_PATH = 'assets/profilePictures/staff/supportAgentResona.png'
const MAX_BODY_LENGTH = 1200
const RESONA_ACTIVITY_TTL_MS = 90 * 1000
const AI_IMAGE_ATTACHMENT_LIMIT = 4
const AI_IMAGE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024
const AI_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif'])
const CALLABLE_OPTIONS = {
  timeoutSeconds: 30,
  memory: '256MiB',
  cors: true,
  invoker: 'public'
}

const RESONA_ACTIVITY_LABELS = {
  thinking: 'Resona is thinking...',
  researching: 'Resona is doing research...',
  reading_attachments: 'Resona is reading attachments...',
  checking_page: 'Resona is checking this page...',
  writing: 'Resona is writing...'
}

function normalizeResonaContext(raw = {}) {
  const contextType = ['studio_daw', 'stagemaker'].includes(assertString(raw.contextType || ''))
    ? assertString(raw.contextType || '')
    : 'inbox'
  const contextId = contextType === 'inbox' ? '' : safeIdPart(raw.contextId || raw.projectId || raw.sessionId || '')
  return {
    contextType,
    contextId,
    contextLabel: assertString(raw.contextLabel || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  }
}

function resonaThreadIdFor(uid = '', context = {}) {
  const scoped = normalizeResonaContext(context)
  if (scoped.contextType === 'inbox') return `resona_${uid}`
  return `resona_${safeIdPart(uid)}_${scoped.contextType}_${safeIdPart(scoped.contextId)}`
}

async function assertContextAccess({ uid = '', contextType = 'inbox', contextId = '' } = {}) {
  if (contextType === 'inbox') return
  if (!contextId) throw new HttpsError('invalid-argument', 'Project context is required for scoped Resona.')
  const collectionName = contextType === 'studio_daw' ? 'studioProjects' : 'stageProjects'
  const snap = await db.collection(collectionName).doc(contextId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Project context not found.')
  const project = snap.data() || {}
  const collaboratorIds = Array.isArray(project.collaboratorIds) ? project.collaboratorIds : []
  if (project.ownerId !== uid && project.ownerUid !== uid && !collaboratorIds.includes(uid)) {
    throw new HttpsError('permission-denied', 'You do not have access to this project context.')
  }
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

function normalizeAgentFirstName(value = '', fallback = 'Support') {
  const letters = assertString(value || '').trim()
  if (!/^[A-Za-z]{1,50}$/.test(letters)) return fallback
  return `${letters.charAt(0).toUpperCase()}${letters.slice(1).toLowerCase()}`
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
    assignedAgentFirstName: data.assignedAgentFirstName || '',
    assignedAgentAvatarPath: data.assignedAgentAvatarPath || '',
    status: data.status || 'ai_active',
    mode: data.mode || 'general',
    source: data.source || 'inbox_resona',
    contextType: data.contextType || 'inbox',
    contextId: data.contextId || '',
    contextLabel: data.contextLabel || '',
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
    senderDisplayName: data.senderDisplayName || data.senderFirstName || data.metadata?.agentFirstName || '',
    senderFirstName: data.senderFirstName || data.metadata?.agentFirstName || '',
    avatarPath: data.avatarPath || data.metadata?.avatarPath || '',
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
  const [profileSnap, userSnap, authUser] = await Promise.all([
    db.collection('profiles').doc(uid).get().catch(() => null),
    db.collection('users').doc(uid).get().catch(() => null),
    getAuth().getUser(uid).catch(() => null)
  ])
  const profile = profileSnap?.exists ? profileSnap.data() || {} : {}
  const user = userSnap?.exists ? userSnap.data() || {} : {}
  return {
    uid,
    firstName: assertString(user.firstName || '').slice(0, 50),
    lastName: assertString(user.lastName || '').slice(0, 50),
    displayName: assertString(profile.displayName || user.displayName || profile.name || user.name || authUser?.displayName || '').slice(0, 160),
    username: assertString(profile.username || user.username || '').slice(0, 120),
    email: assertString(user.email || profile.email || authUser?.email || '').slice(0, 320),
    role: assertString(user.role || profile.role || user.accountType || 'user').slice(0, 80),
    avatarURL: assertString(profile.avatarURL || profile.photoURL || user.photoURL || authUser?.photoURL || '').slice(0, 2000)
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

function resonaActivityPayload(state = 'thinking') {
  const cleanState = Object.prototype.hasOwnProperty.call(RESONA_ACTIVITY_LABELS, state) ? state : 'thinking'
  return {
    active: true,
    state: cleanState,
    label: RESONA_ACTIVITY_LABELS[cleanState],
    startedAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(Date.now() + RESONA_ACTIVITY_TTL_MS)
  }
}

async function setResonaActivity(threadRef, state = 'thinking') {
  await threadRef.set({
    resonaActivity: resonaActivityPayload(state),
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })
  await setResonaTyping(threadRef, true)
}

async function clearResonaActivity(threadRef) {
  await threadRef.set({
    resonaActivity: {
      active: false,
      state: '',
      label: '',
      expiresAt: null,
      clearedAt: FieldValue.serverTimestamp()
    },
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true }).catch(() => null)
  await setResonaTyping(threadRef, false)
}

async function deleteQueryDocuments(query) {
  let snapshot = await query.limit(400).get()
  while (!snapshot.empty) {
    const batch = db.batch()
    snapshot.docs.forEach((docSnap) => batch.delete(docSnap.ref))
    await batch.commit()
    if (snapshot.size < 400) break
    snapshot = await query.limit(400).get()
  }
}

async function purgeResonaConversationData({ threadRef, threadId = '', uid = '' } = {}) {
  await Promise.all([
    db.recursiveDelete(threadRef.collection('messages')),
    db.recursiveDelete(threadRef.collection('typing')),
    db.recursiveDelete(threadRef.collection('participants')),
    db.recursiveDelete(db.collection('users').doc(uid).collection('hiddenThreadMessages').doc(threadId)),
    deleteQueryDocuments(db.collection('aiMessageFeedback').where('threadId', '==', threadId)),
    deleteQueryDocuments(db.collection('reports').where('metadata.threadId', '==', threadId)),
    db.collection('supportGuidanceSessions').where('threadId', '==', threadId).get().then((snapshot) => (
      Promise.all(snapshot.docs.map((docSnap) => db.recursiveDelete(docSnap.ref)))
    )),
    getStorage().bucket().deleteFiles({
      prefix: `threads/${threadId}/messages/`,
      force: true
    })
  ])
  await getDatabase().ref(`supportAgentSessions/${threadId}`).remove().catch(() => null)
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
    if (thread.historyClearing === true) {
      return { locked: false, reason: 'history_clearing', thread, message }
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
        resonaHandlingStartedAt: FieldValue.serverTimestamp(),
        resonaHistoryVersion: Math.max(0, Number(thread.historyVersion || 0))
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
  const unavailableWithoutEscalation = aiResult.aiAvailable === false && detectEscalationNeed(userMessage.body || '').shouldEscalate !== true
  const safeResult = unavailableWithoutEscalation
    ? {
        ...aiResult,
        replyText: 'I’m having trouble responding right now. Please try again in a moment, or ask me to connect you with support.',
        shouldEscalate: false,
        escalationReason: '',
        escalationDecision: { shouldEscalate: false, escalationReason: '', confidence: 1 },
        suggestedCategory: 'temporary_unavailable'
      }
    : aiResult
  const replyText = cleanBody(safeResult.replyText || 'I can help with that. Tell me a little more about what you are trying to do on Melogic.')
  const aiMessageRef = threadRef.collection('messages').doc()
  const shouldEscalate = safeResult.shouldEscalate === true
  const statusBefore = cleanBody(thread.status || 'ai_active', 80)
  const historyVersion = Math.max(0, Number(thread.historyVersion || 0))
  let statusAfter = statusBefore
  let skipped = false
  await db.runTransaction(async (transaction) => {
    const currentThreadSnap = await transaction.get(threadRef)
    const currentThread = currentThreadSnap.data() || {}
    if (
      !currentThreadSnap.exists
      || currentThread.historyClearing === true
      || Math.max(0, Number(currentThread.historyVersion || 0)) !== historyVersion
    ) {
      skipped = true
      return
    }
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
        confidence: Number(safeResult.confidence || 0),
        modelUsed: safeResult.modelUsed || '',
        shouldEscalate,
        escalationReason: safeResult.escalationReason || '',
        webGrounding: safeResult.webGrounding && typeof safeResult.webGrounding === 'object' ? safeResult.webGrounding : null,
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
      aiEscalationReason: shouldEscalate ? (safeResult.escalationReason || 'support_needed') : '',
      aiSuggestedCategory: safeResult.suggestedCategory || ''
    }
    if (shouldEscalate) {
      threadUpdate.status = 'waiting_for_agent'
      statusAfter = 'waiting_for_agent'
      threadUpdate.mode = 'support'
      threadUpdate.assignedAgentUid = null
      threadUpdate.resolvedAt = null
      threadUpdate.resolvedBy = ''
      threadUpdate.requesterUid = thread.requesterUid || getThreadParticipantUids(thread)[0] || ''
      addSystemMessage(transaction, threadRef, 'Resona requested a live support agent.', {
        event: 'resona_requested_live_agent',
        reason: safeResult.escalationReason || ''
      })
    } else if (thread.type === 'agent') {
      threadUpdate.status = 'ai_active'
      statusAfter = 'ai_active'
      threadUpdate.mode = thread.contextType && thread.contextType !== 'inbox' ? 'project_assistant' : 'general'
      threadUpdate.assignedAgentUid = null
    }
    transaction.set(threadRef, threadUpdate, { merge: true })
  })
  if (skipped) return { skipped: true, reason: 'history_changed' }
  console.log('[resona-ai]', {
    threadId,
    userMessageId: messageId,
    escalationDecision: safeResult.escalationDecision || {
      shouldEscalate,
      escalationReason: safeResult.escalationReason || '',
      confidence: Number(safeResult.confidence || 0)
    },
    escalationReason: safeResult.escalationReason || '',
    statusBefore,
    statusAfter
  })
  return { skipped: false }
}

const createOrGetResonaThread = onCall(CALLABLE_OPTIONS, async (request) => {
  const requestUid = assertString(request.auth?.uid || request.context?.auth?.uid || '')
  const requestContext = normalizeResonaContext(request.data || {})
  try {
    const uid = assertSignedIn(request)
    const context = requestContext
    await assertContextAccess({ uid, contextType: context.contextType, contextId: context.contextId })
    const threadId = resonaThreadIdFor(uid, context)
    const threadRef = db.collection('threads').doc(threadId)
    const isInboxContext = context.contextType === 'inbox'
    const mode = isInboxContext ? 'general' : 'project_assistant'
    const source = isInboxContext ? 'inbox_resona' : `${context.contextType}_resona`
    const title = context.contextLabel ? `Resona - ${context.contextLabel}` : 'Resona'

    const result = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (snap.exists) {
      const current = snap.data() || {}
      const participantUids = Array.from(new Set([...getThreadParticipantUids(current), uid].filter(Boolean)))
      const repaired = {
        type: 'agent',
        agentId: RESONA_AGENT_ID,
        imagePath: current.imagePath || RESONA_AVATAR_PATH,
        participantIds: participantUids,
        participantUids,
        memberUids: participantUids,
        participantCount: participantUids.length,
        requesterUid: current.requesterUid || uid,
        status: current.status || 'ai_active',
        mode: current.mode || mode,
        source: current.source || source,
        contextType: current.contextType || context.contextType,
        contextId: current.contextId || context.contextId,
        contextLabel: context.contextLabel || current.contextLabel || '',
        title: context.contextLabel ? title : (current.title || 'Resona'),
        updatedAt: FieldValue.serverTimestamp()
      }
      transaction.set(threadRef, repaired, { merge: true })
      transaction.set(threadRef.collection('participants').doc(uid), buildParticipantPayload({ uid, role: 'owner' }), { merge: true })
      if (isInboxContext) {
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
      }
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
      mode,
      source,
      contextType: context.contextType,
      contextId: context.contextId,
      contextLabel: context.contextLabel,
      title,
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
    if (isInboxContext) {
      transaction.set(db.collection('users').doc(uid).collection('inboxThreads').doc(threadId), buildInboxSummaryPayload({
        threadId,
        thread: payload,
        recipientUid: uid
      }))
    }
    return { threadId, existing: false }
    })

    const snap = await threadRef.get()
    return { ok: true, ...result, thread: serializeThread(snap) }
  } catch (error) {
    console.error('[resona] createOrGetResonaThread failed', {
      uidPreview: requestUid ? `${requestUid.slice(0, 6)}...` : '',
      contextType: requestContext.contextType,
      contextId: requestContext.contextId,
      code: String(error?.code || ''),
      message: String(error?.message || error || '').slice(0, 500)
    })
    if (error instanceof HttpsError) throw error
    const code = String(error?.code || '').toLowerCase()
    if (code.includes('aborted') || code.includes('deadline') || code.includes('unavailable')) {
      throw new HttpsError('unavailable', 'Resona is temporarily unavailable. Please try again.', { retryable: true })
    }
    throw new HttpsError('internal', 'Resona could not open this conversation.', { retryable: false })
  }
})

const refreshResonaThread = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const requestedThreadId = assertString(request.data?.threadId || '')
  const threadId = requestedThreadId || resonaThreadIdFor(uid)
  const threadRef = db.collection('threads').doc(threadId)

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona chat not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID || !getThreadParticipantUids(thread).includes(uid)) {
      throw new HttpsError('permission-denied', 'You can only refresh your Resona chat.')
    }
    transaction.set(threadRef, {
      status: 'ai_active',
      mode: thread.contextType && thread.contextType !== 'inbox' ? 'project_assistant' : 'general',
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
  await clearResonaActivity(threadRef)
  return { ok: true, threadId }
})

const clearResonaChatHistory = onCall({ ...CALLABLE_OPTIONS, timeoutSeconds: 120, memory: '512MiB' }, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = cleanBody(request.data?.threadId || resonaThreadIdFor(uid), 180)
  const threadRef = db.collection('threads').doc(threadId)
  const clearState = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('failed-precondition', 'Only Resona history can be cleared here.')
    if (!getThreadParticipantUids(thread).includes(uid)) throw new HttpsError('permission-denied', 'You do not have access to this Resona thread.')
    transaction.set(threadRef, {
      historyClearing: true,
      historyClearingStartedAt: FieldValue.serverTimestamp(),
      assignedAgentUid: null,
      assignedAgentFirstName: '',
      assignedAgentAvatarPath: '',
      aiEscalationReason: '',
      aiSuggestedCategory: '',
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    return {
      nextHistoryVersion: Math.max(0, Number(thread.historyVersion || 0)) + 1,
      mode: thread.contextType && thread.contextType !== 'inbox' ? 'project_assistant' : 'general'
    }
  })
  try {
    await purgeResonaConversationData({ threadRef, threadId, uid })
    await Promise.all([
      db.recursiveDelete(threadRef.collection('messages')),
      db.recursiveDelete(threadRef.collection('typing'))
    ])
  } catch (error) {
    await threadRef.set({
      historyClearing: false,
      historyClearingFailedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => null)
    console.error('[resona-clear-history] purge failed', { threadId, uid, message: error?.message || 'unknown' })
    throw new HttpsError('internal', 'Resona history could not be completely deleted. Please try again.')
  }

  const clearedAt = Timestamp.now()
  await threadRef.set({
    clearedAt,
    clearedBy: uid,
    historyVersion: clearState.nextHistoryVersion,
    historyClearing: false,
    historyClearingStartedAt: FieldValue.delete(),
    historyClearingFailedAt: FieldValue.delete(),
    mode: clearState.mode,
    status: 'ai_active',
    assignedAgentUid: null,
    assignedAgentFirstName: '',
    assignedAgentAvatarPath: '',
    participantIds: [uid],
    participantUids: [uid],
    memberUids: [uid],
    participantCount: 1,
    aiEscalationReason: '',
    aiSuggestedCategory: '',
    lastMessageAt: null,
    lastMessageText: '',
    lastMessagePreview: 'Ask Resona anything.',
    lastMessageSenderId: '',
    lastMessageType: 'text',
    lastMessageAttachmentCount: 0,
    resolvedAt: null,
    resolvedBy: '',
    resonaActivity: {
      active: false,
      state: '',
      label: '',
      expiresAt: null,
      clearedAt
    },
    updatedAt: clearedAt
  }, { merge: true })
  await threadRef.collection('participants').doc(uid).set(buildParticipantPayload({ uid, role: 'owner' }), { merge: true })
  return { ok: true, threadId, clearedAt: clearedAt.toDate().toISOString() }
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

  await setResonaActivity(threadRef, 'thinking')
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
    const hasPageContext = safePageContext.guidanceSessionActive === true
      || Boolean(safePageContext.pageSnapshot)
      || Boolean(safePageContext.dawContext)
      || Boolean(safePageContext.stageContext)
      || (Array.isArray(safePageContext.visibleGuideTargets) && safePageContext.visibleGuideTargets.length > 0)
    if (hasPageContext) await setResonaActivity(threadRef, 'checking_page')
    if (Array.isArray(message.attachments) && message.attachments.length) await setResonaActivity(threadRef, 'reading_attachments')
    const aiAttachmentInputs = await buildAiAttachmentInputs({
      threadId,
      messageId,
      attachments: Array.isArray(message.attachments) ? message.attachments : []
    })
    const explicitEscalation = detectEscalationNeed(message.body || '')
    const grounding = webGroundingDecision(message.body || '', resonaInstructions)
    if (!explicitEscalation.shouldEscalate && grounding.shouldUse) await setResonaActivity(threadRef, 'researching')
    if (!explicitEscalation.shouldEscalate) await setResonaActivity(threadRef, 'writing')
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
    const writeResult = await writeResonaReply({
      threadRef,
      threadId,
      messageId,
      thread: lock.thread,
      userMessage: message,
      aiResult
    })
    if (!writeResult?.skipped && aiResult?.highlightIntent && safePageContext?.sessionId) {
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
    await clearResonaActivity(threadRef)
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
  const agent = await loadProfileSummary(claims.uid)
  const agentFirstName = normalizeAgentFirstName(agent?.firstName || assertString(agent?.displayName || '').split(/\s+/)[0])
  const threadRef = db.collection('threads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
    if (thread.assignedAgentUid && thread.assignedAgentUid !== claims.uid) {
      throw new HttpsError('already-exists', 'Another support agent is already connected to this conversation.')
    }
    if (thread.status === 'assigned' && thread.assignedAgentUid === claims.uid) return
    transaction.set(threadRef, {
      assignedAgentUid: claims.uid,
      assignedAgentFirstName: agentFirstName,
      assignedAgentAvatarPath: RESONA_SUPPORT_AVATAR_PATH,
      status: 'assigned',
      mode: 'live_agent_joined',
      participantIds: FieldValue.arrayUnion(claims.uid),
      participantUids: FieldValue.arrayUnion(claims.uid),
      memberUids: FieldValue.arrayUnion(claims.uid),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: `${agentFirstName} joined the chat.`,
      lastMessagePreview: `${agentFirstName} joined the chat.`,
      lastMessageSenderId: 'system',
      lastMessageType: 'system'
    }, { merge: true })
    transaction.set(threadRef.collection('participants').doc(claims.uid), buildParticipantPayload({ uid: claims.uid, role: 'support' }), { merge: true })
    addSystemMessage(transaction, threadRef, `${agentFirstName} joined the chat.`, {
      event: 'live_agent_joined',
      agentUid: claims.uid,
      agentFirstName,
      avatarPath: RESONA_SUPPORT_AVATAR_PATH
    })
  })
  await clearResonaActivity(threadRef)
  return { ok: true, threadId }
}

async function resolveResonaThread({ request, threadId = '' }) {
  const claims = assertPermission(request, 'orderSupport')
  const agent = await loadProfileSummary(claims.uid)
  const agentFirstName = normalizeAgentFirstName(agent?.firstName || assertString(agent?.displayName || '').split(/\s+/)[0])
  const threadRef = db.collection('threads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
    if (!thread.assignedAgentUid && thread.status === 'ai_active') return
    if (thread.assignedAgentUid && thread.assignedAgentUid !== claims.uid) {
      throw new HttpsError('failed-precondition', 'Only the connected support agent can disconnect this conversation.')
    }
    const wasConnected = Boolean(thread.assignedAgentUid)
    const message = wasConnected
      ? `${thread.assignedAgentFirstName || agentFirstName} left the conversation. Resona is active again.`
      : 'The support request was resolved. Resona is active again.'
    transaction.set(threadRef, {
      assignedAgentUid: null,
      assignedAgentFirstName: '',
      assignedAgentAvatarPath: '',
      status: 'ai_active',
      mode: 'general',
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: claims.uid,
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: message,
      lastMessagePreview: message,
      lastMessageSenderId: 'system',
      lastMessageType: 'system',
      aiEscalationReason: ''
    }, { merge: true })
    addSystemMessage(transaction, threadRef, message, {
      event: wasConnected ? 'live_agent_disconnected' : 'support_request_resolved',
      agentUid: claims.uid,
      agentFirstName: thread.assignedAgentFirstName || agentFirstName
    })
  })
  return { ok: true, threadId }
}

async function sendResonaSupportMessage({ request, threadId = '', body = '', attachments = [] }) {
  const claims = assertPermission(request, 'orderSupport')
  const clean = cleanBody(body)
  const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 8).map((item) => ({
    name: assertString(item?.name || 'Attachment').slice(0, 180),
    type: assertString(item?.type || 'file').slice(0, 40),
    mimeType: assertString(item?.mimeType || 'application/octet-stream').slice(0, 120),
    size: Math.max(0, Math.min(Number(item?.size || 0), 256 * 1024 * 1024)),
    storagePath: assertString(item?.storagePath || '').slice(0, 900),
    url: assertString(item?.url || '').slice(0, 2000),
    width: Math.max(0, Number(item?.width || 0)),
    height: Math.max(0, Number(item?.height || 0))
  })).filter((item) => item.storagePath.startsWith(`threads/${threadId}/messages/`) && item.url) : []
  if (!clean && !safeAttachments.length) throw new HttpsError('invalid-argument', 'Message content or an attachment is required.')
  const agent = await loadProfileSummary(claims.uid)
  const agentFirstName = normalizeAgentFirstName(agent?.firstName || assertString(agent?.displayName || '').split(/\s+/)[0])
  const preview = clean || `${safeAttachments.length} attachment${safeAttachments.length === 1 ? '' : 's'}`
  const threadRef = db.collection('threads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc()
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Resona thread not found.')
    const thread = snap.data() || {}
    if (thread.type !== 'agent' || thread.agentId !== RESONA_AGENT_ID) throw new HttpsError('not-found', 'Resona thread not found.')
    if (thread.status !== 'assigned' || thread.assignedAgentUid !== claims.uid) {
      throw new HttpsError('failed-precondition', 'Connect to this conversation before sending as support.')
    }
    transaction.set(messageRef, {
      senderId: claims.uid,
      senderUid: claims.uid,
      senderType: 'agent',
      senderDisplayName: agentFirstName,
      senderFirstName: agentFirstName,
      avatarPath: RESONA_SUPPORT_AVATAR_PATH,
      body: clean,
      type: safeAttachments.length ? 'attachment' : 'text',
      attachments: safeAttachments,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
      edited: false,
      metadata: {
        source: 'admin_support_queue',
        liveAgent: true,
        agentFirstName,
        avatarPath: RESONA_SUPPORT_AVATAR_PATH
      }
    })
    transaction.set(threadRef, {
      assignedAgentUid: thread.assignedAgentUid || claims.uid,
      assignedAgentFirstName: agentFirstName,
      assignedAgentAvatarPath: RESONA_SUPPORT_AVATAR_PATH,
      status: 'assigned',
      mode: 'live_agent_joined',
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: preview,
      lastMessagePreview: preview,
      lastMessageSenderId: claims.uid,
      lastMessageType: safeAttachments.length ? 'attachment' : 'text',
      lastMessageAttachmentCount: safeAttachments.length
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
