import { editorLibraryCategories, selectedEditorObject, state } from '../app/stageState'

export function selectedEditorObjectMarkup() {
  const selected = selectedEditorObject()
  const t = state.editorObjectTransforms[selected.key] || {}
  const numberFromDetail = (key, fallback = 0) => {
    const value = selected.details?.[key]
    const parsed = Number.parseFloat(String(value || ''))
    return Number.isFinite(parsed) ? parsed : fallback
  }
  const width = t.width ?? numberFromDetail('width', numberFromDetail('span', 0))
  const depth = t.depth ?? numberFromDetail('depth', 0)
  const height = t.height ?? numberFromDetail('height', 0)
  const x = t.x ?? 0
  const y = t.y ?? 0
  const z = t.z ?? 0
  const rotY = t.rotY ?? 0
  const rows = [['Selected', selected.label], ['Type', selected.type], ['Dimensions', `${width || 'n/a'} x ${depth || 'n/a'} x ${height || 'n/a'}`], ['Position', `X ${x} / Y ${y} / Z ${z}`], ...Object.entries(selected.details || {})]
  const fixtureRows = selected.key === 'moving-head' ? [['DMX Address', '001 / U1'], ['Mode', '24ch'], ['Color', 'Cyan'], ['Beam Angle', '15-45°']] : []
  const cameraRows = selected.key === 'camera-1' ? [['Target', 'Downstage Center']] : []
  return `<div class="stage-readout-grid">${[...rows, ...fixtureRows, ...cameraRows].map(([k, v]) => `<div><span>${String(k).toUpperCase()}</span><strong>${v}</strong></div>`).join('')}</div><div class="stage-transform-grid"><label>X<input data-transform-field="x" type="number" step="0.1" value="${x}"></label><label>Y<input data-transform-field="y" type="number" step="0.1" value="${y}"></label><label>Z<input data-transform-field="z" type="number" step="0.1" value="${z}"></label><label>Width<input data-transform-field="width" type="number" step="0.1" value="${width || 0}"></label><label>Depth<input data-transform-field="depth" type="number" step="0.1" value="${depth || 0}"></label><label>Height<input data-transform-field="height" type="number" step="0.1" value="${height || 0}"></label><label>Rotation<input data-transform-field="rotY" type="number" step="1" value="${rotY}"></label><label>Label<input data-transform-field="label" type="text" value="${t.label || selected.label}"></label><label><input data-transform-field="locked" type="checkbox" ${t.locked ? 'checked' : ''}> Locked</label><label><input data-transform-field="visible" type="checkbox" ${t.visible === false ? '' : 'checked'}> Visible</label><label class="stage-transform-notes">Notes<textarea data-transform-field="notes">${t.notes || ''}</textarea></label></div>${selected.key === 'moving-head' ? '<input type="range" disabled />' : ''}`
}

export function renderInspectorTabs(title, stamp) {
  const tabs = [['properties', 'Properties'], ['ai', 'AI Assist'], ['rig', 'Rig Notes'], ['project', 'Project Info']]
  const active = state.activeInspectorTab
  const body = active === 'properties'
    ? `<section class="stage-config-panel"><h3>Properties</h3><div class="stage-readout" data-stage-selected-readout>${selectedEditorObjectMarkup()}</div></section>`
    : active === 'ai'
      ? '<section class="stage-ai-panel"><h3>AI Assistant</h3><p>Prompt-based stage assistant placeholder.</p><textarea aria-label="AI prompt" placeholder="Build me a 24x16 stage for a 5-piece metalcore band with tracks and lighting."></textarea><button type="button" aria-disabled="true">Generate</button></section>'
      : active === 'rig'
        ? '<section class="stage-config-panel"><h3>Rigging Notes</h3><p>Qualified personnel required for rigging/hangs.</p><textarea aria-label="Rigging notes" placeholder="Rigging notes"></textarea><ul><li>Add Truss (placeholder)</li><li>Add Rigging Point (placeholder)</li></ul></section>'
        : `<section class="stage-config-panel"><h3>Project Info</h3><p data-stage-project-info-title>${title}</p><p data-stage-project-info-type>${state.editorProject?.stageType || 'Blank Stage'}</p><p>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p><p>Category: ${editorLibraryCategories.find((c) => c.key === state.activeLibraryCategory)?.label || 'Band / Backline'}</p><p>Status: ${state.projectLoadStatus}</p><p>Project ID: ${state.projectId}</p></section>`
  return `<aside class="stage-editor-right"><div class="stage-inspector-tabs">${tabs.map(([k, l]) => `<button type="button" data-inspector-tab="${k}" class="${state.activeInspectorTab === k ? 'is-active' : ''}">${l}</button>`).join('')}</div><div class="stage-inspector-body">${body}</div></aside>`
}
