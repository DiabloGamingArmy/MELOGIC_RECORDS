const { onCall, HttpsError } = require('firebase-functions/v2/https')
const logger = require('firebase-functions/logger')
const admin = require('firebase-admin')
const { getDownloadURL } = require('firebase-admin/storage')
const { cleanString, requireAdminActionSecurity } = require('../admin/adminAuth')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { writeAccountEvent } = require('../account/accountEvents')

const CALLABLE_OPTIONS = { timeoutSeconds: 60, memory: '256MiB' }
const RELEASE_TYPES = new Set(['single', 'ep', 'album', 'demo', 'beat_tape', 'live_session', 'remix'])
const EDITABLE_STATUSES = new Set(['draft', 'rejected'])
const DISTRIBUTORS = new Set(['distrokid', 'cd_baby', 'tunecore', 'unitedmasters', 'amuse', 'ditto', 'other'])
const URL_RULES = {
  spotify: {
    hosts: ['open.spotify.com'],
    path: /^\/(album|track)\/[A-Za-z0-9]{22}(?:\/|$)/
  },
  appleMusic: {
    hosts: ['music.apple.com'],
    path: /^\/[A-Za-z]{2}(?:-[A-Za-z]{2})?\/.+/
  },
  hyperFollow: {
    hosts: ['distrokid.com', 'www.distrokid.com', 'hyperfollow.com', 'www.hyperfollow.com'],
    path: /^\/(?:hyperfollow\/)?[^/]+/
  }
}
const UPC_PATTERN = /^(?:\d{8}|\d{12,14})$/
const ISRC_PATTERN = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/

function db() {
  return admin.firestore()
}

function cleanLongString(value = '', max = 5000) {
  return String(value ?? '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function cleanId(value = '', label = 'ID') {
  const id = cleanString(value, 180)
  if (!id || id === '.' || id === '..' || id.includes('/')) {
    throw new HttpsError('invalid-argument', `${label} is invalid.`)
  }
  return id
}

function slugify(value = '') {
  return cleanString(value, 240)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160)
}

function normalizeUpc(value = '') {
  return cleanString(value, 32).replace(/[\s-]/g, '')
}

function normalizeIsrc(value = '') {
  return cleanString(value, 32).replace(/[\s-]/g, '').toUpperCase()
}

function normalizeDate(value = '') {
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate()
    if (Number.isNaN(date.getTime())) throw new HttpsError('invalid-argument', 'Release date is invalid.')
    return admin.firestore.Timestamp.fromDate(date)
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new HttpsError('invalid-argument', 'Release date is invalid.')
    return admin.firestore.Timestamp.fromDate(value)
  }
  const text = cleanString(value, 80).slice(0, 10)
  if (!text) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new HttpsError('invalid-argument', 'Release date must use YYYY-MM-DD format.')
  }
  const date = new Date(`${text.slice(0, 10)}T12:00:00.000Z`)
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) {
    throw new HttpsError('invalid-argument', 'Release date is invalid.')
  }
  return admin.firestore.Timestamp.fromDate(date)
}

function serializeDate(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  return cleanString(value, 80)
}

function normalizeExternalUrl(value = '', provider = '') {
  const text = cleanString(value, 1200)
  if (!text) return ''
  let parsed
  try {
    parsed = new URL(text)
  } catch {
    throw new HttpsError('invalid-argument', `${provider || 'External'} URL is invalid.`)
  }
  if (parsed.protocol !== 'https:') {
    throw new HttpsError('invalid-argument', `${provider || 'External'} URL must use HTTPS.`)
  }
  const rule = URL_RULES[provider]
  if (rule && (!rule.hosts.includes(parsed.hostname.toLowerCase()) || !rule.path.test(parsed.pathname))) {
    throw new HttpsError('invalid-argument', `${provider} URL is not from an approved ${provider} domain or path.`)
  }
  parsed.hash = ''
  return parsed.toString()
}

function normalizeArtworkPath(value = '', uid = '', releaseId = '') {
  const path = cleanString(value, 600).replace(/^\/+/, '')
  if (!path) return ''
  const prefix = `users/${uid}/distribution/${releaseId}/artwork/`
  if (!path.startsWith(prefix) || path.includes('..')) {
    throw new HttpsError('invalid-argument', 'Artwork path is outside this release.')
  }
  return path
}

