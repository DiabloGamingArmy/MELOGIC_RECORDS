import { analyzePcmSource } from './audioAnalysisCore.js'

function abortError() {
  const error = new Error('Audio analysis was cancelled.')
  error.name = 'AbortError'
  return error
}

export class WebAnalysisProvider {
  constructor({ workerFactory, fallback = analyzePcmSource } = {}) {
    this.kind = 'web-worker'
    this.workerFactory = workerFactory || (() => new Worker(new URL('./audioAnalysisWorker.js', import.meta.url), { type: 'module' }))
    this.fallback = fallback
    this.jobs = new Map()
  }

  async analyze(request, { onProgress, signal } = {}) {
    if (signal?.aborted) throw abortError()
    const jobId = request.jobId || `web-analysis:${Date.now()}:${Math.random().toString(36).slice(2)}`
    let worker
    try {
      worker = this.workerFactory()
    } catch (workerError) {
      return this.analyzeFallback(request, { onProgress, signal, workerError })
    }
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        signal?.removeEventListener?.('abort', cancel)
        worker?.terminate?.()
        this.jobs.delete(jobId)
      }
      const cancel = () => {
        try { worker.postMessage({ type: 'cancel', jobId }) } catch {}
        cleanup()
        reject(abortError())
      }
      this.jobs.set(jobId, { worker, cancel })
      signal?.addEventListener?.('abort', cancel, { once: true })
      worker.onmessage = (event) => {
        const message = event.data || {}
        if (message.jobId !== jobId) return
        if (message.type === 'progress') { onProgress?.({ progress: message.progress, phase: message.phase }); return }
        cleanup()
        if (message.type === 'complete') resolve(message.result)
        else if (message.type === 'cancelled') reject(abortError())
        else reject(new Error(message.message || 'Audio analysis worker failed.'))
      }
      worker.onerror = (event) => {
        cleanup()
        reject(event?.error || new Error(event?.message || 'Audio analysis worker failed.'))
      }
      try {
        const transfer = (request.channels || []).map((channel) => channel.buffer).filter(Boolean)
        worker.postMessage({ type: 'analyze', jobId, request }, transfer)
      } catch (error) {
        cleanup()
        this.analyzeFallback(request, { onProgress, signal, workerError: error }).then(resolve, reject)
      }
    })
  }

  async analyzeFallback(request, { onProgress, signal, workerError } = {}) {
    if (signal?.aborted) throw abortError()
    await new Promise((resolve) => setTimeout(resolve, 0))
    const result = this.fallback(request, {
      provider: 'web-fallback',
      isCancelled: () => Boolean(signal?.aborted),
      onProgress
    })
    result.metadata.warnings = [...(result.metadata.warnings || []), `Worker fallback used${workerError?.message ? `: ${workerError.message}` : '.'}`]
    return result
  }

  cancel(jobId) {
    this.jobs.get(jobId)?.cancel?.()
  }
}

export default WebAnalysisProvider
