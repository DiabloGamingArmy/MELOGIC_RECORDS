// Control-plane ordering only: never used by an audio callback. Register a
// teardown immediately so replacement instances cannot reuse a retiring host.
export function createNativeInstanceCommandQueue() {
  const pending = new Map()
  return function enqueue(instanceId, operation) {
    const previous = pending.get(instanceId) || Promise.resolve()
    const result = previous.catch(() => {}).then(operation)
    pending.set(instanceId, result)
    const settled = () => { if (pending.get(instanceId) === result) pending.delete(instanceId) }
    result.then(settled, settled)
    return result
  }
}
