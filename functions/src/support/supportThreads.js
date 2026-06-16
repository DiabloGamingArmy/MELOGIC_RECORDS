const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore')
const { assertPermission, cleanString, getRequesterClaims } = require('../admin/adminAuth')
const { DEFAULT_SETTINGS, mergeSettings } = require('../admin/adminSettingsShared')
const {
  DEFAULT_SUPPORT_KNOWLEDGE,
  SUPPORT_AI_API_KEY,
  SUPPORT_AI_MODEL,
  detectEscalationNeed,
  generateSupportReply
} = require('./aiSupportAgent')
const {
  listEscalatedResonaThreads,
  listResonaMessagesForSupport,
  claimResonaThread,
  resolveResonaThread,
  sendResonaSupportMessage
} = require('./resonaInbox')
const { createGuidanceOverlayFromIntent, loadActiveGuidanceContext } = require('./siteGuidance')

const db = getFirestore()
const ACTIVE_STATUSES = new Set(['open', 'ai_active', 'waiting_for_agent', 'assigned'])
const STATUS_VALUES = new Set(['open', 'ai_active', 'waiting_for_agent', 'assigned', 'resolved'])
const MAX_BODY_LENGTH = 1200
const RESONA_TYPING_TTL_MS = 120000
const SUPPORT_CALLABLE_OPTIONS = {
  timeoutSeconds: 30,
  memory: '256MiB',
  cors: true,
  invoker: 'public'
}

function isResonaThreadId(threadId = '') {
  return /^resona_[A-Za-z0-9_-]+$/.test(String(threadId || ''))
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
  const body = cleanSupportMessageBody(value, MAX_BODY_LENGTH + 1)
  if (!body) throw new HttpsError('invalid-argument', 'Message content is required.')
  if (body.length > MAX_BODY_LENGTH) throw new HttpsError('invalid-argument', 'Message is too long.')
  return body
}

