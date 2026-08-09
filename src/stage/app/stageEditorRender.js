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
  return `<header class="stage-editor-menubar vertix-global-header"><div class="vertix-global-header-left"><button class="vertix-wordmark" type="button" data-stage-app-menu aria-label="Vertix application menu">VERTIX</button><span class="vertix-discipline-badge">Stage</span><nav aria-label="Vertix application menus"><button type="button" disabled>File</button><button type="button" disabled>Edit</button><button type="button" disabled>Window</button><button type="button" disabled>Help</button></nav></div><div class="stage-editor-project-title"><span>Scene</span><h2 data-stage-project-title>${title}</h2><p data-stage-project-version>${stamp} · v${state.editorProject?.version || 1}</p></div><div class="stage-editor-menu-actions"><span class="stage-save-pill" data-stage-save-status data-save-status="${state.editorSaveStatus || 'idle'}">${state.editorSaveStatus || 'Ready'}</span><button type="button" data-save-stage-plan>Save</button><button type="button" class="is-send" data-open-export>Render</button></div></header>`
}

function renderRail() {
  const disciplines = vertixDisciplines.map((discipline) => `<button type="button" class="${state.activeVertixDiscipline === discipline.key ? 'is-active' : ''}" data-vertix-discipline="${discipline.key}" title="${discipline.available ? `${discipline.label} discipline` : `${discipline.label} is not available yet`}" ${discipline.available ? '' : 'disabled'}><span>${discipline.icon}</span><small>${discipline.label}</small></button>`).join('')
  return `<nav class="stage-editor-rail vertix-discipline-rail" aria-label="Vertix disciplines"><div class="vertix-rail-mark" aria-hidden="true">V</div>${disciplines}<a class="stage-back-link" href="${ROUTES.studioStagemaker}" aria-label="Back to Stage projects" title="Back to Stage projects"><span>↩</span><small>Projects</small></a></nav>`
}

function renderViewport() {
  const viewButtons = editorViewModes.map(([k, l]) => `<button type="button" class="${state.viewportMode === k ? 'is-active-view' : ''}" data-view-mode="${k}" data-guide-id="stagemaker-view-${k}" data-guide-label="${l} view" data-guide-role="stagemaker-view-button">${l}</button>`).join('')
  const shortcutByTool = { select: 'V', pan: 'H', move: 'G / M', rotate: 'R', scale: 'S' }
  const toolButtons = editorToolModes.map((tool) => `<button type="button" data-tool-mode="${tool.key}" data-guide-id="stagemaker-tool-${tool.key}" data-guide-label="${tool.label} tool" data-guide-role="stagemaker-tool-button" class="stage-tool-mode ${state.editorToolMode === tool.key ? 'is-active' : ''}" aria-pressed="${state.editorToolMode === tool.key}" title="${tool.label} (${shortcutByTool[tool.key] || ''})">${tool.label}</button>`).join('')
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
  return `<section class="stage-editor-workspace"><div class="stage-editor-viewport"><div class="stage-editor-canvas" data-guide-id="stagemaker-canvas" data-guide-label="StageMaker canvas" data-guide-role="stagemaker-canvas"><div class="stage-three-viewport" data-stage-three-viewport tabindex="0"></div><div class="stage-viewport-overlay"><div class="stage-viewport-tools"><span>TOOLS:</span><div class="stage-viewport-tool-modes">${toolButtons}</div><div class="stage-viewport-tool-toggles"><button type="button" data-toggle-beam data-guide-id="stagemaker-toggle-beam" data-guide-label="Beam preview" data-guide-role="stagemaker-tool-button" class="${state.beamPreviewEnabled ? 'is-active' : ''}">Beam</button><button type="button" data-toggle-grid data-guide-id="stagemaker-toggle-grid" data-guide-label="Grid toggle" data-guide-role="stagemaker-tool-button" class="${state.gridEnabled ? 'is-active' : ''}">Grid ${state.gridEnabled ? 'On' : 'Off'}</button><button type="button" data-toggle-snap data-guide-id="stagemaker-toggle-snap" data-guide-label="Snap toggle" data-guide-role="stagemaker-tool-button" class="${state.snapEnabled ? 'is-active' : ''}">Snap ${state.snapEnabled ? 'On' : 'Off'}</button><button type="button" data-focus-selected data-guide-id="stagemaker-focus-selected" data-guide-label="Focus selected object" data-guide-role="stagemaker-tool-button" title="Focus selected object (F)">Focus</button><button type="button" data-frame-all data-guide-id="stagemaker-frame-all" data-guide-label="Frame full stage" data-guide-role="stagemaker-tool-button" title="Frame full stage (A)">Frame All</button><button type="button" data-toggle-measure data-guide-id="stagemaker-toggle-measure" data-guide-label="Measure preview" data-guide-role="stagemaker-tool-button" class="${state.measureModeEnabled ? 'is-active' : ''}" title="Measurement is preview mode only">Measure</button></div><span class="stage-tool-status" data-stage-tool-status>Tool: ${state.editorToolMode.charAt(0).toUpperCase()}${state.editorToolMode.slice(1)}</span><span class="stage-mode-status ${editMode ? 'is-edit' : ''}" data-stage-mode-status>${editMode ? 'Edit Mode' : 'Object Mode'}</span></div><div class="stage-viewport-view-modes"><span>VIEW MODE:</span>${viewButtons}</div></div><div class="stage-viewport-status-stack">${loadWarning}<div class="stage-three-hint">${hint}</div></div><div class="stage-viewport-selected-pill" data-guide-id="stagemaker-selected-status" data-guide-label="Selected StageMaker object status" data-guide-role="stage-entity-status">${selectedStatus}</div></div></div></section>`
}

