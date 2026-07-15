import './styles/base.css'
import './styles/music.css'
import { AudioPresets, Room, RoomEvent, Track, createLocalAudioTrack } from 'livekit-client'
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from 'firebase/storage'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState } from './firebase/auth'
import { getSiteAssetURL } from './firebase/siteAssets'
import { storage } from './firebase/storage'
import { getMyAccountPermissions } from './data/accountPermissionsService'
import {
  SEQUENCE_ASSET_CATEGORIES,
  addAssetToSequence,
  createSequence,
  createSequenceAssetShell,
  deleteSequenceItem,
  duplicateSequenceItem,
  formatMs,
  getSequence,
  listSequenceAssets,
  listSequenceItems,
  listSequences,
  moveSequenceItem,
  updateSequenceAsset,
  updateSequenceItem,
  uploadSequenceAssetFile
} from './data/musicSequenceService'
import {
  deleteMusicLiveSequenceItem,
  endMusicLiveStream,
  getMusicLiveStream,
  getMusicLiveViewerState,
  heartbeatMusicLiveStream,
  DEFAULT_HLS_EDGE_BASE_URL,
  DEFAULT_RTMP_INGEST_SERVER,
  isLiveStreamFresh,
  joinMusicLiveStream,
  leaveMusicLiveStream,
  listPublicLiveStreams,
  markMusicLiveStreamOnAir,
  normalizeMusicLiveTransportPayload,
  prepareMusicLiveStreamDraft,
  sendMusicLiveChatMessage,
  sendMusicLiveUnloadBeacon,
  setMusicLiveNowPlaying,
  startMusicLiveStream,
  subscribeMusicLiveChat,
  subscribeMusicLiveSequenceItems,
  subscribeMusicLiveStream,
  toggleMusicLiveReaction,
  toggleSaveMusicLiveStream,
  updateMusicLiveListenerPresence,
  upsertMusicLiveSequenceItem,
  updateMusicLiveStreamInfo
} from './data/musicLiveService'
import { getPublicPlaybackInfo, isExplicitFirebaseSegmentsPlayback, isPublicStreamPlayable } from './data/streaming/publicPlaybackService'
import {
  attachHlsStream,
  canPlayNativeHls,
  isAllowedHlsPlaybackUrl
} from './data/streaming/hlsEdgePlayer'
import { assertLiveKitConnectionConfig } from './data/streaming/livekitProvider'
import { startBrowserWebrtcIngest, stopBrowserWebrtcIngest } from './data/streaming/browserWebrtcIngest'
import { getNativePlaybackQueue, getNativePlaybackQueueDiagnostics } from './data/streaming/nativeStreamingProvider'
import {
  clearPlaybackDemand,
  nativeViewerSessionId,
  observeNativeHostPresence,
  updatePlaybackDemandState,
  writePlaybackDemand
} from './data/streaming/nativeStreamingPresence'
import {
  firebaseSegmentStreamingEnabled,
  isBufferedBroadcastProvider,
  isFirebaseSegmentProvider,
  STREAM_PROVIDERS
} from './data/streaming/streamingProviderTypes'
import {
  subscribeMyLiveStudioGuestInvite,
  updateLiveStudioGuestInviteStatus
} from './data/liveStudioGuestService'
import {
  getMusicRelease,
  listFeaturedArtists,
  listFeaturedMusicReleases,
  listNewMusicReleases,
  listPublishedMusicReleases,
  listRecentlyPlayed,
  listTracksForRelease,
  listUserLibraryMusic,
  searchMusic
} from './data/musicService'
import { ROUTES, authRoute, musicLiveStreamRoute, musicReleaseRoute, publicProfileRoute } from './utils/routes'

const app = document.querySelector('#app')
let musicMonitorVisualizerCleanup = null
let musicMonitorControlsTimer = 0
const SILENT_AUDIO_UNLOCK_SRC = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQQAAAAAAA=='
const HLS_PLAYBACK_MODE_STORAGE_KEY = 'melogic_live_playback_mode'
const HLS_PLAYBACK_MODES = new Set(['videoAudio', 'videoOnly', 'audioOnly'])

function sanitizeHlsStreamKey(value = '') {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || `melogic-${Date.now()}`
}

function getHlsEdgeBaseUrl() {
  return String(import.meta.env?.VITE_STREAM_EDGE_BASE_URL || DEFAULT_HLS_EDGE_BASE_URL).replace(/\/+$/, '')
}

function getRtmpIngestServer() {
  return String(import.meta.env?.VITE_STREAM_RTMP_INGEST_SERVER || DEFAULT_RTMP_INGEST_SERVER).replace(/\/+$/, '')
}

function normalizeHlsLivePayload(payload = {}) {
  return normalizeMusicLiveTransportPayload({
    ...payload,
    streamingProtocol: payload.streamingProtocol || state.goLive.form.streamingProtocol || 'hls'
  })
}

function storedHlsPlaybackMode() {
  try {
    const value = localStorage.getItem(HLS_PLAYBACK_MODE_STORAGE_KEY)
    return HLS_PLAYBACK_MODES.has(value) ? value : 'videoAudio'
  } catch {
    return 'videoAudio'
  }
}

const sidebarViews = {
  home: 'Home',
  new: 'New',
  radio: 'Radio',
  live: 'Live Streams',
  sequence: 'Sequence Software',
  search: 'Search',
  recentlyAdded: 'Recently Added',
  artists: 'Artists',
  albums: 'Albums',
  songs: 'Songs',
  musicVideos: 'Music Videos',
  madeForYou: 'Made for You',
  playlists: 'Playlists'
}

const libraryItems = [
  ['recentlyAdded', 'Recently Added'],
  ['artists', 'Artists'],
  ['albums', 'Albums'],
  ['songs', 'Songs'],
  ['musicVideos', 'Music Videos'],
  ['madeForYou', 'Made for You']
]

const stableImageCache = new Map()

const state = {
  currentUser: null,
  accountPermissions: null,
  accountPermissionsLoading: false,
  route: { mode: 'landing', id: '' },
  activeView: 'home',
  sidebarOpen: false,
  searchQuery: '',
  searchResults: [],
  searchLoading: false,
  rows: {
    featured: [],
    newest: [],
    staffPicks: [],
    rising: [],
    artists: [],
    recentlyPlayed: [],
    library: [],
    liveStreams: []
  },
  liveFilter: 'all',
  liveStream: null,
  liveStreamUnsubscribe: null,
  liveListRefreshTimer: 0,
  liveStatus: 'idle',
  liveError: '',
  listenerRoom: null,
  listenerAudioElement: null,
  listenerVideoElement: null,
  listenerPresenceId: '',
  hlsMediaElement: null,
  hlsCleanup: null,
  hlsAttachedUrl: '',
  hlsPlaybackMode: storedHlsPlaybackMode(),
  hlsDiagnostics: {},
  nativeViewerSessionId: '',
  nativeHostUnsubscribe: null,
  nativePlaybackTimer: 0,
  nativePlaybackQueue: [],
  nativePlaybackNextIndex: null,
  nativeMediaSource: null,
  nativeMediaSourceUrl: '',
  nativeMediaSourceStreamId: '',
  nativeSourceBuffer: null,
  nativeAppendQueue: [],
  nativeQueuedSegmentIndexes: new Set(),
  nativeAppendedSegmentIndexes: new Set(),
  nativeSegmentFetches: new Set(),
  nativeSelectedSourceBufferMime: '',
  nativeListenerDiagnostics: {},
  listenerPresenceTimer: 0,
  liveMonitor: {
    muted: true
  },
  liveVideoExpanded: false,
  livePassword: '',
  liveActionMessage: '',
  liveViewer: {
    reaction: 'none',
    saved: false,
    loading: false
  },
  guestInvite: null,
  guestInviteUnsubscribe: null,
  guestSetupOpen: false,
  guestSetupStatus: '',
  liveChat: {
    messages: [],
    text: '',
    sending: false,
    error: '',
    unsubscribe: null,
    lastSentAt: 0
  },
  liveSequence: {
    items: [],
    unsubscribe: null,
    editingItemId: '',
    form: { title: '', artist: '', album: '', artworkURL: '', notes: '' },
    saving: false,
    error: '',
    studioMode: false,
    previewItemId: ''
  },
  goLive: {
    form: {
      category: 'music',
      audioMode: 'music',
      inputSource: 'browser',
      sequenceId: '',
      accessMode: 'public',
      password: '',
      title: '',
      description: '',
      coverArtURL: '',
      coverArtPath: '',
      coverArtSource: 'fallback',
      tags: '',
      visibility: 'public',
      streamingProtocol: 'hls',
      streamingMethod: 'obsRtmp',
      streamKey: 'obsfix1',
      rightsAccepted: false,
      archiveRequested: false
    },
    draftId: '',
    draftStreamId: '',
    activeControl: 'details',
    uploadingCover: false,
    devices: [],
    selectedDeviceId: '',
    previewStream: null,
    previewAudioContext: null,
    meterAnalyser: null,
    meterAnimationId: 0,
    level: 0,
    muted: false,
    connectionStatus: '',
    streamId: '',
    room: null,
    browserIngestActive: false,
    localTrack: null,
    heartbeatTimer: 0,
    unloadToken: '',
    editOpen: false,
    editSaving: false,
    editError: '',
    starting: false,
    ending: false,
    formError: ''
  },
  sequenceWorkspace: {
    assets: [],
    sequences: [],
    activeSequence: null,
    items: [],
    selectedAssetId: '',
    selectedItemId: '',
    search: '',
    filterType: 'all',
    filterCategory: 'all',
    filterStatus: 'all',
    sort: 'created_desc',
    loading: false,
    uploadStatus: '',
    error: '',
    newSequenceTitle: '',
    videoAudioMode: 'use_video_audio',
    playback: {
      context: null,
      masterGain: null,
      destination: null,
      currentAudio: null,
      currentSource: null,
      currentGain: null,
      nextAudio: null,
      nextItemId: '',
      currentItemId: '',
      timer: 0,
      playing: false,
      paused: false,
      autoplay: true,
      loop: false,
      shuffle: false,
      stopAfterItem: false,
      repeatItem: false,
      skipDisabled: true,
      monitor: true,
      transitionPreviewAudios: [],
      transitionPreviewTimer: 0,
      transitionPreviewInterval: 0,
      previewingTransition: false,
      outputTrack: null
    }
  },
  release: null,
  tracks: [],
  loading: true,
  error: '',
  player: {
    track: null,
    audio: null,
    playing: false,
    currentTime: 0,
    duration: 0,
    volume: 0.85
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function titleCase(value = '') {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase())
}

function initialsFor(value = '') {
  const parts = String(value || 'Melogic Creator').trim().split(/\s+/).filter(Boolean)
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : (parts[0] || 'M').slice(0, 2)).toUpperCase()
}

