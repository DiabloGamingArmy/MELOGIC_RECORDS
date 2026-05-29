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
const FALLBACK_AGREEMENT_STORAGE_PATH = `${AGREEMENT_FOLDER_PATH}/v1.md`
const AGREEMENT_MANIFEST_PATH = `/${AGREEMENT_FOLDER_PATH}/manifest.json`
const AGREEMENT_REQUEST_TIMEOUT_MS = 10000

function agreementError(code, message, details = {}) {
  const error = new Error(message)
  error.code = code
  error.details = details
  return error
}

function withTimeout(promise, timeoutMs, code, message, details = {}) {
  let timeoutId
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(agreementError(code, message, details)), timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutId))
}

async function fetchTextWithTimeout(url, details = {}, timeoutMs = AGREEMENT_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { cache: 'no-cache', signal: controller.signal })
    if (!response.ok) {
      throw agreementError('agreement-fetch-failed', `Agreement download failed with status ${response.status}.`, { ...details, status: response.status })
    }
    const text = await response.text()
    if (!String(text || '').trim()) throw agreementError('agreement-empty', 'Seller agreement file is empty.', details)
    if (/^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
      throw agreementError('agreement-fetch-failed', 'Seller agreement fallback returned an HTML page instead of markdown.', details)
    }
    return text
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw agreementError('agreement-timeout', 'The request timed out. Firebase Storage CORS or permissions may need configuration.', details)
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
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
    publicPath: String(raw.publicPath || '').trim(),
    versionDiscoveryMode: String(raw.versionDiscoveryMode || raw.discoveryMode || '').trim().toLowerCase(),
    storageDiscoveryEnabled: raw.storageDiscoveryEnabled === true || raw.enableStorageDiscovery === true,
    effectiveAt: raw.effectiveAt || null,
    requiresSignature: raw.requiresSignature !== false,
    updatedAt: raw.updatedAt || null
  }
}

export async function getMarketplaceSellerAgreementConfig() {
  if (!db) return { ...normalizeMarketplaceSellerAgreement(FALLBACK_SELLER_AGREEMENT_CONFIG), configSource: 'fallback' }
  try {
    const snapshot = await getDoc(doc(db, 'platformSettings', 'marketplaceSellerAgreement'))
    if (!snapshot.exists()) {
      devWarn('[legalAgreementService] Missing platformSettings/marketplaceSellerAgreement; using fallback values in development.')
      return { ...normalizeMarketplaceSellerAgreement(FALLBACK_SELLER_AGREEMENT_CONFIG), configSource: 'fallback' }
    }
    return { ...normalizeMarketplaceSellerAgreement(snapshot.data() || {}), configSource: 'firestore' }
  } catch (error) {
    devWarn('[legalAgreementService] Failed to load platformSettings/marketplaceSellerAgreement; using fallback values in development.', error?.code || error?.message || error)
    return { ...normalizeMarketplaceSellerAgreement(FALLBACK_SELLER_AGREEMENT_CONFIG), configSource: 'fallback' }
  }
}

