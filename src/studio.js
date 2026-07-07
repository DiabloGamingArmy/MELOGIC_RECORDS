import './styles/base.css'
import './styles/studio.css'
import { AudioPresets, Room, RoomEvent } from 'livekit-client'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import { endMusicLiveStream, heartbeatMusicLiveStream, markMusicLiveStreamOnAir, startMusicLiveStream } from './data/musicLiveService'
import {
  SEQUENCE_ACTION_TYPES,
  addActionBookmarkToSequence,
  addAssetToSequence,
  createSequence,
  createSequenceActionBookmark,
  duplicateSequenceItem,
  formatMs,
  listSequenceActionBookmarks,
  listSequenceAssets,
  listSequenceItems,
  listSequences,
  updateSequenceItem
} from './data/musicSequenceService'
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

const STUDIO_TOOL_LABELS = {
  daw: 'Soura',
  stage: 'Vertix'
}

function stageCreateErrorMessage(error, user) {
  const kind = classifyStageProjectError(error, user)
  if (kind === 'unauthenticated') return 'Please sign in to create a stage plan.'
  if (kind === 'permission-denied') return 'Stage creation is blocked by Firestore permissions. Your work was not saved to the cloud.'
  if (kind === 'network-error') return 'Network/Firebase connection failed. Try again.'
  return 'Could not create stage plan.'
}

const dawDemos = [
  { title: 'WILDFLOWER', artist: 'Billie Eilish', year: '2024', tool: STUDIO_TOOL_LABELS.daw },
  { title: 'Blinding Lights', artist: 'The Weeknd', year: '2019', tool: STUDIO_TOOL_LABELS.daw },
  { title: 'As It Was', artist: 'Harry Styles', year: '2022', tool: STUDIO_TOOL_LABELS.daw },
  { title: 'bad guy', artist: 'Billie Eilish', year: '2019', tool: STUDIO_TOOL_LABELS.daw }
]

const stageDemos = [
  { title: 'Red Rocks Amphitheatre', artist: 'Outdoor venue', year: STUDIO_TOOL_LABELS.stage, tool: STUDIO_TOOL_LABELS.stage },
  { title: 'Madison Square Garden', artist: 'Arena layout', year: STUDIO_TOOL_LABELS.stage, tool: STUDIO_TOOL_LABELS.stage },
  { title: 'Coachella Outdoor Stage', artist: 'Festival plot', year: STUDIO_TOOL_LABELS.stage, tool: STUDIO_TOOL_LABELS.stage },
  { title: 'Tiny Desk / Live Room', artist: 'Small room', year: STUDIO_TOOL_LABELS.stage, tool: STUDIO_TOOL_LABELS.stage }
]

