const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('node:crypto')
const { EMAIL_SECRETS, renderEmailTemplate, sendEmail, validateEmailAddress } = require('./emailSender')
const { writeEmailLog } = require('./emailLog')
const { writeAccountEvent } = require('../account/accountEvents')

const GENERIC_RESET_MESSAGE = 'If an account exists for that email, we sent a password reset link.'
const AUTH_ACTION_BASE_URL = 'https://melogicrecords.studio'
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

function recipientDomain(email = '') {
  return validateEmailAddress(email).split('@')[1] || ''
}

function serializeError(error = {}, stage = '', { includeStack = false } = {}) {
  const details = {
    stage: cleanString(stage, 120),
    name: cleanString(error?.name || '', 120),
    code: cleanString(error?.code || '', 160),
    message: cleanString(error?.message || '', 500),
    firebaseCode: cleanString(error?.errorInfo?.code || error?.code || '', 160)
  }
  if (includeStack) details.stack = cleanString(error?.stack || '', 2400)
  return details
}

function logStage(flow = '', stage = '', data = {}, level = 'info') {
  const payload = { stage, ...data }
  if (level === 'error') console.error(`[${flow}]`, payload)
  else if (level === 'warn') console.warn(`[${flow}]`, payload)
  else console.info(`[${flow}]`, payload)
}

function callableError(error = {}, stage = '', fallbackCode = 'failed-precondition', fallbackMessage = 'Email request could not be completed right now.') {
  if (error instanceof HttpsError) return error
  return new HttpsError(fallbackCode, fallbackMessage, {
    stage: cleanString(stage, 120),
    code: cleanString(error?.code || '', 160),
    firebaseCode: cleanString(error?.errorInfo?.code || error?.code || '', 160)
  })
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
  const cleanPath = String(path || '/auth').startsWith('/') ? path : `/${path}`
  return {
    url: `${AUTH_ACTION_BASE_URL}${cleanPath}`,
    handleCodeInApp: true
  }
}

function customAuthActionLink(firebaseLink = '', fallbackMode = '') {
  const parsed = new URL(firebaseLink)
  const output = new URL('/auth/action', AUTH_ACTION_BASE_URL)
  const mode = parsed.searchParams.get('mode') || fallbackMode
  const oobCode = parsed.searchParams.get('oobCode') || ''
  const continueUrl = parsed.searchParams.get('continueUrl') || `${AUTH_ACTION_BASE_URL}/account/security`
  const lang = parsed.searchParams.get('lang') || ''
  if (mode) output.searchParams.set('mode', mode)
  if (oobCode) output.searchParams.set('oobCode', oobCode)
  if (continueUrl) output.searchParams.set('continueUrl', continueUrl)
  if (lang) output.searchParams.set('lang', lang)
  return output.toString()
}

async function writeFailedEmailLog(flow = '', {
  stage = 'unknown',
  email = '',
  subject = '',
  category = '',
  relatedUid = '',
  error = null,
  metadata = {}
} = {}) {
  logStage(flow, 'failed email log write start', { failedStage: stage, recipientDomain: recipientDomain(email), category }, 'warn')
  try {
    await writeEmailLog({
      to: email,
      subject,
      category,
      relatedUid,
      provider: 'smtp',
      status: 'failed',
      error,
      metadata: {
        ...metadata,
        failedStage: stage,
        errorCode: cleanString(error?.code || '', 160)
      }
    })
    logStage(flow, 'failed email log write succeeded', { failedStage: stage, recipientDomain: recipientDomain(email), category })
  } catch (logError) {
    logStage(flow, 'failed email log write failed', serializeError(logError, 'failed email log write', { includeStack: true }), 'error')
  }
}

async function writePasswordResetFailureEvent(flow = '', userRecord = null, error = null, stage = '') {
  if (!userRecord?.uid) return
  try {
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
      metadata: { provider: 'support_smtp', failedStage: stage }
    })
  } catch (eventError) {
    logStage(flow, 'account security event write failed', serializeError(eventError, 'account security event write', { includeStack: true }), 'error')
  }
}

