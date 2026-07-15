import { collection, doc, getDoc, getDocs, limit, onSnapshot, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'
import { FIRESTORE_COLLECTIONS } from '../config/firestoreCollections'
import { normalizeProviderId, STREAM_PROVIDERS } from './streaming/streamingProviderTypes'

const LIVE_CATEGORIES = ['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other']
const LIVE_HEARTBEAT_STALE_MS = 90 * 1000

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
  const provider = normalizeProviderId(raw.provider)
  const hlsIngestMethod = raw.ingestMethod
    || (raw.ingestMode === 'browser-webrtc' ? 'browserWebrtc' : raw.ingestMode === 'rtmp-obs' ? 'obsRtmp' : '')
    || (raw.provider === STREAM_PROVIDERS.bufferedBroadcast ? 'obsRtmp' : 'browserWebrtc')
  const providerDefaults = provider === STREAM_PROVIDERS.hlsEdge
    ? { label: 'Melogic Edge', ingestMode: hlsIngestMethod === 'browserWebrtc' ? 'browser-webrtc' : 'rtmp-obs', playbackMode: 'hls', transportProvider: 'hls-edge' }
    : provider === STREAM_PROVIDERS.nativeWeb
      ? { label: 'Website Live', ingestMode: 'browser-webrtc', playbackMode: 'webrtc', transportProvider: 'livekit' }
      : { label: 'Firebase Segments', ingestMode: 'browser-media-recorder', playbackMode: 'firebaseSegments', transportProvider: 'firebase' }
  return {
    id,
    streamId: id,
    hostUid: String(raw.hostUid || ''),
    hostDisplayName: String(raw.hostDisplayName || 'Melogic Creator'),
    hostUsername: String(raw.hostUsername || raw.hostHandle || ''),
    hostPhotoURL: String(raw.hostPhotoURL || raw.hostAvatarURL || ''),
    hostAvatarURL: String(raw.hostAvatarURL || raw.hostPhotoURL || ''),
    title: String(raw.title || 'Untitled live stream'),
    description: String(raw.description || ''),
    category,
    tags: toStringArray(raw.tags),
    coverArtPath: String(raw.coverArtPath || raw.coverStoragePath || ''),
    coverStoragePath: String(raw.coverStoragePath || raw.coverArtPath || ''),
    coverArtURL: String(raw.coverArtURL || raw.coverImageURL || raw.coverURL || ''),
    coverImageURL: String(raw.coverImageURL || raw.coverArtURL || raw.coverURL || ''),
    coverArtSource: String(raw.coverArtSource || (raw.coverArtURL ? 'url' : 'fallback')),
    status: String(raw.status || 'draft'),
    isLive: raw.isLive === true || raw.status === 'live',
    visibility: String(raw.visibility || 'private'),
    accessMode: String(raw.accessMode || raw.visibility || 'private'),
    passwordProtected: raw.passwordProtected === true || raw.accessMode === 'password',
    audioMode: String(raw.audioMode || 'music'),
    selectedInputSource: raw.selectedInputSource === 'sequence' ? 'sequence' : 'browser',
    selectedSequenceId: String(raw.selectedSequenceId || ''),
    audioProfile: String(raw.audioProfile || ''),
    audioOnly: raw.audioOnly !== false,
    provider,
    providerLabel: String(raw.providerLabel || providerDefaults.label),
    transportProvider: String(raw.transportProvider || providerDefaults.transportProvider),
    ingestMode: String(raw.ingestMode || providerDefaults.ingestMode),
    playbackMode: String(raw.playbackMode || providerDefaults.playbackMode),
    latencyProfile: String(raw.latencyProfile || (provider === STREAM_PROVIDERS.hlsEdge ? 'buffered' : 'realtime')),
    ingestMethod: String(provider === STREAM_PROVIDERS.hlsEdge ? hlsIngestMethod : raw.ingestMethod || ''),
    ingestProtocol: String(raw.ingestProtocol || (hlsIngestMethod === 'browserWebrtc' ? 'webrtc' : hlsIngestMethod === 'obsRtmp' ? 'rtmp' : '')),
    streamKey: String(raw.streamKey || ''),
    hlsPlaybackUrl: String(raw.hlsPlaybackUrl || ''),
    rtmpIngestServer: String(raw.rtmpIngestServer || ''),
    audioOnlyHlsUrl: String(raw.audioOnlyHlsUrl || ''),
    nativeStreaming: raw.nativeStreaming && typeof raw.nativeStreaming === 'object' ? raw.nativeStreaming : {},
    antMediaStreamId: String(raw.antMediaStreamId || ''),
    antMediaAppName: String(raw.antMediaAppName || ''),
    antMediaBaseUrl: String(raw.antMediaBaseUrl || raw.publicPlaybackBaseUrl || ''),
    hlsUrl: String(raw.hlsUrl || ''),
    llhlsUrl: String(raw.llhlsUrl || ''),
    webRtcPlaybackUrl: String(raw.webRtcPlaybackUrl || ''),
    videoEnabled: raw.videoEnabled === true,
    audioEnabled: raw.audioEnabled !== false,
    hostConnected: raw.hostConnected === true,
    hostActive: raw.hostActive === true,
    hostSessionId: String(raw.hostSessionId || ''),
    audioPublished: raw.audioPublished === true,
    videoPublished: raw.videoPublished === true,
    programHasAudio: raw.programHasAudio === true,
    programHasVideo: raw.programHasVideo === true,
    activeVideoSource: String(raw.activeVideoSource || ''),
    activeAudioSources: raw.activeAudioSources && typeof raw.activeAudioSources === 'object'
      ? {
          browser: raw.activeAudioSources.browser !== false,
          sequence: raw.activeAudioSources.sequence === true
        }
      : {
          browser: raw.selectedInputSource !== 'sequence',
          sequence: raw.selectedInputSource === 'sequence'
        },
    programState: raw.programState && typeof raw.programState === 'object' ? raw.programState : {},
    providerDiagnostics: raw.providerDiagnostics && typeof raw.providerDiagnostics === 'object' ? raw.providerDiagnostics : {},
    connectionStatus: String(raw.connectionStatus || raw.status || ''),
    roomName: String(raw.roomName || raw.livekitRoomName || ''),
    livekitRoomName: String(raw.livekitRoomName || raw.roomName || ''),
    livekitRoomSid: String(raw.livekitRoomSid || ''),
    startedAt: toIsoDate(raw.startedAt),
    endedAt: toIsoDate(raw.endedAt),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    lastHostHeartbeatAt: toIsoDate(raw.lastHostHeartbeatAt),
    lastMetadataUpdateAt: toIsoDate(raw.lastMetadataUpdateAt),
    listenerCount: toNumber(raw.listenerCount),
    peakListenerCount: toNumber(raw.peakListenerCount),
    likeCount: toNumber(raw.likeCount),
    dislikeCount: toNumber(raw.dislikeCount),
    saveCount: toNumber(raw.saveCount),
    currentNowPlaying: raw.currentNowPlaying && typeof raw.currentNowPlaying === 'object'
      ? {
          title: String(raw.currentNowPlaying.title || ''),
          artist: String(raw.currentNowPlaying.artist || ''),
          album: String(raw.currentNowPlaying.album || ''),
          artworkURL: String(raw.currentNowPlaying.artworkURL || ''),
          sequenceItemId: String(raw.currentNowPlaying.sequenceItemId || ''),
          sourceType: String(raw.currentNowPlaying.sourceType || (raw.currentNowPlaying.sequenceItemId ? 'sequenceItem' : 'manual')),
          sourceId: String(raw.currentNowPlaying.sourceId || raw.currentNowPlaying.sequenceItemId || ''),
          startedAt: toIsoDate(raw.currentNowPlaying.startedAt),
          durationMs: toNumber(raw.currentNowPlaying.durationMs),
          updatedAt: toIsoDate(raw.currentNowPlaying.updatedAt)
        }
      : null,
    isRecordable: raw.isRecordable === true,
    archiveRequested: raw.archiveRequested === true,
    archiveStatus: String(raw.archiveStatus || 'none'),
    archiveTrackPath: String(raw.archiveTrackPath || ''),
    archiveTrackURL: String(raw.archiveTrackURL || ''),
    moderationStatus: String(raw.moderationStatus || 'clear'),
    reportCount: toNumber(raw.reportCount)
  }
}

