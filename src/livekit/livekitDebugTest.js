import { Room, RoomEvent } from 'livekit-client'
import { createLiveKitCallToken } from './livekitCallService'

let activeDebugRoom = null

function attachRemoteAudioTrack(track) {
  const element = track.attach()
  element.autoplay = true
  element.controls = true
  element.dataset.livekitDebugAudio = 'true'

  document.body.appendChild(element)

  element.play().catch((error) => {
    console.warn('[Melogic LiveKit] Audio autoplay blocked:', error)
  })

  return element
}

function createDebugRoom(label) {
  const room = new Room({
    adaptiveStream: true,
    dynacast: true,
  })

  room.on(RoomEvent.Connected, () => {
    console.info(`[Melogic LiveKit] Connected to ${label}:`, room.name)
  })

  room.on(RoomEvent.Disconnected, (reason) => {
    console.info(`[Melogic LiveKit] Disconnected from ${label}:`, reason)

    if (activeDebugRoom === room) {
      activeDebugRoom = null
    }
  })

  room.on(RoomEvent.ParticipantConnected, (participant) => {
    console.info('[Melogic LiveKit] Participant connected:', participant.identity)
  })

  room.on(RoomEvent.ParticipantDisconnected, (participant) => {
    console.info('[Melogic LiveKit] Participant disconnected:', participant.identity)
  })

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.info('[Melogic LiveKit] Remote track subscribed:', {
      kind: track.kind,
      source: publication.source,
      participant: participant.identity,
    })

    if (track.kind === 'audio') {
      attachRemoteAudioTrack(track)
    }
  })

  room.on(RoomEvent.LocalTrackPublished, (publication) => {
    console.info('[Melogic LiveKit] Local track published:', {
      kind: publication.kind,
      source: publication.source,
      trackSid: publication.trackSid,
    })
  })

  return room
}

async function disconnectExistingDebugRoom() {
  if (!activeDebugRoom) return

  console.info('[Melogic LiveKit] Disconnecting existing debug room first.')
  activeDebugRoom.disconnect()
  activeDebugRoom = null
}

export function installLiveKitDebugTest() {
  if (typeof window === 'undefined') return

  window.melogicTestLiveKitToken = async function melogicTestLiveKitToken() {
    const roomName = `melogic-test-${Date.now()}`

    console.info('[Melogic LiveKit] Requesting token for room:', roomName)

    const result = await createLiveKitCallToken({
      roomName,
      displayName: 'Melogic Test Caller',
      role: 'admin-test',
    })

    console.info('[Melogic LiveKit] Token response:', {
      url: result.url,
      roomName: result.roomName,
      identity: result.identity,
      tokenPreview: `${String(result.token).slice(0, 20)}...`,
    })

    return result
  }

  window.melogicJoinLiveKitTestRoom = async function melogicJoinLiveKitTestRoom() {
    await disconnectExistingDebugRoom()

    const roomName = `melogic-audio-test-${Date.now()}`

    console.info('[Melogic LiveKit] Creating token and joining room:', roomName)

    const credentials = await createLiveKitCallToken({
      roomName,
      displayName: 'Melogic Browser Audio Test',
      role: 'admin-audio-test',
    })

    const room = createDebugRoom('random audio test room')
    activeDebugRoom = room

    await room.connect(credentials.url, credentials.token)
    await room.localParticipant.setMicrophoneEnabled(true)

    console.info('[Melogic LiveKit] Microphone enabled. Current room:', {
      roomName: room.name,
      localIdentity: room.localParticipant.identity,
      participants: room.remoteParticipants.size,
    })

    return {
      roomName: room.name,
      identity: room.localParticipant.identity,
      disconnect: () => room.disconnect(),
      room,
    }
  }

  window.melogicJoinFixedLiveKitRoom = async function melogicJoinFixedLiveKitRoom(
    roomName = 'melogic-fixed-audio-test'
  ) {
    await disconnectExistingDebugRoom()

    console.info('[Melogic LiveKit] Joining fixed room:', roomName)

    const credentials = await createLiveKitCallToken({
      roomName,
      displayName: 'Melogic Fixed Room Test',
      role: 'admin-fixed-audio-test',
    })

    const room = createDebugRoom('fixed audio test room')
    activeDebugRoom = room

    await room.connect(credentials.url, credentials.token)
    await room.localParticipant.setMicrophoneEnabled(true)

    console.info('[Melogic LiveKit] Microphone enabled in fixed room:', {
      roomName: room.name,
      localIdentity: room.localParticipant.identity,
      participants: room.remoteParticipants.size,
    })

    return {
      roomName: room.name,
      identity: room.localParticipant.identity,
      disconnect: () => room.disconnect(),
      room,
    }
  }

  window.melogicLeaveLiveKitTestRoom = function melogicLeaveLiveKitTestRoom() {
    if (!activeDebugRoom) {
      console.info('[Melogic LiveKit] No active debug room.')
      return
    }

    activeDebugRoom.disconnect()
    activeDebugRoom = null
    console.info('[Melogic LiveKit] Left debug room.')
  }

  console.info('[Melogic LiveKit] Debug test installed. Available commands:', {
    tokenTest: 'window.melogicTestLiveKitToken()',
    joinAudioTest: 'window.melogicJoinLiveKitTestRoom()',
    fixedAudioTest: "window.melogicJoinFixedLiveKitRoom('melogic-fixed-audio-test')",
    leaveAudioTest: 'window.melogicLeaveLiveKitTestRoom()',
  })
}