function formatDate(value = '') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Release date coming soon'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function formatDuration(seconds = 0) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  if (!total) return '0:00'
  const minutes = Math.floor(total / 60)
  const remainder = String(total % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function currentRouteMode() {
  const path = window.location.pathname
  const liveMonitorMatch = path.match(/^\/music\/live\/([^/]+)\/monitor$/)
  const liveMatch = path.match(/^\/music\/live\/([^/]+)$/)
  if (liveMonitorMatch) return { mode: 'liveMonitor', id: decodeURIComponent(liveMonitorMatch[1]) }
  if (liveMatch) return { mode: 'liveDetail', id: decodeURIComponent(liveMatch[1]) }
  if (path === '/music/live') return { mode: 'liveList', id: '' }
  if (path === '/music/go-live') {
    window.history.replaceState({}, '', ROUTES.musicLive)
    return { mode: 'liveList', id: '' }
  }
  const sequenceMatch = path.match(/^\/music\/sequence\/?([^/]*)/)
  if (sequenceMatch) return { mode: 'sequence', id: decodeURIComponent(sequenceMatch[1] || '') }
  const releaseMatch = path.match(/^\/music\/releases\/([^/]+)/)
  return releaseMatch ? { mode: 'release', id: decodeURIComponent(releaseMatch[1]) } : { mode: 'landing', id: '' }
}

function getInitialView() {
  const hashView = String(window.location.hash || '').replace(/^#/, '')
  return sidebarViews[hashView] ? hashView : 'home'
}

function allPublicReleases() {
  const map = new Map()
  ;[
    ...state.rows.featured,
    ...state.rows.staffPicks,
    ...state.rows.newest,
    ...state.rows.rising
  ].forEach((release) => {
    if (release?.id) map.set(release.id, release)
  })
  return Array.from(map.values())
}

function genreList() {
  const discovered = new Set()
  allPublicReleases().forEach((release) => {
    if (release.genre) discovered.add(release.genre)
    ;(release.moods || []).slice(0, 2).forEach((mood) => discovered.add(mood))
  })
  return Array.from(discovered).slice(0, 10)
}

function renderReleaseArtwork(release, className = 'music-release-art') {
  const cover = release?.coverArtURL || ''
  if (cover) return `<img class="${className}" src="${escapeHtml(cover)}" alt="${escapeHtml(release.title)} cover art" loading="lazy" />`
  return `<div class="${className} music-release-art-fallback" aria-hidden="true"><span>MR</span></div>`
}

function normalizeImageSrc(src = '', key = '') {
  const raw = String(src || '').trim()
  if (!raw) return ''
  if (/^(data:image\/|blob:)/i.test(raw)) return raw
  try {
    const parsed = new URL(raw, window.location.origin)
    if (!['https:', 'http:'].includes(parsed.protocol)) return ''
    if (parsed.protocol === 'http:' && parsed.hostname !== window.location.hostname) return ''
    return parsed.href
  } catch (error) {
    if (import.meta.env?.DEV) console.warn('[music:image] invalid image URL', { key, reason: error?.message || 'parse_failed' })
    return ''
  }
}

function renderStableImage({ src = '', alt = '', className = '', fallback = 'MR', key = '' } = {}) {
  const cleanSrc = normalizeImageSrc(src, key)
  const logicalKey = key || cleanSrc
  const keyed = logicalKey ? stableImageCache.get(`key:${logicalKey}`) : null
  const failed = cleanSrc && stableImageCache.get(cleanSrc) === 'failed'
  const loaded = cleanSrc && stableImageCache.get(cleanSrc) === 'loaded'
  const displaySrc = loaded ? cleanSrc : (keyed?.lastGoodSrc || '')
  return `
    <span class="${escapeHtml(className)} music-stable-image ${displaySrc ? 'is-loaded' : ''} ${failed || (!cleanSrc && !displaySrc) ? 'is-fallback' : ''}" ${cleanSrc ? `data-stable-image data-src="${escapeHtml(cleanSrc)}" data-alt="${escapeHtml(alt)}" data-image-key="${escapeHtml(logicalKey)}"` : ''}>
      ${displaySrc ? `<img src="${escapeHtml(displaySrc)}" alt="${escapeHtml(alt)}" loading="lazy" />` : ''}
      <span class="music-stable-fallback" aria-hidden="true">${escapeHtml(fallback)}</span>
    </span>
  `
}

function renderLiveArtwork(stream, className = 'music-live-art') {
  const cover = stream?.coverArtURL || ''
  return renderStableImage({
    src: cover,
    alt: `${stream?.title || 'Live stream'} cover art`,
    className: `${className} music-live-art-fallback music-live-art-with-image`,
    fallback: 'LIVE',
    key: `live-cover-${stream?.id || stream?.streamId || stream?.title || cover}`
  })
}

function renderAvatarImage({ src = '', name = '', className = 'music-avatar' } = {}) {
  return renderStableImage({
    src,
    alt: name ? `${name} profile image` : 'Profile image',
    className,
    fallback: initialsFor(name),
    key: `avatar-${name || src}`
  })
}

function renderArtistArtwork(artist) {
  const image = artist?.avatarURL || artist?.photoURL || ''
  if (image) return `<img class="music-artist-art" src="${escapeHtml(image)}" alt="${escapeHtml(artist.artistName)} profile image" loading="lazy" />`
  return `<div class="music-artist-art music-artist-art-fallback" aria-hidden="true">${escapeHtml(String(artist.artistName || 'A').slice(0, 1).toUpperCase())}</div>`
}

function releaseCard(release, options = {}) {
  const tags = [release.genre, ...(release.moods || []), ...(release.tags || [])].filter(Boolean).slice(0, 2)
  const playable = Boolean(release.streamAudioURL)
  return `
    <article class="music-release-card">
      <a class="music-release-card-link" href="${musicReleaseRoute(release)}" aria-label="Open ${escapeHtml(release.title)}">
        ${renderReleaseArtwork(release)}
        <div class="music-release-card-body">
          <div class="music-release-card-meta">
            <span>${escapeHtml(titleCase(release.releaseType || 'release'))}</span>
            ${release.explicit ? '<span class="music-explicit-badge">E</span>' : ''}
          </div>
          <h3>${escapeHtml(release.title)}</h3>
          <p>by ${escapeHtml(release.artistName)}</p>
          <div class="music-tag-row">${tags.length ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('') : '<span>Melogic Music</span>'}</div>
        </div>
      </a>
      <div class="music-release-card-actions">
        <button type="button" class="music-icon-button" data-play-release="${escapeHtml(release.id)}" ${playable ? '' : 'disabled'} title="${playable ? 'Play preview stream' : 'Open release to play tracks'}">Play</button>
        <a class="music-icon-link" href="${musicReleaseRoute(release)}">${options.openLabel || 'Open'}</a>
      </div>
    </article>
  `
}

function artistCard(artist) {
  const count = artist.listenerCount || artist.followerCount
  const label = artist.listenerCount ? 'listeners' : 'followers'
  return `
    <article class="music-artist-card">
      ${renderArtistArtwork(artist)}
      <h3>${escapeHtml(artist.artistName)}</h3>
      <p>${escapeHtml(artist.musicGenre || artist.roleLabel || 'Artist')}</p>
      <span>${count ? `${count.toLocaleString()} ${label}` : 'Melogic artist'}</span>
      <a class="music-icon-link" href="${publicProfileRoute({ uid: artist.uid })}">Profile</a>
    </article>
  `
}

function emptyState(title, body, action = '') {
  return `
    <article class="music-empty-state">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(body)}</p>
      ${action}
    </article>
  `
}

function carouselRow({ id, eyebrow, title, items = [], type = 'release', emptyTitle = 'Nothing here yet', emptyBody = 'This row will fill in as music becomes available.' }) {
  const cards = type === 'artist'
    ? items.map(artistCard).join('')
    : type === 'live'
      ? items.map(liveStreamCard).join('')
      : items.map((item) => releaseCard(item)).join('')
  return `
    <section class="music-row-section" id="${escapeHtml(id)}">
      <div class="music-row-heading">
        <div>
          <p class="music-eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(title)}</h2>
        </div>
        <div class="music-row-controls" aria-label="${escapeHtml(title)} row controls">
          <button type="button" data-row-scroll="${escapeHtml(id)}" data-direction="-1" aria-label="Scroll ${escapeHtml(title)} left">‹</button>
          <button type="button" data-row-scroll="${escapeHtml(id)}" data-direction="1" aria-label="Scroll ${escapeHtml(title)} right">›</button>
        </div>
      </div>
      ${items.length ? `<div class="music-carousel" data-carousel="${escapeHtml(id)}">${cards}</div>` : emptyState(emptyTitle, emptyBody)}
    </section>
  `
}

function renderSidebar() {
  const active = state.activeView
  const navButton = (view, label) => `<button type="button" class="${active === view ? 'is-active' : ''}" data-music-view="${view}" ${active === view ? 'aria-current="page"' : ''}>${escapeHtml(label)}</button>`
  return `
    <aside class="music-sidebar ${state.sidebarOpen ? 'is-open' : ''}" data-music-sidebar>
      <div class="music-sidebar-title">
        <strong>Melogic Music</strong>
        <span>Public discovery</span>
      </div>
      <nav class="music-sidebar-nav" aria-label="Melogic Music sections">
        <section>
          <p>Browse</p>
          ${navButton('home', 'Home')}
          ${navButton('new', 'New')}
          ${navButton('radio', 'Radio')}
          ${navButton('live', 'Live Streams')}
          ${navButton('search', 'Search')}
        </section>
        <details open>
          <summary>Library</summary>
          ${libraryItems.map(([view, label]) => navButton(view, label)).join('')}
        </details>
        <details open>
          <summary>Playlists</summary>
          ${navButton('playlists', 'Playlists')}
          <div class="music-sidebar-note">${state.currentUser ? 'No playlists yet' : 'Sign in to see playlists'}</div>
        </details>
      </nav>
    </aside>
  `
}

function renderHero() {
  const uploadHref = state.currentUser ? ROUTES.newProduct : authRoute({ redirect: ROUTES.newProduct })
  const releaseCount = allPublicReleases().length
  return `
    <section class="music-app-hero" data-music-hero>
      <video class="music-hero-video" data-music-hero-video muted loop playsinline autoplay preload="metadata" aria-hidden="true"></video>
      <div class="music-hero-overlay" aria-hidden="true"></div>
      <div class="music-app-hero-content">
        <p class="music-eyebrow">Melogic Records</p>
        <h1>Melogic Music</h1>
        <p>Discover releases from creators on Melogic Records.</p>
        <div class="music-hero-actions">
          <a class="button button-accent" href="#featured-music">Explore Music</a>
          <a class="button button-muted" href="${uploadHref}">Submit Music</a>
        </div>
      </div>
      <div class="music-hero-stat">
        <span>Published releases</span>
        <strong>${releaseCount}</strong>
      </div>
    </section>
  `
}

function renderHomeView() {
  const featured = state.rows.featured.length ? state.rows.featured : state.rows.staffPicks
  const genres = genreList()
  return `
    ${renderHero()}
    ${carouselRow({
      id: 'top-picks',
      eyebrow: state.currentUser ? 'Top Picks for You' : 'Staff Picks',
      title: state.currentUser ? 'Start with these releases' : 'Featured music to start with',
      items: featured,
      emptyTitle: 'Music discovery is warming up.',
      emptyBody: 'Approved public releases will appear here as creators publish on Melogic Records.'
    })}
    ${carouselRow({
      id: 'recently-played',
      eyebrow: 'Recently Played',
      title: 'Pick up where you left off',
      items: state.rows.recentlyPlayed,
      emptyTitle: 'No recent plays yet',
      emptyBody: 'Play music on Melogic and your recent tracks will appear here.'
    })}
    ${carouselRow({ id: 'live-now', eyebrow: 'Live Streams', title: 'On air now', items: state.rows.liveStreams, type: 'live', emptyTitle: 'No live streams right now', emptyBody: 'Live streams started from Studio Live will appear here.' })}
    ${carouselRow({ id: 'featured-music', eyebrow: 'Featured Music', title: 'Featured releases', items: state.rows.featured })}
    ${carouselRow({ id: 'featured-artists', eyebrow: 'Featured Artists', title: 'Creators to watch', items: state.rows.artists, type: 'artist', emptyTitle: 'Featured artists are coming soon', emptyBody: 'Artist rows will appear as public profiles are marked for Melogic Music.' })}
    ${carouselRow({ id: 'new-releases', eyebrow: 'New on Melogic', title: 'Fresh public releases', items: state.rows.newest, emptyTitle: 'No new releases yet', emptyBody: 'New public releases will appear here after approval.' })}
    ${carouselRow({ id: 'staff-picks', eyebrow: 'Staff Picks', title: 'Selected for discovery', items: state.rows.staffPicks })}
    ${carouselRow({ id: 'rising-creators', eyebrow: 'Rising Creators', title: 'Momentum builders', items: state.rows.rising })}
    <section class="music-row-section">
      <div class="music-row-heading">
        <div>
          <p class="music-eyebrow">Genres / Moods</p>
          <h2>Find a lane</h2>
        </div>
      </div>
      <div class="music-genre-cloud">${(genres.length ? genres : ['Electronic', 'Hip-Hop', 'Pop', 'Rock', 'Cinematic', 'Ambient', 'Bass', 'Indie']).map((genre) => `<button type="button" data-search-genre="${escapeHtml(genre)}">${escapeHtml(genre)}</button>`).join('')}</div>
    </section>
    <section class="music-how-compact">
      <p class="music-eyebrow">How Melogic Music works</p>
      <div class="music-how-grid">
        <article><strong>Approved public releases</strong><span>Creators publish music after review.</span></article>
        <article><strong>Prepared stream files</strong><span>Playback uses stream audio, not private masters.</span></article>
        <article><strong>Creator infrastructure</strong><span>Discovery connects profiles, releases, and future music tools.</span></article>
      </div>
    </section>
  `
}

function renderNewView() {
  return `
    <section class="music-view-header">
      <p class="music-eyebrow">New</p>
      <h1>New on Melogic</h1>
      <p>Newest public releases from Melogic Records creators.</p>
    </section>
    ${carouselRow({ id: 'new-view-releases', eyebrow: 'Latest', title: 'Newest releases', items: state.rows.newest, emptyTitle: 'No new releases yet', emptyBody: 'Published public releases will appear here.' })}
  `
}

function renderRadioView() {
  const stationCards = ['Melogic Picks', 'New Creators', 'Genre Stations', 'Artist Radio']
  return `
    <section class="music-view-header">
      <p class="music-eyebrow">Radio</p>
      <h1>Melogic Radio</h1>
      <p>Radio stations are being prepared. Live audio broadcasts are available now in Live Streams.</p>
      <a class="button button-accent" href="${ROUTES.musicLive}">Open Live Streams</a>
    </section>
    <div class="music-station-grid">
      ${stationCards.map((station) => `<article class="music-station-card"><strong>${escapeHtml(station)}</strong><span>Coming soon</span></article>`).join('')}
    </div>
  `
}

function liveCategoryLabel(value = '') {
  return titleCase(String(value || 'music'))
}

function liveAccessLabel(streamOrForm = {}) {
  const access = streamOrForm.accessMode || streamOrForm.visibility || 'public'
  if (access === 'password') return 'Password protected'
  return titleCase(access)
}

function listenerCountLabel(count = 0) {
  const value = Number(count || 0)
  return `${value.toLocaleString()} ${value === 1 ? 'listening' : 'listening'}`
}

function liveShareURL(streamId = '') {
  return `${window.location.origin}${musicLiveStreamRoute(streamId)}`
}

function musicLiveMonitorRoute(streamId = '') {
  return `${musicLiveStreamRoute(streamId)}/monitor`
}

function renderNowPlaying(stream = {}) {
  const now = nowPlayingDisplay(stream)
  return `
    <article class="music-now-playing">
      ${renderStableImage({ src: now.artworkURL, alt: '', className: 'music-now-playing-art', fallback: 'NP', key: `now-${stream.id || stream.streamId || ''}` })}
      <div>
        <p class="music-eyebrow">Now Playing</p>
        <h3>${escapeHtml(now.title)}</h3>
        <p>${escapeHtml([now.artist, now.album].filter(Boolean).join(' · '))}</p>
      </div>
    </article>
  `
}

function liveStreamCard(stream) {
  const liveBadge = nativeLiveStatusLabel(stream)
  return `
    <article class="music-live-card">
      <a href="${musicLiveStreamRoute(stream)}" class="music-live-card-link">
        ${renderLiveArtwork(stream)}
        <div class="music-live-card-body">
          <span class="music-live-badge ${isFirebaseSegmentProvider(stream.provider) ? 'is-native' : ''}">${escapeHtml(liveBadge)}</span>
          ${stream.passwordProtected ? '<span class="music-live-lock">Locked</span>' : ''}
          <h3>${escapeHtml(stream.title)}</h3>
          <p>${escapeHtml(stream.hostDisplayName)}</p>
          <div class="music-live-meta">
            <span>${escapeHtml(liveCategoryLabel(stream.category))}</span>
            <span>${escapeHtml(listenerCountLabel(stream.listenerCount))}</span>
          </div>
        </div>
      </a>
      <a class="music-icon-link" href="${musicLiveStreamRoute(stream)}">Listen</a>
    </article>
  `
}

function renderLiveStreamsView() {
  const categories = [
    ['all', 'All'],
    ['music', 'Music'],
    ['radio', 'Radio'],
    ['podcast', 'Podcasts'],
    ['interview', 'Interviews']
  ]
  const streams = state.liveFilter === 'all'
    ? state.rows.liveStreams
    : state.rows.liveStreams.filter((stream) => stream.category === state.liveFilter)
  return `
    <section class="music-view-header music-live-header">
      <div>
        <p class="music-eyebrow">Live Streams</p>
        <h1>Live Streams</h1>
        <p>Live audio and video broadcasts from Melogic creators.</p>
      </div>
    </section>
    <div class="music-live-tabs">
      ${categories.map(([value, label]) => `<button type="button" class="${state.liveFilter === value ? 'is-active' : ''}" data-live-filter="${value}">${escapeHtml(label)}</button>`).join('')}
    </div>
    ${streams.length ? `<div class="music-live-grid">${streams.map(liveStreamCard).join('')}</div>` : emptyState('No live streams right now.', 'When eligible creators go live, their public audio streams will appear here.')}
  `
}

function sequenceAssetMatches(asset = {}) {
  const workspace = state.sequenceWorkspace
  if (workspace.filterType !== 'all' && asset.type !== workspace.filterType) return false
  if (workspace.filterCategory !== 'all' && asset.category !== workspace.filterCategory) return false
  if (workspace.filterStatus !== 'all' && asset.status !== workspace.filterStatus) return false
  const search = workspace.search.trim().toLowerCase()
  if (!search) return true
  return [asset.title, asset.artist, asset.album, asset.originalFileName, asset.tags?.join(' '), asset.notes]
    .join(' ')
    .toLowerCase()
    .includes(search)
}

function renderSequenceAssetLibrary() {
  const workspace = state.sequenceWorkspace
  const assets = workspace.assets.filter(sequenceAssetMatches)
  return `
    <aside class="music-panel music-sequence-library">
      <div class="music-row-heading">
        <div>
          <p class="music-eyebrow">Asset Library</p>
          <h2>Sequence Assets</h2>
        </div>
        <div class="music-sequence-upload-actions">
          <label class="button button-muted music-upload-button">
            <input type="file" accept="audio/*" data-sequence-asset-upload />
            Upload Audio
          </label>
          <label class="button button-muted music-upload-button">
            <input type="file" accept="video/*" data-sequence-asset-upload />
            Add Video
          </label>
        </div>
      </div>
      <form class="music-sequence-upload-fields" data-sequence-upload-fields>
        <input name="title" maxlength="160" placeholder="Title override" />
        <input name="artist" maxlength="160" placeholder="Artist" />
        <select name="category">${SEQUENCE_ASSET_CATEGORIES.map((category) => `<option value="${category}">${escapeHtml(titleCase(category))}</option>`).join('')}</select>
        <select name="videoAudioMode">
          <option value="use_video_audio">Video: use video audio</option>
          <option value="separate_audio">Video: upload separate audio</option>
          <option value="no_audio">Video: metadata only / no audio</option>
        </select>
        <input name="separateAudioFile" type="file" accept="audio/*" />
      </form>
      <div class="music-sequence-filters">
        <input type="search" data-sequence-search value="${escapeHtml(workspace.search)}" placeholder="Search title, artist, album, filename, tags..." />
        <select data-sequence-filter-type>
          ${['all', 'audio', 'video', 'metadata_only'].map((value) => `<option value="${value}" ${workspace.filterType === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'All types' : titleCase(value))}</option>`).join('')}
        </select>
        <select data-sequence-filter-category>
          ${['all', ...SEQUENCE_ASSET_CATEGORIES].map((value) => `<option value="${value}" ${workspace.filterCategory === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'All categories' : titleCase(value))}</option>`).join('')}
        </select>
        <select data-sequence-filter-status>
          ${['all', 'ready', 'processing', 'failed'].map((value) => `<option value="${value}" ${workspace.filterStatus === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'All statuses' : titleCase(value))}</option>`).join('')}
        </select>
        <select data-sequence-sort>
          ${[
            ['created_desc', 'Date added newest'],
            ['created_asc', 'Date added oldest'],
            ['updated_desc', 'Date edited newest'],
            ['title_asc', 'Title A-Z'],
            ['artist_asc', 'Artist A-Z'],
            ['duration_asc', 'Duration shortest'],
            ['duration_desc', 'Duration longest'],
            ['used_desc', 'Recently used']
          ].map(([value, label]) => `<option value="${value}" ${workspace.sort === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </div>
      ${workspace.uploadStatus ? `<p class="music-muted">${escapeHtml(workspace.uploadStatus)}</p>` : ''}
      ${workspace.error ? `<p class="music-live-error">${escapeHtml(workspace.error)}</p>` : ''}
      <div class="music-sequence-asset-list">
        ${assets.length ? assets.map((asset) => `
          <article class="music-sequence-asset-row ${workspace.selectedAssetId === asset.assetId ? 'is-selected' : ''}">
            ${renderStableImage({ src: asset.artworkURL, alt: '', className: 'music-sequence-art', fallback: asset.type === 'video' ? 'VID' : 'AUD', key: `asset-${asset.assetId}` })}
            <div>
              <strong>${escapeHtml(asset.title)}</strong>
              <span>${escapeHtml([asset.artist, asset.album].filter(Boolean).join(' · ') || asset.originalFileName || 'Sequence asset')}</span>
            </div>
            <span>${escapeHtml(titleCase(asset.category))}</span>
            <span>${escapeHtml(formatMs(asset.durationMs))}</span>
            <span class="music-sequence-status">${escapeHtml(titleCase(asset.status))}</span>
            <button type="button" class="button button-muted" data-sequence-add-asset="${escapeHtml(asset.assetId)}" ${asset.status === 'ready' && asset.normalizedAudioURL ? '' : 'disabled'}>Add</button>
          </article>
        `).join('') : '<p class="music-muted">Upload audio or video assets to build a reusable automation library.</p>'}
      </div>
    </aside>
  `
}

function renderSequenceRows() {
  const workspace = state.sequenceWorkspace
  const playback = workspace.playback
  return `
    <div class="music-automation-table" role="table" aria-label="Sequence playout log">
      <div class="music-automation-row is-header" role="row">
        <span>Status</span><span>Art</span><span>Title</span><span>Artist</span><span>Album</span><span>Category</span><span>Media</span><span>Dur</span><span>Fade In</span><span>Fade Out</span><span>Xfade</span><span>File</span><span>Actions</span>
      </div>
      ${workspace.items.length ? workspace.items.map((item, index) => {
        const isPlaying = playback.currentItemId === item.itemId
        const isNext = playback.nextItemId === item.itemId
        return `
          <article class="music-automation-row ${isPlaying ? 'is-playing' : ''} ${isNext ? 'is-next' : ''} ${workspace.selectedItemId === item.itemId ? 'is-selected' : ''}" data-sequence-item-row="${escapeHtml(item.itemId)}" role="row">
            <span>${isPlaying ? 'On Air' : isNext ? 'Next' : item.enabled ? String(index + 1) : 'Off'}</span>
            ${renderStableImage({ src: item.artworkURLSnapshot, alt: '', className: 'music-sequence-art', fallback: 'NP', key: `row-${item.itemId}` })}
            <strong>${escapeHtml(item.titleSnapshot)}</strong>
            <span>${escapeHtml(item.artistSnapshot || '-')}</span>
            <span>${escapeHtml(item.albumSnapshot || '-')}</span>
            <span>${escapeHtml(titleCase(item.categorySnapshot || item.type))}</span>
            <span>${escapeHtml(item.type === 'video' ? 'Video audio' : titleCase(item.type))}</span>
            <span>${escapeHtml(formatMs(item.durationMs))}</span>
            <input type="number" min="0" step="100" value="${item.fadeInMs}" data-sequence-item-field="${escapeHtml(item.itemId)}" data-field="fadeInMs" />
            <input type="number" min="0" step="100" value="${item.fadeOutMs}" data-sequence-item-field="${escapeHtml(item.itemId)}" data-field="fadeOutMs" />
            <input type="number" min="0" step="100" value="${item.crossfadeMs}" data-sequence-item-field="${escapeHtml(item.itemId)}" data-field="crossfadeMs" />
            <span class="music-sequence-status">${item.normalizedAudioURLSnapshot ? 'Ready' : 'Missing'}</span>
            <span class="music-automation-actions">
              <button type="button" class="button button-muted" data-sequence-preview-item="${escapeHtml(item.itemId)}">Preview</button>
              <button type="button" class="button button-muted" data-sequence-cue-item="${escapeHtml(item.itemId)}">Cue</button>
              <button type="button" class="button button-muted" data-sequence-set-next="${escapeHtml(item.itemId)}">Set Next</button>
              <button type="button" class="button button-muted" data-sequence-duplicate-item="${escapeHtml(item.itemId)}">Duplicate</button>
              <button type="button" class="button button-muted" data-sequence-move="${escapeHtml(item.itemId)}" data-direction="-1">Up</button>
              <button type="button" class="button button-muted" data-sequence-move="${escapeHtml(item.itemId)}" data-direction="1">Down</button>
              <button type="button" class="button button-danger" data-sequence-remove-item="${escapeHtml(item.itemId)}">Remove</button>
            </span>
          </article>
        `
      }).join('') : '<p class="music-muted">Add ready assets to this sequence to build a playout log.</p>'}
    </div>
  `
}

function renderSequenceWorkspacePage() {
  const signedIn = Boolean(state.currentUser)
  const workspace = state.sequenceWorkspace
  const playback = workspace.playback
  renderAppShell(`
    <section class="music-view-header music-live-header">
      <div>
        <p class="music-eyebrow">Radio automation</p>
        <h1>Sequence Software</h1>
        <p>Upload normalized account assets, build dense playout logs, and feed sequence output into Melogic Music Live.</p>
      </div>
      <a class="button button-accent" href="${ROUTES.studioLive}?panel=sequence">Open Live Studio</a>
    </section>
    ${signedIn ? '' : emptyState('Sign in required', 'The Sequence Software workspace is visible here. Sign in to upload assets, save sequences, and publish sequence output into Live Streams.', `<a class="button button-accent" href="${authRoute({ redirect: ROUTES.musicSequence })}">Sign In</a>`)}
    <section class="music-sequence-workspace">
      ${renderSequenceAssetLibrary()}
      <section class="music-panel music-sequence-playout">
        <div class="music-row-heading">
          <div>
            <p class="music-eyebrow">Playout Log</p>
            <h2>${escapeHtml(workspace.activeSequence?.title || 'Sequence')}</h2>
          </div>
          <div class="music-live-actions">
            <select data-active-sequence-select>
              ${workspace.sequences.map((sequence) => `<option value="${escapeHtml(sequence.sequenceId)}" ${workspace.activeSequence?.sequenceId === sequence.sequenceId ? 'selected' : ''}>${escapeHtml(sequence.title)}</option>`).join('')}
            </select>
            <input data-new-sequence-title value="${escapeHtml(workspace.newSequenceTitle)}" placeholder="New sequence title" />
            <button type="button" class="button button-muted" data-create-sequence>Create Sequence</button>
          </div>
        </div>
        <div class="music-playout-transport">
          <button type="button" class="button button-accent" data-sequence-play>${playback.playing ? 'Playing' : 'Play'}</button>
          <button type="button" class="button button-muted" data-sequence-pause>${playback.paused ? 'Resume' : 'Pause'}</button>
          <button type="button" class="button button-muted" data-sequence-stop>Stop</button>
          <button type="button" class="button button-muted" data-sequence-previous>Previous</button>
          <button type="button" class="button button-muted" data-sequence-next>Next</button>
          <button type="button" class="button button-muted ${playback.previewingTransition ? 'is-active' : ''}" data-sequence-preview-transition>Preview Transition</button>
          <button type="button" class="button button-muted" data-sequence-cue-selected>Cue Selected</button>
          <button type="button" class="button button-muted" data-sequence-set-selected-next>Set Selected as Next</button>
          <button type="button" class="button button-muted ${playback.autoplay ? 'is-active' : ''}" data-sequence-toggle="autoplay">Autoplay</button>
          <button type="button" class="button button-muted ${playback.loop ? 'is-active' : ''}" data-sequence-toggle="loop">Loop</button>
          <button type="button" class="button button-muted ${playback.shuffle ? 'is-active' : ''}" data-sequence-toggle="shuffle">Shuffle</button>
          <button type="button" class="button button-muted ${playback.repeatItem ? 'is-active' : ''}" data-sequence-toggle="repeatItem">Repeat item</button>
          <button type="button" class="button button-muted ${playback.skipDisabled ? 'is-active' : ''}" data-sequence-toggle="skipDisabled">Skip disabled</button>
          <button type="button" class="button button-muted ${playback.stopAfterItem ? 'is-active' : ''}" data-sequence-toggle="stopAfterItem">Stop after item</button>
          <button type="button" class="button button-muted ${playback.monitor ? 'is-active' : ''}" data-sequence-toggle="monitor">Monitor</button>
        </div>
        <div class="music-automation-status">
          <span>Current: ${escapeHtml(workspace.items.find((item) => item.itemId === playback.currentItemId)?.titleSnapshot || 'None')}</span>
          <span>Next: ${escapeHtml(workspace.items.find((item) => item.itemId === playback.nextItemId)?.titleSnapshot || 'Not cued')}</span>
          <span>Mode: ${playback.autoplay ? 'Autoplay' : 'Manual Assist'}</span>
          <span>${playback.previewingTransition ? 'Local transition preview active' : 'Preview is local monitor only'}</span>
        </div>
        ${renderSequenceRows()}
      </section>
    </section>
  `)
}

function renderSearchView() {
  return `
    <section class="music-view-header">
      <p class="music-eyebrow">Search</p>
      <h1>Search Melogic Music</h1>
      <form class="music-search-form" data-music-search-form>
        <input type="search" name="q" value="${escapeHtml(state.searchQuery)}" placeholder="Search releases, artists, genres, or moods" autocomplete="off" />
        <button class="button button-accent" type="submit">Search</button>
      </form>
    </section>
    ${state.searchLoading ? '<div class="music-card-grid"><article class="music-release-card music-card-skeleton" aria-hidden="true"></article><article class="music-release-card music-card-skeleton" aria-hidden="true"></article></div>' : ''}
    ${state.searchQuery && !state.searchLoading
      ? carouselRow({ id: 'search-results', eyebrow: 'Results', title: `Results for "${state.searchQuery}"`, items: state.searchResults, emptyTitle: 'No matching music yet', emptyBody: 'Try another title, artist, genre, or mood.' })
      : emptyState('Search is ready', 'Enter a query to search indexed public Melogic Music releases.')}
  `
}

function signInAction(body = 'Sign in to build your Melogic Music library.') {
  return emptyState('Sign in required', body, `<a class="button button-accent" href="${authRoute({ redirect: ROUTES.music })}">Sign In</a>`)
}

function renderLibraryView() {
  if (!state.currentUser) return signInAction('Your saved releases, artists, songs, and playlists will live here.')
  if (state.activeView === 'musicVideos') {
    return emptyState('Music videos are being shaped', 'Video release models will appear here once Melogic Music supports public music videos.')
  }
  if (state.activeView === 'madeForYou') {
    return emptyState('Made for You is being prepared', 'Personalized mixes will appear after enough listening and save activity exists.')
  }
  if (state.activeView === 'artists') {
    return carouselRow({ id: 'library-artists', eyebrow: 'Library', title: 'Saved artists', items: state.rows.library, type: 'artist', emptyTitle: 'No saved artists yet', emptyBody: 'Artists you save will appear here.' })
  }
  const label = sidebarViews[state.activeView] || 'Library'
  return carouselRow({ id: 'library-releases', eyebrow: 'Library', title: label, items: state.rows.library, emptyTitle: `No ${label.toLowerCase()} yet`, emptyBody: 'Saved music will appear here as you build your library.' })
}

function renderPlaylistsView() {
  if (!state.currentUser) return signInAction('Sign in to see playlists.')
  return emptyState('No playlists yet', 'Playlist creation is not enabled in this foundation pass.', '<button class="button button-muted" type="button" disabled>Create Playlist</button>')
}

function renderActiveView() {
  if (state.loading) {
    return `
      ${renderHero()}
      <div class="music-card-grid">
        ${Array.from({ length: 6 }).map(() => '<article class="music-release-card music-card-skeleton" aria-hidden="true"></article>').join('')}
      </div>
    `
  }
  if (state.activeView === 'new') return renderNewView()
  if (state.activeView === 'radio') return renderRadioView()
  if (state.activeView === 'live') return renderLiveStreamsView()
  if (state.activeView === 'search') return renderSearchView()
  if (state.activeView === 'playlists') return renderPlaylistsView()
  if (libraryItems.some(([view]) => view === state.activeView)) return renderLibraryView()
  return renderHomeView()
}

function renderAppShell(content) {
  app.innerHTML = `
    ${navShell({ currentPage: 'music' })}
    <main class="music-page">
      <button type="button" class="music-mobile-menu" data-toggle-music-sidebar>${state.sidebarOpen ? 'Close Menu' : 'Music Menu'}</button>
      <div class="music-app-shell">
        ${renderSidebar()}
        <section class="music-content" data-music-content>
          ${content}
        </section>
      </div>
      ${renderPlayer()}
    </main>
  `
}

function hydrateStableImages() {
  app.querySelectorAll('[data-stable-image]').forEach((container) => {
    const src = container.dataset.src || ''
    const imageKey = container.dataset.imageKey || src
    const currentImg = container.querySelector('img')
    if (!src) return
    if (currentImg?.getAttribute('src') === src) return
    const failedBefore = stableImageCache.get(src) === 'failed'
    if (failedBefore) container.classList.add('is-fallback')
    const image = new Image()
    image.alt = container.dataset.alt || ''
    image.loading = 'lazy'
    image.onload = () => {
      stableImageCache.set(src, 'loaded')
      stableImageCache.set(`key:${imageKey}`, { lastGoodSrc: src })
      if (import.meta.env?.DEV) console.info('[music:image] loaded', { src: src.split('?')[0], key: imageKey || '' })
      if (container.dataset.src !== src) return
      currentImg?.remove()
      container.prepend(image)
      container.classList.add('is-loaded')
      container.classList.remove('is-fallback')
    }
    image.onerror = () => {
      stableImageCache.set(src, 'failed')
      if (import.meta.env?.DEV) console.warn('[music:image] fallback after load error', { src: src.split('?')[0], key: container.dataset.imageKey || '' })
      if (container.dataset.src === src) container.classList.add('is-fallback')
    }
    image.src = src
  })
}

function renderLandingPage() {
  renderAppShell(renderActiveView())
}

function renderCredits(credits) {
  if (!credits) return '<p class="music-muted">Credits will appear here when the creator adds them.</p>'
  if (typeof credits === 'string') return `<p>${escapeHtml(credits)}</p>`
  if (Array.isArray(credits)) return `<ul>${credits.map((credit) => `<li>${escapeHtml(typeof credit === 'string' ? credit : `${credit.role || 'Credit'}: ${credit.name || ''}`)}</li>`).join('')}</ul>`
  return `<ul>${Object.entries(credits).map(([key, value]) => `<li><strong>${escapeHtml(key)}:</strong> ${escapeHtml(Array.isArray(value) ? value.join(', ') : value)}</li>`).join('')}</ul>`
}

function renderTrackRow(track) {
  const playable = Boolean(track.streamAudioURL)
  const isCurrent = state.player.track?.id === track.id
  return `
    <li class="music-track-row ${isCurrent ? 'is-current' : ''}">
      <span class="music-track-number">${track.trackNumber}</span>
      <div>
        <strong>${escapeHtml(track.title)}</strong>
        <small>${escapeHtml(track.artistName)}${track.explicit ? ' · Explicit' : ''}</small>
      </div>
      <span>${escapeHtml(formatDuration(track.duration))}</span>
      <button type="button" class="button button-muted" data-play-track="${escapeHtml(track.id)}" ${playable ? '' : 'disabled'}>${isCurrent && state.player.playing ? 'Pause' : 'Play'}</button>
    </li>
  `
}

function renderReleaseDetailContent() {
  if (state.loading) {
    return '<section class="music-detail-state"><h1>Loading release...</h1></section>'
  }

  if (!state.release) {
    return `
      <section class="music-detail-state">
        <p class="music-eyebrow">Release unavailable</p>
        <h1>This Melogic Music release is not available.</h1>
        <p>It may still be in review, private, unlisted, or no longer published.</p>
        <a class="button button-accent" href="${ROUTES.music}">Back to Music</a>
      </section>
    `
  }

  const release = state.release
  const tags = [release.genre, release.subgenre, ...(release.moods || []), ...(release.tags || [])].filter(Boolean)
  return `
    <section class="music-detail-hero">
      ${renderReleaseArtwork(release, 'music-detail-art')}
      <div class="music-detail-copy">
        <p class="music-eyebrow">${escapeHtml(titleCase(release.releaseType))}</p>
        <h1>${escapeHtml(release.title)}</h1>
        <p class="music-detail-artist">${escapeHtml(release.artistName)}</p>
        <p>${escapeHtml(formatDate(release.releaseDate || release.createdAt))}</p>
        <div class="music-tag-row">
          ${tags.length ? tags.slice(0, 8).map((tag) => `<span>${escapeHtml(tag)}</span>`).join('') : '<span>Melogic Music</span>'}
          ${release.explicit ? '<span class="music-explicit-badge">Explicit</span>' : ''}
        </div>
      </div>
    </section>
    <section class="music-detail-grid">
      <div class="music-panel">
        <div class="music-row-heading">
          <div>
            <p class="music-eyebrow">Track List</p>
            <h2>${state.tracks.length || 'No'} tracks</h2>
          </div>
        </div>
        ${state.tracks.length ? `<ol class="music-track-list">${state.tracks.map(renderTrackRow).join('')}</ol>` : '<p class="music-muted">The track list is being prepared.</p>'}
      </div>
      <aside class="music-panel">
        <p class="music-eyebrow">Credits</p>
        ${renderCredits(release.credits)}
        ${release.copyrightLine ? `<p class="music-legal-line">${escapeHtml(release.copyrightLine)}</p>` : ''}
        ${release.publisherLine ? `<p class="music-legal-line">${escapeHtml(release.publisherLine)}</p>` : ''}
      </aside>
    </section>
  `
}

function renderReleaseDetailPage() {
  renderAppShell(renderReleaseDetailContent())
}

function liveStatusLabel(stream = {}) {
  const playbackInfo = getPublicPlaybackInfo(stream)
  if (state.liveStatus === 'live') return streamHasVideoFoundation(stream) ? 'Live stream connected.' : 'Live audio connected.'
  if (state.liveStatus === 'playing') return streamHasVideoFoundation(stream) ? 'Live stream connected.' : 'Live audio connected.'
  if (state.liveStatus === 'requestingPlayback') return 'Requesting playback...'
  if (state.liveStatus === 'connectingTransport') return 'Connecting to live audio...'
  if (state.liveStatus === 'loadingManifest') return 'Loading live stream playlist...'
  if (state.liveStatus === 'ready') return 'Ready. Press Play to start the live stream.'
  if (state.liveStatus === 'waitingForRemoteAudio') return 'Waiting for host audio track...'
  if (state.liveStatus === 'readyToPlay') return 'Ready to play - press Resume Audio.'
  if (state.liveStatus === 'playbackBlocked') return 'Press Resume Audio.'
  if (state.liveStatus === 'stalled') return 'Live stream stalled. Reconnecting...'
  if (state.liveStatus === 'error') return playbackInfo.provider === STREAM_PROVIDERS.hlsEdge ? 'Live stream error.' : 'Live audio error.'
  if (state.liveStatus === 'waitingForHost') return 'Host is not currently broadcasting.'
  if (state.liveStatus === 'waitingForSegments') return 'Connected to host. Waiting for audio chunks...'
  if (state.liveStatus === 'interrupted') return 'Stream interrupted.'
  if (state.liveStatus === 'waiting') return streamHasVideoFoundation(stream) ? 'Connected - waiting for media.' : 'Connected - waiting for host audio.'
  if (state.liveStatus === 'reconnecting') return 'Reconnecting...'
  if (state.liveStatus === 'connecting') return 'Connecting to stream...'
  if (state.liveStatus === 'buffering') return 'Starting stream buffer...'
  if (state.liveStatus === 'ended' || stream.status !== 'live') return 'Stream ended.'
  if (playbackInfo.provider === STREAM_PROVIDERS.firebaseSegments) {
    const status = stream.nativeStreaming?.status || ''
    if (status === 'idleNoListeners' || status === 'idle_no_listeners') return 'Waiting for listeners.'
    if (status === 'warmingBuffer') return 'Buffering.'
    if (status === 'pausedNoListeners' || status === 'paused_no_listeners') return 'Paused, no listeners.'
    if (status === 'error') return 'Stream error.'
    return 'Live.'
  }
  if (playbackInfo.provider === STREAM_PROVIDERS.hlsEdge) return 'Click Play to begin. Sound never autoplays.'
  return 'Click Listen to join. Audio never autoplays.'
}

function isLiveListeningStatus(status = state.liveStatus) {
  return ['live', 'playing', 'waiting', 'buffering', 'requestingPlayback', 'connectingTransport', 'loadingManifest', 'ready', 'stalled', 'waitingForRemoteAudio', 'readyToPlay', 'playbackBlocked', 'waitingForHost', 'waitingForSegments', 'connecting', 'reconnecting'].includes(status)
}

function nativePlaybackWaitMessage(stream = {}, elapsedMs = 0) {
  const native = stream.nativeStreaming || {}
  const hostFresh = state.nativeListenerDiagnostics.hostHeartbeatFresh === true || (stream.hostConnected === true && isLiveStreamFresh(stream))
  if (stream.status !== 'live') return 'This stream has ended or is no longer public.'
  if (!hostFresh) return 'The host is not currently broadcasting. Stay on this page or check back in a moment.'
  if (state.nativeListenerDiagnostics.lastSegmentError) return `Stream segment lookup failed: ${state.nativeListenerDiagnostics.lastSegmentError}`
  if (native.lastUploadError) return `The host is live, but segment upload is failing: ${native.lastUploadError}`
  if (Number(state.nativeListenerDiagnostics.readySegmentCount || 0) > 0 && !isNativeRealSegmentAudioPlaying()) return 'Ready to play — press Resume Audio.'
  if (elapsedMs >= 45000) return 'Host is live, but no audio chunks have been received yet.'
  if (state.nativeListenerDiagnostics.userGestureUnlockSucceeded === true && state.nativeListenerDiagnostics.readySegmentCount === 0) return 'Playback unlocked. Waiting for audio chunks...'
  if (state.nativeListenerDiagnostics.demandWriteSucceeded === true && state.nativeListenerDiagnostics.readySegmentCount === 0) return 'Connected to host. Waiting for audio chunks...'
  if (elapsedMs >= 10000) return 'Waiting for stream data from the host. Demand is connected, but no playable segments are available yet.'
  return 'Starting stream buffer...'
}

function nativeLiveStatusLabel(stream = {}) {
  if (getPublicPlaybackInfo(stream).provider !== STREAM_PROVIDERS.firebaseSegments) return 'LIVE'
  const status = stream.nativeStreaming?.status || ''
  if (status === 'idleNoListeners' || status === 'idle_no_listeners') return 'Waiting for listeners'
  if (status === 'warmingBuffer') return 'Buffering'
  if (status === 'pausedNoListeners' || status === 'paused_no_listeners') return 'Paused no listeners'
  if (status === 'error') return 'Error'
  return 'Live'
}

function audioModeLabel(mode = 'music') {
  return mode === 'voice' ? 'Podcast / Voice' : 'High Quality Music'
}

function audioConstraintsForMode({ deviceId = '', relaxed = false } = {}) {
  const mode = state.goLive.form.audioMode === 'voice' ? 'voice' : 'music'
  const base = deviceId ? { deviceId: { exact: deviceId } } : {}
  if (relaxed) return deviceId ? { deviceId: { exact: deviceId } } : true
  if (mode === 'voice') {
    return {
      ...base,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      sampleRate: { ideal: 48000 }
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

function publishOptionsForAudioMode() {
  const source = Track?.Source?.Microphone || 'microphone'
  if (state.goLive.form.audioMode === 'voice') {
    return { audioPreset: AudioPresets.speech, dtx: true, red: true, forceStereo: false, source }
  }
  // LiveKit/WebRTC is real-time Opus transport. These supported options favor music quality,
  // but browsers do not expose a reliable broadcast-style listener buffer here.
  // Future Broadcast Delay Mode should use a server relay such as HLS/LL-HLS, Icecast-style
  // streaming, LiveKit Egress, or another recording/transcoding pipeline when intentional
  // radio-style delay and buffering matter more than interactivity.
  return { audioPreset: AudioPresets.musicHighQualityStereo, dtx: false, red: true, forceStereo: true, source }
}

function isHostBroadcastActive() {
  return Boolean(state.goLive.streamId && (
    state.goLive.starting
    || state.goLive.form.streamingMethod === 'obsRtmp'
    || state.goLive.browserIngestActive
    || state.goLive.room
    || state.goLive.localTrack
  ))
}

function formatChatTime(value = '') {
  const date = value ? new Date(value) : null
  if (!date || Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function stopLiveChatSubscription() {
  if (state.liveChat.unsubscribe) state.liveChat.unsubscribe()
  state.liveChat.unsubscribe = null
  state.liveChat.messages = []
  state.liveChat.error = ''
}

function stopLiveStreamSubscription() {
  if (state.liveStreamUnsubscribe) state.liveStreamUnsubscribe()
  state.liveStreamUnsubscribe = null
  if (state.guestInviteUnsubscribe) state.guestInviteUnsubscribe()
  state.guestInviteUnsubscribe = null
  state.guestInvite = null
}

function stopLiveListRefresh() {
  if (state.liveListRefreshTimer) window.clearInterval(state.liveListRefreshTimer)
  state.liveListRefreshTimer = 0
}

function stopLiveSequenceSubscription() {
  if (state.liveSequence.unsubscribe) state.liveSequence.unsubscribe()
  state.liveSequence.unsubscribe = null
}

function stopListenerPresenceHeartbeat() {
  if (state.listenerPresenceTimer) window.clearInterval(state.listenerPresenceTimer)
  state.listenerPresenceTimer = 0
}

function listenerAnonId() {
  try {
    const existing = window.sessionStorage.getItem('melogic_live_anon_id')
    if (existing) return existing
    const generated = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    window.sessionStorage.setItem('melogic_live_anon_id', generated)
    return generated
  } catch {
    return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  }
}

function livePresenceId(streamId = '') {
  const uid = state.currentUser?.uid || ''
  return uid ? `uid-${uid}-${streamId}` : `${listenerAnonId()}-${streamId}`
}

function startListenerPresenceHeartbeat(streamId, presenceId) {
  stopListenerPresenceHeartbeat()
  if (!streamId || !presenceId) return
  state.listenerPresenceTimer = window.setInterval(() => {
    updateMusicLiveListenerPresence(streamId, presenceId).catch(() => {})
  }, 20000)
}

function updateNativeAudioDiagnostics(eventName = '') {
  const audio = state.listenerAudioElement
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    ...(eventName ? { lastAudioEvent: eventName } : {}),
    audioPaused: audio ? audio.paused === true : null,
    audioMuted: audio ? audio.muted === true : null,
    audioVolume: audio ? Number(audio.volume || 0) : null,
    audioReadyState: audio ? Number(audio.readyState || 0) : null,
    audioCurrentSrc: audio?.currentSrc || audio?.src || '',
    audioErrorCode: audio?.error?.code ?? null,
    audioErrorMessage: audio?.error?.message || '',
    currentSrcIsMediaSourceBlob: Boolean((audio?.currentSrc || audio?.src || '').startsWith('blob:') && state.nativeMediaSourceUrl && (audio?.currentSrc || audio?.src || '') === state.nativeMediaSourceUrl),
    mediaSourceReadyState: state.nativeMediaSource?.readyState || '',
    sourceBufferUpdating: state.nativeSourceBuffer ? state.nativeSourceBuffer.updating === true : null,
    appendQueueLength: state.nativeAppendQueue?.length || 0,
    appendedSegmentIndexes: Array.from(state.nativeAppendedSegmentIndexes || []),
    selectedSourceBufferMime: state.nativeSelectedSourceBufferMime || ''
  }
}

function isNativeRealSegmentAudioPlaying() {
  const audio = state.listenerAudioElement
  if (!audio || audio.paused) return false
  const currentSrc = audio.currentSrc || audio.src || ''
  return Boolean(currentSrc && currentSrc !== SILENT_AUDIO_UNLOCK_SRC && state.nativeListenerDiagnostics.lastAudioEvent === 'playing')
}

function ensureNativeListenerAudioElement() {
  let audio = state.listenerAudioElement
  if (!audio) {
    audio = new Audio()
    audio.dataset.nativeListenerAudio = 'true'
    ;['play', 'playing', 'waiting', 'stalled', 'pause', 'error'].forEach((eventName) => {
      audio.addEventListener(eventName, () => {
        updateNativeAudioDiagnostics(eventName)
        if (eventName === 'playing') {
          state.nativeListenerDiagnostics.lastPlayResolvedAt = new Date().toISOString()
          state.nativeListenerDiagnostics.userGestureUnlockSucceeded = true
          const playingRealSegment = isNativeRealSegmentAudioPlaying()
          state.liveStatus = playingRealSegment ? 'playing' : 'buffering'
          state.liveError = playingRealSegment ? '' : 'Playback unlocked. Waiting for audio chunks...'
          rerender()
        } else if (eventName === 'waiting' && state.liveStatus !== 'playing') {
          state.liveStatus = 'buffering'
        } else if (eventName === 'error') {
          state.nativeListenerDiagnostics.lastPlayErrorName = audio.error?.name || 'MediaError'
          state.nativeListenerDiagnostics.lastPlayErrorMessage = audio.error?.message || 'Audio element error.'
        }
        updateLiveListenerControls()
      })
    })
    state.listenerAudioElement = audio
  }
  audio.controls = true
  audio.muted = false
  audio.volume = 1
  audio.playsInline = true
  audio.autoplay = false
  audio.style.display = 'block'
  audio.style.width = 'min(100%, 520px)'
  audio.style.margin = '12px 0'
  if (!audio.src && !audio.currentSrc) audio.src = SILENT_AUDIO_UNLOCK_SRC
  const mount = app.querySelector('[data-native-audio-mount]')
  const parent = mount || document.body
  if (audio.parentElement !== parent) parent.appendChild(audio)
  updateNativeAudioDiagnostics()
  return audio
}

function getMediaSourceConstructor() {
  return window.MediaSource || window.ManagedMediaSource || null
}

function nativeSourceBufferMimeCandidates(segment = {}) {
  return [
    segment.mimeType,
    'audio/webm;codecs=opus',
    'audio/webm; codecs="opus"',
    'audio/webm'
  ].filter(Boolean).map((value) => String(value).trim()).filter((value, index, list) => list.indexOf(value) === index)
}

function selectNativeSourceBufferMime(segment = {}) {
  const MediaSourceClass = getMediaSourceConstructor()
  if (!MediaSourceClass?.isTypeSupported) return ''
  return nativeSourceBufferMimeCandidates(segment).find((mimeType) => MediaSourceClass.isTypeSupported(mimeType)) || ''
}

function cleanupNativeMediaSourcePipeline() {
  if (state.nativeSourceBuffer) {
    try {
      state.nativeSourceBuffer.removeEventListener?.('updateend', pumpNativeAppendQueue)
      state.nativeSourceBuffer.removeEventListener?.('error', handleNativeSourceBufferError)
    } catch {}
  }
  if (state.nativeMediaSourceUrl) {
    try { URL.revokeObjectURL(state.nativeMediaSourceUrl) } catch {}
  }
  state.nativeMediaSource = null
  state.nativeMediaSourceUrl = ''
  state.nativeMediaSourceStreamId = ''
  state.nativeSourceBuffer = null
  state.nativeAppendQueue = []
  state.nativeQueuedSegmentIndexes = new Set()
  state.nativeAppendedSegmentIndexes = new Set()
  state.nativeSegmentFetches = new Set()
  state.nativeSelectedSourceBufferMime = ''
}

function handleNativeSourceBufferError(event = {}) {
  const error = event?.error || event?.target?.error || {}
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    lastAppendErrorName: error?.name || 'SourceBufferError',
    lastAppendErrorMessage: error?.message || 'SourceBuffer append failed.'
  }
  updateNativeAudioDiagnostics('sourcebuffer-error')
  state.liveError = 'Native Streaming playback failed while appending audio chunks.'
  updateLiveListenerControls()
}

function ensureNativeMediaSourcePipeline(streamId = '', segmentHint = {}) {
  const audio = ensureNativeListenerAudioElement()
  const MediaSourceClass = getMediaSourceConstructor()
  const mediaSourceSupported = Boolean(MediaSourceClass?.isTypeSupported)
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    mediaSourceSupported
  }
  if (!mediaSourceSupported) {
    state.liveError = 'This browser cannot play Native Streaming chunks yet. Try Chrome/Edge.'
    updateNativeAudioDiagnostics()
    return false
  }
  const selectedMime = selectNativeSourceBufferMime(segmentHint)
  state.nativeSelectedSourceBufferMime = selectedMime
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    selectedSourceBufferMime: selectedMime,
    sourceBufferCreated: selectedMime ? state.nativeListenerDiagnostics.sourceBufferCreated : false
  }
  if (!selectedMime) {
    state.liveError = 'This browser cannot play Native Streaming chunks yet. Try Chrome/Edge.'
    updateNativeAudioDiagnostics()
    return false
  }
  if (state.nativeMediaSource && state.nativeMediaSourceStreamId === streamId) {
    updateNativeAudioDiagnostics()
    return true
  }
  cleanupNativeMediaSourcePipeline()
  const mediaSource = new MediaSourceClass()
  const mediaSourceUrl = URL.createObjectURL(mediaSource)
  state.nativeMediaSource = mediaSource
  state.nativeMediaSourceUrl = mediaSourceUrl
  state.nativeMediaSourceStreamId = streamId
  audio.src = mediaSourceUrl
  try { audio.load() } catch {}
  mediaSource.addEventListener('sourceopen', () => {
    state.nativeSelectedSourceBufferMime = selectedMime
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      sourceOpenAt: new Date().toISOString(),
      selectedSourceBufferMime: selectedMime,
      mediaSourceReadyState: mediaSource.readyState
    }
    if (!selectedMime) {
      state.nativeListenerDiagnostics.sourceBufferCreated = false
      state.liveError = 'This browser cannot play Native Streaming chunks yet. Try Chrome/Edge.'
      updateNativeAudioDiagnostics('sourceopen')
      updateLiveListenerControls()
      return
    }
    try {
      const sourceBuffer = mediaSource.addSourceBuffer(selectedMime)
      sourceBuffer.mode = 'sequence'
      sourceBuffer.addEventListener('updateend', pumpNativeAppendQueue)
      sourceBuffer.addEventListener('error', handleNativeSourceBufferError)
      state.nativeSourceBuffer = sourceBuffer
      state.nativeListenerDiagnostics = {
        ...(state.nativeListenerDiagnostics || {}),
        sourceBufferCreated: true,
        sourceBufferUpdating: sourceBuffer.updating === true,
        selectedSourceBufferMime: selectedMime
      }
      updateNativeAudioDiagnostics('sourceopen')
      pumpNativeAppendQueue()
    } catch (error) {
      state.nativeListenerDiagnostics = {
        ...(state.nativeListenerDiagnostics || {}),
        sourceBufferCreated: false,
        lastAppendErrorName: error?.name || '',
        lastAppendErrorMessage: error?.message || ''
      }
      state.liveError = `Native Streaming playback setup failed: ${error?.message || 'SourceBuffer could not be created.'}`
      updateNativeAudioDiagnostics('sourceopen-error')
      updateLiveListenerControls()
    }
  }, { once: true })
  updateNativeAudioDiagnostics()
  return true
}

function pumpNativeAppendQueue() {
  const sourceBuffer = state.nativeSourceBuffer
  if (!sourceBuffer || sourceBuffer.updating || !state.nativeAppendQueue.length) {
    updateNativeAudioDiagnostics()
    return
  }
  const next = state.nativeAppendQueue.shift()
  state.nativeQueuedSegmentIndexes.delete(next.index)
  try {
    sourceBuffer.appendBuffer(next.buffer)
    state.nativeAppendedSegmentIndexes.add(next.index)
    state.nativePlaybackNextIndex = next.index + 1
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      sourceBufferUpdating: sourceBuffer.updating === true,
      appendQueueLength: state.nativeAppendQueue.length,
      appendedSegmentIndexes: Array.from(state.nativeAppendedSegmentIndexes),
      lastAppendIndex: next.index,
      lastAppendByteLength: Number(next.buffer?.byteLength || 0),
      lastAppendErrorName: '',
      lastAppendErrorMessage: '',
      currentSegmentIndex: next.index
    }
  } catch (error) {
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      lastAppendErrorName: error?.name || '',
      lastAppendErrorMessage: error?.message || ''
    }
    state.liveError = `Native Streaming append failed: ${error?.message || 'Could not append audio chunk.'}`
  }
  updateNativeAudioDiagnostics()
}

async function enqueueNativeMediaSourceSegments(segments = []) {
  if (!state.nativeSourceBuffer) {
    updateNativeAudioDiagnostics()
    return
  }
  const ordered = segments
    .filter((segment) => segment?.downloadURL)
    .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
  for (const segment of ordered) {
    const index = Number(segment.index ?? 0)
    if (state.nativeAppendedSegmentIndexes.has(index) || state.nativeQueuedSegmentIndexes.has(index) || state.nativeSegmentFetches.has(index)) continue
    state.nativeSegmentFetches.add(index)
    try {
      const response = await fetch(segment.downloadURL)
      if (!response.ok) throw new Error(`Segment fetch failed with HTTP ${response.status}`)
      const buffer = await response.arrayBuffer()
      state.nativeAppendQueue.push({ index, buffer, segmentId: segment.segmentId || '', mimeType: segment.mimeType || '' })
      state.nativeQueuedSegmentIndexes.add(index)
      state.nativeListenerDiagnostics = {
        ...(state.nativeListenerDiagnostics || {}),
        appendQueueLength: state.nativeAppendQueue.length,
        lastFetchedSegmentIndex: index,
        lastFetchedSegmentByteLength: Number(buffer.byteLength || 0)
      }
      pumpNativeAppendQueue()
    } catch (error) {
      state.nativeListenerDiagnostics = {
        ...(state.nativeListenerDiagnostics || {}),
        lastAppendErrorName: error?.name || '',
        lastAppendErrorMessage: error?.message || ''
      }
      state.liveError = `Native Streaming segment fetch failed: ${error?.message || 'Could not load audio chunk.'}`
      updateLiveListenerControls()
    } finally {
      state.nativeSegmentFetches.delete(index)
    }
  }
  updateNativeAudioDiagnostics()
}

async function playNativeMediaSourceAudio({ userGesture = false } = {}) {
  const audio = ensureNativeListenerAudioElement()
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    ...(userGesture ? { userGestureUnlockAttempted: true } : {}),
    lastPlayAttemptAt: new Date().toISOString(),
    lastPlayErrorName: '',
    lastPlayErrorMessage: ''
  }
  try {
    await audio.play()
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      ...(userGesture ? { userGestureUnlockSucceeded: true } : {}),
      lastPlayResolvedAt: new Date().toISOString(),
      lastPlayErrorName: '',
      lastPlayErrorMessage: ''
    }
    updateNativeAudioDiagnostics()
    state.liveError = isNativeRealSegmentAudioPlaying() ? '' : 'Playback unlocked. Waiting for audio chunks...'
    updateLiveListenerControls()
    return true
  } catch (error) {
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      ...(userGesture ? { userGestureUnlockSucceeded: false } : {}),
      lastPlayRejectedAt: new Date().toISOString(),
      lastPlayErrorName: error?.name || '',
      lastPlayErrorMessage: error?.message || ''
    }
    updateNativeAudioDiagnostics()
    state.liveError = error?.name === 'NotAllowedError'
      ? 'Playback was blocked. Press Play again.'
      : `Playback failed: ${error?.name || 'Error'} ${error?.message || ''}`.trim()
    updateLiveListenerControls()
    rerender()
    return false
  }
}

function unlockNativeAudioFromGesture() {
  const audio = ensureNativeListenerAudioElement()
  const streamId = state.liveStream?.id || state.nativeListenerDiagnostics?.streamId || ''
  const mediaSourceReady = ensureNativeMediaSourcePipeline(streamId)
  if (!mediaSourceReady) {
    state.liveStatus = 'waiting'
    updateLiveListenerControls()
    return audio
  }
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    userGestureUnlockAttempted: true,
    userGestureUnlockSucceeded: false,
    lastPlayAttemptAt: new Date().toISOString(),
    lastPlayErrorName: '',
    lastPlayErrorMessage: ''
  }
  state.liveStatus = 'buffering'
  state.liveError = 'Playback unlocked. Waiting for audio chunks...'
  try { audio.load() } catch {}
  playNativeMediaSourceAudio({ userGesture: true })
  return audio
}

function resumeNativeAudioFromGesture() {
  const streamId = state.liveStream?.id || state.nativeListenerDiagnostics?.streamId || ''
  const firstSegment = state.nativePlaybackQueue.find((segment) => segment?.downloadURL) || {}
  const mediaSourceReady = ensureNativeMediaSourcePipeline(streamId, firstSegment)
  if (!mediaSourceReady) {
    state.liveStatus = 'waiting'
    updateLiveListenerControls()
    return
  }
  enqueueNativeMediaSourceSegments(state.nativePlaybackQueue).catch(() => {})
  playNativeMediaSourceAudio({ userGesture: true })
}

function updateLiveKitListenerDiagnostics(eventName = '') {
  const audio = state.listenerAudioElement
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    provider: STREAM_PROVIDERS.nativeWeb,
    ...(eventName ? { lastAudioEvent: eventName } : {}),
    audioElementExists: Boolean(audio),
    audioPaused: audio ? audio.paused === true : null,
    audioMuted: audio ? audio.muted === true : null,
    audioVolume: audio ? Number(audio.volume || 0) : null,
    audioReadyState: audio ? Number(audio.readyState || 0) : null,
    lastPlayErrorName: eventName === 'playing' ? '' : state.nativeListenerDiagnostics?.lastPlayErrorName || '',
    lastPlayErrorMessage: eventName === 'playing' ? '' : state.nativeListenerDiagnostics?.lastPlayErrorMessage || ''
  }
}

function attachLiveKitAudioDiagnostics(audio) {
  if (!audio || audio.dataset.melogicLivekitDiagnostics === 'true') return
  audio.dataset.melogicLivekitDiagnostics = 'true'
  ;['play', 'playing', 'waiting', 'stalled', 'pause', 'error'].forEach((eventName) => {
    audio.addEventListener(eventName, () => {
      updateLiveKitListenerDiagnostics(eventName)
      if (eventName === 'playing') {
        state.liveStatus = 'playing'
        state.liveError = ''
        state.nativeListenerDiagnostics.lastPlayResolvedAt = state.nativeListenerDiagnostics.lastPlayResolvedAt || new Date().toISOString()
        if (state.liveStream?.id && state.nativeViewerSessionId) {
          updatePlaybackDemandState({
            streamId: state.liveStream.id,
            viewerSessionId: state.nativeViewerSessionId,
            uid: state.currentUser?.uid || null,
            state: 'listening',
            tabId: state.nativeViewerSessionId
          }).catch(() => {})
        }
        updateLiveMediaSession(state.liveStream)
        updateLiveListenerControls()
        rerender()
      } else if (eventName === 'error') {
        state.liveStatus = 'error'
        state.liveError = audio.error?.message || 'Live audio element failed.'
        state.nativeListenerDiagnostics.lastPlayErrorName = 'MediaError'
        state.nativeListenerDiagnostics.lastPlayErrorMessage = audio.error?.message || 'Audio element error.'
        updateLiveListenerControls()
      }
    })
  })
}

async function playLiveKitListenerAudio({ userGesture = false } = {}) {
  const audio = state.listenerAudioElement
  if (!audio) return false
  state.nativeListenerDiagnostics = {
    ...(state.nativeListenerDiagnostics || {}),
    provider: STREAM_PROVIDERS.nativeWeb,
    ...(userGesture ? { userGestureUnlockAttempted: true } : {}),
    lastPlayAttemptAt: new Date().toISOString(),
    lastPlayErrorName: '',
    lastPlayErrorMessage: ''
  }
  updateLiveKitListenerDiagnostics()
  try {
    await audio.play()
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      ...(userGesture ? { userGestureUnlockSucceeded: true } : {}),
      lastPlayResolvedAt: new Date().toISOString(),
      lastPlayResult: 'resolved',
      lastPlayErrorName: '',
      lastPlayErrorMessage: ''
    }
    updateLiveKitListenerDiagnostics()
    if (state.nativeListenerDiagnostics.lastAudioEvent !== 'playing') {
      state.liveStatus = 'readyToPlay'
      state.liveError = 'Ready to play - press Resume Audio.'
    }
    updateLiveListenerControls()
    return true
  } catch (error) {
    state.nativeListenerDiagnostics = {
      ...(state.nativeListenerDiagnostics || {}),
      ...(userGesture ? { userGestureUnlockSucceeded: false } : {}),
      lastPlayRejectedAt: new Date().toISOString(),
      lastPlayResult: 'rejected',
      lastPlayErrorName: error?.name || '',
      lastPlayErrorMessage: error?.message || ''
    }
    updateLiveKitListenerDiagnostics()
    state.liveStatus = error?.name === 'NotAllowedError' ? 'playbackBlocked' : 'error'
    state.liveError = error?.name === 'NotAllowedError'
      ? 'Playback was blocked. Press Resume Audio.'
      : `Playback failed: ${error?.name || 'Error'} ${error?.message || ''}`.trim()
    updateLiveListenerControls()
    rerender()
    return false
  }
}

function resumeLiveKitAudioFromGesture() {
  playLiveKitListenerAudio({ userGesture: true }).catch(() => {})
}

function ensureLiveKitListenerAudioMounted() {
  const audio = state.listenerAudioElement
  if (!audio || isFirebaseSegmentProvider(state.liveStream?.provider) || isBufferedHlsStream()) return
  audio.controls = true
  audio.muted = false
  audio.volume = 1
  audio.playsInline = true
  audio.style.display = 'block'
  audio.style.width = 'min(100%, 520px)'
  audio.style.margin = '12px 0'
  const mount = app.querySelector('[data-livekit-audio-mount]')
  if (mount && audio.parentElement !== mount) mount.appendChild(audio)
  updateLiveKitListenerDiagnostics()
}

function isBufferedHlsStream(stream = state.liveStream) {
  return Boolean(stream && getPublicPlaybackInfo(stream).provider === STREAM_PROVIDERS.hlsEdge)
}

function currentHlsPlaybackMode() {
  return HLS_PLAYBACK_MODES.has(state.hlsPlaybackMode) ? state.hlsPlaybackMode : 'videoAudio'
}

function hlsMediaDiagnostics(eventName = '') {
  const media = state.hlsMediaElement
  const diagnostics = state.hlsDiagnostics || {}
  const playbackInfo = getPublicPlaybackInfo(state.liveStream || {})
  state.hlsDiagnostics = {
    ...diagnostics,
    provider: STREAM_PROVIDERS.hlsEdge,
    ingestMethod: state.liveStream?.ingestMethod || diagnostics.ingestMethod || 'unknown',
    playbackMode: state.liveStream?.playbackMode || 'hls',
    streamKey: state.liveStream?.streamKey || '',
    hlsPlaybackUrl: state.liveStream?.hlsPlaybackUrl || diagnostics.hlsPlaybackUrl || '',
    hlsUrl: state.hlsAttachedUrl || diagnostics.hlsUrl || '',
    selectedPlayer: playbackInfo.selectedPlayer || 'hls',
    computedHlsUrl: playbackInfo.computedHlsUrl || playbackInfo.url || '',
    normalizationApplied: playbackInfo.normalizationApplied === true,
    rawPlaybackMode: playbackInfo.rawPlaybackMode || state.liveStream?.rawPlaybackMode || '',
    rawProvider: playbackInfo.rawProvider || state.liveStream?.rawProvider || '',
    rawStreamKey: playbackInfo.rawStreamKey || state.liveStream?.rawStreamKey || '',
    rawHlsPlaybackUrl: playbackInfo.rawHlsPlaybackUrl || state.liveStream?.rawHlsPlaybackUrl || '',
    playbackModeSelected: currentHlsPlaybackMode(),
    nativeHlsSupported: media ? canPlayNativeHls(media) : null,
    ...(eventName ? { lastMediaEvent: eventName } : {}),
    mediaCurrentSrc: media?.currentSrc || media?.src || '',
    mediaPaused: media ? media.paused === true : null,
    mediaMuted: media ? media.muted === true : null,
    mediaVolume: media ? Number(media.volume || 0) : null,
    mediaReadyState: media ? Number(media.readyState || 0) : null,
    mediaNetworkState: media ? Number(media.networkState || 0) : null,
    mediaCurrentTime: media && Number.isFinite(media.currentTime) ? Number(media.currentTime.toFixed(2)) : null,
    mediaDuration: media && Number.isFinite(media.duration) ? Number(media.duration.toFixed(2)) : null,
    mediaPlaying: Boolean(media && !media.paused && !media.ended && media.readyState >= 2)
  }
  updateHlsDiagnosticsDom()
  return state.hlsDiagnostics
}

function updateHlsDiagnosticsDom() {
  const diagnostics = state.hlsDiagnostics || {}
  app.querySelectorAll('[data-hls-diagnostic]').forEach((element) => {
    const key = element.dataset.hlsDiagnostic || ''
    const value = diagnostics[key]
    element.textContent = value === true ? 'yes' : value === false ? 'no' : value == null || value === '' ? 'none' : String(value)
  })
}

function ensureHlsMediaMounted() {
  const media = state.hlsMediaElement
  if (!media) return
  const mount = app.querySelector('[data-hls-player-mount]')
  if (mount && media.parentElement !== mount) mount.appendChild(media)
  hlsMediaDiagnostics()
}

function cleanupHlsPlayback({ removeElement = true } = {}) {
  const cleanup = state.hlsCleanup
  state.hlsCleanup = null
  try { cleanup?.() } catch {}
  if (!cleanup && state.hlsMediaElement) {
    try { state.hlsMediaElement.pause() } catch {}
    state.hlsMediaElement.removeAttribute('src')
    try { state.hlsMediaElement.load() } catch {}
  }
  if (removeElement) state.hlsMediaElement?.remove?.()
  state.hlsMediaElement = null
  state.hlsAttachedUrl = ''
}

function createHlsMediaElement(mode = currentHlsPlaybackMode()) {
  const media = document.createElement(mode === 'audioOnly' ? 'audio' : 'video')
  media.controls = true
  media.autoplay = false
  media.playsInline = true
  media.preload = 'auto'
  media.muted = mode === 'videoOnly'
  media.defaultMuted = mode === 'videoOnly'
  media.volume = mode === 'videoOnly' ? 0 : Number.isFinite(Number(state.player.volume)) ? Number(state.player.volume) : 1
  media.dataset.hlsPlayerElement = 'true'
  if (mode === 'audioOnly') media.dataset.hlsAudioPlayer = 'true'
  else media.dataset.hlsPlayer = 'true'
  ;['play', 'pause', 'loadedmetadata', 'canplay', 'volumechange', 'timeupdate', 'durationchange'].forEach((eventName) => {
    media.addEventListener(eventName, () => {
      if (mode === 'videoOnly' && !media.muted) media.muted = true
      if (eventName === 'volumechange' && mode !== 'videoOnly') state.player.volume = media.volume
      hlsMediaDiagnostics(eventName)
    })
  })
  state.hlsMediaElement = media
  ensureHlsMediaMounted()
  return media
}

function handleHlsStatus(payload = {}) {
  const status = String(payload.status || '')
  state.hlsDiagnostics = {
    ...(state.hlsDiagnostics || {}),
    hlsManifestLoaded: status === 'manifestParsed' ? true : state.hlsDiagnostics?.hlsManifestLoaded === true,
    hlsLevelCount: payload.levelCount ?? state.hlsDiagnostics?.hlsLevelCount ?? null,
    hlsJsSupported: payload.native === true ? false : payload.native === false ? true : state.hlsDiagnostics?.hlsJsSupported ?? null,
    lastHlsErrorType: status === 'error' ? String(payload.type || '') : state.hlsDiagnostics?.lastHlsErrorType || '',
    lastHlsErrorDetails: status === 'error' ? String(payload.details || '') : state.hlsDiagnostics?.lastHlsErrorDetails || '',
    lastHlsErrorFatal: status === 'error' ? payload.fatal === true : state.hlsDiagnostics?.lastHlsErrorFatal ?? null,
    lastHlsResponseCode: status === 'error' ? payload.responseCode ?? null : state.hlsDiagnostics?.lastHlsResponseCode ?? null,
    lastHlsResponseUrl: status === 'error' ? String(payload.responseUrl || '') : state.hlsDiagnostics?.lastHlsResponseUrl || ''
  }
  if (status === 'loading') state.liveStatus = 'loadingManifest'
  if (status === 'manifestParsed' && state.liveStatus !== 'playing') state.liveStatus = 'ready'
  if (status === 'canplay' && state.liveStatus !== 'playing') {
    state.liveStatus = 'ready'
    state.liveError = ''
  }
  if (status === 'playing') {
    state.liveStatus = 'playing'
    state.liveError = ''
    if (state.liveStream?.id && state.nativeViewerSessionId) {
      updatePlaybackDemandState({
        streamId: state.liveStream.id,
        viewerSessionId: state.nativeViewerSessionId,
        uid: state.currentUser?.uid || null,
        state: 'listening',
        tabId: state.nativeViewerSessionId
      }).catch(() => {})
    }
    updateLiveMediaSession(state.liveStream)
  }
  if (status === 'waiting' && state.liveStatus !== 'loadingManifest') state.liveStatus = 'waiting'
  if (status === 'stalled') state.liveStatus = 'stalled'
  if (status === 'ended') state.liveStatus = 'ended'
  if (status === 'error') state.liveStatus = 'error'
  hlsMediaDiagnostics(status)
  updateLiveListenerControls()
}

function handleHlsError(error = {}) {
  const details = String(error.details || '')
  const type = String(error.type || '')
  const responseCode = Number(error.responseCode || 0) || null
  state.hlsDiagnostics = {
    ...(state.hlsDiagnostics || {}),
    lastHlsErrorType: type,
    lastHlsErrorDetails: details,
    lastHlsErrorFatal: error.fatal === true,
    lastHlsResponseCode: responseCode,
    lastHlsResponseUrl: String(error.responseUrl || '')
  }
  const playlistNotReady = responseCode === 404 || /manifest/i.test(details) || Number(state.hlsMediaElement?.readyState || 0) === 0
  state.liveStatus = playlistNotReady ? 'loadingManifest' : 'error'
  state.liveError = playlistNotReady
    ? 'The live feed is not available yet. The stream may still be starting.'
    : `HLS playback error${type || details ? `: ${[type, details].filter(Boolean).join(' / ')}` : '.'}`
  hlsMediaDiagnostics('error')
  updateLiveListenerControls()
}

async function playHlsMediaFromGesture() {
  const media = state.hlsMediaElement
  if (!media) return false
  if (currentHlsPlaybackMode() === 'videoOnly') {
    media.muted = true
    media.defaultMuted = true
  }
  try {
    await media.play()
    state.hlsDiagnostics = { ...(state.hlsDiagnostics || {}), lastPlayResult: 'resolved', lastPlayErrorName: '', lastPlayErrorMessage: '' }
    hlsMediaDiagnostics('playResolved')
    return true
  } catch (error) {
    state.liveStatus = error?.name === 'NotAllowedError' ? 'playbackBlocked' : 'error'
    state.liveError = error?.name === 'NotAllowedError'
      ? 'Playback was blocked. Press Play.'
      : `Playback failed: ${error?.name || 'Error'} ${error?.message || ''}`.trim()
    state.hlsDiagnostics = {
      ...(state.hlsDiagnostics || {}),
      lastPlayResult: 'rejected',
      lastPlayErrorName: error?.name || '',
      lastPlayErrorMessage: error?.message || ''
    }
    hlsMediaDiagnostics('playRejected')
    updateLiveListenerControls()
    return false
  }
}

async function startHlsListenerPlayback(playbackInfo = getPublicPlaybackInfo(state.liveStream || {})) {
  if (!playbackInfo.url) {
    state.liveStatus = 'error'
    state.liveError = playbackInfo.message || 'This stream is missing an HLS stream key.'
    updateLiveListenerControls()
    return
  }
  if (!isAllowedHlsPlaybackUrl(playbackInfo.url)) {
    state.liveStatus = 'error'
    state.liveError = 'Invalid HLS playback URL. Streams must load from stream.melogicrecords.studio.'
    updateLiveListenerControls()
    return
  }

  const mode = currentHlsPlaybackMode()
  let media = state.hlsMediaElement
  const expectedTag = mode === 'audioOnly' ? 'AUDIO' : 'VIDEO'
  if (media && media.tagName !== expectedTag) cleanupHlsPlayback()
  media = state.hlsMediaElement || createHlsMediaElement(mode)
  ensureHlsMediaMounted()
  state.liveStatus = 'loadingManifest'
  state.liveError = ''
  state.nativeViewerSessionId = state.nativeViewerSessionId || nativeViewerSessionId(state.liveStream.id)
  state.hlsDiagnostics = {
    provider: STREAM_PROVIDERS.hlsEdge,
    ingestMethod: state.liveStream.ingestMethod || 'unknown',
    playbackMode: 'hls',
    streamKey: state.liveStream.streamKey || '',
    hlsPlaybackUrl: state.liveStream.hlsPlaybackUrl || playbackInfo.url,
    hlsUrl: playbackInfo.url,
    selectedPlayer: playbackInfo.selectedPlayer || 'hls',
    computedHlsUrl: playbackInfo.computedHlsUrl || playbackInfo.url,
    normalizationApplied: playbackInfo.normalizationApplied === true,
    rawPlaybackMode: playbackInfo.rawPlaybackMode || '',
    rawProvider: playbackInfo.rawProvider || '',
    rawStreamKey: playbackInfo.rawStreamKey || '',
    rawHlsPlaybackUrl: playbackInfo.rawHlsPlaybackUrl || '',
    playbackModeSelected: mode,
    nativeHlsSupported: canPlayNativeHls(media),
    hlsJsSupported: null,
    hlsManifestLoaded: false,
    demandWriteSucceeded: false
  }
  updateLiveListenerControls()

  writePlaybackDemand({
    streamId: state.liveStream.id,
    viewerSessionId: state.nativeViewerSessionId,
    uid: state.currentUser?.uid || null,
    state: 'connectingTransport',
    tabId: state.nativeViewerSessionId
  }).then((result) => {
    state.hlsDiagnostics = { ...(state.hlsDiagnostics || {}), demandWriteSucceeded: result?.ok === true }
    updateHlsDiagnosticsDom()
  }).catch((error) => {
    state.hlsDiagnostics = { ...(state.hlsDiagnostics || {}), demandWriteSucceeded: false, demandWriteError: error?.message || String(error) }
    updateHlsDiagnosticsDom()
  })

  if (state.hlsAttachedUrl !== playbackInfo.url || !state.hlsCleanup) {
    try {
      const cleanup = await attachHlsStream({
        mediaEl: media,
        src: playbackInfo.url,
        mode,
        onStatus: handleHlsStatus,
        onError: handleHlsError
      })
      if (state.hlsMediaElement !== media) {
        cleanup()
        return
      }
      state.hlsCleanup = cleanup
      state.hlsAttachedUrl = playbackInfo.url
      hlsMediaDiagnostics()
    } catch (error) {
      state.liveStatus = 'error'
      state.liveError = error?.message || 'This browser cannot play this HLS stream.'
      state.hlsDiagnostics = {
        ...(state.hlsDiagnostics || {}),
        hlsJsSupported: false,
        lastHlsErrorType: error?.name || 'Error',
        lastHlsErrorDetails: error?.message || String(error),
        lastHlsErrorFatal: true
      }
      updateLiveListenerControls()
      return
    }
  }
  await playHlsMediaFromGesture()
}

function nowPlayingDisplay(stream = {}) {
  const current = stream.currentNowPlaying
  return current?.title
    ? {
        title: current.title,
        artist: current.artist || stream.hostDisplayName,
        album: current.album || 'Melogic Music Live',
        artworkURL: current.artworkURL || stream.coverArtURL
      }
    : {
        title: stream.title,
        artist: stream.hostDisplayName,
        album: 'Melogic Music Live',
        artworkURL: stream.coverArtURL
      }
}

function streamHasVideoFoundation(stream = state.liveStream) {
  if (isBufferedHlsStream(stream)) return currentHlsPlaybackMode() !== 'audioOnly'
  if (!stream) return Boolean(state.listenerVideoElement)
  if (stream.videoEnabled !== true && !state.listenerVideoElement) return false
  return Boolean(
    (state.listenerVideoElement && stream.videoEnabled === true) ||
    stream?.videoPublished === true ||
    stream?.programHasVideo === true ||
    stream?.currentNowPlaying?.videoURL ||
    stream?.videoURL
  )
}

function liveMetaLine(meta = {}, stream = {}) {
  const artist = meta.artist || stream.hostDisplayName || 'Melogic Records'
  const album = meta.album || liveCategoryLabel(stream.category || 'music')
  return album ? `${artist} - ${album}` : artist
}

function updateLiveMediaSession(stream = state.liveStream) {
  if (!('mediaSession' in navigator) || typeof window.MediaMetadata !== 'function' || !stream) return
  const meta = nowPlayingDisplay(stream)
  const artwork = meta.artworkURL ? [{ src: meta.artworkURL, sizes: '512x512', type: 'image/png' }] : []
  navigator.mediaSession.metadata = new window.MediaMetadata({
    title: meta.title || 'Melogic Music Live',
    artist: meta.artist || stream.hostDisplayName || 'Melogic',
    album: meta.album || 'Melogic Music Live',
    artwork
  })
  navigator.mediaSession.playbackState = state.liveStatus === 'ended' || stream.status === 'ended'
    ? 'none'
    : isLiveListeningStatus() ? 'playing' : 'paused'
  navigator.mediaSession.setActionHandler('play', () => {
    if (isBufferedHlsStream() && state.hlsMediaElement) playHlsMediaFromGesture().catch(() => {})
    else if (!isLiveListeningStatus()) joinLiveListener().catch(() => {})
    else state.listenerAudioElement?.play?.().catch(() => {})
  })
  navigator.mediaSession.setActionHandler('pause', () => {
    disconnectLiveListener()
    rerender()
  })
  navigator.mediaSession.setActionHandler('stop', () => {
    disconnectLiveListener()
    rerender()
  })
}

function sequencePlaybackState() {
  return state.sequenceWorkspace.playback
}

function ensureSequenceAudioGraph() {
  const playback = sequencePlaybackState()
  if (playback.context && playback.destination && playback.masterGain) return playback
  const AudioContextCtor = window.AudioContext || window.webkitAudioContext
  if (!AudioContextCtor) throw new Error('This browser cannot run Sequence Software audio.')
  const context = new AudioContextCtor()
  const sequenceMasterGain = context.createGain()
  const destination = context.createMediaStreamDestination()
  sequenceMasterGain.gain.value = 1
  sequenceMasterGain.connect(destination)
  if (playback.monitor) sequenceMasterGain.connect(context.destination)
  playback.context = context
  playback.masterGain = sequenceMasterGain
  playback.destination = destination
  playback.outputTrack = destination.stream.getAudioTracks()[0] || null
  return playback
}

function setSequenceMonitor(enabled = true) {
  const playback = sequencePlaybackState()
  playback.monitor = enabled
  if (!playback.context || !playback.masterGain) return
  try {
    playback.masterGain.disconnect(playback.context.destination)
  } catch {}
  if (enabled) playback.masterGain.connect(playback.context.destination)
}

async function getSequenceOutputTrack() {
  const playback = ensureSequenceAudioGraph()
  if (playback.context?.state === 'suspended') await playback.context.resume()
  playback.outputTrack = playback.destination?.stream?.getAudioTracks?.()[0] || playback.outputTrack
  if (!playback.outputTrack) throw new Error('Sequence Software output track is not available.')
  return playback.outputTrack
}

function stopSequencePlayback({ keepPreload = false } = {}) {
  const playback = sequencePlaybackState()
  stopTransitionPreview()
  if (playback.timer) window.clearTimeout(playback.timer)
  playback.timer = 0
  ;[playback.currentAudio, keepPreload ? null : playback.nextAudio].filter(Boolean).forEach((audio) => {
    audio.pause()
    audio.removeAttribute('src')
    audio.load?.()
  })
  playback.currentAudio = null
  playback.currentSource = null
  playback.currentGain = null
  if (!keepPreload) {
    playback.nextAudio = null
    playback.nextItemId = ''
  }
  playback.currentItemId = ''
  playback.playing = false
  playback.paused = false
  rerender()
}

function stopTransitionPreview() {
  const playback = sequencePlaybackState()
  if (playback.transitionPreviewTimer) window.clearTimeout(playback.transitionPreviewTimer)
  if (playback.transitionPreviewInterval) window.clearInterval(playback.transitionPreviewInterval)
  playback.transitionPreviewTimer = 0
  playback.transitionPreviewInterval = 0
  ;(playback.transitionPreviewAudios || []).filter(Boolean).forEach((audio) => {
    audio.pause()
    audio.removeAttribute('src')
    audio.load?.()
  })
  playback.transitionPreviewAudios = []
  playback.previewingTransition = false
}

function gainFromDb(dbValue = 0) {
  return Math.pow(10, Number(dbValue || 0) / 20)
}

function connectSequenceAudioElement(audio, item = {}) {
  const playback = ensureSequenceAudioGraph()
  const source = playback.context.createMediaElementSource(audio)
  const gain = playback.context.createGain()
  gain.gain.value = gainFromDb(item.gainDb)
  source.connect(gain)
  gain.connect(playback.masterGain)
  return { source, gain }
}

function sequencePlayableItems() {
  const playback = sequencePlaybackState()
  return state.sequenceWorkspace.items.filter((item) => {
    if (playback.skipDisabled && item.enabled === false) return false
    return item.normalizedAudioURLSnapshot && !['stop_marker', 'break'].includes(item.type)
  })
}

function nextSequenceItem(afterItemId = '') {
  const items = sequencePlayableItems()
  if (!items.length) return null
  if (sequencePlaybackState().repeatItem && afterItemId) return items.find((item) => item.itemId === afterItemId) || items[0]
  if (sequencePlaybackState().shuffle) return items[Math.floor(Math.random() * items.length)]
  const index = Math.max(0, items.findIndex((item) => item.itemId === afterItemId))
  const next = items[index + 1]
  if (next) return next
  return sequencePlaybackState().loop ? items[0] : null
}

function previousSequenceItem(beforeItemId = '') {
  const items = sequencePlayableItems()
  if (!items.length) return null
  if (sequencePlaybackState().shuffle) return items[Math.floor(Math.random() * items.length)]
  const index = items.findIndex((item) => item.itemId === beforeItemId)
  return index > 0 ? items[index - 1] : items[0]
}

function preloadSequenceItem(item = null) {
  const playback = sequencePlaybackState()
  if (!item?.normalizedAudioURLSnapshot) return
  if (playback.nextItemId === item.itemId && playback.nextAudio) return
  if (playback.nextAudio) {
    playback.nextAudio.pause()
    playback.nextAudio.removeAttribute('src')
  }
  const audio = new Audio(item.normalizedAudioURLSnapshot)
  audio.controls = false
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  playback.nextAudio = audio
  playback.nextItemId = item.itemId
}

async function previewSequenceTransition() {
  const playback = sequencePlaybackState()
  stopTransitionPreview()
  const current = state.sequenceWorkspace.items.find((entry) => entry.itemId === playback.currentItemId)
    || state.sequenceWorkspace.items.find((entry) => entry.itemId === state.sequenceWorkspace.selectedItemId)
    || sequencePlayableItems()[0]
  const next = nextSequenceItem(current?.itemId || '')
  if (!current?.normalizedAudioURLSnapshot || !next?.normalizedAudioURLSnapshot || current.itemId === next.itemId) {
    state.sequenceWorkspace.error = 'Choose two ready sequence items to preview a transition.'
    rerender()
    return
  }
  const crossfadeMs = Math.max(500, Number(current.crossfadeMs || state.sequenceWorkspace.activeSequence?.defaultCrossfadeMs || 2500))
  const previewWindowMs = Math.min(15000, Math.max(crossfadeMs + 4000, 7000))
  const currentAudio = new Audio(current.normalizedAudioURLSnapshot)
  const nextAudio = new Audio(next.normalizedAudioURLSnapshot)
  ;[currentAudio, nextAudio].forEach((audio) => {
    audio.controls = false
    audio.preload = 'auto'
    audio.crossOrigin = 'anonymous'
  })
  nextAudio.volume = 0
  playback.transitionPreviewAudios = [currentAudio, nextAudio]
  playback.previewingTransition = true
  state.sequenceWorkspace.error = ''
  state.sequenceWorkspace.uploadStatus = `Previewing transition: ${current.titleSnapshot} into ${next.titleSnapshot}`
  currentAudio.addEventListener('loadedmetadata', () => {
    if (Number.isFinite(currentAudio.duration) && currentAudio.duration > previewWindowMs / 1000) {
      currentAudio.currentTime = Math.max(0, currentAudio.duration - previewWindowMs / 1000)
    }
  }, { once: true })
  const transitionDelay = Math.max(500, previewWindowMs - crossfadeMs)
  playback.transitionPreviewTimer = window.setTimeout(() => {
    nextAudio.play().catch(() => {})
    const startedAt = Date.now()
    playback.transitionPreviewInterval = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / crossfadeMs)
      currentAudio.volume = Math.max(0, 1 - progress)
      nextAudio.volume = progress
      if (progress >= 1) {
        currentAudio.pause()
        window.clearInterval(playback.transitionPreviewInterval)
        playback.transitionPreviewInterval = 0
      }
    }, 50)
  }, transitionDelay)
  currentAudio.onended = () => {
    if (!nextAudio.paused) return
    stopTransitionPreview()
    state.sequenceWorkspace.uploadStatus = ''
    rerender()
  }
  nextAudio.onended = () => {
    stopTransitionPreview()
    state.sequenceWorkspace.uploadStatus = ''
    rerender()
  }
  await currentAudio.play()
  rerender()
}

async function playSequenceItem(item = null, { fromTransition = false } = {}) {
  if (!item?.normalizedAudioURLSnapshot) {
    state.sequenceWorkspace.error = 'This sequence item does not have a ready audio file.'
    rerender()
    return
  }
  const playback = ensureSequenceAudioGraph()
  await playback.context.resume()
  if (playback.timer) window.clearTimeout(playback.timer)
  if (!fromTransition && playback.currentAudio) stopSequencePlayback({ keepPreload: true })
  const reusedPreload = playback.nextItemId === item.itemId && playback.nextAudio
  const audio = reusedPreload ? playback.nextAudio : new Audio(item.normalizedAudioURLSnapshot)
  audio.controls = false
  audio.preload = 'auto'
  audio.crossOrigin = 'anonymous'
  playback.nextAudio = null
  playback.nextItemId = ''
  const { source, gain } = connectSequenceAudioElement(audio, item)
  const now = playback.context.currentTime
  const baseGain = gainFromDb(item.gainDb)
  const fadeIn = Math.max(0, Number(item.fadeInMs || 0)) / 1000
  if (fadeIn) {
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.linearRampToValueAtTime(baseGain, now + fadeIn)
  }
  playback.currentAudio = audio
  playback.currentSource = source
  playback.currentGain = gain
  playback.currentItemId = item.itemId
  playback.playing = true
  playback.paused = false
  state.sequenceWorkspace.selectedItemId = item.itemId
  const next = nextSequenceItem(item.itemId)
  preloadSequenceItem(next)
  audio.onended = () => {
    if (!playback.autoplay || playback.stopAfterItem) {
      stopSequencePlayback()
      return
    }
    const following = nextSequenceItem(item.itemId)
    if (following) playSequenceItem(following, { fromTransition: true }).catch(() => {})
    else stopSequencePlayback()
  }
  await audio.play()
  const durationMs = Number(item.durationMs || 0)
  const crossfadeMs = Math.max(0, Number(item.crossfadeMs || state.sequenceWorkspace.activeSequence?.defaultCrossfadeMs || 0))
  if (playback.autoplay && !playback.stopAfterItem && durationMs > 0 && crossfadeMs > 0) {
    const fireIn = Math.max(250, durationMs - crossfadeMs)
    playback.timer = window.setTimeout(() => {
      const following = nextSequenceItem(item.itemId)
      if (!following) return
      if (playback.currentGain) {
        const fadeNow = playback.context.currentTime
        playback.currentGain.gain.cancelScheduledValues(fadeNow)
        playback.currentGain.gain.setValueAtTime(playback.currentGain.gain.value, fadeNow)
        playback.currentGain.gain.linearRampToValueAtTime(0.0001, fadeNow + crossfadeMs / 1000)
      }
      playSequenceItem(following, { fromTransition: true }).catch(() => {})
    }, fireIn)
  }
  rerender()
}

function pauseSequencePlayback() {
  const playback = sequencePlaybackState()
  playback.currentAudio?.pause()
  playback.playing = false
  playback.paused = true
  rerender()
}

function resumeSequencePlayback() {
  const playback = sequencePlaybackState()
  playback.currentAudio?.play?.().then(() => {
    playback.playing = true
    playback.paused = false
    rerender()
  }).catch(() => {})
}

function shouldShowGlobalMusicPlayer() {
  if (state.listenerRoom && state.liveStream?.id) return state.route.mode !== 'liveDetail' || state.route.id !== state.liveStream.id
  if (!state.player.track) return false
  if (state.route.mode === 'release') {
    return state.player.track.releaseId !== state.route.id && state.player.track.id !== `release-${state.route.id}`
  }
  return true
}

function ensureGoLiveDraftId() {
  if (!state.goLive.draftId) state.goLive.draftId = `draft_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  return state.goLive.draftId
}

