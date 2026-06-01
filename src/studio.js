import './styles/base.css'
import './styles/studio.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import {
  createStudioProject,
  listAccessibleStudioProjects,
  listIndexedStudioProjects,
  sortProjectsByActivity,
  touchStudioProject
} from './data/studioProjectService'
import {
  STAGE_PROJECTS_COLLECTION,
  classifyStageProjectError,
  createStageProject,
  listAccessibleStageProjects,
  sortStageProjectsByActivity,
  touchStageProject
} from './data/stageProjectService'
import { studioSidebar } from './components/studioShell'
import { initStudioBrandLogo } from './components/studioBrandLogo'
import { stageTypes, templateCards } from './stage/app/stageState'

const app = document.querySelector('#app')

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))

function stageCreateErrorMessage(error, user) {
  const kind = classifyStageProjectError(error, user)
  if (kind === 'unauthenticated') return 'Please sign in to create a stage plan.'
  if (kind === 'permission-denied') return 'Stage creation is blocked by Firestore permissions. Your work was not saved to the cloud.'
  if (kind === 'network-error') return 'Network/Firebase connection failed. Try again.'
  return 'Could not create stage plan.'
}

const dawDemos = [
  { title: 'WILDFLOWER', artist: 'Billie Eilish', year: '2024', tool: 'DAW' },
  { title: 'Blinding Lights', artist: 'The Weeknd', year: '2019', tool: 'DAW' },
  { title: 'As It Was', artist: 'Harry Styles', year: '2022', tool: 'DAW' },
  { title: 'bad guy', artist: 'Billie Eilish', year: '2019', tool: 'DAW' }
]

const stageDemos = [
  { title: 'Red Rocks Amphitheatre', artist: 'Outdoor venue', year: 'Stagemaker', tool: 'Stagemaker' },
  { title: 'Madison Square Garden', artist: 'Arena layout', year: 'Stagemaker', tool: 'Stagemaker' },
  { title: 'Coachella Outdoor Stage', artist: 'Festival plot', year: 'Stagemaker', tool: 'Stagemaker' },
  { title: 'Tiny Desk / Live Room', artist: 'Small room', year: 'Stagemaker', tool: 'Stagemaker' }
]

const moduleCards = [
  { title: 'DAW', href: ROUTES.studioDaw, body: 'Open projects, build arrangements, and produce sessions.' },
  { title: 'Stagemaker', href: ROUTES.studioStagemaker, body: 'Build stage plots, input lists, viewport plans, and show files.' },
  { title: 'Demos', href: ROUTES.studioDemos, body: 'Explore example sessions and production references.' },
  { title: 'Tutorials', href: ROUTES.studioTutorials, body: 'Learn the tools and workflows inside Melogic Studio.' },
  { title: 'Release Builder', href: '#', body: 'Future release prep, assets, checklists, and distribution handoff.', placeholder: true }
]

const stageToolCards = [
  { title: 'Blueprint Export', body: 'Export stage plots and production-ready summaries for load-in.' },
  { title: 'Input Lists', body: 'Track sources, mic/DI choices, monitor sends, and patch notes.' },
  { title: 'Equipment Library', body: 'Place backline, audio, lighting, rigging, video, and venue assets.' },
  { title: 'Collaboration', body: 'Keep project ownership and shared plans in the Studio workspace.' },
  { title: 'Sharing', body: 'Prepare plans for production handoff without exposing private drafts.' },
  { title: 'Technical Notes', body: 'Capture safety notes, compatibility details, and show-day reminders.' }
]

const state = {
  user: null,
  createError: '',
  daw: { projects: [], recentProjects: [], loading: false, error: '' },
  stage: { projects: [], recentProjects: [], loading: false, error: '' }
}

const icon = (name) => {
  const c = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"'
  return name === 'plus'
    ? `<svg ${c}><path d="M12 5v14"/><path d="M5 12h14"/></svg>`
    : `<svg ${c}><path d="M18 21a6 6 0 0 0-12 0"/><circle cx="12" cy="7" r="4"/></svg>`
}

function currentStudioSection() {
  const pathname = window.location.pathname || ''
  if (pathname === ROUTES.studio) return 'hub'
  if (pathname.startsWith(ROUTES.studioStagemaker)) return 'stagemaker'
  return 'daw'
}

function projectTime(project = {}) {
  return project.lastOpenedAt?.toMillis?.()
    || project.updatedAt?.toMillis?.()
    || project.createdAt?.toMillis?.()
    || 0
}

