import { STORAGE_PATHS } from '../../config/storagePaths'
import { getStagePlanWarnings } from '../stagePlanModel'

export const sidebarItems = ['My Projects', 'Templates', 'Asset Library', 'Shared With Me', 'Exports', 'Learn']
export const stageTypes = ['Blank Stage', 'Small Club', 'Festival', 'Worship/Church', 'Livestream Room', 'School Auditorium']
export const templateCards = [
  { key: 'small-club', title: 'Small Club', subtitle: 'Quick-start layout', type: 'Small Club', icon: 'club' },
  { key: 'festival-stage', title: 'Festival Stage', subtitle: 'Quick-start layout', type: 'Festival', icon: 'festival' },
  { key: 'worship-stage', title: 'Worship Stage', subtitle: 'Quick-start layout', type: 'Worship/Church', icon: 'worship' },
  { key: 'livestream-room', title: 'Livestream Room', subtitle: 'Quick-start layout', type: 'Livestream Room', icon: 'livestream' }
]

export const stageIconPath = (group, name) => STORAGE_PATHS.stageProdIcon(group, name)

export const editorRailItems = [
  { key: 'home', label: 'Home', icon: stageIconPath('rail', 'home') },
  { key: 'object', label: 'Object', icon: stageIconPath('rail', 'object') },
  { key: 'scene', label: 'Scene', icon: stageIconPath('rail', 'scene') },
  { key: 'audio', label: 'Audio', icon: stageIconPath('rail', 'audio') },
  { key: 'lighting', label: 'Lighting', icon: stageIconPath('rail', 'lighting') },
  { key: 'rigging', label: 'Rigging', icon: stageIconPath('rail', 'rigging') },
  { key: 'video', label: 'Video', icon: stageIconPath('rail', 'video') },
  { key: 'venue', label: 'Venue', icon: stageIconPath('rail', 'venue') },
  { key: 'export', label: 'Export', icon: stageIconPath('rail', 'settings') },
  { key: 'settings', label: 'Settings', icon: stageIconPath('rail', 'settings') },
  { key: 'help', label: 'Help', icon: stageIconPath('rail', 'help') }
]

export const editorLibraryCategories = [
  { key: 'all', label: 'All Assets', icon: 'All', iconPath: stageIconPath('library', 'band-backline') },
  { key: 'primitive', label: 'Primitive Shapes', icon: '□', iconPath: stageIconPath('library', 'cases') },
  { key: 'backline', label: 'Band / Backline', icon: '✦', iconPath: stageIconPath('library', 'band-backline') },
  { key: 'audio', label: 'Audio', icon: '◌', iconPath: stageIconPath('library', 'audio') },
  { key: 'lighting', label: 'Lighting', icon: '◉', iconPath: stageIconPath('library', 'lighting') },
  { key: 'rigging', label: 'Rigging', icon: 'Trs', iconPath: stageIconPath('library', 'rigging') },
  { key: 'video', label: 'Video', icon: '▻', iconPath: stageIconPath('library', 'video') },
  { key: 'venue', label: 'Venue', icon: '▦', iconPath: stageIconPath('library', 'venue') },
  { key: 'power', label: 'Power', icon: 'Pwr', iconPath: stageIconPath('library', 'patching') },
  { key: 'cases', label: 'Cases / Patching', icon: '▣', iconPath: stageIconPath('library', 'cases') }
]

export const baseStageTypes = [
  { key: 'small-club', label: 'Small Club', icon: stageIconPath('base-stages', 'small-club') },
  { key: 'festival', label: 'Festival', icon: stageIconPath('base-stages', 'festival') },
  { key: 'church', label: 'Church', icon: stageIconPath('base-stages', 'church') },
  { key: 'school-auditorium', label: 'School Auditorium', icon: stageIconPath('base-stages', 'school-auditorium') },
  { key: 'custom', label: 'Custom', icon: stageIconPath('base-stages', 'custom') }
]

export const editorModes = [
  { key: 'entities', label: 'Objects' },
  { key: 'stage-plot', label: 'Stage Plot' },
  { key: 'input-list', label: 'Input List' },
  { key: 'lighting-patch', label: 'Lighting Patch' },
  { key: 'rigging', label: 'Rigging' },
  { key: 'warnings', label: 'Warnings' },
  { key: 'export', label: 'Export' }
]

export const editorViewModes = [['perspective3d', '3D'], ['top2d', 'Top'], ['front', 'Front'], ['side', 'Side'], ['isometric', 'Iso']]

export const editorToolModes = [
  { key: 'pan', label: 'Pan' },
  { key: 'select', label: 'Select' },
  { key: 'move', label: 'Move' },
  { key: 'rotate', label: 'Rotate' },
  { key: 'scale', label: 'Scale' }
]

export const editorMockObjects = [
  { key: 'stage-deck', label: 'Stage Deck', type: 'Base Stage', details: { width: '32 ft', depth: '24 ft', height: '4 ft' } },
  { key: 'drum-riser', label: 'Drum Riser', type: 'Backline', details: { width: '8 ft', depth: '8 ft', height: '2 ft' } },
  { key: 'truss-a', label: 'Truss A', type: 'Rigging', details: { system: 'Ground supported', span: '32 ft' } },
  { key: 'speaker-left', label: 'Speaker Left', type: 'Audio', details: { width: '1.8 ft', depth: '1.6 ft', height: '5 ft' } },
  { key: 'speaker-right', label: 'Speaker Right', type: 'Audio', details: { width: '1.8 ft', depth: '1.6 ft', height: '5 ft' } },
  { key: 'moving-head', label: 'Moving Head', type: 'Lighting', details: { fixture: 'Moving Head', address: '001/U1', mode: '24ch' } },
  { key: 'camera-1', label: 'Camera 1', type: 'Video', details: { angle: 'Wide', location: 'FOH' } }
]

