import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute } from './utils/routes'
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
const editorRailItems = ['Home', 'Object', 'Scene', 'Lighting', 'Rigging', 'Audio', 'Video', 'Venue', 'Settings', 'Help']
const editorLibraryCategories = [
  { key: 'band-backline', label: 'Band / Backline', icon: '✦', select: 'drum-riser' },
  { key: 'lighting', label: 'Lighting', icon: '◉', select: 'moving-head' },
  { key: 'rigging', label: 'Rigging', icon: '⛓', select: 'truss-a' },
  { key: 'audio', label: 'Audio', icon: '◌', select: 'speaker-left' },
  { key: 'video', label: 'Video', icon: '▻', select: 'camera-1' },
  { key: 'venue', label: 'Venue', icon: '▦', select: 'stage-deck' },
  { key: 'patching', label: 'Patching', icon: '⌁', select: 'stage-deck' },
  { key: 'cases', label: 'Cases', icon: '▣', select: 'stage-deck' }
]
const baseStageTypes = ['Small Club', 'Festival', 'Church', 'School Auditorium', 'Custom']
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

const state = { user: null, loadingProjects: false, projectsError: '', projects: [], recentProjects: [], projectId: '', editorLoading: false, editorError: '', editorProject: null, createError: '', selectedStageType: 'Blank Stage', activeEditorMode: 'builder', activeLibraryCategory: 'band-backline', selectedEditorObject: 'stage-deck', editorObjectTransforms: {} }
let cleanupStageViewport = null

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