function fmtDate(project = {}) {
  const stamp = project.lastOpenedAt?.toDate?.() || project.updatedAt?.toDate?.() || project.createdAt?.toDate?.() || null
  if (!stamp) return 'Recently'
  return stamp.toLocaleDateString()
}

function ownerBadge(project = {}) {
  return state.user?.uid && state.user.uid === project.ownerId ? 'Owner' : 'Shared'
}

function dawSubtitle(project = {}) {
  return `${project.bpm || 140} BPM - ${project.key || 'C minor'} - ${project.type || 'song'}`
}

function stageSubtitle(project = {}) {
  const dims = project.stageDimensions || project.stage || {}
  const width = dims.width || project.stage?.width || 32
  const depth = dims.depth || project.stage?.depth || 20
  const unit = dims.unit || project.stage?.unit || 'ft'
  return `${project.stageType || 'Blank Stage'} - ${width}x${depth} ${unit}`
}

function stageProjectMeta(project = {}) {
  const dims = project.stageDimensions || project.stage || {}
  const width = dims.width || project.stage?.width || 32
  const depth = dims.depth || project.stage?.depth || 20
  const unit = dims.unit || project.stage?.unit || 'ft'
  return {
    stageType: project.stageType || 'Blank Stage',
    dimensions: `${width}x${depth} ${unit}`,
    updated: fmtDate(project),
    role: ownerBadge(project)
  }
}

function taggedProjects(kind, projects = []) {
  return projects.map((project) => ({ ...project, studioTool: kind }))
}

function mixedProjects() {
  return [
    ...taggedProjects('DAW', state.daw.projects),
    ...taggedProjects('Stagemaker', state.stage.projects)
  ].sort((a, b) => projectTime(b) - projectTime(a))
}

function renderDemoCards(items = []) {
  return `<div class="studio-card-grid studio-explore-row">${items.map((item) => `
    <button type="button" class="studio-explore-card is-placeholder" data-placeholder-demo aria-disabled="true">
      <div class="studio-cover-placeholder ${item.tool === 'Stagemaker' ? 'is-stage-demo' : ''}"></div>
      <div class="studio-explore-copy">
        <h3 class="studio-explore-title">${item.title}</h3>
        <p>${item.artist}</p>
        <p>${item.year}</p>
      </div>
    </button>
  `).join('')}</div>`
}

function renderRecentList(projects = [], kind = 'daw') {
  if (!projects.length) {
    return `<p class="studio-recents-empty">${kind === 'stage' ? 'Recent stage projects will appear here once you open a Stagemaker project.' : 'Recent projects will appear here once you open a project.'}</p>`
  }
  const attr = kind === 'stage' ? 'data-open-stage-project' : 'data-open-daw-project'
  return `<div class="studio-card-grid studio-recent-list">${projects.map((project) => `
    <button class="studio-recent-item" ${attr}="${project.id}" type="button">
      <span class="studio-card-topline"><strong>${project.title}</strong><span class="studio-badge">${ownerBadge(project)}</span></span>
      <span>${kind === 'stage' ? stageSubtitle(project) : dawSubtitle(project)} - ${fmtDate(project)}</span>
    </button>
  `).join('')}</div>`
}

function renderMixedProjectRows(projects = []) {
  if (!projects.length) {
    return `
      <div class="studio-hub-empty">
        <p>Your DAW and Stagemaker projects will appear here once you start working.</p>
        <div>
          <a class="button button-muted" href="${state.user ? ROUTES.studioDaw : authRoute({ redirect: ROUTES.studioDaw })}">Create DAW Project</a>
          <a class="button button-muted" href="${state.user ? ROUTES.studioStagemaker : authRoute({ redirect: ROUTES.studioStagemaker })}">Create Stage Plan</a>
        </div>
      </div>
    `
  }
  return `<div class="studio-project-grid">${projects.map((project) => {
    const isStage = project.studioTool === 'Stagemaker'
    const attr = isStage ? 'data-open-stage-project' : 'data-open-daw-project'
    return `
      <article class="studio-project-row">
        <div class="studio-card-topline">
          <span class="studio-card-kicker">${project.studioTool}</span>
          <span class="studio-badge">${ownerBadge(project)}</span>
        </div>
        <button class="studio-project-open" ${attr}="${project.id}" type="button">
          <h4>${project.title}</h4>
          <p>${isStage ? stageSubtitle(project) : dawSubtitle(project)}</p>
          <small>${project.studioTool} - ${fmtDate(project)}</small>
        </button>
      </article>
    `
  }).join('')}</div>`
}

