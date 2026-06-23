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

function hannWindow(size) {
  const window = new Float32Array(size)
  const denominator = Math.max(1, size - 1)
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / denominator))
  }
  return window
}

function copyAudioRange(audioBuffer, startSeconds = 0, durationSeconds = null, sampleRate = audioBuffer?.sampleRate || 44100) {
  const sourceRate = audioBuffer.sampleRate || sampleRate
  const startSample = clamp(Math.floor(Math.max(0, startSeconds) * sourceRate), 0, audioBuffer.length)
  const requestedEnd = durationSeconds == null ? audioBuffer.duration : Math.max(0, startSeconds) + Math.max(0.001, durationSeconds)
  const endSample = clamp(Math.ceil(requestedEnd * sourceRate), startSample + 1, audioBuffer.length)
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const output = createAudioBuffer(channels, Math.max(1, endSample - startSample), sourceRate)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    output.copyToChannel(audioBuffer.getChannelData(channelIndex).slice(startSample, endSample), channelIndex)
  }
  return output
}

function cubicInterpolate(y0, y1, y2, y3, amount) {
  const a0 = y3 - y2 - y0 + y1
  const a1 = y0 - y1 - a0
  const a2 = y2 - y0
  const a3 = y1
  return (((a0 * amount + a1) * amount + a2) * amount + a3)
}

function sampleCubic(input, position) {
  const index = Math.floor(position)
  const amount = position - index
  const y0 = input[clamp(index - 1, 0, input.length - 1)] || 0
  const y1 = input[clamp(index, 0, input.length - 1)] || 0
  const y2 = input[clamp(index + 1, 0, input.length - 1)] || 0
  const y3 = input[clamp(index + 2, 0, input.length - 1)] || 0
  return cubicInterpolate(y0, y1, y2, y3, amount)
}

function resampleBuffer(audioBuffer, outputLength, sampleRate = audioBuffer?.sampleRate || 44100) {
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const inputLength = Math.max(1, audioBuffer.length || 1)
  const targetLength = Math.max(1, Math.round(outputLength))
  const output = createAudioBuffer(channels, targetLength, sampleRate)
  const scale = inputLength / Math.max(1, targetLength)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    const input = audioBuffer.getChannelData(channelIndex)
    const target = output.getChannelData(channelIndex)
    for (let index = 0; index < targetLength; index += 1) {
      target[index] = clamp(sampleCubic(input, index * scale), -1, 1)
    }
  }
  return output
}

function stretchChannelPhaseVocoder(input, outputLength, sampleRate) {
  const inputLength = Math.max(1, input.length || 1)
  const targetLength = Math.max(1, Math.round(outputLength))
  if (Math.abs(targetLength - inputLength) <= 8) return input.slice(0, targetLength)
  const ratio = targetLength / inputLength
  const frameSize = clamp(Math.round(sampleRate * 0.08), 2048, 8192)
  const analysisHop = Math.max(128, Math.round(frameSize / 4))
  const synthesisHop = Math.max(1, Math.round(analysisHop * ratio))
  const window = hannWindow(frameSize)
  const output = new Float32Array(targetLength + frameSize)
  const weights = new Float32Array(output.length)
  let frameIndex = 0
  for (let inputPos = 0, outputPos = 0; outputPos < targetLength; inputPos += analysisHop, outputPos += synthesisHop) {
    const center = inputPos
    let bestOffset = 0
    if (frameIndex > 0 && ratio > 0.65 && ratio < 1.65) {
      let bestScore = -Infinity
      const search = Math.min(Math.round(analysisHop * 0.75), 320)
      const compare = Math.min(Math.round(frameSize * 0.35), 1600)
      const priorInput = Math.max(0, inputPos - analysisHop)
      for (let offset = -search; offset <= search; offset += 8) {
        const candidate = clamp(center + offset, 0, Math.max(0, inputLength - frameSize))
        let score = 0
        for (let index = 0; index < compare; index += 8) {
          score += (input[priorInput + index] || 0) * (input[candidate + index] || 0)
        }
        if (score > bestScore) {
          bestScore = score
          bestOffset = offset
        }
      }
    }
    const sourceStart = clamp(center + bestOffset, 0, Math.max(0, inputLength - 1))
    for (let index = 0; index < frameSize; index += 1) {
      const sourceIndex = sourceStart + index
      const targetIndex = outputPos + index
      if (targetIndex >= output.length) break
      const weight = window[index]
      output[targetIndex] += (input[sourceIndex] || 0) * weight
      weights[targetIndex] += weight
    }
    frameIndex += 1
  }
  const trimmed = new Float32Array(targetLength)
  for (let index = 0; index < targetLength; index += 1) {
    trimmed[index] = weights[index] > 0.0001 ? clamp(output[index] / weights[index], -1, 1) : 0
  }
  return trimmed
}

