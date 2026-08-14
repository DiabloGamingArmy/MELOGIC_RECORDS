'use strict'

const { HttpsError } = require('firebase-functions/v2/https')
const LEGACY_PRODUCT_FILE_FIELDS = Object.freeze(['files', 'fileMetadata', 'uploadedFiles', 'folderDeliverables'])

function canonicalProductStoragePrefix(productId = '') { return `products/${String(productId || '').trim()}/` }
function normalizeStoragePath(value = '') { return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').trim() }

function sanitizedPathForLog(value = '') {
  const raw = normalizeStoragePath(value).replace(/[\u0000-\u001F\u007F]/g, '').slice(0, 320)
  if (/^https?:\/+\/?/i.test(raw)) return '[signed-or-download-url omitted]'
  if (/^gs:\/+\/?/i.test(raw)) return '[gs-url omitted]'
  return raw.split(/[?#]/, 1)[0]
}

function hasUnsafePathSegment(path = '') {
  return normalizeStoragePath(path).split('/').some((segment) => {
    try { return ['.', '..'].includes(decodeURIComponent(segment).toLowerCase()) } catch { return true }
  })
}

function isProductScopedStoragePath(productId = '', value = '') {
  const path = normalizeStoragePath(value)
  return Boolean(path && !/^https?:\/+\/?/i.test(path) && !/^gs:\/+\/?/i.test(path) && !path.startsWith('users/') && !hasUnsafePathSegment(path) && path.startsWith(canonicalProductStoragePrefix(productId)))
}

function productScopeError(productId = '', value = '', manifestField = 'path') {
  const details = { manifestField, offendingPath: sanitizedPathForLog(value), expectedProductPrefix: canonicalProductStoragePrefix(productId) }
  console.warn('[productStorageScope] rejected non-product-scoped path', details)
  return new HttpsError('invalid-argument', `${manifestField} must be a product-scoped storage path.`, details)
}

function requireProductScopedStoragePath(productId = '', value = '', manifestField = 'path') {
  const path = normalizeStoragePath(value)
  if (!isProductScopedStoragePath(productId, path)) throw productScopeError(productId, value, manifestField)
  return path
}

function staleProductFileIds(existingIds = [], retainedIds = []) {
  const retained = new Set((Array.isArray(retainedIds) ? retainedIds : []).map(String))
  return (Array.isArray(existingIds) ? existingIds : []).map(String).filter((id) => id && !retained.has(id))
}

module.exports = { LEGACY_PRODUCT_FILE_FIELDS, canonicalProductStoragePrefix, normalizeStoragePath, sanitizedPathForLog, hasUnsafePathSegment, isProductScopedStoragePath, productScopeError, requireProductScopedStoragePath, staleProductFileIds }
