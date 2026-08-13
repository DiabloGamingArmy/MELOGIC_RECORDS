import { analyzePcmSource } from './audioAnalysisCore.js'

const cancelledJobs = new Set()

self.onmessage = (event) => {
  const message = event.data || {}
  if (message.type === 'cancel') {
    cancelledJobs.add(message.jobId)
    return
  }
  if (message.type !== 'analyze' || !message.jobId) return
  const { jobId, request } = message
  try {
    const result = analyzePcmSource(request, {
      provider: 'web-worker',
      isCancelled: () => cancelledJobs.has(jobId),
      onProgress: (update) => self.postMessage({ type: 'progress', jobId, ...update })
    })
    if (!cancelledJobs.has(jobId)) self.postMessage({ type: 'complete', jobId, result })
  } catch (error) {
    self.postMessage({ type: error?.name === 'AbortError' ? 'cancelled' : 'error', jobId, message: error?.message || 'Audio analysis failed.' })
  } finally {
    cancelledJobs.delete(jobId)
  }
}

