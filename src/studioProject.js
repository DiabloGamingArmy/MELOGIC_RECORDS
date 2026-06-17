import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
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
import { mountResonaChatSurface } from './components/resonaChatSurface.js'
import {
  findFolderByPath,
  flattenLibraryFolders,
  getDefaultLibraryContent,
  getInstrumentsForFolder,
  samplePlaybackModeLabel,
  sampleStrategyDefinition
} from './data/studioLibraryService.js'
import './styles/dawPluginWindow.css'

const app = document.querySelector('#app')
const reserved = new Set(['demos', 'tutorials', 'project', 'distribution', 'daw', 'stagemaker'])
const PREF_KEY = 'melogic_studio_keep_site_menu_open'
const MUSICAL_TYPING_PREF_KEY = 'melogic:daw:musicalTyping'
const CHANNEL_ACCORDION_PREF_KEY = 'melogic:daw:channelStripSettings:accordionState'
let keepSiteMenuOpen = localStorage.getItem(PREF_KEY) === '1'
let channelAccordionState = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem(CHANNEL_ACCORDION_PREF_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
})()
let projectState = null
const dawInstrumentRegistry = new InstrumentRegistry({
  getAudioContext: () => getAudioContext(),
  getDestination: (trackId) => getTrackAudioChannel(trackId).input,
  resolveLibraryInstrument: (instrumentId) => resolveStudioLibraryInstrument(instrumentId)
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
    // Closing a plugin window hides the UI; the track-owned instrument can keep sounding/recording.
  },
  onParamChange: (pluginInstanceId, param, value) => {
    dawInstrumentRegistry.setParam(pluginInstanceId, param, value)
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    if (track?.instrument) track.instrument.params = { ...(track.instrument.params || {}), [param]: value }
  },
  onNoteOn: (pluginInstanceId, note, velocity) => {
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    if (track?.instrument?.enabled === false) return
    dawInstrumentRegistry.noteOn(pluginInstanceId, note, velocity)
    startTrackMeterLoop()
    setTrackKeyboardNoteActive(track?.id || selectedTrackId, note, `plugin:${pluginInstanceId}:${note}`, true)
    recordMidiNoteOn(track?.id || selectedTrackId, note, velocity)
  },
  onNoteOff: (pluginInstanceId, note) => {
    dawInstrumentRegistry.noteOff(pluginInstanceId, note)
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    setTrackKeyboardNoteActive(track?.id || selectedTrackId, note, `plugin:${pluginInstanceId}:${note}`, false)
    recordMidiNoteOff(track?.id || selectedTrackId, note)
  },
  onChange: () => renderEditor()
})
let isEditorMenuOpen = false
let selectedTrackId = 'demo-track'
const automationOpenTrackIds = new Set()
let trackMenuState = null
let renameTrackState = null
let colorPickerState = null
let activeBottomPanel = ''
let isControlsMenuOpen = false
const activeInstrumentNotes = new Map()
const pressedKeyboardNotes = new Set()
const pressedDawMidiKeys = new Map()
const activeKeyboardNoteSources = new Map()
let isTypingPianoEnabled = localStorage.getItem(MUSICAL_TYPING_PREF_KEY) === '1'
let instrumentAudioContext = null
let instrumentMasterGain = null
let instrumentPanNode = null
let instrumentVolume = 0.35
let instrumentPan = 0
let instrumentTreble = 0.5
let instrumentReverb = 0.3
let instrumentOctaveOffset = 0
let instrumentMacroView = 'knobs'
let typingExpressionTarget = 'pitch'
let typingPitchTrigger = 0
let typingModTrigger = 0
let typingPitchFine = 0
let typingModFine = 0
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
let selectedInstrumentName = ''
let activeInstrumentSubpage = 'keyboard'
const instrumentSubpages = []
const instrumentPresetItems = []
const chordRoots = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
const chordOctaves = ['Oct 1','Oct 2','Oct 3','Oct 4','Oct 5','Oct 6']
let activeMidiEffectEditor = null
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
let studioLibraryState = {
  data: null,
  loading: false,
  loaded: false,
  error: '',
  selectedPath: '',
  selectedInstrumentId: '',
  expandedRootIds: new Set(),
  loadStatusByInstrumentId: new Map()
}
let studioLibraryManifestPromise = null
let inspectorMenu = null
let inspectorMenuPosition = null
let globalTracks = {
  visible: false,
  viewMode: 'all',
  arrangement: [],
  markers: [],
  tempoEvents: [],
  signatureEvents: [],
  videoRefs: []
}
let isNotesOpen = false
let notePages = [{ id: 'page-1', title: 'Page 1', body: '' }]
let activeNotePageId = 'page-1'
let isSnapEnabled = false
let isCountInEnabled = true
let isCountInRunning = false
let countInTimer = 0
let countInBeatsRemaining = 0
let countInTargetX = null
let countInTargetTrackId = ''
let recordingStatus = ''
let activeRecording = null
let selectedMidiRegionId = ''
let midiRegionDrag = null
let meterRaf = 0
let midiRegionMenuState = null
let midiRegionClipboard = null
let midiRollState = null
let midiRollSelectedNoteIndex = null
let midiRollSelectedNoteIndices = []
let midiRollStatus = ''
let midiRollViewport = { regionId: '', scrollLeft: 0, scrollTop: 0 }
let pendingMidiRollViewport = null
let midiRollBeatWidth = 64
let midiRollRowHeight = 22
let midiRollSelectionDrag = null
let midiNoteDrag = null
let regionRenameState = null
let regionColorPickerState = null
let audioEnginePrewarmPromise = null
let bottomPanelHeightPx = 0
let bottomPanelResizeDrag = null
const undoStack = []
const redoStack = []
const HISTORY_LIMIT = 80
const trackAudioChannels = new Map()
const activePlaybackNotes = new Map()
let lastPlaybackBeat = 0
let globalTrackDrag = null
let globalTrackPopover = null
let midiRegions = []
const activeRecordingNotes = new Map()
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

const GLOBAL_TRACK_VIEW_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'markers', label: 'Markers' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'signature', label: 'Key / Signature' },
  { value: 'video', label: 'Video / Reference' }
]
const GLOBAL_TRACK_ROW_LABELS = {
  arrangement: 'Arrangement',
  markers: 'Markers',
  tempo: 'Tempo',
  signature: 'Key / Signature',
  video: 'Video / Reference'
}
const globalTrackRowsForView = () => globalTracks.viewMode === 'all' ? ['arrangement', 'markers', 'tempo', 'signature', 'video'] : [globalTracks.viewMode || 'markers']
const renderTrackToolbar = () => `<div class="studio-track-toolbar" aria-label="Track toolbar"><button type="button" data-add-track data-tooltip="Add Track" aria-label="Add Track">+</button><button type="button" data-duplicate-track data-tooltip="Duplicate selected track" aria-label="Duplicate selected track">⧉</button><button type="button" class="${globalTracks.visible ? 'is-active' : ''}" data-toggle-global-tracks data-tooltip="${globalTracks.visible ? 'Hide Global Tracks' : 'Show Global Tracks'}" aria-label="${globalTracks.visible ? 'Hide Global Tracks' : 'Show Global Tracks'}">G</button><select data-global-track-view aria-label="Global track view">${GLOBAL_TRACK_VIEW_OPTIONS.map((option)=>`<option value="${option.value}" ${globalTracks.viewMode===option.value?'selected':''}>${option.label}</option>`).join('')}</select></div>`
const renderTrackCard = (track) => {
  const level = clamp(Number(track.outputLevel) || 0, 0, 1)
  return `<div class="studio-track-stack"><article class="studio-track-card ${selectedTrackId === track.id ? 'is-selected' : ''} ${timelineState.trackHeight <= 56 ? 'is-track-compact' : ''}" data-track-row="${track.id}" data-guide-id="studio-track-${esc(track.id)}" data-guide-label="${esc(track.name)} track" data-guide-role="daw-track" style="--track-color: ${track.color}; --track-color-soft: ${track.colorSoft};--track-meter-level:${level};"><div class="studio-track-header-row"><button class="studio-track-icon" type="button" aria-label="${track.name} track" data-track-icon="${track.id}">${trackTypeIcon(track.type)}</button><strong class="studio-track-name">${track.name}</strong><button class="studio-track-more" type="button" data-track-options="${track.id}" aria-label="Track options" data-tooltip="Track options">${icon('more')}</button></div><div class="studio-track-control-row"><button type="button" class="studio-track-control ${track.muted ? 'is-active' : ''}" data-track-mute="${track.id}" aria-label="Mute ${track.name}" data-tooltip="Mute">${icon('mute')}</button><button type="button" class="studio-track-control ${track.soloed ? 'is-active' : ''}" data-track-solo="${track.id}" aria-label="Solo ${track.name}" data-tooltip="Solo">${icon('solo')}</button><button type="button" class="studio-record-arm ${track.recordArmed ? 'is-active' : ''}" data-track-record="${track.id}" aria-label="Record arm ${track.name}" data-tooltip="Record arm">R</button><button type="button" class="studio-track-control" data-track-automation="${track.id}" aria-label="Automation ${track.name}" data-tooltip="Automation">${icon('automation')}</button><input class="studio-track-volume" data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}" aria-label="${track.name} volume" /><button class="studio-track-pan" type="button" aria-label="${track.name} pan ${Math.round(track.pan)}" data-tooltip="Pan ${Math.round(track.pan)}" data-track-pan="${track.id}" style="--pan-angle: ${(track.pan / 100) * 135}deg"></button><span class="studio-track-meter-separator" aria-hidden="true"></span><span class="studio-track-meter" data-track-meter="${track.id}" aria-label="${track.name} output meter"><i style="height:${Math.round(level * 100)}%"></i><b style="bottom:${Math.round(level * 100)}%"></b></span></div></article>${track.automationOpen ? '<div class="studio-automation-lane"><span>Automation</span><button type="button">Volume</button><button type="button">Pan</button><button type="button">Filter</button><button type="button">Add</button></div>' : ''}</div>`
}
const renderTrackContextMenu = () => {
  if (!trackMenuState?.trackId) return ''
  const track = tracks.find((item) => item.id === trackMenuState.trackId)
  if (!track) return ''
  return `<div class="studio-track-menu studio-track-menu--floating" data-track-menu style="left:${Math.round(trackMenuState.x)}px;top:${Math.round(trackMenuState.y)}px"><strong>${track.name}</strong><button data-track-context-action="rename">Rename Track</button><button data-track-context-action="duplicate">Duplicate Track</button><button data-track-context-action="delete" ${tracks.length <= 1 ? 'disabled' : ''}>Delete Track</button><button data-track-context-action="color">Change Color</button><button data-track-context-action="inspector">Open Inspector</button></div>`
}
function getClampedFloatingPosition(clientX = 0, clientY = 0, width = 220, height = 260) {
  const margin = 8
  const rect = app?.querySelector?.('.studio-editor-page')?.getBoundingClientRect?.() || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  return {
    x: clamp(clientX, rect.left + margin, Math.max(rect.left + margin, rect.right - width - margin)),
    y: clamp(clientY, rect.top + margin, Math.max(rect.top + margin, rect.bottom - height - margin))
  }
}
function setMusicalTypingEnabled(enabled) {
  isTypingPianoEnabled = !!enabled
  localStorage.setItem(MUSICAL_TYPING_PREF_KEY, isTypingPianoEnabled ? '1' : '0')
  if (!isTypingPianoEnabled) stopAllTrackInstrumentNotes()
}
function isChannelSectionOpen(sectionId = '', defaultOpen = false) {
  return Object.prototype.hasOwnProperty.call(channelAccordionState, sectionId) ? channelAccordionState[sectionId] !== false : defaultOpen
}
function persistChannelAccordionState(sectionId = '', open = false) {
  if (!sectionId) return
  channelAccordionState = { ...channelAccordionState, [sectionId]: !!open }
  localStorage.setItem(CHANNEL_ACCORDION_PREF_KEY, JSON.stringify(channelAccordionState))
}
function renderMidiRegionContextMenu() {
  if (!midiRegionMenuState?.regionId) return ''
  const region = midiRegions.find((item)=>item.id === midiRegionMenuState.regionId)
  if (!region) return ''
  return `<div class="studio-midi-context-menu" data-midi-context-menu style="left:${Math.round(midiRegionMenuState.x)}px;top:${Math.round(midiRegionMenuState.y)}px">
    <strong>${esc(getMidiRegionLabel(region))}</strong>
    <button type="button" data-midi-region-action="view-roll">View MIDI Roll</button>
    <button type="button" data-midi-region-action="rename">Rename Region</button>
    <button type="button" data-midi-region-action="copy">Copy</button>
    <button type="button" data-midi-region-action="paste" ${midiRegionClipboard ? '' : 'disabled'}>Paste</button>
    <button type="button" data-midi-region-action="color">Independent Color</button>
    <button type="button" data-midi-region-action="delete">Delete</button>
  </div>`
}
function renderMidiRegionColorPopover() {
  if (!regionColorPickerState?.regionId) return ''
  const region = midiRegions.find((item)=>item.id === regionColorPickerState.regionId)
  if (!region) return ''
  return `<form class="studio-midi-color-popover" data-midi-color-form style="left:${Math.round(regionColorPickerState.x)}px;top:${Math.round(regionColorPickerState.y)}px">
    <label>Region Color<input type="color" data-midi-region-color-input value="${esc(region.independentColor || region.color || '#58d4ff')}" /></label>
    <button type="submit">Apply</button>
    <button type="button" data-midi-region-reset-color>Reset to Track Color</button>
  </form>`
}
function renderMidiRegionRenamePopover() {
  if (!regionRenameState?.regionId) return ''
  const region = midiRegions.find((item)=>item.id === regionRenameState.regionId)
  if (!region) return ''
  return `<form class="studio-midi-rename-popover" data-midi-rename-form style="left:${Math.round(regionRenameState.x)}px;top:${Math.round(regionRenameState.y)}px">
    <label>Region Name<input data-midi-rename-input value="${esc(region.name || '')}" placeholder="${esc(getMidiRegionTrack(region)?.name || 'Track name')}" /></label>
    <div><button type="submit">Save</button><button type="button" data-midi-rename-cancel>Cancel</button></div>
  </form>`
}
function renderMidiRollModal() {
  return ''
}
function midiRollPitchRows(region = getMidiRollRegion()) {
  const track = getMidiRegionTrack(region)
  const playable = getInstrumentPlayableRange(track)
  const notes = (region?.notes || []).map((note)=>Number(note?.note)).filter(Number.isFinite)
  const minNote = Math.min(36, playable.hasMappedRange ? playable.min : 36, ...(notes.length ? notes : [36]))
  const maxNote = Math.max(84, playable.hasMappedRange ? playable.max : 84, ...(notes.length ? notes : [84]))
  const rowMin = Math.floor(minNote / 12) * 12
  const rowMax = (Math.ceil((maxNote + 1) / 12) * 12) - 1
  const rows = []
  for (let note = rowMax; note >= rowMin; note -= 1) rows.push(note)
  return rows
}
function formatMidiNoteName(midi = 60) {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  const pitch = ((Number(midi) % 12) + 12) % 12
  const octave = Math.floor(Number(midi) / 12) - 1
  return `${names[pitch]}${octave}`
}
function renderMidiRollPanel(motionClass = '') {
  const region = getMidiRollRegion()
  const style = bottomPanelHeightPx ? ` style="height:${bottomPanelHeightPx}px"` : ''
  if (!region) {
    return `<section class="studio-bottom-panel studio-midi-roll-editor ${motionClass}"${style}><span class="studio-bottom-panel-resize" data-bottom-panel-resize></span><header class="studio-bottom-panel-header"><strong>MIDI Roll</strong><nav><button type="button" data-detach-bottom-panel="midi-roll">Detach</button><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header><div class="studio-bottom-panel-body"><p>Select a MIDI region to edit notes.</p></div></section>`
  }
  const track = getMidiRegionTrack(region)
  const notes = region.notes || []
  const selectedNote = getSelectedMidiRollNote()
  const rows = midiRollPitchRows()
  const regionLength = Math.max(0.25, (Number(region.endBeat) || 0) - (Number(region.startBeat) || 0))
  const gridWidth = Math.max(420, regionLength * midiRollBeatWidth)
  const gridHeight = rows.length * midiRollRowHeight
  const quantize = midiRollState?.quantize || '0.25'
  const playheadBeat = xToBeat(timelineState.playheadX)
  const playheadLeft = (playheadBeat - Number(region.startBeat || 0)) * midiRollBeatWidth
  return `<section class="studio-bottom-panel studio-midi-roll-editor ${motionClass}" data-midi-roll-editor data-midi-roll-region="${esc(region.id)}" style="--midi-roll-beat-width:${midiRollBeatWidth}px;--midi-roll-row-height:${midiRollRowHeight}px;--midi-roll-grid-width:${gridWidth}px;--midi-roll-grid-height:${gridHeight}px;${bottomPanelHeightPx ? `height:${bottomPanelHeightPx}px;` : ''}">
    <span class="studio-bottom-panel-resize" data-bottom-panel-resize></span>
    <header class="studio-bottom-panel-header studio-midi-roll-header"><div><strong>MIDI Roll</strong><span>${esc(track?.name || 'Track')} · ${esc(getMidiRegionLabel(region))} · ${Number(region.startBeat || 0).toFixed(2)}-${Number(region.endBeat || 0).toFixed(2)} · ${notes.length} notes</span></div><nav><button type="button" data-detach-bottom-panel="midi-roll">Detach</button><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header>
    <div class="studio-bottom-panel-body studio-midi-roll-body">
      <section class="studio-midi-roll-main">
        <div class="studio-midi-roll-scroll">
          <div class="studio-midi-roll-keys" style="height:${gridHeight}px">${rows.map((note)=>{ const pitch=((note%12)+12)%12; const black=[1,3,6,8,10].includes(pitch); return `<span class="${black ? 'is-black' : 'is-white'} ${pitch === 0 ? 'is-root' : ''}">${pitch === 0 ? esc(formatMidiNoteName(note)) : ''}</span>` }).join('')}</div>
          <div class="studio-midi-roll-grid" data-midi-roll-grid style="width:${gridWidth}px;height:${gridHeight}px">
            ${Array.from({ length: Math.ceil(regionLength / 0.25) + 1 }, (_, index)=>`<i class="${index % 4 === 0 ? 'is-beat' : ''}" style="left:${index * (midiRollBeatWidth / 4)}px"></i>`).join('')}
            <span class="studio-midi-roll-playhead" data-midi-roll-playhead style="left:${playheadLeft}px"></span>
            <span class="studio-midi-roll-selection" data-midi-roll-selection hidden></span>
            ${notes.map((note, index)=>{
              const pitchIndex = rows.indexOf(Number(note.note) || 60)
              const left = Math.max(0, (Number(note.startBeat || region.startBeat) - Number(region.startBeat || 0)) * midiRollBeatWidth)
              const width = Math.max(10, (Number(note.durationBeats) || 0.25) * midiRollBeatWidth)
              const top = Math.max(0, (pitchIndex < 0 ? rows.indexOf(60) : pitchIndex) * midiRollRowHeight + 3)
              const selected = index === midiRollSelectedNoteIndex || midiRollSelectedNoteIndices.includes(index)
              return `<button type="button" class="studio-midi-roll-note ${selected ? 'is-selected' : ''}" data-midi-note-index="${index}" style="left:${left}px;top:${top}px;width:${width}px;--region-color:${esc(region.independentColor || region.color || track?.color || '#58d4ff')}"><span data-midi-note-handle="left"></span><strong>${esc(formatMidiNoteName(note.note))}</strong><span data-midi-note-handle="right"></span></button>`
            }).join('')}
          </div>
        </div>
      </section>
      <aside class="studio-midi-roll-tools">
        <h3>${esc(getMidiRegionLabel(region))}</h3>
        <p>${selectedNote ? `${esc(formatMidiNoteName(selectedNote.note))} at ${Number(selectedNote.startBeat || 0).toFixed(2)}` : (notes.length ? 'No notes selected. Quantize will apply to the active clip.' : 'No notes available to edit.')}</p>
        ${midiRollStatus ? `<p class="studio-midi-roll-status">${esc(midiRollStatus)}</p>` : ''}
        <label>Velocity<input data-midi-note-velocity type="range" min="1" max="127" value="${Math.round(clamp(Number(selectedNote?.velocity || 0.85), 0, 1) * 127)}" ${selectedNote ? '' : 'disabled'}><small>${Math.round(clamp(Number(selectedNote?.velocity || 0.85), 0, 1) * 127)}</small></label>
        <label>Quantize<select data-midi-roll-quantize><option value="1" ${quantize==='1'?'selected':''}>1/4</option><option value="0.5" ${quantize==='0.5'?'selected':''}>1/8</option><option value="0.25" ${quantize==='0.25'?'selected':''}>1/16</option><option value="0.125" ${quantize==='0.125'?'selected':''}>1/32</option></select></label>
        <button type="button" data-midi-quantize-note ${notes.length ? '' : 'disabled'}>${selectedNote || midiRollSelectedNoteIndices.length ? 'Quantize Selection' : 'Quantize Clip'}</button>
        <label>Note Length<input data-midi-note-length type="number" min="0.05" step="0.05" value="${Number(selectedNote?.durationBeats || 0.25).toFixed(2)}" ${selectedNote ? '' : 'disabled'}></label>
        <div class="studio-midi-roll-transpose"><button type="button" data-midi-note-transpose="-12" ${selectedNote ? '' : 'disabled'}>-12</button><button type="button" data-midi-note-transpose="-1" ${selectedNote ? '' : 'disabled'}>-1</button><button type="button" data-midi-note-transpose="1" ${selectedNote ? '' : 'disabled'}>+1</button><button type="button" data-midi-note-transpose="12" ${selectedNote ? '' : 'disabled'}>+12</button></div>
        <button type="button" data-midi-delete-note ${selectedNote ? '' : 'disabled'}>Delete Selected Note</button>
        <button type="button" disabled>Humanize</button>
        <button type="button" disabled>Legato</button>
      </aside>
    </div>
  </section>`
}
function copyMidiRegion(regionId = selectedMidiRegionId) {
  const region = midiRegions.find((item)=>item.id === regionId)
  if (!region) return
  midiRegionClipboard = {
    ...region,
    id: '',
    notes: (region.notes || []).map((note)=>({ ...note }))
  }
}
function pasteMidiRegion({ beat = clampBeat(xToBeat(timelineState.playheadX)), trackId = selectedTrackId } = {}) {
  if (!midiRegionClipboard) return
  commitHistoryMutation('paste-midi-region', () => {
    const sourceStart = Number(midiRegionClipboard.startBeat) || 0
    const sourceEnd = Math.max(sourceStart + 0.25, Number(midiRegionClipboard.endBeat) || sourceStart + 1)
    const length = sourceEnd - sourceStart
    const startBeat = clampBeat(isSnapEnabled ? snapBeat(beat) : beat)
    const targetTrack = tracks.find((track)=>track.id === trackId) || getSelectedTrack()
    const id = makeInsertId('midi-region')
    const notes = (midiRegionClipboard.notes || []).map((note)=>({ ...note, startBeat: startBeat + ((Number(note.startBeat) || sourceStart) - sourceStart) }))
    midiRegions.push({
      ...midiRegionClipboard,
      id,
      trackId: targetTrack?.id || midiRegionClipboard.trackId,
      startBeat,
      endBeat: startBeat + length,
      color: midiRegionClipboard.independentColor || targetTrack?.color || midiRegionClipboard.color,
      notes,
      name: midiRegionClipboard.name || ''
    })
    selectedMidiRegionId = id
  })
}
function deleteMidiRegion(regionId = selectedMidiRegionId) {
  if (!midiRegions.some((region)=>region.id === regionId)) return
  commitHistoryMutation('delete-midi-region', () => {
    midiRegions = midiRegions.filter((region)=>region.id !== regionId)
    activePlaybackNotes.forEach((active, key) => { if (active.regionId === regionId) stopPlaybackNote(key) })
    if (selectedMidiRegionId === regionId) selectedMidiRegionId = ''
    if (midiRollState?.regionId === regionId) {
      midiRollState = null
      midiRollSelectedNoteIndex = null
      if (activeBottomPanel === 'midi-roll') activeBottomPanel = ''
    }
  })
}
const renderTrackRenamePopover = () => renameTrackState ? `<form class="studio-track-popover studio-track-popover--rename" data-track-rename-form style="left:${Math.round(renameTrackState.x)}px;top:${Math.round(renameTrackState.y)}px"><label>Rename Track<input data-track-rename-input value="${(renameTrackState.name || '').replace(/"/g, '&quot;')}" /></label><div><button type="submit">Save</button><button type="button" data-track-rename-cancel>Cancel</button></div></form>` : ''
const renderTrackColorPopover = () => colorPickerState ? `<form class="studio-track-popover studio-track-popover--color" data-track-color-form style="left:${Math.round(colorPickerState.x)}px;top:${Math.round(colorPickerState.y)}px"><label>Track Color<input type="color" data-track-color-input value="${colorPickerState.color || '#58d4ff'}" /></label><button type="submit">Apply</button></form>` : ''

