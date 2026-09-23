const enabled = Boolean(import.meta.env?.DEV)

export function markDevPerformance(name, detail = {}) {
  if (!enabled) return
  const cleanName = `melogic:${String(name || 'event')}`
  try { performance.mark(cleanName) } catch {}
  try { globalThis.dispatchEvent?.(new CustomEvent('melogic:dev-performance', { detail: { name, ...detail } })) } catch {}
}

export function measureDevPerformance(name, startMark, detail = {}) {
  if (!enabled) return
  const endMark = `melogic:${String(name || 'event')}:end`
  try {
    performance.mark(endMark)
    performance.measure(`melogic:${name}`, startMark, endMark)
    const duration = performance.getEntriesByName(`melogic:${name}`).at(-1)?.duration
    globalThis.dispatchEvent?.(new CustomEvent('melogic:dev-performance', { detail: { name, duration, ...detail } }))
  } catch {}
}
