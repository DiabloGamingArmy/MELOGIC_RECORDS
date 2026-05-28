import {
  linkedAudioInput,
  linkedFixture,
  linkedRigging,
  linkedVideo,
  selectedStageEntity,
  selectedStageObjects,
  stageLayers,
  state
} from '../app/stageState'

const numberValue = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const formatNumber = (value, fallback = 0) => {
  const number = numberValue(value, fallback)
  return Number.isFinite(number) ? Number(number.toFixed(2)).toString() : String(fallback)
}

function selectedObjectRecord() {
  const selected = selectedStageEntity()
  if (selected.kind === 'object') return selected.entity
  if (selected.kind === 'none') {
    return {
      id: '',
      label: 'No object selected',
      name: 'No object selected',
      type: 'none',
      category: 'stage',
      layer: 'stage',
      position: { x: 0, y: 0, z: 0 },
      rotation: { y: 0 },
      dimensions: { width: 0, depth: 0, height: 0 },
      visible: true,
      locked: false,
      notes: '',
      metadata: {}
    }
  }
  return {
    id: selected.entity?.id || state.selectedEditorObject,
    label: selected.entity?.name || selected.entity?.source || 'Stage Object',
    name: selected.entity?.name || selected.entity?.source || 'Stage Object',
    type: selected.kind,
    category: selected.entity?.category || selected.kind,
    layer: selected.entity?.layer || selected.entity?.category || 'stage',
    position: selected.entity?.position || { x: 0, y: 0, z: 0 },
    rotation: selected.entity?.rotation || { y: 0 },
    dimensions: selected.entity?.dimensions || { width: selected.entity?.width || 0, depth: selected.entity?.depth || 0, height: selected.entity?.height || 0 },
    visible: selected.entity?.visible !== false,
    locked: !!selected.entity?.locked,
    notes: selected.entity?.notes || '',
    metadata: selected.entity?.metadata || {}
  }
}