function renderTimelineRegions() {
  const persisted = midiRegions.map((region)=>renderMidiRegion(region, false)).join('')
  const liveNotes = activeRecording ? [
    ...(activeRecording.notes || []),
    ...Array.from(activeRecordingNotes.values()).map((note)=>({
      note: note.note,
      velocity: note.velocity,
      startBeat: note.startBeat,
      durationBeats: Math.max(0.05, clampBeat(xToBeat(timelineState.playheadX)) - note.startBeat)
    }))
  ] : []
  const live = activeRecording ? renderMidiRegion({ ...activeRecording, notes: liveNotes, endBeat: Math.max(activeRecording.startBeat + 0.25, clampBeat(xToBeat(timelineState.playheadX))), color: '#ff2d55' }, true) : ''
  return `${persisted}${live}`
}
function barToX(index){ return barZeroX() + (index * timelineState.pixelsPerBar) }
function preStartBarCount(){ return Math.floor((timelineState.preStartPixels || 0) / timelineState.pixelsPerBar) }
function renderTimelineRuler() { const labels=[]; const negBars=preStartBarCount(); for(let i=negBars; i>=1; i-=1){ const x=barZeroX() - i*timelineState.pixelsPerBar; if(x>=0) labels.push(`<span class="studio-ruler-bar-label" style="left:${x}px">-${i}</span>`) } labels.push(`<span class="studio-ruler-bar-label" style="left:${barZeroX()}px">0</span>`); const barCount=Math.max(1,Math.ceil(timelineState.positiveBeats/timelineState.beatsPerBar)); for(let index=1; index<=barCount; index+=1){ const x=barToX(index); if (x<=timelineEndX()) labels.push(`<span class="studio-ruler-bar-label" style="left:${x}px">${index}</span>`) } return labels.join('') }
function renderCycleRange(){ if(!cycleRange) return ''; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return `<div class="studio-cycle-range ${isCycleEnabled ? 'is-enabled' : ''}" data-cycle-range style="left:${start}px;width:${Math.max(0,end-start)}px"><span class="studio-cycle-range-handle" data-cycle-handle="start"></span><span class="studio-cycle-range-body" data-cycle-drag="move"></span><span class="studio-cycle-range-handle" data-cycle-handle="end"></span></div>` }
function renderCycleBoundaryGuides(){ if(!cycleRange) return ''; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return `<span class="studio-cycle-guide studio-cycle-guide--start ${isCycleEnabled ? 'is-enabled' : ''}" style="left:${start}px"></span><span class="studio-cycle-guide studio-cycle-guide--end ${isCycleEnabled ? 'is-enabled' : ''}" style="left:${end}px"></span>` }
function renderTimelineLines() { const lines=[]; const ppb=beatWidth(); const negBeats=preStartBarCount()*timelineState.beatsPerBar; for (let beatIndex=-negBeats; beatIndex<=timelineState.positiveBeats; beatIndex+=1){ const left=beatsFromBarZeroToX(beatIndex); if(left<0||left>timelineEndX()) continue; lines.push(`<span class="studio-grid-line ${beatIndex%timelineState.beatsPerBar===0?'studio-grid-line--bar':'studio-grid-line--beat'}" style="left:${left}px"></span>`) } return lines.join('') }
function normalizeTempoEvents() {
  const current = Number(projectState?.bpm || 140)
  const events = Array.isArray(globalTracks.tempoEvents) ? globalTracks.tempoEvents : []
  return (events.length ? events : [{ id: 'tempo-start', beat: 0, bpm: current }])
    .map((event)=>({ id: event.id || makeInsertId('tempo'), beat: Math.max(0, Number(event.beat) || 0), bpm: clamp(Number(event.bpm) || current, 20, 300) }))
    .sort((a,b)=>a.beat-b.beat)
}
function normalizeSignatureEvents(project = projectState || {}) {
  const events = Array.isArray(globalTracks.signatureEvents) ? globalTracks.signatureEvents : []
  return (events.length ? events : [{ id: 'signature-start', beat: 0, key: project.key || 'C', scale: 'major', timeSignature: '4/4' }])
    .map((event)=>({ id: event.id || makeInsertId('signature'), beat: Math.max(0, Number(event.beat) || 0), key: event.key || project.key || 'C', scale: event.scale || 'major', timeSignature: event.timeSignature || '4/4' }))
    .sort((a,b)=>a.beat-b.beat)
}
function renderTempoLane(events = normalizeTempoEvents()) {
  const rowHeight = globalTracks.viewMode === 'tempo' ? 126 : 26
  const points = events.map((event)=>({ ...event, x: beatsFromBarZeroToX(event.beat), y: clamp(rowHeight - 12 - ((event.bpm - 20) / 280) * (rowHeight - 20), 8, rowHeight - 12) }))
  const line = points.length > 1
    ? points.map((point, index)=>`${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
    : `M ${barZeroX()} ${points[0]?.y || rowHeight / 2} L ${timelineContentWidth()} ${points[0]?.y || rowHeight / 2}`
  return `<svg class="studio-global-tempo-svg" viewBox="0 0 ${timelineContentWidth()} ${rowHeight}" preserveAspectRatio="none"><path d="${line}"></path></svg>${points.map((point)=>`<button type="button" class="studio-global-tempo-node" data-global-tempo="${point.id}" style="left:${point.x}px;top:${point.y}px"><span>${Math.round(point.bpm)} BPM</span></button>`).join('')}`
}
function renderGlobalTrackLane() {
  if (!globalTracks.visible) return ''
  const project = projectState || {}
  const tempoEvents = normalizeTempoEvents()
  const signatureEvents = normalizeSignatureEvents(project)
  const rowRenderers = {
    arrangement: () => `${(globalTracks.arrangement || []).map((item)=>`<button type="button" class="studio-global-block" data-global-arrangement="${item.id}" style="left:${beatsFromBarZeroToX(item.startBeat)}px;width:${Math.max(48, (item.endBeat - item.startBeat) * beatWidth())}px;background:${item.color || ''}">${item.label || 'Section'}</button>`).join('')}${globalTrackDrag?.type==='arrangement'?`<span class="studio-global-block studio-global-block--preview" style="left:${beatsFromBarZeroToX(Math.min(globalTrackDrag.startBeat, globalTrackDrag.currentBeat))}px;width:${Math.max(16, Math.abs(globalTrackDrag.currentBeat - globalTrackDrag.startBeat) * beatWidth())}px">Section</span>`:''}`,
    markers: () => (globalTracks.markers || []).map((item)=>`<button type="button" class="studio-global-marker" data-global-marker="${item.id}" style="left:${beatsFromBarZeroToX(item.beat)}px">${item.label || 'Marker'}</button>`).join(''),
    tempo: () => renderTempoLane(tempoEvents),
    signature: () => signatureEvents.map((item)=>`<button type="button" class="studio-global-block studio-global-block--small" data-global-signature="${item.id}" style="left:${beatsFromBarZeroToX(item.beat)}px;width:150px">${item.key || 'C'} ${item.scale || 'major'} · ${item.timeSignature || '4/4'}</button>`).join(''),
    video: () => '<span class="studio-global-empty">No reference loaded</span>'
  }
  const rows = globalTrackRowsForView()
  return `<section class="studio-global-tracks studio-global-tracks--${globalTracks.viewMode || 'all'}" data-global-tracks><div class="studio-global-tracks-inner" data-global-tracks-inner style="width:${timelineContentWidth()}px">${rows.map((id)=>`<div class="studio-global-row studio-global-row--${id}" data-global-row="${id}"><div class="studio-global-row-content">${rowRenderers[id]?.() || ''}</div></div>`).join('')}<span class="studio-global-playhead"></span></div></section>`
}
function renderGlobalTrackLabels() {
  if (!globalTracks.visible) return ''
  const rows = globalTrackRowsForView()
  return `<section class="studio-global-track-labels studio-global-track-labels--${globalTracks.viewMode || 'all'}"><strong>Global Tracks</strong>${rows.map((id)=>`<button type="button" data-global-label="${id}" class="${globalTracks.viewMode===id?'is-active':''}">${GLOBAL_TRACK_ROW_LABELS[id] || id}</button>`).join('')}</section>`
}
function renderGlobalTrackPopover() {
  if (!globalTrackPopover) return ''
  if (globalTrackPopover.type === 'signature') {
    const keys = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
    return `<form class="studio-global-popover" data-global-signature-form style="left:${Math.round(globalTrackPopover.x)}px;top:${Math.round(globalTrackPopover.y)}px"><label>Key<select data-global-signature-key>${keys.map((key)=>`<option ${globalTrackPopover.key===key?'selected':''}>${key}</option>`).join('')}</select></label><label>Scale<select data-global-signature-scale><option ${globalTrackPopover.scale==='major'?'selected':''}>major</option><option ${globalTrackPopover.scale==='minor'?'selected':''}>minor</option></select></label><label>Signature<select data-global-signature-time><option ${globalTrackPopover.timeSignature==='4/4'?'selected':''}>4/4</option><option ${globalTrackPopover.timeSignature==='3/4'?'selected':''}>3/4</option><option ${globalTrackPopover.timeSignature==='6/8'?'selected':''}>6/8</option></select></label><button type="submit">Save</button></form>`
  }
  return ''
}
function getAssignedLibraryManifest(track = getSelectedTrack()) {
  if (track?.instrument?.type !== DAW_PLUGIN_TYPES.librarySampler) return null
  const instrumentId = track.instrument.params?.libraryInstrumentId
  return studioLibraryState.data?.instruments?.find((item)=>item.id === instrumentId) || null
}
function getInstrumentPlayableRange(track = getSelectedTrack()) {
  const roots = (getAssignedLibraryManifest(track)?.samples || [])
    .map((sample)=>Number(sample?.rootMidi))
    .filter(Number.isFinite)
  if (!roots.length) return { min: 0, max: 127, hasMappedRange: false, belowMidi: false }
  return {
    min: Math.min(...roots),
    max: Math.max(...roots),
    hasMappedRange: true,
    belowMidi: Math.min(...roots) < 0
  }
}
function getInstrumentOctaveBounds(track = getSelectedTrack()) {
  const range = getInstrumentPlayableRange(track)
  return {
    min: Math.floor((range.min - 48) / 12),
    max: Math.ceil((range.max - 84) / 12)
  }
}
function clampInstrumentOctaveOffset(track = getSelectedTrack()) {
  const bounds = getInstrumentOctaveBounds(track)
  instrumentOctaveOffset = clamp(instrumentOctaveOffset, Math.min(bounds.min, 0), Math.max(bounds.max, 0))
  return bounds
}
function getInstrumentKeys(track = getSelectedTrack()){
  const whites=[0,2,4,5,7,9,11]
  const labelByMidi = Object.entries(dawInstrumentKeyMap).reduce((labels, [code, midi]) => {
    const display = ({ KeyA:'A',KeyS:'S',KeyD:'D',KeyF:'F',KeyG:'G',KeyH:'H',KeyJ:'J',KeyK:'K',KeyL:'L',Semicolon:';',Quote:"'",KeyW:'W',KeyE:'E',KeyT:'T',KeyY:'Y',KeyU:'U',KeyO:'O',KeyP:'P' })[code]
    if (display) labels[midi + (instrumentOctaveOffset * 12)] = display
    return labels
  }, {})
  const keys=[]
  let whiteIndex=0
  const startMidi = 48 + (instrumentOctaveOffset * 12)
  const endMidi = 84 + (instrumentOctaveOffset * 12)
  for(let midi=startMidi;midi<=endMidi;midi+=1){
    const pitchClass=((midi%12)+12)%12
    const isWhite=whites.includes(pitchClass)
    const octave=Math.floor(midi/12)-1
    const whiteSlot = isWhite ? whiteIndex : Math.max(0, whiteIndex - 1)
    keys.push({ midi, isWhite, whiteSlot, octaveLabel:isWhite&&pitchClass===0?`C${octave}`:'', keyLabel:labelByMidi[midi] || '', keyboardCode:'' })
    if (isWhite) whiteIndex += 1
  }
  return keys
}
function getSelectedTrack(){ return tracks.find((track)=>track.id===selectedTrackId) || tracks[0] }
function renderMidiRegion(region, isRecording = false) {
  const trackIndex = Math.max(0, tracks.findIndex((track)=>track.id === region.trackId))
  const startBeat = Number(region.startBeat) || 0
  const endBeat = Math.max(startBeat + 0.15, Number(region.endBeat) || startBeat + 0.25)
  const left = beatsFromBarZeroToX(startBeat)
  const width = Math.max(18, (endBeat - startBeat) * beatWidth())
  const inset = Math.max(1, Math.round(timelineState.trackHeight * 0.01))
  const top = trackIndex * timelineState.trackHeight + inset
  const height = Math.max(28, timelineState.trackHeight - (inset * 2))
  const track = tracks[trackIndex] || getSelectedTrack()
  const color = isRecording ? '#ff2d55' : (region.color || track?.color || '#58d4ff')
  const notes = Array.isArray(region.notes) ? region.notes : []
  const visibleNotes = isRecording ? notes : notes.filter((note)=>noteIsVisibleInRegion(region, note))
  const selected = !isRecording && selectedMidiRegionId === region.id
  return `<article class="studio-midi-region ${isRecording ? 'is-recording' : ''} ${selected ? 'is-selected' : ''}" data-midi-region="${region.id || 'recording'}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;--region-color:${color};--beat-width:${beatWidth()}px;"><i class="studio-midi-region-handle studio-midi-region-handle--left" data-midi-region-handle="left"></i><i class="studio-midi-region-handle studio-midi-region-handle--right" data-midi-region-handle="right"></i><strong>${isRecording ? 'Recording MIDI' : esc(getMidiRegionLabel(region))}</strong>${visibleNotes.slice(0,24).map((note)=>{ const noteStart=Number(note.startBeat) || startBeat; const noteLeft=(noteStart - startBeat) * beatWidth(); const noteWidth=Math.max(4, (Number(note.durationBeats) || 0.05) * beatWidth()); const noteTop=clamp(82 - (((note.note || 60) - 48) / 36) * 70, 8, 82); return `<span class="studio-midi-note-preview" style="left:${noteLeft}px;width:${noteWidth}px;top:${noteTop}%"></span>` }).join('')}</article>`
}
function syncSelectedTrackVolumeControl(track){ if(!track) return; const input=app.querySelector(`[data-track-volume="${track.id}"]`); if(!input) return; input.value=String(track.volume); input.setAttribute('value', String(track.volume)) }
function getInstrumentKnobDescriptors(){
  const selected=getSelectedTrack()
  const trackVolume=Number.isFinite(Number(selected?.volume)) ? Number(selected.volume) : Math.round(instrumentVolume*100)
  const trackPan=Number.isFinite(Number(selected?.pan)) ? Number(selected.pan) : Math.round(instrumentPan*100)
  instrumentVolume=clamp(trackVolume/100,0,1)
  instrumentPan=clamp(trackPan/100,-1,1)
  return [{label:'Pan',value:clamp(trackPan,-100,100),min:-100,max:100,step:1,key:'pan'},{label:'Volume',value:instrumentVolume,min:0,max:1,step:0.01,key:'volume'}]
}
function getInstrumentPanelStatus() {
  const track = getSelectedTrack()
  if (!track) return { track:null, ok:false, message:'Select a track to play.' }
  if (!track.instrument) return { track, ok:false, message:'Choose an instrument on the selected track.' }
  if (track.instrument.enabled === false) return { track, ok:false, message:'Instrument is disabled.' }
  return { track, ok:true, message:`Playing ${track.name}` }
}
function renderInstrumentKeyboardView(){
  const status = getInstrumentPanelStatus()
  const range = getInstrumentPlayableRange(status.track)
  const keys=getInstrumentKeys(status.track);
  const white=keys.filter(k=>k.isWhite); const black=keys.filter(k=>!k.isWhite); const whiteCount=Math.max(1,white.length)
  const isPressed = (midi) => isTrackKeyboardNoteActive(status.track?.id, midi)
  const rangeLabel = range.hasMappedRange
    ? `${formatMidiNoteName(range.min)} to ${formatMidiNoteName(range.max)}${range.belowMidi ? ' · internal notes below MIDI 0 supported' : ''}`
    : 'Full MIDI range'
  return `<div class="studio-instrument-keyboard-shell"><div class="studio-keyboard-status"><strong>${esc(status.ok ? status.message : 'Instrument keyboard')}</strong><span>${esc(rangeLabel)}</span></div><div class="studio-virtual-keyboard ${status.ok ? '' : 'is-disabled'}" data-virtual-keyboard style="--white-key-count:${whiteCount};--track-color:${status.track?.color || '#58d4ff'};">${status.ok ? '' : `<div class="studio-keyboard-empty">${status.message}</div>`}<div class="studio-piano-white-keys">${white.map(k=>`<button type="button" class="studio-piano-key studio-piano-key--white ${isPressed(k.midi)?'is-pressed':''}" data-midi="${k.midi}" data-piano-midi="${k.midi}" data-key-type="white" ${status.ok?'':'disabled'}><span>${k.octaveLabel}</span><small>${k.keyLabel}</small></button>`).join('')}</div><div class="studio-piano-black-keys" aria-hidden="false">${black.map(k=>`<button type="button" class="studio-piano-key studio-piano-key--black ${isPressed(k.midi)?'is-pressed':''}" data-midi="${k.midi}" data-piano-midi="${k.midi}" style="left:${((k.whiteSlot + 1) / whiteCount) * 100}%" ${status.ok?'':'disabled'}><small>${k.keyLabel}</small></button>`).join('')}</div></div></div>`
}
function renderInstrumentChordsView(){
  return `<div class="studio-chord-keyboard" data-chord-keyboard>${chordRoots.map((root)=>`<button class="studio-chord-key" type="button" data-chord-root="${root}"><strong>${root}</strong><span class="studio-chord-key-quality">Major / Minor</span><span class="studio-chord-key-octaves" aria-hidden="true">${chordOctaves.map((octave)=>`<span>${octave}</span>`).join('')}</span></button>`).join('')}</div>`
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
function renderInstrumentPerformanceControls(){
  clampInstrumentOctaveOffset()
  const bounds = getInstrumentOctaveBounds()
  const expressionValue = typingExpressionTarget === 'pitch' ? typingPitchFine : typingModFine
  return `<div class="studio-instrument-toolbar"><div class="studio-instrument-left"><div class="studio-instrument-controls"><button type="button" data-sustain-toggle class="${isSustainEnabled?'is-active':''}">Sustain</button><button type="button" data-typing-piano-toggle class="${isTypingPianoEnabled?'is-active':''}" aria-pressed="${String(isTypingPianoEnabled)}">Typing Piano</button><div class="studio-instrument-octave"><span class="studio-instrument-octave-label">Octave</span><div class="studio-instrument-octave-controls"><button type="button" data-octave-down aria-label="Octave down" ${instrumentOctaveOffset<=Math.min(bounds.min,0)?'disabled':''}>−</button><strong class="studio-octave-readout">${instrumentOctaveOffset>0?'+':''}${instrumentOctaveOffset}</strong><button type="button" data-octave-up aria-label="Octave up" ${instrumentOctaveOffset>=Math.max(bounds.max,0)?'disabled':''}>+</button></div></div><div class="studio-typing-expression" aria-label="Musical typing expression"><span>${typingExpressionTarget === 'pitch' ? 'Pitch' : 'Mod'} fine</span><strong>${expressionValue}</strong><small>C/V pitch · B/N mod · 1-0 fine · − target</small></div></div></div><div class="studio-instrument-knob-bank">${getInstrumentKnobDescriptors().map((knob)=>`<label class="studio-instrument-knob"><span class="studio-instrument-knob-label">${knob.label}</span><button class="studio-instrument-knob-dial" type="button" data-instrument-knob-dial="${knob.key}" style="--knob-angle:${-135 + ((knob.value-knob.min)/(knob.max-knob.min))*270}deg" aria-label="${knob.label}"><input data-instrument-knob="${knob.key}" type="range" min="${knob.min}" max="${knob.max}" step="${knob.step}" value="${knob.value}"></button><span class="studio-instrument-knob-value" data-instrument-knob-value="${knob.key}">${knob.key==='pan'?`${Math.round(knob.value)}`:`${Math.round(knob.value*100)}%`}</span></label>`).join('')}</div></div><div class="studio-instrument-divider"></div>`
}
function renderInstrumentPanel(){
  return `<section class="studio-bottom-panel studio-instrument-panel"${bottomPanelHeightPx ? ` style="height:${bottomPanelHeightPx}px"` : ''}><span class="studio-bottom-panel-resize" data-bottom-panel-resize></span><header class="studio-bottom-panel-header studio-instrument-panel-header"><strong>Instrument Keyboard</strong><nav><button type="button" data-detach-bottom-panel="instrument">Detach</button><button type="button" class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header><div class="studio-bottom-panel-body">${renderInstrumentPerformanceControls()}<div class="studio-instrument-content" data-instrument-content>${renderInstrumentKeyboardView()}</div></div></section>`
}
function getActiveMidiEffectEditor() {
  const track = tracks.find((item)=>item.id === activeMidiEffectEditor?.trackId)
  const insert = track?.midiEffects?.find((item)=>item.id === activeMidiEffectEditor?.insertId)
  return track && insert ? { track, insert } : null
}
function renderMidiEffectEditorPanel(motionClass = '') {
  const editor = getActiveMidiEffectEditor()
  const style = bottomPanelHeightPx ? ` style="height:${bottomPanelHeightPx}px"` : ''
  if (!editor) return `<section class="studio-bottom-panel ${motionClass}"${style}><span class="studio-bottom-panel-resize" data-bottom-panel-resize></span><header class="studio-bottom-panel-header"><strong>MIDI Effect</strong><nav><button type="button" class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel">Close</button></nav></header><div class="studio-bottom-panel-body"><p>Select a MIDI effect to edit.</p></div></section>`
  const content = editor.insert.type === 'chord-trigger'
    ? renderInstrumentChordsView()
    : editor.insert.type === 'arpeggiator'
      ? renderInstrumentArpView()
      : `<section class="studio-instrument-subpage-placeholder"><h3>${esc(editor.insert.name)}</h3><p>This MIDI effect does not have a dedicated editor yet.</p></section>`
  return `<section class="studio-bottom-panel studio-midi-effect-panel ${motionClass}"${style}><span class="studio-bottom-panel-resize" data-bottom-panel-resize></span><header class="studio-bottom-panel-header"><div><strong>${esc(editor.insert.name)}</strong><span>${esc(editor.track.name)} · MIDI Effect</span></div><nav><button type="button" data-detach-bottom-panel="midi-effect">Detach</button><button type="button" class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header><div class="studio-bottom-panel-body"><div class="studio-instrument-content">${content}</div></div></section>`
}
function renderBottomPanel(panel,motionClass=''){
  if(panel==='instrument') return renderInstrumentPanel().replace('studio-bottom-panel studio-instrument-panel', `studio-bottom-panel studio-instrument-panel ${motionClass}`.trim())
  if(panel==='midi-roll') return renderMidiRollPanel(motionClass)
  if(panel==='midi-effect') return renderMidiEffectEditorPanel(motionClass)
  const t={loops:['Loop Browser','Loops and samples will appear here.'],mixer:['Mixer','Channel strips and routing will appear here.'],collab:['Collaboration','Project presence, comments, and invites will appear here.']}[panel]||['Panel','']
  return `<section class="studio-bottom-panel ${motionClass}"${bottomPanelHeightPx ? ` style="height:${bottomPanelHeightPx}px"` : ''}><span class="studio-bottom-panel-resize" data-bottom-panel-resize></span><header class="studio-bottom-panel-header"><strong>${t[0]}</strong><nav><button type="button" data-detach-bottom-panel="${esc(panel)}">Detach</button><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header><div class="studio-bottom-panel-body"><p>${t[1]}</p></div></section>`
}

function makeInsertId(prefix = 'insert') { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}` }
function makeTrackId() { return makeInsertId('track') }
function cloneInsertList(list = []) {
  return Array.isArray(list) ? list.map((item)=>({ ...item, id: makeInsertId(item.type || 'insert'), params: { ...(item.params || {}) } })) : []
}
function ensureTrackInsertState(track) {
  if (!track) return null
  if (!Array.isArray(track.midiEffects)) track.midiEffects = []
  if (!Array.isArray(track.audioEffects)) track.audioEffects = []
  if (track.instrument && typeof track.instrument !== 'object') track.instrument = null
  return track
}
function nextTrackColor(index = tracks.length) {
  const colors = [
    ['#ff4d5d', 'rgba(255, 77, 93, 0.26)'],
    ['#58d4ff', 'rgba(88, 212, 255, 0.24)'],
    ['#8f78ff', 'rgba(143, 120, 255, 0.24)'],
    ['#62e0aa', 'rgba(98, 224, 170, 0.22)'],
    ['#ffb45d', 'rgba(255, 180, 93, 0.22)']
  ]
  const [color, colorSoft] = colors[index % colors.length]
  return { color, colorSoft }
}
function addTrack({ sourceTrack = null } = {}) {
  const before = captureDawSnapshot()
  const id = makeTrackId()
  const colors = sourceTrack ? { color: sourceTrack.color, colorSoft: sourceTrack.colorSoft } : nextTrackColor(tracks.length)
  const base = sourceTrack ? ensureTrackInsertState(sourceTrack) : null
  const instrument = base?.instrument ? { ...base.instrument, id: makeInsertId('instrument'), pluginInstanceId: `${base.instrument.type}:${id}`, params: { ...(base.instrument.params || {}) } } : null
  const track = {
    id,
    name: base ? `${base.name} Copy` : `Instrument ${tracks.length + 1}`,
    type: base?.type || 'instrument',
    color: colors.color,
    colorSoft: colors.colorSoft,
    icon: base?.icon || 'instrument',
    muted: false,
    soloed: false,
    recordArmed: false,
    automationOpen: Boolean(base?.automationOpen),
    volume: Number.isFinite(Number(base?.volume)) ? Number(base.volume) : 72,
    pan: Number.isFinite(Number(base?.pan)) ? Number(base.pan) : 0,
    outputLevel: 0,
    midiEffects: cloneInsertList(base?.midiEffects || []),
    instrument,
    audioEffects: cloneInsertList(base?.audioEffects || [])
  }
  tracks.push(track)
  selectedTrackId = id
  activeLeftPanel = 'inspector'
  inspectorMenu = null
  trackMenuState = null
  pushHistory(sourceTrack ? 'duplicate-track' : 'add-track', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function duplicateSelectedTrack() {
  const track = ensureTrackInsertState(getSelectedTrack())
  if (!track) return
  addTrack({ sourceTrack: track })
}
function deleteSelectedTrack() {
  const index = tracks.findIndex((track)=>track.id===selectedTrackId)
  if (index < 0 || tracks.length <= 1) return
  if (!window.confirm(`Delete "${tracks[index].name}"? This removes the track from this project.`)) return
  const before = captureDawSnapshot()
  const [removed] = tracks.splice(index, 1)
  if (removed?.instrument?.pluginInstanceId) dawWindowManager.closeWindow(removed.instrument.pluginInstanceId)
  disposeTrackAudioChannel(removed.id)
  midiRegions = midiRegions.filter((region)=>region.trackId !== removed.id)
  selectedTrackId = tracks[Math.max(0, index - 1)]?.id || tracks[0]?.id || ''
  trackMenuState = null
  inspectorMenu = null
  pushHistory('delete-track', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function renameSelectedTrack(name = '') {
  const track = getSelectedTrack()
  const nextName = String(name || '').trim()
  if (!track || !nextName) return
  const before = captureDawSnapshot()
  track.name = nextName.slice(0, 80)
  renameTrackState = null
  pushHistory('rename-track', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function cycleSelectedTrackColor() {
  const track = getSelectedTrack()
  if (!track) return
  const colors = nextTrackColor((tracks.findIndex((item)=>item.id===track.id) || 0) + 1)
  track.color = colors.color
  track.colorSoft = colors.colorSoft
  scheduleEditorSave()
  renderEditor()
}
function setSelectedTrackColor(color = '', { close = true } = {}) {
  const track = getSelectedTrack()
  const normalized = /^#[0-9a-f]{6}$/i.test(String(color)) ? String(color) : ''
  if (!track || !normalized) return
  const before = close ? captureDawSnapshot() : null
  track.color = normalized
  track.colorSoft = `${normalized}42`
  if (colorPickerState) colorPickerState.color = normalized
  if (close) colorPickerState = null
  if (before) pushHistory('color-track', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function getClampedTrackMenuPosition(clientX = 0, clientY = 0) {
  const width = 210
  const height = 250
  const margin = 8
  const appRect = app?.querySelector?.('.studio-editor-page')?.getBoundingClientRect?.() || { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
  return {
    x: clamp(clientX, appRect.left + margin, Math.max(appRect.left + margin, appRect.right - width - margin)),
    y: clamp(clientY, appRect.top + margin, Math.max(appRect.top + margin, appRect.bottom - height - margin))
  }
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
  const floating = menuId === 'instrument'
  const pos = floating ? (inspectorMenuPosition || getClampedFloatingPosition(window.innerWidth * 0.5, window.innerHeight * 0.42, 260, 210)) : null
  const style = floating ? ` style="left:${Math.round(pos.x)}px;top:${Math.round(pos.y)}px"` : ''
  return `<div class="studio-inspector-menu ${floating ? 'studio-inspector-menu--floating' : ''}" data-inspector-menu="${menuId}"${style}>${items.map((item)=>`<button type="button" data-inspector-menu-choice="${action}" data-insert-type="${item.type}">${item.name}</button>`).join('')}${floating ? '<button type="button" data-inspector-menu-choice="instrument-empty" data-insert-type="">No Instrument</button>' : ''}</div>`
}
function renderInsertSlot(insert, section) {
  return `<article class="studio-insert-slot ${insert.enabled ? 'is-enabled' : 'is-disabled'}">
    <div class="studio-insert-slot-label"><strong>${esc(insert.name)}</strong><span>${insert.enabled ? 'Enabled' : 'Disabled'}</span></div>
    <div class="studio-insert-slot-actions">
      <button type="button" class="studio-insert-power ${insert.enabled ? 'is-active' : ''}" data-toggle-insert="${section}" data-insert-id="${insert.id}" aria-label="Toggle ${esc(insert.name)}">${insert.enabled ? 'On' : 'Off'}</button>
      <button type="button" data-edit-insert="${section}" data-insert-id="${insert.id}">Edit</button>
      <button type="button" data-toggle-inspector-menu="${section === 'midi' ? 'midi-effects' : 'audio-effects'}">Change</button>
      <button type="button" data-remove-insert="${section}" data-insert-id="${insert.id}">Remove</button>
    </div>
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
    return `<article class="studio-instrument-slot is-empty"><div class="studio-insert-slot-label"><strong>No instrument loaded</strong><span>Empty</span></div><div class="studio-instrument-slot-actions"><button type="button" data-toggle-inspector-menu="instrument">Choose</button></div></article>${renderInsertMenu({ menuId: 'instrument', items: instruments.map((item)=>({ type: item.id, name: item.name })), action: 'instrument' })}`
  }
  const canEdit = instrument.type !== DAW_PLUGIN_TYPES.librarySampler
  return `<article class="studio-instrument-slot ${instrument.enabled ? 'is-enabled' : 'is-disabled'}">
    <div class="studio-instrument-slot-main studio-insert-slot-label"><strong>${esc(instrument.name)}</strong><span>${instrument.enabled ? 'Enabled' : 'Disabled'} · ${esc(track.name)}</span></div>
    <div class="studio-instrument-slot-actions">
      <button type="button" class="${instrument.enabled ? 'is-active' : ''}" data-toggle-track-instrument>${instrument.enabled ? 'On' : 'Off'}</button>
      ${canEdit ? '<button type="button" data-edit-track-instrument>Edit</button>' : '<button type="button" disabled title="Library instruments are managed from the Library.">Library</button>'}
      <button type="button" data-toggle-inspector-menu="instrument">Change</button>
      <button type="button" data-remove-track-instrument>Remove</button>
    </div>
    ${renderInsertMenu({ menuId: 'instrument', items: instruments.map((item)=>({ type: item.id, name: item.name })), action: 'instrument' })}
  </article>`
}
function renderChannelStripSettings(track) {
  const ctx = audioContext
  const detailOpen = (id, defaultOpen = false) => isChannelSectionOpen(id, defaultOpen) ? 'open' : ''
  const selected = (value, expected) => String(value || '') === String(expected) ? 'selected' : ''
  return `<section class="studio-inspector-section studio-channel-strip-settings">
    <h4 class="studio-inspector-divider"><span>Channel Strip Settings</span></h4>
    <div class="studio-channel-settings-scroll">
      <details data-channel-accordion="identity" ${detailOpen('identity', true)}><summary>Track Identity</summary><label>Name<input data-channel-setting="name" value="${esc(track.name)}"></label><label>Color<input data-channel-setting="color" type="color" value="${esc(track.color || '#58d4ff')}"></label><label>Notes<textarea data-channel-setting="notes" placeholder="Track notes">${esc(track.notes || '')}</textarea></label></details>
      <details data-channel-accordion="routing" ${detailOpen('routing', true)}><summary>Routing</summary><label>MIDI Input<select data-channel-setting="midiInput"><option ${selected(track.midiInput, 'All Inputs')}>All Inputs</option><option ${selected(track.midiInput, 'Computer Keyboard')}>Computer Keyboard</option><option disabled>Web MIDI Device</option></select></label><label>MIDI Channel<select data-channel-setting="midiChannel"><option ${selected(track.midiChannel, 'All')}>All</option>${Array.from({length:16},(_,i)=>`<option ${selected(track.midiChannel, i+1)}>${i+1}</option>`).join('')}</select></label><label>Audio Output<select data-channel-setting="audioOutput"><option ${selected(track.audioOutput, 'Stereo Out')}>Stereo Out</option><option disabled>Bus 1</option><option disabled>Bus 2</option></select></label><label class="studio-channel-toggle"><input data-channel-setting="monitor" type="checkbox" ${track.monitor ? 'checked' : ''}>Monitor Input</label></details>
      <details data-channel-accordion="performance" ${detailOpen('performance')}><summary>Performance</summary><label>Transpose<input data-channel-setting="transpose" type="number" min="-48" max="48" value="${Number(track.transpose || 0)}"></label><label>Octave Shift<input data-channel-setting="octaveShift" type="number" min="-4" max="4" value="${Number(track.octaveShift || 0)}"></label><label>Velocity Offset<input data-channel-setting="velocityOffset" type="number" min="-64" max="64" value="${Number(track.velocityOffset || 0)}"></label><label>Quantize Input<select data-channel-setting="quantize"><option ${selected(track.quantize, 'Off')}>Off</option><option ${selected(track.quantize, '1/4')}>1/4</option><option ${selected(track.quantize, '1/8')}>1/8</option><option ${selected(track.quantize, '1/16')}>1/16</option><option ${selected(track.quantize, '1/32')}>1/32</option></select></label></details>
      <details data-channel-accordion="audio" ${detailOpen('audio')}><summary>Channel Audio</summary><label>Volume<input data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}"></label><label>Pan<input data-channel-setting="pan" type="range" min="-100" max="100" step="1" value="${track.pan}"></label><label>Gain Trim<input data-channel-setting="gainTrim" type="range" min="-24" max="24" step="0.5" value="${Number(track.gainTrim || 0)}"></label><label>Meter Mode<select data-channel-setting="meterMode"><option ${selected(track.meterMode, 'Peak + RMS')}>Peak + RMS</option><option ${selected(track.meterMode, 'Peak')}>Peak</option><option ${selected(track.meterMode, 'RMS')}>RMS</option></select></label></details>
      <details data-channel-accordion="latency" ${detailOpen('latency')}><summary>Latency / Browser Audio</summary><p>Engine: ${ctx ? ctx.state : 'Not started'}</p><p>Sample rate: ${ctx?.sampleRate ? `${ctx.sampleRate} Hz` : 'Not available'}</p><p>Base latency: ${ctx?.baseLatency ? `${Math.round(ctx.baseLatency * 1000)} ms` : 'Not available'}</p><p>Output latency: ${ctx?.outputLatency ? `${Math.round(ctx.outputLatency * 1000)} ms` : 'Not available'}</p><label>MIDI latency compensation<input data-channel-setting="midiLatencyMs" type="number" min="0" max="500" value="${Number(track.midiLatencyMs || 0)}"></label></details>
      <details data-channel-accordion="regions" ${detailOpen('regions')}><summary>Region Defaults</summary><label>Default Region Color<select data-channel-setting="regionColorMode"><option ${selected(track.regionColorMode, 'Track color')}>Track color</option><option ${selected(track.regionColorMode, 'Custom')}>Custom</option></select></label><label>Default Length<input data-channel-setting="defaultRegionLength" type="number" min="0.25" step="0.25" value="${Number(track.defaultRegionLength || 4)}"></label><label class="studio-channel-toggle"><input data-channel-setting="autoNameRegions" type="checkbox" ${track.autoNameRegions !== false ? 'checked' : ''}>Auto-name recorded regions</label></details>
      <details data-channel-accordion="safety" ${detailOpen('safety')}><summary>Safety</summary><button type="button" data-stop-stuck-notes>Stop Stuck Notes</button><button type="button" data-reset-track-audio>Reset Track Audio Engine</button><label class="studio-channel-toggle"><input data-disable-track-instrument type="checkbox" ${track.instrument?.enabled === false ? 'checked' : ''}>Disable instrument on track</label></details>
    </div>
  </section>`
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
    ${renderChannelStripSettings(track)}
  </section>`
}
function selectedStudioLibraryFolder() {
  const folders = studioLibraryState.data?.folders || []
  return findFolderByPath(folders, studioLibraryState.selectedPath)
}

function renderStudioLibraryFolderNode(folder, depth = 0) {
  const children = folder.children || []
  const expanded = studioLibraryState.expandedRootIds.has(folder.id)
  const selected = studioLibraryState.selectedPath === folder.path
  return `<div class="studio-daw-library-folder" style="--library-depth:${depth}">
    <button type="button" class="studio-daw-library-folder-button ${selected ? 'is-active' : ''}" data-library-folder="${esc(folder.path)}" data-library-folder-id="${esc(folder.id)}" aria-expanded="${children.length ? String(expanded) : 'false'}">
      <span data-library-folder-toggle="${esc(folder.id)}">${children.length ? (expanded ? '−' : '+') : ''}</span>
      <strong>${esc(folder.label)}</strong>
      ${folder.type === 'engine-folder' ? `<small>${esc(folder.engineType || '')}</small>` : ''}
    </button>
    ${children.length && expanded ? `<div class="studio-daw-library-folder-children">${children.map((child) => renderStudioLibraryFolderNode(child, depth + 1)).join('')}</div>` : ''}
  </div>`
}

function renderStudioLibraryTree() {
  const folders = studioLibraryState.data?.folders || []
  return folders.map((root) => renderStudioLibraryFolderNode(root)).join('')
}

function renderStudioLibraryResults() {
  const selection = selectedStudioLibraryFolder()
  if (!selection) return '<div class="studio-daw-library-empty"><strong>Select a folder</strong><p>Choose any library folder to browse its instruments.</p></div>'
  const instruments = getInstrumentsForFolder(studioLibraryState.data, selection.path).filter((instrument) => (
    instrument.enabled !== false
    && instrument.visibility === 'public'
  ))
  if (!instruments.length) {
    const comingSoon = selection.type === 'engine-folder' && selection.engineType !== 'sample-based'
    return `<div class="studio-daw-library-empty">
      <strong>${comingSoon ? 'Coming soon' : 'No instruments yet'}</strong>
      <p>${comingSoon ? `${selection.label} instruments are not available in this engine yet.` : 'This folder does not contain instruments yet.'}</p>
    </div>`
  }
  const breadcrumb = selection.path.split('/').map(esc).join(' / ')
  return `<div class="studio-daw-library-instruments">${instruments.map((instrument) => {
    const activeOnSelectedTrack = getSelectedTrack()?.instrument?.type === DAW_PLUGIN_TYPES.librarySampler
      && getSelectedTrack()?.instrument?.params?.libraryInstrumentId === instrument.id
    const selected = studioLibraryState.selectedInstrumentId === instrument.id || activeOnSelectedTrack
    const loadState = studioLibraryState.loadStatusByInstrumentId.get(instrument.id)
    const strategy = sampleStrategyDefinition(instrument.sampleStrategy)
    const playbackMode = samplePlaybackModeLabel(instrument.samplePlaybackMode)
    const statusLabel = loadState?.status === 'loading'
      ? 'Loading'
      : loadState?.status === 'loaded'
        ? 'Loaded'
        : activeOnSelectedTrack
          ? 'Assigned'
        : instrument.engineType === 'sample-based'
          ? `${instrument.samples?.length || 0} samples`
          : 'Coming soon'
    return `<button type="button" class="studio-daw-library-instrument ${selected ? 'is-selected' : ''}" data-library-instrument="${esc(instrument.id)}">
      <span class="studio-daw-library-instrument-icon">${instrument.engineType === 'sample-based' ? 'S' : instrument.engineType === 'wavetable' ? 'W' : 'V'}</span>
      <span><strong>${esc(instrument.name)}</strong><small>${esc(instrument.description || `${instrument.samples?.length || 0} mapped samples`)}</small><span class="studio-daw-library-instrument-meta">${instrument.engineType === 'sample-based' ? `<b>${esc(strategy?.label || 'Custom')}</b><b>${esc(playbackMode)}</b>` : ''}<b class="${loadState?.status === 'error' ? 'is-error' : ''}">${esc(statusLabel)}</b></span></span>
      <em>${esc(instrument.engineType === 'sample-based' ? 'Sample Based' : instrument.engineType === 'wavetable' ? 'Wavetable' : 'VST')}</em>
    </button>`
  }).join('')}</div><div class="studio-daw-library-breadcrumb">${breadcrumb}</div>`
}

function renderStudioLibrarySelection() {
  const instrument = (studioLibraryState.data?.instruments || []).find((item) => item.id === studioLibraryState.selectedInstrumentId)
  if (!instrument) return ''
  const loadState = studioLibraryState.loadStatusByInstrumentId.get(instrument.id)
  const strategy = sampleStrategyDefinition(instrument.sampleStrategy)
  const playbackMode = samplePlaybackModeLabel(instrument.samplePlaybackMode)
  const message = instrument.engineType !== 'sample-based'
    ? `${instrument.engineType === 'vst' ? 'HTML VST' : 'Wavetable'} runtime is coming soon. Its manifest can be managed without executing untrusted source.`
    : loadState?.status === 'loading'
      ? `Loading ${instrument.samples?.length || 0} mapped samples for the selected track...`
      : loadState?.status === 'error'
        ? loadState.message
        : loadState?.status === 'loaded'
          ? 'Loaded into the selected track through Library.'
          : 'Click to assign this instrument to the selected track and load its samples.'
  return `<section class="studio-daw-library-selection">
    <div><span>${esc(instrument.folderPath)}</span><strong>${esc(instrument.name)}</strong></div>
    <dl><div><dt>Engine</dt><dd>${esc(instrument.engineType)}</dd></div><div><dt>${instrument.engineType === 'sample-based' ? 'Strategy' : 'Runtime'}</dt><dd>${esc(instrument.engineType === 'sample-based' ? strategy?.label || 'Custom' : instrument.runtime || 'Coming soon')}</dd></div>${instrument.engineType === 'sample-based' ? `<div><dt>Playback</dt><dd>${esc(playbackMode)}</dd></div>` : ''}<div><dt>Version</dt><dd>v${instrument.version || 1}</dd></div></dl>
    <p>${esc(message)}</p>
  </section>`
}

function renderStudioLibraryPanel() {
  if (studioLibraryState.loading) return '<section class="studio-daw-library"><header><h3>Library</h3><p>Loading default content...</p></header><div class="studio-daw-library-loading">Reading the Studio library manifest.</div></section>'
  if (studioLibraryState.error) return `<section class="studio-daw-library"><header><h3>Library</h3><p>Default instruments</p></header><div class="studio-daw-library-empty is-error"><strong>Library unavailable</strong><p>${esc(studioLibraryState.error)}</p><button type="button" data-library-retry>Try again</button></div></section>`
  if (studioLibraryState.loaded && !studioLibraryState.data) return '<section class="studio-daw-library"><header><h3>Library</h3><p>Default instruments</p></header><div class="studio-daw-library-empty"><strong>Library content has not been initialized yet.</strong><p>An administrator can initialize it from Operations → Studio → DAW.</p></div></section>'
  return `<section class="studio-daw-library">
    <header><div><h3>${esc(studioLibraryState.data?.rootLabel || 'Library')}</h3><p>Default instruments</p></div><span>${studioLibraryState.data?.instruments?.length || 0}</span></header>
    <div class="studio-daw-library-browser">
      <nav aria-label="Studio Library folders">${renderStudioLibraryTree()}</nav>
      <div class="studio-daw-library-results">${renderStudioLibraryResults()}</div>
    </div>
    ${renderStudioLibrarySelection()}
  </section>`
}

async function loadStudioLibrary({ force = false } = {}) {
  if (studioLibraryState.loading || (studioLibraryState.loaded && !force)) return
  studioLibraryState.loading = true
  studioLibraryState.error = ''
  renderEditor()
  try {
    const data = await getDefaultLibraryContent()
    const flatFolders = flattenLibraryFolders(data?.folders || [])
    const firstRoot = data?.folders?.[0]
    const firstDestination = flatFolders.find((folder) => folder.type === 'engine-folder') || flatFolders[0]
    const assignedInstrumentId = getSelectedTrack()?.instrument?.type === DAW_PLUGIN_TYPES.librarySampler
      ? getSelectedTrack()?.instrument?.params?.libraryInstrumentId || ''
      : ''
    const assignedInstrument = data?.instruments?.find((item) => item.id === assignedInstrumentId)
    studioLibraryState = {
      ...studioLibraryState,
      data,
      loaded: true,
      selectedPath: studioLibraryState.selectedPath || assignedInstrument?.folderPath || firstDestination?.path || '',
      selectedInstrumentId: studioLibraryState.selectedInstrumentId || assignedInstrumentId,
      expandedRootIds: studioLibraryState.expandedRootIds.size
        ? studioLibraryState.expandedRootIds
        : new Set(flatFolders.filter((folder) => firstDestination?.path.startsWith(folder.path)).map((folder) => folder.id))
    }
  } catch (error) {
    console.warn('[studio-library] manifest read failed', { code: error?.code, message: error?.message })
    studioLibraryState.error = error?.message || 'Could not load the default Studio library.'
    studioLibraryState.loaded = true
  } finally {
    studioLibraryState.loading = false
    renderEditor()
  }
}

async function resolveStudioLibraryInstrument(instrumentId = '') {
  const current = studioLibraryState.data?.instruments?.find((item) => item.id === instrumentId)
  if (current) return current
  if (!studioLibraryManifestPromise) {
    studioLibraryManifestPromise = getDefaultLibraryContent().finally(() => {
      studioLibraryManifestPromise = null
    })
  }
  const data = await studioLibraryManifestPromise
  if (data) {
    studioLibraryState.data = data
    studioLibraryState.loaded = true
  }
  return data?.instruments?.find((item) => item.id === instrumentId) || null
}

async function assignStudioLibraryInstrument(instrumentId = '') {
  const instrument = await resolveStudioLibraryInstrument(instrumentId)
  if (!instrument) return
  studioLibraryState.selectedInstrumentId = instrument.id
  if (instrument.engineType !== 'sample-based') {
    studioLibraryState.loadStatusByInstrumentId.set(instrument.id, { status: 'coming-soon', message: 'Runtime coming soon.' })
    renderEditor()
    return
  }
  const track = ensureTrackInsertState(getSelectedTrack())
  if (!track) {
    studioLibraryState.loadStatusByInstrumentId.set(instrument.id, { status: 'error', message: 'Select a track before loading an instrument.' })
    renderEditor()
    return
  }
  const before = captureDawSnapshot()
  stopAllTrackInstrumentNotes()
  stopAllPlaybackNotes()
  if (track.instrument?.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId)
  track.type = 'instrument'
  track.instrument = {
    id: makeInsertId('instrument'),
    type: DAW_PLUGIN_TYPES.librarySampler,
    name: `Library · ${instrument.name}`,
    enabled: true,
    pluginInstanceId: `${DAW_PLUGIN_TYPES.librarySampler}:${track.id}`,
    params: {
      libraryInstrumentId: instrument.id,
      libraryInstrumentName: instrument.name,
      libraryInstrumentVersion: instrument.version || 1,
      volume: 0.8,
      attack: 0.006,
      release: 0.16
    }
  }
  studioLibraryState.loadStatusByInstrumentId.set(instrument.id, { status: 'loading', message: '' })
  pushHistory('assign-library-instrument', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
  try {
    const sampler = ensureTrackInstrumentInstance(track)
    sampler?.setManifest?.(instrument)
    await sampler?.preload?.()
    studioLibraryState.loadStatusByInstrumentId.set(instrument.id, { status: 'loaded', message: '' })
  } catch (error) {
    console.warn('[studio-library] sampler load failed', { instrumentId: instrument.id, message: error?.message })
    studioLibraryState.loadStatusByInstrumentId.set(instrument.id, { status: 'error', message: error?.message || 'Samples could not be loaded.' })
  }
  renderEditor()
}

function renderLeftPanel() { if (!activeLeftPanel) return ''; const views={"library":renderStudioLibraryPanel(),"inspector":renderTrackInspector(),"smart-controls":`<h3>Smart Controls</h3><p>EQ</p><p>Compressor</p><p>Sends</p><p>Track Effects</p>`,"loop-browser":`<h3>Loop Browser</h3><input placeholder="Search loops"/><p>Drums</p><p>Melody</p><p>Bass</p><p>Vocals</p><p>FX</p>`}; return `<aside class="studio-left-panel ${activeLeftPanel==='inspector'?'studio-left-panel--inspector':''} ${activeLeftPanel==='library'?'studio-left-panel--library':''}">${views[activeLeftPanel] || ''}</aside>` }
function getActiveNotePage(){ return notePages.find((page)=>page.id===activeNotePageId) || notePages[0] }
function stashActiveNoteInput(){ const input = app.querySelector('[data-notes-input]'); const active = getActiveNotePage(); if (!input || !active) return; active.body = input.value }
function renderNotesModal(){ if(!isNotesOpen) return ''; const activePage = getActiveNotePage(); return `<div class="studio-notes-modal"><div class="studio-notes-panel"><header class="studio-notes-header"><h3>Project Notes</h3></header><div class="studio-notes-body"><div class="studio-notes-pages">${notePages.map((page)=>`<button class="studio-notes-page-button ${page.id===activeNotePageId?'is-active':''}" data-notes-page="${page.id}" aria-pressed="${String(page.id===activeNotePageId)}">${page.title}</button>`).join('')}<button class="studio-notes-page-button" data-add-notes-page>Add Page</button></div><textarea class="studio-notes-textarea" data-notes-input placeholder="Write notes for this project...">${activePage?.body || ''}</textarea></div><div class="studio-notes-actions"><button class="studio-notes-button studio-notes-button--secondary" data-close-notes>Close</button><button class="studio-notes-button studio-notes-button--primary" data-save-notes>Save</button></div></div></div>` }
function renderControlsMenu(){ if(!isControlsMenuOpen) return ''; return `<div class="studio-controls-menu" data-controls-menu><label><input type="checkbox" data-musical-typing-toggle ${isTypingPianoEnabled ? 'checked' : ''}> Musical Typing</label><p>${isTypingPianoEnabled ? 'Typing keys play the selected instrument.' : 'Typing keys run DAW commands.'}</p></div>` }

function buildEditorStateForSave(){ return { version:2, timeline:{ bars: timelineState.bars, beatsPerBar: timelineState.beatsPerBar, positiveBeats: timelineState.positiveBeats, pixelsPerBar: timelineState.pixelsPerBar, preStartPixels: timelineState.preStartPixels, playheadX: timelineState.playheadX, trackHeight: timelineState.trackHeight, cycleRange: cycleRange ? { ...cycleRange } : null }, globalTracks:{ visible:!!globalTracks.visible, viewMode:globalTracks.viewMode||'all', arrangement:[...(globalTracks.arrangement||[])], markers:[...(globalTracks.markers||[])], tempoEvents:[...(globalTracks.tempoEvents||[])], signatureEvents:[...(globalTracks.signatureEvents||[])], videoRefs:[...(globalTracks.videoRefs||[])] }, regions:midiRegions.map((region)=>({ ...region, notes:(region.notes||[]).map((note)=>({ ...note })) })), notes:{ pages: notePages.map((p)=>({id:p.id,title:p.title,body:p.body||''})), activePageId: activeNotePageId }, tracks: tracks.map((track)=>{ ensureTrackInsertState(track); const {id,name,type,color,colorSoft,muted,soloed,recordArmed,automationOpen,volume,pan,outputLevel,midiEffects,instrument,audioEffects}=track; const channelSettings={notes:track.notes||'',monitor:!!track.monitor,midiInput:track.midiInput||'All Inputs',midiChannel:track.midiChannel||'All',audioOutput:track.audioOutput||'Stereo Out',transpose:Number(track.transpose||0),octaveShift:Number(track.octaveShift||0),velocityOffset:Number(track.velocityOffset||0),quantize:track.quantize||'Off',gainTrim:Number(track.gainTrim||0),meterMode:track.meterMode||'Peak + RMS',midiLatencyMs:Number(track.midiLatencyMs||0),regionColorMode:track.regionColorMode||'Track color',defaultRegionLength:Number(track.defaultRegionLength||4),autoNameRegions:track.autoNameRegions!==false}; return {id,name,type,color,colorSoft,muted,soloed,recordArmed,automationOpen,volume,pan,outputLevel,channelSettings,midiEffects:midiEffects.map((fx)=>({...fx,params:{...(fx.params||{})}})),instrument:instrument?{...instrument,params:{...(instrument.params||{})}}:null,audioEffects:audioEffects.map((fx)=>({...fx,params:{...(fx.params||{})}}))} }), toggles:{ followPlayhead, metronome:isMetronomeEnabled, countIn:isCountInEnabled, snap:isSnapEnabled, cycle:isCycleEnabled } } }
function applyLoadedEditorState(editorState) {
  if (!editorState || typeof editorState !== 'object') return
  const tl = editorState.timeline || {}
  if (Number.isFinite(tl.bars)) timelineState.bars = Math.max(2, Number(tl.bars))
  if (Number.isFinite(tl.beatsPerBar)) timelineState.beatsPerBar = Math.max(1, Number(tl.beatsPerBar))
  timelineState.positiveBeats = Number.isFinite(Number(tl.positiveBeats))
    ? Math.max(timelineState.beatsPerBar, Math.round(Number(tl.positiveBeats)))
    : timelineState.bars * timelineState.beatsPerBar
  timelineState.bars = Math.max(2, Math.ceil(timelineState.positiveBeats / timelineState.beatsPerBar))
  if (Number.isFinite(tl.pixelsPerBar)) timelineState.pixelsPerBar = Math.max(40, Number(tl.pixelsPerBar))
  if (Number.isFinite(tl.preStartPixels)) timelineState.preStartPixels = clamp(Number(tl.preStartPixels), 0, timelineState.pixelsPerBar * 10)
  if (Number.isFinite(tl.trackHeight)) timelineState.trackHeight = clamp(Number(tl.trackHeight), 44, 220)
  if (tl.cycleRange && typeof tl.cycleRange === 'object') cycleRange = { startX: Number(tl.cycleRange.startX) || 0, endX: Number(tl.cycleRange.endX) || beatWidth() }
  else ensureDefaultCycleRange()

  const gt = editorState.globalTracks || {}
  if (gt && typeof gt === 'object') {
    globalTracks = {
      ...globalTracks,
      visible: !!gt.visible,
      viewMode: GLOBAL_TRACK_VIEW_OPTIONS.some((option)=>option.value===gt.viewMode) ? gt.viewMode : (globalTracks.viewMode || 'all'),
      arrangement: Array.isArray(gt.arrangement) ? gt.arrangement : globalTracks.arrangement,
      markers: Array.isArray(gt.markers) ? gt.markers : globalTracks.markers,
      tempoEvents: Array.isArray(gt.tempoEvents) ? gt.tempoEvents : globalTracks.tempoEvents,
      signatureEvents: Array.isArray(gt.signatureEvents) ? gt.signatureEvents : globalTracks.signatureEvents,
      videoRefs: Array.isArray(gt.videoRefs) ? gt.videoRefs : globalTracks.videoRefs
    }
  }

  const ns = editorState.notes || {}
  if (Array.isArray(editorState.regions)) {
    midiRegions = editorState.regions.map((region)=>({ ...region, notes: Array.isArray(region.notes) ? region.notes.map((note)=>({ ...note })) : [] })).filter((region)=>region.id && region.trackId)
  }
  if (Array.isArray(ns.pages) && ns.pages.length) notePages = ns.pages.map((x) => ({ id: String(x.id || ''), title: String(x.title || 'Page'), body: String(x.body || '') })).filter((x) => x.id) || notePages
  if (ns.activePageId) activeNotePageId = String(ns.activePageId)

  const tg = editorState.toggles || {}
  if (typeof tg.followPlayhead === 'boolean') followPlayhead = tg.followPlayhead
  if (typeof tg.metronome === 'boolean') isMetronomeEnabled = tg.metronome
  if (typeof tg.countIn === 'boolean') isCountInEnabled = tg.countIn
  if (typeof tg.snap === 'boolean') isSnapEnabled = tg.snap
  if (typeof tg.cycle === 'boolean') isCycleEnabled = tg.cycle

  if (Array.isArray(editorState.tracks)) {
    editorState.tracks.forEach((saved) => {
      if (!saved?.id) return
      let t = tracks.find((x) => x.id === saved.id)
      if (!t) {
        t = {
          id: String(saved.id),
          name: saved.name || `Instrument ${tracks.length + 1}`,
          type: saved.type || 'instrument',
          ...nextTrackColor(tracks.length),
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
        tracks.push(t)
      }
      Object.assign(t, {
        name: saved.name ?? t.name,
        type: saved.type ?? t.type,
        color: saved.color ?? t.color,
        colorSoft: saved.colorSoft ?? t.colorSoft,
        muted: !!saved.muted,
        soloed: !!saved.soloed,
        recordArmed: !!saved.recordArmed,
        automationOpen: !!saved.automationOpen,
        volume: Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : t.volume,
        pan: Number.isFinite(Number(saved.pan))
          ? clamp(Number(editorState.version || 1) < 2 ? Number(saved.pan) * 100 : Number(saved.pan), -100, 100)
          : t.pan,
        outputLevel: Number.isFinite(Number(saved.outputLevel)) ? Number(saved.outputLevel) : t.outputLevel,
        midiEffects: Array.isArray(saved.midiEffects) ? saved.midiEffects.map((fx) => ({ ...fx, params: { ...(fx.params || {}) } })) : [],
        instrument: saved.instrument && typeof saved.instrument === 'object' ? { ...saved.instrument, params: { ...(saved.instrument.params || {}) } } : null,
        audioEffects: Array.isArray(saved.audioEffects) ? saved.audioEffects.map((fx) => ({ ...fx, params: { ...(fx.params || {}) } })) : []
      })
      if (saved.channelSettings && typeof saved.channelSettings === 'object') Object.assign(t, saved.channelSettings)
      ensureTrackInsertState(t)
    })
    if (!tracks.some((track) => track.id === selectedTrackId)) selectedTrackId = tracks[0]?.id || selectedTrackId
  }
  timelineState.playheadX = Number.isFinite(Number(tl.playheadX)) ? Number(tl.playheadX) : timelineState.playheadX
}
function scheduleEditorSave(){ if(!isEditorLoaded||!projectState?.id) return; saveStatus='Saving…'; if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(async()=>{ try{ await saveStudioProjectEditorState(projectState.id, buildEditorStateForSave()); saveStatus='Saved' }catch(err){ console.error('[studioProject] save editorState failed',err); saveStatus='Save failed' } renderEditor() },800) }

function isTextEntryTarget(target){ return target?.matches?.('input, textarea, select, [contenteditable="true"]') || !!target?.closest?.('input, textarea, select, [contenteditable="true"], .studio-notes-modal, .studio-inspector-menu, .daw-plugin-window, .daw-plugin-host-page') }
async function getStudioAudioEngine() { if (!studioAudioEngine) { studioAudioEngine = new StudioAudioEngine(); await studioAudioEngine.init() } return studioAudioEngine }
function getAudioContext(){ if(!audioContext){ audioContext = new (window.AudioContext || window.webkitAudioContext)() } if(audioContext.state==='suspended') audioContext.resume().catch((err)=>console.warn('[studioProject] metronome context resume failed', err)); return audioContext }
function prewarmDawAudio() {
  try { getAudioContext() } catch (err) { console.warn('[studioProject] audio context prewarm failed', err) }
  if (!audioEnginePrewarmPromise) {
    audioEnginePrewarmPromise = getStudioAudioEngine()
      .then((engine)=>engine.resume().then(()=>engine))
      .catch((err)=>{ audioEnginePrewarmPromise = null; console.warn('[studioProject] audio engine prewarm failed', err); throw err })
  }
  return audioEnginePrewarmPromise
}
function getTrackAudioChannel(trackId = selectedTrackId) {
  const id = trackId || selectedTrackId || 'master'
  const existing = trackAudioChannels.get(id)
  if (existing) return existing
  const ctx = getAudioContext()
  const input = ctx.createGain()
  const panner = ctx.createStereoPanner()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.72
  const track = tracks.find((item)=>item.id === id)
  input.gain.value = clamp((Number(track?.volume) || 0) / 100, 0, 1)
  panner.pan.value = clamp((Number(track?.pan) || 0) / 100, -1, 1)
  input.connect(panner)
  panner.connect(analyser)
  analyser.connect(ctx.destination)
  const channel = { input, panner, analyser, data: new Float32Array(analyser.fftSize), level: 0, peak: 0 }
  trackAudioChannels.set(id, channel)
  return channel
}
function disposeTrackAudioChannel(trackId = '') {
  const channel = trackAudioChannels.get(trackId)
  if (!channel) return
  try { channel.input.disconnect() } catch {}
  try { channel.panner.disconnect() } catch {}
  try { channel.analyser.disconnect() } catch {}
  trackAudioChannels.delete(trackId)
}
function playMetronomeClick(isDownbeat){ const ctx=getAudioContext(); const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.type='sine'; osc.frequency.value=isDownbeat?1200:760; gain.gain.setValueAtTime(0.0001,ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.16,ctx.currentTime+0.004); gain.gain.exponentialRampToValueAtTime(0.0001,ctx.currentTime+0.055); osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+0.065) }
function maybeTickMetronome(){ if(!isPlaying||!isMetronomeEnabled) return; const ppb=timelineState.pixelsPerBar/timelineState.beatsPerBar; const beatIndex=Math.floor(timelineState.playheadX/ppb); if(beatIndex!==lastMetronomeBeat){ lastMetronomeBeat=beatIndex; playMetronomeClick(beatIndex%timelineState.beatsPerBar===0) } }
function secondsFromPlayhead(){ const bpm=Number(projectState?.bpm||140); const beatsFromZero=xToBeatsFromBarZero(timelineState.playheadX); return beatsFromZero*(60/bpm) }
function formatTimeFromPlayhead(){ const raw=secondsFromPlayhead(); const total=Math.abs(raw)<0.0005?0:raw; const isNegative=total<0; const absTotal=Math.abs(total); const m=Math.floor(absTotal/60); const s=Math.floor(absTotal%60); const ms=Math.floor((absTotal%1)*1000); const sub=Math.floor(((absTotal*1000)%1)*100); return `${isNegative?'-':''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}.${String(sub).padStart(2,'0')}` }
function formatBarsFromPlayhead(){ const beatsFromZero=xToBeatsFromBarZero(timelineState.playheadX); const bar=Math.floor(beatsFromZero/timelineState.beatsPerBar); const beatWithinBar=beatsFromZero-(bar*timelineState.beatsPerBar); const beat=Math.floor(beatWithinBar)+1; const bf=beatWithinBar%1; const div=Math.floor(bf*4)+1; const tick=Math.floor((bf*4%1)*240)+1; const barLabel=bar<0?`-${String(Math.abs(bar)).padStart(3,'0')}`:String(bar).padStart(3,'0'); return `${barLabel} ${String(beat).padStart(2,'0')} ${div} ${String(tick).padStart(3,'0')}` }
function updateTransportDisplay(){ app.querySelector('[data-display-time]')?.replaceChildren(document.createTextNode(formatTimeFromPlayhead())); app.querySelector('[data-display-bars]')?.replaceChildren(document.createTextNode(formatBarsFromPlayhead())) }
function updateEditorTitleStatus(){ app.querySelector('[data-editor-status]')?.replaceChildren(document.createTextNode(isCountInRunning ? `Count-in: ${countInBeatsRemaining}` : (recordingStatus || 'Project loaded'))) }
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
function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]))
}
function deepClone(value) {
  try { return structuredClone(value) } catch { return JSON.parse(JSON.stringify(value)) }
}
function cloneMidiRegionsForHistory() {
  return midiRegions.map((region)=>({ ...region, notes: (region.notes || []).map((note)=>({ ...note })) }))
}
function cloneTracksForHistory() {
  return tracks.map((track)=>deepClone(ensureTrackInsertState(track)))
}
function captureDawSnapshot() {
  return {
    midiRegions: cloneMidiRegionsForHistory(),
    tracks: cloneTracksForHistory(),
    selectedTrackId,
    selectedMidiRegionId,
    midiRollState: midiRollState ? { ...midiRollState } : null,
    midiRollSelectedNoteIndex,
    midiRollSelectedNoteIndices: [...midiRollSelectedNoteIndices]
  }
}
function restoreDawSnapshot(snapshot) {
  if (!snapshot) return
  stopAllTrackInstrumentNotes()
  stopAllPlaybackNotes()
  midiRegions = (snapshot.midiRegions || []).map((region)=>({ ...region, notes: (region.notes || []).map((note)=>({ ...note })) }))
  tracks.splice(0, tracks.length, ...(snapshot.tracks || []).map((track)=>ensureTrackInsertState(deepClone(track))))
  selectedTrackId = snapshot.selectedTrackId || tracks[0]?.id || ''
  selectedMidiRegionId = snapshot.selectedMidiRegionId || ''
  midiRollState = snapshot.midiRollState ? { ...snapshot.midiRollState } : null
  midiRollSelectedNoteIndex = Number.isInteger(snapshot.midiRollSelectedNoteIndex) ? snapshot.midiRollSelectedNoteIndex : null
  midiRollSelectedNoteIndices = Array.isArray(snapshot.midiRollSelectedNoteIndices) ? [...snapshot.midiRollSelectedNoteIndices] : []
  midiRegionMenuState = null
  regionColorPickerState = null
  regionRenameState = null
  scheduleEditorSave()
  renderEditor()
}
function snapshotsMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}
function pushHistory(type, before, after) {
  if (!before || !after || snapshotsMatch(before, after)) return
  undoStack.push({ type, before, after, timestamp: Date.now() })
  if (undoStack.length > HISTORY_LIMIT) undoStack.shift()
  redoStack.length = 0
}
function commitHistoryMutation(type, mutator, { render = true, save = true } = {}) {
  const before = captureDawSnapshot()
  mutator?.()
  const after = captureDawSnapshot()
  pushHistory(type, before, after)
  if (save) scheduleEditorSave()
  if (render) renderEditor()
}
function undoDawEdit() {
  const entry = undoStack.pop()
  if (!entry) return
  redoStack.push(entry)
  restoreDawSnapshot(entry.before)
}
function redoDawEdit() {
  const entry = redoStack.pop()
  if (!entry) return
  undoStack.push(entry)
  restoreDawSnapshot(entry.after)
}
function getMidiRegionTrack(region) {
  return tracks.find((track)=>track.id === region?.trackId) || getSelectedTrack()
}
function getMidiRegionLabel(region) {
  const name = String(region?.name || '').trim()
  return name || getMidiRegionTrack(region)?.name || 'MIDI Region'
}
function getMidiRollRegion() {
  return midiRegions.find((item)=>item.id === midiRollState?.regionId) || midiRegions.find((item)=>item.id === selectedMidiRegionId)
}
function getSelectedMidiRollNote() {
  const region = getMidiRollRegion()
  return Number.isInteger(midiRollSelectedNoteIndex) ? region?.notes?.[midiRollSelectedNoteIndex] || null : null
}
function getTimelineMetrics() {
  const beatsPerBar = Math.max(1, Number(timelineState.beatsPerBar) || 4)
  const pixelsPerBar = Math.max(1, Number(timelineState.pixelsPerBar) || 120)
  const pixelsPerBeat = pixelsPerBar / beatsPerBar
  const zeroX = Number(timelineState.preStartPixels) || 0
  const maxBeat = Math.max(beatsPerBar, Number(timelineState.positiveBeats) || beatsPerBar)
  return { beatsPerBar, pixelsPerBar, pixelsPerBeat, zeroX, maxBeat, minBeat: 0 }
}
function beatWidth() { return getTimelineMetrics().pixelsPerBeat }
function timelineStartX() { return 0 }
function barZeroX() { return getTimelineMetrics().zeroX }
function barOneX() { return barZeroX() }
function timelineEndX() { const metrics = getTimelineMetrics(); return metrics.zeroX + metrics.maxBeat * metrics.pixelsPerBeat }
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
function beatToX(beat = 0) { const metrics = getTimelineMetrics(); return metrics.zeroX + Number(beat || 0) * metrics.pixelsPerBeat }
function xToBeat(x = 0) { const metrics = getTimelineMetrics(); return (Number(x || 0) - metrics.zeroX) / metrics.pixelsPerBeat }
function snapBeat(beat = 0, snapValue = 1) { const value = Number(snapValue) || 1; return Math.round(Number(beat || 0) / value) * value }
function clampBeat(beat = 0) { const metrics = getTimelineMetrics(); return clamp(Number(beat) || 0, metrics.minBeat, metrics.maxBeat) }
function pointerEventToTimelineX(event) {
  const gridEl = app.querySelector('[data-arrangement-grid]')
  const rect = gridEl?.getBoundingClientRect?.()
  if (!rect) return 0
  return event.clientX - rect.left + (gridEl.scrollLeft || 0)
}
function pointerEventToTimelineBeat(event, { snapped = isSnapEnabled } = {}) {
  const beat = clampBeat(xToBeat(pointerEventToTimelineX(event)))
  return snapped ? clampBeat(snapBeat(beat)) : beat
}
function getTrackLaneFromY(clientY = 0) {
  const gridEl = app.querySelector('[data-arrangement-grid]')
  const rect = gridEl?.getBoundingClientRect?.()
  if (!rect) return 0
  return clamp(Math.floor((clientY - rect.top + (gridEl.scrollTop || 0)) / Math.max(1, timelineState.trackHeight)), 0, Math.max(0, tracks.length - 1))
}
function regionPixelsToBeats(pixels = 0) { return Number(pixels || 0) / beatWidth() }
function xToBeatsFromBarZero(x) { return xToBeat(x) }
function beatsFromBarZeroToX(beats) { return beatToX(beats) }
function xToBeatsFromBarOne(x) { return xToBeatsFromBarZero(x) }
function beatsFromBarOneToX(beats) { return beatsFromBarZeroToX(beats) }
function ensureDefaultCycleRange(){ if(cycleRange) return; const start = barZeroX(); cycleRange = { startX:start, endX:start + timelineState.pixelsPerBar } }
function clearBottomPanelMotionTimer(){ if(bottomPanelMotionTimer){ clearTimeout(bottomPanelMotionTimer); bottomPanelMotionTimer=0 } }
function openBottomPanel(panelId){
  clearBottomPanelMotionTimer()
  if(activeBottomPanel===panelId){ closeBottomPanel(); return }
  if(activeBottomPanel==='instrument'&&panelId!=='instrument') { stopAllInstrumentNotes(); stopAllTrackInstrumentNotes() }
  if(panelId !== 'midi-effect') activeMidiEffectEditor = null
  activeBottomPanel=panelId
  closingBottomPanel=''
  bottomPanelMotion='entering'
  renderEditor()
  if (panelId === 'instrument' && !studioLibraryState.loaded && !studioLibraryState.loading) loadStudioLibrary()
  bottomPanelMotionTimer=window.setTimeout(()=>{ bottomPanelMotion=''; renderEditor() },190)
}
function closeBottomPanel(){
  if(!activeBottomPanel) return
  clearBottomPanelMotionTimer()
  if(activeBottomPanel==='instrument') { stopAllInstrumentNotes(); stopAllTrackInstrumentNotes() }
  closingBottomPanel=activeBottomPanel
  activeBottomPanel=''
  bottomPanelMotion='exiting'
  renderEditor()
  bottomPanelMotionTimer=window.setTimeout(()=>{ closingBottomPanel=''; bottomPanelMotion=''; activeMidiEffectEditor=null; renderEditor() },170)
}
function detachBottomPanel(panelId = activeBottomPanel) {
  const panel = panelId || activeBottomPanel
  if (!panel) return
  const title = panel === 'midi-roll' ? 'MIDI Roll' : panel === 'instrument' ? 'Instrument' : panel.charAt(0).toUpperCase() + panel.slice(1)
  const popup = window.open('', `melogic-${panel}-panel`, 'width=980,height=680,resizable=yes,scrollbars=yes')
  if (!popup) return
  const body = app.querySelector('.studio-bottom-panel')?.outerHTML || `<section><h1>${esc(title)}</h1><p>No panel content available.</p></section>`
  popup.document.open()
  popup.document.write(`<!doctype html><html><head><title>${esc(title)} | Melogic DAW</title><style>body{margin:0;background:#0b111d;color:#eef4ff;font-family:Inter,system-ui,sans-serif}.studio-bottom-panel{position:static!important;inset:auto!important;width:100vw!important;height:100vh!important;max-height:none!important;border:0!important}.studio-bottom-panel-resize,.studio-bottom-panel-close,[data-detach-bottom-panel]{display:none!important}</style><link rel="stylesheet" href="/src/styles/base.css"><link rel="stylesheet" href="/src/styles/studio.css"></head><body>${body}<script>document.querySelectorAll('button,input,select,textarea').forEach((el)=>{ el.disabled=true })</script></body></html>`)
  popup.document.close()
}
function snapBeatToGrid(beat){ return Math.round(beat) }
function xToSnappedBeat(x){ const beat=xToBeatsFromBarZero(x); return isSnapEnabled ? snapBeatToGrid(beat) : beat }
function snapXToBeat(x) { return isSnapEnabled ? beatsFromBarZeroToX(snapBeatToGrid(xToBeatsFromBarZero(x))) : x }
function maxTimelineX() { return timelineEndX() }
function updateMidiRollPlayheadDom() {
  const marker = app.querySelector('[data-midi-roll-playhead]')
  const region = marker ? getMidiRollRegion() : null
  if (!marker || !region) return
  const left = (xToBeat(timelineState.playheadX) - Number(region.startBeat || 0)) * midiRollBeatWidth
  marker.style.left = `${left}px`
}
function captureMidiRollViewport() {
  const scroll = app.querySelector('.studio-midi-roll-scroll')
  const region = getMidiRollRegion()
  if (!scroll || !region) return
  midiRollViewport = {
    regionId: region.id,
    scrollLeft: scroll.scrollLeft || 0,
    scrollTop: scroll.scrollTop || 0
  }
}
function restoreMidiRollViewport() {
  const scroll = app.querySelector('.studio-midi-roll-scroll')
  const region = getMidiRollRegion()
  if (!scroll || !region || midiRollViewport.regionId !== region.id) return
  scroll.scrollLeft = midiRollViewport.scrollLeft || 0
  scroll.scrollTop = midiRollViewport.scrollTop || 0
}

function studioResonaContext() {
  const track = getSelectedTrack()
  const region = midiRegions.find((item) => item.id === selectedMidiRegionId) || null
  return {
    contextSource: 'studio_daw',
    featureArea: 'Studio DAW',
    dawContext: {
      projectTitle: String(projectState?.title || 'Untitled Studio Project').slice(0, 140),
      bpm: Number(projectState?.bpm || 140),
      key: String(projectState?.key || '').slice(0, 32),
      selectedTrack: track ? {
        id: String(track.id || '').slice(0, 80),
        name: String(track.name || '').slice(0, 120),
        type: String(track.type || '').slice(0, 60),
        muted: track.muted === true,
        soloed: track.soloed === true,
        recordArmed: track.recordArmed === true,
        volume: Number(track.volume || 0),
        pan: Number(track.pan || 0)
      } : null,
      selectedMidiRegion: region ? {
        id: String(region.id || '').slice(0, 80),
        trackId: String(region.trackId || '').slice(0, 80),
        name: String(region.name || '').slice(0, 120),
        startBeat: Number(region.startBeat || 0),
        durationBeats: Number(region.durationBeats || 0)
      } : null,
      trackCount: tracks.length,
      openPanel: activeBottomPanel || activeLeftPanel || 'arrangement',
      transport: {
        playing: isPlaying === true,
        recording: Boolean(activeRecording),
        playhead: formatBarsFromPlayhead()
      }
    }
  }
}

function renderStudioResonaPanel() {
  return '<aside class="studio-resona-side-panel" data-studio-resona-panel><div data-resona-embedded="studio_daw"></div></aside>'
}

function mountStudioResonaPanel() {
  const root = app.querySelector('[data-resona-embedded="studio_daw"]')
  if (!root) return
  mountResonaChatSurface(root, {
    variant: 'embedded',
    contextType: 'studio_daw',
    contextId: projectState?.id || projectIdFromPath() || '',
    contextLabel: projectState?.title || 'Studio DAW',
    contextSource: 'studio_daw',
    title: 'Studio DAW',
    roundedParent: false,
    getContext: studioResonaContext
  })
}

function applyStudioGuideTargets() {
  const targets = [
    ['.studio-editor-title', 'studio-project-title', 'Studio project title', 'daw-project-title'],
    ['.studio-editor-transport', 'studio-transport', 'Studio transport controls', 'daw-transport'],
    ['.studio-logic-section--tempo', 'studio-tempo-control', 'Studio tempo display', 'daw-tempo'],
    ['.studio-logic-section--key', 'studio-key-control', 'Studio key display', 'daw-key'],
    ['.studio-track-panel', 'studio-track-panel', 'Studio track list', 'daw-track-list'],
    ['.studio-arrangement', 'studio-arrangement', 'Studio arrangement timeline', 'daw-arrangement'],
    ['.studio-resona-side-panel', 'studio-resona-panel', 'Studio Resona panel', 'daw-resona-panel'],
    ['.studio-right-rail [data-bottom-panel="mixer"]', 'studio-right-rail-mixer', 'Studio mixer tab', 'daw-panel-tab'],
    ['.studio-right-rail [data-bottom-panel="instrument"]', 'studio-right-rail-instrument', 'Studio instrument tab', 'daw-panel-tab'],
    ['.studio-right-rail [data-bottom-panel="resona"]', 'studio-right-rail-resona', 'Studio Resona tab', 'daw-resona-tab'],
    ['[data-resona-surface-dock]', 'studio-resona-open-dock', 'Open Studio Resona dock', 'daw-resona-action'],
    ['[data-site-guidance-start][data-site-guidance-context-type="studio_daw"]', 'studio-resona-enable-guidance', 'Enable Studio DAW guidance', 'daw-resona-action']
  ]
  targets.forEach(([selector, id, label, role]) => {
    const element = app.querySelector(selector)
    if (!element) return
    element.setAttribute('data-guide-id', id)
    element.setAttribute('data-guide-label', label)
    element.setAttribute('data-guide-role', role)
  })
}
function setPlayhead(x) { timelineState.playheadX = clamp(x, timelineStartX(), maxTimelineX()); if (studioAudioEngine) studioAudioEngine.setPositionBeats(xToBeatsFromBarZero(timelineState.playheadX)); app.querySelector('[data-arrangement]')?.style.setProperty('--playhead-x', `${timelineState.playheadX}px`); updateTransportDisplay(); updateMidiRollPlayheadDom() }
function pixelsPerSecond() { const bpm = Number(projectState?.bpm || 140); const bps = bpm / 60; const ppb = timelineState.pixelsPerBar / timelineState.beatsPerBar; return bps * ppb }
function updateTransportPlaybackUI() { const btn = app.querySelector('[data-transport-play]'); if (!btn) return; btn.classList.toggle('is-active', isPlaying); btn.classList.toggle('is-disabled', !!(activeRecording || isCountInRunning)); btn.toggleAttribute('disabled', !!(activeRecording || isCountInRunning)); btn.setAttribute('aria-pressed', String(isPlaying)); btn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); btn.innerHTML = isPlaying ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 5v14M16 5v14"/></svg>' : toolIcon('play') }
function tickPlayback(now) { if (!isPlaying) return; const delta=(now-lastPlayTimestamp)/1000; lastPlayTimestamp=now; let nextX = timelineState.playheadX + pixelsPerSecond()*delta; const cycle = isCycleEnabled && !isCountInRunning ? getNormalizedCycleRange() : null; if (cycle) { if (nextX >= cycle.end) { stopAllPlaybackNotes(); nextX = cycle.start + ((nextX - cycle.end) % (cycle.end-cycle.start)) } } if (isCountInRunning && countInTargetX != null && nextX >= countInTargetX) { nextX = countInTargetX } setPlayhead(nextX); if (isCountInRunning && countInTargetX != null) { const nextRemaining = clamp(Math.ceil((countInTargetX - timelineState.playheadX) / Math.max(1, beatWidth())), 0, 4); if (nextRemaining !== countInBeatsRemaining) { countInBeatsRemaining = nextRemaining; updateEditorTitleStatus() } if (timelineState.playheadX >= countInTargetX - 0.5) { const track = tracks.find((item)=>item.id === countInTargetTrackId) || getRecordingTrack(); isCountInRunning = false; countInBeatsRemaining = 0; countInTargetX = null; countInTargetTrackId = ''; beginMidiRecording(track, { startBeat: clampBeat(xToBeat(timelineState.playheadX)) }); playRaf = requestAnimationFrame(tickPlayback); return } } const currentBeat = clampBeat(xToBeat(timelineState.playheadX)); updateMidiRegionPlayback(currentBeat); lastPlaybackBeat = currentBeat; if(activeRecording) refreshMidiRegionDom(); followPlayheadIfNeeded(); maybeTickMetronome(); if (timelineState.playheadX >= maxTimelineX()) return pausePlayback(); playRaf = requestAnimationFrame(tickPlayback) }
function startPlayback() { if (isPlaying) return; const cycle = isCycleEnabled && !isCountInRunning ? getNormalizedCycleRange() : null; if (cycle && (timelineState.playheadX < cycle.start || timelineState.playheadX >= cycle.end)) setPlayhead(cycle.start); prewarmDawAudio().then((engine) => { engine.setBpm(Number(projectState?.bpm || 140)); engine.setPositionBeats(xToBeatsFromBarZero(timelineState.playheadX)); engine.startTransport({ bpm: Number(projectState?.bpm || 140), positionBeats: xToBeatsFromBarZero(timelineState.playheadX) }) }).catch((err)=>console.warn('[studioProject] audio engine start failed', err)); isPlaying = true; lastPlaybackBeat = clampBeat(xToBeat(timelineState.playheadX)); lastPlayTimestamp = performance.now(); startTrackMeterLoop(); playRaf = requestAnimationFrame(tickPlayback); updateTransportPlaybackUI() }
function pausePlayback() { isPlaying = false; stopAllPlaybackNotes(); try { studioAudioEngine?.pauseTransport() } catch (err) { console.warn('[studioProject] audio engine pause failed', err) } if (playRaf) cancelAnimationFrame(playRaf); playRaf = 0; updateTransportPlaybackUI() }
function togglePlayback(){ isPlaying ? pausePlayback() : startPlayback() }
function stopPlayback() { pausePlayback(); try { studioAudioEngine?.stopTransport() } catch (err) { console.warn('[studioProject] audio engine stop failed', err) } lastMetronomeBeat = -1; if (countInTimer) clearInterval(countInTimer); countInTimer = 0; isCountInRunning = false; countInBeatsRemaining = 0; countInTargetX = null; countInTargetTrackId = '' }
function getNormalizedCycleRange(){ if(!cycleRange) return null; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return end-start>=cycleMinWidth()?{start,end}:null }
function hasValidCycleRange(){ return !!getNormalizedCycleRange() }
function isCycleStripPointerEvent(event, ruler){ const rect = ruler?.getBoundingClientRect?.(); if(!rect) return false; const localY = event.clientY - rect.top; return localY >= 0 && localY <= 22 }
function handleSpaceTransport(event){ if (event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return; event.preventDefault(); if (activeRecording || isCountInRunning) { stopRecordingAndKeep(); return } const cycle = isCycleEnabled ? getNormalizedCycleRange() : null; if (!isPlaying) { spacePlaybackStartX = cycle ? cycle.start : timelineState.playheadX; if (cycle) setPlayhead(cycle.start); startPlayback(); return } pausePlayback(); setPlayhead(cycle ? cycle.start : (spacePlaybackStartX ?? timelineState.playheadX)) }

function getMusicalTypingTrack() {
  if (activeRecording?.trackId) return tracks.find((track)=>track.id === activeRecording.trackId) || getRecordingTrack()
  return getSelectedTrack()
}
function applyTypingExpressionState() {
  const track = getMusicalTypingTrack()
  if (!track?.instrument?.pluginInstanceId) return
  dawInstrumentRegistry.setParam(track.instrument.pluginInstanceId, 'pitchBend', typingPitchTrigger)
  dawInstrumentRegistry.setParam(track.instrument.pluginInstanceId, 'modulation', typingModTrigger)
  dawInstrumentRegistry.setParam(track.instrument.pluginInstanceId, 'pitchFine', typingPitchFine)
  dawInstrumentRegistry.setParam(track.instrument.pluginInstanceId, 'modFine', typingModFine)
}
function handleMusicalTypingKeydown(event) {
  if (!isTypingPianoEnabled || event.altKey || event.ctrlKey || event.metaKey || isTextEntryTarget(event.target)) return false
  const track = getMusicalTypingTrack()
  if (!track?.instrument || track.instrument.enabled === false) return false
  if (event.code === 'KeyZ') {
    event.preventDefault()
    const bounds = getInstrumentOctaveBounds(track)
    instrumentOctaveOffset = Math.max(Math.min(bounds.min, 0), instrumentOctaveOffset - 1)
    stopAllTrackInstrumentNotes()
    renderEditor()
    return true
  }
  if (event.code === 'KeyX') {
    event.preventDefault()
    const bounds = getInstrumentOctaveBounds(track)
    instrumentOctaveOffset = Math.min(Math.max(bounds.max, 0), instrumentOctaveOffset + 1)
    stopAllTrackInstrumentNotes()
    renderEditor()
    return true
  }
  if (event.code === 'Minus') {
    event.preventDefault()
    if (!event.repeat) {
      typingExpressionTarget = typingExpressionTarget === 'pitch' ? 'mod' : 'pitch'
      renderEditor()
    }
    return true
  }
  if (/^Digit[0-9]$/.test(event.code)) {
    event.preventDefault()
    if (!event.repeat) {
      const value = event.code === 'Digit0' ? 10 : Number(event.code.slice(-1))
      if (typingExpressionTarget === 'pitch') typingPitchFine = value
      else typingModFine = value
      applyTypingExpressionState()
      renderEditor()
    }
    return true
  }
  if (['KeyC', 'KeyV', 'KeyB', 'KeyN'].includes(event.code)) {
    event.preventDefault()
    if (!event.repeat) {
      if (event.code === 'KeyC') typingPitchTrigger = -1
      if (event.code === 'KeyV') typingPitchTrigger = 1
      if (event.code === 'KeyB') typingModTrigger = -1
      if (event.code === 'KeyN') typingModTrigger = 1
      applyTypingExpressionState()
    }
    return true
  }
  if (dawInstrumentKeyMap[event.code] == null) return false
  event.preventDefault()
  if (event.repeat || pressedDawMidiKeys.has(event.code)) return true
  const note = dawInstrumentKeyMap[event.code] + (instrumentOctaveOffset * 12)
  pressedDawMidiKeys.set(event.code, { trackId: track.id, note })
  playTrackMidiNote(track, note, 0.85)
  return true
}


function keyboardNoteSourceKey(trackId, midi) { return `${trackId}:${Number(midi)}` }
function isTrackKeyboardNoteActive(trackId, midi) {
  return !!activeKeyboardNoteSources.get(keyboardNoteSourceKey(trackId, midi))?.size
}
function refreshTrackKeyboardNoteDom(trackId, midi) {
  if (trackId !== selectedTrackId) return
  app.querySelectorAll(`[data-piano-midi="${Number(midi)}"]`).forEach((el)=>el.classList.toggle('is-pressed', isTrackKeyboardNoteActive(trackId, midi)))
}
function setTrackKeyboardNoteActive(trackId, midi, source, active) {
  if (!trackId || !Number.isFinite(Number(midi)) || !source) return
  const key = keyboardNoteSourceKey(trackId, midi)
  const sources = activeKeyboardNoteSources.get(key) || new Set()
  if (active) sources.add(source)
  else sources.delete(source)
  if (sources.size) activeKeyboardNoteSources.set(key, sources)
  else activeKeyboardNoteSources.delete(key)
  refreshTrackKeyboardNoteDom(trackId, midi)
}
function clearTrackKeyboardNotes(trackId = '') {
  Array.from(activeKeyboardNoteSources.keys()).forEach((key) => {
    if (!trackId || key.startsWith(`${trackId}:`)) activeKeyboardNoteSources.delete(key)
  })
  app.querySelectorAll('[data-piano-midi].is-pressed').forEach((key)=>key.classList.remove('is-pressed'))
}
function updateTrackMeterDom(track) {
  if (!track) return
  const level = clamp(Number(track.outputLevel) || 0, 0, 1)
  const row = app.querySelector(`[data-track-row="${CSS.escape(track.id)}"]`)
  const meter = app.querySelector(`[data-track-meter="${CSS.escape(track.id)}"]`)
  row?.style.setProperty('--track-meter-level', String(level))
  const fill = meter?.querySelector('i')
  const peak = meter?.querySelector('b')
  if (fill) fill.style.height = `${Math.round(level * 100)}%`
  if (peak) peak.style.bottom = `${Math.round(level * 100)}%`
}
function startTrackMeterLoop() {
  if (meterRaf) return
  const tick = () => {
    let active = false
    tracks.forEach((track) => {
      const channel = trackAudioChannels.get(track.id)
      if (channel?.analyser) {
        channel.analyser.getFloatTimeDomainData(channel.data)
        let sum = 0
        let peak = 0
        for (let index = 0; index < channel.data.length; index += 1) {
          const sample = Math.abs(channel.data[index] || 0)
          sum += sample * sample
          if (sample > peak) peak = sample
        }
        const rms = Math.sqrt(sum / Math.max(1, channel.data.length))
        const target = clamp(Math.max(rms * 3.2, peak * 1.1), 0, 1)
        const attack = target > channel.level ? 0.45 : 0.12
        channel.level += (target - channel.level) * attack
        channel.peak = Math.max(target, channel.peak * 0.965)
        track.outputLevel = channel.level < 0.005 ? 0 : channel.level
      } else {
        track.outputLevel = Math.max(0, (Number(track.outputLevel) || 0) * 0.9)
      }
      if (track.outputLevel > 0) active = true
      updateTrackMeterDom(track)
    })
    meterRaf = active || isPlaying || activeRecording || activePlaybackNotes.size ? requestAnimationFrame(tick) : 0
  }
  meterRaf = requestAnimationFrame(tick)
}
function midiToFrequency(midi){ return 440 * (2 ** ((midi - 69) / 12)) }
async function ensureInstrumentAudio(){ if(!instrumentAudioContext){ instrumentAudioContext = new (window.AudioContext || window.webkitAudioContext)(); instrumentMasterGain = instrumentAudioContext.createGain(); instrumentPanNode = instrumentAudioContext.createStereoPanner(); instrumentMasterGain.gain.value=instrumentVolume; instrumentPanNode.pan.value=instrumentPan; instrumentPanNode.connect(instrumentMasterGain); instrumentMasterGain.connect(instrumentAudioContext.destination) } if(instrumentAudioContext.state==='suspended') await instrumentAudioContext.resume(); }
async function startInstrumentNote(midi){ const shifted=midi+(instrumentOctaveOffset*12); if(activeInstrumentNotes.has(shifted)) return; try{ await ensureInstrumentAudio(); const osc=instrumentAudioContext.createOscillator(); const gain=instrumentAudioContext.createGain(); osc.type='triangle'; osc.frequency.value=midiToFrequency(shifted); gain.gain.setValueAtTime(0.0001,instrumentAudioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.16*instrumentVolume,instrumentAudioContext.currentTime+0.02); osc.connect(gain); gain.connect(instrumentPanNode); osc.start(); activeInstrumentNotes.set(shifted,{osc,gain,midi:shifted}); setTrackKeyboardNoteActive(selectedTrackId, shifted, `legacy:${shifted}`, true) }catch(err){ console.warn('[studioProject] instrument note start failed',err) } }
function stopInstrumentNote(midi){ const shifted=midi+(instrumentOctaveOffset*12); if(isSustainEnabled) return; const voice=activeInstrumentNotes.get(shifted); if(!voice||!instrumentAudioContext) return; voice.gain.gain.cancelScheduledValues(instrumentAudioContext.currentTime); voice.gain.gain.setValueAtTime(Math.max(0.0001,voice.gain.gain.value),instrumentAudioContext.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001,instrumentAudioContext.currentTime+0.08); voice.osc.stop(instrumentAudioContext.currentTime+0.1); activeInstrumentNotes.delete(shifted); setTrackKeyboardNoteActive(selectedTrackId, shifted, `legacy:${shifted}`, false) }
function stopAllInstrumentNotes(){ if(!instrumentAudioContext) { activeInstrumentNotes.clear(); return } for(const [m,voice] of activeInstrumentNotes){ voice.gain.gain.cancelScheduledValues(instrumentAudioContext.currentTime); voice.gain.gain.setValueAtTime(Math.max(0.0001,voice.gain.gain.value),instrumentAudioContext.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001,instrumentAudioContext.currentTime+0.05); voice.osc.stop(instrumentAudioContext.currentTime+0.08); activeInstrumentNotes.delete(m); setTrackKeyboardNoteActive(selectedTrackId, voice.midi, `legacy:${voice.midi}`, false) } }

function ensureTrackInstrumentInstance(track = getSelectedTrack()) {
  const target = ensureTrackInsertState(track)
  if (!target?.instrument) return null
  if (!target.instrument.pluginInstanceId) target.instrument.pluginInstanceId = `${target.instrument.type}:${target.id}`
  const channel = getTrackAudioChannel(target.id)
  if (channel?.input && audioContext) channel.input.gain.setTargetAtTime(clamp((Number(target.volume) || 0) / 100, 0, 1), audioContext.currentTime, 0.015)
  if (channel?.panner && audioContext) channel.panner.pan.setTargetAtTime(clamp((Number(target.pan) || 0) / 100, -1, 1), audioContext.currentTime, 0.015)
  return dawInstrumentRegistry.createOrGet({
    id: target.instrument.pluginInstanceId,
    type: target.instrument.type,
    trackId: target.id,
    params: target.instrument.params || {},
    manifest: target.instrument.type === DAW_PLUGIN_TYPES.librarySampler
      ? studioLibraryState.data?.instruments?.find((item) => item.id === target.instrument.params?.libraryInstrumentId)
      : null
  })
}
function playTrackMidiNote(track, note, velocity = 0.85) {
  if (!track?.instrument || track.instrument.enabled === false) return
  ensureTrackInstrumentInstance(track)
  dawInstrumentRegistry.noteOn(track.instrument.pluginInstanceId, note, velocity)
  startTrackMeterLoop()
  setTrackKeyboardNoteActive(track.id, note, `live:${track.id}:${note}`, true)
  recordMidiNoteOn(track.id, note, velocity)
}
function stopTrackMidiNote(track, note) {
  if (!track?.instrument) return
  dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, note)
  setTrackKeyboardNoteActive(track.id, note, `live:${track.id}:${note}`, false)
  recordMidiNoteOff(track.id, note)
}
function hasSoloedTracks() { return tracks.some((track)=>track.soloed) }
function isTrackAudible(track) {
  if (!track || track.muted) return false
  if (hasSoloedTracks() && !track.soloed) return false
  if (!track.instrument || track.instrument.enabled === false) return false
  return true
}
function noteIsVisibleInRegion(region, note) {
  const start = Number(note.startBeat) || 0
  const end = start + Math.max(0.01, Number(note.durationBeats) || 0)
  const regionStart = Number(region.startBeat) || 0
  const regionEnd = Math.max(regionStart, Number(region.endBeat) || regionStart)
  return start >= regionStart && end <= regionEnd
}
function stopPlaybackNote(key) {
  const active = activePlaybackNotes.get(key)
  if (!active) return
  const track = tracks.find((item)=>item.id === active.trackId)
  if (track?.instrument?.pluginInstanceId) dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, active.note)
  setTrackKeyboardNoteActive(active.trackId, active.note, `playback:${key}`, false)
  activePlaybackNotes.delete(key)
}
function stopAllPlaybackNotes() {
  Array.from(activePlaybackNotes.keys()).forEach((key)=>stopPlaybackNote(key))
}
function updateMidiRegionPlayback(currentBeat) {
  const beat = clampBeat(currentBeat)
  activePlaybackNotes.forEach((active, key) => {
    const region = midiRegions.find((item)=>item.id === active.regionId)
    const track = tracks.find((item)=>item.id === active.trackId)
    if (!region || !isTrackAudible(track) || beat < active.startBeat || beat >= active.endBeat || beat < region.startBeat || beat >= region.endBeat) stopPlaybackNote(key)
  })
  midiRegions.forEach((region) => {
    const track = tracks.find((item)=>item.id === region.trackId)
    if (!isTrackAudible(track)) return
    ensureTrackInstrumentInstance(track)
    ;(region.notes || []).forEach((note, index) => {
      if (!noteIsVisibleInRegion(region, note)) return
      const startBeat = Number(note.startBeat) || 0
      const endBeat = startBeat + Math.max(0.05, Number(note.durationBeats) || 0.05)
      const key = `${region.id}:${index}:${note.note}`
      if (beat >= startBeat && beat < endBeat && !activePlaybackNotes.has(key)) {
        dawInstrumentRegistry.noteOn(track.instrument.pluginInstanceId, note.note, clamp((Number(note.velocity) || 0.85), 0, 1))
        activePlaybackNotes.set(key, { regionId: region.id, trackId: track.id, note: note.note, startBeat, endBeat })
        setTrackKeyboardNoteActive(track.id, note.note, `playback:${key}`, true)
        startTrackMeterLoop()
      }
    })
  })
}
function refreshMidiRegionDom() {
  const gridInner = app.querySelector('[data-arrangement-grid-inner]')
  if (!gridInner) return
  const playhead = gridInner.querySelector('.studio-grid-playhead')
  gridInner.querySelectorAll('[data-midi-region]').forEach((node)=>node.remove())
  playhead?.insertAdjacentHTML('beforebegin', renderTimelineRegions())
  bindMidiRegionEvents()
}
function bindMidiRegionEvents() {
  app.querySelectorAll('[data-midi-region]').forEach((region)=>{
    region.addEventListener('pointerdown',(event)=>startMidiRegionDrag(event, region.dataset.midiRegion))
    region.addEventListener('contextmenu',(event)=>{
      event.preventDefault()
      event.stopPropagation()
      selectedMidiRegionId = region.dataset.midiRegion
      const pos = getClampedFloatingPosition(event.clientX, event.clientY, 220, 230)
      midiRegionMenuState = { regionId: region.dataset.midiRegion, x: pos.x, y: pos.y, pasteBeat: pointerEventToTimelineBeat(event), trackId: tracks[getTrackLaneFromY(event.clientY)]?.id || selectedTrackId }
      renderEditor()
    })
  })
}
function getRecordingTrack() {
  const selected = getSelectedTrack()
  if (selected?.recordArmed || selected?.instrument) return selected
  return tracks.find((track)=>track.recordArmed && track.instrument) || selected
}
function startMidiRecordFlow() {
  const track = getRecordingTrack()
  if (!track) { recordingStatus = 'Select or arm an instrument track to record MIDI.'; renderEditor(); return }
  if (!track.instrument) { recordingStatus = 'Choose an instrument before recording MIDI.'; activeLeftPanel = 'inspector'; renderEditor(); return }
  if (track.instrument.enabled === false) { recordingStatus = 'Instrument is disabled.'; renderEditor(); return }
  stopPlayback()
  if (countInTimer) clearInterval(countInTimer)
  countInTimer = 0
  if (!isCountInEnabled) { beginMidiRecording(track); return }
  const targetBeat = clampBeat(xToBeat(timelineState.playheadX))
  const prerollBeats = 4
  const requiredPreStart = Math.max(0, (prerollBeats - targetBeat) * beatWidth())
  if (requiredPreStart > timelineState.preStartPixels) {
    timelineState.preStartPixels = clamp(Math.ceil(requiredPreStart), 0, timelineState.pixelsPerBar * 10)
    syncBarsFromPositiveBeats()
  }
  const targetX = beatToX(targetBeat)
  const startX = beatToX(targetBeat - prerollBeats)
  countInTargetX = targetX
  countInTargetTrackId = track.id
  isCountInRunning = true
  countInBeatsRemaining = 4
  recordingStatus = `Count-in for ${track.name}`
  setPlayhead(startX)
  startPlayback()
  renderEditor()
}
function beginMidiRecording(track, { startBeat = null } = {}) {
  if (!track) return
  ensureTrackInstrumentInstance(track)
  const recordStartBeat = Number.isFinite(Number(startBeat)) ? Number(startBeat) : clampBeat(xToBeat(timelineState.playheadX))
  activeRecording = { id: makeInsertId('midi-region'), trackId: track.id, name: track?.autoNameRegions === false ? '' : track.name, startBeat: recordStartBeat, endBeat: recordStartBeat, color: '#ff2d55', notes: [] }
  activeRecordingNotes.clear()
  recordingStatus = `Recording ${track.name}`
  if (!isPlaying) startPlayback()
  renderEditor()
}
function stopRecordingAndKeep() {
  if (isCountInRunning && !activeRecording) {
    isCountInRunning = false
    countInBeatsRemaining = 0
    countInTargetX = null
    countInTargetTrackId = ''
  }
  finalizeMidiRecording()
  stopAllTrackInstrumentNotes()
  stopPlayback()
  recordingStatus = ''
  renderEditor()
}
function recordMidiNoteOn(trackId, note, velocity = 0.85) {
  if (!activeRecording || activeRecording.trackId !== trackId) return
  const key = `${trackId}:${note}`
  if (activeRecordingNotes.has(key)) return
  activeRecordingNotes.set(key, { note, velocity, startBeat: clampBeat(xToBeat(timelineState.playheadX)) })
  refreshMidiRegionDom()
}
function recordMidiNoteOff(trackId, note) {
  if (!activeRecording || activeRecording.trackId !== trackId) return
  const key = `${trackId}:${note}`
  const started = activeRecordingNotes.get(key)
  if (!started) return
  const endBeat = Math.max(started.startBeat + 0.05, clampBeat(xToBeat(timelineState.playheadX)))
  activeRecording.notes.push({ note: started.note, velocity: started.velocity, startBeat: started.startBeat, durationBeats: endBeat - started.startBeat })
  activeRecordingNotes.delete(key)
  refreshMidiRegionDom()
}
function finalizeMidiRecording({ keepEmpty = false } = {}) {
  if (!activeRecording) return
  const before = captureDawSnapshot()
  const endBeat = Math.max(activeRecording.startBeat + 0.25, clampBeat(xToBeat(timelineState.playheadX)))
  activeRecordingNotes.forEach((started, key)=>{
    activeRecording.notes.push({ note: started.note, velocity: started.velocity, startBeat: started.startBeat, durationBeats: Math.max(0.05, endBeat - started.startBeat) })
    activeRecordingNotes.delete(key)
  })
  const track = tracks.find((item)=>item.id===activeRecording.trackId)
  if (activeRecording.notes.length || keepEmpty) midiRegions.push({ ...activeRecording, endBeat, color: track?.color || activeRecording.color, name: track?.autoNameRegions === false ? '' : (track?.name || '') })
  activeRecording = null
  recordingStatus = ''
  activeRecordingNotes.clear()
  pushHistory('record-midi-region', before, captureDawSnapshot())
  scheduleEditorSave()
}
function stopAllTrackInstrumentNotes() {
  activeRecordingNotes.forEach((started)=> {
    const track = tracks.find((item)=>item.id===activeRecording?.trackId)
    if (track?.instrument?.pluginInstanceId) dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, started.note)
  })
  pressedDawMidiKeys.forEach(({ trackId, note }) => {
    const track = tracks.find((item)=>item.id===trackId)
    if (track?.instrument?.pluginInstanceId) dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, note)
  })
  pressedDawMidiKeys.clear()
  typingPitchTrigger = 0
  typingModTrigger = 0
  clearTrackKeyboardNotes()
}
function getTrackIndexFromClientY(clientY) {
  return getTrackLaneFromY(clientY)
}
function startMidiRegionDrag(event, regionId) {
  if (event.button !== 0) return
  const region = midiRegions.find((item)=>item.id===regionId)
  const gridEl = app.querySelector('[data-arrangement-grid]')
  if (!region || !gridEl) return
  event.preventDefault()
  event.stopPropagation()
  selectedMidiRegionId = region.id
  const handle = event.target.closest('[data-midi-region-handle]')?.dataset?.midiRegionHandle || 'move'
  midiRegionDrag = {
    id: region.id,
    mode: handle,
    hasMoved: false,
    before: captureDawSnapshot(),
    startX: event.clientX,
    startY: event.clientY,
    startBeat: Number(region.startBeat) || 0,
    endBeat: Number(region.endBeat) || ((Number(region.startBeat) || 0) + 1),
    startTrackIndex: Math.max(0, tracks.findIndex((track)=>track.id===region.trackId)),
    originalNotes: (region.notes || []).map((note)=>({ ...note }))
  }
  document.body.classList.add('is-studio-dragging', 'is-midi-region-dragging')
  renderEditor()
}
function applyMidiRegionDrag(event) {
  if (!midiRegionDrag) return
  const region = midiRegions.find((item)=>item.id===midiRegionDrag.id)
  if (!region) return
  const dx = event.clientX - midiRegionDrag.startX
  const dy = event.clientY - midiRegionDrag.startY
  if (!midiRegionDrag.hasMoved && Math.hypot(dx, dy) < 4) return
  midiRegionDrag.hasMoved = true
  const deltaBeat = regionPixelsToBeats(dx)
  const snappedDelta = isSnapEnabled ? snapBeat(deltaBeat) : Math.round(deltaBeat * 4) / 4
  const minLength = 0.25
  const originalLength = Math.max(minLength, midiRegionDrag.endBeat - midiRegionDrag.startBeat)
  if (midiRegionDrag.mode === 'left') {
    const pointerBeat = pointerEventToTimelineBeat(event)
    region.startBeat = clamp(pointerBeat, 0, midiRegionDrag.endBeat - minLength)
  } else if (midiRegionDrag.mode === 'right') {
    const pointerBeat = pointerEventToTimelineBeat(event)
    region.endBeat = Math.max(midiRegionDrag.startBeat + minLength, pointerBeat)
  } else {
    const nextStart = Math.max(0, midiRegionDrag.startBeat + snappedDelta)
    region.startBeat = nextStart
    region.endBeat = nextStart + originalLength
    const noteDelta = nextStart - midiRegionDrag.startBeat
    region.notes = midiRegionDrag.originalNotes.map((note)=>({ ...note, startBeat: (Number(note.startBeat) || 0) + noteDelta }))
    const nextTrack = tracks[getTrackIndexFromClientY(event.clientY)]
    if (nextTrack) {
      region.trackId = nextTrack.id
      if (!region.independentColor) region.color = nextTrack.color
    }
  }
  refreshMidiRegionDom()
}
function finishMidiRegionDrag() {
  if (!midiRegionDrag) return
  const didMove = midiRegionDrag.hasMoved
  const before = midiRegionDrag.before
  midiRegionDrag = null
  document.body.classList.remove('is-studio-dragging', 'is-midi-region-dragging')
  if (didMove) {
    pushHistory('edit-midi-region', before, captureDawSnapshot())
    scheduleEditorSave()
  }
  renderEditor()
}

