export const HLS_WARMUP_WINDOW_MS = 30 * 1000
export const HLS_RECENT_OK_WINDOW_MS = 90 * 1000

function timestampMs(value) {
  if (!value) return 0
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (typeof value?.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function parseHlsManifest(manifest = '') {
  const text = String(manifest || '')
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const sequenceMatch = text.match(/^#EXT-X-MEDIA-SEQUENCE\s*:\s*(\d+)/mi)
  const mediaLines = lines.filter((line) => !line.startsWith('#') && !/\.m3u8(?:[?#]|$)/i.test(line))
  const hasMediaSegment = /(^|[/?])[^\s?#]+\.(?:ts|m4s|mp4|aac|mp3)(?:[?#]|$)/im.test(text)
    || /#EXTINF\s*:/i.test(text)
    || mediaLines.length > 0
  return {
    valid: /#EXTM3U/i.test(text) && hasMediaSegment,
    hasExtM3u: /#EXTM3U/i.test(text),
    hasMediaSegment,
    sequence: sequenceMatch ? Number(sequenceMatch[1]) : null
  }
}

export async function checkHlsManifest({
  streamId = '',
  hlsUrl = '',
  previous = {},
  startedAt = '',
  timeoutMs = 8000
} = {}) {
  const checkedAtMs = Date.now()
  const previousLastOkMs = timestampMs(previous.hlsLastOkAt)
  const startedAtMs = timestampMs(startedAt) || checkedAtMs
  let responseCode = 0
  let error = ''
  let parsed = { valid: false, hasExtM3u: false, hasMediaSegment: false, sequence: null }
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const url = new URL(String(hlsUrl || ''))
    url.searchParams.set('_', String(checkedAtMs))
    const response = await fetch(url.toString(), {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/vnd.apple.mpegurl, application/x-mpegURL, text/plain' },
      signal: controller.signal
    })
    responseCode = response.status
    const manifest = await response.text()
    parsed = parseHlsManifest(manifest)
    if (!response.ok) error = `HTTP ${response.status}`
    else if (!parsed.valid) error = parsed.hasExtM3u ? 'Playlist has no media segments yet.' : 'Response is not an HLS playlist.'
  } catch (fetchError) {
    error = fetchError?.name === 'AbortError'
      ? 'HLS health check timed out.'
      : fetchError?.message || String(fetchError)
  } finally {
    window.clearTimeout(timeout)
  }

  const manifestHealthy = responseCode >= 200 && responseCode < 300 && parsed.valid
  const rawPreviousSequence = previous.hlsLastManifestSequence ?? previous.hlsManifestSequence
  const previousSequence = rawPreviousSequence == null || rawPreviousSequence === ''
    ? null
    : Number.isFinite(Number(rawPreviousSequence)) ? Number(rawPreviousSequence) : null
  const sequenceChanged = parsed.sequence == null || previousSequence == null || parsed.sequence !== previousSequence
  const sequenceFresh = sequenceChanged || Boolean(previousLastOkMs && checkedAtMs - previousLastOkMs <= HLS_RECENT_OK_WINDOW_MS)
  const healthy = manifestHealthy && sequenceFresh
  if (manifestHealthy && !sequenceFresh) error = 'HLS media sequence has not advanced within the freshness window.'
  const lastOkMs = healthy && sequenceChanged ? checkedAtMs : previousLastOkMs
  const withinWarmup = checkedAtMs - startedAtMs <= HLS_WARMUP_WINDOW_MS
  const recentlyHealthy = Boolean(lastOkMs && checkedAtMs - lastOkMs <= HLS_RECENT_OK_WINDOW_MS)
  const health = healthy ? 'healthy' : withinWarmup && !lastOkMs ? 'warming' : recentlyHealthy ? 'stale' : 'offline'
  const diagnostics = {
    hlsHealth: health,
    hlsLastOkAt: lastOkMs ? new Date(lastOkMs).toISOString() : '',
    hlsLastCheckedAt: new Date(checkedAtMs).toISOString(),
    hlsLastManifestSequence: parsed.sequence,
    hlsManifestSequence: parsed.sequence,
    hlsSequenceChanged: sequenceChanged,
    hlsManifestAgeMs: lastOkMs ? Math.max(0, checkedAtMs - lastOkMs) : null,
    hlsLastError: healthy ? '' : error,
    hlsError: healthy ? '' : error,
    hlsResponseCode: responseCode,
    healthy
  }
  console.log('[HLS Health] check', {
    streamId,
    hlsUrl,
    responseCode,
    healthy,
    sequence: parsed.sequence,
    lastOkAt: diagnostics.hlsLastOkAt,
    health,
    error: diagnostics.hlsLastError
  })
  return diagnostics
}

export function isRecentHlsHealth(stream = {}, now = Date.now()) {
  const lastOkAt = timestampMs(stream.hlsLastOkAt)
  return stream.hlsHealth === 'healthy'
    || stream.hlsHealth === 'stale'
    || Boolean(lastOkAt && now - lastOkAt <= HLS_RECENT_OK_WINDOW_MS)
}
