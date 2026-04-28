import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'

export async function userOwnsProduct(uid = '', productId = '') {
  if (!db || !uid || !productId) return false
  const snapshot = await getDoc(doc(db, 'users', uid, 'entitlements', productId))
  return snapshot.exists()
}

export async function claimFreeProduct(uid = '', productId = '') {
  if (!db || !uid || !productId) throw new Error('Missing uid or productId for free claim.')
  await setDoc(doc(db, 'users', uid, 'entitlements', productId), {
    uid,
    productId,
    source: 'free-claim',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true })
  return true
}

export async function createProductDownloadUrl(productId = '', fileId = '') {
  if (!productId || !fileId) return ''
  // TODO: replace placeholder with callable cloud function that returns a signed URL.
  return ''
}
