const DB_NAME = 'melogic-image-previews'
const STORE_NAME = 'previews'
const DB_VERSION = 1

let dbPromise = null

function openDb() {
  if (dbPromise) return dbPromise
  if (!('indexedDB' in window)) return Promise.resolve(null)
  dbPromise = new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'cacheKey' })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
    request.onblocked = () => resolve(null)
  })
  return dbPromise
}

async function readPreview(cacheKey = '') {
  const db = await openDb()
  if (!db || !cacheKey) return null
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const request = tx.objectStore(STORE_NAME).get(cacheKey)
    request.onsuccess = () => resolve(request.result || null)
    request.onerror = () => resolve(null)
  })
}

async function writePreview(entry = {}) {
  const db = await openDb()
  if (!db || !entry.cacheKey) return
  await new Promise((resolve) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(entry)
    tx.oncomplete = () => resolve()
    tx.onerror = () => resolve()
  })
}

function blobFromCanvas(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/webp', 0.72)
  })
}

async function createPreviewBlob(sourceUrl = '', maxSize = 96) {
  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.decoding = 'async'
  img.referrerPolicy = 'no-referrer'
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = reject
    img.src = sourceUrl
  })
  const width = Math.max(1, Number(img.naturalWidth || img.width || maxSize))
  const height = Math.max(1, Number(img.naturalHeight || img.height || maxSize))
  const scale = Math.min(1, maxSize / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) return null
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
  return blobFromCanvas(canvas)
}

export async function loadCachedPreviewImage({ cacheKey = '', sourceUrl = '', versionKey = '', maxSize = 96 } = {}) {
  const key = String(cacheKey || '').trim()
  const source = String(sourceUrl || '').trim()
  const version = String(versionKey || source || '').trim()
  if (!key || !source) return { previewUrl: '', sourceUrl: source, cached: false, refresh: Promise.resolve(null) }

  const cached = await readPreview(key)
  let previewUrl = ''
  if (cached?.versionKey === version && cached?.blob instanceof Blob) {
    previewUrl = URL.createObjectURL(cached.blob)
  }

  const refresh = (async () => {
    try {
      const blob = await createPreviewBlob(source, maxSize)
      if (!blob) return null
      await writePreview({ cacheKey: key, versionKey: version, blob, updatedAt: Date.now() })
      return URL.createObjectURL(blob)
    } catch {
      return null
    }
  })()

  return { previewUrl, sourceUrl: source, cached: Boolean(previewUrl), refresh }
}

export async function applyCachedPreviewImage(element, options = {}) {
  if (!element) return ''
  const mode = options.asBackground ? 'background' : 'image'
  const result = await loadCachedPreviewImage(options)
  if (result.previewUrl) {
    if (mode === 'background') element.style.backgroundImage = `url("${result.previewUrl}")`
    else element.src = result.previewUrl
  } else if (result.sourceUrl) {
    if (mode === 'background') element.style.backgroundImage = `url("${result.sourceUrl}")`
    else element.src = result.sourceUrl
  }
  result.refresh.then((freshPreviewUrl) => {
    if (!freshPreviewUrl || !element.isConnected) return
    if (mode === 'background') element.style.backgroundImage = `url("${freshPreviewUrl}")`
    else element.src = freshPreviewUrl
  }).catch(() => {})
  return result.previewUrl || result.sourceUrl || ''
}
