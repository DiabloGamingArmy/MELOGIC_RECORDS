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
  const selectedObjectId = safeString(raw.selectedObjectId, 'stage-deck')
  return {
    viewportMode: safeString(raw.viewportMode, 'perspective3d'),
    paneSizes: raw.paneSizes && typeof raw.paneSizes === 'object' ? { ...raw.paneSizes } : {},
    activeLayer: safeString(raw.activeLayer, 'stage'),
    activeStageSection: safeString(raw.activeStageSection, 'home'),
    activeLibraryCategory: safeString(raw.activeLibraryCategory, 'all'),
    objectLibrarySearch: safeString(raw.objectLibrarySearch),
    editorToolMode: safeString(raw.editorToolMode, 'pan'),
    activeEditorMode: safeString(raw.activeEditorMode || raw.activeBottomTab, 'entities'),
    activeInspectorTab: safeString(raw.activeInspectorTab, 'properties'),
    activeDataTab: safeString(raw.activeDataTab, 'schema'),
    renderMode: safeString(raw.renderMode, 'technical'),
    selectedObjectId,
    selectedObjectIds: arrayOr(raw.selectedObjectIds, [selectedObjectId].filter(Boolean)).map((id) => safeString(id)).filter(Boolean).slice(0, 250),
    showGrid: raw.showGrid ?? raw.gridEnabled ?? true,
    snapEnabled: raw.snapEnabled ?? true,
    snapInterval: clampPositive(raw.snapInterval, 1),
    showLabels: raw.showLabels ?? true,
    showBeams: raw.showBeams ?? raw.beamPreviewEnabled ?? true,
    showViewportDiagnostics: raw.showViewportDiagnostics ?? raw.diagnosticsEnabled ?? false,
    stageTabs: arrayOr(raw.stageTabs, [{ id: 'stage-1', title: 'Untitled Stage' }]),
    activeStageTabId: safeString(raw.activeStageTabId, 'stage-1'),
    objectTransforms: raw.objectTransforms && typeof raw.objectTransforms === 'object' ? { ...raw.objectTransforms } : {},
    savedAt: safeString(raw.savedAt)
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
    { id: 'speaker-left', kind: 'speaker', type: 'speaker', category: 'audio', name: 'Speaker Left', position: { x: -14, y: 2.5, z: 9 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.8, depth: 1.6, height: 5 }, label: 'Speaker Left', locked: false, visible: true, selectable: true, notes: '', metadata: {} },
    { id: 'speaker-right', kind: 'speaker', type: 'speaker', category: 'audio', name: 'Speaker Right', position: { x: 14, y: 2.5, z: 9 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.8, depth: 1.6, height: 5 }, label: 'Speaker Right', locked: false, visible: true, selectable: true, notes: '', metadata: {} }
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

function positionedObject(id, name, category, position, dimensions, metadata = {}) {
  return {
    id,
    kind: metadata.kind || metadata.type || category,
    type: metadata.type || category,
    category,
    name,
    position,
    rotation: { x: 0, y: 0, z: 0 },
    dimensions,
    label: name,
    locked: false,
    protected: false,
    selectable: true,
    visible: true,
    notes: metadata.notes || '',
    metadata
  }
}

function applyStageDimensions(plan, { width, depth, deckHeight = 4, unit = 'ft' } = {}) {
  plan.stageDimensions = { width, depth, deckHeight, unit }
  const deck = plan.objects.find((object) => object.id === 'stage-deck')
  if (deck) {
    deck.dimensions = { ...(deck.dimensions || {}), width, depth, height: Math.max(0.2, deckHeight * 0.25) }
    deck.position = { ...(deck.position || {}), y: Math.max(0.1, deckHeight * 0.125) }
  }
}

function audioInput(channel, source, micDi = '', location = '', monitor = '') {
  return { id: `in-${channel}`, channel, source, micDi, stand: micDi.includes('DI') ? 'N/A' : 'Boom', patch: '', monitor, monitorSend: monitor, location, stageLocation: location, linkedObjectId: '', notes: '' }
}

function fixture(id, label, position, address = 1, type = 'LED PAR') {
  return { id, label, name: label, type, fixtureType: type, mode: 'Standard', universe: 1, address, position, rotation: { x: 0, y: 0, z: 0 }, beamAngle: 32, color: '#61dcff', target: 'Stage center', linkedObjectId: '', trussAssignment: '', visible: true, notes: '' }
}

export function createStageTemplatePlan({ id = '', name = 'Blank Stage', stageType = 'Blank Stage', version = 1 } = {}) {
  const plan = createDefaultStagePlan({ id, name, version })
  plan.stageType = stageType
  plan.venue = { ...plan.venue, name: stageType, roomType: stageType }

  if (stageType === 'Band Performance') {
    applyStageDimensions(plan, { width: 32, depth: 24, deckHeight: 4 })
    plan.objects.push(
      positionedObject('drum-riser', 'Drum Riser', 'backline', { x: 0, y: 1.5, z: -6 }, { width: 8, depth: 8, height: 1 }, { type: 'drum-riser' }),
      positionedObject('lead-vocal', 'Lead Vocal Mic', 'audio', { x: 0, y: 2.4, z: 7 }, { width: 0.5, depth: 0.5, height: 4.5 }, { type: 'microphone' }),
      positionedObject('guitar-amp', 'Guitar Amp', 'backline', { x: -7, y: 2, z: -2 }, { width: 2.4, depth: 1.2, height: 2.2 }, { type: 'guitar-amp' }),
      positionedObject('bass-di', 'Bass DI', 'audio', { x: 7, y: 1.2, z: -2 }, { width: 1, depth: 0.8, height: 0.4 }, { type: 'bass-di' }),
      positionedObject('wedge-lead', 'Lead Vocal Wedge', 'audio', { x: 0, y: 1.3, z: 10 }, { width: 2.2, depth: 1.4, height: 0.8 }, { type: 'wedge-monitor' })
    )
    plan.audioInputs = [
      audioInput(1, 'Kick', 'Beta 52', 'Drums', 'Mix 1'),
      audioInput(2, 'Snare', 'SM57', 'Drums', 'Mix 1'),
      audioInput(3, 'Guitar Amp', 'SM57', 'USL', 'Mix 2'),
      audioInput(4, 'Bass DI', 'DI', 'USR', 'Mix 2'),
      audioInput(5, 'Lead Vocal', 'Wireless Handheld', 'DSC', 'Mix 1')
    ]
  } else if (stageType === 'DJ / EDM Stage') {
    applyStageDimensions(plan, { width: 36, depth: 20, deckHeight: 5 })
    plan.objects.push(
      positionedObject('dj-booth', 'DJ Booth', 'backline', { x: 0, y: 2, z: -2 }, { width: 10, depth: 3, height: 3 }, { type: 'dj-booth' }),
      positionedObject('led-wall', 'LED Wall', 'video', { x: 0, y: 5, z: -10.5 }, { width: 18, depth: 0.4, height: 8 }, { type: 'led-wall' }),
      positionedObject('sub-left', 'Subwoofer Left', 'audio', { x: -7, y: 1, z: 10 }, { width: 3, depth: 2.5, height: 1.4 }, { type: 'subwoofer' }),
      positionedObject('sub-right', 'Subwoofer Right', 'audio', { x: 7, y: 1, z: 10 }, { width: 3, depth: 2.5, height: 1.4 }, { type: 'subwoofer' })
    )
    plan.audioInputs = [audioInput(1, 'DJ Left', 'DI', 'Booth'), audioInput(2, 'DJ Right', 'DI', 'Booth'), audioInput(3, 'MC Mic', 'Wireless Handheld', 'DSC')]
    plan.fixtures = [fixture('fx-1', 'Mover Left', { x: -10, y: 8, z: -8 }, 1, 'Moving Head'), fixture('fx-2', 'Mover Right', { x: 10, y: 8, z: -8 }, 25, 'Moving Head')]
    plan.video = [{ id: 'vid-1', label: 'LED Wall', name: 'LED Wall', type: 'led-wall', dimensions: { width: 18, depth: 0.4, height: 8 }, width: 18, height: 8, position: { x: 0, y: 5, z: -10.5 }, inputSource: 'VJ Playback', aspectRatio: '16:9', resolution: '1920x1080', linkedObjectId: 'led-wall', notes: '' }]
  } else if (stageType === 'Church Service') {
    applyStageDimensions(plan, { width: 40, depth: 24, deckHeight: 3 })
    plan.objects.push(
      positionedObject('lectern', 'Lectern', 'backline', { x: 0, y: 2.1, z: 4 }, { width: 2.2, depth: 1.4, height: 3 }, { type: 'lectern' }),
      positionedObject('keys', 'Keys', 'backline', { x: -9, y: 1.4, z: -2 }, { width: 5, depth: 2, height: 1.4 }, { type: 'keyboard' }),
      positionedObject('choir-riser', 'Choir Riser', 'backline', { x: 0, y: 1.7, z: -8 }, { width: 22, depth: 5, height: 1.4 }, { type: 'riser' }),
      positionedObject('camera-center', 'Center Camera', 'video', { x: 0, y: 2, z: 20 }, { width: 1, depth: 1, height: 2 }, { type: 'camera' })
    )
    plan.audioInputs = [audioInput(1, 'Pastor Mic', 'Wireless Lav', 'Lectern'), audioInput(2, 'Lectern Mic', 'Gooseneck', 'Lectern'), audioInput(3, 'Keys L', 'DI', 'USL'), audioInput(4, 'Keys R', 'DI', 'USL'), audioInput(5, 'Choir L', 'Condenser', 'Choir'), audioInput(6, 'Choir R', 'Condenser', 'Choir')]
    plan.video = [{ id: 'vid-1', label: 'Program Camera', name: 'Program Camera', type: 'camera', dimensions: { width: 1, depth: 1, height: 2 }, width: 1, height: 2, position: { x: 0, y: 2, z: 20 }, inputSource: 'Camera 1', aspectRatio: '16:9', resolution: '1080p', linkedObjectId: 'camera-center', notes: '' }]
  } else if (stageType === 'School Auditorium') {
    applyStageDimensions(plan, { width: 36, depth: 22, deckHeight: 3 })
    plan.objects.push(
      positionedObject('podium', 'Podium', 'backline', { x: 0, y: 2, z: 5 }, { width: 2, depth: 1.4, height: 3 }, { type: 'podium' }),
      positionedObject('choir-risers', 'Choir Risers', 'backline', { x: 0, y: 1.7, z: -6 }, { width: 24, depth: 6, height: 1.2 }, { type: 'riser' }),
      positionedObject('projector-screen', 'Projection Screen', 'video', { x: 0, y: 5, z: -10.5 }, { width: 14, depth: 0.35, height: 7 }, { type: 'screen' })
    )
    plan.audioInputs = [audioInput(1, 'Podium Mic', 'Gooseneck', 'DSC'), audioInput(2, 'Playback L', 'DI', 'FOH'), audioInput(3, 'Playback R', 'DI', 'FOH')]
  } else if (stageType === 'Livestream Setup') {
    applyStageDimensions(plan, { width: 24, depth: 18, deckHeight: 1 })
    plan.objects.push(
      positionedObject('host-desk', 'Host Desk', 'backline', { x: 0, y: 1.3, z: 1 }, { width: 8, depth: 2.4, height: 2 }, { type: 'desk' }),
      positionedObject('key-light-left', 'Key Light Left', 'lighting', { x: -6, y: 6, z: 6 }, { width: 1, depth: 1, height: 1 }, { type: 'soft-light' }),
      positionedObject('key-light-right', 'Key Light Right', 'lighting', { x: 6, y: 6, z: 6 }, { width: 1, depth: 1, height: 1 }, { type: 'soft-light' }),
      positionedObject('camera-a', 'Camera A', 'video', { x: 0, y: 1.7, z: 10 }, { width: 1, depth: 1, height: 2 }, { type: 'camera' }),
      positionedObject('background', 'Background Wall', 'video', { x: 0, y: 3, z: -7.5 }, { width: 16, depth: 0.3, height: 7 }, { type: 'backdrop' })
    )
    plan.audioInputs = [audioInput(1, 'Host Lav', 'Wireless Lav', 'Desk'), audioInput(2, 'Guest Lav', 'Wireless Lav', 'Desk')]
    plan.video = [{ id: 'vid-1', label: 'Camera A', name: 'Camera A', type: 'camera', dimensions: { width: 1, depth: 1, height: 2 }, width: 1, height: 2, position: { x: 0, y: 1.7, z: 10 }, inputSource: 'Camera A', aspectRatio: '16:9', resolution: '1080p', linkedObjectId: 'camera-a', notes: '' }]
  } else if (stageType === 'Festival Stage') {
    applyStageDimensions(plan, { width: 60, depth: 40, deckHeight: 5 })
    plan.objects.push(
      positionedObject('main-truss', 'Upstage Truss', 'rigging', { x: 0, y: 10, z: -16 }, { width: 44, depth: 0.5, height: 0.5 }, { type: 'truss' }),
      positionedObject('led-wall', 'Center LED Wall', 'video', { x: 0, y: 7, z: -18.5 }, { width: 28, depth: 0.4, height: 12 }, { type: 'led-wall' }),
      positionedObject('drum-riser', 'Drum Riser', 'backline', { x: 0, y: 1.8, z: -8 }, { width: 10, depth: 8, height: 1.2 }, { type: 'riser' }),
      positionedObject('foh', 'FOH Position', 'venue', { x: 0, y: 0.2, z: 42 }, { width: 8, depth: 6, height: 0.2 }, { type: 'foh-position' })
    )
    plan.fixtures = [fixture('fx-1', 'Mover 1', { x: -18, y: 10, z: -16 }, 1, 'Moving Head'), fixture('fx-2', 'Mover 2', { x: -6, y: 10, z: -16 }, 25, 'Moving Head'), fixture('fx-3', 'Mover 3', { x: 6, y: 10, z: -16 }, 49, 'Moving Head'), fixture('fx-4', 'Mover 4', { x: 18, y: 10, z: -16 }, 73, 'Moving Head')]
    plan.rigging = [{ id: 'rig-1', label: 'Upstage truss', name: 'Upstage truss', type: 'truss', position: { x: 0, y: 10, z: -16 }, height: 10, length: 44, span: 44, qualifiedOnly: true, linkedObjectId: 'main-truss', notes: 'Load calculations required by qualified rigger.' }]
    plan.audioInputs = [audioInput(1, 'Kick', 'Beta 52', 'Drums'), audioInput(2, 'Snare', 'SM57', 'Drums'), audioInput(3, 'Guitar L', 'SM57', 'SL'), audioInput(4, 'Guitar R', 'SM57', 'SR'), audioInput(5, 'Bass DI', 'DI', 'SR'), audioInput(6, 'Lead Vocal', 'Wireless Handheld', 'DSC')]
  }

  plan.updatedAt = nowIso()
  plan.warnings = getStagePlanWarnings(plan)
  return normalizeStagePlan(plan)
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
