export function moveArrayItem(items = [], fromIndex = -1, toIndex = -1) {
  const list = Array.isArray(items) ? [...items] : []
  if (fromIndex < 0 || fromIndex >= list.length) return list
  const destination = Math.max(0, Math.min(list.length - 1, Number(toIndex) || 0))
  if (fromIndex === destination) return list
  const [item] = list.splice(fromIndex, 1)
  list.splice(destination, 0, item)
  return list
}

export function moveArrayItemById(items = [], itemId = '', toIndex = -1) {
  return moveArrayItem(items, items.findIndex((item) => String(item?.id) === String(itemId)), toIndex)
}

export function applyInheritedTrackColor(track, regions = [], color = '') {
  if (!track || !/^#[0-9a-f]{6}$/i.test(String(color))) return []
  track.color = color
  track.colorSoft = `${color}42`
  const changedRegionIds = []
  regions.forEach((region) => {
    if (region?.trackId !== track.id || region.independentColor) return
    region.color = color
    region.regionColorMode = 'inherit-track'
    changedRegionIds.push(region.id)
  })
  return changedRegionIds
}

export const DEFAULT_METRONOME_SETTINGS = Object.freeze({
  id: 'system-metronome',
  name: 'Metronome',
  enabled: true,
  muted: false,
  volume: 72,
  pan: 0,
  outputRoute: 'Stereo Out',
  accentLevel: 0.9,
  accentPitch: 1200,
  accentTone: 0.62,
  clickLevel: 0.68,
  clickPitch: 760,
  clickTone: 0.42,
  decayMs: 55,
  audioEffects: []
})

export function normalizeMetronomeSettings(input = {}) {
  const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value)))
  return {
    ...DEFAULT_METRONOME_SETTINGS,
    ...(input || {}),
    id: DEFAULT_METRONOME_SETTINGS.id,
    name: DEFAULT_METRONOME_SETTINGS.name,
    enabled: input?.enabled !== false,
    muted: input?.muted === true,
    volume: clamp(input?.volume ?? DEFAULT_METRONOME_SETTINGS.volume, 0, 100),
    pan: clamp(input?.pan ?? DEFAULT_METRONOME_SETTINGS.pan, -100, 100),
    accentLevel: clamp(input?.accentLevel ?? DEFAULT_METRONOME_SETTINGS.accentLevel, 0, 1),
    accentPitch: clamp(input?.accentPitch ?? DEFAULT_METRONOME_SETTINGS.accentPitch, 120, 4000),
    accentTone: clamp(input?.accentTone ?? DEFAULT_METRONOME_SETTINGS.accentTone, 0, 1),
    clickLevel: clamp(input?.clickLevel ?? DEFAULT_METRONOME_SETTINGS.clickLevel, 0, 1),
    clickPitch: clamp(input?.clickPitch ?? DEFAULT_METRONOME_SETTINGS.clickPitch, 120, 4000),
    clickTone: clamp(input?.clickTone ?? DEFAULT_METRONOME_SETTINGS.clickTone, 0, 1),
    decayMs: clamp(input?.decayMs ?? DEFAULT_METRONOME_SETTINGS.decayMs, 12, 240),
    outputRoute: 'Stereo Out',
    audioEffects: Array.isArray(input?.audioEffects) ? input.audioEffects.map((effect) => ({ ...effect, params: { ...(effect?.params || {}) } })) : []
  }
}
