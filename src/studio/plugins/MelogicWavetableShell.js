import { getBuiltInWavetableSamples } from '../instruments/wavetableAssets.js'
import { listAudioAssetMetadata, STOCK_SOUND_PACKS } from '../audioAssetService.js'
import { getDawPluginDefinition } from './pluginCatalog.js'
import { MELOGIC_WAVETABLE_PRESETS } from './melogicWavetablePresets.js'

const MOD_SOURCES = [
  { value: 'lfo1', label: 'LFO 1' },
  { value: 'lfo2', label: 'LFO 2' },
  { value: 'env1', label: 'Main ENV' },
  { value: 'env2', label: 'ENV 2' },
  { value: 'macro1', label: 'Macro 1' },
  { value: 'macro2', label: 'Macro 2' },
  { value: 'macro3', label: 'Macro 3' },
  { value: 'macro4', label: 'Macro 4' },
  { value: 'velocity', label: 'Velocity placeholder' },
  { value: 'note', label: 'Note placeholder' }
]

const MOD_TARGETS = [
  { value: 'osc1.position', label: 'OSC 1 Position' },
  { value: 'osc1.pitch', label: 'OSC 1 Pitch' },
  { value: 'osc1.level', label: 'OSC 1 Level' },
  { value: 'osc1.pan', label: 'OSC 1 Pan' },
  { value: 'osc2.position', label: 'OSC 2 Position placeholder' },
  { value: 'osc3.position', label: 'OSC 3 Position placeholder' },
  { value: 'filter.cutoff', label: 'Filter Cutoff' },
  { value: 'filter.resonance', label: 'Filter Resonance' },
  { value: 'fx.mix', label: 'FX Mix placeholder' },
  { value: 'output.volume', label: 'Global Volume' }
]

const MOD_CURVES = [
  { value: 'linear', label: 'Linear' },
  { value: 'soft', label: 'Soft' },
  { value: 'exp', label: 'Exp' },
  { value: 'snap', label: 'Snap' }
]

const MWT_PAGES = [
  { id: 'browser', label: 'BROWSER' },
  { id: 'osc', label: 'OSC' },
  { id: 'fx', label: 'FX' },
  { id: 'mod', label: 'MOD' },
  { id: 'matrix', label: 'MATRIX' },
  { id: 'global', label: 'GLOBAL' }
]

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

function sliderControl({ label, param, value, min = 0, max = 1, step = 0.01, suffix = '' }) {
  const precision = step < 0.01 ? 3 : step >= 1 ? 0 : 2
  return `
    <label class="daw-plugin-control">
      <span>${esc(label)}</span>
      <input data-plugin-param="${esc(param)}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" />
      <em data-plugin-param-value="${esc(param)}">${esc(`${Number(value).toFixed(precision)}${suffix}`)}</em>
    </label>
  `
}

function knobControl({ label, param, value, min = 0, max = 1, step = 0.01, suffix = '' }) {
  const numeric = Number(value)
  const ratio = Math.max(0, Math.min(1, (numeric - Number(min)) / Math.max(0.0001, Number(max) - Number(min))))
  const angle = -135 + ratio * 270
  const precision = step >= 1 ? 0 : 2
  return `
    <label class="mwt-knob-control">
      <span>${esc(label)}</span>
      <b style="--knob-angle:${angle}deg"><input data-plugin-param="${esc(param)}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}" aria-label="${esc(label)}" /></b>
      <em data-plugin-param-value="${esc(param)}">${esc(`${Number(value).toFixed(precision)}${suffix}`)}</em>
    </label>
  `
}

function macroControl(index, value) {
  return knobControl({ label: `Macro ${index}`, param: `macro${index}`, value, min: 0, max: 1, step: 0.01 })
}

