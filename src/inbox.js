import './styles/base.css'
import './styles/inbox.css'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { ROUTES, authRoute, publicProfileRoute } from './utils/routes'
import { storage } from './firebase/storage'
import { STORAGE_PATHS } from './config/storagePaths'
import {
  addParticipantsToThread,
  createGroupThread,
  createOrGetDm,
  deleteThreadForUser,
  hydrateThreadFromSourceIfNeeded,
  listInboxThreads,
  loadProfilesByUids,
  markThreadDelivered,
  markThreadRead,
  repairMyInboxThreads,
  removeParticipantFromThread,
  addMessageReaction,
  removeMessageReaction,
  subscribeToMessageReactions,
  hideMessageForMe,
  subscribeToHiddenThreadMessages,
  deleteMessageForEveryone,
  editMessage,
  sendMessage,
  setTypingState,
  subscribeToInboxThreads,
  subscribeToMessages,
  subscribeToThreadParticipants,
  subscribeToTypingState,
  setThreadPinnedForUser,
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
  replyDraftByThreadId: {},
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
  attachmentPreviewByThreadId: {},
  messageContextMenu: null,
  threadActionMenu: null,
  threadConfirmModal: null,
  isSavingThreadAction: false,
  deleteSubmenuAnchor: null,
  reactionPickerAnchor: null,
  editingMessageByThreadId: {},
  editDraftByMessageId: {},
  reactionsByThreadId: {},
  hiddenMessageIdsByThreadId: {},
  reactionDetailModal: null,
  reactionUnsubscribe: () => {},
  hiddenMessagesUnsubscribe: () => {},
  hasWindowFocus: document.hasFocus(),
  threadsRealtimeReady: false,
  threadsFallbackTried: false,
  threadsFallbackPending: false,
  hasLoadedThreadsOnce: false,
  inboxRepairAttempted: false,
  isRepairingInbox: false
}

let searchDebounceTimer = null
let typingStopTimer = null
let typingExpiryRefreshTimer = null
let activeTypingThreadId = ''
const typingHeartbeatByThreadId = {}
const TYPING_HEARTBEAT_MS = 2800
const TYPING_IDLE_CLEAR_MS = 4500
const DEBUG_TYPING = false
const imagePreloadCache = new Map()
let chatSettingsSearchSelection = { start: null, end: null }
let hasInitializedAuthObserver = false
let hasBoundInboxDelegates = false
let activeThreadSubscriptionUid = ''
let processedStartUid = ''
const LAST_THREAD_STORAGE_KEY = 'melogic_inbox_last_thread_v1'

function debugTyping(...args) {
  if (DEBUG_TYPING) console.info('[inbox typing]', ...args)
}

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
const floatingRoot = document.createElement('div')
floatingRoot.className = 'inbox-floating-root'
document.body.append(floatingRoot)
setupFloatingEventDelegates()
setupInboxDelegates()

function setupInboxDelegates() {
  if (hasBoundInboxDelegates) return
  hasBoundInboxDelegates = true

  inboxRoot.addEventListener('input', (event) => {
    const composer = event.target.closest('[data-message-composer-input]')
    if (!composer) return
    const threadId = composer.dataset.messageComposerInput || appState.selectedThreadId
    if (!threadId) return
    appState.composerDraftByThreadId[threadId] = composer.value
    const messageForm = composer.closest('[data-message-form]')
    const sendButton = messageForm?.querySelector('button[type="submit"]')
    const attachments = appState.attachmentDraftByThreadId[threadId] || []
    if (sendButton) sendButton.disabled = !composer.value.trim() && !attachments.length
    debugTyping('composer input', threadId, composer.value.length)
    updateTypingHeartbeat(threadId, composer.value)
  })
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function getInitials(user = {}) {
  const source = user.displayName || user.username || user.title || (user.uid ? `User ${String(user.uid).slice(0, 2)}` : 'User')
  return source
    .split(' ')
    .map((part) => part[0] || '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

function getProfileMeta(uid, fallback = {}) {
  const profile = appState.profileByUid[uid] || {}
  const displayName = String(profile.displayName || fallback.displayName || fallback.title || '').trim()
  const username = String(profile.username || fallback.username || '').trim()
  const avatarURL = String(profile.avatarURL || profile.photoURL || fallback.avatarURL || fallback.photoURL || '').trim()
  const uidFallback = uid ? `User ${String(uid).slice(0, 2).toUpperCase()}` : 'User'
  const preferred = displayName || username || uidFallback
  return { uid, displayName: preferred, username, avatarURL, photoURL: avatarURL }
}

function preloadImage(url) {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl) return Promise.resolve(false)
  if (imagePreloadCache.has(normalizedUrl)) return imagePreloadCache.get(normalizedUrl)

  const promise = new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(true)
    img.onerror = () => resolve(false)
    img.src = normalizedUrl
  })
  imagePreloadCache.set(normalizedUrl, promise)
  return promise
}

function preloadThreadImages(threads = []) {
  threads.forEach((thread) => {
    if (thread?.imageURL) preloadImage(thread.imageURL)
    if (thread?.otherProfile?.avatarURL) preloadImage(thread.otherProfile.avatarURL)
    if (thread?.otherProfile?.photoURL) preloadImage(thread.otherProfile.photoURL)
  })
}

function preloadProfileImagesByUid(uids = []) {
  uids.forEach((uid) => {
    const profile = appState.profileByUid[uid] || {}
    const url = profile.avatarURL || profile.photoURL || ''
    if (url) preloadImage(url)
  })
}

function preloadMessageImages(messages = []) {
  messages.forEach((message) => {
    if (!Array.isArray(message?.attachments)) return
    message.attachments.forEach((attachment) => {
      const mime = String(attachment?.mimeType || '')
      if (mime.startsWith('image/') && attachment?.url) preloadImage(attachment.url)
    })
  })
}

async function hydrateProfilesForThread(thread) {
  if (!thread) return
  const ids = Array.from(new Set([
    ...(Array.isArray(thread.participantIds) ? thread.participantIds : []),
    ...(Array.isArray(thread.otherParticipantIds) ? thread.otherParticipantIds : []),
    thread.otherParticipantId || ''
  ].filter(Boolean)))
  if (!ids.length) return
  const missingIds = ids.filter((uid) => !appState.profileByUid[uid])
  if (!missingIds.length) return
  const loaded = await loadProfilesByUids(missingIds)
  const loadedKeys = Object.keys(loaded).filter((uid) => !appState.profileByUid[uid] && loaded[uid])
  if (!loadedKeys.length) return
  console.info(`[inbox] loaded profiles for thread ${thread.id} ${loadedKeys.length}`)
  appState.profileByUid = { ...appState.profileByUid, ...loaded }
  preloadProfileImagesByUid(loadedKeys)
  if (appState.selectedThreadId === thread.id) renderSignedInState()
}

async function hydrateProfilesForMessages(threadId, messages = []) {
  if (!threadId || !messages.length) return
  const senderIds = Array.from(new Set(messages.map((message) => message?.senderId).filter(Boolean)))
  const missing = senderIds.filter((uid) => !appState.profileByUid[uid])
  if (!missing.length) return
  const loaded = await loadProfilesByUids(missing)
  if (!Object.keys(loaded).length) return
  appState.profileByUid = { ...appState.profileByUid, ...loaded }
  preloadProfileImagesByUid(Object.keys(loaded))
}

async function hydrateProfilesForThreads(threads = []) {
  const ids = Array.from(new Set(
    threads.flatMap((thread) => [
      ...(Array.isArray(thread?.participantIds) ? thread.participantIds : []),
      ...(Array.isArray(thread?.otherParticipantIds) ? thread.otherParticipantIds : []),
      thread?.otherParticipantId || ''
    ]).filter(Boolean)
  ))
  const missing = ids.filter((uid) => !appState.profileByUid[uid])
  if (!missing.length) return
  const loaded = await loadProfilesByUids(missing)
  if (!Object.keys(loaded).length) return
  appState.profileByUid = { ...appState.profileByUid, ...loaded }
  preloadProfileImagesByUid(Object.keys(loaded))
}

function upsertThreadInState(nextThread) {
  if (!nextThread?.id) return
  const index = appState.threads.findIndex((thread) => thread.id === nextThread.id)
  if (index === -1) {
    appState.threads = sortInboxThreadsLocal([nextThread, ...appState.threads])
    return
  }
  appState.threads = sortInboxThreadsLocal(
    appState.threads.map((thread) => (thread.id === nextThread.id ? { ...thread, ...nextThread } : thread))
  )
}

function sortInboxThreadsLocal(threads = []) {
  return [...threads].sort((a, b) => {
    const aPinned = Boolean(a.pinned)
    const bPinned = Boolean(b.pinned)
    if (aPinned !== bPinned) return aPinned ? -1 : 1
    if (aPinned && bPinned) {
      const aPinDate = a.pinnedAt || a.updatedAt || a.createdAt || ''
      const bPinDate = b.pinnedAt || b.updatedAt || b.createdAt || ''
      if (aPinDate !== bPinDate) return aPinDate < bPinDate ? 1 : -1
    }
    const aDate = a.lastMessageAt || a.updatedAt || a.createdAt || ''
    const bDate = b.lastMessageAt || b.updatedAt || b.createdAt || ''
    return aDate < bDate ? 1 : -1
  })
}

