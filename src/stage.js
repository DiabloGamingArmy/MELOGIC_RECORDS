import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute } from './utils/routes'
import { STORAGE_PATHS } from './config/storagePaths'
import { getPublicStorageUrl } from './firebase/storageAssets'
import { createStageProject, getStageProject, listAccessibleStageProjects, sortStageProjectsByActivity, touchStageProject } from './data/stageProjectService'
import { mountStageThreeViewport } from './stage/stageThreeViewport'
import { normalizeStagePlan } from './stage/stagePlanModel'

const app = document.querySelector('#app')
const sidebarItems = ['My Projects', 'Templates', 'Asset Library', 'Shared With Me', 'Exports', 'Learn']
const stageTypes = ['Blank Stage', 'Small Club', 'Festival', 'Worship/Church', 'Livestream Room', 'School Auditorium']
const templateCards = [
  { key: 'small-club', title: 'Small Club', subtitle: 'Quick-start layout', type: 'Small Club', icon: 'club' },
  { key: 'festival-stage', title: 'Festival Stage', subtitle: 'Quick-start layout', type: 'Festival', icon: 'festival' },
  { key: 'worship-stage', title: 'Worship Stage', subtitle: 'Quick-start layout', type: 'Worship/Church', icon: 'worship' },
  { key: 'livestream-room', title: 'Livestream Room', subtitle: 'Quick-start layout', type: 'Livestream Room', icon: 'livestream' }
]
const stageIconPath = (group, name) => STORAGE_PATHS.stageProdIcon(group, name)
const editorRailItems = [
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
const editorLibraryCategories = [
  { key: 'band-backline', label: 'Band / Backline', icon: '✦', iconPath: stageIconPath('library', 'band-backline'), select: 'drum-riser' },
  { key: 'lighting', label: 'Lighting', icon: '◉', iconPath: stageIconPath('library', 'lighting'), select: 'moving-head' },
  { key: 'rigging', label: 'Rigging', icon: '⛓', iconPath: stageIconPath('library', 'rigging'), select: 'truss-a' },
  { key: 'audio', label: 'Audio', icon: '◌', iconPath: stageIconPath('library', 'audio'), select: 'speaker-left' },
  { key: 'video', label: 'Video', icon: '▻', iconPath: stageIconPath('library', 'video'), select: 'camera-1' },
  { key: 'venue', label: 'Venue', icon: '▦', iconPath: stageIconPath('library', 'venue'), select: 'stage-deck' },
  { key: 'patching', label: 'Patching', icon: '⌁', iconPath: stageIconPath('library', 'patching'), select: 'stage-deck' },
  { key: 'cases', label: 'Cases', icon: '▣', iconPath: stageIconPath('library', 'cases'), select: 'stage-deck' }
]
const baseStageTypes = [
  { key: 'small-club', label: 'Small Club', icon: stageIconPath('base-stages', 'small-club') },
  { key: 'festival', label: 'Festival', icon: stageIconPath('base-stages', 'festival') },
  { key: 'church', label: 'Church', icon: stageIconPath('base-stages', 'church') },
  { key: 'school-auditorium', label: 'School Auditorium', icon: stageIconPath('base-stages', 'school-auditorium') },
  { key: 'custom', label: 'Custom', icon: stageIconPath('base-stages', 'custom') }
]
const editorModes = [
  { key: 'builder', label: '3D Builder' }, { key: 'stage-plot', label: '2D Stage Plot' }, { key: 'input-list', label: 'Input List' }, { key: 'lighting-plot', label: 'Lighting Plot' }, { key: 'rigging-plan', label: 'Rigging Plan' }
]
const editorMockObjects = [
  { key: 'stage-deck', label: 'Stage Deck', type: 'Base Stage', details: { width: '32 ft', depth: '24 ft', height: '4 ft' } },
  { key: 'drum-riser', label: 'Drum Riser', type: 'Backline', details: { width: '8 ft', depth: '8 ft', height: '2 ft' } },
  { key: 'truss-a', label: 'Truss A', type: 'Rigging', details: { system: 'Ground supported', span: '32 ft' } },
  { key: 'moving-head', label: 'Moving Head', type: 'Lighting', details: { fixture: 'Moving Head', address: '001/U1', mode: '24ch' } },
  { key: 'camera-1', label: 'Camera 1', type: 'Video', details: { angle: 'Wide', location: 'FOH' } }
]

const state = { user: null, loadingProjects: false, projectsError: '', projects: [], recentProjects: [], projectId: '', editorLoading: false, editorError: '', projectLoadStatus: 'loading', editorProject: null, createError: '', selectedStageType: 'Blank Stage', activeEditorMode: 'builder', activeRailSection: 'home', activeLibraryCategory: 'band-backline', selectedEditorObject: 'stage-deck', editorObjectTransforms: {}, snapEnabled: true, snapInterval: 1, measureModeEnabled: false, gridEnabled: true, beamPreviewEnabled: true, showStageLabels: true, showExportPreview: false, showStageGlobalHeader: false, stageAppMenuOpen: false, showViewportDiagnostics: false, viewportMode: localStorage.getItem('stageViewportMode') || 'perspective3d', activeInspectorTab: 'properties', activeDataTab: 'schema', paneSizes: { library: Number(localStorage.getItem('stagePaneLibrary')) || 236, right: Number(localStorage.getItem('stagePaneRight')) || 286, bottom: Number(localStorage.getItem('stagePaneBottom')) || 190 } }
let stageViewportController = null
let stageEditorMounted = false
let stageIconHydrationPromise = null
let stageEditorEventsBound = false
let stageViewportMountedForProjectId = ''

const getCurrentStageProjectId = () => (window.location.pathname || '').startsWith('/stage/') ? decodeURIComponent((window.location.pathname || '').replace('/stage/', '').split('/')[0] || '').trim() : ''
const projectDate = (p) => p?.lastOpenedAt?.toDate?.() || p?.updatedAt?.toDate?.() || p?.createdAt?.toDate?.() || null
function formatUpdatedLabel(project) {
  const date = projectDate(project)
  if (!date) return 'Updated recently'
  const now = new Date(); const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()); const then = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const days = Math.round((start - then) / 86400000)
  if (days <= 0) return 'Updated today'
  if (days === 1) return 'Updated yesterday'
  if (days <= 6) return `Updated ${days} days ago`
  return `Updated ${date.toLocaleDateString()}`
}
function getStageTypeClass(stageType = '') {
  const t = String(stageType || '').toLowerCase()
  if (t.includes('festival')) return 'festival'
  if (t.includes('worship') || t.includes('church')) return 'worship'
  if (t.includes('live')) return 'livestream'
  if (t.includes('club')) return 'club'
  return 'blank'
}

