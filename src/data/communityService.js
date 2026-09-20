import { collection, doc, getDoc, getDocFromServer, getDocs, limit, orderBy, query, startAfter, Timestamp, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { deleteObject, getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
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
  const title = raw.title || raw.name || raw.slug || 'Community'
  const imageUrl = raw.imageUrl || raw.imageURL || raw.iconURL || ''
  const bannerImageUrl = raw.bannerImageUrl || raw.bannerURL || ''
  const moderatorIds = Array.isArray(raw.moderatorUids) ? raw.moderatorUids : Array.isArray(raw.moderatorIds) ? raw.moderatorIds : []
  return {
    communityId: id,
    id,
    slug: raw.slug || id,
    title,
    name: title,
    description: raw.description || '',
    rules: Array.isArray(raw.rules) ? raw.rules.filter(Boolean).slice(0, 20) : [],
    category: raw.category || 'Creator Help',
    imagePath: raw.imagePath || raw.iconPath || '',
    imageUrl,
    imageURL: imageUrl,
    iconURL: imageUrl,
    bannerImagePath: raw.bannerImagePath || '',
    bannerImageUrl,
    bannerURL: bannerImageUrl,
    createdBy: raw.createdBy || '',
    updatedBy: raw.updatedBy || '',
    ownerUid: raw.ownerUid || '',
    moderatorIds,
    moderatorUids: moderatorIds,
    memberCount: Math.max(0, Number(raw.memberCount || 0)),
    followerCount: Math.max(0, Number(raw.followerCount ?? raw.focusCount ?? 0)),
    focusCount: Math.max(0, Number(raw.focusCount || 0)),
    postCount: Math.max(0, Number(raw.postCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    pinnedPostIds: Array.isArray(raw.pinnedPostIds) ? raw.pinnedPostIds.filter(Boolean).slice(0, 3) : [],
    visibility: raw.visibility || 'public',
    postingMode: raw.postingMode || 'open',
    status: raw.status || 'active',
    hidden: raw.hidden === true,
    official: raw.official === true,
    lastPostAt: serializeDate(raw.lastPostAt),
    deletedAt: serializeDate(raw.deletedAt),
    moderatedAt: serializeDate(raw.moderatedAt),
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
        id: attachment.id || '',
        type: attachment.type || '',
        targetId: attachment.targetId || attachment.productId || attachment.projectId || attachment.storagePath || '',
        productId: attachment.productId || '',
        projectId: attachment.projectId || '',
        sourceType: attachment.sourceType || '',
        sourceId: attachment.sourceId || '',
        storagePath: attachment.storagePath || attachment.path || '',
        path: attachment.path || attachment.storagePath || '',
        url: attachment.url || '',
        name: attachment.name || '',
        size: Math.max(0, Number(attachment.size || 0)),
        contentType: attachment.contentType || '',
        width: Number.isFinite(Number(attachment.width)) ? Math.max(0, Number(attachment.width)) : null,
        height: Number.isFinite(Number(attachment.height)) ? Math.max(0, Number(attachment.height)) : null,
        duration: Number.isFinite(Number(attachment.duration)) ? Math.max(0, Number(attachment.duration)) : null,
        uploadedBy: attachment.uploadedBy || '',
        createdAt: serializeDate(attachment.createdAt),
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
      dislikes: Math.max(0, Number(raw.dislikeCount ?? raw.counts?.dislikes ?? 0)),
      comments: Math.max(0, Number(raw.commentCount ?? raw.counts?.comments ?? 0)),
      saves: Math.max(0, Number(raw.saveCount ?? raw.counts?.saves ?? 0)),
      shares: Math.max(0, Number(raw.shareCount ?? raw.counts?.shares ?? 0)),
      reports: Math.max(0, Number(raw.reportCount ?? raw.counts?.reports ?? 0))
    },
    likeCount: Math.max(0, Number(raw.likeCount ?? raw.counts?.likes ?? 0)),
    dislikeCount: Math.max(0, Number(raw.dislikeCount ?? raw.counts?.dislikes ?? 0)),
    commentCount: Math.max(0, Number(raw.commentCount ?? raw.counts?.comments ?? 0)),
    saveCount: Math.max(0, Number(raw.saveCount ?? raw.counts?.saves ?? 0)),
    shareCount: Math.max(0, Number(raw.shareCount ?? raw.counts?.shares ?? 0)),
    reportCount: Math.max(0, Number(raw.reportCount ?? raw.counts?.reports ?? 0)),
    score: Math.max(0, Number(raw.score || 0)),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    edited: raw.edited === true,
    editedAt: serializeDate(raw.editedAt)
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

async function getFreshDocument(documentRef) {
  try {
    return await getDocFromServer(documentRef)
  } catch {
    // Preserve the last known interaction state if the connection goes away
    // while a Community page is open.
    return getDoc(documentRef).catch(() => null)
  }
}

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
    dislikeCount: Math.max(0, Number(raw.dislikeCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.slice(0, 3).map((attachment) => ({
      type: attachment?.type || 'file',
      name: attachment?.name || 'Attachment',
      path: attachment?.path || '',
      url: attachment?.url || '',
      size: Math.max(0, Number(attachment?.size || 0)),
      contentType: attachment?.contentType || ''
    })) : [],
    status: raw.status || 'visible',
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

async function attachCommunityCommentUrls(comment = {}) {
  const attachments = await Promise.all((comment.attachments || []).map(async (attachment) => ({
    ...attachment,
    url: attachment.url || await safeStorageUrl(attachment.path)
  })))
  return { ...comment, attachments }
}

function communityCommentAuthorFromProfile(comment = {}, profile = {}) {
  const displayName = String(profile.displayName || profile.name || '').trim()
  const username = String(profile.username || profile.handle || '').trim()
  const avatarURL = String(
    profile.avatarThumbnailURL
    || profile.photoThumbnailURL
    || profile.avatarURL
    || profile.avatarUrl
    || profile.photoURL
    || profile.photoUrl
    || ''
  ).trim()
  return {
    ...comment,
    authorDisplayName: displayName || comment.authorDisplayName || 'Melogic Creator',
    authorUsername: username || comment.authorUsername || '',
    authorAvatarURL: avatarURL || comment.authorAvatarURL || ''
  }
}

async function hydrateCommunityCommentAuthors(comments = []) {
  const authorUids = [...new Set(comments.map((comment) => String(comment?.authorUid || '').trim()).filter(Boolean))]
  if (!authorUids.length) return comments

  // These are public profile documents. Read them for every comment fetch so
  // display names, usernames, and avatars do not remain stale in comment data.
  const profiles = await Promise.all(authorUids.map(async (uid) => {
    const snapshot = await getDoc(doc(db, 'profiles', uid)).catch(() => null)
    return [uid, snapshot?.exists?.() ? snapshot.data() || {} : {}]
  }))
  const profileByUid = new Map(profiles)
  return comments.map((comment) => communityCommentAuthorFromProfile(comment, profileByUid.get(comment.authorUid) || {}))
}

async function hydrateCommunityComments(comments = []) {
  const [commentsWithUrls, commentsWithAuthors] = await Promise.all([
    Promise.all(comments.map(attachCommunityCommentUrls)),
    hydrateCommunityCommentAuthors(comments)
  ])
  return commentsWithUrls.map((comment, index) => ({
    ...comment,
    ...commentsWithAuthors[index],
    attachments: comment.attachments
  }))
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
    authorPhotoURL: raw.authorPhotoURL || raw.authorAvatarURL || '',
    mediaType: raw.mediaType === 'video' ? 'video' : raw.mediaType === 'image' ? 'image' : 'text',
    text: raw.text || '',
    caption: raw.caption || raw.text || '',
    mediaPath: raw.mediaPath || '',
    mediaURL: raw.mediaURL || '',
    thumbnailPath: raw.thumbnailPath || '',
    thumbnailURL: raw.thumbnailURL || '',
    durationSeconds: Math.max(0, Number(raw.durationSeconds || 0)),
    background: raw.background || 'aurora',
    linkedPostId: raw.linkedPostId || '',
    linkedProductId: raw.linkedProductId || '',
    remixPermission: raw.remixPermission === true,
    remixOfStoryId: raw.remixOfStoryId || '',
    remixSourceAuthorUid: raw.remixSourceAuthorUid || '',
    remixSourceAuthorDisplayName: raw.remixSourceAuthorDisplayName || '',
    remixSourceCreatedAt: serializeDate(raw.remixSourceCreatedAt),
    expiresAt: serializeDate(raw.expiresAt),
    lifetimeHours: Math.max(1, Number(raw.lifetimeHours || 24)),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    viewCount: Math.max(0, Number(raw.viewCount || 0)),
    likeCount: Math.max(0, Number(raw.likeCount || 0)),
    replyCount: Math.max(0, Number(raw.replyCount || 0)),
    reportCount: Math.max(0, Number(raw.reportCount || 0)),
    moderationStatus: raw.moderationStatus || '',
    status: raw.status || 'active',
    visibility: raw.visibility || 'public',
    layers: Array.isArray(raw.layers) ? raw.layers.map((layer, index) => ({
      id: String(layer?.id || `layer-${index + 1}`),
      type: String(layer?.type || ''),
      x: Number(layer?.x ?? .5),
      y: Number(layer?.y ?? .5),
      width: Number(layer?.width ?? .25),
      height: Number(layer?.height ?? .1),
      rotation: Number(layer?.rotation || 0),
      scale: Number(layer?.scale ?? 1),
      opacity: Number(layer?.opacity ?? 1),
      zIndex: Number(layer?.zIndex ?? index),
      startMs: Math.max(0, Number(layer?.startMs || 0)),
      endMs: Math.max(0, Number(layer?.endMs || 0)),
      content: String(layer?.content || ''),
      targetId: String(layer?.targetId || ''),
      targetURL: String(layer?.targetURL || ''),
      metadata: layer?.metadata && typeof layer.metadata === 'object' ? layer.metadata : {}
    })) : [],
    layerSchemaVersion: Math.max(1, Number(raw.layerSchemaVersion || 1))
  }
}

async function queryWithIndexFallback(primaryConstraints, fallbackConstraints, normalize, filter = null, sorter = null) {
  try {
    const snapshot = await getDocs(query(collection(db, normalize === normalizeCommunity ? COMMUNITY_COLLECTION : POST_COLLECTION), ...primaryConstraints))
    return snapshot.docs.map((docSnap) => normalize(docSnap))
  } catch (error) {
    if (!isFirestoreIndexError(error)) throw error
    logFirestoreIndexUrl(error, 'community query')
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

export async function listSelectableCommunities({ search = '', limitCount = 80 } = {}) {
  const safeLimit = Math.max(10, Math.min(100, Number(limitCount) || 80))
  const rows = await listCommunities({ category: 'all', search, limitCount: safeLimit })
  return rows
    .filter((community) => community.status === 'active' && community.visibility === 'public' && community.hidden !== true)
    .slice(0, safeLimit)
}

// melogic-community-canonical-metadata-v1
export async function getCommunityById(communityId = '') {
  const id = String(communityId || '').trim()
  if (!id || id.includes('/')) return null
  const snap = await getDoc(doc(db, COMMUNITY_COLLECTION, id)).catch((error) => {
    if (String(error?.code || '').includes('permission-denied')) return null
    throw error
  })
  if (!snap?.exists?.()) return null
  const community = normalizeCommunity(snap)
  if (community.status !== 'active' || community.visibility !== 'public') return null
  return community
}

export async function hydrateCommunityPostCommunities(posts = []) {
  const rows = Array.isArray(posts) ? posts : []
  const ids = [...new Set(rows.map((post) => String(post?.communityId || '').trim()).filter((id) => id && !id.includes('/')))]
  if (!ids.length) return rows

  const entries = await Promise.all(ids.map(async (id) => [id, await getCommunityById(id)]))
  const byId = new Map(entries.filter(([, community]) => Boolean(community)))

  return rows.map((post) => {
    const community = byId.get(String(post?.communityId || '').trim())
    if (!community) return post
    return {
      ...post,
      // communityId is the relationship. Mutable identity always comes from
      // communities/{communityId}, never the denormalized post snapshot.
      communitySlug: community.slug || community.communityId,
      communityName: community.name || community.title || community.slug || 'Community',
      community: {
        communityId: community.communityId,
        slug: community.slug || community.communityId,
        name: community.name || community.title || community.slug || 'Community',
        title: community.title || community.name || community.slug || 'Community',
        imageUrl: community.imageUrl || community.imageURL || community.iconURL || '',
        imagePath: community.imagePath || '',
        category: community.category || ''
      }
    }
  })
}

export async function getCommunityBySlug(slug = '') {
  const clean = String(slug || '').trim()
  if (!clean) return null
  const snap = await getDoc(doc(db, COMMUNITY_COLLECTION, clean)).catch((error) => {
    if (String(error?.code || '').includes('permission-denied')) return null
    throw error
  })
  let community = snap?.exists?.() ? normalizeCommunity(snap) : null
  if (!community) {
    const slugSnap = await getDocs(query(
      collection(db, COMMUNITY_COLLECTION),
      where('slug', '==', clean),
      where('status', '==', 'active'),
      where('visibility', '==', 'public'),
      limit(1)
    )).catch((error) => {
      if (String(error?.code || '').includes('permission-denied')) return null
      throw error
    })
    community = slugSnap?.docs?.[0] ? normalizeCommunity(slugSnap.docs[0]) : null
  }
  if (!community) return null
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

function isFirestoreIndexError(error) {
  const detail = `${error?.code || ''} ${error?.message || ''} ${error?.details || ''}`.toLowerCase()
  return detail.includes('failed-precondition') || detail.includes('requires an index') || detail.includes('query requires an index')
}

function logFirestoreIndexUrl(error, scope = 'community query') {
  const url = String(error?.message || error?.details || '').match(/https:\/\/console\.firebase\.google\.com\/\S+/)?.[0] || ''
  if (url) console.warn(`[communityService] ${scope} index URL`, url)
}

export async function listCommunityPosts({ tab = 'for-you', communityId = '', communitySlug = '', communityIds = [], limitCount = 25, tag = '', search = '', sort = 'new', pageMode = false, cursor = null } = {}) {
  const tagKey = normalizeTagKey(tag)
  const searchToken = normalizeFeedSearchToken(search)
  const canonicalCommunityId = String(communityId || '').trim()
  const selectedCommunityIds = [...new Set((Array.isArray(communityIds) ? communityIds : [])
    .map((id) => String(id || '').trim())
    .filter((id) => id && !id.includes('/')))].slice(0, 10)
  const cleanSort = ['new', 'top-today', 'top-week', 'most-discussed'].includes(sort) ? sort : 'new'
  const pageLimit = Math.max(1, Number(limitCount || 25))
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]
  if (canonicalCommunityId) constraints.push(where('communityId', '==', canonicalCommunityId))
  else if (selectedCommunityIds.length) constraints.push(where('communityId', 'in', selectedCommunityIds))
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
      if (!isFirestoreIndexError(error)) throw error
      logFirestoreIndexUrl(error, 'feed')
      const snapshot = await getDocs(query(collection(db, POST_COLLECTION), ...fallbackConstraints))
      const rows = snapshot.docs
        .map((docSnap) => normalizeCommunityPost(docSnap))
        .filter((post) => (
          (!canonicalCommunityId || post.communityId === canonicalCommunityId)
          && (!selectedCommunityIds.length || selectedCommunityIds.includes(post.communityId))
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
      (!canonicalCommunityId || post.communityId === canonicalCommunityId)
      && (!selectedCommunityIds.length || selectedCommunityIds.includes(post.communityId))
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

export async function listFocusedCommunityPosts(uid = '', limitCount = 25, selectedCommunityIds = []) {
  const selectedIds = new Set((Array.isArray(selectedCommunityIds) ? selectedCommunityIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))
  const focusedCommunityIds = (await listFocusedCommunityIds(uid, 50))
    .filter((communityId) => !selectedIds.size || selectedIds.has(communityId))
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
    if (!isFirestoreIndexError(error)) throw error
    logFirestoreIndexUrl(error, 'focused feed')
    const focusedSet = new Set(focusedCommunityIds)
    const posts = await listCommunityPosts({ limitCount: Math.min(60, Math.max(30, limitCount * 4)) })
    return posts.filter((post) => focusedSet.has(post.communityId)).slice(0, limitCount)
  }
}

export async function listFollowedCreatorPosts(uid = '', {
  limitCount = 24,
  selectedCommunityIds = [],
  tag = '',
  search = ''
} = {}) {
  const viewerUid = String(uid || '').trim()
  if (!viewerUid) return []

  const followingSnapshot = await getDocs(query(
    collection(db, 'users', viewerUid, 'following'),
    limit(50)
  ))
  const followedIds = followingSnapshot.docs
    .map((entry) => String(entry.id || '').trim())
    .filter((authorUid) => authorUid && authorUid !== viewerUid)
  if (!followedIds.length) return []

  const selectedIds = new Set((Array.isArray(selectedCommunityIds) ? selectedCommunityIds : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean))
  const tagKey = normalizeTagKey(tag)
  const searchToken = normalizeFeedSearchToken(search)
  const pageLimit = Math.min(50, Math.max(1, Number(limitCount || 24)))
  const chunks = []
  for (let index = 0; index < followedIds.length; index += 30) {
    chunks.push(followedIds.slice(index, index + 30))
  }

  const snapshots = await Promise.all(chunks.map((authorIds) => getDocs(query(
    collection(db, POST_COLLECTION),
    where('authorUid', 'in', authorIds),
    where('status', '==', 'published'),
    where('visibility', '==', 'public'),
    orderBy('createdAt', 'desc'),
    limit(pageLimit)
  ))))
  const posts = snapshots
    .flatMap((snapshot) => snapshot.docs.map((docSnap) => normalizeCommunityPost(docSnap)))
    .filter((post) => post.authorUid !== viewerUid)
    .filter((post) => !selectedIds.size || selectedIds.has(post.communityId))
    .filter((post) => !tagKey || (post.tagKeys || post.tags || []).includes(tagKey))
    .filter((post) => postMatchesFeedSearch(post, searchToken))
    .sort(postSort('new'))

  return posts.slice(0, pageLimit)
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
  const [hydratedPost] = await hydrateCommunityPostCommunities([post])
  return hydratedPost || post
}

export async function getCommunityPostViewerState(postId = '', uid = '') {
  const id = String(postId || '').trim()
  const viewerUid = String(uid || '').trim()
  if (!id || !viewerUid) return { liked: false, disliked: false, saved: false }
  const [likeSnap, dislikeSnap, saveSnap] = await Promise.all([
    getFreshDocument(doc(db, POST_COLLECTION, id, 'likes', viewerUid)),
    getFreshDocument(doc(db, POST_COLLECTION, id, 'dislikes', viewerUid)),
    getFreshDocument(doc(db, POST_COLLECTION, id, 'saves', viewerUid))
  ])
  return { liked: Boolean(likeSnap?.exists?.()), disliked: Boolean(dislikeSnap?.exists?.()), saved: Boolean(saveSnap?.exists?.()) }
}

export async function listCommunityComments(postId = '', limitCount = 120) {
  const id = String(postId || '').trim()
  if (!id) return []
  const commentsRef = collection(db, POST_COLLECTION, id, 'comments')
  try {
    const snapshot = await getDocs(query(commentsRef, where('status', '==', 'visible'), orderBy('createdAt', 'asc'), limit(limitCount)))
    return hydrateCommunityComments(snapshot.docs.map((docSnap) => normalizeCommunityComment(docSnap)))
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const snapshot = await getDocs(query(commentsRef, where('status', '==', 'visible'), limit(limitCount)))
    return hydrateCommunityComments(snapshot.docs
      .map((docSnap) => normalizeCommunityComment(docSnap))
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
    )
  }
}

export async function getCommunityComment(postId = '', commentId = '') {
  const cleanPostId = String(postId || '').trim()
  const cleanCommentId = String(commentId || '').trim()
  if (!cleanPostId || !cleanCommentId) return null
  const snapshot = await getDoc(doc(db, POST_COLLECTION, cleanPostId, 'comments', cleanCommentId)).catch((error) => {
    if (String(error?.code || '').includes('permission-denied')) return null
    throw error
  })
  if (!snapshot?.exists()) return null
  const comment = normalizeCommunityComment(snapshot)
  if (comment.status !== 'visible') return null
  return hydrateCommunityComments([comment]).then(([hydratedComment]) => hydratedComment || null)
}

export async function listCommunityCommentsPage({
  postId = '',
  parentCommentId = '',
  limitCount = 10,
  cursor = null
} = {}) {
  const id = String(postId || '').trim()
  if (!id) return { comments: [], cursor: null, hasMore: false }
  const commentsRef = collection(db, POST_COLLECTION, id, 'comments')
  const pageSize = Math.max(1, Math.min(50, Number(limitCount) || 10))
  const cleanParentId = String(parentCommentId || '').trim()
  const constraints = [
    where('status', '==', 'visible'),
    where('parentCommentId', '==', cleanParentId),
    orderBy('createdAt', 'asc')
  ]
  if (cursor) constraints.push(startAfter(cursor))
  constraints.push(limit(pageSize + 1))

  try {
    const snapshot = await getDocs(query(commentsRef, ...constraints))
    const pageDocs = snapshot.docs.slice(0, pageSize)
    return {
      comments: await hydrateCommunityComments(pageDocs.map((docSnap) => normalizeCommunityComment(docSnap))),
      cursor: pageDocs.length ? pageDocs[pageDocs.length - 1] : cursor || null,
      hasMore: snapshot.docs.length > pageSize
    }
  } catch (error) {
    if (!String(error?.message || '').includes('requires an index')) throw error
    const fallbackConstraints = [
      where('status', '==', 'visible'),
      where('parentCommentId', '==', cleanParentId)
    ]
    if (cursor) fallbackConstraints.push(startAfter(cursor))
    fallbackConstraints.push(limit(pageSize + 1))
    const snapshot = await getDocs(query(commentsRef, ...fallbackConstraints))
    const rows = snapshot.docs
      .map((docSnap) => ({ docSnap, comment: normalizeCommunityComment(docSnap) }))
      .sort((a, b) => new Date(a.comment.createdAt || 0).getTime() - new Date(b.comment.createdAt || 0).getTime())
    const pageRows = rows.slice(0, pageSize)
    return {
      comments: await hydrateCommunityComments(pageRows.map((row) => row.comment)),
      cursor: pageRows.length ? pageRows[pageRows.length - 1].docSnap : cursor || null,
      hasMore: rows.length > pageSize
    }
  }
}

export async function getCommunityTopComment(postId = '') {
  const result = await listCommunityCommentsPage({
    postId,
    parentCommentId: '',
    limitCount: 1
  })
  return result.comments[0] || null
}

export async function getCommunityCommentViewerState(postId = '', commentId = '', uid = '') {
  const cleanPostId = String(postId || '').trim()
  const cleanCommentId = String(commentId || '').trim()
  const viewerUid = String(uid || '').trim()
  if (!cleanPostId || !cleanCommentId || !viewerUid) return { liked: false, disliked: false }
  const [likeSnap, dislikeSnap] = await Promise.all([
    getFreshDocument(doc(db, POST_COLLECTION, cleanPostId, 'comments', cleanCommentId, 'likes', viewerUid)),
    getFreshDocument(doc(db, POST_COLLECTION, cleanPostId, 'comments', cleanCommentId, 'dislikes', viewerUid))
  ])
  return { liked: Boolean(likeSnap?.exists?.()), disliked: Boolean(dislikeSnap?.exists?.()) }
}

export function newCommunityStoryId() {
  return doc(collection(db, STORY_COLLECTION)).id
}

function storyIsNotExpired(story) {
  const expiresMs = new Date(story.expiresAt || 0).getTime()
  return Number.isFinite(expiresMs) && expiresMs > Date.now()
}

async function attachStoryMediaUrl(story) {
  if ((story.mediaType !== 'image' && story.mediaType !== 'video') || story.mediaURL || !story.mediaPath || !storage) return story
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
      if (['image', 'video', 'audio', 'file'].includes(attachment.type) && (attachment.path || attachment.storagePath)) {
        paths.add(attachment.path || attachment.storagePath)
      }
    })
  })
  const entries = await Promise.all([...paths].map(async (path) => [path, await safeStorageUrl(path)]))
  return Object.fromEntries(entries.filter(([, url]) => Boolean(url)))
}

function storyMediaExtension(file) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  if (type.includes('webm') || name.endsWith('.webm')) return 'webm'
  if (type.includes('mp4') || name.endsWith('.mp4')) return 'mp4'
  if (type.includes('quicktime') || name.endsWith('.mov')) return 'mov'
  if (type.includes('webp') || name.endsWith('.webp')) return 'webp'
  if (type.includes('png') || name.endsWith('.png')) return 'png'
  return 'jpg'
}

function storyMediaType(file) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  if (type.startsWith('video/') || /\.(mov|mp4|m4v|webm|avi|mkv|3gp|3g2|mpeg|mpg|ogv)$/i.test(name)) return 'video'
  if (type.startsWith('image/') || /\.(heic|heif|avif|jpg|jpeg|jfif|png|webp|gif|bmp|tif|tiff)$/i.test(name)) return 'image'
  return ''
}

function storyFileFromBlob(blob, name, type) {
  if (typeof File === 'function') return new File([blob], name, { type, lastModified: Date.now() })
  blob.name = name
  return blob
}

async function storyCanvasBlob(canvas, preferredType = 'image/webp', quality = 0.82) {
  const makeBlob = (type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q))
  let blob = await makeBlob(preferredType, quality)
  if (!blob || (preferredType === 'image/webp' && blob.type !== 'image/webp')) blob = await makeBlob('image/jpeg', 0.86)
  if (!blob) throw new Error('This image could not be converted for Story upload.')
  return blob
}

async function decodeStoryImage(file) {
  if (typeof createImageBitmap === 'function') {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch {}
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return image
  } finally {
    // Revoked by the caller after draw for Image elements; ImageBitmap does not use this URL.
    if (!url) URL.revokeObjectURL(url)
  }
}

async function normalizeStoryImage(file) {
  let source = null
  let sourceUrl = ''
  try {
    if (typeof createImageBitmap === 'function') {
      try { source = await createImageBitmap(file, { imageOrientation: 'from-image' }) } catch {}
    }
    if (!source) {
      sourceUrl = URL.createObjectURL(file)
      const image = new Image()
      image.decoding = 'async'
      image.src = sourceUrl
      await image.decode()
      source = image
    }
    const sourceWidth = Number(source.naturalWidth || source.width || 0)
    const sourceHeight = Number(source.naturalHeight || source.height || 0)
    if (!sourceWidth || !sourceHeight) throw new Error('This image has no readable dimensions.')
    const maxDimension = 2160
    const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('Image conversion is unavailable in this browser.')
    context.drawImage(source, 0, 0, width, height)
    const blob = await storyCanvasBlob(canvas, 'image/webp', 0.82)
    const contentType = blob.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
    const extension = contentType === 'image/webp' ? 'webp' : 'jpg'
    return storyFileFromBlob(blob, `story-${Date.now()}.${extension}`, contentType)
  } catch (error) {
    throw new Error(`This image format cannot be decoded on this device. ${error?.message || ''}`.trim())
  } finally {
    if (sourceUrl) URL.revokeObjectURL(sourceUrl)
    if (source && typeof source.close === 'function') source.close()
  }
}

function preferredStoryVideoMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ]
  return candidates.find((type) => MediaRecorder.isTypeSupported(type)) || ''
}

