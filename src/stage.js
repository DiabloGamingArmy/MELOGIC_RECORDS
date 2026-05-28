import './styles/base.css'
import './styles/stage.css'
import { initShellChrome } from './components/assetChrome'
import { navShell } from './components/navShell'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { authRoute, ROUTES, stageProjectRoute } from './utils/routes'
import { getPublicStorageUrl } from './firebase/storageAssets'
import { createStageProject, getStageProject, listAccessibleStageProjects, saveStageProjectEditorState, saveStageProjectPlan, sortStageProjectsByActivity, touchStageProject } from './data/stageProjectService'
import { renderBottomSplit } from './stage/bottomPanel/bottomPanel'
import { bindDashboardEvents, bindStageEditorEventsOnce } from './stage/app/stageEvents'
import { renderDashboard } from './stage/app/stageDashboard'
import { renderEditor, renderStageTabbar } from './stage/app/stageEditorRender'
import { editorTitleStamp, getCurrentStageProjectId, projectDate, stageIconPath, stageTypes, state, updateSelectedStageObjectField } from './stage/app/stageState'
import { renderExportPreview } from './stage/export/exportPreview'
import { renderInspectorTabs, selectedEditorObjectMarkup } from './stage/inspector/inspectorTabs'
import { renderLeftPanelBySection } from './stage/panels/leftPanels'
import { mountStageThreeViewport } from './stage/stageThreeViewport'
import { normalizeStagePlan } from './stage/stagePlanModel'

const app = document.querySelector('#app')

let stageViewportController = null
let stageEditorMounted = false
let stageIconHydrationPromise = null
let stageViewportMountedForProjectId = ''
let stageNoticeTimer = 0
let editorSaveTimer = 0
let planSaveTimer = 0

function editorRecoveryKey(projectId = state.projectId) {
  return `melogic.stage.editorState.${projectId || 'draft'}`
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
    activeEditorMode: normalizeEditorMode(state.activeEditorMode),
    activeInspectorTab: state.activeInspectorTab,
    activeDataTab: state.activeDataTab,
    renderMode: state.renderMode,
    selectedObjectId: state.selectedEditorObject,
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
  state.activeEditorMode = normalizeEditorMode(editorState.activeEditorMode || state.activeEditorMode)
  state.activeInspectorTab = editorState.activeInspectorTab || state.activeInspectorTab
  state.activeDataTab = editorState.activeDataTab || state.activeDataTab
  state.renderMode = editorState.renderMode || state.renderMode
  state.selectedEditorObject = editorState.selectedObjectId || state.selectedEditorObject
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
    showDiagnostics: state.showViewportDiagnostics,
    selectedObjectKey: state.selectedEditorObject,
    objectTransforms: state.editorObjectTransforms,
    onSelectObject: (key) => {
      if (state.selectedEditorObject === key) return
      state.selectedEditorObject = key
      updateStageInspectorSelection()
      updateEditorModeUI()
    },
    onTransformObject: (key, transform) => {
      state.editorObjectTransforms = { ...(state.editorObjectTransforms || {}), [key]: transform }
      if (state.selectedEditorObject === key) {
        if (Number.isFinite(transform.x)) updateSelectedStageObjectField('x', transform.x)
        if (Number.isFinite(transform.y)) updateSelectedStageObjectField('y', transform.y)
        if (Number.isFinite(transform.z)) updateSelectedStageObjectField('z', transform.z)
      }
      queueStagePlanSave()
    },
    viewportMode: state.viewportMode,
    renderMode: state.renderMode,
    showGrid: state.gridEnabled,
    showBeams: state.beamPreviewEnabled,
    showLabels: state.showStageLabels
  })
  if (stageViewportController) stageViewportMountedForProjectId = state.projectId
}

