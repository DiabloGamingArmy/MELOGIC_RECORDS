import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute } from './utils/routes'
import { getStudioProject, touchStudioProject, saveStudioProjectEditorState } from './data/studioProjectService'
import { StudioAudioEngine } from './studio/audio/StudioAudioEngine.js'
import { normalizeStudioProjectModel } from './studio/model/studioProjectModel.js'
import { InstrumentRegistry } from './studio/instruments/InstrumentRegistry.js'
import { DawWindowManager } from './studio/plugins/DawWindowManager.js'
import { DAW_PLUGIN_TYPES } from './studio/plugins/pluginCatalog.js'
import { renderPluginShell } from './studio/plugins/MelogicWavetableShell.js'
import { getDawPluginManifest, listDawInstruments } from './daw/pluginHost/pluginRegistry.js'
import { MIDI_EFFECT_MANIFESTS } from './daw/midiEffects/catalog.js'
import { AUDIO_EFFECT_MANIFESTS } from './daw/audioEffects/catalog.js'
import './styles/dawPluginWindow.css'

const app = document.querySelector('#app')
const reserved = new Set(['demos', 'tutorials', 'project', 'distribution', 'daw', 'stagemaker'])
const PREF_KEY = 'melogic_studio_keep_site_menu_open'
let keepSiteMenuOpen = localStorage.getItem(PREF_KEY) === '1'
let projectState = null
const dawInstrumentRegistry = new InstrumentRegistry({
  getAudioContext: () => getAudioContext(),
  getDestination: () => getAudioContext().destination
})
const dawWindowManager = new DawWindowManager({
  renderContent: (pluginWindow) => renderPluginShell(pluginWindow, { hostMode: 'inline' }),
  getHostUrl: (pluginWindow) => {
    const params = new URLSearchParams({
      pluginInstanceId: pluginWindow.pluginInstanceId,
      pluginType: pluginWindow.pluginType,
      trackId: pluginWindow.trackId || ''
    })
    return `${ROUTES.studioInstrumentHost}?${params.toString()}`
  },
  onOpen: (pluginWindow) => {
    dawInstrumentRegistry.createOrGet({
      id: pluginWindow.pluginInstanceId,
      type: pluginWindow.pluginType,
      trackId: pluginWindow.trackId,
      params: pluginWindow.params
    })
  },
  onClose: (pluginInstanceId) => {
    dawInstrumentRegistry.dispose(pluginInstanceId)
  },
  onParamChange: (pluginInstanceId, param, value) => {
    dawInstrumentRegistry.setParam(pluginInstanceId, param, value)
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    if (track?.instrument) track.instrument.params = { ...(track.instrument.params || {}), [param]: value }
  },
  onNoteOn: (pluginInstanceId, note, velocity) => {
    dawInstrumentRegistry.noteOn(pluginInstanceId, note, velocity)
  },
  onNoteOff: (pluginInstanceId, note) => {
    dawInstrumentRegistry.noteOff(pluginInstanceId, note)
  },
  onChange: () => renderEditor()
})
let isEditorMenuOpen = false
let selectedTrackId = 'demo-track'
const automationOpenTrackIds = new Set()
let openTrackMenuId = ''
let activeBottomPanel = ''
const activeInstrumentNotes = new Map()
const pressedKeyboardNotes = new Set()
let instrumentAudioContext = null
let instrumentMasterGain = null
let instrumentPanNode = null
let instrumentVolume = 0.35
let instrumentPan = 0
let instrumentTreble = 0.5
let instrumentReverb = 0.3
let instrumentOctaveOffset = 0
let instrumentMacroView = 'knobs'
let macroPadPosition = { x: 0.5, y: 0.5 }
let instrumentMacros = [
  { id: 'macro-1', label: 'Tone', value: 0.5 },
  { id: 'macro-2', label: 'Motion', value: 0.5 },
  { id: 'macro-3', label: 'Attack', value: 0.25 },
  { id: 'macro-4', label: 'Release', value: 0.35 },
  { id: 'macro-5', label: 'Drive', value: 0.2 },
  { id: 'macro-6', label: 'Width', value: 0.65 },
  { id: 'macro-7', label: 'Filter', value: 0.55 },
  { id: 'macro-8', label: 'Texture', value: 0.4 }
]
let isSustainEnabled = false
let selectedInstrumentName = 'Grand Piano'
let activeInstrumentSubpage = 'keyboard'
const instrumentSubpages = [
  { id: 'presets', label: 'Presets' },
  { id: 'keyboard', label: 'Keyboard' },
  { id: 'chords', label: 'Chords' },
  { id: 'arp', label: 'Arp' },
  { id: 'midi-roll', label: 'MIDI Roll' },
  { id: 'effects', label: 'Effects' }
]
const chordRoots = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const chordOctaves = ['Oct 1','Oct 2','Oct 3','Oct 4','Oct 5','Oct 6']
const instrumentPresetCategories = ['All', 'Piano', 'Keys', 'Synth', 'Bass', 'Pads', 'Leads']
const instrumentPresetItems = [
  { id: 'grand-piano', name: 'Grand Piano', category: 'Piano', description: 'Clean default piano tone', tags: ['Natural', 'Starter'] },
  { id: 'soft-keys', name: 'Soft Keys', category: 'Keys', description: 'Rounded keyboard tone for chords', tags: ['Warm', 'Smooth'] },
  { id: 'analog-lead', name: 'Analog Lead', category: 'Leads', description: 'Simple bright lead tone', tags: ['Mono', 'Bright'] },
  { id: 'sub-bass', name: 'Sub Bass', category: 'Bass', description: 'Low simple bass patch', tags: ['Low', 'Clean'] },
  { id: 'wide-pad', name: 'Wide Pad', category: 'Pads', description: 'Soft atmospheric pad', tags: ['Wide', 'Ambient'] }
]
const arpModes = ['Up','Down','Up/Down','Random','As Played','Chord Repeat']
const arpRates = ['1/4','1/8','1/16','1/32','1/8D','1/8T']
const arpLengths = [4,8,12,16,24,32]
const arpPatternPresets = ['Straight 8ths','Rolling 16ths','Trance Gate','Dubstep Pulse','Bass Bounce','Up 2 Octaves','Random Pluck','Chord Repeat']
const arpNoteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
let isPlaying = false
let playRaf = 0
let lastPlayTimestamp = 0
let panDrag = null
let followPlayhead = false
let isCycleEnabled = false
let isMetronomeEnabled = true
let audioContext = null
let studioAudioEngine = null
let lastMetronomeBeat = -1
let activeLeftPanel = ""
let inspectorMenu = null
let isNotesOpen = false
let notePages = [{ id: 'page-1', title: 'Page 1', body: '' }]
let activeNotePageId = 'page-1'
let isSnapEnabled = false
let isCountInEnabled = true
let isCountInRunning = false
let countInTimer = 0
let countInBeatsRemaining = 0
let recordingStatus = ''
let cycleRange = null
let cycleDrag = null
let spacePlaybackStartX = null
let saveTimer = 0
let isEditorLoaded = false
let saveStatus = 'Saved'
let bottomPanelMotion = ''
let closingBottomPanel = ''
let bottomPanelMotionTimer = 0
let arpEnabled = false
let arpMode = 'Up/Down'
let arpRate = '1/16'
let arpOctaves = 2
let arpGate = 70
let arpSwing = 12
let arpVelocity = 80
let arpLength = 16
let selectedArpStepIndex = 0
let currentArpPatternName = 'Custom Pattern'
let arpEditMode = 'velocity'
let arpNotePickerStepIndex = null
let arpNotePickerOctave = 4
const arpEditModes = [
  { id: 'note', label: 'Note' },
  { id: 'velocity', label: 'Velocity' },
  { id: 'octave', label: 'Octave' },
  { id: 'gate', label: 'Gate' },
  { id: 'probability', label: 'Probability' },
  { id: 'accent', label: 'Accent' },
  { id: 'tie', label: 'Tie' }
]
const createDefaultArpStep = (i=0)=>({ active:i%2===0, note:0, noteOctave:4, velocity:[100,55,0,75][i%4], octave:i%4===2?-1:(i%4===0?1:0), gate:70, probability:100, accent:i%4===0, tie:false })
const normalizeArpStep = (step={}, i=0)=>({
  active: Boolean(step.active),
  note: Number.isFinite(Number(step.note)) ? clamp(Number(step.note), 0, 11) : createDefaultArpStep(i).note,
  noteOctave: Number.isFinite(Number(step.noteOctave)) ? clamp(Number(step.noteOctave), 0, 8) : 4,
  velocity: Number.isFinite(Number(step.velocity)) ? clamp(Number(step.velocity), 1, 127) : createDefaultArpStep(i).velocity,
  octave: Number.isFinite(Number(step.octave)) ? clamp(Number(step.octave), -2, 4) : createDefaultArpStep(i).octave,
  gate: Number.isFinite(Number(step.gate)) ? clamp(Number(step.gate), 10, 100) : createDefaultArpStep(i).gate,
  probability: Number.isFinite(Number(step.probability)) ? clamp(Number(step.probability), 0, 100) : createDefaultArpStep(i).probability,
  accent: Boolean(step.accent),
  tie: Boolean(step.tie)
})
let arpSteps = Array.from({length:16}, (_,i)=>createDefaultArpStep(i))

const timelineState = { bars: 20, beatsPerBar: 4, positiveBeats: 80, pixelsPerBar: 120, preStartPixels: 0, playheadX: 0, trackHeight: 96, selectionBox: null, isSelecting: false, isDraggingPlayhead: false }
// Future canonical source: beat-based regions from studioProjectModel; UI still renders existing DOM grid for now.
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
    outputLevel: 0,
    midiEffects: [],
    instrument: null,
    audioEffects: []
  }
]

const MIDI_EFFECT_TYPES = MIDI_EFFECT_MANIFESTS.map(({ id, name }) => ({ type: id, name }))
const AUDIO_EFFECT_TYPES = AUDIO_EFFECT_MANIFESTS.map(({ id, name }) => ({ type: id, name }))

const studioProjectModel = normalizeStudioProjectModel({ tracks, regions: timelineRegions })

const projectIdFromPath = () => {
  const parts = (window.location.pathname || '').split('/').filter(Boolean)
  if (parts[0] === 'studio' && parts[1] === 'daw' && parts[2] === 'project') return decodeURIComponent((parts[3] || '').trim())
  if (parts[0] === 'studio' && parts[1] === 'project') return decodeURIComponent((parts[2] || '').trim())
  return decodeURIComponent((parts[1] || '').trim())
}
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

const renderTrackCard = (track) => `<div class="studio-track-stack"><article class="studio-track-card ${selectedTrackId === track.id ? 'is-selected' : ''} ${timelineState.trackHeight <= 56 ? 'is-track-compact' : ''}" data-track-row="${track.id}" style="--track-color: ${track.color}; --track-color-soft: ${track.colorSoft};"><div class="studio-track-header-row"><button class="studio-track-icon" type="button" aria-label="${track.name} track" data-track-icon="${track.id}">${trackTypeIcon(track.type)}</button><strong class="studio-track-name">${track.name}</strong><button class="studio-track-more" data-track-options="${track.id}" aria-label="Track options" data-tooltip="Track options">${icon('more')}</button></div><div class="studio-track-control-row"><button class="studio-track-control ${track.muted ? 'is-active' : ''}" data-track-mute="${track.id}" aria-label="Mute ${track.name}" data-tooltip="Mute">${icon('mute')}</button><button class="studio-track-control ${track.soloed ? 'is-active' : ''}" data-track-solo="${track.id}" aria-label="Solo ${track.name}" data-tooltip="Solo">${icon('solo')}</button><button class="studio-record-arm ${track.recordArmed ? 'is-active' : ''}" data-track-record="${track.id}" aria-label="Record arm ${track.name}" data-tooltip="Record arm">R</button><button class="studio-track-control" data-track-automation="${track.id}" aria-label="Automation ${track.name}" data-tooltip="Automation">${icon('automation')}</button><input class="studio-track-volume" data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}" aria-label="${track.name} volume" /><button class="studio-track-pan" type="button" aria-label="${track.name} pan" data-tooltip="Pan" data-track-pan="${track.id}" style="--pan-angle: ${track.pan * 135}deg"></button></div></article>${track.automationOpen ? '<div class="studio-automation-lane"><span>Automation</span><button>Volume</button><button>Pan</button><button>Filter</button><button>Add</button></div>' : ''}<div class="studio-track-menu" ${openTrackMenuId === track.id ? '' : 'hidden'}><button>Rename</button><button>Duplicate</button><button disabled>Delete</button><button>Freeze Track</button><button>Freeze All Tracks</button><button>Import MIDI File</button><button>Export Track</button><button>Track Color</button><button disabled>Merge Tracks</button></div></div>`

