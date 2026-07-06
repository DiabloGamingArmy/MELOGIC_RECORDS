const admin = require('firebase-admin')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { AccessToken, TrackSource } = require('livekit-server-sdk')
const { resolvePermissionsForUid } = require('../account/accountPermissions')

const LIVEKIT_URL = defineSecret('LIVEKIT_URL')
const LIVEKIT_API_KEY = defineSecret('LIVEKIT_API_KEY')
const LIVEKIT_API_SECRET = defineSecret('LIVEKIT_API_SECRET')

const ALLOWED_CATEGORIES = new Set(['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other'])
const ALLOWED_VISIBILITIES = new Set(['public', 'unlisted', 'private'])
const ALLOWED_AUDIO_MODES = new Set(['music', 'voice'])
const ELIGIBLE_ROLES = new Set(['creator', 'artist', 'founder', 'staff', 'admin', 'owner'])
const STARTING_TIMEOUT_MS = 5 * 60 * 1000
const HOST_HEARTBEAT_STALE_MS = 90 * 1000
const CHAT_TEXT_MAX_LENGTH = 500
const MAX_ACTIVE_LIVE_STREAMS_PER_HOST = 3
const STAFF_ACTIVE_LIVE_STREAMS_PER_HOST = 10
const MAX_CONFIGURED_LIVE_STREAMS_PER_HOST = 25

function db() {
  return admin.firestore()
}

function cleanString(value, max = 240) {
  return String(value || '').trim().slice(0, max)
}

function cleanRoomName(value) {
  return cleanString(value, 96).replace(/[^a-zA-Z0-9_-]/g, '-').replace(/-+/g, '-')
}

function toTags(value) {
  if (Array.isArray(value)) return value.map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 12)
  return String(value || '').split(',').map((item) => cleanString(item, 40)).filter(Boolean).slice(0, 12)
}

function normalizeAudioMode(value) {
  return ALLOWED_AUDIO_MODES.has(value) ? value : 'music'
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function isHeartbeatFresh(stream = {}) {
  const lastHeartbeat = timestampMillis(stream.lastHostHeartbeatAt || stream.startedAt || stream.updatedAt)
  return Boolean(lastHeartbeat) && Date.now() - lastHeartbeat < HOST_HEARTBEAT_STALE_MS
}

function isAdminAuth(auth = null) {
  return auth?.token?.admin === true || ['owner', 'admin'].includes(cleanString(auth?.token?.adminRole, 40))
}

function accountRole(user = {}, profile = {}) {
  return cleanString(user.role || user.accountType || user.roleLabel || profile.role || profile.roleLabel || profile.accountType || '', 40).toLowerCase()
}

function liveStreamLimitForHost({ user = {}, profile = {}, accountPermissions = null, auth = null } = {}) {
  const rawLimit = accountPermissions?.permissions?.musicLiveMaxStreams
  if (typeof rawLimit === 'number' && Number.isFinite(rawLimit)) {
    return Math.max(0, Math.min(MAX_CONFIGURED_LIVE_STREAMS_PER_HOST, Math.floor(rawLimit)))
  }
  const role = accountRole(user, profile)
  if (isAdminAuth(auth) || ['owner', 'admin', 'staff'].includes(role)) return STAFF_ACTIVE_LIVE_STREAMS_PER_HOST
  return MAX_ACTIVE_LIVE_STREAMS_PER_HOST
}

function cleanStreamMetadata(data = {}) {
  const title = cleanString(data.title, 90)
  const description = cleanString(data.description, 1200)
  const category = ALLOWED_CATEGORIES.has(data.category) ? data.category : 'music'
  const visibility = ALLOWED_VISIBILITIES.has(data.visibility) ? data.visibility : 'public'
  const coverArtURL = sanitizeCoverArtURL(data.coverArtURL)
  const coverArtPath = cleanString(data.coverArtPath, 500)
  const tags = toTags(data.tags)
  return { title, description, category, visibility, coverArtURL, coverArtPath, tags }
}

function liveLog(stage, extra = {}) {
  console.log('[musicLiveStreams]', {
    stage,
    ...extra
  })
}

function liveWarn(stage, extra = {}) {
  console.warn('[musicLiveStreams]', {
    stage,
    ...extra
  })
}

function livekitConfig(stage = 'livekit config check') {
  const url = cleanString(LIVEKIT_URL.value(), 1000)
  const apiKey = cleanString(LIVEKIT_API_KEY.value(), 240)
  const apiSecret = cleanString(LIVEKIT_API_SECRET.value(), 240)
  liveLog(stage, {
    livekitUrlPresent: Boolean(url),
    livekitApiKeyPresent: Boolean(apiKey),
    livekitApiSecretPresent: Boolean(apiSecret)
  })
  if (!url || !apiKey || !apiSecret) {
    throw new HttpsError('failed-precondition', 'Live streaming is not configured yet.', {
      stage,
      livekitUrlPresent: Boolean(url),
      livekitApiKeyPresent: Boolean(apiKey),
      livekitApiSecretPresent: Boolean(apiSecret)
    })
  }
  return { url, apiKey, apiSecret }
}

function sanitizeCoverArtURL(value = '') {
  const url = cleanString(value, 1000)
  if (!url) return ''
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:') return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

async function loadAccount(uid) {
  const [userSnap, profileSnap, accountPermissions] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('profiles').doc(uid).get(),
    resolvePermissionsForUid(uid).catch(() => null)
  ])
  return {
    user: userSnap.exists ? userSnap.data() || {} : null,
    profile: profileSnap.exists ? profileSnap.data() || {} : null,
    accountPermissions
  }
}

