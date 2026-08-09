import {
  linkedAudioInput,
  linkedFixture,
  linkedRigging,
  linkedVideo,
  selectedStageEntity,
  selectedStageObjects,
  animationPathForField,
  evaluatedObjectTransform,
  projectAnimation,
  stageLayers,
  state
} from '../app/stageState'

const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
const escapeAttr = (value = '') => escapeHtml(value)
const numeric = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const formatNumber = (value, fallback = 0) => Number(numeric(value, fallback).toFixed(2)).toString()

function selectedObjectRecord() {
  const selected = selectedStageEntity()
  if (selected.kind === 'object') return selected.entity
  if (selected.kind === 'none') return null
  return {
    id: selected.entity?.id || state.selectedEditorObject,
    label: selected.entity?.name || selected.entity?.source || 'Stage Object',
    name: selected.entity?.name || selected.entity?.source || 'Stage Object',
    type: selected.kind,
    category: selected.entity?.category || selected.kind,
    layer: selected.entity?.layer || selected.entity?.category || 'stage',
    position: selected.entity?.position || { x: 0, y: 0, z: 0 },
    rotation: selected.entity?.rotation || { x: 0, y: 0, z: 0 },
    dimensions: selected.entity?.dimensions || { width: selected.entity?.width || 0, depth: selected.entity?.depth || 0, height: selected.entity?.height || 0 },
    visible: selected.entity?.visible !== false,
    locked: !!selected.entity?.locked,
    notes: selected.entity?.notes || '',
    metadata: selected.entity?.metadata || {}
  }
}

function section(title, body, className = '') {
  return `<section class="vertix-property-section ${className}"><h3>${title}</h3>${body}</section>`
}

function field(label, key, value, { min, step = '0.1', disabled = false } = {}) {
  const path = animationPathForField(key)
  const track = path ? projectAnimation().tracks.find((item) => item.targetObjectId === state.selectedEditorObject && item.propertyPath === path) : null
  const keyed = !!track?.keyframes?.some((item) => item.frame === state.currentFrame)
  return `<label><span>${label}${path ? `<button type="button" class="vertix-keyframe-button ${track ? 'is-animated' : ''} ${keyed ? 'is-keyed' : ''}" data-insert-keyframe="${key}" title="Insert keyframe at frame ${state.currentFrame}">${keyed ? '◆' : '◇'}</button>` : ''}</span><input data-vertix-transform-field="${key}" type="number" ${min === undefined ? '' : `min="${min}"`} step="${step}" value="${escapeAttr(formatNumber(value))}" ${disabled ? 'disabled' : ''}></label>`
}

