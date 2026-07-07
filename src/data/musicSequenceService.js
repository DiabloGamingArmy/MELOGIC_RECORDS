import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { storage } from '../firebase/storage'

export const SEQUENCE_ASSET_CATEGORIES = [
  'song',
  'jingle',
  'sweeper',
  'promo',
  'commercial',
  'station_id',
  'bed',
  'recorded_show',
  'podcast_segment',
  'voice_track',
  'other'
]

export const SEQUENCE_ITEM_TYPES = ['audio', 'video', 'metadata_only', 'break', 'voice_track', 'stop_marker', 'action_bookmark']

export const SEQUENCE_ACTION_TYPES = [
  'operator_note',
  'skip_to_next_playable',
  'set_next_item',
  'stop_after_current',
  'top_of_hour'
]

function toIsoDate(value) {
  if (!value) return ''
  if (typeof value?.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString()
}

function cleanString(value = '', max = 240) {
  return String(value || '').trim().slice(0, max)
}

function toStringArray(value) {
  if (Array.isArray(value)) return value.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 20)
  return String(value || '').split(',').map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 20)
}

function toNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizeAsset(raw = {}, id = '') {
  return {
    id,
    assetId: cleanString(raw.assetId || id, 120),
    ownerUid: cleanString(raw.ownerUid, 120),
    type: ['audio', 'video', 'image', 'metadata_only'].includes(raw.type) ? raw.type : 'audio',
    title: cleanString(raw.title || raw.originalFileName || 'Untitled asset', 160),
    artist: cleanString(raw.artist, 160),
    album: cleanString(raw.album, 160),
    composer: cleanString(raw.composer, 160),
    label: cleanString(raw.label, 160),
    category: SEQUENCE_ASSET_CATEGORIES.includes(raw.category) ? raw.category : 'other',
    tags: toStringArray(raw.tags),
    notes: cleanString(raw.notes, 1000),
    durationMs: Math.max(0, toNumber(raw.durationMs)),
    originalFileName: cleanString(raw.originalFileName, 240),
    originalMimeType: cleanString(raw.originalMimeType, 120),
    sourceUploadPath: cleanString(raw.sourceUploadPath, 500),
    normalizedAudioPath: cleanString(raw.normalizedAudioPath, 500),
    normalizedAudioURL: cleanString(raw.normalizedAudioURL, 1400),
    videoPath: cleanString(raw.videoPath, 500),
    videoURL: cleanString(raw.videoURL, 1400),
    videoAudioMode: cleanString(raw.videoAudioMode, 40),
    artworkPath: cleanString(raw.artworkPath, 500),
    artworkURL: cleanString(raw.artworkURL, 1400),
    waveformPath: cleanString(raw.waveformPath, 500),
    loudnessLUFS: raw.loudnessLUFS == null ? null : toNumber(raw.loudnessLUFS, null),
    sampleRate: Math.max(0, toNumber(raw.sampleRate)),
    bitDepth: Math.max(0, toNumber(raw.bitDepth)),
    channels: Math.max(0, toNumber(raw.channels)),
    status: ['uploading', 'processing', 'ready', 'failed', 'archived'].includes(raw.status) ? raw.status : 'ready',
    processingError: cleanString(raw.processingError, 500),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    lastUsedAt: toIsoDate(raw.lastUsedAt),
    playCount: Math.max(0, toNumber(raw.playCount)),
    fileSizeBytes: Math.max(0, toNumber(raw.fileSizeBytes))
  }
}

function normalizeSequence(raw = {}, id = '') {
  return {
    id,
    sequenceId: cleanString(raw.sequenceId || id, 120),
    ownerUid: cleanString(raw.ownerUid, 120),
    title: cleanString(raw.title || 'Untitled sequence', 160),
    description: cleanString(raw.description, 1000),
    status: ['draft', 'ready', 'active', 'archived'].includes(raw.status) ? raw.status : 'draft',
    mode: ['manual', 'autoplay', 'loop', 'shuffle', 'scheduled'].includes(raw.mode) ? raw.mode : 'manual',
    activeStreamId: cleanString(raw.activeStreamId, 160),
    totalDurationMs: Math.max(0, toNumber(raw.totalDurationMs)),
    itemCount: Math.max(0, toNumber(raw.itemCount)),
    defaultFadeInMs: Math.max(0, toNumber(raw.defaultFadeInMs)),
    defaultFadeOutMs: Math.max(0, toNumber(raw.defaultFadeOutMs)),
    defaultCrossfadeMs: Math.max(0, toNumber(raw.defaultCrossfadeMs, 2500)),
    defaultGapMs: Math.max(0, toNumber(raw.defaultGapMs)),
    notes: cleanString(raw.notes, 1000),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt),
    lastUsedAt: toIsoDate(raw.lastUsedAt)
  }
}

