import {
  getThreadParticipantUids,
  loadProfilesByUids,
  markThreadRead,
  sendMessage,
  subscribeToHiddenThreadMessages,
  subscribeToInboxThreads,
  subscribeToMessages
} from '../data/inboxService'

const STORAGE_KEY = 'melogic_chat_dock_state_v1'
const OPEN_EVENT = 'melogic:chat-dock-open'
const MAX_DOCK_MESSAGES = 80

let initialized = false
let root = null
let getShellState = () => ({ authReady: false, user: null, profile: null })
let shellSnapshot = getShellState()
let unsubscribeShellState = () => {}
let hasShellStateListener = false
let unsubscribeThreads = () => {}
let unsubscribeMessages = () => {}
let unsubscribeHiddenMessages = () => {}
let activeThread = null
let inboxThreads = []
let messages = []
let hiddenMessageIds = new Set()
let profileByUid = {}
let loadingThreads = false
let loadingMessages = false
let errorMessage = ''
let sending = false
let draft = ''
let lastMarkedReadKey = ''

let dockState = {
  open: false,
  minimized: false,
  mode: 'thread',
  activeThreadId: '',
  title: '',
  ownerUid: ''
}

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function readStoredState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!parsed || typeof parsed !== 'object') return { ...dockState }
    return {
      open: parsed.open === true,
      minimized: parsed.minimized === true,
      mode: parsed.mode === 'support' ? 'support' : 'thread',
      activeThreadId: String(parsed.activeThreadId || '').trim(),
      title: String(parsed.title || '').trim().slice(0, 160),
      ownerUid: String(parsed.ownerUid || '').trim()
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return { ...dockState }
  }
}

function persistState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(dockState))
  } catch {
    // Local UI state persistence must not interrupt messaging.
  }
}

function createClientMessageId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function currentUid() {
  return shellSnapshot?.user?.uid || ''
}

function currentProfile() {
  return shellSnapshot?.profile || {}
}

function stopThreadSubscriptions() {
  unsubscribeThreads()
  unsubscribeThreads = () => {}
  unsubscribeMessages()
  unsubscribeMessages = () => {}
  unsubscribeHiddenMessages()
  unsubscribeHiddenMessages = () => {}
  inboxThreads = []
  activeThread = null
  messages = []
  hiddenMessageIds = new Set()
  loadingThreads = false
  loadingMessages = false
  lastMarkedReadKey = ''
}

function getMessageTime(value = '') {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit'
    }).format(date)
  } catch {
    return date.toLocaleTimeString()
  }
}

