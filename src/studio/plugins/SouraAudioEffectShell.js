import {
  getAudioEffectDefaultParams,
  getAudioEffectManifest,
  getAudioEffectTypeFromPlugin
} from '../../daw/audioEffects/catalog.js'

const EQ_WIDTH = 640
const EQ_HEIGHT = 220
const EQ_PAD = { left: 44, right: 18, top: 18, bottom: 30 }
const FREQ_MIN = 20
const FREQ_MAX = 20000
const GAIN_MIN = -24
const GAIN_MAX = 24
const EQ_GRID_FREQS = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]
const EQ_GRID_GAINS = [-24, -12, 0, 12, 24]
const NOTE_DIVISIONS = ['1/4', '1/8', '1/8D', '1/8T', '1/16', '1/16T', '1/32']
const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf', 'peaking']
const GENERIC_EFFECT_CONTROLS = {
  compressor: [
    { param: 'threshold', label: 'Threshold', min: -60, max: 0, step: 0.1, unit: 'dB', digits: 1 },
    { param: 'ratio', label: 'Ratio', min: 1, max: 20, step: 0.1, digits: 1 },
    { param: 'attack', label: 'Attack', min: 0.001, max: 0.12, step: 0.001, unit: 's', digits: 3 },
    { param: 'release', label: 'Release', min: 0.02, max: 1.2, step: 0.01, unit: 's', digits: 2 },
    { param: 'knee', label: 'Knee', min: 0, max: 40, step: 0.1, unit: 'dB', digits: 1 },
    { param: 'makeupGain', label: 'Makeup', min: -12, max: 18, step: 0.1, unit: 'dB', digits: 1 }
  ],
  limiter: [
    { param: 'inputGain', label: 'Input', min: -12, max: 18, step: 0.1, unit: 'dB', digits: 1 },
    { param: 'ceiling', label: 'Ceiling', min: -12, max: 0, step: 0.1, unit: 'dB', digits: 1 },
    { param: 'release', label: 'Release', min: 0.01, max: 0.8, step: 0.01, unit: 's', digits: 2 }
  ],
  distortion: [
    { param: 'drive', label: 'Drive', min: 0, max: 1, step: 0.01, digits: 2 },
    { param: 'tone', label: 'Tone', min: 800, max: 16000, step: 1, unit: 'Hz', digits: 0 },
    { param: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, digits: 2 }
  ],
  chorus: [
    { param: 'rate', label: 'Rate', min: 0.05, max: 6, step: 0.01, unit: 'Hz', digits: 2 },
    { param: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, digits: 2 },
    { param: 'delay', label: 'Delay', min: 0.004, max: 0.04, step: 0.001, unit: 's', digits: 3 },
    { param: 'feedback', label: 'Feedback', min: 0, max: 0.65, step: 0.01, digits: 2 },
    { param: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, digits: 2 }
  ],
  phaser: [
    { param: 'rate', label: 'Rate', min: 0.03, max: 4, step: 0.01, unit: 'Hz', digits: 2 },
    { param: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, digits: 2 },
    { param: 'feedback', label: 'Feedback', min: 0, max: 0.7, step: 0.01, digits: 2 },
    { param: 'stages', label: 'Stages', min: 2, max: 8, step: 1, digits: 0 },
    { param: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, digits: 2 }
  ],
  flanger: [
    { param: 'rate', label: 'Rate', min: 0.03, max: 4, step: 0.01, unit: 'Hz', digits: 2 },
    { param: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, digits: 2 },
    { param: 'delay', label: 'Delay', min: 0.001, max: 0.012, step: 0.0005, unit: 's', digits: 4 },
    { param: 'feedback', label: 'Feedback', min: 0, max: 0.85, step: 0.01, digits: 2 },
    { param: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, digits: 2 }
  ],
  tremolo: [
    { param: 'rate', label: 'Rate', min: 0.1, max: 14, step: 0.01, unit: 'Hz', digits: 2 },
    { param: 'depth', label: 'Depth', min: 0, max: 1, step: 0.01, digits: 2 },
    { param: 'mix', label: 'Mix', min: 0, max: 1, step: 0.01, digits: 2 }
  ],
  filter: [
    { param: 'type', label: 'Type', options: FILTER_TYPES },
    { param: 'cutoff', label: 'Cutoff', min: 20, max: 20000, step: 1, unit: 'Hz', digits: 0 },
    { param: 'resonance', label: 'Resonance', min: 0.1, max: 18, step: 0.01, digits: 2 },
    { param: 'gain', label: 'Gain', min: -24, max: 24, step: 0.1, unit: 'dB', digits: 1 }
  ],
  'stereo-imager': [
    { param: 'width', label: 'Width', min: 0, max: 2, step: 0.01, digits: 2 }
  ]
}

