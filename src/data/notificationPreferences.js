export const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  content: {
    likes: true,
    comments: true,
    replies: true,
    mentions: true,
    reposts: true,
    follows: true
  },
  community: {
    followedCommunityPosts: false,
    moderatorAlerts: true,
    pinnedPosts: true
  },
  marketplace: {
    purchases: true,
    reviews: true,
    questions: true,
    productUpdates: true
  },
  creator: {
    releaseAlerts: true,
    creatorNews: true,
    collaborationInvites: true,
    projectInvites: true
  },
  inbox: {
    directMessages: true,
    groupMessages: true,
    missedCalls: true,
    incomingCalls: true
  },
  system: {
    securityAlerts: true,
    accountChanges: true,
    moderationNotices: true,
    announcements: true
  },
  delivery: {
    inApp: true,
    email: false,
    push: false,
    marketing: false
  }
})

function mergeBooleanGroup(defaults = {}, incoming = {}) {
  return Object.fromEntries(Object.entries(defaults).map(([key, defaultValue]) => [
    key,
    typeof incoming?.[key] === 'boolean' ? incoming[key] : defaultValue
  ]))
}

export function normalizeNotificationPreferences(existing = {}, legacy = {}) {
  const source = existing && typeof existing === 'object' ? existing : {}
  const normalized = Object.fromEntries(Object.entries(DEFAULT_NOTIFICATION_PREFERENCES).map(([group, defaults]) => [
    group,
    mergeBooleanGroup(defaults, source[group])
  ]))

  if (typeof legacy.replies === 'boolean' && typeof source.content?.replies !== 'boolean') normalized.content.replies = legacy.replies
  if (typeof legacy.productUpdates === 'boolean' && typeof source.marketplace?.productUpdates !== 'boolean') normalized.marketplace.productUpdates = legacy.productUpdates
  if (typeof legacy.creatorNews === 'boolean' && typeof source.creator?.creatorNews !== 'boolean') normalized.creator.creatorNews = legacy.creatorNews
  if (typeof legacy.releaseAlerts === 'boolean' && typeof source.creator?.releaseAlerts !== 'boolean') normalized.creator.releaseAlerts = legacy.releaseAlerts
  if (typeof legacy.marketing === 'boolean' && typeof source.delivery?.marketing !== 'boolean') normalized.delivery.marketing = legacy.marketing

  return normalized
}

export function notificationPreferenceForEvent(event = {}) {
  const type = String(event.type || '').toLowerCase()
  if (type.includes('mention')) return ['content', 'mentions']
  if (type.includes('follow')) return ['content', 'follows']
  if (type.includes('reply')) return ['content', 'replies']
  if (type.includes('comment') && type.includes('like')) return ['content', 'likes']
  if (type.includes('comment')) return ['content', 'comments']
  if (type.includes('like')) return ['content', 'likes']
  if (type.includes('repost') || type.includes('share')) return ['content', 'reposts']
  return null
}

export function contentViewForNotification(event = {}) {
  const preference = notificationPreferenceForEvent(event)
  if (!preference) return ''
  const key = preference[1]
  if (key === 'follows') return 'follows'
  if (key === 'comments' || key === 'replies') return 'comments'
  if (key === 'mentions') return 'mentions'
  if (key === 'likes') return 'likes'
  return ''
}

export function notificationIsEnabled(event = {}, preferences = DEFAULT_NOTIFICATION_PREFERENCES) {
  if (preferences?.delivery?.inApp === false) return false
  const preference = notificationPreferenceForEvent(event)
  if (!preference) return true
  return preferences?.[preference[0]]?.[preference[1]] !== false
}
