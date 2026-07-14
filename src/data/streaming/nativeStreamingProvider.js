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
  provider: STREAM_PROVIDERS.nativeStreaming,
  connectionState: 'idle',
  lastMediaEvent: 'native-streaming-ready'
})

function cleanId(value = '') {
  return String(value || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
}

function supportedAudioMimeType() {
  if (typeof MediaRecorder === 'undefined') return ''
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((type) => MediaRecorder.isTypeSupported?.(type)) || ''
}

function segmentPath({ streamId = '', type = 'audio', index = 0 } = {}) {
  return `liveSegments/${cleanId(streamId)}/${type}/${Number(index || 0)}.webm`
}

function segmentCollection(streamId = '') {
  return collection(db, 'musicLiveStreams', cleanId(streamId), 'segments')
}

export function createNativeStreamSession(options = {}) {
  diagnostics = buildProviderDiagnostics({
    provider: STREAM_PROVIDERS.nativeStreaming,
    connectionState: 'session-ready',
    roomName: cleanId(options.streamId || options.roomName || ''),
    lastMediaEvent: 'native-session-created'
  })
  return {
    ok: true,
    provider: STREAM_PROVIDERS.nativeStreaming,
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
    provider: STREAM_PROVIDERS.nativeStreaming,
    connectionState: 'stopped',
    lastMediaEvent: 'native-broadcast-stopped'
  })
  return { ok: true, diagnostics }
}

export function observePlaybackDemand(streamId = '', onNext = () => {}) {
  return observeNativeDemand(streamId, onNext)
}

export function startSegmentRecorder(programMediaStream, options = {}) {
  const streamId = cleanId(options.streamId)
  if (recorderState?.recorder?.state === 'recording') {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, lastMediaEvent: 'recorder-already-running' })
    return { ok: true, alreadyRunning: true, diagnostics }
  }
  if (typeof MediaRecorder === 'undefined') {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', lastMediaEvent: 'MediaRecorder unsupported' })
    return { ok: false, error: 'MediaRecorder is not supported in this browser.', diagnostics }
  }
  if (!programMediaStream?.getTracks?.().some((track) => track.readyState === 'live')) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'idle', lastMediaEvent: 'no usable Program Mixer tracks' })
    return { ok: false, error: 'Program Mixer output has no usable tracks.', diagnostics }
  }
  const audioTracks = programMediaStream.getAudioTracks?.() || []
  if (!audioTracks.length) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'idle', lastMediaEvent: 'no audio track for audio-first MVP' })
    return { ok: false, error: 'Native Streaming MVP requires a Program Mixer audio track.', diagnostics }
  }
  const mimeType = supportedAudioMimeType()
  if (!mimeType) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', lastMediaEvent: 'audio/webm unsupported' })
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
    uploading: false,
    shouldUploadSegment: typeof options.shouldUploadSegment === 'function' ? options.shouldUploadSegment : () => true,
    isStreamActive: typeof options.isStreamActive === 'function' ? options.isStreamActive : () => true
  }
  recorderState = state
  recorder.addEventListener('dataavailable', (event) => {
    if (!event.data || event.data.size <= 0) return
    if (!state.shouldUploadSegment() || !state.isStreamActive()) {
      diagnostics = buildProviderDiagnostics({ ...diagnostics, lastMediaEvent: 'segment-skipped-no-demand' })
      return
    }
    const index = state.index
    state.index += 1
    uploadSegment(event.data, {
      streamId,
      type: 'audio',
      index,
      mimeType,
      durationMs: state.segmentDurationMs,
      programTimeMs: Date.now() - state.startedAt,
      rollingRetentionMs: Number(options.rollingRetentionMs || DEFAULT_NATIVE_OPTIONS.rollingRetentionMs),
      isStreamActive: state.isStreamActive
    }).catch((error) => {
      diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', lastMediaEvent: error?.message || 'segment upload failed' })
    })
  })
  recorder.addEventListener('error', (event) => {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'error', lastMediaEvent: event.error?.message || 'recorder error' })
  })
  audioTracks.forEach((track) => track.addEventListener?.('ended', () => stopSegmentRecorder(), { once: true }))
  recorder.start(state.segmentDurationMs)
  diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'recording', lastMediaEvent: 'segment-recorder-started' })
  return { ok: true, diagnostics }
}

