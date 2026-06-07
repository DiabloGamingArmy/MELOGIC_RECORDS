import './styles/base.css'
import './styles/dawPluginWindow.css'
import { createDawPluginInstance } from './studio/plugins/pluginCatalog.js'
import { renderPluginShell } from './studio/plugins/MelogicWavetableShell.js'

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
  bind()
}

function bind() {
  app.querySelector('[data-close-host]')?.addEventListener('click', () => window.close())
  app.querySelectorAll('[data-plugin-param]').forEach((input) => {
    input.addEventListener('change', () => {
      instance = {
        ...instance,
        params: { ...(instance.params || {}), [input.dataset.pluginParam]: input.value }
      }
      postToMain({ type: 'plugin-param-change', param: input.dataset.pluginParam, value: input.value })
    })
  })
}

function handleMessage(event) {
  if (event?.origin && event.origin !== window.location.origin) return
  const data = event?.data || {}
  if (data.source !== 'melogic-daw') return
  if (data.pluginInstanceId && data.pluginInstanceId !== instance.pluginInstanceId) return
  if (data.type === 'plugin-opened' && data.instance) {
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
channel?.addEventListener('message', handleMessage)
window.addEventListener('beforeunload', () => {
  postToMain({ type: 'plugin-closed' })
  channel?.close()
})

render()
postToMain({ type: 'plugin-ping' })
