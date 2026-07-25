function isPlainObject(value) {
  if (!value || typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function sanitizeFirebaseCallablePayload(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) {
    return value.map((item) => item === undefined ? null : sanitizeFirebaseCallablePayload(item))
  }
  if (!isPlainObject(value)) return value

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== undefined)
      .map(([key, item]) => [key, sanitizeFirebaseCallablePayload(item)])
  )
}
