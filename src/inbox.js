import './styles/base.css'
import './styles/inbox.css'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute } from './utils/routes'
import { storage } from './firebase/storage'
import { STORAGE_PATHS } from './config/storagePaths'
import {
  addParticipantsToThread,
  createGroupThread,
  createOrGetDm,
  listInboxThreads,
  loadProfilesByUids,
  markThreadDelivered,
  markThreadRead,
  removeParticipantFromThread,
  sendMessage,
  setTypingState,
  subscribeToInboxThreads,
  subscribeToMessages,
  subscribeToThreadParticipants,
  subscribeToTypingState,
  updateThreadDetails
} from './data/inboxService'
import { searchProfilesByUsername } from './data/profileSearchService'
import { markSystemNotificationRead, subscribeToSystemNotifications } from './data/systemNotificationService'

const app = document.querySelector('#app')

const inboxFilters = ['Messages', 'Calls', 'Likes', 'Follows', 'Comments', 'Mentions', 'System']

const activityCopy = {
  Calls: {
    title: 'Calls',
    emptyTitle: 'No calls yet.',
    emptyBody: 'Calls are out of scope for this pass and will be added later.'
  },
  Likes: {
    title: 'Likes',
    emptyTitle: 'No likes yet.',
    emptyBody: 'New likes on your products and profile activity will appear here.'
  },
  Follows: {
    title: 'Follows',
    emptyTitle: 'No new follows yet.',
    emptyBody: 'When someone follows your profile, it will show up here.'
  },
  Comments: {
    title: 'Comments',
    emptyTitle: 'No comments yet.',
    emptyBody: 'Replies and comments tied to your content will appear here.'
  },
  Mentions: {
    title: 'Mentions',
    emptyTitle: 'No mentions yet.',
    emptyBody: 'Mentions from group threads and community spaces will appear here.'
  },
  System: {
    title: 'System',
    emptyTitle: 'No notifications yet.',
    emptyBody: 'Important platform notices and updates will appear here.'
  }
}

const appState = {
  user: null,
  isLoadingThreads: false,
  threads: [],
  selectedThreadId: '',
  messagesByThreadId: {},
  participantsByThreadId: {},
  typingUsersByThreadId: {},
  loadingMessageThreadId: '',
  activeFilter: 'Messages',
  threadUnsubscribe: () => {},
  messageUnsubscribe: () => {},
  participantsUnsubscribe: () => {},
  typingUnsubscribe: () => {},
  errorMessage: '',
  isCreateChatOpen: false,
  chatSearchQuery: '',
  chatSearchResults: [],
  selectedChatUsers: [],
  isSearchingUsers: false,
  isCreatingChat: false,
  createChatError: '',
  chatSearchRequestId: 0,
  composerDraftByThreadId: {},
  profileByUid: {},
  warnedRealtimePermissions: {},
  warnedSystemPermissions: false,
  systemNotifications: [],
  systemFilter: 'all',
  systemUnsubscribe: () => {},
  isChatSettingsOpen: false,
  chatSettingsError: '',
  isSavingChatSettings: false,
  chatSettingsDraftTitle: '',
  chatSettingsImageFile: null,
  chatSettingsSearchQuery: '',
  chatSettingsSearchResults: [],
  isSearchingChatSettingsUsers: false,
  attachmentDraftByThreadId: {},
  threadsRealtimeReady: false,
  threadsFallbackTried: false,
  threadsFallbackPending: false,
  hasLoadedThreadsOnce: false
}

let searchDebounceTimer = null
let typingStopTimer = null
let activeTypingThreadId = ''
let chatSettingsSearchSelection = { start: null, end: null }
let hasInitializedAuthObserver = false
let activeThreadSubscriptionUid = ''
let processedStartUid = ''

app.innerHTML = `
  ${navShell({ currentPage: 'inbox' })}
  <main>
    <section class="inbox-main-shell">
      <div class="inbox-app-shell" data-inbox-root>
        <article class="inbox-auth-card">
          <h2>Loading inbox…</h2>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()
document.body.classList.add('is-inbox-page')

const inboxRoot = document.querySelector('[data-inbox-root]')
const modalRoot = document.createElement('div')
modalRoot.className = 'create-chat-modal-root'
document.body.append(modalRoot)

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getInitials(user = {}) {
  const source = user.displayName || user.username || user.title || '?'
  return source
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function getProfileMeta(uid, fallback = {}) {
  const profile = appState.profileByUid[uid] || {}
  const displayName = String(profile.displayName || fallback.displayName || '').trim()
  const username = String(profile.username || fallback.username || '').trim()
  const avatarURL = String(profile.avatarURL || profile.photoURL || fallback.avatarURL || fallback.photoURL || '').trim()
  const preferred = displayName || username || fallback.title || (uid ? `User ${String(uid).slice(0, 2).toUpperCase()}` : 'Member')
  return { uid, displayName: preferred, username, avatarURL, photoURL: avatarURL }
}

async function hydrateProfilesForThread(thread) {
  if (!thread) return
  const ids = Array.isArray(thread.participantIds) ? thread.participantIds : []
  if (!ids.length) return
  const loaded = await loadProfilesByUids(ids)
  appState.profileByUid = { ...appState.profileByUid, ...loaded }
  if (appState.selectedThreadId === thread.id) renderSignedInState()
}

function warnRealtimePermission(key, error) {
  if (appState.warnedRealtimePermissions[key]) return
  appState.warnedRealtimePermissions[key] = true
  console.warn('Inbox realtime permission warning:', error?.code || error?.message || error)
}

function warnSystemPermission(error) {
  if (appState.warnedSystemPermissions) return
  appState.warnedSystemPermissions = true
  console.warn('System notification permission warning:', error?.code || error?.message || error)
}

function formatTime(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatThreadTimestamp(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return formatTime(value)

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function formatDaySeparator(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return 'Today'
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}

function getSelectedThread() {
  return appState.threads.find((thread) => thread.id === appState.selectedThreadId) || null
}

function getThreadParticipants(threadId) {
  return appState.participantsByThreadId[threadId] || []
}

function getTypingUsers(threadId) {
  const all = appState.typingUsersByThreadId[threadId] || []
  const now = Date.now()
  return all.filter((entry) => {
    if (!entry?.uid || entry.uid === appState.user?.uid) return false
    const stamp = entry.updatedAt ? new Date(entry.updatedAt).getTime() : 0
    return stamp && now - stamp < 7000
  })
}

function clearRealtimeListeners() {
  appState.threadUnsubscribe()
  appState.messageUnsubscribe()
  appState.participantsUnsubscribe()
  appState.typingUnsubscribe()
  appState.systemUnsubscribe()
  appState.threadUnsubscribe = () => {}
  appState.messageUnsubscribe = () => {}
  appState.participantsUnsubscribe = () => {}
  appState.typingUnsubscribe = () => {}
  appState.systemUnsubscribe = () => {}
  appState.threadsFallbackPending = false
  appState.hasLoadedThreadsOnce = false
  activeThreadSubscriptionUid = ''
}

function clearTypingForThread(threadId) {
  if (!threadId || !appState.user?.uid) return
  setTypingState({ threadId, uid: appState.user.uid, isTyping: false }).catch((error) => {
    warnRealtimePermission(`typing-write-${threadId}`, error)
  })
}

function resetCreateChatState() {
  appState.isCreateChatOpen = false
  appState.chatSearchQuery = ''
  appState.chatSearchResults = []
  appState.selectedChatUsers = []
  appState.isSearchingUsers = false
  appState.isCreatingChat = false
  appState.createChatError = ''
  appState.chatSearchRequestId += 1
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)
  searchDebounceTimer = null
}

function openCreateChatModal() {
  appState.isCreateChatOpen = true
  appState.createChatError = ''
  renderCreateChatModal()
}

function closeCreateChatModal() {
  resetCreateChatState()
  renderCreateChatModal()
}

function getMessagesSidebarMarkup() {
  const filterMarkup = inboxFilters
    .map(
      (filter) => `
        <button type="button" class="inbox-filter ${appState.activeFilter === filter ? 'is-active' : ''}" data-inbox-filter="${filter}">
          <span>${filter}</span>
        </button>
      `
    )
    .join('')

  return `
    <div class="inbox-panel-title">
      <h2>Inbox</h2>
      <p>Messages and activity</p>
    </div>
    <div class="inbox-filters" data-inbox-filters>${filterMarkup}</div>
    ${getRecentThreadsSidebarMarkup()}
  `
}

function getRecentThreadsSidebarMarkup() {
  const isMessages = appState.activeFilter === 'Messages'

  if (appState.isLoadingThreads && isMessages) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <div class="sidebar-recent-list">
          <div class="sidebar-thread-pill is-skeleton"></div>
          <div class="sidebar-thread-pill is-skeleton"></div>
          <div class="sidebar-thread-pill is-skeleton"></div>
        </div>
      </section>
    `
  }

  if (isMessages && (!appState.threadsRealtimeReady || appState.threadsFallbackPending) && !appState.threadsFallbackTried) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Loading conversations…</p>
      </section>
    `
  }

  if (!isMessages) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Open Messages to access recent direct and group chats.</p>
      </section>
    `
  }

  if (!appState.threads.length && appState.hasLoadedThreadsOnce) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">No conversations yet.</p>
      </section>
    `
  }

  if (!appState.threads.length) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Loading conversations…</p>
      </section>
    `
  }

  const pills = appState.threads
    .slice(0, 4)
    .map((thread) => {
      const isActive = appState.selectedThreadId === thread.id
      return `
      <button type="button" class="sidebar-thread-pill ${isActive ? 'is-active' : ''}" data-thread-id="${thread.id}">
        <strong>${escapeHtml(thread.title)}</strong>
        ${thread.type === 'group' ? '<small>Group</small>' : '<small>Direct</small>'}
      </button>
    `
    })
    .join('')

  return `
    <section class="sidebar-recent-block">
      <p class="sidebar-label">Recent threads</p>
      <div class="sidebar-recent-list">${pills}</div>
    </section>
  `
}

