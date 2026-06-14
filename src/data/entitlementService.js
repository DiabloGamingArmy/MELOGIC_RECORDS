import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

export async function userOwnsProduct(uid = '', productId = '') {
  if (!db || !uid || !productId) return false
  const [entitlementSnapshot, librarySnapshot] = await Promise.all([
    getDoc(doc(db, 'users', uid, 'entitlements', productId)).catch(() => null),
    getDoc(doc(db, 'users', uid, 'libraryItems', productId)).catch(() => null)
  ])
  return Boolean(entitlementSnapshot?.exists() || librarySnapshot?.exists())
}

export async function claimFreeProduct(uid = '', productId = '') {
  if (!functions || !uid || !productId) throw new Error('Sign in before adding this product to your library.')
  const callable = httpsCallable(functions, 'claimFreeProduct')
  const response = await callable({ productId })
  return response?.data || { status: 'active', productId }
}

export async function createProductDownloadUrl(productId = '', file = '') {
  if (!functions || !productId || !file) return null
  const payload = typeof file === 'object'
    ? { productId, ...file }
    : { productId, fileId: String(file || '') }
  const callable = httpsCallable(functions, 'createProductDownloadUrl')
  const response = await callable(payload)
  return response?.data || null
}

export async function createProductDownloadLink(productId = '', { source = 'product-detail' } = {}) {
  if (!functions || !productId) throw new Error('Sign in before downloading this product.')
  const callable = httpsCallable(functions, 'createProductDownloadLink')
  const response = await callable({ productId, source })
  return response?.data || null
}
