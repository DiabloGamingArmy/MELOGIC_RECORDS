import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { db } from '../firebase/firestore'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'

export const MUSIC_RELEASE_TYPES = ['single', 'ep', 'album', 'demo', 'beat_tape', 'live_session', 'remix']
export const MUSIC_STATUSES = ['draft', 'submitted', 'approved', 'published', 'rejected']
export const MUSIC_VISIBILITIES = ['public', 'unlisted', 'private']

export const MUSIC_RELEASE_MODEL = {
  title: 'string',
  slug: 'string',
  artistUid: 'string',
  artistName: 'string',
  releaseType: 'single | ep | album | demo | beat_tape | live_session | remix',
  genre: 'string',
  subgenre: 'string',
  moods: 'string[]',
  tags: 'string[]',
  coverArtPath: 'string',
  coverArtURL: 'string',
  status: 'draft | submitted | approved | published | rejected',
  visibility: 'public | unlisted | private',
  releaseDate: 'Timestamp | Date | ISO string',
  createdAt: 'Timestamp | Date | ISO string',
  updatedAt: 'Timestamp | Date | ISO string',
  explicit: 'boolean',
  copyrightLine: 'string',
  publisherLine: 'string',
  credits: 'string | object | array',
  upc: 'string',
  source: 'artist_submission | internal',
  sourceDistributor: 'string',
  externalLinks: 'object',
  playbackType: 'internal_audio | spotify_embed | external_link',
  externalPlaybackURL: 'string',
  trackIds: 'string[]',
  likeCount: 'number',
  playCount: 'number'
}

export const MUSIC_TRACK_MODEL = {
  releaseId: 'string',
  artistUid: 'string',
  artistName: 'string',
  title: 'string',
  slug: 'string',
  trackNumber: 'number',
  discNumber: 'number',
  duration: 'number',
  isrc: 'string',
  streamAudioPath: 'string',
  streamAudioURL: 'string',
  externalLinks: 'object',
  playbackType: 'internal_audio | spotify_embed | external_link',
  externalPlaybackURL: 'string',
  masterAudioPath: 'string optional/private',
  waveformPath: 'string optional',
  explicit: 'boolean',
  status: 'draft | submitted | approved | published | rejected',
  visibility: 'public | unlisted | private',
  createdAt: 'Timestamp | Date | ISO string',
  updatedAt: 'Timestamp | Date | ISO string',
  playCount: 'number',
  likeCount: 'number'
}

function toIsoDate(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.max(0, number) : fallback
}

function normalizeExternalLinks(raw = {}) {
  const links = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  return {
    spotify: String(links.spotify || ''),
    appleMusic: String(links.appleMusic || ''),
    hyperFollow: String(links.hyperFollow || ''),
    distributor: String(links.distributor || '')
  }
}

function normalizeSlug(value = '') {
  return String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
}

function cleanMusicReleaseId(value = '') {
  const raw = decodeURIComponent(String(value || '').trim())
  const compoundId = raw.includes('--') ? raw.split('--').pop() : raw
  return compoundId.replace(/^\/+|\/+$/g, '')
}

function isPublicPublished(item = {}) {
  return item.status === 'published' && item.visibility === 'public'
}

