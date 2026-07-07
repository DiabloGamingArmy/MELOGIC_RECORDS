import './styles/base.css'
import './styles/studio.css'
import { AudioPresets, Room, RoomEvent, createLocalAudioTrack } from 'livekit-client'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { ROUTES, authRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import {
  deleteMusicLiveSequenceItem,
  endMusicLiveStream,
  heartbeatMusicLiveStream,
  markMusicLiveStreamOnAir,
  sendMusicLiveChatMessage,
  setMusicLiveNowPlaying,
  startMusicLiveStream,
  subscribeMusicLiveChat,
  subscribeMusicLiveStream,
  updateMusicLiveStreamInfo,
  upsertMusicLiveSequenceItem
} from './data/musicLiveService'
import {
  SEQUENCE_ACTION_TYPES,
  addActionBookmarkToSequence,
  addAssetToSequence,
  createSequence,
  createSequenceActionBookmark,
  deleteSequence,
  deleteSequenceItem,
  duplicateSequence,
  duplicateSequenceItem,
  formatMs,
  listSequenceActionBookmarks,
  listSequenceAssets,
  listSequenceItems,
  listSequences,
  updateSequence,
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
    sourceTrack: null,
    heartbeatTimer: 0,
    stream: null,
    streamUnsubscribe: null,
    chatUnsubscribe: null,
    chatMessages: [],
    panel: '',
    inputSource: 'browser',
    selectedDeviceId: '',
    devices: [],
    devicesLoading: false,
    micPrepared: false,
    micPreparing: false,
    sourceMessage: '',
    streamForm: {
      title: 'Live Studio Broadcast',
      description: '',
      category: 'radio',
      tags: '',
      visibility: 'public',
      accessMode: 'public',
      password: '',
      coverArtURL: '',
      rightsAccepted: false,
      audioMode: 'music'
    },
    savingInfo: false,
    sequenceMenuOpen: false,
    menu: null,
    metadata: {
      title: '',
      artist: '',
      album: '',
      artworkURL: '',
      notes: '',
      override: false,
      saving: false
    },
    chatDraft: '',
    outputStatus: 'Sequence Software input ready.',
    monitorEnabled: false,
    monitorVolume: 0.85,
    monitorConnected: false,
    micLevel: 0,
    micMeterTimer: 0,
    micMeterContext: null,
    micMeterAnalyser: null,
    micMeterSource: null,
    playbackTimer: 0
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

function isLiveMonitorRoute() {
  const pathname = window.location.pathname || ''
  return pathname.startsWith(`${ROUTES.studioLive}/monitor`) || pathname.startsWith(`${ROUTES.studioLive}/preview`)
}

const livePanels = [
  ['stream', 'Stream Details'],
  ['input', 'Input Source'],
  ['sequence', 'Sequence Editor'],
  ['metadata', 'Manual Metadata'],
  ['chat', 'Chat'],
  ['preview', 'Preview / Monitor'],
  ['settings', 'Safety']
]

function currentLivePanel() {
  const params = new URLSearchParams(window.location.search || '')
  const raw = params.get('panel') || String(window.location.hash || '').replace(/^#/, '') || liveState().panel || 'stream'
  return livePanels.some(([key]) => key === raw) ? raw : 'stream'
}

function livePanelHref(panel = 'stream') {
  return `${ROUTES.studioLive}?panel=${encodeURIComponent(panel)}`
}

function setLivePanel(panel = 'stream', { replace = false } = {}) {
  const clean = livePanels.some(([key]) => key === panel) ? panel : 'stream'
  state.live.panel = clean
  const url = livePanelHref(clean)
  if (replace) window.history.replaceState({ livePanel: clean }, '', url)
  else window.history.pushState({ livePanel: clean }, '', url)
  renderShell()
}

function renderLiveRail(activePanel = 'stream') {
  return `
    <aside class="studio-live-rail" aria-label="Live Studio tools">
      <div class="studio-live-rail-brand">
        <strong>LIVE</strong>
        <span>${state.live.stream?.status || state.live.streamId ? esc(state.live.stream?.status || 'starting') : 'draft'}</span>
      </div>
      <nav>
        ${livePanels.map(([key, label]) => `<a class="${activePanel === key ? 'is-active' : ''}" href="${livePanelHref(key)}" data-live-panel="${esc(key)}"><span>${esc(label)}</span></a>`).join('')}
      </nav>
    </aside>
  `
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

function livePlayerForItem(itemId = '') {
  return liveState().activePlayers.find((player) => player.itemId === itemId) || null
}

function livePlayerProgress(player = null, item = {}) {
  const audio = player?.audio
  const duration = Number.isFinite(audio?.duration) && audio.duration > 0
    ? audio.duration
    : Math.max(0, Number(item.durationMs || 0) / 1000)
  const current = Math.min(duration || 0, Math.max(0, Number(audio?.currentTime || 0)))
  const ratio = duration > 0 ? current / duration : 0
  return {
    current,
    duration,
    percent: Math.max(0, Math.min(100, ratio * 100)),
    value: Math.round(Math.max(0, Math.min(1000, ratio * 1000)))
  }
}

function liveItemArt(item = {}) {
  if (item.artworkURLSnapshot) return `<img src="${esc(item.artworkURLSnapshot)}" alt="" loading="lazy" />`
  return `<span>${esc((item.titleSnapshot || item.type || '?').slice(0, 1).toUpperCase())}</span>`
}

function renderLiveDeck(slot = 'current', label = 'CURRENT', item = null) {
  const player = item ? livePlayerForItem(item.itemId) : null
  const playing = Boolean(player && !player.paused)
  const paused = Boolean(player?.paused)
  const progress = livePlayerProgress(player, item || {})
  const roleClass = slot === 'current' ? 'is-current' : slot === 'next' ? 'is-next' : 'is-after-next'
  return `
    <article class="studio-live-deck ${roleClass}">
      <div class="studio-live-deck-label"><span>${label}</span><b>${playing ? 'ON AIR' : paused ? 'PAUSED' : item ? 'CUED' : 'EMPTY'}</b></div>
      <div class="studio-live-deck-main">
        <div class="studio-live-deck-art">${item ? liveItemArt(item) : '<span>-</span>'}</div>
        <div class="studio-live-deck-copy">
          <h3>${esc(item?.titleSnapshot || 'No item loaded')}</h3>
          <p>${esc(item?.artistSnapshot || item?.categorySnapshot || 'Sequence deck')}</p>
          <small>${esc(item?.albumSnapshot || item?.type || 'Waiting')} - ${item ? liveItemDuration(item) : '0:00'}</small>
          <label class="studio-live-progress">
            <span><i style="width:${progress.percent}%"></i><b style="left:${progress.percent}%"></b></span>
            <input type="range" min="0" max="1000" value="${progress.value}" data-live-scrub-item="${esc(item?.itemId || '')}" ${player && progress.duration > 0 ? '' : 'disabled'} aria-label="Scrub ${esc(label)}" />
          </label>
          <small>${formatMs(progress.current * 1000)} / ${formatMs(progress.duration * 1000)}</small>
        </div>
      </div>
      <div class="studio-live-deck-actions">
        <button type="button" data-live-play-item="${esc(item?.itemId || '')}" ${item && isPlayableLiveItem(item) ? '' : 'disabled'} aria-label="${paused ? 'Resume' : 'Play'} ${esc(label)}">▶</button>
        <button type="button" data-live-pause-item="${esc(item?.itemId || '')}" ${player ? '' : 'disabled'} aria-label="Pause ${esc(label)}">Ⅱ</button>
        <button type="button" data-live-stop-item="${esc(item?.itemId || '')}" ${player ? '' : 'disabled'} aria-label="Stop ${esc(label)}">■</button>
        <button type="button" data-live-deck-menu="${esc(item?.itemId || '')}" ${item ? '' : 'disabled'} aria-label="Deck menu">⋯</button>
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
        ${live.loading ? '<p class="studio-live-empty">Loading asset metadata...</p>' : live.assets.length ? live.assets.map((asset) => `
          <div class="studio-live-asset-row" data-live-asset-row="${esc(asset.assetId)}">
            <button type="button" class="studio-live-asset-main" data-live-add-asset="${esc(asset.assetId)}" ${state.user && live.activeSequence ? '' : 'disabled'}>
              <span class="studio-live-row-art">${asset.artworkURL ? `<img src="${esc(asset.artworkURL)}" alt="" loading="lazy" />` : esc((asset.title || '?').slice(0, 1).toUpperCase())}</span>
              <span><strong>${esc(asset.title)}</strong><small>${esc(asset.artist || asset.category || 'Media asset')}</small></span>
              <b>${esc(asset.type)}</b>
              <em>${formatMs(asset.durationMs)}</em>
            </button>
            <button type="button" class="studio-live-row-menu-button" data-live-asset-menu="${esc(asset.assetId)}" aria-label="Asset actions">⋯</button>
          </div>
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
      <div role="button" tabindex="0" class="studio-live-sequence-row ${selected ? 'is-selected' : ''} ${playing ? 'is-playing' : ''} ${item.enabled === false ? 'is-disabled' : ''}" data-live-select-item="${esc(item.itemId)}" data-live-row-menu="${esc(item.itemId)}">
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
        <span><button type="button" class="studio-live-row-menu-button" data-live-sequence-menu="${esc(item.itemId)}" aria-label="Sequence item actions">⋯</button></span>
      </div>
    `
  }).join('')
}

function publicLiveLink() {
  return liveState().streamId ? `${window.location.origin}${ROUTES.musicLive}/${encodeURIComponent(liveState().streamId)}` : ''
}

function statusBadge(stream = liveState().stream || {}) {
  const status = stream.status || (liveState().streamId ? 'starting' : 'draft')
  return `<span class="studio-live-status-badge is-${esc(status)}">${esc(status)}</span>`
}

function renderListenerPreviewPanel() {
  const live = liveState()
  const form = live.streamForm
  const item = liveItemById(live.currentItemId)
  const link = publicLiveLink()
  return `
    <aside class="studio-live-listener-preview" aria-label="Listener page preview">
      <div class="studio-live-listener-art" data-live-preview-cover>
        ${form.coverArtURL ? `<img src="${esc(form.coverArtURL)}" alt="" />` : '<span>MR</span>'}
      </div>
      <div class="studio-live-listener-copy">
        <p class="eyebrow">Public Listener Preview</p>
        <h2 data-live-preview-title>${esc(form.title || 'Live Studio Broadcast')}</h2>
        <p data-live-preview-description>${esc(form.description || 'Listeners will see stream details here when the broadcast is live.')}</p>
      </div>
      <div class="studio-live-listener-meta">
        <span data-live-preview-status>${esc(live.stream?.status || (live.streamId ? 'starting' : 'draft'))}</span>
        <span data-live-preview-category>${esc(form.category || 'radio')}</span>
        <span data-live-preview-access>${esc(form.accessMode || form.visibility || 'public')}</span>
      </div>
      <div class="studio-live-now-playing-preview">
        <strong>Now playing</strong>
        <span>${esc(item?.titleSnapshot || live.metadata.title || 'Waiting for sequence metadata')}</span>
        <small>${esc(item?.artistSnapshot || live.metadata.artist || live.outputStatus)}</small>
      </div>
      ${link ? `<a href="${esc(link)}" target="_blank" rel="noreferrer">Open public listener page</a>` : '<small>Public link appears after Start Live.</small>'}
    </aside>
  `
}

function renderStreamDetailsPanel() {
  const live = liveState()
  const form = live.streamForm
  const link = publicLiveLink()
  return `
    <section class="studio-live-panel studio-live-stream-panel">
      <header class="studio-live-subheader">
        <div>
          <p class="eyebrow">Live Studio</p>
          <h1>Stream Details</h1>
          <p>Set up a simple browser-input stream or manage the public listener details for an active broadcast.</p>
        </div>
        <div class="studio-live-status-cluster">
          ${statusBadge()}
          <span>${Number(live.stream?.listenerCount || 0)} viewers</span>
        </div>
      </header>
      <div class="studio-live-stream-layout">
        <form class="studio-live-details-form" data-live-stream-form>
          <label>Stream title<input name="title" maxlength="90" required value="${esc(form.title)}" /></label>
          <label>Description<textarea name="description" maxlength="1200">${esc(form.description)}</textarea></label>
          <div class="studio-live-form-grid">
            <label>Category<select name="category">${['music', 'podcast', 'radio', 'interview', 'listening_party', 'creator_talk', 'other'].map((category) => `<option value="${category}" ${form.category === category ? 'selected' : ''}>${esc(category.replaceAll('_', ' '))}</option>`).join('')}</select></label>
            <label>Visibility<select name="visibility"><option value="public" ${form.visibility === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${form.visibility === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${form.visibility === 'private' ? 'selected' : ''}>Private</option></select></label>
            <label>Access<select name="accessMode"><option value="public" ${form.accessMode === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${form.accessMode === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="password" ${form.accessMode === 'password' ? 'selected' : ''}>Password</option><option value="private" ${form.accessMode === 'private' ? 'selected' : ''}>Private</option></select></label>
            <label>Password<input name="password" type="password" autocomplete="new-password" value="${esc(form.password)}" placeholder="${form.accessMode === 'password' ? 'Required for new password streams' : 'Only used for password access'}" /></label>
          </div>
          <label>Tags<input name="tags" value="${esc(form.tags)}" placeholder="radio, release party, talk" /></label>
          <label>Cover image URL<input name="coverArtURL" value="${esc(form.coverArtURL)}" placeholder="https://..." /></label>
          <label class="studio-live-check"><input name="rightsAccepted" type="checkbox" ${form.rightsAccepted ? 'checked' : ''} /> I have the rights and permissions required to broadcast this stream.</label>
          <div class="studio-live-action-bar">
            <button type="submit" data-live-save-info ${live.savingInfo ? 'disabled' : ''}>${live.streamId ? 'Save / Update Stream Info' : 'Save Draft Details'}</button>
            <button type="button" data-live-start-stream ${state.user && !live.starting && !live.streamId ? '' : 'disabled'}>${live.starting ? 'Starting...' : 'Start Live'}</button>
            ${live.streamId ? `<button type="button" data-live-end-stream ${live.ending ? 'disabled' : ''}>${live.ending ? 'Ending...' : 'End Stream'}</button>` : ''}
            ${link ? `<button type="button" data-copy-live-link="${esc(link)}">Copy Public Link</button><a href="${esc(link)}" target="_blank" rel="noreferrer">Open Public Listener Page</a>` : ''}
          </div>
        </form>
        ${renderListenerPreviewPanel()}
      </div>
    </section>
  `
}

function renderInputSourcePanel() {
  const live = liveState()
  return `
    <section class="studio-live-panel">
      <header class="studio-live-subheader">
        <div>
          <p class="eyebrow">Live Studio</p>
          <h1>Input Source</h1>
          <p>Choose what feeds the Melogic Music listener stream.</p>
        </div>
      </header>
      <div class="studio-live-source-grid">
        <article class="studio-live-source-option ${live.inputSource === 'browser' ? 'is-active' : ''}">
          <div>
            <h2>Browser Input Source</h2>
            <p>Use a microphone, audio interface, virtual cable, or mixer exposed to the browser.</p>
          </div>
          <label>Device<select data-live-device-select ${live.devicesLoading ? 'disabled' : ''}>
            <option value="">Default input</option>
            ${live.devices.map((device) => `<option value="${esc(device.deviceId)}" ${live.selectedDeviceId === device.deviceId ? 'selected' : ''}>${esc(device.label || `Input ${device.deviceId.slice(0, 6)}`)}</option>`).join('')}
          </select></label>
          <label>Audio quality<select data-live-audio-mode><option value="music" ${live.streamForm.audioMode === 'music' ? 'selected' : ''}>Music quality stereo</option><option value="voice" ${live.streamForm.audioMode === 'voice' ? 'selected' : ''}>Voice optimized</option></select></label>
          <div class="studio-live-meter" aria-label="Browser input level"><i data-live-meter-fill style="width:${Math.round((live.micLevel || 0) * 100)}%"></i></div>
          <div class="studio-live-action-bar">
            <button type="button" data-live-set-source="browser" ${live.inputSource === 'browser' ? 'disabled' : ''}>Use Browser Input</button>
            <button type="button" data-live-refresh-devices>${live.devicesLoading ? 'Refreshing...' : 'Refresh Mic'}</button>
            <button type="button" data-live-prepare-mic ${live.micPreparing ? 'disabled' : ''}>${live.micPrepared ? 'Mic Ready' : live.micPreparing ? 'Preparing...' : 'Enable Mic'}</button>
          </div>
        </article>
        <article class="studio-live-source-option ${live.inputSource === 'sequence' ? 'is-active' : ''}">
          <div>
            <h2>Sequence Editor / Sequence Software</h2>
            <p>Use the internal playout engine as the stream source. No microphone is required.</p>
          </div>
          <p class="studio-live-source-status">${esc(live.activeSequence?.title || 'No sequence selected')}</p>
          <div class="studio-live-action-bar">
            <button type="button" data-live-set-source="sequence" ${live.inputSource === 'sequence' ? 'disabled' : ''}>Use Sequence Output</button>
            <a href="${livePanelHref('sequence')}" data-live-panel="sequence">Open Sequence Editor</a>
          </div>
        </article>
      </div>
      ${live.sourceMessage ? `<p class="studio-live-error">${esc(live.sourceMessage)}</p>` : ''}
    </section>
  `
}

function renderSequenceManagement() {
  const live = liveState()
  return `
    <div class="studio-live-sequence-controls">
      <button type="button" data-live-sequence-menu-toggle aria-label="Sequence menu">⋯</button>
      <select data-live-sequence-select ${state.user ? '' : 'disabled'}>
        <option value="">${state.user ? 'Select sequence' : 'Sign in to load sequences'}</option>
        ${live.sequences.map((sequence) => `<option value="${esc(sequence.sequenceId)}" ${live.activeSequence?.sequenceId === sequence.sequenceId ? 'selected' : ''}>${esc(sequence.title)}</option>`).join('')}
      </select>
      <button type="button" data-live-create-sequence ${state.user ? '' : 'disabled'}>New Sequence</button>
      ${live.sequenceMenuOpen ? `<div class="studio-live-dropdown-menu" data-live-sequence-dropdown><button data-live-sequence-action="rename">Rename Sequence</button><button data-live-sequence-action="duplicate">Duplicate Sequence</button><button data-live-sequence-action="delete">Delete Sequence</button><button data-live-sequence-action="export">Export Sequence JSON</button><button data-live-sequence-action="import">Import Sequence JSON</button><button data-live-sequence-action="default">Set as Default</button><button data-live-sequence-action="clear">Clear Playout Log</button></div>` : ''}
    </div>
  `
}

function renderSequenceEditorPanel() {
  const live = liveState()
  refreshLiveDecks()
  const current = liveItemById(live.currentItemId)
  const next = liveItemById(live.nextItemId)
  const afterNext = liveItemById(live.afterNextItemId)
  return `
    <section class="studio-live-sequence-panel">
      <header class="studio-live-sequence-header">
        <div>
          <p class="eyebrow">Live Studio</p>
          <h1>Sequence Editor</h1>
          <p>${live.inputSource === 'sequence' ? 'Sequence output is selected as the live input source.' : 'Sequence automation is ready, but the active input source is Browser Input.'}</p>
        </div>
        ${renderSequenceManagement()}
      </header>
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
            <div class="studio-live-sequence-scroll">
              <div class="studio-live-sequence-head">
                <span>#</span><span>Status</span><span>Art</span><span>Type</span><span>Title</span><span>Artist</span><span>Album</span><span>Category</span><span>Dur</span><span>ETA</span><span>Playing</span><span>Fade I/O/X</span><span>Source</span><span>Actions</span>
              </div>
              <div class="studio-live-sequence-body">${live.loading ? '<div class="studio-live-empty studio-live-empty--log">Loading Live Studio...</div>' : renderLiveSequenceRows()}</div>
            </div>
          </div>
        </section>
      </section>
      <footer class="studio-live-footer">
        <div>
          <strong>${esc(live.outputStatus)}</strong>
          <span>${live.inputSource === 'sequence' ? 'Sequence output feeds Start Live.' : 'Set Input Source to Sequence Editor before broadcasting this playout.'} Local monitor is ${live.monitorEnabled ? 'on' : 'off'}.</span>
        </div>
        <label class="studio-live-monitor-toggle"><input type="checkbox" data-live-toggle-monitor ${live.monitorEnabled ? 'checked' : ''} /> Monitor</label>
        <label class="studio-live-monitor-volume"><span>Vol</span><input type="range" min="0" max="1" step="0.01" value="${Number(live.monitorVolume || 0.85)}" data-live-monitor-volume /></label>
        <button type="button" class="studio-live-transport-play" data-live-play-selected>▶ Play Selected</button>
        <button type="button" class="studio-live-transport-stop" data-live-stop-all>■ Stop All</button>
      </footer>
    </section>
  `
}

function renderManualMetadataPanel() {
  const live = liveState()
  const meta = live.metadata
  const sequenceControlled = Boolean(live.inputSource === 'sequence' && live.currentItemId)
  return `
    <section class="studio-live-panel">
      <header class="studio-live-subheader"><div><p class="eyebrow">Live Studio</p><h1>Manual Metadata</h1><p>Set the public now-playing card without using sequence rows.</p></div></header>
      <form class="studio-live-details-form studio-live-metadata-form" data-live-metadata-form>
        <label class="studio-live-check"><input name="override" type="checkbox" ${meta.override ? 'checked' : ''} /> Manual override ${sequenceControlled ? '(sequence metadata is currently available)' : ''}</label>
        <label>Now playing title<input name="title" value="${esc(meta.title)}" /></label>
        <label>Artist<input name="artist" value="${esc(meta.artist)}" /></label>
        <label>Album<input name="album" value="${esc(meta.album)}" /></label>
        <label>Artwork URL<input name="artworkURL" value="${esc(meta.artworkURL)}" /></label>
        <label>Notes<textarea name="notes">${esc(meta.notes)}</textarea></label>
        <div class="studio-live-action-bar"><button type="submit" ${meta.saving ? 'disabled' : ''}>Set Live Metadata</button><button type="button" data-live-clear-metadata ${live.streamId ? '' : 'disabled'}>Clear Live Metadata</button></div>
      </form>
    </section>
  `
}

function renderChatPanel() {
  const live = liveState()
  return `
    <section class="studio-live-panel studio-live-chat-panel">
      <header class="studio-live-subheader"><div><p class="eyebrow">Live Studio</p><h1>Chat</h1><p>Host chat and moderation stay out of the sequence editor.</p></div><div class="studio-live-status-cluster"><span>${Number(live.stream?.listenerCount || 0)} viewers</span></div></header>
      <div class="studio-live-chat-log">
        ${live.streamId ? live.chatMessages.map((message) => `<article><strong>${esc(message.displayName)}</strong><span>${esc(message.text)}</span><small>${esc(message.createdAt ? new Date(message.createdAt).toLocaleTimeString() : '')}</small></article>`).join('') || '<p class="studio-live-empty">No chat messages yet.</p>' : '<p class="studio-live-empty">Chat opens after Start Live.</p>'}
      </div>
      <form class="studio-live-chat-form" data-live-chat-form><input name="message" value="${esc(live.chatDraft)}" placeholder="Message listeners..." ${live.streamId ? '' : 'disabled'} /><button type="submit" ${live.streamId ? '' : 'disabled'}>Send</button></form>
    </section>
  `
}

function renderPreviewPanel() {
  const live = liveState()
  const item = liveItemById(live.currentItemId) || liveSelectedItem()
  return `
    <section class="studio-live-panel">
      <header class="studio-live-subheader"><div><p class="eyebrow">Live Studio</p><h1>Preview / Monitor</h1><p>Detached monitor windows are monitor-only and do not publish output.</p></div></header>
      <div class="studio-live-monitor-preview">
        <div class="studio-live-deck-art">${item ? liveItemArt(item) : '<span>-</span>'}</div>
        <div><h2>${esc(item?.titleSnapshot || 'No item loaded')}</h2><p>${esc(item?.type === 'video' ? 'Video preview' : 'Audio-only preview')}</p><span>${esc(live.outputStatus)}</span></div>
      </div>
      <div class="studio-live-action-bar"><button type="button" data-live-open-monitor>Open Monitor</button></div>
    </section>
  `
}

function renderSafetyPanel() {
  return `
    <section class="studio-live-panel">
      <header class="studio-live-subheader"><div><p class="eyebrow">Live Studio</p><h1>Safety</h1><p>Operational guardrails for live broadcasts.</p></div></header>
      <div class="studio-live-safety-list"><p>Switching input source while live requires ending and restarting the stream.</p><p>Monitor windows are preview-only and never publish.</p><p>Use End Stream before closing the control room.</p></div>
    </section>
  `
}

function renderLiveStudio() {
  const live = liveState()
  const panel = currentLivePanel()
  live.panel = panel
  const panelContent = panel === 'input'
    ? renderInputSourcePanel()
    : panel === 'sequence'
      ? renderSequenceEditorPanel()
      : panel === 'metadata'
        ? renderManualMetadataPanel()
        : panel === 'chat'
          ? renderChatPanel()
          : panel === 'preview'
            ? renderPreviewPanel()
            : panel === 'settings'
              ? renderSafetyPanel()
              : renderStreamDetailsPanel()
  return `
    <section class="studio-live-main">
      ${live.error ? `<p class="studio-live-error">${esc(live.error)}</p>` : ''}
      ${panelContent}
      ${live.contextMenu ? renderLiveContextMenu(live.contextMenu) : ''}
      ${live.menu ? renderLiveGenericMenu(live.menu) : ''}
      <div data-studio-modal-root></div>
    </section>
  `
}

function renderLiveContextMenu(menu = {}) {
  const isAsset = menu.kind === 'asset'
  const isDeck = menu.kind === 'deck'
  const target = isAsset
    ? liveState().assets.find((asset) => asset.assetId === menu.itemId)
    : liveItemById(menu.itemId)
  const actions = isAsset
    ? [
        ['addAsset', 'Add to Sequence'],
        ['previewAsset', 'Preview'],
        ['editAsset', 'Edit Metadata'],
        ['artworkAsset', 'Add / Change Artwork'],
        ['audioAsset', 'Add / Replace Audio'],
        ['videoAsset', 'Add / Replace Video'],
        ['detailsAsset', 'Edit Details'],
        ['duplicateAsset', 'Duplicate Metadata'],
        ['deleteAsset', 'Delete Asset'],
        ['debugAsset', 'Reveal Storage Path / Debug Info']
      ]
    : isDeck
      ? [
          ['play', 'Play / Resume'],
          ['pause', livePlayerForItem(menu.itemId)?.paused ? 'Resume' : 'Pause'],
          ['stop', 'Stop Deck'],
          ['current', 'Set as Current'],
          ['next', 'Set as Next'],
          ['copy', 'Copy Metadata'],
          ['reveal', 'Reveal in Sequence']
        ]
    : [
        ['play', 'Play'],
        ['next', 'Set as Next'],
        ['cue', 'Cue Selected'],
        ['preview', 'Preview'],
        ['transition', 'Preview Transition'],
        ['edit', 'Edit Item'],
        ['duplicate', 'Duplicate Item'],
        ['remove', 'Remove Item'],
        ['toggle', target?.enabled === false ? 'Enable' : 'Disable'],
        ['stopAfter', 'Stop After This'],
        ['bookmarkAbove', 'Insert Action Bookmark Above'],
        ['bookmarkBelow', 'Insert Action Bookmark Below'],
        ['moveTop', 'Move to Top'],
        ['moveBottom', 'Move to Bottom'],
        ['reveal', 'Reveal Asset'],
        ['copy', 'Copy Metadata']
      ]
  return `
    <div class="studio-live-context-menu" style="left:${Math.max(8, menu.x || 0)}px;top:${Math.max(8, menu.y || 0)}px" data-live-context-menu>
      <strong>${esc(target?.title || target?.titleSnapshot || (isAsset ? 'Media asset' : 'Sequence item'))}</strong>
      ${actions.map(([action, label]) => `<button type="button" data-live-context-action="${esc(action)}" data-item-id="${esc(menu.itemId)}">${esc(label)}</button>`).join('')}
    </div>
  `
}

function renderLiveGenericMenu(menu = {}) {
  return `
    <div class="studio-live-context-menu" style="left:${Math.max(8, menu.x || 0)}px;top:${Math.max(8, menu.y || 0)}px" data-live-context-menu>
      <strong>${esc(menu.title || 'Live Studio')}</strong>
      ${(menu.actions || []).map((action) => `<button type="button" data-live-context-action="${esc(action.action)}" data-item-id="${esc(action.itemId || '')}">${esc(action.label)}</button>`).join('')}
    </div>
  `
}

function renderLiveMonitorPage() {
  let snapshot = {}
  try {
    snapshot = JSON.parse(window.localStorage.getItem('melogicLiveMonitorSnapshot') || '{}')
  } catch {}
  const item = snapshot.item || liveItemById(liveState().currentItemId) || liveSelectedItem()
  const isVideo = item?.type === 'video' && (item.videoURLSnapshot || item.videoURL)
  return `
    <section class="studio-live-monitor-surface">
      <header>
        <div><p class="eyebrow">Live Studio Monitor</p><h1>${isVideo ? 'Video preview' : 'Audio-only preview'}</h1></div>
        <span>${esc(snapshot.status || liveState().outputStatus || 'Monitoring Sequence Output')}</span>
      </header>
      <main>
        ${isVideo ? `<video controls playsinline src="${esc(item.videoURLSnapshot || item.videoURL)}"></video>` : `<div class="studio-live-monitor-art">${item?.artworkURLSnapshot || item?.artworkURL ? `<img src="${esc(item.artworkURLSnapshot || item.artworkURL)}" alt="" />` : '<span>Audio-only preview</span>'}</div>`}
        <div class="studio-live-monitor-copy">
          <h2>${esc(item?.titleSnapshot || item?.title || 'No item loaded')}</h2>
          <p>${esc(item?.artistSnapshot || item?.artist || 'Monitoring Sequence Output')}</p>
          <small>${esc(item?.albumSnapshot || item?.album || 'Monitor-only. Not publishing duplicate output.')}</small>
        </div>
      </main>
    </section>
  `
}

function renderLiveStatusBar() {
  const live = liveState()
  const current = liveItemById(live.currentItemId)
  const sourceReady = live.inputSource === 'sequence'
    ? Boolean(live.outputTrack || live.destination)
    : Boolean(live.sourceTrack)
  return `
    <div class="studio-live-statusbar">
      <span>${esc(live.streamId ? 'ON AIR' : 'OFF AIR')}</span>
      <span>Input: ${esc(live.inputSource === 'sequence' ? 'Sequence Output' : 'Browser Input')}</span>
      <span>Source: ${sourceReady ? 'healthy' : 'not prepared'}</span>
      <span>Monitor: ${live.monitorEnabled ? 'on' : 'off'}</span>
      <span>Decks: ${live.activePlayers.length}</span>
      <span>Now: ${esc(current?.titleSnapshot || 'none')}</span>
    </div>
  `
}

function renderShell() {
  const active = currentStudioSection()
  if (active === 'live' && isLiveMonitorRoute()) {
    app.innerHTML = `${navShell({ currentPage: 'studio' })}<main class="studio-live-monitor-page">${renderLiveMonitorPage()}</main>`
    initShellChrome()
    bind()
    return
  }
  const content = active === 'hub' ? renderHub() : active === 'stagemaker' ? renderStagemaker() : active === 'live' ? renderLiveStudio() : renderDaw()
  app.innerHTML = active === 'live'
    ? `${navShell({ currentPage: 'studio' })}<main class="studio-page studio-live-page"><section class="studio-live-shell">${renderLiveRail(currentLivePanel())}<section class="studio-live-content">${content}${renderLiveStatusBar()}</section></section></main>`
    : `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active })}${content}</section></main>`
  initShellChrome()
  if (active !== 'live') initStudioBrandLogo()
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
  const monitorGain = context.createGain()
  const destination = context.createMediaStreamDestination()
  masterGain.gain.value = 1
  monitorGain.gain.value = Number(live.monitorVolume || 0.85)
  masterGain.connect(monitorGain)
  masterGain.connect(destination)
  live.audioContext = context
  live.masterGain = masterGain
  live.monitorGain = monitorGain
  live.destination = destination
  live.outputTrack = destination.stream.getAudioTracks()[0] || null
  syncLiveMonitorRoute()
  return live
}

function syncLiveMonitorRoute() {
  const live = liveState()
  if (!live.audioContext || !live.monitorGain) return
  live.monitorGain.gain.value = Number(live.monitorVolume || 0)
  if (live.monitorEnabled && !live.monitorConnected) {
    try {
      live.monitorGain.connect(live.audioContext.destination)
      live.monitorConnected = true
    } catch {}
  } else if (!live.monitorEnabled && live.monitorConnected) {
    try { live.monitorGain.disconnect(live.audioContext.destination) } catch {}
    live.monitorConnected = false
  }
}

function stopLiveMicMeter() {
  const live = liveState()
  if (live.micMeterTimer) window.clearInterval(live.micMeterTimer)
  live.micMeterTimer = 0
  try { live.micMeterSource?.disconnect?.() } catch {}
  try { live.micMeterAnalyser?.disconnect?.() } catch {}
  try { live.micMeterContext?.close?.() } catch {}
  live.micMeterSource = null
  live.micMeterAnalyser = null
  live.micMeterContext = null
  live.micLevel = 0
}

function updateLiveMicMeterDom() {
  const fill = app.querySelector('[data-live-meter-fill]')
  if (fill) fill.style.width = `${Math.round((liveState().micLevel || 0) * 100)}%`
}

function startLiveMicMeter() {
  const live = liveState()
  stopLiveMicMeter()
  const rawTrack = live.sourceTrack?.mediaStreamTrack || live.sourceTrack
  if (!rawTrack) return
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) return
  const context = new AudioContextCtor()
  const analyser = context.createAnalyser()
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0.75
  const stream = new MediaStream([rawTrack])
  const source = context.createMediaStreamSource(stream)
  const data = new Float32Array(analyser.fftSize)
  source.connect(analyser)
  live.micMeterContext = context
  live.micMeterAnalyser = analyser
  live.micMeterSource = source
  live.micMeterTimer = window.setInterval(() => {
    analyser.getFloatTimeDomainData(data)
    let sum = 0
    for (const sample of data) sum += sample * sample
    const rms = Math.sqrt(sum / data.length)
    live.micLevel = Math.max(0, Math.min(1, rms * 5))
    updateLiveMicMeterDom()
  }, 120)
}

function audioConstraintsForLiveSource({ relaxed = false } = {}) {
  const live = liveState()
  const base = live.selectedDeviceId ? { deviceId: { exact: live.selectedDeviceId } } : {}
  if (live.streamForm.audioMode === 'voice' || relaxed) {
    return {
      ...base,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  }
  return {
    ...base,
    channelCount: { ideal: 2 },
    sampleRate: { ideal: 48000 },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false
  }
}

async function refreshLiveInputDevices() {
  const live = liveState()
  if (!navigator.mediaDevices?.enumerateDevices) {
    live.sourceMessage = 'This browser cannot list input devices.'
    return
  }
  live.devicesLoading = true
  renderShell()
  try {
    const devices = await navigator.mediaDevices.enumerateDevices()
    live.devices = devices.filter((device) => device.kind === 'audioinput')
    live.sourceMessage = ''
  } catch (error) {
    console.warn('[studio-live] device list failed', error)
    live.sourceMessage = 'Could not load browser input devices.'
  } finally {
    live.devicesLoading = false
    renderShell()
  }
}

async function prepareLiveMicSource() {
  const live = liveState()
  live.micPreparing = true
  live.sourceMessage = 'Preparing browser input...'
  renderShell()
  try {
    if (live.sourceTrack) {
      stopLiveMicMeter()
      live.sourceTrack.stop?.()
      live.sourceTrack = null
    }
    try {
      live.sourceTrack = await createLocalAudioTrack(audioConstraintsForLiveSource())
    } catch {
      live.sourceTrack = await createLocalAudioTrack(audioConstraintsForLiveSource({ relaxed: true }))
    }
    live.micPrepared = true
    live.inputSource = 'browser'
    live.sourceMessage = 'Browser input source is ready.'
    startLiveMicMeter()
    await refreshLiveInputDevices()
  } catch (error) {
    console.warn('[studio-live] mic prepare failed', error)
    live.micPrepared = false
    stopLiveMicMeter()
    live.sourceMessage = error?.message || 'Could not prepare browser input.'
  } finally {
    live.micPreparing = false
    renderShell()
  }
}

async function getLivePublishTrack() {
  const live = liveState()
  if (live.inputSource === 'sequence') {
    const graph = ensureLiveAudioGraph()
    if (graph.audioContext?.state === 'suspended') await graph.audioContext.resume()
    if (!graph.outputTrack) throw new Error('Live Studio sequence output track is not available.')
    return graph.outputTrack
  }
  if (!live.sourceTrack) await prepareLiveMicSource()
  if (!live.sourceTrack) throw new Error('Browser input source is not ready.')
  return live.sourceTrack
}

function publishOptionsForLiveSource() {
  const live = liveState()
  if (live.streamForm.audioMode === 'voice') {
    return { audioPreset: AudioPresets.speech, dtx: true, red: true, forceStereo: false }
  }
  return { audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true, forceStereo: true }
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
  if (!live.activePlayers.length && live.playbackTimer) {
    window.clearInterval(live.playbackTimer)
    live.playbackTimer = 0
  }
}

function stopLiveStudioAll() {
  ;[...liveState().activePlayers].forEach((player) => stopLiveStudioPlayer(player.playerId))
  liveState().currentItemId = ''
  liveState().outputStatus = 'All decks stopped.'
  renderShell()
}

function ensureLivePlaybackTicker() {
  const live = liveState()
  if (live.playbackTimer) return
  live.playbackTimer = window.setInterval(() => {
    if (!live.activePlayers.length) {
      window.clearInterval(live.playbackTimer)
      live.playbackTimer = 0
      return
    }
    if (currentStudioSection() === 'live' && (currentLivePanel() === 'sequence' || currentLivePanel() === 'preview')) renderShell()
  }, 500)
}

async function pauseLiveStudioPlayer(itemId = '') {
  const live = liveState()
  const player = live.activePlayers.find((entry) => entry.playerId === itemId || entry.itemId === itemId)
  if (!player) return
  if (player.paused) {
    try {
      await player.audio.play()
      player.paused = false
      live.outputStatus = `Resumed ${liveItemById(player.itemId)?.titleSnapshot || 'deck'}.`
    } catch (error) {
      console.warn('[studio-live] resume failed', error)
      live.outputStatus = 'Browser blocked resume. Press Play again.'
    }
  } else {
    try { player.audio.pause() } catch {}
    player.paused = true
    live.outputStatus = `Paused ${liveItemById(player.itemId)?.titleSnapshot || 'deck'}.`
  }
  renderShell()
}

function scrubLiveStudioPlayer(itemId = '', value = 0) {
  const player = livePlayerForItem(itemId)
  if (!player?.audio) return
  const duration = Number(player.audio.duration || 0)
  if (!Number.isFinite(duration) || duration <= 0) return
  player.audio.currentTime = duration * (Math.max(0, Math.min(1000, Number(value || 0))) / 1000)
}

async function playLiveStudioItem(itemId = '') {
  const item = liveItemById(itemId)
  const live = liveState()
  if (!item || !isPlayableLiveItem(item)) {
    live.outputStatus = 'Selected item has no playable audio source.'
    renderShell()
    return
  }
  const existing = livePlayerForItem(item.itemId)
  if (existing?.paused) {
    await pauseLiveStudioPlayer(item.itemId)
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
  const player = { playerId, itemId: item.itemId, audio, source, gain, paused: false }
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
    ensureLivePlaybackTicker()
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
  const title = window.prompt('Sequence name', 'Untitled Sequence') || 'Untitled Sequence'
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

async function removeLiveItem(itemId = '') {
  const live = liveState()
  if (!state.user?.uid || !live.activeSequence || !itemId) return
  await deleteSequenceItem(state.user.uid, live.activeSequence.sequenceId, itemId)
  live.selectedItemId = live.selectedItemId === itemId ? '' : live.selectedItemId
  await loadLiveStudioData()
  renderShell()
}

async function moveLiveItemToEdge(itemId = '', edge = 'top') {
  const live = liveState()
  const item = liveItemById(itemId)
  if (!state.user?.uid || !live.activeSequence || !item) return
  const orderIndex = edge === 'top' ? Date.now() - 100000000 : Date.now() + 100000000
  await updateSequenceItem(state.user.uid, live.activeSequence.sequenceId, item.itemId, { orderIndex })
  await loadLiveStudioItems()
  renderShell()
}

async function handleLiveSequenceAction(action = '') {
  const live = liveState()
  const sequence = live.activeSequence
  live.sequenceMenuOpen = false
  if (!state.user?.uid || !sequence) {
    renderShell()
    return
  }
  try {
    if (action === 'rename') {
      const title = window.prompt('Rename sequence', sequence.title || 'Untitled Sequence')
      if (!title) return renderShell()
      await updateSequence(state.user.uid, sequence.sequenceId, { title })
    } else if (action === 'duplicate') {
      const copy = await duplicateSequence(state.user.uid, sequence, live.items)
      live.activeSequence = copy
    } else if (action === 'delete') {
      if (!window.confirm(`Delete "${sequence.title}"?`)) return renderShell()
      await deleteSequence(state.user.uid, sequence.sequenceId)
      live.activeSequence = null
      live.items = []
    } else if (action === 'export') {
      const payload = JSON.stringify({ sequence, items: live.items }, null, 2)
      await navigator.clipboard?.writeText(payload)
      live.outputStatus = 'Sequence JSON copied to clipboard.'
    } else if (action === 'import') {
      live.outputStatus = 'Import JSON foundation is ready; paste/import UI can be connected next.'
    } else if (action === 'default') {
      window.localStorage.setItem('melogicLiveDefaultSequenceId', sequence.sequenceId)
      live.outputStatus = 'Default sequence saved for this browser.'
    } else if (action === 'clear') {
      if (!window.confirm('Remove all items from this sequence?')) return renderShell()
      await Promise.all(live.items.map((item) => deleteSequenceItem(state.user.uid, sequence.sequenceId, item.itemId)))
    }
    await loadLiveStudioData()
  } catch (error) {
    console.error('[studio-live] sequence action failed', error)
    live.error = error?.message || 'Sequence action failed.'
  }
  renderShell()
}

function writeLiveMonitorSnapshot() {
  const item = liveItemById(liveState().currentItemId) || liveSelectedItem()
  try {
    window.localStorage.setItem('melogicLiveMonitorSnapshot', JSON.stringify({
      status: liveState().outputStatus,
      streamId: liveState().streamId,
      item
    }))
  } catch {}
}

function openLiveMonitor() {
  writeLiveMonitorSnapshot()
  window.open(`${ROUTES.studioLive}/monitor`, 'melogic-live-monitor', 'popup=yes,width=960,height=720')
}

function setLiveInputSource(source = 'browser') {
  const live = liveState()
  if (live.streamId) {
    live.sourceMessage = 'End and restart the stream to switch input sources safely.'
    renderShell()
    return
  }
  live.inputSource = source === 'sequence' ? 'sequence' : 'browser'
  live.sourceMessage = live.inputSource === 'sequence' ? 'Sequence Editor selected as input source.' : 'Browser Input Source selected.'
  renderShell()
}

function handleAssetContextAction(action = '', assetId = '') {
  const live = liveState()
  live.contextMenu = null
  if (action === 'addAsset') return addLiveAsset(assetId)
  if (action === 'previewAsset') {
    live.outputStatus = 'Preparing audio preview...'
    const asset = live.assets.find((entry) => entry.assetId === assetId)
    if (asset?.normalizedAudioURL) {
      const audio = new Audio(asset.normalizedAudioURL)
      audio.preload = 'auto'
      audio.play().catch(() => {})
    }
  } else {
    live.outputStatus = `${action.replace(/Asset$/, '').replace(/([A-Z])/g, ' $1').trim()} action is ready for the asset editor workflow.`
  }
  renderShell()
}

async function handleSequenceContextAction(action = '', itemId = '') {
  const live = liveState()
  live.contextMenu = null
  if (action === 'play' || action === 'preview') await playLiveStudioItem(itemId)
  else if (action === 'pause') await pauseLiveStudioPlayer(itemId)
  else if (action === 'stop') {
    stopLiveStudioPlayer(itemId)
    refreshLiveDecks()
  }
  else if (action === 'current') {
    live.currentItemId = itemId
    live.selectedItemId = itemId
    refreshLiveDecks()
  }
  else if (action === 'next' || action === 'cue') {
    live.nextItemId = itemId
    live.selectedItemId = itemId
    refreshLiveDecks()
  } else if (action === 'duplicate') await duplicateLiveItem(itemId)
  else if (action === 'remove') await removeLiveItem(itemId)
  else if (action === 'toggle') await toggleLiveItemEnabled(itemId)
  else if (action === 'moveTop') await moveLiveItemToEdge(itemId, 'top')
  else if (action === 'moveBottom') await moveLiveItemToEdge(itemId, 'bottom')
  else if (action === 'copy') {
    const item = liveItemById(itemId)
    await navigator.clipboard?.writeText(JSON.stringify(item || {}, null, 2))
    live.outputStatus = 'Sequence item metadata copied.'
  } else if (action === 'reveal') {
    live.selectedItemId = itemId
    live.outputStatus = 'Sequence item selected.'
  } else {
    live.outputStatus = `${action.replace(/([A-Z])/g, ' $1').trim()} is ready for the sequence editor workflow.`
  }
  renderShell()
}

function updateLiveStreamFormFromElement(formEl) {
  if (!formEl) return
  const data = new FormData(formEl)
  const form = liveState().streamForm
  form.title = String(data.get('title') || form.title || '').trim()
  form.description = String(data.get('description') || '').trim()
  form.category = String(data.get('category') || 'radio')
  form.tags = String(data.get('tags') || '').trim()
  form.visibility = String(data.get('visibility') || 'public')
  form.accessMode = String(data.get('accessMode') || form.visibility)
  form.password = String(data.get('password') || '')
  form.coverArtURL = String(data.get('coverArtURL') || '').trim()
  form.rightsAccepted = data.get('rightsAccepted') === 'on'
}

function updateLiveListenerPreviewDom() {
  const live = liveState()
  const form = live.streamForm
  app.querySelector('[data-live-preview-title]')?.replaceChildren(document.createTextNode(form.title || 'Live Studio Broadcast'))
  app.querySelector('[data-live-preview-description]')?.replaceChildren(document.createTextNode(form.description || 'Listeners will see stream details here when the broadcast is live.'))
  app.querySelector('[data-live-preview-status]')?.replaceChildren(document.createTextNode(live.stream?.status || (live.streamId ? 'starting' : 'draft')))
  app.querySelector('[data-live-preview-category]')?.replaceChildren(document.createTextNode(form.category || 'radio'))
  app.querySelector('[data-live-preview-access]')?.replaceChildren(document.createTextNode(form.accessMode || form.visibility || 'public'))
  const cover = app.querySelector('[data-live-preview-cover]')
  if (cover) cover.innerHTML = form.coverArtURL ? `<img src="${esc(form.coverArtURL)}" alt="" />` : '<span>MR</span>'
}

async function saveLiveStreamInfo() {
  const live = liveState()
  if (!live.streamId) {
    live.outputStatus = 'Draft stream details saved locally.'
    renderShell()
    return
  }
  live.savingInfo = true
  renderShell()
  try {
    const form = live.streamForm
    await updateMusicLiveStreamInfo({
      streamId: live.streamId,
      title: form.title,
      description: form.description,
      category: form.category,
      visibility: form.visibility,
      accessMode: form.accessMode,
      password: form.password,
      coverArtURL: form.coverArtURL,
      coverArtPath: '',
      coverArtSource: form.coverArtURL ? 'url' : 'fallback',
      tags: form.tags
    })
    live.outputStatus = 'Stream info updated.'
  } catch (error) {
    console.error('[studio-live] update stream failed', error)
    live.error = error?.message || 'Could not update stream info.'
  } finally {
    live.savingInfo = false
    renderShell()
  }
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
    if (!live.streamForm.rightsAccepted) throw new Error('Accept the live stream rules before starting.')
    const localTrack = await getLivePublishTrack()
    const response = await startMusicLiveStream({
      streamId: '',
      title: live.streamForm.title,
      description: live.streamForm.description,
      category: live.streamForm.category,
      visibility: live.streamForm.visibility,
      accessMode: live.streamForm.accessMode,
      password: live.streamForm.password,
      coverArtURL: live.streamForm.coverArtURL,
      coverArtPath: '',
      coverArtSource: live.streamForm.coverArtURL ? 'url' : 'fallback',
      tags: live.streamForm.tags,
      audioMode: live.streamForm.audioMode,
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
      live.outputStatus = live.inputSource === 'sequence'
        ? 'Host room connected. Publishing Sequence Software output...'
        : 'Host room connected. Publishing browser input source...'
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
    live.localTrack = localTrack
    await room.localParticipant.publishTrack(localTrack, publishOptionsForLiveSource())
    await markMusicLiveStreamOnAir(pendingStreamId)
    subscribeLiveStudioStream(pendingStreamId)
    subscribeLiveStudioChat(pendingStreamId)
    if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
    live.heartbeatTimer = window.setInterval(() => {
      if (!live.streamId) return
      heartbeatMusicLiveStream(live.streamId, {
        audioPublished: true,
        connectionStatus: 'connected'
      }).catch(() => {})
    }, 25000)
    live.outputStatus = live.inputSource === 'sequence'
      ? 'On air. Sequence Software output is publishing to Melogic Music.'
      : 'On air. Browser input source is publishing to Melogic Music.'
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
      if (live.localTrack) await live.room?.localParticipant?.unpublishTrack?.(live.localTrack, false)
    } catch {}
    live.room?.disconnect?.()
    await endMusicLiveStream(streamId)
    unsubscribeLiveStudioRuntime()
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

function unsubscribeLiveStudioRuntime() {
  const live = liveState()
  live.streamUnsubscribe?.()
  live.chatUnsubscribe?.()
  live.streamUnsubscribe = null
  live.chatUnsubscribe = null
  if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
  live.heartbeatTimer = 0
}

function subscribeLiveStudioStream(streamId = '') {
  const live = liveState()
  live.streamUnsubscribe?.()
  live.streamUnsubscribe = subscribeMusicLiveStream(streamId, (stream) => {
    live.stream = stream
    if (stream) {
      live.streamForm.title = stream.title || live.streamForm.title
      live.streamForm.description = stream.description || ''
      live.streamForm.category = stream.category || live.streamForm.category
      live.streamForm.tags = (stream.tags || []).join(', ')
      live.streamForm.visibility = stream.visibility || live.streamForm.visibility
      live.streamForm.accessMode = stream.accessMode || live.streamForm.accessMode
      live.streamForm.coverArtURL = stream.coverArtURL || ''
    }
    renderShell()
  })
}

function subscribeLiveStudioChat(streamId = '') {
  const live = liveState()
  live.chatUnsubscribe?.()
  live.chatUnsubscribe = subscribeMusicLiveChat(streamId, (messages) => {
    live.chatMessages = messages
    if (currentLivePanel() === 'chat') renderShell()
  })
}

async function setManualLiveMetadata() {
  const live = liveState()
  if (!live.streamId) {
    live.error = 'Start a stream before setting live metadata.'
    renderShell()
    return
  }
  live.metadata.saving = true
  renderShell()
  try {
    const itemId = 'manual-metadata'
    await upsertMusicLiveSequenceItem({
      streamId: live.streamId,
      itemId,
      title: live.metadata.title || live.streamForm.title,
      artist: live.metadata.artist,
      album: live.metadata.album,
      artworkURL: live.metadata.artworkURL || live.streamForm.coverArtURL,
      notes: live.metadata.notes
    })
    await setMusicLiveNowPlaying(live.streamId, itemId)
    live.outputStatus = 'Manual live metadata updated.'
  } catch (error) {
    console.error('[studio-live] metadata update failed', error)
    live.error = error?.message || 'Could not update live metadata.'
  } finally {
    live.metadata.saving = false
    renderShell()
  }
}

async function clearManualLiveMetadata() {
  const live = liveState()
  if (!live.streamId) return
  await setMusicLiveNowPlaying(live.streamId, '')
  await deleteMusicLiveSequenceItem(live.streamId, 'manual-metadata').catch(() => {})
  live.outputStatus = 'Live metadata cleared.'
  renderShell()
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

function handleLiveStudioHotkey(e) {
  const tag = e.target?.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable) return
  if (currentStudioSection() !== 'live') return
  const live = liveState()
  if (e.key === ' ' || e.key === 'Enter') {
    e.preventDefault()
    const item = liveItemById(live.selectedItemId) || liveSelectedItem()
    if (e.key === ' ' && item && livePlayerForItem(item.itemId)) pauseLiveStudioPlayer(item.itemId)
    else playLiveStudioItem(item?.itemId || '').catch(() => {})
  } else if ((e.key === 'Backspace' || e.key === 'Delete') && live.selectedItemId) {
    e.preventDefault()
    if (window.confirm('Remove selected item from this sequence?')) removeLiveItem(live.selectedItemId)
  }
}

function bindLiveStudioControls() {
  const live = liveState()
  app.querySelectorAll('[data-live-panel]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault()
    setLivePanel(el.dataset.livePanel || 'stream')
  }))
  app.querySelector('[data-live-stream-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    updateLiveStreamFormFromElement(e.currentTarget)
    await saveLiveStreamInfo()
  })
  app.querySelector('[data-live-stream-form]')?.addEventListener('input', (e) => {
    updateLiveStreamFormFromElement(e.currentTarget)
    updateLiveListenerPreviewDom()
  })
  app.querySelector('[data-live-start-stream]')?.addEventListener('click', () => {
    updateLiveStreamFormFromElement(app.querySelector('[data-live-stream-form]'))
    startLiveStudioStream()
  })
  app.querySelector('[data-live-end-stream]')?.addEventListener('click', () => {
    if (!window.confirm('End this live stream for listeners?')) return
    endLiveStudioStream()
  })
  app.querySelector('[data-copy-live-link]')?.addEventListener('click', async (e) => {
    await navigator.clipboard?.writeText(e.currentTarget.dataset.copyLiveLink || '')
    live.outputStatus = 'Public listener link copied.'
    renderShell()
  })
  app.querySelector('[data-live-device-select]')?.addEventListener('change', (e) => {
    stopLiveMicMeter()
    live.sourceTrack?.stop?.()
    live.sourceTrack = null
    live.selectedDeviceId = e.currentTarget.value || ''
    live.micPrepared = false
    live.sourceMessage = 'Input device changed. Enable Mic again before starting.'
    renderShell()
  })
  app.querySelector('[data-live-audio-mode]')?.addEventListener('change', (e) => {
    stopLiveMicMeter()
    live.sourceTrack?.stop?.()
    live.sourceTrack = null
    live.streamForm.audioMode = e.currentTarget.value === 'voice' ? 'voice' : 'music'
    live.micPrepared = false
    renderShell()
  })
  app.querySelectorAll('[data-live-set-source]').forEach((el) => el.addEventListener('click', () => setLiveInputSource(el.dataset.liveSetSource)))
  app.querySelector('[data-live-refresh-devices]')?.addEventListener('click', () => refreshLiveInputDevices())
  app.querySelector('[data-live-prepare-mic]')?.addEventListener('click', () => prepareLiveMicSource())
  app.querySelector('[data-live-open-monitor]')?.addEventListener('click', () => openLiveMonitor())
  app.querySelector('[data-live-metadata-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    live.metadata.title = String(data.get('title') || '').trim()
    live.metadata.artist = String(data.get('artist') || '').trim()
    live.metadata.album = String(data.get('album') || '').trim()
    live.metadata.artworkURL = String(data.get('artworkURL') || '').trim()
    live.metadata.notes = String(data.get('notes') || '').trim()
    live.metadata.override = data.get('override') === 'on'
    await setManualLiveMetadata()
  })
  app.querySelector('[data-live-clear-metadata]')?.addEventListener('click', () => clearManualLiveMetadata())
  app.querySelector('[data-live-chat-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = String(new FormData(e.currentTarget).get('message') || '').trim()
    if (!text || !live.streamId) return
    await sendMusicLiveChatMessage(live.streamId, text)
    live.chatDraft = ''
    renderShell()
  })
  app.querySelector('[data-live-sequence-menu-toggle]')?.addEventListener('click', (e) => {
    e.stopPropagation()
    live.sequenceMenuOpen = !live.sequenceMenuOpen
    renderShell()
  })
  app.querySelectorAll('[data-live-sequence-action]').forEach((el) => el.addEventListener('click', () => handleLiveSequenceAction(el.dataset.liveSequenceAction)))
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
  app.querySelectorAll('[data-live-add-asset]').forEach((el) => el.addEventListener('click', () => {
    addLiveAsset(el.dataset.liveAddAsset).catch((error) => {
      console.error('[studio-live] add asset failed', error)
      live.error = 'Could not add that asset.'
      renderShell()
    })
  }))
  app.querySelectorAll('[data-live-asset-row]').forEach((el) => el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    live.contextMenu = { kind: 'asset', itemId: el.dataset.liveAssetRow || '', x: e.clientX, y: e.clientY }
    renderShell()
  }))
  app.querySelectorAll('[data-live-asset-menu]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation()
    const rect = el.getBoundingClientRect()
    live.contextMenu = { kind: 'asset', itemId: el.dataset.liveAssetMenu || '', x: rect.left, y: rect.bottom + 4 }
    renderShell()
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
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        live.selectedItemId = el.dataset.liveSelectItem || ''
        refreshLiveDecks()
        renderShell()
      }
    })
    el.addEventListener('dblclick', () => {
      live.nextItemId = el.dataset.liveSelectItem || ''
      refreshLiveDecks()
      renderShell()
    })
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault()
      live.selectedItemId = el.dataset.liveSelectItem || ''
      live.contextMenu = { kind: 'sequence', itemId: el.dataset.liveSelectItem || '', x: e.clientX, y: e.clientY }
      renderShell()
    })
  })
  app.querySelectorAll('[data-live-sequence-menu]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation()
    const rect = el.getBoundingClientRect()
    live.contextMenu = { kind: 'sequence', itemId: el.dataset.liveSequenceMenu || '', x: rect.left, y: rect.bottom + 4 }
    renderShell()
  }))
  app.querySelectorAll('[data-live-deck-menu]').forEach((el) => el.addEventListener('click', (e) => {
    e.stopPropagation()
    const rect = el.getBoundingClientRect()
    live.contextMenu = { kind: 'deck', itemId: el.dataset.liveDeckMenu || '', x: rect.left, y: rect.bottom + 4 }
    renderShell()
  }))
  app.querySelectorAll('[data-live-play-item]').forEach((el) => el.addEventListener('click', () => playLiveStudioItem(el.dataset.livePlayItem)))
  app.querySelectorAll('[data-live-pause-item]').forEach((el) => el.addEventListener('click', () => pauseLiveStudioPlayer(el.dataset.livePauseItem)))
  app.querySelectorAll('[data-live-stop-item]').forEach((el) => el.addEventListener('click', () => {
    stopLiveStudioPlayer(el.dataset.liveStopItem)
    refreshLiveDecks()
    renderShell()
  }))
  app.querySelectorAll('[data-live-scrub-item]').forEach((el) => el.addEventListener('input', () => scrubLiveStudioPlayer(el.dataset.liveScrubItem, el.value)))
  app.querySelector('[data-live-toggle-monitor]')?.addEventListener('change', (e) => {
    live.monitorEnabled = Boolean(e.currentTarget.checked)
    ensureLiveAudioGraph()
    syncLiveMonitorRoute()
    live.outputStatus = live.monitorEnabled ? 'Local monitor enabled. Program output is unchanged.' : 'Local monitor muted. Program output is unchanged.'
    renderShell()
  })
  app.querySelector('[data-live-monitor-volume]')?.addEventListener('input', (e) => {
    live.monitorVolume = Number(e.currentTarget.value || 0)
    syncLiveMonitorRoute()
  })
  app.querySelector('[data-live-play-selected]')?.addEventListener('click', () => {
    const item = liveItemById(live.selectedItemId) || liveSelectedItem()
    playLiveStudioItem(item?.itemId || '').catch(() => {})
  })
  app.querySelector('[data-live-stop-all]')?.addEventListener('click', () => {
    if (live.streamId && live.inputSource === 'sequence' && !window.confirm('Stop all sequence decks while the sequence output is live?')) return
    stopLiveStudioAll()
  })
  app.querySelectorAll('[data-live-context-action]').forEach((el) => el.addEventListener('click', async () => {
    const itemId = el.dataset.itemId || ''
    const action = el.dataset.liveContextAction || ''
    const kind = live.contextMenu?.kind || (action.endsWith('Asset') ? 'asset' : 'sequence')
    if (kind === 'asset') await handleAssetContextAction(action, itemId)
    else await handleSequenceContextAction(action, itemId)
  }))
  document.addEventListener('click', (e) => {
    if ((!live.contextMenu && !live.sequenceMenuOpen) || e.target.closest?.('[data-live-context-menu]') || e.target.closest?.('[data-live-sequence-dropdown]')) return
    live.contextMenu = null
    live.sequenceMenuOpen = false
    renderShell()
  }, { once: true })
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return
    live.contextMenu = null
    live.sequenceMenuOpen = false
    renderShell()
  }, { once: true })
  document.removeEventListener('keydown', handleLiveStudioHotkey)
  document.addEventListener('keydown', handleLiveStudioHotkey)
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

window.addEventListener('popstate', () => {
  if (currentStudioSection() === 'live') renderShell()
})

window.addEventListener('beforeunload', (event) => {
  if (!liveState().streamId && !liveState().activePlayers.length) return
  event.preventDefault()
  event.returnValue = ''
})