function validateArtworkMetadata(metadata = {}, { uid = '', releaseId = '' } = {}) {
  const problems = []
  const customMetadata = metadata.metadata || {}
  const size = Number(metadata.size || 0)
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(metadata.contentType || '')) {
    problems.push('Cover artwork must be a JPG, PNG, or WebP image.')
  }
  if (!Number.isFinite(size) || size <= 0 || size > 10 * 1024 * 1024) {
    problems.push('Cover artwork must be between 1 byte and 10 MB.')
  }
  if (customMetadata.ownerUid !== uid || customMetadata.releaseId !== releaseId || customMetadata.assetRole !== 'cover_art') {
    problems.push('Cover artwork ownership metadata does not match this release.')
  }
  return problems
}

async function loadTrustedArtwork(release = {}) {
  const releaseId = cleanId(release.releaseId || '', 'Release ID')
  const uid = cleanId(release.artistUid || '', 'Artist ID')
  const path = normalizeArtworkPath(release.coverArtPath || '', uid, releaseId)
  if (!path) throw new HttpsError('failed-precondition', 'Upload cover artwork to this release before submission.')
  const file = admin.storage().bucket().file(path)
  let metadata
  try {
    const metadataResult = await file.getMetadata()
    metadata = metadataResult[0]
  } catch (error) {
    if (Number(error?.code) === 404) {
      throw new HttpsError('failed-precondition', 'The selected cover artwork no longer exists. Upload it again.')
    }
    throw new HttpsError('unavailable', 'Cover artwork could not be verified. Try again.', {
      storageCode: cleanString(error?.code || '', 80)
    })
  }
  const problems = validateArtworkMetadata(metadata, { uid, releaseId })
  if (problems.length) throw new HttpsError('failed-precondition', problems.join(' '), { problems })
  try {
    return {
      path,
      url: await getDownloadURL(file)
    }
  } catch (error) {
    throw new HttpsError('failed-precondition', 'Cover artwork is missing a valid Firebase download token. Upload it again.', {
      storageCode: cleanString(error?.code || '', 80)
    })
  }
}

function normalizeCredits(value = '') {
  if (Array.isArray(value)) {
    return value.slice(0, 40).map((entry) => {
      if (typeof entry === 'string') return cleanString(entry, 240)
      return {
        role: cleanString(entry?.role || '', 100),
        name: cleanString(entry?.name || '', 180)
      }
    }).filter((entry) => typeof entry === 'string' ? entry : entry.role || entry.name)
  }
  return cleanLongString(value, 4000)
}

function normalizeTrack(raw = {}, index = 0, { releaseId = '', uid = '', artistName = '', status = 'draft' } = {}) {
  const trackNumber = Math.max(1, Math.min(100, Number.parseInt(raw.trackNumber || index + 1, 10) || index + 1))
  const isrc = normalizeIsrc(raw.isrc)
  const title = cleanString(raw.title || '', 180)
  const spotify = normalizeExternalUrl(raw.externalLinks?.spotify || raw.spotifyUrl || '', 'spotify')
  return {
    trackId: raw.trackId ? cleanId(raw.trackId, 'Track ID') : '',
    releaseId,
    artistUid: uid,
    artistName,
    title,
    slug: slugify(title || `track-${trackNumber}`),
    trackNumber,
    discNumber: Math.max(1, Math.min(10, Number.parseInt(raw.discNumber || 1, 10) || 1)),
    isrc,
    explicit: raw.explicit === true,
    status,
    visibility: 'private',
    playbackType: spotify ? 'spotify_embed' : 'external_link',
    externalPlaybackURL: spotify,
    externalLinks: {
      spotify
    }
  }
}

