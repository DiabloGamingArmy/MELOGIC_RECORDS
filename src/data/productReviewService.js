import { addDoc, collection, doc, getDoc, getDocs, increment, limit, orderBy, query, runTransaction, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'

function normalizeReview(id, raw = {}) {
  return { id, ...raw }
}

export async function listProductReviews(productId, { limitCount = 20 } = {}) {
  if (!productId) return []
  const q = query(collection(db, 'products', productId, 'reviews'), orderBy('createdAt', 'desc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map((d) => normalizeReview(d.id, d.data())).filter((review) => review.deleted !== true)
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

export async function getReviewReactionStates(productId, reviewIds = [], user = null) {
  if (!productId || !user?.uid || !reviewIds.length) return {}
  const entries = await Promise.all(reviewIds.map(async (reviewId) => {
    try {
      const snap = await getDoc(doc(db, 'products', productId, 'reviews', reviewId, 'reactions', user.uid))
      return [reviewId, snap.exists() ? snap.data()?.reaction || null : null]
    } catch (error) {
      console.warn('[productReviewService] reaction read skipped', { reviewId, code: error?.code, message: error?.message })
      return [reviewId, null]
    }
  }))
  return Object.fromEntries(entries)
}

export async function setProductReviewReaction(productId, reviewId, user, reaction = null) {
  if (!user?.uid) throw new Error('auth-required')
  if (!productId || !reviewId) throw new Error('review-required')
  const next = reaction === 'like' || reaction === 'dislike' ? reaction : null
  const reviewRef = doc(db, 'products', productId, 'reviews', reviewId)
  const reactionRef = doc(db, 'products', productId, 'reviews', reviewId, 'reactions', user.uid)
  return runTransaction(db, async (tx) => {
    const [reviewSnap, reactionSnap] = await Promise.all([tx.get(reviewRef), tx.get(reactionRef)])
    if (!reviewSnap.exists()) throw new Error('review-not-found')
    const prev = reactionSnap.exists() ? reactionSnap.data()?.reaction || null : null
    if (prev === next) return prev
    const likeDelta = (prev === 'like' ? -1 : 0) + (next === 'like' ? 1 : 0)
    const dislikeDelta = (prev === 'dislike' ? -1 : 0) + (next === 'dislike' ? 1 : 0)
    tx.update(reviewRef, { likeCount: increment(likeDelta), dislikeCount: increment(dislikeDelta), updatedAt: serverTimestamp() })
    if (!next) tx.delete(reactionRef)
    else tx.set(reactionRef, { uid: user.uid, reaction: next, createdAt: reactionSnap.exists() ? reactionSnap.data()?.createdAt || serverTimestamp() : serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true })
    return next
  })
}

export async function listProductReviewReplies(productId, reviewId, { limitCount = 10 } = {}) {
  if (!productId || !reviewId) return []
  const q = query(collection(db, 'products', productId, 'reviews', reviewId, 'replies'), orderBy('createdAt', 'asc'), limit(limitCount))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((reply) => reply.deleted !== true)
}

export async function createProductReviewReply(productId, reviewId, user, profile = {}, { body = '' } = {}) {
  if (!user?.uid) throw new Error('auth-required')
  const trimmed = String(body || '').trim()
  if (!trimmed) throw new Error('reply-body-required')
  const reviewRef = doc(db, 'products', productId, 'reviews', reviewId)
  const payload = { productId, reviewId, uid: user.uid, displayName: profile.displayName || user.displayName || 'User', username: profile.username || '', avatarURL: profile.avatarURL || user.photoURL || '', body: trimmed, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), edited: false, deleted: false }
  const replyRef = await addDoc(collection(db, 'products', productId, 'reviews', reviewId, 'replies'), payload)
  await Promise.all([updateDoc(replyRef, { id: replyRef.id }), updateDoc(reviewRef, { replyCount: increment(1), updatedAt: serverTimestamp() })])
  return { id: replyRef.id, ...payload }
}