function renderEditor() { /* unchanged behavior */
  if (state.editorLoading) return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Opening stage plan...</h2><p>Loading project workspace.</p><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  if (state.editorError === 'not-found') return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Stage plan not found.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  if (state.editorError) return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Could not open this stage plan.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  const selected = editorMockObjects.find((o) => o.key === state.selectedEditorObject) || editorMockObjects[0]
  const detailRows = Object.entries(selected.details || {}).map(([k, v]) => `<p><strong>${k}:</strong> ${v}</p>`).join('')
  const modeBody = state.activeEditorMode === 'stage-plot' ? '<section class="stage-editor-mode-panel"><h4>2D Stage Plot</h4><div class="stage-mode-large"></div></section>'
    : state.activeEditorMode === 'input-list' ? '<section class="stage-editor-table-panel is-large"><h4>Auto-Generated Input List</h4><table><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Notes</th></tr></thead><tbody><tr><td>✓</td><td>1</td><td>Kick In</td><td>Beta 91A</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>2</td><td>Kick Out</td><td>Beta 52</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>3</td><td>Snare Top</td><td>SM57</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>8</td><td>Bass DI</td><td>DI</td><td>N/A</td><td>USC</td></tr><tr><td>✓</td><td>12</td><td>Lead Voc</td><td>Wireless</td><td>N/A</td><td>DSC</td></tr><tr><td>✓</td><td>21</td><td>Playback L</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr><tr><td>✓</td><td>22</td><td>Playback R</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr></tbody></table></section>'
      : state.activeEditorMode === 'lighting-plot' ? '<section class="stage-editor-mode-panel"><h4>Lighting Plot Schematic</h4><div class="stage-mode-large lighting"></div></section>'
        : state.activeEditorMode === 'rigging-plan' ? '<section class="stage-editor-mode-panel"><h4>Rigging Plan</h4><ul><li>Ground support verified</li><li>Point load check pending</li><li>Qualified personnel assigned</li></ul></section>'
          : '<div class="stage-editor-bottom-grid"><section class="stage-editor-table-panel"><h4>Auto-Generated Input List</h4><table><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Notes</th></tr></thead><tbody><tr><td>✓</td><td>1</td><td>Kick In</td><td>Beta 91A</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>2</td><td>Kick Out</td><td>Beta 52</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>3</td><td>Snare Top</td><td>SM57</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>8</td><td>Bass DI</td><td>DI</td><td>N/A</td><td>USC</td></tr><tr><td>✓</td><td>12</td><td>Lead Voc</td><td>Wireless</td><td>N/A</td><td>DSC</td></tr><tr><td>✓</td><td>21</td><td>Playback L</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr><tr><td>✓</td><td>22</td><td>Playback R</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr></tbody></table></section><section class="stage-editor-mini-panels"><article><h5>2D Stage Plot Mode</h5><div aria-hidden="true"></div></article><article><h5>Lighting Plot Schematic</h5><div aria-hidden="true"></div></article></section></div>'
  return `<main class="stage-editor-app"><section class="stage-editor-menubar"><div class="stage-editor-menu-left"><strong>MELOGIC STAGE</strong><button type="button">File</button><button type="button">Edit</button><button type="button">View</button><button type="button">Share</button></div><div class="stage-editor-project-title"><h2>Project: ${title}</h2><p>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><button type="button" aria-disabled="true">Share ▾</button><button type="button" aria-disabled="true">?</button><button type="button" aria-disabled="true">⋯</button><button type="button" class="is-send" aria-disabled="true">Send Stage Plan</button></div></section><section class="stage-editor-body"><nav class="stage-editor-rail" aria-label="Editor tools">${editorRailItems.map((item, i) => `<button type="button" class="${i === 1 ? 'is-active' : ''}">${item}</button>`).join('')}<a class="stage-back-link" href="${ROUTES.stage}">Exit</a></nav><aside class="stage-editor-library"><header><h3>OBJECT LIBRARY</h3></header><div class="stage-editor-library-tools"><input aria-label="Search object library" placeholder="Search" /><button type="button" aria-disabled="true">⌯</button></div><label class="stage-editor-check"><input type="checkbox" /> Drag and drop categories</label><h4>BAND / BACKLINE</h4><div class="stage-object-grid">${editorLibraryCategories.map((c) => `<button class="stage-object-tile ${state.activeLibraryCategory === c.key ? 'is-active' : ''}" data-library-category="${c.key}" data-select-object="${c.select}" type="button"><span class="stage-object-icon">${c.icon}</span><small>${c.label}</small></button>`).join('')}</div><h4>BASE STAGE TYPES</h4><div class="stage-base-stage-grid">${baseStageTypes.map((s) => `<button class="stage-base-stage-card" type="button" aria-disabled="true">${s}</button>`).join('')}</div></aside><section class="stage-editor-workspace"><div class="stage-editor-viewport"><header class="stage-editor-viewport-toolbar"><span>${state.editorProject?.stageType || 'Blank Stage'}</span><button type="button" class="is-beam" aria-pressed="true">Beam Preview</button><button type="button" aria-disabled="true">Grid</button><button type="button" aria-disabled="true">Snap</button></header><div class="stage-editor-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-three-hud-label">Blank Stage</div><div class="stage-three-hint">Orbit: drag • Pan: right-drag • Zoom: wheel • Nudge: arrows/PageUp/PageDown</div></div></div></section><aside class="stage-editor-right"><section class="stage-config-panel"><h3>Fixture Configuration</h3><div class="stage-readout"><p><strong>Selected:</strong> ${selected.label}</p><p><strong>Type:</strong> ${selected.type}</p>${detailRows}${selected.key === 'moving-head' ? '<p><strong>Fixture:</strong> Moving Head</p><p><strong>DMX Address:</strong> 60IUUI</p><p><strong>Mode:</strong> 24ch</p><p><strong>Color:</strong> Cyan</p><p><strong>Beam Angle:</strong> 15-45°</p><input type="range" disabled />' : ''}</div></section><section class="stage-ai-panel"><h3>AI Assistant</h3><textarea aria-label="AI prompt" placeholder="Build me a 24x16 stage for a 5-piece metalcore band with tracks and lighting."></textarea><button type="button" aria-disabled="true">Generate</button></section><section class="stage-config-panel"><h3>Rigging Notes</h3><p>Qualified personnel approved for hangs.</p></section><section class="stage-config-panel"><h3>Project Info</h3><p>${title}</p><p>${state.editorProject?.stageType || 'Blank Stage'}</p><p>Category: ${editorLibraryCategories.find((c) => c.key === state.activeLibraryCategory)?.label || 'Band / Backline'}</p><p>Status: Foundation Preview</p></section></aside><section class="stage-editor-bottom"><div class="stage-editor-mode-tabs">${editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')}</div>${modeBody}</section></section></main>`
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
    onSelectObject: (key) => { state.selectedEditorObject = key; renderApp() },
    onTransformObject: (key, transform) => { state.editorObjectTransforms = { ...(state.editorObjectTransforms || {}), [key]: transform } }
  })
}

