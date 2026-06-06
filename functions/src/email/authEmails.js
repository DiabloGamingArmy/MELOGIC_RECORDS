const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('node:crypto')
const { EMAIL_SECRETS, renderEmailTemplate, sendEmail, validateEmailAddress } = require('./emailSender')
const { writeEmailLog } = require('./emailLog')
const { writeAccountEvent } = require('../account/accountEvents')

const GENERIC_RESET_MESSAGE = 'If an account exists for that email, we sent a password reset link.'
const RESET_LIMIT_MS = 10 * 60 * 1000
const VERIFY_LIMIT_MS = 5 * 60 * 1000

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function hashKey(value = '') {
  return crypto.createHash('sha256').update(String(value || '').toLowerCase()).digest('hex')
}

function clientIp(request = {}) {
  return cleanString(request.rawRequest?.ip || request.rawRequest?.headers?.['x-forwarded-for'] || '', 120).split(',')[0].trim()
}

async function rateLimit(key = '', limitMs = RESET_LIMIT_MS) {
  const db = admin.firestore()
  const ref = db.collection('emailRateLimits').doc(key)
  const now = Date.now()
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const last = snap.exists ? Number(snap.data()?.lastRequestedAtMs || 0) : 0
    if (last && now - last < limitMs) {
      throw new HttpsError('resource-exhausted', 'Please wait before requesting another email.')
    }
    tx.set(ref, {
      key,
      lastRequestedAtMs: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
  })
}

function actionCodeSettings(path = '/auth') {
  return {
    url: `https://melogicrecords.studio${path}`,
    handleCodeInApp: false
  }
}

const requestPasswordResetEmail = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const email = validateEmailAddress(request.data?.email || '')
  if (!email) throw new HttpsError('invalid-argument', 'A valid email address is required.')

  const ipHash = hashKey(clientIp(request) || 'unknown-ip')
  const emailHash = hashKey(email)
  try {
    await rateLimit(`password_reset_${emailHash}_${ipHash}`, RESET_LIMIT_MS)
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'resource-exhausted') {
      return { ok: true, message: GENERIC_RESET_MESSAGE }
    }
    throw error
  }

  let link = ''
  let userRecord = null
  try {
    userRecord = await admin.auth().getUserByEmail(email)
    link = await admin.auth().generatePasswordResetLink(email, actionCodeSettings('/auth'))
  } catch (error) {
    if (error?.code !== 'auth/user-not-found') {
      console.warn('[requestPasswordResetEmail] link generation failed', { code: error?.code || '', recipientDomain: email.split('@')[1] || '' })
    }
    return { ok: true, message: GENERIC_RESET_MESSAGE }
  }

  const template = renderEmailTemplate('password_reset', { actionLink: link })
  try {
    const result = await sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      category: 'password_reset',
      metadata: { template: 'password_reset' }
    })
    await writeEmailLog({
      to: email,
      subject: template.subject,
      category: 'password_reset',
      provider: result.provider || 'smtp',
      providerMessageId: result.providerMessageId || '',
      status: 'sent',
      metadata: { template: 'password_reset' }
    })
    if (userRecord?.uid) {
      await writeAccountEvent(admin.firestore(), userRecord.uid, {
        type: 'password_reset_requested',
        severity: 'info',
        title: 'Password reset requested',
        message: 'A password reset email was requested for your account.',
        actorUid: userRecord.uid,
        actorType: 'user',
        source: 'auth-email',
        path: '/account/security',
        emailSent: true,
        emailSentAt: new Date().toISOString(),
        metadata: { provider: 'support_smtp' }
      }).catch(() => {})
    }
  } catch (error) {
    await writeEmailLog({
      to: email,
      subject: template.subject,
      category: 'password_reset',
      provider: 'smtp',
      status: 'failed',
      error,
      metadata: { template: 'password_reset' }
    }).catch(() => {})
    if (userRecord?.uid) {
      await writeAccountEvent(admin.firestore(), userRecord.uid, {
        type: 'password_reset_requested',
        severity: 'warning',
        title: 'Password reset requested',
        message: 'A password reset email was requested but could not be sent.',
        actorUid: userRecord.uid,
        actorType: 'user',
        source: 'auth-email',
        path: '/account/security',
        emailSent: false,
        emailError: cleanString(error?.code || error?.message || 'email-send-failed', 240),
        metadata: { provider: 'support_smtp' }
      }).catch(() => {})
    }
    throw new HttpsError('failed-precondition', 'Password reset email could not be sent right now.')
  }

  return { ok: true, message: GENERIC_RESET_MESSAGE }
})

const requestEmailVerification = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const uid = cleanString(request.auth?.uid || '', 180)
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  await rateLimit(`email_verification_${uid}`, VERIFY_LIMIT_MS)

  const user = await admin.auth().getUser(uid)
  const email = validateEmailAddress(user.email || '')
  if (!email) throw new HttpsError('failed-precondition', 'This account does not have a valid email address.')
  if (user.emailVerified) return { ok: true, message: 'Your email is already verified.' }

  const link = await admin.auth().generateEmailVerificationLink(email, actionCodeSettings('/auth'))
  const template = renderEmailTemplate('email_verification', { actionLink: link })
  try {
    const result = await sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      category: 'email_verification',
      metadata: { template: 'email_verification' }
    })
    await writeEmailLog({
      to: email,
      subject: template.subject,
      category: 'email_verification',
      relatedUid: uid,
      provider: result.provider || 'smtp',
      providerMessageId: result.providerMessageId || '',
      status: 'sent',
      metadata: { template: 'email_verification' }
    })
    await writeAccountEvent(admin.firestore(), uid, {
      type: 'email_verification_requested',
      severity: 'info',
      title: 'Verification email sent',
      message: 'A verification email was sent for your account.',
      actorUid: uid,
      actorType: 'user',
      source: 'account-security',
      path: '/account/security',
      emailSent: true,
      emailSentAt: new Date().toISOString(),
      metadata: { category: 'email_verification' }
    })
  } catch (error) {
    await writeEmailLog({
      to: email,
      subject: template.subject,
      category: 'email_verification',
      relatedUid: uid,
      provider: 'smtp',
      status: 'failed',
      error,
      metadata: { template: 'email_verification' }
    }).catch(() => {})
    throw new HttpsError('failed-precondition', 'Verification email could not be sent right now.')
  }

  return { ok: true, message: 'Verification email sent.' }
})

module.exports = {
  requestEmailVerification,
  requestPasswordResetEmail
}
