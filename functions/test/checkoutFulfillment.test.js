const test = require('node:test')
const assert = require('node:assert/strict')

const checkout = require('../src/payments/checkoutFulfillment').__test
const fulfillment = require('../src/products/productFulfillment')
const adminGrant = require('../src/admin/grantAdminProducts').__test
const webhook = require('../src/payments/stripeWebhook').__test
const commerceSummary = require('../src/account/commerceSummary').__test
const userCommerceAudit = require('../src/admin/userCommerceAudit').__test
const orderRepair = require('../src/payments/repairCheckoutOrder').__test
const creatorEarnings = require('../src/payments/creatorEarnings').__test
const stripeConnect = require('../src/payments/stripeConnect').__test
const creatorWithdrawals = require('../src/payments/creatorWithdrawals').__test

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

test('product fulfillment defaults legacy products to digital and preserves physical metadata', () => {
  assert.equal(fulfillment.normalizeProductFulfillment({ productType: 'Sample Pack' }).type, 'digital')
  const physical = fulfillment.normalizeProductFulfillment({
    marketplaceProductType: 'physical',
    physical: {
      condition: 'New',
      quantityAvailable: 3,
      shipping: { mode: 'flat_rate', flatRateCents: 599 },
      shipsFrom: { country: 'US', region: 'CA', city: 'Los Angeles' }
    }
  })
  assert.equal(physical.type, 'physical')
  assert.equal(physical.digital.enabled, false)
  assert.equal(physical.physical.enabled, true)
  assert.equal(fulfillment.physicalAvailableQuantity({ fulfillment: physical }), 3)
})