function threadHasParticipantIds(thread) {
  return Array.isArray(thread?.participantIds) && thread.participantIds.length > 0
}

function hasThinMirrorThreads(threads = []) {
  return threads.some((thread) => !threadHasParticipantIds(thread))
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

function saveLastSelectedThread(uid, threadId) {
  if (!uid || !threadId) return
  try {
    localStorage.setItem(LAST_THREAD_STORAGE_KEY, JSON.stringify({
      uid,
      threadId,
      updatedAt: new Date().toISOString()
    }))
  } catch {
    // noop
  }
}

function loadLastSelectedThread(uid) {
  if (!uid) return ''
  try {
    const parsed = JSON.parse(localStorage.getItem(LAST_THREAD_STORAGE_KEY) || '{}')
    if (parsed?.uid === uid && parsed?.threadId) return String(parsed.threadId)
  } catch {
    // noop
  }
  return ''
}

function getStartUidParam() {
  return String(new URLSearchParams(window.location.search).get('start') || '').trim()
}

function canMarkThreadRead(threadId) {
  return Boolean(
    appState.user?.uid
    && threadId
    && appState.activeFilter === 'Messages'
    && appState.selectedThreadId === threadId
    && document.visibilityState === 'visible'
    && appState.hasWindowFocus
    && document.hasFocus()
  )
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

function formatGapSeparator(value, previousValue) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'Earlier'
  const previous = previousValue ? new Date(previousValue) : null
  const sameDay = previous && !Number.isNaN(previous.getTime()) && previous.toDateString() === date.toDateString()
  if (sameDay) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `Today ${date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
  }
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function describeAttachmentType(fileOrAttachment = {}) {
  const mime = String(fileOrAttachment?.mimeType || fileOrAttachment?.type || '')
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'audio'
  return 'attachment'
}

function summarizeThreadPreview(thread) {
  if (!thread) return 'No messages yet.'
  const lastMessageType = String(thread.lastMessageType || 'text')
  const attachmentCount = Number(thread.lastMessageAttachmentCount || 0)
  const threadText = truncateThreadPreview(thread.lastMessageText || '')
  if (lastMessageType === 'deleted') return 'Message removed'
  if (threadText) return threadText
  if (attachmentCount > 0) return attachmentCount === 1 ? '1 attachment' : `${attachmentCount} attachments`
  if (lastMessageType && lastMessageType !== 'text') {
    if (lastMessageType === 'deleted') return 'Message removed'
    return '1 attachment'
  }

  const cached = appState.messagesByThreadId[thread.id] || []
  const latest = cached[cached.length - 1]
  if (latest) {
    if (latest.deleted) return 'Message removed'
    const latestText = truncateThreadPreview(latest.body || '')
    if (latestText) return latestText
    const cachedAttachmentCount = Array.isArray(latest.attachments) ? latest.attachments.length : 0
    if (cachedAttachmentCount > 0) return cachedAttachmentCount === 1 ? '1 attachment' : `${cachedAttachmentCount} attachments`
    if (latest.createdAt || latest.updatedAt) return 'Sent a message'
  }

  if (thread.lastMessageAt || thread.updatedAt) return 'Sent a message'
  return 'No messages yet.'
}

function truncateThreadPreview(value, max = 20) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max).trimEnd()}…` : text
}

function summarizeMessageAttachmentLabel(message = {}) {
  const attachment = Array.isArray(message.attachments) ? message.attachments[0] : null
  if (!attachment) return ''
  const mime = String(attachment.mimeType || '')
  if (mime.startsWith('image/')) return 'Image'
  if (mime.startsWith('video/')) return 'Video'
  if (mime.startsWith('audio/')) return 'Audio'
  if (mime) return 'File'
  return 'Attachment'
}

function truncateReplyText(value, max = 40) {
  const text = String(value || '').trim()
  if (!text) return ''
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

function getReplyPreviewLabel(reply = {}) {
  const text = truncateReplyText(reply.bodyPreview || '')
  if (text) return text
  return truncateReplyText(reply.attachmentSummary || '') || 'Attachment'
}

function groupReactionsByEmoji(reactions = []) {
  const grouped = new Map()
  reactions.forEach((reaction) => {
    const key = reaction.emoji || ''
    if (!key) return
    const current = grouped.get(key) || { emoji: key, count: 0, uids: new Set() }
    current.count += 1
    if (reaction.uid) current.uids.add(reaction.uid)
    grouped.set(key, current)
  })
  return [...grouped.values()]
}

function applyOptimisticReaction({ threadId, messageId, emoji, uid, add }) {
  if (!threadId || !messageId || !emoji || !uid) return () => {}
  const currentThread = appState.reactionsByThreadId[threadId] || {}
  const currentList = [...(currentThread[messageId] || [])]
  const reactionId = `${uid}_${encodeURIComponent(emoji)}`
  const existsIndex = currentList.findIndex((entry) => entry.id === reactionId || (entry.uid === uid && entry.emoji === emoji))
  if (add && existsIndex === -1) {
    currentList.push({ id: reactionId, uid, emoji, emojiKey: encodeURIComponent(emoji), optimistic: true })
  }
  if (!add && existsIndex !== -1) {
    currentList.splice(existsIndex, 1)
  }
  appState.reactionsByThreadId[threadId] = {
    ...currentThread,
    [messageId]: currentList
  }
  return () => {
    appState.reactionsByThreadId[threadId] = currentThread
  }
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
    const stamp = entry.updatedAt
      ? new Date(entry.updatedAt).getTime()
      : entry.receivedAt
        ? new Date(entry.receivedAt).getTime()
        : 0
    return stamp && now - stamp < 7000
  })
}

function renderTypingUi(threadId) {
  if (!threadId || appState.selectedThreadId !== threadId || appState.activeFilter !== 'Messages') return
  const thread = getSelectedThread()
  if (!thread) return
  const subtitle = getConversationSubtitle(thread)
  const headerSubtitle = inboxRoot.querySelector('.conversation-header-meta p')
  if (headerSubtitle) headerSubtitle.textContent = subtitle
  const inline = inboxRoot.querySelector('[data-typing-indicator-inline]')
  const typingUsers = getTypingUsers(threadId)
  if (!inline) return
  if (!typingUsers.length) {
    inline.textContent = ''
    inline.hidden = true
    return
  }
  inline.textContent = subtitle
  inline.hidden = false
}

function scheduleTypingExpiryRefresh(threadId) {
  if (typingExpiryRefreshTimer) clearTimeout(typingExpiryRefreshTimer)
  const rows = appState.typingUsersByThreadId[threadId] || []
  const expiryTimes = rows
    .filter((entry) => entry?.uid && entry.uid !== appState.user?.uid)
    .map((entry) => {
      const stamp = entry.updatedAt
        ? new Date(entry.updatedAt).getTime()
        : entry.receivedAt
          ? new Date(entry.receivedAt).getTime()
          : 0
      return stamp ? stamp + 7000 : 0
    })
    .filter((stamp) => Number.isFinite(stamp) && stamp > 0)
  if (!expiryTimes.length) return
  const now = Date.now()
  const nextExpiry = Math.min(...expiryTimes.filter((stamp) => stamp > now))
  if (!nextExpiry || !Number.isFinite(nextExpiry)) return
  const delay = Math.max(200, nextExpiry - now + 50)
  typingExpiryRefreshTimer = setTimeout(() => {
    renderTypingUi(threadId)
  }, delay)
}

function clearRealtimeListeners() {
  if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
  appState.threadUnsubscribe()
  appState.messageUnsubscribe()
  appState.participantsUnsubscribe()
  appState.typingUnsubscribe()
  appState.systemUnsubscribe()
  appState.reactionUnsubscribe()
  appState.hiddenMessagesUnsubscribe()
  appState.threadUnsubscribe = () => {}
  appState.messageUnsubscribe = () => {}
  appState.participantsUnsubscribe = () => {}
  appState.typingUnsubscribe = () => {}
  appState.systemUnsubscribe = () => {}
  appState.reactionUnsubscribe = () => {}
  appState.hiddenMessagesUnsubscribe = () => {}
  appState.threadsFallbackPending = false
  appState.hasLoadedThreadsOnce = false
  appState.inboxRepairAttempted = false
  appState.isRepairingInbox = false
  activeThreadSubscriptionUid = ''
  activeTypingThreadId = ''
  closeThreadActionUi()
  if (typingStopTimer) clearTimeout(typingStopTimer)
  if (typingExpiryRefreshTimer) clearTimeout(typingExpiryRefreshTimer)
  floatingRoot.innerHTML = ''
}