function normalizeReleaseInput(raw = {}, { uid = '', releaseId = '', artistName = '', status = 'draft' } = {}) {
  const title = cleanString(raw.title || '', 180)
  const releaseType = RELEASE_TYPES.has(cleanString(raw.releaseType, 40)) ? cleanString(raw.releaseType, 40) : 'single'
  const sourceDistributor = DISTRIBUTORS.has(cleanString(raw.sourceDistributor, 60))
    ? cleanString(raw.sourceDistributor, 60)
    : 'other'
  const upc = normalizeUpc(raw.upc)
  const spotify = normalizeExternalUrl(raw.externalLinks?.spotify || raw.spotifyUrl || '', 'spotify')
  const appleMusic = normalizeExternalUrl(raw.externalLinks?.appleMusic || raw.appleMusicUrl || '', 'appleMusic')
  const hyperFollow = normalizeExternalUrl(raw.externalLinks?.hyperFollow || raw.hyperFollowUrl || '', 'hyperFollow')
  const artworkPath = normalizeArtworkPath(raw.coverArtPath || '', uid, releaseId)
  const coverArtURL = normalizeExternalUrl(raw.coverArtURL || '', '')
  const distributorUrl = normalizeExternalUrl(raw.externalLinks?.distributor || raw.distributorUrl || '', '')
  return {
    title,
    slug: slugify(title || releaseId),
    artistUid: uid,
    artistName,
    releaseType,
    source: 'artist_submission',
    sourceDistributor,
    sourceDistributorLabel: cleanString(raw.sourceDistributorLabel || '', 120),
    upc,
    releaseDate: normalizeDate(raw.releaseDate),
    genre: cleanString(raw.genre || '', 100),
    subgenre: cleanString(raw.subgenre || '', 100),
    explicit: raw.explicit === true,
    coverArtPath: artworkPath,
    coverArtURL,
    copyrightLine: cleanString(raw.copyrightLine || '', 300),
    publisherLine: cleanString(raw.publisherLine || '', 300),
    credits: normalizeCredits(raw.credits),
    externalLinks: {
      spotify,
      appleMusic,
      hyperFollow,
      distributor: distributorUrl
    },
    playbackType: spotify ? 'spotify_embed' : 'external_link',
    externalPlaybackURL: spotify,
    status,
    visibility: 'private',
    searchKeywords: Array.from(new Set([
      ...title.toLowerCase().split(/\s+/),
      ...artistName.toLowerCase().split(/\s+/),
      cleanString(raw.genre || '', 100).toLowerCase()
    ].map((entry) => entry.replace(/[^a-z0-9-]/g, '')).filter((entry) => entry.length > 1))).slice(0, 40)
  }
}

function assertSignedIn(request = {}) {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in to manage distribution releases.')
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError('permission-denied', 'Verify your email before submitting music.')
  }
  return {
    uid,
    email: cleanString(request.auth?.token?.email || '', 320),
    displayName: cleanString(request.auth?.token?.name || '', 180)
  }
}

async function loadArtistIdentity(uid = '', fallbackName = '') {
  const [userSnap, profileSnap, permissionSnap] = await Promise.all([
    db().collection('users').doc(uid).get(),
    db().collection('profiles').doc(uid).get(),
    db().collection('users').doc(uid).collection('permissions').doc('current').get()
  ])
  const user = userSnap.exists ? userSnap.data() || {} : {}
  const profile = profileSnap.exists ? profileSnap.data() || {} : {}
  const permissions = permissionSnap.exists ? permissionSnap.data() || {} : {}
  const restrictions = permissions.restrictions || {}
  if (
    user.suspended === true
    || profile.suspended === true
    || user.accountStatus === 'suspended'
    || profile.accountStatus === 'suspended'
    || restrictions.suspended === true
    || restrictions.musicRestricted === true
  ) {
    throw new HttpsError('permission-denied', 'Music distribution is unavailable for this account.')
  }
  const artistName = cleanString(
    profile.artistName
      || profile.displayName
      || user.displayName
      || profile.username
      || user.username
      || fallbackName
      || 'Melogic Artist',
    180
  )
  return { artistName, profile, user }
}

async function assertUniqueIdentifiers({ releaseId = '', upc = '', tracks = [] } = {}) {
  if (upc) {
    const matches = await db().collection('musicReleases').where('upc', '==', upc).limit(3).get()
    if (matches.docs.some((snap) => snap.id !== releaseId)) {
      throw new HttpsError('already-exists', 'That UPC is already attached to another Melogic release.')
    }
  }
  const seen = new Set()
  for (const track of tracks) {
    if (!track.isrc) continue
    if (seen.has(track.isrc)) throw new HttpsError('invalid-argument', `ISRC ${track.isrc} is used more than once in this release.`)
    seen.add(track.isrc)
    const matches = await db().collection('musicTracks').where('isrc', '==', track.isrc).limit(3).get()
    if (matches.docs.some((snap) => snap.data()?.releaseId !== releaseId)) {
      throw new HttpsError('already-exists', `ISRC ${track.isrc} is already attached to another Melogic track.`)
    }
  }
}

