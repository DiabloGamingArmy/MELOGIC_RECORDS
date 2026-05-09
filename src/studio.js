import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, studioProjectRoute } from './utils/routes'
import { createStudioProject, listAccessibleStudioProjects, listIndexedStudioProjects, sortProjectsByActivity, touchStudioProject } from './data/studioProjectService'
import { studioSidebar } from './components/studioShell'
import { initStudioBrandLogo } from './components/studioBrandLogo'

// TODO: replace Explore items with featured demos/templates once Studio demo data exists.
// TODO: render real recent projects once save/recall is implemented.
// TODO: render project folders/files from Firestore/Storage.
const exploreItems = [
  { title: 'WILDFLOWER', artist: 'Billie Eilish', year: '2024' },
  { title: 'Blinding Lights', artist: 'The Weeknd', year: '2019' },
  { title: 'As It Was', artist: 'Harry Styles', year: '2022' },
  { title: 'bad guy', artist: 'Billie Eilish', year: '2019' }
]

const app = document.querySelector('#app')
const state = { user: null, creating: false, createError: '', projects: [], recentProjects: [], loadingProjects: false, projectsError: '' }
const fmtDate = (p) => (p.lastOpenedAt?.toDate?.() || p.updatedAt?.toDate?.() || p.createdAt?.toDate?.() || new Date()).toLocaleDateString()
const icon = (name) => {
  const c = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
  return name === 'plus' ? `<svg ${c}><path d="M12 5v14"/><path d="M5 12h14"/></svg>` : `<svg ${c}><path d="M18 21a6 6 0 0 0-12 0"/><circle cx="12" cy="7" r="4"/></svg>`
}

function renderRecent() {
  if (!state.recentProjects.length) return '<p class="studio-recents-empty">Recent projects will appear here once you open a project.</p>'
  return `<div class="studio-recent-list">${state.recentProjects.map((p) => `<button class="studio-recent-item" data-open-project="${p.id}"><strong>${p.title}</strong><span>${p.bpm} BPM • ${p.key} • ${fmtDate(p)}</span></button>`).join('')}</div>`
}
function renderProjectArea() {
  if (state.loadingProjects) return '<p class="studio-recents-empty">Loading projects...</p>'
  if (state.projectsError) return `<p class="studio-recents-empty">${state.projectsError}</p>`
  if (!state.projects.length) return '<div class="studio-projects-empty"><p class="studio-projects-empty-title">No project files yet.</p><p>Create a project, folder, or import sounds to start building.</p></div>'
  return `<div class="studio-project-grid">${state.projects.map((p) => `<article class="studio-project-row"><button class="studio-project-open" data-open-project="${p.id}"><h4>${p.title}</h4><p>${p.bpm} BPM • ${p.key} • ${p.type}</p><small>${fmtDate(p)}</small></button><span class="studio-badge">${state.user?.uid === p.ownerId ? 'Owner' : 'Shared'}</span></article>`).join('')}</div>`
}

