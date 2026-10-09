const { test } = require('node:test')
const assert = require('node:assert/strict')
const { initializeApp } = require('firebase-admin/app')
initializeApp({ projectId: 'melogic-a01-endpoint-test' })
const endpoints = require('../src/licensing/adminLicensing')
test('all eight production licensing callables reject anonymous and ordinary users before IO', async () => {
  assert.equal(Object.keys(endpoints).length, 8)
  for (const endpoint of Object.values(endpoints)) {
    await assert.rejects(endpoint.run({ data: { isAdmin: true, actorUid: 'owner' } }), { code: 'unauthenticated' })
    await assert.rejects(endpoint.run({ auth: { uid: 'ordinary-user', token: {} }, data: { isAdmin: true, admin: true } }), { code: 'permission-denied' })
  }
})

test('marketplace shell cannot squat the reserved Origami licensing identity', async () => {
  const { createOrUpdateProductShell } = require('../src/products/createOrUpdateProductShell')
  await assert.rejects(createOrUpdateProductShell.run({ auth: { uid: 'ordinary-user' }, data: { productId: 'origami', product: { title: 'Spoof' } } }), { code: 'permission-denied' })
  const { saveProductManifest } = require('../src/products/saveProductManifest')
  await assert.rejects(saveProductManifest.run({ auth: { uid: 'ordinary-user' }, data: { productId: 'origami', manifest: {} } }), { code: 'permission-denied' })
  const { assertMarketplaceProduct } = require('../src/licensing/entitlements')
  assert.throws(() => assertMarketplaceProduct('future-product', { licensing: { enabled: true } }), { code: 'permission-denied' })
})
