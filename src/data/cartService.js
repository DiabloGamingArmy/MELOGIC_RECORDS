const STORAGE_KEY = 'melogic_cart_v1'
const listeners = new Set()

function emit(items) {
  listeners.forEach((callback) => {
    try {
      callback(items)
    } catch {
      // ignore subscriber errors
    }
  })
  window.dispatchEvent(new CustomEvent('melogic:cart-updated', { detail: { count: items.length } }))
}

function readCart() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function writeCart(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
  emit(items)
  return items
}

function normalizeCartItem(product = {}) {
  const priceCents = Number.isFinite(product.priceCents) ? product.priceCents : 0
  const isFree = Boolean(product.isFree) || priceCents <= 0
  return {
    id: String(product.id || ''),
    title: String(product.title || 'Untitled product'),
    artistName: String(product.artistName || 'Unknown artist'),
    artistUsername: String(product.artistUsername || ''),
    priceCents,
    isFree,
    priceLabel: String(product.priceLabel || (isFree ? 'Free' : `$${(priceCents / 100).toFixed(2)}`)),
    thumbnailURL: String(product.thumbnailURL || product.coverURL || ''),
    coverURL: String(product.coverURL || ''),
    productType: String(product.productType || 'Product')
  }
}

export function getCartItems() {
  return readCart()
}

export function getCartCount() {
  return readCart().length
}

export function addToCart(product) {
  const item = normalizeCartItem(product)
  if (!item.id) return readCart()
  const current = readCart()
  if (current.some((entry) => entry.id === item.id)) {
    return writeCart(current)
  }
  return writeCart([item, ...current])
}

export function removeFromCart(productId) {
  const id = String(productId || '')
  const next = readCart().filter((item) => item.id !== id)
  return writeCart(next)
}

export function clearCart() {
  return writeCart([])
}

export function subscribeToCart(callback) {
  if (typeof callback !== 'function') return () => {}
  listeners.add(callback)
  callback(readCart())

  const syncFromStorage = (event) => {
    if (event.key && event.key !== STORAGE_KEY) return
    callback(readCart())
  }

  window.addEventListener('storage', syncFromStorage)
  return () => {
    listeners.delete(callback)
    window.removeEventListener('storage', syncFromStorage)
  }
}