const moduleCards = [
  { title: STUDIO_TOOL_LABELS.daw, href: ROUTES.studioDaw, body: "Soura is Melogic's browser-based music production workspace for arranging, editing, and building tracks." },
  { title: STUDIO_TOOL_LABELS.stage, href: ROUTES.studioStagemaker, body: "Vertix is Melogic's stage design and live production planning workspace." },
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
  stage: { projects: [], recentProjects: [], loading: false, error: '' },
  live: {
    loading: false,
    error: '',
    assets: [],
    sequences: [],
    bookmarks: [],
    activeSequence: null,
    items: [],
    selectedItemId: '',
    currentItemId: '',
    nextItemId: '',
    afterNextItemId: '',
    activePlayers: [],
    contextMenu: null,
    streamId: '',
    starting: false,
    ending: false,
    room: null,
    localTrack: null,
    outputStatus: 'Sequence Software input ready.'
  }
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
  if (pathname.startsWith(ROUTES.studioLive)) return 'live'
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

function studioToolDisplayLabel(tool = '') {
  const normalized = String(tool || '').toLowerCase()
  if (normalized === 'daw') return STUDIO_TOOL_LABELS.daw
  if (normalized === 'stagemaker') return STUDIO_TOOL_LABELS.stage
  return String(tool || '')
}

function renderDemoCards(items = []) {
  return `<div class="studio-card-grid studio-explore-row">${items.map((item) => `
    <button type="button" class="studio-explore-card is-placeholder" data-placeholder-demo aria-disabled="true">
      <div class="studio-cover-placeholder ${item.tool === STUDIO_TOOL_LABELS.stage ? 'is-stage-demo' : ''}"></div>
      <div class="studio-explore-copy">
        <h3 class="studio-explore-title">${item.title}</h3>
        <p>${item.artist}</p>
        <p>${item.year}</p>
      </div>
    </button>
  `).join('')}</div>`
}

function renderDemoSection(title = '', body = '', items = []) {
  return `
    <article class="studio-demo-type">
      <div class="studio-type-heading">
        <div>
          <h3>${esc(title)}</h3>
          <p>${esc(body)}</p>
        </div>
      </div>
      ${renderDemoCards(items)}
    </article>
  `
}

function renderRecentList(projects = [], kind = 'daw') {
  if (!projects.length) {
    return `<p class="studio-recents-empty">${kind === 'stage' ? 'Your Vertix plans will appear here.' : 'Your Soura sessions will appear here.'}</p>`
  }
  const attr = kind === 'stage' ? 'data-open-stage-project' : 'data-open-daw-project'
  return `<div class="studio-recent-list">${projects.map((project) => `
    <button class="studio-recent-item" ${attr}="${project.id}" type="button">
      <span class="studio-card-topline"><strong>${project.title}</strong><span class="studio-badge">${ownerBadge(project)}</span></span>
      <span>${kind === 'stage' ? stageSubtitle(project) : dawSubtitle(project)} - ${fmtDate(project)}</span>
    </button>
  `).join('')}</div>`
}

function renderRecentLane(kind = 'daw', projects = []) {
  const isStage = kind === 'stage'
  const href = isStage ? ROUTES.studioStagemaker : ROUTES.studioDaw
  const createLabel = isStage ? 'New Vertix Plan' : 'New Soura Project'
  const createAttr = isStage ? 'data-new-stage-project' : 'data-new-daw-project'
  return `
    <article class="studio-type-lane">
      <div class="studio-type-heading">
        <div>
          <h3>${isStage ? 'Vertix Recents' : 'Soura Recents'}</h3>
          <p>${isStage ? 'Stage plots, input lists, and room plans.' : 'Sessions, arrangements, and production files.'}</p>
        </div>
        <a href="${href}">View all</a>
      </div>
      ${renderRecentList(projects.slice(0, 3), kind)}
      <a class="studio-create-link" ${state.user ? createAttr : ''} href="${state.user ? '#' : authRoute({ redirect: href })}">${createLabel}</a>
    </article>
  `
}

function renderRecentLanes() {
  if (state.daw.error && state.stage.error) {
    return `<p class="studio-recents-empty">${state.daw.error} ${state.stage.error}</p>`
  }
  return `
    <section class="studio-type-lanes">
      ${renderRecentLane('daw', state.daw.recentProjects)}
      ${renderRecentLane('stage', state.stage.recentProjects)}
    </section>
  `
}

function renderMixedProjectRows(projects = []) {
  if (!projects.length) {
    return `
      <div class="studio-hub-empty">
        <p>Your Soura and Vertix projects will appear here once you start working.</p>
        <div>
          <a class="button button-muted" href="${state.user ? ROUTES.studioDaw : authRoute({ redirect: ROUTES.studioDaw })}">Create Soura Project</a>
          <a class="button button-muted" href="${state.user ? ROUTES.studioStagemaker : authRoute({ redirect: ROUTES.studioStagemaker })}">Create Vertix Plan</a>
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
          <span class="studio-card-kicker">${studioToolDisplayLabel(project.studioTool)}</span>
          <span class="studio-badge">${ownerBadge(project)}</span>
        </div>
        <button class="studio-project-open" ${attr}="${project.id}" type="button">
          <h4>${project.title}</h4>
          <p>${isStage ? stageSubtitle(project) : dawSubtitle(project)}</p>
          <small>${studioToolDisplayLabel(project.studioTool)} - ${fmtDate(project)}</small>
        </button>
      </article>
    `
  }).join('')}</div>`
}

function renderProjectLibrary() {
  if (state.daw.error && state.stage.error) return `<p class="studio-recents-empty">${state.daw.error} ${state.stage.error}</p>`
  return `
    <section class="studio-library-panel">
      <div class="studio-library-header">
        <div>
          <h3>Project Library</h3>
          <p>Browse your workspace by tool instead of sorting through one mixed stack.</p>
        </div>
        <div class="studio-filter-pills" aria-label="Project types">
          <span>All</span>
          <span>Soura</span>
          <span>Vertix</span>
        </div>
      </div>
      <div class="studio-library-columns">
        <article>
          <div class="studio-type-heading">
            <div>
              <h3>Soura Projects</h3>
              <p>${state.daw.projects.length} session${state.daw.projects.length === 1 ? '' : 's'}</p>
            </div>
            <a href="${ROUTES.studioDaw}">Open Soura</a>
          </div>
          ${renderProjectArea('daw')}
        </article>
        <article>
          <div class="studio-type-heading">
            <div>
              <h3>Vertix Plans</h3>
              <p>${state.stage.projects.length} plan${state.stage.projects.length === 1 ? '' : 's'}</p>
            </div>
            <a href="${ROUTES.studioStagemaker}">Open Vertix</a>
          </div>
          ${renderProjectArea('stage')}
        </article>
      </div>
    </section>
  `
}

function renderProjectArea(kind = 'daw') {
  const source = kind === 'stage' ? state.stage : state.daw
  if (source.loading) return '<p class="studio-recents-empty">Loading projects...</p>'
  if (source.error) return `<p class="studio-recents-empty">${source.error}</p>`
  if (!source.projects.length) {
    return `<div class="studio-projects-empty"><p class="studio-projects-empty-title">No ${kind === 'stage' ? 'Vertix plans' : 'Soura project files'} yet.</p><p>${kind === 'stage' ? 'Create a Vertix project to start building plots, lists, and show files.' : 'Create a project, folder, or import sounds to start building.'}</p></div>`
  }

  const attr = kind === 'stage' ? 'data-open-stage-project' : 'data-open-daw-project'
  return `<div class="studio-project-grid">${source.projects.map((project) => `
    <article class="studio-project-row">
      <div class="studio-card-topline">
        <span class="studio-card-kicker">${kind === 'stage' ? 'Vertix' : 'Soura'}</span>
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
    return `<div class="studio-projects-empty studio-stage-empty"><p class="studio-projects-empty-title">${esc(emptyMessage)}</p><p>Vertix plans you own or collaborate on will appear here.</p></div>`
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
  return `
    <section class="studio-main">
      <section class="studio-hub-hero">
        <div>
          <p class="eyebrow">Creative Dashboard</p>
          <h1>Melogic Studio</h1>
          <p>Your creative workspace for production, stage planning, collaboration, and release prep.</p>
        </div>
        <div class="studio-hub-actions">
          <a class="studio-hub-cta" href="${ROUTES.studioDaw}">Open Soura</a>
          <a class="studio-hub-cta" href="${ROUTES.studioStagemaker}">Open Vertix</a>
        </div>
      </section>

      <div class="studio-section-heading"><h2>CONTINUE WORKING</h2><span class="studio-section-line studio-section-line--recents"></span></div>
      ${state.daw.loading || state.stage.loading ? '<p class="studio-recents-empty">Loading recent work...</p>' : renderRecentLanes()}

      <div class="studio-section-heading"><h2>DEMO PROJECTS</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      <div class="studio-demo-stack">
        ${renderDemoSection('Soura Demos', 'Reference sessions and production examples.', dawDemos)}
        ${renderDemoSection('Vertix Templates', 'Venue layouts and stage-plan starting points.', stageDemos)}
      </div>

      <div class="studio-section-heading"><h2>PROJECT LIBRARY</h2><span class="studio-section-line studio-section-line--projects"></span></div>
      ${renderProjectLibrary()}

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
          <h1>Vertix</h1>
          <p>Vertix is Melogic's stage design and live production planning workspace.</p>
        </div>
        <div class="studio-hub-actions">
          <a class="button button-accent" data-new-stage-project href="${state.user ? '#' : authRoute({ redirect: ROUTES.studioStagemaker })}">New Vertix Plan</a>
          <a class="button button-muted" href="#stage-templates">View Templates</a>
        </div>
      </section>

      <div id="stage-recents" class="studio-section-heading"><h2>CONTINUE WORKING</h2><span class="studio-section-line studio-section-line--recents"></span></div>
      ${state.stage.loading ? '<p class="studio-recents-empty">Loading recent Vertix plans...</p>' : renderStageProjectGrid(state.stage.recentProjects, 'Recent Vertix plans will appear here once you open a Vertix project.')}

      <div id="stage-templates" class="studio-section-heading"><h2>VERTIX TEMPLATES</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderStageTemplateCards()}

      <div class="studio-section-heading"><h2>DEMO STAGE PLANS</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderDemoCards(stageDemos)}

      <div class="studio-section-heading"><h2>MY STAGE PLANS</h2><span class="studio-section-line studio-section-line--projects"></span></div>
      <section class="studio-projects-panel studio-stage-projects-panel"><div class="studio-projects-body">${renderStageProjectArea(state.stage.projects)}</div></section>

      <div class="studio-section-heading"><h2>VERTIX TOOLS</h2><span class="studio-section-line studio-section-line--explore"></span></div>
      ${renderStageTools()}
      <div data-studio-modal-root></div>
    </section>
  `
}

const defaultLiveBookmarks = [
  { bookmarkId: 'operator-note', name: 'Operator Note', actionType: 'operator_note', color: '#6ee7ff', notes: 'Log a note in the playout.' },
  { bookmarkId: 'skip-next', name: 'Skip To Next', actionType: 'skip_to_next_playable', color: '#45f08a', notes: 'Advance to the next playable item.' },
  { bookmarkId: 'stop-current', name: 'Stop After Current', actionType: 'stop_after_current', color: '#ff6b7a', notes: 'Arm stop after the active item.' },
  { bookmarkId: 'top-hour', name: 'Top Of Hour', actionType: 'top_of_hour', color: '#ffd166', notes: 'Insert a top-of-hour marker.' }
]

function liveState() {
  return state.live
}

function liveItems() {
  return liveState().items || []
}

function liveItemById(itemId = '') {
  return liveItems().find((item) => item.itemId === itemId || item.id === itemId) || null
}

function isPlayableLiveItem(item = {}) {
  return item.enabled !== false && item.type !== 'action_bookmark' && Boolean(item.normalizedAudioURLSnapshot)
}

function liveBookmarks() {
  return liveState().bookmarks.length ? liveState().bookmarks : defaultLiveBookmarks
}

function liveSelectedItem() {
  return liveItemById(liveState().selectedItemId) || liveItems().find(isPlayableLiveItem) || null
}

function nextPlayableAfter(itemId = '') {
  const items = liveItems()
  const start = Math.max(0, items.findIndex((item) => item.itemId === itemId) + 1)
  return items.slice(start).find(isPlayableLiveItem) || items.find(isPlayableLiveItem) || null
}

function refreshLiveDecks() {
  const live = liveState()
  const current = liveItemById(live.currentItemId)
  const next = liveItemById(live.nextItemId) || nextPlayableAfter(current?.itemId || live.selectedItemId)
  const afterNext = nextPlayableAfter(next?.itemId || '')
  live.nextItemId = next?.itemId || ''
  live.afterNextItemId = afterNext?.itemId || ''
}

function formatMilitaryStart(msOffset = 0) {
  const date = new Date(Date.now() + Math.max(0, msOffset))
  return `${String(date.getHours()).padStart(2, '0')}${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
}

