// Temporary on-device trace for native mobile tap activation. Remove after diagnosis.
let installed = false

export function installMobileInteractionDiagnostic() {
  if (installed || !window.matchMedia('(max-width: 760px)').matches || !(window.matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0)) return
  installed = true

  const panel = document.createElement('pre')
  panel.setAttribute('aria-hidden', 'true')
  panel.style.cssText = 'position:fixed;top:calc(env(safe-area-inset-top, 0px) + 68px);left:5px;right:5px;z-index:2147483647;max-height:42vh;overflow:hidden;margin:0;padding:6px;border:1px solid #65d9ff;border-radius:6px;background:rgba(0,0,0,.9);color:#fff;font:10px/1.25 monospace;white-space:pre-wrap;overflow-wrap:anywhere;pointer-events:none'
  document.body.append(panel)

  const events = []
  let originalTarget = null
  let startAt = 0
  let clickSeen = false
  let missingClickTimer = 0
  let clickStatus = 'waiting for tap'

  const label = (node) => {
    if (!(node instanceof Element)) return node?.nodeName || 'none'
    return `${node.tagName.toLowerCase()}${node.id ? `#${node.id}` : ''}${Array.from(node.classList).slice(0, 2).map(name => `.${name}`).join('')}`
  }
  const paint = () => {
    const latest = events[events.length - 1]
    panel.textContent = [
      `TAP TRACE  ${clickStatus}`,
      ...events.slice(-6).map(item => `${item.type.padEnd(11)} ${item.time} ${item.defaultPrevented ? 'PREVENTED' : 'ok'} ${item.originalConnected ? 'connected' : 'REMOVED'}`),
      `TARGET: ${latest?.target || '-'}`,
      `CONTROL: ${latest?.control || '-'}`,
      `TOP ELEMENT: ${latest?.top || '-'}`,
      `DEFAULT PREVENTED: ${latest?.defaultPrevented ?? '-'}`,
      `START TARGET CONNECTED: ${latest?.originalConnected ?? '-'}`,
      `HREF: ${latest?.href || '-'}`,
      `POINTER/XY: ${latest?.pointerType || '-'} / ${latest?.x ?? '-'},${latest?.y ?? '-'}`,
      `LOCATION: ${latest?.location || location.href}`
    ].join('\n')
  }
  paint()

  const onEvent = (event) => {
    const now = performance.now()
    if ((event.type === 'pointerdown' || event.type === 'touchstart') && now - startAt > 100) {
      originalTarget = event.target
      startAt = now
      clickSeen = false
      clickStatus = 'tap in progress'
      clearTimeout(missingClickTimer)
    }
    const target = event.target instanceof Element ? event.target : event.target?.parentElement
    const control = target?.closest('a,button,input,select,textarea,[role="button"]')
    const touch = event.changedTouches?.[0] || event.touches?.[0]
    const x = touch?.clientX ?? event.clientX
    const y = touch?.clientY ?? event.clientY
    const top = Number.isFinite(x) && Number.isFinite(y) ? document.elementFromPoint(x, y) : null
    const item = {
      type: event.type,
      time: new Date().toLocaleTimeString(),
      target: label(target),
      control: label(control),
      top: label(top),
      href: control?.closest('a[href]')?.href || '',
      defaultPrevented: event.defaultPrevented,
      pointerType: event.pointerType || (touch ? 'touch' : ''),
      x: Number.isFinite(x) ? Math.round(x) : null,
      y: Number.isFinite(y) ? Math.round(y) : null,
      originalConnected: originalTarget?.isConnected ?? null,
      location: location.href
    }
    events.push(item)
    if (events.length > 20) events.shift()
    if (event.type === 'click') {
      clickSeen = true
      clickStatus = 'CLICK received'
      clearTimeout(missingClickTimer)
      // Capture runs before other listeners. Read cancellation again after propagation.
      setTimeout(() => {
        item.defaultPrevented = event.defaultPrevented
        clickStatus = event.defaultPrevented ? 'CLICK CANCELED after capture' : 'CLICK not canceled'
        paint()
      }, 0)
    } else if (event.type === 'touchend' || event.type === 'pointerup') {
      clearTimeout(missingClickTimer)
      missingClickTimer = setTimeout(() => {
        if (!clickSeen) {
          clickStatus = `NO CLICK after touch; start connected: ${originalTarget?.isConnected ?? '-'}`
          paint()
        }
      }, 900)
    }
    paint()
  }

  for (const type of ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'click']) {
    document.addEventListener(type, onEvent, { capture: true, passive: true })
  }
}
