const admin = require('firebase-admin')

function cleanString(value = '', max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function domainOf(email = '') {
  return String(email || '').split('@')[1] || ''
}

function redactedError(error) {
  return cleanString(error?.code || error?.message || 'email-send-failed', 240)
}

async function writeEmailLog({
  to = '',
  subject = '',
  category = '',
  sentByUid = '',
  sentByUsername = '',
  relatedUid = '',
  relatedProductId = '',
  relatedOrderId = '',
  provider = '',
  providerMessageId = '',
  status = 'created',
  error = null,
  metadata = {}
} = {}) {
  const db = admin.firestore()
  const ref = db.collection('emailLogs').doc()
  const payload = {
    emailId: ref.id,
    to: cleanString(to, 320),
    recipientDomain: cleanString(domainOf(to), 160),
    subject: cleanString(subject, 220),
    category: cleanString(category, 80),
    sentByUid: cleanString(sentByUid, 180),
    sentByUsername: cleanString(sentByUsername, 180),
    relatedUid: cleanString(relatedUid, 180),
    relatedProductId: cleanString(relatedProductId, 180),
    relatedOrderId: cleanString(relatedOrderId, 180),
    provider: cleanString(provider, 80),
    providerMessageId: cleanString(providerMessageId, 260),
    status: cleanString(status, 80),
    metadata,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sentAt: status === 'sent' ? admin.firestore.FieldValue.serverTimestamp() : null,
    errorCode: error ? cleanString(error.code || '', 120) : '',
    errorMessageRedacted: error ? redactedError(error) : ''
  }
  await ref.set(payload)
  return ref.id
}

module.exports = {
  writeEmailLog
}