function getConversationSubtitle(thread) {
  if (!thread) return 'No thread selected'
  const typingUsers = getTypingUsers(thread.id)
  if (typingUsers.length === 1) {
    const typingUser = getProfileMeta(typingUsers[0].uid, typingUsers[0])
    return `${typingUser.displayName || typingUser.username || 'Someone'} is typing…`
  }
  if (typingUsers.length > 1) return 'Several people are typing…'

  if (thread.type === 'group') {
    return `${Math.max(1, Number(thread.participantCount || thread.participantIds?.length || 0))} members`
  }

  const participants = getThreadParticipants(thread.id).filter((entry) => entry.uid !== appState.user?.uid)
  const other = participants[0]
  if (other?.lastReadAt) return `Seen ${formatTime(other.lastReadAt)}`
  if (other?.lastDeliveredAt) return 'Active recently'
  return 'Direct message'
}

function groupMessages(messages = []) {
  const groups = []
  let lastDateKey = ''

  messages.forEach((message) => {
    const createdAt = message.createdAt || ''
    const dateKey = createdAt ? new Date(createdAt).toDateString() : 'unknown'
    if (dateKey !== lastDateKey) {
      groups.push({ kind: 'separator', id: `sep-${createdAt || Math.random()}`, label: createdAt ? formatDaySeparator(createdAt) : 'Earlier' })
      lastDateKey = dateKey
    }

    const prev = groups[groups.length - 1]
    const prevGroup = prev?.kind === 'messages' ? prev : null
    const sameSender = prevGroup && prevGroup.senderId === message.senderId
    const closeInTime = (() => {
      if (!sameSender) return false
      const last = prevGroup.messages[prevGroup.messages.length - 1]
      const a = new Date(last.createdAt || 0).getTime()
      const b = new Date(message.createdAt || 0).getTime()
      return b - a < 5 * 60 * 1000
    })()

    if (sameSender && closeInTime) {
      prevGroup.messages.push(message)
      return
    }

    groups.push({ kind: 'messages', id: `group-${message.id}`, senderId: message.senderId, messages: [message] })
  })

  return groups
}

function getParticipantMeta(thread, uid) {
  const participants = getThreadParticipants(thread.id)
  const direct = participants.find((entry) => entry.uid === uid)
  if (direct) return getProfileMeta(uid, direct)

  if (thread.type === 'dm' && uid !== appState.user?.uid) {
    return getProfileMeta(uid, {
      uid,
      displayName: thread.title,
      avatarURL: thread.imageURL,
      username: ''
    })
  }

  return getProfileMeta(uid, { uid, displayName: uid === appState.user?.uid ? 'You' : 'Member', title: thread.title })
}

function getOutgoingStatusLabel(thread, message) {
  const participants = getThreadParticipants(thread.id).filter((entry) => entry.uid && entry.uid !== appState.user?.uid)
  const createdAt = new Date(message.createdAt || 0).getTime()
  if (!createdAt || !participants.length) return `Sent · ${formatTime(message.createdAt)}`

  if (thread.type === 'group') {
    const seenBy = participants.filter((entry) => entry.lastReadAt && new Date(entry.lastReadAt).getTime() >= createdAt).length
    if (seenBy > 0) return `Seen by ${seenBy} · ${formatTime(message.createdAt)}`
    return `Sent · ${formatTime(message.createdAt)}`
  }

  const other = participants[0]
  const readAt = other?.lastReadAt ? new Date(other.lastReadAt).getTime() : 0
  if (readAt >= createdAt) return `Read ${formatTime(other.lastReadAt)}`
  const deliveredAt = other?.lastDeliveredAt ? new Date(other.lastDeliveredAt).getTime() : 0
  if (deliveredAt >= createdAt) return `Delivered · ${formatTime(message.createdAt)}`
  return `Sent · ${formatTime(message.createdAt)}`
}

