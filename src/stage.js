import './styles/base.css'
import './styles/stage.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute } from './utils/routes'
import { createStageProject, getStageProject, listAccessibleStageProjects, sortStageProjectsByActivity, touchStageProject } from './data/stageProjectService'

const app = document.querySelector('#app')
const sidebarItems = ['Projects', 'Templates', 'Asset Library', 'Shared With Me', 'Exports', 'Learn']
const stageTypes = ['Blank Stage', 'Small Club', 'Festival', 'Worship/Church', 'Livestream Room', 'School Auditorium']
const templateCards = ['Small Club', 'Festival Stage', 'Worship Stage', 'Livestream Room']

const state = {
  user: null,
  loadingProjects: false,
  projectsError: '',
  projects: [],
  recentProjects: [],
  projectId: '',
  editorLoading: false,
  editorError: '',
  editorProject: null,
  createError: ''
}

function getCurrentStageProjectId() {
  const path = window.location.pathname || ''
  if (!path.startsWith('/stage/')) return ''
  return decodeURIComponent(path.replace('/stage/', '').split('/')[0] || '').trim()
}

function fmtDate(project) {
  const date = project?.lastOpenedAt?.toDate?.() || project?.updatedAt?.toDate?.() || project?.createdAt?.toDate?.()
  return date ? date.toLocaleDateString() : 'No activity yet'
}

function renderRecent() {
  if (!state.user) return '<p class="stage-recents-empty">Sign in to view your recent stage plans.</p>'
  if (state.loadingProjects) return '<p class="stage-recents-empty">Loading recents...</p>'
  if (state.projectsError) return `<p class="stage-recents-empty">${state.projectsError}</p>`
  if (!state.recentProjects.length) return '<p class="stage-recents-empty">Recent stage plans will appear here once you open a project.</p>'
  return `<div class="stage-recents-list">${state.recentProjects.map((project) => `<button class="stage-project-row" data-open-project="${project.id}" type="button" aria-label="Open stage plan ${project.title}"><strong>${project.title}</strong><span>${project.stageType || 'Blank Stage'} • ${fmtDate(project)}</span></button>`).join('')}</div>`
}

function renderProjectsArea() {
  if (!state.user) {
    return `<div class="stage-projects-empty"><p>Sign in to create and manage stage plans.</p><a class="stage-signin-button" href="${authRoute({ redirect: ROUTES.stage })}">Sign In / Sign Up</a></div>`
  }
  if (state.loadingProjects) return '<p class="stage-recents-empty">Loading stage plans...</p>'
  if (state.projectsError) return `<p class="stage-recents-empty">${state.projectsError}</p>`
  if (!state.projects.length) return '<p class="stage-recents-empty">No stage plans yet. Create one to start building.</p>'
  return `<div class="stage-project-grid">${state.projects.map((project) => `<article><button class="stage-project-row" data-open-project="${project.id}" type="button" aria-label="Open stage plan ${project.title}"><strong>${project.title}</strong><span>${project.stageType || 'Blank Stage'} • ${fmtDate(project)}</span></button></article>`).join('')}</div>`
}

function renderDashboard() {
  return `<main class="stage-dashboard-page"><section class="stage-dashboard-shell"><aside class="stage-dashboard-sidebar"><header><p class="stage-sidebar-kicker">Workspace</p><h1>MELOGIC STAGE</h1></header><nav class="stage-dashboard-nav" aria-label="Stage dashboard sections">${sidebarItems.map((item) => `<button class="stage-dashboard-nav-item ${item === 'Projects' ? 'is-active' : ''}" type="button" ${item === 'Projects' ? 'aria-current="page"' : ''}>${item}</button>`).join('')}</nav></aside><section class="stage-dashboard-main"><header class="stage-dashboard-actions"><a class="stage-action-button" data-new-stage-plan href="${state.user ? '#' : authRoute({ redirect: ROUTES.stage })}">NEW STAGE PLAN</a><a class="stage-action-button is-disabled" aria-disabled="true" href="${state.user ? '#' : authRoute({ redirect: ROUTES.stage })}">START FROM TEMPLATE <small>Coming soon</small></a></header><section class="stage-dashboard-hero"><h2>Design the show before load-in.</h2><p>Build stage plots, lighting concepts, camera layouts, input lists, and rigging notes before the first case rolls through the door.</p></section><section><div class="stage-section-heading"><h3>Templates</h3><span></span></div><div class="stage-template-row">${templateCards.map((card) => `<article class="stage-template-card"><h4>${card}</h4><p>Quick-start layout</p></article>`).join('')}</div></section><section><div class="stage-section-heading"><h3>Recents</h3><span></span></div>${renderRecent()}</section><section class="stage-projects-panel"><div class="stage-section-heading"><h3>Projects</h3><span></span></div>${renderProjectsArea()}</section><div data-stage-modal-root></div></section></section></main>`
}

