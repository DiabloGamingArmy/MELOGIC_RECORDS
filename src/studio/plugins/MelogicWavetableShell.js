import { BUILT_IN_WAVETABLE_METADATA } from '../instruments/wavetableAssets.js'
import { getDawPluginDefinition } from './pluginCatalog.js'
import { MELOGIC_WAVETABLE_PRESETS } from './melogicWavetablePresets.js'

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

function boolParam(params, key, fallback = false) {
  if (params[key] === 'false') return false
  if (params[key] === 'true') return true
  return typeof params[key] === 'boolean' ? params[key] : fallback
}

function sliderControl({ label, param, value, min = 0, max = 1, step = 0.01, suffix = '' }) {
  const precision = step < 0.01 ? 3 : 2
  return `
    <label class="daw-plugin-control">
      <span>${esc(label)}</span>
      <input data-plugin-param="${esc(param)}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" />
      <em data-plugin-param-value="${esc(param)}">${esc(`${Number(value).toFixed(precision)}${suffix}`)}</em>
    </label>
  `
}

function selectControl({ label, param, value, options }) {
  return `
    <label class="daw-plugin-control">
      <span>${esc(label)}</span>
      <select data-plugin-param="${esc(param)}">
        ${options.map((option) => {
          const optionValue = typeof option === 'string' ? option : option.value
          const optionLabel = typeof option === 'string' ? option : option.label
          return `<option value="${esc(optionValue)}" ${String(value) === String(optionValue) ? 'selected' : ''}>${esc(optionLabel)}</option>`
        }).join('')}
      </select>
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
    <article class="daw-plugin-shell daw-wavetable-shell" data-plugin-shell="${esc(instance.pluginInstanceId || '')}" data-host-mode="${esc(hostMode)}">
      <header class="daw-plugin-hero">
        <div>
          <span class="daw-plugin-kicker">Built-in wavetable synth</span>
          <h2>${esc(instance.title || definition.title)}</h2>
          <p>Original Melogic wavetable MVP with generated built-in tables, filter, amp envelope, LFO, and local presets.</p>
        </div>
        <label class="daw-plugin-preset">
          <span>Preset</span>
          <select data-plugin-param="preset">
            ${MELOGIC_WAVETABLE_PRESETS.map((preset) => `<option value="${esc(preset.id)}" ${params.preset === preset.id || params.preset === preset.name ? 'selected' : ''}>${esc(preset.name)}</option>`).join('')}
          </select>
        </label>
      </header>
      <div class="daw-plugin-grid">
        <section class="daw-plugin-section daw-plugin-section--wide">
          <header>
            <span>OSC 1</span>
            <h3>Wavetable</h3>
          </header>
          ${selectControl({
            label: 'Table',
            param: 'wavetableId',
            value: params.wavetableId,
            options: BUILT_IN_WAVETABLE_METADATA.map((asset) => ({ value: asset.assetId, label: asset.title }))
          })}
          ${sliderControl({ label: 'Position', param: 'wavetablePosition', value: numberParam(params, 'wavetablePosition', 0.35), min: 0, max: 1, step: 0.01 })}
          ${sliderControl({ label: 'Coarse', param: 'coarsePitch', value: numberParam(params, 'coarsePitch', 0), min: -24, max: 24, step: 1, suffix: ' st' })}
          ${sliderControl({ label: 'Fine', param: 'finePitch', value: numberParam(params, 'finePitch', 0), min: -100, max: 100, step: 1, suffix: ' ct' })}
          ${sliderControl({ label: 'Unison', param: 'unisonVoices', value: numberParam(params, 'unisonVoices', 1), min: 1, max: 5, step: 1 })}
          ${sliderControl({ label: 'Detune', param: 'detune', value: numberParam(params, 'detune', 0.08), min: 0, max: 1, step: 0.01 })}
          ${sliderControl({ label: 'Level', param: 'oscLevel', value: numberParam(params, 'oscLevel', 0.85), min: 0, max: 1, step: 0.01 })}
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>FILTER</span>
            <h3>Filter</h3>
          </header>
          ${selectControl({ label: 'Mode', param: 'filterType', value: params.filterType, options: ['lowpass', 'highpass', 'bandpass'] })}
          ${selectControl({ label: 'State', param: 'filterEnabled', value: String(boolParam(params, 'filterEnabled', true)), options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Bypass' }] })}
          ${sliderControl({ label: 'Cutoff', param: 'filterCutoff', value: numberParam(params, 'filterCutoff', 0.72), min: 0, max: 1, step: 0.01 })}
          ${sliderControl({ label: 'Resonance', param: 'resonance', value: numberParam(params, 'resonance', 0.18), min: 0, max: 1, step: 0.01 })}
          <p>Drive is planned; filter cutoff and resonance are live.</p>
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>ENV 1</span>
            <h3>Amp Envelope</h3>
          </header>
          ${sliderControl({ label: 'Attack', param: 'attack', value: numberParam(params, 'attack', 0.02), min: 0.001, max: 1.5, step: 0.001 })}
          ${sliderControl({ label: 'Decay', param: 'decay', value: numberParam(params, 'decay', 0.16), min: 0.001, max: 2, step: 0.001 })}
          ${sliderControl({ label: 'Sustain', param: 'sustain', value: numberParam(params, 'sustain', 0.68), min: 0, max: 1, step: 0.01 })}
          ${sliderControl({ label: 'Release', param: 'release', value: numberParam(params, 'release', 0.24), min: 0.01, max: 3, step: 0.01 })}
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>LFO 1</span>
            <h3>Modulation</h3>
          </header>
          ${selectControl({ label: 'Shape', param: 'lfoShape', value: params.lfoShape, options: ['sine', 'triangle', 'square', 'sawtooth'] })}
          ${selectControl({ label: 'Target', param: 'lfoTarget', value: params.lfoTarget, options: [{ value: 'none', label: 'None' }, { value: 'filterCutoff', label: 'Filter Cutoff' }, { value: 'pitch', label: 'Pitch' }, { value: 'wavetablePosition', label: 'WT Position' }] })}
          ${sliderControl({ label: 'Rate', param: 'lfoRate', value: numberParam(params, 'lfoRate', 0.35), min: 0.01, max: 20, step: 0.01, suffix: ' hz' })}
          ${sliderControl({ label: 'Amount', param: 'lfoAmount', value: numberParam(params, 'lfoAmount', 0), min: 0, max: 1, step: 0.01 })}
          <p>WT-position LFO is scaffolded; pitch and filter targets are live.</p>
        </section>
        <section class="daw-plugin-section">
          <header>
            <span>OUT</span>
            <h3>Output</h3>
          </header>
          ${sliderControl({ label: 'Volume', param: 'volume', value: numberParam(params, 'volume', 0.45), min: 0, max: 1, step: 0.01 })}
          <p>Main DAW tab owns audio. Pop-outs are remote controls.</p>
        </section>
        <section class="daw-plugin-section daw-plugin-keyboard-panel">
          <header>
            <span>MIDI</span>
            <h3>Keyboard</h3>
          </header>
          <div class="daw-plugin-keyboard" aria-label="Keyboard placeholder">
            ${keyboard.map(([key, note]) => `<button type="button" data-plugin-note="${note}" aria-label="Play ${esc(key)}">${esc(key)}</button>`).join('')}
          </div>
          <p>Click keys to audition the synth. Hardware MIDI comes later.</p>
        </section>
      </div>
    </article>
  `
}

export function renderPluginShell(instance = {}, options = {}) {
  return renderMelogicWavetableShell(instance, options)
}