async function normalizeStoryVideo(file) {
  const outputType = preferredStoryVideoMimeType()
  if (!outputType || typeof document === 'undefined') return file
  const video = document.createElement('video')
  const sourceUrl = URL.createObjectURL(file)
  video.src = sourceUrl
  video.muted = false
  video.playsInline = true
  video.preload = 'auto'
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video decoding timed out.')), 12000)
      video.onloadedmetadata = () => { clearTimeout(timer); resolve() }
      video.onerror = () => { clearTimeout(timer); reject(new Error('This video codec cannot be decoded on this device.')) }
      video.load()
    })
    // captureStream keeps the source audio track when the browser exposes it,
    // unlike canvas-only capture. If unavailable, retain the original rather
    // than silently destroying Story audio.
    const capture = video.captureStream || video.mozCaptureStream
    if (typeof capture !== 'function') return file
    video.currentTime = 0
    await video.play()
    const stream = capture.call(video)
    const recorder = new MediaRecorder(stream, { mimeType: outputType, videoBitsPerSecond: 3500000, audioBitsPerSecond: 128000 })
    const chunks = []
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data) }
    const finished = new Promise((resolve, reject) => {
      recorder.onerror = () => reject(new Error('Video conversion failed.'))
      recorder.onstop = resolve
    })
    recorder.start(1000)
    await new Promise((resolve) => {
      const stop = () => resolve()
      video.addEventListener('ended', stop, { once: true })
      setTimeout(stop, Math.min(61000, Math.max(1000, Number(video.duration || 60) * 1000 + 750)))
    })
    if (recorder.state !== 'inactive') recorder.stop()
    video.pause()
    await finished
    stream.getTracks().forEach((track) => track.stop())
    const baseType = outputType.startsWith('video/mp4') ? 'video/mp4' : 'video/webm'
    const blob = new Blob(chunks, { type: baseType })
    if (!blob.size) return file
    return storyFileFromBlob(blob, `story-${Date.now()}.${baseType === 'video/mp4' ? 'mp4' : 'webm'}`, baseType)
  } catch (error) {
    // If the browser can play the selected video but cannot expose a safe
    // transcoding stream, preserve the original file. Storage accepts it and
    // Story playback can use the browser-native codec on capable devices.
    if (video.readyState >= 1) return file
    throw error
  } finally {
    video.pause()
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(sourceUrl)
  }
}

