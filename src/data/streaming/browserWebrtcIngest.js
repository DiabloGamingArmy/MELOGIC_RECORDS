import { buildHlsPlaybackUrl as buildEdgePlaybackUrl, sanitizeHlsStreamKey } from './hlsEdgePlayer'

const CONFIG_ERROR = 'Browser streaming needs the server WebRTC ingest URL configured.'
const CONNECTION_TIMEOUT_MS = 15000

let activeSession = null

function configuredEndpoint() {
  return String(import.meta.env?.VITE_BROWSER_WEBRTC_INGEST_URL || '').trim()
}

function stripEndpointSecrets(value = '') {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const [name] of url.searchParams) {
      if (/(token|secret|signature|authorization|auth|key)/i.test(name)) url.searchParams.set(name, '[redacted]')
    }
    return url.toString()
  } catch {
    return ''
  }
}

function connectionDiagnostics(peerConnection, mediaStream, extra = {}) {
  const audioTrack = mediaStream?.getAudioTracks?.()[0] || null
  const videoTrack = mediaStream?.getVideoTracks?.()[0] || null
  return {
    peerConnectionState: peerConnection?.connectionState || 'closed',
    iceConnectionState: peerConnection?.iceConnectionState || 'closed',
    signalingState: peerConnection?.signalingState || 'closed',
    mediaStreamTrackCount: mediaStream?.getTracks?.().length || 0,
    audioTrackReadyState: audioTrack?.readyState || 'none',
    videoTrackReadyState: videoTrack?.readyState || 'none',
    ...extra
  }
}

function waitForIceGathering(peerConnection) {
  if (peerConnection.iceGatheringState === 'complete') return Promise.resolve()
  return new Promise((resolve) => {
    const timeout = window.setTimeout(done, 8000)
    function done() {
      window.clearTimeout(timeout)
      peerConnection.removeEventListener('icegatheringstatechange', onChange)
      resolve()
    }
    function onChange() {
      if (peerConnection.iceGatheringState === 'complete') done()
    }
    peerConnection.addEventListener('icegatheringstatechange', onChange)
  })
}

function waitForConnection(peerConnection, mediaStream, emitStatus) {
  if (peerConnection.connectionState === 'connected') return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Browser WebRTC ingest connection timed out.')), CONNECTION_TIMEOUT_MS)
    function finish(error) {
      window.clearTimeout(timeout)
      peerConnection.removeEventListener('connectionstatechange', onChange)
      if (error) reject(error)
      else resolve()
    }
    function onChange() {
      emitStatus(peerConnection.connectionState, connectionDiagnostics(peerConnection, mediaStream))
      if (peerConnection.connectionState === 'connected') finish()
      else if (['failed', 'closed'].includes(peerConnection.connectionState)) {
        finish(new Error(`Browser WebRTC ingest connection ${peerConnection.connectionState}.`))
      }
    }
    peerConnection.addEventListener('connectionstatechange', onChange)
  })
}

export function sanitizeStreamKey(streamKey = '') {
  return sanitizeHlsStreamKey(streamKey)
}

export function buildHlsPlaybackUrl(streamKey = '') {
  return buildEdgePlaybackUrl(sanitizeStreamKey(streamKey))
}

export function buildBrowserWebrtcIngestUrl(streamKey = '') {
  const configured = configuredEndpoint()
  const cleanKey = sanitizeStreamKey(streamKey)
  if (!configured || !cleanKey) return ''
  const hasPlaceholder = configured.includes('{streamKey}')
  const expanded = hasPlaceholder
    ? configured.replaceAll('{streamKey}', encodeURIComponent(cleanKey))
    : configured
  try {
    const url = new URL(expanded)
    if (!['http:', 'https:'].includes(url.protocol)) return ''
    if (!hasPlaceholder) url.pathname = `${url.pathname.replace(/\/+$/, '')}/${encodeURIComponent(cleanKey)}`
    return url.toString()
  } catch {
    return ''
  }
}

export function isBrowserWebrtcIngestConfigured() {
  return Boolean(buildBrowserWebrtcIngestUrl('mystream'))
}

