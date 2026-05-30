const admin = require('firebase-admin')
const { cleanString } = require('./adminAuth')

function db() {
  return admin.firestore()
}

function safeScalar(value) {
  if (value === null || value === undefined) return null
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') return cleanString(value, 900)
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  return cleanString(JSON.stringify(value), 900)
}

function safeSummary(value, depth = 0) {
  if (depth > 2) return safeScalar(value)
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => safeSummary(item, depth + 1))
  if (value && typeof value === 'object' && typeof value.toDate !== 'function') {
    return Object.keys(value).sort().slice(0, 40).reduce((summary, key) => {
      summary[cleanString(key, 80)] = safeSummary(value[key], depth + 1)
      return summary
    }, {})
  }
  return safeScalar(value)
}

function buildAdminAuditLogEntry({
  actorUid = '',
  actorEmail = '',
  actorRole = '',
  action = '',
  targetType = '',
  targetId = '',
  targetPath = '',
  reason = '',
  before = null,
  after = null,
  metadata = {}
} = {}) {
  return {
    actorUid: cleanString(actorUid, 180),
    actorEmail: cleanString(actorEmail, 320),
    actorRole: cleanString(actorRole, 80),
    action: cleanString(action, 120),
    targetType: cleanString(targetType, 80),
    targetId: cleanString(targetId, 180),
    targetPath: cleanString(targetPath, 360),
    reason: cleanString(reason, 1200),
    before: safeSummary(before),
    after: safeSummary(after),
    metadata: safeSummary(metadata),
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }
}

async function writeAdminAuditLog(input = {}) {
  const ref = db().collection('adminLogs').doc()
  await ref.set({
    id: ref.id,
    ...buildAdminAuditLogEntry(input)
  })
  return ref.id
}

module.exports = {
  buildAdminAuditLogEntry,
  writeAdminAuditLog,
  __test: {
    safeSummary
  }
}
