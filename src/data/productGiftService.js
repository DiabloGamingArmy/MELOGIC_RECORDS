import { collection, getDocs, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { getStorageAssetUrl } from '../firebase/storageAssets'

function callable(name, payload) {
  if (!functions) throw new Error('Functions are not configured.')
  return httpsCallable(functions, name)(payload).then((response) => response?.data || {})
}

function normalizeGift(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: docSnap.id,
    ...data,
    productId: String(data.productId || ''),
    productTitle: String(data.productTitle || 'Untitled product'),
    productImage: String(data.productImage || ''),
    productImagePath: String(data.productImagePath || ''),
    senderUid: String(data.senderUid || ''),
    senderDisplayName: String(data.senderDisplayName || 'Melogic creator'),
    senderPhotoURL: String(data.senderPhotoURL || ''),
    recipientUid: String(data.recipientUid || ''),
    message: String(data.message || ''),
    status: String(data.status || 'pending')
  }
}

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  return new Date(value || 0).getTime() || 0
}

export function sendProductGift(payload = {}) {
  const productId = String(payload.productId || '').trim()
  const recipientUids = [...new Set(
    (Array.isArray(payload.recipientUids) ? payload.recipientUids : [])
      .map((uid) => String(uid || '').trim())
      .filter(Boolean)
  )]
  if (!productId) return Promise.reject(new Error('A product is required before sending a gift.'))
  if (!recipientUids.length || recipientUids.length > 10) {
    return Promise.reject(new Error('Choose between 1 and 10 gift recipients.'))
  }
  return callable('sendProductGift', {
    productId,
    recipientUids,
    message: String(payload.message || '').trim().slice(0, 1000)
  }).then((result) => {
    if (result?.ok !== true || !Array.isArray(result.giftIds)) {
      throw new Error('The gift service returned an invalid confirmation.')
    }
    return result
  })
}

export function acceptProductGift(giftId = '') {
  return callable('acceptProductGift', { giftId })
}

export function denyProductGift(giftId = '') {
  return callable('denyProductGift', { giftId })
}

export async function listIncomingProductGifts(uid = '') {
  if (!db || !uid) return []
  const snapshot = await getDocs(query(collection(db, 'productGifts'), where('recipientUid', '==', uid)))
  const gifts = snapshot.docs.map(normalizeGift)
  const hydrated = await Promise.all(gifts.map(async (gift) => ({
    ...gift,
    productImage: gift.productImage || (gift.productImagePath
      ? await getStorageAssetUrl(gift.productImagePath, { scopeKey: 'product-gifts', type: 'gift-cover' }).catch(() => '')
      : '')
  })))
  return hydrated.sort((a, b) => timestampMillis(b.createdAt) - timestampMillis(a.createdAt))
}
