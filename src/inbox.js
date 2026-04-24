import './styles/base.css'
import './styles/inbox.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { listInboxThreads, listMessages } from './data/inboxService'

const app = document.querySelector('#app')

const inboxFilters = ['Messages', 'Calls', 'Likes', 'Follows', 'Comments', 'Mentions', 'System']

const activityCopy = {
  Calls: {
    title: 'Calls',
    emptyTitle: 'No calls yet.',
    emptyBody: 'Your audio and video call history will appear here once activity starts.'
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
  activeFilter: 'Messages'
}

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

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getSelectedThread() {
  return appState.threads.find((thread) => thread.id === appState.selectedThreadId) || null
}

function renderSignedOutState() {
  inboxRoot.innerHTML = `
    <article class="inbox-auth-card">
      <h2>Sign in required</h2>
      <p>Inbox is available for signed-in members so your conversations stay private and synced.</p>
      <a class="button button-accent" href="/auth.html">Go to Sign In / Sign Up</a>
    </article>
  `
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

  const pills = appState.threads.slice(0, 4).map((thread) => {
    const isActive = appState.selectedThreadId === thread.id
    return `
      <button type="button" class="sidebar-thread-pill ${isActive ? 'is-active' : ''}" data-thread-id="${thread.id}">
        <strong>${escapeHtml(thread.title)}</strong>
        ${thread.type === 'group' ? '<small>Group</small>' : ''}
      </button>
    `
  }).join('')

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

  if (!messages.length) {
    return `
      <section class="inbox-empty-panel">
        <h3>No messages yet.</h3>
        <p>Start this conversation with your first message.</p>
      </section>
    `
  }

  const messageMarkup = messages
    .map(
      (message) => `
        <article class="message-item ${message.senderId === appState.user?.uid ? 'is-self' : ''}">
          <p>${escapeHtml(message.body)}</p>
        </article>
      `
    )
    .join('')

  return `<div class="message-list">${messageMarkup}</div>`
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
        <header class="panel-header">
          <h3>Messages</h3>
          <p>Direct and group conversations</p>
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
      if (!threadId || threadId === appState.selectedThreadId) {
        renderSignedInState()
        return
      }

      appState.selectedThreadId = threadId
      renderSignedInState()
      await loadMessages(threadId)
    })
  })
}

function renderSignedInState() {
  inboxRoot.innerHTML = appState.activeFilter === 'Messages' ? renderMessagesLayout() : renderActivityLayout(appState.activeFilter)
  bindSharedEvents()
}

async function loadThreads() {
  if (!appState.user?.uid) return
  appState.isLoadingThreads = true
  renderSignedInState()

  try {
    const threads = await listInboxThreads(appState.user.uid)
    appState.threads = threads
    if (!threads.some((thread) => thread.id === appState.selectedThreadId)) {
      appState.selectedThreadId = threads[0]?.id || ''
    }
  } catch (error) {
    console.warn('[inbox] Failed to load threads.', error?.message || error)
    appState.threads = []
    appState.selectedThreadId = ''
  }

  appState.isLoadingThreads = false
  renderSignedInState()

  if (appState.selectedThreadId) {
    await loadMessages(appState.selectedThreadId)
  }
}

async function loadMessages(threadId) {
  if (!threadId || !appState.user?.uid) return
  appState.loadingMessageThreadId = threadId
  renderSignedInState()

  try {
    appState.messagesByThreadId[threadId] = await listMessages(threadId)
  } catch (error) {
    console.warn('[inbox] Failed to load messages.', error?.message || error)
    appState.messagesByThreadId[threadId] = []
  }

  appState.loadingMessageThreadId = ''
  renderSignedInState()
}

waitForInitialAuthState().then(async (user) => {
  if (!user) {
    appState.user = null
    renderSignedOutState()
    return
  }

  appState.user = user
  renderSignedInState()
  await loadThreads()
})

subscribeToAuthState(async (user) => {
  if (!user) {
    appState.user = null
    appState.threads = []
    appState.selectedThreadId = ''
    appState.messagesByThreadId = {}
    renderSignedOutState()
    return
  }

  appState.user = user
  appState.activeFilter = appState.activeFilter || 'Messages'
  renderSignedInState()
  await loadThreads()
})
