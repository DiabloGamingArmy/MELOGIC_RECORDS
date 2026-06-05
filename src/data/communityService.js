import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, Timestamp, where } from 'firebase/firestore'
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
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    pinnedPostIds: Array.isArray(raw.pinnedPostIds) ? raw.pinnedPostIds.filter(Boolean).slice(0, 3) : [],
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
  const attachments = Array.isArray(raw.attachments)
    ? raw.attachments
      .filter((attachment) => attachment && typeof attachment === 'object')
      .map((attachment) => ({
        type: attachment.type || '',
        targetId: attachment.targetId || attachment.productId || attachment.projectId || attachment.storagePath || '',
        productId: attachment.productId || '',
        projectId: attachment.projectId || '',
        sourceType: attachment.sourceType || '',
        sourceId: attachment.sourceId || '',
        storagePath: attachment.storagePath || '',
        snapshot: attachment.snapshot && typeof attachment.snapshot === 'object' ? attachment.snapshot : {}
      }))
      .filter((attachment) => attachment.type && (attachment.type !== 'product' || attachment.productId || attachment.targetId))
    : []
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
    attachments,
    attachmentTypes: Array.isArray(raw.attachmentTypes) ? raw.attachmentTypes : attachments.map((attachment) => attachment.type).filter(Boolean),
    mediaPaths: Array.isArray(raw.mediaPaths) ? raw.mediaPaths : [],
    mentionedUserIds: Array.isArray(raw.mentionedUserIds) ? raw.mentionedUserIds : [],
    mentionedUsernames: Array.isArray(raw.mentionedUsernames) ? raw.mentionedUsernames : [],
    intent: raw.intent || '',
    intentData: raw.intentData && typeof raw.intentData === 'object' ? raw.intentData : {},
    scheduledAt: serializeDate(raw.scheduledAt),
    publishStatus: raw.publishStatus || raw.status || 'published',
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    tagKeys: Array.isArray(raw.tagKeys) ? raw.tagKeys : Array.isArray(raw.tags) ? raw.tags : [],
    searchKeywords: Array.isArray(raw.searchKeywords) ? raw.searchKeywords : [],
    titleLower: raw.titleLower || String(raw.title || '').toLowerCase(),
    authorDisplayNameLower: raw.authorDisplayNameLower || String(raw.authorDisplayName || '').toLowerCase(),
    authorUsernameLower: raw.authorUsernameLower || String(raw.authorUsername || '').toLowerCase(),
    status: raw.status || 'published',
    visibility: raw.visibility || 'public',
    official: raw.official === true,
    commentsLocked: raw.commentsLocked === true,
    pinnedInCommunity: raw.pinnedInCommunity === true,
    counts: {
      likes: Math.max(0, Number(raw.likeCount ?? raw.counts?.likes ?? 0)),
      comments: Math.max(0, Number(raw.commentCount ?? raw.counts?.comments ?? 0)),
      saves: Math.max(0, Number(raw.saveCount ?? raw.counts?.saves ?? 0)),
      shares: Math.max(0, Number(raw.shareCount ?? raw.counts?.shares ?? 0)),
      reports: Math.max(0, Number(raw.reportCount ?? raw.counts?.reports ?? 0))
    },
    likeCount: Math.max(0, Number(raw.likeCount ?? raw.counts?.likes ?? 0)),
    commentCount: Math.max(0, Number(raw.commentCount ?? raw.counts?.comments ?? 0)),
    saveCount: Math.max(0, Number(raw.saveCount ?? raw.counts?.saves ?? 0)),
    shareCount: Math.max(0, Number(raw.shareCount ?? raw.counts?.shares ?? 0)),
    reportCount: Math.max(0, Number(raw.reportCount ?? raw.counts?.reports ?? 0)),
    score: Math.max(0, Number(raw.score || 0)),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

export function normalizeCommunityShareableProduct(docSnapOrData = {}, explicitId = '') {
  const raw = typeof docSnapOrData.data === 'function' ? docSnapOrData.data() || {} : docSnapOrData || {}
  const id = explicitId || docSnapOrData.id || raw.id || raw.productId || ''
  const previewAssignment = raw.previewAssignment && typeof raw.previewAssignment === 'object' ? raw.previewAssignment : {}
  return {
    productId: id,
    id,
    title: raw.title || 'Untitled product',
    slug: raw.slug || '',
    thumbnailURL: raw.thumbnailURL || raw.coverURL || '',
    coverURL: raw.coverURL || '',
    creatorName: raw.artistDisplayName || raw.artistName || '',
    artistId: raw.artistId || '',
    priceCents: Math.max(0, Number(raw.priceCents || 0)),
    isFree: Boolean(raw.isFree) || Number(raw.priceCents || 0) <= 0,
    currency: raw.currency || 'USD',
    previewAudioPaths: Array.isArray(raw.previewAudioPaths) ? raw.previewAudioPaths.filter(Boolean) : [],
    primaryPreviewPath: raw.primaryPreviewPath || '',
    primaryPreviewType: raw.primaryPreviewType || '',
    primaryPreviewDuration: Math.max(0, Number(raw.primaryPreviewDuration || 0)),
    previewAssignment,
    status: raw.status || '',
    visibility: raw.visibility || ''
  }
}

