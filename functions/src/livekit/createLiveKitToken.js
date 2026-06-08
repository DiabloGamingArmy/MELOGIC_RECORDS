const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')
const { AccessToken } = require('livekit-server-sdk')

const LIVEKIT_URL = defineSecret('LIVEKIT_URL')
const LIVEKIT_API_KEY = defineSecret('LIVEKIT_API_KEY')
const LIVEKIT_API_SECRET = defineSecret('LIVEKIT_API_SECRET')

function cleanRoomName(value) {
  if (typeof value !== 'string') return ''
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 96)
}

function cleanDisplayName(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (!trimmed) return fallback
  return trimmed.slice(0, 80)
}

function safeJson(value) {
  try {
    return JSON.stringify(value)
  } catch {
    return '{}'
  }
}

const createLiveKitToken = onCall(
  {
    region: 'us-central1',
    secrets: [LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'You must be signed in to join a call.')
    }

    const uid = request.auth.uid
    const email = request.auth.token.email || ''
    const fallbackName = email || uid
    const displayName = cleanDisplayName(request.data?.displayName, fallbackName)

    const requestedRoom = cleanRoomName(request.data?.roomName)
    const roomName = requestedRoom || `support-${uid}`

    const participantRole =
      typeof request.data?.role === 'string'
        ? request.data.role.trim().toLowerCase().slice(0, 32)
        : 'caller'

    const token = new AccessToken(
      LIVEKIT_API_KEY.value(),
      LIVEKIT_API_SECRET.value(),
      {
        identity: uid,
        name: displayName,
        metadata: safeJson({
          uid,
          email,
          source: 'melogic-web',
          role: participantRole,
        }),
      }
    )

    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    })

    return {
      url: LIVEKIT_URL.value(),
      token: await token.toJwt(),
      roomName,
      identity: uid,
    }
  }
)

module.exports = {
  createLiveKitToken,
}