function validateForSubmission(release = {}, tracks = []) {
  const problems = []
  if (!release.title) problems.push('Release title is required.')
  if (!release.artistName) problems.push('Artist name is required.')
  if (release.sourceDistributor === 'other' && !release.sourceDistributorLabel) {
    problems.push('Distributor name is required when Other is selected.')
  }
  if (!UPC_PATTERN.test(release.upc || '')) problems.push('UPC must contain 8, 12, 13, or 14 digits.')
  if (!release.releaseDate) problems.push('Release date is required.')
  if (!release.genre) problems.push('Genre is required.')
  if (!release.coverArtPath) problems.push('Upload cover artwork to this release before submission.')
  if (!release.copyrightLine) problems.push('Copyright line is required.')
  if (!tracks.length) problems.push('Add at least one track.')
  tracks.forEach((track, index) => {
    if (!track.title) problems.push(`Track ${index + 1} needs a title.`)
    if (!ISRC_PATTERN.test(track.isrc || '')) problems.push(`Track ${index + 1} needs a valid 12-character ISRC.`)
  })
  const hasOfficialPlayback = Boolean(
    release.externalLinks?.spotify
      || release.externalLinks?.appleMusic
      || tracks.some((track) => track.externalLinks?.spotify)
  )
  if (!hasOfficialPlayback) problems.push('Add a Spotify or Apple Music link for official playback.')
  return problems
}

function validateForApproval(release = {}, tracks = []) {
  const problems = validateForSubmission(release, tracks)
  const attestation = release.rightsAttestation || {}
  if (
    attestation.accepted !== true
    || attestation.acceptedBy !== release.artistUid
    || attestation.version !== 'music-submission-v1'
    || !attestation.acceptedAt
  ) {
    problems.push('A valid, current rights attestation is required before publication.')
  }
  return problems
}

function identifierClaimId(type = '', value = '') {
  return `${cleanString(type, 20).toLowerCase()}_${cleanString(value, 40).replace(/[^A-Za-z0-9]/g, '').toUpperCase()}`
}

function assertTrackDocumentIds(tracks = [], existingTracks = []) {
  const existingIds = new Set(existingTracks.map((snap) => snap.id))
  const suppliedIds = new Set()
  tracks.forEach((track) => {
    if (!track.trackId) return
    if (!existingIds.has(track.trackId)) {
      throw new HttpsError('permission-denied', 'A track ID does not belong to this release.')
    }
    if (suppliedIds.has(track.trackId)) {
      throw new HttpsError('invalid-argument', 'A track ID cannot be used more than once in the same release.')
    }
    suppliedIds.add(track.trackId)
  })
}

function sameTimestamp(left, right) {
  if (!left && !right) return true
  if (!left || !right) return false
  if (typeof left.isEqual === 'function') return left.isEqual(right)
  return Number(left.seconds) === Number(right.seconds)
    && Number(left.nanoseconds) === Number(right.nanoseconds)
}

async function writeAccountEventSafely(uid = '', event = {}) {
  try {
    await writeAccountEvent(db(), uid, event)
  } catch (error) {
    logger.error('[music-distribution] account event write failed after the primary operation completed', {
      uid,
      type: event.type || '',
      message: error?.message || String(error)
    })
  }
}

async function releaseTracks(releaseId = '') {
  const snapshot = await db().collection('musicTracks').where('releaseId', '==', releaseId).get()
  return snapshot.docs
}

function serializeRelease(snapOrData = {}, explicitId = '') {
  const raw = typeof snapOrData.data === 'function' ? snapOrData.data() || {} : snapOrData || {}
  return {
    ...raw,
    id: explicitId || snapOrData.id || raw.releaseId || '',
    releaseId: explicitId || snapOrData.id || raw.releaseId || '',
    releaseDate: serializeDate(raw.releaseDate),
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt),
    submittedAt: serializeDate(raw.submittedAt),
    reviewedAt: serializeDate(raw.reviewedAt),
    publishedAt: serializeDate(raw.publishedAt),
    rightsAttestation: raw.rightsAttestation
      ? { ...raw.rightsAttestation, acceptedAt: serializeDate(raw.rightsAttestation.acceptedAt) }
      : null
  }
}

function serializeTrack(snapOrData = {}, explicitId = '') {
  const raw = typeof snapOrData.data === 'function' ? snapOrData.data() || {} : snapOrData || {}
  return {
    ...raw,
    id: explicitId || snapOrData.id || raw.trackId || '',
    trackId: explicitId || snapOrData.id || raw.trackId || '',
    createdAt: serializeDate(raw.createdAt),
    updatedAt: serializeDate(raw.updatedAt)
  }
}

