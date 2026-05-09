import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { getStorageAssetUrl } from './firebase/storageAssets'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, studioProjectRoute } from './utils/routes'
import { createStudioProject } from './data/studioProjectService'

const app = document.querySelector('#app')
const urlSection = new URLSearchParams(window.location.search).get('section')
const appState = { user: null, modalOpen: false, creating: false, createError: '', section: ['projects', 'demos', 'tutorials'].includes(urlSection) ? urlSection : 'projects' }

const exploreItems = Array.from({ length: 4 }, () => ({ title: 'WILDFLOWER', artist: 'Billie Eilish', year: '2024' }))

function icon(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
  const icons = {
    plus: `<svg ${common}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`, user: `<svg ${common}><path d="M18 21a6 6 0 0 0-12 0"/><circle cx="12" cy="7" r="4"/></svg>`,
    search: `<svg ${common}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>`, sliders: `<svg ${common}><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 8h4"/><path d="M18 16h4"/></svg>`,
    more: `<svg ${common}><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/></svg>`, play: `<svg ${common}><polygon points="8 5 19 12 8 19 8 5"/></svg>`, audio: `<svg ${common}><path d="M2 10v4"/><path d="M6 6v12"/><path d="M10 3v18"/><path d="M14 8v8"/><path d="M18 5v14"/><path d="M22 10v4"/></svg>`
  }
  return icons[name] || ''
}

async function initStudioBrandLogo() {
  const logo = document.querySelector('[data-studio-logo]')
  const fallbackIcon = document.querySelector('[data-studio-logo-fallback]')
  if (!logo) return
  const primary = await getStorageAssetUrl('assets/brand/melogic-logo-mark-glow.png', { warnOnFail: false })
  const secondary = await getStorageAssetUrl('assets/brand/melogic-logo-mark-white-transparent.png', { warnOnFail: false })
  const candidates = [primary, secondary, '/assets/brand/melogic-logo-mark-glow.png'].filter(Boolean)
  const tryLoad = (url) => new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = url
  })
  for (const url of candidates) {
    // eslint-disable-next-line no-await-in-loop
    if (await tryLoad(url)) { logo.src = url; logo.hidden = false; if (fallbackIcon) fallbackIcon.hidden = true; return }
  }
  logo.remove()
  if (fallbackIcon) fallbackIcon.hidden = false
}

function render() {
  const authHref = authRoute({ redirect: ROUTES.studio })
  const actionAttrs = appState.user ? 'data-open-create' : `href="${authHref}"`
  const isProjects = appState.section === 'projects'

  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell"><aside class="studio-sidebar"><div class="studio-brand"><span class="studio-brand-mark"><img data-studio-logo alt="" hidden /><span data-studio-logo-fallback hidden>${icon('audio')}</span></span><span class="studio-brand-text">STUDIO</span></div><div class="studio-brand-underline"></div><nav class="studio-sidebar-nav" aria-label="Studio sections"><button class="studio-sidebar-link ${isProjects ? 'is-active' : ''}" data-studio-section="projects" type="button">PROJECTS</button><button class="studio-sidebar-link ${appState.section === 'demos' ? 'is-active' : ''}" data-studio-section="demos" type="button">DEMOS</button><button class="studio-sidebar-link ${appState.section === 'tutorials' ? 'is-active' : ''}" data-studio-section="tutorials" type="button">TUTORIALS</button><a class="studio-sidebar-link" href="${ROUTES.distribution || '/distribution'}">DISTRIBUTION</a></nav></aside><section class="studio-main"><div class="studio-top-actions"><a class="studio-action-button" ${actionAttrs}>NEW PROJECT <span>${icon('plus')}</span></a><a class="studio-action-button" href="${appState.user ? '#' : authHref}">START COLLAB <span>${icon('user')}</span></a></div><div class="studio-section-heading"><h2>EXPLORE</h2><span class="studio-section-line studio-section-line--explore"></span></div><div class="studio-explore-row">${exploreItems.map((item) => `<article class="studio-explore-card"><div class="studio-cover-placeholder"></div><div class="studio-explore-copy"><h3 class="studio-explore-title">${item.title}</h3><p>${item.artist}</p><p>${item.year}</p></div></article>`).join('')}</div><div class="studio-section-heading"><h2>RECENTS</h2><span class="studio-section-line studio-section-line--recents"></span></div><article class="studio-recent-card"><div class="studio-recent-icon">${icon('audio')}</div><div class="studio-recent-main"><div class="studio-recent-topline"><strong>Untitled 1</strong><button class="studio-toolbar-icon" type="button" aria-label="More">${icon('more')}</button></div><div class="studio-recent-player"><button class="studio-play-button" type="button" aria-label="Play recent track">${icon('play')}</button><div class="studio-waveform" aria-hidden="true"></div><span class="studio-duration">0:46</span></div></div></article><div class="studio-section-heading"><h2>PROJECTS</h2><span class="studio-section-line studio-section-line--projects"></span></div><section class="studio-projects-panel"><header class="studio-projects-toolbar"><button class="studio-folder-button" type="button">NEW FOLDER</button><button class="studio-toolbar-icon" type="button" aria-label="Search">${icon('search')}</button><button class="studio-toolbar-icon" type="button" aria-label="Filters">${icon('sliders')}</button><button class="studio-toolbar-icon" type="button" aria-label="More">${icon('more')}</button></header><div class="studio-projects-body"><div class="studio-projects-empty"><p class="studio-projects-empty-title">${isProjects ? 'No project files yet.' : `${appState.section[0].toUpperCase()}${appState.section.slice(1)} coming soon.`}</p><p>${isProjects ? 'Create a project, folder, or import sounds to start building.' : 'This Studio section is prepared for future updates.'}</p></div></div></section></section></section>${appState.modalOpen ? `<div class="studio-modal"><form class="studio-modal-panel" data-create-form><h3>New Project</h3><label>Project Name<input name="title" maxlength="120" required /></label><label>BPM<input name="bpm" type="number" min="40" max="240" value="140" required /></label><label>Key<input name="key" value="C minor" maxlength="40" required /></label><label>Type<select name="type"><option>song</option><option>beat</option><option>vocal</option><option>podcast</option><option>blank</option></select></label>${appState.createError ? `<p class="studio-form-error">${appState.createError}</p>` : ''}<div class="studio-modal-actions"><button class="button" type="submit" ${appState.creating ? 'disabled' : ''}>${appState.creating ? 'Creating…' : 'Create'}</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>` : ''}</main>`

  initShellChrome()
  initStudioBrandLogo()
  bind()
}

function bind() {
  app.querySelectorAll('[data-studio-section]').forEach((el) => el.addEventListener('click', () => { appState.section = el.dataset.studioSection; render() }))
  app.querySelector('[data-open-create]')?.addEventListener('click', (event) => { event.preventDefault(); appState.modalOpen = true; appState.createError = ''; render() })
  app.querySelector('[data-close-modal]')?.addEventListener('click', () => { appState.modalOpen = false; render() })
  app.querySelector('[data-create-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    try { appState.creating = true; appState.createError = ''; render(); const formData = new FormData(event.currentTarget); const project = await createStudioProject(appState.user, Object.fromEntries(formData.entries())); window.location.href = studioProjectRoute(project.id) }
    catch (error) { console.error('[studio]', error); appState.createError = 'Could not create the Studio project right now.'; appState.creating = false; render() }
  })
}

waitForInitialAuthState().then((user) => { appState.user = user; render() })
subscribeToAuthState((user) => { appState.user = user; render() })