function liveItemDuration(item = {}) {
  return formatMs(item.durationMs || 0)
}

function liveItemArt(item = {}) {
  if (item.artworkURLSnapshot) return `<img src="${esc(item.artworkURLSnapshot)}" alt="" loading="lazy" />`
  return `<span>${esc((item.titleSnapshot || item.type || '?').slice(0, 1).toUpperCase())}</span>`
}

function renderLiveDeck(slot = 'current', label = 'CURRENT', item = null) {
  const playing = item && liveState().activePlayers.some((player) => player.itemId === item.itemId)
  const roleClass = slot === 'current' ? 'is-current' : slot === 'next' ? 'is-next' : 'is-after-next'
  return `
    <article class="studio-live-deck ${roleClass}">
      <div class="studio-live-deck-label"><span>${label}</span><b>${playing ? 'ON AIR' : item ? 'CUED' : 'EMPTY'}</b></div>
      <div class="studio-live-deck-main">
        <div class="studio-live-deck-art">${item ? liveItemArt(item) : '<span>-</span>'}</div>
        <div class="studio-live-deck-copy">
          <h3>${esc(item?.titleSnapshot || 'No item loaded')}</h3>
          <p>${esc(item?.artistSnapshot || item?.categorySnapshot || 'Sequence deck')}</p>
          <small>${esc(item?.albumSnapshot || item?.type || 'Waiting')} - ${item ? liveItemDuration(item) : '0:00'}</small>
          <div class="studio-live-progress"><i style="width:${playing ? '42%' : '0%'}"></i></div>
        </div>
      </div>
      <div class="studio-live-deck-actions">
        <button type="button" data-live-play-item="${esc(item?.itemId || '')}" ${item && isPlayableLiveItem(item) ? '' : 'disabled'} aria-label="Play ${esc(label)}">▶</button>
        <button type="button" data-live-stop-item="${esc(item?.itemId || '')}" ${playing ? '' : 'disabled'} aria-label="Stop ${esc(label)}">■</button>
        <button type="button" data-live-open-menu="${esc(item?.itemId || '')}" ${item ? '' : 'disabled'} aria-label="Deck menu">⋯</button>
      </div>
    </article>
  `
}

