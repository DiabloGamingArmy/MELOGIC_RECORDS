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
let selectedTrackId = 'demo-track'
const automationOpenTrackIds = new Set()
let openTrackMenuId = ''

const timelineState = { bars: 16, beatsPerBar: 4, pixelsPerBar: 120, playheadX: 40, selectionBox: null, isSelecting: false, isDraggingPlayhead: false }
const timelineRegions = []

const tracks = [
  {
    id: 'demo-track',
    name: 'Demo Track',
    type: 'audio',
    color: '#ff4d5d',
    colorSoft: 'rgba(255, 77, 93, 0.26)',
    icon: 'audio',
    muted: false,
    soloed: false,
    recordArmed: false,
    automationOpen: false,
    volume: 72,
    pan: 0,
    outputLevel: 0
  }
]

const projectIdFromPath = () => decodeURIComponent((window.location.pathname.split('/')[2] || '').trim())
const icon = (name) => ({ mute:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="m11 5-5 4H3v6h3l5 4z"/><path d="m23 9-6 6"/><path d="m17 9 6 6"/></svg>', solo:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M3 14v-2a9 9 0 0 1 18 0v2"/><path d="M5 14h3v6H5z"/><path d="M16 14h3v6h-3z"/></svg>', record:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="7"/></svg>', automation:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 17 16 7"/></svg>', more:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>' }[name] || '')
const toolIcon = (name) => ({ library:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v6"/></svg>', inspector:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h8"/><path d="M4 17h16"/><path d="M14 7h6"/><path d="M4 12h16"/><circle cx="11" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>', notes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', sliders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21V10"/><path d="M8 6V3"/><path d="M16 21v-3"/><path d="M16 14V3"/><path d="M12 21v-7"/><path d="M12 10V3"/></svg>', loop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 0 1 15.5-6.5"/><path d="M21 3v6h-6"/><path d="M21 12a9 9 0 0 1-15.5 6.5"/><path d="M3 21v-6h6"/></svg>',store:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9h18l-1 11H4Z"/><path d="M3 9 5 3h14l2 6"/><path d="M9 9v3a3 3 0 0 0 6 0V9"/></svg>', start:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 5v14"/><path d="m19 6-9 6 9 6V6z"/></svg>', rewind:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m11 19-9-7 9-7v14z"/><path d="m22 19-9-7 9-7v14z"/></svg>', play:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 5 11 7-11 7z"/></svg>', stop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>', record:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/></svg>', metro:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 4-6 16h12z"/><path d="M12 10v6"/><path d="M9 4h6"/></svg>', count:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v14"/><path d="m7 12 5 5 5-5"/><path d="M5 21h14"/></svg>', snap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 4 4 8-4 8"/><path d="M18 4v16"/><path d="M6 12h12"/></svg>' }[name] || '')

const trackTypeIcon = (type) => ({
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10v4"/><path d="M7 7v10"/><path d="M11 4v16"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>',
  instrument: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10h10"/><path d="M7 14h10"/></svg>',
  midi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  drums: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v6c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/></svg>',
  bass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 4v16"/><path d="M6 8h8a4 4 0 1 1 0 8H6"/></svg>'
}[type] || '')

const toolButton = (label, n, extra = '') => `<button class="studio-tool-button ${extra}" aria-label="${label}" data-tooltip="${label}">${toolIcon(n)}</button>`

const renderTrackCard = (track) => `<div class="studio-track-stack"><article class="studio-track-card ${selectedTrackId === track.id ? 'is-selected' : ''}" data-track-row="${track.id}" style="--track-color: ${track.color}; --track-color-soft: ${track.colorSoft};"><button class="studio-track-icon" type="button" aria-label="${track.name} track" data-track-icon="${track.id}">${trackTypeIcon(track.type)}</button><div class="studio-track-card-main"><div class="studio-track-card-top"><strong class="studio-track-name">${track.name}</strong><button class="studio-track-more" data-track-options="${track.id}" aria-label="Track options" data-tooltip="Track options">${icon('more')}</button></div><div class="studio-track-card-controls"><button class="studio-track-control ${track.muted ? 'is-active' : ''}" data-track-mute="${track.id}" aria-label="Mute ${track.name}" data-tooltip="Mute">${icon('mute')}</button><button class="studio-track-control ${track.soloed ? 'is-active' : ''}" data-track-solo="${track.id}" aria-label="Solo ${track.name}" data-tooltip="Solo">${icon('solo')}</button><button class="studio-record-arm ${track.recordArmed ? 'is-active' : ''}" data-track-record="${track.id}" aria-label="Record arm ${track.name}" data-tooltip="Record arm">R</button><button class="studio-track-control" data-track-automation="${track.id}" aria-label="Automation ${track.name}" data-tooltip="Automation">${icon('automation')}</button><input class="studio-track-volume" data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}" aria-label="${track.name} volume" /><div class="studio-track-meter" aria-label="${track.name} output level" style="--track-output-level: ${(track.outputLevel || 0) * 100}%"></div><button class="studio-track-pan" type="button" aria-label="${track.name} pan" data-tooltip="Pan"></button></div></div></article>${track.automationOpen ? '<div class="studio-automation-lane"><span>Automation</span><button>Volume</button><button>Pan</button><button>Filter</button><button>Add</button></div>' : ''}<div class="studio-track-menu" ${openTrackMenuId === track.id ? '' : 'hidden'}><button>Rename</button><button>Duplicate</button><button disabled>Delete</button><button>Freeze Track</button><button>Freeze All Tracks</button><button>Import MIDI File</button><button>Export Track</button><button>Track Color</button><button disabled>Merge Tracks</button></div></div>`

function renderTimelineRegions() { return timelineRegions.map(() => "").join("") }

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
  const getTrack = (id) => tracks.find((track) => track.id === id)
  app.querySelectorAll('[data-track-mute]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackMute); if (!t) return; t.muted = !t.muted; renderEditor() }))
  app.querySelectorAll('[data-track-solo]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackSolo); if (!t) return; t.soloed = !t.soloed; renderEditor() }))
  app.querySelectorAll('[data-track-record]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackRecord); if (!t) return; t.recordArmed = !t.recordArmed; renderEditor() }))
  app.querySelectorAll('[data-track-volume]').forEach((el) => el.addEventListener('input', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackVolume); if (!t) return; t.volume = Number(el.value); el.style.setProperty('--volume-fill', `${t.volume}%`); }))
  app.querySelectorAll('[data-track-automation]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackAutomation); if (!t) return; t.automationOpen = !t.automationOpen; renderEditor() }))
  app.querySelectorAll('[data-track-options]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.trackOptions; openTrackMenuId = openTrackMenuId === id ? '' : id; renderEditor() }))

  const arrangement = app.querySelector('[data-arrangement]')
  const ruler = app.querySelector('[data-timeline-ruler]')
  const grid = app.querySelector('[data-arrangement-grid]')
  const selectionBox = app.querySelector('[data-selection-box]')
  const maxX = () => timelineState.bars * timelineState.pixelsPerBar
  const setPlayhead = (x) => { timelineState.playheadX = Math.max(0, Math.min(x, maxX())); arrangement?.style.setProperty('--playhead-x', `${timelineState.playheadX}px`) }
  const localX = (event, el) => { const rect = el.getBoundingClientRect(); return event.clientX - rect.left + el.scrollLeft }
  ruler?.addEventListener('pointerdown', (event) => { event.preventDefault(); timelineState.isDraggingPlayhead = true; setPlayhead(localX(event, ruler)) })
  grid?.addEventListener('pointerdown', (event) => { if (event.target !== grid && !event.target.closest('[data-arrangement-grid-inner]')) return; event.preventDefault(); timelineState.isSelecting = true; const rect = grid.getBoundingClientRect(); timelineState.selectionBox = { startX: event.clientX - rect.left + grid.scrollLeft, startY: event.clientY - rect.top + grid.scrollTop }; if (selectionBox) selectionBox.hidden = false })
  window.addEventListener('pointermove', (event) => { if (timelineState.isDraggingPlayhead) { event.preventDefault(); setPlayhead(localX(event, ruler)) } if (timelineState.isSelecting && selectionBox && grid) { event.preventDefault(); const rect = grid.getBoundingClientRect(); const x = event.clientX - rect.left + grid.scrollLeft; const y = event.clientY - rect.top + grid.scrollTop; const sx = timelineState.selectionBox.startX; const sy = timelineState.selectionBox.startY; selectionBox.style.left = `${Math.min(sx, x)}px`; selectionBox.style.top = `${Math.min(sy, y)}px`; selectionBox.style.width = `${Math.abs(x - sx)}px`; selectionBox.style.height = `${Math.abs(y - sy)}px`; } })
  window.addEventListener('pointerup', () => { timelineState.isDraggingPlayhead = false; timelineState.isSelecting = false; if (selectionBox) selectionBox.hidden = true })
}


// TODO: connect navigator.requestMIDIAccess() after MIDI permission UX is designed.
function renderEditor() {
  const project = projectState
  document.body.classList.add('is-studio-editor')
  const shell = `<main class="studio-editor-page ${keepSiteMenuOpen ? 'has-site-nav' : 'is-fullscreen'}"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu" aria-expanded="false">☰</button><nav class="studio-editor-menu"><button>File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button>Help</button></nav><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small>Project loaded</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group studio-tool-group--left">${toolButton('Library','library')}${toolButton('Inspector','inspector')}${toolButton('Notes','notes')}${toolButton('Smart Controls','sliders')}${toolButton('Loop Browser','store')}</div><div class="studio-transport-center"><div class="studio-tool-group studio-tool-group--transport">${toolButton('Go to start','start')}${toolButton('Rewind','rewind')}${toolButton('Play','play')}${toolButton('Stop','stop')}${toolButton('Record','record')}${toolButton('Cycle','loop')}</div><div class="studio-logic-display" aria-label="Project transport display"><section class="studio-logic-section studio-logic-section--time"><strong class="studio-logic-primary">00:00.000.00</strong><span class="studio-logic-secondary">time</span></section><section class="studio-logic-section studio-logic-section--bars"><strong class="studio-logic-primary">001 01 1 001</strong><span class="studio-logic-secondary">bar beat div tick</span></section><section class="studio-logic-section studio-logic-section--tempo"><strong class="studio-logic-primary">${Number(project.bpm || 140).toFixed(4)}</strong><span class="studio-logic-secondary">4/4 <button class="studio-display-icon-button" aria-label="Tempo settings" data-tooltip="Tempo settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/></svg></button></span></section><section class="studio-logic-section studio-logic-section--key"><strong class="studio-logic-primary">${project.key}</strong><span class="studio-logic-secondary">key</span></section><section class="studio-logic-section studio-logic-section--midi"><strong class="studio-logic-primary" data-midi-status>No MIDI</strong><span class="studio-logic-secondary">input</span></section><section class="studio-logic-section studio-logic-section--cpu"><strong class="studio-logic-primary">0%</strong><span class="studio-logic-secondary">CPU</span></section></div><div class="studio-tool-group studio-tool-group--utilities">${toolButton('Metronome','metro')}${toolButton('Count-in','count','studio-tool-button--count-in')}${toolButton('Snap','snap')}<span class="studio-save-status">Saved</span></div></div><div class="studio-transport-spacer" aria-hidden="true"></div></section><div class="studio-editor-workspace"><aside class="studio-track-panel">${tracks.map(renderTrackCard).join('')}</aside><section class="studio-arrangement" data-arrangement style="--bars: ${timelineState.bars}; --beats-per-bar: ${timelineState.beatsPerBar}; --pixels-per-bar: ${timelineState.pixelsPerBar}px; --pixels-per-beat: ${timelineState.pixelsPerBar / timelineState.beatsPerBar}px; --playhead-x: ${timelineState.playheadX}px;"><div class="studio-timeline-ruler" data-timeline-ruler><div class="studio-timeline-ruler-inner">${Array.from({length: timelineState.bars}, (_, i) => `<span style="width: var(--pixels-per-bar)">${i + 1}</span>`).join('')}</div></div><div class="studio-arrangement-grid" data-arrangement-grid><div class="studio-arrangement-grid-inner" data-arrangement-grid-inner>${renderTimelineRegions()}<div class="studio-selection-box" data-selection-box hidden></div></div></div><span class="studio-playhead" data-playhead></span></section><aside class="studio-right-rail"><button>Loops</button><button>FX</button><button>Mixer</button><button>Collab</button></aside></div><section class="studio-effects-panel" hidden></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span></footer></main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  if (keepSiteMenuOpen) initShellChrome()
  setEditorMenuOpen(isEditorMenuOpen)
  bindEditorEvents()
}

async function init() { renderState('Loading project...'); const user = await waitForInitialAuthState(); if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname })); const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.'); const project = await getStudioProject(id); if (!project) return renderState('Studio project not found.'); if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.'); touchStudioProject(project.id).catch(() => {}); projectState = project; renderEditor() }
init()
