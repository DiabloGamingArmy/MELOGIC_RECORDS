import { ROUTES, authRoute } from '../../utils/routes'
import { state } from './stageState'

let stageEditorEventsBound = false

export function bindDashboardEvents({ app, renderCreateModal, openProject, loadDashboardProjects }) {
  app.querySelectorAll('[data-new-stage-plan]').forEach((el) => el.addEventListener('click', (e) => {
    if (!state.user) return
    e.preventDefault()
    renderCreateModal(false, state.selectedStageType || 'Blank Stage')
  }))
  app.querySelectorAll('[data-use-template]').forEach((el) => el.addEventListener('click', () => {
    if (!state.user) {
      window.location.href = authRoute({ redirect: ROUTES.stage })
      return
    }
    state.selectedStageType = el.dataset.useTemplate || 'Blank Stage'
    renderCreateModal(false, state.selectedStageType)
  }))
  app.querySelectorAll('[data-open-project]').forEach((el) => el.addEventListener('click', () => openProject(el.dataset.openProject || '')))
  app.querySelector('[data-retry-stage-projects]')?.addEventListener('click', () => loadDashboardProjects())
}

export function bindStageEditorEventsOnce(context) {
  if (stageEditorEventsBound) return
  stageEditorEventsBound = true
  const {
    app,
    disposeViewportController,
    ensureStageViewportMounted,
    getViewportController,
    showStageNotice,
    updateEditorModeUI,
    updateExportPreview,
    updateInspectorUI,
    updateLeftPanelUI,
    updateLibraryActiveState,
    updateRailUI,
    updateStageAppMenu,
    updateStageInspectorSelection,
    updateViewportControlUI
  } = context

  app.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-editor-mode]')
    if (mode) { state.activeEditorMode = mode.dataset.editorMode || 'builder'; updateEditorModeUI(); return }
    const newStage = e.target.closest('[data-new-stage-plan]')
    if (newStage && app.querySelector('[data-stage-editor-app]')) { window.location.href = ROUTES.stage; return }
    const menuBtn = e.target.closest('[data-stage-app-menu]')
    if (menuBtn) { state.stageAppMenuOpen = !state.stageAppMenuOpen; updateStageAppMenu(); return }
    const menuPanel = e.target.closest('[data-stage-app-menu-panel]')
    if (!menuPanel && state.stageAppMenuOpen) { state.stageAppMenuOpen = false; updateStageAppMenu() }
    const lib = e.target.closest('[data-library-category]')
    if (lib) {
      state.activeLibraryCategory = lib.dataset.libraryCategory || 'band-backline'
      state.selectedEditorObject = lib.dataset.selectObject || state.selectedEditorObject
      getViewportController()?.update?.({ selectedObjectKey: state.selectedEditorObject })
      updateLibraryActiveState()
      updateStageInspectorSelection()
      updateEditorModeUI()
      return
    }
    const selectObject = e.target.closest('[data-select-object]')
    if (selectObject) {
      state.selectedEditorObject = selectObject.dataset.selectObject || state.selectedEditorObject
      getViewportController()?.update?.({ selectedObjectKey: state.selectedEditorObject })
      updateStageInspectorSelection()
      updateEditorModeUI()
      return
    }
    const rail = e.target.closest('[data-rail-section]')
    if (rail) { state.activeStageSection = rail.dataset.railSection || 'home'; updateRailUI(); updateLeftPanelUI(); return }
    const vm = e.target.closest('[data-view-mode]')
    if (vm) {
      state.viewportMode = vm.dataset.viewMode || 'perspective3d'
      localStorage.setItem('stageViewportMode', state.viewportMode)
      getViewportController()?.update?.({ viewportMode: state.viewportMode })
      updateViewportControlUI()
      updateLeftPanelUI()
      updateEditorModeUI()
      return
    }
    const grid = e.target.closest('[data-toggle-grid]')
    if (grid) {
      state.gridEnabled = !state.gridEnabled
      getViewportController()?.update?.({ showGrid: state.gridEnabled })
      updateViewportControlUI()
      updateLeftPanelUI()
      updateEditorModeUI()
      return
    }
    const beam = e.target.closest('[data-toggle-beam]')
    if (beam) {
      state.beamPreviewEnabled = !state.beamPreviewEnabled
      getViewportController()?.update?.({ showBeams: state.beamPreviewEnabled })
      updateViewportControlUI()
      updateLeftPanelUI()
      return
    }
    const openExport = e.target.closest('[data-open-export]')
    if (openExport) { state.showExportPreview = true; updateExportPreview(); return }
    const closeExport = e.target.closest('[data-close-export]')
    if (closeExport) { state.showExportPreview = false; updateExportPreview(); return }
    const snap = e.target.closest('[data-toggle-snap]')
    if (snap) { state.snapEnabled = !state.snapEnabled; updateViewportControlUI(); updateLeftPanelUI(); updateEditorModeUI(); return }
    const measure = e.target.closest('[data-toggle-measure]')
    if (measure) { state.measureModeEnabled = !state.measureModeEnabled; updateViewportControlUI(); showStageNotice('Measurement is preview mode only.'); return }
    const inspectorTab = e.target.closest('[data-inspector-tab]')
    if (inspectorTab) { state.activeInspectorTab = inspectorTab.dataset.inspectorTab || 'properties'; updateInspectorUI(); return }
    const dataTab = e.target.closest('[data-data-tab]')
    if (dataTab) { state.activeDataTab = dataTab.dataset.dataTab || 'schema'; updateEditorModeUI() }
  })

  app.addEventListener('input', (e) => {
    const snapInterval = e.target.closest('[data-snap-interval]')
    if (snapInterval) {
      const next = Number(snapInterval.value)
      if (Number.isFinite(next) && next > 0) {
        state.snapInterval = next
        updateEditorModeUI()
      }
      return
    }
    const f = e.target.closest('[data-transform-field]')
    if (!f) return
    const key = state.selectedEditorObject
    const existing = state.editorObjectTransforms[key] || {}
    const v = f.type === 'number' ? Number(f.value) : f.type === 'checkbox' ? !!f.checked : f.value
    state.editorObjectTransforms = { ...state.editorObjectTransforms, [key]: { ...existing, [f.dataset.transformField]: v } }
    getViewportController()?.update?.({ objectTransforms: state.editorObjectTransforms })
    updateEditorModeUI()
  })

  app.addEventListener('change', (e) => {
    const labels = e.target.closest('[data-toggle-labels]')
    if (labels) { state.showStageLabels = !!labels.checked; getViewportController()?.update?.({ showLabels: state.showStageLabels }); return }
    const gridControl = e.target.closest('[data-toggle-grid-control]')
    if (gridControl) {
      state.gridEnabled = !!gridControl.checked
      getViewportController()?.update?.({ showGrid: state.gridEnabled })
      updateViewportControlUI()
      updateEditorModeUI()
      return
    }
    const beamControl = e.target.closest('[data-toggle-beam-control]')
    if (beamControl) {
      state.beamPreviewEnabled = !!beamControl.checked
      getViewportController()?.update?.({ showBeams: state.beamPreviewEnabled })
      updateViewportControlUI()
      return
    }
    const defaultView = e.target.closest('[data-default-view-mode]')
    if (defaultView) {
      state.viewportMode = defaultView.value || 'perspective3d'
      localStorage.setItem('stageViewportMode', state.viewportMode)
      getViewportController()?.update?.({ viewportMode: state.viewportMode })
      updateViewportControlUI()
      updateEditorModeUI()
      return
    }
    const diag = e.target.closest('[data-toggle-viewport-diagnostics]')
    if (diag) {
      state.showViewportDiagnostics = !!diag.checked
      disposeViewportController()
      ensureStageViewportMounted()
      return
    }
    const toggle = e.target.closest('[data-toggle-main-header]')
    if (!toggle) return
    state.showStageGlobalHeader = !!toggle.checked
    const header = app.querySelector('[data-stage-global-header-wrapper]')
    const editor = app.querySelector('[data-stage-editor-app]')
    if (header) header.hidden = !state.showStageGlobalHeader
    if (editor) editor.classList.toggle('is-header-hidden', !state.showStageGlobalHeader)
  })

  app.addEventListener('pointerdown', (e) => {
    const handle = e.target.closest('[data-resize]')
    if (!handle) return
    const editor = app.querySelector('[data-stage-editor-app]')
    if (!editor) return
    const type = handle.dataset.resize
    const startX = e.clientX
    const startY = e.clientY
    const start = { ...state.paneSizes }
    const split = handle.closest('.stage-bottom-split')
    const splitRect = () => split?.getBoundingClientRect?.()
    const maxBottom = () => Math.round((editor.clientHeight || window.innerHeight) * 0.45)
    const onMove = (evt) => {
      if (type === 'library') state.paneSizes.library = Math.min(360, Math.max(180, start.library + (evt.clientX - startX)))
      if (type === 'right') state.paneSizes.right = Math.min(420, Math.max(240, start.right - (evt.clientX - startX)))
      if (type === 'bottom') state.paneSizes.bottom = Math.min(maxBottom(), Math.max(120, start.bottom - (evt.clientY - startY)))
      if (type === 'bottom-split') {
        const rect = splitRect()
        if (rect?.width) state.paneSizes.bottomSplit = Math.min(72, Math.max(38, ((evt.clientX - rect.left) / rect.width) * 100))
      }
      editor.style.setProperty('--stage-lib-w', `${state.paneSizes.library}px`)
      editor.style.setProperty('--stage-right-w', `${state.paneSizes.right}px`)
      editor.style.setProperty('--stage-bottom-h', `${state.paneSizes.bottom}px`)
      editor.style.setProperty('--stage-bottom-split', `${state.paneSizes.bottomSplit}%`)
    }
    const onUp = () => {
      localStorage.setItem('stagePaneLibrary', String(state.paneSizes.library))
      localStorage.setItem('stagePaneRight', String(state.paneSizes.right))
      localStorage.setItem('stagePaneBottom', String(state.paneSizes.bottom))
      localStorage.setItem('stagePaneBottomSplit', String(Math.round(state.paneSizes.bottomSplit)))
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.stageAppMenuOpen) {
      state.stageAppMenuOpen = false
      updateStageAppMenu()
    }
  })
}
