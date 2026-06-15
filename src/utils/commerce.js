const ORDER_LABELS = {
  checkout_created: 'Checkout Created',
  checkout_completed: 'Order Placed',
  payment_succeeded: 'Order Placed',
  paid: 'Order Placed',
  order_placed: 'Order Placed',
  entitlement_granted: 'Added to Library',
  library_added: 'Added to Library',
  free_claim: 'Added to Library',
  system_given: 'System Given',
  payment_failed: 'Payment Failed',
  failed: 'Payment Failed',
  checkout_expired: 'Checkout Expired',
  expired: 'Checkout Expired',
  refunded: 'Refunded',
  canceled: 'Canceled',
  cancelled: 'Canceled',
  unpaid: 'Checkout Created'
}

export function orderLifecycleKey(order = {}) {
  return String(order.orderState || order.paymentStatus || order.status || 'unknown').trim().toLowerCase()
}

export function orderLifecycleLabel(order = {}) {
  const key = orderLifecycleKey(order)
  if (ORDER_LABELS[key]) return ORDER_LABELS[key]
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase()) || 'Unknown'
}

export function orderAmountAvailable(order = {}) {
  if (order.amountAvailable === false) return false
  return Number.isFinite(Number(order.amountTotalCents ?? order.amountCents))
}

export function isPaidMoneyOrder(order = {}) {
  return String(order.paymentStatus || '').toLowerCase() === 'paid' && orderAmountAvailable(order)
}