function projectCard(project, compact = false) {
  const typeClass = getStageTypeClass(project?.stageType)
  const ownerLabel = state.user?.uid && project?.ownerId === state.user.uid ? 'Created by you' : 'Shared with you'
  return `<article class="stage-project-card ${compact ? 'is-compact' : ''}"><button class="stage-project-open" data-open-project="${project.id}" type="button" aria-label="Open stage plan ${project.title}"><div class="stage-project-thumb stage-project-thumb--${typeClass}" aria-hidden="true"></div><div class="stage-project-meta"><h4>${project.title || 'Untitled Stage Plan'}</h4><p>${formatUpdatedLabel(project)}</p><p>${ownerLabel}</p><span class="stage-status-chip">In Progress</span></div><span class="stage-project-menu-dots" aria-hidden="true">•••</span></button></article>`
}

function renderRecent() {
  if (!state.user) return '<div class="stage-empty-panel"><div><p>Sign in to view recently modified projects.</p></div><div class="stage-state-visual" aria-hidden="true"></div></div>'
  if (state.loadingProjects) return '<p class="stage-recents-empty">Loading recent stage plans...</p>'
  if (!state.recentProjects.length) return '<div class="stage-recent-placeholder"><p class="stage-recents-empty">Recent stage plans will appear here once you open a project.</p><div class="stage-recent-skeleton-row" aria-hidden="true"><div class="stage-recent-skeleton"></div><div class="stage-recent-skeleton"></div></div></div>'
  return `<div class="stage-recent-grid">${state.recentProjects.slice(0, 4).map((p) => projectCard(p, true)).join('')}</div>`
}
function renderProjectsArea() {
  if (!state.user) return `<div class="stage-empty-panel"><div><p>Sign in to create and manage stage plans.</p><a class="stage-signin-button" href="${authRoute({ redirect: ROUTES.stage })}">Sign In / Sign Up</a></div><div class="stage-state-visual" aria-hidden="true"></div></div>`
  if (state.loadingProjects) return '<p class="stage-recents-empty">Loading stage plans...</p>'
  if (state.projectsError) return `<div class="stage-warning-panel"><div><p>We could not load your stage plans right now.</p><p>You can still create a new plan, or refresh this page.</p><div class="stage-warning-actions"><button class="stage-inline-button" data-new-stage-plan type="button">New Stage Plan</button><button class="stage-inline-button is-muted" data-retry-stage-projects type="button">Retry</button></div></div><div class="stage-state-visual" aria-hidden="true"></div></div>`
  if (!state.projects.length) return '<div class="stage-empty-panel"><div><p>No stage plans yet.</p><p>Create your first stage plan or start from a template.</p><button class="stage-inline-button" data-new-stage-plan type="button">New Stage Plan</button></div><div class="stage-state-visual" aria-hidden="true"></div></div>'
  return `<div class="stage-project-grid">${state.projects.map((p) => projectCard(p)).join('')}</div>`
}

function renderDashboard() {
  return `<main class="stage-dashboard-page"><section class="stage-dashboard-shell"><aside class="stage-dashboard-sidebar"><header class="stage-dashboard-brand"><span class="stage-dashboard-brand-mark" aria-hidden="true">▦</span><h1>STAGE</h1></header><a class="stage-dashboard-new-button" data-new-stage-plan href="${state.user ? '#' : authRoute({ redirect: ROUTES.stage })}">New Project <span aria-hidden="true">＋</span></a><nav class="stage-dashboard-nav" aria-label="Stage dashboard sections">${sidebarItems.map((item) => `<button class="stage-dashboard-nav-item ${item === 'My Projects' ? 'is-active' : ''}" type="button" ${item === 'My Projects' ? 'aria-current="page"' : ''}>${item}</button>`).join('')}</nav></aside><section class="stage-dashboard-main"><header class="stage-dashboard-heading"><h2>My Projects Dashboard</h2><p>Design the show. Build plots, layouts, and lists before load-in.</p></header><section class="stage-template-section"><div class="stage-section-heading"><h3>Quick-Start Templates</h3><span></span></div><div class="stage-template-row">${templateCards.map((tpl) => `<article class="stage-template-card"><div class="stage-template-thumb stage-template-thumb--${tpl.icon}" aria-hidden="true"></div><div class="stage-template-meta"><h4>${tpl.title}</h4><p>${tpl.subtitle}</p><button type="button" class="stage-template-view" data-use-template="${tpl.type}">View</button></div></article>`).join('')}</div></section><section class="stage-project-section"><div class="stage-section-heading"><h3>My Stage Projects</h3><span></span></div>${renderProjectsArea()}</section><section class="stage-project-section"><div class="stage-section-heading"><h3>Recently Modified Projects</h3><span></span></div>${renderRecent()}</section><div data-stage-modal-root></div></section></section></main>`
}


