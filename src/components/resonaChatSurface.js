import '../styles/resonaChatSurface.css'
import { waitForInitialAuthState } from '../firebase/auth'
import { openChatDock } from './chatDock'
import { createOrGetResonaThread, subscribeToThread } from '../data/threadService'
import { markThreadRead, sendMessage, subscribeToMessages } from '../data/messageService'

const instances = new WeakMap()
const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024
const THREAD_CACHE_PREFIX = 'melogic_resona_surface_thread_v1'
const CONTEXT_TYPES = new Set(['inbox', 'studio_daw', 'stagemaker'])
const BOTTOM_LOCK_THRESHOLD = 80
const GUIDANCE_STATE_EVENT = 'melogic:site-guidance-state'

function escapeHtml(value = '') {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function createClientMessageId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function safeContextType(value = '') {
  const clean = String(value || '').trim()
  return CONTEXT_TYPES.has(clean) ? clean : 'inbox'
}

function threadCacheKey(uid = '', context = {}) {
  const contextType = safeContextType(context.contextType)
  const contextId = String(context.contextId || '').trim() || 'default'
  return `${THREAD_CACHE_PREFIX}:${uid}:${contextType}:${contextId}`
}

function toLocalIso(date = new Date()) {
  const offsetMinutes = -date.getTimezoneOffset()
  const sign = offsetMinutes >= 0 ? '+' : '-'
  const absolute = Math.abs(offsetMinutes)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${sign}${pad(Math.floor(absolute / 60))}:${pad(absolute % 60)}`
}

function basePageContext(contextSource = 'embedded') {
  const now = new Date()
  return {
    contextSource,
    route: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    currentRoute: `${window.location.pathname || '/'}${window.location.search || ''}`.slice(0, 240),
    pageTitle: document.title || '',
    clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || '',
    clientLocalTimeISO: toLocalIso(now),
    utcTimeISO: now.toISOString()
  }
}

function isActivityFresh(activity = {}) {
  if (activity?.active !== true) return false
  if (!activity.expiresAt) return true
  const expires = new Date(activity.expiresAt).getTime()
  return Number.isFinite(expires) ? expires > Date.now() : true
}

function attachmentKind(fileOrAttachment = {}) {
  const mime = String(fileOrAttachment.type || fileOrAttachment.mimeType || '').toLowerCase()
  const name = String(fileOrAttachment.name || '').toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('audio/')) return 'audio'
  if (name.endsWith('.pdf') || mime.includes('pdf')) return 'PDF'
  if (name.endsWith('.txt') || name.endsWith('.md') || mime.startsWith('text/')) return 'TXT'
  return 'FILE'
}

function messageBody(message = {}) {
  const text = escapeHtml(message.body || '')
  const attachments = Array.isArray(message.attachments) ? message.attachments : []
  const attachmentMarkup = attachments.length ? `
    <div class="resona-surface-attachments">
      ${attachments.map((attachment) => {
        const url = escapeHtml(attachment.url || '')
        const name = escapeHtml(attachment.name || 'Attachment')
        const mime = String(attachment.mimeType || '')
        if (mime.startsWith('image/') && url) return `<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${name}" loading="lazy" /></a>`
        if (mime.startsWith('audio/') && url) return `<figure><figcaption>${name}</figcaption><audio controls preload="metadata" src="${url}"></audio></figure>`
        return url ? `<a class="resona-surface-file" href="${url}" target="_blank" rel="noopener"><span>${escapeHtml(attachmentKind(attachment))}</span>${name}</a>` : `<span class="resona-surface-file"><span>${escapeHtml(attachmentKind(attachment))}</span>${name}</span>`
      }).join('')}
    </div>
  ` : ''
  return `${text ? `<p>${text}</p>` : ''}${attachmentMarkup}`
}

class ResonaChatSurface {
  constructor(root, options = {}) {
    this.root = root
    this.options = options
    this.user = null
    this.thread = null
    this.messages = []
    this.draft = ''
    this.attachments = []
    this.previewUrls = []
    this.error = ''
    this.loading = true
    this.sending = false
    this.bottomLocked = true
    this.guidanceState = { active: false, starting: false, threadId: '' }
    this.resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
      if (this.bottomLocked) this.scrollMessagesToBottom()
    }) : null
    this.guidanceStateHandler = (event) => {
      const nextState = event?.detail || { active: false, starting: false, threadId: '' }
      const wasForThisThread = this.guidanceState?.threadId && this.guidanceState.threadId === this.thread?.id
      const isForThisThread = nextState?.threadId && nextState.threadId === this.thread?.id
      this.guidanceState = nextState
      if (wasForThisThread || isForThisThread) this.render()
    }
    this.contextKey = this.threadContextKey()
    this.unsubscribeThread = () => {}
    this.unsubscribeMessages = () => {}
    window.addEventListener(GUIDANCE_STATE_EVENT, this.guidanceStateHandler)
    this.render()
    this.init()
  }

  async init() {
    try {
      this.user = await waitForInitialAuthState()
      if (!this.user) {
        this.loading = false
        this.render()
        return
      }
      const cachedThreadId = this.readCachedThreadId()
      if (cachedThreadId) {
        this.thread = this.threadPlaceholder(cachedThreadId)
        this.subscribeToThreadId(cachedThreadId)
        this.loading = false
        this.render()
      }
      const thread = await createOrGetResonaThread(this.threadContext())
      if (thread?.id) {
        this.writeCachedThreadId(thread.id)
        this.thread = thread
        if (thread.id !== cachedThreadId) this.subscribeToThreadId(thread.id)
      }
      this.loading = false
      this.render(true)
    } catch (error) {
      this.error = error?.message || 'Could not open Resona.'
      this.loading = false
      this.render()
    }
  }

  update(options = {}) {
    this.options = { ...this.options, ...options }
    const nextContextKey = this.threadContextKey()
    if (nextContextKey !== this.contextKey) {
      this.contextKey = nextContextKey
      this.unsubscribeThread()
      this.unsubscribeMessages()
      this.thread = null
      this.messages = []
      this.loading = true
      this.bottomLocked = true
      this.render()
      this.init()
      return
    }
    this.render()
  }

  threadContext() {
    const contextType = safeContextType(this.options.contextType || this.options.contextSource || 'inbox')
    const contextId = contextType === 'inbox' ? '' : String(this.options.contextId || '').trim()
    const contextLabel = String(this.options.contextLabel || this.options.title || '').trim()
    return { contextType, contextId, contextLabel }
  }

  threadContextKey() {
    const context = this.threadContext()
    return `${context.contextType}:${context.contextId || 'general'}`
  }

  threadPlaceholder(threadId = '') {
    return {
      id: threadId,
      type: 'agent',
      agentId: 'resona',
      title: 'Resona',
      imagePath: '',
      participantIds: this.user?.uid ? [this.user.uid] : [],
      participantUids: this.user?.uid ? [this.user.uid] : [],
      ...this.threadContext()
    }
  }

  readCachedThreadId() {
    try {
      if (!this.user?.uid) return ''
      return String(localStorage.getItem(threadCacheKey(this.user.uid, this.threadContext())) || '').trim()
    } catch {
      return ''
    }
  }

  writeCachedThreadId(threadId = '') {
    try {
      if (!this.user?.uid || !threadId) return
      localStorage.setItem(threadCacheKey(this.user.uid, this.threadContext()), threadId)
    } catch {
      // Cache is only a startup hint; failures should not block chat.
    }
  }

  subscribeToThreadId(threadId = '') {
    if (!threadId) return
    this.unsubscribeThread()
    this.unsubscribeMessages()
    this.unsubscribeThread = subscribeToThread(threadId, (thread) => {
      this.thread = thread || this.thread
      this.render()
    }, () => {
      this.thread = null
      this.loading = true
      this.render()
    })
    this.unsubscribeMessages = subscribeToMessages(threadId, (messages) => {
      const hadMessages = this.messages.length > 0
      const previousLastId = this.messages.at(-1)?.id || ''
      const nextLastId = messages.at(-1)?.id || ''
      const shouldScroll = !hadMessages || (nextLastId && nextLastId !== previousLastId && this.bottomLocked)
      this.messages = messages
      this.loading = false
      this.render(shouldScroll)
    }, (error) => {
      this.error = error?.message || 'Could not load Resona messages.'
      this.loading = false
      this.render()
    })
  }

  activity() {
    const activity = this.thread?.resonaActivity || {}
    return isActivityFresh(activity) ? activity : { active: false, label: '' }
  }

  locked() {
    return this.activity().active === true
  }

  context() {
    const contextSource = this.options.contextSource || 'embedded'
    const extra = typeof this.options.getContext === 'function' ? this.options.getContext() : {}
    return {
      ...basePageContext(contextSource),
      ...this.threadContext(),
      featureArea: contextSource,
      ...(extra && typeof extra === 'object' ? extra : {})
    }
  }

  setAttachments(files = []) {
    this.previewUrls.forEach((url) => URL.revokeObjectURL(url))
    this.attachments = files.slice(0, MAX_ATTACHMENTS)
    this.previewUrls = this.attachments.map((file) => file instanceof File && String(file.type || '').startsWith('image/') ? URL.createObjectURL(file) : '')
  }

  addAttachments(fileList = []) {
    const incoming = Array.from(fileList || []).filter((file) => file instanceof File)
    const accepted = []
    let rejected = ''
    incoming.forEach((file) => {
      if (this.attachments.length + accepted.length >= MAX_ATTACHMENTS) {
        rejected = `You can attach up to ${MAX_ATTACHMENTS} files.`
        return
      }
      if (Number(file.size || 0) > MAX_ATTACHMENT_BYTES) {
        rejected = 'Attachment is too large. Maximum size is 50 MB.'
        return
      }
      accepted.push(file)
    })
    if (accepted.length) this.setAttachments([...this.attachments, ...accepted])
    this.error = rejected
    this.render()
  }

  async send(form = null) {
    if (!this.user || !this.thread?.id || this.sending || this.locked()) return
    const body = this.draft.trim()
    const attachments = this.attachments.slice()
    if (!body && !attachments.length) return
    this.sending = true
    this.error = ''
    this.render()
    try {
      await sendMessage(this.thread.id, {
        senderId: this.user.uid,
        body,
        type: 'text',
        attachments,
        clientMessageId: createClientMessageId(),
        safePageContext: this.context()
      })
      await markThreadRead({ threadId: this.thread.id, uid: this.user.uid }).catch(() => {})
      this.draft = ''
      this.setAttachments([])
      const input = form?.querySelector('[data-resona-surface-input]')
      if (input) input.value = ''
    } catch (error) {
      this.error = error?.message || 'Unable to send message.'
    }
    this.sending = false
    this.render(true)
  }

  openDock() {
    if (!this.thread?.id) return
    openChatDock({
      mode: 'thread',
      threadId: this.thread.id,
      title: this.thread.contextLabel || this.options.title || 'Resona',
      ownerUid: this.user?.uid || ''
    })
  }

  messageContainer() {
    return this.root.querySelector('[data-resona-surface-messages]')
  }

  isNearBottom(element = this.messageContainer()) {
    if (!element) return true
    return element.scrollHeight - element.scrollTop - element.clientHeight <= BOTTOM_LOCK_THRESHOLD
  }

  scrollMessagesToBottom() {
    const messages = this.messageContainer()
    if (!messages) return
    messages.scrollTop = messages.scrollHeight
    requestAnimationFrame(() => {
      const latest = this.messageContainer()
      if (latest) latest.scrollTop = latest.scrollHeight
    })
  }

  observeMessages() {
    const messages = this.messageContainer()
    if (!messages || !this.resizeObserver) return
    this.resizeObserver.disconnect()
    this.resizeObserver.observe(messages)
  }

  render(scrollBottom = false) {
    const previousMessages = this.messageContainer()
    const previousScrollTop = previousMessages?.scrollTop || 0
    if (previousMessages) this.bottomLocked = this.isNearBottom(previousMessages)
    const activeInput = document.activeElement?.matches?.('[data-resona-surface-input]')
      ? document.activeElement
      : null
    const restoreInputFocus = Boolean(activeInput && this.root.contains(activeInput))
    const selectionStart = restoreInputFocus ? activeInput.selectionStart : null
    const selectionEnd = restoreInputFocus ? activeInput.selectionEnd : null
    const variant = this.options.variant || 'embedded'
    const locked = this.locked()
    const activityLabel = this.activity().label || 'Resona is responding...'
    const hasThread = Boolean(this.thread?.id)
    const inputDisabled = this.sending || !this.user || !hasThread
    const sendDisabled = inputDisabled || locked
    const threadContext = this.threadContext()
    const showActions = this.options.showHeaderActions !== false
    const showGuidance = this.options.showGuidanceButton !== false
    const guidanceForThread = this.guidanceState?.threadId && this.guidanceState.threadId === this.thread?.id
    const guidanceStarting = guidanceForThread && this.guidanceState.starting === true
    const guidanceActive = guidanceForThread && this.guidanceState.active === true
    const guidanceLabel = guidanceActive ? 'Guidance On' : (guidanceStarting ? 'Starting...' : 'Enable Guidance')
    this.root.classList.add('resona-chat-surface-host')
    this.root.innerHTML = `
      <section class="resona-chat-surface is-${escapeHtml(variant)} ${this.options.roundedParent === false ? 'is-square-parent' : ''}">
        <header class="resona-surface-header">
          <div><strong>Resona</strong><span>${escapeHtml(this.options.title || 'Platform agent')}</span></div>
          <div class="resona-surface-header-actions">
            ${showActions ? `<button type="button" data-resona-surface-dock ${hasThread ? '' : 'disabled'}>Open Dock</button>` : ''}
            ${showGuidance ? `<button type="button" data-site-guidance-start data-site-guidance-origin="embedded" data-site-guidance-thread-id="${escapeHtml(this.thread?.id || '')}" data-site-guidance-thread-kind="thread" data-site-guidance-viewer="resona" data-site-guidance-context-type="${escapeHtml(threadContext.contextType)}" data-site-guidance-context-id="${escapeHtml(threadContext.contextId)}" data-site-guidance-context-label="${escapeHtml(threadContext.contextLabel)}" ${hasThread && !guidanceStarting && !guidanceActive ? '' : 'disabled'}>${escapeHtml(guidanceLabel)}</button>` : ''}
          </div>
        </header>
        <div class="resona-surface-messages" data-resona-surface-messages>
          ${this.loading && !hasThread ? '<p class="resona-surface-empty">Opening Resona...</p>' : ''}
          ${!this.loading && !this.user ? '<p class="resona-surface-empty">Sign in to chat with Resona.</p>' : ''}
          ${this.user && hasThread && this.loading && !this.messages.length ? '<p class="resona-surface-empty">Loading conversation...</p>' : ''}
          ${!this.loading && this.user && !this.messages.length ? '<p class="resona-surface-empty">Ask Resona about this workspace.</p>' : ''}
          ${this.messages.slice(-80).map((message) => {
            if (message.senderType === 'system') return ''
            const mine = message.senderId === this.user?.uid
            const ai = message.senderType === 'ai' || message.agentId === 'resona'
            return `<article class="resona-surface-message ${mine ? 'is-mine' : 'is-theirs'} ${ai ? 'is-ai' : ''}"><div class="resona-surface-bubble">${messageBody(message)}</div></article>`
          }).join('')}
          ${locked ? `<article class="resona-surface-message is-theirs is-ai is-activity"><div class="resona-surface-bubble"><span>${escapeHtml(activityLabel)}</span><i></i><i></i><i></i></div></article>` : ''}
        </div>
        <form class="resona-surface-composer ${locked ? 'is-locked' : ''}" data-resona-surface-form>
          ${this.attachments.length ? `<div class="resona-surface-preview-strip">${this.attachments.map((file, index) => {
            const name = escapeHtml(file.name || 'Attachment')
            const preview = this.previewUrls[index] || ''
            return `<article><div>${preview ? `<img src="${escapeHtml(preview)}" alt="${name}" />` : escapeHtml(attachmentKind(file))}</div><small>${name}</small><button type="button" data-resona-surface-remove="${index}" aria-label="Remove ${name}">×</button></article>`
          }).join('')}</div>` : ''}
          ${this.error ? `<p class="resona-surface-error">${escapeHtml(this.error)}</p>` : ''}
          <div class="resona-surface-composer-row">
            <textarea data-resona-surface-input rows="2" maxlength="1200" placeholder="${locked ? 'Resona is responding, but you can keep drafting...' : 'Write a message...'}" ${inputDisabled ? 'disabled' : ''}>${escapeHtml(this.draft)}</textarea>
            <input data-resona-surface-file type="file" multiple accept="image/*,audio/*,.pdf,.txt,.md" ${inputDisabled ? 'disabled' : ''} />
            <button type="button" data-resona-surface-attach ${inputDisabled ? 'disabled' : ''}>+</button>
            <button type="submit" ${sendDisabled || (!this.draft.trim() && !this.attachments.length) ? 'disabled' : ''}>Send</button>
          </div>
        </form>
      </section>
    `
    this.bind()
    this.observeMessages()
    if (restoreInputFocus && !inputDisabled) {
      requestAnimationFrame(() => {
        const input = this.root.querySelector('[data-resona-surface-input]')
        if (!input) return
        input.focus({ preventScroll: true })
        if (selectionStart != null && selectionEnd != null) {
          input.setSelectionRange(selectionStart, selectionEnd)
        }
      })
    }
    if (scrollBottom) {
      this.scrollMessagesToBottom()
    } else if (previousMessages) {
      requestAnimationFrame(() => {
        const messages = this.messageContainer()
        if (messages) messages.scrollTop = previousScrollTop
      })
    }
  }

  bind() {
    this.root.querySelector('[data-resona-surface-input]')?.addEventListener('input', (event) => {
      this.draft = event.target.value
      const button = event.target.closest('form')?.querySelector('button[type="submit"]')
      if (button) button.disabled = this.locked() || this.sending || (!this.draft.trim() && !this.attachments.length)
    })
    this.root.querySelector('[data-resona-surface-input]')?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' || event.shiftKey) return
      event.preventDefault()
      this.send(event.target.closest('form'))
    })
    this.root.querySelector('[data-resona-surface-form]')?.addEventListener('submit', (event) => {
      event.preventDefault()
      this.send(event.target)
    })
    this.root.querySelector('[data-resona-surface-attach]')?.addEventListener('click', () => {
      this.root.querySelector('[data-resona-surface-file]')?.click()
    })
    this.root.querySelector('[data-resona-surface-dock]')?.addEventListener('click', () => {
      this.openDock()
    })
    this.root.querySelector('[data-resona-surface-messages]')?.addEventListener('scroll', (event) => {
      this.bottomLocked = this.isNearBottom(event.currentTarget)
    }, { passive: true })
    this.root.querySelector('[data-resona-surface-file]')?.addEventListener('change', (event) => {
      this.addAttachments(event.target.files)
      event.target.value = ''
    })
    this.root.querySelectorAll('[data-resona-surface-remove]').forEach((button) => {
      button.addEventListener('click', () => {
        const index = Number(button.getAttribute('data-resona-surface-remove'))
        this.setAttachments(this.attachments.filter((_, itemIndex) => itemIndex !== index))
        this.render()
      })
    })
  }
}

export function mountResonaChatSurface(root, options = {}) {
  if (!root) return null
  const existing = instances.get(root)
  if (existing) {
    existing.update(options)
    return existing
  }
  const instance = new ResonaChatSurface(root, options)
  instances.set(root, instance)
  return instance
}
