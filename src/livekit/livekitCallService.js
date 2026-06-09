import { getFunctions, httpsCallable } from 'firebase/functions'
import { app } from '../firebase/firebaseConfig'

export async function createLiveKitCallToken({ roomName, displayName, role = 'caller' } = {}) {
  const functions = getFunctions(app, 'us-central1')
  const createLiveKitToken = httpsCallable(functions, 'createLiveKitToken')

  const result = await createLiveKitToken({
    roomName,
    displayName,
    role,
  })

  const data = result.data || {}

  if (!data.url || !data.token || !data.roomName) {
    throw new Error('LiveKit token response was missing url, token, or roomName.')
  }

  return {
    url: data.url,
    token: data.token,
    roomName: data.roomName,
    identity: data.identity || null,
  }
}