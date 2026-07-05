import './styles/base.css'
import './styles/music.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState } from './firebase/auth'
import { listPublishedMusicReleases, getMusicRelease, listTracksForRelease } from './data/musicService'
import { ROUTES, authRoute, musicReleaseRoute } from './utils/routes'

const app = document.querySelector('#app')

const state = {
  currentUser: null,
  releases: [],
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
  if (!total) return ''
  const minutes = Math.floor(total / 60)
  const remainder = String(total % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function currentRouteMode() {
  const match = window.location.pathname.match(/^\/music\/releases\/([^/]+)/)
  return match ? { mode: 'release', id: decodeURIComponent(match[1]) } : { mode: 'landing', id: '' }
}

function renderReleaseArtwork(release, className = 'music-release-art') {
  const cover = release?.coverArtURL || ''
  if (cover) return `<img class="${className}" src="${escapeHtml(cover)}" alt="${escapeHtml(release.title)} cover art" loading="lazy" />`
  return `<div class="${className} music-release-art-fallback" aria-hidden="true"><span>MR</span></div>`
}

function renderReleaseCard(release) {
  const meta = [titleCase(release.releaseType), release.genre, release.subgenre].filter(Boolean).join(' · ')
  const tags = [...(release.moods || []), ...(release.tags || [])].slice(0, 3)
  return `
    <article class="music-release-card">
      <a class="music-release-card-link" href="${musicReleaseRoute(release)}" aria-label="Open ${escapeHtml(release.title)}">
        ${renderReleaseArtwork(release)}
        <div class="music-release-card-body">
          <div class="music-release-card-meta">
            <span>${escapeHtml(meta || 'Release')}</span>
            ${release.explicit ? '<span class="music-explicit-badge">E</span>' : ''}
          </div>
          <h3>${escapeHtml(release.title)}</h3>
          <p>by ${escapeHtml(release.artistName)}</p>
          <div class="music-tag-row">
            ${tags.length ? tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join('') : '<span>New music</span>'}
          </div>
        </div>
      </a>
      <div class="music-release-card-actions">
        <a class="button button-muted" href="${musicReleaseRoute(release)}">Open</a>
        <button type="button" class="button button-muted" ${state.currentUser ? '' : 'disabled'} title="${state.currentUser ? 'Save release' : 'Sign in to save releases'}">Save</button>
      </div>
    </article>
  `
}

function renderReleaseGrid(releases, emptyTitle, emptyBody) {
  if (state.loading) {
    return `<div class="music-card-grid">${Array.from({ length: 4 }).map(() => '<article class="music-release-card music-card-skeleton" aria-hidden="true"></article>').join('')}</div>`
  }
  if (!releases.length) {
    return `
      <article class="music-empty-state">
        <h3>${escapeHtml(emptyTitle)}</h3>
        <p>${escapeHtml(emptyBody)}</p>
      </article>
    `
  }
  return `<div class="music-card-grid">${releases.map(renderReleaseCard).join('')}</div>`
}

function renderLandingPage() {
  const featured = state.releases.slice(0, 6)
  const newest = [...state.releases].slice(0, 8)
  const artists = [...new Map(state.releases.map((release) => [release.artistUid || release.artistName, release])).values()].slice(0, 4)
  const genres = [...new Set(state.releases.map((release) => release.genre).filter(Boolean))].slice(0, 8)
  const uploadHref = state.currentUser ? ROUTES.newProduct : authRoute({ redirect: ROUTES.newProduct })
  const emptyBody = 'Melogic Music is being prepared. Soon you’ll be able to discover releases from creators on Melogic Records.'

  app.innerHTML = `
    ${navShell({ currentPage: 'music' })}
    <main class="music-page">
      <section class="music-hero">
        <div class="section-inner music-hero-inner">
          <div class="music-hero-copy">
            <p class="music-eyebrow">Melogic Records</p>
            <h1>Melogic Music</h1>
            <p>Discover music released by creators on Melogic Records.</p>
            <div class="music-hero-actions">
              <a class="button button-accent" href="#featured-releases">Explore Releases</a>
              <a class="button button-muted" href="${uploadHref}">${state.currentUser ? 'Upload Music' : 'Submit Music'}</a>
            </div>
          </div>
          <div class="music-hero-panel" aria-label="Melogic Music status">
            <span>Public discovery foundation</span>
            <strong>${state.releases.length || 0}</strong>
            <p>published releases ready for discovery</p>
          </div>
        </div>
      </section>

      <section class="section-inner music-section" id="featured-releases">
        <div class="music-section-heading">
          <div>
            <p class="music-eyebrow">Featured Releases</p>
            <h2>Released on Melogic</h2>
          </div>
        </div>
        ${renderReleaseGrid(featured, 'Melogic Music is being prepared.', emptyBody)}
      </section>

      <section class="section-inner music-section">
        <div class="music-section-heading">
          <div>
            <p class="music-eyebrow">New on Melogic</p>
            <h2>Fresh public releases</h2>
          </div>
        </div>
        ${renderReleaseGrid(newest, 'No new releases yet.', emptyBody)}
      </section>

      <section class="section-inner music-split-section">
        <div class="music-panel">
          <p class="music-eyebrow">Artists to Watch</p>
          <h2>Creators building momentum</h2>
          ${artists.length ? `
            <div class="music-artist-list">
              ${artists.map((release) => `
                <a href="${musicReleaseRoute(release)}">
                  <span>${escapeHtml(release.artistName)}</span>
                  <small>${escapeHtml(release.title)}</small>
                </a>
              `).join('')}
            </div>
          ` : '<p class="music-muted">Artist discovery opens as public releases are approved.</p>'}
        </div>
        <div class="music-panel">
          <p class="music-eyebrow">Genres / Moods</p>
          <h2>Find a starting point</h2>
          <div class="music-genre-cloud">
            ${(genres.length ? genres : ['Electronic', 'Hip-Hop', 'Pop', 'Rock', 'Cinematic', 'Ambient']).map((genre) => `<span>${escapeHtml(genre)}</span>`).join('')}
          </div>
        </div>
      </section>

      <section class="section-inner music-section">
        <div class="music-how">
          <p class="music-eyebrow">How Melogic Music works</p>
          <h2>Public discovery first, creator infrastructure underneath.</h2>
          <div class="music-how-grid">
            <article><strong>Creators publish releases</strong><span>Approved public releases become discoverable on Melogic Music.</span></article>
            <article><strong>Streams use prepared audio</strong><span>Playback uses stream audio files only, keeping private masters separate.</span></article>
            <article><strong>Music connects the platform</strong><span>Future upload, profile, product, and community workflows can build on this model.</span></article>
          </div>
        </div>
      </section>
      ${renderPlayer()}
    </main>
  `
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

function renderReleaseDetailPage() {
  if (state.loading) {
    app.innerHTML = `${navShell({ currentPage: 'music' })}<main class="music-page"><section class="section-inner music-detail-state"><h1>Loading release...</h1></section></main>`
    return
  }

  if (!state.release) {
    app.innerHTML = `
      ${navShell({ currentPage: 'music' })}
      <main class="music-page">
        <section class="section-inner music-detail-state">
          <p class="music-eyebrow">Release unavailable</p>
          <h1>This Melogic Music release is not available.</h1>
          <p>It may still be in review, private, unlisted, or no longer published.</p>
          <a class="button button-accent" href="${ROUTES.music}">Back to Music</a>
        </section>
        ${renderPlayer()}
      </main>
    `
    return
  }

  const release = state.release
  const tags = [release.genre, release.subgenre, ...(release.moods || []), ...(release.tags || [])].filter(Boolean)
  app.innerHTML = `
    ${navShell({ currentPage: 'music' })}
    <main class="music-page">
      <section class="section-inner music-detail-hero">
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

      <section class="section-inner music-detail-grid">
        <div class="music-panel">
          <div class="music-section-heading">
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
      ${renderPlayer()}
    </main>
  `
}

function renderPlayer() {
  const track = state.player.track
  return `
    <aside class="music-player" data-music-player aria-label="Melogic Music player">
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
  currentRouteMode().mode === 'release' ? renderReleaseDetailPage() : renderLandingPage()
  bindMusicEvents()
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
  const toggle = player.querySelector('[data-player-toggle]')
  const seek = player.querySelector('[data-player-seek]')
  const timeSpans = player.querySelectorAll('.music-player-progress span')
  const clear = player.querySelector('[data-player-clear]')
  const track = state.player.track
  if (title) title.textContent = track?.title || 'No track selected'
  if (artist) artist.textContent = track?.artistName || 'Choose a playable track to start.'
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

function bindMusicEvents() {
  app.querySelectorAll('[data-play-track]').forEach((button) => {
    button.addEventListener('click', () => {
      const track = state.tracks.find((item) => item.id === button.dataset.playTrack)
      toggleTrack(track).catch((error) => {
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

async function loadMusicPage() {
  initShellChrome()
  state.currentUser = await waitForInitialAuthState().catch(() => null)
  const route = currentRouteMode()
  state.loading = true
  rerender()

  if (route.mode === 'release') {
    state.release = await getMusicRelease(route.id)
    state.tracks = state.release ? await listTracksForRelease(state.release.id) : []
    state.loading = false
    rerender()
    return
  }

  state.releases = await listPublishedMusicReleases({ limitCount: 24, sort: 'newest' })
  state.loading = false
  rerender()
}

loadMusicPage().catch((error) => {
  state.loading = false
  state.error = error?.message || 'Melogic Music could not be loaded.'
  console.warn('[music] Page load failed.', error)
  rerender()
})
