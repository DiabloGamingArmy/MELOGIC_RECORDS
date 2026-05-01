const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

function requireAuth(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication required.')
  return uid
}

exports.setProductReaction = onCall(async (request) => {
  const uid = requireAuth(request)
  const productId = String(request.data?.productId || '').trim()
  const reaction = request.data?.reaction
  const normalized = reaction === 'like' || reaction === 'dislike' ? reaction : null
  if (!productId) throw new HttpsError('invalid-argument', 'productId is required.')

  const db = admin.firestore()
  const productRef = db.collection('products').doc(productId)
  const reactionRef = productRef.collection('reactions').doc(uid)

  const result = await db.runTransaction(async (tx) => {
    const [productSnap, reactionSnap] = await Promise.all([tx.get(productRef), tx.get(reactionRef)])
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
    const product = productSnap.data() || {}
    const isOwner = product.artistId === uid
    const isPublic = product.status === 'published' && product.visibility === 'public'
    if (!isOwner && !isPublic) throw new HttpsError('permission-denied', 'Product is not available for reactions.')

    const prev = reactionSnap.exists ? (reactionSnap.data()?.reaction || null) : null
    const likeDelta = (normalized === 'like' ? 1 : 0) - (prev === 'like' ? 1 : 0)
    const dislikeDelta = (normalized === 'dislike' ? 1 : 0) - (prev === 'dislike' ? 1 : 0)

    if (normalized === null) tx.delete(reactionRef)
    else tx.set(reactionRef, { uid, reaction: normalized, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })

    if (likeDelta || dislikeDelta) {
      tx.set(productRef, {
        likeCount: admin.firestore.FieldValue.increment(likeDelta),
        dislikeCount: admin.firestore.FieldValue.increment(dislikeDelta),
        'counts.likes': admin.firestore.FieldValue.increment(likeDelta),
        'counts.dislikes': admin.firestore.FieldValue.increment(dislikeDelta)
      }, { merge: true })
    }
    return { reaction: normalized, likeDelta, dislikeDelta }
  })

  return result
})

exports.setProductSaved = onCall(async (request) => {
  const uid = requireAuth(request)
  const productId = String(request.data?.productId || '').trim()
  const saved = Boolean(request.data?.saved)
  if (!productId) throw new HttpsError('invalid-argument', 'productId is required.')

  const db = admin.firestore()
  const productRef = db.collection('products').doc(productId)
  const saveRef = db.collection('users').doc(uid).collection('savedProducts').doc(productId)

  const result = await db.runTransaction(async (tx) => {
    const [productSnap, saveSnap] = await Promise.all([tx.get(productRef), tx.get(saveRef)])
    if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')

    const alreadySaved = saveSnap.exists
    const saveDelta = (saved ? 1 : 0) - (alreadySaved ? 1 : 0)
    if (!saveDelta) return { saved, saveDelta: 0 }

    if (saved) tx.set(saveRef, { productId, savedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    else tx.delete(saveRef)

    tx.set(productRef, {
      saveCount: admin.firestore.FieldValue.increment(saveDelta),
      'counts.saves': admin.firestore.FieldValue.increment(saveDelta)
    }, { merge: true })

    return { saved, saveDelta }
  })

  return result
})
