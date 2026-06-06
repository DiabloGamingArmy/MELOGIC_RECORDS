const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const crypto = require('node:crypto')
const { assertAnyPermission, assertPermission, cleanString } = require('../admin/adminAuth')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { EMAIL_SECRETS, SUPPORT_EMAIL, providerConfigured, renderEmailTemplate, sendEmail, validateEmailAddress } = require('./emailSender')
const { writeEmailLog } = require('./emailLog')
const { writeAccountEvent } = require('../account/accountEvents')

const CATEGORIES = new Set(['support', 'account', 'marketplace', 'moderation', 'order', 'security', 'payout', 'other'])
const ADMIN_WINDOW_MS = 10 * 60 * 1000
const GLOBAL_WINDOW_MS = 60 * 60 * 1000
const RECIPIENT_WINDOW_MS = 60 * 60 * 1000
const ADMIN_LIMIT = 10
const GLOBAL_LIMIT = 50
const RECIPIENT_LIMIT = 5

function htmlEscape(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function plainTextToHtml(value = '') {
  return `<p>${htmlEscape(value).replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br />')}</p>`
}

function emailHash(email = '') {
  return crypto.createHash('sha256').update(String(email || '').toLowerCase()).digest('hex').slice(0, 32)
}

function windowBucket(ms = ADMIN_WINDOW_MS) {
  return Math.floor(Date.now() / ms)
}

function rateLimitRef(key = '') {
  return admin.firestore().collection('emailRateLimits').doc(key)
}

async function assertAdminEmailRateLimit({ uid = '', to = '' } = {}) {
  const now = Date.now()
  const checks = [
    { ref: rateLimitRef(`admin_${uid}_${windowBucket(ADMIN_WINDOW_MS)}`), limit: ADMIN_LIMIT, scope: 'admin' },
    { ref: rateLimitRef(`global_${windowBucket(GLOBAL_WINDOW_MS)}`), limit: GLOBAL_LIMIT, scope: 'global' },
    { ref: rateLimitRef(`recipient_${emailHash(to)}_${windowBucket(RECIPIENT_WINDOW_MS)}`), limit: RECIPIENT_LIMIT, scope: 'recipient' }
  ]
  await admin.firestore().runTransaction(async (tx) => {
    const snaps = await Promise.all(checks.map((check) => tx.get(check.ref)))
    for (let index = 0; index < checks.length; index += 1) {
      const count = snaps[index].exists ? Number(snaps[index].data()?.count || 0) : 0
      if (count >= checks[index].limit) {
        const error = new HttpsError('resource-exhausted', 'Email rate limit reached. Try again later.', {
          scope: checks[index].scope
        })
        throw error
      }
    }
    checks.forEach((check, index) => {
      const count = snaps[index].exists ? Number(snaps[index].data()?.count || 0) : 0
      tx.set(check.ref, {
        key: check.ref.id,
        scope: check.scope,
        count: count + 1,
        windowStartedAtMs: now,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
    })
  })
}

function cleanId(value = '') {
  const id = cleanString(value, 180)
  return id.includes('/') ? '' : id
}

function normalizeCc(value = []) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  return Array.from(new Set(values.map((email) => validateEmailAddress(email)).filter(Boolean))).slice(0, 5)
}

function sanitizeReplyTo(value = '') {
  return validateEmailAddress(value) || SUPPORT_EMAIL
}

async function logRateLimit({ claims, to, category, relatedUid, relatedProductId, relatedOrderId, relatedReportId, scope = '' } = {}) {
  await writeAdminAuditLog({
    actorUid: claims.uid,
    actorEmail: claims.email,
    actorRole: claims.adminRole,
    action: 'admin_email_rate_limited',
    targetType: 'email',
    targetId: to,
    reason: category,
    metadata: {
      targetEmailDomain: to.split('@')[1] || '',
      rateLimitScope: scope,
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId
    }
  }).catch(() => {})
}

const sendAdminEmail = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const claims = assertPermission(request, 'emailSend')

  const to = validateEmailAddress(request.data?.to || '')
  const cc = normalizeCc(request.data?.cc || [])
  const replyTo = sanitizeReplyTo(request.data?.replyTo || SUPPORT_EMAIL)
  const subject = cleanString(request.data?.subject || '', 180)
  const body = cleanString(request.data?.body || '', 5000)
  const category = CATEGORIES.has(cleanString(request.data?.category || '', 80)) ? cleanString(request.data?.category || '', 80) : 'support'
  const relatedUid = cleanId(request.data?.relatedUid || '')
  const relatedProductId = cleanId(request.data?.relatedProductId || '')
  const relatedOrderId = cleanId(request.data?.relatedOrderId || '')
  const relatedReportId = cleanId(request.data?.relatedReportId || '')

  if (!to) throw new HttpsError('invalid-argument', 'A valid recipient email is required.')
  if (cc.length && cc.includes(to)) throw new HttpsError('invalid-argument', 'CC cannot include the primary recipient.')
  if (!subject || subject.length > 180) throw new HttpsError('invalid-argument', 'Subject is required and must be 180 characters or fewer.')
  if (!body || body.length > 5000) throw new HttpsError('invalid-argument', 'Message body is required and must be 5000 characters or fewer.')
  try {
    await assertAdminEmailRateLimit({ uid: claims.uid, to })
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'resource-exhausted') {
      await logRateLimit({ claims, to, category, relatedUid, relatedProductId, relatedOrderId, relatedReportId, scope: error.details?.scope || '' })
    }
    throw error
  }

  const html = plainTextToHtml(body)
  let result = null
  try {
    result = await sendEmail({
      to,
      cc,
      subject,
      html,
      text: body,
      replyTo,
      category: `admin_${category}`,
      metadata: { template: 'admin_custom' }
    })
    const emailLogId = await writeEmailLog({
      to,
      cc,
      subject,
      category,
      templateName: 'admin_custom',
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId,
      body,
      provider: result.provider || 'smtp',
      providerMessageId: result.providerMessageId || '',
      status: 'sent',
      metadata: { source: 'admin_custom' }
    })
    const auditLogId = await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'admin_email_sent',
      targetType: 'email',
      targetId: to,
      targetPath: `emailLogs/${emailLogId}`,
      reason: category,
      metadata: {
        category,
        targetEmailDomain: to.split('@')[1] || '',
        relatedUid,
        relatedProductId,
        relatedOrderId,
        relatedReportId,
        providerMessageId: result.providerMessageId || ''
      }
    })
    return { ok: true, emailLogId, auditLogId, providerMessageId: result.providerMessageId || '' }
  } catch (error) {
    const emailLogId = await writeEmailLog({
      to,
      cc,
      subject,
      category,
      templateName: 'admin_custom',
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId,
      body,
      provider: result?.provider || 'smtp',
      status: 'failed',
      error,
      metadata: { source: 'admin_custom' }
    }).catch(() => '')
    await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'admin_email_failed',
      targetType: 'email',
      targetId: to,
      targetPath: emailLogId ? `emailLogs/${emailLogId}` : '',
      reason: category,
      metadata: {
        category,
        targetEmailDomain: to.split('@')[1] || '',
        relatedUid,
        relatedProductId,
        relatedOrderId,
        relatedReportId,
        errorCode: cleanString(error?.code || '', 120)
      }
    }).catch(() => {})
    throw new HttpsError('failed-precondition', error?.code === 'email-provider-not-configured' ? 'Email provider is not configured.' : 'Email could not be sent right now.')
  }
})

