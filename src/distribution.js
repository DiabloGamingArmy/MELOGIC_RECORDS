import './styles/base.css'
import './styles/distribution.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState } from './firebase/auth'
import {
  listMyMusicReleases,
  saveMusicReleaseDraft,
  submitMusicRelease,
  uploadDistributionArtwork
} from './data/distributionService'
import { ROUTES, authRoute, musicReleaseRoute } from './utils/routes'

const app = document.querySelector('#app')
const STEPS = [
  ['release', 'Release information'],
  ['tracks', 'Tracks & identifiers'],
  ['links', 'Streaming links'],
  ['artwork', 'Artwork & credits'],
  ['rights', 'Rights confirmation'],
  ['review', 'Review & submit']
]
const RELEASE_TYPES = [
  ['single', 'Single'],
  ['ep', 'EP'],
  ['album', 'Album'],
  ['demo', 'Demo'],
  ['beat_tape', 'Beat tape'],
  ['live_session', 'Live session'],
  ['remix', 'Remix']
]
const DISTRIBUTORS = [
  ['distrokid', 'DistroKid'],
  ['cd_baby', 'CD Baby'],
  ['tunecore', 'TuneCore'],
  ['unitedmasters', 'UnitedMasters'],
  ['amuse', 'Amuse'],
  ['ditto', 'Ditto'],
  ['other', 'Other']
]

const state = {
  user: null,
  loading: true,
  releases: [],
  error: '',
  message: '',
  wizardOpen: false,
  detailRelease: null,
  step: 0,
  saving: false,
  artworkFile: null,
  artworkPreview: '',
  form: emptyForm()
}

function emptyTrack(index = 0) {
  return {
    trackId: '',
    title: '',
    trackNumber: index + 1,
    discNumber: 1,
    isrc: '',
    explicit: false,
    spotifyUrl: ''
  }
}