function cleanSupportMessageBody(value = '', max = MAX_BODY_LENGTH) {
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

function cleanSupportPromptText(value = '', max = 8000) {
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

function cleanSubject(value = '') {
  return cleanString(value || 'Support request', 180) || 'Support request'
}

function logSupportAi(threadId = '', stage = '', data = {}) {
  console.log('[support-ai]', {
    threadId,
    stage,
    ...data
  })
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
    assignedAgent: data.assignedAgent || null,
    typing: serializeTyping(data.typing)
  }
}

function serializeTyping(value = {}) {
  const typing = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const ai = typing.ai && typeof typing.ai === 'object' && !Array.isArray(typing.ai) ? typing.ai : {}
  return {
    ai: {
      active: ai.active === true,
      label: cleanString(ai.label || '', 160),
      startedAt: serializeTimestamp(ai.startedAt),
      expiresAt: serializeTimestamp(ai.expiresAt),
      clearedAt: serializeTimestamp(ai.clearedAt)
    }
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
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {}
  const scroll = source.scroll && typeof source.scroll === 'object' ? source.scroll : {}
  const rawTargets = Array.isArray(source.visibleGuideTargets)
    ? source.visibleGuideTargets
    : Array.isArray(source.landmarks)
      ? source.landmarks
      : []
  const visibleGuideTargets = rawTargets.slice(0, 18).map((item) => ({
    guideId: cleanString(item?.guideId || item?.id || '', 120),
    id: cleanString(item?.id || item?.guideId || '', 120),
    label: cleanString(item?.label || '', 120),
    role: cleanString(item?.role || '', 60),
    text: cleanString(item?.text || '', 160),
    x: Math.max(0, Math.min(10000, Math.round(Number(item?.x || item?.rect?.x || 0) || 0))),
    y: Math.max(0, Math.min(10000, Math.round(Number(item?.y || item?.rect?.y || 0) || 0))),
    width: Math.max(0, Math.min(10000, Math.round(Number(item?.width || item?.rect?.width || 0) || 0))),
    height: Math.max(0, Math.min(10000, Math.round(Number(item?.height || item?.rect?.height || 0) || 0)))
  })).filter((item) => item.guideId || item.label)
  return {
    sessionId: cleanString(source.sessionId || '', 180),
    guidanceSessionActive: source.guidanceSessionActive === true,
    guidanceSessionStatus: cleanString(source.guidanceSessionStatus || '', 40),
    route: cleanString(source.route || source.currentRoute || '', 200),
    routeLabel: cleanString(source.routeLabel || '', 120),
    pageTitle: cleanString(source.pageTitle || '', 200),
    featureArea: cleanString(source.featureArea || '', 120),
    activeModal: cleanString(source.activeModal || '', 120),
    viewport: {
      width: Math.max(0, Math.min(10000, Math.round(Number(viewport.width || 0) || 0))),
      height: Math.max(0, Math.min(10000, Math.round(Number(viewport.height || 0) || 0)))
    },
    scroll: {
      x: Math.max(0, Math.min(100000, Math.round(Number(scroll.x || 0) || 0))),
      y: Math.max(0, Math.min(100000, Math.round(Number(scroll.y || 0) || 0)))
    },
    visibleGuideTargets,
    landmarks: visibleGuideTargets,
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

async function loadResonaInstructions() {
  try {
    const snap = await db.collection('platformConfig').doc('current').get()
    const settings = mergeSettings(snap.exists ? snap.data() || {} : {})
    const supportAi = settings.supportAi || DEFAULT_SETTINGS.supportAi || {}
    return {
      systemBehavior: cleanSupportPromptText(supportAi.systemBehavior || DEFAULT_SETTINGS.supportAi.systemBehavior, 8000),
      siteOverview: cleanSupportPromptText(supportAi.siteOverview || DEFAULT_SETTINGS.supportAi.siteOverview, 4000),
      escalationRules: cleanSupportPromptText(supportAi.escalationRules || DEFAULT_SETTINGS.supportAi.escalationRules, 4000),
      restrictedActions: cleanSupportPromptText(supportAi.restrictedActions || DEFAULT_SETTINGS.supportAi.restrictedActions, 4000),
      toneGuidelines: cleanSupportPromptText(supportAi.toneGuidelines || DEFAULT_SETTINGS.supportAi.toneGuidelines, 4000)
    }
  } catch {
    return DEFAULT_SETTINGS.supportAi
  }
}

async function loadRecentSupportMessages(threadRef) {
  const snapshot = await threadRef.collection('messages').orderBy('createdAt', 'desc').limit(12).get()
  return snapshot.docs.map(serializeMessage).reverse()
}

function resonaTypingState(active = false) {
  return active
    ? {
        active: true,
        label: 'Resona is typing...',
        startedAt: FieldValue.serverTimestamp(),
        expiresAt: Timestamp.fromMillis(Date.now() + RESONA_TYPING_TTL_MS)
      }
    : {
        active: false,
        label: '',
        expiresAt: null,
        clearedAt: FieldValue.serverTimestamp()
      }
}

async function clearResonaTyping(threadRef, threadId = '', reason = '') {
  try {
    await threadRef.set({
      typing: { ai: resonaTypingState(false) },
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true })
    logSupportAi(threadId, 'typing_cleared', { reason: cleanString(reason, 120) })
  } catch (error) {
    logSupportAi(threadId, 'typing_clear_failed', {
      reason: cleanString(reason, 120),
      errorMessage: cleanString(error?.message || 'unknown', 240)
    })
  }
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
    if (!threadSnap.exists || !messageSnap.exists) {
      return {
        locked: false,
        skippedReason: !threadSnap.exists ? 'missing_thread' : 'missing_message'
      }
    }
    const thread = threadSnap.data() || {}
    const message = messageSnap.data() || {}
    const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
    if (metadata.aiHandledAt || metadata.aiHandlingStartedAt) {
      return { locked: false, skippedReason: 'already_handled', thread, message }
    }
    if (message.senderType !== 'user' || !cleanSupportMessageBody(message.body || '', MAX_BODY_LENGTH)) {
      return { locked: false, skippedReason: 'not_user_message', thread, message }
    }
    if (thread.status === 'resolved') return { locked: false, skippedReason: 'resolved_thread', thread, message }
    if (thread.status === 'assigned') return { locked: false, skippedReason: 'assigned_thread', thread, message }
    if (thread.assignedAgentUid) return { locked: false, skippedReason: 'assigned_agent', thread, message }
    if (thread.humanRequested === true) return { locked: false, skippedReason: 'human_requested', thread, message }
    if (!['open', 'ai_active'].includes(thread.status || 'open')) {
      return { locked: false, skippedReason: 'not_ai_active', thread, message }
    }
    transaction.set(messageRef, {
      metadata: {
        ...metadata,
        aiHandlingStartedAt: FieldValue.serverTimestamp()
      }
    }, { merge: true })
    if (thread.status === 'open') {
      transaction.set(threadRef, {
        status: 'ai_active',
        updatedAt: FieldValue.serverTimestamp(),
        typing: { ai: resonaTypingState(true) }
      }, { merge: true })
    } else {
      transaction.set(threadRef, {
        updatedAt: FieldValue.serverTimestamp(),
        typing: { ai: resonaTypingState(true) }
      }, { merge: true })
    }
    return { locked: true, thread, message }
  })
}

async function completeAiHandling({ threadRef, threadId = '', messageId = '', userMessage = {}, aiResult = {}, recentMessages = [] } = {}) {
  const messageRef = threadRef.collection('messages').doc(messageId)
  const aiMessageRef = threadRef.collection('messages').doc()
  const shouldEscalate = aiResult.shouldEscalate === true
  const aiUnavailable = aiResult.aiAvailable === false
  const replyText = cleanSupportMessageBody(aiResult.replyText || '', MAX_BODY_LENGTH)
  const escalationReason = cleanString(aiResult.escalationReason || '', 160)
  const suggestedCategory = cleanString(aiResult.suggestedCategory || '', 80)

  let writeResult
  try {
    writeResult = await db.runTransaction(async (transaction) => {
      const [threadSnap, messageSnap] = await Promise.all([
        transaction.get(threadRef),
        transaction.get(messageRef)
      ])
      if (!threadSnap.exists || !messageSnap.exists) return { wrote: false, skippedReason: 'missing_thread_or_message' }
      const thread = threadSnap.data() || {}
      const message = messageSnap.data() || {}
      const metadata = message.metadata && typeof message.metadata === 'object' ? message.metadata : {}
      if (metadata.aiHandledAt) return { wrote: false, skippedReason: 'already_handled' }
      if (thread.status === 'resolved' || thread.status === 'assigned' || thread.assignedAgentUid) {
        transaction.set(messageRef, {
          metadata: {
            ...metadata,
            aiHandledAt: FieldValue.serverTimestamp(),
            aiSkippedReason: 'thread_no_longer_eligible'
          }
        }, { merge: true })
        return { wrote: false, skippedReason: 'thread_no_longer_eligible' }
      }

      const threadUpdate = {
        updatedAt: FieldValue.serverTimestamp(),
        typing: { ai: resonaTypingState(false) },
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
        : 'Resona routed this to a live agent.'
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
      return { wrote: true, replyWritten: Boolean(replyText && !aiUnavailable), escalated: shouldEscalate || aiUnavailable }
    })
  } catch (error) {
    logSupportAi(threadId, 'message_write_failure', {
      lastUserMessageId: messageId,
      errorMessage: cleanString(error?.message || 'unknown', 240)
    })
    throw error
  }

  if (!writeResult?.wrote) {
    logSupportAi(threadId, 'message_write_skipped', {
      lastUserMessageId: messageId,
      skippedReason: writeResult?.skippedReason || 'unknown'
    })
    return
  }
  logSupportAi(threadId, 'message_write_success', {
    lastUserMessageId: messageId,
    escalationDecision: aiResult.escalationDecision || {
      shouldEscalate: shouldEscalate || aiUnavailable,
      escalationReason: escalationReason || (aiUnavailable ? 'ai_unavailable' : ''),
      confidence: Number(aiResult.confidence || 0)
    },
    escalationReason: escalationReason || (aiUnavailable ? 'ai_unavailable' : ''),
    replyWritten: writeResult.replyWritten === true,
    escalated: writeResult.escalated === true
  })

  if (shouldEscalate || aiUnavailable) {
    const routedEvent = aiUnavailable ? 'ai_unavailable_routed' : 'ai_routed_to_agent'
    if (!(await hasSystemEvent(threadRef, routedEvent))) {
      const body = aiUnavailable
        ? 'Support is being routed to a live agent.'
        : 'Resona routed this to a live agent.'
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
  let typingStarted = false
  logSupportAi(threadId, 'eligibility_check', {
    lastUserMessageId: messageId,
    model: cleanString(model || SUPPORT_AI_MODEL.value() || '', 120),
    hasApiKey: Boolean(apiKey)
  })
  const locked = await markAiHandledStart(threadRef, messageId)
  if (!locked?.locked) {
    const thread = locked?.thread || {}
    logSupportAi(threadId, 'skipped', {
      status: cleanString(thread.status || '', 40),
      assignedAgentUidExists: Boolean(thread.assignedAgentUid),
      humanRequested: thread.humanRequested === true,
      lastUserMessageId: messageId,
      skippedReason: locked?.skippedReason || 'lock_not_acquired'
    })
    return { ok: true, skipped: true, skippedReason: locked?.skippedReason || 'lock_not_acquired' }
  }
  typingStarted = true

  const threadSnap = await threadRef.get()
  if (!threadSnap.exists) {
    logSupportAi(threadId, 'skipped', {
      lastUserMessageId: messageId,
      skippedReason: 'missing_thread_after_lock'
    })
    if (typingStarted) await clearResonaTyping(threadRef, threadId, 'missing_thread_after_lock')
    return { ok: false, skipped: true, skippedReason: 'missing_thread_after_lock' }
  }
  const thread = threadSnap.data() || {}
  const messageSnap = await threadRef.collection('messages').doc(messageId).get()
  const userMessage = messageSnap.data() || locked.message || {}
  const messageText = cleanSupportMessageBody(userMessage.body || '', MAX_BODY_LENGTH)
  const recentMessages = await loadRecentSupportMessages(threadRef)
  const knowledgeSnippets = await loadSupportKnowledgeSnippets()
  const resonaInstructions = await loadResonaInstructions()
  const requester = thread.requester && typeof thread.requester === 'object' ? thread.requester : {}
  const inlineSafePageContext = sanitizeSafeContext(userMessage.metadata?.safePageContext || {})
  const guidanceContext = await loadActiveGuidanceContext({
    threadId,
    userUid: thread.requesterUid || userMessage.senderUid || ''
  })
  const safePageContext = sanitizeSafeContext(guidanceContext || inlineSafePageContext)

  logSupportAi(threadId, 'eligible', {
    status: cleanString(thread.status || '', 40),
    assignedAgentUidExists: Boolean(thread.assignedAgentUid),
    lastUserMessageId: messageId,
    model: cleanString(model || SUPPORT_AI_MODEL.value() || '', 120)
  })

  const aiJoinedAlready = await hasSystemEvent(threadRef, 'ai_joined')
  if (!aiJoinedAlready) {
    await threadRef.collection('messages').add({
      senderUid: '',
      senderType: 'system',
      body: 'Resona joined the chat.',
      createdAt: FieldValue.serverTimestamp(),
      metadata: { event: 'ai_joined' }
    })
  }

  let aiResult
  const directEscalation = detectEscalationNeed(messageText)
  if (directEscalation.shouldEscalate) {
    logSupportAi(threadId, 'gemini_call_skipped', {
      lastUserMessageId: messageId,
      skippedReason: 'direct_escalation',
      escalationReason: directEscalation.reason,
      model: 'guardrail'
    })
    aiResult = {
      replyText: 'I’m routing this to a live Melogic support agent so they can review the details safely.',
      confidence: 1,
      shouldEscalate: true,
      escalationReason: directEscalation.reason,
      escalationDecision: {
        shouldEscalate: true,
        escalationReason: directEscalation.reason,
        confidence: 1
      },
      suggestedCategory: directEscalation.reason,
      aiAvailable: true,
      modelUsed: 'guardrail'
    }
  } else {
    logSupportAi(threadId, 'gemini_call_start', {
      lastUserMessageId: messageId,
      model: cleanString(model || SUPPORT_AI_MODEL.value() || '', 120)
    })
    try {
      aiResult = await generateSupportReply({
          apiKey,
          model,
          thread,
          userMessage: messageText,
          recentMessages,
          knowledgeSnippets,
          resonaInstructions,
          safeUserContext: {
            displayName: requester.displayName || requester.username || '',
            role: 'user'
          },
          safePageContext
        })
      logSupportAi(threadId, aiResult.aiAvailable === false ? 'gemini_call_failure' : 'gemini_call_success', {
        lastUserMessageId: messageId,
        model: cleanString(aiResult.modelUsed || model || SUPPORT_AI_MODEL.value() || '', 120),
        escalationDecision: aiResult.escalationDecision || {
          shouldEscalate: aiResult.shouldEscalate === true,
          escalationReason: cleanString(aiResult.escalationReason || '', 160),
          confidence: Number(aiResult.confidence || 0)
        },
        escalationReason: cleanString(aiResult.escalationReason || '', 160),
        shouldEscalate: aiResult.shouldEscalate === true
      })
    } catch (error) {
      logSupportAi(threadId, 'gemini_call_failure', {
        lastUserMessageId: messageId,
        model: cleanString(model || SUPPORT_AI_MODEL.value() || '', 120),
        errorMessage: cleanString(error?.message || 'unknown', 240)
      })
      if (typingStarted) await clearResonaTyping(threadRef, threadId, 'gemini_failure')
      throw error
    }
  }

  try {
    await completeAiHandling({ threadRef, threadId, messageId, userMessage, aiResult, recentMessages })
    if (aiResult?.highlightIntent && safePageContext?.sessionId) {
      await createGuidanceOverlayFromIntent({
        sessionId: safePageContext.sessionId,
        intent: aiResult.highlightIntent,
        landmarks: safePageContext.visibleGuideTargets || safePageContext.landmarks || []
      }).catch((error) => {
        console.warn('[support-guidance] highlight failed', {
          threadId,
          messageId,
          message: error?.message || 'unknown'
        })
      })
    }
  } catch (error) {
    if (typingStarted) await clearResonaTyping(threadRef, threadId, 'message_write_failure')
    throw error
  }
  if (typingStarted) await clearResonaTyping(threadRef, threadId, 'completed')
  return { ok: true, skipped: false, escalated: aiResult.shouldEscalate === true || aiResult.aiAvailable === false }
}

const createSupportThread = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const initialMessage = cleanSupportMessageBody(request.data?.initialMessage || '', MAX_BODY_LENGTH + 1)
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
      typing: { ai: resonaTypingState(false) },
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
    addSystemMessage(transaction, threadRef, 'Resona joined the chat.', { event: 'ai_joined' })
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
      typing: { ai: resonaTypingState(false) },
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
  const requestedAgentSend = request.data?.asAgent === true
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')
  if (isResonaThreadId(threadId) && staff && requestedAgentSend) {
    return sendResonaSupportMessage({ request, threadId, body })
  }

  const threadRef = db.collection('supportThreads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc()
  let shouldAiHandle = false
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    const thread = snap.data() || {}
    assertThreadAccess(thread, uid, staff)
    if (thread.status === 'resolved') throw new HttpsError('failed-precondition', 'This support thread is resolved.')

    const requesterUid = cleanString(thread.requesterUid || '', 180)
    const sendAsAgent = staff && (requestedAgentSend || requesterUid !== uid)
    const senderType = sendAsAgent ? 'agent' : 'user'
    const update = {
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: body,
      participantUids: FieldValue.arrayUnion(uid)
    }
    if (sendAsAgent) {
      update.assignedAgentUid = thread.assignedAgentUid || uid
      update.status = 'assigned'
      update.humanRequested = true
      update.typing = { ai: resonaTypingState(false) }
    } else if (thread.status === 'open') {
      update.status = 'ai_active'
    }
    if (!sendAsAgent && ['open', 'ai_active'].includes(thread.status || 'open') && !thread.assignedAgentUid && thread.humanRequested !== true) {
      shouldAiHandle = true
    }

    transaction.set(messageRef, {
      senderUid: uid,
      senderType,
      body,
      createdAt: FieldValue.serverTimestamp(),
      metadata: {
        ...(sendAsAgent ? {} : { safePageContext })
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
  if (isResonaThreadId(threadId)) return claimResonaThread({ request, threadId })

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
      typing: { ai: resonaTypingState(false) },
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
  if (isResonaThreadId(threadId)) return resolveResonaThread({ request, threadId })

  const threadRef = db.collection('supportThreads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    transaction.set(threadRef, {
      status: 'resolved',
      typing: { ai: resonaTypingState(false) },
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

const endSupportThread = onCall(SUPPORT_CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const staff = isSupportStaff(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')

  const threadRef = db.collection('supportThreads').doc(threadId)
  let alreadyResolved = false
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) throw new HttpsError('not-found', 'Support thread not found.')
    const thread = snap.data() || {}
    assertThreadAccess(thread, uid, staff)
    alreadyResolved = thread.status === 'resolved'
    if (alreadyResolved) return
    transaction.set(threadRef, {
      status: 'resolved',
      typing: { ai: resonaTypingState(false) },
      resolvedAt: FieldValue.serverTimestamp(),
      resolvedBy: uid,
      endedAt: FieldValue.serverTimestamp(),
      endedBy: uid,
      humanRequested: true,
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: 'Chat ended.'
    }, { merge: true })
    addSystemMessage(transaction, threadRef, 'Chat ended.', {
      event: 'thread_ended',
      endedBy: uid,
      endedByType: staff ? 'agent' : 'user'
    })
  })

  return { ok: true, threadId, alreadyResolved }
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
  const resonaThreads = await listEscalatedResonaThreads({ status, limitCount }).catch(() => [])
  const filtered = threads.filter((thread) => {
    if (status === 'all') return true
    if (status === 'active') return thread.status !== 'resolved'
    return thread.status === status
  })

  const merged = [...filtered, ...resonaThreads]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, limitCount)
  return { ok: true, threads: merged, total: merged.length }
})

const handleSupportAiReply = onDocumentCreated({
  document: 'supportThreads/{threadId}/messages/{messageId}',
  secrets: [SUPPORT_AI_API_KEY],
  timeoutSeconds: 90,
  memory: '256MiB'
}, async (event) => {
  const message = event.data?.data() || {}
  const threadId = cleanString(event.params?.threadId || '', 180)
  const messageId = cleanString(event.params?.messageId || '', 180)
  logSupportAi(threadId, 'trigger_invoked', {
    lastUserMessageId: messageId,
    senderType: cleanString(message.senderType || '', 40)
  })
  if (message.senderType !== 'user') {
    logSupportAi(threadId, 'skipped', {
      lastUserMessageId: messageId,
      skippedReason: 'non_user_trigger',
      senderType: cleanString(message.senderType || '', 40)
    })
    return
  }
  if (!threadId || !messageId) {
    logSupportAi(threadId, 'skipped', {
      lastUserMessageId: messageId,
      skippedReason: 'missing_params'
    })
    return
  }
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
  if (isResonaThreadId(threadId)) return listResonaMessagesForSupport({ request, threadId })
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
  endSupportThread,
  requestSupportAgent,
  listSupportThreads,
  listSupportMessages,
  handleSupportAiReply,
  __test: {
    sanitizeSafeContext,
    cleanSupportMessageBody,
    handleSupportAiReplyForMessage
  }
}
