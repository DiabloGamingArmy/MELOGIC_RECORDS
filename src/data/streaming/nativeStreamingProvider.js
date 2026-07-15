import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db } from '../../firebase/firestore'
import { storage } from '../../firebase/storage'
import { observePlaybackDemand as observeNativeDemand } from './nativeStreamingPresence'
import { buildProviderDiagnostics, INGEST_MODES, PLAYBACK_MODES, providerCapabilities, STREAM_PROVIDERS } from './streamingProviderTypes'

const DEFAULT_NATIVE_OPTIONS = {
  targetLatencyMs: 30000,
  segmentDurationMs: 4000,
  minPlaybackBufferMs: 20000,
  maxPlaybackBufferMs: 60000,
  rollingRetentionMs: 300000,
  audioFirst: true,
  videoEnabled: false,
  idleWhenNoListeners: true
}

let recorderState = null
let diagnostics = buildProviderDiagnostics({
  provider: STREAM_PROVIDERS.firebaseSegments,
  connectionState: 'idle',
  lastMediaEvent: 'native-streaming-ready'
})
let playbackQueryDiagnostics = {}

const firebaseSegmentsEnabled = () => import.meta.env?.VITE_ENABLE_FIREBASE_SEGMENT_STREAMING === 'true'

function emitDiagnostics(callback = null) {
  if (typeof callback === 'function') callback(diagnostics)
}

function cleanId(value = '') {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
}

function supportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || ''
}

function segmentPath({ streamId = '', type = 'audio', index = 0 } = {}) {
  return `liveSegments/${cleanId(streamId)}/${type}/${Number(index ?? 0)}.webm`
}

function segmentCollection(streamId = '') {
  return collection(db, 'musicLiveStreams', cleanId(streamId), 'segments')
}

export function createNativeStreamSession(options = {}) {
  diagnostics = buildProviderDiagnostics({
    provider: STREAM_PROVIDERS.firebaseSegments,
    connectionState: 'session-ready',
    roomName: cleanId(options.streamId || options.roomName || ''),
    lastMediaEvent: 'native-session-created'
  })
  return {
    ok: true,
    provider: STREAM_PROVIDERS.firebaseSegments,
    ingestMode: INGEST_MODES.browserMediaRecorder,
    playbackMode: PLAYBACK_MODES.firebaseSegments,
    nativeStreaming: { ...DEFAULT_NATIVE_OPTIONS, ...(options.nativeStreaming || {}), enabled: true },
    diagnostics
  }
}

export async function startNativeBroadcast(options = {}) {
  diagnostics = buildProviderDiagnostics({
    ...diagnostics,
    connectionState: 'waiting-for-playback-demand',
    lastMediaEvent: 'native-broadcast-ready'
  })
  return createNativeStreamSession(options)
}

export async function stopNativeBroadcast() {
  stopSegmentRecorder()
  diagnostics = buildProviderDiagnostics({
    provider: STREAM_PROVIDERS.firebaseSegments,
    connectionState: 'stopped',
    lastMediaEvent: 'native-broadcast-stopped'
  })
  return { ok: true, diagnostics }
}

export function observePlaybackDemand(streamId = '', onNext = () => {}) {
  const path = `livePresence/${streamId}/playbackDemand`
  return observeNativeDemand(streamId, (payload = {}) => {
    onNext({ path, ...payload })
  })
}

