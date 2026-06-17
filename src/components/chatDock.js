import {
  getThreadParticipantUids,
  loadProfilesByUids,
  markThreadRead,
  sendMessage,
  subscribeToHiddenThreadMessages,
  subscribeToInboxThreads,
  subscribeToMessages,
  subscribeToThread
} from '../data/inboxService'
import {
  endSupportThread,
  requestSupportAgent,
  sendSupportMessage,
  subscribeToSupportMessages,
  subscribeToSupportThread
} from '../data/supportThreadService'
import { getStorageAssetUrl } from '../firebase/storageAssets'

const STORAGE_KEY = 'melogic_chat_dock_state_v1'
const OPEN_EVENT = 'melogic:chat-dock-open'
const SITE_GUIDANCE_REFRESH_EVENT = 'melogic:site-guidance-refresh-context'
const MAX_DOCK_MESSAGES = 80
const RESONA_AVATAR_PATH = 'assets/profilePictures/aiSupport/resona.png'
const RESONA_BACKGROUND_PATH = 'assets/profilePictures/aiSupport/resonaBackground.png'
const DOCK_SCROLL_BOTTOM_THRESHOLD = 80
const DOCK_BOTTOM_LOCK_SETTLE_MS = 1100
const DOCK_SIZE_LIMITS = {
  minWidth: 320,
  maxWidth: 720,
  minHeight: 380,
  maxHeightRatio: 0.85
}
const DOCK_ATTACHMENT_LIMIT = 4
const DOCK_ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024
const DOCK_ATTACHMENT_MAX_LABEL = '50 MB'
const DOCK_ATTACHMENT_ACCEPT = 'image/*,audio/*,.pdf,.txt,.md'
const DOCK_ALLOWED_ATTACHMENT_EXTENSIONS = new Set(['pdf', 'txt', 'md'])

let initialized = false
let root = null
let getShellState = () => ({ authReady: false, user: null, profile: null })
let shellSnapshot = getShellState()
let unsubscribeShellState = () => {}
let hasShellStateListener = false
let unsubscribeThreads = () => {}
let unsubscribeSourceThread = () => {}
let unsubscribeMessages = () => {}
let unsubscribeHiddenMessages = () => {}
let activeThread = null
let supportThread = null
let inboxThreads = []
let messages = []
let supportMessages = []
let hiddenMessageIds = new Set()
let profileByUid = {}
let loadingThreads = false
let loadingMessages = false
let loadingSupportThread = false
let loadingSupportMessages = false
let errorMessage = ''
let sending = false
let requestingAgent = false
let endingSupport = false
let draft = ''
let draftAttachments = []
let draftAttachmentPreviewUrls = []
let attachmentNotice = ''
let lastMarkedReadKey = ''
let resonaAvatarURL = ''
let resonaAvatarRequested = false
let resonaBackgroundURL = ''
let resonaBackgroundRequested = false
let forceDockBottom = false
let activeResize = null

let dockState = {
  open: false,
  minimized: false,
  mode: 'thread',
  activeThreadId: '',
  title: '',
  ownerUid: '',
  size: null
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
      ownerUid: String(parsed.ownerUid || '').trim(),
      size: normalizeDockSize(parsed.size)
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY)
    return { ...dockState }
  }
}

function normalizeDockSize(size = null) {
  if (!size || typeof size !== 'object' || Array.isArray(size)) return null
  return {
    width: clampDockWidth(size.width),
    height: clampDockHeight(size.height)
  }
}

function clampDockWidth(value) {
  const viewportMax = Math.max(DOCK_SIZE_LIMITS.minWidth, Math.min(DOCK_SIZE_LIMITS.maxWidth, Math.floor(window.innerWidth * 0.9)))
  const width = Number(value || 0)
  if (!Number.isFinite(width) || width <= 0) return 360
  return Math.max(DOCK_SIZE_LIMITS.minWidth, Math.min(viewportMax, Math.round(width)))
}

