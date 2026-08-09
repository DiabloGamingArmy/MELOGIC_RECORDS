import { createPackageAssetProvider } from './packageAssetProvider.js'
import { vertixPackageIdentity } from './packageManifest.js'
import { validateVertixPackManifest } from './packageValidator.js'

export const PackAvailability = Object.freeze({
  AVAILABLE: 'AVAILABLE',
  INSTALLED: 'INSTALLED',
  UNAVAILABLE: 'UNAVAILABLE',
  MISSING: 'MISSING',
  INCOMPATIBLE: 'INCOMPATIBLE'
})

const clone = (value) => JSON.parse(JSON.stringify(value ?? null))
const recordKey = (packId, version) => `${String(packId || '')}@${String(version || '')}`
const activeAvailability = new Set([PackAvailability.AVAILABLE, PackAvailability.INSTALLED])

/** Small metadata-only persistence boundary. Pack binaries are never stored here. */
export function createMemoryPackRegistryStorage(records = []) {
  let snapshot = clone(records) || []
  return Object.freeze({ read: () => clone(snapshot) || [], write: (next) => { snapshot = clone(next) || [] } })
}

export function createBrowserPackRegistryStorage(storageKey = 'vertixPackInstallRegistry') {
  return Object.freeze({
    read: () => {
      try { return JSON.parse(globalThis.localStorage?.getItem(storageKey) || '[]') } catch { return [] }
    },
    write: (records) => {
      try { globalThis.localStorage?.setItem(storageKey, JSON.stringify(records)) } catch {}
    }
  })
}

/**
 * Environment-neutral pack registry. Desktop callers may retain a local
 * location; web callers can retain only authorized source metadata. Neither
 * form serializes into a project object reference.
 */
export function createPackInstallationRegistry({ assetRegistry, environment = 'web', storage = createMemoryPackRegistryStorage() } = {}) {
  const records = new Map()
  const providerIds = new Map()
  const isDesktop = environment === 'desktop' || environment === 'executable'

  const persist = () => storage?.write?.([...records.values()].map(clone))
  const unregister = (key) => {
    const providerId = providerIds.get(key)
    if (providerId) assetRegistry?.unregisterProvider?.(providerId)
    providerIds.delete(key)
  }
  const register = (record) => {
    const key = recordKey(record.packId, record.version)
    unregister(key)
    if (!activeAvailability.has(record.availability) || !record.manifest || !assetRegistry?.registerProvider) return
    try {
      const provider = createPackageAssetProvider(record.manifest)
      assetRegistry.registerProvider(provider)
      providerIds.set(key, provider.id)
    } catch {
      record.availability = PackAvailability.INCOMPATIBLE
    }
  }
  const loadRecord = (raw) => {
    const validation = validateVertixPackManifest(raw?.manifest)
    if (!validation.valid) return null
    const manifest = validation.manifest
    const record = {
      packId: manifest.id,
      version: manifest.version,
      publisherId: manifest.publisher.id,
      manifest,
      location: isDesktop && typeof raw.location === 'string' ? raw.location : '',
      source: raw.source === 'local' ? 'local' : 'remote',
      availability: Object.values(PackAvailability).includes(raw.availability) ? raw.availability : PackAvailability.UNAVAILABLE,
      integrity: manifest.integrity || '',
      updatedAt: raw.updatedAt || ''
    }
    records.set(recordKey(record.packId, record.version), record)
    register(record)
    return clone(record)
  }

  const hydrate = () => {
    records.clear()
    providerIds.forEach((providerId) => assetRegistry?.unregisterProvider?.(providerId))
    providerIds.clear()
    const loaded = (storage?.read?.() || []).map(loadRecord).filter(Boolean)
    persist()
    return loaded
  }
  const install = (manifestInput, { location = '', source = isDesktop ? 'local' : 'remote', availability } = {}) => {
    const validation = validateVertixPackManifest(manifestInput)
    if (!validation.valid) return Object.freeze({ ok: false, availability: PackAvailability.INCOMPATIBLE, validation })
    const manifest = validation.manifest
    const record = {
      packId: manifest.id,
      version: manifest.version,
      publisherId: manifest.publisher.id,
      manifest: clone(manifest),
      location: isDesktop && typeof location === 'string' ? location : '',
      source: source === 'local' ? 'local' : 'remote',
      availability: availability || (isDesktop ? PackAvailability.INSTALLED : PackAvailability.AVAILABLE),
      integrity: manifest.integrity || '',
      updatedAt: new Date().toISOString()
    }
    records.set(recordKey(record.packId, record.version), record)
    register(record)
    persist()
    return Object.freeze({ ok: record.availability !== PackAvailability.INCOMPATIBLE, record: clone(record), identity: vertixPackageIdentity(manifest), validation })
  }
  const setAvailability = (packId, version, availability) => {
    const record = records.get(recordKey(packId, version))
    if (!record || !Object.values(PackAvailability).includes(availability)) return null
    record.availability = availability
    record.updatedAt = new Date().toISOString()
    register(record)
    persist()
    return clone(record)
  }
  const relink = (manifestInput, location = '') => {
    if (!isDesktop) return Object.freeze({ ok: false, availability: PackAvailability.UNAVAILABLE, reason: 'LOCAL_RELINK_UNSUPPORTED_ON_WEB' })
    const validation = validateVertixPackManifest(manifestInput)
    if (!validation.valid) return Object.freeze({ ok: false, availability: PackAvailability.INCOMPATIBLE, validation })
    return install(validation.manifest, { location, source: 'local', availability: PackAvailability.INSTALLED })
  }
  const availabilityFor = ({ packageId, packageVersion } = {}) => {
    const exact = records.get(recordKey(packageId, packageVersion))
    if (exact) return Object.freeze({ availability: exact.availability, record: clone(exact) })
    const samePack = [...records.values()].find((record) => record.packId === packageId)
    return samePack
      ? Object.freeze({ availability: PackAvailability.INCOMPATIBLE, record: clone(samePack) })
      : Object.freeze({ availability: PackAvailability.MISSING, record: null })
  }

  return Object.freeze({ environment, hydrate, install, relink, setAvailability, availabilityFor, list: () => [...records.values()].map(clone) })
}
