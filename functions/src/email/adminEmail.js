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
const TEMPLATE_TYPES = new Set(['raw', 'support', 'alert'])

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

function normalizeTemplateType(value = '') {
  const type = cleanString(value || 'raw', 40).toLowerCase()
  return TEMPLATE_TYPES.has(type) ? type : 'raw'
}

function validateCtaUrl(value = '') {
  const raw = cleanString(value, 900)
  if (!raw) return ''
  try {
    const parsed = new URL(raw)
    if (!['http:', 'https:'].includes(parsed.protocol)) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

function textFromHtml(value = '') {
  return String(value || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function renderAdminTemplate({ templateType = 'raw', subject = '', body = '', ctaLabel = '', ctaUrl = '' } = {}) {
  const type = normalizeTemplateType(templateType)
  const cleanSubject = cleanString(subject, 180)
  const finalSubject = type === 'alert' && !/^\[alert\]/i.test(cleanSubject) ? `[ALERT] ${cleanSubject}` : cleanSubject
  const safeCtaUrl = validateCtaUrl(ctaUrl)
  const safeCtaLabel = cleanString(ctaLabel || (type === 'alert' ? 'Review Account Security' : 'Open Melogic Records'), 80)
  if (type === 'raw') {
    return {
      templateType: type,
      finalSubject,
      html: plainTextToHtml(body),
      text: body,
      ctaLabel: '',
      ctaUrl: ''
    }
  }
  const alertLabel = type === 'alert'
    ? '<p style="display:inline-block;margin:0 0 14px;padding:5px 9px;border-radius:999px;background:#432318;color:#ffd1a3;font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase">Melogic Alert</p>'
    : ''
  const button = safeCtaUrl
    ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:24px 0 4px"><tr><td style="background:${type === 'alert' ? '#ffb36b' : '#38d5c8'};border-radius:10px"><a href="${htmlEscape(safeCtaUrl)}" style="display:inline-block;padding:12px 18px;color:#061522;text-decoration:none;font-weight:800;font-size:14px">${htmlEscape(safeCtaLabel)}</a></td></tr></table>`
    : ''
  const html = `<!doctype html><html><body style="margin:0;background:#07101f;color:#e7f0ff;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07101f;padding:34px 12px"><tr><td align="center">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:640px;background:#0b1323;border:1px solid ${type === 'alert' ? '#5b3b2d' : '#273b5d'};border-radius:14px;overflow:hidden">
      <tr><td style="padding:22px 28px;background:#0f1b31;border-bottom:1px solid #243957"><p style="margin:0;color:#8ef8da;font-size:12px;letter-spacing:.18em;font-weight:800">MELOGIC RECORDS</p><p style="margin:8px 0 0;color:#9db2d6;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${type === 'alert' ? 'Account Alert' : 'Support'}</p></td></tr>
      <tr><td style="padding:30px 28px 26px">${alertLabel}<h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#fff">${htmlEscape(finalSubject)}</h1><div style="font-size:15px;line-height:1.65;color:#d5e1f7">${plainTextToHtml(body)}</div>${button}<hr style="border:0;border-top:1px solid #253750;margin:26px 0" /><p style="margin:0;color:#8fa3c7;font-size:12px;line-height:1.5">Need help? Reply to this email or contact ${SUPPORT_EMAIL}.</p></td></tr>
    </table>
  </td></tr></table>
</body></html>`
  const ctaText = safeCtaUrl ? `\n\n${safeCtaLabel}: ${safeCtaUrl}` : ''
  return {
    templateType: type,
    finalSubject,
    html,
    text: `${finalSubject}\n\n${body}${ctaText}\n\nNeed help? Reply to this email or contact ${SUPPORT_EMAIL}.`,
    ctaLabel: safeCtaUrl ? safeCtaLabel : '',
    ctaUrl: safeCtaUrl
  }
}

function sanitizedActionPreview(template = {}) {
  return {
    renderedHtml: cleanString(String(template.html || '').replace(/href="[^"]+"/g, 'href="[secure action link]"'), 20000),
    plainText: cleanString(String(template.text || '').replace(/https?:\/\/\S+/g, '[secure action link]'), 10000),
    ctaUrl: '[secure action link]'
  }
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

function serializeEmailLog(docSnap) {
  const raw = docSnap.data() || {}
  return {
    emailId: docSnap.id,
    to: cleanString(raw.to || '', 320),
    toDomain: cleanString(raw.toDomain || raw.recipientDomain || '', 160),
    recipientDomain: cleanString(raw.recipientDomain || raw.toDomain || '', 160),
    ccDomains: Array.isArray(raw.ccDomains) ? raw.ccDomains.map((domain) => cleanString(domain, 160)).filter(Boolean).slice(0, 10) : [],
    replyTo: cleanString(raw.replyTo || raw.metadata?.replyTo || '', 320),
    subject: cleanString(raw.subject || '', 220),
    category: cleanString(raw.category || '', 80),
    templateName: cleanString(raw.templateName || '', 120),
    status: cleanString(raw.status || '', 80),
    sentByUid: cleanString(raw.sentByUid || '', 180),
    sentByUsername: cleanString(raw.sentByUsername || '', 180),
    relatedUid: cleanString(raw.relatedUid || '', 180),
    relatedProductId: cleanString(raw.relatedProductId || '', 180),
    relatedOrderId: cleanString(raw.relatedOrderId || '', 180),
    relatedReportId: cleanString(raw.relatedReportId || '', 180),
    bodyHash: cleanString(raw.bodyHash || '', 80),
    bodyPreview: cleanString(raw.bodyPreview || '', 180),
    provider: cleanString(raw.provider || '', 80),
    providerMessageId: cleanString(raw.providerMessageId || '', 260),
    errorCode: cleanString(raw.errorCode || '', 120),
    errorMessageRedacted: cleanString(raw.errorMessageRedacted || '', 240),
    createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : '',
    sentAt: raw.sentAt?.toDate ? raw.sentAt.toDate().toISOString() : '',
    failedAt: raw.failedAt?.toDate ? raw.failedAt.toDate().toISOString() : '',
    internalNote: cleanString(raw.metadata?.internalNote || raw.metadata?.note || '', 900),
    templateType: cleanString(raw.templateType || raw.metadata?.templateType || raw.templateName || '', 120),
    finalSubject: cleanString(raw.finalSubject || raw.subject || '', 220),
    renderedHtml: cleanString(raw.renderedHtml || raw.htmlPreview || '', 20000),
    htmlPreview: cleanString(raw.htmlPreview || raw.renderedHtml || '', 20000),
    plainText: cleanString(raw.plainText || '', 10000),
    ctaLabel: cleanString(raw.ctaLabel || '', 120),
    ctaUrl: cleanString(raw.ctaUrl || '', 900)
  }
}

function normalizeCc(value = []) {
  const values = Array.isArray(value) ? value : String(value || '').split(',')
  return Array.from(new Set(values.map((email) => validateEmailAddress(email)).filter(Boolean))).slice(0, 5)
}

function sanitizeReplyTo(value = '') {
  return validateEmailAddress(value) || SUPPORT_EMAIL
}

function errorDetails(error = {}) {
  return {
    name: cleanString(error?.name || '', 120),
    code: cleanString(error?.code || error?.details?.code || '', 120),
    message: cleanString(error?.message || '', 300),
    stack: cleanString(error?.stack || '', 2000)
  }
}

function logStage(stage = '', data = {}, level = 'info') {
  const payload = { stage, ...data }
  if (level === 'error') console.error('[sendAdminEmail]', payload)
  else if (level === 'warn') console.warn('[sendAdminEmail]', payload)
  else console.info('[sendAdminEmail]', payload)
}

function safeFailureCode(error = {}) {
  const code = cleanString(error?.details?.code || error?.code || '', 120)
  if ([
    'email-provider-not-configured',
    'smtp-auth-failed',
    'smtp-timeout',
    'smtp-connection-failed',
    'smtp-recipient-rejected',
    'smtp-send-failed',
    'email-log-write-failed'
  ].includes(code)) return code
  if (code === 'resource-exhausted') return 'email-rate-limit-reached'
  return 'smtp-send-failed'
}

function safeFailureMessage(code = '') {
  const map = {
    'email-provider-not-configured': 'Email provider is not configured.',
    'smtp-auth-failed': 'SMTP authentication failed. Check the mailbox app password or Workspace SMTP policy.',
    'smtp-timeout': 'SMTP request timed out before the email provider responded.',
    'smtp-connection-failed': 'SMTP connection failed. Check host, port, and Workspace SMTP access.',
    'smtp-recipient-rejected': 'SMTP recipient was rejected by the provider.',
    'smtp-send-failed': 'SMTP send failed. Check Admin Email failures and Functions logs.',
    'email-log-write-failed': 'Email log could not be written.',
    'email-rate-limit-reached': 'Email rate limit reached. Try again later.'
  }
  return map[code] || 'Email could not be sent.'
}

function toCallableError(error = {}) {
  if (error instanceof HttpsError && error.code === 'resource-exhausted') return error
  const code = safeFailureCode(error)
  const canonical = code === 'smtp-timeout' ? 'deadline-exceeded' : 'failed-precondition'
  return new HttpsError(canonical, safeFailureMessage(code), {
    code,
    message: safeFailureMessage(code)
  })
}

function emailLogWriteError(error = {}) {
  const wrapped = new Error(safeFailureMessage('email-log-write-failed'))
  wrapped.name = 'EmailLogWriteError'
  wrapped.code = 'email-log-write-failed'
  wrapped.cause = error
  return wrapped
}

async function writeFailedEmailLog(input = {}) {
  logStage('failed email log write attempt started', {
    recipientDomain: input.to?.split('@')[1] || '',
    category: input.category || '',
    errorCode: cleanString(input.error?.code || input.error?.details?.code || '', 120)
  })
  try {
    const emailLogId = await writeEmailLog({
      ...input,
      provider: input.provider || 'smtp',
      status: 'failed'
    })
    logStage('email log write success', { emailLogId, status: 'failed' })
    return emailLogId
  } catch (logError) {
    logStage('email log write failure', errorDetails(logError), 'error')
    throw emailLogWriteError(logError)
  }
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
  logStage('sendAdminEmail callable entered', {
    hasAuth: Boolean(request.auth?.uid),
    appCheck: request.app ? 'present' : 'missing'
  })
  const claims = assertPermission(request, 'emailSend')
  logStage('auth/permission passed', {
    uid: claims.uid,
    adminRole: claims.adminRole,
    requires2FA: false
  })

  const to = validateEmailAddress(request.data?.to || '')
  const cc = normalizeCc(request.data?.cc || [])
  const replyTo = sanitizeReplyTo(request.data?.replyTo || SUPPORT_EMAIL)
  const subject = cleanString(request.data?.subject || '', 180)
  const body = cleanString(request.data?.body || '', 5000)
  const templateType = normalizeTemplateType(request.data?.templateType || 'raw')
  const ctaLabel = cleanString(request.data?.ctaLabel || '', 80)
  const rawCtaUrl = cleanString(request.data?.ctaUrl || '', 900)
  const ctaUrl = validateCtaUrl(rawCtaUrl)
  const category = CATEGORIES.has(cleanString(request.data?.category || '', 80)) ? cleanString(request.data?.category || '', 80) : 'support'
  const relatedUid = cleanId(request.data?.relatedUid || '')
  const relatedProductId = cleanId(request.data?.relatedProductId || '')
  const relatedOrderId = cleanId(request.data?.relatedOrderId || '')
  const relatedReportId = cleanId(request.data?.relatedReportId || '')

  if (!to) throw new HttpsError('invalid-argument', 'A valid recipient email is required.')
  if (cc.length && cc.includes(to)) throw new HttpsError('invalid-argument', 'CC cannot include the primary recipient.')
  if (!subject || subject.length > 180) throw new HttpsError('invalid-argument', 'Subject is required and must be 180 characters or fewer.')
  if (!body || body.length > 5000) throw new HttpsError('invalid-argument', 'Message body is required and must be 5000 characters or fewer.')
  if (rawCtaUrl && !ctaUrl) throw new HttpsError('invalid-argument', 'CTA URL must be a valid http or https URL.')
  logStage('payload validated', {
    recipientDomain: to.split('@')[1] || '',
    ccCount: cc.length,
    category,
    relatedUid: Boolean(relatedUid),
    relatedProductId: Boolean(relatedProductId),
    relatedOrderId: Boolean(relatedOrderId),
    relatedReportId: Boolean(relatedReportId),
    subjectLength: subject.length,
    bodyLength: body.length
  })
  try {
    logStage('rate limit check started', { uid: claims.uid, recipientDomain: to.split('@')[1] || '' })
    await assertAdminEmailRateLimit({ uid: claims.uid, to })
    logStage('rate limit passed', { uid: claims.uid, recipientDomain: to.split('@')[1] || '' })
  } catch (error) {
    logStage('rate limit failed', errorDetails(error), 'warn')
    const rateLimitError = error instanceof HttpsError ? error : new HttpsError('resource-exhausted', 'Email rate limit reached. Try again later.')
    if (error instanceof HttpsError && error.code === 'resource-exhausted') {
      await logRateLimit({ claims, to, category, relatedUid, relatedProductId, relatedOrderId, relatedReportId, scope: error.details?.scope || '' })
    }
    await writeFailedEmailLog({
      to,
      cc,
      subject,
      category,
      templateName: templateType,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId,
      body,
      error: rateLimitError,
      metadata: { source: 'admin_custom', stage: 'rate_limit', templateType, finalSubject: subject, plainText: body }
    }).catch((logError) => {
      logStage('rate-limit failed email log write failure', errorDetails(logError), 'error')
    })
    throw rateLimitError
  }

  const rendered = renderAdminTemplate({ templateType, subject, body, ctaLabel, ctaUrl })
  let result = null
  try {
    logStage('provider config detected', { providerConfigured: providerConfigured(), provider: 'smtp' })
    logStage('sendEmail start', { recipientDomain: to.split('@')[1] || '', category })
    result = await sendEmail({
      to,
      cc,
      subject: rendered.finalSubject,
      html: rendered.html,
      text: rendered.text,
      replyTo,
      category: `admin_${category}`,
      metadata: { template: templateType }
    })
    logStage('sendEmail success', {
      provider: result.provider || 'smtp',
      providerMessageId: cleanString(result.providerMessageId || '', 260)
    })
    logStage('emailLogs write start', { status: 'sent', recipientDomain: to.split('@')[1] || '' })
    const emailLogId = await writeEmailLog({
      to,
      cc,
      subject: rendered.finalSubject,
      category,
      templateName: templateType,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId,
      body: rendered.text,
      provider: result.provider || 'smtp',
      providerMessageId: result.providerMessageId || '',
      status: 'sent',
      metadata: {
        source: 'admin_custom',
        templateType,
        finalSubject: rendered.finalSubject,
        renderedHtml: rendered.html,
        plainText: rendered.text,
        ctaLabel: rendered.ctaLabel,
        ctaUrl: rendered.ctaUrl,
        replyTo
      }
    }).catch((logError) => {
      logStage('emailLogs write failure', errorDetails(logError), 'error')
      throw emailLogWriteError(logError)
    })
    logStage('emailLogs write success', { emailLogId, status: 'sent' })
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
        templateType,
        targetEmailDomain: to.split('@')[1] || '',
        relatedUid,
        relatedProductId,
        relatedOrderId,
        relatedReportId,
        providerMessageId: result.providerMessageId || ''
      }
    })
    logStage('adminLogs write success', { auditLogId, action: 'admin_email_sent' })
    return { ok: true, emailLogId, auditLogId, providerMessageId: result.providerMessageId || '' }
  } catch (error) {
    logStage('sendAdminEmail failure caught', errorDetails(error), 'error')
    let emailLogId = ''
    try {
      emailLogId = await writeFailedEmailLog({
      to,
      cc,
      subject: rendered.finalSubject,
      category,
      templateName: templateType,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId,
      body: rendered.text,
      provider: result?.provider || 'smtp',
      error,
      metadata: {
        source: 'admin_custom',
        templateType,
        finalSubject: rendered.finalSubject,
        renderedHtml: rendered.html,
        plainText: rendered.text,
        ctaLabel: rendered.ctaLabel,
        ctaUrl: rendered.ctaUrl,
        replyTo
      }
      })
    } catch (logError) {
      error = logError
    }
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
    }).then((auditLogId) => {
      logStage('adminLogs write success', { auditLogId, action: 'admin_email_failed' })
    }).catch((auditError) => {
      logStage('adminLogs write failure', errorDetails(auditError), 'error')
    })
    throw toCallableError(error)
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
  const authActionSettings = {
    url: 'https://melogicrecords.studio/auth/action',
    handleCodeInApp: true
  }
  const customAuthActionLink = (firebaseLink = '', fallbackMode = '') => {
    const parsed = new URL(firebaseLink)
    const output = new URL('/auth/action', 'https://melogicrecords.studio')
    const mode = parsed.searchParams.get('mode') || fallbackMode
    const oobCode = parsed.searchParams.get('oobCode') || ''
    const continueUrl = parsed.searchParams.get('continueUrl') || 'https://melogicrecords.studio/account/security'
    const lang = parsed.searchParams.get('lang') || ''
    if (mode) output.searchParams.set('mode', mode)
    if (oobCode) output.searchParams.set('oobCode', oobCode)
    if (continueUrl) output.searchParams.set('continueUrl', continueUrl)
    if (lang) output.searchParams.set('lang', lang)
    return output.toString()
  }
  if (type === 'password_reset') {
    const link = customAuthActionLink(await admin.auth().generatePasswordResetLink(to, authActionSettings), 'resetPassword')
    template = renderEmailTemplate('password_reset', { actionLink: link })
  } else if (type === 'email_verification') {
    const link = customAuthActionLink(await admin.auth().generateEmailVerificationLink(to, authActionSettings), 'verifyEmail')
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
      metadata: {
        source: 'admin_user_action',
        templateType: type,
        finalSubject: subject,
        ...(type === 'password_reset' || type === 'email_verification' ? sanitizedActionPreview({ html, text }) : { renderedHtml: html, plainText: text })
      }
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

const listAdminEmailLogs = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const claims = assertAnyPermission(request, ['emailSend', 'settingsManage', 'auditRead'])
  const mode = cleanString(request.data?.mode || request.data?.status || 'sent', 40).toLowerCase()
  const status = ['sent', 'failed', 'draft'].includes(mode) ? mode : 'sent'
  const limit = Math.max(1, Math.min(Math.round(Number(request.data?.limit || request.data?.limitCount || 10)), 25))
  const cursor = cleanId(request.data?.cursor || '')
  const search = cleanString(request.data?.search || '', 120).toLowerCase()
  const searchToken = search.split(/[^a-z0-9@._-]+/i).map((token) => token.trim()).filter((token) => token.length >= 2)[0] || ''

  if (status === 'draft') {
    return {
      ok: true,
      items: [],
      nextCursor: '',
      hasMore: false,
      requester: { uid: claims.uid, role: claims.adminRole }
    }
  }

  const ref = admin.firestore().collection('emailLogs')
  let query = ref.where('status', '==', status).orderBy('createdAt', 'desc')
  if (searchToken) {
    query = ref.where('status', '==', status).where('searchTokens', 'array-contains', searchToken).orderBy('createdAt', 'desc')
  }
  if (cursor) {
    const cursorSnap = await ref.doc(cursor).get().catch(() => null)
    if (cursorSnap?.exists) query = query.startAfter(cursorSnap)
  }
  let snapshot = await query.limit(limit).get()
  let docs = snapshot.docs || []
  if (searchToken && docs.length === 0) {
    const legacySnap = await ref.where('status', '==', status).orderBy('createdAt', 'desc').limit(50).get()
    docs = (legacySnap.docs || []).filter((docSnap) => {
      const row = serializeEmailLog(docSnap)
      return [
        row.to,
        row.toDomain,
        row.recipientDomain,
        row.subject,
        row.category,
        row.status,
        row.sentByUid,
        row.sentByUsername,
        row.relatedUid,
        row.relatedProductId,
        row.relatedOrderId,
        row.relatedReportId,
        row.provider,
        row.providerMessageId,
        row.bodyPreview,
        row.plainText,
        row.templateType
      ].join(' ').toLowerCase().includes(search)
    }).slice(0, limit)
    snapshot = { docs }
  }
  return {
    ok: true,
    items: docs.map(serializeEmailLog),
    nextCursor: searchToken ? '' : docs.length >= limit ? docs[docs.length - 1]?.id || '' : '',
    hasMore: searchToken ? false : docs.length >= limit,
    search: searchToken,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getEmailAdminStatus,
  listAdminEmailLogs,
  sendAdminAuthEmail,
  sendAdminEmail
}
