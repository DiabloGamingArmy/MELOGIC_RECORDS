import './styles/base.css'
import './styles/inbox.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { listInboxThreads, listMessages } from './data/inboxService'

const app = document.querySelector('#app')

const inboxFilters = ['Messages', 'Calls', 'Likes', 'Follows', 'Comments', 'Mentions', 'System']

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

function getConversationBodyMarkup() {
  if (appState.activeFilter !== 'Messages') {
    return `
      <section class="inbox-empty-panel">
        <h3>No ${escapeHtml(appState.activeFilter.toLowerCase())} yet.</h3>
        <p>This category is ready for live activity when new events come in.</p>
      </section>
    `
  }

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

function getThreadListMarkup() {
  if (appState.activeFilter !== 'Messages') {
    return `
      <div class="inbox-thread-list is-empty">
        <p class="inbox-list-hint">Messages are available under the Messages category.</p>
      </div>
    `
  }

  if (appState.isLoadingThreads) {
    const skeleton = Array.from({ length: 4 })
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

function renderSignedInState() {
  const filterMarkup = inboxFilters
    .map(
      (filter) => `
        <button type="button" class="inbox-filter ${appState.activeFilter === filter ? 'is-active' : ''}" data-inbox-filter="${filter}">
          <span>${filter}</span>
        </button>
      `
    )
    .join('')

  const selectedThread = getSelectedThread()
  inboxRoot.innerHTML = `
    <div class="inbox-layout">
      <aside class="inbox-sidebar">
        <div class="inbox-panel-title">
          <h2>Inbox</h2>
          <p>Messages and activity</p>
        </div>
        <div class="inbox-filters" data-inbox-filters>${filterMarkup}</div>
      </aside>

      <section class="inbox-thread-panel">
        <header class="panel-header">
          <h3>Messages</h3>
          <p>Direct and group conversations</p>
        </header>
        ${getThreadListMarkup()}
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

  inboxRoot.querySelectorAll('[data-inbox-filter]').forEach((button) => {
    button.addEventListener('click', async () => {
      appState.activeFilter = button.dataset.inboxFilter || 'Messages'
      renderSignedInState()
    })
  })

  inboxRoot.querySelectorAll('[data-thread-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const { threadId } = button.dataset
      if (!threadId || threadId === appState.selectedThreadId) return
      appState.selectedThreadId = threadId
      renderSignedInState()
      await loadMessages(threadId)
    })
  })
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
