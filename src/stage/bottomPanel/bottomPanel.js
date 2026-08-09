import { currentStageDimensions, exportReadiness, isStageObjectSelected, projectAnimation, selectedEditorObject, stageEntities, stageObjectsForTable, stageWarnings, state, viewportModeLabel } from '../app/stageState'
import { renderStagePlotSvg } from '../export/exportPreview'
import { vertixAssetRegistry } from '../../vertix/assets/builtInStageAssetProvider'
import { createAssetBrowserCatalog, filterAssetBrowserAssets, normalizeAssetBrowserQuery, selectedAssetBrowserAsset } from '../../vertix/assets/assetBrowserModel'

const escapeAttr = (value = '') => String(value ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
const escapeHtml = (value = '') => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))

function renderInputListTable() {
  const rows = Array.isArray(state.editorProject?.audioInputs) ? state.editorProject.audioInputs : []
  return `<table class="stage-input-table"><thead><tr><th>✓</th><th>Ch</th><th>Source</th><th>Mic/DI</th><th>Stand</th><th>Patch</th><th>Location</th><th>Notes</th></tr></thead><tbody>${rows.map((row) => `<tr data-select-object="${row.linkedObjectId || row.id || ''}"><td>✓</td><td><input data-audio-input-field="channel" data-row-id="${row.id || ''}" type="number" min="1" value="${row.channel || ''}"></td><td><input data-audio-input-field="source" data-row-id="${row.id || ''}" value="${row.source || ''}"></td><td><input data-audio-input-field="micDi" data-row-id="${row.id || ''}" value="${row.micDi || row.mic || ''}"></td><td><input data-audio-input-field="stand" data-row-id="${row.id || ''}" value="${row.stand || 'N/A'}"></td><td><input data-audio-input-field="patch" data-row-id="${row.id || ''}" value="${row.patch || ''}"></td><td><input data-audio-input-field="stageLocation" data-row-id="${row.id || ''}" value="${row.stageLocation || row.location || ''}"></td><td><input data-audio-input-field="notes" data-row-id="${row.id || ''}" value="${row.notes || ''}"></td></tr>`).join('') || '<tr><td colspan="8">No audio inputs yet. Add audio assets from the Object Library.</td></tr>'}</tbody></table>`
}

const fmt = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '0.0'