async function deleteUploadedCover(path = '') {
  if (!storage || !path) return
  await deleteObject(storageRef(storage, path)).catch(() => {})
}

async function uploadLiveCoverFile(file) {
  if (!state.currentUser || !storage || !file) return
  if (!file.type.startsWith('image/')) {
    state.goLive.formError = 'Cover upload must be an image file.'
    rerender()
    return
  }
  if (file.size > 8 * 1024 * 1024) {
    state.goLive.formError = 'Cover image must be 8 MB or smaller.'
    rerender()
    return
  }
  state.goLive.uploadingCover = true
  state.goLive.formError = ''
  rerender()
  try {
    if (state.goLive.form.coverArtSource === 'upload') await deleteUploadedCover(state.goLive.form.coverArtPath)
    const ext = (file.name.split('.').pop() || 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'
    const path = `users/${state.currentUser.uid}/musicLiveUploads/${ensureGoLiveDraftId()}/cover/cover-${Date.now()}.${ext}`
    const ref = storageRef(storage, path)
    await uploadBytes(ref, file, {
      contentType: file.type,
      customMetadata: { ownerUid: state.currentUser.uid, draftId: state.goLive.draftId, type: 'music-live-cover' }
    })
    const url = await getDownloadURL(ref)
    state.goLive.form.coverArtURL = url
    state.goLive.form.coverArtPath = path
    state.goLive.form.coverArtSource = 'upload'
  } catch (error) {
    state.goLive.formError = error?.message || 'Cover image could not be uploaded.'
  } finally {
    state.goLive.uploadingCover = false
    rerender()
  }
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
  if (!AudioContextCtor || typeof window.OfflineAudioContext !== 'function') {
    throw new Error('This browser cannot normalize audio files yet.')
  }
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
    file: new File([audioBufferToWav(rendered)], `${(file.name || 'sequence-audio').replace(/\.[^.]+$/, '') || 'sequence-audio'}-44100-16bit.wav`, { type: 'audio/wav' }),
    durationMs: Math.round(rendered.duration * 1000),
    sampleRate: 44100,
    bitDepth: 16,
    channels
  }
}

