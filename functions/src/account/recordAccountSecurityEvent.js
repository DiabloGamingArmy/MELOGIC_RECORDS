const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { writeAccountEvent } = require('./accountEvents')
const { EMAIL_SECRETS } = require('../email/emailSender')
const { sendSecurityEmail } = require('../email/securityEmail')

const CLIENT_SECURITY_EVENTS = new Set([
  'new_login',
  'password_reset_requested',
  'password_reset_completed',
  'email_verification_requested',
  'email_verified',
  'auth_action_link_invalid',
  'auth_action_link_expired',
  'two_factor_enabled',
  'two_factor_disabled',
  'recovery_codes_generated'
])

const EMAIL_SECURITY_EVENTS = new Set(['new_login'])

const EVENT_COPY = {
  password_reset_requested: {
    severity: 'info',
    title: 'Password reset requested',
    message: 'A password reset email was requested for your account.'
  },
  password_reset_completed: {
    severity: 'success',
    title: 'Password reset completed',
    message: 'Your Melogic Records password was reset.'
  },
  email_verification_requested: {
    severity: 'info',
    title: 'Verification email requested',
    message: 'A verification email was requested for your account.'
  },
  email_verified: {
    severity: 'success',
    title: 'Email verified',
    message: 'Your account email was verified.'
  },
  auth_action_link_invalid: {
    severity: 'warning',
    title: 'Account action link unavailable',
    message: 'An account action link was invalid or already used.'
  },
  auth_action_link_expired: {
    severity: 'warning',
    title: 'Account action link expired',
    message: 'An account action link expired before it was used.'
  },
  two_factor_enabled: {
    severity: 'success',
    title: 'Two-factor authentication enabled',
    message: 'Authenticator-app two-factor authentication was enabled for your account.'
  },
  two_factor_disabled: {
    severity: 'warning',
    title: 'Two-factor authentication disabled',
    message: 'Authenticator-app two-factor authentication was disabled for your account.'
  },
  recovery_codes_generated: {
    severity: 'warning',
    title: 'Recovery codes generated',
    message: 'New account recovery codes were generated.'
  },
  new_login: {
    severity: 'warning',
    title: 'New sign-in to your Melogic Records account',
    message: 'A new device signed in to your account.'
  }
}

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function clientIp(request = {}) {
  return cleanString(request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || '', 120).split(',')[0].trim()
}

function userAgentSummary(request = {}) {
  return cleanString(request.rawRequest?.headers?.['user-agent'] || '', 180)
}

function hashDeviceId(uid = '', deviceId = '') {
  const crypto = require('node:crypto')
  return crypto.createHash('sha256').update(`${uid}:${deviceId}`).digest('hex').slice(0, 40)
}

const recordAccountSecurityEvent = onCall({ timeoutSeconds: 30, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')

  const type = cleanString(request.data?.type || '', 80)
  if (!CLIENT_SECURITY_EVENTS.has(type)) {
    throw new HttpsError('invalid-argument', 'Unsupported account security event.')
  }

  const copy = EVENT_COPY[type] || EVENT_COPY.password_reset_requested
  if (type === 'new_login') {
    const deviceId = cleanString(request.data?.deviceId || '', 180)
    if (!deviceId) throw new HttpsError('invalid-argument', 'Device id is required.')
    const browserSummary = cleanString(request.data?.browserSummary || userAgentSummary(request), 180)
    const deviceRef = admin.firestore().collection('users').doc(uid).collection('securityDevices').doc(hashDeviceId(uid, deviceId))
    const snap = await deviceRef.get()
    const now = admin.firestore.FieldValue.serverTimestamp()
    if (snap.exists) {
      await deviceRef.set({
        lastSeenAt: now,
        browserSummary,
        userAgentSummary: userAgentSummary(request)
      }, { merge: true })
      return { ok: true, eventId: '', emailSent: false, knownDevice: true }
    }
    const result = await sendSecurityEmail(uid, 'new_login', {
      severity: copy.severity,
      title: copy.title,
      message: copy.message,
      source: 'auth-signin',
      ip: clientIp(request),
      userAgentSummary: browserSummary || userAgentSummary(request),
      metadata: {
        browserSummary,
        deviceIdHash: deviceRef.id
      }
    })
    await deviceRef.set({
      deviceIdHash: deviceRef.id,
      browserSummary,
      userAgentSummary: userAgentSummary(request),
      createdAt: now,
      lastSeenAt: now,
      emailSentAt: result.emailSent ? now : null
    }, { merge: true })
    return {
      ok: true,
      eventId: result.eventId || '',
      emailSent: result.emailSent === true,
      emailSkipped: result.emailSkipped === true,
      emailSkipReason: result.emailSkipReason || '',
      emailError: result.emailError || '',
      knownDevice: false
    }
  }

  if (EMAIL_SECURITY_EVENTS.has(type)) {
    const result = await sendSecurityEmail(uid, type, {
      severity: copy.severity,
      title: copy.title,
      message: copy.message,
      source: 'account-security',
      ip: clientIp(request),
      userAgentSummary: userAgentSummary(request),
      metadata: {
        factorId: cleanString(request.data?.factorId || 'totp', 80),
        displayName: cleanString(request.data?.displayName || 'Authenticator app', 120)
      }
    })
    return {
      ok: true,
      eventId: result.eventId || '',
      emailSent: result.emailSent === true,
      emailSkipped: result.emailSkipped === true,
      emailSkipReason: result.emailSkipReason || '',
      emailError: result.emailError || ''
    }
  }

  const eventId = await writeAccountEvent(admin.firestore(), uid, {
    type,
    severity: copy.severity,
    title: copy.title,
    message: copy.message,
    actorUid: uid,
    actorType: 'user',
    source: 'account-security',
    path: cleanString(request.data?.path || '', 900),
    metadata: {
      provider: cleanString(request.data?.provider || 'firebase_auth', 80)
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
