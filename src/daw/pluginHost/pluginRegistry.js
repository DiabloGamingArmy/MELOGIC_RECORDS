import { melogicWavetableManifest } from '../instruments/melogicWavetable/manifest.js'

export const dawPluginManifests = [
  melogicWavetableManifest
]

export function listDawPlugins(category = '') {
  const cleanCategory = String(category || '').trim()
  return cleanCategory
    ? dawPluginManifests.filter((plugin) => plugin.category === cleanCategory)
    : [...dawPluginManifests]
}

export function listDawInstruments() {
  return listDawPlugins('instrument')
}

export function getDawPluginManifest(pluginId = '') {
  const clean = String(pluginId || '').trim()
  return dawPluginManifests.find((plugin) => plugin.id === clean) || null
}