function assertEligible({ auth, user, profile, accountPermissions }) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to go live.')
  if (auth.token.email && auth.token.email_verified === false) {
    throw new HttpsError('failed-precondition', 'Verify your email before going live.')
  }
  if (!user || !profile) throw new HttpsError('failed-precondition', 'Complete your Melogic profile before going live.')
  if (user.suspended === true || profile.suspended === true || user.accountStatus === 'suspended' || profile.accountStatus === 'suspended') {
    throw new HttpsError('permission-denied', 'This account cannot start live streams.')
  }
  if (user.liveStreamingStatus === 'suspended' || user.liveStreamingStatus === 'disabled') {
    throw new HttpsError('permission-denied', 'Live streaming is disabled for this account.')
  }
  if (accountPermissions?.restrictions?.liveSuspended === true || accountPermissions?.restrictions?.musicRestricted === true || accountPermissions?.restrictions?.suspended === true) {
    throw new HttpsError('permission-denied', 'Live streaming is disabled for this account.')
  }
  const role = accountRole(user, profile)
  const roleLabel = cleanString(user.roleLabel || profile.roleLabel || '', 40).toLowerCase()
  const eligible = accountPermissions?.permissions?.musicLive === true || user.musicLiveEnabled === true || profile.musicLiveEnabled === true || ELIGIBLE_ROLES.has(role) || ELIGIBLE_ROLES.has(roleLabel)
  if (!eligible) throw new HttpsError('permission-denied', 'Live streaming is currently limited to eligible creators.')
}

function assertCanChat({ auth, user, profile, accountPermissions }) {
  if (!auth) throw new HttpsError('unauthenticated', 'Sign in to join live chat.')
  if (auth.token.email && auth.token.email_verified === false) {
    throw new HttpsError('failed-precondition', 'Verify your email before joining live chat.')
  }
  if (user?.suspended === true || profile?.suspended === true || user?.accountStatus === 'suspended' || profile?.accountStatus === 'suspended') {
    throw new HttpsError('permission-denied', 'This account cannot use live chat.')
  }
  const permissions = accountPermissions?.permissions || {}
  const restrictions = accountPermissions?.restrictions || {}
  if (accountPermissions?.suspended === true || restrictions.suspended === true || restrictions.communityRestricted === true || restrictions.musicRestricted === true) {
    throw new HttpsError('permission-denied', 'Live chat is restricted for this account.')
  }
  if (permissions.musicLiveChat === false || permissions.communityMessage === false || permissions.communityPost === false) {
    throw new HttpsError('permission-denied', 'Live chat is restricted for this account.')
  }
}

