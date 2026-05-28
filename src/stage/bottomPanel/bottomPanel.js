import { currentStageDimensions, editorMockObjects, exportReadiness, selectedEditorObject, stageEntities, stageWarnings, state, viewportModeLabel } from '../app/stageState'
import { renderStagePlotSvg } from '../export/exportPreview'

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
  return `<table class="stage-input-table"><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Patch</th><th>Location</th><th>Notes</th></tr></thead><tbody>${rows.map((row) => `<tr data-select-object="${row.linkedObjectId || row.id || ''}"><td>✓</td><td><input data-audio-input-field="channel" data-row-id="${row.id || ''}" type="number" min="1" value="${row.channel || ''}"></td><td><input data-audio-input-field="source" data-row-id="${row.id || ''}" value="${row.source || ''}"></td><td><input data-audio-input-field="micDi" data-row-id="${row.id || ''}" value="${row.micDi || row.mic || ''}"></td><td><input data-audio-input-field="stand" data-row-id="${row.id || ''}" value="${row.stand || 'N/A'}"></td><td><input data-audio-input-field="patch" data-row-id="${row.id || ''}" value="${row.patch || ''}"></td><td><input data-audio-input-field="stageLocation" data-row-id="${row.id || ''}" value="${row.stageLocation || row.location || ''}"></td><td><input data-audio-input-field="notes" data-row-id="${row.id || ''}" value="${row.notes || ''}"></td></tr>`).join('')}</tbody></table>`
}

function renderEntityTable() {
  const rows = stageEntities()
  return `<table class="stage-entity-table"><thead><tr><th>Entity</th><th>Kind</th><th>Category</th><th>Location</th><th>Size / Patch</th><th>Status</th></tr></thead><tbody>${rows.map((row) => `<tr data-select-object="${row.id || ''}" class="${row.id === state.selectedEditorObject ? 'is-selected' : ''}"><td><strong>${row.name || 'Untitled'}</strong><small>${row.id || ''}</small></td><td>${row.kind || 'Object'}</td><td>${row.category || 'stage'}</td><td>${row.location || 'not placed'}</td><td>${row.size || 'n/a'}</td><td><span class="stage-entity-status">${row.status || 'active'}</span></td></tr>`).join('')}</tbody></table>`
}

function renderLightingTable() {
  const rows = state.editorProject?.fixtures || []
  return `<table class="stage-input-table"><thead><tr><th>Fixture</th><th>Type</th><th>U</th><th>Address</th><th>Mode</th><th>Position</th><th>Target</th><th>Notes</th></tr></thead><tbody>${rows.map((fixture) => `<tr data-select-object="${fixture.linkedObjectId || fixture.id}"><td><input data-fixture-field="name" data-row-id="${fixture.id}" value="${fixture.name || fixture.label || fixture.id}"></td><td><input data-fixture-field="type" data-row-id="${fixture.id}" value="${fixture.type || fixture.fixtureType || ''}"></td><td><input data-fixture-field="universe" data-row-id="${fixture.id}" type="number" min="1" value="${fixture.universe || 1}"></td><td><input data-fixture-field="address" data-row-id="${fixture.id}" type="number" min="1" max="512" value="${fixture.address || ''}"></td><td><input data-fixture-field="mode" data-row-id="${fixture.id}" value="${fixture.mode || ''}"></td><td><input data-fixture-field="trussAssignment" data-row-id="${fixture.id}" value="${fixture.trussAssignment || fixture.positionName || ''}"></td><td><input data-fixture-field="target" data-row-id="${fixture.id}" value="${typeof fixture.target === 'string' ? fixture.target : 'Target point'}"></td><td><input data-fixture-field="notes" data-row-id="${fixture.id}" value="${fixture.notes || ''}"></td></tr>`).join('') || '<tr><td colspan="8">No fixtures yet. Add lighting objects from the Object Library or Lighting panel.</td></tr>'}</tbody></table>`
}

function renderRiggingTable() {
  const rows = state.editorProject?.rigging || []
  return `<table class="stage-input-table"><thead><tr><th>Rigging</th><th>Type</th><th>Height</th><th>Span</th><th>Qualified</th><th>Notes</th></tr></thead><tbody>${rows.map((rig) => `<tr data-select-object="${rig.linkedObjectId || rig.id}"><td>${rig.name || rig.id}</td><td>${rig.type || ''}</td><td>${rig.height || ''}</td><td>${rig.span || ''}</td><td>${rig.qualifiedOnly ? 'Required' : 'Review'}</td><td>${rig.notes || 'Load calculation required by qualified rigger.'}</td></tr>`).join('') || '<tr><td colspan="6">No rigging items yet.</td></tr>'}</tbody></table>`
}

