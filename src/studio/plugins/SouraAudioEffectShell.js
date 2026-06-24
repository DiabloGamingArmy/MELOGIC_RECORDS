import {
  getAudioEffectDefaultParams,
  getAudioEffectManifest,
  getAudioEffectTypeFromPlugin
} from '../../daw/audioEffects/catalog.js'

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]))
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

function control({ param, label, value, min, max, step = 0.01, unit = '', digits = 2, wide = false }) {
  return `<label class="soura-fx-control ${wide ? 'is-wide' : ''}">
    <span>${esc(label)} <b data-plugin-param-value="${esc(param)}">${fmt(value, digits)}</b>${unit ? `<em>${esc(unit)}</em>` : ''}</span>
    <input data-plugin-param="${esc(param)}" type="range" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}">
  </label>`
}

function toggle({ param, label, value }) {
  return `<label class="soura-fx-toggle">
    <input data-plugin-param="${esc(param)}" type="checkbox" ${checked(value)}>
    <span>${esc(label)}</span>
  </label>`
}

function renderEq(params) {
  return `
    <section class="soura-fx-band">
      ${toggle({ param: 'hpEnabled', label: 'HP', value: params.hpEnabled })}
      ${control({ param: 'hpFrequency', label: 'Freq', value: params.hpFrequency, min: 20, max: 800, step: 1, unit: 'Hz', digits: 0 })}
      ${control({ param: 'hpQ', label: 'Q', value: params.hpQ, min: 0.1, max: 8, step: 0.01 })}
    </section>
    <section class="soura-fx-band">
      ${toggle({ param: 'lowShelfEnabled', label: 'Low Shelf', value: params.lowShelfEnabled })}
      ${control({ param: 'lowShelfFrequency', label: 'Freq', value: params.lowShelfFrequency, min: 40, max: 800, step: 1, unit: 'Hz', digits: 0 })}
      ${control({ param: 'lowShelfGain', label: 'Gain', value: params.lowShelfGain, min: -18, max: 18, step: 0.1, unit: 'dB', digits: 1 })}
    </section>
    <section class="soura-fx-band">
      ${toggle({ param: 'bell1Enabled', label: 'Bell 1', value: params.bell1Enabled })}
      ${control({ param: 'bell1Frequency', label: 'Freq', value: params.bell1Frequency, min: 80, max: 6000, step: 1, unit: 'Hz', digits: 0 })}
      ${control({ param: 'bell1Gain', label: 'Gain', value: params.bell1Gain, min: -18, max: 18, step: 0.1, unit: 'dB', digits: 1 })}
      ${control({ param: 'bell1Q', label: 'Q', value: params.bell1Q, min: 0.1, max: 12, step: 0.01 })}
    </section>
    <section class="soura-fx-band">
      ${toggle({ param: 'bell2Enabled', label: 'Bell 2', value: params.bell2Enabled })}
      ${control({ param: 'bell2Frequency', label: 'Freq', value: params.bell2Frequency, min: 160, max: 12000, step: 1, unit: 'Hz', digits: 0 })}
      ${control({ param: 'bell2Gain', label: 'Gain', value: params.bell2Gain, min: -18, max: 18, step: 0.1, unit: 'dB', digits: 1 })}
      ${control({ param: 'bell2Q', label: 'Q', value: params.bell2Q, min: 0.1, max: 12, step: 0.01 })}
    </section>
    <section class="soura-fx-band">
      ${toggle({ param: 'highShelfEnabled', label: 'High Shelf', value: params.highShelfEnabled })}
      ${control({ param: 'highShelfFrequency', label: 'Freq', value: params.highShelfFrequency, min: 1200, max: 18000, step: 1, unit: 'Hz', digits: 0 })}
      ${control({ param: 'highShelfGain', label: 'Gain', value: params.highShelfGain, min: -18, max: 18, step: 0.1, unit: 'dB', digits: 1 })}
    </section>
    <section class="soura-fx-band">
      ${toggle({ param: 'lpEnabled', label: 'LP', value: params.lpEnabled })}
      ${control({ param: 'lpFrequency', label: 'Freq', value: params.lpFrequency, min: 1200, max: 20000, step: 1, unit: 'Hz', digits: 0 })}
      ${control({ param: 'lpQ', label: 'Q', value: params.lpQ, min: 0.1, max: 8, step: 0.01 })}
    </section>
  `
}

function renderReverb(params) {
  return `
    ${control({ param: 'mix', label: 'Mix', value: params.mix, min: 0, max: 1, step: 0.01, wide: true })}
    ${control({ param: 'decay', label: 'Decay', value: params.decay, min: 0.2, max: 8, step: 0.01, unit: 's', wide: true })}
    ${control({ param: 'preDelay', label: 'Pre Delay', value: params.preDelay, min: 0, max: 0.25, step: 0.001, unit: 's', digits: 3, wide: true })}
    ${control({ param: 'damping', label: 'Damping', value: params.damping, min: 800, max: 18000, step: 1, unit: 'Hz', digits: 0, wide: true })}
    ${control({ param: 'size', label: 'Size', value: params.size, min: 0.1, max: 1, step: 0.01, wide: true })}
  `
}

function renderDelay(params) {
  return `
    ${control({ param: 'mix', label: 'Mix', value: params.mix, min: 0, max: 1, step: 0.01, wide: true })}
    ${control({ param: 'time', label: 'Time', value: params.time, min: 0.03, max: 1.5, step: 0.001, unit: 's', digits: 3, wide: true })}
    ${control({ param: 'feedback', label: 'Feedback', value: params.feedback, min: 0, max: 0.85, step: 0.01, wide: true })}
    ${control({ param: 'lowCut', label: 'Low Cut', value: params.lowCut, min: 20, max: 1000, step: 1, unit: 'Hz', digits: 0, wide: true })}
    ${control({ param: 'highCut', label: 'High Cut', value: params.highCut, min: 1000, max: 18000, step: 1, unit: 'Hz', digits: 0, wide: true })}
  `
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
      : renderDelay(params)
  return `<section class="daw-plugin-shell soura-fx-shell" data-plugin-shell="${esc(pluginWindow.pluginInstanceId)}">
    <header class="soura-fx-header">
      <div>
        <span>Soura Audio FX</span>
        <h2>${esc(manifest.name)}</h2>
      </div>
      <strong>${esc(pluginWindow.trackId || 'Track insert')}</strong>
    </header>
    <div class="soura-fx-grid">
      ${body}
      ${control({ param: 'outputGain', label: 'Output', value: params.outputGain, min: -24, max: 12, step: 0.1, unit: 'dB', digits: 1, wide: true })}
    </div>
  </section>`
}