function clearTypingForThread(threadId) {
  if (!threadId || !appState.user?.uid) return
  if (typingStopTimer && activeTypingThreadId === threadId) clearTimeout(typingStopTimer)
  delete typingHeartbeatByThreadId[threadId]
  if (activeTypingThreadId === threadId) activeTypingThreadId = ''
  renderTypingUi(threadId)
  debugTyping('clear typing', threadId)
  setTypingState({ threadId, uid: appState.user.uid, isTyping: false }).catch((error) => {
    console.warn('[inbox typing] clear failed', error?.code || '', error?.message || error)
    debugTyping('clear failed', threadId, error)
    warnRealtimePermission(`typing-write-${threadId}`, error)
  })
}

function clearFloatingOverlays() {
  appState.messageContextMenu = null
  appState.deleteSubmenuAnchor = null
  appState.reactionPickerAnchor = null
}

function getCurrentUserTypingIdentity() {
  const uid = appState.user?.uid
  const profile = uid ? (appState.profileByUid[uid] || {}) : {}
  return {
    displayName: appState.user?.displayName || profile.displayName || appState.user?.email?.split('@')[0] || 'Member',
    username: profile.username || appState.user?.username || ''
  }
}

function updateTypingHeartbeat(threadId, value) {
  if (!threadId || !appState.user?.uid) return
  const trimmed = String(value || '').trim()
  if (!trimmed) {
    clearTypingForThread(threadId)
    return
  }
  const now = Date.now()
  const lastBeat = Number(typingHeartbeatByThreadId[threadId] || 0)
  if (!lastBeat || (now - lastBeat) >= TYPING_HEARTBEAT_MS) {
    const identity = getCurrentUserTypingIdentity()
    typingHeartbeatByThreadId[threadId] = now
    debugTyping('set typing true', threadId, { displayName: identity.displayName, username: identity.username })
    setTypingState({
      threadId,
      uid: appState.user?.uid,
      displayName: identity.displayName,
      username: identity.username,
      isTyping: true
    }).then(() => {
      debugTyping('set typing true success', threadId)
    }).catch((error) => {
      console.warn('[inbox typing] set true failed', error?.code || '', error?.message || error)
      debugTyping('set typing true failed', threadId, error)
      warnRealtimePermission(`typing-write-${threadId}`, error)
    })
  }
  if (typingStopTimer) clearTimeout(typingStopTimer)
  activeTypingThreadId = threadId
  typingStopTimer = setTimeout(() => {
    clearTypingForThread(threadId)
  }, TYPING_IDLE_CLEAR_MS)
}

function scrollMessageListToBottom({ behavior = 'auto' } = {}) {
  const list = inboxRoot.querySelector('[data-message-list]')
  if (!list) return
  requestAnimationFrame(() => {
    if (behavior === 'smooth' && typeof list.scrollTo === 'function') {
      list.scrollTo({ top: list.scrollHeight, behavior })
    } else {
      list.scrollTop = list.scrollHeight
    }
    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight
    })
  })
}

function revokeAttachmentPreviews(threadId) {
  const urls = appState.attachmentPreviewByThreadId[threadId] || []
  urls.forEach((url) => {
    try {
      URL.revokeObjectURL(url)
    } catch {
      // noop
    }
  })
}