function renderTimelineRegions() { return timelineRegions.map(() => "").join("") }
function barToX(index){ return barZeroX() + (index * timelineState.pixelsPerBar) }
function preStartBarCount(){ return Math.floor((timelineState.preStartPixels || 0) / timelineState.pixelsPerBar) }
function renderTimelineRuler() { const labels=[]; const negBars=preStartBarCount(); for(let i=negBars; i>=1; i-=1){ const x=barZeroX() - i*timelineState.pixelsPerBar; if(x>=0) labels.push(`<span class="studio-ruler-bar-label" style="left:${x}px">-${i}</span>`) } labels.push(`<span class="studio-ruler-bar-label" style="left:${barZeroX()}px">0</span>`); const barCount=Math.max(1,Math.ceil(timelineState.positiveBeats/timelineState.beatsPerBar)); for(let index=1; index<=barCount; index+=1){ const x=barToX(index); if (x<=timelineEndX()) labels.push(`<span class="studio-ruler-bar-label" style="left:${x}px">${index}</span>`) } return labels.join('') }
function renderCycleRange(){ if(!cycleRange) return ''; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return `<div class="studio-cycle-range ${isCycleEnabled ? 'is-enabled' : ''}" data-cycle-range style="left:${start}px;width:${Math.max(0,end-start)}px"><span class="studio-cycle-range-handle" data-cycle-handle="start"></span><span class="studio-cycle-range-body" data-cycle-drag="move"></span><span class="studio-cycle-range-handle" data-cycle-handle="end"></span></div>` }
function renderCycleBoundaryGuides(){ if(!cycleRange) return ''; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return `<span class="studio-cycle-guide studio-cycle-guide--start ${isCycleEnabled ? 'is-enabled' : ''}" style="left:${start}px"></span><span class="studio-cycle-guide studio-cycle-guide--end ${isCycleEnabled ? 'is-enabled' : ''}" style="left:${end}px"></span>` }
function renderTimelineLines() { const lines=[]; const ppb=beatWidth(); const negBeats=preStartBarCount()*timelineState.beatsPerBar; for (let beatIndex=-negBeats; beatIndex<=timelineState.positiveBeats; beatIndex+=1){ const left=beatsFromBarZeroToX(beatIndex); if(left<0||left>timelineEndX()) continue; lines.push(`<span class="studio-grid-line ${beatIndex%timelineState.beatsPerBar===0?'studio-grid-line--bar':'studio-grid-line--beat'}" style="left:${left}px"></span>`) } return lines.join('') }
function getInstrumentKeys(){
  const whites=[0,2,4,5,7,9,11]
  const blackOffsets={1:'S',3:'D',6:'G',8:'H',10:'J'}
  const labels=['Z','X','C','V','B','N','M',',','.','Q','W','E','R','T','Y','U','I','O','P']
  const keys=[]
  let whiteIndex=0
  for(let midi=48;midi<=84;midi+=1){
    const pitchClass=((midi%12)+12)%12
    const isWhite=whites.includes(pitchClass)
    const octave=Math.floor(midi/12)-1
    const whiteSlot = isWhite ? whiteIndex : Math.max(0, whiteIndex - 1)
    keys.push({ midi, isWhite, whiteSlot, octaveLabel:isWhite&&pitchClass===0?`C${octave}`:'', keyLabel:isWhite?(labels[whiteIndex++]||''):(blackOffsets[pitchClass]||''), keyboardCode:'' })
  }
  return keys
}
function getSelectedTrack(){ return tracks.find((track)=>track.id===selectedTrackId) || tracks[0] }
function syncSelectedTrackVolumeControl(track){ if(!track) return; const input=app.querySelector(`[data-track-volume="${track.id}"]`); if(!input) return; input.value=String(track.volume); input.setAttribute('value', String(track.volume)) }
function getInstrumentKnobDescriptors(){
  const selected=getSelectedTrack()
  const trackVolume=Number.isFinite(Number(selected?.volume)) ? Number(selected.volume) : Math.round(instrumentVolume*100)
  const trackPan=Number.isFinite(Number(selected?.pan)) ? Number(selected.pan) : instrumentPan
  instrumentVolume=clamp(trackVolume/100,0,1)
  instrumentPan=clamp(trackPan,-1,1)
  return [{label:'Pan',value:instrumentPan,min:-1,max:1,step:0.01,key:'pan'},{label:'Volume',value:instrumentVolume,min:0,max:1,step:0.01,key:'volume'}]
}
function renderInstrumentKeyboardView(){
  const keys=getInstrumentKeys();
  const white=keys.filter(k=>k.isWhite); const black=keys.filter(k=>!k.isWhite); const whiteCount=Math.max(1,white.length)
  return `<div class="studio-virtual-keyboard" data-virtual-keyboard style="--white-key-count:${whiteCount};"><div class="studio-piano-white-keys">${white.map(k=>`<button class="studio-piano-key studio-piano-key--white ${activeInstrumentNotes.has(k.midi+instrumentOctaveOffset*12)?'is-pressed':''}" data-midi="${k.midi}" data-piano-midi="${k.midi}" data-key-type="white"><span>${k.octaveLabel}</span><small>${k.keyLabel}</small></button>`).join('')}</div><div class="studio-piano-black-keys" aria-hidden="false">${black.map(k=>`<button class="studio-piano-key studio-piano-key--black ${activeInstrumentNotes.has(k.midi+instrumentOctaveOffset*12)?'is-pressed':''}" data-midi="${k.midi}" data-piano-midi="${k.midi}" style="left:${((k.whiteSlot + 1) / whiteCount) * 100}%"><small>${k.keyLabel}</small></button>`).join('')}</div></div>`
}
function renderInstrumentChordsView(){
  return `<div class="studio-chord-keyboard" data-chord-keyboard>${chordRoots.map((root)=>`<button class="studio-chord-key" type="button" data-chord-root="${root}"><strong>${root}</strong><span class="studio-chord-key-quality">Major / Minor</span><span class="studio-chord-key-octaves" aria-hidden="true">${chordOctaves.map((octave)=>`<span>${octave}</span>`).join('')}</span></button>`).join('')}</div>`
}
function renderInstrumentPresetsView() {
  return `<section class="studio-presets-page" data-instrument-subpage-view="presets"><header class="studio-presets-header"><div><h3>Presets</h3><p>Choose a starting sound for the selected instrument.</p></div><label class="studio-presets-search"><span>Search</span><input data-preset-search type="search" placeholder="Search presets..." /></label></header><div class="studio-presets-categories" role="list">${instrumentPresetCategories.map((category,index)=>`<button type="button" class="studio-presets-category ${index===0?'is-active':''}" data-preset-category="${category}">${category}</button>`).join('')}</div><section class="studio-presets-list" role="table" aria-label="Instrument presets"><div class="studio-presets-list-header" role="row"><span>Name</span><span>Category</span><span>Description</span><span>Tags</span><span>Action</span></div><div class="studio-presets-list-body">${instrumentPresetItems.map((preset)=>`<article class="studio-preset-row" role="row" data-preset-id="${preset.id}" data-preset-category-name="${preset.category}"><strong>${preset.name}</strong><span>${preset.category}</span><span>${preset.description}</span><span class="studio-preset-row-tags">${preset.tags.map((tag)=>`<em>${tag}</em>`).join('')}</span><button type="button" data-preset-load="${preset.id}">Load</button></article>`).join('')}</div></section></section>`
}

function getArpStepValueForMode(step, mode){ if(!step) return 0; if(mode==='note') return step.note ?? 0; if(mode==='velocity') return step.velocity ?? 0; if(mode==='octave') return step.octave ?? 0; if(mode==='gate') return step.gate ?? arpGate; if(mode==='probability') return step.probability ?? 100; if(mode==='accent') return step.accent ? 1 : 0; if(mode==='tie') return step.tie ? 1 : 0; return step.velocity ?? 0 }
function getArpStepBarHeight(step, mode){ if(!step?.active) return 0; if(mode==='velocity') return Math.max(4, Math.round(((step.velocity ?? 0)/127)*100)); if(mode==='gate') return Math.max(4, Math.round(((step.gate ?? arpGate)/100)*100)); if(mode==='probability') return Math.max(4, Math.round(((step.probability ?? 100)/100)*100)); if(mode==='octave') return Math.max(10, 50 + ((step.octave ?? 0)*20)); if(mode==='note') return Math.max(10, 50 + ((step.note ?? 0)*3)); if(mode==='accent') return step.accent ? 100 : 18; if(mode==='tie') return step.tie ? 100 : 18; return 50 }
function getArpStepLabelForMode(step, mode){ if(!step) return ''; if(mode==='note') return `${(step.note ?? 0) >= 0 ? '+' : ''}${step.note ?? 0} st`; if(mode==='velocity') return String(step.velocity ?? 0); if(mode==='octave') return (step.octave ?? 0) === 0 ? '0' : ((step.octave ?? 0) > 0 ? `+${step.octave}` : `${step.octave}`); if(mode==='gate') return `${step.gate ?? arpGate}%`; if(mode==='probability') return `${step.probability ?? 100}%`; if(mode==='accent') return step.accent ? 'Accent' : 'Normal'; if(mode==='tie') return step.tie ? 'Tie' : 'Free'; return '' }
function cycleArpStepByMode(step, mode){ if(!step) return; if(mode==='octave'){ const values=[-2,-1,0,1,2,3,4]; const i=values.indexOf(step.octave ?? 0); step.octave=values[(i+1+values.length)%values.length] } else if(mode==='gate'){ const values=[10,25,50,70,85,100]; const i=values.indexOf(step.gate ?? arpGate); step.gate=values[(i+1+values.length)%values.length] } else if(mode==='probability'){ const values=[0,25,50,75,100]; const i=values.indexOf(step.probability ?? 100); step.probability=values[(i+1+values.length)%values.length] } else if(mode==='accent') step.accent=!step.accent; else if(mode==='tie') step.tie=!step.tie }


function getArpStepNoteLabel(step){ const note=Number.isFinite(Number(step?.note))?Number(step.note):0; const octave=Number.isFinite(Number(step?.noteOctave))?Number(step.noteOctave):arpNotePickerOctave; const name=arpNoteNames[((note%12)+12)%12]; return `${name}${octave}` }
function getVelocityFromStepPointer(event, element){ const rect=element.getBoundingClientRect(); const ratio=1-clamp((event.clientY-rect.top)/Math.max(1,rect.height),0,1); return clamp(Math.round(1+ratio*126),1,127) }
function renderArpNotePicker(){ const step=arpSteps[arpNotePickerStepIndex]||null; return `<section class="studio-arp-note-picker" data-arp-note-picker><header><div><strong>Assign Note</strong><span>Step ${(arpNotePickerStepIndex ?? 0)+1}</span></div><div class="studio-arp-note-picker-octave"><button type="button" class="studio-arp-button" data-arp-note-picker-octave="-1">−</button><strong>Oct ${arpNotePickerOctave}</strong><button type="button" class="studio-arp-button" data-arp-note-picker-octave="1">+</button></div><button type="button" class="studio-arp-button" data-arp-note-picker-close>Cancel</button></header><div class="studio-arp-note-picker-keys">${arpNoteNames.map((name,index)=>`<button type="button" class="studio-arp-note-picker-key ${index===step?.note&&arpNotePickerOctave===step?.noteOctave?'is-selected':''}" data-arp-note-value="${index}"><strong>${name}</strong><span>${name}${arpNotePickerOctave}</span></button>`).join('')}</div></section>` }