async function createLiveKitJwt({ identity, name, roomName, role, canPublish, config }) {
  const token = new AccessToken(
    config.apiKey,
    config.apiSecret,
    {
      identity,
      name,
      metadata: safeJson({ source: 'melogic-music-live', role })
    }
  )

  token.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish,
    canSubscribe: true,
    canPublishData: false,
    canPublishSources: canPublish ? [TrackSource.MICROPHONE] : []
  })

  return token.toJwt()
}

const startMusicLiveStream = onCall(
  {
    region: 'us-central1',
    secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET],
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    let stage = 'auth received'
    let streamRef = null
    try {
      const uid = request.auth?.uid
      liveLog(stage, { uidPresent: Boolean(uid) })
      if (!uid) throw new HttpsError('unauthenticated', 'Sign in to go live.', { stage })

      stage = 'eligibility loaded'
      const { user, profile, accountPermissions } = await loadAccount(uid)
      liveLog(stage, { uid, permissionsSource: accountPermissions?.source || 'unknown' })

      stage = 'eligibility check'
      assertEligible({ auth: request.auth, user, profile, accountPermissions })
      liveLog('eligibility passed', { uid })

      stage = 'payload validated'
      const title = cleanString(request.data?.title, 90)
      const description = cleanString(request.data?.description, 1200)
      const category = ALLOWED_CATEGORIES.has(request.data?.category) ? request.data.category : 'music'
      const visibility = ALLOWED_VISIBILITIES.has(request.data?.visibility) ? request.data.visibility : 'public'
      const coverArtPath = cleanString(request.data?.coverArtPath, 500)
      const coverArtURL = sanitizeCoverArtURL(request.data?.coverArtURL)
      const tags = toTags(request.data?.tags)
      const audioMode = normalizeAudioMode(request.data?.audioMode)
      if (title.length < 3) throw new HttpsError('invalid-argument', 'Stream title must be at least 3 characters.', { stage })
      if (request.data?.rightsAccepted !== true) throw new HttpsError('failed-precondition', 'You must accept the live stream rules before going live.', { stage })
      liveLog(stage, { uid, category, visibility, audioMode, hasCoverArtURL: Boolean(coverArtURL) })

      stage = 'active stream check started'
      const maxActiveStreams = liveStreamLimitForHost({ user, profile, accountPermissions, auth: request.auth })
      const [liveActive, startingActive] = await Promise.all([
        db().collection('musicLiveStreams').where('hostUid', '==', uid).where('status', '==', 'live').limit(maxActiveStreams + 5).get(),
        db().collection('musicLiveStreams').where('hostUid', '==', uid).where('status', '==', 'starting').limit(maxActiveStreams + 5).get()
      ])
      const freshLive = liveActive.docs.filter((docSnap) => {
        const stream = docSnap.data() || {}
        return stream.hostConnected === true && stream.audioPublished === true && isHeartbeatFresh(stream)
      })
      const staleLive = liveActive.docs.filter((docSnap) => !freshLive.includes(docSnap))
      const freshStarting = startingActive.docs.filter((docSnap) => {
        const started = docSnap.data()?.createdAt?.toMillis?.() || docSnap.data()?.updatedAt?.toMillis?.() || 0
        return started && Date.now() - started < STARTING_TIMEOUT_MS
      })
      const staleStarting = startingActive.docs.filter((docSnap) => !freshStarting.includes(docSnap))
      const cleanupNow = admin.firestore.FieldValue.serverTimestamp()
      await Promise.all([
        ...staleLive.map((docSnap) => docSnap.ref.set({
          status: 'ended',
          connectionStatus: 'stale',
          hostConnected: false,
          audioPublished: false,
          endedAt: cleanupNow,
          endReason: 'heartbeat_stale',
          updatedAt: cleanupNow,
          listenerCount: 0
        }, { merge: true })),
        ...staleStarting.map((docSnap) => docSnap.ref.set({
          status: 'error',
          connectionStatus: 'error',
          errorReason: 'starting_timeout',
          updatedAt: cleanupNow
        }, { merge: true }))
      ])
      const activeStreamCount = freshLive.length + freshStarting.length
      liveLog('active stream check completed', {
        uid,
        maxActiveStreams,
        activeStreamCount,
        freshLiveCount: freshLive.length,
        freshStartingCount: freshStarting.length,
        staleLiveCount: staleLive.length,
        staleStartingCount: staleStarting.length
      })
      if (activeStreamCount >= maxActiveStreams) {
        throw new HttpsError('resource-exhausted', 'You have reached your active live stream limit. End one stream before starting another.', {
          stage,
          activeStreamCount,
          maxActiveStreams
        })
      }

      stage = 'LiveKit config validated'
      const config = livekitConfig(stage)

      stage = 'stream doc id generated'
      streamRef = db().collection('musicLiveStreams').doc()
      const streamId = streamRef.id
      const roomName = cleanRoomName(`music-live-${streamId}`)
      liveLog(stage, { uid, streamId, roomName })

      const hostDisplayName = cleanString(profile.displayName || user.displayName || request.auth.token.name || 'Melogic Creator', 80)
      const hostPhotoURL = cleanString(profile.avatarURL || user.photoURL || request.auth.token.picture || '', 1000)

      stage = 'host token creation started'
      const hostToken = await createLiveKitJwt({
        identity: `host-${uid}`,
        name: hostDisplayName,
        roomName,
        role: 'host',
        canPublish: true,
        config
      })
      liveLog('host token creation completed', { uid, streamId, tokenPresent: Boolean(hostToken) })

      stage = 'Firestore stream document created'
      const now = admin.firestore.FieldValue.serverTimestamp()
      await streamRef.set({
        streamId,
        hostUid: uid,
        hostDisplayName,
        hostPhotoURL,
        title,
        description,
        category,
        tags,
        coverArtPath,
        coverArtURL,
        status: 'starting',
        connectionStatus: 'starting',
        visibility,
        audioMode,
        audioProfile: audioMode === 'music' ? 'high_quality_music' : 'podcast_voice',
        audioOnly: true,
        videoEnabled: false,
        hostConnected: false,
        audioPublished: false,
        roomName,
        livekitRoomName: roomName,
        livekitRoomSid: '',
        startedAt: null,
        endedAt: null,
        createdAt: now,
        updatedAt: now,
        lastHostHeartbeatAt: null,
        listenerCount: 0,
        peakListenerCount: 0,
        isRecordable: false,
        archiveRequested: false,
        archiveStatus: 'none',
        archiveNote: 'Live audio uses WebRTC Opus compression. Future high-quality replays should use LiveKit Egress, a server recording pipeline, or a separate mastered upload.',
        archiveTrackPath: '',
        archiveTrackURL: '',
        moderationStatus: 'clear',
        reportCount: 0
      })
      liveLog(stage, { uid, streamId, status: 'starting' })

      liveLog('response returned', { uid, streamId })
      return {
        ok: true,
        streamId,
        roomName,
        livekitRoomName: roomName,
        hostToken,
        url: config.url,
        listenerURL: `/music/live/${streamId}`
      }
    } catch (error) {
      liveWarn('error stage', {
        stage,
        code: error?.code || 'internal',
        message: error?.message || 'Unknown live stream error',
        hasStreamRef: Boolean(streamRef)
      })
      if (streamRef) {
        await streamRef.set({
          status: 'error',
          connectionStatus: 'error',
          errorStage: stage,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true }).catch((writeError) => liveWarn('error cleanup failed', { message: writeError?.message || String(writeError) }))
      }
      if (error instanceof HttpsError) throw error
      throw new HttpsError('internal', 'Unable to start stream. Please try again. If this keeps happening, contact support.', { stage })
    }
  }
)

