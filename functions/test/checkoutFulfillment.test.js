const test = require('node:test')
const assert = require('node:assert/strict')

const checkout = require('../src/payments/checkoutFulfillment').__test
const adminGrant = require('../src/admin/grantAdminProducts').__test
const webhook = require('../src/payments/stripeWebhook').__test

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