function selectedEditorObject() { return editorMockObjects.find((o) => o.key === state.selectedEditorObject) || editorMockObjects[0] }
function renderLeftPanel(title, body) { return `<aside class="stage-editor-library"><header><h3>${title}</h3><button type="button" aria-label="Close panel" aria-disabled="true">×</button></header>${body}</aside>` }
function renderLeftPanelBySection(title, stamp) {
  if (state.activeRailSection === 'object') return renderLeftPanel('OBJECT LIBRARY', `<div class="stage-editor-library-tools"><input aria-label="Search object library" placeholder="Search" /><button type="button" class="stage-library-filter" aria-disabled="true" title="Filters">⌕</button></div><label class="stage-editor-check"><input type="checkbox" /> Drag and drop categories</label><h4>BAND / BACKLINE</h4><div class="stage-object-grid">${editorLibraryCategories.map((c) => `<button class="stage-object-tile ${state.activeLibraryCategory === c.key ? 'is-active' : ''}" data-library-category="${c.key}" data-select-object="${c.select}" type="button"><span class="stage-object-icon-frame" data-stage-icon-path="${c.iconPath}"><img alt="" loading="lazy" hidden /><span class="stage-object-fallback-icon">${c.icon}</span></span><small>${c.label}</small></button>`).join('')}</div><h4>BASE STAGE TYPES</h4><div class="stage-base-stage-grid">${baseStageTypes.map((stage) => `<button class="stage-base-stage-card" type="button" aria-disabled="true"><span class="stage-base-stage-thumb" data-stage-icon-path="${stage.icon}"><img alt="" loading="lazy" hidden /><span>${stage.label.slice(0,2).toUpperCase()}</span></span><span>${stage.label}</span></button>`).join('')}</div>`)
  const base = `<section class="stage-config-panel"><h3>${state.activeRailSection.toUpperCase()}</h3><p>Project: ${title}</p><p>Date/Version: ${stamp} | v${state.editorProject?.version || 1}</p><p>Stage Type: ${state.editorProject?.stageType || 'Blank Stage'}</p><p>Status: Foundation Preview</p></section>`
  const map = {
    home: `${base}<section class="stage-config-panel"><h3>Quick Actions</h3><p>New Stage • Open Project • Duplicate • Export • Share</p></section>`,
    scene: `${base}<section class="stage-config-panel"><h3>Stage Dimensions</h3><p>Width: 32ft</p><p>Depth: 24ft</p><p>Deck Height: 4ft</p><p>Grid Size: 1ft • Snap Interval: ${state.snapInterval}ft</p><label class="stage-editor-check"><input data-toggle-labels type="checkbox" ${state.showStageLabels ? 'checked' : ''}/> Show labels</label><p>Scene notes: staging baseline configured.</p></section>`,
    lighting: `${base}<section class="stage-config-panel"><h3>Lighting</h3><p>Fixture list placeholder • 24 fixtures</p><button type="button" class="stage-inline-button">Add Fixture</button><p>DMX U1 Address 001 • Beam 15-45° • Color Cyan</p><p>Lighting notes: key/rim/front wash ready.</p></section>`,
    rigging: `${base}<section class="stage-config-panel"><h3>Rigging</h3><p>Truss/hang placeholders • Add Truss • Add Point</p><p>Rigging notes: ground support verified.</p><p>Qualified personnel required for rigging/hangs.</p></section>`,
    audio: `${base}<section class="stage-config-panel"><h3>Audio Plan</h3><p>Input list summary: 22 channels</p><button type="button" class="stage-inline-button">Add Source</button><p>Mic/DI notes • Monitor/speaker placeholders • Patch notes</p></section>`,
    video: `${base}<section class="stage-config-panel"><h3>Video Plan</h3><p>Screens • Projectors • Cameras • LED wall placeholders</p><p>Video notes: FOH wide camera active.</p></section>`,
    venue: `${base}<section class="stage-config-panel"><h3>Venue</h3><p>Venue: Main Hall</p><p>FOH: 28ft from DS edge</p><p>Loading notes • Power notes • Room notes</p></section>`,
    settings: `${base}<section class="stage-config-panel"><h3>Settings</h3><p>Units: Imperial • Default snap: ${state.snapInterval}ft • Default view: ${state.viewportMode}</p><label class="stage-editor-check"><input data-toggle-viewport-diagnostics type="checkbox" ${state.showViewportDiagnostics ? 'checked' : ''} /> Show viewport diagnostics</label><p>Theme density: compact (placeholder)</p></section>`,
    help: `${base}<section class="stage-config-panel"><h3>Help</h3><p>Orbit / Pan / Zoom / Nudge / Drag-drop / Resize panes.</p></section>`
  }
  return renderLeftPanel(state.activeRailSection.toUpperCase(), map[state.activeRailSection] || base)
}
function selectedEditorObjectMarkup() {
  const selected = selectedEditorObject()
  const t = state.editorObjectTransforms[selected.key] || {}
  const rows = [['Selected', selected.label], ['Type', selected.type], ...Object.entries(selected.details || {})]
  const fixtureRows = selected.key === 'moving-head' ? [['DMX Address', '60IUUI'], ['Mode', '24ch'], ['Color', 'Cyan'], ['Beam Angle', '15-45°']] : []
  const cameraRows = selected.key === 'camera-1' ? [['Target', 'Downstage Center']] : []
  return `<div class="stage-readout-grid">${[...rows, ...fixtureRows, ...cameraRows].map(([k,v])=>`<div><span>${String(k).toUpperCase()}</span><strong>${v}</strong></div>`).join('')}</div><div class="stage-transform-grid"><label>X<input data-transform-field="x" type="number" step="0.1" value="${t.x ?? 0}"></label><label>Y<input data-transform-field="y" type="number" step="0.1" value="${t.y ?? 0}"></label><label>Z<input data-transform-field="z" type="number" step="0.1" value="${t.z ?? 0}"></label><label>W<input data-transform-field="width" type="number" step="0.1" value="0"></label><label>D<input data-transform-field="depth" type="number" step="0.1" value="0"></label><label>H<input data-transform-field="height" type="number" step="0.1" value="0"></label><label>Rot<input data-transform-field="rotY" type="number" step="1" value="0"></label><label>Label<input data-transform-field="label" type="text" value="${selected.label}"></label><label><input data-transform-field="locked" type="checkbox"> Lock</label><label><input data-transform-field="visible" type="checkbox" checked> Visible</label><label>Notes<textarea data-transform-field="notes"></textarea></label></div>${selected.key === 'moving-head' ? '<input type="range" disabled />' : ''}`
}
function updateStageInspectorSelection() {
  const target = app.querySelector('[data-stage-selected-readout]')
  if (target) target.innerHTML = selectedEditorObjectMarkup()
}


