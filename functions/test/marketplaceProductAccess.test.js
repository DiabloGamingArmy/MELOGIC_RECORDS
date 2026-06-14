const test = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'melogic-test' })
}

const claimFreeProduct = require('../src/products/claimFreeProduct').__test
const downloadUrl = require('../src/products/createProductDownloadUrl').__test
const downloadLink = require('../src/products/createProductDownloadLink').__test
const productGifts = require('../src/products/productGifts').__test

test('free claim validation only treats published public free products as claimable inputs', () => {
  assert.equal(claimFreeProduct.isPublishedPublicProduct({ status: 'published', visibility: 'public' }), true)
  assert.equal(claimFreeProduct.isPublishedPublicProduct({ status: 'draft', visibility: 'public' }), false)
  assert.equal(claimFreeProduct.isFreeProduct({ isFree: true, priceCents: 999 }), true)
  assert.equal(claimFreeProduct.isFreeProduct({ isFree: false, priceCents: 0 }), true)
  assert.equal(claimFreeProduct.isFreeProduct({ isFree: false, priceCents: 499 }), false)
})

test('download signing only accepts product-scoped deliverable paths', () => {
  assert.equal(downloadUrl.isAllowedProductDownloadPath('abc', 'products/abc/downloads/file.zip'), true)
  assert.equal(downloadUrl.isAllowedProductDownloadPath('abc', 'products/abc/files/file-1/file.wav'), true)
  assert.equal(downloadUrl.isAllowedProductDownloadPath('abc', 'products/def/downloads/file.zip'), false)
  assert.equal(downloadUrl.isAllowedProductDownloadPath('abc', 'https://example.com/file.zip'), false)
  assert.equal(downloadUrl.normalizeStoragePath('/products/abc/downloads/file.zip'), 'products/abc/downloads/file.zip')
})

test('download row selection requires matching file id or exact storage path', () => {
  const rows = [
    { id: 'one', storagePath: 'products/p1/downloads/one.zip' },
    { id: 'two', storagePath: 'products/p1/files/two/two.wav' }
  ]
  assert.deepEqual(downloadUrl.selectAllowedDownload(rows, { fileId: 'two' }), rows[1])
  assert.deepEqual(downloadUrl.selectAllowedDownload(rows, { filePath: 'products/p1/downloads/one.zip' }), rows[0])
  assert.equal(downloadUrl.selectAllowedDownload(rows, { filePath: 'products/p1/downloads/missing.zip' }), null)
})

test('generated marketplace license identifies the product, buyer and acquisition source without requiring email', () => {
  const markdown = downloadLink.licenseMarkdown({
    productId: 'p1',
    product: { title: 'Drum Kit', artistName: 'Creator', usageLicense: 'Commercial use allowed.' },
    user: { uid: 'buyer-1', displayName: 'Buyer' },
    acquisition: { source: 'gift', giftedBy: 'creator-1' }
  })
  assert.match(markdown, /Product: Drum Kit/)
  assert.match(markdown, /Buyer UID: buyer-1/)
  assert.match(markdown, /Acquisition source: gift/)
  assert.doesNotMatch(markdown, /Buyer Email/)
})

test('product gift ids are deterministic and path-safe', () => {
  assert.equal(productGifts.giftIdFor('product/1', 'sender', 'recipient'), 'product_1_sender_recipient')
  assert.equal(productGifts.giftIdFor('p1', 'sender', 'recipient'), productGifts.giftIdFor('p1', 'sender', 'recipient'))
})