export const stageLayers = ['stage', 'backline', 'audio', 'lighting', 'rigging', 'video', 'venue', 'power', 'notes', 'measurements']

export const primitiveStageAssets = [
  { id: 'primitive-rectangle', label: 'Rectangle', type: 'primitive-rectangle', category: 'primitive', layer: 'stage', icon: '▭', dimensions: { width: 4, depth: 3, height: 0.2 }, position: { x: 0, y: 1.1, z: 0 }, metadata: { color: '#4e6576' } },
  { id: 'primitive-square', label: 'Square', type: 'primitive-square', category: 'primitive', layer: 'stage', icon: '□', dimensions: { width: 3, depth: 3, height: 0.2 }, position: { x: 0, y: 1.1, z: 0 }, metadata: { color: '#4e6576' } },
  { id: 'primitive-circle', label: 'Circle', type: 'primitive-circle', category: 'primitive', layer: 'stage', icon: '○', dimensions: { width: 3, depth: 3, height: 0.2 }, position: { x: 0, y: 1.1, z: 0 }, metadata: { color: '#4e6576' } },
  { id: 'primitive-cube', label: 'Cube', type: 'primitive-cube', category: 'primitive', layer: 'stage', icon: '◼', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 2, z: 0 }, metadata: { color: '#38475c' } },
  { id: 'primitive-cylinder', label: 'Cylinder', type: 'primitive-cylinder', category: 'primitive', layer: 'stage', icon: '◉', dimensions: { width: 2, depth: 2, height: 2 }, position: { x: 0, y: 2, z: 0 }, metadata: { color: '#38475c' } },
  { id: 'primitive-label', label: 'Label', type: 'label', category: 'notes', layer: 'notes', icon: 'Aa', dimensions: { width: 3, depth: 0.3, height: 0.1 }, position: { x: 0, y: 1.5, z: 0 }, metadata: { text: 'Label' } }
]

export const productionStageAssets = [
  { id: 'asset-drum-riser', label: 'Drum Riser', type: 'drum-riser', category: 'backline', layer: 'backline', icon: 'Rise', dimensions: { width: 8, depth: 8, height: 1 }, position: { x: 0, y: 1.5, z: -5 }, metadata: { notes: 'Backline riser block' } },
  { id: 'asset-vocal-mic', label: 'Vocal Mic', type: 'microphone', category: 'audio', layer: 'audio', icon: 'Mic', dimensions: { width: 0.5, depth: 0.5, height: 4.5 }, position: { x: 0, y: 2.4, z: 7 }, metadata: { source: 'Lead Vocal', micDi: 'Wireless Handheld', stand: 'Straight', monitorSend: 'Mix 1', stageLocation: 'DSC' } },
  { id: 'asset-guitar-amp', label: 'Guitar Amp', type: 'guitar-amp', category: 'backline', layer: 'backline', icon: 'Amp', dimensions: { width: 2.4, depth: 1.2, height: 2.2 }, position: { x: -7, y: 2.0, z: -2 }, metadata: { source: 'Guitar Amp', micDi: 'SM57', stand: 'Short', stageLocation: 'USL' } },
  { id: 'asset-bass-di', label: 'Bass DI', type: 'bass-di', category: 'audio', layer: 'audio', icon: 'DI', dimensions: { width: 1, depth: 0.8, height: 0.4 }, position: { x: 6, y: 1.3, z: -2 }, metadata: { source: 'Bass DI', micDi: 'DI', stand: 'N/A', stageLocation: 'USR' } },
  { id: 'asset-playback-rack', label: 'Playback Rack', type: 'playback-rack', category: 'audio', layer: 'audio', icon: 'Rack', dimensions: { width: 2, depth: 2, height: 3 }, position: { x: 9, y: 2.2, z: -6 }, metadata: { source: 'Playback', micDi: 'Interface', stand: 'N/A', stageLocation: 'USR', stereoInputs: true } },
  { id: 'asset-speaker-stack', label: 'Speaker Stack', type: 'speaker', category: 'audio', layer: 'audio', icon: 'Spk', dimensions: { width: 1.8, depth: 1.6, height: 5 }, position: { x: -14, y: 2.5, z: -2 }, metadata: { stageLocation: 'DS edge', notes: 'PA / house audio placeholder' } },
  { id: 'asset-subwoofer', label: 'Subwoofer', type: 'subwoofer', category: 'audio', layer: 'audio', icon: 'Sub', dimensions: { width: 3, depth: 2.5, height: 1.4 }, position: { x: -5, y: 1.2, z: 11 }, metadata: { stageLocation: 'Downstage', notes: 'Subwoofer placement placeholder' } },
  { id: 'asset-wedge-monitor', label: 'Wedge Monitor', type: 'wedge-monitor', category: 'audio', layer: 'audio', icon: 'Mon', dimensions: { width: 2.2, depth: 1.4, height: 0.8 }, position: { x: 0, y: 1.35, z: 9 }, metadata: { monitorSend: 'Mix 1', stageLocation: 'DSC' } },
  { id: 'asset-moving-head', label: 'Moving Head', type: 'moving-head', category: 'lighting', layer: 'lighting', icon: 'MH', dimensions: { width: 0.9, depth: 0.9, height: 0.9 }, position: { x: 0, y: 8, z: -8 }, metadata: { fixtureType: 'Moving Head', universe: 1, address: 1, mode: '24ch', beamAngle: 24, color: '#61dcff', target: 'DSC', trussAssignment: 'Truss A' } },
  { id: 'asset-led-bar', label: 'LED Bar', type: 'led-bar', category: 'lighting', layer: 'lighting', icon: 'LED', dimensions: { width: 4, depth: 0.35, height: 0.35 }, position: { x: 0, y: 1.5, z: -10 }, metadata: { fixtureType: 'LED Bar', universe: 1, address: 101, mode: '16ch', beamAngle: 35, color: '#7cffdf', target: 'Backdrop' } },
  { id: 'asset-truss', label: 'Truss', type: 'truss', category: 'rigging', layer: 'rigging', icon: 'Trs', dimensions: { width: 20, depth: 0.35, height: 0.35 }, position: { x: 0, y: 8.4, z: -8 }, metadata: { trussType: 'Box Truss', qualifiedOnly: true, safetyNote: 'Load calculation required by qualified rigger.' } },
  { id: 'asset-led-wall', label: 'LED Wall', type: 'led-wall', category: 'video', layer: 'video', icon: 'LED', dimensions: { width: 12, depth: 0.4, height: 6 }, position: { x: 0, y: 4, z: -11.5 }, metadata: { screenType: 'LED Wall', aspectRatio: '16:9', resolution: '1920x1080', inputSource: 'Video Playback' } },
  { id: 'asset-screen', label: 'Projection Screen', type: 'screen', category: 'video', layer: 'video', icon: 'Scr', dimensions: { width: 10, depth: 0.35, height: 5.6 }, position: { x: 0, y: 3.8, z: -11.2 }, metadata: { screenType: 'Projection Screen', aspectRatio: '16:9', inputSource: 'Projector' } },
  { id: 'asset-camera', label: 'Camera', type: 'camera', category: 'video', layer: 'video', icon: 'Cam', dimensions: { width: 0.8, depth: 0.8, height: 2 }, position: { x: 0, y: 1.3, z: 17 }, metadata: { cameraAngle: 'FOH Wide', lens: '24-70mm', inputSource: 'Camera 1' } },
  { id: 'asset-foh', label: 'FOH Position', type: 'foh-position', category: 'venue', layer: 'venue', icon: 'FOH', dimensions: { width: 5, depth: 4, height: 0.2 }, position: { x: 0, y: 0.2, z: 28 }, metadata: { venueMarker: true, notes: 'Console / production position' } },
  { id: 'asset-road-case', label: 'Road Case', type: 'road-case', category: 'cases', layer: 'venue', icon: 'Case', dimensions: { width: 2.4, depth: 2, height: 2.6 }, position: { x: 12, y: 1.8, z: 8 }, metadata: { notes: 'Storage / backline case' } },
  { id: 'asset-power-distro', label: 'Power Distro', type: 'power-distro', category: 'power', layer: 'power', icon: 'Pwr', dimensions: { width: 2, depth: 1.4, height: 2.2 }, position: { x: -14, y: 1.7, z: -10 }, metadata: { powerLocation: 'USL', notes: 'Confirm service and tie-in with venue.' } }
]