function renderInstrumentArpView(){
  const step = normalizeArpStep(arpSteps[selectedArpStepIndex] || arpSteps[0], selectedArpStepIndex)
  const arpLegendByMode = { note:'Bar = Velocity · Label = Note', velocity:'Bar = Velocity · Label = Velocity', octave:'Bar = Octave Offset · Label = Octave', gate:'Bar = Gate Length · Label = Gate', probability:'Bar = Trigger Chance · Label = Probability', accent:'Bar = Accent State · Label = Accent', tie:'Bar = Tie State · Label = Tie' }
  const arpStepArea = arpEditMode === 'note' && arpNotePickerStepIndex !== null
    ? renderArpNotePicker()
    : `<div class="studio-arp-steps ${arpEnabled?'':'is-arp-disabled'}">${arpSteps.slice(0,arpLength).map((raw,i)=>{ const st=normalizeArpStep(raw,i); const bar=getArpStepBarHeight(st,arpEditMode); return `<button type="button" class="studio-arp-step studio-arp-step--${arpEditMode} ${(st.octave??0)<0?'is-negative-octave':''} ${(st.octave??0)>0?'is-positive-octave':''} ${(st.probability??100)===0?'is-probability-zero':''} ${st.active?'is-active':'is-muted'} ${st.accent?'is-accent':''} ${st.tie?'is-tie':''} ${selectedArpStepIndex===i?'is-selected':''}" data-arp-step="${i}"><span>${i+1}</span>${st.active?`<em style="height:${bar}%"></em>`:'<i>•</i>'}${arpEditMode==='note'?`<span class="studio-arp-step-note-label">${getArpStepNoteLabel(st)}</span>`:''}<small>${getArpStepLabelForMode(st,arpEditMode)}</small></button>` }).join('')}</div>`
  return `<section class="studio-arp-page" data-instrument-subpage-view="arp" data-arp-edit-mode="${arpEditMode}"><section class="studio-arp-top-grid"><div class="studio-arp-top-left"><div class="studio-arp-control-group studio-arp-control-group--playback"><span>Playback</span><button type="button" class="studio-arp-power-switch ${arpEnabled?'is-active':''}" data-arp-toggle aria-pressed="${String(arpEnabled)}"><span class="studio-arp-power-track"><span class="studio-arp-power-thumb"></span></span><strong>Arp</strong><em>${arpEnabled?'On':'Off'}</em></button><label>Mode<select data-arp-mode>${arpModes.map((x)=>`<option ${arpMode===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Rate<select data-arp-rate>${arpRates.map((x)=>`<option ${arpRate===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Length<select data-arp-length>${arpLengths.map((x)=>`<option ${arpLength===x?'selected':''}>${x}</option>`).join('')}</select></label><label>Octaves<div class="studio-arp-stepper"><button type="button" class="studio-arp-button" data-arp-octave="-1">−</button><strong data-arp-octave-value>${arpOctaves}</strong><button type="button" class="studio-arp-button" data-arp-octave="+1">+</button></div></label></div><nav class="studio-arp-edit-modes" aria-label="Arp step assignment mode">${arpEditModes.map((mode)=>`<button type="button" class="studio-arp-button ${arpEditMode===mode.id?'is-active':''}" data-arp-edit-mode="${mode.id}" aria-pressed="${String(arpEditMode===mode.id)}">${mode.label}</button>`).join('')}</nav></div><div class="studio-arp-control-group studio-arp-control-group--feel"><span>Feel</span><label>Gate<input data-arp-gate type="range" min="10" max="100" value="${arpGate}"/><small>${arpGate}%</small></label><label>Swing<input data-arp-swing type="range" min="0" max="75" value="${arpSwing}"/><small>${arpSwing}%</small></label><label>Velocity<input data-arp-velocity type="range" min="1" max="127" value="${arpVelocity}"/><small>${arpVelocity}</small></label></div></section><div class="studio-arp-legend">${arpLegendByMode[arpEditMode]||''}</div><div class="studio-arp-main">${arpStepArea}<aside class="studio-arp-properties studio-arp-presets"><header class="studio-arp-properties-header"><div><strong>Arp Properties</strong><span>Pattern: ${currentArpPatternName}</span></div><div class="studio-arp-actions"><button type="button" class="studio-arp-button" data-arp-reset>Reset</button><button type="button" class="studio-arp-button" data-arp-randomize>Randomize</button><button type="button" class="studio-arp-button" disabled title="Print to MIDI will be available once MIDI regions are enabled.">Print to MIDI</button></div></header><div class="studio-arp-properties-scroll"><section class="studio-arp-pattern-list">${arpPatternPresets.map((name)=>`<button type="button" class="studio-arp-button studio-arp-button--ghost" data-arp-pattern="${name}">${name}</button>`).join('')}</section><section class="studio-arp-step-inspector"><header><strong>Step ${selectedArpStepIndex+1}</strong><span>${arpEditModes.find((m)=>m.id===arpEditMode)?.label||'Step'} Mode</span></header><label class="studio-arp-inspector-toggle"><input type="checkbox" data-arp-step-active ${step.active?'checked':''}>Active</label><label>Note<input type="number" data-arp-step-note min="0" max="11" value="${step.note ?? 0}"><small>${getArpStepNoteLabel(step)}</small></label><label>Octave<input type="number" data-arp-step-note-octave min="0" max="8" value="${step.noteOctave ?? 4}"></label><label>Velocity<input type="range" data-arp-step-velocity min="1" max="127" value="${step.velocity ?? arpVelocity}"><small data-arp-step-velocity-value>${step.velocity ?? arpVelocity}</small></label><label>Step Octave<input type="number" data-arp-step-octave min="-2" max="4" value="${step.octave ?? 0}"></label><label>Gate<input type="range" data-arp-step-gate min="10" max="100" value="${step.gate ?? arpGate}"><small data-arp-step-gate-value>${step.gate ?? arpGate}%</small></label><label>Probability<input type="range" data-arp-step-probability min="0" max="100" value="${step.probability ?? 100}"><small data-arp-step-probability-value>${step.probability ?? 100}%</small></label><label class="studio-arp-inspector-toggle"><input type="checkbox" data-arp-step-accent ${step.accent?'checked':''}>Accent</label><label class="studio-arp-inspector-toggle"><input type="checkbox" data-arp-step-tie ${step.tie?'checked':''}>Tie</label></section></div></aside></div></section>`
}
function renderInstrumentPlaceholderView(){
  const page=instrumentSubpages.find((item)=>item.id===activeInstrumentSubpage)
  return `<section class="studio-instrument-subpage-placeholder" data-instrument-subpage-view="${activeInstrumentSubpage}"><h3>${page?.label || 'Instrument'}</h3><p>${page?.label || 'This'} controls will appear here.</p></section>`
}
function renderInstrumentPanelContent(){ if(activeInstrumentSubpage==='presets') return renderInstrumentPresetsView(); if(activeInstrumentSubpage==='keyboard') return renderInstrumentKeyboardView(); if(activeInstrumentSubpage==='chords') return renderInstrumentChordsView(); if(activeInstrumentSubpage==='arp') return renderInstrumentArpView(); return renderInstrumentPlaceholderView() }
function shouldShowInstrumentPerformanceControls(){ return ['keyboard','chords'].includes(activeInstrumentSubpage) }
function renderInstrumentPerformanceControls(){
  return `<div class="studio-instrument-toolbar"><div class="studio-instrument-left"><div class="studio-instrument-selector"><label>Instrument</label><select data-instrument-select><option ${selectedInstrumentName==='Grand Piano'?'selected':''}>Grand Piano</option><option ${selectedInstrumentName==='Soft Keys'?'selected':''}>Soft Keys</option><option ${selectedInstrumentName==='Analog Lead'?'selected':''}>Analog Lead</option><option ${selectedInstrumentName==='Bass'?'selected':''}>Bass</option></select></div><div class="studio-instrument-controls"><button data-sustain-toggle class="${isSustainEnabled?'is-active':''}">Sustain</button><div class="studio-instrument-octave"><span class="studio-instrument-octave-label">Octave</span><div class="studio-instrument-octave-controls"><button data-octave-down aria-label="Octave down">−</button><strong class="studio-octave-readout">${instrumentOctaveOffset>0?'+':''}${instrumentOctaveOffset}</strong><button data-octave-up aria-label="Octave up">+</button></div></div></div></div><div class="studio-instrument-knob-bank">${getInstrumentKnobDescriptors().map((knob)=>`<label class="studio-instrument-knob"><span class="studio-instrument-knob-label">${knob.label}</span><button class="studio-instrument-knob-dial" type="button" data-instrument-knob-dial="${knob.key}" style="--knob-angle:${-135 + ((knob.value-knob.min)/(knob.max-knob.min))*270}deg" aria-label="${knob.label}"><input data-instrument-knob="${knob.key}" type="range" min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${knob.value}"></button><span class="studio-instrument-knob-value" data-instrument-knob-value="${knob.key}">${knob.key==='pan'?knob.value.toFixed(2):`${Math.round(knob.value*100)}%`}</span></label>`).join('')}</div></div><div class="studio-instrument-divider"></div>`
}
function renderInstrumentPanel(){
  const showPerformanceControls=shouldShowInstrumentPerformanceControls()
  return `<section class="studio-bottom-panel studio-instrument-panel"><header class="studio-bottom-panel-header studio-instrument-panel-header"><strong>Instrument</strong><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header><div class="studio-bottom-panel-body">${showPerformanceControls?renderInstrumentPerformanceControls():''}<div class="studio-instrument-content" data-instrument-content>${renderInstrumentPanelContent()}</div></div></section>`
}
function renderBottomPanel(panel,motionClass=''){ if(panel==='instrument') return renderInstrumentPanel().replace('studio-bottom-panel studio-instrument-panel', `studio-bottom-panel studio-instrument-panel ${motionClass}`.trim()); const t={loops:['Loop Browser','Loops and samples will appear here.'],fx:['Effects','Track effects and processors will appear here.'],mixer:['Mixer','Channel strips and routing will appear here.'],collab:['Collaboration','Project presence, comments, and invites will appear here.']}[panel]||['Panel','']; return `<section class="studio-bottom-panel ${motionClass}"><header class="studio-bottom-panel-header"><strong>${t[0]}</strong><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></header><div class="studio-bottom-panel-body"><p>${t[1]}</p></div></section>` }

function makeInsertId(prefix = 'insert') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }
function ensureTrackInsertState(track) {
  if (!track) return null
  if (!Array.isArray(track.midiEffects)) track.midiEffects = []
  if (!Array.isArray(track.audioEffects)) track.audioEffects = []
  if (track.instrument && typeof track.instrument !== 'object') track.instrument = null
  return track
}
function createInsert(type, catalog = []) {
  const item = catalog.find((entry) => entry.type === type) || catalog[0]
  return item ? { id: makeInsertId(item.type), type: item.type, name: item.name, enabled: true, params: {} } : null
}
function createTrackInstrument(pluginType = DAW_PLUGIN_TYPES.melogicWavetable, trackId = selectedTrackId) {
  const manifest = getDawPluginManifest(pluginType)
  return {
    id: makeInsertId('instrument'),
    type: pluginType,
    name: manifest?.name || 'Melogic Wavetable',
    enabled: true,
    pluginInstanceId: `${pluginType}:${trackId || 'track'}`,
    params: {}
  }
}
function renderInsertMenu({ menuId, items, action }) {
  if (inspectorMenu !== menuId) return ''
  return `<div class="studio-inspector-menu" data-inspector-menu="${menuId}">${items.map((item)=>`<button type="button" data-inspector-menu-choice="${action}" data-insert-type="${item.type}">${item.name}</button>`).join('')}</div>`
}
function renderInsertSlot(insert, section) {
  return `<article class="studio-insert-slot ${insert.enabled ? 'is-enabled' : 'is-disabled'}">
    <button type="button" class="studio-insert-power ${insert.enabled ? 'is-active' : ''}" data-toggle-insert="${section}" data-insert-id="${insert.id}" aria-label="Toggle ${insert.name}">${insert.enabled ? 'On' : 'Off'}</button>
    <div><strong>${insert.name}</strong><span>${section === 'midi' ? 'MIDI FX placeholder' : 'Audio FX placeholder'}</span></div>
    <button type="button" data-edit-insert="${section}" data-insert-id="${insert.id}">Edit</button>
    <button type="button" data-remove-insert="${section}" data-insert-id="${insert.id}">Remove</button>
  </article>`
}
function renderInspectorSection({ title, kicker, emptyText, items, section, addLabel, menuId, menuItems, action }) {
  return `<section class="studio-inspector-section">
    <header><div><span>${kicker}</span><h4>${title}</h4></div><button type="button" data-toggle-inspector-menu="${menuId}">${addLabel}</button></header>
    <div class="studio-insert-list">${items.length ? items.map((insert)=>renderInsertSlot(insert, section)).join('') : `<p class="studio-inspector-empty">${emptyText}</p>`}</div>
    ${renderInsertMenu({ menuId, items: menuItems, action })}
  </section>`
}
function renderInstrumentSlot(track) {
  const instrument = track.instrument
  const instruments = listDawInstruments()
  if (!instrument) {
    return `<div class="studio-instrument-empty"><p>No instrument loaded.</p><button type="button" data-toggle-inspector-menu="instrument">Choose Instrument</button></div>${renderInsertMenu({ menuId: 'instrument', items: instruments.map((item)=>({ type: item.id, name: item.name })), action: 'instrument' })}`
  }
  return `<article class="studio-instrument-slot ${instrument.enabled ? 'is-enabled' : 'is-disabled'}">
    <div class="studio-instrument-slot-main"><strong>${instrument.name}</strong><span>${instrument.enabled ? 'Enabled' : 'Disabled'} · ${track.name}</span></div>
    <div class="studio-instrument-slot-actions">
      <button type="button" class="${instrument.enabled ? 'is-active' : ''}" data-toggle-track-instrument>${instrument.enabled ? 'On' : 'Off'}</button>
      <button type="button" data-edit-track-instrument>Edit</button>
      <button type="button" data-toggle-inspector-menu="instrument">Change</button>
    </div>
    ${renderInsertMenu({ menuId: 'instrument', items: instruments.map((item)=>({ type: item.id, name: item.name })), action: 'instrument' })}
  </article>`
}
function renderTrackInspector() {
  const track = ensureTrackInsertState(tracks.find((t)=>t.id===selectedTrackId))
  if (!track) return '<h3>Inspector</h3><p class="studio-inspector-empty">Select a track to view inserts and controls.</p>'
  return `<section class="studio-track-inspector">
    <header class="studio-track-inspector-header"><span class="studio-track-inspector-icon" style="--track-color:${track.color}">${trackTypeIcon(track.type)}</span><div><h3>${track.name}</h3><p>${track.type} track</p></div></header>
    <div class="studio-inspector-strip"><button class="${track.muted?'is-active':''}" data-track-mute="${track.id}">Mute</button><button class="${track.soloed?'is-active':''}" data-track-solo="${track.id}">Solo</button><button class="${track.recordArmed?'is-active':''}" data-track-record="${track.id}">Record</button></div>
    ${renderInspectorSection({ title:'MIDI Effects', kicker:'Pre instrument', emptyText:'No MIDI effects inserted.', items:track.midiEffects, section:'midi', addLabel:'Add MIDI Effect', menuId:'midi-effects', menuItems:MIDI_EFFECT_TYPES, action:'midi' })}
    <section class="studio-inspector-section studio-inspector-section--instrument"><header><div><span>Instrument</span><h4>Instrument</h4></div></header>${renderInstrumentSlot(track)}</section>
    ${renderInspectorSection({ title:'Audio FX', kicker:'Post instrument', emptyText:'No audio effects inserted.', items:track.audioEffects, section:'audio', addLabel:'Add Audio FX', menuId:'audio-effects', menuItems:AUDIO_EFFECT_TYPES, action:'audio' })}
  </section>`
}
function renderLeftPanel() { if (!activeLeftPanel) return ''; const views={"library":`<h3>Library</h3><ul><li>Drum Kits</li><li>Pianos</li><li>Synths</li><li>Bass</li><li>Vocals</li><li>FX</li></ul>`,"inspector":renderTrackInspector(),"smart-controls":`<h3>Smart Controls</h3><p>EQ</p><p>Compressor</p><p>Sends</p><p>Track Effects</p>`,"loop-browser":`<h3>Loop Browser</h3><input placeholder="Search loops"/><p>Drums</p><p>Melody</p><p>Bass</p><p>Vocals</p><p>FX</p>`}; return `<aside class="studio-left-panel ${activeLeftPanel==='inspector'?'studio-left-panel--inspector':''}">${views[activeLeftPanel] || ''}</aside>` }
function getActiveNotePage(){ return notePages.find((page)=>page.id===activeNotePageId) || notePages[0] }
function stashActiveNoteInput(){ const input = app.querySelector('[data-notes-input]'); const active = getActiveNotePage(); if (!input || !active) return; active.body = input.value }
function renderNotesModal(){ if(!isNotesOpen) return ''; const activePage = getActiveNotePage(); return `<div class="studio-notes-modal"><div class="studio-notes-panel"><header class="studio-notes-header"><h3>Project Notes</h3></header><div class="studio-notes-body"><div class="studio-notes-pages">${notePages.map((page)=>`<button class="studio-notes-page-button ${page.id===activeNotePageId?'is-active':''}" data-notes-page="${page.id}" aria-pressed="${String(page.id===activeNotePageId)}">${page.title}</button>`).join('')}<button class="studio-notes-page-button" data-add-notes-page>Add Page</button></div><textarea class="studio-notes-textarea" data-notes-input placeholder="Write notes for this project...">${activePage?.body || ''}</textarea></div><div class="studio-notes-actions"><button class="studio-notes-button studio-notes-button--secondary" data-close-notes>Close</button><button class="studio-notes-button studio-notes-button--primary" data-save-notes>Save</button></div></div></div>` }

function buildEditorStateForSave(){ return { version:1, timeline:{ bars: timelineState.bars, beatsPerBar: timelineState.beatsPerBar, positiveBeats: timelineState.positiveBeats, pixelsPerBar: timelineState.pixelsPerBar, preStartPixels: timelineState.preStartPixels, playheadX: timelineState.playheadX, trackHeight: timelineState.trackHeight, cycleRange: cycleRange ? { ...cycleRange } : null }, notes:{ pages: notePages.map((p)=>({id:p.id,title:p.title,body:p.body||''})), activePageId: activeNotePageId }, tracks: tracks.map((track)=>{ ensureTrackInsertState(track); const {id,name,type,color,colorSoft,muted,soloed,recordArmed,automationOpen,volume,pan,outputLevel,midiEffects,instrument,audioEffects}=track; return {id,name,type,color,colorSoft,muted,soloed,recordArmed,automationOpen,volume,pan,outputLevel,midiEffects:midiEffects.map((fx)=>({...fx,params:{...(fx.params||{})}})),instrument:instrument?{...instrument,params:{...(instrument.params||{})}}:null,audioEffects:audioEffects.map((fx)=>({...fx,params:{...(fx.params||{})}}))} }), toggles:{ followPlayhead, metronome:isMetronomeEnabled, countIn:isCountInEnabled, snap:isSnapEnabled, cycle:isCycleEnabled } } }
function applyLoadedEditorState(editorState){ if(!editorState||typeof editorState!=='object') return; const tl=editorState.timeline||{}; if(Number.isFinite(tl.bars)) timelineState.bars=Math.max(2,Number(tl.bars)); if(Number.isFinite(tl.beatsPerBar)) timelineState.beatsPerBar=Math.max(1,Number(tl.beatsPerBar)); timelineState.positiveBeats = Number.isFinite(Number(tl.positiveBeats)) ? Math.max(timelineState.beatsPerBar, Math.round(Number(tl.positiveBeats))) : timelineState.bars * timelineState.beatsPerBar; timelineState.bars = Math.max(2, Math.ceil(timelineState.positiveBeats / timelineState.beatsPerBar)); if(Number.isFinite(tl.pixelsPerBar)) timelineState.pixelsPerBar=Math.max(40,Number(tl.pixelsPerBar)); if(Number.isFinite(tl.preStartPixels)) timelineState.preStartPixels=clamp(Number(tl.preStartPixels),0,timelineState.pixelsPerBar*10); if(Number.isFinite(tl.trackHeight)) timelineState.trackHeight=clamp(Number(tl.trackHeight),44,220); if(tl.cycleRange&&typeof tl.cycleRange==='object') cycleRange={ startX:Number(tl.cycleRange.startX)||0, endX:Number(tl.cycleRange.endX)||beatWidth() }; else ensureDefaultCycleRange(); const ns=editorState.notes||{}; if(Array.isArray(ns.pages)&&ns.pages.length) notePages=ns.pages.map((x)=>({id:String(x.id||''),title:String(x.title||'Page'),body:String(x.body||'')})).filter((x)=>x.id)||notePages; if(ns.activePageId) activeNotePageId=String(ns.activePageId); const tg=editorState.toggles||{}; if(typeof tg.followPlayhead==='boolean') followPlayhead=tg.followPlayhead; if(typeof tg.metronome==='boolean') isMetronomeEnabled=tg.metronome; if(typeof tg.countIn==='boolean') isCountInEnabled=tg.countIn; if(typeof tg.snap==='boolean') isSnapEnabled=tg.snap; if(typeof tg.cycle==='boolean') isCycleEnabled=tg.cycle; if(Array.isArray(editorState.tracks)){ editorState.tracks.forEach((saved)=>{ const t=tracks.find((x)=>x.id===saved.id); if(!t) return; Object.assign(t,{ name:saved.name??t.name,type:saved.type??t.type,color:saved.color??t.color,colorSoft:saved.colorSoft??t.colorSoft,muted:!!saved.muted,soloed:!!saved.soloed,recordArmed:!!saved.recordArmed,automationOpen:!!saved.automationOpen,volume:Number.isFinite(Number(saved.volume))?Number(saved.volume):t.volume,pan:Number.isFinite(Number(saved.pan))?Number(saved.pan):t.pan,outputLevel:Number.isFinite(Number(saved.outputLevel))?Number(saved.outputLevel):t.outputLevel,midiEffects:Array.isArray(saved.midiEffects)?saved.midiEffects.map((fx)=>({...fx,params:{...(fx.params||{})}})):[],instrument:saved.instrument&&typeof saved.instrument==='object'?{...saved.instrument,params:{...(saved.instrument.params||{})}}:null,audioEffects:Array.isArray(saved.audioEffects)?saved.audioEffects.map((fx)=>({...fx,params:{...(fx.params||{})}})):[] }); ensureTrackInsertState(t) }) }
 timelineState.playheadX = Number.isFinite(Number(tl.playheadX)) ? Number(tl.playheadX) : timelineState.playheadX }
function scheduleEditorSave(){ if(!isEditorLoaded||!projectState?.id) return; saveStatus='Saving…'; if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(async()=>{ try{ await saveStudioProjectEditorState(projectState.id, buildEditorStateForSave()); saveStatus='Saved' }catch(err){ console.error('[studioProject] save editorState failed',err); saveStatus='Save failed' } renderEditor() },800) }

function isTextEntryTarget(target){ return target?.matches?.('input, textarea, [contenteditable="true"]') }
async function getStudioAudioEngine() { if (!studioAudioEngine) { studioAudioEngine = new StudioAudioEngine(); await studioAudioEngine.init() } return studioAudioEngine }
function getAudioContext(){ if(!audioContext){ audioContext = new (window.AudioContext || window.webkitAudioContext)() } if(audioContext.state==='suspended') audioContext.resume().catch((err)=>console.warn('[studioProject] metronome context resume failed', err)); return audioContext }
function playMetronomeClick(isDownbeat){ const ctx=getAudioContext(); const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.type='sine'; osc.frequency.value=isDownbeat?1200:760; gain.gain.setValueAtTime(0.0001,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.16,ctx.currentTime+0.004); gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.055); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+0.065) }
function maybeTickMetronome(){ if(!isPlaying||!isMetronomeEnabled) return; const ppb=timelineState.pixelsPerBar/timelineState.beatsPerBar; const beatIndex=Math.floor(timelineState.playheadX/ppb); if(beatIndex!==lastMetronomeBeat){ lastMetronomeBeat=beatIndex; playMetronomeClick(beatIndex%timelineState.beatsPerBar===0) } }
function secondsFromPlayhead(){ const bpm=Number(projectState?.bpm||140); const beatsFromZero=xToBeatsFromBarZero(timelineState.playheadX); return beatsFromZero*(60/bpm) }
function formatTimeFromPlayhead(){ const raw=secondsFromPlayhead(); const total=Math.abs(raw)<0.0005?0:raw; const isNegative=total<0; const absTotal=Math.abs(total); const m=Math.floor(absTotal/60); const s=Math.floor(absTotal%60); const ms=Math.floor((absTotal%1)*1000); const sub=Math.floor(((absTotal*1000)%1)*100); return `${isNegative?'-':''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}.${String(sub).padStart(2,'0')}` }
function formatBarsFromPlayhead(){ const beatsFromZero=xToBeatsFromBarZero(timelineState.playheadX); const bar=Math.floor(beatsFromZero/timelineState.beatsPerBar); const beatWithinBar=beatsFromZero-(bar*timelineState.beatsPerBar); const beat=Math.floor(beatWithinBar)+1; const bf=beatWithinBar%1; const div=Math.floor(bf*4)+1; const tick=Math.floor((bf*4%1)*240)+1; const barLabel=bar<0?`-${String(Math.abs(bar)).padStart(3,'0')}`:String(bar).padStart(3,'0'); return `${barLabel} ${String(beat).padStart(2,'0')} ${div} ${String(tick).padStart(3,'0')}` }
function updateTransportDisplay(){ app.querySelector('[data-display-time]')?.replaceChildren(document.createTextNode(formatTimeFromPlayhead())); app.querySelector('[data-display-bars]')?.replaceChildren(document.createTextNode(formatBarsFromPlayhead())) }
function updateCycleDomFromState(){ const rangeEl = app.querySelector('[data-cycle-range]'); const startGuide = app.querySelector('.studio-cycle-guide--start'); const endGuide = app.querySelector('.studio-cycle-guide--end'); if(!cycleRange){ if(rangeEl) rangeEl.style.width='0px'; return } const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); if (rangeEl){ rangeEl.style.left=`${start}px`; rangeEl.style.width=`${Math.max(beatWidth(), end-start)}px`; rangeEl.classList.toggle('is-enabled', isCycleEnabled) } if (startGuide){ startGuide.style.left=`${start}px`; startGuide.classList.toggle('is-enabled', isCycleEnabled) } if (endGuide){ endGuide.style.left=`${end}px`; endGuide.classList.toggle('is-enabled', isCycleEnabled) } }
function updateCycleButtonDom(){ const btn=app.querySelector('[data-toggle-cycle]'); if(!btn) return; btn.classList.toggle('is-active', isCycleEnabled); btn.setAttribute('aria-pressed', String(isCycleEnabled)) }
function setCycleEnabled(enabled){ isCycleEnabled=!!enabled; updateCycleDomFromState(); updateCycleButtonDom() }
function followPlayheadIfNeeded(){ if(!followPlayhead) return; const grid=app.querySelector('[data-arrangement-grid]'); if(!grid) return; const mid=grid.clientWidth*0.5; const max=grid.scrollWidth-grid.clientWidth; grid.scrollLeft=Math.min(Math.max(0,timelineState.playheadX-mid),max); const ruler=app.querySelector('[data-timeline-ruler]'); if(ruler) ruler.scrollLeft=grid.scrollLeft }

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
function beatWidth() { return timelineState.pixelsPerBar / timelineState.beatsPerBar }
function timelineStartX() { return 0 }
function barZeroX() { return timelineState.preStartPixels || 0 }
function barOneX() { return barZeroX() }
function timelineEndX() { return barZeroX() + timelineState.positiveBeats * beatWidth() }
function timelineContentWidth() { return timelineEndX() + beatWidth() }
function cycleMinWidth() { return Math.max(8, beatWidth() / 2) }
function syncBarsFromPositiveBeats(){ timelineState.bars = Math.max(2, Math.ceil(timelineState.positiveBeats / timelineState.beatsPerBar)) }
function clampTimelineSystems() {
  const start = timelineStartX()
  const end = timelineEndX()
  timelineState.playheadX = clamp(timelineState.playheadX, start, end)
  if (cycleRange) {
    let s = clamp(Math.min(cycleRange.startX, cycleRange.endX), start, end)
    let e = clamp(Math.max(cycleRange.startX, cycleRange.endX), start, end)
    if (e - s < cycleMinWidth()) {
      e = clamp(s + cycleMinWidth(), start + cycleMinWidth(), end)
      if (e - s < cycleMinWidth()) s = clamp(e - cycleMinWidth(), start, end - cycleMinWidth())
    }
    cycleRange = { startX: s, endX: e }
  }
}
function xToBeatsFromBarZero(x) { return (x - barZeroX()) / beatWidth() }
function beatsFromBarZeroToX(beats) { return barZeroX() + beats * beatWidth() }
function xToBeatsFromBarOne(x) { return xToBeatsFromBarZero(x) }
function beatsFromBarOneToX(beats) { return beatsFromBarZeroToX(beats) }
function ensureDefaultCycleRange(){ if(cycleRange) return; const start = barZeroX(); cycleRange = { startX:start, endX:start + timelineState.pixelsPerBar } }
function clearBottomPanelMotionTimer(){ if(bottomPanelMotionTimer){ clearTimeout(bottomPanelMotionTimer); bottomPanelMotionTimer=0 } }
function openBottomPanel(panelId){
  clearBottomPanelMotionTimer()
  if(activeBottomPanel===panelId){ closeBottomPanel(); return }
  if(activeBottomPanel==='instrument'&&panelId!=='instrument') stopAllInstrumentNotes()
  if(panelId==='instrument'&&activeBottomPanel!=='instrument') activeInstrumentSubpage='keyboard'
  activeBottomPanel=panelId
  closingBottomPanel=''
  bottomPanelMotion='entering'
  renderEditor()
  bottomPanelMotionTimer=window.setTimeout(()=>{ bottomPanelMotion=''; renderEditor() },190)
}
function closeBottomPanel(){
  if(!activeBottomPanel) return
  clearBottomPanelMotionTimer()
  if(activeBottomPanel==='instrument') stopAllInstrumentNotes()
  closingBottomPanel=activeBottomPanel
  activeBottomPanel=''
  bottomPanelMotion='exiting'
  renderEditor()
  bottomPanelMotionTimer=window.setTimeout(()=>{ closingBottomPanel=''; bottomPanelMotion=''; activeInstrumentSubpage='keyboard'; renderEditor() },170)
}
function snapBeatToGrid(beat){ return Math.round(beat) }
function xToSnappedBeat(x){ const beat=xToBeatsFromBarZero(x); return isSnapEnabled ? snapBeatToGrid(beat) : beat }
function snapXToBeat(x) { return isSnapEnabled ? beatsFromBarZeroToX(snapBeatToGrid(xToBeatsFromBarZero(x))) : x }
function maxTimelineX() { return timelineEndX() }
function setPlayhead(x) { timelineState.playheadX = clamp(x, timelineStartX(), maxTimelineX()); if (studioAudioEngine) studioAudioEngine.setPositionBeats(xToBeatsFromBarZero(timelineState.playheadX)); app.querySelector('[data-arrangement]')?.style.setProperty('--playhead-x', `${timelineState.playheadX}px`); updateTransportDisplay() }
function pixelsPerSecond() { const bpm = Number(projectState?.bpm || 140); const bps = bpm / 60; const ppb = timelineState.pixelsPerBar / timelineState.beatsPerBar; return bps * ppb }
function updateTransportPlaybackUI() { const btn = app.querySelector('[data-transport-play]'); if (!btn) return; btn.classList.toggle('is-active', isPlaying); btn.setAttribute('aria-pressed', String(isPlaying)); btn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); btn.innerHTML = isPlaying ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 5v14M16 5v14"/></svg>' : toolIcon('play') }
function tickPlayback(now) { if (!isPlaying) return; const delta=(now-lastPlayTimestamp)/1000; lastPlayTimestamp=now; let nextX = timelineState.playheadX + pixelsPerSecond()*delta; const cycle = isCycleEnabled ? getNormalizedCycleRange() : null; if (cycle) { if (nextX >= cycle.end) nextX = cycle.start + ((nextX - cycle.end) % (cycle.end-cycle.start)) } setPlayhead(nextX); followPlayheadIfNeeded(); maybeTickMetronome(); if (timelineState.playheadX >= maxTimelineX()) return pausePlayback(); playRaf = requestAnimationFrame(tickPlayback) }
function startPlayback() { if (isPlaying) return; const cycle = isCycleEnabled ? getNormalizedCycleRange() : null; if (cycle && (timelineState.playheadX < cycle.start || timelineState.playheadX >= cycle.end)) setPlayhead(cycle.start); getStudioAudioEngine().then((engine) => engine.resume().then(() => { engine.setBpm(Number(projectState?.bpm || 140)); engine.setPositionBeats(xToBeatsFromBarZero(timelineState.playheadX)); engine.startTransport({ bpm: Number(projectState?.bpm || 140), positionBeats: xToBeatsFromBarZero(timelineState.playheadX) }) })).catch((err)=>console.warn('[studioProject] audio engine start failed', err)); isPlaying = true; lastPlayTimestamp = performance.now(); playRaf = requestAnimationFrame(tickPlayback); updateTransportPlaybackUI() }
function pausePlayback() { isPlaying = false; try { studioAudioEngine?.pauseTransport() } catch (err) { console.warn('[studioProject] audio engine pause failed', err) } if (playRaf) cancelAnimationFrame(playRaf); playRaf = 0; updateTransportPlaybackUI() }
function togglePlayback(){ isPlaying ? pausePlayback() : startPlayback() }
function stopPlayback() { pausePlayback(); try { studioAudioEngine?.stopTransport() } catch (err) { console.warn('[studioProject] audio engine stop failed', err) } lastMetronomeBeat = -1; if (countInTimer) clearInterval(countInTimer); countInTimer = 0; isCountInRunning = false; countInBeatsRemaining = 0 }
function getNormalizedCycleRange(){ if(!cycleRange) return null; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return end-start>=cycleMinWidth()?{start,end}:null }
function hasValidCycleRange(){ return !!getNormalizedCycleRange() }
function isCycleStripPointerEvent(event, ruler){ const rect = ruler?.getBoundingClientRect?.(); if(!rect) return false; const localY = event.clientY - rect.top; return localY >= 0 && localY <= 22 }
function handleSpaceTransport(event){ if (event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return; event.preventDefault(); const cycle = isCycleEnabled ? getNormalizedCycleRange() : null; if (!isPlaying) { spacePlaybackStartX = cycle ? cycle.start : timelineState.playheadX; if (cycle) setPlayhead(cycle.start); startPlayback(); return } pausePlayback(); setPlayhead(cycle ? cycle.start : (spacePlaybackStartX ?? timelineState.playheadX)) }


function setVirtualKeyPressed(midi, pressed){ app.querySelectorAll(`[data-piano-midi="${midi}"]`).forEach((el)=>el.classList.toggle('is-pressed', !!pressed)) }
function midiToFrequency(midi){ return 440 * (2 ** ((midi - 69) / 12)) }
async function ensureInstrumentAudio(){ if(!instrumentAudioContext){ instrumentAudioContext = new (window.AudioContext || window.webkitAudioContext)(); instrumentMasterGain = instrumentAudioContext.createGain(); instrumentPanNode = instrumentAudioContext.createStereoPanner(); instrumentMasterGain.gain.value=instrumentVolume; instrumentPanNode.pan.value=instrumentPan; instrumentPanNode.connect(instrumentMasterGain); instrumentMasterGain.connect(instrumentAudioContext.destination) } if(instrumentAudioContext.state==='suspended') await instrumentAudioContext.resume(); }
async function startInstrumentNote(midi){ const shifted=midi+(instrumentOctaveOffset*12); if(activeInstrumentNotes.has(shifted)) return; try{ await ensureInstrumentAudio(); const osc=instrumentAudioContext.createOscillator(); const gain=instrumentAudioContext.createGain(); osc.type='triangle'; osc.frequency.value=midiToFrequency(shifted); gain.gain.setValueAtTime(0.0001,instrumentAudioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.16*instrumentVolume,instrumentAudioContext.currentTime+0.02); osc.connect(gain); gain.connect(instrumentPanNode); osc.start(); activeInstrumentNotes.set(shifted,{osc,gain,midi:shifted}); setVirtualKeyPressed(midi,true) }catch(err){ console.warn('[studioProject] instrument note start failed',err) } }
function stopInstrumentNote(midi){ const shifted=midi+(instrumentOctaveOffset*12); if(isSustainEnabled) return; const voice=activeInstrumentNotes.get(shifted); if(!voice||!instrumentAudioContext) return; voice.gain.gain.cancelScheduledValues(instrumentAudioContext.currentTime); voice.gain.gain.setValueAtTime(Math.max(0.0001,voice.gain.gain.value),instrumentAudioContext.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001,instrumentAudioContext.currentTime+0.08); voice.osc.stop(instrumentAudioContext.currentTime+0.1); activeInstrumentNotes.delete(shifted); setVirtualKeyPressed(midi,false) }
function stopAllInstrumentNotes(){ if(!instrumentAudioContext) { activeInstrumentNotes.clear(); return } for(const [m,voice] of activeInstrumentNotes){ voice.gain.gain.cancelScheduledValues(instrumentAudioContext.currentTime); voice.gain.gain.setValueAtTime(Math.max(0.0001,voice.gain.gain.value),instrumentAudioContext.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001,instrumentAudioContext.currentTime+0.05); voice.osc.stop(instrumentAudioContext.currentTime+0.08); activeInstrumentNotes.delete(m); setVirtualKeyPressed(voice.midi - instrumentOctaveOffset*12,false) } }

function bindEditorEvents() {
  const trigger = app.querySelector('[data-editor-left-menu]')
  const leftWrap = app.querySelector('.studio-editor-left')
  const ruler = app.querySelector('[data-timeline-ruler]')
  const grid = app.querySelector('[data-arrangement-grid]')
  const selectionBox = app.querySelector('[data-selection-box]')
  const tooltip = app.querySelector('[data-studio-tooltip]')
  trigger?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); setEditorMenuOpen(!isEditorMenuOpen) })
  document.onclick = (event) => { if (event.target.closest('.studio-notes-modal') || event.target.closest('.studio-notes-panel') || event.target.closest('[data-notes-input]')) return; let changed = false; if (!event.target.closest('.studio-editor-left') && isEditorMenuOpen) { setEditorMenuOpen(false); changed = true } if (!event.target.closest('.studio-track-stack') && openTrackMenuId) { openTrackMenuId = ''; changed = true } if (!event.target.closest('.studio-left-panel') && inspectorMenu) { inspectorMenu = null; changed = true } if (changed) renderEditor() }
  document.onkeydown = (event) => { if (event.key === 'Alt' && event.target?.closest?.('.studio-editor-page')) event.preventDefault(); if (event.key === 'Escape') { let changed = false; if (isEditorMenuOpen) { setEditorMenuOpen(false); changed = true } if (openTrackMenuId) { openTrackMenuId = ''; changed = true } if (changed) renderEditor() } }
  leftWrap?.addEventListener('click', (event) => event.stopPropagation())
  app.querySelector('[data-keep-site-menu]')?.addEventListener('change', (e) => { keepSiteMenuOpen = e.target.checked; localStorage.setItem(PREF_KEY, keepSiteMenuOpen ? '1' : '0'); isEditorMenuOpen = false; renderEditor() })
  app.querySelectorAll('[data-track-row]').forEach((el) => el.addEventListener('click', () => { selectedTrackId = el.dataset.trackRow; openTrackMenuId = ''; activeLeftPanel = 'inspector'; inspectorMenu = null; renderEditor() }))
  app.querySelectorAll('[data-toggle-inspector-menu]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); inspectorMenu = inspectorMenu === el.dataset.toggleInspectorMenu ? null : el.dataset.toggleInspectorMenu; renderEditor() }))
  app.querySelectorAll('[data-inspector-menu-choice]').forEach((el) => el.addEventListener('click', (event) => {
    event.stopPropagation()
    const track = ensureTrackInsertState(getSelectedTrack())
    if (!track) return
    const action = el.dataset.inspectorMenuChoice
    if (action === 'midi') {
      const insert = createInsert(el.dataset.insertType, MIDI_EFFECT_TYPES)
      if (insert) track.midiEffects.push(insert)
    } else if (action === 'audio') {
      const insert = createInsert(el.dataset.insertType, AUDIO_EFFECT_TYPES)
      if (insert) track.audioEffects.push(insert)
    } else if (action === 'instrument') {
      track.instrument = createTrackInstrument(el.dataset.insertType, track.id)
      track.type = track.type === 'audio' ? 'instrument' : track.type
    }
    inspectorMenu = null
    scheduleEditorSave()
    renderEditor()
  }))
  app.querySelector('[data-toggle-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; track.instrument.enabled = !track.instrument.enabled; scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-edit-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; if (!track.instrument.pluginInstanceId) track.instrument.pluginInstanceId = `${track.instrument.type}:${track.id}`; dawWindowManager.openPlugin({ pluginType: track.instrument.type, trackId: track.id, instanceId: track.instrument.pluginInstanceId, params: track.instrument.params || {}, forceCenter: true }) })
  app.querySelectorAll('[data-toggle-insert]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); const list = el.dataset.toggleInsert === 'midi' ? track?.midiEffects : track?.audioEffects; const insert = list?.find((item)=>item.id===el.dataset.insertId); if (!insert) return; insert.enabled = !insert.enabled; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-remove-insert]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track) return; if (el.dataset.removeInsert === 'midi') track.midiEffects = track.midiEffects.filter((item)=>item.id!==el.dataset.insertId); if (el.dataset.removeInsert === 'audio') track.audioEffects = track.audioEffects.filter((item)=>item.id!==el.dataset.insertId); scheduleEditorSave(); renderEditor() }))
  const getTrack = (id) => tracks.find((track) => track.id === id)
  const showTooltip = (target) => { if (!tooltip || !target?.dataset?.tooltip) return; tooltip.textContent = target.dataset.tooltip; tooltip.hidden = false; const rect = target.getBoundingClientRect(); const trect = tooltip.getBoundingClientRect(); tooltip.style.left = `${Math.max(8, rect.left + rect.width / 2 - trect.width / 2)}px`; tooltip.style.top = `${Math.max(8, rect.top - trect.height - 8)}px` }
  const hideTooltip = () => { if (tooltip) tooltip.hidden = true }
  app.querySelectorAll('[data-tooltip]').forEach((target) => { target.addEventListener('pointerenter', () => showTooltip(target)); target.addEventListener('pointerleave', hideTooltip); target.addEventListener('focus', () => showTooltip(target)); target.addEventListener('blur', hideTooltip) })
  app.querySelectorAll('[data-track-mute]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackMute); if (!t) return; t.muted = !t.muted; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-solo]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackSolo); if (!t) return; t.soloed = !t.soloed; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-record]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackRecord); if (!t) return; t.recordArmed = !t.recordArmed; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-volume]').forEach((el) => { el.addEventListener('input', () => { const t = getTrack(el.dataset.trackVolume); if (!t) return; t.volume = Number(el.value) }); el.addEventListener('change', ()=>scheduleEditorSave()) })
  app.querySelectorAll('[data-track-automation]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackAutomation); if (!t) return; t.automationOpen = !t.automationOpen; renderEditor() }))
  app.querySelectorAll('[data-track-options]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const id = el.dataset.trackOptions; openTrackMenuId = openTrackMenuId === id ? '' : id; renderEditor() }))
  app.querySelectorAll('[data-track-pan]').forEach((knob) => knob.addEventListener('pointerdown', (event) => { event.preventDefault(); event.stopPropagation(); const t = getTrack(knob.dataset.trackPan); if (!t) return; panDrag = { trackId: t.id, startX: event.clientX, startPan: t.pan, knob }; knob.setPointerCapture?.(event.pointerId) }))
  grid?.addEventListener('scroll', () => { if (ruler) ruler.scrollLeft = grid.scrollLeft })
  const getRulerLocalX = (event) => { const rect = ruler.getBoundingClientRect(); return clamp(event.clientX - rect.left + ruler.scrollLeft, 0, maxTimelineX()) }
  const applyCycleRange = (start, end) => { const minW = cycleMinWidth(); const min = Math.min(start, end); const max = Math.max(start, end); let s = clamp(isSnapEnabled ? snapXToBeat(min) : min, timelineStartX(), maxTimelineX()); let e = clamp(isSnapEnabled ? snapXToBeat(max) : max, timelineStartX(), maxTimelineX()); if (e - s < minW) e = clamp(s + minW, s + minW, maxTimelineX()); cycleRange = { startX: s, endX: e } }

  const extensionLane = app.querySelector('[data-timeline-extension-lane]')
  const extensionInner = app.querySelector('[data-timeline-extension-inner]')
  let extensionDrag = null
  let didMovePlayhead = false
  let didCycleChange = false
  const syncTimelineScroll = (source = null) => { const scrollLeft = source?.scrollLeft ?? grid?.scrollLeft ?? 0; if (grid && grid !== source) grid.scrollLeft = scrollLeft; if (ruler && ruler !== source) ruler.scrollLeft = scrollLeft; if (extensionLane && extensionLane !== source) extensionLane.scrollLeft = scrollLeft }
  const updateTimelineRulerDom = () => { const rulerInner = app.querySelector('[data-timeline-ruler-inner]'); if (!rulerInner) return; const cycleStrip = rulerInner.querySelector('[data-cycle-strip]'); if (!cycleStrip) return; rulerInner.innerHTML = `<div class="studio-cycle-strip" data-cycle-strip>${renderCycleRange()}</div><span class="studio-negative-zone studio-negative-zone--ruler" style="width:${barZeroX()}px"></span>${renderTimelineRuler()}<span class="studio-ruler-playhead" data-ruler-playhead></span>` }
  const updateTimelineGridLinesDom = () => { const gridInner = app.querySelector('[data-arrangement-grid-inner]'); if (!gridInner) return; const selection = gridInner.querySelector('[data-selection-box]'); const selectionMarkup = '<div class="studio-selection-box" data-selection-box hidden></div>'; const selectionHtml = selection ? selection.outerHTML : selectionMarkup; gridInner.innerHTML = `<span class="studio-negative-zone studio-negative-zone--grid" style="width:${barZeroX()}px"></span>${renderTimelineLines()}${renderTimelineRegions()}${renderCycleBoundaryGuides()}<span class="studio-grid-playhead" data-grid-playhead></span>${selectionHtml}` }
  const applyTimelineGeometry = () => { syncBarsFromPositiveBeats(); app.querySelector('[data-arrangement]')?.style.setProperty('--bars', timelineState.bars); app.querySelector('[data-arrangement]')?.style.setProperty('--pixels-per-bar', `${timelineState.pixelsPerBar}px`); app.querySelector('[data-arrangement]')?.style.setProperty('--pixels-per-beat', `${timelineState.pixelsPerBar / timelineState.beatsPerBar}px`); app.querySelector('[data-arrangement]')?.style.setProperty('--timeline-content-width', `${timelineContentWidth()}px`); clampTimelineSystems(); updateCycleDomFromState(); setPlayhead(timelineState.playheadX) }
  let timelineVisualRefreshRaf = 0
  const refreshTimelineVisualsLive = () => { applyTimelineGeometry(); updateTimelineRulerDom(); updateTimelineGridLinesDom(); updateCycleDomFromState(); updateTransportDisplay(); syncTimelineScroll() }
  const scheduleTimelineVisualRefresh = () => { if (timelineVisualRefreshRaf) return; timelineVisualRefreshRaf = requestAnimationFrame(() => { timelineVisualRefreshRaf = 0; refreshTimelineVisualsLive() }) }
  const updateTrackHeightDom = () => { const page = app.querySelector('.studio-editor-page'); if (page) page.style.setProperty('--studio-track-height', `${timelineState.trackHeight}px`); const compact = timelineState.trackHeight <= 56; app.querySelectorAll('[data-track-row]').forEach((row)=>row.classList.toggle('is-track-compact', compact)); }
  const isPinnedRight = () => !!grid && (grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 4)
  grid?.addEventListener('wheel', (event) => { if (isTextEntryTarget(event.target)) return; const overTimeline = event.target.closest('[data-arrangement-grid], [data-timeline-ruler], [data-timeline-extension-lane], [data-arrangement]'); const overTrackZone = event.target.closest('[data-arrangement-grid], .studio-track-panel, .studio-editor-workspace'); if ((event.ctrlKey || event.metaKey) && overTimeline) { event.preventDefault(); const rect = grid.getBoundingClientRect(); const mouseX = event.clientX - rect.left; const oldTimelineX = grid.scrollLeft + mouseX; const anchorBeat = xToBeatsFromBarZero(oldTimelineX); let playheadBeat = xToBeatsFromBarZero(timelineState.playheadX); if (isSnapEnabled) playheadBeat = snapBeatToGrid(playheadBeat); const cycleBeats = cycleRange ? { start: xToBeatsFromBarZero(cycleRange.startX), end: xToBeatsFromBarZero(cycleRange.endX) } : null; const direction = event.deltaY < 0 ? 1 : -1; const zoomFactor = direction > 0 ? 1.08 : 1 / 1.08; timelineState.pixelsPerBar = clamp(timelineState.pixelsPerBar * zoomFactor, 60, 360); timelineState.playheadX = beatsFromBarZeroToX(playheadBeat); if (cycleBeats) { let startBeat = cycleBeats.start; let endBeat = cycleBeats.end; if (isSnapEnabled) { startBeat = snapBeatToGrid(startBeat); endBeat = snapBeatToGrid(endBeat) } cycleRange = { startX: beatsFromBarZeroToX(startBeat), endX: beatsFromBarZeroToX(endBeat) } } refreshTimelineVisualsLive(); const newTimelineX = beatsFromBarZeroToX(anchorBeat); grid.scrollLeft = clamp(newTimelineX - mouseX, 0, Math.max(0, timelineContentWidth() - grid.clientWidth)); syncTimelineScroll(); scheduleEditorSave(); return }
    if (event.altKey && overTrackZone) { event.preventDefault(); timelineState.trackHeight = clamp(timelineState.trackHeight + (event.deltaY < 0 ? 6 : -6), 44, 220); updateTrackHeightDom(); scheduleTimelineVisualRefresh(); scheduleEditorSave(); return }
    if (event.shiftKey && overTimeline) { event.preventDefault(); grid.scrollLeft = clamp(grid.scrollLeft + event.deltaY, 0, Math.max(0, grid.scrollWidth - grid.clientWidth)); syncTimelineScroll() }
  }, { passive:false })
  grid?.addEventListener('scroll', () => syncTimelineScroll(grid), { passive:true })
  ruler?.addEventListener('scroll', () => syncTimelineScroll(ruler), { passive:true })
  extensionLane?.addEventListener('scroll', () => syncTimelineScroll(extensionLane), { passive:true })
  app.querySelectorAll('[data-timeline-extension-handle]').forEach((el)=>el.addEventListener('pointerdown',(event)=>{ event.preventDefault(); const pinRight = isPinnedRight(); extensionDrag={ side:el.dataset.timelineExtensionHandle, startX:event.clientX, startPositiveBeats:timelineState.positiveBeats, startPre:timelineState.preStartPixels, startPlayheadBeats:xToBeatsFromBarOne(timelineState.playheadX), startCycleBeats:cycleRange?{start:xToBeatsFromBarOne(cycleRange.startX),end:xToBeatsFromBarOne(cycleRange.endX)}:null, scrollLeft:grid?.scrollLeft||0, pinRight }; document.body.classList.add('is-studio-dragging') }))
  ruler?.addEventListener('pointerdown', (event) => { const cycleHandle = event.target.closest('[data-cycle-handle]'); const cycleMove = event.target.closest('[data-cycle-drag]'); const inCycleStrip = isCycleStripPointerEvent(event, ruler); if (cycleHandle && cycleRange) { event.preventDefault(); setCycleEnabled(true); const x = getRulerLocalX(event); cycleDrag = { mode: cycleHandle.dataset.cycleHandle === 'start' ? 'resize-start' : 'resize-end', fixedX: cycleHandle.dataset.cycleHandle === 'start' ? cycleRange.endX : cycleRange.startX }; return } if (cycleMove && cycleRange) { event.preventDefault(); setCycleEnabled(true); const x = getRulerLocalX(event); cycleDrag = { mode: 'move', startPointerX: x, startRange: { ...cycleRange } }; return } if (inCycleStrip) { event.preventDefault(); const x = getRulerLocalX(event); setCycleEnabled(true); cycleDrag = { mode: 'create', anchorX: x }; applyCycleRange(x, x + beatWidth()); document.body.classList.add('is-studio-dragging'); return } event.preventDefault(); timelineState.isDraggingPlayhead = true; setPlayhead(snapXToBeat(getRulerLocalX(event))); scheduleEditorSave() })
  grid?.addEventListener('pointerdown', (event) => { if (event.target !== grid && !event.target.closest('[data-arrangement-grid-inner]')) return; event.preventDefault(); timelineState.isSelecting = true; const rect = grid.getBoundingClientRect(); timelineState.selectionBox = { startX: event.clientX - rect.left + grid.scrollLeft, startY: event.clientY - rect.top + grid.scrollTop }; if (selectionBox) { selectionBox.style.width='0px'; selectionBox.style.height='0px'; selectionBox.style.left=`${timelineState.selectionBox.startX}px`; selectionBox.style.top=`${timelineState.selectionBox.startY}px`; selectionBox.hidden = false } })
  window.addEventListener('pointermove', (event) => { if (panDrag) { const t=getTrack(panDrag.trackId); if (t) { t.pan = clamp(panDrag.startPan + (event.clientX-panDrag.startX)/100, -1, 1); panDrag.knob?.style.setProperty('--pan-angle', `${t.pan * 135}deg`) } } if (cycleDrag) { event.preventDefault(); const x = getRulerLocalX(event); if (cycleDrag.mode === 'create') { applyCycleRange(cycleDrag.anchorX, x) } else if (cycleDrag.mode === 'move' && cycleDrag.startRange) { const rawDx = x - cycleDrag.startPointerX; const width = cycleDrag.startRange.endX - cycleDrag.startRange.startX; let start = cycleDrag.startRange.startX + rawDx; let end = start + width; if (isSnapEnabled) { start = snapXToBeat(start); end = start + width } start = clamp(start, timelineState.preStartPixels, maxTimelineX() - width); applyCycleRange(start, start + width) } else if (cycleDrag.mode === 'resize-start') { const end = cycleDrag.fixedX; const start = Math.min(x, end - beatWidth()); cycleRange = { startX: clamp(snapXToBeat(start), timelineState.preStartPixels, maxTimelineX()-beatWidth()), endX: end } } else if (cycleDrag.mode === 'resize-end') { const start = cycleDrag.fixedX; const end = Math.max(x, start + beatWidth()); cycleRange = { startX: start, endX: clamp(snapXToBeat(end), start + beatWidth(), maxTimelineX()) } } didCycleChange = true; updateCycleDomFromState(); return } if (extensionDrag) { const dx = event.clientX - extensionDrag.startX; if (extensionDrag.side === 'right') { const rawBeats = extensionDrag.startPositiveBeats + (dx / beatWidth()); timelineState.positiveBeats = clamp(Math.round(rawBeats), timelineState.beatsPerBar, 800); } else { const snappedPre = Math.round((extensionDrag.startPre - dx) / beatWidth()) * beatWidth(); timelineState.preStartPixels = clamp(snappedPre, 0, timelineState.pixelsPerBar * 10); timelineState.playheadX = beatsFromBarOneToX(extensionDrag.startPlayheadBeats); if (extensionDrag.startCycleBeats) cycleRange = { startX: beatsFromBarOneToX(extensionDrag.startCycleBeats.start), endX: beatsFromBarOneToX(extensionDrag.startCycleBeats.end) }; } scheduleTimelineVisualRefresh(); if (grid) { grid.scrollLeft = extensionDrag.side==='right' ? Math.max(0, grid.scrollWidth-grid.clientWidth) : extensionDrag.scrollLeft; syncTimelineScroll() } return } if (timelineState.isDraggingPlayhead) { event.preventDefault(); if (grid) { const rect = grid.getBoundingClientRect(); if (event.clientX > rect.right - 40) grid.scrollLeft = Math.min(grid.scrollWidth - grid.clientWidth, grid.scrollLeft + 20); else if (event.clientX < rect.left + 40) grid.scrollLeft = Math.max(0, grid.scrollLeft - 20); if (ruler) ruler.scrollLeft = grid.scrollLeft } didMovePlayhead = true; setPlayhead(snapXToBeat(getRulerLocalX(event))); } if (timelineState.isSelecting && selectionBox && grid) { event.preventDefault(); const rect = grid.getBoundingClientRect(); const x = event.clientX - rect.left + grid.scrollLeft; const y = event.clientY - rect.top + grid.scrollTop; const sx = timelineState.selectionBox.startX; const sy = timelineState.selectionBox.startY; selectionBox.style.left = `${Math.min(sx, x)}px`; selectionBox.style.top = `${Math.min(sy, y)}px`; selectionBox.style.width = `${Math.abs(x - sx)}px`; selectionBox.style.height = `${Math.abs(y - sy)}px`; } })
  window.addEventListener('pointerup', () => { const hadCycle = !!cycleDrag || didCycleChange; const hadPlayhead = timelineState.isDraggingPlayhead || didMovePlayhead; const hadExtension = !!extensionDrag; const hadPan = !!panDrag; panDrag = null; cycleDrag = null; extensionDrag = null; didCycleChange = false; didMovePlayhead = false; document.body.classList.remove('is-studio-dragging'); timelineState.isDraggingPlayhead = false; timelineState.isSelecting = false; if (selectionBox) selectionBox.hidden = true; if (hadCycle || hadPlayhead || hadExtension || hadPan) scheduleEditorSave() })
  app.querySelector('[data-transport-play]')?.addEventListener('click', (e)=>{ e.stopPropagation(); togglePlayback() })
  app.querySelector('[data-transport-stop]')?.addEventListener('click', (e)=>{ e.stopPropagation(); stopPlayback(); recordingStatus = '' ; renderEditor() })
  app.querySelector('[data-transport-start]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(barZeroX()); scheduleEditorSave() })
  app.querySelector('[data-transport-end]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(maxTimelineX()); scheduleEditorSave() })
  app.querySelector('[data-transport-rewind]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(timelineState.playheadX - (timelineState.pixelsPerBar / timelineState.beatsPerBar)); scheduleEditorSave() })
  app.querySelector('[data-transport-forward]')?.addEventListener('click', (e)=>{ e.stopPropagation(); setPlayhead(timelineState.playheadX + (timelineState.pixelsPerBar / timelineState.beatsPerBar)); scheduleEditorSave() })
  app.querySelector('.studio-notes-panel')?.addEventListener('pointerdown',(e)=>e.stopPropagation()); app.querySelector('[data-notes-input]')?.addEventListener('pointerdown',(e)=>e.stopPropagation()); app.querySelectorAll('[data-notes-page],[data-add-notes-page],[data-save-notes],[data-close-notes]').forEach((el)=>el.addEventListener('pointerdown',(e)=>e.stopPropagation())); app.querySelectorAll('[data-left-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.leftPanel; activeLeftPanel = activeLeftPanel===id ? '' : id; renderEditor() })); app.querySelector('[data-toggle-snap]')?.addEventListener('click',()=>{ isSnapEnabled=!isSnapEnabled; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-count-in]')?.addEventListener('click',()=>{ isCountInEnabled=!isCountInEnabled; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-transport-record]')?.addEventListener('click',()=>{ const startRecording = () => { recordingStatus = 'Recording ready'; renderEditor() }; if (!isCountInEnabled) return startRecording(); stopPlayback(); if (countInTimer) clearInterval(countInTimer); isCountInRunning = true; countInBeatsRemaining = timelineState.beatsPerBar; recordingStatus = ''; renderEditor(); const intervalMs = (60 / Number(projectState?.bpm || 140)) * 1000; playMetronomeClick(true); countInTimer = setInterval(()=>{ countInBeatsRemaining -= 1; if (countInBeatsRemaining > 0) playMetronomeClick(false); if (countInBeatsRemaining <= 0) { clearInterval(countInTimer); countInTimer = 0; isCountInRunning = false; startRecording(); return } renderEditor() }, intervalMs) }); app.querySelector('[data-open-notes]')?.addEventListener('click',()=>{ isNotesOpen=true; renderEditor() }); app.querySelector('[data-close-notes]')?.addEventListener('click',()=>{ stashActiveNoteInput(); scheduleEditorSave(); isNotesOpen=false; renderEditor() }); app.querySelector('[data-save-notes]')?.addEventListener('click',()=>{ stashActiveNoteInput(); scheduleEditorSave(); isNotesOpen=false; renderEditor() }); app.querySelectorAll('[data-notes-page]').forEach((el)=>el.addEventListener('click',()=>{ stashActiveNoteInput(); activeNotePageId = el.dataset.notesPage; scheduleEditorSave(); renderEditor() })); app.querySelector('[data-add-notes-page]')?.addEventListener('click',()=>{ stashActiveNoteInput(); const pageNumber = notePages.length + 1; const id = `page-${pageNumber}`; notePages = [...notePages, { id, title: `Page ${pageNumber}`, body: '' }]; activeNotePageId = id; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-follow-playhead]')?.addEventListener('click',()=>{ followPlayhead=!followPlayhead; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-metronome]')?.addEventListener('click',()=>{ isMetronomeEnabled=!isMetronomeEnabled; if (isMetronomeEnabled) getAudioContext(); scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-cycle]')?.addEventListener('click',()=>{ setCycleEnabled(!isCycleEnabled); scheduleEditorSave(); renderEditor() }); app.querySelectorAll('[data-bottom-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.bottomPanel; if(!id) return; openBottomPanel(id) })); app.querySelectorAll('[data-instrument-subpage]').forEach((el)=>{ el.addEventListener('click',(event)=>{ event.stopPropagation(); const next=el.dataset.instrumentSubpage; if(!next||activeInstrumentSubpage===next) return; if(activeInstrumentSubpage==='keyboard'&&next!=='keyboard') stopAllInstrumentNotes(); activeInstrumentSubpage=next; renderEditor() }) })
  app.querySelectorAll('[data-midi]').forEach((key)=>{ const midi=Number(key.dataset.midi); key.addEventListener('pointerdown',(e)=>{ e.preventDefault(); startInstrumentNote(midi) }); key.addEventListener('pointerup',()=>{ stopInstrumentNote(midi) }); key.addEventListener('pointerleave',()=>{ stopInstrumentNote(midi) }) }); app.querySelector('[data-sustain-toggle]')?.addEventListener('click',()=>{ isSustainEnabled=!isSustainEnabled; if(!isSustainEnabled) stopAllInstrumentNotes(); renderEditor() }); app.querySelector('[data-octave-down]')?.addEventListener('click',()=>{ instrumentOctaveOffset=Math.max(-2,instrumentOctaveOffset-1); stopAllInstrumentNotes(); renderEditor() }); app.querySelector('[data-octave-up]')?.addEventListener('click',()=>{ instrumentOctaveOffset=Math.min(2,instrumentOctaveOffset+1); stopAllInstrumentNotes(); renderEditor() }); app.querySelectorAll('[data-instrument-knob]').forEach((input)=>{ input.addEventListener('input',(e)=>{ const knob=e.target.dataset.instrumentKnob; const value=Number(e.target.value); const selected=getSelectedTrack(); if(knob==='volume'){ instrumentVolume=value; if(selected){ selected.volume=Math.round(value*100); syncSelectedTrackVolumeControl(selected) } if(instrumentMasterGain&&instrumentAudioContext) instrumentMasterGain.gain.setValueAtTime(instrumentVolume,instrumentAudioContext.currentTime) } else if(knob==='pan'){ instrumentPan=value; if(selected) selected.pan=value; if(instrumentPanNode&&instrumentAudioContext) instrumentPanNode.pan.setValueAtTime(instrumentPan,instrumentAudioContext.currentTime); app.querySelector(`[data-track-pan="${selected?.id}"]`)?.style.setProperty('--pan-angle', `${value * 135}deg`) } const dial=app.querySelector(`[data-instrument-knob-dial="${knob}"]`); const valueEl=app.querySelector(`[data-instrument-knob-value="${knob}"]`); if(dial) dial.style.setProperty('--knob-angle',`${-135 + ((value-Number(e.target.min))/(Number(e.target.max)-Number(e.target.min)))*270}deg`); if(valueEl) valueEl.textContent = knob==='pan' ? value.toFixed(2) : `${Math.round(value*100)}%` }); input.addEventListener('change',()=>scheduleEditorSave()); input.addEventListener('pointerdown',(event)=>{ event.preventDefault(); const startY=event.clientY; const startValue=Number(input.value); const min=Number(input.min); const max=Number(input.max); const speed = input.dataset.instrumentKnob==='pan' ? 0.004 : 0.002; const onMove=(ev)=>{ const delta=-(ev.clientY-startY)*speed; const next=clamp(startValue+delta,min,max); input.value=String(next); input.dispatchEvent(new Event('input',{bubbles:true})) }; const onUp=()=>{ window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp); scheduleEditorSave() }; window.addEventListener('pointermove',onMove); window.addEventListener('pointerup',onUp,{once:true}) }) }); app.querySelectorAll('[data-preset-load]').forEach((button)=>{ button.addEventListener('click',(event)=>{ event.stopPropagation(); const preset=instrumentPresetItems.find((item)=>item.id===button.dataset.presetLoad); if(!preset) return; selectedInstrumentName=preset.name; renderEditor() }) }); app.querySelector('[data-arp-toggle]')?.addEventListener('click',()=>{ arpEnabled=!arpEnabled; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-mode]')?.addEventListener('change',(e)=>{ arpMode=e.target.value; scheduleEditorSave() }); app.querySelector('[data-arp-rate]')?.addEventListener('change',(e)=>{ arpRate=e.target.value; scheduleEditorSave() }); app.querySelector('[data-arp-length]')?.addEventListener('change',(e)=>{ arpLength=Number(e.target.value)||16; if(selectedArpStepIndex>=arpLength) selectedArpStepIndex=arpLength-1; renderEditor(); scheduleEditorSave() }); app.querySelectorAll('[data-arp-octave]').forEach((btn)=>btn.addEventListener('click',()=>{ const d=Number(btn.dataset.arpOctave||0); arpOctaves=clamp(arpOctaves+d,1,4); renderEditor(); scheduleEditorSave() })); app.querySelector('[data-arp-gate]')?.addEventListener('input',(e)=>{ arpGate=Number(e.target.value); e.target.nextElementSibling.textContent=`${arpGate}%` }); app.querySelector('[data-arp-swing]')?.addEventListener('input',(e)=>{ arpSwing=Number(e.target.value); e.target.nextElementSibling.textContent=`${arpSwing}%` }); app.querySelector('[data-arp-velocity]')?.addEventListener('input',(e)=>{ arpVelocity=Number(e.target.value); e.target.nextElementSibling.textContent=String(arpVelocity) }); app.querySelectorAll('[data-arp-gate],[data-arp-swing],[data-arp-velocity]').forEach((el)=>el.addEventListener('change',()=>scheduleEditorSave())); app.querySelectorAll('[data-arp-edit-mode]').forEach((button)=>{ button.addEventListener('click',()=>{ const next=button.dataset.arpEditMode; if(!next||arpEditMode===next) return; arpEditMode=next; if(next!=='note') arpNotePickerStepIndex=null; renderEditor() }) }); app.querySelectorAll('[data-arp-step]').forEach((el)=>el.addEventListener('pointerdown',(event)=>{ const i=Number(el.dataset.arpStep); if(!Number.isFinite(i)||!arpSteps[i]) return; const step=arpSteps[i]=normalizeArpStep(arpSteps[i],i); selectedArpStepIndex=i; if(event.ctrlKey||event.metaKey){ step.active=!step.active; renderEditor(); scheduleEditorSave(); return } if(event.shiftKey){ step.accent=!step.accent; renderEditor(); scheduleEditorSave(); return } if(event.altKey){ step.octave=step.octave>=2?-1:step.octave+1; renderEditor(); scheduleEditorSave(); return } if(arpEditMode==='note'){ arpNotePickerStepIndex=i; arpNotePickerOctave=step.noteOctave ?? arpNotePickerOctave; renderEditor(); return } if(arpEditMode==='velocity'){ step.active=true; step.velocity=getVelocityFromStepPointer(event, el); renderEditor(); scheduleEditorSave(); return } cycleArpStepByMode(step, arpEditMode); step.active=true; renderEditor(); scheduleEditorSave() })); app.querySelectorAll('[data-arp-note-picker-octave]').forEach((button)=>{ button.addEventListener('click',()=>{ arpNotePickerOctave=clamp(arpNotePickerOctave+Number(button.dataset.arpNotePickerOctave||0),0,8); renderEditor() }) }); app.querySelector('[data-arp-note-picker-close]')?.addEventListener('click',()=>{ arpNotePickerStepIndex=null; renderEditor() }); app.querySelectorAll('[data-arp-note-value]').forEach((button)=>{ button.addEventListener('click',()=>{ const stepIndex=arpNotePickerStepIndex; if(stepIndex==null||!arpSteps[stepIndex]) return; const st=arpSteps[stepIndex]=normalizeArpStep(arpSteps[stepIndex],stepIndex); st.note=clamp(Number(button.dataset.arpNoteValue),0,11); st.noteOctave=arpNotePickerOctave; st.active=true; selectedArpStepIndex=stepIndex; arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }) }); app.querySelector('[data-arp-reset]')?.addEventListener('click',()=>{ arpSteps=arpSteps.map((_,i)=>normalizeArpStep({ ...createDefaultArpStep(i), octave:0, accent:false },i)); currentArpPatternName='Custom Pattern'; arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-randomize]')?.addEventListener('click',()=>{ arpSteps=arpSteps.map((_,i)=>normalizeArpStep({ active:Math.random()>.35, note:Math.floor(Math.random()*12), noteOctave:Math.floor(3+Math.random()*3), velocity:Math.floor(35+Math.random()*92), octave:[-1,0,0,1][Math.floor(Math.random()*4)], gate:[10,25,50,70,85,100][Math.floor(Math.random()*6)], probability:[0,25,50,75,100][Math.floor(Math.random()*5)], accent:Math.random()>.75, tie:Math.random()>.9 },i)); currentArpPatternName='Custom Pattern'; arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelectorAll('[data-arp-pattern]').forEach((el)=>el.addEventListener('click',()=>{ const name=el.dataset.arpPattern||''; if(name.includes('Straight')) arpSteps=arpSteps.map((s,i)=>normalizeArpStep({ ...s, active:i%2===0, velocity:95, octave:0, accent:false },i)); else if(name.includes('Random')) arpSteps=arpSteps.map((s,i)=>normalizeArpStep({ ...s, active:Math.random()>.45, velocity:Math.floor(45+Math.random()*80), octave:[-1,0,1][Math.floor(Math.random()*3)], probability:[0,25,50,75,100][Math.floor(Math.random()*5)], accent:Math.random()>.8 },i)); else if(name.includes('Chord')) arpMode='Chord Repeat'; currentArpPatternName=name; renderEditor(); scheduleEditorSave() })); app.querySelector('[data-arp-step-active]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.active=e.target.checked; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-note]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.note=clamp(Number(e.target.value)||0,0,11); arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-note-octave]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.noteOctave=clamp(Number(e.target.value)||4,0,8); arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-octave]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.octave=clamp(Number(e.target.value)||0,-2,4); renderEditor(); scheduleEditorSave() }); [['[data-arp-step-velocity]','velocity','[data-arp-step-velocity-value]',''],['[data-arp-step-gate]','gate','[data-arp-step-gate-value]','%'],['[data-arp-step-probability]','probability','[data-arp-step-probability-value]','%']].forEach(([sel,key,valSel,suffix])=>{ const input=app.querySelector(sel); const valueEl=app.querySelector(valSel); if(!input) return; input.addEventListener('input',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st[key]=Number(e.target.value); if(valueEl) valueEl.textContent=`${st[key]}${suffix}` }); input.addEventListener('change',()=>{ renderEditor(); scheduleEditorSave() }) }); app.querySelector('[data-arp-step-accent]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.accent=e.target.checked; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-tie]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.tie=e.target.checked; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-instrument-select]')?.addEventListener('change',(e)=>{ selectedInstrumentName=e.target.value });
  app.querySelector('[data-close-bottom-panel]')?.addEventListener('click', ()=>{ closeBottomPanel() })
  updateTransportPlaybackUI()
}

// TODO: connect navigator.requestMIDIAccess() after MIDI permission UX is designed.
function renderEditor() {
  const project = projectState
  if (studioAudioEngine) studioAudioEngine.setBpm(Number(project?.bpm || 140))
  document.body.classList.add('is-studio-editor')
  const shell = `<main class="studio-editor-page ${activeLeftPanel ? "has-left-panel" : ""} ${keepSiteMenuOpen ? 'has-site-nav' : 'is-fullscreen'}" style="--studio-track-height:${timelineState.trackHeight}px"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu" aria-expanded="false">☰</button><nav class="studio-editor-menu"><button>File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button>Help</button></nav><aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small>${isCountInRunning ? `Count-in: ${countInBeatsRemaining}` : (recordingStatus || 'Project loaded')}</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group studio-tool-group--left"><button data-left-panel="library" class="studio-tool-button ${activeLeftPanel==='library'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='library')}" data-tooltip="Library">${toolIcon('library')}</button><button data-left-panel="inspector" class="studio-tool-button ${activeLeftPanel==='inspector'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='inspector')}" data-tooltip="Inspector">${toolIcon('inspector')}</button><button data-open-notes class="studio-tool-button ${isNotesOpen ? 'is-active' : ''}" aria-pressed="${String(isNotesOpen)}" data-tooltip="Notes">${toolIcon('notes')}</button><button data-left-panel="smart-controls" class="studio-tool-button ${activeLeftPanel==='smart-controls'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='smart-controls')}" data-tooltip="Smart Controls">${toolIcon('sliders')}</button><button data-left-panel="loop-browser" class="studio-tool-button ${activeLeftPanel==='loop-browser'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='loop-browser')}" data-tooltip="Loop Browser">${toolIcon('store')}</button></div><div class="studio-transport-center"><div class="studio-tool-group studio-tool-group--transport"><button data-transport-start class="studio-tool-button" aria-label="Go to start" data-tooltip="Go to start">${toolIcon('start')}</button> <button data-transport-rewind class="studio-tool-button" aria-label="Rewind" data-tooltip="Rewind">${toolIcon('rewind')}</button> <button data-transport-play class="studio-tool-button ${isPlaying ? 'is-active' : ''}" aria-label="${isPlaying ? 'Pause' : 'Play'}" data-tooltip="${isPlaying ? 'Pause' : 'Play'}" aria-pressed="${isPlaying}">${isPlaying ? '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><path d=\"M8 5v14M16 5v14\"/></svg>' : toolIcon('play')}</button> <button data-transport-stop class="studio-tool-button" aria-label="Stop" data-tooltip="Stop">${toolIcon('stop')}</button> <button data-transport-record class="studio-tool-button" aria-label="Record" data-tooltip="Record">${toolIcon('record')}</button> <button data-transport-forward class="studio-tool-button" aria-label="Fast forward" data-tooltip="Fast forward">${toolIcon('forward')}</button> <button data-transport-end class="studio-tool-button" aria-label="Go to end" data-tooltip="Go to end">${toolIcon('end')}</button> <button data-toggle-cycle class="studio-tool-button studio-tool-button--cycle ${isCycleEnabled ? 'is-active' : ''}" aria-label="Cycle" aria-pressed="${String(isCycleEnabled)}" data-tooltip="Cycle">${toolIcon('loop')}</button></div><div class="studio-logic-display" aria-label="Project transport display"><section class="studio-logic-section studio-logic-section--time"><strong class="studio-logic-primary" data-display-time>${formatTimeFromPlayhead()}</strong><span class="studio-logic-secondary">time</span></section><section class="studio-logic-section studio-logic-section--bars"><strong class="studio-logic-primary" data-display-bars>${formatBarsFromPlayhead()}</strong><span class="studio-logic-secondary">bar beat div tick</span></section><section class="studio-logic-section studio-logic-section--tempo"><strong class="studio-logic-primary">${Number(project.bpm || 140).toFixed(4)}</strong><span class="studio-logic-secondary">4/4 <button class="studio-display-icon-button" aria-label="Tempo settings" data-tooltip="Tempo settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/></svg></button></span></section><section class="studio-logic-section studio-logic-section--key"><strong class="studio-logic-primary">${project.key}</strong><span class="studio-logic-secondary">key</span></section><section class="studio-logic-section studio-logic-section--midi"><strong class="studio-logic-primary" data-midi-status>No MIDI</strong><span class="studio-logic-secondary">input</span></section><section class="studio-logic-section studio-logic-section--cpu"><strong class="studio-logic-primary">0%</strong><span class="studio-logic-secondary">CPU</span></section></div><div class="studio-tool-group studio-tool-group--utilities"><button data-toggle-metronome class="studio-tool-button ${isMetronomeEnabled ? 'is-active' : ''}" aria-label="Metronome" aria-pressed="${String(isMetronomeEnabled)}" data-tooltip="Metronome">${toolIcon('metro')}</button><button data-toggle-count-in class="studio-tool-button studio-tool-button--count-in ${isCountInEnabled ? 'is-active' : ''}" aria-label="Count-in" aria-pressed="${String(isCountInEnabled)}" data-tooltip="Count-in">${toolIcon('count')}</button><button data-toggle-snap class="studio-tool-button ${isSnapEnabled ? 'is-active' : ''}" aria-label="Snap" aria-pressed="${String(isSnapEnabled)}" data-tooltip="Snap">${toolIcon('snap')}</button><button data-toggle-follow-playhead class="studio-tool-button ${followPlayhead ? 'is-active' : ''}" aria-label="Follow Playhead" aria-pressed="${String(followPlayhead)}" data-tooltip="Follow Playhead"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg></button></div></div><div class="studio-transport-spacer" aria-hidden="true"></div></section><div class="studio-editor-workspace">${activeLeftPanel ? renderLeftPanel() : ""}<aside class="studio-track-panel">${tracks.map(renderTrackCard).join('')}</aside><section class="studio-arrangement" data-arrangement style="--bars: ${timelineState.bars}; --beats-per-bar: ${timelineState.beatsPerBar}; --pixels-per-bar: ${timelineState.pixelsPerBar}px; --pixels-per-beat: ${timelineState.pixelsPerBar / timelineState.beatsPerBar}px; --playhead-x: ${timelineState.playheadX}px; --timeline-content-width: ${timelineContentWidth()}px;"><div class="studio-timeline-ruler" data-timeline-ruler><div class="studio-timeline-ruler-inner" data-timeline-ruler-inner><div class="studio-cycle-strip" data-cycle-strip>${renderCycleRange()}</div><span class="studio-negative-zone studio-negative-zone--ruler" style="width:${barZeroX()}px"></span>${renderTimelineRuler()}<span class="studio-ruler-playhead" data-ruler-playhead></span></div></div><div class="studio-arrangement-grid" data-arrangement-grid><div class="studio-arrangement-grid-inner" data-arrangement-grid-inner><span class="studio-negative-zone studio-negative-zone--grid" style="width:${barZeroX()}px"></span>${renderTimelineLines()}${renderTimelineRegions()}${renderCycleBoundaryGuides()}<span class="studio-grid-playhead" data-grid-playhead></span><div class="studio-selection-box" data-selection-box hidden></div></div></div><div class="studio-timeline-extension-lane" data-timeline-extension-lane><div class="studio-timeline-extension-lane-inner" data-timeline-extension-inner><button class="studio-timeline-extension-handle studio-timeline-extension-handle--left" data-timeline-extension-handle="left" aria-label="Adjust timeline start"></button><button class="studio-timeline-extension-handle studio-timeline-extension-handle--right" data-timeline-extension-handle="right" aria-label="Adjust timeline end"></button></div></div></section><aside class="studio-right-rail"><button data-bottom-panel="loops" class="${activeBottomPanel==='loops' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='loops')}">Loops</button><button data-bottom-panel="fx" class="${activeBottomPanel==='fx' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='fx')}">FX</button><button data-bottom-panel="mixer" class="${activeBottomPanel==='mixer' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='mixer')}">Mixer</button><button data-bottom-panel="collab" class="${activeBottomPanel==='collab' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='collab')}">Collab</button><button data-bottom-panel="instrument" class="${activeBottomPanel==='instrument' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='instrument')}">Instrument</button>${activeBottomPanel==='instrument'?`<div class="studio-right-rail-divider"></div><div class="studio-right-rail-subtools" data-instrument-subtools>${instrumentSubpages.map((page)=>`<button class="studio-right-rail-subtool is-enabled ${activeInstrumentSubpage===page.id?'is-active':''}" data-instrument-subpage="${page.id}" aria-pressed="${String(activeInstrumentSubpage===page.id)}" type="button">${page.label}</button>`).join('')}</div>`:''}</aside></div>${(activeBottomPanel||closingBottomPanel) ? renderBottomPanel((activeBottomPanel||closingBottomPanel), bottomPanelMotion==='entering'?'is-bottom-panel-entering':(bottomPanelMotion==='exiting'?'is-bottom-panel-exiting':'')) : ''}<section class="studio-effects-panel" hidden></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span><span class="studio-footer-save-status" data-save-status>${saveStatus}</span></footer><div class="studio-tooltip-layer" data-studio-tooltip hidden></div>${renderNotesModal()}</main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  if (keepSiteMenuOpen) initShellChrome()
  app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', dawWindowManager.renderWindows())
  setEditorMenuOpen(isEditorMenuOpen)
  bindEditorEvents()
  dawWindowManager.bind(app)
}



function handleStudioKeydown(event){ if(event.ctrlKey||event.metaKey||event.altKey) return; if(isTextEntryTarget(event.target)) return; const instrumentKeyMap={KeyZ:48,KeyS:49,KeyX:50,KeyD:51,KeyC:52,KeyV:53,KeyG:54,KeyB:55,KeyH:56,KeyN:57,KeyJ:58,KeyM:59,Comma:60,KeyQ:60,Digit2:61,KeyW:62,Digit3:63,KeyE:64,KeyR:65,Digit5:66,KeyT:67,Digit6:68,KeyY:69,Digit7:70,KeyU:71,KeyI:72,Digit9:73,KeyO:74,Digit0:75,KeyP:76}; if(activeBottomPanel==='instrument'&&activeInstrumentSubpage==='keyboard'&&instrumentKeyMap[event.code]!=null){ if(event.repeat||pressedKeyboardNotes.has(event.code)) return; pressedKeyboardNotes.add(event.code); event.preventDefault(); startInstrumentNote(instrumentKeyMap[event.code]); return } const t=tracks.find((x)=>x.id===selectedTrackId); const step=timelineState.pixelsPerBar/timelineState.beatsPerBar; if(event.code==='Space'){handleSpaceTransport(event)} else if(event.code==='Enter'){event.preventDefault();setPlayhead(barZeroX());scheduleEditorSave();lastMetronomeBeat=-1} else if(event.code==='ArrowLeft'){event.preventDefault();setPlayhead(timelineState.playheadX-step)} else if(event.code==='ArrowRight'){event.preventDefault();setPlayhead(timelineState.playheadX+step)} else if(event.code==='KeyR'){event.preventDefault(); if(t){t.recordArmed=!t.recordArmed; renderEditor()}} else if(event.code==='KeyC'){event.preventDefault(); isCycleEnabled=!isCycleEnabled; renderEditor()} else if(event.code==='KeyK'){event.preventDefault(); isMetronomeEnabled=!isMetronomeEnabled; if(isMetronomeEnabled) getAudioContext(); renderEditor()} }
if(!window.__melogicStudioKeybindsBound){ window.__melogicStudioKeybindsBound=true; document.addEventListener('keydown', handleStudioKeydown); document.addEventListener('keyup',(event)=>{ const instrumentKeyMap={KeyZ:48,KeyS:49,KeyX:50,KeyD:51,KeyC:52,KeyV:53,KeyG:54,KeyB:55,KeyH:56,KeyN:57,KeyJ:58,KeyM:59,Comma:60,KeyQ:60,Digit2:61,KeyW:62,Digit3:63,KeyE:64,KeyR:65,Digit5:66,KeyT:67,Digit6:68,KeyY:69,Digit7:70,KeyU:71,KeyI:72,Digit9:73,KeyO:74,Digit0:75,KeyP:76}; if(instrumentKeyMap[event.code]==null) return; pressedKeyboardNotes.delete(event.code); stopInstrumentNote(instrumentKeyMap[event.code]);  }) }
if(!window.__melogicDawInstrumentCleanupBound){ window.__melogicDawInstrumentCleanupBound=true; window.addEventListener('beforeunload',()=>{ dawInstrumentRegistry.disposeAll(); dawWindowManager.destroy() }) }

async function init() { renderState('Loading project...'); const user = await waitForInitialAuthState(); if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname })); const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.'); const project = await getStudioProject(id); if (!project) return renderState('Studio project not found.'); if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.'); touchStudioProject(project.id).catch(() => {}); projectState = project; if (projectState.editorState) applyLoadedEditorState(projectState.editorState); ensureDefaultCycleRange(); isEditorLoaded = true; renderEditor() }
init()
