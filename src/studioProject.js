import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute } from './utils/routes'
import { getStudioProject, touchStudioProject } from './data/studioProjectService'

const app = document.querySelector('#app')
const reserved = new Set(['demos', 'tutorials', 'project', 'distribution'])
const PREF_KEY = 'melogic_studio_keep_site_menu_open'
let keepSiteMenuOpen = localStorage.getItem(PREF_KEY) === '1'
let projectState = null

const projectIdFromPath = () => decodeURIComponent((window.location.pathname.split('/')[2] || '').trim())
const icon = (label) => `<span class="studio-mini-icon">${label}</span>`

function renderState(message, buttonHref = ROUTES.studio) {
  app.innerHTML = `<main class="studio-editor-page studio-editor-state"><div><h1>${message}</h1><a class="button" href="${buttonHref}">Back to Studio</a></div></main>`
}

function renderEditor() {
  const project = projectState
  const shell = `<main class="studio-editor-page${keepSiteMenuOpen ? ' has-site-nav' : ''}"><header class="studio-editor-appbar"><div class="studio-editor-menu"><button class="studio-editor-menu-button" data-editor-left-menu>☰</button><span>File</span><span>Edit</span><span>View</span><span>Track</span><span>Mix</span><span>Help</span></div><div class="studio-editor-title">${project.title}<small>Project loaded</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></header><section class="studio-editor-transport"><div class="studio-tool-group"><button>Library</button><button>Inspector</button><button>Notes</button><button>Smart Controls</button><button>Loop Browser</button></div><div class="studio-tool-group">⏮ ◀ ▶ ⏹ ⏺ 🔁</div><div class="studio-logic-display"><span>001 01 1 001</span><span>00:00.000</span><span>${project.bpm.toFixed?.(4) || project.bpm} BPM</span><span>${project.key}</span><span>4/4</span></div><div class="studio-tool-group"><button>Metronome</button><button>Count-in</button><button>Snap</button><span>Saved</span></div></section><div class="studio-editor-workspace"><aside class="studio-track-panel">${['Audio 1','Instrument 1','MIDI 1','Drums','Bass'].map((t,i)=>`<button class="studio-track-row ${i===0?'is-selected':''}"><span class="studio-track-color" style="background:hsl(${i*60}deg 70% 55%)"></span><strong>${t}</strong>${icon('M')}${icon('S')}${icon('R')}<span class="studio-track-slider"></span></button>`).join('')}</aside><section class="studio-arrangement"><div class="studio-timeline-ruler">${Array.from({length:16},(_,i)=>`<span>${i+1}</span>`).join('')}</div><div class="studio-arrangement-grid"><span class="studio-playhead"></span><div class="studio-onboarding-grid"><button>Add track</button><button>Import audio</button><button>Open loops</button><button>Add synth</button><button>Invite collaborator</button></div></div></section><aside class="studio-right-rail"><button>Loops</button><button>FX</button><button>Mixer</button><button>Collab</button></aside></div><section class="studio-effects-panel"><input placeholder="Try Overdrive, Equalizer, Delay" /><div>${['Clean Up','Glue Mix','Enhance','Sound Design','Drums','Bass','Vocals','Echo'].map((c)=>`<span class="chip">${c}</span>`).join('')}</div><div class="studio-effects-grid">${['EQ','Compressor','Reverb','Delay','Distortion','Bitcrusher','Chorus','Limiter','Auto Filter'].map((e)=>`<article><strong>${e}</strong><button>Add</button></article>`).join('')}</div></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span></footer></main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  if (keepSiteMenuOpen) initShellChrome()
  const panel = app.querySelector('[data-editor-nav-panel]')
  app.querySelector('[data-editor-left-menu]')?.addEventListener('click', () => { if (panel) panel.hidden = !panel.hidden })
  app.querySelector('[data-keep-site-menu]')?.addEventListener('change', (e) => { keepSiteMenuOpen = e.target.checked; localStorage.setItem(PREF_KEY, keepSiteMenuOpen ? '1' : '0'); renderEditor() })
}

async function init() {
  renderState('Loading project...')
  const user = await waitForInitialAuthState()
  if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname }))
  const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.')
  const project = await getStudioProject(id)
  if (!project) return renderState('Studio project not found.')
  if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.')
  touchStudioProject(project.id).catch(() => {})
  projectState = project
  renderEditor()
}
init()
