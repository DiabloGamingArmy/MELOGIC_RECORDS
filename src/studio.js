import './styles/base.css'
import './styles/studio.css'
import { AudioPresets, Track, createLocalAudioTrack, createLocalVideoTrack } from 'livekit-client'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState, subscribeToAuthState } from './firebase/auth'
import { storage } from './firebase/storage'
import { ROUTES, authRoute, stageProjectRoute, studioProjectRoute } from './utils/routes'
import {
  deleteMusicLiveSequenceItem,
  endMusicLiveStream,
  heartbeatMusicLiveStream,
  listHostMusicLiveStreams,
  markMusicLiveStreamOnAir,
  prepareMusicLiveStreamDraft,
  sendMusicLiveChatMessage,
  setMusicLiveNowPlaying,
  startMusicLiveStream,
  subscribeMusicLiveChat,
  subscribeMusicLiveStream,
  updateMusicLiveStreamInfo,
  upsertMusicLiveSequenceItem
} from './data/musicLiveService'
import {
  deleteProgramScene,
  listProgramScenes,
  listProgramSources,
  saveProgramScene,
  saveProgramSource
} from './data/liveStudioProgramService'
import { PROGRAM_SCENE_TEMPLATES, PROGRAM_SOURCE_TYPES, ProgramMixer } from './data/streaming/programMixer'
import { getStreamingProvider, listStreamingProviderOptions, preferredStreamingProviderId } from './data/streaming/streamingProviderRegistry'
import {
  firebaseSegmentStreamingEnabled,
  isBufferedBroadcastProvider,
  isFirebaseSegmentProvider,
  ingestProtocolForMethod,
  normalizeIngestMethod,
  normalizeProviderId,
  STREAM_INGEST_METHODS,
  STREAM_PROVIDERS
} from './data/streaming/streamingProviderTypes'
import { buildHlsPlaybackUrl, sanitizeHlsStreamKey } from './data/streaming/hlsEdgePlayer'
import { isBrowserWebrtcIngestConfigured, startBrowserWebrtcIngest, stopBrowserWebrtcIngest } from './data/streaming/browserWebrtcIngest'
import {
  getNativeHostPresence,
  nativeHostSessionId,
  writeNativeHostPresence
} from './data/streaming/nativeStreamingPresence'
import {
  listLiveStudioGuestInvites,
  removeLiveStudioGuestInvite,
  saveLiveStudioGuestInvite,
  searchLiveStudioGuests,
  subscribeLiveStudioGuestInvites,
  updateLiveStudioGuestInviteStatus
} from './data/liveStudioGuestService'
import {
  SEQUENCE_ASSET_CATEGORIES,
  SEQUENCE_ACTION_TYPES,
  addActionBookmarkToSequence,
  addAssetToSequence,
  createSequence,
  createSequenceAssetShell,
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
  uploadSequenceAssetFile,
  updateSequenceAsset,
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
let studioMonitorVisualizerCleanup = null
let studioProgramMixer = null
const activeNativeHostSessions = new Map()

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const stableImageCache = new Map()

function renderStudioStableImage({ src = '', fallback = '', className = '', key = '' } = {}) {
  const cleanSrc = String(src || '').trim()
  const cacheKey = key || cleanSrc || fallback || 'studio-image'
  const cached = stableImageCache.get(cacheKey)
  const canUseCached = cleanSrc && cached?.status === 'loaded' && cached.src === cleanSrc
  const displaySrc = canUseCached ? cleanSrc : cached?.lastGoodSrc || ''
  return `
    <span class="studio-stable-image ${esc(className)}" data-studio-stable-image data-stable-image-key="${esc(cacheKey)}" data-stable-image-src="${esc(cleanSrc)}">
      ${displaySrc ? `<img src="${esc(displaySrc)}" alt="" loading="lazy" decoding="async" />` : `<span class="studio-stable-image-fallback">${esc(fallback || '?')}</span>`}
    </span>
  `
}

function hydrateStudioStableImages(root = app) {
  root?.querySelectorAll?.('[data-studio-stable-image]').forEach((el) => {
    const src = String(el.dataset.stableImageSrc || '').trim()
    const key = String(el.dataset.stableImageKey || src || '').trim()
    if (!src || !key) return
    const cached = stableImageCache.get(key)
    if (cached?.status === 'loaded' && cached.src === src) {
      if (!el.querySelector('img')) el.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" />`
      return
    }
    if (cached?.status === 'loading' && cached.src === src) return
    stableImageCache.set(key, { status: 'loading', src, lastGoodSrc: cached?.lastGoodSrc || (cached?.status === 'loaded' ? cached.src : '') })
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      stableImageCache.set(key, { status: 'loaded', src, lastGoodSrc: src })
      root.querySelectorAll?.(`[data-stable-image-key="${CSS.escape(key)}"][data-stable-image-src="${CSS.escape(src)}"]`).forEach((target) => {
        target.innerHTML = `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" />`
      })
    }
    image.onerror = () => {
      const previous = stableImageCache.get(key)
      stableImageCache.set(key, { status: 'failed', src, lastGoodSrc: previous?.lastGoodSrc || '' })
      if (previous?.lastGoodSrc) {
        root.querySelectorAll?.(`[data-stable-image-key="${CSS.escape(key)}"][data-stable-image-src="${CSS.escape(src)}"]`).forEach((target) => {
          target.innerHTML = `<img src="${esc(previous.lastGoodSrc)}" alt="" loading="lazy" decoding="async" />`
        })
      }
    }
    image.src = src
  })
}

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
    draftStreamId: '',
    starting: false,
    ending: false,
    room: null,
    localTrack: null,
    programAudioTrack: null,
    livekitAudioPublication: null,
    localVideoTrack: null,
    programVideoTrack: null,
    audioPublishedToProvider: false,
    videoPublishedToProvider: false,
    sourceTrack: null,
    heartbeatTimer: 0,
    nativeDemandUnsubscribe: null,
    nativeNoDemandTimer: 0,
    nativeRecorderRunning: false,
    nativePlaybackDemandCount: 0,
    nativeStreamingStatus: 'idleNoListeners',
    nativeInterruptedStreamId: '',
    nativeHostSessionId: '',
    nativeLastDemandChangeAt: '',
    nativeRecorderStartReason: '',
    nativeRecorderStopReason: '',
    nativeStopWarning: '',
    draftSaveTimer: 0,
    stream: null,
    streamUnsubscribe: null,
    chatUnsubscribe: null,
    chatMessages: [],
    panel: '',
    inputSource: 'browser',
    audioEnabled: true,
    videoEnabled: false,
    browserInputEnabled: true,
    sequenceInputEnabled: false,
    videoSource: 'browser',
    videoTransition: 'cut',
    providerId: preferredStreamingProviderId(),
    ingestMethod: STREAM_INGEST_METHODS.browserWebrtc,
    browserIngestActive: false,
    providerDiagnostics: {},
    advancedStreamingOpen: false,
    programMixer: {
      loading: false,
      loaded: false,
      scenes: [],
      sources: [],
      previewSceneId: '',
      programSceneId: '',
      activeSceneId: '',
      selectedSourceId: '',
      outputResolution: '1280x720',
      fps: 30,
      transitionDurationMs: 400,
      sceneModal: { open: false, name: '', templateId: 'blank', error: '' },
      sourceModal: { open: false, name: '', type: 'browser-microphone', targetSceneId: '', error: '' },
      mode: 'preview',
      notice: ''
    },
    guests: [],
    guestSearchQuery: '',
    guestSearchResults: [],
    guestSearchLoading: false,
    guestInviteStatus: '',
    guestUnsubscribe: null,
    mixer: {
      browserGain: 1,
      sequenceGain: 1,
      masterGain: 1,
      browserMuted: false,
      sequenceMuted: false
    },
    selectedDeviceId: '',
    selectedVideoDeviceId: '',
    videoPreviewError: '',
    videoPreviewActive: false,
    devices: [],
    videoDevices: [],
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
      coverArtPath: '',
      coverArtSource: 'fallback',
      rightsAccepted: false,
      audioMode: 'music',
      streamKey: 'mystream'
    },
    uploadingCover: false,
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
      autoMatchSequencer: false,
      lastAutoMatchedItemId: '',
      saving: false
    },
    chatDraft: '',
    outputStatus: 'Sequence Software input ready.',
    monitorEnabled: false,
    monitorVolume: 0.85,
    monitorConnected: false,
    micProgramSource: null,
    sequenceMonitorGain: null,
    programAnalyser: null,
    programAnalyserData: null,
    programRms: 0,
    programPeak: 0,
    micLevel: 0,
    micMeterTimer: 0,
    micMeterContext: null,
    micMeterAnalyser: null,
    micMeterSource: null,
    playbackTimer: 0,
    assetPreview: {
      assetId: '',
      title: '',
      audio: null,
      playing: false,
      paused: false,
      current: 0,
      duration: 0,
      timer: 0,
      volume: 0.85
    },
    assetEditor: {
      assetId: '',
      saving: false,
      error: '',
      dirty: false
    },
    assetAdd: {
      open: false,
      uploading: false,
      mode: 'audio',
      status: '',
      error: ''
    }
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
  ['program', 'Program Mixer'],
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
  if (clean !== 'sequence') stopLiveAssetPreview({ render: false })
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

function liveAssetById(assetId = '') {
  return liveState().assets.find((asset) => asset.assetId === assetId || asset.id === assetId) || null
}

function updateLiveAssetPreviewState() {
  const preview = liveState().assetPreview
  const audio = preview.audio
  if (!audio) return
  const duration = Number.isFinite(audio.duration) && audio.duration > 0
    ? audio.duration
    : Number(preview.duration || 0)
  preview.current = Math.max(0, Number(audio.currentTime || 0))
  preview.duration = Math.max(0, duration || 0)
  preview.paused = Boolean(audio.paused)
  preview.playing = !audio.paused && !audio.ended
}

function clearLiveAssetPreviewTimer() {
  const preview = liveState().assetPreview
  if (preview.timer) window.clearInterval(preview.timer)
  preview.timer = 0
}

function stopLiveAssetPreview({ render = true } = {}) {
  const preview = liveState().assetPreview
  clearLiveAssetPreviewTimer()
  try { preview.audio?.pause?.() } catch {}
  try {
    preview.audio?.removeAttribute?.('src')
    preview.audio?.load?.()
  } catch {}
  preview.assetId = ''
  preview.title = ''
  preview.audio = null
  preview.playing = false
  preview.paused = false
  preview.current = 0
  preview.duration = 0
  if (render) renderShell()
}

async function squareCoverFile(file) {
  if (!file?.type?.startsWith('image/')) throw new Error('Cover upload must be an image file.')
  if (file.size > 8 * 1024 * 1024) throw new Error('Cover image must be 8 MB or smaller.')
  const bitmap = await createImageBitmap(file)
  const size = 1080
  const sourceSize = Math.min(bitmap.width, bitmap.height)
  const sx = Math.max(0, Math.floor((bitmap.width - sourceSize) / 2))
  const sy = Math.max(0, Math.floor((bitmap.height - sourceSize) / 2))
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, sx, sy, sourceSize, sourceSize, 0, 0, size, size)
  bitmap.close?.()
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob((nextBlob) => nextBlob ? resolve(nextBlob) : reject(new Error('Could not prepare square cover image.')), 'image/jpeg', 0.88)
  })
  return new File([blob], 'cover-1080.jpg', { type: 'image/jpeg' })
}

async function deleteLiveCover(path = '') {
  if (!storage || !path) return
  await deleteObject(storageRef(storage, path)).catch(() => {})
}

async function ensureLiveDraftIdForUpload() {
  const live = liveState()
  if (live.streamId || live.draftStreamId) return live.streamId || live.draftStreamId
  const response = await prepareMusicLiveStreamDraft(liveStreamPayload())
  live.draftStreamId = response.streamId || live.draftStreamId
  if (!live.draftStreamId) throw new Error('Save a stream draft before uploading cover art.')
  return live.draftStreamId
}

async function uploadLiveStudioCover(file) {
  const live = liveState()
  if (!state.user?.uid || !storage || !file) return
  live.uploadingCover = true
  live.error = ''
  live.outputStatus = 'Preparing square cover image...'
  renderShell()
  try {
    const streamId = await ensureLiveDraftIdForUpload()
    const squareFile = await squareCoverFile(file)
    if (live.streamForm.coverArtSource === 'upload') await deleteLiveCover(live.streamForm.coverArtPath)
    live.outputStatus = 'Uploading station cover...'
    renderShell()
    const path = `users/${state.user.uid}/liveStudio/${streamId}/cover/cover-1080.jpg`
    const ref = storageRef(storage, path)
    await uploadBytes(ref, squareFile, {
      contentType: 'image/jpeg',
      customMetadata: { ownerUid: state.user.uid, streamId, type: 'music-live-cover' }
    })
    const url = await getDownloadURL(ref)
    live.streamForm.coverArtURL = url
    live.streamForm.coverArtPath = path
    live.streamForm.coverArtSource = 'upload'
    await updateMusicLiveStreamInfo(liveStreamPayload()).catch(() => {})
    live.outputStatus = 'Station cover uploaded.'
  } catch (error) {
    console.error('[studio-live] cover upload failed', error)
    live.error = error?.message || 'Cover image could not be uploaded.'
  } finally {
    live.uploadingCover = false
    renderShell()
  }
}

function updateLiveAssetPreviewDom() {
  const preview = liveState().assetPreview
  if (!preview.audio) return
  const progress = liveAssetPreviewProgress()
  const percent = `${progress.percent}%`
  app.querySelector('[data-live-preview-progress] [data-live-progress-fill]')?.style?.setProperty('width', percent)
  app.querySelector('[data-live-preview-progress] [data-live-progress-knob]')?.style?.setProperty('left', percent)
  const time = app.querySelector('[data-live-preview-time]')
  if (time) time.textContent = `${formatMs(progress.current * 1000)} / ${formatMs(progress.duration * 1000)} · Local monitor only`
}

function ensureLiveAssetPreviewTicker() {
  const live = liveState()
  const preview = live.assetPreview
  if (preview.timer) return
  preview.timer = window.setInterval(() => {
    if (!preview.audio) {
      clearLiveAssetPreviewTimer()
      return
    }
    updateLiveAssetPreviewState()
    if (preview.audio.ended) {
      stopLiveAssetPreview({ render: currentStudioSection() === 'live' && currentLivePanel() === 'sequence' })
      return
    }
    if (currentStudioSection() === 'live' && currentLivePanel() === 'sequence') updateLiveAssetPreviewDom()
  }, 500)
}

function liveAssetPreviewProgress() {
  const preview = liveState().assetPreview
  updateLiveAssetPreviewState()
  const duration = Number(preview.duration || 0)
  const current = Math.min(duration || 0, Math.max(0, Number(preview.current || 0)))
  const ratio = duration > 0 ? current / duration : 0
  return {
    current,
    duration,
    percent: Math.max(0, Math.min(100, ratio * 100))
  }
}

async function startLiveAssetPreview(assetId = '') {
  const live = liveState()
  const asset = liveAssetById(assetId)
  stopLiveAssetPreview({ render: false })
  if (!asset?.normalizedAudioURL) {
    live.outputStatus = 'That asset does not have previewable audio yet.'
    renderShell()
    return
  }
  const audio = new Audio(asset.normalizedAudioURL)
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  audio.volume = Math.max(0, Math.min(1, Number(live.assetPreview.volume || 0.85)))
  live.assetPreview.assetId = asset.assetId
  live.assetPreview.title = asset.title || 'Media asset'
  live.assetPreview.audio = audio
  live.assetPreview.duration = Math.max(0, Number(asset.durationMs || 0) / 1000)
  live.assetPreview.current = 0
  live.assetPreview.playing = false
  live.assetPreview.paused = false
  live.outputStatus = `Previewing ${asset.title || 'media asset'} locally.`
  audio.addEventListener('loadedmetadata', () => {
    updateLiveAssetPreviewState()
    if (currentStudioSection() === 'live' && currentLivePanel() === 'sequence') renderShell()
  })
  audio.addEventListener('ended', () => stopLiveAssetPreview({ render: currentStudioSection() === 'live' && currentLivePanel() === 'sequence' }), { once: true })
  renderShell()
  try {
    await audio.play()
    updateLiveAssetPreviewState()
    ensureLiveAssetPreviewTicker()
  } catch (error) {
    console.warn('[studio-live] asset preview failed', error)
    stopLiveAssetPreview({ render: false })
    live.outputStatus = 'Browser blocked preview playback. Try Preview again.'
  }
  renderShell()
}

async function toggleLiveAssetPreviewPause() {
  const live = liveState()
  const preview = live.assetPreview
  if (!preview.audio) return
  if (preview.audio.paused) {
    try {
      await preview.audio.play()
      preview.paused = false
      preview.playing = true
      ensureLiveAssetPreviewTicker()
    } catch (error) {
      console.warn('[studio-live] preview resume failed', error)
      live.outputStatus = 'Browser blocked preview resume.'
    }
  } else {
    try { preview.audio.pause() } catch {}
    preview.paused = true
    preview.playing = false
  }
  updateLiveAssetPreviewState()
  renderShell()
}

function setLiveAssetPreviewVolume(value = 0.85) {
  const preview = liveState().assetPreview
  preview.volume = Math.max(0, Math.min(1, Number(value || 0)))
  if (preview.audio) preview.audio.volume = preview.volume
}

