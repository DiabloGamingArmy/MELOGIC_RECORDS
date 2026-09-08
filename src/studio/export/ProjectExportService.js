import { sanitizeExportName } from './exportPlan.js'
export function encodeExport(buffer, options, signal, progress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./wav.worker.js', import.meta.url), { type: 'module' })
    const finish = (error, result) => { worker.terminate(); signal.removeEventListener('abort', cancel); error ? reject(error) : resolve(result) }
    const cancel = () => finish(new DOMException('Export cancelled.', 'AbortError'))
    if (signal.aborted) { cancel(); return }
    signal.addEventListener('abort', cancel, { once: true })
    worker.onerror = event => finish(new Error(`Audio encoder failed: ${event.message}`))
    worker.onmessage = ({ data }) => {
      if (data.error) finish(new Error(data.error))
      else if (data.buffer) finish(null, data)
      else progress(`Encoding… ${Math.round(data.progress * 100)}%`)
    }
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i).slice())
    worker.postMessage({ channels, sampleRate: buffer.sampleRate, ...options }, channels.map(c => c.buffer))
  })
}
export async function saveExport(buffer, name, desktop, signal) {
  signal.throwIfAborted()
  const filename = sanitizeExportName(name)
  if (desktop) {
    const { invoke } = await import('@tauri-apps/api/core')
    const id = await invoke('project_export_begin', { name: filename })
    if (!id) throw new DOMException('Save cancelled.', 'AbortError')
    try {
      const bytes = new Uint8Array(buffer)
      for (let offset = 0; offset < bytes.length; offset += 262144) {
        signal.throwIfAborted()
        await invoke('project_export_write', { id, bytes: Array.from(bytes.subarray(offset, offset + 262144)) })
      }
      signal.throwIfAborted()
      await invoke('project_export_finish', { id })
    } catch (error) { await invoke('project_export_cancel', { id }).catch(() => {}); throw error }
  } else {
    const url = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }))
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
    document.body.append(anchor); anchor.click(); anchor.remove()
    setTimeout(() => URL.revokeObjectURL(url), 30000)
  }
}
