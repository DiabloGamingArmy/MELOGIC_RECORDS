export const SOURA_EDITOR_FORMAT_VERSION = 5
export const PORTABLE_TRACK_RENDER_FORMAT_VERSION = 1
export const PORTABLE_TRACK_RENDER_SCOPE = 'post-insert-pre-fader'

const RUNTIME_INSTRUMENT_PARAM_KEYS = new Set([
  'nativePluginPath',
  'nativeExecutionState'
])

function canonicalize(value) {
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(canonicalize)
  if (typeof value !== 'object') return undefined
  return Object.keys(value).sort().reduce((result, key) => {
    const next = canonicalize(value[key])
    if (next !== undefined) result[key] = next
    return result
  }, {})
}

export function stablePortableJson(value) {
  return JSON.stringify(canonicalize(value))
}

export function hashPortableSource(value) {
  const input = stablePortableJson(value)
  let hash = 0xcbf29ce484222325n
  for (let index = 0; index < input.length; index += 1) {
    hash ^= BigInt(input.charCodeAt(index))
    hash = BigInt.asUintN(64, hash * 0x100000001b3n)
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`
}

export function serializePortableInstrument(instrument) {
  if (!instrument || typeof instrument !== 'object') return null
  const params = Object.entries(instrument.params || {}).reduce((result, [key, value]) => {
    if (!RUNTIME_INSTRUMENT_PARAM_KEYS.has(key)) result[key] = canonicalize(value)
    return result
  }, {})
  const serialized = { ...instrument, params }
  if (serialized.type === 'native-vst3') delete serialized.pluginInstanceId
  return canonicalize(serialized)
}

export function createTrackDependencyDescriptor(instrument) {
  if (!instrument || typeof instrument !== 'object') return null
  const params = instrument.params || {}
  if (instrument.type === 'native-vst3') {
    return canonicalize({
      kind: 'instrument-plugin',
      capability: 'native-vst3-host',
      format: params.nativePluginFormat || 'VST3',
      id: params.nativePluginBundleId || null,
      name: params.nativePluginName || instrument.name || 'VST3 Instrument',
      vendor: params.nativePluginVendor || null,
      version: params.nativePluginVersion || null
    })
  }
  return canonicalize({
    kind: 'instrument',
    capability: 'shared-instrument',
    format: instrument.type || 'unknown',
    id: instrument.type || null,
    name: instrument.name || instrument.type || 'Instrument'
  })
}

function portableRegionSource(region = {}) {
  const base = {
    type: region.type || 'midi',
    startBeat: Number(region.startBeat) || 0,
    endBeat: Number(region.endBeat) || 0,
    muted: Boolean(region.muted),
    notes: Array.isArray(region.notes) ? region.notes.map((note) => ({
      note: Number(note.note) || 0,
      startBeat: Number(note.startBeat) || 0,
      durationBeats: Number(note.durationBeats) || 0,
      velocity: Number(note.velocity) || 0,
      channel: Number(note.channel) || 0,
      muted: Boolean(note.muted),
      expression: note.expression || null
    })) : [],
    automation: region.automation || null
  }
  if (region.type === 'audio') {
    base.audioAssetId = region.audioClip?.audioAssetId || region.audioClip?.id || region.clipId || null
    base.audioEdit = region.audioEdit || null
    base.stretch = region.stretch || null
  }
  return canonicalize(base)
}

export function createPortableTrackSource({ track = {}, regions = [], tempoEvents = [], timeSignatureEvents = [] } = {}) {
  const instrument = serializePortableInstrument(track.instrument)
  if (instrument) {
    delete instrument.id
    delete instrument.pluginInstanceId
  }
  return canonicalize({
    scope: PORTABLE_TRACK_RENDER_SCOPE,
    instrument,
    midiEffects: track.midiEffects || [],
    audioEffects: track.audioEffects || [],
    automation: track.automation?.parameters?.filter ? { filter: track.automation.parameters.filter } : null,
    filter: Number(track.filter) || 0,
    transpose: Number(track.transpose) || 0,
    octaveShift: Number(track.octaveShift) || 0,
    velocityOffset: Number(track.velocityOffset) || 0,
    midiLatencyMs: Number(track.midiLatencyMs) || 0,
    regions: regions
      .filter((region) => region?.trackId === track.id)
      .map(portableRegionSource)
      .sort((left, right) => left.startBeat - right.startBeat || left.endBeat - right.endBeat),
    tempoEvents,
    timeSignatureEvents
  })
}

export function computePortableTrackSourceRevision(input = {}) {
  return hashPortableSource(createPortableTrackSource(input))
}

export function normalizePortableTrackRender(render) {
  if (!render || typeof render !== 'object') return null
  const audio = render.audio && typeof render.audio === 'object' ? canonicalize({
    storagePath: render.audio.storagePath || null,
    downloadUrl: render.audio.downloadUrl || null,
    contentType: render.audio.contentType || 'audio/*',
    durationSeconds: Number(render.audio.durationSeconds) || null,
    sampleRate: Number(render.audio.sampleRate) || null,
    channelCount: Number(render.audio.channelCount) || null,
    startBeat: Number(render.audio.startBeat) || 0,
    endBeat: Number(render.audio.endBeat) || null
  }) : null
  if (!audio || (!audio.storagePath && !audio.downloadUrl)) return null
  return canonicalize({
    formatVersion: PORTABLE_TRACK_RENDER_FORMAT_VERSION,
    kind: 'track-audio',
    scope: PORTABLE_TRACK_RENDER_SCOPE,
    sourceRevision: String(render.sourceRevision || ''),
    status: render.status === 'stale' ? 'stale' : 'current',
    createdAt: render.createdAt || null,
    renderedBy: render.renderedBy || null,
    audio
  })
}

export function serializePortableTrackRender(render, currentSourceRevision = '') {
  const normalized = normalizePortableTrackRender(render)
  if (!normalized) return null
  return {
    ...normalized,
    status: normalized.sourceRevision && normalized.sourceRevision === currentSourceRevision ? 'current' : 'stale'
  }
}

export function getPortableTrackPlaybackDecision({
  track = {},
  regions = [],
  tempoEvents = [],
  timeSignatureEvents = [],
  capabilities = {},
  dependencyAvailable
} = {}) {
  const dependency = track.dependency || createTrackDependencyDescriptor(track.instrument)
  const requiresNativeVst3 = dependency?.capability === 'native-vst3-host'
  const available = typeof dependencyAvailable === 'boolean'
    ? dependencyAvailable
    : (!requiresNativeVst3 || (Boolean(capabilities.nativeVst3Host) && Boolean(track.instrument?.params?.nativePluginPath)))
  const sourceRevision = computePortableTrackSourceRevision({ track, regions, tempoEvents, timeSignatureEvents })
  const portableRender = normalizePortableTrackRender(track.portableRender)
  const portableCurrent = Boolean(portableRender?.sourceRevision && portableRender.sourceRevision === sourceRevision)

  if (available) return { mode: 'live', dependency, sourceRevision, portableRender, portableCurrent }
  if (portableCurrent) return { mode: 'portable', dependency, sourceRevision, portableRender, portableCurrent: true }
  if (portableRender) return { mode: 'stale', dependency, sourceRevision, portableRender, portableCurrent: false }
  return { mode: requiresNativeVst3 ? 'unavailable' : 'live', dependency, sourceRevision, portableRender: null, portableCurrent: false }
}
