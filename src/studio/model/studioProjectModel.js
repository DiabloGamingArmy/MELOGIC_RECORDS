const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d)
const clamp = (v, min, max) => Math.min(max, Math.max(min, v))
const pitchTraceVersion = 'pitch-trace-v1'
const pitchRenderStatuses = ['idle', 'rendering', 'ready', 'failed', 'needs_render']
const noteNames = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']

function midiToName(midi = 60) {
  const note = Math.round(num(midi, 60))
  const pitch = ((note % 12) + 12) % 12
  const octave = Math.floor(note / 12) - 1
  return `${noteNames[pitch]}${octave}`
}

function midiToFrequency(midi = 60) {
  return Number((440 * (2 ** ((num(midi, 60) - 69) / 12))).toFixed(3))
}

function makeId(prefix) {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

export function normalizeTrackType(type) {
  return type === 'audio' ? 'audio' : 'software'
}

export function createTrackModel(input = {}) {
  return {
    id: String(input.id || makeId('track')),
    name: String(input.name || 'Track'),
    type: normalizeTrackType(input.type),
    muted: !!input.muted,
    soloed: !!input.soloed
  }
}

export function normalizeMidiNote(note = {}) {
  return {
    id: String(note.id || makeId('note')),
    pitch: clamp(Math.round(num(note.pitch, 60)), 0, 127),
    startBeat: num(note.startBeat, 0),
    durationBeats: Math.max(0.0001, num(note.durationBeats, 1)),
    velocity: clamp(num(note.velocity, 0.8), 0, 1)
  }
}

function normalizePitchTrace(trace = {}, legacyFlexFollow = 'off') {
  const source = trace && typeof trace === 'object' ? trace : {}
  const notes = Array.isArray(source.notes)
    ? source.notes.slice(0, 512).map((note, index) => {
      const originalMidiNote = clamp(Math.round(num(note?.originalMidiNote ?? note?.midiNote, 60)), 0, 127)
      const editedMidiNote = clamp(Math.round(num(note?.editedMidiNote ?? note?.midiNote ?? originalMidiNote, originalMidiNote)), 0, 127)
      return {
        id: String(note?.id || `pt-${index + 1}`),
        startSeconds: Math.max(0, num(note?.startSeconds, 0)),
        durationSeconds: Math.max(0.01, num(note?.durationSeconds, 0.01)),
        startBeat: Math.max(0, num(note?.startBeat, 0)),
        durationBeats: Math.max(0.001, num(note?.durationBeats, 0.001)),
        originalMidiNote,
        editedMidiNote,
        midiNote: editedMidiNote,
        noteName: midiToName(editedMidiNote),
        originalFrequencyHz: Math.max(0, num(note?.originalFrequencyHz ?? note?.frequencyHz, midiToFrequency(originalMidiNote))),
        editedFrequencyHz: Math.max(0, num(note?.editedFrequencyHz, midiToFrequency(editedMidiNote))),
        frequencyHz: Math.max(0, num(note?.editedFrequencyHz ?? note?.frequencyHz, midiToFrequency(editedMidiNote))),
        confidence: clamp(num(note?.confidence, 0), 0, 1),
        centsOffset: clamp(num(note?.centsOffset, 0), -50, 50),
        gainDb: clamp(num(note?.gainDb, 0), -24, 24),
        pitchDriftStartCents: clamp(num(note?.pitchDriftStartCents, 0), -1200, 1200),
        pitchDriftEndCents: clamp(num(note?.pitchDriftEndCents, 0), -1200, 1200),
        vibratoAmount: clamp(num(note?.vibratoAmount, 0), 0, 1),
        muted: note?.muted === true,
        renderStatus: pitchRenderStatuses.includes(note?.renderStatus) ? note.renderStatus : (editedMidiNote !== originalMidiNote ? 'needs_render' : 'idle')
      }
    })
    : []
  const status = ['idle', 'analyzing', 'ready', 'failed'].includes(source.status) ? source.status : 'idle'
  const hasEditedNotes = notes.some((note) => note.muted === true || note.editedMidiNote !== note.originalMidiNote || Math.abs(num(note.gainDb, 0)) > 0.001)
  const priorRenderStatus = pitchRenderStatuses.includes(source.renderStatus) ? source.renderStatus : 'idle'
  return {
    enabled: source.enabled === true || legacyFlexFollow === 'on',
    status: status === 'analyzing' ? 'idle' : (notes.length && status === 'idle' ? 'ready' : status),
    algorithm: source.algorithm || (notes.length ? 'yin-js-worker-v1' : null),
    analysisVersion: source.analysisVersion || pitchTraceVersion,
    analyzedAt: source.analyzedAt == null ? null : num(source.analyzedAt, 0),
    confidenceThreshold: clamp(num(source.confidenceThreshold, 0.65), 0.1, 0.98),
    progress: 0,
    error: source.error || null,
    renderStatus: hasEditedNotes && priorRenderStatus === 'idle' ? 'needs_render' : priorRenderStatus,
    renderedStoragePath: source.renderedStoragePath || null,
    renderedAudioUrl: source.renderedAudioUrl || null,
    renderedRuntimeId: source.renderedRuntimeId || null,
    renderedDurationSeconds: source.renderedDurationSeconds == null ? null : Math.max(0, num(source.renderedDurationSeconds, 0)),
    renderAlgorithm: source.renderAlgorithm || null,
    preservesDuration: source.preservesDuration !== false,
    lastError: source.lastError || null,
    renderedAt: source.renderedAt == null ? null : num(source.renderedAt, 0),
    notes
  }
}

function normalizePitchShift(pitchShift = {}, transposeSemitones = 0, fineTuneCents = 0) {
  const source = pitchShift && typeof pitchShift === 'object' ? pitchShift : {}
  const transpose = clamp(num(transposeSemitones, 0), -48, 48)
  const fine = clamp(num(fineTuneCents, 0), -100, 100)
  const totalSemitones = transpose + (fine / 100)
  const priorStatus = pitchRenderStatuses.includes(source.renderStatus) ? source.renderStatus : 'idle'
  const sourceTotal = Number.isFinite(Number(source.totalSemitones)) ? Number(source.totalSemitones) : totalSemitones
  const renderStatus = Math.abs(totalSemitones) <= 0.001
    ? 'idle'
    : (priorStatus === 'ready' && Math.abs(sourceTotal - totalSemitones) > 0.001 ? 'needs_render' : priorStatus === 'idle' ? 'needs_render' : priorStatus)
  return {
    enabled: Math.abs(totalSemitones) > 0.001 || source.enabled === true,
    transposeSemitones: transpose,
    fineTuneCents: fine,
    totalSemitones,
    renderStatus,
    renderedStoragePath: source.renderedStoragePath || null,
    renderedAudioUrl: source.renderedAudioUrl || null,
    renderedRuntimeId: source.renderedRuntimeId || null,
    renderedDurationSeconds: source.renderedDurationSeconds == null ? null : Math.max(0, num(source.renderedDurationSeconds, 0)),
    algorithm: source.algorithm || null,
    preservesDuration: source.preservesDuration !== false,
    lastError: source.lastError || null,
    renderedAt: source.renderedAt == null ? null : num(source.renderedAt, 0)
  }
}

function normalizeReverseEdit(reverse = {}, legacyStatus = 'idle', legacyStoragePath = null) {
  const source = reverse && typeof reverse === 'object' ? reverse : {}
  const enabled = reverse === true || source.enabled === true
  const statusValue = source.renderStatus || legacyStatus
  return {
    enabled,
    renderStatus: pitchRenderStatuses.includes(statusValue) ? statusValue : (enabled ? 'needs_render' : 'idle'),
    renderedStoragePath: source.renderedStoragePath || legacyStoragePath || null,
    renderedAudioUrl: source.renderedAudioUrl || null,
    renderedRuntimeId: source.renderedRuntimeId || null,
    renderedDurationSeconds: source.renderedDurationSeconds == null ? null : Math.max(0, num(source.renderedDurationSeconds, 0)),
    algorithm: source.algorithm || null,
    lastError: source.lastError || null,
    renderedAt: source.renderedAt == null ? null : num(source.renderedAt, 0)
  }
}

export function normalizeRegion(region = {}) {
  const type = region.type === 'audio' ? 'audio' : 'midi'
  const fileDurationSeconds = Math.max(0, num(region.fileDurationSeconds ?? region.audioClip?.fileDurationSeconds ?? region.durationSeconds, 0))
  const trimStartSeconds = clamp(num(region.trimStartSeconds, 0), 0, Math.max(0, fileDurationSeconds))
  const trimEndSeconds = region.trimEndSeconds == null ? null : clamp(num(region.trimEndSeconds, fileDurationSeconds), trimStartSeconds, Math.max(trimStartSeconds, fileDurationSeconds))
  const stretchRatio = clamp(num(region.stretch?.lengthRatio ?? region.stretch?.ratio, 1), 0.01, 32)
  const lengthRatio = stretchRatio
  const renderStatus = ['idle', 'rendering', 'ready', 'failed', 'needs_render', 'none'].includes(region.stretch?.renderStatus) ? (region.stretch.renderStatus === 'none' ? 'idle' : region.stretch.renderStatus) : 'idle'
  return {
    id: String(region.id || makeId('region')),
    trackId: String(region.trackId || 'demo-track'),
    type,
    startBeat: num(region.startBeat, 0),
    durationBeats: Math.max(0.0001, num(region.durationBeats, 4)),
    endBeat: Math.max(num(region.startBeat, 0), num(region.endBeat, num(region.startBeat, 0) + num(region.durationBeats, 4))),
    timelineStartBeats: num(region.timelineStartBeats, num(region.startBeat, 0)),
    timelineStartSeconds: num(region.timelineStartSeconds, 0),
    transportBpm: num(region.transportBpm, 140),
    projectSampleRate: num(region.projectSampleRate, 44100),
    audioContextSampleRate: num(region.audioContextSampleRate, 44100),
    recordingStartedAtAudioContextTime: num(region.recordingStartedAtAudioContextTime, 0),
    recordingStartedAtPerformanceTime: num(region.recordingStartedAtPerformanceTime, 0),
    mediaRecorderStartedAt: num(region.mediaRecorderStartedAt, 0),
    sourceLatencyCompensationSeconds: num(region.sourceLatencyCompensationSeconds, 0),
    durationSeconds: Math.max(0, num(region.durationSeconds, 0)),
    fileDurationSeconds,
    offsetSeconds: Math.max(0, num(region.offsetSeconds, 0)),
    trimStartSeconds,
    trimEndSeconds,
    visibleDurationSeconds: Math.max(0, num(region.visibleDurationSeconds, region.durationSeconds || 0)),
    playbackRate: Math.max(0.05, num(region.playbackRate, 1)),
    stretch: {
      enabled: !!region.stretch?.enabled,
      ratio: stretchRatio,
      lengthRatio,
      speedPercent: 100 / Math.max(0.001, lengthRatio),
      targetDurationSeconds: region.stretch?.targetDurationSeconds == null ? null : Math.max(0.0001, num(region.stretch.targetDurationSeconds, 0)),
      mode: String(region.stretch?.mode || 'none'),
      algorithm: String(region.stretch?.algorithm || (region.stretch?.enabled ? 'wsola_phase_vocoder_v1' : 'none')),
      preservesPitch: !!region.stretch?.preservesPitch,
      renderedObjectUrl: null,
      renderedAudioUrl: region.stretch?.renderedAudioUrl || null,
      renderedStoragePath: region.stretch?.renderedStoragePath || null,
      renderedRuntimeId: region.stretch?.renderedRuntimeId || null,
      renderedDurationSeconds: region.stretch?.renderedDurationSeconds == null ? null : Math.max(0, num(region.stretch.renderedDurationSeconds, 0)),
      renderedAt: region.stretch?.renderedAt == null ? null : num(region.stretch.renderedAt, 0),
      renderedSessionOnly: region.stretch?.renderedSessionOnly === true,
      renderStatus,
      renderError: region.stretch?.renderError || null
    },
    audioEdit: type === 'audio'
      ? {
        mute: region.audioEdit?.mute === true,
        loop: region.audioEdit?.loop === true,
        quantize: String(region.audioEdit?.quantize || 'off'),
        qSwing: clamp(num(region.audioEdit?.qSwing, 0), 0, 100),
        qRange: region.audioEdit?.qRange == null ? null : num(region.audioEdit.qRange, 0),
        qStrength: clamp(num(region.audioEdit?.qStrength, 100), 0, 100),
        transposeSemitones: clamp(num(region.audioEdit?.transposeSemitones, 0), -48, 48),
        fineTuneCents: clamp(num(region.audioEdit?.fineTuneCents, 0), -100, 100),
        pitchShift: normalizePitchShift(region.audioEdit?.pitchShift, region.audioEdit?.transposeSemitones, region.audioEdit?.fineTuneCents),
        pitchSource: String(region.audioEdit?.pitchSource || 'off'),
        pitchTrace: normalizePitchTrace(region.audioEdit?.pitchTrace, region.audioEdit?.flexFollow === 'on' ? 'on' : 'off'),
        gainDb: clamp(num(region.audioEdit?.gainDb, 0), -24, 24),
        delayMs: clamp(num(region.audioEdit?.delayMs, 0), 0, 2000),
        fadeInSeconds: Math.max(0, num(region.audioEdit?.fadeInSeconds, 0)),
        fadeInCurve: String(region.audioEdit?.fadeInCurve || 'linear'),
        fadeOutSeconds: Math.max(0, num(region.audioEdit?.fadeOutSeconds, 0)),
        fadeOutCurve: String(region.audioEdit?.fadeOutCurve || 'linear'),
        reverse: normalizeReverseEdit(region.audioEdit?.reverse, region.audioEdit?.reverseRenderStatus, region.audioEdit?.reverseRenderedStoragePath)
      }
      : null,
    sourceHash: region.sourceHash ?? null,
    audioClip: type === 'audio' && region.audioClip && typeof region.audioClip === 'object'
      ? {
        ...region.audioClip,
        storagePath: region.audioClip.storagePath || null,
        downloadUrl: region.audioClip.downloadUrl || null,
        sessionOnly: region.audioClip.storagePath || region.audioClip.downloadUrl ? false : region.audioClip.sessionOnly !== false,
        missingAfterReload: region.audioClip.storagePath || region.audioClip.downloadUrl ? false : region.audioClip.missingAfterReload !== false,
        offlineReason: region.audioClip.storagePath || region.audioClip.downloadUrl ? null : (region.audioClip.offlineReason || 'missing_storage_path')
      }
      : null,
    waveform: type === 'audio' && region.waveform && typeof region.waveform === 'object'
      ? {
        ...region.waveform,
        peaks: Array.isArray(region.waveform.peaks)
          ? region.waveform.peaks.slice(0, 1200).map((peak) => peak && typeof peak === 'object'
            ? { min: clamp(num(peak.min, 0), -1, 1), max: clamp(num(peak.max, 0), -1, 1), rms: clamp(num(peak.rms, 0), 0, 1) }
            : clamp(num(peak, 0), 0, 1))
          : []
      }
      : null,
    gain: clamp(num(region.gain, 1), 0, 2),
    pan: clamp(num(region.pan, 0), -1, 1),
    muted: !!region.muted,
    notes: type === 'midi' ? (Array.isArray(region.notes) ? region.notes.map(normalizeMidiNote) : []) : []
  }
}

export function createAudioRegion(input = {}) { return normalizeRegion({ ...input, type: 'audio' }) }
export function createMidiRegion(input = {}) { return normalizeRegion({ ...input, type: 'midi' }) }
export function createMidiNote(input = {}) { return normalizeMidiNote(input) }

export function createEmptyStudioProjectModel() {
  return { version: 1, bpm: 140, beatsPerBar: 4, tracks: [], regions: [] }
}

export function normalizeStudioProjectModel(model = {}) {
  const base = model && typeof model === 'object' ? model : {}
  return {
    version: 1,
    bpm: Math.max(1, num(base.bpm, 140)),
    beatsPerBar: Math.max(1, Math.round(num(base.beatsPerBar, 4))),
    tracks: Array.isArray(base.tracks) ? base.tracks.map(createTrackModel) : [],
    regions: Array.isArray(base.regions) ? base.regions.map(normalizeRegion).sort((a, b) => a.startBeat - b.startBeat) : []
  }
}
