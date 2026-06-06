const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { requireAdminActionSecurity, cleanString, normalizeRole, roleRank } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const { writeAccountEvent } = require('../account/accountEvents')
const { EMAIL_SECRETS, renderEmailTemplate, sendEmail, validateEmailAddress } = require('../email/emailSender')
const { writeEmailLog } = require('../email/emailLog')

function safeUid(value = '') {
  const uid = cleanString(value, 180)
  if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid user uid is required.')
  return uid
}

function randomTemporaryPassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%+-'
  const bytes = require('node:crypto').randomBytes(18)
  return Array.from(bytes).map((byte) => alphabet[byte % alphabet.length]).join('')
}

async function assertOwnerOnly(claims = {}) {
  if (normalizeRole(claims.adminRole || '') !== 'owner' || roleRank(claims.adminRole || '') < 100) {
    throw new HttpsError('permission-denied', 'Owner admin access is required for this action.')
  }
}

async function sendPasswordResetForUser(uid = '', actor = {}, { force = false } = {}) {
  const user = await admin.auth().getUser(uid)
  const email = validateEmailAddress(user.email || '')
  if (!email) throw new HttpsError('failed-precondition', 'This account does not have a valid email address.')
  const link = await admin.auth().generatePasswordResetLink(email, {
    url: 'https://melogicrecords.studio/auth/action',
    handleCodeInApp: true
  })
  const parsed = new URL(link)
  const output = new URL('/auth/action', 'https://melogicrecords.studio')
  ;['mode', 'oobCode', 'continueUrl', 'lang'].forEach((key) => {
    const value = parsed.searchParams.get(key)
    if (value) output.searchParams.set(key, value)
  })
  const template = renderEmailTemplate('password_reset', { actionLink: output.toString() })
  const safePreview = {
    renderedHtml: String(template.html || '').replace(/href="[^"]+"/g, 'href="[secure action link]"'),
    plainText: String(template.text || '').replace(/https?:\/\/\S+/g, '[secure action link]'),
    templateType: force ? 'admin_force_password_reset' : 'admin_password_reset',
    finalSubject: template.subject,
    ctaUrl: '[secure action link]'
  }
  const result = await sendEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    category: force ? 'admin_force_password_reset' : 'admin_password_reset',
    metadata: { template: safePreview.templateType }
  })
  const emailLogId = await writeEmailLog({
    to: email,
    subject: template.subject,
    category: force ? 'security' : 'account',
    templateName: safePreview.templateType,
    sentByUid: actor.uid,
    sentByUsername: actor.email || '',
    relatedUid: uid,
    provider: result.provider || 'smtp',
    providerMessageId: result.providerMessageId || '',
    status: 'sent',
    metadata: safePreview
  })
  if (force) {
    await admin.firestore().collection('users').doc(uid).set({
      security: {
        passwordResetRequired: true,
        passwordResetRequiredAt: admin.firestore.FieldValue.serverTimestamp(),
        passwordResetRequiredBy: actor.uid
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true })
  }
  await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: force ? 'admin_force_password_reset' : 'admin_password_reset_sent',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}`,
    reason: force ? 'Force password reset requested' : 'Password reset email sent',
    metadata: { emailLogId }
  })
  await writeAccountEvent(admin.firestore(), uid, {
    type: 'password_reset_requested',
    severity: force ? 'warning' : 'info',
    title: force ? 'Password reset required' : 'Password reset sent by support',
    message: force ? 'Melogic Records Support requires a password reset for your account.' : 'Melogic Records Support sent a password reset email for your account.',
    actorUid: actor.uid,
    actorType: 'admin',
    source: 'admin-security-tools',
    path: '/account/security',
    emailSent: true,
    emailSentAt: new Date().toISOString(),
    metadata: { emailLogId, force }
  }).catch(() => {})
  return { ok: true, emailLogId }
}

const forcePasswordReset = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const actor = await requireAdminActionSecurity(request, 'emailSend')
  const uid = safeUid(request.data?.uid || '')
  return sendPasswordResetForUser(uid, actor, { force: true })
})

const setTemporaryPassword = onCall({ timeoutSeconds: 60, memory: '256MiB', secrets: EMAIL_SECRETS }, async (request) => {
  const actor = await requireAdminActionSecurity(request, 'roleManage')
  await assertOwnerOnly(actor)
  const uid = safeUid(request.data?.uid || '')
  if (uid === actor.uid) throw new HttpsError('failed-precondition', 'You cannot set your own temporary password.')
  const confirmation = cleanString(request.data?.confirmation || '', 80)
  if (confirmation !== 'SET TEMPORARY PASSWORD') throw new HttpsError('failed-precondition', 'Confirmation phrase is required.')
  const password = cleanString(request.data?.password || '', 120) || randomTemporaryPassword()
  if (password.length < 12) throw new HttpsError('invalid-argument', 'Temporary password must be at least 12 characters.')
  await admin.auth().updateUser(uid, { password })
  await admin.firestore().collection('users').doc(uid).set({
    security: {
      passwordResetRequired: true,
      temporaryPasswordSetAt: admin.firestore.FieldValue.serverTimestamp(),
      temporaryPasswordSetBy: actor.uid
    },
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: 'admin_temporary_password_set',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}`,
    reason: 'Temporary password set',
    metadata: { generated: !request.data?.password }
  })
  await writeAccountEvent(admin.firestore(), uid, {
    type: 'password_changed',
    severity: 'critical',
    title: 'Password changed by support',
    message: 'Melogic Records Support changed your password. Reset it after signing in.',
    actorUid: actor.uid,
    actorType: 'admin',
    source: 'admin-security-tools',
    path: '/account/security'
  }).catch(() => {})
  return { ok: true, temporaryPassword: request.data?.password ? '' : password }
})

const revokeRecoveryCodes = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const actor = await requireAdminActionSecurity(request, 'roleManage')
  await assertOwnerOnly(actor)
  const uid = safeUid(request.data?.uid || '')
  const confirmation = cleanString(request.data?.confirmation || '', 80)
  if (confirmation !== 'REVOKE CODES') throw new HttpsError('failed-precondition', 'Confirmation phrase is required.')
  await admin.firestore().collection('users').doc(uid).collection('security').doc('recoveryCodes').set({
    enabled: false,
    remaining: 0,
    codeHashes: [],
    revokedAt: admin.firestore.FieldValue.serverTimestamp(),
    revokedBy: actor.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: 'admin_recovery_codes_revoked',
    targetType: 'user',
    targetId: uid,
    targetPath: `users/${uid}/security/recoveryCodes`,
    reason: 'Recovery codes revoked'
  })
  await writeAccountEvent(admin.firestore(), uid, {
    type: 'recovery_codes_generated',
    severity: 'critical',
    title: 'Recovery codes revoked',
    message: 'Melogic Records Support revoked your account recovery codes.',
    actorUid: actor.uid,
    actorType: 'admin',
    source: 'admin-security-tools',
    path: '/account/security'
  }).catch(() => {})
  return { ok: true, revoked: true }
})

module.exports = {
  forcePasswordReset,
  revokeRecoveryCodes,
  setTemporaryPassword
}
