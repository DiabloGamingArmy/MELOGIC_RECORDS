export const SHA256_INTEGRITY_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/

export function normalizePackageIntegrity(value = '') {
  return typeof value === 'string' ? value.trim() : ''
}

export function isValidPackageIntegrity(value = '') {
  return SHA256_INTEGRITY_PATTERN.test(normalizePackageIntegrity(value))
}

function contentBytes(content) {
  if (typeof content === 'string') return new TextEncoder().encode(content)
  if (content instanceof Uint8Array) return content
  if (content instanceof ArrayBuffer) return new Uint8Array(content)
  throw new TypeError('Integrity content must be a string, ArrayBuffer, or Uint8Array.')
}

function bytesToBase64(bytes) {
  let binary = ''
  bytes.forEach((byte) => { binary += String.fromCharCode(byte) })
  return btoa(binary)
}

export async function calculatePackageIntegrity(content) {
  if (!globalThis.crypto?.subtle) throw new Error('SHA-256 is unavailable in this runtime.')
  const digest = await globalThis.crypto.subtle.digest('SHA-256', contentBytes(content))
  return `sha256-${bytesToBase64(new Uint8Array(digest))}`
}
