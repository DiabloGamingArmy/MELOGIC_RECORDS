import {
  audioBufferToWavBlob,
  createAudioBuffer,
  createRenderedAudioMetadata,
  normalizeWavBitDepth
} from '../audioStretchRenderService.js'
import {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  SOURA_AUDIO_DSP_ENGINE_TYPE,
  SOURA_AUDIO_DSP_OPERATIONS
} from './audioDspTypes.js'
import { renderWithSouraWasmDsp } from './wasm/souraWasmDspClient.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function copyAudioRange(audioBuffer, startSeconds = 0, endSeconds = null) {
  const sampleRate = audioBuffer.sampleRate || 44100
  const startSample = clamp(Math.floor(Math.max(0, startSeconds) * sampleRate), 0, audioBuffer.length)
  const resolvedEndSeconds = endSeconds == null ? audioBuffer.duration : Math.max(startSeconds + 0.001, Number(endSeconds) || audioBuffer.duration)
  const endSample = clamp(Math.ceil(resolvedEndSeconds * sampleRate), startSample + 1, audioBuffer.length)
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const output = createAudioBuffer(channels, Math.max(1, endSample - startSample), sampleRate)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    output.copyToChannel(audioBuffer.getChannelData(channelIndex).slice(startSample, endSample), channelIndex)
  }
  return output
}

function copyAudioDuration(audioBuffer, startSeconds = 0, durationSeconds = null) {
  const endSeconds = durationSeconds == null ? null : Math.max(0, Number(startSeconds) || 0) + Math.max(0.001, Number(durationSeconds) || 0.001)
  return copyAudioRange(audioBuffer, startSeconds, endSeconds)
}

export function audioBufferToInterleavedFloat32(audioBuffer) {
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const frames = Math.max(1, audioBuffer.length || 1)
  const interleaved = new Float32Array(frames * channels)
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      interleaved[(frame * channels) + channel] = audioBuffer.getChannelData(channel)[frame] || 0
    }
  }
  return interleaved
}

export function interleavedFloat32ToAudioBuffer(interleaved, { frames, channels, sampleRate }) {
  const output = createAudioBuffer(channels, frames, sampleRate)
  for (let channel = 0; channel < channels; channel += 1) {
    const target = output.getChannelData(channel)
    for (let frame = 0; frame < frames; frame += 1) target[frame] = interleaved[(frame * channels) + channel] || 0
  }
  return output
}

export function getPcmStats(floatArray, channels = 1) {
  const samples = floatArray instanceof Float32Array ? floatArray : new Float32Array(floatArray || [])
  const channelCount = Math.max(1, Math.round(Number(channels) || 1))
  let peak = 0
  let sumSquares = 0
  let nonZeroSamples = 0
  let firstNonZeroFrame = -1
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number(samples[index]) || 0
    const abs = Math.abs(value)
    if (abs > peak) peak = abs
    if (abs > 1e-7) {
      nonZeroSamples += 1
      if (firstNonZeroFrame < 0) firstNonZeroFrame = Math.floor(index / channelCount)
    }
    sumSquares += value * value
  }
  return {
    peak,
    rms: Math.sqrt(sumSquares / Math.max(1, samples.length)),
    nonZeroSamples,
    firstNonZeroFrame
  }
}

function getAudioBufferStats(audioBuffer) {
  if (!audioBuffer?.length) return getPcmStats(new Float32Array(), 1)
  return getPcmStats(audioBufferToInterleavedFloat32(audioBuffer), audioBuffer.numberOfChannels || 1)
}

function resizeAudioBufferToFrames(audioBuffer, targetFrames) {
  const frames = Math.max(1, Math.round(Number(targetFrames) || audioBuffer.length || 1))
  if (audioBuffer.length === frames) return audioBuffer
  const output = createAudioBuffer(audioBuffer.numberOfChannels || 1, frames, audioBuffer.sampleRate || 44100)
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    const target = output.getChannelData(channel)
    const source = audioBuffer.getChannelData(Math.min(channel, audioBuffer.numberOfChannels - 1))
    target.set(source.slice(0, Math.min(source.length, frames)))
  }
  return output
}

