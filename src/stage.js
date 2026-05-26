import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute } from './utils/routes'
import { createStageProject, getStageProject, listAccessibleStageProjects, sortStageProjectsByActivity, touchStageProject } from './data/stageProjectService'

const app = document.querySelector('#app')
const sidebarItems = ['My Projects', 'Templates', 'Asset Library', 'Shared With Me', 'Exports', 'Learn']
const stageTypes = ['Blank Stage', 'Small Club', 'Festival', 'Worship/Church', 'Livestream Room', 'School Auditorium']
const templateCards = [
  { key: 'small-club', title: 'Small Club', subtitle: 'Quick-start layout', type: 'Small Club', icon: 'club' },
  { key: 'festival-stage', title: 'Festival Stage', subtitle: 'Quick-start layout', type: 'Festival', icon: 'festival' },
  { key: 'worship-stage', title: 'Worship Stage', subtitle: 'Quick-start layout', type: 'Worship/Church', icon: 'worship' },
  { key: 'livestream-room', title: 'Livestream Room', subtitle: 'Quick-start layout', type: 'Livestream Room', icon: 'livestream' }
]

const state = { user: null, loadingProjects: false, projectsError: '', projects: [], recentProjects: [], projectId: '', editorLoading: false, editorError: '', editorProject: null, createError: '', selectedStageType: 'Blank Stage' }

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
  if (!state.user) return '<div class="stage-empty-panel"><p>Sign in to view recently modified projects.</p></div>'
  if (state.loadingProjects) return '<p class="stage-recents-empty">Loading recent stage plans...</p>'
  if (!state.recentProjects.length) return '<p class="stage-recents-empty">Recent stage plans will appear here once you open a project.</p>'
  return `<div class="stage-recent-grid">${state.recentProjects.slice(0, 4).map((p) => projectCard(p, true)).join('')}</div>`
}
function renderProjectsArea() {
  if (!state.user) return `<div class="stage-empty-panel"><p>Sign in to create and manage stage plans.</p><a class="stage-signin-button" href="${authRoute({ redirect: ROUTES.stage })}">Sign In / Sign Up</a></div>`
  if (state.loadingProjects) return '<p class="stage-recents-empty">Loading stage plans...</p>'
  if (state.projectsError) return `<div class="stage-warning-panel"><p>We could not load your stage plans right now.</p><p>You can still create a new plan, or refresh this page.</p><div class="stage-warning-actions"><button class="stage-inline-button" data-new-stage-plan type="button">New Stage Plan</button><button class="stage-inline-button is-muted" data-retry-stage-projects type="button">Retry</button></div></div>`
  if (!state.projects.length) return '<div class="stage-empty-panel"><p>No stage plans yet.</p><p>Create your first stage plan or start from a template.</p><button class="stage-inline-button" data-new-stage-plan type="button">New Stage Plan</button></div>'
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
  return `<main class="stage-page"><section class="stage-shell"><aside class="stage-sidebar"><header class="stage-sidebar-header"><p class="stage-sidebar-kicker">Melogic Workspace</p><h1>STAGE</h1><span class="stage-sidebar-line" aria-hidden="true"></span></header></aside><section class="stage-main"><header class="stage-topbar"><div class="stage-plan-meta"><h2>${title}</h2><span class="stage-pill">Foundation Preview</span></div><div class="stage-top-actions"><a class="stage-back-link" href="${ROUTES.stage}">Back to Stage Projects</a></div></header><div class="stage-workgrid"><section class="stage-viewport-panel"><header class="stage-panel-header"><h3>Viewport</h3><p>3D interaction layer is planned next. This is visual structure only.</p></header><div class="stage-viewport" role="img" aria-label="Mock stage planning viewport"></div></section><aside class="stage-inspector"><header class="stage-panel-header"><h3>Inspector</h3><p>Selection details</p></header><dl class="stage-inspector-grid"><div><dt>Project</dt><dd>${title}</dd></div><div><dt>Stage Type</dt><dd>${state.editorProject?.stageType || 'Blank Stage'}</dd></div></dl></aside></div></section></section></main>`
}

function renderApp() { app.innerHTML = `${navShell({ currentPage: 'stage' })}${state.projectId ? renderEditor() : renderDashboard()}`; initShellChrome(); bindEvents() }
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
}

async function loadDashboardProjects() { if (!state.user?.uid || state.projectId) return; state.loadingProjects = true; state.projectsError = ''; renderApp(); try { const projects = await listAccessibleStageProjects(state.user.uid); const sorted = [...projects].sort(sortStageProjectsByActivity); state.projects = sorted; state.recentProjects = sorted.slice(0, 6) } catch { state.projects = []; state.recentProjects = []; state.projectsError = 'load-failed' } finally { state.loadingProjects = false; renderApp() } }
async function loadEditorProject() { if (!state.projectId) return; state.editorLoading = true; state.editorError = ''; renderApp(); try { const project = await getStageProject(state.projectId); if (!project) state.editorError = 'not-found'; else state.editorProject = project } catch { state.editorError = 'fetch-failed' } finally { state.editorLoading = false; renderApp() } }

state.projectId = getCurrentStageProjectId()
waitForInitialAuthState().then(async (user) => { state.user = user; renderApp(); if (state.projectId) await loadEditorProject(); else await loadDashboardProjects() })
subscribeToAuthState(async (user) => { state.user = user; if (!state.projectId) { state.projects = []; state.recentProjects = [] } renderApp(); if (!state.projectId) await loadDashboardProjects() })
