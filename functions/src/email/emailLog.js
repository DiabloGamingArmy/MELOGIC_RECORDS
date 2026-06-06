const admin = require('firebase-admin')
const crypto = require('node:crypto')

function cleanString(value = '', max = 1000) {
  return String(value || '').trim().slice(0, max)
}

function domainOf(email = '') {
  return String(email || '').split('@')[1] || ''
}

function redactedError(error) {
  return cleanString(error?.code || error?.message || 'email-send-failed', 240)
}

function stripHtml(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function hashBody(value = '') {
  const body = String(value || '')
  if (!body) return ''
  return crypto.createHash('sha256').update(body).digest('hex')
}

function searchTokensFor(values = []) {
  const tokens = new Set()
  values.forEach((value) => {
    String(value || '')
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .split(/[^a-z0-9@._-]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2 && token.length <= 80)
      .forEach((token) => {
        tokens.add(token)
        if (token.includes('@')) tokens.add(token.split('@')[1] || '')
      })
  })
  return Array.from(tokens).filter(Boolean).slice(0, 120)
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
  relatedReportId = '',
  cc = [],
  templateName = '',
  body = '',
  provider = '',
  providerMessageId = '',
  status = 'created',
  error = null,
  metadata = {}
} = {}) {
  const db = admin.firestore()
  const ref = db.collection('emailLogs').doc()
  const renderedHtml = cleanString(metadata.renderedHtml || metadata.htmlPreview || '', 20000)
  const plainText = cleanString(metadata.plainText || body || stripHtml(renderedHtml), 10000)
  const finalSubject = cleanString(metadata.finalSubject || subject, 220)
  const templateType = cleanString(metadata.templateType || metadata.template || '', 120)
  const payload = {
    emailId: ref.id,
    to: cleanString(to, 320),
    toDomain: cleanString(domainOf(to), 160),
    recipientDomain: cleanString(domainOf(to), 160),
    ccDomains: Array.isArray(cc) ? cc.map((email) => cleanString(domainOf(email), 160)).filter(Boolean).slice(0, 10) : [],
    subject: finalSubject,
    category: cleanString(category, 80),
    templateName: cleanString(templateName || templateType || metadata?.source || '', 120),
    templateType,
    finalSubject,
    sentByUid: cleanString(sentByUid, 180),
    sentByUsername: cleanString(sentByUsername, 180),
    relatedUid: cleanString(relatedUid, 180),
    relatedProductId: cleanString(relatedProductId, 180),
    relatedOrderId: cleanString(relatedOrderId, 180),
    relatedReportId: cleanString(relatedReportId, 180),
    bodyHash: hashBody(plainText || body),
    bodyPreview: cleanString(plainText || body || stripHtml(renderedHtml), 220),
    renderedHtml,
    htmlPreview: renderedHtml,
    plainText,
    ctaLabel: cleanString(metadata.ctaLabel || '', 120),
    ctaUrl: cleanString(metadata.ctaUrl || '', 900),
    provider: cleanString(provider, 80),
    providerMessageId: cleanString(providerMessageId, 260),
    status: cleanString(status, 80),
    metadata,
    searchTokens: searchTokensFor([
      to,
      domainOf(to),
      subject,
      finalSubject,
      category,
      status,
      sentByUid,
      sentByUsername,
      relatedUid,
      relatedProductId,
      relatedOrderId,
      relatedReportId,
      provider,
      providerMessageId,
      templateName,
      templateType,
      plainText
    ]),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    sentAt: status === 'sent' ? admin.firestore.FieldValue.serverTimestamp() : null,
    failedAt: status === 'failed' ? admin.firestore.FieldValue.serverTimestamp() : null,
    errorCode: error ? cleanString(error.code || '', 120) : '',
    errorMessageRedacted: error ? redactedError(error) : ''
  }
  await ref.set(payload)
  return ref.id
}

module.exports = {
  writeEmailLog
}
