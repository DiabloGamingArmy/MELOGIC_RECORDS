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

const state = { user: null, loadingProjects: false, projectsError: '', projects: [], recentProjects: [], projectId: '', editorLoading: false, editorError: '', editorProject: null, createError: '', selectedStageType: 'Blank Stage', activeEditorMode: 'builder', activeLibraryCategory: 'band-backline', selectedEditorObject: 'stage-deck', editorObjectTransforms: {}, showStageGlobalHeader: false, stageAppMenuOpen: false }
let cleanupStageViewport = null
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
function selectedEditorObjectMarkup() {
  const selected = selectedEditorObject()
  const rows = [['Selected', selected.label], ['Type', selected.type], ...Object.entries(selected.details || {})]
  const fixtureRows = selected.key === 'moving-head' ? [['DMX Address', '60IUUI'], ['Mode', '24ch'], ['Color', 'Cyan'], ['Beam Angle', '15-45°']] : []
  const cameraRows = selected.key === 'camera-1' ? [['Target', 'Downstage Center']] : []
  return `<div class="stage-readout-grid">${[...rows, ...fixtureRows, ...cameraRows].map(([k,v])=>`<div><span>${String(k).toUpperCase()}</span><strong>${v}</strong></div>`).join('')}</div>${selected.key === 'moving-head' ? '<input type="range" disabled />' : ''}`
}
function updateStageInspectorSelection() {
  const target = app.querySelector('[data-stage-selected-readout]')
  if (target) target.innerHTML = selectedEditorObjectMarkup()
}

