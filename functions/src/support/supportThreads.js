const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { assertPermission, cleanString, getRequesterClaims } = require('../admin/adminAuth')
const {
  DEFAULT_SUPPORT_KNOWLEDGE,
  SUPPORT_AI_API_KEY,
  SUPPORT_AI_MODEL,
  detectEscalationNeed,
  generateSupportReply
} = require('./aiSupportAgent')

const db = getFirestore()
const ACTIVE_STATUSES = new Set(['open', 'ai_active', 'waiting_for_agent', 'assigned'])
const STATUS_VALUES = new Set(['open', 'ai_active', 'waiting_for_agent', 'assigned', 'resolved'])
const MAX_BODY_LENGTH = 1200
const SUPPORT_CALLABLE_OPTIONS = {
  timeoutSeconds: 30,
  memory: '256MiB',
  cors: true,
  invoker: 'public'
}

function assertSignedIn(request = {}) {
  const uid = cleanString(request.auth?.uid || request.context?.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  return uid
}

function isSupportStaff(request = {}) {
  try {
    const claims = getRequesterClaims(request)
    return claims.admin === true && (claims.orderSupport === true || claims.emailSend === true)
  } catch {
    return false
  }
}

function supportStaffClaims(request = {}) {
  const claims = assertPermission(request, 'orderSupport')
  return claims
}

function cleanBody(value = '') {
  const body = cleanString(value, MAX_BODY_LENGTH + 1)
  if (!body) throw new HttpsError('invalid-argument', 'Message content is required.')
  if (body.length > MAX_BODY_LENGTH) throw new HttpsError('invalid-argument', 'Message is too long.')
  return body
}

function cleanSubject(value = '') {
  return cleanString(value || 'Support request', 180) || 'Support request'
}

function serializeTimestamp(value) {
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
    type: data.type || 'support',
    requesterUid: data.requesterUid || '',
    participantUids: Array.isArray(data.participantUids) ? data.participantUids : [],
    assignedAgentUid: data.assignedAgentUid || '',
    status: STATUS_VALUES.has(data.status) ? data.status : 'open',
    source: data.source || 'support',
    subject: data.subject || 'Support request',
    priority: data.priority || 'normal',
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    lastMessageAt: serializeTimestamp(data.lastMessageAt),
    lastMessagePreview: data.lastMessagePreview || '',
    resolvedAt: serializeTimestamp(data.resolvedAt),
    resolvedBy: data.resolvedBy || '',
    humanRequested: data.humanRequested === true,
    aiRoutedToAgent: data.aiRoutedToAgent === true,
    aiEscalationReason: data.aiEscalationReason || '',
    aiSuggestedCategory: data.aiSuggestedCategory || '',
    requester: data.requester || null,
    assignedAgent: data.assignedAgent || null
  }
}

function serializeMessage(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: docSnap.id,
    senderUid: data.senderUid || '',
    senderType: data.senderType || 'system',
    body: data.body || '',
    createdAt: serializeTimestamp(data.createdAt),
    metadata: data.metadata && typeof data.metadata === 'object' ? data.metadata : {}
  }
}

async function findActiveThreadForRequester(uid) {
  const snapshot = await db.collection('supportThreads')
    .where('requesterUid', '==', uid)
    .limit(20)
    .get()
  return snapshot.docs
    .map((docSnap) => ({ docSnap, thread: docSnap.data() || {} }))
    .filter(({ thread }) => ACTIVE_STATUSES.has(thread.status || 'open'))
    .sort((a, b) => {
      const aMs = a.thread.updatedAt?.toMillis?.() || a.thread.createdAt?.toMillis?.() || 0
      const bMs = b.thread.updatedAt?.toMillis?.() || b.thread.createdAt?.toMillis?.() || 0
      return bMs - aMs
    })[0]?.docSnap || null
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
    displayName: cleanString(profile.displayName || user.displayName || profile.name || user.name || '', 160),
    username: cleanString(profile.username || user.username || '', 120),
    email: cleanString(user.email || profile.email || '', 320),
    avatarURL: cleanString(profile.avatarURL || profile.photoURL || user.photoURL || '', 2000)
  }
}

