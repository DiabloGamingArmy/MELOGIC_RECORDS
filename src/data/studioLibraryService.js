import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, setDoc } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytesResumable } from 'firebase/storage'
import { db } from '../firebase/firestore.js'
import { storage } from '../firebase/storage.js'
import { noteNameToMidi, parseSampleFileName } from '../utils/studioSampleNames.js'

export { noteNameToMidi, parseSampleFileName } from '../utils/studioSampleNames.js'

export const STUDIO_LIBRARY_DOCUMENT_PATH = '/studioDawDefaults/libraryContent'
export const STUDIO_LIBRARY_STORAGE_ROOT = '/studioDawDefaults/libraryContent'

export const STUDIO_LIBRARY_SOURCE_ROOTS = [
  { id: 'melogic-records', label: 'Melogic Records' },
  { id: 'external', label: 'External' },
  { id: 'user', label: 'User' }
]

export const STUDIO_LIBRARY_ENGINE_TYPES = [
  { id: 'sample-based', label: 'Sample Based' },
  { id: 'vst', label: 'VST' },
  { id: 'wavetable', label: 'Wavetable' }
]

const LIBRARY_REF = ['studioDawDefaults', 'libraryContent']
const VALID_SAMPLE_STRATEGIES = new Set(['octave-roots', 'double', 'thirds', 'chromatic', 'custom', 'drum-map'])
const VALID_LICENSE_TYPES = new Set(['owned', 'CC0', 'CC BY', 'custom'])
const assetUrlCache = new Map()

export const STUDIO_SAMPLE_STRATEGIES = [
  { id: 'octave-roots', label: 'Octave Roots', description: 'C per octave', pitchClasses: [0] },
  { id: 'double', label: 'Double', description: 'C and F# per octave', pitchClasses: [0, 6] },
  { id: 'thirds', label: 'Thirds', description: 'C, D#/Eb, F#/Gb, and A per octave', pitchClasses: [0, 3, 6, 9] },
  { id: 'chromatic', label: 'Chromatic', description: 'One sample per note', pitchClasses: Array.from({ length: 12 }, (_, index) => index) },
  { id: 'custom', label: 'Custom', description: 'Arbitrary valid note + octave WAV roots', pitchClasses: null },
  { id: 'drum-map', label: 'Drum Map', description: 'One-shot drum mappings', pitchClasses: null }
]

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function cleanPath(value = '') {
  const path = cleanString(value, 1000).replace(/\\/g, '/').replace(/\/+/g, '/')
  if (!path || path.includes('..')) return ''
  return path.startsWith('/') ? path : `/${path}`
}

function storageRefPath(value = '') {
  return cleanPath(value).replace(/^\/+/, '')
}

function safeInteger(value, fallback = 1, min = 1, max = 100000) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback
}

