import { STORAGE_PATHS } from '../../config/storagePaths'

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
  { key: 'band-backline', label: 'Band / Backline', icon: '✦', iconPath: stageIconPath('library', 'band-backline'), select: 'drum-riser' },
  { key: 'lighting', label: 'Lighting', icon: '◉', iconPath: stageIconPath('library', 'lighting'), select: 'moving-head' },
  { key: 'rigging', label: 'Rigging', icon: '⛓', iconPath: stageIconPath('library', 'rigging'), select: 'truss-a' },
  { key: 'audio', label: 'Audio', icon: '◌', iconPath: stageIconPath('library', 'audio'), select: 'speaker-left' },
  { key: 'video', label: 'Video', icon: '▻', iconPath: stageIconPath('library', 'video'), select: 'camera-1' },
  { key: 'venue', label: 'Venue', icon: '▦', iconPath: stageIconPath('library', 'venue'), select: 'stage-deck' },
  { key: 'patching', label: 'Patching', icon: '⌁', iconPath: stageIconPath('library', 'patching'), select: 'stage-deck' },
  { key: 'cases', label: 'Cases', icon: '▣', iconPath: stageIconPath('library', 'cases'), select: 'stage-deck' }
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
  { id: 'asset-vocal-mic', label: 'Vocal Mic', type: 'microphone', category: 'audio', layer: 'audio', icon: 'Mic', dimensions: { width: 0.5, depth: 0.5, height: 4.5 }, position: { x: 0, y: 2.4, z: 7 }, metadata: { source: 'Lead Vocal', micDi: 'Wireless Handheld', stand: 'Straight', monitorSend: 'Mix 1', stageLocation: 'DSC' } },
  { id: 'asset-guitar-amp', label: 'Guitar Amp', type: 'guitar-amp', category: 'backline', layer: 'backline', icon: 'Amp', dimensions: { width: 2.4, depth: 1.2, height: 2.2 }, position: { x: -7, y: 2.0, z: -2 }, metadata: { source: 'Guitar Amp', micDi: 'SM57', stand: 'Short', stageLocation: 'USL' } },
  { id: 'asset-bass-di', label: 'Bass DI', type: 'bass-di', category: 'audio', layer: 'audio', icon: 'DI', dimensions: { width: 1, depth: 0.8, height: 0.4 }, position: { x: 6, y: 1.3, z: -2 }, metadata: { source: 'Bass DI', micDi: 'DI', stand: 'N/A', stageLocation: 'USR' } },
  { id: 'asset-playback-rack', label: 'Playback Rack', type: 'playback-rack', category: 'audio', layer: 'audio', icon: 'Rack', dimensions: { width: 2, depth: 2, height: 3 }, position: { x: 9, y: 2.2, z: -6 }, metadata: { source: 'Playback', micDi: 'Interface', stand: 'N/A', stageLocation: 'USR', stereoInputs: true } },
  { id: 'asset-wedge-monitor', label: 'Wedge Monitor', type: 'wedge-monitor', category: 'audio', layer: 'audio', icon: 'Mon', dimensions: { width: 2.2, depth: 1.4, height: 0.8 }, position: { x: 0, y: 1.35, z: 9 }, metadata: { monitorSend: 'Mix 1', stageLocation: 'DSC' } },
  { id: 'asset-moving-head', label: 'Moving Head', type: 'moving-head', category: 'lighting', layer: 'lighting', icon: 'MH', dimensions: { width: 0.9, depth: 0.9, height: 0.9 }, position: { x: 0, y: 8, z: -8 }, metadata: { fixtureType: 'Moving Head', universe: 1, address: 1, mode: '24ch', beamAngle: 24, color: '#61dcff', target: 'DSC', trussAssignment: 'Truss A' } },
  { id: 'asset-led-bar', label: 'LED Bar', type: 'led-bar', category: 'lighting', layer: 'lighting', icon: 'LED', dimensions: { width: 4, depth: 0.35, height: 0.35 }, position: { x: 0, y: 1.5, z: -10 }, metadata: { fixtureType: 'LED Bar', universe: 1, address: 101, mode: '16ch', beamAngle: 35, color: '#7cffdf', target: 'Backdrop' } },
  { id: 'asset-truss', label: 'Truss', type: 'truss', category: 'rigging', layer: 'rigging', icon: 'Trs', dimensions: { width: 20, depth: 0.35, height: 0.35 }, position: { x: 0, y: 8.4, z: -8 }, metadata: { trussType: 'Box Truss', qualifiedOnly: true, safetyNote: 'Load calculation required by qualified rigger.' } },
  { id: 'asset-led-wall', label: 'LED Wall', type: 'led-wall', category: 'video', layer: 'video', icon: 'LED', dimensions: { width: 12, depth: 0.4, height: 6 }, position: { x: 0, y: 4, z: -11.5 }, metadata: { screenType: 'LED Wall', aspectRatio: '16:9', resolution: '1920x1080', inputSource: 'Video Playback' } },
  { id: 'asset-camera', label: 'Camera', type: 'camera', category: 'video', layer: 'video', icon: 'Cam', dimensions: { width: 0.8, depth: 0.8, height: 2 }, position: { x: 0, y: 1.3, z: 17 }, metadata: { cameraAngle: 'FOH Wide', lens: '24-70mm', inputSource: 'Camera 1' } },
  { id: 'asset-foh', label: 'FOH Position', type: 'foh-position', category: 'venue', layer: 'venue', icon: 'FOH', dimensions: { width: 5, depth: 4, height: 0.2 }, position: { x: 0, y: 0.2, z: 28 }, metadata: { venueMarker: true, notes: 'Console / production position' } },
  { id: 'asset-power-distro', label: 'Power Distro', type: 'power-distro', category: 'power', layer: 'power', icon: 'Pwr', dimensions: { width: 2, depth: 1.4, height: 2.2 }, position: { x: -14, y: 1.7, z: -10 }, metadata: { powerLocation: 'USL', notes: 'Confirm service and tie-in with venue.' } }
]