const EQ_BANDS = [
  { id: 'hp', label: 'High-pass', short: 'HP', type: 'highpass', enabledParam: 'hpEnabled', frequencyParam: 'hpFrequency', qParam: 'hpQ', min: 20, max: 800 },
  { id: 'lowShelf', label: 'Low Shelf', short: 'LS', type: 'lowshelf', enabledParam: 'lowShelfEnabled', frequencyParam: 'lowShelfFrequency', gainParam: 'lowShelfGain', min: 40, max: 800 },
  { id: 'bell1', label: 'Bell 1', short: 'B1', type: 'peaking', enabledParam: 'bell1Enabled', frequencyParam: 'bell1Frequency', gainParam: 'bell1Gain', qParam: 'bell1Q', min: 80, max: 6000 },
  { id: 'bell2', label: 'Bell 2', short: 'B2', type: 'peaking', enabledParam: 'bell2Enabled', frequencyParam: 'bell2Frequency', gainParam: 'bell2Gain', qParam: 'bell2Q', min: 160, max: 12000 },
  { id: 'bell3', label: 'Bell 3', short: 'B3', type: 'peaking', enabledParam: 'bell3Enabled', frequencyParam: 'bell3Frequency', gainParam: 'bell3Gain', qParam: 'bell3Q', min: 240, max: 18000 },
  { id: 'highShelf', label: 'High Shelf', short: 'HS', type: 'highshelf', enabledParam: 'highShelfEnabled', frequencyParam: 'highShelfFrequency', gainParam: 'highShelfGain', min: 1200, max: 18000 },
  { id: 'lp', label: 'Low-pass', short: 'LP', type: 'lowpass', enabledParam: 'lpEnabled', frequencyParam: 'lpFrequency', qParam: 'lpQ', min: 1200, max: 20000 }
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

function num(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback
}

function fmt(value, digits = 2) {
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric.toFixed(digits).replace(/\.?0+$/, '') : String(value ?? '')
}

function checked(value) {
  return value === true ? 'checked' : ''
}

function selected(value, target) {
  return String(value) === String(target) ? 'selected' : ''
}

function control({ param, label, value, min, max, step = 0.01, unit = '', digits = 2, wide = false }) {
  return `<label class="soura-fx-control ${wide ? 'is-wide' : ''}">
    <span>${esc(label)} <b data-plugin-param-value="${esc(param)}">${fmt(value, digits)}</b>${unit ? `<em>${esc(unit)}</em>` : ''}</span>
    <input data-plugin-param="${esc(param)}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}">
  </label>`
}

function numberControl({ param, label, value, min, max, step = 0.01, unit = '', digits = 2 }) {
  return `<label class="soura-fx-number">
    <span>${esc(label)}</span>
    <input data-plugin-param="${esc(param)}" type="number" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(fmt(value, digits))}">
    ${unit ? `<em>${esc(unit)}</em>` : ''}
  </label>`
}

function selectControl({ param, label, value, options }) {
  return `<label class="soura-fx-select">
    <span>${esc(label)}</span>
    <select data-plugin-param="${esc(param)}">${options.map((option) => `<option value="${esc(option)}" ${selected(value, option)}>${esc(option)}</option>`).join('')}</select>
  </label>`
}

function toggle({ param, label, value }) {
  return `<label class="soura-fx-toggle">
    <input data-plugin-param="${esc(param)}" type="checkbox" ${checked(value)}>
    <span>${esc(label)}</span>
  </label>`
}

function freqToX(freq) {
  const t = (Math.log10(clamp(freq, FREQ_MIN, FREQ_MAX)) - Math.log10(FREQ_MIN)) / (Math.log10(FREQ_MAX) - Math.log10(FREQ_MIN))
  return EQ_PAD.left + (t * (EQ_WIDTH - EQ_PAD.left - EQ_PAD.right))
}

function xToFreq(x) {
  const t = clamp((Number(x) - EQ_PAD.left) / (EQ_WIDTH - EQ_PAD.left - EQ_PAD.right), 0, 1)
  return FREQ_MIN * ((FREQ_MAX / FREQ_MIN) ** t)
}

function gainToY(gain) {
  const t = (clamp(gain, GAIN_MIN, GAIN_MAX) - GAIN_MIN) / (GAIN_MAX - GAIN_MIN)
  return EQ_HEIGHT - EQ_PAD.bottom - (t * (EQ_HEIGHT - EQ_PAD.top - EQ_PAD.bottom))
}

function yToGain(y) {
  const t = clamp((EQ_HEIGHT - EQ_PAD.bottom - Number(y)) / (EQ_HEIGHT - EQ_PAD.top - EQ_PAD.bottom), 0, 1)
  return GAIN_MIN + (t * (GAIN_MAX - GAIN_MIN))
}

function isBandEnabled(params, band) {
  return params[band.enabledParam] !== false
}

function getBandGain(params, band) {
  return band.gainParam ? num(params[band.gainParam], 0) : 0
}

function bellResponse(freq, center, gain, q = 1) {
  const octaveDistance = Math.log2(freq / Math.max(FREQ_MIN, center))
  const width = Math.max(0.14, 1.2 / Math.max(0.1, q))
  return gain * Math.exp(-(octaveDistance * octaveDistance) / (2 * width * width))
}

function shelfResponse(freq, center, gain, high = false) {
  const transition = 1 / (1 + Math.exp((high ? -1 : 1) * Math.log2(freq / Math.max(FREQ_MIN, center)) * 4))
  return gain * transition
}

function cutoffResponse(freq, center, highpass = false, q = 0.72) {
  const ratio = Math.log2(freq / Math.max(FREQ_MIN, center))
  const slope = Math.max(3, 5 + (q * 2))
  const attenuation = -24 / (1 + Math.exp((highpass ? 1 : -1) * ratio * slope))
  return attenuation
}

function eqResponseAt(params, freq) {
  let gain = 0
  EQ_BANDS.forEach((band) => {
    if (!isBandEnabled(params, band)) return
    const center = num(params[band.frequencyParam], 1000)
    if (band.type === 'peaking') gain += bellResponse(freq, center, num(params[band.gainParam], 0), num(params[band.qParam], 1))
    if (band.type === 'lowshelf') gain += shelfResponse(freq, center, num(params[band.gainParam], 0), false)
    if (band.type === 'highshelf') gain += shelfResponse(freq, center, num(params[band.gainParam], 0), true)
    if (band.type === 'highpass') gain += cutoffResponse(freq, center, true, num(params[band.qParam], 0.72))
    if (band.type === 'lowpass') gain += cutoffResponse(freq, center, false, num(params[band.qParam], 0.72))
  })
  return clamp(gain, GAIN_MIN, GAIN_MAX)
}

function buildEqCurvePath(params) {
  const points = []
  for (let index = 0; index <= 96; index += 1) {
    const x = EQ_PAD.left + ((EQ_WIDTH - EQ_PAD.left - EQ_PAD.right) * index / 96)
    const freq = xToFreq(x)
    points.push(`${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${gainToY(eqResponseAt(params, freq)).toFixed(1)}`)
  }
  return points.join(' ')
}

function renderEqGrid() {
  const vertical = EQ_GRID_FREQS.map((freq) => {
    const x = freqToX(freq)
    const label = freq >= 1000 ? `${freq / 1000}k` : String(freq)
    return `<g><line x1="${x.toFixed(1)}" y1="${EQ_PAD.top}" x2="${x.toFixed(1)}" y2="${EQ_HEIGHT - EQ_PAD.bottom}"></line><text x="${x.toFixed(1)}" y="${EQ_HEIGHT - 8}">${label}</text></g>`
  }).join('')
  const horizontal = EQ_GRID_GAINS.map((gain) => {
    const y = gainToY(gain)
    return `<g><line x1="${EQ_PAD.left}" y1="${y.toFixed(1)}" x2="${EQ_WIDTH - EQ_PAD.right}" y2="${y.toFixed(1)}"></line><text x="8" y="${(y + 4).toFixed(1)}">${gain > 0 ? '+' : ''}${gain}</text></g>`
  }).join('')
  return `${vertical}${horizontal}`
}

function renderEqGraph(params) {
  return `<div class="soura-eq-graph-wrap">
    <svg class="soura-eq-graph" viewBox="0 0 ${EQ_WIDTH} ${EQ_HEIGHT}" data-soura-eq-graph aria-label="EQ response graph">
      <rect x="${EQ_PAD.left}" y="${EQ_PAD.top}" width="${EQ_WIDTH - EQ_PAD.left - EQ_PAD.right}" height="${EQ_HEIGHT - EQ_PAD.top - EQ_PAD.bottom}" rx="14"></rect>
      <g class="soura-eq-grid">${renderEqGrid()}</g>
      <line class="soura-eq-zero" x1="${EQ_PAD.left}" y1="${gainToY(0)}" x2="${EQ_WIDTH - EQ_PAD.right}" y2="${gainToY(0)}"></line>
      <polyline class="soura-eq-spectrum" data-soura-eq-spectrum points=""></polyline>
      <path class="soura-eq-curve" data-soura-eq-curve d="${buildEqCurvePath(params)}"></path>
      <g class="soura-eq-nodes">
        ${EQ_BANDS.map((band) => {
          const x = freqToX(params[band.frequencyParam])
          const y = gainToY(getBandGain(params, band))
          const active = isBandEnabled(params, band)
          const selectedBand = params.eqSelectedBand || 'bell1'
          return `<g class="soura-eq-node ${active ? 'is-enabled' : 'is-disabled'} ${selectedBand === band.id ? 'is-selected' : ''}" data-soura-eq-node="${band.id}" tabindex="0" role="button" aria-label="${esc(band.label)} EQ node" transform="translate(${x.toFixed(1)} ${y.toFixed(1)})"><circle r="9"></circle><text y="4">${esc(band.short)}</text></g>`
        }).join('')}
      </g>
    </svg>
    <p>Drag nodes to change frequency and gain. Wheel over bell/filter nodes adjusts Q.</p>
  </div>`
}

function renderEqSelectedPanel(params) {
  const selectedBand = EQ_BANDS.find((band) => band.id === (params.eqSelectedBand || 'bell1')) || EQ_BANDS[2]
  return `<aside class="soura-eq-selected" data-soura-eq-selected>
    <header><span>Selected Band</span><strong>${esc(selectedBand.label)}</strong></header>
    <div class="soura-fx-mini-grid">
      ${toggle({ param: selectedBand.enabledParam, label: 'Enabled', value: params[selectedBand.enabledParam] !== false })}
      ${numberControl({ param: selectedBand.frequencyParam, label: 'Frequency', value: params[selectedBand.frequencyParam], min: selectedBand.min, max: selectedBand.max, step: 1, unit: 'Hz', digits: 0 })}
      ${selectedBand.gainParam ? numberControl({ param: selectedBand.gainParam, label: 'Gain', value: params[selectedBand.gainParam], min: -24, max: 24, step: 0.1, unit: 'dB', digits: 1 }) : '<span class="soura-fx-readonly"><b>Gain</b><em>Filter slope</em></span>'}
      ${selectedBand.qParam ? numberControl({ param: selectedBand.qParam, label: 'Q', value: params[selectedBand.qParam], min: 0.1, max: 18, step: 0.01, digits: 2 }) : '<span class="soura-fx-readonly"><b>Q</b><em>Shelf curve</em></span>'}
      <span class="soura-fx-readonly"><b>Type</b><em>${esc(selectedBand.type)}</em></span>
    </div>
  </aside>`
}

function renderEq(params) {
  return `
    <input data-plugin-param="eqSelectedBand" type="hidden" value="${esc(params.eqSelectedBand || 'bell1')}">
    <div class="soura-fx-visual soura-eq-module">
      ${renderEqGraph(params)}
      ${renderEqSelectedPanel(params)}
    </div>
    <div class="soura-fx-band-rack">
      ${EQ_BANDS.map((band) => `<button type="button" class="${(params.eqSelectedBand || 'bell1') === band.id ? 'is-selected' : ''}" data-plugin-param-set="eqSelectedBand" data-plugin-param-value="${esc(band.id)}"><strong>${esc(band.short)}</strong><span>${esc(band.label)}</span></button>`).join('')}
    </div>
  `
}
export function updateSouraEqSelectionDom(shell, params = {}) {
  if (!shell?.querySelector) return null
  const selectedBand = params.eqSelectedBand || 'bell1'
  const hidden = shell.querySelector('[data-plugin-param="eqSelectedBand"]')
  if (hidden) hidden.value = selectedBand
  const selectedPanel = shell.querySelector('[data-soura-eq-selected]')
  if (selectedPanel) selectedPanel.outerHTML = renderEqSelectedPanel(params)
  shell.querySelectorAll('[data-plugin-param-set="eqSelectedBand"]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.pluginParamValue === selectedBand)
  })
  drawEq(shell)
  return shell.querySelector('[data-soura-eq-selected]')
}