function selectMidiNote(regionId, noteIndex) {
  const region = midiRegions.find((item)=>item.id === regionId)
  if (!region?.notes?.[noteIndex]) return
  midiRollState = { ...(midiRollState || {}), regionId }
  selectedMidiRegionId = regionId
  midiRollSelectedNoteIndex = noteIndex
  midiRollStatus = ''
  renderEditor()
}
function getMidiRollSnapValue() {
  return Math.max(0.03125, Number(midiRollState?.quantize || 0.25) || 0.25)
}
function mutateSelectedMidiNote(type, mutator) {
  const region = getMidiRollRegion()
  const index = midiRollSelectedNoteIndex
  if (!region || !Number.isInteger(index) || !region.notes?.[index]) return
  commitHistoryMutation(type, () => {
    const note = region.notes[index]
    mutator(note, region, index)
  })
}
function deleteSelectedMidiNote() {
  const region = getMidiRollRegion()
  const selected = midiRollSelectedNoteIndices.length ? midiRollSelectedNoteIndices : (Number.isInteger(midiRollSelectedNoteIndex) ? [midiRollSelectedNoteIndex] : [])
  if (!region || !selected.some((index) => region.notes?.[index])) return false
  commitHistoryMutation('delete-midi-note', () => {
    selected.sort((a, b) => b - a).forEach((index) => {
      if (region.notes?.[index]) region.notes.splice(index, 1)
    })
    midiRollSelectedNoteIndex = null
    midiRollSelectedNoteIndices = []
  })
  return true
}
function getMidiRollTargetNoteIndices() {
  const region = getMidiRollRegion()
  if (!region?.notes?.length) return []
  const selected = midiRollSelectedNoteIndices.length ? midiRollSelectedNoteIndices : (Number.isInteger(midiRollSelectedNoteIndex) ? [midiRollSelectedNoteIndex] : [])
  const validSelected = [...new Set(selected)].filter((index) => Number.isInteger(index) && region.notes[index])
  return validSelected.length ? validSelected : region.notes.map((_, index) => index)
}
function quantizeSelectedMidiNote() {
  const region = getMidiRollRegion()
  const indices = getMidiRollTargetNoteIndices()
  if (!region?.notes?.length) {
    midiRollStatus = 'No notes available to quantize.'
    renderEditor()
    return
  }
  const selectedCount = (midiRollSelectedNoteIndices.length || Number.isInteger(midiRollSelectedNoteIndex)) ? indices.length : 0
  const snap = getMidiRollSnapValue()
  commitHistoryMutation('quantize-midi-notes', () => {
    indices.forEach((index) => {
      const note = region.notes[index]
      if (!note) return
      note.startBeat = clampBeat(snapBeat(Number(note.startBeat) || 0, snap))
      note.durationBeats = Math.max(snap, snapBeat(Number(note.durationBeats) || snap, snap))
    })
    midiRollStatus = selectedCount ? `Quantized ${indices.length} selected note${indices.length === 1 ? '' : 's'}.` : `Quantized ${indices.length} clip note${indices.length === 1 ? '' : 's'}.`
  })
}
function beginMidiNoteDrag(event, regionId, noteIndex) {
  const region = midiRegions.find((item)=>item.id === regionId)
  const note = region?.notes?.[noteIndex]
  const grid = app.querySelector('[data-midi-roll-grid]')
  if (!region || !note || !grid) return
  event.preventDefault()
  event.stopPropagation()
  selectedMidiRegionId = regionId
  if (event.shiftKey) {
    const selected = new Set(midiRollSelectedNoteIndices)
    if (selected.has(noteIndex)) selected.delete(noteIndex)
    else selected.add(noteIndex)
    midiRollSelectedNoteIndices = [...selected].sort((a, b) => a - b)
    midiRollSelectedNoteIndex = midiRollSelectedNoteIndices[0] ?? null
    midiRollStatus = ''
    renderEditor()
    return
  }
  midiRollSelectedNoteIndex = noteIndex
  midiRollSelectedNoteIndices = [noteIndex]
  midiRollStatus = ''
  const handle = event.target.closest('[data-midi-note-handle]')?.dataset?.midiNoteHandle || 'move'
  midiNoteDrag = {
    regionId,
    noteIndex,
    mode: handle,
    before: captureDawSnapshot(),
    startX: event.clientX,
    startY: event.clientY,
    startBeat: Number(note.startBeat) || Number(region.startBeat) || 0,
    durationBeats: Math.max(0.05, Number(note.durationBeats) || 0.25),
    note: Number(note.note) || 60,
    hasMoved: false
  }
  document.body.classList.add('is-studio-dragging', 'is-midi-note-dragging')
  renderEditor()
}
function applyMidiNoteDrag(event) {
  if (!midiNoteDrag) return
  const region = midiRegions.find((item)=>item.id === midiNoteDrag.regionId)
  const note = region?.notes?.[midiNoteDrag.noteIndex]
  if (!region || !note) return
  const dx = event.clientX - midiNoteDrag.startX
  const dy = event.clientY - midiNoteDrag.startY
  if (!midiNoteDrag.hasMoved && Math.hypot(dx, dy) < 3) return
  midiNoteDrag.hasMoved = true
  const snap = getMidiRollSnapValue()
  const deltaBeat = snapBeat(dx / midiRollBeatWidth, snap)
  const pitchDelta = -Math.round(dy / midiRollRowHeight)
  const regionStart = Number(region.startBeat) || 0
  const regionEnd = Math.max(regionStart + 0.25, Number(region.endBeat) || regionStart + 0.25)
  if (midiNoteDrag.mode === 'left') {
    const nextStart = clamp(snapBeat(midiNoteDrag.startBeat + deltaBeat, snap), regionStart, midiNoteDrag.startBeat + midiNoteDrag.durationBeats - 0.05)
    note.durationBeats = Math.max(0.05, midiNoteDrag.startBeat + midiNoteDrag.durationBeats - nextStart)
    note.startBeat = nextStart
  } else if (midiNoteDrag.mode === 'right') {
    const nextEnd = clamp(snapBeat(midiNoteDrag.startBeat + midiNoteDrag.durationBeats + deltaBeat, snap), midiNoteDrag.startBeat + 0.05, regionEnd)
    note.durationBeats = Math.max(0.05, nextEnd - midiNoteDrag.startBeat)
  } else {
    note.startBeat = clamp(snapBeat(midiNoteDrag.startBeat + deltaBeat, snap), regionStart, Math.max(regionStart, regionEnd - midiNoteDrag.durationBeats))
    const rows = midiRollPitchRows(region)
    note.note = clamp(midiNoteDrag.note + pitchDelta, rows[rows.length - 1], rows[0])
  }
  refreshMidiRegionDom()
  const noteEl = app.querySelector(`[data-midi-note-index="${CSS.escape(String(midiNoteDrag.noteIndex))}"]`)
  if (noteEl) {
    const rows = midiRollPitchRows()
    const pitchIndex = rows.indexOf(Number(note.note) || 60)
    noteEl.style.left = `${Math.max(0, (Number(note.startBeat || regionStart) - regionStart) * midiRollBeatWidth)}px`
    noteEl.style.width = `${Math.max(10, (Number(note.durationBeats) || 0.25) * midiRollBeatWidth)}px`
    noteEl.style.top = `${Math.max(0, (pitchIndex < 0 ? rows.indexOf(60) : pitchIndex) * midiRollRowHeight + 3)}px`
    const label = noteEl.querySelector('strong')
    if (label) label.textContent = formatMidiNoteName(note.note)
  }
}
function finishMidiNoteDrag() {
  if (!midiNoteDrag) return
  const didMove = midiNoteDrag.hasMoved
  const before = midiNoteDrag.before
  midiNoteDrag = null
  document.body.classList.remove('is-studio-dragging', 'is-midi-note-dragging')
  if (didMove) {
    pushHistory('edit-midi-note', before, captureDawSnapshot())
    scheduleEditorSave()
  }
  renderEditor()
}
function getMidiRollGridPoint(event) {
  const grid = app.querySelector('[data-midi-roll-grid]')
  const rect = grid?.getBoundingClientRect?.()
  if (!grid || !rect) return null
  return {
    x: clamp(event.clientX - rect.left, 0, grid.offsetWidth || 0),
    y: clamp(event.clientY - rect.top, 0, grid.offsetHeight || 0)
  }
}
function beginMidiRollSelection(event) {
  if (event.button !== 0 || event.target.closest('[data-midi-note-index]')) return
  const region = getMidiRollRegion()
  const point = getMidiRollGridPoint(event)
  if (!region || !point) return
  event.preventDefault()
  event.stopPropagation()
  midiRollSelectionDrag = { startX: point.x, startY: point.y, currentX: point.x, currentY: point.y, hasMoved: false, additive: !!event.shiftKey, existing: [...midiRollSelectedNoteIndices] }
  if (!event.shiftKey) {
    midiRollSelectedNoteIndex = null
    midiRollSelectedNoteIndices = []
    midiRollStatus = ''
  }
  const box = app.querySelector('[data-midi-roll-selection]')
  if (box) {
    box.style.left = `${point.x}px`
    box.style.top = `${point.y}px`
    box.style.width = '0px'
    box.style.height = '0px'
    box.hidden = false
  }
}
function updateMidiRollSelectionDrag(event) {
  if (!midiRollSelectionDrag) return
  const point = getMidiRollGridPoint(event)
  const box = app.querySelector('[data-midi-roll-selection]')
  if (!point || !box) return
  const drag = midiRollSelectionDrag
  drag.currentX = point.x
  drag.currentY = point.y
  drag.hasMoved = drag.hasMoved || Math.hypot(point.x - drag.startX, point.y - drag.startY) > 4
  box.style.left = `${Math.min(drag.startX, drag.currentX)}px`
  box.style.top = `${Math.min(drag.startY, drag.currentY)}px`
  box.style.width = `${Math.abs(drag.currentX - drag.startX)}px`
  box.style.height = `${Math.abs(drag.currentY - drag.startY)}px`
  box.hidden = false
}
function finishMidiRollSelection() {
  if (!midiRollSelectionDrag) return
  const drag = midiRollSelectionDrag
  midiRollSelectionDrag = null
  const box = app.querySelector('[data-midi-roll-selection]')
  if (box) box.hidden = true
  if (!drag.hasMoved) {
    renderEditor()
    return
  }
  const region = getMidiRollRegion()
  if (!region) return
  const rows = midiRollPitchRows()
  const regionStart = Number(region.startBeat || 0)
  const left = Math.min(drag.startX, drag.currentX)
  const right = Math.max(drag.startX, drag.currentX)
  const top = Math.min(drag.startY, drag.currentY)
  const bottom = Math.max(drag.startY, drag.currentY)
  const selected = []
  ;(region.notes || []).forEach((note, index) => {
    const pitchIndex = rows.indexOf(Number(note.note) || 60)
    const noteLeft = Math.max(0, (Number(note.startBeat || regionStart) - regionStart) * midiRollBeatWidth)
    const noteRight = noteLeft + Math.max(10, (Number(note.durationBeats) || 0.25) * midiRollBeatWidth)
    const noteTop = Math.max(0, (pitchIndex < 0 ? rows.indexOf(60) : pitchIndex) * midiRollRowHeight + 3)
    const noteBottom = noteTop + Math.max(10, midiRollRowHeight - 6)
    if (noteRight >= left && noteLeft <= right && noteBottom >= top && noteTop <= bottom) selected.push(index)
  })
  midiRollSelectedNoteIndices = drag.additive ? [...new Set([...(drag.existing || []), ...selected])].sort((a, b) => a - b) : selected
  midiRollSelectedNoteIndex = midiRollSelectedNoteIndices[0] ?? null
  midiRollStatus = ''
  renderEditor()
}
function handleMidiRollWheel(event) {
  const grid = event.target.closest('[data-midi-roll-grid]')
  if (!grid) return
  const scroll = grid.closest('.studio-midi-roll-scroll')
  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    event.preventDefault()
    const scrollRect = scroll?.getBoundingClientRect?.()
    const pointerX = scrollRect ? event.clientX - scrollRect.left : 0
    const beatAtPointer = ((scroll?.scrollLeft || 0) + pointerX) / Math.max(1, midiRollBeatWidth)
    midiRollBeatWidth = Math.round(clamp(midiRollBeatWidth * (event.deltaY < 0 ? 1.12 : 0.88), 28, 180))
    pendingMidiRollViewport = {
      regionId: getMidiRollRegion()?.id || '',
      scrollLeft: Math.max(0, (beatAtPointer * midiRollBeatWidth) - pointerX),
      scrollTop: scroll?.scrollTop || 0
    }
    renderEditor()
    return
  }
  if (event.altKey) {
    event.preventDefault()
    const scrollRect = scroll?.getBoundingClientRect?.()
    const pointerY = scrollRect ? event.clientY - scrollRect.top : 0
    const rowAtPointer = ((scroll?.scrollTop || 0) + pointerY) / Math.max(1, midiRollRowHeight)
    midiRollRowHeight = Math.round(clamp(midiRollRowHeight * (event.deltaY < 0 ? 1.1 : 0.9), 16, 36))
    pendingMidiRollViewport = {
      regionId: getMidiRollRegion()?.id || '',
      scrollLeft: scroll?.scrollLeft || 0,
      scrollTop: Math.max(0, (rowAtPointer * midiRollRowHeight) - pointerY)
    }
    renderEditor()
    return
  }
  if (event.shiftKey && scroll) {
    event.preventDefault()
    scroll.scrollLeft += event.deltaY
  }
}

