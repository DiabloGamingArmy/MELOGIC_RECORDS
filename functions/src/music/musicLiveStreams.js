const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { AccessToken } = require('livekit-server-sdk')
const { resolvePermissionsForUid } = require('../account/accountPermissions')

const LIVEKIT_URL = defineSecret('LIVEKIT_URL')
const LIVEKIT_API_KEY = defineSecret('LIVEKIT_API_KEY')
const LIVEKIT_API_SECRET = defineSecret('LIVEKIT_API_SECRET')

const ALLOWED_CATEGORIES = new Set(['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other'])
const ALLOWED_VISIBILITIES = new Set(['public', 'unlisted', 'private'])
const ELIGIBLE_ROLES = new Set(['creator', 'artist', 'founder', 'staff', 'admin', 'owner'])

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

async function createLiveKitJwt({ identity, name, roomName, role, canPublish }) {
  const token = new AccessToken(
    LIVEKIT_API_KEY.value(),
    LIVEKIT_API_SECRET.value(),
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
    canPublishSources: canPublish ? ['microphone'] : []
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
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in to go live.')
    const { user, profile, accountPermissions } = await loadAccount(uid)
    assertEligible({ auth: request.auth, user, profile, accountPermissions })

    const title = cleanString(request.data?.title, 90)
    const description = cleanString(request.data?.description, 1200)
    const category = ALLOWED_CATEGORIES.has(request.data?.category) ? request.data.category : 'music'
    const visibility = ALLOWED_VISIBILITIES.has(request.data?.visibility) ? request.data.visibility : 'public'
    const coverArtPath = cleanString(request.data?.coverArtPath, 500)
    const coverArtURL = cleanString(request.data?.coverArtURL, 1000)
    const tags = toTags(request.data?.tags)

    if (title.length < 3) throw new HttpsError('invalid-argument', 'Stream title must be at least 3 characters.')
    if (request.data?.rightsAccepted !== true) throw new HttpsError('failed-precondition', 'You must accept the live stream rules before going live.')

    const active = await db().collection('musicLiveStreams')
      .where('hostUid', '==', uid)
      .where('status', '==', 'live')
      .limit(1)
      .get()
    if (!active.empty) throw new HttpsError('failed-precondition', 'End your current live stream before starting another.')

    const streamRef = db().collection('musicLiveStreams').doc()
    const streamId = streamRef.id
    const roomName = cleanRoomName(`music-live-${streamId}`)
    const now = admin.firestore.FieldValue.serverTimestamp()
    const hostDisplayName = cleanString(profile.displayName || user.displayName || request.auth.token.name || 'Melogic Creator', 80)
    const hostPhotoURL = cleanString(profile.avatarURL || user.photoURL || request.auth.token.picture || '', 1000)

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
      status: 'live',
      visibility,
      audioOnly: true,
      videoEnabled: false,
      roomName,
      livekitRoomName: roomName,
      livekitRoomSid: '',
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
      listenerCount: 0,
      peakListenerCount: 0,
      isRecordable: false,
      archiveRequested: request.data?.archiveRequested === true,
      archiveStatus: request.data?.archiveRequested === true ? 'requested' : 'none',
      archiveTrackPath: '',
      archiveTrackURL: '',
      moderationStatus: 'clear',
      reportCount: 0
    })

    const hostToken = await createLiveKitJwt({
      identity: `host-${uid}`,
      name: hostDisplayName,
      roomName,
      role: 'host',
      canPublish: true
    })

    return {
      ok: true,
      streamId,
      roomName,
      livekitRoomName: roomName,
      hostToken,
      url: LIVEKIT_URL.value(),
      listenerURL: `/music/live/${streamId}`
    }
  }
)

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

    await streamRef.set({
      listenerCount: admin.firestore.FieldValue.increment(1),
      peakListenerCount: Math.max(Number(stream.peakListenerCount || 0), Number(stream.listenerCount || 0) + 1),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })

    const listenerToken = await createLiveKitJwt({
      identity,
      name,
      roomName,
      role: 'listener',
      canPublish: false
    })

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
    endedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    listenerCount: 0
  }, { merge: true })

  return { ok: true, streamId, status: 'ended' }
})

module.exports = {
  startMusicLiveStream,
  joinMusicLiveStream,
  endMusicLiveStream
}
