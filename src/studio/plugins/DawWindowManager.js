import { createDawPluginInstance, getDawPluginDefinition } from './pluginCatalog.js'
import { getMelogicWavetablePreset } from './melogicWavetablePresets.js'
import { drawWavetableVisualizers } from './MelogicWavetableShell.js'

const SESSION_KEY = 'melogic-daw-plugin-window-state-v1'
const CHANNEL_NAME = 'melogic-daw-plugin-host'
const MIN_WINDOW_SIZE = { width: 420, height: 320 }

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
  return Math.min(max, Math.max(min, value))
}

function readSessionState() {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(SESSION_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeSessionState(state) {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(state || {}))
  } catch {
    // Session persistence is a convenience; private-mode storage failures should not block the DAW.
  }
}

export class DawWindowManager {
  constructor({ renderContent, getHostUrl, onChange, onOpen, onClose, onParamChange, onNoteOn, onNoteOff } = {}) {
    this.renderContent = typeof renderContent === 'function' ? renderContent : () => ''
    this.getHostUrl = typeof getHostUrl === 'function' ? getHostUrl : () => '/instrument-host.html'
    this.onChange = typeof onChange === 'function' ? onChange : () => {}
    this.onOpen = typeof onOpen === 'function' ? onOpen : () => {}
    this.onClose = typeof onClose === 'function' ? onClose : () => {}
    this.onParamChange = typeof onParamChange === 'function' ? onParamChange : () => {}
    this.onNoteOn = typeof onNoteOn === 'function' ? onNoteOn : () => {}
    this.onNoteOff = typeof onNoteOff === 'function' ? onNoteOff : () => {}
    this.windows = new Map()
    this.zCounter = 30
    this.dragState = null
    this.resizeState = null
    this.hostWindows = new Map()
    this.sessionState = readSessionState()
    this.channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL_NAME) : null
    this.handlePointerMove = this.handlePointerMove.bind(this)
    this.handlePointerUp = this.handlePointerUp.bind(this)
    this.handleHostMessage = this.handleHostMessage.bind(this)
    window.addEventListener('message', this.handleHostMessage)
    this.channel?.addEventListener('message', this.handleHostMessage)
  }

  destroy() {
    window.removeEventListener('message', this.handleHostMessage)
    this.channel?.removeEventListener('message', this.handleHostMessage)
    this.channel?.close()
  }

  openPlugin({ pluginType, trackId, instanceId = '', params = {}, forceCenter = false } = {}) {
    const instance = createDawPluginInstance({ pluginType, trackId, instanceId, params })
    const existing = this.windows.get(instance.pluginInstanceId)
    if (existing) {
      existing.minimized = false
      existing.windowSize = this.sanitizeWindowSize(existing)
      if (forceCenter) existing.windowPosition = this.sanitizeWindowPosition(existing, true)
      this.bringToFront(existing.pluginInstanceId)
      this.persist()
      this.onChange()
      this.onOpen(existing)
      return existing
    }

    const saved = forceCenter ? {} : (this.sessionState[instance.pluginInstanceId] || {})
    const windowState = {
      ...instance,
      ...saved,
      params: { ...instance.params, ...(saved.params || {}) },
      windowPosition: { ...instance.windowPosition, ...(saved.windowPosition || {}) },
      windowSize: { ...instance.windowSize, ...(saved.windowSize || {}) },
      detached: false,
      minimized: false,
      zIndex: ++this.zCounter
    }
    windowState.windowSize = this.sanitizeWindowSize(windowState)
    windowState.windowPosition = this.sanitizeWindowPosition(windowState, forceCenter)
    this.windows.set(windowState.pluginInstanceId, windowState)
    this.persist()
    this.onOpen(windowState)
    this.onChange()
    return windowState
  }

  getState() {
    return Array.from(this.windows.values()).map((windowState) => ({
      pluginInstanceId: windowState.pluginInstanceId,
      pluginType: windowState.pluginType,
      title: windowState.title,
      trackId: windowState.trackId,
      detached: Boolean(windowState.detached),
      minimized: Boolean(windowState.minimized),
      windowPosition: { ...windowState.windowPosition },
      windowSize: { ...windowState.windowSize },
      params: { ...(windowState.params || {}) }
    }))
  }

  persist() {
    const next = { ...this.sessionState }
    this.windows.forEach((windowState, id) => {
      next[id] = {
        pluginType: windowState.pluginType,
        title: windowState.title,
        trackId: windowState.trackId,
        windowPosition: { ...windowState.windowPosition },
        windowSize: { ...windowState.windowSize },
        params: { ...(windowState.params || {}) }
      }
    })
    this.sessionState = next
    writeSessionState(next)
  }

  renderWindows() {
    if (!this.windows.size) return ''
    return `
      <section class="daw-window-layer" data-daw-window-layer aria-label="DAW plugin windows">
        ${Array.from(this.windows.values()).map((windowState) => this.renderWindow(windowState)).join('')}
      </section>
    `
  }

  getPluginFrame(definition) {
    return definition?.fixedFrame || null
  }

  getWindowScale(windowState, definition = getDawPluginDefinition(windowState.pluginType)) {
    const frame = this.getPluginFrame(definition)
    if (!frame) return 1
    const headerHeight = Number(frame.headerHeight) || 42
    const size = windowState.windowSize || definition.defaultSize || MIN_WINDOW_SIZE
    const widthScale = Number(size.width) / frame.width
    const heightScale = (Number(size.height) - headerHeight) / frame.height
    const scale = Math.min(widthScale, heightScale)
    return clamp(Number.isFinite(scale) && scale > 0 ? scale : 1, frame.minScale || 0.75, frame.maxScale || 1.25)
  }

  getRenderSize(windowState, definition = getDawPluginDefinition(windowState.pluginType)) {
    const frame = this.getPluginFrame(definition)
    if (!frame) return windowState.windowSize || definition.defaultSize || MIN_WINDOW_SIZE
    const scale = this.getWindowScale(windowState, definition)
    const headerHeight = Number(frame.headerHeight) || 42
    return {
      width: Math.round(frame.width * scale),
      height: Math.round(headerHeight + frame.height * scale)
    }
  }

  getFitScale(definition) {
    const frame = this.getPluginFrame(definition)
    if (!frame) return 1
    const container = document.querySelector('.studio-editor-page') || document.documentElement
    const rect = container.getBoundingClientRect()
    const headerHeight = Number(frame.headerHeight) || 42
    const widthScale = (rect.width - 32) / frame.width
    const heightScale = (rect.height - 80 - headerHeight) / frame.height
    const fitScale = Math.min(widthScale, heightScale)
    return clamp(Number.isFinite(fitScale) && fitScale > 0 ? fitScale : 1, frame.minScale || 0.75, frame.maxScale || 1.25)
  }

  sanitizeWindowSize(windowState) {
    const definition = getDawPluginDefinition(windowState.pluginType)
    const frame = this.getPluginFrame(definition)
    if (!frame) return windowState.windowSize || definition.defaultSize || MIN_WINDOW_SIZE
    const currentScale = this.getWindowScale(windowState, definition)
    const scale = Math.min(currentScale, this.getFitScale(definition))
    const headerHeight = Number(frame.headerHeight) || 42
    return {
      width: Math.round(frame.width * scale),
      height: Math.round(headerHeight + frame.height * scale)
    }
  }

  renderWindow(windowState) {
    const definition = getDawPluginDefinition(windowState.pluginType)
    const position = windowState.windowPosition || { x: 96, y: 92 }
    const size = this.getRenderSize(windowState, definition)
    const scale = this.getWindowScale(windowState, definition)
    const status = windowState.detached ? 'Detached' : (definition.status || 'Ready')
    return `
      <article
        class="daw-plugin-window ${windowState.minimized ? 'is-minimized' : ''} ${windowState.detached ? 'is-detached' : ''}"
        data-plugin-window="${esc(windowState.pluginInstanceId)}"
        style="left:${Number(position.x) || 0}px;top:${Number(position.y) || 0}px;width:${Number(size.width) || definition.defaultSize.width}px;height:${Number(size.height) || definition.defaultSize.height}px;z-index:${Number(windowState.zIndex) || 1};--plugin-scale:${scale};"
      >
        <header class="daw-plugin-window-header" data-plugin-window-header="${esc(windowState.pluginInstanceId)}">
          <div>
            <strong>${esc(windowState.title || definition.title)}</strong>
            <span>${esc(status)}</span>
          </div>
          <nav aria-label="${esc(windowState.title || definition.title)} window controls">
            <button type="button" data-plugin-window-minimize="${esc(windowState.pluginInstanceId)}" aria-label="Minimize ${esc(windowState.title)}">${windowState.minimized ? '+' : '-'}</button>
            <button type="button" data-plugin-window-detach="${esc(windowState.pluginInstanceId)}" aria-label="Detach ${esc(windowState.title)}">Detach</button>
            <button type="button" data-plugin-window-close="${esc(windowState.pluginInstanceId)}" aria-label="Close ${esc(windowState.title)}">×</button>
          </nav>
        </header>
        <div class="daw-plugin-window-body">
          ${windowState.detached ? `<div class="daw-plugin-detached-note"><strong>${esc(windowState.title)}</strong><p>This instrument is open in a browser pop-out. Close the pop-out or click the header controls to bring this shell back.</p></div>` : this.renderContent(windowState)}
        </div>
        <button class="daw-plugin-window-resize" type="button" data-plugin-window-resize="${esc(windowState.pluginInstanceId)}" aria-label="Resize ${esc(windowState.title)}"></button>
      </article>
    `
  }

  bind(root) {
    const scope = root || document
    scope.querySelectorAll('[data-plugin-window]').forEach((element) => {
      element.addEventListener('pointerdown', () => this.bringToFront(element.dataset.pluginWindow))
    })
    scope.querySelectorAll('[data-plugin-window-header]').forEach((header) => {
      header.addEventListener('pointerdown', (event) => this.startDrag(event, header.dataset.pluginWindowHeader))
    })
    scope.querySelectorAll('[data-plugin-window-resize]').forEach((handle) => {
      handle.addEventListener('pointerdown', (event) => this.startResize(event, handle.dataset.pluginWindowResize))
    })
    scope.querySelectorAll('[data-plugin-window-minimize]').forEach((button) => {
      button.addEventListener('click', () => this.toggleMinimize(button.dataset.pluginWindowMinimize))
    })
    scope.querySelectorAll('[data-plugin-window-close]').forEach((button) => {
      button.addEventListener('click', () => this.closeWindow(button.dataset.pluginWindowClose))
    })
    scope.querySelectorAll('[data-plugin-window-detach]').forEach((button) => {
      button.addEventListener('click', () => this.detachWindow(button.dataset.pluginWindowDetach))
    })
    scope.querySelectorAll('[data-plugin-param]').forEach((input) => {
      input.addEventListener('input', () => {
        if (input.type !== 'range') return
        const shell = input.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.updateParam(shell.dataset.pluginShell, input.dataset.pluginParam, input.value)
      })
      input.addEventListener('change', () => {
        const shell = input.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.updateParam(shell.dataset.pluginShell, input.dataset.pluginParam, input.value)
      })
    })
    scope.querySelectorAll('[data-plugin-matrix-field]').forEach((input) => {
      const update = () => {
        const shell = input.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.updateMatrixParam(shell.dataset.pluginShell, Number(input.dataset.pluginMatrixRow), input.dataset.pluginMatrixField, input.type === 'checkbox' ? input.checked : input.value)
      }
      input.addEventListener('input', update)
      input.addEventListener('change', update)
    })
    scope.querySelectorAll('[data-plugin-add-mod]').forEach((button) => {
      button.addEventListener('click', () => {
        const shell = button.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.addMatrixRoute(shell.dataset.pluginShell)
      })
    })
    scope.querySelectorAll('[data-plugin-param-set]').forEach((button) => {
      button.addEventListener('click', () => {
        const shell = button.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell || !button.dataset.pluginParamSet) return
        this.updateParam(shell.dataset.pluginShell, button.dataset.pluginParamSet, button.dataset.pluginParamValue || '')
      })
    })
    scope.querySelectorAll('[data-plugin-page]').forEach((button) => {
      button.addEventListener('click', () => {
        const shell = button.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell || !button.dataset.pluginPage) return
        this.updateParam(shell.dataset.pluginShell, 'mwtPage', button.dataset.pluginPage)
      })
    })
    scope.querySelectorAll('[data-plugin-asset-select]').forEach((button) => {
      button.addEventListener('click', () => {
        const shell = button.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.updateParam(shell.dataset.pluginShell, 'wavetableId', button.dataset.pluginAssetSelect)
        this.renderPluginBody(shell.dataset.pluginShell)
      })
    })
    scope.querySelectorAll('[data-plugin-note]').forEach((button) => {
      const start = (event) => {
        event.preventDefault()
        const shell = button.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.onNoteOn(shell.dataset.pluginShell, Number(button.dataset.pluginNote), 0.85)
        button.classList.add('is-playing')
      }
      const stop = () => {
        const shell = button.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.onNoteOff(shell.dataset.pluginShell, Number(button.dataset.pluginNote))
        button.classList.remove('is-playing')
      }
      button.addEventListener('pointerdown', start)
      button.addEventListener('pointerup', stop)
      button.addEventListener('pointerleave', stop)
      button.addEventListener('blur', stop)
    })
    this.scheduleVisualizerDraw(scope)
  }

  bringToFront(id) {
    const windowState = this.windows.get(id)
    if (!windowState) return
    windowState.zIndex = ++this.zCounter
  }

  toggleMinimize(id) {
    const windowState = this.windows.get(id)
    if (!windowState) return
    windowState.minimized = !windowState.minimized
    this.bringToFront(id)
    this.persist()
    this.onChange()
  }

  closeWindow(id) {
    const popout = this.hostWindows.get(id)
    if (popout && !popout.closed) popout.close()
    this.hostWindows.delete(id)
    this.windows.delete(id)
    delete this.sessionState[id]
    writeSessionState(this.sessionState)
    this.onClose(id)
    this.persist()
    this.onChange()
  }

  detachWindow(id) {
    const windowState = this.windows.get(id)
    if (!windowState) return
    this.bringToFront(id)
    const url = this.getHostUrl(windowState)
    const size = this.getRenderSize(windowState)
    const popout = window.open(url, `melogic-plugin-${id.replace(/[^a-z0-9_-]/gi, '-')}`, `popup=yes,width=${Math.round(size.width + 24)},height=${Math.round(size.height + 92)},resizable=yes,scrollbars=yes`)
    if (!popout) {
      windowState.detached = false
      windowState.minimized = false
      this.onChange()
      return
    }
    this.hostWindows.set(id, popout)
    windowState.detached = true
    windowState.minimized = true
    this.persist()
    this.postHostMessage({ type: 'plugin-opened', pluginInstanceId: id, instance: this.serializeForHost(windowState) }, popout)
    this.watchPopout(id, popout)
    this.onChange()
  }

  serializeForHost(windowState) {
    return {
      pluginInstanceId: windowState.pluginInstanceId,
      pluginType: windowState.pluginType,
      title: windowState.title,
      trackId: windowState.trackId,
      detached: true,
      params: { ...(windowState.params || {}) }
    }
  }

  postHostMessage(message, target = null) {
    const safeMessage = { source: 'melogic-daw', ...message }
    try {
      if (target && !target.closed) {
        target.postMessage(safeMessage, window.location.origin)
        return
      }
    } catch {
      // Pop-out may be closed between checks.
    }
    this.channel?.postMessage(safeMessage)
  }

  handleHostMessage(event) {
    if (event?.origin && event.origin !== window.location.origin) return
    const data = event?.data || {}
    if (data.source !== 'melogic-plugin-host') return
    const id = String(data.pluginInstanceId || '').trim()
    const windowState = this.windows.get(id)
    if (!id || !windowState) return
    if (data.type === 'plugin-closed') {
      windowState.detached = false
      windowState.minimized = false
      this.hostWindows.delete(id)
      this.persist()
      this.onChange()
    }
    if (data.type === 'plugin-param-change' && data.param) {
      this.updateParam(id, data.param, data.value, { notifyHost: false })
    }
    if (data.type === 'plugin-note-on') {
      this.onNoteOn(id, Number(data.note), Number(data.velocity ?? 0.85))
    }
    if (data.type === 'plugin-note-off') {
      this.onNoteOff(id, Number(data.note))
    }
    if (data.type === 'plugin-ping') {
      this.postHostMessage({ type: 'plugin-pong', pluginInstanceId: id }, event.source || this.hostWindows.get(id))
    }
  }

  watchPopout(id, popout) {
    const timer = window.setInterval(() => {
      if (!popout.closed) return
      window.clearInterval(timer)
      const windowState = this.windows.get(id)
      if (!windowState) return
      windowState.detached = false
      windowState.minimized = false
      this.hostWindows.delete(id)
      this.persist()
      this.onChange()
    }, 800)
  }

  updateParam(id, param, value, { notifyHost = true } = {}) {
    const windowState = this.windows.get(id)
    if (!windowState || !param) return
    const patch = param === 'preset'
      ? { ...getMelogicWavetablePreset(value).params, preset: getMelogicWavetablePreset(value).id }
      : { [param]: value }
    windowState.params = { ...(windowState.params || {}), ...patch }
    Object.entries(patch).forEach(([name, nextValue]) => {
      this.onParamChange(id, name, nextValue)
      this.updateParamValueDom(id, name, nextValue)
    })
    if (param === 'preset' || param === 'mwtPage' || param.startsWith('assetBrowser') || ['oscCount', 'selectedOsc', 'fxRack', 'selectedFx', 'modSource'].includes(param)) this.renderPluginBody(id)
    if (['wavetableId', 'wavetablePosition'].includes(param)) this.updateVisualizerDom(id)
    this.persist()
    if (notifyHost) {
      this.postHostMessage({ type: 'plugin-state', pluginInstanceId: id, instance: this.serializeForHost(windowState) }, this.hostWindows.get(id))
    }
  }

  updateMatrixParam(id, rowIndex, field, value) {
    const windowState = this.windows.get(id)
    if (!windowState || !Number.isFinite(rowIndex) || !field) return
    const matrix = Array.isArray(windowState.params?.modulationMatrix)
      ? windowState.params.modulationMatrix.map((route) => ({ ...route }))
      : []
    while (matrix.length <= rowIndex) {
      matrix.push({ source: 'lfo1', target: 'filter.cutoff', amount: 0, bipolar: true, enabled: false })
    }
    matrix[rowIndex][field] = field === 'amount' ? Number(value) : value
    windowState.params = { ...(windowState.params || {}), modulationMatrix: matrix }
    this.onParamChange(id, 'modulationMatrix', matrix)
    this.persist()
    this.postHostMessage({ type: 'plugin-state', pluginInstanceId: id, instance: this.serializeForHost(windowState) }, this.hostWindows.get(id))
  }

  addMatrixRoute(id) {
    const windowState = this.windows.get(id)
    if (!windowState) return
    const matrix = Array.isArray(windowState.params?.modulationMatrix)
      ? windowState.params.modulationMatrix.map((route) => ({ ...route }))
      : []
    if (matrix.length >= 6) return
    matrix.push({ source: 'macro1', target: 'osc1.position', amount: 0, bipolar: false, enabled: false })
    windowState.params = { ...(windowState.params || {}), modulationMatrix: matrix }
    this.onParamChange(id, 'modulationMatrix', matrix)
    this.persist()
    this.renderPluginBody(id)
    this.postHostMessage({ type: 'plugin-state', pluginInstanceId: id, instance: this.serializeForHost(windowState) }, this.hostWindows.get(id))
  }

  renderPluginBody(id) {
    const windowState = this.windows.get(id)
    const body = document.querySelector(`[data-plugin-window="${CSS.escape(id)}"] .daw-plugin-window-body`)
    if (!windowState || !body || windowState.detached) return
    body.innerHTML = this.renderContent(windowState)
    this.bind(body)
  }

  scheduleVisualizerDraw(root = document) {
    window.requestAnimationFrame(() => drawWavetableVisualizers(root))
  }

  updateVisualizerDom(id) {
    const root = document.querySelector(`[data-plugin-shell="${CSS.escape(id)}"]`)
    const windowState = this.windows.get(id)
    const canvas = root?.querySelector('[data-wavetable-visualizer]')
    if (!canvas || !windowState) return
    canvas.dataset.wavetableId = windowState.params?.wavetableId || 'builtin-saw'
    canvas.dataset.wavetablePosition = String(windowState.params?.wavetablePosition ?? 0.35)
    this.scheduleVisualizerDraw(root)
  }

  updateParamValueDom(id, param, value) {
    const root = document.querySelector(`[data-plugin-shell="${CSS.escape(id)}"]`)
    const valueElement = root?.querySelector(`[data-plugin-param-value="${CSS.escape(param)}"]`)
    if (!valueElement) return
    const numeric = Number(value)
    valueElement.textContent = Number.isFinite(numeric) ? numeric.toFixed(param === 'attack' || param === 'decay' ? 3 : 2) : String(value)
  }

  startDrag(event, id) {
    if (event.button !== 0 || event.target.closest('button, select, input, textarea')) return
    const windowState = this.windows.get(id)
    if (!windowState) return
    event.preventDefault()
    this.bringToFront(id)
    this.dragState = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...(windowState.windowPosition || { x: 0, y: 0 }) }
    }
    document.body.classList.add('is-daw-window-dragging')
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp, { once: true })
  }

  startResize(event, id) {
    if (event.button !== 0) return
    const windowState = this.windows.get(id)
    if (!windowState) return
    event.preventDefault()
    this.bringToFront(id)
    this.resizeState = {
      id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...this.getRenderSize(windowState) }
    }
    document.body.classList.add('is-daw-window-dragging')
    window.addEventListener('pointermove', this.handlePointerMove)
    window.addEventListener('pointerup', this.handlePointerUp, { once: true })
  }

  handlePointerMove(event) {
    if (this.dragState) this.applyDrag(event)
    if (this.resizeState) this.applyResize(event)
  }

  handlePointerUp() {
    this.dragState = null
    this.resizeState = null
    document.body.classList.remove('is-daw-window-dragging')
    window.removeEventListener('pointermove', this.handlePointerMove)
    this.persist()
  }

  getBounds(windowState) {
    const container = document.querySelector('.studio-editor-page') || document.documentElement
    const rect = container.getBoundingClientRect()
    const size = this.getRenderSize(windowState)
    return {
      maxX: Math.max(0, rect.width - Math.min(180, size.width)),
      maxY: Math.max(0, rect.height - 44),
      maxWidth: Math.max(MIN_WINDOW_SIZE.width, rect.width - 32),
      maxHeight: Math.max(MIN_WINDOW_SIZE.height, rect.height - 80)
    }
  }

  getCenteredPosition(windowState) {
    const container = document.querySelector('.studio-editor-page') || document.documentElement
    const rect = container.getBoundingClientRect()
    const size = this.getRenderSize(windowState)
    return {
      x: Math.max(12, Math.round((rect.width - Math.min(size.width, rect.width - 24)) / 2)),
      y: Math.max(54, Math.round((rect.height - Math.min(size.height, rect.height - 72)) / 2))
    }
  }

  sanitizeWindowPosition(windowState, forceCenter = false) {
    if (forceCenter) return this.getCenteredPosition(windowState)
    const position = windowState.windowPosition || { x: 96, y: 92 }
    const size = this.getRenderSize(windowState)
    const bounds = this.getBounds({ ...windowState, windowSize: size })
    const headerReachable = position.y >= 0 && position.y <= bounds.maxY && position.x <= bounds.maxX && position.x + Math.min(180, size.width) >= 0
    if (!headerReachable) return this.getCenteredPosition({ ...windowState, windowSize: size })
    return {
      x: clamp(Number(position.x) || 0, 0, bounds.maxX),
      y: clamp(Number(position.y) || 0, 0, bounds.maxY)
    }
  }

  applyDrag(event) {
    const state = this.dragState
    const windowState = this.windows.get(state.id)
    if (!windowState) return
    const bounds = this.getBounds(windowState)
    const x = clamp(state.origin.x + event.clientX - state.startX, 0, bounds.maxX)
    const y = clamp(state.origin.y + event.clientY - state.startY, 0, bounds.maxY)
    windowState.windowPosition = { x, y }
    this.updateWindowDom(windowState)
  }

  applyResize(event) {
    const state = this.resizeState
    const windowState = this.windows.get(state.id)
    if (!windowState) return
    const definition = getDawPluginDefinition(windowState.pluginType)
    const frame = this.getPluginFrame(definition)
    const bounds = this.getBounds(windowState)
    const rawWidth = clamp(state.origin.width + event.clientX - state.startX, MIN_WINDOW_SIZE.width, bounds.maxWidth)
    const rawHeight = clamp(state.origin.height + event.clientY - state.startY, MIN_WINDOW_SIZE.height, bounds.maxHeight)
    if (frame) {
      const headerHeight = Number(frame.headerHeight) || 42
      const scale = clamp(Math.min(rawWidth / frame.width, (rawHeight - headerHeight) / frame.height), frame.minScale || 0.75, frame.maxScale || 1.25)
      windowState.windowSize = {
        width: Math.round(frame.width * scale),
        height: Math.round(headerHeight + frame.height * scale)
      }
    } else {
      windowState.windowSize = { width: rawWidth, height: rawHeight }
    }
    this.updateWindowDom(windowState)
  }

  updateWindowDom(windowState) {
    const element = document.querySelector(`[data-plugin-window="${CSS.escape(windowState.pluginInstanceId)}"]`)
    if (!element) return
    element.style.left = `${windowState.windowPosition.x}px`
    element.style.top = `${windowState.windowPosition.y}px`
    const size = this.getRenderSize(windowState)
    element.style.width = `${size.width}px`
    element.style.height = `${size.height}px`
    element.style.zIndex = String(windowState.zIndex || 1)
    element.style.setProperty('--plugin-scale', String(this.getWindowScale(windowState)))
  }
}
