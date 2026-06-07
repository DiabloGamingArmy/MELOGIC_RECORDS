import { BUILT_IN_WAVETABLE_METADATA } from './instruments/wavetableAssets.js'

export const AUDIO_ASSET_TYPES = ['wavetable', 'one-shot', 'loop', 'multisample', 'preset', 'impulse-response']

export const STOCK_SOUND_PACKS = [
  {
    packId: 'melogic-basic-waves',
    title: 'Melogic Basic Waves',
    type: 'wavetable',
    visibility: 'public',
    license: 'Melogic built-in',
    tags: ['basic', 'starter']
  },
  {
    packId: 'melogic-digital-tests',
    title: 'Melogic Digital Tests',
    type: 'wavetable',
    visibility: 'public',
    license: 'Melogic built-in',
    tags: ['digital', 'starter']
  }
]

export const LOCAL_AUDIO_ASSETS = [
  ...BUILT_IN_WAVETABLE_METADATA.map((asset) => ({
    ...asset,
    id: asset.assetId,
    packId: asset.assetId === 'builtin-digital-glass' ? 'melogic-digital-tests' : 'melogic-basic-waves',
    favorite: false,
    source: 'generated',
    previewPath: ''
  })),
  {
    id: 'future-one-shot-kick',
    assetId: 'future-one-shot-kick',
    type: 'one-shot',
    title: 'Kick Placeholder',
    creatorUid: 'system',
    packId: 'melogic-future-drums',
    storagePath: 'audio/samples/melogic-future-drums/kick-placeholder.wav',
    previewPath: 'audio/previews/future-one-shot-kick.mp3',
    tags: ['drum', 'placeholder'],
    visibility: 'public',
    license: 'Melogic stock placeholder',
    checksum: '',
    version: 1,
    favorite: false,
    source: 'remote-placeholder'
  }
]

const resolvedUrlCache = new Map()

function normalizeText(value = '') {
  return String(value || '').trim().toLowerCase()
}

export function listAudioAssetMetadata({ type = '', packId = '', tag = '', search = '' } = {}) {
  const cleanType = normalizeText(type)
  const cleanPack = normalizeText(packId)
  const cleanTag = normalizeText(tag)
  const cleanSearch = normalizeText(search)
  return LOCAL_AUDIO_ASSETS.filter((asset) => {
    if (cleanType && asset.type !== cleanType) return false
    if (cleanPack && asset.packId !== cleanPack) return false
    if (cleanTag && !(asset.tags || []).includes(cleanTag)) return false
    if (cleanSearch) {
      const haystack = [asset.title, asset.packId, ...(asset.tags || [])].join(' ').toLowerCase()
      if (!haystack.includes(cleanSearch)) return false
    }
    return true
  })
}

export function getAudioAssetById(assetId = '') {
  const clean = String(assetId || '').trim()
  return LOCAL_AUDIO_ASSETS.find((asset) => asset.id === clean || asset.assetId === clean) || null
}

export async function resolveAudioAssetUrl(assetId = '', { getDownloadURL, storageRef } = {}) {
  const asset = getAudioAssetById(assetId)
  if (!asset) return null
  if (resolvedUrlCache.has(asset.id)) return resolvedUrlCache.get(asset.id)
  if (asset.source === 'generated' || !asset.storagePath) {
    resolvedUrlCache.set(asset.id, '')
    return ''
  }
  if (typeof getDownloadURL !== 'function' || typeof storageRef !== 'function') {
    return null
  }
  const url = await getDownloadURL(storageRef(asset.storagePath))
  resolvedUrlCache.set(asset.id, url)
  return url
}

export function getAudioAssetCacheStatus(assetId = '') {
  const asset = getAudioAssetById(assetId)
  if (!asset) return 'missing'
  if (asset.source === 'generated') return 'generated'
  return resolvedUrlCache.has(asset.id) ? 'session-cached-url' : 'metadata-only'
}

export function primeIndexedDbCachePlaceholder() {
  return {
    enabled: false,
    strategy: 'future-indexeddb-audio-buffer-cache',
    note: 'Binary audio cache hooks will live outside Firestore and load assets on demand.'
  }
}
