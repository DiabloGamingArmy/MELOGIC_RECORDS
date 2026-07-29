const DEFAULT_HLS_EDGE_BASE_URL = 'https://stream.melogicrecords.studio/live'
const DEFAULT_BROWSER_HLS_EDGE_BASE_URL = 'https://ingest.melogicrecords.studio/hls'
export const HLS_EDGE_BASE_URL = String(import.meta.env?.VITE_STREAM_EDGE_BASE_URL || DEFAULT_HLS_EDGE_BASE_URL).trim().replace(/\/+$/, '')
export const BROWSER_HLS_EDGE_BASE_URL = String(import.meta.env?.VITE_BROWSER_HLS_EDGE_BASE_URL || DEFAULT_BROWSER_HLS_EDGE_BASE_URL).trim().replace(/\/+$/, '')

const HLS_EDGE_URL_PREFIX = `${HLS_EDGE_BASE_URL}/`
const BROWSER_HLS_EDGE_URL_PREFIX = `${BROWSER_HLS_EDGE_BASE_URL}/`
const activePlayers = new WeakMap()

export function sanitizeHlsStreamKey(streamKey = '') {
  return String(streamKey || '').trim().replace(/[^A-Za-z0-9_-]/g, '')
}

export function buildHlsPlaybackUrl(streamKey = '', { ingestMethod = '' } = {}) {
  const cleanKey = sanitizeHlsStreamKey(streamKey)
  if (!cleanKey) return ''
  if (String(ingestMethod) === 'browserWebrtc') {
    return `${BROWSER_HLS_EDGE_BASE_URL}/${cleanKey}/index.m3u8`
  }
  return `${HLS_EDGE_BASE_URL}/${cleanKey}.m3u8`
}

export function isAllowedHlsPlaybackUrl(value = '') {
  const candidate = String(value || '').trim()
  try {
    const parsed = new URL(candidate)
    if (parsed.search || parsed.hash) return false
    if (candidate.startsWith(HLS_EDGE_URL_PREFIX)) {
      const allowedBase = new URL(`${HLS_EDGE_BASE_URL}/`)
      const expectedPathPrefix = allowedBase.pathname.endsWith('/') ? allowedBase.pathname : `${allowedBase.pathname}/`
      return parsed.protocol === allowedBase.protocol
        && parsed.host === allowedBase.host
        && parsed.pathname.startsWith(expectedPathPrefix)
        && /^[A-Za-z0-9_-]+\.m3u8$/.test(parsed.pathname.slice(expectedPathPrefix.length))
    }
    if (candidate.startsWith(BROWSER_HLS_EDGE_URL_PREFIX)) {
      const allowedBase = new URL(`${BROWSER_HLS_EDGE_BASE_URL}/`)
      const expectedPathPrefix = allowedBase.pathname.endsWith('/') ? allowedBase.pathname : `${allowedBase.pathname}/`
      return parsed.protocol === allowedBase.protocol
        && parsed.host === allowedBase.host
        && parsed.pathname.startsWith(expectedPathPrefix)
        && /^[A-Za-z0-9_-]+\/index\.m3u8$/.test(parsed.pathname.slice(expectedPathPrefix.length))
    }
    return false
  } catch {
    return false
  }
}

