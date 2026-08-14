export function isNativeAssetRuntime() {
  return Boolean(globalThis.__TAURI_INTERNALS__ || globalThis.__TAURI__ || globalThis.navigator?.userAgent?.includes('Tauri'))
}

export class NativeAssetStorage {
  constructor({ invoke } = {}) { this.invoke = invoke }
  async call(command, payload = {}) {
    const invoke = this.invoke || (await import('@tauri-apps/api/core')).invoke
    return invoke(command, payload)
  }
  listMetadata() { return this.call('native_asset_list') }
  importBytes({ assetId, fileName, bytes }) { return this.call('native_asset_store', { request: { assetId, fileName, bytes: Array.from(bytes) } }) }
  readBytes(assetId) { return this.call('native_asset_read', { assetId }) }
}
