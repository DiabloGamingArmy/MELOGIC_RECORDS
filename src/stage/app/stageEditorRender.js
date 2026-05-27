import { ROUTES } from '../../utils/routes'
import { renderBottomSplit } from '../bottomPanel/bottomPanel'
import { renderExportPreview } from '../export/exportPreview'
import { renderInspectorTabs } from '../inspector/inspectorTabs'
import { renderLeftPanelBySection } from '../panels/leftPanels'
import { editorModes, editorRailItems, editorViewModes, projectDate, stageIconPath, state } from './stageState'

function renderEditorState(title, body) {
  return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>${title}</h2>${body}<a href="${ROUTES.stage}" class="stage-back-link">Back to Stage Projects</a></section></main>`
}

function renderMenubar(title, stamp) {
  return `<section class="stage-editor-menubar"><div class="stage-editor-menu-left"><button class="stage-editor-app-menu" type="button" data-stage-app-menu aria-label="Stage app menu">☰</button><button type="button" data-icon-path="${stageIconPath('app', 'file')}">File</button><button type="button" data-icon-path="${stageIconPath('app', 'edit')}">Edit</button><button type="button" data-icon-path="${stageIconPath('app', 'view')}">View</button><button type="button" data-icon-path="${stageIconPath('app', 'share')}">Share</button></div><div class="stage-editor-project-title"><h2 data-stage-project-title>Project: ${title}</h2><p data-stage-project-version>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><button type="button" aria-disabled="true">Share ▾</button><button type="button" aria-disabled="true">⚙</button><button type="button" aria-disabled="true">⋯</button><button type="button" class="is-send" data-open-export>Send Stage Plan</button></div></section>`
}

function renderRail() {
  const railItems = editorRailItems.map((item) => `<button type="button" class="${state.activeStageSection === item.key ? 'is-active' : ''}" data-rail-section="${item.key}" title="${item.label}"><span class="stage-rail-icon" data-stage-icon-path="${item.icon}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">◈</span></span><small>${item.label}</small></button>`).join('')
  return `<nav class="stage-editor-rail" aria-label="Editor tools">${railItems}<a class="stage-back-link" href="${ROUTES.stage}"><span class="stage-rail-icon" data-stage-icon-path="${stageIconPath('rail', 'exit')}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">↩</span></span><small>Exit</small></a></nav>`
}

function renderViewport() {
  const viewButtons = editorViewModes.map(([k, l]) => `<button type="button" class="${state.viewportMode === k ? 'is-active-view' : ''}" data-view-mode="${k}">${l}</button>`).join('')
  return `<section class="stage-editor-workspace"><div class="stage-editor-viewport"><div class="stage-editor-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-viewport-overlay"><div class="stage-viewport-tools"><span>TOOLS:</span><button type="button" data-toggle-beam class="${state.beamPreviewEnabled ? 'is-active' : ''}">Beam Preview</button><button type="button" data-toggle-grid class="${state.gridEnabled ? 'is-active' : ''}">Grid ${state.gridEnabled ? 'On' : 'Off'}</button><button type="button" data-toggle-snap class="${state.snapEnabled ? 'is-active' : ''}">Snap ${state.snapEnabled ? 'On' : 'Off'}</button><button type="button" data-toggle-measure class="${state.measureModeEnabled ? 'is-active' : ''}" title="Measurement is preview mode only">Measure</button></div><div class="stage-viewport-view-modes"><span>VIEW MODE:</span>${viewButtons}</div></div><div class="stage-three-hud-label">Blank Stage</div><div class="stage-three-hint">Orbit: drag • Pan: right-drag • Zoom: wheel • Nudge: arrows/PageUp/PageDown</div></div></div></section>`
}

function renderBottomPanel() {
  const tabs = editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')
  return `<section class="stage-editor-bottom"><div class="stage-resize-handle is-bottom" data-resize="bottom"></div><div class="stage-editor-mode-tabs">${tabs}</div><div data-stage-mode-root>${renderBottomSplit()}</div></section>`
}

export function renderEditor() {
  if (state.editorLoading) return renderEditorState('Opening stage plan...', '<p>Loading project workspace.</p>')
  if (state.editorError === 'not-found') return renderEditorState('Stage plan not found.', '')
  if (state.editorError) return renderEditorState('Could not open this stage plan.', '')
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  return `<main class="stage-editor-app ${state.showStageGlobalHeader ? '' : 'is-header-hidden'}" style="--stage-lib-w:${state.paneSizes.library}px;--stage-right-w:${state.paneSizes.right}px;--stage-bottom-h:${state.paneSizes.bottom}px;--stage-bottom-split:${state.paneSizes.bottomSplit}%" data-stage-editor-app>${renderMenubar(title, stamp)}<section class="stage-editor-tabbar"><div class="stage-editor-project-tab">${state.editorProject?.stageType || 'Festival Stage'} <span>×</span></div><div class="stage-editor-tab-actions"></div></section><section class="stage-editor-body">${renderRail()}${renderLeftPanelBySection(title, stamp)}<div class="stage-resize-handle is-library" data-resize="library"></div>${renderViewport()}<div class="stage-resize-handle is-right" data-resize="right"></div>${renderInspectorTabs(title, stamp)}${renderBottomPanel()}</section>${state.showExportPreview ? renderExportPreview() : ''}</main>`
}
