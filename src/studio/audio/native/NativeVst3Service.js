import { ensureNativeVst3Host, nativeVst3OpenEditor, nativeVst3SetMix } from './NativeVst3HostService.js'
const NATIVE_VST3_TYPE = 'native-vst3'
let invokeFn = null

async function getInvoke() {
  if (invokeFn) return invokeFn
  const mod = await import('@tauri-apps/api/core')
  invokeFn = mod.invoke
  return invokeFn
}

export function isNativeVst3Runtime() {
  return Boolean(
    globalThis.__TAURI_INTERNALS__
    || globalThis.__TAURI__
    || navigator.userAgent.includes('Tauri')
  )
}

export function isNativeVst3Instrument(instrument) {
  return instrument?.type === NATIVE_VST3_TYPE
}

export async function scanInstalledNativeVst3() {
  if (!isNativeVst3Runtime()) {
    throw new Error('Installed VST3 plug-ins are available only in Soura Desktop.')
  }
  const invoke = await getInvoke()
  const plugins = await invoke('native_vst3_scan')
  return Array.isArray(plugins) ? plugins : []
}

export async function isNativeVst3PathAvailable(path = '') {
  if (!isNativeVst3Runtime() || !path) return false
  const invoke = await getInvoke()
  return Boolean(await invoke('native_vst3_is_available', { path }))
}

export function createNativeVst3TrackInstrument(plugin, trackId = '') {
  if (!plugin?.path) throw new Error('A VST3 bundle path is required.')
  const stableKey = String(plugin.bundleId || plugin.path)
  return {
    id: `instrument-native-vst3-${Date.now()}`,
    type: NATIVE_VST3_TYPE,
    name: plugin.name || 'VST3 Instrument',
    enabled: true,
    pluginInstanceId: `native-vst3:${trackId}:${stableKey}`,
    params: {
      nativePluginPath: plugin.path,
      nativePluginName: plugin.name || '',
      nativePluginVendor: plugin.vendor || '',
      nativePluginVersion: plugin.version || '',
      nativePluginBundleId: plugin.bundleId || '',
      nativePluginFormat: 'VST3',
      nativeExecutionState: 'discovered'
    }
  }
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  }[char]))
}

export async function chooseInstalledNativeVst3() {
  if (!isNativeVst3Runtime()) {
    window.alert('Native VST3 instruments are available in Soura Desktop only. Web Soura continues to use .soura-plugin / WASM instruments.')
    return null
  }

  const plugins = await scanInstalledNativeVst3()
  if (!plugins.length) {
    window.alert('No installed VST3 plug-ins were found in the standard system or user VST3 folders.')
    return null
  }

  return new Promise((resolve) => {
    const overlay = document.createElement('div')
    overlay.dataset.souraNativeVst3Picker = '1'
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.68);display:grid;place-items:center;padding:24px;'
    overlay.innerHTML = `
      <section style="width:min(760px,94vw);max-height:min(720px,88vh);overflow:hidden;background:#151922;border:1px solid rgba(255,255,255,.14);border-radius:14px;box-shadow:0 24px 80px rgba(0,0,0,.5);display:flex;flex-direction:column;color:#f4f7fb;font:13px/1.4 system-ui,sans-serif;">
        <header style="padding:18px 20px 12px;border-bottom:1px solid rgba(255,255,255,.1);">
          <strong style="font-size:16px;">Installed VST3 Instruments</strong>
          <div style="margin-top:5px;color:#9ca7b8;">${plugins.length} VST3 bundle${plugins.length === 1 ? '' : 's'} discovered on this computer.</div>
        </header>
        <div style="padding:14px 20px 8px;">
          <input data-vst3-filter type="search" placeholder="Search plug-ins…" style="box-sizing:border-box;width:100%;padding:10px 12px;background:#0d1118;border:1px solid rgba(255,255,255,.14);border-radius:8px;color:inherit;outline:none;">
        </div>
        <div data-vst3-list style="padding:6px 12px 14px;overflow:auto;min-height:240px;"></div>
        <footer style="display:flex;justify-content:space-between;gap:12px;padding:12px 20px;border-top:1px solid rgba(255,255,255,.1);color:#8f9bad;">
          <span>Selection is stored with the track. Native DSP hosting is a separate engine stage.</span>
          <button data-vst3-cancel type="button" style="padding:8px 13px;border-radius:7px;border:1px solid rgba(255,255,255,.16);background:#232a36;color:#fff;cursor:pointer;">Cancel</button>
        </footer>
      </section>`

    const list = overlay.querySelector('[data-vst3-list]')
    const filter = overlay.querySelector('[data-vst3-filter]')
    const close = (value) => { overlay.remove(); resolve(value) }

    const render = () => {
      const query = String(filter.value || '').trim().toLowerCase()
      const visible = plugins.filter((plugin) => [plugin.name, plugin.vendor, plugin.path].join(' ').toLowerCase().includes(query))
      list.innerHTML = visible.map((plugin, index) => `
        <button type="button" data-vst3-choice="${index}" data-vst3-path="${escapeHtml(plugin.path)}" style="width:100%;text-align:left;margin:3px 0;padding:11px 12px;border:1px solid rgba(255,255,255,.09);border-radius:8px;background:#1b202b;color:#f4f7fb;cursor:pointer;">
          <strong style="display:block;font-size:13px;">${escapeHtml(plugin.name || 'Unknown VST3')}</strong>
          <span style="display:block;margin-top:2px;color:#9ba6b6;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(plugin.vendor || plugin.version || plugin.path)}</span>
        </button>`).join('') || '<div style="padding:24px;color:#9ba6b6;text-align:center;">No matching plug-ins.</div>'

      list.querySelectorAll('[data-vst3-choice]').forEach((button) => {
        button.addEventListener('click', () => {
          const path = button.dataset.vst3Path
          close(plugins.find((plugin) => plugin.path === path) || null)
        })
      })
    }

    filter.addEventListener('input', render)
    overlay.querySelector('[data-vst3-cancel]').addEventListener('click', () => close(null))
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(null) })
    document.body.appendChild(overlay)
    render()
    filter.focus()
  })
}

export async function showNativeVst3ExecutionStatus(instrument) {
  const instanceId = instrument?.pluginInstanceId
  const path = instrument?.params?.nativePluginPath || ''
  if (!instanceId || !path) throw new Error('Native VST3 instrument state is incomplete.')
  await ensureNativeVst3Host({ instanceId, path, sampleRate: 48000, maxBlockSize: 512 })
  return nativeVst3OpenEditor(instanceId)
}
export { NATIVE_VST3_TYPE, nativeVst3SetMix }
