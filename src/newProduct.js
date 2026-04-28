import './styles/base.css'
import './styles/newProduct.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './components/assetChrome'
import { waitForInitialAuthState } from './firebase/auth'
import { buildProductPayload, getProductById, isPlaceholderProductId, PRODUCT_QUOTAS, requestProductReview, saveProductDraft } from './data/productService'
import { doc, getDoc } from 'firebase/firestore'
import { db } from './firebase/firestore'
import { ROUTES } from './utils/routes'

const PRODUCT_SECTIONS = [
  { key: 'product-info', label: 'Product Info' },
  { key: 'media-upload', label: 'Media & Upload' },
  { key: 'contributors', label: 'Contributors' },
  { key: 'pricing', label: 'Pricing' },
  { key: 'preview', label: 'Preview' },
  { key: 'agreements', label: 'Agreements' },
  { key: 'publish', label: 'Publish' }
]

const PRODUCT_TYPE_OPTIONS = [
  'Single Sample', 'Sample Pack', 'Drum Kit', 'Vocal Pack', 'Preset Bank', 'Wavetable Pack',
  'MIDI Pack', 'Project File', 'Plugin / VST', 'Course / Tutorial', 'Release', 'Other'
]

const USAGE_LICENSE_OPTIONS = ['Standard License', 'Royalty Free', 'Custom License', 'Exclusive License']

const app = document.querySelector('#app')
app.innerHTML = `
  ${navShell({ currentPage: 'products' })}
  <main>
    <section class="section product-editor-shell">
      <div class="section-inner" data-product-editor-root>
        <article class="product-editor-card"><p>Loading creator workspace...</p></article>
      </div>
    </section>
  </main>
`

initShellChrome()

const editorRoot = document.querySelector('[data-product-editor-root]')
let editorState = {
  user: null,
  slugLocked: false,
  mediaFiles: {
    cover: null,
    thumbnail: null,
    gallery: [],
    previewAudio: [],
    previewVideo: [],
    deliverables: [],
    folderDeliverables: []
  },
  status: { message: '', state: 'info' },
  creatorProfile: null,
  draft: null,
  requestedProductId: new URLSearchParams(window.location.search).get('id') || ''
}

function getCreatorIdentity(user = null, profile = null, draft = {}) {
  const profileDisplayName = String(profile?.displayName || '').trim()
  const profileUsername = String(profile?.username || profile?.handle || '').trim()
  const authDisplayName = String(user?.displayName || '').trim()
  const draftDisplayName = String(draft?.artistName || '').trim()
  const draftUsername = String(draft?.artistUsername || '').trim()
  const artistId = user?.uid || String(draft?.artistId || '')
  return {
    artistId,
    artistName: profileDisplayName || authDisplayName || draftDisplayName || 'Creator',
    artistUsername: profileUsername || draftUsername,
    artistProfilePath: artistId ? String(draft?.artistProfilePath || `profiles/${artistId}`) : String(draft?.artistProfilePath || '')
  }
}

function applyCreatorIdentity(draft = {}, user = null, profile = null) {
  return { ...(draft || {}), ...getCreatorIdentity(user, profile, draft) }
}

async function fetchPublicCreatorProfile(uid = '') {
  if (!db || !uid) return null
  try {
    const snapshot = await getDoc(doc(db, 'profiles', uid))
    return snapshot.exists() ? (snapshot.data() || null) : null
  } catch {
    return null
  }
}

