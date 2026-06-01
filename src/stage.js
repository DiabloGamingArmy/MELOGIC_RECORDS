import './styles/base.css'
import './styles/stage.css'
import { initShellChrome } from './components/assetChrome'
import { navShell } from './components/navShell'
import { waitForInitialAuthState, subscribeToAuthState, subscribeToIdToken } from './firebase/auth'
import { authRoute, ROUTES, stageProjectRoute } from './utils/routes'
import { getStorageAssetCandidates } from './firebase/storageAssets'
import { STAGE_PROJECTS_COLLECTION, classifyStageProjectError, createStageProject, createStageProjectFromPlan, getStageProject, isValidStageProjectId, listAccessibleStageProjects, saveStageProjectEditorState, saveStageProjectPlan, sortStageProjectsByActivity, stageProjectPath, touchStageProject } from './data/stageProjectService'
import { renderBottomSplit } from './stage/bottomPanel/bottomPanel'
import { bindDashboardEvents, bindStageEditorEventsOnce } from './stage/app/stageEvents'
import { renderDashboard } from './stage/app/stageDashboard'
import { renderEditor, renderStageTabbar } from './stage/app/stageEditorRender'
import { editorTitleStamp, getCurrentStageProjectId, isSimpleEditableStageObject, moveSelectedStageObject, projectDate, setSelectedStageObjects, stageIconPath, stageTypes, state, updateSelectedStageObjectField } from './stage/app/stageState'
import { renderExportPreview } from './stage/export/exportPreview'
import { renderInspectorTabs, selectedEditorObjectMarkup } from './stage/inspector/inspectorTabs'
import { renderLeftPanelBySection } from './stage/panels/leftPanels'
import { mountStageThreeViewport } from './stage/stageThreeViewport'
import { isOldDemoFallbackPlan, migrateDefaultFallbackPlan, normalizeStagePlan } from './stage/stagePlanModel'

const app = document.querySelector('#app')

let stageViewportController = null
let stageEditorMounted = false
let stageIconHydrationPromise = null
let stageViewportMountedForProjectId = ''
let stageNoticeTimer = 0
let editorSaveTimer = 0
let planSaveTimer = 0
let activeProjectLoadRequest = 0
let lastLoadedProjectId = ''
let lastLoadedAuthUid = ''
const loggedProjectLoadFailures = new Set()
const authRecoverableProjectStatuses = new Set(['auth-restoring', 'unauthenticated', 'permission-denied', 'fallback-local', 'fallback-default', 'not-found', 'network-error', 'rules-error'])

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

function stageCreateErrorMessage(error) {
  const kind = classifyStageProjectError(error, state.user)
  if (kind === 'unauthenticated') return 'Please sign in to create a stage plan.'
  if (kind === 'permission-denied') return 'Stage creation is blocked by Firestore permissions. Your work was not saved to the cloud.'
  if (kind === 'network-error') return 'Network/Firebase connection failed. Try again.'
  return 'Could not create stage plan.'
}

function canonicalizeLegacyStageRoute() {
  const pathname = window.location.pathname || ''
  if (pathname === ROUTES.stage) {
    window.location.replace(`${ROUTES.studioStagemaker}${window.location.search || ''}${window.location.hash || ''}`)
    return true
  }
  if (pathname.startsWith(`${ROUTES.stage}/`)) {
    const projectId = decodeURIComponent(pathname.replace(`${ROUTES.stage}/`, '').split('/')[0] || '').trim()
    if (!projectId) return false
    window.history.replaceState({}, '', `${stageProjectRoute(projectId)}${window.location.search || ''}${window.location.hash || ''}`)
  }
  return false
}

function editorRecoveryKey(projectId = state.projectId) {
  return `melogic.stage.editorState.${projectId || 'draft'}`
}

function stagePlanRecoveryKey(projectId = state.projectId) {
  return `melogic.stage.plan.${projectId || 'draft'}`
}

function normalizeEditorMode(mode) {
  if (mode === 'builder') return 'entities'
  if (mode === 'lighting-plot') return 'lighting-patch'
  if (mode === 'rigging-plan') return 'rigging'
  return mode || 'entities'
}

function buildEditorStateSnapshot() {
  return {
    viewportMode: state.viewportMode,
    paneSizes: { ...state.paneSizes },
    activeLayer: 'stage',
    activeStageSection: state.activeStageSection,
    activeLibraryCategory: state.activeLibraryCategory,
    objectLibrarySearch: state.objectLibrarySearch,
    editorToolMode: state.editorToolMode,
    stageInteractionMode: state.stageInteractionMode,
    activeEditorMode: normalizeEditorMode(state.activeEditorMode),
    activeInspectorTab: state.activeInspectorTab,
    activeDataTab: state.activeDataTab,
    renderMode: state.renderMode,
    selectedObjectId: state.selectedEditorObject,
    selectedObjectIds: state.selectedEditorObjects,
    showGrid: state.gridEnabled,
    snapEnabled: state.snapEnabled,
    snapInterval: state.snapInterval,
    showLabels: state.showStageLabels,
    showBeams: state.beamPreviewEnabled,
    showViewportDiagnostics: state.showViewportDiagnostics,
    stageTabs: state.stageTabs,
    activeStageTabId: state.activeStageTabId,
    objectTransforms: state.editorObjectTransforms,
    savedAt: new Date().toISOString()
  }
}

