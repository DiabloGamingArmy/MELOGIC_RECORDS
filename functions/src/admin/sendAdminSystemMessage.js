const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { buildAdminAuditLogEntry, writeAdminAuditLog } = require('./auditLog')
const { writeAccountEventToBatch } = require('../account/accountEvents')

function db() {
  return admin.firestore()
}

const CATEGORIES = new Set(['support', 'account', 'security', 'product', 'marketplace', 'community', 'order', 'other'])
const PRIORITIES = new Set(['normal', 'important', 'critical'])

function cleanCategory(value = '') {
  const category = cleanString(value || 'support', 40).toLowerCase()
  return CATEGORIES.has(category) ? category : 'support'
}

function cleanPriority(value = '') {
  const priority = cleanString(value || 'normal', 40).toLowerCase()
  return PRIORITIES.has(priority) ? priority : 'normal'
}

function severityForPriority(priority = '') {
  if (priority === 'critical') return 'critical'
  if (priority === 'important') return 'warning'
  return 'info'
}

function safeActionUrl(value = '') {
  const url = cleanString(value, 900)
  if (!url) return ''
  if (url.startsWith('/') && !url.startsWith('//')) return url
  try {
    const parsed = new URL(url)
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.toString() : ''
  } catch {
    return ''
  }
}

async function recipientExists(uid = '') {
  const [userSnap, profileSnap] = await Promise.all([
    db().collection('users').doc(uid).get().catch(() => null),
    db().collection('profiles').doc(uid).get().catch(() => null)
  ])
  return Boolean(userSnap?.exists || profileSnap?.exists)
}

async function writeFailedAudit({ claims, recipientUid, category, priority, subject, internalNote, reason }) {
  try {
    await writeAdminAuditLog({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'admin_system_message_failed',
      targetType: 'user',
      targetId: recipientUid,
      targetPath: recipientUid ? `users/${recipientUid}/systemNotifications` : '',
      reason,
      metadata: {
        category,
        priority,
        subject,
        internalNote
      }
    })
  } catch (logError) {
    console.error('[sendAdminSystemMessage] failed audit log write failed', {
      name: logError?.name || '',
      code: logError?.code || '',
      message: logError?.message || ''
    })
  }
}

const sendAdminSystemMessage = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = await requireAdminActionSecurity(request, 'emailSend')
  const recipientUid = cleanString(request.data?.recipientUid || request.data?.uid || '', 180)
  const category = cleanCategory(request.data?.category)
  const priority = cleanPriority(request.data?.priority)
  const subject = cleanString(request.data?.subject || request.data?.title || '', 180)
  const body = cleanString(request.data?.body || request.data?.message || '', 5000)
  const actionLabel = cleanString(request.data?.actionLabel || '', 80)
  const actionUrl = safeActionUrl(request.data?.actionUrl || '')
  const internalNote = cleanString(request.data?.internalNote || '', 1200)

  if (!recipientUid || recipientUid.includes('/')) {
    throw new HttpsError('invalid-argument', 'A valid recipient UID is required.')
  }
  if (!subject) throw new HttpsError('invalid-argument', 'A subject is required.')
  if (!body) throw new HttpsError('invalid-argument', 'A message body is required.')
  if (actionLabel && !actionUrl) throw new HttpsError('invalid-argument', 'An action URL is required when an action label is provided.')

  if (!await recipientExists(recipientUid)) {
    await writeFailedAudit({ claims, recipientUid, category, priority, subject, internalNote, reason: 'Recipient user not found.' })
    throw new HttpsError('not-found', 'Recipient user not found.')
  }

  const notificationRef = db().collection('users').doc(recipientUid).collection('systemNotifications').doc()
  const auditRef = db().collection('adminLogs').doc()
  const now = admin.firestore.FieldValue.serverTimestamp()
  const severity = severityForPriority(priority)
  const messageSnippet = body.slice(0, 240)
  const batch = db().batch()

  batch.set(notificationRef, {
    id: notificationRef.id,
    type: category === 'security' ? 'security' : category === 'account' ? 'account' : 'other',
    category,
    priority,
    severity,
    title: subject,
    body,
    message: body,
    source: 'admin_contact',
    sourceLabel: 'Melogic Records Support',
    senderName: 'Melogic Records Support',
    senderUsername: 'melogicsupport',
    senderHandle: '@melogicsupport',
    senderVerified: true,
    supportVerified: true,
    actionLabel,
    actionHref: actionUrl,
    actionUrl,
    readAt: null,
    createdAt: now,
    data: {
      type: 'admin_system_message',
      category,
      priority,
      actorUid: claims.uid
    }
  })
  batch.set(auditRef, {
    id: auditRef.id,
    ...buildAdminAuditLogEntry({
      actorUid: claims.uid,
      actorEmail: claims.email,
      actorRole: claims.adminRole,
      action: 'admin_system_message_sent',
      targetType: 'user',
      targetId: recipientUid,
      targetPath: `users/${recipientUid}/systemNotifications/${notificationRef.id}`,
      reason: internalNote,
      metadata: {
        category,
        priority,
        subject,
        internalNote,
        messageSnippet
      }
    })
  })
  const accountEventId = writeAccountEventToBatch(db(), batch, recipientUid, {
    type: 'security_notice',
    severity,
    title: subject,
    message: body,
    actorUid: claims.uid,
    actorType: 'admin',
    source: 'admin-contact',
    path: actionUrl || '/inbox?system=all',
    metadata: {
      category,
      priority,
      notificationId: notificationRef.id
    }
  })

  try {
    await batch.commit()
  } catch (error) {
    await writeFailedAudit({
      claims,
      recipientUid,
      category,
      priority,
      subject,
      internalNote,
      reason: error?.message || 'System message write failed.'
    })
    throw new HttpsError('internal', 'System message could not be sent.', {
      code: 'system-message-send-failed',
      message: 'System message could not be sent.'
    })
  }

  return {
    ok: true,
    notificationId: notificationRef.id,
    auditLogId: auditRef.id,
    accountEventId,
    recipientUid
  }
})

module.exports = {
  sendAdminSystemMessage
}
