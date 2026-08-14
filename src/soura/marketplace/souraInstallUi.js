const MESSAGE_BY_CODE = Object.freeze({
  'functions/unauthenticated': 'Sign in before importing this pack to Soura.',
  'functions/permission-denied': 'Purchase or claim this product before importing its Soura assets.',
  'functions/not-found': 'This marketplace product is no longer available.',
  'functions/invalid-argument': 'This product could not be sent to Soura. Refresh the page and try again.',
  'functions/failed-precondition': 'This product does not currently contain an installable, verified Soura pack.',
  'functions/resource-exhausted': 'This Soura pack is temporarily too busy to import. Try again shortly.',
  'functions/deadline-exceeded': 'The Soura import took too long. Try again.'
})

function sanitize(value, key = '') {
  if (/url|token|credential|authorization|secret/i.test(key)) return '[omitted]'
  if (typeof value === 'string') return value.replace(/https?:\/\/\S+/gi, '[omitted]').replace(/gs:\/\/\S+/gi, '[omitted]').slice(0, 500)
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitize(item))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 40).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]))
  return value
}

export function souraInstallErrorMessage(error = {}) {
  return MESSAGE_BY_CODE[String(error?.code || '')] || error?.message || 'Could not import this Soura pack.'
}

export function souraInstallDiagnostic(error = {}, productId = '') {
  return {
    operation: 'install-marketplace-soura-pack',
    productId: String(productId || ''),
    code: String(error?.code || 'unknown'),
    message: sanitize(String(error?.message || 'Soura import failed.'), 'message'),
    details: sanitize(error?.details || null)
  }
}
