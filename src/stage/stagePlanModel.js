export const DEFAULT_COORDINATE_SYSTEM = {
  // X: stage left/right, Y: height, Z: upstage/downstage
  axes: { x: 'leftRight', y: 'height', z: 'depth' },
  origin: 'stage-center'
}

export const CLEAN_DEFAULT_PLAN_VERSION = 2

const nowIso = () => new Date().toISOString()
const asNumber = (value, fallback = 0) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}
const asBoolean = (value, fallback = false) => typeof value === 'boolean' ? value : fallback
const safeString = (value, fallback = '') => String(value ?? fallback).trim()
const arrayOr = (value, fallback = []) => Array.isArray(value) ? value : fallback
const clampPositive = (value, fallback = 1) => Math.max(0.01, asNumber(value, fallback))

function normalizeVector(raw = {}, fallback = { x: 0, y: 0, z: 0 }) {
  if (Array.isArray(raw)) return { x: asNumber(raw[0], fallback.x), y: asNumber(raw[1], fallback.y), z: asNumber(raw[2], fallback.z) }
  return {
    x: asNumber(raw?.x, fallback.x),
    y: asNumber(raw?.y, fallback.y),
    z: asNumber(raw?.z, fallback.z)
  }
}

function normalizeDimensions(raw = {}, fallback = { width: 1, depth: 1, height: 1 }) {
  if (Array.isArray(raw)) return { width: clampPositive(raw[0], fallback.width), depth: clampPositive(raw[2], fallback.depth), height: clampPositive(raw[1], fallback.height) }
  return {
    width: clampPositive(raw?.width, fallback.width),
    depth: clampPositive(raw?.depth, fallback.depth),
    height: clampPositive(raw?.height, fallback.height)
  }
}

function normalizeStageObject(raw = {}, index = 0) {
  const id = safeString(raw.id || raw.key || raw.name || `object-${index + 1}`)
  const kind = safeString(raw.kind || raw.type || 'object')
  const category = safeString(raw.category || raw.layer || 'stage')
  const label = safeString(raw.label || raw.name || id, id)
  return {
    id,
    kind,
    type: safeString(raw.type || kind, kind),
    category,
    name: safeString(raw.name || label, label),
    label,
    layer: safeString(raw.layer || category, category),
    position: normalizeVector(raw.position, { x: 0, y: 0, z: 0 }),
    rotation: normalizeVector(raw.rotation, { x: 0, y: 0, z: 0 }),
    scale: normalizeVector(raw.scale, { x: 1, y: 1, z: 1 }),
    dimensions: normalizeDimensions(raw.dimensions || raw.size, { width: 1, depth: 1, height: 1 }),
    visible: raw.visible !== false,
    locked: asBoolean(raw.locked, false),
    selectable: raw.selectable !== false,
    protected: asBoolean(raw.protected, false),
    notes: safeString(raw.notes),
    color: safeString(raw.color || raw.metadata?.color),
    metadata: raw.metadata && typeof raw.metadata === 'object' ? { ...raw.metadata } : {}
  }
}

function normalizeFixture(raw = {}, index = 0) {
  return {
    id: safeString(raw.id || `fx-${index + 1}`),
    label: safeString(raw.label || raw.name || raw.fixtureType || raw.type || `Fixture ${index + 1}`),
    name: safeString(raw.name || raw.label || raw.fixtureType || raw.type || `Fixture ${index + 1}`),
    type: safeString(raw.type || raw.fixtureType || 'Fixture'),
    fixtureType: safeString(raw.fixtureType || raw.type || 'Fixture'),
    mode: safeString(raw.mode),
    universe: Math.max(1, Math.round(asNumber(raw.universe, 1))),
    address: Math.max(0, Math.round(asNumber(raw.address, 0))),
    position: normalizeVector(raw.position, { x: 0, y: 8, z: -8 }),
    rotation: normalizeVector(raw.rotation, { x: 0, y: 0, z: 0 }),
    beamAngle: clampPositive(raw.beamAngle, 24),
    color: safeString(raw.color, '#61dcff'),
    target: raw.target && typeof raw.target === 'object' ? normalizeVector(raw.target, { x: 0, y: 1.2, z: 0 }) : safeString(raw.target),
    linkedObjectId: safeString(raw.linkedObjectId),
    trussAssignment: safeString(raw.trussAssignment),
    visible: raw.visible !== false,
    notes: safeString(raw.notes)
  }
}