async function uploadSequenceAssetFromFile(file, fields = {}) {
  if (!state.currentUser || !file) return
  const uid = state.currentUser.uid
  const isVideo = file.type.startsWith('video/')
  const isAudio = file.type.startsWith('audio/') || isVideo
  const maxAudioSize = 500 * 1024 * 1024
  const maxVideoSize = 1024 * 1024 * 1024
  if (!isAudio) {
    state.sequenceWorkspace.error = 'Upload an audio file, or a video file with audio for future video-capable sequencing.'
    rerender()
    return
  }
  if ((!isVideo && file.size > maxAudioSize) || (isVideo && file.size > maxVideoSize)) {
    state.sequenceWorkspace.error = isVideo ? 'Video sequence assets must be 1 GB or smaller.' : 'Audio sequence assets must be 500 MB or smaller.'
    rerender()
    return
  }
  state.sequenceWorkspace.error = ''
  state.sequenceWorkspace.uploadStatus = 'Normalizing to 44.1 kHz / 16-bit...'
  rerender()
  let shell
  try {
    const videoAudioMode = isVideo ? fields.videoAudioMode || state.sequenceWorkspace.videoAudioMode : ''
    shell = await createSequenceAssetShell(uid, {
      type: isVideo ? 'video' : 'audio',
      title: fields.title || file.name.replace(/\.[^.]+$/, ''),
      artist: fields.artist,
      album: fields.album,
      category: fields.category || (isVideo ? 'recorded_show' : 'song'),
      notes: fields.notes,
      originalFileName: file.name,
      originalMimeType: file.type,
      videoAudioMode,
      fileSizeBytes: file.size,
      status: 'processing'
    })
    let videoUpload = null
    if (isVideo) {
      state.sequenceWorkspace.uploadStatus = 'Uploading video reference for future video sequencing...'
      rerender()
      videoUpload = await uploadSequenceAssetFile(uid, shell.assetId, file, 'video')
    }
    if (isVideo && videoAudioMode === 'no_audio') {
      await updateSequenceAsset(uid, shell.assetId, {
        status: 'ready',
        videoPath: videoUpload?.path || '',
        videoURL: videoUpload?.url || '',
        processingError: ''
      })
    } else {
      const playbackSourceFile = isVideo && videoAudioMode === 'separate_audio' ? fields.separateAudioFile : file
      if (isVideo && videoAudioMode === 'separate_audio' && !playbackSourceFile?.size) {
        throw new Error('Choose a separate audio file for this video asset.')
      }
      const normalized = await normalizeAudioFileToWav(playbackSourceFile)
      state.sequenceWorkspace.uploadStatus = 'Uploading normalized playback file...'
      rerender()
      const normalizedUpload = await uploadSequenceAssetFile(uid, shell.assetId, normalized.file, 'normalized')
      await updateSequenceAsset(uid, shell.assetId, {
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
    }
    state.sequenceWorkspace.uploadStatus = 'Asset ready.'
    await loadSequenceAssets()
  } catch (error) {
    if (shell?.assetId) {
      await updateSequenceAsset(uid, shell.assetId, {
        status: 'failed',
        processingError: error?.message || 'Audio normalization failed.'
      }).catch(() => {})
    }
    state.sequenceWorkspace.error = error?.message || 'Sequence asset could not be processed.'
    state.sequenceWorkspace.uploadStatus = ''
  } finally {
    rerender()
  }
}

function renderLiveChatPanel(streamId = '') {
  const signedIn = Boolean(state.currentUser)
  return `
    <aside class="music-panel music-live-chat">
      <div class="music-row-heading">
        <div>
          <p class="music-eyebrow">Live chat</p>
          <h2>Chat</h2>
        </div>
      </div>
      <div class="music-live-chat-messages" data-live-chat-messages>
        ${state.liveChat.messages.length ? state.liveChat.messages.map((message) => `
          <article class="music-live-chat-message">
            ${renderAvatarImage({ src: message.photoURL, name: message.displayName, className: 'music-chat-avatar' })}
            <div>
              <div>
                <strong>${escapeHtml(message.displayName)}</strong>
                <time>${escapeHtml(formatChatTime(message.createdAt))}</time>
              </div>
              <p>${escapeHtml(message.text)}</p>
            </div>
          </article>
        `).join('') : '<p class="music-muted">No messages yet.</p>'}
      </div>
      ${state.liveChat.error ? `<p class="music-live-error">${escapeHtml(state.liveChat.error)}</p>` : ''}
      ${signedIn ? `
        <form class="music-live-chat-form" data-live-chat-form data-stream-id="${escapeHtml(streamId)}">
          <input name="text" maxlength="500" placeholder="Send a message..." value="${escapeHtml(state.liveChat.text)}" />
          <button class="button button-accent" type="submit" ${state.liveChat.sending ? 'disabled' : ''}>${state.liveChat.sending ? 'Sending...' : 'Send'}</button>
        </form>
      ` : '<p class="music-muted">Sign in to join live chat.</p>'}
    </aside>
  `
}

function renderHostMetadataEditor(form) {
  if (!state.goLive.editOpen) {
    return '<button type="button" class="button button-muted" data-toggle-live-edit>Edit stream info</button>'
  }
  const categories = [
    ['music', 'Music'],
    ['podcast', 'Podcast'],
    ['radio', 'Radio station'],
    ['interview', 'Interview'],
    ['listening_party', 'Listening party'],
    ['creator_talk', 'Creator talk'],
    ['other', 'Other']
  ]
  return `
    <form class="music-live-edit-form" data-live-edit-form>
      <label><span>Title</span><input name="title" maxlength="90" required value="${escapeHtml(form.title)}" /></label>
      <label><span>Description</span><textarea name="description" rows="3" maxlength="1200">${escapeHtml(form.description)}</textarea></label>
      <label><span>Cover image URL</span><input name="coverArtURL" value="${escapeHtml(form.coverArtURL)}" /></label>
      <label><span>Tags</span><input name="tags" value="${escapeHtml(form.tags)}" /></label>
      <label><span>Category</span><select name="category">${categories.map(([value, label]) => `<option value="${value}" ${form.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label><span>Access</span><select name="accessMode"><option value="public" ${form.accessMode === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${form.accessMode === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${form.accessMode === 'private' ? 'selected' : ''}>Private</option><option value="password" ${form.accessMode === 'password' ? 'selected' : ''}>Password protected</option></select></label>
      <input type="hidden" name="visibility" value="${form.accessMode === 'private' ? 'private' : form.accessMode === 'unlisted' ? 'unlisted' : 'public'}" />
      ${form.accessMode === 'password' ? '<label><span>New password (optional)</span><input name="password" type="password" maxlength="200" placeholder="Leave blank to keep current password" /></label>' : ''}
      ${state.goLive.editError ? `<p class="music-live-error">${escapeHtml(state.goLive.editError)}</p>` : ''}
      <div class="music-live-actions">
        <button class="button button-accent" type="submit" ${state.goLive.editSaving ? 'disabled' : ''}>${state.goLive.editSaving ? 'Saving...' : 'Save live updates'}</button>
        <button class="button button-muted" type="button" data-toggle-live-edit>Close</button>
      </div>
    </form>
  `
}

function renderSequenceArtwork(item = {}) {
  return renderStableImage({
    src: item.artworkURL,
    alt: item.title ? `${item.title} artwork` : 'Sequence artwork',
    className: 'music-sequence-art',
    fallback: 'NP',
    key: `sequence-${item.itemId || item.title || item.artworkURL || 'fallback'}`
  })
}

function sequenceItemStatus(item = {}) {
  const liveItemId = state.liveStream?.currentNowPlaying?.sequenceItemId || ''
  if (liveItemId && liveItemId === item.itemId) return 'Live'
  if (state.liveSequence.previewItemId && state.liveSequence.previewItemId === item.itemId) return 'Queued'
  return liveItemId ? 'Not Live' : 'Ready'
}

function renderSequenceControls(item = {}) {
  const isLive = state.liveStream?.currentNowPlaying?.sequenceItemId === item.itemId
  const primary = state.liveSequence.studioMode
    ? `<button type="button" class="button button-accent" data-live-sequence-queue="${escapeHtml(item.itemId)}">Queue Item</button>`
    : isLive
      ? `<button type="button" class="button button-muted" data-live-sequence-clear>Take Down</button>`
      : `<button type="button" class="button button-accent" data-live-sequence-set="${escapeHtml(item.itemId)}">Set Live</button>`
  return `
    <div class="music-sequence-controls">
      ${primary}
      <button type="button" class="button button-muted" data-live-sequence-edit="${escapeHtml(item.itemId)}">Edit</button>
      <button type="button" class="button button-danger" data-live-sequence-delete="${escapeHtml(item.itemId)}">Remove</button>
    </div>
  `
}

function renderHostSequencePanel() {
  const form = state.liveSequence.form
  const liveItem = state.liveSequence.items.find((item) => item.itemId === state.liveStream?.currentNowPlaying?.sequenceItemId)
  const previewItem = state.liveSequence.items.find((item) => item.itemId === state.liveSequence.previewItemId)
  return `
    <section class="music-sequence-panel">
      <div class="music-row-heading">
        <div>
          <p class="music-eyebrow">Now Playing</p>
          <h2>Sequence</h2>
        </div>
        <div class="music-live-actions">
          <button type="button" class="button button-muted ${state.liveSequence.studioMode ? 'is-active' : ''}" data-live-studio-mode>${state.liveSequence.studioMode ? 'Studio Mode On' : 'Studio Mode Off'}</button>
          <button type="button" class="button button-muted" data-live-sequence-clear>Take Down Live</button>
        </div>
      </div>
      ${state.liveSequence.studioMode ? `
        <div class="music-studio-grid">
          <article class="music-studio-panel is-program">
            <p class="music-eyebrow">Live / Program</p>
            ${liveItem ? `
              ${renderSequenceArtwork(liveItem)}
              <strong>${escapeHtml(liveItem.title)}</strong>
              <span>${escapeHtml([liveItem.artist, liveItem.album].filter(Boolean).join(' · ') || 'On air now')}</span>
            ` : '<p class="music-muted">Nothing is live.</p>'}
            <button type="button" class="button button-muted" data-live-sequence-clear ${liveItem ? '' : 'disabled'}>Take Down Live</button>
          </article>
          <article class="music-studio-panel is-preview">
            <p class="music-eyebrow">Preview</p>
            ${previewItem ? `
              ${renderSequenceArtwork(previewItem)}
              <strong>${escapeHtml(previewItem.title)}</strong>
              <span>${escapeHtml([previewItem.artist, previewItem.album].filter(Boolean).join(' · ') || 'Queued next')}</span>
            ` : '<p class="music-muted">Queue an item to preview it here.</p>'}
            <div class="music-live-actions">
              <button type="button" class="button button-accent" data-live-sequence-take ${previewItem ? '' : 'disabled'}>Take</button>
              <button type="button" class="button button-muted" data-live-sequence-clear-preview ${previewItem ? '' : 'disabled'}>Clear Preview</button>
            </div>
          </article>
        </div>
      ` : ''}
      <form class="music-sequence-form" data-live-sequence-form>
        <input type="hidden" name="itemId" value="${escapeHtml(state.liveSequence.editingItemId)}" />
        <label><span>Title</span><input name="title" maxlength="120" value="${escapeHtml(form.title)}" placeholder="Track or segment title" /></label>
        <label><span>Artist</span><input name="artist" maxlength="120" value="${escapeHtml(form.artist)}" placeholder="Artist / guest" /></label>
        <label><span>Album</span><input name="album" maxlength="120" value="${escapeHtml(form.album)}" placeholder="Album / show" /></label>
        <label><span>Artwork URL</span><input name="artworkURL" type="url" maxlength="1000" value="${escapeHtml(form.artworkURL)}" placeholder="Optional HTTPS artwork URL" /></label>
        ${form.artworkURL ? renderStableImage({ src: form.artworkURL, alt: 'Artwork preview', className: 'music-sequence-form-preview', fallback: 'NP', key: 'sequence-form-preview' }) : ''}
        <label><span>Notes</span><textarea name="notes" maxlength="600" rows="2">${escapeHtml(form.notes)}</textarea></label>
        ${state.liveSequence.error ? `<p class="music-live-error">${escapeHtml(state.liveSequence.error)}</p>` : ''}
        <div class="music-live-actions">
          <button class="button button-accent" type="submit" ${state.liveSequence.saving ? 'disabled' : ''}>${state.liveSequence.editingItemId ? 'Save Item' : 'Add Item'}</button>
          ${state.liveSequence.editingItemId ? '<button class="button button-muted" type="button" data-live-sequence-reset>Cancel Edit</button>' : ''}
        </div>
      </form>
      <div class="music-sequence-list">
        ${state.liveSequence.items.length ? state.liveSequence.items.map((item) => `
          <article class="music-sequence-item ${state.liveStream?.currentNowPlaying?.sequenceItemId === item.itemId ? 'is-active' : ''}">
            ${renderSequenceArtwork(item)}
            <div>
              <strong>${escapeHtml(item.title)}</strong>
              <span>${escapeHtml([item.artist, item.album].filter(Boolean).join(' · ') || 'Manual cue')}</span>
              ${item.notes ? `<small>${escapeHtml(item.notes)}</small>` : ''}
            </div>
            <span class="music-sequence-status">${escapeHtml(sequenceItemStatus(item))}</span>
            ${renderSequenceControls(item)}
          </article>
        `).join('') : '<p class="music-muted">No sequence items yet. Add cues before going live; they will stay attached to this broadcast draft.</p>'}
      </div>
      <div class="music-future-note"><strong>Automatic app metadata - coming later</strong><span>Use manual sequence items today. Browser apps cannot directly read currently playing desktop music app metadata.</span></div>
    </section>
  `
}

function renderLiveActions(stream) {
  const signedIn = Boolean(state.currentUser)
  return `
    <div class="music-live-action-bar">
      <button type="button" class="button button-muted ${state.liveViewer.reaction === 'like' ? 'is-active' : ''}" data-live-reaction="like">${Number(stream.likeCount || 0).toLocaleString()} Like</button>
      <button type="button" class="button button-muted ${state.liveViewer.reaction === 'dislike' ? 'is-active' : ''}" data-live-reaction="dislike">${Number(stream.dislikeCount || 0).toLocaleString()} Dislike</button>
      <button type="button" class="button button-muted ${state.liveViewer.saved ? 'is-active' : ''}" data-live-save>${state.liveViewer.saved ? 'Saved' : 'Save'} · ${Number(stream.saveCount || 0).toLocaleString()}</button>
      <button type="button" class="button button-muted" data-live-share>Share</button>
      <button type="button" class="button button-muted" data-live-fullscreen-monitor>Fullscreen Monitor</button>
    </div>
    ${!signedIn ? '<p class="music-muted">Sign in to like, dislike, save, or chat. Listening and sharing are open.</p>' : ''}
    ${state.liveActionMessage ? `<p class="music-muted">${escapeHtml(state.liveActionMessage)}</p>` : ''}
  `
}

function goLiveStatusLabel() {
  if (state.goLive.streamId) return state.goLive.starting ? 'Starting' : 'Live'
  if (state.goLive.draftStreamId) return 'Draft'
  return 'Ready'
}

function renderHostListenerPreview(form) {
  const stream = {
    ...form,
    id: activeHostStreamId(),
    hostDisplayName: state.liveStream?.hostDisplayName || state.currentUser?.displayName || 'Melogic Creator',
    hostPhotoURL: state.liveStream?.hostPhotoURL || state.currentUser?.photoURL || '',
    listenerCount: state.liveStream?.listenerCount || 0,
    currentNowPlaying: state.liveStream?.currentNowPlaying || null,
    title: form.title || 'Untitled live stream',
    description: form.description || 'Your stream description will appear here.'
  }
  return `
    <aside class="music-panel music-host-listener-preview">
      <div class="music-row-heading">
        <div>
          <p class="music-eyebrow">Listener Preview</p>
          <h2>Public View</h2>
        </div>
        <span class="music-live-badge">${escapeHtml(goLiveStatusLabel())}</span>
      </div>
      ${renderLiveArtwork(stream, 'music-live-detail-art')}
      <div class="music-host-preview-copy">
        <div>
          <span class="music-live-lock" data-host-preview-access>${escapeHtml(liveAccessLabel(form))}</span>
          <h2 data-host-preview-title>${escapeHtml(stream.title)}</h2>
          <p data-host-preview-description>${escapeHtml(stream.description)}</p>
        </div>
        <div class="music-live-host">
          ${renderAvatarImage({ src: stream.hostPhotoURL, name: stream.hostDisplayName, className: 'music-live-avatar' })}
          <div><strong>${escapeHtml(stream.hostDisplayName)}</strong><small><span data-host-preview-category>${escapeHtml(liveCategoryLabel(form.category))}</span> · ${escapeHtml(listenerCountLabel(stream.listenerCount))}</small></div>
        </div>
        ${renderNowPlaying(stream)}
        <div class="music-live-action-bar is-preview-only">
          <button type="button" class="button button-muted" disabled>Like</button>
          <button type="button" class="button button-muted" disabled>Dislike</button>
          <button type="button" class="button button-muted" disabled>Save</button>
          <button type="button" class="button button-muted" disabled>Share</button>
        </div>
      </div>
    </aside>
  `
}

function syncHostPreviewFromForm() {
  const form = state.goLive.form
  const title = app.querySelector('[data-host-preview-title]')
  const description = app.querySelector('[data-host-preview-description]')
  const access = app.querySelector('[data-host-preview-access]')
  const category = app.querySelector('[data-host-preview-category]')
  if (title) title.textContent = form.title || 'Untitled live stream'
  if (description) description.textContent = form.description || 'Your stream description will appear here.'
  if (access) access.textContent = liveAccessLabel(form)
  if (category) category.textContent = liveCategoryLabel(form.category)
}

function renderStreamDetailsControls(form, categories) {
  return `
    <section class="music-host-control-section">
      <div>
        <p class="music-eyebrow">Broadcast setup</p>
        <h2>Stream Details</h2>
      </div>
      <label><span>Category</span><select name="category">${categories.map(([value, label]) => `<option value="${value}" ${form.category === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label><span>Title</span><input name="title" maxlength="90" required placeholder="Tonight on Melogic..." value="${escapeHtml(form.title)}" /></label>
      <label><span>Description</span><textarea name="description" rows="4" maxlength="1200" placeholder="Tell listeners what this stream is about.">${escapeHtml(form.description)}</textarea></label>
      <div class="music-cover-tools">
        <label><span>Cover image URL</span><input name="coverArtURL" placeholder="Optional image URL for this live stream" value="${escapeHtml(form.coverArtURL)}" /></label>
        <div class="music-live-actions">
          <label class="button button-muted music-upload-button"><input type="file" accept="image/*" data-live-cover-upload /> ${state.goLive.uploadingCover ? 'Uploading...' : 'Upload Image'}</label>
          <button type="button" class="button button-muted" data-live-cover-clear>Clear Cover</button>
        </div>
      </div>
      <label><span>Tags</span><input name="tags" placeholder="radio, new music, behind the scenes" value="${escapeHtml(form.tags)}" /></label>
      <div class="music-access-panel">
        <label><span>Access</span><select name="accessMode"><option value="public" ${form.accessMode === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${form.accessMode === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${form.accessMode === 'private' ? 'selected' : ''}>Private</option><option value="password" ${form.accessMode === 'password' ? 'selected' : ''}>Password protected</option></select></label>
        <input type="hidden" name="visibility" value="${form.accessMode === 'private' ? 'private' : form.accessMode === 'unlisted' ? 'unlisted' : 'public'}" />
        ${form.accessMode === 'password' ? `<label><span>Listener password</span><input name="password" type="password" maxlength="200" value="${escapeHtml(form.password)}" placeholder="Listeners need this password to join." /></label>` : ''}
      </div>
      <div class="music-live-rules">
        <strong>Live stream rules</strong>
        <p>Stream only content you have rights to broadcast. No harmful, illegal, abusive, or unauthorized copyrighted audio. Melogic may remove streams that violate rules.</p>
        <label class="music-checkbox"><input type="checkbox" name="rightsAccepted" required ${form.rightsAccepted ? 'checked' : ''} /> <span>I have the rights or permission to broadcast this audio and agree to Melogic live stream rules.</span></label>
        <label class="music-checkbox"><input type="checkbox" name="archiveRequested" disabled ${form.archiveRequested ? 'checked' : ''} /> <span>Request archive after stream. Save as replay is coming soon.</span></label>
      </div>
      <div class="music-live-actions">
        <button type="button" class="button button-muted" data-save-host-details>${state.goLive.streamId ? 'Update Live Info' : state.goLive.draftStreamId ? 'Save Draft' : 'Create Draft'}</button>
      </div>
    </section>
  `
}

function renderAudioControls(form) {
  const isObs = form.streamingMethod !== 'browserWebrtc'
  const streamKey = sanitizeHlsStreamKey(form.streamKey || 'obsfix1')
  const hlsPlaybackUrl = `${getHlsEdgeBaseUrl()}/${streamKey}.m3u8`
  return `
    <section class="music-host-control-section">
      <div>
        <p class="music-eyebrow">Audio input</p>
        <h2>Broadcast Source</h2>
      </div>
      <label><span>Streaming Method</span><select name="streamingMethod" data-live-streaming-method ${state.goLive.streamId ? 'disabled' : ''}><option value="obsRtmp" ${isObs ? 'selected' : ''}>OBS / RTMP Encoder</option><option value="browserWebrtc" ${isObs ? '' : 'selected'}>Browser WebRTC Input</option></select></label>
      ${isObs ? `
        <label><span>Stream Key</span><input name="streamKey" maxlength="160" required value="${escapeHtml(streamKey)}" pattern="[a-z0-9_-]+" autocomplete="off" /></label>
        <div class="music-host-room">
          <h3>OBS / Encoder Settings</h3>
          <p><strong>RTMP server:</strong> <code>${escapeHtml(getRtmpIngestServer())}</code></p>
          <p><strong>Stream key:</strong> <code>${escapeHtml(streamKey)}</code></p>
          <p><strong>Public HLS:</strong> <code>${escapeHtml(hlsPlaybackUrl)}</code></p>
          <p class="music-muted">Start this Melogic stream, then start streaming from OBS. No browser microphone or LiveKit room is used in this mode.</p>
        </div>
      ` : `
        <label><span>Input Source</span><select name="inputSource" data-live-input-source><option value="browser" ${form.inputSource !== 'sequence' ? 'selected' : ''}>Browser Input Source</option><option value="sequence" ${form.inputSource === 'sequence' ? 'selected' : ''}>Sequence Software</option></select></label>
        ${form.inputSource === 'sequence' ? `
          <label><span>Sequence</span><select name="sequenceId" data-live-sequence-source>
            ${state.sequenceWorkspace.sequences.map((sequence) => `<option value="${escapeHtml(sequence.sequenceId)}" ${form.sequenceId === sequence.sequenceId ? 'selected' : ''}>${escapeHtml(sequence.title)}</option>`).join('')}
          </select></label>
          <div class="music-quality-note">Sequence Software creates a Web Audio output track and publishes that one host-side feed to listeners. Audio quality mode is inherited from the selected live stream profile. Listeners do not fetch your sequence asset files.</div>
          <div class="music-live-actions">
            <button type="button" class="button button-muted" data-sequence-play>Play Sequence</button>
            <button type="button" class="button button-muted" data-sequence-stop>Stop Sequence</button>
            <a class="button button-muted" href="${ROUTES.musicSequence}">Open Full Sequence Workspace</a>
          </div>
        ` : ''}
        <label><span>Audio quality mode</span><select name="audioMode"><option value="music" ${form.audioMode !== 'voice' ? 'selected' : ''}>High Quality Music</option><option value="voice" ${form.audioMode === 'voice' ? 'selected' : ''}>Podcast / Voice</option></select></label>
        <p class="music-quality-note">${form.audioMode === 'voice' ? 'Voice mode keeps echo cancellation, noise suppression, and auto gain enabled for speech.' : 'Music mode requests stereo 48 kHz audio when available and disables browser cleanup so your interface or mixer stays natural.'}</p>
        ${form.inputSource === 'sequence' ? '' : `
          <select data-live-device-select>
            <option value="">Browser default</option>
            ${state.goLive.devices.map((device) => `<option value="${escapeHtml(device.deviceId)}" ${state.goLive.selectedDeviceId === device.deviceId ? 'selected' : ''}>${escapeHtml(device.label || `Audio input ${state.goLive.devices.indexOf(device) + 1}`)}</option>`).join('')}
          </select>
          <div class="music-meter" aria-label="Audio input level"><span style="width:${Math.round(state.goLive.level * 100)}%"></span></div>
          <div class="music-live-actions">
            <button type="button" class="button button-muted" data-refresh-audio-devices>Enable / Refresh Mic</button>
            <button type="button" class="button button-muted" data-toggle-preview-mute>${state.goLive.muted ? 'Unmute Preview' : 'Mute Preview'}</button>
          </div>
        `}
      `}
      <p class="music-muted">${escapeHtml(state.goLive.connectionStatus || (isObs ? 'Start the stream here, then send RTMP from OBS.' : 'Choose an audio input before starting.'))}</p>
      ${state.goLive.streamId ? `
        <div class="music-host-room">
          <span class="music-live-badge">LIVE</span>
          <h3>${escapeHtml(state.goLive.connectionStatus || 'Live stream started')}</h3>
          <p class="music-muted">${escapeHtml(audioModeLabel(form.audioMode))} · heartbeat active</p>
          <p>Share: <a href="${musicLiveStreamRoute(state.goLive.streamId)}">${musicLiveStreamRoute(state.goLive.streamId)}</a></p>
          <button type="button" class="button button-danger" data-end-host-stream ${state.goLive.ending ? 'disabled' : ''}>${state.goLive.ending ? 'Ending...' : 'End Stream'}</button>
        </div>
      ` : ''}
    </section>
  `
}

function renderHostChatControls() {
  return state.goLive.streamId
    ? renderLiveChatPanel(state.goLive.streamId)
    : `
      <section class="music-panel music-live-chat music-host-control-section">
        <p class="music-eyebrow">Live chat</p>
        <h2>Chat</h2>
        <p class="music-muted">Chat opens when the broadcast is live. The panel stays here so you can switch to it quickly after starting.</p>
      </section>
    `
}

function renderGoLiveWorkArea(form, categories) {
  if (state.goLive.activeControl === 'audio') return renderAudioControls(form)
  if (state.goLive.activeControl === 'sequence') return renderHostSequencePanel()
  if (state.goLive.activeControl === 'chat') return renderHostChatControls()
  return renderStreamDetailsControls(form, categories)
}

function renderGoLivePage() {
  const isSignedIn = Boolean(state.currentUser)
  const canGoLive = state.accountPermissions?.permissions?.musicLive === true
  const permissionsReady = !state.accountPermissionsLoading
  const form = state.goLive.form
  const categories = [
    ['music', 'Music'],
    ['podcast', 'Podcast'],
    ['radio', 'Radio station'],
    ['interview', 'Interview'],
    ['listening_party', 'Listening party'],
    ['creator_talk', 'Creator talk'],
    ['other', 'Other']
  ]
  renderAppShell(`
    <section class="music-view-header music-live-header">
      <div>
        <p class="music-eyebrow">Creator action</p>
        <h1>Go Live</h1>
        <p>Start an audio-only live stream for listeners inside Melogic Music.</p>
      </div>
      <a class="button button-muted" href="${ROUTES.musicLive}">Live Streams</a>
    </section>
    ${!isSignedIn ? signInAction('Sign in as an eligible creator to start a live stream.') : !permissionsReady ? emptyState('Checking live access', 'Loading your account permissions before opening the live setup.') : !canGoLive ? emptyState('Live streaming is limited to approved creators.', 'Ask the Melogic team to enable live streaming for your account before starting an audio stream.', `<a class="button button-muted" href="${ROUTES.musicLive}">Back to Live Streams</a>`) : `
      <section class="music-go-live-grid">
        <section class="music-panel music-go-live-form music-host-work-area" data-go-live-form>
          <div class="music-host-control-scroll">
            ${renderGoLiveWorkArea(form, categories)}
          </div>
          ${state.goLive.formError ? `<p class="music-live-error">${escapeHtml(state.goLive.formError)}</p>` : ''}
          <div class="music-host-footer">
            <div>
              <strong>${escapeHtml(goLiveStatusLabel())}</strong>
              <span>${escapeHtml(state.goLive.connectionStatus || 'Prepare details, sequence, and audio before starting.')}</span>
            </div>
            <div class="music-live-actions">
              <button class="button button-accent" type="button" data-start-host-broadcast ${state.goLive.starting || state.goLive.streamId ? 'disabled' : ''}>${state.goLive.starting ? 'Starting...' : 'Start Live'}</button>
              ${state.goLive.streamId ? `<button type="button" class="button button-danger" data-end-host-stream ${state.goLive.ending ? 'disabled' : ''}>${state.goLive.ending ? 'Ending...' : 'End Stream'}</button>` : ''}
              <a class="button button-muted" href="${ROUTES.musicLive}">Cancel</a>
            </div>
          </div>
        </section>
        ${renderHostListenerPreview(form)}
        <nav class="music-host-control-rail" aria-label="Live stream controls">
          ${[
            ['details', 'Stream Details'],
            ['audio', 'Microphone / Interface'],
            ['sequence', 'Sequence'],
            ['chat', 'Chat']
          ].map(([value, label]) => `<button type="button" class="${state.goLive.activeControl === value ? 'is-active' : ''}" data-host-control="${value}">${escapeHtml(label)}</button>`).join('')}
        </nav>
      </section>
    `}
  `)
}

function renderPublicLiveMonitorPage() {
  const stream = state.liveStream
  const meta = nowPlayingDisplay(stream || {})
  const hasVideo = streamHasVideoFoundation(stream)
  const metaLine = liveMetaLine(meta, stream || {})
  const brand = '<div class="music-live-monitor-brand">MELOGIC STREAMING</div>'
  const controls = `
    <div class="music-live-monitor-controls" data-live-monitor-controls>
      <button type="button" class="button button-muted" data-live-monitor-audio-toggle>${state.liveMonitor.muted ? 'Unmute music audio' : 'Mute music audio'}</button>
      ${hasVideo ? '<button type="button" class="button button-muted" data-live-monitor-video-fullscreen>Show Video Stream Fullscreen</button>' : ''}
    </div>
  `
  app.innerHTML = `
    <main class="music-live-monitor-page">
      <section class="music-live-monitor-surface ${hasVideo ? 'is-audio-video' : 'is-audio-only'}" data-live-monitor-root>
        <canvas class="music-live-monitor-canvas" data-live-monitor-canvas aria-hidden="true"></canvas>
        ${brand}
        ${hasVideo ? `
          <div class="music-live-monitor-video-layout">
            <div class="music-live-monitor-video-frame" data-live-monitor-video-mount>
              <div class="music-live-monitor-video-empty">Video stream</div>
            </div>
            <aside class="music-live-monitor-side">
              ${renderStableImage({ src: meta.artworkURL, alt: '', className: 'music-live-monitor-art artwork-square', fallback: 'LIVE', key: `public-monitor-${stream?.id || meta.artworkURL || 'live'}` })}
              <div class="music-live-monitor-copy">
                <h1>${escapeHtml(meta.title || stream?.title || 'Melogic Music Live')}</h1>
                <p>${escapeHtml(metaLine)}</p>
                <small>${escapeHtml(stream?.hostDisplayName || 'Streamer Display Name')}</small>
              </div>
            </aside>
          </div>
        ` : `
          <div class="music-live-monitor-core">
            ${renderStableImage({ src: meta.artworkURL, alt: '', className: 'music-live-monitor-art artwork-square', fallback: 'LIVE', key: `public-monitor-${stream?.id || meta.artworkURL || 'live'}` })}
            <div class="music-live-monitor-copy">
              <h1>${escapeHtml(meta.title || stream?.title || 'Melogic Music Live')}</h1>
              <p>${escapeHtml(metaLine)}</p>
              <small>${escapeHtml(stream?.hostDisplayName || 'Streamer Display Name')}</small>
            </div>
            <div class="music-live-monitor-progress" aria-hidden="true"><span></span></div>
          </div>
        `}
        ${controls}
      </section>
    </main>
  `
  hydrateStableImages()
  attachLiveVideoElement()
  bindLiveMonitorControls()
  startMusicLiveMonitorVisualizer()
}

function attachLiveVideoElement(root = app) {
  const video = state.listenerVideoElement
  if (!video) return
  if (state.liveStream?.videoEnabled === false) {
    video.remove()
    state.listenerVideoElement = null
    state.liveVideoExpanded = false
    return
  }
  video.controls = false
  video.autoplay = true
  video.playsInline = true
  const mount = root.querySelector('[data-live-video-mount], [data-live-monitor-video-mount]')
  if (!mount) return
  if (video.parentElement !== mount) {
    mount.innerHTML = ''
    mount.appendChild(video)
  }
  video.play?.().catch(() => {})
}

function bindLiveMonitorControls() {
  const root = app.querySelector('[data-live-monitor-root]')
  if (!root) return
  const controls = app.querySelector('[data-live-monitor-controls]')
  const showControls = () => {
    controls?.classList.add('is-visible')
    if (musicMonitorControlsTimer) window.clearTimeout(musicMonitorControlsTimer)
    musicMonitorControlsTimer = window.setTimeout(() => controls?.classList.remove('is-visible'), 2600)
  }
  root.addEventListener('mousemove', showControls)
  root.addEventListener('pointerdown', showControls)
  showControls()
  app.querySelector('[data-live-monitor-audio-toggle]')?.addEventListener('click', (event) => {
    state.liveMonitor.muted = !state.liveMonitor.muted
    if (state.listenerAudioElement) {
      state.listenerAudioElement.muted = state.liveMonitor.muted
      state.listenerAudioElement.volume = state.player.volume
      if (!state.liveMonitor.muted) state.listenerAudioElement.play?.().catch(() => {})
    }
    event.currentTarget.textContent = state.liveMonitor.muted ? 'Unmute music audio' : 'Mute music audio'
    showControls()
  })
  app.querySelector('[data-live-monitor-video-fullscreen]')?.addEventListener('click', () => {
    const target = state.listenerVideoElement || app.querySelector('[data-live-monitor-root]')
    target?.requestFullscreen?.().catch(() => {})
  })
}

function startMusicLiveMonitorVisualizer() {
  if (musicMonitorVisualizerCleanup) musicMonitorVisualizerCleanup()
  const canvas = app.querySelector('[data-live-monitor-canvas]')
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  let frame = 0
  let animationId = 0
  let analyser = null
  let frequencyData = null
  let audioContext = null
  try {
    if (state.listenerAudioElement && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      audioContext = new AudioContextCtor()
      analyser = audioContext.createAnalyser()
      analyser.fftSize = 128
      const sourceStream = state.listenerAudioElement.srcObject instanceof MediaStream ? state.listenerAudioElement.srcObject : null
      if (!sourceStream) throw new Error('monitor_audio_stream_unavailable')
      const source = audioContext.createMediaStreamSource(sourceStream)
      source.connect(analyser)
      frequencyData = new Uint8Array(analyser.frequencyBinCount)
    }
  } catch {
    analyser = null
    frequencyData = null
    audioContext?.close?.().catch(() => {})
    audioContext = null
  }
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
    let low = 0.32
    let mid = 0.24
    let high = 0.2
    if (analyser && frequencyData) {
      analyser.getByteFrequencyData(frequencyData)
      const avg = (from, to) => {
        const slice = frequencyData.slice(from, to)
        return slice.reduce((sum, value) => sum + value, 0) / Math.max(1, slice.length) / 255
      }
      low = avg(0, 10)
      mid = avg(10, 28)
      high = avg(28, frequencyData.length)
    } else {
      low = 0.28 + Math.sin(frame * 0.018) * 0.14
      mid = 0.24 + Math.sin(frame * 0.026 + 2) * 0.1
      high = 0.18 + Math.sin(frame * 0.04 + 5) * 0.08
    }
    context.clearRect(0, 0, width, height)
    context.fillStyle = '#000'
    context.fillRect(0, 0, width, height)
    const blobs = [
      ['rgba(103,242,170,', 0.18 + low * 0.28, 0.28, 0.32, 0.18 + low * 0.15],
      ['rgba(139,230,255,', 0.12 + high * 0.24, 0.72, 0.25, 0.12 + high * 0.12],
      ['rgba(205,60,203,', 0.1 + mid * 0.22, 0.42, 0.7, 0.16 + mid * 0.12],
      ['rgba(255,255,255,', 0.06 + high * 0.1, 0.62, 0.58, 0.08 + high * 0.08]
    ]
    blobs.forEach(([color, alpha, xBase, yBase, radiusBase], index) => {
      const x = width * (xBase + Math.sin(frame * (0.006 + index * 0.002) + index) * 0.08)
      const y = height * (yBase + Math.cos(frame * (0.005 + index * 0.002) + index * 2) * 0.1)
      const radius = Math.max(width, height) * (radiusBase + (index === 0 ? low : index === 1 ? high : mid) * 0.16)
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
  musicMonitorVisualizerCleanup = () => {
    window.cancelAnimationFrame(animationId)
    window.removeEventListener('resize', resize)
    audioContext?.close?.().catch(() => {})
    musicMonitorVisualizerCleanup = null
  }
}

function renderLiveDetailPage() {
  const stream = state.liveStream
  if (state.loading) {
    renderAppShell('<section class="music-detail-state"><h1>Loading live stream...</h1></section>')
    return
  }
  if (!stream) {
    renderAppShell(emptyState('Live stream unavailable', 'This stream may have ended, been removed, or never existed.', `<a class="button button-accent" href="${ROUTES.musicLive}">Back to Live Streams</a>`))
    return
  }
  const playbackInfo = getPublicPlaybackInfo(stream)
  const isNativeStream = playbackInfo.provider === STREAM_PROVIDERS.firebaseSegments
  const isBufferedStream = playbackInfo.provider === STREAM_PROVIDERS.hlsEdge
  const listenerAccessAllowed = !['removed', 'blocked'].includes(stream.moderationStatus)
    && (stream.visibility === 'public' || stream.accessMode === 'password' || stream.accessMode === 'unlisted')
  const canListen = isBufferedStream
    ? listenerAccessAllowed && (stream.status === 'live' || Boolean(playbackInfo.url))
    : isNativeStream
      ? stream.status === 'live' && listenerAccessAllowed
      : stream.hostConnected === true && isLiveStreamFresh(stream) && isPublicStreamPlayable(stream)
  const hasVideo = isBufferedStream ? currentHlsPlaybackMode() !== 'audioOnly' : streamHasVideoFoundation(stream)
  const visual = isBufferedStream && hasVideo
    ? '<div class="music-live-visual music-live-hls-video"><div data-hls-player-mount></div></div>'
    : hasVideo
    ? `<button type="button" class="music-live-visual ${state.liveVideoExpanded ? 'is-expanded' : ''}" data-live-video-hero aria-label="${isLiveListeningStatus() ? 'Show video stream' : 'Click to watch stream'}"><span>Click to Watch Stream</span><div data-live-video-mount></div></button>`
    : renderLiveArtwork(stream, 'music-live-detail-art')
  const liveBadge = canListen ? nativeLiveStatusLabel(stream) : 'ENDED'
  renderAppShell(`
    <section class="music-live-detail ${hasVideo ? 'has-video-foundation' : ''} ${state.liveVideoExpanded ? 'is-video-expanded' : ''}">
      <div class="music-live-visual-shell">
        ${visual}
        ${!isBufferedStream && hasVideo && state.liveVideoExpanded ? '<button type="button" class="button button-muted music-live-hide-video" data-live-hide-video>Hide Video</button>' : ''}
      </div>
      <div class="music-live-detail-copy">
        ${hasVideo ? `<div class="music-live-video-identity">${renderLiveArtwork(stream, 'music-live-video-cover')}<div><span class="music-live-badge ${isNativeStream ? 'is-native' : ''}">${escapeHtml(liveBadge)}</span><strong>${escapeHtml(stream.hostDisplayName)}</strong></div></div>` : ''}
        ${hasVideo ? '' : `<span class="music-live-badge ${isNativeStream ? 'is-native' : ''}">${escapeHtml(liveBadge)}</span>`}
        <h1>${escapeHtml(stream.title)}</h1>
        <p>${escapeHtml(stream.description || 'Live stream on Melogic Music.')}</p>
        <div class="music-live-host">
          ${renderAvatarImage({ src: stream.hostPhotoURL, name: stream.hostDisplayName, className: 'music-live-avatar' })}
          <div><strong>${escapeHtml(stream.hostDisplayName)}</strong><small>${escapeHtml(liveCategoryLabel(stream.category))} · ${escapeHtml(listenerCountLabel(stream.listenerCount))}${stream.passwordProtected ? ' · Password required' : ''}</small></div>
        </div>
        ${renderNowPlaying(stream)}
        <div class="music-tag-row">${stream.tags.length ? stream.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('') : `<span>${hasVideo ? 'Live stream' : 'Live audio'}</span>`}</div>
        ${isBufferedStream ? renderHlsPlaybackModeControl() : ''}
        ${stream.passwordProtected && !isLiveListeningStatus() ? `
          <form class="music-password-form" data-live-password-form>
            <label><span>Stream password</span><input name="password" type="password" value="${escapeHtml(state.livePassword)}" placeholder="Enter password to listen" /></label>
          </form>
        ` : ''}
        <div class="music-live-listener">
          <button type="button" class="button button-accent" data-live-listen ${canListen ? '' : 'disabled'}>${isLiveListeningStatus() ? 'Pause / Leave' : isBufferedStream ? 'Play' : 'Listen'}</button>
          ${isBufferedStream && currentHlsPlaybackMode() === 'videoOnly' ? '' : `<label class="music-player-volume"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value="${state.player.volume}" data-live-volume /></label>`}
        </div>
        ${isBufferedStream ? renderHlsDiagnostics() : isNativeStream ? renderNativeReceiverAudioDebug() : renderLiveKitReceiverAudioDebug()}
        ${renderLiveActions(stream)}
        ${state.liveError ? `<p class="music-live-error">${escapeHtml(state.liveError)}</p>` : `<p class="music-muted" data-live-status>${escapeHtml(canListen ? liveStatusLabel(stream) : isBufferedStream && playbackInfo.message ? playbackInfo.message : 'This stream has ended or is no longer public.')}</p>`}
      </div>
    </section>
    ${renderLiveGuestInvitePrompt(stream)}
    ${renderLiveChatPanel(stream.id)}
  `)
  if (isBufferedStream && state.hlsMediaElement) ensureHlsMediaMounted()
  if (!isBufferedStream && isNativeStream && state.listenerAudioElement) ensureNativeListenerAudioElement()
  if (!isBufferedStream && !isNativeStream && state.listenerAudioElement) ensureLiveKitListenerAudioMounted()
}

function renderHlsPlaybackModeControl() {
  const mode = currentHlsPlaybackMode()
  const labels = {
    videoAudio: 'Video & Audio',
    videoOnly: 'Video Only',
    audioOnly: 'Audio Only'
  }
  const note = mode === 'videoOnly'
    ? 'Video Only - audio muted.'
    : mode === 'audioOnly'
      ? 'Audio Only uses the live stream audio track. A dedicated audio-only stream can be added later for lower bandwidth.'
      : ''
  return `
    <section class="music-live-hls-controls" aria-label="Playback mode">
      <div class="music-live-hls-mode" role="radiogroup" aria-label="Playback mode">
        ${Object.entries(labels).map(([value, label]) => `<button type="button" role="radio" aria-checked="${mode === value}" class="${mode === value ? 'is-active' : ''}" data-hls-playback-mode="${value}">${label}</button>`).join('')}
      </div>
      ${mode === 'audioOnly' ? '<div class="music-live-hls-audio" data-hls-player-mount></div>' : ''}
      ${note ? `<p class="music-muted">${escapeHtml(note)}</p>` : ''}
    </section>
  `
}

function renderHlsDiagnostics() {
  const diagnostics = hlsMediaDiagnostics()
  const media = state.hlsMediaElement
  const shouldShowResume = Boolean(media && media.paused && isLiveListeningStatus())
  const rows = [
    ['provider', diagnostics.provider || STREAM_PROVIDERS.hlsEdge],
    ['ingestMethod', diagnostics.ingestMethod || state.liveStream?.ingestMethod || 'unknown'],
    ['playbackMode', diagnostics.playbackMode || 'hls'],
    ['streamKey', diagnostics.streamKey || state.liveStream?.streamKey || 'none'],
    ['hlsPlaybackUrl', diagnostics.hlsPlaybackUrl || getPublicPlaybackInfo(state.liveStream || {}).url || 'none'],
    ['hlsUrl', diagnostics.hlsUrl || getPublicPlaybackInfo(state.liveStream || {}).url || 'none'],
    ['selectedPlayer', diagnostics.selectedPlayer || 'hls'],
    ['computedHlsUrl', diagnostics.computedHlsUrl || getPublicPlaybackInfo(state.liveStream || {}).url || 'none'],
    ['normalizationApplied', diagnostics.normalizationApplied],
    ['rawPlaybackMode', diagnostics.rawPlaybackMode || 'none'],
    ['rawProvider', diagnostics.rawProvider || 'none'],
    ['rawStreamKey', diagnostics.rawStreamKey || 'none'],
    ['rawHlsPlaybackUrl', diagnostics.rawHlsPlaybackUrl || 'none'],
    ['playbackModeSelected', diagnostics.playbackModeSelected || currentHlsPlaybackMode()],
    ['nativeHlsSupported', diagnostics.nativeHlsSupported],
    ['hlsJsSupported', diagnostics.hlsJsSupported],
    ['hlsManifestLoaded', diagnostics.hlsManifestLoaded],
    ['hlsLevelCount', diagnostics.hlsLevelCount],
    ['mediaCurrentSrc', diagnostics.mediaCurrentSrc],
    ['mediaPaused', diagnostics.mediaPaused],
    ['mediaMuted', diagnostics.mediaMuted],
    ['mediaVolume', diagnostics.mediaVolume],
    ['mediaReadyState', diagnostics.mediaReadyState],
    ['mediaNetworkState', diagnostics.mediaNetworkState],
    ['mediaCurrentTime', diagnostics.mediaCurrentTime],
    ['mediaDuration', diagnostics.mediaDuration],
    ['mediaPlaying', diagnostics.mediaPlaying],
    ['lastMediaEvent', diagnostics.lastMediaEvent],
    ['lastHlsErrorType', diagnostics.lastHlsErrorType],
    ['lastHlsErrorDetails', diagnostics.lastHlsErrorDetails],
    ['lastHlsErrorFatal', diagnostics.lastHlsErrorFatal],
    ['lastHlsResponseCode', diagnostics.lastHlsResponseCode],
    ['lastHlsResponseUrl', diagnostics.lastHlsResponseUrl]
  ]
  return `
    <details class="music-live-native-debug">
      <summary>HLS diagnostics</summary>
      <dl>${rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd data-hls-diagnostic="${escapeHtml(key)}">${escapeHtml(value === true ? 'yes' : value === false ? 'no' : value == null || value === '' ? 'none' : String(value))}</dd></div>`).join('')}</dl>
      ${shouldShowResume ? '<button type="button" class="button button-muted" data-hls-resume>Play / Resume</button>' : ''}
    </details>
  `
}

function renderLiveKitReceiverAudioDebug() {
  const diagnostics = state.nativeListenerDiagnostics || {}
  const audio = state.listenerAudioElement
  const shouldShowResume = Boolean(
    diagnostics.lastPlayErrorName === 'NotAllowedError' ||
    state.liveStatus === 'playbackBlocked' ||
    state.liveStatus === 'readyToPlay' ||
    (audio && audio.paused === true && isLiveListeningStatus())
  )
  const rows = [
    ['provider', diagnostics.provider || STREAM_PROVIDERS.nativeWeb],
    ['room connection state', diagnostics.roomConnectionState || state.listenerRoom?.state || state.listenerRoom?.connectionState || 'disconnected'],
    ['token received', diagnostics.tokenReceived === true ? 'yes' : diagnostics.tokenReceived === false ? 'no' : 'unknown'],
    ['playbackDemand write succeeded', diagnostics.demandWriteSucceeded === true ? 'yes' : diagnostics.demandWriteSucceeded === false ? 'no' : 'unknown'],
    ['viewerSessionId', diagnostics.demandSessionId || state.nativeViewerSessionId || 'none'],
    ['subscribed audio track', diagnostics.subscribedAudioTrack === true ? 'yes' : 'no'],
    ['remote participant', diagnostics.remoteParticipantIdentity || 'none'],
    ['remote track', diagnostics.remoteTrackSid ? `${diagnostics.remoteTrackName || 'audio'} (${diagnostics.remoteTrackSid})` : 'none'],
    ['remote kind', diagnostics.remoteTrackKind || 'none'],
    ['audio element exists', audio ? 'yes' : 'no'],
    ['audio paused', String(diagnostics.audioPaused ?? audio?.paused ?? 'unknown')],
    ['audio muted', String(diagnostics.audioMuted ?? audio?.muted ?? 'unknown')],
    ['audio volume', String(diagnostics.audioVolume ?? audio?.volume ?? 'unknown')],
    ['audio readyState', String(diagnostics.audioReadyState ?? audio?.readyState ?? 'unknown')],
    ['last play result', diagnostics.lastPlayResult || 'none'],
    ['last play error', diagnostics.lastPlayErrorName ? `${diagnostics.lastPlayErrorName}: ${diagnostics.lastPlayErrorMessage || ''}` : 'none'],
    ['last audio event', diagnostics.lastAudioEvent || 'none']
  ]
  return `
    <div class="music-live-native-audio-debug">
      <div data-livekit-audio-mount></div>
      ${shouldShowResume ? '<button type="button" class="button button-muted" data-livekit-audio-resume>Resume Audio</button>' : ''}
      <details>
        <summary>LiveKit receiver diagnostics</summary>
        <ul>${rows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>
      </details>
    </div>
  `
}

function renderNativeReceiverAudioDebug() {
  const diagnostics = state.nativeListenerDiagnostics || {}
  const audio = state.listenerAudioElement
  const shouldShowResume = Boolean(
    diagnostics.lastPlayErrorName === 'NotAllowedError' ||
    (audio && audio.paused === true && isLiveListeningStatus()) ||
    (Number(diagnostics.readySegmentCount || 0) > 0 && !isNativeRealSegmentAudioPlaying())
  )
  const rows = [
    ['unlock attempted', diagnostics.userGestureUnlockAttempted === true ? 'yes' : 'no'],
    ['unlock succeeded', diagnostics.userGestureUnlockSucceeded === true ? 'yes' : 'no'],
    ['last play attempt', diagnostics.lastPlayAttemptAt || 'none'],
    ['last play resolved', diagnostics.lastPlayResolvedAt || 'none'],
    ['last play rejected', diagnostics.lastPlayRejectedAt || 'none'],
    ['last play error', diagnostics.lastPlayErrorName ? `${diagnostics.lastPlayErrorName}: ${diagnostics.lastPlayErrorMessage || ''}` : 'none'],
    ['audio paused', String(diagnostics.audioPaused ?? audio?.paused ?? 'unknown')],
    ['audio muted', String(diagnostics.audioMuted ?? audio?.muted ?? 'unknown')],
    ['audio volume', String(diagnostics.audioVolume ?? audio?.volume ?? 'unknown')],
    ['audio readyState', String(diagnostics.audioReadyState ?? audio?.readyState ?? 'unknown')],
    ['audio currentSrc', diagnostics.audioCurrentSrc || audio?.currentSrc || 'none'],
    ['audio error', diagnostics.audioErrorCode ? `${diagnostics.audioErrorCode}: ${diagnostics.audioErrorMessage || ''}` : 'none'],
    ['currentSrc is MediaSource blob', diagnostics.currentSrcIsMediaSourceBlob === true ? 'yes' : 'no'],
    ['last audio event', diagnostics.lastAudioEvent || 'none'],
    ['mediaSourceSupported', diagnostics.mediaSourceSupported === true ? 'yes' : diagnostics.mediaSourceSupported === false ? 'no' : 'unknown'],
    ['selectedSourceBufferMime', diagnostics.selectedSourceBufferMime || 'none'],
    ['sourceOpenAt', diagnostics.sourceOpenAt || 'none'],
    ['sourceBufferCreated', diagnostics.sourceBufferCreated === true ? 'yes' : diagnostics.sourceBufferCreated === false ? 'no' : 'unknown'],
    ['sourceBufferUpdating', String(diagnostics.sourceBufferUpdating ?? 'unknown')],
    ['appendQueueLength', String(diagnostics.appendQueueLength ?? 0)],
    ['appendedSegmentIndexes', Array.isArray(diagnostics.appendedSegmentIndexes) ? diagnostics.appendedSegmentIndexes.join(', ') : 'none'],
    ['lastAppendIndex', String(diagnostics.lastAppendIndex ?? 'none')],
    ['lastAppendByteLength', String(diagnostics.lastAppendByteLength ?? 'none')],
    ['lastAppendError', diagnostics.lastAppendErrorName ? `${diagnostics.lastAppendErrorName}: ${diagnostics.lastAppendErrorMessage || ''}` : 'none'],
    ['mediaSourceReadyState', diagnostics.mediaSourceReadyState || 'none'],
    ['readySegmentCount', String(diagnostics.readySegmentCount ?? 0)],
    ['currentSegmentIndex', String(diagnostics.currentSegmentIndex ?? 'none')]
  ]
  return `
    <div class="music-live-native-audio-debug">
      <div data-native-audio-mount></div>
      ${shouldShowResume ? '<button type="button" class="button button-muted" data-native-audio-resume>Resume Audio</button>' : ''}
      <details>
        <summary>Receiver audio diagnostics</summary>
        <ul>${rows.map(([label, value]) => `<li><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</li>`).join('')}</ul>
      </details>
    </div>
  `
}

function renderLiveGuestInvitePrompt(stream = {}) {
  const invite = state.guestInvite
  if (!invite || ['dismissed', 'declined'].includes(invite.status)) return ''
  return `
    <section class="music-live-guest-card">
      <div>
        <span class="music-live-badge">BACKSTAGE</span>
        <h2>You were invited as a guest</h2>
        <p>The host can add your audio or video to their private Program Mixer. You never publish directly to the public stream.</p>
        <small>Status: ${escapeHtml(invite.status || 'invited')}</small>
      </div>
      <div class="music-live-guest-actions">
        <button type="button" class="button button-accent" data-open-guest-setup>${invite.status === 'ready' ? 'Update Setup' : 'Set Up Guest'}</button>
        <button type="button" class="button button-muted" data-dismiss-guest-invite>Dismiss</button>
      </div>
    </section>
    ${state.guestSetupOpen ? renderLiveGuestSetupModal(stream, invite) : ''}
  `
}

function renderLiveGuestSetupModal(stream = {}, invite = {}) {
  return `
    <div class="music-modal" data-guest-setup-modal>
      <form class="music-modal-panel music-live-guest-setup" data-guest-setup-form>
        <header>
          <div><span class="music-live-badge">BACKSTAGE</span><h3>Guest Setup</h3></div>
          <button type="button" data-close-guest-setup aria-label="Close guest setup">×</button>
        </header>
        <label>Display name<input name="displayName" maxlength="80" value="${escapeHtml(invite.guestDisplayName || state.currentUser?.displayName || '')}" /></label>
        <label class="music-live-check"><input type="checkbox" name="audioReady" checked /> Audio ready</label>
        <label class="music-live-check"><input type="checkbox" name="videoReady" /> Video ready</label>
        <label class="music-live-check"><input type="checkbox" name="muted" /> Join muted</label>
        <p class="music-muted">Ready status tells ${escapeHtml(stream.hostDisplayName || 'the host')} you are available backstage. Public routing stays under host control.</p>
        ${state.guestSetupStatus ? `<p class="music-muted">${escapeHtml(state.guestSetupStatus)}</p>` : ''}
        <div class="music-modal-actions">
          <button type="button" class="button button-muted" data-close-guest-setup>Cancel</button>
          <button type="submit" class="button button-accent">Mark Ready</button>
        </div>
      </form>
    </div>
  `
}

function renderPlayer() {
  if (!shouldShowGlobalMusicPlayer()) return ''
  if (state.listenerRoom && state.liveStream?.id) {
    const meta = nowPlayingDisplay(state.liveStream)
    return `
      <aside class="music-player" data-music-player aria-label="Melogic Music live player">
      <div class="music-player-art">
          ${renderStableImage({ src: meta.artworkURL, alt: '', className: 'music-player-stable-art', fallback: 'LIVE', key: `player-live-${state.liveStream.id}` })}
        </div>
        <div class="music-player-meta">
          <strong>${escapeHtml(meta.title || state.liveStream.title)}</strong>
          <span>${escapeHtml(meta.artist || state.liveStream.hostDisplayName)} · Live</span>
        </div>
        <button type="button" class="button button-accent" data-live-global-toggle>${isLiveListeningStatus() ? 'Pause' : 'Play'}</button>
        <span class="music-live-badge">LIVE</span>
        <label class="music-player-volume">
          <span>Volume</span>
          <input type="range" min="0" max="1" step="0.01" value="${state.player.volume}" data-live-volume />
        </label>
        <button type="button" class="button button-muted" data-live-global-stop>Stop</button>
      </aside>
    `
  }
  const track = state.player.track
  return `
    <aside class="music-player" data-music-player aria-label="Melogic Music player">
      <div class="music-player-art">
        ${track?.coverArtURL ? `<img src="${escapeHtml(track.coverArtURL)}" alt="" />` : '<span aria-hidden="true">MR</span>'}
      </div>
      <div class="music-player-meta">
        <strong>${escapeHtml(track?.title || 'No track selected')}</strong>
        <span>${escapeHtml(track?.artistName || 'Choose a playable track to start.')}</span>
      </div>
      <button type="button" class="button button-accent" data-player-toggle ${track ? '' : 'disabled'}>${state.player.playing ? 'Pause' : 'Play'}</button>
      <label class="music-player-progress">
        <span>${escapeHtml(formatDuration(state.player.currentTime))}</span>
        <input type="range" min="0" max="${Math.max(1, state.player.duration || track?.duration || 1)}" value="${Math.min(state.player.currentTime || 0, state.player.duration || track?.duration || 1)}" step="1" data-player-seek ${track ? '' : 'disabled'} />
        <span>${escapeHtml(formatDuration(state.player.duration || track?.duration || 0))}</span>
      </label>
      <label class="music-player-volume">
        <span>Volume</span>
        <input type="range" min="0" max="1" step="0.01" value="${state.player.volume}" data-player-volume />
      </label>
      <button type="button" class="button button-muted" data-player-clear ${track ? '' : 'disabled'}>Stop</button>
    </aside>
  `
}

function rerender() {
  if (state.route.mode !== 'liveMonitor' && musicMonitorVisualizerCleanup) musicMonitorVisualizerCleanup()
  if (state.route.mode === 'release') renderReleaseDetailPage()
  else if (state.route.mode === 'liveMonitor') {
    renderPublicLiveMonitorPage()
    return
  }
  else if (state.route.mode === 'goLive') {
    state.route = { mode: 'liveList', id: '' }
    window.history.replaceState({}, '', ROUTES.musicLive)
    renderLandingPage()
  }
  else if (state.route.mode === 'sequence') renderSequenceWorkspacePage()
  else if (state.route.mode === 'liveDetail') renderLiveDetailPage()
  else renderLandingPage()
  initShellChrome()
  hydrateStableImages()
  attachLiveVideoElement()
  bindMusicEvents()
  attachMusicHeroVideo()
}

function ensureAudio(track) {
  if (!track?.streamAudioURL) return null
  if (state.player.audio) {
    state.player.audio.pause()
    state.player.audio.removeAttribute('src')
  }
  const audio = new Audio(track.streamAudioURL)
  audio.preload = 'metadata'
  audio.volume = state.player.volume
  audio.addEventListener('timeupdate', () => {
    state.player.currentTime = audio.currentTime || 0
    state.player.duration = audio.duration || track.duration || 0
    updatePlayerControls()
  })
  audio.addEventListener('loadedmetadata', () => {
    state.player.duration = audio.duration || track.duration || 0
    updatePlayerControls()
  })
  audio.addEventListener('ended', () => {
    state.player.playing = false
    updatePlayerControls()
  })
  state.player.audio = audio
  return audio
}

function updatePlayerControls() {
  const player = app.querySelector('[data-music-player]')
  if (!player) return
  const title = player.querySelector('.music-player-meta strong')
  const artist = player.querySelector('.music-player-meta span')
  const art = player.querySelector('.music-player-art')
  const toggle = player.querySelector('[data-player-toggle]')
  const seek = player.querySelector('[data-player-seek]')
  const timeSpans = player.querySelectorAll('.music-player-progress span')
  const clear = player.querySelector('[data-player-clear]')
  const track = state.player.track
  if (title) title.textContent = track?.title || 'No track selected'
  if (artist) artist.textContent = track?.artistName || 'Choose a playable track to start.'
  if (art) art.innerHTML = track?.coverArtURL ? `<img src="${escapeHtml(track.coverArtURL)}" alt="" />` : '<span aria-hidden="true">MR</span>'
  if (toggle) {
    toggle.textContent = state.player.playing ? 'Pause' : 'Play'
    toggle.disabled = !track
  }
  if (seek) {
    seek.max = String(Math.max(1, state.player.duration || track?.duration || 1))
    seek.value = String(Math.min(state.player.currentTime || 0, state.player.duration || track?.duration || 1))
    seek.disabled = !track
  }
  if (timeSpans[0]) timeSpans[0].textContent = formatDuration(state.player.currentTime)
  if (timeSpans[1]) timeSpans[1].textContent = formatDuration(state.player.duration || track?.duration || 0)
  if (clear) clear.disabled = !track
}

async function toggleTrack(track) {
  if (!track?.streamAudioURL) return
  if (state.player.track?.id === track.id && state.player.audio) {
    if (state.player.playing) {
      state.player.audio.pause()
      state.player.playing = false
    } else {
      await state.player.audio.play()
      state.player.playing = true
    }
    rerender()
    return
  }
  state.player.track = track
  state.player.currentTime = 0
  state.player.duration = track.duration || 0
  const audio = ensureAudio(track)
  if (!audio) return
  await audio.play()
  state.player.playing = true
  rerender()
}

function clearPlayer() {
  if (state.player.audio) {
    state.player.audio.pause()
    state.player.audio.removeAttribute('src')
  }
  state.player.track = null
  state.player.audio = null
  state.player.playing = false
  state.player.currentTime = 0
  state.player.duration = 0
  rerender()
}

function stopPreviewMeter() {
  if (state.goLive.meterAnimationId) cancelAnimationFrame(state.goLive.meterAnimationId)
  state.goLive.meterAnimationId = 0
  if (state.goLive.previewAudioContext) state.goLive.previewAudioContext.close().catch(() => {})
  state.goLive.previewAudioContext = null
  state.goLive.meterAnalyser = null
}

function startPreviewMeter(stream) {
  stopPreviewMeter()
  const AudioContextClass = window.AudioContext || window.webkitAudioContext
  if (!AudioContextClass || !stream) return
  const context = new AudioContextClass()
  const analyser = context.createAnalyser()
  analyser.fftSize = 256
  context.createMediaStreamSource(stream).connect(analyser)
  state.goLive.previewAudioContext = context
  state.goLive.meterAnalyser = analyser
  const data = new Uint8Array(analyser.frequencyBinCount)
  const tick = () => {
    analyser.getByteFrequencyData(data)
    const sum = data.reduce((total, value) => total + value, 0)
    state.goLive.level = Math.min(1, (sum / data.length) / 120)
    const meter = app.querySelector('.music-meter span')
    if (meter) meter.style.width = `${Math.round(state.goLive.level * 100)}%`
    state.goLive.meterAnimationId = requestAnimationFrame(tick)
  }
  tick()
}

function stopPreviewStream() {
  stopPreviewMeter()
  if (state.goLive.previewStream) {
    state.goLive.previewStream.getTracks().forEach((track) => track.stop())
  }
  state.goLive.previewStream = null
}

function updateGoLiveFormState(form = app.querySelector('[data-go-live-form]')) {
  if (!form) return
  const controls = Array.from(form.querySelectorAll ? form.querySelectorAll('input, select, textarea') : [])
    .filter((control) => !control.closest('[data-live-sequence-form], [data-live-chat-form], [data-live-edit-form]'))
  const hasControl = (name) => controls.some((control) => control.name === name)
  const read = (name, fallback = '') => {
    const control = controls.find((item) => item.name === name)
    if (!control) return fallback
    if (control.type === 'checkbox') return control.checked ? 'on' : ''
    return control.value
  }
  const nextCoverURL = String(read('coverArtURL', state.goLive.form.coverArtURL) || '').slice(0, 1000)
  const previousCoverURL = state.goLive.form.coverArtURL
  const previousCoverSource = state.goLive.form.coverArtSource
  state.goLive.form = {
    category: String(read('category', state.goLive.form.category) || 'music'),
    audioMode: String(read('audioMode', state.goLive.form.audioMode) || 'music') === 'voice' ? 'voice' : 'music',
    inputSource: String(read('inputSource', state.goLive.form.inputSource) || 'browser') === 'sequence' ? 'sequence' : 'browser',
    sequenceId: String(read('sequenceId', state.goLive.form.sequenceId) || state.goLive.form.sequenceId || ''),
    accessMode: String(read('accessMode', state.goLive.form.accessMode) || 'public'),
    password: String(read('password', state.goLive.form.password) || '').slice(0, 200),
    title: String(read('title', state.goLive.form.title) || '').slice(0, 90),
    description: String(read('description', state.goLive.form.description) || '').slice(0, 1200),
    coverArtURL: nextCoverURL,
    coverArtPath: state.goLive.form.coverArtPath || '',
    coverArtSource: nextCoverURL ? (previousCoverSource === 'upload' && nextCoverURL === previousCoverURL ? 'upload' : 'url') : 'fallback',
    tags: String(read('tags', state.goLive.form.tags) || '').slice(0, 500),
    visibility: String(read('visibility', state.goLive.form.visibility) || 'public'),
    streamingProtocol: String(read('streamingProtocol', state.goLive.form.streamingProtocol) || 'hls'),
    streamingMethod: String(read('streamingMethod', state.goLive.form.streamingMethod) || 'obsRtmp'),
    streamKey: String(read('streamKey', state.goLive.form.streamKey) || 'obsfix1'),
    rightsAccepted: hasControl('rightsAccepted') ? read('rightsAccepted') === 'on' : state.goLive.form.rightsAccepted,
    archiveRequested: hasControl('archiveRequested') ? read('archiveRequested') === 'on' : state.goLive.form.archiveRequested
  }
}

async function refreshAudioDevices() {
  updateGoLiveFormState()
  if (!navigator.mediaDevices?.getUserMedia) {
    state.goLive.formError = 'This browser does not support audio input selection.'
    rerender()
    return
  }
  stopPreviewStream()
  try {
    let stream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraintsForMode({ deviceId: state.goLive.selectedDeviceId }),
        video: false
      })
    } catch (error) {
      console.warn('[music] ideal audio constraints failed; retrying basic mic constraints.', error?.message || error)
      stream = await navigator.mediaDevices.getUserMedia({
        audio: audioConstraintsForMode({ deviceId: state.goLive.selectedDeviceId, relaxed: true }),
        video: false
      })
    }
    state.goLive.previewStream = stream
    stream.getAudioTracks().forEach((track) => { track.enabled = !state.goLive.muted })
    const devices = await navigator.mediaDevices.enumerateDevices()
    state.goLive.devices = devices.filter((device) => device.kind === 'audioinput')
    state.goLive.connectionStatus = 'Audio input ready. Start Live when your details are set.'
    state.goLive.formError = ''
    startPreviewMeter(stream)
    rerender()
  } catch (error) {
    state.goLive.formError = error?.message || 'Microphone permission is required to go live.'
    state.goLive.connectionStatus = 'Mic permission missing.'
    rerender()
  }
}

async function refreshHostUnloadToken() {
  if (!state.currentUser) return ''
  state.goLive.unloadToken = await state.currentUser.getIdToken().catch(() => state.goLive.unloadToken || '')
  return state.goLive.unloadToken
}

function stopHostHeartbeat() {
  if (state.goLive.heartbeatTimer) window.clearInterval(state.goLive.heartbeatTimer)
  state.goLive.heartbeatTimer = 0
}

function startHostHeartbeat(streamId) {
  stopHostHeartbeat()
  if (!streamId) return
  const beat = () => {
    const isObs = state.goLive.form.streamingMethod !== 'browserWebrtc'
    const payload = normalizeHlsLivePayload({
      streamId,
      audioPublished: isObs ? true : Boolean(state.goLive.localTrack),
      programHasAudio: isObs ? true : Boolean(state.goLive.localTrack),
      streamingMethod: state.goLive.form.streamingMethod || 'obsRtmp',
      streamKey: state.goLive.form.streamKey || 'obsfix1',
      connectionStatus: state.goLive.connectionStatus === 'Reconnecting...' ? 'reconnecting' : 'live'
    })
    heartbeatMusicLiveStream(streamId, payload).catch((error) => {
      console.warn('[music] heartbeatMusicLiveStream failed', error?.message || error)
    })
    refreshHostUnloadToken().catch(() => {})
  }
  beat()
  state.goLive.heartbeatTimer = window.setInterval(beat, 15000)
}

function sendHostUnloadSignal(reason = 'host_unload') {
  if (!state.goLive.streamId) return
  sendMusicLiveUnloadBeacon({
    streamId: state.goLive.streamId,
    idToken: state.goLive.unloadToken,
    reason
  })
}

function startLiveChatSubscription(streamId) {
  stopLiveChatSubscription()
  if (!streamId || !state.currentUser) return
  state.liveChat.unsubscribe = subscribeMusicLiveChat(
    streamId,
    (messages) => {
      const list = app.querySelector('[data-live-chat-messages]')
      const shouldStick = !list || list.scrollHeight - list.scrollTop - list.clientHeight < 80
      state.liveChat.messages = messages
      state.liveChat.error = ''
      rerender()
      if (shouldStick) {
        requestAnimationFrame(() => {
          const nextList = app.querySelector('[data-live-chat-messages]')
          if (nextList) nextList.scrollTop = nextList.scrollHeight
        })
      }
    },
    () => {
      state.liveChat.error = 'Live chat is unavailable for this stream.'
      rerender()
    }
  )
}

function startLiveStreamSubscription(streamId) {
  stopLiveStreamSubscription()
  if (!streamId) return
  state.liveStreamUnsubscribe = subscribeMusicLiveStream(
    streamId,
    (stream) => {
      if (stream?.videoEnabled !== true && state.listenerVideoElement) {
        state.listenerVideoElement.remove()
        state.listenerVideoElement = null
        state.liveVideoExpanded = false
      }
      const playbackInfo = getPublicPlaybackInfo(stream || {})
      const isNativeStream = playbackInfo.provider === STREAM_PROVIDERS.firebaseSegments
      const isBufferedStream = playbackInfo.provider === STREAM_PROVIDERS.hlsEdge
      const playable = Boolean(stream && (isBufferedStream
        ? stream.status === 'live' || playbackInfo.url
        : stream.hostConnected === true && isLiveStreamFresh(stream) && isPublicStreamPlayable(stream)))
      if (!playable) {
        state.liveStream = stream
        if (isNativeStream && stream?.status === 'live') {
          state.liveStatus = ['live', 'buffering', 'waiting'].includes(state.liveStatus) ? state.liveStatus : 'idle'
          state.liveError = nativePlaybackWaitMessage(stream)
        } else if (isBufferedStream && stream?.status === 'live') {
          disconnectLiveListener()
          state.liveStatus = 'error'
          state.liveError = getPublicPlaybackInfo(stream).message || 'Could not load the live stream playlist.'
        } else {
          disconnectLiveListener()
          state.liveStatus = 'ended'
          state.liveError = 'This stream has ended or is no longer public.'
          stopLiveChatSubscription()
        }
        rerender()
        return
      }
      state.liveStream = stream
      if (state.liveStatus !== 'error' && state.liveStatus !== 'playbackBlocked') state.liveError = ''
      updateLiveMediaSession(stream)
      rerender()
    },
    () => {
      disconnectLiveListener()
      state.liveStream = null
      state.liveStatus = 'ended'
      state.liveError = 'This stream has ended or is no longer public.'
      stopLiveChatSubscription()
      rerender()
    }
  )
}

function startHostStreamSubscription(streamId) {
  stopLiveStreamSubscription()
  if (!streamId) return
  state.liveStreamUnsubscribe = subscribeMusicLiveStream(
    streamId,
    (stream) => {
      state.liveStream = stream
      if (stream?.currentNowPlaying) updateLiveMediaSession(stream)
      rerender()
    },
    () => {
      state.liveStream = null
      rerender()
    }
  )
}

function startLiveSequenceSubscription(streamId) {
  stopLiveSequenceSubscription()
  if (!streamId) return
  state.liveSequence.unsubscribe = subscribeMusicLiveSequenceItems(
    streamId,
    (items) => {
      state.liveSequence.items = items
      rerender()
    },
    () => {
      state.liveSequence.error = 'Now-playing sequence could not be loaded.'
      rerender()
    }
  )
}

function activeHostStreamId() {
  return state.goLive.streamId || state.goLive.draftStreamId || ''
}

async function ensureHostDraftStream() {
  if (state.goLive.streamId) return state.goLive.streamId
  if (state.goLive.draftStreamId) return state.goLive.draftStreamId
  updateGoLiveFormState()
  state.goLive.connectionStatus = 'Preparing draft controls...'
  rerender()
  const response = await prepareMusicLiveStreamDraft(normalizeHlsLivePayload({
    streamId: state.goLive.draftStreamId,
    ...state.goLive.form
  }))
  const streamId = response.streamId || ''
  if (!streamId) throw new Error('Could not prepare a live draft.')
  state.goLive.draftStreamId = streamId
  startHostStreamSubscription(streamId)
  startLiveSequenceSubscription(streamId)
  state.goLive.connectionStatus = 'Draft controls ready.'
  rerender()
  return streamId
}

async function loadViewerState(streamId) {
  if (!streamId || !state.currentUser) {
    state.liveViewer = { reaction: 'none', saved: false, loading: false }
    return
  }
  state.liveViewer.loading = true
  try {
    const viewer = await getMusicLiveViewerState(streamId)
    state.liveViewer = { reaction: viewer.reaction || 'none', saved: viewer.saved === true, loading: false }
  } catch {
    state.liveViewer = { reaction: 'none', saved: false, loading: false }
  }
}

async function saveHostLiveMetadata(form) {
  if (!state.goLive.streamId) return
  const data = new FormData(form)
  const payload = normalizeHlsLivePayload({
    ...state.goLive.form,
    streamId: state.goLive.streamId,
    title: String(data.get('title') || '').slice(0, 90),
    description: String(data.get('description') || '').slice(0, 1200),
    coverArtURL: String(data.get('coverArtURL') || '').slice(0, 1000),
    coverArtPath: state.goLive.form.coverArtPath || '',
    coverArtSource: state.goLive.form.coverArtSource || 'fallback',
    tags: String(data.get('tags') || '').slice(0, 500),
    category: String(data.get('category') || 'music'),
    visibility: String(data.get('visibility') || 'public'),
    accessMode: String(data.get('accessMode') || state.goLive.form.accessMode || 'public'),
    password: String(data.get('password') || '').slice(0, 200)
  })
  state.goLive.editSaving = true
  state.goLive.editError = ''
  rerender()
  try {
    await updateMusicLiveStreamInfo(payload)
    state.goLive.form = {
      ...state.goLive.form,
      ...payload
    }
    delete state.goLive.form.streamId
    state.goLive.editOpen = false
  } catch (error) {
    state.goLive.editError = error?.message || 'Could not update live stream info.'
  } finally {
    state.goLive.editSaving = false
    rerender()
  }
}

async function saveHostDetails() {
  updateGoLiveFormState()
  const payload = normalizeHlsLivePayload({
    streamId: activeHostStreamId(),
    ...state.goLive.form
  })
  state.goLive.editSaving = true
  state.goLive.editError = ''
  state.goLive.formError = ''
  rerender()
  try {
    if (state.goLive.streamId) {
      await updateMusicLiveStreamInfo(payload)
      state.goLive.connectionStatus = 'Live stream info updated.'
    } else {
      const response = await prepareMusicLiveStreamDraft(payload)
      state.goLive.draftStreamId = response.streamId || state.goLive.draftStreamId
      if (state.goLive.draftStreamId) {
        startHostStreamSubscription(state.goLive.draftStreamId)
        startLiveSequenceSubscription(state.goLive.draftStreamId)
      }
      state.goLive.connectionStatus = 'Draft details saved.'
    }
  } catch (error) {
    state.goLive.formError = error?.message || 'Stream details could not be saved.'
  } finally {
    state.goLive.editSaving = false
    rerender()
  }
}

async function sendLiveChatMessage(form) {
  const streamId = form?.dataset?.streamId || state.liveStream?.id || state.goLive.streamId
  const text = String(new FormData(form).get('text') || '').trim().slice(0, 500)
  if (!streamId || !text) return
  const now = Date.now()
  if (now - state.liveChat.lastSentAt < 1200) {
    state.liveChat.error = 'Slow down a little before sending another message.'
    rerender()
    return
  }
  state.liveChat.sending = true
  state.liveChat.error = ''
  state.liveChat.text = text
  rerender()
  try {
    await sendMusicLiveChatMessage(streamId, text)
    state.liveChat.text = ''
    state.liveChat.lastSentAt = Date.now()
  } catch (error) {
    state.liveChat.error = error?.message || 'Could not send chat message.'
  } finally {
    state.liveChat.sending = false
    rerender()
  }
}

function resetSequenceForm() {
  state.liveSequence.editingItemId = ''
  state.liveSequence.form = { title: '', artist: '', album: '', artworkURL: '', notes: '' }
  state.liveSequence.error = ''
  rerender()
}

function editSequenceItem(itemId = '') {
  const item = state.liveSequence.items.find((entry) => entry.itemId === itemId)
  if (!item) return
  state.liveSequence.editingItemId = item.itemId
  state.liveSequence.form = {
    title: item.title || '',
    artist: item.artist || '',
    album: item.album || '',
    artworkURL: item.artworkURL || '',
    notes: item.notes || ''
  }
  state.liveSequence.error = ''
  rerender()
}

async function saveSequenceItem(form) {
  const data = new FormData(form)
  const nextForm = {
    title: String(data.get('title') || '').trim().slice(0, 120),
    artist: String(data.get('artist') || '').trim().slice(0, 120),
    album: String(data.get('album') || '').trim().slice(0, 120),
    artworkURL: String(data.get('artworkURL') || '').trim().slice(0, 1000),
    notes: String(data.get('notes') || '').trim().slice(0, 600)
  }
  const payload = {
    streamId: activeHostStreamId(),
    itemId: String(data.get('itemId') || '').trim(),
    ...nextForm
  }
  if (!payload.title) {
    state.liveSequence.error = 'Add a title for this now-playing item.'
    rerender()
    return
  }
  state.liveSequence.saving = true
  state.liveSequence.error = ''
  state.liveSequence.form = nextForm
  rerender()
  try {
    payload.streamId = payload.streamId || await ensureHostDraftStream()
    await upsertMusicLiveSequenceItem(payload)
    resetSequenceForm()
  } catch (error) {
    state.liveSequence.error = error?.message || 'Sequence item could not be saved.'
  } finally {
    state.liveSequence.saving = false
    rerender()
  }
}

async function setHostNowPlaying(itemId = '') {
  if (!itemId && !activeHostStreamId()) return
  const streamId = await ensureHostDraftStream()
  await setMusicLiveNowPlaying(streamId, itemId)
  if (!itemId) state.liveSequence.previewItemId = ''
}

async function startHostBroadcast(form) {
  if (!state.currentUser) return
  updateGoLiveFormState(form)
  let pendingStreamId = ''
  state.goLive.starting = true
  state.goLive.formError = ''
  state.goLive.connectionStatus = 'Creating live stream...'
  rerender()
  try {
    const formState = state.goLive.form
    const payload = normalizeHlsLivePayload({
      streamId: state.goLive.draftStreamId || '',
      title: formState.title,
      description: formState.description,
      category: formState.category,
      visibility: formState.visibility,
      accessMode: formState.accessMode,
      password: formState.password,
      coverArtURL: formState.coverArtURL,
      coverArtPath: formState.coverArtPath,
      coverArtSource: formState.coverArtSource,
      tags: formState.tags,
      audioMode: formState.audioMode,
      rightsAccepted: formState.rightsAccepted,
      archiveRequested: false,
      audioOnly: true,
      streamingMethod: formState.streamingMethod || 'obsRtmp',
      streamKey: formState.streamKey || 'obsfix1'
    })
    await refreshHostUnloadToken()
    const response = await startMusicLiveStream(payload)
    pendingStreamId = response.streamId || ''
    if (!pendingStreamId) throw new Error('The live stream service did not return a stream id.')
    state.goLive.streamId = pendingStreamId
    state.goLive.draftStreamId = pendingStreamId
    const isObs = payload.ingestMethod === 'obsRtmp'
    let ingestResult = { audioPublished: false, videoPublished: false }
    if (isObs) {
      state.goLive.localTrack = null
      state.goLive.browserIngestActive = false
      state.goLive.connectionStatus = `Stream is live. Send OBS to ${payload.rtmpIngestServer} with key ${payload.streamKey}.`
      rerender()
    } else {
      state.goLive.connectionStatus = formState.inputSource === 'sequence' ? 'Preparing Sequence Software output...' : 'Preparing selected audio input...'
      rerender()
      let localTrack
      if (formState.inputSource === 'sequence') {
        if (formState.sequenceId && formState.sequenceId !== state.sequenceWorkspace.activeSequence?.sequenceId) {
          await loadSequenceWorkspace(formState.sequenceId)
        }
        localTrack = await getSequenceOutputTrack()
      } else {
        try {
          localTrack = await createLocalAudioTrack(audioConstraintsForMode({ deviceId: state.goLive.selectedDeviceId }))
        } catch (error) {
          console.warn('[music] ideal publish audio constraints failed; retrying basic mic constraints.', error?.message || error)
          localTrack = await createLocalAudioTrack(audioConstraintsForMode({ deviceId: state.goLive.selectedDeviceId, relaxed: true }))
        }
      }
      state.goLive.localTrack = localTrack
      const mediaStreamTrack = localTrack?.mediaStreamTrack || localTrack
      if (!mediaStreamTrack || mediaStreamTrack.readyState === 'ended') throw new Error('The browser audio track is not available for streaming.')
      const mediaStream = new MediaStream([mediaStreamTrack])
      state.goLive.connectionStatus = 'Connecting browser stream to Melogic Edge...'
      rerender()
      ingestResult = await startBrowserWebrtcIngest({
        streamKey: response.streamKey || payload.streamKey,
        mediaStream,
        onStatus: (status = {}) => {
          if (status.connectionState === 'connected') state.goLive.connectionStatus = 'Browser stream connected to Melogic Edge.'
        },
        onError: (ingestError) => {
          state.goLive.connectionStatus = ingestError?.message || 'Browser stream connection failed.'
          rerender()
        }
      })
      state.goLive.browserIngestActive = true
    }
    await markMusicLiveStreamOnAir(pendingStreamId, normalizeHlsLivePayload({
      ...payload,
      streamId: pendingStreamId,
      streamKey: response.streamKey || payload.streamKey,
      hostActive: true,
      hostConnected: true,
      connectionStatus: 'live',
      broadcastState: 'liveBroadcasting',
      audioPublished: isObs ? true : ingestResult.audioPublished === true,
      videoPublished: ingestResult.videoPublished === true,
      programHasAudio: isObs ? true : ingestResult.audioPublished === true
    }))
    startHostHeartbeat(pendingStreamId)
    startLiveChatSubscription(pendingStreamId)
    startHostStreamSubscription(pendingStreamId)
    startLiveSequenceSubscription(pendingStreamId)
    state.goLive.connectionStatus = isObs
      ? `Waiting for OBS ingest at ${payload.rtmpIngestServer} using key ${payload.streamKey}.`
      : formState.inputSource === 'sequence' ? 'Sequence Software output live.' : 'Audio published. You are live.'
  } catch (error) {
    console.warn('[music] startMusicLiveStream failed', {
      functionName: 'startMusicLiveStream',
      code: error?.code || '',
      message: error?.message || '',
      details: error?.details || null
    })
    if (pendingStreamId) {
      await endMusicLiveStream(pendingStreamId).catch(() => {})
      state.goLive.streamId = ''
    }
    if (state.goLive.browserIngestActive) await stopBrowserWebrtcIngest().catch(() => {})
    state.goLive.browserIngestActive = false
    stopHostHeartbeat()
    stopLiveChatSubscription()
    if (state.goLive.localTrack && state.goLive.form.inputSource !== 'sequence') {
      state.goLive.localTrack.stop()
      state.goLive.localTrack = null
    }
    if (state.goLive.room) {
      state.goLive.room.disconnect()
      state.goLive.room = null
    }
    const rawMessage = String(error?.message || '').trim()
    state.goLive.formError = rawMessage && rawMessage.toLowerCase() !== 'internal'
      ? rawMessage
      : 'Unable to start stream. Please try again. If this keeps happening, contact support.'
    state.goLive.connectionStatus = 'Unable to start stream.'
  } finally {
    state.goLive.starting = false
    rerender()
  }
}

async function endHostBroadcast() {
  if (!state.goLive.streamId) return
  state.goLive.ending = true
  state.goLive.connectionStatus = 'Ending stream...'
  rerender()
  try {
    stopHostHeartbeat()
    if (state.goLive.browserIngestActive) await stopBrowserWebrtcIngest().catch(() => {})
    state.goLive.browserIngestActive = false
    if (state.goLive.localTrack && state.goLive.form.inputSource !== 'sequence') {
      state.goLive.localTrack.stop()
    }
    state.goLive.localTrack = null
    if (state.goLive.room) {
      state.goLive.room.disconnect()
      state.goLive.room = null
    }
    await endMusicLiveStream(state.goLive.streamId)
    stopLiveChatSubscription()
    stopLiveSequenceSubscription()
    stopPreviewStream()
    state.goLive.connectionStatus = 'Stream ended. Save as replay is coming soon.'
    state.goLive.streamId = ''
    state.goLive.draftStreamId = ''
    state.goLive.unloadToken = ''
  } catch (error) {
    state.goLive.formError = error?.message || 'Could not end stream.'
  } finally {
    state.goLive.ending = false
    rerender()
  }
}

function disconnectLiveListener() {
  stopListenerPresenceHeartbeat()
  if (state.nativePlaybackTimer) window.clearInterval(state.nativePlaybackTimer)
  state.nativePlaybackTimer = 0
  state.nativeHostUnsubscribe?.()
  state.nativeHostUnsubscribe = null
  if (state.liveStream?.id && state.nativeViewerSessionId) {
    clearPlaybackDemand(state.liveStream.id, state.nativeViewerSessionId).catch(() => {})
  }
  state.nativeViewerSessionId = ''
  state.nativeListenerDiagnostics = {}
  state.nativePlaybackQueue = []
  state.nativePlaybackNextIndex = null
  cleanupNativeMediaSourcePipeline()
  cleanupHlsPlayback()
  state.hlsDiagnostics = {}
  if (state.liveStream?.id && state.listenerPresenceId) {
    leaveMusicLiveStream(state.liveStream.id, state.listenerPresenceId).catch(() => {})
  }
  state.listenerPresenceId = ''
  if (state.listenerAudioElement) {
    state.listenerAudioElement.remove()
    state.listenerAudioElement = null
  }
  if (state.listenerVideoElement) {
    state.listenerVideoElement.remove()
    state.listenerVideoElement = null
  }
  if (state.listenerRoom) {
    state.listenerRoom.disconnect()
    state.listenerRoom = null
  }
  state.liveStatus = 'idle'
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
}

async function startNativeListenerPlayback(credentials = {}, { monitorMode = false } = {}) {
  const streamId = state.liveStream?.id || credentials.streamId || ''
  if (!streamId) return
  const startedAt = Date.now()
  const existingAudioDiagnostics = state.nativeListenerDiagnostics || {}
  state.nativeViewerSessionId = nativeViewerSessionId(streamId)
  state.nativeListenerDiagnostics = {
    ...existingAudioDiagnostics,
    streamId,
    provider: STREAM_PROVIDERS.firebaseSegments,
    listenerState: 'requestingPlayback',
    demandSessionId: state.nativeViewerSessionId,
    demandWriteSucceeded: false,
    hostHeartbeatFresh: false,
    readySegmentCount: existingAudioDiagnostics.readySegmentCount ?? 0,
    newestAvailableSegmentIndex: existingAudioDiagnostics.newestAvailableSegmentIndex ?? null,
    currentSegmentIndex: existingAudioDiagnostics.currentSegmentIndex ?? null,
    minBufferSegments: null,
    lastSegmentError: existingAudioDiagnostics.lastSegmentError || ''
  }
  state.liveStatus = 'requestingPlayback'
  state.liveError = ''
  updateLiveListenerControls()
  const demandResult = await writePlaybackDemand({
    streamId,
    viewerSessionId: state.nativeViewerSessionId,
    uid: state.currentUser?.uid || null,
    state: 'buffering',
    tabId: state.nativeViewerSessionId
  })
  if (!demandResult?.ok) throw new Error('Could not create Native Streaming playback demand.')
  state.nativeListenerDiagnostics.demandWriteSucceeded = true
  state.listenerPresenceId = credentials.presenceId || state.nativeViewerSessionId
  await joinMusicLiveStream(streamId, {
    presenceId: state.listenerPresenceId,
    anonId: credentials.anonId || listenerAnonId()
  }).then((joinResult = {}) => {
    state.listenerPresenceId = joinResult.presenceId || state.listenerPresenceId
    if (state.liveStream) {
      state.liveStream.listenerCount = Number(joinResult.listenerCount ?? state.liveStream.listenerCount ?? 0)
    }
    startListenerPresenceHeartbeat(streamId, state.listenerPresenceId)
  }).catch((error) => {
    state.nativeListenerDiagnostics.lastPresenceError = error?.message || 'Listener presence write failed.'
  })
  state.liveStatus = 'waitingForHost'
  state.nativeHostUnsubscribe?.()
  state.nativeHostUnsubscribe = observeNativeHostPresence(streamId, (host = null) => {
    const fresh = Boolean(host?.lastSeenAt && Date.now() - Number(host.lastSeenAt || 0) < 30000 && host.state === 'online')
    state.nativeListenerDiagnostics.hostHeartbeatFresh = fresh
    state.nativeListenerDiagnostics.hostSessionId = host?.hostSessionId || ''
    if (!fresh && ['requestingPlayback', 'waitingForHost', 'waitingForSegments', 'buffering'].includes(state.liveStatus)) {
      state.liveStatus = 'waitingForHost'
      state.liveError = nativePlaybackWaitMessage(state.liveStream || {}, Date.now() - startedAt)
      updateLiveListenerControls()
    }
  })
  updateLiveListenerControls()
  const updateNativeListenerStatus = (status, message = '') => {
    const changed = state.liveStatus !== status || state.liveError !== message
    state.liveStatus = status
    state.nativeListenerDiagnostics.listenerState = status
    state.liveError = message
    if (changed) rerender()
    else updateLiveListenerControls()
  }
  const poll = async () => {
    const native = credentials.nativeStreaming || state.liveStream?.nativeStreaming || {}
    const queue = await getNativePlaybackQueue(streamId, native).catch((error) => {
      const queryDiagnostics = getNativePlaybackQueueDiagnostics()
      state.nativeListenerDiagnostics = {
        ...state.nativeListenerDiagnostics,
        ...queryDiagnostics,
        lastSegmentError: queryDiagnostics.lastSegmentError || `${error?.code || 'segment-query-error'}: ${error?.message || 'Segment lookup failed.'}`
      }
      return []
    })
    const queryDiagnostics = queue.diagnostics || getNativePlaybackQueueDiagnostics()
    state.nativePlaybackQueue = queue
    const segmentDurationMs = Number(native.segmentDurationMs || 4000)
    const minPlaybackBufferMs = Number(native.minPlaybackBufferMs || 20000)
    const minSegments = Math.max(1, Math.ceil(minPlaybackBufferMs / segmentDurationMs))
    const playable = queue
      .filter((segment) => segment.downloadURL)
      .sort((a, b) => Number(a.index ?? 0) - Number(b.index ?? 0))
    state.nativeListenerDiagnostics = {
      ...state.nativeListenerDiagnostics,
      ...queryDiagnostics,
      readySegmentCount: Number(queryDiagnostics.readySegmentCount ?? queue.length),
      playableSegmentCount: playable.length,
      newestAvailableSegmentIndex: queryDiagnostics.newestAvailableSegmentIndex ?? native.newestAvailableSegmentIndex ?? null,
      minBufferSegments: minSegments,
      lastSegmentError: queryDiagnostics.lastSegmentError || state.nativeListenerDiagnostics.lastSegmentError || ''
    }
    console.info('[music-live] Native listener diagnostics', state.nativeListenerDiagnostics)
    if (state.nativeListenerDiagnostics.hostHeartbeatFresh !== true) {
      updateNativeListenerStatus('waitingForHost', nativePlaybackWaitMessage(state.liveStream || {}, Date.now() - startedAt))
      return
    }
    const mediaSourceReady = ensureNativeMediaSourcePipeline(streamId, playable[0] || {})
    if (!mediaSourceReady) {
      updateNativeListenerStatus('waiting', 'This browser cannot play Native Streaming chunks yet. Try Chrome/Edge.')
      return
    }
    await enqueueNativeMediaSourceSegments(playable)
    const appendedCount = state.nativeAppendedSegmentIndexes.size
    state.nativeListenerDiagnostics = {
      ...state.nativeListenerDiagnostics,
      appendQueueLength: state.nativeAppendQueue.length,
      appendedSegmentIndexes: Array.from(state.nativeAppendedSegmentIndexes),
      appendedSegmentCount: appendedCount,
      mediaSourceReadyState: state.nativeMediaSource?.readyState || ''
    }
    if (playable.length < minSegments) {
      updateNativeListenerStatus(playable.length ? 'buffering' : 'waitingForSegments', nativePlaybackWaitMessage(state.liveStream || {}, Date.now() - startedAt))
      return
    }
    if (appendedCount < minSegments) {
      updateNativeListenerStatus('buffering', 'Buffering audio chunks...')
      return
    }
    if (!isNativeRealSegmentAudioPlaying() && state.listenerAudioElement?.paused === true) {
      const started = await playNativeMediaSourceAudio()
      if (!started) {
        updateNativeListenerStatus('waiting', 'Ready to play — press Resume Audio.')
        return
      }
    }
    if (!isNativeRealSegmentAudioPlaying()) {
      updateNativeListenerStatus('buffering', 'Ready to play — press Resume Audio.')
      updateLiveListenerControls()
      return
    }
    state.liveStatus = 'playing'
    state.nativeListenerDiagnostics.listenerState = 'playing'
    state.liveError = ''
    await updatePlaybackDemandState({
      streamId,
      viewerSessionId: state.nativeViewerSessionId,
      uid: state.currentUser?.uid || null,
      state: 'listening',
      tabId: state.nativeViewerSessionId
    }).catch(() => {})
    updateLiveMediaSession(state.liveStream)
    updateLiveListenerControls()
  }
  await poll()
  if (state.nativePlaybackTimer) window.clearInterval(state.nativePlaybackTimer)
  state.nativePlaybackTimer = window.setInterval(() => { poll().catch(() => {}) }, 4000)
}

async function joinLiveListener(options = {}) {
  if (!state.liveStream?.id) return
  const monitorMode = options.monitor === true || state.route.mode === 'liveMonitor'
  if (isLiveListeningStatus()) {
    if (monitorMode || options.forceJoin) return
    disconnectLiveListener()
    rerender()
    return
  }
  if (!monitorMode) clearPlayer()
  const playbackInfo = getPublicPlaybackInfo(state.liveStream)
  console.log('[Live Receiver] selected playback route', {
    provider: state.liveStream.provider || '',
    transportProvider: state.liveStream.transportProvider || '',
    playbackMode: state.liveStream.playbackMode || '',
    ingestMethod: state.liveStream.ingestMethod || '',
    ingestProtocol: state.liveStream.ingestProtocol || '',
    streamKey: state.liveStream.streamKey || '',
    hlsPlaybackUrl: state.liveStream.hlsPlaybackUrl || '',
    selectedPlayer: playbackInfo.selectedPlayer || playbackInfo.provider || ''
  })
  if (playbackInfo.provider === STREAM_PROVIDERS.hlsEdge) {
    await startHlsListenerPlayback(playbackInfo)
    return
  }
  if (playbackInfo.provider === STREAM_PROVIDERS.firebaseSegments && isExplicitFirebaseSegmentsPlayback(state.liveStream)) {
    if (!firebaseSegmentStreamingEnabled()) {
      state.liveStatus = 'idle'
      state.liveError = 'Firebase Segments playback is disabled in this build.'
      rerender()
      return
    }
    if (!monitorMode) unlockNativeAudioFromGesture()
    if (state.liveStream.accessMode === 'password' || state.liveStream.passwordProtected) {
      state.liveStatus = 'idle'
      state.liveError = 'Password-protected Native Streaming playback needs authorized segment delivery before audio can start.'
      rerender()
      return
    }
    state.liveStatus = 'buffering'
    state.liveError = ''
    rerender()
    try {
      const presenceId = monitorMode ? `${livePresenceId(state.liveStream.id)}-monitor` : livePresenceId(state.liveStream.id)
      await startNativeListenerPlayback({
        streamId: state.liveStream.id,
        nativeStreaming: state.liveStream.nativeStreaming || {},
        presenceId,
        anonId: listenerAnonId()
      }, { monitorMode })
      rerender()
    } catch (error) {
      state.liveError = error?.message || 'Unable to start the Native Streaming buffer.'
      state.liveStatus = 'error'
      rerender()
    }
    return
  }
  if (playbackInfo.provider === 'antMedia') {
    state.liveError = playbackInfo.playable
      ? 'Ant Media playback URLs are ready, but the browser playback adapter is not installed in this build.'
      : playbackInfo.message || 'Ant Media playback is not configured.'
    state.liveStatus = 'idle'
    rerender()
    return
  }
  state.liveStatus = 'connectingTransport'
  state.liveError = ''
  state.nativeViewerSessionId = nativeViewerSessionId(state.liveStream.id)
  state.nativeListenerDiagnostics = {
    provider: STREAM_PROVIDERS.nativeWeb,
    listenerState: 'requestingPlayback',
    demandSessionId: state.nativeViewerSessionId,
    demandWriteSucceeded: false,
    tokenReceived: false,
    subscribedAudioTrack: false
  }
  rerender()
  try {
    const presenceId = monitorMode ? `${livePresenceId(state.liveStream.id)}-monitor` : livePresenceId(state.liveStream.id)
    const demandResult = await writePlaybackDemand({
      streamId: state.liveStream.id,
      viewerSessionId: state.nativeViewerSessionId,
      uid: state.currentUser?.uid || null,
      state: 'connectingTransport',
      tabId: state.nativeViewerSessionId
    })
    state.nativeListenerDiagnostics.demandWriteSucceeded = demandResult?.ok === true
    const credentials = await joinMusicLiveStream(state.liveStream.id, {
      password: state.livePassword,
      presenceId,
      anonId: listenerAnonId()
    })
    state.nativeListenerDiagnostics.tokenReceived = Boolean(credentials.listenerToken || credentials.token)
    state.listenerPresenceId = credentials.presenceId || presenceId
    startListenerPresenceHeartbeat(state.liveStream.id, state.listenerPresenceId)
    // LiveKit/WebRTC keeps audio interactive and handles jitter/reconnects internally.
    // It does not expose a normal browser-side setting for a large intentional radio buffer.
    const room = new Room({ adaptiveStream: true, dynacast: true })
    state.listenerRoom = room
    state.liveStatus = 'waitingForRemoteAudio'
    state.liveError = ''
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      const element = track.attach()
      if (track.kind === 'video') {
        if (state.listenerVideoElement) state.listenerVideoElement.remove()
        element.controls = false
        element.autoplay = true
        element.muted = true
        element.playsInline = true
        element.dataset.musicLiveVideo = 'true'
        state.listenerVideoElement = element
        attachLiveVideoElement()
        if (state.liveStream?.programHasAudio !== true && state.liveStream?.audioPublished !== true) state.liveStatus = 'live'
        rerender()
        return
      }
      if (track.kind !== 'audio') return
      if (state.listenerAudioElement) state.listenerAudioElement.remove()
      element.controls = true
      element.autoplay = false
      element.muted = monitorMode ? state.liveMonitor.muted : false
      element.volume = monitorMode ? state.player.volume : 1
      element.playsInline = true
      element.style.display = 'block'
      element.style.width = 'min(100%, 520px)'
      element.style.margin = '12px 0'
      element.dataset.musicLiveAudio = 'true'
      const mount = app.querySelector('[data-livekit-audio-mount]')
      ;(mount || document.body).appendChild(element)
      state.listenerAudioElement = element
      state.nativeListenerDiagnostics = {
        ...(state.nativeListenerDiagnostics || {}),
        provider: STREAM_PROVIDERS.nativeWeb,
        subscribedAudioTrack: true,
        remoteParticipantIdentity: participant?.identity || '',
        remoteTrackSid: publication?.trackSid || publication?.sid || '',
        remoteTrackName: publication?.trackName || track.name || 'melogic-program-audio',
        remoteTrackKind: track.kind || 'audio'
      }
      attachLiveKitAudioDiagnostics(element)
      state.liveStatus = 'readyToPlay'
      state.liveError = ''
      playLiveKitListenerAudio().catch(() => {})
      updateLiveListenerControls()
      if (state.route.mode === 'liveMonitor') startMusicLiveMonitorVisualizer()
    })
    room.on(RoomEvent.TrackUnsubscribed, (track) => {
      if (track.kind === 'video') {
        if (state.listenerVideoElement) {
          state.listenerVideoElement.remove()
          state.listenerVideoElement = null
        }
        rerender()
        return
      }
      if (track.kind !== 'audio') return
      if (state.listenerAudioElement) {
        state.listenerAudioElement.remove()
        state.listenerAudioElement = null
      }
      state.liveStatus = 'waiting'
      updateLiveListenerControls()
    })
    room.on(RoomEvent.Reconnecting, () => {
      state.liveStatus = 'reconnecting'
      state.nativeListenerDiagnostics.roomConnectionState = 'reconnecting'
      updateLiveListenerControls()
    })
    room.on(RoomEvent.Reconnected, () => {
      state.nativeListenerDiagnostics.roomConnectionState = 'connected'
      state.liveStatus = state.nativeListenerDiagnostics.lastAudioEvent === 'playing' ? 'playing' : 'waitingForRemoteAudio'
      updateLiveListenerControls()
    })
    room.on(RoomEvent.Disconnected, () => {
      state.liveStatus = state.liveStream?.status === 'live' ? 'ended' : 'idle'
      state.nativeListenerDiagnostics.roomConnectionState = 'disconnected'
      stopListenerPresenceHeartbeat()
      updateLiveListenerControls()
    })
    const livekitConnection = assertLiveKitConnectionConfig({
      url: credentials.url,
      token: credentials.listenerToken || credentials.token
    })
    await room.connect(livekitConnection.url, livekitConnection.token)
    state.nativeListenerDiagnostics.roomConnectionState = room.state || room.connectionState || 'connected'
    if (!state.listenerAudioElement && state.listenerVideoElement) {
      state.liveStatus = state.liveStream?.programHasAudio === true ? 'waitingForRemoteAudio' : 'playing'
      updateLiveListenerControls()
    } else if (!state.listenerAudioElement) {
      state.liveStatus = 'waitingForRemoteAudio'
      updateLiveListenerControls()
    }
  } catch (error) {
    const message = error?.message || ''
    state.liveError = /LiveKit|WebRTC\/LiveKit|website-native/i.test(message)
      ? 'This website-native stream requires WebRTC playback, which is not configured yet.'
      : message || 'Unable to connect to this live stream.'
    state.liveStatus = 'idle'
    rerender()
  }
}

function updateLiveListenerControls() {
  const button = app.querySelector('[data-live-listen]')
  const status = app.querySelector('[data-live-status]')
  if (state.listenerAudioElement && app.querySelector('[data-native-audio-mount]')) ensureNativeListenerAudioElement()
  if (state.listenerAudioElement && app.querySelector('[data-livekit-audio-mount]')) ensureLiveKitListenerAudioMounted()
  if (state.hlsMediaElement && app.querySelector('[data-hls-player-mount]')) ensureHlsMediaMounted()
  if (button) button.textContent = isLiveListeningStatus()
    ? 'Pause / Leave'
    : state.liveStatus === 'connecting' || state.liveStatus === 'connectingTransport' || state.liveStatus === 'reconnecting'
      ? 'Connecting...'
      : isBufferedHlsStream() ? 'Play' : 'Listen'
  if (status) status.textContent = liveStatusLabel(state.liveStream || {})
  updateHlsDiagnosticsDom()
}

async function runSearch(queryText) {
  state.searchQuery = String(queryText || '').trim()
  state.searchLoading = true
  state.activeView = 'search'
  rerender()
  state.searchResults = state.searchQuery ? await searchMusic(state.searchQuery, 16) : []
  state.searchLoading = false
  rerender()
}

async function loadLibraryView(view) {
  state.rows.library = state.currentUser ? await listUserLibraryMusic(state.currentUser.uid, view, 20) : []
}

async function loadSequenceAssets() {
  if (!state.currentUser) return
  state.sequenceWorkspace.assets = await listSequenceAssets(state.currentUser.uid, {
    search: state.sequenceWorkspace.search,
    type: state.sequenceWorkspace.filterType,
    category: state.sequenceWorkspace.filterCategory,
    status: state.sequenceWorkspace.filterStatus,
    sort: state.sequenceWorkspace.sort,
    limitCount: 50
  })
}

async function loadActiveSequenceItems() {
  if (!state.currentUser || !state.sequenceWorkspace.activeSequence?.sequenceId) {
    state.sequenceWorkspace.items = []
    return
  }
  state.sequenceWorkspace.items = await listSequenceItems(state.currentUser.uid, state.sequenceWorkspace.activeSequence.sequenceId)
}

async function loadSequenceWorkspace(sequenceId = state.route.id || state.goLive.form.sequenceId || '') {
  if (!state.currentUser) return
  state.sequenceWorkspace.loading = true
  state.sequenceWorkspace.error = ''
  try {
    const [assets, sequences] = await Promise.all([
      listSequenceAssets(state.currentUser.uid, {
        search: state.sequenceWorkspace.search,
        type: state.sequenceWorkspace.filterType,
        category: state.sequenceWorkspace.filterCategory,
        status: state.sequenceWorkspace.filterStatus,
        sort: state.sequenceWorkspace.sort,
        limitCount: 50
      }),
      listSequences(state.currentUser.uid, 50)
    ])
    state.sequenceWorkspace.assets = assets
    state.sequenceWorkspace.sequences = sequences
    let active = sequenceId ? sequences.find((sequence) => sequence.sequenceId === sequenceId) || await getSequence(state.currentUser.uid, sequenceId) : null
    if (!active && sequences.length) active = sequences[0]
    if (!active) active = await createSequence(state.currentUser.uid, { title: 'Main Sequence', mode: 'manual' })
    state.sequenceWorkspace.activeSequence = active
    state.goLive.form.sequenceId = active.sequenceId
    await loadActiveSequenceItems()
  } catch (error) {
    state.sequenceWorkspace.error = error?.message || 'Sequence Software could not load.'
  } finally {
    state.sequenceWorkspace.loading = false
    rerender()
  }
}

function startLiveListRefresh() {
  stopLiveListRefresh()
  if (!['landing', 'liveList'].includes(state.route.mode) && state.activeView !== 'live') return
  state.liveListRefreshTimer = window.setInterval(() => {
    if (!['landing', 'liveList'].includes(state.route.mode) && state.activeView !== 'live') return
    listPublicLiveStreams({ limitCount: 20 }).then((streams) => {
      state.rows.liveStreams = streams
      if (state.activeView === 'live' || state.activeView === 'home') rerender()
    }).catch(() => {})
  }, 15000)
}

function setActiveView(view) {
  if (!sidebarViews[view]) return
  state.activeView = view
  state.sidebarOpen = false
  if (view === 'sequence') {
    window.history.pushState({}, '', ROUTES.musicSequence)
    state.route = { mode: 'sequence', id: '' }
    loadSequenceWorkspace().catch(() => rerender())
    rerender()
    return
  }
  if (state.route.mode !== 'landing') {
    window.history.pushState({}, '', `${ROUTES.music}#${view}`)
    state.route = { mode: 'landing', id: '' }
  } else {
    window.history.replaceState({}, '', view === 'home' ? ROUTES.music : `${ROUTES.music}#${view}`)
  }
  if (libraryItems.some(([item]) => item === view)) {
    loadLibraryView(view).then(rerender).catch(() => rerender())
  } else {
    rerender()
  }
  startLiveListRefresh()
}

function bindMusicEvents() {
  app.querySelector('[data-toggle-music-sidebar]')?.addEventListener('click', () => {
    state.sidebarOpen = !state.sidebarOpen
    rerender()
  })
  app.querySelectorAll('[data-music-view]').forEach((button) => {
    button.addEventListener('click', () => setActiveView(button.dataset.musicView))
  })
  app.querySelectorAll('[data-live-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      state.liveFilter = button.dataset.liveFilter || 'all'
      rerender()
    })
  })
  app.querySelectorAll('[data-host-control]').forEach((button) => {
    button.addEventListener('click', () => {
      updateGoLiveFormState()
      state.goLive.activeControl = button.dataset.hostControl || 'details'
      rerender()
    })
  })
  app.querySelectorAll('[data-row-scroll]').forEach((button) => {
    button.addEventListener('click', () => {
      const row = app.querySelector(`[data-carousel="${button.dataset.rowScroll}"]`)
      if (!row) return
      const direction = Number(button.dataset.direction || 1)
      row.scrollBy({ left: direction * Math.max(280, row.clientWidth * 0.82), behavior: 'smooth' })
    })
  })
  app.querySelectorAll('[data-search-genre]').forEach((button) => {
    button.addEventListener('click', () => runSearch(button.dataset.searchGenre).catch(() => {}))
  })
  app.querySelector('[data-music-search-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    runSearch(new FormData(event.currentTarget).get('q')).catch(() => {})
  })
  app.querySelector('[data-refresh-audio-devices]')?.addEventListener('click', () => {
    updateGoLiveFormState()
    refreshAudioDevices().catch(() => {})
  })
  app.querySelector('[data-live-device-select]')?.addEventListener('change', (event) => {
    updateGoLiveFormState()
    state.goLive.selectedDeviceId = event.target.value || ''
    refreshAudioDevices().catch(() => {})
  })
  app.querySelector('[data-live-input-source]')?.addEventListener('change', (event) => {
    updateGoLiveFormState()
    if (event.target.value === 'sequence' && state.currentUser) loadSequenceWorkspace(state.goLive.form.sequenceId).catch(() => {})
    rerender()
  })
  app.querySelector('[data-live-sequence-source]')?.addEventListener('change', (event) => {
    updateGoLiveFormState()
    loadSequenceWorkspace(event.target.value || '').catch(() => {})
  })
  app.querySelector('[data-go-live-form]')?.addEventListener('input', (event) => {
    const previousPath = state.goLive.form.coverArtSource === 'upload' ? state.goLive.form.coverArtPath : ''
    const previousURL = state.goLive.form.coverArtURL
    updateGoLiveFormState(event.currentTarget)
    if (previousPath && state.goLive.form.coverArtSource !== 'upload' && state.goLive.form.coverArtURL !== previousURL) {
      deleteUploadedCover(previousPath).catch(() => {})
      state.goLive.form.coverArtPath = ''
    }
    syncHostPreviewFromForm()
  })
  app.querySelector('[data-go-live-form]')?.addEventListener('change', (event) => {
    const previousPath = state.goLive.form.coverArtSource === 'upload' ? state.goLive.form.coverArtPath : ''
    const previousURL = state.goLive.form.coverArtURL
    updateGoLiveFormState(event.currentTarget)
    if (previousPath && state.goLive.form.coverArtSource !== 'upload' && state.goLive.form.coverArtURL !== previousURL) {
      deleteUploadedCover(previousPath).catch(() => {})
      state.goLive.form.coverArtPath = ''
    }
    syncHostPreviewFromForm()
    if (event.target?.name === 'streamingMethod') rerender()
  })
  app.querySelector('[data-live-cover-upload]')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0]
    if (file) uploadLiveCoverFile(file).catch(() => {})
  })
  app.querySelector('[data-live-cover-clear]')?.addEventListener('click', () => {
    updateGoLiveFormState()
    const oldPath = state.goLive.form.coverArtSource === 'upload' ? state.goLive.form.coverArtPath : ''
    state.goLive.form.coverArtURL = ''
    state.goLive.form.coverArtPath = ''
    state.goLive.form.coverArtSource = 'fallback'
    deleteUploadedCover(oldPath).catch(() => {})
    rerender()
  })
  app.querySelector('[data-toggle-preview-mute]')?.addEventListener('click', () => {
    updateGoLiveFormState()
    state.goLive.muted = !state.goLive.muted
    if (state.goLive.previewStream) state.goLive.previewStream.getAudioTracks().forEach((track) => { track.enabled = !state.goLive.muted })
    rerender()
  })
  app.querySelector('[data-start-host-broadcast]')?.addEventListener('click', () => {
    startHostBroadcast(app.querySelector('[data-go-live-form]')).catch(() => {})
  })
  app.querySelectorAll('[data-toggle-live-edit]').forEach((button) => {
    button.addEventListener('click', () => {
      updateGoLiveFormState()
      state.goLive.editOpen = !state.goLive.editOpen
      state.goLive.editError = ''
      rerender()
    })
  })
  app.querySelector('[data-live-edit-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    saveHostLiveMetadata(event.currentTarget).catch(() => {})
  })
  app.querySelector('[data-save-host-details]')?.addEventListener('click', () => {
    saveHostDetails().catch(() => {})
  })
  app.querySelector('[data-end-host-stream]')?.addEventListener('click', () => {
    endHostBroadcast().catch(() => {})
  })
  app.querySelector('[data-live-listen]')?.addEventListener('click', () => {
    const passwordForm = app.querySelector('[data-live-password-form]')
    if (passwordForm) state.livePassword = String(new FormData(passwordForm).get('password') || '')
    joinLiveListener().catch(() => {})
  })
  app.querySelector('[data-native-audio-resume]')?.addEventListener('click', () => {
    resumeNativeAudioFromGesture()
  })
  app.querySelector('[data-livekit-audio-resume]')?.addEventListener('click', () => {
    resumeLiveKitAudioFromGesture()
  })
  app.querySelector('[data-hls-resume]')?.addEventListener('click', () => {
    playHlsMediaFromGesture().catch(() => {})
  })
  app.querySelectorAll('[data-hls-playback-mode]').forEach((button) => button.addEventListener('click', () => {
    const mode = button.dataset.hlsPlaybackMode || ''
    if (!HLS_PLAYBACK_MODES.has(mode) || mode === currentHlsPlaybackMode()) return
    disconnectLiveListener()
    state.hlsPlaybackMode = mode
    try { localStorage.setItem(HLS_PLAYBACK_MODE_STORAGE_KEY, mode) } catch {}
    rerender()
  }))
  app.querySelector('[data-live-video-hero]')?.addEventListener('click', () => {
    if (!isLiveListeningStatus()) {
      const passwordForm = app.querySelector('[data-live-password-form]')
      if (passwordForm) state.livePassword = String(new FormData(passwordForm).get('password') || '')
      joinLiveListener().catch(() => {})
    }
    state.liveVideoExpanded = true
    rerender()
  })
  app.querySelector('[data-live-hide-video]')?.addEventListener('click', () => {
    state.liveVideoExpanded = false
    rerender()
  })
  app.querySelector('[data-open-guest-setup]')?.addEventListener('click', () => {
    state.guestSetupOpen = true
    state.guestSetupStatus = ''
    rerender()
  })
  app.querySelectorAll('[data-close-guest-setup]').forEach((button) => button.addEventListener('click', () => {
    state.guestSetupOpen = false
    rerender()
  }))
  app.querySelector('[data-dismiss-guest-invite]')?.addEventListener('click', async () => {
    if (!state.liveStream?.id || !state.guestInvite?.inviteId) return
    await updateLiveStudioGuestInviteStatus(state.liveStream.id, state.guestInvite.inviteId, 'dismissed', state.guestInvite.setup || {}).catch(() => {})
    state.guestInvite = { ...state.guestInvite, status: 'dismissed' }
    rerender()
  })
  app.querySelector('[data-guest-setup-form]')?.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!state.liveStream?.id || !state.guestInvite?.inviteId) return
    const data = new FormData(event.currentTarget)
    const setup = {
      displayName: String(data.get('displayName') || '').trim().slice(0, 80),
      audioReady: data.get('audioReady') === 'on',
      videoReady: data.get('videoReady') === 'on',
      muted: data.get('muted') === 'on'
    }
    state.guestSetupStatus = 'Saving guest readiness...'
    rerender()
    try {
      await updateLiveStudioGuestInviteStatus(state.liveStream.id, state.guestInvite.inviteId, 'ready', setup)
      state.guestInvite = { ...state.guestInvite, status: 'ready', setup }
      state.guestSetupOpen = false
      state.guestSetupStatus = ''
    } catch (error) {
      state.guestSetupStatus = error?.message || 'Could not update guest readiness.'
    }
    rerender()
  })
  app.querySelector('[data-live-password-form]')?.addEventListener('input', (event) => {
    state.livePassword = String(new FormData(event.currentTarget).get('password') || '')
  })
  app.querySelector('[data-live-volume]')?.addEventListener('input', (event) => {
    state.player.volume = Number(event.target.value)
    if (state.listenerAudioElement) state.listenerAudioElement.volume = state.player.volume
    if (state.hlsMediaElement && currentHlsPlaybackMode() !== 'videoOnly') state.hlsMediaElement.volume = state.player.volume
  })
  app.querySelector('[data-live-chat-form]')?.addEventListener('input', (event) => {
    state.liveChat.text = String(new FormData(event.currentTarget).get('text') || '').slice(0, 500)
  })
  app.querySelector('[data-live-chat-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    sendLiveChatMessage(event.currentTarget).catch(() => {})
  })
  app.querySelectorAll('[data-live-reaction]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!state.currentUser) {
        state.liveActionMessage = 'Sign in to like or dislike live streams.'
        rerender()
        return
      }
      const requested = button.dataset.liveReaction || 'none'
      const next = state.liveViewer.reaction === requested ? 'none' : requested
      toggleMusicLiveReaction(state.liveStream?.id || '', next).then((result) => {
        state.liveViewer.reaction = result.reaction || next
        state.liveActionMessage = ''
      }).catch((error) => {
        state.liveActionMessage = error?.message || 'Reaction could not be saved.'
      }).finally(rerender)
    })
  })
  app.querySelector('[data-live-save]')?.addEventListener('click', () => {
    if (!state.currentUser) {
      state.liveActionMessage = 'Sign in to save live streams.'
      rerender()
      return
    }
    const next = !state.liveViewer.saved
    toggleSaveMusicLiveStream(state.liveStream?.id || '', next).then((result) => {
      state.liveViewer.saved = result.saved === true
      state.liveActionMessage = result.saved ? 'Saved to your live streams.' : 'Removed from saved live streams.'
    }).catch((error) => {
      state.liveActionMessage = error?.message || 'Save could not be updated.'
    }).finally(rerender)
  })
  app.querySelector('[data-live-share]')?.addEventListener('click', () => {
    const url = liveShareURL(state.liveStream?.id || state.goLive.streamId)
    if (navigator.share) {
      navigator.share({ title: state.liveStream?.title || 'Melogic Music Live', url }).catch(() => {})
    } else {
      navigator.clipboard?.writeText(url).then(() => {
        state.liveActionMessage = 'Live stream link copied.'
        rerender()
      }).catch(() => {
        state.liveActionMessage = url
        rerender()
      })
    }
  })
  app.querySelector('[data-live-fullscreen-monitor]')?.addEventListener('click', () => {
    const streamId = state.liveStream?.id || ''
    if (streamId) window.open(musicLiveMonitorRoute(streamId), 'melogic-public-live-monitor', 'popup=yes,width=960,height=720')
  })
  app.querySelector('[data-live-global-toggle]')?.addEventListener('click', () => {
    if (state.listenerAudioElement && !state.listenerAudioElement.paused) {
      state.listenerAudioElement.pause()
      state.liveStatus = 'waiting'
      updateLiveMediaSession()
      rerender()
    } else {
      state.listenerAudioElement?.play?.().then(() => {
        state.liveStatus = 'live'
        updateLiveMediaSession()
        rerender()
      }).catch(() => {})
    }
  })
  app.querySelector('[data-live-global-stop]')?.addEventListener('click', () => {
    disconnectLiveListener()
    rerender()
  })
  app.querySelector('[data-live-sequence-form]')?.addEventListener('input', (event) => {
    const data = new FormData(event.currentTarget)
    state.liveSequence.form = {
      title: String(data.get('title') || '').slice(0, 120),
      artist: String(data.get('artist') || '').slice(0, 120),
      album: String(data.get('album') || '').slice(0, 120),
      artworkURL: String(data.get('artworkURL') || '').slice(0, 1000),
      notes: String(data.get('notes') || '').slice(0, 600)
    }
  })
  app.querySelector('[data-live-sequence-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    saveSequenceItem(event.currentTarget).catch(() => {})
  })
  app.querySelector('[data-live-sequence-reset]')?.addEventListener('click', () => resetSequenceForm())
  app.querySelector('[data-live-studio-mode]')?.addEventListener('click', () => {
    state.liveSequence.studioMode = !state.liveSequence.studioMode
    rerender()
  })
  app.querySelectorAll('[data-live-sequence-clear]').forEach((button) => {
    button.addEventListener('click', () => setHostNowPlaying('').catch((error) => {
      state.liveSequence.error = error?.message || 'Could not clear the live item.'
      rerender()
    }))
  })
  app.querySelector('[data-live-sequence-clear-preview]')?.addEventListener('click', () => {
    state.liveSequence.previewItemId = ''
    rerender()
  })
  app.querySelector('[data-live-sequence-take]')?.addEventListener('click', () => {
    const itemId = state.liveSequence.previewItemId
    if (!itemId) return
    setHostNowPlaying(itemId).then(() => {
      state.liveSequence.previewItemId = ''
    }).catch((error) => {
      state.liveSequence.error = error?.message || 'Could not take preview live.'
    }).finally(rerender)
  })
  app.querySelectorAll('[data-live-sequence-queue]').forEach((button) => {
    button.addEventListener('click', () => {
      state.liveSequence.previewItemId = button.dataset.liveSequenceQueue || ''
      rerender()
    })
  })
  app.querySelectorAll('[data-live-sequence-set]').forEach((button) => {
    button.addEventListener('click', () => setHostNowPlaying(button.dataset.liveSequenceSet || '').catch((error) => {
      state.liveSequence.error = error?.message || 'Could not set this item live.'
      rerender()
    }))
  })
  app.querySelectorAll('[data-live-sequence-edit]').forEach((button) => {
    button.addEventListener('click', () => editSequenceItem(button.dataset.liveSequenceEdit || ''))
  })
  app.querySelectorAll('[data-live-sequence-delete]').forEach((button) => {
    button.addEventListener('click', () => {
      const itemId = button.dataset.liveSequenceDelete || ''
      const streamId = activeHostStreamId()
      if (state.liveSequence.previewItemId === itemId) state.liveSequence.previewItemId = ''
      deleteMusicLiveSequenceItem(streamId, itemId).catch((error) => {
        state.liveSequence.error = error?.message || 'Could not remove this sequence item.'
        rerender()
      })
    })
  })
  app.querySelectorAll('[data-sequence-asset-upload]').forEach((input) => {
    input.addEventListener('change', (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      const fieldsForm = app.querySelector('[data-sequence-upload-fields]')
      const data = fieldsForm ? new FormData(fieldsForm) : new FormData()
      uploadSequenceAssetFromFile(file, {
        title: data.get('title'),
        artist: data.get('artist'),
        category: data.get('category'),
        videoAudioMode: data.get('videoAudioMode'),
        separateAudioFile: data.get('separateAudioFile')
      }).catch(() => {})
    })
  })
  app.querySelector('[data-sequence-search]')?.addEventListener('input', (event) => {
    state.sequenceWorkspace.search = event.target.value || ''
    rerender()
  })
  app.querySelector('[data-sequence-filter-type]')?.addEventListener('change', (event) => {
    state.sequenceWorkspace.filterType = event.target.value || 'all'
    loadSequenceAssets().then(rerender).catch(() => rerender())
  })
  app.querySelector('[data-sequence-filter-category]')?.addEventListener('change', (event) => {
    state.sequenceWorkspace.filterCategory = event.target.value || 'all'
    loadSequenceAssets().then(rerender).catch(() => rerender())
  })
  app.querySelector('[data-sequence-filter-status]')?.addEventListener('change', (event) => {
    state.sequenceWorkspace.filterStatus = event.target.value || 'all'
    loadSequenceAssets().then(rerender).catch(() => rerender())
  })
  app.querySelector('[data-sequence-sort]')?.addEventListener('change', (event) => {
    state.sequenceWorkspace.sort = event.target.value || 'created_desc'
    loadSequenceAssets().then(rerender).catch(() => rerender())
  })
  app.querySelector('[data-create-sequence]')?.addEventListener('click', async () => {
    if (!state.currentUser) return
    const input = app.querySelector('[data-new-sequence-title]')
    const title = String(input?.value || state.sequenceWorkspace.newSequenceTitle || '').trim() || 'Untitled sequence'
    try {
      const sequence = await createSequence(state.currentUser.uid, { title, mode: 'manual' })
      state.sequenceWorkspace.newSequenceTitle = ''
      state.sequenceWorkspace.activeSequence = sequence
      state.goLive.form.sequenceId = sequence.sequenceId
      await loadSequenceWorkspace(sequence.sequenceId)
    } catch (error) {
      state.sequenceWorkspace.error = error?.message || 'Sequence could not be created.'
      rerender()
    }
  })
  app.querySelector('[data-new-sequence-title]')?.addEventListener('input', (event) => {
    state.sequenceWorkspace.newSequenceTitle = event.target.value || ''
  })
  app.querySelector('[data-active-sequence-select]')?.addEventListener('change', (event) => {
    const sequenceId = event.target.value || ''
    state.goLive.form.sequenceId = sequenceId
    loadSequenceWorkspace(sequenceId).catch(() => {})
    if (state.route.mode === 'sequence' && sequenceId) window.history.replaceState({}, '', `${ROUTES.musicSequence}/${encodeURIComponent(sequenceId)}`)
  })
  app.querySelectorAll('[data-sequence-add-asset]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!state.currentUser || !state.sequenceWorkspace.activeSequence) return
      const asset = state.sequenceWorkspace.assets.find((item) => item.assetId === button.dataset.sequenceAddAsset)
      if (!asset) return
      try {
        await addAssetToSequence(state.currentUser.uid, state.sequenceWorkspace.activeSequence.sequenceId, asset, state.sequenceWorkspace.activeSequence)
        await loadSequenceWorkspace(state.sequenceWorkspace.activeSequence.sequenceId)
      } catch (error) {
        state.sequenceWorkspace.error = error?.message || 'Asset could not be added to sequence.'
        rerender()
      }
    })
  })
  app.querySelectorAll('[data-sequence-item-field]').forEach((input) => {
    input.addEventListener('change', async () => {
      if (!state.currentUser || !state.sequenceWorkspace.activeSequence) return
      const itemId = input.dataset.sequenceItemField || ''
      const field = input.dataset.field || ''
      if (!['fadeInMs', 'fadeOutMs', 'crossfadeMs'].includes(field)) return
      await updateSequenceItem(state.currentUser.uid, state.sequenceWorkspace.activeSequence.sequenceId, itemId, { [field]: Math.max(0, Math.round(Number(input.value) || 0)) }).catch((error) => {
        state.sequenceWorkspace.error = error?.message || 'Sequence item could not be updated.'
      })
      await loadActiveSequenceItems().catch(() => {})
      rerender()
    })
  })
  app.querySelectorAll('[data-sequence-preview-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === button.dataset.sequencePreviewItem)
      state.sequenceWorkspace.selectedItemId = item?.itemId || state.sequenceWorkspace.selectedItemId
      playSequenceItem(item).catch((error) => {
        state.sequenceWorkspace.error = error?.message || 'Sequence item could not be played.'
        rerender()
      })
    })
  })
  app.querySelectorAll('[data-sequence-item-row]').forEach((row) => {
    row.addEventListener('click', (event) => {
      if (event.target.closest('button,input,select,textarea')) return
      state.sequenceWorkspace.selectedItemId = row.dataset.sequenceItemRow || ''
      rerender()
    })
  })
  app.querySelectorAll('[data-sequence-cue-item]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === button.dataset.sequenceCueItem)
      if (!item) return
      state.sequenceWorkspace.selectedItemId = item.itemId
      preloadSequenceItem(item)
      rerender()
    })
  })
  app.querySelectorAll('[data-sequence-set-next]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === button.dataset.sequenceSetNext)
      preloadSequenceItem(item)
      rerender()
    })
  })
  app.querySelectorAll('[data-sequence-duplicate-item]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!state.currentUser || !state.sequenceWorkspace.activeSequence) return
      const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === button.dataset.sequenceDuplicateItem)
      if (!item) return
      await duplicateSequenceItem(state.currentUser.uid, state.sequenceWorkspace.activeSequence.sequenceId, item, state.sequenceWorkspace.activeSequence).catch((error) => {
        state.sequenceWorkspace.error = error?.message || 'Sequence item could not be duplicated.'
      })
      await loadSequenceWorkspace(state.sequenceWorkspace.activeSequence.sequenceId).catch(() => {})
    })
  })
  app.querySelectorAll('[data-sequence-move]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!state.currentUser || !state.sequenceWorkspace.activeSequence) return
      const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === button.dataset.sequenceMove)
      if (!item) return
      await moveSequenceItem(state.currentUser.uid, state.sequenceWorkspace.activeSequence.sequenceId, item, Number(button.dataset.direction || 0), state.sequenceWorkspace.items).catch((error) => {
        state.sequenceWorkspace.error = error?.message || 'Sequence item could not be moved.'
      })
      await loadActiveSequenceItems().catch(() => {})
      rerender()
    })
  })
  app.querySelectorAll('[data-sequence-remove-item]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!state.currentUser || !state.sequenceWorkspace.activeSequence) return
      await deleteSequenceItem(state.currentUser.uid, state.sequenceWorkspace.activeSequence.sequenceId, button.dataset.sequenceRemoveItem || '').catch((error) => {
        state.sequenceWorkspace.error = error?.message || 'Sequence item could not be removed.'
      })
      await loadActiveSequenceItems().catch(() => {})
      rerender()
    })
  })
  app.querySelector('[data-sequence-play]')?.addEventListener('click', () => {
    const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === state.sequenceWorkspace.selectedItemId) || sequencePlayableItems()[0]
    playSequenceItem(item).catch((error) => {
      state.sequenceWorkspace.error = error?.message || 'Sequence could not start.'
      rerender()
    })
  })
  app.querySelector('[data-sequence-pause]')?.addEventListener('click', () => {
    if (state.sequenceWorkspace.playback.paused) resumeSequencePlayback()
    else pauseSequencePlayback()
  })
  app.querySelector('[data-sequence-stop]')?.addEventListener('click', () => stopSequencePlayback())
  app.querySelector('[data-sequence-previous]')?.addEventListener('click', () => {
    const previous = previousSequenceItem(state.sequenceWorkspace.playback.currentItemId || state.sequenceWorkspace.selectedItemId)
    playSequenceItem(previous).catch((error) => {
      state.sequenceWorkspace.error = error?.message || 'Previous item could not play.'
      rerender()
    })
  })
  app.querySelector('[data-sequence-next]')?.addEventListener('click', () => {
    const next = nextSequenceItem(state.sequenceWorkspace.playback.currentItemId)
    playSequenceItem(next).catch((error) => {
      state.sequenceWorkspace.error = error?.message || 'Next item could not play.'
      rerender()
    })
  })
  app.querySelector('[data-sequence-preview-transition]')?.addEventListener('click', () => {
    previewSequenceTransition().catch((error) => {
      state.sequenceWorkspace.error = error?.message || 'Transition could not be previewed.'
      rerender()
    })
  })
  app.querySelector('[data-sequence-cue-selected]')?.addEventListener('click', () => {
    const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === state.sequenceWorkspace.selectedItemId)
    preloadSequenceItem(item)
    rerender()
  })
  app.querySelector('[data-sequence-set-selected-next]')?.addEventListener('click', () => {
    const item = state.sequenceWorkspace.items.find((entry) => entry.itemId === state.sequenceWorkspace.selectedItemId)
    preloadSequenceItem(item)
    rerender()
  })
  app.querySelectorAll('[data-sequence-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.sequenceToggle
      if (key === 'monitor') setSequenceMonitor(!state.sequenceWorkspace.playback.monitor)
      else if (key && key in state.sequenceWorkspace.playback) state.sequenceWorkspace.playback[key] = !state.sequenceWorkspace.playback[key]
      rerender()
    })
  })
  app.querySelectorAll('[data-play-release]').forEach((button) => {
    button.addEventListener('click', () => {
      const release = allPublicReleases().find((item) => item.id === button.dataset.playRelease)
      if (!release?.streamAudioURL) return
      toggleTrack({
        id: `release-${release.id}`,
        title: release.title,
        artistName: release.artistName,
        streamAudioURL: release.streamAudioURL,
        coverArtURL: release.coverArtURL
      }).catch(() => {})
    })
  })
  app.querySelectorAll('[data-play-track]').forEach((button) => {
    button.addEventListener('click', () => {
      const track = state.tracks.find((item) => item.id === button.dataset.playTrack)
      toggleTrack({
        ...track,
        coverArtURL: state.release?.coverArtURL || ''
      }).catch((error) => {
        console.warn('[music] Track could not be played.', error?.message || error)
      })
    })
  })
  app.querySelector('[data-player-toggle]')?.addEventListener('click', () => {
    if (!state.player.track) return
    toggleTrack(state.player.track).catch(() => {})
  })
  app.querySelector('[data-player-clear]')?.addEventListener('click', clearPlayer)
  app.querySelector('[data-player-seek]')?.addEventListener('input', (event) => {
    const nextTime = Number(event.target.value) || 0
    state.player.currentTime = nextTime
    if (state.player.audio) state.player.audio.currentTime = nextTime
    updatePlayerControls()
  })
  app.querySelector('[data-player-volume]')?.addEventListener('input', (event) => {
    state.player.volume = Number(event.target.value)
    if (state.player.audio) state.player.audio.volume = state.player.volume
  })
}

