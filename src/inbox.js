import './styles/base.css'
import './styles/inbox.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import {
  createGroupThread,
  createOrGetDm,
  markThreadRead,
  sendMessage,
  subscribeToInboxThreads,
  subscribeToMessages
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
  loadingMessageThreadId: '',
  activeFilter: 'Messages',
  threadUnsubscribe: () => {},
  messageUnsubscribe: () => {},
  errorMessage: '',
  isCreateChatOpen: false,
  chatSearchQuery: '',
  chatSearchResults: [],
  selectedChatUsers: [],
  isSearchingUsers: false,
  isCreatingChat: false,
  createChatError: '',
  chatSearchRequestId: 0
}

let searchDebounceTimer = null

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
  const source = user.displayName || user.username || '?'
  return source
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function getSelectedThread() {
  return appState.threads.find((thread) => thread.id === appState.selectedThreadId) || null
}

function clearRealtimeListeners() {
  appState.threadUnsubscribe()
  appState.messageUnsubscribe()
  appState.threadUnsubscribe = () => {}
  appState.messageUnsubscribe = () => {}
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
        ${thread.type === 'group' ? '<small>Group</small>' : ''}
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

  const messages = appState.messagesByThreadId[thread.id] || []
  const isLoading = appState.loadingMessageThreadId === thread.id

  if (isLoading) {
    return `
      <section class="inbox-empty-panel">
        <h3>Loading messages…</h3>
        <p>Fetching latest conversation history.</p>
      </section>
    `
  }

  const messageMarkup = messages.length
    ? messages
        .map(
          (message) => `
        <article class="message-item ${message.senderId === appState.user?.uid ? 'is-self' : ''}">
          <p>${escapeHtml(message.deleted ? 'Message removed.' : message.body)}</p>
        </article>
      `
        )
        .join('')
    : `
      <section class="inbox-empty-panel inbox-empty-panel-inline">
        <h3>No messages yet.</h3>
        <p>Start this conversation with your first message.</p>
      </section>
    `

  return `
    <div class="conversation-stack">
      <div class="message-list">${messageMarkup}</div>
      <form class="message-composer" data-message-form>
        <label class="sr-only" for="message-input">Message</label>
        <textarea id="message-input" name="message" rows="2" maxlength="1200" placeholder="Write a message..." required></textarea>
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
      const initials = (thread.title || '?')
        .split(' ')
        .map((part) => part[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase()

      return `
        <button class="thread-row ${thread.id === appState.selectedThreadId ? 'is-active' : ''}" type="button" data-thread-id="${thread.id}">
          <div class="thread-avatar ${thread.imageURL ? 'has-image' : ''}">
            ${thread.imageURL ? `<img src="${escapeHtml(thread.imageURL)}" alt="" />` : `<span>${initials || '?'}</span>`}
          </div>
          <div class="thread-meta">
            <div class="thread-title-row">
              <strong>${escapeHtml(thread.title)}</strong>
              <span>${escapeHtml(thread.formattedTime || '')}</span>
            </div>
            <div class="thread-preview-row">
              <p>${escapeHtml(thread.subtitle || 'No messages yet.')}</p>
              ${thread.type === 'group' ? '<small class="thread-badge">Group</small>' : ''}
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
        <header class="panel-header">
          <h3>${escapeHtml(selectedThread?.title || 'Conversation')}</h3>
          <p>${selectedThread ? (selectedThread.type === 'group' ? 'Group thread' : 'Direct message') : 'No thread selected'}</p>
        </header>
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
    renderCreateChatModal()
  } catch {
    if (requestId !== appState.chatSearchRequestId) return
    appState.isSearchingUsers = false
    appState.chatSearchResults = []
    appState.createChatError = 'Unable to search users.'
    renderCreateChatModal()
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
    renderCreateChatModal()
    return
  }

  appState.isSearchingUsers = true
  appState.chatSearchResults = []
  const requestId = appState.chatSearchRequestId + 1
  appState.chatSearchRequestId = requestId
  renderCreateChatModal()

  searchDebounceTimer = setTimeout(() => {
    runProfileSearch(normalized, requestId)
  }, 250)
}

