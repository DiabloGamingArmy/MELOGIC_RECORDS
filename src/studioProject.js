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
const miniIcon = (label) => `<span class="studio-mini-icon">${label}</span>`
const toolIcon = (name) => ({
  library: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v6"/></svg>',
  inspector: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h2v4h-2z"/></svg>',
  notes: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8"/><path d="M8 17h6"/></svg>',
  sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 10h4"/><path d="M18 16h4"/></svg>',
  loop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15.5-6.5"/><path d="M21 3v6h-6"/><path d="M21 12a9 9 0 0 1-15.5 6.5"/><path d="M3 21v-6h6"/></svg>',
  start: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5v14"/><path d="m19 6-9 6 9 6V6z"/></svg>',
  rewind: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m11 19-9-7 9-7v14z"/><path d="m22 19-9-7 9-7v14z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m8 5 11 7-11 7z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  record: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/></svg>',
  metro: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 3"/></svg>',
  count: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 9h14"/><path d="M5 15h14"/><path d="M9 4v16"/></svg>',
  snap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20"/><path d="M2 12h20"/><path d="m17 7-5 5"/><path d="m7 17 5-5"/></svg>'
}[name] || '')
const toolButton = (label, iconName) => `<button class="studio-tool-button" aria-label="${label}" data-tooltip="${label}">${toolIcon(iconName)}</button>`

function renderState(message, buttonHref = ROUTES.studio) {
  app.innerHTML = `<main class="studio-editor-page studio-editor-state"><div><h1>${message}</h1><a class="button" href="${buttonHref}">Back to Studio</a></div></main>`
}

function renderEditor() {
  const project = projectState
  document.body.classList.add('is-studio-editor')
  const shell = `<main class="studio-editor-page${keepSiteMenuOpen ? ' has-site-nav' : ''}"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu">☰</button><nav class="studio-editor-menu"><button>File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button>Help</button></nav><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small>Project loaded</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group">${toolButton('Library','library')}${toolButton('Inspector','inspector')}${toolButton('Notes','notes')}${toolButton('Smart Controls','sliders')}${toolButton('Loop Browser','loop')}</div><div class="studio-tool-group">${toolButton('Go to start','start')}${toolButton('Rewind','rewind')}${toolButton('Play','play')}${toolButton('Stop','stop')}${toolButton('Record','record')}${toolButton('Cycle','loop')}</div><div class="studio-logic-display" aria-label="Project position and tempo"><div class="studio-logic-display-row"><strong>001 01 1 001</strong><strong>00:00.000</strong></div><div class="studio-logic-display-row studio-logic-display-row--meta"><span>${project.bpm.toFixed?.(4) || project.bpm} BPM</span><span>${project.key}</span><span>4/4</span></div></div><div class="studio-tool-group">${toolButton('Metronome','metro')}${toolButton('Count-in','count')}${toolButton('Snap','snap')}<span>Saved</span></div></section><div class="studio-editor-workspace"><aside class="studio-track-panel">${['Audio 1','Instrument 1','MIDI 1','Drums','Bass'].map((t,i)=>`<button class="studio-track-row ${i===0?'is-selected':''}"><span class="studio-track-color" style="background:hsl(${i*60}deg 70% 55%)"></span><strong>${t}</strong>${miniIcon('M')}${miniIcon('S')}${miniIcon('R')}<span class="studio-track-slider"></span></button>`).join('')}</aside><section class="studio-arrangement"><div class="studio-timeline-ruler">${Array.from({length:16},(_,i)=>`<span>${i+1}</span>`).join('')}</div><div class="studio-arrangement-grid"><span class="studio-playhead"></span><div class="studio-onboarding-grid"><button>Add track</button><button>Import audio</button><button>Open loops</button><button>Add synth</button><button>Invite collaborator</button></div></div></section><aside class="studio-right-rail"><button>Loops</button><button>FX</button><button>Mixer</button><button>Collab</button></aside></div><section class="studio-effects-panel"><input placeholder="Try Overdrive, Equalizer, Delay" /><div>${['Clean Up','Glue Mix','Enhance','Sound Design','Drums','Bass','Vocals','Echo'].map((c)=>`<span class="chip">${c}</span>`).join('')}</div><div class="studio-effects-grid">${['EQ','Compressor','Reverb','Delay','Distortion','Bitcrusher','Chorus','Limiter','Auto Filter'].map((e)=>`<article><strong>${e}</strong><button>Add</button></article>`).join('')}</div></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span></footer></main>`
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
