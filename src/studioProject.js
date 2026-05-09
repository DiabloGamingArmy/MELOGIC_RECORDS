import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute } from './utils/routes'
import { getStudioProject, touchStudioProject } from './data/studioProjectService'

const app = document.querySelector('#app')

function projectIdFromPath() {
  const [, studio, ...rest] = window.location.pathname.split('/')
  if (studio !== 'studio') return ''
  return decodeURIComponent((rest[0] || '').trim())
}

function renderBody(content) {
  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page">${content}</main>`
  initShellChrome()
}

async function init() {
  const user = await waitForInitialAuthState()
  if (!user) {
    renderBody(`<section class="studio-library"><p>Sign in to use Melogic Studio.</p><a class="button" href="${authRoute({ redirect: window.location.pathname })}">Sign In</a></section>`)
    return
  }

  const id = projectIdFromPath()
  if (!id) return renderBody('<section class="studio-library"><p>Studio project not found.</p></section>')

  const project = await getStudioProject(id)
  if (!project) return renderBody('<section class="studio-library"><p>Studio project not found.</p></section>')

  const allowed = user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid)
  if (!allowed) return renderBody('<section class="studio-library"><p>You do not have access to this Studio project.</p></section>')

  touchStudioProject(project.id).catch(() => {})
  renderBody(`<section class="studio-editor-shell"><header class="studio-editor-top"><div><h1>${project.title}</h1><p>${project.bpm} BPM • ${project.key}</p></div><a class="button" href="${ROUTES.studio}">Back to Studio</a></header><div class="studio-transport"><button disabled>Play</button><button disabled>Stop</button><button disabled>Record</button></div><div class="studio-editor-grid"><aside class="studio-track-list"><h2>Tracks</h2><p>Track 1 — Audio</p><p>Track 2 — MIDI</p></aside><section class="studio-timeline" aria-label="Timeline placeholder"></section><aside class="studio-side-panel"><p>Audio engine coming later. This pass only creates the project workspace foundation.</p></aside></div></section>`)
}

init()