function renderLiveActionBookmarks() {
  return `
    <section class="studio-live-library-section">
      <div class="studio-live-panel-heading">
        <h3>Action Bookmarks</h3>
        <span>${liveBookmarks().length}</span>
      </div>
      <form class="studio-live-bookmark-form" data-live-bookmark-form>
        <input name="name" maxlength="120" placeholder="New action" ${state.user ? '' : 'disabled'} />
        <select name="actionType" ${state.user ? '' : 'disabled'}>
          ${SEQUENCE_ACTION_TYPES.map((type) => `<option value="${esc(type)}">${esc(type.replaceAll('_', ' '))}</option>`).join('')}
        </select>
        <button type="submit" ${state.user ? '' : 'disabled'}>Add</button>
      </form>
      <div class="studio-live-bookmark-list">
        ${liveBookmarks().map((bookmark) => `
          <button type="button" class="studio-live-bookmark" data-live-add-bookmark="${esc(bookmark.bookmarkId)}" style="--bookmark-color:${esc(bookmark.color || '#6ee7ff')}" ${state.user && liveState().activeSequence ? '' : 'disabled'}>
            <strong>${esc(bookmark.name)}</strong>
            <span>${esc(bookmark.actionType.replaceAll('_', ' '))}</span>
          </button>
        `).join('')}
      </div>
    </section>
  `
}

function renderLiveAssets() {
  const live = liveState()
  return `
    <section class="studio-live-library-section studio-live-library-section--assets">
      <div class="studio-live-panel-heading">
        <h3>Media Assets</h3>
        <span>${live.assets.length}</span>
      </div>
      <div class="studio-live-assets">
        ${live.assets.length ? live.assets.map((asset) => `
          <button type="button" class="studio-live-asset-row" data-live-add-asset="${esc(asset.assetId)}" ${state.user && live.activeSequence ? '' : 'disabled'}>
            <span class="studio-live-row-art">${asset.artworkURL ? `<img src="${esc(asset.artworkURL)}" alt="" loading="lazy" />` : esc((asset.title || '?').slice(0, 1).toUpperCase())}</span>
            <span><strong>${esc(asset.title)}</strong><small>${esc(asset.artist || asset.category || 'Media asset')}</small></span>
            <b>${esc(asset.type)}</b>
            <em>${formatMs(asset.durationMs)}</em>
          </button>
        `).join('') : `<p class="studio-live-empty">${state.user ? 'No sequence assets yet. Upload from Sequence Software, then build the show here.' : 'Sign in to load your media assets.'}</p>`}
      </div>
    </section>
  `
}

function renderLiveSequenceRows() {
  const live = liveState()
  let offset = 0
  if (!live.items.length) {
    return `<div class="studio-live-empty studio-live-empty--log">${state.user ? 'Create or select a sequence, then add assets or action bookmarks.' : 'Sign in to operate saved sequences.'}</div>`
  }
  return live.items.map((item, index) => {
    const playing = live.currentItemId === item.itemId || live.activePlayers.some((player) => player.itemId === item.itemId)
    const selected = live.selectedItemId === item.itemId
    const playable = isPlayableLiveItem(item)
    const estimate = formatMilitaryStart(offset)
    offset += playable ? Math.max(0, Number(item.durationMs || 0) - Number(item.crossfadeMs || 0)) : 0
    return `
      <button type="button" class="studio-live-sequence-row ${selected ? 'is-selected' : ''} ${playing ? 'is-playing' : ''} ${item.enabled === false ? 'is-disabled' : ''}" data-live-select-item="${esc(item.itemId)}" data-live-row-menu="${esc(item.itemId)}">
        <span>${index + 1}</span>
        <b>${playing ? 'PLAY' : item.enabled === false ? 'SKIP' : playable ? 'READY' : 'ACT'}</b>
        <span class="studio-live-row-art">${liveItemArt(item)}</span>
        <span>${esc(item.type)}</span>
        <strong>${esc(item.titleSnapshot)}</strong>
        <span>${esc(item.artistSnapshot || '-')}</span>
        <span>${esc(item.albumSnapshot || '-')}</span>
        <span>${esc(item.categorySnapshot || '-')}</span>
        <span>${esc(liveItemDuration(item))}</span>
        <span>${estimate}</span>
        <span>${playing ? 'YES' : '-'}</span>
        <span>${formatMs(item.fadeInMs || 0)} / ${formatMs(item.fadeOutMs || 0)} / ${formatMs(item.crossfadeMs || 0)}</span>
        <span>${playable ? 'OK' : item.type === 'action_bookmark' ? 'ACTION' : 'MISSING'}</span>
        <span>⋯</span>
      </button>
    `
  }).join('')
}

