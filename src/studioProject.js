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
import { isSouraAudioEffectPlugin, renderSouraAudioEffectShell } from './studio/plugins/SouraAudioEffectShell.js'
import { getDawPluginManifest, listDawInstruments } from './daw/pluginHost/pluginRegistry.js'
import { MIDI_EFFECT_MANIFESTS } from './daw/midiEffects/catalog.js'
import {
  AUDIO_EFFECT_MANIFESTS,
  getAudioEffectDefaultParams,
  getAudioEffectManifest,
  getAudioEffectPluginType,
  getAudioEffectTypeFromPlugin,
  isImplementedAudioEffect
} from './daw/audioEffects/catalog.js'
import { mountResonaChatSurface } from './components/resonaChatSurface.js'
import { getStorageAssetUrl } from './firebase/storageAssets.js'
import { storage as firebaseStorage } from './firebase/storage.js'
import { ref as storageRef, uploadBytes } from 'firebase/storage'
import { renderAudioDsp, SOURA_AUDIO_DSP_OPERATIONS } from './studio/audio/dsp/audioDspRenderService.js'
import {
  getSouraWasmDspStatusSnapshot,
  isLegacyJsDspFallbackEnabled,
  preloadSouraWasmDsp
} from './studio/audio/dsp/wasm/souraWasmDspClient.js'
import { renderReversedAudio } from './studio/audio/audioReverseRenderService.js'
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
const REGION_TOOL_ITEMS = [
  { id: 'select', label: 'Select', glyph: 'V', shortcut: 'V / 1', enabled: true, mode: 'cursor' },
  { id: 'split', label: 'Split', glyph: 'S', shortcut: 'S / 3', enabled: true, mode: 'cursor' },
  { id: 'erase', label: 'Erase', glyph: 'E', shortcut: 'E / 4', enabled: true, mode: 'cursor' },
  { id: 'mute', label: 'Mute', glyph: 'M', shortcut: 'M', enabled: true, mode: 'cursor' },
  { id: 'loop', label: 'Loop', glyph: 'L', shortcut: 'L', enabled: true, mode: 'action', title: 'Loop selected region' },
  { id: 'stretch', label: 'Stretch', glyph: 'T', shortcut: 'Edge drag', enabled: true, mode: 'cursor' },
  { id: 'draw', label: 'Draw', glyph: 'P', enabled: false, reason: 'Use Pencil in Region Editor' },
  { id: 'fade', label: 'Fade', glyph: 'F', enabled: false, reason: 'Use Region Editor fades' },
  { id: 'slip', label: 'Slip', glyph: 'L', enabled: false, reason: 'Coming soon' },
  { id: 'audition', label: 'Audition', glyph: 'A', enabled: false, reason: 'Coming soon' },
  { id: 'marquee', label: 'Marquee', glyph: 'Q', enabled: false, reason: 'Coming soon' },
  { id: 'glue', label: 'Glue', glyph: 'G', enabled: false, reason: 'Coming soon' },
  { id: 'reverse', label: 'Reverse', glyph: 'RV', enabled: false, reason: 'Use Region Editor render' },
  { id: 'gain', label: 'Gain', glyph: '+', enabled: false, reason: 'Use Region Editor gain' },
  { id: 'automation', label: 'Automation', glyph: 'AU', enabled: false, reason: 'Use track automation' }
]
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
  renderContent: (pluginWindow) => isSouraAudioEffectPlugin(pluginWindow?.pluginType)
    ? renderSouraAudioEffectShell(pluginWindow)
    : renderPluginShell(pluginWindow, { hostMode: 'inline' }),
  getHostUrl: (pluginWindow) => {
    const params = new URLSearchParams({
      pluginInstanceId: pluginWindow.pluginInstanceId,
      pluginType: pluginWindow.pluginType,
      trackId: pluginWindow.trackId || ''
    })
    return `${ROUTES.studioInstrumentHost}?${params.toString()}`
  },
  onOpen: (pluginWindow) => {
    if (isSouraAudioEffectPlugin(pluginWindow?.pluginType)) return
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
    const pluginWindow = dawWindowManager.windows.get(pluginInstanceId)
    if (isSouraAudioEffectPlugin(pluginWindow?.pluginType)) {
      updateAudioEffectParamFromWindow(pluginWindow, param, value)
      return
    }
    dawInstrumentRegistry.setParam(pluginInstanceId, param, value)
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    if (track?.instrument) track.instrument.params = { ...(track.instrument.params || {}), [param]: value }
  },
  onNoteOn: (pluginInstanceId, note, velocity) => {
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    if (track?.instrument?.enabled === false) return
    triggerLiveInstrumentNote(track, note, velocity, { source: 'plugin', activeKey: `plugin:${pluginInstanceId}:${note}` })
    startTrackMeterLoop()
  },
  onNoteOff: (pluginInstanceId, note) => {
    const track = tracks.find((item)=>item.instrument?.pluginInstanceId === pluginInstanceId)
    stopLiveInstrumentNote(track, note, { activeKey: `plugin:${pluginInstanceId}:${note}` })
  },
  onChange: () => renderEditor()
})
let isEditorMenuOpen = false
let selectedTrackId = 'demo-track'
let isFileMenuOpen = false
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
let isTransportTicking = false
let transportClock = null
let transportDebugState = { playheadLogged: false, firstAudioScheduled: false, firstMidiScheduled: false }
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
let addTrackModalOpen = false
let selectedMidiRegionId = ''
const selectedRegionIds = new Set()
let activeRegionTool = 'select'
let midiRegionDrag = null
let midiRegionDragRenderRaf = 0
let pendingMidiRegionDragEvent = null
let timelineEdgeScrollRaf = 0
let timelineEdgeScrollState = null
let audioStretchRenderState = { active: false, regionId: '', progress: null, error: '' }
let audioPitchRenderState = { active: false, regionId: '', mode: '', progress: null, error: '' }
let audioPreflightRenderState = { active: false, total: 0, completed: 0, currentLabel: '', error: '', failed: [] }
let stretchPlaybackPrompt = null
let audioEditPlaybackPrompt = null
const audioEditPlaybackBypassRegionIds = new Set()
let pitchTraceAnalysis = { active: false, regionId: '', requestId: '', worker: null }
let pitchTraceSelectedNoteId = ''
let pitchTraceNoteDrag = null
let pitchTraceTool = 'cursor'
let pitchTraceNoteDraw = null
let meterRaf = 0
let midiRegionMenuState = null
let midiRegionClipboard = null
let midiRollState = null
let midiRollSelectedNoteIndex = null
let midiRollSelectedNoteIndices = []
let midiRollStatus = ''
let midiRollTool = 'cursor'
let midiRollViewport = { regionId: '', scrollLeft: 0, scrollTop: 0 }
let pendingMidiRollViewport = null
let audioRegionToolsViewport = { regionId: '', scrollTop: 0 }
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
const audioClipRuntime = new Map()
const activeAudioClipSources = new Map()
const audioOfflineWarnedRegionIds = new Set()
let audioRecordingController = null
let pendingAudioInputStream = null
let lastPlaybackBeat = 0
let globalTrackDrag = null
let globalTrackPopover = null
let midiRegions = []
let audioImportDrag = null
const audioImportPreviewCache = new Map()
let audioImportPreviewRaf = 0
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

const normalizeTrackType = (type) => type === 'audio' ? 'audio' : 'software'
const isAudioTrack = (track) => normalizeTrackType(track?.type) === 'audio'
const isSoftwareTrack = (track) => !isAudioTrack(track)
const trackTypeLabel = (track) => isAudioTrack(track) ? 'Audio' : 'Software'
const normalizedTrackIconType = (track) => isAudioTrack(track) ? 'audio' : 'instrument'
const beatsToSeconds = (beats = 0) => Math.max(0, Number(beats) || 0) * (60 / Number(projectState?.bpm || 140))
const secondsToBeats = (seconds = 0) => Math.max(0, Number(seconds) || 0) * (Number(projectState?.bpm || 140) / 60)
const waveformWindowSeconds = 0.1
const minAudioRegionSeconds = 0.05
const AUDIO_QUANTIZE_OPTIONS = ['off', '1/4', '1/8', '1/16', '1/32']
const AUDIO_FADE_CURVES = ['linear', 'equal-power']
const AUDIO_PITCH_SOURCES = ['off', 'region', 'project-key']
const STRETCH_SPEED_MIN = 25
const STRETCH_SPEED_MAX = 400
const STRETCH_RATIO_MIN = 100 / STRETCH_SPEED_MAX
const STRETCH_RATIO_MAX = 100 / STRETCH_SPEED_MIN
const TRANSPORT_SCHEDULER_START_DELAY_SECONDS = 0.08
const TRANSPORT_SCHEDULE_LOOKAHEAD_SECONDS = 0.16
const PLAYBACK_LATENCY_COMPENSATION_SECONDS = 0
const LIVE_NOTE_SAFETY_OFFSET_SECONDS = 0.003
const PITCH_TRACE_VERSION = 'pitch-trace-v1'
const PITCH_TRACE_ALGORITHM = 'yin-js-worker-v1'
const PITCH_RENDER_STATUSES = ['idle', 'rendering', 'ready', 'failed', 'needs_render']

function beatsToSecondsAtBpm(beats = 0, bpm = Number(projectState?.bpm || 140)) {
  return Math.max(0, Number(beats) || 0) * (60 / Math.max(1, Number(bpm) || 140))
}
function secondsToBeatsAtBpm(seconds = 0, bpm = Number(projectState?.bpm || 140)) {
  return Math.max(0, Number(seconds) || 0) * (Math.max(1, Number(bpm) || 140) / 60)
}
function getTimelineSecondsAtBeat(beat = 0) {
  return beatsToSeconds(clampBeat(Number(beat) || 0))
}
function getTimelineSecondsAtPlayhead() {
  return getTimelineSecondsAtBeat(xToBeat(timelineState.playheadX))
}
function midiNoteToFrequency(midi = 60) {
  return Number((440 * (2 ** ((Number(midi) - 69) / 12))).toFixed(3))
}
function getAudioPitchShiftTotal(transposeSemitones = 0, fineTuneCents = 0) {
  return (Number(transposeSemitones) || 0) + ((Number(fineTuneCents) || 0) / 100)
}
function normalizeRenderedAudioMetadata(metadata = null) {
  if (!metadata || typeof metadata !== 'object') return null
  const numOrNull = (value) => Number.isFinite(Number(value)) ? Number(value) : null
  return {
    sourceSampleRate: numOrNull(metadata.sourceSampleRate),
    renderedSampleRate: numOrNull(metadata.renderedSampleRate),
    sourceBitDepth: numOrNull(metadata.sourceBitDepth),
    renderedBitDepth: numOrNull(metadata.renderedBitDepth),
    bitDepthPreserved: metadata.bitDepthPreserved === true,
    sourceChannelCount: numOrNull(metadata.sourceChannelCount),
    renderedChannelCount: numOrNull(metadata.renderedChannelCount),
    sampleRatePreserved: metadata.sampleRatePreserved === true,
    channelCountPreserved: metadata.channelCountPreserved === true,
    algorithm: metadata.algorithm || null,
    engine: metadata.engine || null,
    engineLabel: metadata.engineLabel || null,
    engineType: metadata.engineType || null,
    operation: metadata.operation || null,
    quality: metadata.quality || null,
    qualityMode: metadata.qualityMode || null,
    renderedDurationSeconds: numOrNull(metadata.renderedDurationSeconds),
    renderCreatedAt: numOrNull(metadata.renderCreatedAt)
  }
}
function normalizePitchShift(pitchShift = {}, transposeSemitones = 0, fineTuneCents = 0) {
  const source = pitchShift && typeof pitchShift === 'object' ? pitchShift : {}
  const transpose = clamp(Number(transposeSemitones) || 0, -48, 48)
  const fine = clamp(Number(fineTuneCents) || 0, -100, 100)
  const totalSemitones = getAudioPitchShiftTotal(transpose, fine)
  const hasShift = Math.abs(totalSemitones) > 0.001
  const priorStatus = PITCH_RENDER_STATUSES.includes(source.renderStatus) ? source.renderStatus : 'idle'
  const sourceTotal = Number.isFinite(Number(source.totalSemitones)) ? Number(source.totalSemitones) : totalSemitones
  const valueChanged = Math.abs(sourceTotal - totalSemitones) > 0.001
  const renderStatus = !hasShift
    ? 'idle'
    : (priorStatus === 'ready' && valueChanged ? 'needs_render' : priorStatus === 'idle' ? 'needs_render' : priorStatus)
  return {
    enabled: hasShift || source.enabled === true,
    transposeSemitones: transpose,
    fineTuneCents: fine,
    totalSemitones,
    renderStatus,
    renderedStoragePath: source.renderedStoragePath || null,
    renderedAudioUrl: source.renderedAudioUrl || null,
    renderedRuntimeId: source.renderedRuntimeId || null,
    renderedDurationSeconds: Number.isFinite(Number(source.renderedDurationSeconds)) ? Number(source.renderedDurationSeconds) : null,
    algorithm: source.algorithm || null,
    renderedAudio: normalizeRenderedAudioMetadata(source.renderedAudio),
    preservesDuration: source.preservesDuration !== false,
    lastError: source.lastError || null,
    renderedAt: Number.isFinite(Number(source.renderedAt)) ? Number(source.renderedAt) : null
  }
}
function normalizeReverseEdit(reverse = {}, legacyStatus = 'idle', legacyStoragePath = null) {
  const source = reverse && typeof reverse === 'object' ? reverse : {}
  const enabled = reverse === true || source.enabled === true
  const statusValue = source.renderStatus || legacyStatus
  return {
    enabled,
    renderStatus: PITCH_RENDER_STATUSES.includes(statusValue) ? statusValue : (enabled ? 'needs_render' : 'idle'),
    renderedStoragePath: source.renderedStoragePath || legacyStoragePath || null,
    renderedAudioUrl: source.renderedAudioUrl || null,
    renderedRuntimeId: source.renderedRuntimeId || null,
    renderedDurationSeconds: Number.isFinite(Number(source.renderedDurationSeconds)) ? Number(source.renderedDurationSeconds) : null,
    algorithm: source.algorithm || null,
    renderedAudio: normalizeRenderedAudioMetadata(source.renderedAudio),
    lastError: source.lastError || null,
    renderedAt: Number.isFinite(Number(source.renderedAt)) ? Number(source.renderedAt) : null
  }
}
function normalizePitchTrace(trace = {}, legacyFlexFollow = 'off') {
  const source = trace && typeof trace === 'object' ? trace : {}
  const status = ['idle', 'analyzing', 'ready', 'failed'].includes(source.status) ? source.status : 'idle'
  const notes = Array.isArray(source.notes)
    ? source.notes.slice(0, 512).map((note, index)=>{
      const originalMidiNote = clamp(Math.round(Number(note?.originalMidiNote ?? note?.midiNote) || 60), 0, 127)
      const editedMidiNote = clamp(Math.round(Number(note?.editedMidiNote ?? note?.midiNote ?? originalMidiNote) || originalMidiNote), 0, 127)
      const originalFrequencyHz = Math.max(0, Number(note?.originalFrequencyHz ?? note?.frequencyHz) || midiNoteToFrequency(originalMidiNote))
      const editedFrequencyHz = Math.max(0, Number(note?.editedFrequencyHz) || midiNoteToFrequency(editedMidiNote))
      const noteRenderStatus = PITCH_RENDER_STATUSES.includes(note?.renderStatus) ? note.renderStatus : (editedMidiNote !== originalMidiNote ? 'needs_render' : 'idle')
      return {
        id: String(note?.id || `pt-${index + 1}`),
        startSeconds: Math.max(0, Number(note?.startSeconds) || 0),
        durationSeconds: Math.max(0.01, Number(note?.durationSeconds) || 0.01),
        startBeat: Math.max(0, Number(note?.startBeat) || 0),
        durationBeats: Math.max(0.001, Number(note?.durationBeats) || 0.001),
        originalMidiNote,
        editedMidiNote,
        midiNote: editedMidiNote,
        noteName: formatMidiNoteName(editedMidiNote),
        originalFrequencyHz,
        editedFrequencyHz,
        frequencyHz: editedFrequencyHz,
        confidence: clamp(Number(note?.confidence) || 0, 0, 1),
        centsOffset: clamp(Number(note?.centsOffset) || 0, -50, 50),
        gainDb: clamp(Number(note?.gainDb) || 0, -24, 24),
        pitchDriftStartCents: clamp(Number(note?.pitchDriftStartCents) || 0, -1200, 1200),
        pitchDriftEndCents: clamp(Number(note?.pitchDriftEndCents) || 0, -1200, 1200),
        vibratoAmount: clamp(Number(note?.vibratoAmount) || 0, 0, 1),
        source: note?.source === 'manual' ? 'manual' : 'analysis',
        lockedToAnalysis: note?.lockedToAnalysis === true,
        muted: note?.muted === true,
        renderStatus: noteRenderStatus
      }
    }).filter((note)=>note.durationSeconds > 0)
    : []
  const hasEditedNotes = notes.some((note)=>note.muted === true || note.editedMidiNote !== note.originalMidiNote || Math.abs(Number(note.gainDb) || 0) > 0.001)
  const priorRenderStatus = PITCH_RENDER_STATUSES.includes(source.renderStatus) ? source.renderStatus : 'idle'
  const renderStatus = hasEditedNotes && priorRenderStatus === 'idle' ? 'needs_render' : priorRenderStatus
  return {
    enabled: source.enabled === true || legacyFlexFollow === 'on',
    status: notes.length && status === 'idle' ? 'ready' : status,
    algorithm: source.algorithm || (notes.length ? PITCH_TRACE_ALGORITHM : null),
    analysisVersion: source.analysisVersion || PITCH_TRACE_VERSION,
    analyzedAt: Number.isFinite(Number(source.analyzedAt)) ? Number(source.analyzedAt) : null,
    confidenceThreshold: clamp(Number(source.confidenceThreshold ?? 0.65), 0.1, 0.98),
    progress: 0,
    error: source.error || null,
    renderStatus,
    renderedStoragePath: source.renderedStoragePath || null,
    renderedAudioUrl: source.renderedAudioUrl || null,
    renderedRuntimeId: source.renderedRuntimeId || null,
    renderedDurationSeconds: Number.isFinite(Number(source.renderedDurationSeconds)) ? Number(source.renderedDurationSeconds) : null,
    renderAlgorithm: source.renderAlgorithm || null,
    renderedAudio: normalizeRenderedAudioMetadata(source.renderedAudio),
    preservesDuration: source.preservesDuration !== false,
    lastError: source.lastError || null,
    renderedAt: Number.isFinite(Number(source.renderedAt)) ? Number(source.renderedAt) : null,
    notes
  }
}
function normalizeAudioEdit(edit = {}) {
  const quantize = AUDIO_QUANTIZE_OPTIONS.includes(String(edit.quantize || '').toLowerCase()) ? String(edit.quantize).toLowerCase() : 'off'
  const fadeInCurve = AUDIO_FADE_CURVES.includes(edit.fadeInCurve) ? edit.fadeInCurve : 'linear'
  const fadeOutCurve = AUDIO_FADE_CURVES.includes(edit.fadeOutCurve) ? edit.fadeOutCurve : 'linear'
  const pitchSource = AUDIO_PITCH_SOURCES.includes(edit.pitchSource) ? edit.pitchSource : 'off'
  const transposeSemitones = clamp(Number(edit.transposeSemitones) || 0, -48, 48)
  const fineTuneCents = clamp(Number(edit.fineTuneCents) || 0, -100, 100)
  return {
    mute: edit.mute === true,
    loop: edit.loop === true,
    quantize,
    qSwing: clamp(Number(edit.qSwing) || 0, 0, 100),
    qRange: Number.isFinite(Number(edit.qRange)) ? Number(edit.qRange) : null,
    qStrength: clamp(Number(edit.qStrength ?? 100), 0, 100),
    transposeSemitones,
    fineTuneCents,
    pitchShift: normalizePitchShift(edit.pitchShift, transposeSemitones, fineTuneCents),
    pitchSource,
    pitchTrace: normalizePitchTrace(edit.pitchTrace, edit.flexFollow === 'on' ? 'on' : 'off'),
    gainDb: clamp(Number(edit.gainDb) || 0, -24, 24),
    delayMs: clamp(Number(edit.delayMs) || 0, 0, 2000),
    fadeInSeconds: Math.max(0, Number(edit.fadeInSeconds) || 0),
    fadeInCurve,
    fadeOutSeconds: Math.max(0, Number(edit.fadeOutSeconds) || 0),
    fadeOutCurve,
    reverse: normalizeReverseEdit(edit.reverse, edit.reverseRenderStatus, edit.reverseRenderedStoragePath)
  }
}
function finitePositiveNumber(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : null
}
function getStretchStatus(value) {
  const status = value === 'none' ? 'idle' : value
  return ['idle', 'rendering', 'ready', 'failed', 'needs_render'].includes(status) ? status : 'idle'
}
function getRawAudioRegionVisibleDurationSeconds(region = {}) {
  const visible = finitePositiveNumber(region.visibleDurationSeconds)
  if (visible) return visible
  const duration = finitePositiveNumber(region.durationSeconds)
  if (duration) return duration
  const beats = finitePositiveNumber(region.durationBeats)
  if (beats) return Math.max(minAudioRegionSeconds, beatsToSeconds(beats))
  return null
}
function stretchErrorMessage() {
  return `Stretch speed must be between ${STRETCH_SPEED_MIN}% and ${STRETCH_SPEED_MAX}%.`
}
function isKnownGoodStretchRender(stretch = {}, status = stretch.renderStatus) {
  return status === 'ready' && Boolean(stretch.renderedRuntimeId || stretch.renderedStoragePath || stretch.renderedAudioUrl)
}
function logStretchDebug(action, regionOrId, payload = {}) {
  const clipId = typeof regionOrId === 'string' ? regionOrId : (regionOrId?.id || regionOrId?.audioClip?.audioAssetId || '')
  const stretch = typeof regionOrId === 'object' ? normalizeAudioStretch(regionOrId.stretch, {
    sourceDurationSeconds: getAudioSourceDurationSeconds(regionOrId),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(regionOrId)
  }) : null
  console.info(`[stretch] ${action}`, {
    clipId,
    sourceDurationSeconds: payload.sourceDurationSeconds ?? stretch?.sourceDurationSeconds ?? null,
    targetDurationSeconds: payload.targetDurationSeconds ?? stretch?.targetDurationSeconds ?? null,
    speedPercent: payload.speedPercent ?? stretch?.speedPercent ?? null,
    lengthRatio: payload.lengthRatio ?? stretch?.lengthRatio ?? null,
    renderStatus: payload.renderStatus ?? stretch?.renderStatus ?? null,
    reason: payload.reason || null
  })
}
function makeDefaultAudioStretch(sourceDurationSeconds = null, overrides = {}) {
  const source = finitePositiveNumber(sourceDurationSeconds)
  const target = finitePositiveNumber(overrides.targetDurationSeconds) || source
  return {
    enabled: false,
    sourceDurationSeconds: source,
    targetDurationSeconds: target,
    ratio: 1,
    lengthRatio: 1,
    speedPercent: 100,
    mode: 'none',
    algorithm: null,
    preservesPitch: false,
    renderedObjectUrl: null,
    renderedAudioUrl: null,
    renderedStoragePath: null,
    renderedRuntimeId: null,
    renderedDurationSeconds: null,
    renderedAudio: null,
    renderedAt: null,
    renderedSessionOnly: false,
    renderStatus: 'idle',
    lastError: null,
    renderError: null,
    updatedAt: overrides.updatedAt || null
  }
}
function buildCanonicalStretch({
  enabled = false,
  sourceDurationSeconds = null,
  targetDurationSeconds = null,
  renderStatus = 'idle',
  renderError = null,
  renderedObjectUrl = null,
  renderedAudioUrl = null,
  renderedStoragePath = null,
  renderedRuntimeId = null,
  renderedDurationSeconds = null,
  renderedAudio = null,
  renderedAt = null,
  renderedSessionOnly = false,
  algorithm = null,
  preservesPitch = true,
  updatedAt = Date.now()
} = {}) {
  const source = finitePositiveNumber(sourceDurationSeconds)
  const target = finitePositiveNumber(targetDurationSeconds)
  if (!source || !target) {
    return {
      ...makeDefaultAudioStretch(source, { targetDurationSeconds: target || source, updatedAt }),
      renderError: 'Duration unavailable.',
      lastError: 'Duration unavailable.'
    }
  }
  const lengthRatio = target / source
  const speedPercent = (source / target) * 100
  const supported = Number.isFinite(lengthRatio) && Number.isFinite(speedPercent) && lengthRatio >= STRETCH_RATIO_MIN && lengthRatio <= STRETCH_RATIO_MAX && speedPercent >= STRETCH_SPEED_MIN && speedPercent <= STRETCH_SPEED_MAX
  return {
    enabled: Boolean(enabled),
    sourceDurationSeconds: source,
    targetDurationSeconds: target,
    ratio: lengthRatio,
    lengthRatio,
    speedPercent,
    mode: enabled ? 'offline_render' : 'none',
    algorithm: algorithm || (enabled ? 'signalsmith_wasm_time_stretch_v1' : null),
    preservesPitch: Boolean(enabled && preservesPitch),
    renderedObjectUrl: renderedObjectUrl || null,
    renderedAudioUrl: renderedAudioUrl || null,
    renderedStoragePath: renderedStoragePath || null,
    renderedRuntimeId: renderedRuntimeId || null,
    renderedDurationSeconds: finitePositiveNumber(renderedDurationSeconds),
    renderedAudio: normalizeRenderedAudioMetadata(renderedAudio),
    renderedAt: Number.isFinite(Number(renderedAt)) ? Number(renderedAt) : null,
    renderedSessionOnly: renderedSessionOnly === true,
    renderStatus: getStretchStatus(renderStatus),
    lastError: renderError || (supported ? null : stretchErrorMessage()),
    renderError: renderError || (supported ? null : stretchErrorMessage()),
    updatedAt
  }
}
function normalizeAudioStretch(stretch = {}, context = {}) {
  const source = finitePositiveNumber(stretch.sourceDurationSeconds) || finitePositiveNumber(context.sourceDurationSeconds)
  const visible = finitePositiveNumber(context.visibleDurationSeconds)
  const status = getStretchStatus(stretch.renderStatus || (stretch.renderedRuntimeId || stretch.renderedStoragePath || stretch.renderedAudioUrl ? 'ready' : 'idle'))
  const requestedEnabled = stretch.enabled === true
  const rawTarget = finitePositiveNumber(stretch.targetDurationSeconds)
  const rawRatio = finitePositiveNumber(stretch.lengthRatio ?? stretch.ratio)
  const rawSpeed = finitePositiveNumber(stretch.speedPercent)
  const targetFromRatio = source && rawRatio ? source * rawRatio : null
  const targetFromSpeed = source && rawSpeed ? source / (rawSpeed / 100) : null
  const target = rawTarget || (requestedEnabled ? (targetFromRatio || targetFromSpeed || visible || source) : source)
  const lengthRatio = source && target ? target / source : (rawRatio || 1)
  const speedPercent = source && target ? (source / target) * 100 : (rawSpeed || (100 / Math.max(0.001, lengthRatio)))
  const knownGood = isKnownGoodStretchRender(stretch, status)
  const outOfRange = speedPercent < STRETCH_SPEED_MIN || speedPercent > STRETCH_SPEED_MAX || lengthRatio < STRETCH_RATIO_MIN || lengthRatio > STRETCH_RATIO_MAX
  const suspiciousTinyTarget = requestedEnabled && target && source && target <= Math.max(minAudioRegionSeconds * 1.1, source * 0.08) && source > target * 4 && !knownGood
  const structurallyInvalid = !source || !target || !Number.isFinite(lengthRatio) || !Number.isFinite(speedPercent) || lengthRatio <= 0 || target <= 0 || source <= 0 || suspiciousTinyTarget
  if (requestedEnabled && (structurallyInvalid || (context.migrateCorrupt === true && outOfRange)) && !knownGood) {
    const safeDuration = source || visible || minAudioRegionSeconds
    logStretchDebug('normalize', context.clipId || '', {
      sourceDurationSeconds: source,
      targetDurationSeconds: target,
      speedPercent,
      lengthRatio,
      renderStatus: status,
      reason: suspiciousTinyTarget ? 'corrupt_tiny_target' : 'invalid_or_out_of_range'
    })
    return makeDefaultAudioStretch(safeDuration)
  }
  if (!requestedEnabled) return makeDefaultAudioStretch(source || visible || null)
  return buildCanonicalStretch({
    enabled: true,
    sourceDurationSeconds: source,
    targetDurationSeconds: target,
    renderStatus: status,
    renderError: stretch.renderError || stretch.lastError || null,
    renderedObjectUrl: stretch.renderedObjectUrl,
    renderedAudioUrl: stretch.renderedAudioUrl,
    renderedStoragePath: stretch.renderedStoragePath,
    renderedRuntimeId: stretch.renderedRuntimeId,
    renderedDurationSeconds: stretch.renderedDurationSeconds,
    renderedAudio: stretch.renderedAudio,
    renderedAt: stretch.renderedAt,
    renderedSessionOnly: stretch.renderedSessionOnly,
    algorithm: stretch.algorithm,
    preservesPitch: stretch.preservesPitch !== false,
    updatedAt: stretch.updatedAt || null
  })
}
function getAudioStretchMath(region = {}, targetDuration = null) {
  const sourceRaw = getAudioSourceDurationSeconds(region)
  const source = finitePositiveNumber(sourceRaw)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: source,
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  const target = finitePositiveNumber(targetDuration) || (stretch.enabled ? stretch.targetDurationSeconds : source)
  if (!source || !target) {
    return {
      originalDurationSeconds: source || null,
      sourceDurationSeconds: source || null,
      targetDurationSeconds: target || null,
      lengthRatio: 1,
      speedPercent: 100,
      rawSpeedPercent: 100,
      supported: false,
      error: 'Duration unavailable.'
    }
  }
  if (!stretch.enabled && targetDuration == null) {
    return {
      originalDurationSeconds: source,
      sourceDurationSeconds: source,
      targetDurationSeconds: source,
      lengthRatio: 1,
      speedPercent: 100,
      rawSpeedPercent: 100,
      supported: true,
      error: null
    }
  }
  const lengthRatio = target / source
  const speedPercent = (source / target) * 100
  const supported = Number.isFinite(speedPercent) && Number.isFinite(lengthRatio) && speedPercent >= STRETCH_SPEED_MIN && speedPercent <= STRETCH_SPEED_MAX && lengthRatio >= STRETCH_RATIO_MIN && lengthRatio <= STRETCH_RATIO_MAX
  return {
    originalDurationSeconds: source,
    sourceDurationSeconds: source,
    targetDurationSeconds: target,
    lengthRatio,
    speedPercent: Number.isFinite(speedPercent) ? speedPercent : 100,
    rawSpeedPercent: speedPercent,
    supported,
    error: supported ? null : stretchErrorMessage()
  }
}
function sanitizeStorageFilePart(value = '') {
  return String(value || 'asset').trim().replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'asset'
}
function extensionForAudioType(contentType = '') {
  if (contentType.includes('wav')) return 'wav'
  if (contentType.includes('ogg')) return 'ogg'
  if (contentType.includes('mpeg') || contentType.includes('mp3')) return 'mp3'
  if (contentType.includes('mp4') || contentType.includes('m4a')) return 'm4a'
  if (contentType.includes('flac')) return 'flac'
  return 'webm'
}
function extensionForAudioFile(file = {}) {
  const name = String(file?.name || '')
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : ''
  return ext || extensionForAudioType(file?.type || '')
}
function isSupportedAudioFile(file = {}) {
  if (!file) return false
  if (String(file.type || '').startsWith('audio/')) return true
  return ['wav', 'mp3', 'm4a', 'aac', 'ogg', 'oga', 'webm', 'flac'].includes(extensionForAudioFile(file))
}
function formatFileSize(bytes = 0) {
  const size = Math.max(0, Number(bytes) || 0)
  if (size >= 1024 * 1024 * 1024) return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(2)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${Math.round(size)} B`
}
function formatAudioDuration(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0)
  const minutes = Math.floor(value / 60)
  const wholeSeconds = Math.floor(value % 60)
  const ms = Math.round((value % 1) * 1000)
  return `${minutes}:${String(wholeSeconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}
function parseWavBitDepth(arrayBuffer) {
  try {
    const view = new DataView(arrayBuffer)
    const text = (offset, length) => Array.from({ length }, (_, index)=>String.fromCharCode(view.getUint8(offset + index))).join('')
    if (text(0, 4) !== 'RIFF' || text(8, 4) !== 'WAVE') return { bitDepth: null, bitDepthSource: 'not_applicable' }
    let offset = 12
    while (offset + 8 <= view.byteLength) {
      const chunkId = text(offset, 4)
      const chunkSize = view.getUint32(offset + 4, true)
      if (chunkId === 'fmt ' && offset + 24 <= view.byteLength) {
        return { bitDepth: view.getUint16(offset + 22, true), bitDepthSource: 'wav_header' }
      }
      offset += 8 + chunkSize + (chunkSize % 2)
    }
  } catch {}
  return { bitDepth: null, bitDepthSource: 'unknown' }
}
function getSouraAudioStoragePath({ clipId, contentType = 'audio/webm', suffix = '' } = {}) {
  const projectId = sanitizeStorageFilePart(projectState?.id || projectIdFromPath() || 'project')
  const safeClipId = sanitizeStorageFilePart(clipId || makeInsertId('audio'))
  const safeSuffix = suffix ? `-${sanitizeStorageFilePart(suffix)}` : ''
  return `studioProjects/${projectId}/audio/${safeClipId}${safeSuffix}.${extensionForAudioType(contentType)}`
}
async function uploadSouraAudioBlob(blob, { clipId, suffix = '' } = {}) {
  if (!blob?.size) return null
  if (!firebaseStorage) throw new Error('Firebase Storage is not initialized.')
  const contentType = blob.type || 'audio/webm'
  const path = getSouraAudioStoragePath({ clipId, contentType, suffix })
  await uploadBytes(storageRef(firebaseStorage, path), blob, {
    contentType,
    customMetadata: {
      projectId: String(projectState?.id || ''),
      clipId: String(clipId || ''),
      source: 'soura'
    }
  })
  return path
}
function audioImportCacheKey(file = {}) {
  return `${file.name || 'audio'}:${file.size || 0}:${file.lastModified || 0}:${file.type || ''}`
}
async function decodeAudioFileForImport(file) {
  if (!isSupportedAudioFile(file)) throw new Error('Unsupported audio file.')
  const key = audioImportCacheKey(file)
  const cached = audioImportPreviewCache.get(key)
  if (cached?.metadata?.audioBuffer) return cached.metadata
  if (cached?.promise) return cached.promise
  const promise = (async () => {
    const arrayBuffer = await file.arrayBuffer()
    const ctx = getAudioContext()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const wavBitDepth = parseWavBitDepth(arrayBuffer)
    const ext = extensionForAudioFile(file)
    const metadata = {
      audioBuffer,
      waveform: buildAudioWaveformFromBuffer(audioBuffer, { maxPeaks: 1200 }),
      fileName: file.name || `Imported Audio.${ext || 'audio'}`,
      contentType: file.type || (ext ? `audio/${ext}` : 'audio/*'),
      fileSizeBytes: Number(file.size) || 0,
      sampleRate: audioBuffer.sampleRate || null,
      channelCount: audioBuffer.numberOfChannels || null,
      fileDurationSeconds: Math.max(minAudioRegionSeconds, audioBuffer.duration || 0),
      bitDepth: wavBitDepth.bitDepth,
      bitDepthSource: ext === 'wav' ? wavBitDepth.bitDepthSource : 'not_applicable',
      fileType: file.type || ext.toUpperCase() || 'audio'
    }
    audioImportPreviewCache.set(key, { metadata })
    return metadata
  })().catch((error) => {
    audioImportPreviewCache.delete(key)
    throw error
  })
  audioImportPreviewCache.set(key, { promise })
  return promise
}
function getAudioImportRegionLabel(fileName = '') {
  const clean = String(fileName || 'Imported Audio').replace(/\.[^.]+$/, '').trim()
  return clean.slice(0, 80) || 'Imported Audio'
}
function parseHexColor(color = '') {
  const normalized = String(color || '').trim()
  const match = normalized.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (!match) return null
  const hex = match[1].length === 3 ? match[1].split('').map((char)=>char + char).join('') : match[1]
  return {
    r: parseInt(hex.slice(0, 2), 16),
    g: parseInt(hex.slice(2, 4), 16),
    b: parseInt(hex.slice(4, 6), 16)
  }
}
function rgbToHsl({ r, g, b }) {
  const nr = r / 255
  const ng = g / 255
  const nb = b / 255
  const max = Math.max(nr, ng, nb)
  const min = Math.min(nr, ng, nb)
  let h = 0
  let s = 0
  const l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === nr) h = ((ng - nb) / d) + (ng < nb ? 6 : 0)
    else if (max === ng) h = ((nb - nr) / d) + 2
    else h = ((nr - ng) / d) + 4
    h /= 6
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) }
}
function getReadableWaveformColor(color = '#58d4ff') {
  const rgb = parseHexColor(color)
  if (!rgb) return color || '#58d4ff'
  const luminance = (0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b)
  if (luminance < 14) return '#ffffff'
  if (luminance >= 72) return `#${[rgb.r, rgb.g, rgb.b].map((value)=>value.toString(16).padStart(2, '0')).join('')}`
  const hsl = rgbToHsl(rgb)
  return `hsl(${hsl.h} ${Math.max(72, hsl.s)}% ${Math.max(58, hsl.l)}%)`
}
function getAudioClipStatusLabel(region = {}) {
  const status = region.audioClip?.loadStatus || 'idle'
  if (status === 'loading' || status === 'pending') return 'Loading audio...'
  if (status === 'ready' || region.audioClip?.audioReady) return 'Audio ready'
  if (status === 'missing' || status === 'failed' || region.missingMedia) return 'Audio file offline'
  return region.audioClip?.storagePath || region.audioClip?.downloadUrl ? 'Audio pending' : 'Audio file offline'
}
function getAudioOfflineMessage(region = {}) {
  const reason = region.audioClip?.offlineReason || (region.audioClip?.sessionOnly ? 'session_only_source_lost' : 'missing_storage_path')
  if (reason === 'decode_failed') return 'The audio file was found but could not be decoded. Re-upload or re-record the clip.'
  if (reason === 'storage_fetch_failed') return 'The audio file could not be loaded from storage. Try again, or reconnect the audio.'
  return 'This region has metadata but no persistent audio file. Re-record or reconnect the audio.'
}
function getAudioFileDurationSeconds(region = {}) {
  return Math.max(minAudioRegionSeconds, Number(region.fileDurationSeconds || region.audioClip?.fileDurationSeconds || region.durationSeconds || region.durationBeats && beatsToSeconds(region.durationBeats) || 0))
}
function getAudioTrimStartSeconds(region = {}) {
  const fileDuration = getAudioFileDurationSeconds(region)
  return clamp(Number(region.trimStartSeconds) || 0, 0, Math.max(0, fileDuration - minAudioRegionSeconds))
}
function getAudioTrimEndSeconds(region = {}) {
  const fileDuration = getAudioFileDurationSeconds(region)
  const raw = Number.isFinite(Number(region.trimEndSeconds)) ? Number(region.trimEndSeconds) : fileDuration
  return clamp(raw, getAudioTrimStartSeconds(region) + minAudioRegionSeconds, fileDuration)
}
function getAudioSourceDurationSeconds(region = {}) {
  return Math.max(minAudioRegionSeconds, getAudioTrimEndSeconds(region) - getAudioTrimStartSeconds(region))
}
function getAudioStretchRatio(region = {}) {
  const sourceDurationSeconds = getAudioSourceDurationSeconds(region)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds,
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  return stretch.enabled ? stretch.lengthRatio : 1
}
function getAudioRegionVisibleDurationSeconds(region = {}) {
  const sourceDurationSeconds = getAudioSourceDurationSeconds(region)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds,
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  return Math.max(minAudioRegionSeconds, stretch.enabled ? (stretch.targetDurationSeconds || sourceDurationSeconds) : sourceDurationSeconds)
}
function getAudioRegionPlaybackRate(region = {}) {
  return clamp(getAudioSourceDurationSeconds(region) / getAudioRegionVisibleDurationSeconds(region), 0.05, 4)
}
function syncAudioRegionTimeline(region = {}) {
  if (region.type !== 'audio') return region
  const startBeat = Number(region.startBeat) || Number(region.timelineStartBeats) || 0
  const sourceDurationSeconds = getAudioSourceDurationSeconds(region)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds,
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  const visibleDurationSeconds = Math.max(minAudioRegionSeconds, stretch.enabled ? (stretch.targetDurationSeconds || sourceDurationSeconds) : sourceDurationSeconds)
  region.startBeat = startBeat
  region.timelineStartBeats = startBeat
  region.timelineStartSeconds = getTimelineSecondsAtBeat(startBeat)
  region.visibleDurationSeconds = visibleDurationSeconds
  region.durationSeconds = visibleDurationSeconds
  region.durationBeats = secondsToBeats(visibleDurationSeconds)
  region.endBeat = startBeat + region.durationBeats
  region.playbackRate = getAudioRegionPlaybackRate(region)
  region.stretch = stretch
  return region
}

const tracks = [
  {
    id: 'demo-track',
    name: 'Demo Track',
    type: 'software',
    color: '#ff4d5d',
    colorSoft: 'rgba(255, 77, 93, 0.26)',
    icon: 'instrument',
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
const AUDIO_EFFECT_TYPES = AUDIO_EFFECT_MANIFESTS
  .filter((manifest) => manifest.implemented)
  .map(({ id, name }) => ({ type: id, name }))

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
  software: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 10h10"/><path d="M7 14h10"/></svg>',
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
const renderAddTrackModal = () => !addTrackModalOpen ? '' : `<div class="studio-add-track-modal" data-add-track-backdrop>
  <section class="studio-add-track-panel" role="dialog" aria-modal="true" aria-labelledby="studio-add-track-title">
    <header><div><span>New Track</span><h3 id="studio-add-track-title">Add Track</h3></div><button type="button" data-close-add-track aria-label="Close Add Track">Close</button></header>
    <div class="studio-add-track-options">
      <button type="button" class="studio-add-track-option" data-create-track-type="software">
        <span class="studio-add-track-option-icon">${trackTypeIcon('software')}</span>
        <strong>Software Track</strong>
        <small>MIDI regions, instruments, MIDI effects, and post-instrument audio FX.</small>
      </button>
      <button type="button" class="studio-add-track-option" data-create-track-type="audio">
        <span class="studio-add-track-option-icon">${trackTypeIcon('audio')}</span>
        <strong>Audio Track</strong>
        <small>Record from your mic or interface, edit the clip, and add Audio FX.</small>
      </button>
    </div>
  </section>
</div>`
const renderTrackCard = (track) => {
  const level = clamp(Number(track.outputLevel) || 0, 0, 1)
  return `<div class="studio-track-stack"><article class="studio-track-card ${selectedTrackId === track.id ? 'is-selected' : ''} ${timelineState.trackHeight <= 56 ? 'is-track-compact' : ''}" data-track-row="${track.id}" data-guide-id="studio-track-${esc(track.id)}" data-guide-label="${esc(track.name)} track" data-guide-role="daw-track" style="--track-color: ${track.color}; --track-color-soft: ${track.colorSoft};--track-meter-level:${level};"><div class="studio-track-header-row"><button class="studio-track-icon" type="button" aria-label="${track.name} track" data-track-icon="${track.id}">${trackTypeIcon(normalizedTrackIconType(track))}</button><strong class="studio-track-name">${track.name}</strong><button class="studio-track-more" type="button" data-track-options="${track.id}" aria-label="Track options" data-tooltip="Track options">${icon('more')}</button></div><div class="studio-track-control-row"><button type="button" class="studio-track-control ${track.muted ? 'is-active' : ''}" data-track-mute="${track.id}" aria-label="Mute ${track.name}" data-tooltip="Mute">${icon('mute')}</button><button type="button" class="studio-track-control ${track.soloed ? 'is-active' : ''}" data-track-solo="${track.id}" aria-label="Solo ${track.name}" data-tooltip="Solo">${icon('solo')}</button><button type="button" class="studio-record-arm ${track.recordArmed ? 'is-active' : ''}" data-track-record="${track.id}" aria-label="Record arm ${track.name}" data-tooltip="Record arm">R</button><button type="button" class="studio-track-control" data-track-automation="${track.id}" aria-label="Automation ${track.name}" data-tooltip="Automation">${icon('automation')}</button><input class="studio-track-volume" data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}" aria-label="${track.name} volume" /><button class="studio-track-pan" type="button" aria-label="${track.name} pan ${Math.round(track.pan)}" data-tooltip="Pan ${Math.round(track.pan)}" data-track-pan="${track.id}" style="--pan-angle: ${(track.pan / 100) * 135}deg"></button><span class="studio-track-meter-separator" aria-hidden="true"></span><span class="studio-track-meter" data-track-meter="${track.id}" aria-label="${track.name} output meter"><i style="height:${Math.round(level * 100)}%"></i><b style="bottom:${Math.round(level * 100)}%"></b></span></div></article>${track.automationOpen ? '<div class="studio-automation-lane"><span>Automation</span><button type="button">Volume</button><button type="button">Pan</button><button type="button">Filter</button><button type="button">Add</button></div>' : ''}</div>`
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
  const isAudioRegion = region.type === 'audio'
  return `<div class="studio-midi-context-menu" data-midi-context-menu style="left:${Math.round(midiRegionMenuState.x)}px;top:${Math.round(midiRegionMenuState.y)}px">
    <strong>${esc(getMidiRegionLabel(region))}</strong>
    <button type="button" data-midi-region-action="view-roll">Open Region Editor</button>
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
function renderPitchTraceView(region, track) {
  const edit = normalizeAudioEdit(region.audioEdit)
  const trace = edit.pitchTrace
  const visibleDuration = Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region))
  const notes = (trace.notes || []).filter((note)=>note.confidence >= trace.confidenceThreshold)
  const noteValues = notes.map((note)=>Number(note.editedMidiNote ?? note.midiNote)).filter(Number.isFinite)
  const minNote = Math.max(0, Math.min(48, ...(noteValues.length ? noteValues : [48])) - 2)
  const maxNote = Math.min(127, Math.max(72, ...(noteValues.length ? noteValues : [72])) + 2)
  const rowCount = Math.max(1, maxNote - minNote + 1)
  const beatCount = Math.max(1, Math.ceil(secondsToBeats(visibleDuration)))
  const color = getReadableWaveformColor(region.color || track?.color || '#58d4ff')
  const blocks = notes.map((note)=> {
    const left = clamp((Number(note.startSeconds) || 0) / visibleDuration, 0, 1) * 100
    const width = clamp((Number(note.durationSeconds) || 0.01) / visibleDuration, 0.002, 1) * 100
    const editedMidi = clamp(Math.round(Number(note.editedMidiNote ?? note.midiNote) || 60), minNote, maxNote)
    const row = maxNote - editedMidi
    const top = (row / rowCount) * 100
    const height = Math.max(6, (1 / rowCount) * 100)
    const opacity = clamp(0.35 + ((Number(note.confidence) || 0) * 0.55), 0.35, 0.92)
    const delta = editedMidi - (Number(note.originalMidiNote) || editedMidi)
    const stateClass = [
      pitchTraceSelectedNoteId === note.id ? 'is-selected' : '',
      delta ? 'is-edited' : '',
      note.muted ? 'is-muted' : ''
    ].filter(Boolean).join(' ')
    const deltaLabel = delta ? ` · ${delta > 0 ? '+' : ''}${delta} st` : ''
    return `<button type="button" class="studio-pitch-trace-note ${stateClass}" data-pitch-trace-note="${esc(note.id)}" style="left:${left.toFixed(3)}%;width:${width.toFixed(3)}%;top:${top.toFixed(3)}%;height:${height.toFixed(3)}%;--pitch-note-color:${esc(color)};opacity:${opacity.toFixed(2)}" title="${esc(formatMidiNoteName(editedMidi))}${esc(deltaLabel)} · ${Math.round((note.confidence || 0) * 100)}%"><span data-pitch-trace-note-handle="left"></span><b>${esc(formatMidiNoteName(editedMidi))}</b><span data-pitch-trace-note-handle="right"></span></button>`
  }).join('')
  const labels = Array.from({ length: rowCount }, (_, index) => {
    const midi = maxNote - index
    return midi % 12 === 0 ? `<span style="top:${((index / rowCount) * 100).toFixed(3)}%">${esc(formatMidiNoteName(midi))}</span>` : ''
  }).join('')
  const beatLines = Array.from({ length: beatCount + 1 }, (_, index)=>`<i style="left:${((index / beatCount) * 100).toFixed(3)}%"></i>`).join('')
  const status = trace.status === 'analyzing'
    ? `Analyzing${trace.progress ? ` ${Math.round(trace.progress * 100)}%` : '...'}`
    : trace.status === 'ready'
      ? `Ready · ${notes.length} note${notes.length === 1 ? '' : 's'}`
      : trace.status === 'failed'
        ? `Failed · ${trace.error || 'Try again'}`
        : 'Idle'
  return `<div class="studio-pitch-trace-view" data-pitch-trace-view data-pitch-min="${minNote}" data-pitch-max="${maxNote}" data-pitch-duration="${visibleDuration}" style="--pitch-row-count:${rowCount}">
    <div class="studio-pitch-trace-waveform">${renderAudioWaveform(region)}</div>
    <div class="studio-pitch-trace-grid" aria-hidden="true">${beatLines}</div>
    <div class="studio-pitch-trace-labels" aria-hidden="true">${labels}</div>
    <div class="studio-pitch-trace-notes" data-pitch-trace-grid>${blocks || '<p>No detected notes yet. Click Analyze Audio to create a Pitch Trace.</p>'}</div>
    <small>Pitch Trace: ${esc(status)}</small>
  </div>`
}
function getPitchTraceEditedNoteCount(trace = {}) {
  return (trace.notes || []).filter((note)=>note.muted === true || note.editedMidiNote !== note.originalMidiNote || Math.abs(Number(note.gainDb) || 0) > 0.001).length
}
function getSelectedPitchTraceNote(region) {
  if (!region || region.type !== 'audio' || !pitchTraceSelectedNoteId) return null
  const trace = normalizeAudioEdit(region.audioEdit).pitchTrace
  return (trace.notes || []).find((note)=>note.id === pitchTraceSelectedNoteId) || null
}
function renderPitchTraceToolPane(region, missing = false) {
  const edit = normalizeAudioEdit(region.audioEdit)
  const trace = edit.pitchTrace
  const selectedPitchNote = getSelectedPitchTraceNote(region)
  const editedPitchNoteCount = getPitchTraceEditedNoteCount(trace)
  const pitchTraceRenderStatus = trace.renderStatus === 'needs_render' ? 'Needs render' : (trace.lastError || trace.renderStatus || 'idle')
  return `<aside class="studio-midi-roll-tools studio-pitch-trace-tools-pane" data-pitch-trace-scroll>
    <h3>Pitch Trace</h3>
    <div class="studio-editor-tool-toggle" role="toolbar" aria-label="Pitch Trace tools">
      <button type="button" data-pitch-trace-tool="cursor" class="${pitchTraceTool === 'cursor' ? 'is-active' : ''}" aria-pressed="${String(pitchTraceTool === 'cursor')}">Cursor</button>
      <button type="button" data-pitch-trace-tool="pencil" class="${pitchTraceTool === 'pencil' ? 'is-active' : ''}" aria-pressed="${String(pitchTraceTool === 'pencil')}">Pencil</button>
    </div>
    <p>${pitchTraceTool === 'pencil' ? 'Draw Audio Notes on the Pitch Trace grid.' : 'Select, drag, and resize Audio Notes.'}</p>
    <label><input type="checkbox" data-pitch-trace-enabled ${trace.enabled ? 'checked' : ''}> Pitch Trace enabled</label>
    <label>Confidence<input type="range" min="0.3" max="0.95" step="0.05" data-pitch-trace-threshold value="${trace.confidenceThreshold}"><small>${Math.round(trace.confidenceThreshold * 100)}%</small></label>
    <button type="button" data-pitch-trace-analyze ${missing || trace.status === 'analyzing' ? 'disabled' : ''}>${trace.notes.length ? 'Re-analyze Audio' : 'Analyze Audio'}</button>
    <button type="button" data-pitch-trace-clear ${trace.notes.length || trace.status === 'failed' ? '' : 'disabled'}>Clear Analysis</button>
    <button type="button" data-pitch-trace-render ${trace.enabled && trace.notes.length && !missing && trace.renderStatus !== 'rendering' ? '' : 'disabled'}>${trace.renderStatus === 'failed' ? 'Retry Pitch Edits' : 'Render Pitch Edits'}</button>
    ${selectedPitchNote ? `<div class="studio-pitch-trace-note-tools">
      <strong>${esc(formatMidiNoteName(selectedPitchNote.editedMidiNote))}</strong>
      <span>${selectedPitchNote.source === 'manual' ? 'Manual Audio Note' : 'Analyzed Audio Note'} · Original ${esc(formatMidiNoteName(selectedPitchNote.originalMidiNote))}</span>
      <label>Start<input type="number" min="0" step="0.01" data-pitch-trace-note-field="startSeconds" value="${Number(selectedPitchNote.startSeconds || 0).toFixed(2)}"></label>
      <label>Length<input type="number" min="0.03" step="0.01" data-pitch-trace-note-field="durationSeconds" value="${Number(selectedPitchNote.durationSeconds || 0.03).toFixed(2)}"></label>
      <label>Edited Note<input type="number" min="0" max="127" step="1" data-pitch-trace-note-field="editedMidiNote" value="${Number(selectedPitchNote.editedMidiNote || 60)}"><small>${esc(formatMidiNoteName(selectedPitchNote.editedMidiNote))}</small></label>
      <button type="button" data-pitch-trace-note-reset="${esc(selectedPitchNote.id)}">Reset Note</button>
      <button type="button" data-pitch-trace-note-mute="${esc(selectedPitchNote.id)}">${selectedPitchNote.muted ? 'Unmute Note' : 'Mute Note'}</button>
      <button type="button" data-pitch-trace-note-delete="${esc(selectedPitchNote.id)}">Delete Note</button>
    </div>` : '<small>Select or draw an Audio Note to edit it.</small>'}
    <small>Analysis: ${esc(trace.status === 'analyzing' ? 'Analyzing...' : trace.status)} · Render: ${esc(pitchTraceRenderStatus)}${editedPitchNoteCount ? ` · ${editedPitchNoteCount} edit${editedPitchNoteCount === 1 ? '' : 's'}` : ''}</small>
  </aside>`
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
function formatBitDepth(region = {}) {
  const bitDepth = Number(region.bitDepth ?? region.audioClip?.bitDepth)
  const source = region.bitDepthSource || region.audioClip?.bitDepthSource || 'unknown'
  if (Number.isFinite(bitDepth) && bitDepth > 0) return `${bitDepth}-bit`
  if (source === 'not_applicable') return 'Compressed / not directly available'
  return 'Unknown'
}
function formatRenderedBitDepth(value = null) {
  const bitDepth = Number(value)
  return Number.isFinite(bitDepth) && bitDepth > 0 ? `${bitDepth}-bit` : 'Unknown'
}
function getAudioSourceBitDepth(region = {}) {
  const bitDepth = Number(region.bitDepth ?? region.audioClip?.bitDepth)
  return Number.isFinite(bitDepth) && bitDepth > 0 ? bitDepth : null
}
function getActiveRenderedAudioMetadata(region = {}) {
  const edit = normalizeAudioEdit(region.audioEdit)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  if (edit.pitchTrace?.renderStatus === 'ready' && edit.pitchTrace.renderedAudio) return edit.pitchTrace.renderedAudio
  if (edit.pitchShift?.renderStatus === 'ready' && edit.pitchShift.renderedAudio) return edit.pitchShift.renderedAudio
  if (stretch.renderStatus === 'ready' && stretch.renderedAudio) return stretch.renderedAudio
  if (edit.reverse?.renderStatus === 'ready' && edit.reverse.renderedAudio) return edit.reverse.renderedAudio
  return null
}
function formatStorageStatus(region = {}) {
  if (region.audioClip?.loadStatus === 'ready' || region.audioClip?.audioReady) return 'Loaded'
  if (region.audioClip?.loadStatus === 'loading' || region.audioClip?.loadStatus === 'pending') return 'Loading'
  if (region.missingMedia || region.audioClip?.loadStatus === 'missing' || region.audioClip?.loadStatus === 'failed') return 'Offline / missing'
  return region.audioClip?.storagePath || region.audioClip?.downloadUrl ? 'Pending' : 'Offline / missing'
}
function getSouraDspStatusLabel(status = getSouraWasmDspStatusSnapshot()) {
  if (status.status === 'loaded') return 'Loaded'
  if (status.status === 'loading') return 'Loading'
  if (status.status === 'failed') return 'Failed'
  return 'Not loaded'
}
function isSouraDspRenderBlocked() {
  return getSouraWasmDspStatusSnapshot().status === 'failed'
}
function renderSouraDspStatus() {
  const status = getSouraWasmDspStatusSnapshot()
  const failed = status.status === 'failed'
  const legacy = isLegacyJsDspFallbackEnabled()
  return `<section class="studio-audio-dsp-status ${failed ? 'is-failed' : ''} ${legacy ? 'is-legacy' : ''}">
    <strong>DSP Engine</strong>
    <span>Engine: ${esc(status.engineLabel || 'Soura WASM DSP: Signalsmith Stretch')}</span>
    <span>Status: ${esc(getSouraDspStatusLabel(status))}</span>
    <span>Quality: ${esc(status.quality || 'High')}</span>
    ${failed ? `<em>WASM DSP engine is required for pitch/stretch rendering and failed to load.${status.error ? ` ${esc(status.error)}` : ''}</em>` : ''}
    ${legacy ? '<em>Legacy JavaScript DSP fallback is active. Audio quality is reduced.</em>' : ''}
  </section>`
}
function renderAudioSourceInfo(region = {}) {
  const clip = region.audioClip || {}
  const sourceLabel = (region.source || clip.source) === 'import' ? 'Imported' : 'Recorded'
  const sampleRate = Number(region.sampleRate ?? clip.sampleRate ?? region.audioContextSampleRate ?? region.projectSampleRate)
  const channels = Number(region.channelCount ?? clip.channelCount)
  const renderedAudio = getActiveRenderedAudioMetadata(region)
  const rows = [
    ['File name', clip.fileName || region.fileName || 'Unknown'],
    ['File type', clip.contentType || region.contentType || clip.fileType || region.fileType || 'Unknown'],
    ['Duration', formatAudioDuration(region.fileDurationSeconds || clip.fileDurationSeconds || getAudioFileDurationSeconds(region))],
    ['Sample rate', Number.isFinite(sampleRate) && sampleRate > 0 ? `${Math.round(sampleRate)} Hz` : 'Unknown'],
    ['Bit depth', formatBitDepth(region)],
    ['Channels', Number.isFinite(channels) && channels > 0 ? String(channels) : 'Unknown'],
    ['File size', clip.fileSizeBytes || region.fileSizeBytes ? formatFileSize(clip.fileSizeBytes || region.fileSizeBytes) : 'Unknown'],
    ['Source', sourceLabel],
    ['Storage status', formatStorageStatus(region)]
  ]
  if (renderedAudio) {
    rows.push(
      ['Rendered sample rate', renderedAudio.renderedSampleRate ? `${Math.round(renderedAudio.renderedSampleRate)} Hz` : 'Unknown'],
      ['Rendered bit depth', `${formatRenderedBitDepth(renderedAudio.renderedBitDepth)}${renderedAudio.bitDepthPreserved ? ' (preserved)' : renderedAudio.sourceBitDepth ? ' (changed)' : ' (source unknown)'}`],
      ['Render engine', renderedAudio.engineLabel || renderedAudio.engine || 'Unknown'],
      ['Render engine type', renderedAudio.engineType || 'Unknown'],
      ['Render algorithm', renderedAudio.algorithm || 'Unknown'],
      ['Render quality', renderedAudio.qualityMode || 'Unknown']
    )
  }
  return `<section class="studio-audio-file-info"><header><strong>Source Audio</strong><span>Read-only</span></header><dl>${rows.map(([label, value])=>`<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${renderSouraDspStatus()}</section>`
}
function renderAudioRegionEditorPanel(region, motionClass = '') {
  const style = bottomPanelHeightPx ? ` style="height:${bottomPanelHeightPx}px"` : ''
  const track = getMidiRegionTrack(region)
  const edit = normalizeAudioEdit(region.audioEdit)
  const pitchTrace = edit.pitchTrace
  const pitchShift = edit.pitchShift
  const selectedPitchNote = getSelectedPitchTraceNote(region)
  const editedPitchNoteCount = getPitchTraceEditedNoteCount(pitchTrace)
  const pitchShiftActive = Math.abs(Number(pitchShift.totalSemitones) || 0) > 0.001
  const pitchShiftStatus = pitchShift.renderStatus === 'needs_render' ? 'Needs render' : (pitchShift.lastError || pitchShift.renderStatus || 'idle')
  const pitchTraceRenderStatus = pitchTrace.renderStatus === 'needs_render' ? 'Needs render' : (pitchTrace.lastError || pitchTrace.renderStatus || 'idle')
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  const stretchMath = getAudioStretchMath(region)
  const missing = Boolean(region.missingMedia || region.audioClip?.loadStatus === 'missing' || region.audioClip?.loadStatus === 'failed')
  const dspBlocked = isSouraDspRenderBlocked()
  const dspBlockedTitle = dspBlocked ? 'title="WASM DSP engine is required for pitch/stretch rendering and failed to load."' : ''
  const renderStatus = stretch.renderStatus === 'needs_render' ? 'Needs render' : stretch.renderStatus
  const color = region.color || track?.color || '#58d4ff'
  const waveformColor = getReadableWaveformColor(color)
  return `<section class="studio-bottom-panel studio-midi-roll-editor studio-region-editor-audio ${motionClass}" data-audio-region-editor="${esc(region.id)}"${style}>
    <span class="studio-bottom-panel-resize" data-bottom-panel-resize></span>
    <header class="studio-bottom-panel-header studio-midi-roll-header"><div><strong>Region Editor</strong><span>${esc(track?.name || 'Audio Track')} · ${esc(getMidiRegionLabel(region))} · ${getAudioRegionVisibleDurationSeconds(region).toFixed(2)}s</span></div><nav><button type="button" data-detach-bottom-panel="midi-roll">Detach</button><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header>
    <div class="studio-bottom-panel-body studio-audio-region-editor-body ${pitchTrace.enabled ? 'has-pitch-trace-tools' : ''}">
      <section class="studio-audio-region-editor-preview">
        <div class="studio-audio-editor-waveform ${pitchTrace.enabled ? 'has-pitch-trace' : ''}" style="--region-color:${esc(color)};--waveform-color:${esc(waveformColor)}">${pitchTrace.enabled ? renderPitchTraceView(region, track) : renderAudioWaveform(region)}</div>
        <div class="studio-audio-editor-meta">
          <span>Start ${Number(region.startBeat || 0).toFixed(2)} beats</span>
          <span>Length ${getAudioRegionVisibleDurationSeconds(region).toFixed(2)}s</span>
          <span>Speed ${Math.round(stretchMath.speedPercent)}%</span>
          <span>${esc(getAudioClipStatusLabel(region))}</span>
        </div>
        ${missing ? `<p class="studio-audio-editor-warning" title="${esc(getAudioOfflineMessage(region))}">${esc(region.audioClip?.loadError || getAudioOfflineMessage(region))}</p>` : ''}
      </section>
      ${pitchTrace.enabled ? renderPitchTraceToolPane(region, missing) : ''}
      <aside class="studio-midi-roll-tools studio-audio-region-tools" data-region-editor-scroll>
        <h3>${esc(getMidiRegionLabel(region))}</h3>
        <label>Region name<input data-audio-region-name value="${esc(region.name || '')}" placeholder="${esc(track?.name || 'Audio Region')}"></label>
        ${renderAudioSourceInfo(region)}
        <div class="studio-audio-region-checks"><label><input type="checkbox" data-audio-edit-field="mute" ${edit.mute ? 'checked' : ''}> Mute</label><label><input type="checkbox" data-audio-edit-field="loop" ${edit.loop ? 'checked' : ''}> Loop</label></div>
        <label>Quantize<select data-audio-edit-field="quantize" disabled>${AUDIO_QUANTIZE_OPTIONS.map((value)=>`<option value="${value}" ${edit.quantize===value?'selected':''}>${value === 'off' ? 'Off' : value}</option>`).join('')}</select><small>Coming soon</small></label>
        <label>Q-Swing<input type="range" min="0" max="100" step="1" data-audio-edit-field="qSwing" value="${edit.qSwing}" disabled><small>Coming soon</small></label>
        <label>Q-Range<input type="number" step="0.1" data-audio-edit-field="qRange" value="${edit.qRange ?? ''}" placeholder="Coming soon" disabled></label>
        <label>Q-Strength<input type="range" min="0" max="100" step="1" data-audio-edit-field="qStrength" value="${edit.qStrength}" disabled><small>Coming soon</small></label>
        <label>Transpose<input type="number" min="-48" max="48" step="1" data-audio-edit-field="transposeSemitones" value="${edit.transposeSemitones}"><small>semitones</small></label>
        <label>Fine Tune<input type="number" min="-100" max="100" step="1" data-audio-edit-field="fineTuneCents" value="${edit.fineTuneCents}"><small>cents</small></label>
        <button type="button" data-audio-render-pitch-shift ${pitchShiftActive && !missing && !dspBlocked && pitchShift.renderStatus !== 'rendering' ? '' : 'disabled'} ${dspBlockedTitle}>${pitchShift.renderStatus === 'failed' ? 'Retry Pitch Shift' : 'Render Pitch Shift'}</button>
        <small>Pitch Shift: ${esc(pitchShiftStatus)}${pitchShiftActive ? ` · ${Number(pitchShift.totalSemitones).toFixed(2)} st` : ''}</small>
        <label>Pitch Source<select data-audio-edit-field="pitchSource" disabled><option>Off</option><option>Region</option><option>Project Key</option></select><small>Coming soon</small></label>
        <hr>
        <div class="studio-pitch-trace-controls">
          ${pitchTrace.enabled ? '<p>Pitch Trace tools are shown in the dedicated pane beside the editor.</p>' : `<label><input type="checkbox" data-pitch-trace-enabled> Pitch Trace</label>
          <p>Analyze the audio region, then drag detected notes vertically to retune audio segments.</p>
          <label>Confidence<input type="range" min="0.3" max="0.95" step="0.05" data-pitch-trace-threshold value="${pitchTrace.confidenceThreshold}"><small>${Math.round(pitchTrace.confidenceThreshold * 100)}%</small></label>
          <button type="button" data-pitch-trace-analyze ${missing || pitchTrace.status === 'analyzing' ? 'disabled' : ''}>${pitchTrace.notes.length ? 'Re-analyze Audio' : 'Analyze Audio'}</button>
          <button type="button" data-pitch-trace-clear ${pitchTrace.notes.length || pitchTrace.status === 'failed' ? '' : 'disabled'}>Clear Analysis</button>
          <button type="button" data-pitch-trace-render ${pitchTrace.enabled && pitchTrace.notes.length && !missing && !dspBlocked && pitchTrace.renderStatus !== 'rendering' ? '' : 'disabled'} ${dspBlockedTitle}>${pitchTrace.renderStatus === 'failed' ? 'Retry Pitch Trace Render' : 'Render Pitch Trace'}</button>
          ${selectedPitchNote ? `<div class="studio-pitch-trace-note-tools">
            <strong>${esc(formatMidiNoteName(selectedPitchNote.editedMidiNote))}</strong>
            <span>Original ${esc(formatMidiNoteName(selectedPitchNote.originalMidiNote))} · ${selectedPitchNote.editedMidiNote - selectedPitchNote.originalMidiNote > 0 ? '+' : ''}${selectedPitchNote.editedMidiNote - selectedPitchNote.originalMidiNote} st</span>
            <button type="button" data-pitch-trace-note-reset="${esc(selectedPitchNote.id)}" ${selectedPitchNote.editedMidiNote === selectedPitchNote.originalMidiNote && !selectedPitchNote.muted ? 'disabled' : ''}>Reset Note</button>
            <button type="button" data-pitch-trace-note-mute="${esc(selectedPitchNote.id)}">${selectedPitchNote.muted ? 'Unmute Note' : 'Mute Note'}</button>
          </div>` : '<small>Select and drag a Pitch Trace note to edit pitch.</small>'}
          <small>Pitch Trace: ${esc(pitchTrace.status === 'analyzing' ? 'Analyzing...' : pitchTrace.status)} · Render: ${esc(pitchTraceRenderStatus)}${editedPitchNoteCount ? ` · ${editedPitchNoteCount} edit${editedPitchNoteCount === 1 ? '' : 's'}` : ''}</small>`}
        </div>
        <label>Gain<input type="range" min="-24" max="24" step="0.5" data-audio-edit-field="gainDb" value="${edit.gainDb}"><small>${edit.gainDb.toFixed(1)} dB</small></label>
        <label>Delay<input type="number" min="0" max="2000" step="1" data-audio-edit-field="delayMs" value="${edit.delayMs}"><small>ms</small></label>
        <label>Fade-In<input type="number" min="0" step="0.01" data-audio-edit-field="fadeInSeconds" value="${edit.fadeInSeconds}"><small>seconds</small></label>
        <label>Fade-In Curve<select data-audio-edit-field="fadeInCurve">${AUDIO_FADE_CURVES.map((value)=>`<option value="${value}" ${edit.fadeInCurve===value?'selected':''}>${value}</option>`).join('')}</select></label>
        <label>Fade-Out<input type="number" min="0" step="0.01" data-audio-edit-field="fadeOutSeconds" value="${edit.fadeOutSeconds}"><small>seconds</small></label>
        <label>Fade-Out Curve<select data-audio-edit-field="fadeOutCurve">${AUDIO_FADE_CURVES.map((value)=>`<option value="${value}" ${edit.fadeOutCurve===value?'selected':''}>${value}</option>`).join('')}</select></label>
        <div class="studio-audio-region-checks"><label><input type="checkbox" data-audio-edit-field="reverse" ${edit.reverse.enabled ? 'checked' : ''}> Reverse</label></div>
        <button type="button" data-audio-render-reverse ${edit.reverse.enabled && !missing && edit.reverse.renderStatus !== 'rendering' ? '' : 'disabled'}>${edit.reverse.renderStatus === 'failed' ? 'Retry Reverse Render' : 'Render Reverse'}</button>
        <small>Reverse: ${esc(edit.reverse.lastError || (edit.reverse.renderStatus === 'needs_render' ? 'Needs render' : edit.reverse.renderStatus || 'idle'))}</small>
        <hr>
        <div class="studio-audio-stretch-controls">
          <label><input type="checkbox" data-audio-stretch-enabled ${stretch.enabled ? 'checked' : ''}> Stretch enabled</label>
          <label>Speed %<input type="number" min="${STRETCH_SPEED_MIN}" max="${STRETCH_SPEED_MAX}" step="1" data-audio-stretch-speed value="${Math.round(stretchMath.speedPercent)}"></label>
          <label>Target Length<input type="number" min="${minAudioRegionSeconds}" step="0.01" data-audio-stretch-length value="${stretchMath.targetDurationSeconds.toFixed(2)}"></label>
          <label>Length Ratio<input type="number" min="${STRETCH_RATIO_MIN}" max="${STRETCH_RATIO_MAX}" step="0.01" data-audio-stretch-ratio value="${stretchMath.lengthRatio.toFixed(2)}"></label>
          <p>Stretch Ratio: ${stretchMath.lengthRatio.toFixed(2)}x length · Status: ${esc(stretch.renderError || renderStatus || 'idle')}</p>
          <button type="button" data-audio-render-stretch ${stretch.enabled && !missing && !dspBlocked && stretchMath.supported ? '' : 'disabled'} ${dspBlockedTitle}>${stretch.renderStatus === 'failed' ? 'Retry Render' : 'Render Stretch'}</button>
          <button type="button" data-audio-reset-stretch ${stretch.enabled ? '' : 'disabled'}>Reset Stretch</button>
        </div>
      </aside>
    </div>
  </section>`
}
function renderMidiRollPanel(motionClass = '') {
  const selectedRegion = midiRegions.find((item)=>item.id === selectedMidiRegionId) || midiRegions.find((item)=>item.id === midiRollState?.regionId) || null
  if (selectedRegion?.type === 'audio') return renderAudioRegionEditorPanel(selectedRegion, motionClass)
  const region = selectedRegion?.type === 'midi' ? selectedRegion : getMidiRollRegion()
  const style = bottomPanelHeightPx ? ` style="height:${bottomPanelHeightPx}px"` : ''
  if (!region) {
    return `<section class="studio-bottom-panel studio-midi-roll-editor ${motionClass}"${style}><span class="studio-bottom-panel-resize" data-bottom-panel-resize></span><header class="studio-bottom-panel-header"><strong>Region Editor</strong><nav><button type="button" data-detach-bottom-panel="midi-roll">Detach</button><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header><div class="studio-bottom-panel-body"><p>Select a MIDI or audio region to edit.</p></div></section>`
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
    <header class="studio-bottom-panel-header studio-midi-roll-header"><div><strong>Region Editor</strong><span>${esc(track?.name || 'Track')} · ${esc(getMidiRegionLabel(region))} · ${Number(region.startBeat || 0).toFixed(2)}-${Number(region.endBeat || 0).toFixed(2)} · ${notes.length} notes</span></div><nav><button type="button" data-detach-bottom-panel="midi-roll">Detach</button><button class="studio-bottom-panel-close" data-close-bottom-panel aria-label="Close panel"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg></button></nav></header>
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
        <div class="studio-editor-tool-toggle" role="toolbar" aria-label="MIDI editor tools">
          <button type="button" data-midi-roll-tool="cursor" class="${midiRollTool === 'cursor' ? 'is-active' : ''}" aria-pressed="${String(midiRollTool === 'cursor')}">Cursor</button>
          <button type="button" data-midi-roll-tool="pencil" class="${midiRollTool === 'pencil' ? 'is-active' : ''}" aria-pressed="${String(midiRollTool === 'pencil')}">Pencil</button>
        </div>
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
function getLiveRegionIds() {
  return new Set(midiRegions.map((region)=>region.id).filter(Boolean))
}
function pruneSelectedRegionIds() {
  const liveIds = getLiveRegionIds()
  Array.from(selectedRegionIds).forEach((id)=>{ if (!liveIds.has(id)) selectedRegionIds.delete(id) })
  if (selectedMidiRegionId && !liveIds.has(selectedMidiRegionId)) selectedMidiRegionId = selectedRegionIds.values().next().value || ''
}
function getSelectedRegionIds() {
  pruneSelectedRegionIds()
  if (!selectedRegionIds.size && selectedMidiRegionId) selectedRegionIds.add(selectedMidiRegionId)
  return Array.from(selectedRegionIds).filter((id)=>midiRegions.some((region)=>region.id === id))
}
function regionIsSelected(regionId) {
  return getSelectedRegionIds().includes(regionId)
}
function setSelectedRegions(regionIds = [], { primaryId = null } = {}) {
  selectedRegionIds.clear()
  regionIds.filter(Boolean).forEach((id)=>selectedRegionIds.add(id))
  selectedMidiRegionId = primaryId || regionIds.find(Boolean) || ''
}
function selectSingleRegion(regionId) {
  setSelectedRegions(regionId ? [regionId] : [], { primaryId: regionId || '' })
}
function toggleRegionSelection(regionId) {
  if (!regionId) return
  pruneSelectedRegionIds()
  if (selectedRegionIds.has(regionId)) selectedRegionIds.delete(regionId)
  else selectedRegionIds.add(regionId)
  selectedMidiRegionId = selectedRegionIds.has(regionId) ? regionId : (selectedRegionIds.values().next().value || '')
}
function clearRegionSelection() {
  setSelectedRegions([])
}
function getSelectedRegions() {
  const ids = new Set(getSelectedRegionIds())
  return midiRegions.filter((region)=>ids.has(region.id)).sort((a,b)=>(Number(a.startBeat)||0)-(Number(b.startBeat)||0))
}
function getRegionBeatRange(region = {}) {
  if (region.type === 'audio') syncAudioRegionTimeline(region)
  const startBeat = Number(region.startBeat) || 0
  const fallbackLength = region.type === 'audio' ? secondsToBeats(getAudioRegionVisibleDurationSeconds(region)) : Math.max(0.25, Number(region.durationBeats) || 1)
  const endBeat = Math.max(startBeat + 0.001, Number(region.endBeat) || (startBeat + fallbackLength))
  return { startBeat, endBeat }
}
function stopRegionPlayback(regionId) {
  activePlaybackNotes.forEach((active, key) => { if (active.regionId === regionId) stopPlaybackNote(key) })
  stopAudioClipPlayback(regionId)
}
function invalidateAudioRegionRenderState(region) {
  if (!region || region.type !== 'audio') return region
  const sourceDurationSeconds = getAudioSourceDurationSeconds(region)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds,
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  if (stretch.enabled && stretch.renderStatus === 'ready') {
    region.stretch = {
      ...stretch,
      renderStatus: 'needs_render',
      renderedObjectUrl: null,
      renderedAudioUrl: null,
      renderedStoragePath: null,
      renderedRuntimeId: null,
      renderedDurationSeconds: null,
      renderedAt: null,
      renderedAudio: null,
      renderError: null,
      lastError: null
    }
  } else {
    region.stretch = stretch
  }
  const edit = normalizeAudioEdit(region.audioEdit)
  if (edit.pitchShift?.renderStatus === 'ready') {
    edit.pitchShift = { ...edit.pitchShift, renderStatus: 'needs_render', renderedStoragePath: null, renderedAudioUrl: null, renderedRuntimeId: null, renderedDurationSeconds: null, renderedAt: null, renderedAudio: null, lastError: null }
  }
  if (edit.pitchTrace?.renderStatus === 'ready') {
    edit.pitchTrace = { ...edit.pitchTrace, renderStatus: getPitchTraceEditedNoteCount(edit.pitchTrace) ? 'needs_render' : 'idle', renderedStoragePath: null, renderedAudioUrl: null, renderedRuntimeId: null, renderedDurationSeconds: null, renderedAt: null, renderedAudio: null, lastError: null }
  }
  if (edit.reverse?.renderStatus === 'ready') {
    edit.reverse = { ...edit.reverse, renderStatus: edit.reverse.enabled ? 'needs_render' : 'idle', renderedStoragePath: null, renderedAudioUrl: null, renderedRuntimeId: null, renderedDurationSeconds: null, renderedAt: null, renderedAudio: null, lastError: null }
  }
  region.audioEdit = edit
  region.renderedWaveform = null
  region.stretchRender = null
  return region
}
function makeAudioRegionSlice(region, sliceStartBeat, sliceEndBeat, { preserveId = false } = {}) {
  const { startBeat, endBeat } = getRegionBeatRange(region)
  const nextStart = clamp(sliceStartBeat, startBeat, endBeat)
  const nextEnd = clamp(sliceEndBeat, nextStart, endBeat)
  if (nextEnd - nextStart < 0.01) return null
  const playbackRate = getAudioRegionPlaybackRate(region)
  const trimStart = getAudioTrimStartSeconds(region)
  const sourceStart = trimStart + (beatsToSeconds(nextStart - startBeat) * playbackRate)
  const sourceEnd = trimStart + (beatsToSeconds(nextEnd - startBeat) * playbackRate)
  const visibleDurationSeconds = Math.max(minAudioRegionSeconds, beatsToSeconds(nextEnd - nextStart))
  const sourceDurationSeconds = Math.max(minAudioRegionSeconds, sourceEnd - sourceStart)
  const slice = cloneRegionForState(region, { persist: false })
  if (!preserveId) slice.id = makeInsertId('audio-region')
  slice.startBeat = nextStart
  slice.endBeat = nextEnd
  slice.timelineStartBeats = nextStart
  slice.timelineStartSeconds = getTimelineSecondsAtBeat(nextStart)
  slice.trimStartSeconds = sourceStart
  slice.trimEndSeconds = sourceEnd
  slice.visibleDurationSeconds = visibleDurationSeconds
  slice.durationSeconds = visibleDurationSeconds
  slice.durationBeats = nextEnd - nextStart
  slice.clipId = region.clipId || region.audioClip?.audioAssetId || region.audioClip?.id || region.id
  slice.audioClip = { ...(region.audioClip || {}), runtimeId: region.audioClip?.runtimeId || region.id, audioAssetId: region.audioClip?.audioAssetId || region.audioClip?.id || region.clipId || region.id, id: region.audioClip?.id || region.clipId || region.id }
  const wasStretched = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  }).enabled
  slice.stretch = wasStretched ? createPendingStretchMetadata({ sourceDurationSeconds, targetDurationSeconds: visibleDurationSeconds }) : makeDefaultAudioStretch(sourceDurationSeconds)
  invalidateAudioRegionRenderState(slice)
  syncAudioRegionTimeline(slice)
  return slice
}
function makeMidiRegionSlice(region, sliceStartBeat, sliceEndBeat, { preserveId = false } = {}) {
  const { startBeat, endBeat } = getRegionBeatRange(region)
  const nextStart = clamp(sliceStartBeat, startBeat, endBeat)
  const nextEnd = clamp(sliceEndBeat, nextStart, endBeat)
  if (nextEnd - nextStart < 0.01) return null
  const slice = cloneRegionForState(region, { persist: false })
  if (!preserveId) slice.id = makeInsertId('midi-region')
  slice.startBeat = nextStart
  slice.endBeat = nextEnd
  slice.notes = (region.notes || []).map((note) => {
    const noteStart = Number(note.startBeat) || startBeat
    const noteEnd = noteStart + Math.max(0.05, Number(note.durationBeats) || 0.05)
    const overlapStart = Math.max(noteStart, nextStart)
    const overlapEnd = Math.min(noteEnd, nextEnd)
    if (overlapEnd - overlapStart < 0.01) return null
    const changed = overlapStart !== noteStart || overlapEnd !== noteEnd || !preserveId
    return { ...note, id: changed ? makeInsertId('note') : note.id, startBeat: overlapStart, durationBeats: Math.max(0.01, overlapEnd - overlapStart) }
  }).filter(Boolean)
  return slice
}
function sliceRegionForBeatRange(region, startBeat, endBeat, options = {}) {
  return region.type === 'audio'
    ? makeAudioRegionSlice(region, startBeat, endBeat, options)
    : makeMidiRegionSlice(region, startBeat, endBeat, options)
}
function splitExistingRegionAroundIncoming(existingRegion, incomingRegion) {
  const existing = getRegionBeatRange(existingRegion)
  const incoming = getRegionBeatRange(incomingRegion)
  if (existingRegion.trackId !== incomingRegion.trackId || existing.endBeat <= incoming.startBeat || existing.startBeat >= incoming.endBeat) return [existingRegion]
  stopRegionPlayback(existingRegion.id)
  const pieces = []
  if (existing.startBeat < incoming.startBeat - 0.001) {
    const left = sliceRegionForBeatRange(existingRegion, existing.startBeat, incoming.startBeat, { preserveId: true })
    if (left) pieces.push(left)
  }
  if (existing.endBeat > incoming.endBeat + 0.001) {
    const right = sliceRegionForBeatRange(existingRegion, incoming.endBeat, existing.endBeat, { preserveId: pieces.length === 0 })
    if (right) pieces.push(right)
  }
  return pieces
}
function applyRegionPlacementWithOverlapResolution(incomingRegions = []) {
  const incoming = (Array.isArray(incomingRegions) ? incomingRegions : [incomingRegions]).filter(Boolean)
  if (!incoming.length) return []
  incoming.forEach((region)=>{ if (region.type === 'audio') syncAudioRegionTimeline(region) })
  const incomingIds = new Set(incoming.map((region)=>region.id).filter(Boolean))
  const sortedIncoming = incoming.slice().sort((a,b)=>{
    const trackDelta = tracks.findIndex((track)=>track.id === a.trackId) - tracks.findIndex((track)=>track.id === b.trackId)
    return trackDelta || (getRegionBeatRange(a).startBeat - getRegionBeatRange(b).startBeat)
  })
  let working = midiRegions.filter((region)=>!incomingIds.has(region.id))
  sortedIncoming.forEach((incomingRegion) => {
    const next = []
    working.forEach((existingRegion) => {
      next.push(...splitExistingRegionAroundIncoming(existingRegion, incomingRegion))
    })
    next.push(incomingRegion)
    working = next
  })
  midiRegions = working
  pruneSelectedRegionIds()
  return sortedIncoming
}
function getRegionTypeTrackType(region) {
  return region?.type === 'audio' ? 'audio' : 'software'
}
function trackSupportsRegionType(track, regionType) {
  if (!track) return false
  return regionType === 'audio' ? isAudioTrack(track) : !isAudioTrack(track)
}
function makeTrackForPaste({ regionType = 'midi', sourceTrack = null, insertIndex = tracks.length } = {}) {
  const type = getRegionTypeTrackType({ type: regionType })
  const id = makeTrackId()
  const source = sourceTrack ? ensureTrackInsertState(deepClone(sourceTrack)) : null
  const colors = source ? { color: source.color, colorSoft: source.colorSoft } : nextTrackColor(Math.max(0, insertIndex))
  const instrument = type === 'software' && source?.instrument ? { ...source.instrument, id: makeInsertId('instrument'), pluginInstanceId: `${source.instrument.type}:${id}`, params: { ...(source.instrument.params || {}) } } : null
  const track = ensureTrackInsertState({
    id,
    name: source ? `${source.name} Paste` : (type === 'audio' ? `Audio ${tracks.length + 1}` : `Software ${tracks.length + 1}`),
    type,
    color: colors.color,
    colorSoft: colors.colorSoft,
    icon: type === 'audio' ? 'audio' : 'instrument',
    muted: false,
    soloed: false,
    recordArmed: false,
    automationOpen: Boolean(source?.automationOpen),
    volume: Number.isFinite(Number(source?.volume)) ? Number(source.volume) : 72,
    pan: Number.isFinite(Number(source?.pan)) ? Number(source.pan) : 0,
    outputLevel: 0,
    midiEffects: type === 'software' ? cloneInsertList(source?.midiEffects || []) : [],
    instrument,
    audioEffects: cloneInsertList(source?.audioEffects || [])
  })
  tracks.splice(clamp(insertIndex, 0, tracks.length), 0, track)
  warmTrackInstrument(track, { reason: 'paste-region-track' })
  return track
}
function ensurePasteTargetTrack({ desiredIndex = 0, regionType = 'midi', sourceTrack = null } = {}) {
  const safeIndex = clamp(Number(desiredIndex) || 0, 0, Math.max(0, tracks.length))
  const existing = tracks[safeIndex]
  if (trackSupportsRegionType(existing, regionType)) return existing
  return makeTrackForPaste({ regionType, sourceTrack, insertIndex: safeIndex })
}
function copyMidiRegion(regionId = selectedMidiRegionId) {
  const ids = regionIsSelected(regionId) ? getSelectedRegionIds() : [regionId]
  const regions = midiRegions.filter((region)=>ids.includes(region.id))
  if (!regions.length) return
  const sorted = regions.sort((a,b)=>{
    const trackDelta = tracks.findIndex((track)=>track.id === a.trackId) - tracks.findIndex((track)=>track.id === b.trackId)
    return trackDelta || ((Number(a.startBeat)||0)-(Number(b.startBeat)||0))
  })
  const earliestStartBeat = Math.min(...sorted.map((region)=>Number(region.startBeat) || 0))
  const minTrackIndex = Math.min(...sorted.map((region)=>Math.max(0, tracks.findIndex((track)=>track.id === region.trackId))))
  midiRegionClipboard = {
    type: 'regions',
    earliestStartBeat,
    minTrackIndex,
    regions: sorted.map((region)=>({
      region: cloneRegionForState(region, { persist: false }),
      relativeStartBeat: (Number(region.startBeat) || 0) - earliestStartBeat,
      relativeTrackOffset: Math.max(0, tracks.findIndex((track)=>track.id === region.trackId)) - minTrackIndex,
      sourceTrack: deepClone(ensureTrackInsertState(tracks.find((track)=>track.id === region.trackId) || getSelectedTrack()))
    }))
  }
}
function cloneRegionForArrangementCopy(sourceRegion, { id = makeInsertId(sourceRegion.type === 'audio' ? 'audio-region' : 'midi-region'), trackId = sourceRegion.trackId, startBeat = Number(sourceRegion.startBeat) || 0 } = {}) {
  const sourceStart = Number(sourceRegion.startBeat) || 0
  const sourceEnd = Math.max(sourceStart + 0.25, Number(sourceRegion.endBeat) || sourceStart + 1)
  const length = Math.max(0.25, sourceEnd - sourceStart)
  const delta = startBeat - sourceStart
  const next = cloneRegionForState(sourceRegion, { persist: false })
  next.id = id
  next.trackId = trackId || sourceRegion.trackId
  next.startBeat = startBeat
  next.endBeat = startBeat + length
  next.color = next.independentColor || tracks.find((track)=>track.id === next.trackId)?.color || next.color
  next.name = next.name || ''
  if (next.type === 'midi') {
    next.notes = (sourceRegion.notes || []).map((note)=>({ ...note, startBeat: (Number(note.startBeat) || sourceStart) + delta }))
  } else if (next.type === 'audio') {
    next.clipId = sourceRegion.clipId || sourceRegion.audioClip?.audioAssetId || sourceRegion.audioClip?.id || sourceRegion.id
    next.audioClip = {
      ...(sourceRegion.audioClip || {}),
      runtimeId: sourceRegion.audioClip?.runtimeId || sourceRegion.id,
      audioAssetId: sourceRegion.audioClip?.audioAssetId || sourceRegion.audioClip?.id || sourceRegion.clipId || sourceRegion.id,
      id: sourceRegion.audioClip?.id || sourceRegion.clipId || sourceRegion.id
    }
    next.timelineStartBeats = startBeat
    next.timelineStartSeconds = getTimelineSecondsAtBeat(startBeat)
    syncAudioRegionTimeline(next)
  }
  return next
}
function pasteMidiRegion({ beat = clampBeat(xToBeat(timelineState.playheadX)), trackId = selectedTrackId } = {}) {
  if (!midiRegionClipboard?.regions?.length) return
  commitHistoryMutation('paste-midi-regions', () => {
    const startBeat = clampBeat(isSnapEnabled ? snapBeat(beat) : beat)
    const baseIndex = Math.max(0, tracks.findIndex((track)=>track.id === (trackId || selectedTrackId)))
    const sorted = midiRegionClipboard.regions.slice().sort((a,b)=>a.relativeTrackOffset-b.relativeTrackOffset || a.relativeStartBeat-b.relativeStartBeat)
    const created = []
    const incoming = []
    sorted.forEach((item) => {
      const sourceRegion = item.region
      const targetTrack = ensurePasteTargetTrack({
        desiredIndex: baseIndex + Number(item.relativeTrackOffset || 0),
        regionType: sourceRegion.type || 'midi',
        sourceTrack: item.sourceTrack
      })
      const copy = cloneRegionForArrangementCopy(sourceRegion, {
        trackId: targetTrack.id,
        startBeat: startBeat + Number(item.relativeStartBeat || 0)
      })
      incoming.push(copy)
      created.push(copy.id)
    })
    midiRegions.push(...incoming)
    applyRegionPlacementWithOverlapResolution(incoming)
    setSelectedRegions(created, { primaryId: created[0] || '' })
    selectedTrackId = tracks.find((track)=>track.id === (trackId || selectedTrackId))?.id || tracks[baseIndex]?.id || selectedTrackId
  })
}
function cleanupRegionAfterDelete(regionId) {
  stopRegionPlayback(regionId)
  if (midiRollState?.regionId === regionId) {
    midiRollState = null
    midiRollSelectedNoteIndex = null
    midiRollSelectedNoteIndices = []
    if (activeBottomPanel === 'midi-roll') activeBottomPanel = ''
  }
}
function deleteMidiRegion(regionId = selectedMidiRegionId) {
  const ids = regionIsSelected(regionId) ? getSelectedRegionIds() : [regionId]
  const deleteIds = ids.filter((id)=>midiRegions.some((region)=>region.id === id))
  if (!deleteIds.length) return
  commitHistoryMutation('delete-midi-regions', () => {
    midiRegions = midiRegions.filter((region)=>!deleteIds.includes(region.id))
    deleteIds.forEach(cleanupRegionAfterDelete)
    selectedRegionIds.clear()
    if (deleteIds.includes(selectedMidiRegionId)) selectedMidiRegionId = ''
  })
}
function duplicateSelectedRegions() {
  const regions = getSelectedRegions()
  if (!regions.length) return
  commitHistoryMutation('duplicate-midi-regions', () => {
    const groupStart = Math.min(...regions.map((region)=>Number(region.startBeat) || 0))
    const groupEnd = Math.max(...regions.map((region)=>Number(region.endBeat) || ((Number(region.startBeat) || 0) + 1)))
    const offset = Math.max(0.25, groupEnd - groupStart)
    const created = []
    const incoming = []
    regions.forEach((region) => {
      const copy = cloneRegionForArrangementCopy(region, { startBeat: (Number(region.startBeat) || 0) + offset })
      incoming.push(copy)
      created.push(copy.id)
    })
    midiRegions.push(...incoming)
    applyRegionPlacementWithOverlapResolution(incoming)
    setSelectedRegions(created, { primaryId: created[0] || '' })
  })
}
function loopSelectedRegions() {
  const regions = getSelectedRegions()
  if (!regions.length) return
  duplicateSelectedRegions()
}
function toggleSelectedRegionMute(regionId = selectedMidiRegionId) {
  const ids = regionIsSelected(regionId) ? getSelectedRegionIds() : [regionId]
  const regions = midiRegions.filter((region)=>ids.includes(region.id))
  if (!regions.length) return
  commitHistoryMutation('toggle-region-mute', () => {
    const nextMuted = !regions.every((region)=>region.type === 'audio' ? normalizeAudioEdit(region.audioEdit).mute : region.muted === true)
    regions.forEach((region) => {
      if (region.type === 'audio') region.audioEdit = { ...normalizeAudioEdit(region.audioEdit), mute: nextMuted }
      region.muted = nextMuted
      if (nextMuted) {
        activePlaybackNotes.forEach((active, key) => { if (active.regionId === region.id) stopPlaybackNote(key) })
        stopAudioClipPlayback(region.id)
      }
    })
  })
}
function makeSplitStretchMetadata(sourceDurationSeconds, targetDurationSeconds) {
  if (Math.abs(sourceDurationSeconds - targetDurationSeconds) < 0.01) return makeDefaultAudioStretch(sourceDurationSeconds)
  return createPendingStretchMetadata({ sourceDurationSeconds, targetDurationSeconds })
}
function splitAudioRegionAtBeat(region, splitBeat) {
  const { startBeat, endBeat } = getRegionBeatRange(region)
  if (splitBeat <= startBeat + 0.05 || splitBeat >= endBeat - 0.05) return []
  const left = makeAudioRegionSlice(region, startBeat, splitBeat, { preserveId: true })
  const right = makeAudioRegionSlice(region, splitBeat, endBeat)
  return left && right ? [left, right] : []
}
function splitMidiRegionAtBeat(region, splitBeat) {
  const { startBeat, endBeat } = getRegionBeatRange(region)
  if (splitBeat <= startBeat + 0.05 || splitBeat >= endBeat - 0.05) return []
  const left = makeMidiRegionSlice(region, startBeat, splitBeat, { preserveId: true })
  const right = makeMidiRegionSlice(region, splitBeat, endBeat)
  return left && right ? [left, right] : []
}
function splitRegionAtBeat(regionId, beat) {
  const region = midiRegions.find((item)=>item.id === regionId)
  if (!region) return
  const splitBeat = clampBeat(isSnapEnabled ? snapBeat(beat) : beat)
  const pieces = region.type === 'audio' ? splitAudioRegionAtBeat(region, splitBeat) : splitMidiRegionAtBeat(region, splitBeat)
  if (pieces.length !== 2) return
  commitHistoryMutation('split-region', () => {
    const index = midiRegions.findIndex((item)=>item.id === region.id)
    if (index < 0) return
    midiRegions.splice(index, 1, pieces[0], pieces[1])
    setSelectedRegions(pieces.map((piece)=>piece.id), { primaryId: pieces[1].id })
  })
}
function handleRegionToolPointer(event, regionId) {
  if (activeRegionTool === 'split') {
    splitRegionAtBeat(regionId, pointerEventToTimelineBeat(event, { snapped: false }))
    return true
  }
  if (activeRegionTool === 'erase') {
    deleteMidiRegion(regionId)
    return true
  }
  if (activeRegionTool === 'mute') {
    toggleSelectedRegionMute(regionId)
    return true
  }
  return false
}
function setActiveRegionTool(toolId = 'select') {
  const tool = REGION_TOOL_ITEMS.find((item)=>item.id === toolId && item.enabled && item.mode !== 'action')
  activeRegionTool = tool?.id || 'select'
  renderEditorPreservingArrangementScroll()
}
function runRegionToolAction(toolId) {
  if (toolId === 'loop') loopSelectedRegions()
  else if (toolId === 'duplicate') duplicateSelectedRegions()
}
const renderTrackRenamePopover = () => renameTrackState ? `<form class="studio-track-popover studio-track-popover--rename" data-track-rename-form style="left:${Math.round(renameTrackState.x)}px;top:${Math.round(renameTrackState.y)}px"><label>Rename Track<input data-track-rename-input value="${(renameTrackState.name || '').replace(/"/g, '&quot;')}" /></label><div><button type="submit">Save</button><button type="button" data-track-rename-cancel>Cancel</button></div></form>` : ''
const renderTrackColorPopover = () => colorPickerState ? `<form class="studio-track-popover studio-track-popover--color" data-track-color-form style="left:${Math.round(colorPickerState.x)}px;top:${Math.round(colorPickerState.y)}px"><label>Track Color<input type="color" data-track-color-input value="${colorPickerState.color || '#58d4ff'}" /></label><button type="submit">Apply</button></form>` : ''

function renderTimelineRegions() {
  const persisted = midiRegions.map((region)=>region.type === 'audio' ? renderAudioRegion(region, false) : renderMidiRegion(region, false)).join('')
  const liveNotes = activeRecording?.type === 'midi' ? [
    ...(activeRecording.notes || []),
    ...Array.from(activeRecordingNotes.values()).map((note)=>({
      note: note.note,
      velocity: note.velocity,
      startBeat: note.startBeat,
      durationBeats: Math.max(0.05, clampBeat(xToBeat(timelineState.playheadX)) - note.startBeat)
    }))
  ] : []
  const live = activeRecording
    ? activeRecording.type === 'audio'
      ? renderAudioRegion({ ...activeRecording, endBeat: Math.max(activeRecording.startBeat + 0.25, clampBeat(xToBeat(timelineState.playheadX))), color: '#ff2d55' }, true)
      : renderMidiRegion({ ...activeRecording, notes: liveNotes, endBeat: Math.max(activeRecording.startBeat + 0.25, clampBeat(xToBeat(timelineState.playheadX))), color: '#ff2d55' }, true)
    : ''
  return `${persisted}${live}`
}
function renderAudioImportPreview() {
  if (!audioImportDrag?.active) return ''
  const track = tracks.find((item)=>item.id === audioImportDrag.trackId)
  const color = track?.color || '#58d4ff'
  const waveformColor = getReadableWaveformColor(color)
  const duration = Math.max(minAudioRegionSeconds, Number(audioImportDrag.durationSeconds) || minAudioRegionSeconds)
  const width = Math.max(32, secondsToBeats(duration) * beatWidth())
  const trackIndex = Math.max(0, tracks.findIndex((item)=>item.id === audioImportDrag.trackId))
  const inset = Math.max(1, Math.round(timelineState.trackHeight * 0.01))
  const top = trackIndex * timelineState.trackHeight + inset
  const height = Math.max(28, timelineState.trackHeight - (inset * 2))
  const status = audioImportDrag.status === 'loading'
    ? 'Reading audio...'
    : audioImportDrag.valid === false
      ? audioImportDrag.message || 'Drop audio onto an audio track'
      : `${audioImportDrag.fileName || 'Audio'} · ${formatAudioDuration(duration)}`
  return `<article class="studio-audio-import-preview ${audioImportDrag.valid === false ? 'is-invalid' : ''} ${audioImportDrag.status === 'loading' ? 'is-loading' : ''}" style="left:${beatToX(audioImportDrag.startBeat || 0)}px;top:${top}px;width:${width}px;height:${height}px;--region-color:${esc(color)};--waveform-color:${esc(waveformColor)};"><strong>${esc(audioImportDrag.fileName || 'Audio import')}</strong><span>${esc(status)}</span></article>`
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
function renderAudioEditVisualOverlays(region) {
  const edit = normalizeAudioEdit(region.audioEdit)
  const visibleDuration = Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region))
  const fadeInWidth = clamp((Number(edit.fadeInSeconds) || 0) / visibleDuration, 0, 1) * 100
  const fadeOutWidth = clamp((Number(edit.fadeOutSeconds) || 0) / visibleDuration, 0, 1) * 100
  const delayLeft = clamp((Number(edit.delayMs) || 0) / 1000 / visibleDuration, 0, 1) * 100
  return `<span class="studio-audio-edit-overlays" aria-hidden="true">
    ${fadeInWidth > 0.25 ? `<i class="studio-audio-fade-overlay studio-audio-fade-overlay--in ${edit.fadeInCurve === 'equal-power' ? 'is-equal-power' : ''}" style="width:${fadeInWidth.toFixed(3)}%"></i>` : ''}
    ${fadeOutWidth > 0.25 ? `<i class="studio-audio-fade-overlay studio-audio-fade-overlay--out ${edit.fadeOutCurve === 'equal-power' ? 'is-equal-power' : ''}" style="width:${fadeOutWidth.toFixed(3)}%"></i>` : ''}
    ${Number(edit.delayMs) > 0 ? `<i class="studio-audio-delay-marker" style="left:${delayLeft.toFixed(3)}%"><b>Delay +${Math.round(edit.delayMs)}ms</b></i>` : ''}
    ${Math.abs(Number(edit.gainDb) || 0) > 0.01 ? `<b class="studio-audio-gain-badge">${edit.gainDb > 0 ? '+' : ''}${Number(edit.gainDb).toFixed(1)} dB</b>` : ''}
  </span>`
}
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
  const selected = !isRecording && regionIsSelected(region.id)
  return `<article class="studio-midi-region ${isRecording ? 'is-recording' : ''} ${selected ? 'is-selected' : ''} ${region.muted ? 'is-region-muted' : ''}" data-midi-region="${region.id || 'recording'}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;--region-color:${color};--beat-width:${beatWidth()}px;"><i class="studio-midi-region-handle studio-midi-region-handle--left" data-midi-region-handle="left"></i><i class="studio-midi-region-handle studio-midi-region-handle--right" data-midi-region-handle="right"></i><strong>${isRecording ? 'Recording MIDI' : esc(getMidiRegionLabel(region))}</strong>${visibleNotes.slice(0,24).map((note)=>{ const noteStart=Number(note.startBeat) || startBeat; const noteLeft=(noteStart - startBeat) * beatWidth(); const noteWidth=Math.max(4, (Number(note.durationBeats) || 0.05) * beatWidth()); const noteTop=clamp(82 - (((note.note || 60) - 48) / 36) * 70, 8, 82); return `<span class="studio-midi-note-preview" style="left:${noteLeft}px;width:${noteWidth}px;top:${noteTop}%"></span>` }).join('')}</article>`
}
function normalizeWaveformPeak(peak) {
  if (peak && typeof peak === 'object') {
    const min = clamp(Number(peak.min) || 0, -1, 1)
    const max = clamp(Number(peak.max) || 0, -1, 1)
    return { min: Math.min(min, max), max: Math.max(min, max), rms: clamp(Number(peak.rms) || Math.max(Math.abs(min), Math.abs(max)), 0, 1) }
  }
  const value = clamp(Number(peak) || 0, 0, 1)
  return { min: -value, max: value, rms: value }
}
function buildFallbackWaveform(region) {
  const duration = getAudioSourceDurationSeconds(region)
  return Array.from({ length: 16 }, (_, index) => ({
    t0Seconds: (index / 16) * duration,
    t1Seconds: ((index + 1) / 16) * duration,
    ...normalizeWaveformPeak([0.08, 0.16, 0.1, 0.22, 0.14, 0.18, 0.09, 0.2][index % 8])
  }))
}
function getWaveformChunks(region = {}) {
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  const edit = normalizeAudioEdit(region.audioEdit)
  const hasRenderedEditWaveform = region.renderedWaveform && (
    (edit.pitchTrace.enabled && edit.pitchTrace.renderStatus === 'ready') ||
    (edit.pitchShift.enabled && edit.pitchShift.renderStatus === 'ready') ||
    (stretch.enabled && stretch.renderStatus === 'ready') ||
    (edit.reverse.enabled && edit.reverse.renderStatus === 'ready')
  )
  const waveform = hasRenderedEditWaveform ? region.renderedWaveform : (region.waveform || {})
  if (Array.isArray(waveform.chunks) && waveform.chunks.length) return waveform.chunks.map((chunk) => ({ ...normalizeWaveformPeak(chunk), t0Seconds: Number(chunk.t0Seconds) || 0, t1Seconds: Number(chunk.t1Seconds) || ((Number(chunk.t0Seconds) || 0) + (Number(waveform.sampleWindowSeconds) || waveformWindowSeconds)) }))
  const peaks = Array.isArray(waveform.peaks) ? waveform.peaks : []
  if (!peaks.length) return buildFallbackWaveform(region)
  const duration = Math.max(minAudioRegionSeconds, Number(waveform.durationSeconds) || getAudioFileDurationSeconds(region))
  const step = duration / peaks.length
  return peaks.map((peak, index) => ({ ...normalizeWaveformPeak(peak), t0Seconds: index * step, t1Seconds: (index + 1) * step }))
}
function buildAudioWaveformFromBuffer(audioBuffer, { maxPeaks = 1200 } = {}) {
  const channelCount = Math.max(1, audioBuffer?.numberOfChannels || 1)
  const sampleCount = Math.max(1, audioBuffer?.length || 1)
  const peakCount = clamp(Math.ceil(sampleCount / 256), 64, maxPeaks)
  const samplesPerPeak = Math.max(1, Math.ceil(sampleCount / peakCount))
  const peaks = []
  for (let peakIndex = 0; peakIndex < peakCount; peakIndex += 1) {
    const start = peakIndex * samplesPerPeak
    const end = Math.min(sampleCount, start + samplesPerPeak)
    let min = 1
    let max = -1
    let sum = 0
    let count = 0
    for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
      const channel = audioBuffer.getChannelData(channelIndex)
      for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) {
        const sample = channel[sampleIndex] || 0
        if (sample < min) min = sample
        if (sample > max) max = sample
        sum += sample * sample
        count += 1
      }
    }
    peaks.push({ min: Number(clamp(min, -1, 1).toFixed(3)), max: Number(clamp(max, -1, 1).toFixed(3)), rms: Number(Math.sqrt(sum / Math.max(1, count)).toFixed(3)) })
  }
  return { peaks, resolution: 'high', samplesPerPeak, durationSeconds: audioBuffer.duration, generatedAt: Date.now() }
}
function renderAudioWaveform(region) {
  const chunks = getWaveformChunks(region)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  const edit = normalizeAudioEdit(region.audioEdit)
  const hasRenderedWaveform = region.renderedWaveform && (
    (edit.pitchTrace.enabled && edit.pitchTrace.renderStatus === 'ready') ||
    (edit.pitchShift.enabled && edit.pitchShift.renderStatus === 'ready') ||
    (stretch.enabled && stretch.renderStatus === 'ready') ||
    (edit.reverse.enabled && edit.reverse.renderStatus === 'ready')
  )
  const trimStart = hasRenderedWaveform ? 0 : getAudioTrimStartSeconds(region)
  const trimEnd = hasRenderedWaveform ? getAudioRegionVisibleDurationSeconds(region) : getAudioTrimEndSeconds(region)
  const sourceDuration = getAudioSourceDurationSeconds(region)
  const visibleDuration = getAudioRegionVisibleDurationSeconds(region)
  const stretchRatio = hasRenderedWaveform ? 1 : getAudioStretchRatio(region)
  const viewDuration = hasRenderedWaveform ? visibleDuration : stretch.enabled ? visibleDuration : sourceDuration
  const visibleChunks = chunks
    .filter((chunk) => chunk.t1Seconds >= trimStart && chunk.t0Seconds <= trimEnd)
    .map((chunk) => {
      const t0 = clamp(chunk.t0Seconds, trimStart, trimEnd)
      const t1 = clamp(chunk.t1Seconds, trimStart, trimEnd)
      const x0 = stretch.enabled ? (t0 - trimStart) * stretchRatio : (t0 - trimStart)
      const x1 = stretch.enabled ? (t1 - trimStart) * stretchRatio : (t1 - trimStart)
      return { ...chunk, x: (x0 + x1) / 2, width: Math.max(0.004, x1 - x0) }
    })
  const safeChunks = visibleChunks.length ? visibleChunks : buildFallbackWaveform(region).map((chunk)=>({ ...chunk, x: (chunk.t0Seconds + chunk.t1Seconds) / 2, width: Math.max(0.004, chunk.t1Seconds - chunk.t0Seconds) }))
  const upper = safeChunks.map((chunk) => `${chunk.x.toFixed(4)},${(50 - (Math.max(Math.abs(chunk.min), Math.abs(chunk.max), chunk.rms) * 42)).toFixed(2)}`).join(' ')
  const lower = safeChunks.map((chunk) => `${chunk.x.toFixed(4)},${(50 + (Math.max(Math.abs(chunk.min), Math.abs(chunk.max), chunk.rms) * 42)).toFixed(2)}`).reverse().join(' ')
  const bars = safeChunks.length > 220 ? '' : safeChunks.map((chunk)=>`<span style="left:${(chunk.x / Math.max(0.001, viewDuration) * 100).toFixed(3)}%;width:${Math.max(1, chunk.width / Math.max(0.001, viewDuration) * 100).toFixed(3)}%;top:${(50 - chunk.max * 42).toFixed(2)}%;height:${Math.max(1, (chunk.max - chunk.min) * 42).toFixed(2)}%"></span>`).join('')
  return `<svg class="studio-audio-waveform" viewBox="0 0 ${Math.max(0.001, viewDuration)} 100" preserveAspectRatio="none" aria-hidden="true"><polygon points="${upper} ${lower}"></polygon><polyline points="${upper}"></polyline><polyline points="${lower.split(' ').reverse().join(' ')}"></polyline></svg><div class="studio-audio-waveform-bars" aria-hidden="true">${bars}</div>`
}
function renderAudioRegion(region, isRecording = false) {
  syncAudioRegionTimeline(region)
  const trackIndex = Math.max(0, tracks.findIndex((track)=>track.id === region.trackId))
  const startBeat = Number(region.startBeat) || 0
  const endBeat = Math.max(startBeat + 0.15, Number(region.endBeat) || startBeat + Math.max(0.25, Number(region.durationBeats) || 0.25))
  const left = isRecording && Number.isFinite(Number(region.recordingStartPixelX)) ? Number(region.recordingStartPixelX) : beatsFromBarZeroToX(startBeat)
  const width = Math.max(isRecording ? 1 : 18, (endBeat - startBeat) * beatWidth())
  const inset = Math.max(1, Math.round(timelineState.trackHeight * 0.01))
  const top = trackIndex * timelineState.trackHeight + inset
  const height = Math.max(28, timelineState.trackHeight - (inset * 2))
  const track = tracks[trackIndex] || getSelectedTrack()
  const color = isRecording ? '#ff2d55' : (region.color || track?.color || '#58d4ff')
  const waveformColor = getReadableWaveformColor(color)
  const selected = !isRecording && regionIsSelected(region.id)
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  const renderedRuntimeReady = stretch.enabled && stretch.renderStatus === 'ready' && stretch.renderedRuntimeId && audioClipRuntime.has(stretch.renderedRuntimeId)
  const missing = Boolean(region.audioClip?.missingAfterReload || region.missingMedia) && !audioClipRuntime.has(region.audioClip?.runtimeId || region.id) && !renderedRuntimeReady
  const stretching = midiRegionDrag?.id === region.id && midiRegionDrag.editMode === 'stretch'
  const stretchStatus = stretch.renderStatus === 'rendering' ? 'Rendering' : stretch.renderStatus === 'failed' ? 'Render failed' : (stretch.renderStatus === 'ready' ? 'Rendered' : 'Stretch')
  const stretchMath = getAudioStretchMath(region)
  const speedLabel = Math.round(stretchMath.speedPercent)
  const stretchLabel = stretching || stretch.enabled ? `<b class="studio-audio-stretch-label">${stretching ? 'Time Stretch' : stretchStatus} ${speedLabel}% speed</b>` : ''
  const edit = normalizeAudioEdit(region.audioEdit)
  return `<article class="studio-midi-region studio-audio-region ${isRecording ? 'is-recording' : ''} ${selected ? 'is-selected' : ''} ${missing ? 'is-missing-media' : ''} ${stretch.enabled ? 'is-stretched' : ''} ${stretching ? 'is-stretching' : ''} ${edit.mute || region.muted ? 'is-audio-muted is-region-muted' : ''}" data-midi-region="${region.id || 'recording'}" data-audio-region="${region.id || 'recording'}" style="left:${left}px;top:${top}px;width:${width}px;height:${height}px;--region-color:${esc(color)};--waveform-color:${esc(waveformColor)};--beat-width:${beatWidth()}px;"><i class="studio-midi-region-handle studio-midi-region-handle--left" data-midi-region-handle="left"></i><i class="studio-midi-region-handle studio-midi-region-handle--right" data-midi-region-handle="right"></i><strong>${isRecording ? 'Recording Audio' : esc(getMidiRegionLabel(region))}</strong>${renderAudioWaveform(region)}${renderAudioEditVisualOverlays(region)}${stretchLabel}${missing ? `<em title="${esc(getAudioOfflineMessage(region))}">Audio file offline</em>` : ''}</article>`
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
  if (isAudioTrack(track)) return { track, ok:false, message:'Audio tracks do not use software instruments.' }
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
function normalizeAudioEffectInsert(insert = {}) {
  const type = String(insert?.type || '')
  const manifest = getAudioEffectManifest(type)
  if (!manifest) return null
  return {
    id: String(insert.id || makeInsertId(type)),
    type,
    name: insert.name || manifest.name,
    enabled: insert.enabled !== false,
    params: { ...getAudioEffectDefaultParams(type), ...(insert.params || {}) }
  }
}
function serializeAudioEffects(list = []) {
  return (Array.isArray(list) ? list : [])
    .map(normalizeAudioEffectInsert)
    .filter(Boolean)
    .map((insert) => ({
      id: insert.id,
      type: insert.type,
      name: insert.name,
      enabled: insert.enabled !== false,
      params: { ...(insert.params || {}) }
    }))
}
function cloneInsertList(list = []) {
  return Array.isArray(list) ? list.map((item)=>({ ...item, id: makeInsertId(item.type || 'insert'), params: { ...(item.params || {}) } })) : []
}
function ensureTrackInsertState(track) {
  if (!track) return null
  track.type = normalizeTrackType(track.type)
  track.icon = normalizedTrackIconType(track)
  if (isAudioTrack(track)) {
    track.instrument = null
    track.midiEffects = []
  }
  if (!Array.isArray(track.midiEffects)) track.midiEffects = []
  if (!Array.isArray(track.audioEffects)) track.audioEffects = []
  track.audioEffects = track.audioEffects.map(normalizeAudioEffectInsert).filter(Boolean)
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
function openAddTrackModal() {
  addTrackModalOpen = true
  renderEditor()
}
function closeAddTrackModal() {
  addTrackModalOpen = false
  renderEditor()
}
function addTrack({ sourceTrack = null, trackType = 'software' } = {}) {
  const before = captureDawSnapshot()
  const id = makeTrackId()
  const colors = sourceTrack ? { color: sourceTrack.color, colorSoft: sourceTrack.colorSoft } : nextTrackColor(tracks.length)
  const base = sourceTrack ? ensureTrackInsertState(sourceTrack) : null
  const type = normalizeTrackType(base?.type || trackType)
  const instrument = type === 'software' && base?.instrument ? { ...base.instrument, id: makeInsertId('instrument'), pluginInstanceId: `${base.instrument.type}:${id}`, params: { ...(base.instrument.params || {}) } } : null
  const track = {
    id,
    name: base ? `${base.name} Copy` : (type === 'audio' ? `Audio ${tracks.length + 1}` : `Software ${tracks.length + 1}`),
    type,
    color: colors.color,
    colorSoft: colors.colorSoft,
    icon: type === 'audio' ? 'audio' : 'instrument',
    muted: false,
    soloed: false,
    recordArmed: false,
    automationOpen: Boolean(base?.automationOpen),
    volume: Number.isFinite(Number(base?.volume)) ? Number(base.volume) : 72,
    pan: Number.isFinite(Number(base?.pan)) ? Number(base.pan) : 0,
    outputLevel: 0,
    midiEffects: type === 'software' ? cloneInsertList(base?.midiEffects || []) : [],
    instrument,
    audioEffects: cloneInsertList(base?.audioEffects || [])
  }
  tracks.push(track)
  selectedTrackId = id
  warmTrackInstrument(track, { reason: sourceTrack ? 'duplicate-track' : 'add-track' })
  activeLeftPanel = 'inspector'
  inspectorMenu = null
  trackMenuState = null
  addTrackModalOpen = false
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
  ;(removed?.audioEffects || []).forEach((insert) => dawWindowManager.closeWindow(getAudioEffectWindowInstanceId(removed.id, insert.id)))
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
  const params = catalog === AUDIO_EFFECT_TYPES ? getAudioEffectDefaultParams(item?.type) : {}
  return item ? { id: makeInsertId(item.type), type: item.type, name: item.name, enabled: true, params } : null
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
function getAudioEffectWindowInstanceId(trackId = '', insertId = '') {
  return `audio-effect:${trackId || 'track'}:${insertId || 'insert'}`
}
function getAudioEffectInsertFromWindow(pluginWindow = {}) {
  const track = ensureTrackInsertState(tracks.find((item)=>item.id === pluginWindow.trackId))
  const insertId = String(pluginWindow.pluginInstanceId || '').split(':').pop()
  const insert = track?.audioEffects?.find((item)=>item.id === insertId)
  return { track, insert }
}
function coerceAudioEffectParam(effectType = '', param = '', value = null) {
  const defaults = getAudioEffectDefaultParams(effectType)
  if (typeof defaults[param] === 'boolean') return value === true || value === 'true' || value === '1'
  if (typeof defaults[param] === 'number') return Number.isFinite(Number(value)) ? Number(value) : defaults[param]
  return value
}
function updateAudioEffectParamFromWindow(pluginWindow = {}, param = '', value = null) {
  const effectType = getAudioEffectTypeFromPlugin(pluginWindow.pluginType)
  const { track, insert } = getAudioEffectInsertFromWindow(pluginWindow)
  if (!track || !insert || !effectType || !param) return
  insert.params = {
    ...getAudioEffectDefaultParams(effectType),
    ...(insert.params || {}),
    [param]: coerceAudioEffectParam(effectType, param, value)
  }
  rebuildTrackAudioEffectsChain(track.id)
  scheduleEditorSave()
}
function openAudioEffectWindow(track = getSelectedTrack(), insertId = '') {
  const target = ensureTrackInsertState(track)
  const insert = target?.audioEffects?.find((item)=>item.id === insertId)
  const pluginType = getAudioEffectPluginType(insert?.type)
  if (!target || !insert || !pluginType) return
  insert.params = { ...getAudioEffectDefaultParams(insert.type), ...(insert.params || {}) }
  dawWindowManager.openPlugin({
    pluginType,
    trackId: target.id,
    instanceId: getAudioEffectWindowInstanceId(target.id, insert.id),
    params: insert.params,
    forceCenter: true
  })
}
function renderInsertMenu({ menuId, items, action }) {
  if (inspectorMenu !== menuId) return ''
  const floating = menuId === 'instrument'
  const pos = floating ? (inspectorMenuPosition || getClampedFloatingPosition(window.innerWidth * 0.5, window.innerHeight * 0.42, 260, 210)) : null
  const style = floating ? ` style="left:${Math.round(pos.x)}px;top:${Math.round(pos.y)}px"` : ''
  return `<div class="studio-inspector-menu ${floating ? 'studio-inspector-menu--floating' : ''}" data-inspector-menu="${menuId}"${style}>${items.map((item)=>`<button type="button" data-inspector-menu-choice="${action}" data-insert-type="${item.type}">${item.name}</button>`).join('')}${floating ? '<button type="button" data-inspector-menu-choice="instrument-empty" data-insert-type="">No Instrument</button>' : ''}</div>`
}
function renderInsertSlot(insert, section) {
  const canEdit = section === 'midi' || (section === 'audio' && isImplementedAudioEffect(insert.type))
  return `<article class="studio-insert-slot ${insert.enabled ? 'is-enabled' : 'is-disabled'}">
    <div class="studio-insert-slot-label"><strong>${esc(insert.name)}</strong><span>${insert.enabled ? 'Enabled' : 'Disabled'}</span></div>
    <div class="studio-insert-slot-actions">
      <button type="button" class="studio-insert-power ${insert.enabled ? 'is-active' : ''}" data-toggle-insert="${section}" data-insert-id="${insert.id}" aria-label="Toggle ${esc(insert.name)}">${insert.enabled ? 'On' : 'Off'}</button>
      <button type="button" data-edit-insert="${section}" data-insert-id="${insert.id}" ${canEdit ? '' : 'disabled'}>${section === 'audio' ? 'Open' : 'Edit'}</button>
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
  const routingControls = isAudioTrack(track)
    ? `<label>Audio Input<select data-channel-setting="audioInput"><option ${selected(track.audioInput, 'Browser default')}>Browser default</option><option disabled>Interface input selection</option></select></label><label>Audio Output<select data-channel-setting="audioOutput"><option ${selected(track.audioOutput, 'Stereo Out')}>Stereo Out</option><option disabled>Bus 1</option><option disabled>Bus 2</option></select></label><label class="studio-channel-toggle"><input data-channel-setting="monitor" type="checkbox" ${track.monitor ? 'checked' : ''}>Monitor Input</label>`
    : `<label>MIDI Input<select data-channel-setting="midiInput"><option ${selected(track.midiInput, 'All Inputs')}>All Inputs</option><option ${selected(track.midiInput, 'Computer Keyboard')}>Computer Keyboard</option><option disabled>Web MIDI Device</option></select></label><label>MIDI Channel<select data-channel-setting="midiChannel"><option ${selected(track.midiChannel, 'All')}>All</option>${Array.from({length:16},(_,i)=>`<option ${selected(track.midiChannel, i+1)}>${i+1}</option>`).join('')}</select></label><label>Audio Output<select data-channel-setting="audioOutput"><option ${selected(track.audioOutput, 'Stereo Out')}>Stereo Out</option><option disabled>Bus 1</option><option disabled>Bus 2</option></select></label><label class="studio-channel-toggle"><input data-channel-setting="monitor" type="checkbox" ${track.monitor ? 'checked' : ''}>Monitor Input</label>`
  const performanceControls = isAudioTrack(track)
    ? '<p class="studio-channel-hint">Audio tracks record and play clips directly. MIDI transpose, velocity, and quantize controls apply to software tracks.</p>'
    : `<label>Transpose<input data-channel-setting="transpose" type="number" min="-48" max="48" value="${Number(track.transpose || 0)}"></label><label>Octave Shift<input data-channel-setting="octaveShift" type="number" min="-4" max="4" value="${Number(track.octaveShift || 0)}"></label><label>Velocity Offset<input data-channel-setting="velocityOffset" type="number" min="-64" max="64" value="${Number(track.velocityOffset || 0)}"></label><label>Quantize Input<select data-channel-setting="quantize"><option ${selected(track.quantize, 'Off')}>Off</option><option ${selected(track.quantize, '1/4')}>1/4</option><option ${selected(track.quantize, '1/8')}>1/8</option><option ${selected(track.quantize, '1/16')}>1/16</option><option ${selected(track.quantize, '1/32')}>1/32</option></select></label>`
  const safetyControls = isAudioTrack(track)
    ? '<button type="button" data-reset-track-audio>Reset Track Audio Engine</button><p class="studio-channel-hint">Stop recording before changing browser input permissions.</p>'
    : `<button type="button" data-stop-stuck-notes>Stop Stuck Notes</button><button type="button" data-reset-track-audio>Reset Track Audio Engine</button><label class="studio-channel-toggle"><input data-disable-track-instrument type="checkbox" ${track.instrument?.enabled === false ? 'checked' : ''}>Disable instrument on track</label>`
  return `<section class="studio-inspector-section studio-channel-strip-settings">
    <h4 class="studio-inspector-divider"><span>Channel Strip Settings</span></h4>
    <div class="studio-channel-settings-scroll">
      <details data-channel-accordion="identity" ${detailOpen('identity', true)}><summary>Track Identity</summary><label>Name<input data-channel-setting="name" value="${esc(track.name)}"></label><label>Color<input data-channel-setting="color" type="color" value="${esc(track.color || '#58d4ff')}"></label><label>Notes<textarea data-channel-setting="notes" placeholder="Track notes">${esc(track.notes || '')}</textarea></label></details>
      <details data-channel-accordion="routing" ${detailOpen('routing', true)}><summary>Routing</summary>${routingControls}</details>
      <details data-channel-accordion="performance" ${detailOpen('performance')}><summary>Performance</summary>${performanceControls}</details>
      <details data-channel-accordion="audio" ${detailOpen('audio')}><summary>Channel Audio</summary><label>Volume<input data-track-volume="${track.id}" type="range" min="0" max="100" value="${track.volume}"></label><label>Pan<input data-channel-setting="pan" type="range" min="-100" max="100" step="1" value="${track.pan}"></label><label>Gain Trim<input data-channel-setting="gainTrim" type="range" min="-24" max="24" step="0.5" value="${Number(track.gainTrim || 0)}"></label><label>Meter Mode<select data-channel-setting="meterMode"><option ${selected(track.meterMode, 'Peak + RMS')}>Peak + RMS</option><option ${selected(track.meterMode, 'Peak')}>Peak</option><option ${selected(track.meterMode, 'RMS')}>RMS</option></select></label></details>
      <details data-channel-accordion="latency" ${detailOpen('latency')}><summary>Latency / Browser Audio</summary><p>Engine: ${ctx ? ctx.state : 'Not started'}</p><p>Sample rate: ${ctx?.sampleRate ? `${ctx.sampleRate} Hz` : 'Not available'}</p><p>Base latency: ${ctx?.baseLatency ? `${Math.round(ctx.baseLatency * 1000)} ms` : 'Not available'}</p><p>Output latency: ${ctx?.outputLatency ? `${Math.round(ctx.outputLatency * 1000)} ms` : 'Not available'}</p><label>MIDI latency compensation<input data-channel-setting="midiLatencyMs" type="number" min="0" max="500" value="${Number(track.midiLatencyMs || 0)}"></label></details>
      <details data-channel-accordion="regions" ${detailOpen('regions')}><summary>Region Defaults</summary><label>Default Region Color<select data-channel-setting="regionColorMode"><option ${selected(track.regionColorMode, 'Track color')}>Track color</option><option ${selected(track.regionColorMode, 'Custom')}>Custom</option></select></label><label>Default Length<input data-channel-setting="defaultRegionLength" type="number" min="0.25" step="0.25" value="${Number(track.defaultRegionLength || 4)}"></label><label class="studio-channel-toggle"><input data-channel-setting="autoNameRegions" type="checkbox" ${track.autoNameRegions !== false ? 'checked' : ''}>Auto-name recorded regions</label></details>
      <details data-channel-accordion="safety" ${detailOpen('safety')}><summary>Safety</summary>${safetyControls}</details>
    </div>
  </section>`
}
function renderTrackInspector() {
  const track = ensureTrackInsertState(tracks.find((t)=>t.id===selectedTrackId))
  if (!track) return '<h3>Inspector</h3><p class="studio-inspector-empty">Select a track to view inserts and controls.</p>'
  const isAudio = isAudioTrack(track)
  return `<section class="studio-track-inspector">
    <header class="studio-track-inspector-header"><span class="studio-track-inspector-icon" style="--track-color:${track.color}">${trackTypeIcon(normalizedTrackIconType(track))}</span><div><h3>${track.name}</h3><p>${trackTypeLabel(track)} track</p></div></header>
    <div class="studio-inspector-strip"><button class="${track.muted?'is-active':''}" data-track-mute="${track.id}">Mute</button><button class="${track.soloed?'is-active':''}" data-track-solo="${track.id}">Solo</button><button class="${track.recordArmed?'is-active':''}" data-track-record="${track.id}">Record</button></div>
    ${isAudio ? '<section class="studio-inspector-section studio-audio-track-summary"><header><div><span>Audio Track</span><h4>Input Recording</h4></div></header><p>Press Record to request microphone/interface access and capture a session clip. Recorded audio plays back in this browser session.</p><p class="studio-audio-session-note">MVP persistence: clip metadata and waveform save with the project; raw audio remains in memory until you reload.</p></section>' : renderInspectorSection({ title:'MIDI Effects', kicker:'Pre instrument', emptyText:'No MIDI effects inserted.', items:track.midiEffects, section:'midi', addLabel:'Add MIDI Effect', menuId:'midi-effects', menuItems:MIDI_EFFECT_TYPES, action:'midi' })}
    ${isAudio ? '' : `<section class="studio-inspector-section studio-inspector-section--instrument"><header><div><span>Instrument</span><h4>Instrument</h4></div></header>${renderInstrumentSlot(track)}</section>`}
    ${renderInspectorSection({ title:'Audio FX', kicker:isAudio ? 'Clip output' : 'Post instrument', emptyText:'No audio effects inserted.', items:track.audioEffects, section:'audio', addLabel:'Add Audio FX', menuId:'audio-effects', menuItems:AUDIO_EFFECT_TYPES, action:'audio' })}
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
  stopAllAudioClipPlayback()
  if (track.instrument?.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId)
  track.type = 'software'
  track.icon = 'instrument'
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
function renderAudioStretchRenderModal() {
  if (!audioStretchRenderState.active) return ''
  const progress = Number.isFinite(Number(audioStretchRenderState.progress)) ? clamp(Number(audioStretchRenderState.progress), 0, 1) : null
  const progressLabel = progress == null ? 'Rendering...' : `${Math.round(progress * 100)}%`
  return `<div class="studio-audio-render-modal" role="dialog" aria-modal="true" aria-labelledby="studio-audio-render-title"><section class="studio-audio-render-panel"><span>Offline render</span><h3 id="studio-audio-render-title">Rendering Audio Stretch</h3><p>Soura is rendering the stretched audio region. This may take a moment.</p><div class="studio-audio-render-progress ${progress == null ? 'is-indeterminate' : ''}" aria-label="${esc(progressLabel)}">${progress == null ? '<i></i>' : `<i style="width:${Math.round(progress * 100)}%"></i>`}</div><small>${esc(progressLabel)}</small></section></div>`
}
function renderAudioPitchRenderModal() {
  if (!audioPitchRenderState.active) return ''
  const progress = Number.isFinite(Number(audioPitchRenderState.progress)) ? clamp(Number(audioPitchRenderState.progress), 0, 1) : null
  const progressLabel = progress == null ? 'Rendering...' : `${Math.round(progress * 100)}%`
  const title = audioPitchRenderState.mode === 'trace' ? 'Rendering Pitch Trace Edits' : audioPitchRenderState.mode === 'reverse' ? 'Rendering Reverse' : 'Rendering Pitch Shift'
  return `<div class="studio-audio-render-modal" role="dialog" aria-modal="true" aria-labelledby="studio-pitch-render-title"><section class="studio-audio-render-panel"><span>Offline render</span><h3 id="studio-pitch-render-title">${esc(title)}</h3><p>Soura is rendering edited audio for this region. Playback will use the render when it finishes.</p><div class="studio-audio-render-progress ${progress == null ? 'is-indeterminate' : ''}" aria-label="${esc(progressLabel)}">${progress == null ? '<i></i>' : `<i style="width:${Math.round(progress * 100)}%"></i>`}</div><small>${esc(progressLabel)}</small></section></div>`
}
function renderAudioPreflightRenderModal() {
  if (!audioPreflightRenderState.active) return ''
  const total = Math.max(1, Number(audioPreflightRenderState.total) || 1)
  const completed = clamp(Number(audioPreflightRenderState.completed) || 0, 0, total)
  const progress = completed / total
  return `<div class="studio-audio-render-modal" role="dialog" aria-modal="true" aria-labelledby="studio-preflight-render-title"><section class="studio-audio-render-panel"><span>Preparing audio</span><h3 id="studio-preflight-render-title">Preparing Audio</h3><p>Soura needs to render audio edits before playback.</p><div class="studio-audio-render-progress" aria-label="${Math.round(progress * 100)}%"><i style="width:${Math.round(progress * 100)}%"></i></div><small>${completed}/${total} renders · ${esc(audioPreflightRenderState.currentLabel || 'Queued')}</small>${audioPreflightRenderState.error ? `<p>${esc(audioPreflightRenderState.error)}</p><div class="studio-modal-actions"><button type="button" class="button" data-preflight-retry>Retry Render</button><button type="button" class="button button-muted" data-preflight-play-original>Play Original Where Possible</button><button type="button" class="button button-muted" data-preflight-cancel>Cancel</button></div>` : ''}</section></div>`
}
function renderStretchPlaybackPrompt() {
  if (!stretchPlaybackPrompt?.regionId) return ''
  const region = midiRegions.find((item)=>item.id === stretchPlaybackPrompt.regionId)
  if (!region) return ''
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  return `<div class="studio-audio-render-modal" role="dialog" aria-modal="true" aria-labelledby="studio-stretch-prompt-title"><section class="studio-audio-render-panel"><span>Stretch render required</span><h3 id="studio-stretch-prompt-title">Render stretched audio?</h3><p>This stretched audio region must be rendered before playback.</p>${stretch.renderError ? `<small>${esc(stretch.renderError)}</small>` : ''}<div class="studio-modal-actions"><button type="button" class="button" data-stretch-prompt-render ${stretch.renderStatus === 'rendering' ? 'disabled' : ''}>${stretch.renderStatus === 'failed' ? 'Retry Render' : 'Render Now'}</button><button type="button" class="button button-muted" data-stretch-prompt-play-original>Play Original</button><button type="button" class="button button-muted" data-stretch-prompt-cancel>Cancel</button></div></section></div>`
}
function renderAudioEditPlaybackPrompt() {
  if (!audioEditPlaybackPrompt?.regionId) return ''
  const region = midiRegions.find((item)=>item.id === audioEditPlaybackPrompt.regionId)
  if (!region) return ''
  const mode = audioEditPlaybackPrompt.mode === 'trace' ? 'Pitch Trace edits' : audioEditPlaybackPrompt.mode === 'reverse' ? 'Reverse' : 'Pitch Shift'
  const edit = normalizeAudioEdit(region.audioEdit)
  const error = audioEditPlaybackPrompt.mode === 'trace' ? edit.pitchTrace.lastError : audioEditPlaybackPrompt.mode === 'reverse' ? edit.reverse.lastError : edit.pitchShift.lastError
  return `<div class="studio-audio-render-modal" role="dialog" aria-modal="true" aria-labelledby="studio-audio-edit-prompt-title"><section class="studio-audio-render-panel"><span>Pitch render required</span><h3 id="studio-audio-edit-prompt-title">Render edited audio?</h3><p>${esc(mode)} must be rendered before playback can use it.</p>${error ? `<small>${esc(error)}</small>` : ''}<div class="studio-modal-actions"><button type="button" class="button" data-audio-edit-prompt-render>Render Now</button><button type="button" class="button button-muted" data-audio-edit-prompt-original>Play Original</button><button type="button" class="button button-muted" data-audio-edit-prompt-cancel>Cancel</button></div></section></div>`
}
function renderFileMenu(){ if(!isFileMenuOpen) return ''; return `<div class="studio-controls-menu studio-file-menu" data-file-menu><button type="button" data-import-audio-selected-track>Import Audio to Selected Track</button><p>Import browser-decodable audio into the selected audio track.</p></div>` }
function renderControlsMenu(){ if(!isControlsMenuOpen) return ''; return `<div class="studio-controls-menu" data-controls-menu><label><input type="checkbox" data-musical-typing-toggle ${isTypingPianoEnabled ? 'checked' : ''}> Musical Typing</label><p>${isTypingPianoEnabled ? 'Typing keys play the selected instrument.' : 'Typing keys run DAW commands.'}</p></div>` }
function renderRegionToolRail() {
  return `<div class="studio-right-rail-divider studio-right-rail-divider--region-tools"></div><div class="studio-region-tool-rail" role="toolbar" aria-label="Global region tools">${REGION_TOOL_ITEMS.map((tool) => {
    const isAction = tool.mode === 'action'
    const active = activeRegionTool === tool.id && !isAction
    const attrs = tool.enabled
      ? `${isAction ? `data-region-tool-action="${tool.id}"` : `data-region-tool="${tool.id}"`} aria-pressed="${String(active)}"`
      : `disabled aria-disabled="true"`
    const title = `${tool.title || tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ''}${tool.reason ? ` - ${tool.reason}` : ''}`
    return `<button type="button" class="studio-region-tool-button ${active ? 'is-active' : ''} ${!tool.enabled ? 'is-disabled' : ''}" ${attrs} title="${esc(title)}"><span>${esc(tool.glyph)}</span><small>${esc(tool.label)}</small></button>`
  }).join('')}</div>`
}

function cloneRegionForState(region = {}, { persist = false } = {}) {
  const waveform = region.waveform
    ? {
      ...region.waveform,
      peaks: Array.isArray(region.waveform.peaks) ? region.waveform.peaks.slice(0, persist ? 1200 : region.waveform.peaks.length).map((peak)=>peak && typeof peak === 'object' ? { min: Number(peak.min) || 0, max: Number(peak.max) || 0, rms: Number(peak.rms) || 0 } : Number(peak) || 0) : []
    }
    : undefined
  if (waveform && Array.isArray(region.waveform?.chunks) && !persist) waveform.chunks = region.waveform.chunks.map((chunk)=>({ ...chunk }))
  const renderedWaveform = region.renderedWaveform
    ? {
      ...region.renderedWaveform,
      peaks: Array.isArray(region.renderedWaveform.peaks) ? region.renderedWaveform.peaks.slice(0, persist ? 1200 : region.renderedWaveform.peaks.length).map((peak)=>peak && typeof peak === 'object' ? { min: Number(peak.min) || 0, max: Number(peak.max) || 0, rms: Number(peak.rms) || 0 } : Number(peak) || 0) : []
    }
    : null
  const copy = {
    ...region,
    notes: (region.notes || []).map((note)=>({ ...note })),
    waveform,
    renderedWaveform
  }
  if (copy.type === 'audio') {
    const runtimeId = copy.audioClip?.runtimeId || copy.id
    syncAudioRegionTimeline(copy)
    const fileDurationSeconds = getAudioFileDurationSeconds(copy)
    const trimStartSeconds = getAudioTrimStartSeconds(copy)
    const trimEndSeconds = Number.isFinite(Number(copy.trimEndSeconds)) ? getAudioTrimEndSeconds(copy) : null
    const visibleDurationSeconds = getAudioRegionVisibleDurationSeconds(copy)
    copy.clipId = copy.clipId || copy.id
    copy.timelineStartBeats = Number(copy.timelineStartBeats ?? copy.startBeat) || 0
    copy.timelineStartSeconds = Number(copy.timelineStartSeconds ?? getTimelineSecondsAtBeat(copy.timelineStartBeats)) || 0
    copy.transportBpm = Number(copy.transportBpm) || Number(projectState?.bpm || 140)
    copy.projectSampleRate = Number(copy.projectSampleRate) || Number(copy.audioContextSampleRate) || 44100
    copy.audioContextSampleRate = Number(copy.audioContextSampleRate) || copy.projectSampleRate
    copy.recordingStartedAtAudioContextTime = Number(copy.recordingStartedAtAudioContextTime) || 0
    copy.recordingStartedAtPerformanceTime = Number(copy.recordingStartedAtPerformanceTime) || 0
    copy.mediaRecorderStartedAt = Number(copy.mediaRecorderStartedAt) || 0
    copy.sourceLatencyCompensationSeconds = Number(copy.sourceLatencyCompensationSeconds) || 0
    copy.durationSeconds = visibleDurationSeconds
    copy.fileDurationSeconds = fileDurationSeconds
    copy.offsetSeconds = Number(copy.offsetSeconds) || 0
    copy.trimStartSeconds = trimStartSeconds
    copy.trimEndSeconds = trimEndSeconds
    copy.visibleDurationSeconds = visibleDurationSeconds
    copy.playbackRate = Number(copy.playbackRate) || 1
    copy.audioEdit = normalizeAudioEdit(copy.audioEdit)
    if (persist && copy.audioEdit?.pitchTrace?.status === 'analyzing') {
      copy.audioEdit.pitchTrace.status = copy.audioEdit.pitchTrace.notes.length ? 'ready' : 'idle'
      copy.audioEdit.pitchTrace.progress = 0
    }
    copy.stretch = normalizeAudioStretch(copy.stretch, {
      clipId: copy.id,
      sourceDurationSeconds: getAudioSourceDurationSeconds(copy),
      visibleDurationSeconds
    })
    if (persist) copy.stretch.renderedObjectUrl = null
    if (!copy.waveform) copy.waveform = { peaks: [], resolution: 'none', durationSeconds: fileDurationSeconds, generatedAt: null }
    if (!Array.isArray(copy.waveform.peaks)) copy.waveform.peaks = []
    copy.audioClip = {
      ...(copy.audioClip || {}),
      id: copy.audioClip?.id || copy.clipId || copy.id,
      audioAssetId: copy.audioClip?.audioAssetId || copy.audioClip?.id || copy.clipId || copy.id,
      runtimeId,
      source: copy.audioClip?.source || copy.source || 'recording',
      contentType: copy.audioClip?.contentType || copy.contentType || 'audio/webm',
      fileType: copy.audioClip?.fileType || copy.fileType || copy.audioClip?.contentType || copy.contentType || 'audio/webm',
      fileName: copy.audioClip?.fileName || `${copy.clipId || copy.id}.${extensionForAudioType(copy.audioClip?.contentType || copy.contentType || 'audio/webm')}`,
      fileSizeBytes: Number(copy.audioClip?.fileSizeBytes ?? copy.fileSizeBytes) || null,
      sampleRate: Number(copy.audioClip?.sampleRate ?? copy.sampleRate ?? copy.audioContextSampleRate) || null,
      bitDepth: Number.isFinite(Number(copy.audioClip?.bitDepth ?? copy.bitDepth)) ? Number(copy.audioClip?.bitDepth ?? copy.bitDepth) : null,
      bitDepthSource: copy.audioClip?.bitDepthSource || copy.bitDepthSource || 'unknown',
      channelCount: Number(copy.audioClip?.channelCount ?? copy.channelCount) || null,
      fileDurationSeconds,
      storagePath: copy.audioClip?.storagePath || null,
      downloadUrl: copy.audioClip?.downloadUrl || null,
      sessionOnly: copy.audioClip?.storagePath || copy.audioClip?.downloadUrl ? false : true,
      missingAfterReload: copy.audioClip?.storagePath || copy.audioClip?.downloadUrl ? false : true,
      audioReady: copy.audioClip?.audioReady === true && !persist,
      loadStatus: copy.audioClip?.loadStatus || 'idle',
      loadError: copy.audioClip?.loadError || null,
      offlineReason: copy.audioClip?.offlineReason || (copy.audioClip?.storagePath || copy.audioClip?.downloadUrl ? null : 'missing_storage_path'),
      createdAt: Number.isFinite(Number(copy.audioClip?.createdAt)) ? Number(copy.audioClip.createdAt) : null,
      updatedAt: Number.isFinite(Number(copy.audioClip?.updatedAt)) ? Number(copy.audioClip.updatedAt) : null
    }
    delete copy.blob
    delete copy.url
    delete copy.audioBuffer
    delete copy.recordingStartPixelX
    if (persist) copy.missingMedia = !(copy.audioClip.storagePath || copy.audioClip.downloadUrl)
  }
  return copy
}
function normalizeLoadedRegion(region = {}) {
  const type = region.type === 'audio' ? 'audio' : 'midi'
  const rawFileDuration = Math.max(minAudioRegionSeconds, Number(region.fileDurationSeconds || region.audioClip?.fileDurationSeconds || region.durationSeconds) || minAudioRegionSeconds)
  const rawTrimStart = clamp(Number(region.trimStartSeconds) || 0, 0, Math.max(0, rawFileDuration - minAudioRegionSeconds))
  const rawTrimEnd = Number.isFinite(Number(region.trimEndSeconds)) ? clamp(Number(region.trimEndSeconds), rawTrimStart + minAudioRegionSeconds, rawFileDuration) : rawFileDuration
  const rawSourceDuration = Math.max(minAudioRegionSeconds, rawTrimEnd - rawTrimStart)
  const rawVisibleDuration = getRawAudioRegionVisibleDurationSeconds(region) || rawSourceDuration
  const loadedStretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: rawSourceDuration,
    visibleDurationSeconds: rawVisibleDuration,
    migrateCorrupt: true
  })
  const hasPersistedStretchRender = !!loadedStretch.renderedStoragePath || !!loadedStretch.renderedAudioUrl
  const stretch = loadedStretch.enabled && loadedStretch.renderStatus === 'ready' && !hasPersistedStretchRender
    ? { ...loadedStretch, renderedRuntimeId: null, renderedObjectUrl: null, renderStatus: 'needs_render', renderError: null, renderedSessionOnly: true }
    : loadedStretch
  const loadedAudioEdit = type === 'audio' ? normalizeAudioEdit(region.audioEdit) : undefined
  if (loadedAudioEdit?.pitchShift?.renderStatus === 'ready' && !(loadedAudioEdit.pitchShift.renderedStoragePath || loadedAudioEdit.pitchShift.renderedAudioUrl)) {
    loadedAudioEdit.pitchShift = { ...loadedAudioEdit.pitchShift, renderedRuntimeId: null, renderStatus: 'needs_render', lastError: null }
  }
  if (loadedAudioEdit?.pitchTrace?.renderStatus === 'ready' && !(loadedAudioEdit.pitchTrace.renderedStoragePath || loadedAudioEdit.pitchTrace.renderedAudioUrl)) {
    loadedAudioEdit.pitchTrace = { ...loadedAudioEdit.pitchTrace, renderedRuntimeId: null, renderStatus: getPitchTraceEditedNoteCount(loadedAudioEdit.pitchTrace) ? 'needs_render' : 'idle', lastError: null }
  }
  if (loadedAudioEdit?.reverse?.renderStatus === 'ready' && !(loadedAudioEdit.reverse.renderedStoragePath || loadedAudioEdit.reverse.renderedAudioUrl)) {
    loadedAudioEdit.reverse = { ...loadedAudioEdit.reverse, renderedRuntimeId: null, renderStatus: loadedAudioEdit.reverse.enabled ? 'needs_render' : 'idle', lastError: null }
  }
  const hasPersistentMedia = !!(region.audioClip?.storagePath || region.audioClip?.downloadUrl)
  const normalized = cloneRegionForState({
    ...region,
    type,
    notes: type === 'midi' && Array.isArray(region.notes) ? region.notes.map((note)=>({ ...note })) : [],
    trimStartSeconds: Number(region.trimStartSeconds) || 0,
    trimEndSeconds: Number.isFinite(Number(region.trimEndSeconds)) ? Number(region.trimEndSeconds) : null,
    visibleDurationSeconds: Number(region.visibleDurationSeconds) || Number(region.durationSeconds) || null,
    fileDurationSeconds: Number(region.fileDurationSeconds || region.audioClip?.fileDurationSeconds || region.durationSeconds) || null,
    playbackRate: Number(region.playbackRate) || 1,
    offsetSeconds: Number(region.offsetSeconds) || 0,
    audioEdit: loadedAudioEdit,
    stretch,
    audioClip: type === 'audio'
      ? {
        ...(region.audioClip || {}),
        id: region.audioClip?.id || region.clipId || region.id,
        audioAssetId: region.audioClip?.audioAssetId || region.audioClip?.id || region.clipId || region.id,
        runtimeId: region.audioClip?.runtimeId || region.id,
        source: region.audioClip?.source || region.source || 'recording',
        fileDurationSeconds: Number(region.fileDurationSeconds || region.audioClip?.fileDurationSeconds || region.durationSeconds) || null,
        storagePath: region.audioClip?.storagePath || null,
        downloadUrl: region.audioClip?.downloadUrl || null,
        contentType: region.audioClip?.contentType || region.contentType || 'audio/webm',
        fileType: region.audioClip?.fileType || region.fileType || region.audioClip?.contentType || region.contentType || 'audio/webm',
        fileName: region.audioClip?.fileName || `${region.id}.${extensionForAudioType(region.audioClip?.contentType || 'audio/webm')}`,
        fileSizeBytes: Number(region.audioClip?.fileSizeBytes ?? region.fileSizeBytes) || null,
        sampleRate: Number(region.audioClip?.sampleRate ?? region.sampleRate ?? region.audioContextSampleRate) || null,
        bitDepth: Number.isFinite(Number(region.audioClip?.bitDepth ?? region.bitDepth)) ? Number(region.audioClip?.bitDepth ?? region.bitDepth) : null,
        bitDepthSource: region.audioClip?.bitDepthSource || region.bitDepthSource || 'unknown',
        channelCount: Number(region.audioClip?.channelCount ?? region.channelCount) || null,
        sessionOnly: !hasPersistentMedia,
        missingAfterReload: !hasPersistentMedia,
        audioReady: false,
        loadStatus: hasPersistentMedia ? 'pending' : 'missing',
        loadError: hasPersistentMedia ? null : 'This region has metadata but no persistent audio file. Re-record or reconnect the audio.',
        offlineReason: hasPersistentMedia ? null : (region.audioClip?.sessionOnly ? 'session_only_source_lost' : 'missing_storage_path')
      }
      : undefined,
    missingMedia: type === 'audio' ? !hasPersistentMedia : Boolean(region.missingMedia)
  })
  return type === 'audio' ? syncAudioRegionTimeline(normalized) : normalized
}
function buildEditorStateForSave(){ return { version:3, timeline:{ bars: timelineState.bars, beatsPerBar: timelineState.beatsPerBar, positiveBeats: timelineState.positiveBeats, pixelsPerBar: timelineState.pixelsPerBar, preStartPixels: timelineState.preStartPixels, playheadX: timelineState.playheadX, trackHeight: timelineState.trackHeight, cycleRange: cycleRange ? { ...cycleRange } : null }, globalTracks:{ visible:!!globalTracks.visible, viewMode:globalTracks.viewMode||'all', arrangement:[...(globalTracks.arrangement||[])], markers:[...(globalTracks.markers||[])], tempoEvents:[...(globalTracks.tempoEvents||[])], signatureEvents:[...(globalTracks.signatureEvents||[])], videoRefs:[...(globalTracks.videoRefs||[])] }, regions:midiRegions.map((region)=>cloneRegionForState(region, { persist:true })), notes:{ pages: notePages.map((p)=>({id:p.id,title:p.title,body:p.body||''})), activePageId: activeNotePageId }, tracks: tracks.map((track)=>{ ensureTrackInsertState(track); const {id,name,color,colorSoft,muted,soloed,recordArmed,automationOpen,volume,pan,outputLevel,midiEffects,instrument,audioEffects}=track; const type=normalizeTrackType(track.type); const channelSettings={notes:track.notes||'',monitor:!!track.monitor,midiInput:track.midiInput||'All Inputs',midiChannel:track.midiChannel||'All',audioInput:track.audioInput||'Browser default',audioOutput:track.audioOutput||'Stereo Out',transpose:Number(track.transpose||0),octaveShift:Number(track.octaveShift||0),velocityOffset:Number(track.velocityOffset||0),quantize:track.quantize||'Off',gainTrim:Number(track.gainTrim||0),meterMode:track.meterMode||'Peak + RMS',midiLatencyMs:Number(track.midiLatencyMs||0),regionColorMode:track.regionColorMode||'Track color',defaultRegionLength:Number(track.defaultRegionLength||4),autoNameRegions:track.autoNameRegions!==false}; return {id,name,type,color,colorSoft,muted,soloed,recordArmed,automationOpen,volume,pan,outputLevel,channelSettings,midiEffects:type==='software'?midiEffects.map((fx)=>({...fx,params:{...(fx.params||{})}})):[],instrument:type==='software'&&instrument?{...instrument,params:{...(instrument.params||{})}}:null,audioEffects:serializeAudioEffects(audioEffects)} }), toggles:{ followPlayhead, metronome:isMetronomeEnabled, countIn:isCountInEnabled, snap:isSnapEnabled, cycle:isCycleEnabled } } }
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
    midiRegions = editorState.regions.map(normalizeLoadedRegion).filter((region)=>region.id && region.trackId)
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
      const savedType = normalizeTrackType(saved.type)
      let t = tracks.find((x) => x.id === saved.id)
      if (!t) {
        t = {
          id: String(saved.id),
          name: saved.name || (savedType === 'audio' ? `Audio ${tracks.length + 1}` : `Software ${tracks.length + 1}`),
          type: savedType,
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
        type: savedType,
        icon: savedType === 'audio' ? 'audio' : 'instrument',
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
        midiEffects: savedType === 'software' && Array.isArray(saved.midiEffects) ? saved.midiEffects.map((fx) => ({ ...fx, params: { ...(fx.params || {}) } })) : [],
        instrument: savedType === 'software' && saved.instrument && typeof saved.instrument === 'object' ? { ...saved.instrument, params: { ...(saved.instrument.params || {}) } } : null,
        audioEffects: serializeAudioEffects(saved.audioEffects)
      })
      if (saved.channelSettings && typeof saved.channelSettings === 'object') Object.assign(t, saved.channelSettings)
      ensureTrackInsertState(t)
    })
    if (!tracks.some((track) => track.id === selectedTrackId)) selectedTrackId = tracks[0]?.id || selectedTrackId
  }
  timelineState.playheadX = Number.isFinite(Number(tl.playheadX)) ? Number(tl.playheadX) : timelineState.playheadX
}
function scheduleEditorSave(){ if(!isEditorLoaded||!projectState?.id) return; saveStatus='Saving…'; if(saveTimer) clearTimeout(saveTimer); saveTimer=setTimeout(async()=>{ try{ await saveStudioProjectEditorState(projectState.id, buildEditorStateForSave()); saveStatus='Saved' }catch(err){ console.error('[studioProject] save editorState failed',err); saveStatus='Save failed' } renderEditor() },800) }

async function hydrateRenderedAudioRegionRuntime(region) {
  if (!region?.id || region.type !== 'audio') return false
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  if (!stretch.enabled || !(stretch.renderedStoragePath || stretch.renderedAudioUrl)) return false
  const runtimeId = stretch.renderedRuntimeId || `${region.id}:stretch:persisted`
  if (audioClipRuntime.has(runtimeId)) {
    region.stretch = { ...stretch, renderedRuntimeId: runtimeId, renderStatus: 'ready', renderedSessionOnly: false, renderError: null }
    return true
  }
  console.info('[audio-hydration] loading rendered stretch', { clipId: region.id, hasStoragePath: Boolean(stretch.renderedStoragePath) })
  const downloadUrl = stretch.renderedAudioUrl || await getStorageAssetUrl(stretch.renderedStoragePath, { scopeKey: `soura-project:${projectState?.id || 'project'}`, type: 'soura-rendered-audio', warnOnFail: true })
  if (!downloadUrl) return false
  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error(`Rendered audio fetch failed (${response.status})`)
    const arrayBuffer = await response.arrayBuffer()
    const ctx = getAudioContext()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const waveform = buildAudioWaveformFromBuffer(audioBuffer, { maxPeaks: 1200 })
    const renderedDurationSeconds = Math.max(minAudioRegionSeconds, audioBuffer.duration)
    audioClipRuntime.set(runtimeId, {
      blob: null,
      url: downloadUrl,
      audioBuffer,
      contentType: 'audio/*',
      fileDurationSeconds: renderedDurationSeconds,
      waveform,
      sourceRuntimeId: region.audioClip?.runtimeId || region.id,
      sessionOnly: false
    })
    region.renderedWaveform = waveform
    region.stretch = {
      ...stretch,
      renderedRuntimeId: runtimeId,
      renderedAudioUrl: stretch.renderedAudioUrl || downloadUrl,
      renderedDurationSeconds,
      renderedSessionOnly: false,
      renderStatus: 'ready',
      renderError: null
    }
    console.info('[audio-hydration] loaded rendered stretch', { clipId: region.id, duration: renderedDurationSeconds })
    return true
  } catch (err) {
    console.warn('[audio-hydration] rendered stretch failed', { clipId: region.id, reason: err?.message || 'decode_failed' })
    region.stretch = { ...stretch, renderStatus: 'failed', renderError: 'Rendered audio file missing or not loaded.' }
    return false
  }
}
async function hydrateAudioEditRenderRuntime(region, mode = 'pitchShift') {
  if (!region?.id || region.type !== 'audio') return false
  const edit = normalizeAudioEdit(region.audioEdit)
  const render = mode === 'pitchTrace' ? edit.pitchTrace : mode === 'reverse' ? edit.reverse : edit.pitchShift
  if (!(render?.renderedStoragePath || render?.renderedAudioUrl)) return false
  const runtimeId = render.renderedRuntimeId || `${region.id}:${mode}:persisted`
  if (audioClipRuntime.has(runtimeId)) {
    if (mode === 'pitchTrace') edit.pitchTrace = { ...edit.pitchTrace, renderedRuntimeId: runtimeId, renderStatus: 'ready', lastError: null }
    else if (mode === 'reverse') edit.reverse = { ...edit.reverse, renderedRuntimeId: runtimeId, renderStatus: 'ready', lastError: null }
    else edit.pitchShift = { ...edit.pitchShift, renderedRuntimeId: runtimeId, renderStatus: 'ready', lastError: null }
    region.audioEdit = normalizeAudioEdit(edit)
    return true
  }
  console.info('[audio-hydration] loading rendered pitch audio', { clipId: region.id, mode, hasStoragePath: Boolean(render.renderedStoragePath) })
  const downloadUrl = render.renderedAudioUrl || await getStorageAssetUrl(render.renderedStoragePath, { scopeKey: `soura-project:${projectState?.id || 'project'}`, type: 'soura-rendered-audio', warnOnFail: true })
  if (!downloadUrl) return false
  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error(`Rendered pitch audio fetch failed (${response.status})`)
    const arrayBuffer = await response.arrayBuffer()
    const ctx = getAudioContext()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const waveform = buildAudioWaveformFromBuffer(audioBuffer, { maxPeaks: 1200 })
    const renderedDurationSeconds = Math.max(minAudioRegionSeconds, audioBuffer.duration)
    audioClipRuntime.set(runtimeId, {
      blob: null,
      url: downloadUrl,
      audioBuffer,
      contentType: 'audio/*',
      fileDurationSeconds: renderedDurationSeconds,
      waveform,
      sourceRuntimeId: region.audioClip?.runtimeId || region.id,
      sessionOnly: false
    })
    region.renderedWaveform = waveform
    if (mode === 'pitchTrace') {
      edit.pitchTrace = {
        ...edit.pitchTrace,
        renderedRuntimeId: runtimeId,
        renderedAudioUrl: edit.pitchTrace.renderedAudioUrl || downloadUrl,
        renderedDurationSeconds,
        renderStatus: 'ready',
        lastError: null
      }
    } else if (mode === 'reverse') {
      edit.reverse = {
        ...edit.reverse,
        renderedRuntimeId: runtimeId,
        renderedAudioUrl: edit.reverse.renderedAudioUrl || downloadUrl,
        renderedDurationSeconds,
        renderStatus: 'ready',
        lastError: null
      }
    } else {
      edit.pitchShift = {
        ...edit.pitchShift,
        renderedRuntimeId: runtimeId,
        renderedAudioUrl: edit.pitchShift.renderedAudioUrl || downloadUrl,
        renderedDurationSeconds,
        renderStatus: 'ready',
        lastError: null
      }
    }
    region.audioEdit = normalizeAudioEdit(edit)
    console.info('[audio-hydration] loaded rendered pitch audio', { clipId: region.id, mode, duration: renderedDurationSeconds })
    return true
  } catch (err) {
    console.warn('[audio-hydration] rendered pitch audio failed', { clipId: region.id, mode, reason: err?.message || 'decode_failed' })
    if (mode === 'pitchTrace') edit.pitchTrace = { ...edit.pitchTrace, renderStatus: 'failed', lastError: 'Rendered pitch trace audio file missing or not loaded.' }
    else if (mode === 'reverse') edit.reverse = { ...edit.reverse, renderStatus: 'failed', lastError: 'Rendered reverse audio file missing or not loaded.' }
    else edit.pitchShift = { ...edit.pitchShift, renderStatus: 'failed', lastError: 'Rendered pitch shift audio file missing or not loaded.' }
    region.audioEdit = normalizeAudioEdit(edit)
    return false
  }
}
async function hydrateAudioRegionRuntime(region) {
  if (!region?.id || region.type !== 'audio') return false
  const audioClip = region.audioClip || {}
  console.info('[audio-hydration] loading clip', { clipId: audioClip.audioAssetId || audioClip.id || region.id, hasStoragePath: Boolean(audioClip.storagePath), contentType: audioClip.contentType || 'audio/*' })
  if (audioClipRuntime.has(audioClip.runtimeId || region.id)) {
    region.audioClip = { ...audioClip, audioReady: true, loadStatus: 'ready', loadError: null, offlineReason: null }
    region.missingMedia = false
    await hydrateRenderedAudioRegionRuntime(region)
    await hydrateAudioEditRenderRuntime(region, 'pitchShift')
    await hydrateAudioEditRenderRuntime(region, 'pitchTrace')
    await hydrateAudioEditRenderRuntime(region, 'reverse')
    return true
  }
  const downloadUrl = audioClip.downloadUrl || (audioClip.storagePath ? await getStorageAssetUrl(audioClip.storagePath, { scopeKey: `soura-project:${projectState?.id || 'project'}`, type: 'soura-audio', warnOnFail: true }) : '')
  if (!downloadUrl) {
    const pitchTraceReady = await hydrateAudioEditRenderRuntime(region, 'pitchTrace')
    const pitchShiftReady = await hydrateAudioEditRenderRuntime(region, 'pitchShift')
    const reverseReady = await hydrateAudioEditRenderRuntime(region, 'reverse')
    const renderedReady = pitchTraceReady || pitchShiftReady || reverseReady || await hydrateRenderedAudioRegionRuntime(region)
    const reason = audioClip.storagePath ? 'storage_fetch_failed' : (audioClip.sessionOnly ? 'session_only_source_lost' : 'missing_storage_path')
    console.info('[audio-hydration] offline clip', { clipId: audioClip.audioAssetId || audioClip.id || region.id, reason })
    region.audioClip = { ...audioClip, audioReady: false, loadStatus: 'missing', loadError: renderedReady ? 'Original audio file missing; persisted rendered audio is available.' : getAudioOfflineMessage({ audioClip: { ...audioClip, offlineReason: reason } }), offlineReason: reason }
    region.missingMedia = !renderedReady
    return renderedReady
  }
  region.audioClip = { ...audioClip, loadStatus: 'loading', loadError: null, offlineReason: null }
  try {
    const response = await fetch(downloadUrl)
    if (!response.ok) throw new Error(`Audio fetch failed (${response.status})`)
    const arrayBuffer = await response.arrayBuffer()
    const ctx = getAudioContext()
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer.slice(0))
    const fileDurationSeconds = Math.max(minAudioRegionSeconds, audioBuffer.duration)
    const waveform = buildAudioWaveformFromBuffer(audioBuffer, { maxPeaks: 1200 })
    region.fileDurationSeconds = Number(region.fileDurationSeconds) || fileDurationSeconds
    region.durationSeconds = Number(region.durationSeconds) || getAudioRegionVisibleDurationSeconds(region)
    region.waveform = Array.isArray(region.waveform?.peaks) && region.waveform.peaks.length ? region.waveform : waveform
    region.audioClip = {
      ...audioClip,
      runtimeId: audioClip.runtimeId || region.id,
      downloadUrl: audioClip.downloadUrl || downloadUrl,
      fileDurationSeconds,
      audioReady: true,
      loadStatus: 'ready',
      loadError: null,
      offlineReason: null,
      sessionOnly: false,
      missingAfterReload: false
    }
    region.missingMedia = false
    audioClipRuntime.set(region.audioClip.runtimeId, {
      blob: null,
      url: downloadUrl,
      audioBuffer,
      contentType: audioClip.contentType || 'audio/*',
      fileDurationSeconds,
      waveform
    })
    await hydrateRenderedAudioRegionRuntime(region)
    await hydrateAudioEditRenderRuntime(region, 'pitchShift')
    await hydrateAudioEditRenderRuntime(region, 'pitchTrace')
    await hydrateAudioEditRenderRuntime(region, 'reverse')
    console.info('[audio-hydration] loaded clip', { clipId: region.audioClip.audioAssetId || region.audioClip.id || region.id, duration: fileDurationSeconds })
    return true
  } catch (err) {
    console.warn('[audio-hydration] failed clip', { clipId: audioClip.audioAssetId || audioClip.id || region.id, reason: err?.message || 'decode_failed' })
    region.audioClip = { ...audioClip, audioReady: false, loadStatus: 'failed', loadError: 'The audio file was found but could not be decoded. Re-upload or re-record the clip.', offlineReason: 'decode_failed' }
    region.missingMedia = true
    return false
  }
}
async function hydrateProjectAudioAssets() {
  const regions = midiRegions.filter((region)=>{
    const edit = normalizeAudioEdit(region.audioEdit)
    return region.type === 'audio' && (
      region.audioClip?.storagePath || region.audioClip?.downloadUrl ||
      region.stretch?.renderedStoragePath || region.stretch?.renderedAudioUrl ||
      edit.pitchShift?.renderedStoragePath || edit.pitchShift?.renderedAudioUrl ||
      edit.pitchTrace?.renderedStoragePath || edit.pitchTrace?.renderedAudioUrl ||
      edit.reverse?.renderedStoragePath || edit.reverse?.renderedAudioUrl
    )
  })
  if (!regions.length) return
  recordingStatus = 'Preparing audio...'
  updateEditorTitleStatus()
  await Promise.allSettled(regions.map((region)=>hydrateAudioRegionRuntime(region)))
  const missingCount = midiRegions.filter((region)=>region.type === 'audio' && region.missingMedia).length
  recordingStatus = missingCount ? `${missingCount} audio file${missingCount === 1 ? '' : 's'} missing or not loaded.` : ''
  renderEditor()
}

function isTextEntryTarget(target){ return target?.matches?.('input, textarea, select, [contenteditable="true"]') || !!target?.closest?.('input, textarea, select, [contenteditable="true"], .studio-notes-modal, .studio-inspector-menu, .daw-plugin-window, .daw-plugin-host-page') }
function createInteractiveAudioContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext
  if (!Ctx) throw new Error('Web Audio API is not supported in this browser.')
  try {
    return new Ctx({ latencyHint: 'interactive' })
  } catch {
    return new Ctx()
  }
}
async function getStudioAudioEngine() { if (!studioAudioEngine) { studioAudioEngine = new StudioAudioEngine(); await studioAudioEngine.init() } return studioAudioEngine }
function getAudioContext(){ if(!audioContext){ audioContext = createInteractiveAudioContext() } if(audioContext.state==='suspended') audioContext.resume().catch((err)=>console.warn('[studioProject] audio context resume failed', err)); return audioContext }
function prewarmDawAudio() {
  try { getAudioContext() } catch (err) { console.warn('[studioProject] audio context prewarm failed', err) }
  if (!audioEnginePrewarmPromise) {
    audioEnginePrewarmPromise = getStudioAudioEngine()
      .then((engine)=>engine.resume().then(()=>engine))
      .catch((err)=>{ audioEnginePrewarmPromise = null; console.warn('[studioProject] audio engine prewarm failed', err); throw err })
  }
  return audioEnginePrewarmPromise
}
function effectDbToGain(db = 0) {
  return 10 ** (clamp(Number(db) || 0, -80, 24) / 20)
}
function setAudioParam(param, value, fallback = 0) {
  if (!param) return
  const next = Number.isFinite(Number(value)) ? Number(value) : fallback
  try {
    param.setTargetAtTime(next, audioContext?.currentTime || 0, 0.015)
  } catch {
    param.value = next
  }
}
function createImpulseBuffer(ctx, params = {}) {
  const duration = clamp(Number(params.decay) || 2.4, 0.2, 8)
  const size = clamp(Number(params.size) || 0.62, 0.1, 1)
  const length = Math.max(1, Math.round(ctx.sampleRate * duration))
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
    const data = impulse.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) {
      const t = index / Math.max(1, length - 1)
      const decay = (1 - t) ** (1.8 + (size * 3.2))
      data[index] = (Math.random() * 2 - 1) * decay
    }
  }
  return impulse
}
function connectSerial(nodes = []) {
  for (let index = 0; index < nodes.length - 1; index += 1) nodes[index]?.connect?.(nodes[index + 1])
}
function createEqEffectNodes(ctx, params = {}) {
  const nodes = []
  const addFilter = (type, frequency, q = 1, gain = 0) => {
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = clamp(Number(frequency) || 1000, 20, 20000)
    if ('Q' in filter) filter.Q.value = clamp(Number(q) || 1, 0.1, 18)
    if ('gain' in filter) filter.gain.value = clamp(Number(gain) || 0, -24, 24)
    nodes.push(filter)
  }
  if (params.hpEnabled) addFilter('highpass', params.hpFrequency, params.hpQ)
  if (params.lowShelfEnabled !== false) addFilter('lowshelf', params.lowShelfFrequency, 1, params.lowShelfGain)
  if (params.bell1Enabled !== false) addFilter('peaking', params.bell1Frequency, params.bell1Q, params.bell1Gain)
  if (params.bell2Enabled !== false) addFilter('peaking', params.bell2Frequency, params.bell2Q, params.bell2Gain)
  if (params.highShelfEnabled !== false) addFilter('highshelf', params.highShelfFrequency, 1, params.highShelfGain)
  if (params.lpEnabled) addFilter('lowpass', params.lpFrequency, params.lpQ)
  const output = ctx.createGain()
  output.gain.value = effectDbToGain(params.outputGain)
  nodes.push(output)
  connectSerial(nodes)
  return { input: nodes[0], output, nodes }
}
function createReverbEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const preDelay = ctx.createDelay(0.5)
  const convolver = ctx.createConvolver()
  const damping = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  preDelay.delayTime.value = clamp(Number(params.preDelay) || 0, 0, 0.25)
  convolver.buffer = createImpulseBuffer(ctx, params)
  damping.type = 'lowpass'
  damping.frequency.value = clamp(Number(params.damping) || 6800, 800, 18000)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  connectSerial([input, preDelay, convolver, damping, wet, output, gain])
  return { input, output: gain, nodes: [input, dry, wet, preDelay, convolver, damping, output, gain] }
}
function createDelayEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const lowCut = ctx.createBiquadFilter()
  const highCut = ctx.createBiquadFilter()
  const delay = ctx.createDelay(2)
  const feedback = ctx.createGain()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  lowCut.type = 'highpass'
  lowCut.frequency.value = clamp(Number(params.lowCut) || 120, 20, 1000)
  highCut.type = 'lowpass'
  highCut.frequency.value = clamp(Number(params.highCut) || 7200, 1000, 18000)
  delay.delayTime.value = clamp(Number(params.time) || 0.28, 0.03, 1.5)
  feedback.gain.value = clamp(Number(params.feedback) || 0, 0, 0.85)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  connectSerial([input, lowCut, highCut, delay, wet, output, gain])
  delay.connect(feedback)
  feedback.connect(delay)
  return { input, output: gain, nodes: [input, dry, wet, lowCut, highCut, delay, feedback, output, gain] }
}
function createAudioEffectNodes(ctx, insert = {}) {
  const params = { ...getAudioEffectDefaultParams(insert.type), ...(insert.params || {}) }
  if (insert.type === 'eq') return createEqEffectNodes(ctx, params)
  if (insert.type === 'reverb') return createReverbEffectNodes(ctx, params)
  if (insert.type === 'delay') return createDelayEffectNodes(ctx, params)
  return null
}
function setTrackChannelVolume(track = {}) {
  const channel = trackAudioChannels.get(track?.id)
  if (!channel?.volumeGain || !audioContext) return
  setAudioParam(channel.volumeGain.gain, clamp((Number(track.volume) || 0) / 100, 0, 1), 0)
}
function rebuildTrackAudioEffectsChain(trackId = '') {
  const channel = trackAudioChannels.get(trackId)
  if (!channel) return
  const ctx = getAudioContext()
  try { channel.input.disconnect() } catch {}
  ;(channel.effectNodes || []).forEach((node) => {
    try { node.disconnect?.() } catch {}
  })
  channel.effectNodes = []
  let current = channel.input
  const track = ensureTrackInsertState(tracks.find((item)=>item.id === trackId))
  const inserts = (track?.audioEffects || []).filter((insert) => insert.enabled !== false && isImplementedAudioEffect(insert.type))
  inserts.forEach((insert) => {
    const effect = createAudioEffectNodes(ctx, insert)
    if (!effect?.input || !effect?.output) return
    current.connect(effect.input)
    current = effect.output
    channel.effectNodes.push(...(effect.nodes || []))
  })
  current.connect(channel.volumeGain)
  setTrackChannelVolume(track)
}
function getTrackAudioChannel(trackId = selectedTrackId) {
  const id = trackId || selectedTrackId || 'master'
  const existing = trackAudioChannels.get(id)
  if (existing) return existing
  const ctx = getAudioContext()
  const input = ctx.createGain()
  const volumeGain = ctx.createGain()
  const panner = ctx.createStereoPanner()
  const analyser = ctx.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.72
  const track = tracks.find((item)=>item.id === id)
  input.gain.value = 1
  volumeGain.gain.value = clamp((Number(track?.volume) || 0) / 100, 0, 1)
  panner.pan.value = clamp((Number(track?.pan) || 0) / 100, -1, 1)
  volumeGain.connect(panner)
  panner.connect(analyser)
  analyser.connect(ctx.destination)
  const channel = { input, volumeGain, panner, analyser, effectNodes: [], data: new Float32Array(analyser.fftSize), level: 0, peak: 0 }
  trackAudioChannels.set(id, channel)
  rebuildTrackAudioEffectsChain(id)
  return channel
}
function disposeTrackAudioChannel(trackId = '') {
  const channel = trackAudioChannels.get(trackId)
  if (!channel) return
  try { channel.input.disconnect() } catch {}
  ;(channel.effectNodes || []).forEach((node) => { try { node.disconnect?.() } catch {} })
  try { channel.volumeGain?.disconnect() } catch {}
  try { channel.panner.disconnect() } catch {}
  try { channel.analyser.disconnect() } catch {}
  trackAudioChannels.delete(trackId)
}
function playMetronomeClick(isDownbeat, startTime = null){
  const ctx=getAudioContext()
  const startAt=Math.max(ctx.currentTime, Number.isFinite(Number(startTime)) ? Number(startTime) : ctx.currentTime)
  const osc=ctx.createOscillator()
  const gain=ctx.createGain()
  osc.type='sine'
  osc.frequency.setValueAtTime(isDownbeat?1200:760,startAt)
  gain.gain.setValueAtTime(0.0001,startAt)
  gain.gain.exponentialRampToValueAtTime(0.16,startAt+0.004)
  gain.gain.exponentialRampToValueAtTime(0.0001,startAt+0.055)
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.start(startAt)
  osc.stop(startAt+0.065)
}
function maybeTickMetronome(){
  if(!isPlaying||!isMetronomeEnabled) return
  const bpm = transportClock?.bpm || Number(projectState?.bpm || 140)
  const currentSeconds = getTransportClockProjectSeconds()
  const currentBeatIndex = Math.max(0, Math.floor(secondsToBeatsAtBpm(currentSeconds, bpm)))
  const lookaheadBeatIndex = Math.max(currentBeatIndex, Math.floor(secondsToBeatsAtBpm(currentSeconds + TRANSPORT_SCHEDULE_LOOKAHEAD_SECONDS, bpm)))
  const firstBeatToSchedule = Math.max(lastMetronomeBeat + 1, currentBeatIndex)
  for (let beatIndex = firstBeatToSchedule; beatIndex <= lookaheadBeatIndex; beatIndex += 1) {
    playMetronomeClick(beatIndex%timelineState.beatsPerBar===0, getTransportScheduleTimeForProjectSeconds(beatsToSecondsAtBpm(beatIndex, bpm)))
    lastMetronomeBeat = beatIndex
  }
}
function secondsFromPlayhead(){ const bpm=Number(projectState?.bpm||140); const beatsFromZero=xToBeatsFromBarZero(timelineState.playheadX); return beatsFromZero*(60/bpm) }
function formatTimeFromPlayhead(){ const raw=secondsFromPlayhead(); const total=Math.abs(raw)<0.0005?0:raw; const isNegative=total<0; const absTotal=Math.abs(total); const m=Math.floor(absTotal/60); const s=Math.floor(absTotal%60); const ms=Math.floor((absTotal%1)*1000); const sub=Math.floor(((absTotal*1000)%1)*100); return `${isNegative?'-':''}${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(3,'0')}.${String(sub).padStart(2,'0')}` }
function formatBarsFromPlayhead(){ const beatsFromZero=xToBeatsFromBarZero(timelineState.playheadX); const bar=Math.floor(beatsFromZero/timelineState.beatsPerBar); const beatWithinBar=beatsFromZero-(bar*timelineState.beatsPerBar); const beat=Math.floor(beatWithinBar)+1; const bf=beatWithinBar%1; const div=Math.floor(bf*4)+1; const tick=Math.floor((bf*4%1)*240)+1; const barLabel=bar<0?`-${String(Math.abs(bar)).padStart(3,'0')}`:String(bar).padStart(3,'0'); return `${barLabel} ${String(beat).padStart(2,'0')} ${div} ${String(tick).padStart(3,'0')}` }
function updateTransportDisplay(){ app.querySelector('[data-display-time]')?.replaceChildren(document.createTextNode(formatTimeFromPlayhead())); app.querySelector('[data-display-bars]')?.replaceChildren(document.createTextNode(formatBarsFromPlayhead())) }
function updateEditorTitleStatus(){ app.querySelector('[data-editor-status]')?.replaceChildren(document.createTextNode(isCountInRunning ? `Count-in: ${countInBeatsRemaining}` : (recordingStatus || 'Project loaded'))) }
function updateCycleDomFromState(){ const rangeEl = app.querySelector('[data-cycle-range]'); const startGuide = app.querySelector('.studio-cycle-guide--start'); const endGuide = app.querySelector('.studio-cycle-guide--end'); if(!cycleRange){ if(rangeEl) rangeEl.style.width='0px'; return } const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); if (rangeEl){ rangeEl.style.left=`${start}px`; rangeEl.style.width=`${Math.max(beatWidth(), end-start)}px`; rangeEl.classList.toggle('is-enabled', isCycleEnabled) } if (startGuide){ startGuide.style.left=`${start}px`; startGuide.classList.toggle('is-enabled', isCycleEnabled) } if (endGuide){ endGuide.style.left=`${end}px`; endGuide.classList.toggle('is-enabled', isCycleEnabled) } }
function updateCycleButtonDom(){ const btn=app.querySelector('[data-toggle-cycle]'); if(!btn) return; btn.classList.toggle('is-active', isCycleEnabled); btn.setAttribute('aria-pressed', String(isCycleEnabled)) }
function setCycleEnabled(enabled){ isCycleEnabled=!!enabled; updateCycleDomFromState(); updateCycleButtonDom() }
function followPlayheadIfNeeded(){ if(!followPlayhead) return; const grid=app.querySelector('[data-arrangement-grid]'); if(!grid) return; const mid=grid.clientWidth*0.5; const max=grid.scrollWidth-grid.clientWidth; grid.scrollLeft=Math.min(Math.max(0,timelineState.playheadX-mid),max); const ruler=app.querySelector('[data-timeline-ruler]'); if(ruler) ruler.scrollLeft=grid.scrollLeft }
function getTransportClockProjectSeconds() {
  if (!isPlaying || !transportClock) return secondsFromPlayhead()
  const ctx = getAudioContext()
  const elapsed = Math.max(0, ctx.currentTime - transportClock.audioContextStartTime)
  return Math.max(0, transportClock.playheadStartSeconds + elapsed - PLAYBACK_LATENCY_COMPENSATION_SECONDS)
}
function getTransportClockProjectBeat() {
  const bpm = transportClock?.bpm || Number(projectState?.bpm || 140)
  return clampBeat(secondsToBeatsAtBpm(getTransportClockProjectSeconds(), bpm))
}
function projectSecondsToTimelineX(seconds = 0, bpm = transportClock?.bpm || Number(projectState?.bpm || 140)) {
  return beatsFromBarZeroToX(secondsToBeatsAtBpm(seconds, bpm))
}
function getTransportScheduleTimeForProjectSeconds(projectSeconds = 0) {
  if (!transportClock) return getAudioContext().currentTime
  return transportClock.audioContextStartTime + (Math.max(0, Number(projectSeconds) || 0) - transportClock.playheadStartSeconds)
}
function beginTransportClock(playheadX = timelineState.playheadX, { schedulerStartDelaySeconds = TRANSPORT_SCHEDULER_START_DELAY_SECONDS } = {}) {
  const ctx = getAudioContext()
  const bpm = Number(projectState?.bpm || 140)
  const playheadStartBeats = clampBeat(xToBeat(playheadX))
  const playheadStartSeconds = beatsToSecondsAtBpm(playheadStartBeats, bpm)
  transportClock = {
    audioContextStartTime: ctx.currentTime + Math.max(0, schedulerStartDelaySeconds),
    playheadStartSeconds,
    playheadStartBeats,
    bpm,
    startedAtPerformanceTime: performance.now(),
    schedulerStartDelaySeconds: Math.max(0, schedulerStartDelaySeconds),
    baseLatencySeconds: Number(ctx.baseLatency) || 0,
    outputLatencySeconds: Number(ctx.outputLatency) || 0
  }
  transportDebugState = { playheadLogged: false, firstAudioScheduled: false, firstMidiScheduled: false }
  lastMetronomeBeat = Math.max(-1, Math.floor(playheadStartBeats) - 1)
  console.info('[transport] play requested', {
    playheadStartSeconds,
    playheadStartBeats,
    audioContextCurrentTime: ctx.currentTime,
    audioContextStartTime: transportClock.audioContextStartTime,
    schedulerStartDelayMs: Math.round(transportClock.schedulerStartDelaySeconds * 1000),
    bpm,
    baseLatencyMs: Math.round(transportClock.baseLatencySeconds * 1000),
    outputLatencyMs: Math.round(transportClock.outputLatencySeconds * 1000),
    playbackLatencyCompensationMs: Math.round(PLAYBACK_LATENCY_COMPENSATION_SECONDS * 1000)
  })
  return transportClock
}
function clearTransportClock() {
  transportClock = null
  transportDebugState = { playheadLogged: false, firstAudioScheduled: false, firstMidiScheduled: false }
}
function updatePlayheadFromTransportClock() {
  const projectSeconds = getTransportClockProjectSeconds()
  const x = projectSecondsToTimelineX(projectSeconds)
  isTransportTicking = true
  setPlayhead(x)
  isTransportTicking = false
  if (!transportDebugState.playheadLogged && transportClock && getAudioContext().currentTime >= transportClock.audioContextStartTime) {
    transportDebugState.playheadLogged = true
    console.info('[playhead]', {
      projectSeconds,
      audioContextCurrentTime: getAudioContext().currentTime,
      derivedFromAudioClock: true
    })
  }
  return { projectSeconds, beat: clampBeat(xToBeat(timelineState.playheadX)) }
}
function getArrangementGrid() { return app.querySelector('[data-arrangement-grid]') }
function syncArrangementRulerScroll(left = null) {
  const grid = getArrangementGrid()
  const ruler = app.querySelector('[data-timeline-ruler]')
  const globalLane = app.querySelector('[data-global-tracks]')
  const extensionLane = app.querySelector('[data-timeline-extension-lane]')
  const nextLeft = Number.isFinite(Number(left)) ? Number(left) : (grid?.scrollLeft || 0)
  if (ruler) ruler.scrollLeft = nextLeft
  if (globalLane) globalLane.scrollLeft = nextLeft
  if (extensionLane) extensionLane.scrollLeft = nextLeft
}
function captureArrangementScroll() {
  const grid = getArrangementGrid()
  if (!grid) return { left: 0, top: 0 }
  return { left: grid.scrollLeft || 0, top: grid.scrollTop || 0 }
}
function restoreArrangementScroll(scroll = null) {
  const grid = getArrangementGrid()
  if (!grid || !scroll) return
  grid.scrollLeft = Math.max(0, Number(scroll.left) || 0)
  grid.scrollTop = Math.max(0, Number(scroll.top) || 0)
  syncArrangementRulerScroll(grid.scrollLeft)
}
function restoreArrangementScrollSoon(scroll = null) {
  if (!scroll) return
  requestAnimationFrame(() => restoreArrangementScroll(scroll))
}
function renderEditorPreservingArrangementScroll(scroll = captureArrangementScroll()) {
  renderEditor()
  restoreArrangementScrollSoon(scroll)
}
function stopTimelineEdgeAutoScroll() {
  if (timelineEdgeScrollRaf) cancelAnimationFrame(timelineEdgeScrollRaf)
  timelineEdgeScrollRaf = 0
  timelineEdgeScrollState = null
}
function tickTimelineEdgeAutoScroll() {
  if (!midiRegionDrag || !timelineEdgeScrollState?.grid || !timelineEdgeScrollState.direction) {
    stopTimelineEdgeAutoScroll()
    return
  }
  const { grid, direction, intensity } = timelineEdgeScrollState
  const maxScroll = Math.max(0, grid.scrollWidth - grid.clientWidth)
  const delta = direction * clamp(4 + (intensity * 18), 4, 24)
  grid.scrollLeft = clamp((grid.scrollLeft || 0) + delta, 0, maxScroll)
  midiRegionDrag.scroll = captureArrangementScroll()
  syncArrangementRulerScroll(grid.scrollLeft)
  timelineEdgeScrollRaf = requestAnimationFrame(tickTimelineEdgeAutoScroll)
}
function updateTimelineEdgeAutoScroll(event) {
  if (!midiRegionDrag) return
  const grid = getArrangementGrid()
  const rect = grid?.getBoundingClientRect?.()
  if (!grid || !rect?.width) return
  const localX = event.clientX - rect.left
  const leftZone = rect.width * 0.1
  const rightZone = rect.width * 0.9
  let direction = 0
  let intensity = 0
  if (localX < leftZone) {
    direction = -1
    intensity = clamp((leftZone - localX) / Math.max(1, leftZone), 0, 1)
  } else if (localX > rightZone) {
    direction = 1
    intensity = clamp((localX - rightZone) / Math.max(1, rect.width - rightZone), 0, 1)
  }
  if (!direction) {
    stopTimelineEdgeAutoScroll()
    return
  }
  timelineEdgeScrollState = { grid, direction, intensity }
  if (!timelineEdgeScrollRaf) timelineEdgeScrollRaf = requestAnimationFrame(tickTimelineEdgeAutoScroll)
}

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
  return midiRegions.map((region)=>cloneRegionForState(region))
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
    selectedRegionIds: getSelectedRegionIds(),
    midiRollState: midiRollState ? { ...midiRollState } : null,
    midiRollSelectedNoteIndex,
    midiRollSelectedNoteIndices: [...midiRollSelectedNoteIndices]
  }
}
function restoreDawSnapshot(snapshot) {
  if (!snapshot) return
  stopAllTrackInstrumentNotes()
  stopAllPlaybackNotes()
  stopAllAudioClipPlayback()
  midiRegions = (snapshot.midiRegions || []).map((region)=>cloneRegionForState(region))
  tracks.splice(0, tracks.length, ...(snapshot.tracks || []).map((track)=>ensureTrackInsertState(deepClone(track))))
  selectedTrackId = snapshot.selectedTrackId || tracks[0]?.id || ''
  selectedMidiRegionId = snapshot.selectedMidiRegionId || ''
  setSelectedRegions(Array.isArray(snapshot.selectedRegionIds) ? snapshot.selectedRegionIds : (selectedMidiRegionId ? [selectedMidiRegionId] : []), { primaryId: selectedMidiRegionId })
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
function commitHistoryMutation(type, mutator, { render = true, save = true, preserveScroll = true } = {}) {
  const scroll = preserveScroll ? captureArrangementScroll() : null
  const before = captureDawSnapshot()
  mutator?.()
  const after = captureDawSnapshot()
  pushHistory(type, before, after)
  if (save) scheduleEditorSave()
  if (render) renderEditorPreservingArrangementScroll(scroll)
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
  return name || getMidiRegionTrack(region)?.name || (region?.type === 'audio' ? 'Audio Region' : 'MIDI Region')
}
function getMidiRollRegion() {
  const region = midiRegions.find((item)=>item.id === midiRollState?.regionId) || midiRegions.find((item)=>item.id === selectedMidiRegionId)
  return region?.type === 'audio' ? null : region
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
function getSnapStepBeats() {
  return 1
}
function snapBeatToGrid(beat = 0, stepBeats = getSnapStepBeats(), direction = 'nearest') {
  const step = Math.max(0.03125, Number(stepBeats) || 1)
  const value = Number(beat) || 0
  const epsilon = 1e-7
  if (direction === 'right') return Math.ceil((value + epsilon) / step) * step
  if (direction === 'left') return Math.floor((value - epsilon) / step) * step
  return Math.round(value / step) * step
}
function movePlayheadByKeyboard({ currentBeat = 0, direction = 1, snapEnabled = isSnapEnabled, stepBeats = getSnapStepBeats(), event = null } = {}) {
  const dir = direction < 0 ? -1 : 1
  if (snapEnabled) return clampBeat(snapBeatToGrid(currentBeat, stepBeats, dir > 0 ? 'right' : 'left'))
  const modifierStep = event?.shiftKey ? 1 : (event?.altKey ? 1 / 16 : 1 / 8)
  return clampBeat((Number(currentBeat) || 0) + (dir * modifierStep))
}
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
function regionPixelsToSeconds(pixels = 0) { return beatsToSeconds(regionPixelsToBeats(pixels)) }
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
  const title = panel === 'midi-roll' ? 'Region Editor' : panel === 'instrument' ? 'Instrument' : panel.charAt(0).toUpperCase() + panel.slice(1)
  const popup = window.open('', `melogic-${panel}-panel`, 'width=980,height=680,resizable=yes,scrollbars=yes')
  if (!popup) return
  const body = app.querySelector('.studio-bottom-panel')?.outerHTML || `<section><h1>${esc(title)}</h1><p>No panel content available.</p></section>`
  popup.document.open()
  popup.document.write(`<!doctype html><html><head><title>${esc(title)} | Melogic DAW</title><style>body{margin:0;background:#0b111d;color:#eef4ff;font-family:Inter,system-ui,sans-serif}.studio-bottom-panel{position:static!important;inset:auto!important;width:100vw!important;height:100vh!important;max-height:none!important;border:0!important}.studio-bottom-panel-resize,.studio-bottom-panel-close,[data-detach-bottom-panel]{display:none!important}</style><link rel="stylesheet" href="/src/styles/base.css"><link rel="stylesheet" href="/src/styles/studio.css"></head><body>${body}<script>document.querySelectorAll('button,input,select,textarea').forEach((el)=>{ el.disabled=true })</script></body></html>`)
  popup.document.close()
}
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
function captureAudioRegionToolsViewport() {
  const scroll = app.querySelector('[data-region-editor-scroll]')
  const region = getSelectedAudioRegion()
  if (!scroll || !region) return audioRegionToolsViewport
  audioRegionToolsViewport = {
    regionId: region.id,
    scrollTop: scroll.scrollTop || 0
  }
  return audioRegionToolsViewport
}
function restoreAudioRegionToolsViewport(viewport = audioRegionToolsViewport) {
  const scroll = app.querySelector('[data-region-editor-scroll]')
  const region = getSelectedAudioRegion()
  if (!scroll || !region || viewport?.regionId !== region.id) return
  scroll.scrollTop = viewport.scrollTop || 0
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
function setPlayhead(x) {
  timelineState.playheadX = clamp(x, timelineStartX(), maxTimelineX())
  if (studioAudioEngine) studioAudioEngine.setPositionBeats(xToBeatsFromBarZero(timelineState.playheadX))
  app.querySelector('[data-arrangement]')?.style.setProperty('--playhead-x', `${timelineState.playheadX}px`)
  updateTransportDisplay()
  updateMidiRollPlayheadDom()
  if (isPlaying && !isTransportTicking) {
    stopAllAudioClipPlayback()
    stopAllPlaybackNotes()
    beginTransportClock(timelineState.playheadX)
    const beat = clampBeat(xToBeat(timelineState.playheadX))
    updateMidiRegionPlayback(beat)
    updateAudioClipPlayback(beat)
  }
}
function pixelsPerSecond() { const bpm = Number(projectState?.bpm || 140); const bps = bpm / 60; const ppb = timelineState.pixelsPerBar / timelineState.beatsPerBar; return bps * ppb }
function updateTransportPlaybackUI() { const btn = app.querySelector('[data-transport-play]'); if (!btn) return; const locked = !!(activeRecording || isCountInRunning || audioStretchRenderState.active || audioPitchRenderState.active || audioPreflightRenderState.active); btn.classList.toggle('is-active', isPlaying); btn.classList.toggle('is-disabled', locked); btn.toggleAttribute('disabled', locked); btn.setAttribute('aria-pressed', String(isPlaying)); btn.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play'); btn.innerHTML = isPlaying ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M8 5v14M16 5v14"/></svg>' : toolIcon('play') }
function tickPlayback() {
  if (!isPlaying) return
  const cycle = isCycleEnabled && !isCountInRunning ? getNormalizedCycleRange() : null
  let state = updatePlayheadFromTransportClock()
  if (cycle && timelineState.playheadX >= cycle.end) {
    stopAllPlaybackNotes()
    stopAllAudioClipPlayback()
    beginTransportClock(cycle.start, { schedulerStartDelaySeconds: 0 })
    state = updatePlayheadFromTransportClock()
  }
  if (isCountInRunning && countInTargetX != null && timelineState.playheadX >= countInTargetX) {
    isTransportTicking = true
    setPlayhead(countInTargetX)
    isTransportTicking = false
    beginTransportClock(timelineState.playheadX, { schedulerStartDelaySeconds: 0 })
    state = updatePlayheadFromTransportClock()
  }
  if (isCountInRunning && countInTargetX != null) {
    const nextRemaining = clamp(Math.ceil((countInTargetX - timelineState.playheadX) / Math.max(1, beatWidth())), 0, 4)
    if (nextRemaining !== countInBeatsRemaining) {
      countInBeatsRemaining = nextRemaining
      updateEditorTitleStatus()
    }
    if (timelineState.playheadX >= countInTargetX - 0.5) {
      const track = tracks.find((item)=>item.id === countInTargetTrackId) || getRecordingTrack()
      isCountInRunning = false
      countInBeatsRemaining = 0
      countInTargetX = null
      countInTargetTrackId = ''
      if (isAudioTrack(track)) beginAudioRecording(track, { startBeat: clampBeat(xToBeat(timelineState.playheadX)) })
      else beginMidiRecording(track, { startBeat: clampBeat(xToBeat(timelineState.playheadX)) })
      playRaf = requestAnimationFrame(tickPlayback)
      return
    }
  }
  const currentBeat = state.beat
  updateMidiRegionPlayback(currentBeat)
  updateAudioClipPlayback(currentBeat)
  lastPlaybackBeat = currentBeat
  if(activeRecording) refreshMidiRegionDom()
  followPlayheadIfNeeded()
  maybeTickMetronome()
  if (timelineState.playheadX >= maxTimelineX()) return pausePlayback()
  playRaf = requestAnimationFrame(tickPlayback)
}
async function prepareProjectPlayback() {
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume().catch((err)=>console.warn('[studioProject] audio context resume failed', err))
  tracks.filter(isSoftwareTrack).forEach((track)=>ensureTrackInstrumentInstance(track))
  const pendingAudio = midiRegions.filter((region)=>{
    const edit = normalizeAudioEdit(region.audioEdit)
    const stretch = normalizeAudioStretch(region.stretch, {
      clipId: region.id,
      sourceDurationSeconds: getAudioSourceDurationSeconds(region),
      visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
    })
    const stretchRuntimeId = stretch.renderedRuntimeId || `${region.id}:stretch:persisted`
    return region.type === 'audio' && (
      region.audioClip?.loadStatus === 'pending' ||
      region.audioClip?.loadStatus === 'failed' ||
      stretch.renderStatus === 'needs_render' ||
      (stretch.enabled && stretch.renderStatus === 'ready' && (stretch.renderedStoragePath || stretch.renderedAudioUrl) && !audioClipRuntime.has(stretchRuntimeId)) ||
      edit.pitchShift?.renderStatus === 'needs_render' ||
      edit.pitchTrace?.renderStatus === 'needs_render' ||
      edit.reverse?.renderStatus === 'needs_render'
    ) && (
      region.audioClip?.storagePath || region.audioClip?.downloadUrl ||
      region.stretch?.renderedStoragePath || region.stretch?.renderedAudioUrl ||
      edit.pitchShift?.renderedStoragePath || edit.pitchShift?.renderedAudioUrl ||
      edit.pitchTrace?.renderedStoragePath || edit.pitchTrace?.renderedAudioUrl ||
      edit.reverse?.renderedStoragePath || edit.reverse?.renderedAudioUrl
    )
  })
  if (pendingAudio.length) await Promise.allSettled(pendingAudio.map((region)=>hydrateAudioRegionRuntime(region)))
}
function collectAudioRenderReadinessTasks() {
  return midiRegions.filter((region)=>region.type === 'audio').map((region)=> {
    const stretch = normalizeAudioStretch(region.stretch, {
      clipId: region.id,
      sourceDurationSeconds: getAudioSourceDurationSeconds(region),
      visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
    })
    const edit = normalizeAudioEdit(region.audioEdit)
    const choice = getAudioPlaybackRenderChoice(region, edit, stretch)
    if (choice.needsRender) return { regionId: region.id, mode: choice.promptMode, label: getMidiRegionLabel(region) }
    if (choice.needsStretchRender) return { regionId: region.id, mode: 'stretch', label: getMidiRegionLabel(region) }
    return null
  }).filter(Boolean)
}
async function runAudioRenderReadinessAudit() {
  const tasks = collectAudioRenderReadinessTasks()
  if (!tasks.length) return true
  audioPreflightRenderState = { active: true, total: tasks.length, completed: 0, currentLabel: 'Queued', error: '', failed: [] }
  renderEditor()
  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]
    audioPreflightRenderState = { ...audioPreflightRenderState, completed: index, currentLabel: `${task.label} · ${task.mode}` }
    renderEditor()
    const beforeErrors = midiRegions.map((region)=>({ id: region.id, edit: normalizeAudioEdit(region.audioEdit), stretch: normalizeAudioStretch(region.stretch, {
      clipId: region.id,
      sourceDurationSeconds: region.type === 'audio' ? getAudioSourceDurationSeconds(region) : null,
      visibleDurationSeconds: region.type === 'audio' ? getRawAudioRegionVisibleDurationSeconds(region) : null
    }) }))
    if (task.mode === 'stretch') await renderAudioStretchForRegion(task.regionId)
    else if (task.mode === 'trace') await renderPitchTraceEditsForRegion(task.regionId)
    else if (task.mode === 'reverse') await renderAudioReverseForRegion(task.regionId)
    else await renderAudioPitchShiftForRegion(task.regionId)
    const region = midiRegions.find((item)=>item.id === task.regionId)
    const edit = normalizeAudioEdit(region?.audioEdit)
    const stretch = normalizeAudioStretch(region?.stretch, {
      clipId: region?.id,
      sourceDurationSeconds: region ? getAudioSourceDurationSeconds(region) : null,
      visibleDurationSeconds: region ? getRawAudioRegionVisibleDurationSeconds(region) : null
    })
    const failed = task.mode === 'stretch'
      ? stretch.renderStatus === 'failed'
      : task.mode === 'trace'
        ? edit.pitchTrace.renderStatus === 'failed'
        : task.mode === 'reverse'
          ? edit.reverse.renderStatus === 'failed'
          : edit.pitchShift.renderStatus === 'failed'
    if (failed) {
      const prior = beforeErrors.find((item)=>item.id === task.regionId)
      audioPreflightRenderState = { ...audioPreflightRenderState, active: true, error: `Render failed for ${task.label}.`, failed: [{ ...task, prior }] }
      renderEditor()
      return false
    }
  }
  audioPreflightRenderState = { active: false, total: 0, completed: 0, currentLabel: '', error: '', failed: [] }
  renderEditor()
  return true
}
async function startPlayback({ skipRenderAudit = false } = {}) {
  if (isPlaying || audioStretchRenderState.active || audioPitchRenderState.active || audioPreflightRenderState.active) return
  const requestedPlayheadX = timelineState.playheadX
  const cycle = isCycleEnabled && !isCountInRunning ? getNormalizedCycleRange() : null
  if (cycle && (timelineState.playheadX < cycle.start || timelineState.playheadX >= cycle.end)) setPlayhead(cycle.start)
  const playbackStartX = timelineState.playheadX
  recordingStatus = 'Preparing audio...'
  updateEditorTitleStatus()
  await prepareProjectPlayback()
  if (!skipRenderAudit) {
    const ready = await runAudioRenderReadinessAudit()
    if (!ready) {
      recordingStatus = 'Audio render failed before playback.'
      updateEditorTitleStatus()
      return
    }
    setPlayhead(playbackStartX || requestedPlayheadX)
  }
  const ctx = getAudioContext()
  if (ctx.state === 'suspended') await ctx.resume().catch((err)=>console.warn('[studioProject] audio context resume failed', err))
  recordingStatus = recordingStatus === 'Preparing audio...' ? '' : recordingStatus
  beginTransportClock(timelineState.playheadX)
  prewarmDawAudio().then((engine) => {
    engine.setBpm(Number(projectState?.bpm || 140))
    engine.setPositionBeats(xToBeatsFromBarZero(timelineState.playheadX))
    engine.startTransport({ bpm: Number(projectState?.bpm || 140), positionBeats: xToBeatsFromBarZero(timelineState.playheadX) })
  }).catch((err)=>console.warn('[studioProject] audio engine start failed', err))
  isPlaying = true
  lastPlaybackBeat = clampBeat(xToBeat(timelineState.playheadX))
  lastPlayTimestamp = performance.now()
  startTrackMeterLoop()
  updateAudioClipPlayback(lastPlaybackBeat)
  updateMidiRegionPlayback(lastPlaybackBeat)
  playRaf = requestAnimationFrame(tickPlayback)
  updateTransportPlaybackUI()
  updateEditorTitleStatus()
}
function pausePlayback() { isPlaying = false; clearTransportClock(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); try { studioAudioEngine?.pauseTransport() } catch (err) { console.warn('[studioProject] audio engine pause failed', err) } if (playRaf) cancelAnimationFrame(playRaf); playRaf = 0; updateTransportPlaybackUI() }
function togglePlayback(){ isPlaying ? pausePlayback() : startPlayback() }
function stopPlayback() { pausePlayback(); audioEditPlaybackBypassRegionIds.clear(); try { studioAudioEngine?.stopTransport() } catch (err) { console.warn('[studioProject] audio engine stop failed', err) } lastMetronomeBeat = -1; if (countInTimer) clearInterval(countInTimer); countInTimer = 0; isCountInRunning = false; countInBeatsRemaining = 0; countInTargetX = null; countInTargetTrackId = '' }
function getNormalizedCycleRange(){ if(!cycleRange) return null; const start=Math.min(cycleRange.startX,cycleRange.endX); const end=Math.max(cycleRange.startX,cycleRange.endX); return end-start>=cycleMinWidth()?{start,end}:null }
function hasValidCycleRange(){ return !!getNormalizedCycleRange() }
function isCycleStripPointerEvent(event, ruler){ const rect = ruler?.getBoundingClientRect?.(); if(!rect) return false; const localY = event.clientY - rect.top; return localY >= 0 && localY <= 22 }
function handleSpaceTransport(event){ if (event.ctrlKey || event.metaKey || event.altKey || isTextEntryTarget(event.target)) return; event.preventDefault(); if (audioStretchRenderState.active || audioPitchRenderState.active || audioPreflightRenderState.active) return; if (activeRecording || isCountInRunning) { stopRecordingAndKeep(); return } const cycle = isCycleEnabled ? getNormalizedCycleRange() : null; if (!isPlaying) { spacePlaybackStartX = cycle ? cycle.start : timelineState.playheadX; if (cycle) setPlayhead(cycle.start); startPlayback(); return } pausePlayback(); setPlayhead(cycle ? cycle.start : (spacePlaybackStartX ?? timelineState.playheadX)) }

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
async function ensureInstrumentAudio(){ if(!instrumentAudioContext){ instrumentAudioContext = createInteractiveAudioContext(); instrumentMasterGain = instrumentAudioContext.createGain(); instrumentPanNode = instrumentAudioContext.createStereoPanner(); instrumentMasterGain.gain.value=instrumentVolume; instrumentPanNode.pan.value=instrumentPan; instrumentPanNode.connect(instrumentMasterGain); instrumentMasterGain.connect(instrumentAudioContext.destination) } if(instrumentAudioContext.state==='suspended') await instrumentAudioContext.resume(); }
async function startInstrumentNote(midi){ const shifted=midi+(instrumentOctaveOffset*12); if(activeInstrumentNotes.has(shifted)) return; try{ await ensureInstrumentAudio(); const osc=instrumentAudioContext.createOscillator(); const gain=instrumentAudioContext.createGain(); osc.type='triangle'; osc.frequency.value=midiToFrequency(shifted); gain.gain.setValueAtTime(0.0001,instrumentAudioContext.currentTime); gain.gain.exponentialRampToValueAtTime(0.16*instrumentVolume,instrumentAudioContext.currentTime+0.02); osc.connect(gain); gain.connect(instrumentPanNode); osc.start(); activeInstrumentNotes.set(shifted,{osc,gain,midi:shifted}); setTrackKeyboardNoteActive(selectedTrackId, shifted, `legacy:${shifted}`, true) }catch(err){ console.warn('[studioProject] instrument note start failed',err) } }
function stopInstrumentNote(midi){ const shifted=midi+(instrumentOctaveOffset*12); if(isSustainEnabled) return; const voice=activeInstrumentNotes.get(shifted); if(!voice||!instrumentAudioContext) return; voice.gain.gain.cancelScheduledValues(instrumentAudioContext.currentTime); voice.gain.gain.setValueAtTime(Math.max(0.0001,voice.gain.gain.value),instrumentAudioContext.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001,instrumentAudioContext.currentTime+0.08); voice.osc.stop(instrumentAudioContext.currentTime+0.1); activeInstrumentNotes.delete(shifted); setTrackKeyboardNoteActive(selectedTrackId, shifted, `legacy:${shifted}`, false) }
function stopAllInstrumentNotes(){ if(!instrumentAudioContext) { activeInstrumentNotes.clear(); return } for(const [m,voice] of activeInstrumentNotes){ voice.gain.gain.cancelScheduledValues(instrumentAudioContext.currentTime); voice.gain.gain.setValueAtTime(Math.max(0.0001,voice.gain.gain.value),instrumentAudioContext.currentTime); voice.gain.gain.exponentialRampToValueAtTime(0.0001,instrumentAudioContext.currentTime+0.05); voice.osc.stop(instrumentAudioContext.currentTime+0.08); activeInstrumentNotes.delete(m); setTrackKeyboardNoteActive(selectedTrackId, voice.midi, `legacy:${voice.midi}`, false) } }

function ensureTrackInstrumentInstance(track = getSelectedTrack()) {
  const target = ensureTrackInsertState(track)
  if (!target?.instrument) return null
  if (!target.instrument.pluginInstanceId) target.instrument.pluginInstanceId = `${target.instrument.type}:${target.id}`
  const channel = getTrackAudioChannel(target.id)
  setTrackChannelVolume(target)
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
function warmTrackInstrument(track = getSelectedTrack(), { reason = 'selection' } = {}) {
  const instrument = ensureTrackInstrumentInstance(track)
  if (!instrument?.preload) return
  const status = instrument.getStatus?.().status || ''
  if (status !== 'loaded') {
    console.info('[live-note] instrument loading', {
      instrumentId: track?.instrument?.pluginInstanceId || instrument.id,
      reason
    })
  }
  instrument.preload().catch((error) => {
    console.warn('[live-note] instrument preload failed', {
      instrumentId: track?.instrument?.pluginInstanceId || instrument.id,
      message: error?.message
    })
  })
}
function warmSelectedTrackInstrument(reason = 'selection') {
  warmTrackInstrument(getSelectedTrack(), { reason })
}
function triggerLiveInstrumentNote(track, note, velocity = 0.85, { source = 'live', activeKey = '' } = {}) {
  if (!track?.instrument || track.instrument.enabled === false) return
  const inputPerformanceTime = performance.now()
  const instrument = ensureTrackInstrumentInstance(track)
  if (!instrument) return
  const ctx = getAudioContext()
  const instrumentId = track.instrument.pluginInstanceId
  console.info('[live-note] input', {
    note,
    inputPerformanceTime,
    audioContextCurrentTime: ctx.currentTime,
    selectedTrackId: track.id,
    instrumentId,
    source
  })
  if (instrument?.preload && instrument.getStatus?.().status !== 'loaded') {
    console.info('[live-note] instrument loading', { instrumentId, source })
  }
  dawInstrumentRegistry.noteOn(instrumentId, note, velocity, {
    live: true,
    startOffsetSeconds: LIVE_NOTE_SAFETY_OFFSET_SECONDS,
    inputPerformanceTime,
    selectedTrackId: track.id,
    source
  })
  startTrackMeterLoop()
  setTrackKeyboardNoteActive(track.id, note, activeKey || `live:${track.id}:${note}`, true)
  recordMidiNoteOn(track.id, note, velocity)
}
function stopLiveInstrumentNote(track, note, { activeKey = '' } = {}) {
  if (!track?.instrument) return
  dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, note, { live: true })
  setTrackKeyboardNoteActive(track.id, note, activeKey || `live:${track.id}:${note}`, false)
  recordMidiNoteOff(track.id, note)
}
function playTrackMidiNote(track, note, velocity = 0.85) {
  triggerLiveInstrumentNote(track, note, velocity)
}
function stopTrackMidiNote(track, note) {
  stopLiveInstrumentNote(track, note)
}
function hasSoloedTracks() { return tracks.some((track)=>track.soloed) }
function isTrackOutputAudible(track) {
  if (!track || track.muted) return false
  if (hasSoloedTracks() && !track.soloed) return false
  return true
}
function isTrackAudible(track) {
  if (!isTrackOutputAudible(track)) return false
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
  if (track?.instrument?.pluginInstanceId) dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, active.note, { immediate: true })
  setTrackKeyboardNoteActive(active.trackId, active.note, `playback:${key}`, false)
  activePlaybackNotes.delete(key)
}
function stopAllPlaybackNotes() {
  Array.from(activePlaybackNotes.keys()).forEach((key)=>stopPlaybackNote(key))
}
function stopAudioClipPlayback(regionId = '') {
  const active = activeAudioClipSources.get(regionId)
  if (!active) return
  try { active.source?.stop?.() } catch {}
  if (active.stopTimer) window.clearTimeout(active.stopTimer)
  try { active.element?.pause?.() } catch {}
  try { active.element?.removeAttribute?.('src') } catch {}
  try { active.source?.disconnect?.() } catch {}
  try { active.gainNode?.disconnect?.() } catch {}
  try { active.mediaSource?.disconnect?.() } catch {}
  activeAudioClipSources.delete(regionId)
}
function dbToGain(db = 0) {
  return 10 ** ((Number(db) || 0) / 20)
}
function fadeGainValue(progress = 0, curve = 'linear', direction = 'in') {
  const t = clamp(progress, 0, 1)
  if (curve === 'equal-power') {
    return direction === 'out' ? Math.cos(t * Math.PI / 2) : Math.sin(t * Math.PI / 2)
  }
  return direction === 'out' ? 1 - t : t
}
function makeFadeGainCurve({ baseGain, fromProgress = 0, toProgress = 1, curve = 'linear', direction = 'in', steps = 64 } = {}) {
  const values = new Float32Array(steps)
  for (let index = 0; index < steps; index += 1) {
    const amount = steps <= 1 ? 1 : index / (steps - 1)
    const progress = fromProgress + ((toProgress - fromProgress) * amount)
    values[index] = Math.max(0.0001, baseGain * fadeGainValue(progress, curve, direction))
  }
  return values
}
function stopAllAudioClipPlayback() {
  Array.from(activeAudioClipSources.keys()).forEach((regionId)=>stopAudioClipPlayback(regionId))
}
function createPendingStretchMetadata(input = {}) {
  const sourceDurationSeconds = finitePositiveNumber(input.sourceDurationSeconds)
  const targetDurationSeconds = finitePositiveNumber(input.targetDurationSeconds)
  const lengthRatio = sourceDurationSeconds && targetDurationSeconds ? targetDurationSeconds / sourceDurationSeconds : 1
  const speedPercent = sourceDurationSeconds && targetDurationSeconds ? (sourceDurationSeconds / targetDurationSeconds) * 100 : 100
  const supported = Number.isFinite(lengthRatio) && Number.isFinite(speedPercent) && lengthRatio >= STRETCH_RATIO_MIN && lengthRatio <= STRETCH_RATIO_MAX && speedPercent >= STRETCH_SPEED_MIN && speedPercent <= STRETCH_SPEED_MAX
  return buildCanonicalStretch({
    enabled: true,
    sourceDurationSeconds,
    targetDurationSeconds,
    renderStatus: Math.abs(lengthRatio - 1) <= 0.001 ? 'idle' : 'needs_render',
    renderError: supported ? null : stretchErrorMessage(),
    renderedSessionOnly: true,
    algorithm: 'signalsmith_wasm_time_stretch_v1',
    preservesPitch: true
  })
}
async function renderAudioStretchForRegion(regionId) {
  if (audioStretchRenderState.active) return
  const region = midiRegions.find((item)=>item.id === regionId && item.type === 'audio')
  if (!region) return
  const stretch = normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: getAudioSourceDurationSeconds(region),
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  })
  if (!stretch.enabled) {
    scheduleEditorSave()
    return
  }
  const stretchMath = getAudioStretchMath(region)
  if (!stretchMath.supported) {
    region.stretch = { ...stretch, renderStatus: 'failed', renderError: stretchMath.error, lastError: stretchMath.error }
    recordingStatus = stretchMath.error
    logStretchDebug('render failed', region.id, { ...stretchMath, renderStatus: 'failed', reason: stretchMath.error })
    scheduleEditorSave()
    renderEditor()
    return
  }
  let runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  if (!runtime?.audioBuffer && (region.audioClip?.storagePath || region.audioClip?.downloadUrl)) {
    await hydrateAudioRegionRuntime(region)
    runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  }
  if (!runtime?.audioBuffer) {
    region.stretch = { ...stretch, renderStatus: 'failed', renderError: 'Original audio is offline. Reconnect or re-record before rendering stretch.', lastError: 'Original audio is offline. Reconnect or re-record before rendering stretch.' }
    recordingStatus = region.stretch.renderError
    logStretchDebug('render failed', region.id, { ...stretchMath, renderStatus: 'failed', reason: region.stretch.renderError })
    scheduleEditorSave()
    renderEditor()
    return
  }
  stopPlayback()
  audioStretchRenderState = { active: true, regionId, progress: null, error: '' }
  region.stretch = { ...stretch, renderStatus: 'rendering', renderError: null }
  logStretchDebug('render start', region.id, { ...stretchMath, renderStatus: 'rendering' })
  renderEditor()
  try {
    const result = await renderAudioDsp(SOURA_AUDIO_DSP_OPERATIONS.timeStretch, {
      sourceBuffer: runtime.audioBuffer,
      sourceStartSeconds: getAudioTrimStartSeconds(region),
      sourceDurationSeconds: stretchMath.sourceDurationSeconds,
      targetDurationSeconds: stretchMath.targetDurationSeconds,
      sampleRate: runtime.audioBuffer.sampleRate,
      sourceBitDepth: getAudioSourceBitDepth(region),
      quality: 'high',
      onProgress: (progress) => {
        audioStretchRenderState = { ...audioStretchRenderState, progress }
      }
    })
    const renderedWaveform = buildAudioWaveformFromBuffer(result.renderedAudioBuffer, { maxPeaks: 1200 })
    const renderedRuntimeId = `${region.id}:stretch:${Math.round(stretchMath.lengthRatio * 1000)}:${result.createdAt}`
    let renderedStoragePath = null
    let renderedSessionOnly = true
    try {
      renderedStoragePath = await uploadSouraAudioBlob(result.renderedBlob, {
        clipId: region.id,
        suffix: `stretch-${Math.round(stretchMath.lengthRatio * 1000)}`
      })
      renderedSessionOnly = !renderedStoragePath
    } catch (uploadErr) {
      console.warn('[studioProject] rendered stretch upload failed; using session render only', uploadErr)
    }
    audioClipRuntime.set(renderedRuntimeId, {
      blob: result.renderedBlob,
      url: result.renderedObjectUrl,
      audioBuffer: result.renderedAudioBuffer,
      contentType: result.renderedBlob?.type || 'audio/wav',
      fileDurationSeconds: result.renderedDurationSeconds,
      waveform: renderedWaveform,
      sourceRuntimeId: region.audioClip?.runtimeId || region.id,
      sessionOnly: renderedSessionOnly
    })
    region.visibleDurationSeconds = Math.max(minAudioRegionSeconds, result.renderedDurationSeconds)
    region.durationSeconds = region.visibleDurationSeconds
    region.durationBeats = secondsToBeats(region.visibleDurationSeconds)
    region.endBeat = Number(region.startBeat || 0) + region.durationBeats
    region.renderedWaveform = renderedWaveform
    region.stretch = buildCanonicalStretch({
      enabled: true,
      sourceDurationSeconds: stretchMath.sourceDurationSeconds,
      targetDurationSeconds: stretchMath.targetDurationSeconds,
      renderStatus: 'ready',
      algorithm: result.algorithm,
      preservesPitch: result.preservesPitch,
      renderedObjectUrl: null,
      renderedAudioUrl: null,
      renderedStoragePath,
      renderedRuntimeId,
      renderedDurationSeconds: result.renderedDurationSeconds,
      renderedAudio: result.renderedAudio,
      renderedAt: result.createdAt,
      renderedSessionOnly,
      updatedAt: result.createdAt
    })
    region.stretchRender = {
      implemented: true,
      algorithm: result.algorithm,
      preservesPitch: result.preservesPitch,
      renderedAudio: result.renderedAudio,
      renderedRuntimeId,
      renderedStoragePath,
      sessionOnly: renderedSessionOnly
    }
    syncAudioRegionTimeline(region)
    recordingStatus = 'Audio stretch rendered.'
    logStretchDebug('render success', region.id, { ...stretchMath, renderStatus: 'ready' })
    scheduleEditorSave()
  } catch (err) {
    console.error('[stretch-render] failed', { clipId: region.id, reason: err?.message || 'Audio stretch render failed.' })
    region.stretch = { ...stretch, renderStatus: 'failed', renderError: err?.message || 'Audio stretch render failed.', lastError: err?.message || 'Audio stretch render failed.' }
    region.renderedWaveform = null
    region.stretchRender = { implemented: false, reason: region.stretch.renderError, ratio: stretchMath.lengthRatio }
    recordingStatus = 'Audio stretch render failed. The original audio was not changed.'
    logStretchDebug('render failed', region.id, { ...stretchMath, renderStatus: 'failed', reason: region.stretch.renderError })
    scheduleEditorSave()
  } finally {
    audioStretchRenderState = { active: false, regionId: '', progress: null, error: '' }
    renderEditor()
  }
}
async function renderAudioPitchShiftForRegion(regionId) {
  if (audioPitchRenderState.active) return
  const region = midiRegions.find((item)=>item.id === regionId && item.type === 'audio')
  if (!region) return
  let edit = normalizeAudioEdit(region.audioEdit)
  const pitchShift = edit.pitchShift
  if (Math.abs(Number(pitchShift.totalSemitones) || 0) <= 0.001) {
    region.audioEdit = normalizeAudioEdit({ ...edit, pitchShift: { ...pitchShift, renderStatus: 'idle', lastError: null } })
    scheduleEditorSave()
    renderEditor()
    return
  }
  let runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  if (!runtime?.audioBuffer && (region.audioClip?.storagePath || region.audioClip?.downloadUrl)) {
    await hydrateAudioRegionRuntime(region)
    runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  }
  if (!runtime?.audioBuffer) {
    region.audioEdit = normalizeAudioEdit({ ...edit, pitchShift: { ...pitchShift, renderStatus: 'failed', lastError: 'Original audio is offline. Reconnect or re-record before rendering pitch shift.' } })
    recordingStatus = region.audioEdit.pitchShift.lastError
    scheduleEditorSave()
    renderEditor()
    return
  }
  stopPlayback()
  audioPitchRenderState = { active: true, regionId, mode: 'pitchShift', progress: null, error: '' }
  region.audioEdit = normalizeAudioEdit({ ...edit, pitchShift: { ...pitchShift, renderStatus: 'rendering', lastError: null } })
  renderEditor()
  try {
    const result = await renderAudioDsp(SOURA_AUDIO_DSP_OPERATIONS.pitchShift, {
      audioBuffer: runtime.audioBuffer,
      clipId: region.id,
      transposeSemitones: edit.transposeSemitones,
      fineTuneCents: edit.fineTuneCents,
      sampleRate: runtime.audioBuffer.sampleRate,
      sourceBitDepth: getAudioSourceBitDepth(region),
      quality: 'high',
      trimStartSeconds: getAudioTrimStartSeconds(region),
      trimEndSeconds: getAudioTrimEndSeconds(region),
      onProgress: (progress) => {
        audioPitchRenderState = { ...audioPitchRenderState, progress }
      }
    })
    const waveform = buildAudioWaveformFromBuffer(result.renderedAudioBuffer, { maxPeaks: 1200 })
    const renderedRuntimeId = `${region.id}:pitch-shift:${Math.round((result.totalSemitones ?? pitchShift.totalSemitones) * 100)}:${result.createdAt}`
    let renderedStoragePath = null
    try {
      renderedStoragePath = await uploadSouraAudioBlob(result.renderedBlob, {
        clipId: region.id,
        suffix: `pitch-shift-${Math.round((result.totalSemitones ?? pitchShift.totalSemitones) * 100)}`
      })
    } catch (uploadErr) {
      console.warn('[studioProject] rendered pitch shift upload failed; using session render only', uploadErr)
    }
    audioClipRuntime.set(renderedRuntimeId, {
      blob: result.renderedBlob,
      url: result.renderedObjectUrl,
      audioBuffer: result.renderedAudioBuffer,
      contentType: result.renderedBlob?.type || 'audio/wav',
      fileDurationSeconds: result.renderedDurationSeconds,
      waveform,
      sourceRuntimeId: region.audioClip?.runtimeId || region.id,
      sessionOnly: !renderedStoragePath
    })
    edit = normalizeAudioEdit(region.audioEdit)
    region.renderedWaveform = waveform
    region.audioEdit = normalizeAudioEdit({
      ...edit,
      pitchShift: {
        ...edit.pitchShift,
        enabled: true,
        totalSemitones: result.totalSemitones ?? pitchShift.totalSemitones,
        renderStatus: 'ready',
        renderedStoragePath,
        renderedAudioUrl: null,
        renderedRuntimeId,
        renderedDurationSeconds: result.renderedDurationSeconds,
        algorithm: result.algorithm,
        renderedAudio: result.renderedAudio,
        preservesDuration: result.preservesDuration,
        lastError: null,
        renderedAt: result.createdAt
      }
    })
    audioEditPlaybackPrompt = null
    audioEditPlaybackBypassRegionIds.delete(region.id)
    recordingStatus = 'Pitch shift rendered.'
    scheduleEditorSave()
  } catch (err) {
    console.error('[pitch-render] pitch shift failed', { clipId: region.id, reason: err?.message || 'Pitch shift render failed.' })
    edit = normalizeAudioEdit(region.audioEdit)
    region.audioEdit = normalizeAudioEdit({ ...edit, pitchShift: { ...edit.pitchShift, renderStatus: 'failed', lastError: err?.message || 'Pitch shift render failed.' } })
    recordingStatus = 'Pitch shift render failed. The original audio was not changed.'
    scheduleEditorSave()
  } finally {
    audioPitchRenderState = { active: false, regionId: '', mode: '', progress: null, error: '' }
    renderEditor()
  }
}
async function renderPitchTraceEditsForRegion(regionId) {
  if (audioPitchRenderState.active) return
  const region = midiRegions.find((item)=>item.id === regionId && item.type === 'audio')
  if (!region) return
  let edit = normalizeAudioEdit(region.audioEdit)
  const trace = edit.pitchTrace
  if (!trace.enabled || !trace.notes.length) return
  let runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  if (!runtime?.audioBuffer && (region.audioClip?.storagePath || region.audioClip?.downloadUrl)) {
    await hydrateAudioRegionRuntime(region)
    runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  }
  if (!runtime?.audioBuffer) {
    region.audioEdit = normalizeAudioEdit({ ...edit, pitchTrace: { ...trace, renderStatus: 'failed', lastError: 'Original audio is offline. Reconnect or re-record before rendering Pitch Trace edits.' } })
    recordingStatus = region.audioEdit.pitchTrace.lastError
    scheduleEditorSave()
    renderEditor()
    return
  }
  stopPlayback()
  audioPitchRenderState = { active: true, regionId, mode: 'trace', progress: null, error: '' }
  region.audioEdit = normalizeAudioEdit({ ...edit, pitchTrace: { ...trace, renderStatus: 'rendering', lastError: null } })
  renderEditor()
  try {
    const result = await renderAudioDsp(SOURA_AUDIO_DSP_OPERATIONS.pitchTrace, {
      audioBuffer: runtime.audioBuffer,
      clipId: region.id,
      notes: trace.notes,
      transposeSemitones: edit.transposeSemitones,
      fineTuneCents: edit.fineTuneCents,
      sampleRate: runtime.audioBuffer.sampleRate,
      sourceBitDepth: getAudioSourceBitDepth(region),
      quality: 'high',
      trimStartSeconds: getAudioTrimStartSeconds(region),
      trimEndSeconds: getAudioTrimEndSeconds(region),
      onProgress: (progress) => {
        audioPitchRenderState = { ...audioPitchRenderState, progress }
      }
    })
    const waveform = buildAudioWaveformFromBuffer(result.renderedAudioBuffer, { maxPeaks: 1200 })
    const renderedRuntimeId = `${region.id}:pitch-trace:${result.createdAt}`
    let renderedStoragePath = null
    try {
      renderedStoragePath = await uploadSouraAudioBlob(result.renderedBlob, {
        clipId: region.id,
        suffix: `pitch-trace-${result.createdAt}`
      })
    } catch (uploadErr) {
      console.warn('[studioProject] rendered pitch trace upload failed; using session render only', uploadErr)
    }
    audioClipRuntime.set(renderedRuntimeId, {
      blob: result.renderedBlob,
      url: result.renderedObjectUrl,
      audioBuffer: result.renderedAudioBuffer,
      contentType: result.renderedBlob?.type || 'audio/wav',
      fileDurationSeconds: result.renderedDurationSeconds,
      waveform,
      sourceRuntimeId: region.audioClip?.runtimeId || region.id,
      sessionOnly: !renderedStoragePath
    })
    edit = normalizeAudioEdit(region.audioEdit)
    region.renderedWaveform = waveform
    region.audioEdit = normalizeAudioEdit({
      ...edit,
      pitchTrace: {
        ...edit.pitchTrace,
        renderStatus: 'ready',
        renderedStoragePath,
        renderedAudioUrl: null,
        renderedRuntimeId,
        renderedDurationSeconds: result.renderedDurationSeconds,
        renderAlgorithm: result.algorithm,
        renderedAudio: result.renderedAudio,
        preservesDuration: result.preservesDuration,
        lastError: null,
        renderedAt: result.createdAt,
        notes: edit.pitchTrace.notes.map((note)=>({ ...note, renderStatus: 'ready' }))
      }
    })
    audioEditPlaybackPrompt = null
    audioEditPlaybackBypassRegionIds.delete(region.id)
    recordingStatus = 'Pitch Trace edits rendered.'
    scheduleEditorSave()
  } catch (err) {
    console.error('[pitch-render] pitch trace failed', { clipId: region.id, reason: err?.message || 'Pitch Trace render failed.' })
    edit = normalizeAudioEdit(region.audioEdit)
    region.audioEdit = normalizeAudioEdit({ ...edit, pitchTrace: { ...edit.pitchTrace, renderStatus: 'failed', lastError: err?.message || 'Pitch Trace render failed.' } })
    recordingStatus = 'Pitch Trace render failed. The original audio was not changed.'
    scheduleEditorSave()
  } finally {
    audioPitchRenderState = { active: false, regionId: '', mode: '', progress: null, error: '' }
    renderEditor()
  }
}
async function renderAudioReverseForRegion(regionId) {
  if (audioPitchRenderState.active) return
  const region = midiRegions.find((item)=>item.id === regionId && item.type === 'audio')
  if (!region) return
  let edit = normalizeAudioEdit(region.audioEdit)
  if (!edit.reverse.enabled) {
    scheduleEditorSave()
    return
  }
  let runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  if (!runtime?.audioBuffer && (region.audioClip?.storagePath || region.audioClip?.downloadUrl)) {
    await hydrateAudioRegionRuntime(region)
    runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  }
  if (!runtime?.audioBuffer) {
    region.audioEdit = normalizeAudioEdit({ ...edit, reverse: { ...edit.reverse, renderStatus: 'failed', lastError: 'Original audio is offline. Reconnect or re-record before rendering reverse.' } })
    recordingStatus = region.audioEdit.reverse.lastError
    scheduleEditorSave()
    renderEditor()
    return
  }
  stopPlayback()
  audioPitchRenderState = { active: true, regionId, mode: 'reverse', progress: null, error: '' }
  region.audioEdit = normalizeAudioEdit({ ...edit, reverse: { ...edit.reverse, renderStatus: 'rendering', lastError: null } })
  renderEditor()
  try {
    const result = await renderReversedAudio({
      audioBuffer: runtime.audioBuffer,
      clipId: region.id,
      trimStartSeconds: getAudioTrimStartSeconds(region),
      trimEndSeconds: getAudioTrimEndSeconds(region),
      sourceBitDepth: getAudioSourceBitDepth(region),
      quality: 'lossless',
      onProgress: (progress) => {
        audioPitchRenderState = { ...audioPitchRenderState, progress }
      }
    })
    const waveform = buildAudioWaveformFromBuffer(result.renderedAudioBuffer, { maxPeaks: 1200 })
    const renderedRuntimeId = `${region.id}:reverse:${result.createdAt}`
    let renderedStoragePath = null
    try {
      renderedStoragePath = await uploadSouraAudioBlob(result.renderedBlob, {
        clipId: region.id,
        suffix: `reverse-${result.createdAt}`
      })
    } catch (uploadErr) {
      console.warn('[studioProject] rendered reverse upload failed; using session render only', uploadErr)
    }
    audioClipRuntime.set(renderedRuntimeId, {
      blob: result.renderedBlob,
      url: result.renderedObjectUrl,
      audioBuffer: result.renderedAudioBuffer,
      contentType: result.renderedBlob?.type || 'audio/wav',
      fileDurationSeconds: result.renderedDurationSeconds,
      waveform,
      sourceRuntimeId: region.audioClip?.runtimeId || region.id,
      sessionOnly: !renderedStoragePath
    })
    edit = normalizeAudioEdit(region.audioEdit)
    region.renderedWaveform = waveform
    region.audioEdit = normalizeAudioEdit({
      ...edit,
      reverse: {
        ...edit.reverse,
        enabled: true,
        renderStatus: 'ready',
        renderedStoragePath,
        renderedAudioUrl: null,
        renderedRuntimeId,
        renderedDurationSeconds: result.renderedDurationSeconds,
        algorithm: result.algorithm,
        renderedAudio: result.renderedAudio,
        lastError: null,
        renderedAt: result.createdAt
      }
    })
    recordingStatus = 'Reverse rendered.'
    scheduleEditorSave()
  } catch (err) {
    console.error('[reverse-render] failed', { clipId: region.id, reason: err?.message || 'Reverse render failed.' })
    edit = normalizeAudioEdit(region.audioEdit)
    region.audioEdit = normalizeAudioEdit({ ...edit, reverse: { ...edit.reverse, renderStatus: 'failed', lastError: err?.message || 'Reverse render failed.' } })
    recordingStatus = 'Reverse render failed. The original audio was not changed.'
    scheduleEditorSave()
  } finally {
    audioPitchRenderState = { active: false, regionId: '', mode: '', progress: null, error: '' }
    renderEditor()
  }
}
function startStretchedAudioElement(region, runtime, track, sourceOffsetSeconds, remainingVisibleSeconds) {
  if (!runtime?.url) return false
  try {
    const ctx = getAudioContext()
    const element = new Audio(runtime.url)
    element.currentTime = Math.max(0, sourceOffsetSeconds)
    element.playbackRate = getAudioRegionPlaybackRate(region)
    element.preservesPitch = true
    element.mozPreservesPitch = true
    element.webkitPreservesPitch = true
    element.volume = 1
    const mediaSource = ctx.createMediaElementSource(element)
    mediaSource.connect(getTrackAudioChannel(track?.id || region.trackId).input)
    const stopTimer = window.setTimeout(() => stopAudioClipPlayback(region.id), Math.max(10, remainingVisibleSeconds * 1000 + 40))
    element.addEventListener('ended', () => stopAudioClipPlayback(region.id), { once: true })
    element.play().catch((err) => {
      console.warn('[studioProject] stretched audio element playback failed', err)
      stopAudioClipPlayback(region.id)
    })
    activeAudioClipSources.set(region.id, { element, mediaSource, trackId: track?.id || region.trackId, stopTimer })
    startTrackMeterLoop()
    return true
  } catch (err) {
    console.warn('[studioProject] stretched audio setup failed', err)
    return false
  }
}
function getAudioPlaybackRenderChoice(region, edit, stretch) {
  const bypassEdits = audioEditPlaybackBypassRegionIds.has(region.id)
  const trace = edit.pitchTrace || {}
  const pitchShift = edit.pitchShift || {}
  const reverse = edit.reverse || {}
  const traceHasEdits = trace.enabled && trace.notes?.length && (getPitchTraceEditedNoteCount(trace) > 0 || Math.abs(Number(pitchShift.totalSemitones) || 0) > 0.001)
  const pitchShiftActive = Math.abs(Number(pitchShift.totalSemitones) || 0) > 0.001
  if (!bypassEdits) {
    if (traceHasEdits) {
      if (trace.renderStatus === 'ready' && trace.renderedRuntimeId && audioClipRuntime.has(trace.renderedRuntimeId)) {
        return { runtimeId: trace.renderedRuntimeId, mode: 'pitchTrace' }
      }
      return { needsRender: true, promptMode: 'trace', message: 'Pitch Trace edits must be rendered before playback.' }
    }
    if (pitchShiftActive) {
      if (pitchShift.renderStatus === 'ready' && pitchShift.renderedRuntimeId && audioClipRuntime.has(pitchShift.renderedRuntimeId)) {
        return { runtimeId: pitchShift.renderedRuntimeId, mode: 'pitchShift' }
      }
      return { needsRender: true, promptMode: 'pitchShift', message: 'Pitch Shift must be rendered before playback.' }
    }
  }
  if (!bypassEdits && stretch.enabled && stretch.renderStatus === 'ready') {
    const runtimeId = stretch.renderedRuntimeId || `${region.id}:stretch:persisted`
    if (runtimeId && audioClipRuntime.has(runtimeId)) return { runtimeId, mode: 'stretch' }
    if (stretch.renderedStoragePath || stretch.renderedAudioUrl) return { needsStretchRender: true, message: 'Rendered stretch audio is not loaded yet.' }
    return { needsStretchRender: true, message: 'Stretch render is missing its audio buffer.' }
  }
  if (!bypassEdits && stretch.enabled && stretch.renderStatus !== 'ready') {
    return { needsStretchRender: true, message: 'This stretched audio region must finish rendering before playback.' }
  }
  if (!bypassEdits && reverse.enabled) {
    if (reverse.renderStatus === 'ready' && reverse.renderedRuntimeId && audioClipRuntime.has(reverse.renderedRuntimeId)) {
      return { runtimeId: reverse.renderedRuntimeId, mode: 'reverse' }
    }
    return { needsRender: true, promptMode: 'reverse', message: 'Reverse must be rendered before playback.' }
  }
  return { runtimeId: region.audioClip?.runtimeId || region.id, mode: 'original' }
}
function updateAudioClipPlayback(currentBeat = getTransportClockProjectBeat()) {
  const beat = clampBeat(currentBeat)
  const ctx = getAudioContext()
  const currentProjectSeconds = getTransportClockProjectSeconds()
  const lookaheadEndSeconds = currentProjectSeconds + TRANSPORT_SCHEDULE_LOOKAHEAD_SECONDS
  midiRegions.filter((region)=>region.type === 'audio').forEach((region) => {
    syncAudioRegionTimeline(region)
    const startBeat = Number(region.startBeat) || 0
    const endBeat = Number(region.endBeat) || (startBeat + secondsToBeats(getAudioRegionVisibleDurationSeconds(region)))
    const track = tracks.find((item)=>item.id === region.trackId)
    const stretch = normalizeAudioStretch(region.stretch, {
      clipId: region.id,
      sourceDurationSeconds: getAudioSourceDurationSeconds(region),
      visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
    })
    const edit = normalizeAudioEdit(region.audioEdit)
    const active = activeAudioClipSources.get(region.id)
    if (edit.mute || region.muted) {
      if (active) stopAudioClipPlayback(region.id)
      return
    }
    const clipStartSeconds = Number.isFinite(Number(region.timelineStartSeconds)) ? Number(region.timelineStartSeconds) : beatsToSecondsAtBpm(startBeat, transportClock?.bpm || Number(projectState?.bpm || 140))
    const visibleDurationSeconds = getAudioRegionVisibleDurationSeconds(region)
    const clipEndSeconds = clipStartSeconds + visibleDurationSeconds
    if (active) {
      if (!isTrackOutputAudible(track) || currentProjectSeconds >= clipEndSeconds + 0.05 || lookaheadEndSeconds < clipStartSeconds) stopAudioClipPlayback(region.id)
      else return
    }
    const playbackChoice = getAudioPlaybackRenderChoice(region, edit, stretch)
    if (playbackChoice.needsRender) {
      if (isTrackOutputAudible(track) && lookaheadEndSeconds >= clipStartSeconds && currentProjectSeconds < clipEndSeconds) {
        recordingStatus = playbackChoice.message
        updateEditorTitleStatus()
        if (!audioPitchRenderState.active && audioEditPlaybackPrompt?.regionId !== region.id) {
          audioEditPlaybackPrompt = { regionId: region.id, mode: playbackChoice.promptMode }
          renderEditor()
        }
      }
      return
    }
    if (playbackChoice.needsStretchRender) {
      if (isTrackOutputAudible(track) && lookaheadEndSeconds >= clipStartSeconds && currentProjectSeconds < clipEndSeconds) {
        recordingStatus = playbackChoice.message || 'This stretched audio region must finish rendering before playback.'
        updateEditorTitleStatus()
        if (!audioStretchRenderState.active && stretch.renderStatus !== 'rendering' && stretchPlaybackPrompt?.regionId !== region.id) {
          stretchPlaybackPrompt = { regionId: region.id }
          renderEditor()
        }
      }
      return
    }
    const runtime = audioClipRuntime.get(playbackChoice.runtimeId)
    const shouldPlay = runtime?.audioBuffer && isTrackOutputAudible(track) && lookaheadEndSeconds >= clipStartSeconds && currentProjectSeconds < clipEndSeconds
    if (!shouldPlay) {
      if (!runtime?.audioBuffer && isTrackOutputAudible(track) && lookaheadEndSeconds >= clipStartSeconds && currentProjectSeconds < clipEndSeconds) {
        recordingStatus = 'Audio file missing or not loaded.'
        updateEditorTitleStatus()
        if (!audioOfflineWarnedRegionIds.has(region.id)) {
          audioOfflineWarnedRegionIds.add(region.id)
          console.info('[audio-playback] skipped offline clip', { clipId: region.audioClip?.audioAssetId || region.audioClip?.id || region.id, reason: region.audioClip?.offlineReason || 'buffer_missing' })
        }
      }
      return
    }
    try {
      const rawScheduleTime = getTransportScheduleTimeForProjectSeconds(clipStartSeconds)
      const transportStartTime = transportClock?.audioContextStartTime || ctx.currentTime
      const scheduleTime = Math.max(ctx.currentTime, transportStartTime, rawScheduleTime)
      const projectSecondsAtSchedule = transportClock
        ? transportClock.playheadStartSeconds + Math.max(0, scheduleTime - transportClock.audioContextStartTime)
        : currentProjectSeconds
      const elapsedVisibleSeconds = Math.max(0, projectSecondsAtSchedule - clipStartSeconds)
      if (elapsedVisibleSeconds >= visibleDurationSeconds) return
      const renderedMode = playbackChoice.mode === 'pitchTrace' || playbackChoice.mode === 'pitchShift' || playbackChoice.mode === 'stretch' || playbackChoice.mode === 'reverse'
      if (playbackChoice.mode === 'stretch') {
        logStretchDebug('playback source', region.id, {
          sourceDurationSeconds: stretch.sourceDurationSeconds,
          targetDurationSeconds: stretch.targetDurationSeconds,
          speedPercent: stretch.speedPercent,
          lengthRatio: stretch.lengthRatio,
          renderStatus: stretch.renderStatus,
          reason: playbackChoice.runtimeId
        })
      }
      const playbackRate = renderedMode ? 1 : getAudioRegionPlaybackRate(region)
      const sourceOffsetSeconds = renderedMode ? elapsedVisibleSeconds : getAudioTrimStartSeconds(region) + (elapsedVisibleSeconds * playbackRate)
      const trimEndSeconds = renderedMode ? runtime.audioBuffer.duration : getAudioTrimEndSeconds(region)
      const remainingVisibleSeconds = Math.max(0.01, visibleDurationSeconds - elapsedVisibleSeconds)
      const source = ctx.createBufferSource()
      source.buffer = runtime.audioBuffer
      source.playbackRate.value = playbackRate
      if (edit.loop && renderedMode) {
        source.loop = true
        source.loopStart = 0
        source.loopEnd = runtime.audioBuffer.duration
      } else if (edit.loop) {
        source.loop = true
        source.loopStart = getAudioTrimStartSeconds(region)
        source.loopEnd = getAudioTrimEndSeconds(region)
      }
      const channel = getTrackAudioChannel(track?.id || region.trackId)
      const gainNode = ctx.createGain()
      const baseGain = dbToGain(edit.gainDb)
      gainNode.gain.setValueAtTime(baseGain, scheduleTime)
      const offsetSeconds = Math.min(runtime.audioBuffer.duration - 0.01, sourceOffsetSeconds)
      const remainingBufferSeconds = Math.max(0.01, trimEndSeconds - offsetSeconds)
      const playDuration = Math.max(0.01, Math.min(remainingBufferSeconds, remainingVisibleSeconds * playbackRate))
      let fadeIn = Math.min(Math.max(0, edit.fadeInSeconds), playDuration)
      let fadeOut = Math.min(Math.max(0, edit.fadeOutSeconds), playDuration)
      if (fadeIn + fadeOut > playDuration) {
        const scale = playDuration / Math.max(0.01, fadeIn + fadeOut)
        fadeIn *= scale
        fadeOut *= scale
      }
      if (fadeIn > 0 && elapsedVisibleSeconds < fadeIn) {
        const fadeProgress = clamp(elapsedVisibleSeconds / fadeIn, 0, 1)
        gainNode.gain.setValueAtTime(Math.max(0.0001, baseGain * fadeGainValue(fadeProgress, edit.fadeInCurve, 'in')), scheduleTime)
        gainNode.gain.setValueCurveAtTime(makeFadeGainCurve({
          baseGain,
          fromProgress: fadeProgress,
          toProgress: 1,
          curve: edit.fadeInCurve,
          direction: 'in'
        }), scheduleTime, Math.max(0.01, fadeIn * (1 - fadeProgress)))
      }
      if (fadeOut > 0 && remainingVisibleSeconds <= fadeOut) {
        const fadeProgress = clamp((fadeOut - remainingVisibleSeconds) / fadeOut, 0, 1)
        gainNode.gain.setValueCurveAtTime(makeFadeGainCurve({
          baseGain,
          fromProgress: fadeProgress,
          toProgress: 1,
          curve: edit.fadeOutCurve,
          direction: 'out'
        }), scheduleTime, Math.max(0.01, remainingVisibleSeconds))
      } else if (fadeOut > 0 && playDuration > fadeOut) {
        gainNode.gain.setValueAtTime(baseGain, scheduleTime + Math.max(0.01, playDuration - fadeOut))
        gainNode.gain.setValueCurveAtTime(makeFadeGainCurve({
          baseGain,
          fromProgress: 0,
          toProgress: 1,
          curve: edit.fadeOutCurve,
          direction: 'out'
        }), scheduleTime + Math.max(0.01, playDuration - fadeOut), Math.max(0.01, fadeOut))
      }
      source.connect(gainNode)
      gainNode.connect(channel.input)
      source.onended = () => activeAudioClipSources.delete(region.id)
      const startTime = scheduleTime + Math.max(0, edit.delayMs / 1000)
      source.start(startTime, Math.max(0, offsetSeconds), playDuration)
      activeAudioClipSources.set(region.id, { source, gainNode, trackId: track?.id || region.trackId, scheduleTime: startTime, clipStartSeconds, clipEndSeconds })
      if (!transportDebugState.firstAudioScheduled) {
        transportDebugState.firstAudioScheduled = true
        console.info('[audio-schedule]', {
          clipId: region.audioClip?.audioAssetId || region.audioClip?.id || region.id,
          clipTimelineStartSeconds: clipStartSeconds,
          playheadStartSeconds: transportClock?.playheadStartSeconds ?? currentProjectSeconds,
          scheduleTime: startTime,
          deltaToStartMs: Math.round((startTime - ctx.currentTime) * 1000),
          bufferOffset: offsetSeconds,
          mode: playbackChoice.mode
        })
      }
      startTrackMeterLoop()
    } catch (err) {
      console.warn('[studioProject] audio clip playback failed', err)
      stopAudioClipPlayback(region.id)
    }
  })
}
function updateMidiRegionPlayback(currentBeat = getTransportClockProjectBeat()) {
  const beat = clampBeat(currentBeat)
  const ctx = getAudioContext()
  const bpm = transportClock?.bpm || Number(projectState?.bpm || 140)
  const currentProjectSeconds = getTransportClockProjectSeconds()
  const lookaheadEndSeconds = currentProjectSeconds + TRANSPORT_SCHEDULE_LOOKAHEAD_SECONDS
  activePlaybackNotes.forEach((active, key) => {
    const region = midiRegions.find((item)=>item.id === active.regionId)
    const track = tracks.find((item)=>item.id === active.trackId)
    const activeEndSeconds = beatsToSecondsAtBpm(active.endBeat, bpm)
    if (!region || region.muted || !isTrackAudible(track) || currentProjectSeconds >= activeEndSeconds + 0.05) {
      stopPlaybackNote(key)
    }
  })
  midiRegions.forEach((region) => {
    if (region.type === 'audio') return
    if (region.muted) return
    const track = tracks.find((item)=>item.id === region.trackId)
    if (!isTrackAudible(track)) return
    ensureTrackInstrumentInstance(track)
    ;(region.notes || []).forEach((note, index) => {
      if (!noteIsVisibleInRegion(region, note)) return
      const startBeat = Number(note.startBeat) || 0
      const endBeat = startBeat + Math.max(0.05, Number(note.durationBeats) || 0.05)
      const key = `${region.id}:${index}:${note.note}`
      const noteStartSeconds = beatsToSecondsAtBpm(startBeat, bpm)
      const noteEndSeconds = beatsToSecondsAtBpm(endBeat, bpm)
      if (lookaheadEndSeconds >= noteStartSeconds && currentProjectSeconds < noteEndSeconds && !activePlaybackNotes.has(key)) {
        const scheduleTime = Math.max(ctx.currentTime, getTransportScheduleTimeForProjectSeconds(Math.max(noteStartSeconds, currentProjectSeconds)))
        const stopTime = Math.max(scheduleTime + 0.01, getTransportScheduleTimeForProjectSeconds(noteEndSeconds))
        dawInstrumentRegistry.noteOn(track.instrument.pluginInstanceId, note.note, clamp((Number(note.velocity) || 0.85), 0, 1), { startTime: scheduleTime, stopTime })
        activePlaybackNotes.set(key, { regionId: region.id, trackId: track.id, note: note.note, startBeat, endBeat, scheduleTime, stopTime })
        setTrackKeyboardNoteActive(track.id, note.note, `playback:${key}`, true)
        if (!transportDebugState.firstMidiScheduled) {
          transportDebugState.firstMidiScheduled = true
          console.info('[midi-schedule]', {
            noteId: note.id || key,
            noteStartSeconds,
            playheadStartSeconds: transportClock?.playheadStartSeconds ?? currentProjectSeconds,
            scheduleTime,
            deltaToStartMs: Math.round((scheduleTime - ctx.currentTime) * 1000)
          })
        }
        startTrackMeterLoop()
      }
    })
  })
}
function refreshMidiRegionDom() {
  const scroll = midiRegionDrag?.scroll || captureArrangementScroll()
  const gridInner = app.querySelector('[data-arrangement-grid-inner]')
  if (!gridInner) return
  const playhead = gridInner.querySelector('.studio-grid-playhead')
  gridInner.querySelectorAll('[data-midi-region]').forEach((node)=>node.remove())
  playhead?.insertAdjacentHTML('beforebegin', renderTimelineRegions())
  bindMidiRegionEvents()
  if (!timelineEdgeScrollState?.direction) restoreArrangementScroll(scroll)
}
function bindMidiRegionEvents() {
  app.querySelectorAll('[data-midi-region]').forEach((region)=>{
    region.addEventListener('pointerdown',(event)=>{
      const regionId = region.dataset.midiRegion
      if (event.button !== 0) return
      if (event.shiftKey) {
        event.preventDefault()
        event.stopPropagation()
        toggleRegionSelection(regionId)
        refreshMidiRegionDom()
        return
      }
      if (!regionIsSelected(regionId)) selectSingleRegion(regionId)
      if (handleRegionToolPointer(event, regionId)) return
      startMidiRegionDrag(event, regionId)
    })
    region.addEventListener('contextmenu',(event)=>{
      event.preventDefault()
      event.stopPropagation()
      if (!regionIsSelected(region.dataset.midiRegion)) selectSingleRegion(region.dataset.midiRegion)
      const pos = getClampedFloatingPosition(event.clientX, event.clientY, 220, 230)
      midiRegionMenuState = { regionId: region.dataset.midiRegion, x: pos.x, y: pos.y, pasteBeat: pointerEventToTimelineBeat(event), trackId: tracks[getTrackLaneFromY(event.clientY)]?.id || selectedTrackId }
      renderEditor()
    })
  })
}
function getRecordingTrack() {
  const selected = getSelectedTrack()
  if (selected?.recordArmed || selected?.instrument || isAudioTrack(selected)) return selected
  return tracks.find((track)=>track.recordArmed) || selected
}
function startRecordFlow() {
  if (audioStretchRenderState.active) return
  const track = getRecordingTrack()
  if (isAudioTrack(track)) startAudioRecordFlow(track)
  else startMidiRecordFlow(track)
}
async function requestAudioInputStream() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: true })
  } catch (err) {
    console.error('[studioProject] audio input permission failed', err)
    if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') recordingStatus = 'No audio input device was found.'
    else if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') recordingStatus = 'Microphone access is required to record audio.'
    else recordingStatus = 'Could not start audio recording.'
    return null
  }
}
function startMidiRecordFlow(track = getRecordingTrack()) {
  if (!track) { recordingStatus = 'Select or arm an instrument track to record MIDI.'; renderEditor(); return }
  if (isAudioTrack(track)) { startAudioRecordFlow(track); return }
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
  activeRecording = { id: makeInsertId('midi-region'), type: 'midi', trackId: track.id, name: track?.autoNameRegions === false ? '' : track.name, startBeat: recordStartBeat, endBeat: recordStartBeat, color: '#ff2d55', notes: [] }
  activeRecordingNotes.clear()
  recordingStatus = `Recording ${track.name}`
  if (!isPlaying) startPlayback()
  renderEditor()
}
async function startAudioRecordFlow(track = getRecordingTrack()) {
  if (!track || !isAudioTrack(track)) { recordingStatus = 'Select or arm an audio track to record audio.'; activeLeftPanel = 'inspector'; renderEditor(); return }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { recordingStatus = 'Audio recording is not supported in this browser.'; renderEditor(); return }
  const stream = await requestAudioInputStream()
  if (!stream) { renderEditor(); return }
  pendingAudioInputStream = stream
  stopPlayback()
  if (countInTimer) clearInterval(countInTimer)
  countInTimer = 0
  if (!isCountInEnabled) { beginAudioRecording(track, { stream }); return }
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
async function beginAudioRecording(track, { startBeat = null } = {}) {
  if (!track || activeRecording) return
  try {
    const stream = arguments[1]?.stream || pendingAudioInputStream || await requestAudioInputStream()
    pendingAudioInputStream = null
    if (!stream) { renderEditor(); return }
    const ctx = getAudioContext()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.62
    const source = ctx.createMediaStreamSource(stream)
    source.connect(analyser)
    if (track.monitor) source.connect(getTrackAudioChannel(track.id).input)
    const chunks = []
    const mediaRecorder = new MediaRecorder(stream)
    const recordStartBeat = Number.isFinite(Number(startBeat)) ? Number(startBeat) : clampBeat(xToBeat(timelineState.playheadX))
    const recordStartSeconds = getTimelineSecondsAtBeat(recordStartBeat)
    const audioContextStartTime = ctx.currentTime
    const performanceStartTime = performance.now()
    activeRecording = {
      id: makeInsertId('audio-region'),
      clipId: '',
      type: 'audio',
      trackId: track.id,
      name: track?.autoNameRegions === false ? '' : `${track.name} Take`,
      startBeat: recordStartBeat,
      endBeat: recordStartBeat,
      recordingStartPixelX: beatsFromBarZeroToX(recordStartBeat),
      timelineStartBeats: recordStartBeat,
      timelineStartSeconds: recordStartSeconds,
      transportBpm: Number(projectState?.bpm || 140),
      projectSampleRate: Number(projectState?.sampleRate || ctx.sampleRate || 44100),
      audioContextSampleRate: ctx.sampleRate,
      recordingStartedAtAudioContextTime: audioContextStartTime,
      recordingStartedAtPerformanceTime: performanceStartTime,
      mediaRecorderStartedAt: performanceStartTime,
      sourceLatencyCompensationSeconds: 0,
      durationBeats: 0,
      durationSeconds: 0,
      fileDurationSeconds: 0,
      offsetSeconds: 0,
      trimStartSeconds: 0,
      trimEndSeconds: null,
      visibleDurationSeconds: 0,
      playbackRate: 1,
      audioEdit: normalizeAudioEdit(),
      stretch: { enabled: false, ratio: 1, mode: 'none', algorithm: 'none', preservesPitch: false, renderedAudioUrl: null, renderedStoragePath: null },
      color: '#ff2d55',
      waveform: { peaks: [], chunks: [], sampleWindowSeconds: waveformWindowSeconds, sampleWindowMs: waveformWindowSeconds * 1000, renderStyle: 'low-poly', durationSeconds: 0, resolution: 'live' },
      audioClip: { runtimeId: '', contentType: mediaRecorder.mimeType || 'audio/webm', sessionOnly: true, missingAfterReload: true }
    }
    activeRecording.clipId = activeRecording.id
    activeRecording.audioClip.runtimeId = activeRecording.id
    mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data?.size) chunks.push(event.data)
    })
    const data = new Uint8Array(analyser.fftSize)
    const samplePeak = () => {
      if (!activeRecording || activeRecording.type !== 'audio') return
      analyser.getByteTimeDomainData(data)
      let min = 1
      let max = -1
      let sum = 0
      for (let i = 0; i < data.length; i += 1) {
        const sample = (data[i] - 128) / 128
        if (sample < min) min = sample
        if (sample > max) max = sample
        sum += sample * sample
      }
      const rms = Math.sqrt(sum / Math.max(1, data.length))
      const startedAt = audioRecordingController?.startedAt || performance.now()
      const elapsed = Math.max(0, (performance.now() - startedAt) / 1000)
      activeRecording.durationSeconds = elapsed
      activeRecording.durationBeats = secondsToBeats(elapsed)
      activeRecording.visibleDurationSeconds = elapsed
      activeRecording.fileDurationSeconds = elapsed
      activeRecording.trimEndSeconds = elapsed
      activeRecording.endBeat = activeRecording.startBeat + Math.max(0.05, activeRecording.durationBeats)
      activeRecording.waveform.durationSeconds = elapsed
      const t1Seconds = elapsed
      const t0Seconds = Math.max(0, t1Seconds - waveformWindowSeconds)
      activeRecording.waveform.chunks.push({ t0Seconds, t1Seconds, min: Number(clamp(min, -1, 1).toFixed(3)), max: Number(clamp(max, -1, 1).toFixed(3)), rms: Number(clamp(rms * 1.8, 0, 1).toFixed(3)) })
      activeRecording.waveform.peaks.push({ min: Number(clamp(min, -1, 1).toFixed(3)), max: Number(clamp(max, -1, 1).toFixed(3)), rms: Number(clamp(rms * 1.8, 0, 1).toFixed(3)) })
      if (activeRecording.waveform.chunks.length > 2400) activeRecording.waveform.chunks.shift()
      if (activeRecording.waveform.peaks.length > 2400) activeRecording.waveform.peaks.shift()
      refreshMidiRegionDom()
    }
    audioRecordingController = { mediaRecorder, stream, analyser, source, chunks, sampleTimer: 0, startedAt: performanceStartTime, trackId: track.id }
    mediaRecorder.start(250)
    activeRecording.mediaRecorderStartedAt = performance.now()
    audioRecordingController.sampleTimer = window.setInterval(samplePeak, 120)
    recordingStatus = `Recording ${track.name}`
    if (!isPlaying) startPlayback()
    renderEditor()
  } catch (err) {
    console.error('[studioProject] audio recording failed', err)
    recordingStatus = err?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : 'Could not start audio recording.'
    cleanupAudioRecordingController()
    activeRecording = null
    renderEditor()
  }
}
async function createAudioRegionFromFile({
  file,
  trackId = selectedTrackId,
  timelineStartBeats = clampBeat(xToBeat(timelineState.playheadX)),
  source = 'import'
} = {}) {
  const track = tracks.find((item)=>item.id === trackId)
  if (!track || !isAudioTrack(track)) {
    recordingStatus = 'Select an audio track to import audio, or create a new audio track.'
    renderEditor()
    return null
  }
  if (!isSupportedAudioFile(file)) {
    recordingStatus = 'Unsupported audio file.'
    renderEditor()
    return null
  }
  const before = captureDawSnapshot()
  recordingStatus = 'Importing audio...'
  renderEditor()
  const clipId = makeInsertId('audio-region')
  try {
    const metadata = await decodeAudioFileForImport(file)
    const fileDurationSeconds = metadata.fileDurationSeconds
    const durationBeats = Math.max(0.25, secondsToBeats(fileDurationSeconds))
    const now = Date.now()
    let storagePath = null
    try {
      storagePath = await uploadSouraAudioBlob(file, { clipId, suffix: source === 'import' ? 'import' : '' })
    } catch (error) {
      console.warn('[studioProject] audio import upload failed', { message: error?.message })
      recordingStatus = 'Audio upload failed. Try again.'
      renderEditor()
      return null
    }
    const region = cloneRegionForState({
      id: clipId,
      clipId,
      type: 'audio',
      source,
      trackId: track.id,
      name: track.autoNameRegions === false ? '' : getAudioImportRegionLabel(metadata.fileName),
      startBeat: timelineStartBeats,
      endBeat: timelineStartBeats + durationBeats,
      timelineStartBeats,
      timelineStartSeconds: getTimelineSecondsAtBeat(timelineStartBeats),
      transportBpm: Number(projectState?.bpm || 140),
      projectSampleRate: Number(projectState?.sampleRate || metadata.sampleRate || 44100),
      audioContextSampleRate: metadata.sampleRate || getAudioContext().sampleRate,
      sourceLatencyCompensationSeconds: 0,
      durationBeats,
      durationSeconds: fileDurationSeconds,
      fileDurationSeconds,
      offsetSeconds: 0,
      trimStartSeconds: 0,
      trimEndSeconds: fileDurationSeconds,
      visibleDurationSeconds: fileDurationSeconds,
      playbackRate: 1,
      audioEdit: normalizeAudioEdit(),
      stretch: makeDefaultAudioStretch(fileDurationSeconds),
      color: track.color || '#58d4ff',
      waveform: metadata.waveform,
      sampleRate: metadata.sampleRate,
      bitDepth: metadata.bitDepth,
      bitDepthSource: metadata.bitDepthSource,
      channelCount: metadata.channelCount,
      fileName: metadata.fileName,
      fileType: metadata.fileType,
      contentType: metadata.contentType,
      fileSizeBytes: metadata.fileSizeBytes,
      createdAt: now,
      updatedAt: now,
      audioClip: {
        id: clipId,
        audioAssetId: clipId,
        runtimeId: clipId,
        source,
        contentType: metadata.contentType,
        fileType: metadata.fileType,
        fileName: metadata.fileName,
        fileSizeBytes: metadata.fileSizeBytes,
        sampleRate: metadata.sampleRate,
        bitDepth: metadata.bitDepth,
        bitDepthSource: metadata.bitDepthSource,
        channelCount: metadata.channelCount,
        fileDurationSeconds,
        storagePath,
        sessionOnly: false,
        missingAfterReload: false,
        uploadError: null,
        loadStatus: 'ready',
        audioReady: true,
        createdAt: now,
        updatedAt: now
      },
      missingMedia: false
    })
    audioClipRuntime.set(region.id, {
      blob: file,
      url: URL.createObjectURL(file),
      audioBuffer: metadata.audioBuffer,
      contentType: metadata.contentType,
      fileDurationSeconds,
      waveform: metadata.waveform
    })
    syncAudioRegionTimeline(region)
    midiRegions.push(region)
    applyRegionPlacementWithOverlapResolution([region])
    selectSingleRegion(region.id)
    activeBottomPanel = 'midi-roll'
    recordingStatus = ''
    pushHistory('import-audio-region', before, captureDawSnapshot())
    scheduleEditorSave()
    renderEditor()
    return region
  } catch (error) {
    console.warn('[studioProject] audio import failed', { name: error?.name, message: error?.message })
    recordingStatus = error?.message === 'Unsupported audio file.' ? 'Unsupported audio file.' : 'Could not decode this audio file.'
    renderEditor()
    return null
  }
}
function openAudioImportPicker() {
  const track = getSelectedTrack()
  if (!track) {
    recordingStatus = 'Select an audio track first.'
    renderEditor()
    return
  }
  if (!isAudioTrack(track)) {
    recordingStatus = 'Select an audio track to import audio, or create a new audio track.'
    renderEditor()
    return
  }
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.addEventListener('change', () => {
    const file = input.files?.[0]
    input.remove()
    if (file) createAudioRegionFromFile({ file, trackId: track.id, timelineStartBeats: clampBeat(xToBeat(timelineState.playheadX)), source: 'import' })
  }, { once: true })
  input.click()
}
function getFirstAudioFileFromDataTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || [])
  const direct = files.find(isSupportedAudioFile)
  if (direct) return direct
  const items = Array.from(dataTransfer?.items || [])
  return items.map((item)=>item.kind === 'file' ? item.getAsFile?.() : null).find(isSupportedAudioFile) || null
}
function getAudioImportPlacement(event, file = null) {
  const trackIndex = getTrackLaneFromY(event.clientY)
  const track = tracks[trackIndex] || null
  const rawBeat = pointerEventToTimelineBeat(event, { snapped: false })
  const startBeat = clampBeat(isSnapEnabled ? snapBeatToGrid(rawBeat) : rawBeat)
  const valid = Boolean(track && isAudioTrack(track) && file && isSupportedAudioFile(file))
  return {
    track,
    trackId: track?.id || selectedTrackId,
    startBeat,
    valid,
    message: !file || !isSupportedAudioFile(file)
      ? 'Unsupported audio file.'
      : track && !isAudioTrack(track)
        ? 'Drop audio onto an audio track.'
        : 'Drop audio onto an audio track.'
  }
}
function scheduleAudioImportPreviewRender() {
  if (audioImportPreviewRaf) return
  audioImportPreviewRaf = requestAnimationFrame(() => {
    audioImportPreviewRaf = 0
    renderEditor()
  })
}
function updateAudioImportPreview(event) {
  const file = getFirstAudioFileFromDataTransfer(event.dataTransfer)
  if (!file) {
    audioImportDrag = null
    return false
  }
  const placement = getAudioImportPlacement(event, file)
  const key = audioImportCacheKey(file)
  const cached = audioImportPreviewCache.get(key)
  audioImportDrag = {
    active: true,
    file,
    fileKey: key,
    fileName: file.name || 'Audio',
    trackId: placement.trackId,
    startBeat: placement.startBeat,
    valid: placement.valid,
    message: placement.message,
    status: cached?.metadata ? 'ready' : 'loading',
    durationSeconds: cached?.metadata?.fileDurationSeconds || minAudioRegionSeconds
  }
  if (!cached?.metadata && !cached?.promise) {
    decodeAudioFileForImport(file).then((metadata) => {
      if (audioImportDrag?.fileKey !== key) return
      audioImportDrag = { ...audioImportDrag, status: 'ready', durationSeconds: metadata.fileDurationSeconds }
      scheduleAudioImportPreviewRender()
    }).catch(() => {
      if (audioImportDrag?.fileKey !== key) return
      audioImportDrag = { ...audioImportDrag, status: 'failed', valid: false, message: 'Could not decode this audio file.' }
      scheduleAudioImportPreviewRender()
    })
  }
  return true
}
async function handleAudioImportDrop(event) {
  const file = getFirstAudioFileFromDataTransfer(event.dataTransfer)
  audioImportDrag = null
  if (!file) return
  const placement = getAudioImportPlacement(event, file)
  if (!placement.valid) {
    recordingStatus = placement.message || 'Drop audio onto an audio track.'
    renderEditor()
    return
  }
  await createAudioRegionFromFile({ file, trackId: placement.track.id, timelineStartBeats: placement.startBeat, source: 'import' })
}
function cleanupAudioRecordingController() {
  const controller = audioRecordingController
  if (!controller) return
  if (controller.sampleTimer) window.clearInterval(controller.sampleTimer)
  try { controller.source?.disconnect() } catch {}
  try { controller.stream?.getTracks?.().forEach((track)=>track.stop()) } catch {}
  audioRecordingController = null
}
function cleanupPendingAudioInputStream() {
  if (!pendingAudioInputStream) return
  try { pendingAudioInputStream.getTracks?.().forEach((track)=>track.stop()) } catch {}
  pendingAudioInputStream = null
}
async function finalizeAudioRecording({ keepEmpty = false } = {}) {
  if (!activeRecording || activeRecording.type !== 'audio') return
  const before = captureDawSnapshot()
  const recording = activeRecording
  const controller = audioRecordingController
  activeRecording = null
  if (controller?.mediaRecorder && controller.mediaRecorder.state !== 'inactive') {
    await new Promise((resolve) => {
      controller.mediaRecorder.addEventListener('stop', resolve, { once: true })
      try { controller.mediaRecorder.stop() } catch { resolve() }
    })
  }
  cleanupAudioRecordingController()
  const chunks = controller?.chunks || []
  if (!chunks.length && !keepEmpty) {
    recordingStatus = 'No audio was captured.'
    renderEditor()
    return
  }
  const blob = new Blob(chunks, { type: recording.audioClip?.contentType || chunks[0]?.type || 'audio/webm' })
  const clipId = recording.id
  const now = Date.now()
  const fileName = `${clipId}.${extensionForAudioType(blob.type || 'audio/webm')}`
  let storagePath = null
  let uploadError = ''
  try {
    storagePath = await uploadSouraAudioBlob(blob, { clipId })
  } catch (err) {
    uploadError = err?.message || 'Audio upload failed.'
    console.warn('[studioProject] audio recording upload failed; clip remains session-only', err)
  }
  const track = tracks.find((item)=>item.id === recording.trackId)
  const region = cloneRegionForState({
    ...recording,
    color: track?.color || recording.color,
    name: track?.autoNameRegions === false ? '' : (recording.name || `${track?.name || 'Audio'} Take`),
    endBeat: Math.max(recording.startBeat + 0.25, recording.endBeat || clampBeat(xToBeat(timelineState.playheadX))),
    audioClip: {
      ...(recording.audioClip || {}),
      id: clipId,
      audioAssetId: clipId,
      runtimeId: clipId,
      contentType: blob.type || 'audio/webm',
      fileName,
      storagePath,
      sessionOnly: !storagePath,
      missingAfterReload: !storagePath,
      uploadError: uploadError || null,
      offlineReason: storagePath ? null : 'storage_upload_failed',
      loadStatus: 'ready',
      audioReady: true,
      createdAt: now,
      updatedAt: now
    },
    missingMedia: false
  })
  try {
    const ctx = getAudioContext()
    const buffer = await blob.arrayBuffer()
    const audioBuffer = await ctx.decodeAudioData(buffer.slice(0))
    const fileDurationSeconds = Math.max(minAudioRegionSeconds, audioBuffer.duration)
    region.fileDurationSeconds = fileDurationSeconds
    region.durationSeconds = fileDurationSeconds
    region.visibleDurationSeconds = fileDurationSeconds
    region.trimStartSeconds = 0
    region.trimEndSeconds = fileDurationSeconds
    region.durationBeats = Math.max(0.25, secondsToBeats(fileDurationSeconds))
    region.endBeat = region.startBeat + region.durationBeats
    region.waveform = buildAudioWaveformFromBuffer(audioBuffer, { maxPeaks: 1200 })
    region.audioClip = {
      ...(region.audioClip || {}),
      id: clipId,
      audioAssetId: clipId,
      fileDurationSeconds,
      runtimeId: clipId,
      contentType: blob.type || 'audio/webm',
      fileName,
      storagePath,
      sessionOnly: !storagePath,
      missingAfterReload: !storagePath,
      audioReady: true,
      loadStatus: 'ready',
      loadError: uploadError || null,
      offlineReason: storagePath ? null : 'storage_upload_failed',
      createdAt: now,
      updatedAt: now
    }
    region.playbackRate = 1
    region.stretch = makeDefaultAudioStretch(fileDurationSeconds)
    const url = URL.createObjectURL(blob)
    audioClipRuntime.set(region.id, { blob, url, audioBuffer, contentType: blob.type || 'audio/webm', fileDurationSeconds, waveform: region.waveform })
  } catch (err) {
    console.warn('[studioProject] audio clip decode failed; clip metadata retained', err)
  }
  syncAudioRegionTimeline(region)
  region.missingMedia = false
  midiRegions.push(region)
  applyRegionPlacementWithOverlapResolution([region])
  selectSingleRegion(region.id)
  recordingStatus = uploadError ? 'Audio recorded for this session, but upload failed. It may not play after refresh.' : ''
  pushHistory('record-audio-region', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
async function stopRecordingAndKeep() {
  if (isCountInRunning && !activeRecording) {
    isCountInRunning = false
    countInBeatsRemaining = 0
    countInTargetX = null
    countInTargetTrackId = ''
    cleanupPendingAudioInputStream()
  }
  if (activeRecording?.type === 'audio') await finalizeAudioRecording()
  else finalizeMidiRecording()
  stopAllTrackInstrumentNotes()
  stopPlayback()
  recordingStatus = ''
  renderEditor()
}
function recordMidiNoteOn(trackId, note, velocity = 0.85) {
  if (!activeRecording || activeRecording.type !== 'midi' || activeRecording.trackId !== trackId) return
  const key = `${trackId}:${note}`
  if (activeRecordingNotes.has(key)) return
  activeRecordingNotes.set(key, { note, velocity, startBeat: clampBeat(xToBeat(timelineState.playheadX)) })
  refreshMidiRegionDom()
}
function recordMidiNoteOff(trackId, note) {
  if (!activeRecording || activeRecording.type !== 'midi' || activeRecording.trackId !== trackId) return
  const key = `${trackId}:${note}`
  const started = activeRecordingNotes.get(key)
  if (!started) return
  const endBeat = Math.max(started.startBeat + 0.05, clampBeat(xToBeat(timelineState.playheadX)))
  activeRecording.notes.push({ note: started.note, velocity: started.velocity, startBeat: started.startBeat, durationBeats: endBeat - started.startBeat })
  activeRecordingNotes.delete(key)
  refreshMidiRegionDom()
}
function finalizeMidiRecording({ keepEmpty = false } = {}) {
  if (!activeRecording || activeRecording.type !== 'midi') return
  const before = captureDawSnapshot()
  const endBeat = Math.max(activeRecording.startBeat + 0.25, clampBeat(xToBeat(timelineState.playheadX)))
  activeRecordingNotes.forEach((started, key)=>{
    activeRecording.notes.push({ note: started.note, velocity: started.velocity, startBeat: started.startBeat, durationBeats: Math.max(0.05, endBeat - started.startBeat) })
    activeRecordingNotes.delete(key)
  })
  const track = tracks.find((item)=>item.id===activeRecording.trackId)
  if (activeRecording.notes.length || keepEmpty) {
    const region = { ...activeRecording, endBeat, color: track?.color || activeRecording.color, name: track?.autoNameRegions === false ? '' : (track?.name || '') }
    midiRegions.push(region)
    applyRegionPlacementWithOverlapResolution([region])
    selectSingleRegion(region.id)
  }
  activeRecording = null
  recordingStatus = ''
  activeRecordingNotes.clear()
  pushHistory('record-midi-region', before, captureDawSnapshot())
  scheduleEditorSave()
}
function stopAllTrackInstrumentNotes() {
  activeRecordingNotes.forEach((started)=> {
    const track = tracks.find((item)=>item.id===activeRecording?.trackId)
    if (track?.instrument?.pluginInstanceId) dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, started.note, { immediate: true, live: true })
  })
  pressedDawMidiKeys.forEach(({ trackId, note }) => {
    const track = tracks.find((item)=>item.id===trackId)
    if (track?.instrument?.pluginInstanceId) dawInstrumentRegistry.noteOff(track.instrument.pluginInstanceId, note, { immediate: true, live: true })
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
  if (audioStretchRenderState.active) return
  const region = midiRegions.find((item)=>item.id===regionId)
  const gridEl = app.querySelector('[data-arrangement-grid]')
  if (!region || !gridEl) return
  event.preventDefault()
  event.stopPropagation()
  if (!regionIsSelected(region.id)) selectSingleRegion(region.id)
  else selectedMidiRegionId = region.id
  const handle = event.target.closest('[data-midi-region-handle]')?.dataset?.midiRegionHandle || 'move'
  const isAudioRegion = region.type === 'audio'
  if (isAudioRegion) syncAudioRegionTimeline(region)
  const altStretch = event.altKey === true || event.getModifierState?.('Alt') === true || activeRegionTool === 'stretch'
  const editMode = isAudioRegion && ['left', 'right'].includes(handle) && altStretch ? 'stretch' : (isAudioRegion && ['left', 'right'].includes(handle) ? 'trim' : 'move')
  const originalSourceDurationSeconds = isAudioRegion ? getAudioSourceDurationSeconds(region) : 0
  const originalStretch = isAudioRegion ? normalizeAudioStretch(region.stretch, {
    clipId: region.id,
    sourceDurationSeconds: originalSourceDurationSeconds,
    visibleDurationSeconds: getRawAudioRegionVisibleDurationSeconds(region)
  }) : null
  const originalVisibleDurationSeconds = isAudioRegion ? getAudioRegionVisibleDurationSeconds(region) : 0
  midiRegionDrag = {
    id: region.id,
    mode: handle,
    editMode,
    regionType: region.type || 'midi',
    hasMoved: false,
    before: captureDawSnapshot(),
    startX: event.clientX,
    startY: event.clientY,
    scroll: captureArrangementScroll(),
    startBeat: Number(region.startBeat) || 0,
    endBeat: Number(region.endBeat) || ((Number(region.startBeat) || 0) + 1),
    startTrackIndex: Math.max(0, tracks.findIndex((track)=>track.id===region.trackId)),
    originalNotes: (region.notes || []).map((note)=>({ ...note })),
    originalTrimStartSeconds: getAudioTrimStartSeconds(region),
    originalTrimEndSeconds: getAudioTrimEndSeconds(region),
    originalVisibleDurationSeconds,
    originalSourceDurationSeconds,
    originalTargetDurationSeconds: originalStretch?.enabled ? (originalStretch.targetDurationSeconds || originalVisibleDurationSeconds) : originalVisibleDurationSeconds,
    timelineSecondsPerPixel: Math.max(0.000001, regionPixelsToSeconds(1)),
    originalStretch
  }
  if (editMode === 'stretch') logStretchDebug('pointerdown mode', region.id, {
    sourceDurationSeconds: originalSourceDurationSeconds,
    targetDurationSeconds: midiRegionDrag.originalTargetDurationSeconds,
    speedPercent: originalStretch?.speedPercent || 100,
    lengthRatio: originalStretch?.lengthRatio || 1,
    renderStatus: originalStretch?.renderStatus || 'idle',
    reason: `handle_${handle}`
  })
  document.body.classList.add('is-studio-dragging', 'is-midi-region-dragging')
  if (editMode === 'stretch') document.body.classList.add('is-audio-region-stretching')
  renderEditor()
  requestAnimationFrame(() => restoreArrangementScroll(midiRegionDrag?.scroll))
}
function applyAudioRegionDrag(event, region) {
  const drag = midiRegionDrag
  const minSeconds = minAudioRegionSeconds
  const pointerBeat = pointerEventToTimelineBeat(event)
  const fileDuration = getAudioFileDurationSeconds(region)
  if (drag.mode === 'left') {
    if (drag.editMode === 'stretch') {
      const fixedEndBeat = drag.endBeat
      const deltaSeconds = (event.clientX - drag.startX) * drag.timelineSecondsPerPixel
      const minTargetSeconds = Math.max(minSeconds, drag.originalSourceDurationSeconds * STRETCH_RATIO_MIN)
      const maxTargetSeconds = Math.max(minTargetSeconds, drag.originalSourceDurationSeconds * STRETCH_RATIO_MAX)
      let visibleSeconds = clamp(drag.originalTargetDurationSeconds - deltaSeconds, minTargetSeconds, maxTargetSeconds)
      const nextStartBeat = Math.max(0, fixedEndBeat - secondsToBeats(visibleSeconds))
      visibleSeconds = Math.max(minSeconds, beatsToSeconds(fixedEndBeat - nextStartBeat))
      region.startBeat = nextStartBeat
      region.stretch = createPendingStretchMetadata({ sourceDurationSeconds: drag.originalSourceDurationSeconds, targetDurationSeconds: visibleSeconds })
      region.stretchRender = null
      region.renderedWaveform = null
      region.visibleDurationSeconds = visibleSeconds
      logStretchDebug('pointermove', region.id, {
        sourceDurationSeconds: drag.originalSourceDurationSeconds,
        targetDurationSeconds: visibleSeconds,
        speedPercent: region.stretch.speedPercent,
        lengthRatio: region.stretch.lengthRatio,
        renderStatus: region.stretch.renderStatus,
        reason: 'left_edge'
      })
    } else {
      const nextStartBeat = clamp(pointerBeat, drag.startBeat - secondsToBeats(drag.originalTrimStartSeconds), drag.endBeat - secondsToBeats(minSeconds))
      const deltaSeconds = beatsToSeconds(nextStartBeat - drag.startBeat)
      const nextTrimStart = clamp(drag.originalTrimStartSeconds + deltaSeconds, 0, drag.originalTrimEndSeconds - minSeconds)
      region.startBeat = nextStartBeat
      region.trimStartSeconds = nextTrimStart
      region.trimEndSeconds = drag.originalTrimEndSeconds
      region.stretchRender = null
      region.renderedWaveform = null
      region.visibleDurationSeconds = Math.max(minSeconds, region.trimEndSeconds - region.trimStartSeconds)
      region.stretch = makeDefaultAudioStretch(region.visibleDurationSeconds)
    }
  } else if (drag.mode === 'right') {
    const visibleSeconds = Math.max(minSeconds, beatsToSeconds(pointerBeat - drag.startBeat))
    if (drag.editMode === 'stretch') {
      const deltaSeconds = (event.clientX - drag.startX) * drag.timelineSecondsPerPixel
      const minTargetSeconds = Math.max(minSeconds, drag.originalSourceDurationSeconds * STRETCH_RATIO_MIN)
      const maxTargetSeconds = Math.max(minTargetSeconds, drag.originalSourceDurationSeconds * STRETCH_RATIO_MAX)
      const targetSeconds = clamp(drag.originalTargetDurationSeconds + deltaSeconds, minTargetSeconds, maxTargetSeconds)
      region.visibleDurationSeconds = targetSeconds
      region.stretch = createPendingStretchMetadata({ sourceDurationSeconds: drag.originalSourceDurationSeconds, targetDurationSeconds: targetSeconds })
      region.stretchRender = null
      region.renderedWaveform = null
      logStretchDebug('pointermove', region.id, {
        sourceDurationSeconds: drag.originalSourceDurationSeconds,
        targetDurationSeconds: targetSeconds,
        speedPercent: region.stretch.speedPercent,
        lengthRatio: region.stretch.lengthRatio,
        renderStatus: region.stretch.renderStatus,
        reason: 'right_edge'
      })
    } else {
      const maxVisibleSeconds = Math.max(minSeconds, fileDuration - drag.originalTrimStartSeconds)
      region.trimStartSeconds = drag.originalTrimStartSeconds
      region.trimEndSeconds = clamp(drag.originalTrimStartSeconds + visibleSeconds, drag.originalTrimStartSeconds + minSeconds, fileDuration)
      region.visibleDurationSeconds = Math.min(maxVisibleSeconds, region.trimEndSeconds - region.trimStartSeconds)
      region.stretch = makeDefaultAudioStretch(region.visibleDurationSeconds)
      region.stretchRender = null
      region.renderedWaveform = null
    }
  } else {
    const dx = event.clientX - drag.startX
    const deltaBeat = regionPixelsToBeats(dx)
    const snappedDelta = isSnapEnabled ? snapBeat(deltaBeat) : deltaBeat
    const originalLength = Math.max(secondsToBeats(minSeconds), drag.endBeat - drag.startBeat)
    const nextStart = Math.max(0, drag.startBeat + snappedDelta)
    region.startBeat = nextStart
    region.endBeat = nextStart + originalLength
    const nextTrack = tracks[getTrackIndexFromClientY(event.clientY)]
    if (nextTrack) {
      region.trackId = nextTrack.id
      if (!region.independentColor) region.color = nextTrack.color
    }
  }
  syncAudioRegionTimeline(region)
}
function applyMidiRegionDrag(event) {
  if (!midiRegionDrag) return
  updateTimelineEdgeAutoScroll(event)
  const region = midiRegions.find((item)=>item.id===midiRegionDrag.id)
  if (!region) return
  const dx = event.clientX - midiRegionDrag.startX
  const dy = event.clientY - midiRegionDrag.startY
  if (!midiRegionDrag.hasMoved && Math.hypot(dx, dy) < 4) return
  midiRegionDrag.hasMoved = true
  const deltaBeat = regionPixelsToBeats(dx)
  const snappedDelta = isSnapEnabled ? snapBeat(deltaBeat) : deltaBeat
  const minLength = 0.25
  const originalLength = Math.max(minLength, midiRegionDrag.endBeat - midiRegionDrag.startBeat)
  if (region.type === 'audio') {
    applyAudioRegionDrag(event, region)
  } else if (midiRegionDrag.mode === 'left') {
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
function scheduleMidiRegionDragFrame(event) {
  pendingMidiRegionDragEvent = { clientX: event.clientX, clientY: event.clientY }
  if (midiRegionDragRenderRaf) return
  midiRegionDragRenderRaf = requestAnimationFrame(() => {
    midiRegionDragRenderRaf = 0
    const nextEvent = pendingMidiRegionDragEvent
    pendingMidiRegionDragEvent = null
    if (nextEvent) applyMidiRegionDrag(nextEvent)
  })
}
function flushPendingMidiRegionDrag() {
  if (midiRegionDragRenderRaf) {
    cancelAnimationFrame(midiRegionDragRenderRaf)
    midiRegionDragRenderRaf = 0
  }
  const nextEvent = pendingMidiRegionDragEvent
  pendingMidiRegionDragEvent = null
  if (nextEvent) applyMidiRegionDrag(nextEvent)
}
function finishMidiRegionDrag() {
  if (!midiRegionDrag) return
  flushPendingMidiRegionDrag()
  stopTimelineEdgeAutoScroll()
  const didMove = midiRegionDrag.hasMoved
  const before = midiRegionDrag.before
  const finished = { id: midiRegionDrag.id, editMode: midiRegionDrag.editMode, regionType: midiRegionDrag.regionType, scroll: midiRegionDrag.scroll }
  const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)
  if (didMove && finishedRegion) applyRegionPlacementWithOverlapResolution([finishedRegion])
  midiRegionDrag = null
  document.body.classList.remove('is-studio-dragging', 'is-midi-region-dragging', 'is-audio-region-stretching')
  if (didMove) {
    pushHistory('edit-midi-region', before, captureDawSnapshot())
    scheduleEditorSave()
    if (finished.editMode === 'stretch') {
      const region = midiRegions.find((item)=>item.id === finished.id && item.type === 'audio')
      if (region) logStretchDebug('commit', region, { reason: 'pointerup' })
    }
  }
  renderEditor()
  requestAnimationFrame(() => restoreArrangementScroll(finished.scroll))
}

function selectMidiNote(regionId, noteIndex) {
  const region = midiRegions.find((item)=>item.id === regionId)
  if (!region?.notes?.[noteIndex]) return
  midiRollState = { ...(midiRollState || {}), regionId }
  selectSingleRegion(regionId)
  midiRollSelectedNoteIndex = noteIndex
  midiRollStatus = ''
  renderEditor()
}
function getSelectedAudioRegion() {
  return midiRegions.find((item)=>item.id === selectedMidiRegionId && item.type === 'audio') || null
}
function updateAudioRegionEditField(region, key, rawValue) {
  if (!region || region.type !== 'audio') return
  const before = captureDawSnapshot()
  const edit = normalizeAudioEdit(region.audioEdit)
  if (key === 'mute' || key === 'loop') edit[key] = rawValue === true
  else if (['qSwing','qStrength','transposeSemitones','fineTuneCents','gainDb','delayMs','fadeInSeconds','fadeOutSeconds'].includes(key)) edit[key] = Number(rawValue) || 0
  else if (key === 'qRange') edit[key] = rawValue === '' ? null : Number(rawValue)
  else if (['quantize','pitchSource','fadeInCurve','fadeOutCurve'].includes(key)) edit[key] = String(rawValue || '')
  else if (key === 'reverse') {
    edit.reverse = {
      ...edit.reverse,
      enabled: rawValue === true,
      renderStatus: rawValue === true ? 'needs_render' : 'idle',
      renderedStoragePath: null,
      renderedAudioUrl: null,
      renderedRuntimeId: null,
      renderedDurationSeconds: null,
      lastError: null
    }
  }
  if (key === 'transposeSemitones' || key === 'fineTuneCents') {
    const totalSemitones = getAudioPitchShiftTotal(edit.transposeSemitones, edit.fineTuneCents)
    edit.pitchShift = {
      ...edit.pitchShift,
      enabled: Math.abs(totalSemitones) > 0.001,
      totalSemitones,
      renderStatus: Math.abs(totalSemitones) > 0.001 ? 'needs_render' : 'idle',
      renderedStoragePath: null,
      renderedAudioUrl: null,
      renderedRuntimeId: null,
      lastError: null
    }
    if (edit.pitchTrace?.renderStatus === 'ready' && edit.pitchTrace.notes?.length) {
      edit.pitchTrace = { ...edit.pitchTrace, renderStatus: 'needs_render', renderedRuntimeId: null, renderedStoragePath: null, renderedAudioUrl: null, lastError: null }
    }
  }
  region.audioEdit = normalizeAudioEdit(edit)
  pushHistory('edit-audio-region', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function setAudioRegionPitchTrace(region, patch = {}, historyLabel = 'edit-pitch-trace') {
  if (!region || region.type !== 'audio') return
  const before = captureDawSnapshot()
  const edit = normalizeAudioEdit(region.audioEdit)
  region.audioEdit = normalizeAudioEdit({
    ...edit,
    pitchTrace: normalizePitchTrace({
      ...edit.pitchTrace,
      ...patch,
      notes: patch.notes || edit.pitchTrace.notes || []
    })
  })
  pushHistory(historyLabel, before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function getAudioBufferSamplesForPitchTrace(audioBuffer, region) {
  const trimStart = getAudioTrimStartSeconds(region)
  const trimEnd = getAudioTrimEndSeconds(region)
  const sampleRate = audioBuffer.sampleRate || 44100
  const startSample = clamp(Math.floor(trimStart * sampleRate), 0, audioBuffer.length)
  const endSample = clamp(Math.ceil(trimEnd * sampleRate), startSample + 1, audioBuffer.length)
  const length = Math.max(1, endSample - startSample)
  const samples = new Float32Array(length)
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) samples[index] += (channel[startSample + index] || 0) / channels
  }
  return samples
}
async function analyzePitchTraceForRegion(regionId) {
  if (pitchTraceAnalysis.active) return
  const region = midiRegions.find((item)=>item.id === regionId && item.type === 'audio')
  if (!region) return
  let runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  if (!runtime?.audioBuffer && (region.audioClip?.storagePath || region.audioClip?.downloadUrl)) {
    await hydrateAudioRegionRuntime(region)
    runtime = audioClipRuntime.get(region.audioClip?.runtimeId || region.id)
  }
  if (!runtime?.audioBuffer) {
    setAudioRegionPitchTrace(region, {
      enabled: true,
      status: 'failed',
      error: 'Audio must be loaded before Pitch Trace analysis can run.'
    }, 'pitch-trace-failed')
    return
  }
  const edit = normalizeAudioEdit(region.audioEdit)
  const requestId = `${region.id}:${Date.now()}`
  const worker = new Worker(new URL('./studio/audio/pitchTraceWorker.js', import.meta.url), { type: 'module' })
  pitchTraceAnalysis = { active: true, regionId: region.id, requestId, worker }
  region.audioEdit = normalizeAudioEdit({
    ...edit,
    pitchTrace: {
      ...edit.pitchTrace,
      enabled: true,
      status: 'analyzing',
      progress: 0,
      error: null,
      algorithm: PITCH_TRACE_ALGORITHM,
      analysisVersion: PITCH_TRACE_VERSION
    }
  })
  renderEditor()
  try {
    const samples = getAudioBufferSamplesForPitchTrace(runtime.audioBuffer, region)
    worker.onmessage = (event) => {
      const message = event.data || {}
      if (message.requestId !== requestId) return
      const target = midiRegions.find((item)=>item.id === region.id && item.type === 'audio')
      if (!target) return
      const currentEdit = normalizeAudioEdit(target.audioEdit)
      if (message.type === 'progress') {
        target.audioEdit = normalizeAudioEdit({
          ...currentEdit,
          pitchTrace: { ...currentEdit.pitchTrace, enabled: true, status: 'analyzing', progress: Number(message.progress) || 0 }
        })
        renderEditor()
        return
      }
      if (message.type === 'complete') {
        worker.terminate()
        pitchTraceAnalysis = { active: false, regionId: '', requestId: '', worker: null }
        target.audioEdit = normalizeAudioEdit({
          ...currentEdit,
          pitchTrace: {
            ...currentEdit.pitchTrace,
            enabled: true,
            status: 'ready',
            algorithm: message.algorithm || PITCH_TRACE_ALGORITHM,
            analysisVersion: PITCH_TRACE_VERSION,
            analyzedAt: Date.now(),
            progress: 1,
            error: null,
            renderStatus: 'idle',
            renderedStoragePath: null,
            renderedAudioUrl: null,
            renderedRuntimeId: null,
            renderedDurationSeconds: null,
            renderAlgorithm: null,
            lastError: null,
            notes: Array.isArray(message.notes) ? message.notes : []
          }
        })
        scheduleEditorSave()
        renderEditor()
        return
      }
      if (message.type === 'error') {
        worker.terminate()
        pitchTraceAnalysis = { active: false, regionId: '', requestId: '', worker: null }
        target.audioEdit = normalizeAudioEdit({
          ...currentEdit,
          pitchTrace: { ...currentEdit.pitchTrace, enabled: true, status: 'failed', error: message.error || 'Pitch analysis failed.', progress: 0 }
        })
        scheduleEditorSave()
        renderEditor()
      }
    }
    worker.onerror = (error) => {
      worker.terminate()
      pitchTraceAnalysis = { active: false, regionId: '', requestId: '', worker: null }
      const target = midiRegions.find((item)=>item.id === region.id && item.type === 'audio')
      if (target) {
        const currentEdit = normalizeAudioEdit(target.audioEdit)
        target.audioEdit = normalizeAudioEdit({
          ...currentEdit,
          pitchTrace: { ...currentEdit.pitchTrace, enabled: true, status: 'failed', error: error?.message || 'Pitch analysis failed.', progress: 0 }
        })
        scheduleEditorSave()
        renderEditor()
      }
    }
    worker.postMessage({
      type: 'analyze',
      requestId,
      samples: samples.buffer,
      sampleRate: runtime.audioBuffer.sampleRate || 44100,
      bpm: Number(projectState?.bpm || 140),
      regionStartBeat: Number(region.startBeat || 0),
      stretchRatio: getAudioStretchRatio(region),
      confidenceThreshold: edit.pitchTrace.confidenceThreshold
    }, [samples.buffer])
  } catch (error) {
    worker.terminate()
    pitchTraceAnalysis = { active: false, regionId: '', requestId: '', worker: null }
    setAudioRegionPitchTrace(region, {
      enabled: true,
      status: 'failed',
      error: error?.message || 'Pitch analysis failed.'
    }, 'pitch-trace-failed')
  }
}
function updateAudioRegionStretchTarget(region, targetDurationSeconds) {
  if (!region || region.type !== 'audio') return
  const before = captureDawSnapshot()
  const sourceDurationSeconds = getAudioSourceDurationSeconds(region)
  const target = Math.max(minAudioRegionSeconds, Number(targetDurationSeconds) || sourceDurationSeconds)
  const math = getAudioStretchMath({ ...region, stretch: { ...region.stretch, enabled: true, sourceDurationSeconds, targetDurationSeconds: target } }, target)
  region.visibleDurationSeconds = target
  region.durationSeconds = target
  region.durationBeats = secondsToBeats(target)
  region.endBeat = Number(region.startBeat || 0) + region.durationBeats
  region.stretch = createPendingStretchMetadata({ sourceDurationSeconds, targetDurationSeconds: target })
  region.stretchRender = null
  region.renderedWaveform = null
  syncAudioRegionTimeline(region)
  logStretchDebug('control change', region.id, {
    sourceDurationSeconds,
    targetDurationSeconds: target,
    speedPercent: math.speedPercent,
    lengthRatio: math.lengthRatio,
    renderStatus: region.stretch.renderStatus,
    reason: math.supported ? 'target_update' : 'validation_error'
  })
  pushHistory('stretch-audio-region', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function enableAudioRegionStretch(region) {
  if (!region || region.type !== 'audio') return
  const before = captureDawSnapshot()
  const sourceDuration = Math.max(minAudioRegionSeconds, getAudioSourceDurationSeconds(region))
  const visibleDuration = Math.max(minAudioRegionSeconds, getRawAudioRegionVisibleDurationSeconds(region) || sourceDuration)
  region.visibleDurationSeconds = visibleDuration
  region.durationSeconds = visibleDuration
  region.durationBeats = secondsToBeats(visibleDuration)
  region.endBeat = Number(region.startBeat || 0) + region.durationBeats
  region.stretch = createPendingStretchMetadata({ sourceDurationSeconds: sourceDuration, targetDurationSeconds: visibleDuration })
  region.stretchRender = null
  region.renderedWaveform = null
  syncAudioRegionTimeline(region)
  logStretchDebug('control change', region.id, {
    sourceDurationSeconds: sourceDuration,
    targetDurationSeconds: visibleDuration,
    speedPercent: region.stretch.speedPercent,
    lengthRatio: region.stretch.lengthRatio,
    renderStatus: region.stretch.renderStatus,
    reason: 'enable'
  })
  pushHistory('enable-audio-stretch', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function resetAudioRegionStretch(region) {
  if (!region || region.type !== 'audio') return
  const before = captureDawSnapshot()
  const sourceDuration = getAudioSourceDurationSeconds(region)
  region.visibleDurationSeconds = sourceDuration
  region.durationSeconds = sourceDuration
  region.durationBeats = secondsToBeats(sourceDuration)
  region.endBeat = Number(region.startBeat || 0) + region.durationBeats
  region.stretch = makeDefaultAudioStretch(sourceDuration)
  region.stretchRender = null
  region.renderedWaveform = null
  syncAudioRegionTimeline(region)
  logStretchDebug('control change', region.id, {
    sourceDurationSeconds: sourceDuration,
    targetDurationSeconds: sourceDuration,
    speedPercent: 100,
    lengthRatio: 1,
    renderStatus: 'idle',
    reason: 'reset'
  })
  pushHistory('reset-audio-stretch', before, captureDawSnapshot())
  scheduleEditorSave()
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
  selectSingleRegion(regionId)
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
function beginPitchTraceNoteDrag(event, regionId, noteId) {
  const region = midiRegions.find((item)=>item.id === regionId && item.type === 'audio')
  const edit = normalizeAudioEdit(region?.audioEdit)
  const note = edit.pitchTrace.notes.find((item)=>item.id === noteId)
  if (!region || !note) return
  event.preventDefault()
  event.stopPropagation()
  selectSingleRegion(regionId)
  pitchTraceSelectedNoteId = noteId
  const visibleNotes = edit.pitchTrace.notes.filter((item)=>item.confidence >= edit.pitchTrace.confidenceThreshold)
  const noteValues = visibleNotes.map((item)=>Number(item.editedMidiNote ?? item.midiNote)).filter(Number.isFinite)
  const minNote = Math.max(0, Math.min(48, ...(noteValues.length ? noteValues : [48])) - 2)
  const maxNote = Math.min(127, Math.max(72, ...(noteValues.length ? noteValues : [72])) + 2)
  const handle = event.target.closest('[data-pitch-trace-note-handle]')?.dataset?.pitchTraceNoteHandle || 'pitch'
  pitchTraceNoteDrag = {
    regionId,
    noteId,
    mode: handle,
    before: captureDawSnapshot(),
    startX: event.clientX,
    startY: event.clientY,
    startSeconds: Number(note.startSeconds) || 0,
    durationSeconds: Math.max(0.03, Number(note.durationSeconds) || 0.03),
    startEditedMidiNote: Number(note.editedMidiNote) || Number(note.midiNote) || 60,
    visibleDurationSeconds: Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region)),
    minNote,
    maxNote,
    rowCount: Math.max(1, maxNote - minNote + 1),
    hasMoved: false
  }
  document.body.classList.add('is-studio-dragging', 'is-pitch-trace-note-dragging')
  app.querySelectorAll('[data-pitch-trace-note]').forEach((node)=>node.classList.toggle('is-selected', node.dataset.pitchTraceNote === noteId))
}
function applyPitchTraceNoteDrag(event) {
  if (!pitchTraceNoteDrag) return
  const region = midiRegions.find((item)=>item.id === pitchTraceNoteDrag.regionId && item.type === 'audio')
  if (!region) return
  const dy = event.clientY - pitchTraceNoteDrag.startY
  const dx = event.clientX - pitchTraceNoteDrag.startX
  if (!pitchTraceNoteDrag.hasMoved && Math.hypot(dx, dy) < 3) return
  const pitchDelta = -Math.round(dy / 14)
  const edit = normalizeAudioEdit(region.audioEdit)
  const notes = edit.pitchTrace.notes.map((note)=> {
    if (note.id !== pitchTraceNoteDrag.noteId) return note
    if (pitchTraceNoteDrag.mode === 'left' || pitchTraceNoteDrag.mode === 'right') {
      const deltaSeconds = (dx / Math.max(1, app.querySelector('[data-pitch-trace-grid]')?.getBoundingClientRect?.()?.width || 1)) * pitchTraceNoteDrag.visibleDurationSeconds
      if (pitchTraceNoteDrag.mode === 'left') {
        const nextStart = clamp(pitchTraceNoteDrag.startSeconds + deltaSeconds, 0, pitchTraceNoteDrag.startSeconds + pitchTraceNoteDrag.durationSeconds - 0.03)
        const nextDuration = Math.max(0.03, pitchTraceNoteDrag.startSeconds + pitchTraceNoteDrag.durationSeconds - nextStart)
        return {
          ...note,
          startSeconds: nextStart,
          durationSeconds: nextDuration,
          startBeat: (Number(region.startBeat) || 0) + secondsToBeats(nextStart),
          durationBeats: secondsToBeats(nextDuration),
          renderStatus: 'needs_render'
        }
      }
      const nextDuration = Math.max(0.03, pitchTraceNoteDrag.durationSeconds + deltaSeconds)
      return {
        ...note,
        durationSeconds: nextDuration,
        durationBeats: secondsToBeats(nextDuration),
        renderStatus: 'needs_render'
      }
    }
    const nextMidi = clamp(pitchTraceNoteDrag.startEditedMidiNote + pitchDelta, 0, 127)
    const edited = {
      ...note,
      editedMidiNote: nextMidi,
      midiNote: nextMidi,
      noteName: formatMidiNoteName(nextMidi),
      editedFrequencyHz: midiNoteToFrequency(nextMidi),
      frequencyHz: midiNoteToFrequency(nextMidi),
      renderStatus: nextMidi === note.originalMidiNote && !note.muted ? 'idle' : 'needs_render'
    }
    return edited
  })
  const nextTrace = normalizePitchTrace({
    ...edit.pitchTrace,
    notes,
    renderStatus: getPitchTraceEditedNoteCount({ notes }) ? 'needs_render' : 'idle',
    renderedRuntimeId: null,
    renderedStoragePath: null,
    renderedAudioUrl: null,
    lastError: null
  })
  region.audioEdit = normalizeAudioEdit({ ...edit, pitchTrace: nextTrace })
  pitchTraceNoteDrag.hasMoved = true
  const noteEl = app.querySelector(`[data-pitch-trace-note="${CSS.escape(String(pitchTraceNoteDrag.noteId))}"]`)
  if (noteEl) {
    const editedNote = notes.find((note)=>note.id === pitchTraceNoteDrag.noteId)
    if (editedNote) {
      noteEl.style.left = `${(clamp(editedNote.startSeconds / pitchTraceNoteDrag.visibleDurationSeconds, 0, 1) * 100).toFixed(3)}%`
      noteEl.style.width = `${(clamp(editedNote.durationSeconds / pitchTraceNoteDrag.visibleDurationSeconds, 0.002, 1) * 100).toFixed(3)}%`
      const visibleMidi = clamp(editedNote.editedMidiNote, pitchTraceNoteDrag.minNote, pitchTraceNoteDrag.maxNote)
      const row = pitchTraceNoteDrag.maxNote - visibleMidi
      noteEl.style.top = `${((row / pitchTraceNoteDrag.rowCount) * 100).toFixed(3)}%`
      noteEl.classList.toggle('is-edited', editedNote.editedMidiNote !== editedNote.originalMidiNote || editedNote.source === 'manual')
      noteEl.querySelector('b')?.replaceChildren(document.createTextNode(formatMidiNoteName(editedNote.editedMidiNote)))
    }
  }
}
function finishPitchTraceNoteDrag() {
  if (!pitchTraceNoteDrag) return
  const didMove = pitchTraceNoteDrag.hasMoved
  const before = pitchTraceNoteDrag.before
  pitchTraceNoteDrag = null
  document.body.classList.remove('is-studio-dragging', 'is-pitch-trace-note-dragging')
  if (didMove) {
    pushHistory('edit-pitch-trace-note', before, captureDawSnapshot())
    scheduleEditorSave()
  }
  renderEditor()
}
function mutatePitchTraceNote(region, noteId, mutator, historyLabel = 'edit-pitch-trace-note') {
  if (!region || region.type !== 'audio') return
  const before = captureDawSnapshot()
  const edit = normalizeAudioEdit(region.audioEdit)
  const notes = edit.pitchTrace.notes.map((note)=> {
    if (note.id !== noteId) return note
    const next = { ...note }
    mutator?.(next)
    next.editedMidiNote = clamp(Math.round(Number(next.editedMidiNote ?? next.midiNote ?? next.originalMidiNote) || 60), 0, 127)
    next.midiNote = next.editedMidiNote
    next.noteName = formatMidiNoteName(next.editedMidiNote)
    next.editedFrequencyHz = midiNoteToFrequency(next.editedMidiNote)
    next.frequencyHz = next.editedFrequencyHz
    next.renderStatus = next.editedMidiNote === next.originalMidiNote && !next.muted ? 'idle' : 'needs_render'
    return next
  })
  const renderStatus = getPitchTraceEditedNoteCount({ notes }) ? 'needs_render' : 'idle'
  region.audioEdit = normalizeAudioEdit({
    ...edit,
    pitchTrace: {
      ...edit.pitchTrace,
      notes,
      renderStatus,
      renderedRuntimeId: null,
      renderedStoragePath: null,
      renderedAudioUrl: null,
      lastError: null
    }
  })
  pushHistory(historyLabel, before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function pitchTracePointFromEvent(event) {
  const grid = event.target.closest('[data-pitch-trace-grid]') || app.querySelector('[data-pitch-trace-grid]')
  const view = app.querySelector('[data-pitch-trace-view]')
  const rect = grid?.getBoundingClientRect?.()
  if (!grid || !view || !rect?.width || !rect?.height) return null
  const minNote = Number(view.dataset.pitchMin) || 48
  const maxNote = Number(view.dataset.pitchMax) || 72
  const visibleDuration = Math.max(minAudioRegionSeconds, Number(view.dataset.pitchDuration) || minAudioRegionSeconds)
  const xRatio = clamp((event.clientX - rect.left) / rect.width, 0, 1)
  const yRatio = clamp((event.clientY - rect.top) / rect.height, 0, 1)
  const midiNote = clamp(Math.round(maxNote - (yRatio * (maxNote - minNote + 1))), 0, 127)
  let seconds = xRatio * visibleDuration
  if (isSnapEnabled) seconds = beatsToSeconds(snapBeat(secondsToBeats(seconds), getMidiRollSnapValue()))
  return { seconds: clamp(seconds, 0, visibleDuration), midiNote, visibleDuration }
}
function beginPitchTraceNoteDraw(event) {
  if (pitchTraceTool !== 'pencil' || event.button !== 0 || event.target.closest('[data-pitch-trace-note]')) return
  const region = getSelectedAudioRegion()
  const point = pitchTracePointFromEvent(event)
  if (!region || !point) return
  event.preventDefault()
  event.stopPropagation()
  const before = captureDawSnapshot()
  const edit = normalizeAudioEdit(region.audioEdit)
  const id = makeInsertId('pitch-note')
  const note = {
    id,
    startSeconds: point.seconds,
    durationSeconds: Math.max(0.12, beatsToSeconds(getMidiRollSnapValue())),
    startBeat: (Number(region.startBeat) || 0) + secondsToBeats(point.seconds),
    durationBeats: Math.max(0.001, secondsToBeats(Math.max(0.12, beatsToSeconds(getMidiRollSnapValue())))),
    originalMidiNote: point.midiNote,
    editedMidiNote: point.midiNote,
    originalFrequencyHz: midiNoteToFrequency(point.midiNote),
    editedFrequencyHz: midiNoteToFrequency(point.midiNote),
    midiNote: point.midiNote,
    noteName: formatMidiNoteName(point.midiNote),
    frequencyHz: midiNoteToFrequency(point.midiNote),
    confidence: 1,
    centsOffset: 0,
    gainDb: 0,
    pitchDriftStartCents: 0,
    pitchDriftEndCents: 0,
    vibratoAmount: 0,
    source: 'manual',
    lockedToAnalysis: false,
    muted: false,
    renderStatus: 'needs_render'
  }
  region.audioEdit = normalizeAudioEdit({
    ...edit,
    pitchTrace: {
      ...edit.pitchTrace,
      enabled: true,
      status: edit.pitchTrace.status === 'idle' ? 'ready' : edit.pitchTrace.status,
      renderStatus: 'needs_render',
      renderedRuntimeId: null,
      renderedStoragePath: null,
      renderedAudioUrl: null,
      lastError: null,
      notes: [...edit.pitchTrace.notes, note]
    }
  })
  pitchTraceSelectedNoteId = id
  pitchTraceNoteDraw = { regionId: region.id, noteId: id, before, startSeconds: point.seconds, visibleDurationSeconds: point.visibleDuration }
  renderEditor()
}
function applyPitchTraceNoteDraw(event) {
  if (!pitchTraceNoteDraw) return
  const region = midiRegions.find((item)=>item.id === pitchTraceNoteDraw.regionId && item.type === 'audio')
  const point = pitchTracePointFromEvent(event)
  if (!region || !point) return
  const edit = normalizeAudioEdit(region.audioEdit)
  const start = Math.min(pitchTraceNoteDraw.startSeconds, point.seconds)
  const end = Math.max(pitchTraceNoteDraw.startSeconds + 0.03, point.seconds)
  const notes = edit.pitchTrace.notes.map((note)=>note.id === pitchTraceNoteDraw.noteId ? {
    ...note,
    startSeconds: start,
    durationSeconds: Math.max(0.03, end - start),
    startBeat: (Number(region.startBeat) || 0) + secondsToBeats(start),
    durationBeats: secondsToBeats(Math.max(0.03, end - start)),
    renderStatus: 'needs_render'
  } : note)
  region.audioEdit = normalizeAudioEdit({ ...edit, pitchTrace: { ...edit.pitchTrace, notes, renderStatus: 'needs_render' } })
  renderEditor()
}
function finishPitchTraceNoteDraw() {
  if (!pitchTraceNoteDraw) return
  const before = pitchTraceNoteDraw.before
  pitchTraceNoteDraw = null
  pushHistory('draw-pitch-trace-note', before, captureDawSnapshot())
  scheduleEditorSave()
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
function drawMidiNoteAtGridPoint(region, point) {
  if (!region || !point) return
  const rows = midiRollPitchRows(region)
  const rowIndex = clamp(Math.floor(point.y / midiRollRowHeight), 0, rows.length - 1)
  const pitch = rows[rowIndex] ?? 60
  const snap = getMidiRollSnapValue()
  const regionStart = Number(region.startBeat) || 0
  const startBeat = clamp(snapBeat(regionStart + (point.x / midiRollBeatWidth), snap), regionStart, Math.max(regionStart, Number(region.endBeat) || regionStart + snap) - 0.05)
  const before = captureDawSnapshot()
  region.notes = [...(region.notes || []), {
    id: makeInsertId('note'),
    note: pitch,
    startBeat,
    durationBeats: Math.max(0.05, snap),
    velocity: 0.85
  }]
  midiRollSelectedNoteIndex = region.notes.length - 1
  midiRollSelectedNoteIndices = [midiRollSelectedNoteIndex]
  midiRollStatus = `Drew ${formatMidiNoteName(pitch)}.`
  pushHistory('draw-midi-note', before, captureDawSnapshot())
  scheduleEditorSave()
  renderEditor()
}
function beginMidiRollSelection(event) {
  if (event.button !== 0 || event.target.closest('[data-midi-note-index]')) return
  const region = getMidiRollRegion()
  const point = getMidiRollGridPoint(event)
  if (!region || !point) return
  event.preventDefault()
  event.stopPropagation()
  if (midiRollTool === 'pencil') {
    drawMidiNoteAtGridPoint(region, point)
    return
  }
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
  app.querySelector('[data-region-editor-scroll]')?.addEventListener('scroll', () => captureAudioRegionToolsViewport(), { passive: true })
  trigger?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); setEditorMenuOpen(!isEditorMenuOpen) })
  app.querySelector('[data-toggle-file-menu]')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); isFileMenuOpen = !isFileMenuOpen; isControlsMenuOpen = false; renderEditor() })
  app.querySelector('[data-import-audio-selected-track]')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); isFileMenuOpen = false; openAudioImportPicker() })
  app.querySelector('[data-toggle-controls-menu]')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); isControlsMenuOpen = !isControlsMenuOpen; renderEditor() })
  app.querySelector('[data-musical-typing-toggle]')?.addEventListener('change', (event) => { setMusicalTypingEnabled(event.target.checked); renderEditor() })
  document.onclick = (event) => { if (event.target.closest('.studio-notes-modal') || event.target.closest('.studio-notes-panel') || event.target.closest('[data-notes-input]')) return; let changed = false; if (!event.target.closest('.studio-editor-left') && isEditorMenuOpen) { setEditorMenuOpen(false); changed = true } if (!event.target.closest('[data-file-menu]') && !event.target.closest('[data-toggle-file-menu]') && isFileMenuOpen) { isFileMenuOpen = false; changed = true } if (!event.target.closest('[data-track-menu]') && !event.target.closest('[data-track-options]') && trackMenuState) { trackMenuState = null; changed = true } if (!event.target.closest('[data-track-rename-form]') && renameTrackState) { renameTrackState = null; changed = true } if (!event.target.closest('[data-track-color-form]') && colorPickerState) { colorPickerState = null; changed = true } if (!event.target.closest('[data-midi-rename-form]') && regionRenameState) { regionRenameState = null; changed = true } if (!event.target.closest('.studio-left-panel') && !event.target.closest('[data-inspector-menu]') && inspectorMenu) { inspectorMenu = null; inspectorMenuPosition = null; changed = true } if (!event.target.closest('[data-controls-menu]') && !event.target.closest('[data-toggle-controls-menu]') && isControlsMenuOpen) { isControlsMenuOpen = false; changed = true } if (changed) renderEditor() }
  document.onkeydown = (event) => { if (event.key === 'Alt' && event.target?.closest?.('.studio-editor-page')) event.preventDefault(); if (event.key === 'Escape') { let changed = false; if (addTrackModalOpen) { addTrackModalOpen = false; changed = true } if (isEditorMenuOpen) { setEditorMenuOpen(false); changed = true } if (isControlsMenuOpen) { isControlsMenuOpen = false; changed = true } if (trackMenuState) { trackMenuState = null; changed = true } if (midiRegionMenuState) { midiRegionMenuState = null; changed = true } if (regionColorPickerState) { regionColorPickerState = null; changed = true } if (regionRenameState) { regionRenameState = null; changed = true } if (renameTrackState) { renameTrackState = null; changed = true } if (colorPickerState) { colorPickerState = null; changed = true } if (globalTrackPopover) { globalTrackPopover = null; changed = true } if (inspectorMenu) { inspectorMenu = null; inspectorMenuPosition = null; changed = true } if (changed) renderEditor() } }
  leftWrap?.addEventListener('click', (event) => event.stopPropagation())
  const page = app.querySelector('.studio-editor-page')
  page?.addEventListener('dragover', (event) => {
    if (!getFirstAudioFileFromDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    updateAudioImportPreview(event)
    scheduleAudioImportPreviewRender()
  })
  page?.addEventListener('dragenter', (event) => {
    if (!getFirstAudioFileFromDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    updateAudioImportPreview(event)
    scheduleAudioImportPreviewRender()
  })
  page?.addEventListener('drop', (event) => {
    if (!getFirstAudioFileFromDataTransfer(event.dataTransfer)) return
    event.preventDefault()
    handleAudioImportDrop(event)
  })
  page?.addEventListener('dragleave', (event) => {
    if (event.relatedTarget && page.contains(event.relatedTarget)) return
    if (!audioImportDrag) return
    audioImportDrag = null
    scheduleAudioImportPreviewRender()
  })
  app.querySelector('[data-keep-site-menu]')?.addEventListener('change', (e) => { keepSiteMenuOpen = e.target.checked; localStorage.setItem(PREF_KEY, keepSiteMenuOpen ? '1' : '0'); isEditorMenuOpen = false; renderEditor() })
  app.querySelectorAll('[data-track-row]').forEach((el) => el.addEventListener('click', () => { if (selectedTrackId !== el.dataset.trackRow) { stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback() } selectedTrackId = el.dataset.trackRow; trackMenuState = null; activeLeftPanel = 'inspector'; inspectorMenu = null; renderEditor(); warmSelectedTrackInstrument('track-select') }))
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
      rebuildTrackAudioEffectsChain(track.id)
    } else if (action === 'instrument-empty') {
      if (track.instrument?.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId)
      track.instrument = null
    } else if (action === 'instrument') {
      track.instrument = createTrackInstrument(el.dataset.insertType, track.id)
      track.type = 'software'
      track.icon = 'instrument'
    }
    inspectorMenu = null
    inspectorMenuPosition = null
    scheduleEditorSave()
    renderEditor()
  }))
  app.querySelector('[data-toggle-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; track.instrument.enabled = !track.instrument.enabled; if (!track.instrument.enabled) { stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback() } scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-remove-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); if (track.instrument.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId); track.instrument = null; scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-edit-track-instrument]')?.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track?.instrument) return; if (!track.instrument.pluginInstanceId) track.instrument.pluginInstanceId = `${track.instrument.type}:${track.id}`; dawWindowManager.openPlugin({ pluginType: track.instrument.type, trackId: track.id, instanceId: track.instrument.pluginInstanceId, params: track.instrument.params || {}, forceCenter: true }) })
  app.querySelectorAll('[data-toggle-insert]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); const list = el.dataset.toggleInsert === 'midi' ? track?.midiEffects : track?.audioEffects; const insert = list?.find((item)=>item.id===el.dataset.insertId); if (!insert) return; insert.enabled = !insert.enabled; if (el.dataset.toggleInsert === 'audio') rebuildTrackAudioEffectsChain(track.id); scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-edit-insert]').forEach((el) => el.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    const track = ensureTrackInsertState(getSelectedTrack())
    if (el.dataset.editInsert === 'audio') {
      openAudioEffectWindow(track, el.dataset.insertId)
      return
    }
    if (el.dataset.editInsert !== 'midi') return
    const insert = track?.midiEffects?.find((item)=>item.id === el.dataset.insertId)
    if (!track || !insert) return
    activeMidiEffectEditor = { trackId: track.id, insertId: insert.id }
    activeBottomPanel = 'midi-effect'
    closingBottomPanel = ''
    bottomPanelMotion = 'entering'
    renderEditor()
  }))
  app.querySelectorAll('[data-remove-insert]').forEach((el) => el.addEventListener('click', (event) => { event.stopPropagation(); const track = ensureTrackInsertState(getSelectedTrack()); if (!track) return; if (el.dataset.removeInsert === 'midi') track.midiEffects = track.midiEffects.filter((item)=>item.id!==el.dataset.insertId); if (el.dataset.removeInsert === 'audio') { dawWindowManager.closeWindow(getAudioEffectWindowInstanceId(track.id, el.dataset.insertId)); track.audioEffects = track.audioEffects.filter((item)=>item.id!==el.dataset.insertId); rebuildTrackAudioEffectsChain(track.id) } scheduleEditorSave(); renderEditor() }))
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
  app.querySelector('[data-stop-stuck-notes]')?.addEventListener('click', () => { stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback() })
  app.querySelector('[data-reset-track-audio]')?.addEventListener('click', () => { const track=getSelectedTrack(); if(!track) return; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); disposeTrackAudioChannel(track.id); if(track.instrument?.pluginInstanceId) dawInstrumentRegistry.dispose(track.instrument.pluginInstanceId); if(isSoftwareTrack(track)) ensureTrackInstrumentInstance(track); startTrackMeterLoop() })
  app.querySelector('[data-disable-track-instrument]')?.addEventListener('change', (event) => { const track=ensureTrackInsertState(getSelectedTrack()); if(!track?.instrument) return; track.instrument.enabled = !event.target.checked; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); scheduleEditorSave(); renderEditor() })
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
  app.querySelector('[data-audio-region-name]')?.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    const before = captureDawSnapshot()
    region.name = String(event.target.value || '').slice(0, 120)
    pushHistory('rename-audio-region', before, captureDawSnapshot())
    scheduleEditorSave()
    renderEditor()
  })
  app.querySelectorAll('[data-audio-edit-field]').forEach((input) => input.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region || input.disabled) return
    const value = input.type === 'checkbox' ? input.checked : input.value
    updateAudioRegionEditField(region, input.dataset.audioEditField, value)
  }))
  app.querySelector('[data-pitch-trace-enabled]')?.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    const trace = normalizeAudioEdit(region.audioEdit).pitchTrace
    setAudioRegionPitchTrace(region, {
      ...trace,
      enabled: event.target.checked,
      status: event.target.checked && trace.notes.length ? 'ready' : trace.status
    }, 'toggle-pitch-trace')
  })
  app.querySelector('[data-pitch-trace-threshold]')?.addEventListener('input', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    const edit = normalizeAudioEdit(region.audioEdit)
    region.audioEdit = normalizeAudioEdit({
      ...edit,
      pitchTrace: {
        ...edit.pitchTrace,
        confidenceThreshold: Number(event.target.value) || 0.65
      }
    })
    if (event.target.nextElementSibling) event.target.nextElementSibling.textContent = `${Math.round((Number(event.target.value) || 0.65) * 100)}%`
  })
  app.querySelector('[data-pitch-trace-threshold]')?.addEventListener('change', () => { scheduleEditorSave(); renderEditor() })
  app.querySelector('[data-pitch-trace-analyze]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (region) analyzePitchTraceForRegion(region.id)
  })
  app.querySelector('[data-pitch-trace-clear]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (!region) return
    pitchTraceSelectedNoteId = ''
    setAudioRegionPitchTrace(region, {
      enabled: true,
      status: 'idle',
      algorithm: null,
      analyzedAt: null,
      error: null,
      progress: 0,
      notes: []
    }, 'clear-pitch-trace')
  })
  app.querySelector('[data-audio-render-pitch-shift]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (region) renderAudioPitchShiftForRegion(region.id)
  })
  app.querySelector('[data-pitch-trace-render]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (region) renderPitchTraceEditsForRegion(region.id)
  })
  app.querySelectorAll('[data-pitch-trace-note]').forEach((noteEl)=>noteEl.addEventListener('pointerdown', (event) => {
    const region = getSelectedAudioRegion()
    if (region) beginPitchTraceNoteDrag(event, region.id, noteEl.dataset.pitchTraceNote)
  }))
  app.querySelectorAll('[data-pitch-trace-tool]').forEach((button)=>button.addEventListener('click', () => {
    pitchTraceTool = button.dataset.pitchTraceTool === 'pencil' ? 'pencil' : 'cursor'
    renderEditor()
  }))
  app.querySelector('[data-pitch-trace-grid]')?.addEventListener('pointerdown', beginPitchTraceNoteDraw)
  app.querySelectorAll('[data-pitch-trace-note-reset]').forEach((button)=>button.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (!region) return
    mutatePitchTraceNote(region, button.dataset.pitchTraceNoteReset, (note) => {
      note.editedMidiNote = note.originalMidiNote
      note.muted = false
    }, 'reset-pitch-trace-note')
  }))
  app.querySelectorAll('[data-pitch-trace-note-mute]').forEach((button)=>button.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (!region) return
    mutatePitchTraceNote(region, button.dataset.pitchTraceNoteMute, (note) => {
      note.muted = !note.muted
    }, 'mute-pitch-trace-note')
  }))
  app.querySelectorAll('[data-pitch-trace-note-delete]').forEach((button)=>button.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (!region) return
    const before = captureDawSnapshot()
    const edit = normalizeAudioEdit(region.audioEdit)
    region.audioEdit = normalizeAudioEdit({
      ...edit,
      pitchTrace: {
        ...edit.pitchTrace,
        notes: edit.pitchTrace.notes.filter((note)=>note.id !== button.dataset.pitchTraceNoteDelete),
        renderStatus: 'needs_render',
        renderedRuntimeId: null,
        renderedStoragePath: null,
        renderedAudioUrl: null
      }
    })
    pitchTraceSelectedNoteId = ''
    pushHistory('delete-pitch-trace-note', before, captureDawSnapshot())
    scheduleEditorSave()
    renderEditor()
  }))
  app.querySelectorAll('[data-pitch-trace-note-field]').forEach((input)=>input.addEventListener('change', () => {
    const region = getSelectedAudioRegion()
    const noteId = pitchTraceSelectedNoteId
    if (!region || !noteId) return
    mutatePitchTraceNote(region, noteId, (note) => {
      const key = input.dataset.pitchTraceNoteField
      if (key === 'editedMidiNote') note.editedMidiNote = clamp(Math.round(Number(input.value) || note.editedMidiNote), 0, 127)
      if (key === 'startSeconds') {
        note.startSeconds = Math.max(0, Number(input.value) || 0)
        note.startBeat = (Number(region.startBeat) || 0) + secondsToBeats(note.startSeconds)
      }
      if (key === 'durationSeconds') {
        note.durationSeconds = Math.max(0.03, Number(input.value) || 0.03)
        note.durationBeats = secondsToBeats(note.durationSeconds)
      }
    }, 'edit-pitch-trace-note-field')
  }))
  app.querySelector('[data-audio-stretch-enabled]')?.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    if (!event.target.checked) resetAudioRegionStretch(region)
    else enableAudioRegionStretch(region)
  })
  app.querySelector('[data-audio-stretch-speed]')?.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    const source = getAudioSourceDurationSeconds(region)
    const speed = Number(event.target.value) || 100
    updateAudioRegionStretchTarget(region, source / (speed / 100))
  })
  app.querySelector('[data-audio-stretch-length]')?.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    updateAudioRegionStretchTarget(region, Math.max(minAudioRegionSeconds, Number(event.target.value) || getAudioSourceDurationSeconds(region)))
  })
  app.querySelector('[data-audio-stretch-ratio]')?.addEventListener('change', (event) => {
    const region = getSelectedAudioRegion()
    if (!region) return
    const source = getAudioSourceDurationSeconds(region)
    updateAudioRegionStretchTarget(region, source * Math.max(0.01, Number(event.target.value) || 1))
  })
  app.querySelector('[data-audio-render-stretch]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (region) renderAudioStretchForRegion(region.id)
  })
  app.querySelector('[data-audio-render-reverse]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (region) renderAudioReverseForRegion(region.id)
  })
  app.querySelector('[data-audio-reset-stretch]')?.addEventListener('click', () => {
    const region = getSelectedAudioRegion()
    if (region) resetAudioRegionStretch(region)
  })
  app.querySelector('[data-stretch-prompt-render]')?.addEventListener('click', () => {
    const regionId = stretchPlaybackPrompt?.regionId
    stretchPlaybackPrompt = null
    if (regionId) renderAudioStretchForRegion(regionId)
  })
  app.querySelector('[data-stretch-prompt-cancel]')?.addEventListener('click', () => {
    stretchPlaybackPrompt = null
    renderEditor()
  })
  app.querySelector('[data-stretch-prompt-play-original]')?.addEventListener('click', () => {
    const regionId = stretchPlaybackPrompt?.regionId
    stretchPlaybackPrompt = null
    if (regionId) audioEditPlaybackBypassRegionIds.add(regionId)
    renderEditor()
    if (isPlaying) updateAudioClipPlayback(clampBeat(xToBeat(timelineState.playheadX)))
  })
  app.querySelector('[data-audio-edit-prompt-render]')?.addEventListener('click', () => {
    const prompt = audioEditPlaybackPrompt
    audioEditPlaybackPrompt = null
    if (!prompt?.regionId) return renderEditor()
    if (prompt.mode === 'trace') renderPitchTraceEditsForRegion(prompt.regionId)
    else if (prompt.mode === 'reverse') renderAudioReverseForRegion(prompt.regionId)
    else renderAudioPitchShiftForRegion(prompt.regionId)
  })
  app.querySelector('[data-audio-edit-prompt-original]')?.addEventListener('click', () => {
    const regionId = audioEditPlaybackPrompt?.regionId
    audioEditPlaybackPrompt = null
    if (regionId) audioEditPlaybackBypassRegionIds.add(regionId)
    renderEditor()
    if (isPlaying) updateAudioClipPlayback(clampBeat(xToBeat(timelineState.playheadX)))
  })
  app.querySelector('[data-audio-edit-prompt-cancel]')?.addEventListener('click', () => {
    audioEditPlaybackPrompt = null
    if (isPlaying) pausePlayback()
    renderEditor()
  })
  app.querySelector('[data-preflight-retry]')?.addEventListener('click', () => {
    audioPreflightRenderState = { active: false, total: 0, completed: 0, currentLabel: '', error: '', failed: [] }
    renderEditor()
    startPlayback()
  })
  app.querySelector('[data-preflight-play-original]')?.addEventListener('click', () => {
    const failed = audioPreflightRenderState.failed || []
    failed.forEach((task)=>task?.regionId && audioEditPlaybackBypassRegionIds.add(task.regionId))
    audioPreflightRenderState = { active: false, total: 0, completed: 0, currentLabel: '', error: '', failed: [] }
    renderEditor()
    startPlayback({ skipRenderAudit: true })
  })
  app.querySelector('[data-preflight-cancel]')?.addEventListener('click', () => {
    audioPreflightRenderState = { active: false, total: 0, completed: 0, currentLabel: '', error: '', failed: [] }
    recordingStatus = ''
    renderEditor()
  })
  app.querySelectorAll('[data-track-mute]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackMute); if (!t) return; t.muted = !t.muted; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-solo]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackSolo); if (!t) return; t.soloed = !t.soloed; stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-record]').forEach((el) => el.addEventListener('click', (e) => { e.stopPropagation(); const t = getTrack(el.dataset.trackRecord); if (!t) return; t.recordArmed = !t.recordArmed; scheduleEditorSave(); renderEditor() }))
  app.querySelectorAll('[data-track-volume]').forEach((el) => {
    el.addEventListener('input', () => { const t = getTrack(el.dataset.trackVolume); if (!t) return; t.volume = clamp(Number(el.value), 0, 100); setTrackChannelVolume(t) })
    el.addEventListener('change', ()=>scheduleEditorSave())
    el.addEventListener('dblclick', (event) => {
      const track = getTrack(el.dataset.trackVolume)
      if (!track) return
      openInlineNumericEditor(event, { label: 'Volume', value: track.volume, min: 0, max: 100, step: 1, apply: (value) => { track.volume = value; setTrackChannelVolume(track); scheduleEditorSave(); renderEditor() } })
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
    warmSelectedTrackInstrument('track-options')
  }))
  app.querySelector('[data-add-track]')?.addEventListener('click', (event) => { event.stopPropagation(); openAddTrackModal() })
  app.querySelector('[data-close-add-track]')?.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); closeAddTrackModal() })
  app.querySelector('[data-add-track-backdrop]')?.addEventListener('click', (event) => { if (event.target === event.currentTarget) closeAddTrackModal() })
  app.querySelectorAll('[data-create-track-type]').forEach((button)=>button.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); addTrack({ trackType: button.dataset.createTrackType === 'audio' ? 'audio' : 'software' }) }))
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
      setTrackChannelVolume(track)
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
          setTrackChannelVolume(track)
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
  grid?.addEventListener('pointerdown', (event) => { if (event.target.closest('[data-midi-region]')) return; if (event.target !== grid && !event.target.closest('[data-arrangement-grid-inner]')) return; event.preventDefault(); if (!event.shiftKey) clearRegionSelection(); midiRollSelectedNoteIndex = null; app.querySelectorAll('[data-midi-region].is-selected').forEach((node)=>node.classList.remove('is-selected')); timelineState.isSelecting = true; const rect = grid.getBoundingClientRect(); timelineState.selectionBox = { startX: event.clientX - rect.left + grid.scrollLeft, startY: event.clientY - rect.top + grid.scrollTop }; if (selectionBox) { selectionBox.style.width='0px'; selectionBox.style.height='0px'; selectionBox.style.left=`${timelineState.selectionBox.startX}px`; selectionBox.style.top=`${timelineState.selectionBox.startY}px`; selectionBox.hidden = false } })
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
    if (pitchTraceNoteDrag) {
      event.preventDefault()
      applyPitchTraceNoteDrag(event)
      return
    }
    if (pitchTraceNoteDraw) {
      event.preventDefault()
      applyPitchTraceNoteDraw(event)
      return
    }
    if (midiRegionDrag) {
      event.preventDefault()
      scheduleMidiRegionDragFrame(event)
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
    if (pitchTraceNoteDrag) {
      finishPitchTraceNoteDrag()
      return
    }
    if (pitchTraceNoteDraw) {
      finishPitchTraceNoteDraw()
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
    else startRecordFlow()
  }, { capture: true })
  app.querySelector('.studio-notes-panel')?.addEventListener('pointerdown',(e)=>e.stopPropagation()); app.querySelector('[data-notes-input]')?.addEventListener('pointerdown',(e)=>e.stopPropagation()); app.querySelectorAll('[data-notes-page],[data-add-notes-page],[data-save-notes],[data-close-notes]').forEach((el)=>el.addEventListener('pointerdown',(e)=>e.stopPropagation())); app.querySelectorAll('[data-left-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.leftPanel; activeLeftPanel = activeLeftPanel===id ? '' : id; renderEditor(); if(activeLeftPanel==='library') loadStudioLibrary() })); app.querySelector('[data-toggle-snap]')?.addEventListener('click',()=>{ isSnapEnabled=!isSnapEnabled; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-count-in]')?.addEventListener('click',()=>{ isCountInEnabled=!isCountInEnabled; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-transport-record]')?.addEventListener('click',()=>{ if (activeRecording || isCountInRunning) { stopRecordingAndKeep(); return } startRecordFlow() }); app.querySelector('[data-open-notes]')?.addEventListener('click',()=>{ isNotesOpen=true; renderEditor() }); app.querySelector('[data-close-notes]')?.addEventListener('click',()=>{ stashActiveNoteInput(); scheduleEditorSave(); isNotesOpen=false; renderEditor() }); app.querySelector('[data-save-notes]')?.addEventListener('click',()=>{ stashActiveNoteInput(); scheduleEditorSave(); isNotesOpen=false; renderEditor() }); app.querySelectorAll('[data-notes-page]').forEach((el)=>el.addEventListener('click',()=>{ stashActiveNoteInput(); activeNotePageId = el.dataset.notesPage; scheduleEditorSave(); renderEditor() })); app.querySelector('[data-add-notes-page]')?.addEventListener('click',()=>{ stashActiveNoteInput(); const pageNumber = notePages.length + 1; const id = `page-${pageNumber}`; notePages = [...notePages, { id, title: `Page ${pageNumber}`, body: '' }]; activeNotePageId = id; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-follow-playhead]')?.addEventListener('click',()=>{ followPlayhead=!followPlayhead; scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-metronome]')?.addEventListener('click',()=>{ isMetronomeEnabled=!isMetronomeEnabled; if(isMetronomeEnabled) getAudioContext(); scheduleEditorSave(); renderEditor() }); app.querySelector('[data-toggle-cycle]')?.addEventListener('click',()=>{ setCycleEnabled(!isCycleEnabled); scheduleEditorSave(); renderEditor() }); app.querySelectorAll('[data-bottom-panel]').forEach((el)=>el.addEventListener('click',()=>{ const id=el.dataset.bottomPanel; if(!id) return; openBottomPanel(id) })); app.querySelectorAll('[data-instrument-subpage]').forEach((el)=>{ el.addEventListener('click',(event)=>{ event.stopPropagation(); const next=el.dataset.instrumentSubpage; if(!next||activeInstrumentSubpage===next) return; if(activeInstrumentSubpage==='keyboard'&&next!=='keyboard') stopAllTrackInstrumentNotes(); activeInstrumentSubpage=next; renderEditor() }) })
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
    const regionToolButton = event.target.closest('[data-region-tool], [data-region-tool-action]')
    if (regionToolButton) {
      event.preventDefault()
      event.stopPropagation()
      if (regionToolButton.dataset.regionTool) setActiveRegionTool(regionToolButton.dataset.regionTool)
      else if (regionToolButton.dataset.regionToolAction) runRegionToolAction(regionToolButton.dataset.regionToolAction)
      return
    }
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
      else if (action === 'view-roll') {
        const region = midiRegions.find((item)=>item.id === regionId)
        selectSingleRegion(regionId)
        midiRollState = region?.type === 'audio' ? null : { regionId, quantize: midiRollState?.quantize || '0.25' }
        midiRollSelectedNoteIndex = null
        openBottomPanel('midi-roll')
      }
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
  app.querySelectorAll('[data-midi-roll-tool]').forEach((button)=>button.addEventListener('click', () => {
    midiRollTool = button.dataset.midiRollTool === 'pencil' ? 'pencil' : 'cursor'
    renderEditor()
  }))
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
  const pendingAudioRegionToolsViewport = captureAudioRegionToolsViewport()
  const project = projectState
  if (studioAudioEngine) studioAudioEngine.setBpm(Number(project?.bpm || 140))
  document.body.classList.add('is-studio-editor')
  Array.from(document.body.classList).forEach((className)=>{ if (className.startsWith('is-region-tool-')) document.body.classList.remove(className) })
  document.body.classList.add(`is-region-tool-${activeRegionTool}`)
  const showResonaPanel = activeBottomPanel === 'resona'
  const bottomPanelId = activeBottomPanel || closingBottomPanel
  const shouldRenderBottomPanel = Boolean(bottomPanelId && bottomPanelId !== 'resona')
  const shell = `<main class="studio-editor-page ${activeLeftPanel ? "has-left-panel" : ""} ${showResonaPanel ? 'has-resona-panel' : ''} ${keepSiteMenuOpen ? 'has-site-nav' : 'is-fullscreen'} ${globalTracks.visible ? 'has-global-tracks' : ''}" style="--studio-track-height:${timelineState.trackHeight}px"><header class="studio-editor-appbar"><div class="studio-editor-left"><button class="studio-editor-menu-button" data-editor-left-menu aria-label="Open editor menu" aria-expanded="false">☰</button><nav class="studio-editor-menu"><button type="button" data-toggle-file-menu class="${isFileMenuOpen ? 'is-active' : ''}">File</button><button>Edit</button><button>View</button><button>Track</button><button>Mix</button><button type="button" data-toggle-controls-menu class="${isControlsMenuOpen ? 'is-active' : ''}">Controls</button><button>Help</button></nav>${renderFileMenu()}${renderControlsMenu()}<aside class="studio-editor-nav-panel" hidden data-editor-nav-panel><label><input type="checkbox" data-keep-site-menu ${keepSiteMenuOpen ? 'checked' : ''}/> Keep site menu open</label><a href="${ROUTES.studio}">Back to Studio</a><a href="${ROUTES.home}">Home</a><a href="${ROUTES.products}">Products</a><a href="${ROUTES.community}">Community</a><a href="${ROUTES.profile}">Profile</a></aside></div><div class="studio-editor-title">${project.title}<small data-editor-status>${isCountInRunning ? `Count-in: ${countInBeatsRemaining}` : (recordingStatus || 'Project loaded')}</small></div><div class="studio-editor-right"><button>Invite</button><button disabled>Export</button></div></header><section class="studio-editor-transport"><div class="studio-tool-group studio-tool-group--left"><button data-left-panel="library" class="studio-tool-button ${activeLeftPanel==='library'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='library')}" data-tooltip="Library">${toolIcon('library')}</button><button data-left-panel="inspector" class="studio-tool-button ${activeLeftPanel==='inspector'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='inspector')}" data-tooltip="Inspector">${toolIcon('inspector')}</button><button data-open-notes class="studio-tool-button ${isNotesOpen ? 'is-active' : ''}" aria-pressed="${String(isNotesOpen)}" data-tooltip="Notes">${toolIcon('notes')}</button><button data-left-panel="smart-controls" class="studio-tool-button ${activeLeftPanel==='smart-controls'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='smart-controls')}" data-tooltip="Smart Controls">${toolIcon('sliders')}</button><button data-left-panel="loop-browser" class="studio-tool-button ${activeLeftPanel==='loop-browser'?'is-active':''}" aria-pressed="${String(activeLeftPanel==='loop-browser')}" data-tooltip="Loop Browser">${toolIcon('store')}</button></div><div class="studio-transport-center"><div class="studio-tool-group studio-tool-group--transport"><button data-transport-start class="studio-tool-button" aria-label="Go to start" data-tooltip="Go to start">${toolIcon('start')}</button> <button data-transport-rewind class="studio-tool-button" aria-label="Rewind" data-tooltip="Rewind">${toolIcon('rewind')}</button> <button data-transport-play class="studio-tool-button ${isPlaying ? 'is-active' : ''} ${activeRecording || isCountInRunning ? 'is-disabled' : ''}" ${activeRecording || isCountInRunning ? 'disabled' : ''} aria-label="${isPlaying ? 'Pause' : 'Play'}" data-tooltip="${isPlaying ? 'Pause' : 'Play'}" aria-pressed="${isPlaying}">${isPlaying ? '<svg viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\"><path d=\"M8 5v14M16 5v14\"/></svg>' : toolIcon('play')}</button> <button data-transport-stop class="studio-tool-button" aria-label="Stop" data-tooltip="Stop">${toolIcon('stop')}</button> <button data-transport-record class="studio-tool-button ${activeRecording || isCountInRunning ? 'is-active' : ''}" aria-label="Record" data-tooltip="Record">${toolIcon('record')}</button> <button data-transport-forward class="studio-tool-button" aria-label="Fast forward" data-tooltip="Fast forward">${toolIcon('forward')}</button> <button data-transport-end class="studio-tool-button" aria-label="Go to end" data-tooltip="Go to end">${toolIcon('end')}</button> <button data-toggle-cycle class="studio-tool-button studio-tool-button--cycle ${isCycleEnabled ? 'is-active' : ''}" aria-label="Cycle" aria-pressed="${String(isCycleEnabled)}" data-tooltip="Cycle">${toolIcon('loop')}</button></div><div class="studio-logic-display" aria-label="Project transport display"><section class="studio-logic-section studio-logic-section--time"><strong class="studio-logic-primary" data-display-time>${formatTimeFromPlayhead()}</strong><span class="studio-logic-secondary">time</span></section><section class="studio-logic-section studio-logic-section--bars"><strong class="studio-logic-primary" data-display-bars>${formatBarsFromPlayhead()}</strong><span class="studio-logic-secondary">bar beat div tick</span></section><section class="studio-logic-section studio-logic-section--tempo"><strong class="studio-logic-primary">${Number(project.bpm || 140).toFixed(4)}</strong><span class="studio-logic-secondary">4/4 <button class="studio-display-icon-button" aria-label="Tempo settings" data-tooltip="Tempo settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/></svg></button></span></section><section class="studio-logic-section studio-logic-section--key"><strong class="studio-logic-primary">${project.key}</strong><span class="studio-logic-secondary">key</span></section><section class="studio-logic-section studio-logic-section--midi"><strong class="studio-logic-primary" data-midi-status>No MIDI</strong><span class="studio-logic-secondary">input</span></section><section class="studio-logic-section studio-logic-section--cpu"><strong class="studio-logic-primary">0%</strong><span class="studio-logic-secondary">CPU</span></section></div><div class="studio-tool-group studio-tool-group--utilities"><button data-toggle-metronome class="studio-tool-button ${isMetronomeEnabled ? 'is-active' : ''}" aria-label="Metronome" aria-pressed="${String(isMetronomeEnabled)}" data-tooltip="Metronome">${toolIcon('metro')}</button><button data-toggle-count-in class="studio-tool-button studio-tool-button--count-in ${isCountInEnabled ? 'is-active' : ''}" aria-label="Count-in" aria-pressed="${String(isCountInEnabled)}" data-tooltip="Count-in">${toolIcon('count')}</button><button data-toggle-snap class="studio-tool-button ${isSnapEnabled ? 'is-active' : ''}" aria-label="Snap" aria-pressed="${String(isSnapEnabled)}" data-tooltip="Snap">${toolIcon('snap')}</button><button data-toggle-follow-playhead class="studio-tool-button ${followPlayhead ? 'is-active' : ''}" aria-label="Follow Playhead" aria-pressed="${String(followPlayhead)}" data-tooltip="Follow Playhead"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="7"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/></svg></button></div></div><div class="studio-transport-spacer" aria-hidden="true"></div></section><div class="studio-editor-workspace">${activeLeftPanel ? renderLeftPanel() : ""}<aside class="studio-track-panel">${renderTrackToolbar()}${renderGlobalTrackLabels()}<div class="studio-track-list">${tracks.map(renderTrackCard).join('')}</div></aside><section class="studio-arrangement ${globalTracks.visible ? 'has-global-tracks' : ''}" data-arrangement style="--bars: ${timelineState.bars}; --beats-per-bar: ${timelineState.beatsPerBar}; --pixels-per-bar: ${timelineState.pixelsPerBar}px; --pixels-per-beat: ${timelineState.pixelsPerBar / timelineState.beatsPerBar}px; --playhead-x: ${timelineState.playheadX}px; --timeline-content-width: ${timelineContentWidth()}px;"><div class="studio-timeline-ruler" data-timeline-ruler><div class="studio-timeline-ruler-inner" data-timeline-ruler-inner><div class="studio-cycle-strip" data-cycle-strip>${renderCycleRange()}</div><span class="studio-negative-zone studio-negative-zone--ruler" style="width:${barZeroX()}px"></span>${renderTimelineRuler()}<span class="studio-ruler-playhead" data-ruler-playhead></span></div></div>${renderGlobalTrackLane()}<div class="studio-arrangement-grid" data-arrangement-grid><div class="studio-arrangement-grid-inner" data-arrangement-grid-inner><span class="studio-negative-zone studio-negative-zone--grid" style="width:${barZeroX()}px"></span>${renderTimelineLines()}${renderTimelineRegions()}${renderCycleBoundaryGuides()}${renderAudioImportPreview()}<span class="studio-grid-playhead" data-grid-playhead></span><div class="studio-selection-box" data-selection-box hidden></div></div></div><div class="studio-timeline-extension-lane" data-timeline-extension-lane><div class="studio-timeline-extension-lane-inner" data-timeline-extension-inner><button class="studio-timeline-extension-handle studio-timeline-extension-handle--left" data-timeline-extension-handle="left" aria-label="Adjust timeline start"></button><button class="studio-timeline-extension-handle studio-timeline-extension-handle--right" data-timeline-extension-handle="right" aria-label="Adjust timeline end"></button></div></div></section>${showResonaPanel ? renderStudioResonaPanel() : ''}<aside class="studio-right-rail"><button data-bottom-panel="loops" class="${activeBottomPanel==='loops' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='loops')}">Loops</button><button data-bottom-panel="mixer" class="${activeBottomPanel==='mixer' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='mixer')}">Mixer</button><button data-bottom-panel="collab" class="${activeBottomPanel==='collab' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='collab')}">Collab</button><button data-bottom-panel="midi-roll" class="${activeBottomPanel==='midi-roll' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='midi-roll')}">Region Editor</button><button data-bottom-panel="instrument" class="${activeBottomPanel==='instrument' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='instrument')}">Instrument</button><button data-bottom-panel="resona" class="${activeBottomPanel==='resona' ? 'is-active' : ''}" aria-pressed="${String(activeBottomPanel==='resona')}">Resona</button>${activeBottomPanel==='instrument'?`<div class="studio-right-rail-divider"></div><div class="studio-right-rail-subtools" data-instrument-subtools>${instrumentSubpages.map((page)=>`<button class="studio-right-rail-subtool is-enabled ${activeInstrumentSubpage===page.id?'is-active':''}" data-instrument-subpage="${page.id}" aria-pressed="${String(activeInstrumentSubpage===page.id)}" type="button">${page.label}</button>`).join('')}</div>`:''}</aside></div>${shouldRenderBottomPanel ? renderBottomPanel(bottomPanelId, bottomPanelMotion==='entering'?'is-bottom-panel-entering':(bottomPanelMotion==='exiting'?'is-bottom-panel-exiting':'')) : ''}<section class="studio-effects-panel" hidden></section><footer class="studio-editor-footer"><span>Output</span><span>${project.bpm} BPM</span><span>${project.key}</span><span>4/4</span><span>Help</span><span class="studio-footer-save-status" data-save-status>${saveStatus}</span></footer><div class="studio-tooltip-layer" data-studio-tooltip hidden></div>${renderTrackContextMenu()}${renderMidiRegionContextMenu()}${renderMidiRegionColorPopover()}${renderMidiRegionRenamePopover()}${renderTrackRenamePopover()}${renderTrackColorPopover()}${renderGlobalTrackPopover()}${renderNotesModal()}${renderAddTrackModal()}</main>`
  app.innerHTML = `${keepSiteMenuOpen ? navShell({ currentPage: 'studio' }) : ''}${shell}`
  initShellChrome()
  app.querySelector('.studio-right-rail [data-bottom-panel="resona"]')?.insertAdjacentHTML('afterend', renderRegionToolRail())
  app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', dawWindowManager.renderWindows())
  const audioRenderModal = renderAudioStretchRenderModal()
  if (audioRenderModal) app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', audioRenderModal)
  const audioPitchRenderModal = renderAudioPitchRenderModal()
  if (audioPitchRenderModal) app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', audioPitchRenderModal)
  const audioPreflightModal = renderAudioPreflightRenderModal()
  if (audioPreflightModal) app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', audioPreflightModal)
  const stretchPromptModal = renderStretchPlaybackPrompt()
  if (stretchPromptModal) app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', stretchPromptModal)
  const audioEditPromptModal = renderAudioEditPlaybackPrompt()
  if (audioEditPromptModal) app.querySelector('.studio-editor-page')?.insertAdjacentHTML('beforeend', audioEditPromptModal)
  applyStudioGuideTargets()
  setEditorMenuOpen(isEditorMenuOpen)
  bindEditorEvents()
  dawWindowManager.bind(app)
  restoreMidiRollViewport()
  restoreAudioRegionToolsViewport(pendingAudioRegionToolsViewport)
  mountStudioResonaPanel()
  applyStudioGuideTargets()
  updateTransportPlaybackUI()
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
    if(event.code === 'KeyC'){
      event.preventDefault()
      copyMidiRegion()
      return
    }
    if(event.code === 'KeyV'){
      event.preventDefault()
      pasteMidiRegion()
      return
    }
    if(event.code === 'KeyX'){
      event.preventDefault()
      copyMidiRegion()
      deleteMidiRegion()
      return
    }
    if(event.code === 'KeyD'){
      event.preventDefault()
      duplicateSelectedRegions()
      return
    }
    return
  }
  if(event.altKey && !['ArrowLeft','ArrowRight'].includes(event.code)) return
  if(event.code==='Space'){handleSpaceTransport(event); return}
  if(event.code==='KeyR'){
    event.preventDefault()
    if(activeRecording || isCountInRunning) stopRecordingAndKeep()
    else startRecordFlow()
    return
  }
  if (handleMusicalTypingKeydown(event)) return
  if(activeRecording || isCountInRunning){
    if(['Enter','ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','KeyC','KeyK'].includes(event.code)) event.preventDefault()
    return
  }
  if(event.code==='Delete'||event.code==='Backspace'){event.preventDefault(); if(activeBottomPanel==='midi-roll'&&deleteSelectedMidiNote()) return; if(selectedMidiRegionId) deleteMidiRegion(selectedMidiRegionId)}
  else if(event.code==='Escape'){event.preventDefault(); activeRegionTool='select'; clearRegionSelection(); renderEditor()}
  else if(event.code==='KeyV'||event.code==='Digit1'){event.preventDefault(); setActiveRegionTool('select')}
  else if(event.code==='KeyS'||event.code==='Digit3'){event.preventDefault(); setActiveRegionTool('split')}
  else if(event.code==='KeyE'||event.code==='Digit4'){event.preventDefault(); setActiveRegionTool('erase')}
  else if(event.code==='KeyM'){event.preventDefault(); toggleSelectedRegionMute()}
  else if(event.code==='KeyL'){event.preventDefault(); loopSelectedRegions()}
  else if(event.code==='Enter'){event.preventDefault();setPlayhead(barZeroX());scheduleEditorSave();lastMetronomeBeat=-1}
  else if(event.code==='ArrowLeft'){event.preventDefault();setPlayhead(beatToX(movePlayheadByKeyboard({ currentBeat: xToBeat(timelineState.playheadX), direction: -1, event })));scheduleEditorSave()}
  else if(event.code==='ArrowRight'){event.preventDefault();setPlayhead(beatToX(movePlayheadByKeyboard({ currentBeat: xToBeat(timelineState.playheadX), direction: 1, event })));scheduleEditorSave()}
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
if(!window.__melogicDawInstrumentCleanupBound){ window.__melogicDawInstrumentCleanupBound=true; window.addEventListener('beforeunload',(event)=>{ if(activeRecording){ event.preventDefault(); event.returnValue='Recording is in progress. Are you sure you want to leave?' } try { pitchTraceAnalysis.worker?.terminate?.() } catch {} cleanupPendingAudioInputStream(); cleanupAudioRecordingController(); stopAllTrackInstrumentNotes(); stopAllPlaybackNotes(); stopAllAudioClipPlayback(); dawInstrumentRegistry.disposeAll(); dawWindowManager.destroy() }) }

async function init() { renderState('Loading project...'); const user = await waitForInitialAuthState(); if (!user) return renderState('Sign in required for Studio.', authRoute({ redirect: window.location.pathname })); const id = projectIdFromPath(); if (!id || reserved.has(id)) return renderState('Studio project not found.'); const project = await getStudioProject(id); if (!project) return renderState('Studio project not found.'); if (!(user.uid === project.ownerId || (project.collaboratorIds || []).includes(user.uid))) return renderState('You do not have access to this Studio project.'); touchStudioProject(project.id).catch(() => {}); projectState = project; if (projectState.editorState) applyLoadedEditorState(projectState.editorState); ensureDefaultCycleRange(); isEditorLoaded = true; renderEditor(); preloadSouraWasmDsp().then(()=>renderEditor()).catch((err)=>{ console.error('[soura-dsp] preload failed', err); renderEditor() }); warmSelectedTrackInstrument('project-open'); hydrateProjectAudioAssets().catch((err)=>console.warn('[studioProject] audio hydration failed', err)) }
init()
