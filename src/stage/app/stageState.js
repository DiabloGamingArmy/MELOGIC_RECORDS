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
  { key: 'lighting', label: 'Lighting', icon: stageIconPath('rail', 'lighting') },
  { key: 'rigging', label: 'Rigging', icon: stageIconPath('rail', 'rigging') },
  { key: 'audio', label: 'Audio', icon: stageIconPath('rail', 'audio') },
  { key: 'video', label: 'Video', icon: stageIconPath('rail', 'video') },
  { key: 'venue', label: 'Venue', icon: stageIconPath('rail', 'venue') },
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
  { key: 'builder', label: '3D Builder' },
  { key: 'stage-plot', label: '2D Stage Plot' },
  { key: 'input-list', label: 'Input List' },
  { key: 'lighting-plot', label: 'Lighting Plot' },
  { key: 'rigging-plan', label: 'Rigging Plan' }
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
  editorProject: null,
  createError: '',
  selectedStageType: 'Blank Stage',
  activeEditorMode: 'builder',
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
  return editorMockObjects.find((o) => o.key === state.selectedEditorObject) || editorMockObjects[0]
}

export function currentStageDimensions() {
  return state.editorProject?.stageDimensions || { width: 32, depth: 24, deckHeight: 4, unit: 'ft' }
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
