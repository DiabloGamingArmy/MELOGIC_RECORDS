import '../styles/resonaChatSurface.css'
import { waitForInitialAuthState } from '../firebase/auth'
import { createOrGetResonaThread, subscribeToThread } from '../data/threadService'
import { markThreadRead, sendMessage, subscribeToMessages } from '../data/messageService'

const instances = new WeakMap()
const MAX_ATTACHMENTS = 4
const MAX_ATTACHMENT_BYTES = 50 * 1024 * 1024

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
    this.unsubscribeThread = () => {}
    this.unsubscribeMessages = () => {}
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
      this.thread = await createOrGetResonaThread()
      this.unsubscribeThread = subscribeToThread(this.thread.id, (thread) => {
        this.thread = thread || this.thread
        this.render()
      })
      this.unsubscribeMessages = subscribeToMessages(this.thread.id, (messages) => {
        this.messages = messages
        this.render(true)
      })
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
    this.render()
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

  render(scrollBottom = false) {
    const variant = this.options.variant || 'embedded'
    const locked = this.locked()
    const activityLabel = this.activity().label || 'Resona is responding...'
    const disabled = this.loading || this.sending || locked || !this.user || !this.thread
    this.root.classList.add('resona-chat-surface-host')
    this.root.innerHTML = `
      <section class="resona-chat-surface is-${escapeHtml(variant)} ${this.options.roundedParent === false ? 'is-square-parent' : ''}">
        <header class="resona-surface-header">
          <div><strong>Resona</strong><span>${escapeHtml(this.options.title || 'Platform agent')}</span></div>
          ${locked ? `<em>${escapeHtml(activityLabel)}</em>` : ''}
        </header>
        <div class="resona-surface-messages" data-resona-surface-messages>
          ${this.loading ? '<p class="resona-surface-empty">Opening Resona...</p>' : ''}
          ${!this.loading && !this.user ? '<p class="resona-surface-empty">Sign in to chat with Resona.</p>' : ''}
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
            <textarea data-resona-surface-input rows="2" maxlength="1200" placeholder="${locked ? 'Resona is responding...' : 'Write a message...'}" ${disabled ? 'disabled' : ''}>${escapeHtml(this.draft)}</textarea>
            <input data-resona-surface-file type="file" multiple accept="image/*,audio/*,.pdf,.txt,.md" ${disabled ? 'disabled' : ''} />
            <button type="button" data-resona-surface-attach ${disabled ? 'disabled' : ''}>+</button>
            <button type="submit" ${disabled || (!this.draft.trim() && !this.attachments.length) ? 'disabled' : ''}>Send</button>
          </div>
        </form>
      </section>
    `
    this.bind()
    if (scrollBottom) {
      requestAnimationFrame(() => {
        const messages = this.root.querySelector('[data-resona-surface-messages]')
        if (messages) messages.scrollTop = messages.scrollHeight
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
