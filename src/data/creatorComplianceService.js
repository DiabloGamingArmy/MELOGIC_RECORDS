import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

export async function getCreatorAgeVerificationStatus() {
  if (!functions) throw new Error('Firebase functions are unavailable.')
  const callable = httpsCallable(functions, 'getCreatorAgeVerificationStatus')
  const result = await callable({})
  return result?.data?.ageVerification || { required: true, status: 'not_started' }
}

export async function startCreatorAgeVerification({ attestationAccepted = false } = {}) {
  if (!functions) throw new Error('Firebase functions are unavailable.')
  const callable = httpsCallable(functions, 'startCreatorAgeVerification')
  const result = await callable({ attestationAccepted })
  return result?.data?.ageVerification || { required: true, status: 'pending' }
}