export function validateCommunityStoryMedia(file = null, { normalized = false } = {}) {
  if (!file) throw new Error('Choose a video or image for this story.')
  const mediaType = storyMediaType(file)
  const type = String(file?.type || '').toLowerCase()
  const size = Number(file?.size || 0)
  if (!mediaType) throw new Error('Stories support image and video files only.')
  // Source files are intentionally broad: normalization happens before final
  // upload. Final normalized assets keep conservative storage limits.
  if (!normalized) {
    if (size > 500 * 1024 * 1024) throw new Error('Story source media must be 500 MB or smaller.')
    return { mediaType, contentType: type || (mediaType === 'image' ? 'application/octet-stream' : 'application/octet-stream') }
  }
  if (mediaType === 'video' && size > 150 * 1024 * 1024) throw new Error('Converted Story videos must be 150 MB or smaller.')
  if (mediaType === 'image' && size > 12 * 1024 * 1024) throw new Error('Converted Story images must be 12 MB or smaller.')
  return { mediaType, contentType: type || 'application/octet-stream' }
}

export async function normalizeCommunityStoryMedia(file = null) {
  const { mediaType } = validateCommunityStoryMedia(file)
  const normalizedFile = mediaType === 'image' ? await normalizeStoryImage(file) : await normalizeStoryVideo(file)
  const normalized = validateCommunityStoryMedia(normalizedFile, { normalized: true })
  return { file: normalizedFile, mediaType: normalized.mediaType, contentType: normalized.contentType }
}

