import './styles/base.css'
import './styles/inbox.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import {
  createGroupThread,
  createOrGetDm,
  markThreadDelivered,
  markThreadRead,
  sendMessage,
  setTypingState,
  subscribeToInboxThreads,
  subscribeToMessages,
  subscribeToThreadParticipants,
  subscribeToTypingState
} from './data/inboxService'
import { searchProfilesByUsername } from './data/profileSearchService'

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
  composerDraftByThreadId: {}
}

let searchDebounceTimer = null
let typingStopTimer = null
let activeTypingThreadId = ''

app.innerHTML = `
  ${navShell({ currentPage: 'inbox' })}
  <main>
    <section class="section inbox-header-shell">
      <div class="section-inner">
        <h1>Inbox</h1>
      </div>
    </section>
    <section class="section inbox-main-shell">
      <div class="section-inner" data-inbox-root>
        <article class="inbox-auth-card">
          <h2>Loading inbox…</h2>
        </article>
      </div>
    </section>
  </main>
`

initShellChrome()

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
  appState.threadUnsubscribe = () => {}
  appState.messageUnsubscribe = () => {}
  appState.participantsUnsubscribe = () => {}
  appState.typingUnsubscribe = () => {}
}

function clearTypingForThread(threadId) {
  if (!threadId || !appState.user?.uid) return
  setTypingState({ threadId, uid: appState.user.uid, isTyping: false })
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

  if (!isMessages) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Open Messages to access recent direct and group chats.</p>
      </section>
    `
  }

  if (!appState.threads.length) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">No conversations yet.</p>
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
  if (typingUsers.length === 1) return `${typingUsers[0].displayName || typingUsers[0].username || 'Someone'} is typing…`
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
  if (direct) return direct

  if (thread.type === 'dm' && uid !== appState.user?.uid) {
    return {
      uid,
      displayName: thread.title,
      avatarURL: thread.imageURL,
      username: ''
    }
  }

  return { uid, displayName: uid === appState.user?.uid ? 'You' : 'Member', username: '' }
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
          return `
            <article class="message-bubble ${isFirst ? 'is-first' : ''} ${isLast ? 'is-last' : ''} ${message.deleted ? 'is-deleted' : ''}">
              <p>${escapeHtml(message.deleted ? 'Message removed.' : message.body)}</p>
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
  const typingUsers = getTypingUsers(thread.id)

  return `
    <div class="conversation-stack">
      ${getMessageGroupsMarkup(thread)}
      ${typingUsers.length ? `<p class="typing-indicator">${escapeHtml(getConversationSubtitle(thread))}</p>` : ''}
      <form class="message-composer" data-message-form>
        <label class="sr-only" for="message-input">Message</label>
        <textarea id="message-input" name="message" rows="2" maxlength="1200" placeholder="Write a message..." required>${escapeHtml(draft)}</textarea>
        <div class="message-composer-footer">
          ${appState.errorMessage ? `<p class="composer-error">${escapeHtml(appState.errorMessage)}</p>` : '<span></span>'}
          <button type="submit" class="button button-accent">Send</button>
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

  return `
    <header class="conversation-header">
      <div class="thread-avatar ${thread.imageURL ? 'has-image' : ''}">
        ${thread.imageURL ? `<img src="${escapeHtml(thread.imageURL)}" alt="" />` : `<span>${getInitials(thread)}</span>`}
      </div>
      <div class="conversation-header-meta">
        <h3>${escapeHtml(thread.title)}</h3>
        <p>${escapeHtml(getConversationSubtitle(thread))}</p>
      </div>
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

    if (!appState.threads.some((item) => item.id === threadId)) {
      const optimistic = optimisticThreadFromSelection(threadId, selectedUsers, createdType, buildGroupTitle(selectedUsers))
      appState.threads = [optimistic, ...appState.threads]
    }

    appState.activeFilter = 'Messages'
    appState.selectedThreadId = threadId
    appState.errorMessage = ''
    startMessageSubscription(threadId)
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
  } catch {
    if (requestId !== appState.chatSearchRequestId) return
    appState.isSearchingUsers = false
    appState.chatSearchResults = []
    appState.createChatError = 'Unable to search users.'
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
    modalRoot.innerHTML = ''
    return
  }

  ensureCreateChatModalShell()
  updateCreateChatModalContent(options)
}

