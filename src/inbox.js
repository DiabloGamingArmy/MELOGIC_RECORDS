import './styles/base.css'
import './styles/inbox.css'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { navShell } from './components/navShell'
import { closeChatDock, getChatDockState, openChatDock } from './components/chatDock'
import { initShellChrome } from './appBoot'
import { subscribeToAuthState, waitForInitialAuthState } from './firebase/auth'
import { getEffectiveProfile } from './firebase/firestore'
import { ROUTES, authRoute, communityPostRoute, inboxActiveCallRoute, productRoute, publicProfileRoute } from './utils/routes'
import { iconSvg } from './utils/icons'
import { storage } from './firebase/storage'
import { STORAGE_PATHS } from './config/storagePaths'
import {
  INITIAL_MESSAGE_LIMIT,
  OLDER_MESSAGE_PAGE_SIZE,
  addParticipantsToThread,
  createGroupThread,
  createOrGetDm,
  createOrGetResonaThread,
  blockUser,
  subscribeToBlockedUsers,
  restoreThreadForUser,
  refreshResonaThread,
  reportResonaMessage,
  unblockUser,
  deleteThreadForUser,
  hydrateThreadFromSourceIfNeeded,
  getThread,
  getThreadParticipantUids,
  listInboxThreads,
  loadProfilesByUids,
  listOlderMessages,
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
  subscribeToThread,
  subscribeToTypingState,
  setThreadPinnedForUser,
  setThreadResonaAgent,
  clearResonaChatHistory,
  setResonaMessageFeedback,
  updateThreadDetails
} from './data/inboxService'
import { searchProfilesByUsername } from './data/profileSearchService'
import {
  hideAccountEvent,
  markAccountEventRead,
  setAccountEventRead,
  subscribeToAccountEvents
} from './services/accountEvents'
import {
  hideSystemNotification,
  markSystemNotificationRead,
  setSystemNotificationRead,
  subscribeToSystemNotifications
} from './data/systemNotificationService'
import { buildInboxPinId, deleteInboxPin, subscribeToInboxPins, upsertInboxPin } from './data/inboxPinService'
import {
  acceptAccountCall,
  cancelAccountCall,
  createAccountAudioCall,
  declineAccountCall,
  endAccountCall,
  getAccountCall,
  markAccountCallMissed,
  watchAccountCall,
  watchIncomingAccountCalls,
  watchRecentAccountCalls
} from './data/accountCallService'
import { AccountAudioCallManager } from './webrtc/accountAudioCallManager'
import {
  contentViewForNotification,
  normalizeNotificationPreferences,
  notificationIsEnabled
} from './data/notificationPreferences'
import { setProfileFollowState } from './data/profileService'
import {
  dismissSuggestion,
  getMutualUserSuggestions,
  getPlatformDiscoveryRecommendations,
  matchContacts,
  saveClientCapabilities,
  searchUsersByUsername
} from './data/mutualUsersService'
import { detectPlatformCapabilities } from './platform/platformCapabilities'
import { acceptProductGift, denyProductGift, listIncomingProductGifts } from './data/productGiftService'

const app = document.querySelector('#app')
const RESONA_AGENT_ID = 'resona'
const RESONA_AVATAR_PATH = 'assets/profilePictures/aiSupport/resona.png'
const RESONA_SUPPORT_AVATAR_PATH = 'assets/profilePictures/staff/supportAgentResona.png'
const RESONA_BACKGROUND_PATH = 'assets/profilePictures/aiSupport/resonaBackground.png'
const RESONA_BACKGROUND_CACHE_KEY = 'melogic_resona_background_v1'
const RESONA_BACKGROUND_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const SITE_GUIDANCE_REFRESH_EVENT = 'melogic:site-guidance-refresh-context'

const inboxFilters = [
  { label: 'Messages', path: ROUTES.inboxMessages },
  { label: 'Calls', path: ROUTES.inboxCalls },
  { label: 'Content', path: ROUTES.inboxContentAll },
  { label: 'Mutual Users', path: ROUTES.inboxMutualUsers },
  { label: 'System', path: ROUTES.inboxSystem }
]
const contentViews = new Set(['all', 'likes', 'follows', 'comments', 'mentions', 'gifts', 'collaborations'])
const initialSystemFilter = new URLSearchParams(window.location.search).get('system')