function renderProjectArea(kind = 'daw') {
  const source = kind === 'stage' ? state.stage : state.daw
  if (source.loading) return '<p class="studio-recents-empty">Loading projects...</p>'
  if (source.error) return `<p class="studio-recents-empty">${source.error}</p>`
  if (!source.projects.length) {
    return `<div class="studio-projects-empty"><p class="studio-projects-empty-title">No ${kind === 'stage' ? 'stage plans' : 'project files'} yet.</p><p>${kind === 'stage' ? 'Create a Stagemaker project to start building plots, lists, and show files.' : 'Create a project, folder, or import sounds to start building.'}</p></div>`
  }

  const attr = kind === 'stage' ? 'data-open-stage-project' : 'data-open-daw-project'
  return `<div class="studio-project-grid">${source.projects.map((project) => `
    <article class="studio-project-row">
      <div class="studio-card-topline">
        <span class="studio-card-kicker">${kind === 'stage' ? 'Stagemaker' : 'DAW'}</span>
        <span class="studio-badge">${ownerBadge(project)}</span>
      </div>
      <button class="studio-project-open" ${attr}="${project.id}" type="button">
        <h4>${project.title}</h4>
        <p>${kind === 'stage' ? stageSubtitle(project) : dawSubtitle(project)}</p>
        <small>${fmtDate(project)}</small>
      </button>
    </article>
  `).join('')}</div>`
}

function renderStageProjectGrid(projects = [], emptyMessage = 'No stage plans yet. Start with a template or create a blank stage.') {
  if (!projects.length) {
    return `<div class="studio-projects-empty studio-stage-empty"><p class="studio-projects-empty-title">${esc(emptyMessage)}</p><p>StageMaker plans you own or collaborate on will appear here.</p></div>`
  }

  return `<div class="studio-stage-project-grid">${projects.map((project) => {
    const meta = stageProjectMeta(project)
    return `
      <article class="studio-stage-project-card">
        <div class="studio-stage-card-topline">
          <span class="studio-stage-card-kicker">${esc(meta.stageType)}</span>
          <span class="studio-badge">${esc(meta.role)}</span>
        </div>
        <button class="studio-stage-project-open" data-open-stage-project="${esc(project.id)}" type="button">
          <h3>${esc(project.title || 'Untitled Stage Plan')}</h3>
          <p>${esc(meta.dimensions)}</p>
          <small>Updated ${esc(meta.updated)}</small>
        </button>
      </article>
    `
  }).join('')}</div>`
}

function renderStageProjectArea(projects = state.stage.projects, emptyMessage) {
  if (state.stage.loading) return '<p class="studio-recents-empty">Loading stage plans...</p>'
  if (state.stage.error) return `<p class="studio-recents-empty">${esc(state.stage.error)}</p>`
  return renderStageProjectGrid(projects, emptyMessage)
}

function renderStageTemplateCards() {
  return `<div class="studio-stage-template-grid">${templateCards.map((tpl) => `
    <article class="studio-stage-template-card">
      <div class="studio-stage-template-thumb studio-stage-template-thumb--${esc(tpl.icon)}" aria-hidden="true"></div>
      <div class="studio-stage-template-copy">
        <h3>${esc(tpl.title)}</h3>
        <p>${esc(tpl.subtitle)}</p>
      </div>
      <button class="studio-stage-template-button" data-use-stage-template="${esc(tpl.type)}" type="button">Create</button>
    </article>
  `).join('')}</div>`
}

function renderStageTools() {
  return `<div class="studio-module-grid studio-stage-tools-grid">${stageToolCards.map((card) => `
    <article class="studio-module-tile studio-stage-tool-tile">
      <strong>${esc(card.title)}</strong>
      <span>${esc(card.body)}</span>
    </article>
  `).join('')}</div>`
}

