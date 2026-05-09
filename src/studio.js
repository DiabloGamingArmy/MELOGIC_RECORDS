import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, studioProjectRoute } from './utils/routes'
import { createStudioProject, listMyStudioProjects, listSharedStudioProjects } from './data/studioProjectService'

const app = document.querySelector('#app')
const appState = { user: null, loading: true, error: '', my: [], shared: [], tab: 'my', search: '', modalOpen: false }
const emptyByTab = { my: 'No projects yet. Start your first Melogic Studio session.', shared: 'No shared projects yet.', recent: 'No recent projects yet.' }

const fmt = (ts) => (ts?.toDate ? ts.toDate().toLocaleString() : 'Just now')
const filtered = (items) => {
  const q = appState.search.trim().toLowerCase()
  return q ? items.filter((p) => p.title.toLowerCase().includes(q)) : items
}
function currentItems() {
  if (appState.tab === 'shared') return filtered(appState.shared)
  if (appState.tab === 'recent') return filtered([...appState.my, ...appState.shared].sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0)).slice(0, 20))
  return filtered(appState.my)
}

function render() {
  const signedOut = !appState.user
  const items = currentItems()
  let library = ''
  if (appState.loading) library = '<p>Loading studio projects…</p>'
  else if (appState.error) library = `<p>${appState.error}</p>`
  else {
    library = `<div class="studio-tabs"><button data-tab="my">My Projects</button><button data-tab="shared">Shared With Me</button><button data-tab="recent">Recent</button></div><input class="studio-search" data-search placeholder="Search projects" value="${appState.search}" />`
    if (items.length) {
      library += `<div class="studio-project-grid">${items.map((p) => `<article class="studio-project-card"><div class="thumb"></div><h3>${p.title}</h3><p>${p.type} • ${p.bpm} BPM • ${p.key}</p><p>${p.visibility} • ${fmt(p.updatedAt || p.createdAt)}</p><a class="button" href="${studioProjectRoute(p.id)}">Open</a></article>`).join('')}</div>`
    } else library += `<p>${emptyByTab[appState.tab]}</p>`
  }

  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-hero"><p>Melogic Studio</p><h1>Your Studio Library</h1><p>Create, manage, and open your cloud music projects.</p>${signedOut ? '' : '<button class="button" data-new-project>New Project</button>'}</section>${signedOut ? `<section class="studio-library"><p>Sign in to use Melogic Studio.</p><a class="button" href="${authRoute({ redirect: ROUTES.studio })}">Sign In</a></section>` : `<section class="studio-library">${library}</section>`}${appState.modalOpen ? '<div class="studio-modal"><form class="studio-modal-panel" data-create-form><h2>New Project</h2><label>Project title<input name="title" maxlength="120" /></label><label>BPM<input name="bpm" type="number" min="40" max="240" value="140" /></label><label>Key<input name="key" value="C minor" maxlength="40" /></label><label>Type<select name="type"><option>song</option><option>beat</option><option>vocal</option><option>podcast</option><option>blank</option></select></label><div><button type="submit" class="button">Create</button><button type="button" class="button button-muted" data-close-modal>Cancel</button></div></form></div>' : ''}</main>`
  initShellChrome()
  bind()
}

function bind() {
  app.querySelector('[data-new-project]')?.addEventListener('click', () => { appState.modalOpen = true; render() })
  app.querySelector('[data-close-modal]')?.addEventListener('click', () => { appState.modalOpen = false; render() })
  app.querySelectorAll('[data-tab]').forEach((el) => el.addEventListener('click', () => { appState.tab = el.dataset.tab; render() }))
  app.querySelector('[data-search]')?.addEventListener('input', (e) => { appState.search = e.target.value; render() })
  app.querySelector('[data-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const project = await createStudioProject(appState.user, Object.fromEntries(form.entries()))
    window.location.href = studioProjectRoute(project.id)
  })
}

async function loadProjects() {
  if (!appState.user) return
  appState.loading = true
  render()
  try {
    ;[appState.my, appState.shared] = await Promise.all([listMyStudioProjects(appState.user.uid), listSharedStudioProjects(appState.user.uid)])
    appState.error = ''
  } catch (err) {
    console.error('[studio]', err)
    appState.error = 'We could not load your Studio projects right now.'
  }
  appState.loading = false
  render()
}

waitForInitialAuthState().then(async (user) => { appState.user = user; render(); await loadProjects() })
subscribeToAuthState(async (user) => { appState.user = user; appState.modalOpen = false; render(); await loadProjects() })