function renderReverb(params) {
  const handleX = clamp(params.size, 0.1, 1) * 100
  const handleY = 100 - (clamp(params.mix, 0, 1) * 100)
  return `
    <div class="soura-fx-visual soura-reverb-module">
      <div class="soura-reverb-pad" data-soura-reverb-pad>
        <span class="soura-reverb-space"></span>
        <i data-soura-reverb-handle style="left:${handleX}%;top:${handleY}%"></i>
        <b>Size</b><em>Mix</em>
      </div>
      <div class="soura-reverb-tail" data-soura-reverb-tail style="--tail:${clamp(params.decay, 0.2, 8) / 8};--damping:${clamp(params.damping, 800, 18000) / 18000};--pre-delay:${clamp(params.preDelay, 0, 0.25) / 0.25};"></div>
      <div class="soura-reverb-width" style="--width:${clamp(params.width, 0, 1)}"><span></span><span></span></div>
    </div>
    ${control({ param: 'mix', label: 'Mix', value: params.mix, min: 0, max: 1, step: 0.01, wide: true })}
    ${control({ param: 'decay', label: 'Decay', value: params.decay, min: 0.2, max: 8, step: 0.01, unit: 's', wide: true })}
    ${control({ param: 'preDelay', label: 'Pre Delay', value: params.preDelay, min: 0, max: 0.25, step: 0.001, unit: 's', digits: 3, wide: true })}
    ${control({ param: 'damping', label: 'Damping', value: params.damping, min: 800, max: 18000, step: 1, unit: 'Hz', digits: 0, wide: true })}
    ${control({ param: 'size', label: 'Size', value: params.size, min: 0.1, max: 1, step: 0.01, wide: true })}
    ${control({ param: 'width', label: 'Width', value: params.width, min: 0, max: 1, step: 0.01, wide: true })}
  `
}

