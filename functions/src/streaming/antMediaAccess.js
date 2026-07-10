const admin = require('firebase-admin')
const crypto = require('crypto')
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https')

function db() {
  return admin.firestore()
}

function cleanString(value, max = 240) {
  return String(value || '').trim().slice(0, max)
}

function cleanId(value, max = 160) {
  return cleanString(value, max).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, max)
}

function httpsUrl(value = '') {
  const raw = cleanString(value, 1000)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    return parsed.protocol === 'https:' ? parsed.toString().replace(/\/+$/, '') : ''
  } catch {
    return ''
  }
}

function antMediaConfig() {
  return {
    publicBaseUrl: httpsUrl(process.env.ANT_MEDIA_PUBLIC_BASE_URL || ''),
    appName: cleanString(process.env.ANT_MEDIA_APP_NAME || 'live', 120).replace(/^\/+|\/+$/g, '') || 'live',
    webhookSecret: cleanString(process.env.ANT_MEDIA_WEBHOOK_SECRET || '', 500),
    allowedOrigins: String(process.env.ANT_MEDIA_ALLOWED_ORIGINS || '')
      .split(',')
      .map((entry) => entry.trim().replace(/\/+$/, ''))
      .filter(Boolean)
  }
}

function playbackUrls({ publicBaseUrl = '', appName = 'live', streamId = '' } = {}) {
  if (!publicBaseUrl || !streamId) return { hlsUrl: '', llhlsUrl: '', webRtcPlaybackUrl: '' }
  return {
    hlsUrl: `${publicBaseUrl}/${appName}/streams/${encodeURIComponent(streamId)}.m3u8`,
    llhlsUrl: `${publicBaseUrl}/${appName}/streams/ll-hls/${encodeURIComponent(streamId)}/${encodeURIComponent(streamId)}__master.m3u8`,
    webRtcPlaybackUrl: `${publicBaseUrl}/${appName}/play.html?id=${encodeURIComponent(streamId)}`
  }
}

async function assertHostStream({ uid = '', streamId = '' } = {}) {
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage Ant Media access.')
  const cleanStreamId = cleanId(streamId, 120)
  if (!cleanStreamId || cleanStreamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const streamRef = db().collection('musicLiveStreams').doc(cleanStreamId)
  const snap = await streamRef.get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.hostUid !== uid) throw new HttpsError('permission-denied', 'Only the host can manage this stream.')
  return { streamRef, stream, streamId: cleanStreamId }
}

function publishUnavailable(config) {
  if (!config.publicBaseUrl) throw new HttpsError('failed-precondition', 'Ant Media public base URL is not configured.')
  throw new HttpsError('failed-precondition', 'Ant Media browser publishing is not enabled in this build.')
}