function normalizeSequenceItem(raw = {}, id = '') {
  return {
    id,
    itemId: cleanString(raw.itemId || id, 120),
    ownerUid: cleanString(raw.ownerUid, 120),
    sequenceId: cleanString(raw.sequenceId, 120),
    assetId: cleanString(raw.assetId, 120),
    type: SEQUENCE_ITEM_TYPES.includes(raw.type) ? raw.type : 'audio',
    bookmarkId: cleanString(raw.bookmarkId, 120),
    actionType: SEQUENCE_ACTION_TYPES.includes(raw.actionType) ? raw.actionType : '',
    configSnapshot: raw.configSnapshot && typeof raw.configSnapshot === 'object' ? raw.configSnapshot : {},
    categorySnapshot: cleanString(raw.categorySnapshot, 80),
    orderIndex: toNumber(raw.orderIndex),
    titleSnapshot: cleanString(raw.titleSnapshot || 'Untitled item', 160),
    artistSnapshot: cleanString(raw.artistSnapshot, 160),
    albumSnapshot: cleanString(raw.albumSnapshot, 160),
    artworkURLSnapshot: cleanString(raw.artworkURLSnapshot, 1400),
    normalizedAudioURLSnapshot: cleanString(raw.normalizedAudioURLSnapshot, 1400),
    durationMs: Math.max(0, toNumber(raw.durationMs)),
    startOffsetMs: Math.max(0, toNumber(raw.startOffsetMs)),
    endOffsetMs: Math.max(0, toNumber(raw.endOffsetMs)),
    introMs: Math.max(0, toNumber(raw.introMs)),
    outroMs: Math.max(0, toNumber(raw.outroMs)),
    cueInMs: Math.max(0, toNumber(raw.cueInMs)),
    cueOutMs: Math.max(0, toNumber(raw.cueOutMs)),
    fadeInMs: Math.max(0, toNumber(raw.fadeInMs)),
    fadeOutMs: Math.max(0, toNumber(raw.fadeOutMs)),
    crossfadeMs: Math.max(0, toNumber(raw.crossfadeMs)),
    gainDb: toNumber(raw.gainDb),
    playbackRate: Math.max(0.25, toNumber(raw.playbackRate, 1)),
    enabled: raw.enabled !== false,
    isPinned: raw.isPinned === true,
    notes: cleanString(raw.notes, 1000),
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

function normalizeActionBookmark(raw = {}, id = '') {
  const actionType = SEQUENCE_ACTION_TYPES.includes(raw.actionType) ? raw.actionType : 'operator_note'
  return {
    id,
    bookmarkId: cleanString(raw.bookmarkId || id, 120),
    ownerUid: cleanString(raw.ownerUid, 120),
    name: cleanString(raw.name || 'Operator note', 120),
    actionType,
    color: cleanString(raw.color || '#6ee7ff', 20),
    notes: cleanString(raw.notes, 1000),
    config: raw.config && typeof raw.config === 'object' ? raw.config : {},
    createdAt: toIsoDate(raw.createdAt),
    updatedAt: toIsoDate(raw.updatedAt)
  }
}

function assetCollection(uid) {
  return collection(db, 'users', uid, 'sequenceAssets')
}

function sequenceCollection(uid) {
  return collection(db, 'users', uid, 'sequences')
}

function actionBookmarkCollection(uid) {
  return collection(db, 'users', uid, 'sequenceActionBookmarks')
}

export async function listSequenceAssets(uid = '', options = {}) {
  if (!db || !uid) return []
  const constraints = []
  if (options.type && options.type !== 'all') constraints.push(where('type', '==', options.type))
  if (options.category && options.category !== 'all') constraints.push(where('category', '==', options.category))
  if (options.status && options.status !== 'all') constraints.push(where('status', '==', options.status))
  const sort = options.sort || 'created_desc'
  const sortMap = {
    created_asc: ['createdAt', 'asc'],
    updated_desc: ['updatedAt', 'desc'],
    title_asc: ['title', 'asc'],
    artist_asc: ['artist', 'asc'],
    duration_asc: ['durationMs', 'asc'],
    duration_desc: ['durationMs', 'desc'],
    used_desc: ['lastUsedAt', 'desc'],
    created_desc: ['createdAt', 'desc']
  }
  const [field, direction] = sortMap[sort] || sortMap.created_desc
  constraints.push(orderBy(field, direction), limit(Math.max(1, Math.min(50, Number(options.limitCount) || 30))))
  const snapshot = await getDocs(query(assetCollection(uid), ...constraints))
  const search = cleanString(options.search || '', 120).toLowerCase()
  return snapshot.docs
    .map((docSnap) => normalizeAsset(docSnap.data() || {}, docSnap.id))
    .filter((asset) => {
      if (!search) return true
      return [asset.title, asset.artist, asset.album, asset.originalFileName, asset.notes, asset.tags.join(' ')]
        .join(' ')
        .toLowerCase()
        .includes(search)
    })
}

export async function createSequenceAssetShell(uid = '', data = {}) {
  if (!db || !uid) throw new Error('Sign in to create sequence assets.')
  const ref = doc(assetCollection(uid))
  const now = serverTimestamp()
  const payload = {
    assetId: ref.id,
    ownerUid: uid,
    type: data.type || 'audio',
    title: cleanString(data.title || data.originalFileName || 'Untitled asset', 160),
    artist: cleanString(data.artist, 160),
    album: cleanString(data.album, 160),
    composer: cleanString(data.composer, 160),
    label: cleanString(data.label, 160),
    category: SEQUENCE_ASSET_CATEGORIES.includes(data.category) ? data.category : 'song',
    tags: toStringArray(data.tags),
    notes: cleanString(data.notes, 1000),
    durationMs: Math.max(0, Math.round(Number(data.durationMs) || 0)),
    originalFileName: cleanString(data.originalFileName, 240),
    originalMimeType: cleanString(data.originalMimeType, 120),
    sourceUploadPath: cleanString(data.sourceUploadPath, 500),
    normalizedAudioPath: cleanString(data.normalizedAudioPath, 500),
    normalizedAudioURL: cleanString(data.normalizedAudioURL, 1400),
    videoPath: cleanString(data.videoPath, 500),
    videoURL: cleanString(data.videoURL, 1400),
    videoAudioMode: cleanString(data.videoAudioMode, 40),
    artworkPath: cleanString(data.artworkPath, 500),
    artworkURL: cleanString(data.artworkURL, 1400),
    waveformPath: '',
    loudnessLUFS: null,
    sampleRate: Math.max(0, Math.round(Number(data.sampleRate) || 0)),
    bitDepth: Math.max(0, Math.round(Number(data.bitDepth) || 0)),
    channels: Math.max(0, Math.round(Number(data.channels) || 0)),
    status: data.status || 'uploading',
    processingError: cleanString(data.processingError, 500),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    playCount: 0,
    fileSizeBytes: Math.max(0, Math.round(Number(data.fileSizeBytes) || 0))
  }
  await setDoc(ref, payload)
  return { ...normalizeAsset(payload, ref.id), assetId: ref.id, id: ref.id }
}

export async function updateSequenceAsset(uid = '', assetId = '', data = {}) {
  if (!db || !uid || !assetId) throw new Error('A sequence asset is required.')
  const ref = doc(db, 'users', uid, 'sequenceAssets', assetId)
  await updateDoc(ref, { ...data, updatedAt: serverTimestamp() })
}

export async function uploadSequenceAssetFile(uid = '', assetId = '', file, pathKind = 'normalized') {
  if (!storage || !uid || !assetId || !file) throw new Error('Storage is not ready.')
  const safeName = cleanString(file.name || `${pathKind}.wav`, 160).replace(/[^a-zA-Z0-9._-]/g, '-')
  const folder = pathKind === 'video' ? 'video' : pathKind === 'artwork' ? 'artwork' : pathKind === 'source' ? 'source' : 'normalized'
  const fileName = pathKind === 'normalized' ? 'audio.wav' : safeName
  const path = `users/${uid}/sequenceAssets/${assetId}/${folder}/${fileName}`
  const ref = storageRef(storage, path)
  await uploadBytes(ref, file, {
    contentType: file.type || (pathKind === 'normalized' ? 'audio/wav' : 'application/octet-stream'),
    customMetadata: { ownerUid: uid, assetId, sequenceAssetKind: pathKind }
  })
  const url = await getDownloadURL(ref)
  return { path, url }
}

export async function listSequences(uid = '', limitCount = 30) {
  if (!db || !uid) return []
  const snapshot = await getDocs(query(sequenceCollection(uid), orderBy('updatedAt', 'desc'), limit(Math.max(1, Math.min(50, Number(limitCount) || 30)))))
  return snapshot.docs.map((docSnap) => normalizeSequence(docSnap.data() || {}, docSnap.id))
}

export async function createSequence(uid = '', data = {}) {
  if (!db || !uid) throw new Error('Sign in to create sequences.')
  const ref = doc(sequenceCollection(uid))
  const now = serverTimestamp()
  const payload = {
    sequenceId: ref.id,
    ownerUid: uid,
    title: cleanString(data.title || 'Untitled sequence', 160),
    description: cleanString(data.description, 1000),
    status: 'draft',
    mode: ['manual', 'autoplay', 'loop', 'shuffle', 'scheduled'].includes(data.mode) ? data.mode : 'manual',
    activeStreamId: '',
    totalDurationMs: 0,
    itemCount: 0,
    defaultFadeInMs: Math.max(0, Math.round(Number(data.defaultFadeInMs) || 0)),
    defaultFadeOutMs: Math.max(0, Math.round(Number(data.defaultFadeOutMs) || 0)),
    defaultCrossfadeMs: Math.max(0, Math.round(Number(data.defaultCrossfadeMs) || 2500)),
    defaultGapMs: Math.max(0, Math.round(Number(data.defaultGapMs) || 0)),
    notes: cleanString(data.notes, 1000),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null
  }
  await setDoc(ref, payload)
  return { ...normalizeSequence(payload, ref.id), id: ref.id, sequenceId: ref.id }
}

export async function updateSequence(uid = '', sequenceId = '', data = {}) {
  if (!db || !uid || !sequenceId) throw new Error('A sequence is required.')
  const payload = {}
  if ('title' in data) payload.title = cleanString(data.title || 'Untitled Sequence', 160)
  if ('description' in data) payload.description = cleanString(data.description, 1000)
  if ('status' in data && ['draft', 'ready', 'active', 'archived'].includes(data.status)) payload.status = data.status
  if ('mode' in data && ['manual', 'autoplay', 'loop', 'shuffle', 'scheduled'].includes(data.mode)) payload.mode = data.mode
  if ('notes' in data) payload.notes = cleanString(data.notes, 1000)
  if (!Object.keys(payload).length) return
  await updateDoc(doc(db, 'users', uid, 'sequences', sequenceId), {
    ...payload,
    updatedAt: serverTimestamp()
  })
}

export async function deleteSequence(uid = '', sequenceId = '') {
  if (!db || !uid || !sequenceId) throw new Error('A sequence is required.')
  await deleteDoc(doc(db, 'users', uid, 'sequences', sequenceId))
}

export async function duplicateSequence(uid = '', sequence = {}, items = []) {
  if (!db || !uid || !sequence?.sequenceId) throw new Error('Choose a sequence first.')
  const copy = await createSequence(uid, {
    title: `${cleanString(sequence.title || 'Untitled Sequence', 140)} Copy`,
    description: sequence.description,
    mode: sequence.mode,
    defaultFadeInMs: sequence.defaultFadeInMs,
    defaultFadeOutMs: sequence.defaultFadeOutMs,
    defaultCrossfadeMs: sequence.defaultCrossfadeMs,
    defaultGapMs: sequence.defaultGapMs,
    notes: sequence.notes
  })
  for (const item of items) {
    const ref = doc(collection(db, 'users', uid, 'sequences', copy.sequenceId, 'items'))
    const now = serverTimestamp()
    const { id: _id, itemId: _itemId, sequenceId: _sequenceId, createdAt: _createdAt, updatedAt: _updatedAt, ...copyableItem } = item
    await setDoc(ref, {
      ...copyableItem,
      itemId: ref.id,
      ownerUid: uid,
      sequenceId: copy.sequenceId,
      createdAt: now,
      updatedAt: now
    })
  }
  if (items.length) {
    await updateDoc(doc(db, 'users', uid, 'sequences', copy.sequenceId), {
      itemCount: items.length,
      totalDurationMs: items.reduce((sum, item) => sum + Math.max(0, Number(item.durationMs || 0)), 0),
      updatedAt: serverTimestamp()
    }).catch(() => {})
  }
  return copy
}

export async function listSequenceActionBookmarks(uid = '') {
  if (!db || !uid) return []
  const snapshot = await getDocs(query(actionBookmarkCollection(uid), orderBy('updatedAt', 'desc'), limit(50)))
  return snapshot.docs.map((docSnap) => normalizeActionBookmark(docSnap.data() || {}, docSnap.id))
}

export async function createSequenceActionBookmark(uid = '', data = {}) {
  if (!db || !uid) throw new Error('Sign in to create action bookmarks.')
  const ref = doc(actionBookmarkCollection(uid))
  const now = serverTimestamp()
  const actionType = SEQUENCE_ACTION_TYPES.includes(data.actionType) ? data.actionType : 'operator_note'
  const payload = {
    bookmarkId: ref.id,
    ownerUid: uid,
    name: cleanString(data.name || 'Operator note', 120),
    actionType,
    color: cleanString(data.color || '#6ee7ff', 20),
    notes: cleanString(data.notes, 1000),
    config: data.config && typeof data.config === 'object' ? data.config : {},
    createdAt: now,
    updatedAt: now
  }
  await setDoc(ref, payload)
  return { ...normalizeActionBookmark(payload, ref.id), id: ref.id, bookmarkId: ref.id }
}

export async function getSequence(uid = '', sequenceId = '') {
  if (!db || !uid || !sequenceId) return null
  const snapshot = await getDoc(doc(db, 'users', uid, 'sequences', sequenceId))
  return snapshot.exists() ? normalizeSequence(snapshot.data() || {}, snapshot.id) : null
}

export async function listSequenceItems(uid = '', sequenceId = '') {
  if (!db || !uid || !sequenceId) return []
  const snapshot = await getDocs(query(
    collection(db, 'users', uid, 'sequences', sequenceId, 'items'),
    orderBy('orderIndex', 'asc'),
    limit(250)
  ))
  return snapshot.docs.map((docSnap) => normalizeSequenceItem(docSnap.data() || {}, docSnap.id))
}

export async function addAssetToSequence(uid = '', sequenceId = '', asset = {}, sequence = {}) {
  if (!db || !uid || !sequenceId || !asset?.assetId) throw new Error('Choose an asset and sequence first.')
  const ref = doc(collection(db, 'users', uid, 'sequences', sequenceId, 'items'))
  const now = serverTimestamp()
  const orderIndex = Date.now()
  const item = {
    itemId: ref.id,
    ownerUid: uid,
    sequenceId,
    assetId: asset.assetId,
    type: asset.type === 'video' ? 'video' : 'audio',
    categorySnapshot: asset.category || 'other',
    orderIndex,
    titleSnapshot: asset.title,
    artistSnapshot: asset.artist,
    albumSnapshot: asset.album,
    artworkURLSnapshot: asset.artworkURL,
    normalizedAudioURLSnapshot: asset.normalizedAudioURL,
    durationMs: asset.durationMs || 0,
    startOffsetMs: 0,
    endOffsetMs: 0,
    introMs: 0,
    outroMs: 0,
    cueInMs: 0,
    cueOutMs: 0,
    fadeInMs: sequence.defaultFadeInMs || 0,
    fadeOutMs: sequence.defaultFadeOutMs || 0,
    crossfadeMs: sequence.defaultCrossfadeMs || 0,
    gainDb: 0,
    playbackRate: 1,
    enabled: true,
    isPinned: false,
    notes: '',
    createdAt: now,
    updatedAt: now
  }
  await setDoc(ref, item)
  await updateDoc(doc(db, 'users', uid, 'sequences', sequenceId), {
    itemCount: Math.max(0, Number(sequence.itemCount || 0) + 1),
    totalDurationMs: Math.max(0, Number(sequence.totalDurationMs || 0) + Number(asset.durationMs || 0)),
    updatedAt: now
  })
  await updateDoc(doc(db, 'users', uid, 'sequenceAssets', asset.assetId), {
    lastUsedAt: now,
    playCount: Math.max(0, Number(asset.playCount || 0) + 1),
    updatedAt: now
  }).catch(() => {})
  return { ...normalizeSequenceItem(item, ref.id), id: ref.id, itemId: ref.id }
}

export async function addActionBookmarkToSequence(uid = '', sequenceId = '', bookmark = {}, sequence = {}) {
  if (!db || !uid || !sequenceId || !bookmark?.bookmarkId) throw new Error('Choose a bookmark and sequence first.')
  const ref = doc(collection(db, 'users', uid, 'sequences', sequenceId, 'items'))
  const now = serverTimestamp()
  const actionType = SEQUENCE_ACTION_TYPES.includes(bookmark.actionType) ? bookmark.actionType : 'operator_note'
  const item = {
    itemId: ref.id,
    ownerUid: uid,
    sequenceId,
    assetId: '',
    type: 'action_bookmark',
    bookmarkId: bookmark.bookmarkId,
    actionType,
    configSnapshot: bookmark.config && typeof bookmark.config === 'object' ? bookmark.config : {},
    categorySnapshot: actionType,
    orderIndex: Date.now(),
    titleSnapshot: bookmark.name || 'Operator action',
    artistSnapshot: 'Action Bookmark',
    albumSnapshot: '',
    artworkURLSnapshot: '',
    normalizedAudioURLSnapshot: '',
    durationMs: 0,
    startOffsetMs: 0,
    endOffsetMs: 0,
    introMs: 0,
    outroMs: 0,
    cueInMs: 0,
    cueOutMs: 0,
    fadeInMs: 0,
    fadeOutMs: 0,
    crossfadeMs: 0,
    gainDb: 0,
    playbackRate: 1,
    enabled: true,
    isPinned: false,
    notes: bookmark.notes || '',
    createdAt: now,
    updatedAt: now
  }
  await setDoc(ref, item)
  await updateDoc(doc(db, 'users', uid, 'sequences', sequenceId), {
    itemCount: Math.max(0, Number(sequence.itemCount || 0) + 1),
    updatedAt: now
  }).catch(() => {})
  return { ...normalizeSequenceItem(item, ref.id), id: ref.id, itemId: ref.id }
}

export async function duplicateSequenceItem(uid = '', sequenceId = '', item = {}, sequence = {}) {
  if (!db || !uid || !sequenceId || !item?.itemId) throw new Error('Choose a sequence item first.')
  const ref = doc(collection(db, 'users', uid, 'sequences', sequenceId, 'items'))
  const now = serverTimestamp()
  const { id: _id, itemId: _itemId, createdAt: _createdAt, updatedAt: _updatedAt, ...copyableItem } = item
  const payload = {
    ...copyableItem,
    itemId: ref.id,
    ownerUid: uid,
    sequenceId,
    orderIndex: Date.now(),
    createdAt: now,
    updatedAt: now
  }
  await setDoc(ref, payload)
  await updateDoc(doc(db, 'users', uid, 'sequences', sequenceId), {
    itemCount: Math.max(0, Number(sequence.itemCount || 0) + 1),
    totalDurationMs: Math.max(0, Number(sequence.totalDurationMs || 0) + Number(item.durationMs || 0)),
    updatedAt: now
  }).catch(() => {})
  return { ...normalizeSequenceItem(payload, ref.id), id: ref.id, itemId: ref.id }
}

export async function updateSequenceItem(uid = '', sequenceId = '', itemId = '', data = {}) {
  if (!db || !uid || !sequenceId || !itemId) throw new Error('A sequence item is required.')
  await updateDoc(doc(db, 'users', uid, 'sequences', sequenceId, 'items', itemId), {
    ...data,
    updatedAt: serverTimestamp()
  })
}

export async function deleteSequenceItem(uid = '', sequenceId = '', itemId = '') {
  if (!db || !uid || !sequenceId || !itemId) return
  await deleteDoc(doc(db, 'users', uid, 'sequences', sequenceId, 'items', itemId))
}

export async function moveSequenceItem(uid = '', sequenceId = '', item = {}, direction = 0, siblings = []) {
  const index = siblings.findIndex((entry) => entry.itemId === item.itemId)
  const swap = siblings[index + direction]
  if (!swap) return
  await Promise.all([
    updateSequenceItem(uid, sequenceId, item.itemId, { orderIndex: swap.orderIndex }),
    updateSequenceItem(uid, sequenceId, swap.itemId, { orderIndex: item.orderIndex })
  ])
}

export function formatMs(ms = 0) {
  const total = Math.max(0, Math.round(Number(ms) || 0))
  const seconds = Math.floor(total / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}