function validateRenderedBuffer({
  operation,
  sourceBuffer,
  renderedBuffer,
  targetFrames,
  preservesPitch = false,
  preservesDuration = false,
  engine = SOURA_AUDIO_DSP_ENGINE_ID
}) {
  const expectedFrames = Math.max(1, Math.round(Number(targetFrames) || renderedBuffer.length || 1))
  const diffFrames = Math.abs((renderedBuffer?.length || 0) - expectedFrames)
  if (diffFrames > 1) {
    throw new Error(`Soura DSP render validation failed for ${operation}: expected ${expectedFrames} frames, got ${renderedBuffer?.length || 0}.`)
  }
  const normalized = diffFrames ? resizeAudioBufferToFrames(renderedBuffer, expectedFrames) : renderedBuffer
  const inputStats = getAudioBufferStats(sourceBuffer)
  const outputStats = getAudioBufferStats(normalized)
  if (inputStats.rms > 0.0005 && outputStats.rms < 0.00001) {
    throw new Error('DSP render produced silent output. Original audio was preserved.')
  }
  const sourceDuration = Number.isFinite(Number(sourceBuffer?.duration)) ? Number(sourceBuffer.duration) : null
  const targetDuration = expectedFrames / Math.max(1, normalized.sampleRate || sourceBuffer?.sampleRate || 44100)
  const renderedDuration = Number.isFinite(Number(normalized.duration)) ? Number(normalized.duration) : null
  console.info('[dsp-render] validation', {
    operation,
    sourceDuration,
    targetDuration,
    renderedDuration,
    preservesPitch,
    preservesDuration,
    engine
  })
  return normalized
}

function applyGain(audioBuffer, gainDb = 0) {
  const gain = 10 ** ((Number(gainDb) || 0) / 20)
  if (Math.abs(gain - 1) < 0.001) return
  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    const data = audioBuffer.getChannelData(channel)
    for (let index = 0; index < data.length; index += 1) data[index] = clamp(data[index] * gain, -1, 1)
  }
}

function clearBufferRange(target, startSample = 0, endSample = 0, fadeSamples = 128) {
  for (let channel = 0; channel < target.numberOfChannels; channel += 1) {
    const output = target.getChannelData(channel)
    const start = clamp(startSample, 0, output.length)
    const end = clamp(endSample, start, output.length)
    for (let index = start; index < end; index += 1) {
      const edge = Math.min(index - start, end - index)
      const fade = fadeSamples > 0 ? clamp(edge / fadeSamples, 0, 1) : 1
      output[index] *= 1 - fade
    }
  }
}

function overlayBuffer(target, source, startSample = 0, fadeSamples = 128) {
  const channels = Math.min(target.numberOfChannels || 1, source.numberOfChannels || 1)
  for (let channel = 0; channel < channels; channel += 1) {
    const output = target.getChannelData(channel)
    const input = source.getChannelData(channel)
    for (let index = 0; index < input.length; index += 1) {
      const targetIndex = startSample + index
      if (targetIndex < 0 || targetIndex >= output.length) continue
      const fadeIn = fadeSamples > 0 ? clamp(index / fadeSamples, 0, 1) : 1
      const fadeOut = fadeSamples > 0 ? clamp((input.length - index) / fadeSamples, 0, 1) : 1
      const wet = Math.min(fadeIn, fadeOut)
      output[targetIndex] = clamp((output[targetIndex] * (1 - wet)) + ((input[index] || 0) * wet), -1, 1)
    }
  }
}