function updateSaveStatusUI() {
  const target = app.querySelector('[data-stage-save-status]')
  if (!target) return
  const label = state.editorSaveStatus === 'saving'
    ? 'Saving...'
    : state.editorSaveStatus === 'saved'
      ? `Saved${state.lastSavedAt ? ` ${new Date(state.lastSavedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
      : state.editorSaveStatus === 'failed'
        ? 'Save failed'
        : state.editorSaveStatus === 'local'
          ? 'Local recovery active'
          : state.editorSaveStatus === 'unsaved'
            ? 'Unsaved changes'
            : 'Ready'
  target.textContent = label
  target.dataset.saveStatus = state.editorSaveStatus || 'idle'
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
    state.lastSavedAt = snapshot.savedAt
  } catch (error) {
    state.editorSaveStatus = 'failed'
    state.editorSaveError = error?.message || 'Stage editor state could not be saved.'
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
  try { localStorage.setItem(`melogic.stage.plan.${state.projectId || 'draft'}`, JSON.stringify({ plan: state.editorProject, savedAt: new Date().toISOString() })) } catch {}
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
    state.lastSavedAt = snapshot.savedAt
  } catch (error) {
    state.editorSaveStatus = 'failed'
    state.editorSaveError = error?.message || 'Stage plan could not be saved.'
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
    const url = await getPublicStorageUrl(path)
    if (!url) return
    const img = node.querySelector('img')
    if (!img) return
    img.addEventListener('load', () => { img.hidden = false; node.classList.add('has-stage-icon') }, { once: true })
    img.addEventListener('error', () => { img.hidden = true; node.classList.remove('has-stage-icon') }, { once: true })
    img.src = url
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
  left.insertAdjacentHTML('beforeend', `<div class="stage-editor-app-menu-panel" data-stage-app-menu-panel><a href="${ROUTES.stage}">Stage Projects</a><a href="/">Dashboard</a><button type="button" aria-disabled="true">Asset Library</button><button type="button" aria-disabled="true">Exports</button><label class="stage-menu-check"><input type="checkbox" data-toggle-main-header ${state.showStageGlobalHeader ? 'checked' : ''}> Show site-wide header</label></div>`)
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

function updateViewportControlUI() {
  app.querySelectorAll('[data-view-mode]').forEach((el) => el.classList.toggle('is-active-view', (el.dataset.viewMode || '') === state.viewportMode))
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
  app.querySelectorAll('[data-render-mode]').forEach((el) => el.classList.toggle('is-active', (el.dataset.renderMode || '') === state.renderMode))
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
    refreshStageViewport
  })
}

function renderApp() {
  if (!state.projectId) {
    disposeViewportController()
    stageEditorMounted = false
    stageIconHydrationPromise = null
    app.innerHTML = `${navShell({ currentPage: 'stage' })}${renderDashboard()}`
    initShellChrome()
    bindDashboardEvents({ app, renderCreateModal, openProject, loadDashboardProjects })
    return
  }
  const mounted = app.querySelector('[data-stage-editor-app]')
  if (!stageEditorMounted || !mounted) {
    app.innerHTML = `<div data-stage-global-header-wrapper ${state.showStageGlobalHeader ? '' : 'hidden'}>${navShell({ currentPage: 'stage' })}</div>${renderEditor()}`
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

function renderCreateModal(loading = false, selectedStageType = 'Blank Stage') {
  const root = app.querySelector('[data-stage-modal-root]')
  if (!root) return
  if (loading) {
    root.innerHTML = '<div class="stage-modal"><div class="stage-modal-panel"><h3>Creating stage plan...</h3></div></div>'
    return
  }
  root.innerHTML = `<div class="stage-modal" data-modal-backdrop><form class="stage-modal-panel" data-stage-create-form><h3>New Stage Plan</h3><p class="stage-modal-help">Choose a starting format. You can change dimensions later.</p><div class="stage-modal-field"><label for="stage-project-name">Project name</label><input id="stage-project-name" name="title" required maxlength="120" placeholder="Name your stage plan" /></div><div class="stage-modal-field"><label for="stage-type">Stage type</label><select id="stage-type" name="stageType">${stageTypes.map((t) => `<option value="${t}" ${t === selectedStageType ? 'selected' : ''}>${t}</option>`).join('')}</select></div>${state.createError ? `<p class="stage-form-error">${state.createError}</p>` : ''}<div class="stage-modal-actions"><button class="button" type="submit">Create Stage Plan</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  document.addEventListener('keydown', onModalEscape)
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (e) => e.target === e.currentTarget && closeModal())
  root.querySelector('[data-close-modal]')?.addEventListener('click', closeModal)
  root.querySelector('[data-stage-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    state.createError = ''
    renderCreateModal(true, selectedStageType)
    try {
      const fd = new FormData(e.currentTarget)
      const project = await createStageProject(state.user, { title: fd.get('title'), stageType: fd.get('stageType') })
      window.location.href = stageProjectRoute(project.id)
    } catch {
      state.createError = 'Could not create stage plan right now.'
      renderCreateModal(false, selectedStageType)
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

async function loadEditorProject() {
  if (!state.projectId) return
  state.editorLoading = true
  state.editorError = ''
  state.projectLoadStatus = 'loading'
  renderApp()
  try {
    const project = await getStageProject(state.projectId)
    if (!project) {
      state.editorError = 'not-found'
      state.projectLoadStatus = 'error'
    } else {
      state.editorProject = normalizeStagePlan({ ...project, id: project.id || state.projectId, name: project.title || project.name })
      applyEditorStateSnapshot(project.editorState)
      if (!project.editorState) restoreLocalEditorState(state.projectId)
      state.projectLoadStatus = 'loaded'
      state.editorSaveStatus = project.editorState ? 'saved' : 'idle'
    }
  } catch {
    state.editorProject = normalizeStagePlan({ id: state.projectId, title: 'Fallback Stage Plan', stageType: 'Blank Stage', version: 1 })
    state.projectLoadStatus = 'fallback'
    restoreLocalEditorState(state.projectId)
    console.warn('[stage] Firestore project load failed. Stage editor shell remains available with default viewport objects.')
  } finally {
    state.editorLoading = false
    renderApp()
  }
}

state.projectId = getCurrentStageProjectId()
waitForInitialAuthState().then(async (user) => {
  state.user = user
  renderApp()
  if (state.projectId) await loadEditorProject()
  else await loadDashboardProjects()
})
subscribeToAuthState(async (user) => {
  state.user = user
  if (!state.projectId) {
    state.projects = []
    state.recentProjects = []
  }
  renderApp()
  if (!state.projectId) await loadDashboardProjects()
})
