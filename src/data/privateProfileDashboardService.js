import {
  collection,
  getCountFromServer,
  getDocs,
  limit,
  query,
  where
} from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { listUserLibraryItems, listUserOrders } from './accountCommerceService'
import { normalizeCommunity, normalizeCommunityPost } from './communityService'
import { normalizeProduct } from './productService'
import { loadPublicProfileStats } from './profileService'
import { listAccountEvents } from '../services/accountEvents'

const RECENT_LIMIT = 8

function toMillis(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function sortByActivity(rows = []) {
  return [...rows].sort((a, b) => (
    toMillis(b.updatedAt || b.lastOpenedAt || b.createdAt || b.acquiredAt)
    - toMillis(a.updatedAt || a.lastOpenedAt || a.createdAt || a.acquiredAt)
  ))
}

async function countQuery(reference) {
  const snapshot = await getCountFromServer(reference)
  return Math.max(0, Number(snapshot.data().count || 0))
}

async function loadProducts(uid) {
  const ownedQuery = query(collection(db, 'products'), where('artistId', '==', uid))
  const [countResult, recentResult] = await Promise.allSettled([
    getCountFromServer(ownedQuery),
    getDocs(query(ownedQuery, limit(RECENT_LIMIT * 3)))
  ])
  const products = sortByActivity((recentResult.status === 'fulfilled' ? recentResult.value.docs : []).map((entry) => (
    normalizeProduct(entry.id, entry.data() || {})
  ))).slice(0, RECENT_LIMIT)
  return {
    count: countResult.status === 'fulfilled'
      ? Math.max(0, Number(countResult.value.data().count || 0))
      : 0,
    recent: products,
    failedFields: [
      ...(countResult.status === 'rejected' ? ['products'] : []),
      ...(recentResult.status === 'rejected' ? ['recentProducts'] : [])
    ]
  }
}

async function loadCommunityPosts(uid) {
  const postsQuery = query(
    collection(db, 'communityPosts'),
    where('authorUid', '==', uid),
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  )
  const recentResult = await Promise.allSettled([
    getDocs(query(postsQuery, limit(RECENT_LIMIT * 2)))
  ]).then(([result]) => result)
  const posts = sortByActivity((recentResult.status === 'fulfilled' ? recentResult.value.docs : [])
    .map((entry) => normalizeCommunityPost(entry)))
    .slice(0, RECENT_LIMIT)
  return {
    recent: posts,
    failedFields: [
      ...(recentResult.status === 'rejected' ? ['recentCommunityPosts'] : [])
    ]
  }
}

async function loadFocusedCommunities(uid) {
  const focusedQuery = query(collection(db, 'users', uid, 'focusedCommunities'))
  const [countSnapshot, recentSnapshot] = await Promise.all([
    getCountFromServer(focusedQuery),
    getDocs(query(focusedQuery, limit(RECENT_LIMIT)))
  ])
  const rows = recentSnapshot.docs.map((entry) => {
    const data = entry.data() || {}
    return {
      id: entry.id,
      communityId: String(data.communityId || entry.id),
      name: String(data.name || data.title || data.slug || 'Community'),
      slug: String(data.slug || data.communityId || entry.id),
      path: String(data.path || '')
    }
  })
  return {
    count: Math.max(0, Number(countSnapshot.data().count || 0)),
    recent: rows
  }
}

async function loadManagedCommunities(uid) {
  const communities = collection(db, 'communities')
  const [ownedSnapshot, moderatedSnapshot] = await Promise.all([
    getDocs(query(
      communities,
      where('ownerUid', '==', uid),
      where('status', '==', 'active'),
      where('visibility', '==', 'public'),
      limit(RECENT_LIMIT * 2)
    )),
    getDocs(query(
      communities,
      where('moderatorIds', 'array-contains', uid),
      where('status', '==', 'active'),
      where('visibility', '==', 'public'),
      limit(RECENT_LIMIT * 2)
    ))
  ])
  const byId = new Map()
  ;[...ownedSnapshot.docs, ...moderatedSnapshot.docs].forEach((entry) => {
    byId.set(entry.id, normalizeCommunity(entry))
  })
  return [...byId.values()].slice(0, RECENT_LIMIT)
}

async function loadProjects(uid) {
  const studioOwned = query(collection(db, 'studioProjects'), where('ownerId', '==', uid))
  const stageOwned = query(collection(db, 'stageProjects'), where('ownerId', '==', uid))
  const [studioCount, stageCount, studioRecent, stageRecent] = await Promise.all([
    countQuery(studioOwned),
    countQuery(stageOwned),
    getDocs(query(studioOwned, limit(RECENT_LIMIT))),
    getDocs(query(stageOwned, limit(RECENT_LIMIT)))
  ])
  return {
    studioCount,
    stageCount,
    recentStudio: sortByActivity(studioRecent.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) }))),
    recentStage: sortByActivity(stageRecent.docs.map((entry) => ({ id: entry.id, ...(entry.data() || {}) })))
  }
}