function normalizeAudioInput(raw = {}, index = 0) {
  return {
    id: safeString(raw.id || `in-${raw.channel || index + 1}`),
    channel: Math.max(0, Math.round(asNumber(raw.channel, index + 1))),
    source: safeString(raw.source || raw.label || `Input ${index + 1}`),
    micDi: safeString(raw.micDi || raw.mic || raw.di),
    stand: safeString(raw.stand, 'N/A'),
    patch: safeString(raw.patch || raw.inputPatch),
    monitor: safeString(raw.monitor || raw.monitorSend),
    monitorSend: safeString(raw.monitorSend || raw.monitor),
    location: safeString(raw.location || raw.stageLocation),
    stageLocation: safeString(raw.stageLocation || raw.location),
    linkedObjectId: safeString(raw.linkedObjectId),
    notes: safeString(raw.notes)
  }
}

function normalizeRiggingItem(raw = {}, index = 0) {
  return {
    id: safeString(raw.id || `rig-${index + 1}`),
    label: safeString(raw.label || raw.name || raw.type || `Rigging ${index + 1}`),
    name: safeString(raw.name || raw.label || raw.type || `Rigging ${index + 1}`),
    type: safeString(raw.type, 'rigging'),
    position: normalizeVector(raw.position, { x: 0, y: 8, z: -8 }),
    height: asNumber(raw.height, raw.position?.y || 0),
    length: asNumber(raw.length, raw.span || 0),
    span: asNumber(raw.span, raw.length || 0),
    qualifiedOnly: raw.qualifiedOnly !== false,
    linkedObjectId: safeString(raw.linkedObjectId),
    notes: safeString(raw.notes)
  }
}

function normalizeVideoItem(raw = {}, index = 0) {
  const dimensions = normalizeDimensions(raw.dimensions || { width: raw.width, depth: raw.depth || 0.4, height: raw.height }, { width: 1, depth: 0.4, height: 1 })
  return {
    id: safeString(raw.id || `vid-${index + 1}`),
    label: safeString(raw.label || raw.name || raw.type || `Video ${index + 1}`),
    name: safeString(raw.name || raw.label || raw.type || `Video ${index + 1}`),
    type: safeString(raw.type, 'video'),
    dimensions,
    width: dimensions.width,
    height: dimensions.height,
    position: normalizeVector(raw.position, { x: 0, y: 1, z: 0 }),
    inputSource: safeString(raw.inputSource),
    aspectRatio: safeString(raw.aspectRatio),
    resolution: safeString(raw.resolution),
    linkedObjectId: safeString(raw.linkedObjectId),
    notes: safeString(raw.notes)
  }
}

function normalizeVenue(raw = {}) {
  return {
    name: safeString(raw.name, 'Blank Stage'),
    roomType: safeString(raw.roomType, 'Club'),
    fohPosition: safeString(raw.fohPosition, 'Center'),
    loadingNotes: safeString(raw.loadingNotes),
    powerNotes: safeString(raw.powerNotes),
    safetyNotes: safeString(raw.safetyNotes),
    ceilingHeight: asNumber(raw.ceilingHeight, 0),
    restrictions: safeString(raw.restrictions)
  }
}

