export const FULFILLMENT_TYPES = ['digital', 'physical', 'hybrid']

export function normalizeFulfillmentType(value = '') {
  const type = String(value || '').toLowerCase().trim()
  return FULFILLMENT_TYPES.includes(type) ? type : 'digital'
}

export function normalizePhysicalDetails(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const shipping = input.shipping && typeof input.shipping === 'object' ? input.shipping : {}
  const shipsFrom = input.shipsFrom && typeof input.shipsFrom === 'object' ? input.shipsFrom : {}
  const dimensions = input.dimensions && typeof input.dimensions === 'object' ? input.dimensions : {}
  const quantityAvailable = Math.max(0, Math.round(Number(input.quantityAvailable ?? input.quantity ?? 0) || 0))
  const quantitySold = Math.max(0, Math.round(Number(input.quantitySold || 0) || 0))
  const quantityReserved = Math.max(0, Math.round(Number(input.quantityReserved || 0) || 0))
  return {
    enabled: input.enabled === true,
    condition: String(input.condition || '').trim(),
    quantityAvailable,
    quantitySold,
    quantityReserved,
    shipsFrom: {
      country: String(shipsFrom.country || '').trim(),
      region: String(shipsFrom.region || '').trim(),
      city: String(shipsFrom.city || '').trim()
    },
    shipping: {
      mode: String(shipping.mode || '').trim(),
      flatRateCents: Math.max(0, Math.round(Number(shipping.flatRateCents || 0) || 0)),
      notes: String(shipping.notes || '').trim()
    },
    dimensions: {
      weightOz: Math.max(0, Number(dimensions.weightOz || 0) || 0),
      lengthIn: Math.max(0, Number(dimensions.lengthIn || 0) || 0),
      widthIn: Math.max(0, Number(dimensions.widthIn || 0) || 0),
      heightIn: Math.max(0, Number(dimensions.heightIn || 0) || 0)
    },
    pickupAvailable: input.pickupAvailable === true,
    returnPolicy: String(input.returnPolicy || '').trim()
  }
}

export function normalizeProductFulfillment(product = {}) {
  const existing = product.fulfillment && typeof product.fulfillment === 'object' ? product.fulfillment : {}
  const rawType = product.marketplaceProductType || product.fulfillmentType || existing.type
  const type = normalizeFulfillmentType(rawType)
  const digitalEnabled = type === 'digital' || type === 'hybrid'
  const physicalEnabled = type === 'physical' || type === 'hybrid'
  const physical = normalizePhysicalDetails({
    ...(existing.physical || {}),
    ...(product.physical || {}),
    enabled: physicalEnabled
  })
  return {
    type,
    digital: {
      enabled: digitalEnabled,
      deliveryMethod: digitalEnabled ? 'download' : 'none'
    },
    physical
  }
}

export function fulfillmentTypeLabel(product = {}) {
  const type = normalizeProductFulfillment(product).type
  if (type === 'physical') return 'Physical'
  if (type === 'hybrid') return 'Hybrid'
  return 'Digital'
}

export function hasDigitalFulfillment(product = {}) {
  return normalizeProductFulfillment(product).digital.enabled === true
}

export function hasPhysicalFulfillment(product = {}) {
  return normalizeProductFulfillment(product).physical.enabled === true
}

export function physicalAvailableQuantity(product = {}) {
  const physical = normalizeProductFulfillment(product).physical
  return Math.max(0, Number(physical.quantityAvailable || 0) - Number(physical.quantitySold || 0) - Number(physical.quantityReserved || 0))
}

export function isPhysicalSoldOut(product = {}) {
  return hasPhysicalFulfillment(product) && physicalAvailableQuantity(product) <= 0
}

export function shippingModeLabel(value = '') {
  const mode = String(value || '').trim()
  if (mode === 'flat_rate') return 'Flat-rate shipping'
  if (mode === 'seller_contact') return 'Seller will contact buyer'
  if (mode === 'local_pickup') return 'Local pickup'
  if (mode === 'free_shipping') return 'Free shipping'
  return mode || 'Shipping details pending'
}