function renderSignedOutState() {
  inboxRoot.innerHTML = `
    <article class="inbox-auth-card">
      <h2>Sign in required</h2>
      <p>Inbox is available for signed-in members so your conversations stay private and synced.</p>
      <a class="button button-accent" href="/auth.html">Go to Sign In / Sign Up</a>
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
      renderSignedInState()

      await markThreadRead({ threadId, uid: appState.user?.uid })
    })
  })

  const openCreateChatButton = inboxRoot.querySelector('[data-action="open-create-chat"]')
  if (openCreateChatButton) {
    openCreateChatButton.addEventListener('click', () => {
      openCreateChatModal()
    })
  }

  const messageForm = inboxRoot.querySelector('[data-message-form]')
  const textarea = messageForm?.querySelector('textarea[name="message"]')
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

  const list = inboxRoot.querySelector('[data-message-list]')
  if (list) list.scrollTop = list.scrollHeight
}

async function handleMessageSubmit(form) {
  const thread = getSelectedThread()
  if (!thread || !appState.user?.uid) return

  const field = form.querySelector('textarea[name="message"]')
  const body = String(field?.value || '').trim()
  if (!body) return

  form.querySelector('button[type="submit"]')?.setAttribute('disabled', 'disabled')

  try {
    await sendMessage(thread.id, { senderId: appState.user.uid, body, type: 'text' })
    appState.errorMessage = ''
    field.value = ''
    appState.composerDraftByThreadId[thread.id] = ''
    clearTypingForThread(thread.id)
    await markThreadRead({ threadId: thread.id, uid: appState.user.uid })
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
    if (appState.selectedThreadId === threadId) renderSignedInState()
  })

  appState.typingUnsubscribe = subscribeToTypingState(threadId, (typingRows) => {
    appState.typingUsersByThreadId[threadId] = typingRows
    if (appState.selectedThreadId === threadId) renderSignedInState()
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

    await markThreadDelivered({ threadId, uid: appState.user.uid })
    if (appState.selectedThreadId === threadId) {
      renderSignedInState()
      await markThreadRead({ threadId, uid: appState.user.uid })
    }
  })
}

function startThreadSubscription() {
  if (!appState.user?.uid) return

  appState.isLoadingThreads = true
  renderSignedInState()

  appState.threadUnsubscribe()
  appState.threadUnsubscribe = subscribeToInboxThreads(appState.user.uid, (threads) => {
    appState.threads = threads
    appState.isLoadingThreads = false

    if (!threads.length) {
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

    renderSignedInState()
  })
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape' && appState.isCreateChatOpen && !appState.isCreatingChat) {
    closeCreateChatModal()
  }
}

document.addEventListener('keydown', handleGlobalKeydown)

waitForInitialAuthState().then(async (user) => {
  if (!user) {
    appState.user = null
    clearRealtimeListeners()
    renderSignedOutState()
    return
  }

  appState.user = user
  renderSignedInState()
  startThreadSubscription()
})

subscribeToAuthState(async (user) => {
  if (!user) {
    appState.user = null
    appState.threads = []
    appState.selectedThreadId = ''
    appState.messagesByThreadId = {}
    appState.participantsByThreadId = {}
    appState.typingUsersByThreadId = {}
    clearRealtimeListeners()
    closeCreateChatModal()
    if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
    renderSignedOutState()
    return
  }

  appState.user = user
  appState.activeFilter = appState.activeFilter || 'Messages'
  renderSignedInState()
  startThreadSubscription()
})