function renderLiveStudio() {
  const live = liveState()
  refreshLiveDecks()
  const current = liveItemById(live.currentItemId)
  const next = liveItemById(live.nextItemId)
  const afterNext = liveItemById(live.afterNextItemId)
  return `
    <section class="studio-live-main">
      <header class="studio-live-header">
        <div>
          <p class="eyebrow">Studio Module</p>
          <h1>Live Studio</h1>
          <p>Operator playout, radio automation, and stream output for Melogic Music.</p>
        </div>
        <div class="studio-live-stream-controls">
          <select data-live-sequence-select ${state.user ? '' : 'disabled'}>
            <option value="">${state.user ? 'Select sequence' : 'Sign in to load sequences'}</option>
            ${live.sequences.map((sequence) => `<option value="${esc(sequence.sequenceId)}" ${live.activeSequence?.sequenceId === sequence.sequenceId ? 'selected' : ''}>${esc(sequence.title)}</option>`).join('')}
          </select>
          <button type="button" data-live-create-sequence ${state.user ? '' : 'disabled'}>New Sequence</button>
          <button type="button" data-live-start-stream ${state.user && !live.starting && !live.streamId ? '' : 'disabled'}>${live.starting ? 'Starting...' : live.streamId ? 'Live Created' : 'Start Live'}</button>
          ${live.streamId ? `<button type="button" data-live-end-stream ${live.ending ? 'disabled' : ''}>${live.ending ? 'Ending...' : 'End Live'}</button>` : ''}
          <a href="${ROUTES.musicGoLive}">Quick Go Live</a>
          <a href="${live.streamId ? `${ROUTES.musicLive}/${encodeURIComponent(live.streamId)}` : ROUTES.musicLive}">Public Live</a>
        </div>
      </header>

      ${live.error ? `<p class="studio-live-error">${esc(live.error)}</p>` : ''}
      <section class="studio-live-decks" aria-label="Live playout decks">
        ${renderLiveDeck('current', 'CURRENT', current)}
        ${renderLiveDeck('next', 'NEXT', next)}
        ${renderLiveDeck('after', 'AFTER NEXT', afterNext)}
      </section>

      <section class="studio-live-workspace">
        <aside class="studio-live-library">
          ${renderLiveActionBookmarks()}
          ${renderLiveAssets()}
        </aside>
        <section class="studio-live-playout">
          <div class="studio-live-panel-heading">
            <h3>Sequence Playout</h3>
            <span>${esc(live.activeSequence?.title || 'No sequence')}</span>
          </div>
          <div class="studio-live-sequence-table">
            <div class="studio-live-sequence-head">
              <span>#</span><span>Status</span><span>Art</span><span>Type</span><span>Title</span><span>Artist</span><span>Album</span><span>Category</span><span>Dur</span><span>ETA</span><span>Playing</span><span>Fade I/O/X</span><span>Source</span><span>Actions</span>
            </div>
            <div class="studio-live-sequence-body">${live.loading ? '<div class="studio-live-empty studio-live-empty--log">Loading Live Studio...</div>' : renderLiveSequenceRows()}</div>
          </div>
        </section>
      </section>

      <footer class="studio-live-footer">
        <div>
          <strong>${esc(live.outputStatus)}</strong>
          <span>${live.streamId ? `Live stream: ${esc(live.streamId)}` : 'Browser input source remains available from Quick Go Live.'}</span>
        </div>
        <button type="button" class="studio-live-transport-play" data-live-play-selected>▶ Play Selected</button>
        <button type="button" class="studio-live-transport-stop" data-live-stop-all>■ Stop All</button>
      </footer>
      ${live.contextMenu ? renderLiveContextMenu(live.contextMenu) : ''}
      <div data-studio-modal-root></div>
    </section>
  `
}

function renderLiveContextMenu(menu = {}) {
  return `
    <div class="studio-live-context-menu" style="left:${Math.max(8, menu.x || 0)}px;top:${Math.max(8, menu.y || 0)}px" data-live-context-menu>
      <strong>${esc(liveItemById(menu.itemId)?.titleSnapshot || 'Sequence item')}</strong>
      <button type="button" data-live-context-action="play" data-item-id="${esc(menu.itemId)}">Play now</button>
      <button type="button" data-live-context-action="next" data-item-id="${esc(menu.itemId)}">Set as next</button>
      <button type="button" data-live-context-action="duplicate" data-item-id="${esc(menu.itemId)}">Duplicate</button>
      <button type="button" data-live-context-action="toggle" data-item-id="${esc(menu.itemId)}">Toggle skip</button>
    </div>
  `
}

function renderShell() {
  const active = currentStudioSection()
  const content = active === 'hub' ? renderHub() : active === 'stagemaker' ? renderStagemaker() : active === 'live' ? renderLiveStudio() : renderDaw()
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
    : 'Could not load Soura projects.'
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
    state.stage.error = 'Could not load Vertix projects.'
  }
}

async function loadLiveStudioItems() {
  const live = liveState()
  if (!state.user?.uid || !live.activeSequence?.sequenceId) {
    live.items = []
    return
  }
  live.items = await listSequenceItems(state.user.uid, live.activeSequence.sequenceId)
  if (!live.selectedItemId && live.items.length) live.selectedItemId = live.items.find(isPlayableLiveItem)?.itemId || live.items[0].itemId
  if (!live.currentItemId) live.currentItemId = ''
  refreshLiveDecks()
}