function normalizeEditorState(raw = {}) {
  return {
    viewportMode: safeString(raw.viewportMode, 'perspective3d'),
    selectedObjectId: safeString(raw.selectedObjectId, 'stage-deck'),
    activeStageSection: safeString(raw.activeStageSection, 'home'),
    activeBottomTab: safeString(raw.activeBottomTab || raw.activeEditorMode, 'entities'),
    activeEditorMode: safeString(raw.activeEditorMode || raw.activeBottomTab, 'entities'),
    activeInspectorTab: safeString(raw.activeInspectorTab, 'properties'),
    paneSizes: raw.paneSizes && typeof raw.paneSizes === 'object' ? { ...raw.paneSizes } : {},
    gridEnabled: raw.gridEnabled ?? raw.showGrid ?? true,
    snapEnabled: raw.snapEnabled ?? true,
    snapInterval: clampPositive(raw.snapInterval, 1),
    beamPreviewEnabled: raw.beamPreviewEnabled ?? raw.showBeams ?? true,
    measureModeEnabled: raw.measureModeEnabled ?? false,
    showLabels: raw.showLabels ?? true,
    diagnosticsEnabled: raw.diagnosticsEnabled ?? raw.showViewportDiagnostics ?? false
  }
}

export function createDefaultStagePlan({ id = '', name = 'Blank Stage', version = 1 } = {}) {
  const defaultObjects = [
    {
      id: 'stage-deck',
      kind: 'deck',
      type: 'deck',
      category: 'venue',
      name: 'Stage Deck',
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      dimensions: { width: 32, depth: 24, height: 1 },
      label: 'Stage Deck',
      locked: true,
      protected: true,
      selectable: true,
      visible: true,
      notes: '',
      metadata: {}
    },
    { id: 'speaker-left', kind: 'speaker', type: 'speaker', category: 'audio', name: 'Speaker Left', position: { x: -14, y: 2.5, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.8, depth: 1.6, height: 5 }, label: 'Speaker Left', locked: false, visible: true, selectable: true, notes: '', metadata: {} },
    { id: 'speaker-right', kind: 'speaker', type: 'speaker', category: 'audio', name: 'Speaker Right', position: { x: 14, y: 2.5, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.8, depth: 1.6, height: 5 }, label: 'Speaker Right', locked: false, visible: true, selectable: true, notes: '', metadata: {} }
  ]
  return {
    id,
    name,
    title: name,
    defaultPlanVersion: CLEAN_DEFAULT_PLAN_VERSION,
    version,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    units: 'ft',
    stageDimensions: { width: 32, depth: 24, deckHeight: 4, unit: 'ft' },
    coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
    objects: defaultObjects,
    fixtures: [],
    audioInputs: [],
    rigging: [],
    video: [],
    power: [],
    layers: [
      { id: 'stage', label: 'Stage', visible: true, locked: false, export: true },
      { id: 'backline', label: 'Backline', visible: true, locked: false, export: true },
      { id: 'audio', label: 'Audio', visible: true, locked: false, export: true },
      { id: 'lighting', label: 'Lighting', visible: true, locked: false, export: true },
      { id: 'rigging', label: 'Rigging', visible: true, locked: false, export: true },
      { id: 'video', label: 'Video', visible: true, locked: false, export: true },
      { id: 'venue', label: 'Venue', visible: true, locked: false, export: true },
      { id: 'power', label: 'Power', visible: true, locked: false, export: true },
      { id: 'notes', label: 'Notes', visible: true, locked: false, export: true },
      { id: 'measurements', label: 'Measurements', visible: true, locked: false, export: false }
    ],
    measurements: [],
    annotations: [],
    venue: { name: 'Blank Stage', roomType: 'Club', fohPosition: 'Center', powerNotes: '', loadingNotes: '', safetyNotes: '', ceilingHeight: 0, restrictions: '' },
    notes: '',
    warnings: [],
    exportSettings: { pageSize: 'A3', orientation: 'landscape', scale: '1:50', titleBlock: true, showGrid: true, showLabels: true, includeInputList: true, includeLightingPlot: true, includeRiggingPlan: true },
    editorState: normalizeEditorState()
  }
}