function matrixSelect({ row, field, value, options }) {
  return `
    <label>
      <span>${field === 'source' ? 'Source' : field === 'target' ? 'Target' : 'Curve'}</span>
      <select data-plugin-matrix-field="${esc(field)}" data-plugin-matrix-row="${esc(row)}">
        ${options.map((option) => `<option value="${esc(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
      </select>
    </label>
  `
}

function renderModulationMatrix(matrix = []) {
  const rows = Array.isArray(matrix) && matrix.length ? matrix : [
    { source: 'lfo1', target: 'filter.cutoff', amount: 0, bipolar: true, curve: 'linear', enabled: false },
    { source: 'macro1', target: 'osc1.position', amount: 0, bipolar: false, curve: 'linear', enabled: false }
  ]
  return rows.slice(0, 6).map((route, index) => `
    <div class="daw-plugin-mod-row" data-plugin-matrix-row-shell="${index}">
      <label><span>On</span><input data-plugin-matrix-field="enabled" data-plugin-matrix-row="${index}" type="checkbox" ${route.enabled ? 'checked' : ''} /></label>
      ${matrixSelect({ row: index, field: 'source', value: route.source, options: MOD_SOURCES })}
      <label><span>Amount</span><input data-plugin-matrix-field="amount" data-plugin-matrix-row="${index}" type="range" min="-1" max="1" step="0.01" value="${esc(route.amount ?? 0)}" /></label>
      <label><span>Bipolar</span><input data-plugin-matrix-field="bipolar" data-plugin-matrix-row="${index}" type="checkbox" ${route.bipolar !== false ? 'checked' : ''} /></label>
      ${matrixSelect({ row: index, field: 'target', value: route.target, options: MOD_TARGETS })}
      ${matrixSelect({ row: index, field: 'curve', value: route.curve || 'linear', options: MOD_CURVES })}
      <button type="button" class="mwt-remove-mod" data-plugin-remove-mod="${index}" aria-label="Remove modulation route">x</button>
    </div>
  `).join('')
}

function optionList(values = [], selected = '') {
  return values.map((value) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(value || 'All')}</option>`).join('')
}

function renderBrowserPage({ params, wavetableAssets, tags }) {
  return `
    <section class="mwt-page mwt-page--browser">
      <article class="mwt-panel mwt-panel--assets">
        <header><span>Browser</span><em>${esc(wavetableAssets.length)} tables</em></header>
        <div class="mwt-browser-filters">
          <select data-plugin-param="assetBrowserPack"><option value="">All Packs</option>${STOCK_SOUND_PACKS.map((pack) => `<option value="${esc(pack.packId)}" ${params.assetBrowserPack === pack.packId ? 'selected' : ''}>${esc(pack.title)}</option>`).join('')}</select>
          <select data-plugin-param="assetBrowserTag">${optionList(['', ...tags], params.assetBrowserTag || '')}</select>
          <input data-plugin-param="assetBrowserSearch" type="search" value="${esc(params.assetBrowserSearch || '')}" placeholder="Search wavetables" />
        </div>
        <div class="daw-plugin-asset-list mwt-asset-list">
          ${wavetableAssets.map((asset) => `
            <button type="button" data-plugin-asset-select="${esc(asset.assetId)}" class="${asset.assetId === params.wavetableId ? 'is-selected' : ''}">
              <strong>${esc(asset.title)}</strong>
              <span>${esc(asset.packId)} - ${esc((asset.tags || []).slice(0, 3).join(', '))}</span>
            </button>
          `).join('') || '<p>No matching tables.</p>'}
        </div>
      </article>
    </section>
  `
}