export function isLiveStreamFresh(stream = {}) {
  const heartbeat = stream.lastHostHeartbeatAt || stream.startedAt || stream.updatedAt
  const timestamp = heartbeat ? new Date(heartbeat).getTime() : 0
  return Boolean(timestamp) && Number.isFinite(timestamp) && Date.now() - timestamp < LIVE_HEARTBEAT_STALE_MS
}

export function isPublicLiveStreamVisible(stream = {}) {
  return stream.status === 'live'
    && (stream.visibility === 'public' || stream.accessMode === 'password')
    && stream.hostConnected === true
    && isLiveStreamFresh(stream)
    && !['removed', 'blocked'].includes(stream.moderationStatus)
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
      .filter(isPublicLiveStreamVisible)
  } catch (error) {
    console.warn('[musicLiveService] Public live streams could not be loaded.', error?.message || error)
    return []
  }
}

export function subscribeMusicLiveStream(streamId = '', onNext = () => {}, onError = () => {}) {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return () => {}
  return onSnapshot(
    doc(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id),
    (snapshot) => onNext(snapshot.exists() ? normalizeMusicLiveStream(snapshot) : null),
    (error) => {
      console.warn('[musicLiveService] Live stream subscription failed.', error?.message || error)
      onError(error)
    }
  )
}