export async function uploadCommunityStoryMedia({ uid = '', storyId = '', file = null, onProgress = null, normalize = true } = {}) {
  const ownerUid = String(uid || '').trim()
  const id = String(storyId || '').trim()
  if (!storage) throw new Error('Storage is not available.')
  if (!ownerUid || ownerUid.includes('/')) throw new Error('A signed-in account is required.')
  if (!id || id.includes('/')) throw new Error('A valid story id is required.')
  const prepared = normalize ? await normalizeCommunityStoryMedia(file) : { file, ...validateCommunityStoryMedia(file, { normalized: true }) }
  const uploadFile = prepared.file
  const { mediaType, contentType } = prepared

  const mediaPath = `${STORY_COLLECTION}/${ownerUid}/${id}/normalized-${Date.now()}.${storyMediaExtension(uploadFile)}`
  const fileRef = ref(storage, mediaPath)
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, uploadFile, { contentType })
    task.on('state_changed', (snapshot) => {
      const progress = snapshot.totalBytes ? Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100) : 0
      if (typeof onProgress === 'function') onProgress(progress)
    }, reject, resolve)
  })
  const mediaURL = await getDownloadURL(fileRef).catch(() => '')
  return { mediaPath, mediaURL, mediaType, contentType, size: Number(uploadFile.size || 0) }
}

