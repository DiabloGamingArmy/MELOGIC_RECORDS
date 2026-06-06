const admin = require('firebase-admin')
const crypto = require('node:crypto')
const { writeAccountEvent } = require('../account/accountEvents')
const { renderEmailTemplate, sendEmail } = require('./emailSender')
const { writeEmailLog } = require('./emailLog')

const TYPE_TO_TEMPLATE = {
  new_login: 'new_login',
  password_changed: 'password_changed',
  email_changed: 'email_changed',
  two_factor_enabled: 'two_factor_enabled',
  two_factor_disabled: 'two_factor_disabled',
  admin_role_changed: 'admin_role_changed',
  account_suspended: 'account_suspended',
  account_recovered: 'account_recovered'
}

const TYPE_TO_EVENT = {
  new_login: 'login_success',
  password_changed: 'password_changed',
  email_changed: 'email_changed',
  two_factor_enabled: 'two_factor_enabled',
  two_factor_disabled: 'two_factor_disabled',
  admin_role_changed: 'admin_role_changed',
  account_suspended: 'account_suspended',
  account_recovered: 'security_notice'
}

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function hashIp(value = '') {
  const raw = cleanString(value, 120)
  if (!raw) return ''
  return crypto.createHash('sha256').update(raw).digest('hex').slice(0, 24)
}

async function loadUser(uid = '') {
  try {
    return await admin.auth().getUser(uid)
  } catch {
    return null
  }
}

async function sendSecurityEmail(uid = '', type = '', data = {}) {
  const cleanUid = cleanString(uid, 180)
  const cleanType = cleanString(type, 80)
  if (!cleanUid || !TYPE_TO_TEMPLATE[cleanType]) return { ok: false, reason: 'unsupported-security-email' }
  const user = await loadUser(cleanUid)
  const email = user?.email || ''
  const template = renderEmailTemplate(TYPE_TO_TEMPLATE[cleanType], {
    ...data,
    timestamp: data.timestamp || new Date().toISOString()
  })
  let emailSent = false
  let emailSkipped = !email
  let emailSkipReason = email ? '' : 'account-email-unavailable'
  let emailError = ''
  let providerMessageId = ''
  try {
    if (email) {
      const result = await sendEmail({
        to: email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        category: `security_${cleanType}`,
        metadata: { template: TYPE_TO_TEMPLATE[cleanType] }
      })
      emailSent = true
      providerMessageId = result.providerMessageId || ''
      await writeEmailLog({
        to: email,
        subject: template.subject,
        category: `security_${cleanType}`,
        relatedUid: cleanUid,
        provider: result.provider || 'smtp',
        providerMessageId,
        status: 'sent',
        metadata: { template: TYPE_TO_TEMPLATE[cleanType] }
      })
    }
  } catch (error) {
    emailError = cleanString(error?.code || error?.message || 'email-send-failed', 240)
    emailSkipped = true
    emailSkipReason = error?.code === 'email-provider-not-configured' ? 'email-provider-not-configured' : 'email-send-failed'
    console.warn('[securityEmail] Email provider not configured or send failed', {
      type: cleanType,
      uid: cleanUid,
      code: emailError
    })
    if (email) {
      await writeEmailLog({
        to: email,
        subject: template.subject,
        category: `security_${cleanType}`,
        relatedUid: cleanUid,
        provider: 'smtp',
        status: 'failed',
        error,
        metadata: { template: TYPE_TO_TEMPLATE[cleanType] }
      }).catch(() => {})
    }
  }

  const eventId = await writeAccountEvent(admin.firestore(), cleanUid, {
    type: TYPE_TO_EVENT[cleanType] || 'security_notice',
    severity: data.severity || (emailError ? 'warning' : 'info'),
    title: data.title || template.subject,
    message: data.message || 'A security event was recorded for your account.',
    actorUid: cleanString(data.actorUid || '', 180),
    actorUsername: cleanString(data.actorUsername || '', 180),
    actorType: data.actorUid ? 'admin' : 'system',
    source: data.source || 'email-security',
    path: '/account/security',
    ipHash: hashIp(data.ip || data.ipAddress || ''),
    userAgentSummary: cleanString(data.userAgentSummary || '', 180),
    emailSent,
    emailSentAt: emailSent ? new Date().toISOString() : '',
    emailSkipped,
    emailSkipReason,
    emailError,
    metadata: {
      ...(data.metadata || {}),
      ipHash: hashIp(data.ip || data.ipAddress || ''),
      userAgentSummary: cleanString(data.userAgentSummary || '', 180),
      emailSent,
      emailSentAt: emailSent ? new Date().toISOString() : '',
      emailSkipped,
      emailSkipReason,
      emailError
    }
  })

  return { ok: true, eventId, emailSent, emailSkipped, emailSkipReason, emailError, providerMessageId }
}

module.exports = {
  sendSecurityEmail
}
