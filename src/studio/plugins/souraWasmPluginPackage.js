import JSZip from 'jszip'

export const SOURA_PLUGIN_IMPORT_ID = '__soura_plugin_import__'
export const SOURA_WASM_PLUGIN_PREFIX = 'soura-wasm:'
export const SOURA_WASM_ABI = 'soura-wasm-instrument-v1'
const META_KEY = 'melogic:soura:wasmPlugins:v1'
const DB_NAME = 'melogic-soura-plugin-packages-v1'
const STORE_NAME = 'packages'

function readMetadata() {
  try {
    const parsed = JSON.parse(localStorage.getItem(META_KEY) || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch { return [] }
}

function writeMetadata(items) {
  localStorage.setItem(META_KEY, JSON.stringify(items || []))
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'packageId' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('Unable to open Soura plugin database.'))
  })
}

async function putPackage(record) {
  const db = await openDb()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(record)
    tx.oncomplete = resolve
    tx.onerror = () => reject(tx.error || new Error('Unable to store Soura plugin package.'))
  })
  db.close()
}

export async function getSouraPluginPackage(packageId = '') {
  const db = await openDb()
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(String(packageId || ''))
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => reject(request.error || new Error('Unable to read Soura plugin package.'))
  })
  db.close()
  return result
}

function cleanId(value = '') {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
}

function validateManifest(raw) {
  const manifest = raw && typeof raw === 'object' ? raw : null
  if (!manifest) throw new Error('manifest.json must contain a JSON object.')
  if (manifest.format !== 'soura-plugin') throw new Error('Unsupported plugin format. Expected "soura-plugin".')
  if (Number(manifest.formatVersion) !== 1) throw new Error('Unsupported Soura plugin formatVersion. Expected 1.')
  if (manifest.category !== 'instrument') throw new Error('This runtime currently supports instrument packages only.')
  if (manifest.abi !== SOURA_WASM_ABI) throw new Error(`Unsupported plugin ABI. Expected ${SOURA_WASM_ABI}.`)
  const id = cleanId(manifest.id)
  if (!id) throw new Error('Plugin manifest requires a stable id.')
  const name = String(manifest.name || '').trim()
  if (!name) throw new Error('Plugin manifest requires a name.')
  const processor = String(manifest.processor || 'processor.wasm').trim()
  const parameters = Array.isArray(manifest.parameters) ? manifest.parameters.map((parameter, index) => ({
    id: cleanId(parameter?.id || `param-${index}`),
    name: String(parameter?.name || parameter?.id || `Parameter ${index + 1}`),
    index: Number.isInteger(Number(parameter?.index)) ? Number(parameter.index) : index,
    default: Number.isFinite(Number(parameter?.default)) ? Number(parameter.default) : 0,
    min: Number.isFinite(Number(parameter?.min)) ? Number(parameter.min) : 0,
    max: Number.isFinite(Number(parameter?.max)) ? Number(parameter.max) : 1,
    unit: String(parameter?.unit || '')
  })) : []
  return {
    ...manifest,
    id,
    name,
    vendor: String(manifest.vendor || 'Unknown developer'),
    version: String(manifest.version || '0.0.0'),
    processor,
    parameters
  }
}

export function toSouraPluginType(packageId = '') {
  return `${SOURA_WASM_PLUGIN_PREFIX}${cleanId(packageId)}`
}

export function getPackageIdFromPluginType(pluginType = '') {
  const value = String(pluginType || '')
  return value.startsWith(SOURA_WASM_PLUGIN_PREFIX) ? value.slice(SOURA_WASM_PLUGIN_PREFIX.length) : ''
}

export function isSouraWasmPluginType(pluginType = '') {
  return Boolean(getPackageIdFromPluginType(pluginType))
}

export function listInstalledSouraPluginManifests() {
  return readMetadata().map((item) => ({
    id: toSouraPluginType(item.packageId),
    packageId: item.packageId,
    name: item.name,
    category: 'instrument',
    vendor: item.vendor || 'Unknown developer',
    version: item.version || '0.0.0',
    supportsDetachedWindow: false,
    supportsMidiInput: true,
    supportsAudioOutput: true,
    souraWasm: true,
    parameters: Array.isArray(item.parameters) ? item.parameters : []
  }))
}

export function getInstalledSouraPluginManifestByType(pluginType = '') {
  return listInstalledSouraPluginManifests().find((item) => item.id === pluginType) || null
}

export async function importSouraPluginFile(file) {
  if (!file) return null
  const zip = await JSZip.loadAsync(await file.arrayBuffer())
  const manifestEntry = zip.file('manifest.json')
  if (!manifestEntry) throw new Error('Soura plugin package is missing manifest.json.')
  const manifest = validateManifest(JSON.parse(await manifestEntry.async('text')))
  const processorEntry = zip.file(manifest.processor)
  if (!processorEntry) throw new Error(`Soura plugin package is missing ${manifest.processor}.`)
  const wasmBytes = await processorEntry.async('arraybuffer')
  if (!WebAssembly.validate(wasmBytes)) throw new Error('processor.wasm is not a valid WebAssembly module.')

  const packageId = manifest.id
  const record = {
    packageId,
    manifest,
    wasmBytes,
    importedAt: Date.now()
  }
  await putPackage(record)

  const items = readMetadata().filter((item) => item.packageId !== packageId)
  items.push({
    packageId,
    name: manifest.name,
    vendor: manifest.vendor,
    version: manifest.version,
    parameters: manifest.parameters
  })
  writeMetadata(items.sort((a, b) => a.name.localeCompare(b.name)))
  return { packageId, pluginType: toSouraPluginType(packageId), manifest }
}

export function chooseAndImportSouraPlugin() {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.soura-plugin,.soura,application/zip'
    input.hidden = true
    input.addEventListener('change', async () => {
      try { resolve(await importSouraPluginFile(input.files?.[0] || null)) }
      catch (error) { reject(error) }
      finally { input.remove() }
    }, { once: true })
    document.body.appendChild(input)
    input.click()
  })
}