function setAttachmentDraft(threadId, files = []) {
  if (!threadId) return
  revokeAttachmentPreviews(threadId)
  appState.attachmentDraftByThreadId[threadId] = files
  appState.attachmentPreviewByThreadId[threadId] = files.map((file) => {
    const type = describeAttachmentType(file)
    return type === 'image' ? URL.createObjectURL(file) : ''
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

  if (isMessages && appState.isRepairingInbox) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Restoring conversations…</p>
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
      <button type="button" class="sidebar-thread-pill ${isActive ? 'is-active' : ''}" data-select-thread-id="${thread.id}">
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
  let previousDateKey = ''
  let previousStamp = 0

  messages.forEach((message) => {
    const createdAt = message.createdAt || ''
    const dateKey = createdAt ? new Date(createdAt).toDateString() : 'unknown'
    const createdStamp = createdAt ? new Date(createdAt).getTime() : 0
    const isNewDay = dateKey !== previousDateKey
    const isLargeGap = previousStamp && createdStamp && (createdStamp - previousStamp) >= 2 * 60 * 60 * 1000
    if (isNewDay || isLargeGap) {
      const label = createdAt
        ? (isNewDay ? formatDaySeparator(createdAt) : formatGapSeparator(createdAt, previousStamp))
        : 'Earlier'
      groups.push({ kind: 'separator', id: `sep-${createdAt || Math.random()}`, label })
      previousDateKey = dateKey
    }
    if (createdStamp) previousStamp = createdStamp

    const prev = groups[groups.length - 1]
    const prevGroup = prev?.kind === 'messages' ? prev : null
    const sameSender = prevGroup && prevGroup.senderId === message.senderId
    const closeInTime = (() => {
      if (!sameSender) return false
      const last = prevGroup.messages[prevGroup.messages.length - 1]
      const a = new Date(last.createdAt || 0).getTime()
      const b = new Date(message.createdAt || 0).getTime()
      return b - a < 30 * 60 * 1000
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
  if (thread.type === 'dm' && uid === thread.otherParticipantId && thread.otherProfile) {
    return getProfileMeta(uid, {
      uid,
      displayName: thread.otherProfile.displayName || thread.otherProfile.username || thread.title,
      username: thread.otherProfile.username || '',
      avatarURL: thread.otherProfile.avatarURL || thread.otherProfile.photoURL || thread.imageURL
    })
  }

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

  return getProfileMeta(uid, { uid, displayName: uid === appState.user?.uid ? 'You' : '', title: thread.title })
}

function buildReplyPreview(thread, message) {
  const sender = getParticipantMeta(thread, message.senderId)
  if (message.deleted) {
    return {
      messageId: message.id,
      senderId: message.senderId,
      senderName: sender.displayName || sender.username || getInitials({ uid: message.senderId }),
      bodyPreview: 'Message removed',
      attachmentSummary: '',
      type: String(message.type || 'text'),
      createdAt: message.createdAt || null
    }
  }
  const bodyPreview = truncateReplyText(message.body || '')
  const attachmentSummary = bodyPreview ? '' : summarizeMessageAttachmentLabel(message)
  return {
    messageId: message.id,
    senderId: message.senderId,
    senderName: sender.displayName || sender.username || getInitials({ uid: message.senderId }),
    bodyPreview,
    attachmentSummary,
    type: String(message.type || 'text'),
    createdAt: message.createdAt || null
  }
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
  const hiddenIds = new Set(appState.hiddenMessageIdsByThreadId[thread.id] || [])
  const messages = (appState.messagesByThreadId[thread.id] || []).filter((message) => !hiddenIds.has(message.id))
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
        ? `<div class="cluster-avatar ${sender.avatarURL || sender.photoURL ? 'has-image' : ''}">${sender.avatarURL || sender.photoURL ? `<img decoding="async" src="${escapeHtml(sender.avatarURL || sender.photoURL)}" alt="" />` : `<span>${getInitials(sender)}</span>`}</div>`
        : ''

      const bubbles = entry.messages
        .map((message, messageIndex) => {
          const isSingle = entry.messages.length === 1
          const isFirst = messageIndex === 0
          const isLast = messageIndex === entry.messages.length - 1
          const isMiddle = !isFirst && !isLast
          const canEdit = message.senderId === appState.user?.uid
            && !message.deleted
            && String(message.type || 'text') === 'text'
            && (!Array.isArray(message.attachments) || !message.attachments.length)
          const editingMessageId = appState.editingMessageByThreadId[thread.id] || ''
          const isEditing = editingMessageId === message.id && canEdit
          const editDraft = appState.editDraftByMessageId[message.id] || message.body || ''
          const attachmentsMarkup = Array.isArray(message.attachments) && message.attachments.length
            ? `<div class="message-attachment-list">${message.attachments.map((attachment) => {
              const mime = String(attachment.mimeType || '')
              if (mime.startsWith('image/')) return `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener"><img decoding="async" src="${escapeHtml(attachment.url)}" alt="${escapeHtml(attachment.name || 'Image attachment')}" loading="lazy" /></a>`
              if (mime.startsWith('video/')) return `<video src="${escapeHtml(attachment.url)}" controls preload="metadata"></video>`
              if (mime.startsWith('audio/')) return `<audio src="${escapeHtml(attachment.url)}" controls></audio>`
              return `<a href="${escapeHtml(attachment.url)}" target="_blank" rel="noopener" class="message-file-link">${escapeHtml(attachment.name || 'Download attachment')}</a>`
            }).join('')}</div>`
            : ''
          const reactionList = appState.reactionsByThreadId[thread.id]?.[message.id] || []
          const reactionPills = groupReactionsByEmoji(reactionList)
            .map((reaction) => {
              const mine = reaction.uids.has(appState.user?.uid) ? 'is-mine' : ''
              return `<button type="button" class="reaction-pill ${mine}" data-reaction-pill="${message.id}" data-emoji="${escapeHtml(reaction.emoji)}">${escapeHtml(reaction.emoji)} <span>${reaction.count}</span></button>`
            })
            .join('')
          const editedMarker = message.edited ? '<span class="message-edited-marker">edited</span>' : ''
          const replyTo = message.replyTo && typeof message.replyTo === 'object' ? message.replyTo : null
          const replyMarkup = replyTo
            ? `
              <button type="button" class="message-reply-preview" data-jump-reply-message-id="${escapeHtml(replyTo.messageId)}">
                <strong>${escapeHtml(replyTo.senderName || 'Reply')}</strong>
                <span>${escapeHtml(getReplyPreviewLabel(replyTo))}</span>
              </button>
            `
            : ''
          const bodyMarkup = message.deleted
            ? '<p>Message removed.</p>'
            : isEditing
              ? `
                <div class="message-edit-form">
                  <textarea data-edit-message-input="${message.id}" rows="3" maxlength="1200">${escapeHtml(editDraft)}</textarea>
                  <div class="message-edit-actions">
                    <button type="button" class="button button-muted" data-edit-cancel="${message.id}">Cancel</button>
                    <button type="button" class="button button-accent" data-edit-save="${message.id}">Save</button>
                  </div>
                </div>
              `
              : `<p>${escapeHtml(message.body)}</p>`
          return `
            <article class="message-bubble ${isSingle ? 'is-single' : ''} ${isFirst ? 'is-first' : ''} ${isMiddle ? 'is-middle' : ''} ${isLast ? 'is-last' : ''} ${message.deleted ? 'is-deleted' : ''} ${replyTo ? 'has-reply' : ''}" data-message-id="${message.id}" data-message-thread-id="${thread.id}" data-sender-id="${message.senderId}">
              ${replyMarkup}
              ${bodyMarkup}
              ${attachmentsMarkup}
              ${reactionPills ? `<div class="message-reaction-row">${reactionPills}</div>` : ''}
              ${editedMarker}
            </article>
          `
        })
        .join('')

      return `
        <div class="message-cluster ${isSelf ? 'is-self' : 'is-other'}" data-index="${index}">
          ${avatarMarkup}
          <div class="message-cluster-body">
            ${!isSelf ? `<p class="cluster-sender">${escapeHtml(sender.displayName || sender.username || getInitials({ uid: sender.uid }))}</p>` : ''}
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
  const replyDraft = appState.replyDraftByThreadId[thread.id] || null
  const attachments = appState.attachmentDraftByThreadId[thread.id] || []
  const previewUrls = appState.attachmentPreviewByThreadId[thread.id] || []
  const typingUsers = getTypingUsers(thread.id)

  return `
    <div class="conversation-stack">
      ${getMessageGroupsMarkup(thread)}
      <p class="typing-indicator typing-indicator-inline" data-typing-indicator-inline ${typingUsers.length ? '' : 'hidden'}>${typingUsers.length ? escapeHtml(getConversationSubtitle(thread)) : ''}</p>
      <form class="message-composer" data-message-form>
        <label class="sr-only" for="message-input">Message</label>
        ${replyDraft ? `
          <div class="composer-reply-preview">
            <div class="composer-reply-meta">
              <strong>${escapeHtml(replyDraft.senderName || 'Replying')}</strong>
              <span>${escapeHtml(getReplyPreviewLabel(replyDraft))}</span>
            </div>
            <button type="button" data-clear-reply-draft aria-label="Clear reply">×</button>
          </div>
        ` : ''}
        ${attachments.length ? `<div class="composer-attachment-preview-strip">${attachments.map((file, index) => {
          const type = describeAttachmentType(file)
          const title = escapeHtml(file.name || 'Attachment')
          if (type === 'image') {
            const src = escapeHtml(previewUrls[index] || '')
            return `<article class="composer-attachment-preview is-image" title="${title}"><img decoding="async" src="${src}" alt="${title}" /><small>${title}</small><button type="button" data-remove-attachment="${index}" aria-label="Remove attachment">×</button></article>`
          }
          const ext = escapeHtml((String(file.name || '').split('.').pop() || type).toUpperCase().slice(0, 6))
          return `<article class="composer-attachment-preview is-file" title="${title}"><div class="composer-file-icon">${ext}</div><small>${title}</small><button type="button" data-remove-attachment="${index}" aria-label="Remove attachment">×</button></article>`
        }).join('')}</div>` : ''}
        <textarea id="message-input" name="message" data-message-composer-input="${thread.id}" rows="2" maxlength="1200" placeholder="Write a message..." required>${escapeHtml(draft)}</textarea>
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
      const subtitle = summarizeThreadPreview(thread)
      const pinIndicator = thread.pinned
        ? `
          <div class="thread-pin-indicator" title="Pinned chat" aria-label="Pinned chat">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M8 3h8l-1.5 5 3.5 3H6l3.5-3L8 3Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
              <path d="M12 11v10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <span>Pinned</span>
          </div>
        `
        : ''

      return `
        <article class="thread-row ${isActive ? 'is-active' : ''}" data-thread-row-id="${thread.id}">
          <button class="thread-row-main" type="button" data-select-thread-id="${thread.id}">
            <div class="thread-avatar ${thread.imageURL ? 'has-image' : ''}">
              ${thread.imageURL ? `<img decoding="async" src="${escapeHtml(thread.imageURL)}" alt="" />` : `<span>${initials || getInitials({ uid: thread.id })}</span>`}
            </div>
            <div class="thread-meta">
              <div class="thread-title-row">
                <strong>${escapeHtml(thread.title)}</strong>
                <span>${escapeHtml(formatThreadTimestamp(thread.lastMessageAt || thread.updatedAt || thread.createdAt))}</span>
              </div>
              <div class="thread-preview-row">
                <p>${escapeHtml(subtitle)}</p>
                ${unread > 0 ? `<small class="thread-unread">${unread > 9 ? '9+' : unread}</small>` : thread.type === 'group' ? '<small class="thread-badge">Group</small>' : ''}
              </div>
              ${pinIndicator}
            </div>
          </button>
          <button type="button" class="thread-row-menu-trigger" data-thread-menu-id="${thread.id}" aria-label="Open chat actions">
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="5" r="1.8" fill="currentColor"/>
              <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
              <circle cx="12" cy="19" r="1.8" fill="currentColor"/>
            </svg>
          </button>
        </article>
      `
    })
    .join('')

  return `<div class="inbox-thread-list">${rows}</div>`
}

function getThreadActionMenuMarkup() {
  const menu = appState.threadActionMenu
  if (!menu) return ''
  const thread = appState.threads.find((entry) => entry.id === menu.threadId)
  if (!thread) return ''
  const position = clampMenuPosition(menu.x, menu.y, 180, 120)
  return `
    <div class="message-context-backdrop" data-thread-menu-close>
      <div class="thread-actions-menu" style="left:${position.x}px;top:${position.y}px;">
        <button type="button" data-thread-action="${thread.pinned ? 'unpin' : 'pin'}" data-thread-action-id="${thread.id}">
          ${thread.pinned ? 'Unpin chat' : 'Pin chat'}
        </button>
        <button type="button" data-thread-action="delete" data-thread-action-id="${thread.id}">
          Delete chat
        </button>
      </div>
    </div>
  `
}

function getThreadConfirmModalMarkup() {
  const modal = appState.threadConfirmModal
  if (!modal) return ''
  const map = {
    pin: {
      title: 'Pin chat?',
      body: 'This chat will stay at the top of your conversations.',
      confirm: 'Pin chat',
      danger: false
    },
    unpin: {
      title: 'Unpin chat?',
      body: 'This chat will return to normal conversation order.',
      confirm: 'Unpin chat',
      danger: false
    },
    delete: {
      title: 'Delete chat?',
      body: 'This removes the chat from your inbox. It will not delete the conversation for other people.',
      confirm: 'Delete chat',
      danger: true
    }
  }
  const copy = map[modal.type] || map.delete
  return `
    <div class="thread-confirm-backdrop" data-thread-confirm-close>
      <section class="thread-confirm-modal" role="dialog" aria-modal="true" aria-label="${escapeHtml(copy.title)}">
        <h3>${escapeHtml(copy.title)}</h3>
        <p>${escapeHtml(copy.body)}</p>
        <div class="thread-confirm-actions">
          <button type="button" class="button button-muted" data-thread-confirm-cancel ${appState.isSavingThreadAction ? 'disabled' : ''}>Cancel</button>
          <button type="button" class="button ${copy.danger ? 'thread-confirm-danger' : 'button-accent'}" data-thread-confirm-submit ${appState.isSavingThreadAction ? 'disabled' : ''}>
            ${appState.isSavingThreadAction ? 'Saving…' : escapeHtml(copy.confirm)}
          </button>
        </div>
      </section>
    </div>
  `
}

function selectNextThreadAfterDelete(deletedThreadId) {
  const available = appState.threads.filter((thread) => thread.id !== deletedThreadId && !thread.deleted)
  appState.selectedThreadId = available[0]?.id || ''
}

function closeThreadActionUi() {
  appState.threadActionMenu = null
  appState.threadConfirmModal = null
  appState.isSavingThreadAction = false
}

async function handleThreadConfirmAction() {
  const modal = appState.threadConfirmModal
  if (!modal?.threadId || !appState.user?.uid || appState.isSavingThreadAction) return
  appState.isSavingThreadAction = true
  renderFloatingUi()
  try {
    if (modal.type === 'pin') {
      await setThreadPinnedForUser({ uid: appState.user.uid, threadId: modal.threadId, pinned: true })
      appState.threads = appState.threads.map((thread) => (thread.id === modal.threadId
        ? { ...thread, pinned: true, pinnedAt: new Date().toISOString() }
        : thread))
      appState.threads = sortInboxThreadsLocal(appState.threads)
    }
    if (modal.type === 'unpin') {
      await setThreadPinnedForUser({ uid: appState.user.uid, threadId: modal.threadId, pinned: false })
      appState.threads = appState.threads.map((thread) => (thread.id === modal.threadId
        ? { ...thread, pinned: false, pinnedAt: null }
        : thread))
      appState.threads = sortInboxThreadsLocal(appState.threads)
    }
    if (modal.type === 'delete') {
      await deleteThreadForUser({ uid: appState.user.uid, threadId: modal.threadId })
      appState.threads = appState.threads.filter((thread) => thread.id !== modal.threadId)
      delete appState.messagesByThreadId[modal.threadId]
      if (appState.selectedThreadId === modal.threadId) {
        selectNextThreadAfterDelete(modal.threadId)
        if (appState.selectedThreadId) {
          saveLastSelectedThread(appState.user.uid, appState.selectedThreadId)
          startMessageSubscription(appState.selectedThreadId)
        }
      }
    }
    closeThreadActionUi()
    renderSignedInState()
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to update chat action.'
    appState.isSavingThreadAction = false
    renderFloatingUi()
  }
}

function openThreadActionMenu(threadId, event) {
  if (!threadId) return
  clearFloatingOverlays()
  appState.reactionDetailModal = null
  appState.threadActionMenu = {
    threadId,
    x: event.clientX,
    y: event.clientY
  }
  appState.threadConfirmModal = null
  renderFloatingUi()
}

function openThreadConfirmModal(type, threadId) {
  if (!threadId) return
  appState.threadConfirmModal = { type, threadId }
  appState.threadActionMenu = null
  renderFloatingUi()
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

  const otherParticipant = thread.otherParticipantId || (thread.participantIds || []).find((uid) => uid !== appState.user?.uid)
  const headerMeta = thread.type === 'dm' && otherParticipant
    ? getProfileMeta(otherParticipant, { title: thread.title, avatarURL: thread.imageURL })
    : { displayName: thread.title, avatarURL: thread.imageURL }

  return `
    <header class="conversation-header">
      <div class="thread-avatar ${headerMeta.avatarURL ? 'has-image' : ''}">
        ${headerMeta.avatarURL ? `<img decoding="async" src="${escapeHtml(headerMeta.avatarURL)}" alt="" />` : `<span>${getInitials({ title: headerMeta.displayName })}</span>`}
      </div>
      <div class="conversation-header-meta">
        <h3>${escapeHtml(headerMeta.displayName || thread.title)}</h3>
        <p>${escapeHtml(getConversationSubtitle(thread))}</p>
      </div>
      <button type="button" class="chat-settings-trigger" data-action="open-chat-settings" aria-label="Open chat settings">⋯</button>
    </header>
  `
}

function clampMenuPosition(x, y, width = 180, height = 220) {
  const maxX = Math.max(8, window.innerWidth - width - 8)
  const maxY = Math.max(8, window.innerHeight - height - 8)
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY))
  }
}

function getContextMenuMarkup() {
  const menu = appState.messageContextMenu
  if (!menu) return ''
  const isOwnMessage = menu.senderId === appState.user?.uid
  const isThreadOwner = Boolean(menu.threadCreatedBy) && menu.threadCreatedBy === appState.user?.uid
  const canEdit = isOwnMessage && !menu.deleted && menu.type === 'text' && !menu.hasAttachments
  const canReact = !menu.deleted
  const canReply = !menu.deleted
  const canShowDelete = !menu.deleted && (isOwnMessage || isThreadOwner)
  const canDeleteEveryone = isOwnMessage || isThreadOwner
  const canCopy = !menu.deleted
  const reactionRows = appState.reactionsByThreadId[menu.threadId]?.[menu.messageId] || []
  const canViewReactions = reactionRows.length > 0
  const profileHref = publicProfileRoute({
    uid: menu.senderId,
    preview: menu.senderId === appState.user?.uid
  })
  const pos = clampMenuPosition(menu.x, menu.y)
  const deleteSubPos = clampMenuPosition(pos.x + 176, pos.y + 72, 160, 92)
  const emojiPos = clampMenuPosition(pos.x + 176, pos.y + 36, 220, 56)
  return `
    <div class="message-context-backdrop" data-message-context-close>
      <div class="message-context-menu" data-message-context-menu style="left:${pos.x}px;top:${pos.y}px;">
        ${canReply ? '<button type="button" data-menu-action="reply">Reply</button>' : ''}
        ${canEdit ? '<button type="button" data-menu-action="edit">Edit Message</button>' : ''}
        ${canReact ? '<button type="button" data-menu-action="react">React</button>' : ''}
        ${canViewReactions ? '<button type="button" data-menu-action="view-reactions">View Reactions</button>' : ''}
        ${canCopy ? '<button type="button" data-menu-action="copy">Copy text</button>' : ''}
        ${canShowDelete ? '<button type="button" data-menu-action="delete">Delete Message</button>' : ''}
        ${menu.senderId && !isOwnMessage ? `<button type="button" data-menu-action="profile" data-href="${escapeHtml(profileHref)}">Open Profile</button>` : ''}
        <button type="button" data-menu-action="cancel">Cancel</button>
      </div>
      ${appState.deleteSubmenuAnchor ? `
        <div class="message-context-menu is-submenu" style="left:${deleteSubPos.x}px;top:${deleteSubPos.y}px;">
          <button type="button" data-menu-action="delete-me">Delete for me</button>
          <button type="button" data-menu-action="delete-everyone" ${canDeleteEveryone ? '' : 'disabled'}>Delete for everyone</button>
        </div>
      ` : ''}
      ${appState.reactionPickerAnchor ? `
        <div class="message-context-menu is-submenu is-emoji" style="left:${emojiPos.x}px;top:${emojiPos.y}px;">
          ${['👍', '❤️', '😂', '🔥', '👀', '🎵'].map((emoji) => `<button type="button" data-menu-action="emoji" data-emoji="${emoji}">${emoji}</button>`).join('')}
        </div>
      ` : ''}
    </div>
  `
}

function renderFloatingUi() {
  floatingRoot.innerHTML = `${getContextMenuMarkup()}${getReactionDetailModalMarkup()}${getThreadActionMenuMarkup()}${getThreadConfirmModalMarkup()}`
}

async function handleFloatingMenuAction(button) {
  const action = button.getAttribute('data-menu-action')
  const menu = appState.messageContextMenu
  if (!menu) return

  if (action === 'cancel') {
    clearFloatingOverlays()
    renderFloatingUi()
    return
  }
  if (action === 'edit') {
    appState.editingMessageByThreadId[menu.threadId] = menu.messageId
    const message = (appState.messagesByThreadId[menu.threadId] || []).find((entry) => entry.id === menu.messageId)
    appState.editDraftByMessageId[menu.messageId] = message?.body || ''
    clearFloatingOverlays()
    renderSignedInState()
    return
  }
  if (action === 'reply') {
    const thread = appState.threads.find((entry) => entry.id === menu.threadId)
    const message = (appState.messagesByThreadId[menu.threadId] || []).find((entry) => entry.id === menu.messageId)
    if (thread && message) {
      appState.replyDraftByThreadId[menu.threadId] = buildReplyPreview(thread, message)
    }
    clearFloatingOverlays()
    renderSignedInState()
    return
  }
  if (action === 'react') {
    appState.reactionPickerAnchor = true
    appState.deleteSubmenuAnchor = null
    renderFloatingUi()
    return
  }
  if (action === 'delete') {
    appState.deleteSubmenuAnchor = true
    appState.reactionPickerAnchor = null
    renderFloatingUi()
    return
  }
  if (action === 'profile') {
    const href = button.getAttribute('data-href')
    clearFloatingOverlays()
    renderFloatingUi()
    window.location.assign(href || ROUTES.profilePublic)
    return
  }
  if (action === 'copy') {
    const message = (appState.messagesByThreadId[menu.threadId] || []).find((entry) => entry.id === menu.messageId)
    if (message?.body) {
      try {
        await navigator.clipboard.writeText(message.body)
      } catch {
        // noop
      }
    }
    clearFloatingOverlays()
    renderFloatingUi()
    return
  }
  if (action === 'view-reactions') {
    const reactions = appState.reactionsByThreadId[menu.threadId]?.[menu.messageId] || []
    const reactorUids = Array.from(new Set(reactions.map((entry) => entry.uid).filter(Boolean)))
    if (reactorUids.length) {
      const loaded = await loadProfilesByUids(reactorUids)
      appState.profileByUid = { ...appState.profileByUid, ...loaded }
    }
    appState.reactionDetailModal = { threadId: menu.threadId, messageId: menu.messageId }
    clearFloatingOverlays()
    renderFloatingUi()
    return
  }
  if (action === 'delete-me') {
    await hideMessageForMe({ threadId: menu.threadId, messageId: menu.messageId, uid: appState.user?.uid })
  }
  if (action === 'delete-everyone' && (menu.senderId === appState.user?.uid || menu.threadCreatedBy === appState.user?.uid)) {
    await deleteMessageForEveryone({ threadId: menu.threadId, messageId: menu.messageId, uid: appState.user?.uid })
  }
  if (action === 'emoji') {
    const emoji = button.getAttribute('data-emoji') || ''
    const reactions = appState.reactionsByThreadId[menu.threadId]?.[menu.messageId] || []
    const mine = reactions.find((entry) => entry.uid === appState.user?.uid && entry.emoji === emoji)
    const rollback = applyOptimisticReaction({
      threadId: menu.threadId,
      messageId: menu.messageId,
      emoji,
      uid: appState.user?.uid,
      add: !mine
    })
    renderSignedInState()
    try {
      if (mine) await removeMessageReaction({ threadId: menu.threadId, messageId: menu.messageId, reactionId: mine.id })
      else await addMessageReaction({ threadId: menu.threadId, messageId: menu.messageId, uid: appState.user?.uid, emoji })
    } catch {
      rollback()
      appState.errorMessage = 'Unable to update reaction.'
      renderSignedInState()
    }
  }
  clearFloatingOverlays()
  renderFloatingUi()
}

function setupFloatingEventDelegates() {
  floatingRoot.addEventListener('click', async (event) => {
    const threadConfirmSubmit = event.target.closest('[data-thread-confirm-submit]')
    if (threadConfirmSubmit) {
      event.preventDefault()
      event.stopPropagation()
      await handleThreadConfirmAction()
      return
    }

    const threadConfirmCancel = event.target.closest('[data-thread-confirm-cancel]')
    if (threadConfirmCancel) {
      event.preventDefault()
      event.stopPropagation()
      closeThreadActionUi()
      renderFloatingUi()
      return
    }

    const threadMenuAction = event.target.closest('[data-thread-action]')
    if (threadMenuAction) {
      const threadId = threadMenuAction.getAttribute('data-thread-action-id') || ''
      const action = threadMenuAction.getAttribute('data-thread-action') || ''
      if (action === 'pin' || action === 'unpin' || action === 'delete') {
        openThreadConfirmModal(action, threadId)
      }
      return
    }

    const threadMenuClose = event.target.closest('[data-thread-menu-close]')
    if (threadMenuClose && event.target.hasAttribute('data-thread-menu-close')) {
      appState.threadActionMenu = null
      renderFloatingUi()
      return
    }

    const modalClose = event.target.closest('[data-reaction-modal-close]')
    if (modalClose) {
      if (event.target !== modalClose && !event.target.hasAttribute('data-reaction-modal-close')) return
      appState.reactionDetailModal = null
      renderFloatingUi()
      return
    }

    const menuActionButton = event.target.closest('[data-menu-action]')
    if (menuActionButton) {
      event.preventDefault()
      event.stopPropagation()
      await handleFloatingMenuAction(menuActionButton)
      return
    }

    const closeBackdrop = event.target.closest('[data-message-context-close]')
    if (closeBackdrop && event.target.hasAttribute('data-message-context-close')) {
      clearFloatingOverlays()
      renderFloatingUi()
      return
    }

    const threadConfirmClose = event.target.closest('[data-thread-confirm-close]')
    if (threadConfirmClose && event.target.hasAttribute('data-thread-confirm-close')) {
      closeThreadActionUi()
      renderFloatingUi()
    }
  })

  floatingRoot.addEventListener('contextmenu', (event) => {
    if (event.target.closest('[data-message-context-menu]')) return
    clearFloatingOverlays()
    appState.threadActionMenu = null
    renderFloatingUi()
  })
}

function getReactionDetailModalMarkup() {
  const modal = appState.reactionDetailModal
  if (!modal) return ''
  const reactions = appState.reactionsByThreadId[modal.threadId]?.[modal.messageId] || []
  if (!reactions.length) return ''
  const rows = reactions.map((reaction) => {
    const profile = getProfileMeta(reaction.uid, { uid: reaction.uid })
    const avatar = profile.avatarURL
      ? `<img decoding="async" src="${escapeHtml(profile.avatarURL)}" alt="" />`
      : `<span>${escapeHtml(getInitials(profile))}</span>`
    return `
      <div class="reaction-detail-row">
        <div class="thread-avatar ${profile.avatarURL ? 'has-image' : ''}">${avatar}</div>
        <div class="reaction-detail-meta">
          <strong>${escapeHtml(profile.displayName || profile.username || `User ${String(reaction.uid || '').slice(0, 2).toUpperCase()}`)}</strong>
          <small>@${escapeHtml(profile.username || String(reaction.uid || 'user').slice(0, 16))}</small>
        </div>
        <span>${escapeHtml(reaction.emoji)}</span>
      </div>
    `
  }).join('')
  return `
    <div class="reaction-detail-backdrop" data-reaction-modal-close>
      <section class="reaction-detail-modal" role="dialog" aria-modal="true" aria-label="Reactions">
        <header>
          <h3>Reactions</h3>
          <button type="button" class="create-chat-close" data-reaction-modal-close>×</button>
        </header>
        <div class="reaction-detail-list">${rows}</div>
      </section>
    </div>
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
      appState.threads = sortInboxThreadsLocal([optimistic, ...appState.threads])
    }

    appState.activeFilter = 'Messages'
    appState.selectedThreadId = threadId
    appState.errorMessage = ''
    startMessageSubscription(threadId)
    try {
      const durableThreads = await listInboxThreads(appState.user.uid)
      console.info('[inbox] one-time fallback loaded', durableThreads.length, 'threads')
      appState.threads = durableThreads.length ? sortInboxThreadsLocal(durableThreads) : appState.threads
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
          ${user.avatarURL || user.photoURL ? `<img decoding="async" src="${escapeHtml(user.avatarURL || user.photoURL)}" alt="" />` : `<span>${getInitials(user)}</span>`}
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
                ${user.avatarURL || user.photoURL ? `<img decoding="async" src="${escapeHtml(user.avatarURL || user.photoURL)}" alt="" />` : `<span>${getInitials(user)}</span>`}
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
        ${member.avatarURL ? `<img decoding="async" src="${escapeHtml(member.avatarURL)}" alt="" />` : `<span>${escapeHtml(getInitials(member))}</span>`}
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
              ${profile.avatarURL || profile.photoURL ? `<img decoding="async" src="${escapeHtml(profile.avatarURL || profile.photoURL)}" alt="" />` : `<span>${escapeHtml(getInitials(profile))}</span>`}
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
              ${thread.imageURL ? `<img decoding="async" src="${escapeHtml(thread.imageURL)}" alt="" />` : `<span>${escapeHtml(getInitials({ title: thread.title }))}</span>`}
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
  floatingRoot.innerHTML = ''
}

function bindSharedEvents() {
  inboxRoot.querySelectorAll('[data-inbox-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFilter = button.dataset.inboxFilter || 'Messages'
      if (nextFilter !== 'Messages' && activeTypingThreadId) {
        clearTypingForThread(activeTypingThreadId)
      }
      appState.activeFilter = nextFilter
      renderSignedInState()
    })
  })

  inboxRoot.querySelectorAll('[data-select-thread-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (appState.activeFilter !== 'Messages') {
        appState.activeFilter = 'Messages'
      }

      const threadId = button.getAttribute('data-select-thread-id') || ''
      if (!threadId) return
      if (activeTypingThreadId && activeTypingThreadId !== threadId) clearTypingForThread(activeTypingThreadId)
      if (appState.selectedThreadId && appState.selectedThreadId !== threadId) {
        delete appState.replyDraftByThreadId[appState.selectedThreadId]
      }
      appState.threadActionMenu = null
      appState.threadConfirmModal = null

      appState.selectedThreadId = threadId
      saveLastSelectedThread(appState.user?.uid, threadId)
      appState.errorMessage = ''
      const selectedMirror = appState.threads.find((thread) => thread.id === threadId)
      const hydratedThread = await hydrateThreadFromSourceIfNeeded(selectedMirror)
      if (hydratedThread) {
        upsertThreadInState(hydratedThread)
      }
      startMessageSubscription(threadId)
      hydrateProfilesForThread(getSelectedThread())
      renderSignedInState()

      if (canMarkThreadRead(threadId)) {
        await markThreadRead({ threadId, uid: appState.user?.uid }).catch((error) => {
          warnRealtimePermission(`participants-read-${threadId}`, error)
        })
      }
    })
  })

  inboxRoot.querySelectorAll('[data-thread-menu-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const threadId = button.getAttribute('data-thread-menu-id') || ''
      openThreadActionMenu(threadId, event)
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
    textarea.addEventListener('keydown', async (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        await handleMessageSubmit(messageForm)
      }
    })
    textarea.addEventListener('blur', () => {
      clearTypingForThread(thread.id)
    })
  }

  messageForm?.querySelector('[data-action="attach-file"]')?.addEventListener('click', () => {
    attachmentInput?.click()
  })

  attachmentInput?.addEventListener('change', () => {
    if (!thread) return
    setAttachmentDraft(thread.id, Array.from(attachmentInput.files || []).slice(0, 6))
    renderSignedInState()
  })

  messageForm?.querySelectorAll('[data-remove-attachment]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!thread) return
      const index = Number(button.getAttribute('data-remove-attachment'))
      const current = appState.attachmentDraftByThreadId[thread.id] || []
      setAttachmentDraft(thread.id, current.filter((_, idx) => idx !== index))
      renderSignedInState()
    })
  })

  messageForm?.querySelector('[data-clear-reply-draft]')?.addEventListener('click', () => {
    if (!thread?.id) return
    delete appState.replyDraftByThreadId[thread.id]
    renderSignedInState()
  })

  inboxRoot.querySelectorAll('[data-message-id]').forEach((messageEl) => {
    messageEl.addEventListener('contextmenu', (event) => {
      event.preventDefault()
      const threadId = messageEl.getAttribute('data-message-thread-id')
      const messageId = messageEl.getAttribute('data-message-id')
      const senderId = messageEl.getAttribute('data-sender-id')
      if (!threadId || !messageId) return
      const message = (appState.messagesByThreadId[threadId] || []).find((entry) => entry.id === messageId)
      const selectedThread = appState.threads.find((entry) => entry.id === threadId)
      if (!message) return
      appState.messageContextMenu = {
        x: event.clientX,
        y: event.clientY,
        threadId,
        messageId,
        senderId,
        type: String(message.type || 'text'),
        deleted: Boolean(message.deleted),
        hasAttachments: Array.isArray(message.attachments) && message.attachments.length > 0,
        threadCreatedBy: selectedThread?.createdBy || ''
      }
      appState.deleteSubmenuAnchor = null
      appState.reactionPickerAnchor = null
      renderFloatingUi()
    })
  })

  inboxRoot.querySelectorAll('[data-edit-message-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const messageId = input.getAttribute('data-edit-message-input')
      appState.editDraftByMessageId[messageId] = input.value
    })
  })

  inboxRoot.querySelectorAll('[data-edit-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      const messageId = button.getAttribute('data-edit-cancel')
      if (thread?.id) appState.editingMessageByThreadId[thread.id] = ''
      delete appState.editDraftByMessageId[messageId]
      renderSignedInState()
    })
  })

  inboxRoot.querySelectorAll('[data-edit-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!thread?.id) return
      const messageId = button.getAttribute('data-edit-save')
      const body = appState.editDraftByMessageId[messageId] || ''
      await editMessage({ threadId: thread.id, messageId, uid: appState.user?.uid, body })
      appState.editingMessageByThreadId[thread.id] = ''
      delete appState.editDraftByMessageId[messageId]
      renderSignedInState()
    })
  })

  inboxRoot.querySelectorAll('[data-jump-reply-message-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-jump-reply-message-id')
      if (!targetId) return
      const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(targetId) : targetId.replace(/"/g, '\\"')
      const target = inboxRoot.querySelector(`[data-message-id="${safeId}"]`)
      if (!target) return
      target.scrollIntoView({ block: 'center', behavior: 'smooth' })
      target.classList.add('is-reply-target-highlight')
      window.setTimeout(() => target.classList.remove('is-reply-target-highlight'), 1100)
    })
  })

  inboxRoot.querySelectorAll('[data-reaction-pill]').forEach((button) => {
    button.addEventListener('click', async () => {
      const messageId = button.getAttribute('data-reaction-pill')
      const emoji = button.getAttribute('data-emoji') || ''
      if (!thread?.id || !messageId || !emoji) return
      const reactionRows = appState.reactionsByThreadId[thread.id]?.[messageId] || []
      const mine = reactionRows.find((entry) => entry.uid === appState.user?.uid && entry.emoji === emoji)
      const rollback = applyOptimisticReaction({
        threadId: thread.id,
        messageId,
        emoji,
        uid: appState.user?.uid,
        add: !mine
      })
      renderSignedInState()
      try {
        if (mine) await removeMessageReaction({ threadId: thread.id, messageId, uid: appState.user?.uid, emoji })
        else await addMessageReaction({ threadId: thread.id, messageId, uid: appState.user?.uid, emoji })
      } catch {
        rollback()
        appState.errorMessage = 'Unable to update reaction.'
        renderSignedInState()
      }
    })
  })


  if (messageForm) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      await handleMessageSubmit(messageForm)
    })
  }

  const list = inboxRoot.querySelector('[data-message-list]')
  if (list && (appState.messageContextMenu || appState.threadActionMenu)) {
    list.addEventListener('scroll', () => {
      clearFloatingOverlays()
      appState.threadActionMenu = null
      renderFloatingUi()
    }, { once: true })
  }
}

