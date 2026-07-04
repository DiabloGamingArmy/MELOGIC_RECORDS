import { getBytes, ref } from 'firebase/storage'
import { storage } from '../firebase/storage'

export const PRODUCT_LICENSE_VERSION = 1
export const PRODUCT_LICENSE_ROOT = 'legal/licenses/products'

export const PRODUCT_LICENSE_CONFIG = {
  'standard-license': {
    key: 'standard-license',
    label: 'Standard License',
    title: 'Standard License',
    version: PRODUCT_LICENSE_VERSION,
    path: `${PRODUCT_LICENSE_ROOT}/standard-license_v${PRODUCT_LICENSE_VERSION}.md`
  },
  'royalty-free': {
    key: 'royalty-free',
    label: 'Royalty-Free',
    title: 'Royalty-Free License',
    version: PRODUCT_LICENSE_VERSION,
    path: `${PRODUCT_LICENSE_ROOT}/royalty-free_v${PRODUCT_LICENSE_VERSION}.md`
  },
  'custom-license': {
    key: 'custom-license',
    label: 'Custom License',
    title: 'Custom License',
    version: PRODUCT_LICENSE_VERSION,
    path: `${PRODUCT_LICENSE_ROOT}/custom-license_v${PRODUCT_LICENSE_VERSION}.md`
  },
  'exclusive-license': {
    key: 'exclusive-license',
    label: 'Exclusive License',
    title: 'Exclusive License',
    version: PRODUCT_LICENSE_VERSION,
    path: `${PRODUCT_LICENSE_ROOT}/exclusive-license_v${PRODUCT_LICENSE_VERSION}.md`
  }
}

const licenseDocumentCache = new Map()

export function licenseKeyForUsageLicense(value = '') {
  const normalized = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (normalized === 'royalty-free' || normalized === 'royalty-free-license') return 'royalty-free'
  if (normalized === 'standard' || normalized === 'standard-license') return 'standard-license'
  if (normalized === 'custom' || normalized === 'custom-license') return 'custom-license'
  if (normalized === 'exclusive' || normalized === 'exclusive-license') return 'exclusive-license'
  return 'standard-license'
}

export function productLicenseInfo(input = {}) {
  const path = String(input.usageLicensePath || input.licenseDocumentPath || '').trim()
  const explicitKey = String(input.usageLicenseKey || '').trim()
  const key = PRODUCT_LICENSE_CONFIG[explicitKey]
    ? explicitKey
    : licenseKeyForUsageLicense(input.usageLicense || input.label || input.title || '')
  const config = PRODUCT_LICENSE_CONFIG[key] || PRODUCT_LICENSE_CONFIG['standard-license']
  return {
    ...config,
    label: config.label,
    version: Number(input.usageLicenseVersion || config.version || PRODUCT_LICENSE_VERSION),
    path: path || config.path
  }
}

export function productLicenseFields(usageLicense = '') {
  const info = productLicenseInfo({ usageLicense })
  return {
    usageLicense: info.label,
    usageLicenseKey: info.key,
    usageLicenseVersion: info.version,
    usageLicensePath: info.path
  }
}

export async function loadProductLicenseDocument(input = {}) {
  const info = productLicenseInfo(input)
  if (!storage) throw new Error('License document unavailable. Please try again later.')
  if (!String(info.path || '').startsWith(`${PRODUCT_LICENSE_ROOT}/`)) {
    throw new Error('License document unavailable. Please try again later.')
  }
  if (licenseDocumentCache.has(info.path)) return licenseDocumentCache.get(info.path)
  const bytes = await getBytes(ref(storage, info.path), 1024 * 1024)
  const markdown = new TextDecoder('utf-8').decode(bytes)
  if (!String(markdown || '').trim()) throw new Error('License document unavailable. Please try again later.')
  const result = { ...info, markdown }
  licenseDocumentCache.set(info.path, result)
  return result
}