function renderOscPanel({ label, enabled, params, allWavetableAssets, prefix = 'osc1', active = false }) {
  const wavetableParam = active ? 'wavetableId' : `${prefix}WavetableId`
  const positionParam = active ? 'wavetablePosition' : `${prefix}Position`
  const enabledParam = active ? 'oscEnabled' : `${prefix}Enabled`
  const octaveParam = active ? 'octave' : `${prefix}Octave`
  const coarseParam = active ? 'coarsePitch' : `${prefix}CoarsePitch`
  const fineParam = active ? 'finePitch' : `${prefix}FinePitch`
  const unisonParam = active ? 'unisonVoices' : `${prefix}UnisonVoices`
  const detuneParam = active ? 'detune' : `${prefix}Detune`
  const blendParam = active ? 'unisonBlend' : `${prefix}Blend`
  const phaseParam = active ? 'phase' : `${prefix}Phase`
  const phaseRandomParam = active ? 'phaseRandom' : `${prefix}PhaseRandom`
  const levelParam = active ? 'oscLevel' : `${prefix}Level`
  const panParam = active ? 'oscPan' : `${prefix}Pan`
  const wavetable = params[wavetableParam] || params.wavetableId
  const isEnabled = boolParam(params, enabledParam, enabled)
  return `
    <article class="mwt-panel mwt-osc-panel ${active ? 'is-primary' : 'is-scaffold'}">
      <header><span>${esc(label)}</span><button type="button" class="mwt-power-button ${isEnabled ? 'is-on' : ''}" data-plugin-param-set="${esc(enabledParam)}" data-plugin-param-value="${isEnabled ? 'false' : 'true'}">${isEnabled ? 'On' : 'Off'}</button></header>
      ${selectControl({ label: 'Table', param: wavetableParam, value: wavetable, options: allWavetableAssets.map((asset) => ({ value: asset.assetId, label: asset.title })) })}
      <canvas class="daw-plugin-waveform mwt-waveform mwt-waveform--compact" width="420" height="112" data-wavetable-visualizer data-wavetable-id="${esc(wavetable)}" data-wavetable-position="${esc(numberParam(params, positionParam, 0.35))}" aria-label="${esc(label)} wavetable viewport"></canvas>
      <div class="mwt-osc-knobs">
        ${knobControl({ label: 'Position', param: positionParam, value: numberParam(params, positionParam, 0.35), min: 0, max: 1, step: 0.01 })}
        ${knobControl({ label: 'Octave', param: octaveParam, value: numberParam(params, octaveParam, 0), min: -4, max: 4, step: 1 })}
        ${knobControl({ label: 'Coarse', param: coarseParam, value: numberParam(params, coarseParam, 0), min: -24, max: 24, step: 1, suffix: ' st' })}
        ${knobControl({ label: 'Fine', param: fineParam, value: numberParam(params, fineParam, 0), min: -100, max: 100, step: 1, suffix: ' ct' })}
        ${knobControl({ label: 'Unison', param: unisonParam, value: numberParam(params, unisonParam, active ? 1 : 0), min: 0, max: 7, step: 1 })}
        ${knobControl({ label: 'Detune', param: detuneParam, value: numberParam(params, detuneParam, active ? 0.08 : 0), min: 0, max: 1, step: 0.01 })}
        ${knobControl({ label: 'Blend', param: blendParam, value: numberParam(params, blendParam, active ? 1 : 0), min: 0, max: 1, step: 0.01 })}
        ${knobControl({ label: 'Phase', param: phaseParam, value: numberParam(params, phaseParam, 0), min: 0, max: 1, step: 0.01 })}
        ${knobControl({ label: 'Rand', param: phaseRandomParam, value: numberParam(params, phaseRandomParam, active ? 0.15 : 0), min: 0, max: 1, step: 0.01 })}
        ${knobControl({ label: 'Level', param: levelParam, value: numberParam(params, levelParam, active ? 0.85 : 0), min: 0, max: 1, step: 0.01 })}
        ${knobControl({ label: 'Pan', param: panParam, value: numberParam(params, panParam, 0), min: -1, max: 1, step: 0.01 })}
      </div>
    </article>
  `
}

function renderOscPage({ params, allWavetableAssets }) {
  const oscCount = Math.max(1, Math.min(8, Number(params.oscCount) || 1))
  const selectedOsc = Math.max(1, Math.min(oscCount, Number(params.selectedOsc) || 1))
  const active = selectedOsc === 1
  const prefix = `osc${selectedOsc}`
  return `
    <section class="mwt-page mwt-page--osc">
      <article class="mwt-panel mwt-rack-panel">
        <header><span>Oscillator Rack</span><button type="button" data-plugin-param-set="oscCount" data-plugin-param-value="${esc(Math.min(8, oscCount + 1))}" ${oscCount >= 8 ? 'disabled' : ''}>Add Osc</button></header>
        <div class="mwt-rack-list">
          ${Array.from({ length: oscCount }, (_, index)=>{
            const number = index + 1
            const table = number === 1 ? params.wavetableId : params[`osc${number}WavetableId`] || params.wavetableId
            return `<button type="button" class="${number === selectedOsc ? 'is-selected' : ''}" data-plugin-param-set="selectedOsc" data-plugin-param-value="${number}"><strong>OSC ${number}</strong><span>${esc(table || 'Built-in')}</span></button>`
          }).join('')}
        </div>
      </article>
      ${renderOscPanel({ label: `OSC ${selectedOsc}`, enabled: true, params, allWavetableAssets, prefix, active })}
    </section>
  `
}