async function hydrateThread(docSnap) {
  const thread = serializeThread(docSnap)
  const [requester, assignedAgent] = await Promise.all([
    loadProfileSummary(thread.requesterUid),
    thread.assignedAgentUid ? loadProfileSummary(thread.assignedAgentUid) : Promise.resolve(null)
  ])
  return { ...thread, requester, assignedAgent }
}

function assertThreadAccess(thread = {}, uid = '', staff = false) {
  const participants = Array.isArray(thread.participantUids) ? thread.participantUids : []
  if (staff || thread.requesterUid === uid || participants.includes(uid)) return
  throw new HttpsError('permission-denied', 'You do not have access to this support thread.')
}

async function addSystemMessage(transaction, threadRef, body = '', metadata = {}) {
  const messageRef = threadRef.collection('messages').doc()
  transaction.set(messageRef, {
    senderUid: '',
    senderType: 'system',
    body: cleanString(body, MAX_BODY_LENGTH),
    createdAt: FieldValue.serverTimestamp(),
    metadata
  })
}

function sanitizeSafeContext(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    route: cleanString(source.route || '', 200),
    pageTitle: cleanString(source.pageTitle || '', 200),
    productId: cleanString(source.productId || '', 180),
    productTitle: cleanString(source.productTitle || '', 200)
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
        title: cleanString(data.title || '', 180),
        category: cleanString(data.category || '', 80),
        body: cleanString(data.body || '', 1200),
        tags: Array.isArray(data.tags) ? data.tags.map((tag) => cleanString(tag, 60)).filter(Boolean).slice(0, 12) : []
      }
    }).filter((item) => item.title && item.body)
    return docs.length ? docs : DEFAULT_SUPPORT_KNOWLEDGE
  } catch {
    return DEFAULT_SUPPORT_KNOWLEDGE
  }
}

async function loadRecentSupportMessages(threadRef) {
  const snapshot = await threadRef.collection('messages').orderBy('createdAt', 'desc').limit(12).get()
  return snapshot.docs.map(serializeMessage).reverse()
}

async function hasSystemEvent(threadRef, eventName = '') {
  if (!eventName) return false
  const snapshot = await threadRef.collection('messages').where('metadata.event', '==', eventName).limit(1).get()
  return !snapshot.empty
}

async function markAiHandledStart(threadRef, messageId = '') {
  const messageRef = threadRef.collection('messages').doc(messageId)
  return db.runTransaction(async (transaction) => {
    const [threadSnap, messageSnap] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(messageRef)
    ])
    if (!threadSnap.exists || !messageSnap.exists) return null
    const thread = threadSnap.data() || {}
    const message = messageSnap.data() || {}
    const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
    if (metadata.aiHandledAt || metadata.aiHandlingStartedAt) return null
    if (message.senderType !== 'user' || !cleanString(message.body || '', MAX_BODY_LENGTH)) return null
    if (thread.status === 'resolved' || thread.status === 'assigned' || thread.humanRequested === true || thread.assignedAgentUid) return null
    if (!['open', 'ai_active'].includes(thread.status || 'open')) return null
    transaction.set(messageRef, {
      metadata: {
        ...metadata,
        aiHandlingStartedAt: FieldValue.serverTimestamp()
      }
    }, { merge: true })
    if (thread.status === 'open') {
      transaction.set(threadRef, {
        status: 'ai_active',
        updatedAt: FieldValue.serverTimestamp()
      }, { merge: true })
    }
    return { thread, message }
  })
}