export function normalizeMusicRelease(dataOrSnap = {}, explicitId = '') {
  const raw = typeof dataOrSnap.data === 'function' ? dataOrSnap.data() || {} : dataOrSnap || {}
  const id = explicitId || dataOrSnap.id || raw.releaseId || ''
  const title = String(raw.title || 'Untitled release').trim()
  const releaseType = MUSIC_RELEASE_TYPES.includes(raw.releaseType) ? raw.releaseType : 'single'
  const status = MUSIC_STATUSES.includes(raw.status) ? raw.status : 'draft'
  const visibility = MUSIC_VISIBILITIES.includes(raw.visibility) ? raw.visibility : 'private'
  return {
    id,
    releaseId: id,
    title,
    slug: String(raw.slug || normalizeSlug(title || id)),
    artistUid: String(raw.artistUid || raw.artistId || raw.uid || ''),
    artistName: String(raw.artistName || raw.creatorName || 'Melogic Creator'),
    releaseType,
    genre: String(raw.genre || ''),
    subgenre: String(raw.subgenre || ''),
    moods: toStringArray(raw.moods),
    tags: toStringArray(raw.tags),
    coverArtPath: String(raw.coverArtPath || raw.coverPath || ''),
    coverArtURL: String(raw.coverArtURL || raw.coverArtUrl || raw.coverURL || raw.coverUrl || ''),
    featured: raw.featured === true,
    featuredRank: toNumber(raw.featuredRank, 999),
    featuredAt: toIsoDate(raw.featuredAt),
    streamAudioURL: String(raw.streamAudioURL || raw.previewStreamAudioURL || raw.previewAudioURL || ''),
    status,
    visibility,
    releaseDate: toIsoDate(raw.releaseDate || raw.releasedAt || raw.publishedAt),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    explicit: raw.explicit === true,
    copyrightLine: String(raw.copyrightLine || ''),
    publisherLine: String(raw.publisherLine || ''),
    credits: raw.credits || '',
    upc: String(raw.upc || ''),
    source: String(raw.source || ''),
    sourceDistributor: String(raw.sourceDistributor || ''),
    sourceDistributorLabel: String(raw.sourceDistributorLabel || ''),
    externalLinks: normalizeExternalLinks(raw.externalLinks),
    playbackType: String(raw.playbackType || (raw.streamAudioURL ? 'internal_audio' : 'external_link')),
    externalPlaybackURL: String(raw.externalPlaybackURL || raw.externalLinks?.spotify || ''),
    trackIds: toStringArray(raw.trackIds),
    likeCount: toNumber(raw.likeCount ?? raw.counts?.likes),
    playCount: toNumber(raw.playCount ?? raw.counts?.plays)
  }
}

export function normalizeMusicArtist(dataOrSnap = {}, explicitId = '') {
  const raw = typeof dataOrSnap.data === 'function' ? dataOrSnap.data() || {} : dataOrSnap || {}
  const id = explicitId || dataOrSnap.id || raw.uid || raw.artistUid || ''
  const artistName = String(raw.artistName || raw.displayName || raw.name || raw.username || 'Melogic Artist')
  return {
    id,
    uid: id,
    artistName,
    displayName: artistName,
    username: String(raw.username || raw.usernameLower || ''),
    photoURL: String(raw.photoURL || raw.avatarURL || raw.imageURL || ''),
    avatarURL: String(raw.avatarURL || raw.photoURL || raw.imageURL || ''),
    roleLabel: String(raw.roleLabel || raw.role || 'Artist'),
    musicGenre: String(raw.musicGenre || raw.genre || ''),
    followerCount: toNumber(raw.followerCount ?? raw.stats?.followers),
    listenerCount: toNumber(raw.listenerCount ?? raw.stats?.listeners),
    featuredMusicArtist: raw.featuredMusicArtist === true,
    featuredMusicRank: toNumber(raw.featuredMusicRank, 999)
  }
}

export function normalizeMusicTrack(dataOrSnap = {}, explicitId = '') {
  const raw = typeof dataOrSnap.data === 'function' ? dataOrSnap.data() || {} : dataOrSnap || {}
  const id = explicitId || dataOrSnap.id || raw.trackId || ''
  const title = String(raw.title || 'Untitled track').trim()
  const status = MUSIC_STATUSES.includes(raw.status) ? raw.status : 'draft'
  const visibility = MUSIC_VISIBILITIES.includes(raw.visibility) ? raw.visibility : 'private'
  return {
    id,
    trackId: id,
    releaseId: String(raw.releaseId || ''),
    artistUid: String(raw.artistUid || raw.artistId || raw.uid || ''),
    artistName: String(raw.artistName || raw.creatorName || 'Melogic Creator'),
    title,
    slug: String(raw.slug || normalizeSlug(title || id)),
    trackNumber: Math.max(1, Number.parseInt(raw.trackNumber || 1, 10) || 1),
    discNumber: Math.max(1, Number.parseInt(raw.discNumber || 1, 10) || 1),
    duration: toNumber(raw.duration),
    isrc: String(raw.isrc || ''),
    streamAudioPath: String(raw.streamAudioPath || ''),
    streamAudioURL: String(raw.streamAudioURL || raw.streamAudioUrl || ''),
    masterAudioPath: String(raw.masterAudioPath || ''),
    waveformPath: String(raw.waveformPath || ''),
    externalLinks: normalizeExternalLinks(raw.externalLinks),
    playbackType: String(raw.playbackType || (raw.streamAudioURL ? 'internal_audio' : 'external_link')),
    externalPlaybackURL: String(raw.externalPlaybackURL || raw.externalLinks?.spotify || ''),
    explicit: raw.explicit === true,
    status,
    visibility,
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    playCount: toNumber(raw.playCount ?? raw.counts?.plays),
    likeCount: toNumber(raw.likeCount ?? raw.counts?.likes)
  }
}

