import { doc, getDoc } from 'firebase/firestore'
import { getBytes, getDownloadURL, listAll, ref } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { storage } from '../firebase/storage'

const FALLBACK_SELLER_AGREEMENT_CONFIG = Object.freeze({
  enabled: true,
  agreementId: 'marketplace-product-seller-agreement',
  activeVersion: 'v1',
  title: 'Marketplace Product Seller Agreement',
  storagePath: 'legal/agreements/marketplace-product-seller-agreement/v1.md',
  format: 'markdown',
  requiresSignature: true
})
const AGREEMENT_FOLDER_PATH = 'legal/agreements/marketplace-product-seller-agreement'

function agreementError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function isDevEnvironment() {
  return typeof import.meta !== 'undefined' && Boolean(import.meta?.env?.DEV)
}

function devWarn(...args) {
  if (isDevEnvironment()) console.warn(...args)
}

export function normalizeMarketplaceSellerAgreement(raw = {}) {
  const fallback = FALLBACK_SELLER_AGREEMENT_CONFIG
  return {
    enabled: raw.enabled !== false,
    agreementId: String(raw.agreementId || fallback.agreementId).trim() || fallback.agreementId,
    activeVersion: String(raw.activeVersion || fallback.activeVersion).trim() || fallback.activeVersion,
    title: String(raw.title || fallback.title).trim() || fallback.title,
    storagePath: String(raw.storagePath || fallback.storagePath).trim() || fallback.storagePath,
    format: String(raw.format || fallback.format).trim().toLowerCase() || fallback.format,
    markdown: String(raw.markdown || raw.body || '').trim(),
    effectiveAt: raw.effectiveAt || null,
    requiresSignature: raw.requiresSignature !== false,
    updatedAt: raw.updatedAt || null
  }
}

export async function getMarketplaceSellerAgreementConfig() {
  if (!db) return { ...FALLBACK_SELLER_AGREEMENT_CONFIG }
  try {
    const snapshot = await getDoc(doc(db, 'platformSettings', 'marketplaceSellerAgreement'))
    if (!snapshot.exists()) {
      devWarn('[legalAgreementService] Missing platformSettings/marketplaceSellerAgreement; using fallback values in development.')
      return { ...FALLBACK_SELLER_AGREEMENT_CONFIG }
    }
    return normalizeMarketplaceSellerAgreement(snapshot.data() || {})
  } catch (error) {
    devWarn('[legalAgreementService] Failed to load platformSettings/marketplaceSellerAgreement; using fallback values in development.', error?.code || error?.message || error)
    return { ...FALLBACK_SELLER_AGREEMENT_CONFIG }
  }
}

export async function getAgreementMarkdown(storagePath = '') {
  if (!storage || !storagePath) {
    throw agreementError('storage-unavailable', 'Seller agreement file is missing.', { storagePath })
  }
  const agreementRef = ref(storage, storagePath)
  let storageError = null
  try {
    const bytes = await getBytes(agreementRef, 1024 * 1024)
    const text = new TextDecoder('utf-8').decode(bytes)
    if (!String(text || '').trim()) throw agreementError('agreement-empty', 'Seller agreement file is empty.', { storagePath })
    return text
  } catch (bytesError) {
    storageError = bytesError
    const code = String(bytesError?.code || '').toLowerCase()
    if (code.includes('object-not-found')) {
      devWarn('[legalAgreementService] Agreement markdown object missing.', storagePath)
      throw agreementError('object-not-found', 'Seller agreement file is missing.', { storagePath })
    }
    devWarn('[legalAgreementService] SDK agreement download failed; trying download URL fallback.', bytesError?.code || bytesError?.message || bytesError)
  }

  const sameOriginPath = `/${String(storagePath || '').replace(/^\/+/, '')}`
  try {
    const response = await fetch(sameOriginPath, { cache: 'no-cache' })
    if (response.ok) {
      const text = await response.text()
      if (!String(text || '').trim()) throw agreementError('agreement-empty', 'Seller agreement file is empty.', { storagePath, fallbackPath: sameOriginPath })
      if (/^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
        throw agreementError('agreement-fetch-failed', 'Seller agreement fallback returned an HTML page instead of markdown.', { storagePath, fallbackPath: sameOriginPath })
      }
      return text
    }
    devWarn('[legalAgreementService] Same-origin agreement fallback failed.', response.status, sameOriginPath)
  } catch (fallbackError) {
    devWarn('[legalAgreementService] Same-origin agreement fallback errored.', fallbackError?.code || fallbackError?.message || fallbackError)
  }

  try {
    const downloadUrl = await getDownloadURL(agreementRef)
    const response = await fetch(downloadUrl)
    if (!response.ok) throw agreementError('agreement-fetch-failed', `Agreement download failed with status ${response.status}.`, { storagePath, status: response.status })
    const text = await response.text()
    if (!String(text || '').trim()) throw agreementError('agreement-empty', 'Seller agreement file is empty.', { storagePath })
    return text
  } catch (error) {
    devWarn('[legalAgreementService] Failed to fetch agreement markdown from Storage.', error?.code || error?.message || error)
    const message = String(error?.message || storageError?.message || '').toLowerCase()
    const code = String(error?.code || storageError?.code || '').toLowerCase()
    const likelyCors = message.includes('cors') || message.includes('access-control') || code.includes('cors')
    if (likelyCors || storageError) {
      throw agreementError(
        likelyCors ? 'agreement-cors-blocked' : 'agreement-download-url-failed',
        likelyCors
          ? 'Seller agreement could not be loaded. Firebase Storage CORS blocked the request.'
          : 'Seller agreement could not be downloaded from Firebase Storage.',
        { storagePath, causeCode: error?.code || storageError?.code || '' }
      )
    }
    throw agreementError('agreement-fetch-failed', 'Seller agreement could not be loaded.', { storagePath, causeCode: error?.code || '' })
  }
}

function parseVersionFromPath(path = '') {
  const match = String(path || '').match(/\/(v(\d+))\.md$/i)
  if (!match) return null
  return {
    version: match[1].toLowerCase(),
    versionNumber: Number(match[2]),
    storagePath: path
  }
}

export async function getLatestMarketplaceSellerAgreement() {
  const config = await getMarketplaceSellerAgreementConfig()
  const fallbackPath = config.storagePath || `${AGREEMENT_FOLDER_PATH}/v1.md`
  const fallbackVersion = String(config.activeVersion || 'v1').toLowerCase()

  if (!storage) return { ...config, storagePath: fallbackPath, activeVersion: fallbackVersion }

  try {
    const folderRef = ref(storage, AGREEMENT_FOLDER_PATH)
    const listing = await listAll(folderRef)
    const candidates = listing.items
      .map((item) => parseVersionFromPath(item.fullPath))
      .filter(Boolean)
      .sort((a, b) => b.versionNumber - a.versionNumber)
    if (candidates.length) {
      return {
        ...config,
        storagePath: candidates[0].storagePath,
        activeVersion: candidates[0].version
      }
    }
  } catch (error) {
    devWarn('[legalAgreementService] Could not list agreement versions from Storage; falling back to config/default.', error?.code || error?.message || error)
  }

  return {
    ...config,
    storagePath: fallbackPath,
    activeVersion: fallbackVersion
  }
}