export async function uploadCommunityStoryImage({ uid = '', storyId = '', file = null } = {}) {
  return uploadCommunityStoryMedia({ uid, storyId, file })
}

function communityAssetExtension(file = null) {
  const type = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  if (type.includes('webp') || name.endsWith('.webp')) return 'webp'
  if (type.includes('png') || name.endsWith('.png')) return 'png'
  if (type.includes('jpeg') || type.includes('jpg') || name.endsWith('.jpeg') || name.endsWith('.jpg')) return 'jpg'
  return 'webp'
}

export function validateCommunityImage(file = null, { maxBytes = 8 * 1024 * 1024 } = {}) {
  const type = String(file?.type || '').toLowerCase()
  const size = Number(file?.size || 0)
  if (!file) return null
  if (!type.startsWith('image/')) throw new Error('Community images must be image files.')
  if (size > maxBytes) throw new Error('Community images must be 8 MB or smaller.')
  return { contentType: type || 'image/webp' }
}

export async function uploadCommunityImage({ slug = '', kind = 'profile', file = null } = {}) {
  const cleanSlug = String(slug || '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  const cleanKind = kind === 'banner' ? 'banner' : 'profile'
  if (!storage) throw new Error('Storage is not available.')
  if (!cleanSlug) throw new Error('Community slug is required before upload.')
  const { contentType } = validateCommunityImage(file) || {}
  const storagePath = `assets/site/community/communities/${cleanSlug}/${cleanKind}/original-${Date.now()}.${communityAssetExtension(file)}`
  const fileRef = ref(storage, storagePath)
  await new Promise((resolve, reject) => {
    const task = uploadBytesResumable(fileRef, file, { contentType })
    task.on('state_changed', null, reject, resolve)
  })
  const downloadURL = await getDownloadURL(fileRef).catch(() => '')
  return { storagePath, downloadURL }
}

export async function createCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunityPost')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export function newCommunityPostId() {
  return doc(collection(db, POST_COLLECTION)).id
}