function emptyForm() {
  return {
    releaseId: '',
    title: '',
    releaseType: 'single',
    sourceDistributor: 'distrokid',
    sourceDistributorLabel: '',
    upc: '',
    releaseDate: '',
    genre: '',
    subgenre: '',
    explicit: false,
    spotifyUrl: '',
    appleMusicUrl: '',
    hyperFollowUrl: '',
    distributorUrl: '',
    coverArtPath: '',
    coverArtURL: '',
    copyrightLine: '',
    publisherLine: '',
    credits: '',
    rightsAccepted: false,
    tracks: [emptyTrack(0)]
  }
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function humanLabel(value = '') {
  return String(value || '').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatDate(value = '') {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).format(date)
}

function dateInputValue(value = '') {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

function statusTone(status = '') {
  if (status === 'published') return 'published'
  if (status === 'submitted') return 'submitted'
  if (status === 'rejected') return 'rejected'
  return 'draft'
}

function statusCopy(release = {}) {
  if (release.status === 'published') return 'Live in Melogic Streaming'
  if (release.status === 'submitted') return 'Submitted for review'
  if (release.status === 'rejected') return release.reviewReason ? `Returned: ${release.reviewReason}` : 'Changes requested'
  return 'Private draft'
}

function releasePayload() {
  return {
    title: state.form.title,
    releaseType: state.form.releaseType,
    sourceDistributor: state.form.sourceDistributor,
    sourceDistributorLabel: state.form.sourceDistributorLabel,
    upc: state.form.upc,
    releaseDate: state.form.releaseDate,
    genre: state.form.genre,
    subgenre: state.form.subgenre,
    explicit: state.form.explicit,
    coverArtPath: state.form.coverArtPath,
    coverArtURL: state.form.coverArtURL,
    copyrightLine: state.form.copyrightLine,
    publisherLine: state.form.publisherLine,
    credits: state.form.credits,
    externalLinks: {
      spotify: state.form.spotifyUrl,
      appleMusic: state.form.appleMusicUrl,
      hyperFollow: state.form.hyperFollowUrl,
      distributor: state.form.distributorUrl
    }
  }
}

function trackPayloads() {
  return state.form.tracks.map((track, index) => ({
    trackId: track.trackId,
    title: track.title,
    trackNumber: index + 1,
    discNumber: track.discNumber || 1,
    isrc: track.isrc,
    explicit: track.explicit,
    externalLinks: { spotify: track.spotifyUrl }
  }))
}

function shell(content) {
  app.innerHTML = `
    ${navShell({ currentPage: 'distribution' })}
    <main class="distribution-page">
      ${content}
    </main>
  `
  initShellChrome()
  bindEvents()
}

function distributionHero() {
  const drafts = state.releases.filter((release) => ['draft', 'rejected'].includes(release.status)).length
  const inReview = state.releases.filter((release) => release.status === 'submitted').length
  const published = state.releases.filter((release) => release.status === 'published').length
  return `
    <section class="distribution-hero">
      <div class="distribution-hero-copy">
        <p class="distribution-eyebrow">Artist-controlled publishing</p>
        <h1>Distribution</h1>
        <p>Bring an existing release into Melogic Streaming with verified identifiers, official playback links, artwork, and rights confirmation.</p>
        ${state.user
          ? '<button type="button" class="distribution-primary" data-new-release>Add Existing Release</button>'
          : `<a class="distribution-primary" href="${authRoute({ redirect: ROUTES.distribution })}">Sign in to submit</a>`}
      </div>
      <dl class="distribution-stats" aria-label="Distribution release summary">
        <div><dt>Drafts</dt><dd>${drafts}</dd></div>
        <div><dt>In review</dt><dd>${inReview}</dd></div>
        <div><dt>Published</dt><dd>${published}</dd></div>
      </dl>
    </section>
  `
}

function releaseArtwork(release = {}) {
  const url = release.coverArtURL || ''
  return url
    ? `<img src="${escapeHtml(url)}" alt="${escapeHtml(release.title || 'Release')} cover" loading="lazy" />`
    : '<span class="distribution-cover-fallback" aria-hidden="true">MR</span>'
}

function releaseCards() {
  if (state.loading) {
    return '<section class="distribution-empty"><strong>Loading your releases…</strong><span>Checking drafts and review status.</span></section>'
  }
  if (!state.user) {
    return `
      <section class="distribution-empty">
        <strong>Your release workspace starts here.</strong>
        <span>Sign in to save private drafts, submit identifiers, and track review decisions.</span>
      </section>
    `
  }
  if (!state.releases.length) {
    return `
      <section class="distribution-empty">
        <strong>No distribution releases yet.</strong>
        <span>Add a release that already exists through DistroKid, CD Baby, TuneCore, or another distributor.</span>
        <button type="button" class="distribution-text-button" data-new-release>Start your first release</button>
      </section>
    `
  }
  return `
    <div class="distribution-release-list">
      ${state.releases.map((release) => {
        const editable = ['draft', 'rejected'].includes(release.status)
        return `
          <article class="distribution-release-row">
            <div class="distribution-release-cover">${releaseArtwork(release)}</div>
            <div class="distribution-release-main">
              <div class="distribution-release-title">
                <div>
                  <h3>${escapeHtml(release.title || 'Untitled release')}</h3>
                  <p>${escapeHtml(humanLabel(release.sourceDistributor || 'Distributor'))} · ${release.upc ? `UPC ${escapeHtml(release.upc)}` : 'UPC not added'}</p>
                </div>
                <span class="distribution-status is-${statusTone(release.status)}">${escapeHtml(humanLabel(release.status || 'draft'))}</span>
              </div>
              <p class="distribution-release-status">${escapeHtml(statusCopy(release))}</p>
              <div class="distribution-release-meta">
                <span>${release.tracks?.length || 0} ${release.tracks?.length === 1 ? 'track' : 'tracks'}</span>
                <span>${escapeHtml(humanLabel(release.releaseType || 'single'))}</span>
                <span>${escapeHtml(formatDate(release.releaseDate || release.createdAt))}</span>
              </div>
            </div>
            <div class="distribution-release-actions">
              ${release.status === 'published' ? `<a href="${musicReleaseRoute(release)}">Open in Streaming</a>` : ''}
              <button type="button" data-manage-release="${escapeHtml(release.id)}">${editable ? 'Edit' : 'Manage'}</button>
            </div>
          </article>
        `
      }).join('')}
    </div>
  `
}

function dashboardView() {
  return `
    ${distributionHero()}
    <section class="distribution-content">
      <header class="distribution-section-heading">
        <div>
          <p class="distribution-eyebrow">Catalog intake</p>
          <h2>My Releases</h2>
        </div>
        ${state.user ? '<button type="button" class="distribution-secondary" data-refresh-releases>Refresh</button>' : ''}
      </header>
      ${state.error ? `<p class="distribution-notice is-error">${escapeHtml(state.error)}</p>` : ''}
      ${state.message ? `<p class="distribution-notice is-success">${escapeHtml(state.message)}</p>` : ''}
      ${releaseCards()}
    </section>
    <section class="distribution-how">
      <div><span>01</span><strong>Connect the release</strong><p>Add distributor identifiers and official store links.</p></div>
      <div><span>02</span><strong>Confirm the rights</strong><p>Attest that you control the permissions needed to display it.</p></div>
      <div><span>03</span><strong>Publish after review</strong><p>Approved releases appear automatically in Streaming.</p></div>
    </section>
  `
}

function stepNavigation() {
  return `
    <nav class="distribution-steps" aria-label="Release submission steps">
      ${STEPS.map(([key, label], index) => `
        <button type="button" data-wizard-step="${index}" class="${index === state.step ? 'is-current' : ''} ${index < state.step ? 'is-complete' : ''}">
          <span>${index + 1}</span>
          <strong>${escapeHtml(label)}</strong>
        </button>
      `).join('')}
    </nav>
  `
}

function field(label, input, hint = '') {
  return `<label class="distribution-field"><span>${escapeHtml(label)}</span>${input}${hint ? `<small>${escapeHtml(hint)}</small>` : ''}</label>`
}

function releaseStep() {
  return `
    <div class="distribution-form-grid">
      ${field('Release title', `<input name="title" value="${escapeHtml(state.form.title)}" maxlength="180" required />`)}
      ${field('Release type', `<select name="releaseType">${RELEASE_TYPES.map(([value, label]) => `<option value="${value}" ${state.form.releaseType === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
      ${field('Distributor', `<select name="sourceDistributor">${DISTRIBUTORS.map(([value, label]) => `<option value="${value}" ${state.form.sourceDistributor === value ? 'selected' : ''}>${label}</option>`).join('')}</select>`)}
      ${state.form.sourceDistributor === 'other' ? field('Distributor name', `<input name="sourceDistributorLabel" value="${escapeHtml(state.form.sourceDistributorLabel)}" maxlength="120" />`) : ''}
      ${field('UPC / EAN', `<input name="upc" inputmode="numeric" value="${escapeHtml(state.form.upc)}" maxlength="18" placeholder="123456789012" />`, '8, 12, 13, or 14 digits')}
      ${field('Release date', `<input name="releaseDate" type="date" value="${escapeHtml(state.form.releaseDate)}" />`)}
      ${field('Primary genre', `<input name="genre" value="${escapeHtml(state.form.genre)}" maxlength="100" placeholder="Electronic" />`)}
      ${field('Subgenre', `<input name="subgenre" value="${escapeHtml(state.form.subgenre)}" maxlength="100" placeholder="Future bass" />`)}
      <label class="distribution-check"><input name="explicit" type="checkbox" ${state.form.explicit ? 'checked' : ''} /><span>This release contains explicit content</span></label>
    </div>
  `
}

function tracksStep() {
  return `
    <div class="distribution-track-editor">
      ${state.form.tracks.map((track, index) => `
        <article class="distribution-track-row" data-track-index="${index}">
          <span class="distribution-track-number">${index + 1}</span>
          ${field('Track title', `<input data-track-field="title" value="${escapeHtml(track.title)}" maxlength="180" />`)}
          ${field('ISRC', `<input data-track-field="isrc" value="${escapeHtml(track.isrc)}" maxlength="15" placeholder="USABC2612345" />`, '12 characters; spaces and hyphens are accepted')}
          ${field('Spotify track link', `<input data-track-field="spotifyUrl" type="url" value="${escapeHtml(track.spotifyUrl)}" placeholder="https://open.spotify.com/track/…" />`)}
          <label class="distribution-check"><input data-track-field="explicit" type="checkbox" ${track.explicit ? 'checked' : ''} /><span>Explicit</span></label>
          <button type="button" class="distribution-remove-track" data-remove-track="${index}" ${state.form.tracks.length === 1 ? 'disabled' : ''}>Remove</button>
        </article>
      `).join('')}
      <button type="button" class="distribution-text-button" data-add-track>+ Add another track</button>
    </div>
  `
}

function linksStep() {
  return `
    <div class="distribution-form-grid">
      ${field('Spotify album or track link', `<input name="spotifyUrl" type="url" value="${escapeHtml(state.form.spotifyUrl)}" placeholder="https://open.spotify.com/album/…" />`, 'Used for the official embedded player when available')}
      ${field('Apple Music link', `<input name="appleMusicUrl" type="url" value="${escapeHtml(state.form.appleMusicUrl)}" placeholder="https://music.apple.com/us/album/…" />`)}
      ${field('HyperFollow link', `<input name="hyperFollowUrl" type="url" value="${escapeHtml(state.form.hyperFollowUrl)}" placeholder="https://distrokid.com/hyperfollow/…" />`)}
      ${field('Other distributor landing page', `<input name="distributorUrl" type="url" value="${escapeHtml(state.form.distributorUrl)}" placeholder="https://…" />`)}
    </div>
    <p class="distribution-inline-note">At least one official Spotify or Apple Music playback link is required before submission. Melogic does not copy distributor-controlled audio in Phase 1.</p>
  `
}

function artworkStep() {
  const preview = state.artworkPreview || state.form.coverArtURL
  return `
    <div class="distribution-artwork-layout">
      <div class="distribution-artwork-preview">
        ${preview ? `<img src="${escapeHtml(preview)}" alt="Selected cover artwork preview" />` : '<span>Cover artwork</span>'}
      </div>
      <div class="distribution-artwork-fields">
        ${field('Cover artwork', '<input name="artwork" type="file" accept="image/jpeg,image/png,image/webp" />', 'JPG, PNG, or WebP · maximum 10 MB')}
        ${field('Credits', `<textarea name="credits" rows="6" maxlength="4000" placeholder="Producer: …&#10;Writer: …">${escapeHtml(state.form.credits)}</textarea>`)}
        ${field('Copyright line', `<input name="copyrightLine" value="${escapeHtml(state.form.copyrightLine)}" maxlength="300" placeholder="℗ 2026 Artist Name" />`)}
        ${field('Publisher line', `<input name="publisherLine" value="${escapeHtml(state.form.publisherLine)}" maxlength="300" placeholder="© 2026 Artist Name" />`)}
      </div>
    </div>
  `
}

function rightsStep() {
  return `
    <section class="distribution-rights">
      <p class="distribution-eyebrow">Rights confirmation v1</p>
      <h3>Confirm your authority to submit this release.</h3>
      <p>You confirm that you are the recording owner, an authorized representative, or otherwise control the rights needed for Melogic to display this metadata, artwork, and official third-party playback experience.</p>
      <p>This submission does not transfer ownership to Melogic and does not authorize Melogic to copy or host distributor-controlled audio.</p>
      <label class="distribution-rights-check">
        <input name="rightsAccepted" type="checkbox" ${state.form.rightsAccepted ? 'checked' : ''} />
        <span>I understand and confirm that I have the necessary rights and authority.</span>
      </label>
    </section>
  `
}

function reviewLine(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${value || '<span>Not provided</span>'}</dd></div>`
}

function reviewStep() {
  const officialLinks = [
    state.form.spotifyUrl ? 'Spotify' : '',
    state.form.appleMusicUrl ? 'Apple Music' : '',
    state.form.hyperFollowUrl ? 'HyperFollow' : ''
  ].filter(Boolean)
  return `
    <div class="distribution-review-grid">
      <dl>
        ${reviewLine('Release', escapeHtml(state.form.title || 'Untitled release'))}
        ${reviewLine('Distributor', escapeHtml(humanLabel(state.form.sourceDistributorLabel || state.form.sourceDistributor)))}
        ${reviewLine('UPC', escapeHtml(state.form.upc))}
        ${reviewLine('Release date', escapeHtml(state.form.releaseDate ? formatDate(state.form.releaseDate) : ''))}
        ${reviewLine('Genre', escapeHtml([state.form.genre, state.form.subgenre].filter(Boolean).join(' · ')))}
        ${reviewLine('Official links', escapeHtml(officialLinks.join(', ')))}
        ${reviewLine('Rights', state.form.rightsAccepted ? '<strong class="is-confirmed">Confirmed</strong>' : '<strong class="is-missing">Not confirmed</strong>')}
      </dl>
      <section>
        <p class="distribution-eyebrow">Track list</p>
        <ol>${state.form.tracks.map((track) => `<li><span>${escapeHtml(track.title || 'Untitled track')}</span><small>${escapeHtml(track.isrc || 'ISRC missing')}</small></li>`).join('')}</ol>
      </section>
    </div>
  `
}

function activeStepContent() {
  if (state.step === 0) return releaseStep()
  if (state.step === 1) return tracksStep()
  if (state.step === 2) return linksStep()
  if (state.step === 3) return artworkStep()
  if (state.step === 4) return rightsStep()
  return reviewStep()
}

function wizardView() {
  return `
    <section class="distribution-workspace">
      <header class="distribution-workspace-header">
        <div>
          <p class="distribution-eyebrow">${state.form.releaseId ? 'Edit private draft' : 'New release intake'}</p>
          <h1>${escapeHtml(state.form.title || 'Add Existing Release')}</h1>
        </div>
        <button type="button" class="distribution-close" data-close-wizard aria-label="Close release editor">Close</button>
      </header>
      ${state.error ? `<p class="distribution-notice is-error">${escapeHtml(state.error)}</p>` : ''}
      ${state.message ? `<p class="distribution-notice is-success">${escapeHtml(state.message)}</p>` : ''}
      <div class="distribution-workspace-grid">
        ${stepNavigation()}
        <form class="distribution-wizard" data-distribution-form>
          <header>
            <span>Step ${state.step + 1} of ${STEPS.length}</span>
            <h2>${escapeHtml(STEPS[state.step][1])}</h2>
          </header>
          <div class="distribution-step-content">${activeStepContent()}</div>
          <footer>
            <button type="button" class="distribution-secondary" data-save-draft ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving…' : 'Save draft'}</button>
            <span class="distribution-footer-spacer"></span>
            ${state.step > 0 ? '<button type="button" class="distribution-secondary" data-previous-step>Back</button>' : ''}
            ${state.step < STEPS.length - 1
              ? '<button type="button" class="distribution-primary" data-next-step>Continue</button>'
              : `<button type="button" class="distribution-primary" data-submit-release ${state.saving ? 'disabled' : ''}>${state.saving ? 'Submitting…' : 'Submit for review'}</button>`}
          </footer>
        </form>
      </div>
    </section>
  `
}

function detailView() {
  const release = state.detailRelease
  return `
    <section class="distribution-workspace">
      <header class="distribution-workspace-header">
        <div>
          <p class="distribution-eyebrow">${escapeHtml(humanLabel(release.status || 'release'))}</p>
          <h1>${escapeHtml(release.title || 'Untitled release')}</h1>
        </div>
        <button type="button" class="distribution-close" data-close-detail>Close</button>
      </header>
      <div class="distribution-readonly">
        <div class="distribution-readonly-cover">${releaseArtwork(release)}</div>
        <dl>
          ${reviewLine('Status', escapeHtml(statusCopy(release)))}
          ${reviewLine('Distributor', escapeHtml(humanLabel(release.sourceDistributor || 'Other')))}
          ${reviewLine('UPC', escapeHtml(release.upc || ''))}
          ${reviewLine('Release date', escapeHtml(formatDate(release.releaseDate)))}
          ${reviewLine('Tracks', escapeHtml(String(release.tracks?.length || 0)))}
          ${reviewLine('Last updated', escapeHtml(formatDate(release.updatedAt || release.createdAt)))}
        </dl>
        <div class="distribution-readonly-actions">
          ${release.status === 'published' ? `<a class="distribution-primary" href="${musicReleaseRoute(release)}">Open in Streaming</a>` : ''}
          <p>${escapeHtml(statusCopy(release))}</p>
        </div>
      </div>
    </section>
  `
}

function render() {
  if (state.wizardOpen) return shell(wizardView())
  if (state.detailRelease) return shell(detailView())
  return shell(dashboardView())
}

function releaseToForm(release = {}) {
  return {
    ...emptyForm(),
    releaseId: release.id || release.releaseId || '',
    title: release.title || '',
    releaseType: release.releaseType || 'single',
    sourceDistributor: release.sourceDistributor || 'other',
    sourceDistributorLabel: release.sourceDistributorLabel || '',
    upc: release.upc || '',
    releaseDate: dateInputValue(release.releaseDate),
    genre: release.genre || '',
    subgenre: release.subgenre || '',
    explicit: release.explicit === true,
    spotifyUrl: release.externalLinks?.spotify || '',
    appleMusicUrl: release.externalLinks?.appleMusic || '',
    hyperFollowUrl: release.externalLinks?.hyperFollow || '',
    distributorUrl: release.externalLinks?.distributor || '',
    coverArtPath: release.coverArtPath || '',
    coverArtURL: release.coverArtURL || '',
    copyrightLine: release.copyrightLine || '',
    publisherLine: release.publisherLine || '',
    credits: typeof release.credits === 'string' ? release.credits : JSON.stringify(release.credits || '', null, 2),
    rightsAccepted: release.rightsAttestation?.accepted === true,
    tracks: (release.tracks?.length ? release.tracks : [emptyTrack(0)]).map((track, index) => ({
      ...emptyTrack(index),
      trackId: track.id || track.trackId || '',
      title: track.title || '',
      isrc: track.isrc || '',
      explicit: track.explicit === true,
      spotifyUrl: track.externalLinks?.spotify || track.externalPlaybackURL || ''
    }))
  }
}

function syncFormElement(element) {
  if (!element?.name || element.name === 'artwork') return
  state.form[element.name] = element.type === 'checkbox' ? element.checked : element.value
}

function syncVisibleInputs() {
  app.querySelectorAll('[data-distribution-form] [name]').forEach(syncFormElement)
  app.querySelectorAll('[data-track-index]').forEach((row) => {
    const index = Number(row.getAttribute('data-track-index'))
    row.querySelectorAll('[data-track-field]').forEach((input) => {
      const key = input.getAttribute('data-track-field')
      state.form.tracks[index][key] = input.type === 'checkbox' ? input.checked : input.value
    })
  })
}

function validateStep(step = state.step) {
  syncVisibleInputs()
  if (step === 0) {
    if (!state.form.title.trim()) return 'Enter the release title.'
    if (!/^(?:\d{8}|\d{12,14})$/.test(state.form.upc.replace(/[\s-]/g, ''))) return 'Enter a valid 8, 12, 13, or 14 digit UPC/EAN.'
    if (!state.form.releaseDate) return 'Choose the release date.'
    if (!state.form.genre.trim()) return 'Enter a primary genre.'
  }
  if (step === 1) {
    if (!state.form.tracks.length) return 'Add at least one track.'
    for (const [index, track] of state.form.tracks.entries()) {
      if (!track.title.trim()) return `Enter a title for track ${index + 1}.`
      if (!/^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(track.isrc.replace(/[\s-]/g, '').toUpperCase())) {
        return `Enter a valid ISRC for track ${index + 1}.`
      }
    }
  }
  if (step === 2 && !state.form.spotifyUrl.trim() && !state.form.appleMusicUrl.trim() && !state.form.tracks.some((track) => track.spotifyUrl.trim())) {
    return 'Add an official Spotify or Apple Music playback link.'
  }
  if (step === 3) {
    if (!state.form.coverArtURL && !state.form.coverArtPath && !state.artworkFile) return 'Choose cover artwork.'
    if (!state.form.copyrightLine.trim()) return 'Enter the copyright line.'
  }
  if (step === 4 && !state.form.rightsAccepted) return 'Confirm the rights attestation before continuing.'
  return ''
}

async function persistDraft({ quiet = false } = {}) {
  if (!state.user) throw new Error('Sign in to save this release.')
  syncVisibleInputs()
  state.saving = true
  state.error = ''
  if (!quiet) state.message = ''
  render()
  try {
    let result = await saveMusicReleaseDraft({
      releaseId: state.form.releaseId,
      release: releasePayload(),
      tracks: trackPayloads()
    })
    state.form.releaseId = result.releaseId
    const initialSavedTracks = result.tracks || []
    state.form.tracks = state.form.tracks.map((track, index) => ({
      ...track,
      trackId: initialSavedTracks[index]?.trackId || initialSavedTracks[index]?.id || track.trackId
    }))
    if (state.artworkFile) {
      const artwork = await uploadDistributionArtwork({
        uid: state.user.uid,
        releaseId: result.releaseId,
        file: state.artworkFile
      })
      state.form.coverArtPath = artwork.path
      state.form.coverArtURL = artwork.url
      result = await saveMusicReleaseDraft({
        releaseId: result.releaseId,
        release: releasePayload(),
        tracks: trackPayloads()
      })
      state.artworkFile = null
      state.artworkPreview = artwork.url
    }
    const savedTracks = result.tracks || []
    state.form.tracks = state.form.tracks.map((track, index) => ({
      ...track,
      trackId: savedTracks[index]?.trackId || savedTracks[index]?.id || track.trackId
    }))
    if (!quiet) state.message = 'Private draft saved.'
    return result
  } catch (error) {
    state.error = error?.details?.problems?.join(' ') || error?.message || 'Release draft could not be saved.'
    throw error
  } finally {
    state.saving = false
    render()
  }
}

async function submitCurrentRelease() {
  for (let step = 0; step < STEPS.length - 1; step += 1) {
    const problem = validateStep(step)
    if (problem) {
      state.step = step
      state.error = problem
      render()
      return
    }
  }
  state.saving = true
  state.error = ''
  render()
  try {
    await persistDraft({ quiet: true })
    state.saving = true
    render()
    await submitMusicRelease({
      releaseId: state.form.releaseId,
      rightsAccepted: state.form.rightsAccepted
    })
    state.wizardOpen = false
    state.form = emptyForm()
    state.message = 'Release submitted for review. It remains private until an administrator approves it.'
    await loadReleases({ preserveMessage: true })
  } catch (error) {
    state.error = error?.details?.problems?.join(' ') || error?.message || 'Release could not be submitted.'
  } finally {
    state.saving = false
    render()
  }
}

async function loadReleases({ preserveMessage = false } = {}) {
  if (!state.user) {
    state.loading = false
    render()
    return
  }
  state.loading = true
  state.error = ''
  if (!preserveMessage) state.message = ''
  render()
  try {
    const result = await listMyMusicReleases()
    state.releases = result.releases || []
  } catch (error) {
    state.error = error?.message || 'Your distribution releases could not be loaded.'
  } finally {
    state.loading = false
    render()
  }
}

function bindEvents() {
  app.querySelectorAll('[data-new-release]').forEach((button) => {
    button.addEventListener('click', () => {
      state.form = emptyForm()
      state.step = 0
      state.error = ''
      state.message = ''
      state.artworkFile = null
      state.artworkPreview = ''
      state.wizardOpen = true
      render()
    })
  })
  app.querySelector('[data-refresh-releases]')?.addEventListener('click', () => loadReleases())
  app.querySelectorAll('[data-manage-release]').forEach((button) => {
    button.addEventListener('click', () => {
      const release = state.releases.find((item) => item.id === button.getAttribute('data-manage-release'))
      if (!release) return
      if (['draft', 'rejected'].includes(release.status)) {
        state.form = releaseToForm(release)
        state.step = 0
        state.wizardOpen = true
      } else {
        state.detailRelease = release
      }
      state.error = ''
      state.message = ''
      render()
    })
  })
  app.querySelector('[data-close-detail]')?.addEventListener('click', () => {
    state.detailRelease = null
    render()
  })
  app.querySelector('[data-close-wizard]')?.addEventListener('click', () => {
    state.wizardOpen = false
    state.artworkFile = null
    if (state.artworkPreview?.startsWith('blob:')) URL.revokeObjectURL(state.artworkPreview)
    state.artworkPreview = ''
    render()
  })
  app.querySelectorAll('[data-wizard-step]').forEach((button) => {
    button.addEventListener('click', () => {
      syncVisibleInputs()
      state.step = Number(button.getAttribute('data-wizard-step')) || 0
      state.error = ''
      render()
    })
  })
  app.querySelector('[data-previous-step]')?.addEventListener('click', () => {
    syncVisibleInputs()
    state.step = Math.max(0, state.step - 1)
    state.error = ''
    render()
  })
  app.querySelector('[data-next-step]')?.addEventListener('click', () => {
    const problem = validateStep()
    if (problem) {
      state.error = problem
      render()
      return
    }
    state.step = Math.min(STEPS.length - 1, state.step + 1)
    state.error = ''
    render()
  })
  app.querySelector('[data-save-draft]')?.addEventListener('click', () => persistDraft().catch(() => null))
  app.querySelector('[data-submit-release]')?.addEventListener('click', submitCurrentRelease)
  app.querySelector('[data-add-track]')?.addEventListener('click', () => {
    syncVisibleInputs()
    state.form.tracks.push(emptyTrack(state.form.tracks.length))
    render()
  })
  app.querySelectorAll('[data-remove-track]').forEach((button) => {
    button.addEventListener('click', () => {
      syncVisibleInputs()
      if (state.form.tracks.length <= 1) return
      state.form.tracks.splice(Number(button.getAttribute('data-remove-track')), 1)
      render()
    })
  })
  app.querySelector('[name="sourceDistributor"]')?.addEventListener('change', (event) => {
    state.form.sourceDistributor = event.target.value
    render()
  })
  app.querySelector('[name="artwork"]')?.addEventListener('change', (event) => {
    const file = event.target.files?.[0] || null
    if (!file) return
    if (state.artworkPreview?.startsWith('blob:')) URL.revokeObjectURL(state.artworkPreview)
    state.artworkFile = file
    state.artworkPreview = URL.createObjectURL(file)
    const preview = app.querySelector('.distribution-artwork-preview')
    if (preview) preview.innerHTML = `<img src="${escapeHtml(state.artworkPreview)}" alt="Selected cover artwork preview" />`
  })
  app.querySelector('[data-distribution-form]')?.addEventListener('submit', (event) => event.preventDefault())
}

async function init() {
  render()
  state.user = await waitForInitialAuthState()
  state.loading = Boolean(state.user)
  await loadReleases()
}

init()