export function subscribeMusicLiveChat(streamId = '', onNext = () => {}, onError = () => {}) {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return () => {}
  const messagesQuery = query(
    collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id, 'chatMessages'),
    where('status', '==', 'visible'),
    orderBy('createdAt', 'desc'),
    limit(80)
  )
  return onSnapshot(
    messagesQuery,
    (snapshot) => {
      const messages = snapshot.docs.map((docSnap) => {
        const raw = docSnap.data() || {}
        return {
          id: docSnap.id,
          messageId: String(raw.messageId || docSnap.id),
          streamId: String(raw.streamId || id),
          uid: String(raw.uid || ''),
          displayName: String(raw.displayName || 'Melogic Listener'),
          photoURL: String(raw.photoURL || ''),
          text: String(raw.text || ''),
          createdAt: toIsoDate(raw.createdAt),
          status: String(raw.status || 'visible')
        }
      }).reverse()
      onNext(messages)
    },
    (error) => {
      if (error?.code === 'permission-denied') {
        console.info('[musicLiveService] Live chat unavailable for this viewer.')
      } else {
        console.warn('[musicLiveService] Live chat subscription failed.', error?.message || error)
      }
      onError(error)
    }
  )
}

export function subscribeMusicLiveSequenceItems(streamId = '', onNext = () => {}, onError = () => {}) {
  const id = String(streamId || '').trim()
  if (!db || !id || id.includes('/')) return () => {}
  const itemsQuery = query(
    collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams, id, 'sequenceItems'),
    orderBy('createdAt', 'asc'),
    limit(100)
  )
  return onSnapshot(
    itemsQuery,
    (snapshot) => onNext(snapshot.docs.map((docSnap) => {
      const raw = docSnap.data() || {}
      return {
        id: docSnap.id,
        itemId: String(raw.itemId || docSnap.id),
        title: String(raw.title || ''),
        artist: String(raw.artist || ''),
        album: String(raw.album || ''),
        artworkURL: String(raw.artworkURL || ''),
        notes: String(raw.notes || ''),
        createdAt: toIsoDate(raw.createdAt),
        updatedAt: toIsoDate(raw.updatedAt)
      }
    })),
    (error) => {
      console.warn('[musicLiveService] Live sequence subscription failed.', error?.message || error)
      onError(error)
    }
  )
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

export async function listHostMusicLiveStreams(uid = '', { limitCount = 20 } = {}) {
  const hostUid = String(uid || '').trim()
  if (!db || !hostUid) return []
  try {
    const snapshot = await getDocs(query(
      collection(db, FIRESTORE_COLLECTIONS.musicLiveStreams),
      where('hostUid', '==', hostUid),
      limit(Math.max(1, Math.min(30, Number(limitCount) || 20)))
    ))
    return snapshot.docs
      .map((docSnap) => normalizeMusicLiveStream(docSnap))
      .sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime())
  } catch (error) {
    console.warn('[musicLiveService] Host live streams could not be loaded.', error?.message || error)
    return []
  }
}

