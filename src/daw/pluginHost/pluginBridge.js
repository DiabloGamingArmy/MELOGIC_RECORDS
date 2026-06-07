export const DAW_PLUGIN_BRIDGE_CHANNEL = 'melogic-daw-plugin-host'

export function isTrustedPluginBridgeMessage(event) {
  if (event?.origin && event.origin !== window.location.origin) return false
  const source = event?.data?.source
  return source === 'melogic-daw' || source === 'melogic-plugin-host'
}
