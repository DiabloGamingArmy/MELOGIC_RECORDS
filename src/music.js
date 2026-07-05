import './styles/base.css'
import './styles/music.css'
import { Room, RoomEvent, createLocalAudioTrack } from 'livekit-client'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState } from './firebase/auth'
import { getSiteAssetURL } from './firebase/siteAssets'
import {
  endMusicLiveStream,
  getMusicLiveStream,
  joinMusicLiveStream,
  listPublicLiveStreams,
  startMusicLiveStream
} from './data/musicLiveService'
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

const sidebarViews = {
  home: 'Home',
  new: 'New',
  radio: 'Radio',
  live: 'Live Streams',
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

const state = {
  currentUser: null,
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
  liveStatus: 'idle',
  liveError: '',
  listenerRoom: null,
  listenerAudioElement: null,
  goLive: {
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
    localTrack: null,
    starting: false,
    ending: false,
    formError: ''
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
  const liveMatch = path.match(/^\/music\/live\/([^/]+)/)
  if (liveMatch) return { mode: 'liveDetail', id: decodeURIComponent(liveMatch[1]) }
  if (path === '/music/live') return { mode: 'liveList', id: '' }
  if (path === '/music/go-live') return { mode: 'goLive', id: '' }
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

function renderLiveArtwork(stream, className = 'music-live-art') {
  const cover = stream?.coverArtURL || ''
  if (cover) return `<img class="${className}" src="${escapeHtml(cover)}" alt="${escapeHtml(stream.title)} cover art" loading="lazy" />`
  return `<div class="${className} music-live-art-fallback" aria-hidden="true"><span>LIVE</span></div>`
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
          <a class="button button-muted" href="${ROUTES.musicGoLive}">Go Live</a>
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
    ${carouselRow({ id: 'live-now', eyebrow: 'Live Streams', title: 'On air now', items: state.rows.liveStreams, type: 'live', emptyTitle: 'No live streams right now', emptyBody: 'Eligible creators can go live with audio-only broadcasts inside Melogic Music.' })}
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

function liveStreamCard(stream) {
  return `
    <article class="music-live-card">
      <a href="${musicLiveStreamRoute(stream)}" class="music-live-card-link">
        ${renderLiveArtwork(stream)}
        <div class="music-live-card-body">
          <span class="music-live-badge">LIVE</span>
          <h3>${escapeHtml(stream.title)}</h3>
          <p>${escapeHtml(stream.hostDisplayName)}</p>
          <div class="music-live-meta">
            <span>${escapeHtml(liveCategoryLabel(stream.category))}</span>
            <span>${Number(stream.listenerCount || 0).toLocaleString()} listening</span>
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
        <p>Audio-only live broadcasts from Melogic creators.</p>
      </div>
      <a class="button button-accent" href="${ROUTES.musicGoLive}">Go Live</a>
    </section>
    <div class="music-live-tabs">
      ${categories.map(([value, label]) => `<button type="button" class="${state.liveFilter === value ? 'is-active' : ''}" data-live-filter="${value}">${escapeHtml(label)}</button>`).join('')}
    </div>
    ${streams.length ? `<div class="music-live-grid">${streams.map(liveStreamCard).join('')}</div>` : emptyState('No live streams right now.', 'When eligible creators go live, their public audio streams will appear here.')}
  `
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

function renderGoLivePage() {
  const isSignedIn = Boolean(state.currentUser)
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
    ${!isSignedIn ? signInAction('Sign in as an eligible creator to start a live stream.') : `
      <section class="music-go-live-grid">
        <form class="music-go-live-form music-panel" data-go-live-form>
          <label><span>Category</span><select name="category">${categories.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select></label>
          <label><span>Title</span><input name="title" maxlength="90" required placeholder="Tonight on Melogic..." /></label>
          <label><span>Description</span><textarea name="description" rows="4" maxlength="1200" placeholder="Tell listeners what this stream is about."></textarea></label>
          <label><span>Cover image URL</span><input name="coverArtURL" placeholder="Optional image URL for this live stream" /></label>
          <label><span>Tags</span><input name="tags" placeholder="radio, new music, behind the scenes" /></label>
          <label><span>Visibility</span><select name="visibility"><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label>
          <div class="music-live-rules">
            <strong>Live stream rules</strong>
            <p>Stream only content you have rights to broadcast. No harmful, illegal, abusive, or unauthorized copyrighted audio. Melogic may remove streams that violate rules.</p>
            <label class="music-checkbox"><input type="checkbox" name="rightsAccepted" required /> <span>I have the rights or permission to broadcast this audio and agree to Melogic live stream rules.</span></label>
            <label class="music-checkbox"><input type="checkbox" name="archiveRequested" disabled /> <span>Request archive after stream. Save as replay is coming soon.</span></label>
          </div>
          ${state.goLive.formError ? `<p class="music-live-error">${escapeHtml(state.goLive.formError)}</p>` : ''}
          <div class="music-live-actions">
            <button class="button button-accent" type="submit" ${state.goLive.starting || state.goLive.streamId ? 'disabled' : ''}>${state.goLive.starting ? 'Starting...' : 'Start Live'}</button>
            <a class="button button-muted" href="${ROUTES.musicLive}">Cancel</a>
          </div>
        </form>
        <aside class="music-panel music-audio-setup">
          <p class="music-eyebrow">Audio input</p>
          <h2>Microphone / Interface</h2>
          <select data-live-device-select>
            <option value="">Browser default</option>
            ${state.goLive.devices.map((device) => `<option value="${escapeHtml(device.deviceId)}" ${state.goLive.selectedDeviceId === device.deviceId ? 'selected' : ''}>${escapeHtml(device.label || `Audio input ${state.goLive.devices.indexOf(device) + 1}`)}</option>`).join('')}
          </select>
          <div class="music-meter" aria-label="Audio input level"><span style="width:${Math.round(state.goLive.level * 100)}%"></span></div>
          <div class="music-live-actions">
            <button type="button" class="button button-muted" data-refresh-audio-devices>Enable / Refresh Mic</button>
            <button type="button" class="button button-muted" data-toggle-preview-mute>${state.goLive.muted ? 'Unmute Preview' : 'Mute Preview'}</button>
          </div>
          <p class="music-muted">${escapeHtml(state.goLive.connectionStatus || 'Choose an audio input before starting. Guests are coming later.')}</p>
          ${state.goLive.streamId ? `
            <div class="music-host-room">
              <span class="music-live-badge">LIVE</span>
              <h3>${escapeHtml(state.goLive.connectionStatus || 'Live stream started')}</h3>
              <p>Share: <a href="${musicLiveStreamRoute(state.goLive.streamId)}">${musicLiveStreamRoute(state.goLive.streamId)}</a></p>
              <button type="button" class="button button-danger" data-end-host-stream ${state.goLive.ending ? 'disabled' : ''}>${state.goLive.ending ? 'Ending...' : 'End Stream'}</button>
            </div>
          ` : ''}
        </aside>
      </section>
    `}
  `)
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
  renderAppShell(`
    <section class="music-live-detail">
      ${renderLiveArtwork(stream, 'music-live-detail-art')}
      <div class="music-live-detail-copy">
        <span class="music-live-badge">${stream.status === 'live' ? 'LIVE' : 'ENDED'}</span>
        <h1>${escapeHtml(stream.title)}</h1>
        <p>${escapeHtml(stream.description || 'Audio-only live stream on Melogic Music.')}</p>
        <div class="music-live-host">
          ${stream.hostPhotoURL ? `<img src="${escapeHtml(stream.hostPhotoURL)}" alt="" />` : '<span aria-hidden="true"></span>'}
          <div><strong>${escapeHtml(stream.hostDisplayName)}</strong><small>${escapeHtml(liveCategoryLabel(stream.category))} · ${Number(stream.listenerCount || 0).toLocaleString()} listening</small></div>
        </div>
        <div class="music-tag-row">${stream.tags.length ? stream.tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('') : '<span>Live audio</span>'}</div>
        <div class="music-live-listener">
          <button type="button" class="button button-accent" data-live-listen ${stream.status === 'live' ? '' : 'disabled'}>${state.liveStatus === 'live' ? 'Pause / Leave' : 'Listen'}</button>
          <label class="music-player-volume"><span>Volume</span><input type="range" min="0" max="1" step="0.01" value="${state.player.volume}" data-live-volume /></label>
          <button type="button" class="button button-muted" disabled>Report</button>
        </div>
        ${state.liveError ? `<p class="music-live-error">${escapeHtml(state.liveError)}</p>` : `<p class="music-muted" data-live-status>${escapeHtml(state.liveStatus === 'live' ? 'Live audio connected.' : state.liveStatus === 'connecting' ? 'Connecting...' : stream.status === 'live' ? 'Click Listen to join. Audio never autoplays.' : 'Stream ended.')}</p>`}
      </div>
    </section>
  `)
}

function renderPlayer() {
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
  if (state.route.mode === 'release') renderReleaseDetailPage()
  else if (state.route.mode === 'goLive') renderGoLivePage()
  else if (state.route.mode === 'liveDetail') renderLiveDetailPage()
  else renderLandingPage()
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

async function refreshAudioDevices() {
  if (!navigator.mediaDevices?.getUserMedia) {
    state.goLive.formError = 'This browser does not support audio input selection.'
    rerender()
    return
  }
  stopPreviewStream()
  const constraints = {
    audio: state.goLive.selectedDeviceId
      ? { deviceId: { exact: state.goLive.selectedDeviceId }, echoCancellation: true, noiseSuppression: true }
      : { echoCancellation: true, noiseSuppression: true },
    video: false
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints)
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

async function startHostBroadcast(form) {
  if (!state.currentUser) return
  const formData = new FormData(form)
  state.goLive.starting = true
  state.goLive.formError = ''
  state.goLive.connectionStatus = 'Creating live stream...'
  rerender()
  try {
    const payload = {
      title: formData.get('title'),
      description: formData.get('description'),
      category: formData.get('category'),
      visibility: formData.get('visibility'),
      coverArtURL: formData.get('coverArtURL'),
      tags: formData.get('tags'),
      rightsAccepted: formData.get('rightsAccepted') === 'on',
      archiveRequested: false,
      audioOnly: true
    }
    const response = await startMusicLiveStream(payload)
    const room = new Room({ adaptiveStream: true, dynacast: true })
    state.goLive.room = room
    state.goLive.streamId = response.streamId
    state.goLive.connectionStatus = 'Connecting host room...'
    room.on(RoomEvent.Connected, () => {
      state.goLive.connectionStatus = 'Live and broadcasting audio.'
      rerender()
    })
    room.on(RoomEvent.Reconnecting, () => {
      state.goLive.connectionStatus = 'Reconnecting...'
      rerender()
    })
    room.on(RoomEvent.Disconnected, () => {
      state.goLive.connectionStatus = 'Disconnected.'
      rerender()
    })
    await room.connect(response.url, response.hostToken)
    const localTrack = await createLocalAudioTrack({
      deviceId: state.goLive.selectedDeviceId || undefined,
      echoCancellation: true,
      noiseSuppression: true
    })
    state.goLive.localTrack = localTrack
    if (state.goLive.muted) await localTrack.mute()
    await room.localParticipant.publishTrack(localTrack)
    state.goLive.connectionStatus = 'Live and broadcasting audio.'
  } catch (error) {
    state.goLive.formError = error?.message || 'Could not start live stream.'
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
    if (state.goLive.localTrack) {
      state.goLive.localTrack.stop()
      state.goLive.localTrack = null
    }
    if (state.goLive.room) {
      state.goLive.room.disconnect()
      state.goLive.room = null
    }
    await endMusicLiveStream(state.goLive.streamId)
    stopPreviewStream()
    state.goLive.connectionStatus = 'Stream ended. Save as replay is coming soon.'
    state.goLive.streamId = ''
  } catch (error) {
    state.goLive.formError = error?.message || 'Could not end stream.'
  } finally {
    state.goLive.ending = false
    rerender()
  }
}

function disconnectLiveListener() {
  if (state.listenerAudioElement) {
    state.listenerAudioElement.remove()
    state.listenerAudioElement = null
  }
  if (state.listenerRoom) {
    state.listenerRoom.disconnect()
    state.listenerRoom = null
  }
  state.liveStatus = 'idle'
}

async function joinLiveListener() {
  if (!state.liveStream?.id) return
  if (state.liveStatus === 'live' || state.liveStatus === 'connecting') {
    disconnectLiveListener()
    rerender()
    return
  }
  clearPlayer()
  state.liveStatus = 'connecting'
  state.liveError = ''
  rerender()
  try {
    const credentials = await joinMusicLiveStream(state.liveStream.id)
    const room = new Room({ adaptiveStream: true, dynacast: true })
    state.listenerRoom = room
    room.on(RoomEvent.TrackSubscribed, (track) => {
      if (track.kind !== 'audio') return
      if (state.listenerAudioElement) state.listenerAudioElement.remove()
      const element = track.attach()
      element.controls = false
      element.autoplay = false
      element.volume = state.player.volume
      element.style.display = 'none'
      element.dataset.musicLiveAudio = 'true'
      document.body.appendChild(element)
      state.listenerAudioElement = element
      element.play().catch(() => {})
      state.liveStatus = 'live'
      updateLiveListenerControls()
    })
    room.on(RoomEvent.Reconnecting, () => {
      state.liveStatus = 'reconnecting'
      updateLiveListenerControls()
    })
    room.on(RoomEvent.Reconnected, () => {
      state.liveStatus = 'live'
      updateLiveListenerControls()
    })
    room.on(RoomEvent.Disconnected, () => {
      state.liveStatus = state.liveStream?.status === 'live' ? 'ended' : 'idle'
      updateLiveListenerControls()
    })
    await room.connect(credentials.url, credentials.listenerToken || credentials.token)
  } catch (error) {
    state.liveError = error?.message || 'Unable to connect to this live stream.'
    state.liveStatus = 'idle'
    rerender()
  }
}

function updateLiveListenerControls() {
  const button = app.querySelector('[data-live-listen]')
  const status = app.querySelector('[data-live-status]')
  if (button) button.textContent = state.liveStatus === 'live' ? 'Pause / Leave' : state.liveStatus === 'connecting' ? 'Connecting...' : 'Listen'
  if (status) status.textContent = state.liveStatus === 'live' ? 'Live audio connected.' : state.liveStatus === 'reconnecting' ? 'Reconnecting...' : state.liveStatus === 'connecting' ? 'Connecting...' : 'Click Listen to join.'
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

function setActiveView(view) {
  if (!sidebarViews[view]) return
  state.activeView = view
  state.sidebarOpen = false
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
    refreshAudioDevices().catch(() => {})
  })
  app.querySelector('[data-live-device-select]')?.addEventListener('change', (event) => {
    state.goLive.selectedDeviceId = event.target.value || ''
    refreshAudioDevices().catch(() => {})
  })
  app.querySelector('[data-toggle-preview-mute]')?.addEventListener('click', () => {
    state.goLive.muted = !state.goLive.muted
    if (state.goLive.previewStream) state.goLive.previewStream.getAudioTracks().forEach((track) => { track.enabled = !state.goLive.muted })
    if (state.goLive.localTrack) {
      const action = state.goLive.muted ? state.goLive.localTrack.mute() : state.goLive.localTrack.unmute()
      Promise.resolve(action).catch(() => {})
    }
    rerender()
  })
  app.querySelector('[data-go-live-form]')?.addEventListener('submit', (event) => {
    event.preventDefault()
    startHostBroadcast(event.currentTarget).catch(() => {})
  })
  app.querySelector('[data-end-host-stream]')?.addEventListener('click', () => {
    endHostBroadcast().catch(() => {})
  })
  app.querySelector('[data-live-listen]')?.addEventListener('click', () => {
    joinLiveListener().catch(() => {})
  })
  app.querySelector('[data-live-volume]')?.addEventListener('input', (event) => {
    state.player.volume = Number(event.target.value)
    if (state.listenerAudioElement) state.listenerAudioElement.volume = state.player.volume
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
  initShellChrome()
  state.currentUser = await waitForInitialAuthState().catch(() => null)
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

  if (state.route.mode === 'liveDetail') {
    state.activeView = 'live'
    state.liveStream = await getMusicLiveStream(state.route.id)
    state.loading = false
    rerender()
    return
  }

  if (state.route.mode === 'goLive') {
    state.activeView = 'live'
    state.loading = false
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
}

window.addEventListener('popstate', () => {
  disconnectLiveListener()
  state.route = currentRouteMode()
  state.activeView = getInitialView()
  rerender()
})

loadMusicPage().catch((error) => {
  state.loading = false
  state.error = error?.message || 'Melogic Music could not be loaded.'
  console.warn('[music] Page load failed.', error)
  rerender()
})
