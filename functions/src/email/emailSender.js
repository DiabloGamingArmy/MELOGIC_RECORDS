const nodemailer = require('nodemailer')
const { defineSecret } = require('firebase-functions/params')

const SMTP_HOST = defineSecret('SMTP_HOST')
const SMTP_PORT = defineSecret('SMTP_PORT')
const SMTP_USER = defineSecret('SMTP_USER')
const SMTP_PASS = defineSecret('SMTP_PASS')
const EMAIL_FROM = defineSecret('EMAIL_FROM')

const EMAIL_SECRETS = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM]
const SUPPORT_EMAIL = 'support@melogicrecords.studio'
const DEFAULT_FROM = `Melogic Records Support <${SUPPORT_EMAIL}>`
const SMTP_TIMEOUT_MS = 22000

function cleanString(value = '', max = 1000) {
  return String(value || '')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function validateEmailAddress(email = '') {
  const cleaned = cleanString(email, 320).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleaned)) return ''
  return cleaned
}

function recipientDomain(email = '') {
  return validateEmailAddress(email).split('@')[1] || ''
}

function safeErrorDetails(error = {}) {
  return {
    name: cleanString(error?.name || '', 120),
    code: cleanString(error?.code || '', 120),
    command: cleanString(error?.command || '', 120),
    responseCode: Number(error?.responseCode || 0) || 0,
    message: cleanString(error?.message || '', 300),
    stack: cleanString(error?.stack || '', 1800)
  }
}

function logStage(stage = '', data = {}, level = 'info') {
  const payload = {
    stage,
    ...data
  }
  if (level === 'error') console.error('[emailSender]', payload)
  else if (level === 'warn') console.warn('[emailSender]', payload)
  else console.info('[emailSender]', payload)
}

function safeEmailError(code = 'smtp-send-failed', message = 'Email could not be sent.', cause = null) {
  const error = new Error(message)
  error.name = 'SafeEmailError'
  error.code = code
  error.safeMessage = message
  if (cause) {
    error.cause = cause
    error.original = safeErrorDetails(cause)
  }
  return error
}

function mapSmtpError(error = {}) {
  const rawCode = cleanString(error?.code || '', 120).toUpperCase()
  const command = cleanString(error?.command || '', 120).toUpperCase()
  const responseCode = Number(error?.responseCode || 0)
  const message = cleanString(error?.message || '', 500).toLowerCase()

  if (rawCode === 'SMTP-TIMEOUT' || rawCode.includes('TIMEOUT') || message.includes('timed out')) return 'smtp-timeout'
  if (rawCode === 'EAUTH' || command === 'AUTH' || [530, 534, 535].includes(responseCode)) return 'smtp-auth-failed'
  if (rawCode === 'ECONNECTION' || rawCode === 'ESOCKET' || rawCode === 'ECONNREFUSED' || rawCode === 'ENOTFOUND' || rawCode === 'EAI_AGAIN') return 'smtp-connection-failed'
  if (rawCode === 'EENVELOPE' || command === 'RCPT TO' || [550, 551, 552, 553, 554].includes(responseCode)) return 'smtp-recipient-rejected'
  return 'smtp-send-failed'
}

function safeMessageForCode(code = '') {
  const map = {
    'email-provider-not-configured': 'Email provider is not configured.',
    'smtp-auth-failed': 'SMTP authentication failed. Check the mailbox app password or Workspace SMTP policy.',
    'smtp-timeout': 'SMTP request timed out before the email provider responded.',
    'smtp-connection-failed': 'SMTP connection failed. Check host, port, and Workspace SMTP access.',
    'smtp-recipient-rejected': 'SMTP recipient was rejected by the provider.',
    'smtp-send-failed': 'SMTP send failed.',
    'email-log-write-failed': 'Email log could not be written.'
  }
  return map[code] || 'Email could not be sent.'
}

function withTimeout(promise, timeoutMs = SMTP_TIMEOUT_MS, stage = 'smtp') {
  let timer = null
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = safeEmailError('smtp-timeout', safeMessageForCode('smtp-timeout'))
      error.stage = stage
      reject(error)
    }, timeoutMs)
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

