import { doc, getDoc } from 'firebase/firestore'
import { getDownloadURL, listAll, ref } from 'firebase/storage'
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
    throw new Error('Agreement file could not be downloaded. Firebase Storage CORS may not be configured for this domain.')
  }
  try {
    const downloadUrl = await getDownloadURL(ref(storage, storagePath))
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error(`agreement-download-failed:${response.status}`)
    return response.text()
  } catch (error) {
    devWarn('[legalAgreementService] Failed to fetch agreement markdown from Storage.', error?.code || error?.message || error)
    throw new Error('Agreement file could not be downloaded. Firebase Storage CORS may not be configured for this domain.')
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