export const objectLibraryGroups = [
  { key: 'primitives', label: 'Primitive Shapes', assets: primitiveStageAssets },
  { key: 'production', label: 'Production Objects', assets: productionStageAssets }
]

const savedBottomSplit = Number(localStorage.getItem('stagePaneBottomSplit'))

export const state = {
  user: null,
  loadingProjects: false,
  projectsError: '',
  projects: [],
  recentProjects: [],
  projectId: '',
  editorLoading: false,
  editorError: '',
  projectLoadStatus: 'loading',
  projectLoadMessage: '',
  projectLoadMeta: null,
  projectLoadErrorCode: '',
  editorSaveStatus: 'idle',
  editorSaveError: '',
  lastSavedAt: '',
  editorProject: null,
  createError: '',
  selectedStageType: 'Blank Stage',
  activeEditorMode: 'entities',
  activeStageSection: 'home',
  activeLibraryCategory: 'all',
  editorToolMode: localStorage.getItem('stageEditorToolMode') || 'pan',
  selectedEditorObject: 'stage-deck',
  selectedEditorObjects: ['stage-deck'],
  editorObjectTransforms: {},
  snapEnabled: true,
  snapInterval: 1,
  measureModeEnabled: false,
  gridEnabled: true,
  beamPreviewEnabled: true,
  showStageLabels: true,
  showExportPreview: false,
  showStageGlobalHeader: false,
  stageAppMenuOpen: false,
  showViewportDiagnostics: false,
  viewportMode: localStorage.getItem('stageViewportMode') || 'perspective3d',
  activeInspectorTab: 'properties',
  activeDataTab: 'schema',
  renderMode: 'technical',
  activeStageTabId: 'stage-1',
  stageTabs: [{ id: 'stage-1', title: 'Untitled Stage' }],
  undoStack: [],
  redoStack: [],
  paneSizes: {
    library: Number(localStorage.getItem('stagePaneLibrary')) || 236,
    right: Number(localStorage.getItem('stagePaneRight')) || 286,
    bottom: Number(localStorage.getItem('stagePaneBottom')) || 190,
    bottomSplit: Number.isFinite(savedBottomSplit) && savedBottomSplit >= 70 ? savedBottomSplit : 70
  }
}

export const getCurrentStageProjectId = () => {
  const pathname = window.location.pathname || ''
  if (pathname.startsWith('/stage/')) return decodeURIComponent(pathname.replace('/stage/', '').split('/')[0] || '').trim()
  return new URLSearchParams(window.location.search || '').get('projectId')?.trim() || ''
}

