const test = require('node:test')
const assert = require('node:assert/strict')

const checkout = require('../src/payments/checkoutFulfillment').__test
const adminGrant = require('../src/admin/grantAdminProducts').__test
const webhook = require('../src/payments/stripeWebhook').__test
const commerceSummary = require('../src/account/commerceSummary').__test
const userCommerceAudit = require('../src/admin/userCommerceAudit').__test
const orderRepair = require('../src/payments/repairCheckoutOrder').__test

function snapshot(data = null) {
  return {
    exists: data !== null,
    data: () => data
  }
}

test('checkout product IDs are normalized and duplicate-safe', () => {
  assert.deepEqual(
    checkout.normalizeProductIds([' product-1 ', 'product-2', 'product-1', '', 'invalid/path']),
    ['product-1', 'product-2']
  )
  assert.deepEqual(checkout.normalizeProductIds('["product-1","product-2"]'), ['product-1', 'product-2'])
})

test('paid checkout payload records purchase access for both access collections', () => {
  const now = { marker: 'server-time' }
  const payload = checkout.purchaseAccessPayload({
    uid: 'buyer-1',
    productId: 'product-1',
    product: {
      title: 'Body Armor',
      artistId: 'creator-1',
      artistName: 'Creator',
      priceCents: 2499,
      currency: 'usd',
      usageLicense: 'Standard License'
    },
    orderId: 'order-1',
    session: {
      id: 'cs_test_123',
      currency: 'usd',
      payment_intent: 'pi_123'
    },
    now
  })

  assert.equal(payload.uid, 'buyer-1')
  assert.equal(payload.productId, 'product-1')
  assert.equal(payload.acquisitionType, 'Purchase')
  assert.equal(payload.source, 'stripe_checkout')
  assert.equal(payload.status, 'active')
  assert.equal(payload.orderId, 'order-1')
  assert.equal(payload.stripeCheckoutSessionId, 'cs_test_123')
  assert.equal(payload.paymentIntentId, 'pi_123')
  assert.equal(payload.pricePaid, 2499)
  assert.equal(payload.currency, 'USD')
  assert.equal(payload.productSnapshot.title, 'Body Armor')
  assert.equal(payload.updatedAt, now)
})

test('checkout replay repairs missing or stale access and leaves complete access alone', () => {
  const context = { orderId: 'order-1', stripeSessionId: 'cs_test_123' }
  assert.equal(checkout.accessWriteNeeded(snapshot(), context), true)
  assert.equal(checkout.accessWriteNeeded(snapshot({
    status: 'active',
    orderId: 'old-order',
    stripeCheckoutSessionId: 'cs_test_123',
    acquisitionType: 'Purchase'
  }), context), true)
  assert.equal(checkout.accessWriteNeeded(snapshot({
    status: 'active',
    orderId: 'order-1',
    stripeCheckoutSessionId: 'cs_test_123',
    acquisitionType: 'Purchase'
  }), context), false)
})

test('admin system grant payload is zero-dollar, attributable, and library-compatible', () => {
  const now = { marker: 'server-time' }
  const payload = adminGrant.systemGrantPayload({
    uid: 'friend-1',
    productId: 'product-1',
    product: {
      title: 'Body Armor',
      artistId: 'creator-1',
      artistName: 'Creator',
      priceCents: 2499,
      currency: 'usd'
    },
    claims: { uid: 'admin-1' },
    orderId: 'order-system-1',
    now
  })

  assert.equal(payload.acquisitionType, 'System Given')
  assert.equal(payload.source, 'admin_give_product')
  assert.equal(payload.status, 'active')
  assert.equal(payload.pricePaid, 0)
  assert.equal(payload.orderId, 'order-system-1')
  assert.equal(payload.grantedBy, 'admin-1')
  assert.equal(payload.grantedAt, now)
  assert.equal(payload.acquiredAt, now)
})

test('webhook accepts immediate and delayed successful checkout events', () => {
  assert.equal(webhook.FULFILLMENT_EVENTS.has('checkout.session.completed'), true)
  assert.equal(webhook.FULFILLMENT_EVENTS.has('checkout.session.async_payment_succeeded'), true)
  assert.equal(webhook.FULFILLMENT_EVENTS.has('payment_intent.created'), false)
})

test('trusted Stripe order fields preserve paid totals including zero values', () => {
  const fields = checkout.stripeOrderFields({
    status: 'complete',
    amount_subtotal: 600,
    amount_total: 600,
    currency: 'usd',
    payment_intent: 'pi_123',
    customer: 'cus_123',
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 }
  })
  assert.equal(fields.orderState, 'order_placed')
  assert.equal(fields.amountSubtotalCents, 600)
  assert.equal(fields.amountTotalCents, 600)
  assert.equal(fields.amountSource, 'stripe_checkout_session')
  assert.equal(fields.paymentIntentId, 'pi_123')
  assert.equal(fields.stripeCustomerId, 'cus_123')
})

test('commerce summary counts only paid money orders and deduplicates owned products', () => {
  const summary = commerceSummary.buildCommerceSummary({
    orders: [
      { paymentStatus: 'paid', amountTotalCents: 600, currency: 'usd', paidAt: '2026-06-15T13:08:00Z' },
      { paymentStatus: 'unpaid', amountTotalCents: 600, currency: 'usd', createdAt: '2026-06-15T13:09:00Z' },
      { paymentStatus: 'system_given', amountTotalCents: 0, currency: 'usd', createdAt: '2026-06-15T17:40:00Z' }
    ],
    accessRows: [
      { productId: 'product-1', status: 'active' },
      { productId: 'product-1', status: 'active' }
    ]
  })
  assert.deepEqual(summary.spendByCurrency, { USD: 600 })
  assert.equal(summary.paidOrderCount, 1)
  assert.equal(summary.ownedProductCount, 1)
  assert.equal(summary.totalSpentAmount, 600)
  assert.equal(summary.totalSpentCurrency, 'USD')
})

test('admin commerce audit merges entitlement and library records into one product row', () => {
  const entitlement = {
    productId: 'product-1',
    recordSources: ['entitlements'],
    acquisitionType: 'Purchase',
    source: 'stripe_checkout',
    orderId: 'order-1',
    productSnapshot: { title: 'Body Armor', creatorName: 'Creator' }
  }
  const library = {
    productId: 'product-1',
    recordSources: ['libraryItems'],
    acquisitionType: 'Purchase',
    source: 'stripe_checkout',
    orderId: 'order-1',
    acquiredAt: '2026-06-15T13:08:00Z',
    productSnapshot: { title: 'Body Armor', creatorName: 'Creator' }
  }
  const merged = userCommerceAudit.mergeAccessRows(entitlement, library)
  assert.deepEqual(merged.recordSources, ['entitlements', 'libraryItems'])
  assert.equal(merged.productId, 'product-1')
  assert.equal(merged.orderId, 'order-1')
  assert.equal(merged.acquiredAt, '2026-06-15T13:08:00Z')
})

test('unpaid Stripe repair never marks an open checkout as paid', () => {
  const fields = orderRepair.unpaidOrderFields({
    status: 'open',
    payment_status: 'unpaid',
    amount_subtotal: 600,
    amount_total: 600,
    currency: 'usd',
    livemode: true
  })
  assert.equal(fields.status, 'checkout_created')
  assert.equal(fields.paymentStatus, 'unpaid')
  assert.equal(fields.orderState, 'checkout_created')
  assert.equal(fields.amountTotalCents, 600)
  assert.equal(fields.amountSource, 'stripe_checkout_session')
})