function renderProjectsPanel(kind = 'daw') {
  return `<section class="studio-projects-panel"><header class="studio-projects-toolbar"><button class="studio-folder-button" type="button" data-placeholder-demo>NEW FOLDER</button><button class="studio-toolbar-icon" type="button" aria-label="Search projects" data-tooltip="Search" data-placeholder-demo><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></button><button class="studio-toolbar-icon" type="button" aria-label="Filter projects" data-tooltip="Filters" data-placeholder-demo><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M4 21v-7"/><path d="M4 10V3"/><path d="M12 21v-9"/><path d="M12 8V3"/><path d="M20 21v-5"/><path d="M20 12V3"/><path d="M2 14h4"/><path d="M10 10h4"/><path d="M18 16h4"/></svg></button><button class="studio-toolbar-icon" type="button" aria-label="Project options" data-tooltip="More" data-placeholder-demo><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button></header><div class="studio-projects-body">${renderProjectArea(kind)}</div></section>`
}

function renderHub() {
  const combined = mixedProjects()
  const recent = combined.slice(0, 6)
  return `
    <section class="studio-main">
      <section class="studio-hub-hero">
        <div>
          <p class="eyebrow">Creative Dashboard</p>
          <h1>Melogic Studio</h1>
          <p>Your creative workspace for production, stage planning, collaboration, and release prep.</p>
        </div>
        <div class="studio-hub-actions">
          <a class="button button-accent" href="${ROUTES.studioDaw}">Open DAW</a>
          <a class="button button-muted" href="${ROUTES.studioStagemaker}">Open Stagemaker</a>
        </div>
      </section>

      <div class="studio-section-heading"><h2>CONTINUE WORKING</h2><span class="studio-section-line studio-section-line--recents"></span></div>
      ${state.daw.loading || state.stage.loading ? '<p class="studio-recents-empty">Loading recent work...</p>' : renderMixedProjectRows(recent)}

      <div class="studio-section-heading"><h2>DEMO PROJECTS</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      <div class="studio-demo-stack">
        ${renderDemoCards(dawDemos)}
        ${renderDemoCards(stageDemos)}
      </div>

      <div class="studio-section-heading"><h2>YOUR PROJECTS</h2><span class="studio-section-line studio-section-line--projects"></span></div>
      <section class="studio-projects-panel is-compact"><div class="studio-projects-body">${state.daw.error && state.stage.error ? `<p class="studio-recents-empty">${state.daw.error} ${state.stage.error}</p>` : renderMixedProjectRows(combined)}</div></section>

      <div class="studio-section-heading"><h2>STUDIO MODULES</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      <div class="studio-module-grid">
        ${moduleCards.map((card) => `<a class="studio-module-tile ${card.placeholder ? 'is-placeholder' : ''}" href="${card.href}" ${card.placeholder ? 'data-placeholder-demo aria-disabled="true"' : ''}><strong>${card.title}</strong><span>${card.body}</span></a>`).join('')}
      </div>
      <div data-studio-modal-root></div>
    </section>
  `
}

function renderDaw() {
  return `
    <section class="studio-main">
      <div class="studio-top-actions">
        <a class="studio-action-button" data-action="new-project" data-new-daw-project href="${state.user ? '#' : authRoute({ redirect: ROUTES.studioDaw })}">NEW PROJECT <span>${icon('plus')}</span></a>
        <a class="studio-action-button" data-action="start-collab" data-start-collab href="${state.user ? '#' : authRoute({ redirect: ROUTES.studioDaw })}">START COLLAB <span>${icon('user')}</span></a>
      </div>
      <div class="studio-section-heading"><h2>EXPLORE</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderDemoCards(dawDemos)}
      <div class="studio-section-heading"><h2>RECENTS</h2><span class="studio-section-line studio-section-line--recents"></span></div>
      ${renderRecentList(state.daw.recentProjects, 'daw')}
      <div class="studio-section-heading"><h2>PROJECTS</h2><span class="studio-section-line studio-section-line--projects"></span></div>
      ${renderProjectsPanel('daw')}
      <div data-studio-modal-root></div>
    </section>
  `
}

