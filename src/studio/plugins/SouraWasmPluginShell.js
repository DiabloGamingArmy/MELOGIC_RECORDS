import { getInstalledSouraPluginManifestByType, isSouraWasmPluginType } from './souraWasmPluginPackage.js'

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[char]))
}

export { isSouraWasmPluginType }

export function renderSouraWasmPluginShell(pluginWindow) {
  const manifest = getInstalledSouraPluginManifestByType(pluginWindow?.pluginType)
  if (!manifest) return `<section class="daw-plugin-shell" data-plugin-shell="${esc(pluginWindow?.pluginInstanceId)}"><p>This Soura plugin is not installed on this device.</p></section>`
  const params = pluginWindow?.params || {}
  return `<section class="daw-plugin-shell" data-plugin-shell="${esc(pluginWindow.pluginInstanceId)}">
    <div style="padding:18px;display:grid;gap:14px">
      <header><strong>${esc(manifest.name)}</strong><div>${esc(manifest.vendor)} · ${esc(manifest.version)} · C++/WASM AudioWorklet</div></header>
      ${(manifest.parameters || []).map((parameter) => {
        const value = Number.isFinite(Number(params[parameter.id])) ? Number(params[parameter.id]) : parameter.default
        return `<label style="display:grid;grid-template-columns:140px 1fr 64px;gap:10px;align-items:center"><span>${esc(parameter.name)}</span><input type="range" data-plugin-param="${esc(parameter.id)}" min="${parameter.min}" max="${parameter.max}" step="${Math.max((parameter.max - parameter.min) / 1000, 0.0001)}" value="${value}"><output>${value.toFixed(3)}</output></label>`
      }).join('') || '<p>No exposed parameters.</p>'}
    </div>
  </section>`
}
