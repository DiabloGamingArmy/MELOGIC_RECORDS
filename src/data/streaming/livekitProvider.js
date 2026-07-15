import { Room } from 'livekit-client'
import { buildProviderDiagnostics, providerCapabilities, STREAM_PROVIDERS } from './streamingProviderTypes'

export function validateLiveKitConnectionConfig({ url = '', token = '' } = {}) {
  const cleanUrl = String(url || '').trim()
  const cleanToken = String(token || '').trim()
  const urlValid = /^wss?:\/\//i.test(cleanUrl)
  const errorMessage = !urlValid
    ? 'Website Live requires WebRTC/LiveKit configuration. Use Buffered Broadcast with OBS for now.'
    : !cleanToken
      ? 'Website Live requires WebRTC/LiveKit configuration. Use Buffered Broadcast with OBS for now.'
      : ''
  return {
    url: cleanUrl,
    token: cleanToken,
    urlPresent: Boolean(cleanUrl),
    urlValid,
    tokenPresent: Boolean(cleanToken),
    errorMessage
  }
}

export function assertLiveKitConnectionConfig(config = {}) {
  const result = validateLiveKitConnectionConfig(config)
  if (result.errorMessage) throw new Error(result.errorMessage)
  return result
}

export function createLiveKitProvider() {
  let room = null
  let diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.nativeWeb })

  return {
    id: STREAM_PROVIDERS.nativeWeb,
    label: 'Website Live',
    description: 'Stream directly from this browser. Requires WebRTC provider setup.',
    transportProvider: 'livekit',
    ingestMode: 'browser-webrtc',
    playbackMode: 'webrtc',
    configured: true,
    capabilities: providerCapabilities(STREAM_PROVIDERS.nativeWeb),
    createStreamSession(options = {}) {
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.nativeWeb,
        roomName: options.roomName || options.livekitRoomName || '',
        connectionState: 'session-ready'
      })
      return { ok: true, provider: STREAM_PROVIDERS.nativeWeb, diagnostics }
    },
    async startPublishing({ url = '', token = '', tracks = [], publishOptions = {}, existingRoom = null } = {}) {
      const connection = existingRoom
        ? validateLiveKitConnectionConfig({ url, token })
        : assertLiveKitConnectionConfig({ url, token })
      room = existingRoom || new Room({ adaptiveStream: true, dynacast: true })
      if (!existingRoom) await room.connect(connection.url, connection.token)
      for (const item of tracks.filter(Boolean)) {
        const track = item.track || item
        const options = item.options || publishOptions || {}
        if (track) await room.localParticipant.publishTrack(track, options)
      }
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.nativeWeb,
        roomName: room.name || '',
        connectionState: room.state || 'connected',
        audioTrackId: tracks.find((item) => (item.track || item)?.kind === 'audio')?.trackSid || '',
        videoTrackId: tracks.find((item) => (item.track || item)?.kind === 'video')?.trackSid || '',
        lastMediaEvent: 'published'
      })
      return { ok: true, room, diagnostics }
    },
    async updatePublishedTracks({ localParticipant = null, audioTrack = null, videoTrack = null, publishAudio = true, publishVideo = false } = {}) {
      const participant = localParticipant || room?.localParticipant
      if (!participant) return { ok: false, reason: 'livekit_room_not_connected' }
      if (!publishVideo && videoTrack) await participant.unpublishTrack(videoTrack, false).catch(() => {})
      if (!publishAudio && audioTrack) await participant.unpublishTrack(audioTrack, false).catch(() => {})
      diagnostics = buildProviderDiagnostics({ ...diagnostics, lastMediaEvent: 'tracks-updated' })
      return { ok: true, diagnostics }
    },
    getPlaybackInfo(streamDoc = {}) {
      return {
        provider: STREAM_PROVIDERS.nativeWeb,
        playbackMode: 'webrtc',
        roomName: streamDoc.livekitRoomName || streamDoc.roomName || '',
        playable: Boolean(streamDoc.hostConnected
          && (streamDoc.audioPublished === true || streamDoc.videoPublished === true || streamDoc.programHasAudio === true || streamDoc.programHasVideo === true))
      }
    },
    subscribeViewer() {
      return { ok: true, provider: STREAM_PROVIDERS.nativeWeb, mode: 'existing-listener-flow' }
    },
    disconnectViewer() {
      return { ok: true }
    },
    async stopPublishing() {
      room?.disconnect?.()
      room = null
      diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.nativeWeb, connectionState: 'stopped', lastMediaEvent: 'stopped' })
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