function renderInspectorTabs(title, stamp) {
  const tabs = [['properties','Properties'],['ai','AI Assist'],['rig','Rig Notes'],['project','Project Info']]
  const active = state.activeInspectorTab
  const body = active === 'properties'
    ? `<section class="stage-config-panel"><h3>Properties</h3><div class="stage-readout" data-stage-selected-readout>${selectedEditorObjectMarkup()}</div></section>`
    : active === 'ai'
      ? '<section class="stage-ai-panel"><h3>AI Assistant</h3><p>Prompt-based stage assistant placeholder.</p><textarea aria-label="AI prompt" placeholder="Build me a 24x16 stage for a 5-piece metalcore band with tracks and lighting."></textarea><button type="button" aria-disabled="true">Generate</button></section>'
      : active === 'rig'
        ? '<section class="stage-config-panel"><h3>Rigging Notes</h3><p>Qualified personnel required for rigging/hangs.</p><textarea aria-label="Rigging notes" placeholder="Rigging notes"></textarea><ul><li>Add Truss (placeholder)</li><li>Add Rigging Point (placeholder)</li></ul></section>'
        : `<section class="stage-config-panel"><h3>Project Info</h3><p data-stage-project-info-title>${title}</p><p data-stage-project-info-type>${state.editorProject?.stageType || 'Blank Stage'}</p><p>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p><p>Category: ${editorLibraryCategories.find((c) => c.key === state.activeLibraryCategory)?.label || 'Band / Backline'}</p><p>Status: ${state.projectLoadStatus}</p><p>Project ID: ${state.projectId}</p></section>`
  return `<aside class="stage-editor-right"><div class="stage-inspector-tabs">${tabs.map(([k,l])=>`<button type="button" data-inspector-tab="${k}" class="${state.activeInspectorTab===k?'is-active':''}">${l}</button>`).join('')}</div><div class="stage-inspector-body">${body}</div></aside>`
}

function renderDataPane() {
  const tabs = [['schema','Schema'],['signal','Signal Flow'],['patch','Patch Graph'],['object','Object Graph'],['export','Export Data']]
  const body = state.activeDataTab === 'schema'
    ? `<ul class="stage-data-list"><li>Stage dimensions: 32x24x4 ft</li><li>Object count: ${editorMockObjects.length}</li><li>Fixture count: 3</li><li>Audio inputs: 22</li><li>Rigging points: 2</li><li>View mode: ${state.viewportMode}</li><li>Grid: ${state.gridEnabled ? 'On' : 'Off'} • Snap: ${state.snapEnabled ? 'On' : 'Off'}</li></ul>`
    : state.activeDataTab === 'signal'
      ? '<div class="stage-data-cards"><p>Source → Mic/DI → Channel → Console</p><p>Kick In → Beta 91A → Ch1 → FOH</p><p>Lead Voc → Wireless → Ch12 → FOH</p></div>'
      : state.activeDataTab === 'patch'
        ? '<div class="stage-data-cards"><p>DMX U1: 001-096 (placeholder)</p><p>Audio patch: Channels 1-22 (placeholder)</p></div>'
        : state.activeDataTab === 'object'
          ? `<div class="stage-data-cards"><p>Selected: ${selectedEditorObject().label}</p><p>Linked input: placeholder</p><p>Linked fixture: placeholder</p></div>`
          : '<ul class="stage-data-list"><li>✓ Stage dimensions set</li><li>✓ Labels enabled</li><li>✓ Input list generated</li><li>• Rigging notes present</li><li>• Project info complete</li></ul>'
  return `<section class="stage-bottom-secondary"><div class="stage-data-tabs">${tabs.map(([k,l])=>`<button type="button" data-data-tab="${k}" class="${state.activeDataTab===k?'is-active':''}">${l}</button>`).join('')}</div><div class="stage-data-body">${body}</div></section>`
}

