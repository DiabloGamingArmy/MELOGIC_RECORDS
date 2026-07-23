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
  const problems = __test.validateForSubmission({ ...complete, upc: '', coverArtPath: '', externalLinks: {} }, [])
  assert.ok(problems.some((problem) => /UPC/.test(problem)))
  assert.ok(problems.some((problem) => /artwork/.test(problem)))
  assert.ok(problems.some((problem) => /at least one track/.test(problem)))
  assert.ok(problems.some((problem) => /Spotify or Apple Music/.test(problem)))
})