async function loadLiveStudioData() {
  const live = liveState()
  live.loading = true
  live.error = ''
  try {
    const [assets, sequences, bookmarks] = await Promise.all([
      listSequenceAssets(state.user.uid, { limitCount: 50, status: 'ready', sort: 'updated_desc' }),
      listSequences(state.user.uid, 50),
      listSequenceActionBookmarks(state.user.uid)
    ])
    live.assets = assets
    live.sequences = sequences
    live.bookmarks = bookmarks
    if (!live.activeSequence || !sequences.some((sequence) => sequence.sequenceId === live.activeSequence?.sequenceId)) {
      live.activeSequence = sequences[0] || null
      live.selectedItemId = ''
      live.currentItemId = ''
      live.nextItemId = ''
      live.afterNextItemId = ''
    }
    await loadLiveStudioItems()
  } catch (error) {
    console.error('[studio-live] load failed', error)
    live.error = 'Could not load Live Studio data.'
  } finally {
    live.loading = false
  }
}

async function loadProjectsForCurrentRoute() {
  if (!state.user?.uid) {
    state.daw = { projects: [], recentProjects: [], loading: false, error: '' }
    state.stage = { projects: [], recentProjects: [], loading: false, error: '' }
    state.live = { ...state.live, loading: false, error: '', assets: [], sequences: [], bookmarks: [], activeSequence: null, items: [], selectedItemId: '', currentItemId: '', nextItemId: '', afterNextItemId: '' }
    renderShell()
    return
  }

  const active = currentStudioSection()
  const wantsDaw = active === 'hub' || active === 'daw'
  const wantsStage = active === 'hub' || active === 'stagemaker'
  const wantsLive = active === 'live'
  if (wantsDaw) state.daw.loading = true
  if (wantsStage) state.stage.loading = true
  if (wantsLive) state.live.loading = true
  renderShell()

  await Promise.allSettled([
    wantsDaw ? loadDawData() : Promise.resolve(),
    wantsStage ? loadStageData() : Promise.resolve(),
    wantsLive ? loadLiveStudioData() : Promise.resolve()
  ])

  if (wantsDaw) state.daw.loading = false
  if (wantsStage) state.stage.loading = false
  if (wantsLive) state.live.loading = false
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

function ensureLiveAudioGraph() {
  const live = liveState()
  if (live.audioContext && live.masterGain && live.destination) return live
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) throw new Error('This browser cannot run Live Studio audio.')
  const context = new AudioContextCtor()
  const masterGain = context.createGain()
  const destination = context.createMediaStreamDestination()
  masterGain.gain.value = 1
  masterGain.connect(context.destination)
  masterGain.connect(destination)
  live.audioContext = context
  live.masterGain = masterGain
  live.destination = destination
  live.outputTrack = destination.stream.getAudioTracks()[0] || null
  return live
}

function stopLiveStudioPlayer(playerId = '') {
  const live = liveState()
  const player = live.activePlayers.find((entry) => entry.playerId === playerId || entry.itemId === playerId)
  if (!player) return
  try { player.audio.pause() } catch {}
  try { player.source.disconnect() } catch {}
  try { player.gain.disconnect() } catch {}
  try {
    player.audio.removeAttribute('src')
    player.audio.load?.()
  } catch {}
  live.activePlayers = live.activePlayers.filter((entry) => entry !== player)
  if (live.currentItemId === player.itemId) live.currentItemId = live.activePlayers[0]?.itemId || ''
  live.outputStatus = live.activePlayers.length ? `${live.activePlayers.length} deck${live.activePlayers.length === 1 ? '' : 's'} playing.` : 'Sequence Software input ready.'
}

function stopLiveStudioAll() {
  ;[...liveState().activePlayers].forEach((player) => stopLiveStudioPlayer(player.playerId))
  liveState().currentItemId = ''
  liveState().outputStatus = 'All decks stopped.'
  renderShell()
}

async function playLiveStudioItem(itemId = '') {
  const item = liveItemById(itemId)
  const live = liveState()
  if (!item || !isPlayableLiveItem(item)) {
    live.outputStatus = 'Selected item has no playable audio source.'
    renderShell()
    return
  }
  const graph = ensureLiveAudioGraph()
  if (graph.audioContext?.state === 'suspended') await graph.audioContext.resume()
  const audio = new Audio(item.normalizedAudioURLSnapshot)
  audio.crossOrigin = 'anonymous'
  audio.preload = 'auto'
  const source = graph.audioContext.createMediaElementSource(audio)
  const gain = graph.audioContext.createGain()
  const linearGain = Math.pow(10, Number(item.gainDb || 0) / 20)
  gain.gain.value = Number.isFinite(linearGain) ? linearGain : 1
  source.connect(gain)
  gain.connect(graph.masterGain)
  const playerId = `${item.itemId}-${Date.now()}`
  const player = { playerId, itemId: item.itemId, audio, source, gain }
  live.activePlayers.push(player)
  live.currentItemId = item.itemId
  live.selectedItemId = item.itemId
  live.outputStatus = `Playing ${item.titleSnapshot || 'selected item'} through Live Studio output.`
  audio.addEventListener('ended', () => {
    stopLiveStudioPlayer(playerId)
    const next = liveItemById(live.nextItemId)
    live.currentItemId = ''
    if (next && isPlayableLiveItem(next)) playLiveStudioItem(next.itemId).catch(() => {})
    else renderShell()
  }, { once: true })
  try {
    await audio.play()
  } catch (error) {
    stopLiveStudioPlayer(playerId)
    live.outputStatus = 'Browser blocked playback. Click Play Selected again.'
    console.warn('[studio-live] playback failed', error)
  }
  refreshLiveDecks()
  renderShell()
}

