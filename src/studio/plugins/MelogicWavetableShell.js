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

function percent(value = 0) {
  const numeric = Number.isFinite(Number(value)) ? Number(value) : 0
  return `${Math.round(Math.max(0, Math.min(1, numeric)) * 100)}%`
}

function sectionCard(title, label, body, meterValue = null) {
  return `
    <section class="daw-plugin-section">
      <header>
        <span>${esc(label)}</span>
        <h3>${esc(title)}</h3>
      </header>
      <p>${esc(body)}</p>
      ${meterValue == null ? '' : `<div class="daw-plugin-meter" aria-label="${esc(title)} amount"><span style="width:${percent(meterValue)}"></span></div>`}
    </section>
  `
}

export function renderMelogicWavetableShell(instance = {}, { hostMode = 'inline' } = {}) {
  const definition = getDawPluginDefinition(instance.pluginType)
  const params = { ...definition.defaultParams, ...(instance.params || {}) }
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
        ${sectionCard('Oscillator', 'OSC A / B', 'Wavetable position, unison, blend, warp, and noise placeholders.', params.oscillatorBlend)}
        ${sectionCard('Filter', 'MULTIMODE', 'Cutoff, resonance, drive, key tracking, and routing placeholders.', params.filterCutoff)}
        ${sectionCard('Envelope', 'AMP ENV', 'Attack, decay, sustain, and release controls will drive future voice shaping.', params.ampAttack)}
        ${sectionCard('LFO', 'MOD SOURCE', 'LFO shape, rate, phase, and drag-to-modulate assignment placeholder.', params.lfoRate)}
        ${sectionCard('Output', 'MASTER', 'Gain, pan, limiter, and meter output placeholder.', params.outputGain)}
        <section class="daw-plugin-section daw-plugin-keyboard-panel">
          <header>
            <span>MIDI</span>
            <h3>Keyboard</h3>
          </header>
          <div class="daw-plugin-keyboard" aria-label="Keyboard placeholder">
            ${['C', 'D', 'E', 'F', 'G', 'A', 'B', 'C'].map((key) => `<span>${esc(key)}</span>`).join('')}
          </div>
          <p>MIDI input, voice allocation, pitch/mod wheels, and note preview are scaffolded only.</p>
        </section>
      </div>
    </article>
  `
}

export function renderPluginShell(instance = {}, options = {}) {
  return renderMelogicWavetableShell(instance, options)
}