export function startSegmentRecorder(programMediaStream, options = {}) {
  if (!firebaseSegmentsEnabled()) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'disabled', recorderState: 'disabled', lastMediaEvent: 'firebase-segment-streaming-disabled' })
    emitDiagnostics(options.onDiagnostics)
    return { ok: false, disabled: true, error: 'Firebase segment streaming is disabled. LiveKit/WebRTC is the default live transport.', diagnostics }
  }
  const streamId = cleanId(options.streamId)
  const mediaStreamTrackCount = programMediaStream?.getTracks?.().length || 0
  const trackCount = programMediaStream?.getTracks?.().filter((track) => track.readyState === 'live').length || 0
  const audioTracks = programMediaStream?.getAudioTracks?.() || []
  const audioTrackReadyState = audioTracks[0]?.readyState || ''
  const onDiagnostics = options.onDiagnostics
  if (recorderState?.recorder?.state === 'recording') {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, recorderState: 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastMediaEvent: 'recorder-already-running' })
    emitDiagnostics(onDiagnostics)
    return { ok: true, alreadyRunning: true, diagnostics }
  }
  if (typeof MediaRecorder === 'undefined') {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', recorderState: 'unsupported', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastMediaEvent: 'MediaRecorder unsupported' })
    emitDiagnostics(onDiagnostics)
    return { ok: false, error: 'MediaRecorder is not supported in this browser.', diagnostics }
  }
  if (!programMediaStream?.getTracks?.().some((track) => track.readyState === 'live')) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'idle', recorderState: 'idle', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastMediaEvent: 'no usable Program Mixer tracks' })
    emitDiagnostics(onDiagnostics)
    return { ok: false, error: 'Program Mixer output has no usable tracks.', diagnostics }
  }
  if (!audioTracks.length) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'idle', recorderState: 'idle', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastMediaEvent: 'no audio track for audio-first MVP' })
    emitDiagnostics(onDiagnostics)
    return { ok: false, error: 'Native Streaming has no audio track to record. Enable a mic or sequence output.', diagnostics }
  }
  const mimeType = supportedAudioMimeType()
  if (!mimeType) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', recorderState: 'unsupported', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastMediaEvent: 'audio/webm unsupported' })
    emitDiagnostics(onDiagnostics)
    return { ok: false, error: 'This browser cannot record audio/webm segments.', diagnostics }
  }
  const audioOnlyStream = new MediaStream(audioTracks)
  const recorder = new MediaRecorder(audioOnlyStream, { mimeType })
  const state = {
    streamId,
    recorder,
    index: Number(options.startIndex || 0),
    startedAt: Date.now(),
    mimeType,
    segmentDurationMs: Number(options.segmentDurationMs || DEFAULT_NATIVE_OPTIONS.segmentDurationMs),
    readySegmentWriteCount: Number(diagnostics.readySegmentWriteCount || 0),
    uploading: false,
    shouldUploadSegment: typeof options.shouldUploadSegment === 'function' ? options.shouldUploadSegment : () => true,
    isStreamActive: typeof options.isStreamActive === 'function' ? options.isStreamActive : () => true,
    onDiagnostics
  }
  recorderState = state
  recorder.addEventListener('dataavailable', (event) => {
    const blobSize = Number(event.data?.size || 0)
    const lastDataAvailableAt = new Date().toISOString()
    if (!event.data || blobSize <= 0) {
      diagnostics = buildProviderDiagnostics({ ...diagnostics, recorderState: recorder.state || 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastBlobSize: blobSize, lastDataAvailableAt, segmentDurationMs: state.segmentDurationMs, lastMediaEvent: 'segment-skipped-empty-blob' })
      emitDiagnostics(onDiagnostics)
      return
    }
    if (!state.shouldUploadSegment() || !state.isStreamActive()) {
      diagnostics = buildProviderDiagnostics({ ...diagnostics, recorderState: recorder.state || 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastBlobSize: blobSize, lastDataAvailableAt, segmentDurationMs: state.segmentDurationMs, segmentIndex: state.index, lastMediaEvent: 'segment-skipped-no-demand' })
      emitDiagnostics(onDiagnostics)
      return
    }
    const index = state.index
    state.index += 1
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'recording', recorderState: recorder.state || 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, lastBlobSize: blobSize, lastDataAvailableAt, segmentDurationMs: state.segmentDurationMs, segmentIndex: index, selectedMimeType: mimeType, lastMediaEvent: 'segment-blob-ready' })
    emitDiagnostics(onDiagnostics)
    uploadSegment(event.data, {
      streamId,
      type: 'audio',
      index,
      mimeType,
      durationMs: state.segmentDurationMs,
      programTimeMs: Date.now() - state.startedAt,
      rollingRetentionMs: Number(options.rollingRetentionMs || DEFAULT_NATIVE_OPTIONS.rollingRetentionMs),
      isStreamActive: state.isStreamActive
    }).then((uploadResult = {}) => {
      if (!uploadResult?.ok) return
      state.readySegmentWriteCount += 1
      diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'recording', recorderState: recorder.state || 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, segmentDurationMs: state.segmentDurationMs, readySegmentWriteCount: state.readySegmentWriteCount, newestAvailableSegmentIndex: Number(uploadResult.index ?? index), hasPlayableSegments: true, lastMediaEvent: 'segment-ready' })
      emitDiagnostics(onDiagnostics)
    }).catch((error) => {
      diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', recorderState: recorder.state || 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, segmentDurationMs: state.segmentDurationMs, lastUploadError: error?.message || 'segment upload failed', lastMediaEvent: error?.message || 'segment upload failed' })
      emitDiagnostics(onDiagnostics)
    })
  })
  recorder.addEventListener('error', (event) => {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', recorderState: 'error', trackCount, mediaStreamTrackCount, audioTrackReadyState, segmentDurationMs: state.segmentDurationMs, lastUploadError: event.error?.message || 'recorder error', lastMediaEvent: event.error?.message || 'recorder error' })
    emitDiagnostics(onDiagnostics)
  })
  audioTracks.forEach((track) => track.addEventListener?.('ended', () => stopSegmentRecorder(), { once: true }))
  try {
    recorder.start(state.segmentDurationMs)
  } catch (error) {
    recorderState = null
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', recorderState: 'error', trackCount, mediaStreamTrackCount, audioTrackReadyState, segmentDurationMs: state.segmentDurationMs, lastUploadError: error?.message || 'MediaRecorder start failed', lastMediaEvent: error?.message || 'MediaRecorder start failed' })
    emitDiagnostics(onDiagnostics)
    return { ok: false, error: error?.message || 'MediaRecorder start failed.', diagnostics }
  }
  diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'recording', recorderState: 'recording', trackCount, mediaStreamTrackCount, audioTrackReadyState, segmentDurationMs: state.segmentDurationMs, selectedMimeType: mimeType, segmentIndex: state.index, lastMediaEvent: 'segment-recorder-started' })
  emitDiagnostics(onDiagnostics)
  return { ok: true, diagnostics }
}