const sendAdminAuthEmail = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const claims = assertPermission(request, 'emailSend')
  const uid = cleanId(request.data?.uid || request.data?.relatedUid || '')
  const type = cleanString(request.data?.type || '', 80)
  if (!uid) throw new HttpsError('invalid-argument', 'A valid user uid is required.')
  if (!['password_reset', 'email_verification', 'security_notice'].includes(type)) {
    throw new HttpsError('invalid-argument', 'Unsupported admin email action.')
  }
  const user = await admin.auth().getUser(uid).catch(() => null)
  const to = validateEmailAddress(user?.email || request.data?.to || '')
  if (!to) throw new HttpsError('failed-precondition', 'This account does not have a valid email address.')
  try {
    await assertAdminEmailRateLimit({ uid: claims.uid, to })
  } catch (error) {
    if (error instanceof HttpsError && error.code === 'resource-exhausted') {
      await logRateLimit({ claims, to, category: type, relatedUid: uid, scope: error.details?.scope || '' })
    }
    throw error
  }

  let template = null
  let subject = ''
  let html = ''
  let text = ''
  if (type === 'password_reset') {
    const link = await admin.auth().generatePasswordResetLink(to, { url: 'https://melogicrecords.studio/auth', handleCodeInApp: false })
    template = renderEmailTemplate('password_reset', { actionLink: link })
  } else if (type === 'email_verification') {
    const link = await admin.auth().generateEmailVerificationLink(to, { url: 'https://melogicrecords.studio/auth', handleCodeInApp: false })
    template = renderEmailTemplate('email_verification', { actionLink: link })
  } else {
    subject = cleanString(request.data?.subject || 'Melogic Records security notice', 180)
    const body = cleanString(request.data?.body || 'A security notice was sent by Melogic Records Support.', 2000)
    html = plainTextToHtml(body)
    text = body
  }
  if (template) {
    subject = template.subject
    html = template.html
    text = template.text
  }

  let result = null
  try {
    result = await sendEmail({
      to,
      subject,
      html,
      text,
      category: `admin_${type}`,
      metadata: { template: type }
    })
    const emailLogId = await writeEmailLog({
      to,
      subject,
      category: type,
      templateName: type,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid: uid,
      body: text,
      provider: result.provider || 'smtp',
      providerMessageId: result.providerMessageId || '',
      status: 'sent',
      metadata: { source: 'admin_user_action' }
    })
    const auditLogId = await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: `admin_${type}_sent`,
      targetType: 'user',
      targetId: uid,
      targetPath: `users/${uid}`,
      reason: type,
      metadata: {
        emailLogId,
        targetEmailDomain: to.split('@')[1] || ''
      }
    })
    await writeAccountEvent(admin.firestore(), uid, {
      type: type === 'password_reset' ? 'password_reset_requested' : type === 'email_verification' ? 'email_verification_requested' : 'security_notice',
      severity: type === 'security_notice' ? 'warning' : 'info',
      title: type === 'password_reset' ? 'Password reset sent by support' : type === 'email_verification' ? 'Verification email sent by support' : subject,
      message: type === 'security_notice' ? 'Melogic Records Support sent a security notice for your account.' : 'Melogic Records Support sent an account email for your account.',
      actorUid: claims.uid,
      actorUsername: claims.email || '',
      actorType: 'admin',
      source: 'admin-email',
      path: '/account/security',
      emailSent: true,
      emailSentAt: new Date().toISOString(),
      metadata: { emailLogId, type }
    }).catch(() => {})
    return { ok: true, emailLogId, auditLogId, providerMessageId: result.providerMessageId || '' }
  } catch (error) {
    const emailLogId = await writeEmailLog({
      to,
      subject,
      category: type,
      templateName: type,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid: uid,
      body: text,
      provider: result?.provider || 'smtp',
      status: 'failed',
      error,
      metadata: { source: 'admin_user_action' }
    }).catch(() => '')
    await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: `admin_${type}_failed`,
      targetType: 'user',
      targetId: uid,
      targetPath: `users/${uid}`,
      reason: type,
      metadata: {
        emailLogId,
        targetEmailDomain: to.split('@')[1] || '',
        errorCode: cleanString(error?.code || '', 120)
      }
    }).catch(() => {})
    throw new HttpsError('failed-precondition', error?.code === 'email-provider-not-configured' ? 'Email provider is not configured.' : 'Email could not be sent right now.')
  }
})