function renderFxPage({ params }) {
  const fxRack = String(params.fxRack || '')
  const hasFilter = fxRack.split(',').includes('filter')
  return `
    <section class="mwt-page mwt-page--fx">
      <article class="mwt-panel mwt-fx-rack-panel">
        <header><span>FX Rack</span><details class="mwt-fx-add"><summary>+</summary><button type="button" data-plugin-param-set="fxRack" data-plugin-param-value="filter">Filter</button><button type="button" disabled>Distortion</button><button type="button" disabled>Chorus</button><button type="button" disabled>Delay</button><button type="button" disabled>Reverb</button><button type="button" disabled>Compressor</button><button type="button" disabled>EQ</button><button type="button" disabled>Convolver</button><button type="button" disabled>Dimension</button></details></header>
        <div class="mwt-fx-rack-list">
          ${hasFilter ? `<button type="button" class="is-selected" data-plugin-param-set="selectedFx" data-plugin-param-value="filter"><strong>Filter</strong><span>${boolParam(params, 'filterEnabled', false) ? 'Active' : 'Bypass'}</span></button>` : '<p class="mwt-empty-rack">No FX loaded. Add Filter to begin.</p>'}
        </div>
      </article>
      ${hasFilter ? `<article class="mwt-panel mwt-filter-module">
        <header><span>Filter Module</span><em>${boolParam(params, 'filterEnabled', false) ? 'On' : 'Bypass'}</em></header>
        <div class="mwt-filter-curve" aria-hidden="true"></div>
        <div class="mwt-filter-controls">
          ${selectControl({ label: 'Mode', param: 'filterType', value: params.filterType, options: ['lowpass', 'highpass', 'bandpass'] })}
          ${selectControl({ label: 'State', param: 'filterEnabled', value: String(boolParam(params, 'filterEnabled', false)), options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Bypass' }] })}
          ${knobControl({ label: 'Cutoff', param: 'filterCutoff', value: numberParam(params, 'filterCutoff', 0.72), min: 0, max: 1, step: 0.01 })}
          ${knobControl({ label: 'Resonance', param: 'resonance', value: numberParam(params, 'resonance', 0.18), min: 0, max: 1, step: 0.01 })}
          ${knobControl({ label: 'Drive', param: 'filterDrive', value: numberParam(params, 'filterDrive', 0), min: 0, max: 1, step: 0.01 })}
          ${knobControl({ label: 'Mix', param: 'filterMix', value: numberParam(params, 'filterMix', 1), min: 0, max: 1, step: 0.01 })}
        </div>
      </article>` : `<article class="mwt-panel mwt-filter-module is-empty"><header><span>Detail</span><em>Empty</em></header><div class="mwt-placeholder-stack"><strong>No module selected</strong><p>The FX rack starts empty so patches only run the modules you add.</p></div></article>`}
    </section>
  `
}

function renderModPage({ params }) {
  const source = params.modSource || 'lfo1'
  const mainEnv = `<article class="mwt-panel mwt-main-env"><header><span>Main ENV</span><em>Amp</em></header><div class="mwt-env-grid">${sliderControl({ label: 'Attack', param: 'attack', value: numberParam(params, 'attack', 0.02), min: 0.001, max: 1.5, step: 0.001 })}${sliderControl({ label: 'Decay', param: 'decay', value: numberParam(params, 'decay', 0.16), min: 0.001, max: 2, step: 0.001 })}${sliderControl({ label: 'Sustain', param: 'sustain', value: numberParam(params, 'sustain', 0.68), min: 0, max: 1, step: 0.01 })}${sliderControl({ label: 'Release', param: 'release', value: numberParam(params, 'release', 0.24), min: 0.01, max: 3, step: 0.01 })}</div></article>`
  const detail = {
    lfo1: `<article class="mwt-panel"><header><span>LFO 1</span><em>Mod source</em></header>${selectControl({ label: 'Shape', param: 'lfoShape', value: params.lfoShape, options: ['sine', 'triangle', 'square', 'sawtooth'] })}${selectControl({ label: 'Target', param: 'lfoTarget', value: params.lfoTarget, options: [{ value: 'none', label: 'None' }, { value: 'filterCutoff', label: 'Filter Cutoff' }, { value: 'pitch', label: 'Pitch' }, { value: 'wavetablePosition', label: 'WT Position' }] })}${sliderControl({ label: 'Rate', param: 'lfoRate', value: numberParam(params, 'lfoRate', 0.35), min: 0.01, max: 20, step: 0.01, suffix: ' hz' })}${sliderControl({ label: 'Amount', param: 'lfoAmount', value: numberParam(params, 'lfoAmount', 0), min: 0, max: 1, step: 0.01 })}</article>`,
    macros: `<article class="mwt-panel mwt-panel--macros"><header><span>Macros</span><em>4</em></header><div class="daw-plugin-macro-grid mwt-macro-grid">${[1, 2, 3, 4].map((index) => macroControl(index, numberParam(params, `macro${index}`, 0))).join('')}</div></article>`,
    lfo2: `<article class="mwt-panel"><header><span>LFO 2</span><em>Scaffold</em></header><div class="mwt-placeholder-stack"><strong>Second LFO ready</strong><p>State hooks are reserved for deeper modulation.</p></div></article>`,
    env2: `<article class="mwt-panel"><header><span>ENV 2</span><em>Scaffold</em></header><div class="mwt-placeholder-stack"><strong>Assignable envelope</strong><p>Use Matrix later to route ENV 2 to synth targets.</p></div></article>`
  }
  return `
    <section class="mwt-page mwt-page--mod">
      ${mainEnv}
      <div class="mwt-mod-lower">
        <article class="mwt-panel mwt-rack-panel">
          <header><span>Mod Rack</span><button type="button" disabled>Add Source</button></header>
          <div class="mwt-rack-list">
            ${[
              ['lfo1', 'LFO 1', 'Active'],
              ['macros', 'Macros', '4 controls'],
              ['lfo2', 'LFO 2', 'Scaffold'],
              ['env2', 'ENV 2', 'Scaffold']
            ].map(([id, label, status])=>`<button type="button" class="${source === id ? 'is-selected' : ''}" data-plugin-param-set="modSource" data-plugin-param-value="${esc(id)}"><strong>${esc(label)}</strong><span>${esc(status)}</span></button>`).join('')}
          </div>
        </article>
        ${detail[source] || detail.lfo1}
      </div>
    </section>
  `
}

function renderMatrixPage({ matrix }) {
  return `
    <section class="mwt-page mwt-page--matrix">
      <article class="mwt-panel mwt-panel--matrix">
        <header><span>Modulation Matrix</span><button type="button" class="daw-plugin-add-mod" data-plugin-add-mod>Add Row</button></header>
        <div class="daw-plugin-mod-matrix mwt-mod-matrix">${renderModulationMatrix(matrix)}</div>
      </article>
    </section>
  `
}

function renderGlobalPage({ params }) {
  return `
    <section class="mwt-page mwt-page--global">
      <article class="mwt-panel">
        <header><span>Global</span><em>Instrument</em></header>
        <div class="mwt-global-grid">
          ${knobControl({ label: 'Volume', param: 'volume', value: numberParam(params, 'volume', 0.45), min: 0, max: 1, step: 0.01 })}
          ${knobControl({ label: 'Voices', param: 'polyphony', value: numberParam(params, 'polyphony', 8), min: 1, max: 16, step: 1 })}
          ${knobControl({ label: 'Spread', param: 'globalSpread', value: numberParam(params, 'globalSpread', 0.2), min: 0, max: 1, step: 0.01 })}
          ${knobControl({ label: 'Glide', param: 'glide', value: numberParam(params, 'glide', 0), min: 0, max: 1, step: 0.01 })}
          ${knobControl({ label: 'Bend', param: 'pitchBendRange', value: numberParam(params, 'pitchBendRange', 2), min: 0, max: 12, step: 1, suffix: ' st' })}
          ${knobControl({ label: 'Tuning', param: 'masterTuning', value: numberParam(params, 'masterTuning', 0), min: -100, max: 100, step: 1, suffix: ' ct' })}
          ${knobControl({ label: 'Velocity', param: 'velocityResponse', value: numberParam(params, 'velocityResponse', 0.65), min: 0, max: 1, step: 0.01 })}
          ${selectControl({ label: 'Voice Mode', param: 'voiceMode', value: params.voiceMode || 'Poly', options: ['Poly', 'Mono', 'Legato'] })}
          ${selectControl({ label: 'CPU Guard', param: 'cpuSafety', value: String(boolParam(params, 'cpuSafety', true)), options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Off' }] })}
        </div>
      </article>
      <article class="mwt-panel">
        <header><span>Quality</span><em>Scaffold</em></header>
        ${selectControl({ label: 'Mode', param: 'qualityMode', value: params.qualityMode || 'Balanced', options: ['Draft', 'Balanced', 'High'] })}
        ${selectControl({ label: 'Oversampling', param: 'oversampling', value: params.oversampling || '1x', options: ['1x', '2x', '4x'] })}
        ${selectControl({ label: 'Legato', param: 'legato', value: String(boolParam(params, 'legato', false)), options: [{ value: 'false', label: 'Off' }, { value: 'true', label: 'On' }] })}
        <div class="mwt-placeholder-stack"><strong>Performance state</strong><p>Quality, voice, and safety settings are stored with the patch for later engine expansion.</p></div>
      </article>
    </section>
  `
}

export function renderMelogicWavetableShell(instance = {}, { hostMode = 'inline' } = {}) {
  const definition = getDawPluginDefinition(instance.pluginType)
  const params = { ...definition.defaultParams, ...(instance.params || {}) }
  const wavetableAssets = listAudioAssetMetadata({
    type: 'wavetable',
    packId: params.assetBrowserPack || '',
    tag: params.assetBrowserTag || '',
    search: params.assetBrowserSearch || ''
  })
  const allWavetableAssets = listAudioAssetMetadata({ type: 'wavetable' })
  const tags = Array.from(new Set(allWavetableAssets.flatMap((asset) => asset.tags || []))).sort()
  const matrix = Array.isArray(params.modulationMatrix) ? params.modulationMatrix : definition.defaultParams.modulationMatrix
  const requestedPage = params.mwtPage === 'filter' ? 'fx' : params.mwtPage
  const activePage = MWT_PAGES.some((page) => page.id === requestedPage) ? requestedPage : 'browser'
  const pageContext = { params, wavetableAssets, allWavetableAssets, tags, matrix }
  const pageMarkup = {
    browser: renderBrowserPage(pageContext),
    osc: renderOscPage(pageContext),
    fx: renderFxPage(pageContext),
    mod: renderModPage(pageContext),
    matrix: renderMatrixPage(pageContext),
    global: renderGlobalPage(pageContext)
  }[activePage]

  return `
    <article class="daw-plugin-shell daw-wavetable-shell melogic-plugin-fixed-frame" data-plugin-shell="${esc(instance.pluginInstanceId || '')}" data-host-mode="${esc(hostMode)}" data-mwt-page="${esc(activePage)}">
      <div class="melogic-plugin-design-surface">
        <header class="mwt-topbar">
          <strong>MWT</strong>
          <button type="button" disabled>Prev</button>
          <label class="mwt-preset">
            <span>Preset</span>
            <select data-plugin-param="preset">
              ${MELOGIC_WAVETABLE_PRESETS.map((preset) => `<option value="${esc(preset.id)}" ${params.preset === preset.id || params.preset === preset.name ? 'selected' : ''}>${esc(preset.name)}</option>`).join('')}
            </select>
          </label>
          <button type="button" disabled>Next</button>
          <button class="daw-plugin-save-placeholder" type="button" disabled>Save</button>
          <div class="mwt-output-readout">
            <span>OUT</span>
            <div class="daw-plugin-output-meter" aria-label="Output meter placeholder"><i style="width:${esc(Math.round(numberParam(params, 'volume', 0.45) * 72 + 12))}%"></i></div>
          </div>
        </header>
        <nav class="mwt-tabbar" aria-label="Melogic Wavetable pages">
          ${MWT_PAGES.map((page) => `<button type="button" data-plugin-page="${esc(page.id)}" class="${activePage === page.id ? 'is-active' : ''}">${esc(page.label)}</button>`).join('')}
        </nav>
        <div class="mwt-layout">${pageMarkup}</div>
      </div>
    </article>
  `
}

export function renderPluginShell(instance = {}, options = {}) {
  return renderMelogicWavetableShell(instance, options)
}

export function drawWavetableVisualizers(root = document) {
  root.querySelectorAll('[data-wavetable-visualizer]').forEach((canvas) => {
    const context = canvas.getContext?.('2d')
    if (!context) return
    const samples = getBuiltInWavetableSamples(canvas.dataset.wavetableId, canvas.dataset.wavetablePosition, 180)
    const width = canvas.width
    const height = canvas.height
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#08101c'
    context.fillRect(0, 0, width, height)
    context.strokeStyle = 'rgba(118, 222, 255, 0.13)'
    context.lineWidth = 1
    for (let x = 0; x <= width; x += 40) {
      context.beginPath()
      context.moveTo(x, 0)
      context.lineTo(x, height)
      context.stroke()
    }
    context.strokeStyle = 'rgba(130, 244, 187, 0.24)'
    context.beginPath()
    context.moveTo(0, height / 2)
    context.lineTo(width, height / 2)
    context.stroke()
    context.strokeStyle = '#7de3ff'
    context.lineWidth = 3
    context.beginPath()
    samples.forEach((sample, index) => {
      const x = (index / Math.max(1, samples.length - 1)) * width
      const y = (height / 2) - (sample * height * 0.38)
      if (index === 0) context.moveTo(x, y)
      else context.lineTo(x, y)
    })
    context.stroke()
  })
}
