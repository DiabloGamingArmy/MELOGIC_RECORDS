export function hasMeaningfulPostText({ title = '', body = '' } = {}) {
  return Boolean(String(title || '').trim() || String(body || '').trim())
}

export function hasValidImageDraft(fileAttachments = []) {
  return (Array.isArray(fileAttachments) ? fileAttachments : []).some((attachment) => (
    attachment?.type === 'image'
    && attachment?.file
    && attachment.status === 'ready'
  ))
}

export function canPublishCommunityPost({ title = '', body = '', fileAttachments = [], submitting = false } = {}) {
  return !submitting && (hasMeaningfulPostText({ title, body }) || hasValidImageDraft(fileAttachments))
}
