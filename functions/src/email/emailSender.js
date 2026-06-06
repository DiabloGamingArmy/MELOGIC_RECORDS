const net = require('node:net')
const tls = require('node:tls')
const crypto = require('node:crypto')
const { defineSecret } = require('firebase-functions/params')

const SMTP_HOST = defineSecret('SMTP_HOST')
const SMTP_PORT = defineSecret('SMTP_PORT')
const SMTP_USER = defineSecret('SMTP_USER')
const SMTP_PASS = defineSecret('SMTP_PASS')
const EMAIL_FROM = defineSecret('EMAIL_FROM')

const EMAIL_SECRETS = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, EMAIL_FROM]
const SUPPORT_EMAIL = 'support@melogicrecords.studio'
const DEFAULT_FROM = `Melogic Records Support <${SUPPORT_EMAIL}>`

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

function smtpLineReader(socket) {
  let buffer = ''
  const pending = []
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8')
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline + 1)
      buffer = buffer.slice(newline + 1)
      const next = pending.shift()
      if (next) next(line)
    }
  })
  return () => new Promise((resolve) => pending.push(resolve))
}

async function readSmtpResponse(readLine) {
  const lines = []
  while (true) {
    const line = await readLine()
    lines.push(line.trim())
    if (/^\d{3}\s/.test(line)) break
  }
  const code = Number(lines[0]?.slice(0, 3) || 0)
  return { code, message: lines.join(' ') }
}

async function expectSmtp(readLine, expected) {
  const response = await readSmtpResponse(readLine)
  const allowed = Array.isArray(expected) ? expected : [expected]
  if (!allowed.includes(response.code)) {
    const error = new Error(`SMTP rejected command with ${response.code}`)
    error.code = `smtp-${response.code || 'unknown'}`
    error.smtpMessage = response.message
    throw error
  }
  return response
}

function writeSmtp(socket, command = '') {
  socket.write(`${command}\r\n`)
}

function dotStuff(value = '') {
  return String(value || '').replace(/\r?\n/g, '\r\n').replace(/^\./gm, '..')
}

function messageId() {
  return `<${crypto.randomUUID()}@melogicrecords.studio>`
}

function buildRawMessage({ to, cc = [], subject, html, text, from, replyTo }) {
  const boundary = `melogic-${crypto.randomBytes(12).toString('hex')}`
  const id = messageId()
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    ...(cc.length ? [`Cc: ${cc.join(', ')}`] : []),
    `Reply-To: ${replyTo || SUPPORT_EMAIL}`,
    `Subject: ${cleanString(subject, 180).replace(/\r?\n/g, ' ')}`,
    `Message-ID: ${id}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ]
  const body = [
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text || textFromHtml(html),
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html || htmlEscape(text || '').replace(/\n/g, '<br />'),
    `--${boundary}--`,
    ''
  ]
  return { raw: `${headers.join('\r\n')}\r\n\r\n${body.join('\r\n')}`, messageId: id }
}

async function sendViaSmtp(config, payload) {
  const secure = Number(config.port) === 465
  let socket = secure
    ? tls.connect({ host: config.host, port: config.port, servername: config.host })
    : net.connect({ host: config.host, port: config.port })
  const readLine = smtpLineReader(socket)
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve)
    socket.once('error', reject)
  })
  await expectSmtp(readLine, 220)
  writeSmtp(socket, `EHLO melogicrecords.studio`)
  await expectSmtp(readLine, 250)
  if (!secure) {
    writeSmtp(socket, 'STARTTLS')
    await expectSmtp(readLine, 220)
    socket = tls.connect({ socket, servername: config.host })
    await new Promise((resolve, reject) => {
      socket.once('secureConnect', resolve)
      socket.once('error', reject)
    })
    const secureReadLine = smtpLineReader(socket)
    writeSmtp(socket, `EHLO melogicrecords.studio`)
    await expectSmtp(secureReadLine, 250)
    writeSmtp(socket, 'AUTH LOGIN')
    await expectSmtp(secureReadLine, 334)
    writeSmtp(socket, Buffer.from(config.user).toString('base64'))
    await expectSmtp(secureReadLine, 334)
    writeSmtp(socket, Buffer.from(config.pass).toString('base64'))
    await expectSmtp(secureReadLine, 235)
    const built = buildRawMessage({ ...payload, from: config.from })
    writeSmtp(socket, `MAIL FROM:<${config.user}>`)
    await expectSmtp(secureReadLine, 250)
    for (const recipient of [payload.to, ...(payload.cc || [])]) {
      writeSmtp(socket, `RCPT TO:<${recipient}>`)
      await expectSmtp(secureReadLine, [250, 251])
    }
    writeSmtp(socket, 'DATA')
    await expectSmtp(secureReadLine, 354)
    writeSmtp(socket, `${dotStuff(built.raw)}\r\n.`)
    await expectSmtp(secureReadLine, 250)
    writeSmtp(socket, 'QUIT')
    socket.end()
    return { providerMessageId: built.messageId }
  }
  writeSmtp(socket, 'AUTH LOGIN')
  await expectSmtp(readLine, 334)
  writeSmtp(socket, Buffer.from(config.user).toString('base64'))
  await expectSmtp(readLine, 334)
  writeSmtp(socket, Buffer.from(config.pass).toString('base64'))
  await expectSmtp(readLine, 235)
  const built = buildRawMessage({ ...payload, from: config.from })
  writeSmtp(socket, `MAIL FROM:<${config.user}>`)
  await expectSmtp(readLine, 250)
  for (const recipient of [payload.to, ...(payload.cc || [])]) {
    writeSmtp(socket, `RCPT TO:<${recipient}>`)
    await expectSmtp(readLine, [250, 251])
  }
  writeSmtp(socket, 'DATA')
  await expectSmtp(readLine, 354)
  writeSmtp(socket, `${dotStuff(built.raw)}\r\n.`)
  await expectSmtp(readLine, 250)
  writeSmtp(socket, 'QUIT')
  socket.end()
  return { providerMessageId: built.messageId }
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
    const error = new Error('Email provider is not configured.')
    error.code = 'email-provider-not-configured'
    throw error
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