export async function startMusicLiveStream(payload = {}) {
  const callable = httpsCallable(functions, 'startMusicLiveStream')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function prepareMusicLiveStreamDraft(payload = {}) {
  const callable = httpsCallable(functions, 'prepareMusicLiveStreamDraft')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function markMusicLiveStreamOnAir(streamId = '', options = {}) {
  const callable = httpsCallable(functions, 'markMusicLiveStreamOnAir')
  const result = await callable({ streamId, ...options })
  return result?.data || { ok: false }
}

export async function heartbeatMusicLiveStream(streamId = '', options = {}) {
  const callable = httpsCallable(functions, 'heartbeatMusicLiveStream')
  const result = await callable({ streamId, ...options })
  return result?.data || { ok: false }
}

export async function updateMusicLiveStreamInfo(payload = {}) {
  const callable = httpsCallable(functions, 'updateMusicLiveStreamInfo')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function joinMusicLiveStream(streamId = '', options = {}) {
  const callable = httpsCallable(functions, 'joinMusicLiveStream')
  const result = await callable({ streamId, ...options })
  return result?.data || { ok: false }
}

export async function endMusicLiveStream(streamId = '') {
  const callable = httpsCallable(functions, 'endMusicLiveStream')
  const result = await callable({ streamId })
  return result?.data || { ok: false }
}

export async function sendMusicLiveChatMessage(streamId = '', text = '') {
  const callable = httpsCallable(functions, 'sendMusicLiveChatMessage')
  const result = await callable({ streamId, text })
  return result?.data || { ok: false }
}

export async function updateMusicLiveListenerPresence(streamId = '', presenceId = '') {
  const callable = httpsCallable(functions, 'updateMusicLiveListenerPresence')
  const result = await callable({ streamId, presenceId })
  return result?.data || { ok: false }
}

export async function leaveMusicLiveStream(streamId = '', presenceId = '') {
  const callable = httpsCallable(functions, 'leaveMusicLiveStream')
  const result = await callable({ streamId, presenceId })
  return result?.data || { ok: false }
}

export async function getMusicLiveViewerState(streamId = '') {
  const callable = httpsCallable(functions, 'getMusicLiveViewerState')
  const result = await callable({ streamId })
  return result?.data || { ok: false, reaction: 'none', saved: false }
}

export async function toggleMusicLiveReaction(streamId = '', reaction = 'none') {
  const callable = httpsCallable(functions, 'toggleMusicLiveReaction')
  const result = await callable({ streamId, reaction })
  return result?.data || { ok: false }
}

export async function toggleSaveMusicLiveStream(streamId = '', saved = true) {
  const callable = httpsCallable(functions, 'toggleSaveMusicLiveStream')
  const result = await callable({ streamId, saved })
  return result?.data || { ok: false }
}

export async function upsertMusicLiveSequenceItem(payload = {}) {
  const callable = httpsCallable(functions, 'upsertMusicLiveSequenceItem')
  const result = await callable(payload)
  return result?.data || { ok: false }
}

export async function deleteMusicLiveSequenceItem(streamId = '', itemId = '') {
  const callable = httpsCallable(functions, 'deleteMusicLiveSequenceItem')
  const result = await callable({ streamId, itemId })
  return result?.data || { ok: false }
}

export async function setMusicLiveNowPlaying(streamId = '', itemId = '') {
  const callable = httpsCallable(functions, 'setMusicLiveNowPlaying')
  const result = await callable({ streamId, itemId })
  return result?.data || { ok: false }
}

export function sendMusicLiveUnloadBeacon({ streamId = '', idToken = '', reason = 'host_unload' } = {}) {
  const cleanStreamId = String(streamId || '').trim()
  if (!cleanStreamId || !idToken) return false
  const payload = JSON.stringify({ streamId: cleanStreamId, idToken, reason })
  const url = 'https://us-central1-melogic-records.cloudfunctions.net/endMusicLiveStreamBeacon'
  if (navigator.sendBeacon) {
    return navigator.sendBeacon(url, new Blob([payload], { type: 'application/json' }))
  }
  fetch(url, {
    method: 'POST',
    body: payload,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    keepalive: true
  }).catch(() => {})
  return true
}
