import { buildHlsPlaybackUrl as buildEdgePlaybackUrl, sanitizeHlsStreamKey } from './hlsEdgePlayer'

const DEFAULT_BROWSER_WHIP_INGEST_URL = 'https://ingest.melogicrecords.studio/rtc/v1/whip/?app=live&stream={streamKey}&eip=104.197.179.248'
const CONNECTION_TIMEOUT_MS = 15000
const FETCH_TIMEOUT_MS = 15000

let activeSession = null

function configuredEndpoint() {
  return String(import.meta.env?.VITE_BROWSER_WEBRTC_INGEST_URL || DEFAULT_BROWSER_WHIP_INGEST_URL).trim()
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
    iceGatheringState: peerConnection?.iceGatheringState || 'complete',
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

function whipTransportReady(peerConnection) {
  return peerConnection.connectionState === 'connected'
    || ['checking', 'connected', 'completed'].includes(peerConnection.iceConnectionState)
}

function waitForConnection(peerConnection, mediaStream, emitStatus) {
  if (whipTransportReady(peerConnection)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => finish(new Error('Browser WebRTC ingest connection timed out.')), CONNECTION_TIMEOUT_MS)
    function finish(error) {
      window.clearTimeout(timeout)
      peerConnection.removeEventListener('connectionstatechange', onChange)
      peerConnection.removeEventListener('iceconnectionstatechange', onChange)
      if (error) reject(error)
      else resolve()
    }
    function onChange() {
      emitStatus(peerConnection.connectionState, connectionDiagnostics(peerConnection, mediaStream))
      if (whipTransportReady(peerConnection)) finish()
      else if (['failed', 'closed'].includes(peerConnection.connectionState) || peerConnection.iceConnectionState === 'failed') {
        finish(new Error(`Browser WebRTC ingest connection ${peerConnection.connectionState}.`))
      }
    }
    peerConnection.addEventListener('connectionstatechange', onChange)
    peerConnection.addEventListener('iceconnectionstatechange', onChange)
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
    if (!hasPlaceholder) url.searchParams.set('stream', cleanKey)
    if (!url.searchParams.get('app')) url.searchParams.set('app', 'live')
    if (!url.searchParams.get('eip')) url.searchParams.set('eip', '104.197.179.248')
    return url.toString()
  } catch {
    return ''
  }
}

export function isBrowserWebrtcIngestConfigured() {
  return Boolean(buildBrowserWebrtcIngestUrl('mystream'))
}

