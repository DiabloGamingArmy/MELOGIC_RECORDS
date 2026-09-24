import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import test from 'node:test'

const [community, runtime] = await Promise.all([
  fs.readFile(new URL('../src/community.js', import.meta.url), 'utf8'),
  fs.readFile(new URL('../src/pwa/mobileAppRuntime.js', import.meta.url), 'utf8')
])

test('post-detail Back restores the exact feed snapshot before generic mobile surface routing', () => {
  const start = community.indexOf('function handleCommunityPopstate()')
  const end = community.indexOf('\nasync function bootstrapCommunityDocument()', start)
  assert.ok(start >= 0 && end > start)

  const handler = community.slice(start, end)
  const snapshotRestore = handler.indexOf('restoreFeedNavigationSnapshot()')
  const mobileSurfaceRouter = handler.indexOf('if (isMobileSpaRuntime() && !state.detailPostId)')

  assert.ok(snapshotRestore >= 0, 'feed snapshot restoration must remain in popstate handling')
  assert.ok(mobileSurfaceRouter >= 0, 'mobile surface routing must remain in popstate handling')
  assert.ok(
    snapshotRestore < mobileSurfaceRouter,
    'post-detail snapshot restoration must run before For You / Following / Discover restoration'
  )
  assert.equal(
    (handler.match(/restoreFeedNavigationSnapshot\(\)/g) || []).length,
    1,
    'popstate should have one authoritative post-return restoration point'
  )
})

test('the global mobile runtime leaves same-view Community popstate to the Community router', () => {
  const start = runtime.indexOf('async function handleRuntimePopstate()')
  const end = runtime.indexOf('\nexport function initCommunityInboxRuntimeBridge()', start)
  assert.ok(start >= 0 && end > start)

  const handler = runtime.slice(start, end)
  const communityOwnership = handler.indexOf("route.id === 'community' && activeViewId === 'community'")
  const globalReactivation = handler.indexOf('navigateMobileRuntimeUrl(location.href')

  assert.ok(communityOwnership >= 0, 'Community must explicitly own same-view popstate')
  assert.ok(globalReactivation >= 0, 'global runtime fallback path should still exist')
  assert.ok(
    communityOwnership < globalReactivation,
    'Community same-view ownership must short-circuit before global runtime reactivation'
  )
})