function beatFromGlobalEvent(event) {
  const lane = app.querySelector('[data-global-tracks]')
  const rect = lane?.getBoundingClientRect?.()
  const scrollLeft = lane?.scrollLeft || 0
  if (!rect) return 0
  const x = clamp(event.clientX - rect.left + scrollLeft, timelineStartX(), maxTimelineX())
  const beat = xToBeatsFromBarZero(x)
  return Math.max(0, isSnapEnabled ? Math.round(beat) : Math.round(beat * 4) / 4)
}
function openSignatureEditor(event, existing = null) {
  const beat = existing?.beat ?? beatFromGlobalEvent(event)
  const signature = existing || { id: makeInsertId('signature'), beat, key: projectState?.key || 'C', scale: 'major', timeSignature: '4/4' }
  if (!existing) globalTracks.signatureEvents = [...normalizeSignatureEvents(projectState).filter((item)=>item.id !== 'signature-default'), signature]
  globalTrackPopover = { type: 'signature', ...signature, x: event.clientX, y: event.clientY }
  scheduleEditorSave()
  renderEditor()
}
function renameGlobalArrangement(id) {
  const item = globalTracks.arrangement.find((section)=>section.id===id)
  if (!item) return
  const next = window.prompt('Rename section', item.label || 'Section')
  if (next == null) return
  item.label = next.trim() || 'Section'
  scheduleEditorSave()
  renderEditor()
}
function renameGlobalMarker(id) {
  const item = globalTracks.markers.find((marker)=>marker.id===id)
  if (!item) return
  const next = window.prompt('Rename marker', item.label || 'Marker')
  if (next == null) return
  item.label = next.trim() || 'Marker'
  scheduleEditorSave()
  renderEditor()
}

