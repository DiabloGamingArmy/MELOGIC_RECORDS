import assert from 'node:assert/strict'
import test from 'node:test'
import {
  findNonProductScopedManifestPaths,
  isProductScopedStoragePath,
  normalizeProductDeliverableReferences,
  removeProductFileReferences
} from '../src/marketplace/productManifestPaths.js'

test('review_pending deliverable replacement removes every stale reference and keeps canonical fullPath', () => {
  const productId = 'dPBctdIbsdlMfdr09qzc'
  const oldPath = `products/${productId}/downloads/old-deliverable.wav`
  const initial = {
    id: productId,
    status: 'review_pending',
    downloadPath: oldPath,
    primaryDownloadPath: oldPath,
    deliverableFiles: [{ name: 'old-deliverable.wav', storagePath: oldPath, isSouraAsset: true }],
    files: [{ name: 'old-deliverable.wav', storagePath: oldPath }],
    fileMetadata: [{ name: 'old-deliverable.wav', storagePath: oldPath }],
    uploadedFiles: [{ name: 'old-deliverable.wav', storagePath: oldPath }]
  }
  const hydrated = { ...initial, deliverableFiles: normalizeProductDeliverableReferences(productId, initial.deliverableFiles) }
  assert.ok(hydrated.deliverableFiles[0].id, 'legacy rows receive a stable id before deletion')
  const afterDelete = removeProductFileReferences(hydrated, hydrated.deliverableFiles[0])
  assert.equal(afterDelete.downloadPath, '')
  assert.equal(afterDelete.primaryDownloadPath, '')
  for (const field of ['deliverableFiles', 'files', 'fileMetadata', 'uploadedFiles']) assert.deepEqual(afterDelete[field], [])

  const replacementFullPath = `products/${productId}/downloads/replacement..pack.zip`
  const replacement = normalizeProductDeliverableReferences(productId, [{ id: 'replacement', name: 'replacement..pack.zip', storagePath: replacementFullPath, status: 'uploaded' }])
  const manifest = { downloadPath: replacementFullPath, primaryDownloadPath: replacementFullPath, deliverableFiles: replacement, files: replacement, digital: { enabled: true, deliveryMethod: 'download' } }
  assert.equal(isProductScopedStoragePath(productId, replacementFullPath), true)
  assert.deepEqual(findNonProductScopedManifestPaths(productId, manifest), [])
})

test('download URLs, another product namespace, and traversal never pass product scoping', () => {
  const productId = 'product-current'
  assert.equal(isProductScopedStoragePath(productId, 'https://firebasestorage.googleapis.com/download?token=secret'), false)
  assert.equal(isProductScopedStoragePath(productId, 'products/product-old/downloads/file.zip'), false)
  assert.equal(isProductScopedStoragePath(productId, `products/${productId}/downloads/../escape.zip`), false)
  assert.equal(isProductScopedStoragePath(productId, `products/${productId}/downloads/%2e%2e/escape.zip`), false)
})