function liveItemArt(item = {}) {
  const fallback = (item.titleSnapshot || item.title || item.type || '?').slice(0, 1).toUpperCase()
  return renderStudioStableImage({
    src: item.artworkURLSnapshot || item.artworkURL || '',
    fallback,
    key: `live-item-art-${item.itemId || item.assetId || fallback}`
  })
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
        </div>
      </div>
      <div class="studio-live-deck-actions">
        <div class="studio-live-deck-buttons">
          <button type="button" data-live-play-item="${esc(item?.itemId || '')}" ${item && isPlayableLiveItem(item) ? '' : 'disabled'} aria-label="${paused ? 'Resume' : 'Play'} ${esc(label)}">▶</button>
          <button type="button" data-live-pause-item="${esc(item?.itemId || '')}" ${player && !paused ? '' : 'disabled'} aria-label="Pause ${esc(label)}">Ⅱ</button>
          <button type="button" data-live-stop-item="${esc(item?.itemId || '')}" ${player ? '' : 'disabled'} aria-label="Stop ${esc(label)}">■</button>
          <button type="button" data-live-deck-menu="${esc(item?.itemId || '')}" ${item ? '' : 'disabled'} aria-label="Deck menu">⋯</button>
        </div>
        <label class="studio-live-progress" data-live-deck-progress="${esc(item?.itemId || '')}">
          <span><i data-live-progress-fill style="width:${progress.percent}%"></i><b data-live-progress-knob style="left:${progress.percent}%"></b></span>
          <input type="range" min="0" max="1000" value="${progress.value}" data-live-scrub-item="${esc(item?.itemId || '')}" ${player && progress.duration > 0 ? '' : 'disabled'} aria-label="Scrub ${esc(label)}" />
        </label>
        <small data-live-deck-time="${esc(item?.itemId || '')}">${formatMs(progress.current * 1000)} / ${formatMs(progress.duration * 1000)}</small>
      </div>
    </article>
  `
}

function renderLiveAssetPreviewControl() {
  const preview = liveState().assetPreview
  if (!preview.audio) return ''
  const progress = liveAssetPreviewProgress()
  return `
    <div class="studio-live-asset-preview" data-live-asset-preview>
      <div>
        <strong>Previewing: ${esc(preview.title || 'Media asset')}</strong>
        <span data-live-preview-time>${formatMs(progress.current * 1000)} / ${formatMs(progress.duration * 1000)} · Local monitor only</span>
      </div>
      <label class="studio-live-progress" data-live-preview-progress>
        <span><i data-live-progress-fill style="width:${progress.percent}%"></i><b data-live-progress-knob style="left:${progress.percent}%"></b></span>
      </label>
      <button type="button" data-live-pause-preview>${preview.paused ? 'Resume Preview' : 'Pause Preview'}</button>
      <button type="button" data-live-stop-preview>Stop Preview</button>
      <label class="studio-live-preview-volume"><span>Vol</span><input type="range" min="0" max="1" step="0.01" value="${Number(preview.volume || 0.85)}" data-live-preview-volume /></label>
    </div>
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
        <div class="studio-live-heading-actions">
          <span>${live.assets.length}</span>
          <button type="button" data-live-add-asset-open ${state.user ? '' : 'disabled'}>Add</button>
        </div>
      </div>
      ${renderLiveAssetPreviewControl()}
      <div class="studio-live-assets">
        ${live.loading ? '<p class="studio-live-empty">Loading asset metadata...</p>' : live.assets.length ? live.assets.map((asset) => `
          <div class="studio-live-asset-row" data-live-asset-row="${esc(asset.assetId)}">
            <button type="button" class="studio-live-asset-main" data-live-add-asset="${esc(asset.assetId)}" ${state.user && live.activeSequence ? '' : 'disabled'}>
              <span class="studio-live-row-art">${renderStudioStableImage({ src: asset.artworkURL, fallback: (asset.title || '?').slice(0, 1).toUpperCase(), key: `live-asset-art-${asset.assetId}` })}</span>
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

function liveHostViewerCount() {
  const live = liveState()
  if (isFirebaseSegmentProvider(live.providerId) && firebaseSegmentStreamingEnabled() && (live.streamId || live.stream?.status === 'live')) {
    return Number(live.nativePlaybackDemandCount || live.stream?.listenerCount || 0)
  }
  return Number(live.stream?.listenerCount || 0)
}

function renderListenerPreviewPanel() {
  const live = liveState()
  const form = live.streamForm
  const item = liveItemById(live.currentItemId)
  const link = publicLiveLink()
  return `
    <aside class="studio-live-listener-preview" aria-label="Listener page preview">
      <div class="studio-live-listener-art" data-live-preview-cover>
        ${renderStudioStableImage({ src: form.coverArtURL, fallback: 'MR', key: 'live-stream-cover-preview' })}
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
  const isBufferedProvider = isBufferedBroadcastProvider(live.providerId)
  const link = publicLiveLink()
  const isNativeRecovery = Boolean(live.nativeInterruptedStreamId && !live.streamId)
  const isLiveActive = Boolean(
    live.streamId ||
    live.stream?.status === 'live' ||
    ['liveIdleNoListeners', 'liveWarmingBuffer', 'liveBroadcasting'].includes(live.stream?.broadcastState || '')
  )
  const nativeLiveStatusCopy = isFirebaseSegmentProvider(live.providerId) && firebaseSegmentStreamingEnabled() && isLiveActive
    ? (live.nativePlaybackDemandCount > 0
        ? live.nativeRecorderRunning ? 'Live - broadcasting audio chunks.' : 'Live - warming buffer.'
        : 'Live - waiting for listeners.')
    : ''
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
          <span>${liveHostViewerCount()} viewers</span>
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
          ${isBufferedProvider ? `<label>Stream Key<input name="streamKey" maxlength="160" required value="${esc(form.streamKey ?? 'mystream')}" pattern="[A-Za-z0-9_-]+" autocomplete="off" /></label>` : ''}
          <div class="studio-live-cover-tools">
            <label>Cover image URL<input name="coverArtURL" value="${esc(form.coverArtURL)}" placeholder="https://..." /></label>
            <div class="studio-live-action-bar">
              <label class="studio-live-upload-button">
                <input type="file" accept="image/*" data-live-cover-upload />
                ${live.uploadingCover ? 'Uploading...' : 'Upload Cover'}
              </label>
              <button type="button" data-live-cover-clear ${form.coverArtURL || form.coverArtPath ? '' : 'disabled'}>Clear Cover</button>
            </div>
            <small>${form.coverArtSource === 'upload' ? 'Using uploaded square cover.' : form.coverArtURL ? 'Using linked cover URL.' : 'No cover selected yet.'}</small>
          </div>
          <label class="studio-live-check"><input name="rightsAccepted" type="checkbox" ${form.rightsAccepted ? 'checked' : ''} /> I have the rights and permissions required to broadcast this stream.</label>
          ${renderAdvancedStreamingSettings()}
          ${isNativeRecovery ? '<p class="studio-live-error">This Native Streaming session was interrupted because the browser host session ended. Resume to create a new host session, or end it for listeners.</p>' : ''}
          ${nativeLiveStatusCopy ? `<p class="studio-live-upload-status">${esc(nativeLiveStatusCopy)}</p>` : ''}
          <div class="studio-live-action-bar">
            <button type="submit" data-live-save-info ${live.savingInfo ? 'disabled' : ''}>${live.streamId ? 'Save / Update Stream Info' : 'Save Draft Details'}</button>
            ${isNativeRecovery
              ? `<button type="button" data-live-resume-native ${live.starting ? 'disabled' : ''}>${live.starting ? 'Resuming...' : 'Resume Stream'}</button><button type="button" data-live-end-interrupted ${live.ending ? 'disabled' : ''}>${live.ending ? 'Ending...' : 'End Interrupted Stream'}</button>`
              : isLiveActive ? '' : `<button type="button" data-live-start-stream ${state.user && !live.starting ? '' : 'disabled'}>${live.starting ? 'Starting...' : 'Start Stream'}</button>`}
            ${isLiveActive ? `<button type="button" data-live-end-stream ${live.ending ? 'disabled' : ''}>${live.ending ? 'Ending...' : 'End Stream'}</button>` : ''}
            ${link ? `<button type="button" class="studio-live-button" data-copy-live-link="${esc(link)}">Copy Public Link</button><a class="studio-live-button" href="${esc(link)}" target="_blank" rel="noreferrer">Open Public Listener Page</a>` : ''}
          </div>
        </form>
        ${renderListenerPreviewPanel()}
      </div>
    </section>
  `
}

function renderAdvancedStreamingSettings() {
  const live = liveState()
  const options = listStreamingProviderOptions()
  const current = options.find((option) => option.id === live.ingestMethod) || options[0]
  const diagnostics = live.providerDiagnostics || {}
  const streamKey = sanitizeHlsStreamKey(live.streamForm.streamKey || 'mystream')
  const hlsPlaybackUrl = buildHlsPlaybackUrl(streamKey)
  const ingestServer = String(import.meta.env?.VITE_STREAM_RTMP_INGEST_SERVER || '').trim()
  const isObs = live.ingestMethod === STREAM_INGEST_METHODS.obsRtmp
  const browserIngestConfigured = isBrowserWebrtcIngestConfigured()
  return `
    <details class="studio-live-advanced-streaming" ${live.advancedStreamingOpen ? 'open' : ''} data-advanced-streaming-settings>
      <summary>Advanced Streaming Settings</summary>
      <div class="studio-live-advanced-grid">
        <fieldset class="studio-live-method-fieldset">
          <legend>Streaming Method</legend>
          <input type="hidden" name="ingestMethod" value="${esc(live.ingestMethod)}" />
          <div class="studio-live-method-options" role="radiogroup" aria-label="Streaming Method">
            ${options.map((option) => `<button type="button" class="studio-live-method-option ${option.id === live.ingestMethod ? 'is-active' : ''}" role="radio" aria-checked="${option.id === live.ingestMethod}" data-streaming-method="${esc(option.id)}" ${live.streamId ? 'disabled' : ''}><strong>${esc(option.label)}</strong><small>${esc(option.description)}</small></button>`).join('')}
          </div>
        </fieldset>
        <div class="studio-live-provider-status">
          <strong>${esc(current?.label || 'Stream From Browser')}</strong>
          <span>${esc(isObs || browserIngestConfigured ? 'Ready' : 'Browser streaming needs the server WebRTC ingest URL configured.')}</span>
          <small>${esc(current?.description || '')}</small>
          <small>${esc(live.streamId ? 'Streaming method is locked for the active stream.' : 'The selected method is saved to the stream draft.')}</small>
        </div>
      </div>
      <div class="studio-live-provider-copy">
        <article>
          <h2>${isObs ? 'Stream From OBS / Encoder' : 'Stream From Browser'}</h2>
          <p>${esc(current?.description || '')}</p>
          <ul>
            ${isObs ? `<li>Server: ${esc(ingestServer || 'Set VITE_STREAM_RTMP_INGEST_SERVER')}</li>` : `<li>${esc(browserIngestConfigured ? 'Browser WebRTC ingest endpoint configured.' : 'Browser streaming needs the server WebRTC ingest URL configured.')}</li>`}
            <li>Stream Key: ${esc(streamKey || 'missing')}</li>
            <li>Playback URL: ${esc(hlsPlaybackUrl || 'missing')}</li>
            <li>Public playback: Buffered HLS from Melogic Edge</li>
          </ul>
        </article>
        <article>
          <h2>Streaming Diagnostics</h2>
          <ul>
            <li>Provider: hlsEdge</li>
            <li>Streaming method: ${esc(live.ingestMethod)}</li>
            <li>Transport provider: hls-edge</li>
            <li>Playback mode: hls</li>
            <li>Ingest method: ${esc(live.ingestMethod)}</li>
            <li>Ingest protocol: ${esc(ingestProtocolForMethod(live.ingestMethod))}</li>
            <li>Stream key: ${esc(diagnostics.streamKey || streamKey)}</li>
            <li>Playback URL: ${esc(diagnostics.hlsPlaybackUrl || hlsPlaybackUrl)}</li>
            <li>Stream document status: ${esc(diagnostics.streamDocStatus || live.stream?.status || (live.streamId ? 'live' : 'draft'))}</li>
            <li>Ingest connection: ${esc(diagnostics.ingestConnectionState || (isObs ? 'external encoder' : live.browserIngestActive ? 'connected' : 'idle'))}</li>
            <li>Ingest endpoint configured: ${browserIngestConfigured ? 'yes' : 'no'}</li>
            <li>Ingest endpoint: ${esc(diagnostics.ingestEndpointURL || (browserIngestConfigured ? 'configured' : 'none'))}</li>
            <li>Peer connection: ${esc(diagnostics.peerConnectionState || 'none')}</li>
            <li>ICE connection: ${esc(diagnostics.iceConnectionState || 'none')}</li>
            <li>Signaling: ${esc(diagnostics.signalingState || 'none')}</li>
            <li>Local offer created: ${diagnostics.localOfferCreated ? 'yes' : 'no'}</li>
            <li>Remote answer set: ${diagnostics.remoteAnswerSet ? 'yes' : 'no'}</li>
            <li>Media tracks: ${diagnostics.mediaStreamTrackCount ?? 0}</li>
            <li>Audio track: ${esc(diagnostics.audioTrackReadyState || 'none')}</li>
            <li>Video track: ${esc(diagnostics.videoTrackReadyState || 'none')}</li>
            <li>Last ingest error: ${esc(diagnostics.lastIngestError || 'none')}</li>
          </ul>
        </article>
      </div>
      <p class="studio-muted">Firebase stores metadata, presence, chat, viewer counts, and stream cards. Both streaming methods use buffered HLS for public playback.</p>
    </details>
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
      <div class="studio-live-source-grid studio-live-source-grid--foundation">
        <article class="studio-live-source-option ${live.inputSource === 'browser' ? 'is-active' : ''}">
          <header class="studio-live-source-card-header">
            <div><h2>Audio Input</h2><p>Mix browser mic/interface and Sequence Editor output into one program bus.</p></div>
            <label class="studio-live-switch"><input type="checkbox" data-live-av-toggle="audio" ${live.audioEnabled ? 'checked' : ''} /><span></span>Enable Audio</label>
          </header>
          <label class="studio-live-check"><input type="checkbox" data-live-audio-route="browser" ${live.browserInputEnabled ? 'checked' : ''} /> Browser Audio Input</label>
          <label class="studio-live-check"><input type="checkbox" data-live-audio-route="sequence" ${live.sequenceInputEnabled || live.inputSource === 'sequence' ? 'checked' : ''} /> Sequence Audio Output</label>
          <label>Device<select data-live-device-select ${live.devicesLoading ? 'disabled' : ''}>
            <option value="">Default input</option>
            ${live.devices.map((device) => `<option value="${esc(device.deviceId)}" ${live.selectedDeviceId === device.deviceId ? 'selected' : ''}>${esc(device.label || `Input ${device.deviceId.slice(0, 6)}`)}</option>`).join('')}
          </select></label>
          <label>Audio quality<select data-live-audio-mode><option value="music" ${live.streamForm.audioMode === 'music' ? 'selected' : ''}>Music quality stereo</option><option value="voice" ${live.streamForm.audioMode === 'voice' ? 'selected' : ''}>Voice optimized</option></select></label>
          <div class="studio-live-meter" aria-label="Browser input level"><i data-live-meter-fill style="width:${Math.round((live.micLevel || 0) * 100)}%"></i></div>
          <div class="studio-live-mixer">
            <label><span>Browser</span><input type="range" min="0" max="1.25" step="0.01" value="${Number(live.mixer.browserGain ?? 1)}" data-live-mixer="browserGain" /></label>
            <button type="button" class="${live.mixer.browserMuted ? 'is-active' : ''}" data-live-mixer-mute="browser">${live.mixer.browserMuted ? 'Unmute Mic' : 'Mute Mic'}</button>
            <label><span>Sequence</span><input type="range" min="0" max="1.25" step="0.01" value="${Number(live.mixer.sequenceGain ?? 1)}" data-live-mixer="sequenceGain" /></label>
            <button type="button" class="${live.mixer.sequenceMuted ? 'is-active' : ''}" data-live-mixer-mute="sequence">${live.mixer.sequenceMuted ? 'Unmute Seq' : 'Mute Seq'}</button>
            <label><span>Master</span><input type="range" min="0" max="1.25" step="0.01" value="${Number(live.mixer.masterGain ?? 1)}" data-live-mixer="masterGain" /></label>
          </div>
          <div class="studio-live-action-bar">
            <button type="button" data-live-set-source="browser" ${live.inputSource === 'browser' ? 'disabled' : ''}>Use Browser Input</button>
            <button type="button" data-live-refresh-devices>${live.devicesLoading ? 'Refreshing...' : 'Refresh Mic'}</button>
            <button type="button" data-live-prepare-mic ${live.micPreparing ? 'disabled' : ''}>${live.micPrepared ? 'Mic Ready' : live.micPreparing ? 'Preparing...' : 'Enable Mic'}</button>
          </div>
        </article>
        <article class="studio-live-source-option studio-live-video-input-card ${live.videoEnabled ? 'is-active' : ''}">
          <header class="studio-live-source-card-header">
            <div><h2>Video Input</h2><p>Choose the local visual source that can feed program output when Video is enabled.</p></div>
            <label class="studio-live-switch"><input type="checkbox" data-live-av-toggle="video" ${live.videoEnabled ? 'checked' : ''} /><span></span>Enable Video</label>
          </header>
          <div class="studio-live-video-input-scroll">
            <label>Video source<select data-live-video-source>
              <option value="browser" ${live.videoSource === 'browser' ? 'selected' : ''}>Browser Video Input</option>
              <option value="sequence" ${live.videoSource === 'sequence' ? 'selected' : ''}>Sequence Video Source</option>
            </select></label>
            <label>Camera / Screen<select data-live-video-device ${live.devicesLoading ? 'disabled' : ''}>
              <option value="">Default camera or screen source</option>
              ${live.videoDevices.map((device) => `<option value="${esc(device.deviceId)}" ${live.selectedVideoDeviceId === device.deviceId ? 'selected' : ''}>${esc(device.label || `Video input ${live.videoDevices.indexOf(device) + 1}`)}</option>`).join('')}
            </select></label>
            <label>Transition<select data-live-video-transition><option value="cut" ${live.videoTransition === 'cut' ? 'selected' : ''}>Cut</option><option value="fade" ${live.videoTransition === 'fade' ? 'selected' : ''}>Fade</option></select></label>
            <div class="studio-live-video-preview ${live.videoPreviewActive ? 'is-active' : ''}" data-live-video-preview-mount>
              <span>${esc(live.videoPreviewError || (live.videoPreviewActive ? 'Video input preview active' : 'No video input preview'))}</span>
            </div>
            <p class="studio-live-source-status">${esc(live.videoPreviewError || (live.localVideoTrack ? `Video input ready. Transition: ${live.videoTransition}.` : 'Choose a camera/source and click Use Input to preview and publish while live.'))}</p>
            <div class="studio-live-action-bar">
              <button type="button" data-live-use-video-input ${live.videoEnabled ? '' : 'disabled'}>${live.localVideoTrack ? 'Use Input Again' : 'Use Input'}</button>
              <button type="button" data-live-refresh-video>${live.devicesLoading ? 'Refreshing...' : 'Refresh Video'}</button>
              <a class="studio-live-button" href="${livePanelHref('sequence')}" data-live-panel="sequence">Open Sequence Editor</a>
            </div>
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
          <span>Program source is ${live.inputSource === 'sequence' ? 'Sequence Output' : 'Browser Input'}. Local monitor is ${live.monitorEnabled ? 'on' : 'off'} and stays independent from program output.</span>
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
        <label class="studio-live-check studio-live-check--stacked">
          <span><input name="autoMatchSequencer" type="checkbox" ${meta.autoMatchSequencer ? 'checked' : ''} /> Match sequencer now playing</span>
          <small>When enabled, live metadata follows the currently playing sequence item. You can still send a manual override at any time.</small>
        </label>
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
      <header class="studio-live-subheader"><div><p class="eyebrow">Live Studio</p><h1>Chat</h1><p>Host chat and moderation stay out of the sequence editor.</p></div><div class="studio-live-status-cluster"><span>${liveHostViewerCount()} viewers</span></div></header>
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
  const videoURL = item?.videoURLSnapshot || item?.videoURL || ''
  const previewMedia = videoURL
    ? `<button type="button" class="studio-live-sequence-video-preview" data-live-preview-fullscreen aria-label="Open video preview fullscreen"><video muted playsinline preload="metadata" src="${esc(videoURL)}"></video></button>`
    : `<div class="studio-live-deck-art">${item ? liveItemArt(item) : '<span>-</span>'}</div>`
  return `
    <section class="studio-live-panel">
      <header class="studio-live-subheader"><div><p class="eyebrow">Live Studio</p><h1>Preview / Monitor</h1><p>Detached monitor windows are monitor-only and do not publish output.</p></div></header>
      <div class="studio-live-monitor-preview">
        ${previewMedia}
        <div><h2>${esc(item?.titleSnapshot || 'No item loaded')}</h2><p>${esc(item?.type === 'video' ? 'Video preview' : 'Audio-only preview')}</p><span>${esc(live.outputStatus)}</span></div>
      </div>
      <div class="studio-live-action-bar"><button type="button" data-live-open-monitor>Open Monitor</button></div>
    </section>
  `
}

function renderLiveAssetAddModal() {
  const live = liveState()
  const add = live.assetAdd || {}
  if (!add.open) return ''
  return `
    <div class="studio-modal" data-live-asset-add-backdrop>
      <form class="studio-modal-panel studio-live-asset-editor" data-live-asset-add-form>
        <header class="studio-live-modal-header">
          <div>
            <p class="eyebrow">Media Assets</p>
            <h3>Add Asset</h3>
          </div>
          <button type="button" data-close-live-asset-add aria-label="Close add asset">×</button>
        </header>
        ${add.error ? `<p class="studio-live-error">${esc(add.error)}</p>` : ''}
        ${add.status ? `<p class="studio-live-upload-status">${esc(add.status)}</p>` : ''}
        <div class="studio-live-modal-grid">
          <label>Type
            <select name="mode">
              <option value="audio" ${add.mode === 'audio' ? 'selected' : ''}>Upload Audio</option>
              <option value="video" ${add.mode === 'video' ? 'selected' : ''}>Upload Video</option>
              <option value="audio_video" ${add.mode === 'audio_video' ? 'selected' : ''}>Upload Audio + Video</option>
              <option value="metadata_only" ${add.mode === 'metadata_only' ? 'selected' : ''}>Add Metadata Only</option>
            </select>
          </label>
          <label>Category<select name="category">${SEQUENCE_ASSET_CATEGORIES.map((category) => `<option value="${esc(category)}">${esc(category.replaceAll('_', ' '))}</option>`).join('')}</select></label>
          <label>Title<input name="title" maxlength="160" placeholder="Asset title" /></label>
          <label>Artist<input name="artist" maxlength="160" /></label>
          <label>Album<input name="album" maxlength="160" /></label>
          <label>Artwork URL<input name="artworkURL" placeholder="https://..." /></label>
          <label>Audio file<input name="audioFile" type="file" accept="audio/*" /></label>
          <label>Video file<input name="videoFile" type="file" accept="video/*" /></label>
        </div>
        <label>Notes<textarea name="notes" maxlength="1000" placeholder="Optional notes"></textarea></label>
        <div class="studio-modal-actions">
          <button type="button" class="button button-muted" data-close-live-asset-add>Cancel</button>
          <button type="submit" class="button" ${add.uploading ? 'disabled' : ''}>${add.uploading ? 'Adding...' : 'Add Asset'}</button>
        </div>
      </form>
    </div>
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

function renderLiveAssetEditorModal() {
  const live = liveState()
  const editor = live.assetEditor || {}
  const asset = editor.assetId ? liveAssetById(editor.assetId) : null
  if (!asset) return ''
  return `
    <div class="studio-modal" data-live-asset-editor-backdrop>
      <form class="studio-modal-panel studio-live-asset-editor" data-live-asset-editor-form data-asset-id="${esc(asset.assetId)}">
        <header class="studio-live-modal-header">
          <div>
            <p class="eyebrow">Media Asset</p>
            <h3>Edit Metadata</h3>
          </div>
          <button type="button" data-close-live-asset-editor aria-label="Close metadata editor">×</button>
        </header>
        ${editor.error ? `<p class="studio-live-error">${esc(editor.error)}</p>` : ''}
        <div class="studio-live-modal-grid">
          <label>Title<input name="title" maxlength="160" value="${esc(asset.title)}" required /></label>
          <label>Artist<input name="artist" maxlength="160" value="${esc(asset.artist)}" /></label>
          <label>Album<input name="album" maxlength="160" value="${esc(asset.album)}" /></label>
          <label>Category<select name="category">${SEQUENCE_ASSET_CATEGORIES.map((category) => `<option value="${esc(category)}" ${asset.category === category ? 'selected' : ''}>${esc(category.replaceAll('_', ' '))}</option>`).join('')}</select></label>
          <label>Tags<input name="tags" value="${esc((asset.tags || []).join(', '))}" placeholder="radio, bumper, release" /></label>
          <label>Artwork URL<input name="artworkURL" value="${esc(asset.artworkURL)}" placeholder="https://..." /></label>
          <label>Fade In (seconds)<input name="defaultFadeInSeconds" type="number" min="0" max="60" step="0.1" value="${esc(Number(asset.defaultFadeInMs || 0) / 1000)}" /></label>
          <label>Fade Out (seconds)<input name="defaultFadeOutSeconds" type="number" min="0" max="60" step="0.1" value="${esc(Number(asset.defaultFadeOutMs || 0) / 1000)}" /></label>
          <label>Default Crossfade (seconds)<input name="defaultCrossfadeSeconds" type="number" min="0" max="60" step="0.1" value="${esc(Number(asset.defaultCrossfadeMs || 0) / 1000)}" /></label>
          <label>Gain Trim (dB)<input name="gainDb" type="number" min="-24" max="24" step="0.1" value="${esc(Number(asset.gainDb || 0))}" /></label>
        </div>
        <label>Notes<textarea name="notes" maxlength="1000">${esc(asset.notes)}</textarea></label>
        <details class="studio-live-asset-details">
          <summary>File details</summary>
          <p>Duration: ${formatMs(asset.durationMs || 0)}</p>
          <p>Type: ${esc(asset.type || 'audio')}</p>
          <p>Audio: ${esc(asset.normalizedAudioPath || asset.originalFileName || 'Ready asset')}</p>
        </details>
        <div class="studio-modal-actions">
          <button type="button" class="button button-muted" data-close-live-asset-editor>Cancel</button>
          <button type="submit" class="button" ${editor.saving ? 'disabled' : ''}>${editor.saving ? 'Saving...' : 'Save Changes'}</button>
        </div>
      </form>
    </div>
  `
}

function ensureProgramMixerData() {
  const live = liveState()
  const mixer = live.programMixer
  if (!state.user?.uid || mixer.loaded || mixer.loading) return
  mixer.loading = true
  Promise.all([
    listProgramScenes(state.user.uid),
    listProgramSources(state.user.uid),
    listLiveStudioGuestInvites(liveStudioSessionId())
  ]).then(([scenes, sources, guests]) => {
    mixer.scenes = scenes
    mixer.sources = sources
    live.guests = guests
    if (!mixer.scenes.some((scene) => scene.sceneId === mixer.previewSceneId)) mixer.previewSceneId = ''
    if (!mixer.scenes.some((scene) => scene.sceneId === mixer.programSceneId)) mixer.programSceneId = ''
    if (!mixer.scenes.some((scene) => scene.sceneId === mixer.activeSceneId)) mixer.activeSceneId = mixer.programSceneId || ''
    if (!mixer.sources.some((source) => source.sourceId === mixer.selectedSourceId)) mixer.selectedSourceId = ''
    mixer.loaded = true
    mixer.loading = false
    ensureGuestInviteSubscription()
    renderShell()
  }).catch((error) => {
    mixer.notice = error?.message || 'Program Mixer scenes could not load.'
    mixer.loading = false
    mixer.loaded = true
    renderShell()
  })
}

function liveStudioSessionId() {
  const live = liveState()
  return live.streamId || live.draftStreamId || (state.user?.uid ? `draft_${state.user.uid}` : '')
}

async function ensureLiveStudioSessionId() {
  const live = liveState()
  if (live.streamId || live.draftStreamId) return liveStudioSessionId()
  const response = await prepareMusicLiveStreamDraft(liveStreamPayload())
  live.draftStreamId = response.streamId || live.draftStreamId
  if (live.draftStreamId) subscribeLiveStudioStream(live.draftStreamId)
  ensureGuestInviteSubscription()
  return liveStudioSessionId()
}

function ensureGuestInviteSubscription() {
  const live = liveState()
  const sessionId = liveStudioSessionId()
  if (!sessionId || live.guestSessionId === sessionId) return
  live.guestUnsubscribe?.()
  live.guestSessionId = sessionId
  live.guestUnsubscribe = subscribeLiveStudioGuestInvites(sessionId, (guests) => {
    live.guests = guests
    if (currentStudioSection() === 'live' && currentLivePanel() === 'program') renderShell()
  })
}

function liveProgramOutputState() {
  const live = liveState()
  const mixer = live.programMixer || {}
  const streamNative = live.stream?.nativeStreaming || {}
  const diagnostics = live.providerDiagnostics || {}
  const providerId = normalizeProviderId(live.providerId)
  live.providerId = providerId
  const ingestMethod = normalizeIngestMethod(live.ingestMethod, providerId)
  live.ingestMethod = ingestMethod
  const isFirebaseSegments = isFirebaseSegmentProvider(providerId)
  const streamKey = sanitizeHlsStreamKey(live.streamForm.streamKey || 'mystream')
  const programScene = (mixer.scenes || []).find((scene) => scene.sceneId === mixer.programSceneId)
  const programSourceIds = new Set(Array.isArray(programScene?.sources) ? programScene.sources : [])
  const programSources = (mixer.sources || []).filter((source) => programSourceIds.has(source.sourceId))
  const hasEnabledVideoSource = programSources.some((source) => {
    if (source.enabled === false || source.visible === false) return false
    return ['browser-camera', 'sequence-video', 'now-playing-card', 'image', 'text-lower-third', 'guest-video'].includes(source.type)
  })
  const hasRoutedAudioSource = programSources.some((source) => {
    if (source.enabled === false || source.muted === true || source.programEnabled === false) return false
    return ['browser-microphone', 'sequence-audio', 'guest-audio'].includes(source.type)
  })
  const programHasAudio = Boolean(live.audioEnabled && (hasRoutedAudioSource || (
    (live.browserInputEnabled && !live.mixer.browserMuted) ||
    ((live.sequenceInputEnabled || live.inputSource === 'sequence') && !live.mixer.sequenceMuted)
  )))
  const programHasVideo = Boolean(live.videoEnabled && hasEnabledVideoSource && programScene)
  return {
    provider: isFirebaseSegments ? STREAM_PROVIDERS.firebaseSegments : STREAM_PROVIDERS.hlsEdge,
    providerLabel: isFirebaseSegments ? 'Firebase Segments' : 'Melogic Edge',
    transportProvider: isFirebaseSegments ? 'firebase' : 'hls-edge',
    ingestMethod: isFirebaseSegments ? '' : ingestMethod,
    ingestProtocol: isFirebaseSegments ? '' : ingestProtocolForMethod(ingestMethod),
    ingestMode: isFirebaseSegments ? 'browser-media-recorder' : ingestMethod === STREAM_INGEST_METHODS.browserWebrtc ? 'browser-webrtc' : 'rtmp-obs',
    playbackMode: isFirebaseSegments ? 'firebaseSegments' : 'hls',
    latencyProfile: isFirebaseSegments ? 'realtime' : 'buffered',
    streamKey: isFirebaseSegments ? '' : streamKey,
    hlsPlaybackUrl: isFirebaseSegments ? '' : buildHlsPlaybackUrl(streamKey),
    nativeStreaming: {
      enabled: isFirebaseSegments,
      targetLatencyMs: 30000,
      segmentDurationMs: 4000,
      audioFirst: true,
      videoEnabled: false,
      idleWhenNoListeners: true,
      minPlaybackBufferMs: 20000,
      maxPlaybackBufferMs: 60000,
      rollingRetentionMs: 300000,
      status: live.nativeStreamingStatus || 'idleNoListeners',
      hasPlayableSegments: Boolean(diagnostics.hasPlayableSegments || streamNative.hasPlayableSegments),
      oldestAvailableSegmentIndex: streamNative.oldestAvailableSegmentIndex ?? null,
      newestAvailableSegmentIndex: diagnostics.newestAvailableSegmentIndex ?? streamNative.newestAvailableSegmentIndex ?? null,
      currentSegmentIndex: diagnostics.newestAvailableSegmentIndex ?? streamNative.currentSegmentIndex ?? null,
      lastSegmentAt: streamNative.lastSegmentAt || null
    },
    hostActive: Boolean(live.streamId && !live.nativeInterruptedStreamId),
    hostSessionId: live.nativeHostSessionId || '',
    audioEnabled: live.audioEnabled,
    videoEnabled: live.videoEnabled,
    audioOnly: !programHasVideo,
    activeAudioSources: {
      browser: Boolean(live.browserInputEnabled),
      sequence: Boolean(live.sequenceInputEnabled || live.inputSource === 'sequence')
    },
    activeVideoSource: live.videoEnabled ? live.videoSource : '',
    programHasAudio,
    programHasVideo,
    audioPublished: Boolean(!isBuffered && live.audioPublishedToProvider && programHasAudio),
    videoPublished: Boolean(!isBuffered && live.videoPublishedToProvider && live.videoEnabled && live.programVideoTrack),
    programState: {
      previewSceneId: mixer.previewSceneId || '',
      programSceneId: mixer.programSceneId || '',
      activeSceneId: mixer.programSceneId || mixer.activeSceneId || '',
      selectedSourceId: mixer.selectedSourceId || '',
      outputResolution: mixer.outputResolution || '1280x720',
      fps: Number(mixer.fps || 30),
      mode: mixer.mode || 'program'
    },
    providerDiagnostics: {
      ...(provider.getDiagnostics?.() || {}),
      ...(live.providerDiagnostics || {})
    }
  }
}

async function heartbeatLiveProgramState(extra = {}) {
  const live = liveState()
  if (!live.streamId) return
  await heartbeatMusicLiveStream(live.streamId, {
    ...liveProgramOutputState(),
    ...extra,
    connectionStatus: extra.connectionStatus || 'live'
  })
}

function ensureStudioProgramMixer() {
  const live = liveState()
  const [width, height] = String(live.programMixer.outputResolution || '1280x720').split('x').map((value) => Number(value) || 0)
  if (!studioProgramMixer) {
    studioProgramMixer = new ProgramMixer({ width: width || 1280, height: height || 720, fps: Number(live.programMixer.fps || 30) })
  }
  studioProgramMixer.width = width || 1280
  studioProgramMixer.height = height || 720
  studioProgramMixer.fps = Number(live.programMixer.fps || 30)
  studioProgramMixer.sources = new Map((live.programMixer.sources || []).map((source) => [source.sourceId, { ...source }]))
  const programScene = live.programMixer.scenes.find((scene) => scene.sceneId === live.programMixer.programSceneId) || null
  studioProgramMixer.setScene(live.programMixer.programSceneId || '', programScene)
  if (live.audioEnabled) studioProgramMixer.enableAudio()
  else studioProgramMixer.disableAudio()
  if (live.videoEnabled) studioProgramMixer.enableVideo()
  else studioProgramMixer.disableVideo()
  return studioProgramMixer
}

function attachProgramMixerPreview() {
  const previewCanvas = app.querySelector('[data-program-preview-canvas]')
  const programCanvas = app.querySelector('[data-program-program-canvas]')
  if (previewCanvas) drawProgramPreviewCanvas(previewCanvas, 'preview')
  const canvas = programCanvas || previewCanvas
  if (!canvas) return
  const mixer = ensureStudioProgramMixer()
  mixer.attachCanvas(canvas)
  if (liveState().videoEnabled) mixer.startRenderLoop()
  else mixer.drawPlaceholder()
}

function drawProgramPreviewCanvas(canvas, mode = 'preview') {
  const live = liveState()
  const mixer = live.programMixer
  const context = canvas?.getContext?.('2d')
  if (!context) return
  const [width, height] = String(mixer.outputResolution || '1280x720').split('x').map((value) => Number(value) || 0)
  canvas.width = width || 1280
  canvas.height = height || 720
  const sceneId = mode === 'program' ? mixer.programSceneId : mixer.previewSceneId
  const scene = mixer.scenes.find((entry) => entry.sceneId === sceneId)
  const allowedSourceIds = new Set(Array.isArray(scene?.sources) ? scene.sources : [])
  const sources = mixer.sources
    .filter((source) => scene && allowedSourceIds.has(source.sourceId) && source.enabled !== false && source.visible !== false)
    .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
  context.fillStyle = '#05080f'
  context.fillRect(0, 0, canvas.width, canvas.height)
  if (!scene || !sources.length) {
    context.fillStyle = '#9fb0d0'
    context.font = '700 30px system-ui, sans-serif'
    context.textAlign = 'center'
    context.fillText(scene ? 'Scene has no visible sources' : `No ${mode} scene selected`, canvas.width / 2, canvas.height / 2)
    return
  }
  sources.forEach((source, index) => {
    const x = source.transform?.x ?? 48 + index * 36
    const y = source.transform?.y ?? 48 + index * 30
    const boxWidth = source.transform?.width ?? (source.type === 'now-playing-card' ? 430 : canvas.width - 96)
    const boxHeight = source.transform?.height ?? (source.type === 'now-playing-card' ? 160 : canvas.height - 96)
    context.globalAlpha = Number(source.opacity ?? 1)
    context.fillStyle = source.type === 'now-playing-card' ? 'rgba(14,20,32,.88)' : 'rgba(22,31,48,.82)'
    context.fillRect(x, y, boxWidth, boxHeight)
    context.strokeStyle = mode === 'program' ? 'rgba(255,87,108,.7)' : 'rgba(103,242,170,.7)'
    context.lineWidth = 2
    context.strokeRect(x, y, boxWidth, boxHeight)
    context.fillStyle = '#eef4ff'
    context.font = '700 24px system-ui, sans-serif'
    context.textAlign = 'left'
    context.fillText(source.label || source.type, x + 22, y + 42)
    context.globalAlpha = 1
  })
}

function selectedProgramSource() {
  const mixer = liveState().programMixer
  return mixer.sources.find((source) => source.sourceId === mixer.selectedSourceId) || null
}

function persistProgramSource(source = null) {
  if (!state.user?.uid || !source) return
  saveProgramSource(state.user.uid, source).catch((error) => {
    liveState().programMixer.notice = error?.message || 'Program source could not be saved.'
    renderShell()
  })
}

function updateProgramSource(sourceId = '', patch = {}, { persist = true } = {}) {
  const live = liveState()
  const mixer = live.programMixer
  let updated = null
  mixer.sources = mixer.sources.map((source) => {
    if (source.sourceId !== sourceId) return source
    updated = { ...source, ...patch }
    return updated
  })
  if (!updated) return
  studioProgramMixer?.sources?.set?.(sourceId, { ...updated })
  if (persist) persistProgramSource(updated)
  heartbeatLiveProgramState().catch(() => {})
  renderShell()
}

async function handleProgramSceneAction(action = '') {
  const live = liveState()
  const mixer = live.programMixer
  const activeScene = mixer.scenes.find((scene) => scene.sceneId === mixer.previewSceneId || scene.sceneId === mixer.programSceneId) || mixer.scenes[0]
  if (action === 'create') {
    mixer.sceneModal = { open: true, name: '', templateId: 'blank', error: '' }
    renderShell()
    return
  } else if (action === 'rename' && activeScene) {
    const name = window.prompt('Rename scene', activeScene.name || 'Untitled Scene')
    if (!name) return
    const scene = { ...activeScene, name: name.trim().slice(0, 80) || activeScene.name }
    mixer.scenes = mixer.scenes.map((entry) => entry.sceneId === scene.sceneId ? scene : entry)
    if (state.user?.uid) await saveProgramScene(state.user.uid, scene).catch(() => {})
  } else if (action === 'duplicate' && activeScene) {
    const scene = {
      ...activeScene,
      sceneId: `scene_${Date.now().toString(36)}`,
      name: `${activeScene.name || 'Scene'} Copy`.slice(0, 80)
    }
    mixer.scenes = [scene, ...mixer.scenes]
    mixer.previewSceneId = scene.sceneId
    if (state.user?.uid) await saveProgramScene(state.user.uid, scene).catch(() => {})
  } else if (action === 'delete' && activeScene) {
    if (!window.confirm(`Delete "${activeScene.name}"?`)) return
    mixer.scenes = mixer.scenes.filter((scene) => scene.sceneId !== activeScene.sceneId)
    if (mixer.previewSceneId === activeScene.sceneId) mixer.previewSceneId = ''
    if (mixer.programSceneId === activeScene.sceneId) mixer.programSceneId = ''
    if (mixer.activeSceneId === activeScene.sceneId) mixer.activeSceneId = mixer.programSceneId || ''
    if (state.user?.uid) await deleteProgramScene(state.user.uid, activeScene.sceneId).catch(() => {})
  }
  studioProgramMixer?.setScene?.(mixer.programSceneId)
  mixer.notice = ''
  heartbeatLiveProgramState().catch(() => {})
  renderShell()
}

function sourceDefaultsForType(type = 'custom', label = '') {
  const sourceType = PROGRAM_SOURCE_TYPES.find((entry) => entry.type === type)
  const isAudio = ['browser-microphone', 'sequence-audio', 'guest-audio'].includes(type)
  return {
    sourceId: `source_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    label: label || sourceType?.label || 'Untitled Source',
    enabled: true,
    muted: false,
    visible: !isAudio,
    programEnabled: true,
    monitorEnabled: false,
    gain: 1,
    zIndex: type === 'now-playing-card' || type === 'text-lower-third' ? 3 : 1,
    opacity: 1,
    objectFit: 'cover',
    transform: type === 'now-playing-card'
      ? { x: 760, y: 430, width: 430, height: 160 }
      : type === 'text-lower-third'
        ? { x: 64, y: 540, width: 760, height: 110 }
        : {}
  }
}

async function createProgramSource({ type = 'browser-microphone', label = '', targetSceneId = '' } = {}) {
  const live = liveState()
  const mixer = live.programMixer
  const source = sourceDefaultsForType(type, label)
  mixer.sources = [source, ...mixer.sources]
  mixer.selectedSourceId = source.sourceId
  const sceneId = targetSceneId || mixer.previewSceneId || mixer.programSceneId || ''
  const scene = mixer.scenes.find((entry) => entry.sceneId === sceneId)
  if (scene) {
    const updatedScene = { ...scene, sources: Array.from(new Set([...(scene.sources || []), source.sourceId])) }
    mixer.scenes = mixer.scenes.map((entry) => entry.sceneId === updatedScene.sceneId ? updatedScene : entry)
    if (state.user?.uid) await saveProgramScene(state.user.uid, updatedScene).catch(() => {})
  }
  if (state.user?.uid) await saveProgramSource(state.user.uid, source).catch(() => {})
  heartbeatLiveProgramState().catch(() => {})
  renderShell()
  return source
}

async function createProgramSceneFromModal(formEl) {
  const live = liveState()
  const mixer = live.programMixer
  const data = new FormData(formEl)
  const templateId = String(data.get('templateId') || 'blank')
  const template = PROGRAM_SCENE_TEMPLATES.find((entry) => entry.templateId === templateId) || PROGRAM_SCENE_TEMPLATES[0]
  const scene = {
    sceneId: `scene_${Date.now().toString(36)}`,
    name: String(data.get('name') || template.name || 'Untitled Scene').trim().slice(0, 80),
    transitionPreference: 'fade',
    sources: []
  }
  const createdSources = []
  for (const type of template.sourceTypes || []) {
    const source = sourceDefaultsForType(type)
    createdSources.push(source)
    scene.sources.push(source.sourceId)
  }
  mixer.scenes = [scene, ...mixer.scenes]
  mixer.sources = [...createdSources, ...mixer.sources]
  mixer.previewSceneId = scene.sceneId
  mixer.selectedSourceId = createdSources[0]?.sourceId || mixer.selectedSourceId || ''
  mixer.sceneModal = { open: false, name: '', templateId: 'blank', error: '' }
  if (state.user?.uid) {
    await saveProgramScene(state.user.uid, scene).catch(() => {})
    await Promise.all(createdSources.map((source) => saveProgramSource(state.user.uid, source).catch(() => {})))
  }
  renderShell()
}

async function createProgramSourceFromModal(formEl) {
  const live = liveState()
  const mixer = live.programMixer
  const data = new FormData(formEl)
  const type = String(data.get('type') || 'browser-microphone')
  const targetSceneId = String(data.get('targetSceneId') || mixer.previewSceneId || '')
  await createProgramSource({
    type,
    label: String(data.get('name') || '').trim(),
    targetSceneId
  })
  mixer.sourceModal = { open: false, name: '', type: 'browser-microphone', targetSceneId: '', error: '' }
}

function handleProgramSourceAction(action = '') {
  const source = selectedProgramSource()
  if (!source || source.locked) return
  const zIndex = Number(source.zIndex || 0)
  if (action === 'forward') updateProgramSource(source.sourceId, { zIndex: zIndex + 1 })
  else if (action === 'backward') updateProgramSource(source.sourceId, { zIndex: zIndex - 1 })
  else if (action === 'fit' || action === 'fill') updateProgramSource(source.sourceId, { objectFit: action === 'fit' ? 'contain' : 'cover' })
  else if (action === 'center') updateProgramSource(source.sourceId, { transform: { ...(source.transform || {}), x: 48, y: 48 } })
  else if (action === 'reset') updateProgramSource(source.sourceId, { opacity: 1, objectFit: 'cover', transform: {}, zIndex: source.type === 'now-playing-card' ? 3 : 1 })
}

function renderProgramSceneModal() {
  const modal = liveState().programMixer.sceneModal || {}
  if (!modal.open) return ''
  return `
    <div class="studio-modal" data-program-scene-modal>
      <form class="studio-modal-panel studio-program-modal" data-program-scene-form>
        <header class="studio-live-modal-header">
          <div><p class="eyebrow">Program Mixer</p><h3>New Scene</h3></div>
          <button type="button" data-program-close-scene-modal aria-label="Close scene creator">×</button>
        </header>
        ${modal.error ? `<p class="studio-live-error">${esc(modal.error)}</p>` : ''}
        <label>Name<input name="name" maxlength="80" value="${esc(modal.name || '')}" placeholder="Scene name" /></label>
        <label>Starting layout
          <select name="templateId">
            ${PROGRAM_SCENE_TEMPLATES.map((template) => `<option value="${esc(template.templateId)}" ${template.templateId === modal.templateId ? 'selected' : ''}>${esc(template.name)}</option>`).join('')}
          </select>
        </label>
        <div class="studio-modal-actions">
          <button type="button" class="button button-muted" data-program-close-scene-modal>Cancel</button>
          <button type="submit" class="button">Create Scene</button>
        </div>
      </form>
    </div>
  `
}

function renderProgramSourceModal() {
  const live = liveState()
  const mixer = live.programMixer
  const modal = mixer.sourceModal || {}
  if (!modal.open) return ''
  return `
    <div class="studio-modal" data-program-source-modal>
      <form class="studio-modal-panel studio-program-modal" data-program-source-form>
        <header class="studio-live-modal-header">
          <div><p class="eyebrow">Program Mixer</p><h3>Add Source</h3></div>
          <button type="button" data-program-close-source-modal aria-label="Close source creator">×</button>
        </header>
        ${modal.error ? `<p class="studio-live-error">${esc(modal.error)}</p>` : ''}
        <label>Source Type
          <select name="type">
            ${PROGRAM_SOURCE_TYPES.map((sourceType) => `<option value="${esc(sourceType.type)}" ${sourceType.type === modal.type ? 'selected' : ''}>${esc(sourceType.label)}${sourceType.future ? ' (future)' : ''}</option>`).join('')}
          </select>
        </label>
        <label>Name<input name="name" maxlength="80" value="${esc(modal.name || '')}" placeholder="Optional source name" /></label>
        <label>Add to scene
          <select name="targetSceneId">
            <option value="">Source library only</option>
            ${mixer.scenes.map((scene) => `<option value="${esc(scene.sceneId)}" ${scene.sceneId === (modal.targetSceneId || mixer.previewSceneId) ? 'selected' : ''}>${esc(scene.name)}</option>`).join('')}
          </select>
        </label>
        <p class="studio-muted">Browser permissions are requested only when a source is activated or configured.</p>
        <div class="studio-modal-actions">
          <button type="button" class="button button-muted" data-program-close-source-modal>Cancel</button>
          <button type="submit" class="button">Add Source</button>
        </div>
      </form>
    </div>
  `
}

function renderProgramMixerPanel() {
  const live = liveState()
  ensureProgramMixerData()
  const mixer = live.programMixer
  const previewScene = mixer.scenes.find((scene) => scene.sceneId === mixer.previewSceneId)
  const programScene = mixer.scenes.find((scene) => scene.sceneId === mixer.programSceneId)
  const selectedSource = selectedProgramSource()
  const previewSourceIds = new Set(previewScene?.sources || [])
  const audioSources = mixer.sources.filter((source) => ['browser-microphone', 'sequence-audio', 'guest-audio'].includes(source.type))
  return `
    <section class="studio-live-panel studio-program-panel">
      <header class="studio-live-subheader studio-program-topbar">
        <div>
          <p class="eyebrow">Live Studio</p>
          <h1>Program Mixer</h1>
          <p>Preview is local only. Program is the broadcast canvas.</p>
        </div>
      </header>
      ${mixer.notice ? `<p class="studio-live-error">${esc(mixer.notice)}</p>` : ''}
      <div class="studio-program-workspace">
        <aside class="studio-program-left">
          <section>
            <header><h2>Guests</h2></header>
            <form class="studio-program-guest-search" data-program-guest-search-form>
              <input name="query" value="${esc(live.guestSearchQuery)}" placeholder="Search username or display name" />
              <button type="submit">Search</button>
            </form>
            ${live.guestSearchResults.length ? `<div class="studio-program-list">${live.guestSearchResults.map((profile) => `<button type="button" data-program-invite-user="${esc(profile.uid)}"><strong>${esc(profile.displayName || profile.username || 'Melogic user')}</strong><small>@${esc(profile.username || profile.uid)} · Invite guest</small></button>`).join('')}</div>` : ''}
            <div class="studio-program-list studio-program-guest-list">
              ${live.guests.length ? live.guests.map((guest) => `<article>
                <strong>${esc(guest.guestDisplayName || guest.guestUsername || 'Invited guest')}</strong>
                <small>${esc(guest.status || 'invited')}</small>
                <div class="studio-program-mini-actions">
                  <button type="button" data-program-guest-source="${esc(guest.inviteId)}" data-source-type="guest-audio">Audio</button>
                  <button type="button" data-program-guest-source="${esc(guest.inviteId)}" data-source-type="guest-video">Video</button>
                  <button type="button" data-program-remove-guest="${esc(guest.inviteId)}">Remove</button>
                </div>
              </article>`).join('') : '<p class="studio-program-empty">No guests invited.</p>'}
            </div>
            ${live.guestInviteStatus ? `<p class="studio-muted">${esc(live.guestInviteStatus)}</p>` : ''}
          </section>
          <section>
            <header><h2>Scenes</h2><button type="button" data-program-scene-action="create">New</button></header>
            <div class="studio-program-list">
              ${mixer.scenes.length ? mixer.scenes.map((scene) => `<button type="button" class="${scene.sceneId === previewScene?.sceneId ? 'is-active' : ''} ${scene.sceneId === programScene?.sceneId ? 'is-program' : ''}" data-program-scene="${esc(scene.sceneId)}"><strong>${esc(scene.name)}</strong><small>${scene.sceneId === programScene?.sceneId ? 'PROGRAM' : scene.sceneId === previewScene?.sceneId ? 'PREVIEW' : esc(scene.transitionPreference || scene.transition || 'fade')}</small></button>`).join('') : '<p class="studio-program-empty">No scenes yet. Create a scene to start mixing.</p>'}
            </div>
            <div class="studio-program-mini-actions">
              <button type="button" data-program-scene-action="rename">Rename</button>
              <button type="button" data-program-scene-action="duplicate">Duplicate</button>
              <button type="button" data-program-scene-action="delete">Delete</button>
            </div>
          </section>
          <section>
            <header><h2>Sources</h2><button type="button" data-program-open-source-modal>Add</button></header>
            <div class="studio-program-list studio-program-source-list">
              ${mixer.sources.length ? mixer.sources.map((source) => `<button type="button" class="${source.sourceId === selectedSource?.sourceId ? 'is-active' : ''}" data-program-source="${esc(source.sourceId)}"><strong>${esc(source.label)}</strong><small>${esc(source.type)} · ${previewSourceIds.has(source.sourceId) ? 'in preview' : 'library'} · ${source.enabled === false ? 'off' : 'on'}</small></button>`).join('') : '<p class="studio-program-empty">No sources. Add one to the selected scene.</p>'}
            </div>
          </section>
        </aside>
        <main class="studio-program-center">
          <div class="studio-program-canvas-grid">
            <section>
              <header><strong>Preview</strong><span>${esc(previewScene?.name || 'No scene selected')}</span></header>
              <div class="studio-program-preview-shell">
                <canvas class="studio-program-preview" width="1280" height="720" data-program-preview-canvas></canvas>
              </div>
            </section>
            <section>
              <header><strong>Program</strong><span>${esc(programScene?.name || 'No scene on air')}</span></header>
              <div class="studio-program-preview-shell is-program">
                <canvas class="studio-program-preview" width="1280" height="720" data-program-program-canvas></canvas>
              </div>
            </section>
          </div>
          <div class="studio-program-toolbar">
            <button type="button" data-program-take ${previewScene ? '' : 'disabled'}>Take</button>
            <button type="button" data-program-cut ${previewScene ? '' : 'disabled'}>Cut</button>
            <button type="button" data-program-fade ${previewScene ? '' : 'disabled'}>Fade</button>
            <label>Fade ms<input type="number" min="0" max="5000" step="50" value="${Number(mixer.transitionDurationMs || 400)}" data-program-transition-duration /></label>
          </div>
          <div class="studio-program-output-note">
            <strong>Stream Output Status</strong>
            <span>${esc(live.videoEnabled ? 'Canvas video output can be captured for provider publishing.' : 'Video master is off. No program video track will be published.')}</span>
          </div>
        </main>
        <aside class="studio-program-inspector">
          <section>
            <h2>Inspector</h2>
            ${selectedSource ? `
              <strong>${esc(selectedSource.label)}</strong>
              <small>${esc(selectedSource.type)}</small>
              <label class="studio-live-check"><input type="checkbox" data-program-source-toggle="enabled" ${selectedSource.enabled === false ? '' : 'checked'} /> Enabled</label>
              <label class="studio-live-check"><input type="checkbox" data-program-source-toggle="visible" ${selectedSource.visible === false ? '' : 'checked'} /> Visible</label>
              <label class="studio-live-check"><input type="checkbox" data-program-source-toggle="muted" ${selectedSource.muted === true ? 'checked' : ''} /> Muted</label>
              <label class="studio-live-check"><input type="checkbox" data-program-source-toggle="locked" ${selectedSource.locked === true ? 'checked' : ''} /> Locked</label>
              <label>Opacity<input type="range" min="0" max="1" step="0.01" value="${Number(selectedSource.opacity ?? 1)}" data-program-source-range="opacity" aria-label="Selected source opacity" /></label>
              <div class="studio-program-mini-actions">
                <button type="button" data-program-source-action="forward">Bring Forward</button>
                <button type="button" data-program-source-action="backward">Send Backward</button>
                <button type="button" data-program-source-action="fit">Fit</button>
                <button type="button" data-program-source-action="fill">Fill</button>
                <button type="button" data-program-source-action="center">Center</button>
                <button type="button" data-program-source-action="reset">Reset</button>
              </div>
            ` : '<p class="studio-program-empty">No source selected.</p>'}
          </section>
        </aside>
      </div>
      <section class="studio-program-audio-mixer">
        <header><h2>Audio Mixer</h2><span>Program and monitor sends are separate.</span></header>
        ${audioSources.length ? audioSources.map((source) => `
          <article>
            <strong>${esc(source.label)}</strong>
            <label><span>Program</span><input type="checkbox" data-program-audio-route="${esc(source.sourceId)}" data-route="program" ${source.programEnabled === false ? '' : 'checked'} /></label>
            <label><span>Monitor</span><input type="checkbox" data-program-audio-route="${esc(source.sourceId)}" data-route="monitor" ${source.monitorEnabled === true ? 'checked' : ''} /></label>
            <label><span>Gain</span><input type="range" min="0" max="1.5" step="0.01" value="${Number(source.gain ?? 1)}" data-program-audio-gain="${esc(source.sourceId)}" aria-label="${esc(source.label)} gain" /></label>
            <meter min="0" max="1" value="${source.enabled === false || source.muted ? 0 : 0.35}"></meter>
          </article>
        `).join('') : '<p class="studio-program-empty">No audio sources in the mixer.</p>'}
        <article><strong>Master</strong><label><span>Gain</span><input type="range" min="0" max="1.25" step="0.01" value="${Number(live.mixer.masterGain || 1)}" data-live-mixer="masterGain" /></label><meter min="0" max="1" value="${live.audioEnabled ? 0.42 : 0}"></meter></article>
      </section>
      ${renderProgramSceneModal()}
      ${renderProgramSourceModal()}
    </section>
  `
}

function renderLiveStudio() {
  const live = liveState()
  const panel = currentLivePanel()
  if (panel !== 'sequence' && live.assetPreview.audio) stopLiveAssetPreview({ render: false })
  live.panel = panel
  const panelContent = panel === 'input'
    ? renderInputSourcePanel()
    : panel === 'program'
      ? renderProgramMixerPanel()
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
      <div data-studio-modal-root>${renderLiveAssetAddModal()}${renderLiveAssetEditorModal()}</div>
    </section>
  `
}

function liveMenuStyle(menu = {}, actionCount = 0) {
  const width = 240
  const viewportWidth = Math.max(320, Number(window.innerWidth || 1024))
  const viewportHeight = Math.max(320, Number(window.innerHeight || 720))
  const maxHeight = Math.min(360, viewportHeight - 32)
  const estimatedHeight = Math.min(maxHeight, 44 + actionCount * 33 + 16)
  const x = Math.max(8, Math.min(Number(menu.x || 0), viewportWidth - width - 8))
  let y = Math.max(8, Number(menu.y || 0))
  if (y + estimatedHeight > viewportHeight - 8) y = Math.max(8, viewportHeight - estimatedHeight - 8)
  return `left:${Math.round(x)}px;top:${Math.round(y)}px;max-height:${Math.round(maxHeight)}px`
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
          ['restart', 'Restart'],
          ['cueBeginning', 'Cue from Beginning'],
          ['current', 'Set as Current'],
          ['next', 'Set as Next'],
          ['removeDeck', 'Remove from Deck'],
          ['monitor', 'Preview / Monitor This Item'],
          ['copy', 'Copy Metadata'],
          ['reveal', 'Reveal in Sequence'],
          ['revealAsset', 'Reveal Asset'],
          ['edit', 'Edit Item']
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
    <div class="studio-live-context-menu" style="${liveMenuStyle(menu, actions.length)}" data-live-context-menu>
      <strong>${esc(target?.title || target?.titleSnapshot || (isAsset ? 'Media asset' : 'Sequence item'))}</strong>
      ${actions.map(([action, label]) => `<button type="button" data-live-context-action="${esc(action)}" data-item-id="${esc(menu.itemId)}">${esc(label)}</button>`).join('')}
    </div>
  `
}

function renderLiveGenericMenu(menu = {}) {
  const actions = menu.actions || []
  return `
    <div class="studio-live-context-menu" style="${liveMenuStyle(menu, actions.length)}" data-live-context-menu>
      <strong>${esc(menu.title || 'Live Studio')}</strong>
      ${actions.map((action) => `<button type="button" data-live-context-action="${esc(action.action)}" data-item-id="${esc(action.itemId || '')}">${esc(action.label)}</button>`).join('')}
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
  const station = snapshot.stream || liveState().stream || liveState().streamForm || {}
  const progress = snapshot.progress || { percent: 0, current: 0, duration: Number(item?.durationMs || 0) / 1000 }
  const title = item?.titleSnapshot || item?.title || station.title || 'Live Studio Broadcast'
  const artist = item?.artistSnapshot || item?.artist || station.hostDisplayName || 'Melogic Music Live'
  const album = item?.albumSnapshot || item?.album || station.category || ''
  const streamer = station.hostDisplayName || state.user?.displayName || 'Streamer Display Name'
  const metaLine = album ? `${artist} - ${album}` : artist
  const artwork = renderStudioStableImage({ src: item?.artworkURLSnapshot || item?.artworkURL || station.coverArtURL || '', fallback: 'Audio', key: `live-monitor-${item?.itemId || item?.assetId || station.streamId || 'audio'}` })
  if (isVideo) {
    return `
      <section class="studio-live-monitor-surface is-audio-video" data-studio-monitor-root>
        <canvas class="studio-live-monitor-canvas" data-studio-monitor-canvas aria-hidden="true"></canvas>
        <div class="studio-live-monitor-brand">MELOGIC STREAMING</div>
        <div class="studio-live-monitor-video-layout">
          <div class="studio-live-monitor-video-frame">
            <video autoplay playsinline muted src="${esc(item.videoURLSnapshot || item.videoURL)}"></video>
          </div>
          <aside class="studio-live-monitor-side">
            <div class="studio-live-monitor-art artwork-square">${artwork}</div>
            <div class="studio-live-monitor-copy">
              <h2>${esc(title)}</h2>
              <p>${esc(metaLine)}</p>
              <small>${esc(streamer)}</small>
            </div>
          </aside>
        </div>
      </section>
    `
  }
  return `
    <section class="studio-live-monitor-surface is-audio-only" data-studio-monitor-root>
      <canvas class="studio-live-monitor-canvas" data-studio-monitor-canvas aria-hidden="true"></canvas>
      <div class="studio-live-monitor-brand">MELOGIC STREAMING</div>
      <main class="studio-live-monitor-core">
        <div class="studio-live-monitor-art artwork-square">${artwork}</div>
        <div class="studio-live-monitor-copy">
          <h2>${esc(title)}</h2>
          <p>${esc(metaLine)}</p>
          <small>${esc(streamer)}</small>
        </div>
        <div class="studio-live-monitor-progress" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%"></span></div>
        <small>${esc(formatMs(Number(progress.current || 0) * 1000))} / ${esc(formatMs(Number(progress.duration || 0) * 1000))}</small>
      </main>
    </section>
  `
}

function startStudioLiveMonitorVisualizer() {
  if (studioMonitorVisualizerCleanup) studioMonitorVisualizerCleanup()
  const canvas = app.querySelector('[data-studio-monitor-canvas]')
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  let frame = 0
  let animationId = 0
  const resize = () => {
    const scale = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.max(1, Math.floor(canvas.clientWidth * scale))
    canvas.height = Math.max(1, Math.floor(canvas.clientHeight * scale))
    context.setTransform(scale, 0, 0, scale, 0, 0)
  }
  const draw = () => {
    frame += 1
    const width = canvas.clientWidth || window.innerWidth
    const height = canvas.clientHeight || window.innerHeight
    if (canvas.width !== Math.floor(width * Math.min(2, window.devicePixelRatio || 1))) resize()
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    const pulse = 0.5 + Math.sin(frame * 0.028) * 0.5
    ;[
      ['rgba(103,242,170,', 0.18 + pulse * 0.16, 0.5, 0.42, 0.24],
      ['rgba(139,230,255,', 0.12 + pulse * 0.12, 0.74, 0.25, 0.16],
      ['rgba(205,60,203,', 0.1 + pulse * 0.14, 0.28, 0.72, 0.2]
    ].forEach(([color, alpha, xBase, yBase, radiusBase], index) => {
      const x = width * (xBase + Math.sin(frame * (0.007 + index * 0.002) + index) * 0.09)
      const y = height * (yBase + Math.cos(frame * (0.006 + index * 0.002) + index * 2) * 0.12)
      const radius = Math.max(width, height) * (radiusBase + pulse * 0.1)
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius)
      gradient.addColorStop(0, `${color}${alpha})`)
      gradient.addColorStop(1, `${color}0)`)
      context.fillStyle = gradient
      context.fillRect(0, 0, width, height)
    })
    animationId = window.requestAnimationFrame(draw)
  }
  resize()
  window.addEventListener('resize', resize)
  draw()
  studioMonitorVisualizerCleanup = () => {
    window.cancelAnimationFrame(animationId)
    window.removeEventListener('resize', resize)
    studioMonitorVisualizerCleanup = null
  }
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
    app.innerHTML = `<main class="studio-live-monitor-page">${renderLiveMonitorPage()}</main>`
    hydrateStudioStableImages(app)
    startStudioLiveMonitorVisualizer()
    bind()
    return
  }
  if (studioMonitorVisualizerCleanup) studioMonitorVisualizerCleanup()
  if (active !== 'live' && studioProgramMixer) {
    studioProgramMixer.destroy()
    studioProgramMixer = null
  }
  const content = active === 'hub' ? renderHub() : active === 'stagemaker' ? renderStagemaker() : active === 'live' ? renderLiveStudio() : renderDaw()
  app.innerHTML = active === 'live'
    ? `${navShell({ currentPage: 'studio' })}<main class="studio-page studio-live-page"><section class="studio-live-shell">${renderLiveRail(currentLivePanel())}<section class="studio-live-content">${content}${renderLiveStatusBar()}</section></section></main>`
    : `${navShell({ currentPage: 'studio' })}<main class="studio-page"><section class="studio-shell">${studioSidebar({ active })}${content}</section></main>`
  initShellChrome()
  if (active !== 'live') initStudioBrandLogo()
  hydrateStudioStableImages(app)
  if (active === 'live') {
    attachLiveVideoPreview()
    attachProgramMixerPreview()
  }
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

function hydrateLiveStudioFromStream(stream = null) {
  if (!stream) return
  const live = liveState()
  const isActive = ['starting', 'live'].includes(stream.status)
  const streamId = stream.streamId || stream.id || ''
  const localHostSessionId = getNativeHostSessionMarker(streamId)
  const sameRuntimeNativeSession = Boolean(localHostSessionId && (!stream.hostSessionId || localHostSessionId === stream.hostSessionId))
  const interruptedNative = firebaseSegmentStreamingEnabled() && isActive && isFirebaseSegmentProvider(stream.provider) && !live.streamId && !live.nativeRecorderRunning && !sameRuntimeNativeSession
  live.stream = stream
  live.streamId = isActive && !interruptedNative ? streamId : ''
  live.nativeInterruptedStreamId = interruptedNative ? streamId : ''
  live.nativeHostSessionId = sameRuntimeNativeSession ? localHostSessionId : stream.hostSessionId || live.nativeHostSessionId || ''
  live.draftStreamId = streamId || live.draftStreamId || ''
  live.inputSource = stream.selectedInputSource === 'sequence' ? 'sequence' : 'browser'
  const restoredProviderId = normalizeProviderId(stream.provider)
  live.providerId = restoredProviderId
  live.ingestMethod = normalizeIngestMethod(stream.ingestMethod || stream.ingestMode, stream.provider)
  live.nativeStreamingStatus = stream.nativeStreaming?.status || live.nativeStreamingStatus || 'idleNoListeners'
  live.audioEnabled = stream.audioEnabled !== false
  live.videoEnabled = stream.videoEnabled === true
  live.audioPublishedToProvider = stream.audioPublished === true
  live.videoPublishedToProvider = stream.videoPublished === true
  live.browserInputEnabled = stream.activeAudioSources?.browser !== false
  live.sequenceInputEnabled = stream.activeAudioSources?.sequence === true || live.inputSource === 'sequence'
  live.videoSource = stream.activeVideoSource === 'sequence' ? 'sequence' : 'browser'
  live.programMixer.previewSceneId = stream.programState?.previewSceneId || live.programMixer.previewSceneId
  live.programMixer.programSceneId = stream.programState?.programSceneId || stream.programState?.activeSceneId || live.programMixer.programSceneId
  live.programMixer.activeSceneId = live.programMixer.programSceneId || live.programMixer.activeSceneId
  live.programMixer.selectedSourceId = stream.programState?.selectedSourceId || live.programMixer.selectedSourceId
  live.programMixer.mode = stream.programState?.mode || live.programMixer.mode
  live.providerDiagnostics = stream.providerDiagnostics || live.providerDiagnostics
  live.streamForm = {
    ...live.streamForm,
    title: stream.title || live.streamForm.title,
    description: stream.description || '',
    category: stream.category || live.streamForm.category,
    tags: Array.isArray(stream.tags) ? stream.tags.join(', ') : live.streamForm.tags,
    visibility: stream.visibility || live.streamForm.visibility,
    accessMode: stream.accessMode || live.streamForm.accessMode,
    password: live.streamForm.password || '',
    coverArtURL: stream.coverArtURL || '',
    coverArtPath: stream.coverArtPath || '',
    coverArtSource: stream.coverArtSource || (stream.coverArtURL ? 'url' : 'fallback'),
    audioMode: stream.audioMode === 'voice' ? 'voice' : 'music',
    streamKey: sanitizeHlsStreamKey(stream.streamKey || live.streamForm.streamKey || 'mystream')
  }
  if (stream.selectedSequenceId) {
    const sequence = live.sequences.find((entry) => entry.sequenceId === stream.selectedSequenceId)
    if (sequence) live.activeSequence = sequence
  }
  live.outputStatus = interruptedNative
    ? 'This Firebase Segments session was interrupted because the browser host session ended. Resume or end it.'
    : isActive
    ? `Restored ${stream.status} Live Studio stream.`
    : 'Restored Live Studio draft details.'
}

async function restoreLiveStudioRuntimeState() {
  const live = liveState()
  if (!state.user?.uid || live.streamId || live.draftStreamId) return
  const streams = await listHostMusicLiveStreams(state.user.uid, { limitCount: 20 })
  const active = streams.find((stream) => ['live', 'starting'].includes(stream.status) && stream.hostUid === state.user.uid)
  const draft = streams.find((stream) => ['draft', 'setup', 'error'].includes(stream.status) && stream.hostUid === state.user.uid)
  const stream = active || draft || null
  if (!stream) return
  hydrateLiveStudioFromStream(stream)
  if (active && isFirebaseSegmentProvider(active.provider) && firebaseSegmentStreamingEnabled()) {
    const hostPresence = await getNativeHostPresence(active.streamId).catch(() => null)
    const freshHostPresence = Boolean(hostPresence?.lastSeenAt && Date.now() - Number(hostPresence.lastSeenAt || 0) < 30000 && hostPresence.state === 'online')
    live.providerDiagnostics = {
      ...(live.providerDiagnostics || {}),
      hostHeartbeatFresh: freshHostPresence,
      hostPresenceSessionId: hostPresence?.hostSessionId || '',
      hostPresenceLastSeenAt: hostPresence?.lastSeenAt || null
    }
    if (!getNativeHostSessionMarker(active.streamId)) {
      live.streamId = ''
      live.nativeInterruptedStreamId = active.streamId
      live.outputStatus = 'This Native Streaming session was interrupted because the browser host session ended. Resume or end it.'
    }
  }
  if (active) {
    subscribeLiveStudioStream(active.streamId)
    subscribeLiveStudioChat(active.streamId)
  }
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
    await restoreLiveStudioRuntimeState()
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
    stopLiveAssetPreview({ render: false })
    state.daw = { projects: [], recentProjects: [], loading: false, error: '' }
    state.stage = { projects: [], recentProjects: [], loading: false, error: '' }
    state.live = {
      ...state.live,
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
      streamId: '',
      draftStreamId: '',
      stream: null,
      assetEditor: { assetId: '', saving: false, error: '', dirty: false },
      assetAdd: { open: false, uploading: false, mode: 'audio', status: '', error: '' }
    }
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
  const micGain = context.createGain()
  const sequenceGain = context.createGain()
  const sequenceMonitorGain = context.createGain()
  const monitorGain = context.createGain()
  const analyser = context.createAnalyser()
  const destination = context.createMediaStreamDestination()
  analyser.fftSize = 1024
  analyser.smoothingTimeConstant = 0.65
  masterGain.gain.value = live.audioEnabled ? Number(live.mixer.masterGain ?? 1) : 0
  micGain.gain.value = live.browserInputEnabled && !live.mixer.browserMuted ? Number(live.mixer.browserGain ?? 1) : 0
  sequenceGain.gain.value = 0
  sequenceMonitorGain.gain.value = 0
  monitorGain.gain.value = Number(live.monitorVolume || 0.85)
  micGain.connect(masterGain)
  sequenceGain.connect(masterGain)
  sequenceMonitorGain.connect(monitorGain)
  masterGain.connect(monitorGain)
  masterGain.connect(analyser)
  masterGain.connect(destination)
  live.audioContext = context
  live.masterGain = masterGain
  live.micGain = micGain
  live.sequenceGain = sequenceGain
  live.sequenceMonitorGain = sequenceMonitorGain
  live.monitorGain = monitorGain
  live.destination = destination
  live.broadcastDestination = destination
  live.broadcastStream = destination.stream
  live.outputTrack = destination.stream.getAudioTracks()[0] || null
  live.broadcastTrack = live.outputTrack
  live.programAudioTrack = live.outputTrack
  live.programAnalyser = analyser
  live.programAnalyserData = new Float32Array(analyser.fftSize)
  syncLiveMonitorRoute()
  return live
}

function updateLiveProgramAudioDiagnostics(extra = {}) {
  const live = liveState()
  const graph = live.audioContext ? live : ensureLiveAudioGraph()
  let rms = 0
  let peak = 0
  if (graph.programAnalyser && graph.programAnalyserData) {
    graph.programAnalyser.getFloatTimeDomainData(graph.programAnalyserData)
    let sum = 0
    for (const sample of graph.programAnalyserData) {
      sum += sample * sample
      peak = Math.max(peak, Math.abs(sample))
    }
    rms = Math.sqrt(sum / graph.programAnalyserData.length)
  }
  live.programRms = rms
  live.programPeak = peak
  const broadcastTrack = graph.broadcastTrack || graph.outputTrack || null
  live.providerDiagnostics = {
    ...(live.providerDiagnostics || {}),
    provider: live.providerId,
    audioContextState: graph.audioContext?.state || '',
    broadcastTrackExists: Boolean(broadcastTrack),
    broadcastTrackReadyState: broadcastTrack?.readyState || '',
    broadcastTrackEnabled: broadcastTrack?.enabled === true,
    broadcastAudioTrackCount: graph.broadcastStream?.getAudioTracks?.().length || 0,
    analyserRms: Number(rms.toFixed(5)),
    analyserPeak: Number(peak.toFixed(5)),
    monitorEnabled: live.monitorEnabled === true,
    selectedInputSource: live.inputSource,
    sequencePlaying: live.activePlayers.length > 0,
    micConnected: Boolean(live.sourceTrack && (live.sourceTrack.mediaStreamTrack || live.sourceTrack)?.readyState !== 'ended'),
    livekitPublishedTrackSid: live.livekitAudioPublication?.trackSid || live.livekitAudioPublication?.sid || '',
    livekitPublishedTrackName: live.livekitAudioPublication?.trackName || live.livekitAudioPublication?.track?.name || 'melogic-program-audio',
    audioPublishedToProvider: live.audioPublishedToProvider === true,
    ...(extra || {})
  }
  return live.providerDiagnostics
}

function ensureLiveProgramAudioGraph() {
  const live = ensureLiveAudioGraph()
  if (!live.programAnalyser && live.audioContext && live.masterGain) {
    const analyser = live.audioContext.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.65
    try { live.masterGain.connect(analyser) } catch {}
    live.programAnalyser = analyser
    live.programAnalyserData = new Float32Array(analyser.fftSize)
  }
  live.broadcastDestination = live.broadcastDestination || live.destination
  live.broadcastStream = live.broadcastStream || live.destination?.stream
  live.broadcastTrack = live.broadcastTrack || live.outputTrack || live.broadcastStream?.getAudioTracks?.()[0] || null
  live.programAudioTrack = live.programAudioTrack || live.broadcastTrack
  syncLiveMonitorRoute()
  updateLiveProgramAudioDiagnostics()
  return {
    audioContext: live.audioContext,
    masterGain: live.masterGain,
    monitorGain: live.monitorGain,
    broadcastDestination: live.broadcastDestination || live.destination,
    broadcastStream: live.broadcastStream || live.destination?.stream,
    broadcastTrack: live.broadcastTrack || live.outputTrack || live.destination?.stream?.getAudioTracks?.()[0] || null,
    analyser: live.programAnalyser
  }
}

function syncLiveMonitorRoute() {
  const live = liveState()
  if (!live.audioContext || !live.monitorGain) return
  const sequenceProgramRouted = Boolean((live.sequenceInputEnabled || live.inputSource === 'sequence') && !live.mixer.sequenceMuted)
  const sequenceGainValue = Number(live.mixer.sequenceGain ?? 1)
  if (live.masterGain) live.masterGain.gain.value = live.audioEnabled ? Number(live.mixer.masterGain ?? 1) : 0
  if (live.micGain) live.micGain.gain.value = live.browserInputEnabled && !live.mixer.browserMuted ? Number(live.mixer.browserGain ?? 1) : 0
  if (live.sequenceGain) live.sequenceGain.gain.value = sequenceProgramRouted ? sequenceGainValue : 0
  if (live.sequenceMonitorGain) live.sequenceMonitorGain.gain.value = !sequenceProgramRouted && !live.mixer.sequenceMuted ? sequenceGainValue : 0
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

function syncLiveMicProgramRoute() {
  const live = liveState()
  const graph = ensureLiveAudioGraph()
  try { live.micProgramSource?.disconnect?.() } catch {}
  live.micProgramSource = null
  const rawTrack = live.sourceTrack?.mediaStreamTrack || live.sourceTrack
  if (!rawTrack || !graph.micGain) return
  try {
    live.micProgramSource = graph.audioContext.createMediaStreamSource(new MediaStream([rawTrack]))
    live.micProgramSource.connect(graph.micGain)
  } catch (error) {
    console.warn('[studio-live] mic program route failed', error)
  }
  syncLiveMonitorRoute()
}

function stopLiveMicMeter() {
  const live = liveState()
  if (live.micMeterTimer) window.clearInterval(live.micMeterTimer)
  live.micMeterTimer = 0
  try { live.micMeterSource?.disconnect?.() } catch {}
  try { live.micMeterAnalyser?.disconnect?.() } catch {}
  try { live.micMeterContext?.close?.() } catch {}
  try { live.micProgramSource?.disconnect?.() } catch {}
  live.micMeterSource = null
  live.micMeterAnalyser = null
  live.micMeterContext = null
  live.micProgramSource = null
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
    live.videoDevices = devices.filter((device) => device.kind === 'videoinput')
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
    live.browserInputEnabled = true
    live.sourceMessage = 'Browser input source is ready.'
    startLiveMicMeter()
    syncLiveMicProgramRoute()
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
  const graph = ensureLiveProgramAudioGraph()
  if (graph.audioContext?.state === 'suspended') await graph.audioContext.resume()
  const sequenceProgramActive = Boolean((live.sequenceInputEnabled || live.inputSource === 'sequence') && live.activePlayers.length)
  if (live.browserInputEnabled && !live.sourceTrack && !sequenceProgramActive) await prepareLiveMicSource()
  if (live.browserInputEnabled) syncLiveMicProgramRoute()
  syncLiveMonitorRoute()
  const broadcastTrack = graph.broadcastStream?.getAudioTracks?.()[0] || graph.broadcastTrack || live.outputTrack
  live.broadcastTrack = broadcastTrack
  live.programAudioTrack = broadcastTrack
  updateLiveProgramAudioDiagnostics()
  if (!broadcastTrack || broadcastTrack.readyState !== 'live') throw new Error('Live program audio track is not available.')
  return broadcastTrack
}

function nativeHasRecordableAudioSource() {
  const live = liveState()
  const rawTrack = live.sourceTrack?.mediaStreamTrack || live.sourceTrack
  const browserReady = Boolean(live.browserInputEnabled && rawTrack && rawTrack.readyState !== 'ended')
  const sequenceReady = Boolean((live.sequenceInputEnabled || live.inputSource === 'sequence') && live.activePlayers.length && !live.mixer.sequenceMuted)
  return browserReady || sequenceReady
}

async function nativeProgramMediaStream() {
  const live = liveState()
  const stream = new MediaStream()
  if (live.audioEnabled) {
    const audioTrack = await getLivePublishTrack()
    if (audioTrack) stream.addTrack(audioTrack)
  }
  if (live.videoEnabled) {
    const mixer = ensureStudioProgramMixer()
    mixer.attachCanvas(app.querySelector('[data-program-program-canvas]') || app.querySelector('[data-program-preview-canvas]'))
    mixer.enableVideo()
    const videoTrack = mixer.getVideoTrack()
    if (videoTrack) {
      live.programVideoTrack = videoTrack
      stream.addTrack(videoTrack)
    }
  }
  return stream
}

function updateNativeProviderDiagnostics(next = {}) {
  const live = liveState()
  live.providerDiagnostics = {
    ...(live.providerDiagnostics || {}),
    ...(next || {})
  }
  if (currentStudioSection() === 'live') renderShell()
}

function nativeBroadcastStateForStatus(status = liveState().nativeStreamingStatus || 'idleNoListeners') {
  if (status === 'broadcasting') return 'liveBroadcasting'
  if (status === 'warmingBuffer') return 'liveWarmingBuffer'
  return 'liveIdleNoListeners'
}

async function startNativeSegmentRecorderIfNeeded() {
  const live = liveState()
  if (live.nativeRecorderRunning || !live.streamId || !isFirebaseSegmentProvider(live.providerId)) return
  const provider = getStreamingProvider(STREAM_PROVIDERS.firebaseSegments)
  const programStream = await nativeProgramMediaStream()
  const audioTracks = programStream.getAudioTracks?.() || []
  const liveAudioTrack = audioTracks.find((track) => track.readyState === 'live') || null
  if (!liveAudioTrack || !nativeHasRecordableAudioSource()) {
    const message = 'Native Streaming has no audio track to record. Enable a mic or sequence output.'
    live.nativeStreamingStatus = 'error'
    live.nativeRecorderRunning = false
    live.outputStatus = message
    updateNativeProviderDiagnostics({
      recorderState: 'idle',
      mediaStreamTrackCount: programStream.getTracks?.().length || 0,
      trackCount: programStream.getTracks?.().filter((track) => track.readyState === 'live').length || 0,
      audioTrackReadyState: '',
      lastUploadError: message,
      lastMediaEvent: 'no-native-audio-track'
    })
    return
  }
  live.nativeRecorderStartReason = live.nativePlaybackDemandCount > 0 ? 'playback-demand' : 'manual-start'
  live.providerDiagnostics = {
    ...(live.providerDiagnostics || {}),
    trackCount: programStream.getTracks?.().filter((track) => track.readyState === 'live').length || 0,
    mediaStreamTrackCount: programStream.getTracks?.().length || 0,
    audioTrackReadyState: liveAudioTrack.readyState || '',
    segmentDurationMs: 4000,
    recorderStartReason: live.nativeRecorderStartReason
  }
  const result = provider.startSegmentRecorder?.(programStream, {
    streamId: live.streamId,
    segmentDurationMs: 4000,
    rollingRetentionMs: 300000,
    shouldUploadSegment: () => liveState().nativePlaybackDemandCount > 0,
    isStreamActive: () => Boolean(liveState().streamId === live.streamId && !liveState().ending),
    onDiagnostics: updateNativeProviderDiagnostics
  }) || { ok: false }
  live.providerDiagnostics = {
    ...(live.providerDiagnostics || {}),
    ...(result.diagnostics || provider.getDiagnostics?.() || {}),
    trackCount: programStream.getTracks?.().filter((track) => track.readyState === 'live').length || 0,
    mediaStreamTrackCount: programStream.getTracks?.().length || 0,
    audioTrackReadyState: liveAudioTrack.readyState || '',
    segmentDurationMs: 4000,
    recorderStartReason: live.nativeRecorderStartReason
  }
  if (result.ok) {
    live.nativeRecorderRunning = true
    live.nativeStreamingStatus = 'warmingBuffer'
    live.outputStatus = 'Native Streaming buffer is warming for active listeners.'
    heartbeatLiveProgramState({ broadcastState: 'liveWarmingBuffer', connectionStatus: 'live' }).catch(() => {})
  } else {
    live.nativeStreamingStatus = 'error'
    live.nativeRecorderRunning = false
    live.outputStatus = result.error || 'Native Streaming recorder could not start.'
  }
}

function stopNativeSegmentRecorder({ status = 'pausedNoListeners' } = {}) {
  const live = liveState()
  const provider = getStreamingProvider(STREAM_PROVIDERS.firebaseSegments)
  const result = provider.stopSegmentRecorder?.() || { ok: true }
  live.providerDiagnostics = result.diagnostics || provider.getDiagnostics?.() || live.providerDiagnostics
  live.nativeRecorderRunning = false
  live.nativeStreamingStatus = status
  live.nativeRecorderStopReason = status
  live.outputStatus = status === 'idleNoListeners'
    ? 'Native Streaming is idle until a listener clicks Listen.'
    : 'Native Streaming paused because no listeners are requesting playback.'
  heartbeatLiveProgramState({ broadcastState: nativeBroadcastStateForStatus(status), connectionStatus: 'live' }).catch(() => {})
}

function observeNativePlaybackDemand(streamId = '') {
  const live = liveState()
  live.nativeDemandUnsubscribe?.()
  const provider = getStreamingProvider(STREAM_PROVIDERS.firebaseSegments)
  live.nativeDemandUnsubscribe = provider.observePlaybackDemand?.(streamId, ({ count = 0, path = '', error = '' } = {}) => {
    live.nativePlaybackDemandCount = count
    live.nativeLastDemandChangeAt = new Date().toLocaleTimeString()
    if (live.stream) live.stream = { ...live.stream, listenerCount: count }
    live.providerDiagnostics = {
      ...(live.providerDiagnostics || {}),
      demandCount: count,
      demandPath: path || `livePresence/${streamId}/playbackDemand`,
      lastDemandChangeAt: live.nativeLastDemandChangeAt,
      ...(error ? { lastDemandError: error } : {})
    }
    if (error) console.warn('[studio-live] Native playback demand observer failed', { streamId, path: live.providerDiagnostics.demandPath, error })
    if (count > 0) {
      if (live.nativeNoDemandTimer) window.clearTimeout(live.nativeNoDemandTimer)
      live.nativeNoDemandTimer = 0
      live.nativeStreamingStatus = live.nativeRecorderRunning ? 'broadcasting' : 'warmingBuffer'
      startNativeSegmentRecorderIfNeeded().catch((error) => {
        live.nativeStreamingStatus = 'error'
        live.outputStatus = error?.message || 'Native Streaming recorder failed.'
        renderShell()
      })
    } else if (live.nativeRecorderRunning && !live.nativeNoDemandTimer) {
      live.nativeNoDemandTimer = window.setTimeout(() => {
        live.nativeNoDemandTimer = 0
        stopNativeSegmentRecorder({ status: 'pausedNoListeners' })
        renderShell()
      }, 60000)
    } else if (!live.nativeRecorderRunning) {
      live.nativeStreamingStatus = 'idleNoListeners'
    }
    writeNativeHostPresence({
      streamId,
      uid: state.user?.uid || '',
      state: 'online',
      broadcasting: live.nativeRecorderRunning,
      hostSessionId: live.nativeHostSessionId
    }).catch(() => {})
    if (currentStudioSection() === 'live') renderShell()
  }) || null
}

function setNativeHostSessionMarker(streamId = '', hostSessionId = '') {
  if (!streamId || !hostSessionId) return
  activeNativeHostSessions.set(streamId, hostSessionId)
}

function getNativeHostSessionMarker(streamId = '') {
  if (!streamId) return ''
  return activeNativeHostSessions.get(streamId) || ''
}

function clearNativeHostSessionMarker(streamId = '') {
  if (!streamId) return
  activeNativeHostSessions.delete(streamId)
}

async function activateNativeLiveSession(streamId = '') {
  const live = liveState()
  if (!streamId) throw new Error('A stream id is required to activate Native Streaming.')
  const hostSessionId = nativeHostSessionId(streamId)
  live.streamId = streamId
  live.draftStreamId = streamId
  live.nativeInterruptedStreamId = ''
  live.nativeHostSessionId = hostSessionId
  live.nativeStopWarning = ''
  live.localTrack = null
  live.audioPublishedToProvider = false
  live.videoPublishedToProvider = false
  live.nativeStreamingStatus = live.nativePlaybackDemandCount > 0 ? 'warmingBuffer' : 'idleNoListeners'
  setNativeHostSessionMarker(streamId, hostSessionId)
  subscribeLiveStudioStream(streamId)
  subscribeLiveStudioChat(streamId)
  observeNativePlaybackDemand(streamId)
  await writeNativeHostPresence({ streamId, uid: state.user.uid, state: 'online', broadcasting: false, hostSessionId }).catch((error) => {
    console.warn('[studio-live] Native host presence write failed after stream was marked live.', {
      streamId,
      hostSessionId,
      message: error?.message || String(error)
    })
    live.nativeStopWarning = 'Live stream started, but realtime host presence could not be written.'
  })
  if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
  const beat = () => {
    if (!live.streamId) return
    heartbeatMusicLiveStream(live.streamId, {
      ...liveProgramOutputState(),
      broadcastState: live.nativeRecorderRunning ? 'liveBroadcasting' : live.nativePlaybackDemandCount > 0 ? 'liveWarmingBuffer' : 'liveIdleNoListeners',
      connectionStatus: 'live'
    }).catch(() => {})
    writeNativeHostPresence({ streamId: live.streamId, uid: state.user.uid, state: 'online', broadcasting: live.nativeRecorderRunning, hostSessionId: live.nativeHostSessionId }).catch((error) => {
      console.warn('[studio-live] Native host heartbeat presence write failed.', {
        streamId: live.streamId,
        hostSessionId: live.nativeHostSessionId,
        message: error?.message || String(error)
      })
    })
  }
  beat()
  live.heartbeatTimer = window.setInterval(beat, 15000)
}

function publishOptionsForLiveSource() {
  const live = liveState()
  const source = Track?.Source?.Microphone || 'microphone'
  if (live.streamForm.audioMode === 'voice') {
    return { audioPreset: AudioPresets.speech, dtx: true, red: true, forceStereo: false, source }
  }
  return { audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true, forceStereo: true, source }
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

function updateLiveDeckProgressDom() {
  if (currentStudioSection() !== 'live') return
  liveState().activePlayers.forEach((player) => {
    const item = liveItemById(player.itemId) || {}
    const progress = livePlayerProgress(player, item)
    app.querySelectorAll(`[data-live-deck-progress="${CSS.escape(player.itemId)}"]`).forEach((el) => {
      const percent = `${progress.percent}%`
      el.querySelector('[data-live-progress-fill]')?.style?.setProperty('width', percent)
      el.querySelector('[data-live-progress-knob]')?.style?.setProperty('left', percent)
      const input = el.querySelector('input')
      if (input && document.activeElement !== input) input.value = String(progress.value)
    })
    app.querySelectorAll(`[data-live-deck-time="${CSS.escape(player.itemId)}"]`).forEach((el) => {
      el.textContent = `${formatMs(progress.current * 1000)} / ${formatMs(progress.duration * 1000)}`
    })
  })
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
    if (currentStudioSection() === 'live' && (currentLivePanel() === 'sequence' || currentLivePanel() === 'preview')) {
      updateLiveDeckProgressDom()
      if (live.monitorEnabled) writeLiveMonitorSnapshot()
    }
  }, 500)
}

async function pauseLiveStudioPlayer(itemId = '') {
  const live = liveState()
  const player = live.activePlayers.find((entry) => entry.playerId === itemId || entry.itemId === itemId)
  if (!player || player.paused) return
  try { player.audio.pause() } catch {}
  player.paused = true
  live.outputStatus = `Paused ${liveItemById(player.itemId)?.titleSnapshot || 'deck'}.`
  renderShell()
}

async function resumeLiveStudioPlayer(itemId = '') {
  const live = liveState()
  const player = live.activePlayers.find((entry) => entry.playerId === itemId || entry.itemId === itemId)
  if (!player) return false
  if (!player.paused) return true
  try {
    await player.audio.play()
    player.paused = false
    live.currentItemId = player.itemId
    live.outputStatus = `Resumed ${liveItemById(player.itemId)?.titleSnapshot || 'deck'}.`
    ensureLivePlaybackTicker()
    autoMatchLiveMetadataFromSequence(liveItemById(player.itemId)).catch(() => {})
    renderShell()
    return true
  } catch (error) {
    console.warn('[studio-live] resume failed', error)
    live.outputStatus = 'Browser blocked resume. Press Play again.'
    renderShell()
    return false
  }
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
    await resumeLiveStudioPlayer(item.itemId)
    return
  }
  if (existing) {
    live.outputStatus = `${item.titleSnapshot || 'Selected item'} is already playing.`
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
  gain.connect(graph.sequenceGain || graph.masterGain)
  if (graph.sequenceMonitorGain) gain.connect(graph.sequenceMonitorGain)
  const playerId = `${item.itemId}-${Date.now()}`
  const player = { playerId, itemId: item.itemId, audio, source, gain, paused: false }
  live.activePlayers.push(player)
  live.currentItemId = item.itemId
  live.selectedItemId = item.itemId
  live.outputStatus = `Playing ${item.titleSnapshot || 'selected item'} through Live Studio output.`
  autoMatchLiveMetadataFromSequence(item).catch(() => {})
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

function openLiveAssetAddModal() {
  const live = liveState()
  live.assetAdd = { open: true, uploading: false, mode: 'audio', status: '', error: '' }
  renderShell()
}

function closeLiveAssetAddModal() {
  const live = liveState()
  if (live.assetAdd?.uploading) return
  live.assetAdd = { open: false, uploading: false, mode: 'audio', status: '', error: '' }
  renderShell()
}

function audioBufferToWav(buffer) {
  const channels = Math.min(2, Math.max(1, buffer.numberOfChannels || 1))
  const length = buffer.length * channels * 2
  const arrayBuffer = new ArrayBuffer(44 + length)
  const view = new DataView(arrayBuffer)
  const writeString = (offset, value) => {
    for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index))
  }
  writeString(0, 'RIFF')
  view.setUint32(4, 36 + length, true)
  writeString(8, 'WAVE')
  writeString(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, channels, true)
  view.setUint32(24, 44100, true)
  view.setUint32(28, 44100 * channels * 2, true)
  view.setUint16(32, channels * 2, true)
  view.setUint16(34, 16, true)
  writeString(36, 'data')
  view.setUint32(40, length, true)
  let offset = 44
  const channelData = Array.from({ length: channels }, (_, index) => buffer.getChannelData(Math.min(index, buffer.numberOfChannels - 1)))
  for (let sample = 0; sample < buffer.length; sample += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = Math.max(-1, Math.min(1, channelData[channel][sample] || 0))
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
      offset += 2
    }
  }
  return new Blob([arrayBuffer], { type: 'audio/wav' })
}

async function normalizeAudioFileToWav(file) {
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor || typeof window.OfflineAudioContext !== 'function') throw new Error('This browser cannot normalize audio files yet.')
  const arrayBuffer = await file.arrayBuffer()
  const context = new AudioContextCtor()
  let decoded
  try {
    decoded = await context.decodeAudioData(arrayBuffer.slice(0))
  } finally {
    context.close?.().catch(() => {})
  }
  const channels = Math.min(2, Math.max(1, decoded.numberOfChannels || 1))
  const length = Math.ceil(decoded.duration * 44100)
  const offline = new window.OfflineAudioContext(channels, length, 44100)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start(0)
  const rendered = await offline.startRendering()
  return {
    file: new File([audioBufferToWav(rendered)], `${(file.name || 'live-asset').replace(/\.[^.]+$/, '') || 'live-asset'}-44100-16bit.wav`, { type: 'audio/wav' }),
    durationMs: Math.round(rendered.duration * 1000),
    sampleRate: 44100,
    bitDepth: 16,
    channels
  }
}

async function addLiveAssetFromForm(formEl) {
  const live = liveState()
  if (!state.user?.uid || !formEl) return
  const data = new FormData(formEl)
  const mode = String(data.get('mode') || 'audio')
  const audioFile = data.get('audioFile') instanceof File && data.get('audioFile').size ? data.get('audioFile') : null
  const videoFile = data.get('videoFile') instanceof File && data.get('videoFile').size ? data.get('videoFile') : null
  const category = String(data.get('category') || 'other')
  const type = mode === 'video' || mode === 'audio_video' ? 'video' : mode === 'metadata_only' ? 'metadata_only' : 'audio'
  if (mode === 'audio' && !audioFile) live.assetAdd.error = 'Choose an audio file.'
  else if (mode === 'video' && !videoFile) live.assetAdd.error = 'Choose a video file.'
  else if (mode === 'audio_video' && (!audioFile || !videoFile)) live.assetAdd.error = 'Choose both audio and video files.'
  if (live.assetAdd.error) {
    renderShell()
    return
  }
  live.assetAdd = { ...live.assetAdd, uploading: true, mode, status: 'Creating asset...', error: '' }
  renderShell()
  let shell
  try {
    const title = String(data.get('title') || audioFile?.name || videoFile?.name || 'Untitled asset').replace(/\.[^.]+$/, '').trim()
    shell = await createSequenceAssetShell(state.user.uid, {
      type,
      title,
      artist: String(data.get('artist') || '').trim(),
      album: String(data.get('album') || '').trim(),
      category: SEQUENCE_ASSET_CATEGORIES.includes(category) ? category : 'other',
      notes: String(data.get('notes') || '').trim(),
      artworkURL: String(data.get('artworkURL') || '').trim(),
      originalFileName: audioFile?.name || videoFile?.name || '',
      originalMimeType: audioFile?.type || videoFile?.type || '',
      videoAudioMode: mode === 'audio_video' ? 'separate_audio' : mode === 'video' ? 'no_audio' : '',
      fileSizeBytes: Number(audioFile?.size || 0) + Number(videoFile?.size || 0),
      status: mode === 'metadata_only' ? 'ready' : 'processing'
    })
    let videoUpload = null
    if (videoFile) {
      live.assetAdd.status = 'Uploading video...'
      renderShell()
      videoUpload = await uploadSequenceAssetFile(state.user.uid, shell.assetId, videoFile, 'video')
    }
    if (audioFile) {
      live.assetAdd.status = 'Normalizing audio...'
      renderShell()
      const normalized = await normalizeAudioFileToWav(audioFile)
      live.assetAdd.status = 'Uploading normalized audio...'
      renderShell()
      const normalizedUpload = await uploadSequenceAssetFile(state.user.uid, shell.assetId, normalized.file, 'normalized')
      await updateSequenceAsset(state.user.uid, shell.assetId, {
        status: 'ready',
        normalizedAudioPath: normalizedUpload.path,
        normalizedAudioURL: normalizedUpload.url,
        videoPath: videoUpload?.path || '',
        videoURL: videoUpload?.url || '',
        durationMs: normalized.durationMs,
        sampleRate: normalized.sampleRate,
        bitDepth: normalized.bitDepth,
        channels: normalized.channels,
        processingError: ''
      })
    } else if (videoUpload) {
      await updateSequenceAsset(state.user.uid, shell.assetId, { status: 'ready', videoPath: videoUpload.path, videoURL: videoUpload.url, processingError: '' })
    }
    live.assetAdd = { open: false, uploading: false, mode: 'audio', status: '', error: '' }
    await loadLiveStudioData()
  } catch (error) {
    console.error('[studio-live] add asset failed', error)
    if (shell?.assetId) await updateSequenceAsset(state.user.uid, shell.assetId, { status: 'failed', processingError: error?.message || 'Asset upload failed.' }).catch(() => {})
    live.assetAdd = { ...live.assetAdd, uploading: false, status: '', error: error?.message || 'Could not add asset.' }
    renderShell()
  }
}

async function addLiveAsset(assetId = '') {
  const live = liveState()
  const asset = live.assets.find((entry) => entry.assetId === assetId)
  if (!state.user?.uid || !live.activeSequence || !asset) return
  await addAssetToSequence(state.user.uid, live.activeSequence.sequenceId, asset, live.activeSequence)
  await loadLiveStudioData()
  renderShell()
}

function openLiveAssetEditor(assetId = '') {
  const live = liveState()
  if (!liveAssetById(assetId)) {
    live.outputStatus = 'Choose a media asset to edit.'
    renderShell()
    return
  }
  live.assetEditor = { assetId, saving: false, error: '', dirty: false }
  renderShell()
}

function closeLiveAssetEditor({ force = false } = {}) {
  const live = liveState()
  if (!force && live.assetEditor?.dirty && !window.confirm('Discard unsaved asset metadata changes?')) return
  live.assetEditor = { assetId: '', saving: false, error: '', dirty: false }
  renderShell()
}

function secondsFieldToMs(value, maxSeconds = 60) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.round(Math.max(0, Math.min(maxSeconds, number)) * 1000)
}

function assetEditorPayload(formEl) {
  const data = new FormData(formEl)
  const category = String(data.get('category') || 'other')
  return {
    title: String(data.get('title') || 'Untitled asset').trim().slice(0, 160),
    artist: String(data.get('artist') || '').trim().slice(0, 160),
    album: String(data.get('album') || '').trim().slice(0, 160),
    category: SEQUENCE_ASSET_CATEGORIES.includes(category) ? category : 'other',
    tags: String(data.get('tags') || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
    artworkURL: String(data.get('artworkURL') || '').trim().slice(0, 1400),
    defaultFadeInMs: secondsFieldToMs(data.get('defaultFadeInSeconds')),
    defaultFadeOutMs: secondsFieldToMs(data.get('defaultFadeOutSeconds')),
    defaultCrossfadeMs: secondsFieldToMs(data.get('defaultCrossfadeSeconds')),
    gainDb: Math.max(-24, Math.min(24, Number(data.get('gainDb') || 0))),
    notes: String(data.get('notes') || '').trim().slice(0, 1000)
  }
}

async function saveLiveAssetEditor(formEl) {
  const live = liveState()
  const assetId = formEl?.dataset?.assetId || live.assetEditor?.assetId || ''
  const asset = liveAssetById(assetId)
  if (!state.user?.uid || !asset) return
  const payload = assetEditorPayload(formEl)
  live.assetEditor = { ...live.assetEditor, saving: true, error: '' }
  renderShell()
  try {
    await updateSequenceAsset(state.user.uid, assetId, payload)
    live.assets = live.assets.map((entry) => entry.assetId === assetId ? { ...entry, ...payload } : entry)
    const snapshotUpdates = live.activeSequence
      ? live.items
        .filter((item) => item.assetId === assetId)
        .map((item) => updateSequenceItem(state.user.uid, live.activeSequence.sequenceId, item.itemId, {
          titleSnapshot: payload.title,
          artistSnapshot: payload.artist,
          albumSnapshot: payload.album,
          categorySnapshot: payload.category,
          artworkURLSnapshot: payload.artworkURL
        }))
      : []
    await Promise.all(snapshotUpdates)
    if (snapshotUpdates.length) await loadLiveStudioItems()
    live.outputStatus = snapshotUpdates.length
      ? 'Asset metadata updated and visible sequence snapshots refreshed.'
      : 'Asset metadata updated.'
    live.assetEditor = { assetId: '', saving: false, error: '', dirty: false }
  } catch (error) {
    console.error('[studio-live] asset metadata update failed', error)
    live.assetEditor = {
      ...live.assetEditor,
      saving: false,
      error: error?.message || 'Could not update asset metadata.'
    }
  }
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
  const player = item ? livePlayerForItem(item.itemId) : null
  const progress = livePlayerProgress(player, item || {})
  try {
    window.localStorage.setItem('melogicLiveMonitorSnapshot', JSON.stringify({
      status: liveState().outputStatus,
      streamId: liveState().streamId,
      stream: liveState().stream || liveState().streamForm,
      progress,
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
  if (live.inputSource === 'sequence') live.sequenceInputEnabled = true
  if (live.inputSource === 'browser') live.browserInputEnabled = true
  syncLiveMonitorRoute()
  live.sourceMessage = live.inputSource === 'sequence' ? 'Sequence Editor selected as input source.' : 'Browser Input Source selected.'
  scheduleLiveStudioDraftSave()
  renderShell()
}

async function stopLiveVideoInput({ render = true } = {}) {
  const live = liveState()
  if (live.programVideoTrack) {
    await live.room?.localParticipant?.unpublishTrack?.(live.programVideoTrack, false).catch(() => {})
    live.programVideoTrack.stop?.()
    live.programVideoTrack = null
  }
  const track = live.localVideoTrack
  if (track) {
    await live.room?.localParticipant?.unpublishTrack?.(track, false).catch(() => {})
    try { track.detach?.().forEach((element) => element.remove?.()) } catch {}
    track.stop?.()
  }
  live.localVideoTrack = null
  live.videoPreviewActive = false
  live.videoPublishedToProvider = false
  if (live.videoPreviewError && !live.videoEnabled) live.videoPreviewError = ''
  if (live.streamId) await heartbeatLiveProgramState().catch(() => {})
  if (render) renderShell()
}

async function publishLiveVideoTrackIfNeeded() {
  const live = liveState()
  if (!live.room || !live.videoEnabled || live.videoPublishedToProvider) return
  const mixer = ensureStudioProgramMixer()
  mixer.attachCanvas(app.querySelector('[data-program-program-canvas]') || app.querySelector('[data-program-preview-canvas]'))
  mixer.enableVideo()
  live.programVideoTrack = mixer.getVideoTrack()
  if (!live.programVideoTrack) return
  await live.room.localParticipant.publishTrack(live.programVideoTrack, {
    source: Track?.Source?.Camera || 'camera',
    name: 'melogic-program-video'
  })
  live.videoPublishedToProvider = true
}

async function syncLiveProviderTrackGates() {
  const live = liveState()
  if (!live.room) return
  if (live.audioEnabled) {
    if (live.localTrack && !live.audioPublishedToProvider) {
      await live.room.localParticipant.publishTrack(live.localTrack, publishOptionsForLiveSource())
      live.audioPublishedToProvider = true
    }
  } else if (live.localTrack && live.audioPublishedToProvider) {
    await live.room.localParticipant.unpublishTrack(live.localTrack, false).catch(() => {})
    live.audioPublishedToProvider = false
  }
  if (live.videoEnabled) await publishLiveVideoTrackIfNeeded()
  else if (live.localVideoTrack) await stopLiveVideoInput({ render: false })
  await heartbeatLiveProgramState().catch(() => {})
}

async function setLiveAvEnabled(kind = 'audio', enabled = true) {
  const live = liveState()
  if (kind === 'audio') live.audioEnabled = Boolean(enabled)
  if (kind === 'video') live.videoEnabled = Boolean(enabled)
  if (!live.audioEnabled && !live.videoEnabled) {
    if (kind === 'audio') live.videoEnabled = true
    else live.audioEnabled = true
    live.sourceMessage = 'A live stream needs audio or video enabled.'
    renderShell()
    return
  }
  if (kind === 'video' && !live.videoEnabled) {
    live.sourceMessage = 'Video Input is off. Camera/video tracks were removed from program output.'
    await stopLiveVideoInput({ render: false })
  } else if (kind === 'video' && live.videoEnabled) {
    live.sourceMessage = 'Video Input is enabled. Use Input to prepare a local video source.'
    await publishLiveVideoTrackIfNeeded().catch((error) => {
      live.videoPreviewError = error?.message || 'Video track could not be published.'
    })
  } else if (kind === 'audio') {
    live.sourceMessage = live.audioEnabled ? 'Audio Input is enabled.' : 'Audio Input is off. Audio tracks were removed from program output.'
  }
  syncLiveMonitorRoute()
  await syncLiveProviderTrackGates().catch((error) => {
    live.sourceMessage = error?.message || 'Provider track gates could not update.'
  })
  scheduleLiveStudioDraftSave()
  renderShell()
}

function attachLiveVideoPreview() {
  const live = liveState()
  const mount = app.querySelector('[data-live-video-preview-mount]')
  if (!mount || !live.localVideoTrack) return
  let video = mount.querySelector('video')
  if (!video) {
    mount.innerHTML = ''
    video = document.createElement('video')
    video.autoplay = true
    video.muted = true
    video.playsInline = true
    video.controls = false
    mount.appendChild(video)
  }
  try {
    live.localVideoTrack.attach(video)
    video.play?.().catch(() => {})
  } catch {
    live.videoPreviewError = 'Video preview could not attach.'
  }
}

async function useLiveVideoInput() {
  const live = liveState()
  live.videoPreviewError = ''
  live.sourceMessage = ''
  renderShell()
  try {
    if (live.localVideoTrack) {
      await live.room?.localParticipant?.unpublishTrack?.(live.localVideoTrack, false).catch(() => {})
      live.localVideoTrack.stop?.()
      live.videoPublishedToProvider = false
    }
    live.localVideoTrack = null
    if (live.videoSource === 'sequence') {
      const item = liveItemById(live.currentItemId) || liveSelectedItem()
      if (!item?.videoURLSnapshot && !item?.videoURL) throw new Error('Select or play a sequence video item before using sequence video.')
      live.videoPreviewActive = true
      live.videoPreviewError = 'Sequence video preview is shown in the Sequence Editor preview.'
      renderShell()
      return
    }
    const constraints = live.selectedVideoDeviceId ? { deviceId: live.selectedVideoDeviceId } : {}
    const track = await createLocalVideoTrack(constraints)
    live.localVideoTrack = track
    live.videoPreviewActive = true
    if (live.room && live.videoEnabled) {
      await publishLiveVideoTrackIfNeeded()
      live.outputStatus = `Video input publishing with ${live.videoTransition} transition preference.`
      await heartbeatLiveProgramState().catch(() => {})
    } else {
      live.sourceMessage = 'Video input preview is local. Enable Video and go live to publish this source.'
    }
    renderShell()
    attachLiveVideoPreview()
  } catch (error) {
    live.videoPreviewActive = false
    live.localVideoTrack = null
    live.videoPreviewError = error?.message || 'Selected video source could not be opened.'
    renderShell()
  }
}

function updateLiveMixerValue(key = '', value = 1) {
  const live = liveState()
  if (!['browserGain', 'sequenceGain', 'masterGain'].includes(key)) return
  live.mixer[key] = Math.max(0, Math.min(1.25, Number(value || 0)))
  syncLiveMonitorRoute()
}

function handleAssetContextAction(action = '', assetId = '') {
  const live = liveState()
  live.contextMenu = null
  if (action === 'addAsset') return addLiveAsset(assetId)
  if (action === 'previewAsset') return startLiveAssetPreview(assetId)
  if (action === 'editAsset' || action === 'detailsAsset') return openLiveAssetEditor(assetId)
  if (action === 'debugAsset') {
    const asset = liveAssetById(assetId)
    live.outputStatus = asset?.normalizedAudioPath || asset?.sourceUploadPath || asset?.originalFileName || 'No asset file details available.'
  } else {
    live.outputStatus = `${action.replace(/Asset$/, '').replace(/([A-Z])/g, ' $1').trim()} action is ready for the asset editor workflow.`
  }
  renderShell()
}

async function handleSequenceContextAction(action = '', itemId = '') {
  const live = liveState()
  live.contextMenu = null
  if (action === 'play' || action === 'preview') await playLiveStudioItem(itemId)
  else if (action === 'pause') {
    const player = livePlayerForItem(itemId)
    if (player?.paused) await resumeLiveStudioPlayer(itemId)
    else await pauseLiveStudioPlayer(itemId)
  }
  else if (action === 'stop') {
    stopLiveStudioPlayer(itemId)
    refreshLiveDecks()
  }
  else if (action === 'restart') {
    const player = livePlayerForItem(itemId)
    if (player?.audio) {
      player.audio.currentTime = 0
      if (player.paused) await resumeLiveStudioPlayer(itemId)
    } else {
      await playLiveStudioItem(itemId)
    }
  }
  else if (action === 'cueBeginning') {
    const player = livePlayerForItem(itemId)
    if (player?.audio) player.audio.currentTime = 0
    live.selectedItemId = itemId
    live.outputStatus = 'Deck cued from beginning.'
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
  else if (action === 'removeDeck') {
    stopLiveStudioPlayer(itemId)
    if (live.currentItemId === itemId) live.currentItemId = ''
    if (live.nextItemId === itemId) live.nextItemId = ''
    if (live.afterNextItemId === itemId) live.afterNextItemId = ''
    refreshLiveDecks()
    live.outputStatus = 'Deck item removed.'
  }
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
  } else if (action === 'monitor') {
    live.selectedItemId = itemId
    openLiveMonitor()
  } else if (action === 'revealAsset') {
    live.selectedItemId = itemId
    live.outputStatus = 'Asset reveal is ready from the sequence row.'
  } else if (action === 'edit') {
    live.selectedItemId = itemId
    live.outputStatus = 'Edit item workflow is ready from the sequence menu.'
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
  liveState().providerId = STREAM_PROVIDERS.hlsEdge
  liveState().ingestMethod = normalizeIngestMethod(data.get('ingestMethod') || liveState().ingestMethod)
  const rawStreamKey = data.has('streamKey') ? data.get('streamKey') : (form.streamKey ?? 'mystream')
  form.streamKey = sanitizeHlsStreamKey(rawStreamKey)
  const nextCoverURL = String(data.get('coverArtURL') || '').trim()
  if (nextCoverURL !== form.coverArtURL && form.coverArtSource === 'upload') {
    const oldPath = form.coverArtPath
    form.coverArtPath = ''
    form.coverArtSource = nextCoverURL ? 'url' : 'fallback'
    deleteLiveCover(oldPath).catch(() => {})
  } else if (form.coverArtSource !== 'upload') {
    form.coverArtSource = nextCoverURL ? 'url' : 'fallback'
  }
  form.coverArtURL = nextCoverURL
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
  if (cover) {
    cover.innerHTML = renderStudioStableImage({ src: form.coverArtURL, fallback: 'MR', key: 'live-stream-cover-preview' })
    hydrateStudioStableImages(cover)
  }
}

function generateLiveStreamKey() {
  const timestamp = Date.now().toString(36).slice(-5)
  const random = Math.random().toString(36).slice(2, 6)
  return `stream-${timestamp}${random}`
}

function ensureLiveStreamKey() {
  const live = liveState()
  const streamKey = sanitizeHlsStreamKey(live.streamForm.streamKey)
  live.streamForm.streamKey = streamKey || generateLiveStreamKey()
  return live.streamForm.streamKey
}

function liveStreamPayload() {
  const live = liveState()
  const form = live.streamForm
  const providerId = normalizeProviderId(live.providerId)
  live.providerId = providerId
  const isFirebaseSegments = isFirebaseSegmentProvider(providerId)
  const ingestMethod = normalizeIngestMethod(live.ingestMethod, providerId)
  live.ingestMethod = ingestMethod
  const streamKey = sanitizeHlsStreamKey(form.streamKey || 'mystream')
  return {
    streamId: live.streamId || live.draftStreamId || '',
    title: form.title,
    description: form.description,
    category: form.category,
    visibility: form.visibility,
    accessMode: form.accessMode,
    password: form.password,
    coverArtURL: form.coverArtURL,
    coverArtPath: form.coverArtPath || '',
    coverArtSource: form.coverArtSource || (form.coverArtURL ? 'url' : 'fallback'),
    tags: form.tags,
    audioMode: form.audioMode,
    provider: isFirebaseSegments ? STREAM_PROVIDERS.firebaseSegments : STREAM_PROVIDERS.hlsEdge,
    providerLabel: isFirebaseSegments ? 'Firebase Segments' : 'Melogic Edge',
    transportProvider: isFirebaseSegments ? 'firebase' : 'hls-edge',
    ingestMethod: isFirebaseSegments ? '' : ingestMethod,
    ingestProtocol: isFirebaseSegments ? '' : ingestProtocolForMethod(ingestMethod),
    ingestMode: isFirebaseSegments ? 'browser-media-recorder' : ingestMethod === STREAM_INGEST_METHODS.browserWebrtc ? 'browser-webrtc' : 'rtmp-obs',
    playbackMode: isFirebaseSegments ? 'firebaseSegments' : 'hls',
    latencyProfile: isFirebaseSegments ? 'realtime' : 'buffered',
    streamKey: isFirebaseSegments ? '' : streamKey,
    hlsPlaybackUrl: isFirebaseSegments ? '' : buildHlsPlaybackUrl(streamKey),
    nativeStreaming: {
      enabled: isFirebaseSegments,
      targetLatencyMs: 30000,
      segmentDurationMs: 4000,
      audioFirst: true,
      videoEnabled: false,
      idleWhenNoListeners: true,
      minPlaybackBufferMs: 20000,
      maxPlaybackBufferMs: 60000,
      rollingRetentionMs: 300000,
      status: live.nativeStreamingStatus || 'idleNoListeners',
      hasPlayableSegments: false,
      oldestAvailableSegmentIndex: null,
      newestAvailableSegmentIndex: null,
      currentSegmentIndex: null,
      lastSegmentAt: null
    },
    inputSource: live.inputSource,
    selectedInputSource: live.inputSource,
    sequenceId: live.activeSequence?.sequenceId || '',
    selectedSequenceId: live.activeSequence?.sequenceId || '',
    ...liveProgramOutputState()
  }
}

function nativeStartLivePayload(streamId = '', hostSessionId = '') {
  const basePayload = liveStreamPayload()
  const programState = liveProgramOutputState()
  return {
    ...basePayload,
    ...programState,
    streamId,
    hostSessionId,
    hostActive: true,
    provider: STREAM_PROVIDERS.firebaseSegments,
    providerLabel: 'Firebase Segments',
    ingestMode: 'browser-media-recorder',
    playbackMode: 'firebaseSegments',
    broadcastState: 'liveIdleNoListeners',
    nativeStreaming: {
      ...(basePayload.nativeStreaming || {}),
      ...(programState.nativeStreaming || {}),
      status: 'idleNoListeners',
      hasPlayableSegments: false,
      newestAvailableSegmentIndex: null,
      currentSegmentIndex: null
    }
  }
}

function jsonSafeCopy(value) {
  try {
    return JSON.parse(JSON.stringify(value ?? null))
  } catch {
    return String(value ?? '')
  }
}

function firebaseErrorDetails(error = null) {
  return {
    code: error?.code || '',
    message: error?.message || '',
    details: jsonSafeCopy(error?.details || null),
    customData: jsonSafeCopy(error?.customData || null),
    raw: jsonSafeCopy(error)
  }
}

async function saveLiveStreamInfo() {
  const live = liveState()
  live.savingInfo = true
  renderShell()
  try {
    if (!isFirebaseSegmentProvider(live.providerId)) {
      ensureLiveStreamKey()
    }
    const payload = liveStreamPayload()
    if (live.streamId) {
      await updateMusicLiveStreamInfo(payload)
      live.outputStatus = 'Stream info updated.'
    } else {
      const response = await prepareMusicLiveStreamDraft(payload)
      live.draftStreamId = response.streamId || live.draftStreamId
      if (live.draftStreamId) subscribeLiveStudioStream(live.draftStreamId)
      live.outputStatus = 'Draft stream details saved.'
    }
  } catch (error) {
    console.error('[studio-live] update stream failed', error)
    live.error = error?.message || 'Could not update stream info.'
  } finally {
    live.savingInfo = false
    renderShell()
  }
}

function scheduleLiveStudioDraftSave() {
  const live = liveState()
  if (!state.user?.uid || live.streamId || live.starting || live.ending) return
  if (live.draftSaveTimer) window.clearTimeout(live.draftSaveTimer)
  live.draftSaveTimer = window.setTimeout(async () => {
    live.draftSaveTimer = 0
    if (live.streamId || live.starting || live.ending) return
    try {
      if (!isFirebaseSegmentProvider(live.providerId)) ensureLiveStreamKey()
      const response = await prepareMusicLiveStreamDraft(liveStreamPayload())
      live.draftStreamId = response.streamId || live.draftStreamId
    } catch (error) {
      console.warn('[studio-live] draft autosave failed', error?.message || error)
    }
  }, 1400)
}

async function startLiveStudioStream() {
  const live = liveState()
  if (!state.user?.uid || live.starting || live.streamId) return
  live.providerId = STREAM_PROVIDERS.hlsEdge
  live.ingestMethod = normalizeIngestMethod(live.ingestMethod)
  live.starting = true
  live.error = ''
  live.outputStatus = 'Creating Melogic Music live stream...'
  renderShell()
  let pendingStreamId = ''
  let browserIngestStarted = false
  try {
    if (!live.streamForm.rightsAccepted) throw new Error('Accept the live stream rules before starting.')
    const streamKey = ensureLiveStreamKey()
    if (live.ingestMethod === STREAM_INGEST_METHODS.browserWebrtc && !isBrowserWebrtcIngestConfigured()) {
      throw new Error('Browser streaming needs the server WebRTC ingest URL configured.')
    }
    live.outputStatus = 'Saving Live Studio stream details...'
    renderShell()
    const draftResponse = await prepareMusicLiveStreamDraft(liveStreamPayload())
    live.draftStreamId = draftResponse.streamId || live.draftStreamId
    if (!live.draftStreamId) throw new Error('Could not save live stream draft.')
    if (isFirebaseSegmentProvider(live.providerId) && firebaseSegmentStreamingEnabled()) {
      pendingStreamId = live.draftStreamId
      const hostSessionId = nativeHostSessionId(pendingStreamId)
      live.nativeHostSessionId = hostSessionId
      await markMusicLiveStreamOnAir(pendingStreamId, nativeStartLivePayload(pendingStreamId, hostSessionId))
      await activateNativeLiveSession(pendingStreamId)
      live.outputStatus = 'Live - waiting for listeners. Media chunks start after a listener clicks Listen.'
      return
    }
    const response = await startMusicLiveStream({
      ...liveStreamPayload(),
      streamId: live.draftStreamId,
      rightsAccepted: true,
      archiveRequested: false
    })
    pendingStreamId = response.streamId || ''
    if (!pendingStreamId) throw new Error('The live stream service did not return a stream id.')
    live.nativeHostSessionId = live.nativeHostSessionId || nativeHostSessionId(pendingStreamId)
    if (isBufferedBroadcastProvider(live.providerId)) {
      const hlsPlaybackUrl = buildHlsPlaybackUrl(streamKey)
      const isBrowserIngest = live.ingestMethod === STREAM_INGEST_METHODS.browserWebrtc
      let browserIngestResult = null
      live.providerDiagnostics = {
        providerId: STREAM_PROVIDERS.hlsEdge,
        streamingMethod: live.ingestMethod,
        transportProvider: 'hls-edge',
        playbackMode: 'hls',
        ingestMethod: live.ingestMethod,
        ingestProtocol: ingestProtocolForMethod(live.ingestMethod),
        streamKey,
        hlsPlaybackUrl,
        ingestEndpointConfigured: !isBrowserIngest || isBrowserWebrtcIngestConfigured(),
        ingestEndpointURL: isBrowserIngest ? '' : 'external encoder',
        streamDocStatus: 'starting',
        peerConnectionState: isBrowserIngest ? 'new' : 'none',
        iceConnectionState: isBrowserIngest ? 'new' : 'none',
        signalingState: isBrowserIngest ? 'stable' : 'none',
        localOfferCreated: false,
        remoteAnswerSet: false,
        lastIngestError: '',
        noLiveKitAttempted: true
      }
      if (isBrowserIngest) {
        live.outputStatus = 'Connecting Studio Program output to Melogic Edge...'
        renderShell()
        const mediaStream = await nativeProgramMediaStream()
        browserIngestResult = await startBrowserWebrtcIngest({
          streamKey,
          mediaStream,
          onStatus: (ingestStatus = {}) => {
            live.providerDiagnostics = {
              ...(live.providerDiagnostics || {}),
              ...ingestStatus,
              ingestConnectionState: ingestStatus.connectionState || ingestStatus.status || 'connecting'
            }
          },
          onError: (error, ingestDiagnostics = {}) => {
            live.providerDiagnostics = {
              ...(live.providerDiagnostics || {}),
              ...ingestDiagnostics,
              ingestConnectionState: 'error',
              lastIngestError: error?.message || String(error)
            }
          }
        })
        browserIngestStarted = true
        live.browserIngestActive = true
        live.audioPublishedToProvider = browserIngestResult.audioPublished === true
        live.videoPublishedToProvider = browserIngestResult.videoPublished === true
        live.providerDiagnostics = {
          ...(live.providerDiagnostics || {}),
          ...(browserIngestResult.diagnostics || {}),
          ingestEndpointURL: browserIngestResult.ingestEndpointURL || live.providerDiagnostics?.ingestEndpointURL || '',
          ingestConnectionState: browserIngestResult.connectionState || 'connected'
        }
      }
      live.streamId = pendingStreamId
      await markMusicLiveStreamOnAir(pendingStreamId, {
        ...liveStreamPayload(),
        ...liveProgramOutputState(),
        streamId: pendingStreamId,
        provider: STREAM_PROVIDERS.hlsEdge,
        transportProvider: 'hls-edge',
        ingestMethod: live.ingestMethod,
        ingestProtocol: ingestProtocolForMethod(live.ingestMethod),
        ingestMode: isBrowserIngest ? 'browser-webrtc' : 'rtmp-obs',
        playbackMode: 'hls',
        streamKey,
        hlsPlaybackUrl,
        hostSessionId: live.nativeHostSessionId,
        hostActive: true,
        connectionStatus: isBrowserIngest ? 'live' : 'waitingForIngest',
        audioPublished: browserIngestResult?.audioPublished === true,
        videoPublished: browserIngestResult?.videoPublished === true,
        programHasAudio: browserIngestResult?.audioPublished === true,
        broadcastState: 'liveBroadcasting'
      })
      live.draftStreamId = pendingStreamId
      subscribeLiveStudioStream(pendingStreamId)
      subscribeLiveStudioChat(pendingStreamId)
      if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
      live.heartbeatTimer = window.setInterval(() => {
        if (!live.streamId) return
        heartbeatMusicLiveStream(live.streamId, {
          ...liveProgramOutputState(),
          connectionStatus: live.ingestMethod === STREAM_INGEST_METHODS.browserWebrtc ? 'live' : 'waitingForIngest'
        }).catch(() => {})
        writeNativeHostPresence({
          streamId: live.streamId,
          uid: state.user.uid,
          state: 'online',
          broadcasting: true,
          hostSessionId: live.nativeHostSessionId
        }).catch(() => {})
      }, 15000)
      heartbeatLiveProgramState().catch(() => {})
      await writeNativeHostPresence({
        streamId: pendingStreamId,
        uid: state.user.uid,
        state: 'online',
        broadcasting: true,
        hostSessionId: live.nativeHostSessionId
      }).catch((error) => {
        console.warn('[studio-live] HLS Edge host presence write failed after stream was marked live.', {
          streamId: pendingStreamId,
          message: error?.message || String(error)
        })
      })
      live.providerDiagnostics = {
        ...(live.providerDiagnostics || {}),
        streamDocStatus: 'live',
        noLiveKitAttempted: true
      }
      live.outputStatus = isBrowserIngest
        ? 'On air. Studio Program is publishing to Melogic Edge; viewers receive buffered HLS.'
        : 'On air. Waiting for the OBS / encoder feed at Melogic Edge.'
      return
    }
    throw new Error('Unsupported Studio streaming method.')
  } catch (error) {
    const firebaseDetails = firebaseErrorDetails(error)
    console.error('[studio-live] start stream failed', {
      error,
      errorCode: firebaseDetails.code,
      errorMessage: firebaseDetails.message,
      errorDetails: firebaseDetails.details,
      errorCustomData: firebaseDetails.customData,
      errorJson: firebaseDetails.raw,
      streamId: pendingStreamId || live.draftStreamId || live.streamId || '',
      provider: live.providerId,
      currentStatus: live.stream?.status || '',
      targetStatus: 'live',
      broadcastState: isFirebaseSegmentProvider(live.providerId) ? 'liveIdleNoListeners' : 'liveBroadcasting',
      validationBranch: live.providerId,
      callableDetails: firebaseDetails.details || firebaseDetails.customData || null,
      functionName: 'startLiveStudioStream'
    })
    if (browserIngestStarted || live.browserIngestActive) await stopBrowserWebrtcIngest().catch(() => {})
    live.browserIngestActive = false
    if (pendingStreamId) await endMusicLiveStream(pendingStreamId).catch(() => {})
    live.streamId = ''
    live.draftStreamId = ''
    try {
      const draft = await prepareMusicLiveStreamDraft({ ...liveStreamPayload(), streamId: '' })
      live.draftStreamId = draft.streamId || ''
    } catch (draftError) {
      console.warn('[studio-live] failed-start draft restore failed', draftError?.message || draftError)
    }
    live.room?.disconnect?.()
    live.room = null
    live.localTrack = null
    live.programAudioTrack = null
    live.livekitAudioPublication = null
    live.audioPublishedToProvider = false
    live.videoPublishedToProvider = false
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
    if (live.browserIngestActive || live.ingestMethod === STREAM_INGEST_METHODS.browserWebrtc) {
      await stopBrowserWebrtcIngest().catch((error) => {
        live.nativeStopWarning = error?.message || 'Browser ingest cleanup failed.'
      })
      live.browserIngestActive = false
      studioProgramMixer?.releaseVideoCapture?.()
      live.programVideoTrack = null
    }
    if (isFirebaseSegmentProvider(live.providerId) && firebaseSegmentStreamingEnabled()) {
      stopNativeSegmentRecorder({ status: 'ended' })
      live.nativeDemandUnsubscribe?.()
      live.nativeDemandUnsubscribe = null
      if (live.nativeNoDemandTimer) window.clearTimeout(live.nativeNoDemandTimer)
      live.nativeNoDemandTimer = 0
      await withTimeout(
        writeNativeHostPresence({ streamId, uid: state.user?.uid || '', state: 'offline', broadcasting: false, hostSessionId: live.nativeHostSessionId }),
        3000,
        'Native host presence cleanup timed out.'
      ).catch((error) => {
        live.nativeStopWarning = error?.message || 'Native host presence cleanup timed out.'
      })
    } else {
      await withTimeout(
        writeNativeHostPresence({ streamId, uid: state.user?.uid || '', state: 'offline', broadcasting: false, hostSessionId: live.nativeHostSessionId }),
        3000,
        'Host presence cleanup timed out.'
      ).catch((error) => {
        live.nativeStopWarning = error?.message || 'Host presence cleanup timed out.'
      })
    }
    try {
      if (live.programAudioTrack && live.programAudioTrack !== live.localTrack) await live.room?.localParticipant?.unpublishTrack?.(live.programAudioTrack, false)
      if (live.localTrack) await live.room?.localParticipant?.unpublishTrack?.(live.localTrack, false)
      if (live.localVideoTrack) await live.room?.localParticipant?.unpublishTrack?.(live.localVideoTrack, false)
      if (live.programVideoTrack) await live.room?.localParticipant?.unpublishTrack?.(live.programVideoTrack, false)
    } catch {}
    live.room?.disconnect?.()
    await withTimeout(endMusicLiveStream(streamId), 10000, 'Ending the stream timed out. Local cleanup completed; Firestore may finish shortly.').catch((error) => {
      live.nativeStopWarning = error?.message || 'Ending the stream timed out. Local cleanup completed.'
    })
    unsubscribeLiveStudioRuntime()
    clearEndedLiveHostState(streamId)
    live.outputStatus = live.nativeStopWarning || 'Live Studio stream ended.'
  } catch (error) {
    console.error('[studio-live] end stream failed', error)
    live.error = error?.message || 'Could not end Live Studio stream.'
    live.outputStatus = 'Live Studio end failed.'
  } finally {
    live.starting = false
    live.ending = false
    renderShell()
  }
}

async function resumeInterruptedNativeStream() {
  const live = liveState()
  const streamId = live.nativeInterruptedStreamId || live.draftStreamId || live.stream?.streamId || live.stream?.id || ''
  if (!state.user?.uid || !streamId || live.starting || live.streamId) return
  live.starting = true
  live.error = ''
  live.outputStatus = 'Resuming Native Streaming host session...'
  renderShell()
  try {
    const hostSessionId = nativeHostSessionId(streamId)
    live.nativeHostSessionId = hostSessionId
    await markMusicLiveStreamOnAir(streamId, nativeStartLivePayload(streamId, hostSessionId))
    await activateNativeLiveSession(streamId)
    live.outputStatus = 'Live - waiting for listeners. Media chunks start after a listener clicks Listen.'
  } catch (error) {
    console.error('[studio-live] resume native stream failed', error)
    live.error = error?.message || 'Could not resume Native Streaming.'
    live.outputStatus = 'Native Streaming resume failed.'
  } finally {
    live.starting = false
    renderShell()
  }
}

function withTimeout(promise, ms = 10000, message = 'Operation timed out.') {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      window.setTimeout(() => reject(new Error(message)), ms)
    })
  ])
}

async function endInterruptedNativeStream() {
  const live = liveState()
  const streamId = live.nativeInterruptedStreamId || live.draftStreamId || live.stream?.streamId || live.stream?.id || ''
  if (!state.user?.uid || !streamId || live.ending) return
  live.ending = true
  live.error = ''
  live.outputStatus = 'Ending interrupted Native Streaming session...'
  renderShell()
  try {
    await withTimeout(
      writeNativeHostPresence({ streamId, uid: state.user.uid, state: 'offline', broadcasting: false, hostSessionId: live.nativeHostSessionId }),
      3000,
      'Native host presence cleanup timed out.'
    ).catch((error) => {
      live.nativeStopWarning = error?.message || 'Native host presence cleanup timed out.'
    })
    await withTimeout(endMusicLiveStream(streamId), 10000, 'Ending the interrupted stream timed out.').catch((error) => {
      live.nativeStopWarning = error?.message || 'Ending the interrupted stream timed out.'
    })
    unsubscribeLiveStudioRuntime()
    clearEndedLiveHostState(streamId)
    live.outputStatus = live.nativeStopWarning || 'Interrupted Native Streaming session ended.'
  } catch (error) {
    console.error('[studio-live] end interrupted native stream failed', error)
    live.error = error?.message || 'Could not end interrupted Native Streaming session.'
    live.outputStatus = 'Native Streaming end failed.'
  } finally {
    live.starting = false
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
  live.nativeDemandUnsubscribe?.()
  live.nativeDemandUnsubscribe = null
  if (live.nativeNoDemandTimer) window.clearTimeout(live.nativeNoDemandTimer)
  live.nativeNoDemandTimer = 0
  live.nativeRecorderRunning = false
  if (live.heartbeatTimer) window.clearInterval(live.heartbeatTimer)
  live.heartbeatTimer = 0
}

function clearEndedLiveHostState(streamId = '') {
  const live = liveState()
  if (streamId) clearNativeHostSessionMarker(streamId)
  live.streamId = ''
  live.draftStreamId = ''
  live.stream = null
  live.nativeInterruptedStreamId = ''
  live.nativeHostSessionId = ''
  live.nativePlaybackDemandCount = 0
  live.nativeStreamingStatus = 'idleNoListeners'
  live.nativeRecorderRunning = false
  live.nativeRecorderStartReason = ''
  live.nativeRecorderStopReason = ''
  live.nativeLastDemandChangeAt = ''
  live.providerDiagnostics = {}
  live.browserIngestActive = false
  live.room = null
  live.localTrack = null
  live.programAudioTrack = null
  live.livekitAudioPublication = null
  live.programVideoTrack = null
  live.audioPublishedToProvider = false
  live.videoPublishedToProvider = false
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
      live.streamForm.coverArtPath = stream.coverArtPath || ''
      live.streamForm.coverArtSource = stream.coverArtSource || (stream.coverArtURL ? 'url' : 'fallback')
      live.streamForm.streamKey = sanitizeHlsStreamKey(stream.streamKey || live.streamForm.streamKey || 'mystream')
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
  }, () => {
    live.error = 'Chat unavailable.'
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

function mergedSequenceMetadata(item = {}) {
  const live = liveState()
  const current = live.metadata || {}
  return {
    title: item.titleSnapshot || current.title || live.streamForm.title || '',
    artist: item.artistSnapshot || current.artist || '',
    album: item.albumSnapshot || current.album || '',
    artworkURL: item.artworkURLSnapshot || current.artworkURL || live.streamForm.coverArtURL || '',
    notes: item.notes || current.notes || ''
  }
}

async function autoMatchLiveMetadataFromSequence(item = {}) {
  const live = liveState()
  if (!live.metadata.autoMatchSequencer || !live.streamId || !item?.itemId) return
  if (live.metadata.lastAutoMatchedItemId === item.itemId) return
  live.metadata.lastAutoMatchedItemId = item.itemId
  const payload = mergedSequenceMetadata(item)
  live.metadata.title = payload.title
  live.metadata.artist = payload.artist
  live.metadata.album = payload.album
  live.metadata.artworkURL = payload.artworkURL
  live.metadata.notes = payload.notes
  try {
    const itemId = `sequence-${item.itemId}`
    await upsertMusicLiveSequenceItem({ streamId: live.streamId, itemId, ...payload })
    await setMusicLiveNowPlaying(live.streamId, itemId)
    live.outputStatus = `Live metadata matched ${payload.title || 'sequence item'}.`
  } catch (error) {
    console.error('[studio-live] auto metadata update failed', error)
    live.outputStatus = 'Could not auto-match live metadata.'
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
    const player = item ? livePlayerForItem(item.itemId) : null
    if (e.key === ' ' && player?.paused) resumeLiveStudioPlayer(item.itemId)
    else if (e.key === ' ' && player) pauseLiveStudioPlayer(item.itemId)
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
    scheduleLiveStudioDraftSave()
  })
  app.querySelector('[data-live-cover-upload]')?.addEventListener('change', (e) => {
    const file = e.currentTarget.files?.[0]
    if (file) uploadLiveStudioCover(file).catch(() => {})
    e.currentTarget.value = ''
  })
  app.querySelector('[data-live-cover-clear]')?.addEventListener('click', () => {
    const oldPath = live.streamForm.coverArtSource === 'upload' ? live.streamForm.coverArtPath : ''
    live.streamForm.coverArtURL = ''
    live.streamForm.coverArtPath = ''
    live.streamForm.coverArtSource = 'fallback'
    if (oldPath) deleteLiveCover(oldPath).catch(() => {})
    scheduleLiveStudioDraftSave()
    renderShell()
  })
  app.querySelector('[data-live-start-stream]')?.addEventListener('click', () => {
    updateLiveStreamFormFromElement(app.querySelector('[data-live-stream-form]'))
    startLiveStudioStream()
  })
  app.querySelector('[data-live-resume-native]')?.addEventListener('click', () => {
    updateLiveStreamFormFromElement(app.querySelector('[data-live-stream-form]'))
    resumeInterruptedNativeStream()
  })
  app.querySelector('[data-live-end-interrupted]')?.addEventListener('click', () => {
    if (!window.confirm('End this interrupted Native Streaming session for listeners?')) return
    endInterruptedNativeStream()
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
    scheduleLiveStudioDraftSave()
    renderShell()
  })
  app.querySelectorAll('[data-live-set-source]').forEach((el) => el.addEventListener('click', () => setLiveInputSource(el.dataset.liveSetSource)))
  app.querySelectorAll('[data-live-av-toggle]').forEach((el) => el.addEventListener('change', (e) => {
    setLiveAvEnabled(el.dataset.liveAvToggle, e.currentTarget.checked).catch((error) => {
      live.sourceMessage = error?.message || 'Input gate could not update.'
      renderShell()
    })
  }))
  app.querySelector('[data-advanced-streaming-settings]')?.addEventListener('toggle', (e) => {
    live.advancedStreamingOpen = Boolean(e.currentTarget.open)
  })
  app.querySelectorAll('[data-streaming-method]').forEach((el) => el.addEventListener('click', (e) => {
    if (live.streamId) {
      live.error = 'End the current stream before switching streaming method.'
      renderShell()
      return
    }
    live.providerId = STREAM_PROVIDERS.hlsEdge
    live.ingestMethod = normalizeIngestMethod(e.currentTarget.dataset.streamingMethod)
    live.providerDiagnostics = {}
    live.outputStatus = live.ingestMethod === STREAM_INGEST_METHODS.obsRtmp
      ? 'Stream From OBS / Encoder selected. Configure your encoder with the stream key below.'
      : isBrowserWebrtcIngestConfigured()
        ? 'Stream From Browser selected. Studio Program will publish to Melogic Edge.'
        : 'Browser streaming needs the server WebRTC ingest URL configured.'
    scheduleLiveStudioDraftSave()
    renderShell()
  }))
  app.querySelectorAll('[data-program-scene]').forEach((el) => el.addEventListener('click', () => {
    live.programMixer.previewSceneId = el.dataset.programScene || ''
    live.programMixer.activeSceneId = live.programMixer.programSceneId || ''
    heartbeatLiveProgramState().catch(() => {})
    renderShell()
  }))
  app.querySelectorAll('[data-program-scene-action]').forEach((el) => el.addEventListener('click', () => {
    handleProgramSceneAction(el.dataset.programSceneAction || '').catch((error) => {
      live.programMixer.notice = error?.message || 'Scene action failed.'
      renderShell()
    })
  }))
  app.querySelectorAll('[data-program-source]').forEach((el) => el.addEventListener('click', () => {
    live.programMixer.selectedSourceId = el.dataset.programSource || live.programMixer.selectedSourceId
    renderShell()
  }))
  app.querySelector('[data-program-open-source-modal]')?.addEventListener('click', () => {
    live.programMixer.sourceModal = {
      open: true,
      name: '',
      type: 'browser-microphone',
      targetSceneId: live.programMixer.previewSceneId || '',
      error: ''
    }
    renderShell()
  })
  app.querySelectorAll('[data-program-close-scene-modal]').forEach((el) => el.addEventListener('click', () => {
    live.programMixer.sceneModal = { open: false, name: '', templateId: 'blank', error: '' }
    renderShell()
  }))
  app.querySelectorAll('[data-program-close-source-modal]').forEach((el) => el.addEventListener('click', () => {
    live.programMixer.sourceModal = { open: false, name: '', type: 'browser-microphone', targetSceneId: '', error: '' }
    renderShell()
  }))
  app.querySelector('[data-program-scene-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    await createProgramSceneFromModal(e.currentTarget).catch((error) => {
      live.programMixer.sceneModal = { ...live.programMixer.sceneModal, error: error?.message || 'Could not create scene.' }
      renderShell()
    })
  })
  app.querySelector('[data-program-source-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    await createProgramSourceFromModal(e.currentTarget).catch((error) => {
      live.programMixer.sourceModal = { ...live.programMixer.sourceModal, error: error?.message || 'Could not add source.' }
      renderShell()
    })
  })
  app.querySelector('[data-program-take]')?.addEventListener('click', () => {
    if (!live.programMixer.previewSceneId) return
    live.programMixer.programSceneId = live.programMixer.previewSceneId
    live.programMixer.activeSceneId = live.programMixer.programSceneId
    live.programMixer.mode = 'program'
    live.outputStatus = 'Program Mixer preview taken to program.'
    heartbeatLiveProgramState().catch(() => {})
    renderShell()
  })
  app.querySelector('[data-program-cut]')?.addEventListener('click', () => {
    if (!live.programMixer.previewSceneId) return
    live.programMixer.programSceneId = live.programMixer.previewSceneId
    live.programMixer.activeSceneId = live.programMixer.programSceneId
    live.outputStatus = 'Program Mixer cut to preview scene.'
    heartbeatLiveProgramState().catch(() => {})
    renderShell()
  })
  app.querySelector('[data-program-fade]')?.addEventListener('click', () => {
    if (!live.programMixer.previewSceneId) return
    live.programMixer.programSceneId = live.programMixer.previewSceneId
    live.programMixer.activeSceneId = live.programMixer.programSceneId
    live.outputStatus = `Program Mixer faded to preview scene over ${Number(live.programMixer.transitionDurationMs || 400)}ms.`
    heartbeatLiveProgramState().catch(() => {})
    renderShell()
  })
  app.querySelector('[data-program-transition-duration]')?.addEventListener('input', (e) => {
    live.programMixer.transitionDurationMs = Math.max(0, Math.min(5000, Number(e.currentTarget.value || 0)))
  })
  app.querySelector('[data-program-guest-search-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const query = String(new FormData(e.currentTarget).get('query') || '').trim()
    live.guestSearchQuery = query
    live.guestSearchLoading = true
    renderShell()
    try {
      live.guestSearchResults = await searchLiveStudioGuests(query, state.user?.uid || '')
      live.guestInviteStatus = live.guestSearchResults.length ? '' : 'No matching users found.'
    } catch (error) {
      live.guestInviteStatus = error?.message || 'Guest search failed.'
    } finally {
      live.guestSearchLoading = false
      renderShell()
    }
  })
  app.querySelectorAll('[data-program-invite-user]').forEach((el) => el.addEventListener('click', async () => {
    const profile = live.guestSearchResults.find((entry) => entry.uid === el.dataset.programInviteUser)
    if (!profile || !state.user?.uid) return
    try {
      const sessionId = await ensureLiveStudioSessionId()
      await saveLiveStudioGuestInvite(sessionId, {
        hostUid: state.user.uid,
        guestUid: profile.uid,
        guestDisplayName: profile.displayName,
        guestUsername: profile.username,
        guestPhotoURL: profile.avatarURL || profile.photoURL,
        status: 'invited'
      })
      live.guests = await listLiveStudioGuestInvites(sessionId)
      live.guestInviteStatus = `${profile.displayName || profile.username || 'Guest'} invited backstage.`
    } catch (error) {
      live.guestInviteStatus = error?.message || 'Could not invite guest.'
    }
    renderShell()
  }))
  app.querySelectorAll('[data-program-guest-source]').forEach((el) => el.addEventListener('click', async () => {
    const invite = live.guests.find((entry) => entry.inviteId === el.dataset.programGuestSource)
    if (!invite) return
    const type = el.dataset.sourceType || 'guest-audio'
    const source = await createProgramSource({
      type,
      label: `${invite.guestDisplayName || invite.guestUsername || 'Guest'} ${type === 'guest-video' ? 'Video' : 'Audio'}`,
      targetSceneId: live.programMixer.previewSceneId || live.programMixer.programSceneId || ''
    })
    await updateLiveStudioGuestInviteStatus(liveStudioSessionId(), invite.inviteId, invite.status || 'invited', {
      ...(invite.setup || {}),
      [`${type}SourceId`]: source.sourceId
    }).catch(() => {})
  }))
  app.querySelectorAll('[data-program-remove-guest]').forEach((el) => el.addEventListener('click', async () => {
    await removeLiveStudioGuestInvite(liveStudioSessionId(), el.dataset.programRemoveGuest || '').catch(() => {})
    live.guests = await listLiveStudioGuestInvites(liveStudioSessionId())
    renderShell()
  }))
  app.querySelectorAll('[data-program-source-toggle]').forEach((el) => el.addEventListener('change', (e) => {
    const source = selectedProgramSource()
    if (!source) return
    updateProgramSource(source.sourceId, { [el.dataset.programSourceToggle]: Boolean(e.currentTarget.checked) })
  }))
  app.querySelectorAll('[data-program-source-range]').forEach((el) => el.addEventListener('input', (e) => {
    const source = selectedProgramSource()
    if (!source) return
    updateProgramSource(source.sourceId, { [el.dataset.programSourceRange]: Math.max(0, Math.min(1, Number(e.currentTarget.value || 0))) }, { persist: false })
  }))
  app.querySelectorAll('[data-program-source-range]').forEach((el) => el.addEventListener('change', (e) => {
    const source = selectedProgramSource()
    if (!source) return
    updateProgramSource(source.sourceId, { [el.dataset.programSourceRange]: Math.max(0, Math.min(1, Number(e.currentTarget.value || 0))) })
  }))
  app.querySelectorAll('[data-program-source-action]').forEach((el) => el.addEventListener('click', () => handleProgramSourceAction(el.dataset.programSourceAction || '')))
  app.querySelectorAll('[data-program-audio-route]').forEach((el) => el.addEventListener('change', (e) => {
    const sourceId = el.dataset.programAudioRoute || ''
    const field = el.dataset.route === 'monitor' ? 'monitorEnabled' : 'programEnabled'
    updateProgramSource(sourceId, { [field]: Boolean(e.currentTarget.checked) })
  }))
  app.querySelectorAll('[data-program-audio-gain]').forEach((el) => el.addEventListener('input', (e) => {
    updateProgramSource(el.dataset.programAudioGain || '', { gain: Math.max(0, Math.min(1.5, Number(e.currentTarget.value || 0))) }, { persist: false })
  }))
  app.querySelectorAll('[data-program-audio-gain]').forEach((el) => el.addEventListener('change', (e) => {
    updateProgramSource(el.dataset.programAudioGain || '', { gain: Math.max(0, Math.min(1.5, Number(e.currentTarget.value || 0))) })
  }))
  app.querySelectorAll('[data-live-audio-route]').forEach((el) => el.addEventListener('change', (e) => {
    const route = el.dataset.liveAudioRoute || ''
    if (route === 'browser') live.browserInputEnabled = Boolean(e.currentTarget.checked)
    if (route === 'sequence') live.sequenceInputEnabled = Boolean(e.currentTarget.checked)
    syncLiveMonitorRoute()
    heartbeatLiveProgramState().catch(() => {})
    scheduleLiveStudioDraftSave()
    renderShell()
  }))
  app.querySelectorAll('[data-live-mixer]').forEach((el) => el.addEventListener('input', (e) => updateLiveMixerValue(el.dataset.liveMixer, e.currentTarget.value)))
  app.querySelectorAll('[data-live-mixer-mute]').forEach((el) => el.addEventListener('click', () => {
    const target = el.dataset.liveMixerMute
    if (target === 'browser') live.mixer.browserMuted = !live.mixer.browserMuted
    if (target === 'sequence') live.mixer.sequenceMuted = !live.mixer.sequenceMuted
    syncLiveMonitorRoute()
    renderShell()
  }))
  app.querySelector('[data-live-video-source]')?.addEventListener('change', (e) => {
    live.videoSource = e.currentTarget.value === 'sequence' ? 'sequence' : 'browser'
    renderShell()
  })
  app.querySelector('[data-live-video-device]')?.addEventListener('change', (e) => {
    live.selectedVideoDeviceId = e.currentTarget.value || ''
    live.videoPreviewActive = false
    live.videoPreviewError = ''
    live.localVideoTrack?.stop?.()
    live.localVideoTrack = null
    renderShell()
  })
  app.querySelector('[data-live-video-transition]')?.addEventListener('change', (e) => {
    live.videoTransition = e.currentTarget.value === 'fade' ? 'fade' : 'cut'
  })
  app.querySelector('[data-live-use-video-input]')?.addEventListener('click', () => {
    useLiveVideoInput().catch(() => {})
  })
  app.querySelector('[data-live-refresh-video]')?.addEventListener('click', () => {
    refreshLiveInputDevices().then(() => {
      if (live.selectedVideoDeviceId || live.videoSource === 'browser') return useLiveVideoInput()
      return null
    }).catch(() => {})
  })
  app.querySelector('[data-live-refresh-devices]')?.addEventListener('click', () => refreshLiveInputDevices())
  app.querySelector('[data-live-prepare-mic]')?.addEventListener('click', () => prepareLiveMicSource())
  app.querySelector('[data-live-open-monitor]')?.addEventListener('click', () => openLiveMonitor())
  app.querySelector('[data-live-preview-fullscreen]')?.addEventListener('click', (e) => {
    const video = e.currentTarget.querySelector('video') || e.currentTarget
    video.requestFullscreen?.().catch(() => {})
    video.play?.().catch(() => {})
  })
  app.querySelector('[data-live-metadata-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const data = new FormData(e.currentTarget)
    live.metadata.title = String(data.get('title') || '').trim()
    live.metadata.artist = String(data.get('artist') || '').trim()
    live.metadata.album = String(data.get('album') || '').trim()
    live.metadata.artworkURL = String(data.get('artworkURL') || '').trim()
    live.metadata.notes = String(data.get('notes') || '').trim()
    live.metadata.override = data.get('override') === 'on'
    live.metadata.autoMatchSequencer = data.get('autoMatchSequencer') === 'on'
    await setManualLiveMetadata()
  })
  app.querySelector('[name="autoMatchSequencer"]')?.addEventListener('change', (e) => {
    live.metadata.autoMatchSequencer = Boolean(e.currentTarget.checked)
    live.metadata.lastAutoMatchedItemId = ''
    const current = liveItemById(live.currentItemId)
    if (live.metadata.autoMatchSequencer && current) {
      autoMatchLiveMetadataFromSequence(current).then(() => renderShell()).catch(() => renderShell())
    } else {
      renderShell()
    }
  })
  app.querySelector('[data-live-clear-metadata]')?.addEventListener('click', () => clearManualLiveMetadata())
  app.querySelector('[data-live-asset-editor-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    await saveLiveAssetEditor(e.currentTarget)
  })
  app.querySelector('[data-live-asset-editor-form]')?.addEventListener('input', () => {
    live.assetEditor.dirty = true
  })
  app.querySelectorAll('[data-close-live-asset-editor]').forEach((el) => el.addEventListener('click', () => closeLiveAssetEditor()))
  app.querySelector('[data-live-asset-editor-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLiveAssetEditor()
  })
  app.querySelector('[data-live-chat-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const text = String(new FormData(e.currentTarget).get('message') || '').trim()
    if (!text || !live.streamId) return
    try {
      await sendMusicLiveChatMessage(live.streamId, text)
      live.chatDraft = ''
    } catch (error) {
      live.error = error?.message || 'Live chat message could not be sent.'
    }
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
    }).finally(() => scheduleLiveStudioDraftSave())
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
  app.querySelector('[data-live-add-asset-open]')?.addEventListener('click', () => openLiveAssetAddModal())
  app.querySelector('[data-live-asset-add-form]')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    await addLiveAssetFromForm(e.currentTarget)
  })
  app.querySelector('[data-live-asset-add-form] select[name="mode"]')?.addEventListener('change', (e) => {
    live.assetAdd.mode = e.currentTarget.value || 'audio'
  })
  app.querySelectorAll('[data-close-live-asset-add]').forEach((el) => el.addEventListener('click', () => closeLiveAssetAddModal()))
  app.querySelector('[data-live-asset-add-backdrop]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeLiveAssetAddModal()
  })
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
  app.querySelector('[data-live-stop-preview]')?.addEventListener('click', () => stopLiveAssetPreview())
  app.querySelector('[data-live-pause-preview]')?.addEventListener('click', () => toggleLiveAssetPreviewPause())
  app.querySelector('[data-live-preview-volume]')?.addEventListener('input', (e) => setLiveAssetPreviewVolume(e.currentTarget.value))
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
    if (live.assetEditor?.assetId) {
      closeLiveAssetEditor()
      return
    }
    if (live.assetAdd?.open) {
      closeLiveAssetAddModal()
      return
    }
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
  const live = liveState()
  const activeHostSession = Boolean(
    live.streamId &&
    !live.ending &&
    (live.nativeHostSessionId || live.stream?.status === 'live' || ['liveIdleNoListeners', 'liveWarmingBuffer', 'liveBroadcasting'].includes(live.stream?.broadcastState || ''))
  )
  if (!activeHostSession) return
  event.preventDefault()
  event.returnValue = ''
})
