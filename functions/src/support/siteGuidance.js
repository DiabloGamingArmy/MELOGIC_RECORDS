const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { FieldValue, Timestamp, getFirestore } = require('firebase-admin/firestore')
const { assertPermission, cleanString, getRequesterClaims } = require('../admin/adminAuth')

const db = getFirestore()
const CALLABLE_OPTIONS = {
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

function serializeTimestamp(value) {
  if (!value) return null
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function sanitizeNumber(value, min, max, fallback = 0) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(min, Math.min(max, Math.round(number)))
}

function sanitizeLandmarks(raw = []) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 24).map((entry) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
    return {
      id: cleanString(source.id || '', 80),
      label: cleanString(source.label || '', 120),
      role: cleanString(source.role || '', 60),
      x: sanitizeNumber(source.x, 0, 10000),
      y: sanitizeNumber(source.y, 0, 10000),
      width: sanitizeNumber(source.width, 0, 10000),
      height: sanitizeNumber(source.height, 0, 10000)
    }
  }).filter((entry) => entry.label || entry.id)
}

function sanitizePageContext(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {}
  const scroll = source.scroll && typeof source.scroll === 'object' ? source.scroll : {}
  return {
    currentRoute: cleanString(source.currentRoute || source.route || '', 240),
    routeLabel: cleanString(source.routeLabel || '', 120),
    pageTitle: cleanString(source.pageTitle || '', 200),
    featureArea: cleanString(source.featureArea || '', 120),
    activeModal: cleanString(source.activeModal || '', 120),
    viewport: {
      width: sanitizeNumber(viewport.width, 0, 10000),
      height: sanitizeNumber(viewport.height, 0, 10000)
    },
    scroll: {
      x: sanitizeNumber(scroll.x, 0, 100000),
      y: sanitizeNumber(scroll.y, 0, 100000)
    },
    landmarks: sanitizeLandmarks(source.landmarks)
  }
}

function serializeSession(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: docSnap.id,
    threadId: data.threadId || '',
    threadKind: data.threadKind || 'thread',
    userUid: data.userUid || '',
    viewer: data.viewer || 'resona',
    status: data.status || 'active',
    consentGranted: data.consentGranted === true,
    shareMode: data.shareMode || 'site_only',
    currentRoute: data.currentRoute || '',
    routeLabel: data.routeLabel || '',
    pageTitle: data.pageTitle || '',
    featureArea: data.featureArea || '',
    activeModal: data.activeModal || '',
    viewport: data.viewport || { width: 0, height: 0 },
    scroll: data.scroll || { x: 0, y: 0 },
    landmarks: Array.isArray(data.landmarks) ? data.landmarks : [],
    createdAt: serializeTimestamp(data.createdAt),
    updatedAt: serializeTimestamp(data.updatedAt),
    stoppedAt: serializeTimestamp(data.stoppedAt)
  }
}

async function loadAccessibleThread({ request, uid = '', threadId = '', threadKind = 'thread' } = {}) {
  const collectionName = threadKind === 'support' ? 'supportThreads' : 'threads'
  const snap = await db.collection(collectionName).doc(threadId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Conversation not found.')
  const data = snap.data() || {}
  const staff = isSupportStaff(request)
  const participantUids = Array.from(new Set([
    ...(Array.isArray(data.participantIds) ? data.participantIds : []),
    ...(Array.isArray(data.participantUids) ? data.participantUids : []),
    ...(Array.isArray(data.memberUids) ? data.memberUids : []),
    data.requesterUid,
    data.createdBy
  ].map((item) => cleanString(item || '', 180)).filter(Boolean)))
  if (!staff && !participantUids.includes(uid)) {
    throw new HttpsError('permission-denied', 'You do not have access to this conversation.')
  }
  return { id: snap.id, data, collectionName }
}

async function loadSessionForWrite({ request, uid = '', sessionId = '' } = {}) {
  const ref = db.collection('supportGuidanceSessions').doc(sessionId)
  const snap = await ref.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Guidance session not found.')
  const session = snap.data() || {}
  const staff = isSupportStaff(request)
  if (!staff && session.userUid !== uid) throw new HttpsError('permission-denied', 'You do not have access to this guidance session.')
  return { ref, snap, session }
}

const startSiteGuidanceSession = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const threadId = cleanString(request.data?.threadId || '', 180)
  const threadKind = request.data?.threadKind === 'support' ? 'support' : 'thread'
  const viewer = request.data?.viewer === 'agent' ? 'agent' : 'resona'
  if (!threadId) throw new HttpsError('invalid-argument', 'Conversation is required.')
  await loadAccessibleThread({ request, uid, threadId, threadKind })
  const page = sanitizePageContext(request.data?.pageContext || {})
  const sessionRef = db.collection('supportGuidanceSessions').doc()
  await sessionRef.set({
    threadId,
    threadKind,
    userUid: uid,
    viewer,
    status: 'active',
    consentGranted: true,
    shareMode: 'site_only',
    currentRoute: page.currentRoute,
    routeLabel: page.routeLabel,
    pageTitle: page.pageTitle,
    featureArea: page.featureArea,
    activeModal: page.activeModal,
    viewport: page.viewport,
    scroll: page.scroll,
    landmarks: page.landmarks,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    stoppedAt: null
  })
  const created = await sessionRef.get()
  return { ok: true, session: serializeSession(created) }
})

