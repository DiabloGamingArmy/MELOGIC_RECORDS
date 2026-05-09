import './styles/base.css'
import './styles/studio.css'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute } from './utils/routes'
import { getStudioProject, touchStudioProject } from './data/studioProjectService'

const app = document.querySelector('#app')
const reserved = new Set(['demos', 'tutorials', 'project', 'distribution'])
const projectIdFromPath = () => decodeURIComponent((window.location.pathname.split('/')[2] || '').trim())

function renderState(message, buttonHref = ROUTES.studio) {
  app.innerHTML = `<main class="studio-editor-page studio-editor-state"><div><h1>${message}</h1><a class="button" href="${buttonHref}">Back to Studio</a></div></main>`
}

function icon(label){return `<span class="studio-mini-icon">${label}</span>`}
function renderEditor(project) {
  app.innerHTML = `<main class="studio-editor-page"><header class="studio-editor-appbar"><div class="studio-editor-menu"><button class="studio-editor-menu-button" data-editor-menu>☰</button><span>File</span><span>Edit</span><span>View</span><span>Track</span><span>Mix</span><span>Help</span></div><div class="studio-editor-title">${project.title}<small>Project loaded</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button><button data-editor-menu>Menu</button></div><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-pin-menu /> Keep menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></header><section class="studio-editor-transport"><div>⏮ ▶ ⏹ ⏺ 🔁</div><div>00:00 • ${project.bpm} BPM • ${project.key} • 4/4</div><div>Saved</div></section><div class="studio-editor-workspace"><aside class="studio-track-panel">${['Audio 1','Instrument 1','MIDI 1','Drums','Bass'].map((t,i)=>`<div class="studio-track-row"><span class="studio-track-color" style="background:hsl(${i*60}deg 70% 55%)"></span><strong>${t}</strong>${icon('M')}${icon('S')}${icon('R')}<span class="studio-track-slider"></span></div>`).join('')}</aside><section class="studio-arrangement"><div class="studio-timeline-ruler">${Array.from({length:16},(_,i)=>`<span>${i+1}</span>`).join('')}</div><div class="studio-arrangement-grid"><div class="studio-onboarding-grid"><button>Add track</button><button>Import audio</button><button>Open loops</button><button>Add synth</button><button>Invite collaborator</button></div></div></section><aside class="studio-right-rail"><button>Loops</button><button>FX</button><button>Mixer</button><button>Collab</button></aside></div><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span></footer></main>`
  const panel=app.querySelector('[data-editor-nav-panel]'); let pinned=false
  app.querySelectorAll('[data-editor-menu]').forEach((b)=>b.addEventListener('click',()=>{if(panel) panel.hidden=!panel.hidden}))
  app.querySelector('[data-pin-menu]')?.addEventListener('change',(e)=>{pinned=e.target.checked})
  document.addEventListener('click',(e)=>{ if(!pinned && panel && !panel.hidden && !e.target.closest('[data-editor-menu]') && !e.target.closest('[data-editor-nav-panel]')) panel.hidden=true })
}

async function init() {
  renderState('Loading project...')
  const user = await waitForInitialAuthState()
  if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname }))
  const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.')
  const project = await getStudioProject(id)
  if (!project) return renderState('Studio project not found.')
  const allowed = user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid)
  if (!allowed) return renderState('You do not have access to this Studio project.')
  touchStudioProject(project.id).catch(() => {})
  // TODO: later connect project presence and collaborative edits through Firestore/RTDB/Liveblocks-style presence.
  renderEditor(project)
}
init()
