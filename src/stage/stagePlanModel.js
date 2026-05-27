export const DEFAULT_COORDINATE_SYSTEM = {
  // X: stage left/right, Y: height, Z: upstage/downstage
  axes: { x: 'leftRight', y: 'height', z: 'depth' },
  origin: 'stage-center'
}

export function createDefaultStagePlan({ id = '', name = 'Blank Stage', version = 1 } = {}) {
  return {
    id,
    name,
    version,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    units: 'ft',
    stageDimensions: { width: 32, depth: 24, deckHeight: 4, unit: 'ft' },
    coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
    objects: [
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
      }
    ],
    fixtures: [],
    audioInputs: [
      { id: 'in-1', channel: 1, source: 'Kick In', micDi: 'Beta 91A', stand: 'Short', patch: '', notes: 'USC', linkedObjectId: '' }
    ],
    rigging: [{ id: 'rig-1', name: 'Ground Truss', position: { x: 0, y: 8, z: -8 }, height: 8, type: 'truss', notes: '', qualifiedOnly: true }],
    venue: { name: 'Blank Stage', roomType: 'Club', fohPosition: 'Center', powerNotes: '', loadingNotes: '', safetyNotes: '' },
    notes: '',
    exportSettings: { pageSize: 'A3', orientation: 'landscape', scale: '1:50', titleBlock: true, showGrid: true, showLabels: true, includeInputList: true, includeLightingPlot: true, includeRiggingPlan: true }
  }
}

export function normalizeStagePlan(raw = {}) {
  const base = createDefaultStagePlan({ id: raw.id || '', name: raw.name || raw.title || 'Untitled Stage Plan', version: raw.version || 1 })
  return {
    ...base,
    ...raw,
    stageDimensions: { ...base.stageDimensions, ...(raw.stageDimensions || {}) },
    coordinateSystem: { ...base.coordinateSystem, ...(raw.coordinateSystem || {}) },
    objects: Array.isArray(raw.objects) ? raw.objects : base.objects,
    fixtures: Array.isArray(raw.fixtures) ? raw.fixtures : base.fixtures,
    audioInputs: Array.isArray(raw.audioInputs) ? raw.audioInputs : base.audioInputs,
    rigging: Array.isArray(raw.rigging) ? raw.rigging : base.rigging,
    venue: { ...base.venue, ...(raw.venue || {}) },
    exportSettings: { ...base.exportSettings, ...(raw.exportSettings || {}) }
  }
}