export async function getAgreementMarkdown(storagePath = '', options = {}) {
  if (!storagePath) {
    throw agreementError('agreement-missing-path', 'Seller agreement file is missing.', { storagePath })
  }
  const returnMetadata = options.returnMetadata === true
  const sameOriginPath = `/${String(storagePath || '').replace(/^\/+/, '')}`
  const sameOriginCandidates = []
  if (options.publicPath) sameOriginCandidates.push({ path: options.publicPath, source: 'same-origin-public', warning: '' })
  sameOriginCandidates.push({ path: sameOriginPath, source: 'same-origin', warning: '' })
  if (storagePath !== FALLBACK_AGREEMENT_STORAGE_PATH) {
    sameOriginCandidates.push({
      path: `/${FALLBACK_AGREEMENT_STORAGE_PATH}`,
      source: 'same-origin-fallback',
      warning: 'Could not load the configured agreement file from same-origin hosting. Showing bundled fallback.'
    })
  }

  const seenPaths = new Set()
  for (const candidate of sameOriginCandidates) {
    const candidatePath = `/${String(candidate.path || '').replace(/^\/+/, '')}`
    if (seenPaths.has(candidatePath)) continue
    seenPaths.add(candidatePath)
    try {
      const text = await fetchTextWithTimeout(candidatePath, {
        storagePath,
        fallbackPath: candidatePath
      })
      const parsedVersion = parseVersionFromPath(candidatePath)
      return returnMetadata
        ? {
            markdown: text,
            source: candidate.source,
            fallbackPath: candidatePath,
            warning: candidate.warning,
            version: parsedVersion?.version || ''
          }
        : text
    } catch (fallbackError) {
      devWarn('[legalAgreementService] Same-origin agreement fallback errored.', candidatePath, fallbackError?.code || fallbackError?.message || fallbackError)
    }
  }

  if (options.allowStorageFetch !== true) {
    throw agreementError(
      'agreement-hosted-fallback-missing',
      'Seller agreement could not be loaded from same-origin hosting. Firebase Storage browser fetch is disabled until bucket CORS is configured.',
      { storagePath }
    )
  }

  if (!storage) {
    throw agreementError('storage-unavailable', 'Seller agreement file is missing.', { storagePath })
  }

  const agreementRef = ref(storage, storagePath)
  let storageError = null
  try {
    const bytes = await withTimeout(
      getBytes(agreementRef, 1024 * 1024),
      AGREEMENT_REQUEST_TIMEOUT_MS,
      'agreement-timeout',
      'The request timed out. Firebase Storage CORS or permissions may need configuration.',
      { storagePath }
    )
    const text = new TextDecoder('utf-8').decode(bytes)
    if (!String(text || '').trim()) throw agreementError('agreement-empty', 'Seller agreement file is empty.', { storagePath })
    const parsedVersion = parseVersionFromPath(storagePath)
    return returnMetadata ? { markdown: text, source: 'storage-sdk', warning: '', version: parsedVersion?.version || '' } : text
  } catch (bytesError) {
    storageError = bytesError
    const code = String(bytesError?.code || '').toLowerCase()
    if (code.includes('object-not-found')) {
      devWarn('[legalAgreementService] Agreement markdown object missing.', storagePath)
      throw agreementError('object-not-found', 'Seller agreement file is missing.', { storagePath })
    }
    devWarn('[legalAgreementService] SDK agreement download failed; trying download URL fallback.', bytesError?.code || bytesError?.message || bytesError)
  }

  try {
    const downloadUrl = await withTimeout(
      getDownloadURL(agreementRef),
      AGREEMENT_REQUEST_TIMEOUT_MS,
      'agreement-timeout',
      'The request timed out. Firebase Storage CORS or permissions may need configuration.',
      { storagePath }
    )
    const text = await fetchTextWithTimeout(downloadUrl, { storagePath })
    const parsedVersion = parseVersionFromPath(storagePath)
    return returnMetadata ? { markdown: text, source: 'storage-download-url', warning: '', version: parsedVersion?.version || '' } : text
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

function storageDiscoveryEnabled(config = {}) {
  return config.storageDiscoveryEnabled === true || config.versionDiscoveryMode === 'storage'
}

async function getSameOriginAgreementManifest() {
  try {
    const text = await fetchTextWithTimeout(AGREEMENT_MANIFEST_PATH, { fallbackPath: AGREEMENT_MANIFEST_PATH }, 3000)
    const manifest = JSON.parse(text)
    const versions = Array.isArray(manifest.versions) ? manifest.versions : []
    const candidates = versions
      .map((item) => {
        const raw = typeof item === 'string' ? { version: item } : (item || {})
        const version = String(raw.version || '').toLowerCase().replace(/^v?(\d+)$/, 'v$1')
        const storagePath = String(raw.storagePath || (version ? `${AGREEMENT_FOLDER_PATH}/${version}.md` : '')).trim()
        const parsed = parseVersionFromPath(storagePath || `${version}.md`)
        if (!parsed) return null
        return {
          version: parsed.version,
          versionNumber: parsed.versionNumber,
          storagePath,
          publicPath: String(raw.publicPath || `/${storagePath}`).trim()
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.versionNumber - a.versionNumber)
    return candidates[0] || null
  } catch (error) {
    devWarn('[legalAgreementService] Same-origin agreement manifest unavailable.', error?.code || error?.message || error)
    return null
  }
}

export function parseVersionFromPath(path = '') {
  const match = String(path || '').match(/(?:^|\/)(v(\d+))\.md$/i)
  if (!match) return null
  return {
    version: match[1].toLowerCase(),
    versionNumber: Number(match[2]),
    storagePath: path
  }
}

export async function getLatestMarketplaceSellerAgreement() {
  const config = await getMarketplaceSellerAgreementConfig()
  const fallbackPath = config.storagePath || FALLBACK_AGREEMENT_STORAGE_PATH
  const fallbackVersion = String(config.activeVersion || 'v1').toLowerCase()

  if (config.configSource === 'firestore' && config.storagePath) {
    return {
      ...config,
      storagePath: fallbackPath,
      activeVersion: fallbackVersion,
      versionDiscoverySource: 'platform-settings',
      allowStorageFetch: storageDiscoveryEnabled(config)
    }
  }

  const manifestCandidate = await getSameOriginAgreementManifest()
  if (manifestCandidate) {
    return {
      ...config,
      storagePath: manifestCandidate.storagePath,
      publicPath: manifestCandidate.publicPath,
      activeVersion: manifestCandidate.version,
      versionDiscoverySource: 'same-origin-manifest',
      allowStorageFetch: false
    }
  }

  if (!storage || !storageDiscoveryEnabled(config)) {
    return {
      ...config,
      storagePath: fallbackPath,
      activeVersion: fallbackVersion,
      versionDiscoverySource: 'configured-fallback',
      versionDiscoveryWarning: 'Could not verify latest Storage agreement version. Showing configured hosted fallback.',
      allowStorageFetch: false
    }
  }

  try {
    const folderRef = ref(storage, AGREEMENT_FOLDER_PATH)
    const listing = await withTimeout(
      listAll(folderRef),
      AGREEMENT_REQUEST_TIMEOUT_MS,
      'agreement-timeout',
      'The request timed out while listing seller agreement versions.',
      { folderPath: AGREEMENT_FOLDER_PATH }
    )
    const candidates = listing.items
      .map((item) => parseVersionFromPath(item.fullPath))
      .filter(Boolean)
      .sort((a, b) => b.versionNumber - a.versionNumber)
    if (candidates.length) {
      return {
        ...config,
        storagePath: candidates[0].storagePath,
        activeVersion: candidates[0].version,
        versionDiscoverySource: 'storage-list',
        allowStorageFetch: true
      }
    }
  } catch (error) {
    devWarn('[legalAgreementService] Could not list agreement versions from Storage; falling back to config/default.', error?.code || error?.message || error)
    return {
      ...config,
      storagePath: fallbackPath,
      activeVersion: fallbackVersion,
      versionDiscoveryWarning: 'Could not verify latest Storage agreement version. Falling back to configured agreement.',
      versionDiscoveryCode: error?.code || 'agreement-list-failed',
      allowStorageFetch: false
    }
  }

  return {
    ...config,
    storagePath: fallbackPath,
    activeVersion: fallbackVersion,
    versionDiscoverySource: 'configured-fallback',
    allowStorageFetch: false
  }
}
