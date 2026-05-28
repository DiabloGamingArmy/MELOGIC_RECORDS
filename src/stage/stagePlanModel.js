export const DEFAULT_COORDINATE_SYSTEM = {
  // X: stage left/right, Y: height, Z: upstage/downstage
  axes: { x: 'leftRight', y: 'height', z: 'depth' },
  origin: 'stage-center'
}

export function createDefaultStagePlan({ id = '', name = 'Blank Stage', version = 1 } = {}) {
  const defaultObjects = [
    {
      id: 'stage-deck',
      type: 'deck',
      category: 'venue',
      name: 'Stage Deck',
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      dimensions: { width: 32, depth: 24, height: 1 },
      label: 'Stage Deck',
      locked: false,
      visible: true,
      notes: '',
      metadata: {}
    },
    { id: 'drum-riser', type: 'riser', category: 'band-backline', name: 'Drum Riser', position: { x: 0, y: 1.1, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 6, depth: 5, height: 0.6 }, label: 'Drum Riser', locked: false, visible: true, notes: '', metadata: {} },
    { id: 'truss-a', type: 'truss', category: 'rigging', name: 'Truss A', position: { x: 0, y: 8.4, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 34, depth: 0.35, height: 0.35 }, label: 'Ground supported truss', locked: false, visible: true, notes: 'Ground support placeholder only.', metadata: { qualifiedOnly: true } },
    { id: 'speaker-left', type: 'speaker', category: 'audio', name: 'Speaker Left', position: { x: -14, y: 2.5, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.8, depth: 1.6, height: 5 }, label: 'Speaker Left', locked: false, visible: true, notes: '', metadata: {} },
    { id: 'speaker-right', type: 'speaker', category: 'audio', name: 'Speaker Right', position: { x: 14, y: 2.5, z: -2 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 1.8, depth: 1.6, height: 5 }, label: 'Speaker Right', locked: false, visible: true, notes: '', metadata: {} },
    { id: 'camera-1', type: 'camera', category: 'video', name: 'Camera 1', position: { x: 0, y: 1.3, z: 17 }, rotation: { x: 0, y: 0, z: 90 }, dimensions: { width: 0.8, depth: 0.8, height: 2 }, label: 'Camera 1', locked: false, visible: true, notes: '', metadata: { target: 'Downstage Center' } },
    { id: 'moving-head', type: 'moving-head', category: 'lighting', name: 'Moving Head', position: { x: 5.8, y: 8, z: -8 }, rotation: { x: 0, y: 0, z: 0 }, dimensions: { width: 0.8, depth: 0.8, height: 0.8 }, label: 'Moving Head', locked: false, visible: true, notes: '', metadata: { universe: 1, address: 1, mode: '24ch', beamAngle: 24 } }
  ]
  return {
    id,
    name,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: 'ft',
    stageDimensions: { width: 32, depth: 24, deckHeight: 4, unit: 'ft' },
    coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
    objects: defaultObjects,
    fixtures: [
      { id: 'fx-1', name: 'Moving Head L', type: 'Moving Head', universe: 1, address: 1, mode: '24ch', position: { x: -6, y: 8, z: -8 }, target: { x: -4, y: 1.1, z: 2 }, color: '#df79ff', beamAngle: 24, linkedObjectId: 'truss-a' },
      { id: 'fx-2', name: 'Moving Head C', type: 'Moving Head', universe: 1, address: 25, mode: '24ch', position: { x: 0, y: 8, z: -8 }, target: { x: 0, y: 1.1, z: 0 }, color: '#61dcff', beamAngle: 24, linkedObjectId: 'truss-a' },
      { id: 'fx-3', name: 'Moving Head R', type: 'Moving Head', universe: 1, address: 49, mode: '24ch', position: { x: 6, y: 8, z: -8 }, target: { x: 4, y: 1.1, z: 2 }, color: '#6f87ff', beamAngle: 24, linkedObjectId: 'truss-a' }
    ],
    audioInputs: [
      { id: 'in-1', channel: 1, source: 'Kick In', micDi: 'Beta 91A', stand: 'Short', patch: '', stageLocation: 'USC', notes: '', linkedObjectId: 'drum-riser' },
      { id: 'in-2', channel: 2, source: 'Kick Out', micDi: 'Beta 52', stand: 'Short', patch: '', stageLocation: 'USC', notes: '', linkedObjectId: 'drum-riser' },
      { id: 'in-3', channel: 3, source: 'Snare Top', micDi: 'SM57', stand: 'Short', patch: '', stageLocation: 'USC', notes: '', linkedObjectId: 'drum-riser' },
      { id: 'in-8', channel: 8, source: 'Bass DI', micDi: 'DI', stand: 'N/A', patch: '', stageLocation: 'USC', notes: '', linkedObjectId: '' },
      { id: 'in-12', channel: 12, source: 'Lead Voc', micDi: 'Wireless', stand: 'N/A', patch: '', stageLocation: 'DSC', notes: '', linkedObjectId: '' },
      { id: 'in-21', channel: 21, source: 'Playback L', micDi: 'Interface', stand: 'N/A', patch: '', stageLocation: 'Playback Rig', notes: '', linkedObjectId: '' },
      { id: 'in-22', channel: 22, source: 'Playback R', micDi: 'Interface', stand: 'N/A', patch: '', stageLocation: 'Playback Rig', notes: '', linkedObjectId: '' }
    ],
    rigging: [{ id: 'rig-1', name: 'Ground Truss', position: { x: 0, y: 8, z: -8 }, height: 8, type: 'truss', notes: '', qualifiedOnly: true }],
    video: [{ id: 'vid-camera-1', name: 'Camera 1', type: 'camera', position: { x: 0, y: 1.3, z: 17 }, width: 0.8, height: 2, inputSource: 'Camera 1', cameraAngle: 'FOH Wide', linkedObjectId: 'camera-1', notes: '' }],
    power: [{ id: 'pwr-1', name: 'House Power', position: { x: -14, y: 1.2, z: -10 }, notes: 'Confirm venue service and distro location.', linkedObjectId: '' }],
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
    venue: { name: 'Blank Stage', roomType: 'Club', fohPosition: 'Center', powerNotes: '', loadingNotes: '', safetyNotes: '' },
    notes: '',
    exportSettings: { pageSize: 'A3', orientation: 'landscape', scale: '1:50', titleBlock: true, showGrid: true, showLabels: true, includeInputList: true, includeLightingPlot: true, includeRiggingPlan: true }
  }
}