function renderDelayDots(params) {
  const feedback = clamp(params.feedback, 0, 0.85)
  const time = clamp(params.time, 0.03, 1.5)
  const spacing = 7 + (time / 1.5) * 9
  return Array.from({ length: 9 }, (_, index) => {
    const opacity = Math.max(0.08, (feedback || 0.14) ** (index * 0.55))
    const top = params.pingPong ? (index % 2 ? 70 : 26) : 48
    return `<i style="left:${Math.min(94, 7 + index * spacing).toFixed(1)}%;top:${top}%;opacity:${opacity.toFixed(3)}"></i>`
  }).join('')
}

function renderDelay(params) {
  return `
    <div class="soura-fx-visual soura-delay-module">
      <div class="soura-delay-timeline" data-soura-delay-timeline>${renderDelayDots(params)}</div>
      <div class="soura-delay-filter-strip" style="--low:${clamp(params.lowCut, 20, 1000) / 1000};--high:${clamp(params.highCut, 1000, 18000) / 18000};"></div>
    </div>
    <div class="soura-delay-toggles">
      ${toggle({ param: 'sync', label: 'Sync', value: params.sync })}
      ${selectControl({ param: 'noteDivision', label: 'Division', value: params.noteDivision, options: NOTE_DIVISIONS })}
      ${toggle({ param: 'pingPong', label: 'Ping-pong visual', value: params.pingPong })}
    </div>
    ${control({ param: 'mix', label: 'Mix', value: params.mix, min: 0, max: 1, step: 0.01, wide: true })}
    ${control({ param: 'time', label: 'Time', value: params.time, min: 0.03, max: 1.5, step: 0.001, unit: 's', digits: 3, wide: true })}
    ${control({ param: 'feedback', label: 'Feedback', value: params.feedback, min: 0, max: 0.85, step: 0.01, wide: true })}
    ${control({ param: 'lowCut', label: 'Low Cut', value: params.lowCut, min: 20, max: 1000, step: 1, unit: 'Hz', digits: 0, wide: true })}
    ${control({ param: 'highCut', label: 'High Cut', value: params.highCut, min: 1000, max: 18000, step: 1, unit: 'Hz', digits: 0, wide: true })}
  `
}
function renderGenericEffect(params, effectType, manifest) {
  const controls = GENERIC_EFFECT_CONTROLS[effectType] || []
  const meter = clamp(
    Number(params.mix ?? params.depth ?? params.drive ?? params.width ?? params.ratio ?? params.inputGain ?? 0.5),
    effectType === 'limiter' ? -12 : 0,
    effectType === 'limiter' ? 18 : (effectType === 'stereo-imager' ? 2 : 1)
  )
  const normalized = effectType === 'limiter'
    ? (meter + 12) / 30
    : effectType === 'stereo-imager'
      ? meter / 2
      : meter
  return `
    <div class="soura-fx-visual soura-generic-module" data-soura-generic-module="${esc(effectType)}" style="--fx-energy:${clamp(normalized, 0, 1)}">
      <div class="soura-generic-orb"><span></span><i></i></div>
      <div>
        <strong>${esc(manifest?.name || effectType)}</strong>
        <p>${esc(getGenericEffectDescription(effectType))}</p>
      </div>
    </div>
    ${controls.map((item) => item.options
      ? selectControl({ param: item.param, label: item.label, value: params[item.param], options: item.options })
      : control({ ...item, value: params[item.param], wide: true })
    ).join('')}
  `
}
function getGenericEffectDescription(effectType = '') {
  return {
    compressor: 'Dynamics control for taming peaks and lifting body.',
    limiter: 'Fast peak control at the end of a track chain.',
    distortion: 'Drive, tone shaping, and wet/dry blend.',
    chorus: 'Modulated delay thickening for width and motion.',
    phaser: 'Sweeping all-pass movement with feedback.',
    flanger: 'Short modulated delay for metallic motion.',
    tremolo: 'Amplitude modulation with depth and blend.',
    filter: 'Creative filter tone shaping.',
    'stereo-imager': 'Mid/side style width control from mono to wide.'
  }[effectType] || 'Audio effect controls.'
}

