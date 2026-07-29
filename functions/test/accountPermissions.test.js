const assert = require('node:assert/strict')
const { test } = require('node:test')

const { resolveAccountPermissions } = require('../src/account/accountPermissions')

test('verified callable auth keeps default live chat and interaction permissions enabled', () => {
  const resolved = resolveAccountPermissions({
    user: {},
    profile: {},
    explicit: {},
    auth: {
      uid: 'verified-listener',
      token: { email_verified: true }
    }
  })

  assert.equal(resolved.emailVerified, true)
  assert.equal(resolved.permissions.musicLiveChat, true)
  assert.equal(resolved.permissions.communityReact, true)
})

test('live chat can remain enabled independently of community messaging', () => {
  const resolved = resolveAccountPermissions({
    user: { emailVerified: true },
    profile: {},
    explicit: {
      exists: true,
      permissions: {
        communityMessage: false,
        musicLiveChat: true
      }
    }
  })

  assert.equal(resolved.permissions.communityMessage, false)
  assert.equal(resolved.permissions.musicLiveChat, true)
})

test('suspended accounts still lose live chat and interaction permissions', () => {
  const resolved = resolveAccountPermissions({
    user: { emailVerified: true, suspended: true },
    profile: {},
    explicit: {}
  })

  assert.equal(resolved.permissions.musicLiveChat, false)
  assert.equal(resolved.permissions.communityReact, false)
})