async function completeAiHandling({ threadRef, messageId = '', userMessage = {}, aiResult = {}, recentMessages = [] } = {}) {
  const messageRef = threadRef.collection('messages').doc(messageId)
  const aiMessageRef = threadRef.collection('messages').doc()
  const shouldEscalate = aiResult.shouldEscalate === true
  const aiUnavailable = aiResult.aiAvailable === false
  const replyText = cleanString(aiResult.replyText || '', MAX_BODY_LENGTH)
  const escalationReason = cleanString(aiResult.escalationReason || '', 160)
  const suggestedCategory = cleanString(aiResult.suggestedCategory || '', 80)

  await db.runTransaction(async (transaction) => {
    const [threadSnap, messageSnap] = await Promise.all([
      transaction.get(threadRef),
      transaction.get(messageRef)
    ])
    if (!threadSnap.exists || !messageSnap.exists) return
    const thread = threadSnap.data() || {}
    const message = messageSnap.data() || {}
    const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
    if (metadata.aiHandledAt) return
    if (thread.status === 'resolved' || thread.status === 'assigned' || thread.assignedAgentUid) {
      transaction.set(messageRef, {
        metadata: {
          ...metadata,
          aiHandledAt: FieldValue.serverTimestamp(),
          aiSkippedReason: 'thread_no_longer_eligible'
        }
      }, { merge: true })
      return
    }

    const threadUpdate = {
      updatedAt: FieldValue.serverTimestamp(),
      aiLastHandledMessageId: messageId,
      aiLastHandledAt: FieldValue.serverTimestamp(),
      aiSuggestedCategory: suggestedCategory || thread.aiSuggestedCategory || ''
    }

    if (replyText && !aiUnavailable) {
      transaction.set(aiMessageRef, {
        senderUid: 'melogic-ai-support',
        senderType: 'ai',
        body: replyText,
        createdAt: FieldValue.serverTimestamp(),
        metadata: {
          model: cleanString(aiResult.modelUsed || '', 120),
          confidence: Number(aiResult.confidence || 0),
          shouldEscalate,
          escalationReason,
          suggestedCategory,
          handledForMessageId: messageId
        }
      })
      threadUpdate.lastMessageAt = FieldValue.serverTimestamp()
      threadUpdate.lastMessagePreview = replyText
    }

    if (shouldEscalate || aiUnavailable) {
      threadUpdate.status = 'waiting_for_agent'
      threadUpdate.humanRequested = true
      threadUpdate.aiRoutedToAgent = true
      threadUpdate.aiEscalationReason = escalationReason || (aiUnavailable ? 'ai_unavailable' : 'ai_escalated')
      threadUpdate.lastMessageAt = FieldValue.serverTimestamp()
      threadUpdate.lastMessagePreview = aiUnavailable
        ? 'Support is being routed to a live agent.'
        : 'AI support routed this to a live agent.'
    } else {
      threadUpdate.status = 'ai_active'
    }

    transaction.set(messageRef, {
      metadata: {
        ...metadata,
        aiHandledAt: FieldValue.serverTimestamp(),
        aiReplyMessageId: replyText && !aiUnavailable ? aiMessageRef.id : '',
        aiEscalated: shouldEscalate || aiUnavailable,
        aiEscalationReason: threadUpdate.aiEscalationReason || ''
      }
    }, { merge: true })
    transaction.set(threadRef, threadUpdate, { merge: true })
  })

  if (shouldEscalate || aiUnavailable) {
    const routedEvent = aiUnavailable ? 'ai_unavailable_routed' : 'ai_routed_to_agent'
    if (!(await hasSystemEvent(threadRef, routedEvent))) {
      const body = aiUnavailable
        ? 'Support is being routed to a live agent.'
        : 'AI support routed this to a live agent.'
      await threadRef.collection('messages').add({
        senderUid: '',
        senderType: 'system',
        body,
        createdAt: FieldValue.serverTimestamp(),
        metadata: {
          event: routedEvent,
          escalationReason: escalationReason || (aiUnavailable ? 'ai_unavailable' : 'ai_escalated'),
          handledForMessageId: messageId
        }
      })
    }
  }
}

async function handleSupportAiReplyForMessage({ threadId = '', messageId = '', apiKey = '', model = '' } = {}) {
  const threadRef = db.collection('supportThreads').doc(threadId)
  const locked = await markAiHandledStart(threadRef, messageId)
  if (!locked) return { ok: true, skipped: true }

  const threadSnap = await threadRef.get()
  if (!threadSnap.exists) return { ok: false, skipped: true }
  const thread = threadSnap.data() || {}
  const messageSnap = await threadRef.collection('messages').doc(messageId).get()
  const userMessage = messageSnap.data() || locked.message || {}
  const messageText = cleanString(userMessage.body || '', MAX_BODY_LENGTH)
  const recentMessages = await loadRecentSupportMessages(threadRef)
  const knowledgeSnippets = await loadSupportKnowledgeSnippets()
  const requester = thread.requester && typeof thread.requester === 'object' ? thread.requester : {}
  const safePageContext = sanitizeSafeContext(userMessage.metadata?.safePageContext || {})

  const aiJoinedAlready = await hasSystemEvent(threadRef, 'ai_joined')
  if (!aiJoinedAlready) {
    await threadRef.collection('messages').add({
      senderUid: '',
      senderType: 'system',
      body: 'AI support joined the chat.',
      createdAt: FieldValue.serverTimestamp(),
      metadata: { event: 'ai_joined' }
    })
  }

  const directEscalation = detectEscalationNeed(messageText)
  const aiResult = directEscalation.shouldEscalate
    ? {
        replyText: 'I’m routing this to a live Melogic support agent so they can review the details safely.',
        confidence: 1,
        shouldEscalate: true,
        escalationReason: directEscalation.reason,
        suggestedCategory: directEscalation.reason,
        aiAvailable: true,
        modelUsed: 'guardrail'
      }
    : await generateSupportReply({
        apiKey,
        model,
        thread,
        userMessage: messageText,
        recentMessages,
        knowledgeSnippets,
        safeUserContext: {
          displayName: requester.displayName || requester.username || '',
          role: 'user'
        },
        safePageContext
      })

  await completeAiHandling({ threadRef, messageId, userMessage, aiResult, recentMessages })
  return { ok: true, skipped: false, escalated: aiResult.shouldEscalate === true || aiResult.aiAvailable === false }
}

