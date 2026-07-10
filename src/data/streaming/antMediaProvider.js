import { buildProviderDiagnostics, PLAYBACK_MODES, providerCapabilities, STREAM_PROVIDERS } from './streamingProviderTypes'

export function antMediaClientConfig() {
  const publicBaseUrl = String(import.meta.env?.VITE_ANT_MEDIA_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
  const appName = String(import.meta.env?.VITE_ANT_MEDIA_APP_NAME || 'live').replace(/^\/+|\/+$/g, '') || 'live'
  const playbackMode = String(import.meta.env?.VITE_ANT_MEDIA_DEFAULT_PLAYBACK_MODE || PLAYBACK_MODES.hls)
  return {
    provider: STREAM_PROVIDERS.antMedia,
    configured: Boolean(publicBaseUrl && appName),
    publicBaseUrl,
    appName,
    playbackMode: [PLAYBACK_MODES.hls, PLAYBACK_MODES.llhls, PLAYBACK_MODES.webrtc].includes(playbackMode) ? playbackMode : PLAYBACK_MODES.hls
  }
}

export function antMediaPlaybackUrls({ baseUrl = '', appName = 'live', streamId = '' } = {}) {
  const cleanBase = String(baseUrl || '').replace(/\/+$/, '')
  const cleanApp = String(appName || 'live').replace(/^\/+|\/+$/g, '')
  const cleanStream = String(streamId || '').trim()
  if (!cleanBase || !cleanStream) return { hlsUrl: '', llhlsUrl: '', webRtcPlaybackUrl: '' }
  return {
    hlsUrl: `${cleanBase}/${cleanApp}/streams/${encodeURIComponent(cleanStream)}.m3u8`,
    llhlsUrl: `${cleanBase}/${cleanApp}/streams/ll-hls/${encodeURIComponent(cleanStream)}/${encodeURIComponent(cleanStream)}__master.m3u8`,
    webRtcPlaybackUrl: `${cleanBase}/${cleanApp}/play.html?id=${encodeURIComponent(cleanStream)}`
  }
}

export function createAntMediaProvider() {
  const config = antMediaClientConfig()
  let diagnostics = buildProviderDiagnostics({
    provider: STREAM_PROVIDERS.antMedia,
    connectionState: config.configured ? 'configured' : 'unconfigured',
    lastMediaEvent: config.configured ? 'ready' : 'Ant Media is not configured.'
  })

  const unconfigured = () => ({
    ok: false,
    provider: STREAM_PROVIDERS.antMedia,
    reason: config.configured ? 'ant_media_sdk_not_installed' : 'ant_media_not_configured',
    message: config.configured
      ? 'Ant Media SDK publishing is not installed yet.'
      : 'Ant Media is not configured.'
  })

  return {
    id: STREAM_PROVIDERS.antMedia,
    label: 'Ant Media',
    configured: config.configured,
    config,
    capabilities: providerCapabilities(STREAM_PROVIDERS.antMedia),
    createStreamSession(options = {}) {
      if (!config.configured) return unconfigured()
      const streamId = options.antMediaStreamId || `ams_${cryptoSafeId()}`
      const urls = antMediaPlaybackUrls({ baseUrl: config.publicBaseUrl, appName: config.appName, streamId })
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.antMedia,
        roomName: streamId,
        connectionState: 'session-ready',
        lastMediaEvent: 'session-created'
      })
      return { ok: true, provider: STREAM_PROVIDERS.antMedia, antMediaStreamId: streamId, ...urls, diagnostics }
    },
    async startPublishing() {
      return unconfigured()
    },
    async stopPublishing() {
      diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.antMedia, connectionState: 'stopped', lastMediaEvent: 'stopped' })
      return { ok: true, diagnostics }
    },
    async updatePublishedTracks() {
      return unconfigured()
    },
    getPlaybackInfo(streamDoc = {}) {
      const streamId = streamDoc.antMediaStreamId || ''
      const urls = antMediaPlaybackUrls({
        baseUrl: streamDoc.antMediaBaseUrl || config.publicBaseUrl,
        appName: streamDoc.antMediaAppName || config.appName,
        streamId
      })
      return {
        provider: STREAM_PROVIDERS.antMedia,
        playbackMode: streamDoc.playbackMode || config.playbackMode,
        playable: Boolean(streamDoc.status === 'live' && streamId && (urls.hlsUrl || urls.llhlsUrl || urls.webRtcPlaybackUrl)),
        ...urls
      }
    },
    subscribeViewer() {
      return unconfigured()
    },
    disconnectViewer() {
      return { ok: true }
    },
    stopStream() {
      return this.stopPublishing()
    },
    getDiagnostics() {
      return diagnostics
    }
  }
}

function cryptoSafeId() {
  const bytes = new Uint8Array(12)
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes)
  else bytes.forEach((_, index) => { bytes[index] = Math.floor(Math.random() * 256) })
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
