import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { getStorageAssetUrl } from './firebase/storageAssets'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, studioProjectRoute } from './utils/routes'
import { createStudioProject } from './data/studioProjectService'
import { studioSidebar } from './components/studioShell'

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
  return name === 'plus'
    ? `<svg ${common}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`
    : `<svg ${common}><path d="M18 21a6 6 0 0 0-12 0"/><circle cx="12" cy="7" r="4"/></svg>`
}

function renderShell() {
  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active: 'projects' })}<section class="studio-main"><div class="studio-top-actions"><a class="studio-action-button studio-action-new" data-new-project href="${state.user ? '#' : authRoute({ redirect: ROUTES.studio })}">NEW PROJECT <span>${icon('plus')}</span></a><a class="studio-action-button studio-action-collab" href="${state.user ? '#' : authRoute({ redirect: ROUTES.studio })}">START COLLAB <span>${icon('user')}</span></a></div><div class="studio-section-heading"><h2>EXPLORE</h2><span class="studio-section-line studio-section-line--explore"></span></div><div class="studio-explore-row">${exploreItems.map((item) => `<article class="studio-explore-card"><div class="studio-cover-placeholder"></div><div class="studio-explore-copy"><h3 class="studio-explore-title">${item.title}</h3><p>${item.artist}</p><p>${item.year}</p></div></article>`).join('')}</div><div class="studio-section-heading"><h2>RECENTS</h2><span class="studio-section-line studio-section-line--recents"></span></div><p class="studio-recents-empty">Recent projects will appear here once project saving is active.</p><div class="studio-section-heading"><h2>PROJECTS</h2><span class="studio-section-line studio-section-line--projects"></span></div><section class="studio-projects-panel"><header class="studio-projects-toolbar"><button class="studio-folder-button" type="button">NEW FOLDER</button><button class="studio-toolbar-icon" type="button" aria-label="Search">⌕</button><button class="studio-toolbar-icon" type="button" aria-label="Filters">☷</button><button class="studio-toolbar-icon" type="button" aria-label="More">•••</button></header><div class="studio-projects-body"><div class="studio-projects-empty"><p class="studio-projects-empty-title">No project files yet.</p><p>Create a project, folder, or import sounds to start building.</p></div></div></section><div data-studio-modal-root></div></section></section></main>`
  initShellChrome()
  initStudioLogo()
  bind()
}

async function initStudioLogo() {
  const logo = document.querySelector('[data-studio-logo]')
  const fallback = document.querySelector('[data-studio-logo-fallback]')
  if (!logo) return
  const a = await getStorageAssetUrl('assets/brand/melogic-logo-mark-glow.png', { warnOnFail: false })
  const b = await getStorageAssetUrl('assets/brand/melogic-logo-mark-white-transparent.png', { warnOnFail: false })
  for (const url of [a, b, '/assets/brand/melogic-logo-mark-glow.png'].filter(Boolean)) {
    const ok = await new Promise((resolve) => { const img = new Image(); img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = url })
    if (ok) { logo.src = url; logo.hidden = false; fallback.hidden = true; return }
  }
  logo.remove(); fallback.hidden = false
}

function renderModal() {
  const root = app.querySelector('[data-studio-modal-root]')
  if (!root) return
  root.innerHTML = `<div class="studio-modal"><form class="studio-modal-panel" data-create-form><h3>New Project</h3><label>Project name<input name="title" maxlength="120" placeholder="Name your project" required /></label>${state.createError ? `<p class="studio-form-error">${state.createError}</p>` : ''}<div class="studio-modal-actions"><button class="button" type="submit" ${state.creating ? 'disabled' : ''}>Create Project</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  root.querySelector('[data-close-modal]')?.addEventListener('click', () => { root.innerHTML = '' })
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