function buildResult({
  clipId,
  sourceBuffer,
  renderedBuffer,
  sourceBitDepth,
  quality,
  algorithm,
  operation,
  preservesPitch = true,
  preservesDuration = true,
  totalSemitones = null,
  metadata = {},
  startedAt = Date.now()
}) {
  const createdAt = Date.now()
  const renderedBitDepth = normalizeWavBitDepth(sourceBitDepth)
  const renderedBlob = audioBufferToWavBlob(renderedBuffer, { bitDepth: renderedBitDepth })
  console.info('[dsp-render] wav export', {
    operation,
    blobSize: renderedBlob.size,
    renderedDurationSeconds: renderedBuffer.duration,
    renderedSampleRate: renderedBuffer.sampleRate,
    renderedBitDepth
  })
  const renderedAudio = createRenderedAudioMetadata({
    sourceBuffer,
    renderedBuffer,
    sourceBitDepth,
    renderedBitDepth,
    algorithm,
    engine: SOURA_AUDIO_DSP_ENGINE_ID,
    engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
    engineType: SOURA_AUDIO_DSP_ENGINE_TYPE,
    operation,
    quality,
    qualityMode: quality,
    independentPitchTime: true,
    preservesPitch,
    preservesDuration,
    ...metadata,
    createdAt
  })
  return {
    clipId,
    renderedAudioBuffer: renderedBuffer,
    renderedBlob,
    renderedObjectUrl: URL.createObjectURL(renderedBlob),
    renderedDurationSeconds: renderedBuffer.duration,
    algorithm,
    engine: SOURA_AUDIO_DSP_ENGINE_ID,
    engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
    engineType: SOURA_AUDIO_DSP_ENGINE_TYPE,
    requiresWasm: SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
    quality,
    renderedAudio,
    preservesPitch,
    preservesDuration,
    independentPitchTime: true,
    totalSemitones,
    renderTimeMs: Math.max(0, Math.round((globalThis.performance?.now?.() || Date.now()) - startedAt)),
    createdAt
  }
}

async function renderWasmBuffer({ operation, source, outputFrames, sampleRate, stretchRatio = 1, semitones = 0, cents = 0, quality = 'high', clipId = '' }) {
  const channels = Math.max(1, source.numberOfChannels || 1)
  const inputFrames = Math.max(1, source.length || 1)
  const inputPcm = audioBufferToInterleavedFloat32(source)
  const inputStats = getPcmStats(inputPcm, channels)
  console.info('[dsp-render] input stats', {
    operation,
    clipId,
    frames: inputFrames,
    channels,
    sampleRate,
    inputPeak: inputStats.peak,
    inputRms: inputStats.rms,
    inputFirstNonZeroFrame: inputStats.firstNonZeroFrame
  })
  const rendered = await renderWithSouraWasmDsp({
    operation,
    inputPcm,
    inputFrames,
    outputFrames,
    channels,
    sampleRate,
    stretchRatio,
    semitones,
    cents,
    quality,
    clipId
  })
  if (Number(rendered.returnCode || 0) !== 0) {
    throw new Error(`Soura WASM DSP failed with return code ${rendered.returnCode}.`)
  }
  const outputStats = getPcmStats(rendered.outputPcm, channels)
  console.info('[dsp-render] wasm result', {
    operation,
    clipId,
    returnCode: rendered.returnCode ?? 0,
    outputFrames: rendered.outputFrames || outputFrames,
    outputPeak: outputStats.peak,
    outputRms: outputStats.rms,
    outputFirstNonZeroFrame: outputStats.firstNonZeroFrame,
    engine: rendered.engineId || SOURA_AUDIO_DSP_ENGINE_ID
  })
  if (inputStats.rms > 0.0005 && outputStats.rms < 0.00001) {
    throw new Error('DSP render produced silent output. Original audio was preserved.')
  }
  return interleavedFloat32ToAudioBuffer(rendered.outputPcm, {
    frames: rendered.outputFrames || outputFrames,
    channels,
    sampleRate
  })
}

