import { collection, limit, onSnapshot, query } from 'firebase/firestore'
import { db } from '../firebase/firestore'

export function subscribeToInboxUnreadCount(uid, callback, onError) {
  if (!db || !uid || typeof callback !== 'function') return () => {}
  const inboxQuery = query(collection(db, 'users', uid, 'inboxThreads'), limit(100))
  return onSnapshot(
    inboxQuery,
    (snapshot) => {
      const unreadCount = snapshot.docs.reduce(
        (total, entry) => total + Math.max(0, Number(entry.data()?.unreadCount || 0)),
        0
      )
      callback(unreadCount)
    },
    onError
  )
}