async function loadSocialStats(uid) {
  const result = await loadPublicProfileStats(uid)
  return {
    followers: Math.max(0, Number(result?.stats?.followers || 0)),
    following: Math.max(0, Number(result?.stats?.following || 0)),
    communityPosts: Math.max(0, Number(result?.stats?.posts || 0)),
    downloads: Math.max(0, Number(result?.stats?.downloads || 0)),
    failedFields: Array.isArray(result?.failedStatQueries)
      ? result.failedStatQueries.map((key) => `public:${key}`)
      : []
  }
}

async function loadLibraryCount(uid) {
  const [libraryResult, entitlementResult] = await Promise.allSettled([
    countQuery(query(collection(db, 'users', uid, 'libraryItems'))),
    countQuery(query(collection(db, 'users', uid, 'entitlements')))
  ])
  const libraryCount = libraryResult.status === 'fulfilled' ? libraryResult.value : 0
  const entitlementCount = entitlementResult.status === 'fulfilled' ? entitlementResult.value : 0
  return libraryCount || entitlementCount
}

async function loadOrderCount(uid) {
  const [nestedResult, topLevelResult] = await Promise.allSettled([
    countQuery(query(collection(db, 'users', uid, 'orders'))),
    countQuery(query(collection(db, 'orders'), where('uid', '==', uid)))
  ])
  const nestedCount = nestedResult.status === 'fulfilled' ? nestedResult.value : 0
  const topLevelCount = topLevelResult.status === 'fulfilled' ? topLevelResult.value : 0
  return nestedCount || topLevelCount
}

export async function loadPrivateProfileDashboard(uid = '') {
  const userId = String(uid || '').trim()
  if (!db || !userId || userId.includes('/')) throw new Error('A signed-in account is required.')

  const loaders = {
    products: () => loadProducts(userId),
    savedItems: () => countQuery(query(collection(db, 'users', userId, 'savedProducts'))),
    libraryItems: () => listUserLibraryItems(userId, { limitCount: RECENT_LIMIT }),
    libraryCount: () => loadLibraryCount(userId),
    orders: () => listUserOrders(userId, { limitCount: RECENT_LIMIT }),
    orderCount: () => loadOrderCount(userId),
    communityPosts: () => loadCommunityPosts(userId),
    focusedCommunities: () => loadFocusedCommunities(userId),
    managedCommunities: () => loadManagedCommunities(userId),
    projects: () => loadProjects(userId),
    social: () => loadSocialStats(userId),
    activity: () => listAccountEvents(userId, { limitCount: 12 })
  }

  const entries = Object.entries(loaders)
  const results = await Promise.allSettled(entries.map(([, loader]) => loader()))
  const data = {}
  const failedStats = []
  const dataSources = {}

  results.forEach((result, index) => {
    const key = entries[index][0]
    if (result.status === 'fulfilled') {
      data[key] = result.value
      dataSources[key] = 'firestore'
    } else {
      failedStats.push(key)
      dataSources[key] = String(result.reason?.code || result.reason?.message || 'unavailable')
    }
  })

  const products = data.products || { count: 0, recent: [], failedFields: [] }
  const posts = data.communityPosts || { recent: [], failedFields: [] }
  const projects = data.projects || { studioCount: 0, stageCount: 0, recentStudio: [], recentStage: [] }
  const social = data.social || { followers: 0, following: 0, communityPosts: 0, downloads: 0, failedFields: [] }
  const libraryItems = Array.isArray(data.libraryItems) ? data.libraryItems : []
  const orders = Array.isArray(data.orders) ? data.orders : []
  const focused = data.focusedCommunities || { count: 0, recent: [] }

  return {
    stats: {
      products: products.count,
      savedItems: Math.max(0, Number(data.savedItems || 0)),
      comments: 0,
      commentsAvailable: false,
      likesReceived: 0,
      likesReceivedAvailable: false,
      downloads: social.downloads,
      studioProjects: projects.studioCount,
      stagePlans: projects.stageCount,
      communityPosts: social.communityPosts,
      communities: focused.count,
      managedCommunities: Array.isArray(data.managedCommunities) ? data.managedCommunities.length : 0,
      orders: Math.max(0, Number(data.orderCount || 0)),
      libraryItems: Math.max(0, Number(data.libraryCount || 0)),
      followers: social.followers,
      following: social.following
    },
    recentActivity: Array.isArray(data.activity) ? data.activity : [],
    libraryItems: libraryItems.slice(0, RECENT_LIMIT),
    orders: orders.slice(0, RECENT_LIMIT),
    communities: focused.recent,
    managedCommunities: Array.isArray(data.managedCommunities) ? data.managedCommunities : [],
    products: products.recent,
    communityPosts: posts.recent,
    studioProjects: projects.recentStudio,
    stagePlans: projects.recentStage,
    failedStats: [...new Set([
      ...failedStats,
      ...(products.failedFields || []),
      ...(posts.failedFields || []),
      ...(social.failedFields || [])
    ])],
    unavailableStats: ['comments', 'likesReceived'],
    dataSources
  }
}
