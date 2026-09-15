import fs from 'node:fs'
import vm from 'node:vm'
import * as portable from '../../src/studio/portability/portableTrackRender.js'
import { normalizeScoreDocument } from '../../src/studio/score/scoreDocument.js'
import { normalizeNoteNotation, normalizeRegionScore } from '../../src/studio/score/scoreModel.js'
export const source = fs.readFileSync(new URL('../../src/studioProject.js', import.meta.url), 'utf8')
export function section(start, end) { return source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start))) }
export function persistenceHarness(extra = {}) {
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  const context = vm.createContext({
    ...portable, normalizeScoreDocument, normalizeNoteNotation, normalizeRegionScore,
    scoreDocument: normalizeScoreDocument(),
    timelineState: { bars: 32, beatsPerBar: 4, positiveBeats: 128, pixelsPerBar: 120, preStartPixels: 120, playheadX: 120, trackHeight: 80 },
    globalTracks: { tempoEvents: [{ beat: 0, bpm: 123.456 }], timeSignatureEvents: [{ beat: 0, numerator: 7, denominator: 8 }], keySignatureEvents: [{ beat: 0, root: 'D', scale: 'minor' }] },
    projectState: { id: 'project', title: 'Round trip', bpm: 123.456, settings: {} },
    tracks: [{ id: 'demo-track', type: 'software', name: 'Demo Track' }], midiRegions: [],
    selectedTrackId: 'demo-track', cycleRange: null, notePages: [], activeNotePageId: '',
    followPlayhead: false, isMetronomeEnabled: false, isCountInEnabled: false, isSnapEnabled: true, isCycleEnabled: false,
    metronomeSettings: {}, GLOBAL_TRACK_VIEW_OPTIONS: [{ value: 'all' }],
    deepClone: copy, clamp: (v, a, b) => Math.min(b, Math.max(a, v)),
    clampTimelinePixelsPerBar: v => v, beatWidth: () => 30, ensureDefaultCycleRange() {},
    normalizeCpuAlerts: copy, getProjectCpuAlerts: () => ({ enabled: true, thresholdPercent: 80 }),
    ensureCanonicalGlobalTracks() {}, getTempoAtBeat: (_, events) => events[0], getTimeSignatureAtBeat: (_, events) => events[0], getKeySignatureAtBeat: (_, events) => events[0],
    formatKeySignature: v => `${v.root} ${v.scale}`, formatTimeSignature: v => `${v.numerator}/${v.denominator}`,
    normalizeMetronomeSettings: v => copy(v || {}), normalizeTrackType: v => v === 'audio' ? 'audio' : 'software',
    ensureTrackInsertState: t => { t.midiEffects ||= []; t.audioEffects ||= [] },
    nextTrackColor: () => ({ color: '#fff', colorSoft: '#aaa' }), serializeAudioEffects: v => copy(v || []),
    // Audio normalization is exercised separately; these preserve region payloads
    // while the real editor serializer/load handlers and portable codec run here.
    cloneRegionForState: copy, normalizeLoadedRegion: copy,
    ...extra
  })
  vm.runInContext(section('function serializeTrackForEditorState(', 'function updateEditorSaveStatus('), context)
  return context
}