const saveMusicReleaseDraft = onCall(CALLABLE_OPTIONS, async (request) => {
  const requester = assertSignedIn(request)
  const requestedId = cleanString(request.data?.releaseId || '', 180)
  const releaseRef = requestedId
    ? db().collection('musicReleases').doc(cleanId(requestedId, 'Release ID'))
    : db().collection('musicReleases').doc()
  const existingSnap = await releaseRef.get()
  const existing = existingSnap.exists ? existingSnap.data() || {} : {}
  if (existingSnap.exists && existing.artistUid !== requester.uid) {
    throw new HttpsError('permission-denied', 'You do not own this release.')
  }
  if (existingSnap.exists && !EDITABLE_STATUSES.has(existing.status || 'draft')) {
    throw new HttpsError('failed-precondition', 'Submitted releases are locked until an administrator completes review.')
  }

  const { artistName } = await loadArtistIdentity(requester.uid, requester.displayName)
  const releaseInput = {
    ...existing,
    ...(request.data?.release || {})
  }
  const normalized = normalizeReleaseInput(releaseInput, {
    uid: requester.uid,
    releaseId: releaseRef.id,
    artistName,
    status: 'draft'
  })
  const submittedTracks = Array.isArray(request.data?.tracks) ? request.data.tracks : []
  if (submittedTracks.length > 50) {
    throw new HttpsError('invalid-argument', 'A release can contain no more than 50 tracks.')
  }
  const rawTracks = submittedTracks.slice(0, 50)
  const tracks = rawTracks.map((track, index) => normalizeTrack(track, index, {
    releaseId: releaseRef.id,
    uid: requester.uid,
    artistName,
    status: 'draft'
  }))

  const existingTracks = await releaseTracks(releaseRef.id)
  assertTrackDocumentIds(tracks, existingTracks)
  await assertUniqueIdentifiers({ releaseId: releaseRef.id, upc: normalized.upc, tracks })
  const batch = db().batch()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const trackIds = []
  tracks.forEach((track) => {
    const trackRef = track.trackId
      ? db().collection('musicTracks').doc(cleanId(track.trackId, 'Track ID'))
      : db().collection('musicTracks').doc()
    trackIds.push(trackRef.id)
    batch.set(trackRef, {
      ...track,
      trackId: trackRef.id,
      releaseId: releaseRef.id,
      createdAt: existingTracks.find((snap) => snap.id === trackRef.id)?.data()?.createdAt || now,
      updatedAt: now
    }, { merge: false })
  })
  existingTracks.forEach((trackSnap) => {
    if (!trackIds.includes(trackSnap.id)) batch.delete(trackSnap.ref)
  })
  batch.set(releaseRef, {
    ...normalized,
    releaseId: releaseRef.id,
    trackIds,
    status: 'draft',
    visibility: 'private',
    reviewReason: '',
    identifierClaimIds: Array.isArray(existing.identifierClaimIds) ? existing.identifierClaimIds : [],
    rightsAttestation: null,
    createdAt: existing.createdAt || now,
    updatedAt: now
  }, { merge: false })
  await batch.commit()
  return {
    ok: true,
    releaseId: releaseRef.id,
    status: 'draft',
    release: serializeRelease({ ...normalized, releaseId: releaseRef.id, trackIds }, releaseRef.id),
    tracks: tracks.map((track, index) => serializeTrack({ ...track, trackId: trackIds[index] }, trackIds[index]))
  }
})

const listMyMusicReleases = onCall(CALLABLE_OPTIONS, async (request) => {
  const requester = assertSignedIn(request)
  const releaseSnapshot = await db().collection('musicReleases').where('artistUid', '==', requester.uid).limit(100).get()
  const releases = []
  for (const releaseSnap of releaseSnapshot.docs) {
    const tracks = await releaseTracks(releaseSnap.id)
    releases.push({
      ...serializeRelease(releaseSnap),
      tracks: tracks.map(serializeTrack).sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber))
    })
  }
  releases.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0) - new Date(a.updatedAt || a.createdAt || 0))
  return { ok: true, releases }
})