function parseInboxRoute(pathname = window.location.pathname) {
  const segments = String(pathname || '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
  if (segments[0] !== 'inbox') return { valid: false, section: 'Messages', canonicalPath: ROUTES.inboxMessages }
  if (segments.length === 1) {
    return initialSystemFilter
      ? { valid: true, section: 'System', canonicalPath: ROUTES.inboxSystem }
      : { valid: true, section: 'Messages', canonicalPath: ROUTES.inboxMessages }
  }
  if (segments[1] === 'messages' && segments.length === 2) {
    return { valid: true, section: 'Messages', canonicalPath: ROUTES.inboxMessages }
  }
  if (segments[1] === 'system' && segments.length === 2) {
    return { valid: true, section: 'System', canonicalPath: ROUTES.inboxSystem }
  }
  if (segments[1] === 'mutual-users' && segments.length === 2) {
    return { valid: true, section: 'Mutual Users', canonicalPath: ROUTES.inboxMutualUsers }
  }
  if (segments[1] === 'content') {
    const contentView = contentViews.has(segments[2]) ? segments[2] : 'all'
    return {
      valid: segments.length <= 3 && (!segments[2] || contentViews.has(segments[2])),
      section: 'Content',
      contentView,
      canonicalPath: `${ROUTES.inboxContent}/${contentView}`
    }
  }
  if (segments[1] === 'calls') {
    if (segments.length === 2) {
      return { valid: true, section: 'Calls', callView: 'overview', targetId: '', canonicalPath: ROUTES.inboxCalls }
    }
    if (segments[2] === 'active' && segments[3] && segments.length === 4) {
      let targetId = ''
      try {
        targetId = decodeURIComponent(segments[3])
      } catch {
        targetId = ''
      }
      return {
        valid: Boolean(targetId),
        section: 'Calls',
        callView: 'active',
        targetId,
        canonicalPath: inboxActiveCallRoute(targetId)
      }
    }
  }
  return { valid: false, section: 'Messages', canonicalPath: ROUTES.inboxMessages }
}

const initialInboxRoute = parseInboxRoute()
const securityAccountEventTypes = new Set([
  'password_reset_requested',
  'password_changed',
  'email_verification_requested',
  'email_verified',
  'email_change_requested',
  'email_changed',
  'two_factor_enabled',
  'two_factor_disabled',
  'recovery_codes_generated',
  'recovery_code_used',
  'admin_role_changed',
  'account_suspended',
  'account_unsuspended',
  'login_success',
  'login_failed',
  'security_notice'
])

const activityCopy = {
  All: {
    title: 'All',
    emptyTitle: 'No content activity yet.',
    emptyBody: 'Likes, follows, comments, and mentions connected to your work will appear here.'
  },
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
  Gifts: {
    title: 'Gifts',
    emptyTitle: 'No product gifts yet.',
    emptyBody: 'Products sent to you by creators will appear here.'
  },
  Collaborations: {
    title: 'Collaborations',
    emptyTitle: 'No collaboration invites yet.',
    emptyBody: 'Collaboration invites will appear here.'
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
  resonaThreadId: '',
  resonaAvatarURL: '',
  resonaAvatarRequested: false,
  resonaSupportAvatarURL: '',
  resonaSupportAvatarRequested: false,
  resonaBackgroundURL: '',
  resonaBackgroundRequested: false,
  resonaFeedbackByMessageId: {},
  resonaActionMenu: null,
  resonaSpeakingMessageId: '',
  openingResonaThread: false,
  messagesByThreadId: {},
  messageSnapshotVersionByThreadId: {},
  messagePaginationByThreadId: {},
  participantsByThreadId: {},
  typingUsersByThreadId: {},
  blockedUsersByUid: {},
  revealBlockedMessageIdsByThreadId: {},
  loadingMessageThreadId: '',
  optimisticMessagesByThreadId: {},
  preparingThreadIds: {},
  activeFilter: initialInboxRoute.section,
  contentView: initialInboxRoute.contentView || 'all',
  callView: initialInboxRoute.callView || 'overview',
  activeCallTargetId: initialInboxRoute.targetId || '',
  threadUnsubscribe: () => {},
  messageUnsubscribe: () => {},
  participantsUnsubscribe: () => {},
  typingUnsubscribe: () => {},
  sourceThreadUnsubscribe: () => {},
  blockedUsersUnsubscribe: () => {},
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
  productGifts: [],
  productGiftsLoading: false,
  productGiftsError: '',
  productGiftActionId: '',
  productGiftAction: '',
  productGiftActionMessage: '',
  productGiftActionError: '',
  accountEvents: [],
  notificationPreferences: normalizeNotificationPreferences(),
  inboxPins: [],
  inboxPinsUnsubscribe: () => {},
  isSavingInboxPin: '',
  systemFilter: ['account', 'security'].includes(initialSystemFilter) ? initialSystemFilter : 'all',
  systemUnsubscribe: () => {},
  accountEventsUnsubscribe: () => {},
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
  notificationActionMenu: null,
  notificationActionMessage: '',
  mutualUsers: {
    capabilities: detectPlatformCapabilities(),
    capabilitiesSaved: false,
    suggestions: [],
    searchQuery: '',
    searchResults: [],
    loading: false,
    loaded: false,
    searchLoading: false,
    error: '',
    searchError: '',
    actionUid: '',
    contactIdentifiers: [],
    contactStatus: '',
    matching: false
  },
  threadActionMenu: null,
  threadConfirmModal: null,
  isSavingThreadAction: false,
  deleteSubmenuAnchor: null,
  reactionPickerAnchor: null,
  editingMessageByThreadId: {},
  editDraftByMessageId: {},
  reactionsByThreadId: {},
  reactionMessageIdsByThreadId: {},
  hiddenMessageIdsByThreadId: {},
  reactionDetailModal: null,
  imagePreviewModal: null,
  reactionUnsubscribe: () => {},
  hiddenMessagesUnsubscribe: () => {},
  incomingCalls: [],
  recentCalls: [],
  activeCall: null,
  callUiState: 'idle',
  callError: '',
  callMuted: false,
  callActionPending: '',
  incomingCallsUnsubscribe: () => {},
  recentCallsUnsubscribe: () => {},
  activeCallUnsubscribe: () => {},
  hasWindowFocus: document.hasFocus(),
  threadsRealtimeReady: false,
  threadsFallbackTried: false,
  threadsFallbackPending: false,
  hasLoadedThreadsOnce: false,
  inboxRepairAttempted: false,
  isRepairingInbox: false,
  messageFind: {
    open: false,
    query: '',
    activeIndex: -1,
    matchCount: 0
  }
}

let searchDebounceTimer = null
let mutualUserSearchTimer = null
let typingStopTimer = null
let typingExpiryRefreshTimer = null
let messageSubscriptionFallbackTimer = null
let activeTypingThreadId = ''
const typingHeartbeatByThreadId = {}
const TYPING_HEARTBEAT_MS = 2800
const TYPING_IDLE_CLEAR_MS = 4500
const MAX_ATTACHMENT_BYTES = 256 * 1024 * 1024
const MAX_ATTACHMENT_LABEL = '256 MB'
const DEBUG_TYPING = false
const INBOX_RENDER_DEBUG = false
const INBOX_SCROLL_DEBUG = false
const INBOX_AVATAR_DEBUG = false
const ACCOUNT_CALL_DEBUG = false
const INBOX_NEW_THREAD_DEBUG = false
const imagePreloadCache = new Map()
const attachmentUrlCache = new Map()
const attachmentUrlErrorCache = new Map()
const hydratedProfileUids = new Set()
const conversationAutoFillByThreadId = new Map()
const locallyCreatedThreadIds = new Set()
let chatSettingsSearchSelection = { start: null, end: null }
let hasInitializedAuthObserver = false
let hasBoundInboxDelegates = false
let activeThreadSubscriptionUid = ''
let activeMessageSubscriptionThreadId = ''
let processedStartUid = ''
let accountCallManager = null
let accountCallTimeout = null
let accountCallTimer = null
const LAST_THREAD_STORAGE_KEY = 'melogic_inbox_last_thread_v1'

function debugTyping(...args) {
  if (DEBUG_TYPING) console.info('[inbox typing]', ...args)
}

function debugInboxRender(...args) {
  if (INBOX_RENDER_DEBUG) console.info('[inbox render]', ...args)
}

function debugInboxAvatar(...args) {
  if (INBOX_AVATAR_DEBUG) console.info('[inbox avatar]', ...args)
}

function debugAccountCall(...args) {
  if (ACCOUNT_CALL_DEBUG) console.info('[inbox account-call]', ...args)
}

function debugInboxSend(...args) {
  if (INBOX_NEW_THREAD_DEBUG) console.info('[inbox new thread]', ...args)
}

function inboxRouteWithCurrentSearch(path) {
  const search = new URLSearchParams(window.location.search)
  if (!path.startsWith(ROUTES.inboxSystem)) search.delete('system')
  if (!path.startsWith(ROUTES.inboxMessages)) search.delete('start')
  const query = search.toString()
  return `${path}${query ? `?${query}` : ''}`
}

function applyInboxRoute(route = parseInboxRoute()) {
  appState.activeFilter = route.section
  appState.contentView = route.contentView || 'all'
  appState.callView = route.callView || 'overview'
  appState.activeCallTargetId = route.targetId || ''
}

function navigateInbox(path, { replace = false } = {}) {
  const nextUrl = inboxRouteWithCurrentSearch(path)
  const currentUrl = `${window.location.pathname}${window.location.search}`
  if (nextUrl !== currentUrl) {
    window.history[replace ? 'replaceState' : 'pushState']({ inbox: true }, '', nextUrl)
  }
  applyInboxRoute(parseInboxRoute(path))
  renderSignedInState()
  if (appState.activeFilter === 'Mutual Users') initializeMutualUsers()
}

function normalizeInitialInboxRoute() {
  const route = parseInboxRoute()
  applyInboxRoute(route)
  const currentPath = window.location.pathname.replace(/\/+$/, '') || '/'
  if (!route.valid || currentPath === ROUTES.inbox || currentPath === ROUTES.inboxContent) {
    const nextUrl = inboxRouteWithCurrentSearch(route.canonicalPath)
    window.history.replaceState({ inbox: true }, '', nextUrl)
  }
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
const remoteCallAudio = document.createElement('audio')
remoteCallAudio.autoplay = true
remoteCallAudio.playsInline = true
remoteCallAudio.hidden = true
remoteCallAudio.dataset.accountCallRemoteAudio = 'true'
document.body.append(remoteCallAudio)
setupFloatingEventDelegates()
setupInboxDelegates()

function setupInboxDelegates() {
  if (hasBoundInboxDelegates) return
  hasBoundInboxDelegates = true

  inboxRoot.addEventListener('input', (event) => {
    const findInput = event.target.closest('[data-message-find-input]')
    if (findInput) {
      appState.messageFind.query = findInput.value
      appState.messageFind.activeIndex = findInput.value.trim() ? 0 : -1
      applyMessageFind()
      return
    }

    const composer = event.target.closest('[data-message-composer-input]')
    if (!composer) return
    const threadId = composer.dataset.messageComposerInput || appState.selectedThreadId
    if (!threadId) return
    appState.composerDraftByThreadId[threadId] = composer.value
    const messageForm = composer.closest('[data-message-form]')
    const sendButton = messageForm?.querySelector('button[type="submit"]')
    const attachments = appState.attachmentDraftByThreadId[threadId] || []
    const thread = appState.threads.find((entry) => entry.id === threadId)
    if (sendButton) sendButton.disabled = isThreadResonaResponding(thread) || (!composer.value.trim() && !attachments.length)
    debugTyping('composer input', threadId, composer.value.length)
    updateTypingHeartbeat(threadId, composer.value)
  })

  inboxRoot.addEventListener('keydown', (event) => {
    if (!event.target.closest('[data-message-find-input]') || event.key !== 'Enter') return
    event.preventDefault()
    handleMessageFindAction(event.shiftKey ? 'previous' : 'next')
  })

  inboxRoot.addEventListener('load', (event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement)) return
    const attachmentKey = image.dataset.messageAttachmentKey || ''
    if (!attachmentKey) return
    const currentUrl = image.currentSrc || image.src || ''
    if (attachmentUrlErrorCache.get(attachmentKey) === currentUrl) {
      attachmentUrlErrorCache.delete(attachmentKey)
    }
    image.closest('.message-image-preview-button')?.classList.remove('is-image-load-failed')
  }, true)

  inboxRoot.addEventListener('error', (event) => {
    const image = event.target
    if (!(image instanceof HTMLImageElement)) return
    if (image.matches('[data-inbox-avatar-image]')) {
      const avatarRoot = image.closest('[data-inbox-avatar-root]')
      avatarRoot?.classList.add('is-avatar-failed')
      debugInboxAvatar('image failed; showing initials fallback', {
        key: image.getAttribute('data-stable-image-key') || '',
        src: image.currentSrc || image.src || ''
      })
    }
    const attachmentKey = image.dataset.messageAttachmentKey || ''
    if (!attachmentKey) return
    const currentUrl = image.currentSrc || image.src || ''
    attachmentUrlErrorCache.set(attachmentKey, currentUrl)
    image.closest('.message-image-preview-button')?.classList.add('is-image-load-failed')
    debugInboxRender('attachment load failed', attachmentKey)
  }, true)

  inboxRoot.addEventListener('click', (event) => {
    const findAction = event.target.closest('[data-message-find-action]')
    if (findAction) {
      event.preventDefault()
      handleMessageFindAction(findAction.getAttribute('data-message-find-action') || '')
      return
    }

    const imageButton = event.target.closest('[data-preview-message-image]')
    if (imageButton) {
      event.preventDefault()
      appState.imagePreviewModal = {
        url: imageButton.getAttribute('data-preview-message-image') || '',
        name: imageButton.getAttribute('data-preview-message-image-name') || 'Image attachment'
      }
      renderFloatingUi()
      return
    }

    const unblockInline = event.target.closest('[data-unblock-contact-inline]')
    if (!unblockInline) return
    event.preventDefault()
    event.stopPropagation()
    const threadId = unblockInline.getAttribute('data-unblock-contact-inline') || ''
    if (!threadId) return
    appState.threadConfirmModal = { type: 'unblock-contact', threadId }
    appState.threadActionMenu = null
    renderFloatingUi()
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

function getAvatarURL(source = {}) {
  return String(
    source?.avatarURL
    || source?.avatarUrl
    || source?.photoURL
    || source?.photoUrl
    || source?.profileImageURL
    || source?.profileImageUrl
    || source?.profilePicture
    || source?.imageURL
    || source?.imageUrl
    || source?.photo
    || ''
  ).trim()
}

function getProfileMeta(uid, fallback = {}) {
  const profile = appState.profileByUid[uid] || {}
  const displayName = String(profile.displayName || fallback.displayName || fallback.title || '').trim()
  const username = String(profile.username || fallback.username || '').trim()
  const avatarURL = getAvatarURL(profile) || getAvatarURL(fallback)
  const uidFallback = uid ? `User ${String(uid).slice(0, 2).toUpperCase()}` : 'User'
  const preferred = displayName || username || uidFallback
  return { uid, displayName: preferred, username, avatarURL, photoURL: avatarURL }
}

function mergeHydratedProfiles(loaded = {}) {
  const loadedKeys = []
  Object.entries(loaded).forEach(([uid, profile]) => {
    if (!uid || !profile) return
    appState.profileByUid[uid] = {
      ...(appState.profileByUid[uid] || {}),
      ...profile
    }
    hydratedProfileUids.add(uid)
    loadedKeys.push(uid)
  })
  if (loadedKeys.length) preloadProfileImagesByUid(loadedKeys)
  return loadedKeys
}

function preloadImage(url) {
  const normalizedUrl = String(url || '').trim()
  if (!normalizedUrl) return Promise.resolve(false)
  if (imagePreloadCache.has(normalizedUrl)) return imagePreloadCache.get(normalizedUrl)

  const promise = new Promise((resolve) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(true)
    img.onerror = () => {
      imagePreloadCache.delete(normalizedUrl)
      resolve(false)
    }
    img.src = normalizedUrl
  })
  imagePreloadCache.set(normalizedUrl, promise)
  return promise
}

function preloadThreadImages(threads = []) {
  return Promise.all(threads.flatMap((thread) => [
    thread?.imageURL,
    thread?.otherProfile?.avatarURL,
    thread?.otherProfile?.photoURL
  ].filter(Boolean).map(preloadImage)))
}

function preloadProfileImagesByUid(uids = []) {
  uids.forEach((uid) => {
    const profile = appState.profileByUid[uid] || {}
    const url = profile.avatarURL || profile.photoURL || ''
    if (url) preloadImage(url)
  })
}

function preloadMessageImages(messages = []) {
  return Promise.all(messages.flatMap((message) => {
    if (!Array.isArray(message?.attachments)) return
    return message.attachments.map((attachment) => {
      const mime = String(attachment?.mimeType || '')
      return mime.startsWith('image/') && attachment?.url ? preloadImage(attachment.url) : null
    }).filter(Boolean)
  }).filter(Boolean))
}

async function hydrateProfilesForThread(thread) {
  if (!thread) return
  const ids = Array.from(new Set([
    ...getThreadParticipantUids(thread),
    ...(Array.isArray(thread.otherParticipantIds) ? thread.otherParticipantIds : []),
    thread.otherParticipantId || ''
  ].filter((uid) => uid && uid !== RESONA_AGENT_ID && uid !== 'system')))
  if (!ids.length) return
  const missingIds = ids.filter((uid) => !hydratedProfileUids.has(uid))
  if (!missingIds.length) return
  const loaded = await loadProfilesByUids(missingIds)
  const loadedKeys = mergeHydratedProfiles(loaded)
  if (!loadedKeys.length) return
  console.info(`[inbox] loaded profiles for thread ${thread.id} ${loadedKeys.length}`)
  if (appState.selectedThreadId === thread.id) renderSelectedConversation({ reason: 'state-update' })
}

async function hydrateProfilesForMessages(threadId, messages = [], { render = true } = {}) {
  if (!threadId || !messages.length) return
  const senderIds = Array.from(new Set(messages.map((message) => message?.senderId).filter((uid) => uid && uid !== RESONA_AGENT_ID && uid !== 'system')))
  const missing = senderIds.filter((uid) => !hydratedProfileUids.has(uid))
  if (!missing.length) return
  const loaded = await loadProfilesByUids(missing)
  const loadedKeys = mergeHydratedProfiles(loaded)
  if (!loadedKeys.length) return
  if (render && appState.selectedThreadId === threadId) renderSelectedConversation({ reason: 'state-update' })
}

async function hydrateProfilesForThreads(threads = []) {
  const ids = Array.from(new Set(
    threads.flatMap((thread) => [
      ...getThreadParticipantUids(thread),
      ...(Array.isArray(thread?.otherParticipantIds) ? thread.otherParticipantIds : []),
      thread?.otherParticipantId || ''
    ]).filter((uid) => uid && uid !== RESONA_AGENT_ID && uid !== 'system')
  ))
  const missing = ids.filter((uid) => !hydratedProfileUids.has(uid))
  if (!missing.length) return false
  const loaded = await loadProfilesByUids(missing)
  return mergeHydratedProfiles(loaded).length > 0
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

function mergeThreadsWithLocalCreates(threads = []) {
  const incomingIds = new Set(threads.map((thread) => thread.id))
  locallyCreatedThreadIds.forEach((threadId) => {
    if (incomingIds.has(threadId)) locallyCreatedThreadIds.delete(threadId)
  })
  const pendingLocal = appState.threads.filter((thread) => locallyCreatedThreadIds.has(thread.id) && !incomingIds.has(thread.id))
  return sortInboxThreadsLocal([...threads, ...pendingLocal])
}

function mergeSourceThreadState(current = {}, sourceThread = {}) {
  return {
    ...current,
    ...sourceThread,
    pinned: current.pinned === true,
    pinnedAt: current.pinned === true ? current.pinnedAt : null
  }
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
  return getThreadParticipantUids(thread).length > 0
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
  if (isResonaThread(thread) && thread.clearedAt) {
    const visibleCached = getMessagesAfterThreadClear(thread, appState.messagesByThreadId[thread.id] || [])
    if (!visibleCached.length) return 'Ask Resona anything'
  }
  if (isResonaThread(thread) && !thread.lastMessageText && !thread.lastMessageAt) {
    return 'Ask me anything'
  }
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

  const cached = getMessagesAfterThreadClear(thread, appState.messagesByThreadId[thread.id] || [])
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

function getMessagesAfterThreadClear(thread = {}, messages = []) {
  if (!isResonaThread(thread) || !thread.clearedAt) return messages
  const clearedAt = new Date(thread.clearedAt).getTime()
  if (!clearedAt || Number.isNaN(clearedAt)) return messages
  return messages.filter((message) => {
    if (message.optimistic || message.pendingWrites) return true
    const created = new Date(message.createdAt || message.updatedAt || 0).getTime()
    return created > clearedAt
  })
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

function isResonaThread(thread = null) {
  return Boolean(thread && thread.type === 'agent' && thread.agentId === RESONA_AGENT_ID)
}

function isResonaAiMessage(message = null) {
  return Boolean(message && message.senderType === 'ai' && message.agentId === RESONA_AGENT_ID)
}

function resonaMessageStateKey(threadId = '', messageId = '') {
  return `${threadId}:${messageId}`
}

function hasResonaAgent(thread = null) {
  return Boolean(thread?.agentParticipants?.resona?.active === true)
}

function getResonaThread() {
  return appState.threads.find((thread) => isResonaThread(thread)) || null
}

function resonaThreadPlaceholder() {
  return {
    id: appState.resonaThreadId || '',
    type: 'agent',
    agentId: RESONA_AGENT_ID,
    title: 'Resona',
    imagePath: RESONA_AVATAR_PATH,
    imageURL: appState.resonaAvatarURL || '',
    subtitle: 'Ask me anything',
    lastMessageText: '',
    lastMessagePreview: '',
    status: 'ai_active',
    mode: 'general',
    participantIds: appState.user?.uid ? [appState.user.uid] : [],
    participantUids: appState.user?.uid ? [appState.user.uid] : [],
    memberUids: appState.user?.uid ? [appState.user.uid] : [],
    participantCount: appState.user?.uid ? 1 : 0,
    unreadCount: 0,
    createdAt: null,
    updatedAt: null,
    lastMessageAt: null,
    isAgent: true
  }
}

function getResonaDisplayThread() {
  const existing = getResonaThread()
  if (!existing) return resonaThreadPlaceholder()
  return {
    ...existing,
    title: 'Resona',
    imagePath: existing.imagePath || RESONA_AVATAR_PATH,
    imageURL: appState.resonaAvatarURL || existing.imageURL || '',
    subtitle: summarizeThreadPreview(existing)
  }
}

function resonaMessageActionsMarkup(thread, message) {
  if (!isResonaAiMessage(message)) return ''
  const stateKey = resonaMessageStateKey(thread.id, message.id)
  const feedback = appState.resonaFeedbackByMessageId[stateKey] || ''
  const ttsSupported = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined'
  const speaking = appState.resonaSpeakingMessageId === stateKey
  return `
    <div class="resona-message-actions" data-resona-message-actions>
      <button type="button" class="${feedback === 'like' ? 'is-active' : ''}" data-resona-feedback="${escapeHtml(thread.id)}:${escapeHtml(message.id)}:like" aria-label="Like Resona response" title="Like">${iconSvg('thumbsUp')}</button>
      <button type="button" class="${feedback === 'dislike' ? 'is-active' : ''}" data-resona-feedback="${escapeHtml(thread.id)}:${escapeHtml(message.id)}:dislike" aria-label="Dislike Resona response" title="Dislike">${iconSvg('thumbsDown')}</button>
      <button type="button" data-resona-copy="${escapeHtml(thread.id)}:${escapeHtml(message.id)}" aria-label="Copy Resona response" title="Copy">${iconSvg('copy')}</button>
      <button type="button" class="${speaking ? 'is-active' : ''}" data-resona-speak="${escapeHtml(thread.id)}:${escapeHtml(message.id)}" aria-label="${speaking ? 'Stop reading response' : 'Read response aloud'}" title="${ttsSupported ? (speaking ? 'Stop' : 'Read aloud') : 'Text-to-speech unavailable in this browser'}" ${ttsSupported ? '' : 'disabled'}>${iconSvg('volume2')}</button>
      <button type="button" data-resona-message-menu="${escapeHtml(thread.id)}:${escapeHtml(message.id)}" aria-label="More Resona response actions" title="More">${iconSvg('moreVertical')}</button>
    </div>
  `
}

function getThreadParticipants(threadId) {
  return appState.participantsByThreadId[threadId] || []
}

function loadResonaAvatar() {
  if (appState.resonaAvatarRequested || appState.resonaAvatarURL || !storage) return
  appState.resonaAvatarRequested = true
  getDownloadURL(ref(storage, RESONA_AVATAR_PATH))
    .then((url) => {
      appState.resonaAvatarURL = url || ''
      upsertThreadInState(getResonaDisplayThread())
      renderThreadListOnly()
      renderSelectedConversation({ reason: 'state-update' })
    })
    .catch(() => {
      appState.resonaAvatarURL = ''
    })
}

function loadResonaSupportAvatar() {
  if (appState.resonaSupportAvatarRequested || appState.resonaSupportAvatarURL || !storage) return
  appState.resonaSupportAvatarRequested = true
  getDownloadURL(ref(storage, RESONA_SUPPORT_AVATAR_PATH))
    .then((url) => {
      appState.resonaSupportAvatarURL = url || ''
      renderSelectedConversation({ reason: 'state-update' })
    })
    .catch(() => {
      appState.resonaSupportAvatarURL = appState.resonaAvatarURL || ''
    })
}

function readCachedResonaBackground() {
  try {
    const cached = JSON.parse(localStorage.getItem(RESONA_BACKGROUND_CACHE_KEY) || '{}')
    if (
      cached?.path === RESONA_BACKGROUND_PATH
      && cached.url
      && Date.now() - Number(cached.cachedAt || 0) < RESONA_BACKGROUND_CACHE_TTL_MS
    ) {
      return cached.url
    }
  } catch {
    localStorage.removeItem(RESONA_BACKGROUND_CACHE_KEY)
  }
  return ''
}

function loadResonaBackground() {
  if (appState.resonaBackgroundRequested || appState.resonaBackgroundURL || !storage) return
  const cached = readCachedResonaBackground()
  if (cached) appState.resonaBackgroundURL = cached
  appState.resonaBackgroundRequested = true
  getDownloadURL(ref(storage, RESONA_BACKGROUND_PATH))
    .then((url) => {
      if (!url) return
      appState.resonaBackgroundURL = url
      localStorage.setItem(RESONA_BACKGROUND_CACHE_KEY, JSON.stringify({
        path: RESONA_BACKGROUND_PATH,
        url,
        cachedAt: Date.now()
      }))
      renderSelectedConversation({ reason: 'state-update' })
    })
    .catch(() => {
      if (!cached) appState.resonaBackgroundURL = ''
    })
}

function getGroupAvatarProfiles(thread, limit = 3) {
  if (!thread || thread.type !== 'group') return []
  const participantRows = getThreadParticipants(thread.id)
  const ids = Array.from(new Set([
    ...participantRows.map((entry) => entry.uid),
    ...getThreadParticipantUids(thread)
  ].filter(Boolean)))
  return ids.slice(0, limit).map((uid) => {
    const participant = participantRows.find((entry) => entry.uid === uid) || {}
    return getProfileMeta(uid, participant)
  })
}

function renderThreadAvatar(thread, { className = 'thread-avatar', stableKey = '' } = {}) {
  const key = stableKey || `thread:${thread?.id || 'unknown'}`
  if (isResonaThread(thread)) {
    const imageURL = appState.resonaAvatarURL || getAvatarURL(thread)
    if (imageURL) {
      return `
        <div class="${className} has-image thread-avatar-resona" data-inbox-avatar-root>
          <img decoding="async" src="${escapeHtml(imageURL)}" alt="" data-inbox-avatar-image data-stable-image-key="${escapeHtml(`${key}:resona`)}" />
          <span class="inbox-avatar-fallback">R</span>
        </div>
      `
    }
    return `<div class="${className} thread-avatar-resona"><span>R</span></div>`
  }
  const otherUid = thread?.otherParticipantId
    || getThreadParticipantUids(thread).find((uid) => uid && uid !== appState.user?.uid)
    || ''
  const dmProfile = thread?.type === 'dm'
    ? getProfileMeta(otherUid, {
        ...(thread.otherProfile || {}),
        title: thread.title,
        avatarURL: getAvatarURL(thread.otherProfile) || getAvatarURL(thread)
      })
    : null
  const imageURL = thread?.type === 'dm' ? getAvatarURL(dmProfile) : getAvatarURL(thread)
  const fallbackMeta = dmProfile || { title: thread?.title, uid: thread?.id }
  const fallbackInitials = getInitials(fallbackMeta)
  debugInboxAvatar('thread avatar source', {
    threadId: thread?.id || '',
    type: thread?.type || '',
    source: imageURL ? (thread?.type === 'dm' ? 'dm-profile' : 'group-image') : 'initials'
  })
  if (imageURL) {
    return `
      <div class="${className} has-image" data-inbox-avatar-root>
        <img decoding="async" src="${escapeHtml(imageURL)}" alt="" data-inbox-avatar-image data-stable-image-key="${escapeHtml(`${key}:custom`)}" />
        <span class="inbox-avatar-fallback">${escapeHtml(fallbackInitials)}</span>
      </div>
    `
  }
  if (thread?.type === 'group') {
    const profiles = getGroupAvatarProfiles(thread)
    const total = Math.max(Number(thread.participantCount || 0), getThreadParticipantUids(thread).length, profiles.length)
    if (profiles.length) {
      return `
        <div class="${className} inbox-avatar-stack" aria-label="Group members">
          ${profiles.map((profile, index) => profile.avatarURL
            ? `<span class="inbox-avatar-stack-item" style="--avatar-index:${index}" data-inbox-avatar-root><img decoding="async" src="${escapeHtml(profile.avatarURL)}" alt="" data-inbox-avatar-image data-stable-image-key="${escapeHtml(`${key}:${profile.uid}`)}" /><em>${escapeHtml(getInitials(profile))}</em></span>`
            : `<span class="inbox-avatar-stack-initials" style="--avatar-index:${index}">${escapeHtml(getInitials(profile))}</span>`
          ).join('')}
          ${total > 3 ? `<small>+${total - 3}</small>` : ''}
        </div>
      `
    }
  }
  const initials = fallbackInitials
  return `<div class="${className}"><span>${escapeHtml(initials)}</span></div>`
}

function generatedGroupTitle(thread) {
  const profiles = getGroupAvatarProfiles(thread, 20)
    .filter((profile) => profile.uid !== appState.user?.uid)
  const labels = profiles.map((profile) => profile.displayName || profile.username).filter(Boolean)
  if (!labels.length) return 'Group chat'
  if (labels.length <= 2) return labels.join(', ')
  return `${labels[0]}, ${labels[1]} + ${labels.length - 2}`
}

function isUserBlocked(uid) {
  if (!uid) return false
  return Boolean(appState.blockedUsersByUid[uid])
}

function getDmOtherParticipant(thread) {
  if (!thread || thread.type !== 'dm') return ''
  const participantIds = getThreadParticipantUids(thread)
  return thread.otherParticipantId || participantIds.find((uid) => uid && uid !== appState.user?.uid) || ''
}

function getDmBlockState(thread) {
  // dmBlockState on the thread doc is the cross-account source of truth for DM lockout.
  const state = thread?.dmBlockState || null
  const currentUid = appState.user?.uid || ''
  const otherUid = getDmOtherParticipant(thread)
  const isDm = thread?.type === 'dm'
  const isBlocked = Boolean(isDm && state?.blockedBy && state?.blockedUid)
  return {
    otherUid,
    isDm,
    isBlocked,
    currentUserBlockedOther: Boolean(isBlocked && state.blockedBy === currentUid && state.blockedUid === otherUid),
    otherBlockedCurrentUser: Boolean(isBlocked && state.blockedBy === otherUid && state.blockedUid === currentUid),
    isDmBlocked: isBlocked
  }
}

function isThreadInteractionLocked(thread) {
  const block = getDmBlockState(thread)
  return Boolean(block?.isDm && block?.isBlocked)
}

function isBlockedMessageForViewer(thread, message) {
  if (!thread || thread.type !== 'group' || !message?.senderId) return false
  if (message.senderId === appState.user?.uid) return false
  return isUserBlocked(message.senderId)
}

function isBlockedMessageRevealed(threadId, messageId) {
  const revealed = appState.revealBlockedMessageIdsByThreadId[threadId] || {}
  return Boolean(revealed[messageId])
}

function revealBlockedMessage(threadId, messageId) {
  if (!threadId || !messageId) return
  appState.revealBlockedMessageIdsByThreadId[threadId] = {
    ...(appState.revealBlockedMessageIdsByThreadId[threadId] || {}),
    [messageId]: true
  }
}

function getTypingUsers(threadId) {
  const all = appState.typingUsersByThreadId[threadId] || []
  const now = Date.now()
  return all.filter((entry) => {
    if (!entry?.uid || entry.uid === appState.user?.uid) return false
    if (isUserBlocked(entry.uid)) return false
    const stamp = entry.updatedAt
      ? new Date(entry.updatedAt).getTime()
      : entry.receivedAt
        ? new Date(entry.receivedAt).getTime()
        : 0
    return stamp && now - stamp < 7000
  })
}

function isActivityFresh(activity = {}) {
  if (activity?.active !== true) return false
  if (!activity.expiresAt) return true
  const expires = new Date(activity.expiresAt).getTime()
  return Number.isFinite(expires) ? expires > Date.now() : true
}

function getThreadResonaActivity(thread = null) {
  const activity = thread?.resonaActivity || {}
  return isActivityFresh(activity) ? activity : { active: false, label: '' }
}

function isThreadResonaResponding(thread = null) {
  return getThreadResonaActivity(thread).active === true
}

function getThreadResonaActivityLabel(thread = null) {
  return getThreadResonaActivity(thread).label || 'Resona is responding...'
}

function renderTypingUi(threadId) {
  if (!threadId || appState.selectedThreadId !== threadId || appState.activeFilter !== 'Messages') return
  const thread = getSelectedThread()
  if (!thread) return
  const subtitle = isThreadResonaResponding(thread) ? getThreadResonaActivityLabel(thread) : getConversationSubtitle(thread)
  const headerSubtitle = inboxRoot.querySelector('.conversation-header-meta p')
  if (headerSubtitle) headerSubtitle.textContent = subtitle
  const inline = inboxRoot.querySelector('[data-typing-indicator-inline]')
  const typingUsers = getTypingUsers(threadId)
  const resonaResponding = isThreadResonaResponding(thread)
  if (!inline) return
  if (!typingUsers.length && !resonaResponding) {
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
  if (messageSubscriptionFallbackTimer) window.clearTimeout(messageSubscriptionFallbackTimer)
  messageSubscriptionFallbackTimer = null
  messageScrollController.detach()
  appState.threadUnsubscribe()
  appState.messageUnsubscribe()
  appState.sourceThreadUnsubscribe()
  appState.participantsUnsubscribe()
  appState.typingUnsubscribe()
  appState.blockedUsersUnsubscribe()
  appState.systemUnsubscribe()
  appState.accountEventsUnsubscribe()
  appState.inboxPinsUnsubscribe()
  appState.reactionUnsubscribe()
  appState.hiddenMessagesUnsubscribe()
  appState.incomingCallsUnsubscribe()
  appState.recentCallsUnsubscribe()
  appState.activeCallUnsubscribe()
  appState.threadUnsubscribe = () => {}
  appState.messageUnsubscribe = () => {}
  appState.sourceThreadUnsubscribe = () => {}
  appState.participantsUnsubscribe = () => {}
  appState.typingUnsubscribe = () => {}
  appState.blockedUsersUnsubscribe = () => {}
  appState.systemUnsubscribe = () => {}
  appState.accountEventsUnsubscribe = () => {}
  appState.inboxPinsUnsubscribe = () => {}
  appState.reactionUnsubscribe = () => {}
  appState.hiddenMessagesUnsubscribe = () => {}
  appState.incomingCallsUnsubscribe = () => {}
  appState.recentCallsUnsubscribe = () => {}
  appState.activeCallUnsubscribe = () => {}
  appState.incomingCalls = []
  appState.recentCalls = []
  appState.activeCall = null
  appState.callUiState = 'idle'
  appState.callError = ''
  appState.callMuted = false
  appState.callActionPending = ''
  clearAccountCallTimers()
  accountCallManager?.cleanup()
  accountCallManager = null
  remoteCallAudio.srcObject = null
  appState.threadsFallbackPending = false
  appState.hasLoadedThreadsOnce = false
  appState.inboxRepairAttempted = false
  appState.isRepairingInbox = false
  activeThreadSubscriptionUid = ''
  activeMessageSubscriptionThreadId = ''
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
  appState.notificationActionMenu = null
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
  const thread = appState.threads.find((entry) => entry.id === threadId)
  const blockState = getDmBlockState(thread)
  if (thread?.type === 'dm' && blockState.isDmBlocked) {
    clearTypingForThread(threadId)
    return
  }
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

const BOTTOM_THRESHOLD_PX = 96
const OLDER_MESSAGES_TRIGGER_PX = 160
const MAX_CONVERSATION_AUTO_FILL_ATTEMPTS = 3

function debugMessageScroller(stage, scroller = getMessageScroller()) {
  if (!INBOX_SCROLL_DEBUG || !scroller) return
  const styles = getComputedStyle(scroller)
  console.info(`[inbox scroll] ${stage}`)
  console.table({
    scrollTop: scroller.scrollTop,
    scrollHeight: scroller.scrollHeight,
    clientHeight: scroller.clientHeight,
    canScroll: scroller.scrollHeight > scroller.clientHeight,
    overflowY: styles.overflowY,
    display: styles.display,
    pointerEvents: styles.pointerEvents
  })
}

function getMessageScroller() {
  return inboxRoot.querySelector('.conversation-stack > [data-message-list]')
    || inboxRoot.querySelector('[data-message-list]')
}

function isMessageListNearBottom(list = getMessageScroller(), threshold = BOTTOM_THRESHOLD_PX) {
  if (!list) return true
  return list.scrollHeight - list.scrollTop - list.clientHeight <= threshold
}

const messageScrollController = {
  scroller: null,
  threadId: '',
  mode: 'bottom',
  lastScrollHeight: 0,
  lastScrollTop: 0,
  isProgrammaticScroll: false,
  rafId: 0,
  releaseRafId: 0,
  onScroll: null,
  onMediaSettled: null,

  debug(...args) {
    if (INBOX_SCROLL_DEBUG) console.info('[inbox scroll]', ...args)
  },

  attach(scroller, { threadId = appState.selectedThreadId, resetMode = false } = {}) {
    if (!scroller) {
      this.detach()
      return
    }
    const isNewScroller = this.scroller !== scroller
    const isNewThread = this.threadId !== threadId
    if (isNewScroller) this.detach()
    this.scroller = scroller
    this.threadId = threadId || ''
    if (resetMode || isNewThread) this.mode = 'bottom'
    this.lastScrollHeight = scroller.scrollHeight
    this.lastScrollTop = scroller.scrollTop
    debugMessageScroller('attach', scroller)
    if (!isNewScroller) return

    this.onScroll = () => {
      if (this.isProgrammaticScroll || this.scroller !== scroller) return
      if (this.rafId) {
        cancelAnimationFrame(this.rafId)
        this.rafId = 0
      }
      const nextMode = isMessageListNearBottom(scroller) ? 'bottom' : 'detached'
      if (nextMode !== this.mode) this.debug('mode', this.mode, '->', nextMode)
      this.mode = nextMode
      this.lastScrollTop = scroller.scrollTop
      this.lastScrollHeight = scroller.scrollHeight
      if (scroller.scrollTop < OLDER_MESSAGES_TRIGGER_PX) {
        const pagination = appState.messagePaginationByThreadId[this.threadId] || {}
        if (pagination.hasOlder !== false && !pagination.loadingOlder) {
          loadOlderMessagesForThread(this.threadId)
        }
      }
    }
    this.onMediaSettled = (event) => {
      const media = event.target
      if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return
      this.stabilizeMedia(media)
    }
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
    scroller.addEventListener('load', this.onMediaSettled, true)
    scroller.addEventListener('loadedmetadata', this.onMediaSettled, true)
    scroller.addEventListener('error', this.onMediaSettled, true)
  },

  detach() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    if (this.releaseRafId) cancelAnimationFrame(this.releaseRafId)
    if (this.scroller && this.onScroll) this.scroller.removeEventListener('scroll', this.onScroll)
    if (this.scroller && this.onMediaSettled) {
      this.scroller.removeEventListener('load', this.onMediaSettled, true)
      this.scroller.removeEventListener('loadedmetadata', this.onMediaSettled, true)
      this.scroller.removeEventListener('error', this.onMediaSettled, true)
    }
    this.scroller = null
    this.threadId = ''
    this.isProgrammaticScroll = false
    this.rafId = 0
    this.releaseRafId = 0
    this.onScroll = null
    this.onMediaSettled = null
  },

  setScrollTop(nextTop, reason = 'programmatic') {
    const scroller = this.scroller
    if (!scroller) return
    this.isProgrammaticScroll = true
    scroller.scrollTop = Math.max(0, nextTop)
    this.lastScrollTop = scroller.scrollTop
    this.lastScrollHeight = scroller.scrollHeight
    this.debug(reason, { top: scroller.scrollTop, height: scroller.scrollHeight, mode: this.mode })
    if (this.releaseRafId) cancelAnimationFrame(this.releaseRafId)
    this.releaseRafId = requestAnimationFrame(() => {
      this.releaseRafId = 0
      this.isProgrammaticScroll = false
    })
  },

  scheduleBottom({ force = false, reason = 'bottom' } = {}) {
    if (!this.scroller || (!force && this.mode !== 'bottom')) return
    if (force) this.mode = 'bottom'
    if (this.rafId) cancelAnimationFrame(this.rafId)
    this.debug('schedule bottom', reason)
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0
      if (!this.scroller || (!force && this.mode !== 'bottom')) return
      this.setScrollTop(this.scroller.scrollHeight, reason)
      this.mode = 'bottom'
    })
  },

  snapshot() {
    const scroller = this.scroller
    return {
      mode: this.mode,
      scrollTop: scroller?.scrollTop || 0,
      scrollHeight: scroller?.scrollHeight || 0
    }
  },

  stabilizeAfterRender(snapshot, { reason = 'render', forceBottom = false, preservePrepend = false } = {}) {
    const scroller = this.scroller
    if (!scroller) return
    if (forceBottom || snapshot?.mode === 'bottom') {
      this.mode = 'bottom'
      this.scheduleBottom({ force: true, reason })
      return
    }
    this.mode = 'detached'
    const heightDelta = scroller.scrollHeight - Number(snapshot?.scrollHeight || 0)
    const nextTop = Number(snapshot?.scrollTop || 0) + (preservePrepend ? heightDelta : 0)
    this.setScrollTop(nextTop, `${reason}-detached`)
  },

  stabilizeMedia(media) {
    const scroller = this.scroller
    if (!scroller) return
    const heightDelta = scroller.scrollHeight - this.lastScrollHeight
    if (this.mode === 'bottom') {
      this.scheduleBottom({ force: true, reason: 'media-settled' })
    } else if (heightDelta && media.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
      this.setScrollTop(scroller.scrollTop + heightDelta, 'media-settled-detached')
    }
    this.lastScrollHeight = scroller.scrollHeight
    this.lastScrollTop = scroller.scrollTop
  },

  navigateToElement(element, reason = 'navigate') {
    const scroller = this.scroller
    if (!scroller || !element) return
    this.mode = 'detached'
    const scrollerRect = scroller.getBoundingClientRect()
    const elementRect = element.getBoundingClientRect()
    const targetTop = scroller.scrollTop + elementRect.top - scrollerRect.top - ((scroller.clientHeight - elementRect.height) / 2)
    this.setScrollTop(targetTop, reason)
  }
}

function mergeMessages(existing = [], incoming = []) {
  const byId = new Map()
  ;[...existing, ...incoming].forEach((message) => {
    if (!message?.id) return
    byId.set(message.id, { ...(byId.get(message.id) || {}), ...message })
  })
  return Array.from(byId.values())
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
}

function replaceRealtimeMessages(existing = [], incoming = [], { preserveLoadedHistory = false } = {}) {
  const incomingIds = new Set(incoming.map((message) => message?.id).filter(Boolean))
  const pending = existing.filter((message) => (
    message?.optimistic
    || message?.pendingWrites
  ) && !incomingIds.has(message.id))
  let loadedHistory = []
  if (preserveLoadedHistory && incoming.length) {
    const firstIncomingAt = new Date(incoming[0]?.createdAt || 0).getTime()
    if (Number.isFinite(firstIncomingAt) && firstIncomingAt > 0) {
      loadedHistory = existing.filter((message) => {
        if (!message?.id || incomingIds.has(message.id) || message.optimistic || message.pendingWrites) return false
        const createdAt = new Date(message.createdAt || 0).getTime()
        return Number.isFinite(createdAt) && createdAt < firstIncomingAt
      })
    }
  }
  return mergeMessages([...loadedHistory, ...incoming], pending)
}

function updateMessageHistoryState(threadId = '') {
  if (!threadId || appState.selectedThreadId !== threadId) return
  const stateRoot = inboxRoot.querySelector('[data-message-history-state]')
  if (!stateRoot) return
  const pagination = appState.messagePaginationByThreadId[threadId] || {}
  stateRoot.classList.toggle('is-loading', Boolean(pagination.loadingOlder))
  stateRoot.textContent = pagination.loadingOlder
    ? 'Loading earlier messages...'
    : pagination.hasOlder === false
      ? 'Beginning of conversation'
      : ''
  stateRoot.hidden = !stateRoot.textContent
}

async function loadOlderMessagesForThread(threadId = '', {
  preservePrepend = true,
  reason = 'older-messages',
  detachFromBottom = true
} = {}) {
  if (!threadId || appState.messagePaginationByThreadId[threadId]?.loadingOlder) return false
  const current = appState.messagesByThreadId[threadId] || []
  const earliest = current[0]?.createdAt || ''
  if (!earliest) return false
  if (detachFromBottom) messageScrollController.mode = 'detached'
  appState.messagePaginationByThreadId[threadId] = {
    ...(appState.messagePaginationByThreadId[threadId] || {}),
    loadingOlder: true
  }
  updateMessageHistoryState(threadId)
  try {
    const older = await listOlderMessages(threadId, earliest, OLDER_MESSAGE_PAGE_SIZE)
    appState.messagesByThreadId[threadId] = mergeMessages(older, appState.messagesByThreadId[threadId] || [])
    appState.messagePaginationByThreadId[threadId] = {
      loadingOlder: false,
      hasOlder: older.length >= OLDER_MESSAGE_PAGE_SIZE,
      loadedOlder: older.length > 0 || appState.messagePaginationByThreadId[threadId]?.loadedOlder === true
    }
    await hydrateProfilesForMessages(threadId, older, { render: false })
    if (appState.selectedThreadId === threadId) {
      renderSelectedConversation({ preservePrepend, reason })
    }
    return older.length > 0
  } catch (error) {
    appState.messagePaginationByThreadId[threadId] = {
      ...(appState.messagePaginationByThreadId[threadId] || {}),
      loadingOlder: false
    }
    warnRealtimePermission(`older-messages-${threadId}`, error)
    updateMessageHistoryState(threadId)
    return false
  }
}

function afterInboxLayout() {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
}

async function ensureConversationCanScrollIfPossible(threadId = appState.selectedThreadId) {
  if (!threadId || appState.selectedThreadId !== threadId) return
  if (conversationAutoFillByThreadId.has(threadId)) return conversationAutoFillByThreadId.get(threadId)

  const task = (async () => {
    let attempts = 0
    while (attempts < MAX_CONVERSATION_AUTO_FILL_ATTEMPTS && appState.selectedThreadId === threadId) {
      await afterInboxLayout()
      const scroller = getMessageScroller()
      const pagination = appState.messagePaginationByThreadId[threadId] || {}
      debugMessageScroller(`auto-fill check ${attempts + 1}`, scroller)
      if (!scroller || scroller.scrollHeight > scroller.clientHeight || pagination.hasOlder === false) break
      if (pagination.loadingOlder) {
        await afterInboxLayout()
        continue
      }
      attempts += 1
      const loaded = await loadOlderMessagesForThread(threadId, {
        preservePrepend: false,
        reason: 'conversation-auto-fill',
        detachFromBottom: false
      })
      if (!loaded) break
    }
    if (appState.selectedThreadId === threadId && messageScrollController.mode === 'bottom') {
      messageScrollController.scheduleBottom({ force: true, reason: 'conversation-auto-fill-complete' })
    }
  })().finally(() => {
    conversationAutoFillByThreadId.delete(threadId)
  })

  conversationAutoFillByThreadId.set(threadId, task)
  return task
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
  const inputFiles = Array.isArray(files) ? files : []
  const accepted = inputFiles.filter((file) => Number(file?.size || 0) <= MAX_ATTACHMENT_BYTES)
  const rejectedCount = inputFiles.length - accepted.length
  if (rejectedCount > 0) {
    appState.errorMessage = rejectedCount === 1
      ? `Attachment is too large. Maximum size is ${MAX_ATTACHMENT_LABEL}.`
      : `${rejectedCount} attachments were too large. Maximum size is ${MAX_ATTACHMENT_LABEL}.`
  } else if (appState.errorMessage.includes('Attachment is too large') || appState.errorMessage.includes('attachments were too large')) {
    appState.errorMessage = ''
  }
  revokeAttachmentPreviews(threadId)
  appState.attachmentDraftByThreadId[threadId] = accepted
  appState.attachmentPreviewByThreadId[threadId] = accepted.map((file) => {
    const type = describeAttachmentType(file)
    return type === 'image' ? URL.createObjectURL(file) : ''
  })
}

function appendAttachmentDraft(threadId, files = []) {
  if (!threadId) return
  const current = appState.attachmentDraftByThreadId[threadId] || []
  setAttachmentDraft(threadId, [...current, ...(Array.isArray(files) ? files : [])].slice(0, 6))
}

function revokeOptimisticMessagePreviews(message = {}) {
  ;(message.attachments || []).forEach((attachment) => {
    if (!attachment?.localObjectUrl) return
    try {
      URL.revokeObjectURL(attachment.localObjectUrl)
    } catch {
      // noop
    }
  })
}

function createOptimisticAttachment(file, index) {
  const type = describeAttachmentType(file)
  const isImage = type === 'image'
  const localObjectUrl = isImage ? URL.createObjectURL(file) : ''
  return {
    name: file.name || `Attachment ${index + 1}`,
    type,
    mimeType: file.type || 'application/octet-stream',
    size: Number(file.size || 0),
    url: localObjectUrl,
    localObjectUrl,
    optimistic: true
  }
}

function addOptimisticMessage(thread, { clientMessageId, body, attachments = [], replyTo = null } = {}) {
  if (!thread?.id || !appState.user?.uid || !clientMessageId) return null
  const optimistic = {
    id: `local-${clientMessageId}`,
    clientMessageId,
    senderId: appState.user.uid,
    body,
    type: attachments.length ? (attachments.length === 1 && !body ? describeAttachmentType(attachments[0]) : 'attachment') : 'text',
    attachments: attachments.map(createOptimisticAttachment),
    pendingFiles: attachments,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deleted: false,
    edited: false,
    replyTo,
    optimistic: true,
    sendStatus: 'sending'
  }
  appState.optimisticMessagesByThreadId[thread.id] = [
    ...(appState.optimisticMessagesByThreadId[thread.id] || []),
    optimistic
  ]
  return optimistic
}

function setOptimisticMessageStatus(threadId, clientMessageId, status, detail = '') {
  const current = appState.optimisticMessagesByThreadId[threadId] || []
  appState.optimisticMessagesByThreadId[threadId] = current.map((message) => (
    message.clientMessageId === clientMessageId
      ? { ...message, sendStatus: status, sendError: detail }
      : message
  ))
}

function removeOptimisticMessage(threadId, clientMessageId) {
  const current = appState.optimisticMessagesByThreadId[threadId] || []
  const removed = current.filter((message) => message.clientMessageId === clientMessageId)
  removed.forEach(revokeOptimisticMessagePreviews)
  appState.optimisticMessagesByThreadId[threadId] = current.filter((message) => message.clientMessageId !== clientMessageId)
}

function reconcileOptimisticMessages(threadId, serverMessages = []) {
  const current = appState.optimisticMessagesByThreadId[threadId] || []
  if (!current.length) return
  const confirmedIds = new Set(serverMessages
    .filter((message) => message.clientMessageId && message.createdAt && message.pendingWrites !== true)
    .map((message) => message.clientMessageId))
  if (!confirmedIds.size) return
  const reconciledIds = current
    .filter((message) => confirmedIds.has(message.clientMessageId))
    .map((message) => message.clientMessageId)
  current.forEach((message) => {
    if (confirmedIds.has(message.clientMessageId)) revokeOptimisticMessagePreviews(message)
  })
  appState.optimisticMessagesByThreadId[threadId] = current.filter((message) => !confirmedIds.has(message.clientMessageId))
  if (reconciledIds.length) {
    debugInboxRender('optimistic messages reconciled', {
      threadId,
      clientMessageIds: reconciledIds
    })
  }
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

function inboxPinFor(type = '', targetId = '') {
  const pinId = buildInboxPinId(type, targetId)
  return appState.inboxPins.find((pin) => pin.pinId === pinId || pin.id === pinId) || null
}

function isInboxPinned(type = '', targetId = '') {
  return Boolean(inboxPinFor(type, targetId))
}

function threadInboxPin(thread = {}) {
  return {
    pinId: buildInboxPinId('thread', thread.id),
    type: 'thread',
    targetId: thread.id,
    title: thread.title || 'Chat',
    subtitle: isResonaThread(thread) ? 'Agent' : thread.type === 'group' ? 'Group chat' : 'Direct message',
    sourceCategory: 'Messages',
    targetPath: ROUTES.inboxMessages,
    metadata: { threadType: thread.type || 'thread' }
  }
}

function systemInboxPin(item = {}) {
  const sourceCollection = item.sourceCollection || 'systemNotifications'
  const isAccountEvent = sourceCollection === 'accountEvents'
  const isContent = item.category === 'content' || Boolean(contentViewForNotification(item))
  const type = isAccountEvent ? 'accountEvent' : 'systemNotification'
  const systemFilter = isAccountEvent
    ? (securityAccountEventTypes.has(String(item.type || '')) ? 'security' : 'account')
    : (item.type || 'other')
  return {
    pinId: buildInboxPinId(type, item.id),
    type,
    targetId: item.id,
    title: item.title || 'Notification',
    subtitle: item.body || item.message || '',
    sourceCategory: isContent ? 'Inbox' : 'System',
    targetPath: item.actionHref || item.path || (isContent ? ROUTES.inboxContentAll : ROUTES.inboxSystem),
    metadata: {
      sourceCollection,
      systemFilter,
      notificationSection: isContent ? 'content' : 'system'
    }
  }
}

function accountEventMatchesSystemFilter(item = {}, filter = 'all') {
  if (filter === 'all') return true
  const isSecurity = securityAccountEventTypes.has(String(item.type || ''))
  if (filter === 'security') return isSecurity
  if (filter === 'account') return !isSecurity
  return false
}

function getMessagesSidebarMarkup() {
  const filterMarkup = inboxFilters
    .map((filter) => {
      const guideKey = String(filter.label || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      return `
        <button type="button" class="inbox-filter ${appState.activeFilter === filter.label ? 'is-active' : ''}" data-inbox-filter="${filter.label}" data-inbox-path="${filter.path}" data-guide-id="inbox-sidebar-${escapeHtml(guideKey)}" data-guide-label="${escapeHtml(filter.label)}" data-guide-role="inbox-sidebar-button">
          <span>${filter.label}</span>
        </button>
      `
    })
    .join('')

  return `
    <div class="inbox-panel-title">
      <h2>Inbox</h2>
      <p>Messages and activity</p>
    </div>
    <div class="inbox-filters" data-inbox-filters>${filterMarkup}</div>
    <section class="sidebar-support-block">
      <button type="button" class="sidebar-support-button" data-open-support-dock data-guide-id="inbox-sidebar-contact-support" data-guide-label="Contact Support" data-guide-role="inbox-sidebar-button">
        <strong>Contact Support</strong>
        <small>Open a chat with Resona</small>
      </button>
    </section>
    ${getPinnedInboxSidebarMarkup()}
    ${getRecentThreadsSidebarMarkup()}
  `
}

function getPinnedInboxSidebarMarkup() {
  const pins = appState.inboxPins.slice(0, 8)
  if (!pins.length) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Pinned</p>
        <p class="sidebar-note">Pin messages and notifications here.</p>
      </section>
    `
  }

  const rows = pins.map((pin) => {
    const isActiveThread = pin.type === 'thread' && appState.activeFilter === 'Messages' && appState.selectedThreadId === pin.targetId
    return `
      <div class="sidebar-pin-row">
        <button type="button" class="sidebar-thread-pill ${isActiveThread ? 'is-active' : ''}" data-open-inbox-pin="${escapeHtml(pin.pinId || pin.id)}" data-guide-id="inbox-sidebar-pin-${escapeHtml(pin.pinId || pin.id)}" data-guide-label="${escapeHtml(pin.title)}" data-guide-role="inbox-sidebar-pinned-item">
          <strong>${escapeHtml(pin.title)}</strong>
          <small>${escapeHtml(pin.sourceCategory || 'Inbox')}${pin.subtitle ? ` · ${escapeHtml(pin.subtitle)}` : ''}</small>
        </button>
        <button type="button" class="sidebar-pin-remove" data-unpin-inbox-pin="${escapeHtml(pin.pinId || pin.id)}" aria-label="Remove pinned item" data-guide-id="inbox-sidebar-pin-remove-${escapeHtml(pin.pinId || pin.id)}" data-guide-label="Remove pinned item" data-guide-role="inbox-sidebar-button">×</button>
      </div>
    `
  }).join('')

  return `
    <section class="sidebar-recent-block">
      <p class="sidebar-label">Pinned</p>
      <div class="sidebar-recent-list">${rows}</div>
    </section>
  `
}

function getRecentThreadsSidebarMarkup() {
  if (appState.activeFilter !== 'Messages') return ''

  if (appState.isLoadingThreads) {
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

  if (appState.isRepairingInbox) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Restoring conversations...</p>
      </section>
    `
  }

  if ((!appState.threadsRealtimeReady || appState.threadsFallbackPending) && !appState.threadsFallbackTried) {
    return `
      <section class="sidebar-recent-block">
        <p class="sidebar-label">Recent threads</p>
        <p class="sidebar-note">Loading conversations...</p>
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
        <p class="sidebar-note">Loading conversations...</p>
      </section>
    `
  }

  const pills = appState.threads
    .slice(0, 4)
    .map((thread) => {
      const isActive = appState.selectedThreadId === thread.id
      return `
        <button type="button" class="sidebar-thread-pill ${isActive ? 'is-active' : ''}" data-select-thread-id="${escapeHtml(thread.id)}" data-guide-id="inbox-sidebar-thread-${escapeHtml(thread.id)}" data-guide-label="${escapeHtml(thread.title)}" data-guide-role="inbox-sidebar-thread">
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

  if (isResonaThread(thread)) {
    if (thread.status === 'waiting_for_agent') return 'Waiting for live agent'
    if (thread.status === 'assigned' || thread.mode === 'live_agent_joined') return 'Live agent joined'
    return 'Resona active'
  }
  if (hasResonaAgent(thread)) return 'Resona active · Mention @Resona to ask'

  if (thread.type === 'group') {
    return `${Math.max(1, Number(thread.participantCount || getThreadParticipantUids(thread).length || 0))} members`
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
    if (message.senderType === 'system') {
      groups.push({
        kind: 'system',
        id: `system-${message.renderKey || message.clientMessageId || message.id}`,
        message
      })
      return
    }
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

    groups.push({
      kind: 'messages',
      id: `group-${message.renderKey || message.clientMessageId || message.id}`,
      senderId: message.senderId,
      messages: [message]
    })
  })

  return groups
}

function getParticipantMeta(thread, uid) {
  if (uid === RESONA_AGENT_ID) {
    return {
      uid: RESONA_AGENT_ID,
      displayName: 'Resona',
      username: 'AI',
      avatarURL: appState.resonaAvatarURL || '',
      photoURL: appState.resonaAvatarURL || ''
    }
  }
  if (uid === 'system' || !uid) {
    return {
      uid: 'system',
      displayName: 'System',
      username: '',
      avatarURL: '',
      photoURL: ''
    }
  }
  const profile = uid ? (appState.profileByUid[uid] || null) : null
  const participants = getThreadParticipants(thread.id)
  const participantDoc = participants.find((entry) => entry.uid === uid)
  if (profile) return getProfileMeta(uid, participantDoc || profile)
  if (participantDoc) return getProfileMeta(uid, participantDoc)

  if (thread.type === 'dm' && uid === thread.otherParticipantId && thread.otherProfile) {
    return getProfileMeta(uid, {
      uid,
      displayName: thread.otherProfile.displayName || thread.otherProfile.username || thread.title,
      username: thread.otherProfile.username || '',
      avatarURL: thread.otherProfile.avatarURL || thread.otherProfile.photoURL || thread.imageURL
    })
  }

  if (uid && uid === appState.user?.uid) {
    return getProfileMeta(uid, {
      uid,
      displayName: appState.user?.displayName || 'You',
      username: appState.user?.username || '',
      photoURL: appState.user?.photoURL || ''
    })
  }

  return getProfileMeta(uid, { uid, title: thread.title || (uid ? `User ${String(uid).slice(0, 2).toUpperCase()}` : 'User') })
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
  if (message?.optimistic && message.sendStatus === 'failed') return 'Failed to send'
  if (message?.optimistic || message?.sendStatus === 'sending') return 'Sending...'
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

function getRenderableMessages(thread) {
  const hiddenIds = new Set(appState.hiddenMessageIdsByThreadId[thread.id] || [])
  const confirmedMessages = getMessagesAfterThreadClear(thread, appState.messagesByThreadId[thread.id] || [])
  const optimisticMessages = appState.optimisticMessagesByThreadId[thread.id] || []
  const optimisticByClientId = new Map(
    optimisticMessages
      .filter((message) => message.clientMessageId)
      .map((message) => [message.clientMessageId, message])
  )
  const mergedConfirmed = confirmedMessages.map((confirmed) => {
    const optimistic = optimisticByClientId.get(confirmed.clientMessageId)
    if (!optimistic) {
      return {
        ...confirmed,
        renderKey: confirmed.clientMessageId || confirmed.id
      }
    }
    optimisticByClientId.delete(confirmed.clientMessageId)
    const isCommitted = Boolean(confirmed.createdAt) && confirmed.pendingWrites !== true
    return {
      ...optimistic,
      ...confirmed,
      id: confirmed.id || optimistic.id,
      renderKey: confirmed.clientMessageId || optimistic.clientMessageId || confirmed.id,
      createdAt: confirmed.createdAt || optimistic.createdAt,
      attachments: confirmed.attachments?.length ? confirmed.attachments : optimistic.attachments,
      optimistic: !isCommitted,
      sendStatus: isCommitted ? 'sent' : optimistic.sendStatus || 'sending'
    }
  })
  const pendingOnly = Array.from(optimisticByClientId.values()).map((message) => ({
    ...message,
    renderKey: message.clientMessageId || message.id
  }))
  return [...mergedConfirmed, ...pendingOnly]
    .filter((message) => !hiddenIds.has(message.id))
    .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime())
}

function normalizeRenderSignatureValue(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value?.toMillis === 'function') return value.toMillis()
  if (value instanceof Set) return [...value].sort()
  if (Array.isArray(value)) return value.map(normalizeRenderSignatureValue)
  if (typeof File !== 'undefined' && value instanceof File) {
    return {
      name: value.name,
      size: value.size,
      type: value.type,
      lastModified: value.lastModified
    }
  }
  if (typeof value === 'object') {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = normalizeRenderSignatureValue(value[key])
        return result
      }, {})
  }
  return String(value)
}

function hashRenderSignature(value) {
  const input = JSON.stringify(normalizeRenderSignatureValue(value))
  let hash = 2166136261
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}

function getMessageRenderSignature(thread, messages = getRenderableMessages(thread)) {
  const senderIds = [...new Set(messages.map((message) => message.senderId).filter(Boolean))]
  const profiles = senderIds.map((uid) => [uid, appState.profileByUid[uid] || null])
  return hashRenderSignature({
    threadId: thread.id,
    messages,
    pagination: appState.messagePaginationByThreadId[thread.id] || {},
    participants: getThreadParticipants(thread.id),
    profiles,
    reactions: appState.reactionsByThreadId[thread.id] || {},
    resonaFeedback: appState.resonaFeedbackByMessageId,
    resonaSpeakingMessageId: appState.resonaSpeakingMessageId,
    editingMessageId: appState.editingMessageByThreadId[thread.id] || '',
    editDrafts: appState.editDraftByMessageId,
    revealedBlockedMessages: appState.revealBlockedMessageIdsByThreadId[thread.id] || []
  })
}

function getAttachmentCacheKey(message = {}, attachment = {}, index = 0) {
  const messageKey = message.clientMessageId || message.id || 'message'
  return `${messageKey}:${attachment.storagePath || attachment.path || attachment.name || index}`
}

function getStableAttachmentUrl(message = {}, attachment = {}, index = 0) {
  const cacheKey = getAttachmentCacheKey(message, attachment, index)
  const incomingUrl = String(attachment.url || '')
  const cachedUrl = attachmentUrlCache.get(cacheKey) || ''
  if (incomingUrl && incomingUrl !== cachedUrl) {
    attachmentUrlCache.set(cacheKey, incomingUrl)
    attachmentUrlErrorCache.delete(cacheKey)
    debugInboxRender(cachedUrl ? 'attachment URL changed' : 'attachment URL cached', cacheKey)
    return incomingUrl
  }
  return incomingUrl || cachedUrl
}

function getMessageGroupsMarkup(thread, {
  messages = getRenderableMessages(thread),
  renderSignature = getMessageRenderSignature(thread, messages)
} = {}) {
  if (!messages.length) {
    const isPreparing = Boolean(appState.preparingThreadIds[thread.id])
    const emptyTitle = isResonaThread(thread) ? 'Ask Resona anything.' : 'No messages yet.'
    const emptyBody = isResonaThread(thread)
      ? 'Ask Resona anything about Melogic, your projects, or support.'
      : 'Start this conversation with your first message.'
    return `
      <section class="message-list message-list-empty" data-message-list data-message-render-signature="${escapeHtml(renderSignature)}">
        <div class="inbox-empty-panel inbox-empty-panel-inline">
          <h3>${isPreparing ? 'Preparing conversation...' : escapeHtml(emptyTitle)}</h3>
          <p>${isPreparing ? 'Confirming your membership before messages can be sent.' : escapeHtml(emptyBody)}</p>
        </div>
      </section>
    `
  }

  const grouped = groupMessages(messages)
  const pagination = appState.messagePaginationByThreadId[thread.id] || {}
  const olderControlText = pagination.loadingOlder
    ? 'Loading earlier messages...'
    : pagination.hasOlder === false
      ? 'Beginning of conversation'
      : ''
  const olderControl = `<p class="message-history-boundary ${pagination.loadingOlder ? 'is-loading' : ''}" data-message-history-state ${olderControlText ? '' : 'hidden'}>${escapeHtml(olderControlText)}</p>`
  const messageGroups = grouped
    .map((entry, index) => {
      if (entry.kind === 'separator') {
        return `<p class="message-date-separator"><span>${escapeHtml(entry.label)}</span></p>`
      }
      if (entry.kind === 'system') {
        const body = entry.message?.body || ''
        if (/^Resona joined the chat\.?$/i.test(body.trim())) return ''
        return `<p class="message-service-pill" data-message-id="${escapeHtml(entry.message?.id || '')}"><span>${escapeHtml(body || 'System update')}</span></p>`
      }

      const isSelf = entry.senderId === appState.user?.uid
      let sender = getParticipantMeta(thread, entry.senderId)
      const liveAgentMessage = entry.messages.find((message) => message.senderType === 'agent')
      if (liveAgentMessage) {
        sender = {
          ...sender,
          displayName: liveAgentMessage.senderFirstName || liveAgentMessage.senderDisplayName || 'Support',
          username: 'Melogic Support',
          avatarURL: appState.resonaSupportAvatarURL || appState.resonaAvatarURL || '',
          photoURL: appState.resonaSupportAvatarURL || appState.resonaAvatarURL || ''
        }
      }
      const lastMessage = entry.messages[entry.messages.length - 1]
      const isLatestOutgoingGroup = isSelf && [...grouped].reverse().find((item) => item.kind === 'messages' && item.senderId === appState.user?.uid)?.id === entry.id
      const statusLine = isLatestOutgoingGroup ? `<p class="message-status-line">${escapeHtml(getOutgoingStatusLabel(thread, lastMessage))}</p>` : `<p class="message-status-line is-muted">${escapeHtml(formatTime(lastMessage.createdAt))}</p>`
      const avatarMarkup = !isSelf
        ? `<div class="cluster-avatar ${sender.avatarURL || sender.photoURL ? 'has-image' : ''}" data-inbox-avatar-root>${sender.avatarURL || sender.photoURL ? `<img decoding="async" src="${escapeHtml(sender.avatarURL || sender.photoURL)}" alt="" data-inbox-avatar-image data-stable-image-key="${escapeHtml(`message-avatar:${sender.uid}:${entry.id}`)}" /><span class="inbox-avatar-fallback">${escapeHtml(getInitials(sender))}</span>` : `<span>${escapeHtml(getInitials(sender))}</span>`}</div>`
        : ''

      const bubbles = entry.messages
        .map((message, messageIndex) => {
          const isSingle = entry.messages.length === 1
          const isFirst = messageIndex === 0
          const isLast = messageIndex === entry.messages.length - 1
          const isMiddle = !isFirst && !isLast
          const canEdit = message.senderId === appState.user?.uid
            && !message.optimistic
            && !message.deleted
            && String(message.type || 'text') === 'text'
            && (!Array.isArray(message.attachments) || !message.attachments.length)
          const editingMessageId = appState.editingMessageByThreadId[thread.id] || ''
          const isEditing = editingMessageId === message.id && canEdit
          const editDraft = appState.editDraftByMessageId[message.id] || message.body || ''
          const attachmentsMarkup = Array.isArray(message.attachments) && message.attachments.length
            ? `<div class="message-attachment-list">${message.attachments.map((attachment, attachmentIndex) => {
              const mime = String(attachment.mimeType || '')
              const width = Math.max(0, Number(attachment.width || 0))
              const height = Math.max(0, Number(attachment.height || 0))
              const dimensions = width && height ? ` width="${Math.round(width)}" height="${Math.round(height)}"` : ''
              const attachmentKey = getAttachmentCacheKey(message, attachment, attachmentIndex)
              const attachmentUrl = getStableAttachmentUrl(message, attachment, attachmentIndex)
              const aspectRatio = width && height ? ` style="aspect-ratio: ${Math.round(width)} / ${Math.round(height)}"` : ''
              const hasFailed = attachmentUrlErrorCache.get(attachmentKey) === attachmentUrl
              if (mime.startsWith('image/')) return `<button type="button" class="message-image-preview-button ${hasFailed ? 'is-image-load-failed' : ''}" data-message-media-key="${escapeHtml(attachmentKey)}" data-preview-message-image="${escapeHtml(attachmentUrl)}" data-preview-message-image-name="${escapeHtml(attachment.name || 'Image attachment')}"${aspectRatio}><img decoding="async" src="${escapeHtml(attachmentUrl)}" alt="${escapeHtml(attachment.name || 'Image attachment')}" loading="lazy" data-message-attachment-key="${escapeHtml(attachmentKey)}"${dimensions} /></button>`
              if (mime.startsWith('video/')) return `<video src="${escapeHtml(attachmentUrl)}" controls preload="metadata" data-message-media-key="${escapeHtml(attachmentKey)}"></video>`
              if (mime.startsWith('audio/')) return `<audio src="${escapeHtml(attachmentUrl)}" controls></audio>`
              return `<a href="${escapeHtml(attachmentUrl)}" target="_blank" rel="noopener" class="message-file-link">${escapeHtml(attachment.name || 'Download attachment')}</a>`
            }).join('')}</div>`
            : ''
          const failedActions = message.optimistic && message.sendStatus === 'failed'
            ? `<div class="message-send-failed-actions"><button type="button" data-retry-message="${escapeHtml(message.clientMessageId || '')}">Retry</button><button type="button" data-remove-failed-message="${escapeHtml(message.clientMessageId || '')}">Remove</button></div>`
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
              : message.body ? `<p>${escapeHtml(message.body)}</p>` : ''
          const hideBlockedMessage = isBlockedMessageForViewer(thread, message) && !isBlockedMessageRevealed(thread.id, message.id)
          if (hideBlockedMessage) {
            return `
              <article class="message-bubble is-single is-first is-last blocked-message-placeholder" data-message-id="${message.id}" data-message-thread-id="${thread.id}" data-sender-id="${message.senderId}">
                <p>Message from blocked user hidden</p>
                <button type="button" data-reveal-blocked-message="${message.id}" data-reveal-blocked-thread-id="${thread.id}">Show</button>
              </article>
            `
          }
          return `
            <article class="message-bubble ${isSingle ? 'is-single' : ''} ${isFirst ? 'is-first' : ''} ${isMiddle ? 'is-middle' : ''} ${isLast ? 'is-last' : ''} ${message.deleted ? 'is-deleted' : ''} ${replyTo ? 'has-reply' : ''} ${attachmentsMarkup ? 'has-media' : ''} ${message.optimistic ? 'is-optimistic' : ''} ${message.sendStatus === 'failed' ? 'is-send-failed' : ''}" data-message-id="${message.id}" data-message-render-key="${escapeHtml(message.renderKey || message.clientMessageId || message.id)}" data-message-thread-id="${thread.id}" data-sender-id="${message.senderId}">
              ${replyMarkup}
              ${bodyMarkup}
              ${attachmentsMarkup}
              ${failedActions}
              ${reactionPills ? `<div class="message-reaction-row">${reactionPills}</div>` : ''}
              ${editedMarker}
            </article>
            ${resonaMessageActionsMarkup(thread, message)}
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

  return `<div class="message-list" data-message-list data-message-render-signature="${escapeHtml(renderSignature)}">${olderControl}${messageGroups}</div>`
}

function getConversationBodyMarkup({
  reuseMessageList = false,
  messages = null,
  renderSignature = ''
} = {}) {
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
  const isPreparingInitialThread = Boolean(appState.preparingThreadIds[thread.id])
  if (isLoading && !isPreparingInitialThread) {
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
  const resonaResponding = isThreadResonaResponding(thread)
  const historyClearing = thread.historyClearing === true
  const resonaActivityLabel = getThreadResonaActivityLabel(thread)
  const blockState = getDmBlockState(thread)
  const isDmComposerBlocked = thread.type === 'dm' && (blockState.currentUserBlockedOther || blockState.otherBlockedCurrentUser)
  const isPreparingThread = Boolean(appState.preparingThreadIds[thread.id])
  const localParticipantIds = getThreadParticipantUids(thread)
  const isKnownParticipant = localParticipantIds.includes(appState.user?.uid)
  const isComposerUnavailable = isDmComposerBlocked || isPreparingThread || !isKnownParticipant || historyClearing
  const composerRenderSignature = hashRenderSignature({
    threadId: thread.id,
    isDmComposerBlocked,
    isPreparingThread,
    isKnownParticipant,
    resonaResponding,
    historyClearing,
    replyDraft,
    attachments,
    previewUrls,
    errorMessage: appState.errorMessage
  })
  const blockAlertMarkup = thread.type === 'dm' && isDmComposerBlocked
    ? `
      <div class="blocked-chat-alert" role="status">
        <strong>${blockState.currentUserBlockedOther ? 'You blocked this user.' : 'This user can no longer receive messages from you.'}</strong>
        <span>You can still view previous messages.</span>
        ${blockState.currentUserBlockedOther ? `<button type="button" data-unblock-contact-inline="${thread.id}">Unblock</button>` : ''}
      </div>
    `
    : ''
  const resonaBackgroundStyle = isResonaThread(thread) && appState.resonaBackgroundURL
    ? ` style="--resona-chat-background:url('${escapeHtml(appState.resonaBackgroundURL)}')"`
    : ''

  return `
    <div class="conversation-stack ${isResonaThread(thread) ? 'is-resona-chat' : ''}"${resonaBackgroundStyle}>
      ${reuseMessageList
        ? '<div data-message-list-slot></div>'
        : getMessageGroupsMarkup(thread, {
            messages: messages || getRenderableMessages(thread),
            renderSignature: renderSignature || getMessageRenderSignature(thread, messages || getRenderableMessages(thread))
          })}
      <p class="typing-indicator typing-indicator-inline" data-typing-indicator-inline ${typingUsers.length || resonaResponding ? '' : 'hidden'}>${resonaResponding ? escapeHtml(resonaActivityLabel) : (typingUsers.length ? escapeHtml(getConversationSubtitle(thread)) : '')}</p>
      ${blockAlertMarkup}
      <form class="message-composer ${isComposerUnavailable ? 'is-blocked' : ''}" data-message-form data-guide-id="inbox-message-composer" data-guide-label="Message composer" data-guide-role="message-composer" data-composer-render-signature="${escapeHtml(composerRenderSignature)}">
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
        <textarea id="message-input" name="message" data-message-composer-input="${thread.id}" rows="2" maxlength="1200" placeholder="${historyClearing ? 'Deleting conversation history...' : isPreparingThread ? 'Preparing conversation...' : 'Write a message...'}" ${isComposerUnavailable ? 'disabled' : ''}>${escapeHtml(draft)}</textarea>
        <input type="file" class="composer-attachment-input" data-attachment-input multiple accept="image/*,video/*,audio/*,.pdf,.zip,.doc,.docx,.txt" ${isComposerUnavailable ? 'disabled' : ''} />
        <div class="message-composer-footer">
          ${appState.errorMessage
            ? `<p class="composer-error">${escapeHtml(appState.errorMessage)}</p>`
            : resonaResponding
              ? `<p class="composer-note">${escapeHtml(resonaActivityLabel)}</p>`
            : historyClearing
              ? '<p class="composer-note">Deleting conversation history...</p>'
            : isPreparingThread
              ? '<p class="composer-note">Preparing conversation...</p>'
              : !isKnownParticipant
                ? '<p class="composer-error">You do not have permission to send in this conversation.</p>'
                : '<span></span>'}
          <div class="composer-actions">
            <button type="button" class="button button-muted" data-action="attach-file" aria-label="Attach files" data-guide-id="inbox-message-attach" data-guide-label="Attach files" data-guide-role="message-composer-button" ${isComposerUnavailable ? 'disabled' : ''}>+</button>
            <button type="submit" class="button button-accent" data-guide-id="inbox-message-send" data-guide-label="Send" data-guide-role="message-composer-button" ${(isComposerUnavailable || resonaResponding || (!draft.trim() && !attachments.length)) ? 'disabled' : ''}>Send</button>
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

  const resonaThread = getResonaDisplayThread()
  const normalThreads = appState.threads.filter((thread) => !isResonaThread(thread))
  const resonaCard = `
    <article class="thread-row thread-row-resona ${resonaThread.id && resonaThread.id === appState.selectedThreadId ? 'is-active' : ''}" data-thread-row-id="${escapeHtml(resonaThread.id || 'resona')}" data-guide-id="inbox-thread-resona" data-guide-label="Resona conversation" data-guide-role="conversation-card" data-thread-render-signature="${escapeHtml(hashRenderSignature({ thread: resonaThread, avatar: appState.resonaAvatarURL }))}">
      <button class="thread-row-main" type="button" data-open-resona-thread>
        ${renderThreadAvatar(resonaThread, { stableKey: `thread-list:${resonaThread.id || 'resona'}` })}
        <div class="thread-meta">
          <div class="thread-title-row">
            <strong>Resona</strong>
            <span>${escapeHtml(formatThreadTimestamp(resonaThread.lastMessageAt || resonaThread.updatedAt || resonaThread.createdAt))}</span>
          </div>
          <div class="thread-preview-row">
            <p>${escapeHtml(summarizeThreadPreview(resonaThread) || 'Ask me anything')}</p>
            <small class="thread-badge thread-badge-agent">Agent</small>
          </div>
        </div>
      </button>
      ${resonaThread.id ? `
        <button type="button" class="thread-row-menu-trigger" data-thread-menu-id="${escapeHtml(resonaThread.id)}" aria-label="Open Resona actions">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.8" fill="currentColor"/>
            <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
            <circle cx="12" cy="19" r="1.8" fill="currentColor"/>
          </svg>
        </button>
      ` : ''}
    </article>
    <div class="thread-list-divider" aria-hidden="true"></div>
  `

  if (!normalThreads.length && appState.hasLoadedThreadsOnce) {
    return `
      <div class="inbox-thread-list is-empty">
        ${resonaCard}
        <p>No conversations yet.</p>
        <p>Start a direct message or create a group conversation.</p>
      </div>
    `
  }

  const rows = normalThreads
    .map((thread) => {
      const isActive = thread.id === appState.selectedThreadId
      const unread = Number(thread.unreadCount || 0)
      const subtitle = summarizeThreadPreview(thread)
      const avatarProfiles = thread.type === 'group'
        ? getGroupAvatarProfiles(thread).map((profile) => [profile.uid, profile.avatarURL, profile.displayName])
        : []
      const rowSignature = hashRenderSignature({
        thread,
        isActive,
        unread,
        subtitle,
        avatarProfiles
      })
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
        <article class="thread-row ${isActive ? 'is-active' : ''}" data-thread-row-id="${thread.id}" data-guide-id="inbox-thread-${escapeHtml(thread.id)}" data-guide-label="${escapeHtml(thread.title || 'Conversation')}" data-guide-role="conversation-card" data-thread-render-signature="${escapeHtml(rowSignature)}">
          <button class="thread-row-main" type="button" data-select-thread-id="${thread.id}">
            ${renderThreadAvatar(thread, { stableKey: `thread-list:${thread.id}` })}
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

  return `<div class="inbox-thread-list">${resonaCard}${rows}</div>`
}

function getThreadActionMenuMarkup() {
  const menu = appState.threadActionMenu
  if (!menu) return ''
  const thread = appState.threads.find((entry) => entry.id === menu.threadId)
  if (!thread) return ''
  const position = clampMenuPosition(menu.x, menu.y, 220, 280)
  const dmOtherUid = getDmOtherParticipant(thread)
  const isDm = thread.type === 'dm' && Boolean(dmOtherUid)
  const isResona = isResonaThread(thread)
  const sidebarPinned = isInboxPinned('thread', thread.id)
  const dock = getChatDockState()
  const isOpenInDock = dock.open && dock.mode === 'thread' && dock.activeThreadId === thread.id
  const dockAction = isOpenInDock && !dock.minimized ? 'close-dock' : 'open-dock'
  const dockLabel = isOpenInDock ? (dock.minimized ? 'Open dock' : 'Unpin from dock') : 'Open in dock'
  const blockAction = isDm && !isResona
    ? `<button type="button" data-thread-action="${isUserBlocked(dmOtherUid) ? 'unblock-contact' : 'block-contact'}" data-thread-action-id="${thread.id}">
        ${iconSvg('user')}<span>${isUserBlocked(dmOtherUid) ? 'Unblock contact' : 'Block contact'}</span>
      </button>`
    : ''
  const resonaAgentAction = !isResona
    ? `<button type="button" data-thread-action="${hasResonaAgent(thread) ? 'remove-resona' : 'add-resona'}" data-thread-action-id="${thread.id}">
        ${iconSvg(hasResonaAgent(thread) ? 'x' : 'at')}<span>${hasResonaAgent(thread) ? 'Remove Resona' : 'Add Resona'}</span>
      </button>`
    : ''
  const resetOrDeleteAction = isResona
    ? `<button type="button" data-thread-action="refresh-resona" data-thread-action-id="${thread.id}">
        ${iconSvg('refresh')}<span>Refresh chat</span>
      </button>
      <button type="button" class="is-danger" data-thread-action="clear-resona-history" data-thread-action-id="${thread.id}">
        ${iconSvg('trash')}<span>Delete chat history</span>
      </button>`
    : `<button type="button" class="is-danger" data-thread-action="delete" data-thread-action-id="${thread.id}">
        ${iconSvg('trash')}<span>Delete chat</span>
      </button>`
  return `
    <div class="message-context-backdrop" data-thread-menu-close>
      <div class="thread-actions-menu" role="menu" aria-label="Chat actions" style="left:${position.x}px;top:${position.y}px;">
        <button type="button" data-thread-action="details" data-thread-action-id="${thread.id}">
          ${iconSvg('messageCircle')}<span>Chat details</span>
        </button>
        <button type="button" data-thread-action="${thread.pinned ? 'unpin' : 'pin'}" data-thread-action-id="${thread.id}">
          ${iconSvg('bookmark')}<span>${thread.pinned ? 'Unpin chat' : 'Pin chat'}</span>
        </button>
        <button type="button" data-thread-action="${sidebarPinned ? 'unpin-sidebar' : 'pin-sidebar'}" data-thread-action-id="${thread.id}">
          ${iconSvg('bookmark')}<span>${sidebarPinned ? 'Unpin from sidebar' : 'Pin to sidebar'}</span>
        </button>
        <button type="button" data-thread-action="${dockAction}" data-thread-action-id="${thread.id}">
          ${iconSvg('messageCircle')}<span>${dockLabel}</span>
        </button>
        ${resonaAgentAction}
        ${resetOrDeleteAction}
        ${blockAction}
      </div>
    </div>
  `
}

function openThreadInChatDock(threadId = '') {
  const thread = appState.threads.find((entry) => entry.id === threadId)
  if (!thread) return
  openChatDock({
    threadId,
    title: thread.title || 'Conversation'
  })
}

async function selectThread(threadId = '', { forceBottom = true } = {}) {
  if (!threadId) return
  if (appState.activeFilter !== 'Messages') {
    applyInboxRoute(parseInboxRoute(ROUTES.inboxMessages))
    window.history.pushState({ inbox: true }, '', inboxRouteWithCurrentSearch(ROUTES.inboxMessages))
  }
  if (activeTypingThreadId && activeTypingThreadId !== threadId) clearTypingForThread(activeTypingThreadId)
  if (appState.selectedThreadId && appState.selectedThreadId !== threadId) {
    delete appState.replyDraftByThreadId[appState.selectedThreadId]
    stopResonaSpeech({ render: false })
  }
  appState.threadActionMenu = null
  appState.threadConfirmModal = null
  appState.messageFind = { open: false, query: '', activeIndex: -1, matchCount: 0 }
  appState.selectedThreadId = threadId
  saveLastSelectedThread(appState.user?.uid, threadId)
  appState.errorMessage = ''
  startMessageSubscription(threadId)
  hydrateProfilesForThread(getSelectedThread())
  renderThreadListOnly()
  renderSelectedConversation({ forceBottom })
  if (canMarkThreadRead(threadId)) {
    await markThreadRead({ threadId, uid: appState.user?.uid }).catch((error) => {
      warnRealtimePermission(`participants-read-${threadId}`, error)
    })
  }
}

async function ensureResonaThread({ select = false } = {}) {
  if (!appState.user?.uid) return null
  if (appState.openingResonaThread && !select) return getResonaThread()
  appState.openingResonaThread = true
  try {
    const existing = getResonaThread()
    if (existing?.id) {
      appState.resonaThreadId = existing.id
      if (select) await selectThread(existing.id)
      return existing
    }
    const thread = await createOrGetResonaThread()
    if (thread?.id) {
      appState.resonaThreadId = thread.id
      upsertThreadInState({
        ...thread,
        title: 'Resona',
        imagePath: thread.imagePath || RESONA_AVATAR_PATH,
        imageURL: appState.resonaAvatarURL || thread.imageURL || ''
      })
      if (select) await selectThread(thread.id)
      else {
        renderThreadListOnly()
      }
      return thread
    }
  } catch (error) {
    console.error('[inbox] createOrGetResonaThread failed', {
      code: error?.code,
      message: error?.message,
      details: error?.details
    })
    appState.errorMessage = error?.message || 'Could not open Resona.'
    renderSignedInState()
  } finally {
    appState.openingResonaThread = false
  }
  return null
}

function findThreadMessage(threadId = '', messageId = '') {
  return (appState.messagesByThreadId[threadId] || []).find((message) => message.id === messageId) || null
}

function parseResonaActionKey(value = '') {
  const [threadId, messageId, action = ''] = String(value || '').split(':')
  return { threadId, messageId, action }
}

async function handleResonaFeedback(value = '') {
  const { threadId, messageId, action } = parseResonaActionKey(value)
  if (!threadId || !messageId || !['like', 'dislike'].includes(action)) return
  const stateKey = resonaMessageStateKey(threadId, messageId)
  const current = appState.resonaFeedbackByMessageId[stateKey] || ''
  const nextValue = current === action ? 'clear' : action
  appState.resonaFeedbackByMessageId = {
    ...appState.resonaFeedbackByMessageId,
    [stateKey]: nextValue === 'clear' ? '' : nextValue
  }
  renderSelectedConversation({ reason: 'state-update' })
  try {
    await setResonaMessageFeedback({ threadId, messageId, value: nextValue })
  } catch (error) {
    appState.resonaFeedbackByMessageId = { ...appState.resonaFeedbackByMessageId, [stateKey]: current }
    appState.errorMessage = error?.message || 'Could not save feedback.'
    renderSelectedConversation({ reason: 'state-update' })
  }
}

async function handleResonaCopy(value = '') {
  const { threadId, messageId } = parseResonaActionKey(value)
  const message = findThreadMessage(threadId, messageId)
  if (!message?.body) return
  try {
    await navigator.clipboard.writeText(message.body)
    appState.errorMessage = 'Copied Resona response.'
  } catch {
    appState.errorMessage = 'Could not copy message.'
  }
  renderSelectedConversation({ reason: 'state-update' })
}

function stopResonaSpeech({ render = true } = {}) {
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  appState.resonaSpeakingMessageId = ''
  if (render) renderSelectedConversation({ reason: 'state-update' })
}

function handleResonaSpeak(value = '') {
  const { threadId, messageId } = parseResonaActionKey(value)
  const message = findThreadMessage(threadId, messageId)
  if (!message?.body || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') return
  const stateKey = resonaMessageStateKey(threadId, messageId)
  if (appState.resonaSpeakingMessageId === stateKey) {
    stopResonaSpeech()
    return
  }
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(message.body)
  utterance.onend = () => {
    if (appState.resonaSpeakingMessageId === stateKey) stopResonaSpeech({ render: true })
  }
  utterance.onerror = () => {
    if (appState.resonaSpeakingMessageId === stateKey) stopResonaSpeech({ render: true })
  }
  appState.resonaSpeakingMessageId = stateKey
  renderSelectedConversation({ reason: 'state-update' })
  window.speechSynthesis.speak(utterance)
}

async function handleReportResonaMessage(threadId = '', messageId = '') {
  if (!threadId || !messageId) return
  appState.resonaActionMenu = null
  renderFloatingUi()
  try {
    await reportResonaMessage({
      threadId,
      messageId,
      reason: 'Other',
      description: 'Reported from Resona message actions.'
    })
    appState.errorMessage = 'Resona message reported.'
  } catch (error) {
    appState.errorMessage = error?.message || 'Could not report message.'
  }
  renderSelectedConversation({ reason: 'state-update' })
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
    },
    'clear-resona-history': {
      title: 'Delete Resona chat history?',
      body: 'This permanently deletes the conversation, attachments, reactions, and related Resona history. This cannot be undone.',
      confirm: 'Delete history',
      danger: true
    },
    'block-contact': {
      title: 'Block contact?',
      body: 'You will not receive direct messages from this user. You can still view previous messages.',
      confirm: 'Block contact',
      danger: true
    },
    'unblock-contact': {
      title: 'Unblock contact?',
      body: 'This user will be able to message you again.',
      confirm: 'Unblock contact',
      danger: false
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

function setLocalDmBlockState(threadId, dmBlockState) {
  if (!threadId) return
  appState.threads = appState.threads.map((thread) => (
    thread.id === threadId ? { ...thread, dmBlockState } : thread
  ))
}

async function blockDmContact(thread) {
  const targetUid = getDmOtherParticipant(thread)
  if (!thread?.id || !targetUid || !appState.user?.uid) return
  const optimisticState = {
    blockedBy: appState.user.uid,
    blockedUid: targetUid,
    updatedAt: new Date().toISOString()
  }
  const previousState = thread.dmBlockState || null
  setLocalDmBlockState(thread.id, optimisticState)
  const profile = getProfileMeta(targetUid, { uid: targetUid, title: thread?.title || '' })
  try {
    await blockUser({
      uid: appState.user.uid,
      targetUid,
      sourceThreadId: thread.id,
      targetProfile: profile
    })
    appState.blockedUsersByUid[targetUid] = {
      targetUid,
      sourceThreadId: thread.id,
      targetDisplayName: profile.displayName || '',
      targetUsername: profile.username || '',
      targetAvatarURL: profile.avatarURL || ''
    }
  } catch (error) {
    setLocalDmBlockState(thread.id, previousState)
    throw error
  }
}

async function unblockDmContact(thread) {
  const targetUid = getDmOtherParticipant(thread)
  if (!thread?.id || !targetUid || !appState.user?.uid) return
  const previousState = thread.dmBlockState || null
  if (previousState?.blockedBy === appState.user.uid && previousState?.blockedUid === targetUid) {
    setLocalDmBlockState(thread.id, null)
  }
  try {
    await unblockUser({ uid: appState.user.uid, targetUid, sourceThreadId: thread.id })
    delete appState.blockedUsersByUid[targetUid]
  } catch (error) {
    setLocalDmBlockState(thread.id, previousState)
    throw error
  }
}

async function handleThreadConfirmAction() {
  const modal = appState.threadConfirmModal
  if (!modal?.threadId || !appState.user?.uid || appState.isSavingThreadAction) return
  appState.isSavingThreadAction = true
  renderFloatingUi()
  try {
    if (modal.type === 'pin') {
      const previousThreads = appState.threads
      appState.threads = appState.threads.map((thread) => (thread.id === modal.threadId
        ? { ...thread, pinned: true, pinnedAt: new Date().toISOString() }
        : thread))
      appState.threads = sortInboxThreadsLocal(appState.threads)
      renderThreadListOnly()
      await setThreadPinnedForUser({ uid: appState.user.uid, threadId: modal.threadId, pinned: true }).catch((error) => {
        appState.threads = previousThreads
        throw error
      })
    }
    if (modal.type === 'unpin') {
      const previousThreads = appState.threads
      appState.threads = appState.threads.map((thread) => (thread.id === modal.threadId
        ? { ...thread, pinned: false, pinnedAt: null }
        : thread))
      appState.threads = sortInboxThreadsLocal(appState.threads)
      renderThreadListOnly()
      await setThreadPinnedForUser({ uid: appState.user.uid, threadId: modal.threadId, pinned: false }).catch((error) => {
        appState.threads = previousThreads
        throw error
      })
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
    if (modal.type === 'clear-resona-history') {
      const result = await clearResonaChatHistory({ threadId: modal.threadId })
      const clearedAt = result.clearedAt || new Date().toISOString()
      appState.threads = appState.threads.map((thread) => (thread.id === modal.threadId
        ? {
            ...thread,
            clearedAt,
            clearedBy: appState.user.uid,
            historyClearing: false,
            lastMessageText: '',
            lastMessagePreview: 'Ask Resona anything.',
            status: 'ai_active',
            mode: 'general',
            assignedAgentUid: null,
            assignedAgentFirstName: '',
            participantIds: [appState.user.uid],
            participantUids: [appState.user.uid],
            memberUids: [appState.user.uid]
          }
        : thread))
      appState.messagesByThreadId[modal.threadId] = []
      appState.messagePaginationByThreadId[modal.threadId] = {
        loadingOlder: false,
        hasOlder: false,
        loadedOlder: false
      }
      appState.reactionsByThreadId[modal.threadId] = {}
      appState.typingUsersByThreadId[modal.threadId] = []
      appState.optimisticMessagesByThreadId[modal.threadId] = []
      appState.resonaFeedbackByMessageId = {}
      clearTypingForThread(modal.threadId)
    }
    if (modal.type === 'block-contact' || modal.type === 'unblock-contact') {
      const thread = appState.threads.find((entry) => entry.id === modal.threadId)
      if (modal.type === 'block-contact') await blockDmContact(thread)
      else await unblockDmContact(thread)
    }
    closeThreadActionUi()
    renderThreadListOnly()
    renderSidebarOnly()
    renderSelectedConversation({ reason: 'state-update' })
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to update chat action.'
    appState.isSavingThreadAction = false
    renderFloatingUi()
  }
}

async function saveInboxPin(pin) {
  if (!appState.user?.uid || !pin?.pinId || appState.isSavingInboxPin) return false
  appState.isSavingInboxPin = pin.pinId
  try {
    await upsertInboxPin(appState.user.uid, pin)
    return true
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to pin item.'
    return false
  } finally {
    appState.isSavingInboxPin = ''
    renderSidebarOnly()
  }
}

async function removeInboxPin(pinId) {
  if (!appState.user?.uid || !pinId || appState.isSavingInboxPin) return false
  appState.isSavingInboxPin = pinId
  try {
    await deleteInboxPin(appState.user.uid, pinId)
    return true
  } catch (error) {
    appState.errorMessage = error?.message || 'Unable to remove pinned item.'
    return false
  } finally {
    appState.isSavingInboxPin = ''
    renderSidebarOnly()
  }
}

async function openInboxPin(pinId) {
  const pin = appState.inboxPins.find((entry) => (entry.pinId || entry.id) === pinId)
  if (!pin) return
  if (pin.type === 'thread') {
    applyInboxRoute(parseInboxRoute(ROUTES.inboxMessages))
    window.history.pushState({ inbox: true }, '', inboxRouteWithCurrentSearch(ROUTES.inboxMessages))
    appState.selectedThreadId = pin.targetId
    saveLastSelectedThread(appState.user?.uid, pin.targetId)
    const selectedMirror = appState.threads.find((thread) => thread.id === pin.targetId)
    const hydratedThread = await hydrateThreadFromSourceIfNeeded(selectedMirror)
    if (hydratedThread) upsertThreadInState(hydratedThread)
    startMessageSubscription(pin.targetId)
    hydrateProfilesForThread(getSelectedThread())
    renderThreadListOnly()
    renderSelectedConversation({ forceBottom: true })
    return
  }
  if (pin.sourceCategory === 'System' || pin.type === 'systemNotification' || pin.type === 'accountEvent') {
    if (pin.metadata?.notificationSection === 'content') {
      if (pin.targetPath?.startsWith('/')) window.location.assign(pin.targetPath)
      else {
        applyInboxRoute(parseInboxRoute(ROUTES.inboxContentAll))
        window.history.pushState({ inbox: true }, '', inboxRouteWithCurrentSearch(ROUTES.inboxContentAll))
        renderSignedInState()
      }
      return
    }
    applyInboxRoute(parseInboxRoute(ROUTES.inboxSystem))
    window.history.pushState({ inbox: true }, '', inboxRouteWithCurrentSearch(ROUTES.inboxSystem))
    appState.systemFilter = pin.metadata?.systemFilter || (pin.type === 'accountEvent' ? 'account' : 'all')
    renderSignedInState()
    return
  }
  if (pin.targetPath && pin.targetPath.startsWith('/')) window.location.assign(pin.targetPath)
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

function isCallFinal(status) {
  return ['ended', 'declined', 'missed', 'failed', 'cancelled'].includes(String(status || ''))
}

function getCallCounterpart(call) {
  if (!call || !appState.user?.uid) return { uid: '', displayName: 'Melogic member', photoURL: '' }
  const outgoing = call.callerUid === appState.user.uid
  return outgoing
    ? { uid: call.calleeUid, displayName: call.calleeDisplayName, photoURL: call.calleePhotoURL }
    : { uid: call.callerUid, displayName: call.callerDisplayName, photoURL: call.callerPhotoURL }
}

function getCallStatusLabel(call) {
  const status = String(call?.status || '')
  if (status === 'ringing') return call?.callerUid === appState.user?.uid ? 'Outgoing · No answer yet' : 'Incoming · Missed if unanswered'
  if (status === 'declined') return call?.callerUid === appState.user?.uid ? 'Declined' : 'Declined by you'
  if (status === 'cancelled') return 'Cancelled'
  if (status === 'missed') return 'Missed'
  if (status === 'failed') return 'Failed'
  if (status === 'ended') return 'Completed'
  if (status === 'active') return 'Active now'
  return 'Connecting'
}

function getCallDuration(call) {
  const start = new Date(call?.connectedAt || call?.acceptedAt || call?.startedAt || 0).getTime()
  if (!start) return ''
  const end = new Date(call?.endedAt || Date.now()).getTime()
  const seconds = Math.max(0, Math.round((end - start) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = String(seconds % 60).padStart(2, '0')
  return `${minutes}:${remainder}`
}

function renderCallAvatar(person, className = 'account-call-avatar') {
  const image = String(person?.photoURL || '').trim()
  return `
    <div class="${className} ${image ? 'has-image' : ''}">
      ${image ? `<img src="${escapeHtml(image)}" alt="" />` : `<span>${escapeHtml(getInitials(person))}</span>`}
    </div>
  `
}

function getCallRouteTarget(call) {
  const counterpart = getCallCounterpart(call)
  return counterpart.uid || call?.threadId || call?.id || ''
}

function getRouteMatchedCall(targetId = appState.activeCallTargetId) {
  if (!targetId) return null
  const calls = [
    appState.activeCall,
    ...appState.incomingCalls,
    ...appState.recentCalls
  ].filter((call) => call && !isCallFinal(call.status))
  return calls.find((call) => (
    getCallRouteTarget(call) === targetId
    || call.threadId === targetId
    || call.id === targetId
  )) || null
}

function getActiveCallContentMarkup() {
  const call = getRouteMatchedCall()
  if (!call) {
    return `
      <section class="activity-panel account-calls-panel">
        <header class="panel-header activity-header">
          <h3>Active Call</h3>
          <p>Account-to-account audio calling</p>
        </header>
        <section class="inbox-empty-panel activity-empty-panel">
          <h3>No active call found.</h3>
          <p>This call may have ended or been cancelled.</p>
          <button type="button" class="button button-muted" data-inbox-path="${ROUTES.inboxCalls}">Back to Calls</button>
        </section>
      </section>
    `
  }

  const person = getCallCounterpart(call)
  const incomingRinging = call.status === 'ringing' && call.calleeUid === appState.user?.uid
  const outgoingRinging = call.status === 'ringing' && call.callerUid === appState.user?.uid
  const status = appState.callUiState === 'active'
    ? `Connected · ${getCallDuration(call)}`
    : getCallStatusLabel(call)
  return `
    <section class="activity-panel account-calls-panel account-call-route-panel">
      <header class="panel-header activity-header">
        <div>
          <p class="account-call-eyebrow">Active call</p>
          <h3>${escapeHtml(person.displayName || 'Melogic member')}</h3>
        </div>
        <button type="button" class="button button-muted" data-inbox-path="${ROUTES.inboxCalls}">All Calls</button>
      </header>
      ${appState.callError ? `<div class="account-call-error" role="alert">${escapeHtml(appState.callError)}</div>` : ''}
      <section class="account-call-active-card account-call-active-route-card ${incomingRinging ? 'is-incoming' : ''}">
        ${renderCallAvatar(person)}
        <div class="account-call-active-meta">
          <h3>${escapeHtml(person.displayName || 'Melogic member')}</h3>
          <p>${escapeHtml(status)}</p>
          <small>${escapeHtml(appState.callUiState || call.status || 'connecting')}</small>
        </div>
        <div class="account-call-actions">
          ${incomingRinging ? `
            <button type="button" class="button button-accent" data-account-call-action="accept" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>Accept</button>
            <button type="button" class="button account-call-danger" data-account-call-action="decline" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>Decline</button>
          ` : outgoingRinging ? `
            <button type="button" class="button account-call-danger" data-account-call-action="cancel" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === 'cancel' ? 'Cancelling...' : 'Cancel'}</button>
          ` : `
            <button type="button" class="button button-muted" data-account-call-action="toggle-mute" data-call-id="${escapeHtml(call.id)}">${appState.callMuted ? 'Unmute' : 'Mute'}</button>
            <button type="button" class="button account-call-danger" data-account-call-action="end" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === 'end' ? 'Ending...' : 'End Call'}</button>
          `}
        </div>
      </section>
    </section>
  `
}

function getCallsContentMarkup() {
  if (appState.callView === 'active') return getActiveCallContentMarkup()
  const activeCall = appState.activeCall && !isCallFinal(appState.activeCall.status) ? appState.activeCall : null
  const incomingCalls = appState.incomingCalls.filter((call) => call.status === 'ringing' && call.id !== activeCall?.id)
  const history = appState.recentCalls
    .filter((call) => isCallFinal(call.status) && (!activeCall || call.id !== activeCall.id))
    .slice(0, 20)
  const activeMarkup = activeCall
    ? (() => {
        const person = getCallCounterpart(activeCall)
        const outgoingRinging = activeCall.callerUid === appState.user?.uid && activeCall.status === 'ringing'
        return `
          <section class="account-call-active-card">
            ${renderCallAvatar(person)}
            <div class="account-call-active-meta">
              <p class="account-call-eyebrow">Current audio call</p>
              <h3>${escapeHtml(person.displayName || 'Melogic member')}</h3>
              <p>${escapeHtml(appState.callUiState === 'active' ? `Connected · ${getCallDuration(activeCall)}` : getCallStatusLabel(activeCall))}</p>
            </div>
            <div class="account-call-actions">
              ${outgoingRinging
                ? `
                  <button type="button" class="button button-muted" data-inbox-path="${inboxActiveCallRoute(getCallRouteTarget(activeCall))}">Open</button>
                  <button type="button" class="button account-call-danger" data-account-call-action="cancel" data-call-id="${escapeHtml(activeCall.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === 'cancel' ? 'Cancelling...' : 'Cancel'}</button>
                `
                : `
                  <button type="button" class="button button-muted" data-inbox-path="${inboxActiveCallRoute(getCallRouteTarget(activeCall))}">Open</button>
                  <button type="button" class="button button-muted" data-account-call-action="toggle-mute" data-call-id="${escapeHtml(activeCall.id)}">${appState.callMuted ? 'Unmute' : 'Mute'}</button>
                  <button type="button" class="button account-call-danger" data-account-call-action="end" data-call-id="${escapeHtml(activeCall.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === 'end' ? 'Ending...' : 'End call'}</button>
                `}
            </div>
          </section>
        `
      })()
    : ''
  const incomingMarkup = incomingCalls.length
    ? `
      <div class="account-call-incoming-list">
        ${incomingCalls.map((call) => {
          const person = getCallCounterpart(call)
          return `
            <section class="account-call-active-card is-incoming">
              ${renderCallAvatar(person)}
              <div class="account-call-active-meta">
                <p class="account-call-eyebrow">Incoming audio call</p>
                <h3>${escapeHtml(person.displayName || 'Melogic member')}</h3>
                <p>Ringing now</p>
              </div>
              <div class="account-call-actions">
                <button type="button" class="button button-muted" data-inbox-path="${inboxActiveCallRoute(getCallRouteTarget(call))}">Open</button>
                <button type="button" class="button button-accent" data-account-call-action="accept" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === `accept:${call.id}` ? 'Accepting...' : 'Accept'}</button>
                <button type="button" class="button account-call-danger" data-account-call-action="decline" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === `decline:${call.id}` ? 'Declining...' : 'Decline'}</button>
              </div>
            </section>
          `
        }).join('')}
      </div>
    `
    : ''

  return `
    <section class="activity-panel account-calls-panel">
      <header class="panel-header activity-header">
        <h3>Calls</h3>
        <p>Account-to-account audio calling</p>
      </header>
      ${appState.callError ? `<div class="account-call-error" role="alert">${escapeHtml(appState.callError)}</div>` : ''}
      ${activeMarkup}
      ${incomingMarkup}
      ${history.length ? `
        <div class="account-call-history">
          ${history.map((call) => {
            const person = getCallCounterpart(call)
            const outgoing = call.callerUid === appState.user?.uid
            return `
              <article class="account-call-history-row">
                ${renderCallAvatar(person, 'account-call-history-avatar')}
                <div>
                  <strong>${escapeHtml(person.displayName || 'Melogic member')}</strong>
                  <p>${outgoing ? 'Outgoing' : 'Incoming'} · ${escapeHtml(getCallStatusLabel(call))}</p>
                </div>
                <time>${escapeHtml(formatThreadTimestamp(call.startedAt || call.updatedAt))}${call.endedAt ? ` · ${escapeHtml(getCallDuration(call))}` : ''}</time>
              </article>
            `
          }).join('')}
        </div>
      ` : (!activeCall && !incomingCalls.length ? `
        <section class="inbox-empty-panel activity-empty-panel">
          <h3>No active calls.</h3>
          <p>Start a call from a direct message.</p>
        </section>
      ` : '')}
    </section>
  `
}

function contentNotificationHref(item = {}) {
  const metadata = item.metadata || {}
  const postId = item.postId || metadata.postId || ''
  const commentId = item.commentId || metadata.commentId || ''
  const replyId = item.replyId || metadata.replyId || ''
  const productId = item.productId || metadata.productId || ''
  const actorUid = item.actorUid || metadata.actorUid || ''
  if (postId) return communityPostRoute(postId, { commentId, replyId })
  if (productId) return productRoute(productId)
  if (String(item.type || '').includes('follow') && actorUid) return publicProfileRoute({ uid: actorUid })
  return item.actionHref || item.path || ROUTES.community
}

function notificationTargetHref(item = {}) {
  const type = String(item.type || '').toLowerCase()
  const metadata = item.metadata || {}
  const postId = item.postId || metadata.postId || ''
  const commentId = item.commentId || metadata.commentId || ''
  const replyId = item.replyId || metadata.replyId || ''
  const productId = item.productId || metadata.productId || ''
  const actorUid = item.actorUid || metadata.actorUid || ''
  const isContent = item.category === 'content' || Boolean(contentViewForNotification(item))

  if (isContent) return contentNotificationHref(item)
  if (item.actionHref || item.path) return item.actionHref || item.path
  if (securityAccountEventTypes.has(type) || item.category === 'security' || item.category === 'account') {
    return ROUTES.accountSecurity
  }
  if (postId) return communityPostRoute(postId, { commentId, replyId })
  if (productId) return productRoute(productId)
  if (item.communityId || metadata.communityId) return ROUTES.communityCommunities
  if (type.includes('follow') && actorUid) return publicProfileRoute({ uid: actorUid })
  return ''
}

function notificationRowById(sourceCollection = '', itemId = '') {
  const rows = sourceCollection === 'accountEvents' ? appState.accountEvents : appState.systemNotifications
  const item = rows.find((entry) => entry.id === itemId)
  if (!item) return null
  return sourceCollection === 'accountEvents'
    ? {
        ...item,
        sourceCollection,
        body: item.message || item.summary || '',
        actionHref: item.path || (securityAccountEventTypes.has(String(item.type || '')) ? ROUTES.accountSecurity : '')
      }
    : {
        ...item,
        sourceCollection,
        body: item.body || item.message || ''
      }
}

function notificationOpenLabel(item = {}) {
  const type = String(item.type || '').toLowerCase()
  if (type.includes('reply')) return 'View reply'
  if (type.includes('comment')) return 'View comment'
  if (type.includes('mention')) return 'View mention'
  if (type.includes('like')) return 'View content'
  if (type.includes('follow')) return 'Show profile'
  if (item.productId || type.includes('product') || type.includes('order')) return 'View product'
  if (item.communityId || type.includes('community')) return 'View community'
  if (securityAccountEventTypes.has(type) || item.category === 'security') return 'View security settings'
  if (item.category === 'account') return 'View account settings'
  return item.actionHref || item.path ? 'Open details' : ''
}

function getNotificationMenuActions(item = {}) {
  const actions = []
  const type = String(item.type || '').toLowerCase()
  const href = notificationTargetHref(item)
  const openLabel = notificationOpenLabel(item)
  const actorUid = item.actorUid || item.metadata?.actorUid || ''
  const isContent = item.category === 'content' || Boolean(contentViewForNotification(item))
  const profileHref = actorUid ? publicProfileRoute({ uid: actorUid }) : ''
  const postId = item.postId || item.metadata?.postId || ''

  if (openLabel && href) actions.push({ id: 'open', label: openLabel, href })
  if ((type.includes('comment') || type.includes('reply')) && postId) {
    actions.push({ id: 'open-post', label: type.includes('reply') ? 'View thread / post' : 'View post', href: communityPostRoute(postId) })
  }
  if (isContent && profileHref && !(type.includes('follow') && openLabel === 'Show profile')) {
    actions.push({ id: 'profile', label: item.productId ? 'Show creator profile' : 'Show profile', href: profileHref })
  }
  if (isContent && actorUid && actorUid !== appState.user?.uid) {
    actions.push({ id: 'message-user', label: 'Send message', href: `${ROUTES.inboxMessages}?start=${encodeURIComponent(actorUid)}` })
  }

  const pin = systemInboxPin({ ...item, actionHref: href })
  actions.push(
    { id: item.readAt ? 'mark-unread' : 'mark-read', label: item.readAt ? 'Mark as unread' : 'Mark as read' },
    { id: isInboxPinned(pin.type, pin.targetId) ? 'unpin' : 'pin', label: isInboxPinned(pin.type, pin.targetId) ? 'Unpin' : 'Pin' }
  )
  if (href) actions.push({ id: 'copy-link', label: 'Copy link', href })
  actions.push({ id: 'hide', label: 'Hide notification', danger: true })
  return actions
}

function notificationMenuButtonMarkup(item = {}) {
  const menu = appState.notificationActionMenu
  const expanded = menu?.sourceCollection === item.sourceCollection && menu?.itemId === item.id
  return `
    <button
      type="button"
      class="notification-item-menu-button"
      data-notification-menu-trigger="${escapeHtml(item.sourceCollection)}:${escapeHtml(item.id)}"
      aria-label="Notification actions"
      aria-haspopup="menu"
      aria-expanded="${expanded ? 'true' : 'false'}"
    >⋮</button>
  `
}

function contentNotificationRows() {
  const accountRows = appState.accountEvents
    .filter((item) => contentViewForNotification(item))
    .map((item) => ({ ...item, sourceCollection: 'accountEvents', body: item.message || item.summary || '' }))
  const systemRows = appState.systemNotifications
    .filter((item) => item.category === 'content' || contentViewForNotification(item))
    .map((item) => ({ ...item, sourceCollection: 'systemNotifications', body: item.body || item.message || '' }))
  return [...accountRows, ...systemRows]
    .filter((item) => notificationIsEnabled(item, appState.notificationPreferences))
    .filter((item) => appState.contentView === 'all' || contentViewForNotification(item) === appState.contentView)
    .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
}

function contentNotificationCardMarkup(item = {}) {
  const profile = appState.profileByUid[item.actorUid] || {}
  const actorName = profile.displayName || profile.username || item.actorDisplayName || item.actorUsername || 'Melogic member'
  const actorPhotoURL = profile.avatarURL || profile.photoURL || item.actorPhotoURL || ''
  const profileHref = item.actorUid ? publicProfileRoute({ uid: item.actorUid }) : ''
  const actionHref = contentNotificationHref(item)
  return `
    <article class="content-notification-card ${item.readAt ? '' : 'is-unread'}">
      ${profileHref ? `
        <a class="content-notification-actor" href="${escapeHtml(profileHref)}" aria-label="Open ${escapeHtml(actorName)} profile">
          ${actorPhotoURL ? `<img src="${escapeHtml(actorPhotoURL)}" alt="" />` : `<span>${escapeHtml(actorName.slice(0, 1).toUpperCase())}</span>`}
        </a>
      ` : '<span class="content-notification-actor"><span>M</span></span>'}
      <button
        type="button"
        class="content-notification-body"
        data-open-content-notification="${escapeHtml(item.sourceCollection)}:${escapeHtml(item.id)}"
        data-content-href="${escapeHtml(actionHref)}"
      >
        <strong>${escapeHtml(item.title || 'New activity')}</strong>
        <span>${escapeHtml(item.body || item.message || '')}</span>
        <small>${escapeHtml(actorName)} · ${escapeHtml(formatThreadTimestamp(item.createdAt))}</small>
      </button>
      ${notificationMenuButtonMarkup(item)}
    </article>
  `
}

function getContentActivityMarkup() {
  const tabs = [
    { key: 'all', label: 'All', path: ROUTES.inboxContentAll },
    { key: 'likes', label: 'Likes', path: ROUTES.inboxContentLikes },
    { key: 'follows', label: 'Follows', path: ROUTES.inboxContentFollows },
    { key: 'comments', label: 'Comments', path: ROUTES.inboxContentComments },
    { key: 'mentions', label: 'Mentions', path: ROUTES.inboxContentMentions },
    { key: 'gifts', label: 'Gifts', path: ROUTES.inboxContentGifts },
    { key: 'collaborations', label: 'Collaborations', path: ROUTES.inboxContentCollaborations }
  ]
  const activeTab = tabs.find((tab) => tab.key === appState.contentView) || tabs[0]
  const copy = activityCopy[activeTab.label] || activityCopy.System
  const rows = contentNotificationRows()
  if (activeTab.key === 'collaborations') {
    return `
      <section class="activity-panel">
        <header class="panel-header activity-header"><h3>Content</h3><p>Activity connected to your work and profile</p></header>
        <nav class="system-filter-row inbox-content-tabs" aria-label="Content activity">
          ${tabs.map((tab) => `<button type="button" class="inbox-filter ${tab.key === activeTab.key ? 'is-active' : ''}" data-inbox-path="${tab.path}">${tab.label}</button>`).join('')}
        </nav>
        <section class="inbox-empty-panel activity-empty-panel"><h3>No collaboration invites yet.</h3><p>Collaboration invites will appear here.</p></section>
      </section>
    `
  }
  if (activeTab.key === 'gifts') {
    return `
      <section class="activity-panel">
        <header class="panel-header activity-header"><h3>Content</h3><p>Activity connected to your work and profile</p></header>
        <nav class="system-filter-row inbox-content-tabs" aria-label="Content activity">
          ${tabs.map((tab) => `<button type="button" class="inbox-filter ${tab.key === activeTab.key ? 'is-active' : ''}" data-inbox-path="${tab.path}">${tab.label}</button>`).join('')}
        </nav>
        ${appState.productGiftActionMessage ? `<p class="product-gift-inbox-feedback is-success" role="status">${escapeHtml(appState.productGiftActionMessage)}</p>` : ''}
        ${appState.productGiftActionError ? `<p class="product-gift-inbox-feedback is-error" role="alert">${escapeHtml(appState.productGiftActionError)}</p>` : ''}
        ${appState.productGiftsLoading ? '<section class="inbox-empty-panel activity-empty-panel"><h3>Loading gifts...</h3></section>' : appState.productGiftsError ? `<section class="inbox-empty-panel activity-empty-panel"><h3>Gifts could not be loaded.</h3><p>${escapeHtml(appState.productGiftsError)}</p></section>` : appState.productGifts.length ? `
          <div class="product-gift-inbox-list">
            ${appState.productGifts.map((gift) => `
              <article class="product-gift-inbox-card">
                <span class="product-gift-inbox-cover">${gift.productImage ? `<img src="${escapeHtml(gift.productImage)}" alt="" />` : ''}</span>
                <div class="product-gift-inbox-copy">
                  <strong>${escapeHtml(gift.productTitle)}</strong>
                  <span>From ${escapeHtml(gift.senderDisplayName)}</span>
                  ${gift.message ? `<p>${escapeHtml(gift.message)}</p>` : ''}
                  <small>${escapeHtml(formatThreadTimestamp(gift.createdAt))}</small>
                </div>
                <div class="product-gift-inbox-actions">
                  ${gift.status === 'pending' ? `
                    <button type="button" class="button button-accent" data-product-gift-action="accept:${escapeHtml(gift.id)}" ${appState.productGiftActionId === gift.id ? 'disabled' : ''}>${appState.productGiftActionId === gift.id && appState.productGiftAction === 'accept' ? 'Accepting...' : 'Accept Gift'}</button>
                    <button type="button" class="button button-muted" data-product-gift-action="deny:${escapeHtml(gift.id)}" ${appState.productGiftActionId === gift.id ? 'disabled' : ''}>${appState.productGiftActionId === gift.id && appState.productGiftAction === 'deny' ? 'Denying...' : 'Deny Gift'}</button>
                  ` : `<span class="product-gift-status-badge is-${escapeHtml(gift.status)}">${escapeHtml(gift.status === 'accepted' ? 'Accepted' : 'Denied')}</span>`}
                  <a class="button button-muted" href="${productRoute(gift.productId)}">View Product</a>
                </div>
              </article>
            `).join('')}
          </div>
        ` : `<section class="inbox-empty-panel activity-empty-panel"><h3>${escapeHtml(copy.emptyTitle)}</h3><p>${escapeHtml(copy.emptyBody)}</p></section>`}
      </section>
    `
  }
  return `
    <section class="activity-panel">
      <header class="panel-header activity-header">
        <h3>Content</h3>
        <p>Activity connected to your work and profile</p>
      </header>
      <nav class="system-filter-row inbox-content-tabs" aria-label="Content activity">
        ${tabs.map((tab) => `
          <button type="button" class="inbox-filter ${tab.key === activeTab.key ? 'is-active' : ''}" data-inbox-path="${tab.path}">
            ${tab.label}
          </button>
        `).join('')}
      </nav>
      ${appState.notificationPreferences.delivery.inApp === false ? `
        <section class="inbox-empty-panel activity-empty-panel">
          <h3>In-app notifications are muted.</h3>
          <p>Turn them back on from Edit Profile → Notifications.</p>
        </section>
      ` : rows.length ? `
        <div class="content-notification-list">
          ${rows.map(contentNotificationCardMarkup).join('')}
        </div>
      ` : `
        <section class="inbox-empty-panel activity-empty-panel">
          <h3>${escapeHtml(copy.emptyTitle)}</h3>
          <p>${escapeHtml(copy.emptyBody)}</p>
        </section>
      `}
    </section>
  `
}

function mutualUserAvatarMarkup(user = {}) {
  const name = user.displayName || user.username || 'Melogic member'
  const image = user.photoURL || user.avatarURL || ''
  return image
    ? `<img src="${escapeHtml(image)}" alt="" />`
    : `<span>${escapeHtml(name.slice(0, 1).toUpperCase())}</span>`
}

function mutualUserCardMarkup(user = {}, { searchResult = false } = {}) {
  const name = user.displayName || user.username || 'Melogic member'
  const profileHref = publicProfileRoute({ uid: user.uid })
  const reasons = Array.isArray(user.reasonLabels) && user.reasonLabels.length
    ? user.reasonLabels
    : [searchResult ? 'Username search' : 'Suggested connection']
  const following = user.alreadyFollowing === true
  const busy = appState.mutualUsers.actionUid === user.uid
  return `
    <article class="mutual-user-card">
      <a class="mutual-user-avatar" href="${escapeHtml(profileHref)}" aria-label="Open ${escapeHtml(name)} profile">
        ${mutualUserAvatarMarkup(user)}
      </a>
      <div class="mutual-user-meta">
        <strong>${escapeHtml(name)}</strong>
        <span>@${escapeHtml(user.username || 'member')} · ${escapeHtml(user.roleLabel || 'Melogic member')}</span>
        <div class="mutual-reason-row">
          ${reasons.slice(0, 3).map((reason) => `<small>${escapeHtml(reason)}</small>`).join('')}
        </div>
      </div>
      <div class="mutual-user-actions">
        <button
          type="button"
          class="button ${following ? 'button-muted is-following' : 'button-accent'}"
          data-mutual-follow="${escapeHtml(user.uid)}"
          aria-pressed="${following ? 'true' : 'false'}"
          ${busy ? 'disabled' : ''}
        >${busy ? 'Saving...' : following ? 'Following' : 'Follow'}</button>
        <a class="button button-muted" href="${ROUTES.inboxMessages}?start=${encodeURIComponent(user.uid)}">Message</a>
        <a class="button button-muted" href="${escapeHtml(profileHref)}">Open profile</a>
        ${searchResult ? '' : `<button type="button" class="mutual-hide-button" data-mutual-dismiss="${escapeHtml(user.uid)}" ${busy ? 'disabled' : ''}>Hide</button>`}
      </div>
    </article>
  `
}

function discoveryMethodCard({ title, body, status = '', action = '' } = {}) {
  return `
    <article class="mutual-method-card">
      <div>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(body)}</p>
      </div>
      ${status ? `<small>${escapeHtml(status)}</small>` : ''}
      ${action}
    </article>
  `
}

function getMutualUsersMarkup() {
  const state = appState.mutualUsers
  const capabilities = state.capabilities
  const recommendation = getPlatformDiscoveryRecommendations({ capabilities })
  const platformLabel = capabilities.platform.replaceAll('-', ' ')
  const searchRows = state.searchResults.filter((row) => row.uid && row.uid !== appState.user?.uid)
  const suggestions = state.suggestions.filter((row) => row.uid && row.uid !== appState.user?.uid)
  const contactPickerStatus = capabilities.supportsContactPicker
    ? 'Available on this browser'
    : 'Not supported in this browser'

  return `
    <section class="activity-panel mutual-users-panel">
      <header class="panel-header activity-header mutual-users-header">
        <div>
          <h3>Mutual Users</h3>
          <p>Find people you may know across contacts, communities, creators, and collaborators.</p>
        </div>
        <button type="button" class="button button-muted" data-mutual-refresh ${state.loading ? 'disabled' : ''}>
          ${state.loading ? 'Refreshing...' : 'Refresh suggestions'}
        </button>
      </header>

      <section class="mutual-privacy-notice">
        <strong>You control what you share.</strong>
        <p>Melogic only uses contacts you explicitly select or import to look for matching accounts. We do not message your contacts, sell contact data, or expose your contact list.</p>
      </section>

      <section class="mutual-platform-card">
        <div>
          <span>${escapeHtml(platformLabel)}</span>
          <h4>${escapeHtml(recommendation.title)}</h4>
          <p>${escapeHtml(recommendation.body)}</p>
        </div>
        <dl>
          <div><dt>Contact Picker</dt><dd>${capabilities.supportsContactPicker ? 'Supported' : 'Unavailable'}</dd></div>
          <div><dt>File import</dt><dd>${capabilities.supportsFilePicker ? 'Supported' : 'Unavailable'}</dd></div>
          <div><dt>Secure context</dt><dd>${capabilities.isSecureContext ? 'Yes' : 'No'}</dd></div>
        </dl>
      </section>

      <div class="mutual-discovery-grid">
        ${discoveryMethodCard({
          title: 'Username search',
          body: 'Search public Melogic profiles without sharing contact information.',
          status: 'Available now',
          action: `
            <label class="mutual-search-field">
              <span class="sr-only">Search by username</span>
              <input type="search" data-mutual-user-search placeholder="Search username" value="${escapeHtml(state.searchQuery)}" autocomplete="off" />
            </label>
          `
        })}
        ${discoveryMethodCard({
          title: 'Choose contacts',
          body: 'Select individual contacts only when your browser supports the Contact Picker API.',
          status: contactPickerStatus,
          action: `<button type="button" class="button button-muted" data-mutual-choose-contacts ${capabilities.supportsContactPicker ? '' : 'disabled'}>Choose contacts</button>`
        })}
        ${discoveryMethodCard({
          title: 'CSV / vCard import',
          body: 'Choose a .csv or .vcf file. Identifiers are parsed locally and kept in memory for this session.',
          status: 'No file is uploaded automatically',
          action: `
            <label class="button button-muted mutual-file-button">
              Choose file
              <input type="file" accept=".csv,.vcf,text/csv,text/vcard" data-mutual-contact-file />
            </label>
          `
        })}
        ${discoveryMethodCard({
          title: 'Email lookup',
          body: 'Enter selected email addresses. Secure matching stays disabled until the private verified-identifier index is provisioned.',
          status: 'Privacy infrastructure required',
          action: `
            <textarea data-mutual-email-input rows="2" placeholder="name@example.com, another@example.com"></textarea>
            <button type="button" class="button button-muted" data-mutual-match-emails ${state.matching ? 'disabled' : ''}>${state.matching ? 'Checking...' : 'Check selected emails'}</button>
          `
        })}
        ${discoveryMethodCard({
          title: 'Mutual followers',
          body: 'People followed by creators you already follow.',
          status: 'Available now'
        })}
        ${discoveryMethodCard({
          title: 'Same communities',
          body: 'People who focus the same public communities.',
          status: 'Available now'
        })}
        ${discoveryMethodCard({
          title: 'Public profile matches',
          body: 'Public location, role, and future opt-in genre tags.',
          status: 'Location foundation active'
        })}
        ${discoveryMethodCard({
          title: 'Collaborators and interactions',
          body: 'Future suggestions from collaborations, marketplace relationships, and public interactions.',
          status: 'Coming soon'
        })}
      </div>

      ${state.contactStatus ? `<div class="mutual-contact-status" role="status">${escapeHtml(state.contactStatus)}</div>` : ''}

      <section class="mutual-results-section" aria-labelledby="mutual-search-results-title">
        <header>
          <div>
            <h4 id="mutual-search-results-title">Search results</h4>
            <p>Direct public-profile matches from your username search.</p>
          </div>
        </header>
        ${state.searchLoading
          ? '<p class="mutual-loading-state">Searching profiles...</p>'
          : state.searchError
            ? `<p class="mutual-error-state" role="alert">${escapeHtml(state.searchError)}</p>`
            : searchRows.length
              ? `<div class="mutual-user-list">${searchRows.map((row) => mutualUserCardMarkup(row, { searchResult: true })).join('')}</div>`
              : `<p class="mutual-inline-empty">${state.searchQuery.trim().length >= 2 ? 'No matching public profiles found.' : 'Type at least two characters to search.'}</p>`
        }
      </section>

      <section class="mutual-results-section" aria-labelledby="mutual-suggestions-title">
        <header>
          <div>
            <h4 id="mutual-suggestions-title">Suggested users</h4>
            <p>Ranked from mutual follows, shared communities, and public profile context.</p>
          </div>
        </header>
        ${state.loading && !state.loaded
          ? '<p class="mutual-loading-state">Finding relevant people...</p>'
          : state.error
            ? `<div class="mutual-error-state" role="alert"><strong>Suggestions could not be loaded.</strong><span>${escapeHtml(state.error)}</span></div>`
            : suggestions.length
              ? `<div class="mutual-user-list">${suggestions.map((row) => mutualUserCardMarkup(row)).join('')}</div>`
              : `
                <section class="inbox-empty-panel activity-empty-panel">
                  <h3>No suggestions yet.</h3>
                  <p>Import contacts, search usernames, or join communities to find people you may know.</p>
                </section>
              `
        }
      </section>
    </section>
  `
}

function normalizeContactIdentifiers(values = []) {
  const unique = new Set()
  values.forEach((value) => {
    const clean = String(value || '').trim().toLowerCase()
    if (!clean) return
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) unique.add(`email:${clean}`)
    else {
      const phone = clean.replace(/[^\d+]/g, '')
      if (/^\+?\d{7,15}$/.test(phone)) unique.add(`phone:${phone}`)
    }
  })
  return [...unique].slice(0, 100)
}

function extractContactIdentifiers(text = '') {
  const source = String(text || '')
  const emails = source.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []
  const phones = source.match(/\+?[\d][\d\s().-]{6,}\d/g) || []
  return normalizeContactIdentifiers([...emails, ...phones])
}

function mutualUsersErrorMessage(error) {
  const code = String(error?.code || '')
  if (code.includes('not-found') || code.includes('unimplemented')) {
    return 'Suggestion service is ready locally but its callable functions have not been deployed.'
  }
  if (code.includes('permission-denied')) return 'Suggestions are unavailable for this account right now.'
  if (code.includes('unauthenticated')) return 'Sign in again to load suggestions.'
  return 'Suggestions are temporarily unavailable. Username search still works.'
}

async function loadMutualUsersSuggestions({ force = false } = {}) {
  const state = appState.mutualUsers
  if (!appState.user?.uid || state.loading || (state.loaded && !force)) return
  state.loading = true
  state.error = ''
  if (appState.activeFilter === 'Mutual Users') renderSignedInState()
  try {
    const result = await getMutualUserSuggestions({ limit: 18 })
    state.suggestions = Array.isArray(result.suggestions) ? result.suggestions : []
    state.loaded = true
  } catch (error) {
    state.error = mutualUsersErrorMessage(error)
    state.loaded = true
  } finally {
    state.loading = false
    if (appState.activeFilter === 'Mutual Users') renderSignedInState()
  }
}

async function initializeMutualUsers() {
  if (!appState.user?.uid) return
  const state = appState.mutualUsers
  if (!state.capabilitiesSaved) {
    state.capabilitiesSaved = true
    saveClientCapabilities({
      uid: appState.user.uid,
      capabilities: state.capabilities
    }).catch((error) => {
      if (!String(error?.code || '').includes('permission-denied') && import.meta.env.DEV) {
        console.warn('[inbox] optional client capability save failed', error?.code || error?.message || error)
      }
    })
  }
  await loadMutualUsersSuggestions()
}

async function runMutualUsernameSearch(queryValue = '') {
  const state = appState.mutualUsers
  const query = String(queryValue || '').trim()
  state.searchQuery = queryValue
  state.searchError = ''
  if (query.length < 2) {
    state.searchLoading = false
    state.searchResults = []
    if (appState.activeFilter === 'Mutual Users') renderSignedInState()
    return
  }
  state.searchLoading = true
  if (appState.activeFilter === 'Mutual Users') renderSignedInState()
  try {
    const rows = await searchUsersByUsername(query)
    state.searchResults = rows.filter((row) => row.uid !== appState.user?.uid)
  } catch (error) {
    state.searchResults = []
    state.searchError = error?.message || 'Unable to search profiles right now.'
  } finally {
    state.searchLoading = false
    if (appState.activeFilter === 'Mutual Users') renderSignedInState()
  }
}

function scheduleMutualUsernameSearch(value = '') {
  appState.mutualUsers.searchQuery = value
  if (mutualUserSearchTimer) window.clearTimeout(mutualUserSearchTimer)
  mutualUserSearchTimer = window.setTimeout(() => {
    runMutualUsernameSearch(value)
  }, 320)
}

async function handleMutualContactsMatch(identifiers = [], source = 'manual') {
  const state = appState.mutualUsers
  const clean = normalizeContactIdentifiers(identifiers.map((value) => String(value || '').replace(/^(email|phone):/, '')))
  if (!clean.length) {
    state.contactStatus = 'No valid email addresses or phone numbers were found.'
    renderSignedInState()
    return
  }
  state.contactIdentifiers = clean
  state.matching = true
  state.contactStatus = `Prepared ${clean.length} selected identifier${clean.length === 1 ? '' : 's'} in memory.`
  renderSignedInState()
  try {
    const result = await matchContacts({ contacts: clean, source })
    state.contactStatus = result.message || (
      result.matches?.length
        ? `Found ${result.matches.length} matching account${result.matches.length === 1 ? '' : 's'}.`
        : 'No matching accounts were found.'
    )
    if (Array.isArray(result.matches) && result.matches.length) {
      state.searchResults = result.matches
    }
  } catch (error) {
    state.contactStatus = 'Secure contact matching is not available yet. No contacts were stored.'
  } finally {
    state.matching = false
    renderSignedInState()
  }
}

async function handleMutualFollow(uid = '') {
  const targetUid = String(uid || '').trim()
  if (!targetUid || appState.mutualUsers.actionUid) return
  const state = appState.mutualUsers
  const row = [...state.suggestions, ...state.searchResults].find((entry) => entry.uid === targetUid)
  if (!row) return
  state.actionUid = targetUid
  renderSignedInState()
  try {
    const result = await setProfileFollowState(targetUid, !row.alreadyFollowing)
    const following = result.following === true
    state.suggestions = state.suggestions.map((entry) => entry.uid === targetUid ? { ...entry, alreadyFollowing: following } : entry)
    state.searchResults = state.searchResults.map((entry) => entry.uid === targetUid ? { ...entry, alreadyFollowing: following } : entry)
    state.contactStatus = following ? `You are now following ${row.displayName || row.username || 'this user'}.` : 'User unfollowed.'
  } catch (error) {
    state.contactStatus = error?.message || 'Could not update this follow.'
  } finally {
    state.actionUid = ''
    renderSignedInState()
  }
}

async function handleMutualDismiss(uid = '') {
  const targetUid = String(uid || '').trim()
  if (!targetUid || appState.mutualUsers.actionUid) return
  const state = appState.mutualUsers
  const previous = state.suggestions
  state.actionUid = targetUid
  state.suggestions = state.suggestions.filter((entry) => entry.uid !== targetUid)
  renderSignedInState()
  try {
    await dismissSuggestion(targetUid)
    state.contactStatus = 'Suggestion hidden.'
  } catch (error) {
    state.suggestions = previous
    state.contactStatus = mutualUsersErrorMessage(error)
  } finally {
    state.actionUid = ''
    renderSignedInState()
  }
}

function getFilterContentMarkup(filterName) {
  if (filterName === 'Calls') return getCallsContentMarkup()
  if (filterName === 'Content') return getContentActivityMarkup()
  if (filterName === 'Mutual Users') return getMutualUsersMarkup()
  if (filterName === 'System') {
    const filterOptions = [
      { key: 'all', label: 'All' },
      { key: 'product_release', label: 'Product releases' },
      { key: 'account', label: 'Account' },
      { key: 'security', label: 'Security' },
      { key: 'other', label: 'Other' }
    ]
    const notificationRows = appState.systemNotifications
      .filter((item) => item.category !== 'content' && !contentViewForNotification(item))
      .filter((item) => appState.systemFilter === 'all' || item.type === appState.systemFilter)
      .map((item) => ({ ...item, sourceCollection: 'systemNotifications', body: item.body || item.message || '' }))
    const accountRows = appState.accountEvents
      .filter((item) => !contentViewForNotification(item))
      .filter((item) => accountEventMatchesSystemFilter(item, appState.systemFilter))
      .map((item) => ({
        ...item,
        sourceCollection: 'accountEvents',
        body: item.message || '',
        actionHref: item.path || (securityAccountEventTypes.has(String(item.type || '')) ? ROUTES.accountSecurity : ''),
        type: item.type || 'account'
      }))
    const rows = [...accountRows, ...notificationRows]
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())
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
            ${rows.map((item) => {
              return `
                <article class="system-notification-card ${item.readAt ? '' : 'is-unread'}" ${item.sourceCollection === 'accountEvents' ? `data-account-event-id="${escapeHtml(item.id)}"` : `data-system-id="${escapeHtml(item.id)}"`}>
                  <div class="system-notification-topline">
                    <p class="system-notification-title">${escapeHtml(item.title)}</p>
                    ${notificationMenuButtonMarkup(item)}
                  </div>
                  ${item.senderName || item.sourceLabel ? `<small class="system-notification-sender">${escapeHtml(item.senderName || item.sourceLabel)}${item.senderVerified || item.supportVerified ? ' ✓' : ''}</small>` : ''}
                  <p>${escapeHtml(item.body)}</p>
                  <small>${escapeHtml(formatThreadTimestamp(item.createdAt))} · ${escapeHtml(item.category || item.type || 'system')} · ${escapeHtml(item.priority || item.severity || 'info')}</small>
                  ${item.actionHref ? `<a class="button button-muted" href="${escapeHtml(item.actionHref)}">Open</a>` : ''}
                </article>
              `
            }).join('')}
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

function getMessageFindMarkup() {
  if (!appState.messageFind.open) {
    return '<button type="button" class="message-find-trigger" data-message-find-action="open" aria-label="Find in messages" data-guide-id="inbox-conversation-find" data-guide-label="Find" data-guide-role="conversation-toolbar-button">Find</button>'
  }
  const countLabel = appState.messageFind.matchCount
    ? `${Math.max(1, appState.messageFind.activeIndex + 1)} of ${appState.messageFind.matchCount}`
    : '0 results'
  return `
    <div class="message-find" role="search">
      <label class="sr-only" for="message-find-input">Find in messages</label>
      <input id="message-find-input" type="search" value="${escapeHtml(appState.messageFind.query)}" placeholder="Find" autocomplete="off" data-message-find-input />
      <span class="message-find-count" data-message-find-count>${countLabel}</span>
      <button type="button" data-message-find-action="previous" aria-label="Previous match" data-guide-id="inbox-conversation-find-previous" data-guide-label="Previous find result" data-guide-role="conversation-toolbar-button" ${appState.messageFind.matchCount ? '' : 'disabled'}>↑</button>
      <button type="button" data-message-find-action="next" aria-label="Next match" data-guide-id="inbox-conversation-find-next" data-guide-label="Next find result" data-guide-role="conversation-toolbar-button" ${appState.messageFind.matchCount ? '' : 'disabled'}>↓</button>
      <button type="button" data-message-find-action="close" aria-label="Close find" data-guide-id="inbox-conversation-find-close" data-guide-label="Close find" data-guide-role="conversation-toolbar-button">×</button>
    </div>
  `
}

function getSiteGuidanceHeaderMarkup(thread) {
  if (!isResonaThread(thread)) return ''
  return `
    <button
      type="button"
      class="message-find-trigger inbox-site-guidance-trigger"
      data-site-guidance-start
      data-site-guidance-thread-id="${escapeHtml(thread.id)}"
      data-site-guidance-thread-kind="thread"
      data-site-guidance-viewer="resona"
      aria-label="Share this Melogic page with Resona"
      title="Share this Melogic page only. No full screen capture."
      data-guide-id="inbox-conversation-share-screen"
      data-guide-label="Share Screen"
      data-guide-role="conversation-toolbar-button"
    >Share Screen</button>
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
  const headerMeta = isResonaThread(thread)
    ? { displayName: 'Resona', avatarURL: appState.resonaAvatarURL || thread.imageURL || '' }
    : thread.type === 'dm' && otherParticipant
    ? getProfileMeta(otherParticipant, { title: thread.title, avatarURL: thread.imageURL })
    : { displayName: thread.title, avatarURL: thread.imageURL }
  const avatarThread = thread.type === 'dm'
    ? { ...thread, imageURL: headerMeta.avatarURL, title: headerMeta.displayName }
    : thread
  const headerSignature = hashRenderSignature({
    threadId: thread.id,
    title: headerMeta.displayName || thread.title,
    imageURL: headerMeta.avatarURL || thread.imageURL || '',
    subtitle: getConversationSubtitle(thread),
    messageFindOpen: appState.messageFind.open,
    callUiState: appState.callUiState
  })
  const hasLiveCall = appState.activeCall && !isCallFinal(appState.activeCall.status)
  const callDisabled = thread.type !== 'dm' || isResonaThread(thread) || hasLiveCall

  return `
    <header class="conversation-header" data-conversation-header-signature="${escapeHtml(headerSignature)}">
      ${renderThreadAvatar(avatarThread, { stableKey: `thread-header:${thread.id}` })}
      <div class="conversation-header-meta">
        <h3>${escapeHtml(headerMeta.displayName || thread.title)}</h3>
        <p>${escapeHtml(getConversationSubtitle(thread))}</p>
      </div>
      ${getSiteGuidanceHeaderMarkup(thread)}
      ${getMessageFindMarkup()}
      <button type="button" class="conversation-call-trigger" data-start-account-call="${escapeHtml(thread.id)}" aria-label="${thread.type === 'dm' ? 'Start audio call' : 'Group calls coming soon'}" title="${thread.type === 'dm' ? (hasLiveCall ? 'Finish the current call first' : 'Start audio call') : 'Group calls coming soon'}" data-guide-id="inbox-conversation-call" data-guide-label="Call" data-guide-role="conversation-toolbar-button" ${callDisabled ? 'disabled' : ''}>
        ${iconSvg('phone') || 'Call'}
      </button>
      <button type="button" class="chat-settings-trigger" data-action="open-chat-settings" aria-label="Open chat settings" data-guide-id="inbox-conversation-menu" data-guide-label="Conversation menu" data-guide-role="conversation-toolbar-button">⋯</button>
    </header>
  `
}

function clearMessageFindHighlights() {
  const list = getMessageScroller()
  if (!list) return
  list.querySelectorAll('[data-message-find-text]').forEach((element) => {
    if (element.dataset.messageFindOriginal !== undefined) {
      element.textContent = element.dataset.messageFindOriginal
      delete element.dataset.messageFindOriginal
    }
    element.removeAttribute('data-message-find-text')
  })
}

function updateMessageFindControls() {
  const count = inboxRoot.querySelector('[data-message-find-count]')
  if (count) {
    count.textContent = appState.messageFind.matchCount
      ? `${appState.messageFind.activeIndex + 1} of ${appState.messageFind.matchCount}`
      : '0 results'
  }
  inboxRoot.querySelectorAll('[data-message-find-action="previous"], [data-message-find-action="next"]').forEach((button) => {
    button.disabled = !appState.messageFind.matchCount
  })
}

function focusActiveMessageFindMatch() {
  const matches = Array.from(inboxRoot.querySelectorAll('mark[data-message-find-match]'))
  matches.forEach((match, index) => match.classList.toggle('is-active', index === appState.messageFind.activeIndex))
  const active = matches[appState.messageFind.activeIndex]
  if (!active) return
  messageScrollController.navigateToElement(active.closest('[data-message-id]'), 'find-result')
}

function applyMessageFind() {
  clearMessageFindHighlights()
  const query = appState.messageFind.query.trim()
  if (!query) {
    appState.messageFind.matchCount = 0
    appState.messageFind.activeIndex = -1
    updateMessageFindControls()
    return
  }

  const normalizedQuery = query.toLocaleLowerCase()
  const matches = []
  getMessageScroller()?.querySelectorAll('.message-bubble > p').forEach((paragraph) => {
    const original = paragraph.textContent || ''
    const normalized = original.toLocaleLowerCase()
    if (!normalized.includes(normalizedQuery)) return
    paragraph.dataset.messageFindText = 'true'
    paragraph.dataset.messageFindOriginal = original
    paragraph.textContent = ''
    let cursor = 0
    while (cursor < original.length) {
      const matchIndex = normalized.indexOf(normalizedQuery, cursor)
      if (matchIndex < 0) {
        paragraph.append(document.createTextNode(original.slice(cursor)))
        break
      }
      if (matchIndex > cursor) paragraph.append(document.createTextNode(original.slice(cursor, matchIndex)))
      const mark = document.createElement('mark')
      mark.dataset.messageFindMatch = 'true'
      mark.textContent = original.slice(matchIndex, matchIndex + query.length)
      paragraph.append(mark)
      matches.push(mark)
      cursor = matchIndex + query.length
    }
  })

  appState.messageFind.matchCount = matches.length
  if (!matches.length) appState.messageFind.activeIndex = -1
  else appState.messageFind.activeIndex = Math.min(Math.max(appState.messageFind.activeIndex, 0), matches.length - 1)
  updateMessageFindControls()
  focusActiveMessageFindMatch()
}

function handleMessageFindAction(action) {
  if (action === 'open') {
    appState.messageFind.open = true
    renderSelectedConversation({ reason: 'state-update' })
    requestAnimationFrame(() => inboxRoot.querySelector('[data-message-find-input]')?.focus())
    return
  }
  if (action === 'close') {
    clearMessageFindHighlights()
    appState.messageFind = { open: false, query: '', activeIndex: -1, matchCount: 0 }
    renderSelectedConversation({ reason: 'state-update' })
    return
  }
  if (!appState.messageFind.matchCount) return
  const offset = action === 'previous' ? -1 : 1
  appState.messageFind.activeIndex = (
    appState.messageFind.activeIndex + offset + appState.messageFind.matchCount
  ) % appState.messageFind.matchCount
  updateMessageFindControls()
  focusActiveMessageFindMatch()
}

function clampMenuPosition(x, y, width = 180, height = 220) {
  const maxX = Math.max(8, window.innerWidth - width - 8)
  const maxY = Math.max(8, window.innerHeight - height - 8)
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY))
  }
}

function getNotificationActionMenuMarkup() {
  const menu = appState.notificationActionMenu
  if (!menu) return ''
  const item = notificationRowById(menu.sourceCollection, menu.itemId)
  if (!item) return ''
  const actions = getNotificationMenuActions(item)
  const menuHeight = Math.min(420, Math.max(90, actions.length * 38 + 12))
  const pos = clampMenuPosition(menu.x, menu.y, 220, menuHeight)
  return `
    <div class="notification-action-backdrop" data-notification-menu-close>
      <div
        class="notification-action-menu"
        role="menu"
        aria-label="Notification actions"
        style="left:${pos.x}px;top:${pos.y}px;"
      >
        ${actions.map((action) => `
          <button
            type="button"
            role="menuitem"
            class="${action.danger ? 'is-danger' : ''}"
            data-notification-menu-action="${escapeHtml(action.id)}"
            ${action.href ? `data-notification-menu-href="${escapeHtml(action.href)}"` : ''}
            ${action.disabled ? 'disabled' : ''}
          >${escapeHtml(action.label)}</button>
        `).join('')}
      </div>
    </div>
  `
}

function getContextMenuMarkup() {
  const menu = appState.messageContextMenu
  if (!menu) return ''
  const menuThread = appState.threads.find((entry) => entry.id === menu.threadId)
  const isLockedDm = isThreadInteractionLocked(menuThread)
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
        ${!isLockedDm && canReply ? '<button type="button" data-menu-action="reply">Reply</button>' : ''}
        ${!isLockedDm && canEdit ? '<button type="button" data-menu-action="edit">Edit Message</button>' : ''}
        ${!isLockedDm && canReact ? '<button type="button" data-menu-action="react">React</button>' : ''}
        ${!isLockedDm && canViewReactions ? '<button type="button" data-menu-action="view-reactions">View Reactions</button>' : ''}
        ${canCopy ? '<button type="button" data-menu-action="copy">Copy text</button>' : ''}
        ${!isLockedDm && canShowDelete ? '<button type="button" data-menu-action="delete">Delete Message</button>' : ''}
        ${menu.senderId && !isOwnMessage ? `<button type="button" data-menu-action="profile" data-href="${escapeHtml(profileHref)}">Open Profile</button>` : ''}
        <button type="button" data-menu-action="cancel">Cancel</button>
      </div>
      ${!isLockedDm && appState.deleteSubmenuAnchor ? `
        <div class="message-context-menu is-submenu" style="left:${deleteSubPos.x}px;top:${deleteSubPos.y}px;">
          <button type="button" data-menu-action="delete-me">Delete for me</button>
          <button type="button" data-menu-action="delete-everyone" ${canDeleteEveryone ? '' : 'disabled'}>Delete for everyone</button>
        </div>
      ` : ''}
      ${!isLockedDm && appState.reactionPickerAnchor ? `
        <div class="message-context-menu is-submenu is-emoji" style="left:${emojiPos.x}px;top:${emojiPos.y}px;">
          ${['👍', '❤️', '😂', '🔥', '👀', '🎵'].map((emoji) => `<button type="button" data-menu-action="emoji" data-emoji="${emoji}">${emoji}</button>`).join('')}
        </div>
      ` : ''}
    </div>
  `
}

function getResonaActionMenuMarkup() {
  const menu = appState.resonaActionMenu
  if (!menu) return ''
  const position = clampMenuPosition(menu.x, menu.y, 210, 120)
  return `
    <div class="message-context-backdrop" data-resona-menu-close>
      <div class="message-context-menu resona-action-menu" role="menu" aria-label="Resona message actions" style="left:${position.x}px;top:${position.y}px;">
        <button type="button" data-resona-menu-action="report" data-thread-id="${escapeHtml(menu.threadId)}" data-message-id="${escapeHtml(menu.messageId)}">Report message</button>
      </div>
    </div>
  `
}

function getImagePreviewModalMarkup() {
  const modal = appState.imagePreviewModal
  if (!modal?.url) return ''
  const zoom = Math.max(0.75, Math.min(Number(modal.zoom || 1), 2.5))
  return `
    <div class="image-preview-backdrop" data-image-preview-close>
      <section class="image-preview-modal" role="dialog" aria-modal="true" aria-label="Image preview">
        <header>
          <strong>${escapeHtml(modal.name || 'Image attachment')}</strong>
          <div class="image-preview-actions">
            <button type="button" data-image-preview-zoom="-0.25" aria-label="Zoom out">-</button>
            <button type="button" data-image-preview-zoom="0.25" aria-label="Zoom in">+</button>
            <a href="${escapeHtml(modal.url)}" target="_blank" rel="noopener">Open</a>
            <button type="button" data-image-preview-close aria-label="Close image preview">×</button>
          </div>
        </header>
        <div class="image-preview-stage">
          <img src="${escapeHtml(modal.url)}" alt="${escapeHtml(modal.name || 'Image attachment')}" style="transform:scale(${zoom})" />
        </div>
      </section>
    </div>
  `
}

function getAccountCallOverlayMarkup() {
  if (appState.activeFilter === 'Calls' && appState.callView === 'active') return ''
  const activeCall = appState.activeCall && !isCallFinal(appState.activeCall.status) ? appState.activeCall : null
  const incomingCall = !activeCall ? appState.incomingCalls[0] : null
  const call = activeCall || incomingCall
  if (!call) return ''
  const person = getCallCounterpart(call)
  const incoming = !activeCall && call.calleeUid === appState.user?.uid
  const outgoing = activeCall && call.callerUid === appState.user?.uid && ['ringing', 'accepted'].includes(call.status)
  const statusText = incoming
    ? 'Incoming audio call'
    : outgoing
      ? 'Calling...'
      : appState.callUiState === 'active'
        ? `Connected · ${getCallDuration(call)}`
        : appState.callUiState === 'requesting-mic'
          ? 'Requesting microphone...'
          : appState.callUiState === 'failed'
            ? (appState.callError || 'Call failed')
            : 'Connecting...'

  return `
    <aside class="account-call-overlay ${incoming ? 'is-incoming' : ''}" role="${incoming ? 'dialog' : 'status'}" aria-label="${escapeHtml(statusText)}">
      ${renderCallAvatar(person)}
      <div class="account-call-overlay-meta">
        <strong>${escapeHtml(person.displayName || 'Melogic member')}</strong>
        <span data-account-call-status>${escapeHtml(statusText)}</span>
      </div>
      <div class="account-call-overlay-actions">
        ${incoming ? `
          <button type="button" class="account-call-icon-button is-accept" data-account-call-action="accept" data-call-id="${escapeHtml(call.id)}" aria-label="Accept call" ${appState.callActionPending ? 'disabled' : ''}>${iconSvg('phone')}</button>
          <button type="button" class="account-call-icon-button is-decline" data-account-call-action="decline" data-call-id="${escapeHtml(call.id)}" aria-label="Decline call" ${appState.callActionPending ? 'disabled' : ''}>${iconSvg('x')}</button>
        ` : outgoing ? `
          <button type="button" class="button account-call-danger" data-account-call-action="cancel" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === 'cancel' ? 'Cancelling...' : 'Cancel'}</button>
        ` : `
          <button type="button" class="button button-muted" data-account-call-action="toggle-mute" data-call-id="${escapeHtml(call.id)}">${appState.callMuted ? 'Unmute' : 'Mute'}</button>
          <button type="button" class="button account-call-danger" data-account-call-action="end" data-call-id="${escapeHtml(call.id)}" ${appState.callActionPending ? 'disabled' : ''}>${appState.callActionPending === 'end' ? 'Ending...' : 'End'}</button>
        `}
      </div>
    </aside>
  `
}

function renderFloatingUi() {
  floatingRoot.innerHTML = `${getNotificationActionMenuMarkup()}${getContextMenuMarkup()}${getResonaActionMenuMarkup()}${getReactionDetailModalMarkup()}${getImagePreviewModalMarkup()}${getThreadActionMenuMarkup()}${getThreadConfirmModalMarkup()}${getAccountCallOverlayMarkup()}`
}

function closeNotificationActionMenu({ restoreFocus = false } = {}) {
  const menu = appState.notificationActionMenu
  const trigger = menu
    ? Array.from(inboxRoot.querySelectorAll('[data-notification-menu-trigger]'))
        .find((button) => button.getAttribute('data-notification-menu-trigger') === `${menu.sourceCollection}:${menu.itemId}`)
    : null
  inboxRoot.querySelectorAll('[data-notification-menu-trigger]').forEach((button) => {
    button.setAttribute('aria-expanded', 'false')
  })
  appState.notificationActionMenu = null
  renderFloatingUi()
  if (restoreFocus) trigger?.focus()
}

function openNotificationActionMenu(button) {
  const [sourceCollection, itemId] = String(button.getAttribute('data-notification-menu-trigger') || '').split(':')
  if (!sourceCollection || !itemId) return
  inboxRoot.querySelectorAll('[data-notification-menu-trigger]').forEach((trigger) => {
    trigger.setAttribute('aria-expanded', 'false')
  })
  clearFloatingOverlays()
  closeThreadActionUi()
  const rect = button.getBoundingClientRect()
  appState.notificationActionMenu = {
    sourceCollection,
    itemId,
    x: rect.right - 220,
    y: rect.bottom + 4
  }
  button.setAttribute('aria-expanded', 'true')
  renderFloatingUi()
  requestAnimationFrame(() => floatingRoot.querySelector('.notification-action-menu [role="menuitem"]')?.focus())
}

function updateNotificationInLocalState(sourceCollection, itemId, updates = {}) {
  const key = sourceCollection === 'accountEvents' ? 'accountEvents' : 'systemNotifications'
  appState[key] = appState[key]
    .map((item) => item.id === itemId ? { ...item, ...updates } : item)
    .filter((item) => !item.hiddenAt)
}

async function handleNotificationMenuAction(button) {
  const menu = appState.notificationActionMenu
  const item = menu ? notificationRowById(menu.sourceCollection, menu.itemId) : null
  if (!menu || !item || !appState.user?.uid) return
  const action = button.getAttribute('data-notification-menu-action') || ''
  const href = button.getAttribute('data-notification-menu-href') || ''
  const uid = appState.user.uid
  appState.notificationActionMenu = null

  if (['open', 'open-post', 'profile', 'message-user'].includes(action)) {
    renderFloatingUi()
    if (href) window.location.assign(href)
    return
  }

  try {
    if (action === 'mark-read' || action === 'mark-unread') {
      const read = action === 'mark-read'
      if (menu.sourceCollection === 'accountEvents') await setAccountEventRead(uid, menu.itemId, read)
      else await setSystemNotificationRead(uid, menu.itemId, read)
      updateNotificationInLocalState(menu.sourceCollection, menu.itemId, {
        readAt: read ? new Date().toISOString() : null
      })
      appState.notificationActionMessage = read ? 'Notification marked as read.' : 'Notification marked as unread.'
    } else if (action === 'pin' || action === 'unpin') {
      const pin = systemInboxPin({ ...item, actionHref: notificationTargetHref(item) })
      const saved = action === 'pin'
        ? await saveInboxPin(pin)
        : await removeInboxPin(pin.pinId)
      appState.notificationActionMessage = saved
        ? (action === 'pin' ? 'Notification pinned.' : 'Notification unpinned.')
        : 'The notification pin could not be updated.'
    } else if (action === 'copy-link') {
      if (!href) throw new Error('This notification does not have a link.')
      await navigator.clipboard.writeText(new URL(href, window.location.origin).toString())
      appState.notificationActionMessage = 'Link copied.'
    } else if (action === 'hide') {
      if (menu.sourceCollection === 'accountEvents') await hideAccountEvent(uid, menu.itemId)
      else await hideSystemNotification(uid, menu.itemId)
      updateNotificationInLocalState(menu.sourceCollection, menu.itemId, {
        hiddenAt: new Date().toISOString()
      })
      appState.notificationActionMessage = 'Notification hidden.'
    }
  } catch (error) {
    console.warn('[inbox] notification action failed', {
      action,
      sourceCollection: menu.sourceCollection,
      notificationId: menu.itemId,
      code: error?.code || '',
      message: error?.message || String(error)
    })
    appState.notificationActionMessage = 'That notification action could not be completed.'
  }
  renderSignedInState()
}

function refreshAccountCallUi({ refreshConversation = false } = {}) {
  renderFloatingUi()
  if (appState.activeFilter === 'Calls') {
    renderSignedInState()
  } else if (refreshConversation && appState.activeFilter === 'Messages' && appState.selectedThreadId) {
    renderSelectedConversation({ reason: 'account-call-update' })
  }
}

function clearAccountCallTimers() {
  if (accountCallTimeout) window.clearTimeout(accountCallTimeout)
  if (accountCallTimer) window.clearInterval(accountCallTimer)
  accountCallTimeout = null
  accountCallTimer = null
}

function startAccountCallTimer() {
  if (accountCallTimer) return
  accountCallTimer = window.setInterval(() => {
    if (!appState.activeCall || isCallFinal(appState.activeCall.status)) {
      clearAccountCallTimers()
      return
    }
    const statusNode = floatingRoot.querySelector('[data-account-call-status]')
    if (statusNode && appState.callUiState === 'active') {
      statusNode.textContent = `Connected · ${getCallDuration(appState.activeCall)}`
    }
    if (appState.activeFilter === 'Calls') renderSignedInState()
  }, 1000)
}

function ensureAccountCallManager() {
  if (accountCallManager) return accountCallManager
  accountCallManager = new AccountAudioCallManager({
    onStateChange: ({ state, muted, error }) => {
      appState.callUiState = state
      appState.callMuted = Boolean(muted)
      if (error) appState.callError = error
      if (state === 'active') startAccountCallTimer()
      refreshAccountCallUi({ refreshConversation: true })
    },
    onRemoteStream: (stream) => {
      remoteCallAudio.srcObject = stream || null
      if (stream) {
        remoteCallAudio.play().catch(() => {
          appState.callError = 'Remote audio is ready. Use the call controls to resume audio if your browser blocked playback.'
          refreshAccountCallUi()
        })
      }
    },
    onError: ({ message }) => {
      appState.callError = message
      refreshAccountCallUi({ refreshConversation: true })
    }
  })
  return accountCallManager
}

function watchActiveAccountCall(callId) {
  appState.activeCallUnsubscribe()
  appState.activeCallUnsubscribe = watchAccountCall(callId, (call) => {
    if (!call) {
      clearLocalAccountCall(callId)
      if (appState.callView === 'active') navigateInbox(ROUTES.inboxCalls, { replace: true })
      else refreshAccountCallUi({ refreshConversation: true })
      return
    }
    appState.activeCall = call
    if (isCallFinal(call.status)) {
      clearAccountCallTimers()
      accountCallManager?.cleanup({ preserveState: true })
      appState.callUiState = call.status === 'failed' ? 'failed' : 'ended'
      window.setTimeout(() => {
        if (appState.activeCall?.id !== call.id || !isCallFinal(appState.activeCall.status)) return
        appState.activeCall = null
        appState.callUiState = 'idle'
        appState.callMuted = false
        if (appState.callView === 'active') navigateInbox(ROUTES.inboxCalls, { replace: true })
        else refreshAccountCallUi({ refreshConversation: true })
      }, 1800)
    }
    refreshAccountCallUi({ refreshConversation: true })
  }, (error) => {
    appState.callError = error?.message || 'The call could not be updated.'
    refreshAccountCallUi()
  })
}

async function startAccountCallFromThread(threadId) {
  const thread = appState.threads.find((entry) => entry.id === threadId)
  if (!thread) return
  if (thread.type !== 'dm') {
    appState.callError = 'Group calls are coming soon.'
    refreshAccountCallUi()
    return
  }
  if (appState.activeCall && !isCallFinal(appState.activeCall.status)) {
    appState.callError = 'Finish the current call before starting another.'
    refreshAccountCallUi()
    return
  }
  const calleeUid = thread.otherParticipantId || (thread.participantIds || []).find((uid) => uid !== appState.user?.uid)
  if (!calleeUid) {
    appState.callError = 'The recipient for this direct message could not be identified.'
    refreshAccountCallUi()
    return
  }

  appState.callError = ''
  appState.callUiState = 'calling'
  try {
    const callerProfile = getProfileMeta(appState.user.uid, {
      displayName: appState.user.displayName,
      photoURL: appState.user.photoURL
    })
    const calleeProfile = getProfileMeta(calleeUid, thread.otherProfile || { title: thread.title, avatarURL: thread.imageURL })
    const call = await createAccountAudioCall({
      calleeUid,
      threadId: thread.id,
      callerProfile,
      calleeProfile
    })
    appState.activeCall = call
    watchActiveAccountCall(call.id)
    navigateInbox(inboxActiveCallRoute(getCallRouteTarget(call)))
    await ensureAccountCallManager().startCaller(call)
    accountCallTimeout = window.setTimeout(async () => {
      if (appState.activeCall?.id === call.id && appState.activeCall.status === 'ringing') {
        await markAccountCallMissed(call.id).catch(() => {})
      }
    }, 55000)
  } catch (error) {
    appState.callError = error?.message || 'The audio call could not be started.'
    appState.callUiState = 'failed'
    refreshAccountCallUi({ refreshConversation: true })
  }
}

async function acceptIncomingAccountCall(call) {
  if (!call?.id) return
  if (appState.activeCall && !isCallFinal(appState.activeCall.status) && appState.activeCall.id !== call.id) {
    appState.callError = 'Finish the current call before accepting another.'
    refreshAccountCallUi()
    return
  }
  try {
    const currentCall = await getAccountCall(call.id)
    if (!currentCall || currentCall.status !== 'ringing') {
      throw new Error('This incoming call is no longer available.')
    }
    if (!currentCall.offer?.sdp) {
      throw new Error('The caller is still connecting. Try accepting again in a moment.')
    }
    appState.callError = ''
    appState.activeCall = currentCall
    appState.callUiState = 'requesting-mic'
    watchActiveAccountCall(currentCall.id)
    refreshAccountCallUi({ refreshConversation: true })
    await acceptAccountCall(currentCall.id)
    await ensureAccountCallManager().acceptCallee(currentCall)
    navigateInbox(inboxActiveCallRoute(getCallRouteTarget(currentCall)))
  } catch (error) {
    const message = String(error?.message || '')
    appState.callError = message.toLowerCase().includes('microphone')
      ? 'Microphone access is required to accept this call.'
      : message || 'The incoming call could not be accepted.'
    appState.callUiState = 'failed'
    refreshAccountCallUi({ refreshConversation: true })
  }
}

function clearLocalAccountCall(callId) {
  clearAccountCallTimers()
  accountCallManager?.cleanup({ preserveState: true })
  if (appState.activeCall?.id === callId) {
    appState.activeCallUnsubscribe()
    appState.activeCallUnsubscribe = () => {}
    appState.activeCall = null
  }
  appState.incomingCalls = appState.incomingCalls.filter((call) => call.id !== callId)
  appState.callUiState = 'idle'
  appState.callMuted = false
}

async function handleAccountCallAction(action, callId = '') {
  if (appState.callActionPending) return
  const incomingCall = appState.incomingCalls.find((call) => call.id === callId) || appState.incomingCalls[0]
  const activeCall = appState.activeCall?.id === callId || !callId
    ? appState.activeCall
    : appState.recentCalls.find((call) => call.id === callId)
  if (action === 'toggle-mute') {
    if (!activeCall?.id) return
    ensureAccountCallManager().toggleMuted()
    return
  }
  const targetCall = ['accept', 'decline'].includes(action) ? incomingCall : activeCall
  if (!targetCall?.id) return

  appState.callActionPending = ['accept', 'decline'].includes(action) ? `${action}:${targetCall.id}` : action
  appState.callError = ''
  refreshAccountCallUi()
  try {
    if (action === 'accept') {
      await acceptIncomingAccountCall(targetCall)
      return
    }
    let serviceResult = null
    if (action === 'decline') serviceResult = await declineAccountCall(targetCall.id)
    if (action === 'cancel') {
      const currentCall = await getAccountCall(targetCall.id)
      if (!currentCall || isCallFinal(currentCall.status)) {
        clearLocalAccountCall(targetCall.id)
        if (appState.callView === 'active') navigateInbox(ROUTES.inboxCalls, { replace: true })
        return
      }
      if (currentCall.callerUid !== appState.user?.uid) {
        throw new Error('Only the caller can cancel a ringing call.')
      }
      serviceResult = currentCall.status === 'ringing'
        ? await cancelAccountCall(currentCall.id)
        : await endAccountCall(currentCall.id)
      debugAccountCall({
        action: 'cancel-call',
        callId: currentCall.id,
        currentUserUid: appState.user?.uid || '',
        statusBefore: currentCall.status,
        serviceResult,
        firestoreErrorCode: '',
        firestoreErrorMessage: ''
      })
    }
    if (action === 'end') serviceResult = await endAccountCall(targetCall.id)
    if (['decline', 'cancel', 'end'].includes(action)) clearLocalAccountCall(targetCall.id)
    if (['cancel', 'end'].includes(action) && appState.callView === 'active') {
      navigateInbox(ROUTES.inboxCalls, { replace: true })
    }
  } catch (error) {
    const fallback = action === 'accept'
      ? 'The incoming call could not be accepted.'
      : action === 'decline'
        ? 'The call could not be declined.'
        : action === 'cancel'
          ? 'The call could not be cancelled.'
          : 'The call could not be ended.'
    appState.callError = error?.message || fallback
    if (action === 'cancel') {
      debugAccountCall({
        action: 'cancel-call',
        callId: targetCall.id,
        currentUserUid: appState.user?.uid || '',
        statusBefore: targetCall.status || '',
        serviceResult: null,
        firestoreErrorCode: error?.code || '',
        firestoreErrorMessage: error?.message || ''
      })
    }
  } finally {
    appState.callActionPending = ''
    refreshAccountCallUi({ refreshConversation: true })
  }
}

async function handleFloatingMenuAction(button) {
  const action = button.getAttribute('data-menu-action')
  const menu = appState.messageContextMenu
  if (!menu) return
  const menuThread = appState.threads.find((entry) => entry.id === menu.threadId)
  const isLockedDm = isThreadInteractionLocked(menuThread)

  // Blocked DMs intentionally allow only copy/profile/cancel from message context menus.
  if (isLockedDm && !['cancel', 'copy', 'profile'].includes(action || '')) {
    clearFloatingOverlays()
    renderFloatingUi()
    return
  }

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
    renderSelectedConversation({ reason: 'state-update' })
    return
  }
  if (action === 'reply') {
    const thread = appState.threads.find((entry) => entry.id === menu.threadId)
    const message = (appState.messagesByThreadId[menu.threadId] || []).find((entry) => entry.id === menu.messageId)
    if (thread && message) {
      appState.replyDraftByThreadId[menu.threadId] = buildReplyPreview(thread, message)
    }
    clearFloatingOverlays()
    renderSelectedConversation({ reason: 'state-update' })
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
    renderSelectedConversation({ reason: 'state-update' })
    try {
      if (mine) await removeMessageReaction({ threadId: menu.threadId, messageId: menu.messageId, reactionId: mine.id })
      else await addMessageReaction({ threadId: menu.threadId, messageId: menu.messageId, uid: appState.user?.uid, emoji })
    } catch {
      rollback()
      appState.errorMessage = 'Unable to update reaction.'
      renderSelectedConversation({ reason: 'state-update' })
    }
  }
  clearFloatingOverlays()
  renderFloatingUi()
}

function setupFloatingEventDelegates() {
  floatingRoot.addEventListener('click', async (event) => {
    const notificationAction = event.target.closest('[data-notification-menu-action]')
    if (notificationAction) {
      event.preventDefault()
      event.stopPropagation()
      await handleNotificationMenuAction(notificationAction)
      return
    }

    const notificationClose = event.target.closest('[data-notification-menu-close]')
    if (notificationClose && event.target.hasAttribute('data-notification-menu-close')) {
      closeNotificationActionMenu({ restoreFocus: true })
      return
    }

    const callActionButton = event.target.closest('[data-account-call-action]')
    if (callActionButton) {
      event.preventDefault()
      event.stopPropagation()
      await handleAccountCallAction(
        callActionButton.getAttribute('data-account-call-action') || '',
        callActionButton.getAttribute('data-call-id') || ''
      )
      return
    }

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
      if (action === 'open-dock') {
        appState.threadActionMenu = null
        openThreadInChatDock(threadId)
        renderFloatingUi()
        return
      }
      if (action === 'close-dock') {
        appState.threadActionMenu = null
        closeChatDock()
        renderFloatingUi()
        return
      }
      if (action === 'pin-sidebar' || action === 'unpin-sidebar') {
        const thread = appState.threads.find((entry) => entry.id === threadId)
        const pin = threadInboxPin(thread)
        appState.threadActionMenu = null
        if (action === 'pin-sidebar') await saveInboxPin(pin)
        else await removeInboxPin(pin.pinId)
        renderFloatingUi()
        return
      }
      if (action === 'refresh-resona') {
        appState.threadActionMenu = null
        appState.isSavingThreadAction = true
        renderFloatingUi()
        try {
          await refreshResonaThread({ threadId })
          const refreshed = await getThread(threadId).catch(() => null)
          if (refreshed) upsertThreadInState(refreshed)
          appState.errorMessage = ''
        } catch (error) {
          appState.errorMessage = error?.message || 'Could not refresh Resona chat.'
        } finally {
          appState.isSavingThreadAction = false
          renderThreadListOnly()
          renderSelectedConversation({ reason: 'state-update' })
          renderFloatingUi()
        }
        return
      }
      if (action === 'add-resona' || action === 'remove-resona') {
        appState.threadActionMenu = null
        appState.isSavingThreadAction = true
        renderFloatingUi()
        try {
          await setThreadResonaAgent({ threadId, active: action === 'add-resona' })
          const updated = await getThread(threadId).catch(() => null)
          if (updated) upsertThreadInState(updated)
          appState.errorMessage = ''
        } catch (error) {
          appState.errorMessage = error?.message || 'Could not update Resona for this chat.'
        } finally {
          appState.isSavingThreadAction = false
          renderThreadListOnly()
          renderSelectedConversation({ reason: 'state-update' })
          renderFloatingUi()
        }
        return
      }
      if (action === 'details') {
        appState.threadActionMenu = null
        if (appState.selectedThreadId !== threadId) {
          appState.selectedThreadId = threadId
          saveLastSelectedThread(appState.user?.uid, threadId)
          startMessageSubscription(threadId)
          renderThreadListOnly()
          renderSelectedConversation({ forceBottom: true })
        }
        openChatSettingsModal()
        renderFloatingUi()
        return
      }
      if (action === 'pin' || action === 'unpin' || action === 'delete' || action === 'clear-resona-history' || action === 'block-contact' || action === 'unblock-contact') {
        openThreadConfirmModal(action, threadId)
      }
      return
    }

    const resonaMenuAction = event.target.closest('[data-resona-menu-action]')
    if (resonaMenuAction) {
      event.preventDefault()
      event.stopPropagation()
      if (resonaMenuAction.getAttribute('data-resona-menu-action') === 'report') {
        await handleReportResonaMessage(
          resonaMenuAction.getAttribute('data-thread-id') || '',
          resonaMenuAction.getAttribute('data-message-id') || ''
        )
      }
      return
    }

    const resonaMenuClose = event.target.closest('[data-resona-menu-close]')
    if (resonaMenuClose && event.target.hasAttribute('data-resona-menu-close')) {
      appState.resonaActionMenu = null
      renderFloatingUi()
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

    const imageZoom = event.target.closest('[data-image-preview-zoom]')
    if (imageZoom) {
      event.preventDefault()
      const delta = Number(imageZoom.getAttribute('data-image-preview-zoom') || 0)
      appState.imagePreviewModal = {
        ...(appState.imagePreviewModal || {}),
        zoom: Math.max(0.75, Math.min(Number(appState.imagePreviewModal?.zoom || 1) + delta, 2.5))
      }
      renderFloatingUi()
      return
    }

    const imageClose = event.target.closest('[data-image-preview-close]')
    if (imageClose) {
      if (event.target !== imageClose && !event.target.hasAttribute('data-image-preview-close')) return
      appState.imagePreviewModal = null
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
    if (event.target.closest('[data-message-context-menu], [data-notification-menu-action]')) return
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
        ${appState.notificationActionMessage ? `<div class="notification-action-feedback" role="status">${escapeHtml(appState.notificationActionMessage)}</div>` : ''}
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
    participantUids: participantIds,
    memberUids: participantIds,
    ownerUid: appState.user?.uid || '',
    createdBy: appState.user?.uid || '',
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
  let creatingThreadId = ''

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
    creatingThreadId = threadId
    console.info('[inbox] create/open thread succeeded', threadId)
    locallyCreatedThreadIds.add(threadId)
    appState.preparingThreadIds[threadId] = true
    if (createdType === 'dm') {
      await restoreThreadForUser({ uid: appState.user.uid, threadId })
    }

    if (!appState.threads.some((item) => item.id === threadId)) {
      const optimistic = optimisticThreadFromSelection(threadId, selectedUsers, createdType, buildGroupTitle(selectedUsers))
      appState.threads = sortInboxThreadsLocal([optimistic, ...appState.threads])
    }

    const hydratedThread = await hydrateThreadFromSourceIfNeeded(thread)
    if (!getThreadParticipantUids(hydratedThread).includes(appState.user.uid)) {
      throw new Error('Conversation membership could not be confirmed.')
    }
    upsertThreadInState(hydratedThread)
    applyInboxRoute(parseInboxRoute(ROUTES.inboxMessages))
    window.history.pushState({ inbox: true }, '', inboxRouteWithCurrentSearch(ROUTES.inboxMessages))
    appState.selectedThreadId = threadId
    saveLastSelectedThread(appState.user.uid, threadId)
    appState.errorMessage = ''
    startMessageSubscription(threadId)
    try {
      const durableThreads = await listInboxThreads(appState.user.uid)
      console.info('[inbox] one-time fallback loaded', durableThreads.length, 'threads')
      appState.threads = durableThreads.length ? mergeThreadsWithLocalCreates(durableThreads) : appState.threads
      appState.hasLoadedThreadsOnce = true
    } catch (refreshError) {
      warnRealtimePermission(`threads-refresh-after-create-${appState.user.uid}`, refreshError)
    }
    closeCreateChatModal()
    renderThreadListOnly()
    renderSelectedConversation({ forceBottom: true })
  } catch (error) {
    if (creatingThreadId) delete appState.preparingThreadIds[creatingThreadId]
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
    renderChatSettingsModal({ keepSearchFocus: true })
  }
}

function updateChatSettingsSaveButton() {
  const thread = getSelectedThread()
  const button = modalRoot.querySelector('[data-chat-details-save]')
  if (!thread || !button) return
  const hasChanges = String(appState.chatSettingsDraftTitle || '').trim() !== String(thread.title || '').trim()
    || Boolean(appState.chatSettingsImageFile)
  button.disabled = appState.isSavingChatSettings || !hasChanges
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
    appState.threads = appState.threads.map((entry) => (
      entry.id === thread.id
        ? { ...entry, title: trimmedTitle, imageURL, imagePath }
        : entry
    ))
    appState.chatSettingsError = ''
    appState.isSavingChatSettings = false
    renderThreadListOnly()
    renderSelectedConversation({ reason: 'chat-identity-update' })
    closeChatSettingsModal()
  } catch (error) {
    appState.isSavingChatSettings = false
    appState.chatSettingsError = error?.message || 'Unable to save chat settings.'
    renderChatSettingsModal()
  }
}

async function handleResetChatIdentity() {
  const thread = getSelectedThread()
  if (!thread || thread.type !== 'group' || thread.createdBy !== appState.user?.uid || appState.isSavingChatSettings) return
  if (!window.confirm('Reset this group name and image to the generated member identity? Messages and members will stay unchanged.')) return
  try {
    appState.isSavingChatSettings = true
    renderChatSettingsModal()
    const title = generatedGroupTitle(thread)
    await updateThreadDetails({
      threadId: thread.id,
      actorUid: appState.user?.uid,
      title,
      imageURL: '',
      imagePath: ''
    })
    appState.threads = appState.threads.map((entry) => (
      entry.id === thread.id
        ? { ...entry, title, imageURL: '', imagePath: '' }
        : entry
    ))
    appState.chatSettingsDraftTitle = title
    appState.chatSettingsImageFile = null
    appState.chatSettingsError = ''
    appState.isSavingChatSettings = false
    renderThreadListOnly()
    renderSelectedConversation({ reason: 'chat-identity-reset' })
    renderChatSettingsModal()
  } catch (error) {
    appState.isSavingChatSettings = false
    appState.chatSettingsError = error?.message || 'Unable to reset chat identity.'
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
  const dmBlockState = getDmBlockState(thread)
  const dmBlockActionLabel = dmBlockState.currentUserBlockedOther ? 'Unblock contact' : 'Block contact'
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
            ${canEditGroup ? `<button type="button" class="button button-accent" data-chat-details-save ${(appState.isSavingChatSettings || !hasPendingChanges) ? 'disabled' : ''}>${appState.isSavingChatSettings ? 'Saving…' : 'Save changes'}</button>` : ''}
            <button type="button" class="create-chat-close" data-chat-details-close aria-label="Close chat settings">×</button>
          </div>
        </header>

        <section class="chat-details-section">
          <div class="chat-details-section-heading">
            <div>
              <p class="chat-details-eyebrow">Appearance</p>
              <h3>Chat identity</h3>
            </div>
            ${canEditGroup ? `<button type="button" class="button button-muted" data-chat-details-reset ${appState.isSavingChatSettings ? 'disabled' : ''}>${iconSvg('image')} Reset identity</button>` : ''}
          </div>
          <div class="chat-details-identity-row">
            ${renderThreadAvatar(thread, { className: 'thread-avatar chat-details-avatar', stableKey: `chat-details:${thread.id}` })}
            <div class="chat-details-identity-fields">
              <label for="chat-settings-title">Chat name</label>
              <input id="chat-settings-title" type="text" data-chat-settings-title value="${escapeHtml(appState.chatSettingsDraftTitle || '')}" ${canEditGroup ? '' : 'disabled'} />
              <label class="chat-details-file-picker ${canEditGroup ? '' : 'is-disabled'}">
                ${iconSvg('upload')}
                <span>${appState.chatSettingsImageFile ? escapeHtml(appState.chatSettingsImageFile.name) : 'Choose group image'}</span>
                <input type="file" data-chat-settings-image accept="image/*" ${canEditGroup ? '' : 'disabled'} />
              </label>
              <small>${canEditGroup ? 'Rename the group or choose a custom image. Reset restores the generated member identity.' : 'Direct messages cannot be renamed or assigned a custom image.'}</small>
            </div>
          </div>
        </section>

        <section class="chat-details-section">
          <div class="chat-details-section-heading"><div><p class="chat-details-eyebrow">People</p><h3>Members</h3></div><span>${participants.length}</span></div>
          <div class="chat-details-member-list">${memberMarkup || '<p class="modal-hint">No members found.</p>'}</div>
        </section>

        <section class="chat-details-section">
          <div class="chat-details-section-heading"><div><p class="chat-details-eyebrow">Invite</p><h3>Add people</h3></div></div>
          <input class="create-chat-search" type="search" placeholder="Search username…" value="${escapeHtml(appState.chatSettingsSearchQuery)}" data-chat-settings-search ${canEditGroup ? '' : 'disabled'} />
          ${canEditGroup ? `<div class="create-chat-results">${addMarkup}</div>` : '<p class="modal-hint">Only the chat owner can add people.</p>'}
        </section>

        ${thread.type === 'dm' ? `
          <section class="chat-details-section">
            <div class="chat-details-section-heading"><div><p class="chat-details-eyebrow">Safety</p><h3>Contact controls</h3></div></div>
            <button type="button" class="button button-muted" data-chat-settings-block-toggle>${escapeHtml(dmBlockActionLabel)}</button>
          </section>
        ` : ''}

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
    updateChatSettingsSaveButton()
  })
  modalRoot.querySelector('[data-chat-settings-image]')?.addEventListener('change', (event) => {
    appState.chatSettingsImageFile = event.target.files?.[0] || null
    renderChatSettingsModal()
  })
  modalRoot.querySelector('[data-chat-details-reset]')?.addEventListener('click', handleResetChatIdentity)
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
  modalRoot.querySelector('[data-chat-settings-block-toggle]')?.addEventListener('click', () => {
    appState.threadConfirmModal = {
      type: dmBlockState.currentUserBlockedOther ? 'unblock-contact' : 'block-contact',
      threadId: thread.id
    }
    appState.threadActionMenu = null
    renderFloatingUi()
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

function bindSharedEvents(scope = inboxRoot) {
  scope.querySelectorAll('[data-inbox-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextFilter = button.dataset.inboxFilter || 'Messages'
      if (nextFilter !== 'Messages' && activeTypingThreadId) {
        clearTypingForThread(activeTypingThreadId)
      }
      navigateInbox(button.dataset.inboxPath || ROUTES.inboxMessages)
    })
  })

  scope.querySelectorAll('[data-inbox-path]:not([data-inbox-filter])').forEach((button) => {
    button.addEventListener('click', () => {
      navigateInbox(button.getAttribute('data-inbox-path') || ROUTES.inboxMessages)
    })
  })
  scope.querySelectorAll('[data-product-gift-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [action, giftId] = String(button.getAttribute('data-product-gift-action') || '').split(':')
      if (!giftId || appState.productGiftActionId) return
      appState.productGiftActionId = giftId
      appState.productGiftAction = action
      appState.productGiftActionMessage = ''
      appState.productGiftActionError = ''
      renderSignedInState()
      try {
        if (action === 'accept') await acceptProductGift(giftId)
        else await denyProductGift(giftId)
        await loadProductGifts()
        appState.productGiftActionMessage = action === 'accept'
          ? 'Gift accepted and added to your Library.'
          : 'Gift denied.'
      } catch (error) {
        const code = String(error?.code || '').replace(/^functions\//, '')
        appState.productGiftActionError = code === 'permission-denied'
          ? 'You do not have permission to respond to this gift.'
          : code === 'failed-precondition'
            ? 'This gift has already been resolved.'
            : (error?.message || 'Could not update this gift.')
      } finally {
        appState.productGiftActionId = ''
        appState.productGiftAction = ''
        renderSignedInState()
      }
    })
  })

  const mutualSearch = scope.querySelector('[data-mutual-user-search]')
  mutualSearch?.addEventListener('input', () => {
    scheduleMutualUsernameSearch(mutualSearch.value)
  })

  scope.querySelector('[data-mutual-refresh]')?.addEventListener('click', () => {
    loadMutualUsersSuggestions({ force: true })
  })

  scope.querySelector('[data-mutual-choose-contacts]')?.addEventListener('click', async () => {
    const state = appState.mutualUsers
    if (!state.capabilities.supportsContactPicker || typeof navigator.contacts?.select !== 'function') {
      state.contactStatus = 'Contact Picker is not supported in this browser. Use username search or a CSV/vCard file.'
      renderSignedInState()
      return
    }
    try {
      const selected = await navigator.contacts.select(['name', 'email', 'tel'], { multiple: true })
      const identifiers = selected.flatMap((contact) => [
        ...(Array.isArray(contact.email) ? contact.email : []),
        ...(Array.isArray(contact.tel) ? contact.tel : [])
      ])
      await handleMutualContactsMatch(identifiers, 'contact-picker')
    } catch (error) {
      if (String(error?.name || '').toLowerCase().includes('abort')) return
      state.contactStatus = 'Contacts could not be selected. No contact information was stored.'
      renderSignedInState()
    }
  })

  scope.querySelector('[data-mutual-contact-file]')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > 2 * 1024 * 1024) {
      appState.mutualUsers.contactStatus = 'Choose a CSV or vCard file smaller than 2 MB.'
      renderSignedInState()
      return
    }
    try {
      const identifiers = extractContactIdentifiers(await file.text())
      await handleMutualContactsMatch(identifiers, file.name.toLowerCase().endsWith('.vcf') ? 'vcard' : 'csv')
    } catch {
      appState.mutualUsers.contactStatus = 'This contact file could not be read. No data was uploaded.'
      renderSignedInState()
    }
  })

  scope.querySelector('[data-mutual-match-emails]')?.addEventListener('click', async () => {
    const input = scope.querySelector('[data-mutual-email-input]')
    await handleMutualContactsMatch(extractContactIdentifiers(input?.value || ''), 'email-entry')
  })

  scope.querySelectorAll('[data-mutual-follow]').forEach((button) => {
    button.addEventListener('click', () => handleMutualFollow(button.getAttribute('data-mutual-follow') || ''))
  })

  scope.querySelectorAll('[data-mutual-dismiss]').forEach((button) => {
    button.addEventListener('click', () => handleMutualDismiss(button.getAttribute('data-mutual-dismiss') || ''))
  })

  scope.querySelectorAll('[data-select-thread-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      const threadId = button.getAttribute('data-select-thread-id') || ''
      await selectThread(threadId)
    })
  })

  scope.querySelectorAll('[data-open-resona-thread]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return
      button.disabled = true
      await ensureResonaThread({ select: true })
      button.disabled = false
    })
  })

  scope.querySelectorAll('[data-open-support-dock]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      if (button.disabled) return
      button.disabled = true
      try {
        await ensureResonaThread({ select: true })
      } catch (error) {
        appState.errorMessage = error?.message || 'Could not open Resona.'
        renderSignedInState()
      } finally {
        button.disabled = false
      }
    })
  })

  scope.querySelectorAll('[data-thread-menu-id]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const threadId = button.getAttribute('data-thread-menu-id') || ''
      openThreadActionMenu(threadId, event)
    })
  })

  scope.querySelectorAll('[data-resona-feedback]').forEach((button) => {
    button.addEventListener('click', () => handleResonaFeedback(button.getAttribute('data-resona-feedback') || ''))
  })

  scope.querySelectorAll('[data-resona-copy]').forEach((button) => {
    button.addEventListener('click', () => handleResonaCopy(button.getAttribute('data-resona-copy') || ''))
  })

  scope.querySelectorAll('[data-resona-speak]').forEach((button) => {
    button.addEventListener('click', () => handleResonaSpeak(button.getAttribute('data-resona-speak') || ''))
  })

  scope.querySelectorAll('[data-resona-message-menu]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      const { threadId, messageId } = parseResonaActionKey(button.getAttribute('data-resona-message-menu') || '')
      appState.resonaActionMenu = { threadId, messageId, x: event.clientX, y: event.clientY }
      renderFloatingUi()
    })
  })

  scope.querySelectorAll('[data-open-inbox-pin]').forEach((button) => {
    button.addEventListener('click', async () => {
      await openInboxPin(button.getAttribute('data-open-inbox-pin') || '')
    })
  })

  scope.querySelectorAll('[data-unpin-inbox-pin]').forEach((button) => {
    button.addEventListener('click', async (event) => {
      event.preventDefault()
      event.stopPropagation()
      await removeInboxPin(button.getAttribute('data-unpin-inbox-pin') || '')
    })
  })

  scope.querySelectorAll('[data-system-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      appState.systemFilter = button.getAttribute('data-system-filter') || 'all'
      appState.notificationActionMessage = ''
      renderSignedInState()
    })
  })

  scope.querySelectorAll('[data-notification-menu-trigger]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault()
      event.stopPropagation()
      openNotificationActionMenu(button)
    })
  })

  scope.querySelectorAll('[data-system-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      if (!appState.user?.uid) return
      await markSystemNotificationRead(appState.user.uid, card.getAttribute('data-system-id')).catch(() => {})
    })
  })

  scope.querySelectorAll('[data-open-content-notification]').forEach((button) => {
    button.addEventListener('click', () => {
      const [sourceCollection, itemId] = String(button.getAttribute('data-open-content-notification') || '').split(':')
      const href = button.getAttribute('data-content-href') || ''
      if (appState.user?.uid && itemId) {
        if (sourceCollection === 'accountEvents') {
          markAccountEventRead(appState.user.uid, itemId).catch(() => {})
        } else {
          markSystemNotificationRead(appState.user.uid, itemId).catch(() => {})
        }
      }
      if (href) window.location.assign(href)
    })
  })

  scope.querySelectorAll('[data-account-event-id]').forEach((card) => {
    card.addEventListener('click', async () => {
      if (!appState.user?.uid) return
      await markAccountEventRead(appState.user.uid, card.getAttribute('data-account-event-id')).catch(() => {})
    })
  })

  const openCreateChatButton = scope.querySelector('[data-action="open-create-chat"]')
  if (openCreateChatButton) {
    openCreateChatButton.addEventListener('click', () => {
      openCreateChatModal()
    })
  }

  const openChatSettingsButton = scope.querySelector('[data-action="open-chat-settings"]')
  if (openChatSettingsButton) {
    openChatSettingsButton.addEventListener('click', () => openChatSettingsModal())
  }

  scope.querySelectorAll('[data-start-account-call]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (button.disabled) return
      await startAccountCallFromThread(button.getAttribute('data-start-account-call') || '')
    })
  })

  scope.querySelectorAll('[data-account-call-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      await handleAccountCallAction(
        button.getAttribute('data-account-call-action') || '',
        button.getAttribute('data-call-id') || ''
      )
    })
  })

  const messageForm = scope.querySelector('[data-message-form]')
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
    textarea.addEventListener('paste', (event) => {
      if (isThreadInteractionLocked(thread)) return
      const items = Array.from(event.clipboardData?.items || [])
      const imageFiles = items
        .filter((item) => item.kind === 'file' && String(item.type || '').startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter(Boolean)
      if (!imageFiles.length) return
      const hasText = Array.from(event.clipboardData?.types || []).includes('text/plain')
      if (!hasText) event.preventDefault()
      appendAttachmentDraft(thread.id, imageFiles)
      renderSelectedConversation({ reason: 'state-update' })
    })
    textarea.addEventListener('blur', () => {
      clearTypingForThread(thread.id)
    })
  }

  messageForm?.querySelector('[data-action="attach-file"]')?.addEventListener('click', () => {
    if (thread && isThreadInteractionLocked(thread)) return
    attachmentInput?.click()
  })

  attachmentInput?.addEventListener('change', () => {
    if (!thread) return
    if (isThreadInteractionLocked(thread)) return
    appendAttachmentDraft(thread.id, Array.from(attachmentInput.files || []))
    renderSelectedConversation({ reason: 'state-update' })
  })

  messageForm?.querySelectorAll('[data-remove-attachment]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!thread) return
      const index = Number(button.getAttribute('data-remove-attachment'))
      const current = appState.attachmentDraftByThreadId[thread.id] || []
      setAttachmentDraft(thread.id, current.filter((_, idx) => idx !== index))
      renderSelectedConversation({ reason: 'state-update' })
    })
  })

  messageForm?.querySelector('[data-clear-reply-draft]')?.addEventListener('click', () => {
    if (!thread?.id) return
    delete appState.replyDraftByThreadId[thread.id]
    renderSelectedConversation({ reason: 'state-update' })
  })

  messageForm?.querySelectorAll('[data-reveal-blocked-message]').forEach((button) => {
    button.addEventListener('click', () => {
      const messageId = button.getAttribute('data-reveal-blocked-message') || ''
      const threadId = button.getAttribute('data-reveal-blocked-thread-id') || ''
      if (!threadId || !messageId) return
      revealBlockedMessage(threadId, messageId)
      renderSelectedConversation({ reason: 'state-update' })
    })
  })

  scope.querySelectorAll('[data-message-id]').forEach((messageEl) => {
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

  scope.querySelectorAll('[data-retry-message]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!thread?.id || !appState.user?.uid) return
      const clientMessageId = button.getAttribute('data-retry-message') || ''
      const message = (appState.optimisticMessagesByThreadId[thread.id] || []).find((entry) => entry.clientMessageId === clientMessageId)
      if (!message) return
      setOptimisticMessageStatus(thread.id, clientMessageId, 'sending')
      renderSelectedConversation({ reason: 'state-update' })
      try {
        await sendMessage(thread.id, {
          senderId: appState.user.uid,
          body: message.body || '',
          type: message.type || 'text',
          attachments: message.pendingFiles || [],
          replyTo: message.replyTo || null,
          clientMessageId
        })
        appState.errorMessage = ''
      } catch (error) {
        setOptimisticMessageStatus(thread.id, clientMessageId, 'failed', error?.message || 'Unable to send message.')
        appState.errorMessage = getSendErrorMessage(error, thread)
      }
      renderSelectedConversation({ forceBottom: true })
    })
  })

  scope.querySelectorAll('[data-remove-failed-message]').forEach((button) => {
    button.addEventListener('click', () => {
      if (!thread?.id) return
      const clientMessageId = button.getAttribute('data-remove-failed-message') || ''
      removeOptimisticMessage(thread.id, clientMessageId)
      renderSelectedConversation({ reason: 'state-update' })
    })
  })

  scope.querySelectorAll('[data-edit-message-input]').forEach((input) => {
    input.addEventListener('input', () => {
      const messageId = input.getAttribute('data-edit-message-input')
      appState.editDraftByMessageId[messageId] = input.value
    })
  })

  scope.querySelectorAll('[data-edit-cancel]').forEach((button) => {
    button.addEventListener('click', () => {
      const messageId = button.getAttribute('data-edit-cancel')
      if (thread?.id) appState.editingMessageByThreadId[thread.id] = ''
      delete appState.editDraftByMessageId[messageId]
      renderSelectedConversation({ reason: 'state-update' })
    })
  })

  scope.querySelectorAll('[data-edit-save]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!thread?.id) return
      if (isThreadInteractionLocked(thread)) return
      const messageId = button.getAttribute('data-edit-save')
      const body = appState.editDraftByMessageId[messageId] || ''
      await editMessage({ threadId: thread.id, messageId, uid: appState.user?.uid, body })
      appState.editingMessageByThreadId[thread.id] = ''
      delete appState.editDraftByMessageId[messageId]
      renderSelectedConversation({ reason: 'state-update' })
    })
  })

  scope.querySelectorAll('[data-jump-reply-message-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const targetId = button.getAttribute('data-jump-reply-message-id')
      if (!targetId) return
      const safeId = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(targetId) : targetId.replace(/"/g, '\\"')
      const target = inboxRoot.querySelector(`[data-message-id="${safeId}"]`)
      if (!target) return
      messageScrollController.navigateToElement(target, 'reply-target')
      target.classList.add('is-reply-target-highlight')
      window.setTimeout(() => target.classList.remove('is-reply-target-highlight'), 1100)
    })
  })

  scope.querySelectorAll('[data-reaction-pill]').forEach((button) => {
    button.addEventListener('click', async () => {
      const messageId = button.getAttribute('data-reaction-pill')
      const emoji = button.getAttribute('data-emoji') || ''
      if (!thread?.id || !messageId || !emoji) return
      if (isThreadInteractionLocked(thread)) return
      const reactionRows = appState.reactionsByThreadId[thread.id]?.[messageId] || []
      const mine = reactionRows.find((entry) => entry.uid === appState.user?.uid && entry.emoji === emoji)
      const rollback = applyOptimisticReaction({
        threadId: thread.id,
        messageId,
        emoji,
        uid: appState.user?.uid,
        add: !mine
      })
      renderSelectedConversation({ reason: 'state-update' })
      try {
        if (mine) await removeMessageReaction({ threadId: thread.id, messageId, uid: appState.user?.uid, emoji })
        else await addMessageReaction({ threadId: thread.id, messageId, uid: appState.user?.uid, emoji })
      } catch {
        rollback()
        appState.errorMessage = 'Unable to update reaction.'
        renderSelectedConversation({ reason: 'state-update' })
      }
    })
  })


  if (messageForm) {
    messageForm.addEventListener('submit', async (event) => {
      event.preventDefault()
      await handleMessageSubmit(messageForm)
    })
  }

  const list = scope.querySelector('[data-message-list]')
  if (list && (appState.messageContextMenu || appState.threadActionMenu)) {
    list.addEventListener('scroll', () => {
      clearFloatingOverlays()
      appState.threadActionMenu = null
      renderFloatingUi()
    }, { once: true })
  }
}

function captureMessageComposerFocus(root = inboxRoot) {
  const active = document.activeElement
  if (!(active instanceof HTMLTextAreaElement) || !active.matches('[data-message-composer-input]') || !root.contains(active)) return null
  return {
    threadId: active.getAttribute('data-message-composer-input') || '',
    selectionStart: Number(active.selectionStart || 0),
    selectionEnd: Number(active.selectionEnd || 0),
    scrollTop: Number(active.scrollTop || 0)
  }
}

function restoreMessageComposerFocus(snapshot) {
  if (!snapshot?.threadId || snapshot.threadId !== appState.selectedThreadId) return
  const composer = inboxRoot.querySelector(`[data-message-composer-input="${CSS.escape(snapshot.threadId)}"]`)
  if (!(composer instanceof HTMLTextAreaElement) || composer.disabled) return
  composer.focus({ preventScroll: true })
  const textLength = composer.value.length
  composer.setSelectionRange(
    Math.min(snapshot.selectionStart, textLength),
    Math.min(snapshot.selectionEnd, textLength)
  )
  composer.scrollTop = snapshot.scrollTop
}

function renderSignedInState() {
  const composerFocus = captureMessageComposerFocus()
  const scrollSnapshot = messageScrollController.snapshot()
  const previousThreadId = messageScrollController.threadId
  inboxRoot.innerHTML = appState.activeFilter === 'Messages' ? renderMessagesLayout() : renderActivityLayout(appState.activeFilter)
  bindSharedEvents()
  if (appState.activeFilter === 'Messages') {
    const scroller = getMessageScroller()
    messageScrollController.attach(scroller, {
      threadId: appState.selectedThreadId,
      resetMode: !previousThreadId || previousThreadId !== appState.selectedThreadId
    })
    if (appState.messageFind.open && appState.messageFind.query) applyMessageFind()
    messageScrollController.stabilizeAfterRender(scrollSnapshot, {
      reason: 'inbox-layout',
      forceBottom: !previousThreadId || previousThreadId !== appState.selectedThreadId
    })
  } else {
    messageScrollController.detach()
  }
  restoreMessageComposerFocus(composerFocus)
  renderCreateChatModal()
  renderChatSettingsModal()
  renderFloatingUi()
}

function preserveStableImages(previousRoot, generatedRoot) {
  if (!previousRoot || !generatedRoot) return
  const existingByKey = new Map()
  previousRoot.querySelectorAll('img[data-stable-image-key]').forEach((image) => {
    const key = image.getAttribute('data-stable-image-key') || ''
    if (key) existingByKey.set(key, image)
  })
  generatedRoot.querySelectorAll('img[data-stable-image-key]').forEach((nextImage) => {
    const key = nextImage.getAttribute('data-stable-image-key') || ''
    const existingImage = existingByKey.get(key)
    if (!existingImage || existingImage.getAttribute('src') !== nextImage.getAttribute('src')) return
    nextImage.replaceWith(existingImage)
  })
}

function preserveRenderedMessageMedia(previousList, generatedList) {
  if (!previousList || !generatedList) return
  preserveStableImages(previousList, generatedList)
  const existingMediaByKey = new Map()
  previousList.querySelectorAll('[data-message-media-key]').forEach((media) => {
    const key = media.getAttribute('data-message-media-key') || ''
    if (key) existingMediaByKey.set(key, media)
  })
  generatedList.querySelectorAll('[data-message-media-key]').forEach((nextMedia) => {
    const key = nextMedia.getAttribute('data-message-media-key') || ''
    const existingMedia = existingMediaByKey.get(key)
    if (!existingMedia) return
    const nextUrl = nextMedia.getAttribute('data-preview-message-image') || nextMedia.getAttribute('src') || ''
    const existingUrl = existingMedia.getAttribute('data-preview-message-image') || existingMedia.getAttribute('src') || ''
    if (nextUrl !== existingUrl) return
    nextMedia.replaceWith(existingMedia)
  })
}

function preserveRenderedMessageBubbles(previousList, generatedList) {
  if (!previousList || !generatedList) return
  const existingByRenderKey = new Map()
  previousList.querySelectorAll('[data-message-render-key]').forEach((bubble) => {
    const key = bubble.getAttribute('data-message-render-key') || ''
    if (key) existingByRenderKey.set(key, bubble)
  })
  generatedList.querySelectorAll('[data-message-render-key]').forEach((nextBubble) => {
    const key = nextBubble.getAttribute('data-message-render-key') || ''
    const existingBubble = existingByRenderKey.get(key)
    if (!existingBubble) return
    existingBubble.className = nextBubble.className
    ;['data-message-id', 'data-message-thread-id', 'data-sender-id'].forEach((attribute) => {
      const value = nextBubble.getAttribute(attribute)
      if (value == null) existingBubble.removeAttribute(attribute)
      else existingBubble.setAttribute(attribute, value)
    })
    existingBubble.replaceChildren(...nextBubble.childNodes)
    nextBubble.replaceWith(existingBubble)
    debugInboxRender('message bubble updated in place', key)
  })
}

function renderSelectedConversation({
  forceBottom = false,
  preservePrepend = false,
  reason = 'conversation-render'
} = {}) {
  if (appState.activeFilter !== 'Messages') return
  const panel = inboxRoot.querySelector('.inbox-main-panel')
  if (!panel) {
    renderSignedInState()
    return
  }
  const composerFocus = captureMessageComposerFocus(panel)
  const scrollSnapshot = messageScrollController.snapshot()
  const previousList = getMessageScroller()
  const previousHeader = panel.querySelector('.conversation-header')
  const previousComposer = panel.querySelector('[data-message-form]')
  const thread = getSelectedThread()
  const messages = thread ? getRenderableMessages(thread) : []
  const nextRenderSignature = thread ? getMessageRenderSignature(thread, messages) : ''
  const previousRenderSignature = previousList?.dataset.messageRenderSignature || ''
  const reuseMessageList = Boolean(previousList && nextRenderSignature && previousRenderSignature === nextRenderSignature)
  const nextContent = document.createElement('div')
  nextContent.innerHTML = `${getConversationHeaderMarkup(thread)}${getConversationBodyMarkup({
    reuseMessageList,
    messages,
    renderSignature: nextRenderSignature
  })}`
  const generatedList = nextContent.querySelector('[data-message-list]')
  const generatedHeader = nextContent.querySelector('.conversation-header')
  const generatedComposer = nextContent.querySelector('[data-message-form]')
  const reuseHeader = Boolean(
    previousHeader
    && generatedHeader
    && previousHeader.getAttribute('data-conversation-header-signature') === generatedHeader.getAttribute('data-conversation-header-signature')
  )
  const reuseComposer = Boolean(
    previousComposer
    && generatedComposer
    && previousComposer.getAttribute('data-composer-render-signature') === generatedComposer.getAttribute('data-composer-render-signature')
  )
  if (reuseHeader) {
    const headerSlot = document.createElement('div')
    headerSlot.dataset.conversationHeaderSlot = ''
    generatedHeader.replaceWith(headerSlot)
  }
  if (reuseComposer) {
    const composerSlot = document.createElement('div')
    composerSlot.dataset.messageComposerSlot = ''
    generatedComposer.replaceWith(composerSlot)
  }
  preserveStableImages(panel, nextContent)
  if (!reuseMessageList && previousList && generatedList) {
    preserveRenderedMessageMedia(previousList, generatedList)
    preserveRenderedMessageBubbles(previousList, generatedList)
  }
  panel.replaceChildren(...nextContent.childNodes)
  const headerSlot = panel.querySelector('[data-conversation-header-slot]')
  const composerSlot = panel.querySelector('[data-message-composer-slot]')
  bindSharedEvents(panel)
  if (reuseHeader) headerSlot?.replaceWith(previousHeader)
  if (reuseComposer) composerSlot?.replaceWith(previousComposer)
  if (reuseMessageList) {
    const messageListSlot = panel.querySelector('[data-message-list-slot]')
    messageListSlot?.replaceWith(previousList)
    debugInboxRender('message list reused', { reason, signature: nextRenderSignature })
  } else {
    debugInboxRender('message list rendered', {
      reason,
      previousSignature: previousRenderSignature,
      nextSignature: nextRenderSignature
    })
  }
  const nextList = getMessageScroller()
  messageScrollController.attach(nextList, {
    threadId: appState.selectedThreadId,
    resetMode: messageScrollController.threadId !== appState.selectedThreadId
  })
  if (!reuseMessageList && appState.messageFind.open && appState.messageFind.query) applyMessageFind()
  messageScrollController.stabilizeAfterRender(scrollSnapshot, {
    reason,
    forceBottom,
    preservePrepend
  })
  restoreMessageComposerFocus(composerFocus)
  debugMessageScroller(`after render: ${reason}`, nextList)
}

function renderThreadListOnly() {
  if (appState.activeFilter !== 'Messages') return
  const currentList = inboxRoot.querySelector('.inbox-thread-list')
  if (!currentList) {
    renderSignedInState()
    return
  }
  const container = document.createElement('div')
  container.innerHTML = getMessagesThreadListMarkup()
  const nextList = container.querySelector('.inbox-thread-list')
  if (!nextList) return
  const existingRows = new Map()
  currentList.querySelectorAll('[data-thread-row-id]').forEach((row) => {
    existingRows.set(row.getAttribute('data-thread-row-id') || '', row)
  })
  nextList.querySelectorAll('[data-thread-row-id]').forEach((nextRow) => {
    const id = nextRow.getAttribute('data-thread-row-id') || ''
    const existingRow = existingRows.get(id)
    if (!existingRow) return
    preserveStableImages(existingRow, nextRow)
  })
  currentList.replaceWith(nextList)
  if (nextList) bindSharedEvents(nextList)
}

function renderSidebarOnly() {
  const sidebar = inboxRoot.querySelector('.inbox-sidebar')
  if (!sidebar) return
  sidebar.innerHTML = getMessagesSidebarMarkup()
  bindSharedEvents(sidebar)
}

function createClientMessageId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function getSendErrorMessage(error, thread) {
  const message = String(error?.message || '').toLowerCase()
  const code = String(error?.code || '').toLowerCase()
  if (!appState.user?.uid) return 'Sign in required.'
  if (thread?.type === 'dm' && message.includes('block')) return 'This user can no longer receive messages from you.'
  if (message.includes('not a participant')) return 'You are not a participant in this thread.'
  if (message.includes('participant') || message.includes('thread not found')) return 'Preparing chat. Try again in a moment.'
  if (message.includes('attachment') || code.includes('storage')) return 'Attachment upload failed. Your message was not sent.'
  if (code.includes('permission-denied') || message.includes('permission')) return 'You do not have permission to send in this conversation.'
  return error?.message || 'Unable to send message.'
}

async function ensureThreadReadyForSend(thread) {
  const threadId = String(thread?.id || '').trim()
  const uid = String(appState.user?.uid || '').trim()
  if (!threadId || !uid) throw new Error('Thread or signed-in user is missing.')

  appState.preparingThreadIds[threadId] = true
  renderSelectedConversation({ reason: 'prepare-send' })
  try {
    const sourceThread = await getThread(threadId)
    if (!sourceThread) throw new Error('Thread not found.')
    const participantUids = getThreadParticipantUids(sourceThread)
    const canSend = participantUids.includes(uid) && sourceThread.status !== 'archived'
    debugInboxSend('thread readiness', {
      activeThreadId: threadId,
      activeThreadType: sourceThread.type || '',
      currentUserUid: uid,
      participantUids,
      memberUids: Array.isArray(sourceThread.memberUids) ? sourceThread.memberUids : [],
      ownerUid: sourceThread.ownerUid || '',
      createdBy: sourceThread.createdBy || '',
      status: sourceThread.status || '',
      canSend,
      isPersistedThread: true,
      sendPath: 'callable:sendInboxMessage'
    })
    if (!participantUids.includes(uid)) throw new Error('You are not a participant in this thread.')
    if (sourceThread.status === 'archived') throw new Error('This conversation is archived.')
    upsertThreadInState(sourceThread)
    locallyCreatedThreadIds.delete(threadId)
    return sourceThread
  } finally {
    delete appState.preparingThreadIds[threadId]
  }
}

async function refreshSiteGuidanceContextForOutgoingMessage() {
  const detail = {
    reason: 'message-send',
    promises: [],
    contexts: []
  }
  window.dispatchEvent(new CustomEvent(SITE_GUIDANCE_REFRESH_EVENT, { detail }))
  if (detail.promises.length) await Promise.allSettled(detail.promises)
  return {
    ...buildClientTimeContext(),
    ...(detail.contexts[0] || {})
  }
}

function buildClientTimeContext() {
  const now = new Date()
  const offsetMinutes = -now.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const pad = (value) => String(value).padStart(2, '0')
  const clientLocalTimeISO = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
  return {
    route: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    currentRoute: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    pageTitle: document.title || '',
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    clientLocalTimeISO,
    utcTimeISO: now.toISOString()
  }
}

async function handleMessageSubmit(form) {
  let thread = getSelectedThread()
  if (!thread || !appState.user?.uid) return
  if (isThreadResonaResponding(thread)) {
    appState.errorMessage = 'Resona is responding. Please wait for the current reply to finish.'
    renderSelectedConversation({ reason: 'state-update' })
    return
  }
  const blockState = getDmBlockState(thread)
  if (thread.type === 'dm' && blockState.isDmBlocked) {
    appState.errorMessage = blockState.currentUserBlockedOther
      ? 'You blocked this user. Unblock to send messages.'
      : 'This user can no longer receive messages from you.'
    renderSelectedConversation({ reason: 'state-update' })
    return
  }

  const field = form.querySelector('textarea[name="message"]')
  const body = String(field?.value || '').trim()
  const attachments = appState.attachmentDraftByThreadId[thread.id] || []
  const oversized = attachments.find((file) => Number(file?.size || 0) > MAX_ATTACHMENT_BYTES)
  if (oversized) {
    appState.errorMessage = `Attachment is too large. Maximum size is ${MAX_ATTACHMENT_LABEL}.`
    renderSelectedConversation({ reason: 'state-update' })
    return
  }
  if (!body && !attachments.length) return

  const clientMessageId = createClientMessageId()
  const replyTo = appState.replyDraftByThreadId[thread.id] || null
  addOptimisticMessage(thread, { clientMessageId, body, attachments, replyTo })
  appState.errorMessage = ''
  if (field) field.value = ''
  appState.composerDraftByThreadId[thread.id] = ''
  delete appState.replyDraftByThreadId[thread.id]
  setAttachmentDraft(thread.id, [])
  form.querySelector('button[type="submit"]')?.setAttribute('disabled', 'disabled')
  renderSelectedConversation({ forceBottom: true })

  try {
    thread = await ensureThreadReadyForSend(thread)
  } catch (error) {
    setOptimisticMessageStatus(thread.id, clientMessageId, 'failed', error?.message || 'Unable to prepare conversation.')
    appState.errorMessage = getSendErrorMessage(error, thread)
    debugInboxSend('thread readiness failed', {
      activeThreadId: thread.id,
      activeThreadType: thread.type || '',
      currentUserUid: appState.user.uid,
      participantUids: getThreadParticipantUids(thread),
      memberUids: Array.isArray(thread.memberUids) ? thread.memberUids : [],
      ownerUid: thread.ownerUid || '',
      createdBy: thread.createdBy || '',
      canSend: false,
      isPersistedThread: false,
      sendPath: 'callable:sendInboxMessage',
      sendErrorCode: error?.code || '',
      sendErrorMessage: error?.message || ''
    })
    renderSelectedConversation({ reason: 'prepare-send-failed' })
    return
  }

  let sendFailed = false
  try {
    const safePageContext = await refreshSiteGuidanceContextForOutgoingMessage()
    debugInboxSend('send start', {
      activeThreadId: thread.id,
      activeThreadType: thread.type || '',
      currentUserUid: appState.user.uid,
      participantUids: getThreadParticipantUids(thread),
      memberUids: Array.isArray(thread.memberUids) ? thread.memberUids : [],
      ownerUid: thread.ownerUid || '',
      createdBy: thread.createdBy || '',
      canSend: getThreadParticipantUids(thread).includes(appState.user.uid),
      isPersistedThread: true,
      sendPath: 'callable:sendInboxMessage',
      payload: {
        bodyLength: body.length,
        attachmentCount: attachments.length,
        hasReply: Boolean(replyTo),
        clientMessageId
      }
    })
    await sendMessage(thread.id, {
      senderId: appState.user.uid,
      body,
      type: 'text',
      attachments,
      replyTo,
      clientMessageId,
      ...(safePageContext ? { safePageContext } : {})
    })
    appState.errorMessage = ''
    clearTypingForThread(thread.id)
    if (canMarkThreadRead(thread.id)) {
      await markThreadRead({ threadId: thread.id, uid: appState.user.uid }).catch((error) => {
        warnRealtimePermission(`participants-read-${thread.id}`, error)
      })
    }
  } catch (error) {
    debugInboxSend('send failed', {
      activeThreadId: thread.id,
      activeThreadType: thread.type || '',
      currentUserUid: appState.user.uid,
      participantUids: getThreadParticipantUids(thread),
      memberUids: Array.isArray(thread.memberUids) ? thread.memberUids : [],
      ownerUid: thread.ownerUid || '',
      createdBy: thread.createdBy || '',
      canSend: getThreadParticipantUids(thread).includes(appState.user.uid),
      isPersistedThread: true,
      sendPath: 'callable:sendInboxMessage',
      sendErrorCode: error?.code || '',
      sendErrorMessage: error?.message || ''
    })
    sendFailed = true
    setOptimisticMessageStatus(thread.id, clientMessageId, 'failed', error?.message || 'Unable to send message.')
    appState.errorMessage = getSendErrorMessage(error, thread)
  }

  if (sendFailed) {
    renderSelectedConversation({ forceBottom: true })
  }
}

function startThreadDetailSubscriptions(threadId) {
  appState.participantsUnsubscribe()
  appState.typingUnsubscribe()
  if (typingExpiryRefreshTimer) clearTimeout(typingExpiryRefreshTimer)

  appState.participantsUnsubscribe = subscribeToThreadParticipants(threadId, (participants) => {
    appState.participantsByThreadId[threadId] = participants
    participants.forEach((participant) => {
      if (!participant?.uid) return
      const existingProfile = appState.profileByUid[participant.uid] || {}
      const avatarURL = getAvatarURL(participant) || getAvatarURL(existingProfile)
      appState.profileByUid[participant.uid] = {
        ...existingProfile,
        displayName: participant.displayName || existingProfile.displayName || '',
        username: participant.username || existingProfile.username || '',
        avatarURL,
        photoURL: avatarURL
      }
    })
    hydrateProfilesForThread(getSelectedThread())
    if (appState.selectedThreadId === threadId) renderSelectedConversation({ reason: 'state-update' })
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

function startSelectedSourceThreadSubscription(threadId) {
  appState.sourceThreadUnsubscribe()
  appState.sourceThreadUnsubscribe = subscribeToThread(threadId, (sourceThread) => {
    if (!sourceThread?.id) return
    appState.threads = appState.threads.map((thread) => {
      if (thread.id !== sourceThread.id) return thread
      return {
        ...mergeSourceThreadState(thread, sourceThread),
        title: sourceThread.type === 'group'
          ? (sourceThread.title || thread.title)
          : (thread.title || sourceThread.title),
        imageURL: sourceThread.type === 'group' && Object.prototype.hasOwnProperty.call(sourceThread, 'imageURL')
          ? sourceThread.imageURL
          : (thread.imageURL || sourceThread.imageURL || ''),
        imagePath: Object.prototype.hasOwnProperty.call(sourceThread, 'imagePath') ? sourceThread.imagePath : thread.imagePath,
        otherProfile: thread.otherProfile || sourceThread.otherProfile,
        otherParticipantId: thread.otherParticipantId || sourceThread.otherParticipantId,
        dmBlockState: sourceThread.dmBlockState || null
      }
    })
    if (appState.selectedThreadId === sourceThread.id) {
      if (getDmBlockState(sourceThread).isDmBlocked) clearTypingForThread(sourceThread.id)
      renderThreadListOnly()
      renderSelectedConversation({ reason: 'state-update' })
      if (appState.isChatSettingsOpen) renderChatSettingsModal()
    }
  }, (error) => {
    warnRealtimePermission(`thread-source-${threadId}`, error)
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
  activeMessageSubscriptionThreadId = threadId
  appState.loadingMessageThreadId = threadId
  if (messageSubscriptionFallbackTimer) window.clearTimeout(messageSubscriptionFallbackTimer)
  messageSubscriptionFallbackTimer = window.setTimeout(async () => {
    if (activeMessageSubscriptionThreadId !== threadId || appState.loadingMessageThreadId !== threadId) return
    try {
      const messages = await listMessages(threadId)
      if (activeMessageSubscriptionThreadId !== threadId || appState.loadingMessageThreadId !== threadId) return
      appState.messagesByThreadId[threadId] = replaceRealtimeMessages([], messages)
      appState.messagePaginationByThreadId[threadId] = {
        loadingOlder: false,
        hasOlder: messages.length >= INITIAL_MESSAGE_LIMIT,
        loadedOlder: false
      }
      appState.loadingMessageThreadId = ''
      delete appState.preparingThreadIds[threadId]
      if (appState.selectedThreadId === threadId) {
        renderSelectedConversation({ forceBottom: true, reason: 'initial-message-fallback' })
        ensureConversationCanScrollIfPossible(threadId)
      }
    } catch (error) {
      if (activeMessageSubscriptionThreadId !== threadId || appState.loadingMessageThreadId !== threadId) return
      appState.loadingMessageThreadId = ''
      appState.errorMessage = getSendErrorMessage(error, getSelectedThread())
      renderSelectedConversation({ reason: 'message-fallback-error' })
      warnRealtimePermission(`messages-fallback-${threadId}`, error)
    }
  }, 1200)

  try {
    startThreadDetailSubscriptions(threadId)
  } catch (error) {
    warnRealtimePermission(`thread-detail-${threadId}`, error)
  }
  try {
    startSelectedSourceThreadSubscription(threadId)
  } catch (error) {
    warnRealtimePermission(`thread-source-${threadId}`, error)
  }

  try {
  appState.messageUnsubscribe = subscribeToMessages(threadId, async (messages) => {
    if (messageSubscriptionFallbackTimer) {
      window.clearTimeout(messageSubscriptionFallbackTimer)
      messageSubscriptionFallbackTimer = null
    }
    const snapshotVersion = Number(appState.messageSnapshotVersionByThreadId[threadId] || 0) + 1
    appState.messageSnapshotVersionByThreadId[threadId] = snapshotVersion
    const existing = appState.messagesByThreadId[threadId] || []
    const isInitialMessageBatch = appState.loadingMessageThreadId === threadId || !existing.length
    const shouldAutoScroll = isInitialMessageBatch
      || (appState.selectedThreadId === threadId && messageScrollController.mode === 'bottom')
    preloadMessageImages(messages).catch(() => null)
    hydrateProfilesForMessages(threadId, messages, { render: true }).catch(() => null)
    try {
    if (
      activeMessageSubscriptionThreadId !== threadId
      || appState.messageSnapshotVersionByThreadId[threadId] !== snapshotVersion
    ) return
    appState.messagesByThreadId[threadId] = replaceRealtimeMessages(existing, messages, {
      preserveLoadedHistory: appState.messagePaginationByThreadId[threadId]?.loadedOlder === true
    })
    reconcileOptimisticMessages(threadId, messages)
    appState.messagePaginationByThreadId[threadId] = {
      ...(appState.messagePaginationByThreadId[threadId] || {}),
      hasOlder: appState.messagePaginationByThreadId[threadId]?.hasOlder === false
        ? false
        : messages.length >= INITIAL_MESSAGE_LIMIT,
      loadingOlder: false,
      loadedOlder: appState.messagePaginationByThreadId[threadId]?.loadedOlder === true
    }
    appState.loadingMessageThreadId = ''
    delete appState.preparingThreadIds[threadId]
    if (appState.selectedThreadId === threadId) {
      renderSelectedConversation({
        forceBottom: shouldAutoScroll,
        reason: isInitialMessageBatch ? 'initial-messages' : 'realtime-messages'
      })
      if (isInitialMessageBatch) ensureConversationCanScrollIfPossible(threadId)
    }

    const reactionMessageIds = messages.map((message) => message.id).filter(Boolean).sort()
    const reactionSignature = reactionMessageIds.join('|')
    if (appState.reactionMessageIdsByThreadId[threadId] !== reactionSignature) {
      appState.reactionMessageIdsByThreadId[threadId] = reactionSignature
      appState.reactionUnsubscribe()
      appState.reactionUnsubscribe = subscribeToMessageReactions(threadId, reactionMessageIds, (reactionsByMessageId) => {
        appState.reactionsByThreadId[threadId] = reactionsByMessageId
        if (appState.selectedThreadId === threadId) renderSelectedConversation({ reason: 'reactions-update' })
      }, (error) => warnRealtimePermission(`reactions-${threadId}`, error))
    }
    } catch (error) {
      appState.loadingMessageThreadId = ''
      delete appState.preparingThreadIds[threadId]
      appState.errorMessage = error?.message || 'The conversation could not be rendered.'
      console.error('[inbox] realtime message render failed', error)
      if (appState.selectedThreadId === threadId) renderSelectedConversation({ reason: 'message-render-error' })
      return
    }

    await markThreadDelivered({ threadId, uid: appState.user.uid }).catch((error) => {
      warnRealtimePermission(`participants-delivered-${threadId}`, error)
    })
    if (appState.selectedThreadId === threadId) {
      if (canMarkThreadRead(threadId)) {
        await markThreadRead({ threadId, uid: appState.user.uid }).catch((error) => {
          warnRealtimePermission(`participants-read-${threadId}`, error)
        })
      }
    }
  }, (error) => {
    delete appState.preparingThreadIds[threadId]
    if (appState.selectedThreadId === threadId) {
      appState.errorMessage = getSendErrorMessage(error, getSelectedThread())
      renderSelectedConversation({ reason: 'message-subscription-error' })
    }
    warnRealtimePermission(`messages-${threadId}`, error)
  })
  } catch (error) {
    warnRealtimePermission(`messages-start-${threadId}`, error)
  }

  appState.hiddenMessagesUnsubscribe = subscribeToHiddenThreadMessages({
    threadId,
    uid: appState.user.uid,
    callback: (hiddenIds) => {
      appState.hiddenMessageIdsByThreadId[threadId] = hiddenIds
      const replyDraft = appState.replyDraftByThreadId[threadId]
      if (replyDraft?.messageId && hiddenIds.includes(replyDraft.messageId)) {
        delete appState.replyDraftByThreadId[threadId]
      }
      if (appState.selectedThreadId === threadId) renderSelectedConversation({ reason: 'state-update' })
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
  loadResonaAvatar()
  loadResonaSupportAvatar()
  loadResonaBackground()
  ensureResonaThread({ select: false }).catch(() => {})

  appState.threadUnsubscribe()
  appState.threadUnsubscribe = subscribeToInboxThreads(appState.user.uid, async (threads) => {
    const previousSelectedThreadId = appState.selectedThreadId
    await preloadThreadImages(threads)
    appState.threads = mergeThreadsWithLocalCreates(threads)
    const profilesChanged = await hydrateProfilesForThreads(threads).catch(() => false)
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
          appState.threads = mergeThreadsWithLocalCreates(repairedThreads)
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
            appState.threads = mergeThreadsWithLocalCreates(repairedThreads)
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
            appState.threads = mergeThreadsWithLocalCreates(fallbackThreads)
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

    if (
      previousSelectedThreadId
      && previousSelectedThreadId === appState.selectedThreadId
      && inboxRoot.querySelector('.inbox-layout-messages')
    ) {
      renderThreadListOnly()
      if (profilesChanged) renderSelectedConversation({ reason: 'profiles-loaded' })
    } else {
      renderSignedInState()
    }
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
      appState.threads = mergeThreadsWithLocalCreates(fallbackThreads)
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
      hydrateContentNotificationActors(items).catch(() => null)
      if (appState.activeFilter === 'System' || appState.activeFilter === 'Content') renderSignedInState()
    },
    (error) => {
      warnSystemPermission(error)
    }
  )
}

function startAccountEventsSubscription() {
  if (!appState.user?.uid) return
  appState.accountEventsUnsubscribe()
  appState.accountEventsUnsubscribe = subscribeToAccountEvents(
    appState.user.uid,
    (items) => {
      appState.accountEvents = items
      hydrateContentNotificationActors(items).catch(() => null)
      if (appState.activeFilter === 'System' || appState.activeFilter === 'Content') renderSignedInState()
    },
    (error) => {
      warnSystemPermission(error)
    },
    { limitCount: 100 }
  )
}

async function loadInboxNotificationPreferences() {
  if (!appState.user?.uid) return
  try {
    const profileResult = await getEffectiveProfile(appState.user.uid, appState.user)
    const settings = profileResult?.privateProfile?.settings || {}
    appState.notificationPreferences = normalizeNotificationPreferences(
      settings.notificationPreferences,
      settings.notifications
    )
  } catch (error) {
    console.warn('[inbox] notification preferences unavailable; defaults applied', error?.code || error?.message || error)
    appState.notificationPreferences = normalizeNotificationPreferences()
  }
}

async function loadProductGifts() {
  if (!appState.user?.uid) {
    appState.productGifts = []
    return
  }
  appState.productGiftsLoading = true
  appState.productGiftsError = ''
  try {
    appState.productGifts = await listIncomingProductGifts(appState.user.uid)
  } catch (error) {
    appState.productGifts = []
    appState.productGiftsError = error?.message || 'Product gifts are unavailable right now.'
  } finally {
    appState.productGiftsLoading = false
  }
}

async function hydrateContentNotificationActors(items = []) {
  const actorUids = Array.from(new Set(items.map((item) => item?.actorUid).filter(Boolean)))
  const missing = actorUids.filter((uid) => !hydratedProfileUids.has(uid))
  if (!missing.length) return
  const loaded = await loadProfilesByUids(missing)
  const changed = mergeHydratedProfiles(loaded)
  if (changed.length && appState.activeFilter === 'Content') renderSignedInState()
}

function startInboxPinsSubscription() {
  if (!appState.user?.uid) return
  appState.inboxPinsUnsubscribe()
  appState.inboxPinsUnsubscribe = subscribeToInboxPins(
    appState.user.uid,
    (items) => {
      appState.inboxPins = items
      if (appState.activeFilter === 'Messages') renderSidebarOnly()
      else renderSignedInState()
    },
    (error) => {
      warnSystemPermission(error)
    }
  )
}

function startBlockedUsersSubscription() {
  if (!appState.user?.uid) return
  // Private blockedUsers docs are per-account records; cross-account DM lockout comes from dmBlockState.
  appState.blockedUsersUnsubscribe()
  appState.blockedUsersUnsubscribe = subscribeToBlockedUsers(
    appState.user.uid,
    (rows) => {
      appState.blockedUsersByUid = rows.reduce((acc, row) => {
        if (row?.targetUid) acc[row.targetUid] = row
        return acc
      }, {})
      if (appState.activeFilter === 'Messages') renderSelectedConversation({ reason: 'state-update' })
    },
    (error) => {
      warnRealtimePermission(`blocked-users-${appState.user.uid}`, error)
    }
  )
}

function startAccountCallSubscriptions() {
  if (!appState.user?.uid) return
  const uid = appState.user.uid
  appState.incomingCallsUnsubscribe()
  appState.recentCallsUnsubscribe()

  appState.incomingCallsUnsubscribe = watchIncomingAccountCalls(uid, (calls) => {
    appState.incomingCalls = calls.filter((call) => call.id !== appState.activeCall?.id)
    debugAccountCall('incoming calls', appState.incomingCalls.length)
    refreshAccountCallUi()
  }, (error) => {
    warnRealtimePermission(`incoming-account-calls-${uid}`, error)
  })

  appState.recentCallsUnsubscribe = watchRecentAccountCalls(uid, (calls) => {
    appState.recentCalls = calls
    const recoverable = calls.find((call) => {
      if (isCallFinal(call.status)) return false
      return call.status !== 'ringing' || call.callerUid === uid
    })
    if (recoverable && !appState.activeCall) {
      appState.activeCall = recoverable
      appState.callUiState = recoverable.status === 'ringing' && recoverable.callerUid === uid ? 'calling' : recoverable.status
      watchActiveAccountCall(recoverable.id)
    }
    if (appState.activeFilter === 'Calls') renderSignedInState()
  }, (error) => {
    warnRealtimePermission(`recent-account-calls-${uid}`, error)
  })
}

function handleGlobalKeydown(event) {
  const inboxHasFocus = inboxRoot.contains(document.activeElement)
  if (
    (event.metaKey || event.ctrlKey)
    && event.key.toLowerCase() === 'f'
    && appState.activeFilter === 'Messages'
    && appState.selectedThreadId
    && inboxHasFocus
  ) {
    event.preventDefault()
    if (!appState.messageFind.open) handleMessageFindAction('open')
    else inboxRoot.querySelector('[data-message-find-input]')?.focus()
    return
  }
  if (event.key === 'Escape' && appState.messageFind.open) {
    event.preventDefault()
    handleMessageFindAction('close')
    return
  }
  if (event.key === 'Escape' && appState.reactionDetailModal) {
    appState.reactionDetailModal = null
    renderFloatingUi()
    return
  }
  if (event.key === 'Escape' && appState.imagePreviewModal) {
    appState.imagePreviewModal = null
    renderFloatingUi()
    return
  }
  if (event.key === 'Escape' && appState.notificationActionMenu) {
    event.preventDefault()
    closeNotificationActionMenu({ restoreFocus: true })
    return
  }
  if (event.key === 'Escape' && appState.messageContextMenu) {
    clearFloatingOverlays()
    renderFloatingUi()
    return
  }
  if (event.key === 'Escape' && appState.resonaActionMenu) {
    appState.resonaActionMenu = null
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
  if (appState.activeCall?.id && !isCallFinal(appState.activeCall.status)) {
    endAccountCall(appState.activeCall.id, 'page-left').catch(() => {})
    accountCallManager?.cleanup({ preserveState: true })
  }
})
window.addEventListener('pagehide', () => {
  if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
})
window.addEventListener('popstate', () => {
  applyInboxRoute(parseInboxRoute())
  if (appState.user) {
    renderSignedInState()
    if (appState.activeFilter === 'Mutual Users') initializeMutualUsers()
  }
})

normalizeInitialInboxRoute()
waitForInitialAuthState().then(async (user) => {
  if (!user) {
    if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
    clearRealtimeListeners()
    window.location.assign(authRoute({ redirect: `${window.location.pathname}${window.location.search}` }))
    return
  }

  appState.user = user
  await loadInboxNotificationPreferences()
  await loadProductGifts()
  renderSignedInState()
  startThreadSubscription()
  startSystemNotificationSubscription()
  startAccountEventsSubscription()
  startInboxPinsSubscription()
  startBlockedUsersSubscription()
  startAccountCallSubscriptions()
  if (appState.activeFilter === 'Mutual Users') initializeMutualUsers()
  hasInitializedAuthObserver = true

  const startUid = String(new URLSearchParams(window.location.search).get('start') || '').trim()
  if (startUid && startUid !== user.uid && processedStartUid !== `${user.uid}:${startUid}`) {
    processedStartUid = `${user.uid}:${startUid}`
    try {
      const thread = await createOrGetDm({ creatorId: user.uid, targetUid: startUid })
      if (thread?.id) {
        console.info('[inbox] create/open thread succeeded', thread.id)
        await restoreThreadForUser({ uid: user.uid, threadId: thread.id })
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
    window.location.assign(authRoute({ redirect: `${window.location.pathname}${window.location.search}` }))
    return
  }

  if (appState.user?.uid && appState.user.uid !== user.uid) {
    if (activeTypingThreadId) clearTypingForThread(activeTypingThreadId)
    clearRealtimeListeners()
  }
  appState.user = user
  await loadInboxNotificationPreferences()
  await loadProductGifts()
  applyInboxRoute(parseInboxRoute())
  renderSignedInState()
  startThreadSubscription()
  startSystemNotificationSubscription()
  startAccountEventsSubscription()
  startInboxPinsSubscription()
  startBlockedUsersSubscription()
  startAccountCallSubscriptions()
  if (appState.activeFilter === 'Mutual Users') initializeMutualUsers()
})