test('checkout product snapshot includes marketplace fulfillment fields', () => {
  const snapshot = checkout.productSnapshot('product-physical', {
    title: 'Signed Vinyl',
    productType: 'Vinyl',
    marketplaceProductType: 'physical',
    physical: { condition: 'New', quantityAvailable: 1, shipping: { mode: 'flat_rate' } }
  })
  assert.equal(snapshot.productType, 'Vinyl')
  assert.equal(snapshot.marketplaceProductType, 'physical')
  assert.equal(snapshot.fulfillment.type, 'physical')
  assert.equal(snapshot.fulfillment.physical.enabled, true)
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

test('creator ledger allocates trusted Stripe total across product lines', () => {
  const amounts = creatorEarnings.allocateGrossAmounts({
    order: {
      items: [
        { productId: 'product-1', amountCents: 600 },
        { productId: 'product-2', amountCents: 400 }
      ]
    },
    productIds: ['product-1', 'product-2'],
    amountTotalCents: 900
  })
  assert.deepEqual(amounts, [540, 360])
  assert.equal(amounts.reduce((sum, amount) => sum + amount, 0), 900)
})

test('creator ledger payload records pending net earnings without inventing Stripe fees', () => {
  const payload = creatorEarnings.creatorLedgerPayload({
    creatorUid: 'creator-1',
    buyerUid: 'buyer-1',
    productId: 'product-1',
    orderId: 'order-1',
    stripeCheckoutSessionId: 'cs_test_123',
    grossAmount: 1000,
    currency: 'usd',
    feeBps: 1000,
    availableAt: 'later',
    now: 'now'
  })
  assert.equal(payload.grossAmount, 1000)
  assert.equal(payload.platformFeeAmount, 100)
  assert.equal(payload.creatorNetAmount, 900)
  assert.equal(payload.stripeFeeAmount, null)
  assert.equal(payload.creatorNetStatus, 'before_stripe_fee')
  assert.equal(payload.status, 'pending')
  assert.equal(payload.availableAt, 'later')
})

test('creator ledger subtracts trusted Stripe fees when the seller absorbs processing', () => {
  const payload = creatorEarnings.creatorLedgerPayload({
    grossAmount: 1000,
    feeBps: 1000,
    feeMode: 'seller_absorbs',
    stripeFeeAmount: 59
  })
  assert.equal(payload.platformFeeAmount, 100)
  assert.equal(payload.stripeFeeAmount, 59)
  assert.equal(payload.creatorNetAmount, 841)
  assert.equal(payload.creatorNetStatus, 'finalized_for_ledger')
})

test('creator ledger snapshots Pro and non-Pro platform fee bps', () => {
  assert.equal(creatorEarnings.sellerPlatformFeeBpsFromUser({}, {
    defaultPlatformFeeBps: 1000,
    proPlatformFeeBps: 400
  }), 1000)
  assert.equal(creatorEarnings.sellerPlatformFeeBpsFromUser({
    plan: 'pro',
    subscriptionStatus: 'active'
  }, {
    defaultPlatformFeeBps: 1000,
    proPlatformFeeBps: 400
  }), 400)
  assert.equal(creatorEarnings.creatorLedgerPayload({ grossAmount: 1000, feeBps: 400 }).platformFeeAmount, 40)
})

test('Stripe processing fee is allocated across creator lines without losing cents', () => {
  const allocated = creatorEarnings.allocateAmountByWeights(59, [600, 400])
  assert.deepEqual(allocated, [35, 24])
  assert.equal(allocated.reduce((sum, amount) => sum + amount, 0), 59)
})

test('checkout reads Stripe processing fee only from an expanded balance transaction', () => {
  assert.equal(checkout.stripeProcessingFee({
    payment_intent: {
      latest_charge: {
        balance_transaction: { fee: 59 }
      }
    }
  }), 59)
  assert.equal(checkout.stripeProcessingFee({ payment_intent: 'pi_123' }), null)
})

test('earnings summary is rebuildable from ledger status and currency', () => {
  const summary = creatorEarnings.buildEarningsSummary([
    { status: 'pending', grossAmount: 1000, creatorNetAmount: 800, currency: 'usd' },
    { status: 'available', grossAmount: 500, creatorNetAmount: 400, currency: 'usd' },
    { status: 'partially_withdrawn', grossAmount: 300, creatorNetAmount: 250, withdrawnAmount: 100, currency: 'usd' },
    { status: 'withdrawn', grossAmount: 250, creatorNetAmount: 200, withdrawnAmount: 200, currency: 'usd' },
    { status: 'pending', grossAmount: 100, creatorNetAmount: 85, creatorNetStatus: 'before_stripe_fee', currency: 'usd' },
    { status: 'refunded', grossAmount: 100, creatorNetAmount: 80, currency: 'usd' }
  ])
  assert.deepEqual(summary.pendingByCurrency, { USD: 885 })
  assert.deepEqual(summary.availableByCurrency, { USD: 550 })
  assert.deepEqual(summary.withdrawnByCurrency, { USD: 300 })
  assert.equal(summary.lifetimeGrossAmount, 2150)
  assert.equal(summary.lifetimeNetAmount, 1735)
  assert.equal(summary.unfinalizedEntryCount, 1)
})

test('platform revenue payload tracks company cut separately from creator balance', () => {
  const payload = checkout.platformRevenuePayload({
    creatorLedger: {
      creatorUid: 'seller-1',
      buyerUid: 'buyer-1',
      grossAmount: 1000,
      platformFeeAmount: 100,
      platformFeeBps: 1000,
      currency: 'usd'
    },
    orderId: 'order-1',
    productId: 'product-1',
    stripeCheckoutSessionId: 'cs_test_123',
    now: 'now'
  })
  assert.equal(payload.platformFeeAmount, 100)
  assert.equal(payload.grossAmount, 1000)
  assert.equal(payload.status, 'earned')
  assert.equal(payload.source, 'creator_ledger')
})

test('creator withdrawal helpers enforce availability and instant fee math', () => {
  assert.deepEqual(creatorWithdrawals.withdrawalAmounts({ amountCents: 1000, mode: 'instant' }), {
    amountCents: 1000,
    feeAmountCents: 99,
    payoutAmountCents: 901,
    mode: 'instant'
  })
  assert.throws(() => creatorWithdrawals.assertWithdrawalRequest({
    uid: 'seller-1',
    amountCents: 1001,
    availableAmountCents: 1000,
    connect: { stripeConnectAccountId: 'acct_123' }
  }), /exceeds available/)
  assert.throws(() => creatorWithdrawals.assertWithdrawalRequest({
    uid: 'seller-1',
    amountCents: 500,
    availableAmountCents: 1000,
    connect: {}
  }), /Set up Stripe payouts/)
})

test('creator withdrawal allocations prevent double-spend with remaining balances', () => {
  const entries = [
    { id: 'ledger-1', creatorNetAmount: 700, withdrawnAmount: 200, status: 'partially_withdrawn' },
    { id: 'ledger-2', creatorNetAmount: 500, status: 'available' }
  ]
  const result = creatorWithdrawals.withdrawalLedgerAllocations(entries, 800)
  assert.equal(result.remaining, 0)
  assert.deepEqual(result.allocations.map((entry) => ({
    id: entry.id,
    amountCents: entry.amountCents,
    nextStatus: entry.nextStatus,
    nextWithdrawnAmount: entry.nextWithdrawnAmount
  })), [
    { id: 'ledger-1', amountCents: 500, nextStatus: 'withdrawn', nextWithdrawnAmount: 700 },
    { id: 'ledger-2', amountCents: 300, nextStatus: 'partially_withdrawn', nextWithdrawnAmount: 300 }
  ])
})

test('Stripe Connect status exposes only safe onboarding fields', () => {
  const status = stripeConnect.safeConnectStatus({
    id: 'acct_123',
    type: 'none',
    controller: { stripe_dashboard: { type: 'express' } },
    details_submitted: true,
    charges_enabled: false,
    payouts_enabled: true,
    requirements: {
      disabled_reason: '',
      currently_due: ['individual.verification.document'],
      eventually_due: ['external_account'],
      past_due: [],
      pending_verification: ['individual.id_number']
    }
  }, { livemode: false })
  assert.equal(status.hasAccount, true)
  assert.equal(status.accountType, 'express')
  assert.equal(status.detailsSubmitted, true)
  assert.equal(status.payoutsEnabled, true)
  assert.deepEqual(status.currentlyDue, ['individual.verification.document'])
  assert.equal(Object.hasOwn(status, 'external_accounts'), false)
})

test('Stripe Connect account configuration uses hosted Express onboarding and transfers only', () => {
  const params = stripeConnect.connectAccountParams({
    uid: 'creator-1',
    email: 'creator@example.com'
  })
  assert.equal(params.type, 'express')
  assert.equal(params.country, 'US')
  assert.equal(params.capabilities.transfers.requested, true)
  assert.equal(Object.hasOwn(params.capabilities, 'card_payments'), false)
  assert.equal(params.metadata.firebaseUid, 'creator-1')
  assert.equal(params.metadata.platform, 'melogic_records')
})

test('Stripe Connect account recovery matches current and legacy user metadata', () => {
  assert.equal(stripeConnect.accountMatchesUid({
    metadata: { firebaseUid: 'creator-1' }
  }, 'creator-1'), true)
  assert.equal(stripeConnect.accountMatchesUid({
    metadata: { melogicUid: 'creator-1' }
  }, 'creator-1'), true)
  assert.equal(stripeConnect.accountMatchesUid({
    metadata: { firebaseUid: 'other-creator' }
  }, 'creator-1'), false)
})

test('Stripe Connect account recovery scans paginated accounts safely', async () => {
  const calls = []
  const stripe = {
    accounts: {
      async list(params) {
        calls.push(params)
        if (!params.starting_after) {
          return {
            data: [
              { id: 'acct_unrelated', metadata: { firebaseUid: 'someone-else' } },
              { id: 'acct_page_one_tail', metadata: {} }
            ],
            has_more: true
          }
        }
        return {
          data: [
            { id: 'acct_recovered', metadata: { firebaseUid: 'creator-1' } }
          ],
          has_more: false
        }
      }
    }
  }

  const matches = await stripeConnect.findExistingStripeConnectAccount({ stripe, uid: 'creator-1' })
  assert.equal(matches.length, 1)
  assert.equal(matches[0].id, 'acct_recovered')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].starting_after, 'acct_page_one_tail')
})