function setTrackPan(track, value, { save = false } = {}) {
  if (!track) return
  track.pan = clamp(Math.round(Number(value) || 0), -100, 100)
  const channel = trackAudioChannels.get(track.id)
  if (channel?.panner && audioContext) channel.panner.pan.setTargetAtTime(track.pan / 100, audioContext.currentTime, 0.015)
  const knob = app.querySelector(`[data-track-pan="${CSS.escape(track.id)}"]`)
  knob?.style.setProperty('--pan-angle', `${(track.pan / 100) * 135}deg`)
  knob?.setAttribute('aria-label', `${track.name} pan ${track.pan}`)
  knob?.setAttribute('data-tooltip', `Pan ${track.pan}`)
  if (save) scheduleEditorSave()
}
function openInlineNumericEditor(event, { value, min, max, step = 1, label = 'Value', apply } = {}) {
  event.preventDefault()
  event.stopPropagation()
  app.querySelector('[data-inline-number-editor]')?.remove()
  const page = app.querySelector('.studio-editor-page')
  if (!page) return
  const position = getClampedFloatingPosition(event.clientX, event.clientY, 150, 82)
  const form = document.createElement('form')
  form.className = 'studio-inline-number-editor'
  form.dataset.inlineNumberEditor = ''
  form.style.left = `${position.x}px`
  form.style.top = `${position.y}px`
  form.innerHTML = `<label>${esc(label)}<input type="number" min="${min}" max="${max}" step="${step}" value="${Number(value)}"></label>`
  page.append(form)
  const input = form.querySelector('input')
  let closed = false
  const close = (commit) => {
    if (closed) return
    closed = true
    if (commit) apply?.(clamp(Number(input.value), Number(min), Number(max)))
    form.remove()
  }
  form.addEventListener('submit', (submitEvent) => { submitEvent.preventDefault(); close(true) })
  input.addEventListener('keydown', (keyEvent) => {
    if (keyEvent.key === 'Escape') { keyEvent.preventDefault(); close(false) }
  })
  input.addEventListener('blur', () => window.setTimeout(() => close(true), 0), { once: true })
  input.focus()
  input.select()
}