function applyEditorStateSnapshot(editorState = {}) {
  if (!editorState || typeof editorState !== 'object') return
  state.viewportMode = editorState.viewportMode || state.viewportMode
  state.paneSizes = { ...state.paneSizes, ...(editorState.paneSizes || {}) }
  state.activeStageSection = editorState.activeStageSection || state.activeStageSection
  state.activeLibraryCategory = editorState.activeLibraryCategory || state.activeLibraryCategory
  state.objectLibrarySearch = typeof editorState.objectLibrarySearch === 'string' ? editorState.objectLibrarySearch : state.objectLibrarySearch
  state.editorToolMode = editorState.editorToolMode || state.editorToolMode
  state.stageInteractionMode = editorState.stageInteractionMode === 'edit' ? 'edit' : 'object'
  state.activeEditorMode = normalizeEditorMode(editorState.activeEditorMode || state.activeEditorMode)
  state.activeInspectorTab = editorState.activeInspectorTab || state.activeInspectorTab
  state.activeDataTab = editorState.activeDataTab || state.activeDataTab
  state.renderMode = editorState.renderMode || state.renderMode
  state.selectedEditorObject = editorState.selectedObjectId || state.selectedEditorObject
  state.selectedEditorObjects = Array.isArray(editorState.selectedObjectIds) && editorState.selectedObjectIds.length
    ? editorState.selectedObjectIds
    : [state.selectedEditorObject].filter(Boolean)
  state.gridEnabled = typeof editorState.showGrid === 'boolean' ? editorState.showGrid : state.gridEnabled
  state.snapEnabled = typeof editorState.snapEnabled === 'boolean' ? editorState.snapEnabled : state.snapEnabled
  state.snapInterval = Number(editorState.snapInterval) || state.snapInterval
  state.showStageLabels = typeof editorState.showLabels === 'boolean' ? editorState.showLabels : state.showStageLabels
  state.beamPreviewEnabled = typeof editorState.showBeams === 'boolean' ? editorState.showBeams : state.beamPreviewEnabled
  state.showViewportDiagnostics = typeof editorState.showViewportDiagnostics === 'boolean' ? editorState.showViewportDiagnostics : state.showViewportDiagnostics
  state.editorObjectTransforms = editorState.objectTransforms && typeof editorState.objectTransforms === 'object' ? editorState.objectTransforms : state.editorObjectTransforms
  if (Array.isArray(editorState.stageTabs) && editorState.stageTabs.length) state.stageTabs = editorState.stageTabs
  state.activeStageTabId = editorState.activeStageTabId || state.activeStageTabId
  if (editorState.savedAt) state.lastSavedAt = editorState.savedAt
}

function ensureValidEditorSelection() {
  const requested = state.selectedEditorObjects?.length ? state.selectedEditorObjects : [state.selectedEditorObject]
  const normalized = setSelectedStageObjects(requested, state.selectedEditorObject)
  if (!normalized.length && (state.editorProject?.objects || []).length) {
    const first = state.editorProject.objects.find((object) => object.id === 'stage-deck') || state.editorProject.objects[0]
    setSelectedStageObjects([first.id], first.id)
  }
  if (state.stageInteractionMode === 'edit' && !isSimpleEditableStageObject(findStageObjectLocal())) {
    state.stageInteractionMode = 'object'
  }
}

function findStageObjectLocal() {
  return (state.editorProject?.objects || []).find((object) => object.id === state.selectedEditorObject || object.key === state.selectedEditorObject)
}

function restoreLocalEditorState(projectId = state.projectId) {
  try {
    const raw = localStorage.getItem(editorRecoveryKey(projectId))
    if (!raw) return false
    const snapshot = JSON.parse(raw)
    applyEditorStateSnapshot(snapshot)
    state.editorSaveStatus = 'local'
    state.lastSavedAt = snapshot.savedAt || state.lastSavedAt
    return true
  } catch {
    return false
  }
}

function restoreLocalStagePlan(projectId = state.projectId) {
  try {
    const raw = localStorage.getItem(stagePlanRecoveryKey(projectId))
    if (!raw) return false
    const snapshot = JSON.parse(raw)
    const plan = snapshot?.plan || snapshot
    if (!plan || typeof plan !== 'object') return false
    const migratedOldDemo = isOldDemoFallbackPlan(plan)
    state.editorProject = migratedOldDemo
      ? migrateDefaultFallbackPlan(plan, { id: projectId || plan.id || state.projectId, name: plan.title || plan.name || 'Fallback Stage Plan' })
      : normalizeStagePlan({ ...plan, id: projectId || plan.id || state.projectId })
    ensureValidEditorSelection()
    if (migratedOldDemo) {
      state.projectLoadMessage = 'Old demo fallback was reset to a clean stage.'
      try { localStorage.setItem(stagePlanRecoveryKey(projectId), JSON.stringify({ plan: state.editorProject, savedAt: new Date().toISOString(), migratedFromDemoFallback: true })) } catch {}
    }
    state.editorSaveStatus = 'local'
    state.lastSavedAt = snapshot.savedAt || state.lastSavedAt
    return true
  } catch {
    return false
  }
}

function persistLocalEditorState(snapshot = buildEditorStateSnapshot()) {
  try { localStorage.setItem(editorRecoveryKey(), JSON.stringify(snapshot)) } catch {}
}

