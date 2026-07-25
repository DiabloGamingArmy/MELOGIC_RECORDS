const test = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'melogic-test' })
}

const { __test } = require('../src/email/authEmails')

test('verification delivery falls back only for email-provider failures', () => {
  for (const code of [
    'email-provider-not-configured',
    'smtp-auth-failed',
    'smtp-timeout',
    'smtp-connection-failed',
    'smtp-recipient-rejected',
    'smtp-send-failed'
  ]) {
    assert.equal(
      __test.shouldUseFirebaseAuthVerificationFallback({ code }, 'email send'),
      true,
      `${code} should request Firebase Auth delivery`
    )
  }

  assert.equal(
    __test.shouldUseFirebaseAuthVerificationFallback({ code: 'smtp-auth-failed' }, 'user lookup'),
    false
  )
  assert.equal(
    __test.shouldUseFirebaseAuthVerificationFallback({ code: 'resource-exhausted' }, 'rate limit check'),
    false
  )
  assert.equal(
    __test.shouldUseFirebaseAuthVerificationFallback({ code: 'auth/user-not-found' }, 'user lookup'),
    false
  )
})
