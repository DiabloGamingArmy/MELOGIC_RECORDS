const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

function createAudioBuffer(channelCount, length, sampleRate) {
  const OfflineContext = globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext
  if (OfflineContext) {
    const offline = new OfflineContext(Math.max(1, channelCount), Math.max(1, length), sampleRate)
    return offline.createBuffer(Math.max(1, channelCount), Math.max(1, length), sampleRate)
  }
  const AudioCtx = globalThis.AudioContext || globalThis.webkitAudioContext
  const context = new AudioCtx()
  return context.createBuffer(Math.max(1, channelCount), Math.max(1, length), sampleRate)
}

function hannWindow(size) {
  const window = new Float32Array(size)
  const denominator = Math.max(1, size - 1)
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / denominator))
  }
  return window
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

function audioBufferToWavBlob(audioBuffer) {
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const sampleRate = Math.max(1, audioBuffer.sampleRate || 44100)
  const samples = Math.max(1, audioBuffer.length || 1)
  const bytesPerSample = 2
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
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, dataSize, true)

  const channelData = Array.from({ length: channels }, (_, index) => audioBuffer.getChannelData(index))
  let offset = 44
  for (let sampleIndex = 0; sampleIndex < samples; sampleIndex += 1) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const sample = clamp(channelData[channelIndex][sampleIndex] || 0, -1, 1)
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true)
      offset += 2
    }
  }

  return new Blob([buffer], { type: 'audio/wav' })
}

export async function renderStretchedAudioClip({
  originalAudioBuffer,
  clipId = '',
  stretchRatio = 1,
  sampleRate = originalAudioBuffer?.sampleRate || 44100,
  preservesPitchPreferred = true,
  onProgress = null
} = {}) {
  if (!originalAudioBuffer?.length) throw new Error('Missing original audio buffer')

  const ratio = clamp(Number(stretchRatio) || 1, 0.05, 16)
  const channels = Math.max(1, originalAudioBuffer.numberOfChannels || 1)
  const inputLength = Math.max(1, originalAudioBuffer.length || 1)
  const outputLength = Math.max(1, Math.round(inputLength * ratio))
  const renderSampleRate = Math.max(1, Number(sampleRate) || originalAudioBuffer.sampleRate || 44100)
  const outputBuffer = createAudioBuffer(channels, outputLength, renderSampleRate)

  if (Math.abs(ratio - 1) <= 0.001) {
    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      outputBuffer.copyToChannel(originalAudioBuffer.getChannelData(channelIndex).slice(0, outputLength), channelIndex)
    }
  } else {
    const grainSize = clamp(Math.round(renderSampleRate * 0.06), 1024, 4096)
    const hopIn = Math.max(128, Math.round(grainSize / 4))
    const hopOut = Math.max(1, Math.round(hopIn * ratio))
    const window = hannWindow(grainSize)

    for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
      const input = originalAudioBuffer.getChannelData(channelIndex)
      const output = outputBuffer.getChannelData(channelIndex)
      const weights = new Float32Array(outputLength)
      let grainIndex = 0
      for (let inPos = 0, outPos = 0; outPos < outputLength; inPos += hopIn, outPos += hopOut) {
        const sourceStart = Math.min(Math.max(0, inPos), Math.max(0, inputLength - 1))
        for (let index = 0; index < grainSize; index += 1) {
          const sourceIndex = sourceStart + index
          const outputIndex = outPos + index
          if (sourceIndex >= inputLength || outputIndex >= outputLength) break
          const weight = window[index]
          output[outputIndex] += (input[sourceIndex] || 0) * weight
          weights[outputIndex] += weight
        }
        grainIndex += 1
        if (grainIndex % 64 === 0) await Promise.resolve()
      }
      for (let index = 0; index < outputLength; index += 1) {
        if (weights[index] > 0.0001) output[index] = clamp(output[index] / weights[index], -1, 1)
      }
      onProgress?.((channelIndex + 1) / channels)
    }
  }

  const renderedBlob = audioBufferToWavBlob(outputBuffer)
  const renderedObjectUrl = URL.createObjectURL(renderedBlob)
  return {
    clipId,
    renderedAudioBuffer: outputBuffer,
    renderedBlob,
    renderedObjectUrl,
    renderedDurationSeconds: outputBuffer.duration,
    algorithm: preservesPitchPreferred ? 'granular_ola_basic' : 'offline_granular',
    preservesPitch: Boolean(preservesPitchPreferred),
    createdAt: Date.now()
  }
}
