import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute } from './utils/routes'
import {
  createStageProject,
  listAccessibleStageProjects,
  listIndexedStageProjects,
  sortStageProjectsByActivity,
  touchStageProject,
  getStageProject
} from './data/stageProjectService'

const app = document.querySelector('#app')
const dashboardMenu = ['Projects', 'Templates', 'Asset Library', 'Shared With Me', 'Exports', 'Learn']
const stageTypes = ['Blank Stage', 'Small Club', 'Festival', 'Worship/Church', 'Livestream Room', 'School Auditorium']
const exploreTiles = ['Small Club Stage', 'Festival Stage', 'Worship Stage', 'Livestream Room']

const state = {
  user: null,
  routeProjectId: '',
  activeProject: null,
  projects: [],
  recentProjects: [],
  loadingProjects: false,
  loadingProject: false,
  projectsError: '',
  projectError: '',
  createError: ''
}

function getStageProjectIdFromPath() {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path === ROUTES.stage) return ''
  if (!path.startsWith(`${ROUTES.stage}/`)) return ''
  return decodeURIComponent(path.slice(`${ROUTES.stage}/`.length).split('/')[0] || '')
}

function renderDashboard() {
  const signedOut = !state.user
  const projectRows = signedOut
    ? `<p class="stage-empty">Sign in to create and manage stage plans.</p><a class="button" href="${authRoute({ redirect: ROUTES.stage })}">Sign In / Sign Up</a>`
    : state.loadingProjects
      ? '<p class="stage-empty">Loading stage projects...</p>'
      : state.projectsError
        ? `<p class="stage-empty">${state.projectsError}</p>`
        : state.projects.length
          ? `<div class="stage-project-grid">${state.projects.map((p) => `<button class="stage-project-card" data-open-project="${p.id}"><strong>${p.title}</strong><span>${p.stage?.width || 32}x${p.stage?.depth || 20} ${p.stage?.unit || 'ft'}</span></button>`).join('')}</div>`
          : '<p class="stage-empty">No stage plans yet. Create your first stage plan to begin.</p>'

  const recentRows = !signedOut && state.recentProjects.length
    ? `<div class="stage-recent-grid">${state.recentProjects.map((p) => `<button class="stage-recent-card" data-open-project="${p.id}"><strong>${p.title}</strong><span>${p.type || 'stage-plan'}</span></button>`).join('')}</div>`
    : '<p class="stage-empty">Recent stage plans will appear here once opened.</p>'

  return `
  <main class="stage-page stage-dashboard-page">
    <section class="stage-shell stage-dashboard-shell">
      <aside class="stage-sidebar stage-dashboard-sidebar">
        <header class="stage-sidebar-header"><p class="stage-sidebar-kicker">Melogic Workspace</p><h1>STAGE</h1><span class="stage-sidebar-line" aria-hidden="true"></span></header>
        <nav class="stage-tool-nav">${dashboardMenu.map((item, i) => `<button type="button" class="stage-tool-link ${i === 0 ? 'is-active' : ''}" ${i === 0 ? 'aria-current="page"' : ''}>${item}</button>`).join('')}</nav>
      </aside>
      <section class="stage-main stage-dashboard-main">
        <header class="stage-topbar">
          <div class="stage-plan-meta"><h2>Stage Projects</h2><span class="stage-pill">Dashboard</span></div>
          <div class="stage-top-actions">
            <a class="stage-action-link" data-new-plan href="${signedOut ? authRoute({ redirect: ROUTES.stage }) : '#'}">NEW STAGE PLAN</a>
            <button type="button" class="stage-action" disabled aria-disabled="true">START FROM TEMPLATE <small>Coming soon</small></button>
          </div>
        </header>

        <section class="stage-panel">
          <h3>Design the show before load-in.</h3>
          <p>Build stage plots, lighting concepts, camera layouts, input lists, and rigging notes before the first case rolls through the door.</p>
          <div class="stage-template-row">${exploreTiles.map((t) => `<article>${t}</article>`).join('')}</div>
        </section>

        <section class="stage-panel"><h3>Recents</h3>${recentRows}</section>
        <section class="stage-panel"><h3>Projects</h3>${projectRows}</section>
        <div data-stage-modal-root></div>
      </section>
    </section>
  </main>`
}