const getEmailAdminStatus = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const claims = assertAnyPermission(request, ['emailSend', 'settingsManage', 'auditRead'])
  const [snapshot, failedSnap, lastSentSnap, lastFailedSnap] = await Promise.all([
    admin.firestore().collection('emailLogs').orderBy('createdAt', 'desc').limit(20).get().catch(() => ({ docs: [] })),
    admin.firestore().collection('emailLogs').where('status', '==', 'failed').orderBy('createdAt', 'desc').limit(10).get().catch(() => ({ docs: [] })),
    admin.firestore().collection('emailLogs').where('status', '==', 'sent').orderBy('createdAt', 'desc').limit(1).get().catch(() => ({ docs: [] })),
    admin.firestore().collection('emailLogs').where('status', '==', 'failed').orderBy('createdAt', 'desc').limit(1).get().catch(() => ({ docs: [] }))
  ])
  const recent = snapshot.docs.map((docSnap) => {
    const raw = docSnap.data() || {}
    return {
      emailId: docSnap.id,
      to: cleanString(raw.to || '', 320),
      recipientDomain: cleanString(raw.recipientDomain || '', 160),
      toDomain: cleanString(raw.toDomain || raw.recipientDomain || '', 160),
      subject: cleanString(raw.subject || '', 220),
      category: cleanString(raw.category || '', 80),
      templateName: cleanString(raw.templateName || '', 120),
      status: cleanString(raw.status || '', 80),
      sentByUid: cleanString(raw.sentByUid || '', 180),
      sentByUsername: cleanString(raw.sentByUsername || '', 180),
      provider: cleanString(raw.provider || '', 80),
      providerMessageId: cleanString(raw.providerMessageId || '', 260),
      errorCode: cleanString(raw.errorCode || '', 120),
      errorMessageRedacted: cleanString(raw.errorMessageRedacted || '', 240),
      createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : '',
      sentAt: raw.sentAt?.toDate ? raw.sentAt.toDate().toISOString() : ''
    }
  })
  const failures = failedSnap.docs.map((docSnap) => {
    const raw = docSnap.data() || {}
    return {
      emailId: docSnap.id,
      toDomain: cleanString(raw.toDomain || raw.recipientDomain || '', 160),
      subject: cleanString(raw.subject || '', 220),
      category: cleanString(raw.category || '', 80),
      errorCode: cleanString(raw.errorCode || '', 120),
      errorMessageRedacted: cleanString(raw.errorMessageRedacted || '', 240),
      createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : ''
    }
  })
  return {
    ok: true,
    senderAddress: 'support@melogicrecords.studio',
    provider: 'smtp',
    providerConfigured: providerConfigured(),
    passwordResetCustomSenderEnabled: true,
    verificationCustomSenderEnabled: true,
    securityNotificationsEnabled: true,
    lastSuccessAt: lastSentSnap.docs[0]?.data()?.sentAt?.toDate ? lastSentSnap.docs[0].data().sentAt.toDate().toISOString() : '',
    lastFailureAt: lastFailedSnap.docs[0]?.data()?.failedAt?.toDate ? lastFailedSnap.docs[0].data().failedAt.toDate().toISOString() : '',
    recentFailureCount: failedSnap.docs.length,
    recent,
    failures,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getEmailAdminStatus,
  sendAdminAuthEmail,
  sendAdminEmail
}
