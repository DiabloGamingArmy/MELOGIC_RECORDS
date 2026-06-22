const FULFILLMENT_TYPES = new Set(['digital', 'physical', 'hybrid'])

function cleanString(value = '', max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function normalizeFulfillmentType(value = '') {
  const type = cleanString(value, 40).toLowerCase()
  return FULFILLMENT_TYPES.has(type) ? type : 'digital'
}

function normalizeNumber(value, fallback = 0) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(0, Math.round(parsed))
}

function normalizePhysicalDetails(value = {}) {
  const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  const shipsFrom = input.shipsFrom && typeof input.shipsFrom === 'object' ? input.shipsFrom : {}
  const shipping = input.shipping && typeof input.shipping === 'object' ? input.shipping : {}
  const dimensions = input.dimensions && typeof input.dimensions === 'object' ? input.dimensions : {}
  return {
    enabled: input.enabled === true,
    condition: cleanString(input.condition || '', 80),
    quantityAvailable: normalizeNumber(input.quantityAvailable ?? input.quantity, 0),
    quantitySold: normalizeNumber(input.quantitySold, 0),
    quantityReserved: normalizeNumber(input.quantityReserved, 0),
    shipsFrom: {
      country: cleanString(shipsFrom.country || '', 120),
      region: cleanString(shipsFrom.region || '', 120),
      city: cleanString(shipsFrom.city || '', 120)
    },
    shipping: {
      mode: cleanString(shipping.mode || '', 80),
      flatRateCents: normalizeNumber(shipping.flatRateCents, 0),
      notes: cleanString(shipping.notes || '', 1000)
    },
    dimensions: {
      weightOz: Math.max(0, Number(dimensions.weightOz || 0) || 0),
      lengthIn: Math.max(0, Number(dimensions.lengthIn || 0) || 0),
      widthIn: Math.max(0, Number(dimensions.widthIn || 0) || 0),
      heightIn: Math.max(0, Number(dimensions.heightIn || 0) || 0)
    },
    pickupAvailable: input.pickupAvailable === true,
    returnPolicy: cleanString(input.returnPolicy || '', 1000)
  }
}

function normalizeProductFulfillment(product = {}) {
  const existing = product.fulfillment && typeof product.fulfillment === 'object' ? product.fulfillment : {}
  const type = normalizeFulfillmentType(product.marketplaceProductType || product.fulfillmentType || existing.type)
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

function hasDigitalFulfillment(product = {}) {
  return normalizeProductFulfillment(product).digital.enabled === true
}

function hasPhysicalFulfillment(product = {}) {
  return normalizeProductFulfillment(product).physical.enabled === true
}

function physicalAvailableQuantity(product = {}) {
  const physical = normalizeProductFulfillment(product).physical
  return Math.max(0, Number(physical.quantityAvailable || 0) - Number(physical.quantitySold || 0) - Number(physical.quantityReserved || 0))
}

function isPhysicalSoldOut(product = {}) {
  return hasPhysicalFulfillment(product) && physicalAvailableQuantity(product) <= 0
}

module.exports = {
  normalizeFulfillmentType,
  normalizeProductFulfillment,
  hasDigitalFulfillment,
  hasPhysicalFulfillment,
  physicalAvailableQuantity,
  isPhysicalSoldOut
}