async function attachMusicHeroVideo() {
  const video = app.querySelector('[data-music-hero-video]')
  if (!video || video.dataset.loaded) return
  video.dataset.loaded = 'true'
  const supportsWebm = typeof video.canPlayType === 'function' && video.canPlayType('video/webm; codecs="vp8, vorbis"')
  const paths = supportsWebm
    ? ['music/backgrounds/hero-loop.webm', 'music/backgrounds/hero-loop.mp4']
    : ['music/backgrounds/hero-loop.mp4', 'music/backgrounds/hero-loop.webm']
  for (const path of paths) {
    const url = await getSiteAssetURL(path, { scopeKey: 'music-hero-video', type: 'video', warnOnFail: false })
    if (!url) continue
    video.src = url
    video.addEventListener('error', () => {
      video.removeAttribute('src')
    }, { once: true })
    video.load()
    video.play().catch(() => {})
    return
  }
}

async function loadMusicPage() {
  stopLiveStreamSubscription()
  stopLiveChatSubscription()
  stopLiveSequenceSubscription()
  stopLiveListRefresh()
  initShellChrome()
  state.currentUser = await waitForInitialAuthState().catch(() => null)
  state.accountPermissions = null
  if (state.currentUser) {
    state.accountPermissionsLoading = true
    try {
      state.accountPermissions = await getMyAccountPermissions()
    } catch (error) {
      state.accountPermissions = { permissions: { musicLive: false }, restrictions: {}, source: 'fallback' }
    } finally {
      state.accountPermissionsLoading = false
    }
  }
  state.route = currentRouteMode()
  state.activeView = getInitialView()
  state.loading = true
  rerender()

  if (state.route.mode === 'release') {
    state.release = await getMusicRelease(state.route.id)
    state.tracks = state.release ? await listTracksForRelease(state.release.id) : []
    state.loading = false
    rerender()
    return
  }

  if (state.route.mode === 'liveDetail' || state.route.mode === 'liveMonitor') {
    state.activeView = 'live'
    state.liveStream = await getMusicLiveStream(state.route.id)
    if (state.liveStream?.id) {
      startLiveStreamSubscription(state.liveStream.id)
      if (state.route.mode === 'liveDetail') {
        startLiveChatSubscription(state.liveStream.id)
        startLiveSequenceSubscription(state.liveStream.id)
        await loadViewerState(state.liveStream.id)
        if (state.currentUser?.uid) {
          state.guestInviteUnsubscribe = subscribeMyLiveStudioGuestInvite(state.liveStream.id, state.currentUser.uid, (invite) => {
            state.guestInvite = invite
            rerender()
          })
        }
      }
    }
    state.loading = false
    rerender()
    if (state.route.mode === 'liveMonitor' && state.liveStream?.id && !isBufferedHlsStream(state.liveStream)) {
      joinLiveListener({ monitor: true, forceJoin: true }).catch(() => {})
    }
    return
  }

  if (state.route.mode === 'goLive') {
    state.activeView = 'live'
    if (state.currentUser) await loadSequenceWorkspace(state.goLive.form.sequenceId).catch(() => {})
    state.loading = false
    rerender()
    return
  }

  if (state.route.mode === 'sequence') {
    state.activeView = 'sequence'
    state.loading = false
    await loadSequenceWorkspace(state.route.id).catch(() => {})
    rerender()
    return
  }

  if (state.route.mode === 'liveList') state.activeView = 'live'

  const [featured, newest, artists, recent, popular, liveStreams] = await Promise.all([
    listFeaturedMusicReleases(16),
    listNewMusicReleases(18),
    listFeaturedArtists(14),
    state.currentUser ? listRecentlyPlayed(state.currentUser.uid, 12) : Promise.resolve([]),
    listPublishedMusicReleases({ limitCount: 16, sort: 'popular' }),
    listPublicLiveStreams({ limitCount: 20 })
  ])

  state.rows.featured = featured
  state.rows.newest = newest
  state.rows.staffPicks = featured.length ? featured : popular
  state.rows.rising = popular.length ? popular : newest
  state.rows.artists = artists
  state.rows.recentlyPlayed = recent
  state.rows.liveStreams = liveStreams
  if (libraryItems.some(([view]) => view === state.activeView)) {
    state.rows.library = await listUserLibraryMusic(state.currentUser?.uid || '', state.activeView, 20)
  }
  state.loading = false
  rerender()
  startLiveListRefresh()
}

window.addEventListener('popstate', () => {
  disconnectLiveListener()
  stopLiveStreamSubscription()
  stopLiveChatSubscription()
  stopLiveSequenceSubscription()
  state.route = currentRouteMode()
  state.activeView = getInitialView()
  loadMusicPage().catch(() => rerender())
})

window.addEventListener('beforeunload', (event) => {
  if (!isHostBroadcastActive()) return
  event.preventDefault()
  event.returnValue = ''
})

window.addEventListener('pagehide', () => {
  if (isHostBroadcastActive()) sendHostUnloadSignal('host_pagehide')
  if (state.liveStream?.id && state.nativeViewerSessionId) {
    clearPlaybackDemand(state.liveStream.id, state.nativeViewerSessionId).catch(() => {})
  }
  cleanupHlsPlayback()
  if (state.liveStream?.id && state.listenerPresenceId) {
    leaveMusicLiveStream(state.liveStream.id, state.listenerPresenceId).catch(() => {})
  }
})

loadMusicPage().catch((error) => {
  state.loading = false
  state.error = error?.message || 'Melogic Music could not be loaded.'
  console.warn('[music] Page load failed.', error)
  rerender()
})