function getMessageGroupsMarkup(thread) {
  const messages = appState.messagesByThreadId[thread.id] || []
  if (!messages.length) {
    return `
      <section class="inbox-empty-panel inbox-empty-panel-inline">
        <h3>No messages yet.</h3>
        <p>Start this conversation with your first message.</p>
      </section>
    `
  }

  const grouped = groupMessages(messages)
  const messageGroups = grouped
    .map((entry, index) => {
      if (entry.kind === 'separator') {
        return `<p class="message-date-separator"><span>${escapeHtml(entry.label)}</span></p>`
      }

      const isSelf = entry.senderId === appState.user?.uid
      const sender = getParticipantMeta(thread, entry.senderId)
      const lastMessage = entry.messages[entry.messages.length - 1]
      const isLatestOutgoingGroup = isSelf && [...grouped].reverse().find((item) => item.kind === 'messages' && item.senderId === appState.user?.uid)?.id === entry.id
      const statusLine = isLatestOutgoingGroup ? `<p class="message-status-line">${escapeHtml(getOutgoingStatusLabel(thread, lastMessage))}</p>` : `<p class="message-status-line is-muted">${escapeHtml(formatTime(lastMessage.createdAt))}</p>`
      const avatarMarkup = !isSelf
        ? `<div class="cluster-avatar ${sender.avatarURL || sender.photoURL ? 'has-image' : ''}">${sender.avatarURL || sender.photoURL ? `<img src="${escapeHtml(sender.avatarURL || sender.photoURL)}" alt="" />` : `<span>${getInitials(sender)}</span>`}</div>`
        : '<div class="cluster-avatar-spacer" aria-hidden="true"></div>'

      const bubbles = entry.messages
        .map((message, messageIndex) => {
          const isFirst = messageIndex === 0
          const isLast = messageIndex === entry.messages.length - 1
          const attachmentsMarkup = Array.isArray(message.attachments) && message.attachments.length
            ? `<div class="message-attachment-list">${message.attachments.map((attachment) => {
              const mime = String(attachment.mimeType || '')
              if (mime.startsWith('image/')) return `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name || 'Image attachment')}" loading="lazy" /></a>`
              if (mime.startsWith('video/')) return `<video src="${escapeHtml(attachment.url)}" controls preload="metadata"></video>`
              if (mime.startsWith('audio/')) return `<audio src="${escapeHtml(attachment.url)}" controls></audio>`
              return `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener" class="message-file-link">${escapeHtml(attachment.name || 'Download attachment')}</a>`
            }).join('')}</div>`
            : ''
          return `
            <article class="message-bubble ${isFirst ? 'is-first' : ''} ${isLast ? 'is-last' : ''} ${message.deleted ? 'is-deleted' : ''}">
              <p>${escapeHtml(message.deleted ? 'Message removed.' : message.body)}</p>
              ${attachmentsMarkup}
            </article>
          `
        })
        .join('')

      return `
        <div class="message-cluster ${isSelf ? 'is-self' : 'is-other'}" data-index="${index}">
          ${avatarMarkup}
          <div class="message-cluster-body">
            ${!isSelf ? `<p class="cluster-sender">${escapeHtml(sender.displayName || sender.username || 'Member')}</p>` : ''}
            <div class="message-bubble-stack">${bubbles}</div>
            ${statusLine}
          </div>
        </div>
      `
    })
    .join('')

  return `<div class="message-list" data-message-list>${messageGroups}</div>`
}

function getConversationBodyMarkup() {
  const thread = getSelectedThread()
  if (!thread) {
    return `
      <section class="inbox-empty-panel">
        <h3>Select a conversation</h3>
        <p>Choose a thread from Messages to view and send messages.</p>
      </section>
    `
  }

  const isLoading = appState.loadingMessageThreadId === thread.id
  if (isLoading) {
    return `
      <section class="inbox-empty-panel">
        <h3>Loading messages…</h3>
        <p>Fetching latest conversation history.</p>
      </section>
    `
  }

  const draft = appState.composerDraftByThreadId[thread.id] || ''
  const attachments = appState.attachmentDraftByThreadId[thread.id] || []
  const typingUsers = getTypingUsers(thread.id)

  return `
    <div class="conversation-stack">
      ${getMessageGroupsMarkup(thread)}
      ${typingUsers.length ? `<p class="typing-indicator">${escapeHtml(getConversationSubtitle(thread))}</p>` : ''}
      <form class="message-composer" data-message-form>
        <label class="sr-only" for="message-input">Message</label>
        ${attachments.length ? `<div class="composer-attachment-list">${attachments.map((file, index) => `<article class="composer-attachment-chip"><span>${escapeHtml(file.name || 'Attachment')}</span><button type="button" data-remove-attachment="${index}" aria-label="Remove attachment">×</button></article>`).join('')}</div>` : ''}
        <textarea id="message-input" name="message" rows="2" maxlength="1200" placeholder="Write a message..." required>${escapeHtml(draft)}</textarea>
        <input type="file" class="composer-attachment-input" data-attachment-input multiple accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.txt" />
        <div class="message-composer-footer">
          ${appState.errorMessage ? `<p class="composer-error">${escapeHtml(appState.errorMessage)}</p>` : '<span></span>'}
          <div class="composer-actions">
            <button type="button" class="button button-muted" data-action="attach-file" aria-label="Attach files">+</button>
            <button type="submit" class="button button-accent" ${(!draft.trim() && !attachments.length) ? 'disabled' : ''}>Send</button>
          </div>
        </div>
      </form>
    </div>
  `
}

function getMessagesThreadListMarkup() {
  if (appState.isLoadingThreads) {
    const skeleton = Array.from({ length: 5 })
      .map(
        () => `
          <article class="thread-row is-skeleton" aria-hidden="true">
            <div class="thread-avatar"></div>
            <div class="thread-meta">
              <div class="thread-line"></div>
              <div class="thread-line thread-line-short"></div>
            </div>
          </article>
        `
      )
      .join('')

    return `<div class="inbox-thread-list">${skeleton}</div>`
  }

  if (!appState.threads.length) {
    return `
      <div class="inbox-thread-list is-empty">
        <p>No conversations yet.</p>
        <p>Start a direct message or create a group conversation.</p>
      </div>
    `
  }

  const rows = appState.threads
    .map((thread) => {
      const initials = getInitials({ title: thread.title })
      const isActive = thread.id === appState.selectedThreadId
      const unread = Number(thread.unreadCount || 0)

      return `
        <button class="thread-row ${isActive ? 'is-active' : ''}" type="button" data-thread-id="${thread.id}">
          <div class="thread-avatar ${thread.imageURL ? 'has-image' : ''}">
            ${thread.imageURL ? `<img src="${escapeHtml(thread.imageURL)}" alt="" />` : `<span>${initials || '?'}</span>`}
          </div>
          <div class="thread-meta">
            <div class="thread-title-row">
              <strong>${escapeHtml(thread.title)}</strong>
              <span>${escapeHtml(formatThreadTimestamp(thread.lastMessageAt || thread.updatedAt || thread.createdAt))}</span>
            </div>
            <div class="thread-preview-row">
              <p>${escapeHtml(thread.subtitle || 'No messages yet.')}</p>
              ${unread > 0 ? `<small class="thread-unread">${unread > 9 ? '9+' : unread}</small>` : thread.type === 'group' ? '<small class="thread-badge">Group</small>' : ''}
            </div>
          </div>
        </button>
      `
    })
    .join('')

  return `<div class="inbox-thread-list">${rows}</div>`
}

function getFilterContentMarkup(filterName) {
  if (filterName === 'System') {
    const filterOptions = [
      { key: 'all', label: 'All' },
      { key: 'product_release', label: 'Product releases' },
      { key: 'account', label: 'Account' },
      { key: 'security', label: 'Security' },
      { key: 'other', label: 'Other' }
    ]
    const rows = appState.systemNotifications.filter((item) => appState.systemFilter === 'all' || item.type === appState.systemFilter)
    return `
      <section class="activity-panel">
        <header class="panel-header activity-header">
          <h3>System</h3>
          <p>Account and product notifications</p>
        </header>
        <div class="system-filter-row">
          ${filterOptions.map((option) => `<button type="button" class="inbox-filter ${appState.systemFilter === option.key ? 'is-active' : ''}" data-system-filter="${option.key}">${option.label}</button>`).join('')}
        </div>
        ${rows.length ? `
          <div class="system-notification-list">
            ${rows.map((item) => `
              <article class="system-notification-card" data-system-id="${item.id}">
                <p class="system-notification-title">${escapeHtml(item.title)}</p>
                <p>${escapeHtml(item.body)}</p>
                <small>${escapeHtml(formatThreadTimestamp(item.createdAt))} · ${escapeHtml(item.severity)}</small>
                ${item.actionHref ? `<a class="button button-muted" href="${escapeHtml(item.actionHref)}">Open</a>` : ''}
              </article>
            `).join('')}
          </div>
        ` : `
          <section class="inbox-empty-panel activity-empty-panel">
            <h3>No notifications yet.</h3>
            <p>Important platform notices and updates will appear here.</p>
          </section>
        `}
      </section>
    `
  }

  const copy = activityCopy[filterName] || {
    title: filterName,
    emptyTitle: `No ${String(filterName).toLowerCase()} yet.`,
    emptyBody: 'New activity will appear here.'
  }

  return `
    <section class="activity-panel">
      <header class="panel-header activity-header">
        <h3>${escapeHtml(copy.title)}</h3>
        <p>Inbox activity category</p>
      </header>
      <section class="inbox-empty-panel activity-empty-panel">
        <h3>${escapeHtml(copy.emptyTitle)}</h3>
        <p>${escapeHtml(copy.emptyBody)}</p>
      </section>
    </section>
  `
}

function getConversationHeaderMarkup(thread) {
  if (!thread) {
    return `
      <header class="conversation-header">
        <div class="conversation-header-meta">
          <h3>Conversation</h3>
          <p>No thread selected</p>
        </div>
      </header>
    `
  }

  const otherParticipant = (thread.participantIds || []).find((uid) => uid !== appState.user?.uid)
  const headerMeta = thread.type === 'dm' && otherParticipant
    ? getProfileMeta(otherParticipant, { title: thread.title, avatarURL: thread.imageURL })
    : { displayName: thread.title, avatarURL: thread.imageURL }

  return `
    <header class="conversation-header">
      <div class="thread-avatar ${headerMeta.avatarURL ? 'has-image' : ''}">
        ${headerMeta.avatarURL ? `<img src="${escapeHtml(headerMeta.avatarURL)}" alt="" />` : `<span>${getInitials({ title: headerMeta.displayName })}</span>`}
      </div>
      <div class="conversation-header-meta">
        <h3>${escapeHtml(headerMeta.displayName || thread.title)}</h3>
        <p>${escapeHtml(getConversationSubtitle(thread))}</p>
      </div>
      <button type="button" class="chat-settings-trigger" data-action="open-chat-settings" aria-label="Open chat settings">⋯</button>
    </header>
  `
}

function renderMessagesLayout() {
  const selectedThread = getSelectedThread()

  return `
    <div class="inbox-layout inbox-layout-messages">
      <aside class="inbox-sidebar">${getMessagesSidebarMarkup()}</aside>

      <section class="inbox-thread-panel">
        <header class="panel-header panel-header-row">
          <div>
            <h3>Messages</h3>
            <p>Direct and group conversations</p>
          </div>
          <div class="panel-actions">
            <button type="button" class="create-chat-plus" data-action="open-create-chat" aria-label="Create chat">+</button>
          </div>
        </header>
        ${getMessagesThreadListMarkup()}
      </section>

      <section class="inbox-main-panel">
        ${getConversationHeaderMarkup(selectedThread)}
        ${getConversationBodyMarkup()}
      </section>
    </div>
  `
}

function renderActivityLayout(filterName) {
  return `
    <div class="inbox-layout inbox-layout-activity">
      <aside class="inbox-sidebar">${getMessagesSidebarMarkup()}</aside>
      <section class="inbox-main-panel inbox-main-panel-full">
        ${getFilterContentMarkup(filterName)}
      </section>
    </div>
  `
}

function buildGroupTitle(selectedUsers = []) {
  const labels = selectedUsers.map((user) => user.displayName || user.username || 'User').filter(Boolean)
  if (labels.length <= 2) return labels.join(', ')
  return `${labels[0]}, ${labels[1]} + ${labels.length - 2}`
}

function optimisticThreadFromSelection(threadId, selectedUsers, createdType, groupTitle) {
  const participantIds = [appState.user?.uid, ...selectedUsers.map((user) => user.uid)].filter(Boolean)
  const dmUser = selectedUsers[0]

  return {
    id: threadId,
    type: createdType,
    title: createdType === 'dm' ? dmUser?.displayName || dmUser?.username || 'Direct message' : groupTitle || 'New group',
    subtitle: 'No messages yet.',
    formattedTime: 'Now',
    imageURL: createdType === 'dm' ? dmUser?.avatarURL || dmUser?.photoURL || '' : '',
    participantIds,
    participantCount: participantIds.length,
    lastMessageText: '',
    lastMessageAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    lastMessageSenderId: '',
    isGroup: createdType === 'group'
  }
}

async function handleCreateChatSubmit() {
  if (!appState.user?.uid || !appState.selectedChatUsers.length || appState.isCreatingChat) return

  appState.isCreatingChat = true
  appState.createChatError = ''
  renderCreateChatModal()

  try {
    const selectedUsers = [...appState.selectedChatUsers]
    let thread
    let createdType = 'dm'

    if (selectedUsers.length === 1) {
      thread = await createOrGetDm({ creatorId: appState.user.uid, targetUid: selectedUsers[0].uid })
      createdType = 'dm'
    } else {
      const groupTitle = buildGroupTitle(selectedUsers)
      thread = await createGroupThread({
        creatorId: appState.user.uid,
        participantIds: selectedUsers.map((user) => user.uid),
        title: groupTitle
      })
      createdType = 'group'
    }

    const threadId = thread?.id || thread?.threadId
    if (!threadId) throw new Error('Unable to create chat.')
    console.info('[inbox] create/open thread succeeded', threadId)

    if (!appState.threads.some((item) => item.id === threadId)) {
      const optimistic = optimisticThreadFromSelection(threadId, selectedUsers, createdType, buildGroupTitle(selectedUsers))
      appState.threads = [optimistic, ...appState.threads]
    }

    appState.activeFilter = 'Messages'
    appState.selectedThreadId = threadId
    appState.errorMessage = ''
    startMessageSubscription(threadId)
    try {
      const durableThreads = await listInboxThreads(appState.user.uid)
      console.info('[inbox] one-time fallback loaded', durableThreads.length, 'threads')
      appState.threads = durableThreads.length ? durableThreads : appState.threads
      appState.hasLoadedThreadsOnce = true
    } catch (refreshError) {
      warnRealtimePermission(`threads-refresh-after-create-${appState.user.uid}`, refreshError)
    }
    closeCreateChatModal()
    renderSignedInState()
  } catch (error) {
    appState.isCreatingChat = false
    appState.createChatError = error?.message || 'Unable to create chat.'
    renderCreateChatModal()
  }
}

async function runProfileSearch(queryText, requestId) {
  try {
    const result = await searchProfilesByUsername(queryText)
    if (requestId !== appState.chatSearchRequestId) return

    const selectedIds = new Set(appState.selectedChatUsers.map((user) => user.uid))
    appState.chatSearchResults = result.filter((profile) => profile.uid !== appState.user?.uid && !selectedIds.has(profile.uid))
    appState.isSearchingUsers = false
    appState.createChatError = ''
    renderCreateChatModal({ keepSearchFocus: true })
  } catch (error) {
    if (requestId !== appState.chatSearchRequestId) return
    appState.isSearchingUsers = false
    appState.chatSearchResults = []
    appState.createChatError = error?.message || 'Unable to search users.'
    renderCreateChatModal({ keepSearchFocus: true })
  }
}

function scheduleSearch(queryValue) {
  appState.chatSearchQuery = queryValue
  appState.createChatError = ''
  if (searchDebounceTimer) clearTimeout(searchDebounceTimer)

  const normalized = String(queryValue || '').trim().toLowerCase()
  if (normalized.length < 2) {
    appState.isSearchingUsers = false
    appState.chatSearchResults = []
    renderCreateChatModal({ keepSearchFocus: true })
    return
  }

  appState.isSearchingUsers = true
  appState.chatSearchResults = []
  const requestId = appState.chatSearchRequestId + 1
  appState.chatSearchRequestId = requestId
  renderCreateChatModal({ keepSearchFocus: true })

  searchDebounceTimer = setTimeout(() => {
    runProfileSearch(normalized, requestId)
  }, 250)
}

function ensureCreateChatModalShell() {
  if (modalRoot.querySelector('.create-chat-backdrop')) return

  modalRoot.innerHTML = `
    <div class="create-chat-backdrop" data-close-chat-modal>
      <section class="create-chat-modal" role="dialog" aria-modal="true" aria-labelledby="create-chat-title">
        <header class="create-chat-header">
          <h2 id="create-chat-title">Create chat</h2>
          <button type="button" class="create-chat-close" data-close-chat-modal aria-label="Close create chat modal">×</button>
        </header>
        <p class="create-chat-subtitle">Search by username and add people to the conversation.</p>
        <input class="create-chat-search" type="search" placeholder="Search username…" data-chat-search autocomplete="off" />
        <div class="create-chat-selected" data-chat-selected></div>
        <div class="create-chat-results" data-chat-results></div>
        <p class="modal-error" data-chat-error hidden></p>
        <footer class="create-chat-footer">
          <button type="button" class="button button-muted" data-close-chat-modal>Cancel</button>
          <button type="button" class="button button-accent" data-create-chat>Create Chat</button>
        </footer>
      </section>
    </div>
  `

  const backdrop = modalRoot.querySelector('.create-chat-backdrop')
  const modalCard = modalRoot.querySelector('.create-chat-modal')
  const searchInput = modalRoot.querySelector('[data-chat-search]')

  backdrop?.addEventListener('click', (event) => {
    if (event.target === backdrop) closeCreateChatModal()
  })

  modalCard?.addEventListener('click', (event) => {
    event.stopPropagation()
  })

  modalRoot.querySelectorAll('[data-close-chat-modal]').forEach((button) => {
    button.addEventListener('click', () => closeCreateChatModal())
  })

  searchInput?.addEventListener('input', (event) => {
    scheduleSearch(event.target.value)
  })

  modalRoot.querySelector('[data-create-chat]')?.addEventListener('click', async () => {
    await handleCreateChatSubmit()
  })
}

function updateCreateChatModalContent({ keepSearchFocus = false } = {}) {
  const searchInput = modalRoot.querySelector('[data-chat-search]')
  const selectedRoot = modalRoot.querySelector('[data-chat-selected]')
  const resultsRoot = modalRoot.querySelector('[data-chat-results]')
  const errorRoot = modalRoot.querySelector('[data-chat-error]')
  const createButton = modalRoot.querySelector('[data-create-chat]')
  const cancelButtons = modalRoot.querySelectorAll('[data-close-chat-modal]')

  if (!searchInput || !selectedRoot || !resultsRoot || !errorRoot || !createButton) return

  const selectedMarkup = appState.selectedChatUsers.length
    ? appState.selectedChatUsers
        .map(
          (user) => `
      <article class="chat-chip">
        <div class="chat-chip-avatar ${user.avatarURL || user.photoURL ? 'has-image' : ''}">
          ${user.avatarURL || user.photoURL ? `<img src="${escapeHtml(user.avatarURL || user.photoURL)}" alt="" />` : `<span>${getInitials(user)}</span>`}
        </div>
        <div>
          <strong>${escapeHtml(user.displayName || user.username || 'User')}</strong>
          <small>@${escapeHtml(user.username || 'unknown')}</small>
        </div>
        <button type="button" data-remove-selected="${user.uid}" aria-label="Remove user">×</button>
      </article>
    `
        )
        .join('')
    : '<p class="modal-hint">No users selected yet.</p>'

  const resultsStateMarkup = appState.isSearchingUsers
    ? '<p class="modal-hint">Searching…</p>'
    : appState.chatSearchQuery.trim().length < 2
      ? '<p class="modal-hint">Type at least 2 characters to search.</p>'
      : appState.chatSearchResults.length
        ? appState.chatSearchResults
            .map(
              (user) => `
            <button type="button" class="chat-search-row" data-add-user="${user.uid}">
              <div class="chat-chip-avatar ${user.avatarURL || user.photoURL ? 'has-image' : ''}">
                ${user.avatarURL || user.photoURL ? `<img src="${escapeHtml(user.avatarURL || user.photoURL)}" alt="" />` : `<span>${getInitials(user)}</span>`}
              </div>
              <div class="chat-search-meta">
                <strong>${escapeHtml(user.displayName || user.username || 'User')}</strong>
                <small>@${escapeHtml(user.username || 'unknown')}</small>
              </div>
            </button>
          `
            )
            .join('')
        : '<p class="modal-hint">No users found.</p>'

  if (searchInput.value !== appState.chatSearchQuery) searchInput.value = appState.chatSearchQuery
  selectedRoot.innerHTML = selectedMarkup
  resultsRoot.innerHTML = resultsStateMarkup

  errorRoot.textContent = appState.createChatError || ''
  errorRoot.hidden = !appState.createChatError

  createButton.disabled = !appState.selectedChatUsers.length || appState.isCreatingChat
  createButton.textContent = appState.isCreatingChat ? 'Creating…' : 'Create Chat'
  cancelButtons.forEach((button) => {
    button.disabled = appState.isCreatingChat
  })

  resultsRoot.querySelectorAll('[data-add-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.getAttribute('data-add-user')
      const user = appState.chatSearchResults.find((row) => row.uid === uid)
      if (!user || appState.selectedChatUsers.some((row) => row.uid === uid)) return
      appState.selectedChatUsers = [...appState.selectedChatUsers, user]
      appState.chatSearchResults = []
      appState.chatSearchQuery = ''
      appState.isSearchingUsers = false
      updateCreateChatModalContent({ keepSearchFocus: true })
    })
  })

  selectedRoot.querySelectorAll('[data-remove-selected]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.getAttribute('data-remove-selected')
      appState.selectedChatUsers = appState.selectedChatUsers.filter((user) => user.uid !== uid)
      updateCreateChatModalContent({ keepSearchFocus: true })
    })
  })

  if (keepSearchFocus) searchInput.focus()
}

function renderCreateChatModal(options = {}) {
  if (!appState.isCreateChatOpen) {
    if (!appState.isChatSettingsOpen) modalRoot.innerHTML = ''
    return
  }

  ensureCreateChatModalShell()
  updateCreateChatModalContent(options)
}

function openChatSettingsModal() {
  const thread = getSelectedThread()
  if (!thread) return
  appState.isChatSettingsOpen = true
  appState.chatSettingsError = ''
  appState.chatSettingsDraftTitle = thread.title || ''
  appState.chatSettingsImageFile = null
  appState.chatSettingsSearchQuery = ''
  appState.chatSettingsSearchResults = []
  renderChatSettingsModal()
}

function closeChatSettingsModal() {
  appState.isChatSettingsOpen = false
  appState.chatSettingsError = ''
  appState.isSavingChatSettings = false
  appState.chatSettingsDraftTitle = ''
  appState.chatSettingsImageFile = null
  appState.chatSettingsSearchQuery = ''
  appState.chatSettingsSearchResults = []
  renderChatSettingsModal()
}

async function handleChatSettingsSearch(value) {
  appState.chatSettingsSearchQuery = value
  const queryText = String(value || '').trim().toLowerCase()
  if (queryText.length < 2) {
    appState.chatSettingsSearchResults = []
    renderChatSettingsModal({ keepSearchFocus: true })
    return
  }

  try {
    appState.isSearchingChatSettingsUsers = true
    renderChatSettingsModal({ keepSearchFocus: true })
    const existing = new Set((getSelectedThread()?.participantIds || []).filter(Boolean))
    const results = await searchProfilesByUsername(queryText)
    appState.chatSettingsSearchResults = results.filter((profile) => !existing.has(profile.uid) && profile.uid !== appState.user?.uid)
    appState.chatSettingsError = ''
  } catch (error) {
    appState.chatSettingsError = error?.message || 'Unable to search profiles for this chat.'
    appState.chatSettingsSearchResults = []
  } finally {
    appState.isSearchingChatSettingsUsers = false
    renderChatSettingsModal()
  }
}

async function handleSaveChatSettings() {
  const thread = getSelectedThread()
  if (!thread || thread.type !== 'group') return
  try {
    appState.isSavingChatSettings = true
    renderChatSettingsModal()
    const trimmedTitle = String(appState.chatSettingsDraftTitle || '').trim().slice(0, 80)
    let imageURL = thread.imageURL || ''
    let imagePath = thread.imagePath || ''
    if (appState.chatSettingsImageFile && storage) {
      const ext = String(appState.chatSettingsImageFile.name || 'webp').split('.').pop() || 'webp'
      imagePath = STORAGE_PATHS.threadAvatar(thread.id, `avatar.${ext}`)
      await uploadBytes(ref(storage, imagePath), appState.chatSettingsImageFile, { contentType: appState.chatSettingsImageFile.type || 'image/webp' })
      imageURL = await getDownloadURL(ref(storage, imagePath))
    }

    await updateThreadDetails({
      threadId: thread.id,
      actorUid: appState.user?.uid,
      title: trimmedTitle,
      imageURL,
      imagePath
    })
    appState.chatSettingsError = ''
    appState.isSavingChatSettings = false
    closeChatSettingsModal()
  } catch (error) {
    appState.isSavingChatSettings = false
    appState.chatSettingsError = error?.message || 'Unable to save chat settings.'
    renderChatSettingsModal()
  }
}

async function handleAddParticipant(uid) {
  const thread = getSelectedThread()
  if (!thread || !uid) return
  if (thread.type === 'group' && thread.createdBy !== appState.user?.uid) {
    appState.chatSettingsError = 'Only the chat owner can add people.'
    renderChatSettingsModal({ keepSearchFocus: true })
    return
  }
  try {
    await addParticipantsToThread({ threadId: thread.id, actorUid: appState.user?.uid, participantIds: [uid] })
    appState.chatSettingsError = ''
    appState.chatSettingsSearchQuery = ''
    appState.chatSettingsSearchResults = []
    renderChatSettingsModal()
  } catch (error) {
    appState.chatSettingsError = error?.message || 'Unable to add this member.'
    renderChatSettingsModal()
  }
}

async function handleRemoveParticipant(uid) {
  const thread = getSelectedThread()
  if (!thread || !uid) return
  if (thread.type === 'group' && uid !== appState.user?.uid && thread.createdBy !== appState.user?.uid) {
    appState.chatSettingsError = 'Only the chat owner can remove members.'
    renderChatSettingsModal()
    return
  }
  if ((thread.participantIds || []).length <= 1) {
    appState.chatSettingsError = 'Cannot remove the only remaining participant.'
    renderChatSettingsModal()
    return
  }
  const isSelf = uid === appState.user?.uid
  if (!window.confirm(isSelf ? 'Leave this chat?' : 'Remove this member from the chat?')) return

  try {
    await removeParticipantFromThread({ threadId: thread.id, actorUid: appState.user?.uid, participantId: uid })
    appState.chatSettingsError = ''
    renderChatSettingsModal()
  } catch (error) {
    appState.chatSettingsError = error?.message || 'Unable to remove this member.'
    renderChatSettingsModal()
  }
}

function renderChatSettingsModal(options = {}) {
  if (!appState.isChatSettingsOpen) {
    if (!appState.isCreateChatOpen) modalRoot.innerHTML = ''
    return
  }

  const thread = getSelectedThread()
  if (!thread) return
  const participants = getThreadParticipants(thread.id).map((entry) => getProfileMeta(entry.uid, entry))
  const canEditGroup = thread.type === 'group' && thread.createdBy === appState.user?.uid
  const hasPendingChanges = canEditGroup
    && (
      String(appState.chatSettingsDraftTitle || '').trim() !== String(thread.title || '').trim()
      || Boolean(appState.chatSettingsImageFile)
    )

  const memberMarkup = participants.map((member) => `
    <article class="chat-details-member-row">
      <div class="chat-chip-avatar ${member.avatarURL ? 'has-image' : ''}">
        ${member.avatarURL ? `<img src="${escapeHtml(member.avatarURL)}" alt="" />` : `<span>${escapeHtml(getInitials(member))}</span>`}
      </div>
      <div class="chat-details-member-meta">
        <strong>${escapeHtml(member.displayName || 'Member')} ${member.uid === appState.user?.uid ? '<span>(You)</span>' : ''} ${member.uid === thread.createdBy ? '<span>(Owner)</span>' : ''}</strong>
        <small>@${escapeHtml(member.username || 'member')}</small>
      </div>
      ${thread.type === 'group' && participants.length > 1 && (canEditGroup || member.uid === appState.user?.uid) ? `<button type="button" class="button button-muted chat-details-remove" data-remove-member="${member.uid}">${member.uid === appState.user?.uid ? 'Leave' : 'Remove'}</button>` : ''}
    </article>
  `).join('')

  const addMarkup = appState.isSearchingChatSettingsUsers
    ? '<p class="modal-hint">Searching…</p>'
    : appState.chatSettingsSearchQuery.trim().length < 2
      ? '<p class="modal-hint">Type at least 2 characters to search by username.</p>'
      : appState.chatSettingsSearchResults.length
        ? appState.chatSettingsSearchResults.map((profile) => `
          <button type="button" class="chat-search-row" data-add-participant="${profile.uid}">
            <div class="chat-chip-avatar ${profile.avatarURL || profile.photoURL ? 'has-image' : ''}">
              ${profile.avatarURL || profile.photoURL ? `<img src="${escapeHtml(profile.avatarURL || profile.photoURL)}" alt="" />` : `<span>${escapeHtml(getInitials(profile))}</span>`}
            </div>
            <div class="chat-search-meta">
              <strong>${escapeHtml(profile.displayName || profile.username || 'User')}</strong>
              <small>@${escapeHtml(profile.username || 'unknown')}</small>
            </div>
          </button>
        `).join('')
        : '<p class="modal-hint">No matching profiles found.</p>'

  modalRoot.innerHTML = `
    <div class="chat-details-backdrop">
      <section class="chat-details-modal" role="dialog" aria-modal="true" aria-labelledby="chat-details-title">
        <header class="chat-details-header">
          <h2 id="chat-details-title">Chat details</h2>
          <div class="chat-details-header-actions">
            ${hasPendingChanges ? `<button type="button" class="button button-accent" data-chat-details-save ${appState.isSavingChatSettings ? 'disabled' : ''}>${appState.isSavingChatSettings ? 'Saving…' : 'Save'}</button>` : ''}
            <button type="button" class="create-chat-close" data-chat-details-close aria-label="Close chat settings">×</button>
          </div>
        </header>

        <section class="chat-details-section">
          <h3>Chat identity</h3>
          <div class="chat-details-identity-row">
            <div class="thread-avatar ${thread.imageURL ? 'has-image' : ''}">
              ${thread.imageURL ? `<img src="${escapeHtml(thread.imageURL)}" alt="" />` : `<span>${escapeHtml(getInitials({ title: thread.title }))}</span>`}
            </div>
            <div class="chat-details-identity-fields">
              <label>Chat name</label>
              <input type="text" data-chat-settings-title value="${escapeHtml(appState.chatSettingsDraftTitle || '')}" ${canEditGroup ? '' : 'disabled'} />
              <input type="file" data-chat-settings-image accept="image/*" ${canEditGroup ? '' : 'disabled'} />
              <small>${canEditGroup ? 'Group owner can rename this chat.' : 'Direct messages cannot be renamed here.'}</small>
              <small>${canEditGroup ? 'Group owner can change this chat image.' : 'Only owner can change image.'}</small>
            </div>
          </div>
        </section>

        <section class="chat-details-section">
          <h3>Members</h3>
          <div class="chat-details-member-list">${memberMarkup || '<p class="modal-hint">No members found.</p>'}</div>
        </section>

        <section class="chat-details-section">
          <h3>Add people</h3>
          <input class="create-chat-search" type="search" placeholder="Search username…" value="${escapeHtml(appState.chatSettingsSearchQuery)}" data-chat-settings-search ${canEditGroup ? '' : 'disabled'} />
          ${canEditGroup ? `<div class="create-chat-results">${addMarkup}</div>` : '<p class="modal-hint">Only the chat owner can add people.</p>'}
        </section>

        ${appState.chatSettingsError ? `<p class="modal-error">${escapeHtml(appState.chatSettingsError)}</p>` : ''}
      </section>
    </div>
  `

  modalRoot.querySelector('[data-chat-details-close]')?.addEventListener('click', closeChatSettingsModal)
  modalRoot.querySelector('.chat-details-backdrop')?.addEventListener('click', (event) => {
    if (event.target === event.currentTarget) closeChatSettingsModal()
  })
  modalRoot.querySelector('[data-chat-details-save]')?.addEventListener('click', handleSaveChatSettings)
  modalRoot.querySelector('[data-chat-settings-title]')?.addEventListener('input', (event) => {
    appState.chatSettingsDraftTitle = event.target.value
    renderChatSettingsModal()
  })
  modalRoot.querySelector('[data-chat-settings-image]')?.addEventListener('change', (event) => {
    appState.chatSettingsImageFile = event.target.files?.[0] || null
  })
  modalRoot.querySelector('[data-chat-settings-search]')?.addEventListener('input', (event) => {
    chatSettingsSearchSelection = {
      start: event.target.selectionStart,
      end: event.target.selectionEnd
    }
    handleChatSettingsSearch(event.target.value)
  })
  modalRoot.querySelectorAll('[data-add-participant]').forEach((button) => {
    button.addEventListener('click', () => handleAddParticipant(button.getAttribute('data-add-participant')))
  })
  modalRoot.querySelectorAll('[data-remove-member]').forEach((button) => {
    button.addEventListener('click', () => handleRemoveParticipant(button.getAttribute('data-remove-member')))
  })

  if (options.keepSearchFocus) {
    const searchInput = modalRoot.querySelector('[data-chat-settings-search]')
    searchInput?.focus()
    if (searchInput && Number.isInteger(chatSettingsSearchSelection.start) && Number.isInteger(chatSettingsSearchSelection.end)) {
      searchInput.setSelectionRange(chatSettingsSearchSelection.start, chatSettingsSearchSelection.end)
    }
  }
}

function renderSignedOutState() {
  inboxRoot.innerHTML = `
    <article class="inbox-auth-card">
      <h2>Sign in required</h2>
      <p>Inbox is available for signed-in members so your conversations stay private and synced.</p>
      <a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a>
    </article>
  `
  modalRoot.innerHTML = ''
}

function bindSharedEvents() {
  inboxRoot.querySelectorAll('[data-inbox-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      appState.activeFilter = button.dataset.inboxFilter || 'Messages'
      renderSignedInState()
    })
  })

  inboxRoot.querySelectorAll('[data-thread-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (appState.activeFilter !== 'Messages') {
        appState.activeFilter = 'Messages'
      }

      const { threadId } = button.dataset
      if (!threadId) return
      if (activeTypingThreadId && activeTypingThreadId !== threadId) clearTypingForThread(activeTypingThreadId)

      appState.selectedThreadId = threadId
      appState.errorMessage = ''
      startMessageSubscription(threadId)
      hydrateProfilesForThread(getSelectedThread())
      renderSignedInState()

      await markThreadRead({ threadId, uid: appState.user?.uid }).catch((error) => {
        warnRealtimePermission(`participants-read-${threadId}`, error)
      })
    })
  })

  inboxRoot.querySelectorAll('[data-system-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      appState.systemFilter = button.getAttribute('data-system-filter') || 'all'
      renderSignedInState()
    })
  })

  inboxRoot.querySelectorAll('[data-system-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      if (!appState.user?.uid) return
      await markSystemNotificationRead(appState.user.uid, card.getAttribute('data-system-id')).catch(() => {})
    })
  })

  const openCreateChatButton = inboxRoot.querySelector('[data-action="open-create-chat"]')
  if (openCreateChatButton) {
    openCreateChatButton.addEventListener('click', () => {
      openCreateChatModal()
    })
  }

  const openChatSettingsButton = inboxRoot.querySelector('[data-action="open-chat-settings"]')
  if (openChatSettingsButton) {
    openChatSettingsButton.addEventListener('click', () => openChatSettingsModal())
  }

  const messageForm = inboxRoot.querySelector('[data-message-form]')
  const textarea = messageForm?.querySelector('textarea[name="message"]')
  const attachmentInput = messageForm?.querySelector('[data-attachment-input]')
  const thread = getSelectedThread()

  if (textarea && thread) {
    textarea.addEventListener('input', () => {
      appState.composerDraftByThreadId[thread.id] = textarea.value
      if (typingStopTimer) clearTimeout(typingStopTimer)
      activeTypingThreadId = thread.id
      setTypingState({
        threadId: thread.id,
        uid: appState.user?.uid,
        displayName: appState.user?.displayName || appState.user?.email?.split('@')[0] || 'Member',
        username: appState.user?.username || '',
        isTyping: Boolean(textarea.value.trim())
      }).catch((error) => {
        warnRealtimePermission(`typing-write-${thread.id}`, error)
      })

      typingStopTimer = setTimeout(() => {
        clearTypingForThread(thread.id)
      }, 1500)
    })

    textarea.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        await handleMessageSubmit(messageForm)
      }
    })
  }

  messageForm?.querySelector('[data-action="attach-file"]')?.addEventListener('click', () => {
    attachmentInput?.click()
  })

  attachmentInput?.addEventListener('change', () => {
    if (!thread) return
    appState.attachmentDraftByThreadId[thread.id] = Array.from(attachmentInput.files || []).slice(0, 6)
    renderSignedInState()
  })

  messageForm?.querySelectorAll('[data-remove-attachment]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!thread) return
      const index = Number(button.getAttribute('data-remove-attachment'))
      const current = appState.attachmentDraftByThreadId[thread.id] || []
      appState.attachmentDraftByThreadId[thread.id] = current.filter((_, idx) => idx !== index)
      renderSignedInState()
    })
  })

  if (messageForm) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      await handleMessageSubmit(messageForm)
    })
  }
}

function renderSignedInState() {
  inboxRoot.innerHTML = appState.activeFilter === 'Messages' ? renderMessagesLayout() : renderActivityLayout(appState.activeFilter)
  bindSharedEvents()
  renderCreateChatModal()
  renderChatSettingsModal()

  const list = inboxRoot.querySelector('[data-message-list]')
  if (list) list.scrollTop = list.scrollHeight
}

async function handleMessageSubmit(form) {
  const thread = getSelectedThread()
  if (!thread || !appState.user?.uid) return

  const field = form.querySelector('textarea[name="message"]')
  const body = String(field?.value || '').trim()
  const attachments = appState.attachmentDraftByThreadId[thread.id] || []
  if (!body && !attachments.length) return

  form.querySelector('button[type="submit"]')?.setAttribute('disabled', 'disabled')

  try {
    await sendMessage(thread.id, { senderId: appState.user.uid, body, type: 'text', attachments })
    appState.errorMessage = ''
    field.value = ''
    appState.composerDraftByThreadId[thread.id] = ''
    appState.attachmentDraftByThreadId[thread.id] = []
    clearTypingForThread(thread.id)
    await markThreadRead({ threadId: thread.id, uid: appState.user.uid }).catch((error) => {
      warnRealtimePermission(`participants-read-${thread.id}`, error)
    })
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to send message.'
  }

  renderSignedInState()
}

function startThreadDetailSubscriptions(threadId) {
  appState.participantsUnsubscribe()
  appState.typingUnsubscribe()

  appState.participantsUnsubscribe = subscribeToThreadParticipants(threadId, (participants) => {
    appState.participantsByThreadId[threadId] = participants
    participants.forEach((participant) => {
      if (!participant?.uid) return
      appState.profileByUid[participant.uid] = appState.profileByUid[participant.uid] || {
        displayName: participant.displayName || '',
        username: participant.username || '',
        avatarURL: participant.avatarURL || participant.photoURL || ''
      }
    })
    hydrateProfilesForThread(getSelectedThread())
    if (appState.selectedThreadId === threadId) renderSignedInState()
  }, (error) => {
    warnRealtimePermission(`participants-${threadId}`, error)
  })

  appState.typingUnsubscribe = subscribeToTypingState(threadId, (typingRows) => {
    appState.typingUsersByThreadId[threadId] = typingRows
    if (appState.selectedThreadId === threadId) renderSignedInState()
  }, (error) => {
    warnRealtimePermission(`typing-${threadId}`, error)
  })
}

function startMessageSubscription(threadId) {
  if (!threadId || !appState.user?.uid) return
  appState.messageUnsubscribe()
  appState.loadingMessageThreadId = threadId
  startThreadDetailSubscriptions(threadId)

  appState.messageUnsubscribe = subscribeToMessages(threadId, async (messages) => {
    appState.messagesByThreadId[threadId] = messages
    appState.loadingMessageThreadId = ''

    await markThreadDelivered({ threadId, uid: appState.user.uid }).catch((error) => {
      warnRealtimePermission(`participants-delivered-${threadId}`, error)
    })
    if (appState.selectedThreadId === threadId) {
      renderSignedInState()
      await markThreadRead({ threadId, uid: appState.user.uid }).catch((error) => {
        warnRealtimePermission(`participants-read-${threadId}`, error)
      })
    }
  }, (error) => {
    warnRealtimePermission(`messages-${threadId}`, error)
  })
}

function startThreadSubscription() {
  if (!appState.user?.uid) return
  if (activeThreadSubscriptionUid === appState.user.uid) return

  console.info('[inbox] thread subscription started')
  activeThreadSubscriptionUid = appState.user.uid
  appState.isLoadingThreads = true
  appState.threadsRealtimeReady = false
  appState.threadsFallbackTried = false
  appState.threadsFallbackPending = false
  renderSignedInState()

  appState.threadUnsubscribe()
  appState.threadUnsubscribe = subscribeToInboxThreads(appState.user.uid, (threads) => {
    appState.threads = threads
    appState.isLoadingThreads = false
    appState.threadsRealtimeReady = true
    appState.hasLoadedThreadsOnce = true

    if (!threads.length) {
      if (!appState.threadsFallbackTried) {
        console.info('[inbox] thread subscription fallback used')
        appState.threadsFallbackTried = true
        appState.threadsFallbackPending = true
        appState.isLoadingThreads = true
        renderSignedInState()
        listInboxThreads(appState.user.uid)
          .then((fallbackThreads) => {
            appState.threadsFallbackPending = false
            appState.isLoadingThreads = false
            appState.hasLoadedThreadsOnce = true
            console.info('[inbox] one-time fallback loaded', fallbackThreads.length, 'threads')
            if (!fallbackThreads.length) return
            appState.threads = fallbackThreads
            appState.selectedThreadId = fallbackThreads[0].id
            if (!appState.messagesByThreadId[appState.selectedThreadId]) {
              startMessageSubscription(appState.selectedThreadId)
            }
            renderSignedInState()
          })
          .catch((fallbackError) => {
            appState.threadsFallbackPending = false
            appState.isLoadingThreads = false
            warnRealtimePermission(`threads-empty-fallback-${appState.user.uid}`, fallbackError)
            renderSignedInState()
          })
        return
      }
      appState.selectedThreadId = ''
      appState.messageUnsubscribe()
      renderSignedInState()
      return
    }

    if (!threads.some((thread) => thread.id === appState.selectedThreadId)) {
      appState.selectedThreadId = threads[0].id
    }

    if (!appState.messagesByThreadId[appState.selectedThreadId]) {
      startMessageSubscription(appState.selectedThreadId)
    }
    hydrateProfilesForThread(threads.find((thread) => thread.id === appState.selectedThreadId))

    renderSignedInState()
  }, async (error) => {
    warnRealtimePermission(`threads-${appState.user.uid}`, error)
    appState.isLoadingThreads = false
    appState.threadsFallbackTried = true
    appState.threadsFallbackPending = true
    try {
      console.info('[inbox] thread subscription fallback used')
      const fallbackThreads = await listInboxThreads(appState.user.uid)
      appState.threadsFallbackPending = false
      appState.hasLoadedThreadsOnce = true
      console.info('[inbox] one-time fallback loaded', fallbackThreads.length, 'threads')
      appState.threads = fallbackThreads
      if (fallbackThreads.length && !appState.selectedThreadId) {
        appState.selectedThreadId = fallbackThreads[0].id
      }
      if (appState.selectedThreadId && !appState.messagesByThreadId[appState.selectedThreadId]) {
        startMessageSubscription(appState.selectedThreadId)
      }
      appState.errorMessage = fallbackThreads.length ? '' : 'No conversations yet.'
    } catch (fallbackError) {
      appState.threadsFallbackPending = false
      warnRealtimePermission(`threads-fallback-${appState.user.uid}`, fallbackError)
      appState.errorMessage = 'Inbox could not be loaded. Please refresh.'
    }
    renderSignedInState()
  })
}

function startSystemNotificationSubscription() {
  if (!appState.user?.uid) return
  appState.systemUnsubscribe()
  appState.systemUnsubscribe = subscribeToSystemNotifications(
    appState.user.uid,
    (items) => {
      appState.systemNotifications = items
      if (appState.activeFilter === 'System') renderSignedInState()
    },
    (error) => {
      warnSystemPermission(error)
    }
  )
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && appState.isChatSettingsOpen && !appState.isSavingChatSettings) {
    closeChatSettingsModal()
    return
  }
  if (event.key === 'Escape' && appState.isCreateChatOpen && !appState.isCreatingChat) {
    closeCreateChatModal()
  }
}

document.addEventListener('keydown', handleGlobalKeydown)

waitForInitialAuthState().then(async (user) => {
  if (!user) {
    clearRealtimeListeners()
    window.location.assign(authRoute({ redirect: ROUTES.inbox }))
    return
  }

  appState.user = user
  renderSignedInState()
  startThreadSubscription()
  startSystemNotificationSubscription()
  hasInitializedAuthObserver = true

  const startUid = String(new URLSearchParams(window.location.search).get('start') || '').trim()
  if (startUid && startUid !== user.uid && processedStartUid !== `${user.uid}:${startUid}`) {
    processedStartUid = `${user.uid}:${startUid}`
    try {
      const thread = await createOrGetDm({ creatorId: user.uid, targetUid: startUid })
      if (thread?.id) {
        console.info('[inbox] create/open thread succeeded', thread.id)
        appState.selectedThreadId = thread.id
        try {
          const durableThreads = await listInboxThreads(user.uid)
          console.info('[inbox] one-time fallback loaded', durableThreads.length, 'threads')
          appState.threads = durableThreads.length ? durableThreads : appState.threads
          appState.hasLoadedThreadsOnce = true
        } catch (refreshError) {
          warnRealtimePermission(`start-dm-refresh-${startUid}`, refreshError)
        }
        startMessageSubscription(thread.id)
        renderSignedInState()
      }
    } catch (error) {
      warnRealtimePermission(`start-dm-${startUid}`, error)
    }
  }
})

subscribeToAuthState(async (user) => {
  if (!hasInitializedAuthObserver) return
  if (!user) {
    clearRealtimeListeners()
    window.location.assign(authRoute({ redirect: ROUTES.inbox }))
    return
  }

  if (appState.user?.uid && appState.user.uid !== user.uid) {
    clearRealtimeListeners()
  }
  appState.user = user
  appState.activeFilter = appState.activeFilter || 'Messages'
  renderSignedInState()
  startThreadSubscription()
  startSystemNotificationSubscription()
})
