import { currentStageDimensions, editorTitleStamp, exportReadiness, stageWarnings, state } from '../app/stageState'

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

export function renderStagePlotSvg() {
  const dims = currentStageDimensions()
  const width = Number(dims.width || 32)
  const depth = Number(dims.depth || 24)
  const margin = 6
  const viewBox = `${-width / 2 - margin} ${-depth / 2 - margin} ${width + margin * 2} ${depth + margin * 2}`
  const objects = (state.editorProject?.objects || []).filter((object) => object.visible !== false && object.id !== 'stage-deck')
  const objectNodes = objects.map((object) => {
    const p = object.position || {}
    const d = object.dimensions || {}
    const x = Number(p.x || 0) - Number(d.width || 1) / 2
    const z = Number(p.z || 0) - Number(d.depth || 1) / 2
    const fill = object.category === 'audio' ? '#26364b' : object.category === 'lighting' ? '#28536a' : object.category === 'rigging' ? '#343060' : object.category === 'video' ? '#27554f' : '#344154'
    const stroke = object.id === state.selectedEditorObject ? '#22b8b5' : 'rgba(255,255,255,.42)'
    return `<g data-object-id="${esc(object.id)}"><rect x="${x}" y="${z}" width="${Number(d.width || 1)}" height="${Number(d.depth || 1)}" rx="0.12" fill="${fill}" stroke="${stroke}" stroke-width="0.08"/><text x="${Number(p.x || 0)}" y="${Number(p.z || 0)}" text-anchor="middle" dominant-baseline="middle" fill="#e7f5ff" font-size="0.9">${esc(object.label || object.name || object.id)}</text></g>`
  }).join('')
  return `<svg class="stage-plot-svg" data-stage-plot-svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-label="Top-view stage plot"><rect x="${-width / 2}" y="${-depth / 2}" width="${width}" height="${depth}" fill="#111722" stroke="#22b8b5" stroke-width="0.12"/><line x1="0" y1="${-depth / 2}" x2="0" y2="${depth / 2}" stroke="#5dd9ff" stroke-width="0.06" stroke-dasharray="0.4 0.35"/><line x1="${-width / 2}" y1="0" x2="${width / 2}" y2="0" stroke="#8496b8" stroke-width="0.04" stroke-dasharray="0.35 0.35"/><text x="0" y="${depth / 2 + 2.5}" text-anchor="middle" fill="#93a8c8" font-size="1.1">DOWNSTAGE / AUDIENCE</text><text x="${-width / 2}" y="${-depth / 2 - 1.6}" fill="#d8ecff" font-size="1.1">${width} x ${depth} ${esc(dims.unit || 'ft')}</text>${objectNodes}</svg>`
}

export function renderExportPreview() {
  const { title, stamp } = editorTitleStamp()
  const dims = currentStageDimensions()
  const readiness = exportReadiness()
  const warnings = stageWarnings()
  const inputs = state.editorProject?.audioInputs || []
  const fixtures = state.editorProject?.fixtures || []
  return `<div class="stage-export-modal"><div class="stage-export-sheet"><header class="stage-export-titlebar"><div><h3>Stage Plan Packet</h3><p>${esc(title)} • ${stamp} • v${state.editorProject?.version || 1}</p></div><button type="button" data-close-export>Close</button></header><div class="stage-export-packet-grid"><section><h4>Cover / Title Block</h4><p>${dims.width || 32} x ${dims.depth || 24} ${dims.unit || 'ft'} stage • ${state.editorProject?.stageType || 'Blank Stage'}</p><p>Prepared for crew review. Export-ready sheets are generated from StagePlan data, not viewport screenshots.</p></section><section><h4>Readiness</h4><ul>${readiness.map((item) => `<li>${item.ok ? '✓' : '⚠'} ${item.label}</li>`).join('')}</ul></section></div><div class="stage-export-drawing">${renderStagePlotSvg()}</div><div class="stage-export-packet-grid"><section><h4>Input List Sheet</h4><p>${inputs.length} channels • Channel / Source / Mic-DI / Stand / Patch / Notes</p></section><section><h4>Lighting Plot Sheet</h4><p>${fixtures.length} fixtures • Universe / Address / Mode / Position / Target</p></section><section><h4>Rigging Notes Sheet</h4><p>Qualified-personnel notes and attachment comments. No structural calculations generated.</p></section><section><h4>Warnings</h4><p>${warnings.length ? `${warnings.length} item${warnings.length === 1 ? '' : 's'} need review before final export.` : 'No blocking warnings detected.'}</p></section></div><div class="stage-export-actions"><button disabled title="PDF export coming soon; vector packet foundation is in place.">Export PDF</button><button disabled>Export PNG</button><button type="button" data-export-svg>Export SVG</button><button type="button" data-export-json>Export JSON</button><button disabled>Copy Share Link</button><button data-close-export>Close</button></div></div></div>`
}
