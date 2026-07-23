const test = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'melogic-test' })
}

const { __test } = require('../src/music/musicDistribution')

test('distribution identifiers are normalized for duplicate detection', () => {
  assert.equal(__test.normalizeUpc('123-456 789012'), '123456789012')
  assert.equal(__test.normalizeIsrc('us-abc-26-12345'), 'USABC2612345')
  assert.equal(__test.identifierClaimId('isrc', 'us-abc-26-12345'), 'isrc_USABC2612345')
})

test('release dates are strict and do not silently roll into another calendar day', () => {
  assert.equal(
    __test.normalizeDate('2026-07-23').toDate().toISOString(),
    '2026-07-23T12:00:00.000Z'
  )
  assert.throws(() => __test.normalizeDate('2026-02-31'), /invalid/)
  assert.throws(() => __test.normalizeDate('07/23/2026'), /YYYY-MM-DD/)
})

test('official playback URLs reject impersonating domains and insecure schemes', () => {
  assert.equal(
    __test.normalizeExternalUrl('https://open.spotify.com/track/1234567890123456789012?si=test', 'spotify'),
    'https://open.spotify.com/track/1234567890123456789012?si=test'
  )
  assert.throws(
    () => __test.normalizeExternalUrl('https://open.spotify.com.attacker.example/track/1234567890123456789012', 'spotify'),
    /approved spotify domain/
  )
  assert.throws(
    () => __test.normalizeExternalUrl('http://open.spotify.com/track/1234567890123456789012', 'spotify'),
    /must use HTTPS/
  )
})

test('submission validation requires artwork, identifiers, tracks, and official playback', () => {
  const complete = {
    title: 'Midnight Drive',
    artistName: 'Aetherrupt',
    upc: '123456789012',
    releaseDate: admin.firestore.Timestamp.fromDate(new Date('2026-07-20T12:00:00Z')),
    genre: 'Electronic',
    coverArtPath: 'users/artist/distribution/release/artwork/cover.jpg',
    copyrightLine: '℗ 2026 Aetherrupt',
    externalLinks: {
      spotify: 'https://open.spotify.com/album/1234567890123456789012'
    }
  }
  const tracks = [{
    title: 'Midnight Drive',
    isrc: 'USABC2612345',
    externalLinks: {
      spotify: 'https://open.spotify.com/track/1234567890123456789012'
    }
  }]
  assert.deepEqual(__test.validateForSubmission(complete, tracks), [])
  const problems = __test.validateForSubmission({
    ...complete,
    upc: '',
    coverArtPath: '',
    coverArtURL: 'https://example.com/unowned-cover.jpg',
    sourceDistributor: 'other',
    sourceDistributorLabel: '',
    externalLinks: {}
  }, [])
  assert.ok(problems.some((problem) => /UPC/.test(problem)))
  assert.ok(problems.some((problem) => /Upload cover artwork/.test(problem)))
  assert.ok(problems.some((problem) => /Distributor name/.test(problem)))
  assert.ok(problems.some((problem) => /at least one track/.test(problem)))
  assert.ok(problems.some((problem) => /Spotify or Apple Music/.test(problem)))
})

test('approval requires the artist-bound rights attestation created at submission', () => {
  const release = {
    title: 'Midnight Drive',
    artistUid: 'artist-1',
    artistName: 'Aetherrupt',
    sourceDistributor: 'distrokid',
    upc: '123456789012',
    releaseDate: admin.firestore.Timestamp.fromDate(new Date('2026-07-23T12:00:00Z')),
    genre: 'Electronic',
    coverArtPath: 'users/artist-1/distribution/release-1/artwork/cover.jpg',
    copyrightLine: '℗ 2026 Aetherrupt',
    externalLinks: {
      spotify: 'https://open.spotify.com/album/1234567890123456789012'
    }
  }
  const tracks = [{
    title: 'Midnight Drive',
    isrc: 'USABC2612345',
    externalLinks: {
      spotify: 'https://open.spotify.com/track/1234567890123456789012'
    }
  }]
  assert.ok(__test.validateForApproval(release, tracks).some((problem) => /rights attestation/.test(problem)))
  assert.deepEqual(__test.validateForApproval({
    ...release,
    rightsAttestation: {
      accepted: true,
      acceptedBy: 'artist-1',
      acceptedAt: admin.firestore.Timestamp.now(),
      version: 'music-submission-v1'
    }
  }, tracks), [])
})

test('draft saves reject foreign or duplicated track document IDs', () => {
  const existing = [{ id: 'track-1' }, { id: 'track-2' }]
  assert.doesNotThrow(() => __test.assertTrackDocumentIds([
    { trackId: 'track-1' },
    { trackId: 'track-2' }
  ], existing))
  assert.throws(
    () => __test.assertTrackDocumentIds([{ trackId: 'another-release-track' }], existing),
    /does not belong/
  )
  assert.throws(
    () => __test.assertTrackDocumentIds([{ trackId: 'track-1' }, { trackId: 'track-1' }], existing),
    /more than once/
  )
})

test('cover artwork metadata must be owned, release-scoped, and a supported image', () => {
  const validMetadata = {
    contentType: 'image/png',
    size: '2048',
    metadata: {
      ownerUid: 'artist-1',
      releaseId: 'release-1',
      assetRole: 'cover_art'
    }
  }
  assert.deepEqual(__test.validateArtworkMetadata(validMetadata, {
    uid: 'artist-1',
    releaseId: 'release-1'
  }), [])

  const problems = __test.validateArtworkMetadata({
    contentType: 'text/html',
    size: String(11 * 1024 * 1024),
    metadata: {
      ownerUid: 'another-artist',
      releaseId: 'another-release',
      assetRole: 'attachment'
    }
  }, {
    uid: 'artist-1',
    releaseId: 'release-1'
  })
  assert.ok(problems.some((problem) => /JPG, PNG, or WebP/.test(problem)))
  assert.ok(problems.some((problem) => /between 1 byte and 10 MB/.test(problem)))
  assert.ok(problems.some((problem) => /ownership metadata/.test(problem)))
})