function renderSignedInState() {
  inboxRoot.innerHTML = appState.activeFilter === 'Messages' ? renderMessagesLayout() : renderActivityLayout(appState.activeFilter)
  bindSharedEvents()
  renderCreateChatModal()
  renderChatSettingsModal()
  renderFloatingUi()
  scrollMessageListToBottom()
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
    await sendMessage(thread.id, {
      senderId: appState.user.uid,
      body,
      type: 'text',
      attachments,
      replyTo: appState.replyDraftByThreadId[thread.id] || null
    })
    appState.errorMessage = ''
    field.value = ''
    appState.composerDraftByThreadId[thread.id] = ''
    delete appState.replyDraftByThreadId[thread.id]
    setAttachmentDraft(thread.id, [])
    clearTypingForThread(thread.id)
    if (canMarkThreadRead(thread.id)) {
      await markThreadRead({ threadId: thread.id, uid: appState.user.uid }).catch((error) => {
        warnRealtimePermission(`participants-read-${thread.id}`, error)
      })
    }
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to send message.'
  }

  renderSignedInState()
  scrollMessageListToBottom()
}

function startThreadDetailSubscriptions(threadId) {
  appState.participantsUnsubscribe()
  appState.typingUnsubscribe()
  if (typingExpiryRefreshTimer) clearTimeout(typingExpiryRefreshTimer)

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
    const previousRows = appState.typingUsersByThreadId[threadId] || []
    const nowIso = new Date().toISOString()
    const normalizedRows = typingRows.map((entry) => ({ ...entry, receivedAt: entry.receivedAt || nowIso }))
    appState.typingUsersByThreadId[threadId] = normalizedRows
    debugTyping('typing snapshot', threadId, normalizedRows)
    scheduleTypingExpiryRefresh(threadId)
    const previousOther = previousRows
      .filter((entry) => entry?.uid && entry.uid !== appState.user?.uid)
      .map((entry) => entry.uid)
      .sort()
      .join('|')
    const nextOther = normalizedRows
      .filter((entry) => entry?.uid && entry.uid !== appState.user?.uid)
      .map((entry) => entry.uid)
      .sort()
      .join('|')
    if (appState.selectedThreadId === threadId && previousOther !== nextOther) {
      renderTypingUi(threadId)
    }
  }, (error) => {
    debugTyping('typing subscription error', threadId, error)
    warnRealtimePermission(`typing-${threadId}`, error)
  })
}

