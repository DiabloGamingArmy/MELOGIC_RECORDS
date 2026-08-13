const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback

export function musicalPositionToRegionX(projectBeat, { regionStartBeat = 0, pixelsPerBeat = 1 } = {}) {
  return (finite(projectBeat) - finite(regionStartBeat)) * Math.max(0.000001, finite(pixelsPerBeat, 1))
}

export function regionXToMusicalPosition(regionX, { regionStartBeat = 0, pixelsPerBeat = 1 } = {}) {
  return finite(regionStartBeat) + (finite(regionX) / Math.max(0.000001, finite(pixelsPerBeat, 1)))
}

export function musicalDurationToRegionWidth(durationBeats, pixelsPerBeat = 1) {
  return Math.max(0, finite(durationBeats)) * Math.max(0.000001, finite(pixelsPerBeat, 1))
}

export function regionWidthToMusicalDuration(width, pixelsPerBeat = 1) {
  return finite(width) / Math.max(0.000001, finite(pixelsPerBeat, 1))
}

export function snapMusicalPosition(projectBeat, stepBeats) {
  const step = Math.max(0.000001, finite(stepBeats, 0.25))
  return Math.round(finite(projectBeat) / step) * step
}
