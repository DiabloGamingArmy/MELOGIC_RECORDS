export function formatUsername(username = '') {
  const value = String(username || '').trim()
  if (!value) return ''
  return value.startsWith('@') ? value : `@${value}`
}
