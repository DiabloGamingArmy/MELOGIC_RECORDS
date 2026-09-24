function hasMeaningfulPostText({ title = '', body = '' } = {}) {
  return Boolean(String(title || '').trim() || String(body || '').trim())
}

function hasValidImageAttachment(attachments = []) {
  return (Array.isArray(attachments) ? attachments : []).some((attachment) => attachment?.type === 'image')
}

function hasSufficientPostContent({ title = '', body = '', attachments = [] } = {}) {
  return hasMeaningfulPostText({ title, body }) || hasValidImageAttachment(attachments)
}

module.exports = {
  hasMeaningfulPostText,
  hasValidImageAttachment,
  hasSufficientPostContent
}
