import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

export async function getRecoveryCodeStatus() {
  const callable = httpsCallable(functions, 'getRecoveryCodeStatus')
  const result = await callable({})
  return result?.data || { ok: true, generated: false, remaining: 0 }
}

export async function generateRecoveryCodes() {
  const callable = httpsCallable(functions, 'generateRecoveryCodes')
  const result = await callable({})
  return result?.data || { ok: false, codes: [] }
}
