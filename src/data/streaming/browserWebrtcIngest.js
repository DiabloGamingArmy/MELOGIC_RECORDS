const CONFIG_ERROR = 'Browser WebRTC ingest endpoint is not configured.'
const CONNECTION_TIMEOUT_MS = 15000

let activeSession = null

function configuredEndpoint() {
  return String(import.meta.env?.VITE_STREAM_WEBRTC_INGEST_URL || '').trim()
}

function resolveEndpoint(streamKey) {
  const configured = configuredEndpoint()
  if (!configured) return ''
  const expanded = configured.includes('{streamKey}')
    ? configured.replaceAll('{streamKey}', encodeURIComponent(streamKey))
    : configured
  const url = new URL(expanded)
  if (!configured.includes('{streamKey}') && !url.searchParams.has('stream')) url.searchParams.set('stream', streamKey)
  return url.toString()
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

function waitForConnection(peerConnection, onStatus) {
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
      const state = peerConnection.connectionState
      onStatus({ status: state, connectionState: state })
      if (state === 'connected') finish()
      else if (['failed', 'closed'].includes(state)) finish(new Error(`Browser WebRTC ingest connection ${state}.`))
    }
    peerConnection.addEventListener('connectionstatechange', onChange)
  })
}

export function isBrowserWebrtcIngestConfigured() {
  if (!configuredEndpoint() || typeof RTCPeerConnection === 'undefined') return false
  try {
    const url = new URL(configuredEndpoint().replaceAll('{streamKey}', 'mystream'))
    return ['http:', 'https:'].includes(url.protocol)
  } catch {
    return false
  }
}

export async function startBrowserWebrtcIngest({ streamKey, mediaStream, onStatus = () => {}, onError = () => {} } = {}) {
  if (!isBrowserWebrtcIngestConfigured()) throw new Error(CONFIG_ERROR)
  if (!(mediaStream instanceof MediaStream) || mediaStream.getTracks().length === 0) {
    throw new Error('Browser WebRTC ingest requires the Studio Program media stream.')
  }
  await stopBrowserWebrtcIngest()

  const endpoint = resolveEndpoint(streamKey)
  const peerConnection = new RTCPeerConnection()
  const session = { peerConnection, resourceUrl: '', endpoint, stopped: false }
  activeSession = session
  mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream))

  try {
    onStatus({ status: 'negotiating', connectionState: peerConnection.connectionState, endpoint })
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
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
    await peerConnection.setRemoteDescription({ type: 'answer', sdp: answerSdp })
    await waitForConnection(peerConnection, onStatus)
    if (session.stopped || activeSession !== session) throw new Error('Browser WebRTC ingest was stopped.')
    onStatus({ status: 'connected', connectionState: peerConnection.connectionState, endpoint })
    return {
      ok: true,
      endpoint,
      connectionState: peerConnection.connectionState,
      audioPublished: mediaStream.getAudioTracks().some((track) => track.readyState === 'live'),
      videoPublished: mediaStream.getVideoTracks().some((track) => track.readyState === 'live')
    }
  } catch (error) {
    onError(error)
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
  if (session.resourceUrl) {
    try {
      await fetch(session.resourceUrl, { method: 'DELETE', keepalive: true })
    } catch (error) {
      console.warn('[browser-webrtc-ingest] resource cleanup failed', error)
    }
  }
}
