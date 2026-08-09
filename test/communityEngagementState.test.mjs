import assert from 'node:assert/strict'
import test from 'node:test'
import engagementState from '../functions/src/community/communityEngagementState.js'

const { canonicalCounter, desiredToggleState, reactionTransition } = engagementState

test('flat Community counters are authoritative over stale nested mirrors', () => {
  assert.equal(canonicalCounter({ likeCount: 8, counts: { likes: 7 } }, 'likeCount', 'likes'), 8)
  assert.equal(canonicalCounter({ counts: { likes: 7 } }, 'likeCount', 'likes'), 7)
  assert.equal(canonicalCounter({ likeCount: -5, counts: { likes: 7 } }, 'likeCount', 'likes'), 0)
})

test('desired toggle states are idempotent while legacy requests still toggle', () => {
  assert.equal(desiredToggleState(true, true), true)
  assert.equal(desiredToggleState(false, false), false)
  assert.equal(desiredToggleState(true), false)
  assert.equal(desiredToggleState(false), true)
})

test('repeating an explicit post reaction does not reverse it', () => {
  assert.deepEqual(reactionTransition({
    likeExists: true,
    requestedReaction: 'like',
    requestedActive: true
  }), {
    reaction: 'like',
    liked: true,
    disliked: false,
    likeDelta: 0,
    dislikeDelta: 0
  })
})

test('switching reactions updates each counter exactly once', () => {
  assert.deepEqual(reactionTransition({
    dislikeExists: true,
    requestedReaction: 'like',
    requestedActive: true
  }), {
    reaction: 'like',
    liked: true,
    disliked: false,
    likeDelta: 1,
    dislikeDelta: -1
  })
})

test('a corrupt dual-reaction state is repaired to one reaction', () => {
  assert.deepEqual(reactionTransition({
    likeExists: true,
    dislikeExists: true,
    requestedReaction: 'like',
    requestedActive: true
  }), {
    reaction: 'like',
    liked: true,
    disliked: false,
    likeDelta: 0,
    dislikeDelta: -1
  })
})

test('explicit removal removes only the requested reaction', () => {
  assert.deepEqual(reactionTransition({
    likeExists: true,
    requestedReaction: 'like',
    requestedActive: false
  }), {
    reaction: null,
    liked: false,
    disliked: false,
    likeDelta: -1,
    dislikeDelta: 0
  })
})