function renderEditorState() {
  if (state.loadingProject) return `<main class="stage-page"><section class="stage-loading">Loading stage plan...</section></main>`
  if (state.projectError) return `<main class="stage-page"><section class="stage-loading"><h2>${state.projectError}</h2><a class="button" href="${ROUTES.stage}">Back to Stage Projects</a></section></main>`

  const p = state.activeProject || { title: 'Untitled Stage Plan', id: state.routeProjectId }
  return `
  <main class="stage-page">
    <section class="stage-shell">
      <aside class="stage-sidebar"><header class="stage-sidebar-header"><p class="stage-sidebar-kicker">Melogic Workspace</p><h1>STAGE</h1><span class="stage-sidebar-line" aria-hidden="true"></span></header></aside>
      <section class="stage-main">
        <header class="stage-topbar"><div class="stage-plan-meta"><h2>${p.title}</h2><span class="stage-pill">Foundation Preview</span></div><div class="stage-top-actions"><a class="stage-back" href="${ROUTES.stage}">Back to Stage Projects</a></div></header>
        <div class="stage-workgrid"><section class="stage-viewport-panel"><header class="stage-panel-header"><h3>Viewport</h3><p>3D interaction layer is planned next. This is visual structure only.</p></header><div class="stage-viewport"><div class="stage-viewport-grid" aria-hidden="true"></div><div class="stage-perspective-lines" aria-hidden="true"></div><div class="stage-deck" aria-hidden="true">Stage Deck</div><div class="stage-riser" aria-hidden="true">Drum Riser</div><div class="stage-truss" aria-hidden="true">Truss A</div><div class="stage-speaker stage-speaker-left" aria-hidden="true">L Main</div><div class="stage-speaker stage-speaker-right" aria-hidden="true">R Main</div><div class="stage-camera" aria-hidden="true">Camera 1</div><div class="stage-light stage-light-a" aria-hidden="true">L1</div><div class="stage-light stage-light-b" aria-hidden="true">L2</div><div class="stage-light stage-light-c" aria-hidden="true">L3</div></div></section><aside class="stage-inspector"><header class="stage-panel-header"><h3>Inspector</h3><p>Selection details</p></header><dl class="stage-inspector-grid"><div><dt>Selected</dt><dd>Stage Deck</dd></div><div><dt>Width</dt><dd>${p.stage?.width || 32} ft</dd></div><div><dt>Depth</dt><dd>${p.stage?.depth || 20} ft</dd></div><div><dt>Height</dt><dd>${p.stage?.height || 4} ft</dd></div><div><dt>Project</dt><dd>${p.id}</dd></div></dl></aside></div>
        <footer class="stage-status-strip"><span>View: Audience perspective</span><span>Grid: 2 ft increments</span><span>Rig set: Truss A baseline</span><span>Safety lines: Visual guide only</span></footer>
      </section>
    </section>
  </main>`
}

function render() {
  app.innerHTML = `${navShell({ currentPage: 'stage' })}${state.routeProjectId ? renderEditorState() : renderDashboard()}`
  initShellChrome()
  bind()
}

async function loadProjects() {
  if (!state.user || state.routeProjectId) return
  state.loadingProjects = true; render()
  const [indexed, accessible] = await Promise.allSettled([listIndexedStageProjects(state.user.uid), listAccessibleStageProjects(state.user.uid)])
  const merged = new Map()
  if (indexed.status === 'fulfilled') indexed.value.forEach((p) => p?.id && merged.set(p.id, p))
  if (accessible.status === 'fulfilled') accessible.value.forEach((p) => p?.id && merged.set(p.id, p))
  state.projects = [...merged.values()].sort(sortStageProjectsByActivity)
  state.recentProjects = state.projects.slice(0, 6)
  state.projectsError = (indexed.status === 'rejected' && accessible.status === 'rejected') ? 'Could not load stage projects.' : ''
  state.loadingProjects = false
  render()
}

async function loadProject(projectId) {
  if (!projectId) return
  state.loadingProject = true; state.projectError = ''; render()
  try {
    const project = await getStageProject(projectId)
    if (!project) state.projectError = 'Stage plan not found.'
    else { state.activeProject = project; touchStageProject(projectId).catch(() => {}) }
  } catch {
    state.projectError = 'Could not open this stage plan.'
  }
  state.loadingProject = false
  render()
}

function openProject(projectId) {
  if (!projectId) return
  touchStageProject(projectId).catch(() => {})
  window.location.href = stageProjectRoute(projectId)
}

function renderCreateModal() {
  const root = app.querySelector('[data-stage-modal-root]'); if (!root) return
  root.innerHTML = `<div class="stage-modal"><form class="stage-modal-panel" data-stage-create-form><h3>New Stage Plan</h3><label>Project name<input name="title" maxlength="120" required placeholder="Name your stage plan" /></label><label>Stage type<select name="stageType">${stageTypes.map((t)=>`<option>${t}</option>`).join('')}</select></label>${state.createError ? `<p class="stage-empty">${state.createError}</p>` : ''}<div class="stage-modal-actions"><button class="button" type="submit">Create Plan</button><button class="button button-muted" type="button" data-close-stage-modal>Cancel</button></div></form></div>`
  root.querySelector('[data-close-stage-modal]')?.addEventListener('click', () => { root.innerHTML = '' })
  root.querySelector('[data-stage-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    try { const project = await createStageProject(state.user, { title: fd.get('title'), stageType: fd.get('stageType') }); window.location.href = stageProjectRoute(project.id) }
    catch { state.createError = 'Could not create stage plan right now.'; renderCreateModal() }
  })
}

function bind() {
  app.querySelectorAll('[data-open-project]').forEach((el) => el.addEventListener('click', () => openProject(el.dataset.openProject)))
  app.querySelector('[data-new-plan]')?.addEventListener('click', (e) => {
    if (!state.user) return
    e.preventDefault()
    renderCreateModal()
  })
}

state.routeProjectId = getStageProjectIdFromPath()
waitForInitialAuthState().then(async (user) => {
  state.user = user
  render()
  if (state.routeProjectId) await loadProject(state.routeProjectId)
  else await loadProjects()
})

subscribeToAuthState(async (user) => {
  state.user = user
  if (!state.routeProjectId) await loadProjects()
})
