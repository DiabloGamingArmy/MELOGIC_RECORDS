const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp({ projectId: 'melogic-mutual-users-test' })

const { normalizeSuggestion, rankSuggestionCandidates } = require('../src/profiles/mutualUsers')

const ranked = rankSuggestionCandidates(new Map([
  ['user-b', { mutualFollowers: 1, sameCommunities: 0 }],
  ['user-a', { mutualFollowers: 2, sameCommunities: 0 }],
  ['user-c', { mutualFollowers: 0, sameCommunities: 2 }]
]), { limit: 2 })

assert.deepEqual(ranked.map((entry) => entry.uid), ['user-a', 'user-c'])

assert.deepEqual(normalizeSuggestion('user-a', {
  displayName: 'Artist A',
  username: 'artist_a',
  roleLabel: 'Producer'
}, {
  mutualFollowers: 2,
  sameCommunities: 1,
  score: 11
}), {
  uid: 'user-a',
  displayName: 'Artist A',
  username: 'artist_a',
  photoURL: '',
  roleLabel: 'Producer',
  reasonCodes: ['mutual_followers', 'same_community'],
  reasonLabels: ['2 mutual connections', 'Same community'],
  score: 11,
  alreadyFollowing: false,
  canMessage: true
})

console.log('mutualUsers tests passed')
