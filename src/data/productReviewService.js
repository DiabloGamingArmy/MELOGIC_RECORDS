import { addDoc, collection, doc, getDoc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'

function normalizeReview(id, raw = {}) {
  return { id, ...raw }
}

export async function listProductReviews(productId, { limitCount = 20 } = {}) {
  if (!productId) return []
  const q = query(collection(db, 'products', productId, 'reviews'), where('deleted', '==', false), orderBy('createdAt', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map((d) => normalizeReview(d.id, d.data()))
}

export async function createProductReview(productId, user, profile = {}, { rating = null, body = '' } = {}) {
  if (!user?.uid) throw new Error('auth-required')
  const trimmed = String(body || '').trim()
  if (!trimmed) throw new Error('review-body-required')
  const parsedRating = Number(rating)
  const numericRating = Number.isFinite(parsedRating) && parsedRating >= 0.5 && parsedRating <= 5 ? Math.round(parsedRating * 2) / 2 : null
  const payload = {
    productId,
    uid: user.uid,
    displayName: profile.displayName || user.displayName || 'User',
    username: profile.username || user.username || '',
    avatarURL: profile.avatarURL || user.photoURL || '',
    rating: numericRating && numericRating >= 1 && numericRating <= 5 ? numericRating : null,
    body: trimmed,
    likeCount: 0,
    replyCount: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    edited: false,
    deleted: false
  }
  const ref = await addDoc(collection(db, 'products', productId, 'reviews'), payload)
  await updateDoc(ref, { id: ref.id })
  return { id: ref.id, ...payload }
}

export async function updateProductReview(productId, reviewId, user, { rating = null, body = '' } = {}) {
  const ref = doc(db, 'products', productId, 'reviews', reviewId)
  const snap = await getDoc(ref)
  if (!snap.exists() || snap.data()?.uid !== user?.uid) throw new Error('forbidden')
  await updateDoc(ref, { rating: rating ?? null, body: String(body || '').trim(), updatedAt: serverTimestamp(), edited: true })
}

export async function deleteProductReview(productId, reviewId, user) {
  const ref = doc(db, 'products', productId, 'reviews', reviewId)
  const snap = await getDoc(ref)
  if (!snap.exists() || snap.data()?.uid !== user?.uid) throw new Error('forbidden')
  await updateDoc(ref, { deleted: true, body: '', updatedAt: serverTimestamp() })
}
