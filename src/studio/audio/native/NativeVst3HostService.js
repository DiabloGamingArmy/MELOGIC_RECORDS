let invokeFn = null
async function getInvoke() {
  if (invokeFn) return invokeFn
  const mod = await import('@tauri-apps/api/core')
  invokeFn = mod.invoke
  return invokeFn
}
export function isNativeVst3HostRuntime() {
  return Boolean(globalThis.__TAURI_INTERNALS__ || globalThis.__TAURI__ || navigator.userAgent.includes('Tauri'))
}
export async function ensureNativeVst3Host({ instanceId, path, sampleRate = 48000, maxBlockSize = 512 } = {}) {
  if (!isNativeVst3HostRuntime()) throw new Error('Native VST3 hosting is available only in Soura Desktop.')
  if (!instanceId || !path) throw new Error('VST3 instanceId and path are required.')
  return (await getInvoke())('native_vst3_host_create', { instanceId, path, sampleRate, maxBlockSize })
}
export async function nativeVst3NoteOn(instanceId, note, velocity = 0.85, channel = 0) {
  return (await getInvoke())('native_vst3_host_note_on', { instanceId, note: Number(note), velocity: Number(velocity), channel: Number(channel) })
}
export async function nativeVst3NoteOff(instanceId, note, velocity = 0, channel = 0) {
  return (await getInvoke())('native_vst3_host_note_off', { instanceId, note: Number(note), velocity: Number(velocity), channel: Number(channel) })
}
export async function nativeVst3OpenEditor(instanceId) {
  return (await getInvoke())('native_vst3_host_open_editor', { instanceId })
}
export async function nativeVst3SetMix(instanceId, { gain = 1, pan = 0, muted = false } = {}) {
  if (!instanceId || !isNativeVst3HostRuntime()) return
  return (await getInvoke())('native_vst3_host_set_mix', { instanceId, gain: Number(gain), pan: Number(pan), muted: Boolean(muted) })
}
export async function disposeNativeVst3Host(instanceId) {
  if (!instanceId || !isNativeVst3HostRuntime()) return
  return (await getInvoke())('native_vst3_host_dispose', { instanceId })
}
