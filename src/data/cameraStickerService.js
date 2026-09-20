import { collection, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { storage } from '../firebase/storage'

const STICKER_COLLECTION = 'cameraStickerAssets'

function normalizeStickerAsset(snapshot) {
  const raw = snapshot.data?.() || {}
  return {
    id: snapshot.id,
    title: String(raw.title || ''),
    kind: raw.kind === 'gif' ? 'gif' : 'sticker',
    url: String(raw.url || ''),
    thumbnailUrl: String(raw.thumbnailUrl || ''),
    storagePath: String(raw.storagePath || ''),
    thumbnailPath: String(raw.thumbnailPath || ''),
    tags: Array.isArray(raw.tags) ? raw.tags.map(String).slice(0, 24) : [],
    category: String(raw.category || 'featured')
  }
}

async function resolveAssetUrls(asset) {
  if (!storage) return asset
  const next = { ...asset }
  try { if (!next.url && next.storagePath) next.url = await getDownloadURL(ref(storage, next.storagePath)) } catch {}
  try { if (!next.thumbnailUrl && next.thumbnailPath) next.thumbnailUrl = await getDownloadURL(ref(storage, next.thumbnailPath)) } catch {}
  if (!next.thumbnailUrl) next.thumbnailUrl = next.url
  return next
}

/**
 * Catalog contract:
 * Firestore cameraStickerAssets/{id}: metadata/search/index only.
 * Firebase Storage camera-stickers/{id}/...: actual WebP/PNG/GIF assets.
 */
export async function listCameraStickerAssets({ limitCount = 120 } = {}) {
  const q = query(collection(db, STICKER_COLLECTION), where('status', '==', 'active'), orderBy('rank', 'asc'), limit(Math.max(1, Math.min(200, Number(limitCount) || 120))))
  const snapshot = await getDocs(q)
  return Promise.all(snapshot.docs.map(normalizeStickerAsset).map(resolveAssetUrls))
}
