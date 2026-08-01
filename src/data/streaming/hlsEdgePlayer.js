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
    // MediaMTX's explicit cookie-check mode returns the master playlist
    // directly and places the HLS session in child-URI query parameters. This
    // avoids the initial HTTP redirect that native Safari HLS can reject.
    return `${BROWSER_HLS_EDGE_BASE_URL}/${cleanKey}/index.m3u8?cookieCheck=1`
  }
  return `${HLS_EDGE_BASE_URL}/${cleanKey}.m3u8`
}

export function isAllowedHlsPlaybackUrl(value = '') {
  const candidate = String(value || '').trim()
  try {
    const parsed = new URL(candidate)
    if (parsed.hash) return false
    if (candidate.startsWith(HLS_EDGE_URL_PREFIX)) {
      const allowedBase = new URL(`${HLS_EDGE_BASE_URL}/`)
      const expectedPathPrefix = allowedBase.pathname.endsWith('/') ? allowedBase.pathname : `${allowedBase.pathname}/`
      return parsed.protocol === allowedBase.protocol
        && parsed.host === allowedBase.host
        && parsed.pathname.startsWith(expectedPathPrefix)
        && /^[A-Za-z0-9_-]+\.m3u8$/.test(parsed.pathname.slice(expectedPathPrefix.length))
        && parsed.search === ''
    }
    if (candidate.startsWith(BROWSER_HLS_EDGE_URL_PREFIX)) {
      const allowedBase = new URL(`${BROWSER_HLS_EDGE_BASE_URL}/`)
      const expectedPathPrefix = allowedBase.pathname.endsWith('/') ? allowedBase.pathname : `${allowedBase.pathname}/`
      const validQuery = parsed.searchParams.size === 1 && parsed.searchParams.get('cookieCheck') === '1'
      return parsed.protocol === allowedBase.protocol
        && parsed.host === allowedBase.host
        && parsed.pathname.startsWith(expectedPathPrefix)
        && /^[A-Za-z0-9_-]+\/index\.m3u8$/.test(parsed.pathname.slice(expectedPathPrefix.length))
        && validQuery
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
  let networkRecoveryAttempts = 0
  let mediaRecoveryAttempts = 0
  let mediaElementRecoveryAttempts = 0
  let playbackWatchdogTimer = 0
  let playbackWatchdogRecoveries = 0
  let lastObservedMediaTime = -1
  let lastMediaProgressAt = Date.now()
  const listen = (eventName, callback) => {
    mediaEl.addEventListener(eventName, callback)
    listeners.push([eventName, callback])
  }
  const emitMediaStatus = (status) => {
    onStatus({ status, mode, src, mediaEl, hls })
  }
  ;['canplay', 'playing', 'waiting', 'stalled', 'ended'].forEach((eventName) => listen(eventName, () => emitMediaStatus(eventName)))
  listen('timeupdate', () => {
    const currentTime = Number(mediaEl.currentTime || 0)
    if (currentTime > lastObservedMediaTime + 0.03) {
      lastObservedMediaTime = currentTime
      lastMediaProgressAt = Date.now()
      playbackWatchdogRecoveries = 0
    }
  })
  const startPlaybackWatchdog = () => {
    if (playbackWatchdogTimer) return
    playbackWatchdogTimer = window.setInterval(() => {
      if (cleaned || mediaEl.paused || mediaEl.ended) {
        lastObservedMediaTime = Number(mediaEl.currentTime || 0)
        lastMediaProgressAt = Date.now()
        return
      }
      const currentTime = Number(mediaEl.currentTime || 0)
      if (currentTime > lastObservedMediaTime + 0.03) {
        lastObservedMediaTime = currentTime
        lastMediaProgressAt = Date.now()
        playbackWatchdogRecoveries = 0
        return
      }
      if (Date.now() - lastMediaProgressAt < 12000) return
      playbackWatchdogRecoveries += 1
      lastMediaProgressAt = Date.now()
      onStatus({
        status: 'recovering',
        recovery: 'playheadWatchdog',
        attempt: playbackWatchdogRecoveries,
        mode,
        src,
        mediaEl,
        hls
      })
      const ranges = mediaEl.buffered
      let bufferedEnd = null
      for (let index = 0; index < (ranges?.length || 0); index += 1) {
        if (currentTime >= ranges.start(index) - 0.1 && currentTime <= ranges.end(index) + 0.1) {
          bufferedEnd = ranges.end(index)
          break
        }
      }
      if (Number.isFinite(bufferedEnd) && bufferedEnd > currentTime + 0.35) {
        mediaEl.currentTime = Math.min(bufferedEnd - 0.12, currentTime + 0.12)
      } else if (hls) {
        try { hls.startLoad(-1) } catch {}
        if (playbackWatchdogRecoveries % 2 === 0) {
          try { hls.recoverMediaError() } catch {}
        }
      } else {
        const edge = getHlsLiveEdge(mediaEl)
        if (Number.isFinite(edge) && edge > currentTime + 0.5) mediaEl.currentTime = Math.max(0, edge - 1)
        else {
          try { mediaEl.load() } catch {}
        }
      }
      mediaEl.play().catch(() => {})
    }, 4000)
  }
  startPlaybackWatchdog()
  listen('error', () => {
    const error = mediaEl.error
    const payload = {
      status: 'error',
      type: 'mediaError',
      details: error?.message || `HTML media error ${error?.code || ''}`.trim(),
      fatal: true,
      mediaErrorCode: error?.code ?? null
    }
    if (hls && mediaElementRecoveryAttempts < 2) {
      mediaElementRecoveryAttempts += 1
      console.warn('[hls-edge] recovering HTML media error', {
        ...payload,
        attempt: mediaElementRecoveryAttempts
      })
      onStatus({
        ...payload,
        status: 'recovering',
        recovery: 'recoverMediaError',
        attempt: mediaElementRecoveryAttempts,
        mode,
        src,
        mediaEl,
        hls
      })
      try { hls.recoverMediaError() } catch {}
      return
    }
    console.error('[hls-edge] media error', payload)
    onStatus({ ...payload, mode, src, mediaEl, hls })
    onError(payload)
  })

  const cleanup = () => {
    if (cleaned) return
    cleaned = true
    listeners.forEach(([eventName, callback]) => mediaEl.removeEventListener(eventName, callback))
    if (playbackWatchdogTimer) window.clearInterval(playbackWatchdogTimer)
    playbackWatchdogTimer = 0
    hls?.destroy?.()
    hls = null
    activePlayers.delete(mediaEl)
    clearMedia(mediaEl)
  }
  activePlayers.set(mediaEl, { cleanup, hls: null })
  onStatus({ status: 'loading', mode, src, mediaEl, hls: null })

  const nativeHlsSupported = canPlayNativeHls(mediaEl)
  if (nativeHlsSupported && !stabilizeRtcBridge) {
    listen('loadedmetadata', () => {
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
    maxBufferLength: 120,
    maxMaxBufferLength: 150,
    maxBufferSize: 128 * 1000 * 1000,
    backBufferLength: 30,
    // Six-second origin segments place browser viewers about two minutes
    // behind live. That deliberate delay gives Chrome enough complete media
    // to play through brief encoder, network, or remux stalls without skipping
    // content. The "catch up" control can still seek directly to the live edge.
    liveSyncDurationCount: 20,
    liveMaxLatencyDurationCount: 45,
    abrEwmaDefaultEstimate: 12000000,
    abrBandWidthFactor: 0.85,
    abrBandWidthUpFactor: 0.72,
    maxStarvationDelay: 8,
    maxLoadingDelay: 8,
    highBufferWatchdogPeriod: 2,
    nudgeOffset: 0.1,
    nudgeMaxRetry: 8,
    xhrSetup: (xhr) => {
      xhr.withCredentials = true
    },
    manifestLoadingMaxRetry: 12,
    manifestLoadingRetryDelay: 2000,
    manifestLoadingMaxRetryTimeout: 6000,
    levelLoadingMaxRetry: 8,
    levelLoadingRetryDelay: 2000,
    levelLoadingMaxRetryTimeout: 6000,
    fragLoadingMaxRetry: 10,
    fragLoadingRetryDelay: 1000,
    fragLoadingMaxRetryTimeout: 12000,
    keyLoadingMaxRetry: 8,
    keyLoadingRetryDelay: 1000,
    keyLoadingMaxRetryTimeout: 10000,
    ...(stabilizeRtcBridge ? { pLoader: RtcBridgePlaylistLoader } : {})
  })
  hls.on(Hls.Events.MANIFEST_PARSED, (_event, data = {}) => {
    const levels = Array.isArray(data.levels) ? data.levels : hls.levels || []
    const highestLevel = levels.reduce((best, level, index) => {
      const bitrate = Number(level?.bitrate || 0)
      return bitrate > Number(levels[best]?.bitrate || 0) ? index : best
    }, 0)
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
    networkRecoveryAttempts = 0
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
  hls.on(Hls.Events.FRAG_BUFFERED, () => {
    networkRecoveryAttempts = 0
    mediaRecoveryAttempts = 0
    mediaElementRecoveryAttempts = 0
  })
  hls.on(Hls.Events.ERROR, (_event, data = {}) => {
    const errorType = String(data.type || '')
    const errorDetails = String(data.details || '')
    const isManifestBootstrapFailure = /manifestLoad|manifestParsing/i.test(errorDetails)
    const shouldUseNativeFallback = !usingNativeFallback
      && nativeHlsSupported
      && stabilizeRtcBridge
      && networkRecoveryAttempts >= 2
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
    if (data.fatal === true && errorType === 'networkError' && networkRecoveryAttempts < 4) {
      networkRecoveryAttempts += 1
      console.warn('[hls-edge] recovering network error', {
        type: payload.type,
        details: payload.details,
        fatal: payload.fatal,
        responseCode: payload.responseCode,
        attempt: networkRecoveryAttempts
      })
      onStatus({
        ...payload,
        status: 'recovering',
        recovery: 'startLoad',
        attempt: networkRecoveryAttempts,
        mode,
        src,
        mediaEl,
        hls
      })
      window.setTimeout(() => {
        if (!cleaned && hls) hls.startLoad()
      }, Math.min(4000, networkRecoveryAttempts * 750))
      return
    }
    if (data.fatal === true && errorType === 'mediaError' && mediaRecoveryAttempts < 3) {
      mediaRecoveryAttempts += 1
      console.warn('[hls-edge] recovering media error', {
        type: payload.type,
        details: payload.details,
        fatal: payload.fatal,
        responseCode: payload.responseCode,
        attempt: mediaRecoveryAttempts
      })
      onStatus({
        ...payload,
        status: 'recovering',
        recovery: mediaRecoveryAttempts === 2 ? 'swapAudioCodecAndRecover' : 'recoverMediaError',
        attempt: mediaRecoveryAttempts,
        mode,
        src,
        mediaEl,
        hls
      })
      try {
        if (mediaRecoveryAttempts === 2) hls.swapAudioCodec()
        hls.recoverMediaError()
      } catch {}
      return
    }
    if (data.fatal !== true) {
      console.warn('[hls-edge] recoverable playback issue', {
        type: payload.type,
        details: payload.details,
        fatal: payload.fatal,
        responseCode: payload.responseCode
      })
      onStatus({ ...payload, status: 'recovering', mode, src, mediaEl, hls })
      return
    }
    console.error('[hls-edge] playback error', {
      type: payload.type,
      details: payload.details,
      fatal: payload.fatal,
      responseCode: payload.responseCode
    })
    onStatus({ ...payload, mode, src, mediaEl, hls })
    onError(payload)
  })
  hls.loadSource(src)
  hls.attachMedia(mediaEl)
  activePlayers.set(mediaEl, { cleanup, hls })
  return cleanup
}
