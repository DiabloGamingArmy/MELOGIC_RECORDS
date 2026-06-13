import { collection, doc, getDocs, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeEvent(id, raw = {}) {
  return {
    id,
    eventId: raw.eventId || id,
    type: raw.type || 'security_notice',
    severity: raw.severity || 'info',
    title: raw.title || 'Account update',
    message: raw.message || '',
    summary: raw.summary || raw.message || '',
    actorUid: raw.actorUid || '',
    actorUsername: raw.actorUsername || '',
    actorType: raw.actorType || '',
    source: raw.source || '',
    path: raw.path || '',
    emailSent: raw.emailSent === true,
    emailSentAt: raw.emailSentAt || '',
    emailSkipped: raw.emailSkipped === true,
    emailSkipReason: raw.emailSkipReason || '',
    emailError: raw.emailError || '',
    metadata: raw.metadataSafe || raw.metadata || {},
    createdAt: toIsoDate(raw.createdAt),
    readAt: toIsoDate(raw.readAt),
    hiddenAt: toIsoDate(raw.hiddenAt)
  }
}

function accountEventsQuery(uid, limitCount = 50) {
  return query(
    collection(db, 'users', uid, 'accountEvents'),
    orderBy('createdAt', 'desc'),
    limit(Math.min(Math.max(Number(limitCount) || 50, 1), 100))
  )
}

export async function listAccountEvents(uid, { limitCount = 50 } = {}) {
  if (!db || !uid) return []
  const snapshot = await getDocs(accountEventsQuery(uid, limitCount))
  return snapshot.docs
    .map((docSnap) => normalizeEvent(docSnap.id, docSnap.data()))
    .filter((event) => !event.hiddenAt)
}

export function subscribeToAccountEvents(uid, callback, onError, { limitCount = 50 } = {}) {
  if (!db || !uid || typeof callback !== 'function') return () => {}
  return onSnapshot(accountEventsQuery(uid, limitCount), (snapshot) => {
    callback(snapshot.docs
      .map((docSnap) => normalizeEvent(docSnap.id, docSnap.data()))
      .filter((event) => !event.hiddenAt))
  }, onError)
}

export async function setAccountEventRead(uid, eventId, read = true) {
  if (!db || !uid || !eventId) return false
  await updateDoc(doc(db, 'users', uid, 'accountEvents', eventId), {
    readAt: read ? serverTimestamp() : null
  })
  return true
}

export async function markAccountEventRead(uid, eventId) {
  return setAccountEventRead(uid, eventId, true)
}

export async function hideAccountEvent(uid, eventId) {
  if (!db || !uid || !eventId) return false
  await updateDoc(doc(db, 'users', uid, 'accountEvents', eventId), {
    hiddenAt: serverTimestamp()
  })
  return true
}

export async function markAllAccountEventsRead(uid, events = []) {
  if (!db || !uid || !events.length) return false
  const batch = writeBatch(db)
  const unread = events
    .filter((event) => event?.id && !event.readAt)
    .slice(0, 100)
  if (!unread.length) return false
  unread.forEach((event) => {
    batch.update(doc(db, 'users', uid, 'accountEvents', event.id), {
      readAt: serverTimestamp()
    })
  })
  await batch.commit()
  return true
}

export async function recordAccountSecurityEvent(type, payload = {}) {
  const callable = httpsCallable(functions, 'recordAccountSecurityEvent')
  const result = await callable({ type, ...payload })
  return result?.data || { ok: false }
}
