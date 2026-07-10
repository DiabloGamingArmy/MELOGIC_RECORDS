import { httpsCallable } from 'firebase/functions'
import { functions } from '../../firebase/functions'

export async function getStreamingProviderStatus() {
  const callable = httpsCallable(functions, 'getStreamingProviderStatus')
  const result = await callable({})
  return result.data || {}
}