function renderBottomPanel() {
  const tabs = editorModes.map((m) => `<button class="stage-editor-mode-tab ${state.activeEditorMode === m.key ? 'is-active' : ''}" data-editor-mode="${m.key}" data-guide-id="stagemaker-tab-${m.key}" data-guide-label="${m.label}" data-guide-role="stagemaker-bottom-tab" type="button" aria-selected="${state.activeEditorMode === m.key}">${m.label}</button>`).join('')
  return `<section class="stage-editor-bottom"><div class="stage-resize-handle is-bottom" data-resize="bottom"></div><div class="vertix-bottom-editor-header"><span>Editors</span><div class="stage-editor-mode-tabs">${tabs}</div></div><div data-stage-mode-root>${renderBottomSplit()}</div></section>`
}

export function renderStageTabbar() {
  const tabs = ensureStageTabs()
  const stageTabs = tabs.map((tab) => `<button type="button" class="stage-editor-project-tab ${state.activeStageTabId === tab.id ? 'is-active' : ''}" data-stage-tab="${tab.id}" aria-selected="${state.activeStageTabId === tab.id}">${tab.title || 'Untitled Stage'}</button>`).join('')
  const workspaces = vertixWorkspaceTabs.map((workspace) => `<button type="button" class="vertix-workspace-tab ${state.activeVertixWorkspace === workspace.key ? 'is-active' : ''}" data-vertix-workspace="${workspace.key}" ${workspace.available ? '' : 'disabled'} title="${workspace.available ? `${workspace.label} workspace` : `${workspace.label} workspace is not available yet`}">${workspace.label}</button>`).join('')
  const canRemove = tabs.length > 1
  return `<section class="stage-editor-tabbar vertix-workspace-bar"><div class="vertix-workspace-tabs" role="tablist" aria-label="Vertix workspaces">${workspaces}</div><div class="vertix-scene-tabs"><span>Scenes</span><div class="stage-editor-project-tabs">${stageTabs}</div><div class="stage-editor-tab-actions"><button type="button" data-add-stage-tab title="Add stage" aria-label="Add stage">+</button><button type="button" data-remove-stage-tab title="Remove current stage" aria-label="Remove current stage" ${canRemove ? '' : 'aria-disabled="true"'}>-</button></div></div></section>`
}

function renderStatusBar() {
  const selected = selectedStageObjects().length
  const objectCount = state.editorProject?.objects?.length || 0
  return `<footer class="vertix-status-bar"><span>Stage · ${state.activeVertixWorkspace === 'viewport' ? 'Viewport' : state.activeVertixWorkspace}</span><span>${selected ? `${selected} selected` : 'No selection'}</span><span>${objectCount} objects</span><span>${state.editorToolMode} tool · ${state.viewportMode}</span><span data-stage-save-status data-save-status="${state.editorSaveStatus || 'idle'}">${state.editorSaveStatus || 'Ready'}</span></footer>`
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
