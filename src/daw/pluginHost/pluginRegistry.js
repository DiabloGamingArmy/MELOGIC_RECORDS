import { melogicWavetableManifest } from '../instruments/melogicWavetable/manifest.js'
import {
  SOURA_PLUGIN_IMPORT_ID,
  chooseAndImportSouraPlugin,
  getInstalledSouraPluginManifestByType,
  listInstalledSouraPluginManifests
} from '../../studio/plugins/souraWasmPluginPackage.js'

export { SOURA_PLUGIN_IMPORT_ID, chooseAndImportSouraPlugin }

export const dawPluginManifests = [melogicWavetableManifest]

export function listDawPlugins(category = '') {
  const cleanCategory = String(category || '').trim()
  const manifests = [...dawPluginManifests, ...listInstalledSouraPluginManifests()]
  return cleanCategory ? manifests.filter((plugin) => plugin.category === cleanCategory) : manifests
}

export function listDawInstruments() {
  return [
    ...listDawPlugins('instrument'),
    { id: SOURA_PLUGIN_IMPORT_ID, name: 'Import Soura Plugin…', category: 'instrument', command: true }
  ]
}

export function getDawPluginManifest(pluginId = '') {
  const clean = String(pluginId || '').trim()
  return dawPluginManifests.find((plugin) => plugin.id === clean) || getInstalledSouraPluginManifestByType(clean) || null
}
