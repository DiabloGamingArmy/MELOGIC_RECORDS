import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

export async function getMyAccountPermissions() {
  if (!functions) throw new Error('Functions are not configured.')
  const callable = httpsCallable(functions, 'getMyAccountPermissions')
  const result = await callable({})
  return result?.data?.effective || { permissions: {}, restrictions: {}, source: 'defaults' }
}
