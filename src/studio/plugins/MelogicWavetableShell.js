import { getBuiltInWavetableSamples } from '../instruments/wavetableAssets.js'
import { listAudioAssetMetadata, STOCK_SOUND_PACKS } from '../audioAssetService.js'
import { getDawPluginDefinition } from './pluginCatalog.js'
import { MELOGIC_WAVETABLE_PRESETS } from './melogicWavetablePresets.js'

const MOD_SOURCES = [
  { value: 'lfo1', label: 'LFO 1' },
  { value: 'env2', label: 'Env 2' },
  { value: 'macro1', label: 'Macro 1' },
  { value: 'macro2', label: 'Macro 2' },
  { value: 'macro3', label: 'Macro 3' },
  { value: 'macro4', label: 'Macro 4' }
]

const MOD_TARGETS = [
  { value: 'filter.cutoff', label: 'Filter Cutoff' },
  { value: 'osc1.position', label: 'OSC Position' },
  { value: 'osc1.pitch', label: 'OSC Pitch' },
  { value: 'output.volume', label: 'Output Volume' }
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

function macroControl(index, value) {
  return `
    <label class="daw-plugin-macro">
      <span>Macro ${index}</span>
      <input data-plugin-param="macro${index}" type="range" min="0" max="1" step="0.01" value="${esc(value)}" />
      <em data-plugin-param-value="macro${index}">${esc(Number(value).toFixed(2))}</em>
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

function matrixSelect({ row, field, value, options }) {
  return `
    <select data-plugin-matrix-field="${esc(field)}" data-plugin-matrix-row="${esc(row)}" aria-label="Modulation ${esc(field)}">
      ${options.map((option) => `<option value="${esc(option.value)}" ${String(value) === String(option.value) ? 'selected' : ''}>${esc(option.label)}</option>`).join('')}
    </select>
  `
}

function renderModulationMatrix(matrix = []) {
  const rows = Array.isArray(matrix) && matrix.length ? matrix : [
    { source: 'lfo1', target: 'filter.cutoff', amount: 0, bipolar: true, enabled: false },
    { source: 'macro1', target: 'filter.cutoff', amount: 0, bipolar: false, enabled: false }
  ]
  return rows.slice(0, 4).map((route, index) => `
    <div class="daw-plugin-mod-row" data-plugin-matrix-row-shell="${index}">
      <label>
        <span>On</span>
        <input data-plugin-matrix-field="enabled" data-plugin-matrix-row="${index}" type="checkbox" ${route.enabled ? 'checked' : ''} />
      </label>
      ${matrixSelect({ row: index, field: 'source', value: route.source, options: MOD_SOURCES })}
      ${matrixSelect({ row: index, field: 'target', value: route.target, options: MOD_TARGETS })}
      <label>
        <span>Amount</span>
        <input data-plugin-matrix-field="amount" data-plugin-matrix-row="${index}" type="range" min="-1" max="1" step="0.01" value="${esc(route.amount ?? 0)}" />
      </label>
      <label>
        <span>Bi</span>
        <input data-plugin-matrix-field="bipolar" data-plugin-matrix-row="${index}" type="checkbox" ${route.bipolar !== false ? 'checked' : ''} />
      </label>
    </div>
  `).join('')
}

function optionList(values = [], selected = '') {
  return values.map((value) => `<option value="${esc(value)}" ${String(value) === String(selected) ? 'selected' : ''}>${esc(value || 'All')}</option>`).join('')
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
  const keyboard = [
    ['C', 60], ['D', 62], ['E', 64], ['F', 65], ['G', 67], ['A', 69], ['B', 71], ['C', 72]
  ]
  return `
    <article class="daw-plugin-shell daw-wavetable-shell melogic-plugin-fixed-frame" data-plugin-shell="${esc(instance.pluginInstanceId || '')}" data-host-mode="${esc(hostMode)}">
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
        <div class="mwt-layout">
          <section class="mwt-panel mwt-panel--osc-a">
            <header><span>OSC A</span><em>On</em></header>
            <canvas class="daw-plugin-waveform mwt-waveform" width="560" height="148" data-wavetable-visualizer data-wavetable-id="${esc(params.wavetableId)}" data-wavetable-position="${esc(numberParam(params, 'wavetablePosition', 0.35))}" aria-label="Wavetable visualizer"></canvas>
            <div class="mwt-controls mwt-controls--two">
              ${selectControl({ label: 'Table', param: 'wavetableId', value: params.wavetableId, options: allWavetableAssets.map((asset) => ({ value: asset.assetId, label: asset.title })) })}
              ${sliderControl({ label: 'Position', param: 'wavetablePosition', value: numberParam(params, 'wavetablePosition', 0.35), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Coarse', param: 'coarsePitch', value: numberParam(params, 'coarsePitch', 0), min: -24, max: 24, step: 1, suffix: ' st' })}
              ${sliderControl({ label: 'Fine', param: 'finePitch', value: numberParam(params, 'finePitch', 0), min: -100, max: 100, step: 1, suffix: ' ct' })}
              ${sliderControl({ label: 'Unison', param: 'unisonVoices', value: numberParam(params, 'unisonVoices', 1), min: 1, max: 5, step: 1 })}
              ${sliderControl({ label: 'Detune', param: 'detune', value: numberParam(params, 'detune', 0.08), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Level', param: 'oscLevel', value: numberParam(params, 'oscLevel', 0.85), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Pan', param: 'oscPan', value: numberParam(params, 'oscPan', 0), min: -1, max: 1, step: 0.01 })}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--osc-b">
            <header><span>OSC B</span><em>Standby</em></header>
            <div class="mwt-mini-scope" aria-hidden="true"></div>
            <div class="mwt-controls">
              <label class="daw-plugin-control"><span>Table</span><select disabled><option>Mirror A</option></select></label>
              ${sliderControl({ label: 'Blend', param: 'oscBBlend', value: numberParam(params, 'oscBBlend', 0), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Warp', param: 'oscBWarp', value: numberParam(params, 'oscBWarp', 0), min: 0, max: 1, step: 0.01 })}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--noise">
            <header><span>Noise / Sub</span><em>Prep</em></header>
            <div class="mwt-controls">
              <label class="daw-plugin-control"><span>Noise</span><select disabled><option>Air Bed</option></select></label>
              ${sliderControl({ label: 'Sub', param: 'subLevel', value: numberParam(params, 'subLevel', 0), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Noise', param: 'noiseLevel', value: numberParam(params, 'noiseLevel', 0), min: 0, max: 1, step: 0.01 })}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--filter">
            <header><span>FILTER 1</span><em>${boolParam(params, 'filterEnabled', true) ? 'On' : 'Bypass'}</em></header>
            <div class="mwt-controls">
              ${selectControl({ label: 'Mode', param: 'filterType', value: params.filterType, options: ['lowpass', 'highpass', 'bandpass'] })}
              ${selectControl({ label: 'State', param: 'filterEnabled', value: String(boolParam(params, 'filterEnabled', true)), options: [{ value: 'true', label: 'On' }, { value: 'false', label: 'Bypass' }] })}
              ${sliderControl({ label: 'Cutoff', param: 'filterCutoff', value: numberParam(params, 'filterCutoff', 0.72), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Res', param: 'resonance', value: numberParam(params, 'resonance', 0.18), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Drive', param: 'filterDrive', value: numberParam(params, 'filterDrive', 0), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Mix', param: 'filterMix', value: numberParam(params, 'filterMix', 1), min: 0, max: 1, step: 0.01 })}
            </div>
            <div class="mwt-route-toggles"><span>A</span><span>B</span><span>N</span></div>
          </section>
          <section class="mwt-panel mwt-panel--assets">
            <header><span>Browser</span><em>${esc(wavetableAssets.length)} tables</em></header>
            <div class="mwt-browser-filters">
              <select data-plugin-param="assetBrowserPack"><option value="">All Packs</option>${STOCK_SOUND_PACKS.map((pack) => `<option value="${esc(pack.packId)}" ${params.assetBrowserPack === pack.packId ? 'selected' : ''}>${esc(pack.title)}</option>`).join('')}</select>
              <select data-plugin-param="assetBrowserTag">${optionList(['', ...tags], params.assetBrowserTag || '')}</select>
              <input data-plugin-param="assetBrowserSearch" type="search" value="${esc(params.assetBrowserSearch || '')}" placeholder="Search" />
            </div>
            <div class="daw-plugin-asset-list mwt-asset-list">
              ${wavetableAssets.slice(0, 6).map((asset) => `
                <button type="button" data-plugin-asset-select="${esc(asset.assetId)}" class="${asset.assetId === params.wavetableId ? 'is-selected' : ''}">
                  <strong>${esc(asset.title)}</strong>
                  <span>${esc(asset.packId)} · ${esc((asset.tags || []).slice(0, 2).join(', '))}</span>
                </button>
              `).join('') || '<p>No matching tables.</p>'}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--env">
            <header><span>ENV 1</span><em>Amp</em></header>
            <div class="mwt-controls">
              ${sliderControl({ label: 'Attack', param: 'attack', value: numberParam(params, 'attack', 0.02), min: 0.001, max: 1.5, step: 0.001 })}
              ${sliderControl({ label: 'Decay', param: 'decay', value: numberParam(params, 'decay', 0.16), min: 0.001, max: 2, step: 0.001 })}
              ${sliderControl({ label: 'Sustain', param: 'sustain', value: numberParam(params, 'sustain', 0.68), min: 0, max: 1, step: 0.01 })}
              ${sliderControl({ label: 'Release', param: 'release', value: numberParam(params, 'release', 0.24), min: 0.01, max: 3, step: 0.01 })}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--lfo">
            <header><span>LFO 1</span><em>Mod</em></header>
            <div class="mwt-controls">
              ${selectControl({ label: 'Shape', param: 'lfoShape', value: params.lfoShape, options: ['sine', 'triangle', 'square', 'sawtooth'] })}
              ${selectControl({ label: 'Target', param: 'lfoTarget', value: params.lfoTarget, options: [{ value: 'none', label: 'None' }, { value: 'filterCutoff', label: 'Filter' }, { value: 'pitch', label: 'Pitch' }, { value: 'wavetablePosition', label: 'WT Pos' }] })}
              ${sliderControl({ label: 'Rate', param: 'lfoRate', value: numberParam(params, 'lfoRate', 0.35), min: 0.01, max: 20, step: 0.01, suffix: ' hz' })}
              ${sliderControl({ label: 'Amt', param: 'lfoAmount', value: numberParam(params, 'lfoAmount', 0), min: 0, max: 1, step: 0.01 })}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--macros">
            <header><span>MACROS</span><em>4</em></header>
            <div class="daw-plugin-macro-grid mwt-macro-grid">
              ${[1, 2, 3, 4].map((index) => macroControl(index, numberParam(params, `macro${index}`, 0))).join('')}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--matrix">
            <header><span>MATRIX</span><button type="button" class="daw-plugin-add-mod" data-plugin-add-mod>Add</button></header>
            <div class="daw-plugin-mod-matrix mwt-mod-matrix">
              ${renderModulationMatrix(matrix)}
            </div>
          </section>
          <section class="mwt-panel mwt-panel--output">
            <header><span>OUTPUT</span><em>Main tab audio</em></header>
            <div class="mwt-controls">
              ${sliderControl({ label: 'Volume', param: 'volume', value: numberParam(params, 'volume', 0.45), min: 0, max: 1, step: 0.01 })}
            </div>
          </section>
          <section class="mwt-keyboard-strip" aria-label="Keyboard placeholder">
            ${keyboard.map(([key, note]) => `<button type="button" data-plugin-note="${note}" aria-label="Play ${esc(key)}">${esc(key)}</button>`).join('')}
            <span>TEST NOTES</span>
          </section>
        </div>
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