const markMusicLiveStreamOnAir = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to mark a stream live.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can mark this stream live.')
  if (!['starting', 'live'].includes(stream.status)) throw new HttpsError('failed-precondition', 'This stream cannot be marked live.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  await streamRef.set({
    status: 'live',
    connectionStatus: 'live',
    hostConnected: true,
    audioPublished: true,
    startedAt: stream.startedAt || now,
    updatedAt: now,
    lastHostHeartbeatAt: now
  }, { merge: true })

  liveLog('stream marked live', { uid, streamId })
  return { ok: true, streamId, status: 'live' }
})

const heartbeatMusicLiveStream = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to heartbeat a stream.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can heartbeat this stream.')
  if (!['starting', 'live'].includes(stream.status)) throw new HttpsError('failed-precondition', 'This stream is no longer active.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  await streamRef.set({
    connectionStatus: request.data?.connectionStatus === 'reconnecting' ? 'reconnecting' : 'live',
    hostConnected: true,
    audioPublished: request.data?.audioPublished === false ? false : true,
    lastHostHeartbeatAt: now,
    updatedAt: now
  }, { merge: true })

  return { ok: true, streamId }
})

const updateMusicLiveStreamInfo = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to update live stream info.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  const adminAuth = isAdminAuth(request.auth)
  if (stream.hostUid !== uid && !adminAuth) throw new HttpsError('permission-denied', 'Only the host can update this stream.')
  if (stream.status === 'ended' && !adminAuth) throw new HttpsError('failed-precondition', 'Ended streams cannot be edited.')

  const metadata = cleanStreamMetadata(request.data || {})
  if (metadata.title.length < 3) throw new HttpsError('invalid-argument', 'Stream title must be at least 3 characters.')
  const now = admin.firestore.FieldValue.serverTimestamp()
  await streamRef.set({
    ...metadata,
    updatedAt: now,
    lastMetadataUpdateAt: now
  }, { merge: true })

  return { ok: true, streamId, ...metadata }
})

