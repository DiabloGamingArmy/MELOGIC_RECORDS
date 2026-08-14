'use strict'

const crypto = require('node:crypto')
const { eligibleSouraFile } = require('./souraAssetArchives')
const { canonicalProductStoragePrefix, isProductScopedStoragePath, sanitizedPathForLog } = require('./productStorageScope')

const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')

function normalizeMarketplaceProductId(value = '') {
  const productId = String(value || '').trim()
  return productId && !productId.includes('/') ? productId : ''
}

function inspectSouraDeliverables(productId = '', product = {}) {
  const rows = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  const diagnostics = rows.map((file, index) => {
    const capabilityEligible = eligibleSouraFile(file)
    const productScoped = isProductScopedStoragePath(productId, file?.storagePath)
    const reasonCodes = []
    if (!capabilityEligible) reasonCodes.push('not-creator-approved-or-compatible')
    if (!productScoped) reasonCodes.push('not-product-scoped')
    return {
      index,
      fileId: sanitizedPathForLog(file?.id).slice(0, 180),
      fileName: sanitizedPathForLog(file?.name || file?.displayPath).slice(0, 180),
      storagePath: sanitizedPathForLog(file?.storagePath),
      capabilityEligible,
      productScoped,
      validationStatus: String(file?.souraAssetValidation?.status || 'missing'),
      compatible: file?.souraAssetValidation?.compatible === true,
      compatibleAssetCount: Number(file?.souraAssetValidation?.compatibleAssetCount || 0),
      creatorApproved: file?.isSouraAsset === true,
      reasonCodes
    }
  })
  return {
    files: rows.filter((file) => eligibleSouraFile(file) && isProductScopedStoragePath(productId, file?.storagePath)),
    diagnostics,
    expectedProductPrefix: canonicalProductStoragePrefix(productId)
  }
}

function sanitizedFailureReason(error, fallback = 'Soura asset import failed.') {
  const message = String(error?.message || fallback).slice(0, 500)
  if (/https?:\/\//i.test(message) || /gs:\/\//i.test(message)) return fallback
  return message.replace(/\b(token|signature|credential|authorization)=([^\s&]+)/gi, '$1=[omitted]')
}

function sourceFingerprint(files = []) {
  const inputs = files.map((file) => ({
    id: String(file?.id || ''),
    storagePath: String(file?.storagePath || ''),
    sizeBytes: Number(file?.sizeBytes || file?.fileSize || 0),
    updatedAt: String(file?.updatedAt || ''),
    assets: (Array.isArray(file?.souraAssetValidation?.assets) ? file.souraAssetValidation.assets : [])
      .map((asset) => `${asset?.archivePath || ''}:${asset?.contentHash || ''}:${Number(asset?.byteSize || 0)}`)
      .sort()
  })).sort((left, right) => `${left.id}|${left.storagePath}`.localeCompare(`${right.id}|${right.storagePath}`))
  return hash(JSON.stringify(inputs))
}

function buildSouraInstallIdentity(productId = '', product = {}, files = []) {
  const declaredVersion = String(product.version || '1')
  const fingerprint = sourceFingerprint(files)
  return {
    declaredVersion,
    sourceFingerprint: fingerprint,
    installId: `${productId}:${hash(`${declaredVersion}|${fingerprint}`).slice(0, 16)}`
  }
}

function classifySouraInstallState(existingInstalls = [], installId = '') {
  const active = existingInstalls.filter((install) => ['installed', 'partial'].includes(install?.status))
  if (active.some((install) => install?.installId === installId && install?.status === 'installed')) return 'already-installed'
  return active.some((install) => install?.installId !== installId) ? 'updated' : 'installed'
}

module.exports = { normalizeMarketplaceProductId, inspectSouraDeliverables, sanitizedFailureReason, sourceFingerprint, buildSouraInstallIdentity, classifySouraInstallState }
