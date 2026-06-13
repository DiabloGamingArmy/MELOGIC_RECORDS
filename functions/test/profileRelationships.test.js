const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) admin.initializeApp({ projectId: 'melogic-profile-test' })

const { followNotificationsEnabled } = require('../src/profiles/profileRelationships')

assert.equal(followNotificationsEnabled({}), true, 'Follow notifications should default to enabled.')
assert.equal(followNotificationsEnabled({
  settings: { notificationPreferences: { content: { follows: false } } }
}), false, 'The content.follows preference should disable follow notifications.')
assert.equal(followNotificationsEnabled({
  settings: { notificationPreferences: { delivery: { inApp: false } } }
}), false, 'The global in-app preference should disable follow notifications.')
assert.equal(followNotificationsEnabled({
  settings: { notificationPreferences: { content: { follows: true }, delivery: { inApp: true } } }
}), true, 'Explicitly enabled follow notifications should remain enabled.')

console.log('profileRelationships tests passed')
