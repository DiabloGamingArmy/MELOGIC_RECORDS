import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

const callSetProductReaction = httpsCallable(functions, 'setProductReaction')
const callSetProductSaved = httpsCallable(functions, 'setProductSaved')

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

export async function setProductReaction(productId, nextReaction) {
  const normalized = nextReaction === 'like' || nextReaction === 'dislike' ? nextReaction : null
  const response = await callSetProductReaction({ productId, reaction: normalized })
  return response?.data || { reaction: normalized, likeDelta: 0, dislikeDelta: 0 }
}

export async function setProductSaved(productId, shouldSave) {
  const response = await callSetProductSaved({ productId, saved: Boolean(shouldSave) })
  return response?.data || { saved: Boolean(shouldSave), saveDelta: 0 }
}