const submitMusicRelease = onCall(CALLABLE_OPTIONS, async (request) => {
  const requester = assertSignedIn(request)
  const releaseId = cleanId(request.data?.releaseId || '', 'Release ID')
  if (request.data?.rightsAccepted !== true) {
    throw new HttpsError('failed-precondition', 'Confirm that you control the necessary release rights.')
  }
  const releaseRef = db().collection('musicReleases').doc(releaseId)
  const initialReleaseSnap = await releaseRef.get()
  if (!initialReleaseSnap.exists) throw new HttpsError('not-found', 'Release draft not found.')
  const initialRelease = initialReleaseSnap.data() || {}
  if (initialRelease.artistUid !== requester.uid) throw new HttpsError('permission-denied', 'You do not own this release.')
  if (!EDITABLE_STATUSES.has(initialRelease.status || 'draft')) {
    throw new HttpsError('failed-precondition', 'This release has already been submitted.')
  }
  const initialTrackDocs = await releaseTracks(releaseId)
  const initialTracks = initialTrackDocs.map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
  const problems = validateForSubmission(initialRelease, initialTracks)
  if (problems.length) {
    throw new HttpsError('failed-precondition', problems.join(' '), { problems })
  }
  await assertUniqueIdentifiers({ releaseId, upc: initialRelease.upc, tracks: initialTracks })
  const trustedArtwork = await loadTrustedArtwork(initialRelease)

  const initialUpdatedAt = initialRelease.updatedAt || null
  const candidateTrackRefs = initialTrackDocs.map((trackSnap) => trackSnap.ref)
  let submittedRelease = initialRelease
  await db().runTransaction(async (transaction) => {
    const currentReleaseSnap = await transaction.get(releaseRef)
    if (!currentReleaseSnap.exists) throw new HttpsError('not-found', 'Release draft not found.')
    const release = currentReleaseSnap.data() || {}
    if (release.artistUid !== requester.uid) throw new HttpsError('permission-denied', 'You do not own this release.')
    if (!EDITABLE_STATUSES.has(release.status || 'draft')) {
      throw new HttpsError('failed-precondition', 'This release has already been submitted.')
    }
    if (!sameTimestamp(release.updatedAt || null, initialUpdatedAt)) {
      throw new HttpsError('aborted', 'The draft changed while it was being submitted. Review it and try again.')
    }

    const trackSnapshots = await Promise.all(candidateTrackRefs.map((ref) => transaction.get(ref)))
    const candidateIds = trackSnapshots.map((snap) => snap.id).sort()
    const currentIds = Array.isArray(release.trackIds)
      ? release.trackIds.map((id) => cleanString(id, 180)).filter(Boolean).sort()
      : candidateIds
    if (
      currentIds.length !== candidateIds.length
      || currentIds.some((id, index) => id !== candidateIds[index])
      || trackSnapshots.some((snap) => !snap.exists)
    ) {
      throw new HttpsError('aborted', 'The track list changed while it was being submitted. Review it and try again.')
    }
    const tracks = trackSnapshots.map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
    if (tracks.some((track) => track.releaseId !== releaseId || track.artistUid !== requester.uid)) {
      throw new HttpsError('permission-denied', 'A track does not belong to this release.')
    }
    const currentProblems = validateForSubmission(release, tracks)
    if (currentProblems.length) {
      throw new HttpsError('failed-precondition', currentProblems.join(' '), { problems: currentProblems })
    }

    const nextClaims = [
      { type: 'upc', value: release.upc },
      ...tracks.map((track) => ({ type: 'isrc', value: track.isrc }))
    ].filter((claim) => claim.value).map((claim) => ({
      ...claim,
      id: identifierClaimId(claim.type, claim.value),
      ref: db().collection('musicIdentifierClaims').doc(identifierClaimId(claim.type, claim.value))
    }))
    const previousClaimIds = Array.isArray(release.identifierClaimIds)
      ? release.identifierClaimIds.map((id) => cleanString(id, 80)).filter(Boolean)
      : []
    const allClaimRefs = new Map()
    nextClaims.forEach((claim) => allClaimRefs.set(claim.id, claim.ref))
    previousClaimIds.forEach((id) => allClaimRefs.set(id, db().collection('musicIdentifierClaims').doc(id)))
    const claimSnapshots = await Promise.all(Array.from(allClaimRefs.values()).map((ref) => transaction.get(ref)))
    const claimsById = new Map(claimSnapshots.map((snap) => [snap.id, snap]))
    nextClaims.forEach((claim) => {
      const existingClaim = claimsById.get(claim.id)
      if (existingClaim?.exists && existingClaim.data()?.releaseId !== releaseId) {
        throw new HttpsError('already-exists', `${claim.type.toUpperCase()} ${claim.value} is already claimed by another release.`)
      }
    })
    const now = admin.firestore.FieldValue.serverTimestamp()
    nextClaims.forEach((claim) => transaction.set(claim.ref, {
      claimId: claim.id,
      type: claim.type,
      value: claim.value,
      releaseId,
      artistUid: requester.uid,
      claimedAt: now,
      updatedAt: now
    }, { merge: true }))
    previousClaimIds.forEach((claimId) => {
      if (nextClaims.some((claim) => claim.id === claimId)) return
      const oldClaim = claimsById.get(claimId)
      if (oldClaim?.exists && oldClaim.data()?.releaseId === releaseId) transaction.delete(oldClaim.ref)
    })
    transaction.set(releaseRef, {
      status: 'submitted',
      visibility: 'private',
      submittedAt: now,
      submittedBy: requester.uid,
      reviewedAt: null,
      reviewedBy: '',
      reviewReason: '',
      identifierClaimIds: nextClaims.map((claim) => claim.id),
      coverArtURL: trustedArtwork.url,
      rightsAttestation: {
        accepted: true,
        acceptedBy: requester.uid,
        acceptedAt: now,
        version: 'music-submission-v1'
      },
      updatedAt: now
    }, { merge: true })
    trackSnapshots.forEach((trackSnap) => transaction.set(trackSnap.ref, {
      status: 'submitted',
      visibility: 'private',
      updatedAt: now
    }, { merge: true }))
    submittedRelease = release
  })
  await writeAccountEventSafely(requester.uid, {
    type: 'music_release_submitted',
    severity: 'info',
    title: 'Music release submitted',
    message: `${submittedRelease.title || 'Your release'} was submitted for Melogic Streaming review.`,
    source: 'music-distribution',
    path: '/distribution',
    metadata: { releaseId }
  })
  return { ok: true, releaseId, status: 'submitted' }
})

