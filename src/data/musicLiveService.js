import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'

const LIVE_CATEGORIES = ['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other']

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

export function normalizeMusicLiveStream(dataOrSnap = {}, explicitId = '') {
  const raw = typeof dataOrSnap.data === 'function' ? dataOrSnap.data() || {} : dataOrSnap || {}
  const id = explicitId || dataOrSnap.id || raw.streamId || ''
  const category = LIVE_CATEGORIES.includes(raw.category) ? raw.category : 'music'
  return {
    id,
    streamId: id,
    hostUid: String(raw.hostUid || ''),
    hostDisplayName: String(raw.hostDisplayName || 'Melogic Creator'),
    hostPhotoURL: String(raw.hostPhotoURL || ''),
    title: String(raw.title || 'Untitled live stream'),
    description: String(raw.description || ''),
    category,
    tags: toStringArray(raw.tags),
    coverArtPath: String(raw.coverArtPath || ''),
    coverArtURL: String(raw.coverArtURL || raw.coverURL || ''),
    status: String(raw.status || 'draft'),
    visibility: String(raw.visibility || 'private'),
    audioOnly: raw.audioOnly !== false,
    videoEnabled: raw.videoEnabled === true,
    hostConnected: raw.hostConnected === true,
    audioPublished: raw.audioPublished === true,
    connectionStatus: String(raw.connectionStatus || raw.status || ''),
    roomName: String(raw.roomName || raw.livekitRoomName || ''),
    livekitRoomName: String(raw.livekitRoomName || raw.roomName || ''),
    livekitRoomSid: String(raw.livekitRoomSid || ''),
    startedAt: toIsoDate(raw.startedAt),
    endedAt: toIsoDate(raw.endedAt),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    listenerCount: toNumber(raw.listenerCount),
    peakListenerCount: toNumber(raw.peakListenerCount),
    isRecordable: raw.isRecordable === true,
    archiveRequested: raw.archiveRequested === true,
    archiveStatus: String(raw.archiveStatus || 'none'),
    archiveTrackPath: String(raw.archiveTrackPath || ''),
    archiveTrackURL: String(raw.archiveTrackURL || ''),
    moderationStatus: String(raw.moderationStatus || 'clear'),
    reportCount: toNumber(raw.reportCount)
  }
}

export async function listPublicLiveStreams({ category = '', limitCount = 20 } = {}) {
  if (!db) return []
  const constraints = [
    where('status', '==', 'live'),
    where('visibility', '==', 'public')
  ]
  if (category && LIVE_CATEGORIES.includes(category)) constraints.push(where('category', '==', category))
  constraints.push(orderBy('startedAt', 'desc'), limit(Math.max(1, Math.min(30, Number(limitCount) || 20))))

  try {
    const snapshot = await getDocs(query(collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams), ...constraints))
    return snapshot.docs
      .map((docSnap) => normalizeMusicLiveStream(docSnap))
      .filter((stream) => stream.audioOnly !== false && stream.audioPublished === true && !['removed', 'blocked'].includes(stream.moderationStatus))
  } catch (error) {
    console.warn('[musicLiveService] Public live streams could not be loaded.', error?.message || error)
    return []
  }
}

export async function getMusicLiveStream(streamId = '') {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return null
  try {
    const snapshot = await getDoc(doc(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id))
    return snapshot.exists() ? normalizeMusicLiveStream(snapshot) : null
  } catch (error) {
    console.warn('[musicLiveService] Live stream could not be loaded.', error?.message || error)
    return null
  }
}

export async function startMusicLiveStream(payload = {}) {
  const callable = httpsCallable(functions, 'startMusicLiveStream')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function markMusicLiveStreamOnAir(streamId = '') {
  const callable = httpsCallable(functions, 'markMusicLiveStreamOnAir')
  const result = await callable({ streamId })
  return result?.data || { ok: false }
}

export async function joinMusicLiveStream(streamId = '') {
  const callable = httpsCallable(functions, 'joinMusicLiveStream')
  const result = await callable({ streamId })
  return result?.data || { ok: false }
}

export async function endMusicLiveStream(streamId = '') {
  const callable = httpsCallable(functions, 'endMusicLiveStream')
  const result = await callable({ streamId })
  return result?.data || { ok: false }
}
