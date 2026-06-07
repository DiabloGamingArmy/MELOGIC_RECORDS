import './styles/base.css'
import './styles/dawPluginWindow.css'
import { createDawPluginInstance, getDawPluginDefinition } from './studio/plugins/pluginCatalog.js'
import { drawWavetableVisualizers, renderPluginShell } from './studio/plugins/MelogicWavetableShell.js'

const CHANNEL_NAME = 'melogic-daw-plugin-host'
const app = document.querySelector('#app')
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null

function esc(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]))
}

function parseHostInstance() {
  const params = new URLSearchParams(window.location.search)
  return createDawPluginInstance({
    pluginType: params.get('pluginType') || 'melogic-wavetable',
    trackId: params.get('trackId') || 'demo-track',
    instanceId: params.get('pluginInstanceId') || ''
  })
}

let instance = parseHostInstance()
let connectionStatus = 'Connecting to DAW'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function updateHostScale() {
  const definition = getDawPluginDefinition(instance.pluginType)
  const frame = definition.fixedFrame
  if (!frame) return
  const availableWidth = window.innerWidth - 32
  const availableHeight = window.innerHeight - 150
  const scale = clamp(Math.min(availableWidth / frame.width, availableHeight / frame.height), frame.minScale || 0.75, frame.maxScale || 1.25)
  app.querySelector('.daw-plugin-host-page')?.style.setProperty('--plugin-scale', String(scale))
}

function postToMain(message = {}) {
  const payload = {
    source: 'melogic-plugin-host',
    pluginInstanceId: instance.pluginInstanceId,
    ...message
  }
  if (window.opener && !window.opener.closed) {
    try {
      window.opener.postMessage(payload, window.location.origin)
    } catch {
      // The opener can disappear while the pop-out remains open.
    }
    return
  }
  channel?.postMessage(payload)
}

function render() {
  document.title = `${instance.title || 'Plugin'} | Melogic DAW`
  app.innerHTML = `
    <main class="daw-plugin-host-page">
      <header class="daw-plugin-host-header">
        <div>
          <span>Detached instrument</span>
          <h1>${esc(instance.title || 'Melogic Wavetable')}</h1>
        </div>
        <p>${esc(connectionStatus)}</p>
      </header>
      ${renderPluginShell(instance, { hostMode: 'detached' })}
      <footer class="daw-plugin-host-footer">
        <span>Instance ${esc(instance.pluginInstanceId)}</span>
        <button type="button" data-close-host>Close pop-out</button>
      </footer>
    </main>
  `
  updateHostScale()
  bind()
}

function bind() {
  app.querySelector('[data-close-host]')?.addEventListener('click', () => window.close())
  app.querySelectorAll('[data-plugin-param]').forEach((input) => {
    input.addEventListener('input', () => {
      if (input.type !== 'range') return
      instance = {
        ...instance,
        params: { ...(instance.params || {}), [input.dataset.pluginParam]: input.value }
      }
      const valueEl = app.querySelector(`[data-plugin-param-value="${input.dataset.pluginParam}"]`)
      if (valueEl) {
        const numeric = Number(input.value)
        valueEl.textContent = Number.isFinite(numeric) ? numeric.toFixed(input.dataset.pluginParam === 'attack' || input.dataset.pluginParam === 'decay' ? 3 : 2) : input.value
      }
      if (['wavetableId', 'wavetablePosition'].includes(input.dataset.pluginParam)) updateVisualizer()
      postToMain({ type: 'plugin-param-change', param: input.dataset.pluginParam, value: input.value })
    })
    input.addEventListener('change', () => {
      instance = {
        ...instance,
        params: { ...(instance.params || {}), [input.dataset.pluginParam]: input.value }
      }
      if (input.dataset.pluginParam?.startsWith('assetBrowser')) {
        render()
        return
      }
      if (['wavetableId', 'wavetablePosition'].includes(input.dataset.pluginParam)) updateVisualizer()
      postToMain({ type: 'plugin-param-change', param: input.dataset.pluginParam, value: input.value })
    })
  })
  app.querySelectorAll('[data-plugin-matrix-field]').forEach((input) => {
    const update = () => {
      const rowIndex = Number(input.dataset.pluginMatrixRow)
      if (!Number.isFinite(rowIndex)) return
      const matrix = Array.isArray(instance.params?.modulationMatrix)
        ? instance.params.modulationMatrix.map((route) => ({ ...route }))
        : []
      while (matrix.length <= rowIndex) {
        matrix.push({ source: 'lfo1', target: 'filter.cutoff', amount: 0, bipolar: true, enabled: false })
      }
      const field = input.dataset.pluginMatrixField
      matrix[rowIndex][field] = field === 'amount' ? Number(input.value) : input.type === 'checkbox' ? input.checked : input.value
      instance = { ...instance, params: { ...(instance.params || {}), modulationMatrix: matrix } }
      postToMain({ type: 'plugin-param-change', param: 'modulationMatrix', value: matrix })
    }
    input.addEventListener('input', update)
    input.addEventListener('change', update)
  })
  app.querySelectorAll('[data-plugin-asset-select]').forEach((button) => {
    button.addEventListener('click', () => {
      instance = { ...instance, params: { ...(instance.params || {}), wavetableId: button.dataset.pluginAssetSelect } }
      postToMain({ type: 'plugin-param-change', param: 'wavetableId', value: button.dataset.pluginAssetSelect })
      render()
    })
  })
  app.querySelectorAll('[data-plugin-note]').forEach((button) => {
    const start = (event) => {
      event.preventDefault()
      button.classList.add('is-playing')
      postToMain({ type: 'plugin-note-on', note: Number(button.dataset.pluginNote), velocity: 0.85 })
    }
    const stop = () => {
      button.classList.remove('is-playing')
      postToMain({ type: 'plugin-note-off', note: Number(button.dataset.pluginNote) })
    }
    button.addEventListener('pointerdown', start)
    button.addEventListener('pointerup', stop)
    button.addEventListener('pointerleave', stop)
      button.addEventListener('blur', stop)
  })
  updateVisualizer()
}

function updateVisualizer() {
  app.querySelectorAll('[data-wavetable-visualizer]').forEach((canvas) => {
    canvas.dataset.wavetableId = instance.params?.wavetableId || 'builtin-saw'
    canvas.dataset.wavetablePosition = String(instance.params?.wavetablePosition ?? 0.35)
  })
  window.requestAnimationFrame(() => drawWavetableVisualizers(app))
}

function handleMessage(event) {
  if (event?.origin && event.origin !== window.location.origin) return
  const data = event?.data || {}
  if (data.source !== 'melogic-daw') return
  if (data.pluginInstanceId && data.pluginInstanceId !== instance.pluginInstanceId) return
  if ((data.type === 'plugin-opened' || data.type === 'plugin-state') && data.instance) {
    instance = { ...instance, ...data.instance, params: { ...(instance.params || {}), ...(data.instance.params || {}) } }
    connectionStatus = 'Connected to DAW'
    render()
  }
  if (data.type === 'plugin-param-change' && data.param) {
    instance = {
      ...instance,
      params: { ...(instance.params || {}), [data.param]: data.value }
    }
    render()
  }
  if (data.type === 'plugin-pong') {
    connectionStatus = 'Connected to DAW'
    render()
  }
}

window.addEventListener('message', handleMessage)
window.addEventListener('resize', updateHostScale)
channel?.addEventListener('message', handleMessage)
window.addEventListener('beforeunload', () => {
  postToMain({ type: 'plugin-closed' })
  channel?.close()
})

render()
postToMain({ type: 'plugin-ping' })