function sortReleasesClientSide(releases = [], sort = 'newest') {
  const byReleaseDate = (item) => new Date(item.releaseDate || item.createdAt || 0).getTime() || 0
  if (sort === 'popular') return [...releases].sort((a, b) => (b.playCount + b.likeCount) - (a.playCount + a.likeCount))
  if (sort === 'oldest') return [...releases].sort((a, b) => byReleaseDate(a) - byReleaseDate(b))
  return [...releases].sort((a, b) => byReleaseDate(b) - byReleaseDate(a))
}

export async function listPublishedMusicReleases({ limitCount = 24, genre = '', sort = 'newest' } = {}) {
  if (!db) return []
  const constraints = [
    where('status', '==', 'published'),
    where('visibility', '==', 'public')
  ]
  if (genre) constraints.push(where('genre', '==', genre))
  if (sort === 'popular') {
    constraints.push(orderBy('playCount', 'desc'))
  } else {
    constraints.push(orderBy('releaseDate', sort === 'oldest' ? 'asc' : 'desc'))
  }
  constraints.push(limit(Math.max(1, Math.min(50, Number(limitCount) || 24))))

  try {
    const snapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.musicReleases), ...constraints))
    return sortReleasesClientSide(snapshot.docs.map((docSnap) => normalizeMusicRelease(docSnap)), sort)
  } catch (error) {
    console.warn('[musicService] Published music releases could not be loaded.', error?.message || error)
    return []
  }
}

export async function listFeaturedMusicReleases(limitCount = 16) {
  if (!db) return []
  const cappedLimit = Math.max(1, Math.min(20, Number(limitCount) || 16))
  try {
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.musicReleases),
      where('status', '==', 'published'),
      where('visibility', '==', 'public'),
      where('featured', '==', true),
      orderBy('featuredRank', 'asc'),
      limit(cappedLimit)
    ))
    return snapshot.docs.map((docSnap) => normalizeMusicRelease(docSnap))
  } catch (error) {
    console.warn('[musicService] Featured music releases could not be loaded.', error?.message || error)
    return listPublishedMusicReleases({ limitCount: cappedLimit, sort: 'popular' })
  }
}

export async function listNewMusicReleases(limitCount = 16) {
  return listPublishedMusicReleases({ limitCount, sort: 'newest' })
}

export async function listFeaturedArtists(limitCount = 12) {
  if (!db) return []
  const cappedLimit = Math.max(1, Math.min(20, Number(limitCount) || 12))
  try {
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.profiles),
      where('featuredMusicArtist', '==', true),
      orderBy('featuredMusicRank', 'asc'),
      limit(cappedLimit)
    ))
    return snapshot.docs.map((docSnap) => normalizeMusicArtist(docSnap))
  } catch (error) {
    console.warn('[musicService] Featured music artists could not be loaded.', error?.message || error)
    return []
  }
}