function renderEditor() {
  if (state.editorLoading) {
    return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Opening stage plan...</h2><p>Loading project workspace.</p><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  }
  if (state.editorError === 'not-found') {
    return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Stage plan not found.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  }
  if (state.editorError) {
    return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>Could not open this stage plan.</h2><a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
  }

  const title = state.editorProject?.title || 'Untitled Stage Plan'
  return `<main class="stage-page"><section class="stage-shell"><aside class="stage-sidebar"><header class="stage-sidebar-header"><p class="stage-sidebar-kicker">Melogic Workspace</p><h1>STAGE</h1><span class="stage-sidebar-line" aria-hidden="true"></span></header></aside><section class="stage-main"><header class="stage-topbar"><div class="stage-plan-meta"><h2>${title}</h2><span class="stage-pill">Foundation Preview</span></div><div class="stage-top-actions"><a class="stage-back-link" href="${ROUTES.stage}">Back to Stage Projects</a></div></header><div class="stage-workgrid"><section class="stage-viewport-panel"><header class="stage-panel-header"><h3>Viewport</h3><p>3D interaction layer is planned next. This is visual structure only.</p></header><div class="stage-viewport" role="img" aria-label="Mock stage planning viewport"></div></section><aside class="stage-inspector"><header class="stage-panel-header"><h3>Inspector</h3><p>Selection details</p></header><dl class="stage-inspector-grid"><div><dt>Project</dt><dd>${title}</dd></div><div><dt>Stage Type</dt><dd>${state.editorProject?.stageType || 'Blank Stage'}</dd></div></dl></aside></div></section></section></main>`
}

function renderApp() {
  const body = state.projectId ? renderEditor() : renderDashboard()
  app.innerHTML = `${navShell({ currentPage: 'stage' })}${body}`
  initShellChrome()
  bindEvents()
}

function closeModal() {
  const root = app.querySelector('[data-stage-modal-root]')
  if (root) root.innerHTML = ''
  document.removeEventListener('keydown', onModalEscape)
}

function onModalEscape(event) {
  if (event.key === 'Escape') closeModal()
}

function renderCreateModal(loading = false) {
  const root = app.querySelector('[data-stage-modal-root]')
  if (!root) return
  if (loading) {
    root.innerHTML = '<div class="stage-modal"><div class="stage-modal-panel"><h3>Creating stage plan...</h3></div></div>'
    return
  }
  root.innerHTML = `<div class="stage-modal" data-modal-backdrop><form class="stage-modal-panel" data-stage-create-form><h3>New Stage Plan</h3><div class="stage-modal-field"><label for="stage-project-name">Project name</label><input id="stage-project-name" name="title" required maxlength="120" placeholder="Name your stage plan" /></div><div class="stage-modal-field"><label for="stage-type">Stage type</label><select id="stage-type" name="stageType">${stageTypes.map((type) => `<option value="${type}">${type}</option>`).join('')}</select></div>${state.createError ? `<p class="stage-form-error">${state.createError}</p>` : ''}<div class="stage-modal-actions"><button class="button" type="submit">Create Stage Plan</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  document.addEventListener('keydown', onModalEscape)

  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeModal()
  })
  root.querySelector('[data-close-modal]')?.addEventListener('click', closeModal)
  root.querySelector('[data-stage-create-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    state.createError = ''
    renderCreateModal(true)
    try {
      const formData = new FormData(event.currentTarget)
      const title = formData.get('title')
      const stageType = formData.get('stageType')
      const project = await createStageProject(state.user, { title, stageType })
      window.location.href = stageProjectRoute(project.id)
    } catch (error) {
      console.error('[stage] create project failed', error)
      state.createError = 'Could not create stage plan right now.'
      renderCreateModal(false)
    }
  })
}

async function openProject(projectId) {
  if (!projectId) return
  touchStageProject(projectId).catch(() => {})
  window.location.href = stageProjectRoute(projectId)
}

function bindEvents() {
  app.querySelector('[data-new-stage-plan]')?.addEventListener('click', (event) => {
    if (!state.user) return
    event.preventDefault()
    renderCreateModal(false)
  })

  app.querySelectorAll('[data-open-project]').forEach((button) => {
    button.addEventListener('click', () => openProject(button.dataset.openProject || ''))
  })
}

async function loadDashboardProjects() {
  if (!state.user?.uid || state.projectId) return
  state.loadingProjects = true
  renderApp()
  try {
    const projects = await listAccessibleStageProjects(state.user.uid)
    const sorted = [...projects].sort(sortStageProjectsByActivity)
    state.projects = sorted
    state.recentProjects = sorted.slice(0, 6)
    state.projectsError = ''
  } catch (error) {
    console.error('[stage] project query failed', error)
    state.projects = []
    state.recentProjects = []
    state.projectsError = 'Could not load Stage projects.'
  } finally {
    state.loadingProjects = false
    renderApp()
  }
}

async function loadEditorProject() {
  if (!state.projectId) return
  state.editorLoading = true
  state.editorError = ''
  renderApp()
  try {
    const project = await getStageProject(state.projectId)
    if (!project) state.editorError = 'not-found'
    else state.editorProject = project
  } catch (error) {
    console.error('[stage] editor load failed', error)
    state.editorError = 'fetch-failed'
  } finally {
    state.editorLoading = false
    renderApp()
  }
}

state.projectId = getCurrentStageProjectId()
waitForInitialAuthState().then(async (user) => {
  state.user = user
  renderApp()
  if (state.projectId) await loadEditorProject()
  else await loadDashboardProjects()
})

subscribeToAuthState(async (user) => {
  state.user = user
  if (!state.projectId) {
    state.projects = []
    state.recentProjects = []
  }
  renderApp()
  if (!state.projectId) await loadDashboardProjects()
})