async function writeVerificationFailureEvent(flow = '', uid = '', error = null, stage = '') {
  if (!uid) return
  try {
    await writeAccountEvent(admin.firestore(), uid, {
      type: 'email_verification_requested',
      severity: 'warning',
      title: 'Verification email failed',
      message: 'A verification email was requested but could not be sent.',
      actorUid: uid,
      actorType: 'user',
      source: 'account-security',
      path: '/account/security',
      emailSent: false,
      emailError: cleanString(error?.code || error?.message || 'email-send-failed', 240),
      metadata: { category: 'email_verification', failedStage: stage }
    })
  } catch (eventError) {
    logStage(flow, 'account security event write failed', serializeError(eventError, 'account security event write', { includeStack: true }), 'error')
  }
}

const requestPasswordResetEmail = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const flow = 'requestPasswordResetEmail'
  let stage = 'callable entered'
  let email = ''
  let subject = ''
  let userRecord = null
  logStage(flow, stage, { hasAuth: Boolean(request.auth?.uid) })

  try {
    stage = 'payload validation'
    email = validateEmailAddress(request.data?.email || '')
    if (!email) throw new HttpsError('invalid-argument', 'A valid email address is required.')
    logStage(flow, 'payload validation passed', { recipientDomain: recipientDomain(email) })

    const ipHash = hashKey(clientIp(request) || 'unknown-ip')
    const emailHash = hashKey(email)
    stage = 'rate limit check'
    logStage(flow, 'rate limit check started', { recipientDomain: recipientDomain(email) })
    await rateLimit(`password_reset_${emailHash}_${ipHash}`, RESET_LIMIT_MS)
    logStage(flow, 'rate limit check passed', { recipientDomain: recipientDomain(email) })
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'resource-exhausted') {
      logStage(flow, 'rate limit check failed', { code: error.code, recipientDomain: recipientDomain(email) }, 'warn')
      return { ok: true, message: GENERIC_RESET_MESSAGE }
    }
    logStage(flow, `${stage} failed`, serializeError(error, stage, { includeStack: true }), 'error')
    if (email) {
      await writeFailedEmailLog(flow, {
        stage,
        email,
        subject: 'Password reset request',
        category: 'password_reset',
        error,
        metadata: { template: 'password_reset' }
      })
    }
    throw callableError(error, stage, 'failed-precondition', 'Password reset could not be requested right now.')
  }

  let link = ''
  try {
    stage = 'user lookup'
    userRecord = await admin.auth().getUserByEmail(email)
    logStage(flow, 'user lookup passed', { uid: userRecord.uid, recipientDomain: recipientDomain(email) })

    stage = 'actionCodeSettings'
    const settings = actionCodeSettings('/auth/action')
    logStage(flow, 'actionCodeSettings built', { urlOrigin: AUTH_ACTION_BASE_URL, continuePath: '/auth/action', handleCodeInApp: settings.handleCodeInApp })

    stage = 'Firebase Admin link generation'
    link = customAuthActionLink(await admin.auth().generatePasswordResetLink(email, settings), 'resetPassword')
    logStage(flow, 'Firebase Admin link generated', { uid: userRecord.uid, recipientDomain: recipientDomain(email) })
  } catch (error) {
    if (error?.code === 'auth/user-not-found') {
      logStage(flow, 'user lookup completed with no account', { recipientDomain: recipientDomain(email) })
      return { ok: true, message: GENERIC_RESET_MESSAGE }
    }
    logStage(flow, `${stage} failed`, serializeError(error, stage, { includeStack: true }), 'error')
    await writeFailedEmailLog(flow, {
      stage,
      email,
      subject: 'Password reset request',
      category: 'password_reset',
      relatedUid: userRecord?.uid || '',
      error,
      metadata: { template: 'password_reset' }
    })
    return { ok: true, message: GENERIC_RESET_MESSAGE }
  }

  const template = renderEmailTemplate('password_reset', { actionLink: link })
  subject = template.subject
  try {
    stage = 'email send'
    logStage(flow, 'email send attempted', { uid: userRecord.uid, recipientDomain: recipientDomain(email), category: 'password_reset' })
    const result = await sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      category: 'password_reset',
      metadata: { template: 'password_reset' }
    })
    logStage(flow, 'email send succeeded', { uid: userRecord.uid, recipientDomain: recipientDomain(email), provider: result.provider || 'smtp' })

    stage = 'email log write'
    logStage(flow, 'email log write start', { uid: userRecord.uid, recipientDomain: recipientDomain(email), status: 'sent' })
    await writeEmailLog({
      to: email,
      subject: template.subject,
      category: 'password_reset',
      relatedUid: userRecord.uid,
      provider: result.provider || 'smtp',
      providerMessageId: result.providerMessageId || '',
      status: 'sent',
      metadata: { template: 'password_reset' }
    })
    logStage(flow, 'email log write succeeded', { uid: userRecord.uid, recipientDomain: recipientDomain(email), status: 'sent' })

    stage = 'account security event write'
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
    })
    logStage(flow, 'account security event write succeeded', { uid: userRecord.uid })
  } catch (error) {
    logStage(flow, `${stage} failed`, serializeError(error, stage, { includeStack: true }), 'error')
    await writeFailedEmailLog(flow, {
      stage,
      email,
      subject,
      category: 'password_reset',
      relatedUid: userRecord?.uid || '',
      error,
      metadata: { template: 'password_reset' }
    })
    await writePasswordResetFailureEvent(flow, userRecord, error, stage)
    return { ok: true, message: GENERIC_RESET_MESSAGE }
  }

  return { ok: true, message: GENERIC_RESET_MESSAGE }
})