const COMMUNITY_POST_ATTACHMENT_LIMITS = {
  image: 10 * 1024 * 1024,
  video: 150 * 1024 * 1024,
  audio: 50 * 1024 * 1024,
  file: 50 * 1024 * 1024
}

const COMMUNITY_POST_ATTACHMENT_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/webm',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/json'
])

function communityPostAttachmentType(file = null) {
  const contentType = String(file?.type || '').toLowerCase()
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  if (COMMUNITY_POST_ATTACHMENT_CONTENT_TYPES.has(contentType)) return 'file'
  return ''
}

export function validateCommunityPostAttachment(file = null) {
  if (!file) throw new Error('Choose a file to attach.')
  const contentType = String(file.type || '').toLowerCase()
  const type = communityPostAttachmentType(file)
  const size = Math.max(0, Number(file.size || 0))
  if (!type || !COMMUNITY_POST_ATTACHMENT_CONTENT_TYPES.has(contentType)) {
    throw new Error('Posts support common images, videos, audio, PDF, text, ZIP, and JSON files.')
  }
  if (!size) throw new Error('Choose a non-empty file to attach.')
  const maxBytes = COMMUNITY_POST_ATTACHMENT_LIMITS[type]
  if (size > maxBytes) {
    throw new Error(`${type === 'image' ? 'Images' : type === 'video' ? 'Videos' : type === 'audio' ? 'Audio files' : 'Files'} must be ${Math.round(maxBytes / 1024 / 1024)} MB or smaller.`)
  }
  return { type, contentType, size, maxBytes }
}