function startMessageSubscription(threadId) {
  if (!threadId || !appState.user?.uid) return
  const selectedMirror = appState.threads.find((thread) => thread.id === threadId)
  hydrateThreadFromSourceIfNeeded(selectedMirror).then((hydratedThread) => {
    if (!hydratedThread) return
    upsertThreadInState(hydratedThread)
    hydrateProfilesForThread(hydratedThread)
  }).catch(() => {})

  appState.messageUnsubscribe()
  appState.reactionUnsubscribe()
  appState.hiddenMessagesUnsubscribe()
  appState.loadingMessageThreadId = threadId
  startThreadDetailSubscriptions(threadId)

  appState.messageUnsubscribe = subscribeToMessages(threadId, async (messages) => {
    appState.messagesByThreadId[threadId] = messages
    preloadMessageImages(messages)
    appState.loadingMessageThreadId = ''
    await hydrateProfilesForMessages(threadId, messages)
    appState.reactionUnsubscribe()
    appState.reactionUnsubscribe = subscribeToMessageReactions(threadId, messages.map((message) => message.id), (reactionsByMessageId) => {
      appState.reactionsByThreadId[threadId] = reactionsByMessageId
      if (appState.selectedThreadId === threadId) renderSignedInState()
    }, (error) => warnRealtimePermission(`reactions-${threadId}`, error))

    await markThreadDelivered({ threadId, uid: appState.user.uid }).catch((error) => {
      warnRealtimePermission(`participants-delivered-${threadId}`, error)
    })
    if (appState.selectedThreadId === threadId) {
      renderSignedInState()
      if (canMarkThreadRead(threadId)) {
        await markThreadRead({ threadId, uid: appState.user.uid }).catch((error) => {
          warnRealtimePermission(`participants-read-${threadId}`, error)
        })
      }
    }
  }, (error) => {
    warnRealtimePermission(`messages-${threadId}`, error)
  })

  appState.hiddenMessagesUnsubscribe = subscribeToHiddenThreadMessages({
    threadId,
    uid: appState.user.uid,
    callback: (hiddenIds) => {
      appState.hiddenMessageIdsByThreadId[threadId] = hiddenIds
      const replyDraft = appState.replyDraftByThreadId[threadId]
      if (replyDraft?.messageId && hiddenIds.includes(replyDraft.messageId)) {
        delete appState.replyDraftByThreadId[threadId]
      }
      if (appState.selectedThreadId === threadId) renderSignedInState()
    },
    onError: (error) => warnRealtimePermission(`hidden-${threadId}`, error)
  })
}