function renderEditor() { /* unchanged behavior */
  if (state.editorLoading) return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Opening stage plan...</h2><p>Loading project workspace.</p><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  if (state.editorError === 'not-found') return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Stage plan not found.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  if (state.editorError) return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Could not open this stage plan.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  const inputListTable = '<table><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Notes</th></tr></thead><tbody><tr><td>✓</td><td>1</td><td>Kick In</td><td>Beta 91A</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>2</td><td>Kick Out</td><td>Beta 52</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>3</td><td>Snare Top</td><td>SM57</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>8</td><td>Bass DI</td><td>DI</td><td>N/A</td><td>USC</td></tr><tr><td>✓</td><td>12</td><td>Lead Voc</td><td>Wireless</td><td>N/A</td><td>DSC</td></tr><tr><td>✓</td><td>21</td><td>Playback L</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr><tr><td>✓</td><td>22</td><td>Playback R</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr></tbody></table>'
  const modeBody = state.activeEditorMode === 'stage-plot' ? '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>2D Stage Plot</h4><div class="stage-mode-large"></div></section></section>'
    : state.activeEditorMode === 'input-list' ? `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
      : state.activeEditorMode === 'lighting-plot' ? '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Lighting Plot Schematic</h4><div class="stage-mode-large lighting"></div></section></section>'
        : state.activeEditorMode === 'rigging-plan' ? '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Rigging Plan</h4><ul><li>Ground support verified</li><li>Point load check pending</li><li>Qualified personnel assigned</li></ul></section></section>'
          : `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
  return `<main class="stage-editor-app ${state.showStageGlobalHeader ? '' : 'is-header-hidden'}" style="--stage-lib-w:${state.paneSizes.library}px;--stage-right-w:${state.paneSizes.right}px;--stage-bottom-h:${state.paneSizes.bottom}px" data-stage-editor-app><section class="stage-editor-menubar"><div class="stage-editor-menu-left"><button class="stage-editor-app-menu" type="button" data-stage-app-menu aria-label="Stage app menu">☰</button><button type="button" data-icon-path="${stageIconPath('app', 'file')}">File</button><button type="button" data-icon-path="${stageIconPath('app', 'edit')}">Edit</button><button type="button" data-icon-path="${stageIconPath('app', 'view')}">View</button><button type="button" data-icon-path="${stageIconPath('app', 'share')}">Share</button></div><div class="stage-editor-project-title"><h2 data-stage-project-title>Project: ${title}</h2><p data-stage-project-version>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><button type="button" aria-disabled="true">Share ▾</button><button type="button" aria-disabled="true">⚙</button><button type="button" aria-disabled="true">⋯</button><button type="button" class="is-send" data-open-export type="button">Send Stage Plan</button></div></section><section class="stage-editor-tabbar"><div class="stage-editor-project-tab">${state.editorProject?.stageType || 'Festival Stage'} <span>×</span></div><div class="stage-editor-tab-actions"></div></section><section class="stage-editor-body"><nav class="stage-editor-rail" aria-label="Editor tools">${editorRailItems.map((item) => `<button type="button" class="${state.activeRailSection === item.key ? 'is-active' : ''}" data-rail-section="${item.key}" title="${item.label}"><span class="stage-rail-icon" data-stage-icon-path="${item.icon}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">◈</span></span><small>${item.label}</small></button>`).join('')}<a class="stage-back-link" href="${ROUTES.stage}"><span class="stage-rail-icon" data-stage-icon-path="${stageIconPath('rail', 'exit')}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">↩</span></span><small>Exit</small></a></nav>${renderLeftPanelBySection(title, stamp)}<div class="stage-resize-handle is-library" data-resize="library"></div><section class="stage-editor-workspace"><div class="stage-editor-viewport"><div class="stage-editor-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-viewport-overlay"><div class="stage-viewport-tools"><span>TOOLS:</span><button type="button" data-toggle-beam class="${state.beamPreviewEnabled ? 'is-active' : ''}">Beam Preview</button><button type="button" data-toggle-grid class="${state.gridEnabled ? 'is-active' : ''}">Grid ${state.gridEnabled ? 'On' : 'Off'}</button><button type="button" data-toggle-snap class="${state.snapEnabled ? 'is-active' : ''}">Snap ${state.snapEnabled ? 'On' : 'Off'}</button><button type="button" data-toggle-measure class="${state.measureModeEnabled ? 'is-active' : ''}" title="Measurement is preview mode only">Measure</button></div><div class="stage-viewport-view-modes"><span>VIEW MODE:</span>${[['perspective3d','3D'],['top2d','Top'],['front','Front'],['side','Side'],['isometric','Iso']].map(([k,l])=>`<button type="button" class="${state.viewportMode===k?'is-active-view':''}" data-view-mode="${k}">${l}</button>`).join('')}</div></div><div class="stage-three-hud-label">Blank Stage</div><div class="stage-three-hint">Orbit: drag • Pan: right-drag • Zoom: wheel • Nudge: arrows/PageUp/PageDown</div></div></div></section><div class="stage-resize-handle is-right" data-resize="right"></div>${renderInspectorTabs(title, stamp)}<section class="stage-editor-bottom"><div class="stage-resize-handle is-bottom" data-resize="bottom"></div><div class="stage-editor-mode-tabs">${editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')}</div><div data-stage-mode-root><div class="stage-bottom-split">${modeBody}${renderDataPane()}</div></div></section></section>${state.showExportPreview?`<div class="stage-export-modal"><div class="stage-export-sheet"><h3>Stage Plan Preview</h3><p>${title} • ${stamp}</p><div class="stage-export-drawing">Stage Plot Sheet Preview (vector foundation)</div><div class="stage-export-inputs"><h4>Input List Sheet</h4><p>Channel • Source • Mic/DI • Stand • Notes</p></div><div class="stage-export-actions"><button disabled title="PDF export coming soon; use SVG/JSON for now.">Export PDF</button><button>Export PNG</button><button>Export SVG</button><button>Export JSON</button><button>Copy Share Link</button><button data-close-export>Close</button></div></div></div>`:''}</main>`
}

