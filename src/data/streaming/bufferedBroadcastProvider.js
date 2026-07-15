import { buildHlsPlaybackUrl, resolveHlsPlaybackUrl } from './hlsEdgePlayer'
import { buildProviderDiagnostics, providerCapabilities, STREAM_PROVIDERS } from './streamingProviderTypes'

export function createBufferedBroadcastProvider() {
  let diagnostics = buildProviderDiagnostics({
    provider: STREAM_PROVIDERS.hlsEdge,
    connectionState: 'configured',
    lastMediaEvent: 'hls-edge-ready'
  })

  return {
    id: STREAM_PROVIDERS.hlsEdge,
    label: 'Melogic Edge',
    description: 'Buffered HLS playback from Melogic Edge.',
    transportProvider: 'hls-edge',
    ingestMode: 'rtmp-obs',
    playbackMode: 'hls',
    latencyProfile: 'buffered',
    configured: true,
    defaultPublicPlayback: true,
    capabilities: providerCapabilities(STREAM_PROVIDERS.hlsEdge),
    createStreamSession(options = {}) {
      const streamKey = String(options.streamKey || 'mystream')
      const hlsPlaybackUrl = buildHlsPlaybackUrl(streamKey)
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.hlsEdge,
        connectionState: 'session-ready',
        lastMediaEvent: 'hls-edge-session-ready'
      })
      return { ok: Boolean(hlsPlaybackUrl), provider: STREAM_PROVIDERS.hlsEdge, streamKey, hlsPlaybackUrl, diagnostics }
    },
    getPlaybackInfo(streamDoc = {}) {
      const url = resolveHlsPlaybackUrl(streamDoc)
      return {
        provider: STREAM_PROVIDERS.hlsEdge,
        transportProvider: 'hls-edge',
        ingestMode: 'rtmp-obs',
        playbackMode: 'hls',
        latencyProfile: 'buffered',
        playable: Boolean(streamDoc.status === 'live' && url),
        url
      }
    },
    async stopPublishing() {
      diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.hlsEdge, connectionState: 'stopped', lastMediaEvent: 'stopped' })
      return { ok: true, diagnostics }
    },
    stopStream() {
      return this.stopPublishing()
    },
    getDiagnostics() {
      return diagnostics
    }
  }
}