const updateSiteGuidanceSession = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const sessionId = cleanString(request.data?.sessionId || '', 180)
  if (!sessionId) throw new HttpsError('invalid-argument', 'Guidance session is required.')
  const { ref, session } = await loadSessionForWrite({ request, uid, sessionId })
  if (session.status !== 'active') return { ok: true, skipped: true, status: session.status || 'stopped' }
  const page = sanitizePageContext(request.data?.pageContext || {})
  await ref.set({
    currentRoute: page.currentRoute,
    routeLabel: page.routeLabel,
    pageTitle: page.pageTitle,
    featureArea: page.featureArea,
    activeModal: page.activeModal,
    viewport: page.viewport,
    scroll: page.scroll,
    landmarks: page.landmarks,
    updatedAt: FieldValue.serverTimestamp()
  }, { merge: true })
  return { ok: true, sessionId }
})

const setSiteGuidanceSessionStatus = onCall(CALLABLE_OPTIONS, async (request) => {
  const uid = assertSignedIn(request)
  const sessionId = cleanString(request.data?.sessionId || '', 180)
  const status = cleanString(request.data?.status || '', 40)
  if (!sessionId) throw new HttpsError('invalid-argument', 'Guidance session is required.')
  if (!['active', 'paused', 'stopped'].includes(status)) throw new HttpsError('invalid-argument', 'Guidance status is invalid.')
  const { ref } = await loadSessionForWrite({ request, uid, sessionId })
  await ref.set({
    status,
    updatedAt: FieldValue.serverTimestamp(),
    ...(status === 'stopped' ? { stoppedAt: FieldValue.serverTimestamp() } : {})
  }, { merge: true })
  return { ok: true, sessionId, status }
})

const createGuidanceTestOverlay = onCall(CALLABLE_OPTIONS, async (request) => {
  assertPermission(request, 'orderSupport')
  const sessionId = cleanString(request.data?.sessionId || '', 180)
  if (!sessionId) throw new HttpsError('invalid-argument', 'Guidance session is required.')
  const { ref } = await loadSessionForWrite({ request, uid: request.auth?.uid || '', sessionId })
  const overlayRef = ref.collection('overlays').doc()
  const now = Date.now()
  await overlayRef.set({
    type: 'box',
    source: 'agent',
    x: sanitizeNumber(request.data?.x, 0, 10000, 80),
    y: sanitizeNumber(request.data?.y, 0, 10000, 120),
    width: sanitizeNumber(request.data?.width, 20, 10000, 220),
    height: sanitizeNumber(request.data?.height, 20, 10000, 90),
    label: cleanString(request.data?.label || 'Guidance highlight', 120),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + 5000)
  })
  return { ok: true, sessionId, overlayId: overlayRef.id }
})

