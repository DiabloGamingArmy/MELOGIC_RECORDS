const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const db = admin.firestore()

function clean(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function giftIdFor(productId = '', senderUid = '', recipientUid = '') {
  return `${productId}_${senderUid}_${recipientUid}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 900)
}

async function profileFor(uid = '') {
  const snap = await db.doc(`profiles/${uid}`).get()
  if (!snap.exists) return null
  const data = snap.data() || {}
  return {
    uid,
    displayName: clean(data.displayName || data.username || 'Melogic member', 180),
    photoURL: clean(data.avatarURL || data.photoURL || '', 1200)
  }
}

const sendProductGift = onCall({ timeoutSeconds: 60, memory: '256MiB', cors: true }, async (request) => {
  const senderUid = request.auth?.uid
  if (!senderUid) throw new HttpsError('unauthenticated', 'Sign in before sending a gift.')
  const productId = clean(request.data?.productId || '', 180)
  const recipientUids = [...new Set((Array.isArray(request.data?.recipientUids) ? request.data.recipientUids : []).map((uid) => clean(uid, 180)).filter(Boolean))]
  const message = clean(request.data?.message || '', 1000)
  if (!productId || !recipientUids.length || recipientUids.length > 10) {
    throw new HttpsError('invalid-argument', 'Choose between 1 and 10 gift recipients.')
  }
  if (recipientUids.includes(senderUid)) throw new HttpsError('invalid-argument', 'You cannot gift a product to yourself.')

  const productSnap = await db.doc(`products/${productId}`).get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
  const product = productSnap.data() || {}
  if (clean(product.artistId || product.ownerUid || '', 180) !== senderUid) {
    throw new HttpsError('permission-denied', 'Only the product owner can send this gift.')
  }
  if (['removed', 'deleted'].includes(product.status) || product.removedAt) {
    throw new HttpsError('failed-precondition', 'Removed products cannot be gifted.')
  }

  const [senderProfile, recipientProfiles] = await Promise.all([
    profileFor(senderUid),
    Promise.all(recipientUids.map(profileFor))
  ])
  if (recipientProfiles.some((profile) => !profile)) throw new HttpsError('not-found', 'One or more recipients no longer exist.')

  const gifts = recipientUids.map((recipientUid, index) => {
    const giftId = giftIdFor(productId, senderUid, recipientUid)
    return { recipientUid, recipientProfile: recipientProfiles[index], giftId, giftRef: db.doc(`productGifts/${giftId}`) }
  })
  await db.runTransaction(async (transaction) => {
    const existingSnapshots = await Promise.all(gifts.map(({ giftRef }) => transaction.get(giftRef)))
    existingSnapshots.forEach((existing) => {
      if (existing.exists && ['pending', 'accepted'].includes(existing.data()?.status)) {
        throw new HttpsError('already-exists', existing.data()?.status === 'accepted' ? 'This user already accepted the gift.' : 'A gift is already pending for this user.')
      }
    })
    const now = admin.firestore.FieldValue.serverTimestamp()
    gifts.forEach(({ recipientUid, recipientProfile, giftId, giftRef }) => {
      transaction.set(giftRef, {
        id: giftId,
        productId,
        productTitle: clean(product.title || 'Untitled product', 180),
        productImage: clean(product.thumbnailURL || product.coverURL || '', 1200),
        productImagePath: clean(product.thumbnailPath || product.coverPath || product.galleryPaths?.[0] || '', 1200),
        senderUid,
        senderDisplayName: senderProfile?.displayName || clean(request.auth?.token?.name || 'Melogic creator', 180),
        senderPhotoURL: senderProfile?.photoURL || '',
        recipientUid,
        recipientDisplayName: recipientProfile.displayName,
        message,
        status: 'pending',
        createdAt: now,
        updatedAt: now,
        respondedAt: null,
        acceptedAt: null,
        deniedAt: null
      })
      const notificationRef = db.collection('users').doc(recipientUid).collection('systemNotifications').doc(giftId)
      transaction.set(notificationRef, {
        id: giftId,
        type: 'product_gift',
        category: 'content',
        title: `${senderProfile?.displayName || 'A creator'} sent you a product`,
        body: message || `${clean(product.title || 'A product', 180)} is waiting for your response.`,
        productId,
        actorUid: senderUid,
        actorDisplayName: senderProfile?.displayName || '',
        actorPhotoURL: senderProfile?.photoURL || '',
        giftId,
        actionHref: '/inbox/content/gifts',
        readAt: null,
        createdAt: now
      })
    })
  })
  return { ok: true, productId, giftIds: gifts.map(({ giftId }) => giftId), recipientCount: gifts.length }
})

async function respondToGift(request, decision) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to respond to this gift.')
  const giftId = clean(request.data?.giftId || '', 900)
  if (!giftId || giftId.includes('/')) throw new HttpsError('invalid-argument', 'A valid giftId is required.')
  const giftRef = db.doc(`productGifts/${giftId}`)
  return db.runTransaction(async (transaction) => {
    const giftSnap = await transaction.get(giftRef)
    if (!giftSnap.exists) throw new HttpsError('not-found', 'Gift not found.')
    const gift = giftSnap.data() || {}
    if (gift.recipientUid !== uid) throw new HttpsError('permission-denied', 'Only the recipient can respond to this gift.')
    if (gift.status !== 'pending') throw new HttpsError('failed-precondition', `This gift is already ${gift.status || 'resolved'}.`)
    const now = admin.firestore.FieldValue.serverTimestamp()
    const update = {
      status: decision,
      respondedAt: now,
      updatedAt: now,
      acceptedAt: decision === 'accepted' ? now : null,
      deniedAt: decision === 'denied' ? now : null
    }
    transaction.set(giftRef, update, { merge: true })
    if (decision === 'accepted') {
      transaction.set(db.doc(`users/${uid}/libraryItems/${gift.productId}`), {
        productId: gift.productId,
        productTitle: clean(gift.productTitle || '', 180),
        coverURL: clean(gift.productImage || '', 1200),
        coverPath: clean(gift.productImagePath || '', 1200),
        source: 'gift',
        acquisitionType: 'gift',
        giftedBy: clean(gift.senderUid || '', 180),
        giftId,
        status: 'active',
        addedAt: now,
        acquiredAt: now,
        createdAt: now,
        updatedAt: now
      }, { merge: true })
    }
    const senderNotification = db.collection('users').doc(gift.senderUid).collection('systemNotifications').doc()
    transaction.set(senderNotification, {
      id: senderNotification.id,
      type: `product_gift_${decision}`,
      category: 'content',
      title: `Gift ${decision}`,
      body: `${clean(gift.recipientDisplayName || 'The recipient', 180)} ${decision === 'accepted' ? 'accepted' : 'denied'} ${clean(gift.productTitle || 'your product gift', 180)}.`,
      productId: gift.productId,
      giftId,
      actorUid: uid,
      actionHref: `/products/${encodeURIComponent(gift.productId)}`,
      readAt: null,
      createdAt: now
    })
    return { ok: true, giftId, productId: gift.productId, status: decision }
  })
}

const acceptProductGift = onCall({ timeoutSeconds: 30, memory: '256MiB', cors: true }, (request) => respondToGift(request, 'accepted'))
const denyProductGift = onCall({ timeoutSeconds: 30, memory: '256MiB', cors: true }, (request) => respondToGift(request, 'denied'))

module.exports = {
  sendProductGift,
  acceptProductGift,
  denyProductGift,
  __test: { giftIdFor }
}
