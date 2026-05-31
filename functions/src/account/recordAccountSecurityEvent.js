const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { writeAccountEvent } = require('./accountEvents')

const LOW_RISK_EVENTS = new Set(['password_reset_requested'])

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

const recordAccountSecurityEvent = onCall({ timeoutSeconds: 30, memory: '256MiB' }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const type = cleanString(request.data?.type || '', 80)
  if (!LOW_RISK_EVENTS.has(type)) {
    throw new HttpsError('invalid-argument', 'Unsupported account security event.')
  }

  const eventId = await writeAccountEvent(admin.firestore(), uid, {
    type,
    severity: 'info',
    title: 'Password reset requested',
    message: 'A password reset email was requested for your account.',
    actorUid: uid,
    actorType: 'user',
    source: 'account-security',
    path: cleanString(request.data?.path || '', 900),
    metadata: {
      provider: 'firebase_auth_email'
    }
  })

  return {
    ok: true,
    eventId
  }
})

module.exports = {
  recordAccountSecurityEvent
}
