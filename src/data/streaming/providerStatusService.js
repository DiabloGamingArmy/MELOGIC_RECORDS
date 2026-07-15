import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/functions'

export function fallbackStreamingProviderStatus(error = null) {
  return {
    ok: false,
    error: error?.message || 'Provider status function unavailable.',
    providers: {
      nativeStreaming: {
        provider: 'nativeStreaming',
        label: 'Native Streaming',
        configured: true,
        ingestMode: 'browser-media-recorder',
        playbackMode: 'firebaseSegments',
        targetLatencyMs: 30000,
        segmentDurationMs: 4000,
        minPlaybackBufferMs: 20000,
        maxPlaybackBufferMs: 60000,
        idleWhenNoListeners: true,
        audioFirst: true,
        videoEnabled: false,
        localFallback: true
      },
      livekit: {
        provider: 'livekit',
        label: 'LiveKit',
        configured: false,
        ingestMode: 'browser-webrtc',
        playbackMode: 'webrtc',
        missingConfigKeys: ['Provider status function unavailable']
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
    console.warn('[streaming] getStreamingProviderStatus unavailable; using local Native Streaming fallback.', error?.message || error)
    return fallbackStreamingProviderStatus(error)
  }
}