function renderEditor() { /* unchanged behavior */
  if (state.editorLoading) return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Opening stage plan...</h2><p>Loading project workspace.</p><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  if (state.editorError === 'not-found') return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Stage plan not found.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  if (state.editorError) return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Could not open this stage plan.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  const inputListTable = '<table><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Notes</th></tr></thead><tbody><tr><td>✓</td><td>1</td><td>Kick In</td><td>Beta 91A</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>2</td><td>Kick Out</td><td>Beta 52</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>3</td><td>Snare Top</td><td>SM57</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>8</td><td>Bass DI</td><td>DI</td><td>N/A</td><td>USC</td></tr><tr><td>✓</td><td>12</td><td>Lead Voc</td><td>Wireless</td><td>N/A</td><td>DSC</td></tr><tr><td>✓</td><td>21</td><td>Playback L</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr><tr><td>✓</td><td>22</td><td>Playback R</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr></tbody></table>'
  const modeBody = state.activeEditorMode === 'stage-plot' ? '<section class="stage-editor-mode-content"><section class="stage-editor-mode-panel"><h4>2D Stage Plot</h4><div class="stage-mode-large"></div></section></section>'
    : state.activeEditorMode === 'input-list' ? `<section class="stage-editor-mode-content"><section class="stage-editor-table-panel is-large"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
      : state.activeEditorMode === 'lighting-plot' ? '<section class="stage-editor-mode-content"><section class="stage-editor-mode-panel"><h4>Lighting Plot Schematic</h4><div class="stage-mode-large lighting"></div></section></section>'
        : state.activeEditorMode === 'rigging-plan' ? '<section class="stage-editor-mode-content"><section class="stage-editor-mode-panel"><h4>Rigging Plan</h4><ul><li>Ground support verified</li><li>Point load check pending</li><li>Qualified personnel assigned</li></ul></section></section>'
          : `<section class="stage-editor-mode-content"><section class="stage-editor-table-panel"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
  return `<main class="stage-editor-app ${state.showStageGlobalHeader ? '' : 'is-header-hidden'}" data-stage-editor-app><section class="stage-editor-menubar"><div class="stage-editor-menu-left"><strong>MELOGIC <span>STAGE</span></strong><button type="button" data-icon-path="${stageIconPath('app', 'file')}">File</button><button type="button" data-icon-path="${stageIconPath('app', 'edit')}">Edit</button><button type="button" data-icon-path="${stageIconPath('app', 'view')}">View</button><button type="button" data-icon-path="${stageIconPath('app', 'share')}">Share</button></div><div class="stage-editor-project-title"><h2 data-stage-project-title>Project: ${title}</h2><p data-stage-project-version>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><button type="button" aria-disabled="true">Share ▾</button><button type="button" aria-disabled="true">⚙</button><button type="button" aria-disabled="true">⋯</button><button type="button" class="is-send" aria-disabled="true">Send Stage Plan</button></div></section><section class="stage-editor-tabbar"><div class="stage-editor-project-tab">${state.editorProject?.stageType || 'Festival Stage'} <span>×</span></div><div class="stage-editor-tab-actions"><button type="button" class="is-beam" aria-pressed="true">Beam Preview</button><button type="button" aria-disabled="true">Grid</button><button type="button" aria-disabled="true">Snap</button></div></section><section class="stage-editor-body"><nav class="stage-editor-rail" aria-label="Editor tools">${editorRailItems.map((item, i) => `<button type="button" class="${i === 1 ? 'is-active' : ''}"><span class="stage-rail-icon" data-stage-icon-path="${item.icon}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">◈</span></span><small>${item.label}</small></button>`).join('')}<a class="stage-back-link" href="${ROUTES.stage}"><span class="stage-rail-icon" data-stage-icon-path="${stageIconPath('rail', 'exit')}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">↩</span></span><small>Exit</small></a></nav><aside class="stage-editor-library"><header><h3>OBJECT LIBRARY</h3><button type="button" aria-label="Close object library" aria-disabled="true">×</button></header><div class="stage-editor-library-tools"><input aria-label="Search object library" placeholder="Search" /><button type="button" class="stage-library-filter" aria-disabled="true" title="Filters">⌕</button></div><label class="stage-editor-check"><input type="checkbox" /> Drag and drop categories</label><h4>BAND / BACKLINE</h4><div class="stage-object-grid">${editorLibraryCategories.map((c) => `<button class="stage-object-tile ${state.activeLibraryCategory === c.key ? 'is-active' : ''}" data-library-category="${c.key}" data-select-object="${c.select}" type="button"><span class="stage-object-icon-frame" data-stage-icon-path="${c.iconPath}"><img alt="" loading="lazy" hidden /><span class="stage-object-fallback-icon">${c.icon}</span></span><small>${c.label}</small></button>`).join('')}</div><h4>BASE STAGE TYPES</h4><div class="stage-base-stage-grid">${baseStageTypes.map((stage) => `<button class="stage-base-stage-card" type="button" aria-disabled="true"><span class="stage-base-stage-thumb" data-stage-icon-path="${stage.icon}"><img alt="" loading="lazy" hidden /><span>${stage.label.slice(0,2).toUpperCase()}</span></span><span>${stage.label}</span></button>`).join('')}</div></aside><section class="stage-editor-workspace"><div class="stage-editor-viewport"><div class="stage-editor-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-three-hud-label">Blank Stage</div><div class="stage-three-hint">Orbit: drag • Pan: right-drag • Zoom: wheel • Nudge: arrows/PageUp/PageDown</div></div></div></section><aside class="stage-editor-right"><section class="stage-config-panel"><h3>Fixture Configuration</h3><div class="stage-readout" data-stage-selected-readout>${selectedEditorObjectMarkup()}</div></section><section class="stage-ai-panel"><h3>AI Assistant</h3><textarea aria-label="AI prompt" placeholder="Build me a 24x16 stage for a 5-piece metalcore band with tracks and lighting."></textarea><button type="button" aria-disabled="true">Generate</button></section><section class="stage-config-panel"><h3>Rigging Notes</h3><p>Qualified personnel approved for hangs.</p></section><section class="stage-config-panel"><h3>Project Info</h3><p data-stage-project-info-title>${title}</p><p data-stage-project-info-type>${state.editorProject?.stageType || 'Blank Stage'}</p><p>Category: ${editorLibraryCategories.find((c) => c.key === state.activeLibraryCategory)?.label || 'Band / Backline'}</p><p>Status: Foundation Preview</p></section></aside><section class="stage-editor-bottom"><div class="stage-editor-mode-tabs">${editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')}</div><div data-stage-mode-root>${modeBody}</div></section></section></main>`
}