function renderStagemaker() {
  return `
    <section class="studio-main">
      <section class="studio-hub-hero studio-stage-hero">
        <div>
          <p class="eyebrow">Studio Module</p>
          <h1>StageMaker</h1>
          <p>Plan stages, input lists, camera plots, lighting layouts, and export-ready blueprints.</p>
        </div>
        <div class="studio-hub-actions">
          <a class="button button-accent" data-new-stage-project href="${state.user ? '#' : authRoute({ redirect: ROUTES.studioStagemaker })}">New Stage Plan</a>
          <a class="button button-muted" href="#stage-templates">View Templates</a>
        </div>
      </section>

      <div id="stage-recents" class="studio-section-heading"><h2>CONTINUE WORKING</h2><span class="studio-section-line studio-section-line--recents"></span></div>
      ${state.stage.loading ? '<p class="studio-recents-empty">Loading recent stage plans...</p>' : renderStageProjectGrid(state.stage.recentProjects, 'Recent stage plans will appear here once you open a StageMaker project.')}

      <div id="stage-templates" class="studio-section-heading"><h2>STAGEMAKER TEMPLATES</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderStageTemplateCards()}

      <div class="studio-section-heading"><h2>DEMO STAGE PLANS</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderDemoCards(stageDemos)}

      <div class="studio-section-heading"><h2>MY STAGE PLANS</h2><span class="studio-section-line studio-section-line--projects"></span></div>
      <section class="studio-projects-panel studio-stage-projects-panel"><div class="studio-projects-body">${renderStageProjectArea(state.stage.projects)}</div></section>

      <div class="studio-section-heading"><h2>STAGEMAKER TOOLS</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderStageTools()}
      <div data-studio-modal-root></div>
    </section>
  `
}

