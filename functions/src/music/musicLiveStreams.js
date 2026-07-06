const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { AccessToken, TrackSource } = require('livekit-server-sdk')
const { resolvePermissionsForUid } = require('../account/accountPermissions')

const LIVEKIT_URL = defineSecret('LIVEKIT_URL')
const LIVEKIT_API_KEY = defineSecret('LIVEKIT_API_KEY')
const LIVEKIT_API_SECRET = defineSecret('LIVEKIT_API_SECRET')

const ALLOWED_CATEGORIES = new Set(['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other'])
const ALLOWED_VISIBILITIES = new Set(['public', 'unlisted', 'private'])
const ELIGIBLE_ROLES = new Set(['creator', 'artist', 'founder', 'staff', 'admin', 'owner'])
const STARTING_TIMEOUT_MS = 5 * 60 * 1000

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
  const role = cleanString(user.role || user.accountType || profile.roleLabel || '', 40).toLowerCase()
  const roleLabel = cleanString(user.roleLabel || profile.roleLabel || '', 40).toLowerCase()
  const eligible = accountPermissions?.permissions?.musicLive === true || user.musicLiveEnabled === true || profile.musicLiveEnabled === true || ELIGIBLE_ROLES.has(role) || ELIGIBLE_ROLES.has(roleLabel)
  if (!eligible) throw new HttpsError('permission-denied', 'Live streaming is currently limited to eligible creators.')
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
      if (title.length < 3) throw new HttpsError('invalid-argument', 'Stream title must be at least 3 characters.', { stage })
      if (request.data?.rightsAccepted !== true) throw new HttpsError('failed-precondition', 'You must accept the live stream rules before going live.', { stage })
      liveLog(stage, { uid, category, visibility, hasCoverArtURL: Boolean(coverArtURL) })

      stage = 'active stream check started'
      const [liveActive, startingActive] = await Promise.all([
        db().collection('musicLiveStreams').where('hostUid', '==', uid).where('status', '==', 'live').limit(1).get(),
        db().collection('musicLiveStreams').where('hostUid', '==', uid).where('status', '==', 'starting').limit(5).get()
      ])
      const freshStarting = startingActive.docs.filter((docSnap) => {
        const started = docSnap.data()?.createdAt?.toMillis?.() || docSnap.data()?.updatedAt?.toMillis?.() || 0
        return started && Date.now() - started < STARTING_TIMEOUT_MS
      })
      const staleStarting = startingActive.docs.filter((docSnap) => !freshStarting.includes(docSnap))
      await Promise.all(staleStarting.map((docSnap) => docSnap.ref.set({
        status: 'error',
        connectionStatus: 'error',
        errorReason: 'starting_timeout',
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })))
      liveLog('active stream check completed', { uid, liveCount: liveActive.size, freshStartingCount: freshStarting.length, staleStartingCount: staleStarting.length })
      if (!liveActive.empty || freshStarting.length) throw new HttpsError('failed-precondition', 'End your current live stream before starting another.', { stage })

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
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(streamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can end this stream.')

  await streamRef.set({
    status: 'ended',
    connectionStatus: 'ended',
    hostConnected: false,
    audioPublished: false,
    endedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    listenerCount: 0
  }, { merge: true })

  return { ok: true, streamId, status: 'ended' }
})

module.exports = {
  startMusicLiveStream,
  markMusicLiveStreamOnAir,
  joinMusicLiveStream,
  endMusicLiveStream
}