async function renderTimeStretch(options = {}) {
  const {
    sourceBuffer,
    sourceStartSeconds = 0,
    sourceDurationSeconds = null,
    targetDurationSeconds = null,
    sampleRate = sourceBuffer?.sampleRate || 44100,
    sourceBitDepth = null,
    quality = 'high',
    onProgress = null
  } = options
  if (!sourceBuffer?.length) throw new Error('Missing source audio buffer')
  const startedAt = globalThis.performance?.now?.() || Date.now()
  const source = copyAudioDuration(sourceBuffer, sourceStartSeconds, sourceDurationSeconds)
  const renderRate = source.sampleRate || sampleRate
  const targetSeconds = Math.max(0.001, Number(targetDurationSeconds) || source.duration)
  const outputFrames = Math.max(1, Math.round(targetSeconds * renderRate))
  onProgress?.(0.1)
  const rawRenderedBuffer = await renderWasmBuffer({
    operation: SOURA_AUDIO_DSP_OPERATIONS.timeStretch,
    source,
    outputFrames,
    sampleRate: renderRate,
    stretchRatio: outputFrames / Math.max(1, source.length),
    quality,
    clipId: options.clipId || ''
  })
  const renderedBuffer = validateRenderedBuffer({
    operation: SOURA_AUDIO_DSP_OPERATIONS.timeStretch,
    sourceBuffer: source,
    renderedBuffer: rawRenderedBuffer,
    targetFrames: outputFrames,
    preservesPitch: true,
    preservesDuration: false
  })
  onProgress?.(1)
  return buildResult({
    clipId: options.clipId || '',
    sourceBuffer: source,
    renderedBuffer,
    sourceBitDepth,
    quality,
    algorithm: 'signalsmith_wasm_time_stretch_v1',
    operation: SOURA_AUDIO_DSP_OPERATIONS.timeStretch,
    preservesPitch: true,
    preservesDuration: false,
    metadata: {
      preservesPitchForStretch: true,
      preservesDurationForPitch: false,
      sourceDurationSeconds: source.duration,
      targetDurationSeconds: targetSeconds,
      renderedDurationSeconds: renderedBuffer.duration,
      stretchRatio: outputFrames / Math.max(1, source.length)
    },
    startedAt
  })
}

async function renderPitchShift(options = {}) {
  const {
    audioBuffer,
    clipId = '',
    transposeSemitones = 0,
    fineTuneCents = 0,
    sourceBitDepth = null,
    quality = 'high',
    trimStartSeconds = 0,
    trimEndSeconds = null,
    onProgress = null
  } = options
  if (!audioBuffer?.length) throw new Error('Missing audio buffer')
  const startedAt = globalThis.performance?.now?.() || Date.now()
  const source = copyAudioRange(audioBuffer, trimStartSeconds, trimEndSeconds)
  const totalSemitones = (Number(transposeSemitones) || 0) + ((Number(fineTuneCents) || 0) / 100)
  onProgress?.(0.1)
  const rawRenderedBuffer = await renderWasmBuffer({
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchShift,
    source,
    outputFrames: source.length,
    sampleRate: source.sampleRate || audioBuffer.sampleRate || 44100,
    semitones: Number(transposeSemitones) || 0,
    cents: Number(fineTuneCents) || 0,
    quality,
    clipId
  })
  const renderedBuffer = validateRenderedBuffer({
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchShift,
    sourceBuffer: source,
    renderedBuffer: rawRenderedBuffer,
    targetFrames: source.length,
    preservesPitch: false,
    preservesDuration: true
  })
  onProgress?.(1)
  return buildResult({
    clipId,
    sourceBuffer: source,
    renderedBuffer,
    sourceBitDepth,
    quality,
    algorithm: 'signalsmith_wasm_pitch_shift_v1',
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchShift,
    preservesPitch: false,
    preservesDuration: true,
    totalSemitones,
    metadata: {
      operation: 'pitch_shift',
      preservesDurationForPitch: true,
      preservesPitchForStretch: false,
      sourceDurationSeconds: source.duration,
      targetDurationSeconds: source.duration,
      renderedDurationSeconds: renderedBuffer.duration,
      pitchSemitones: totalSemitones
    },
    startedAt
  })
}