export function stopSegmentRecorder() {
  if (recorderState?.recorder && recorderState.recorder.state !== 'inactive') {
    recorderState.recorder.stop()
  }
  recorderState = null
  diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'idle', recorderState: 'inactive', lastMediaEvent: 'segment-recorder-stopped' })
  return { ok: true, diagnostics }
}

export async function uploadSegment(segmentBlob, metadata = {}) {
  if (!firebaseSegmentsEnabled()) throw new Error('Firebase segment streaming is disabled.')
  if (!storage || !db) throw new Error('Firebase Storage or Firestore is not available.')
  const streamId = cleanId(metadata.streamId)
  if (!streamId) throw new Error('A stream id is required to upload a segment.')
  const type = ['audio', 'video', 'av'].includes(metadata.type) ? metadata.type : 'audio'
  const index = Number(metadata.index ?? 0)
  const path = segmentPath({ streamId, type, index })
  const uploadStartedAt = serverTimestamp()
  const upload = await uploadBytes(storageRef(storage, path), segmentBlob, {
    contentType: metadata.mimeType || segmentBlob.type || 'audio/webm',
    customMetadata: { streamId, provider: STREAM_PROVIDERS.firebaseSegments, segmentIndex: String(index), type }
  })
  if (typeof metadata.isStreamActive === 'function' && !metadata.isStreamActive()) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, lastUploadPath: path, lastMediaEvent: 'segment-uploaded-metadata-skipped-inactive' })
    return { ok: false, skipped: true, storagePath: path }
  }
  const downloadURL = await getDownloadURL(upload.ref).catch(() => '')
  diagnostics = buildProviderDiagnostics({ ...diagnostics, lastUploadPath: path, lastUploadError: '', newestAvailableSegmentIndex: index, hasPlayableSegments: true, lastMediaEvent: 'segment-uploaded' })
  const expiresAt = Timestamp.fromMillis(Date.now() + Number(metadata.rollingRetentionMs || DEFAULT_NATIVE_OPTIONS.rollingRetentionMs))
  return writeSegmentMetadata({
    provider: STREAM_PROVIDERS.firebaseSegments,
    type,
    index,
    storagePath: path,
    downloadURL,
    mimeType: metadata.mimeType || segmentBlob.type || 'audio/webm',
    durationMs: Number(metadata.durationMs || DEFAULT_NATIVE_OPTIONS.segmentDurationMs),
    sizeBytes: Number(segmentBlob.size || 0),
    ready: true,
    createdAt: serverTimestamp(),
    expiresAt,
    programTimeMs: Number(metadata.programTimeMs || 0),
    uploadStartedAt,
    uploadCompletedAt: serverTimestamp(),
    streamId
  })
}

