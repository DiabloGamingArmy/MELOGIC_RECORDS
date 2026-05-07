import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

const callSetProductEngagement = httpsCallable(functions, 'setProductEngagement')
const callSetProductReaction = httpsCallable(functions, 'setProductReaction')
const callSetProductSaved = httpsCallable(functions, 'setProductSaved')

function safeCount(value) { return Math.max(0, Number(value || 0)) }

export async function getProductEngagementState(productId, uid) {
  if (!productId) return { reaction: null, saved: false, likeCount: 0, dislikeCount: 0, saveCount: 0 }
  const summaryRef = doc(db, 'productEngagement', productId)
  const userRef = uid ? doc(db, 'productEngagement', productId, 'users', uid) : null
  const [summarySnap, userSnap] = await Promise.all([getDoc(summaryRef), userRef ? getDoc(userRef) : Promise.resolve(null)])

  if (summarySnap.exists()) {
    const summary = summarySnap.data() || {}
    const userData = userSnap?.exists() ? (userSnap.data() || {}) : {}
    return {
      reaction: userData.reaction === 'like' || userData.reaction === 'dislike' ? userData.reaction : null,
      saved: Boolean(userData.saved),
      likeCount: safeCount(summary.likeCount),
      dislikeCount: safeCount(summary.dislikeCount),
      saveCount: safeCount(summary.saveCount)
    }
  }

  const productSnap = await getDoc(doc(db, 'products', productId))
  const [reactionSnap, savedSnap] = uid
    ? await Promise.all([
      getDoc(doc(db, 'products', productId, 'reactions', uid)),
      getDoc(doc(db, 'users', uid, 'savedProducts', productId))
    ])
    : [null, null]
  const product = productSnap.exists() ? (productSnap.data() || {}) : {}
  return {
    reaction: reactionSnap?.exists() ? (reactionSnap.data()?.reaction || null) : null,
    saved: Boolean(savedSnap?.exists()),
    likeCount: safeCount(product.likeCount ?? product.counts?.likes),
    dislikeCount: safeCount(product.dislikeCount ?? product.counts?.dislikes),
    saveCount: safeCount(product.saveCount ?? product.counts?.saves)
  }
}

export async function setProductEngagement(productId, options = {}) {
  const response = await callSetProductEngagement({ productId, ...options })
  return response?.data || { productId, reaction: null, saved: false, likeCount: 0, dislikeCount: 0, saveCount: 0 }
}

export async function getUserProductEngagementState(productId, uid) {
  const state = await getProductEngagementState(productId, uid)
  return { reaction: state.reaction, saved: state.saved }
}

export async function getProductReactionSummary(productId) {
  const state = await getProductEngagementState(productId, null)
  return { likeCount: state.likeCount, dislikeCount: state.dislikeCount }
}

export async function setProductReaction(productId, nextReaction) {
  const normalized = nextReaction === 'like' || nextReaction === 'dislike' ? nextReaction : null
  try {
    return await setProductEngagement(productId, { reaction: normalized, updateReaction: true, updateSaved: false })
  } catch {
    const response = await callSetProductReaction({ productId, reaction: normalized })
    return response?.data || { reaction: normalized, likeDelta: 0, dislikeDelta: 0 }
  }
}

export async function setProductSaved(productId, shouldSave) {
  try {
    return await setProductEngagement(productId, { saved: Boolean(shouldSave), updateSaved: true, updateReaction: false })
  } catch {
    const response = await callSetProductSaved({ productId, saved: Boolean(shouldSave) })
    return response?.data || { saved: Boolean(shouldSave), saveDelta: 0 }
  }
}