async function endStreamByHost({ uid, streamId, reason = 'host_ended' }) {
  const cleanStreamId = cleanString(streamId, 120)
  if (!cleanStreamId || cleanStreamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(cleanStreamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can end this stream.')

  const now = admin.firestore.FieldValue.serverTimestamp()
  await streamRef.set({
    status: 'ended',
    connectionStatus: reason === 'host_unload' || reason === 'host_pagehide' ? 'host_disconnected' : 'ended',
    hostConnected: false,
    audioPublished: false,
    endedAt: now,
    endReason: cleanString(reason, 80) || 'host_ended',
    updatedAt: now,
    listenerCount: 0
  }, { merge: true })

  return { ok: true, streamId: cleanStreamId, status: 'ended' }
}

const joinMusicLiveStream = onCall(
  {
    region: 'us-central1',
    secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET],
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
    const streamId = cleanString(request.data?.streamId, 120)
    if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
    const streamRef = db().collection('musicLiveStreams').doc(streamId)
    const snap = await streamRef.get()
    if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
    const stream = snap.data() || {}
    if (stream.status !== 'live') throw new HttpsError('failed-precondition', 'This stream is not live.')
    if (stream.visibility === 'private') throw new HttpsError('permission-denied', 'This stream is private.')
    if (stream.hostConnected !== true || stream.audioPublished !== true || !isHeartbeatFresh(stream)) {
      await streamRef.set({
        status: 'ended',
        connectionStatus: 'stale',
        hostConnected: false,
        audioPublished: false,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endReason: 'heartbeat_stale',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        listenerCount: 0
      }, { merge: true })
      throw new HttpsError('failed-precondition', 'This stream has ended.')
    }
    if (!stream.livekitRoomName && !stream.roomName) throw new HttpsError('failed-precondition', 'This stream is missing its live room.')

    const uid = request.auth?.uid || ''
    const identity = uid ? `listener-${uid}` : `listener-anon-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const name = cleanString(request.auth?.token?.name || request.auth?.token?.email || 'Melogic Listener', 80)
    const roomName = cleanRoomName(stream.livekitRoomName || stream.roomName)

    const listenerToken = await createLiveKitJwt({
      identity,
      name,
      roomName,
      role: 'listener',
      canPublish: false,
      config: livekitConfig('listener LiveKit config validated')
    })

    await streamRef.set({
      listenerCount: admin.firestore.FieldValue.increment(1),
      peakListenerCount: Math.max(Number(stream.peakListenerCount || 0), Number(stream.listenerCount || 0) + 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })

    return {
      ok: true,
      streamId,
      roomName,
      listenerToken,
      token: listenerToken,
      url: LIVEKIT_URL.value(),
      identity
    }
  }
)

const endMusicLiveStream = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to end a live stream.')
  const streamId = cleanString(request.data?.streamId, 120)
  return endStreamByHost({ uid, streamId, reason: cleanString(request.data?.reason, 80) || 'host_ended' })
})

function parseBeaconBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try {
      return JSON.parse(req.body.toString('utf8'))
    } catch {
      return {}
    }
  }
  if (req.body && typeof req.body === 'object') return req.body
  const raw = req.rawBody ? req.rawBody.toString('utf8') : ''
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const endMusicLiveStreamBeacon = onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.status(204).send('')
    return
  }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'method-not-allowed' })
    return
  }
  try {
    const body = parseBeaconBody(req)
    const authHeader = cleanString(req.headers.authorization || '', 2000)
    const idToken = cleanString(authHeader.replace(/^Bearer\s+/i, '') || body.idToken, 2000)
    const decoded = await admin.auth().verifyIdToken(idToken)
    await endStreamByHost({
      uid: decoded.uid,
      streamId: body.streamId,
      reason: cleanString(body.reason, 80) || 'host_unload'
    })
    res.status(200).json({ ok: true })
  } catch (error) {
    liveWarn('beacon end failed', { code: error?.code || 'internal', message: error?.message || String(error) })
    res.status(200).json({ ok: false })
  }
})

const sendMusicLiveChatMessage = onCall({ region: 'us-central1' }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to join live chat.')
  const streamId = cleanString(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const text = cleanString(request.data?.text, CHAT_TEXT_MAX_LENGTH)
  if (!text) throw new HttpsError('invalid-argument', 'Message text is required.')

  const [{ user, profile, accountPermissions }, streamSnap] = await Promise.all([
    loadAccount(uid),
    db().collection('musicLiveStreams').doc(streamId).get()
  ])
  assertCanChat({ auth: request.auth, user, profile, accountPermissions })
  if (!streamSnap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = streamSnap.data() || {}
  if (stream.status !== 'live' || !['public', 'unlisted'].includes(stream.visibility)) {
    throw new HttpsError('failed-precondition', 'This live chat is closed.')
  }
  if (stream.hostConnected !== true || stream.audioPublished !== true || !isHeartbeatFresh(stream)) {
    throw new HttpsError('failed-precondition', 'This live chat is closed.')
  }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const messageRef = db().collection('musicLiveStreams').doc(streamId).collection('chatMessages').doc()
  const displayName = cleanString(profile?.displayName || user?.displayName || request.auth.token.name || 'Melogic Listener', 80)
  const photoURL = cleanString(profile?.avatarURL || user?.photoURL || request.auth.token.picture || '', 1000)
  const message = {
    messageId: messageRef.id,
    streamId,
    uid,
    displayName,
    photoURL,
    text,
    createdAt: now,
    status: 'visible',
    moderationFlags: []
  }
  await messageRef.set(message)
  return { ok: true, messageId: messageRef.id }
})

module.exports = {
  startMusicLiveStream,
  markMusicLiveStreamOnAir,
  heartbeatMusicLiveStream,
  updateMusicLiveStreamInfo,
  joinMusicLiveStream,
  endMusicLiveStream,
  endMusicLiveStreamBeacon,
  sendMusicLiveChatMessage
}
