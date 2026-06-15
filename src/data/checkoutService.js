import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

const createCheckoutSessionCallable = httpsCallable(functions, 'createCheckoutSession')
const reconcileCheckoutSessionCallable = httpsCallable(functions, 'reconcileCheckoutSession')

export async function createCheckoutSession(productIds = []) {
  const response = await createCheckoutSessionCallable({ productIds })
  return response?.data || null
}

export async function reconcileCheckoutSession(sessionId = '') {
  const response = await reconcileCheckoutSessionCallable({ sessionId })
  return response?.data || null
}
