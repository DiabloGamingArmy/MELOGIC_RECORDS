import { collection, doc, limit, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'

function toIsoDate(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function normalizeNotification(id, raw = {}) {
  return {
    id,
    type: raw.type || 'other',
    title: raw.title || 'Notification',
    body: raw.body || '',
    productId: raw.productId || '',
    productTitle: raw.productTitle || '',
    status: raw.status || '',
    actionHref: raw.actionHref || '',
    severity: raw.severity || 'info',
    createdAt: toIsoDate(raw.createdAt),
    readAt: toIsoDate(raw.readAt)
  }
}

function notificationsQuery(uid, type = 'all') {
  const base = [orderBy('createdAt', 'desc'), limit(100)]
  if (type && type !== 'all') {
    return query(collection(db, 'users', uid, 'systemNotifications'), where('type', '==', type), ...base)
  }
  return query(collection(db, 'users', uid, 'systemNotifications'), ...base)
}

export function subscribeToSystemNotifications(uid, callback, onError, type = 'all') {
  if (!db || !uid || typeof callback !== 'function') return () => {}
  return onSnapshot(notificationsQuery(uid, type), (snapshot) => {
    callback(snapshot.docs.map((docSnap) => normalizeNotification(docSnap.id, docSnap.data())))
  }, onError)
}

export async function markSystemNotificationRead(uid, notificationId) {
  if (!db || !uid || !notificationId) return false
  await updateDoc(doc(db, 'users', uid, 'systemNotifications', notificationId), {
    readAt: serverTimestamp()
  })
  return true
}