function getInitials(source = {}) {
  const name = String(source.displayName || source.username || source.title || source.uid || 'User').trim()
  return name
    .split(/\s+/)
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function senderMeta(uid = '') {
  const profile = profileByUid[uid] || {}
  const displayName = profile.displayName || profile.username || (uid === currentUid() ? 'You' : 'Member')
  return {
    uid,
    displayName,
    username: profile.username || '',
    avatarURL: profile.avatarURL || profile.photoURL || ''
  }
}

function renderAvatar(source = {}, label = 'Member') {
  const avatarURL = String(source.avatarURL || source.photoURL || '').trim()
  const initials = getInitials(source)
  return `
    <span class="chat-dock-avatar ${avatarURL ? 'has-image' : ''}" aria-label="${escapeHtml(label)}">
      ${avatarURL ? `<img src="${escapeHtml(avatarURL)}" alt="" loading="lazy" decoding="async" />` : escapeHtml(initials)}
    </span>
  `
}

function getThreadTitle() {
  return activeThread?.title || dockState.title || 'Conversation'
}

function getThreadSubtitle() {
  if (!currentUid()) return 'Sign in to continue'
  if (loadingThreads) return 'Loading conversation...'
  if (!activeThread && dockState.activeThreadId) return 'Conversation unavailable'
  if (!activeThread) return 'No conversation selected'
  if (activeThread.type === 'group') {
    return `${Math.max(1, Number(activeThread.participantCount || getThreadParticipantUids(activeThread).length || 0))} members`
  }
  return 'Direct message'
}

function renderSupportPanel() {
  return `
    <section class="chat-dock-placeholder">
      <span class="chat-dock-placeholder-icon" aria-hidden="true">?</span>
      <h3>Support chat is coming soon.</h3>
      <p>For Phase 1, this dock is ready for conversations, but live support routing is intentionally not enabled yet.</p>
      <a class="chat-dock-support-link" href="/support">Go to Support</a>
    </section>
  `
}

function renderMessageBody(message = {}) {
  if (message.deleted) return '<em>Message removed</em>'
  const text = escapeHtml(message.body || '')
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  const attachmentMarkup = attachments.length
    ? `
      <div class="chat-dock-attachments">
        ${attachments.map((attachment) => {
          const name = escapeHtml(attachment.name || 'Attachment')
          const url = escapeHtml(attachment.url || '')
          const mime = String(attachment.mimeType || '')
          if (mime.startsWith('image/') && url) {
            return `<a href="${url}" target="_blank" rel="noopener" class="chat-dock-image-attachment"><img src="${url}" alt="${name}" loading="lazy" /></a>`
          }
          return url
            ? `<a href="${url}" target="_blank" rel="noopener" class="chat-dock-file-attachment">${name}</a>`
            : `<span class="chat-dock-file-attachment">${name}</span>`
        }).join('')}
      </div>
    `
    : ''
  return `${text ? `<p>${text}</p>` : ''}${attachmentMarkup}`
}

function renderMessageList() {
  if (!currentUid()) {
    return `
      <section class="chat-dock-placeholder">
        <h3>Sign in required</h3>
        <p>Your conversations stay private to your Melogic account.</p>
      </section>
    `
  }
  if (errorMessage) {
    return `
      <section class="chat-dock-placeholder is-error">
        <h3>Could not load chat</h3>
        <p>${escapeHtml(errorMessage)}</p>
      </section>
    `
  }
  if (loadingThreads || loadingMessages) {
    return `
      <section class="chat-dock-placeholder">
        <div class="chat-dock-loader" aria-hidden="true"></div>
        <h3>Loading chat...</h3>
      </section>
    `
  }
  if (!activeThread) {
    return `
      <section class="chat-dock-placeholder">
        <h3>Conversation unavailable</h3>
        <p>You may no longer have access to this conversation.</p>
      </section>
    `
  }

  const visibleMessages = messages
    .filter((message) => !hiddenMessageIds.has(message.id))
    .slice(-MAX_DOCK_MESSAGES)

  if (!visibleMessages.length) {
    return `
      <section class="chat-dock-placeholder">
        <h3>No messages yet.</h3>
        <p>Start this conversation from the dock.</p>
      </section>
    `
  }

  return visibleMessages.map((message) => {
    const isMine = message.senderId === currentUid()
    const sender = senderMeta(message.senderId)
    return `
      <article class="chat-dock-message ${isMine ? 'is-mine' : 'is-theirs'} ${message.pendingWrites ? 'is-pending' : ''}">
        ${isMine ? '' : renderAvatar(sender, sender.displayName)}
        <div class="chat-dock-message-stack">
          ${isMine ? '' : `<strong>${escapeHtml(sender.displayName)}</strong>`}
          <div class="chat-dock-bubble">${renderMessageBody(message)}</div>
          <time>${escapeHtml(getMessageTime(message.createdAt))}</time>
        </div>
      </article>
    `
  }).join('')
}

function renderComposer() {
  if (dockState.mode === 'support') return ''
  const disabled = !currentUid() || !activeThread || loadingThreads || sending || Boolean(errorMessage)
  return `
    <form class="chat-dock-composer" data-chat-dock-form>
      <label class="sr-only" for="chat-dock-input">Message</label>
      <textarea id="chat-dock-input" data-chat-dock-input rows="1" maxlength="1200" placeholder="${disabled ? 'Chat unavailable' : 'Write a message...'}" ${disabled ? 'disabled' : ''}>${escapeHtml(draft)}</textarea>
      <button type="submit" aria-label="Send message" ${disabled || !draft.trim() ? 'disabled' : ''}>Send</button>
    </form>
  `
}

function renderMinimized() {
  return `
    <button type="button" class="chat-dock-minimized" data-chat-dock-restore aria-label="Restore ${escapeHtml(getThreadTitle())}">
      <span>${escapeHtml(dockState.mode === 'support' ? 'Support' : getThreadTitle())}</span>
      <small>${dockState.mode === 'support' ? 'Coming soon' : 'Open chat'}</small>
    </button>
  `
}

function renderDock() {
  if (!root) return
  if (!dockState.open) {
    root.innerHTML = ''
    root.hidden = true
    return
  }

  root.hidden = false
  if (dockState.minimized) {
    root.innerHTML = renderMinimized()
    return
  }

  const title = dockState.mode === 'support' ? 'Contact Support' : getThreadTitle()
  const subtitle = dockState.mode === 'support' ? 'Phase 1 placeholder' : getThreadSubtitle()
  const headerAvatar = dockState.mode === 'support'
    ? '<span class="chat-dock-avatar is-support" aria-hidden="true">?</span>'
    : renderAvatar(activeThread || { title }, title)

  root.innerHTML = `
    <section class="chat-dock-panel" role="dialog" aria-label="${escapeHtml(title)} chat dock" aria-live="polite">
      <header class="chat-dock-header">
        ${headerAvatar}
        <div class="chat-dock-title">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        <button type="button" data-chat-dock-minimize aria-label="Minimize chat">–</button>
        <button type="button" data-chat-dock-close aria-label="Close chat">×</button>
      </header>
      <div class="chat-dock-messages" data-chat-dock-messages>
        ${dockState.mode === 'support' ? renderSupportPanel() : renderMessageList()}
      </div>
      ${renderComposer()}
    </section>
  `
  scrollMessagesToBottom()
}

function scrollMessagesToBottom() {
  window.requestAnimationFrame(() => {
    const scroller = root?.querySelector('[data-chat-dock-messages]')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  })
}

function focusComposer() {
  window.requestAnimationFrame(() => {
    const input = root?.querySelector('[data-chat-dock-input]')
    input?.focus()
  })
}

function hydrateProfilesForDock() {
  const ids = Array.from(new Set([
    ...getThreadParticipantUids(activeThread || {}),
    ...messages.map((message) => message.senderId)
  ].filter(Boolean)))
  const missing = ids.filter((uid) => !profileByUid[uid])
  if (!missing.length) return
  loadProfilesByUids(missing)
    .then((profiles) => {
      profileByUid = { ...profileByUid, ...profiles }
      renderDock()
    })
    .catch(() => {})
}

function markActiveThreadRead() {
  const uid = currentUid()
  const threadId = dockState.activeThreadId
  if (!uid || !threadId || dockState.minimized || dockState.mode !== 'thread') return
  const markerKey = `${uid}:${threadId}:${messages.at(-1)?.id || 'empty'}`
  if (markerKey === lastMarkedReadKey) return
  lastMarkedReadKey = markerKey
  markThreadRead({ threadId, uid }).catch(() => {})
}

function syncThreadSubscriptions() {
  const uid = currentUid()
  if (!dockState.open || dockState.mode !== 'thread' || !dockState.activeThreadId || !uid) {
    stopThreadSubscriptions()
    renderDock()
    return
  }

  loadingThreads = true
  loadingMessages = true
  errorMessage = ''
  renderDock()

  unsubscribeThreads()
  unsubscribeMessages()
  unsubscribeHiddenMessages()

  unsubscribeThreads = subscribeToInboxThreads(uid, (threads) => {
    inboxThreads = threads
    activeThread = inboxThreads.find((thread) => thread.id === dockState.activeThreadId) || null
    loadingThreads = false
    if (activeThread) {
      errorMessage = ''
      dockState.title = activeThread.title || dockState.title
      persistState()
      hydrateProfilesForDock()
    } else {
      errorMessage = 'You do not have access to this conversation.'
    }
    renderDock()
  }, (error) => {
    loadingThreads = false
    errorMessage = error?.message || 'Conversation list could not be loaded.'
    renderDock()
  })

  unsubscribeMessages = subscribeToMessages(dockState.activeThreadId, (nextMessages) => {
    messages = nextMessages
    loadingMessages = false
    hydrateProfilesForDock()
    markActiveThreadRead()
    renderDock()
  }, (error) => {
    loadingMessages = false
    errorMessage = error?.message || 'Messages could not be loaded.'
    renderDock()
  })

  unsubscribeHiddenMessages = subscribeToHiddenThreadMessages({
    threadId: dockState.activeThreadId,
    uid,
    callback(ids = []) {
      hiddenMessageIds = new Set(ids)
      renderDock()
    },
    onError() {
      hiddenMessageIds = new Set()
      renderDock()
    }
  })
}

function setDockState(next = {}) {
  dockState = {
    ...dockState,
    ...next,
    ownerUid: currentUid() || dockState.ownerUid || ''
  }
  persistState()
  syncThreadSubscriptions()
  renderDock()
}

export function openChatDock(options = {}) {
  const detail = options?.detail && typeof options.detail === 'object' ? options.detail : options
  const support = detail.support === true || detail.mode === 'support'
  const threadId = String(detail.threadId || detail.activeThreadId || '').trim()
  if (!support && !threadId) return
  if (!initialized) initChatDock()

  setDockState({
    open: true,
    minimized: false,
    mode: support ? 'support' : 'thread',
    activeThreadId: support ? '' : threadId,
    title: String(detail.title || detail.threadTitle || '').trim().slice(0, 160)
  })
  focusComposer()
}

async function handleSubmit(form) {
  const uid = currentUid()
  const threadId = dockState.activeThreadId
  const body = draft.trim()
  if (!uid || !threadId || !body || sending) return
  sending = true
  errorMessage = ''
  renderDock()
  try {
    await sendMessage(threadId, {
      senderId: uid,
      body,
      type: 'text',
      attachments: [],
      clientMessageId: createClientMessageId()
    })
    draft = ''
    const input = form?.querySelector('[data-chat-dock-input]')
    if (input) input.value = ''
    await markThreadRead({ threadId, uid }).catch(() => {})
  } catch (error) {
    errorMessage = error?.message || 'Unable to send message.'
  }
  sending = false
  renderDock()
  focusComposer()
}

function bindRootEvents() {
  root.addEventListener('click', (event) => {
    const minimize = event.target.closest('[data-chat-dock-minimize]')
    if (minimize) {
      event.preventDefault()
      setDockState({ minimized: true })
      return
    }
    const restore = event.target.closest('[data-chat-dock-restore]')
    if (restore) {
      event.preventDefault()
      setDockState({ minimized: false })
      focusComposer()
      return
    }
    const close = event.target.closest('[data-chat-dock-close]')
    if (close) {
      event.preventDefault()
      setDockState({ open: false, minimized: false, activeThreadId: '', title: '', mode: 'thread' })
    }
  })

  root.addEventListener('input', (event) => {
    const input = event.target.closest('[data-chat-dock-input]')
    if (!input) return
    draft = input.value
    const button = input.closest('form')?.querySelector('button[type="submit"]')
    if (button) button.disabled = !draft.trim() || sending
  })

  root.addEventListener('keydown', (event) => {
    const input = event.target.closest('[data-chat-dock-input]')
    if (!input || event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    handleSubmit(input.closest('form'))
  })

  root.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-chat-dock-form]')
    if (!form) return
    event.preventDefault()
    handleSubmit(form)
  })
}