function readShellParams(shell, effectType) {
  const defaults = getAudioEffectDefaultParams(effectType)
  return Object.fromEntries(Object.entries(defaults).map(([key, fallback]) => {
    const controlEl = shell.querySelector(`[data-plugin-param="${CSS.escape(key)}"]`)
    if (!controlEl) return [key, fallback]
    if (controlEl.type === 'checkbox') return [key, controlEl.checked]
    if (typeof fallback === 'number') return [key, num(controlEl.value, fallback)]
    return [key, controlEl.value]
  }))
}

function drawEq(shell) {
  const params = readShellParams(shell, 'eq')
  const curve = shell.querySelector('[data-soura-eq-curve]')
  if (curve) curve.setAttribute('d', buildEqCurvePath(params))
  shell.querySelectorAll('[data-plugin-param-set="eqSelectedBand"]').forEach((button) => {
    button.classList.toggle('is-selected', button.dataset.pluginParamValue === (params.eqSelectedBand || 'bell1'))
  })
  EQ_BANDS.forEach((band) => {
    const node = shell.querySelector(`[data-soura-eq-node="${CSS.escape(band.id)}"]`)
    if (!node) return
    node.setAttribute('transform', `translate(${freqToX(params[band.frequencyParam]).toFixed(1)} ${gainToY(getBandGain(params, band)).toFixed(1)})`)
    node.classList.toggle('is-enabled', isBandEnabled(params, band))
    node.classList.toggle('is-disabled', !isBandEnabled(params, band))
    node.classList.toggle('is-selected', (params.eqSelectedBand || 'bell1') === band.id)
  })
}