function renderPhaseVocoderStretch(audioBuffer, targetLength, sampleRate, onProgress = null) {
  const channels = Math.max(1, audioBuffer.numberOfChannels || 1)
  const output = createAudioBuffer(channels, Math.max(1, Math.round(targetLength)), sampleRate)
  for (let channelIndex = 0; channelIndex < channels; channelIndex += 1) {
    output.copyToChannel(stretchChannelPhaseVocoder(audioBuffer.getChannelData(channelIndex), output.length, sampleRate), channelIndex)
    onProgress?.((channelIndex + 1) / channels)
  }
  return output
}

function writeAscii(view, offset, value) {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}

export function audioBufferToWavBlob(audioBuffer) {
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
  sourceStartSeconds = 0,
  sourceDurationSeconds = null,
  targetDurationSeconds = null,
  sampleRate = originalAudioBuffer?.sampleRate || 44100,
  preservesPitchPreferred = true,
  onProgress = null
} = {}) {
  if (!originalAudioBuffer?.length) throw new Error('Missing original audio buffer')

  const startedAt = globalThis.performance?.now?.() || Date.now()
  const source = copyAudioRange(originalAudioBuffer, sourceStartSeconds, sourceDurationSeconds, sampleRate)
  const ratio = clamp(Number(stretchRatio) || (targetDurationSeconds ? targetDurationSeconds / source.duration : 1), 0.25, 4)
  const inputLength = Math.max(1, source.length || 1)
  const renderSampleRate = Math.max(1, Number(sampleRate) || originalAudioBuffer.sampleRate || 44100)
  const outputLength = Math.max(1, Math.round((Number(targetDurationSeconds) > 0 ? Number(targetDurationSeconds) : source.duration * ratio) * renderSampleRate))
  await Promise.resolve()
  const outputBuffer = Math.abs(outputLength - inputLength) <= 8
    ? resampleBuffer(source, outputLength, renderSampleRate)
    : renderPhaseVocoderStretch(source, outputLength, renderSampleRate, onProgress)

  const renderedBlob = audioBufferToWavBlob(outputBuffer)
  const renderedObjectUrl = URL.createObjectURL(renderedBlob)
  return {
    clipId,
    renderedAudioBuffer: outputBuffer,
    renderedBlob,
    renderedObjectUrl,
    renderedDurationSeconds: outputBuffer.duration,
    algorithm: preservesPitchPreferred ? 'wsola_overlap_add_mvp_v1' : 'resample_mvp_v1',
    quality: 'mvp',
    preservesPitch: Boolean(preservesPitchPreferred),
    renderTimeMs: Math.max(0, Math.round((globalThis.performance?.now?.() || Date.now()) - startedAt)),
    createdAt: Date.now()
  }
}

export async function renderTimeStretch({
  sourceBuffer,
  sourceStartSeconds = 0,
  sourceDurationSeconds = null,
  targetDurationSeconds = null,
  sampleRate = sourceBuffer?.sampleRate || 44100,
  quality = 'mvp',
  onProgress = null
} = {}) {
  return renderStretchedAudioClip({
    originalAudioBuffer: sourceBuffer,
    stretchRatio: targetDurationSeconds && sourceDurationSeconds ? targetDurationSeconds / sourceDurationSeconds : 1,
    sourceStartSeconds,
    sourceDurationSeconds,
    targetDurationSeconds,
    sampleRate,
    preservesPitchPreferred: quality !== 'resample',
    onProgress
  })
}
