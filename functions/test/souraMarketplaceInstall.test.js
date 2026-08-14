'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { normalizeMarketplaceProductId, inspectSouraDeliverables, buildSouraInstallIdentity, classifySouraInstallState } = require('../src/products/souraMarketplaceInstall')

const validation = { status: 'compatible', compatible: true, compatibleAssetCount: 1, assets: [{ archivePath: 'Audio/Kick.wav', contentHash: 'abc', byteSize: 44 }] }
const replacement = (overrides = {}) => ({ id: 'replacement', name: 'replacement..pack.zip', contentType: 'application/zip', storagePath: 'products/existing/downloads/replacement..pack.zip', sizeBytes: 1200, updatedAt: '2026-08-14T03:11:35.540Z', isSouraAsset: true, souraAssetValidation: validation, ...overrides })

test('existing review_pending product replacement ZIP remains eligible when its filename contains benign double dots', () => {
  const result = inspectSouraDeliverables('existing', { status: 'review_pending', hasSouraAssets: true, deliverableFiles: [replacement()] })
  assert.equal(result.files.length, 1)
  assert.equal(result.diagnostics[0].productScoped, true)
  assert.deepEqual(result.diagnostics[0].reasonCodes, [])
})

test('stale and disabled deliverables fail closed with field-safe diagnostics', () => {
  const result = inspectSouraDeliverables('existing', { deliverableFiles: [
    replacement({ id: 'stale', storagePath: 'products/old/downloads/stale.zip' }),
    replacement({ id: 'disabled', isSouraAsset: false }),
    replacement({ id: 'traversal', storagePath: 'products/existing/downloads/%2e%2e/escape.zip' })
  ] })
  assert.equal(result.files.length, 0)
  assert.deepEqual(result.diagnostics[0].reasonCodes, ['not-product-scoped'])
  assert.deepEqual(result.diagnostics[1].reasonCodes, ['not-creator-approved-or-compatible'])
  assert.deepEqual(result.diagnostics[2].reasonCodes, ['not-product-scoped'])
  assert.equal(result.expectedProductPrefix, 'products/existing/')
})

test('install identity is idempotent and changes when an existing product replaces its deliverable', () => {
  const first = buildSouraInstallIdentity('existing', { version: 'v1' }, [replacement()])
  const repeated = buildSouraInstallIdentity('existing', { version: 'v1' }, [replacement()])
  const updated = buildSouraInstallIdentity('existing', { version: 'v1' }, [replacement({ id: 'new-file', storagePath: 'products/existing/downloads/new.zip' })])
  assert.equal(first.installId, repeated.installId)
  assert.notEqual(first.installId, updated.installId)
  assert.equal(classifySouraInstallState([], first.installId), 'installed')
  assert.equal(classifySouraInstallState([{ installId: first.installId, status: 'installed' }], first.installId), 'already-installed')
  assert.equal(classifySouraInstallState([{ installId: first.installId, status: 'installed' }], updated.installId), 'updated')
})

test('callable productId contract rejects missing and path-like values', () => {
  assert.equal(normalizeMarketplaceProductId(''), '')
  assert.equal(normalizeMarketplaceProductId('products/existing'), '')
  assert.equal(normalizeMarketplaceProductId(' existing '), 'existing')
})
