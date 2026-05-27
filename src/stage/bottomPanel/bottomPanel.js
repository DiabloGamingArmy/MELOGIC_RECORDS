import { currentStageDimensions, editorMockObjects, selectedEditorObject, state, viewportModeLabel } from '../app/stageState'

function renderInputListTable() {
  return '<table><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Notes</th></tr></thead><tbody><tr><td>✓</td><td>1</td><td>Kick In</td><td>Beta 91A</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>2</td><td>Kick Out</td><td>Beta 52</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>3</td><td>Snare Top</td><td>SM57</td><td>Short</td><td>USC</td></tr><tr><td>✓</td><td>8</td><td>Bass DI</td><td>DI</td><td>N/A</td><td>USC</td></tr><tr><td>✓</td><td>12</td><td>Lead Voc</td><td>Wireless</td><td>N/A</td><td>DSC</td></tr><tr><td>✓</td><td>21</td><td>Playback L</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr><tr><td>✓</td><td>22</td><td>Playback R</td><td>Interface</td><td>N/A</td><td>Playback Rig</td></tr></tbody></table>'
}

function renderBottomPrimaryPane() {
  if (state.activeEditorMode === 'stage-plot') return '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>2D Stage Plot</h4><div class="stage-mode-large"></div></section></section>'
  if (state.activeEditorMode === 'input-list') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Auto-Generated Input List</h4>${renderInputListTable()}</section></section>`
  if (state.activeEditorMode === 'lighting-plot') return '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Lighting Plot Schematic</h4><div class="stage-mode-large lighting"></div></section></section>'
  if (state.activeEditorMode === 'rigging-plan') return '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Rigging Plan</h4><ul><li>Ground support verified</li><li>Point load check pending</li><li>Qualified personnel assigned</li></ul></section></section>'
  return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel"><h4>Auto-Generated Input List</h4>${renderInputListTable()}</section></section>`
}

function renderDataPane() {
  const tabs = [['schema', 'Schema'], ['signal', 'Signal Flow'], ['patch', 'Patch Graph'], ['object', 'Object Graph'], ['export', 'Export Data']]
  const dims = currentStageDimensions()
  const unit = dims.unit || state.editorProject?.units || 'ft'
  const objectCount = Math.max(editorMockObjects.length, state.editorProject?.objects?.length || 0)
  const fixtureCount = state.editorProject?.fixtures?.length || 3
  const audioCount = state.editorProject?.audioInputs?.length || 22
  const riggingCount = state.editorProject?.rigging?.length || 2
  const body = state.activeDataTab === 'schema'
    ? `<ul class="stage-data-list"><li>Stage dimensions: ${dims.width || 32}x${dims.depth || 24}x${dims.deckHeight || 4} ${unit}</li><li>Object count: ${objectCount}</li><li>Fixture count: ${fixtureCount}</li><li>Audio inputs: ${audioCount}</li><li>Rigging points: ${riggingCount}</li><li>Current view mode: ${viewportModeLabel()}</li><li>Grid: ${state.gridEnabled ? 'On' : 'Off'} • Snap: ${state.snapEnabled ? 'On' : 'Off'}</li></ul>`
    : state.activeDataTab === 'signal'
      ? '<div class="stage-data-cards"><p>Source → Mic/DI → Channel → Console</p><p>Kick In → Beta 91A → Ch1 → FOH</p><p>Lead Voc → Wireless → Ch12 → FOH</p></div>'
      : state.activeDataTab === 'patch'
        ? '<div class="stage-data-cards"><p>DMX U1: 001-096 (placeholder)</p><p>Audio patch: Channels 1-22 (placeholder)</p></div>'
        : state.activeDataTab === 'object'
          ? `<div class="stage-data-cards"><p>Selected: ${selectedEditorObject().label}</p><p>Linked input: placeholder</p><p>Linked fixture: placeholder</p></div>`
          : '<ul class="stage-data-list"><li>✓ Stage dimensions set</li><li>✓ Labels enabled</li><li>✓ Input list generated</li><li>• Rigging notes present</li><li>• Project info complete</li></ul>'
  return `<section class="stage-bottom-secondary"><div class="stage-data-tabs">${tabs.map(([k, l]) => `<button type="button" data-data-tab="${k}" class="${state.activeDataTab === k ? 'is-active' : ''}">${l}</button>`).join('')}</div><div class="stage-data-body">${body}</div></section>`
}

export function renderBottomSplit() {
  return `<div class="stage-bottom-split">${renderBottomPrimaryPane()}<div class="stage-bottom-divider" data-resize="bottom-split" aria-hidden="true"></div>${renderDataPane()}</div>`
}