export async function writeSegmentMetadata(segmentDoc = {}) {
  if (!firebaseSegmentsEnabled()) throw new Error('Firebase segment streaming is disabled.')
  const streamId = cleanId(segmentDoc.streamId)
  if (!db || !streamId) throw new Error('Cannot write segment metadata without Firestore and stream id.')
  const { streamId: _streamId, ...payload } = segmentDoc
  const docRef = await addDoc(segmentCollection(streamId), payload)
  await updateDoc(doc(db, 'musicLiveStreams', streamId), {
    broadcastState: 'liveBroadcasting',
    'nativeStreaming.status': 'broadcasting',
    'nativeStreaming.hasPlayableSegments': true,
    'nativeStreaming.newestAvailableSegmentIndex': Number(payload.index ?? 0),
    'nativeStreaming.currentSegmentIndex': Number(payload.index ?? 0),
    'nativeStreaming.lastSegmentAt': serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }).catch(() => {})
  console.info('[native-streaming] segment metadata written', {
    streamId,
    segmentDocId: docRef.id,
    index: Number(payload.index ?? 0),
    ready: payload.ready === true,
    type: payload.type || '',
    mimeType: payload.mimeType || '',
    sizeBytes: Number(payload.sizeBytes || 0),
    downloadURLPresent: Boolean(payload.downloadURL),
    storagePath: payload.storagePath || '',
    uploadPath: payload.storagePath || '',
    newestAvailableSegmentIndex: Number(payload.index ?? 0)
  })
  return { ok: true, segmentId: docRef.id, ...payload }
}