function readout(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || '—')}</strong></div>`
}

function sourceSection(selected) {
  const resolution = state.assetResolutions?.[selected.id]
  const reference = resolution?.reference || selected.assetReference
  if (!reference) return ''
  const missing = resolution && resolution.status !== 'RESOLVED'
  const resolved = resolution?.status === 'RESOLVED'
  const status = missing ? `Missing · ${resolution.reason || 'unavailable'}` : resolved ? 'Resolved' : 'Referenced'
  const warning = missing
    ? `<div class="vertix-missing-asset"><strong>Missing asset</strong><span>${escapeHtml(resolution.reason || 'The required asset is unavailable.')}</span></div>`
    : ''
  return section('Asset Source', `${warning}<div class="vertix-property-readout">${readout('Package', reference.packageId)}${readout('Version', reference.packageVersion)}${readout('Asset', reference.assetUuid)}${readout('Publisher', reference.publisherId)}${readout('Status', status)}</div>`, missing ? 'is-missing' : '')
}

function stageComponentSection(selected) {
  const input = linkedAudioInput(selected.id)
  const fixture = linkedFixture(selected.id)
  const rig = linkedRigging(selected.id)
  const video = linkedVideo(selected.id)
  if (fixture) return section('Lighting Component', `<div class="vertix-property-readout">${readout('Fixture', fixture.type || fixture.name)}${readout('Patch', `U${fixture.universe || 1}:${fixture.address || '—'}`)}${readout('Mode', fixture.mode)}${readout('Target', fixture.target)}</div>`)
  if (input) return section('Audio Component', `<div class="vertix-property-readout">${readout('Source', input.source || selected.label)}${readout('Channel', input.channel)}${readout('Mic / DI', input.micDi)}${readout('Monitor', input.monitorSend)}</div>`)
  if (rig || selected.category === 'rigging') return section('Rigging Component', `<div class="vertix-property-readout">${readout('Type', rig?.type || selected.type)}${readout('Span', rig?.span || selected.dimensions?.width)}${readout('Height', rig?.height || selected.position?.y)}${readout('Safety', rig?.qualifiedOnly ? 'Qualified personnel required' : 'Review required')}</div>`)
  if (video) return section('Video Component', `<div class="vertix-property-readout">${readout('Type', video.type || selected.type)}${readout('Input', video.inputSource)}${readout('Resolution', video.resolution)}${readout('Aspect', video.aspectRatio)}</div>`)
  if (selected.id === 'stage-deck' || selected.category === 'venue') return section('Stage Component', `<div class="vertix-property-readout">${readout('Layer', selected.layer || 'venue')}${readout('Deck height', selected.position?.y)}${readout('Stage width', selected.dimensions?.width)}${readout('Stage depth', selected.dimensions?.depth)}</div>`)
  return ''
}

function customPropertiesSection(selected) {
  const entries = Object.entries(selected.metadata || {}).filter(([key, value]) => value !== undefined && value !== null && String(value) !== '' && key !== 'color').slice(0, 8)
  if (!entries.length) return ''
  return section('Custom Properties', `<div class="vertix-property-readout">${entries.map(([key, value]) => readout(key.replace(/([A-Z])/g, ' $1'), typeof value === 'object' ? JSON.stringify(value) : value)).join('')}</div>`)
}

function renderMultiSelection(objects) {
  const locked = objects.filter((object) => object.locked).length
  return `<section class="vertix-property-empty"><strong>${objects.length} objects selected</strong><span>${locked} locked · shared display controls remain available.</span><div class="vertix-object-actions"><button type="button" data-multi-transform-field="locked" data-value="false">Unlock</button><button type="button" data-multi-transform-field="visible" data-value="true">Show</button><button type="button" data-delete-selected>Delete</button></div></section>`
}

export function selectedEditorObjectMarkup() {
  const selectedObjects = selectedStageObjects()
  if (selectedObjects.length > 1) return renderMultiSelection(selectedObjects)
  const selected = selectedObjectRecord()
  if (!selected?.id) return '<section class="vertix-property-empty"><strong>No object selected</strong><span>Select an object in the viewport or Objects editor to inspect it here.</span></section>'
  const position = selected.position || {}
  const rotation = selected.rotation || {}
  const dimensions = selected.dimensions || {}
  const evaluated = evaluatedObjectTransform(selected.id)
  const animatedPosition = { ...position, x: evaluated.x ?? position.x, y: evaluated.y ?? position.y, z: evaluated.z ?? position.z }
  const animatedRotation = { ...rotation, x: evaluated.rotX ?? rotation.x, y: evaluated.rotY ?? rotation.y, z: evaluated.rotZ ?? rotation.z }
  const scale = selected.scale || { x: 1, y: 1, z: 1 }
  const animatedScale = { ...scale, x: evaluated.scaleX ?? scale.x, y: evaluated.scaleY ?? scale.y, z: evaluated.scaleZ ?? scale.z }
  const locked = !!selected.locked
  const disabled = locked ? 'disabled' : ''
  const transform = section('Transform', `<div class="vertix-transform-group"><span>Location</span><div class="vertix-transform-row">${field('X', 'x', animatedPosition.x, { disabled: locked })}${field('Y', 'y', animatedPosition.y, { disabled: locked })}${field('Z', 'z', animatedPosition.z, { disabled: locked })}</div></div><div class="vertix-transform-group"><span>Rotation</span><div class="vertix-transform-row">${field('X', 'rotX', animatedRotation.x, { step: '1', disabled: locked })}${field('Y', 'rotY', animatedRotation.y, { step: '1', disabled: locked })}${field('Z', 'rotZ', animatedRotation.z, { step: '1', disabled: locked })}</div></div><div class="vertix-transform-group"><span>Scale</span><div class="vertix-transform-row">${field('X', 'scaleX', animatedScale.x, { min: 0.01, disabled: locked })}${field('Y', 'scaleY', animatedScale.y, { min: 0.01, disabled: locked })}${field('Z', 'scaleZ', animatedScale.z, { min: 0.01, disabled: locked })}</div></div><div class="vertix-transform-group"><span>Dimensions</span><div class="vertix-transform-row">${field('W', 'width', dimensions.width, { min: 0.05, disabled: locked })}${field('D', 'depth', dimensions.depth, { min: 0.05, disabled: locked })}${field('H', 'height', dimensions.height, { min: 0.05, disabled: locked })}</div></div>${locked ? '<p class="vertix-property-lock-note">Unlock this object to edit transforms or manipulate its gizmo.</p>' : ''}`)
  const display = section('Display', `<div class="vertix-display-controls"><button type="button" data-vertix-object-toggle="visible" aria-pressed="${selected.visible !== false}">${selected.visible === false ? 'Show in viewport' : 'Visible in viewport'}</button><button type="button" data-vertix-object-toggle="locked" aria-pressed="${locked}">${locked ? 'Unlock object' : 'Lock object'}</button><label><span>Color</span><input data-vertix-transform-field="color" type="color" value="${escapeAttr(selected.color || selected.metadata?.color || '#4e6576')}"></label></div>`)
  const header = `<header class="vertix-object-header"><div><input data-vertix-transform-field="label" aria-label="Object name" type="text" value="${escapeAttr(selected.label || selected.name || selected.id)}"><p>${escapeHtml(selected.type || 'Object')} · ${escapeHtml(selected.category || 'stage')} · ${escapeHtml(selected.layer || 'stage')}</p></div><div class="vertix-object-actions"><button type="button" data-focus-selected title="Focus selected object">Focus</button><button type="button" data-duplicate-selected title="Duplicate selected object">Duplicate</button><button type="button" data-delete-selected title="Delete selected object">Delete</button></div></header>`
  const layer = section('Object', `<div class="vertix-property-inline"><label><span>Layer</span><select data-vertix-transform-field="layer">${stageLayers.map((name) => `<option value="${escapeAttr(name)}" ${(selected.layer || selected.category) === name ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></label><span>${escapeHtml(selected.id)}</span></div>`)
  return `<div class="vertix-universal-properties" data-guide-id="stagemaker-entity-${escapeAttr(selected.id)}" data-guide-label="${escapeAttr(selected.label || selected.id)}" data-guide-role="stage-entity" data-guide-entity-id="${escapeAttr(selected.id)}">${header}${transform}${display}${layer}${stageComponentSection(selected)}${sourceSection(selected)}${customPropertiesSection(selected)}</div>`
}

