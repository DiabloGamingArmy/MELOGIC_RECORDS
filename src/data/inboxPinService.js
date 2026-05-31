import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'

const MAX_PINS = 40

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function cleanString(value = '', max = 360) {
  return String(value || '').trim().slice(0, max)
}

export function buildInboxPinId(type = '', targetId = '') {
  const safeType = cleanString(type, 40).replace(/[^a-zA-Z0-9_-]/g, '-')
  const safeTarget = cleanString(targetId, 180).replace(/[^a-zA-Z0-9_-]/g, '-')
  return [safeType, safeTarget].filter(Boolean).join('_').slice(0, 220)
}

function normalizePin(id, raw = {}) {
  return {
    id,
    pinId: raw.pinId || id,
    type: raw.type || 'item',
    targetId: raw.targetId || '',
    title: raw.title || 'Pinned item',
    subtitle: raw.subtitle || '',
    sourceCategory: raw.sourceCategory || 'Inbox',
    targetPath: raw.targetPath || '',
    metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {},
    pinnedAt: toIsoDate(raw.pinnedAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

function pinsQuery(uid) {
  return query(collection(db, 'users', uid, 'inboxPins'), orderBy('pinnedAt', 'desc'), limit(MAX_PINS))
}

export function subscribeToInboxPins(uid, callback, onError) {
  if (!db || !uid || typeof callback !== 'function') return () => {}
  return onSnapshot(pinsQuery(uid), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizePin(docSnap.id, docSnap.data())))
  }, onError)
}

export async function upsertInboxPin(uid, pin = {}) {
  if (!db || !uid) return false
  const type = cleanString(pin.type, 40)
  const targetId = cleanString(pin.targetId, 180)
  const pinId = cleanString(pin.pinId || buildInboxPinId(type, targetId), 220)
  if (!type || !targetId || !pinId) return false
  await setDoc(doc(db, 'users', uid, 'inboxPins', pinId), {
    pinId,
    type,
    targetId,
    title: cleanString(pin.title || 'Pinned item', 180),
    subtitle: cleanString(pin.subtitle || '', 240),
    sourceCategory: cleanString(pin.sourceCategory || 'Inbox', 40),
    targetPath: cleanString(pin.targetPath || '', 600),
    metadata: pin.metadata && typeof pin.metadata === 'object' && !Array.isArray(pin.metadata) ? pin.metadata : {},
    pinnedAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return true
}

export async function deleteInboxPin(uid, pinId) {
  const id = cleanString(pinId, 220)
  if (!db || !uid || !id) return false
  await deleteDoc(doc(db, 'users', uid, 'inboxPins', id))
  return true
}
