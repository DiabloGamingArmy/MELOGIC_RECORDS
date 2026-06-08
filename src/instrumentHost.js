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
let connectionTimer = 0
let offlineTimer = 0
let lastDawMessageAt = 0
let hasReceivedHostState = false

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
  }
  channel?.postMessage(payload)
}

function setConnectionStatus(status) {
  if (connectionStatus === status) return
  connectionStatus = status
  const statusEl = app.querySelector('[data-host-connection-status]')
  if (statusEl) statusEl.textContent = status
  app.querySelector('.daw-plugin-host-page')?.setAttribute('data-host-status', status.toLowerCase().includes('connected') ? 'connected' : status.toLowerCase().includes('offline') ? 'offline' : 'connecting')
}

function scheduleOfflineWatch() {
  if (offlineTimer) window.clearTimeout(offlineTimer)
  offlineTimer = window.setTimeout(() => {
    if (Date.now() - lastDawMessageAt > 3500) setConnectionStatus('Offline: main DAW not found')
  }, 3800)
}

function markConnected() {
  lastDawMessageAt = Date.now()
  setConnectionStatus('Connected to DAW')
  scheduleOfflineWatch()
}

function requestConnection() {
  if (Date.now() - lastDawMessageAt > 3500) setConnectionStatus('Connecting to DAW')
  postToMain({ type: 'plugin-ping', needsState: !hasReceivedHostState })
  if (connectionTimer) window.clearTimeout(connectionTimer)
  connectionTimer = window.setTimeout(requestConnection, 1400)
}

function render() {
  document.title = `${instance.title || 'Plugin'} | Melogic DAW`
  const statusKey = connectionStatus.toLowerCase().includes('connected') ? 'connected' : connectionStatus.toLowerCase().includes('offline') ? 'offline' : 'connecting'
  app.innerHTML = `
    <main class="daw-plugin-host-page" data-host-status="${esc(statusKey)}">
      <header class="daw-plugin-host-header">
        <div>
          <span>Detached instrument</span>
          <h1>${esc(instance.title || 'Melogic Wavetable')}</h1>
        </div>
        <p data-host-connection-status>${esc(connectionStatus)}</p>
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
        matrix.push({ source: 'lfo1', target: 'filter.cutoff', amount: 0, bipolar: true, curve: 'linear', enabled: false })
      }
      const field = input.dataset.pluginMatrixField
      matrix[rowIndex][field] = field === 'amount' ? Number(input.value) : input.type === 'checkbox' ? input.checked : input.value
      instance = { ...instance, params: { ...(instance.params || {}), modulationMatrix: matrix } }
      postToMain({ type: 'plugin-param-change', param: 'modulationMatrix', value: matrix })
    }
    input.addEventListener('input', update)
    input.addEventListener('change', update)
  })
  app.querySelectorAll('[data-plugin-add-mod]').forEach((button) => {
    button.addEventListener('click', () => {
      const matrix = Array.isArray(instance.params?.modulationMatrix)
        ? instance.params.modulationMatrix.map((route) => ({ ...route }))
        : []
      if (matrix.length >= 6) return
      matrix.push({ source: 'macro1', target: 'osc1.position', amount: 0, bipolar: false, curve: 'linear', enabled: false })
      instance = { ...instance, params: { ...(instance.params || {}), modulationMatrix: matrix } }
      postToMain({ type: 'plugin-param-change', param: 'modulationMatrix', value: matrix })
      render()
    })
  })
  app.querySelectorAll('[data-plugin-remove-mod]').forEach((button) => {
    button.addEventListener('click', () => {
      const rowIndex = Number(button.dataset.pluginRemoveMod)
      if (!Number.isFinite(rowIndex)) return
      const matrix = Array.isArray(instance.params?.modulationMatrix)
        ? instance.params.modulationMatrix.map((route) => ({ ...route }))
        : []
      if (!matrix[rowIndex]) return
      matrix.splice(rowIndex, 1)
      instance = { ...instance, params: { ...(instance.params || {}), modulationMatrix: matrix } }
      postToMain({ type: 'plugin-param-change', param: 'modulationMatrix', value: matrix })
      render()
    })
  })
  app.querySelectorAll('[data-plugin-param-set]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!button.dataset.pluginParamSet) return
      instance = { ...instance, params: { ...(instance.params || {}), [button.dataset.pluginParamSet]: button.dataset.pluginParamValue || '' } }
      postToMain({ type: 'plugin-param-change', param: button.dataset.pluginParamSet, value: button.dataset.pluginParamValue || '' })
      render()
    })
  })
  app.querySelectorAll('[data-plugin-asset-select]').forEach((button) => {
    button.addEventListener('click', () => {
      instance = { ...instance, params: { ...(instance.params || {}), wavetableId: button.dataset.pluginAssetSelect } }
      postToMain({ type: 'plugin-param-change', param: 'wavetableId', value: button.dataset.pluginAssetSelect })
      render()
    })
  })
  app.querySelectorAll('[data-plugin-page]').forEach((button) => {
    button.addEventListener('click', () => {
      instance = { ...instance, params: { ...(instance.params || {}), mwtPage: button.dataset.pluginPage } }
      postToMain({ type: 'plugin-param-change', param: 'mwtPage', value: button.dataset.pluginPage })
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
    hasReceivedHostState = true
    instance = { ...instance, ...data.instance, params: { ...(instance.params || {}), ...(data.instance.params || {}) } }
    markConnected()
    render()
  }
  if (data.type === 'plugin-param-change' && data.param) {
    markConnected()
    instance = {
      ...instance,
      params: { ...(instance.params || {}), [data.param]: data.value }
    }
    render()
  }
  if (data.type === 'plugin-pong') {
    markConnected()
  }
}

window.addEventListener('message', handleMessage)
window.addEventListener('resize', updateHostScale)
channel?.addEventListener('message', handleMessage)
window.addEventListener('beforeunload', () => {
  if (connectionTimer) window.clearTimeout(connectionTimer)
  if (offlineTimer) window.clearTimeout(offlineTimer)
  postToMain({ type: 'plugin-closed' })
  channel?.close()
})

render()
requestConnection()