async function renderPitchAndStretch(options = {}) {
  const {
    audioBuffer,
    sourceBuffer = audioBuffer,
    clipId = '',
    transposeSemitones = 0,
    fineTuneCents = 0,
    sourceDurationSeconds = null,
    targetDurationSeconds = null,
    sourceBitDepth = null,
    quality = 'high',
    trimStartSeconds = 0,
    trimEndSeconds = null,
    onProgress = null
  } = options
  const inputBuffer = audioBuffer || sourceBuffer
  if (!inputBuffer?.length) throw new Error('Missing audio buffer')
  const startedAt = globalThis.performance?.now?.() || Date.now()
  const source = sourceDurationSeconds == null
    ? copyAudioRange(inputBuffer, trimStartSeconds, trimEndSeconds)
    : copyAudioDuration(inputBuffer, trimStartSeconds, sourceDurationSeconds)
  const renderRate = source.sampleRate || inputBuffer.sampleRate || 44100
  const targetSeconds = Math.max(0.001, Number(targetDurationSeconds) || source.duration)
  const outputFrames = Math.max(1, Math.round(targetSeconds * renderRate))
  const totalSemitones = (Number(transposeSemitones) || 0) + ((Number(fineTuneCents) || 0) / 100)
  onProgress?.(0.1)
  const rawRenderedBuffer = await renderWasmBuffer({
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch,
    source,
    outputFrames,
    sampleRate: renderRate,
    stretchRatio: outputFrames / Math.max(1, source.length),
    semitones: Number(transposeSemitones) || 0,
    cents: Number(fineTuneCents) || 0,
    quality,
    clipId
  })
  const renderedBuffer = validateRenderedBuffer({
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch,
    sourceBuffer: source,
    renderedBuffer: rawRenderedBuffer,
    targetFrames: outputFrames,
    preservesPitch: false,
    preservesDuration: false
  })
  onProgress?.(1)
  return buildResult({
    clipId,
    sourceBuffer: source,
    renderedBuffer,
    sourceBitDepth,
    quality,
    algorithm: 'signalsmith_wasm_pitch_time_v1',
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch,
    preservesPitch: false,
    preservesDuration: false,
    totalSemitones,
    metadata: {
      operation: 'combined_pitch_time',
      preservesPitchForStretch: true,
      preservesDurationForPitch: true,
      sourceDurationSeconds: source.duration,
      targetDurationSeconds: targetSeconds,
      renderedDurationSeconds: renderedBuffer.duration,
      stretchRatio: outputFrames / Math.max(1, source.length),
      pitchSemitones: totalSemitones
    },
    startedAt
  })
}