export const objectLibraryGroups = [
  { key: 'primitives', label: 'Primitive Shapes', assets: primitiveStageAssets },
  { key: 'production', label: 'Production Objects', assets: productionStageAssets }
]

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
  editorSaveStatus: 'idle',
  editorSaveError: '',
  lastSavedAt: '',
  editorProject: null,
  createError: '',
  selectedStageType: 'Blank Stage',
  activeEditorMode: 'entities',
  activeStageSection: 'home',
  activeLibraryCategory: 'band-backline',
  selectedEditorObject: 'stage-deck',
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
  paneSizes: {
    library: Number(localStorage.getItem('stagePaneLibrary')) || 236,
    right: Number(localStorage.getItem('stagePaneRight')) || 286,
    bottom: Number(localStorage.getItem('stagePaneBottom')) || 190,
    bottomSplit: Number(localStorage.getItem('stagePaneBottomSplit')) || 58
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
  const mock = editorMockObjects.find((o) => o.key === state.selectedEditorObject)
  if (mock) return mock
  const object = Array.isArray(state.editorProject?.objects) ? state.editorProject.objects.find((o) => o.id === state.selectedEditorObject || o.key === state.selectedEditorObject) : null
  if (!object) return editorMockObjects[0]
  return {
    key: object.id || object.key,
    label: object.label || object.name || object.id || 'Stage Object',
    type: object.type || object.category || 'Object',
    details: {
      width: object.dimensions?.width,
      depth: object.dimensions?.depth,
      height: object.dimensions?.height
    }
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
    type: asset.type,
    category: asset.category,
    layer: asset.layer || asset.category || 'stage',
    name: overrides.name || asset.label,
    label: overrides.label || asset.label,
    position,
    rotation: { x: 0, y: 0, z: 0, ...(overrides.rotation || {}) },
    dimensions,
    visible: true,
    locked: false,
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
  state.activeInspectorTab = 'properties'
  state.activeEditorMode = 'entities'
  return object
}

export function findStageObject(objectId = state.selectedEditorObject) {
  return (state.editorProject?.objects || []).find((object) => object.id === objectId || object.key === objectId)
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
  return { kind: 'mock', entity: selectedEditorObject() }
}

export function updateSelectedStageObjectField(field, value) {
  const object = findStageObject()
  if (!object) return false
  if (['x', 'y', 'z'].includes(field)) object.position = { ...(object.position || {}), [field]: Number(value) || 0 }
  else if (['width', 'depth', 'height'].includes(field)) object.dimensions = { ...(object.dimensions || {}), [field]: Number(value) || 0 }
  else if (field === 'rotY') object.rotation = { ...(object.rotation || {}), y: Number(value) || 0 }
  else if (field === 'label') { object.label = String(value || ''); object.name = String(value || object.name || '') }
  else if (field === 'locked') object.locked = !!value
  else if (field === 'visible') object.visible = !!value
  else if (field === 'notes') object.notes = String(value || '')
  else if (field === 'layer') object.layer = String(value || object.layer || object.category || 'stage')
  else if (field === 'color') object.color = String(value || '')
  else object.metadata = { ...(object.metadata || {}), [field]: value }
  return true
}

export function stageWarnings() {
  const warnings = []
  const project = state.editorProject || {}
  const dims = currentStageDimensions()
  const halfWidth = Number(dims.width || 32) / 2
  const halfDepth = Number(dims.depth || 24) / 2
  ;(project.objects || []).forEach((object) => {
    const pos = object.position || {}
    if (Number.isFinite(pos.x) && Math.abs(pos.x) > halfWidth) warnings.push({ level: 'warning', title: `${object.label || object.name} is off stage width`, ownerId: object.id })
    if (Number.isFinite(pos.z) && Math.abs(pos.z) > halfDepth) warnings.push({ level: 'warning', title: `${object.label || object.name} is off stage depth`, ownerId: object.id })
    if (!object.label && !object.name) warnings.push({ level: 'warning', title: `Object ${object.id} has no label`, ownerId: object.id })
    if (object.category === 'rigging' && !object.notes && !object.metadata?.safetyNote) warnings.push({ level: 'warning', title: `${object.label || object.name} needs rigging notes`, ownerId: object.id })
  })
  const inputChannels = new Map()
  ;(project.audioInputs || []).forEach((input) => {
    if (!input.source) warnings.push({ level: 'warning', title: `Input channel ${input.channel || '?'} has no source`, ownerId: input.id })
    if (!input.micDi) warnings.push({ level: 'info', title: `${input.source || 'Audio input'} is missing mic/DI`, ownerId: input.id })
    if (input.channel) {
      const previous = inputChannels.get(input.channel)
      if (previous) warnings.push({ level: 'error', title: `Duplicate input channel ${input.channel}: ${previous} and ${input.source || input.id}`, ownerId: input.id })
      inputChannels.set(input.channel, input.source || input.id)
    }
  })
  const dmxAddresses = new Map()
  ;(project.fixtures || []).forEach((fixture) => {
    const key = `${fixture.universe || 1}:${fixture.address || ''}`
    if (!fixture.address) warnings.push({ level: 'warning', title: `${fixture.name || fixture.type} has no DMX address`, ownerId: fixture.id })
    if (fixture.address) {
      const previous = dmxAddresses.get(key)
      if (previous) warnings.push({ level: 'error', title: `Duplicate DMX address U${fixture.universe || 1}:${fixture.address} (${previous} / ${fixture.name || fixture.id})`, ownerId: fixture.id })
      dmxAddresses.set(key, fixture.name || fixture.id)
    }
  })
  if (!project.venue?.name || project.venue.name === 'Blank Stage') warnings.push({ level: 'info', title: 'Venue name is not set', ownerId: 'venue' })
  if (!(project.rigging || []).some((rig) => rig.notes)) warnings.push({ level: 'info', title: 'Rigging notes are not export-ready yet', ownerId: 'rigging' })
  return warnings
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
  if (entities.length) return entities
  return editorMockObjects.map((object) => objectEntity({ ...object, id: object.key, name: object.label, dimensions: object.details }))
}

export function projectLoadLabel() {
  if (state.projectLoadStatus === 'loaded') return 'loaded'
  if (state.projectLoadStatus === 'fallback') return 'fallback'
  if (state.projectLoadStatus === 'error') return 'error'
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