function renderShell() {
  const active = currentStudioSection()
  const content = active === 'hub' ? renderHub() : active === 'stagemaker' ? renderStagemaker() : renderDaw()
  app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active })}${content}</section></main>`
  initShellChrome()
  initStudioBrandLogo()
  bind()
}

async function loadDawData() {
  const [indexedResult, accessibleResult] = await Promise.allSettled([
    listIndexedStudioProjects(state.user.uid),
    listAccessibleStudioProjects(state.user.uid)
  ])
  const projects = []
  if (indexedResult.status === 'fulfilled') projects.push(...indexedResult.value)
  else console.error('[studio] indexed project query failed', indexedResult.reason)
  if (accessibleResult.status === 'fulfilled') projects.push(...accessibleResult.value)
  else console.error('[studio] accessible project query failed', accessibleResult.reason)
  const merged = new Map()
  projects.forEach((project) => project?.id && merged.set(project.id, project))
  const deduped = [...merged.values()].sort(sortProjectsByActivity)
  state.daw.projects = deduped
  state.daw.recentProjects = deduped.slice(0, 6)
  state.daw.error = deduped.length || indexedResult.status === 'fulfilled' || accessibleResult.status === 'fulfilled'
    ? ''
    : 'Could not load DAW projects.'
}

async function loadStageData() {
  try {
    const projects = await listAccessibleStageProjects(state.user.uid)
    state.stage.projects = [...projects].sort(sortStageProjectsByActivity)
    state.stage.recentProjects = state.stage.projects.slice(0, 6)
    state.stage.error = ''
  } catch (error) {
    console.error('[studio] stage project query failed', error)
    state.stage.projects = []
    state.stage.recentProjects = []
    state.stage.error = 'Could not load Stagemaker projects.'
  }
}

async function loadProjectsForCurrentRoute() {
  if (!state.user?.uid) {
    state.daw = { projects: [], recentProjects: [], loading: false, error: '' }
    state.stage = { projects: [], recentProjects: [], loading: false, error: '' }
    renderShell()
    return
  }

  const active = currentStudioSection()
  const wantsDaw = active === 'hub' || active === 'daw'
  const wantsStage = active === 'hub' || active === 'stagemaker'
  if (wantsDaw) state.daw.loading = true
  if (wantsStage) state.stage.loading = true
  renderShell()

  await Promise.allSettled([
    wantsDaw ? loadDawData() : Promise.resolve(),
    wantsStage ? loadStageData() : Promise.resolve()
  ])

  if (wantsDaw) state.daw.loading = false
  if (wantsStage) state.stage.loading = false
  renderShell()
}

function openDawProject(projectId) {
  touchStudioProject(projectId).catch(() => {})
  window.location.href = studioProjectRoute(projectId)
}

function openStageProject(projectId) {
  touchStageProject(projectId).catch(() => {})
  window.location.href = stageProjectRoute(projectId)
}

function renderCreateModal(kind = 'daw', loading = false, initialTitle = '', selectedStageType = 'Blank Stage') {
  const root = app.querySelector('[data-studio-modal-root]')
  if (!root) return
  const isStage = kind === 'stage'
  if (loading) {
    root.innerHTML = `<div class="studio-modal"><div class="studio-modal-panel"><h3>Creating ${isStage ? 'stage plan' : 'project'}...</h3></div></div>`
    return
  }
  const stageTypeField = isStage
    ? `<div class="studio-modal-field"><label for="studio-stage-type">Starting format</label><select id="studio-stage-type" name="stageType">${stageTypes.map((type) => `<option value="${esc(type)}" ${type === selectedStageType ? 'selected' : ''}>${esc(type)}</option>`).join('')}</select></div>`
    : ''
  root.innerHTML = `<div class="studio-modal" data-modal-backdrop><form class="studio-modal-panel" data-create-form data-create-kind="${kind}"><h3>${isStage ? 'New Stage Plan' : 'New Project'}</h3><div class="studio-modal-field"><label for="studio-project-name">Project name</label><input id="studio-project-name" name="title" maxlength="120" placeholder="${isStage ? 'Name your stage plan' : 'Name your project'}" value="${esc(initialTitle)}" required /></div>${stageTypeField}${state.createError ? `<p class="studio-form-error">${esc(state.createError)}</p>` : ''}<div class="studio-modal-actions"><button class="button" type="submit">${isStage ? 'Create Stage Plan' : 'Create Project'}</button><button class="button button-muted" type="button" data-close-modal>Cancel</button></div></form></div>`
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKeydown) }
  const onKeydown = (e) => e.key === 'Escape' && close()
  document.addEventListener('keydown', onKeydown)
  root.querySelector('[data-modal-backdrop]')?.addEventListener('click', (e) => e.target === e.currentTarget && close())
  root.querySelector('[data-close-modal]')?.addEventListener('click', close)
  root.querySelector('[data-create-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    state.createError = ''
    const formData = new FormData(e.currentTarget)
    const title = String(formData.get('title') || '').trim()
    const stageType = stageTypes.includes(String(formData.get('stageType') || '')) ? String(formData.get('stageType')) : 'Blank Stage'
    renderCreateModal(kind, true, title, stageType)
    try {
      if (isStage) {
        const project = await createStageProject(state.user, { title, stageType })
        window.location.href = stageProjectRoute(project.id)
      } else {
        const project = await createStudioProject(state.user, { title })
        window.location.href = studioProjectRoute(project.id)
      }
    } catch (error) {
      if (isStage) {
        console.warn('[stage] create project failed', {
          code: error?.code || error?.name || '',
          message: error?.message || String(error || ''),
          uid: state.user?.uid || null,
          collectionPath: error?.collectionPath || STAGE_PROJECTS_COLLECTION,
          step: error?.stageCreateStep || 'create-stage-project'
        })
        state.createError = stageCreateErrorMessage(error, state.user)
      } else {
        console.error('[studio]', error)
        state.createError = 'Could not create project right now.'
      }
      renderCreateModal(kind, false, title, stageType)
    }
  })
}

function bind() {
  app.querySelector('[data-new-daw-project]')?.addEventListener('click', (e) => {
    if (!state.user) return
    e.preventDefault()
    state.createError = ''
    renderCreateModal('daw')
  })
  app.querySelector('[data-new-stage-project]')?.addEventListener('click', (e) => {
    if (!state.user) return
    e.preventDefault()
    state.createError = ''
    renderCreateModal('stage')
  })
  app.querySelectorAll('[data-use-stage-template]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault()
    if (!state.user) {
      window.location.href = authRoute({ redirect: ROUTES.studioStagemaker })
      return
    }
    state.createError = ''
    renderCreateModal('stage', false, '', el.dataset.useStageTemplate || 'Blank Stage')
  }))
  app.querySelectorAll('[data-open-daw-project]').forEach((el) => el.addEventListener('click', () => openDawProject(el.dataset.openDawProject)))
  app.querySelectorAll('[data-open-stage-project]').forEach((el) => el.addEventListener('click', () => openStageProject(el.dataset.openStageProject)))
  app.querySelectorAll('[data-placeholder-demo]').forEach((el) => {
    el.addEventListener('click', (e) => e.preventDefault())
  })
  app.querySelectorAll('[data-start-collab]').forEach((el) => {
    el.addEventListener('click', (e) => { if (state.user) e.preventDefault() })
  })
}

waitForInitialAuthState().then(async (user) => {
  state.user = user
  renderShell()
  await loadProjectsForCurrentRoute()
})

subscribeToAuthState(async (user) => {
  state.user = user
  await loadProjectsForCurrentRoute()
})
