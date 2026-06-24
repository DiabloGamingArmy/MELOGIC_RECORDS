import { SOURA_AUDIO_DSP_REQUIRED_ERROR } from './dsp/audioDspTypes.js'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export function createAudioBuffer(channelCount, length, sampleRate) {
  const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  if (OfflineContext) {
    const offline = new OfflineContext(Math.max(1, channelCount), Math.max(1, length), sampleRate)
    return offline.createBuffer(Math.max(1, channelCount), Math.max(1, length), sampleRate)
  }
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext
  const context = new AudioCtx()
  return context.createBuffer(Math.max(1, channelCount), Math.max(1, length), sampleRate)
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
}

export function normalizeWavBitDepth(bitDepth = null) {
  const value = Math.round(Number(bitDepth) || 0)
  return [16, 24, 32].includes(value) ? value : 16
}

export function createRenderedAudioMetadata({
  sourceBuffer,
  renderedBuffer,
  sourceBitDepth = null,
  renderedBitDepth = null,
  algorithm = null,
  engine = null,
  engineLabel = null,
  engineType = null,
  operation = null,
  quality = null,
  qualityMode = 'high',
  createdAt = Date.now()
} = {}) {
  const sourceDepth = Number.isFinite(Number(sourceBitDepth)) && Number(sourceBitDepth) > 0 ? Number(sourceBitDepth) : null
  const renderedDepth = normalizeWavBitDepth(renderedBitDepth ?? sourceDepth)
  return {
    sourceSampleRate: Number.isFinite(Number(sourceBuffer?.sampleRate)) ? Number(sourceBuffer.sampleRate) : null,
    renderedSampleRate: Number.isFinite(Number(renderedBuffer?.sampleRate)) ? Number(renderedBuffer.sampleRate) : null,
    sourceBitDepth: sourceDepth,
    renderedBitDepth: renderedDepth,
    bitDepthPreserved: sourceDepth != null && sourceDepth === renderedDepth,
    sourceChannelCount: Number.isFinite(Number(sourceBuffer?.numberOfChannels)) ? Number(sourceBuffer.numberOfChannels) : null,
    renderedChannelCount: Number.isFinite(Number(renderedBuffer?.numberOfChannels)) ? Number(renderedBuffer.numberOfChannels) : null,
    sampleRatePreserved: Number.isFinite(Number(sourceBuffer?.sampleRate)) && Number.isFinite(Number(renderedBuffer?.sampleRate)) ? Number(sourceBuffer.sampleRate) === Number(renderedBuffer.sampleRate) : false,
    channelCountPreserved: Number.isFinite(Number(sourceBuffer?.numberOfChannels)) && Number.isFinite(Number(renderedBuffer?.numberOfChannels)) ? Number(sourceBuffer.numberOfChannels) === Number(renderedBuffer.numberOfChannels) : false,
    algorithm: algorithm || null,
    engine: engine || null,
    engineLabel: engineLabel || null,
    engineType: engineType || null,
    operation: operation || null,
    quality: quality || qualityMode || 'high',
    qualityMode: qualityMode || 'high',
    renderedDurationSeconds: Number.isFinite(Number(renderedBuffer?.duration)) ? Number(renderedBuffer.duration) : null,
    renderCreatedAt: Number.isFinite(Number(createdAt)) ? Number(createdAt) : Date.now()
  }
}

export function audioBufferToWavBlob(audioBuffer, { bitDepth = 16 } = {}) {
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const sampleRate = Math.max(1, audioBuffer.sampleRate || 44100)
  const samples = Math.max(1, audioBuffer.length || 1)
  const wavBitDepth = normalizeWavBitDepth(bitDepth)
  const bytesPerSample = wavBitDepth / 8
  const blockAlign = channels * bytesPerSample
  const dataSize = samples * blockAlign
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * blockAlign, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, wavBitDepth, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index))
  let offset = 44
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const sample = clamp(channelData[channelIndex][sampleIndex] || 0, -1, 1)
      if (wavBitDepth === 24) {
        const value = Math.round(sample < 0 ? sample * 0x800000 : sample * 0x7fffff)
        view.setUint8(offset, value & 0xff)
        view.setUint8(offset + 1, (value >> 8) & 0xff)
        view.setUint8(offset + 2, (value >> 16) & 0xff)
        offset += 3
      } else if (wavBitDepth === 32) {
        view.setInt32(offset, Math.round(sample < 0 ? sample * 0x80000000 : sample * 0x7fffffff), true)
        offset += 4
      } else {
        view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true)
        offset += 2
      }
    }
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

export async function renderStretchedAudioClip() {
  throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} Legacy non-WASM stretch rendering is disabled in production.`)
}

export async function renderTimeStretch() {
  throw new Error(`${SOURA_AUDIO_DSP_REQUIRED_ERROR} Legacy non-WASM stretch rendering is disabled in production.`)
}
