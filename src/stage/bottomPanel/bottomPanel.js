import { currentStageDimensions, editorMockObjects, selectedEditorObject, stageEntities, state, viewportModeLabel } from '../app/stageState'

function renderInputListTable() {
  const rows = Array.isArray(state.editorProject?.audioInputs) && state.editorProject.audioInputs.length
    ? state.editorProject.audioInputs
    : [
        { channel: 1, source: 'Kick In', micDi: 'Beta 91A', stand: 'Short', notes: 'USC' },
        { channel: 2, source: 'Kick Out', micDi: 'Beta 52', stand: 'Short', notes: 'USC' },
        { channel: 3, source: 'Snare Top', micDi: 'SM57', stand: 'Short', notes: 'USC' },
        { channel: 8, source: 'Bass DI', micDi: 'DI', stand: 'N/A', notes: 'USC' },
        { channel: 12, source: 'Lead Voc', micDi: 'Wireless', stand: 'N/A', notes: 'DSC' },
        { channel: 21, source: 'Playback L', micDi: 'Interface', stand: 'N/A', notes: 'Playback Rig' },
        { channel: 22, source: 'Playback R', micDi: 'Interface', stand: 'N/A', notes: 'Playback Rig' }
      ]
  return `<table class="stage-input-table"><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Patch</th><th>Location</th><th>Notes</th></tr></thead><tbody>${rows.map((row) => `<tr><td>✓</td><td>${row.channel || ''}</td><td>${row.source || ''}</td><td>${row.micDi || row.mic || ''}</td><td>${row.stand || 'N/A'}</td><td>${row.patch || ''}</td><td>${row.stageLocation || row.location || ''}</td><td>${row.notes || ''}</td></tr>`).join('')}</tbody></table>`
}

function renderEntityTable() {
  const rows = stageEntities()
  return `<table class="stage-entity-table"><thead><tr><th>Entity</th><th>Kind</th><th>Category</th><th>Location</th><th>Size / Patch</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr data-select-object="${row.id || ''}"><td><strong>${row.name || 'Untitled'}</strong><small>${row.id || ''}</small></td><td>${row.kind || 'Object'}</td><td>${row.category || 'stage'}</td><td>${row.location || 'not placed'}</td><td>${row.size || 'n/a'}</td><td><span class="stage-entity-status">${row.status || 'active'}</span></td></tr>`).join('')}</tbody></table>`
}

function renderBottomPrimaryPane() {
  const activeMode = state.activeEditorMode === 'builder' ? 'entities' : state.activeEditorMode
  if (activeMode === 'stage-plot') return '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Stage Plot Preview</h4><div class="stage-mode-large"></div><p>Top-view vector plot foundation. Scale, labels, and dimension lines will be driven by StagePlan data.</p></section></section>'
  if (activeMode === 'input-list') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Input List</h4>${renderInputListTable()}</section></section>`
  if (activeMode === 'lighting-patch' || activeMode === 'lighting-plot') return '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Lighting Patch</h4><div class="stage-mode-large lighting"></div><ul><li>Universe 1 / address planning</li><li>Fixture targets and beam angles</li><li>Position assignment by truss or floor package</li></ul></section></section>'
  if (activeMode === 'rigging' || activeMode === 'rigging-plan') return '<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Rigging</h4><ul><li>Ground support placeholders only</li><li>Attachment notes and qualified-personnel warning</li><li>No structural calculations are generated here</li></ul></section></section>'
  return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-entities"><h4>Entities</h4>${renderEntityTable()}</section></section>`
}

function renderDataPane() {
  const tabs = [['schema', 'Schema'], ['signal', 'Signal Flow'], ['patch', 'Patch Graph'], ['object', 'Object Graph'], ['export', 'Export Data']]
  const dims = currentStageDimensions()
  const unit = dims.unit || state.editorProject?.units || 'ft'
  const objectCount = Math.max(editorMockObjects.length, state.editorProject?.objects?.length || 0)
  const fixtureCount = state.editorProject?.fixtures?.length || 0
  const audioCount = state.editorProject?.audioInputs?.length || 0
  const riggingCount = state.editorProject?.rigging?.length || 0
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