export function selectedEditorObjectMarkup() {
  const selectedObjects = selectedStageObjects()
  if (selectedObjects.length > 1) {
    const categories = [...new Set(selectedObjects.map((object) => object.category || 'stage'))]
    const layers = [...new Set(selectedObjects.map((object) => object.layer || object.category || 'stage'))]
    const lockedCount = selectedObjects.filter((object) => object.locked).length
    const hiddenCount = selectedObjects.filter((object) => object.visible === false).length
    return `<div class="stage-readout-grid"><div><span>SELECTION</span><strong>${selectedObjects.length} objects</strong></div><div><span>CATEGORY</span><strong>${categories.length === 1 ? categories[0] : 'mixed'}</strong></div><div><span>LAYER</span><strong>${layers.length === 1 ? layers[0] : 'mixed'}</strong></div><div><span>STATUS</span><strong>${lockedCount} locked · ${hiddenCount} hidden</strong></div></div><div class="stage-object-command-row"><button type="button" data-focus-selected>Focus</button><button type="button" data-multi-transform-field="locked" data-value="true">Lock</button><button type="button" data-multi-transform-field="locked" data-value="false">Unlock</button><button type="button" data-multi-transform-field="visible" data-value="true">Show</button><button type="button" data-multi-transform-field="visible" data-value="false">Hide</button><button type="button" data-delete-selected>Delete</button></div><p class="stage-help-text">Multiple objects selected. Use Move mode to drag the primary selection, or apply shared lock/visibility actions here. Group tools are planned.</p>`
  }
  const selected = selectedObjectRecord()
  if (!selected.id) return '<p class="stage-empty-state">No object selected. Use Select to click or drag a box around objects.</p>'
  const t = state.editorObjectTransforms[selected.id] || {}
  const position = selected.position || {}
  const dimensions = selected.dimensions || {}
  const rotation = selected.rotation || {}
  const width = t.width ?? numberValue(dimensions.width)
  const depth = t.depth ?? numberValue(dimensions.depth)
  const height = t.height ?? numberValue(dimensions.height)
  const x = t.x ?? numberValue(position.x)
  const y = t.y ?? numberValue(position.y)
  const z = t.z ?? numberValue(position.z)
  const rotY = t.rotY ?? numberValue(rotation.y)
  const display = {
    width: formatNumber(width),
    depth: formatNumber(depth),
    height: formatNumber(height),
    x: formatNumber(x),
    y: formatNumber(y),
    z: formatNumber(z),
    rotY: formatNumber(rotY)
  }
  const rows = [
    ['Selected', selected.label || selected.name],
    ['Type', selected.type || 'Object'],
    ['Category', selected.category || 'stage'],
    ['Layer', selected.layer || selected.category || 'stage'],
    ['Position', `X ${display.x} / Y ${display.y} / Z ${display.z}`],
    ['Dimensions', `${display.width || 'n/a'} x ${display.depth || 'n/a'} x ${display.height || 'n/a'}`]
  ]
  return `<div class="stage-readout-grid">${rows.map(([k, v]) => `<div><span>${String(k).toUpperCase()}</span><strong>${v}</strong></div>`).join('')}</div><div class="stage-object-command-row"><button type="button" data-focus-selected>Focus</button><button type="button" data-rotate-selected="-15">Rotate -15</button><button type="button" data-rotate-selected="15">Rotate +15</button><button type="button" data-reset-rotation>Reset Rot</button><button type="button" data-duplicate-selected>Duplicate</button><button type="button" data-delete-selected>Delete</button></div><div class="stage-transform-grid"><label>X<input data-transform-field="x" type="number" step="0.1" value="${display.x}"></label><label>Y<input data-transform-field="y" type="number" step="0.1" value="${display.y}"></label><label>Z<input data-transform-field="z" type="number" step="0.1" value="${display.z}"></label><label>Width<input data-transform-field="width" type="number" min="0.05" step="0.1" value="${display.width || 0}"></label><label>Depth<input data-transform-field="depth" type="number" min="0.05" step="0.1" value="${display.depth || 0}"></label><label>Height<input data-transform-field="height" type="number" min="0.05" step="0.1" value="${display.height || 0}"></label><label>Rotation<input data-transform-field="rotY" type="number" step="1" value="${display.rotY}"></label><label>Label<input data-transform-field="label" type="text" value="${t.label || selected.label || selected.name || ''}"></label><label>Layer<select data-transform-field="layer">${stageLayers.map((layer) => `<option value="${layer}" ${(selected.layer || selected.category) === layer ? 'selected' : ''}>${layer}</option>`).join('')}</select></label><label>Color<input data-transform-field="color" type="color" value="${selected.color || selected.metadata?.color || '#22b8b5'}"></label><label class="stage-editor-check"><input data-transform-field="locked" type="checkbox" ${selected.locked ? 'checked' : ''}> Locked</label><label class="stage-editor-check"><input data-transform-field="visible" type="checkbox" ${selected.visible === false ? '' : 'checked'}> Visible</label><label class="stage-transform-notes">Notes<textarea data-transform-field="notes">${t.notes || selected.notes || ''}</textarea></label></div>`
}