function safeCommunityPostAttachmentName(value = '') {
  const clean = String(value || 'attachment')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean.slice(-140) || 'attachment'
}

export async function uploadCommunityPostAttachments({
  uid = '',
  postId = '',
  files = [],
  metadataById = {},
  onProgress = null
} = {}) {
  const cleanUid = String(uid || '').trim()
  const cleanPostId = String(postId || '').trim()
  const requestedFiles = Array.from(files || [])
  const selectedFiles = requestedFiles.slice(0, 8)
  if (!storage) throw new Error('Storage is not available.')
  if (!cleanUid || cleanUid.includes('/') || !cleanPostId || cleanPostId.includes('/')) {
    throw new Error('Sign in before attaching files.')
  }
  if (requestedFiles.length > 8) throw new Error('Posts can include up to 8 files.')

  const uploads = []
  try {
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const entry = selectedFiles[index]
      const file = entry?.file || entry
      const id = String(entry?.id || `${Date.now()}-${index}`).replace(/[^a-zA-Z0-9_-]+/g, '').slice(0, 80)
      const { type, contentType, size } = validateCommunityPostAttachment(file)
      const name = safeCommunityPostAttachmentName(file.name)
      const path = `community/posts/${cleanUid}/${cleanPostId}/attachments/${id}-${name}`
      const fileRef = ref(storage, path)
      await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(fileRef, file, {
          contentType,
          customMetadata: {
            authorUid: cleanUid,
            postId: cleanPostId,
            attachmentId: id,
            attachmentType: type
          }
        })
        task.on('state_changed', (snapshot) => {
          const current = snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0
          onProgress?.(((index + current) / selectedFiles.length) * 100)
        }, reject, resolve)
      })
      const url = await getDownloadURL(fileRef).catch(() => '')
      const mediaMetadata = metadataById[id] || entry?.metadata || {}
      uploads.push({
        id,
        type,
        name: file.name || name,
        path,
        storagePath: path,
        url,
        size,
        contentType,
        width: Number.isFinite(Number(mediaMetadata.width)) ? Math.max(0, Math.round(Number(mediaMetadata.width))) : null,
        height: Number.isFinite(Number(mediaMetadata.height)) ? Math.max(0, Math.round(Number(mediaMetadata.height))) : null,
        duration: Number.isFinite(Number(mediaMetadata.duration)) ? Math.max(0, Number(mediaMetadata.duration)) : null,
        uploadedBy: cleanUid
      })
    }
  } catch (error) {
    await deleteCommunityPostAttachments(uploads)
    throw error
  }
  onProgress?.(100)
  return uploads
}

export async function deleteCommunityPostAttachments(attachments = []) {
  if (!storage) return
  await Promise.allSettled((Array.isArray(attachments) ? attachments : [])
    .map((attachment) => String(attachment?.path || attachment?.storagePath || '').trim())
    .filter((path) => path.startsWith('community/posts/'))
    .map((path) => deleteObject(ref(storage, path))))
}

export function newCommunityCommentId(postId = '') {
  const cleanPostId = String(postId || '').trim()
  if (!cleanPostId) throw new Error('A post is required before attaching files.')
  return doc(collection(db, POST_COLLECTION, cleanPostId, 'comments')).id
}

function commentAttachmentType(file = null) {
  const contentType = String(file?.type || '').toLowerCase()
  const name = String(file?.name || '').toLowerCase()
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('audio/')) return 'audio'
  if (/\.(json|zip|mid|midi|als|flp|logicx|ptx)$/i.test(name)) return 'project'
  return ''
}