function disposeViewportController() {
  stageViewportController?.dispose?.()
  stageViewportController = null
  stageViewportMountedForProjectId = ''
}

function initStageEditorViewport() {
  disposeViewportController()
  if (!state.projectId || state.editorLoading || state.editorError) return
  const container = app.querySelector('[data-stage-three-viewport]')
  if (!container) return
  stageViewportController = mountStageThreeViewport(container, {
    project: state.editorProject,
    projectLoadStatus: state.projectLoadStatus,
    projectLoadMessage: state.projectLoadMessage,
    showDiagnostics: state.showViewportDiagnostics,
    selectedObjectKey: state.selectedEditorObject,
    selectedObjectKeys: state.selectedEditorObjects,
    objectTransforms: state.editorObjectTransforms,
    toolMode: state.editorToolMode,
    interactionMode: state.stageInteractionMode,
    onSelectObjects: (keys = [], primary = '') => {
      setSelectedStageObjects(keys, primary)
      ensureInteractionModeMatchesSelection()
      updateStageInspectorSelection()
      updateInspectorUI()
      updateEditorModeUI()
      updateViewportControlUI()
      queueEditorStateSave()
    },
    onSelectObject: (key) => {
      if (state.selectedEditorObject === key) return
      setSelectedStageObjects([key], key)
      ensureInteractionModeMatchesSelection()
      updateStageInspectorSelection()
      updateInspectorUI()
      updateEditorModeUI()
      updateViewportControlUI()
      queueEditorStateSave()
    },
    onTransformObject: (key, transform) => {
      setSelectedStageObjects([key], key)
      state.editorObjectTransforms = { ...(state.editorObjectTransforms || {}), [key]: { ...(state.editorObjectTransforms?.[key] || {}), ...transform } }
      if ([transform.x, transform.y, transform.z].some(Number.isFinite)) {
        moveSelectedStageObject({ x: transform.x, y: transform.y, z: transform.z }, { absolute: true })
      } else {
        if (Number.isFinite(transform.rotY)) updateSelectedStageObjectField('rotY', transform.rotY)
      }
      ;['width', 'depth', 'height'].forEach((field) => {
        if (Number.isFinite(transform[field])) updateSelectedStageObjectField(field, transform[field])
      })
      updateInspectorUI()
      updateEditorModeUI()
      updateViewportControlUI()
      queueStagePlanSave()
    },
    viewportMode: state.viewportMode,
    renderMode: state.renderMode,
    showGrid: state.gridEnabled,
    showBeams: state.beamPreviewEnabled,
    showLabels: state.showStageLabels,
    snapEnabled: state.snapEnabled,
    snapInterval: state.snapInterval
  })
  if (stageViewportController) stageViewportMountedForProjectId = state.projectId
}

