import { collection, doc, getDoc, getDocs, limit, orderBy, query, Timestamp, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { storage } from '../firebase/storage'

const POST_COLLECTION = 'communityPosts'
const COMMUNITY_COLLECTION = 'communities'
const STORY_COLLECTION = 'communityStories'

function serializeDate(value) {
  if (!value) return ''
  if (typeof value === 'string') return value
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return ''
}

export function normalizeCommunity(rawOrSnap = {}, explicitId = '') {
  const raw = typeof rawOrSnap.data === 'function' ? rawOrSnap.data() || {} : rawOrSnap || {}
  const id = explicitId || rawOrSnap.id || raw.communityId || raw.slug || ''
  return {
    communityId: id,
    id,
    slug: raw.slug || id,
    name: raw.name || raw.slug || 'Community',
    description: raw.description || '',
    category: raw.category || 'Creator Help',
    iconURL: raw.iconURL || '',
    bannerURL: raw.bannerURL || '',
    createdBy: raw.createdBy || '',
    ownerUid: raw.ownerUid || '',
    moderatorIds: Array.isArray(raw.moderatorIds) ? raw.moderatorIds : [],
    memberCount: Math.max(0, Number(raw.memberCount || 0)),
    focusCount: Math.max(0, Number(raw.focusCount || 0)),
    postCount: Math.max(0, Number(raw.postCount || 0)),
    visibility: raw.visibility || 'public',
    postingMode: raw.postingMode || 'open',
    status: raw.status || 'active',
    official: raw.official === true,
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
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
    communityName: raw.communityName || '',
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

export function normalizeCommunityComment(docSnapOrData = {}, explicitId = '') {
  const raw = typeof docSnapOrData.data === 'function' ? docSnapOrData.data() || {} : docSnapOrData || {}
  const id = explicitId || docSnapOrData.id || raw.commentId || ''
  return {
    commentId: id,
    id,
    postId: raw.postId || '',
    authorUid: raw.authorUid || '',
    authorDisplayName: raw.authorDisplayName || 'Melogic Creator',
    authorUsername: raw.authorUsername || '',
    authorAvatarURL: raw.authorAvatarURL || '',
    body: raw.body || '',
    parentCommentId: raw.parentCommentId || '',
    replyCount: Math.max(0, Number(raw.replyCount || 0)),
    likeCount: Math.max(0, Number(raw.likeCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    status: raw.status || 'visible',
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

export function normalizeCommunityStory(docSnapOrData = {}, explicitId = '') {
  const raw = typeof docSnapOrData.data === 'function' ? docSnapOrData.data() || {} : docSnapOrData || {}
  const id = explicitId || docSnapOrData.id || raw.storyId || ''
  return {
    storyId: id,
    id,
    authorUid: raw.authorUid || '',
    authorDisplayName: raw.authorDisplayName || 'Melogic Creator',
    authorUsername: raw.authorUsername || '',
    authorAvatarURL: raw.authorAvatarURL || '',
    mediaType: raw.mediaType === 'image' ? 'image' : 'text',
    text: raw.text || '',
    mediaPath: raw.mediaPath || '',
    mediaURL: raw.mediaURL || '',
    background: raw.background || 'aurora',
    linkedPostId: raw.linkedPostId || '',
    linkedProductId: raw.linkedProductId || '',
    expiresAt: serializeDate(raw.expiresAt),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    viewCount: Math.max(0, Number(raw.viewCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    status: raw.status || 'active',
    visibility: raw.visibility || 'public'
  }
}

async function queryWithIndexFallback(primaryConstraints, fallbackConstraints, normalize, filter = null, sorter = null) {
  try {
    const snapshot = await getDocs(query(collection(db, normalize === normalizeCommunity ? COMMUNITY_COLLECTION : POST_COLLECTION), ...primaryConstraints))
    return snapshot.docs.map((docSnap) => normalize(docSnap))
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const snapshot = await getDocs(query(collection(db, normalize === normalizeCommunity ? COMMUNITY_COLLECTION : POST_COLLECTION), ...fallbackConstraints))
    let rows = snapshot.docs.map((docSnap) => normalize(docSnap))
    if (filter) rows = rows.filter(filter)
    if (sorter) rows = rows.sort(sorter)
    return rows
  }
}

export async function seedCommunities() {
  const callable = httpsCallable(functions, 'seedCommunities')
  const result = await callable({})
  return result?.data || { ok: false }
}

export async function listCommunities({ category = 'all', search = '', limitCount = 50 } = {}) {
  await seedCommunities().catch(() => null)
  const primary = [
    where('status', '==', 'active'),
    where('visibility', '==', 'public')
  ]
  if (category && category !== 'all') primary.push(where('category', '==', category))
  primary.push(orderBy('updatedAt', 'desc'))
  primary.push(limit(limitCount))

  const fallback = [
    where('status', '==', 'active'),
    where('visibility', '==', 'public'),
    limit(limitCount)
  ]
  const needle = String(search || '').trim().toLowerCase()
  const rows = await queryWithIndexFallback(
    primary,
    fallback,
    normalizeCommunity,
    (community) => (category === 'all' || !category || community.category === category),
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  )
  if (!needle) return rows
  return rows.filter((community) => `${community.name} ${community.slug} ${community.description} ${community.category}`.toLowerCase().includes(needle))
}

export async function getCommunityBySlug(slug = '') {
  await seedCommunities().catch(() => null)
  const clean = String(slug || '').trim()
  if (!clean) return null
  const snap = await getDoc(doc(db, COMMUNITY_COLLECTION, clean)).catch((error) => {
    if (String(error?.code || '').includes('permission-denied')) return null
    throw error
  })
  if (!snap || !snap.exists()) return null
  const community = normalizeCommunity(snap)
  if (community.status !== 'active' || community.visibility !== 'public') return null
  return community
}

export async function getCommunityFocusState(communityId = '', uid = '') {
  const id = String(communityId || '').trim()
  const viewerUid = String(uid || '').trim()
  if (!id || !viewerUid) return false
  const snap = await getDoc(doc(db, 'users', viewerUid, 'focusedCommunities', id)).catch(() => null)
  return Boolean(snap?.exists?.())
}

export async function listFocusedCommunityIds(uid = '', limitCount = 50) {
  const viewerUid = String(uid || '').trim()
  if (!viewerUid) return []
  const snapshot = await getDocs(query(collection(db, 'users', viewerUid, 'focusedCommunities'), limit(limitCount))).catch(() => null)
  if (!snapshot) return []
  return snapshot.docs
    .map((docSnap) => docSnap.id || docSnap.data()?.communityId || '')
    .filter((id) => id && !id.includes('/'))
}

export async function listCommunityPosts({ tab = 'for-you', communitySlug = '', limitCount = 25 } = {}) {
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]
  if (communitySlug) constraints.push(where('communitySlug', '==', communitySlug))
  if (tab === 'official') constraints.push(where('official', '==', true))
  constraints.push(orderBy('createdAt', 'desc'))
  constraints.push(limit(limitCount))

  const fallbackConstraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public'),
    limit(limitCount)
  ]

  return queryWithIndexFallback(
    constraints,
    fallbackConstraints,
    normalizeCommunityPost,
    (post) => (!communitySlug || post.communitySlug === communitySlug) && (tab !== 'official' || post.official),
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  )
}

export async function listFocusedCommunityPosts(uid = '', limitCount = 25) {
  const focusedCommunityIds = await listFocusedCommunityIds(uid, 50)
  if (!focusedCommunityIds.length) return []

  const chunks = []
  for (let index = 0; index < focusedCommunityIds.length; index += 10) {
    chunks.push(focusedCommunityIds.slice(index, index + 10))
  }

  try {
    const snapshots = await Promise.all(chunks.map((ids) => getDocs(query(
      collection(db, POST_COLLECTION),
      where('communityId', 'in', ids),
      where('status', '==', 'published'),
      where('visibility', '==', 'public'),
      orderBy('createdAt', 'desc'),
      limit(limitCount)
    ))))
    const posts = snapshots
      .flatMap((snapshot) => snapshot.docs.map((docSnap) => normalizeCommunityPost(docSnap)))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
    return posts.slice(0, limitCount)
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const focusedSet = new Set(focusedCommunityIds)
    const posts = await listCommunityPosts({ limitCount: Math.max(100, limitCount * 4) })
    return posts.filter((post) => focusedSet.has(post.communityId)).slice(0, limitCount)
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

export async function listCommunityComments(postId = '', limitCount = 120) {
  const id = String(postId || '').trim()
  if (!id) return []
  const commentsRef = collection(db, POST_COLLECTION, id, 'comments')
  try {
    const snapshot = await getDocs(query(commentsRef, where('status', '==', 'visible'), orderBy('createdAt', 'asc'), limit(limitCount)))
    return snapshot.docs.map((docSnap) => normalizeCommunityComment(docSnap))
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const snapshot = await getDocs(query(commentsRef, where('status', '==', 'visible'), limit(limitCount)))
    return snapshot.docs
      .map((docSnap) => normalizeCommunityComment(docSnap))
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
  }
}

export async function getCommunityCommentViewerState(postId = '', commentId = '', uid = '') {
  const cleanPostId = String(postId || '').trim()
  const cleanCommentId = String(commentId || '').trim()
  const viewerUid = String(uid || '').trim()
  if (!cleanPostId || !cleanCommentId || !viewerUid) return { liked: false }
  const likeSnap = await getDoc(doc(db, POST_COLLECTION, cleanPostId, 'comments', cleanCommentId, 'likes', viewerUid)).catch(() => null)
  return { liked: Boolean(likeSnap?.exists?.()) }
}

export function newCommunityStoryId() {
  return doc(collection(db, STORY_COLLECTION)).id
}

function storyIsNotExpired(story) {
  const expiresMs = new Date(story.expiresAt || 0).getTime()
  return Number.isFinite(expiresMs) && expiresMs > Date.now()
}

async function attachStoryMediaUrl(story) {
  if (story.mediaType !== 'image' || story.mediaURL || !story.mediaPath || !storage) return story
  const mediaURL = await getDownloadURL(ref(storage, story.mediaPath)).catch(() => '')
  return { ...story, mediaURL }
}

export async function listCommunityStories({ limitCount = 30 } = {}) {
  const now = Timestamp.fromDate(new Date(Date.now() + 60 * 1000))
  const primaryConstraints = [
    where('status', '==', 'active'),
    where('visibility', '==', 'public'),
    where('expiresAt', '>', now),
    orderBy('expiresAt', 'asc'),
    limit(limitCount)
  ]
  const fallbackConstraints = [
    where('status', '==', 'active'),
    where('visibility', '==', 'public'),
    where('expiresAt', '>', now),
    limit(limitCount)
  ]

  let stories = []
  try {
    const snapshot = await getDocs(query(collection(db, STORY_COLLECTION), ...primaryConstraints))
    stories = snapshot.docs.map((docSnap) => normalizeCommunityStory(docSnap))
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const snapshot = await getDocs(query(collection(db, STORY_COLLECTION), ...fallbackConstraints))
    stories = snapshot.docs
      .map((docSnap) => normalizeCommunityStory(docSnap))
      .filter(storyIsNotExpired)
      .sort((a, b) => new Date(a.expiresAt || 0).getTime() - new Date(b.expiresAt || 0).getTime())
  }
  return Promise.all(stories.map(attachStoryMediaUrl))
}

function storyImageExtension(file) {
  const name = String(file?.name || '').toLowerCase()
  if (name.endsWith('.png')) return 'png'
  if (name.endsWith('.webp')) return 'webp'
  if (name.endsWith('.gif')) return 'gif'
  return 'jpg'
}

export async function uploadCommunityStoryImage({ uid = '', storyId = '', file = null } = {}) {
  const ownerUid = String(uid || '').trim()
  const id = String(storyId || '').trim()
  if (!storage) throw new Error('Storage is not available.')
  if (!ownerUid || ownerUid.includes('/')) throw new Error('A signed-in account is required.')
  if (!id || id.includes('/')) throw new Error('A valid story id is required.')
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choose an image file.')
  if (Number(file.size || 0) > 10 * 1024 * 1024) throw new Error('Story images must be 10 MB or smaller.')

  const mediaPath = `${STORY_COLLECTION}/${ownerUid}/${id}/story-${Date.now()}.${storyImageExtension(file)}`
  const fileRef = ref(storage, mediaPath)
  await uploadBytes(fileRef, file, { contentType: file.type || 'image/jpeg' })
  const mediaURL = await getDownloadURL(fileRef).catch(() => '')
  return { mediaPath, mediaURL }
}

export async function createCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function createCommunityComment(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunityComment')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function deleteCommunityComment(payload = {}) {
  const callable = httpsCallable(functions, 'deleteCommunityComment')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function toggleCommunityCommentLike(payload = {}) {
  const callable = httpsCallable(functions, 'toggleCommunityCommentLike')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function createCommunityStory(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunityStory')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function deleteCommunityStory(payload = {}) {
  const callable = httpsCallable(functions, 'deleteCommunityStory')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function recordCommunityStoryView(storyId = '') {
  const callable = httpsCallable(functions, 'recordCommunityStoryView')
  const result = await callable({ storyId })
  return result?.data || { ok: false }
}

export async function createCommunity(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunity')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function toggleCommunityFocus(communityId = '') {
  const callable = httpsCallable(functions, 'toggleCommunityFocus')
  const result = await callable({ communityId })
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
