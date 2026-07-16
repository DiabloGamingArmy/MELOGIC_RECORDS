export const STREAM_KEY_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'

export function createRandomStreamKey(length = 25) {
  const cryptoObj = globalThis.crypto || globalThis.window?.crypto
  if (!cryptoObj?.getRandomValues) throw new Error('Secure stream key generation is unavailable in this browser.')
  const bytes = new Uint8Array(length)
  cryptoObj.getRandomValues(bytes)
  return Array.from(bytes, (byte) => STREAM_KEY_ALPHABET[byte % STREAM_KEY_ALPHABET.length]).join('')
}

export function isValidGeneratedStreamKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9]{25}$/.test(value)
}

export function ensureSessionStreamKey(existingKey, { forceNew = false } = {}) {
  if (!forceNew && isValidGeneratedStreamKey(existingKey)) return existingKey
  return createRandomStreamKey(25)
}
