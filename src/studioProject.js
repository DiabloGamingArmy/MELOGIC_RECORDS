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
let isEditorMenuOpen = false
let selectedTrackId = 'audio-1'
const automationOpenTrackIds = new Set()
let openTrackMenuId = ''

const tracks = [
  { id: 'audio-1', name: 'Audio 1', type: 'audio', color: 'hsl(0 70% 55%)' },
  { id: 'instrument-1', name: 'Instrument 1', type: 'instrument', color: 'hsl(60 70% 55%)' },
  { id: 'midi-1', name: 'MIDI 1', type: 'midi', color: 'hsl(120 70% 55%)' },
  { id: 'drums', name: 'Drums', type: 'drums', color: 'hsl(180 70% 55%)' },
  { id: 'bass', name: 'Bass', type: 'bass', color: 'hsl(240 70% 55%)' }
]

const projectIdFromPath = () => decodeURIComponent((window.location.pathname.split('/')[2] || '').trim())
const icon = (name) => ({ mute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m11 5-5 4H3v6h3l5 4z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>', solo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14h4l3-5 4 10 3-5h4"/></svg>', record:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/></svg>', automation:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 17 16 7"/></svg>', more:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>' }[name] || '')
const toolIcon = (name) => ({ library:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v6"/></svg>', inspector:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M11 12h2v4h-2z"/></svg>', notes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>', sliders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/></svg>', loop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 0 1 15.5-6.5"/><path d="M21 3v6h-6"/><path d="M21 12a9 9 0 0 1-15.5 6.5"/><path d="M3 21v-6h6"/></svg>', start:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 5v14"/><path d="m19 6-9 6 9 6V6z"/></svg>', rewind:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m11 19-9-7 9-7v14z"/><path d="m22 19-9-7 9-7v14z"/></svg>', play:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 5 11 7-11 7z"/></svg>', stop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>', record:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/></svg>', metro:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3a9 9 0 1 0 9 9"/><path d="M12 7v5l3 3"/></svg>', count:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 9h14M5 15h14M9 4v16"/></svg>', snap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 2v20M2 12h20m-5-5-5 5m-5 5 5-5"/></svg>' }[name] || '')

const trackTypeIcon = (type) => ({
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10v4"/><path d="M7 7v10"/><path d="M11 4v16"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>',
  instrument: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10h10"/><path d="M7 14h10"/></svg>',
  midi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  drums: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v6c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/></svg>',
  bass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 4v16"/><path d="M6 8h8a4 4 0 1 1 0 8H6"/></svg>'
}[type] || '')

const toolButton = (label, n) => `<button class="studio-tool-button" aria-label="${label}" data-tooltip="${label}">${toolIcon(n)}</button>`

const renderTrackRow = (t) => `<div class="studio-track-stack"><article class="studio-track-card ${selectedTrackId === t.id ? 'is-selected' : ''}" data-track-row="${t.id}"><span class="studio-track-accent" style="background:${t.color}"></span><button class="studio-track-icon" type="button" aria-label="${t.name} track" data-track-icon="${t.id}">${trackTypeIcon(t.type)}</button><div class="studio-track-card-main"><div class="studio-track-card-top"><strong class="studio-track-name">${t.name}</strong><button class="studio-track-more" data-track-options="${t.id}" aria-label="Track options" data-tooltip="Track options">${icon('more')}</button></div><div class="studio-track-card-controls"><button class="studio-track-control" data-track-mute="${t.id}" aria-label="Mute ${t.name}" data-tooltip="Mute">${icon('mute')}</button><button class="studio-track-control" data-track-solo="${t.id}" aria-label="Solo ${t.name}" data-tooltip="Solo">${icon('solo')}</button><button class="studio-track-control" data-track-record="${t.id}" aria-label="Record arm ${t.name}" data-tooltip="Record">${icon('record')}</button><button class="studio-track-control" data-track-automation="${t.id}" aria-label="Automation ${t.name}" data-tooltip="Automation">${icon('automation')}</button><input type="range" min="0" max="100" value="72" class="studio-track-volume" aria-label="${t.name} volume"/><button class="studio-track-pan" aria-label="${t.name} pan" data-tooltip="Pan"></button></div></div></article>${automationOpenTrackIds.has(t.id) ? '<div class="studio-automation-lane"><span>Automation</span><button>Volume</button><button>Pan</button><button>Filter</button><button>Add</button></div>' : ''}<div class="studio-track-menu" ${openTrackMenuId === t.id ? '' : 'hidden'}><button>Rename</button><button>Duplicate</button><button disabled>Delete</button><button>Freeze Track</button><button>Freeze All Tracks</button><button>Import MIDI File</button><button>Export Track</button><button>Track Color</button><button disabled>Merge Tracks</button></div></div>`

function renderState(message, buttonHref = ROUTES.studio) { app.innerHTML = `<main class="studio-editor-page studio-editor-state"><div><h1>${message}</h1><a class="button" href="${buttonHref}">Back to Studio</a></div></main>` }

function setEditorMenuOpen(open) {
  isEditorMenuOpen = open
  const panel = app.querySelector('[data-editor-nav-panel]')
  const trigger = app.querySelector('[data-editor-left-menu]')
  if (!panel || !trigger) return
  panel.hidden = !open
  trigger.setAttribute('aria-expanded', String(open))
}

function bindEditorEvents() {
  const trigger = app.querySelector('[data-editor-left-menu]')
  const leftWrap = app.querySelector('.studio-editor-left')
  trigger?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); setEditorMenuOpen(!isEditorMenuOpen) })
  document.onclick = (event) => { if (!event.target.closest('.studio-editor-left') && !event.target.closest('.studio-track-stack')) { setEditorMenuOpen(false); openTrackMenuId = ''; renderEditor() } }
  document.onkeydown = (event) => { if (event.key === 'Escape') { setEditorMenuOpen(false); openTrackMenuId = ''; renderEditor() } }
  leftWrap?.addEventListener('click', (event) => event.stopPropagation())
  app.querySelector('[data-keep-site-menu]')?.addEventListener('change', (e) => { keepSiteMenuOpen = e.target.checked; localStorage.setItem(PREF_KEY, keepSiteMenuOpen ? '1' : '0'); isEditorMenuOpen = false; renderEditor() })
  app.querySelectorAll('[data-track-row]').forEach((el) => el.addEventListener('click', () => { selectedTrackId = el.dataset.trackRow; openTrackMenuId = ''; renderEditor() }))
  app.querySelectorAll('[data-track-automation]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.trackAutomation; automationOpenTrackIds.has(id) ? automationOpenTrackIds.delete(id) : automationOpenTrackIds.add(id); renderEditor() }))
  app.querySelectorAll('[data-track-options]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.trackOptions; openTrackMenuId = openTrackMenuId === id ? '' : id; renderEditor() }))
}

function renderEditor() {
  const project = projectState
  document.body.classList.add('is-studio-editor')
  const shell = `<main class="studio-editor-page ${keepSiteMenuOpen ? 'has-site-nav' : 'is-fullscreen'}"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu" aria-expanded="false">☰</button><nav class="studio-editor-menu"><button>File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button>Help</button></nav><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small>Project loaded</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group">${toolButton('Library','library')}${toolButton('Inspector','inspector')}${toolButton('Notes','notes')}${toolButton('Smart Controls','sliders')}${toolButton('Loop Browser','loop')}</div><div class="studio-tool-group">${toolButton('Go to start','start')}${toolButton('Rewind','rewind')}${toolButton('Play','play')}${toolButton('Stop','stop')}${toolButton('Record','record')}${toolButton('Cycle','loop')}</div><div class="studio-logic-display" aria-label="Project position and tempo"><div class="studio-logic-display-row"><strong>001 01 1 001</strong><strong>00:00.000</strong></div><div class="studio-logic-display-row studio-logic-display-row--meta"><span>${project.bpm.toFixed?.(4) || project.bpm} BPM</span><span>${project.key}</span><span>4/4</span></div></div><div class="studio-tool-group">${toolButton('Metronome','metro')}${toolButton('Count-in','count')}${toolButton('Snap','snap')}<span>Saved</span></div></section><div class="studio-editor-workspace"><aside class="studio-track-panel">${tracks.map(renderTrackRow).join('')}</aside><section class="studio-arrangement"><div class="studio-timeline-ruler">${Array.from({length:16},(_,i)=>`<span>${i+1}</span>`).join('')}</div><div class="studio-arrangement-grid"><span class="studio-playhead"></span></div></section><aside class="studio-right-rail"><button>Loops</button><button>FX</button><button>Mixer</button><button>Collab</button></aside></div><section class="studio-effects-panel" hidden></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span></footer></main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  if (keepSiteMenuOpen) initShellChrome()
  setEditorMenuOpen(isEditorMenuOpen)
  bindEditorEvents()
}

async function init() { renderState('Loading project...'); const user = await waitForInitialAuthState(); if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname })); const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.'); const project = await getStudioProject(id); if (!project) return renderState('Studio project not found.'); if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.'); touchStudioProject(project.id).catch(() => {}); projectState = project; renderEditor() }
init()
