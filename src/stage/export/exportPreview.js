import { currentStageDimensions, editorTitleStamp, exportReadiness, stageWarnings, state } from '../app/stageState'

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const dash = (value) => {
  const text = String(value ?? '').trim()
  return text && text !== 'undefined' && text !== 'null' ? text : '—'
}
const countLabel = (count, singular, plural = `${singular}s`) => `${count} ${count === 1 ? singular : plural}`
const toDate = (value) => value?.toDate?.() || (value ? new Date(value) : null)
const fmtDate = (value) => {
  const date = toDate(value)
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : 'Not set'
}
const fmtNum = (value, digits = 1) => Number.isFinite(Number(value)) ? Number(value).toFixed(digits).replace(/\.0$/, '') : '—'
const unitLabel = () => currentStageDimensions().unit || state.editorProject?.units || 'ft'
const fmtPosition = (position = {}, unit = unitLabel()) => `X ${fmtNum(position.x)} ${unit}, Y ${fmtNum(position.y)} ${unit}, Z ${fmtNum(position.z)} ${unit}`
const fmtSize = (dimensions = {}, unit = unitLabel()) => `W ${fmtNum(dimensions.width)} × D ${fmtNum(dimensions.depth)} × H ${fmtNum(dimensions.height)} ${unit}`
const fmtRotation = (rotation = {}) => `${fmtNum(rotation.y || rotation.rotY || 0, 0)}°`
const truncate = (value = '', max = 84) => {
  const text = dash(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function categorizeStageObject(object = {}) {
  const descriptor = [object.category, object.layer, object.type, object.kind, object.id, object.label, object.name].map((value) => String(value || '').toLowerCase()).join(' ')
  if (/(camera|tripod)/.test(descriptor)) return 'camera'
  if (/(truss|rigging|hoist|point|hang)/.test(descriptor)) return 'rigging'
  if (/(speaker|subwoofer|monitor|mic|microphone|mixer|di|audio|wedge|playback)/.test(descriptor)) return 'audio'
  if (/(light|fixture|wash|spot|par|moving-head|movinghead|led-bar|lighting)/.test(descriptor)) return 'lighting'
  if (/(led-wall|screen|projector|video|projection)/.test(descriptor)) return 'video'
  if (/(power|distro|cable|electrical)/.test(descriptor)) return 'power'
  if (/(note|label|text)/.test(descriptor)) return 'notes'
  if (/(stage|deck|riser|platform|booth|rectangle|square|cube|staging|backline|venue)/.test(descriptor)) return 'staging'
  return 'miscellaneous'
}

function exportOptions() {
  const saved = state.editorProject?.exportSettings || {}
  const session = state.exportPreviewOptions || {}
  return {
    includeGrid: session.includeGrid ?? saved.showGrid ?? true,
    includeLabels: session.includeLabels ?? saved.showLabels ?? true,
    includeEquipment: session.includeEquipment ?? true,
    includeNotes: session.includeNotes ?? true,
    includeHidden: session.includeHidden ?? false,
    groupByCategory: session.groupByCategory ?? true,
    orientation: session.orientation || saved.orientation || 'portrait'
  }
}

function exportObjects(options = exportOptions()) {
  const objects = Array.isArray(state.editorProject?.objects) ? state.editorProject.objects : []
  return objects.filter((object) => options.includeHidden || object.visible !== false)
}

function categoryLabel(category = '') {
  return {
    staging: 'Staging',
    audio: 'Audio',
    lighting: 'Lighting',
    video: 'Video',
    camera: 'Camera',
    rigging: 'Rigging',
    power: 'Power',
    notes: 'Notes',
    miscellaneous: 'Miscellaneous'
  }[category] || 'Miscellaneous'
}

function categoryColor(category = '') {
  return {
    staging: '#2f4258',
    audio: '#26364b',
    lighting: '#28536a',
    video: '#27554f',
    camera: '#215f57',
    rigging: '#343060',
    power: '#66451e',
    notes: '#4d4b58',
    miscellaneous: '#344154'
  }[category] || '#344154'
}

function equipmentRows(options = exportOptions()) {
  return exportObjects(options).map((object, index) => {
    const category = categorizeStageObject(object)
    return {
      number: index + 1,
      id: object.id || object.key || `object-${index + 1}`,
      name: object.label || object.name || object.id || 'Untitled Object',
      category,
      type: object.type || object.kind || 'object',
      position: object.position || {},
      dimensions: object.dimensions || {},
      rotation: object.rotation || {},
      notes: object.notes || object.metadata?.notes || ''
    }
  })
}

function groupedEquipment(rows = []) {
  return rows.reduce((groups, row) => {
    const key = row.category || 'miscellaneous'
    if (!groups[key]) groups[key] = []
    groups[key].push(row)
    return groups
  }, {})
}

function exportCounts(rows = equipmentRows()) {
  const counts = {
    staging: 0,
    audio: 0,
    lighting: 0,
    video: 0,
    camera: 0,
    rigging: 0,
    power: 0,
    notes: 0,
    miscellaneous: 0
  }
  rows.forEach((row) => { counts[row.category] = (counts[row.category] || 0) + 1 })
  return counts
}

export function renderStagePlotSvg(options = exportOptions()) {
  const dims = currentStageDimensions()
  const width = Number(dims.width || 32)
  const depth = Number(dims.depth || 24)
  const margin = 6
  const viewBox = `${-width / 2 - margin} ${-depth / 2 - margin} ${width + margin * 2} ${depth + margin * 2}`
  const rows = equipmentRows(options).filter((row) => row.id !== 'stage-deck')
  const gridLines = options.includeGrid
    ? Array.from({ length: Math.floor(width / 4) + 1 }, (_, i) => -width / 2 + i * 4)
      .map((x) => `<line x1="${x}" y1="${-depth / 2}" x2="${x}" y2="${depth / 2}" stroke="#243448" stroke-width="0.035"/>`).join('')
      + Array.from({ length: Math.floor(depth / 4) + 1 }, (_, i) => -depth / 2 + i * 4)
        .map((z) => `<line x1="${-width / 2}" y1="${z}" x2="${width / 2}" y2="${z}" stroke="#243448" stroke-width="0.035"/>`).join('')
    : ''
  const objectNodes = rows.map((row) => {
    const p = row.position || {}
    const d = row.dimensions || {}
    const objectWidth = Math.max(0.35, Number(d.width || 1))
    const objectDepth = Math.max(0.35, Number(d.depth || 1))
    const x = Number(p.x || 0) - objectWidth / 2
    const z = Number(p.z || 0) - objectDepth / 2
    const rot = Number(row.rotation?.y || 0)
    const label = options.includeLabels ? `<text x="${Number(p.x || 0)}" y="${Number(p.z || 0)}" text-anchor="middle" dominant-baseline="middle" fill="#f4fbff" font-size="0.82">${row.number}. ${esc(row.name)}</text>` : ''
    return `<g data-object-id="${esc(row.id)}" transform="rotate(${rot} ${Number(p.x || 0)} ${Number(p.z || 0)})"><rect x="${x}" y="${z}" width="${objectWidth}" height="${objectDepth}" rx="0.12" fill="${categoryColor(row.category)}" stroke="#dceaff" stroke-width="0.07"/><text x="${x + 0.25}" y="${z + 0.8}" fill="#dceaff" font-size="0.72">${row.number}</text>${label}</g>`
  }).join('')
  return `<svg class="stage-plot-svg" data-stage-plot-svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Top-view StageMaker blueprint"><rect x="${-width / 2}" y="${-depth / 2}" width="${width}" height="${depth}" fill="#111722" stroke="#22b8b5" stroke-width="0.14"/>${gridLines}<line x1="0" y1="${-depth / 2}" x2="0" y2="${depth / 2}" stroke="#5dd9ff" stroke-width="0.06" stroke-dasharray="0.4 0.35"/><line x1="${-width / 2}" y1="0" x2="${width / 2}" y2="0" stroke="#8496b8" stroke-width="0.04" stroke-dasharray="0.35 0.35"/><text x="0" y="${depth / 2 + 2.5}" text-anchor="middle" fill="#93a8c8" font-size="1.1">DOWNSTAGE / AUDIENCE</text><text x="${-width / 2}" y="${-depth / 2 - 1.6}" fill="#d8ecff" font-size="1.1">${width} × ${depth} ${esc(dims.unit || 'ft')}</text>${objectNodes}</svg>`
}

function renderOptions(options) {
  const checkbox = (key, label) => `<label><input type="checkbox" data-export-option="${key}" ${options[key] ? 'checked' : ''}> ${label}</label>`
  return `<section class="stage-export-options no-print"><h4>Export Options</h4><div>${checkbox('includeGrid', 'Include grid')}${checkbox('includeLabels', 'Include object labels')}${checkbox('includeEquipment', 'Include equipment list')}${checkbox('includeNotes', 'Include notes')}${checkbox('includeHidden', 'Include hidden objects')}${checkbox('groupByCategory', 'Group equipment by category')}<label>Paper <select data-export-option="orientation"><option value="portrait" ${options.orientation === 'portrait' ? 'selected' : ''}>Portrait</option><option value="landscape" ${options.orientation === 'landscape' ? 'selected' : ''}>Landscape</option></select></label></div></section>`
}

function renderEquipmentTable(rows, options) {
  if (!rows.length) return '<p>No equipment objects found for the current export options.</p>'
  const rowMarkup = (row) => `<tr><td>${row.number}</td><td><strong>${esc(row.name)}</strong><small>${esc(row.id)}</small></td><td>${categoryLabel(row.category)}</td><td>${esc(row.type)}</td><td>${esc(fmtPosition(row.position))}</td><td>${esc(fmtSize(row.dimensions))}</td><td>${esc(fmtRotation(row.rotation))}</td><td>${esc(truncate(row.notes))}</td></tr>`
  const table = (body) => `<table class="stage-export-equipment-table"><thead><tr><th>#</th><th>Name</th><th>Category</th><th>Type</th><th>Position</th><th>Size</th><th>Rotation</th><th>Notes</th></tr></thead><tbody>${body}</tbody></table>`
  if (!options.groupByCategory) return table(rows.map(rowMarkup).join(''))
  const groups = groupedEquipment(rows)
  return Object.keys(groups).map((category) => `<h5>${categoryLabel(category)}</h5>${table(groups[category].map(rowMarkup).join(''))}`).join('')
}

function renderNotes(rows, project) {
  const projectNotes = String(project.notes || '').trim()
  const objectNotes = rows.filter((row) => String(row.notes || '').trim())
  return `<div class="stage-export-notes"><p>${projectNotes ? esc(projectNotes) : 'No project notes yet.'}</p>${objectNotes.length ? `<ul>${objectNotes.map((row) => `<li><strong>${row.number}. ${esc(row.name)}</strong> ${esc(row.notes)}</li>`).join('')}</ul>` : '<p>No object-specific notes entered.</p>'}</div>`
}

export function renderExportPreview() {
  const { title, stamp } = editorTitleStamp()
  const dims = currentStageDimensions()
  const options = exportOptions()
  const rows = equipmentRows(options)
  const counts = exportCounts(rows)
  const readiness = exportReadiness()
  const warnings = stageWarnings()
  const project = state.editorProject || {}
  const inputs = project.audioInputs || []
  const fixtures = project.fixtures || []
  const rigging = project.rigging || []
  const video = project.video || []
  const power = project.power || []
  const generated = new Date()
  const updated = fmtDate(project.updatedAt || project.lastOpenedAt)
  const created = fmtDate(project.createdAt)
  const dirty = ['unsaved', 'saving', 'local', 'failed'].includes(state.editorSaveStatus)
  return `<div class="stage-export-modal"><div class="stage-export-sheet is-${options.orientation}" data-stage-export-sheet><header class="stage-export-titlebar"><div><p class="stage-export-kicker">StageMaker Blueprint</p><h3>${esc(title || 'Untitled Stage Plan')}</h3><p>${esc(project.stageType || 'Blank Stage')} • ${stamp} • v${project.version || 1}</p></div><div class="stage-export-title-actions no-print"><button type="button" data-print-export>Print / Save PDF</button><button type="button" data-close-export>Close</button></div></header>${dirty ? '<p class="stage-export-warning no-print">This export may include unsaved local changes. Save status is not fully clean.</p>' : ''}${renderOptions(options)}<section class="stage-export-meta-grid"><div><span>Project ID</span><strong>${esc(String(project.id || state.projectId || 'not-set').slice(0, 14))}</strong></div><div><span>Owner</span><strong>${esc(project.ownerName || project.ownerId || state.authUid || 'Not set')}</strong></div><div><span>Units</span><strong>${esc(dims.unit || 'ft')}</strong></div><div><span>Created</span><strong>${esc(created)}</strong></div><div><span>Last Updated</span><strong>${esc(updated)}</strong></div><div><span>Generated</span><strong>${esc(generated.toLocaleString())}</strong></div></section><section class="stage-export-summary"><div><h4>Stage Summary</h4><p>${dims.width || 32} × ${dims.depth || 24} ${dims.unit || 'ft'} stage${dims.deckHeight ? ` • deck height ${dims.deckHeight} ${dims.unit || 'ft'}` : ''}</p><p>${esc(project.notes || 'No project notes summary yet.')}</p></div><div><h4>Technical Summary</h4><ul><li>${countLabel(rows.length, 'exported object')}</li><li>${countLabel(fixtures.length, 'fixture')}</li><li>${countLabel(inputs.length, 'audio input')}</li><li>${countLabel(video.filter((item) => categorizeStageObject(item) !== 'camera').length, 'video item')}</li><li>${countLabel(rows.filter((row) => row.category === 'camera').length, 'camera')}</li><li>${countLabel(rigging.length, 'rigging item')}</li><li>${countLabel(power.length, 'power item')}</li></ul></div></section><section class="stage-export-drawing"><header><h4>Blueprint Plan View</h4><p>Static top view generated from StagePlan data. Editor controls, gizmos, and selection handles are excluded.</p></header>${renderStagePlotSvg(options)}</section><section class="stage-export-category-counts"><h4>Category Counts</h4><div>${Object.entries(counts).map(([category, count]) => `<span>${categoryLabel(category)} <strong>${count}</strong></span>`).join('')}</div></section>${options.includeEquipment ? `<section class="stage-export-section"><h4>Equipment List</h4>${renderEquipmentTable(rows, options)}</section>` : ''}<section class="stage-export-section"><h4>Production Sheets</h4><div class="stage-export-packet-grid"><section><h5>Audio</h5><p>${inputs.length} channels • source / mic-DI / stand / patch / monitor notes</p></section><section><h5>Lighting</h5><p>${fixtures.length} fixtures • universe / address / mode / target</p></section><section><h5>Rigging</h5><p>${rigging.length} rigging rows. Qualified-personnel review required.</p></section><section><h5>Video / Power</h5><p>${video.length} video rows • ${power.length} power rows</p></section></div></section>${options.includeNotes ? `<section class="stage-export-section"><h4>Notes</h4>${renderNotes(rows, project)}</section>` : ''}<section class="stage-export-section"><h4>Readiness / Warnings</h4><div class="stage-export-packet-grid"><section><h5>Readiness</h5><ul>${readiness.map((item) => `<li>${item.ok ? '✓' : '⚠'} ${esc(item.label)}</li>`).join('')}</ul></section><section><h5>Warnings</h5><p>${warnings.length ? `${warnings.length} item${warnings.length === 1 ? '' : 's'} need review before final export.` : 'No blocking warnings detected.'}</p></section></div></section><footer class="stage-export-footer"><span>Generated by Melogic StageMaker</span><span>${esc(String(project.id || state.projectId || 'stage-plan').slice(0, 18))}</span></footer><div class="stage-export-actions no-print"><button type="button" data-print-export>Print / Save PDF</button><button type="button" data-export-svg>Export stage plot SVG</button><button type="button" data-export-json>Export StagePlan JSON</button><button type="button" data-close-export>Close</button></div></div></div>`
}
