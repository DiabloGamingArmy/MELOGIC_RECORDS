export const WAV_FORMAT = Object.freeze({ id: 'wav', label: 'WAV', extension: 'wav', mime: 'audio/wav', depths: [16, 24, 32] })
export function exportCapabilities({ desktop = false, supportedRates = [44100, 48000], nativeRate = 48000 } = {}) {
  const candidates = desktop ? [44100, 48000, 88200, 96000, 176400, 192000] : [44100, 48000]
  return { formats: [WAV_FORMAT], rates: [...new Set([nativeRate, ...candidates])].filter(rate => supportedRates.includes(rate)), nativeRate, desktop, delivery: desktop ? 'native' : 'download' }
}
export function sanitizeExportName(value) {
  const name = String(value || '').normalize('NFC').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/\.wav$/i, '').replace(/[. ]+$/g, '').trim().slice(0, 120)
  return (!name ? 'Soura Mix' : /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name) + '.wav'
}
export function audibleTracks(tracks) {
  const solo = tracks.some(track => track.soloed)
  return tracks.filter(track => !track.muted && (!solo || track.soloed))
}
export function planExport({ tracks, regions, cycle, range = 'entire', tail = 2, toSeconds }) {
  const ids = new Set(audibleTracks(tracks).map(track => track.id))
  const audible = regions.filter(region => ids.has(region.trackId) && !region.muted && !region.audioEdit?.mute && (region.type === 'audio' || (region.notes?.length && tracks.find(track => track.id === region.trackId)?.instrument?.enabled !== false)))
  if (!audible.length) throw new Error('The project has no audible audio or MIDI regions to export.')
  if (!['entire', 'cycle'].includes(range)) throw new Error('Invalid export range.')
  if (![0, 1, 2, 5].includes(Number(tail))) throw new Error('Invalid export tail.')
  let start = 0, end = Math.max(...audible.map(region => toSeconds(Number(region.endBeat) || 0)))
  if (range === 'cycle') {
    if (!cycle || !(cycle.end > cycle.start) || cycle.start < 0) throw new Error('Enable a valid cycle range before exporting it.')
    start = toSeconds(cycle.start); end = toSeconds(cycle.end)
  }
  if (!Number.isFinite(start + end) || end <= start) throw new Error('The export range has no duration.')
  return { start, end, tail: Number(tail), duration: end - start + Number(tail), renderDuration: end + Number(tail), regions: audible, tracks: audibleTracks(tracks) }
}