const createAntMediaStreamSession = onCall({ region: 'us-central1' }, async (request) => {
  const { streamRef, streamId } = await assertHostStream({ uid: request.auth?.uid, streamId: request.data?.streamId })
  const config = antMediaConfig()
  const antMediaStreamId = cleanId(request.data?.antMediaStreamId, 160) || `ams_${crypto.randomBytes(12).toString('hex')}`
  const urls = playbackUrls({ publicBaseUrl: config.publicBaseUrl, appName: config.appName, streamId: antMediaStreamId })
  await streamRef.set({
    provider: 'antMedia',
    ingestMode: 'browser-webrtc',
    playbackMode: 'hls',
    antMediaStreamId,
    antMediaAppName: config.appName,
    antMediaBaseUrl: config.publicBaseUrl,
    ...urls,
    providerDiagnostics: {
      connectionState: config.publicBaseUrl ? 'session-created' : 'unconfigured',
      roomName: antMediaStreamId,
      lastMediaEvent: 'ant-media-session-stub'
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  return {
    ok: true,
    provider: 'antMedia',
    streamId,
    antMediaStreamId,
    configured: Boolean(config.publicBaseUrl),
    publishAvailable: false,
    ...urls,
    message: 'Ant Media session metadata is prepared. Browser publishing still requires the server-side adapter.'
  }
})

const getAntMediaPublishAuthorization = onCall({ region: 'us-central1' }, async (request) => {
  await assertHostStream({ uid: request.auth?.uid, streamId: request.data?.streamId })
  return publishUnavailable(antMediaConfig())
})

const getAntMediaPublishToken = getAntMediaPublishAuthorization

const getAntMediaPlaybackAuthorization = onCall({ region: 'us-central1' }, async (request) => {
  const streamId = cleanId(request.data?.streamId, 120)
  if (!streamId || streamId.includes('/')) throw new HttpsError('invalid-argument', 'A valid stream id is required.')
  const snap = await db().collection('musicLiveStreams').doc(streamId).get()
  if (!snap.exists) throw new HttpsError('not-found', 'Live stream not found.')
  const stream = snap.data() || {}
  if (stream.status !== 'live' || stream.visibility === 'private') throw new HttpsError('permission-denied', 'This stream is not public.')
  const config = antMediaConfig()
  const urls = playbackUrls({
    publicBaseUrl: stream.antMediaBaseUrl || config.publicBaseUrl,
    appName: stream.antMediaAppName || config.appName,
    streamId: stream.antMediaStreamId || ''
  })
  return {
    ok: Boolean(urls.hlsUrl),
    provider: 'antMedia',
    playbackMode: stream.playbackMode || 'hls',
    ...urls,
    message: urls.hlsUrl ? 'Playback URLs are available.' : 'Ant Media playback is not configured.'
  }
})

const getAntMediaPlaybackToken = getAntMediaPlaybackAuthorization

const getStreamingProviderStatus = onCall({ region: 'us-central1' }, async () => {
  const config = antMediaConfig()
  const liveKitConfigured = Boolean(process.env.LIVEKIT_URL || process.env.LIVEKIT_API_KEY || process.env.LIVEKIT_API_SECRET)
  return {
    ok: true,
    providers: {
      livekit: {
        provider: 'livekit',
        label: 'LiveKit',
        configured: liveKitConfigured,
        ingestMode: 'browser-webrtc',
        playbackMode: 'webrtc',
        missingConfigKeys: liveKitConfigured ? [] : ['LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET']
      },
      antMedia: {
        provider: 'antMedia',
        label: 'Ant Media',
        configured: Boolean(config.publicBaseUrl),
        ingestMode: 'browser-webrtc-pending',
        playbackMode: 'hls',
        appName: config.appName,
        publicBaseUrl: config.publicBaseUrl,
        missingConfigKeys: config.publicBaseUrl ? [] : ['ANT_MEDIA_PUBLIC_BASE_URL']
      }
    }
  }
})

const stopAntMediaStreamSession = onCall({ region: 'us-central1' }, async (request) => {
  const { streamRef, streamId } = await assertHostStream({ uid: request.auth?.uid, streamId: request.data?.streamId })
  await streamRef.set({
    providerDiagnostics: {
      connectionState: 'stopped',
      lastMediaEvent: 'ant-media-session-stopped'
    },
    videoPublished: false,
    programHasVideo: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  return { ok: true, provider: 'antMedia', streamId, stopped: true }
})

function parseBody(req) {
  if (Buffer.isBuffer(req.body)) {
    try { return JSON.parse(req.body.toString('utf8')) } catch { return {} }
  }
  return req.body && typeof req.body === 'object' ? req.body : {}
}

function webhookAllowed(req) {
  const config = antMediaConfig()
  if (!config.webhookSecret) return false
  const supplied = cleanString(req.headers['x-melogic-antmedia-secret'] || req.headers['x-antmedia-secret'] || '', 500)
  if (supplied !== config.webhookSecret) return false
  const origin = cleanString(req.headers.origin || req.headers.referer || '', 1000).replace(/\/+$/, '')
  if (!config.allowedOrigins.length) return true
  return config.allowedOrigins.some((allowed) => origin.startsWith(allowed))
}

function antMediaWebhookHandler(kind = 'play') {
  return onRequest({ region: 'us-central1', cors: true }, async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.status(204).send('')
      return
    }
    if (req.method !== 'POST') {
      res.status(405).json({ ok: false, error: 'method-not-allowed' })
      return
    }
    const body = parseBody(req)
    const allowed = webhookAllowed(req)
    if (!allowed) {
      res.status(403).json({ ok: false, provider: 'antMedia', kind, error: 'forbidden' })
      return
    }
    res.status(200).json({
      ok: true,
      provider: 'antMedia',
      kind,
      streamId: cleanId(body.streamId || body.id || body.name || '', 160)
    })
  })
}

const antMediaPublishWebhook = antMediaWebhookHandler('publish')
const antMediaPlayWebhook = antMediaWebhookHandler('play')
const antMediaWebhookHealthCheck = onRequest({ region: 'us-central1', cors: true }, (req, res) => {
  const config = antMediaConfig()
  res.status(200).json({
    ok: true,
    provider: 'antMedia',
    configured: Boolean(config.publicBaseUrl),
    webhookProtected: Boolean(config.webhookSecret),
    allowedOriginsConfigured: config.allowedOrigins.length
  })
})

module.exports = {
  createAntMediaStreamSession,
  getAntMediaPublishAuthorization,
  getAntMediaPlaybackAuthorization,
  getAntMediaPublishToken,
  getAntMediaPlaybackToken,
  getStreamingProviderStatus,
  stopAntMediaStreamSession,
  antMediaPublishWebhook,
  antMediaPlayWebhook,
  antMediaWebhookHealthCheck
}
