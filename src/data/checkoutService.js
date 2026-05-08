import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

const createCheckoutSessionCallable = httpsCallable(functions, 'createCheckoutSession')

export async function createCheckoutSession(productIds = []) {
  const response = await createCheckoutSessionCallable({ productIds })
  return response?.data || null
}
