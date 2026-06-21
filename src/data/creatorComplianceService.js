import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

export async function getCreatorAgeVerificationStatus() {
  if (!functions) throw new Error('Firebase functions are unavailable.')
  const callable = httpsCallable(functions, 'getCreatorAgeVerificationStatus')
  const result = await callable({})
  return result?.data?.ageVerification || { required: true, status: 'not_started' }
}

export async function confirmCreatorEligibility() {
  if (!functions) throw new Error('Firebase functions are unavailable.')
  const callable = httpsCallable(functions, 'confirmCreatorEligibility')
  const result = await callable({})
  return result?.data?.creatorEligibility || { required: true, status: result?.data?.status || 'attested' }
}

export async function startCreatorAgeVerification() {
  return confirmCreatorEligibility()
}
