import { doc, getDoc } from 'firebase/firestore'
import { getDownloadURL, ref } from 'firebase/storage'
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
  if (!storage || !storagePath) throw new Error('agreement-storage-unavailable')
  const downloadUrl = await getDownloadURL(ref(storage, storagePath))
  const response = await fetch(downloadUrl)
  if (!response.ok) throw new Error('agreement-download-failed')
  return response.text()
}