export async function getNativePlaybackQueue(streamId = '', options = {}) {
  if (!firebaseSegmentsEnabled()) {
    playbackQueryDiagnostics = {
      streamId: cleanId(streamId),
      queryPath: '',
      queryFilters: [],
      snapshotSize: 0,
      readySegmentCount: 0,
      lastSegmentError: 'Firebase segment streaming is disabled. LiveKit/WebRTC is the default live transport.'
    }
    return []
  }
  if (!db || !streamId) return []
  const minBufferMs = Number(options.minPlaybackBufferMs || DEFAULT_NATIVE_OPTIONS.minPlaybackBufferMs)
  const minSegments = Math.max(1, Math.ceil(minBufferMs / Number(options.segmentDurationMs || DEFAULT_NATIVE_OPTIONS.segmentDurationMs)))
  const cleanStreamId = cleanId(streamId)
  const queryPath = `musicLiveStreams/${cleanStreamId}/segments`
  const queryFilters = ['ready == true', 'type == audio', 'orderBy index asc', `limit ${Math.max(20, minSegments)}`]
  try {
    const snapshot = await getDocs(query(
      segmentCollection(cleanStreamId),
      where('ready', '==', true),
      where('type', '==', 'audio'),
      orderBy('index', 'asc'),
      limit(Math.max(20, minSegments))
    ))
    const queue = await Promise.all(snapshot.docs.map(async (docSnap) => {
      const segment = { segmentId: docSnap.id, ...(docSnap.data() || {}) }
      if (!segment.downloadURL && segment.storagePath) {
        try {
          segment.downloadURL = await getDownloadURL(storageRef(storage, segment.storagePath))
        } catch (error) {
          segment.downloadURLError = `${error?.code || 'storage-url-error'}: ${error?.message || 'Could not resolve segment storage URL.'}`
        }
      }
      return segment
    }))
    const first = queue[0] || {}
    const firstDownloadUrlError = first.downloadURLError || ''
    playbackQueryDiagnostics = {
      streamId: cleanStreamId,
      queryPath,
      queryFilters,
      snapshotSize: snapshot.size,
      firstSegmentId: first.segmentId || '',
      firstSegmentIndex: Number.isFinite(Number(first.index)) ? Number(first.index) : null,
      firstSegmentReady: first.ready === true,
      firstSegmentType: first.type || '',
      firstSegmentDownloadURLPresent: Boolean(first.downloadURL),
      firstSegmentStoragePathPresent: Boolean(first.storagePath),
      firstSegmentDownloadURLError: firstDownloadUrlError,
      newestAvailableSegmentIndex: queue.length ? Number(queue[queue.length - 1].index ?? 0) : options.newestAvailableSegmentIndex ?? null,
      readySegmentCount: queue.length,
      lastSegmentError: firstDownloadUrlError
    }
    console.info('[native-streaming] segment query diagnostics', playbackQueryDiagnostics)
    Object.defineProperty(queue, 'diagnostics', { value: playbackQueryDiagnostics, enumerable: false })
    return queue
  } catch (error) {
    playbackQueryDiagnostics = {
      streamId: cleanStreamId,
      queryPath,
      queryFilters,
      snapshotSize: 0,
      firstSegmentId: '',
      firstSegmentIndex: null,
      firstSegmentReady: false,
      firstSegmentType: '',
      firstSegmentDownloadURLPresent: false,
      firstSegmentStoragePathPresent: false,
      firstSegmentDownloadURLError: '',
      newestAvailableSegmentIndex: options.newestAvailableSegmentIndex ?? null,
      readySegmentCount: 0,
      lastSegmentError: `${error?.code || 'segment-query-error'}: ${error?.message || 'Segment query failed.'}`,
      errorCode: error?.code || '',
      errorMessage: error?.message || ''
    }
    console.error('[native-streaming] segment query failed', playbackQueryDiagnostics)
    throw error
  }
}

export function getNativePlaybackQueueDiagnostics() {
  return playbackQueryDiagnostics
}

export async function cleanupOldSegments(streamId = '', options = {}) {
  diagnostics = buildProviderDiagnostics({ ...diagnostics, lastMediaEvent: `cleanup-placeholder:${cleanId(streamId) || 'none'}` })
  return { ok: true, deferred: true, retentionMs: Number(options.rollingRetentionMs || DEFAULT_NATIVE_OPTIONS.rollingRetentionMs) }
}

export function getDiagnostics() {
  return diagnostics
}

export function createNativeStreamingProvider() {
  return {
    id: STREAM_PROVIDERS.firebaseSegments,
    label: 'Firebase Segments',
    description: 'Experimental Firebase MediaRecorder segment playback.',
    transportProvider: 'firebase',
    ingestMode: 'browser-media-recorder',
    playbackMode: 'firebaseSegments',
    experimental: true,
    configured: true,
    capabilities: providerCapabilities(STREAM_PROVIDERS.firebaseSegments),
    createStreamSession: createNativeStreamSession,
    startNativeBroadcast,
    stopNativeBroadcast,
    observePlaybackDemand,
    startSegmentRecorder,
    stopSegmentRecorder,
    uploadSegment,
    writeSegmentMetadata,
    getNativePlaybackQueue,
    getNativePlaybackQueueDiagnostics,
    cleanupOldSegments,
    getDiagnostics
  }
}
