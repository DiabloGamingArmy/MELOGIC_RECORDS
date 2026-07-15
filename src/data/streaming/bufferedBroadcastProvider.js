import { buildHlsPlaybackUrl, resolveHlsPlaybackUrl } from './hlsEdgePlayer'
import { buildProviderDiagnostics, providerCapabilities, STREAM_PROVIDERS } from './streamingProviderTypes'

export function createBufferedBroadcastProvider() {
  let diagnostics = buildProviderDiagnostics({
    provider: STREAM_PROVIDERS.bufferedBroadcast,
    connectionState: 'configured',
    lastMediaEvent: 'hls-edge-ready'
  })

  return {
    id: STREAM_PROVIDERS.bufferedBroadcast,
    label: 'Buffered Broadcast',
    description: 'Use OBS/RTMP. Smooth HLS playback with 20-30 second delay.',
    transportProvider: 'hls-edge',
    ingestMode: 'rtmp-obs',
    playbackMode: 'hls',
    latencyProfile: 'buffered',
    configured: true,
    defaultPublicPlayback: true,
    capabilities: providerCapabilities(STREAM_PROVIDERS.bufferedBroadcast),
    createStreamSession(options = {}) {
      const streamKey = String(options.streamKey || 'mystream')
      const hlsPlaybackUrl = buildHlsPlaybackUrl(streamKey)
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.bufferedBroadcast,
        connectionState: 'session-ready',
        lastMediaEvent: 'hls-edge-session-ready'
      })
      return { ok: Boolean(hlsPlaybackUrl), provider: STREAM_PROVIDERS.bufferedBroadcast, streamKey, hlsPlaybackUrl, diagnostics }
    },
    getPlaybackInfo(streamDoc = {}) {
      const url = resolveHlsPlaybackUrl(streamDoc)
      return {
        provider: STREAM_PROVIDERS.bufferedBroadcast,
        transportProvider: 'hls-edge',
        ingestMode: 'rtmp-obs',
        playbackMode: 'hls',
        latencyProfile: 'buffered',
        playable: Boolean(streamDoc.status === 'live' && url),
        url
      }
    },
    async stopPublishing() {
      diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.bufferedBroadcast, connectionState: 'stopped', lastMediaEvent: 'stopped' })
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