export function projectDate(project) {
  return project?.lastOpenedAt?.toDate?.() || project?.updatedAt?.toDate?.() || project?.createdAt?.toDate?.() || null
}

export function formatUpdatedLabel(project) {
  const date = projectDate(project)
  if (!date) return 'Updated recently'
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((start - then) / 86400000)
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated yesterday'
  if (days <= 6) return `Updated ${days} days ago`
  return `Updated ${date.toLocaleDateString()}`
}

export function getStageTypeClass(stageType = '') {
  const t = String(stageType || '').toLowerCase()
  if (t.includes('festival')) return 'festival'
  if (t.includes('worship') || t.includes('church')) return 'worship'
  if (t.includes('live')) return 'livestream'
  if (t.includes('club')) return 'club'
  return 'blank'
}

export function selectedEditorObject() {
  const object = Array.isArray(state.editorProject?.objects) ? state.editorProject.objects.find((o) => o.id === state.selectedEditorObject || o.key === state.selectedEditorObject) : null
  if (object) return {
    key: object.id || object.key,
    label: object.label || object.name || object.id || 'Stage Object',
    type: object.type || object.category || 'Object',
    category: object.category || 'stage',
    layer: object.layer || object.category || 'stage',
    locked: !!object.locked,
    visible: object.visible !== false,
    details: {
      width: object.dimensions?.width,
      depth: object.dimensions?.depth,
      height: object.dimensions?.height
    }
  }
  return {
    key: state.selectedEditorObject || '',
    label: 'No object selected',
    type: 'None',
    category: 'stage',
    layer: 'stage',
    locked: false,
    visible: true,
    details: {}
  }
}

export function currentStageDimensions() {
  return state.editorProject?.stageDimensions || { width: 32, depth: 24, deckHeight: 4, unit: 'ft' }
}

export function ensureStageTabs() {
  if (!Array.isArray(state.stageTabs) || state.stageTabs.length === 0) {
    state.stageTabs = [{ id: 'stage-1', title: 'Untitled Stage' }]
  }
  if (!state.stageTabs.some((tab) => tab.id === state.activeStageTabId)) {
    state.activeStageTabId = state.stageTabs[0].id
  }
  return state.stageTabs
}

export function activeStageTab() {
  return ensureStageTabs().find((tab) => tab.id === state.activeStageTabId) || state.stageTabs[0]
}

export function findStageAsset(assetId) {
  return [...primitiveStageAssets, ...productionStageAssets].find((asset) => asset.id === assetId)
}

function nextId(prefix, collection = []) {
  const safePrefix = String(prefix || 'object').replace(/[^a-z0-9-]/gi, '-').toLowerCase()
  const count = collection.filter((item) => String(item.id || '').startsWith(safePrefix)).length + 1
  return `${safePrefix}-${String(count).padStart(2, '0')}`
}

function nextAudioChannel() {
  const used = new Set((state.editorProject?.audioInputs || []).map((input) => Number(input.channel)).filter(Number.isFinite))
  let channel = 1
  while (used.has(channel)) channel += 1
  return channel
}

function nextDmxAddress() {
  const used = (state.editorProject?.fixtures || []).map((fixture) => Number(fixture.address)).filter(Number.isFinite)
  const max = used.length ? Math.max(...used) : -23
  return Math.min(512, Math.max(1, max + 24))
}

export function createStageObjectFromAsset(asset, overrides = {}) {
  const objects = state.editorProject?.objects || []
  const id = overrides.id || nextId(asset.type || asset.id, objects)
  const position = { ...(asset.position || {}), ...(overrides.position || {}) }
  const dimensions = { ...(asset.dimensions || {}), ...(overrides.dimensions || {}) }
  return {
    id,
    kind: overrides.kind || asset.kind || asset.type,
    type: asset.type,
    category: asset.category,
    layer: asset.layer || asset.category || 'stage',
    name: overrides.name || asset.label,
    label: overrides.label || asset.label,
    position,
    rotation: { x: 0, y: 0, z: 0, ...(overrides.rotation || {}) },
    scale: { x: 1, y: 1, z: 1, ...(overrides.scale || {}) },
    dimensions,
    visible: true,
    locked: false,
    selectable: true,
    protected: false,
    color: asset.metadata?.color || overrides.color || '',
    notes: asset.metadata?.notes || '',
    metadata: { ...(asset.metadata || {}), ...(overrides.metadata || {}) }
  }
}

