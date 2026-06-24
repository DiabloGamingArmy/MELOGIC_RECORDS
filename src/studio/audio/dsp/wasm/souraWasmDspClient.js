import {
  SOURA_AUDIO_DSP_ENGINE_ID,
  SOURA_AUDIO_DSP_ENGINE_LABEL,
  SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  SOURA_AUDIO_DSP_ENGINE_TYPE,
  SOURA_AUDIO_DSP_REQUIRED_ERROR
} from '../audioDspTypes.js'

const allowLegacyJsDspFallback = import.meta.env?.VITE_SOURA_ALLOW_LEGACY_JS_DSP === 'true'

let worker = null
let nextMessageId = 1
let initPromise = null
const pending = new Map()
let status = {
  status: 'idle',
  engineId: SOURA_AUDIO_DSP_ENGINE_ID,
  engineLabel: SOURA_AUDIO_DSP_ENGINE_LABEL,
  engineType: SOURA_AUDIO_DSP_ENGINE_TYPE,
  requiresWasm: SOURA_AUDIO_DSP_ENGINE_REQUIRES_WASM,
  quality: 'high',
  error: '',
  legacyFallbackEnabled: allowLegacyJsDspFallback
}

function setStatus(patch = {}) {
  status = { ...status, ...patch }
}

function getWorker() {
  if (worker) return worker
  if (typeof Worker === 'undefined') {
    setStatus({ status: 'failed', error: 'Web Worker support is required for Soura WASM DSP rendering.' })
    throw new Error(SOURA_AUDIO_DSP_REQUIRED_ERROR)
  }
  worker = new Worker(new URL('./souraWasmDspWorker.js', import.meta.url), { type: 'module' })
  worker.onmessage = (event) => {
    const { id, ok, result, error } = event.data || {}
    const item = pending.get(id)
    if (!item) return
    pending.delete(id)
    if (ok) item.resolve(result)
    else item.reject(new Error(error || SOURA_AUDIO_DSP_REQUIRED_ERROR))
  }
  worker.onerror = (event) => {
    const message = event?.message || SOURA_AUDIO_DSP_REQUIRED_ERROR
    setStatus({ status: 'failed', error: message })
    pending.forEach((item) => item.reject(new Error(message)))
    pending.clear()
  }
  return worker
}

function request(type, payload = {}, transfer = []) {
  const target = getWorker()
  const id = nextMessageId++
  const promise = new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
  target.postMessage({ id, type, payload }, transfer)
  return promise
}

export function getSouraWasmDspStatusSnapshot() {
  return { ...status }
}

export function isLegacyJsDspFallbackEnabled() {
  return allowLegacyJsDspFallback
}

export async function preloadSouraWasmDsp() {
  if (initPromise) return initPromise
  setStatus({ status: 'loading', error: '' })
  initPromise = request('init')
    .then((engine) => {
      setStatus({ status: 'loaded', error: '', ...engine })
      return engine
    })
    .catch((err) => {
      const message = err?.message || SOURA_AUDIO_DSP_REQUIRED_ERROR
      setStatus({ status: 'failed', error: message })
      initPromise = null
      throw new Error(message)
    })
  return initPromise
}

export async function renderWithSouraWasmDsp(payload = {}) {
  await preloadSouraWasmDsp()
  const input = payload.inputPcm instanceof Float32Array ? payload.inputPcm : new Float32Array(payload.inputPcm || [])
  const requestPayload = { ...payload, inputPcm: undefined, inputBuffer: input.buffer }
  const result = await request('render', requestPayload, [input.buffer])
  setStatus({ status: 'loaded', error: '', quality: payload.quality || status.quality || 'high' })
  return {
    ...result,
    outputPcm: new Float32Array(result.outputBuffer)
  }
}
