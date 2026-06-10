export function selectLibrarySample(samples = [], note, playbackMode = 'pitch-modified') {
  const target = Number(note)
  if (!Number.isFinite(target)) return null
  if (playbackMode === 'exact-position') {
    return samples.find((sample) => sample.rootMidi === target) || null
  }
  return samples.reduce((nearest, sample) => (
    !nearest || Math.abs(sample.rootMidi - target) < Math.abs(nearest.rootMidi - target) ? sample : nearest
  ), null)
}