export function normalizeStagePlan(raw = {}) {
  const source = raw.plan && typeof raw.plan === 'object' ? { ...raw.plan, id: raw.id || raw.plan.id, name: raw.name || raw.title || raw.plan.name } : raw
  const legacyStageDimensions = raw.stage && typeof raw.stage === 'object'
    ? { width: raw.stage.width, depth: raw.stage.depth, deckHeight: raw.stage.deckHeight ?? raw.stage.height, unit: raw.stage.unit }
    : {}
  const base = createDefaultStagePlan({ id: source.id || '', name: source.name || source.title || 'Untitled Stage Plan', version: source.version || raw.version || 1 })
  const normalized = {
    ...base,
    ...source,
    defaultPlanVersion: source.defaultPlanVersion || raw.defaultPlanVersion || base.defaultPlanVersion,
    title: raw.title || source.title || source.name || base.name,
    stageType: raw.stageType || source.stageType || 'Blank Stage',
    stageDimensions: { ...base.stageDimensions, ...legacyStageDimensions, ...(source.stageDimensions || raw.stageDimensions || {}) },
    coordinateSystem: { ...base.coordinateSystem, ...(source.coordinateSystem || raw.coordinateSystem || {}) },
    objects: arrayOr(source.objects, arrayOr(raw.objects, base.objects)).map(normalizeStageObject),
    fixtures: arrayOr(source.fixtures, arrayOr(raw.fixtures, base.fixtures)).map(normalizeFixture),
    audioInputs: arrayOr(source.audioInputs, arrayOr(raw.audioInputs, base.audioInputs)).map(normalizeAudioInput),
    rigging: arrayOr(source.rigging, arrayOr(raw.rigging, base.rigging)).map(normalizeRiggingItem),
    video: arrayOr(source.video, arrayOr(raw.video, base.video)).map(normalizeVideoItem),
    power: Array.isArray(source.power) ? source.power : Array.isArray(raw.power) ? raw.power : base.power,
    layers: Array.isArray(source.layers) ? source.layers : Array.isArray(raw.layers) ? raw.layers : base.layers,
    measurements: Array.isArray(source.measurements) ? source.measurements : Array.isArray(raw.measurements) ? raw.measurements : base.measurements,
    annotations: Array.isArray(source.annotations) ? source.annotations : Array.isArray(raw.annotations) ? raw.annotations : base.annotations,
    venue: normalizeVenue({ ...base.venue, ...(raw.venue || {}), ...(source.venue || {}) }),
    notes: source.notes ?? raw.notes ?? base.notes,
    exportSettings: { ...base.exportSettings, ...(raw.exportSettings || {}), ...(source.exportSettings || {}) },
    editorState: normalizeEditorState(source.editorState || raw.editorState || base.editorState)
  }
  normalized.warnings = getStagePlanWarnings(normalized)
  return normalized
}

export function isOldDemoFallbackPlan(plan = {}) {
  const objectIds = new Set(arrayOr(plan.objects).map((object) => object?.id || object?.key).filter(Boolean))
  const oldDemoIds = ['drum-riser', 'truss-a', 'camera-1', 'moving-head']
  const hasOldDemoObjects = oldDemoIds.some((id) => objectIds.has(id))
  const hasOldDemoRows = arrayOr(plan.fixtures).some((fixture) => String(fixture?.id || '').startsWith('fx-'))
    || arrayOr(plan.audioInputs).some((input) => ['Kick In', 'Kick Out', 'Snare Top', 'Playback L', 'Playback R'].includes(input?.source))
    || arrayOr(plan.rigging).some((rig) => rig?.id === 'rig-1' || rig?.linkedObjectId === 'truss-a')
  return plan.defaultPlanVersion !== CLEAN_DEFAULT_PLAN_VERSION && (hasOldDemoObjects || hasOldDemoRows)
}

export function migrateDefaultFallbackPlan(plan = {}, overrides = {}) {
  if (!isOldDemoFallbackPlan(plan)) return normalizeStagePlan(plan)
  return createDefaultStagePlan({
    id: overrides.id || plan.id || '',
    name: overrides.name || plan.title || plan.name || 'Fallback Stage Plan',
    version: plan.version || overrides.version || 1
  })
}

