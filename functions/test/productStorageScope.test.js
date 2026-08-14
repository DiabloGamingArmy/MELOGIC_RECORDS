'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { LEGACY_PRODUCT_FILE_FIELDS, canonicalProductStoragePrefix, isProductScopedStoragePath, requireProductScopedStoragePath, sanitizedPathForLog, staleProductFileIds } = require('../src/products/productStorageScope')
const admin = require('firebase-admin')
if (!admin.apps.length) admin.initializeApp({ projectId: 'demo-product-replacement' })
const { baseProductPayload } = require('../src/products/createOrUpdateProductShell').__test

test('backend uses the canonical products/{productId}/ prefix without rejecting benign double dots in a filename', () => {
  const productId = 'product-current'
  const path = `products/${productId}/downloads/replacement..pack.zip`
  assert.equal(canonicalProductStoragePrefix(productId), 'products/product-current/')
  assert.equal(isProductScopedStoragePath(productId, path), true)
  assert.equal(requireProductScopedStoragePath(productId, path, 'files.replacement.storagePath'), path)
})

test('backend scope failures identify the manifest field and redact URLs', () => {
  const originalWarn = console.warn
  console.warn = () => {}
  try {
    assert.throws(() => requireProductScopedStoragePath('current', 'products/old/downloads/file.zip', 'deliverableFiles.old.storagePath'), (error) => {
      assert.equal(error.code, 'invalid-argument')
      assert.equal(error.details.manifestField, 'deliverableFiles.old.storagePath')
      assert.equal(error.details.offendingPath, 'products/old/downloads/file.zip')
      assert.equal(error.details.expectedProductPrefix, 'products/current/')
      return true
    })
  } finally { console.warn = originalWarn }
  assert.equal(sanitizedPathForLog('https://example.test/file?token=secret'), '[signed-or-download-url omitted]')
})

test('an explicit deliverable deletion is not replaced with persisted legacy paths by the product shell', () => {
  const productId = 'product-current'
  const oldPath = `products/${productId}/downloads/old.zip`
  const payload = baseProductPayload({
    productId,
    uid: 'creator',
    existing: { title: 'Existing product', status: 'review_pending', downloadPath: oldPath, primaryDownloadPath: oldPath, deliverableFiles: [{ id: 'old', storagePath: oldPath }] },
    product: { title: 'Existing product', status: 'review_pending', downloadPath: '', primaryDownloadPath: '', deliverableFiles: [] }
  })
  assert.equal(payload.downloadPath, '')
  assert.equal(payload.primaryDownloadPath, '')
  assert.deepEqual(payload.deliverableFiles, [])
  assert.deepEqual(staleProductFileIds(['old', 'replacement'], ['replacement']), ['old'])
  assert.deepEqual(LEGACY_PRODUCT_FILE_FIELDS, ['files', 'fileMetadata', 'uploadedFiles', 'folderDeliverables'])
})
