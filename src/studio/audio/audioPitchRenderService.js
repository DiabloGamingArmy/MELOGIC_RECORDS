import {
  audioBufferToWavBlob,
  createAudioBuffer,
  renderStretchedAudioClip
} from './audioStretchRenderService.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function copyAudioRange(audioBuffer, trimStartSeconds = 0, trimEndSeconds = null) {
  const sampleRate = audioBuffer.sampleRate || 44100
  const startSample = clamp(Math.floor(Math.max(0, trimStartSeconds) * sampleRate), 0, audioBuffer.length)
  const endSample = clamp(Math.ceil((trimEndSeconds == null ? audioBuffer.duration : trimEndSeconds) * sampleRate), startSample + 1, audioBuffer.length)
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const output = createAudioBuffer(channels, Math.max(1, endSample - startSample), sampleRate)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    output.copyToChannel(audioBuffer.getChannelData(channelIndex).slice(startSample, endSample), channelIndex)
  }
  return output
}

function resampleForPitch(audioBuffer, semitones = 0) {
  const pitchRatio = 2 ** ((Number(semitones) || 0) / 12)
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const inputLength = Math.max(1, audioBuffer.length || 1)
  const outputLength = Math.max(1, Math.round(inputLength / Math.max(0.01, pitchRatio)))
  const output = createAudioBuffer(channels, outputLength, audioBuffer.sampleRate || 44100)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const input = audioBuffer.getChannelData(channelIndex)
    const target = output.getChannelData(channelIndex)
    for (let index = 0; index < outputLength; index += 1) {
      const sourcePosition = index * pitchRatio
      const left = Math.floor(sourcePosition)
      const amount = sourcePosition - left
      const y0 = input[clamp(left - 1, 0, inputLength - 1)] || 0
      const y1 = input[clamp(left, 0, inputLength - 1)] || 0
      const y2 = input[clamp(left + 1, 0, inputLength - 1)] || 0
      const y3 = input[clamp(left + 2, 0, inputLength - 1)] || 0
      const a0 = y3 - y2 - y0 + y1
      const a1 = y0 - y1 - a0
      const a2 = y2 - y0
      const a3 = y1
      target[index] = clamp((((a0 * amount + a1) * amount + a2) * amount + a3), -1, 1)
    }
  }
  return output
}

function overlayBuffer(target, source, startSample = 0, fadeSamples = 128) {
  const channels = Math.min(target.numberOfChannels || 1, source.numberOfChannels || 1)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const output = target.getChannelData(channelIndex)
    const input = source.getChannelData(channelIndex)
    for (let index = 0; index < input.length; index += 1) {
      const targetIndex = startSample + index
      if (targetIndex < 0 || targetIndex >= output.length) continue
      const fadeIn = fadeSamples > 0 ? clamp(index / fadeSamples, 0, 1) : 1
      const fadeOut = fadeSamples > 0 ? clamp((input.length - index) / fadeSamples, 0, 1) : 1
      const wet = Math.min(fadeIn, fadeOut)
      output[targetIndex] = (output[targetIndex] * (1 - wet)) + ((input[index] || 0) * wet)
    }
  }
}
function clearBufferRange(target, startSample = 0, endSample = 0, fadeSamples = 128) {
  for (let channelIndex = 0; channelIndex < target.numberOfChannels; channelIndex += 1) {
    const output = target.getChannelData(channelIndex)
    const start = clamp(startSample, 0, output.length)
    const end = clamp(endSample, start, output.length)
    for (let index = start; index < end; index += 1) {
      const edge = Math.min(index - start, end - index)
      const fade = fadeSamples > 0 ? clamp(edge / fadeSamples, 0, 1) : 1
      output[index] *= 1 - fade
    }
  }
}

function applyGain(audioBuffer, gainDb = 0) {
  const gain = 10 ** ((Number(gainDb) || 0) / 20)
  if (Math.abs(gain - 1) < 0.001) return
  for (let channelIndex = 0; channelIndex < audioBuffer.numberOfChannels; channelIndex += 1) {
    const channel = audioBuffer.getChannelData(channelIndex)
    for (let index = 0; index < channel.length; index += 1) channel[index] *= gain
  }
}

export async function renderPitchShiftedAudio({
  audioBuffer,
  clipId = '',
  transposeSemitones = 0,
  fineTuneCents = 0,
  sampleRate = audioBuffer?.sampleRate || 44100,
  trimStartSeconds = 0,
  trimEndSeconds = null,
  onProgress = null
} = {}) {
  if (!audioBuffer?.length) throw new Error('Missing audio buffer')
  const startedAt = performance.now?.() || Date.now()
  const totalSemitones = (Number(transposeSemitones) || 0) + ((Number(fineTuneCents) || 0) / 100)
  const source = copyAudioRange(audioBuffer, trimStartSeconds, trimEndSeconds)
  if (Math.abs(totalSemitones) < 0.001) {
    const renderedBlob = audioBufferToWavBlob(source)
    return {
      clipId,
      renderedAudioBuffer: source,
      renderedBlob,
      renderedObjectUrl: URL.createObjectURL(renderedBlob),
      renderedDurationSeconds: source.duration,
      algorithm: 'identity_pitch_shift',
      quality: 'high',
      preservesDuration: true,
      renderTimeMs: Math.round((performance.now?.() || Date.now()) - startedAt),
      createdAt: Date.now()
    }
  }
  onProgress?.(0.15)
  const resampled = resampleForPitch(source, totalSemitones)
  const stretchRatio = source.length / Math.max(1, resampled.length)
  const stretched = await renderStretchedAudioClip({
    originalAudioBuffer: resampled,
    clipId,
    stretchRatio,
    targetDurationSeconds: source.duration,
    sampleRate,
    preservesPitchPreferred: false,
    onProgress: (progress) => onProgress?.(0.15 + (progress * 0.75))
  })
  onProgress?.(1)
  return {
    clipId,
    renderedAudioBuffer: stretched.renderedAudioBuffer,
    renderedBlob: stretched.renderedBlob,
    renderedObjectUrl: stretched.renderedObjectUrl,
    renderedDurationSeconds: stretched.renderedDurationSeconds,
    algorithm: 'cubic_resample_wsola_phase_vocoder_v1',
    quality: 'high',
    preservesDuration: true,
    totalSemitones,
    renderTimeMs: Math.round((performance.now?.() || Date.now()) - startedAt),
    createdAt: stretched.createdAt || Date.now()
  }
}