function sortByActivity(a, b) {
  return new Date(b.updatedAt || b.lastOpenedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.lastOpenedAt || a.createdAt || 0).getTime()
}

function safeProductAudioPreviewPath(product = {}, requestedPath = '') {
  const productId = product.productId || product.id || ''
  const assignment = product.previewAssignment && typeof product.previewAssignment === 'object' ? product.previewAssignment : {}
  const candidates = [
    requestedPath,
    assignment.hoverAudioPath,
    product.primaryPreviewType === 'audio' ? product.primaryPreviewPath : '',
    ...(Array.isArray(product.previewAudioPaths) ? product.previewAudioPaths : [])
  ]
  return candidates.find((path) => String(path || '').startsWith(`products/${productId}/audio-previews/`)) || ''
}

const storageUrlCache = new Map()

async function safeStorageUrl(path = '') {
  const clean = String(path || '').trim()
  if (!clean || !storage) return ''
  if (!storageUrlCache.has(clean)) {
    storageUrlCache.set(clean, getDownloadURL(ref(storage, clean)).catch(() => ''))
  }
  return storageUrlCache.get(clean)
}

export function normalizeCommunityStagePlan(rawOrSnap = {}, explicitId = '') {
  const raw = typeof rawOrSnap.data === 'function' ? rawOrSnap.data() || {} : rawOrSnap || {}
  const id = explicitId || rawOrSnap.id || raw.projectId || raw.id || ''
  const dimensions = raw.stageDimensions && typeof raw.stageDimensions === 'object'
    ? raw.stageDimensions
    : raw.stage && typeof raw.stage === 'object'
      ? { width: raw.stage.width, depth: raw.stage.depth, unit: raw.stage.unit }
      : {}
  const objects = Array.isArray(raw.objects) ? raw.objects : Array.isArray(raw.plan?.objects) ? raw.plan.objects : []
  return {
    projectId: id,
    id,
    title: raw.title || raw.name || 'Untitled Stage Plan',
    ownerId: raw.ownerId || '',
    collaboratorIds: Array.isArray(raw.collaboratorIds) ? raw.collaboratorIds : [],
    visibility: raw.visibility || 'private',
    type: raw.type || 'stage-plan',
    stageType: raw.stageType || 'Stage Plan',
    stageWidth: Math.max(0, Number(dimensions.width || 0)),
    stageDepth: Math.max(0, Number(dimensions.depth || 0)),
    units: dimensions.unit || dimensions.units || 'ft',
    objectCount: objects.length,
    updatedAt: serializeDate(raw.updatedAt || raw.lastOpenedAt || raw.createdAt),
    createdAt: serializeDate(raw.createdAt)
  }
}