function handleShellUpdate(nextShellState = {}) {
  const previousUid = shellSnapshot?.user?.uid || ''
  shellSnapshot = nextShellState || getShellState()
  const uid = currentUid()
  if (dockState.open && dockState.ownerUid && uid && dockState.ownerUid !== uid) {
    dockState = { open: false, minimized: false, mode: 'thread', activeThreadId: '', title: '', ownerUid: uid }
    persistState()
    stopThreadSubscriptions()
  }
  if (uid && previousUid !== uid && (!dockState.ownerUid || dockState.ownerUid === uid) && dockState.activeThreadId) {
    if (!dockState.ownerUid) {
      dockState.ownerUid = uid
      persistState()
    }
    syncThreadSubscriptions()
  }
  renderDock()
}

export function initChatDock(options = {}) {
  if (initialized) {
    if (typeof options.getShellState === 'function') getShellState = options.getShellState
    if (typeof options.onShellStateChange === 'function' && !hasShellStateListener) {
      unsubscribeShellState = options.onShellStateChange(handleShellUpdate)
      hasShellStateListener = true
    }
    return
  }
  initialized = true
  if (typeof options.getShellState === 'function') getShellState = options.getShellState
  shellSnapshot = getShellState()
  dockState = readStoredState()

  root = document.querySelector('[data-chat-dock-root]')
  if (!root) {
    root = document.createElement('div')
    root.className = 'chat-dock-root'
    root.dataset.chatDockRoot = ''
    document.body.append(root)
  }
  bindRootEvents()
  window.addEventListener(OPEN_EVENT, openChatDock)
  if (typeof options.onShellStateChange === 'function') {
    unsubscribeShellState = options.onShellStateChange(handleShellUpdate)
    hasShellStateListener = true
  }
  syncThreadSubscriptions()
  renderDock()
}

export function destroyChatDock() {
  unsubscribeShellState()
  hasShellStateListener = false
  stopThreadSubscriptions()
  window.removeEventListener(OPEN_EVENT, openChatDock)
  root?.remove()
  root = null
  initialized = false
}
