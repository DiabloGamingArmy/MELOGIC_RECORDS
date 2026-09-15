// Validate structural integrity before mutating a live editor or overwriting a
// stored document. Optional legacy fields remain optional; unknown fields survive.
export function validateEditorState(state, maxVersion = 5) {
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  const fail = path => { throw new Error(`Project data is invalid at ${path}. The saved project has not been changed.`) }
  if (!object(state)) fail('editorState')
  if (state.version != null && (!Number.isInteger(state.version) || state.version < 1 || state.version > maxVersion)) fail('version (unsupported project version)')
  for (const key of ['timeline', 'globalTracks', 'settings', 'projectMetadata', 'notes', 'toggles', 'metronome']) {
    if (state[key] != null && !object(state[key])) fail(key)
  }
  for (const key of ['tracks', 'regions']) {
    if (state[key] == null) continue
    if (!Array.isArray(state[key])) fail(key)
    const ids = new Set()
    state[key].forEach((item, index) => {
      const path = `${key}[${index}]`
      if (!object(item) || typeof item.id !== 'string' || !item.id || ids.has(item.id)) fail(path + '.id')
      ids.add(item.id)
      if (key === 'regions') {
        if (typeof item.trackId !== 'string' || !item.trackId) fail(path + '.trackId')
        if (item.notes != null && (!Array.isArray(item.notes) || item.notes.some(note => !object(note)))) fail(path + '.notes')
        for (const field of ['audioClip', 'audioEdit', 'stretch', 'waveform']) if (item[field] != null && !object(item[field])) fail(path + '.' + field)
      } else {
        for (const field of ['midiEffects', 'audioEffects']) if (item[field] != null && (!Array.isArray(item[field]) || item[field].some(effect => !object(effect)))) fail(path + '.' + field)
        for (const field of ['instrument', 'automation', 'channelSettings']) if (item[field] != null && !object(item[field])) fail(path + '.' + field)
      }
    })
  }
  if (Array.isArray(state.tracks) && Array.isArray(state.regions)) {
    const ids = new Set(state.tracks.map(track => track.id))
    if (state.regions.some(region => !ids.has(region.trackId))) fail('regions.trackId (missing track)')
  }
  if (state.notes?.pages != null && (!Array.isArray(state.notes.pages) || state.notes.pages.some(page => !object(page)))) fail('notes.pages')
  for (const key of ['tempoEvents', 'timeSignatureEvents', 'keySignatureEvents', 'signatureEvents', 'markers', 'arrangement', 'videoRefs']) {
    const value = state.globalTracks?.[key]
    if (value != null && (!Array.isArray(value) || value.some(item => !object(item)))) fail('globalTracks.' + key)
  }
  return state
}
