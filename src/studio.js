import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, studioProjectRoute } from './utils/routes'
import { createStudioProject } from './data/studioProjectService'
import { studioSidebar } from './components/studioShell'
import { initStudioBrandLogo } from './components/studioBrandLogo'

// TODO: replace exploreItems with fetched featured/demo projects
const exploreItems = [
  { title: 'WILDFLOWER', artist: 'Billie Eilish', year: '2024' },
  { title: 'Blinding Lights', artist: 'The Weeknd', year: '2019' },
  { title: 'As It Was', artist: 'Harry Styles', year: '2022' },
  { title: 'bad guy', artist: 'Billie Eilish', year: '2019' }
]

const app = document.querySelector('#app')
const state = { user: null, creating: false, createError: '' }

function icon(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
  const icons = {
    plus: `<svg ${common}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
    user: `<svg ${common}><path d="M18 21a6 6 0 0 0-12 0"/><circle cx="12" cy="7" r="4"/></svg>`,
    search: `<svg ${common}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`,
    sliders: `<svg ${common}><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/></svg>`,
    more: `<svg ${common}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`
  }
  return icons[name]
}

function renderShell() {
  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'projects' })}<section class="studio-main"><div class="studio-top-actions"><a class="studio-action-button" data-action="new-project" data-new-project href="${state.user ? '#' : authRoute({ redirect: ROUTES.studio })}">NEW PROJECT <span>${icon('plus')}</span></a><a class="studio-action-button" data-action="start-collab" href="${state.user ? '#' : authRoute({ redirect: ROUTES.studio })}">START COLLAB <span>${icon('user')}</span></a></div><div class="studio-section-heading"><h2>EXPLORE</h2><span class="studio-section-line studio-section-line--explore"></span></div><div class="studio-explore-row">${exploreItems.map((item) => `<article class="studio-explore-card"><div class="studio-cover-placeholder"></div><div class="studio-explore-copy"><h3 class="studio-explore-title">${item.title}</h3><p>${item.artist}</p><p>${item.year}</p></div></article>`).join('')}</div><div class="studio-section-heading"><h2>RECENTS</h2><span class="studio-section-line studio-section-line--recents"></span></div><p class="studio-recents-empty">Recent projects will appear here once project saving is active.</p><div class="studio-section-heading"><h2>PROJECTS</h2><span class="studio-section-line studio-section-line--projects"></span></div><section class="studio-projects-panel"><header class="studio-projects-toolbar"><button class="studio-folder-button" type="button">NEW FOLDER</button><button class="studio-toolbar-icon" type="button" aria-label="Search">${icon('search')}</button><button class="studio-toolbar-icon" type="button" aria-label="Filters">${icon('sliders')}</button><button class="studio-toolbar-icon" type="button" aria-label="More">${icon('more')}</button></header><div class="studio-projects-body"><div class="studio-projects-empty"><p class="studio-projects-empty-title">No project files yet.</p><p>Create a project, folder, or import sounds to start building.</p></div></div></section><div data-studio-modal-root></div></section></section></main>`
  initShellChrome()
  initStudioBrandLogo()
  bind()
}

function renderModal() {
  const root = app.querySelector('[data-studio-modal-root]')
  if (!root) return
  root.innerHTML = `<div class="studio-modal" data-modal-backdrop><form class="studio-modal-panel" data-create-form><h3>New Project</h3><div class="studio-modal-field"><label for="studio-project-name">Project name</label><input id="studio-project-name" name="title" maxlength="120" placeholder="Name your project" required /></div>${state.createError ? `<p class="studio-form-error">${state.createError}</p>` : ''}<div class="studio-modal-actions"><button class="button" type="submit" ${state.creating ? 'disabled' : ''}>Create Project</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKeydown) }
  const onKeydown = (event) => { if (event.key === 'Escape') close() }
  document.addEventListener('keydown', onKeydown)
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) close() })
  root.querySelector('[data-close-modal]')?.addEventListener('click', close)
  root.querySelector('[data-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    try { state.creating = true; state.createError = ''; renderModal(); const title = new FormData(e.currentTarget).get('title'); const project = await createStudioProject(state.user, { title }); window.location.href = studioProjectRoute(project.id) }
    catch (error) { console.error('[studio]', error); state.creating = false; state.createError = 'Could not create project right now.'; renderModal() }
  })
}

function bind() {
  app.querySelector('[data-new-project]')?.addEventListener('click', (e) => { if (!state.user) return; e.preventDefault(); renderModal() })
}

waitForInitialAuthState().then((user) => { state.user = user; renderShell() })
subscribeToAuthState((user) => { state.user = user; app.querySelector('[data-new-project]')?.setAttribute('href', user ? '#' : authRoute({ redirect: ROUTES.studio })) })
