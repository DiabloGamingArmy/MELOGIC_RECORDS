// One writer per open editor; newer edits never race an older outstanding write.
export function createEditorSaveQueue({ capture, write, onStatus = () => {}, delay = 800, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let revision = 0, savedRevision = 0, timer = null, running = null
  const pending = () => revision !== savedRevision
  const flush = () => {
    if (timer !== null) { clearTimer(timer); timer = null }
    if (running) return running
    if (!pending()) return Promise.resolve()
    running = Promise.resolve().then(async () => {
      while (pending()) {
        const current = revision
        const snapshot = capture()
        onStatus('Saving…')
        await write(snapshot)
        savedRevision = current
      }
      onStatus('Saved')
    }).catch(error => { onStatus('Save failed', error); throw error }).finally(() => { running = null })
    return running
  }
  return {
    pending,
    flush,
    schedule() {
      revision++
      onStatus('Saving…')
      if (timer !== null) clearTimer(timer)
      timer = setTimer(() => { timer = null; void flush().catch(() => {}) }, delay)
    }
  }
}