function renderDataTab() {
  const selected = selectedObjectRecord()
  const input = linkedAudioInput(selected.id)
  const fixture = linkedFixture(selected.id)
  const rig = linkedRigging(selected.id)
  const video = linkedVideo(selected.id)
  if (input) {
    return `<section class="stage-config-panel"><h3>Audio Data</h3><div class="stage-readout-grid"><div><span>SOURCE</span><strong>${input.source || selected.label}</strong></div><div><span>CHANNEL</span><strong>${input.channel || 'n/a'}</strong></div><div><span>MIC/DI</span><strong>${input.micDi || 'n/a'}</strong></div><div><span>STAND</span><strong>${input.stand || 'n/a'}</strong></div><div><span>PATCH</span><strong>${input.patch || 'unpatched'}</strong></div><div><span>MONITOR</span><strong>${input.monitorSend || 'n/a'}</strong></div></div></section>`
  }
  if (fixture) {
    return `<section class="stage-config-panel"><h3>Lighting Data</h3><div class="stage-readout-grid"><div><span>FIXTURE</span><strong>${fixture.type || fixture.name}</strong></div><div><span>UNIVERSE</span><strong>${fixture.universe || 1}</strong></div><div><span>ADDRESS</span><strong>${fixture.address || 'n/a'}</strong></div><div><span>MODE</span><strong>${fixture.mode || 'n/a'}</strong></div><div><span>BEAM</span><strong>${fixture.beamAngle || 'n/a'} deg</strong></div><div><span>TARGET</span><strong>${fixture.target || 'n/a'}</strong></div></div></section>`
  }
  if (rig) {
    return `<section class="stage-config-panel"><h3>Rigging Data</h3><div class="stage-readout-grid"><div><span>TYPE</span><strong>${rig.type || 'Rigging'}</strong></div><div><span>SPAN</span><strong>${rig.span || 'n/a'}</strong></div><div><span>HEIGHT</span><strong>${rig.height || 'n/a'}</strong></div><div><span>QUALIFIED</span><strong>${rig.qualifiedOnly ? 'Required' : 'Review'}</strong></div></div><p class="stage-safety-note">Load calculation required by qualified rigger.</p></section>`
  }
  if (video) {
    return `<section class="stage-config-panel"><h3>Video Data</h3><div class="stage-readout-grid"><div><span>TYPE</span><strong>${video.type || 'Video'}</strong></div><div><span>SIZE</span><strong>${video.width || 'n/a'} x ${video.height || 'n/a'}</strong></div><div><span>ASPECT</span><strong>${video.aspectRatio || 'n/a'}</strong></div><div><span>RESOLUTION</span><strong>${video.resolution || 'n/a'}</strong></div><div><span>INPUT</span><strong>${video.inputSource || 'n/a'}</strong></div></div></section>`
  }
  return `<section class="stage-config-panel"><h3>Object Data</h3><p>This object is currently geometric only. Add audio, lighting, rigging, video, or power metadata to make it appear in production paperwork.</p><div class="stage-readout-grid"><div><span>ID</span><strong>${selected.id}</strong></div><div><span>LAYER</span><strong>${selected.layer || selected.category || 'stage'}</strong></div></div></section>`
}

function renderNotesTab() {
  const selected = selectedObjectRecord()
  const rig = linkedRigging(selected.id)
  return `<section class="stage-config-panel"><h3>Notes</h3><label class="stage-full-field">Object notes<textarea data-transform-field="notes" placeholder="Notes for crew, venue, or export">${selected.notes || rig?.notes || ''}</textarea></label>${selected.category === 'rigging' || rig ? '<p class="stage-safety-note">Qualified personnel required for rigging/hangs. Do not treat this editor as structural engineering software.</p>' : '<p class="stage-help-text">Notes can be printed into the production packet and linked to this selected entity.</p>'}</section>`
}

function renderAiTab() {
  return '<section class="stage-ai-panel"><h3>AI Assistant</h3><p>Future assistant changes will be previewed before applying to the StagePlan.</p><textarea aria-label="AI prompt" placeholder="Build a 24x16 stage for a 5-piece band with stereo playback, 4 vocal mics, front wash, and rear beams."></textarea><div class="stage-action-grid"><button type="button" aria-disabled="true">Preview Plan</button><button type="button" aria-disabled="true">Apply</button></div></section>'
}

export function renderInspectorTabs() {
  const tabs = [['properties', 'Properties'], ['data', 'Data'], ['notes', 'Notes'], ['ai', 'AI']]
  const active = ['properties', 'data', 'notes', 'ai'].includes(state.activeInspectorTab) ? state.activeInspectorTab : 'properties'
  const body = active === 'properties'
    ? `<section class="stage-config-panel"><h3>Properties</h3><div class="stage-readout" data-stage-selected-readout>${selectedEditorObjectMarkup()}</div></section>`
    : active === 'data'
      ? renderDataTab()
      : active === 'notes'
        ? renderNotesTab()
        : renderAiTab()
  return `<aside class="stage-editor-right"><div class="stage-inspector-tabs">${tabs.map(([k, l]) => `<button type="button" data-inspector-tab="${k}" class="${active === k ? 'is-active' : ''}">${l}</button>`).join('')}</div><div class="stage-inspector-body">${body}</div></aside>`
}
