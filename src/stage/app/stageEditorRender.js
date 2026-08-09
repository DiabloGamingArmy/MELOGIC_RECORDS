import { ROUTES } from '../../utils/routes'
import { renderBottomSplit } from '../bottomPanel/bottomPanel'
import { renderExportPreview } from '../export/exportPreview'
import { renderInspectorTabs } from '../inspector/inspectorTabs'
import { renderLeftPanelBySection } from '../panels/leftPanels'
import { editorModes, editorToolModes, editorViewModes, ensureStageTabs, findStageObject, isSimpleEditableStageObject, projectDate, projectLoadLabel, selectedStageObjects, state, vertixDisciplines, vertixWorkspaceTabs } from './stageState'

function renderEditorState(title, body) {
  return `<main class="stage-dashboard-page stage-editor-page"><section class="stage-editor-state"><h2>${title}</h2>${body}<a href="${ROUTES.studioStagemaker}" class="stage-back-link">Back to Stagemaker Projects</a></section></main>`
}

function renderMenubar(title, stamp) {
  return `<header class="stage-editor-menubar vertix-global-header"><div class="vertix-global-header-left"><button class="vertix-wordmark" type="button" data-stage-app-menu aria-label="Vertix application menu">VERTIX</button><nav aria-label="Vertix application menus"><button type="button" data-stage-top-menu="file">File</button><button type="button" data-stage-top-menu="edit">Edit</button><button type="button" data-stage-top-menu="window">Window</button><button type="button" data-stage-top-menu="help">Help</button></nav></div><div class="stage-editor-project-title"><span>Scene</span><h2 data-stage-project-title>${title}</h2><p data-stage-project-version>${stamp} · v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><span class="stage-save-pill" data-stage-save-status data-save-status="${state.editorSaveStatus || 'idle'}">${state.editorSaveStatus || 'Ready'}</span><button type="button" data-save-stage-plan>Save</button><button type="button" class="is-send" data-open-export>Render</button></div></header>`
}

function renderRail() {
  const disciplines = vertixDisciplines.map((discipline) => `<button type="button" class="${state.activeVertixDiscipline === discipline.key ? 'is-active' : ''}" data-vertix-discipline="${discipline.key}" title="${discipline.available ? `${discipline.label} discipline` : `${discipline.label} is not available yet`}" ${discipline.available ? '' : 'disabled'}><span>${discipline.icon}</span><small>${discipline.label}</small></button>`).join('')
  return `<nav class="stage-editor-rail vertix-discipline-rail" aria-label="Vertix disciplines"><div class="vertix-rail-mark" aria-hidden="true">V</div>${disciplines}<a class="stage-back-link" href="${ROUTES.studioStagemaker}" aria-label="Back to Stage projects" title="Back to Stage projects"><span>↩</span><small>Projects</small></a></nav>`
}

function renderViewport() {
  if (state.activeVertixWorkspace !== 'viewport') return `<section class="stage-editor-workspace"><div class="vertix-workspace-placeholder"><span>VERTIX WORKSPACE</span><h3>${state.activeVertixWorkspace}</h3><p>This workspace shell is ready for its dedicated toolset.</p><button type="button" data-vertix-workspace="viewport">Return to Viewport</button></div></section>`
  const viewButtons = editorViewModes.map(([k, l]) => `<button type="button" class="${state.viewportMode === k ? 'is-active-view' : ''}" data-view-mode="${k}" data-guide-id="stagemaker-view-${k}" data-guide-label="${l} view" data-guide-role="stagemaker-view-button">${l}</button>`).join('')
  const toolIcons = { select: '↖', move: '↔', rotate: '⟳', scale: '⤢', pan: '✥' }
  const shortcutByTool = { select: 'V', pan: 'H', move: 'G / M', rotate: 'R', scale: 'S' }
  const toolButtons = editorToolModes.map((tool) => `<button type="button" data-tool-mode="${tool.key}" data-guide-id="stagemaker-tool-${tool.key}" data-guide-label="${tool.label} tool" data-guide-role="stagemaker-tool-button" class="vertix-viewport-tool ${state.editorToolMode === tool.key ? 'is-active' : ''}" aria-pressed="${state.editorToolMode === tool.key}" title="${tool.label} (${shortcutByTool[tool.key] || ''})"><span aria-hidden="true">${toolIcons[tool.key] || tool.label.slice(0, 1)}</span><small>${tool.label}</small></button>`).join('')
  const selected = findStageObject()
  const selectedObjects = selectedStageObjects()
  const locked = !!selected?.locked
  const editMode = state.stageInteractionMode === 'edit'
  const selectedStatus = selectedObjects.length > 1
    ? `Selected: ${selectedObjects.length} objects · primary ${selected?.label || selected?.name || selected?.id || 'object'}`
    : selected
    ? `Selected: ${selected.label || selected.name || selected.id} · ${selected.category || selected.type || 'object'} · ${locked ? 'locked' : 'unlocked'}`
    : 'No object selected'
  const hint = editMode
    ? isSimpleEditableStageObject(selected)
      ? 'Edit Mode: drag corner or edge handles to resize. Tab returns to Object Mode.'
      : 'Edit Mode is not available for this selected object.'
    : locked
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
  return `<section class="stage-editor-workspace"><div class="stage-editor-viewport"><div class="stage-editor-canvas" data-guide-id="stagemaker-canvas" data-guide-label="StageMaker canvas" data-guide-role="stagemaker-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-viewport-overlay"><div class="vertix-viewport-toolbar" aria-label="Viewport tools">${toolButtons}<button type="button" data-toggle-measure class="vertix-viewport-tool ${state.measureModeEnabled ? 'is-active' : ''}" title="Measure preview"><span>⌖</span><small>Measure</small></button></div><div class="vertix-viewport-header"><button type="button" data-stage-interaction-mode="${editMode ? 'object' : 'edit'}" class="stage-mode-status ${editMode ? 'is-edit' : ''}" data-stage-mode-status title="Toggle Object/Edit mode">${editMode ? 'Edit' : 'Object'} Mode</button><div class="vertix-viewport-utilities"><button type="button" data-toggle-beam class="${state.beamPreviewEnabled ? 'is-active' : ''}" title="Beam preview">Beam</button><button type="button" data-toggle-grid class="${state.gridEnabled ? 'is-active' : ''}" title="Grid overlay">Grid</button><button type="button" data-toggle-snap class="${state.snapEnabled ? 'is-active' : ''}" title="Snap to ${state.snapInterval}">Snap</button><button type="button" data-focus-selected title="Focus selected object">Focus</button><button type="button" data-frame-all title="Frame full stage">Frame</button></div><div class="stage-viewport-view-modes" aria-label="View mode">${viewButtons}</div></div></div><div class="stage-viewport-status-stack">${loadWarning}<div class="stage-three-hint">${hint}</div></div><div class="stage-viewport-selected-pill" data-guide-id="stagemaker-selected-status" data-guide-label="Selected StageMaker object status" data-guide-role="stage-entity-status">${selectedStatus}</div></div></div></section>`
}

