const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertAnyPermission, assertPermission, cleanString } = require('../admin/adminAuth')
const { writeAdminAuditLog } = require('../admin/auditLog')
const { EMAIL_SECRETS, providerConfigured, sendEmail, validateEmailAddress } = require('./emailSender')
const { writeEmailLog } = require('./emailLog')

const CATEGORIES = new Set(['support', 'account', 'marketplace', 'moderation', 'payout', 'other'])
const SEND_LIMIT_MS = 60 * 1000

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

async function rateLimitAdmin(uid = '') {
  const ref = admin.firestore().collection('emailRateLimits').doc(`admin_send_${uid}`)
  const now = Date.now()
  await admin.firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref)
    const last = snap.exists ? Number(snap.data()?.lastRequestedAtMs || 0) : 0
    if (last && now - last < SEND_LIMIT_MS) {
      throw new HttpsError('resource-exhausted', 'Please wait before sending another email.')
    }
    tx.set(ref, {
      key: ref.id,
      lastRequestedAtMs: now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
  })
}

function cleanId(value = '') {
  const id = cleanString(value, 180)
  return id.includes('/') ? '' : id
}

const sendAdminEmail = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const claims = assertPermission(request, 'emailSend')
  await rateLimitAdmin(claims.uid)

  const to = validateEmailAddress(request.data?.to || '')
  const subject = cleanString(request.data?.subject || '', 180)
  const body = cleanString(request.data?.body || '', 5000)
  const category = CATEGORIES.has(cleanString(request.data?.category || '', 80)) ? cleanString(request.data?.category || '', 80) : 'support'
  const relatedUid = cleanId(request.data?.relatedUid || '')
  const relatedProductId = cleanId(request.data?.relatedProductId || '')
  const relatedOrderId = cleanId(request.data?.relatedOrderId || '')

  if (!to) throw new HttpsError('invalid-argument', 'A valid recipient email is required.')
  if (!subject || subject.length > 180) throw new HttpsError('invalid-argument', 'Subject is required and must be 180 characters or fewer.')
  if (!body || body.length > 5000) throw new HttpsError('invalid-argument', 'Message body is required and must be 5000 characters or fewer.')

  const html = plainTextToHtml(body)
  let result = null
  try {
    result = await sendEmail({
      to,
      subject,
      html,
      text: body,
      category: `admin_${category}`,
      metadata: { template: 'admin_custom' }
    })
    const emailLogId = await writeEmailLog({
      to,
      subject,
      category,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
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
        recipientDomain: to.split('@')[1] || '',
        relatedUid,
        relatedProductId,
        relatedOrderId,
        providerMessageId: result.providerMessageId || ''
      }
    })
    return { ok: true, emailLogId, auditLogId, providerMessageId: result.providerMessageId || '' }
  } catch (error) {
    const emailLogId = await writeEmailLog({
      to,
      subject,
      category,
      sentByUid: claims.uid,
      sentByUsername: claims.email || '',
      relatedUid,
      relatedProductId,
      relatedOrderId,
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
        recipientDomain: to.split('@')[1] || '',
        errorCode: cleanString(error?.code || '', 120)
      }
    }).catch(() => {})
    throw new HttpsError('failed-precondition', error?.code === 'email-provider-not-configured' ? 'Email provider is not configured.' : 'Email could not be sent right now.')
  }
})

const getEmailAdminStatus = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const claims = assertAnyPermission(request, ['emailSend', 'settingsManage', 'auditRead'])
  const snapshot = await admin.firestore().collection('emailLogs').orderBy('createdAt', 'desc').limit(10).get().catch(() => ({ docs: [] }))
  const recent = snapshot.docs.map((docSnap) => {
    const raw = docSnap.data() || {}
    return {
      emailId: docSnap.id,
      to: cleanString(raw.to || '', 320),
      recipientDomain: cleanString(raw.recipientDomain || '', 160),
      subject: cleanString(raw.subject || '', 220),
      category: cleanString(raw.category || '', 80),
      status: cleanString(raw.status || '', 80),
      sentByUid: cleanString(raw.sentByUid || '', 180),
      provider: cleanString(raw.provider || '', 80),
      errorCode: cleanString(raw.errorCode || '', 120),
      errorMessageRedacted: cleanString(raw.errorMessageRedacted || '', 240),
      createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate().toISOString() : '',
      sentAt: raw.sentAt?.toDate ? raw.sentAt.toDate().toISOString() : ''
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
    recent,
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getEmailAdminStatus,
  sendAdminEmail
}