function clampDockHeight(value) {
  const viewportMax = Math.max(DOCK_SIZE_LIMITS.minHeight, Math.floor(window.innerHeight * DOCK_SIZE_LIMITS.maxHeightRatio))
  const height = Number(value || 0)
  if (!Number.isFinite(height) || height <= 0) return 540
  return Math.max(DOCK_SIZE_LIMITS.minHeight, Math.min(viewportMax, Math.round(height)))
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

function isActivityFresh(activity = {}) {
  if (activity?.active !== true) return false
  if (!activity.expiresAt) return true
  const expires = new Date(activity.expiresAt).getTime()
  return Number.isFinite(expires) ? expires > Date.now() : true
}

function getCurrentResonaActivity() {
  const thread = dockState.mode === 'support' ? supportThread : activeThread
  const activity = thread?.resonaActivity || {}
  if (isActivityFresh(activity)) return activity
  if (dockState.mode === 'support') {
    const ai = supportThread?.typing?.ai || {}
    if (isActivityFresh(ai)) return { ...ai, state: 'thinking' }
  }
  return { active: false, label: '' }
}

function isResonaResponding() {
  return getCurrentResonaActivity().active === true
}

function currentResonaActivityLabel() {
  return getCurrentResonaActivity().label || 'Resona is responding...'
}

function formatLocalIso(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

function buildClientTimeContext() {
  const now = new Date()
  return {
    route: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    currentRoute: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    pageTitle: document.title || '',
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    clientLocalTimeISO: formatLocalIso(now),
    utcTimeISO: now.toISOString()
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

function stopThreadSubscriptions() {
  unsubscribeThreads()
  unsubscribeThreads = () => {}
  unsubscribeSourceThread()
  unsubscribeSourceThread = () => {}
  unsubscribeMessages()
  unsubscribeMessages = () => {}
  unsubscribeHiddenMessages()
  unsubscribeHiddenMessages = () => {}
  inboxThreads = []
  activeThread = null
  supportThread = null
  messages = []
  supportMessages = []
  hiddenMessageIds = new Set()
  loadingThreads = false
  loadingMessages = false
  loadingSupportThread = false
  loadingSupportMessages = false
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

function renderResonaAvatar(label = 'Resona') {
  return renderAvatar({
    displayName: 'Resona',
    username: 'Resona',
    avatarURL: resonaAvatarURL
  }, label)
}

function loadResonaAvatar() {
  if (resonaAvatarRequested) return
  resonaAvatarRequested = true
  getStorageAssetUrl(RESONA_AVATAR_PATH, {
    warnOnFail: false,
    scopeKey: 'chat-dock-resona',
    type: 'resona-avatar'
  })
    .then((url) => {
      if (!url) return
      resonaAvatarURL = url
      renderDock()
    })
    .catch(() => {})
}

function loadResonaBackground() {
  if (resonaBackgroundRequested) return
  resonaBackgroundRequested = true
  getStorageAssetUrl(RESONA_BACKGROUND_PATH, {
    warnOnFail: false,
    scopeKey: 'chat-dock-resona-background',
    type: 'resona-background'
  })
    .then((url) => {
      if (!url) return
      resonaBackgroundURL = url
      renderDock()
    })
    .catch(() => {})
}

function isResonaThread(thread = activeThread) {
  return Boolean(thread && thread.type === 'agent' && thread.agentId === 'resona')
}

function isResonaDockThread(thread = activeThread) {
  if (dockState.mode !== 'thread') return false
  if (isResonaThread(thread)) return true
  return /^resona_[A-Za-z0-9_-]+$/.test(String(dockState.activeThreadId || ''))
}

function filterMessagesAfterClear(thread = activeThread, rows = []) {
  if (!isResonaDockThread(thread) || !thread?.clearedAt) return rows
  const clearedAt = new Date(thread.clearedAt).getTime()
  if (!clearedAt || Number.isNaN(clearedAt)) return rows
  return rows.filter((message) => {
    if (message.pendingWrites) return true
    const created = new Date(message.createdAt || message.updatedAt || 0).getTime()
    return created > clearedAt
  })
}

function getThreadTitle() {
  if (!activeThread && isResonaDockThread()) return 'Resona'
  return activeThread?.title || dockState.title || 'Conversation'
}

function getThreadSubtitle() {
  if (!currentUid()) return 'Sign in to continue'
  if (loadingThreads) return 'Loading conversation...'
  if (!activeThread && isResonaDockThread()) return 'AI music support'
  if (!activeThread && dockState.activeThreadId) return 'Conversation unavailable'
  if (!activeThread) return 'No conversation selected'
  if (isResonaThread(activeThread)) return 'AI music support'
  if (activeThread.type === 'group') {
    return `${Math.max(1, Number(activeThread.participantCount || getThreadParticipantUids(activeThread).length || 0))} members`
  }
  return 'Direct message'
}

function supportStatusLabel(thread = {}) {
  const status = String(thread?.status || 'open').trim()
  if (status === 'assigned') return thread?.assignedAgentUid ? 'Live agent assigned' : 'Waiting for live agent'
  const labels = {
    open: 'Resona active',
    ai_active: 'Resona active',
    waiting_for_agent: 'Waiting for live agent',
    resolved: 'Resolved'
  }
  return labels[status] || 'Resona active'
}

function hasAssignedSupportAgent() {
  return Boolean(supportThread?.assignedAgentUid)
}

function canRequestSupportAgent() {
  if (!supportThread || supportThread.status === 'resolved') return false
  return !(supportThread.status === 'assigned' && hasAssignedSupportAgent())
}

function isResonaTyping() {
  if (dockState.mode === 'support' && (!supportThread || supportThread.status === 'resolved' || supportThread.assignedAgentUid)) return false
  return isResonaResponding()
}

function resonaTypingLabel() {
  return currentResonaActivityLabel()
}

function getSupportTitle() {
  if (supportThread?.assignedAgentUid) return 'Melogic Support'
  return 'Resona'
}

function getSupportSubtitle() {
  if (!currentUid()) return 'Sign in to continue'
  if (loadingSupportThread) return 'Loading support...'
  if (!supportThread && dockState.activeThreadId) return 'Support thread unavailable'
  if (!supportThread) return 'Open a support chat'
  return supportStatusLabel(supportThread)
}

function renderSupportPanel() {
  if (!currentUid()) {
    return `
      <section class="chat-dock-placeholder">
        <h3>Sign in required</h3>
        <p>Support chat stays attached to your Melogic account.</p>
      </section>
    `
  }
  if (errorMessage) {
    return `
      <section class="chat-dock-placeholder is-error">
        <h3>Could not load support</h3>
        <p>${escapeHtml(errorMessage)}</p>
      </section>
    `
  }
  if (loadingSupportThread || loadingSupportMessages) {
    return `
      <section class="chat-dock-placeholder">
        <div class="chat-dock-loader" aria-hidden="true"></div>
        <h3>Loading support...</h3>
      </section>
    `
  }
  if (!supportThread) {
    return `
      <section class="chat-dock-placeholder">
        <h3>Support thread unavailable</h3>
        <p>Start a support chat from Support or Inbox.</p>
      </section>
    `
  }

  const visibleMessages = supportMessages.slice(-MAX_DOCK_MESSAGES)
  if (!visibleMessages.length) {
    return `
      <section class="chat-dock-placeholder">
        <h3>Support chat is ready.</h3>
        <p>Send a message and Resona will help or route you to Melogic Support.</p>
        ${canRequestSupportAgent() ? `<button type="button" class="chat-dock-support-link" data-chat-dock-request-agent ${requestingAgent ? 'disabled' : ''}>${requestingAgent ? 'Requesting...' : 'Talk to a person'}</button>` : ''}
      </section>
    `
  }

  return `
    ${canRequestSupportAgent() ? `
      <div class="chat-dock-support-banner">
        <span>${escapeHtml(supportStatusLabel(supportThread))}</span>
        <button type="button" data-chat-dock-request-agent ${requestingAgent ? 'disabled' : ''}>${requestingAgent ? 'Requesting...' : 'Talk to a person'}</button>
      </div>
    ` : ''}
    ${visibleMessages.map((message) => {
      if (message.senderType === 'system' || message.senderType === 'system_ai') {
        return `
          <article class="chat-dock-message is-system" data-message-render-key="support:${escapeHtml(message.id || '')}">
            <div class="chat-dock-bubble">${renderMessageBody(message)}</div>
            <time>${escapeHtml(getMessageTime(message.createdAt))}</time>
          </article>
        `
      }
      const isMine = message.senderUid === currentUid()
      const isAi = message.senderType === 'ai'
      const sender = isAi
        ? { displayName: 'Resona', username: 'AI', avatarURL: resonaAvatarURL }
        : message.senderType === 'agent'
        ? { displayName: 'Melogic Support', username: '', avatarURL: '' }
        : senderMeta(message.senderUid)
      return `
        <article class="chat-dock-message ${isMine ? 'is-mine' : 'is-theirs'} ${isAi ? 'is-ai' : ''} ${message.pendingWrites ? 'is-pending' : ''}" data-message-render-key="support:${escapeHtml(message.id || '')}">
          ${isMine ? '' : renderAvatar(sender, sender.displayName)}
          <div class="chat-dock-message-stack">
            ${isMine ? '' : `<strong>${escapeHtml(sender.displayName)}${isAi ? '<span class="chat-dock-ai-label">AI</span>' : ''}</strong>`}
            <div class="chat-dock-bubble">${renderMessageBody(message)}</div>
            <time>${escapeHtml(getMessageTime(message.createdAt))}</time>
          </div>
        </article>
      `
    }).join('')}
    ${isResonaTyping() ? renderResonaTypingIndicator() : ''}
  `
}

function renderMessageBody(message = {}) {
  if (message.deleted) return '<em>Message removed</em>'
  const text = escapeHtml(dockMessageBody(message))
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
          if (mime.startsWith('audio/') && url) {
            return `<figure class="chat-dock-audio-attachment"><figcaption>${name}</figcaption><audio controls preload="metadata" src="${url}"></audio></figure>`
          }
          if (mime.startsWith('video/') && url) {
            return `<video class="chat-dock-video-attachment" controls preload="metadata" src="${url}"></video>`
          }
          return url
            ? `<a href="${url}" target="_blank" rel="noopener" class="chat-dock-file-attachment"><span>${attachmentKindLabel(attachment)}</span><strong>${name}</strong></a>`
            : `<span class="chat-dock-file-attachment"><span>${attachmentKindLabel(attachment)}</span><strong>${name}</strong></span>`
        }).join('')}
      </div>
    `
    : ''
  return `${text ? `<p>${text}</p>` : ''}${attachmentMarkup}`
}

function attachmentKindLabel(attachment = {}) {
  const mime = String(attachment.mimeType || '').toLowerCase()
  const name = String(attachment.name || '').toLowerCase()
  if (mime.includes('pdf') || name.endsWith('.pdf')) return 'PDF'
  if (mime.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) return 'TXT'
  if (mime.startsWith('audio/')) return 'AUDIO'
  if (mime.startsWith('video/')) return 'VIDEO'
  return 'FILE'
}

function isDockAttachmentAllowed(file) {
  const mime = String(file?.type || '').toLowerCase()
  const ext = String(file?.name || '').split('.').pop().toLowerCase()
  return mime.startsWith('image/') || mime.startsWith('audio/') || DOCK_ALLOWED_ATTACHMENT_EXTENSIONS.has(ext)
}

function revokeDraftAttachmentPreviews() {
  draftAttachmentPreviewUrls.forEach((url) => URL.revokeObjectURL(url))
  draftAttachmentPreviewUrls = []
}

function setDraftAttachments(nextAttachments = []) {
  revokeDraftAttachmentPreviews()
  draftAttachments = nextAttachments.slice(0, DOCK_ATTACHMENT_LIMIT)
  draftAttachmentPreviewUrls = draftAttachments.map((file) => (
    file instanceof File && String(file.type || '').startsWith('image/') ? URL.createObjectURL(file) : ''
  ))
  attachmentNotice = ''
}

function resetDraftAttachments() {
  setDraftAttachments([])
}

function renderDraftAttachmentPreview() {
  if (!draftAttachments.length) return ''
  return `
    <div class="chat-dock-attachment-preview-strip">
      ${draftAttachments.map((file, index) => {
        const name = escapeHtml(file.name || 'Attachment')
        const previewUrl = draftAttachmentPreviewUrls[index] || ''
        const typeLabel = escapeHtml(attachmentKindLabel({ name: file.name, mimeType: file.type }))
        if (previewUrl) {
          return `<article class="chat-dock-attachment-preview is-image" title="${name}"><img src="${escapeHtml(previewUrl)}" alt="${name}" /><small>${name}</small><button type="button" data-chat-dock-remove-attachment="${index}" aria-label="Remove ${name}">×</button></article>`
        }
        return `<article class="chat-dock-attachment-preview is-file" title="${name}"><div>${typeLabel}</div><small>${name}</small><button type="button" data-chat-dock-remove-attachment="${index}" aria-label="Remove ${name}">×</button></article>`
      }).join('')}
    </div>
  `
}

function addDraftAttachments(fileList = []) {
  const incoming = Array.from(fileList || [])
  if (!incoming.length) return
  const accepted = []
  let rejectedReason = ''
  incoming.forEach((file) => {
    if (!(file instanceof File)) return
    if (draftAttachments.length + accepted.length >= DOCK_ATTACHMENT_LIMIT) {
      rejectedReason = `You can attach up to ${DOCK_ATTACHMENT_LIMIT} files.`
      return
    }
    if (Number(file.size || 0) > DOCK_ATTACHMENT_MAX_BYTES) {
      rejectedReason = `Attachment is too large. Maximum size is ${DOCK_ATTACHMENT_MAX_LABEL}.`
      return
    }
    if (!isDockAttachmentAllowed(file)) {
      rejectedReason = 'That file type is not supported in the dock yet.'
      return
    }
    accepted.push(file)
  })
  if (accepted.length) {
    setDraftAttachments([...draftAttachments, ...accepted])
  }
  attachmentNotice = rejectedReason
  renderDock()
}

function dockMessageBody(message = {}) {
  const body = String(message.body || '')
  if (dockState.mode !== 'support') return body
  return body
    .replace(/Melogic AI Support/g, 'Resona')
    .replace(/AI support joined the chat\./g, 'Resona joined the chat.')
    .replace(/AI support routed this to a live agent\./g, 'Resona routed this to a live agent.')
    .replace(/AI support/g, 'Resona')
}

function renderResonaTypingIndicator() {
  return `
    <article class="chat-dock-message is-theirs is-ai is-typing" data-message-render-key="support-typing-resona">
      ${renderResonaAvatar('Resona')}
      <div class="chat-dock-message-stack">
        <strong>Resona<span class="chat-dock-ai-label">AI</span></strong>
        <div class="chat-dock-bubble chat-dock-typing-bubble">
          <span>${escapeHtml(resonaTypingLabel())}</span>
          <i></i><i></i><i></i>
        </div>
      </div>
    </article>
  `
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

  const visibleMessages = filterMessagesAfterClear(activeThread, messages)
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

  const messageMarkup = visibleMessages.map((message) => {
    if (message.senderType === 'system') {
      if (/^Resona joined the chat\.?$/i.test(String(message.body || '').trim())) return ''
      return `
        <article class="chat-dock-message is-system-service" data-message-render-key="thread-system:${escapeHtml(message.id || '')}">
          <div class="chat-dock-service-pill">${escapeHtml(message.body || 'System update')}</div>
        </article>
      `
    }
    const isMine = message.senderId === currentUid()
    const isResonaAi = message.senderType === 'ai' && message.agentId === 'resona'
    const sender = isResonaAi
      ? { displayName: 'Resona', username: 'AI', avatarURL: resonaAvatarURL }
      : senderMeta(message.senderId)
    return `
      <article class="chat-dock-message ${isMine ? 'is-mine' : 'is-theirs'} ${isResonaAi ? 'is-ai' : ''} ${message.pendingWrites ? 'is-pending' : ''}" data-message-render-key="thread:${escapeHtml(message.id || '')}">
        ${isMine ? '' : (isResonaAi ? renderResonaAvatar('Resona') : renderAvatar(sender, sender.displayName))}
        <div class="chat-dock-message-stack">
          ${isMine ? '' : `<strong>${escapeHtml(sender.displayName)}${isResonaAi ? '<span class="chat-dock-ai-label">AI</span>' : ''}</strong>`}
          <div class="chat-dock-bubble">${renderMessageBody(message)}</div>
          <time>${escapeHtml(getMessageTime(message.createdAt))}</time>
        </div>
      </article>
    `
  }).join('')
  return `${messageMarkup}${isResonaTyping() ? renderResonaTypingIndicator() : ''}`
}

function renderComposer() {
  const isSupport = dockState.mode === 'support'
  const resonaLocked = isResonaResponding()
  const disabled = isSupport
    ? (!currentUid() || !supportThread || supportThread.status === 'resolved' || loadingSupportThread || sending || Boolean(errorMessage) || resonaLocked)
    : (!currentUid() || !activeThread || loadingThreads || sending || Boolean(errorMessage) || resonaLocked)
  const attachmentsSupported = !isSupport
  const canSend = Boolean(draft.trim() || draftAttachments.length)
  const placeholder = isSupport
    ? supportThread?.status === 'resolved' ? 'Support thread resolved' : 'Message Melogic Support...'
    : 'Write a message...'
  const finalPlaceholder = resonaLocked ? 'Resona is responding...' : placeholder
  return `
    <form class="chat-dock-composer ${resonaLocked ? 'is-resona-locked' : ''}" data-chat-dock-form>
      ${renderDraftAttachmentPreview()}
      ${attachmentNotice ? `<p class="chat-dock-attachment-notice">${escapeHtml(attachmentNotice)}</p>` : ''}
      <div class="chat-dock-composer-row">
        <label class="sr-only" for="chat-dock-input">Message</label>
        <textarea id="chat-dock-input" data-chat-dock-input rows="1" maxlength="1200" placeholder="${disabled && !resonaLocked ? 'Chat unavailable' : finalPlaceholder}" ${disabled ? 'disabled' : ''}>${escapeHtml(draft)}</textarea>
        <input class="chat-dock-file-input" type="file" data-chat-dock-file-input multiple accept="${DOCK_ATTACHMENT_ACCEPT}" ${disabled || !attachmentsSupported ? 'disabled' : ''} />
        <button type="button" class="chat-dock-attach-button" data-chat-dock-attach aria-label="Add attachment" title="${attachmentsSupported ? 'Add attachment' : 'Attachments are available in Inbox conversations'}" ${disabled || !attachmentsSupported ? 'disabled' : ''}>+</button>
        <button type="submit" class="chat-dock-send-button" aria-label="Send message" ${disabled || !canSend ? 'disabled' : ''}>Send</button>
      </div>
    </form>
  `
}

function renderMinimized() {
  return `
    <button type="button" class="chat-dock-minimized" data-chat-dock-restore aria-label="Restore ${escapeHtml(getThreadTitle())}">
      <span>${escapeHtml(dockState.mode === 'support' ? getSupportTitle() : getThreadTitle())}</span>
      <small>${escapeHtml(dockState.mode === 'support' ? getSupportSubtitle() : 'Open chat')}</small>
    </button>
  `
}

function renderSupportHeaderActions() {
  if (dockState.mode !== 'support') return ''
  const canEnd = Boolean(supportThread?.id || dockState.activeThreadId) && supportThread?.status !== 'resolved' && !endingSupport
  return `
    <div class="chat-dock-support-actions" aria-label="Support chat actions">
      <button type="button" class="chat-dock-header-action is-danger" data-chat-dock-end-support ${canEnd ? '' : 'disabled'}>
        ${endingSupport ? 'Ending...' : 'End Chat'}
      </button>
      <button type="button" class="chat-dock-header-action is-muted" data-site-guidance-start data-site-guidance-thread-id="${escapeHtml(dockState.activeThreadId)}" data-site-guidance-thread-kind="support" data-site-guidance-viewer="resona" ${supportThread?.status === 'resolved' ? 'disabled' : ''} title="Share this Melogic page only.">Share Screen</button>
    </div>
  `
}

function renderThreadHeaderActions() {
  if (!isResonaDockThread() || dockState.mode === 'support') return ''
  const contextType = activeThread?.contextType || ''
  const contextId = activeThread?.contextId || ''
  const contextLabel = activeThread?.contextLabel || activeThread?.title || ''
  return `
    <div class="chat-dock-support-actions" aria-label="Resona chat actions">
      <button type="button" class="chat-dock-header-action is-muted" data-site-guidance-start data-site-guidance-thread-id="${escapeHtml(dockState.activeThreadId)}" data-site-guidance-thread-kind="thread" data-site-guidance-viewer="resona" data-site-guidance-context-type="${escapeHtml(contextType)}" data-site-guidance-context-id="${escapeHtml(contextId)}" data-site-guidance-context-label="${escapeHtml(contextLabel)}" title="Share this Melogic page only.">Share Screen</button>
    </div>
  `
}

function dockPanelStyle() {
  const size = normalizeDockSize(dockState.size)
  const parts = []
  if (size) {
    parts.push(`--chat-dock-width:${size.width}px`)
    parts.push(`--chat-dock-height:${size.height}px`)
  }
  if (isResonaDockThread() && resonaBackgroundURL) parts.push(`--resona-chat-background:url('${escapeHtml(resonaBackgroundURL)}')`)
  return parts.length ? ` style="${parts.join('; ')};"` : ''
}

function renderResizeHandles() {
  return `
    <span class="chat-dock-resize-handle is-top" data-chat-dock-resize="top" aria-hidden="true"></span>
    <span class="chat-dock-resize-handle is-left" data-chat-dock-resize="left" aria-hidden="true"></span>
    <span class="chat-dock-resize-handle is-corner" data-chat-dock-resize="top-left" aria-hidden="true"></span>
  `
}

function getDockScroller() {
  return root?.querySelector('[data-chat-dock-messages]') || null
}

function isDockNearBottom(scroller = getDockScroller()) {
  if (!scroller) return true
  return scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= DOCK_SCROLL_BOTTOM_THRESHOLD
}

const dockScrollController = {
  scroller: null,
  threadKey: '',
  bottomLocked: true,
  lastScrollHeight: 0,
  lastScrollTop: 0,
  isProgrammaticScroll: false,
  rafId: 0,
  releaseRafId: 0,
  settleTimer: 0,
  lockUntil: 0,
  resizeObserver: null,
  mutationObserver: null,
  onScroll: null,
  onWheel: null,
  onTouchStart: null,
  onTouchMove: null,
  onMediaSettled: null,
  touchStartY: 0,

  attach(scroller, { threadKey = `${dockState.mode}:${dockState.activeThreadId}`, resetMode = false } = {}) {
    if (!scroller) {
      this.detach()
      return
    }
    const isNewScroller = this.scroller !== scroller
    const isNewThread = this.threadKey !== threadKey
    if (isNewScroller) this.detach()
    this.scroller = scroller
    this.threadKey = threadKey || ''
    if (resetMode || isNewThread) this.bottomLocked = true
    this.lastScrollHeight = scroller.scrollHeight
    this.lastScrollTop = scroller.scrollTop
    if (!isNewScroller) return

    this.onScroll = () => {
      if (this.isProgrammaticScroll || this.scroller !== scroller) return
      if (isDockNearBottom(scroller)) this.bottomLocked = true
      else if (scroller.scrollTop < this.lastScrollTop) this.bottomLocked = false
      this.lastScrollTop = scroller.scrollTop
      this.lastScrollHeight = scroller.scrollHeight
    }
    this.onWheel = (event) => {
      if (event.deltaY < 0 && this.scroller === scroller && !isDockNearBottom(scroller)) this.bottomLocked = false
      if (event.deltaY > 0 && this.scroller === scroller && isDockNearBottom(scroller)) this.bottomLocked = true
    }
    this.onTouchStart = (event) => {
      this.touchStartY = Number(event.touches?.[0]?.clientY || 0)
    }
    this.onTouchMove = (event) => {
      if (this.scroller !== scroller) return
      const nextY = Number(event.touches?.[0]?.clientY || 0)
      if (nextY > this.touchStartY + 2 && !isDockNearBottom(scroller)) this.bottomLocked = false
      if (nextY < this.touchStartY - 2 && isDockNearBottom(scroller)) this.bottomLocked = true
      this.touchStartY = nextY
    }
    this.onMediaSettled = (event) => {
      const media = event.target
      if (!(media instanceof HTMLImageElement || media instanceof HTMLVideoElement)) return
      this.stabilizeMedia(media)
    }
    scroller.addEventListener('scroll', this.onScroll, { passive: true })
    scroller.addEventListener('wheel', this.onWheel, { passive: true })
    scroller.addEventListener('touchstart', this.onTouchStart, { passive: true })
    scroller.addEventListener('touchmove', this.onTouchMove, { passive: true })
    scroller.addEventListener('load', this.onMediaSettled, true)
    scroller.addEventListener('loadedmetadata', this.onMediaSettled, true)
    scroller.addEventListener('error', this.onMediaSettled, true)
    if ('ResizeObserver' in window) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.bottomLocked) this.forceBottomFor(DOCK_BOTTOM_LOCK_SETTLE_MS, 'dock-resize')
      })
      this.resizeObserver.observe(scroller)
      const panel = root?.querySelector('.chat-dock-panel')
      const composer = root?.querySelector('[data-chat-dock-form]')
      if (panel) this.resizeObserver.observe(panel)
      if (composer) this.resizeObserver.observe(composer)
    }
    if ('MutationObserver' in window) {
      this.mutationObserver = new MutationObserver(() => {
        if (this.bottomLocked) this.forceBottomFor(420, 'dock-mutation')
      })
      this.mutationObserver.observe(scroller, { childList: true, subtree: true, attributes: true })
    }
  },

  detach() {
    if (this.rafId) cancelAnimationFrame(this.rafId)
    if (this.releaseRafId) cancelAnimationFrame(this.releaseRafId)
    if (this.settleTimer) window.clearTimeout(this.settleTimer)
    if (this.resizeObserver) this.resizeObserver.disconnect()
    if (this.mutationObserver) this.mutationObserver.disconnect()
    if (this.scroller && this.onScroll) this.scroller.removeEventListener('scroll', this.onScroll)
    if (this.scroller && this.onWheel) this.scroller.removeEventListener('wheel', this.onWheel)
    if (this.scroller && this.onTouchStart) this.scroller.removeEventListener('touchstart', this.onTouchStart)
    if (this.scroller && this.onTouchMove) this.scroller.removeEventListener('touchmove', this.onTouchMove)
    if (this.scroller && this.onMediaSettled) {
      this.scroller.removeEventListener('load', this.onMediaSettled, true)
      this.scroller.removeEventListener('loadedmetadata', this.onMediaSettled, true)
      this.scroller.removeEventListener('error', this.onMediaSettled, true)
    }
    this.scroller = null
    this.threadKey = ''
    this.isProgrammaticScroll = false
    this.lockUntil = 0
    this.rafId = 0
    this.releaseRafId = 0
    this.settleTimer = 0
    this.resizeObserver = null
    this.mutationObserver = null
    this.onScroll = null
    this.onWheel = null
    this.onTouchStart = null
    this.onTouchMove = null
    this.onMediaSettled = null
  },

  setScrollTop(nextTop) {
    const scroller = this.scroller
    if (!scroller) return
    this.isProgrammaticScroll = true
    scroller.scrollTop = Math.max(0, nextTop)
    this.lastScrollTop = scroller.scrollTop
    this.lastScrollHeight = scroller.scrollHeight
    if (this.releaseRafId) cancelAnimationFrame(this.releaseRafId)
    this.releaseRafId = requestAnimationFrame(() => {
      this.releaseRafId = 0
      this.isProgrammaticScroll = false
    })
  },

  scheduleBottom({ force = false, reason = 'dock-bottom' } = {}) {
    this.forceBottomFor(force ? DOCK_BOTTOM_LOCK_SETTLE_MS : 180, reason, { force })
  },

  forceBottom(reason = 'dock-bottom') {
    const scroller = this.scroller
    if (!scroller) return
    this.setScrollTop(Math.max(0, scroller.scrollHeight - scroller.clientHeight + 4))
    this.bottomLocked = true
    this.lastScrollHeight = scroller.scrollHeight
  },

  forceBottomFor(durationMs = DOCK_BOTTOM_LOCK_SETTLE_MS, reason = 'dock-bottom', { force = false } = {}) {
    if (!this.scroller || (!force && !this.bottomLocked)) return
    if (force) this.bottomLocked = true
    this.lockUntil = Math.max(this.lockUntil || 0, Date.now() + Math.max(80, Number(durationMs || 0)))
    if (this.rafId) return
    const tick = () => {
      this.rafId = 0
      if (!this.scroller || (!force && !this.bottomLocked)) return
      this.forceBottom(reason)
      if (Date.now() < this.lockUntil) {
        this.rafId = requestAnimationFrame(tick)
        return
      }
      this.lockUntil = 0
    }
    tick()
  },

  snapshot() {
    const scroller = this.scroller || getDockScroller()
    return {
      bottomLocked: this.bottomLocked || isDockNearBottom(scroller),
      threadKey: `${dockState.mode}:${dockState.activeThreadId}`,
      scrollTop: scroller?.scrollTop || 0,
      scrollHeight: scroller?.scrollHeight || 0
    }
  },

  stabilizeAfterRender(snapshot = {}, { forceBottom = false, reason = 'dock-render' } = {}) {
    const scroller = this.scroller
    if (!scroller) return
    if (forceBottom || snapshot.bottomLocked) {
      this.bottomLocked = true
      this.forceBottomFor(DOCK_BOTTOM_LOCK_SETTLE_MS, reason, { force: true })
      return
    }
    this.bottomLocked = false
    this.setScrollTop(Math.min(Number(snapshot.scrollTop || 0), scroller.scrollHeight))
  },

  stabilizeMedia(media) {
    const scroller = this.scroller
    if (!scroller) return
    const heightDelta = scroller.scrollHeight - this.lastScrollHeight
    if (this.bottomLocked) {
      this.forceBottomFor(600, 'dock-media-settled', { force: true })
    } else if (heightDelta && media.getBoundingClientRect().top < scroller.getBoundingClientRect().top) {
      this.setScrollTop(scroller.scrollTop + heightDelta)
    }
    this.lastScrollHeight = scroller.scrollHeight
    this.lastScrollTop = scroller.scrollTop
  }
}

function captureComposerFocus() {
  const input = root?.querySelector('[data-chat-dock-input]')
  if (!input || document.activeElement !== input) return null
  return {
    value: input.value,
    selectionStart: input.selectionStart,
    selectionEnd: input.selectionEnd
  }
}

function restoreComposerFocus(snapshot = null) {
  if (!snapshot) return
  window.requestAnimationFrame(() => {
    const input = root?.querySelector('[data-chat-dock-input]')
    if (!input || input.disabled) return
    if (input.value !== snapshot.value) input.value = snapshot.value
    input.focus({ preventScroll: true })
    try {
      const start = Number.isFinite(snapshot.selectionStart) ? snapshot.selectionStart : input.value.length
      const end = Number.isFinite(snapshot.selectionEnd) ? snapshot.selectionEnd : start
      input.setSelectionRange(start, end)
    } catch {
      // Some input states do not expose selection ranges.
    }
  })
}

function renderDock() {
  if (!root) return
  const scrollSnapshot = dockScrollController.snapshot()
  const previousThreadKey = dockScrollController.threadKey
  const focusSnapshot = captureComposerFocus()
  if (!dockState.open) {
    dockScrollController.detach()
    root.innerHTML = ''
    root.hidden = true
    return
  }

  root.hidden = false
  if (dockState.minimized) {
    dockScrollController.detach()
    root.innerHTML = renderMinimized()
    return
  }

  const title = dockState.mode === 'support' ? getSupportTitle() : getThreadTitle()
  const subtitle = dockState.mode === 'support' ? getSupportSubtitle() : getThreadSubtitle()
  const isResonaDock = dockState.mode === 'support' || isResonaDockThread()
  const headerAvatar = isResonaDock
    ? renderResonaAvatar(title)
    : renderAvatar(activeThread || { title }, title)

  root.innerHTML = `
    <section class="chat-dock-panel ${isResonaDockThread() ? 'is-resona-chat' : ''}" role="dialog" aria-label="${escapeHtml(title)} chat dock" aria-live="polite"${dockPanelStyle()}>
      ${renderResizeHandles()}
      <header class="chat-dock-header">
        ${headerAvatar}
        <div class="chat-dock-title">
          <h2>${escapeHtml(title)}</h2>
          <p>${escapeHtml(subtitle)}</p>
        </div>
        ${renderSupportHeaderActions()}
        ${renderThreadHeaderActions()}
        <button type="button" data-chat-dock-minimize aria-label="Minimize chat">–</button>
        <button type="button" data-chat-dock-close aria-label="Close chat">×</button>
      </header>
      <div class="chat-dock-messages" data-chat-dock-messages>
        ${dockState.mode === 'support' ? renderSupportPanel() : renderMessageList()}
        <div class="chat-dock-bottom-sentinel" data-chat-dock-bottom-sentinel aria-hidden="true"></div>
      </div>
      ${renderComposer()}
    </section>
  `
  const nextThreadKey = `${dockState.mode}:${dockState.activeThreadId}`
  dockScrollController.attach(getDockScroller(), {
    threadKey: nextThreadKey,
    resetMode: !previousThreadKey || previousThreadKey !== nextThreadKey
  })
  dockScrollController.stabilizeAfterRender(scrollSnapshot, {
    reason: 'dock-render',
    forceBottom: forceDockBottom || !previousThreadKey || previousThreadKey !== nextThreadKey
  })
  forceDockBottom = false
  restoreComposerFocus(focusSnapshot)
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
    ...(Array.isArray(supportThread?.participantUids) ? supportThread.participantUids : []),
    supportThread?.requesterUid,
    supportThread?.assignedAgentUid,
    ...messages.map((message) => message.senderId),
    ...supportMessages.map((message) => message.senderUid)
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

function syncSupportSubscriptions() {
  const uid = currentUid()
  if (!dockState.open || dockState.mode !== 'support' || !dockState.activeThreadId || !uid) {
    stopThreadSubscriptions()
    renderDock()
    return
  }

  loadingSupportThread = true
  loadingSupportMessages = true
  errorMessage = ''
  renderDock()

  unsubscribeThreads()
  unsubscribeSourceThread()
  unsubscribeMessages()
  unsubscribeHiddenMessages()
  unsubscribeSourceThread = () => {}
  unsubscribeThreads = () => {}
  unsubscribeMessages = () => {}
  unsubscribeHiddenMessages = () => {}
  inboxThreads = []
  activeThread = null
  messages = []
  hiddenMessageIds = new Set()

  unsubscribeThreads = subscribeToSupportThread(dockState.activeThreadId, (thread) => {
    supportThread = thread
    loadingSupportThread = false
    if (supportThread) {
      errorMessage = ''
      dockState.title = supportThread.subject || dockState.title
      persistState()
    } else {
      errorMessage = 'You do not have access to this support thread.'
    }
    renderDock()
  }, (error) => {
    loadingSupportThread = false
    errorMessage = error?.message || 'Support thread could not be loaded.'
    renderDock()
  })

  unsubscribeMessages = subscribeToSupportMessages(dockState.activeThreadId, (nextMessages) => {
    const hadMessages = supportMessages.length > 0
    const previousLastId = supportMessages.at(-1)?.id || ''
    const nextLastId = nextMessages.at(-1)?.id || ''
    const shouldAutoScroll = !hadMessages || (nextLastId && nextLastId !== previousLastId && dockScrollController.bottomLocked)
    supportMessages = nextMessages
    if (shouldAutoScroll) forceDockBottom = true
    loadingSupportMessages = false
    hydrateProfilesForDock()
    renderDock()
  }, (error) => {
    loadingSupportMessages = false
    errorMessage = error?.message || 'Support messages could not be loaded.'
    renderDock()
  })
}

function syncThreadSubscriptions() {
  const uid = currentUid()
  if (dockState.mode === 'support') {
    syncSupportSubscriptions()
    return
  }
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
      unsubscribeSourceThread()
      unsubscribeSourceThread = () => {}
      errorMessage = ''
      dockState.title = activeThread.title || dockState.title
      persistState()
      hydrateProfilesForDock()
    } else if (isResonaDockThread()) {
      activeThread = {
        id: dockState.activeThreadId,
        type: 'agent',
        agentId: 'resona',
        title: dockState.title || 'Resona',
        participantIds: uid ? [uid] : [],
        participantUids: uid ? [uid] : []
      }
      errorMessage = ''
      unsubscribeSourceThread()
      unsubscribeSourceThread = subscribeToThread(dockState.activeThreadId, (thread) => {
        if (thread) {
          activeThread = thread
          dockState.title = thread.title || dockState.title
          persistState()
          hydrateProfilesForDock()
        } else {
          activeThread = null
          errorMessage = 'You do not have access to this conversation.'
        }
        renderDock()
      }, (error) => {
        activeThread = null
        errorMessage = error?.message || 'Conversation could not be loaded.'
        renderDock()
      })
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
    const hadMessages = messages.length > 0
    const previousLastId = messages.at(-1)?.id || ''
    const nextLastId = nextMessages.at(-1)?.id || ''
    const shouldAutoScroll = !hadMessages || (nextLastId && nextLastId !== previousLastId && dockScrollController.bottomLocked)
    messages = nextMessages
    if (shouldAutoScroll) forceDockBottom = true
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
  const previousMode = dockState.mode
  const previousThreadId = dockState.activeThreadId
  const wasOpen = dockState.open === true
  dockState = {
    ...dockState,
    ...next,
    ownerUid: currentUid() || dockState.ownerUid || ''
  }
  if (previousMode !== dockState.mode || previousThreadId !== dockState.activeThreadId || (!wasOpen && dockState.open)) {
    draft = ''
    resetDraftAttachments()
    sending = false
    requestingAgent = false
    endingSupport = false
    forceDockBottom = true
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
    activeThreadId: threadId,
    title: String(detail.title || detail.threadTitle || (support ? 'Resona' : '')).trim().slice(0, 160)
  })
  focusComposer()
}

export function closeChatDock() {
  if (!initialized) initChatDock()
  setDockState({ open: false, minimized: false, activeThreadId: '', title: '', mode: 'thread' })
}

export function getChatDockState() {
  if (!initialized) dockState = readStoredState()
  return { ...dockState }
}

async function handleSubmit(form) {
  const uid = currentUid()
  const threadId = dockState.activeThreadId
  const body = draft.trim()
  const attachments = dockState.mode === 'support' ? [] : draftAttachments.slice()
  if (!uid || !threadId || (!body && !attachments.length) || sending || isResonaResponding()) return
  sending = true
  errorMessage = ''
  forceDockBottom = true
  console.info('[dock-scroll] send -> force bottom', { mode: dockState.mode, threadId })
  renderDock()
  try {
    const safePageContext = await refreshSiteGuidanceContextForOutgoingMessage()
    if (dockState.mode === 'support') {
      await sendSupportMessage({
        threadId,
        body,
        safePageContext
      })
    } else {
      await sendMessage(threadId, {
        senderId: uid,
        body,
        type: 'text',
        attachments,
        clientMessageId: createClientMessageId(),
        safePageContext
      })
      await markThreadRead({ threadId, uid }).catch(() => {})
    }
    draft = ''
    resetDraftAttachments()
    forceDockBottom = true
    const input = form?.querySelector('[data-chat-dock-input]')
    if (input) input.value = ''
  } catch (error) {
    errorMessage = error?.message || 'Unable to send message.'
  }
  sending = false
  renderDock()
  focusComposer()
}

function bindRootEvents() {
  root.addEventListener('pointerdown', (event) => {
    const handle = event.target.closest('[data-chat-dock-resize]')
    if (!handle || window.matchMedia('(max-width: 720px)').matches) return
    const panel = root.querySelector('.chat-dock-panel')
    if (!panel) return
    event.preventDefault()
    const rect = panel.getBoundingClientRect()
    activeResize = {
      edge: handle.getAttribute('data-chat-dock-resize') || '',
      startX: event.clientX,
      startY: event.clientY,
      startWidth: rect.width,
      startHeight: rect.height
    }
    document.body.classList.add('chat-dock-is-resizing')
    window.addEventListener('pointermove', handleDockResizeMove)
    window.addEventListener('pointerup', finishDockResize, { once: true })
    window.addEventListener('pointercancel', finishDockResize, { once: true })
  })

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
      return
    }
    const endSupport = event.target.closest('[data-chat-dock-end-support]')
    if (endSupport) {
      event.preventDefault()
      const threadId = dockState.activeThreadId
      if (!threadId || endingSupport) return
      endingSupport = true
      errorMessage = ''
      renderDock()
      endSupportThread({ threadId })
        .then(() => {
          setDockState({ open: false, minimized: false, activeThreadId: '', title: '', mode: 'thread' })
        })
        .catch((error) => {
          errorMessage = error?.message || 'Could not end support chat.'
        })
        .finally(() => {
          endingSupport = false
          renderDock()
        })
      return
    }
    const requestAgent = event.target.closest('[data-chat-dock-request-agent]')
    if (requestAgent) {
      event.preventDefault()
      const threadId = dockState.activeThreadId
      if (!threadId || requestingAgent) return
      requestingAgent = true
      errorMessage = ''
      renderDock()
      requestSupportAgent({ threadId })
        .catch((error) => {
          errorMessage = error?.message || 'Could not request a live agent.'
        })
        .finally(() => {
          requestingAgent = false
          renderDock()
        })
    }
    const attachButton = event.target.closest('[data-chat-dock-attach]')
    if (attachButton) {
      event.preventDefault()
      if (attachButton.disabled) return
      root.querySelector('[data-chat-dock-file-input]')?.click()
      return
    }
    const removeAttachment = event.target.closest('[data-chat-dock-remove-attachment]')
    if (removeAttachment) {
      event.preventDefault()
      const index = Number(removeAttachment.getAttribute('data-chat-dock-remove-attachment'))
      if (!Number.isFinite(index)) return
      setDraftAttachments(draftAttachments.filter((_, itemIndex) => itemIndex !== index))
      renderDock()
    }
  })

  root.addEventListener('input', (event) => {
    const input = event.target.closest('[data-chat-dock-input]')
    if (!input) return
    draft = input.value
    const button = input.closest('form')?.querySelector('button[type="submit"]')
    if (button) button.disabled = (!draft.trim() && !draftAttachments.length) || sending
  })

  root.addEventListener('change', (event) => {
    const input = event.target.closest('[data-chat-dock-file-input]')
    if (!input) return
    addDraftAttachments(input.files)
    input.value = ''
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

function handleDockResizeMove(event) {
  if (!activeResize) return
  event.preventDefault()
  const wantsWidth = activeResize.edge.includes('left')
  const wantsHeight = activeResize.edge.includes('top')
  const nextSize = normalizeDockSize({
    width: wantsWidth ? activeResize.startWidth + (activeResize.startX - event.clientX) : dockState.size?.width || activeResize.startWidth,
    height: wantsHeight ? activeResize.startHeight + (activeResize.startY - event.clientY) : dockState.size?.height || activeResize.startHeight
  })
  dockState.size = nextSize
  const panel = root?.querySelector('.chat-dock-panel')
  if (panel && nextSize) {
    panel.style.setProperty('--chat-dock-width', `${nextSize.width}px`)
    panel.style.setProperty('--chat-dock-height', `${nextSize.height}px`)
  }
}

function finishDockResize() {
  if (!activeResize) return
  activeResize = null
  document.body.classList.remove('chat-dock-is-resizing')
  window.removeEventListener('pointermove', handleDockResizeMove)
  persistState()
  dockScrollController.scheduleBottom({ force: dockScrollController.bottomLocked, reason: 'dock-resize-finish' })
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
  loadResonaAvatar()
  loadResonaBackground()

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
  finishDockResize()
  unsubscribeShellState()
  hasShellStateListener = false
  stopThreadSubscriptions()
  window.removeEventListener(OPEN_EVENT, openChatDock)
  root?.remove()
  root = null
  initialized = false
}