function renderWarningsList() {
  const warnings = stageWarnings()
  return `<div class="stage-warning-list">${warnings.map((warning) => `<button type="button" data-select-object="${warning.ownerId || ''}" class="stage-warning-row is-${warning.level}"><strong>${warning.level.toUpperCase()}</strong><span>${warning.title}</span></button>`).join('') || '<p class="stage-safety-note">No blocking production warnings.</p>'}</div>`
}

function renderExportChecklist() {
  return `<ul class="stage-data-list is-checklist">${exportReadiness().map((item) => `<li class="${item.ok ? 'is-ok' : 'is-warn'}">${item.ok ? '✓' : '⚠'} ${item.label}</li>`).join('')}</ul>`
}

function renderBottomPrimaryPane() {
  const activeMode = state.activeEditorMode === 'builder' ? 'entities' : state.activeEditorMode
  if (activeMode === 'stage-plot') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Stage Plot Preview</h4><div class="stage-plot-preview">${renderStagePlotSvg()}</div><p>Top-view vector plot generated from StagePlan data.</p></section></section>`
  if (activeMode === 'input-list') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Input List</h4>${renderInputListTable()}</section></section>`
  if (activeMode === 'lighting-patch' || activeMode === 'lighting-plot') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Lighting Patch</h4>${renderLightingTable()}</section></section>`
  if (activeMode === 'rigging' || activeMode === 'rigging-plan') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-large"><h4>Rigging</h4>${renderRiggingTable()}</section></section>`
  if (activeMode === 'warnings') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Warnings</h4>${renderWarningsList()}</section></section>`
  if (activeMode === 'export') return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-mode-panel"><h4>Export Readiness</h4>${renderExportChecklist()}<div class="stage-action-grid"><button type="button" data-open-export>Preview Packet</button><button type="button" aria-disabled="true">Packet Builder</button></div></section></section>`
  return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-entities"><h4>Objects</h4>${renderEntityTable()}</section></section>`
}

function renderDataPane() {
  const tabs = [['schema', 'Schema'], ['signal', 'Signal Flow'], ['patch', 'Patch Graph'], ['object', 'Object Graph'], ['export', 'Export Readiness']]
  const dims = currentStageDimensions()
  const unit = dims.unit || state.editorProject?.units || 'ft'
  const objectCount = Math.max(editorMockObjects.length, state.editorProject?.objects?.length || 0)
  const fixtureCount = state.editorProject?.fixtures?.length || 0
  const audioCount = state.editorProject?.audioInputs?.length || 0
  const riggingCount = state.editorProject?.rigging?.length || 0
  const warningCount = stageWarnings().length
  const body = state.activeDataTab === 'schema'
    ? `<ul class="stage-data-list"><li>Stage dimensions: ${dims.width || 32}x${dims.depth || 24}x${dims.deckHeight || 4} ${unit}</li><li>Object count: ${objectCount}</li><li>Fixture count: ${fixtureCount}</li><li>Audio inputs: ${audioCount}</li><li>Rigging points: ${riggingCount}</li><li>Warnings: ${warningCount}</li><li>Current view mode: ${viewportModeLabel()}</li><li>Render mode: ${state.renderMode}</li><li>Grid: ${state.gridEnabled ? 'On' : 'Off'} • Snap: ${state.snapEnabled ? 'On' : 'Off'}</li></ul>`
    : state.activeDataTab === 'signal'
      ? `<div class="stage-data-cards"><p>Source → Mic/DI → Channel → Console</p>${(state.editorProject?.audioInputs || []).slice(0, 6).map((input) => `<p>${input.source || 'Source'} → ${input.micDi || 'Mic/DI'} → Ch${input.channel || '?'} → FOH</p>`).join('')}</div>`
      : state.activeDataTab === 'patch'
        ? `<div class="stage-data-cards">${(state.editorProject?.fixtures || []).slice(0, 6).map((fixture) => `<p>${fixture.name || fixture.type} → U${fixture.universe || 1}:${fixture.address || '?'} → ${fixture.mode || 'mode TBD'}</p>`).join('') || '<p>No DMX fixtures patched yet.</p>'}</div>`
        : state.activeDataTab === 'object'
          ? `<div class="stage-data-cards"><p>Selected: ${selectedEditorObject().label}</p><p>Exports to: ${selectedEditorObject().type}</p><p>Relationships shown here are generated from StagePlan links.</p></div>`
          : renderExportChecklist()
  return `<section class="stage-bottom-secondary"><div class="stage-data-tabs">${tabs.map(([k, l]) => `<button type="button" data-data-tab="${k}" class="${state.activeDataTab === k ? 'is-active' : ''}">${l}</button>`).join('')}</div><div class="stage-data-body">${body}</div></section>`
}

export function renderBottomSplit() {
  return `<div class="stage-bottom-split">${renderBottomPrimaryPane()}<div class="stage-bottom-divider" data-resize="bottom-split" aria-hidden="true"></div>${renderDataPane()}</div>`
}