function updateSaveStatusUI() {
  const target = app.querySelector('[data-stage-save-status]')
  if (!target) return
  const saveErrorCode = String(state.editorSaveErrorCode || state.editorSaveError || '').toLowerCase()
  const saveErrorLabel = saveErrorCode.includes('permission-denied') || saveErrorCode.includes('permissions')
    ? 'permission denied'
    : state.editorSaveError
      ? 'see details'
      : ''
  const label = state.editorSaveStatus === 'saving'
    ? 'Saving...'
    : state.editorSaveStatus === 'saved'
      ? `Saved${state.lastSavedAt ? ` ${new Date(state.lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
      : state.editorSaveStatus === 'failed'
        ? `Save failed${saveErrorLabel ? ` — ${saveErrorLabel}` : ''}`
        : state.editorSaveStatus === 'local'
          ? state.projectLoadStatus === 'fallback-local' ? 'Local recovery active' : 'Local fallback active'
          : state.editorSaveStatus === 'unsaved'
            ? 'Unsaved changes'
            : 'Ready'
  target.textContent = label
  target.dataset.saveStatus = state.editorSaveStatus || 'idle'
  target.title = state.editorSaveStatus === 'failed'
    ? (saveErrorLabel === 'permission denied'
        ? 'Your changes are stored locally. Firestore rules may need deployment.'
        : (state.editorSaveError || 'Your changes are stored locally and will retry on the next save.'))
    : ''
}

async function flushEditorStateSave() {
  if (!state.projectId || !state.editorProject) return
  const snapshot = buildEditorStateSnapshot()
  persistLocalEditorState(snapshot)
  if (state.projectLoadStatus !== 'loaded') {
    state.editorSaveStatus = 'local'
    state.lastSavedAt = snapshot.savedAt
    updateSaveStatusUI()
    return
  }
  state.editorSaveStatus = 'saving'
  updateSaveStatusUI()
  try {
    await saveStageProjectEditorState(state.projectId, snapshot)
    state.editorSaveStatus = 'saved'
    state.editorSaveError = ''
    state.editorSaveErrorCode = ''
    state.lastSavedAt = snapshot.savedAt
  } catch (error) {
    state.editorSaveStatus = 'failed'
    state.editorSaveError = error?.message || 'Stage editor state could not be saved.'
    state.editorSaveErrorCode = error?.code || ''
    console.warn('[stage] editor state save failed; local recovery copy preserved.', error?.code || error?.message || error)
  }
  updateSaveStatusUI()
}

function queueEditorStateSave() {
  if (!state.projectId || !state.editorProject) return
  state.editorSaveStatus = state.projectLoadStatus === 'loaded' ? 'unsaved' : 'local'
  const snapshot = buildEditorStateSnapshot()
  persistLocalEditorState(snapshot)
  updateSaveStatusUI()
  window.clearTimeout(editorSaveTimer)
  editorSaveTimer = window.setTimeout(() => { flushEditorStateSave().catch(() => {}) }, 1800)
}

function persistLocalStagePlan() {
  try { localStorage.setItem(stagePlanRecoveryKey(), JSON.stringify({ plan: state.editorProject, savedAt: new Date().toISOString() })) } catch {}
}

async function flushStagePlanSave() {
  if (!state.projectId || !state.editorProject) return
  const snapshot = buildEditorStateSnapshot()
  persistLocalStagePlan()
  persistLocalEditorState(snapshot)
  if (state.projectLoadStatus !== 'loaded') {
    state.editorSaveStatus = 'local'
    state.lastSavedAt = snapshot.savedAt
    updateSaveStatusUI()
    return
  }
  state.editorSaveStatus = 'saving'
  updateSaveStatusUI()
  try {
    await saveStageProjectPlan(state.projectId, state.editorProject, snapshot)
    state.editorSaveStatus = 'saved'
    state.editorSaveError = ''
    state.editorSaveErrorCode = ''
    state.lastSavedAt = snapshot.savedAt
  } catch (error) {
    state.editorSaveStatus = 'failed'
    state.editorSaveError = error?.message || 'Stage plan could not be saved.'
    state.editorSaveErrorCode = error?.code || ''
    console.warn('[stage] plan save failed; local recovery copy preserved.', error?.code || error?.message || error)
  }
  updateSaveStatusUI()
}

function queueStagePlanSave() {
  if (!state.projectId || !state.editorProject) return
  state.editorSaveStatus = state.projectLoadStatus === 'loaded' ? 'unsaved' : 'local'
  persistLocalStagePlan()
  updateSaveStatusUI()
  window.clearTimeout(planSaveTimer)
  planSaveTimer = window.setTimeout(() => { flushStagePlanSave().catch(() => {}) }, 2000)
}

function ensureStageViewportMounted() {
  if (!state.projectId || state.editorLoading || state.editorError || !state.editorProject) return
  if (stageViewportController && stageViewportMountedForProjectId === state.projectId) return
  initStageEditorViewport()
}

function refreshStageViewport() {
  if (!state.projectId || state.editorLoading || state.editorError || !state.editorProject) return
  initStageEditorViewport()
}

async function hydrateStageIcons() {
  const nodes = [...app.querySelectorAll('[data-stage-icon-path]')]
  await Promise.all(nodes.map(async (node) => {
    const path = node.dataset.stageIconPath
    if (!path || node.dataset.iconHydrated === 'true') return
    node.dataset.iconHydrated = 'true'
    const img = node.querySelector('img')
    if (!img) return
    const candidates = await getStorageAssetCandidates(path, { warnOnFail: false })
    const fallback = node.querySelector('.stage-rail-fallback, .stage-object-fallback-icon, span:not([class])')
    let index = 0
    const showFallback = () => {
      img.hidden = true
      node.classList.remove('has-stage-icon')
      fallback?.removeAttribute('hidden')
      if (import.meta.env.DEV) console.warn('[stage-icons] missing icon path', path)
    }
    const tryNext = () => {
      const url = candidates[index]
      index += 1
      if (!url) return showFallback()
      img.onload = () => {
        img.hidden = false
        node.classList.add('has-stage-icon')
        fallback?.setAttribute('hidden', 'hidden')
      }
      img.onerror = tryNext
      img.src = url
    }
    tryNext()
  }))
}

function hydrateStageIconsOnce() {
  if (stageIconHydrationPromise) return stageIconHydrationPromise
  stageIconHydrationPromise = hydrateStageIcons()
  return stageIconHydrationPromise
}

function refreshStageIcons() {
  hydrateStageIcons().catch(() => {})
}

function updateStageAppMenu() {
  const left = app.querySelector('.stage-editor-menu-left')
  if (!left) return
  const existing = left.querySelector('[data-stage-app-menu-panel]')
  existing?.remove()
  if (!state.stageAppMenuOpen) return
  left.insertAdjacentHTML('beforeend', `<div class="stage-editor-app-menu-panel" data-stage-app-menu-panel><a href="${ROUTES.studioStagemaker}">Back to StageMaker</a><a href="${ROUTES.studio}">Back to Studio</a><button type="button" aria-disabled="true">Asset Library</button><button type="button" aria-disabled="true">Exports</button><label class="stage-menu-check"><input type="checkbox" data-toggle-main-header ${state.showStageGlobalHeader ? 'checked' : ''}> Show site-wide header</label></div>`)
}

function updateExportPreview() {
  app.querySelector('.stage-export-modal')?.remove()
  if (!state.showExportPreview) return
  app.querySelector('[data-stage-editor-app]')?.insertAdjacentHTML('beforeend', renderExportPreview())
}

function showStageNotice(message) {
  const viewport = app.querySelector('.stage-editor-canvas')
  if (!viewport) return
  let notice = viewport.querySelector('[data-stage-notice]')
  if (!notice) {
    notice = document.createElement('div')
    notice.className = 'stage-viewport-notice'
    notice.dataset.stageNotice = 'true'
    viewport.appendChild(notice)
  }
  notice.textContent = message
  notice.hidden = false
  window.clearTimeout(stageNoticeTimer)
  stageNoticeTimer = window.setTimeout(() => { notice.hidden = true }, 2200)
}

function updateRailUI() {
  app.querySelectorAll('[data-rail-section]').forEach((el) => el.classList.toggle('is-active', (el.dataset.railSection || '') === state.activeStageSection))
}

function updateLeftPanelUI() {
  const current = app.querySelector('.stage-editor-library')
  if (!current) return
  const { title, stamp } = editorTitleStamp()
  current.outerHTML = renderLeftPanelBySection(title, stamp)
  updateLibraryActiveState()
  refreshStageIcons()
}

function updateInspectorUI() {
  const current = app.querySelector('.stage-editor-right')
  if (!current) return
  const { title, stamp } = editorTitleStamp()
  current.outerHTML = renderInspectorTabs(title, stamp)
}

function selectedViewportObject() {
  return (state.editorProject?.objects || []).find((object) => object.id === state.selectedEditorObject || object.key === state.selectedEditorObject)
}

function ensureInteractionModeMatchesSelection() {
  if (state.stageInteractionMode !== 'edit') return
  if (isSimpleEditableStageObject(selectedViewportObject())) return
  state.stageInteractionMode = 'object'
  try { localStorage.setItem('stageInteractionMode', state.stageInteractionMode) } catch {}
  stageViewportController?.update?.({ interactionMode: state.stageInteractionMode })
}

function viewportHintText() {
  const selected = selectedViewportObject()
  if (state.stageInteractionMode === 'edit') return 'Edit Mode: drag corner or edge handles to resize. Tab returns to Object Mode.'
  if (selected?.locked) return 'Selected object is locked. Unlock it in Properties before moving.'
  if (state.editorToolMode === 'pan') return 'Pan: drag to move camera · wheel zoom'
  if (state.editorToolMode === 'select') return 'Select: click object · drag box to select'
  if (state.editorToolMode === 'move') return 'Move: drag selected object · arrows nudge · Shift = large'
  if (state.editorToolMode === 'rotate') return 'Rotate: drag or use rotate buttons'
  if (state.editorToolMode === 'scale') return 'Scale: use handles or Properties dimensions'
  if (state.viewportMode === 'top2d') return 'Top: drag box to select · switch to Move to place objects'
  if (state.viewportMode === 'front' || state.viewportMode === 'side') return 'Elevation: pan · zoom · F focus · A frame all'
  return '3D: orbit drag · pan right-drag · wheel zoom · choose Move to drag'
}

function updateViewportControlUI() {
  app.querySelectorAll('[data-view-mode]').forEach((el) => el.classList.toggle('is-active-view', (el.dataset.viewMode || '') === state.viewportMode))
  app.querySelectorAll('[data-tool-mode]').forEach((el) => {
    const active = (el.dataset.toolMode || '') === state.editorToolMode
    el.classList.toggle('is-active', active)
    el.setAttribute('aria-pressed', String(active))
  })
  const grid = app.querySelector('[data-toggle-grid]')
  if (grid) {
    grid.classList.toggle('is-active', state.gridEnabled)
    grid.textContent = `Grid ${state.gridEnabled ? 'On' : 'Off'}`
  }
  const beam = app.querySelector('[data-toggle-beam]')
  if (beam) beam.classList.toggle('is-active', state.beamPreviewEnabled)
  const snap = app.querySelector('[data-toggle-snap]')
  if (snap) {
    snap.classList.toggle('is-active', state.snapEnabled)
    snap.textContent = `Snap ${state.snapEnabled ? 'On' : 'Off'}`
  }
  const measure = app.querySelector('[data-toggle-measure]')
  if (measure) measure.classList.toggle('is-active', state.measureModeEnabled)
  const toolStatus = app.querySelector('[data-stage-tool-status]')
  if (toolStatus) toolStatus.textContent = `Tool: ${state.editorToolMode.charAt(0).toUpperCase()}${state.editorToolMode.slice(1)}`
  const modeStatus = app.querySelector('[data-stage-mode-status]')
  if (modeStatus) {
    const edit = state.stageInteractionMode === 'edit'
    modeStatus.textContent = edit ? 'Edit Mode' : 'Object Mode'
    modeStatus.classList.toggle('is-edit', edit)
  }
  app.querySelectorAll('[data-render-mode]').forEach((el) => el.classList.toggle('is-active', (el.dataset.renderMode || '') === state.renderMode))
  const hint = app.querySelector('.stage-viewport-status-stack .stage-three-hint')
  if (hint) hint.textContent = viewportHintText()
  const selected = selectedViewportObject()
  const pill = app.querySelector('.stage-viewport-selected-pill')
  if (pill) {
    const count = state.selectedEditorObjects?.length || (selected ? 1 : 0)
    pill.textContent = count > 1
      ? `Selected: ${count} objects · primary ${selected?.label || selected?.name || selected?.id || 'object'}`
      : selected ? `Selected: ${selected.label || selected.name || selected.id} · ${selected.category || selected.type || 'object'} · ${selected.locked ? 'locked' : 'unlocked'}` : 'No object selected'
  }
}

function updateEditorModeUI() {
  app.querySelectorAll('[data-editor-mode]').forEach((el) => {
    const active = (el.dataset.editorMode || '') === state.activeEditorMode
    el.classList.toggle('is-active', active)
    el.setAttribute('aria-selected', String(active))
  })
  const root = app.querySelector('[data-stage-mode-root]')
  if (!root) return
  root.innerHTML = renderBottomSplit()
}

function updateStageTabsUI() {
  const current = app.querySelector('.stage-editor-tabbar')
  if (!current) return
  current.outerHTML = renderStageTabbar()
}

function updateLibraryActiveState() {
  app.querySelectorAll('[data-library-category]').forEach((el) => el.classList.toggle('is-active', (el.dataset.libraryCategory || '') === state.activeLibraryCategory))
}

function updateStageInspectorSelection() {
  const target = app.querySelector('[data-stage-selected-readout]')
  if (target) target.innerHTML = selectedEditorObjectMarkup()
}

function updateEditorProjectHeader() {
  const title = state.editorProject?.title || 'Untitled Stage Plan'
  const stamp = (projectDate(state.editorProject) || new Date()).toLocaleDateString()
  const version = state.editorProject?.version || 1
  const stageType = state.editorProject?.stageType || 'Blank Stage'
  const titleNode = app.querySelector('[data-stage-project-title]')
  const versionNode = app.querySelector('[data-stage-project-version]')
  const infoTitleNode = app.querySelector('[data-stage-project-info-title]')
  const infoTypeNode = app.querySelector('[data-stage-project-info-type]')
  const stageTypeNode = app.querySelector('[data-stage-type-label]')
  if (titleNode) titleNode.textContent = `Project: ${title}`
  if (versionNode) versionNode.textContent = `Date/Version ${stamp} | v${version}`
  if (infoTitleNode) infoTitleNode.textContent = title
  if (infoTypeNode) infoTypeNode.textContent = stageType
  if (stageTypeNode) stageTypeNode.textContent = stageType
}

function bindEditorEvents() {
  bindStageEditorEventsOnce({
    app,
    disposeViewportController,
    ensureStageViewportMounted,
    getViewportController: () => stageViewportController,
    showStageNotice,
    queueStagePlanSave,
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
    queueEditorStateSave,
    flushStagePlanSave,
    refreshStageViewport,
    loadEditorProject,
    saveCurrentPlanAsNew
  })
}

function renderApp() {
  if (!state.projectId) {
    disposeViewportController()
    stageEditorMounted = false
    stageIconHydrationPromise = null
    app.innerHTML = `${navShell({ currentPage: 'studio' })}${renderDashboard()}`
    initShellChrome()
    bindDashboardEvents({ app, renderCreateModal, openProject, loadDashboardProjects })
    return
  }
  const mounted = app.querySelector('[data-stage-editor-app]')
  if (!stageEditorMounted || !mounted) {
    app.innerHTML = `<div data-stage-global-header-wrapper ${state.showStageGlobalHeader ? '' : 'hidden'}>${navShell({ currentPage: 'studio' })}</div>${renderEditor()}`
    initShellChrome()
    bindEditorEvents()
    ensureStageViewportMounted()
    hydrateStageIconsOnce()
    stageEditorMounted = true
    updateEditorProjectHeader()
    updateSaveStatusUI()
    updateStageAppMenu()
    return
  }
  updateEditorProjectHeader()
  updateSaveStatusUI()
  updateRailUI()
  updateLeftPanelUI()
  updateInspectorUI()
  updateViewportControlUI()
  updateEditorModeUI()
  updateStageTabsUI()
  updateStageAppMenu()
  updateExportPreview()
  ensureStageViewportMounted()
}

function closeModal() {
  app.querySelector('[data-stage-modal-root]')?.replaceChildren()
  document.removeEventListener('keydown', onModalEscape)
}

function onModalEscape(e) {
  if (e.key === 'Escape') closeModal()
}

function renderCreateModal(loading = false, selectedStageType = 'Blank Stage', initialTitle = '') {
  const root = app.querySelector('[data-stage-modal-root]')
  if (!root) return
  if (loading) {
    root.innerHTML = '<div class="stage-modal"><div class="stage-modal-panel"><h3>Creating stage plan...</h3></div></div>'
    return
  }
  root.innerHTML = `<div class="stage-modal" data-modal-backdrop><form class="stage-modal-panel" data-stage-create-form><h3>New Stage Plan</h3><p class="stage-modal-help">Choose a starting format. You can change dimensions later.</p><div class="stage-modal-field"><label for="stage-project-name">Project name</label><input id="stage-project-name" name="title" required maxlength="120" placeholder="Name your stage plan" value="${esc(initialTitle)}" /></div><div class="stage-modal-field"><label for="stage-type">Stage type</label><select id="stage-type" name="stageType">${stageTypes.map((t) => `<option value="${esc(t)}" ${t === selectedStageType ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></div>${state.createError ? `<p class="stage-form-error">${esc(state.createError)}</p>` : ''}<div class="stage-modal-actions"><button class="button" type="submit">Create Stage Plan</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  document.addEventListener('keydown', onModalEscape)
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (e) => e.target === e.currentTarget && closeModal())
  root.querySelector('[data-close-modal]')?.addEventListener('click', closeModal)
  root.querySelector('[data-stage-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    state.createError = ''
    const fd = new FormData(e.currentTarget)
    const title = String(fd.get('title') || '').trim()
    const stageType = String(fd.get('stageType') || selectedStageType || 'Blank Stage').trim()
    renderCreateModal(true, stageType, title)
    try {
      const project = await createStageProject(state.user, { title, stageType })
      window.location.href = stageProjectRoute(project.id)
    } catch (error) {
      console.warn('[stage] create project failed', {
        code: error?.code || error?.name || '',
        message: error?.message || String(error || ''),
        uid: state.user?.uid || null,
        collectionPath: error?.collectionPath || STAGE_PROJECTS_COLLECTION,
        step: error?.stageCreateStep || 'create-stage-project'
      })
      state.createError = stageCreateErrorMessage(error)
      renderCreateModal(false, stageType, title)
    }
  })
}

async function openProject(projectId) {
  if (!projectId) return
  touchStageProject(projectId).catch(() => {})
  window.location.href = stageProjectRoute(projectId)
}

async function loadDashboardProjects() {
  if (!state.user?.uid || state.projectId) return
  state.loadingProjects = true
  state.projectsError = ''
  renderApp()
  try {
    const projects = await listAccessibleStageProjects(state.user.uid)
    const sorted = [...projects].sort(sortStageProjectsByActivity)
    state.projects = sorted
    state.recentProjects = sorted.slice(0, 6)
  } catch {
    state.projects = []
    state.recentProjects = []
    state.projectsError = 'load-failed'
  } finally {
    state.loadingProjects = false
    renderApp()
  }
}

function stageLoadMessage(status, meta = {}) {
  if (status === 'auth-restoring') return 'Restoring session...'
  if (status === 'loaded') return 'Stage project loaded from Firestore.'
  if (status === 'loading') return 'Loading stage project...'
  if (status === 'unauthenticated') return 'Sign in required to load this stage plan. Editing a local fallback copy.'
  if (status === 'permission-denied') return 'You do not have permission to open this stage plan. Editing a local fallback copy.'
  if (status === 'not-found') return 'Stage project was not found. Editing a default fallback stage.'
  if (status === 'network-error') return 'Network or Firestore connection failed. Editing local recovery.'
  if (status === 'rules-error') return 'Firestore rejected this Stage project shape. Editing local recovery.'
  if (status === 'fallback-local') return `${meta.reasonMessage || 'Project data could not be loaded.'} Editing local recovery.`
  if (status === 'fallback-default') return `${meta.reasonMessage || 'Project data could not be loaded.'} Editing default fallback stage.`
  return 'Project data could not be loaded. Editing fallback stage.'
}

function setStageLoadState(status, meta = {}) {
  state.projectLoadStatus = status
  state.projectLoadMeta = meta
  state.projectLoadErrorCode = meta.code || ''
  state.projectLoadMessage = stageLoadMessage(status, meta)
}

function logProjectLoadFailure(status, error, meta = {}) {
  if (status === 'unauthenticated' || status === 'auth-restoring') return
  const logKey = [state.projectId, state.user?.uid || 'anon', status, error?.code || meta.code || 'unknown'].join(':')
  if (loggedProjectLoadFailures.has(logKey)) return
  loggedProjectLoadFailures.add(logKey)
  console.warn('[stage] Firestore project load failed.', {
    projectId: state.projectId,
    collectionPath: stageProjectPath(state.projectId),
    currentUserUid: state.user?.uid || null,
    authStateLoaded: true,
    loadState: status,
    firestoreCode: error?.code || '',
    firestoreMessage: error?.message || String(error || ''),
    usingLocalRecovery: !!meta.usingLocalRecovery,
    projectIdMalformed: !isValidStageProjectId(state.projectId),
    fallbackMode: meta.fallbackMode || ''
  })
}

async function loadEditorProject({ reason = 'manual', force = false } = {}) {
  if (!state.projectId) return
  if (state.editorLoading && !force) return
  const requestId = ++activeProjectLoadRequest
  state.editorLoading = true
  state.editorError = ''
  setStageLoadState('loading')
  renderApp()
  const useDefaultFallback = (status, meta = {}) => {
    const restored = restoreLocalStagePlan(state.projectId)
    if (!restored) state.editorProject = normalizeStagePlan({ id: state.projectId, title: 'Fallback Stage Plan', stageType: 'Blank Stage', version: 1 })
    restoreLocalEditorState(state.projectId)
    ensureValidEditorSelection()
    disposeViewportController()
    const fallbackStatus = ['unauthenticated', 'permission-denied'].includes(status) ? status : restored ? 'fallback-local' : status
    setStageLoadState(fallbackStatus, { ...meta, reason, usingLocalRecovery: restored, fallbackMode: restored ? 'local' : 'default' })
    state.editorSaveStatus = 'local'
  }
  try {
    if (!isValidStageProjectId(state.projectId)) {
      useDefaultFallback('not-found', { code: 'invalid-project-id', reasonMessage: 'Stage project ID is malformed.' })
      logProjectLoadFailure('not-found', { code: 'invalid-project-id', message: 'Malformed project id.' }, state.projectLoadMeta || {})
      return
    }
    if (!state.user?.uid) {
      useDefaultFallback('unauthenticated', { code: 'auth-required', reasonMessage: 'Sign in required to load this private stage plan.' })
      logProjectLoadFailure('unauthenticated', { code: 'auth-required', message: 'No signed-in user.' }, state.projectLoadMeta || {})
      return
    }
    const project = await getStageProject(state.projectId)
    if (requestId !== activeProjectLoadRequest) return
    if (!project) {
      useDefaultFallback('not-found', { code: 'not-found', reasonMessage: 'Stage project was not found.' })
      logProjectLoadFailure('not-found', { code: 'not-found', message: 'No document exists at the stage project path.' }, state.projectLoadMeta || {})
    } else {
      state.editorProject = normalizeStagePlan({ ...project, id: project.id || state.projectId, name: project.title || project.name })
      applyEditorStateSnapshot(project.editorState || project.plan?.editorState)
      if (!project.editorState && !project.plan?.editorState) restoreLocalEditorState(state.projectId)
      ensureValidEditorSelection()
      disposeViewportController()
      setStageLoadState('loaded')
      lastLoadedProjectId = state.projectId
      lastLoadedAuthUid = state.user?.uid || ''
      state.editorSaveStatus = project.editorState ? 'saved' : 'idle'
      state.editorSaveError = ''
      state.editorSaveErrorCode = ''
    }
  } catch (error) {
    if (requestId !== activeProjectLoadRequest) return
    const status = classifyStageProjectError(error, state.user)
    useDefaultFallback(status, { code: error?.code || status, reasonMessage: stageLoadMessage(status), originalStatus: status })
    logProjectLoadFailure(state.projectLoadStatus, error, state.projectLoadMeta || {})
  } finally {
    if (requestId !== activeProjectLoadRequest) return
    state.editorLoading = false
    renderApp()
  }
}

async function saveCurrentPlanAsNew() {
  if (!state.editorProject) return
  if (!state.user?.uid) {
    window.location.href = authRoute({ redirect: window.location.pathname + window.location.search })
    return
  }
  state.editorSaveStatus = 'saving'
  updateSaveStatusUI()
  try {
    const snapshot = buildEditorStateSnapshot()
    const project = await createStageProjectFromPlan(state.user, state.editorProject, {
      title: state.editorProject.title || state.editorProject.name || 'Untitled Stage Plan',
      stageType: state.editorProject.stageType || 'Blank Stage',
      editorState: snapshot
    })
    state.editorSaveStatus = 'saved'
    state.editorSaveError = ''
    state.editorSaveErrorCode = ''
    window.location.href = stageProjectRoute(project.id)
  } catch (error) {
    state.editorSaveStatus = 'failed'
    state.editorSaveError = error?.message || 'Could not save this stage as a new project.'
    state.editorSaveErrorCode = error?.code || ''
    updateSaveStatusUI()
    console.warn('[stage] save as new failed.', error?.code || error?.message || error)
  }
}

function applyAuthUser(user) {
  state.user = user
  state.authUid = user?.uid || ''
}

function preserveCurrentStageAsLocalRecovery() {
  if (!state.projectId || !state.editorProject) return
  persistLocalStagePlan()
  persistLocalEditorState()
  state.editorSaveStatus = 'local'
}

async function handleAuthReadyUser(user, source = 'auth-state') {
  const previousUid = state.authUid || ''
  const nextUid = user?.uid || ''
  applyAuthUser(user)

  if (!state.projectId) {
    if (previousUid !== nextUid) {
      state.projects = []
      state.recentProjects = []
    }
    renderApp()
    await loadDashboardProjects()
    return
  }

  if (!nextUid) {
    lastLoadedAuthUid = ''
    if (state.editorProject) {
      preserveCurrentStageAsLocalRecovery()
      setStageLoadState('unauthenticated', {
        code: 'auth-required',
        reason: source,
        reasonMessage: 'Sign in required to load this private stage plan.',
        usingLocalRecovery: true,
        fallbackMode: 'local'
      })
      disposeViewportController()
      renderApp()
      return
    }
    await loadEditorProject({ reason: source, force: true })
    return
  }

  const loadedForCurrentUser = lastLoadedProjectId === state.projectId
    && lastLoadedAuthUid === nextUid
    && state.projectLoadStatus === 'loaded'
  const shouldReload = !loadedForCurrentUser
    && (previousUid !== nextUid || authRecoverableProjectStatuses.has(state.projectLoadStatus) || !state.editorProject)

  renderApp()
  if (shouldReload) await loadEditorProject({ reason: source, force: authRecoverableProjectStatuses.has(state.projectLoadStatus) })
}

if (!canonicalizeLegacyStageRoute()) {
  state.projectId = getCurrentStageProjectId()
  if (state.projectId) setStageLoadState('auth-restoring')
  renderApp()

  waitForInitialAuthState().then(async (user) => {
    state.authReady = true
    applyAuthUser(user)
    if (state.projectId) await loadEditorProject({ reason: 'initial-auth', force: true })
    else {
      renderApp()
      await loadDashboardProjects()
    }
  }).catch(async (error) => {
    state.authReady = true
    applyAuthUser(null)
    console.warn('[stage] Initial auth restore failed.', error?.code || error?.message || error)
    if (state.projectId) await loadEditorProject({ reason: 'initial-auth-error', force: true })
    else renderApp()
  })

  subscribeToAuthState(async (user) => {
    if (!state.authReady) return
    await handleAuthReadyUser(user, 'auth-state')
  })

  subscribeToIdToken(async (user) => {
    if (!state.authReady) return
    const nextUid = user?.uid || ''
    if (nextUid === state.authUid && state.projectLoadStatus === 'loaded' && state.editorProject) {
      state.user = user
      return
    }
    await handleAuthReadyUser(user, 'id-token')
  })
}