function createEmptyProductDraft(user = null, profile = null) {
  const creator = getCreatorIdentity(user, profile)
  return {
    id: '',
    title: '',
    slug: '',
    shortDescription: '',
    description: '',
    productType: 'Single Sample',
    artistId: creator.artistId,
    artistName: creator.artistName,
    artistUsername: creator.artistUsername,
    artistProfilePath: creator.artistProfilePath,
    status: 'draft',
    visibility: 'private',
    price: '0',
    currency: 'USD',
    isFree: true,
    featured: false,
    saleEnabled: false,
    usageLicense: 'Standard License',
    version: '',
    licensePath: '',
    categories: '',
    genres: '',
    tags: '',
    formatNotes: '',
    compatibilityNotes: '',
    includedFiles: '',
    contributorNames: '',
    contributorIds: '',
    downloadPath: '',
    previewAudioPaths: '',
    previewVideoPaths: '',
    releasedAt: '',
    storefrontVisible: true,
    galleryPaths: '',
    coverPath: '',
    thumbnailPath: '',
    coverURL: '',
    thumbnailURL: '',
    updatedAt: ''
  }
}

function productTypeAccept(type = '', section = 'deliverable') {
  const isPlugin = type === 'Plugin / VST'
  if (section === 'previewAudio') return 'audio/*'
  if (section === 'previewVideo') return 'video/*'
  if (section === 'gallery') return 'image/*'
  if (isPlugin) return '.zip,.exe,.dmg,.pkg,.msi,.rar,.7z'
  if (type === 'Single Sample') return 'audio/*,.zip'
  return '.zip,.rar,.7z,audio/*,video/*,application/*,text/*'
}

function validateDraftFiles(files = []) {
  if (files.length > PRODUCT_QUOTAS.maxFileCount) return `Too many files. Maximum is ${PRODUCT_QUOTAS.maxFileCount}.`
  let totalBytes = 0
  for (const file of files) {
    totalBytes += Number(file.size || 0)
    if ((file.name || '').length > PRODUCT_QUOTAS.maxFileNameLength) return `Filename too long: ${file.name}`
    const relative = file.webkitRelativePath || file.name || ''
    const depth = relative.split('/').filter(Boolean).length
    if (depth > PRODUCT_QUOTAS.maxFolderDepth + 1) return `Folder depth exceeds ${PRODUCT_QUOTAS.maxFolderDepth} levels.`
    if (relative.length > PRODUCT_QUOTAS.maxPathLength) return `Path too long: ${relative}`
    if (file.size > PRODUCT_QUOTAS.maxSingleDeliverableBytes) return 'This file exceeds the 512 MB single-file limit.'
  }
  if (totalBytes > PRODUCT_QUOTAS.maxTotalDeliverableBytes) return 'This product exceeds the 1 GB deliverable limit.'
  return ''
}

function readSectionHash() {
  const hash = window.location.hash.replace('#', '')
  return PRODUCT_SECTIONS.some((item) => item.key === hash) ? hash : 'product-info'
}

function slugify(value) {
  return String(value || '').toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').replace(/-+/g, '-')
}

