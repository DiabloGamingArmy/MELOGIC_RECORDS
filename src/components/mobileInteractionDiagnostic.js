/*
 * melogic-real-touch-activation-v1
 * Real-touch compatibility for mobile WebKit-style missing activation.
 */
let installed = false

const INTERACTIVE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[role="button"]:not([aria-disabled="true"])'

function isRealTouchMobile() {
  return window.matchMedia('(max-width: 760px)').matches
    && (window.matchMedia('(pointer: coarse)').matches
      || navigator.maxTouchPoints > 0
      || 'ontouchstart' in window)
}

function closestInteractive(target) {
  const element = target instanceof Element ? target : target?.parentElement
  const control = element?.closest(INTERACTIVE_SELECTOR) || null

  // Persistent navigation anchors must use the browser's native activation
  // path. Do not synthesize .click() for them on touchend; doing so creates
  // a second activation pipeline on real iOS/WebKit devices.
  if (control?.matches('[data-native-touch-navigation]')) return null

  return control
}

function isUsable(control) {
  if (!control?.isConnected) return false
  if (control.matches('[disabled],[aria-disabled="true"]')) return false
  const style = getComputedStyle(control)
  return style.display !== 'none'
    && style.visibility !== 'hidden'
    && style.pointerEvents !== 'none'
}

function installRealTouchActivationCompatibility() {
  if (installed || !isRealTouchMobile()) return
  installed = true

  let gesture = null
  let syntheticControl = null
  let syntheticAt = 0

  document.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) {
      gesture = null
      return
    }
    const touch = event.touches[0]
    const control = closestInteractive(event.target)
    gesture = control ? {
      control,
      x: touch.clientX,
      y: touch.clientY,
      startedAt: performance.now(),
      moved: false
    } : null
  }, { capture: true, passive: true })

  document.addEventListener('touchmove', (event) => {
    if (!gesture || event.touches.length !== 1) {
      gesture = null
      return
    }
    const touch = event.touches[0]
    if (Math.hypot(touch.clientX - gesture.x, touch.clientY - gesture.y) > 12) {
      gesture.moved = true
    }
  }, { capture: true, passive: true })

  document.addEventListener('touchcancel', () => {
    gesture = null
  }, { capture: true, passive: true })

  document.addEventListener('touchend', (event) => {
    const current = gesture
    gesture = null

    if (!current || current.moved || event.changedTouches.length !== 1) return
    if (performance.now() - current.startedAt > 900) return

    const touch = event.changedTouches[0]
    if (Math.hypot(touch.clientX - current.x, touch.clientY - current.y) > 12) return

    const releaseControl = closestInteractive(
      document.elementFromPoint(touch.clientX, touch.clientY)
    )
    if (releaseControl !== current.control && !current.control.contains(releaseControl)) return
    if (!isUsable(current.control)) return

    // Activate inside the trusted touchend task. Do not cancel the touch event.
    syntheticControl = current.control
    syntheticAt = performance.now()
    current.control.click()
  }, { capture: true, passive: true })

  // If WebKit later emits its delayed native compatibility click, suppress only
  // that duplicate. Synthetic .click() has isTrusted === false.
  document.addEventListener('click', (event) => {
    if (!event.isTrusted || !syntheticControl) return
    const control = closestInteractive(event.target)
    const elapsed = performance.now() - syntheticAt

    if (elapsed <= 900 && control === syntheticControl) {
      event.preventDefault()
      event.stopImmediatePropagation()
      syntheticControl = null
      syntheticAt = 0
      return
    }
    if (elapsed > 900) {
      syntheticControl = null
      syntheticAt = 0
    }
  }, { capture: true })

  window.addEventListener('pageshow', () => {
    gesture = null
    syntheticControl = null
    syntheticAt = 0
  })
}

// Preserve the existing assetChrome API.
export function installMobileInteractionDiagnostic() {
  installRealTouchActivationCompatibility()
}

// Install on import as well; installation is idempotent.
installRealTouchActivationCompatibility()
