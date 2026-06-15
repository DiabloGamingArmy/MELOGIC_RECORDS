const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { assertPermission, cleanString, getRequesterClaims } = require('../admin/adminAuth')

const db = getFirestore()
const ACTIVE_STATUSES = new Set(['open', 'waiting_for_agent', 'assigned'])
const STATUS_VALUES = new Set(['open', 'waiting_for_agent', 'assigned', 'resolved'])
const MAX_BODY_LENGTH = 1200

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

const createSupportThread = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
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
    const status = initialMessage ? 'waiting_for_agent' : 'open'
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: initialMessage || 'Support request opened.',
      resolvedAt: null,
      resolvedBy: null
    })
    addSystemMessage(transaction, threadRef, 'Support request opened.', { event: 'thread_opened' })
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

const requestSupportAgent = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
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
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessagePreview: 'Live agent requested.'
    }, { merge: true })
    addSystemMessage(transaction, threadRef, 'A live agent has been requested.', { event: 'agent_requested' })
  })

  return { ok: true, threadId }
})

const sendSupportMessage = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = assertSignedIn(request)
  const staff = isSupportStaff(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  const body = cleanBody(request.data?.body || '')
  if (!threadId) throw new HttpsError('invalid-argument', 'Support thread is required.')

  const threadRef = db.collection('supportThreads').doc(threadId)
  const messageRef = threadRef.collection('messages').doc()
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
    } else if (thread.status === 'open') {
      update.status = 'waiting_for_agent'
    }

    transaction.set(messageRef, {
      senderUid: uid,
      senderType,
      body,
      createdAt: FieldValue.serverTimestamp(),
      metadata: {}
    })
    transaction.set(threadRef, update, { merge: true })
  })

  return { ok: true, threadId, messageId: messageRef.id }
})

const claimSupportThread = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
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

const resolveSupportThread = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
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

const listSupportThreads = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
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

const listSupportMessages = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
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
  listSupportMessages
}