function initStageEditorViewport() {
  cleanupStageViewport?.()
  cleanupStageViewport = null
  if (!state.projectId || state.editorLoading || state.editorError || !state.editorProject) return
  const container = app.querySelector('[data-stage-three-viewport]')
  if (!container) return
  cleanupStageViewport = mountStageThreeViewport(container, {
    project: state.editorProject,
    selectedObjectKey: state.selectedEditorObject,
    objectTransforms: state.editorObjectTransforms,
    onSelectObject: (key) => { if (state.selectedEditorObject === key) return; state.selectedEditorObject = key; updateStageInspectorSelection() },
    onTransformObject: (key, transform) => { state.editorObjectTransforms = { ...(state.editorObjectTransforms || {}), [key]: transform } }
  })
  if (cleanupStageViewport) stageViewportMountedForProjectId = state.projectId
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
  left.insertAdjacentHTML('beforeend', `<div class="stage-editor-app-menu-panel" data-stage-app-menu-panel><label><input type="checkbox" data-toggle-main-header ${state.showStageGlobalHeader ? 'checked' : ''}/> Show main header</label><a href="${ROUTES.stage}">Stage Projects</a><a href="/">Dashboard</a><button type="button" aria-disabled="true">Asset Library</button><button type="button" aria-disabled="true">Exports</button></div>`)
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
  root.innerHTML = state.activeEditorMode === 'stage-plot' ? '<section class="stage-editor-mode-content"><section class="stage-editor-mode-panel"><h4>2D Stage Plot</h4><div class="stage-mode-large"></div></section></section>'
    : state.activeEditorMode === 'input-list' ? `<section class="stage-editor-mode-content"><section class="stage-editor-table-panel is-large"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
      : state.activeEditorMode === 'lighting-plot' ? '<section class="stage-editor-mode-content"><section class="stage-editor-mode-panel"><h4>Lighting Plot Schematic</h4><div class="stage-mode-large lighting"></div></section></section>'
        : state.activeEditorMode === 'rigging-plan' ? '<section class="stage-editor-mode-content"><section class="stage-editor-mode-panel"><h4>Rigging Plan</h4><ul><li>Ground support verified</li><li>Point load check pending</li><li>Qualified personnel assigned</li></ul></section></section>'
          : `<section class="stage-editor-mode-content"><section class="stage-editor-table-panel"><h4>Auto-Generated Input List</h4>${inputListTable}</section></section>`
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
  if (cleanupStageViewport && stageViewportMountedForProjectId === state.projectId) return
  cleanupStageViewport?.()
  cleanupStageViewport = null
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
    cleanupStageViewport?.(); cleanupStageViewport = null; stageEditorMounted = false; stageIconHydrationPromise = null; stageViewportMountedForProjectId = ''
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
  })
  app.addEventListener('change', (e) => {
    const toggle = e.target.closest('[data-toggle-main-header]')
    if (!toggle) return
    state.showStageGlobalHeader = !!toggle.checked
    const header = app.querySelector('[data-stage-global-header-wrapper]')
    const editor = app.querySelector('[data-stage-editor-app]')
    if (header) header.hidden = !state.showStageGlobalHeader
    if (editor) editor.classList.toggle('is-header-hidden', !state.showStageGlobalHeader)
  })
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && state.stageAppMenuOpen) { state.stageAppMenuOpen = false; updateStageAppMenu() } })
}
async function loadDashboardProjects() { if (!state.user?.uid || state.projectId) return; state.loadingProjects = true; state.projectsError = ''; renderApp(); try { const projects = await listAccessibleStageProjects(state.user.uid); const sorted = [...projects].sort(sortStageProjectsByActivity); state.projects = sorted; state.recentProjects = sorted.slice(0, 6) } catch { state.projects = []; state.recentProjects = []; state.projectsError = 'load-failed' } finally { state.loadingProjects = false; renderApp() } }
async function loadEditorProject() { if (!state.projectId) return; state.editorLoading = true; state.editorError = ''; renderApp(); try { const project = await getStageProject(state.projectId); if (!project) state.editorError = 'not-found'; else state.editorProject = project } catch { state.editorError = 'fetch-failed' } finally { state.editorLoading = false; renderApp() } }

state.projectId = getCurrentStageProjectId()
waitForInitialAuthState().then(async (user) => { state.user = user; renderApp(); if (state.projectId) await loadEditorProject(); else await loadDashboardProjects() })
subscribeToAuthState(async (user) => { state.user = user; if (!state.projectId) { state.projects = []; state.recentProjects = [] } renderApp(); if (!state.projectId) await loadDashboardProjects() })