export function findDuplicateInputChannels(plan = {}) {
  const seen = new Map()
  const duplicates = []
  arrayOr(plan.audioInputs).forEach((input) => {
    const channel = Number(input.channel)
    if (!Number.isFinite(channel) || channel <= 0) return
    if (seen.has(channel)) duplicates.push({ channel, first: seen.get(channel), second: input })
    else seen.set(channel, input)
  })
  return duplicates
}

export function findDuplicateDmxAddresses(plan = {}) {
  const seen = new Map()
  const duplicates = []
  arrayOr(plan.fixtures).forEach((fixture) => {
    const universe = Number(fixture.universe || 1)
    const address = Number(fixture.address)
    if (!Number.isFinite(address) || address <= 0) return
    const key = `${universe}:${address}`
    if (seen.has(key)) duplicates.push({ key, first: seen.get(key), second: fixture })
    else seen.set(key, fixture)
  })
  return duplicates
}

export function findObjectsOffStage(plan = {}) {
  const dims = plan.stageDimensions || {}
  const halfWidth = asNumber(dims.width, 32) / 2
  const halfDepth = asNumber(dims.depth, 24) / 2
  return arrayOr(plan.objects).filter((object) => {
    const pos = object.position || {}
    if (object.category === 'venue' && object.type !== 'deck') return false
    return Math.abs(asNumber(pos.x, 0)) > halfWidth || Math.abs(asNumber(pos.z, 0)) > halfDepth
  })
}

export function findUnlabeledObjects(plan = {}) {
  return arrayOr(plan.objects).filter((object) => !safeString(object.label || object.name))
}

export function getStagePlanWarnings(plan = {}) {
  const warnings = []
  findObjectsOffStage(plan).forEach((object) => warnings.push({ level: 'warning', title: `${object.label || object.name || object.id} is outside the stage outline`, ownerId: object.id }))
  findUnlabeledObjects(plan).forEach((object) => warnings.push({ level: 'warning', title: `Object ${object.id} has no label`, ownerId: object.id }))
  findDuplicateInputChannels(plan).forEach(({ channel, first, second }) => warnings.push({ level: 'error', title: `Duplicate input channel ${channel}: ${first.source || first.id} and ${second.source || second.id}`, ownerId: second.id }))
  findDuplicateDmxAddresses(plan).forEach(({ key, first, second }) => warnings.push({ level: 'error', title: `Duplicate DMX address U${key.replace(':', ':')}: ${first.name || first.id} and ${second.name || second.id}`, ownerId: second.linkedObjectId || second.id }))
  arrayOr(plan.fixtures).forEach((fixture) => {
    if (!fixture.address) warnings.push({ level: 'warning', title: `${fixture.name || fixture.label || fixture.id} has no DMX address`, ownerId: fixture.linkedObjectId || fixture.id })
  })
  arrayOr(plan.audioInputs).forEach((input) => {
    if (!input.channel) warnings.push({ level: 'warning', title: `${input.source || input.id} has no input channel`, ownerId: input.linkedObjectId || input.id })
    if (!input.source) warnings.push({ level: 'warning', title: `Input ${input.channel || input.id} has no source`, ownerId: input.linkedObjectId || input.id })
  })
  if (!plan.venue?.name || plan.venue.name === 'Blank Stage') warnings.push({ level: 'info', title: 'Venue name is not set', ownerId: 'venue' })
  if (!arrayOr(plan.rigging).some((rig) => safeString(rig.notes))) warnings.push({ level: 'info', title: 'Rigging notes are not export-ready yet', ownerId: 'rigging' })
  return warnings
}

export function validateStagePlan(plan = {}) {
  const errors = []
  const warnings = getStagePlanWarnings(plan)
  if (!safeString(plan.title || plan.name)) errors.push('Project title is required.')
  if (!plan.stageDimensions?.width || !plan.stageDimensions?.depth) errors.push('Stage dimensions are required.')
  if (!Array.isArray(plan.objects)) errors.push('Stage objects must be an array.')
  return { valid: errors.length === 0, errors, warnings }
}