function renderApp() { app.innerHTML = `${navShell({ currentPage: 'stage' })}${state.projectId ? renderEditor() : renderDashboard()}`; initShellChrome(); bindEvents(); if (state.projectId) initStageEditorViewport(); else { cleanupStageViewport?.(); cleanupStageViewport = null } }
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
function bindEvents() {
  app.querySelectorAll('[data-new-stage-plan]').forEach((el) => el.addEventListener('click', (e) => { if (!state.user) return; e.preventDefault(); renderCreateModal(false, state.selectedStageType || 'Blank Stage') }))
  app.querySelectorAll('[data-use-template]').forEach((el) => el.addEventListener('click', () => { if (!state.user) { window.location.href = authRoute({ redirect: ROUTES.stage }); return } state.selectedStageType = el.dataset.useTemplate || 'Blank Stage'; renderCreateModal(false, state.selectedStageType) }))
  app.querySelectorAll('[data-open-project]').forEach((el) => el.addEventListener('click', () => openProject(el.dataset.openProject || '')))
  app.querySelector('[data-retry-stage-projects]')?.addEventListener('click', () => loadDashboardProjects())
  app.querySelectorAll('[data-editor-mode]').forEach((el) => el.addEventListener('click', () => { state.activeEditorMode = el.dataset.editorMode || 'builder'; renderApp() }))
  app.querySelectorAll('[data-library-category]').forEach((el) => el.addEventListener('click', () => { state.activeLibraryCategory = el.dataset.libraryCategory || 'band-backline'; const target = el.dataset.selectObject; if (target) state.selectedEditorObject = target; renderApp() }))
  app.querySelectorAll('[data-editor-object]').forEach((el) => el.addEventListener('click', () => { state.selectedEditorObject = el.dataset.editorObject || 'stage-deck'; renderApp() }))
}

async function loadDashboardProjects() { if (!state.user?.uid || state.projectId) return; state.loadingProjects = true; state.projectsError = ''; renderApp(); try { const projects = await listAccessibleStageProjects(state.user.uid); const sorted = [...projects].sort(sortStageProjectsByActivity); state.projects = sorted; state.recentProjects = sorted.slice(0, 6) } catch { state.projects = []; state.recentProjects = []; state.projectsError = 'load-failed' } finally { state.loadingProjects = false; renderApp() } }
async function loadEditorProject() { if (!state.projectId) return; state.editorLoading = true; state.editorError = ''; renderApp(); try { const project = await getStageProject(state.projectId); if (!project) state.editorError = 'not-found'; else state.editorProject = project } catch { state.editorError = 'fetch-failed' } finally { state.editorLoading = false; renderApp() } }

state.projectId = getCurrentStageProjectId()
waitForInitialAuthState().then(async (user) => { state.user = user; renderApp(); if (state.projectId) await loadEditorProject(); else await loadDashboardProjects() })
subscribeToAuthState(async (user) => { state.user = user; if (!state.projectId) { state.projects = []; state.recentProjects = [] } renderApp(); if (!state.projectId) await loadDashboardProjects() })