function renderDataTab() {
  const selected = selectedObjectRecord()
  if (!selected) return '<section class="vertix-property-empty"><span>Select an object to view contextual Stage data.</span></section>'
  return `<div class="vertix-universal-properties">${stageComponentSection(selected) || section('Object Data', `<div class="vertix-property-readout">${readout('ID', selected.id)}${readout('Type', selected.type)}${readout('Category', selected.category)}${readout('Layer', selected.layer)}</div>`)}${sourceSection(selected)}</div>`
}

function renderNotesTab() {
  const selected = selectedObjectRecord()
  if (!selected) return '<section class="vertix-property-empty"><span>Select an object to edit its notes.</span></section>'
  return `<section class="vertix-property-section"><h3>Notes</h3><label class="vertix-notes-field"><span>Object notes</span><textarea data-transform-field="notes" placeholder="Notes for crew, venue, or export">${escapeHtml(selected.notes || '')}</textarea></label></section>`
}

function renderAiTab() {
  return '<section class="stage-ai-panel stage-ai-panel--resona"><div data-resona-embedded="stagemaker"></div></section>'
}

export function renderInspectorTabs() {
  const tabs = [['properties', 'Properties'], ['data', 'Data'], ['notes', 'Notes'], ['ai', 'Resona']]
  const active = ['properties', 'data', 'notes', 'ai'].includes(state.activeInspectorTab) ? state.activeInspectorTab : 'properties'
  const body = active === 'properties' ? selectedEditorObjectMarkup() : active === 'data' ? renderDataTab() : active === 'notes' ? renderNotesTab() : renderAiTab()
  const selected = selectedObjectRecord()
  return `<aside class="stage-editor-right"><header class="vertix-editor-region-header"><div><span>Properties</span><small>${selected ? 'Object inspector' : 'No selection'}</small></div><span class="vertix-region-state">${selected?.locked ? 'Locked' : selected ? 'Selection' : 'Empty'}</span></header><div class="stage-inspector-tabs">${tabs.map(([key, label]) => `<button type="button" data-inspector-tab="${key}" class="${active === key ? 'is-active' : ''}">${label}</button>`).join('')}</div><div class="stage-inspector-body">${body}</div></aside>`
}