function normalizeMatchText(value = '') {
  return cleanString(value || '', 180).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function resolveHighlightRect(intent = {}, landmarks = []) {
  const targetType = intent.targetType || ''
  if (targetType === 'rect') {
    const rect = intent.rect && typeof intent.rect === 'object' ? intent.rect : intent
    const width = sanitizeNumber(rect.width, 0, 10000)
    const height = sanitizeNumber(rect.height, 0, 10000)
    if (width > 0 && height > 0) {
      return {
        x: sanitizeNumber(rect.x, 0, 10000),
        y: sanitizeNumber(rect.y, 0, 10000),
        width,
        height,
        label: cleanString(intent.label || 'Guidance highlight', 120)
      }
    }
  }
  const rows = Array.isArray(landmarks) ? landmarks : []
  if (targetType === 'guideId' && intent.guideId) {
    const match = rows.find((entry) => cleanString(entry.id || '', 120) === cleanString(intent.guideId || '', 120))
    if (match) return { ...match, label: cleanString(intent.label || match.label || 'Guidance highlight', 120) }
  }
  const targetText = normalizeMatchText(intent.text || intent.label || intent.guideId || '')
  if (targetText) {
    const match = rows.find((entry) => {
      const label = normalizeMatchText(`${entry.label || ''} ${entry.id || ''}`)
      return label === targetText || label.includes(targetText) || targetText.includes(label)
    })
    if (match) return { ...match, label: cleanString(intent.label || match.label || 'Guidance highlight', 120) }
  }
  return null
}

async function createGuidanceOverlayFromIntent({ sessionId = '', intent = {}, landmarks = [] } = {}) {
  const cleanSessionId = cleanString(sessionId || '', 180)
  if (!cleanSessionId || !intent || intent.action !== 'highlight') return null
  const rect = resolveHighlightRect(intent, landmarks)
  if (!rect) return null
  const overlayRef = db.collection('supportGuidanceSessions').doc(cleanSessionId).collection('overlays').doc()
  const now = Date.now()
  const durationMs = Math.max(1200, Math.min(8000, Math.round(Number(intent.durationMs || 5000) || 5000)))
  await overlayRef.set({
    type: 'box',
    source: 'resona',
    x: sanitizeNumber(rect.x, 0, 10000),
    y: sanitizeNumber(rect.y, 0, 10000),
    width: sanitizeNumber(rect.width, 20, 10000),
    height: sanitizeNumber(rect.height, 20, 10000),
    label: cleanString(rect.label || intent.label || 'Guidance highlight', 120),
    createdAt: FieldValue.serverTimestamp(),
    expiresAt: Timestamp.fromMillis(now + durationMs)
  })
  return overlayRef.id
}

async function loadActiveGuidanceContext({ threadId = '', userUid = '' } = {}) {
  const cleanThreadId = cleanString(threadId || '', 180)
  const cleanUid = cleanString(userUid || '', 180)
  if (!cleanThreadId || !cleanUid) return null
  const snapshot = await db.collection('supportGuidanceSessions')
    .where('threadId', '==', cleanThreadId)
    .where('userUid', '==', cleanUid)
    .where('shareMode', '==', 'site_only')
    .where('status', 'in', ['active', 'paused'])
    .limit(10)
    .get()
    .catch(() => null)
  if (!snapshot || snapshot.empty) return null
  const docs = snapshot.docs.slice().sort((a, b) => {
    const aTime = a.data()?.updatedAt?.toMillis?.() || 0
    const bTime = b.data()?.updatedAt?.toMillis?.() || 0
    return bTime - aTime
  })
  const session = serializeSession(docs[0])
  return {
    sessionId: session.id,
    guidanceSessionActive: session.status === 'active',
    guidanceSessionStatus: session.status,
    route: session.currentRoute,
    routeLabel: session.routeLabel,
    pageTitle: session.pageTitle,
    featureArea: session.featureArea,
    activeModal: session.activeModal,
    viewport: session.viewport,
    scroll: session.scroll,
    landmarks: session.landmarks
  }
}

module.exports = {
  startSiteGuidanceSession,
  updateSiteGuidanceSession,
  setSiteGuidanceSessionStatus,
  createGuidanceTestOverlay,
  loadActiveGuidanceContext,
  createGuidanceOverlayFromIntent,
  __test: {
    sanitizePageContext,
    resolveHighlightRect
  }
}