async function renderPitchTrace(options = {}) {
  const {
    audioBuffer,
    clipId = '',
    notes = [],
    transposeSemitones = 0,
    fineTuneCents = 0,
    sourceBitDepth = null,
    quality = 'high',
    trimStartSeconds = 0,
    trimEndSeconds = null,
    onProgress = null
  } = options
  if (!audioBuffer?.length) throw new Error('Missing audio buffer')
  const startedAt = globalThis.performance?.now?.() || Date.now()
  const source = copyAudioRange(audioBuffer, trimStartSeconds, trimEndSeconds)
  const output = createAudioBuffer(source.numberOfChannels || 1, source.length, source.sampleRate || audioBuffer.sampleRate || 44100)
  for (let channel = 0; channel < output.numberOfChannels; channel += 1) {
    output.copyToChannel(source.getChannelData(channel).slice(), channel)
  }
  const editableNotes = (Array.isArray(notes) ? notes : [])
    .filter(Boolean)
    .map((note) => ({
      ...note,
      delta: (Number(note.editedMidiNote ?? note.midiNote ?? note.originalMidiNote) || 0) - (Number(note.originalMidiNote ?? note.midiNote) || 0)
    }))
    .filter((note) => note.muted === true || Math.abs(Number(note.gainDb) || 0) > 0.001 || Math.abs(note.delta + Number(transposeSemitones || 0) + Number(fineTuneCents || 0) / 100) > 0.001)
    .slice(0, 256)

  if (!editableNotes.length && (Math.abs(Number(transposeSemitones) || 0) > 0.001 || Math.abs(Number(fineTuneCents) || 0) > 0.001)) {
    return renderPitchShift({ audioBuffer, clipId, transposeSemitones, fineTuneCents, sourceBitDepth, quality, trimStartSeconds, trimEndSeconds, onProgress })
  }

  for (let noteIndex = 0; noteIndex < editableNotes.length; noteIndex += 1) {
    const note = editableNotes[noteIndex]
    const startSeconds = Math.max(0, Number(note.startSeconds) || 0)
    const durationSeconds = Math.max(0.03, Number(note.durationSeconds) || 0.03)
    const startSample = clamp(Math.floor(startSeconds * source.sampleRate), 0, source.length - 1)
    const endSample = clamp(Math.ceil((startSeconds + durationSeconds) * source.sampleRate), startSample + 1, source.length)
    const fadeSamples = Math.round(source.sampleRate * 0.006)
    if (note.muted === true) {
      clearBufferRange(output, startSample, endSample, fadeSamples)
      onProgress?.((noteIndex + 1) / Math.max(1, editableNotes.length))
      continue
    }
    const segment = createAudioBuffer(source.numberOfChannels || 1, endSample - startSample, source.sampleRate)
    for (let channel = 0; channel < segment.numberOfChannels; channel += 1) {
      segment.copyToChannel(source.getChannelData(channel).slice(startSample, endSample), channel)
    }
    const semitones = note.delta + (Number(transposeSemitones) || 0)
    const cents = Number(fineTuneCents) || 0
    const rawRenderedSegment = await renderWasmBuffer({
      operation: SOURA_AUDIO_DSP_OPERATIONS.pitchTrace,
      source: segment,
      outputFrames: segment.length,
      sampleRate: segment.sampleRate,
      semitones,
      cents,
      quality,
      clipId
    })
    const renderedSegment = validateRenderedBuffer({
      operation: SOURA_AUDIO_DSP_OPERATIONS.pitchTrace,
      sourceBuffer: segment,
      renderedBuffer: rawRenderedSegment,
      targetFrames: segment.length,
      preservesPitch: false,
      preservesDuration: true
    })
    applyGain(renderedSegment, note.gainDb)
    overlayBuffer(output, renderedSegment, startSample, fadeSamples)
    onProgress?.((noteIndex + 1) / Math.max(1, editableNotes.length))
  }

  return buildResult({
    clipId,
    sourceBuffer: audioBuffer,
    renderedBuffer: output,
    sourceBitDepth,
    quality,
    algorithm: 'signalsmith_wasm_pitch_trace_v1',
    operation: SOURA_AUDIO_DSP_OPERATIONS.pitchTrace,
    preservesPitch: false,
    preservesDuration: true,
    metadata: {
      operation: 'pitch_trace',
      preservesDurationForPitch: true,
      sourceDurationSeconds: source.duration,
      targetDurationSeconds: source.duration,
      renderedDurationSeconds: output.duration
    },
    startedAt
  })
}

export async function renderAudioDsp(operation, options = {}) {
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.timeStretch) return renderTimeStretch(options)
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchShift) return renderPitchShift(options)
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch) return renderPitchAndStretch(options)
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchTrace) return renderPitchTrace(options)
  throw new Error(`Unsupported Soura DSP operation: ${operation}`)
}

export {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  SOURA_AUDIO_DSP_ENGINE_TYPE,
  SOURA_AUDIO_DSP_OPERATIONS
}