export async function renderPitchTraceEdits({
  audioBuffer,
  clipId = '',
  notes = [],
  transposeSemitones = 0,
  fineTuneCents = 0,
  sampleRate = audioBuffer?.sampleRate || 44100,
  trimStartSeconds = 0,
  trimEndSeconds = null,
  onProgress = null
} = {}) {
  if (!audioBuffer?.length) throw new Error('Missing audio buffer')
  const startedAt = performance.now?.() || Date.now()
  const source = copyAudioRange(audioBuffer, trimStartSeconds, trimEndSeconds)
  const output = createAudioBuffer(source.numberOfChannels || 1, source.length, source.sampleRate || sampleRate)
  for (let channelIndex = 0; channelIndex < output.numberOfChannels; channelIndex += 1) {
    output.copyToChannel(source.getChannelData(channelIndex).slice(), channelIndex)
  }
  const editableNotes = (Array.isArray(notes) ? notes : [])
    .filter((note) => note)
    .map((note) => ({
      ...note,
      delta: (Number(note.editedMidiNote ?? note.midiNote ?? note.originalMidiNote) || 0) - (Number(note.originalMidiNote ?? note.midiNote) || 0)
    }))
    .filter((note) => note.muted === true || Math.abs(Number(note.gainDb) || 0) > 0.001 || Math.abs(note.delta + Number(transposeSemitones || 0) + Number(fineTuneCents || 0) / 100) > 0.001)
    .slice(0, 256)

  for (let noteIndex = 0; noteIndex < editableNotes.length; noteIndex += 1) {
    const note = editableNotes[noteIndex]
    const startSeconds = Math.max(0, Number(note.startSeconds) || 0)
    const durationSeconds = Math.max(0.03, Number(note.durationSeconds) || 0.03)
    const startSample = clamp(Math.floor(startSeconds * source.sampleRate), 0, source.length - 1)
    const endSample = clamp(Math.ceil((startSeconds + durationSeconds) * source.sampleRate), startSample + 1, source.length)
    if (note.muted === true) {
      clearBufferRange(output, startSample, endSample, Math.round(source.sampleRate * 0.006))
      onProgress?.((noteIndex + 1) / Math.max(1, editableNotes.length))
      await Promise.resolve()
      continue
    }
    const segment = createAudioBuffer(source.numberOfChannels || 1, endSample - startSample, source.sampleRate)
    for (let channelIndex = 0; channelIndex < segment.numberOfChannels; channelIndex += 1) {
      segment.copyToChannel(source.getChannelData(channelIndex).slice(startSample, endSample), channelIndex)
    }
    const totalSemitones = note.delta + (Number(transposeSemitones) || 0) + ((Number(fineTuneCents) || 0) / 100)
    const rendered = await renderPitchShiftedAudio({
      audioBuffer: segment,
      clipId: `${clipId}:${note.id || noteIndex}`,
      transposeSemitones: totalSemitones,
      fineTuneCents: 0,
      sampleRate: source.sampleRate,
      trimStartSeconds: 0,
      trimEndSeconds: segment.duration
    })
    applyGain(rendered.renderedAudioBuffer, note.gainDb)
    overlayBuffer(output, rendered.renderedAudioBuffer, startSample, Math.round(source.sampleRate * 0.006))
    onProgress?.((noteIndex + 1) / Math.max(1, editableNotes.length))
    await Promise.resolve()
  }

  if (!editableNotes.length && (Math.abs(Number(transposeSemitones) || 0) > 0.001 || Math.abs(Number(fineTuneCents) || 0) > 0.001)) {
    return renderPitchShiftedAudio({
      audioBuffer,
      clipId,
      transposeSemitones,
      fineTuneCents,
      sampleRate,
      trimStartSeconds,
      trimEndSeconds,
      onProgress
    })
  }

  const renderedBlob = audioBufferToWavBlob(output)
  return {
    clipId,
    renderedAudioBuffer: output,
    renderedBlob,
    renderedObjectUrl: URL.createObjectURL(renderedBlob),
    renderedDurationSeconds: output.duration,
    algorithm: 'segmented_cubic_resample_wsola_phase_vocoder_v1',
    quality: 'high',
    preservesDuration: true,
    renderTimeMs: Math.round((performance.now?.() || Date.now()) - startedAt),
    createdAt: Date.now()
  }
}
