const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

function requireAuth(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication required.')
  return uid
}

function normalizeReaction(value) {
  return value === 'like' || value === 'dislike' ? value : null
}

async function handleSetProductEngagement(request) {
  const uid = requireAuth(request)
  const productId = String(request.data?.productId || '').trim()
  if (!productId) throw new HttpsError('invalid-argument', 'productId is required.')

  const updateReaction = request.data?.updateReaction !== false
  const updateSaved = request.data?.updateSaved !== false
  const requestedReaction = normalizeReaction(request.data?.reaction)
  const requestedSaved = request.data?.saved === undefined ? undefined : Boolean(request.data?.saved)

  const db = admin.firestore()
  const productRef = db.collection('products').doc(productId)
  const summaryRef = db.collection('productEngagement').doc(productId)
  const userStateRef = summaryRef.collection('users').doc(uid)
  const legacyReactionRef = productRef.collection('reactions').doc(uid)
  const legacySaveRef = db.collection('users').doc(uid).collection('savedProducts').doc(productId)

  return db.runTransaction(async (tx) => {
    const [productSnap, summarySnap, userSnap, legacySaveSnap] = await Promise.all([
      tx.get(productRef), tx.get(summaryRef), tx.get(userStateRef), tx.get(legacySaveRef)
    ])
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')

    const product = productSnap.data() || {}
    const isOwner = product.artistId === uid
    const isPublic = product.status === 'published' && product.visibility === 'public'
    if (!isOwner && !isPublic) throw new HttpsError('permission-denied', 'Product is not available for engagement.')

    const prevReaction = normalizeReaction(userSnap.exists ? userSnap.data()?.reaction : null)
    const prevSaved = userSnap.exists ? Boolean(userSnap.data()?.saved) : legacySaveSnap.exists

    const nextReaction = updateReaction ? requestedReaction : prevReaction
    const nextSaved = updateSaved ? Boolean(requestedSaved) : prevSaved

    const likeDelta = (nextReaction === 'like' ? 1 : 0) - (prevReaction === 'like' ? 1 : 0)
    const dislikeDelta = (nextReaction === 'dislike' ? 1 : 0) - (prevReaction === 'dislike' ? 1 : 0)
    const saveDelta = (nextSaved ? 1 : 0) - (prevSaved ? 1 : 0)

    const currentLike = Math.max(0, Number(summarySnap.exists ? summarySnap.data()?.likeCount : product.likeCount ?? product.counts?.likes ?? 0))
    const currentDislike = Math.max(0, Number(summarySnap.exists ? summarySnap.data()?.dislikeCount : product.dislikeCount ?? product.counts?.dislikes ?? 0))
    const currentSave = Math.max(0, Number(summarySnap.exists ? summarySnap.data()?.saveCount : product.saveCount ?? product.counts?.saves ?? 0))

    const likeCount = Math.max(0, currentLike + likeDelta)
    const dislikeCount = Math.max(0, currentDislike + dislikeDelta)
    const saveCount = Math.max(0, currentSave + saveDelta)

    tx.set(summaryRef, { productId, likeCount, dislikeCount, saveCount, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    tx.set(userStateRef, {
      productId, uid, reaction: nextReaction, saved: nextSaved,
      createdAt: userSnap.exists ? userSnap.data()?.createdAt || admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })

    if (nextReaction) tx.set(legacyReactionRef, { uid, reaction: nextReaction, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    else tx.delete(legacyReactionRef)

    if (nextSaved) tx.set(legacySaveRef, { productId, savedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    else tx.delete(legacySaveRef)

    tx.set(productRef, {
      likeCount, dislikeCount, saveCount,
      'counts.likes': likeCount,
      'counts.dislikes': dislikeCount,
      'counts.saves': saveCount,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })

    return { productId, reaction: nextReaction, saved: nextSaved, likeCount, dislikeCount, saveCount, likeDelta, dislikeDelta, saveDelta }
  })
}

const setProductEngagement = onCall(handleSetProductEngagement)
const setProductReaction = onCall(async (request) => handleSetProductEngagement({ ...request, data: { ...request.data, updateReaction: true, updateSaved: false } }))
const setProductSaved = onCall(async (request) => handleSetProductEngagement({ ...request, data: { ...request.data, updateSaved: true, updateReaction: false } }))

module.exports = { setProductEngagement, setProductReaction, setProductSaved }
