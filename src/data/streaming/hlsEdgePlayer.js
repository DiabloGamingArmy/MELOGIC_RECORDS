export const HLS_EDGE_BASE_URL = 'https://stream.melogicrecords.studio/live'

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
    return parsed.protocol === 'https:'
      && parsed.hostname === 'stream.melogicrecords.studio'
      && parsed.port === ''
      && parsed.pathname.startsWith('/live/')
      && parsed.pathname.endsWith('.m3u8')
  } catch {
    return false
  }
}

export function resolveHlsPlaybackUrl({ streamKey = '', hlsPlaybackUrl = '' } = {}) {
  if (isAllowedHlsPlaybackUrl(hlsPlaybackUrl)) return String(hlsPlaybackUrl).trim()
  return buildHlsPlaybackUrl(streamKey)
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
  ;['playing', 'waiting', 'stalled', 'ended'].forEach((eventName) => listen(eventName, () => emitMediaStatus(eventName)))
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
  activePlayers.set(mediaEl, { cleanup })
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

  hls = new Hls()
  hls.on(Hls.Events.MANIFEST_PARSED, (_event, data = {}) => {
    console.info('[hls-edge] status', { status: 'manifestParsed', mode, src, native: false })
    onStatus({
      status: 'manifestParsed',
      mode,
      src,
      mediaEl,
      hls,
      native: false,
      levelCount: Array.isArray(data.levels) ? data.levels.length : hls.levels?.length || 0
    })
  })
  hls.on(Hls.Events.ERROR, (_event, data = {}) => {
    const payload = {
      status: 'error',
      type: String(data.type || ''),
      details: String(data.details || ''),
      fatal: data.fatal === true
    }
    console.error('[hls-edge] playback error', payload)
    onStatus({ ...payload, mode, src, mediaEl, hls })
    onError(payload)
  })
  hls.loadSource(src)
  hls.attachMedia(mediaEl)
  activePlayers.set(mediaEl, { cleanup })
  return cleanup
}