async function setLiveSequence(sequenceId = '') {
  const live = liveState()
  live.activeSequence = live.sequences.find((sequence) => sequence.sequenceId === sequenceId) || null
  live.selectedItemId = ''
  live.currentItemId = ''
  live.nextItemId = ''
  live.afterNextItemId = ''
  await loadLiveStudioItems()
  renderShell()
}

async function createLiveSequence() {
  if (!state.user?.uid) return
  const title = `Live Studio ${new Date().toLocaleDateString()}`
  const sequence = await createSequence(state.user.uid, { title, mode: 'manual' })
  liveState().sequences = [sequence, ...liveState().sequences]
  await setLiveSequence(sequence.sequenceId)
}

async function addLiveAsset(assetId = '') {
  const live = liveState()
  const asset = live.assets.find((entry) => entry.assetId === assetId)
  if (!state.user?.uid || !live.activeSequence || !asset) return
  await addAssetToSequence(state.user.uid, live.activeSequence.sequenceId, asset, live.activeSequence)
  await loadLiveStudioData()
  renderShell()
}

async function addLiveBookmark(bookmarkId = '') {
  const live = liveState()
  const bookmark = liveBookmarks().find((entry) => entry.bookmarkId === bookmarkId)
  if (!state.user?.uid || !live.activeSequence || !bookmark) return
  if (bookmarkId && defaultLiveBookmarks.some((entry) => entry.bookmarkId === bookmarkId) && !live.bookmarks.some((entry) => entry.bookmarkId === bookmarkId)) {
    const saved = await createSequenceActionBookmark(state.user.uid, bookmark)
    live.bookmarks = [saved, ...live.bookmarks]
    await addActionBookmarkToSequence(state.user.uid, live.activeSequence.sequenceId, saved, live.activeSequence)
  } else {
    await addActionBookmarkToSequence(state.user.uid, live.activeSequence.sequenceId, bookmark, live.activeSequence)
  }
  await loadLiveStudioData()
  renderShell()
}

async function duplicateLiveItem(itemId = '') {
  const live = liveState()
  const item = liveItemById(itemId)
  if (!state.user?.uid || !live.activeSequence || !item) return
  await duplicateSequenceItem(state.user.uid, live.activeSequence.sequenceId, item, live.activeSequence)
  await loadLiveStudioData()
  renderShell()
}

async function toggleLiveItemEnabled(itemId = '') {
  const live = liveState()
  const item = liveItemById(itemId)
  if (!state.user?.uid || !live.activeSequence || !item) return
  await updateSequenceItem(state.user.uid, live.activeSequence.sequenceId, item.itemId, { enabled: item.enabled === false })
  await loadLiveStudioData()
  renderShell()
}

async function startLiveStudioStream() {
  const live = liveState()
  if (!state.user?.uid || live.starting || live.streamId) return
  live.starting = true
  live.error = ''
  live.outputStatus = 'Creating Melogic Music live stream...'
  renderShell()
  let pendingStreamId = ''
  try {
    const graph = ensureLiveAudioGraph()
    if (graph.audioContext?.state === 'suspended') await graph.audioContext.resume()
    if (!graph.outputTrack) throw new Error('Live Studio output track is not available.')
    const response = await startMusicLiveStream({
      streamId: '',
      title: live.activeSequence?.title || 'Live Studio Broadcast',
      description: 'Live Studio sequence output from Melogic Studio.',
      category: 'radio',
      visibility: 'public',
      accessMode: 'public',
      password: '',
      coverArtURL: '',
      coverArtPath: '',
      coverArtSource: '',
      tags: ['live-studio'],
      audioMode: 'browser',
      rightsAccepted: true,
      archiveRequested: false,
      audioOnly: true
    })
    pendingStreamId = response.streamId || ''
    const room = new Room({ adaptiveStream: true, dynacast: true })
    live.room = room
    live.streamId = pendingStreamId
    live.outputStatus = 'Connecting Live Studio host room...'
    room.on(RoomEvent.Connected, () => {
      live.outputStatus = 'Host room connected. Publishing Sequence Software output...'
      renderShell()
    })
    room.on(RoomEvent.Reconnecting, () => {
      live.outputStatus = 'Reconnecting Live Studio host room...'
      renderShell()
    })
    room.on(RoomEvent.Disconnected, () => {
      live.outputStatus = live.ending ? 'Live Studio disconnected.' : 'Live Studio disconnected unexpectedly.'
      live.room = null
      live.localTrack = null
      if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
      live.heartbeatTimer = 0
      renderShell()
    })
    await room.connect(response.url, response.hostToken)
    live.localTrack = graph.outputTrack
    await room.localParticipant.publishTrack(graph.outputTrack, {
      audioPreset: AudioPresets.musicHighQualityStereo,
      dtx: false,
      red: true,
      forceStereo: true
    })
    await markMusicLiveStreamOnAir(pendingStreamId)
    if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
    live.heartbeatTimer = window.setInterval(() => {
      if (!live.streamId) return
      heartbeatMusicLiveStream(live.streamId, {
        audioPublished: true,
        connectionStatus: 'connected'
      }).catch(() => {})
    }, 25000)
    live.outputStatus = 'On air. Sequence Software output is publishing to Melogic Music.'
  } catch (error) {
    console.error('[studio-live] start stream failed', error)
    if (pendingStreamId) await endMusicLiveStream(pendingStreamId).catch(() => {})
    live.streamId = ''
    live.room?.disconnect?.()
    live.room = null
    live.localTrack = null
    live.error = error?.message || 'Could not start Live Studio stream.'
    live.outputStatus = 'Live stream start failed.'
  } finally {
    live.starting = false
    renderShell()
  }
}

