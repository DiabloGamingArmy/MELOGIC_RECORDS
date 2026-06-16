import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query
} from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

function callable(name, payload = {}) {
  if (!functions) throw new Error('Functions are not configured.')
  return httpsCallable(functions, name)(payload)
    .then((response) => response?.data || {})
    .catch((error) => {
      console.error(`[site-guidance] ${name} failed`, {
        code: error?.code,
        message: error?.message,
        details: error?.details
      })
      throw error
    })
}

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeSession(sessionId = '', raw = {}) {
  return {
    id: String(raw.id || sessionId || '').trim(),
    threadId: String(raw.threadId || '').trim(),
    threadKind: raw.threadKind === 'support' ? 'support' : 'thread',
    userUid: String(raw.userUid || '').trim(),
    viewer: raw.viewer === 'agent' ? 'agent' : 'resona',
    status: ['active', 'paused', 'stopped'].includes(raw.status) ? raw.status : 'active',
    shareMode: raw.shareMode === 'site_only' ? 'site_only' : 'site_only',
    currentRoute: String(raw.currentRoute || '').trim(),
    routeLabel: String(raw.routeLabel || '').trim(),
    pageTitle: String(raw.pageTitle || '').trim(),
    featureArea: String(raw.featureArea || '').trim(),
    activeModal: String(raw.activeModal || '').trim(),
    viewport: raw.viewport && typeof raw.viewport === 'object' ? raw.viewport : { width: 0, height: 0 },
    scroll: raw.scroll && typeof raw.scroll === 'object' ? raw.scroll : { x: 0, y: 0 },
    landmarks: Array.isArray(raw.landmarks) ? raw.landmarks : [],
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    stoppedAt: toIsoDate(raw.stoppedAt)
  }
}

function normalizeOverlay(overlayId = '', raw = {}) {
  return {
    id: String(raw.id || overlayId || '').trim(),
    type: raw.type === 'box' ? 'box' : 'box',
    source: raw.source === 'agent' ? 'agent' : 'resona',
    x: Number(raw.x || 0),
    y: Number(raw.y || 0),
    width: Number(raw.width || 0),
    height: Number(raw.height || 0),
    label: String(raw.label || '').trim(),
    createdAt: toIsoDate(raw.createdAt),
    expiresAt: toIsoDate(raw.expiresAt)
  }
}

export async function startSiteGuidanceSession({ threadId = '', threadKind = 'thread', viewer = 'resona', pageContext = {} } = {}) {
  const result = await callable('startSiteGuidanceSession', {
    threadId: String(threadId || '').trim(),
    threadKind: threadKind === 'support' ? 'support' : 'thread',
    viewer: viewer === 'agent' ? 'agent' : 'resona',
    pageContext
  })
  return {
    ...result,
    session: result.session ? normalizeSession(result.session.id, result.session) : null
  }
}

export function updateSiteGuidanceSession({ sessionId = '', pageContext = {} } = {}) {
  return callable('updateSiteGuidanceSession', {
    sessionId: String(sessionId || '').trim(),
    pageContext
  })
}

export function setSiteGuidanceSessionStatus({ sessionId = '', status = '' } = {}) {
  return callable('setSiteGuidanceSessionStatus', {
    sessionId: String(sessionId || '').trim(),
    status: String(status || '').trim()
  })
}

export function subscribeToGuidanceSession(sessionId = '', callback, onError) {
  if (!db || !sessionId) return () => {}
  return onSnapshot(doc(db, 'supportGuidanceSessions', sessionId), (snap) => {
    callback(snap.exists() ? normalizeSession(snap.id, snap.data()) : null)
  }, onError)
}

export function subscribeToGuidanceOverlays(sessionId = '', callback, onError) {
  if (!db || !sessionId) return () => {}
  const overlaysQuery = query(
    collection(db, 'supportGuidanceSessions', sessionId, 'overlays'),
    orderBy('createdAt', 'desc'),
    limit(20)
  )
  return onSnapshot(overlaysQuery, (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeOverlay(docSnap.id, docSnap.data())).filter((overlay) => overlay.type === 'box'))
  }, onError)
}
