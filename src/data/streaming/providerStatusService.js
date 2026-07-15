import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/functions'

export function fallbackStreamingProviderStatus(error = null) {
  return {
    ok: false,
    error: error?.message || 'Provider status function unavailable.',
    providers: {
      hlsEdge: {
        provider: 'hlsEdge',
        label: 'Melogic Edge',
        configured: true,
        transportProvider: 'hls-edge',
        playbackMode: 'hls',
        latencyProfile: 'buffered',
        ingestMethods: ['browserWebrtc', 'obsRtmp'],
        localFallback: true
      }
    }
  }
}

export async function getStreamingProviderStatus() {
  const callable = httpsCallable(functions, 'getStreamingProviderStatus')
  try {
    const result = await callable({})
    return result.data || {}
  } catch (error) {
    console.warn('[streaming] getStreamingProviderStatus unavailable; using local Buffered Broadcast fallback.', error?.message || error)
    return fallbackStreamingProviderStatus(error)
  }
}