function initStageEditorViewport() {
  stageViewportController?.dispose?.()
  stageViewportController = null
  if (!state.projectId || state.editorLoading || state.editorError) return
  const container = app.querySelector('[data-stage-three-viewport]')
  if (!container) return
  stageViewportController = mountStageThreeViewport(container, {
    project: state.editorProject,
    projectLoadStatus: state.projectLoadStatus,
    showDiagnostics: state.showViewportDiagnostics,
    selectedObjectKey: state.selectedEditorObject,
    objectTransforms: state.editorObjectTransforms,
    onSelectObject: (key) => { if (state.selectedEditorObject === key) return; state.selectedEditorObject = key; updateStageInspectorSelection() },
    onTransformObject: (key, transform) => { state.editorObjectTransforms = { ...(state.editorObjectTransforms || {}), [key]: transform } },
    viewportMode: state.viewportMode
    , showGrid: state.gridEnabled
    , showBeams: state.beamPreviewEnabled
    , showLabels: state.showStageLabels
  })
  if (stageViewportController) stageViewportMountedForProjectId = state.projectId
}



async function hydrateStageIcons() {
  const nodes = [...app.querySelectorAll('[data-stage-icon-path]')]
  await Promise.all(nodes.map(async (node) => {
    const path = node.dataset.stageIconPath
    if (!path || node.dataset.iconHydrated === 'true') return
    node.dataset.iconHydrated = 'true'
    const url = await getPublicStorageUrl(path)
    if (!url) return
    const img = node.querySelector('img')
    if (!img) return
    img.addEventListener('load', () => { img.hidden = false; node.classList.add('has-stage-icon') }, { once: true })
    img.addEventListener('error', () => { img.hidden = true; node.classList.remove('has-stage-icon') }, { once: true })
    img.src = url
  }))
}


function updateStageAppMenu() {
  const left = app.querySelector('.stage-editor-menu-left')
  if (!left) return
  const existing = left.querySelector('[data-stage-app-menu-panel]')
  existing?.remove()
  if (!state.stageAppMenuOpen) return
  left.insertAdjacentHTML('beforeend', `<div class="stage-editor-app-menu-panel" data-stage-app-menu-panel><a href="${ROUTES.stage}">Stage Projects</a><a href="/">Dashboard</a><button type="button" aria-disabled="true">Asset Library</button><button type="button" aria-disabled="true">Exports</button></div>`)
}
function updateEditorModeUI() {
  app.querySelectorAll('[data-editor-mode]').forEach((el) => {
    const active = (el.dataset.editorMode || '') === state.activeEditorMode
    el.classList.toggle('is-active', active)
    el.setAttribute('aria-selected', String(active))
  })
  const root = app.querySelector('[data-stage-mode-root]')
  if (!root) return
  const inputListTable = '<table><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Notes</th></tr></thead><tbody><tr><td>✓</td><td>1</td><td>Kick In</td><td>Beta 91A</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>2</td><td>Kick Out</td><td>Beta 52</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>3</td><td>Snare Top</td><td>SM57</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>8</td><td>Bass DI</td><td>DI</td><td>N/A</td><td>USC</td></tr><tr><td>✓</td><td>12</td><td>Lead Voc</td><td>Wireless</td><td>N/A</td><td>DSC</td></tr><tr><td>✓</td><td>21</td><td>Playback L</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr><tr><td>✓</td><td>22</td><td>Playback R</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr></tbody></table>'
  root.innerHTML = state.activeEditorMode === 'stage-plot' ? '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>2D Stage Plot</h4><div class="stage-mode-large"></div></section></section>'
    : state.activeEditorMode === 'input-list' ? `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
      : state.activeEditorMode === 'lighting-plot' ? '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Lighting Plot Schematic</h4><div class="stage-mode-large lighting"></div></section></section>'
        : state.activeEditorMode === 'rigging-plan' ? '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Rigging Plan</h4><ul><li>Ground support verified</li><li>Point load check pending</li><li>Qualified personnel assigned</li></ul></section></section>'
          : `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
}
function updateLibraryActiveState() {
  app.querySelectorAll('[data-library-category]').forEach((el) => el.classList.toggle('is-active', (el.dataset.libraryCategory || '') === state.activeLibraryCategory))
}

function updateEditorProjectHeader() {
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  const version = state.editorProject?.version || 1
  const stageType = state.editorProject?.stageType || 'Blank Stage'
  const titleNode = app.querySelector('[data-stage-project-title]')
  const versionNode = app.querySelector('[data-stage-project-version]')
  const infoTitleNode = app.querySelector('[data-stage-project-info-title]')
  const infoTypeNode = app.querySelector('[data-stage-project-info-type]')
  const stageTypeNode = app.querySelector('[data-stage-type-label]')
  if (titleNode) titleNode.textContent = `Project: ${title}`
  if (versionNode) versionNode.textContent = `Date/Version ${stamp} | v${version}`
  if (infoTitleNode) infoTitleNode.textContent = title
  if (infoTypeNode) infoTypeNode.textContent = stageType
  if (stageTypeNode) stageTypeNode.textContent = stageType
}

function ensureStageViewportMounted() {
  if (!state.projectId || state.editorLoading || state.editorError || !state.editorProject) return
  if (stageViewportController && stageViewportMountedForProjectId === state.projectId) return
  stageViewportController?.dispose?.()
  stageViewportController = null
  initStageEditorViewport()
  stageViewportMountedForProjectId = state.projectId
}

function hydrateStageIconsOnce() {
  if (stageIconHydrationPromise) return stageIconHydrationPromise
  stageIconHydrationPromise = hydrateStageIcons()
  return stageIconHydrationPromise
}

