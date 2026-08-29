export function collectMetronomeBeatIndices({
  lastScheduledBeat = -1,
  currentBeat = 0,
  lookaheadBeat = currentBeat
} = {}) {
  const current = Math.max(0, Math.floor(Number(currentBeat) || 0))
  const lookahead = Math.max(current, Math.floor(Number(lookaheadBeat) || current))
  const first = Math.max(Math.floor(Number(lastScheduledBeat) || -1) + 1, current)
  if (first > lookahead) return []
  return Array.from({ length: lookahead - first + 1 }, (_, index) => first + index)
}