function renderEntityTable() {
  const rows = stageObjectsForTable()
  const body = rows.map((row) => {
    const linked = row.linkedData.length ? row.linkedData.join(', ') : 'none'
    const statusBadges = [
      row.status,
      row.warnings ? `${row.warnings} warning${row.warnings === 1 ? '' : 's'}` : ''
    ].filter(Boolean)
    return `<tr data-select-object="${escapeAttr(row.id || '')}" data-guide-id="stagemaker-object-${escapeAttr(row.id || '')}" data-guide-label="${escapeAttr(row.name || row.id || 'Stage object')}" data-guide-role="stage-entity-row" data-guide-entity-id="${escapeAttr(row.id || '')}" class="${isStageObjectSelected(row.id) ? 'is-selected' : ''}">
      <td><span class="stage-row-dot ${row.visible ? 'is-visible' : 'is-hidden'}"></span></td>
      <td class="stage-object-name"><strong>${row.name || 'Untitled'}</strong><small>${row.id || ''}</small></td>
      <td>${row.kind || row.type || 'object'}</td>
      <td>${row.category || 'stage'}</td>
      <td>${row.layer || 'stage'}</td>
      <td>X ${fmt(row.position.x)} / Y ${fmt(row.position.y)} / Z ${fmt(row.position.z)}</td>
      <td>${fmt(row.dimensions.width)} x ${fmt(row.dimensions.depth)} x ${fmt(row.dimensions.height)}</td>
      <td><span class="stage-entity-status ${row.locked ? 'is-locked' : 'is-open'}">${row.locked ? 'locked' : 'open'}</span></td>
      <td><span class="stage-entity-status ${row.visible ? 'is-visible' : 'is-hidden'}">${row.visible ? 'visible' : 'hidden'}</span></td>
      <td>${linked}</td>
      <td><div class="stage-object-row-actions">${statusBadges.map((badge) => `<span class="stage-entity-status">${badge}</span>`).join('')}<button type="button" data-focus-object="${escapeAttr(row.id)}" data-guide-id="stagemaker-focus-object-${escapeAttr(row.id || '')}" data-guide-label="Focus ${escapeAttr(row.name || row.id || 'stage object')}" data-guide-role="stagemaker-tool-button">Focus</button></div></td>
    </tr>`
  }).join('')
  return `<div class="stage-object-table-wrap" data-guide-id="stagemaker-object-table" data-guide-label="StageMaker object table" data-guide-role="stagemaker-object-table"><table class="stage-object-data-grid"><colgroup><col class="is-state"><col class="is-name"><col class="is-kind"><col class="is-category"><col class="is-layer"><col class="is-position"><col class="is-size"><col class="is-flag"><col class="is-flag"><col class="is-linked"><col class="is-status"></colgroup><thead><tr><th></th><th>Name / Label</th><th>Kind</th><th>Category</th><th>Layer</th><th>Position</th><th>Size</th><th>Locked</th><th>Visible</th><th>Linked Data</th><th>Status</th></tr></thead><tbody>${body || '<tr class="is-empty"><td colspan="11">No stage objects yet. Add assets from the Object Library.</td></tr>'}</tbody></table></div>`
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

function renderStageData() {
  const views = [['stage-plot', 'Stage Plot'], ['input-list', 'Inputs'], ['lighting-patch', 'Lighting'], ['rigging', 'Rigging'], ['warnings', 'Warnings'], ['export', 'Export']]
  const active = views.some(([key]) => key === state.activeStageDataView) ? state.activeStageDataView : 'stage-plot'
  const body = active === 'stage-plot'
    ? `<section class="stage-editor-mode-panel"><h4>Stage Plot</h4><div class="stage-plot-preview">${renderStagePlotSvg()}</div></section>`
    : active === 'input-list'
      ? `<section class="stage-editor-table-panel is-large"><h4>Input List</h4>${renderInputListTable()}</section>`
      : active === 'lighting-patch'
        ? `<section class="stage-editor-table-panel is-large"><h4>Lighting Patch</h4>${renderLightingTable()}</section>`
        : active === 'rigging'
          ? `<section class="stage-editor-table-panel is-large"><h4>Rigging</h4>${renderRiggingTable()}</section>`
          : active === 'warnings'
            ? `<section class="stage-editor-mode-panel"><h4>Warnings</h4>${renderWarningsList()}</section>`
            : `<section class="stage-editor-mode-panel"><h4>Export Readiness</h4>${renderExportChecklist()}<div class="stage-action-grid"><button type="button" data-open-export>Preview Packet</button><button type="button" aria-disabled="true">Packet Builder</button></div></section>`
  return `<section class="stage-editor-mode-content stage-bottom-primary vertix-stage-data"><header class="vertix-stage-data-header"><span>Stage Data</span><div>${views.map(([key, label]) => `<button type="button" data-stage-data-view="${key}" class="${active === key ? 'is-active' : ''}">${label}</button>`).join('')}</div></header>${body}</section>`
}

function renderAssetBrowser() {
  let catalog
  try {
    catalog = createAssetBrowserCatalog(vertixAssetRegistry)
  } catch {
    return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="vertix-asset-browser"><header class="vertix-asset-browser-header"><div><span>Asset Browser</span><small>Registry unavailable</small></div></header><p class="vertix-asset-browser-empty">Assets are unavailable right now. Existing scene objects remain unchanged.</p></section></section>`
  }
  const query = normalizeAssetBrowserQuery(state.assetBrowserQuery)
  const assets = filterAssetBrowserAssets(catalog, query)
  const selected = selectedAssetBrowserAsset(catalog, state.selectedAssetBrowserId)
  const filterOptions = (values, current, field, label) => `<label><span>${label}</span><select data-asset-browser-filter="${field}"><option value="all">All ${label}s</option>${values.map((value) => `<option value="${escapeAttr(value.key || value)}" ${current === (value.key || value) ? 'selected' : ''}>${escapeHtml(value.label || value)}</option>`).join('')}</select></label>`
  const categoryButtons = [`<button type="button" class="${query.category === 'all' ? 'is-active' : ''}" data-asset-browser-category="all">All</button>`, ...catalog.categories.map((category) => `<button type="button" class="${query.category === category ? 'is-active' : ''}" data-asset-browser-category="${escapeAttr(category)}">${escapeHtml(category)}</button>`)].join('')
  const cards = assets.map((asset) => {
    const preview = escapeHtml(asset.preview?.icon || asset.icon || asset.type?.slice(0, 3).toUpperCase() || 'Asset')
    const source = asset.source.label
    return `<article class="vertix-asset-card ${selected?.id === asset.id ? 'is-selected' : ''}" data-stage-asset="${escapeAttr(asset.id)}" data-asset-browser-select="${escapeAttr(asset.id)}" draggable="true" title="${escapeAttr(`${asset.label || asset.name || asset.id} · ${source}`)}"><button type="button" class="vertix-asset-card-main" data-asset-browser-select="${escapeAttr(asset.id)}" aria-pressed="${selected?.id === asset.id}"><span class="vertix-asset-preview" aria-hidden="true">${preview}</span><span class="vertix-asset-card-copy"><strong>${escapeHtml(asset.label || asset.name || asset.id)}</strong><small>${escapeHtml(asset.category || 'asset')} · ${escapeHtml(asset.type || 'object')}</small><em>${escapeHtml(source)}</em></span></button><button type="button" class="vertix-asset-add" data-add-stage-asset="${escapeAttr(asset.id)}" data-asset-browser-add="true">Add</button></article>`
  }).join('')
  const filtersActive = query.search || query.category !== 'all' || query.type !== 'all' || query.source !== 'all' || query.publisher !== 'all' || query.tag !== 'all'
  return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="vertix-asset-browser"><header class="vertix-asset-browser-header"><div><span>Asset Browser</span><small>${catalog.assets.length} available from ${catalog.sources.length} source${catalog.sources.length === 1 ? '' : 's'}</small></div><button type="button" data-asset-browser-clear ${filtersActive ? '' : 'disabled'}>Clear filters</button></header><div class="vertix-asset-browser-controls"><input type="search" data-asset-browser-search placeholder="Search assets…" value="${escapeAttr(query.search)}" aria-label="Search assets" /><div class="vertix-asset-category-row" aria-label="Asset categories">${categoryButtons}</div><div class="vertix-asset-select-row">${filterOptions(catalog.types, query.type, 'type', 'Type')}${filterOptions(catalog.tags, query.tag, 'tag', 'Tag')}${filterOptions(catalog.sources, query.source, 'source', 'Source')}${filterOptions(catalog.publishers, query.publisher, 'publisher', 'Publisher')}</div></div><div class="vertix-asset-results" aria-live="polite">${cards || `<p class="vertix-asset-browser-empty">${catalog.assets.length ? 'No assets match these filters.' : 'No assets are currently available.'}</p>`}</div>${selected ? `<aside class="vertix-asset-detail"><span>Selected asset</span><strong>${escapeHtml(selected.label || selected.name || selected.id)}</strong><small>${escapeHtml(selected.type || 'object')} · ${escapeHtml(selected.category || 'asset')} · ${escapeHtml(selected.dimensions?.width || '?')} × ${escapeHtml(selected.dimensions?.depth || '?')} × ${escapeHtml(selected.dimensions?.height || '?')}</small><small>Source: ${escapeHtml(selected.source.label)}${selected.source.packageVersion ? ` · v${escapeHtml(selected.source.packageVersion)}` : ''}${selected.source.publisherId ? ` · ${escapeHtml(selected.source.publisherId)}` : ''}</small><small>${selected.tags.length ? `Tags: ${escapeHtml(selected.tags.join(', '))}` : 'No tags'}</small><button type="button" data-add-stage-asset="${escapeAttr(selected.id)}" data-asset-browser-add="true">Add to Scene</button></aside>` : ''}</section></section>`
}

function renderTimeline() {
  const animation = projectAnimation()
  const pixelsPerFrame = 8 * Math.max(0.5, Math.min(3, Number(state.timelineZoom) || 1))
  const frameCount = animation.endFrame - animation.startFrame + 1
  const width = Math.max(520, frameCount * pixelsPerFrame)
  const tickStep = frameCount > 420 ? 50 : frameCount > 220 ? 25 : 10
  const tracksByObject = new Map()
  animation.tracks.forEach((track) => {
    const rows = tracksByObject.get(track.targetObjectId) || []
    rows.push(track)
    tracksByObject.set(track.targetObjectId, rows)
  })
  const objectById = new Map((state.editorProject?.objects || []).map((object) => [object.id, object]))
  const timelineRows = [...tracksByObject.entries()].map(([objectId, tracks]) => {
    const object = objectById.get(objectId)
    const label = object?.label || object?.name || objectId
    return `<section class="vertix-timeline-object"><button type="button" class="vertix-timeline-object-row ${state.selectedEditorObject === objectId ? 'is-selected' : ''}" data-select-object="${escapeAttr(objectId)}"><strong>${escapeHtml(label)}</strong><small>${tracks.length} channel${tracks.length === 1 ? '' : 's'}</small></button>${tracks.map((track) => `<div class="vertix-timeline-track"><span>${escapeHtml(track.propertyPath.replace('transform.', '').replaceAll('.', ' › '))}</span><div class="vertix-timeline-lane" data-timeline-scrub style="--timeline-width:${width}px">${track.keyframes.map((keyframe) => `<button type="button" class="vertix-timeline-key ${state.selectedTimelineKey?.trackId === track.id && state.selectedTimelineKey?.frame === keyframe.frame ? 'is-selected' : ''}" data-timeline-key="${escapeAttr(track.id)}" data-keyframe-frame="${keyframe.frame}" style="left:${(keyframe.frame - animation.startFrame) * pixelsPerFrame}px" title="Frame ${keyframe.frame}: ${keyframe.value}">◆</button>`).join('')}</div></div>`).join('')}</section>`
  }).join('')
  const ticks = []
  for (let frame = animation.startFrame; frame <= animation.endFrame; frame += tickStep) ticks.push(`<button type="button" data-timeline-frame="${frame}" style="left:${(frame - animation.startFrame) * pixelsPerFrame}px">${frame}</button>`)
  const playheadLeft = (state.currentFrame - animation.startFrame) * pixelsPerFrame
  return `<section class="stage-editor-mode-content stage-bottom-primary vertix-timeline" data-timeline-root tabindex="0"><header class="vertix-timeline-header"><div><strong>Timeline</strong><small>${animation.frameRate} fps</small></div><div class="vertix-timeline-transport"><button type="button" data-timeline-start title="Jump to start">|◀</button><button type="button" data-timeline-play aria-pressed="${state.timelinePlaying}" title="${state.timelinePlaying ? 'Pause' : 'Play'}">${state.timelinePlaying ? 'Ⅱ' : '▶'}</button><button type="button" data-timeline-end title="Jump to end">▶|</button><label>Frame <input type="number" data-timeline-current-frame min="${animation.startFrame}" max="${animation.endFrame}" value="${state.currentFrame}"></label><label>Start <input type="number" data-timeline-start-frame value="${animation.startFrame}"></label><label>End <input type="number" data-timeline-end-frame value="${animation.endFrame}"></label><button type="button" data-timeline-zoom="out">−</button><button type="button" data-timeline-zoom="in">+</button></div></header><div class="vertix-timeline-scroll"><div class="vertix-timeline-grid" style="--timeline-width:${width}px"><div class="vertix-timeline-ruler"><span>Tracks</span><div class="vertix-timeline-ruler-track" data-timeline-scrub>${ticks.join('')}<i data-timeline-playhead style="left:${playheadLeft}px"></i></div></div><div class="vertix-timeline-body"><div class="vertix-timeline-track-list">${timelineRows || '<p>No animated objects. Select an object and use ◇ in Properties to insert a keyframe.</p>'}</div><i class="vertix-timeline-body-playhead" data-timeline-playhead style="left:calc(190px + ${playheadLeft}px)"></i></div></div></div></section>`
}

function renderBottomPrimaryPane() {
  const activeMode = state.activeEditorMode === 'builder' ? 'entities' : state.activeEditorMode
  if (activeMode === 'asset-browser') return renderAssetBrowser()
  if (activeMode === 'stage-data') return renderStageData()
  if (activeMode === 'timeline') return renderTimeline()
  return `<section class="stage-editor-mode-content stage-bottom-primary"><section class="stage-editor-table-panel is-entities"><h4>Objects</h4>${renderEntityTable()}</section></section>`
}

function renderDataPane() {
  if (state.activeEditorMode === 'asset-browser') {
    return `<section class="stage-bottom-secondary vertix-asset-browser-secondary"><div class="stage-data-tabs"><span>Asset Details</span></div><div class="stage-data-body"><p>Choose an asset to inspect its provenance and add it through the existing Stage placement path.</p></div></section>`
  }
  if (state.activeEditorMode === 'stage-data') {
    const dims = currentStageDimensions()
    return `<section class="stage-bottom-secondary vertix-stage-data-summary"><div class="stage-data-tabs"><span>Scene Summary</span></div><div class="stage-data-body"><ul class="stage-data-list"><li>${stageObjectsForTable().length} stage objects</li><li>${state.editorProject?.fixtures?.length || 0} fixtures</li><li>${state.editorProject?.audioInputs?.length || 0} audio inputs</li><li>${state.editorProject?.rigging?.length || 0} rigging items</li><li>${dims.width || 32} × ${dims.depth || 24} ${dims.unit || 'ft'} stage</li></ul></div></section>`
  }
  const tabs = [['schema', 'Scene'], ['object', 'Object Graph'], ['export', 'Readiness']]
  const dims = currentStageDimensions()
  const unit = dims.unit || state.editorProject?.units || 'ft'
  const objectCount = stageObjectsForTable().length
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
          ? `<div class="stage-data-cards"><p>Selected: ${selectedEditorObject().label}</p><p>Exports to: ${selectedEditorObject().type}</p>${stageEntities().slice(0, 8).map((entity) => `<p>${entity.name} → ${entity.category} → ${entity.status}</p>`).join('')}<p>Relationships shown here are generated from StagePlan links.</p></div>`
          : renderExportChecklist()
  return `<section class="stage-bottom-secondary"><div class="stage-data-tabs">${tabs.map(([k, l]) => `<button type="button" data-data-tab="${k}" class="${state.activeDataTab === k ? 'is-active' : ''}">${l}</button>`).join('')}</div><div class="stage-data-body">${body}</div></section>`
}

export function renderBottomSplit() {
  if (state.activeEditorMode === 'timeline') return renderTimeline()
  return `<div class="stage-bottom-split">${renderBottomPrimaryPane()}<div class="stage-bottom-divider" data-resize="bottom-split" aria-hidden="true"></div>${renderDataPane()}</div>`
}