const createSupportThread = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const initialMessage = cleanString(request.data?.initialMessage || '', MAX_BODY_LENGTH + 1)
  if (initialMessage.length > MAX_BODY_LENGTH) throw new HttpsError('invalid-argument', 'Message is too long.')

  const existing = await findActiveThreadForRequester(uid)
  if (existing) {
    return { ok: true, created: false, threadId: existing.id, thread: await hydrateThread(existing) }
  }

  const subject = cleanSubject(request.data?.subject)
  const source = cleanString(request.data?.source || 'support', 80) || 'support'
  const priority = cleanString(request.data?.priority || 'normal', 40) || 'normal'
  const threadRef = db.collection('supportThreads').doc()
  const requester = await loadProfileSummary(uid)

  await db.runTransaction(async (transaction) => {
    const status = 'ai_active'
    transaction.set(threadRef, {
      type: 'support',
      requesterUid: uid,
      participantUids: [uid],
      assignedAgentUid: null,
      status,
      source,
      subject,
      priority,
      requester,
      humanRequested: false,
      aiRoutedToAgent: false,
      aiEscalationReason: '',
      aiSuggestedCategory: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: initialMessage || 'Support request opened.',
      resolvedAt: null,
      resolvedBy: null
    })
    addSystemMessage(transaction, threadRef, 'Support request opened.', { event: 'thread_opened' })
    addSystemMessage(transaction, threadRef, 'AI support joined the chat.', { event: 'ai_joined' })
    if (initialMessage) {
      transaction.set(threadRef.collection('messages').doc(), {
        senderUid: uid,
        senderType: 'user',
        body: initialMessage,
        createdAt: FieldValue.serverTimestamp(),
        metadata: {}
      })
    }
  })

  const createdSnap = await threadRef.get()
  return { ok: true, created: true, threadId: threadRef.id, thread: await hydrateThread(createdSnap) }
})

const requestSupportAgent = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')

  const threadRef = db.collection('supportThreads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    const thread = snap.data() || {}
    assertThreadAccess(thread, uid, false)
    if (thread.status === 'resolved') throw new HttpsError('failed-precondition', 'This support thread is resolved.')
    transaction.set(threadRef, {
      status: thread.assignedAgentUid ? 'assigned' : 'waiting_for_agent',
      humanRequested: true,
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: 'Live agent requested.'
    }, { merge: true })
    if (thread.humanRequested !== true) {
      addSystemMessage(transaction, threadRef, 'A live agent has been requested.', { event: 'agent_requested' })
    }
  })

  return { ok: true, threadId }
})