export function addStageAssetToPlan(assetId, overrides = {}) {
  const asset = findStageAsset(assetId)
  if (!asset || !state.editorProject) return null
  const object = createStageObjectFromAsset(asset, overrides)
  state.editorProject.objects = [...(state.editorProject.objects || []), object]
  if (asset.category === 'audio' && (asset.metadata?.source || asset.type === 'microphone' || asset.type?.includes('di'))) {
    const channel = nextAudioChannel()
    const input = {
      id: `in-${object.id}`,
      channel,
      source: asset.metadata?.source || object.label,
      micDi: asset.metadata?.micDi || '',
      stand: asset.metadata?.stand || 'N/A',
      patch: '',
      monitorSend: asset.metadata?.monitorSend || '',
      stageLocation: asset.metadata?.stageLocation || '',
      linkedObjectId: object.id,
      notes: object.notes || ''
    }
    state.editorProject.audioInputs = [...(state.editorProject.audioInputs || []), input]
  }
  if (asset.category === 'lighting') {
    const address = Number(asset.metadata?.address) || nextDmxAddress()
    const fixture = {
      id: `fx-${object.id}`,
      name: object.label,
      type: asset.metadata?.fixtureType || object.type,
      universe: Number(asset.metadata?.universe) || 1,
      address,
      mode: asset.metadata?.mode || '',
      position: object.position,
      target: asset.metadata?.target || '',
      color: asset.metadata?.color || '#61dcff',
      beamAngle: Number(asset.metadata?.beamAngle) || 24,
      linkedObjectId: object.id,
      trussAssignment: asset.metadata?.trussAssignment || ''
    }
    state.editorProject.fixtures = [...(state.editorProject.fixtures || []), fixture]
  }
  if (asset.category === 'rigging') {
    const rig = {
      id: `rig-${object.id}`,
      name: object.label,
      type: asset.metadata?.trussType || object.type,
      position: object.position,
      span: object.dimensions.width,
      height: object.position.y,
      qualifiedOnly: asset.metadata?.qualifiedOnly !== false,
      notes: asset.metadata?.safetyNote || object.notes || 'Load calculation required by qualified rigger.',
      linkedObjectId: object.id
    }
    state.editorProject.rigging = [...(state.editorProject.rigging || []), rig]
  }
  if (asset.category === 'video') {
    const video = {
      id: `vid-${object.id}`,
      name: object.label,
      type: object.type,
      position: object.position,
      width: object.dimensions.width,
      height: object.dimensions.height,
      aspectRatio: asset.metadata?.aspectRatio || '',
      resolution: asset.metadata?.resolution || '',
      inputSource: asset.metadata?.inputSource || '',
      linkedObjectId: object.id,
      notes: object.notes || ''
    }
    state.editorProject.video = [...(state.editorProject.video || []), video]
  }
  if (asset.category === 'power') {
    const power = {
      id: `pwr-${object.id}`,
      name: object.label,
      position: object.position,
      notes: asset.metadata?.notes || '',
      linkedObjectId: object.id
    }
    state.editorProject.power = [...(state.editorProject.power || []), power]
  }
  state.selectedEditorObject = object.id
  state.selectedEditorObjects = [object.id]
  state.activeInspectorTab = 'properties'
  state.activeEditorMode = 'entities'
  return object
}

export function findStageObject(objectId = state.selectedEditorObject) {
  return (state.editorProject?.objects || []).find((object) => object.id === objectId || object.key === objectId)
}

export function normalizeSelectedStageObjectIds(ids = state.selectedEditorObjects) {
  const available = new Set((state.editorProject?.objects || []).map((object) => object.id || object.key).filter(Boolean))
  const list = Array.isArray(ids) ? ids : [ids]
  return [...new Set(list.filter((id) => id && available.has(id)))]
}

export function setSelectedStageObjects(ids = [], primaryId = '') {
  const normalized = normalizeSelectedStageObjectIds(ids)
  const primary = primaryId && normalized.includes(primaryId) ? primaryId : normalized[0] || ''
  state.selectedEditorObjects = normalized
  state.selectedEditorObject = primary
  return normalized
}

export function selectedStageObjects() {
  return normalizeSelectedStageObjectIds(state.selectedEditorObjects?.length ? state.selectedEditorObjects : [state.selectedEditorObject])
    .map((id) => findStageObject(id))
    .filter(Boolean)
}

export function isStageObjectSelected(objectId = '') {
  return normalizeSelectedStageObjectIds(state.selectedEditorObjects?.length ? state.selectedEditorObjects : [state.selectedEditorObject]).includes(objectId)
}

export function linkedAudioInput(objectId = state.selectedEditorObject) {
  return (state.editorProject?.audioInputs || []).find((input) => input.linkedObjectId === objectId)
}

export function linkedFixture(objectId = state.selectedEditorObject) {
  return (state.editorProject?.fixtures || []).find((fixture) => fixture.linkedObjectId === objectId)
}

export function linkedRigging(objectId = state.selectedEditorObject) {
  return (state.editorProject?.rigging || []).find((rig) => rig.linkedObjectId === objectId)
}

export function linkedVideo(objectId = state.selectedEditorObject) {
  return (state.editorProject?.video || []).find((video) => video.linkedObjectId === objectId)
}

export function selectedStageEntity() {
  const object = findStageObject()
  if (object) return { kind: 'object', entity: object }
  const input = (state.editorProject?.audioInputs || []).find((row) => row.id === state.selectedEditorObject)
  if (input) return { kind: 'audioInput', entity: input }
  const fixture = (state.editorProject?.fixtures || []).find((row) => row.id === state.selectedEditorObject)
  if (fixture) return { kind: 'fixture', entity: fixture }
  const rig = (state.editorProject?.rigging || []).find((row) => row.id === state.selectedEditorObject)
  if (rig) return { kind: 'rigging', entity: rig }
  const video = (state.editorProject?.video || []).find((row) => row.id === state.selectedEditorObject)
  if (video) return { kind: 'video', entity: video }
  return { kind: 'none', entity: null }
}

const cloneData = (value) => JSON.parse(JSON.stringify(value ?? null))