function bindEditorEvents() {
  const trigger = app.querySelector('[data-editor-left-menu]')
  const leftWrap = app.querySelector('.studio-editor-left')
  const ruler = app.querySelector('[data-timeline-ruler]')
  const grid = app.querySelector('[data-arrangement-grid]')
  const selectionBox = app.querySelector('[data-selection-box]')
  const tooltip = app.querySelector('[data-studio-tooltip]')
  trigger?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); setEditorMenuOpen(!isEditorMenuOpen) })
  app.querySelector('[data-toggle-controls-menu]')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); isControlsMenuOpen = !isControlsMenuOpen; renderEditor() })
  app.querySelector('[data-musical-typing-toggle]')?.addEventListener('change', (event) => { setMusicalTypingEnabled(event.target.checked); renderEditor() })
  document.onclick = (event) => { if (event.target.closest('.studio-notes-modal') || event.target.closest('.studio-notes-panel') || event.target.closest('[data-notes-input]')) return; let changed = false; if (!event.target.closest('.studio-editor-left') && isEditorMenuOpen) { setEditorMenuOpen(false); changed = true } if (!event.target.closest('[data-track-menu]') && !event.target.closest('[data-track-options]') && trackMenuState) { trackMenuState = null; changed = true } if (!event.target.closest('[data-track-rename-form]') && renameTrackState) { renameTrackState = null; changed = true } if (!event.target.closest('[data-track-color-form]') && colorPickerState) { colorPickerState = null; changed = true } if (!event.target.closest('[data-midi-rename-form]') && regionRenameState) { regionRenameState = null; changed = true } if (!event.target.closest('.studio-left-panel') && !event.target.closest('[data-inspector-menu]') && inspectorMenu) { inspectorMenu = null; inspectorMenuPosition = null; changed = true } if (!event.target.closest('[data-controls-menu]') && !event.target.closest('[data-toggle-controls-menu]') && isControlsMenuOpen) { isControlsMenuOpen = false; changed = true } if (changed) renderEditor() }
  document.onkeydown = (event) => { if (event.key === 'Alt' && event.target?.closest?.('.studio-editor-page')) event.preventDefault(); if (event.key === 'Escape') { let changed = false; if (isEditorMenuOpen) { setEditorMenuOpen(false); changed = true } if (isControlsMenuOpen) { isControlsMenuOpen = false; changed = true } if (trackMenuState) { trackMenuState = null; changed = true } if (midiRegionMenuState) { midiRegionMenuState = null; changed = true } if (regionColorPickerState) { regionColorPickerState = null; changed = true } if (regionRenameState) { regionRenameState = null; changed = true } if (renameTrackState) { renameTrackState = null; changed = true } if (colorPickerState) { colorPickerState = null; changed = true } if (globalTrackPopover) { globalTrackPopover = null; changed = true } if (inspectorMenu) { inspectorMenu = null; inspectorMenuPosition = null; changed = true } if (changed) renderEditor() } }
  leftWrap?.addEventListener('click', (event) => event.stopPropagation())
  app.querySelector('[data-keep-site-menu]')?.addEventListener('change', (e) => { keepSiteMenuOpen = e.target.checked; localStorage.setItem(PREF_KEY, keepSiteMenuOpen ? '1' : '0'); isEditorMenuOpen = false; renderEditor() })
  app.querySelectorAll('[data-track-row]').forEach((el) => el.addEventListener('click', () => { if (selectedTrackId !== el.dataset.trackRow) { stopAllTrackInstrumentNotes(); stopAllPlaybackNotes() } selectedTrackId = el.dataset.trackRow; trackMenuState = null; activeLeftPanel = 'inspector'; inspectorMenu = null; renderEditor() }))
  app.querySelectorAll('[data-toggle-inspector-menu]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const nextMenu = el.dataset.toggleInspectorMenu; inspectorMenu = inspectorMenu === nextMenu ? null : nextMenu; inspectorMenuPosition = null; if (inspectorMenu === 'instrument') { const rect = el.getBoundingClientRect(); inspectorMenuPosition = getClampedFloatingPosition(rect.left + rect.width / 2, rect.bottom + 8, 260, 210) } renderEditor() }))
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
    } else if (action === 'instrument-empty') {
      if (track.instrument?.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId)
      track.instrument = null
    } else if (action === 'instrument') {
      track.instrument = createTrackInstrument(el.dataset.insertType, track.id)
      track.type = track.type === 'audio' ? 'instrument' : track.type
    }
    inspectorMenu = null
    inspectorMenuPosition = null
    scheduleEditorSave()
    renderEditor()
  }))
  app.querySelector('[data-toggle-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; track.instrument.enabled = !track.instrument.enabled; if (!track.instrument.enabled) { stopAllTrackInstrumentNotes(); stopAllPlaybackNotes() } scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-remove-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); if (track.instrument.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId); track.instrument = null; scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-edit-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; if (!track.instrument.pluginInstanceId) track.instrument.pluginInstanceId = `${track.instrument.type}:${track.id}`; dawWindowManager.openPlugin({ pluginType: track.instrument.type, trackId: track.id, instanceId: track.instrument.pluginInstanceId, params: track.instrument.params || {}, forceCenter: true }) })
  app.querySelectorAll('[data-toggle-insert]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); const list = el.dataset.toggleInsert === 'midi' ? track?.midiEffects : track?.audioEffects; const insert = list?.find((item)=>item.id===el.dataset.insertId); if (!insert) return; insert.enabled = !insert.enabled; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-edit-insert]').forEach((el) => el.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    if (el.dataset.editInsert !== 'midi') return
    const track = ensureTrackInsertState(getSelectedTrack())
    const insert = track?.midiEffects?.find((item)=>item.id === el.dataset.insertId)
    if (!track || !insert) return
    activeMidiEffectEditor = { trackId: track.id, insertId: insert.id }
    activeBottomPanel = 'midi-effect'
    closingBottomPanel = ''
    bottomPanelMotion = 'entering'
    renderEditor()
  }))
  app.querySelectorAll('[data-remove-insert]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track) return; if (el.dataset.removeInsert === 'midi') track.midiEffects = track.midiEffects.filter((item)=>item.id!==el.dataset.insertId); if (el.dataset.removeInsert === 'audio') track.audioEffects = track.audioEffects.filter((item)=>item.id!==el.dataset.insertId); scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-channel-setting]').forEach((input)=>input.addEventListener('change', () => {
    const track = ensureTrackInsertState(getSelectedTrack())
    if (!track) return
    const key = input.dataset.channelSetting
    const before = ['name', 'color'].includes(key) ? captureDawSnapshot() : null
    if (input.type === 'checkbox') track[key] = input.checked
    else if (input.type === 'number' || input.type === 'range') track[key] = Number(input.value)
    else track[key] = input.value
    if (key === 'name') track.name = input.value || track.name
    if (key === 'color') { track.color = input.value; track.colorSoft = `${input.value}44` }
    if (key === 'pan') setTrackPan(track, input.value)
    if (before) pushHistory(key === 'name' ? 'rename-track' : 'color-track', before, captureDawSnapshot())
    scheduleEditorSave()
    renderEditor()
  }))
  app.querySelectorAll('[data-channel-accordion]').forEach((detail)=>detail.addEventListener('toggle', () => {
    persistChannelAccordionState(detail.dataset.channelAccordion, detail.open)
  }))
  app.querySelector('[data-stop-stuck-notes]')?.addEventListener('click', () => { stopAllTrackInstrumentNotes(); stopAllPlaybackNotes() })
  app.querySelector('[data-reset-track-audio]')?.addEventListener('click', () => { const track=getSelectedTrack(); if(!track) return; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); disposeTrackAudioChannel(track.id); if(track.instrument?.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId); ensureTrackInstrumentInstance(track); startTrackMeterLoop() })
  app.querySelector('[data-disable-track-instrument]')?.addEventListener('change', (event) => { const track=ensureTrackInsertState(getSelectedTrack()); if(!track?.instrument) return; track.instrument.enabled = !event.target.checked; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); scheduleEditorSave(); renderEditor() })
  const getTrack = (id) => tracks.find((track) => track.id === id)
  const showTooltip = (target) => { if (!tooltip || !target?.dataset?.tooltip) return; tooltip.textContent = target.dataset.tooltip; tooltip.hidden = false; const rect = target.getBoundingClientRect(); const trect = tooltip.getBoundingClientRect(); tooltip.style.left = `${Math.max(8, rect.left + rect.width / 2 - trect.width / 2)}px`; tooltip.style.top = `${Math.max(8, rect.top - trect.height - 8)}px` }
  const hideTooltip = () => { if (tooltip) tooltip.hidden = true }
  app.querySelectorAll('[data-tooltip]').forEach((target) => { target.addEventListener('pointerenter', () => showTooltip(target)); target.addEventListener('pointerleave', hideTooltip); target.addEventListener('focus', () => showTooltip(target)); target.addEventListener('blur', hideTooltip) })
  app.querySelector('[data-bottom-panel-resize]')?.addEventListener('pointerdown', (event) => {
    const panel = event.target.closest('.studio-bottom-panel')
    if (!panel) return
    event.preventDefault()
    event.stopPropagation()
    bottomPanelResizeDrag = { startY: event.clientY, startHeight: panel.getBoundingClientRect().height, panel }
    document.body.classList.add('is-studio-dragging', 'is-bottom-panel-resizing')
  })
  app.querySelectorAll('[data-detach-bottom-panel]').forEach((button) => button.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    detachBottomPanel(button.dataset.detachBottomPanel)
  }))
  app.querySelector('.studio-midi-roll-scroll')?.addEventListener('scroll', captureMidiRollViewport, { passive: true })
  app.querySelector('[data-midi-roll-grid]')?.addEventListener('pointerdown', beginMidiRollSelection)
  app.querySelector('[data-midi-roll-grid]')?.addEventListener('wheel', handleMidiRollWheel, { passive: false })
  app.querySelectorAll('[data-track-mute]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackMute); if (!t) return; t.muted = !t.muted; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-solo]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackSolo); if (!t) return; t.soloed = !t.soloed; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-record]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackRecord); if (!t) return; t.recordArmed = !t.recordArmed; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-volume]').forEach((el) => {
    el.addEventListener('input', () => { const t = getTrack(el.dataset.trackVolume); if (!t) return; t.volume = clamp(Number(el.value), 0, 100); const channel=trackAudioChannels.get(t.id); if(channel?.input&&audioContext) channel.input.gain.setTargetAtTime(t.volume/100, audioContext.currentTime, 0.015) })
    el.addEventListener('change', ()=>scheduleEditorSave())
    el.addEventListener('dblclick', (event) => {
      const track = getTrack(el.dataset.trackVolume)
      if (!track) return
      openInlineNumericEditor(event, { label: 'Volume', value: track.volume, min: 0, max: 100, step: 1, apply: (value) => { track.volume = value; const channel=trackAudioChannels.get(track.id); if(channel?.input&&audioContext) channel.input.gain.setTargetAtTime(value/100, audioContext.currentTime, 0.015); scheduleEditorSave(); renderEditor() } })
    })
  })
  app.querySelectorAll('[data-track-automation]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackAutomation); if (!t) return; t.automationOpen = !t.automationOpen; renderEditor() }))
  app.querySelectorAll('[data-track-options]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation()
    const id = el.dataset.trackOptions
    selectedTrackId = id
    trackMenuState = { trackId: id, ...getClampedTrackMenuPosition(e.clientX, e.clientY) }
    activeLeftPanel = 'inspector'
    inspectorMenu = null
    renderEditor()
  }))
  app.querySelector('[data-add-track]')?.addEventListener('click', (event) => { event.stopPropagation(); addTrack() })
  app.querySelector('[data-duplicate-track]')?.addEventListener('click', (event) => { event.stopPropagation(); duplicateSelectedTrack() })
  app.querySelector('[data-toggle-global-tracks]')?.addEventListener('click', (event) => { event.stopPropagation(); globalTracks.visible = !globalTracks.visible; trackMenuState = null; scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-global-track-view]')?.addEventListener('change', (event) => { globalTracks.viewMode = event.target.value || 'all'; scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-global-signature-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    if (!globalTrackPopover?.id) return
    const eventId = globalTrackPopover.id
    const events = normalizeSignatureEvents(projectState).filter((item)=>item.id !== 'signature-default')
    const existing = events.find((item)=>item.id===eventId)
    const next = existing || { id: eventId, beat: globalTrackPopover.beat || 0 }
    next.key = app.querySelector('[data-global-signature-key]')?.value || 'C'
    next.scale = app.querySelector('[data-global-signature-scale]')?.value || 'major'
    next.timeSignature = app.querySelector('[data-global-signature-time]')?.value || '4/4'
    if (!existing) events.push(next)
    globalTracks.signatureEvents = events.sort((a,b)=>a.beat-b.beat)
    globalTrackPopover = null
    scheduleEditorSave()
    renderEditor()
  })
  app.querySelectorAll('[data-global-arrangement]').forEach((button)=>button.addEventListener('dblclick', (event)=>{ event.preventDefault(); event.stopPropagation(); renameGlobalArrangement(button.dataset.globalArrangement) }))
  app.querySelectorAll('[data-global-marker]').forEach((button)=>button.addEventListener('dblclick', (event)=>{ event.preventDefault(); event.stopPropagation(); renameGlobalMarker(button.dataset.globalMarker) }))
  app.querySelectorAll('[data-global-signature]').forEach((button)=>button.addEventListener('dblclick', (event)=>{
    event.preventDefault()
    event.stopPropagation()
    const item = normalizeSignatureEvents(projectState).find((signature)=>signature.id===button.dataset.globalSignature)
    if (item) openSignatureEditor(event, item)
  }))
  app.querySelectorAll('[data-global-tempo]').forEach((button)=>button.addEventListener('pointerdown', (event)=>{
    event.preventDefault()
    event.stopPropagation()
    let item = normalizeTempoEvents().find((tempo)=>tempo.id===button.dataset.globalTempo)
    if (!item) return
    if (item.id === 'tempo-default') {
      item = { ...item, id: makeInsertId('tempo') }
      globalTracks.tempoEvents = [item]
    }
    globalTrackDrag = { type: 'tempo', id: item.id, startBeat: item.beat, currentBeat: item.beat, bpm: item.bpm }
    document.body.classList.add('is-studio-dragging')
  }))
  app.querySelectorAll('[data-global-row]').forEach((row)=> {
    row.addEventListener('pointerdown', (event)=> {
      if (event.target.closest('button')) return
      if (row.dataset.globalRow !== 'arrangement') return
      event.preventDefault()
      const beat = beatFromGlobalEvent(event)
      globalTrackDrag = { type: 'arrangement', startBeat: beat, currentBeat: beat }
      document.body.classList.add('is-studio-dragging')
      renderEditor()
    })
    row.addEventListener('dblclick', (event)=> {
      if (event.target.closest('button')) return
      event.preventDefault()
      const beat = beatFromGlobalEvent(event)
      if (row.dataset.globalRow === 'markers') {
        globalTracks.markers.push({ id: makeInsertId('marker'), beat, label: 'Marker' })
        scheduleEditorSave()
        renderEditor()
      } else if (row.dataset.globalRow === 'tempo') {
        globalTracks.tempoEvents = [...normalizeTempoEvents().filter((item)=>item.id !== 'tempo-default'), { id: makeInsertId('tempo'), beat, bpm: Number(projectState?.bpm || 140) }].sort((a,b)=>a.beat-b.beat)
        scheduleEditorSave()
        renderEditor()
      } else if (row.dataset.globalRow === 'signature') {
        openSignatureEditor(event)
      }
    })
  })
  app.querySelector('[data-track-rename-form]')?.addEventListener('submit', (event) => { event.preventDefault(); renameSelectedTrack(app.querySelector('[data-track-rename-input]')?.value || '') })
  app.querySelector('[data-track-rename-cancel]')?.addEventListener('click', (event) => { event.preventDefault(); renameTrackState = null; renderEditor() })
  app.querySelector('[data-track-color-form]')?.addEventListener('submit', (event) => { event.preventDefault(); setSelectedTrackColor(app.querySelector('[data-track-color-input]')?.value || '') })
  app.querySelector('[data-track-color-input]')?.addEventListener('input', (event) => { setSelectedTrackColor(event.target.value, { close: false }) })
  app.querySelectorAll('[data-track-context-action]').forEach((button) => button.addEventListener('click', (event) => {
    event.stopPropagation()
    const action = button.dataset.trackContextAction
    const menuPos = trackMenuState ? { x: trackMenuState.x, y: trackMenuState.y } : getClampedTrackMenuPosition(event.clientX, event.clientY)
    trackMenuState = null
    if (action === 'duplicate') duplicateSelectedTrack()
    else if (action === 'delete') deleteSelectedTrack()
    else if (action === 'color') { const track = getSelectedTrack(); colorPickerState = { ...menuPos, trackId: selectedTrackId, color: track?.color || '#58d4ff' }; renderEditor() }
    else if (action === 'inspector') { activeLeftPanel = 'inspector'; inspectorMenu = null; renderEditor() }
    else if (action === 'rename') { const track = getSelectedTrack(); renameTrackState = { ...menuPos, trackId: selectedTrackId, name: track?.name || '' }; activeLeftPanel = 'inspector'; renderEditor(); requestAnimationFrame(()=>app.querySelector('[data-track-rename-input]')?.select?.()) }
  }))
  app.querySelectorAll('[data-track-pan]').forEach((knob) => {
    knob.addEventListener('pointerdown', (event) => { if (event.detail > 1) return; event.preventDefault(); event.stopPropagation(); const t = getTrack(knob.dataset.trackPan); if (!t) return; panDrag = { trackId: t.id, startX: event.clientX, startPan: t.pan, knob }; knob.setPointerCapture?.(event.pointerId) })
    knob.addEventListener('dblclick', (event) => {
      const track = getTrack(knob.dataset.trackPan)
      if (!track) return
      panDrag = null
      openInlineNumericEditor(event, { label: 'Pan', value: track.pan, min: -100, max: 100, step: 1, apply: (value) => { setTrackPan(track, value, { save: true }); renderEditor() } })
    })
  })
  app.querySelectorAll('[data-midi]').forEach((key) => {
    const midi = Number(key.dataset.midi)
    const stop = () => stopTrackMidiNote(getSelectedTrack(), midi)
    key.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      event.stopImmediatePropagation()
      playTrackMidiNote(getSelectedTrack(), midi, 0.85)
    })
    key.addEventListener('pointerup', (event) => { event.stopImmediatePropagation(); stop() })
    key.addEventListener('pointerleave', (event) => { event.stopImmediatePropagation(); stop() })
  })
  app.querySelector('[data-octave-down]')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const bounds = getInstrumentOctaveBounds()
    instrumentOctaveOffset = Math.max(Math.min(bounds.min, 0), instrumentOctaveOffset - 1)
    stopAllTrackInstrumentNotes()
    renderEditor()
  })
  app.querySelector('[data-octave-up]')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const bounds = getInstrumentOctaveBounds()
    instrumentOctaveOffset = Math.min(Math.max(bounds.max, 0), instrumentOctaveOffset + 1)
    stopAllTrackInstrumentNotes()
    renderEditor()
  })
  app.querySelector('[data-instrument-knob="pan"]')?.addEventListener('input', (event) => {
    event.stopImmediatePropagation()
    const track = getSelectedTrack()
    const value = clamp(Number(event.target.value), -100, 100)
    instrumentPan = value / 100
    setTrackPan(track, value)
    const dial = app.querySelector('[data-instrument-knob-dial="pan"]')
    const valueEl = app.querySelector('[data-instrument-knob-value="pan"]')
    dial?.style.setProperty('--knob-angle', `${-135 + ((value + 100) / 200) * 270}deg`)
    if (valueEl) valueEl.textContent = String(Math.round(value))
  })
  app.querySelector('[data-instrument-knob="volume"]')?.addEventListener('input', (event) => {
    event.stopImmediatePropagation()
    const track = getSelectedTrack()
    const value = clamp(Number(event.target.value), 0, 1)
    instrumentVolume = value
    if (track) {
      track.volume = Math.round(value * 100)
      syncSelectedTrackVolumeControl(track)
      const channel = trackAudioChannels.get(track.id)
      if (channel?.input && audioContext) channel.input.gain.setTargetAtTime(value, audioContext.currentTime, 0.015)
    }
    const dial = app.querySelector('[data-instrument-knob-dial="volume"]')
    const valueEl = app.querySelector('[data-instrument-knob-value="volume"]')
    dial?.style.setProperty('--knob-angle', `${-135 + (value * 270)}deg`)
    if (valueEl) valueEl.textContent = `${Math.round(value * 100)}%`
  })
  app.querySelector('[data-instrument-knob="pan"]')?.addEventListener('change', (event) => {
    event.stopImmediatePropagation()
    scheduleEditorSave()
  })
  app.querySelector('[data-instrument-knob="pan"]')?.addEventListener('pointerdown', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    const input = event.currentTarget
    const startY = event.clientY
    const startValue = Number(input.value)
    const onMove = (moveEvent) => {
      input.value = String(clamp(startValue - ((moveEvent.clientY - startY) * 0.8), -100, 100))
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      scheduleEditorSave()
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp, { once: true })
  })
  app.querySelectorAll('[data-instrument-knob-dial]').forEach((dial) => dial.addEventListener('dblclick', (event) => {
    const key = dial.dataset.instrumentKnobDial
    const track = getSelectedTrack()
    if (!track || !['volume', 'pan'].includes(key)) return
    const config = key === 'volume'
      ? { label: 'Volume', value: track.volume, min: 0, max: 100 }
      : { label: 'Pan', value: track.pan, min: -100, max: 100 }
    openInlineNumericEditor(event, {
      ...config,
      step: 1,
      apply: (value) => {
        if (key === 'volume') {
          track.volume = value
          const channel = trackAudioChannels.get(track.id)
          if (channel?.input && audioContext) channel.input.gain.setTargetAtTime(value / 100, audioContext.currentTime, 0.015)
        } else {
          setTrackPan(track, value)
        }
        scheduleEditorSave()
        renderEditor()
      }
    })
  }))
  grid?.addEventListener('scroll', () => { if (ruler) ruler.scrollLeft = grid.scrollLeft })
  const getRulerLocalX = (event) => { const rect = ruler.getBoundingClientRect(); return clamp(event.clientX - rect.left + ruler.scrollLeft, 0, maxTimelineX()) }
  const applyCycleRange = (start, end) => { const minW = cycleMinWidth(); const min = Math.min(start, end); const max = Math.max(start, end); let s = clamp(isSnapEnabled ? snapXToBeat(min) : min, timelineStartX(), maxTimelineX()); let e = clamp(isSnapEnabled ? snapXToBeat(max) : max, timelineStartX(), maxTimelineX()); if (e - s < minW) e = clamp(s + minW, s + minW, maxTimelineX()); cycleRange = { startX: s, endX: e } }

  const extensionLane = app.querySelector('[data-timeline-extension-lane]')
  const extensionInner = app.querySelector('[data-timeline-extension-inner]')
  let extensionDrag = null
  let didMovePlayhead = false
  let didCycleChange = false
  const syncTimelineScroll = (source = null) => { const scrollLeft = source?.scrollLeft ?? grid?.scrollLeft ?? 0; const liveGlobalLane = app.querySelector('[data-global-tracks]'); if (grid && grid !== source) grid.scrollLeft = scrollLeft; if (ruler && ruler !== source) ruler.scrollLeft = scrollLeft; if (liveGlobalLane && liveGlobalLane !== source) liveGlobalLane.scrollLeft = scrollLeft; if (extensionLane && extensionLane !== source) extensionLane.scrollLeft = scrollLeft }
  const updateTimelineRulerDom = () => { const rulerInner = app.querySelector('[data-timeline-ruler-inner]'); if (!rulerInner) return; const cycleStrip = rulerInner.querySelector('[data-cycle-strip]'); if (!cycleStrip) return; rulerInner.innerHTML = `<div class="studio-cycle-strip" data-cycle-strip>${renderCycleRange()}</div><span class="studio-negative-zone studio-negative-zone--ruler" style="width:${barZeroX()}px"></span>${renderTimelineRuler()}<span class="studio-ruler-playhead" data-ruler-playhead></span>` }
  const updateTimelineGridLinesDom = () => { const gridInner = app.querySelector('[data-arrangement-grid-inner]'); if (!gridInner) return; const selection = gridInner.querySelector('[data-selection-box]'); const selectionMarkup = '<div class="studio-selection-box" data-selection-box hidden></div>'; const selectionHtml = selection ? selection.outerHTML : selectionMarkup; gridInner.innerHTML = `<span class="studio-negative-zone studio-negative-zone--grid" style="width:${barZeroX()}px"></span>${renderTimelineLines()}${renderTimelineRegions()}${renderCycleBoundaryGuides()}<span class="studio-grid-playhead" data-grid-playhead></span>${selectionHtml}` }
  const updateGlobalTrackLaneDom = () => { const lane = app.querySelector('[data-global-tracks]'); if (!lane) return; const wrap = document.createElement('div'); wrap.innerHTML = renderGlobalTrackLane().trim(); const next = wrap.firstElementChild; if (next) lane.replaceWith(next) }
  const applyTimelineGeometry = () => { syncBarsFromPositiveBeats(); app.querySelector('[data-arrangement]')?.style.setProperty('--bars', timelineState.bars); app.querySelector('[data-arrangement]')?.style.setProperty('--pixels-per-bar', `${timelineState.pixelsPerBar}px`); app.querySelector('[data-arrangement]')?.style.setProperty('--pixels-per-beat', `${timelineState.pixelsPerBar / timelineState.beatsPerBar}px`); app.querySelector('[data-arrangement]')?.style.setProperty('--timeline-content-width', `${timelineContentWidth()}px`); clampTimelineSystems(); updateCycleDomFromState(); setPlayhead(timelineState.playheadX) }
  let timelineVisualRefreshRaf = 0
  const refreshTimelineVisualsLive = () => { applyTimelineGeometry(); updateTimelineRulerDom(); updateTimelineGridLinesDom(); updateGlobalTrackLaneDom(); updateCycleDomFromState(); updateTransportDisplay(); syncTimelineScroll() }
  const scheduleTimelineVisualRefresh = () => { if (timelineVisualRefreshRaf) return; timelineVisualRefreshRaf = requestAnimationFrame(() => { timelineVisualRefreshRaf = 0; refreshTimelineVisualsLive() }) }
  const updateTrackHeightDom = () => { const page = app.querySelector('.studio-editor-page'); if (page) page.style.setProperty('--studio-track-height', `${timelineState.trackHeight}px`); const compact = timelineState.trackHeight <= 56; app.querySelectorAll('[data-track-row]').forEach((row)=>row.classList.toggle('is-track-compact', compact)); }
  const isPinnedRight = () => !!grid && (grid.scrollLeft + grid.clientWidth >= grid.scrollWidth - 4)
  grid?.addEventListener('wheel', (event) => { if (isTextEntryTarget(event.target)) return; const overTimeline = event.target.closest('[data-arrangement-grid], [data-timeline-ruler], [data-timeline-extension-lane], [data-arrangement]'); const overTrackZone = event.target.closest('[data-arrangement-grid], .studio-track-panel, .studio-editor-workspace'); if ((event.ctrlKey || event.metaKey) && overTimeline) { event.preventDefault(); const rect = grid.getBoundingClientRect(); const mouseX = event.clientX - rect.left; const oldTimelineX = grid.scrollLeft + mouseX; const anchorBeat = xToBeatsFromBarZero(oldTimelineX); let playheadBeat = xToBeatsFromBarZero(timelineState.playheadX); if (isSnapEnabled) playheadBeat = snapBeatToGrid(playheadBeat); const cycleBeats = cycleRange ? { start: xToBeatsFromBarZero(cycleRange.startX), end: xToBeatsFromBarZero(cycleRange.endX) } : null; const direction = event.deltaY < 0 ? 1 : -1; const zoomFactor = direction > 0 ? 1.08 : 1 / 1.08; timelineState.pixelsPerBar = clamp(timelineState.pixelsPerBar * zoomFactor, 60, 360); timelineState.playheadX = beatsFromBarZeroToX(playheadBeat); if (cycleBeats) { let startBeat = cycleBeats.start; let endBeat = cycleBeats.end; if (isSnapEnabled) { startBeat = snapBeatToGrid(startBeat); endBeat = snapBeatToGrid(endBeat) } cycleRange = { startX: beatsFromBarZeroToX(startBeat), endX: beatsFromBarZeroToX(endBeat) } } refreshTimelineVisualsLive(); const newTimelineX = beatsFromBarZeroToX(anchorBeat); grid.scrollLeft = clamp(newTimelineX - mouseX, 0, Math.max(0, timelineContentWidth() - grid.clientWidth)); syncTimelineScroll(); scheduleEditorSave(); return }
    if (event.altKey && overTrackZone) { event.preventDefault(); timelineState.trackHeight = clamp(timelineState.trackHeight + (event.deltaY < 0 ? 6 : -6), 44, 220); updateTrackHeightDom(); scheduleTimelineVisualRefresh(); scheduleEditorSave(); return }
    if (event.shiftKey && overTimeline) { event.preventDefault(); grid.scrollLeft = clamp(grid.scrollLeft + event.deltaY, 0, Math.max(0, grid.scrollWidth - grid.clientWidth)); syncTimelineScroll() }
  }, { passive:false })
  grid?.addEventListener('scroll', () => syncTimelineScroll(grid), { passive:true })
  ruler?.addEventListener('scroll', () => syncTimelineScroll(ruler), { passive:true })
  app.querySelector('[data-global-tracks]')?.addEventListener('scroll', (event) => syncTimelineScroll(event.currentTarget), { passive:true })
  extensionLane?.addEventListener('scroll', () => syncTimelineScroll(extensionLane), { passive:true })
  app.querySelectorAll('[data-timeline-extension-handle]').forEach((el)=>el.addEventListener('pointerdown',(event)=>{ event.preventDefault(); const pinRight = isPinnedRight(); extensionDrag={ side:el.dataset.timelineExtensionHandle, startX:event.clientX, startPositiveBeats:timelineState.positiveBeats, startPre:timelineState.preStartPixels, startPlayheadBeats:xToBeatsFromBarOne(timelineState.playheadX), startCycleBeats:cycleRange?{start:xToBeatsFromBarOne(cycleRange.startX),end:xToBeatsFromBarOne(cycleRange.endX)}:null, scrollLeft:grid?.scrollLeft||0, pinRight }; document.body.classList.add('is-studio-dragging') }))
  ruler?.addEventListener('pointerdown', (event) => { const cycleHandle = event.target.closest('[data-cycle-handle]'); const cycleMove = event.target.closest('[data-cycle-drag]'); const inCycleStrip = isCycleStripPointerEvent(event, ruler); if (cycleHandle && cycleRange) { event.preventDefault(); setCycleEnabled(true); const x = getRulerLocalX(event); cycleDrag = { mode: cycleHandle.dataset.cycleHandle === 'start' ? 'resize-start' : 'resize-end', fixedX: cycleHandle.dataset.cycleHandle === 'start' ? cycleRange.endX : cycleRange.startX }; return } if (cycleMove && cycleRange) { event.preventDefault(); setCycleEnabled(true); const x = getRulerLocalX(event); cycleDrag = { mode: 'move', startPointerX: x, startRange: { ...cycleRange } }; return } if (inCycleStrip) { event.preventDefault(); const x = getRulerLocalX(event); setCycleEnabled(true); cycleDrag = { mode: 'create', anchorX: x }; applyCycleRange(x, x + beatWidth()); document.body.classList.add('is-studio-dragging'); return } event.preventDefault(); timelineState.isDraggingPlayhead = true; setPlayhead(snapXToBeat(getRulerLocalX(event))); scheduleEditorSave() })
  grid?.addEventListener('pointerdown', (event) => { if (event.target.closest('[data-midi-region]')) return; if (event.target !== grid && !event.target.closest('[data-arrangement-grid-inner]')) return; event.preventDefault(); selectedMidiRegionId = ''; midiRollSelectedNoteIndex = null; app.querySelectorAll('[data-midi-region].is-selected').forEach((node)=>node.classList.remove('is-selected')); timelineState.isSelecting = true; const rect = grid.getBoundingClientRect(); timelineState.selectionBox = { startX: event.clientX - rect.left + grid.scrollLeft, startY: event.clientY - rect.top + grid.scrollTop }; if (selectionBox) { selectionBox.style.width='0px'; selectionBox.style.height='0px'; selectionBox.style.left=`${timelineState.selectionBox.startX}px`; selectionBox.style.top=`${timelineState.selectionBox.startY}px`; selectionBox.hidden = false } })
	  window.addEventListener('pointermove', (event) => { if (panDrag) { const t=getTrack(panDrag.trackId); if (t) setTrackPan(t, panDrag.startPan + (event.clientX-panDrag.startX)) } if (cycleDrag) { event.preventDefault(); const x = getRulerLocalX(event); if (cycleDrag.mode === 'create') { applyCycleRange(cycleDrag.anchorX, x) } else if (cycleDrag.mode === 'move' && cycleDrag.startRange) { const rawDx = x - cycleDrag.startPointerX; const width = cycleDrag.startRange.endX - cycleDrag.startRange.startX; let start = cycleDrag.startRange.startX + rawDx; let end = start + width; if (isSnapEnabled) { start = snapXToBeat(start); end = start + width } start = clamp(start, timelineState.preStartPixels, maxTimelineX() - width); applyCycleRange(start, start + width) } else if (cycleDrag.mode === 'resize-start') { const end = cycleDrag.fixedX; const start = Math.min(x, end - beatWidth()); cycleRange = { startX: clamp(snapXToBeat(start), timelineState.preStartPixels, maxTimelineX()-beatWidth()), endX: end } } else if (cycleDrag.mode === 'resize-end') { const start = cycleDrag.fixedX; const end = Math.max(x, start + beatWidth()); cycleRange = { startX: start, endX: clamp(snapXToBeat(end), start + beatWidth(), maxTimelineX()) } } didCycleChange = true; updateCycleDomFromState(); return } if (extensionDrag) { const dx = event.clientX - extensionDrag.startX; if (extensionDrag.side === 'right') { const rawBeats = extensionDrag.startPositiveBeats + (dx / beatWidth()); timelineState.positiveBeats = clamp(Math.round(rawBeats), timelineState.beatsPerBar, 800); } else { const snappedPre = Math.round((extensionDrag.startPre - dx) / beatWidth()) * beatWidth(); timelineState.preStartPixels = clamp(snappedPre, 0, timelineState.pixelsPerBar * 10); timelineState.playheadX = beatsFromBarOneToX(extensionDrag.startPlayheadBeats); if (extensionDrag.startCycleBeats) cycleRange = { startX: beatsFromBarOneToX(extensionDrag.startCycleBeats.start), endX: beatsFromBarOneToX(extensionDrag.startCycleBeats.end) }; } scheduleTimelineVisualRefresh(); if (grid) { grid.scrollLeft = extensionDrag.side==='right' ? Math.max(0, grid.scrollWidth-grid.clientWidth) : extensionDrag.scrollLeft; syncTimelineScroll() } return } if (timelineState.isDraggingPlayhead) { event.preventDefault(); if (grid) { const rect = grid.getBoundingClientRect(); if (event.clientX > rect.right - 40) grid.scrollLeft = Math.min(grid.scrollWidth - grid.clientWidth, grid.scrollLeft + 20); else if (event.clientX < rect.left + 40) grid.scrollLeft = Math.max(0, grid.scrollLeft - 20); if (ruler) ruler.scrollLeft = grid.scrollLeft } didMovePlayhead = true; setPlayhead(snapXToBeat(getRulerLocalX(event))); } if (timelineState.isSelecting && selectionBox && grid) { event.preventDefault(); const rect = grid.getBoundingClientRect(); const x = event.clientX - rect.left + grid.scrollLeft; const y = event.clientY - rect.top + grid.scrollTop; const sx = timelineState.selectionBox.startX; const sy = timelineState.selectionBox.startY; selectionBox.style.left = `${Math.min(sx, x)}px`; selectionBox.style.top = `${Math.min(sy, y)}px`; selectionBox.style.width = `${Math.abs(x - sx)}px`; selectionBox.style.height = `${Math.abs(y - sy)}px`; } })
	  window.addEventListener('pointerup', () => { const hadCycle = !!cycleDrag || didCycleChange; const hadPlayhead = timelineState.isDraggingPlayhead || didMovePlayhead; const hadExtension = !!extensionDrag; const hadPan = !!panDrag; panDrag = null; cycleDrag = null; extensionDrag = null; didCycleChange = false; didMovePlayhead = false; document.body.classList.remove('is-studio-dragging'); timelineState.isDraggingPlayhead = false; timelineState.isSelecting = false; if (selectionBox) selectionBox.hidden = true; if (hadCycle || hadPlayhead || hadExtension || hadPan) scheduleEditorSave() })
  window.addEventListener('pointermove', (event) => {
    if (bottomPanelResizeDrag) {
      event.preventDefault()
      const maxHeight = Math.max(260, window.innerHeight - 120)
      const nextHeight = clamp(bottomPanelResizeDrag.startHeight + (bottomPanelResizeDrag.startY - event.clientY), 220, maxHeight)
      bottomPanelHeightPx = Math.round(nextHeight)
      bottomPanelResizeDrag.panel?.style.setProperty('height', `${bottomPanelHeightPx}px`)
      return
    }
    if (midiRollSelectionDrag) {
      event.preventDefault()
      updateMidiRollSelectionDrag(event)
      return
    }
    if (midiNoteDrag) {
      event.preventDefault()
      applyMidiNoteDrag(event)
      return
    }
    if (midiRegionDrag) {
      event.preventDefault()
      applyMidiRegionDrag(event)
      return
    }
    if (!globalTrackDrag) return
    event.preventDefault()
    globalTrackDrag.currentBeat = beatFromGlobalEvent(event)
    if (globalTrackDrag.type === 'tempo') {
      const row = app.querySelector('.studio-global-row--tempo')
      const rect = row?.getBoundingClientRect?.()
      const y = rect ? clamp(event.clientY - rect.top, 4, Math.max(8, rect.height - 4)) : 20
      const ratio = rect ? 1 - (y / Math.max(1, rect.height)) : 0.5
      globalTrackDrag.bpm = Math.round(clamp(20 + ratio * 280, 20, 300))
      globalTracks.tempoEvents = normalizeTempoEvents().map((item)=>item.id===globalTrackDrag.id ? { ...item, beat: globalTrackDrag.currentBeat, bpm: globalTrackDrag.bpm } : item).filter((item)=>item.id !== 'tempo-default').sort((a,b)=>a.beat-b.beat)
    }
    updateGlobalTrackLaneDom()
  })
  window.addEventListener('pointerup', () => {
    if (bottomPanelResizeDrag) {
      bottomPanelResizeDrag = null
      document.body.classList.remove('is-studio-dragging', 'is-bottom-panel-resizing')
      return
    }
    if (midiRollSelectionDrag) {
      finishMidiRollSelection()
      return
    }
    if (midiNoteDrag) {
      finishMidiNoteDrag()
      return
    }
    if (midiRegionDrag) {
      finishMidiRegionDrag()
      return
    }
    if (!globalTrackDrag) return
    const drag = globalTrackDrag
    globalTrackDrag = null
    document.body.classList.remove('is-studio-dragging')
    if (drag.type === 'arrangement') {
      const startBeat = Math.min(drag.startBeat, drag.currentBeat)
      const endBeat = Math.max(drag.startBeat, drag.currentBeat)
      if (endBeat - startBeat >= 0.25) {
        globalTracks.arrangement.push({ id: makeInsertId('section'), startBeat, endBeat, label: 'Section', color: '#3a8bff' })
      }
    }
    scheduleEditorSave()
    renderEditor()
  })
  app.querySelector('[data-transport-play]')?.addEventListener('click', (e)=>{ e.stopPropagation(); if (activeRecording || isCountInRunning) return; togglePlayback() })
  app.querySelector('[data-transport-stop]')?.addEventListener('click', (e)=>{ e.stopPropagation(); if (activeRecording || isCountInRunning) { stopRecordingAndKeep(); return } finalizeMidiRecording(); stopAllTrackInstrumentNotes(); stopPlayback(); recordingStatus = '' ; renderEditor() })
  app.querySelector('[data-transport-start]')?.addEventListener('click', (e)=>{ e.stopPropagation(); if (activeRecording || isCountInRunning) return; setPlayhead(barZeroX()); scheduleEditorSave() })
  app.querySelector('[data-transport-end]')?.addEventListener('click', (e)=>{ e.stopPropagation(); if (activeRecording || isCountInRunning) return; setPlayhead(maxTimelineX()); scheduleEditorSave() })
  app.querySelector('[data-transport-rewind]')?.addEventListener('click', (e)=>{ e.stopPropagation(); if (activeRecording || isCountInRunning) return; setPlayhead(timelineState.playheadX - (timelineState.pixelsPerBar / timelineState.beatsPerBar)); scheduleEditorSave() })
  app.querySelector('[data-transport-forward]')?.addEventListener('click', (e)=>{ e.stopPropagation(); if (activeRecording || isCountInRunning) return; setPlayhead(timelineState.playheadX + (timelineState.pixelsPerBar / timelineState.beatsPerBar)); scheduleEditorSave() })
  app.querySelector('[data-transport-record]')?.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopImmediatePropagation()
    if (activeRecording || isCountInRunning) stopRecordingAndKeep()
    else startMidiRecordFlow()
  }, { capture: true })
  app.querySelector('.studio-notes-panel')?.addEventListener('pointerdown',(e)=>e.stopPropagation()); app.querySelector('[data-notes-input]')?.addEventListener('pointerdown',(e)=>e.stopPropagation()); app.querySelectorAll('[data-notes-page],[data-add-notes-page],[data-save-notes],[data-close-notes]').forEach((el)=>el.addEventListener('pointerdown',(e)=>e.stopPropagation())); app.querySelectorAll('[data-left-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.leftPanel; activeLeftPanel = activeLeftPanel===id ? '' : id; renderEditor(); if(activeLeftPanel==='library') loadStudioLibrary() })); app.querySelector('[data-toggle-snap]')?.addEventListener('click',()=>{ isSnapEnabled=!isSnapEnabled; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-count-in]')?.addEventListener('click',()=>{ isCountInEnabled=!isCountInEnabled; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-transport-record]')?.addEventListener('click',()=>{ if (activeRecording || isCountInRunning) { finalizeMidiRecording(); stopAllTrackInstrumentNotes(); stopPlayback(); renderEditor(); return } startMidiRecordFlow() }); app.querySelector('[data-open-notes]')?.addEventListener('click',()=>{ isNotesOpen=true; renderEditor() }); app.querySelector('[data-close-notes]')?.addEventListener('click',()=>{ stashActiveNoteInput(); scheduleEditorSave(); isNotesOpen=false; renderEditor() }); app.querySelector('[data-save-notes]')?.addEventListener('click',()=>{ stashActiveNoteInput(); scheduleEditorSave(); isNotesOpen=false; renderEditor() }); app.querySelectorAll('[data-notes-page]').forEach((el)=>el.addEventListener('click',()=>{ stashActiveNoteInput(); activeNotePageId = el.dataset.notesPage; scheduleEditorSave(); renderEditor() })); app.querySelector('[data-add-notes-page]')?.addEventListener('click',()=>{ stashActiveNoteInput(); const pageNumber = notePages.length + 1; const id = `page-${pageNumber}`; notePages = [...notePages, { id, title: `Page ${pageNumber}`, body: '' }]; activeNotePageId = id; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-follow-playhead]')?.addEventListener('click',()=>{ followPlayhead=!followPlayhead; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-metronome]')?.addEventListener('click',()=>{ isMetronomeEnabled=!isMetronomeEnabled; if(isMetronomeEnabled) getAudioContext(); scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-cycle]')?.addEventListener('click',()=>{ setCycleEnabled(!isCycleEnabled); scheduleEditorSave(); renderEditor() }); app.querySelectorAll('[data-bottom-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.bottomPanel; if(!id) return; openBottomPanel(id) })); app.querySelectorAll('[data-instrument-subpage]').forEach((el)=>{ el.addEventListener('click',(event)=>{ event.stopPropagation(); const next=el.dataset.instrumentSubpage; if(!next||activeInstrumentSubpage===next) return; if(activeInstrumentSubpage==='keyboard'&&next!=='keyboard') stopAllTrackInstrumentNotes(); activeInstrumentSubpage=next; renderEditor() }) })
  app.querySelectorAll('[data-library-folder]').forEach((button)=>button.addEventListener('click',(event)=>{
    const toggle = event.target.closest('[data-library-folder-toggle]')
    if (toggle) {
      const id = toggle.dataset.libraryFolderToggle || ''
      const expanded = new Set(studioLibraryState.expandedRootIds)
      if (expanded.has(id)) expanded.delete(id)
      else expanded.add(id)
      studioLibraryState.expandedRootIds = expanded
    }
    studioLibraryState.selectedPath = button.dataset.libraryFolder || ''
    studioLibraryState.selectedInstrumentId = ''
    renderEditor()
  }))
  app.querySelectorAll('[data-library-instrument]').forEach((button)=>button.addEventListener('click',()=>{
    assignStudioLibraryInstrument(button.dataset.libraryInstrument || '')
  }))
  app.querySelector('[data-library-retry]')?.addEventListener('click',()=>{
    studioLibraryState.loaded = false
    loadStudioLibrary({ force:true })
  })
  app.querySelectorAll('[data-midi]').forEach((key)=>{ const midi=Number(key.dataset.midi); key.addEventListener('pointerdown',(e)=>{ e.preventDefault(); const track=getSelectedTrack(); playTrackMidiNote(track, midi+(instrumentOctaveOffset*12), 0.85) }); key.addEventListener('pointerup',()=>{ const track=getSelectedTrack(); stopTrackMidiNote(track, midi+(instrumentOctaveOffset*12)) }); key.addEventListener('pointerleave',()=>{ const track=getSelectedTrack(); stopTrackMidiNote(track, midi+(instrumentOctaveOffset*12)) }) }); app.querySelector('[data-typing-piano-toggle]')?.addEventListener('click',()=>{ setMusicalTypingEnabled(!isTypingPianoEnabled); renderEditor() }); app.querySelector('[data-sustain-toggle]')?.addEventListener('click',()=>{ isSustainEnabled=!isSustainEnabled; if(!isSustainEnabled) stopAllTrackInstrumentNotes(); renderEditor() }); app.querySelector('[data-octave-down]')?.addEventListener('click',()=>{ instrumentOctaveOffset=Math.max(-2,instrumentOctaveOffset-1); stopAllTrackInstrumentNotes(); renderEditor() }); app.querySelector('[data-octave-up]')?.addEventListener('click',()=>{ instrumentOctaveOffset=Math.min(2,instrumentOctaveOffset+1); stopAllTrackInstrumentNotes(); renderEditor() }); bindMidiRegionEvents(); app.querySelectorAll('[data-instrument-knob]').forEach((input)=>{ input.addEventListener('input',(e)=>{ const knob=e.target.dataset.instrumentKnob; const value=Number(e.target.value); const selected=getSelectedTrack(); if(knob==='volume'){ instrumentVolume=value; if(selected){ selected.volume=Math.round(value*100); syncSelectedTrackVolumeControl(selected); if(selected.instrument?.pluginInstanceId) dawInstrumentRegistry.setParam(selected.instrument.pluginInstanceId, 'volume', value) } if(instrumentMasterGain&&instrumentAudioContext) instrumentMasterGain.gain.setValueAtTime(instrumentVolume,instrumentAudioContext.currentTime) } else if(knob==='pan'){ instrumentPan=value; if(selected) selected.pan=value; if(instrumentPanNode&&instrumentAudioContext) instrumentPanNode.pan.setValueAtTime(instrumentPan,instrumentAudioContext.currentTime); app.querySelector(`[data-track-pan="${selected?.id}"]`)?.style.setProperty('--pan-angle', `${value * 135}deg`) } const dial=app.querySelector(`[data-instrument-knob-dial="${knob}"]`); const valueEl=app.querySelector(`[data-instrument-knob-value="${knob}"]`); if(dial) dial.style.setProperty('--knob-angle',`${-135 + ((value-Number(e.target.min))/(Number(e.target.max)-Number(e.target.min)))*270}deg`); if(valueEl) valueEl.textContent = knob==='pan' ? value.toFixed(2) : `${Math.round(value*100)}%` }); input.addEventListener('change',()=>scheduleEditorSave()); input.addEventListener('pointerdown',(event)=>{ event.preventDefault(); const startY=event.clientY; const startValue=Number(input.value); const min=Number(input.min); const max=Number(input.max); const speed = input.dataset.instrumentKnob==='pan' ? 0.004 : 0.002; const onMove=(ev)=>{ const delta=-(ev.clientY-startY)*speed; const next=clamp(startValue+delta,min,max); input.value=String(next); input.dispatchEvent(new Event('input',{bubbles:true})) }; const onUp=()=>{ window.removeEventListener('pointermove',onMove); window.removeEventListener('pointerup',onUp); scheduleEditorSave() }; window.addEventListener('pointermove',onMove); window.addEventListener('pointerup',onUp,{once:true}) }) }); app.querySelectorAll('[data-preset-load]').forEach((button)=>{ button.addEventListener('click',(event)=>{ event.stopPropagation(); const preset=instrumentPresetItems.find((item)=>item.id===button.dataset.presetLoad); if(!preset) return; selectedInstrumentName=preset.name; renderEditor() }) }); app.querySelector('[data-arp-toggle]')?.addEventListener('click',()=>{ arpEnabled=!arpEnabled; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-mode]')?.addEventListener('change',(e)=>{ arpMode=e.target.value; scheduleEditorSave() }); app.querySelector('[data-arp-rate]')?.addEventListener('change',(e)=>{ arpRate=e.target.value; scheduleEditorSave() }); app.querySelector('[data-arp-length]')?.addEventListener('change',(e)=>{ arpLength=Number(e.target.value)||16; if(selectedArpStepIndex>=arpLength) selectedArpStepIndex=arpLength-1; renderEditor(); scheduleEditorSave() }); app.querySelectorAll('[data-arp-octave]').forEach((btn)=>btn.addEventListener('click',()=>{ const d=Number(btn.dataset.arpOctave||0); arpOctaves=clamp(arpOctaves+d,1,4); renderEditor(); scheduleEditorSave() })); app.querySelector('[data-arp-gate]')?.addEventListener('input',(e)=>{ arpGate=Number(e.target.value); e.target.nextElementSibling.textContent=`${arpGate}%` }); app.querySelector('[data-arp-swing]')?.addEventListener('input',(e)=>{ arpSwing=Number(e.target.value); e.target.nextElementSibling.textContent=`${arpSwing}%` }); app.querySelector('[data-arp-velocity]')?.addEventListener('input',(e)=>{ arpVelocity=Number(e.target.value); e.target.nextElementSibling.textContent=String(arpVelocity) }); app.querySelectorAll('[data-arp-gate],[data-arp-swing],[data-arp-velocity]').forEach((el)=>el.addEventListener('change',()=>scheduleEditorSave())); app.querySelectorAll('[data-arp-edit-mode]').forEach((button)=>{ button.addEventListener('click',()=>{ const next=button.dataset.arpEditMode; if(!next||arpEditMode===next) return; arpEditMode=next; if(next!=='note') arpNotePickerStepIndex=null; renderEditor() }) }); app.querySelectorAll('[data-arp-step]').forEach((el)=>el.addEventListener('pointerdown',(event)=>{ const i=Number(el.dataset.arpStep); if(!Number.isFinite(i)||!arpSteps[i]) return; const step=arpSteps[i]=normalizeArpStep(arpSteps[i],i); selectedArpStepIndex=i; if(event.ctrlKey||event.metaKey){ step.active=!step.active; renderEditor(); scheduleEditorSave(); return } if(event.shiftKey){ step.accent=!step.accent; renderEditor(); scheduleEditorSave(); return } if(event.altKey){ step.octave=step.octave>=2?-1:step.octave+1; renderEditor(); scheduleEditorSave(); return } if(arpEditMode==='note'){ arpNotePickerStepIndex=i; arpNotePickerOctave=step.noteOctave ?? arpNotePickerOctave; renderEditor(); return } if(arpEditMode==='velocity'){ step.active=true; step.velocity=getVelocityFromStepPointer(event, el); renderEditor(); scheduleEditorSave(); return } cycleArpStepByMode(step, arpEditMode); step.active=true; renderEditor(); scheduleEditorSave() })); app.querySelectorAll('[data-arp-note-picker-octave]').forEach((button)=>{ button.addEventListener('click',()=>{ arpNotePickerOctave=clamp(arpNotePickerOctave+Number(button.dataset.arpNotePickerOctave||0),0,8); renderEditor() }) }); app.querySelector('[data-arp-note-picker-close]')?.addEventListener('click',()=>{ arpNotePickerStepIndex=null; renderEditor() }); app.querySelectorAll('[data-arp-note-value]').forEach((button)=>{ button.addEventListener('click',()=>{ const stepIndex=arpNotePickerStepIndex; if(stepIndex==null||!arpSteps[stepIndex]) return; const st=arpSteps[stepIndex]=normalizeArpStep(arpSteps[stepIndex],stepIndex); st.note=clamp(Number(button.dataset.arpNoteValue),0,11); st.noteOctave=arpNotePickerOctave; st.active=true; selectedArpStepIndex=stepIndex; arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }) }); app.querySelector('[data-arp-reset]')?.addEventListener('click',()=>{ arpSteps=arpSteps.map((_,i)=>normalizeArpStep({ ...createDefaultArpStep(i), octave:0, accent:false },i)); currentArpPatternName='Custom Pattern'; arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-randomize]')?.addEventListener('click',()=>{ arpSteps=arpSteps.map((_,i)=>normalizeArpStep({ active:Math.random()>.35, note:Math.floor(Math.random()*12), noteOctave:Math.floor(3+Math.random()*3), velocity:Math.floor(35+Math.random()*92), octave:[-1,0,0,1][Math.floor(Math.random()*4)], gate:[10,25,50,70,85,100][Math.floor(Math.random()*6)], probability:[0,25,50,75,100][Math.floor(Math.random()*5)], accent:Math.random()>.75, tie:Math.random()>.9 },i)); currentArpPatternName='Custom Pattern'; arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelectorAll('[data-arp-pattern]').forEach((el)=>el.addEventListener('click',()=>{ const name=el.dataset.arpPattern||''; if(name.includes('Straight')) arpSteps=arpSteps.map((s,i)=>normalizeArpStep({ ...s, active:i%2===0, velocity:95, octave:0, accent:false },i)); else if(name.includes('Random')) arpSteps=arpSteps.map((s,i)=>normalizeArpStep({ ...s, active:Math.random()>.45, velocity:Math.floor(45+Math.random()*80), octave:[-1,0,1][Math.floor(Math.random()*3)], probability:[0,25,50,75,100][Math.floor(Math.random()*5)], accent:Math.random()>.8 },i)); else if(name.includes('Chord')) arpMode='Chord Repeat'; currentArpPatternName=name; renderEditor(); scheduleEditorSave() })); app.querySelector('[data-arp-step-active]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.active=e.target.checked; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-note]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.note=clamp(Number(e.target.value)||0,0,11); arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-note-octave]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.noteOctave=clamp(Number(e.target.value)||4,0,8); arpNotePickerStepIndex=null; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-octave]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.octave=clamp(Number(e.target.value)||0,-2,4); renderEditor(); scheduleEditorSave() }); [['[data-arp-step-velocity]','velocity','[data-arp-step-velocity-value]',''],['[data-arp-step-gate]','gate','[data-arp-step-gate-value]','%'],['[data-arp-step-probability]','probability','[data-arp-step-probability-value]','%']].forEach(([sel,key,valSel,suffix])=>{ const input=app.querySelector(sel); const valueEl=app.querySelector(valSel); if(!input) return; input.addEventListener('input',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st[key]=Number(e.target.value); if(valueEl) valueEl.textContent=`${st[key]}${suffix}` }); input.addEventListener('change',()=>{ renderEditor(); scheduleEditorSave() }) }); app.querySelector('[data-arp-step-accent]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.accent=e.target.checked; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-arp-step-tie]')?.addEventListener('change',(e)=>{ const st=arpSteps[selectedArpStepIndex]; if(!st) return; st.tie=e.target.checked; renderEditor(); scheduleEditorSave() }); app.querySelector('[data-instrument-select]')?.addEventListener('change',(e)=>{ selectedInstrumentName=e.target.value });
  app.querySelector('.studio-editor-page')?.addEventListener('click', (event) => {
    const actionButton = event.target.closest('[data-midi-region-action]')
    if (actionButton) {
      event.stopPropagation()
      const action = actionButton.dataset.midiRegionAction
      const regionId = midiRegionMenuState?.regionId || selectedMidiRegionId
      const context = { ...midiRegionMenuState }
      midiRegionMenuState = null
      if (action === 'delete') deleteMidiRegion(regionId)
      else if (action === 'copy') { copyMidiRegion(regionId); renderEditor() }
      else if (action === 'paste') pasteMidiRegion({ beat: context.pasteBeat, trackId: context.trackId })
      else if (action === 'view-roll') { selectedMidiRegionId = regionId; midiRollState = { regionId, quantize: midiRollState?.quantize || '0.25' }; midiRollSelectedNoteIndex = null; openBottomPanel('midi-roll') }
      else if (action === 'rename') { const pos = getClampedFloatingPosition(context.x || event.clientX, context.y || event.clientY, 260, 120); regionRenameState = { regionId, x: pos.x, y: pos.y }; renderEditor(); requestAnimationFrame(()=>app.querySelector('[data-midi-rename-input]')?.select?.()) }
      else if (action === 'color') { const pos = getClampedFloatingPosition(context.x || event.clientX, context.y || event.clientY, 220, 150); regionColorPickerState = { regionId, x: pos.x, y: pos.y }; renderEditor() }
      return
    }
    if (!event.target.closest('[data-midi-context-menu], [data-midi-color-form], [data-midi-rename-form], [data-midi-region]') && (midiRegionMenuState || regionColorPickerState || regionRenameState)) {
      midiRegionMenuState = null
      regionColorPickerState = null
      regionRenameState = null
      renderEditor()
    }
  })
  app.querySelector('[data-midi-rename-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const regionId = regionRenameState?.regionId
    const value = String(app.querySelector('[data-midi-rename-input]')?.value || '').trim().slice(0, 80)
    const region = midiRegions.find((item)=>item.id === regionId)
    if (region) {
      commitHistoryMutation('rename-midi-region', () => {
        region.name = value
        regionRenameState = null
      })
    } else {
      regionRenameState = null
      renderEditor()
    }
  })
  app.querySelector('[data-midi-rename-cancel]')?.addEventListener('click', (event) => {
    event.preventDefault()
    regionRenameState = null
    renderEditor()
  })
  app.querySelector('[data-midi-color-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    const region = midiRegions.find((item)=>item.id === regionColorPickerState?.regionId)
    const value = app.querySelector('[data-midi-region-color-input]')?.value
    if (region && value) {
      commitHistoryMutation('color-midi-region', () => {
        region.independentColor = value
        region.color = value
        regionColorPickerState = null
      })
      return
    }
    regionColorPickerState = null
    renderEditor()
  })
  app.querySelector('[data-midi-region-reset-color]')?.addEventListener('click', () => {
    const region = midiRegions.find((item)=>item.id === regionColorPickerState?.regionId)
    const track = tracks.find((item)=>item.id === region?.trackId)
    if (region) {
      commitHistoryMutation('reset-midi-region-color', () => {
        delete region.independentColor
        region.color = track?.color || region.color
        regionColorPickerState = null
      })
      return
    }
    regionColorPickerState = null
    renderEditor()
  })
  app.querySelectorAll('[data-midi-note-index]').forEach((noteEl)=>noteEl.addEventListener('pointerdown', (event) => {
    beginMidiNoteDrag(event, midiRollState?.regionId || selectedMidiRegionId, Number(noteEl.dataset.midiNoteIndex))
  }))
  app.querySelector('[data-midi-note-velocity]')?.addEventListener('change', (event) => {
    mutateSelectedMidiNote('change-midi-note-velocity', (note) => { note.velocity = clamp(Number(event.target.value) / 127, 0.01, 1) })
  })
  app.querySelector('[data-midi-note-length]')?.addEventListener('change', (event) => {
    mutateSelectedMidiNote('change-midi-note-length', (note) => { note.durationBeats = Math.max(0.05, Number(event.target.value) || 0.25) })
  })
  app.querySelector('[data-midi-roll-quantize]')?.addEventListener('change', (event) => {
    midiRollState = { ...(midiRollState || {}), quantize: event.target.value || '0.25' }
    renderEditor()
  })
  app.querySelector('[data-midi-quantize-note]')?.addEventListener('click', () => quantizeSelectedMidiNote())
  app.querySelector('[data-midi-delete-note]')?.addEventListener('click', () => deleteSelectedMidiNote())
  app.querySelectorAll('[data-midi-note-transpose]').forEach((button)=>button.addEventListener('click', () => {
    const amount = Number(button.dataset.midiNoteTranspose) || 0
    mutateSelectedMidiNote('transpose-midi-note', (note) => { note.note = clamp((Number(note.note) || 60) + amount, 0, 127) })
  }))
  app.querySelector('[data-close-bottom-panel]')?.addEventListener('click', ()=>{ closeBottomPanel() })
  updateTransportPlaybackUI()
}