export async function startBrowserWebrtcIngest({ streamKey, mediaStream, onStatus = () => {}, onError = () => {} } = {}) {
  if (!configuredEndpoint() || !isBrowserWebrtcIngestConfigured()) throw new Error(CONFIG_ERROR)
  if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support WebRTC ingest.')
  if (!(mediaStream instanceof MediaStream) || mediaStream.getTracks().length === 0) {
    throw new Error('Browser WebRTC ingest requires the Studio Program media stream.')
  }
  await stopBrowserWebrtcIngest()

  const endpoint = buildBrowserWebrtcIngestUrl(streamKey)
  const safeEndpoint = stripEndpointSecrets(endpoint)
  const peerConnection = new RTCPeerConnection()
  const session = { peerConnection, mediaStream, resourceUrl: '', endpoint, stopped: false }
  activeSession = session
  mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream))
  const emitStatus = (status, extra = {}) => onStatus({
    status,
    connectionState: peerConnection.connectionState,
    ingestEndpointURL: safeEndpoint,
    ...connectionDiagnostics(peerConnection, mediaStream, extra)
  })
  const emitCurrentState = () => emitStatus(peerConnection.connectionState)
  session.emitStatus = emitStatus
  peerConnection.addEventListener('connectionstatechange', emitCurrentState)
  peerConnection.addEventListener('iceconnectionstatechange', emitCurrentState)
  peerConnection.addEventListener('signalingstatechange', emitCurrentState)

  try {
    emitStatus('new', { localOfferCreated: false, remoteAnswerSet: false })
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    emitStatus('connecting', { localOfferCreated: true, remoteAnswerSet: false })
    await waitForIceGathering(peerConnection)
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp', Accept: 'application/sdp' },
      body: peerConnection.localDescription?.sdp || offer.sdp
    })
    if (!response.ok) throw new Error(`Browser WebRTC ingest negotiation failed (${response.status}).`)
    const answerSdp = await response.text()
    if (!answerSdp.trim()) throw new Error('Browser WebRTC ingest server returned an empty SDP answer.')
    const location = response.headers.get('Location')
    session.resourceUrl = location ? new URL(location, endpoint).toString() : ''
    const answer = typeof RTCSessionDescription === 'function'
      ? new RTCSessionDescription({ type: 'answer', sdp: answerSdp })
      : { type: 'answer', sdp: answerSdp }
    await peerConnection.setRemoteDescription(answer)
    emitStatus('connecting', { localOfferCreated: true, remoteAnswerSet: true })
    await waitForConnection(peerConnection, mediaStream, emitStatus)
    if (session.stopped || activeSession !== session) throw new Error('Browser WebRTC ingest was stopped.')
    const diagnostics = connectionDiagnostics(peerConnection, mediaStream, {
      localOfferCreated: true,
      remoteAnswerSet: true,
      lastIngestError: ''
    })
    emitStatus('connected', diagnostics)
    return {
      ok: true,
      endpoint,
      ingestEndpointURL: safeEndpoint,
      connectionState: peerConnection.connectionState,
      audioPublished: mediaStream.getAudioTracks().some((track) => track.readyState === 'live'),
      videoPublished: mediaStream.getVideoTracks().some((track) => track.readyState === 'live'),
      diagnostics,
      stop: stopBrowserWebrtcIngest
    }
  } catch (error) {
    const diagnostics = connectionDiagnostics(peerConnection, mediaStream, {
      localOfferCreated: Boolean(peerConnection.localDescription?.sdp),
      remoteAnswerSet: Boolean(peerConnection.remoteDescription?.sdp),
      lastIngestError: error?.message || String(error)
    })
    emitStatus('failed', diagnostics)
    onError(error, diagnostics)
    if (activeSession === session) activeSession = null
    session.stopped = true
    peerConnection.close()
    throw error
  }
}

export async function stopBrowserWebrtcIngest() {
  const session = activeSession
  activeSession = null
  if (!session) return
  session.stopped = true
  session.peerConnection.close()
  session.emitStatus?.('closed')
  if (session.resourceUrl) {
    try {
      await fetch(session.resourceUrl, { method: 'DELETE', keepalive: true })
    } catch (error) {
      console.warn('[browser-webrtc-ingest] resource cleanup failed', error)
    }
  }
}