export function stopSegmentRecorder() {
  if (recorderState?.recorder && recorderState.recorder.state !== 'inactive') {
    recorderState.recorder.stop()
  }
  recorderState = null
  diagnostics = buildProviderDiagnostics({ ...diagnostics, connectionState: 'idle', lastMediaEvent: 'segment-recorder-stopped' })
  return { ok: true, diagnostics }
}

export async function uploadSegment(segmentBlob, metadata = {}) {
  if (!storage || !db) throw new Error('Firebase Storage or Firestore is not available.')
  const streamId = cleanId(metadata.streamId)
  if (!streamId) throw new Error('A stream id is required to upload a segment.')
  const type = ['audio', 'video', 'av'].includes(metadata.type) ? metadata.type : 'audio'
  const index = Number(metadata.index || 0)
  const path = segmentPath({ streamId, type, index })
  const uploadStartedAt = serverTimestamp()
  const upload = await uploadBytes(storageRef(storage, path), segmentBlob, {
    contentType: metadata.mimeType || segmentBlob.type || 'audio/webm',
    customMetadata: { streamId, provider: STREAM_PROVIDERS.nativeStreaming, segmentIndex: String(index), type }
  })
  if (typeof metadata.isStreamActive === 'function' && !metadata.isStreamActive()) {
    diagnostics = buildProviderDiagnostics({ ...diagnostics, lastMediaEvent: 'segment-uploaded-metadata-skipped-inactive' })
    return { ok: false, skipped: true, storagePath: path }
  }
  const downloadURL = await getDownloadURL(upload.ref).catch(() => '')
  const expiresAt = Timestamp.fromMillis(Date.now() + Number(metadata.rollingRetentionMs || DEFAULT_NATIVE_OPTIONS.rollingRetentionMs))
  return writeSegmentMetadata({
    provider: STREAM_PROVIDERS.nativeStreaming,
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
  const streamId = cleanId(segmentDoc.streamId)
  if (!db || !streamId) throw new Error('Cannot write segment metadata without Firestore and stream id.')
  const { streamId: _streamId, ...payload } = segmentDoc
  const docRef = await addDoc(segmentCollection(streamId), payload)
  await updateDoc(doc(db, 'musicLiveStreams', streamId), {
    broadcastState: 'broadcasting',
    'nativeStreaming.status': 'broadcasting',
    'nativeStreaming.hasPlayableSegments': true,
    'nativeStreaming.newestAvailableSegmentIndex': Number(payload.index || 0),
    'nativeStreaming.currentSegmentIndex': Number(payload.index || 0),
    'nativeStreaming.lastSegmentAt': serverTimestamp(),
    updatedAt: serverTimestamp()
  }, { merge: true }).catch(() => {})
  return { ok: true, segmentId: docRef.id, ...payload }
}

export async function getNativePlaybackQueue(streamId = '', options = {}) {
  if (!db || !streamId) return []
  const minBufferMs = Number(options.minPlaybackBufferMs || DEFAULT_NATIVE_OPTIONS.minPlaybackBufferMs)
  const minSegments = Math.max(1, Math.ceil(minBufferMs / Number(options.segmentDurationMs || DEFAULT_NATIVE_OPTIONS.segmentDurationMs)))
  const snapshot = await getDocs(query(
    segmentCollection(streamId),
    where('provider', '==', STREAM_PROVIDERS.nativeStreaming),
    where('ready', '==', true),
    orderBy('index', 'asc'),
    limit(Math.max(minSegments, 8))
  )).catch(() => null)
  return snapshot?.docs?.map((docSnap) => ({ segmentId: docSnap.id, ...(docSnap.data() || {}) })) || []
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
    id: STREAM_PROVIDERS.nativeStreaming,
    label: 'Native Streaming',
    configured: true,
    capabilities: providerCapabilities(STREAM_PROVIDERS.nativeStreaming),
    createStreamSession: createNativeStreamSession,
    startNativeBroadcast,
    stopNativeBroadcast,
    observePlaybackDemand,
    startSegmentRecorder,
    stopSegmentRecorder,
    uploadSegment,
    writeSegmentMetadata,
    getNativePlaybackQueue,
    cleanupOldSegments,
    getDiagnostics
  }
}
