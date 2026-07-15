import { Room } from 'livekit-client'
import { buildProviderDiagnostics, providerCapabilities, STREAM_PROVIDERS } from './streamingProviderTypes'

export function createLiveKitProvider() {
  let room = null
  let diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.webrtc })

  return {
    id: STREAM_PROVIDERS.webrtc,
    label: 'WebRTC Live',
    description: 'Low-latency realtime rooms and backstage.',
    transportProvider: 'livekit',
    ingestMode: 'browser-webrtc',
    playbackMode: 'webrtc',
    configured: true,
    capabilities: providerCapabilities(STREAM_PROVIDERS.webrtc),
    createStreamSession(options = {}) {
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.webrtc,
        roomName: options.roomName || options.livekitRoomName || '',
        connectionState: 'session-ready'
      })
      return { ok: true, provider: STREAM_PROVIDERS.webrtc, diagnostics }
    },
    async startPublishing({ url = '', token = '', tracks = [], publishOptions = {}, existingRoom = null } = {}) {
      room = existingRoom || new Room({ adaptiveStream: true, dynacast: true })
      if (!existingRoom) await room.connect(url, token)
      for (const item of tracks.filter(Boolean)) {
        const track = item.track || item
        const options = item.options || publishOptions || {}
        if (track) await room.localParticipant.publishTrack(track, options)
      }
      diagnostics = buildProviderDiagnostics({
        provider: STREAM_PROVIDERS.webrtc,
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
        provider: STREAM_PROVIDERS.webrtc,
        playbackMode: 'webrtc',
        roomName: streamDoc.livekitRoomName || streamDoc.roomName || '',
        playable: Boolean(streamDoc.hostConnected
          && (streamDoc.audioPublished === true || streamDoc.videoPublished === true || streamDoc.programHasAudio === true || streamDoc.programHasVideo === true))
      }
    },
    subscribeViewer() {
      return { ok: true, provider: STREAM_PROVIDERS.webrtc, mode: 'existing-listener-flow' }
    },
    disconnectViewer() {
      return { ok: true }
    },
    async stopPublishing() {
      room?.disconnect?.()
      room = null
      diagnostics = buildProviderDiagnostics({ provider: STREAM_PROVIDERS.webrtc, connectionState: 'stopped', lastMediaEvent: 'stopped' })
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