// TODO: connect navigator.requestMIDIAccess() after MIDI permission UX is designed.
function renderEditor() {
  if (pendingMidiRollViewport) {
    midiRollViewport = pendingMidiRollViewport
    pendingMidiRollViewport = null
  } else {
    captureMidiRollViewport()
  }
  const project = projectState
  if (studioAudioEngine) studioAudioEngine.setBpm(Number(project?.bpm || 140))
  document.body.classList.add('is-studio-editor')
  const showResonaPanel = activeBottomPanel === 'resona'
  const bottomPanelId = activeBottomPanel || closingBottomPanel
  const shouldRenderBottomPanel = Boolean(bottomPanelId && bottomPanelId !== 'resona')
  const shell = `<main class="studio-editor-page ${activeLeftPanel ? "has-left-panel" : ""} ${showResonaPanel ? 'has-resona-panel' : ''} ${keepSiteMenuOpen ? 'has-site-nav' : 'is-fullscreen'} ${globalTracks.visible ? 'has-global-tracks' : ''}" style="--studio-track-height:${timelineState.trackHeight}px"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu" aria-expanded="false">☰</button><nav class="studio-editor-menu"><button>File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button type="button" data-toggle-controls-menu class="${isControlsMenuOpen ? 'is-active' : ''}">Controls</button><button>Help</button></nav>${renderControlsMenu()}<aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small data-editor-status>${isCountInRunning ? `Count-in: ${countInBeatsRemaining}` : (recordingStatus || 'Project loaded')}</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group studio-tool-group--left"><button data-left-panel="library" class="studio-tool-button ${activeLeftPanel==='library'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='library')}" data-tooltip="Library">${toolIcon('library')}</button><button data-left-panel="inspector" class="studio-tool-button ${activeLeftPanel==='inspector'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='inspector')}" data-tooltip="Inspector">${toolIcon('inspector')}</button><button data-open-notes class="studio-tool-button ${isNotesOpen ? 'is-active' : ''}" aria-pressed="${String(isNotesOpen)}" data-tooltip="Notes">${toolIcon('notes')}</button><button data-left-panel="smart-controls" class="studio-tool-button ${activeLeftPanel==='smart-controls'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='smart-controls')}" data-tooltip="Smart Controls">${toolIcon('sliders')}</button><button data-left-panel="loop-browser" class="studio-tool-button ${activeLeftPanel==='loop-browser'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='loop-browser')}" data-tooltip="Loop Browser">${toolIcon('store')}</button></div><div class="studio-transport-center"><div class="studio-tool-group studio-tool-group--transport"><button data-transport-start class="studio-tool-button" aria-label="Go to start" data-tooltip="Go to start">${toolIcon('start')}</button> <button data-transport-rewind class="studio-tool-button" aria-label="Rewind" data-tooltip="Rewind">${toolIcon('rewind')}</button> <button data-transport-play class="studio-tool-button ${isPlaying ? 'is-active' : ''} ${activeRecording || isCountInRunning ? 'is-disabled' : ''}" ${activeRecording || isCountInRunning ? 'disabled' : ''} aria-label="${isPlaying ? 'Pause' : 'Play'}" data-tooltip="${isPlaying ? 'Pause' : 'Play'}" aria-pressed="${isPlaying}">${isPlaying ? '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><path d=\"M8 5v14M16 5v14\"/></svg>' : toolIcon('play')}</button> <button data-transport-stop class="studio-tool-button" aria-label="Stop" data-tooltip="Stop">${toolIcon('stop')}</button> <button data-transport-record class="studio-tool-button ${activeRecording || isCountInRunning ? 'is-active' : ''}" aria-label="Record" data-tooltip="Record">${toolIcon('record')}</button> <button data-transport-forward class="studio-tool-button" aria-label="Fast forward" data-tooltip="Fast forward">${toolIcon('forward')}</button> <button data-transport-end class="studio-tool-button" aria-label="Go to end" data-tooltip="Go to end">${toolIcon('end')}</button> <button data-toggle-cycle class="studio-tool-button studio-tool-button--cycle ${isCycleEnabled ? 'is-active' : ''}" aria-label="Cycle" aria-pressed="${String(isCycleEnabled)}" data-tooltip="Cycle">${toolIcon('loop')}</button></div><div class="studio-logic-display" aria-label="Project transport display"><section class="studio-logic-section studio-logic-section--time"><strong class="studio-logic-primary" data-display-time>${formatTimeFromPlayhead()}</strong><span class="studio-logic-secondary">time</span></section><section class="studio-logic-section studio-logic-section--bars"><strong class="studio-logic-primary" data-display-bars>${formatBarsFromPlayhead()}</strong><span class="studio-logic-secondary">bar beat div tick</span></section><section class="studio-logic-section studio-logic-section--tempo"><strong class="studio-logic-primary">${Number(project.bpm || 140).toFixed(4)}</strong><span class="studio-logic-secondary">4/4 <button class="studio-display-icon-button" aria-label="Tempo settings" data-tooltip="Tempo settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/></svg></button></span></section><section class="studio-logic-section studio-logic-section--key"><strong class="studio-logic-primary">${project.key}</strong><span class="studio-logic-secondary">key</span></section><section class="studio-logic-section studio-logic-section--midi"><strong class="studio-logic-primary" data-midi-status>No MIDI</strong><span class="studio-logic-secondary">input</span></section><section class="studio-logic-section studio-logic-section--cpu"><strong class="studio-logic-primary">0%</strong><span class="studio-logic-secondary">CPU</span></section></div><div class="studio-tool-group studio-tool-group--utilities"><button data-toggle-metronome class="studio-tool-button ${isMetronomeEnabled ? 'is-active' : ''}" aria-label="Metronome" aria-pressed="${String(isMetronomeEnabled)}" data-tooltip="Metronome">${toolIcon('metro')}</button><button data-toggle-count-in class="studio-tool-button studio-tool-button--count-in ${isCountInEnabled ? 'is-active' : ''}" aria-label="Count-in" aria-pressed="${String(isCountInEnabled)}" data-tooltip="Count-in">${toolIcon('count')}</button><button data-toggle-snap class="studio-tool-button ${isSnapEnabled ? 'is-active' : ''}" aria-label="Snap" aria-pressed="${String(isSnapEnabled)}" data-tooltip="Snap">${toolIcon('snap')}</button><button data-toggle-follow-playhead class="studio-tool-button ${followPlayhead ? 'is-active' : ''}" aria-label="Follow Playhead" aria-pressed="${String(followPlayhead)}" data-tooltip="Follow Playhead"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg></button></div></div><div class="studio-transport-spacer" aria-hidden="true"></div></section><div class="studio-editor-workspace">${activeLeftPanel ? renderLeftPanel() : ""}<aside class="studio-track-panel">${renderTrackToolbar()}${renderGlobalTrackLabels()}<div class="studio-track-list">${tracks.map(renderTrackCard).join('')}</div></aside><section class="studio-arrangement ${globalTracks.visible ? 'has-global-tracks' : ''}" data-arrangement style="--bars: ${timelineState.bars}; --beats-per-bar: ${timelineState.beatsPerBar}; --pixels-per-bar: ${timelineState.pixelsPerBar}px; --pixels-per-beat: ${timelineState.pixelsPerBar / timelineState.beatsPerBar}px; --playhead-x: ${timelineState.playheadX}px; --timeline-content-width: ${timelineContentWidth()}px;"><div class="studio-timeline-ruler" data-timeline-ruler><div class="studio-timeline-ruler-inner" data-timeline-ruler-inner><div class="studio-cycle-strip" data-cycle-strip>${renderCycleRange()}</div><span class="studio-negative-zone studio-negative-zone--ruler" style="width:${barZeroX()}px"></span>${renderTimelineRuler()}<span class="studio-ruler-playhead" data-ruler-playhead></span></div></div>${renderGlobalTrackLane()}<div class="studio-arrangement-grid" data-arrangement-grid><div class="studio-arrangement-grid-inner" data-arrangement-grid-inner><span class="studio-negative-zone studio-negative-zone--grid" style="width:${barZeroX()}px"></span>${renderTimelineLines()}${renderTimelineRegions()}${renderCycleBoundaryGuides()}<span class="studio-grid-playhead" data-grid-playhead></span><div class="studio-selection-box" data-selection-box hidden></div></div></div><div class="studio-timeline-extension-lane" data-timeline-extension-lane><div class="studio-timeline-extension-lane-inner" data-timeline-extension-inner><button class="studio-timeline-extension-handle studio-timeline-extension-handle--left" data-timeline-extension-handle="left" aria-label="Adjust timeline start"></button><button class="studio-timeline-extension-handle studio-timeline-extension-handle--right" data-timeline-extension-handle="right" aria-label="Adjust timeline end"></button></div></div></section>${showResonaPanel ? renderStudioResonaPanel() : ''}<aside class="studio-right-rail"><button data-bottom-panel="loops" class="${activeBottomPanel==='loops' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='loops')}">Loops</button><button data-bottom-panel="mixer" class="${activeBottomPanel==='mixer' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='mixer')}">Mixer</button><button data-bottom-panel="collab" class="${activeBottomPanel==='collab' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='collab')}">Collab</button><button data-bottom-panel="midi-roll" class="${activeBottomPanel==='midi-roll' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='midi-roll')}">MIDI Roll</button><button data-bottom-panel="instrument" class="${activeBottomPanel==='instrument' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='instrument')}">Instrument</button><button data-bottom-panel="resona" class="${activeBottomPanel==='resona' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='resona')}">Resona</button>${activeBottomPanel==='instrument'?`<div class="studio-right-rail-divider"></div><div class="studio-right-rail-subtools" data-instrument-subtools>${instrumentSubpages.map((page)=>`<button class="studio-right-rail-subtool is-enabled ${activeInstrumentSubpage===page.id?'is-active':''}" data-instrument-subpage="${page.id}" aria-pressed="${String(activeInstrumentSubpage===page.id)}" type="button">${page.label}</button>`).join('')}</div>`:''}</aside></div>${shouldRenderBottomPanel ? renderBottomPanel(bottomPanelId, bottomPanelMotion==='entering'?'is-bottom-panel-entering':(bottomPanelMotion==='exiting'?'is-bottom-panel-exiting':'')) : ''}<section class="studio-effects-panel" hidden></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span><span class="studio-footer-save-status" data-save-status>${saveStatus}</span></footer><div class="studio-tooltip-layer" data-studio-tooltip hidden></div>${renderTrackContextMenu()}${renderMidiRegionContextMenu()}${renderMidiRegionColorPopover()}${renderMidiRegionRenamePopover()}${renderTrackRenamePopover()}${renderTrackColorPopover()}${renderGlobalTrackPopover()}${renderNotesModal()}</main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  initShellChrome()
  app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', dawWindowManager.renderWindows())
  applyStudioGuideTargets()
  setEditorMenuOpen(isEditorMenuOpen)
  bindEditorEvents()
  dawWindowManager.bind(app)
  restoreMidiRollViewport()
  mountStudioResonaPanel()
  applyStudioGuideTargets()
}



const dawInstrumentKeyMap = {
  KeyA:60, KeyW:61, KeyS:62, KeyE:63, KeyD:64, KeyF:65, KeyT:66,
  KeyG:67, KeyY:68, KeyH:69, KeyU:70, KeyJ:71, KeyK:72, KeyO:73,
  KeyL:74, KeyP:75, Semicolon:76, Quote:77
}
function handleStudioKeydown(event){
  if(isTextEntryTarget(event.target)) return
  if((event.ctrlKey || event.metaKey) && !event.altKey){
    if(event.code === 'KeyZ'){
      event.preventDefault()
      if(event.shiftKey) redoDawEdit()
      else undoDawEdit()
      return
    }
    if(event.code === 'KeyY'){
      event.preventDefault()
      redoDawEdit()
      return
    }
    return
  }
  if(event.altKey) return
  if(event.code==='Space'){handleSpaceTransport(event); return}
  if(event.code==='KeyR'){
    event.preventDefault()
    if(activeRecording || isCountInRunning) stopRecordingAndKeep()
    else startMidiRecordFlow()
    return
  }
  if (handleMusicalTypingKeydown(event)) return
  if(activeRecording || isCountInRunning){
    if(['Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','KeyC','KeyK'].includes(event.code)) event.preventDefault()
    return
  }
  const step=timelineState.pixelsPerBar/timelineState.beatsPerBar
  if(event.code==='Delete'||event.code==='Backspace'){event.preventDefault(); if(activeBottomPanel==='midi-roll'&&deleteSelectedMidiNote()) return; if(selectedMidiRegionId) deleteMidiRegion(selectedMidiRegionId)}
  else if(event.code==='Enter'){event.preventDefault();setPlayhead(barZeroX());scheduleEditorSave();lastMetronomeBeat=-1}
  else if(event.code==='ArrowLeft'){event.preventDefault();setPlayhead(timelineState.playheadX-step)}
  else if(event.code==='ArrowRight'){event.preventDefault();setPlayhead(timelineState.playheadX+step)}
  else if(event.code==='KeyC'){event.preventDefault(); isCycleEnabled=!isCycleEnabled; renderEditor()}
  else if(event.code==='KeyK'){event.preventDefault(); isMetronomeEnabled=!isMetronomeEnabled; if(isMetronomeEnabled) getAudioContext(); renderEditor()}
}
if(!window.__melogicStudioKeybindsBound){ window.__melogicStudioKeybindsBound=true; document.addEventListener('keydown', handleStudioKeydown); document.addEventListener('keyup',(event)=>{
  const held = pressedDawMidiKeys.get(event.code)
  if (held) {
    const track = tracks.find((item)=>item.id===held.trackId)
    pressedDawMidiKeys.delete(event.code)
    stopTrackMidiNote(track, held.note)
  }
  if (event.code === 'KeyC' && typingPitchTrigger < 0) typingPitchTrigger = 0
  if (event.code === 'KeyV' && typingPitchTrigger > 0) typingPitchTrigger = 0
  if (event.code === 'KeyB' && typingModTrigger < 0) typingModTrigger = 0
  if (event.code === 'KeyN' && typingModTrigger > 0) typingModTrigger = 0
  if (['KeyC', 'KeyV', 'KeyB', 'KeyN'].includes(event.code)) applyTypingExpressionState()
}) }
if(!window.__melogicDawAudioPrewarmBound){
  window.__melogicDawAudioPrewarmBound = true
  window.addEventListener('pointerdown', () => prewarmDawAudio().catch(()=>{}), { once:true, capture:true })
  window.addEventListener('keydown', () => prewarmDawAudio().catch(()=>{}), { once:true, capture:true })
}
if(!window.__melogicDawInstrumentCleanupBound){ window.__melogicDawInstrumentCleanupBound=true; window.addEventListener('beforeunload',(event)=>{ if(activeRecording){ event.preventDefault(); event.returnValue='Recording is in progress. Are you sure you want to leave?' } stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); dawInstrumentRegistry.disposeAll(); dawWindowManager.destroy() }) }

async function init() { renderState('Loading project...'); const user = await waitForInitialAuthState(); if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname })); const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.'); const project = await getStudioProject(id); if (!project) return renderState('Studio project not found.'); if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.'); touchStudioProject(project.id).catch(() => {}); projectState = project; if (projectState.editorState) applyLoadedEditorState(projectState.editorState); ensureDefaultCycleRange(); isEditorLoaded = true; renderEditor() }
init()
