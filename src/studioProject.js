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
let activeBottomPanel = ''
let isPlaying = false
let playRaf = 0
let lastPlayTimestamp = 0
let panDrag = null

const timelineState = { bars: 20, beatsPerBar: 4, pixelsPerBar: 120, playheadX: 0, selectionBox: null, isSelecting: false, isDraggingPlayhead: false }
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
const toolIcon = (name) => ({ library:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18"/><path d="M9 4v6"/></svg>', inspector:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 7h8"/><path d="M4 17h16"/><path d="M14 7h6"/><path d="M4 12h16"/><circle cx="11" cy="7" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="17" cy="17" r="2"/></svg>', notes:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>', sliders:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 21V10"/><path d="M8 6V3"/><path d="M16 21v-3"/><path d="M16 14V3"/><path d="M12 21v-7"/><path d="M12 10V3"/></svg>', loop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 12a9 9 0 0 1 15.5-6.5"/><path d="M21 3v6h-6"/><path d="M21 12a9 9 0 0 1-15.5 6.5"/><path d="M3 21v-6h6"/></svg>',store:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9h18l-1 11H4Z"/><path d="M3 9 5 3h14l2 6"/><path d="M9 9v3a3 3 0 0 0 6 0V9"/></svg>', start:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M5 5v14"/><path d="m19 6-9 6 9 6V6z"/></svg>', rewind:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m11 19-9-7 9-7v14z"/><path d="m22 19-9-7 9-7v14z"/></svg>', play:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m8 5 11 7-11 7z"/></svg>', stop:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>', record:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/></svg>', metro:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m12 4-6 16h12z"/><path d="M12 10v6"/><path d="M9 4h6"/></svg>', count:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3v14"/><path d="m7 12 5 5 5-5"/><path d="M5 21h14"/></svg>', forward:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m13 19 9-7-9-7v14z"/><path d="m2 19 9-7-9-7v14z"/></svg>',end:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m5 6 9 6-9 6V6z"/><path d="M19 5v14"/></svg>',snap:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15a6 6 0 0 0 12 0v-3h-4v3a2 2 0 0 1-4 0v-3H6z"/><path d="M6 12V7"/><path d="M18 12V7"/><path d="M6 7h4"/><path d="M14 7h4"/></svg>' }[name] || '')

const trackTypeIcon = (type) => ({
  audio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 10v4"/><path d="M7 7v10"/><path d="M11 4v16"/><path d="M15 7v10"/><path d="M19 10v4"/></svg>',
  instrument: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10h10"/><path d="M7 14h10"/></svg>',
  midi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>',
  drums: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><ellipse cx="12" cy="8" rx="7" ry="3"/><path d="M5 8v6c0 1.7 3.1 3 7 3s7-1.3 7-3V8"/></svg>',
  bass: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M6 4v16"/><path d="M6 8h8a4 4 0 1 1 0 8H6"/></svg>'
}[type] || '')

const toolButton = (label, n, extra = '') => `<button class="studio-tool-button ${extra}" aria-label="${label}" data-tooltip="${label}">${toolIcon(n)}</button>`

const renderTrackCard = (track) => `<div class="studio-track-stack"><article class="studio-track-card ${selectedTrackId === track.id ? 'is-selected' : ''}" data-track-row="${track.id}" style="--track-color: ${track.color}; --track-color-soft: ${track.colorSoft};"><div class="studio-track-header-row"><button class="studio-track-icon" type="button" aria-label="${track.name} track" data-track-icon="${track.id}">${trackTypeIcon(track.type)}</button><strong class="studio-track-name">${track.name}</strong><button class="studio-track-more" data-track-options="${track.id}" aria-label="Track options" data-tooltip="Track options">${icon('more')}</button></div><div class="studio-track-control-row"><button class="studio-track-control ${track.muted ? 'is-active' : ''}" data-track-mute="${track.id}" aria-label="Mute ${track.name}" data-tooltip="Mute">${icon('mute')}</button><button class="studio-track-control ${track.soloed ? 'is-active' : ''}" data-track-solo="${track.id}" aria-label="Solo ${track.name}" data-tooltip="Solo">${icon('solo')}</button><button class="studio-record-arm ${track.recordArmed ? 'is-active' : ''}" data-track-record="${track.id}" aria-label="Record arm ${track.name}" data-tooltip="Record arm">R</button><button class="studio-track-control" data-track-automation="${track.id}" aria-label="Automation ${track.name}" data-tooltip="Automation">${icon('automation')}</button><input class="studio-track-volume" data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}" aria-label="${track.name} volume" /><button class="studio-track-pan" type="button" aria-label="${track.name} pan" data-tooltip="Pan" data-track-pan="${track.id}" style="--pan-angle: ${track.pan * 135}deg"></button></div></article>${track.automationOpen ? '<div class="studio-automation-lane"><span>Automation</span><button>Volume</button><button>Pan</button><button>Filter</button><button>Add</button></div>' : ''}<div class="studio-track-menu" ${openTrackMenuId === track.id ? '' : 'hidden'}><button>Rename</button><button>Duplicate</button><button disabled>Delete</button><button>Freeze Track</button><button>Freeze All Tracks</button><button>Import MIDI File</button><button>Export Track</button><button>Track Color</button><button disabled>Merge Tracks</button></div></div>`

function renderTimelineRegions() { return timelineRegions.map(() => "").join("") }
function renderTimelineRuler() { return Array.from({ length: timelineState.bars }, (_, index) => `<span class="studio-ruler-bar-label" style="left:${index * timelineState.pixelsPerBar}px">${index + 1}</span>`).join('') }
function renderTimelineLines() { const lines=[]; const ppb=timelineState.pixelsPerBar/timelineState.beatsPerBar; for (let bar=0; bar<=timelineState.bars; bar+=1){ const left=bar*timelineState.pixelsPerBar; lines.push(`<span class="studio-grid-line studio-grid-line--bar" style="left:${left}px"></span>`); if(bar<timelineState.bars){ for(let beat=1; beat<timelineState.beatsPerBar; beat+=1){ lines.push(`<span class="studio-grid-line studio-grid-line--beat" style="left:${left + beat * ppb}px"></span>`) } } } return lines.join('') }
function renderBottomPanel(panel){ const t={loops:['Loop Browser','Loops and samples will appear here.'],fx:['Effects','Track effects and processors will appear here.'],mixer:['Mixer','Channel strips and routing will appear here.'],collab:['Collaboration','Project presence, comments, and invites will appear here.']}[panel]||['Panel','']; return `<section class="studio-bottom-panel"><header class="studio-bottom-panel-header"><strong>${t[0]}</strong><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header><div class="studio-bottom-panel-body"><p>${t[1]}</p></div></section>` }

function renderState(message, buttonHref = ROUTES.studio) { app.innerHTML = `<main class="studio-editor-page studio-editor-state"><div><h1>${message}</h1><a class="button" href="${buttonHref}">Back to Studio</a></div></main>` }

function setEditorMenuOpen(open) {
  isEditorMenuOpen = open
  const panel = app.querySelector('[data-editor-nav-panel]')
  const trigger = app.querySelector('[data-editor-left-menu]')
  if (!panel || !trigger) return
  panel.hidden = !open
  trigger.setAttribute('aria-expanded', String(open))
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)) }
function maxTimelineX() { return timelineState.bars * timelineState.pixelsPerBar }
function setPlayhead(x) { timelineState.playheadX = clamp(x, 0, maxTimelineX()); app.querySelector('[data-arrangement]')?.style.setProperty('--playhead-x', `${timelineState.playheadX}px`) }
function pixelsPerSecond() { const bpm = Number(projectState?.bpm || 140); const bps = bpm / 60; const ppb = timelineState.pixelsPerBar / timelineState.beatsPerBar; return bps * ppb }
function updateTransportPlaybackUI() { const btn = app.querySelector('[data-transport-play]'); if (!btn) return; btn.classList.toggle('is-active', isPlaying); btn.setAttribute('aria-pressed', String(isPlaying)); btn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); btn.innerHTML = isPlaying ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 5v14M16 5v14"/></svg>' : toolIcon('play') }
function tickPlayback(now) { if (!isPlaying) return; const delta=(now-lastPlayTimestamp)/1000; lastPlayTimestamp=now; setPlayhead(timelineState.playheadX + pixelsPerSecond()*delta); if (timelineState.playheadX >= maxTimelineX()) return pausePlayback(); playRaf = requestAnimationFrame(tickPlayback) }
function startPlayback() { if (isPlaying) return; isPlaying = true; lastPlayTimestamp = performance.now(); playRaf = requestAnimationFrame(tickPlayback); updateTransportPlaybackUI() }
function pausePlayback() { isPlaying = false; if (playRaf) cancelAnimationFrame(playRaf); playRaf = 0; updateTransportPlaybackUI() }
function stopPlayback() { pausePlayback() }

