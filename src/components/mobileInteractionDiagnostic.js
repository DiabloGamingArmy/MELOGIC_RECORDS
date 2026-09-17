/*
 * melogic-native-interactive-touch-v2
 *
 * Native HTML controls already receive device-independent click activation
 * from browsers (touch, pointer, keyboard). The former compatibility layer
 * synthesized HTMLElement.click() from touchend for anchors/buttons/inputs,
 * creating a second, untrusted activation pipeline and then suppressing the
 * browser's real click. That broke native navigation when any downstream
 * listener called preventDefault().
 *
 * Keep this module/API because assetChrome imports it, but do not synthesize
 * activation for native interactive controls. Custom gesture surfaces should
 * own their own explicit pointer/touch behavior locally.
 */

let installed = false

function installNativeInteractiveTouchPolicy() {
  if (installed) return
  installed = true

  // Diagnostic/contract flag only. No global touchstart/touchend/click
  // interception is installed here.
  document.documentElement.dataset.melogicNativeInteractiveTouch = 'true'
}

// Preserve the existing assetChrome API.
export function installMobileInteractionDiagnostic() {
  installNativeInteractiveTouchPolicy()
}

// Install on import as well; installation is idempotent.
installNativeInteractiveTouchPolicy()