function renderShell() {
  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'projects' })}<section class="studio-main"><div class="studio-top-actions"><a class="studio-action-button" data-action="new-project" data-new-project href="${state.user ? '#' : authRoute({ redirect: ROUTES.studio })}">NEW PROJECT <span>${icon('plus')}</span></a><a class="studio-action-button" data-action="start-collab" href="${state.user ? '#' : authRoute({ redirect: ROUTES.studio })}">START COLLAB <span>${icon('user')}</span></a></div><div class="studio-section-heading"><h2>EXPLORE</h2><span class="studio-section-line studio-section-line--explore"></span></div><div class="studio-explore-row">${exploreItems.map((item) => `<article class="studio-explore-card"><div class="studio-cover-placeholder"></div><div class="studio-explore-copy"><h3 class="studio-explore-title">${item.title}</h3><p>${item.artist}</p><p>${item.year}</p></div></article>`).join('')}</div><div class="studio-section-heading"><h2>RECENTS</h2><span class="studio-section-line studio-section-line--recents"></span></div>${renderRecent()}<div class="studio-section-heading"><h2>PROJECTS</h2><span class="studio-section-line studio-section-line--projects"></span></div><section class="studio-projects-panel"><header class="studio-projects-toolbar"><button class="studio-folder-button" type="button">NEW FOLDER</button></header><div class="studio-projects-body">${renderProjectArea()}</div></section><div data-studio-modal-root></div></section></section></main>`
  initShellChrome(); initStudioBrandLogo(); bind()
}

async function loadStudioProjects() {
  if (!state.user?.uid) return
  state.loadingProjects = true; renderShell()
  const [indexedResult, accessibleResult] = await Promise.allSettled([
    listIndexedStudioProjects(state.user.uid),
    listAccessibleStudioProjects(state.user.uid)
  ])
  const projects = []
  if (indexedResult.status === 'fulfilled') projects.push(...indexedResult.value)
  else console.error('[studio] indexed project query failed', indexedResult.reason)
  if (accessibleResult.status === 'fulfilled') projects.push(...accessibleResult.value)
  else console.error('[studio] accessible project query failed', accessibleResult.reason)
  const merged = new Map(); projects.forEach((project) => project?.id && merged.set(project.id, project))
  const deduped = [...merged.values()].sort(sortProjectsByActivity)
  if (deduped.length || indexedResult.status === 'fulfilled' || accessibleResult.status === 'fulfilled') {
    state.projects = deduped
    state.recentProjects = deduped.slice(0, 6)
    state.projectsError = ''
  } else {
    state.projects = []
    state.recentProjects = []
    state.projectsError = 'Could not load Studio projects.'
  }
  state.loadingProjects = false; renderShell()
}

function openProject(projectId) { touchStudioProject(projectId).catch(() => {}); window.location.href = studioProjectRoute(projectId) }

function renderModal(loading = false) {
  const root = app.querySelector('[data-studio-modal-root]'); if (!root) return
  if (loading) { root.innerHTML = '<div class="studio-modal"><div class="studio-modal-panel"><h3>Loading project...</h3></div></div>'; return }
  root.innerHTML = `<div class="studio-modal" data-modal-backdrop><form class="studio-modal-panel" data-create-form><h3>New Project</h3><div class="studio-modal-field"><label for="studio-project-name">Project name</label><input id="studio-project-name" name="title" maxlength="120" placeholder="Name your project" required /></div>${state.createError ? `<p class="studio-form-error">${state.createError}</p>` : ''}<div class="studio-modal-actions"><button class="button" type="submit">Create Project</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKeydown) }
  const onKeydown = (e) => e.key === 'Escape' && close(); document.addEventListener('keydown', onKeydown)
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (e) => e.target === e.currentTarget && close())
  root.querySelector('[data-close-modal]')?.addEventListener('click', close)
  root.querySelector('[data-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault(); state.createError = ''; renderModal(true)
    try { const title = new FormData(e.currentTarget).get('title'); const project = await createStudioProject(state.user, { title }); window.location.href = studioProjectRoute(project.id) }
    catch (error) { console.error('[studio]', error); state.createError = 'Could not create project right now.'; renderModal(false) }
  })
}

function bind() {
  app.querySelector('[data-new-project]')?.addEventListener('click', (e) => { if (!state.user) return; e.preventDefault(); renderModal(false) })
  app.querySelectorAll('[data-open-project]').forEach((el) => el.addEventListener('click', () => openProject(el.dataset.openProject)))
}

waitForInitialAuthState().then(async (user) => { state.user = user; renderShell(); await loadStudioProjects() })
subscribeToAuthState(async (user) => { state.user = user; app.querySelector('[data-new-project]')?.setAttribute('href', user ? '#' : authRoute({ redirect: ROUTES.studio })); await loadStudioProjects() })