const listMusicReleaseReviewQueue = onCall(CALLABLE_OPTIONS, async (request) => {
  const reviewer = await requireAdminActionSecurity(request, 'productReview')
  const snapshot = await db().collection('musicReleases')
    .where('status', '==', 'submitted')
    .limit(Math.max(1, Math.min(100, Number(request.data?.limit || 60) || 60)))
    .get()
  const releases = []
  for (const releaseSnap of snapshot.docs) {
    const tracks = await releaseTracks(releaseSnap.id)
    releases.push({
      ...serializeRelease(releaseSnap),
      tracks: tracks.map(serializeTrack).sort((a, b) => (a.discNumber - b.discNumber) || (a.trackNumber - b.trackNumber))
    })
  }
  releases.sort((a, b) => new Date(b.submittedAt || b.updatedAt || 0) - new Date(a.submittedAt || a.updatedAt || 0))
  return { ok: true, releases, requester: { uid: reviewer.uid, role: reviewer.adminRole } }
})

const reviewMusicRelease = onCall(CALLABLE_OPTIONS, async (request) => {
  const reviewer = await requireAdminActionSecurity(request, 'productReview')
  const releaseId = cleanId(request.data?.releaseId || '', 'Release ID')
  const decision = cleanString(request.data?.decision || '', 40)
  const reason = cleanString(request.data?.reason || '', 1200)
  if (!['approve', 'reject'].includes(decision)) throw new HttpsError('invalid-argument', 'Review decision is invalid.')
  if (decision === 'reject' && !reason) throw new HttpsError('invalid-argument', 'A rejection reason is required.')
  const releaseRef = db().collection('musicReleases').doc(releaseId)
  const initialReleaseSnap = await releaseRef.get()
  if (!initialReleaseSnap.exists) throw new HttpsError('not-found', 'Release not found.')
  const initialRelease = initialReleaseSnap.data() || {}
  if (initialRelease.status !== 'submitted') throw new HttpsError('failed-precondition', 'Only submitted releases can be reviewed.')
  const initialTrackDocs = await releaseTracks(releaseId)
  const trustedArtwork = decision === 'approve' ? await loadTrustedArtwork(initialRelease) : null
  const candidateTrackRefs = initialTrackDocs.map((trackSnap) => trackSnap.ref)
  const nextStatus = decision === 'approve' ? 'published' : 'rejected'
  const nextVisibility = decision === 'approve' ? 'public' : 'private'
  let reviewedRelease = initialRelease
  let reviewedTrackCount = initialTrackDocs.length
  await db().runTransaction(async (transaction) => {
    const releaseSnap = await transaction.get(releaseRef)
    if (!releaseSnap.exists) throw new HttpsError('not-found', 'Release not found.')
    const release = releaseSnap.data() || {}
    if (release.status !== 'submitted') {
      throw new HttpsError('failed-precondition', 'Another administrator already completed this review.')
    }
    const trackSnapshots = await Promise.all(candidateTrackRefs.map((ref) => transaction.get(ref)))
    const candidateIds = trackSnapshots.map((snap) => snap.id).sort()
    const currentIds = Array.isArray(release.trackIds)
      ? release.trackIds.map((id) => cleanString(id, 180)).filter(Boolean).sort()
      : candidateIds
    if (
      currentIds.length !== candidateIds.length
      || currentIds.some((id, index) => id !== candidateIds[index])
      || trackSnapshots.some((snap) => !snap.exists)
    ) {
      throw new HttpsError('failed-precondition', 'The submitted track list is incomplete. Return the release to the artist.')
    }
    const tracks = trackSnapshots.map((snap) => ({ id: snap.id, ...(snap.data() || {}) }))
    if (tracks.some((track) => track.releaseId !== releaseId || track.artistUid !== release.artistUid)) {
      throw new HttpsError('failed-precondition', 'The submitted track ownership data is inconsistent.')
    }
    if (decision === 'approve') {
      const problems = validateForApproval(release, tracks)
      if (problems.length) throw new HttpsError('failed-precondition', problems.join(' '), { problems })
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    transaction.set(releaseRef, {
      status: nextStatus,
      visibility: nextVisibility,
      reviewedAt: now,
      reviewedBy: reviewer.uid,
      reviewReason: reason,
      approvedAt: decision === 'approve' ? now : null,
      publishedAt: decision === 'approve' ? now : null,
      ...(trustedArtwork ? { coverArtURL: trustedArtwork.url } : {}),
      updatedAt: now
    }, { merge: true })
    trackSnapshots.forEach((trackSnap) => transaction.set(trackSnap.ref, {
      status: nextStatus,
      visibility: nextVisibility,
      reviewedAt: now,
      reviewedBy: reviewer.uid,
      updatedAt: now
    }, { merge: true }))
    reviewedRelease = release
    reviewedTrackCount = trackSnapshots.length
  })

  let auditLogId = ''
  try {
    auditLogId = await writeAdminAuditLog({
      actorUid: reviewer.uid,
      actorEmail: reviewer.email,
      actorRole: reviewer.adminRole,
      action: `music_release_${decision}`,
      targetType: 'music_release',
      targetId: releaseId,
      targetPath: `musicReleases/${releaseId}`,
      reason,
      before: { status: reviewedRelease.status, visibility: reviewedRelease.visibility, title: reviewedRelease.title },
      after: { status: nextStatus, visibility: nextVisibility, title: reviewedRelease.title },
      metadata: { trackCount: reviewedTrackCount, sourceDistributor: reviewedRelease.sourceDistributor || '' }
    })
  } catch (error) {
    logger.error('[music-distribution] audit log write failed after review state committed', {
      releaseId,
      decision,
      reviewerUid: reviewer.uid,
      message: error?.message || String(error)
    })
  }
  await writeAccountEventSafely(reviewedRelease.artistUid, {
    type: decision === 'approve' ? 'music_release_approved' : 'music_release_rejected',
    severity: decision === 'approve' ? 'success' : 'warning',
    title: decision === 'approve' ? 'Music release published' : 'Music release needs attention',
    message: decision === 'approve'
      ? `${reviewedRelease.title || 'Your release'} is now available in Melogic Streaming.`
      : `${reviewedRelease.title || 'Your release'} was returned: ${reason}`,
    actorUid: reviewer.uid,
    actorType: 'admin',
    source: 'music-distribution',
    path: decision === 'approve' ? `/streaming/releases/${releaseId}` : '/distribution',
    metadata: { releaseId, decision, reason }
  })
  return { ok: true, releaseId, decision, status: nextStatus, visibility: nextVisibility, auditLogId }
})

module.exports = {
  saveMusicReleaseDraft,
  listMyMusicReleases,
  submitMusicRelease,
  listMusicReleaseReviewQueue,
  reviewMusicRelease,
  __test: {
    normalizeExternalUrl,
    normalizeUpc,
    normalizeIsrc,
    normalizeDate,
    normalizeTrack,
    normalizeReleaseInput,
    validateForSubmission,
    validateForApproval,
    assertTrackDocumentIds,
    validateArtworkMetadata,
    sameTimestamp,
    identifierClaimId
  }
}