function bindEditorEvents() {
  const trigger = app.querySelector('[data-editor-left-menu]')
  const leftWrap = app.querySelector('.studio-editor-left')
  const ruler = app.querySelector('[data-timeline-ruler]')
  const grid = app.querySelector('[data-arrangement-grid]')
  const selectionBox = app.querySelector('[data-selection-box]')
  const tooltip = app.querySelector('[data-studio-tooltip]')
  trigger?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); setEditorMenuOpen(!isEditorMenuOpen) })
  document.onclick = (event) => { if (!event.target.closest('.studio-editor-left') && !event.target.closest('.studio-track-stack')) { setEditorMenuOpen(false); openTrackMenuId = ''; renderEditor() } }
  document.onkeydown = (event) => { if (event.key === 'Escape') { setEditorMenuOpen(false); openTrackMenuId = ''; renderEditor() } }
  leftWrap?.addEventListener('click', (event) => event.stopPropagation())
  app.querySelector('[data-keep-site-menu]')?.addEventListener('change', (e) => { keepSiteMenuOpen = e.target.checked; localStorage.setItem(PREF_KEY, keepSiteMenuOpen ? '1' : '0'); isEditorMenuOpen = false; renderEditor() })
  app.querySelectorAll('[data-track-row]').forEach((el) => el.addEventListener('click', () => { selectedTrackId = el.dataset.trackRow; openTrackMenuId = ''; renderEditor() }))
  const getTrack = (id) => tracks.find((track) => track.id === id)
  const showTooltip = (target) => { if (!tooltip || !target?.dataset?.tooltip) return; tooltip.textContent = target.dataset.tooltip; tooltip.hidden = false; const rect = target.getBoundingClientRect(); const trect = tooltip.getBoundingClientRect(); tooltip.style.left = `${Math.max(8, rect.left + rect.width / 2 - trect.width / 2)}px`; tooltip.style.top = `${Math.max(8, rect.top - trect.height - 8)}px` }
  const hideTooltip = () => { if (tooltip) tooltip.hidden = true }
  app.querySelectorAll('[data-tooltip]').forEach((target) => { target.addEventListener('pointerenter', () => showTooltip(target)); target.addEventListener('pointerleave', hideTooltip); target.addEventListener('focus', () => showTooltip(target)); target.addEventListener('blur', hideTooltip) })
  app.querySelectorAll('[data-track-mute]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackMute); if (!t) return; t.muted = !t.muted; renderEditor() }))
  app.querySelectorAll('[data-track-solo]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackSolo); if (!t) return; t.soloed = !t.soloed; renderEditor() }))
  app.querySelectorAll('[data-track-record]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackRecord); if (!t) return; t.recordArmed = !t.recordArmed; renderEditor() }))
  app.querySelectorAll('[data-track-volume]').forEach((el) => el.addEventListener('input', () => { const t = getTrack(el.dataset.trackVolume); if (!t) return; t.volume = Number(el.value) }))
  app.querySelectorAll('[data-track-automation]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackAutomation); if (!t) return; t.automationOpen = !t.automationOpen; renderEditor() }))
  app.querySelectorAll('[data-track-options]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.trackOptions; openTrackMenuId = openTrackMenuId === id ? '' : id; renderEditor() }))
  app.querySelectorAll('[data-track-pan]').forEach((knob) => knob.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); const t = getTrack(knob.dataset.trackPan); if (!t) return; panDrag = { trackId: t.id, startX: event.clientX, startPan: t.pan, knob }; knob.setPointerCapture?.(event.pointerId) }))
  grid?.addEventListener('scroll', () => { if (ruler) ruler.scrollLeft = grid.scrollLeft })
  const getRulerLocalX = (event) => { const rect = ruler.getBoundingClientRect(); return event.clientX - rect.left + ruler.scrollLeft }
  ruler?.addEventListener('pointerdown', (event) => { event.preventDefault(); timelineState.isDraggingPlayhead = true; setPlayhead(getRulerLocalX(event)) })
  grid?.addEventListener('pointerdown', (event) => { if (event.target !== grid && !event.target.closest('[data-arrangement-grid-inner]')) return; event.preventDefault(); timelineState.isSelecting = true; const rect = grid.getBoundingClientRect(); timelineState.selectionBox = { startX: event.clientX - rect.left + grid.scrollLeft, startY: event.clientY - rect.top + grid.scrollTop }; if (selectionBox) selectionBox.hidden = false })
  window.addEventListener('pointermove', (event) => { if (panDrag) { const t=getTrack(panDrag.trackId); if (t) { t.pan = clamp(panDrag.startPan + (event.clientX-panDrag.startX)/100, -1, 1); panDrag.knob?.style.setProperty('--pan-angle', `${t.pan * 135}deg`) } } if (timelineState.isDraggingPlayhead) { event.preventDefault(); setPlayhead(getRulerLocalX(event)) } if (timelineState.isSelecting && selectionBox && grid) { event.preventDefault(); const rect = grid.getBoundingClientRect(); const x = event.clientX - rect.left + grid.scrollLeft; const y = event.clientY - rect.top + grid.scrollTop; const sx = timelineState.selectionBox.startX; const sy = timelineState.selectionBox.startY; selectionBox.style.left = `${Math.min(sx, x)}px`; selectionBox.style.top = `${Math.min(sy, y)}px`; selectionBox.style.width = `${Math.abs(x - sx)}px`; selectionBox.style.height = `${Math.abs(y - sy)}px`; } })
  window.addEventListener('pointerup', () => { panDrag = null; timelineState.isDraggingPlayhead = false; timelineState.isSelecting = false; if (selectionBox) selectionBox.hidden = true })
  app.querySelector('[data-transport-play]')?.addEventListener('click', (e)=>{ e.stopPropagation(); isPlaying ? pausePlayback() : startPlayback() })
  app.querySelector('[data-transport-stop]')?.addEventListener('click', (e)=>{ e.stopPropagation(); stopPlayback() })
  app.querySelector('[data-transport-start]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(0) })
  app.querySelector('[data-transport-end]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(maxTimelineX()) })
  app.querySelector('[data-transport-rewind]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(timelineState.playheadX - (timelineState.pixelsPerBar / timelineState.beatsPerBar)) })
  app.querySelector('[data-transport-forward]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(timelineState.playheadX + (timelineState.pixelsPerBar / timelineState.beatsPerBar)) })
  app.querySelectorAll('[data-bottom-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.bottomPanel; activeBottomPanel = activeBottomPanel===id ? '' : id; renderEditor() }))
  app.querySelector('[data-close-bottom-panel]')?.addEventListener('click', ()=>{ activeBottomPanel=''; renderEditor() })
  updateTransportPlaybackUI()
}

// TODO: connect navigator.requestMIDIAccess() after MIDI permission UX is designed.
function renderEditor() {
  const project = projectState
  document.body.classList.add('is-studio-editor')
  const shell = `<main class="studio-editor-page ${keepSiteMenuOpen ? 'has-site-nav' : 'is-fullscreen'}"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu" aria-expanded="false">☰</button><nav class="studio-editor-menu"><button>File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button>Help</button></nav><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small>Project loaded</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group studio-tool-group--left">${toolButton('Library','library')}${toolButton('Inspector','inspector')}${toolButton('Notes','notes')}${toolButton('Smart Controls','sliders')}${toolButton('Loop Browser','store')}</div><div class="studio-transport-center"><div class="studio-tool-group studio-tool-group--transport"><button data-transport-start class="studio-tool-button" aria-label="Go to start" data-tooltip="Go to start">${toolIcon('start')}</button> <button data-transport-rewind class="studio-tool-button" aria-label="Rewind" data-tooltip="Rewind">${toolIcon('rewind')}</button> <button data-transport-play class="studio-tool-button ${isPlaying ? 'is-active' : ''}" aria-label="${isPlaying ? 'Pause' : 'Play'}" aria-pressed="${isPlaying}">${isPlaying ? '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><path d=\"M8 5v14M16 5v14\"/></svg>' : toolIcon('play')}</button> <button data-transport-stop class="studio-tool-button" aria-label="Stop">${toolIcon('stop')}</button> ${toolButton('Record','record')} <button data-transport-forward class="studio-tool-button" aria-label="Fast forward" data-tooltip="Fast forward">${toolIcon('forward')}</button> <button data-transport-end class="studio-tool-button" aria-label="Go to end" data-tooltip="Go to end">${toolIcon('end')}</button> ${toolButton('Cycle','loop')}</div><div class="studio-logic-display" aria-label="Project transport display"><section class="studio-logic-section studio-logic-section--time"><strong class="studio-logic-primary">00:00.000.00</strong><span class="studio-logic-secondary">time</span></section><section class="studio-logic-section studio-logic-section--bars"><strong class="studio-logic-primary">001 01 1 001</strong><span class="studio-logic-secondary">bar beat div tick</span></section><section class="studio-logic-section studio-logic-section--tempo"><strong class="studio-logic-primary">${Number(project.bpm || 140).toFixed(4)}</strong><span class="studio-logic-secondary">4/4 <button class="studio-display-icon-button" aria-label="Tempo settings" data-tooltip="Tempo settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/></svg></button></span></section><section class="studio-logic-section studio-logic-section--key"><strong class="studio-logic-primary">${project.key}</strong><span class="studio-logic-secondary">key</span></section><section class="studio-logic-section studio-logic-section--midi"><strong class="studio-logic-primary" data-midi-status>No MIDI</strong><span class="studio-logic-secondary">input</span></section><section class="studio-logic-section studio-logic-section--cpu"><strong class="studio-logic-primary">0%</strong><span class="studio-logic-secondary">CPU</span></section></div><div class="studio-tool-group studio-tool-group--utilities">${toolButton('Metronome','metro')}${toolButton('Count-in','count','studio-tool-button--count-in')}${toolButton('Snap','snap')}<span class="studio-save-status">Saved</span></div></div><div class="studio-transport-spacer" aria-hidden="true"></div></section><div class="studio-editor-workspace"><aside class="studio-track-panel">${tracks.map(renderTrackCard).join('')}</aside><section class="studio-arrangement" data-arrangement style="--bars: ${timelineState.bars}; --beats-per-bar: ${timelineState.beatsPerBar}; --pixels-per-bar: ${timelineState.pixelsPerBar}px; --pixels-per-beat: ${timelineState.pixelsPerBar / timelineState.beatsPerBar}px; --playhead-x: ${timelineState.playheadX}px;"><div class="studio-timeline-ruler" data-timeline-ruler><div class="studio-timeline-ruler-inner" data-timeline-ruler-inner>${renderTimelineRuler()}<span class="studio-ruler-playhead" data-ruler-playhead></span></div></div><div class="studio-arrangement-grid" data-arrangement-grid><div class="studio-arrangement-grid-inner" data-arrangement-grid-inner>${renderTimelineLines()}${renderTimelineRegions()}<span class="studio-grid-playhead" data-grid-playhead></span><div class="studio-selection-box" data-selection-box hidden></div></div></div></section><aside class="studio-right-rail"><button data-bottom-panel="loops">Loops</button><button data-bottom-panel="fx">FX</button><button data-bottom-panel="mixer">Mixer</button><button data-bottom-panel="collab">Collab</button></aside></div>${activeBottomPanel ? renderBottomPanel(activeBottomPanel) : ''}<section class="studio-effects-panel" hidden></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span></footer><div class="studio-tooltip-layer" data-studio-tooltip hidden></div></main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  if (keepSiteMenuOpen) initShellChrome()
  setEditorMenuOpen(isEditorMenuOpen)
  bindEditorEvents()
}

if (!window.__studioSpaceKeyBound) { window.__studioSpaceKeyBound = true; document.addEventListener('keydown', (event) => { if (event.code === 'Space' && !event.target.matches('input, textarea, [contenteditable="true"]')) { event.preventDefault(); isPlaying ? pausePlayback() : startPlayback() } }) }

async function init() { renderState('Loading project...'); const user = await waitForInitialAuthState(); if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname })); const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.'); const project = await getStudioProject(id); if (!project) return renderState('Studio project not found.'); if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.'); touchStudioProject(project.id).catch(() => {}); projectState = project; renderEditor() }
init()