function syncLinkedDataForObject(object) {
  if (!object || !state.editorProject) return
  const syncPosition = (item) => ({ ...item, position: { ...(object.position || {}) } })
  state.editorProject.fixtures = (state.editorProject.fixtures || []).map((fixture) => fixture.linkedObjectId === object.id ? { ...syncPosition(fixture), name: object.label || fixture.name, label: object.label || fixture.label } : fixture)
  state.editorProject.rigging = (state.editorProject.rigging || []).map((rig) => rig.linkedObjectId === object.id ? { ...syncPosition(rig), name: object.label || rig.name, label: object.label || rig.label, height: object.position?.y ?? rig.height, span: object.dimensions?.width ?? rig.span } : rig)
  state.editorProject.video = (state.editorProject.video || []).map((video) => video.linkedObjectId === object.id ? { ...syncPosition(video), name: object.label || video.name, label: object.label || video.label, width: object.dimensions?.width ?? video.width, height: object.dimensions?.height ?? video.height } : video)
  state.editorProject.power = (state.editorProject.power || []).map((power) => power.linkedObjectId === object.id ? { ...syncPosition(power), name: object.label || power.name } : power)
}

function recordObjectCommand(objectId, before, after, extra = {}) {
  if (JSON.stringify(before) === JSON.stringify(after)) return false
  state.undoStack = [...(state.undoStack || []), { objectId, before: cloneData(before), after: cloneData(after), ...extra }].slice(-80)
  state.redoStack = []
  return true
}

function replaceObjectSnapshot(snapshot) {
  if (!state.editorProject) return
  const id = snapshot?.id
  if (!id) return
  const objects = state.editorProject.objects || []
  const index = objects.findIndex((object) => object.id === id)
  if (index >= 0) state.editorProject.objects = objects.map((object) => object.id === id ? cloneData(snapshot) : object)
  else state.editorProject.objects = [...objects, cloneData(snapshot)]
  syncLinkedDataForObject(snapshot)
}

function removeObjectSnapshot(objectId, { removeLinked = false } = {}) {
  if (!state.editorProject || !objectId) return
  state.editorProject.objects = (state.editorProject.objects || []).filter((object) => object.id !== objectId)
  if (removeLinked) {
    state.editorProject.audioInputs = (state.editorProject.audioInputs || []).filter((row) => row.linkedObjectId !== objectId)
    state.editorProject.fixtures = (state.editorProject.fixtures || []).filter((row) => row.linkedObjectId !== objectId)
    state.editorProject.rigging = (state.editorProject.rigging || []).filter((row) => row.linkedObjectId !== objectId)
    state.editorProject.video = (state.editorProject.video || []).filter((row) => row.linkedObjectId !== objectId)
    state.editorProject.power = (state.editorProject.power || []).filter((row) => row.linkedObjectId !== objectId)
  }
}

function snapshotLinkedRows(objectId) {
  const project = state.editorProject || {}
  return {
    audioInputs: (project.audioInputs || []).filter((row) => row.linkedObjectId === objectId).map(cloneData),
    fixtures: (project.fixtures || []).filter((row) => row.linkedObjectId === objectId).map(cloneData),
    rigging: (project.rigging || []).filter((row) => row.linkedObjectId === objectId).map(cloneData),
    video: (project.video || []).filter((row) => row.linkedObjectId === objectId).map(cloneData),
    power: (project.power || []).filter((row) => row.linkedObjectId === objectId).map(cloneData)
  }
}

function restoreLinkedRows(snapshot = {}) {
  if (!state.editorProject) return
  ;['audioInputs', 'fixtures', 'rigging', 'video', 'power'].forEach((collection) => {
    const rows = snapshot[collection] || []
    if (!rows.length) return
    const ids = new Set(rows.map((row) => row.id))
    state.editorProject[collection] = [...(state.editorProject[collection] || []).filter((row) => !ids.has(row.id)), ...rows.map(cloneData)]
  })
}

function applyCommandSnapshot(command, snapshotKey) {
  const snapshot = command?.[snapshotKey]
  if (snapshot) {
    replaceObjectSnapshot(snapshot)
    if (snapshotKey === 'before' && command.beforeLinks) restoreLinkedRows(command.beforeLinks)
    setSelectedStageObjects([snapshot.id], snapshot.id)
    return
  }
  removeObjectSnapshot(command.objectId, { removeLinked: command.removeLinked })
  setSelectedStageObjects(['stage-deck'], 'stage-deck')
}

export function undoStageEdit() {
  const command = state.undoStack?.pop()
  if (!command) return false
  applyCommandSnapshot(command, 'before')
  state.redoStack = [...(state.redoStack || []), command]
  return true
}

export function redoStageEdit() {
  const command = state.redoStack?.pop()
  if (!command) return false
  applyCommandSnapshot(command, 'after')
  state.undoStack = [...(state.undoStack || []), command]
  return true
}

export function updateSelectedStageObjectField(field, value, options = {}) {
  const object = findStageObject()
  if (!object) return false
  const before = cloneData(object)
  if (['x', 'y', 'z'].includes(field)) object.position = { ...(object.position || {}), [field]: Number(value) || 0 }
  else if (['width', 'depth', 'height'].includes(field)) object.dimensions = { ...(object.dimensions || {}), [field]: Math.max(0.05, Number(value) || 0.05) }
  else if (field === 'rotY') object.rotation = { ...(object.rotation || {}), y: Number(value) || 0 }
  else if (field === 'label') { object.label = String(value || ''); object.name = String(value || object.name || '') }
  else if (field === 'locked') object.locked = !!value
  else if (field === 'visible') object.visible = !!value
  else if (field === 'notes') object.notes = String(value || '')
  else if (field === 'layer') object.layer = String(value || object.layer || object.category || 'stage')
  else if (field === 'color') object.color = String(value || '')
  else object.metadata = { ...(object.metadata || {}), [field]: value }
  syncLinkedDataForObject(object)
  if (options.track !== false) recordObjectCommand(object.id, before, object)
  return true
}