export function studioLibrarySlug(value = '') {
  return cleanString(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

export function sourceRootLabel(sourceRoot = '') {
  return STUDIO_LIBRARY_SOURCE_ROOTS.find((item) => item.id === sourceRoot)?.label || ''
}

export function engineTypeLabel(engineType = '') {
  return STUDIO_LIBRARY_ENGINE_TYPES.find((item) => item.id === engineType)?.label || ''
}

export function sampleStrategyDefinition(strategy = '') {
  return STUDIO_SAMPLE_STRATEGIES.find((item) => item.id === strategy) || STUDIO_SAMPLE_STRATEGIES.find((item) => item.id === 'custom')
}

export function getSampleStrategyWarnings(strategy = '', samples = []) {
  const definition = sampleStrategyDefinition(strategy)
  if (!definition?.pitchClasses || !Array.isArray(samples) || !samples.length) return []
  const found = new Set(samples.map((sample) => ((Number(sample.rootMidi) % 12) + 12) % 12))
  const missing = definition.pitchClasses.filter((pitchClass) => !found.has(pitchClass))
  const unexpected = [...found].filter((pitchClass) => !definition.pitchClasses.includes(pitchClass))
  const warnings = []
  if (missing.length) warnings.push(`${definition.label} usually includes ${definition.description.toLowerCase()}; this upload is missing ${missing.length} expected pitch class${missing.length === 1 ? '' : 'es'}.`)
  if (unexpected.length) warnings.push(`${unexpected.length} additional pitch class${unexpected.length === 1 ? '' : 'es'} will still be mapped by nearest sample.`)
  return warnings
}

export function studioLibraryFolderPath(sourceRoot = '', engineType = '') {
  const source = sourceRootLabel(sourceRoot)
  const engine = engineTypeLabel(engineType)
  return source && engine ? `${source}/${engine}` : ''
}

export function createDefaultStudioLibraryFolders() {
  return STUDIO_LIBRARY_SOURCE_ROOTS.map((source) => ({
    id: source.id,
    label: source.label,
    type: 'source-root',
    children: STUDIO_LIBRARY_ENGINE_TYPES.map((engine) => ({
      id: `${source.id}-${engine.id}`,
      label: engine.label,
      type: 'engine-folder',
      engineType: engine.id,
      path: `${source.label}/${engine.label}`
    }))
  }))
}

export function createDefaultStudioLibraryContent() {
  return {
    version: 1,
    rootLabel: 'Library',
    storageRoot: STUDIO_LIBRARY_STORAGE_ROOT,
    folders: createDefaultStudioLibraryFolders(),
    instruments: []
  }
}

function normalizeFolder(raw = {}) {
  const children = Array.isArray(raw.children) ? raw.children : []
  return {
    id: cleanString(raw.id, 100),
    label: cleanString(raw.label, 120),
    type: raw.type === 'engine-folder' ? 'engine-folder' : 'source-root',
    ...(children.length ? { children: children.map(normalizeFolder).filter((item) => item.id && item.label) } : {}),
    ...(raw.engineType ? { engineType: cleanString(raw.engineType, 40) } : {}),
    ...(raw.path ? { path: cleanString(raw.path, 240) } : {})
  }
}

function normalizeSample(raw = {}) {
  const parsed = parseSampleFileName(raw.fileName || raw.path || '')
  if (!parsed) return null
  const path = cleanPath(raw.path)
  if (!path.startsWith(`${STUDIO_LIBRARY_STORAGE_ROOT}/`)) return null
  return {
    fileName: parsed.fileName,
    note: parsed.note,
    rootMidi: parsed.rootMidi,
    path
  }
}

export function normalizeDefaultInstrument(raw = {}) {
  const sourceRoot = STUDIO_LIBRARY_SOURCE_ROOTS.some((item) => item.id === raw.sourceRoot) ? raw.sourceRoot : 'melogic-records'
  const engineType = STUDIO_LIBRARY_ENGINE_TYPES.some((item) => item.id === raw.engineType) ? raw.engineType : 'sample-based'
  const id = studioLibrarySlug(raw.id || raw.name)
  const version = safeInteger(raw.version, 1)
  const folderPath = studioLibraryFolderPath(sourceRoot, engineType)
  const storageBasePath = cleanPath(raw.storageBasePath || `${STUDIO_LIBRARY_STORAGE_ROOT}/${folderPath}/${id}/v${version}`)
  const samplesPath = engineType === 'sample-based' ? cleanPath(raw.samplesPath || `${storageBasePath}/samples`) : ''
  const license = raw.license && typeof raw.license === 'object' ? raw.license : {}
  return {
    id,
    name: cleanString(raw.name || id, 160),
    folderPath,
    sourceRoot,
    engineType,
    sampleStrategy: engineType === 'sample-based' && VALID_SAMPLE_STRATEGIES.has(raw.sampleStrategy) ? raw.sampleStrategy : '',
    description: cleanString(raw.description, 1200),
    enabled: raw.enabled !== false,
    visibility: raw.visibility === 'private' ? 'private' : 'public',
    version,
    storageBasePath,
    samplesPath,
    artworkPath: cleanPath(raw.artworkPath),
    samples: engineType === 'sample-based' && Array.isArray(raw.samples) ? raw.samples.map(normalizeSample).filter(Boolean) : [],
    runtime: engineType === 'vst' ? 'html-audio-midi' : cleanString(raw.runtime, 80),
    htmlSourcePath: engineType === 'vst' ? cleanPath(raw.htmlSourcePath || `${storageBasePath}/plugin.html`) : '',
    acceptsMidi: engineType === 'vst' ? raw.acceptsMidi !== false : false,
    outputsAudio: engineType === 'vst' ? raw.outputsAudio !== false : false,
    sandboxed: engineType === 'vst' ? raw.sandboxed !== false : false,
    license: {
      type: VALID_LICENSE_TYPES.has(license.type) ? license.type : 'owned',
      attributionRequired: license.attributionRequired === true,
      commercialAllowed: license.commercialAllowed !== false,
      sourceName: cleanString(license.sourceName, 180),
      sourceUrl: cleanString(license.sourceUrl, 500),
      licenseUrl: cleanString(license.licenseUrl, 500)
    }
  }
}

export function normalizeDefaultLibraryContent(raw = {}) {
  const folders = Array.isArray(raw.folders) ? raw.folders.map(normalizeFolder).filter((item) => item.id && item.label) : []
  return {
    version: safeInteger(raw.version, 1),
    rootLabel: cleanString(raw.rootLabel || 'Library', 80),
    storageRoot: cleanPath(raw.storageRoot || STUDIO_LIBRARY_STORAGE_ROOT),
    folders,
    instruments: Array.isArray(raw.instruments) ? raw.instruments.map(normalizeDefaultInstrument).filter((item) => item.id && item.name) : [],
    updatedAt: raw.updatedAt || null
  }
}

export async function getDefaultLibraryContent() {
  const snapshot = await getDoc(doc(db, ...LIBRARY_REF))
  return snapshot.exists() ? normalizeDefaultLibraryContent(snapshot.data()) : null
}

export function watchDefaultLibraryContent(callback, onError) {
  return onSnapshot(doc(db, ...LIBRARY_REF), (snapshot) => {
    callback(snapshot.exists() ? normalizeDefaultLibraryContent(snapshot.data()) : null)
  }, onError)
}

export async function initializeDefaultLibraryContent() {
  const defaults = createDefaultStudioLibraryContent()
  const reference = doc(db, ...LIBRARY_REF)
  const snapshot = await getDoc(reference)
  const current = snapshot.exists() ? normalizeDefaultLibraryContent(snapshot.data()) : null
  const payload = {
    ...defaults,
    version: Math.max(defaults.version, current?.version || 1),
    instruments: current?.instruments || [],
    updatedAt: serverTimestamp()
  }
  await setDoc(reference, payload, { merge: true })
  return normalizeDefaultLibraryContent(payload)
}

export async function saveDefaultLibraryContent(payload = {}) {
  const normalized = normalizeDefaultLibraryContent(payload)
  await setDoc(doc(db, ...LIBRARY_REF), { ...normalized, updatedAt: serverTimestamp() }, { merge: true })
  return normalized
}

export async function addDefaultInstrumentToLibrary(instrumentPayload = {}, { overwrite = false } = {}) {
  const instrument = normalizeDefaultInstrument(instrumentPayload)
  if (!instrument.id || !instrument.name) throw new Error('Instrument name and ID are required.')
  await runTransaction(db, async (transaction) => {
    const reference = doc(db, ...LIBRARY_REF)
    const snapshot = await transaction.get(reference)
    const library = snapshot.exists() ? normalizeDefaultLibraryContent(snapshot.data()) : createDefaultStudioLibraryContent()
    const existingIndex = library.instruments.findIndex((item) => item.id === instrument.id)
    if (existingIndex >= 0 && !overwrite) throw new Error(`Instrument ID "${instrument.id}" already exists. Enable overwrite to replace it.`)
    const instruments = [...library.instruments]
    if (existingIndex >= 0) instruments.splice(existingIndex, 1, instrument)
    else instruments.push(instrument)
    transaction.set(reference, {
      ...library,
      folders: library.folders.length ? library.folders : createDefaultStudioLibraryFolders(),
      instruments,
      updatedAt: serverTimestamp()
    }, { merge: true })
  })
  return instrument
}

export async function updateDefaultInstrument(instrumentId = '', patch = {}) {
  const id = studioLibrarySlug(instrumentId)
  if (!id) throw new Error('Instrument ID is required.')
  let updated = null
  await runTransaction(db, async (transaction) => {
    const reference = doc(db, ...LIBRARY_REF)
    const snapshot = await transaction.get(reference)
    if (!snapshot.exists()) throw new Error('Default Studio library has not been initialized.')
    const library = normalizeDefaultLibraryContent(snapshot.data())
    const index = library.instruments.findIndex((item) => item.id === id)
    if (index < 0) throw new Error('Instrument was not found.')
    updated = normalizeDefaultInstrument({ ...library.instruments[index], ...patch, id })
    const instruments = [...library.instruments]
    instruments.splice(index, 1, updated)
    transaction.update(reference, { instruments, updatedAt: serverTimestamp() })
  })
  return updated
}

export async function parseDefaultInstrumentArchive(zipFile) {
  if (!zipFile) return []
  if (Number(zipFile.size) > 500 * 1024 * 1024) throw new Error('Audio ZIP must be 500 MB or smaller.')
  const { default: JSZip } = await import('jszip')
  const archive = await JSZip.loadAsync(zipFile)
  const rows = []
  const seenFileNames = new Set()
  const entries = Object.values(archive.files).filter((entry) => !entry.dir)
  for (const entry of entries) {
    const parsed = parseSampleFileName(entry.name)
    if (!parsed) continue
    if (seenFileNames.has(parsed.fileName)) throw new Error(`Duplicate sample filename "${parsed.fileName}" was found in the ZIP.`)
    if (rows.length >= 2048) throw new Error('Audio ZIP contains more than the supported 2,048 mapped samples.')
    const blob = await entry.async('blob')
    if (blob.size > 100 * 1024 * 1024) throw new Error(`${parsed.fileName} is larger than the 100 MB per-sample limit.`)
    seenFileNames.add(parsed.fileName)
    rows.push({ ...parsed, file: new File([blob], parsed.fileName, { type: 'audio/wav' }), archivePath: entry.name })
  }
  rows.sort((a, b) => a.rootMidi - b.rootMidi || a.fileName.localeCompare(b.fileName))
  return rows
}

export function buildSamplesFromFiles(files = [], baseStoragePath = '') {
  const basePath = cleanPath(baseStoragePath)
  return Array.from(files || []).map((row) => {
    const file = row?.file || row
    const parsed = parseSampleFileName(row?.fileName || file?.name)
    return parsed && file ? { ...parsed, file, path: `${basePath}/${parsed.fileName}` } : null
  }).filter(Boolean)
}

function uploadFile(file, storagePath, metadata = {}, onProgress) {
  if (!storage) throw new Error('Firebase Storage is not available.')
  const path = storageRefPath(storagePath)
  if (!path.startsWith(`${storageRefPath(STUDIO_LIBRARY_STORAGE_ROOT)}/`)) throw new Error('Invalid default Studio library Storage path.')
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, metadata)
    task.on('state_changed', (snapshot) => {
      onProgress?.(snapshot.totalBytes ? snapshot.bytesTransferred / snapshot.totalBytes : 0)
    }, reject, () => resolve({ path: `/${path}`, snapshot: task.snapshot }))
  })
}

export function uploadDefaultInstrumentSample(file, storagePath, onProgress) {
  return uploadFile(file, storagePath, { contentType: 'audio/wav' }, onProgress)
}

export function uploadDefaultInstrumentArtwork(file, storagePath, onProgress) {
  return uploadFile(file, storagePath, { contentType: file?.type || 'image/webp' }, onProgress)
}

export function uploadDefaultInstrumentHtmlSource(file, storagePath, onProgress) {
  return uploadFile(file, storagePath, { contentType: 'text/html; charset=utf-8' }, onProgress)
}

export async function getStudioLibraryAssetUrl(storagePath = '') {
  const path = storageRefPath(storagePath)
  if (!path.startsWith(`${storageRefPath(STUDIO_LIBRARY_STORAGE_ROOT)}/`)) throw new Error('Invalid Studio library asset path.')
  if (!assetUrlCache.has(path)) {
    assetUrlCache.set(path, getDownloadURL(ref(storage, path)).catch((error) => {
      assetUrlCache.delete(path)
      throw error
    }))
  }
  return assetUrlCache.get(path)
}
