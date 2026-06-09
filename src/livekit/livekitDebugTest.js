import { createLiveKitCallToken } from './livekitCallService'

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
      tokenPreview: `${String(result.token).slice(0, 16)}...`,
    })

    return result
  }

  console.info('[Melogic LiveKit] Debug test installed. Run window.melogicTestLiveKitToken()')
}