export function updateSelectedStageObjectsField(field, value, options = {}) {
  const objects = selectedStageObjects()
  if (!objects.length) return false
  let changed = false
  objects.forEach((object) => {
    const previous = state.selectedEditorObject
    state.selectedEditorObject = object.id
    if (updateSelectedStageObjectField(field, value, options)) changed = true
    state.selectedEditorObject = previous
  })
  return changed
}

function snapValue(value, interval = state.snapInterval) {
  const snap = Number(interval)
  if (!state.snapEnabled || !Number.isFinite(snap) || snap <= 0) return value
  return Math.round(value / snap) * snap
}

export function moveSelectedStageObject(delta = {}, options = {}) {
  const object = findStageObject()
  if (!object || object.locked) return false
  const before = cloneData(object)
  const pos = object.position || { x: 0, y: 0, z: 0 }
  object.position = {
    x: options.absolute ? snapValue(Number(delta.x ?? pos.x)) : snapValue(Number(pos.x || 0) + Number(delta.x || 0)),
    y: options.absolute ? Number(delta.y ?? pos.y ?? 0) : Number(pos.y || 0) + Number(delta.y || 0),
    z: options.absolute ? snapValue(Number(delta.z ?? pos.z)) : snapValue(Number(pos.z || 0) + Number(delta.z || 0))
  }
  syncLinkedDataForObject(object)
  recordObjectCommand(object.id, before, object)
  return true
}

export function rotateSelectedStageObject(deltaDegrees = 0) {
  const object = findStageObject()
  if (!object || object.locked) return false
  const before = cloneData(object)
  const current = Number(object.rotation?.y || 0)
  object.rotation = { ...(object.rotation || {}), y: current + Number(deltaDegrees || 0) }
  syncLinkedDataForObject(object)
  recordObjectCommand(object.id, before, object)
  return true
}

export function resetSelectedStageObjectRotation() {
  const object = findStageObject()
  if (!object || object.locked) return false
  const before = cloneData(object)
  object.rotation = { ...(object.rotation || {}), y: 0 }
  syncLinkedDataForObject(object)
  recordObjectCommand(object.id, before, object)
  return true
}

export function duplicateSelectedStageObject() {
  const object = findStageObject()
  if (!object) return null
  const copy = cloneData(object)
  const prefix = `${object.type || object.kind || 'object'}-copy`
  copy.id = nextId(prefix, state.editorProject?.objects || [])
  copy.name = `${object.name || object.label || 'Object'} Copy`
  copy.label = `${object.label || object.name || 'Object'} Copy`
  copy.locked = false
  copy.protected = false
  copy.position = { ...(copy.position || {}), x: Number(copy.position?.x || 0) + 1, z: Number(copy.position?.z || 0) + 1 }
  state.editorProject.objects = [...(state.editorProject.objects || []), copy]
  setSelectedStageObjects([copy.id], copy.id)
  recordObjectCommand(copy.id, null, copy)
  return copy
}

export function deleteSelectedStageObject() {
  const targets = selectedStageObjects().filter((object) => !object.protected)
  if (!targets.length) return false
  targets.forEach((object) => {
    const before = cloneData(object)
    const beforeLinks = snapshotLinkedRows(object.id)
    const removeLinked = true
    removeObjectSnapshot(object.id, { removeLinked })
    recordObjectCommand(object.id, before, null, { removeLinked, beforeLinks })
  })
  setSelectedStageObjects(['stage-deck'], 'stage-deck')
  return true
}

export function stageWarnings() {
  const project = state.editorProject || {}
  return getStagePlanWarnings(project)
}

export function exportReadiness() {
  const project = state.editorProject || {}
  const warnings = stageWarnings()
  return [
    { label: 'Stage dimensions set', ok: Boolean(project.stageDimensions?.width && project.stageDimensions?.depth) },
    { label: 'Project title set', ok: Boolean(project.title || project.name) },
    { label: 'Input list generated', ok: (project.audioInputs || []).length > 0 },
    { label: 'Lighting patch available', ok: (project.fixtures || []).length > 0 },
    { label: 'Rigging notes present', ok: (project.rigging || []).some((rig) => rig.notes) },
    { label: 'Venue name complete', ok: Boolean(project.venue?.name && project.venue.name !== 'Blank Stage') },
    { label: 'No blocking duplicate patches', ok: !warnings.some((warning) => warning.level === 'error') }
  ]
}

function objectEntity(object) {
  const dimensions = object.dimensions || object.details || {}
  const position = object.position || {}
  return {
    id: object.id || object.key || object.name,
    name: object.name || object.label || object.id || object.key || 'Untitled Object',
    kind: object.type || 'Object',
    category: object.category || 'stage',
    location: [position.x, position.y, position.z].some((value) => Number.isFinite(value))
      ? `X ${Number(position.x || 0).toFixed(1)} / Y ${Number(position.y || 0).toFixed(1)} / Z ${Number(position.z || 0).toFixed(1)}`
      : 'not placed',
    size: dimensions.width || dimensions.depth || dimensions.height
      ? `${dimensions.width || 'n/a'} x ${dimensions.depth || 'n/a'} x ${dimensions.height || 'n/a'}`
      : 'n/a',
    status: object.visible === false ? 'hidden' : object.locked ? 'locked' : 'active'
  }
}

