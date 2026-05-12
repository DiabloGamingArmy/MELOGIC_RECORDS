const createDefaultRegion = (partial = {}) => ({
  id: String(partial.id || `region-${Math.random().toString(36).slice(2, 9)}`),
  trackId: String(partial.trackId || 'demo-track'),
  type: partial.type === 'midi' ? 'midi' : 'audio',
  startBeat: Number.isFinite(Number(partial.startBeat)) ? Number(partial.startBeat) : 0,
  durationBeats: Math.max(0, Number.isFinite(Number(partial.durationBeats)) ? Number(partial.durationBeats) : 0),
  sourceHash: partial.sourceHash ?? null,
  gain: Number.isFinite(Number(partial.gain)) ? Number(partial.gain) : 1,
  muted: !!partial.muted
})

export function createEmptySequence() {
  return { version: 1, regions: [] }
}

export function normalizeSequence(sequence) {
  const base = sequence && typeof sequence === 'object' ? sequence : {}
  const regions = Array.isArray(base.regions) ? base.regions.map((region) => createDefaultRegion(region)) : []
  regions.sort((a, b) => a.startBeat - b.startBeat)
  return { version: 1, regions }
}

export function getInstructionsInRange(sequence, startBeat, endBeat) {
  const normalized = normalizeSequence(sequence)
  const start = Number(startBeat || 0)
  const end = Number(endBeat || 0)
  const minBeat = Math.min(start, end)
  const maxBeat = Math.max(start, end)

  return normalized.regions.filter((region) => {
    const regionStart = region.startBeat
    const regionEnd = region.startBeat + region.durationBeats
    return regionEnd > minBeat && regionStart < maxBeat
  })
}