function renderCreateChatModal() {
  if (!appState.isCreateChatOpen) {
    modalRoot.innerHTML = ''
    return
  }

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

  modalRoot.innerHTML = `
    <div class="create-chat-backdrop" data-close-chat-modal>
      <section class="create-chat-modal" role="dialog" aria-modal="true" aria-labelledby="create-chat-title">
        <header class="create-chat-header">
          <h2 id="create-chat-title">Create chat</h2>
          <button type="button" class="create-chat-close" data-close-chat-modal aria-label="Close create chat modal">×</button>
        </header>
        <p class="create-chat-subtitle">Search by username and add people to the conversation.</p>
        <input
          class="create-chat-search"
          type="search"
          placeholder="Search username…"
          value="${escapeHtml(appState.chatSearchQuery)}"
          data-chat-search
          autocomplete="off"
        />
        <div class="create-chat-selected">${selectedMarkup}</div>
        <div class="create-chat-results">${resultsStateMarkup}</div>
        ${appState.createChatError ? `<p class="modal-error">${escapeHtml(appState.createChatError)}</p>` : ''}
        <footer class="create-chat-footer">
          <button type="button" class="button button-muted" data-close-chat-modal ${appState.isCreatingChat ? 'disabled' : ''}>Cancel</button>
          <button type="button" class="button button-accent" data-create-chat ${appState.selectedChatUsers.length ? '' : 'disabled'} ${appState.isCreatingChat ? 'disabled' : ''}>
            ${appState.isCreatingChat ? 'Creating…' : 'Create Chat'}
          </button>
        </footer>
      </section>
    </div>
  `

  const backdrop = modalRoot.querySelector('.create-chat-backdrop')
  const modalCard = modalRoot.querySelector('.create-chat-modal')
  const searchInput = modalRoot.querySelector('[data-chat-search]')

  if (searchInput && document.activeElement !== searchInput) searchInput.focus()

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

  modalRoot.querySelectorAll('[data-add-user]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.getAttribute('data-add-user')
      const user = appState.chatSearchResults.find((row) => row.uid === uid)
      if (!user || appState.selectedChatUsers.some((row) => row.uid === uid)) return
      appState.selectedChatUsers = [...appState.selectedChatUsers, user]
      appState.chatSearchResults = appState.chatSearchResults.filter((row) => row.uid !== uid)
      renderCreateChatModal()
    })
  })

  modalRoot.querySelectorAll('[data-remove-selected]').forEach((button) => {
    button.addEventListener('click', () => {
      const uid = button.getAttribute('data-remove-selected')
      appState.selectedChatUsers = appState.selectedChatUsers.filter((user) => user.uid !== uid)
      renderCreateChatModal()
      if (appState.chatSearchQuery.trim().length >= 2) {
        scheduleSearch(appState.chatSearchQuery)
      }
    })
  })

  modalRoot.querySelector('[data-create-chat]')?.addEventListener('click', async () => {
    await handleCreateChatSubmit()
  })
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
    await markThreadRead({ threadId: thread.id, uid: appState.user.uid })
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to send message.'
  }

  renderSignedInState()
}

function startMessageSubscription(threadId) {
  if (!threadId || !appState.user?.uid) return
  appState.messageUnsubscribe()
  appState.loadingMessageThreadId = threadId

  appState.messageUnsubscribe = subscribeToMessages(threadId, async (messages) => {
    appState.messagesByThreadId[threadId] = messages
    appState.loadingMessageThreadId = ''
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
    clearRealtimeListeners()
    closeCreateChatModal()
    renderSignedOutState()
    return
  }

  appState.user = user
  appState.activeFilter = appState.activeFilter || 'Messages'
  renderSignedInState()
  startThreadSubscription()
})