function escapeHtml(value) {
  return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

function getDraftStorageKey(user) {
  return `melogic:new-product-draft:${user?.uid || 'anonymous'}:v2`
}

function saveDraftState() {
  if (!editorState.user || !editorState.draft) return
  try {
    sessionStorage.setItem(getDraftStorageKey(editorState.user), JSON.stringify({ draft: editorState.draft, slugLocked: editorState.slugLocked, updatedAt: Date.now() }))
  } catch {
    // ignore
  }
}

function loadDraftState(user) {
  const empty = createEmptyProductDraft(user, editorState.creatorProfile)
  if (!user) return empty
  try {
    const raw = sessionStorage.getItem(getDraftStorageKey(user))
    if (!raw) return empty
    const parsed = JSON.parse(raw)
    editorState.slugLocked = Boolean(parsed?.slugLocked)
    const hydrated = applyCreatorIdentity({ ...empty, ...(parsed?.draft || {}) }, user, editorState.creatorProfile)
    if (isPlaceholderProductId(hydrated.id)) hydrated.id = ''
    return hydrated
  } catch {
    return empty
  }
}

function setStatus(message, state = 'info') {
  editorState.status = { message, state }
}

function updateDraftField(key, value) {
  if (!editorState.draft) return
  editorState.draft[key] = value
  saveDraftState()
}

function tagValuesFor(field) {
  return String(editorState.draft?.[field] || '').split(',').map((item) => item.trim()).filter(Boolean)
}

function setTagValues(field, values = []) {
  updateDraftField(field, values.filter(Boolean).join(', '))
}

function tagEditorMarkup(field, label, placeholder) {
  const values = tagValuesFor(field)
  return `
    <div class="product-info-field">
      <label>${label}</label>
      <div class="tag-editor" data-tag-editor="${field}">
        <div class="tag-pill-row">
          ${values.map((tag) => `<span class="tag-pill">${escapeHtml(tag)}<button type="button" data-remove-tag="${escapeHtml(tag)}" data-tag-field="${field}">×</button></span>`).join('')}
        </div>
        <input type="text" data-tag-input="${field}" placeholder="${escapeHtml(placeholder)}" />
      </div>
    </div>
  `
}

function formattedEditDate(value) {
  if (!value) return new Date().toISOString().slice(0, 10)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? new Date().toISOString().slice(0, 10) : d.toISOString().slice(0, 10)
}

function renderProductInfoPanel() {
  const draft = editorState.draft || createEmptyProductDraft(editorState.user)
  return `
    <section class="product-info-grid">
      <div class="product-info-field"><label>Product Title</label><input name="title" value="${escapeHtml(draft.title)}" /></div>
      <div class="product-info-field"><label>Slug</label><input name="slug" value="${escapeHtml(draft.slug)}" /></div>
      <div class="product-info-field"><label>Product Type</label><select name="productType">${PRODUCT_TYPE_OPTIONS.map((option) => `<option ${draft.productType === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>

      <div class="product-info-field"><label>Artist / Primary Creator</label><input name="artistName" value="${escapeHtml(draft.artistName)}" readonly class="locked-input" /></div>
      <div class="product-info-field"><label>Version</label><input name="version" value="${escapeHtml(draft.version || '')}" placeholder="v1.0" /></div>
      ${tagEditorMarkup('compatibilityNotes', 'Compatibility', 'Ableton, FL Studio, Serum')}

      ${tagEditorMarkup('tags', 'Tags', 'Press Enter to add tags')}
      ${tagEditorMarkup('categories', 'Categories', 'Press Enter to add categories')}
      ${tagEditorMarkup('genres', 'Genres', 'Press Enter to add genres')}

      <div class="product-info-field"><label>Short Description</label><input name="shortDescription" value="${escapeHtml(draft.shortDescription)}" /></div>
      <div class="product-info-field"><label>Release Date</label><input type="date" name="releasedAt" value="${escapeHtml(draft.releasedAt)}" /></div>
      <div class="product-info-field"><label>Usage License</label><select name="usageLicense">${USAGE_LICENSE_OPTIONS.map((option) => `<option ${draft.usageLicense === option ? 'selected' : ''}>${option}</option>`).join('')}</select></div>

      <div class="product-info-field is-wide"><label>Long Description</label><textarea name="description" rows="10">${escapeHtml(draft.description)}</textarea></div>
      <div class="product-info-side-stack">
        <div class="product-info-field"><label>Visibility</label><select name="visibility"><option value="public" ${draft.visibility === 'public' ? 'selected' : ''}>Public</option><option value="unlisted" ${draft.visibility === 'unlisted' ? 'selected' : ''}>Unlisted</option><option value="private" ${draft.visibility === 'private' ? 'selected' : ''}>Private</option></select></div>
        <div class="product-info-field"><label>Status</label><select name="status"><option value="draft" ${draft.status === 'draft' ? 'selected' : ''}>Draft</option><option value="review_pending" ${draft.status === 'review_pending' ? 'selected' : ''}>Review pending</option><option value="needs_changes" ${draft.status === 'needs_changes' ? 'selected' : ''}>Needs changes</option><option value="rejected" ${draft.status === 'rejected' ? 'selected' : ''}>Rejected</option><option value="archived" ${draft.status === 'archived' ? 'selected' : ''}>Archived</option></select></div>
        <div class="product-info-field"><label>Edit Date</label><input type="date" value="${escapeHtml(formattedEditDate(draft.updatedAt || draft.createdAt))}" readonly /></div>
      </div>
    </section>
  `
}

function renderPlaceholderPanel(section) {
  return `<section class="placeholder-panel"><h3>${escapeHtml(PRODUCT_SECTIONS.find((item) => item.key === section)?.label || 'Section')}</h3><p>This section will be redesigned in the next pass. Product Info is fully redesigned now.</p></section>`
}

function renderEditor() {
  const section = readSectionHash()
  const statusClass = editorState.status.message ? `is-visible is-${editorState.status.state}` : ''

  editorRoot.innerHTML = `
    <div class="marketplace-editor-page">
      <header class="marketplace-editor-header">
        <p class="marketplace-editor-header-kicker">NEW MARKETPLACE ITEM</p>
        <p class="marketplace-editor-header-copy">Configure product metadata, media, pricing, and publish state for the Melogic marketplace.</p>
      </header>

      <section class="marketplace-editor-tabs-wrap">
        <p class="marketplace-editor-pages-label"><span></span>PAGES<span></span></p>
        <div class="marketplace-editor-tabs">
          ${PRODUCT_SECTIONS.map((item) => `<button type="button" class="marketplace-editor-tab ${item.key === section ? 'is-active' : ''}" data-section="${item.key}">${item.label}</button>`).join('')}
        </div>
      </section>

      <section class="marketplace-editor-workspace">
        <div class="product-status ${statusClass}">${editorState.status.message || ''}</div>
        <form data-product-form>
          ${section === 'product-info' ? renderProductInfoPanel() : renderPlaceholderPanel(section)}
          <div class="editor-actions">
            <button type="button" class="button button-muted" data-save-draft>Save Draft</button>
            <button type="button" class="button button-accent" data-publish-product>Publish Product</button>
          </div>
        </form>
      </section>
    </div>
  `

  editorRoot.querySelectorAll('[data-section]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.hash = button.getAttribute('data-section')
      renderEditor()
    })
  })

  const form = editorRoot.querySelector('[data-product-form]')

  form?.addEventListener('input', (event) => {
    const target = event.target
    if (!target?.name) return
    if (!(target.name in editorState.draft)) return
    if (['artistName', 'artistUsername', 'artistProfilePath', 'artistId'].includes(target.name)) return
    const value = target.type === 'checkbox' ? target.checked : target.value
    updateDraftField(target.name, value)
    if (target.name === 'slug') {
      editorState.slugLocked = Boolean(String(value || '').trim())
      saveDraftState()
      return
    }
    if (target.name === 'title' && !editorState.slugLocked) {
      const nextSlug = slugify(value)
      updateDraftField('slug', nextSlug)
      const slugInput = form.querySelector('input[name="slug"]')
      if (slugInput) slugInput.value = nextSlug
    }
  })

  form?.addEventListener('keydown', (event) => {
    const input = event.target
    if (!(input instanceof HTMLInputElement)) return
    const field = input.getAttribute('data-tag-input')
    if (!field) return
    if (event.key === 'Enter') {
      event.preventDefault()
      const value = input.value.trim()
      if (!value) return
      const values = [...tagValuesFor(field), value]
      setTagValues(field, Array.from(new Set(values)))
      input.value = ''
      renderEditor()
      return
    }
    if (event.key === 'Backspace' && !input.value.trim()) {
      const values = tagValuesFor(field)
      values.pop()
      setTagValues(field, values)
      renderEditor()
    }
  })

  editorRoot.querySelectorAll('[data-remove-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      const field = button.getAttribute('data-tag-field') || ''
      const value = button.getAttribute('data-remove-tag') || ''
      setTagValues(field, tagValuesFor(field).filter((tag) => tag !== value))
      renderEditor()
    })
  })

  async function persistProduct(desiredStatus = 'draft') {
    if (!editorState.user || !editorState.draft) return
    setStatus(desiredStatus === 'published' ? 'Submitting for review...' : 'Saving draft...', 'info')
    renderEditor()
    try {
      const deliverableValidation = validateDraftFiles([...editorState.mediaFiles.folderDeliverables, ...editorState.mediaFiles.deliverables])
      if (deliverableValidation) {
        setStatus(deliverableValidation, 'error')
        renderEditor()
        return
      }
      const wasNewDraft = !editorState.draft.id || isPlaceholderProductId(editorState.draft.id)
      const payload = buildProductPayload({ ...editorState.draft, profile: editorState.creatorProfile || {}, currentStatus: editorState.draft.status || 'draft', status: desiredStatus === 'published' ? 'review_pending' : desiredStatus }, editorState.user)
      const result = await saveProductDraft(editorState.user, payload, {
        productId: wasNewDraft ? '' : editorState.draft.id,
        status: desiredStatus === 'published' ? 'review_pending' : desiredStatus,
        isNew: wasNewDraft,
        mediaFiles: editorState.mediaFiles,
        galleryFiles: editorState.mediaFiles.gallery,
        previewAudioFiles: editorState.mediaFiles.previewAudio,
        previewVideoFiles: editorState.mediaFiles.previewVideo,
        deliverableFiles: [...editorState.mediaFiles.folderDeliverables, ...editorState.mediaFiles.deliverables],
        previewAssignment: editorState.draft.previewAssignment || {},
        onStatus: (message) => {
          setStatus(message, 'info')
          renderEditor()
        }
      })
      updateDraftField('id', result.productId)
      updateDraftField('status', result.payload?.status || editorState.draft.status)
      updateDraftField('slug', payload.slug)
      if (desiredStatus === 'published') {
        const reviewResult = await requestProductReview(result.productId)
        updateDraftField('status', reviewResult?.status || 'review_pending')
      }
      setStatus(desiredStatus === 'published' ? 'Submitted for review.' : 'Draft saved.', 'success')
      renderEditor()
    } catch (error) {
      console.warn('[new-product] save failed', error?.code || error?.message || error)
      setStatus(desiredStatus === 'published' ? 'Could not submit for review.' : 'Could not save draft.', 'error')
      renderEditor()
    }
  }

  editorRoot.querySelector('[data-save-draft]')?.addEventListener('click', () => persistProduct('draft'))
  editorRoot.querySelector('[data-publish-product]')?.addEventListener('click', () => persistProduct('published'))
}

async function initPage() {
  const user = await waitForInitialAuthState()
  if (!user) {
    editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Sign in required</h2><a class="button button-accent" href="${ROUTES.auth}">Go to Sign In / Sign Up</a></article>`
    return
  }

  editorState.user = user
  editorState.creatorProfile = await fetchPublicCreatorProfile(user.uid)

  if (editorState.requestedProductId) {
    const existingProduct = await getProductById(editorState.requestedProductId)
    if (!existingProduct || existingProduct.artistId !== user.uid) {
      editorRoot.innerHTML = `<article class="product-editor-card signed-out"><h2>Listing access denied</h2><a class="button button-accent" href="${ROUTES.products}">Back to Products</a></article>`
      return
    }
    editorState.draft = applyCreatorIdentity({ ...createEmptyProductDraft(user, editorState.creatorProfile), ...existingProduct, id: existingProduct.id }, user, editorState.creatorProfile)
  } else {
    editorState.draft = applyCreatorIdentity(loadDraftState(user), user, editorState.creatorProfile)
  }

  renderEditor()
}

window.addEventListener('hashchange', () => {
  if (!editorState.user) return
  renderEditor()
})

initPage()