const requestEmailVerification = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const flow = 'requestEmailVerification'
  let stage = 'callable entered'
  let uid = ''
  let email = ''
  let subject = ''
  logStage(flow, stage, { hasAuth: Boolean(request.auth?.uid) })

  try {
    stage = 'auth check'
    uid = cleanString(request.auth?.uid || '', 180)
    if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
    logStage(flow, 'auth check passed', { uid })

    stage = 'payload validation'
    logStage(flow, 'payload validation passed', { uid })

    stage = 'rate limit check'
    logStage(flow, 'rate limit check started', { uid })
    await rateLimit(`email_verification_${uid}`, VERIFY_LIMIT_MS)
    logStage(flow, 'rate limit check passed', { uid })

    stage = 'user lookup'
    const user = await admin.auth().getUser(uid)
    logStage(flow, 'user lookup passed', { uid, emailVerified: Boolean(user.emailVerified), recipientDomain: recipientDomain(user.email || '') })

    email = validateEmailAddress(user.email || '')
    if (!email) throw new HttpsError('failed-precondition', 'This account does not have a valid email address.')
    if (user.emailVerified) return { ok: true, message: 'Your email is already verified.' }

    stage = 'actionCodeSettings'
    const settings = actionCodeSettings('/auth/action')
    logStage(flow, 'actionCodeSettings built', { uid, urlOrigin: AUTH_ACTION_BASE_URL, continuePath: '/auth/action', handleCodeInApp: settings.handleCodeInApp })

    stage = 'Firebase Admin link generation'
    const link = customAuthActionLink(await admin.auth().generateEmailVerificationLink(email, settings), 'verifyEmail')
    logStage(flow, 'Firebase Admin link generated', { uid, recipientDomain: recipientDomain(email) })

    const template = renderEmailTemplate('email_verification', { actionLink: link })
    subject = template.subject
    stage = 'email send'
    logStage(flow, 'email send attempted', { uid, recipientDomain: recipientDomain(email), category: 'email_verification' })
    const result = await sendEmail({
      to: email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      category: 'email_verification',
      metadata: { template: 'email_verification' }
    })
    logStage(flow, 'email send succeeded', { uid, recipientDomain: recipientDomain(email), provider: result.provider || 'smtp' })

    stage = 'email log write'
    logStage(flow, 'email log write start', { uid, recipientDomain: recipientDomain(email), status: 'sent' })
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
    logStage(flow, 'email log write succeeded', { uid, recipientDomain: recipientDomain(email), status: 'sent' })

    stage = 'account security event write'
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
    logStage(flow, 'account security event write succeeded', { uid })
  } catch (error) {
    logStage(flow, `${stage} failed`, serializeError(error, stage, { includeStack: true }), 'error')
    if (email) {
      await writeFailedEmailLog(flow, {
        stage,
        email,
        subject: subject || 'Email verification request',
        category: 'email_verification',
        relatedUid: uid,
        error,
        metadata: { template: 'email_verification' }
      })
      await writeVerificationFailureEvent(flow, uid, error, stage)
    }
    throw callableError(error, stage, 'failed-precondition', 'Verification email could not be sent right now.')
  }

  return { ok: true, message: 'Verification email sent.' }
})

module.exports = {
  requestEmailVerification,
  requestPasswordResetEmail
}
