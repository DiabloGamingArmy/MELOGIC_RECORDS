import test from 'node:test'
import assert from 'node:assert/strict'
import { getSouraRuntimeCapabilities, isSouraDesktopRuntime } from '../src/studio/runtime/SouraRuntimeCapabilities.js'

test('runtime capabilities explicitly distinguish web and desktop', () => {
  const webScope = {
    navigator: { userAgent: 'Browser', storage: { getDirectory() {} } },
    AudioContext: function AudioContext() {},
    AudioWorkletNode: function AudioWorkletNode() {},
    OfflineAudioContext: function OfflineAudioContext() {},
    Worker: function Worker() {},
    WebAssembly: {},
    SharedArrayBuffer: function SharedArrayBuffer() {},
    crossOriginIsolated: true
  }
  const web = getSouraRuntimeCapabilities(webScope)
  assert.equal(web.runtime, 'web')
  assert.equal(web.offlineAudio, true)
  assert.equal(web.opfs, true)
  assert.equal(web.nativeVst3Host, false)

  const desktopScope = { ...webScope, __TAURI_INTERNALS__: {} }
  const desktop = getSouraRuntimeCapabilities(desktopScope)
  assert.equal(isSouraDesktopRuntime(desktopScope), true)
  assert.equal(desktop.runtime, 'desktop')
  assert.equal(desktop.nativeVst3Host, true)
  assert.equal(desktop.nativeOfflinePluginRender, false)
})