function htmlEscape(value = '') {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function textFromHtml(html = '') {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function appUrl(path = '/') {
  const cleanPath = String(path || '/').startsWith('/') ? path : `/${path}`
  return `https://melogicrecords.studio${cleanPath}`
}

const TEMPLATE_SUBJECTS = {
  password_reset: 'Reset your Melogic Records password',
  email_verification: 'Confirm your Melogic Records email',
  security_new_login: 'New sign-in to your Melogic Records account',
  security_password_changed: 'Your Melogic Records password was changed',
  security_email_changed: 'Your Melogic Records email was changed',
  security_2fa_enabled: 'Two-factor authentication was enabled',
  security_2fa_disabled: 'Two-factor authentication was disabled'
}

function baseEmailHtml({ eyebrow = 'Melogic Records', title = '', body = '', ctaLabel = '', ctaUrl = '', footer = '' } = {}) {
  const button = ctaUrl
    ? `<p style="margin:28px 0"><a href="${htmlEscape(ctaUrl)}" style="background:#35c6ee;color:#04111f;text-decoration:none;border-radius:8px;padding:12px 18px;font-weight:700;display:inline-block">${htmlEscape(ctaLabel || 'Open Melogic Records')}</a></p>`
    : ''
  return `<!doctype html>
<html><body style="margin:0;background:#07101f;color:#e7f0ff;font-family:Arial,Helvetica,sans-serif">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#07101f;padding:28px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#0d1728;border:1px solid #253750;border-radius:12px;padding:28px">
        <tr><td>
          <p style="margin:0 0 8px;color:#8ef8da;font-size:12px;letter-spacing:.08em;text-transform:uppercase">${htmlEscape(eyebrow)}</p>
          <h1 style="margin:0 0 16px;font-size:26px;line-height:1.2;color:#ffffff">${htmlEscape(title)}</h1>
          <div style="font-size:15px;line-height:1.65;color:#d5e1f7">${body}</div>
          ${button}
          ${footer ? `<p style="margin:18px 0 0;color:#aebddd;font-size:13px;line-height:1.5">${footer}</p>` : ''}
          <hr style="border:0;border-top:1px solid #253750;margin:24px 0" />
          <p style="margin:0;color:#8fa3c7;font-size:12px">Need help? Reply to this email or contact ${SUPPORT_EMAIL}.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}

function renderEmailTemplate(templateName = '', data = {}) {
  const name = cleanString(templateName, 80)
  const timestamp = cleanString(data.timestamp || new Date().toISOString(), 80)
  const actionLink = cleanString(data.actionLink || '', 2000)
  const fallbackLink = actionLink ? `\n\nIf the button does not work, copy and paste this link into your browser:\n${actionLink}` : ''
  const common = {
    supportEmail: SUPPORT_EMAIL,
    timestamp,
    actionLink
  }

  if (name === 'password_reset') {
    const html = baseEmailHtml({
      title: 'Reset your password',
      body: `<p>We received a request to reset the password for your Melogic Records account.</p><p>If you made this request, use the button below. If this was not you, you can safely ignore this email.</p>`,
      ctaLabel: 'Reset Password',
      ctaUrl: actionLink
    })
    return { subject: TEMPLATE_SUBJECTS.password_reset, html, text: `Reset your Melogic Records password.\n\nUse this link to reset your password:${fallbackLink}\n\nIf this was not you, you can ignore this email.\n\nSupport: ${SUPPORT_EMAIL}` }
  }

  if (name === 'email_verification') {
    const html = baseEmailHtml({
      title: 'Confirm your email',
      body: `<p>Confirm this email address to finish securing your Melogic Records account.</p>`,
      ctaLabel: 'Confirm Email',
      ctaUrl: actionLink
    })
    return { subject: TEMPLATE_SUBJECTS.email_verification, html, text: `Confirm your Melogic Records email.${fallbackLink}\n\nSupport: ${SUPPORT_EMAIL}` }
  }

  const securityTemplates = {
    new_login: ['security_new_login', 'New sign-in detected', 'A new sign-in was recorded for your Melogic Records account.'],
    password_changed: ['security_password_changed', 'Password changed', 'Your Melogic Records password was changed.'],
    email_changed: ['security_email_changed', 'Email changed', 'Your Melogic Records account email was changed.'],
    two_factor_enabled: ['security_2fa_enabled', 'Two-factor authentication enabled', 'Two-factor authentication was enabled for your account.'],
    two_factor_disabled: ['security_2fa_disabled', 'Two-factor authentication disabled', 'Two-factor authentication was disabled for your account.'],
    admin_role_changed: ['security_notice', 'Admin role changed', 'An admin role change was recorded for your account.'],
    account_suspended: ['security_notice', 'Account status changed', 'An account status change was recorded.'],
    account_recovered: ['security_notice', 'Account recovery activity', 'Account recovery activity was recorded.']
  }
  const [subjectKey, title, message] = securityTemplates[name] || ['security_notice', 'Account security notice', 'A security event was recorded for your Melogic Records account.']
  const details = [data.deviceSummary, data.userAgentSummary, data.ipSummary].map((item) => cleanString(item, 180)).filter(Boolean).join(' · ')
  const html = baseEmailHtml({
    eyebrow: 'Account Security',
    title,
    body: `<p>${htmlEscape(message)}</p>${details ? `<p><strong>Details:</strong> ${htmlEscape(details)}</p>` : ''}<p><strong>Time:</strong> ${htmlEscape(timestamp)}</p><p>If this was not you, reset your password and contact support.</p>`,
    ctaLabel: 'Review Account Security',
    ctaUrl: appUrl('/account/security')
  })
  return {
    subject: TEMPLATE_SUBJECTS[subjectKey] || 'Melogic Records security notice',
    html,
    text: `${title}\n\n${message}\n${details ? `\nDetails: ${details}` : ''}\nTime: ${timestamp}\n\nIf this was not you, reset your password and contact ${SUPPORT_EMAIL}.\n\nAccount security: ${appUrl('/account/security')}`
  }
}

function readSmtpConfig() {
  try {
    const host = cleanString(SMTP_HOST.value(), 180)
    const port = Number(SMTP_PORT.value() || 587)
    const user = cleanString(SMTP_USER.value(), 320)
    const pass = String(SMTP_PASS.value() || '')
    const from = cleanString(EMAIL_FROM.value() || DEFAULT_FROM, 320)
    if (!host || !port || !user || !pass) return { configured: false, provider: 'smtp' }
    return { configured: true, provider: 'smtp', host, port, user, pass, from }
  } catch (error) {
    return { configured: false, provider: 'smtp' }
  }
}

async function sendViaSmtp(config, payload) {
  const secure = Number(config.port) === 465
  const requireTLS = Number(config.port) === 587
  const recipients = [payload.to, ...(payload.cc || [])]
  const diag = {
    provider: 'smtp',
    port: Number(config.port),
    secure,
    requireTLS,
    recipientDomain: recipientDomain(payload.to),
    ccCount: (payload.cc || []).length,
    userDomain: recipientDomain(config.user),
    fromDomain: recipientDomain(config.from)
  }
  logStage('provider config detected', diag)
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: Number(config.port),
    secure,
    requireTLS,
    auth: {
      user: config.user,
      pass: config.pass
    },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 20000,
    tls: {
      servername: config.host
    }
  })

  try {
    logStage('SMTP connect start', diag)
    if (!secure) logStage('STARTTLS start', { requireTLS })
    logStage('SMTP auth start', { userDomain: recipientDomain(config.user) })
    await withTimeout(transporter.verify(), SMTP_TIMEOUT_MS, 'smtp-verify')
    logStage('SMTP connect success', diag)
    logStage('SMTP 220 received', { inferredBy: 'nodemailer.verify' })
    logStage('EHLO sent/received', { inferredBy: 'nodemailer.verify' })
    if (!secure) {
      logStage('STARTTLS success', { inferredBy: 'nodemailer.verify' })
      logStage('TLS secureConnect success', { inferredBy: 'nodemailer.verify' })
    }
    logStage('SMTP auth success', { userDomain: recipientDomain(config.user) })

    logStage('MAIL FROM start', { fromDomain: recipientDomain(config.user) })
    logStage('RCPT TO start', { recipientDomain: recipientDomain(payload.to), recipientCount: recipients.length })
    logStage('DATA start', { hasHtml: Boolean(payload.html), hasText: Boolean(payload.text) })
    const info = await withTimeout(
      transporter.sendMail({
        from: config.from,
        to: payload.to,
        cc: payload.cc || [],
        replyTo: payload.replyTo || SUPPORT_EMAIL,
        subject: payload.subject,
        text: payload.text || textFromHtml(payload.html),
        html: payload.html || htmlEscape(payload.text || '').replace(/\n/g, '<br />')
      }),
      SMTP_TIMEOUT_MS,
      'smtp-send'
    )
    logStage('MAIL FROM success', { fromDomain: recipientDomain(config.user) })
    logStage('RCPT TO success', { acceptedCount: Array.isArray(info.accepted) ? info.accepted.length : 0, rejectedCount: Array.isArray(info.rejected) ? info.rejected.length : 0 })
    logStage('DATA success', { providerMessageId: cleanString(info.messageId || '', 260) })
    logStage('final SMTP accepted message', { providerMessageId: cleanString(info.messageId || '', 260), response: cleanString(info.response || '', 260) })
    return { providerMessageId: info.messageId || '', accepted: info.accepted || [], rejected: info.rejected || [] }
  } catch (error) {
    const mapped = error?.code === 'smtp-timeout' ? 'smtp-timeout' : mapSmtpError(error)
    const safe = safeEmailError(mapped, safeMessageForCode(mapped), error)
    logStage(`${mapped} failure`, safeErrorDetails(error), 'error')
    if (mapped === 'smtp-connection-failed') logStage('SMTP connect failure', safeErrorDetails(error), 'error')
    if (mapped === 'smtp-timeout') logStage('SMTP timeout failure', { stage: cleanString(error?.stage || '', 80), ...safeErrorDetails(error) }, 'error')
    if (mapped === 'smtp-auth-failed') logStage('SMTP auth failure', safeErrorDetails(error), 'error')
    if (mapped === 'smtp-recipient-rejected') logStage('RCPT TO failure', safeErrorDetails(error), 'error')
    if (mapped === 'smtp-send-failed') logStage('DATA failure', safeErrorDetails(error), 'error')
    throw safe
  } finally {
    try {
      transporter.close()
      logStage('socket close/destroy', { provider: 'smtp', closed: true })
    } catch (closeError) {
      logStage('socket close/destroy failure', safeErrorDetails(closeError), 'warn')
    }
  }
}

async function sendEmail({ to, cc = [], subject, html, text, replyTo = SUPPORT_EMAIL, category = 'transactional', metadata = {} } = {}) {
  const cleanTo = validateEmailAddress(to)
  if (!cleanTo) {
    const error = new Error('A valid recipient email is required.')
    error.code = 'invalid-recipient'
    throw error
  }
  const cleanSubject = cleanString(subject, 180)
  const cleanCc = Array.isArray(cc) ? Array.from(new Set(cc.map((email) => validateEmailAddress(email)).filter(Boolean))).slice(0, 10) : []
  if (!cleanSubject) {
    const error = new Error('Email subject is required.')
    error.code = 'invalid-subject'
    throw error
  }
  const cleanHtml = String(html || '').trim()
  const cleanText = String(text || '').trim()
  if (!cleanHtml && !cleanText) {
    const error = new Error('Email body is required.')
    error.code = 'invalid-body'
    throw error
  }

  const config = readSmtpConfig()
  const domain = recipientDomain(cleanTo)
  if (!config.configured) {
    console.warn('[emailSender] provider not configured', { category, recipientDomain: domain })
    throw safeEmailError('email-provider-not-configured', safeMessageForCode('email-provider-not-configured'))
  }
  try {
    const result = await sendViaSmtp(config, { to: cleanTo, cc: cleanCc, subject: cleanSubject, html: cleanHtml, text: cleanText, replyTo })
    console.info('[emailSender] sent', { category, recipientDomain: domain, provider: config.provider, providerMessageId: result.providerMessageId, metadata: { template: metadata.template || '' } })
    return { ok: true, provider: config.provider, providerMessageId: result.providerMessageId }
  } catch (error) {
    console.warn('[emailSender] send failed', { category, recipientDomain: domain, code: error?.code || 'email-send-failed', message: cleanString(error?.message || '', 240) })
    throw error
  }
}

function providerConfigured() {
  return readSmtpConfig().configured === true
}

module.exports = {
  EMAIL_SECRETS,
  SUPPORT_EMAIL,
  providerConfigured,
  renderEmailTemplate,
  sendEmail,
  validateEmailAddress
}