const sendSupportMessage = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const staff = isSupportStaff(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  const body = cleanBody(request.data?.body || '')
  const safePageContext = sanitizeSafeContext(request.data?.safePageContext || {})
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')

  const threadRef = db.collection('supportThreads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc()
  let shouldAiHandle = false
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    const thread = snap.data() || {}
    assertThreadAccess(thread, uid, staff)
    if (thread.status === 'resolved') throw new HttpsError('failed-precondition', 'This support thread is resolved.')

    const senderType = staff ? 'agent' : 'user'
    const update = {
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: body,
      participantUids: FieldValue.arrayUnion(uid)
    }
    if (staff) {
      update.assignedAgentUid = thread.assignedAgentUid || uid
      update.status = 'assigned'
      update.humanRequested = true
    } else if (thread.status === 'open') {
      update.status = 'ai_active'
    }
    if (!staff && ['open', 'ai_active'].includes(thread.status || 'open') && !thread.assignedAgentUid && thread.humanRequested !== true) {
      shouldAiHandle = true
    }

    transaction.set(messageRef, {
      senderUid: uid,
      senderType,
      body,
      createdAt: FieldValue.serverTimestamp(),
      metadata: {
        ...(staff ? {} : { safePageContext })
      }
    })
    transaction.set(threadRef, update, { merge: true })
  })

  return { ok: true, threadId, messageId: messageRef.id, aiEligible: shouldAiHandle }
})

const claimSupportThread = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const claims = supportStaffClaims(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')

  const threadRef = db.collection('supportThreads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    const thread = snap.data() || {}
    if (thread.status === 'resolved') throw new HttpsError('failed-precondition', 'This support thread is resolved.')
    transaction.set(threadRef, {
      assignedAgentUid: claims.uid,
      status: 'assigned',
      humanRequested: true,
      participantUids: FieldValue.arrayUnion(claims.uid),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: 'A live agent joined the chat.'
    }, { merge: true })
    if (thread.assignedAgentUid !== claims.uid) {
      addSystemMessage(transaction, threadRef, 'A live agent joined the chat.', { event: 'thread_claimed', agentUid: claims.uid })
    }
  })

  return { ok: true, threadId }
})

const resolveSupportThread = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const claims = supportStaffClaims(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')

  const threadRef = db.collection('supportThreads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    transaction.set(threadRef, {
      status: 'resolved',
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: claims.uid,
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: 'Support thread resolved.'
    }, { merge: true })
    addSystemMessage(transaction, threadRef, 'Support thread resolved.', { event: 'thread_resolved', agentUid: claims.uid })
  })

  return { ok: true, threadId }
})

const listSupportThreads = onCall({
  ...SUPPORT_CALLABLE_OPTIONS,
  timeoutSeconds: 60
}, async (request) => {
  supportStaffClaims(request)
  const limitCount = Math.min(Math.max(Number(request.data?.limitCount || request.data?.limit || 50), 1), 100)
  const status = cleanString(request.data?.status || 'active', 40)
  const snapshot = await db.collection('supportThreads')
    .orderBy('updatedAt', 'desc')
    .limit(limitCount)
    .get()

  const threads = await Promise.all(snapshot.docs.map(hydrateThread))
  const filtered = threads.filter((thread) => {
    if (status === 'all') return true
    if (status === 'active') return thread.status !== 'resolved'
    return thread.status === status
  })

  return { ok: true, threads: filtered, total: filtered.length }
})

const handleSupportAiReply = onDocumentCreated({
  document: 'supportThreads/{threadId}/messages/{messageId}',
  secrets: [SUPPORT_AI_API_KEY],
  timeoutSeconds: 90,
  memory: '256MiB'
}, async (event) => {
  const message = event.data?.data() || {}
  if (message.senderType !== 'user') return
  const threadId = cleanString(event.params?.threadId || '', 180)
  const messageId = cleanString(event.params?.messageId || '', 180)
  if (!threadId || !messageId) return
  await handleSupportAiReplyForMessage({
    threadId,
    messageId,
    apiKey: SUPPORT_AI_API_KEY.value(),
    model: SUPPORT_AI_MODEL.value()
  })
})

const listSupportMessages = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const staff = isSupportStaff(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')
  const threadRef = db.collection('supportThreads').doc(threadId)
  const threadSnap = await threadRef.get()
  if (!threadSnap.exists) throw new HttpsError('not-found', 'Support thread not found.')
  assertThreadAccess(threadSnap.data() || {}, uid, staff)
  const snapshot = await threadRef.collection('messages').orderBy('createdAt', 'asc').limit(100).get()
  return { ok: true, messages: snapshot.docs.map(serializeMessage) }
})

module.exports = {
  createSupportThread,
  sendSupportMessage,
  claimSupportThread,
  resolveSupportThread,
  requestSupportAgent,
  listSupportThreads,
  listSupportMessages,
  handleSupportAiReply,
  __test: {
    sanitizeSafeContext,
    handleSupportAiReplyForMessage
  }
}
