import { createDawPluginInstance, getDawPluginDefinition } from './pluginCatalog.js'

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
  constructor({ renderContent, getHostUrl, onChange } = {}) {
    this.renderContent = typeof renderContent === 'function' ? renderContent : () => ''
    this.getHostUrl = typeof getHostUrl === 'function' ? getHostUrl : () => '/instrument-host.html'
    this.onChange = typeof onChange === 'function' ? onChange : () => {}
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

  openPlugin({ pluginType, trackId } = {}) {
    const instance = createDawPluginInstance({ pluginType, trackId })
    const existing = this.windows.get(instance.pluginInstanceId)
    if (existing) {
      existing.minimized = false
      this.bringToFront(existing.pluginInstanceId)
      this.persist()
      this.onChange()
      return existing
    }

    const saved = this.sessionState[instance.pluginInstanceId] || {}
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
    this.windows.set(windowState.pluginInstanceId, windowState)
    this.persist()
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

  renderWindow(windowState) {
    const definition = getDawPluginDefinition(windowState.pluginType)
    const position = windowState.windowPosition || { x: 96, y: 92 }
    const size = windowState.windowSize || definition.defaultSize
    const status = windowState.detached ? 'Detached' : (definition.status || 'Ready')
    return `
      <article
        class="daw-plugin-window ${windowState.minimized ? 'is-minimized' : ''} ${windowState.detached ? 'is-detached' : ''}"
        data-plugin-window="${esc(windowState.pluginInstanceId)}"
        style="left:${Number(position.x) || 0}px;top:${Number(position.y) || 0}px;width:${Number(size.width) || definition.defaultSize.width}px;height:${Number(size.height) || definition.defaultSize.height}px;z-index:${Number(windowState.zIndex) || 1};"
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
      input.addEventListener('change', () => {
        const shell = input.closest('[data-plugin-shell]')
        if (!shell?.dataset?.pluginShell) return
        this.updateParam(shell.dataset.pluginShell, input.dataset.pluginParam, input.value)
      })
    })
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
    this.persist()
    this.onChange()
  }

  detachWindow(id) {
    const windowState = this.windows.get(id)
    if (!windowState) return
    this.bringToFront(id)
    const url = this.getHostUrl(windowState)
    const popout = window.open(url, `melogic-plugin-${id.replace(/[^a-z0-9_-]/gi, '-')}`, 'popup=yes,width=980,height=720,resizable=yes,scrollbars=yes')
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
      if (target && !target.closed) target.postMessage(safeMessage, window.location.origin)
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
    windowState.params = { ...(windowState.params || {}), [param]: value }
    this.persist()
    if (notifyHost) this.postHostMessage({ type: 'plugin-param-change', pluginInstanceId: id, param, value }, this.hostWindows.get(id))
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
      origin: { ...(windowState.windowSize || MIN_WINDOW_SIZE) }
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
    const size = windowState.windowSize || MIN_WINDOW_SIZE
    return {
      maxX: Math.max(0, rect.width - Math.min(180, size.width)),
      maxY: Math.max(0, rect.height - 44),
      maxWidth: Math.max(MIN_WINDOW_SIZE.width, rect.width - 32),
      maxHeight: Math.max(MIN_WINDOW_SIZE.height, rect.height - 80)
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
    const bounds = this.getBounds(windowState)
    const width = clamp(state.origin.width + event.clientX - state.startX, MIN_WINDOW_SIZE.width, bounds.maxWidth)
    const height = clamp(state.origin.height + event.clientY - state.startY, MIN_WINDOW_SIZE.height, bounds.maxHeight)
    windowState.windowSize = { width, height }
    this.updateWindowDom(windowState)
  }

  updateWindowDom(windowState) {
    const element = document.querySelector(`[data-plugin-window="${CSS.escape(windowState.pluginInstanceId)}"]`)
    if (!element) return
    element.style.left = `${windowState.windowPosition.x}px`
    element.style.top = `${windowState.windowPosition.y}px`
    element.style.width = `${windowState.windowSize.width}px`
    element.style.height = `${windowState.windowSize.height}px`
    element.style.zIndex = String(windowState.zIndex || 1)
  }
}
