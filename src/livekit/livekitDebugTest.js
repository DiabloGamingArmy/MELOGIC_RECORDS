import { Room, RoomEvent } from 'livekit-client'
import { createLiveKitCallToken } from './livekitCallService'

let activeDebugRoom = null

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
    if (activeDebugRoom) {
      console.info('[Melogic LiveKit] Disconnecting existing debug room first.')
      activeDebugRoom.disconnect()
      activeDebugRoom = null
    }

    const roomName = `melogic-audio-test-${Date.now()}`

    console.info('[Melogic LiveKit] Creating token and joining room:', roomName)

    const credentials = await createLiveKitCallToken({
      roomName,
      displayName: 'Melogic Browser Audio Test',
      role: 'admin-audio-test',
    })

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    })

    activeDebugRoom = room

    room.on(RoomEvent.Connected, () => {
      console.info('[Melogic LiveKit] Connected to room:', room.name)
    })

    room.on(RoomEvent.Disconnected, (reason) => {
      console.info('[Melogic LiveKit] Disconnected from room:', reason)
      if (activeDebugRoom === room) {
        activeDebugRoom = null
      }
    })

    room.on(RoomEvent.ParticipantConnected, (participant) => {
      console.info('[Melogic LiveKit] Participant connected:', participant.identity)
    })

    room.on(RoomEvent.LocalTrackPublished, (publication) => {
      console.info('[Melogic LiveKit] Local track published:', {
        kind: publication.kind,
        source: publication.source,
        trackSid: publication.trackSid,
      })
    })

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
    leaveAudioTest: 'window.melogicLeaveLiveKitTestRoom()',
  })
}