export async function listRecentlyPlayed(uid = '', limitCount = 12) {
  if (!db || !uid) return []
  const cappedLimit = Math.max(1, Math.min(20, Number(limitCount) || 12))
  try {
    const snapshot = await getDocs(query(
      collection(db, 'users', uid, 'recentlyPlayedMusic'),
      orderBy('playedAt', 'desc'),
      limit(cappedLimit)
    ))
    return snapshot.docs.map((docSnap) => {
      const raw = docSnap.data() || {}
      return raw.release ? normalizeMusicRelease(raw.release, raw.releaseId || docSnap.id) : normalizeMusicRelease(raw, raw.releaseId || docSnap.id)
    })
  } catch (error) {
    console.warn('[musicService] Recently played music could not be loaded.', error?.message || error)
    return []
  }
}

export async function listUserLibraryMusic(uid = '', type = 'recently-added', limitCount = 20) {
  if (!db || !uid) return []
  const cappedLimit = Math.max(1, Math.min(30, Number(limitCount) || 20))
  const collectionName = type === 'artists' ? 'savedMusicArtists' : type === 'songs' ? 'savedMusicTracks' : 'savedMusicReleases'
  try {
    const snapshot = await getDocs(query(
      collection(db, 'users', uid, collectionName),
      orderBy('createdAt', 'desc'),
      limit(cappedLimit)
    ))
    if (type === 'artists') return snapshot.docs.map((docSnap) => normalizeMusicArtist(docSnap))
    if (type === 'songs') return snapshot.docs.map((docSnap) => normalizeMusicTrack(docSnap))
    return snapshot.docs.map((docSnap) => {
      const raw = docSnap.data() || {}
      return raw.release ? normalizeMusicRelease(raw.release, raw.releaseId || docSnap.id) : normalizeMusicRelease(raw, raw.releaseId || docSnap.id)
    })
  } catch (error) {
    console.warn('[musicService] User music library could not be loaded.', error?.message || error)
    return []
  }
}

export async function searchMusic(searchText = '', limitCount = 16) {
  if (!db) return []
  const token = String(searchText || '').trim().toLowerCase().split(/\s+/).find((item) => item.length > 1)
  if (!token) return []
  const cappedLimit = Math.max(1, Math.min(20, Number(limitCount) || 16))
  try {
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.musicReleases),
      where('status', '==', 'published'),
      where('visibility', '==', 'public'),
      where('searchKeywords', 'array-contains', token),
      limit(cappedLimit)
    ))
    return snapshot.docs.map((docSnap) => normalizeMusicRelease(docSnap))
  } catch (error) {
    console.warn('[musicService] Music search could not be loaded.', error?.message || error)
    return []
  }
}

export async function getMusicRelease(releaseIdOrSlug = '') {
  if (!db) return null
  const identifier = cleanMusicReleaseId(releaseIdOrSlug)
  if (!identifier) return null

  try {
    const snap = await getDoc(doc(db, FIRESTORE_COLLECTIONS.musicReleases, identifier))
    if (snap.exists()) {
      const release = normalizeMusicRelease(snap)
      return isPublicPublished(release) ? release : null
    }
  } catch (error) {
    console.warn('[musicService] Music release lookup by id failed.', error?.message || error)
  }

  try {
    const slug = normalizeSlug(releaseIdOrSlug)
    if (!slug) return null
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.musicReleases),
      where('slug', '==', slug),
      where('status', '==', 'published'),
      where('visibility', '==', 'public'),
      limit(1)
    ))
    const found = snapshot.docs[0]
    return found ? normalizeMusicRelease(found) : null
  } catch (error) {
    console.warn('[musicService] Music release lookup by slug failed.', error?.message || error)
    return null
  }
}

export async function listTracksForRelease(releaseId = '') {
  if (!db || !releaseId) return []
  try {
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.musicTracks),
      where('releaseId', '==', releaseId),
      where('status', '==', 'published'),
      where('visibility', '==', 'public'),
      orderBy('discNumber', 'asc'),
      orderBy('trackNumber', 'asc'),
      limit(100)
    ))
    return snapshot.docs.map((docSnap) => normalizeMusicTrack(docSnap))
  } catch (error) {
    console.warn('[musicService] Music tracks could not be loaded.', error?.message || error)
    return []
  }
}