function renderBottomPanel() {
  const tabs = editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" data-guide-id="stagemaker-tab-${m.key}" data-guide-label="${m.label}" data-guide-role="stagemaker-bottom-tab" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')
  return `<section class="stage-editor-bottom"><div class="stage-resize-handle is-bottom" data-resize="bottom"></div><div class="vertix-bottom-editor-header"><span>Editors</span><div class="stage-editor-mode-tabs">${tabs}</div></div><div data-stage-mode-root>${renderBottomSplit()}</div></section>`
}

export function renderStageTabbar() {
  const tabs = ensureStageTabs()
  const stageTabs = tabs.map((tab) => `<button type="button" class="stage-editor-project-tab ${state.activeStageTabId === tab.id ? 'is-active' : ''}" data-stage-tab="${tab.id}" aria-selected="${state.activeStageTabId === tab.id}">${tab.title || 'Untitled Stage'}</button>`).join('')
  const workspaces = vertixWorkspaceTabs.map((workspace) => `<button type="button" class="vertix-workspace-tab ${state.activeVertixWorkspace === workspace.key ? 'is-active' : ''}" data-vertix-workspace="${workspace.key}" title="${workspace.label} workspace">${workspace.label}</button>`).join('')
  const canRemove = tabs.length > 1
  return `<section class="stage-editor-tabbar vertix-workspace-bar"><div class="vertix-workspace-tabs" role="tablist" aria-label="Vertix workspaces">${workspaces}</div><div class="vertix-scene-tabs"><span>Scenes</span><div class="stage-editor-project-tabs">${stageTabs}</div><div class="stage-editor-tab-actions"><button type="button" data-add-stage-tab title="Add stage" aria-label="Add stage">+</button><button type="button" data-remove-stage-tab title="Remove current stage" aria-label="Remove current stage" ${canRemove ? '' : 'aria-disabled="true"'}>-</button></div></div></section>`
}

function renderStatusBar() {
  const selected = selectedStageObjects().length
  const objectCount = state.editorProject?.objects?.length || 0
  const animation = state.editorProject?.animation || { startFrame: 1, endFrame: 250 }
  return `<footer class="vertix-status-bar"><span>Stage · ${state.activeVertixWorkspace === 'viewport' ? 'Viewport' : state.activeVertixWorkspace}</span><span>${selected ? `${selected} selected` : 'No selection'}</span><span>${objectCount} objects</span><span>${state.editorToolMode} tool · ${state.viewportMode}</span><span data-stage-frame-status>Frame ${state.currentFrame} / ${animation.endFrame || 250}</span><span data-stage-save-status data-save-status="${state.editorSaveStatus || 'idle'}">${state.editorSaveStatus || 'Ready'}</span></footer>`
}

export function renderEditor() {
  if (!state.authReady && state.projectId) return renderEditorState('Restoring session...', '<p>Checking your saved sign-in before loading this stage plan.</p>')
  if (state.projectLoadStatus === 'auth-restoring') return renderEditorState('Restoring session...', '<p>Checking your saved sign-in before loading this stage plan.</p>')
  if (state.editorLoading) return renderEditorState('Opening stage plan...', '<p>Loading project workspace.</p>')
  if (state.editorError === 'not-found') return renderEditorState('Stage plan not found.', '')
  if (state.editorError) return renderEditorState('Could not open this stage plan.', '')
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  return `<main class="stage-editor-app vertix-application ${state.showStageGlobalHeader ? '' : 'is-header-hidden'}" style="--stage-lib-w:${state.paneSizes.library}px;--stage-right-w:${state.paneSizes.right}px;--stage-bottom-h:${state.paneSizes.bottom}px;--stage-bottom-split:${state.paneSizes.bottomSplit}%" data-stage-editor-app>${renderMenubar(title, stamp)}${renderStageTabbar()}<section class="stage-editor-body vertix-main-workspace">${renderRail()}${renderLeftPanelBySection(title, stamp)}<div class="stage-resize-handle is-library" data-resize="library"></div>${renderViewport()}<div class="stage-resize-handle is-right" data-resize="right"></div>${renderInspectorTabs(title, stamp)}${renderBottomPanel()}</section>${renderStatusBar()}${state.showExportPreview ? renderExportPreview() : ''}</main>`
}
