import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createCommunityAuthScope,
  createMonotonicRequestOwner,
  releaseOwnedOperation,
  restorePreservedCommunitySurface,
  suspendCommunityMediaResources
} from '../src/community/lifecycleState.js'

test('Community auth tokens become stale across A → B, B → anonymous, and anonymous → A', () => {
  const scope = createCommunityAuthScope('account-a')
  const accountA = scope.current()

  assert.equal(scope.transition('account-b').changed, true)
  assert.equal(scope.isCurrent(accountA), false)
  const accountB = scope.current()

  scope.transition(null)
  assert.equal(scope.isCurrent(accountB), false)
  const anonymous = scope.current()

  scope.transition('account-a')
  assert.equal(scope.isCurrent(anonymous), false)
  assert.deepEqual(scope.current(), { uid: 'account-a', epoch: 3 })
})

test('monotonic request ownership never rolls backward', () => {
  const owner = createMonotonicRequestOwner()
  const first = owner.next()
  const second = owner.next()
  assert.equal(owner.isCurrent(first), false)
  assert.equal(owner.isCurrent(second), true)
  owner.invalidate()
  assert.equal(owner.isCurrent(second), false)
})

test('50 preserved-surface restores do not multiply existing listeners', () => {
  const action = new EventTarget()
  let invocations = 0
  action.addEventListener('activate', () => { invocations += 1 })

  const root = {
    current: null,
    replaceChildren(fragment) { this.current = fragment }
  }
  let reconciliations = 0
  for (let index = 0; index < 50; index += 1) {
    assert.equal(restorePreservedCommunitySurface({
      root,
      fragment: { action },
      reconcile: () => { reconciliations += 1 }
    }), true)
  }

  root.current.action.dispatchEvent(new Event('activate'))
  assert.equal(reconciliations, 50)
  assert.equal(invocations, 1)
})

test('Story resource suspension aborts async work, cancels clocks, and releases playback', () => {
  const calls = []
  const controller = { abort: () => calls.push('abort') }
  const media = {
    pause: () => calls.push('pause'),
    removeAttribute: (name) => calls.push(`remove:${name}`),
    load: () => calls.push('load')
  }

  suspendCommunityMediaResources({
    media: [media],
    abortControllers: [controller],
    timeoutIds: [11, 12],
    animationFrameIds: [13],
    clearTimeoutFn: (id) => calls.push(`timeout:${id}`),
    cancelAnimationFrameFn: (id) => calls.push(`frame:${id}`)
  })

  assert.deepEqual(calls, [
    'abort', 'timeout:11', 'timeout:12', 'frame:13',
    'pause', 'remove:src', 'load'
  ])
})

test('a stale operation completion cannot remove the new account operation with the same key', () => {
  const operations = new Map()
  const oldEntry = { account: 'a' }
  const newEntry = { account: 'b' }
  operations.set('publish', oldEntry)
  operations.clear()
  operations.set('publish', newEntry)

  assert.equal(releaseOwnedOperation(operations, 'publish', oldEntry), false)
  assert.equal(operations.get('publish'), newEntry)
  assert.equal(releaseOwnedOperation(operations, 'publish', newEntry), true)
  assert.equal(operations.has('publish'), false)
})