export async function testBrowserWebrtcIngestReachability({ streamKey = '', timeoutMs = 8000 } = {}) {
  const endpoint = buildBrowserWebrtcIngestUrl(streamKey)
  if (!endpoint) {
    return {
      whipReachable: false,
      whipTestStatus: 'invalid-url',
      lastIngestError: 'Browser streaming could not build the Melogic WHIP ingest URL.'
    }
  }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)
  console.log('[Browser WHIP] reachability test', {
    whipUrl: endpoint,
    origin: window.location.origin,
    method: 'GET',
    credentials: 'omit'
  })
  try {
    const response = await fetch(endpoint, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      signal: controller.signal
    })
    const responseText = await response.text().catch(() => '')
    const diagnostics = {
      whipReachable: true,
      whipTestStatus: 'response-received',
      whipUrl: endpoint,
      ingestEndpointURL: stripEndpointSecrets(endpoint),
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: response.status,
      responseType: response.type,
      responseContentType: response.headers.get('content-type') || '',
      responseBodyPreview: responseText.slice(0, 500),
      corsPreflightStatus: 'A cross-origin response was readable; network and CORS routing are reachable.',
      fetchErrorName: '',
      fetchErrorMessage: '',
      lastIngestError: ''
    }
    console.log('[Browser WHIP] reachability response', diagnostics)
    return diagnostics
  } catch (error) {
    const diagnostics = {
      whipReachable: false,
      whipTestStatus: 'fetch-failed',
      whipUrl: endpoint,
      ingestEndpointURL: stripEndpointSecrets(endpoint),
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: null,
      responseType: '',
      responseBodyPreview: '',
      corsPreflightStatus: 'No response was exposed. This may be CORS/preflight, TLS, DNS, proxy, or firewall failure.',
      fetchErrorName: error?.name || 'Error',
      fetchErrorMessage: error?.message || String(error),
      lastIngestError: error?.name === 'AbortError' ? 'Browser ingest reachability test timed out.' : error?.message || String(error)
    }
    console.warn('[Browser WHIP] reachability failed', diagnostics)
    return diagnostics
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function startBrowserWebrtcIngest({ streamId = '', streamKey, mediaStream, onStatus = () => {}, onError = () => {} } = {}) {
  const endpoint = buildBrowserWebrtcIngestUrl(streamKey)
  const hasProgramStream = typeof MediaStream !== 'undefined' && mediaStream instanceof MediaStream
  const trackCount = hasProgramStream ? mediaStream.getTracks().length : 0
  console.log('[Browser WHIP] config', {
    streamId,
    streamKey: sanitizeStreamKey(streamKey),
    whipUrl: endpoint,
    origin: window.location.origin,
    hasProgramStream,
    trackCount,
    audioTrackCount: hasProgramStream ? mediaStream.getAudioTracks().length : 0,
    videoTrackCount: hasProgramStream ? mediaStream.getVideoTracks().length : 0
  })
  if (!configuredEndpoint() || !isBrowserWebrtcIngestConfigured() || !endpoint) {
    throw new Error('Browser streaming could not build the Melogic WHIP ingest URL.')
  }
  if (typeof RTCPeerConnection === 'undefined') throw new Error('This browser does not support WebRTC ingest.')
  if (!hasProgramStream || trackCount === 0) throw new Error('Browser WebRTC ingest requires the Studio Program media stream.')
  await stopBrowserWebrtcIngest()

  const safeEndpoint = stripEndpointSecrets(endpoint)
  const peerConnection = new RTCPeerConnection()
  const session = { peerConnection, mediaStream, resourceUrl: '', endpoint, stopped: false, connected: false }
  activeSession = session
  mediaStream.getTracks().forEach((track) => peerConnection.addTrack(track, mediaStream))
  const emitStatus = (status, extra = {}) => onStatus({
    status,
    connectionState: peerConnection.connectionState,
    ingestEndpointURL: safeEndpoint,
    ...connectionDiagnostics(peerConnection, mediaStream, extra)
  })
  const emitCurrentState = (event) => {
    console.log('[Browser WHIP] state', {
      event: event?.type || 'statechange',
      iceGatheringState: peerConnection.iceGatheringState,
      iceConnectionState: peerConnection.iceConnectionState,
      connectionState: peerConnection.connectionState,
      signalingState: peerConnection.signalingState
    })
    emitStatus(peerConnection.connectionState)
    if (session.connected && peerConnection.connectionState === 'failed' && activeSession === session) {
      session.connected = false
      const error = new Error('Browser WebRTC ingest connection failed.')
      onError(error, connectionDiagnostics(peerConnection, mediaStream, { lastIngestError: error.message }))
      void stopBrowserWebrtcIngest()
    }
  }
  session.emitStatus = emitStatus
  peerConnection.addEventListener('connectionstatechange', emitCurrentState)
  peerConnection.addEventListener('iceconnectionstatechange', emitCurrentState)
  peerConnection.addEventListener('icegatheringstatechange', emitCurrentState)
  peerConnection.addEventListener('signalingstatechange', emitCurrentState)

  let offerSdpLength = 0
  let answerSdpLength = 0
  let responseStatus = null
  let responseType = ''
  let responseContentType = ''
  let responseBodyPreview = ''
  let corsPreflightStatus = 'Browser-managed; waiting for a fetch result.'
  let fetchErrorName = ''
  let fetchErrorMessage = ''
  try {
    emitStatus('new', { localOfferCreated: false, remoteAnswerSet: false })
    const offer = await peerConnection.createOffer()
    await peerConnection.setLocalDescription(offer)
    emitStatus('connecting', { localOfferCreated: true, remoteAnswerSet: false })
    await waitForIceGathering(peerConnection)
    const localOfferSdp = peerConnection.localDescription?.sdp || offer.sdp || ''
    offerSdpLength = localOfferSdp.length
    console.log('[Browser WHIP] local offer created', {
      sdpLength: offerSdpLength,
      iceGatheringState: peerConnection.iceGatheringState,
      signalingState: peerConnection.signalingState
    })
    let response
    const controller = new AbortController()
    const fetchTimeout = window.setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/sdp' },
        body: localOfferSdp,
        mode: 'cors',
        credentials: 'omit',
        signal: controller.signal
      })
    } catch (fetchError) {
      fetchErrorName = fetchError?.name || 'Error'
      fetchErrorMessage = fetchError?.message || String(fetchError)
      corsPreflightStatus = 'No response was exposed. This may be CORS/preflight, TLS, DNS, proxy, or firewall failure.'
      const error = new Error('Browser streaming could not connect to the Melogic ingest server.')
      error.cause = fetchError
      error.whipDiagnostics = connectionDiagnostics(peerConnection, mediaStream, {
        whipUrl: endpoint,
        ingestUrlHost: new URL(endpoint).host,
        responseStatus: null,
        responseType: '',
        responseBodyPreview: '',
        offerSdpLength,
        answerSdpLength: 0,
        fetchErrorName,
        fetchErrorMessage,
        corsPreflightStatus,
        networkHint: 'Check ingest TLS, CORS, firewall access, and the SRS WHIP listener.',
        lastIngestError: fetchErrorMessage
      })
      throw error
    } finally {
      window.clearTimeout(fetchTimeout)
    }
    responseStatus = response.status
    responseType = response.type
    responseContentType = response.headers.get('content-type') || ''
    const answerSdp = await response.text()
    answerSdpLength = answerSdp.length
    responseBodyPreview = answerSdp.slice(0, 500)
    corsPreflightStatus = 'A POST response was exposed; CORS/preflight and HTTPS routing completed.'
    console.log('[Browser WHIP] fetch response', {
      status: response.status,
      ok: response.ok,
      type: response.type,
      contentType: response.headers.get('content-type')
    })
    if (!response.ok) {
      const error = new Error('Browser streaming could not connect to the Melogic ingest server.')
      error.whipDiagnostics = connectionDiagnostics(peerConnection, mediaStream, {
        whipUrl: endpoint,
        ingestUrlHost: new URL(endpoint).host,
        responseStatus: response.status,
        responseType,
        responseContentType,
        responseBodyPreview,
        offerSdpLength,
        answerSdpLength,
        fetchErrorName: '',
        fetchErrorMessage: '',
        corsPreflightStatus,
        lastIngestError: `WHIP negotiation returned HTTP ${response.status}: ${responseBodyPreview || 'empty response body'}`
      })
      throw error
    }
    if (!answerSdp.trim()) {
      const error = new Error('Browser WebRTC ingest server returned an empty SDP answer.')
      error.whipDiagnostics = { responseStatus, responseType, responseContentType, responseBodyPreview, offerSdpLength, answerSdpLength, corsPreflightStatus }
      throw error
    }
    const location = response.headers.get('Location')
    session.resourceUrl = location ? new URL(location, endpoint).toString() : ''
    const answer = typeof RTCSessionDescription === 'function'
      ? new RTCSessionDescription({ type: 'answer', sdp: answerSdp })
      : { type: 'answer', sdp: answerSdp }
    await peerConnection.setRemoteDescription(answer)
    console.log('[Browser WHIP] remote answer applied', {
      answerLength: answerSdp.length,
      iceConnectionState: peerConnection.iceConnectionState,
      connectionState: peerConnection.connectionState,
      signalingState: peerConnection.signalingState
    })
    emitStatus('connecting', { localOfferCreated: true, remoteAnswerSet: true, offerSdpLength, answerSdpLength })
    await waitForConnection(peerConnection, mediaStream, emitStatus)
    if (session.stopped || activeSession !== session) throw new Error('Browser WebRTC ingest was stopped.')
    session.connected = true
    const diagnostics = connectionDiagnostics(peerConnection, mediaStream, {
      localOfferCreated: true,
      remoteAnswerSet: true,
      whipUrl: endpoint,
      ingestUrlHost: new URL(endpoint).host,
      responseStatus: response.status,
      responseType,
      responseContentType,
      responseBodyPreview: '',
      offerSdpLength,
      answerSdpLength,
      fetchErrorName: '',
      fetchErrorMessage: '',
      corsPreflightStatus,
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
    const diagnostics = {
      ...connectionDiagnostics(peerConnection, mediaStream, {
        localOfferCreated: Boolean(peerConnection.localDescription?.sdp),
        remoteAnswerSet: Boolean(peerConnection.remoteDescription?.sdp),
        whipUrl: endpoint,
        ingestUrlHost: new URL(endpoint).host,
        responseStatus,
        responseType,
        responseContentType,
        responseBodyPreview,
        offerSdpLength,
        answerSdpLength,
        fetchErrorName,
        fetchErrorMessage,
        corsPreflightStatus,
        lastIngestError: error?.message || String(error)
      }),
      ...(error?.whipDiagnostics || {})
    }
    error.whipDiagnostics = diagnostics
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