export function stageObjectsForTable() {
  const project = state.editorProject || {}
  const warnings = stageWarnings()
  const warningCounts = warnings.reduce((counts, warning) => {
    if (warning.ownerId) counts[warning.ownerId] = (counts[warning.ownerId] || 0) + 1
    return counts
  }, {})
  return (project.objects || []).map((object) => {
    const dimensions = object.dimensions || {}
    const position = object.position || {}
    const linked = [
      linkedAudioInput(object.id) ? 'input' : '',
      linkedFixture(object.id) ? 'fixture' : '',
      linkedRigging(object.id) ? 'rigging' : '',
      linkedVideo(object.id) ? 'video' : '',
      (project.power || []).some((row) => row.linkedObjectId === object.id) ? 'power' : ''
    ].filter(Boolean)
    return {
      id: object.id || object.key || object.name,
      name: object.label || object.name || object.id || 'Untitled Object',
      kind: object.kind || object.type || 'object',
      type: object.type || object.kind || 'object',
      category: object.category || 'stage',
      layer: object.layer || object.category || 'stage',
      position: {
        x: Number(position.x || 0),
        y: Number(position.y || 0),
        z: Number(position.z || 0)
      },
      dimensions: {
        width: Number(dimensions.width || 0),
        depth: Number(dimensions.depth || 0),
        height: Number(dimensions.height || 0)
      },
      locked: !!object.locked,
      protected: !!object.protected,
      visible: object.visible !== false,
      linkedData: linked,
      warnings: warningCounts[object.id] || 0,
      status: object.visible === false ? 'hidden' : object.locked ? 'locked' : linked.length ? 'linked' : 'active'
    }
  })
}

export function stageEntities() {
  const project = state.editorProject || {}
  const entities = []
  if (Array.isArray(project.objects)) entities.push(...project.objects.map(objectEntity))
  if (Array.isArray(project.fixtures)) {
    entities.push(...project.fixtures.map((fixture) => ({
      id: fixture.id || fixture.name,
      name: fixture.name || fixture.label || fixture.type || 'Fixture',
      kind: fixture.type || 'Fixture',
      category: 'lighting',
      location: fixture.position ? `X ${Number(fixture.position.x || 0).toFixed(1)} / Y ${Number(fixture.position.y || 0).toFixed(1)} / Z ${Number(fixture.position.z || 0).toFixed(1)}` : fixture.positionName || 'lighting position',
      size: fixture.beamAngle ? `${fixture.beamAngle} deg beam` : fixture.mode || 'n/a',
      status: fixture.visible === false ? 'hidden' : 'patched'
    })))
  }
  if (Array.isArray(project.audioInputs)) {
    entities.push(...project.audioInputs.map((input) => ({
      id: input.id || `input-${input.channel}`,
      name: input.source || `Channel ${input.channel || '?'}`,
      kind: 'Audio Input',
      category: 'audio',
      location: input.stageLocation || input.notes || 'stage',
      size: input.micDi || 'n/a',
      status: input.patch || input.channel ? `ch ${input.channel || '?'}` : 'unpatched'
    })))
  }
  if (Array.isArray(project.rigging)) {
    entities.push(...project.rigging.map((rig) => ({
      id: rig.id || rig.name,
      name: rig.name || rig.type || 'Rigging',
      kind: rig.type || 'Rigging',
      category: 'rigging',
      location: rig.position ? `X ${Number(rig.position.x || 0).toFixed(1)} / Y ${Number(rig.position.y || 0).toFixed(1)} / Z ${Number(rig.position.z || 0).toFixed(1)}` : 'not placed',
      size: rig.height ? `${rig.height} ft height` : rig.span ? `${rig.span} ft span` : 'n/a',
      status: rig.qualifiedOnly ? 'qualified only' : 'planned'
    })))
  }
  if (Array.isArray(project.video)) {
    entities.push(...project.video.map((video) => ({
      id: video.id || video.name,
      name: video.name || video.type || 'Video',
      kind: video.type || 'Video',
      category: 'video',
      location: video.position ? `X ${Number(video.position.x || 0).toFixed(1)} / Y ${Number(video.position.y || 0).toFixed(1)} / Z ${Number(video.position.z || 0).toFixed(1)}` : 'not placed',
      size: video.width || video.height ? `${video.width || 'n/a'} x ${video.height || 'n/a'}` : video.resolution || 'n/a',
      status: video.inputSource ? 'routed' : 'planned'
    })))
  }
  if (Array.isArray(project.power)) {
    entities.push(...project.power.map((power) => ({
      id: power.id || power.name,
      name: power.name || 'Power',
      kind: 'Power',
      category: 'power',
      location: power.position ? `X ${Number(power.position.x || 0).toFixed(1)} / Y ${Number(power.position.y || 0).toFixed(1)} / Z ${Number(power.position.z || 0).toFixed(1)}` : 'not placed',
      size: 'service TBD',
      status: power.notes ? 'noted' : 'needs notes'
    })))
  }
  return entities
}

export function projectLoadLabel() {
  if (state.projectLoadStatus === 'loaded') return 'loaded'
  if (state.projectLoadStatus === 'fallback-local') return 'local recovery'
  if (state.projectLoadStatus === 'fallback-default') return 'default fallback'
  if (state.projectLoadStatus === 'permission-denied') return 'permission denied'
  if (state.projectLoadStatus === 'unauthenticated') return 'sign in required'
  if (state.projectLoadStatus === 'not-found') return 'not found'
  if (state.projectLoadStatus === 'network-error') return 'network error'
  if (state.projectLoadStatus === 'rules-error') return 'rules error'
  return state.projectLoadStatus || 'loading'
}

export function viewportModeLabel() {
  return editorViewModes.find(([key]) => key === state.viewportMode)?.[1] || '3D'
}

export function editorTitleStamp() {
  return {
    title: state.editorProject?.title || 'Untitled Stage Plan',
    stamp: (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  }
}