export function resolveHlsPlaybackUrl({ streamKey = '', hlsPlaybackUrl = '', ingestMethod = '' } = {}) {
  const keyUrl = buildHlsPlaybackUrl(streamKey, { ingestMethod })
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

export function getHlsLiveEdge(mediaEl) {
  if (!mediaEl) return null
  const active = activePlayers.get(mediaEl)
  const hlsLiveSyncPosition = Number(active?.hls?.liveSyncPosition)
  if (Number.isFinite(hlsLiveSyncPosition) && hlsLiveSyncPosition > 0) return hlsLiveSyncPosition
  const ranges = mediaEl.seekable
  if (!ranges?.length) return null
  const edge = Number(ranges.end(ranges.length - 1))
  return Number.isFinite(edge) ? edge : null
}

export function getHlsLiveLatency(mediaEl) {
  const edge = getHlsLiveEdge(mediaEl)
  const currentTime = Number(mediaEl?.currentTime)
  if (!Number.isFinite(edge) || !Number.isFinite(currentTime)) return null
  return Math.max(0, edge - currentTime)
}

export async function seekHlsToLiveEdge(mediaEl) {
  const edge = getHlsLiveEdge(mediaEl)
  if (!mediaEl || !Number.isFinite(edge)) return false
  // Stay just inside the seekable range so native HLS players do not reject
  // the seek while the newest segment is still being finalized.
  mediaEl.currentTime = Math.max(0, edge - 0.35)
  try {
    await mediaEl.play()
  } catch {}
  return true
}

export function stabilizeRtcBridgePlaylist(playlist = '') {
  const source = String(playlist || '')
  if (!source.includes('#EXTM3U') || !source.includes('#EXT-X-DISCONTINUITY')) return source

  const segmentCount = (source.match(/^#EXTINF:/gm) || []).length
  const discontinuityCount = (source.match(/^#EXT-X-DISCONTINUITY\s*$/gm) || []).length
  // Preserve legitimate, occasional discontinuities (encoder changes,
  // failover, etc.). The affected SRS RTC bridge emits one before virtually
  // every media segment; only that unmistakable pattern is normalized.
  const isPathologicalRtcPattern = segmentCount >= 3
    && discontinuityCount >= Math.max(3, segmentCount - 1)
  if (!isPathologicalRtcPattern) return source

  return source.replace(/^#EXT-X-DISCONTINUITY\s*\r?\n/gm, '')
}

export async function attachHlsStream({
  mediaEl,
  src,
  mode = 'videoAudio',
  stabilizeRtcBridge = false,
  onStatus = () => {},
  onError = () => {}
}) {
  if (!mediaEl) throw new Error('An HTML media element is required for HLS playback.')
  if (!isAllowedHlsPlaybackUrl(src)) throw new Error('Invalid HLS playback URL. Streams must load from a Melogic streaming origin.')
  destroyActivePlayer(mediaEl)
  mediaEl.crossOrigin = 'use-credentials'

  const listeners = []
  let hls = null
  let cleaned = false
  let usingNativeFallback = false
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

  const nativeHlsSupported = canPlayNativeHls(mediaEl)
  if (nativeHlsSupported && !stabilizeRtcBridge) {
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
    if (nativeHlsSupported) {
      listen('loadedmetadata', () => {
        onStatus({ status: 'manifestParsed', mode, src, mediaEl, hls: null, native: true, levelCount: null })
      })
      mediaEl.src = src
      mediaEl.load()
      return cleanup
    }
    cleanup()
    throw new Error('This browser cannot play this HLS stream.')
  }

  const BasePlaylistLoader = Hls.DefaultConfig.loader
  class RtcBridgePlaylistLoader {
    constructor(config) {
      this.loader = new BasePlaylistLoader(config)
      this.stats = this.loader.stats
    }

    get context() {
      return this.loader.context
    }

    getCacheAge() {
      return this.loader.getCacheAge?.() ?? null
    }

    getResponseHeader(name) {
      return this.loader.getResponseHeader?.(name) ?? null
    }

    load(context, config, callbacks) {
      this.loader.load(context, config, {
        ...callbacks,
        onSuccess: (response, stats, responseContext, networkDetails) => {
          const data = typeof response?.data === 'string'
            ? stabilizeRtcBridgePlaylist(response.data)
            : response?.data
          callbacks.onSuccess(
            data === response?.data ? response : { ...response, data },
            stats,
            responseContext,
            networkDetails
          )
        }
      })
    }

    abort() {
      this.loader.abort()
    }

    destroy() {
      this.loader.destroy()
    }
  }

  hls = new Hls({
    // Melogic Live favors complete segments and a generous buffer. This is
    // intentionally not low-latency playback: it trades delay for a steadier,
    // higher-quality stream on real listener connections.
    lowLatencyMode: false,
    capLevelToPlayerSize: false,
    startLevel: -1,
    maxBufferLength: 180,
    maxMaxBufferLength: 300,
    backBufferLength: 180,
    // Four-second origin segments put a normal browser viewer roughly one
    // minute behind live. The deeper window absorbs long encode/network
    // stalls without sacrificing the selected rendition.
    liveSyncDurationCount: 15,
    liveMaxLatencyDurationCount: 60,
    abrEwmaDefaultEstimate: 8000000,
    abrBandWidthFactor: 0.95,
    abrBandWidthUpFactor: 0.8,
    xhrSetup: (xhr) => {
      xhr.withCredentials = true
    },
    manifestLoadingMaxRetry: 12,
    manifestLoadingRetryDelay: 2000,
    manifestLoadingMaxRetryTimeout: 6000,
    levelLoadingMaxRetry: 8,
    levelLoadingRetryDelay: 2000,
    levelLoadingMaxRetryTimeout: 6000,
    ...(stabilizeRtcBridge ? { pLoader: RtcBridgePlaylistLoader } : {})
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
    const errorType = String(data.type || '')
    const errorDetails = String(data.details || '')
    const isManifestBootstrapFailure = /manifestLoad|manifestParsing/i.test(errorDetails)
    const shouldUseNativeFallback = !usingNativeFallback
      && nativeHlsSupported
      && stabilizeRtcBridge
      && (
        isManifestBootstrapFailure
        || (data.fatal === true && (errorType === 'networkError' || /levelLoad/i.test(errorDetails)))
      )
    if (shouldUseNativeFallback) {
      usingNativeFallback = true
      console.warn('[hls-edge] managed playback failed; falling back to native HLS', {
        type: errorType,
        details: errorDetails
      })
      try { hls?.destroy?.() } catch {}
      hls = null
      try { mediaEl.pause() } catch {}
      mediaEl.removeAttribute('src')
      try { mediaEl.load() } catch {}
      activePlayers.set(mediaEl, { cleanup, hls: null })
      onStatus({ status: 'nativeFallback', mode, src, mediaEl, hls: null, native: true, levelCount: null })
      listen('loadedmetadata', () => {
        onStatus({ status: 'manifestParsed', mode, src, mediaEl, hls: null, native: true, levelCount: null })
      })
      mediaEl.src = src
      mediaEl.load()
      mediaEl.play().catch(() => {})
      return
    }
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
