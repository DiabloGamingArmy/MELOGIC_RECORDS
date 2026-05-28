import { ROUTES, authRoute } from '../../utils/routes'
import {
  addStageAssetToPlan,
  deleteSelectedStageObject,
  duplicateSelectedStageObject,
  findStageObject,
  moveSelectedStageObject,
  redoStageEdit,
  resetSelectedStageObjectRotation,
  rotateSelectedStageObject,
  state,
  undoStageEdit,
  updateSelectedStageObjectField
} from './stageState'

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
    queueEditorStateSave,
    queueStagePlanSave,
    refreshStageViewport,
    updateEditorModeUI,
    updateExportPreview,
    updateInspectorUI,
    updateLeftPanelUI,
    updateLibraryActiveState,
    updateRailUI,
    updateStageAppMenu,
    updateStageTabsUI,
    updateStageInspectorSelection,
    updateViewportControlUI,
    loadEditorProject,
    saveCurrentPlanAsNew
  } = context

  const syncObjectTransformCache = () => {
    const object = findStageObject()
    if (!object) return
    state.editorObjectTransforms = {
      ...(state.editorObjectTransforms || {}),
      [object.id]: {
        x: object.position?.x || 0,
        y: object.position?.y || 0,
        z: object.position?.z || 0,
        rotY: object.rotation?.y || 0,
        width: object.dimensions?.width || 1,
        depth: object.dimensions?.depth || 1,
        height: object.dimensions?.height || 1
      }
    }
  }

  const syncObjectSurfaces = ({ refreshViewport = false, save = true, notice = '' } = {}) => {
    syncObjectTransformCache()
    if (refreshViewport) refreshStageViewport?.()
    else getViewportController()?.update?.({ selectedObjectKey: state.selectedEditorObject, objectTransforms: state.editorObjectTransforms })
    updateStageInspectorSelection?.()
    updateInspectorUI?.()
    updateEditorModeUI?.()
    if (notice) showStageNotice?.(notice)
    if (save) queueStagePlanSave?.()
  }

  const downloadText = (filename, text, type) => {
    const blob = new Blob([text], { type })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const updateStageDimension = (field, rawValue) => {
    if (!state.editorProject) return false
    const value = field === 'unit' ? String(rawValue || 'ft') : Math.max(field === 'deckHeight' ? 0 : 1, Number(rawValue) || 0)
    state.editorProject.stageDimensions = { ...(state.editorProject.stageDimensions || {}), [field]: value }
    const deck = (state.editorProject.objects || []).find((object) => object.id === 'stage-deck')
    if (deck && field !== 'unit') {
      deck.dimensions = {
        ...(deck.dimensions || {}),
        ...(field === 'width' ? { width: value } : {}),
        ...(field === 'depth' ? { depth: value } : {}),
        ...(field === 'deckHeight' ? { height: Math.max(0.2, Number(value) * 0.25 || 1) } : {})
      }
    }
    return true
  }

  const updateProductionRow = (collectionName, id, field, rawValue) => {
    if (!state.editorProject || !id || !field) return false
    const numeric = ['channel', 'universe', 'address', 'beamAngle']
    state.editorProject[collectionName] = (state.editorProject[collectionName] || []).map((row) => {
      if (row.id !== id) return row
      const value = numeric.includes(field) ? Number(rawValue) || 0 : rawValue
      return { ...row, [field]: value, ...(field === 'type' && collectionName === 'fixtures' ? { fixtureType: value } : {}) }
    })
    return true
  }

  app.addEventListener('click', (e) => {
    const mode = e.target.closest('[data-editor-mode]')
    if (mode) { state.activeEditorMode = mode.dataset.editorMode || 'entities'; updateEditorModeUI(); queueEditorStateSave?.(); return }
    const addAsset = e.target.closest('[data-add-stage-asset]')
    if (addAsset) {
      const object = addStageAssetToPlan(addAsset.dataset.addStageAsset || '')
      if (!object) {
        showStageNotice('That object is not available yet.')
        return
      }
      refreshStageViewport?.()
      updateStageInspectorSelection()
      updateInspectorUI()
      updateEditorModeUI()
      updateLeftPanelUI()
      showStageNotice(`Added ${object.label || object.name}.`)
      queueStagePlanSave?.()
      return
    }
    const retryLoad = e.target.closest('[data-retry-project-load]')
    if (retryLoad) { loadEditorProject?.(); return }
    const saveAsNew = e.target.closest('[data-save-as-new-stage]')
    if (saveAsNew) { saveCurrentPlanAsNew?.(); return }
    const focusSelected = e.target.closest('[data-focus-selected]')
    if (focusSelected) { getViewportController()?.focusSelected?.(); showStageNotice?.('Focused selected object.'); return }
    const frameAll = e.target.closest('[data-frame-all]')
    if (frameAll) { getViewportController()?.frameAll?.(); showStageNotice?.('Framed full stage.'); return }
    const duplicateSelected = e.target.closest('[data-duplicate-selected]')
    if (duplicateSelected) {
      const copy = duplicateSelectedStageObject()
      if (!copy) showStageNotice?.('Select an object to duplicate.')
      else syncObjectSurfaces({ refreshViewport: true, notice: `Duplicated ${copy.label || copy.name}.` })
      return
    }
    const deleteSelected = e.target.closest('[data-delete-selected]')
    if (deleteSelected) {
      const deleted = deleteSelectedStageObject()
      syncObjectSurfaces({ refreshViewport: true, save: deleted, notice: deleted ? 'Deleted selected object.' : 'Protected objects cannot be deleted.' })
      return
    }
    const rotateSelected = e.target.closest('[data-rotate-selected]')
    if (rotateSelected) {
      const amount = Number(rotateSelected.dataset.rotateSelected || 0)
      const rotated = rotateSelectedStageObject(amount)
      syncObjectSurfaces({ notice: rotated ? `Rotated ${amount > 0 ? '+' : ''}${amount} degrees.` : 'Locked object cannot rotate.', save: rotated })
      return
    }
    const resetRotation = e.target.closest('[data-reset-rotation]')
    if (resetRotation) {
      const reset = resetSelectedStageObjectRotation()
      syncObjectSurfaces({ notice: reset ? 'Rotation reset.' : 'Locked object cannot rotate.', save: reset })
      return
    }
    const undoBtn = e.target.closest('[data-undo-stage]')
    if (undoBtn) {
      const ok = undoStageEdit()
      syncObjectSurfaces({ refreshViewport: true, save: ok, notice: ok ? 'Undo.' : 'Nothing to undo.' })
      return
    }
    const redoBtn = e.target.closest('[data-redo-stage]')
    if (redoBtn) {
      const ok = redoStageEdit()
      syncObjectSurfaces({ refreshViewport: true, save: ok, notice: ok ? 'Redo.' : 'Nothing to redo.' })
      return
    }
    const addStageTab = e.target.closest('[data-add-stage-tab]')
    if (addStageTab) {
      const nextIndex = (state.stageTabs?.length || 0) + 1
      const tab = { id: `stage-${Date.now()}`, title: nextIndex === 1 ? 'Untitled Stage' : `Untitled Stage ${nextIndex}` }
      state.stageTabs = [...(state.stageTabs || []), tab]
      state.activeStageTabId = tab.id
      updateStageTabsUI?.()
      queueEditorStateSave?.()
      return
    }
    const removeStageTab = e.target.closest('[data-remove-stage-tab]')
    if (removeStageTab) {
      if ((state.stageTabs?.length || 0) <= 1) {
        showStageNotice('At least one stage tab must remain.')
        return
      }
      const currentIndex = state.stageTabs.findIndex((tab) => tab.id === state.activeStageTabId)
      state.stageTabs = state.stageTabs.filter((tab) => tab.id !== state.activeStageTabId)
      state.activeStageTabId = state.stageTabs[Math.max(0, currentIndex - 1)]?.id || state.stageTabs[0]?.id || 'stage-1'
      updateStageTabsUI?.()
      queueEditorStateSave?.()
      return
    }
    const stageTab = e.target.closest('[data-stage-tab]')
    if (stageTab) {
      state.activeStageTabId = stageTab.dataset.stageTab || state.activeStageTabId
      updateStageTabsUI?.()
      queueEditorStateSave?.()
      return
    }
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
      queueEditorStateSave?.()
      return
    }
    const selectObject = e.target.closest('[data-select-object]')
    if (selectObject) {
      state.selectedEditorObject = selectObject.dataset.selectObject || state.selectedEditorObject
      getViewportController()?.update?.({ selectedObjectKey: state.selectedEditorObject })
      updateStageInspectorSelection()
      updateInspectorUI()
      updateEditorModeUI()
      queueEditorStateSave?.()
      return
    }
    const rail = e.target.closest('[data-rail-section]')
    if (rail) { state.activeStageSection = rail.dataset.railSection || 'home'; updateRailUI(); updateLeftPanelUI(); queueEditorStateSave?.(); return }
    const vm = e.target.closest('[data-view-mode]')
    if (vm) {
      state.viewportMode = vm.dataset.viewMode || 'perspective3d'
      localStorage.setItem('stageViewportMode', state.viewportMode)
      getViewportController()?.update?.({ viewportMode: state.viewportMode })
      updateViewportControlUI()
      updateLeftPanelUI()
      updateEditorModeUI()
      queueEditorStateSave?.()
      return
    }
    const grid = e.target.closest('[data-toggle-grid]')
    if (grid) {
      state.gridEnabled = !state.gridEnabled
      getViewportController()?.update?.({ showGrid: state.gridEnabled })
      updateViewportControlUI()
      updateLeftPanelUI()
      updateEditorModeUI()
      queueEditorStateSave?.()
      return
    }
    const beam = e.target.closest('[data-toggle-beam]')
    if (beam) {
      state.beamPreviewEnabled = !state.beamPreviewEnabled
      getViewportController()?.update?.({ showBeams: state.beamPreviewEnabled })
      updateViewportControlUI()
      updateLeftPanelUI()
      queueEditorStateSave?.()
      return
    }
    const openExport = e.target.closest('[data-open-export]')
    if (openExport) { state.showExportPreview = true; updateExportPreview(); return }
    const closeExport = e.target.closest('[data-close-export]')
    if (closeExport) { state.showExportPreview = false; updateExportPreview(); return }
    const exportJson = e.target.closest('[data-export-json]')
    if (exportJson) {
      downloadText(`${state.editorProject?.title || 'stage-plan'}.json`.replace(/[^a-z0-9._-]+/gi, '-'), JSON.stringify(state.editorProject || {}, null, 2), 'application/json')
      showStageNotice?.('StagePlan JSON exported.')
      return
    }
    const exportSvg = e.target.closest('[data-export-svg]')
    if (exportSvg) {
      const svg = app.querySelector('[data-stage-plot-svg]')?.outerHTML || ''
      if (!svg) showStageNotice?.('No stage plot SVG available.')
      else downloadText(`${state.editorProject?.title || 'stage-plot'}.svg`.replace(/[^a-z0-9._-]+/gi, '-'), svg, 'image/svg+xml')
      return
    }
    const snap = e.target.closest('[data-toggle-snap]')
    if (snap) { state.snapEnabled = !state.snapEnabled; getViewportController()?.update?.({ snapEnabled: state.snapEnabled, snapInterval: state.snapInterval }); updateViewportControlUI(); updateLeftPanelUI(); updateEditorModeUI(); queueEditorStateSave?.(); return }
    const measure = e.target.closest('[data-toggle-measure]')
    if (measure) { state.measureModeEnabled = !state.measureModeEnabled; updateViewportControlUI(); showStageNotice('Measurement is preview mode only.'); queueEditorStateSave?.(); return }
    const inspectorTab = e.target.closest('[data-inspector-tab]')
    if (inspectorTab) { state.activeInspectorTab = inspectorTab.dataset.inspectorTab || 'properties'; updateInspectorUI(); queueEditorStateSave?.(); return }
    const dataTab = e.target.closest('[data-data-tab]')
    if (dataTab) { state.activeDataTab = dataTab.dataset.dataTab || 'schema'; updateEditorModeUI(); queueEditorStateSave?.() }
    const renderMode = e.target.closest('[data-render-mode]')
    if (renderMode) {
      state.renderMode = renderMode.dataset.renderMode || 'technical'
      getViewportController()?.update?.({ renderMode: state.renderMode })
      updateViewportControlUI()
      updateEditorModeUI()
      queueEditorStateSave?.()
    }
  })

  app.addEventListener('input', (e) => {
    const dimension = e.target.closest('[data-stage-dimension]')
    if (dimension) {
      if (updateStageDimension(dimension.dataset.stageDimension, dimension.value)) {
        refreshStageViewport?.()
        updateEditorModeUI?.()
        queueStagePlanSave?.()
      }
      return
    }
    const projectNotes = e.target.closest('[data-project-notes]')
    if (projectNotes && state.editorProject) {
      state.editorProject.notes = projectNotes.value
      queueStagePlanSave?.()
      return
    }
    const audioField = e.target.closest('[data-audio-input-field]')
    if (audioField) {
      if (updateProductionRow('audioInputs', audioField.dataset.rowId, audioField.dataset.audioInputField, audioField.value)) queueStagePlanSave?.()
      return
    }
    const fixtureField = e.target.closest('[data-fixture-field]')
    if (fixtureField) {
      if (updateProductionRow('fixtures', fixtureField.dataset.rowId, fixtureField.dataset.fixtureField, fixtureField.value)) {
        queueStagePlanSave?.()
        if (['address', 'universe', 'type', 'name'].includes(fixtureField.dataset.fixtureField)) updateInspectorUI?.()
      }
      return
    }
    const snapInterval = e.target.closest('[data-snap-interval]')
    if (snapInterval) {
      const next = Number(snapInterval.value)
      if (Number.isFinite(next) && next > 0) {
        state.snapInterval = next
        getViewportController()?.update?.({ snapEnabled: state.snapEnabled, snapInterval: state.snapInterval })
        updateEditorModeUI()
        queueEditorStateSave?.()
      }
      return
    }
    const f = e.target.closest('[data-transform-field]')
    if (!f) return
    const key = state.selectedEditorObject
    const existing = state.editorObjectTransforms[key] || {}
    const v = f.type === 'number' ? Number(f.value) : f.type === 'checkbox' ? !!f.checked : f.value
    updateSelectedStageObjectField(f.dataset.transformField, v)
    state.editorObjectTransforms = { ...state.editorObjectTransforms, [key]: { ...existing, [f.dataset.transformField]: v } }
    getViewportController()?.update?.({ objectTransforms: state.editorObjectTransforms })
    if (['label', 'visible', 'locked', 'notes', 'layer', 'color', 'width', 'depth', 'height'].includes(f.dataset.transformField)) {
      refreshStageViewport?.()
    }
    updateEditorModeUI()
    queueStagePlanSave?.()
  })

  app.addEventListener('change', (e) => {
    const dimension = e.target.closest('[data-stage-dimension]')
    if (dimension) {
      if (updateStageDimension(dimension.dataset.stageDimension, dimension.value)) {
        refreshStageViewport?.()
        updateEditorModeUI?.()
        queueStagePlanSave?.()
      }
      return
    }
    const audioField = e.target.closest('[data-audio-input-field]')
    if (audioField) {
      if (updateProductionRow('audioInputs', audioField.dataset.rowId, audioField.dataset.audioInputField, audioField.value)) {
        updateEditorModeUI?.()
        queueStagePlanSave?.()
      }
      return
    }
    const fixtureField = e.target.closest('[data-fixture-field]')
    if (fixtureField) {
      if (updateProductionRow('fixtures', fixtureField.dataset.rowId, fixtureField.dataset.fixtureField, fixtureField.value)) {
        refreshStageViewport?.()
        updateEditorModeUI?.()
        updateInspectorUI?.()
        queueStagePlanSave?.()
      }
      return
    }
    const changedTransform = e.target.closest('[data-transform-field]')
    if (changedTransform) {
      const key = state.selectedEditorObject
      const existing = state.editorObjectTransforms[key] || {}
      const v = changedTransform.type === 'number' ? Number(changedTransform.value) : changedTransform.type === 'checkbox' ? !!changedTransform.checked : changedTransform.value
      updateSelectedStageObjectField(changedTransform.dataset.transformField, v)
      state.editorObjectTransforms = { ...state.editorObjectTransforms, [key]: { ...existing, [changedTransform.dataset.transformField]: v } }
      getViewportController()?.update?.({ objectTransforms: state.editorObjectTransforms })
      if (['label', 'visible', 'locked', 'notes', 'layer', 'color', 'width', 'depth', 'height'].includes(changedTransform.dataset.transformField)) refreshStageViewport?.()
      updateEditorModeUI()
      queueStagePlanSave?.()
      return
    }
    const labels = e.target.closest('[data-toggle-labels]')
    if (labels) { state.showStageLabels = !!labels.checked; getViewportController()?.update?.({ showLabels: state.showStageLabels }); queueEditorStateSave?.(); return }
    const gridControl = e.target.closest('[data-toggle-grid-control]')
    if (gridControl) {
      state.gridEnabled = !!gridControl.checked
      getViewportController()?.update?.({ showGrid: state.gridEnabled })
      updateViewportControlUI()
      updateEditorModeUI()
      queueEditorStateSave?.()
      return
    }
    const beamControl = e.target.closest('[data-toggle-beam-control]')
    if (beamControl) {
      state.beamPreviewEnabled = !!beamControl.checked
      getViewportController()?.update?.({ showBeams: state.beamPreviewEnabled })
      updateViewportControlUI()
      queueEditorStateSave?.()
      return
    }
    const defaultView = e.target.closest('[data-default-view-mode]')
    if (defaultView) {
      state.viewportMode = defaultView.value || 'perspective3d'
      localStorage.setItem('stageViewportMode', state.viewportMode)
      getViewportController()?.update?.({ viewportMode: state.viewportMode })
      updateViewportControlUI()
      updateEditorModeUI()
      queueEditorStateSave?.()
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
    updateStageAppMenu()
    queueEditorStateSave?.()
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
      queueEditorStateSave?.()
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  })

  document.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName?.toLowerCase?.()
    const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target?.isContentEditable
    if (!typing && !e.defaultPrevented) {
      const nudgeBase = e.shiftKey ? 2 : e.altKey ? 0.25 : state.snapEnabled ? state.snapInterval : 0.5
      const axis = { ArrowLeft: ['x', -nudgeBase], ArrowRight: ['x', nudgeBase], ArrowUp: ['z', -nudgeBase], ArrowDown: ['z', nudgeBase], PageUp: ['y', nudgeBase], PageDown: ['y', -nudgeBase] }[e.key]
      if (axis) {
        e.preventDefault()
        const moved = moveSelectedStageObject({ [axis[0]]: axis[1] })
        syncObjectSurfaces({ save: moved, notice: moved ? '' : 'Locked object cannot move.' })
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const ok = e.shiftKey ? redoStageEdit() : undoStageEdit()
        syncObjectSurfaces({ refreshViewport: true, save: ok, notice: ok ? (e.shiftKey ? 'Redo.' : 'Undo.') : 'Nothing to undo.' })
        return
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        const copy = duplicateSelectedStageObject()
        syncObjectSurfaces({ refreshViewport: true, save: !!copy, notice: copy ? `Duplicated ${copy.label || copy.name}.` : 'Select an object to duplicate.' })
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        const deleted = deleteSelectedStageObject()
        syncObjectSurfaces({ refreshViewport: true, save: deleted, notice: deleted ? 'Deleted selected object.' : 'Protected objects cannot be deleted.' })
        return
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault()
        getViewportController()?.focusSelected?.()
        showStageNotice?.('Focused selected object.')
        return
      }
      if (e.key.toLowerCase() === 'a') {
        e.preventDefault()
        getViewportController()?.frameAll?.()
        showStageNotice?.('Framed full stage.')
        return
      }
      if (e.key.toLowerCase() === 'r') {
        e.preventDefault()
        const rotated = rotateSelectedStageObject(e.shiftKey ? -15 : 15)
        syncObjectSurfaces({ save: rotated, notice: rotated ? 'Rotated selected object.' : 'Locked object cannot rotate.' })
        return
      }
    }
    if (e.key === 'Escape' && state.stageAppMenuOpen) {
      state.stageAppMenuOpen = false
      updateStageAppMenu()
    }
  })
}
