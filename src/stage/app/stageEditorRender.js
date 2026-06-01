import { ROUTES } from '../../utils/routes'
import { renderBottomSplit } from '../bottomPanel/bottomPanel'
import { renderExportPreview } from '../export/exportPreview'
import { renderInspectorTabs } from '../inspector/inspectorTabs'
import { renderLeftPanelBySection } from '../panels/leftPanels'
import { editorModes, editorRailItems, editorToolModes, editorViewModes, ensureStageTabs, findStageObject, projectDate, projectLoadLabel, selectedStageObjects, stageIconPath, state } from './stageState'

function renderEditorState(title, body) {
  return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>${title}</h2>${body}<a href="${ROUTES.studioStagemaker}" class="stage-back-link">Back to Stagemaker Projects</a></section></main>`
}

function renderMenubar(title, stamp) {
  return `<section class="stage-editor-menubar"><div class="stage-editor-menu-left"><button class="stage-editor-app-menu" type="button" data-stage-app-menu aria-label="Stage app menu">☰</button><button type="button" data-icon-path="${stageIconPath('app', 'file')}">File</button><button type="button" data-icon-path="${stageIconPath('app', 'edit')}">Edit</button><button type="button" data-icon-path="${stageIconPath('app', 'view')}">View</button><button type="button" data-icon-path="${stageIconPath('app', 'share')}">Share</button></div><div class="stage-editor-project-title"><h2 data-stage-project-title>Project: ${title}</h2><p data-stage-project-version>Date/Version ${stamp} | v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><span class="stage-save-pill" data-stage-save-status data-save-status="${state.editorSaveStatus || 'idle'}">${state.editorSaveStatus || 'Ready'}</span><button type="button" aria-disabled="true">Share ▾</button><button type="button" aria-disabled="true">⚙</button><button type="button" aria-disabled="true">⋯</button><button type="button" class="is-send" data-open-export>Send Stage Plan</button></div></section>`
}

function renderRail() {
  const railItems = editorRailItems.map((item) => `<button type="button" class="${state.activeStageSection === item.key ? 'is-active' : ''}" data-rail-section="${item.key}" title="${item.label}"><span class="stage-rail-icon" data-stage-icon-path="${item.icon}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">◈</span></span><small>${item.label}</small></button>`).join('')
  return `<nav class="stage-editor-rail" aria-label="Editor tools">${railItems}<a class="stage-back-link" href="${ROUTES.studioStagemaker}" aria-label="Back to StageMaker" title="Back to StageMaker"><span class="stage-rail-icon" data-stage-icon-path="${stageIconPath('rail', 'exit')}"><img alt="" loading="lazy" hidden /><span class="stage-rail-fallback">↩</span></span><small>Back</small></a></nav>`
}

function renderViewport() {
  const viewButtons = editorViewModes.map(([k, l]) => `<button type="button" class="${state.viewportMode === k ? 'is-active-view' : ''}" data-view-mode="${k}">${l}</button>`).join('')
  const toolButtons = editorToolModes.map((tool) => `<button type="button" data-tool-mode="${tool.key}" class="stage-tool-mode ${state.editorToolMode === tool.key ? 'is-active' : ''}" aria-pressed="${state.editorToolMode === tool.key}">${tool.label}</button>`).join('')
  const selected = findStageObject()
  const selectedObjects = selectedStageObjects()
  const locked = !!selected?.locked
  const selectedStatus = selectedObjects.length > 1
    ? `Selected: ${selectedObjects.length} objects · primary ${selected?.label || selected?.name || selected?.id || 'object'}`
    : selected
    ? `Selected: ${selected.label || selected.name || selected.id} · ${selected.category || selected.type || 'object'} · ${locked ? 'locked' : 'unlocked'}`
    : 'No object selected'
  const hint = locked
    ? 'Selected object is locked. Unlock it in Properties before moving.'
    : state.editorToolMode === 'pan'
      ? 'Pan: drag to move camera · wheel zoom'
      : state.editorToolMode === 'select'
        ? 'Select: click object · drag box to select'
        : state.editorToolMode === 'move'
          ? 'Move: drag selected object · arrows nudge · Shift = large'
          : state.editorToolMode === 'rotate'
            ? 'Rotate: drag or use rotate buttons'
            : state.editorToolMode === 'scale'
              ? 'Scale: use handles or Properties dimensions'
              : state.viewportMode === 'top2d'
                ? 'Top: drag box to select · switch to Move to place objects'
              : state.viewportMode === 'front' || state.viewportMode === 'side'
                ? 'Elevation: pan · zoom · F focus · A frame all'
                : '3D: orbit drag · pan right-drag · wheel zoom · choose Move to drag'
  const loadWarning = !['loaded', 'loading'].includes(state.projectLoadStatus)
    ? `<div class="stage-three-load-warning">${state.projectLoadMessage || `${projectLoadLabel()}: editing local/fallback stage.`}</div>`
    : ''
  return `<section class="stage-editor-workspace"><div class="stage-editor-viewport"><div class="stage-editor-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-viewport-overlay"><div class="stage-viewport-tools"><span>TOOLS:</span><div class="stage-viewport-tool-modes">${toolButtons}</div><div class="stage-viewport-tool-toggles"><button type="button" data-toggle-beam class="${state.beamPreviewEnabled ? 'is-active' : ''}">Beam</button><button type="button" data-toggle-grid class="${state.gridEnabled ? 'is-active' : ''}">Grid ${state.gridEnabled ? 'On' : 'Off'}</button><button type="button" data-toggle-snap class="${state.snapEnabled ? 'is-active' : ''}">Snap ${state.snapEnabled ? 'On' : 'Off'}</button><button type="button" data-focus-selected title="Focus selected object">Focus</button><button type="button" data-frame-all title="Frame full stage">Frame All</button><button type="button" data-toggle-measure class="${state.measureModeEnabled ? 'is-active' : ''}" title="Measurement is preview mode only">Measure</button></div></div><div class="stage-viewport-view-modes"><span>VIEW MODE:</span>${viewButtons}</div></div><div class="stage-viewport-status-stack">${loadWarning}<div class="stage-three-hint">${hint}</div></div><div class="stage-viewport-selected-pill">${selectedStatus}</div></div></div></section>`
}

function renderBottomPanel() {
  const tabs = editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')
  return `<section class="stage-editor-bottom"><div class="stage-resize-handle is-bottom" data-resize="bottom"></div><div class="stage-editor-mode-tabs">${tabs}</div><div data-stage-mode-root>${renderBottomSplit()}</div></section>`
}

export function renderStageTabbar() {
  const tabs = ensureStageTabs()
  const stageTabs = tabs.map((tab) => `<button type="button" class="stage-editor-project-tab ${state.activeStageTabId === tab.id ? 'is-active' : ''}" data-stage-tab="${tab.id}" aria-selected="${state.activeStageTabId === tab.id}">${tab.title || 'Untitled Stage'}</button>`).join('')
  const canRemove = tabs.length > 1
  return `<section class="stage-editor-tabbar"><div class="stage-editor-project-tabs">${stageTabs}</div><div class="stage-editor-tab-actions"><button type="button" data-add-stage-tab title="Add stage" aria-label="Add stage">+</button><button type="button" data-remove-stage-tab title="Remove current stage" aria-label="Remove current stage" ${canRemove ? '' : 'aria-disabled="true"'}>-</button></div></section>`
}

export function renderEditor() {
  if (!state.authReady && state.projectId) return renderEditorState('Restoring session...', '<p>Checking your saved sign-in before loading this stage plan.</p>')
  if (state.projectLoadStatus === 'auth-restoring') return renderEditorState('Restoring session...', '<p>Checking your saved sign-in before loading this stage plan.</p>')
  if (state.editorLoading) return renderEditorState('Opening stage plan...', '<p>Loading project workspace.</p>')
  if (state.editorError === 'not-found') return renderEditorState('Stage plan not found.', '')
  if (state.editorError) return renderEditorState('Could not open this stage plan.', '')
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  return `<main class="stage-editor-app ${state.showStageGlobalHeader ? '' : 'is-header-hidden'}" style="--stage-lib-w:${state.paneSizes.library}px;--stage-right-w:${state.paneSizes.right}px;--stage-bottom-h:${state.paneSizes.bottom}px;--stage-bottom-split:${state.paneSizes.bottomSplit}%" data-stage-editor-app>${renderMenubar(title, stamp)}${renderStageTabbar()}<section class="stage-editor-body">${renderRail()}${renderLeftPanelBySection(title, stamp)}<div class="stage-resize-handle is-library" data-resize="library"></div>${renderViewport()}<div class="stage-resize-handle is-right" data-resize="right"></div>${renderInspectorTabs(title, stamp)}${renderBottomPanel()}</section>${state.showExportPreview ? renderExportPreview() : ''}</main>`
}
