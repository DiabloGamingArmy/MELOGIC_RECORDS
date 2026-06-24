import { renderPitchShiftedAudio, renderPitchTraceEdits } from '../audioPitchRenderService.js'
import { renderTimeStretch } from '../audioStretchRenderService.js'
import {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_OPERATIONS
} from './audioDspTypes.js'

function withDspMetadata(result = {}, { operation = '', quality = 'high', sourceBuffer = null } = {}) {
  const renderedBuffer = result.renderedAudioBuffer || null
  const sourceSampleRate = Number(sourceBuffer?.sampleRate)
  const renderedSampleRate = Number(renderedBuffer?.sampleRate)
  const sourceChannels = Number(sourceBuffer?.numberOfChannels)
  const renderedChannels = Number(renderedBuffer?.numberOfChannels)
  return {
    ...result,
    engine: SOURA_AUDIO_DSP_ENGINE_ID,
    engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
    operation,
    quality,
    renderedAudio: {
      ...(result.renderedAudio || {}),
      engine: SOURA_AUDIO_DSP_ENGINE_ID,
      engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
      operation,
      quality,
      qualityMode: result.renderedAudio?.qualityMode || quality,
      sampleRatePreserved: Number.isFinite(sourceSampleRate) && Number.isFinite(renderedSampleRate) ? sourceSampleRate === renderedSampleRate : false,
      channelCountPreserved: Number.isFinite(sourceChannels) && Number.isFinite(renderedChannels) ? sourceChannels === renderedChannels : false
    }
  }
}

export async function renderAudioDsp(operation, options = {}) {
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.timeStretch) {
    const result = await renderTimeStretch(options)
    return withDspMetadata(result, {
      operation,
      quality: options.quality || result.quality || 'high',
      sourceBuffer: options.sourceBuffer
    })
  }
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchShift) {
    const result = await renderPitchShiftedAudio(options)
    return withDspMetadata(result, {
      operation,
      quality: options.quality || result.quality || 'high',
      sourceBuffer: options.audioBuffer
    })
  }
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchTrace) {
    const result = await renderPitchTraceEdits(options)
    return withDspMetadata(result, {
      operation,
      quality: options.quality || result.quality || 'high',
      sourceBuffer: options.audioBuffer
    })
  }
  throw new Error(`Unsupported Soura DSP operation: ${operation}`)
}

export { SOURA_AUDIO_DSP_ENGINE_ID, SOURA_AUDIO_DSP_ENGINE_LABEL, SOURA_AUDIO_DSP_OPERATIONS }
