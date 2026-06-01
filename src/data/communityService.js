import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

const POST_COLLECTION = 'communityPosts'

function serializeDate(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return ''
}

export function normalizeCommunityPost(docSnapOrData = {}, explicitId = '') {
  const raw = typeof docSnapOrData.data === 'function' ? docSnapOrData.data() || {} : docSnapOrData || {}
  const id = explicitId || docSnapOrData.id || raw.postId || ''
  return {
    postId: id,
    id,
    authorUid: raw.authorUid || '',
    authorDisplayName: raw.authorDisplayName || 'Melogic Creator',
    authorUsername: raw.authorUsername || '',
    authorAvatarURL: raw.authorAvatarURL || '',
    type: raw.type || 'text',
    title: raw.title || '',
    body: raw.body || '',
    communityId: raw.communityId || '',
    communitySlug: raw.communitySlug || '',
    linkedProductId: raw.linkedProductId || '',
    linkedProductSnapshot: raw.linkedProductSnapshot || {},
    mediaPaths: Array.isArray(raw.mediaPaths) ? raw.mediaPaths : [],
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    status: raw.status || 'published',
    visibility: raw.visibility || 'public',
    official: raw.official === true,
    counts: {
      likes: Math.max(0, Number(raw.counts?.likes || 0)),
      comments: Math.max(0, Number(raw.counts?.comments || 0)),
      saves: Math.max(0, Number(raw.counts?.saves || 0)),
      shares: Math.max(0, Number(raw.counts?.shares || 0)),
      reports: Math.max(0, Number(raw.counts?.reports || 0))
    },
    score: Math.max(0, Number(raw.score || 0)),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

export async function listCommunityPosts({ tab = 'for-you', limitCount = 25 } = {}) {
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]
  if (tab === 'official') constraints.push(where('official', '==', true))
  constraints.push(orderBy(tab === 'for-you' ? 'createdAt' : 'createdAt', 'desc'))
  constraints.push(limit(limitCount))

  try {
    const snapshot = await getDocs(query(collection(db, POST_COLLECTION), ...constraints))
    return snapshot.docs.map((docSnap) => normalizeCommunityPost(docSnap))
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const fallbackConstraints = [
      where('status', '==', 'published'),
      where('visibility', '==', 'public'),
      limit(limitCount)
    ]
    const snapshot = await getDocs(query(collection(db, POST_COLLECTION), ...fallbackConstraints))
    return snapshot.docs
      .map((docSnap) => normalizeCommunityPost(docSnap))
      .filter((post) => tab !== 'official' || post.official)
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
  }
}

export async function getCommunityPost(postId = '') {
  const id = String(postId || '').trim()
  if (!id) throw new Error('post-id-required')
  const snap = await getDoc(doc(db, POST_COLLECTION, id)).catch((error) => {
    if (String(error?.code || '').includes('permission-denied')) return null
    throw error
  })
  if (!snap) return null
  if (!snap.exists()) return null
  const post = normalizeCommunityPost(snap)
  if (post.status !== 'published' || post.visibility !== 'public') return null
  return post
}

export async function getCommunityPostViewerState(postId = '', uid = '') {
  const id = String(postId || '').trim()
  const viewerUid = String(uid || '').trim()
  if (!id || !viewerUid) return { liked: false, saved: false }
  const [likeSnap, saveSnap] = await Promise.all([
    getDoc(doc(db, POST_COLLECTION, id, 'likes', viewerUid)).catch(() => null),
    getDoc(doc(db, POST_COLLECTION, id, 'saves', viewerUid)).catch(() => null)
  ])
  return { liked: Boolean(likeSnap?.exists?.()), saved: Boolean(saveSnap?.exists?.()) }
}

export async function createCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function toggleCommunityPostLike(postId = '') {
  const callable = httpsCallable(functions, 'toggleCommunityPostLike')
  const result = await callable({ postId })
  return result?.data || { ok: false }
}

export async function toggleCommunityPostSave(postId = '') {
  const callable = httpsCallable(functions, 'toggleCommunityPostSave')
  const result = await callable({ postId })
  return result?.data || { ok: false }
}

export async function recordCommunityPostShare(postId = '') {
  const callable = httpsCallable(functions, 'recordCommunityPostShare')
  const result = await callable({ postId })
  return result?.data || { ok: false }
}
