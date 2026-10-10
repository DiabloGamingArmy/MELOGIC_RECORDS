import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'
const mutations = new Set(['saveLicensingProduct', 'grantProductEntitlement', 'revokeProductEntitlement', 'generateLicenseKeys', 'revokeLicenseKey'])
export async function licensingRequest(name, data = {}) {
  if (mutations.has(name)) {
    const guard = window.__melogicAdminRequireStepUp
    if (typeof guard !== 'function' || !await guard(name)) throw new Error('Admin security verification was cancelled or unavailable.')
  }
  return (await httpsCallable(functions, name)(data)).data
}