function drawReverb(shell) {
  const params = readShellParams(shell, 'reverb')
  const handle = shell.querySelector('[data-soura-reverb-handle]')
  if (handle) {
    handle.style.left = `${clamp(params.size, 0.1, 1) * 100}%`
    handle.style.top = `${100 - (clamp(params.mix, 0, 1) * 100)}%`
  }
  const tail = shell.querySelector('[data-soura-reverb-tail]')
  if (tail) {
    tail.style.setProperty('--tail', String(clamp(params.decay, 0.2, 8) / 8))
    tail.style.setProperty('--damping', String(clamp(params.damping, 800, 18000) / 18000))
    tail.style.setProperty('--pre-delay', String(clamp(params.preDelay, 0, 0.25) / 0.25))
  }
  const width = shell.querySelector('.soura-reverb-width')
  width?.style.setProperty('--width', String(clamp(params.width, 0, 1)))
}

function drawDelay(shell) {
  const params = readShellParams(shell, 'delay')
  const timeline = shell.querySelector('[data-soura-delay-timeline]')
  if (timeline) timeline.innerHTML = renderDelayDots(params)
  const strip = shell.querySelector('.soura-delay-filter-strip')
  if (strip) {
    strip.style.setProperty('--low', String(clamp(params.lowCut, 20, 1000) / 1000))
    strip.style.setProperty('--high', String(clamp(params.highCut, 1000, 18000) / 18000))
  }
}

