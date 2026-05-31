import { formatUsername as formatUsernameValue } from './format'

function humanize(value = '') {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

const LABELS = {
  review_pending: 'Review Pending',
  pending_manual_review: 'Pending Manual Review',
  pending_ai_review: 'AI Review',
  needs_changes: 'Needs Changes',
  ai_error: 'AI Error',
  ai_failed: 'AI Error',
  failed_ai_auth: 'AI Auth Failed',
  request_changes: 'Return for Changes',
  product_review_approve: 'Product Review Approved',
  product_review_reject: 'Product Review Rejected',
  product_review_request_changes: 'Product Returned for Changes',
  product_review_keep_pending: 'Product Kept Pending',
  owner: 'Owner',
  admin: 'Admin',
  marketplaceReviewer: 'Marketplace Reviewer',
  listingEditor: 'Listing Editor'
}

export function formatActionLabel(value = '') {
  const text = String(value || '').trim()
  return LABELS[text] || humanize(text)
}

export function formatStatusLabel(value = '') {
  return formatActionLabel(value)
}

export function formatVisibilityLabel(value = '') {
  return formatActionLabel(value)
}

export function formatReviewJobStatus(value = '') {
  return formatActionLabel(value)
}

export function formatModerationStatus(value = '') {
  return formatActionLabel(value)
}

export function formatRoleLabel(value = '') {
  return formatActionLabel(value)
}

export function formatUsername(username = '') {
  return formatUsernameValue(username)
}

export function formatMoney(cents = 0, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100)
  } catch {
    return `$${(Number(cents || 0) / 100).toFixed(2)}`
  }
}

export function formatDate(value) {
  const date = new Date(value || 0)
  if (Number.isNaN(date.getTime())) return 'Not set'
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatBytes(value = 0) {
  const bytes = Math.max(0, Number(value || 0))
  if (!bytes) return '0 KB'
  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const amount = bytes / (1024 ** index)
  return `${amount >= 10 || index === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[index]}`
}
