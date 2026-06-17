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
  return raw.slice(0, 120).map((entry) => {
    const source = entry && typeof entry === 'object' && !Array.isArray(entry) ? entry : {}
    const rect = source.rect && typeof source.rect === 'object' ? source.rect : source
    const id = cleanString(source.guideId || source.id || '', 120)
    return {
      guideId: id,
      id,
      label: cleanString(source.label || '', 120),
      role: cleanString(source.role || '', 60),
      entityId: cleanString(source.entityId || '', 120),
      text: cleanString(source.text || '', 180),
      visible: source.visible !== false,
      rect: {
        x: sanitizeNumber(rect.x, 0, 10000),
        y: sanitizeNumber(rect.y, 0, 10000),
        width: sanitizeNumber(rect.width, 0, 10000),
        height: sanitizeNumber(rect.height, 0, 10000)
      },
      x: sanitizeNumber(rect.x, 0, 10000),
      y: sanitizeNumber(rect.y, 0, 10000),
      width: sanitizeNumber(rect.width, 0, 10000),
      height: sanitizeNumber(rect.height, 0, 10000)
    }
  }).filter((entry) => entry.label || entry.id)
}

function sanitizePageContext(raw = {}) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  const viewport = source.viewport && typeof source.viewport === 'object' ? source.viewport : {}
  const scroll = source.scroll && typeof source.scroll === 'object' ? source.scroll : {}
  const pageSnapshotSource = source.pageSnapshot && typeof source.pageSnapshot === 'object' && !Array.isArray(source.pageSnapshot)
    ? source.pageSnapshot
    : null
  const pageSnapshot = pageSnapshotSource ? {
    type: cleanString(pageSnapshotSource.type || 'safe_dom_page_snapshot', 80),
    captureKind: cleanString(pageSnapshotSource.captureKind || 'structured_layout', 80),
    screenshotAvailable: pageSnapshotSource.screenshotAvailable === true,
    captureTarget: cleanString(pageSnapshotSource.captureTarget || '', 80),
    excluded: Array.isArray(pageSnapshotSource.excluded) ? pageSnapshotSource.excluded.map((item) => cleanString(item, 80)).filter(Boolean).slice(0, 12) : [],
    viewport: pageSnapshotSource.viewport && typeof pageSnapshotSource.viewport === 'object' ? {
      width: sanitizeNumber(pageSnapshotSource.viewport.width, 0, 10000),
      height: sanitizeNumber(pageSnapshotSource.viewport.height, 0, 10000)
    } : null,
    regions: Array.isArray(pageSnapshotSource.regions) ? pageSnapshotSource.regions.map((item) => ({
      id: cleanString(item?.id || '', 120),
      label: cleanString(item?.label || '', 120),
      role: cleanString(item?.role || '', 60),
      text: cleanString(item?.text || '', 180),
      rect: item?.rect && typeof item.rect === 'object' ? {
        x: sanitizeNumber(item.rect.x, 0, 10000),
        y: sanitizeNumber(item.rect.y, 0, 10000),
        width: sanitizeNumber(item.rect.width, 0, 10000),
        height: sanitizeNumber(item.rect.height, 0, 10000)
      } : null
    })).filter((item) => item.id || item.label || item.text).slice(0, 50) : []
  } : null
  return {
    shareMode: source.shareMode === 'site_only' ? 'site_only' : 'site_only',
    route: cleanString(source.route || source.currentRoute || '', 240),
    pathname: cleanString(source.pathname || '', 200),
    currentRoute: cleanString(source.currentRoute || source.route || '', 240),
    routeLabel: cleanString(source.routeLabel || '', 120),
    pageTitle: cleanString(source.pageTitle || '', 200),
    featureArea: cleanString(source.featureArea || '', 120),
    contextType: cleanString(source.contextType || '', 80),
    contextId: cleanString(source.contextId || '', 180),
    contextLabel: cleanString(source.contextLabel || '', 140),
    activeModal: cleanString(source.activeModal || '', 120),
    clientTimeZone: cleanString(source.clientTimeZone || source.timeZone || '', 80),
    clientLocalTimeISO: cleanString(source.clientLocalTimeISO || '', 80),
    utcTimeISO: cleanString(source.utcTimeISO || '', 80),
    viewport: {
      width: sanitizeNumber(viewport.width, 0, 10000),
      height: sanitizeNumber(viewport.height, 0, 10000)
    },
    scroll: {
      x: sanitizeNumber(scroll.x, 0, 100000),
      y: sanitizeNumber(scroll.y, 0, 100000)
    },
    visibleGuideTargets: sanitizeLandmarks(source.visibleGuideTargets || source.landmarks),
    landmarks: sanitizeLandmarks(source.landmarks || source.visibleGuideTargets),
    pageSnapshot
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
    contextType: data.contextType || '',
    contextId: data.contextId || '',
    contextLabel: data.contextLabel || '',
    status: data.status || 'active',
    consentGranted: data.consentGranted === true,
    shareMode: data.shareMode || 'site_only',
    currentRoute: data.currentRoute || '',
    routeLabel: data.routeLabel || '',
    pageTitle: data.pageTitle || '',
    featureArea: data.featureArea || '',
    activeModal: data.activeModal || '',
    clientTimeZone: data.clientTimeZone || '',
    clientLocalTimeISO: data.clientLocalTimeISO || '',
    utcTimeISO: data.utcTimeISO || '',
    viewport: data.viewport || { width: 0, height: 0 },
    scroll: data.scroll || { x: 0, y: 0 },
    visibleGuideTargets: Array.isArray(data.visibleGuideTargets) ? data.visibleGuideTargets : (Array.isArray(data.landmarks) ? data.landmarks : []),
    landmarks: Array.isArray(data.landmarks) ? data.landmarks : (Array.isArray(data.visibleGuideTargets) ? data.visibleGuideTargets : []),
    pageSnapshot: data.pageSnapshot && typeof data.pageSnapshot === 'object' ? data.pageSnapshot : null,
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
  const requestedContextType = cleanString(request.data?.contextType || '', 80)
  const requestedContextId = cleanString(request.data?.contextId || '', 180)
  const requestedContextLabel = cleanString(request.data?.contextLabel || '', 140)
  if (!threadId) throw new HttpsError('invalid-argument', 'Conversation is required.')
  await loadAccessibleThread({ request, uid, threadId, threadKind })
  const page = sanitizePageContext(request.data?.pageContext || {})
  const contextType = page.contextType || requestedContextType
  const contextId = page.contextId || requestedContextId
  const contextLabel = page.contextLabel || requestedContextLabel
  const existingSnapshot = await db.collection('supportGuidanceSessions')
    .where('threadId', '==', threadId)
    .where('userUid', '==', uid)
    .where('shareMode', '==', 'site_only')
    .where('status', 'in', ['active', 'paused'])
    .limit(10)
    .get()
    .catch(() => null)
  if (existingSnapshot && !existingSnapshot.empty) {
    const existingDoc = existingSnapshot.docs.slice().sort((a, b) => {
      const aTime = a.data()?.updatedAt?.toMillis?.() || 0
      const bTime = b.data()?.updatedAt?.toMillis?.() || 0
      return bTime - aTime
    })[0]
    await existingDoc.ref.set({
      threadKind,
      viewer,
      contextType,
      contextId,
      contextLabel,
      status: 'active',
      currentRoute: page.currentRoute,
      routeLabel: page.routeLabel,
      pageTitle: page.pageTitle,
      featureArea: page.featureArea,
      activeModal: page.activeModal,
      viewport: page.viewport,
      scroll: page.scroll,
      visibleGuideTargets: page.visibleGuideTargets,
      landmarks: page.landmarks,
      updatedAt: FieldValue.serverTimestamp(),
      stoppedAt: null
    }, { merge: true })
    const existing = await existingDoc.ref.get()
    return { ok: true, reused: true, session: serializeSession(existing) }
  }
  const sessionRef = db.collection('supportGuidanceSessions').doc()
  await sessionRef.set({
    threadId,
    threadKind,
    userUid: uid,
    viewer,
    contextType,
    contextId,
    contextLabel,
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
    visibleGuideTargets: page.visibleGuideTargets,
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
    contextType: page.contextType || session.contextType || '',
    contextId: page.contextId || session.contextId || '',
    contextLabel: page.contextLabel || session.contextLabel || '',
    activeModal: page.activeModal,
    viewport: page.viewport,
    scroll: page.scroll,
    visibleGuideTargets: page.visibleGuideTargets,
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

function stableActionKey(value = '') {
  const key = cleanString(value || '', 500)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 420)
  return key || `highlight-${Date.now()}`
}

function scoreHighlightMatch(intent = {}, entry = {}) {
  const guideId = normalizeMatchText(entry.guideId || entry.id || '')
  const label = normalizeMatchText(entry.label || '')
  const role = normalizeMatchText(entry.role || '')
  const text = normalizeMatchText(entry.text || '')
  const targetGuideId = normalizeMatchText(intent.targetGuideId || intent.guideId || '')
  const targetText = normalizeMatchText(intent.fallbackText || intent.text || intent.label || '')
  const combined = normalizeMatchText(`${entry.label || ''} ${entry.text || ''} ${entry.guideId || entry.id || ''}`)
  const wantsSide = /\b(left|sidebar|side|nav|navigation|tab|button)\b/i.test(`${intent.fallbackText || ''} ${intent.text || ''} ${intent.label || ''}`)
  let score = 0
  if (targetGuideId && guideId === targetGuideId) score += 1000
  if (targetText && label === targetText) score += 700
  if (targetText && guideId === targetText) score += 650
  if (targetText && `${label} ${role}`.trim() === targetText) score += 540
  if (targetText && label.includes(targetText)) score += 420
  if (targetText && targetText.includes(label) && label) score += 380
  if (targetText && combined.includes(targetText)) score += 260
  if (wantsSide && /\b(sidebar|nav|navigation|filter)\b/.test(role)) score += 160
  if (/\bbutton|link|nav|card|filter|conversation\b/.test(role)) score += 40
  return score
}

function resolveHighlightRect(intent = {}, landmarks = []) {
  const targetType = intent.targetType || ''
  const targetGuideId = cleanString(intent.targetGuideId || intent.guideId || '', 120)
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
  if ((targetType === 'guideId' || targetGuideId) && targetGuideId) {
    const match = rows.find((entry) => cleanString(entry.guideId || entry.id || '', 120) === targetGuideId)
    if (match) return { ...match, label: cleanString(intent.label || match.label || 'Guidance highlight', 120) }
  }
  const targetText = normalizeMatchText(intent.fallbackText || intent.text || intent.label || targetGuideId || '')
  if (targetText) {
    const scored = rows
      .map((entry) => ({ entry, score: scoreHighlightMatch(intent, entry) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
    if (scored[0]) {
      const match = scored[0].entry
      return { ...match, label: cleanString(intent.label || match.label || 'Guidance highlight', 120) }
    }
  }
  return null
}

async function createGuidanceOverlayFromIntent({
  sessionId = '',
  intent = {},
  landmarks = [],
  threadId = '',
  sourceMessageId = '',
  sourceUserMessageId = '',
  actionIndex = 0
} = {}) {
  const cleanSessionId = cleanString(sessionId || '', 180)
  if (!cleanSessionId || !intent || intent.action !== 'highlight') return null
  const rect = resolveHighlightRect(intent, landmarks)
  if (!rect) {
    console.info('[highlight] no match', {
      sessionId: cleanSessionId,
      targetGuideId: cleanString(intent.targetGuideId || intent.guideId || '', 120),
      label: cleanString(intent.label || intent.fallbackText || intent.text || '', 120),
      landmarkCount: Array.isArray(landmarks) ? landmarks.length : 0
    })
    return null
  }
  const now = Date.now()
  const durationMs = Math.max(1200, Math.min(8000, Math.round(Number(intent.durationMs || 5000) || 5000)))
  const targetGuideId = cleanString(intent.targetGuideId || intent.guideId || rect.guideId || rect.id || '', 120)
  const fallbackText = cleanString(intent.fallbackText || intent.text || rect.label || intent.label || '', 160)
  const actionId = stableActionKey(intent.actionId || [
    threadId,
    sourceMessageId || sourceUserMessageId,
    actionIndex,
    targetGuideId || fallbackText || rect.label || 'target'
  ].filter(Boolean).join('__'))
  const overlayRef = db.collection('supportGuidanceSessions').doc(cleanSessionId).collection('overlays').doc(actionId)
  const existing = await overlayRef.get()
  if (existing.exists) return overlayRef.id
  console.info('[highlight] resolved', {
    sessionId: cleanSessionId,
    targetGuideId,
    label: cleanString(rect.label || intent.label || '', 120),
    role: cleanString(rect.role || '', 80),
    entityId: cleanString(rect.entityId || '', 120)
  })
  await overlayRef.set({
    type: 'box',
    source: 'resona',
    targetGuideId,
    fallbackText,
    actionId,
    sourceMessageId: cleanString(sourceMessageId || '', 180),
    sourceUserMessageId: cleanString(sourceUserMessageId || '', 180),
    x: sanitizeNumber(rect.x, 0, 10000),
    y: sanitizeNumber(rect.y, 0, 10000),
    width: sanitizeNumber(rect.width, 20, 10000),
    height: sanitizeNumber(rect.height, 20, 10000),
    label: cleanString(rect.label || intent.label || 'Guidance highlight', 120),
    durationMs,
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
    contextType: session.contextType || '',
    contextId: session.contextId || '',
    contextLabel: session.contextLabel || '',
    activeModal: session.activeModal,
    viewport: session.viewport,
    scroll: session.scroll,
    visibleGuideTargets: session.visibleGuideTargets,
    landmarks: session.landmarks,
    pageSnapshot: session.pageSnapshot
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