export function validateCommunityCommentAttachment(file = null) {
  if (!file) throw new Error('Choose a file to attach.')
  const type = commentAttachmentType(file)
  const size = Math.max(0, Number(file.size || 0))
  const limits = {
    image: 8 * 1024 * 1024,
    audio: 25 * 1024 * 1024,
    project: 15 * 1024 * 1024
  }
  if (!type) throw new Error('Comments support images, audio, MIDI, JSON, ZIP, and common project files.')
  if (!size) throw new Error('Choose a non-empty file to attach.')
  if (size > limits[type]) throw new Error(`${type === 'audio' ? 'Audio' : type === 'image' ? 'Images' : 'Project files'} must be ${Math.round(limits[type] / 1024 / 1024)} MB or smaller.`)
  const rawContentType = String(file.type || '').toLowerCase()
  const allowedProjectContentTypes = new Set([
    'application/json',
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream',
    'audio/midi',
    'audio/x-midi'
  ])
  const contentType = type === 'project'
    ? (allowedProjectContentTypes.has(rawContentType) ? rawContentType : 'application/octet-stream')
    : rawContentType
  return { type, contentType, size }
}

function safeCommentAttachmentName(value = '') {
  const clean = String(value || 'attachment')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
  return clean.slice(-140) || 'attachment'
}

export async function uploadCommunityCommentAttachments({
  uid = '',
  postId = '',
  commentId = '',
  files = [],
  onProgress = null
} = {}) {
  const cleanUid = String(uid || '').trim()
  const cleanPostId = String(postId || '').trim()
  const cleanCommentId = String(commentId || '').trim()
  const selectedFiles = Array.from(files || []).slice(0, 3)
  if (!storage) throw new Error('Storage is not available.')
  if (!cleanUid || !cleanPostId || !cleanCommentId) throw new Error('Sign in and choose a post before attaching files.')
  const uploads = []
  try {
    for (let index = 0; index < selectedFiles.length; index += 1) {
      const file = selectedFiles[index]
      const { type, contentType, size } = validateCommunityCommentAttachment(file)
      const name = safeCommentAttachmentName(file.name)
      const path = `community/comments/${cleanUid}/${cleanPostId}/${cleanCommentId}/${Date.now()}-${index}-${name}`
      const fileRef = ref(storage, path)
      await new Promise((resolve, reject) => {
        const task = uploadBytesResumable(fileRef, file, {
          contentType,
          customMetadata: { authorUid: cleanUid, postId: cleanPostId, commentId: cleanCommentId, attachmentType: type }
        })
        task.on('state_changed', (snapshot) => {
          const current = snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0
          onProgress?.(((index + current) / selectedFiles.length) * 100)
        }, reject, resolve)
      })
      const url = await getDownloadURL(fileRef).catch(() => '')
      uploads.push({ type, name: file.name || name, path, url, size, contentType })
    }
  } catch (error) {
    await deleteCommunityCommentAttachments(uploads)
    throw error
  }
  onProgress?.(100)
  return uploads
}

export async function deleteCommunityCommentAttachments(attachments = []) {
  if (!storage) return
  await Promise.allSettled((Array.isArray(attachments) ? attachments : [])
    .map((attachment) => String(attachment?.path || '').trim())
    .filter((path) => path.startsWith('community/comments/'))
    .map((path) => deleteObject(ref(storage, path))))
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

export async function toggleCommunityCommentDislike(payload = {}) {
  const callable = httpsCallable(functions, 'toggleCommunityCommentDislike')
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

export async function setCommunityStoryReaction(storyId = '', reaction = '') {
  const callable = httpsCallable(functions, 'setCommunityStoryReaction')
  const result = await callable({ storyId, reaction })
  return result?.data || { ok: false }
}

export async function createCommunity(payload = {}) {
  const callable = httpsCallable(functions, 'createCommunity')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function getCommunityMembership(communityId = '') {
  const callable = httpsCallable(functions, 'getCommunityMembership')
  const result = await callable({ communityId })
  return result?.data || { ok: false, membership: null }
}

export async function joinCommunity(communityId = '') {
  const callable = httpsCallable(functions, 'joinCommunity')
  const result = await callable({ communityId })
  return result?.data || { ok: false }
}

export async function leaveCommunity(communityId = '') {
  const callable = httpsCallable(functions, 'leaveCommunity')
  const result = await callable({ communityId })
  return result?.data || { ok: false }
}

export async function toggleCommunityFocus(communityId = '', focused = null) {
  const callable = httpsCallable(functions, 'toggleCommunityFocus')
  const payload = { communityId }
  if (typeof focused === 'boolean') payload.focused = focused
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function toggleCommunityPostLike(postId = '', active = null) {
  const callable = httpsCallable(functions, 'toggleCommunityPostLike')
  const payload = { postId }
  if (typeof active === 'boolean') payload.active = active
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function toggleCommunityPostDislike(postId = '', active = null) {
  const callable = httpsCallable(functions, 'toggleCommunityPostDislike')
  const payload = { postId }
  if (typeof active === 'boolean') payload.active = active
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function toggleCommunityPostSave(postId = '', active = null) {
  const callable = httpsCallable(functions, 'toggleCommunityPostSave')
  const payload = { postId }
  if (typeof active === 'boolean') payload.active = active
  const result = await callable(payload)
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

export async function updateCommunityPost(payload = {}) {
  const callable = httpsCallable(functions, 'updateCommunityPost')
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

export async function updateCommunity(communityId = '', payload = {}) {
  return moderateCommunity({ ...payload, communityId, action: 'update' })
}

export async function hideCommunity(communityId = '', reason = '') {
  return moderateCommunity({ communityId, action: 'hide', reason })
}

export async function restoreCommunity(communityId = '', reason = '') {
  return moderateCommunity({ communityId, action: 'restore', reason })
}

export async function archiveCommunity(communityId = '', reason = '') {
  return moderateCommunity({ communityId, action: 'archive', reason })
}

export async function deleteCommunity(communityId = '', reason = '') {
  return moderateCommunity({ communityId, action: 'delete', reason })
}
