import { deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/firestore'

function productRef(productId) {
  return doc(db, 'products', String(productId || ''))
}

export async function getUserProductEngagementState(productId, uid) {
  if (!productId || !uid) return { reaction: null, saved: false }
  const [reactionSnap, savedSnap] = await Promise.all([
    getDoc(doc(db, 'products', productId, 'reactions', uid)),
    getDoc(doc(db, 'users', uid, 'savedProducts', productId))
  ])
  return {
    reaction: reactionSnap.exists() ? (reactionSnap.data()?.reaction || null) : null,
    saved: savedSnap.exists()
  }
}

export async function setProductReaction(productId, uid, nextReaction) {
  const normalized = nextReaction === 'like' || nextReaction === 'dislike' ? nextReaction : null
  const reactionRef = doc(db, 'products', productId, 'reactions', uid)
  const currentSnap = await getDoc(reactionRef)
  const prev = currentSnap.exists() ? (currentSnap.data()?.reaction || null) : null
  if (prev === normalized) return { reaction: normalized }

  const batch = writeBatch(db)
  batch.set(reactionRef, { uid, reaction: normalized, updatedAt: serverTimestamp() }, { merge: true })

  const likeDelta = (normalized === 'like' ? 1 : 0) - (prev === 'like' ? 1 : 0)
  const dislikeDelta = (normalized === 'dislike' ? 1 : 0) - (prev === 'dislike' ? 1 : 0)
  const updates = {}
  if (likeDelta) {
    updates.likeCount = increment(likeDelta)
    updates['counts.likes'] = increment(likeDelta)
  }
  if (dislikeDelta) {
    updates.dislikeCount = increment(dislikeDelta)
    updates['counts.dislikes'] = increment(dislikeDelta)
  }
  if (Object.keys(updates).length) batch.set(productRef(productId), updates, { merge: true })
  await batch.commit()
  return { reaction: normalized }
}

export async function setProductSaved(productId, uid, shouldSave) {
  const saveRef = doc(db, 'users', uid, 'savedProducts', productId)
  const existing = await getDoc(saveRef)
  if (Boolean(shouldSave) === existing.exists()) return { saved: Boolean(shouldSave) }

  const batch = writeBatch(db)
  if (shouldSave) {
    batch.set(saveRef, { productId, savedAt: serverTimestamp() }, { merge: true })
    batch.set(productRef(productId), { saveCount: increment(1), 'counts.saves': increment(1) }, { merge: true })
  } else {
    batch.delete(saveRef)
    batch.set(productRef(productId), { saveCount: increment(-1), 'counts.saves': increment(-1) }, { merge: true })
  }
  await batch.commit()
  return { saved: Boolean(shouldSave) }
}