export function normalizeCommunityStudioProject(rawOrSnap = {}, explicitId = '') {
  const raw = typeof rawOrSnap.data === 'function' ? rawOrSnap.data() || {} : rawOrSnap || {}
  const id = explicitId || rawOrSnap.id || raw.projectId || raw.id || ''
  const tracks = Array.isArray(raw.tracks) ? raw.tracks : []
  return {
    projectId: id,
    id,
    title: raw.title || 'Untitled Studio Project',
    ownerId: raw.ownerId || '',
    collaboratorIds: Array.isArray(raw.collaboratorIds) ? raw.collaboratorIds : [],
    visibility: raw.visibility || 'private',
    type: raw.type || 'song',
    bpm: Math.max(0, Number(raw.bpm || 0)),
    key: raw.key || '',
    trackCount: Math.max(0, Number(raw.trackCount || tracks.length || 0)),
    updatedAt: serializeDate(raw.updatedAt || raw.lastOpenedAt || raw.createdAt),
    createdAt: serializeDate(raw.createdAt)
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

function normalizeFeedSearchToken(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/^#|^@/, '')
    .replace(/[^a-z0-9\s_-]+/g, ' ')
    .trim()
    .split(/[\s,_-]+/)
    .find((part) => part.length >= 2) || ''
}

function normalizeTagKey(value = '') {
  return String(value || '')
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
}

function postMatchesFeedSearch(post = {}, token = '') {
  if (!token) return true
  const haystack = [
    post.title,
    post.body,
    post.communityName,
    post.communitySlug,
    post.authorDisplayName,
    post.authorUsername,
    ...(post.tags || []),
    ...(post.searchKeywords || [])
  ].join(' ').toLowerCase()
  return haystack.includes(token)
}

function postSort(sort = 'new') {
  if (sort === 'most-discussed') {
    return (a, b) => Number(b.commentCount || b.counts?.comments || 0) - Number(a.commentCount || a.counts?.comments || 0)
      || new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  }
  if (sort === 'top-today' || sort === 'top-week') {
    const maxAge = sort === 'top-today' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000
    return (a, b) => {
      const now = Date.now()
      const aFresh = now - new Date(a.createdAt || 0).getTime() <= maxAge ? 1 : 0
      const bFresh = now - new Date(b.createdAt || 0).getTime() <= maxAge ? 1 : 0
      return bFresh - aFresh
        || Number(b.score || 0) - Number(a.score || 0)
        || new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    }
  }
  return (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
}

export async function listCommunityPosts({ tab = 'for-you', communitySlug = '', limitCount = 25, tag = '', search = '', sort = 'new', pageMode = false, cursor = null } = {}) {
  const tagKey = normalizeTagKey(tag)
  const searchToken = normalizeFeedSearchToken(search)
  const cleanSort = ['new', 'top-today', 'top-week', 'most-discussed'].includes(sort) ? sort : 'new'
  const pageLimit = Math.max(1, Number(limitCount || 25))
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]
  if (communitySlug) constraints.push(where('communitySlug', '==', communitySlug))
  if (tab === 'official') constraints.push(where('official', '==', true))
  if (tagKey) constraints.push(where('tagKeys', 'array-contains', tagKey))
  else if (searchToken) constraints.push(where('searchKeywords', 'array-contains', searchToken))
  if (cleanSort === 'most-discussed') constraints.push(orderBy('commentCount', 'desc'))
  else if (cleanSort === 'top-today' || cleanSort === 'top-week') constraints.push(orderBy('score', 'desc'))
  constraints.push(orderBy('createdAt', 'desc'))
  if (pageMode && cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageMode ? pageLimit + 1 : Math.max(pageLimit, searchToken || tagKey ? pageLimit : pageLimit * 2)))

  const fallbackConstraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public'),
    limit(Math.max(50, pageLimit * 3))
  ]

  if (pageMode) {
    try {
      const snapshot = await getDocs(query(collection(db, POST_COLLECTION), ...constraints))
      const visibleDocs = snapshot.docs.slice(0, pageLimit)
      const posts = visibleDocs
        .map((docSnap) => normalizeCommunityPost(docSnap))
        .filter((post) => postMatchesFeedSearch(post, searchToken))
      return {
        posts,
        cursor: visibleDocs[visibleDocs.length - 1] || cursor || null,
        hasMore: snapshot.docs.length > pageLimit
      }
    } catch (error) {
      if (!String(error?.message || '').includes('requires an index')) throw error
      const snapshot = await getDocs(query(collection(db, POST_COLLECTION), ...fallbackConstraints))
      const rows = snapshot.docs
        .map((docSnap) => normalizeCommunityPost(docSnap))
        .filter((post) => (
          (!communitySlug || post.communitySlug === communitySlug)
          && (tab !== 'official' || post.official)
          && (!tagKey || (post.tagKeys || post.tags || []).includes(tagKey))
          && postMatchesFeedSearch(post, searchToken)
        ))
        .sort(postSort(cleanSort))
      return {
        posts: rows.slice(0, pageLimit),
        cursor: null,
        hasMore: false
      }
    }
  }

  const rows = await queryWithIndexFallback(
    constraints,
    fallbackConstraints,
    normalizeCommunityPost,
    (post) => (
      (!communitySlug || post.communitySlug === communitySlug)
      && (tab !== 'official' || post.official)
      && (!tagKey || (post.tagKeys || post.tags || []).includes(tagKey))
      && postMatchesFeedSearch(post, searchToken)
    ),
    postSort(cleanSort)
  )
  return rows
    .filter((post) => postMatchesFeedSearch(post, searchToken))
    .sort(postSort(cleanSort))
    .slice(0, pageLimit)
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
  const mediaURL = await safeStorageUrl(story.mediaPath)
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

export async function listShareableCommunityProducts(uid = '', limitCount = 20) {
  const artistId = String(uid || '').trim()
  if (!db || !artistId) return []
  const productsRef = collection(db, 'products')
  const primary = query(
    productsRef,
    where('artistId', '==', artistId),
    where('status', '==', 'published'),
    where('visibility', '==', 'public'),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  )
  const fallback = query(
    productsRef,
    where('status', '==', 'published'),
    where('visibility', '==', 'public'),
    limit(Math.max(limitCount, 50))
  )
  try {
    const snapshot = await getDocs(primary)
    return snapshot.docs.map((docSnap) => normalizeCommunityShareableProduct(docSnap))
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const snapshot = await getDocs(fallback)
    return snapshot.docs
      .map((docSnap) => normalizeCommunityShareableProduct(docSnap))
      .filter((product) => product.artistId === artistId)
      .slice(0, limitCount)
  }
}

export async function listShareableCommunityMusicPreviews(uid = '', limitCount = 20) {
  const products = await listShareableCommunityProducts(uid, Math.max(limitCount, 40))
  const rows = await Promise.all(products.map(async (product) => {
    const storagePath = safeProductAudioPreviewPath(product)
    if (!storagePath) return null
    return {
      type: 'music',
      targetId: storagePath,
      sourceType: 'product_preview',
      sourceId: product.productId,
      storagePath,
      audioURL: await safeStorageUrl(storagePath),
      snapshot: {
        title: product.title || 'Music preview',
        creatorName: product.creatorName || '',
        durationSeconds: Math.max(0, Number(product.primaryPreviewDuration || 0)),
        waveformData: [],
        coverURL: product.thumbnailURL || product.coverURL || '',
        mimeType: 'audio/*'
      }
    }
  }))
  return rows.filter(Boolean).slice(0, limitCount)
}

async function listProjectRows({ uid = '', collectionName = '', normalize, limitCount = 30 } = {}) {
  const ownerUid = String(uid || '').trim()
  if (!ownerUid || !collectionName || !normalize) return []
  const ref = collection(db, collectionName)
  const [ownedSnap, sharedSnap] = await Promise.all([
    getDocs(query(ref, where('ownerId', '==', ownerUid), limit(limitCount))).catch((error) => {
      if (String(error?.code || '').includes('permission-denied')) return { docs: [] }
      throw error
    }),
    getDocs(query(ref, where('collaboratorIds', 'array-contains', ownerUid), limit(limitCount))).catch((error) => {
      if (String(error?.code || '').includes('permission-denied')) return { docs: [] }
      throw error
    })
  ])
  const byId = new Map()
  ;[...ownedSnap.docs, ...sharedSnap.docs].forEach((docSnap) => {
    const row = normalize(docSnap)
    if (row.id) byId.set(row.id, row)
  })
  return [...byId.values()].sort(sortByActivity).slice(0, limitCount)
}

export async function listShareableCommunityStagePlans(uid = '', limitCount = 30) {
  return listProjectRows({
    uid,
    collectionName: 'stageProjects',
    normalize: normalizeCommunityStagePlan,
    limitCount
  })
}

export async function listShareableCommunityStudioProjects(uid = '', limitCount = 30) {
  return listProjectRows({
    uid,
    collectionName: 'studioProjects',
    normalize: normalizeCommunityStudioProject,
    limitCount
  })
}

export async function resolveCommunityAttachmentMediaUrls(posts = []) {
  const paths = new Set()
  posts.forEach((post) => {
    ;(post.attachments || []).forEach((attachment) => {
      if (attachment.type === 'music' && attachment.storagePath) paths.add(attachment.storagePath)
      if (attachment.type === 'studio_project' && attachment.snapshot?.previewAudioPath) paths.add(attachment.snapshot.previewAudioPath)
    })
  })
  const entries = await Promise.all([...paths].map(async (path) => [path, await safeStorageUrl(path)]))
  return Object.fromEntries(entries.filter(([, url]) => Boolean(url)))
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

export async function deleteOwnCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'deleteOwnCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function listAdminCommunityModeration(payload = {}) {
  const callable = httpsCallable(functions, 'listAdminCommunityModeration')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function hideCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'hideCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function restoreCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'restoreCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function lockCommunityPostComments(payload = {}) {
  const callable = httpsCallable(functions, 'lockCommunityPostComments')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function pinCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'pinCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function unpinCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'unpinCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function hideCommunityComment(payload = {}) {
  const callable = httpsCallable(functions, 'hideCommunityComment')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function restoreCommunityComment(payload = {}) {
  const callable = httpsCallable(functions, 'restoreCommunityComment')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function moderateCommunity(payload = {}) {
  const callable = httpsCallable(functions, 'moderateCommunity')
  const result = await callable(payload)
  return result?.data || { ok: false }
}