function renderApp() {
  if (!state.projectId) {
    stageViewportController?.dispose?.(); stageViewportController = null; stageEditorMounted = false; stageIconHydrationPromise = null; stageViewportMountedForProjectId = ''
    app.innerHTML = `${navShell({ currentPage: 'stage' })}${renderDashboard()}`
    initShellChrome(); bindDashboardEvents(); return
  }
  const mounted = app.querySelector('[data-stage-editor-app]')
  if (!stageEditorMounted || !mounted) {
    app.innerHTML = `<div data-stage-global-header-wrapper ${state.showStageGlobalHeader ? '' : 'hidden'}>${navShell({ currentPage: 'stage' })}</div>${renderEditor()}`
    initShellChrome(); bindStageEditorEventsOnce(); ensureStageViewportMounted(); hydrateStageIconsOnce(); stageEditorMounted = true; updateEditorProjectHeader(); updateStageAppMenu(); return
  }
  updateEditorProjectHeader(); updateEditorModeUI(); updateLibraryActiveState(); updateStageInspectorSelection(); updateStageAppMenu(); ensureStageViewportMounted()
}
function closeModal() { app.querySelector('[data-stage-modal-root]')?.replaceChildren(); document.removeEventListener('keydown', onModalEscape) }
function onModalEscape(e) { if (e.key === 'Escape') closeModal() }
function renderCreateModal(loading = false, selectedStageType = 'Blank Stage') {
  const root = app.querySelector('[data-stage-modal-root]'); if (!root) return
  if (loading) { root.innerHTML = '<div class="stage-modal"><div class="stage-modal-panel"><h3>Creating stage plan...</h3></div></div>'; return }
  root.innerHTML = `<div class="stage-modal" data-modal-backdrop><form class="stage-modal-panel" data-stage-create-form><h3>New Stage Plan</h3><p class="stage-modal-help">Choose a starting format. You can change dimensions later.</p><div class="stage-modal-field"><label for="stage-project-name">Project name</label><input id="stage-project-name" name="title" required maxlength="120" placeholder="Name your stage plan" /></div><div class="stage-modal-field"><label for="stage-type">Stage type</label><select id="stage-type" name="stageType">${stageTypes.map((t) => `<option value="${t}" ${t === selectedStageType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>${state.createError ? `<p class="stage-form-error">${state.createError}</p>` : ''}<div class="stage-modal-actions"><button class="button" type="submit">Create Stage Plan</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  document.addEventListener('keydown', onModalEscape)
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (e) => e.target === e.currentTarget && closeModal())
  root.querySelector('[data-close-modal]')?.addEventListener('click', closeModal)
  root.querySelector('[data-stage-create-form]')?.addEventListener('submit', async (e) => { e.preventDefault(); state.createError = ''; renderCreateModal(true, selectedStageType); try { const fd = new FormData(e.currentTarget); const project = await createStageProject(state.user, { title: fd.get('title'), stageType: fd.get('stageType') }); window.location.href = stageProjectRoute(project.id) } catch { state.createError = 'Could not create stage plan right now.'; renderCreateModal(false, selectedStageType) } })
}
async function openProject(projectId) { if (!projectId) return; touchStageProject(projectId).catch(() => {}); window.location.href = stageProjectRoute(projectId) }
function bindDashboardEvents() {
  app.querySelectorAll('[data-new-stage-plan]').forEach((el) => el.addEventListener('click', (e) => { if (!state.user) return; e.preventDefault(); renderCreateModal(false, state.selectedStageType || 'Blank Stage') }))
  app.querySelectorAll('[data-use-template]').forEach((el) => el.addEventListener('click', () => { if (!state.user) { window.location.href = authRoute({ redirect: ROUTES.stage }); return } state.selectedStageType = el.dataset.useTemplate || 'Blank Stage'; renderCreateModal(false, state.selectedStageType) }))
  app.querySelectorAll('[data-open-project]').forEach((el) => el.addEventListener('click', () => openProject(el.dataset.openProject || '')))
  app.querySelector('[data-retry-stage-projects]')?.addEventListener('click', () => loadDashboardProjects())
}
function bindStageEditorEventsOnce() {
  if (stageEditorEventsBound) return
  stageEditorEventsBound = true
  app.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-editor-mode]')
    if (mode) { state.activeEditorMode = mode.dataset.editorMode || 'builder'; updateEditorModeUI(); return }
    const menuBtn = e.target.closest('[data-stage-app-menu]')
    if (menuBtn) { state.stageAppMenuOpen = !state.stageAppMenuOpen; updateStageAppMenu(); return }
    const menuPanel = e.target.closest('[data-stage-app-menu-panel]')
    if (!menuPanel && state.stageAppMenuOpen) { state.stageAppMenuOpen = false; updateStageAppMenu() }
    const lib = e.target.closest('[data-library-category]')
    if (lib) { state.activeLibraryCategory = lib.dataset.libraryCategory || 'band-backline'; state.selectedEditorObject = lib.dataset.selectObject || state.selectedEditorObject; updateLibraryActiveState(); updateStageInspectorSelection(); return }
    const rail = e.target.closest('[data-rail-section]')
    if (rail) { state.activeRailSection = rail.dataset.railSection || 'home'; renderApp(); return }
    const vm = e.target.closest('[data-view-mode]')
    if (vm) { state.viewportMode = vm.dataset.viewMode || 'perspective3d'; localStorage.setItem('stageViewportMode', state.viewportMode); stageViewportController?.update?.({ viewportMode: state.viewportMode }); renderApp(); return }
    const grid = e.target.closest('[data-toggle-grid]'); if (grid) { state.gridEnabled = !state.gridEnabled; stageViewportController?.update?.({ showGrid: state.gridEnabled }); renderApp(); return }
    const beam = e.target.closest('[data-toggle-beam]'); if (beam) { state.beamPreviewEnabled = !state.beamPreviewEnabled; stageViewportController?.update?.({ showBeams: state.beamPreviewEnabled }); renderApp(); return }
    const openExport = e.target.closest('[data-open-export]'); if (openExport) { state.showExportPreview = true; renderApp(); return }
    const closeExport = e.target.closest('[data-close-export]'); if (closeExport) { state.showExportPreview = false; renderApp(); return }
    const snap = e.target.closest('[data-toggle-snap]'); if (snap) { state.snapEnabled = !state.snapEnabled; renderApp(); return }
    const measure = e.target.closest('[data-toggle-measure]'); if (measure) { state.measureModeEnabled = !state.measureModeEnabled; renderApp(); return }
    const inspectorTab = e.target.closest('[data-inspector-tab]'); if (inspectorTab) { state.activeInspectorTab = inspectorTab.dataset.inspectorTab || 'properties'; renderApp(); return }
    const dataTab = e.target.closest('[data-data-tab]'); if (dataTab) { state.activeDataTab = dataTab.dataset.dataTab || 'schema'; updateEditorModeUI(); return }
  })
  app.addEventListener('input', (e) => {
    const f = e.target.closest('[data-transform-field]')
    if (!f) return
    const key = state.selectedEditorObject
    const existing = state.editorObjectTransforms[key] || {}
    const v = f.type === 'number' ? Number(f.value) : f.type === 'checkbox' ? !!f.checked : f.value
    state.editorObjectTransforms = { ...state.editorObjectTransforms, [key]: { ...existing, [f.dataset.transformField]: v } }
  })
  app.addEventListener('change', (e) => {
    const diag = e.target.closest('[data-toggle-viewport-diagnostics]')
    if (diag) { state.showViewportDiagnostics = !!diag.checked; stageViewportController?.dispose?.(); stageViewportController = null; ensureStageViewportMounted(); return }
    const toggle = e.target.closest('[data-toggle-main-header]')
    if (!toggle) return
    state.showStageGlobalHeader = !!toggle.checked
    const header = app.querySelector('[data-stage-global-header-wrapper]')
    const editor = app.querySelector('[data-stage-editor-app]')
    if (header) header.hidden = !state.showStageGlobalHeader
    if (editor) editor.classList.toggle('is-header-hidden', !state.showStageGlobalHeader)
  })
  app.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-resize]')
    if (!handle) return
    const editor = app.querySelector('[data-stage-editor-app]')
    if (!editor) return
    const type = handle.dataset.resize
    const startX = e.clientX; const startY = e.clientY
    const start = { ...state.paneSizes }
    const maxBottom = () => Math.round((editor.clientHeight || window.innerHeight) * 0.45)
    const onMove = (evt) => {
      if (type === 'library') state.paneSizes.library = Math.min(360, Math.max(180, start.library + (evt.clientX - startX)))
      if (type === 'right') state.paneSizes.right = Math.min(420, Math.max(240, start.right - (evt.clientX - startX)))
      if (type === 'bottom') state.paneSizes.bottom = Math.min(maxBottom(), Math.max(120, start.bottom - (evt.clientY - startY)))
      editor.style.setProperty('--stage-lib-w', `${state.paneSizes.library}px`)
      editor.style.setProperty('--stage-right-w', `${state.paneSizes.right}px`)
      editor.style.setProperty('--stage-bottom-h', `${state.paneSizes.bottom}px`)
    }
    const onUp = () => {
      localStorage.setItem('stagePaneLibrary', String(state.paneSizes.library))
      localStorage.setItem('stagePaneRight', String(state.paneSizes.right))
      localStorage.setItem('stagePaneBottom', String(state.paneSizes.bottom))
      window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.stageAppMenuOpen) { state.stageAppMenuOpen = false; updateStageAppMenu() } })
}
async function loadDashboardProjects() { if (!state.user?.uid || state.projectId) return; state.loadingProjects = true; state.projectsError = ''; renderApp(); try { const projects = await listAccessibleStageProjects(state.user.uid); const sorted = [...projects].sort(sortStageProjectsByActivity); state.projects = sorted; state.recentProjects = sorted.slice(0, 6) } catch { state.projects = []; state.recentProjects = []; state.projectsError = 'load-failed' } finally { state.loadingProjects = false; renderApp() } }
async function loadEditorProject() { if (!state.projectId) return; state.editorLoading = true; state.editorError = ''; state.projectLoadStatus = 'loading'; renderApp(); try { const project = await getStageProject(state.projectId); if (!project) { state.editorError = 'not-found'; state.projectLoadStatus = 'error' } else { state.editorProject = normalizeStagePlan({ ...project, id: project.id || state.projectId, name: project.title || project.name }); state.projectLoadStatus = 'loaded' } } catch { state.editorProject = normalizeStagePlan({ id: state.projectId, title: 'Fallback Stage Plan', stageType: 'Blank Stage', version: 1 }); state.projectLoadStatus = 'fallback'; console.warn('[stage] Firestore project load failed. Stage editor shell remains available with default viewport objects.') } finally { state.editorLoading = false; renderApp() } }

state.projectId = getCurrentStageProjectId()
waitForInitialAuthState().then(async (user) => { state.user = user; renderApp(); if (state.projectId) await loadEditorProject(); else await loadDashboardProjects() })
subscribeToAuthState(async (user) => { state.user = user; if (!state.projectId) { state.projects = []; state.recentProjects = [] } renderApp(); if (!state.projectId) await loadDashboardProjects() })
