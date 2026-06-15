const admin = require('firebase-admin')

const ACCOUNT_EVENT_TYPES = new Set([
  'login_success',
  'login_failed',
  'password_reset_requested',
  'password_reset_completed',
  'password_changed',
  'email_verification_requested',
  'email_verified',
  'auth_action_link_invalid',
  'auth_action_link_expired',
  'email_change_requested',
  'email_changed',
  'profile_changed',
  'two_factor_enabled',
  'two_factor_disabled',
  'recovery_codes_generated',
  'recovery_code_used',
  'product_submitted',
  'product_approved',
  'product_rejected',
  'product_returned',
  'report_submitted',
  'report_resolved',
  'community_post_like',
  'community_comment',
  'community_reply',
  'community_comment_like',
  'community_follow',
  'community_report',
  'order_created',
  'order_placed',
  'entitlement_granted',
  'refund_requested',
  'admin_role_changed',
  'account_suspended',
  'account_unsuspended',
  'security_notice'
])

const ACCOUNT_EVENT_SEVERITIES = new Set(['info', 'success', 'warning', 'critical'])

function cleanString(value = '', max = 500) {
  return String(value || '').trim().slice(0, max)
}

function cleanUid(value = '') {
  const uid = cleanString(value, 180)
  return uid && !uid.includes('/') ? uid : ''
}

function cleanEventType(value = '') {
  const type = cleanString(value, 80)
  return ACCOUNT_EVENT_TYPES.has(type) ? type : 'security_notice'
}

function cleanSeverity(value = '') {
  const severity = cleanString(value, 40)
  return ACCOUNT_EVENT_SEVERITIES.has(severity) ? severity : 'info'
}

function sanitizeMetadata(value = {}, depth = 0) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return {}
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, 30)
      .map(([key, child]) => {
        const cleanKey = cleanString(key, 80)
        if (!cleanKey) return null
        if (child === null || child === undefined) return [cleanKey, null]
        if (typeof child === 'boolean') return [cleanKey, child]
        if (typeof child === 'number') return [cleanKey, Number.isFinite(child) ? child : null]
        if (typeof child === 'string') return [cleanKey, cleanString(child, 700)]
        if (Array.isArray(child)) return [cleanKey, child.slice(0, 20).map((item) => cleanString(item, 180)).filter(Boolean)]
        if (typeof child === 'object') return [cleanKey, sanitizeMetadata(child, depth + 1)]
        return [cleanKey, cleanString(String(child), 240)]
      })
      .filter(Boolean)
  )
}

function buildAccountEventPayload(ref, event = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  return {
    eventId: ref.id,
    type: cleanEventType(event.type),
    severity: cleanSeverity(event.severity),
    title: cleanString(event.title || 'Account update', 160),
    summary: cleanString(event.summary || event.message || '', 1000),
    message: cleanString(event.message || '', 1000),
    actorUid: cleanString(event.actorUid || '', 180),
    actorUsername: cleanString(event.actorUsername || '', 180),
    actorType: cleanString(event.actorType || 'system', 80),
    source: cleanString(event.source || 'backend', 120),
    path: cleanString(event.path || '', 900),
    ipHash: cleanString(event.ipHash || '', 120),
    userAgentSummary: cleanString(event.userAgentSummary || '', 180),
    emailSent: event.emailSent === true,
    emailSentAt: cleanString(event.emailSentAt || '', 80),
    emailSkipped: event.emailSkipped === true,
    emailSkipReason: cleanString(event.emailSkipReason || '', 240),
    emailError: cleanString(event.emailError || '', 240),
    metadata: sanitizeMetadata(event.metadata || {}),
    metadataSafe: sanitizeMetadata(event.metadataSafe || event.metadata || {}),
    createdAt: now,
    readAt: null
  }
}

function accountEventRef(firestore, uid = '') {
  const clean = cleanUid(uid)
  if (!clean) return null
  return firestore.collection('users').doc(clean).collection('accountEvents').doc()
}

async function writeAccountEvent(firestore, uid = '', event = {}) {
  const ref = accountEventRef(firestore, uid)
  if (!ref) return ''
  await ref.set(buildAccountEventPayload(ref, event))
  return ref.id
}

function writeAccountEventToBatch(firestore, batch, uid = '', event = {}) {
  const ref = accountEventRef(firestore, uid)
  if (!ref || !batch) return ''
  batch.set(ref, buildAccountEventPayload(ref, event))
  return ref.id
}

module.exports = {
  ACCOUNT_EVENT_TYPES,
  writeAccountEvent,
  writeAccountEventToBatch
}