test('Stripe Connect account ID previews avoid exposing full account IDs', () => {
  assert.equal(stripeConnect.accountIdPreview('acct_123456789abcdef'), 'acct_123...cdef')
  assert.equal(stripeConnect.accountIdPreview(''), '')
})

test('Stripe Connect error details expose safe diagnostic fields', () => {
  const details = stripeConnect.safeErrorDetails('account_creation', {
    type: 'StripeInvalidRequestError',
    code: 'account_invalid',
    param: 'account',
    requestId: 'req_123',
    message: 'You can only create new accounts if you have signed up for Connect.',
    stack: 'secret stack'
  })
  assert.deepEqual(details, {
    stage: 'account_creation',
    stripeType: 'StripeInvalidRequestError',
    stripeCode: 'account_invalid',
    stripeParam: 'account',
    stripeRequestId: 'req_123',
    safeMessage: 'Stripe Connect setup may be incomplete for this platform. Please contact support with the Stripe request ID below.'
  })
  assert.equal(Object.hasOwn(details, 'stack'), false)
  assert.equal(Object.hasOwn(details, 'message'), false)
})

test('Stripe Connect return URLs must be absolute HTTPS URLs', () => {
  assert.equal(stripeConnect.isHttpsUrl('https://melogicrecords.studio/account/billing-payouts'), true)
  assert.equal(stripeConnect.isHttpsUrl('http://melogicrecords.studio/account/billing-payouts'), false)
  assert.equal(stripeConnect.isHttpsUrl('/account/billing-payouts'), false)
})

