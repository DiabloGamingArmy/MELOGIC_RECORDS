import { getDawPluginDefinition } from './pluginCatalog.js'

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]))
}

function numberParam(params, key, fallback = 0) {
  return Number.isFinite(Number(params[key])) ? Number(params[key]) : fallback
}

function sliderControl({ label, param, value, min = 0, max = 1, step = 0.01, suffix = '' }) {
  return `
    <label class="daw-plugin-control">
      <span>${esc(label)}</span>
      <input data-plugin-param="${esc(param)}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" />
      <em data-plugin-param-value="${esc(param)}">${esc(`${Number(value).toFixed(step < 0.01 ? 3 : 2)}${suffix}`)}</em>
    </label>
  `
}

export function renderMelogicWavetableShell(instance = {}, { hostMode = 'inline' } = {}) {
  const definition = getDawPluginDefinition(instance.pluginType)
  const params = { ...definition.defaultParams, ...(instance.params || {}) }
  const keyboard = [
    ['C', 60], ['D', 62], ['E', 64], ['F', 65], ['G', 67], ['A', 69], ['B', 71], ['C', 72]
  ]
  return `
    <article class="daw-plugin-shell" data-plugin-shell="${esc(instance.pluginInstanceId || '')}" data-host-mode="${esc(hostMode)}">
      <header class="daw-plugin-hero">
        <div>
          <span class="daw-plugin-kicker">Built-in instrument</span>
          <h2>${esc(instance.title || definition.title)}</h2>
          <p>Reusable plugin host shell. Sound engine, modulation matrix, wavetable editor, and preset library land in later DAW phases.</p>
        </div>
        <label class="daw-plugin-preset">
          <span>Preset</span>
          <select data-plugin-param="preset">
            ${['Init Patch', 'Wide Digital Pad', 'Glass Pluck', 'Sub Motion', 'Bright Lead'].map((preset) => `<option ${params.preset === preset ? 'selected' : ''}>${esc(preset)}</option>`).join('')}
          </select>
        </label>
      </header>
      <div class="daw-plugin-grid">
        <section class="daw-plugin-section">
          <header>
            <span>OSC</span>
            <h3>Oscillator</h3>
          </header>
          <label class="daw-plugin-control">
            <span>Wave</span>
            <select data-plugin-param="oscillatorType">
              ${['sine', 'sawtooth', 'square', 'triangle'].map((type) => `<option value="${esc(type)}" ${params.oscillatorType === type ? 'selected' : ''}>${esc(type)}</option>`).join('')}
            </select>
          </label>
          <p>Temporary single-oscillator engine. Wavetables, warp modes, and unison arrive later.</p>
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>AMP</span>
            <h3>Envelope</h3>
          </header>
          ${sliderControl({ label: 'Attack', param: 'attack', value: numberParam(params, 'attack', 0.02), min: 0.001, max: 1.5, step: 0.001 })}
          ${sliderControl({ label: 'Decay', param: 'decay', value: numberParam(params, 'decay', 0.14), min: 0.001, max: 2, step: 0.001 })}
          ${sliderControl({ label: 'Sustain', param: 'sustain', value: numberParam(params, 'sustain', 0.62), min: 0, max: 1, step: 0.01 })}
          ${sliderControl({ label: 'Release', param: 'release', value: numberParam(params, 'release', 0.24), min: 0.01, max: 3, step: 0.01 })}
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>MASTER</span>
            <h3>Output</h3>
          </header>
          ${sliderControl({ label: 'Volume', param: 'volume', value: numberParam(params, 'volume', 0.45), min: 0, max: 1, step: 0.01 })}
          <p>Main DAW tab owns the AudioContext. Detached windows send remote control messages only.</p>
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>FILTER</span>
            <h3>Filter</h3>
          </header>
          ${sliderControl({ label: 'Cutoff preview', param: 'filterCutoff', value: numberParam(params, 'filterCutoff', 0.62), min: 0, max: 1, step: 0.01 })}
          <p>Filter UI scaffold only; not connected to the basic oscillator prototype yet.</p>
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>LFO</span>
            <h3>Modulation</h3>
          </header>
          ${sliderControl({ label: 'Rate preview', param: 'lfoRate', value: numberParam(params, 'lfoRate', 0.25), min: 0, max: 1, step: 0.01 })}
          <p>Modulation assignment and matrix routing are planned for later phases.</p>
        </section>
        <section class="daw-plugin-section daw-plugin-keyboard-panel">
          <header>
            <span>MIDI</span>
            <h3>Keyboard</h3>
          </header>
          <div class="daw-plugin-keyboard" aria-label="Keyboard placeholder">
            ${keyboard.map(([key, note]) => `<button type="button" data-plugin-note="${note}" aria-label="Play ${esc(key)}">${esc(key)}</button>`).join('')}
          </div>
          <p>Click or press a key to test the temporary synth voice.</p>
        </section>
      </div>
    </article>
  `
}

export function renderPluginShell(instance = {}, options = {}) {
  return renderMelogicWavetableShell(instance, options)
}
