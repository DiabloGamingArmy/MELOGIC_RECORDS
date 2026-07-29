const DEFAULT_HLS_EDGE_BASE_URL = 'https://stream.melogicrecords.studio/live'
export const HLS_EDGE_BASE_URL = String(import.meta.env?.VITE_STREAM_EDGE_BASE_URL || DEFAULT_HLS_EDGE_BASE_URL).trim().replace(/\/+$/, '')

const HLS_EDGE_URL_PREFIX = `${HLS_EDGE_BASE_URL}/`
const activePlayers = new WeakMap()

export function sanitizeHlsStreamKey(streamKey = '') {
  return String(streamKey || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
}

export function buildHlsPlaybackUrl(streamKey = '') {
  const cleanKey = sanitizeHlsStreamKey(streamKey)
  if (!cleanKey) return ''
  return `${HLS_EDGE_BASE_URL}/${cleanKey}.m3u8`
}

export function isAllowedHlsPlaybackUrl(value = '') {
  const candidate = String(value || '').trim()
  if (!candidate.startsWith(HLS_EDGE_URL_PREFIX)) return false
  try {
    const parsed = new URL(candidate)
    const allowedBase = new URL(`${HLS_EDGE_BASE_URL}/`)
    const expectedPathPrefix = allowedBase.pathname.endsWith('/') ? allowedBase.pathname : `${allowedBase.pathname}/`
    return parsed.protocol === allowedBase.protocol
      && parsed.host === allowedBase.host
      && parsed.pathname.startsWith(expectedPathPrefix)
      && /^[A-Za-z0-9_-]+\.m3u8$/.test(parsed.pathname.slice(expectedPathPrefix.length))
      && parsed.search === ''
      && parsed.hash === ''
  } catch {
    return false
  }
}

export function resolveHlsPlaybackUrl({ streamKey = '', hlsPlaybackUrl = '' } = {}) {
  const keyUrl = buildHlsPlaybackUrl(streamKey)
  if (keyUrl) return keyUrl
  return isAllowedHlsPlaybackUrl(hlsPlaybackUrl) ? String(hlsPlaybackUrl).trim() : ''
}

export function canPlayNativeHls(mediaEl) {
  return Boolean(
    mediaEl?.canPlayType?.('application/vnd.apple.mpegurl') ||
    mediaEl?.canPlayType?.('application/x-mpegURL')
  )
}

function clearMedia(mediaEl) {
  try { mediaEl.pause() } catch {}
  mediaEl.removeAttribute('src')
  try { mediaEl.load() } catch {}
}

function destroyActivePlayer(mediaEl) {
  const active = activePlayers.get(mediaEl)
  if (!active) return
  active.cleanup()
}

export function setHlsQualityLevel(mediaEl, requestedLevel = -1) {
  const active = activePlayers.get(mediaEl)
  const hls = active?.hls
  if (!hls) return false
  const level = Number(requestedLevel)
  const nextLevel = Number.isInteger(level) && level >= 0 && level < hls.levels.length ? level : -1
  hls.currentLevel = nextLevel
  hls.nextLevel = nextLevel
  return true
}

export async function attachHlsStream({
  mediaEl,
  src,
  mode = 'videoAudio',
  onStatus = () => {},
  onError = () => {}
}) {
  if (!mediaEl) throw new Error('An HTML media element is required for HLS playback.')
  if (!isAllowedHlsPlaybackUrl(src)) throw new Error('Invalid HLS playback URL. Streams must load from stream.melogicrecords.studio.')
  destroyActivePlayer(mediaEl)

  const listeners = []
  let hls = null
  let cleaned = false
  const listen = (eventName, callback) => {
    mediaEl.addEventListener(eventName, callback)
    listeners.push([eventName, callback])
  }
  const emitMediaStatus = (status) => {
    console.info('[hls-edge] status', { status, mode, src })
    onStatus({ status, mode, src, mediaEl, hls })
  }
  ;['canplay', 'playing', 'waiting', 'stalled', 'ended'].forEach((eventName) => listen(eventName, () => emitMediaStatus(eventName)))
  listen('error', () => {
    const error = mediaEl.error
    const payload = {
      status: 'error',
      type: 'mediaError',
      details: error?.message || `HTML media error ${error?.code || ''}`.trim(),
      fatal: true,
      mediaErrorCode: error?.code ?? null
    }
    console.error('[hls-edge] media error', payload)
    onStatus({ ...payload, mode, src, mediaEl, hls })
    onError(payload)
  })

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    listeners.forEach(([eventName, callback]) => mediaEl.removeEventListener(eventName, callback))
    hls?.destroy?.()
    hls = null
    activePlayers.delete(mediaEl)
    clearMedia(mediaEl)
  }
  activePlayers.set(mediaEl, { cleanup, hls: null })
  console.info('[hls-edge] status', { status: 'loading', mode, src })
  onStatus({ status: 'loading', mode, src, mediaEl, hls: null })

  if (canPlayNativeHls(mediaEl)) {
    listen('loadedmetadata', () => {
      console.info('[hls-edge] status', { status: 'manifestParsed', mode, src, native: true })
      onStatus({ status: 'manifestParsed', mode, src, mediaEl, hls: null, native: true, levelCount: null })
    })
    mediaEl.src = src
    mediaEl.load()
    return cleanup
  }

  const { default: Hls } = await import('hls.js')
  if (cleaned) return cleanup
  if (!Hls?.isSupported?.()) {
    cleanup()
    throw new Error('This browser cannot play this HLS stream.')
  }

  hls = new Hls({
    // Melogic Live favors complete segments and a generous buffer. This is
    // intentionally not low-latency playback: it trades delay for a steadier,
    // higher-quality stream on real listener connections.
    lowLatencyMode: false,
    capLevelToPlayerSize: false,
    startLevel: -1,
    maxBufferLength: 60,
    maxMaxBufferLength: 180,
    backBufferLength: 90,
    liveSyncDurationCount: 6,
    liveMaxLatencyDurationCount: 14,
    abrEwmaDefaultEstimate: 8000000,
    abrBandWidthFactor: 0.95,
    abrBandWidthUpFactor: 0.8,
    manifestLoadingMaxRetry: 12,
    manifestLoadingRetryDelay: 2000,
    manifestLoadingMaxRetryTimeout: 6000,
    levelLoadingMaxRetry: 8,
    levelLoadingRetryDelay: 2000,
    levelLoadingMaxRetryTimeout: 6000
  })
  hls.on(Hls.Events.MANIFEST_PARSED, (_event, data = {}) => {
    const levels = Array.isArray(data.levels) ? data.levels : hls.levels || []
    const highestLevel = levels.reduce((best, level, index) => {
      const bitrate = Number(level?.bitrate || 0)
      return bitrate > Number(levels[best]?.bitrate || 0) ? index : best
    }, 0)
    console.info('[hls-edge] status', { status: 'manifestParsed', mode, src, native: false, levelCount: levels.length, highestLevel })
    onStatus({
      status: 'manifestParsed',
      mode,
      src,
      mediaEl,
      hls,
      native: false,
      levelCount: levels.length,
      highestLevel,
      highestLevelBitrate: Number(levels[highestLevel]?.bitrate || 0) || null,
      highestLevelWidth: Number(levels[highestLevel]?.width || 0) || null,
      highestLevelHeight: Number(levels[highestLevel]?.height || 0) || null
    })
  })
  hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data = {}) => {
    const level = Number(data.level)
    const details = hls.levels?.[level] || {}
    onStatus({
      status: 'qualityChanged',
      mode,
      src,
      mediaEl,
      hls,
      native: false,
      currentLevel: Number.isInteger(level) ? level : -1,
      currentLevelBitrate: Number(details.bitrate || 0) || null,
      currentLevelWidth: Number(details.width || 0) || null,
      currentLevelHeight: Number(details.height || 0) || null
    })
  })
  hls.on(Hls.Events.ERROR, (_event, data = {}) => {
    const payload = {
      status: 'error',
      type: String(data.type || ''),
      details: String(data.details || ''),
      fatal: data.fatal === true,
      responseCode: Number(data.response?.code || data.networkDetails?.status || 0) || null,
      responseUrl: String(data.response?.url || data.networkDetails?.responseURL || '')
    }
    console.error('[hls-edge] playback error', payload)
    onStatus({ ...payload, mode, src, mediaEl, hls })
    onError(payload)
  })
  hls.loadSource(src)
  hls.attachMedia(mediaEl)
  activePlayers.set(mediaEl, { cleanup, hls })
  return cleanup
}