function startThreadSubscription() {
  if (!appState.user?.uid) return
  if (activeThreadSubscriptionUid === appState.user.uid) return

  console.info('[inbox] inbox mirror subscription started')
  activeThreadSubscriptionUid = appState.user.uid
  appState.isLoadingThreads = true
  appState.threadsRealtimeReady = false
  appState.threadsFallbackTried = false
  appState.threadsFallbackPending = false
  appState.inboxRepairAttempted = false
  appState.isRepairingInbox = false
  renderSignedInState()

  appState.threadUnsubscribe()
  appState.threadUnsubscribe = subscribeToInboxThreads(appState.user.uid, (threads) => {
    appState.threads = sortInboxThreadsLocal(threads)
    preloadThreadImages(threads)
    hydrateProfilesForThreads(threads).catch(() => {})
    appState.isLoadingThreads = false
    appState.threadsRealtimeReady = true
    appState.hasLoadedThreadsOnce = true

    if (hasThinMirrorThreads(threads) && !appState.inboxRepairAttempted) {
      const firstThinThread = threads.find((thread) => !threadHasParticipantIds(thread))
      if (firstThinThread?.id) {
        console.info(`[inbox] mirror thread missing participantIds; hydrating from source ${firstThinThread.id}`)
      }
      appState.inboxRepairAttempted = true
      appState.isRepairingInbox = true
      console.info('[inbox] repairMyInboxThreads started')
      renderSignedInState()
      repairMyInboxThreads()
        .then(async ({ repairedCount }) => {
          console.info('[inbox] repairMyInboxThreads completed', { repairedCount })
          console.info('[inbox] repaired inbox mirrors', repairedCount)
          appState.isRepairingInbox = false
          const repairedThreads = await listInboxThreads(appState.user.uid)
          appState.threads = sortInboxThreadsLocal(repairedThreads)
          preloadThreadImages(repairedThreads)
          appState.hasLoadedThreadsOnce = true
          if (repairedThreads.length && !appState.selectedThreadId) {
            appState.selectedThreadId = repairedThreads[0].id
            saveLastSelectedThread(appState.user?.uid, appState.selectedThreadId)
          }
          if (appState.selectedThreadId && !appState.messagesByThreadId[appState.selectedThreadId]) {
            startMessageSubscription(appState.selectedThreadId)
          }
          renderSignedInState()
        })
        .catch((repairError) => {
          appState.isRepairingInbox = false
          warnRealtimePermission(`threads-repair-${appState.user.uid}`, repairError)
          renderSignedInState()
        })
      return
    }

    if (!threads.length) {
      if (!appState.inboxRepairAttempted) {
        appState.inboxRepairAttempted = true
        appState.isRepairingInbox = true
        console.info('[inbox] repairMyInboxThreads started')
        renderSignedInState()
        repairMyInboxThreads()
          .then(async ({ repairedCount }) => {
            console.info('[inbox] repairMyInboxThreads completed', { repairedCount })
            console.info('[inbox] repaired inbox mirrors', repairedCount)
            appState.isRepairingInbox = false
            const repairedThreads = await listInboxThreads(appState.user.uid)
            appState.threads = sortInboxThreadsLocal(repairedThreads)
            preloadThreadImages(repairedThreads)
            appState.hasLoadedThreadsOnce = true
            if (repairedThreads.length && !appState.selectedThreadId) {
              appState.selectedThreadId = repairedThreads[0].id
              saveLastSelectedThread(appState.user?.uid, appState.selectedThreadId)
            }
            if (appState.selectedThreadId && !appState.messagesByThreadId[appState.selectedThreadId]) {
              startMessageSubscription(appState.selectedThreadId)
            }
            renderSignedInState()
          })
          .catch((repairError) => {
            appState.isRepairingInbox = false
            warnRealtimePermission(`threads-repair-${appState.user.uid}`, repairError)
            renderSignedInState()
          })
        return
      }

      if (!appState.threadsFallbackTried) {
        console.info('[inbox] inbox mirror fallback used')
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
            appState.threads = sortInboxThreadsLocal(fallbackThreads)
            preloadThreadImages(fallbackThreads)
            const restored = !getStartUidParam() ? loadLastSelectedThread(appState.user?.uid) : ''
            appState.selectedThreadId = fallbackThreads.some((thread) => thread.id === restored) ? restored : fallbackThreads[0].id
            saveLastSelectedThread(appState.user?.uid, appState.selectedThreadId)
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
      const restored = !getStartUidParam() ? loadLastSelectedThread(appState.user?.uid) : ''
      appState.selectedThreadId = threads.some((thread) => thread.id === restored) ? restored : threads[0].id
      saveLastSelectedThread(appState.user?.uid, appState.selectedThreadId)
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
      console.info('[inbox] inbox mirror fallback used')
      const fallbackThreads = await listInboxThreads(appState.user.uid)
      appState.threadsFallbackPending = false
      appState.hasLoadedThreadsOnce = true
      console.info('[inbox] one-time fallback loaded', fallbackThreads.length, 'threads')
      appState.threads = sortInboxThreadsLocal(fallbackThreads)
      preloadThreadImages(fallbackThreads)
      if (fallbackThreads.length && !appState.selectedThreadId) {
        const restored = !getStartUidParam() ? loadLastSelectedThread(appState.user?.uid) : ''
        appState.selectedThreadId = fallbackThreads.some((thread) => thread.id === restored) ? restored : fallbackThreads[0].id
        saveLastSelectedThread(appState.user?.uid, appState.selectedThreadId)
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
  if (event.key === 'Escape' && appState.reactionDetailModal) {
    appState.reactionDetailModal = null
    renderFloatingUi()
    return
  }
  if (event.key === 'Escape' && appState.messageContextMenu) {
    clearFloatingOverlays()
    renderFloatingUi()
    return
  }
  if (event.key === 'Escape' && (appState.threadActionMenu || appState.threadConfirmModal)) {
    closeThreadActionUi()
    renderFloatingUi()
    return
  }
  if (event.key === 'Escape' && appState.isChatSettingsOpen && !appState.isSavingChatSettings) {
    closeChatSettingsModal()
    return
  }
  if (event.key === 'Escape' && appState.isCreateChatOpen && !appState.isCreatingChat) {
    closeCreateChatModal()
  }
}

document.addEventListener('keydown', handleGlobalKeydown)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    appState.hasWindowFocus = document.hasFocus()
    const threadId = appState.selectedThreadId
    if (canMarkThreadRead(threadId)) {
      markThreadRead({ threadId, uid: appState.user?.uid }).catch((error) => {
        warnRealtimePermission(`participants-read-${threadId}`, error)
      })
    }
  }
})
window.addEventListener('focus', () => {
  appState.hasWindowFocus = true
  const threadId = appState.selectedThreadId
  if (canMarkThreadRead(threadId)) {
    markThreadRead({ threadId, uid: appState.user?.uid }).catch((error) => {
      warnRealtimePermission(`participants-read-${threadId}`, error)
    })
  }
})
window.addEventListener('blur', () => {
  appState.hasWindowFocus = false
  if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
})
window.addEventListener('beforeunload', () => {
  if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
})
window.addEventListener('pagehide', () => {
  if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
})

waitForInitialAuthState().then(async (user) => {
  if (!user) {
    if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
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
        saveLastSelectedThread(user.uid, thread.id)
        try {
          const durableThreads = await listInboxThreads(user.uid)
          console.info('[inbox] one-time fallback loaded', durableThreads.length, 'threads')
          appState.threads = durableThreads.length ? sortInboxThreadsLocal(durableThreads) : appState.threads
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
    if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
    clearRealtimeListeners()
    window.location.assign(authRoute({ redirect: ROUTES.inbox }))
    return
  }

  if (appState.user?.uid && appState.user.uid !== user.uid) {
    if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
    clearRealtimeListeners()
  }
  appState.user = user
  appState.activeFilter = appState.activeFilter || 'Messages'
  renderSignedInState()
  startThreadSubscription()
  startSystemNotificationSubscription()
})