test('public Stripe Connect status does not infer or expose the private account ID', () => {
  const status = stripeConnect.publicConnectStatus({
    hasAccount: true,
    stripeConnectAccountId: 'acct_private',
    payoutsEnabled: true
  })
  assert.equal(status.hasAccount, true)
  assert.equal(status.payoutsEnabled, true)
  assert.equal(Object.hasOwn(status, 'stripeConnectAccountId'), false)
})

test('Stripe Connect secret mode is detected without exposing the secret', () => {
  assert.equal(stripeConnect.stripeSecretMode('sk_test_123'), 'test')
  assert.equal(stripeConnect.stripeSecretMode('sk_live_123'), 'live')
  assert.equal(stripeConnect.stripeSecretMode(''), 'missing')
  assert.equal(stripeConnect.stripeSecretMode('not-a-key'), 'unknown')
})

test('Stripe Connect preflight validates key mode and HTTPS public site URL', () => {
  const preflight = stripeConnect.validateStripeConnectPreflight({
    secret: 'sk_test_123',
    publicSiteUrl: 'https://melogicrecords.studio/',
    uid: 'creator-1'
  })
  assert.equal(preflight.stripeSecretMode, 'test')
  assert.equal(preflight.livemode, false)
  assert.equal(preflight.siteUrl, 'https://melogicrecords.studio')

  assert.throws(() => stripeConnect.validateStripeConnectPreflight({
    secret: 'sk_live_123',
    publicSiteUrl: 'http://melogicrecords.studio',
    uid: 'creator-1'
  }), /Stripe payouts are not configured correctly/)

  assert.throws(() => stripeConnect.validateStripeConnectPreflight({
    secret: '',
    publicSiteUrl: 'https://melogicrecords.studio',
    uid: 'creator-1'
  }), /Stripe payouts are not configured correctly/)
})
