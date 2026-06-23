import {
  audioBufferToWavBlob,
  createRenderedAudioMetadata,
  createAudioBuffer
} from './audioStretchRenderService.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function copyReverseRange(audioBuffer, trimStartSeconds = 0, trimEndSeconds = null) {
  const sampleRate = audioBuffer.sampleRate || 44100
  const startSample = clamp(Math.floor(Math.max(0, trimStartSeconds) * sampleRate), 0, audioBuffer.length)
  const endSample = clamp(Math.ceil((trimEndSeconds == null ? audioBuffer.duration : trimEndSeconds) * sampleRate), startSample + 1, audioBuffer.length)
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const length = Math.max(1, endSample - startSample)
  const output = createAudioBuffer(channels, length, sampleRate)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const input = audioBuffer.getChannelData(channelIndex)
    const target = output.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) {
      target[index] = input[endSample - 1 - index] || 0
    }
  }
  return output
}

export async function renderReversedAudio({
  audioBuffer,
  clipId = '',
  trimStartSeconds = 0,
  trimEndSeconds = null,
  sourceBitDepth = null,
  quality = 'lossless',
  onProgress = null
} = {}) {
  if (!audioBuffer?.length) throw new Error('Missing audio buffer')
  const startedAt = performance.now?.() || Date.now()
  onProgress?.(0.15)
  const renderedAudioBuffer = copyReverseRange(audioBuffer, trimStartSeconds, trimEndSeconds)
  onProgress?.(0.85)
  const createdAt = Date.now()
  const renderedBlob = audioBufferToWavBlob(renderedAudioBuffer, { bitDepth: sourceBitDepth })
  const renderedAudio = createRenderedAudioMetadata({
    sourceBuffer: audioBuffer,
    renderedBuffer: renderedAudioBuffer,
    sourceBitDepth,
    renderedBitDepth: sourceBitDepth,
    algorithm: 'buffer_reverse_v1',
    qualityMode: quality,
    createdAt
  })
  onProgress?.(1)
  return {
    clipId,
    renderedAudioBuffer,
    renderedBlob,
    renderedObjectUrl: URL.createObjectURL(renderedBlob),
    renderedDurationSeconds: renderedAudioBuffer.duration,
    algorithm: 'buffer_reverse_v1',
    quality,
    renderedAudio,
    createdAt,
    renderTimeMs: Math.round((performance.now?.() || Date.now()) - startedAt)
  }
}