export function drawSouraEffectVisualizers(root = document) {
  const scope = root?.querySelectorAll ? root : document
  const drawMatching = (selector, draw) => {
    if (scope.matches?.(selector)) draw(scope)
    scope.querySelectorAll(selector).forEach(draw)
  }
  drawMatching('.soura-fx-shell[data-effect-type="eq"]', drawEq)
  drawMatching('.soura-fx-shell[data-effect-type="reverb"]', drawReverb)
  drawMatching('.soura-fx-shell[data-effect-type="delay"]', drawDelay)
}

export function getSouraEqBandDefinition(bandId = '') {
  return EQ_BANDS.find((band) => band.id === bandId) || null
}

export function getSouraEqParamsFromPoint(bandId = '', x = 0, y = 0) {
  const band = getSouraEqBandDefinition(bandId)
  if (!band) return null
  const frequency = clamp(Math.round(xToFreq(x)), band.min, band.max)
  const gain = band.gainParam ? clamp(yToGain(y), -24, 24) : null
  return { band, frequency, gain }
}

export function isSouraAudioEffectPlugin(pluginType = '') {
  return Boolean(getAudioEffectTypeFromPlugin(pluginType))
}

export function renderSouraAudioEffectShell(pluginWindow) {
  const effectType = getAudioEffectTypeFromPlugin(pluginWindow?.pluginType)
  const manifest = getAudioEffectManifest(effectType)
  const params = { ...getAudioEffectDefaultParams(effectType), ...(pluginWindow?.params || {}) }
  if (!manifest) return '<section class="daw-plugin-shell soura-fx-shell"><p>Unknown audio effect.</p></section>'
  const body = effectType === 'eq'
    ? renderEq(params)
    : effectType === 'reverb'
      ? renderReverb(params)
      : effectType === 'delay'
        ? renderDelay(params)
        : renderGenericEffect(params, effectType, manifest)
  return `<section class="daw-plugin-shell soura-fx-shell" data-plugin-shell="${esc(pluginWindow.pluginInstanceId)}" data-effect-type="${esc(effectType)}">
    <header class="soura-fx-header">
      <div>
        <span>Soura Audio FX</span>
        <h2>${esc(manifest.name)}</h2>
      </div>
      <strong>${esc(pluginWindow.trackId || 'Track insert')}</strong>
    </header>
    <div class="soura-fx-grid ${effectType === 'eq' ? 'is-eq' : ''}">
      ${body}
      ${control({ param: 'outputGain', label: 'Output', value: params.outputGain, min: -24, max: 12, step: 0.1, unit: 'dB', digits: 1, wide: true })}
    </div>
  </section>`
}