export function normalizeStagePlan(raw = {}) {
  const source = raw.plan && typeof raw.plan === 'object' ? { ...raw.plan, id: raw.id || raw.plan.id, name: raw.name || raw.title || raw.plan.name } : raw
  const legacyStageDimensions = raw.stage && typeof raw.stage === 'object'
    ? { width: raw.stage.width, depth: raw.stage.depth, deckHeight: raw.stage.deckHeight ?? raw.stage.height, unit: raw.stage.unit }
    : {}
  const base = createDefaultStagePlan({ id: source.id || '', name: source.name || source.title || 'Untitled Stage Plan', version: source.version || raw.version || 1 })
  return {
    ...base,
    ...source,
    title: raw.title || source.title || source.name || base.name,
    stageType: raw.stageType || source.stageType || 'Blank Stage',
    stageDimensions: { ...base.stageDimensions, ...legacyStageDimensions, ...(source.stageDimensions || raw.stageDimensions || {}) },
    coordinateSystem: { ...base.coordinateSystem, ...(source.coordinateSystem || raw.coordinateSystem || {}) },
    objects: Array.isArray(source.objects) ? source.objects : Array.isArray(raw.objects) ? raw.objects : base.objects,
    fixtures: Array.isArray(source.fixtures) ? source.fixtures : Array.isArray(raw.fixtures) ? raw.fixtures : base.fixtures,
    audioInputs: Array.isArray(source.audioInputs) ? source.audioInputs : Array.isArray(raw.audioInputs) ? raw.audioInputs : base.audioInputs,
    rigging: Array.isArray(source.rigging) ? source.rigging : Array.isArray(raw.rigging) ? raw.rigging : base.rigging,
    video: Array.isArray(source.video) ? source.video : Array.isArray(raw.video) ? raw.video : base.video,
    power: Array.isArray(source.power) ? source.power : Array.isArray(raw.power) ? raw.power : base.power,
    layers: Array.isArray(source.layers) ? source.layers : Array.isArray(raw.layers) ? raw.layers : base.layers,
    measurements: Array.isArray(source.measurements) ? source.measurements : Array.isArray(raw.measurements) ? raw.measurements : base.measurements,
    annotations: Array.isArray(source.annotations) ? source.annotations : Array.isArray(raw.annotations) ? raw.annotations : base.annotations,
    venue: { ...base.venue, ...(raw.venue || {}), ...(source.venue || {}) },
    notes: source.notes ?? raw.notes ?? base.notes,
    exportSettings: { ...base.exportSettings, ...(raw.exportSettings || {}), ...(source.exportSettings || {}) }
  }
}