async function endLiveStudioStream() {
  const live = liveState()
  if (!live.streamId || live.ending) return
  const streamId = live.streamId
  live.ending = true
  live.outputStatus = 'Ending Live Studio stream...'
  renderShell()
  try {
    if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
    live.heartbeatTimer = 0
    try {
      if (live.localTrack) await live.room?.localParticipant?.unpublishTrack?.(live.localTrack, true)
    } catch {}
    live.room?.disconnect?.()
    await endMusicLiveStream(streamId)
    live.streamId = ''
    live.room = null
    live.localTrack = null
    live.outputStatus = 'Live Studio stream ended.'
  } catch (error) {
    console.error('[studio-live] end stream failed', error)
    live.error = error?.message || 'Could not end Live Studio stream.'
    live.outputStatus = 'Live Studio end failed.'
  } finally {
    live.ending = false
    renderShell()
  }
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

function bindLiveStudioControls() {
  const live = liveState()
  app.querySelector('[data-live-sequence-select]')?.addEventListener('change', (e) => {
    setLiveSequence(e.currentTarget.value).catch((error) => {
      console.error('[studio-live] sequence select failed', error)
      live.error = 'Could not open that sequence.'
      renderShell()
    })
  })
  app.querySelector('[data-live-create-sequence]')?.addEventListener('click', () => {
    createLiveSequence().catch((error) => {
      console.error('[studio-live] sequence create failed', error)
      live.error = 'Could not create a sequence.'
      renderShell()
    })
  })
  app.querySelector('[data-live-start-stream]')?.addEventListener('click', () => startLiveStudioStream())
  app.querySelector('[data-live-end-stream]')?.addEventListener('click', () => endLiveStudioStream())
  app.querySelectorAll('[data-live-add-asset]').forEach((el) => el.addEventListener('click', () => {
    addLiveAsset(el.dataset.liveAddAsset).catch((error) => {
      console.error('[studio-live] add asset failed', error)
      live.error = 'Could not add that asset.'
      renderShell()
    })
  }))
  app.querySelectorAll('[data-live-add-bookmark]').forEach((el) => el.addEventListener('click', () => {
    addLiveBookmark(el.dataset.liveAddBookmark).catch((error) => {
      console.error('[studio-live] add bookmark failed', error)
      live.error = 'Could not add that action bookmark.'
      renderShell()
    })
  }))
  app.querySelector('[data-live-bookmark-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!state.user?.uid) return
    const data = new FormData(e.currentTarget)
    const name = String(data.get('name') || '').trim()
    if (!name) return
    try {
      const bookmark = await createSequenceActionBookmark(state.user.uid, {
        name,
        actionType: String(data.get('actionType') || 'operator_note'),
        color: '#6ee7ff',
        notes: ''
      })
      live.bookmarks = [bookmark, ...live.bookmarks]
      renderShell()
    } catch (error) {
      console.error('[studio-live] bookmark create failed', error)
      live.error = 'Could not create that action bookmark.'
      renderShell()
    }
  })
  app.querySelectorAll('[data-live-select-item]').forEach((el) => {
    el.addEventListener('click', () => {
      live.selectedItemId = el.dataset.liveSelectItem || ''
      live.contextMenu = null
      refreshLiveDecks()
      renderShell()
    })
    el.addEventListener('dblclick', () => {
      live.nextItemId = el.dataset.liveSelectItem || ''
      refreshLiveDecks()
      renderShell()
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      live.selectedItemId = el.dataset.liveSelectItem || ''
      live.contextMenu = { itemId: el.dataset.liveSelectItem || '', x: e.clientX, y: e.clientY }
      renderShell()
    })
  })
  app.querySelectorAll('[data-live-play-item]').forEach((el) => el.addEventListener('click', () => playLiveStudioItem(el.dataset.livePlayItem)))
  app.querySelectorAll('[data-live-stop-item]').forEach((el) => el.addEventListener('click', () => {
    stopLiveStudioPlayer(el.dataset.liveStopItem)
    refreshLiveDecks()
    renderShell()
  }))
  app.querySelector('[data-live-play-selected]')?.addEventListener('click', () => {
    const item = liveItemById(live.selectedItemId) || liveSelectedItem()
    playLiveStudioItem(item?.itemId || '').catch(() => {})
  })
  app.querySelector('[data-live-stop-all]')?.addEventListener('click', () => stopLiveStudioAll())
  app.querySelectorAll('[data-live-context-action]').forEach((el) => el.addEventListener('click', async () => {
    const itemId = el.dataset.itemId || ''
    const action = el.dataset.liveContextAction || ''
    live.contextMenu = null
    if (action === 'play') await playLiveStudioItem(itemId)
    else if (action === 'next') {
      live.nextItemId = itemId
      refreshLiveDecks()
      renderShell()
    } else if (action === 'duplicate') await duplicateLiveItem(itemId)
    else if (action === 'toggle') await toggleLiveItemEnabled(itemId)
  }))
  document.addEventListener('click', (e) => {
    if (!live.contextMenu || e.target.closest?.('[data-live-context-menu]')) return
    live.contextMenu = null
    renderShell()
  }, { once: true })
}

function bind() {
  if (currentStudioSection() === 'live') bindLiveStudioControls()
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
